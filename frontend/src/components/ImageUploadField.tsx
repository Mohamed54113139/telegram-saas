"use client";

import { useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";

interface ImageUploadFieldProps {
  projectId: string;
  value: string;
  onChange: (url: string) => void;
}

// Champ image : upload direct d'un fichier vers ImgBB (via le backend), avec
// repli possible vers un simple collage de lien manuel.
export default function ImageUploadField({ projectId, value, onChange }: ImageUploadFieldProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualMode, setManualMode] = useState(false);

  function readFileAsBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const imageBase64 = await readFileAsBase64(file);
      const result = await apiFetch<{ url: string }>(`/api/projects/${projectId}/upload-image`, {
        method: "POST",
        body: JSON.stringify({ imageBase64 }),
      });
      onChange(result.url);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Envoi de l'image impossible.");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  if (manualMode) {
    return (
      <>
        <label>Image (URL)</label>
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="https://exemple.com/image.jpg" />
        <p className="muted" style={{ marginTop: 4 }}>
          <a href="#" onClick={(e) => { e.preventDefault(); setManualMode(false); }}>ou envoyer un fichier image</a>
        </p>
      </>
    );
  }

  return (
    <>
      <label>Image</label>
      <input type="file" accept="image/*" onChange={handleFileChange} disabled={uploading} />
      {uploading && <p className="muted">Envoi en cours…</p>}
      {error && <div className="error-box">{error}</div>}
      {value && !uploading && (
        <div style={{ marginTop: 8 }}>
          <img src={value} alt="Aperçu" style={{ maxWidth: 200, borderRadius: 8 }} />
        </div>
      )}
      <p className="muted" style={{ marginTop: 4 }}>
        <a href="#" onClick={(e) => { e.preventDefault(); setManualMode(true); }}>ou coller un lien d'image existant</a>
      </p>
    </>
  );
}
