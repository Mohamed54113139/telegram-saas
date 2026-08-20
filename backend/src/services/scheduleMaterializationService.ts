import { Project, Schedule } from "@prisma/client";
import { prisma } from "../config/prisma";
import { zonedTimeToUtc, parseTime, weekdayInTimezone } from "../utils/timezone";
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
    // DAILY ou CUSTOM_DAYS : on itère jour par jour dans la fenêtre
    for (let cursor = new Date(effectiveStart); cursor <= effectiveEnd; cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000)) {
      const dow = weekdayInTimezone(cursor, project.timezone);
      const applies = schedule.repeatMode === "DAILY" || schedule.daysOfWeek.includes(dow);
      if (!applies) continue;

      for (const t of schedule.times) {
        const { hour, minute } = parseTime(t);
        const utc = zonedTimeToUtc(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, cursor.getUTCDate(), hour, minute, project.timezone);
        if (utc >= effectiveStart && utc <= effectiveEnd) occurrences.push(utc);
      }
    }
  }

  let created = 0;
  for (const occ of occurrences) {
    const idempotencyKey = `schedule:${schedule.id}:${occ.toISOString()}`;
    const result = await prisma.scheduledPost.upsert({
      where: { idempotencyKey },
      update: {},
      create: {
        projectId: project.id,
        messageTemplateId: schedule.messageTemplateId,
        scheduleId: schedule.id,
        idempotencyKey,
        scheduledFor: occ,
        status: "SCHEDULED",
      },
    });
    if (result.createdAt.getTime() === result.updatedAt.getTime()) created++;
  }

  if (created > 0) {
    await logEvent({ projectId: project.id, category: "scheduler", message: `${created} publication(s) planifiée(s) depuis la programmation.`, metadata: { scheduleId: schedule.id } });
  }

  return created;
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
