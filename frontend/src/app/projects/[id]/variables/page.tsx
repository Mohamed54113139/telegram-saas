"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api";

interface ProtectedVar { id: string; value: string; label?: string; isLink: boolean; }
interface MessageVar { id: string; key: string; type: string; possibleValues: string[]; numberMin?: number; numberMax?: number; }

export default function VariablesPage() {
  const { id } = useParams<{ id: string }>();
  const [protectedVars, setProtectedVars] = useState<ProtectedVar[]>([]);
  const [vars, setVars] = useState<MessageVar[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [pValue, setPValue] = useState("");
  const [pLabel, setPLabel] = useState("");
  const [pIsLink, setPIsLink] = useState(false);

  const [vKey, setVKey] = useState("");
  const [vType, setVType] = useState("TEXT");
  const [vValues, setVValues] = useState("");
  const [vMin, setVMin] = useState("");
  const [vMax, setVMax] = useState("");

  async function load() {
    const [p, v] = await Promise.all([
      apiFetch<ProtectedVar[]>(`/api/projects/${id}/protected-variables`),
      apiFetch<MessageVar[]>(`/api/projects/${id}/variables`),
    ]);
    setProtectedVars(p);
    setVars(v);
  }

  useEffect(() => { load(); }, [id]);

  async function addProtected(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiFetch(`/api/projects/${id}/protected-variables`, { method: "POST", body: JSON.stringify({ value: pValue, label: pLabel || undefined, isLink: pIsLink }) });
      setPValue(""); setPLabel(""); setPIsLink(false);
      await load();
    } catch (err) { setError(err instanceof ApiError ? err.message : "Erreur."); }
  }

  async function removeProtected(varId: string) {
    await apiFetch(`/api/projects/${id}/protected-variables/${varId}`, { method: "DELETE" });
    await load();
  }

  async function addVariable(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const payload: any = { key: vKey, type: vType };
      if (vType === "NUMBER") {
        payload.numberMin = parseFloat(vMin);
        payload.numberMax = parseFloat(vMax);
      } else {
        payload.possibleValues = vValues.split(",").map((v) => v.trim()).filter(Boolean);
      }
      await apiFetch(`/api/projects/${id}/variables`, { method: "POST", body: JSON.stringify(payload) });
      setVKey(""); setVValues(""); setVMin(""); setVMax("");
      await load();
    } catch (err) { setError(err instanceof ApiError ? err.message : "Erreur."); }
  }

  async function removeVariable(varId: string) {
    await apiFetch(`/api/projects/${id}/variables/${varId}`, { method: "DELETE" });
    await load();
  }

  return (
    <div>
      <h1>Variables</h1>
      {error && <div className="error-box">{error}</div>}

      <div className="card">
        <h2>Variables non modifiables</h2>
        <p className="muted">Ces éléments (codes, liens, noms de marque…) resteront toujours exactement identiques, même si la reformulation automatique est activée.</p>
        <table>
          <thead><tr><th>Valeur</th><th>Libellé</th><th>Lien ?</th><th></th></tr></thead>
          <tbody>
            {protectedVars.map((v) => (
              <tr key={v.id}>
                <td><code>{v.value}</code></td>
                <td>{v.label ?? "—"}</td>
                <td>{v.isLink ? "Oui" : "Non"}</td>
                <td><button className="secondary" onClick={() => removeProtected(v.id)}>Supprimer</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <form onSubmit={addProtected} className="row" style={{ marginTop: 12, alignItems: "flex-end" }}>
          <div style={{ flex: 1, minWidth: 160 }}>
            <label>Valeur exacte</label>
            <input value={pValue} onChange={(e) => setPValue(e.target.value)} placeholder="ABC123 ou https://…" required />
          </div>
          <div style={{ flex: 1, minWidth: 140 }}>
            <label>Libellé (optionnel)</label>
            <input value={pLabel} onChange={(e) => setPLabel(e.target.value)} />
          </div>
          <label className="row" style={{ marginTop: 0 }}>
            <input type="checkbox" checked={pIsLink} onChange={(e) => setPIsLink(e.target.checked)} /> Lien
          </label>
          <button type="submit">Ajouter</button>
        </form>
      </div>

      <div className="card">
        <h2>Variables modifiables</h2>
        <p className="muted">Insérez-les dans vos messages avec la syntaxe <code>{"{CLE}"}</code>. Variables automatiques disponibles partout : <code>{"{DATE}"}</code>, <code>{"{HEURE}"}</code>, <code>{"{JOUR}"}</code>.</p>
        <table>
          <thead><tr><th>Clé</th><th>Type</th><th>Valeurs / bornes</th><th></th></tr></thead>
          <tbody>
            {vars.map((v) => (
              <tr key={v.id}>
                <td><code>{"{" + v.key + "}"}</code></td>
                <td>{v.type}</td>
                <td>{v.type === "NUMBER" ? `${v.numberMin} → ${v.numberMax}` : v.possibleValues.join(", ")}</td>
                <td><button className="secondary" onClick={() => removeVariable(v.id)}>Supprimer</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <form onSubmit={addVariable} className="row" style={{ marginTop: 12, alignItems: "flex-end" }}>
          <div style={{ minWidth: 120 }}>
            <label>Clé</label>
            <input value={vKey} onChange={(e) => setVKey(e.target.value)} placeholder="VALEUR" required />
          </div>
          <div style={{ minWidth: 120 }}>
            <label>Type</label>
            <select value={vType} onChange={(e) => setVType(e.target.value)}>
              <option value="TEXT">Texte</option>
              <option value="NUMBER">Nombre</option>
            </select>
          </div>
          {vType === "NUMBER" ? (
            <>
              <div style={{ width: 100 }}><label>Min</label><input type="number" value={vMin} onChange={(e) => setVMin(e.target.value)} required /></div>
              <div style={{ width: 100 }}><label>Max</label><input type="number" value={vMax} onChange={(e) => setVMax(e.target.value)} required /></div>
            </>
          ) : (
            <div style={{ flex: 1, minWidth: 200 }}>
              <label>Valeurs possibles (séparées par des virgules)</label>
              <input value={vValues} onChange={(e) => setVValues(e.target.value)} placeholder="Alice, Bob, Charlie" />
            </div>
          )}
          <button type="submit">Ajouter</button>
        </form>
      </div>
    </div>
  );
}
