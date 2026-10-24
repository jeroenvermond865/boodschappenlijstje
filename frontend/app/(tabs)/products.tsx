import { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Image, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { EmptyState, Icon } from "@/src/components/ui";
import { api } from "@/src/api";
import { fetchProducts, useDebounced } from "@/src/search";
import { AISLES, AISLE_ICONS } from "@/src/constants";
import { useAuth } from "@/src/auth";
import { usesNativeTabs } from "@/src/navigation";
import { useAppSettings } from "@/src/settings";
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
  source?: "Dirk" | "Albert Heijn" | null;
  image?: string | null;
  is_favorite?: boolean;
};

const STORE_FILTERS = [
  { key: "all", label: "Alle producten" },
  { key: "Dirk", label: "Dirk" },
  { key: "Albert Heijn", label: "Albert Heijn" },
] as const;

export default function ProductsScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const s = useAppSettings();
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;

  const [search, setSearch] = useState("");
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const qc = useQueryClient();
  const [aisle, setAisle] = useState<string>("all");
  const [storeFilter, setStoreFilter] = useState<"all" | "Dirk" | "Albert Heijn">("all");
  const [storeOpen, setStoreOpen] = useState(false);

  const debouncedSearch = useDebounced(search);
  const queryKey = ["products", "search", storeFilter, aisle, onlyFavorites, debouncedSearch.trim()];
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey,
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      fetchProducts({
        q: debouncedSearch,
        source: storeFilter === "all" ? "" : storeFilter,
        aisle: aisle === "all" ? "" : aisle,
        favorites: onlyFavorites,
        offset: pageParam,
        limit: 50,
      }),
    getNextPageParam: (last) => last.next_offset ?? undefined,
    placeholderData: (prev) => prev,
  });

  const filtered = useMemo(() => (data?.pages ?? []).flatMap((pg) => pg.products), [data]);
  const aisleCounts = data?.pages[0]?.aisle_counts ?? {};

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
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>{s.tab_products}</Text>
        <Text style={styles.subtitle}>{s.sub_products}</Text>
        <Pressable testID="store-selector" onPress={() => setStoreOpen((v) => !v)} style={styles.storeRow}>
          <Icon name="storefront-outline" size={16} color={colors.brandPrimary} />
          <Text style={styles.storeText}>{STORE_FILTERS.find((f) => f.key === storeFilter)?.label}</Text>
          <Icon name={storeOpen ? "chevron-up" : "chevron-down"} size={16} color={colors.brandPrimary} />
        </Pressable>
        {storeOpen ? (
          <View style={styles.storeMenu}>
            {STORE_FILTERS.map((f) => (
              <Pressable
                key={f.key}
                testID={`product-store-${f.key}`}
                onPress={() => {
                  setStoreFilter(f.key);
                  setAisle("all");
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
        <Pressable
          testID="product-favorites-toggle"
          onPress={() => setOnlyFavorites((v) => !v)}
          style={[styles.favToggle, onlyFavorites && styles.favToggleActive]}
        >
          <Icon name={onlyFavorites ? "star" : "star-outline"} size={16} color={onlyFavorites ? colors.onBrandPrimary : colors.brandPrimary} />
          <Text style={[styles.favToggleText, onlyFavorites && styles.favToggleTextActive]}>Mijn favorieten</Text>
        </Pressable>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.deptRow}>
          <Pressable testID="dept-all" onPress={() => setAisle("all")} style={[styles.deptChip, aisle === "all" && styles.deptChipActive]}>
            <Text style={[styles.deptText, aisle === "all" && styles.deptTextActive]}>Alle afdelingen</Text>
          </Pressable>
          {AISLES.filter((a) => (aisleCounts[a] ?? 0) > 0).map((a) => (
            <Pressable key={a} testID={`dept-${a}`} onPress={() => setAisle(a)} style={[styles.deptChip, aisle === a && styles.deptChipActive]}>
              <Icon name={(AISLE_ICONS[a] ?? "cart-outline") as any} size={14} color={aisle === a ? colors.onBrandPrimary : colors.brandPrimary} />
              <Text style={[styles.deptText, aisle === a && styles.deptTextActive]}>{a}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.brandPrimary} />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(p) => p.id}
          onEndReached={() => {
            if (hasNextPage && !isFetchingNextPage) fetchNextPage();
          }}
          onEndReachedThreshold={0.6}
          initialNumToRender={15}
          windowSize={7}
          ListFooterComponent={isFetchingNextPage ? <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: 8 }} /> : null}
          contentContainerStyle={{ padding: 16, paddingTop: 8, paddingBottom: bottomChrome + 96, gap: 10 }}
          renderItem={({ item }) => (
            <Pressable
              testID={`product-row-${item.id}`}
              onPress={() => router.push({ pathname: "/product/edit", params: { id: item.id } })}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.9 }]}
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
                <Text style={styles.rowSub}>
                  {item.aisle} · per {item.unit}
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
                <Text style={styles.price}>{item.price > 0 ? `€ ${item.price.toFixed(2)}` : "—"}</Text>
              )}
              <Icon name="chevron-right" size={20} color={colors.muted} />
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


    </View>
  );
}

const useStyles = makeStyles((colors) => ({
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
