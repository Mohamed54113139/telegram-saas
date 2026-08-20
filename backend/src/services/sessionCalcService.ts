// Calcul automatique des horaires d'une session (points 38-39)
// Étant donné une heure de début, une durée totale et un intervalle, renvoie
// la liste des horodatages de publication ainsi que le nombre total.

export interface SessionCalcInput {
  startTime: Date;
  durationMin: number;
  intervalMin: number;
}

export interface SessionCalcResult {
  startTime: Date;
  endTime: Date;
  intervalMin: number;
  totalPosts: number;
  occurrences: Date[];
}

export function calculateSessionOccurrences(input: SessionCalcInput): SessionCalcResult {
  const { startTime, durationMin, intervalMin } = input;

  if (durationMin <= 0) throw new Error("La durée de la session doit être supérieure à 0.");
  if (intervalMin <= 0) throw new Error("L'intervalle doit être supérieur à 0.");

  const endTime = new Date(startTime.getTime() + durationMin * 60_000);
  const occurrences: Date[] = [];

  let cursor = new Date(startTime.getTime());
  while (cursor.getTime() <= endTime.getTime()) {
    occurrences.push(new Date(cursor.getTime()));
    cursor = new Date(cursor.getTime() + intervalMin * 60_000);
  }

  return {
    startTime,
    endTime,
    intervalMin,
    totalPosts: occurrences.length,
    occurrences,
  };
}
