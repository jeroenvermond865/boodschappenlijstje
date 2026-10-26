// Slim zoeken in lijsten in de app (gerechten, folders): andere woorden voor hetzelfde en kleine tikfouten.
// Dezelfde woordgroepen als op de server (_SEARCH_GROUPS in backend/server.py).
const GROUPS = [
  "kerrie curry currie",
  "courgette zucchini",
  "aubergine eggplant",
  "kip chicken kipfilet",
  "rundvlees beef rund",
  "varkensvlees pork varken",
  "gehakt mince minced",
  "kaas cheese",
  "melk milk",
  "brood bread",
  "rijst rice",
  "noedels noodles mie",
  "ei eieren egg eggs",
  "aardappel aardappelen potato potatoes piepers",
  "ui uien onion onions",
  "knoflook garlic",
  "tomaat tomaten tomato tomatoes",
  "champignon champignons mushroom mushrooms paddenstoelen",
  "room cream slagroom",
  "boter butter roomboter",
  "suiker sugar",
  "bloem meel flour",
  "olie oil",
  "chips crisps",
  "koffie coffee",
  "thee tea",
  "bier beer",
  "wijn wine",
  "sap juice",
  "appel appels apple apples",
  "banaan bananen banana bananas",
  "sinaasappel sinaasappels jus orange oranges",
  "citroen lemon",
  "limoen lime",
  "aardbei aardbeien strawberry strawberries",
  "chocolade chocola chocolate choco",
  "ijs icecream roomijs",
  "yoghurt yogurt joghurt",
  "worst sausage worstjes",
  "spek bacon",
  "tonijn tuna",
  "zalm salmon",
  "garnalen shrimp prawns scampi",
  "spinazie spinach",
  "wortel wortels peen carrot carrots",
  "komkommer cucumber",
  "sla lettuce",
  "kool cabbage",
  "bonen beans",
  "erwten peas doperwten",
  "mais corn",
  "pindakaas peanutbutter",
  "honing honey",
  "havermout oats",
  "saus sauce",
  "mayonaise mayo",
  "mosterd mustard",
  "sojasaus ketjap soy",
  "azijn vinegar",
  "zout salt",
  "peper pepper",
  "kaneel cinnamon",
  "gember ginger",
  "koriander coriander cilantro",
  "basilicum basil",
  "peterselie parsley",
  "toiletpapier wcpapier",
  "luiers diapers",
  "afwasmiddel dishsoap",
  "wasmiddel detergent",
  "tandpasta toothpaste",
  "frisdrank soda cola",
  "water spa",
  "pannenkoek pannenkoeken pancake pancakes",
  "taart cake",
  "koek koekjes cookies biscuits",
  "hagelslag sprinkles",
  "drop licorice",
  "snoep candy",
  "patat friet frietjes fries",
  "kalkoen turkey",
  "lam lamb lamsvlees",
  "vis fish",
  "ham",
  "salami",
  "paprika paprikas bellpepper",
  "pompoen pumpkin",
  "prei leek",
  "selderij bleekselderij celery",
  "radijs radish",
  "biet bieten bietjes beetroot",
  "peer peren pear",
  "druif druiven grapes",
  "ananas pineapple",
  "mango",
  "kokos coconut kokosmelk",
  "noten nuts",
  "amandel amandelen almond almonds",
  "pinda pindas peanuts",
  "cashew cashewnoten",
  "walnoot walnoten walnuts",
  "gnocchi",
  "lasagne lasagna",
  "macaroni",
  "spaghetti",
  "tortilla wraps wrap",
];

const SYN: Record<string, string[]> = {};
for (const g of GROUPS) {
  const ws = g.split(" ");
  for (const w of ws) SYN[w] = [...(SYN[w] ?? []), ...ws.filter((x) => x !== w && !(SYN[w] ?? []).includes(x))];
}

export const norm = (s: string) =>
  (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Hoeveel letters verschillen (ook twee omgewisselde letters tellen als één)
function dist(a: string, b: string, max: number) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

const allowed = (w: string) => (w.length >= 8 ? 2 : w.length >= 4 ? 1 : 0);

// Score voor hoe goed een tekst bij de zoekopdracht past: -1 = past niet, 0 = precies, hoger = minder goed
export function matchScore(query: string, ...texts: (string | null | undefined)[]) {
  const words = norm(query).split(" ").filter(Boolean);
  if (!words.length) return 0;
  const hay = norm(texts.filter(Boolean).join(" "));
  const hayWords = hay.split(" ");
  let total = 0;
  for (const w of words) {
    const variants = [w, ...(SYN[w] ?? [])];
    let best = -1;
    for (const v of variants) {
      const syn = v === w ? 0 : 1;
      if (hayWords.includes(v)) best = best < 0 ? syn : Math.min(best, syn);
      else if (hay.includes(v)) best = best < 0 ? 1 + syn : Math.min(best, 1 + syn);
    }
    if (best < 0 && allowed(w)) {
      for (const hw of hayWords) {
        if (hw.length >= 4 && dist(w, hw.slice(0, Math.max(w.length, Math.min(hw.length, w.length + 1))), allowed(w)) <= allowed(w)) {
          best = 3;
          break;
        }
      }
    }
    if (best < 0) return -1;
    total += best;
  }
  return total;
}

// Filter en sorteer: beste treffers bovenaan
export function smartFilter<T>(list: T[], query: string, text: (item: T) => (string | null | undefined)[]): T[] {
  if (!norm(query)) return list;
  return list
    .map((item, i) => ({ item, i, s: matchScore(query, ...text(item)) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .map((x) => x.item);
}
