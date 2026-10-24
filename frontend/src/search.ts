// Zoeken op naam met de beste treffers bovenaan: "melk" geeft eerst melk,
// dan bijv. karnemelk, en pas daarna melkchocolade of koekjes met melk.

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9%.,]+/g, " ")
    .trim();
}

function termScore(name: string, words: string[], term: string): number {
  if (name === term) return 0;
  if (name.startsWith(term + " ")) return 1;
  if (words.includes(term)) return 2;
  if (words.some((w) => w.endsWith(term))) return 3; // samenstelling: karnemelk
  if (name.startsWith(term)) return 4;
  if (words.some((w) => w.startsWith(term))) return 5; // melkchocolade
  if (name.includes(term)) return 6;
  return -1;
}

export function searchSorted<T>(list: T[], query: string, getName: (item: T) => string): T[] {
  const terms = normalize(query).split(" ").filter(Boolean);
  if (terms.length === 0) return list;
  const scored: { item: T; score: number; len: number; name: string }[] = [];
  for (const item of list) {
    const name = normalize(getName(item));
    const words = name.split(" ");
    let score = 0;
    let ok = true;
    for (const t of terms) {
      const s = termScore(name, words, t);
      if (s < 0) {
        ok = false;
        break;
      }
      score += s;
    }
    if (ok) scored.push({ item, score, len: name.length, name });
  }
  scored.sort((a, b) => a.score - b.score || a.len - b.len || a.name.localeCompare(b.name));
  return scored.map((s) => s.item);
}
