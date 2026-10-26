// Offline: de laatst opgehaalde versie van belangrijke schermen (zoals je boodschappenlijst) bewaren op het toestel,
// zodat je in de winkel zonder bereik je lijst nog ziet en kunt afvinken.
import { api } from "@/src/api";
import { storage } from "@/src/utils/storage";

const PREFIX = "offline:";
const INDEX = "offline:index";

export type Offline<T> = T & { offline_at?: string };

// Geen antwoord van de server (geen internet): dan heeft de fout geen statuscode
const isNetworkError = (e: unknown) => !(e as { status?: number })?.status;

export async function cachedApi<T>(path: string): Promise<Offline<T>> {
  try {
    const data = await api<T>(path);
    storage.setItem(PREFIX + path, JSON.stringify({ at: new Date().toISOString(), data }));
    rememberKey(PREFIX + path);
    return data as Offline<T>;
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    const raw = await storage.getItem<string | null>(PREFIX + path, null);
    if (!raw) throw e;
    const saved = JSON.parse(raw) as { at: string; data: T };
    return { ...(saved.data as object), offline_at: saved.at } as Offline<T>;
  }
}

async function rememberKey(key: string) {
  const raw = await storage.getItem<string | null>(INDEX, null);
  const keys: string[] = raw ? JSON.parse(raw) : [];
  if (!keys.includes(key)) storage.setItem(INDEX, JSON.stringify([...keys, key].slice(-50)));
}

// Bij uitloggen: niets van de vorige gebruiker op het toestel laten staan
export async function clearOffline() {
  const raw = await storage.getItem<string | null>(INDEX, null);
  const keys: string[] = raw ? JSON.parse(raw) : [];
  await Promise.all([...keys, INDEX].map((k) => storage.removeItem(k)));
}

export function offlineText(at?: string) {
  if (!at) return null;
  const d = new Date(at);
  return `Geen internet: je ziet de lijst van ${d.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" })} om ${d.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}.`;
}
