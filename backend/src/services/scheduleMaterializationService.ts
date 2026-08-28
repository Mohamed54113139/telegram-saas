import { Project, Schedule, Session } from "@prisma/client";
import { prisma } from "../config/prisma";
import { zonedTimeToUtc, parseTime, weekdayInTimezone, localDateParts, localTimeParts } from "../utils/timezone";
import { calculateSessionOccurrences } from "./sessionCalcService";
import { logEvent } from "./logService";

type UpsertOutcome = "created" | "reactivated" | "skipped";

// Crée l'occurrence si elle n'existe pas encore (clé d'idempotence), la
// réactive si elle avait été annulée (CANCELLED -> SCHEDULED, en réalignant
// messageTemplateId au cas où il aurait changé depuis), et ne touche jamais
// une occurrence déjà traitée (PUBLISHED/PROCESSING/FAILED). Logique partagée
// entre la matérialisation des Schedule et celle des Session récurrentes.
async function upsertScheduledOccurrence(params: {
  idempotencyKey: string;
  projectId: string;
  messageTemplateId: string;
  scheduledFor: Date;
  scheduleId?: string;
  sessionId?: string;
}): Promise<UpsertOutcome> {
  const { idempotencyKey, projectId, messageTemplateId, scheduledFor, scheduleId, sessionId } = params;
  const existing = await prisma.scheduledPost.findUnique({ where: { idempotencyKey } });

  if (!existing) {
    await prisma.scheduledPost.create({
      data: {
        projectId,
        messageTemplateId,
        scheduleId,
        sessionId,
        idempotencyKey,
        scheduledFor,
        status: "SCHEDULED",
      },
    });
    return "created";
  }

  if (existing.status !== "CANCELLED") return "skipped";

  await prisma.scheduledPost.update({
    where: { id: existing.id },
    data: { status: "SCHEDULED", messageTemplateId },
  });
  return "reactivated";
}

// "Matérialise" un Schedule en publications concrètes (ScheduledPost) pour une fenêtre de temps donnée.
// Peut être appelé plusieurs fois sans jamais créer de doublons grâce à une clé d'idempotence déterministe (Règle 8).
export async function materializeSchedule(schedule: Schedule, project: Project, windowDays = 14): Promise<number> {
  if (!schedule.active) return 0;

  const now = new Date();
  const windowEnd = new Date(now.getTime() + windowDays * 24 * 60 * 60 * 1000);
  const effectiveStart = schedule.startDate && schedule.startDate > now ? schedule.startDate : now;
  const effectiveEnd = schedule.endDate && schedule.endDate < windowEnd ? schedule.endDate : windowEnd;

  const occurrences: Date[] = [];

  if (schedule.repeatMode === "CUSTOM_DATES") {
    for (const d of schedule.specificDates) {
      for (const t of schedule.times) {
        const { hour, minute } = parseTime(t);
        const utc = zonedTimeToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), hour, minute, project.timezone);
        if (utc >= effectiveStart && utc <= effectiveEnd) occurrences.push(utc);
      }
    }
  } else if (schedule.repeatMode === "ONCE") {
    const base = schedule.startDate ?? now;
    for (const t of schedule.times) {
      const { hour, minute } = parseTime(t);
      const utc = zonedTimeToUtc(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), hour, minute, project.timezone);
      if (utc >= effectiveStart && utc <= effectiveEnd) occurrences.push(utc);
    }
  } else {
    // DAILY ou CUSTOM_DAYS : on itère jour par jour dans la fenêtre.
    // Le jour de semaine ET le jour civil utilisé pour construire l'occurrence
    // doivent tous les deux venir du calendrier LOCAL du projet (pas du
    // calendrier UTC de l'instant `cursor`), sous peine de décalage d'un jour
    // selon le fuseau (voir localDateParts).
    for (let cursor = new Date(effectiveStart); cursor <= effectiveEnd; cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000)) {
      const dow = weekdayInTimezone(cursor, project.timezone);
      const applies = schedule.repeatMode === "DAILY" || schedule.daysOfWeek.includes(dow);
      if (!applies) continue;

      const { year, month, day } = localDateParts(cursor, project.timezone);
      for (const t of schedule.times) {
        const { hour, minute } = parseTime(t);
        const utc = zonedTimeToUtc(year, month, day, hour, minute, project.timezone);
        if (utc >= effectiveStart && utc <= effectiveEnd) occurrences.push(utc);
      }
    }
  }

  let created = 0;
  let reactivated = 0;
  for (const occ of occurrences) {
    const outcome = await upsertScheduledOccurrence({
      idempotencyKey: `schedule:${schedule.id}:${occ.toISOString()}`,
      projectId: project.id,
      messageTemplateId: schedule.messageTemplateId,
      scheduledFor: occ,
      scheduleId: schedule.id,
    });
    if (outcome === "created") created++;
    else if (outcome === "reactivated") reactivated++;
  }

  if (created > 0 || reactivated > 0) {
    await logEvent({
      projectId: project.id,
      category: "scheduler",
      message: `${created} publication(s) planifiée(s) et ${reactivated} réactivée(s) depuis la programmation.`,
      metadata: { scheduleId: schedule.id, created, reactivated },
    });
  }

  return created + reactivated;
}

