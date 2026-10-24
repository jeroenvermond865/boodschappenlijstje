export type MealCategory = "ontbijt" | "lunch" | "avondeten" | "snacks";

export const MEAL_CATEGORIES: MealCategory[] = ["ontbijt", "lunch", "avondeten", "snacks"];

export const CATEGORY_LABELS: Record<MealCategory, string> = {
  ontbijt: "Ontbijt",
  lunch: "Lunch",
  avondeten: "Avondeten",
  snacks: "Snacks",
};

export const CATEGORY_ICONS: Record<MealCategory, string> = {
  ontbijt: "coffee-outline",
  lunch: "food-apple-outline",
  avondeten: "silverware-fork-knife",
  snacks: "cookie-outline",
};

export const UNITS = ["stuks", "gram", "kg", "ml", "liter", "plak", "pak", "blik", "pot", "fles", "zak", "krat", "bak", "bos"];

export const STORES = ["Albert Heijn", "Jumbo", "Lidl", "Aldi", "Plus", "Dirk", "Overig"];

export const AISLES = [
  "Aardappelen, groente & fruit",
  "Vlees & vis",
  "Brood, beleg & koek",
  "Zuivel & kaas",
  "Dranken, sap, koffie & thee",
  "Voorraadkast",
  "Maaltijden, salades & tapas",
  "Diepvries",
  "Huishoud & huisdieren",
  "Kind & drogisterij",
  "Non food",
  "Snacks & snoep",
  "Overig",
];

export const AISLE_ICONS: Record<string, string> = {
  "Aardappelen, groente & fruit": "carrot",
  "Vlees & vis": "food-steak",
  "Brood, beleg & koek": "baguette",
  "Zuivel & kaas": "cheese",
  "Dranken, sap, koffie & thee": "bottle-soda-classic-outline",
  Voorraadkast: "package-variant-closed",
  "Maaltijden, salades & tapas": "bowl-mix-outline",
  Diepvries: "snowflake",
  "Huishoud & huisdieren": "spray-bottle",
  "Kind & drogisterij": "baby-face-outline",
  "Non food": "lightbulb-outline",
  "Snacks & snoep": "cookie",
  Overig: "cart-outline",
};

export function formatQty(n: number): string {
  if (n == null || isNaN(n)) return "0";
  return Number.isInteger(n) ? String(n) : String(parseFloat(Number(n).toFixed(2)));
}
