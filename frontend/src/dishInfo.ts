import type { Dish } from "@/app/(tabs)/dishes";

const RECIPE_STORES: Record<string, string> = { ah: "Albert Heijn", jumbo: "Jumbo", dirk: "Dirk" };

// Waar een gerecht vandaan komt: recept van een supermarkt, een app-gerecht, gemaakt met de slimme hulp of je eigen gerecht
export function dishOrigin(d: Pick<Dish, "is_standard" | "source" | "owner_id" | "camp_id">, me?: string | null, forList = "dit lijstje") {
  const src = d.source;
  const store = src?.store ? RECIPE_STORES[src.store] ?? src.store : src?.recipe_id ? RECIPE_STORES[src.recipe_id.split(/[-:]/)[0]] : undefined;
  const base = store
    ? { label: `Recept van ${store}`, icon: "storefront-outline" }
    : src?.ai
      ? { label: src.url ? "Recept van internet (slimme hulp)" : "Gemaakt met de slimme hulp", icon: "creation" }
      : d.is_standard
        ? { label: "App-gerecht", icon: "silverware-fork-knife" }
        : !d.owner_id || d.owner_id === me
          ? { label: "Eigen gerecht", icon: "account-outline" }
          : { label: "Gerecht van een ander", icon: "account-multiple-outline" };
  return d.camp_id ? { ...base, label: `${base.label} · aangepast voor ${forList}` } : base;
}
