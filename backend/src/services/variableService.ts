import { MessageVariable, VariableType } from "@prisma/client";

// Substitution des variables modifiables ({NOM}, {VALEUR}, {DATE}, {HEURE}, {JOUR}...) — points 17-19
// Le remplacement se fait AVANT toute reformulation IA, afin que l'IA travaille sur un texte déjà concret.
export function resolveVariables(
  content: string,
  variables: MessageVariable[],
  timezone: string,
  overrides?: Record<string, string>
): { resolved: string; usedValues: Record<string, string> } {
  const usedValues: Record<string, string> = {};
  let resolved = content;

  const now = new Date();
  const fmt = new Intl.DateTimeFormat("fr-FR", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
  const fmtTime = new Intl.DateTimeFormat("fr-FR", { timeZone: timezone, hour: "2-digit", minute: "2-digit" });
  const fmtDay = new Intl.DateTimeFormat("fr-FR", { timeZone: timezone, weekday: "long" });

  // Variables automatiques de date/heure (point 19)
  const autoValues: Record<string, string> = {
    DATE: fmt.format(now),
    HEURE: fmtTime.format(now),
    JOUR: fmtDay.format(now),
  };

  for (const [key, value] of Object.entries(autoValues)) {
    const pattern = new RegExp(`\\{${escapeRegExp(key)}\\}`, "g");
    if (pattern.test(resolved)) {
      resolved = resolved.replace(pattern, value);
      usedValues[key] = value;
    }
  }

  // Variables d'heure décalée inline, ex: {HEURE+10}, {HEURE+15}
  // (placé après le remplacement de {HEURE} seul, mais ce dernier est ancré exactement
  // sur "{HEURE}" donc ne capture jamais {HEURE+10} — aucun risque de collision entre les deux)
  const offsetPattern = /\{HEURE\+(\d+)\}/g;
  resolved = resolved.replace(offsetPattern, (match, minutesStr) => {
    const minutes = parseInt(minutesStr, 10);
    const target = new Date(now.getTime() + minutes * 60_000);
    const value = fmtTime.format(target);
    usedValues[`HEURE+${minutes}`] = value;
    return value;
  });

  for (const v of variables) {
    const pattern = new RegExp(`\\{${escapeRegExp(v.key)}\\}`, "g");
    if (!pattern.test(resolved)) continue;

    let value: string;
    if (overrides && overrides[v.key] !== undefined) {
      value = overrides[v.key];
    } else {
      value = pickValueForVariable(v);
    }
    resolved = resolved.replace(pattern, value);
    usedValues[v.key] = value;
  }

  return { resolved, usedValues };
}

function pickValueForVariable(v: MessageVariable): string {
  if (v.type === VariableType.NUMBER) {
    const min = v.preferredMin ?? v.numberMin ?? 0;
    const max = v.preferredMax ?? v.numberMax ?? 100;
    const value = Math.random() * (max - min) + min;
    return Number.isInteger(min) && Number.isInteger(max) ? String(Math.round(value)) : value.toFixed(2);
  }
  if (v.possibleValues.length > 0) {
    return v.possibleValues[Math.floor(Math.random() * v.possibleValues.length)];
  }
  return `{${v.key}}`; // aucune valeur définie : on laisse la variable visible plutôt que d'inventer une donnée
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Vérifie que toutes les variables non modifiables sont EXACTEMENT présentes dans le texte final (Règle 3)
export function verifyProtectedVariablesPresent(text: string, protectedValues: string[]): { ok: boolean; missing: string[] } {
  const missing = protectedValues.filter((val) => !text.includes(val));
  return { ok: missing.length === 0, missing };
}

// Vérifie que les éléments obligatoires sont présents (point 20)
export function verifyRequiredElementsPresent(text: string, requiredElements: string[]): { ok: boolean; missing: string[] } {
  const missing = requiredElements.filter((el) => !text.includes(el));
  return { ok: missing.length === 0, missing };
}
