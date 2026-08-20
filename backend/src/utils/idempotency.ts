import { v4 as uuidv4 } from "uuid";

// Génère un identifiant unique et stable pour une publication programmée.
// Utilisé comme clé d'unicité en base pour empêcher tout doublon (point 50, Règle 8).
export function generateIdempotencyKey(): string {
  return uuidv4();
}
