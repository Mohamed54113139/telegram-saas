// Test ciblé (pas de framework de test dans ce projet) pour le correctif du
// bug de récurrence par jour dans scheduleMaterializationService.ts :
// le jour de semaine ET le jour civil utilisé pour construire l'occurrence
// doivent tous les deux venir du calendrier LOCAL du projet.
//
// Reproduit exactement le cas du rapport (America/New_York, Lundi 09:00),
// plus le cas symétrique pour un fuseau à décalage positif (Europe/Paris —
// Africa/Ouagadougou est en réalité UTC+0 toute l'année, donc ne peut pas
// démontrer le sens inverse du bug ; Europe/Paris, UTC+1 en janvier, sert
// d'équivalent réel à décalage positif).
//
// Exécution : npx ts-node --transpile-only scripts/testScheduleRecurrenceFix.ts

import { weekdayInTimezone, localDateParts, zonedTimeToUtc } from "../src/utils/timezone";

const DAY_NAMES = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];

interface Scenario {
  name: string;
  timezone: string;
  cursor: Date; // instant candidat, tel qu'itéré par materializeSchedule
  daysOfWeek: number[]; // jours sélectionnés dans le Schedule
  time: string; // "HH:MM"
  expectedLocalWeekday: number; // jour attendu, dans le fuseau du projet, pour l'occurrence générée
}

const scenarios: Scenario[] = [
  {
    // Cas exact du rapport : côté vérification, le cursor tombe bien un lundi
    // dans le fuseau du projet (lundi 09/01 21:00 EST = mardi 02:00 UTC), mais
    // l'ancien code utilisait le calendrier UTC (mardi 9) pour construire
    // l'occurrence, la faisant tomber un mardi au lieu d'un lundi.
    name: "America/New_York — Lundi 09:00 (décalage négatif)",
    timezone: "America/New_York",
    cursor: new Date("2024-01-09T02:00:00Z"),
    daysOfWeek: [1],
    time: "09:00",
    expectedLocalWeekday: 1, // Lundi
  },
  {
    name: "Europe/Paris — Lundi 09:00 (décalage positif)",
    timezone: "Europe/Paris",
    cursor: new Date("2024-01-07T23:30:00Z"), // dimanche 23:30 UTC = lundi 00:30 à Paris (UTC+1, janvier, sans DST)
    daysOfWeek: [1],
    time: "09:00",
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
    console.log("❌ ÉCHEC : le cursor ne correspond même pas au jour vérifié attendu, scénario invalide.");
    allPassed = false;
    continue;
  }

  // --- Ancien comportement (bugué), pour comparaison ---
  const [oldHour, oldMinute] = s.time.split(":").map((x) => parseInt(x, 10));
  const oldOcc = zonedTimeToUtc(s.cursor.getUTCFullYear(), s.cursor.getUTCMonth() + 1, s.cursor.getUTCDate(), oldHour, oldMinute, s.timezone);
  const oldLocalWeekday = weekdayInTimezone(oldOcc, s.timezone);
  console.log(`[ancien code] occurrence (UTC) : ${oldOcc.toISOString()} -> jour local réel : ${DAY_NAMES[oldLocalWeekday]}`);

  // --- Nouveau comportement (corrigé) ---
  const { year, month, day } = localDateParts(s.cursor, s.timezone);
  const [hour, minute] = s.time.split(":").map((x) => parseInt(x, 10));
  const newOcc = zonedTimeToUtc(year, month, day, hour, minute, s.timezone);
  const newLocalWeekday = weekdayInTimezone(newOcc, s.timezone);
  console.log(`[code corrigé] occurrence (UTC) : ${newOcc.toISOString()} -> jour local réel : ${DAY_NAMES[newLocalWeekday]}`);

  const buggedBefore = oldLocalWeekday !== s.expectedLocalWeekday;
  const fixedNow = newLocalWeekday === s.expectedLocalWeekday;

  console.log(`Ancien code reproduisait le bug : ${buggedBefore ? "oui" : "non (déjà correct pour ce cas)"}`);
  console.log(fixedNow ? "✅ Code corrigé : occurrence sur le bon jour." : "❌ ÉCHEC : occurrence toujours sur le mauvais jour après correction.");

  if (!fixedNow) allPassed = false;
}

console.log("\n" + (allPassed ? "✅ Tous les scénarios passent." : "❌ Au moins un scénario échoue."));
process.exit(allPassed ? 0 : 1);
