// Convertit une date/heure "locale" (dans le fuseau du projet) en Date UTC.
// Approche standard sans dépendance externe (suffisante pour ce cas d'usage).
export function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const asUTC = Date.UTC(year, month - 1, day, hour, minute, 0);
  const guess = new Date(asUTC);

  const tzString = guess.toLocaleString("en-US", { timeZone });
  const utcString = guess.toLocaleString("en-US", { timeZone: "UTC" });

  const offsetMs = new Date(utcString).getTime() - new Date(tzString).getTime();
  return new Date(asUTC + offsetMs);
}

// Parse "HH:MM" -> { hour, minute }
export function parseTime(hhmm: string): { hour: number; minute: number } {
  const [h, m] = hhmm.split(":").map((x) => parseInt(x, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) throw new Error(`Heure invalide: ${hhmm}`);
  return { hour: h, minute: m };
}

// Renvoie le jour de la semaine (0=dimanche...6=samedi) d'une date, dans le fuseau donné
export function weekdayInTimezone(date: Date, timeZone: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" });
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[fmt.format(date)];
}
