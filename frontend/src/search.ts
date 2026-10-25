import { useEffect, useState } from "react";

import { api } from "@/src/api";
import type { Product } from "@/app/(tabs)/products";

// Zoeken gebeurt op de server (beste treffers bovenaan); hier alleen een korte vertraging
// zodat niet bij elke toetsaanslag een aanvraag de deur uit gaat.
export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export type ProductPage = {
  products: Product[];
  total: number;
  next_offset: number | null;
  aisle_counts: Record<string, number>;
  facets?: Facet[];
};

export type Facet = {
  key: "sub" | "brand" | "offer" | "bio";
  label: string;
  options?: { value: string; count: number }[];
  count?: number;
};

export type ProductFilters = {
  sub: string[];
  brand: string[];
  offer: boolean;
  bio: boolean;
  sort: "" | "price_asc" | "price_desc" | "unit_asc" | "name";
};

export const NO_FILTERS: ProductFilters = { sub: [], brand: [], offer: false, bio: false, sort: "" };

export function countFilters(f: ProductFilters) {
  return f.sub.length + f.brand.length + (f.offer ? 1 : 0) + (f.bio ? 1 : 0) + (f.sort ? 1 : 0);
}

export function fetchProducts(params: {
  q?: string;
  source?: string;
  aisle?: string;
  favorites?: boolean;
  filters?: ProductFilters;
  offset?: number;
  limit?: number;
}) {
  const qs: string[] = [];
  const add = (k: string, v: string) => qs.push(`${k}=${encodeURIComponent(v)}`);
  if (params.q?.trim()) add("q", params.q.trim());
  if (params.source) add("source", params.source);
  if (params.aisle) add("aisle", params.aisle);
  if (params.favorites) add("favorites", "true");
  const f = params.filters;
  if (f) {
    if (f.sub.length) add("sub", f.sub.join("|"));
    if (f.brand.length) add("brand", f.brand.join("|"));
    if (f.offer) add("offer", "true");
    if (f.bio) add("bio", "true");
    if (f.sort) add("sort", f.sort);
  }
  add("offset", String(params.offset ?? 0));
  add("limit", String(params.limit ?? 50));
  return api<ProductPage>(`/products/search?${qs.join("&")}`);
}
