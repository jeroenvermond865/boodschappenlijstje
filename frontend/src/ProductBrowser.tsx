import { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Image, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { EmptyState, Icon } from "@/src/components/ui";
import { api } from "@/src/api";
import { countFilters, euro, fetchProducts, NO_FILTERS, useDebounced } from "@/src/search";
import type { Facet, ProductFilters } from "@/src/search";
import { AISLES, AISLE_ICONS } from "@/src/constants";
import { fonts, makeStyles, useTheme } from "@/src/theme";

export type Product = {
  id: string;
  name: string;
  aisle: string;
  unit: string;
  brand?: string | null;
  barcode?: string | null;
  prices: Record<string, number>;
  unavailable?: string[];
  price: number;
  unavailable_here?: boolean;
  is_global: boolean;
  is_own: boolean;
  source?: "Dirk" | "Albert Heijn" | "Jumbo" | null;
  image?: string | null;
  is_favorite?: boolean;
  subcategory?: string | null;
  on_offer?: boolean;
  unit_price?: string | null;
  promo?: Promo | null;
  promo_next?: Promo | null;
};

export type Promo = {
  label: string;
  title?: string;
  start?: string | null;
  end?: string | null;
  period?: string | null;
  price?: number | null;
  regular?: number | null;
  deal?: { count: number; total: number; each: number } | null;
  combinable?: boolean;
  note?: string | null;
};

const SORTS: { key: ProductFilters["sort"]; label: string }[] = [
  { key: "", label: "Beste treffers" },
  { key: "price_asc", label: "Prijs laag-hoog" },
  { key: "price_desc", label: "Prijs hoog-laag" },
  { key: "unit_asc", label: "Kilo/literprijs laag-hoog" },
  { key: "unit_desc", label: "Kilo/literprijs hoog-laag" },
  { key: "name", label: "Naam A-Z" },
];

const STORE_FILTERS = [
  { key: "all", label: "Alle producten" },
  { key: "Dirk", label: "Dirk" },
  { key: "Albert Heijn", label: "Albert Heijn" },
  { key: "Jumbo", label: "Jumbo" },
] as const;

// Zoeken, filteren en bladeren door producten. Gebruikt door de Producten-pagina én overal waar je een product kiest
// (gerecht maken, losse spullen), zodat verbeteringen aan zoeken overal tegelijk gelden.
export function ProductBrowser({
  onPick,
  header,
  bottomPadding = 96,
  pickedIds,
}: {
  onPick?: (p: Product) => void;
  header?: ReactNode;
  bottomPadding?: number;
  pickedIds?: string[];
}) {
  const styles = useStyles();
  const { colors } = useTheme();

  const [search, setSearch] = useState("");
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const qc = useQueryClient();
  const [aisle, setAisle] = useState<string>("all");
  const [storeFilter, setStoreFilter] = useState<"all" | "Dirk" | "Albert Heijn" | "Jumbo">("all");
  const [storeOpen, setStoreOpen] = useState(false);
  const [filters, setFilters] = useState<ProductFilters>(NO_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const router = useRouter();
  const nFilters = countFilters(filters);
  // Bladeren zoals bij recepten: eerst een afdeling, dan een soort, dan pas de producten. Zoeken of filteren toont meteen de lijst.
  const [allInAisle, setAllInAisle] = useState(false);

  const debouncedSearch = useDebounced(search);
  const queryKey = ["products", "search", storeFilter, aisle, onlyFavorites, debouncedSearch.trim(), filters];
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey,
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      fetchProducts({
        q: debouncedSearch,
        source: storeFilter === "all" ? "" : storeFilter,
        aisle: aisle === "all" ? "" : aisle,
        favorites: onlyFavorites,
        filters,
        offset: pageParam,
        limit: 50,
      }),
    getNextPageParam: (last) => last.next_offset ?? undefined,
    placeholderData: (prev) => prev,
  });

  const filtered = useMemo(() => (data?.pages ?? []).flatMap((pg) => pg.products), [data]);
  const aisleCounts = data?.pages[0]?.aisle_counts ?? {};
  const browsing = !debouncedSearch.trim() && !onlyFavorites && !filters.brand.length && !filters.offer && !filters.bio;
  const mode: "cats" | "subs" | "list" = !browsing ? "list" : aisle === "all" ? "cats" : !filters.sub.length && !allInAisle ? "subs" : "list";
  const subOptions = (data?.pages[0]?.facets ?? []).find((f) => f.key === "sub")?.options ?? [];
  const goAisle = (a: string) => {
    setAisle(a);
    setAllInAisle(false);
    setFilters((x) => ({ ...x, sub: [] }));
  };
  const facets = data?.pages[0]?.facets ?? [];
  const total = data?.pages[0]?.total;

  const toggleFavorite = useMutation({
    mutationFn: (p: Product) => api(`/products/${p.id}/favorite`, { method: p.is_favorite ? "DELETE" : "POST" }),
    onMutate: (p: Product) => {
      // Direct bijwerken, zonder te wachten op de server
      qc.setQueriesData({ queryKey: ["products", "search"] }, (old: any) =>
        old?.pages
          ? {
              ...old,
              pages: old.pages.map((pg: any) => ({
                ...pg,
                products: pg.products.map((x: Product) => (x.id === p.id ? { ...x, is_favorite: !p.is_favorite } : x)),
              })),
            }
          : old,
      );
    },
    onSettled: (_r, _e, p) => {
      if (onlyFavorites || !p) qc.invalidateQueries({ queryKey: ["products", "search"] });
    },
    onError: () => qc.invalidateQueries({ queryKey: ["products", "search"] }),
  });

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.header}>
        {header}
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Pressable testID="store-selector" onPress={() => setStoreOpen((v) => !v)} style={styles.storeRow}>
            <Icon name="storefront-outline" size={16} color={colors.brandPrimary} />
            <Text style={styles.storeText}>{STORE_FILTERS.find((f) => f.key === storeFilter)?.label}</Text>
            <Icon name={storeOpen ? "chevron-up" : "chevron-down"} size={16} color={colors.brandPrimary} />
          </Pressable>
          {onPick ? null : (
          <Pressable
            testID="open-folders"
            onPress={() => router.push(`/folders?store=${encodeURIComponent(storeFilter === "all" ? "Albert Heijn" : storeFilter)}`)}
            style={styles.folderBtn}
          >
            <Icon name="newspaper-variant-outline" size={16} color={colors.brandPrimary} />
            <Text style={styles.storeText}>Folders</Text>
          </Pressable>
          )}
        </View>
        {storeOpen ? (
          <View style={styles.storeMenu}>
            {STORE_FILTERS.map((f) => (
              <Pressable
                key={f.key}
                testID={`product-store-${f.key}`}
                onPress={() => {
                  setStoreFilter(f.key);
                  setAisle("all");
                  setFilters((x) => ({ ...x, sub: [], brand: [] }));
                  setStoreOpen(false);
                }}
                style={styles.storeMenuItem}
              >
                <Text style={[styles.storeMenuText, storeFilter === f.key && styles.storeMenuTextActive]}>{f.label}</Text>
                {storeFilter === f.key ? <Icon name="check" size={16} color={colors.brandPrimary} /> : null}
              </Pressable>
            ))}
          </View>
        ) : null}
        <View style={styles.searchBox}>
          <Icon name="magnify" size={20} color={colors.muted} />
          <TextInput
            testID="product-search"
            placeholder="Zoek product"
            placeholderTextColor={colors.muted}
            value={search}
            onChangeText={setSearch}
            style={styles.searchInput}
          />
        </View>
        <View style={styles.toggleRow}>
          <Pressable
            testID="product-favorites-toggle"
            onPress={() => setOnlyFavorites((v) => !v)}
            style={[styles.favToggle, onlyFavorites && styles.favToggleActive]}
          >
            <Icon name={onlyFavorites ? "star" : "star-outline"} size={16} color={onlyFavorites ? colors.onBrandPrimary : colors.brandPrimary} />
            <Text style={[styles.favToggleText, onlyFavorites && styles.favToggleTextActive]}>Mijn favorieten</Text>
          </Pressable>
          <Pressable
            testID="product-filters-open"
            onPress={() => setFiltersOpen(true)}
            style={[styles.favToggle, nFilters > 0 && styles.favToggleActive]}
          >
            <Icon name="tune-variant" size={16} color={nFilters > 0 ? colors.onBrandPrimary : colors.brandPrimary} />
            <Text style={[styles.favToggleText, nFilters > 0 && styles.favToggleTextActive]}>
              Filters{nFilters > 0 ? ` (${nFilters})` : ""}
            </Text>
          </Pressable>
          {nFilters > 0 ? (
            <Pressable testID="product-filters-clear" onPress={() => setFilters(NO_FILTERS)} hitSlop={8}>
              <Text style={styles.clearText}>Wissen</Text>
            </Pressable>
          ) : null}
        </View>
        {browsing ? (
          <View style={styles.crumbs}>
            <Pressable testID="crumb-all" onPress={() => goAisle("all")} hitSlop={6}>
              <Text style={[styles.crumb, mode === "cats" && styles.crumbActive]}>Alle afdelingen</Text>
            </Pressable>
            {aisle !== "all" ? (
              <>
                <Icon name="chevron-right" size={16} color={colors.muted} />
                <Pressable
                  testID="crumb-aisle"
                  onPress={() => {
                    setAllInAisle(false);
                    setFilters((x) => ({ ...x, sub: [] }));
                  }}
                  hitSlop={6}
                >
                  <Text style={[styles.crumb, mode === "subs" && styles.crumbActive]} numberOfLines={1}>{aisle}</Text>
                </Pressable>
              </>
            ) : null}
            {mode === "list" ? (
              <>
                <Icon name="chevron-right" size={16} color={colors.muted} />
                <Text style={[styles.crumb, styles.crumbActive, { flexShrink: 1 }]} numberOfLines={1}>
                  {filters.sub.length ? filters.sub.join(", ") : "Alles"}
                </Text>
              </>
            ) : null}
          </View>
        ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.deptRow}>
          <Pressable testID="dept-all" onPress={() => goAisle("all")} style={[styles.deptChip, aisle === "all" && styles.deptChipActive]}>
            <Text style={[styles.deptText, aisle === "all" && styles.deptTextActive]}>Alle afdelingen</Text>
          </Pressable>
          {AISLES.filter((a) => (aisleCounts[a] ?? 0) > 0).map((a) => (
            <Pressable key={a} testID={`dept-${a}`} onPress={() => goAisle(a)} style={[styles.deptChip, aisle === a && styles.deptChipActive]}>
              <Icon name={(AISLE_ICONS[a] ?? "cart-outline") as any} size={14} color={aisle === a ? colors.onBrandPrimary : colors.brandPrimary} />
              <Text style={[styles.deptText, aisle === a && styles.deptTextActive]}>{a}</Text>
            </Pressable>
          ))}
        </ScrollView>
        )}
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.brandPrimary} />
        </View>
      ) : mode === "cats" ? (
        <FlatList
          key="cats"
          data={AISLES.filter((a) => (aisleCounts[a] ?? 0) > 0)}
          keyExtractor={(a) => a}
          numColumns={2}
          columnWrapperStyle={{ gap: 10 }}
          contentContainerStyle={{ padding: 16, paddingTop: 8, paddingBottom: bottomPadding, gap: 10 }}
          renderItem={({ item: a }) => (
            <Pressable testID={`cat-${a}`} onPress={() => goAisle(a)} style={({ pressed }) => [styles.tile, pressed && { opacity: 0.85 }]}>
              <View style={styles.tileIcon}>
                <Icon name={(AISLE_ICONS[a] ?? "cart-outline") as any} size={26} color={colors.brandPrimary} />
              </View>
              <Text style={styles.tileTitle} numberOfLines={2}>{a}</Text>
              <Text style={styles.tileCount}>{aisleCounts[a]} producten</Text>
            </Pressable>
          )}
        />
      ) : mode === "subs" ? (
        <FlatList
          key="subs"
          data={[{ value: "", count: aisleCounts[aisle] ?? 0, image: null }, ...subOptions]}
          keyExtractor={(o) => o.value || "__all"}
          numColumns={2}
          columnWrapperStyle={{ gap: 10 }}
          contentContainerStyle={{ padding: 16, paddingTop: 8, paddingBottom: bottomPadding, gap: 10 }}
          renderItem={({ item: o }) => (
            <Pressable
              testID={`sub-${o.value || "all"}`}
              onPress={() => (o.value ? setFilters((x) => ({ ...x, sub: [o.value] })) : setAllInAisle(true))}
              style={({ pressed }) => [styles.tile, pressed && { opacity: 0.85 }]}
            >
              {o.image ? (
                <Image source={{ uri: o.image }} style={styles.tileImage} resizeMode="contain" />
              ) : (
                <View style={styles.tileIcon}>
                  <Icon name={o.value ? ((AISLE_ICONS[aisle] ?? "cart-outline") as any) : "view-grid-outline"} size={26} color={colors.brandPrimary} />
                </View>
              )}
              <Text style={styles.tileTitle} numberOfLines={2}>{o.value || `Alles in ${aisle}`}</Text>
              <Text style={styles.tileCount}>{o.count} producten</Text>
            </Pressable>
          )}
        />
      ) : (
        <FlatList
          key="list"
          data={filtered}
          keyboardShouldPersistTaps="handled"
          keyExtractor={(p) => p.id}
          onEndReached={() => {
            if (hasNextPage && !isFetchingNextPage) fetchNextPage();
          }}
          onEndReachedThreshold={0.6}
          initialNumToRender={15}
          windowSize={7}
          ListFooterComponent={isFetchingNextPage ? <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: 8 }} /> : null}
          contentContainerStyle={{ padding: 16, paddingTop: 8, paddingBottom: bottomPadding, gap: 10 }}
          renderItem={({ item }) => (
            <Pressable
              testID={`product-row-${item.id}`}
              onPress={() => (onPick ? onPick(item) : router.push(`/product/${item.id}`))}
              style={[styles.row, pickedIds?.includes(item.id) && styles.rowPicked]}
            >
              {item.image ? (
                <Image source={{ uri: item.image }} style={styles.rowImage} resizeMode="contain" />
              ) : (
                <View style={styles.rowIcon}>
                  <Icon name={(AISLE_ICONS[item.aisle] ?? "cart-outline") as any} size={20} color={colors.brandPrimary} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {item.name}
                  {item.brand ? <Text style={styles.brand}> · {item.brand}</Text> : null}
                </Text>
                <Text style={styles.rowSub} numberOfLines={1}>
                  {item.subcategory || item.aisle} · per {item.unit}
                </Text>
              </View>
              <Pressable
                testID={`product-fav-${item.id}`}
                onPress={() => toggleFavorite.mutate(item)}
                hitSlop={10}
              >
                <Icon name={item.is_favorite ? "star" : "star-outline"} size={22} color={item.is_favorite ? "#E8A317" : colors.muted} />
              </Pressable>
              {item.unavailable_here ? (
                <Text style={styles.naPrice}>Niet verkr.</Text>
              ) : (
                <View style={{ alignItems: "flex-end", maxWidth: 110 }}>
                  {item.promo?.regular && item.promo.regular > (item.promo.price ?? item.price) ? (
                    <Text style={styles.oldPrice}>{euro(item.promo.regular)}</Text>
                  ) : null}
                  <Text style={[styles.price, item.promo && styles.promoPrice]}>
                    {(item.promo?.price ?? item.price) > 0 ? euro(item.promo?.price ?? item.price) : "—"}
                  </Text>
                  {item.unit_price ? <Text style={styles.unitTag}>{item.unit_price}</Text> : null}
                  {item.promo ? (
                    <View style={styles.promoBadge}>
                      <Text style={styles.promoBadgeText} numberOfLines={1}>{item.promo.label}</Text>
                    </View>
                  ) : item.on_offer ? (
                    <Text style={styles.offerTag}>Aanbieding</Text>
                  ) : item.promo_next ? (
                    <Text style={styles.nextTag} numberOfLines={1}>Straks: {item.promo_next.label}</Text>
                  ) : null}
                </View>
              )}
              {onPick ? <Icon name={pickedIds?.includes(item.id) ? "check-circle" : "plus-circle-outline"} size={24} color={colors.brandPrimary} /> : null}
            </Pressable>
          )}
          ListEmptyComponent={
            onlyFavorites ? (
              <EmptyState icon="star-outline" title="Nog geen favorieten" subtitle="Tik op het sterretje bij een product om het hier te bewaren." />
            ) : (
              <EmptyState icon="cart-outline" title="Geen producten" subtitle="Pas je zoekopdracht of filter aan." />
            )
          }
        />
      )}

      <FiltersSheet
        visible={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        facets={facets}
        filters={filters}
        setFilters={setFilters}
        total={total}
        aisle={aisle === "all" ? null : aisle}
      />
    </View>
  );
}

