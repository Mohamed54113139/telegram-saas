import { Project, Schedule } from "@prisma/client";
import { prisma } from "../config/prisma";
import { zonedTimeToUtc, parseTime, weekdayInTimezone, localDateParts } from "../utils/timezone";
import { logEvent } from "./logService";

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
    const idempotencyKey = `schedule:${schedule.id}:${occ.toISOString()}`;
    const existing = await prisma.scheduledPost.findUnique({ where: { idempotencyKey } });

    if (!existing) {
      await prisma.scheduledPost.create({
        data: {
          projectId: project.id,
          messageTemplateId: schedule.messageTemplateId,
          scheduleId: schedule.id,
          idempotencyKey,
          scheduledFor: occ,
          status: "SCHEDULED",
        },
      });
      created++;
      continue;
    }

    // Ne jamais retoucher une occurrence déjà traitée (publiée, en cours
    // d'envoi, ou en échec définitif) — seule une occurrence annulée peut
    // être remise en file par une nouvelle matérialisation.
    if (existing.status !== "CANCELLED") continue;

    // Remet en SCHEDULED, et réaligne sur le message actuellement associé au
    // Schedule (le contenu réel n'est généré qu'au moment de l'envoi, à
    // partir de messageTemplateId — donc un changement de message depuis
    // l'édition du Schedule est bien pris en compte pour ce futur envoi).
    await prisma.scheduledPost.update({
      where: { id: existing.id },
      data: { status: "SCHEDULED", messageTemplateId: schedule.messageTemplateId },
    });
    reactivated++;
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
