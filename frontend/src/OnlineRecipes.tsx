import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Animated, FlatList, Image, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { HideOnScroll, useHideOnScroll } from "@/src/hideOnScroll";
import { smartFilter } from "@/src/smartSearch";
import Modal from "@/src/components/Modal";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useInfiniteQuery } from "@tanstack/react-query";

import { EmptyState, Icon } from "@/src/components/ui";
import { api } from "@/src/api";
import { euro } from "@/src/search";
import { useGrid } from "@/src/layout";
import { useAuth } from "@/src/auth";
import { fonts, makeStyles, useTheme } from "@/src/theme";

export type RecipeTile = {
  id: string;
  store: string;
  title: string;
  image?: string | null;
  time?: number | null;
  servings?: number | null;
  course?: string | null;
  rating?: number | null;
  price_total?: number | null; // ongeveer, in hele verpakkingen
  price_pp?: number | null;
};

export type RecipeFacet = {
  key: string;
  label: string;
  multi: boolean;
  values: { value: string; label: string; count?: number | null }[];
};

type Page = { recipes: RecipeTile[]; total: number; facets: RecipeFacet[]; has_more: boolean; errors?: string[] };

export const RECIPE_STORES = [
  { key: "all", label: "Alle winkels" },
  { key: "ah", label: "Albert Heijn" },
  { key: "jumbo", label: "Jumbo" },
  { key: "dirk", label: "Dirk" },
] as const;

export const STORE_LABEL: Record<string, string> = { ah: "AH", jumbo: "Jumbo", dirk: "Dirk" };

type Filters = Record<string, string[]>;