function FiltersSheet({
  visible,
  onClose,
  facets,
  filters,
  setFilters,
  total,
  aisle,
}: {
  visible: boolean;
  onClose: () => void;
  facets: Facet[];
  filters: ProductFilters;
  setFilters: (f: ProductFilters | ((x: ProductFilters) => ProductFilters)) => void;
  total?: number;
  aisle: string | null;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [showAll, setShowAll] = useState<Record<string, boolean>>({});

  const toggleIn = (key: "sub" | "brand", value: string) =>
    setFilters((x) => {
      const next = x[key].includes(value) ? x[key].filter((v) => v !== value) : [...x[key], value];
      return key === "sub" ? { ...x, sub: next } : { ...x, brand: next };
    });

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { maxHeight: "85%", paddingBottom: insets.bottom + 16 }]} onPress={() => {}}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Filters{aisle ? ` · ${aisle}` : ""}</Text>
            <Pressable testID="filters-close" onPress={onClose} hitSlop={10}>
              <Icon name="close" size={24} color={colors.onSurface} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ gap: 16, paddingBottom: 8 }}>
            <View style={{ gap: 8 }}>
              <Text style={styles.filterLabel}>Sorteren</Text>
              <View style={styles.chipWrap}>
                {SORTS.map((o) => (
                  <Pressable
                    key={o.key || "best"}
                    onPress={() => setFilters((x) => ({ ...x, sort: o.key }))}
                    style={[styles.deptChip, filters.sort === o.key && styles.deptChipActive]}
                  >
                    <Text style={[styles.deptText, filters.sort === o.key && styles.deptTextActive]}>{o.label}</Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <View style={styles.chipWrap}>
              {facets
                .filter((f) => f.key === "offer" || f.key === "bio")
                .map((f) => {
                  const on = f.key === "offer" ? filters.offer : filters.bio;
                  if (!on && !f.count) return null;
                  return (
                    <Pressable
                      key={f.key}
                      testID={`filter-${f.key}`}
                      onPress={() => setFilters((x) => (f.key === "offer" ? { ...x, offer: !on } : { ...x, bio: !on }))}
                      style={[styles.deptChip, on && styles.deptChipActive]}
                    >
                      <Icon name={f.key === "offer" ? "tag-outline" : "leaf"} size={14} color={on ? colors.onBrandPrimary : colors.brandPrimary} />
                      <Text style={[styles.deptText, on && styles.deptTextActive]}>
                        {f.label} ({f.count ?? 0})
                      </Text>
                    </Pressable>
                  );
                })}
            </View>

            {facets
              .filter((f) => (f.key === "sub" || f.key === "brand") && (f.options?.length ?? 0) > 0)
              .map((f) => {
                const key = f.key as "sub" | "brand";
                const selected = filters[key];
                const opts = f.options ?? [];
                // Gekozen waarden altijd tonen, ook als ze buiten de top vallen
                const extra = selected.filter((v) => !opts.some((o) => o.value === v)).map((v) => ({ value: v, count: 0 }));
                const all = [...extra, ...opts];
                const limit = showAll[key] ? all.length : 16;
                return (
                  <View key={key} style={{ gap: 8 }}>
                    <Text style={styles.filterLabel}>{f.label}</Text>
                    <View style={styles.chipWrap}>
                      {all.slice(0, limit).map((o) => {
                        const on = selected.includes(o.value);
                        return (
                          <Pressable
                            key={o.value}
                            onPress={() => toggleIn(key, o.value)}
                            style={[styles.deptChip, on && styles.deptChipActive]}
                          >
                            <Text style={[styles.deptText, on && styles.deptTextActive]}>
                              {o.value} ({o.count})
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    {all.length > 16 ? (
                      <Pressable onPress={() => setShowAll((x) => ({ ...x, [key]: !x[key] }))}>
                        <Text style={styles.clearText}>{showAll[key] ? "Minder tonen" : `Alle ${all.length} tonen`}</Text>
                      </Pressable>
                    ) : null}
                  </View>
                );
              })}
          </ScrollView>
          <View style={styles.reqRow}>
            <Pressable onPress={() => setFilters(NO_FILTERS)} style={[styles.reqBtn, { flex: 1, paddingVertical: 13 }]}>
              <Text style={styles.reqBtnText}>Alles wissen</Text>
            </Pressable>
            <Pressable testID="filters-apply" onPress={onClose} style={[styles.reqBtn, { flex: 2, paddingVertical: 13, backgroundColor: colors.brandPrimary }]}>
              <Text style={[styles.reqBtnText, { color: colors.onBrandPrimary }]}>
                {total != null ? `Toon ${total} producten` : "Klaar"}
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  crumbs: { flexDirection: "row", alignItems: "center", gap: 4, flexWrap: "wrap", minHeight: 34 },
  crumb: { fontSize: 14, fontFamily: fonts.medium, color: colors.brandPrimary },
  crumbActive: { color: colors.onSurface, fontFamily: fonts.bold },
  tile: { flex: 1, maxWidth: "48.5%", borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 12, gap: 6, backgroundColor: colors.surface },
  tileIcon: { width: 52, height: 52, borderRadius: 14, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  tileImage: { width: 52, height: 52, borderRadius: 10, backgroundColor: "#fff" },
  tileTitle: { fontSize: 15, fontFamily: fonts.semibold, color: colors.onSurface },
  tileCount: { fontSize: 12, fontFamily: fonts.regular, color: colors.muted },
  root: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: 16, paddingTop: 8, gap: 12 },
  title: { fontSize: 32, fontFamily: fonts.bold, color: colors.onSurface },
  subtitle: { fontSize: 15, fontFamily: fonts.regular, color: colors.muted, marginTop: 2, marginBottom: 2 },
  storeRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: -4 },
  storeText: { fontSize: 13, fontFamily: fonts.semibold, color: colors.brandPrimary },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: { flex: 1, paddingVertical: 12, fontSize: 15, fontFamily: fonts.regular, color: colors.onSurface },
  segment: { flexDirection: "row", backgroundColor: colors.surfaceTertiary, borderRadius: 10, padding: 3 },
  segBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center" },
  segBtnActive: { backgroundColor: colors.surface },
  segText: { fontSize: 13, fontFamily: fonts.medium, color: colors.muted },
  segTextActive: { color: colors.onSurface, fontFamily: fonts.semibold },
  deptRow: { gap: 8, paddingVertical: 2, paddingRight: 8 },
  deptChip: { flexDirection: "row", alignItems: "center", gap: 5, height: 34, paddingHorizontal: 12, borderRadius: 999, backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border, justifyContent: "center" },
  deptChipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  deptText: { fontSize: 13, fontFamily: fonts.medium, color: colors.onSurfaceTertiary },
  deptTextActive: { color: colors.onBrandPrimary, fontFamily: fonts.semibold },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
  },
  rowIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  storeMenu: {
    alignSelf: "flex-start",
    minWidth: 200,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 4,
  },
  storeMenuItem: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingHorizontal: 14, paddingVertical: 10 },
  storeMenuText: { fontSize: 15, fontFamily: fonts.medium, color: colors.onSurface },
  storeMenuTextActive: { fontFamily: fonts.bold, color: colors.brandPrimary },
  favToggle: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.brandPrimary,
  },
  favToggleActive: { backgroundColor: colors.brandPrimary },
  favToggleText: { fontSize: 13, fontFamily: fonts.semibold, color: colors.brandPrimary },
  favToggleTextActive: { color: colors.onBrandPrimary },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  clearText: { fontSize: 13, fontFamily: fonts.semibold, color: colors.brandPrimary },
  oldPrice: { fontSize: 11, fontFamily: fonts.regular, color: colors.muted, textDecorationLine: "line-through" },
  promoPrice: { color: colors.warning },
  promoBadge: { marginTop: 3, backgroundColor: colors.warning, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  promoBadgeText: { fontSize: 11, fontFamily: fonts.bold, color: "#fff" },
  nextTag: { fontSize: 11, fontFamily: fonts.semibold, color: colors.brandPrimary, marginTop: 2 },
  folderBtn: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: -4, marginLeft: 16 },
  unitTag: { fontSize: 11, fontFamily: fonts.regular, color: colors.muted, marginTop: 1 },
  offerTag: { fontSize: 11, fontFamily: fonts.semibold, color: colors.warning, marginTop: 2 },
  filterLabel: { fontSize: 15, fontFamily: fonts.bold, color: colors.onSurface },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  rowPicked: { borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary },
  rowImage: { width: 44, height: 44, borderRadius: 12, backgroundColor: "#fff" },
  rowTitle: { fontSize: 16, fontFamily: fonts.semibold, color: colors.onSurface },
  brand: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted },
  rowSub: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted, marginTop: 2 },
  ownBadge: { backgroundColor: colors.brandSecondary, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  ownBadgeText: { fontSize: 11, fontFamily: fonts.semibold, color: colors.onBrandSecondary },
  price: { fontSize: 15, fontFamily: fonts.bold, color: colors.onSurface },
  naPrice: { fontSize: 12, fontFamily: fonts.semibold, color: colors.muted },
  fab: {
    position: "absolute",
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 999,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  fabText: { color: colors.onBrandPrimary, fontSize: 15, fontFamily: fonts.semibold },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16, gap: 10 },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sheetTitle: { fontSize: 18, fontFamily: fonts.bold, color: colors.onSurface },
  sheetHint: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted },
  storeOpt: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.divider },
  storeOptText: { flex: 1, fontSize: 16, fontFamily: fonts.medium, color: colors.onSurface },
  reqRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  reqInput: {
    flex: 1,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 15,
    fontFamily: fonts.regular,
    color: colors.onSurface,
  },
  reqBtn: { backgroundColor: colors.brandSecondary, borderRadius: 10, paddingHorizontal: 16, alignItems: "center", justifyContent: "center" },
  reqBtnText: { fontSize: 14, fontFamily: fonts.semibold, color: colors.onBrandSecondary },
}));
