import { useQuery } from "@tanstack/react-query";

import { api } from "@/src/api";

export type AppSettings = {
  app_name: string;
  tagline: string;
  hero_url: string;
  logo_url: string;
  tab_camps: string;
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
