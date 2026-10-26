import { useQuery, useQueryClient } from "@tanstack/react-query";

import { storage } from "@/src/utils/storage";

// Allergieën en dieet: blijven alleen op dit apparaat (gezondheidsgegevens sturen we niet naar de server)
const STORAGE_KEY = "diet_prefs";

type Rule = { key: string; label: string; re: RegExp; not?: RegExp };

const MEAT = /kip|gehakt|worst|spek|\bham\b|bacon|biefstuk|varken|rund|kalkoen|kalfs|\blams?\b|burger|schnitzel|shoarma|gyros|saucijs|slavink|frikandel|kroket|salami|chorizo|pancetta|prosciutto|filet americain|ossenhaas|entrecote|steak|stoofvlees|riblap|sukade|vlees|karbonade|speklap|gelatine/;
const FISH = /\bvis\b|visstick|zalm|tonijn|kabeljauw|pangasius|koolvis|tilapia|kibbeling|lekkerbek|makreel|haring|ansjovis|surimi|forel|sardine|schol|vissaus/;
const SHELL = /garnaal|garnalen|kreeft|krab|mossel|inktvis|calamar|scampi|oester|rivierkreeft/;
const MILK = /melk|kaas|boter|\broom\b|slagroom|kookroom|zure room|yoghurt|kwark|\bvla\b|cr[eè]me fra[iî]che|mozzarella|parmez|feta|mascarpone|ricotta|brie|camembert|\bijs\b|chocola|wei\b|lactose/;
const MILK_NOT = /lactosevrij|plantaardig|vegan|haver|soja|amandel|kokos|rijstmelk|pindakaas|notenboter|pindaboter|margarine|cacaoboter|\bbak en braad\b/;
const EGG = /\bei\b|eieren|eidooier|eiwit|mayonaise|\bmayo\b|scharrelei|omelet|advocaat|meringue|eiersalade/;
const VEGA_OK = /vega|vegetari|plantaardig|vegan|veggie|tofu|tempeh|seitan|falafel|groenteburger|vleesvervang|vleestomaat|bouillon/;

export const DIET_RULES: Rule[] = [
  { key: "gluten", label: "Gluten", re: /tarwe|spelt|rogge|gerst|\bmeel\b|bloem\b|paneermeel|brood|stokbrood|pasta|spaghetti|macaroni|penne|fusilli|tagliatelle|lasagne|noedel|\bmie\b|couscous|bulgur|beschuit|cracker|wrap|tortilla|pizza|croissant|koek|cake|taart|pannenkoek|poffertje|bier\b|seitan|crouton|tosti|bolletje|pita|naan|ontbijtkoek|cornflakes|muesli|granola|havermout/, not: /glutenvrij|bloemkool|zonnebloem|maisbloem|rijstbloem|rijstnoedel|rijstwafel|maistortilla/ },
  { key: "melk", label: "Melk (lactose)", re: MILK, not: MILK_NOT },
  { key: "ei", label: "Ei", re: EGG, not: /eivrij|vegan/ },
  { key: "noten", label: "Noten", re: /noot|noten|amandel|cashew|pistache|pecan|macadamia|nutella|marsepein|praline|hazelnoot/, not: /kokosnoot|nootmuskaat|notenvrij/ },
  { key: "pinda", label: "Pinda", re: /pinda|sat[eé]saus|sat[eé]\b|apenoot|borrelnoot/ },
  { key: "soja", label: "Soja", re: /soja|tofu|tempeh|edamame|ketjap|teriyaki|miso/ },
  { key: "vis", label: "Vis", re: FISH },
  { key: "schaal", label: "Schaal- en weekdieren", re: SHELL },
  { key: "selderij", label: "Selderij", re: /selderij|selder\b/ },
  { key: "mosterd", label: "Mosterd", re: /mosterd/ },
  { key: "sesam", label: "Sesam", re: /sesam|tahin|hummus/ },
];

export const DIETS: Rule[] = [
  { key: "vegetarisch", label: "Vegetarisch", re: new RegExp(`${MEAT.source}|${FISH.source}|${SHELL.source}`), not: VEGA_OK },
  { key: "veganistisch", label: "Veganistisch", re: new RegExp(`${MEAT.source}|${FISH.source}|${SHELL.source}|${MILK.source}|${EGG.source}|honing`), not: new RegExp(`${VEGA_OK.source}|${MILK_NOT.source}`) },
];

const ALL = [...DIETS, ...DIET_RULES];

const norm = (s: string) => s.toLowerCase().normalize("NFC");

export function ruleHits(rule: Rule, name: string) {
  const n = norm(name);
  return rule.re.test(n) && !(rule.not && rule.not.test(n));
}

// Welke van jouw allergieën/dieet botsen met deze ingrediënten (labels, in vaste volgorde)
export function dietConflicts(ingredients: { name: string }[] | undefined, selected: string[]): string[] {
  if (!selected.length || !ingredients?.length) return [];
  return ALL.filter((r) => selected.includes(r.key) && ingredients.some((i) => ruleHits(r, i.name || ""))).map((r) =>
    r.key === "vegetarisch" || r.key === "veganistisch" ? `niet ${r.label.toLowerCase()}` : r.label.toLowerCase(),
  );
}

export function useDiet() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["diet-prefs"],
    queryFn: async () => {
      const raw = await storage.getItem<string>(STORAGE_KEY, "");
      return raw ? raw.split(",").filter(Boolean) : [];
    },
    staleTime: Infinity,
  });
  const selected = data ?? [];
  const toggle = (key: string) => {
    const next = selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key];
    qc.setQueryData(["diet-prefs"], next);
    storage.setItem(STORAGE_KEY, next.join(","));
  };
  return { selected, toggle };
}