// Matérialise toutes les programmations actives (appelé par le scheduler périodique)
export async function materializeAllActiveSchedules(): Promise<void> {
  const schedules = await prisma.schedule.findMany({ where: { active: true }, include: { project: true } });
  for (const schedule of schedules) {
    try {
      await materializeSchedule(schedule, schedule.project);
    } catch (e: any) {
      await logEvent({ projectId: schedule.projectId, level: "ERROR", category: "scheduler", message: "Échec de matérialisation d'une programmation.", metadata: { error: e?.message } });
    }
  }
}

// "Matérialise" une Session récurrente : pour chaque jour sélectionné dans la
// fenêtre à venir, régénère le même calcul d'occurrences (calculateSessionOccurrences)
// qu'une session ponctuelle, à partir de l'heure locale (fuseau du projet) de
// session.startTime — même mécanisme et même correctif de fuseau horaire que
// materializeSchedule (jour civil ET heure toujours dérivés du calendrier
// local du projet, jamais du calendrier UTC brut de l'instant).
export async function materializeSession(session: Session, project: Project, windowDays = 14): Promise<number> {
  if (!session.active || !session.recurring || session.daysOfWeek.length === 0) return 0;

  const now = new Date();
  const windowEnd = new Date(now.getTime() + windowDays * 24 * 60 * 60 * 1000);
  const { hour, minute } = localTimeParts(session.startTime, project.timezone);

  let created = 0;
  let reactivated = 0;

  for (let cursor = new Date(now); cursor <= windowEnd; cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000)) {
    const dow = weekdayInTimezone(cursor, project.timezone);
    if (!session.daysOfWeek.includes(dow)) continue;

    const { year, month, day } = localDateParts(cursor, project.timezone);
    const dayStart = zonedTimeToUtc(year, month, day, hour, minute, project.timezone);
    if (dayStart < now) continue; // créneau du jour déjà passé : pas de régénération rétroactive

    const calc = calculateSessionOccurrences({ startTime: dayStart, durationMin: session.durationMin, intervalMin: session.intervalMin });

    for (const occ of calc.occurrences) {
      const outcome = await upsertScheduledOccurrence({
        idempotencyKey: `session:${session.id}:${occ.toISOString()}`,
        projectId: project.id,
        messageTemplateId: session.messageTemplateId,
        scheduledFor: occ,
        sessionId: session.id,
      });
      if (outcome === "created") created++;
      else if (outcome === "reactivated") reactivated++;
    }

    if (session.beforeMessageTemplateId && session.beforeMinutesOffset) {
      const beforeTime = new Date(dayStart.getTime() - session.beforeMinutesOffset * 60_000);
      const outcome = await upsertScheduledOccurrence({
        idempotencyKey: `session:${session.id}:before:${dayStart.toISOString()}`,
        projectId: project.id,
        messageTemplateId: session.beforeMessageTemplateId,
        scheduledFor: beforeTime,
        sessionId: session.id,
      });
      if (outcome === "created") created++;
      else if (outcome === "reactivated") reactivated++;
    }

    if (session.afterMessageTemplateId) {
      const outcome = await upsertScheduledOccurrence({
        idempotencyKey: `session:${session.id}:after:${dayStart.toISOString()}`,
        projectId: project.id,
        messageTemplateId: session.afterMessageTemplateId,
        scheduledFor: calc.endTime,
        sessionId: session.id,
      });
      if (outcome === "created") created++;
      else if (outcome === "reactivated") reactivated++;
    }
  }

  if (created > 0 || reactivated > 0) {
    await logEvent({
      projectId: project.id,
      category: "scheduler",
      message: `${created} publication(s) planifiée(s) et ${reactivated} réactivée(s) depuis la session récurrente "${session.name}".`,
      metadata: { sessionId: session.id, created, reactivated },
    });
  }

  return created + reactivated;
}

// Matérialise toutes les sessions récurrentes actives (appelé par le scheduler périodique)
export async function materializeAllActiveRecurringSessions(): Promise<void> {
  const sessions = await prisma.session.findMany({ where: { active: true, recurring: true }, include: { project: true } });
  for (const session of sessions) {
    try {
      await materializeSession(session, session.project);
    } catch (e: any) {
      await logEvent({ projectId: session.projectId, level: "ERROR", category: "scheduler", message: "Échec de matérialisation d'une session récurrente.", metadata: { error: e?.message, sessionId: session.id } });
    }
  }
}
