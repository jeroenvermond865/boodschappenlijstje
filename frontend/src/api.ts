const BASE = process.env.EXPO_PUBLIC_BACKEND_URL ?? "";

import { Platform } from "react-native";

import { setServerDown } from "@/src/updates";

let authToken: string | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

// Geüploade foto's (/api/files/...) zijn alleen te zien als je bent ingelogd: die halen we op met je inlog
export function isPrivateFile(uri?: string | null): boolean {
  return !!uri && uri.includes("/api/files/") && !uri.includes("/api/files/scoutkook/ai-fotos/");
}
const blobCache = new Map<string, string>();
export async function privateFileSrc(uri: string): Promise<{ uri: string; headers?: Record<string, string> }> {
  const full = uri.startsWith("http") ? uri : `${BASE}${uri}`;
  const headers: Record<string, string> = authToken ? { Authorization: `Bearer ${authToken}` } : {};
  if (Platform.OS !== "web") return { uri: full, headers };
  const hit = blobCache.get(full);
  if (hit) return { uri: hit };
  const res = await fetch(full, { headers });
  if (!res.ok) throw new Error("Foto niet gevonden");
  const url = URL.createObjectURL(await res.blob());
  if (blobCache.size > 300) blobCache.clear();
  blobCache.set(full, url);
  return { uri: url };
}

export async function api<T = any>(
  path: string,
  options: { method?: string; body?: any } = {},
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;

  const res = await fetch(`${BASE}/api${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body != null ? JSON.stringify(options.body) : undefined,
  }).catch((e) => {
    // Wel internet, maar de server antwoordt niet: waarschijnlijk een update
    if (typeof navigator !== "undefined" && navigator.onLine !== false && Platform.OS === "web") setServerDown(true);
    throw e;
  });
  // Render geeft 502/503 terwijl de server opnieuw opstart
  if (res.status === 502 || res.status === 503) setServerDown(true);

  let data: any = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    const detail = data && typeof data === "object" && data.detail ? data.detail : "Er ging iets mis";
    const err = new Error(typeof detail === "string" ? detail : "Er ging iets mis") as Error & { status?: number };
    err.status = res.status;
    throw err;
  }

  return data as T;
}

// Een bestand (bijv. een PDF) van de server ophalen
export async function apiBlob(path: string, body?: any): Promise<Blob> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
  const res = await fetch(`${BASE}/api${path}`, { method: body != null ? "POST" : "GET", headers, body: body != null ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error("Er ging iets mis");
  return res.blob();
}

// Productfoto's van winkels via onze eigen server (als de winkel ze niet direct laat zien)
export function imageProxyUrl(url: string): string | null {
  return url.startsWith("https://") ? `${BASE}/api/img?u=${encodeURIComponent(url)}` : null;
}

export function mediaUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("http")) return url;
  return `${BASE}${url}`;
}

export async function uploadImage(
  uri: string,
  name: string,
  type: string,
): Promise<{ url: string; path: string }> {
  const form = new FormData();
  if (Platform.OS === "web") {
    const blob = await (await fetch(uri)).blob();
    form.append("file", blob, name);
  } else {
    form.append("file", { uri, name, type } as any);
  }
  const headers: Record<string, string> = {};
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
  const res = await fetch(`${BASE}/api/upload`, { method: "POST", headers, body: form });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(data?.detail ?? "Upload mislukt") as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return data;
}
