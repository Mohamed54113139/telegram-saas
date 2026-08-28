// Vérifie que la nouvelle récurrence hebdomadaire des Session applique bien
// le même correctif de fuseau horaire que les Schedule : le jour civil ET
// l'heure utilisés pour construire l'occurrence doivent tous les deux venir
// du calendrier LOCAL du projet (pas du calendrier UTC brut de l'instant).
//
// Exécution : npx ts-node --transpile-only scripts/testSessionRecurrenceFix.ts

import { weekdayInTimezone, localDateParts, localTimeParts, zonedTimeToUtc } from "../src/utils/timezone";

const DAY_NAMES = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];

interface Scenario {
  name: string;
  timezone: string;
  cursor: Date; // instant candidat, tel qu'itéré par materializeSession
  daysOfWeek: number[]; // jours sélectionnés dans la Session récurrente
  sessionStartTime: Date; // Session.startTime — seule sa composante HEURE (locale) compte
  expectedLocalWeekday: number;
}

const scenarios: Scenario[] = [
  {
    name: "America/New_York — Lundi 09:00 (décalage négatif)",
    timezone: "America/New_York",
    cursor: new Date("2024-01-09T02:00:00Z"), // = lundi 21:00 EST la veille -> lundi côté fuseau projet
    daysOfWeek: [1],
    sessionStartTime: new Date("2024-01-01T09:00:00Z"), // heure de référence 09:00 UTC, mais on lit son heure LOCALE (fuseau projet)
    expectedLocalWeekday: 1, // Lundi
  },
  {
    name: "Europe/Paris — Lundi 09:00 (décalage positif)",
    timezone: "Europe/Paris",
    cursor: new Date("2024-01-07T23:30:00Z"), // dimanche 23:30 UTC = lundi 00:30 à Paris
    daysOfWeek: [1],
    sessionStartTime: new Date("2024-01-01T09:00:00Z"),
    expectedLocalWeekday: 1, // Lundi
  },
];

let allPassed = true;

for (const s of scenarios) {
  console.log(`\n=== ${s.name} ===`);
  console.log(`cursor (UTC) : ${s.cursor.toISOString()}`);

  const dow = weekdayInTimezone(s.cursor, s.timezone);
  const applies = s.daysOfWeek.includes(dow);
  console.log(`jour vérifié (fuseau projet) : ${DAY_NAMES[dow]} -> applies=${applies}`);

  if (!applies) {
    console.log("❌ ÉCHEC : scénario invalide (le cursor ne correspond pas au jour attendu).");
    allPassed = false;
    continue;
  }

  // Reproduit exactement la logique de materializeSession :
  const { hour, minute } = localTimeParts(s.sessionStartTime, s.timezone);
  const { year, month, day } = localDateParts(s.cursor, s.timezone);
  const dayStart = zonedTimeToUtc(year, month, day, hour, minute, s.timezone);
  const resultWeekday = weekdayInTimezone(dayStart, s.timezone);

  console.log(`heure locale extraite de session.startTime : ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
  console.log(`dayStart généré (UTC) : ${dayStart.toISOString()} -> jour local réel : ${DAY_NAMES[resultWeekday]}`);

  const ok = resultWeekday === s.expectedLocalWeekday;
  console.log(ok ? "✅ L'occurrence de session tombe bien sur le bon jour local." : "❌ ÉCHEC : mauvais jour.");
  if (!ok) allPassed = false;

  // Comparaison avec ce qu'aurait donné l'ancien bug (composantes UTC du cursor)
  const buggyOcc = zonedTimeToUtc(s.cursor.getUTCFullYear(), s.cursor.getUTCMonth() + 1, s.cursor.getUTCDate(), hour, minute, s.timezone);
  const buggyWeekday = weekdayInTimezone(buggyOcc, s.timezone);
  console.log(`[pour comparaison, logique buguée] aurait donné : ${DAY_NAMES[buggyWeekday]}`);
}

console.log("\n" + (allPassed ? "✅ Tous les scénarios passent." : "❌ Au moins un scénario échoue."));
process.exit(allPassed ? 0 : 1);
