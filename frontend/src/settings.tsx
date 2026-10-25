import { useQuery } from "@tanstack/react-query";

import { api } from "@/src/api";

export type AppSettings = {
  app_name: string;
  tagline: string;
  hero_url: string;
  logo_url: string;
  tab_camps: string;
  term_one: string;
  tab_dishes: string;
  tab_products: string;
  tab_account: string;
  sub_camps: string;
  sub_dishes: string;
  sub_products: string;
  sub_account: string;
};

const DEFAULTS: AppSettings = {
  app_name: "Boodschappenlijstje",
  tagline: "Plan maaltijden en boodschappen per kampdag",
  hero_url: "",
  logo_url: "",
  tab_camps: "Kampen",
  term_one: "",
  tab_dishes: "Gerechten",
  tab_products: "Producten",
  tab_account: "Account",
  sub_camps: "Jouw maaltijdplanningen",
  sub_dishes: "Beheer je gerechten",
  sub_products: "Alle producten en prijzen",
  sub_account: "Jouw profiel en instellingen",
};

export function useAppSettings() {
  const q = useQuery({
    queryKey: ["settings"],
    queryFn: () => api<AppSettings>("/settings"),
    staleTime: 60_000,
  });
  return { ...DEFAULTS, ...(q.data ?? {}) } as AppSettings;
}

// Hoe een kamp in deze app heet (instelbaar bij Beheer → App): "Kampen"/"Kamp" of bijv. "Activiteiten"/"Activiteit"
export function singularOf(many: string): string {
  const m = many.trim();
  if (/en$/.test(m) && m.length > 4) return m.slice(0, -2); // Kampen -> Kamp, Activiteiten -> Activiteit
  if (/s$/.test(m) && m.length > 3) return m.slice(0, -1); // Weekends -> Weekend
  return m;
}

const HET_WORDS = /(kamp|weekend|evenement|uitje|feest|project|programma|festival|reisje|toernooi|kampement|weekeinde)$/;

export function useTerms() {
  const s = useAppSettings();
  const Many = s.tab_camps?.trim() || "Kampen";
  const One = s.term_one?.trim() || singularOf(Many);
  const one = One.toLowerCase();
  const het = HET_WORDS.test(one);
  // Lidwoord en bijvoeglijk naamwoord: "het kamp / nieuw kamp", "de activiteit / nieuwe activiteit"
  return { One, Many, one, many: Many.toLowerCase(), de: het ? "het" : "de", deze: het ? "dit" : "deze", nieuw: het ? "nieuw" : "nieuwe" };
}
