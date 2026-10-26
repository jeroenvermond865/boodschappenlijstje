// Stuk kaas of vleeswaren per gewicht: hoeveel plakjes en broodjes haal je eruit?
// Zelfde gewichten als op de server: een plak kaas ~20 gram, een plak vleeswaren ~15 gram.
import { norm } from "@/src/smartSearch";

const CHEESE = /kaas|gouda|zaanlander|leerdammer|beemster|maasdammer|old amsterdam|edammer|goudse|jong belegen|belegen|oude kaas/;
const MEAT = /ham|achterham|kipfilet|rookvlees|salami|cervelaat|boterhamworst|pastrami|rosbief|kalkoenfilet|leverworst|filet americain/;

export function sliceInfo(name: string, unit: string, perSandwich = 1): { slices: number; sandwiches: number; grams: number; kind: "kaas" | "vleeswaren" } | null {
  const n = norm(name);
  const kind = CHEESE.test(n) ? "kaas" : MEAT.test(n) ? "vleeswaren" : null;
  if (!kind) return null;
  if (/plak|plakken|plakjes|geraspt|blokjes|smeer|spread|salade/.test(n)) return null; // al gesneden of geen stuk
  const m = (unit ?? "").toLowerCase().match(/(?:(\d+)\s*x\s*)?(\d+(?:[.,]\d+)?)\s*(kg|kilo|gram|gr|g)\b/);
  if (!m) return null;
  const grams = parseFloat(m[2].replace(",", ".")) * (m[1] ? parseInt(m[1], 10) : 1) * (m[3] === "kg" || m[3] === "kilo" ? 1000 : 1);
  const per = kind === "kaas" ? 20 : 15;
  if (grams < per * 3) return null;
  const slices = Math.floor(grams / per);
  return { slices, sandwiches: Math.floor(slices / perSandwich), grams, kind };
}
