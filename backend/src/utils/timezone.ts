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

// Renvoie le jour civil LOCAL (année/mois/jour tels que vus depuis ce fuseau) d'un
// instant. Contrairement à date.getUTCFullYear()/getUTCMonth()/getUTCDate(), qui
// renvoient le calendrier UTC, cette fonction renvoie le calendrier du fuseau donné —
// les deux peuvent différer d'un jour autour de minuit local selon le décalage horaire.
export function localDateParts(date: Date, timeZone: string): { year: number; month: number; day: number } {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const parts = fmt.formatToParts(date);
  const get = (type: string) => parseInt(parts.find((p) => p.type === type)!.value, 10);
  return { year: get("year"), month: get("month"), day: get("day") };
}

// Renvoie l'heure LOCALE (dans le fuseau donné) d'un instant — pendant utile
// pour extraire "l'heure de la journée" d'un Session.startTime récurrent,
// indépendamment de sa composante date (voir materializeSession).
export function localTimeParts(date: Date, timeZone: string): { hour: number; minute: number } {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false });
  const parts = fmt.formatToParts(date);
  const get = (type: string) => parseInt(parts.find((p) => p.type === type)!.value, 10);
  const hour = get("hour");
  return { hour: hour === 24 ? 0 : hour, minute: get("minute") };
}
