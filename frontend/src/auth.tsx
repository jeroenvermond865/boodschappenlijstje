import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";

import { api, setAuthToken } from "@/src/api";
import { storage } from "@/src/utils/storage";
import { cachedApi, clearOffline } from "@/src/offline";

WebBrowser.maybeCompleteAuthSession();

const TOKEN_KEY = "scoutkook_token";
const REF_KEY = "ref_code";

export type User = {
  id: string;
  email: string;
  name: string;
  username?: string | null;
  phone?: string | null;
  picture?: string | null;
  role: string;
  store?: string;
  email_opt_out?: boolean;
  terms_ok?: boolean;
  onboarded?: boolean;
  whatsnew_seen?: string | null;
  has_password?: boolean;
  no_personal?: boolean;
  premium?: boolean;
  premium_welcome?: boolean;
  premium_org?: string | null;
  premium_until?: string | null;
};
type Status = "loading" | "authed" | "guest";

type AuthContextType = {
  status: Status;
  user: User | null;
  permissions: string[];
  has: (perm: string) => boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string, acceptTerms: boolean) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const exchanged = useRef<Set<string>>(new Set());

  const loadMe = useCallback(async () => {
    const res = await cachedApi<{ user: User; permissions: string[] }>("/auth/me");
    setUser(res.user);
    setPermissions(res.permissions ?? []);
    setStatus("authed");
  }, []);

  const persist = useCallback(
    async (token: string) => {
      setAuthToken(token);
      await storage.secureSet(TOKEN_KEY, token);
      await loadMe();
    },
    [loadMe],
  );

  const exchangeSessionId = useCallback(
    async (sessionId: string) => {
      if (exchanged.current.has(sessionId)) return;
      exchanged.current.add(sessionId);
      const res = await api<{ session_token: string }>("/auth/session", {
        method: "POST",
        body: { session_id: sessionId },
      });
      await persist(res.session_token);
    },
    [persist],
  );

  // Via iemands deel-link binnengekomen (?ref=CODE): onthouden, en na het inloggen doorgeven
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const ref = url.searchParams.get("ref");
    if (!ref) return;
    storage.setItem(REF_KEY, ref.slice(0, 12));
    url.searchParams.delete("ref");
    window.history.replaceState(window.history.state, "", url.toString());
  }, []);
  useEffect(() => {
    if (status !== "authed") return;
    (async () => {
      const ref = await storage.getItem<string | null>(REF_KEY, null);
      if (!ref) return;
      await api("/referral/claim", { method: "POST", body: { code: ref } }).catch(() => {});
      await storage.removeItem(REF_KEY);
    })();
  }, [status]);

  useEffect(() => {
    (async () => {
      if (Platform.OS === "web" && typeof window !== "undefined") {
        const raw = window.location.href;
        const m = raw.match(/[?#&]session_id=([^&#]+)/);
        if (m) {
          try {
            await exchangeSessionId(decodeURIComponent(m[1]));
            const url = new URL(window.location.href);
            url.hash = "";
            url.searchParams.delete("session_id");
            window.history.replaceState(window.history.state, "", url.toString());
            return;
          } catch {
            // fall through
          }
        }
      }

      const token = await storage.secureGet<string | null>(TOKEN_KEY, null);
      if (!token) {
        setStatus("guest");
        return;
      }
      setAuthToken(token);
      try {
        await loadMe();
      } catch (e) {
        // Geen internet (en nog niets bewaard): niet uitloggen, alleen bij een verlopen of ongeldige sessie
        if (!(e as { status?: number })?.status) {
          setStatus("guest");
          return;
        }
        setAuthToken(null);
        await storage.secureRemove(TOKEN_KEY);
        setStatus("guest");
      }
    })();
  }, [exchangeSessionId, loadMe]);

  const login = useCallback(
    async (identifier: string, password: string) => {
      const res = await api<{ session_token: string }>("/auth/login", {
        method: "POST",
        body: { identifier, password },
      });
      await persist(res.session_token);
    },
    [persist],
  );

  const register = useCallback(
    async (name: string, email: string, password: string, acceptTerms: boolean) => {
      const res = await api<{ session_token: string }>("/auth/register", {
        method: "POST",
        body: { name, email, password, accept_terms: acceptTerms },
      });
      await persist(res.session_token);
    },
    [persist],
  );

  const loginWithGoogle = useCallback(async () => {
    const redirectUrl =
      Platform.OS === "web" && typeof window !== "undefined"
        ? window.location.origin + "/"
        : Linking.createURL("");
    const base =
      Platform.OS === "web" && typeof window !== "undefined"
        ? window.location.origin
        : process.env.EXPO_PUBLIC_BACKEND_URL ?? "";
    const authUrl = `${base}/api/auth/google/start?redirect=${encodeURIComponent(redirectUrl)}`;

    if (Platform.OS === "web") {
      window.location.href = authUrl;
      return;
    }

    let captured: string | null = null;
    const sub = Linking.addEventListener("url", (e) => {
      if (e.url) captured = e.url;
    });
    try {
      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
      let url: string | null = result.type === "success" ? result.url : null;
      if (!url) url = captured;
      if (!url) url = await Linking.getInitialURL();
      if (!url) throw new Error("Inloggen geannuleerd");
      const m = url.match(/[?#&]session_id=([^&#]+)/);
      if (!m) throw new Error("Geen sessie ontvangen");
      await exchangeSessionId(decodeURIComponent(m[1]));
    } finally {
      sub.remove();
    }
  }, [exchangeSessionId]);

  const logout = useCallback(async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {
      // ignore
    }
    setAuthToken(null);
    await storage.secureRemove(TOKEN_KEY);
    await clearOffline();
    setUser(null);
    setPermissions([]);
    setStatus("guest");
  }, []);

  const has = useCallback((perm: string) => permissions.includes(perm), [permissions]);

  return (
    <AuthContext.Provider
      value={{ status, user, permissions, has, login, register, loginWithGoogle, logout, refresh: loadMe }}
    >
      {children}
    </AuthContext.Provider>
  );
}
