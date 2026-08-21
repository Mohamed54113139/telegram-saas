let cachedApiUrl: string | null = null;

async function getApiUrl(): Promise<string> {
  if (cachedApiUrl) return cachedApiUrl;
  try {
    const res = await fetch("/api/runtime-config");
    const data = await res.json();
    cachedApiUrl = data.apiUrl ?? "http://localhost:4000";
  } catch {
    cachedApiUrl = "http://localhost:4000";
  }
  return cachedApiUrl ?? "http://localhost:4000";
}

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem("token");
}

export function setToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (token) window.localStorage.setItem("token", token);
  else window.localStorage.removeItem("token");
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// Client API générique. Toutes les routes protégées passent par ici avec le
// token JWT en en-tête Authorization.
export async function apiFetch<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const apiUrl = await getApiUrl();
  const res = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await res.json() : null;

  if (!res.ok) {
    throw new ApiError(res.status, body?.error ?? `Erreur ${res.status}`);
  }
  return body as T;
}