export function OnlineRecipes({
  bottomPadding,
  initialFilters,
  onPick,
  pickedIds,
  busyId,
  outer,
}: {
  outer?: HideOnScroll; // de bovenbalk van het scherm schuift mee
  bottomPadding: number;
  initialFilters?: Filters; // bijv. { gang: ["ontbijt"] } als je vanuit het ontbijt van een kamp zoekt
  onPick?: (r: RecipeTile) => void; // kiezen in plaats van openen
  pickedIds?: string[];
  busyId?: string | null;
}) {
  const styles = useStyles();
  const grid = useGrid(170);
  const { colors } = useTheme();
  const router = useRouter();

  const [input, setInput] = useState("");
  const [q, setQ] = useState("");
  // Je favoriete winkel staat vooraan en is meteen gekozen
  const { user } = useAuth();
  const favKey = RECIPE_STORES.find((s) => s.label === user?.store)?.key;
  const stores = favKey ? [RECIPE_STORES[0], ...RECIPE_STORES.filter((s) => s.key === favKey), ...RECIPE_STORES.filter((s) => s.key !== "all" && s.key !== favKey)] : RECIPE_STORES;
  const [store, setStore] = useState<string>(favKey ?? "all");
  const [filters, setFilters] = useState<Filters>(favKey ? {} : initialFilters ?? {});
  const [open, setOpen] = useState(false);

  // Even wachten met zoeken tot je klaar bent met typen
  useEffect(() => {
    const t = setTimeout(() => setQ(input.trim()), 400);
    return () => clearTimeout(t);
  }, [input]);

  // Andere winkel: elke winkel heeft eigen filters. Neem de gekozen filters mee naar de filters met dezelfde naam bij de nieuwe winkel
  const [firstStore, setFirstStore] = useState(true);
  const [carry, setCarry] = useState<Filters | null>(favKey && initialFilters ? initialFilters : null);
  useEffect(() => {
    if (firstStore) return setFirstStore(false);
    if (Object.keys(filters).length) setCarry(filters);
    setFilters({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  const query = useInfiniteQuery({
    queryKey: store === "fav" ? ["recipes", "favorites"] : ["recipes", q, store, filters],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      store === "fav"
        ? api<Page>("/recipes/favorites")
        : api<Page>(
        `/recipes/search?q=${encodeURIComponent(q)}&store=${store}&page=${pageParam}&filters=${encodeURIComponent(JSON.stringify(filters))}`,
      ),
    getNextPageParam: (last, all) => (last.has_more ? all.length : undefined),
    staleTime: 10 * 60 * 1000,
  });
  const favQuery = store === "fav";

  const recipes = useMemo(() => {
    const seen = new Set<string>();
    const all = (query.data?.pages ?? []).flatMap((p) => p.recipes).filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
    return store === "fav" && q ? smartFilter(all, q, (r) => [r.title]) : all;
  }, [query.data, store, q]);
  const first = query.data?.pages[0];
  const facets = first?.facets ?? [];
  const active = Object.values(filters).reduce((n, v) => n + v.length, 0);
  useEffect(() => {
    if (!carry || !first || query.isFetching) return;
    const norm = (x: string) => x.toLowerCase().replace(/[^a-z]/g, "");
    const alias: Record<string, string[]> = { hoofdgerecht: ["avondeten", "hoofdgerecht"], avondeten: ["hoofdgerecht", "avondeten"], dessert: ["toetjes", "nagerecht", "dessert"], toetjes: ["dessert", "nagerecht"] };
    const out: Filters = {};
    for (const [key, vals] of Object.entries(carry)) {
      for (const v of vals) {
        const want = [norm(v), ...(alias[norm(v)] ?? [])];
        for (const f of first.facets) {
          const hit = f.values.find((x) => want.includes(norm(x.value)) || want.includes(norm(x.label)));
          if (hit && (f.key === key || !out[f.key]?.length || f.multi)) {
            out[f.key] = f.multi ? [...new Set([...(out[f.key] ?? []), hit.value])] : [hit.value];
            break;
          }
        }
      }
    }
    setCarry(null);
    if (Object.keys(out).length) setFilters(out);
  }, [carry, first, query.isFetching]);

  const toggle = (f: RecipeFacet, value: string) =>
    setFilters((x) => {
      const cur = x[f.key] ?? [];
      const next = cur.includes(value) ? cur.filter((v) => v !== value) : f.multi ? [...cur, value] : [value];
      const out = { ...x, [f.key]: next };
      if (!next.length) delete out[f.key];
      return out;
    });

  const hide = useHideOnScroll(0, outer);

  return (
    <View style={{ flex: 1 }}>
      <Animated.View {...hide.blockProps} style={[styles.header, { backgroundColor: colors.surface }, hide.blockProps.style]}>
        <View style={styles.searchBox}>
          <Icon name="magnify" size={20} color={colors.muted} />
          <TextInput
            testID="recipe-search"
            placeholder="Zoek recept, bijv. pasta of soep"
            placeholderTextColor={colors.muted}
            value={input}
            onChangeText={setInput}
            style={styles.searchInput}
            returnKeyType="search"
            onSubmitEditing={() => setQ(input.trim())}
          />
          {input ? (
            <Pressable onPress={() => setInput("")} hitSlop={8}>
              <Icon name="close-circle" size={18} color={colors.muted} />
            </Pressable>
          ) : null}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll} contentContainerStyle={styles.chipRow}>
          <Pressable onPress={() => setOpen(true)} style={[styles.chip, active > 0 && styles.chipActive, favQuery && { display: "none" }]} testID="recipe-filters">
            <Icon name="tune-variant" size={16} color={active ? colors.onBrandPrimary : colors.onSurfaceTertiary} />
            <Text style={[styles.chipText, active > 0 && styles.chipTextActive]}>Filters{active ? ` (${active})` : ""}</Text>
          </Pressable>
          <Pressable onPress={() => setStore("fav")} style={[styles.chip, store === "fav" && styles.chipActive]} testID="recipe-favorites">
            <Icon name={store === "fav" ? "heart" : "heart-outline"} size={15} color={store === "fav" ? colors.onBrandPrimary : "#E0245E"} />
            <Text style={[styles.chipText, store === "fav" && styles.chipTextActive]}>Favorieten</Text>
          </Pressable>
          {stores.map((s) => (
            <Pressable key={s.key} onPress={() => setStore(s.key)} style={[styles.chip, store === s.key && styles.chipActive]}>
              <Text style={[styles.chipText, store === s.key && styles.chipTextActive]}>{s.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
        {active > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll} contentContainerStyle={styles.chipRow}>
            {facets.flatMap((f) =>
              (filters[f.key] ?? []).map((v) => (
                <Pressable key={f.key + v} onPress={() => toggle(f, v)} style={[styles.smallChip]}>
                  <Text style={styles.smallChipText}>{f.values.find((x) => x.value === v)?.label ?? v}</Text>
                  <Icon name="close" size={14} color={colors.onSurfaceTertiary} />
                </Pressable>
              )),
            )}
          </ScrollView>
        ) : null}
        {first ? (
          <Text style={styles.count}>
            {first.total ? `${first.total.toLocaleString("nl-NL")} recepten` : ""}
            {first.errors?.length ? `  ·  ${first.errors.join(", ")} nu niet bereikbaar` : ""}
          </Text>
        ) : null}
      </Animated.View>

      {query.isLoading ? (
        <View style={[styles.center, { paddingTop: hide.padTop }]}>
          <ActivityIndicator size="large" color={colors.brandPrimary} />
        </View>
      ) : (
        <FlatList
          scrollEventThrottle={16}
          onScroll={hide.scrollProps.onScroll}
          refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => query.refetch()} tintColor={colors.brandPrimary} />}
          data={recipes}
          keyExtractor={(r) => r.id}
          key={`recipes-${grid.cols}`}
          numColumns={grid.cols}
          columnWrapperStyle={{ gap: 10 }}
          contentContainerStyle={{ padding: 16, paddingTop: 8 + hide.padTop, paddingBottom: bottomPadding, gap: 10 }}
          onEndReachedThreshold={0.6}
          onEndReached={() => query.hasNextPage && !query.isFetchingNextPage && query.fetchNextPage()}
          renderItem={({ item }) => (
            <Pressable
              testID={`recipe-${item.id}`}
              onPress={() => (onPick ? onPick(item) : router.push({ pathname: "/recipe/[id]", params: { id: item.id } }))}
              style={({ pressed }) => [styles.card, { maxWidth: grid.tile }, pressed && { opacity: 0.9 }, pickedIds?.includes(item.id) && styles.cardPicked]}
            >
              {onPick ? (
                <View style={styles.pickBadge}>
                  {busyId === item.id ? (
                    <ActivityIndicator size="small" color={colors.onBrandPrimary} />
                  ) : (
                    <Icon name={pickedIds?.includes(item.id) ? "check" : "plus"} size={18} color={colors.onBrandPrimary} />
                  )}
                </View>
              ) : null}
              {item.image ? <Image source={{ uri: item.image }} style={styles.cardImage} resizeMode="cover" /> : <View style={[styles.cardImage, styles.noImage]}><Icon name="silverware-variant" size={28} color={colors.muted} /></View>}
              <View style={styles.storeBadge}>
                <Text style={styles.storeBadgeText}>{STORE_LABEL[item.store] ?? item.store}</Text>
              </View>
              <View style={{ padding: 10, gap: 4 }}>
                <Text style={styles.cardTitle} numberOfLines={2}>
                  {item.title}
                </Text>
                <View style={styles.metaRow}>
                  {item.time ? (
                    <View style={styles.meta}>
                      <Icon name="clock-outline" size={13} color={colors.muted} />
                      <Text style={styles.metaText}>{item.time} min</Text>
                    </View>
                  ) : null}
                  {item.servings ? (
                    <View style={styles.meta}>
                      <Icon name="account-outline" size={13} color={colors.muted} />
                      <Text style={styles.metaText}>{item.servings}</Text>
                    </View>
                  ) : null}
                  {item.price_pp ? (
                    <View style={styles.meta}>
                      <Text style={[styles.metaText, { fontFamily: fonts.semibold, color: colors.onSurface }]}>± {euro(item.price_pp)} p.p.</Text>
                    </View>
                  ) : null}
                  {item.rating ? (
                    <View style={styles.meta}>
                      <Icon name="star" size={13} color="#E8A100" />
                      <Text style={styles.metaText}>{item.rating.toFixed(1).replace(".", ",")}</Text>
                    </View>
                  ) : null}
                </View>
              </View>
            </Pressable>
          )}
          ListFooterComponent={query.isFetchingNextPage ? <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: 12 }} /> : null}
          ListEmptyComponent={
            store === "fav" && !query.isError ? (
              <EmptyState icon="heart-outline" title="Nog geen favorieten" subtitle="Tik op het hartje bij een recept om het hier te bewaren." />
            ) : (
              <EmptyState icon="silverware-variant" title="Geen recepten gevonden" subtitle={query.isError ? (query.error as Error).message : "Probeer een ander woord of minder filters."} />
            )
          }
        />
      )}

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <FilterSheet facets={facets} filters={filters} toggle={toggle} clear={() => setFilters({})} onClose={() => setOpen(false)} total={first?.total} store={store} />
      </Modal>
    </View>
  );
}

function FilterSheet({
  facets,
  filters,
  toggle,
  clear,
  onClose,
  total,
  store,
}: {
  facets: RecipeFacet[];
  filters: Filters;
  toggle: (f: RecipeFacet, v: string) => void;
  clear: () => void;
  onClose: () => void;
  total?: number;
  store: string;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [showAll, setShowAll] = useState<Record<string, boolean>>({});
  return (
    <Pressable style={styles.backdrop} onPress={onClose}>
      <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]} onPress={() => {}}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>Filters</Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Icon name="close" size={24} color={colors.onSurface} />
          </Pressable>
        </View>
        {store === "all" ? (
          <Text style={styles.hint}>Kies één winkel voor alle filters die die winkel op zijn site heeft.</Text>
        ) : null}
        <ScrollView contentContainerStyle={{ gap: 16, paddingBottom: 8 }}>
          {facets.map((f) => {
            const sel = filters[f.key] ?? [];
            const many = f.values.length > 12 && !showAll[f.key];
            const vals = many ? f.values.filter((v, i) => i < 12 || sel.includes(v.value)) : f.values;
            return (
              <View key={f.key} style={{ gap: 8 }}>
                <Text style={styles.filterLabel}>{f.label}</Text>
                <View style={styles.wrap}>
                  {vals.map((v) => {
                    const on = sel.includes(v.value);
                    return (
                      <Pressable key={v.value} onPress={() => toggle(f, v.value)} style={[styles.chip, on && styles.chipActive]}>
                        <Text style={[styles.chipText, on && styles.chipTextActive]}>
                          {v.label}
                          {v.count != null ? ` (${v.count})` : ""}
                        </Text>
                      </Pressable>
                    );
                  })}
                  {many ? (
                    <Pressable onPress={() => setShowAll((x) => ({ ...x, [f.key]: true }))} style={styles.chip}>
                      <Text style={styles.chipText}>Meer…</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            );
          })}
          {!facets.length ? <Text style={styles.hint}>Geen filters beschikbaar.</Text> : null}
        </ScrollView>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Pressable onPress={clear} style={[styles.btn, styles.btnGhost]}>
            <Text style={styles.btnGhostText}>Wissen</Text>
          </Pressable>
          <Pressable onPress={onClose} style={styles.btn}>
            <Text style={styles.btnText}>{total != null ? `Toon ${total.toLocaleString("nl-NL")} recepten` : "Klaar"}</Text>
          </Pressable>
        </View>
      </Pressable>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  cardPicked: { borderColor: colors.brandPrimary, borderWidth: 2 },
  pickBadge: { position: "absolute", top: 8, right: 8, zIndex: 2, width: 30, height: 30, borderRadius: 15, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  header: { paddingHorizontal: 16, paddingTop: 12, gap: 10 },
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
  chipScroll: { marginHorizontal: -16, flexGrow: 0 },
  chipRow: { gap: 8, paddingHorizontal: 16, alignItems: "center" },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: colors.surfaceTertiary,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: "center",
  },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { fontSize: 13, fontFamily: fonts.medium, color: colors.onSurfaceTertiary },
  chipTextActive: { color: colors.onBrandPrimary, fontFamily: fonts.semibold },
  smallChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: colors.brandTertiary,
  },
  smallChipText: { fontSize: 12, fontFamily: fonts.medium, color: colors.onSurface },
  count: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  card: { flex: 1, backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  cardImage: { width: "100%", aspectRatio: 4 / 3, backgroundColor: colors.surfaceTertiary },
  noImage: { alignItems: "center", justifyContent: "center" },
  storeBadge: { position: "absolute", top: 8, left: 8, backgroundColor: "rgba(0,0,0,0.6)", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  storeBadgeText: { color: "#fff", fontSize: 11, fontFamily: fonts.semibold },
  cardTitle: { fontSize: 14, fontFamily: fonts.semibold, color: colors.onSurface, minHeight: 36 },
  metaRow: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  meta: { flexDirection: "row", alignItems: "center", gap: 3 },
  metaText: { fontSize: 12, fontFamily: fonts.regular, color: colors.muted },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center" },
  sheet: { backgroundColor: colors.surface, borderRadius: 20, width: "92%", maxWidth: 560, alignSelf: "center", marginVertical: "auto", maxHeight: "92%", padding: 16, gap: 10 },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sheetTitle: { fontSize: 18, fontFamily: fonts.bold, color: colors.onSurface },
  hint: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted },
  filterLabel: { fontSize: 15, fontFamily: fonts.bold, color: colors.onSurface },
  btn: { flex: 1, backgroundColor: colors.brandPrimary, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  btnText: { color: colors.onBrandPrimary, fontSize: 15, fontFamily: fonts.semibold },
  btnGhost: { flex: 0, paddingHorizontal: 20, backgroundColor: colors.surfaceTertiary },
  btnGhostText: { color: colors.onSurface, fontSize: 15, fontFamily: fonts.semibold },
}));
