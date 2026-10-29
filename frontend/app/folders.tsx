import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, FlatList, Linking, Pressable, ScrollView, SectionList, Text, TextInput, View } from "react-native";
import Image from "@/src/components/SafeImage";
import Modal from "@/src/components/Modal";
import { useHideOnScroll } from "@/src/hideOnScroll";
import { matchScore } from "@/src/smartSearch";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueries, useQuery } from "@tanstack/react-query";

import { EmptyState, Icon } from "@/src/components/ui";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { goBack } from "@/src/nav";
import { euro, useDebounced } from "@/src/search";
import { fonts, makeStyles, useTheme } from "@/src/theme";
import { useGrid } from "@/src/layout";
import SearchSuggestions from "@/src/SearchSuggestions";
import type { Product } from "@/app/(tabs)/products";
import { useSwipePages } from "@/src/useSwipePages";

type FolderItem = {
  id: string;
  title: string;
  label: string;
  image: string | null;
  price: number | null;
  regular: number | null;
  deal: { count: number; total: number; each: number } | null;
  period: string | null;
  combinable: boolean;
  note: string | null;
  quantity: string | null;
  product_ids: string[];
  count: number;
  category: string;
  words?: string; // productnamen en soortnamen om op te zoeken
};

type FolderPeriod = {
  categories?: { name: string; count: number }[];
  key: string; // current, next, extra, dirck3
  title: string;
  pages?: string[]; // bladerfolder (Dirk): pagina's als afbeelding
  period: string | null;
  folder_url: string | null;
  items: FolderItem[];
};

type FoldersResponse = { store: string; stores: string[]; periods: FolderPeriod[]; loading: boolean; next_expected?: { start: string; available_from: string; nice: string } | null };

export default function FoldersScreen() {
  const params = useLocalSearchParams<{ store?: string; promo?: string }>();
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const fav = user?.store;
  const [store, setStore] = useState(params.store || fav || "Albert Heijn");
  const [periodKey, setPeriodKey] = useState<string>("current");
  const [open, setOpen] = useState<FolderItem | null>(null);
  // Na een product bekijken en teruggaan staat de keuze van die aanbieding er weer
  const reopen = useRef<FolderItem | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (reopen.current) {
        setOpen(reopen.current);
        reopen.current = null;
      }
    }, []),
  );
  const [cat, setCat] = useState<string | null>(null);
  // Zoeken in de aanbiedingen: in deze winkel of in alle winkels tegelijk
  const [q, setQ] = useState("");
  const [allStores, setAllStores] = useState(false);
  const dq = useDebounced(q.trim().toLowerCase());
  const searching = dq.length >= 2;

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["folders", store],
    queryFn: () => api<FoldersResponse>(`/folders?store=${encodeURIComponent(store)}`),
    staleTime: 10 * 60 * 1000,
  });
  const periods = data?.periods ?? [];
  // Vanaf Home: meteen naar die winkel en die actie
  const shown = useRef<string | null>(null);
  useEffect(() => {
    if (params.store) setStore(params.store);
  }, [params.store]);
  useEffect(() => {
    if (!params.promo || shown.current === params.promo || data?.store !== (params.store || store)) return;
    for (const per of periods) {
      const it = per.items.find((x) => x.id === params.promo);
      if (it) {
        shown.current = params.promo;
        setPeriodKey(per.key);
        setCat(null);
        setOpen(it);
        return;
      }
    }
  }, [params.promo, params.store, data]);
  const period = periods.find((p) => p.key === periodKey) ?? periods[0];
  const storeList = data?.stores ?? ["Albert Heijn", "Dirk", "Jumbo"];
  const others = useQueries({
    queries: storeList.map((s) => ({
      queryKey: ["folders", s],
      queryFn: () => api<FoldersResponse>(`/folders?store=${encodeURIComponent(s)}`),
      staleTime: 10 * 60 * 1000,
      enabled: searching && allStores,
    })),
  });
  // Ook op de producten in de actie en soortnamen (penne vindt "Alle pasta")
  const matches = (it: FolderItem) => matchScore(dq, it.title, it.label, it.category, it.quantity) >= 0 || (it.words ?? "").includes(dq);
  // Per categorie, kaarten naast elkaar (op een breed scherm meer per rij)
  const { cols } = useGrid(160);
  const sections = useMemo(() => {
    const groups: { title: string; items: FolderItem[] }[] = [];
    if (searching) {
      // Zoekresultaten per winkel (zelfde week als gekozen, anders deze week)
      const sources = allStores
        ? storeList.map((s, i) => ({ store: s, periods: others[i]?.data?.periods ?? (s === store ? periods : []) }))
        : [{ store, periods }];
      for (const src of sources) {
        const per = src.periods.find((p) => p.key === periodKey) ?? src.periods.find((p) => p.key === "current") ?? src.periods[0];
        const hits = (per?.items ?? []).filter(matches);
        if (hits.length) groups.push({ title: allStores ? src.store : per!.title, items: hits });
      }
    }
    for (const it of searching ? [] : period?.items ?? []) {
      if (cat && it.category !== cat) continue;
      let g = groups.find((x) => x.title === it.category);
      if (!g) groups.push((g = { title: it.category, items: [] }));
      g.items.push(it);
    }
    return groups.map((g) => {
      const rows: FolderItem[][] = [];
      for (let i = 0; i < g.items.length; i += cols) rows.push(g.items.slice(i, i + cols));
      return { title: `${g.title} (${g.items.length})`, data: rows };
    });
  }, [period, cat, cols, searching, dq, allStores, others.map((o) => o.dataUpdatedAt).join(","), periodKey, store]);

  const hide = useHideOnScroll();
  // Alle aanbiedingen die nu in beeld zijn, op volgorde: daarmee blader je in de pop-up naar de vorige of volgende
  const flatItems = useMemo(() => sections.flatMap((sec) => sec.data.flat()), [sections]);

  const openItem = (it: FolderItem) => {
    if (it.product_ids.length === 1) router.push(`/product/${it.product_ids[0]}`);
    else setOpen(it);
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable testID="back-button" onPress={() => goBack("/products")} hitSlop={10} style={styles.headerBtn}>
          <Icon name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Folders</Text>
        <View style={styles.headerBtn} />
      </View>

      <View style={{ flex: 1 }}>
      <Animated.View {...hide.blockProps} style={[{ paddingHorizontal: 16, paddingTop: 12, gap: 10, paddingBottom: 8, backgroundColor: colors.surface }, hide.blockProps.style]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {[...(data?.stores ?? ["Albert Heijn", "Dirk", "Jumbo"])].sort((a, b) => (a === fav ? -1 : b === fav ? 1 : a.localeCompare(b, "nl"))).map((s) => (
            <Pressable
              key={s}
              testID={`folder-store-${s}`}
              onPress={() => {
                setStore(s);
                setPeriodKey("current");
                setCat(null);
              }}
              style={[styles.chip, store === s && styles.chipActive]}
            >
              <Text style={[styles.chipText, store === s && styles.chipTextActive]}>{s}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <View style={styles.searchBox}>
          <Icon name="magnify" size={20} color={colors.muted} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Zoek in de aanbiedingen (bijv. kaas, koffie)"
            placeholderTextColor={colors.muted}
            style={styles.searchInput}
            testID="folder-search"
          />
          {q ? (
            <Pressable onPress={() => setQ("")} hitSlop={8}>
              <Icon name="close-circle" size={18} color={colors.muted} />
            </Pressable>
          ) : null}
        </View>
        <SearchSuggestions q={q} onPick={setQ} testID="folder-suggest" />
        {searching ? (
          <View style={{ flexDirection: "row", gap: 8 }}>
            {[false, true].map((a) => (
              <Pressable key={String(a)} onPress={() => setAllStores(a)} style={[styles.chip, allStores === a && styles.chipActive]}>
                <Text style={[styles.chipText, allStores === a && styles.chipTextActive]}>{a ? "Alle winkels" : `Alleen ${store}`}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {periods.length > 0 ? (
          <View style={styles.segment}>
            {periods.map((p) => (
              <Pressable key={p.key} onPress={() => { setPeriodKey(p.key); setCat(null); }} style={[styles.segBtn, period?.key === p.key && styles.segBtnActive]}>
                <Text style={[styles.segText, period?.key === p.key && styles.segTextActive]} numberOfLines={1}>{p.title}</Text>
                {p.period ? <Text style={styles.segSub} numberOfLines={1}>{p.period}</Text> : null}
              </Pressable>
            ))}
          </View>
        ) : null}
        {!periods.some((p) => p.key === "next") && periods.length > 0 ? (
          <Text style={styles.muted}>
            {data?.next_expected
              ? `De folder van volgende week staat er naar verwachting vanaf ${data.next_expected.nice}, zodra ${store} hem online zet. We kijken dan elk uur.`
              : `De folder van volgende week staat er nog niet; die verschijnt zodra ${store} hem publiceert.`}
          </Text>
        ) : null}
        {period?.pages ? (
          <Text style={styles.muted}>
            {period.key === "next" ? `De losse acties van volgende week zet ${store} er pas later in. Dit is de folder zelf.` : "Blader door de folder."}
          </Text>
        ) : null}
        {period?.folder_url ? (
          <Pressable onPress={() => Linking.openURL(period.folder_url!)} style={styles.folderLink}>
            <Icon name="book-open-page-variant-outline" size={18} color={colors.brandPrimary} />
            <Text style={styles.folderLinkText}>Bekijk de echte folder van {store}</Text>
          </Pressable>
        ) : null}
      </Animated.View>

      {isLoading ? (
        <View style={[styles.center, { paddingTop: hide.padTop }]}>
          <ActivityIndicator size="large" color={colors.brandPrimary} />
        </View>
      ) : !period ? (
        <View style={{ flex: 1, paddingTop: hide.padTop }}>
          <EmptyState
            icon="newspaper-variant-outline"
            title={data?.loading ? "Folders worden opgehaald" : "Geen aanbiedingen gevonden"}
            subtitle={data?.loading ? "Probeer het over een halve minuut opnieuw." : "Probeer het later nog eens."}
          />
          <Pressable onPress={() => refetch()} style={{ alignSelf: "center" }}>
            <Text style={styles.folderLinkText}>Opnieuw laden</Text>
          </Pressable>
        </View>
      ) : period.pages && !searching ? (
        <FolderPages pages={period.pages} top={hide.padTop} bottom={insets.bottom + 40} scrollProps={hide.scrollProps} />
      ) : (
        <SectionList
          {...hide.scrollProps}
          sections={sections}
          keyExtractor={(row) => row.map((it) => it.id).join("|")}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: hide.padTop, paddingBottom: insets.bottom + 40 }}
          ListEmptyComponent={searching ? <Text style={[styles.muted, { paddingTop: 16 }]}>Geen aanbiedingen gevonden voor "{q.trim()}".</Text> : null}
          ListHeaderComponent={searching ? null : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 10 }}>
              <Pressable onPress={() => setCat(null)} style={[styles.catChip, !cat && styles.chipActive]}>
                <Text style={[styles.chipText, !cat && styles.chipTextActive]}>Alles ({period.items.length})</Text>
              </Pressable>
              {(period.categories ?? []).map((c) => (
                <Pressable key={c.name} onPress={() => setCat(c.name)} style={[styles.catChip, cat === c.name && styles.chipActive]}>
                  <Text style={[styles.chipText, cat === c.name && styles.chipTextActive]}>
                    {c.name} ({c.count})
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
            </View>
          )}
          renderItem={({ item: row }) => (
            <View style={{ flexDirection: "row", gap: 10, marginBottom: 10 }}>
              {row.map((item) => (
                <ItemCard key={item.id} item={item} onPress={() => openItem(item)} />
              ))}
              {Array.from({ length: cols - row.length }, (_, k) => (
                <View key={k} style={{ flex: 1 }} />
              ))}
            </View>
          )}
        />
      )}
      </View>

      <Modal visible={!!open} transparent animationType="fade" onRequestClose={() => setOpen(null)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(null)}>
          <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]} onPress={() => {}}>
            {open ? (
              <ItemSheet
                item={open}
                list={flatItems}
                onMove={setOpen}
                onClose={() => setOpen(null)}
                onOpenProduct={(id) => {
                  reopen.current = open;
                  setOpen(null);
                  router.push(`/product/${id}`);
                }}
              />
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function FolderPages({ pages, top = 0, bottom, scrollProps }: { pages: string[]; top?: number; bottom: number; scrollProps?: object }) {
  // Tientallen grote pagina's: alleen laden wat in beeld komt, in een kleiner formaat
  const styles = useStyles();
  const [w, setW] = useState(0);
  const h = w ? (w - 32) * 1.42 : 480;
  return (
    <FlatList
      {...scrollProps}
      data={pages}
      keyExtractor={(u) => u}
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      initialNumToRender={2}
      maxToRenderPerBatch={2}
      windowSize={3}
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 10 + top, paddingBottom: bottom, gap: 12 }}
      getItemLayout={(_, i) => ({ length: h + 12, offset: 10 + top + (h + 12) * i, index: i })}
      renderItem={({ item: u, index }) => (
        <Pressable onPress={() => Linking.openURL(u.replace(/\?width=\d+/, "?width=1600"))}>
          <Image source={{ uri: u.replace(/\?width=\d+/, "?width=800") }} style={[styles.page, { height: h }]} resizeMode="contain" accessibilityLabel={`Folderpagina ${index + 1}`} />
        </Pressable>
      )}
    />
  );
}

function ItemCard({ item, onPress }: { item: FolderItem; onPress: () => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <Pressable testID={`folder-item-${item.id}`} onPress={onPress} style={styles.card}>
      <View style={styles.imageBox}>
        {item.image ? (
          <Image source={{ uri: item.image }} style={styles.image} resizeMode="contain" />
        ) : (
          <Icon name="tag-outline" size={36} color={colors.brandPrimary} />
        )}
        <View style={styles.badge}>
          <Text style={styles.badgeText} numberOfLines={2}>
            {item.label}
          </Text>
        </View>
      </View>
      <Text style={styles.title} numberOfLines={3}>
        {item.title}
      </Text>
      {item.quantity ? <Text style={styles.muted}>{item.quantity}</Text> : null}
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
        {item.regular && item.price && item.regular > item.price ? <Text style={styles.oldPrice}>{euro(item.regular)}</Text> : null}
        {item.price ? <Text style={styles.price}>{euro(item.price)}</Text> : null}
      </View>
      {item.deal && item.deal.count > 1 ? (
        <Text style={styles.deal}>
          {item.deal.count} stuks: {euro(item.deal.each)} p/st
        </Text>
      ) : null}
      {item.count > 1 ? <Text style={styles.combi}>{item.count} producten, te combineren</Text> : null}
    </Pressable>
  );
}

function ItemSheet({ item, list, onMove, onClose, onOpenProduct }: {
  item: FolderItem;
  list: FolderItem[];
  onMove: (it: FolderItem) => void;
  onClose: () => void;
  onOpenProduct: (id: string) => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const at = list.findIndex((x) => x.id === item.id);
  const prev = at > 0 ? list[at - 1] : null;
  const next = at >= 0 && at < list.length - 1 ? list[at + 1] : null;
  const swipe = useSwipePages((dir) => !!(dir === 1 ? next : prev), (dir) => onMove((dir === 1 ? next : prev)!));
  const move = (dir: 1 | -1) => {
    const to = dir === 1 ? next : prev;
    if (!to) return;
    onMove(to);
    swipe.slideIn(dir);
  };
  const { data, isLoading } = useQuery({
    queryKey: ["products-by-ids", item.product_ids.join(",")],
    queryFn: () => api<{ products: Product[] }>(`/products/by-ids?ids=${item.product_ids.join(",")}`),
    enabled: item.product_ids.length > 0,
  });
  return (
    <Animated.View style={[{ gap: 10, maxHeight: 560 }, swipe.style]} {...swipe.panHandlers}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
        <View style={{ flex: 1, gap: 4 }}>
          <View style={[styles.badge, { position: "relative", alignSelf: "flex-start" }]}>
            <Text style={styles.badgeText}>{item.label}</Text>
          </View>
          <Text style={styles.sheetTitle}>{item.title}</Text>
          {item.period ? <Text style={styles.muted}>Geldig {item.period}</Text> : null}
        </View>
        <Pressable onPress={onClose} hitSlop={10}>
          <Icon name="close" size={24} color={colors.onSurface} />
        </Pressable>
      </View>
      {item.combinable ? <Text style={styles.muted}>Je mag verschillende producten uit deze actie combineren voor de korting.</Text> : null}
      {item.note ? <Text style={styles.muted}>{item.note}</Text> : null}
      {item.product_ids.length === 0 ? (
        <Text style={styles.muted}>
          De winkel geeft voor deze actie geen losse producten door. Zoek bij Producten op "{item.title.replace(/^Alle\s+/i, "").replace(/\*/g, "")}".
        </Text>
      ) : isLoading ? (
        <ActivityIndicator color={colors.brandPrimary} />
      ) : (
        <ScrollView contentContainerStyle={{ gap: 8 }}>
          {(data?.products ?? []).map((p) => (
            <Pressable key={p.id} onPress={() => onOpenProduct(p.id)} style={styles.row}>
              {p.image ? <Image source={{ uri: p.image }} style={styles.rowImage} resizeMode="contain" /> : null}
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle} numberOfLines={2}>
                  {p.name}
                </Text>
                <Text style={styles.muted}>{p.unit}</Text>
              </View>
              <Text style={styles.rowPrice}>{p.price > 0 ? euro(p.price) : "—"}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
      {list.length > 1 && at >= 0 ? (
        <View style={styles.sheetNav}>
          <Pressable onPress={() => move(-1)} disabled={!prev} hitSlop={8} style={[styles.sheetNavBtn, !prev && { opacity: 0.35 }]} testID="folder-prev">
            <Icon name="chevron-left" size={22} color={colors.brandPrimary} />
            <Text style={styles.sheetNavText}>Vorige</Text>
          </Pressable>
          <Text style={styles.muted}>
            {at + 1} van {list.length}
          </Text>
          <Pressable onPress={() => move(1)} disabled={!next} hitSlop={8} style={[styles.sheetNavBtn, !next && { opacity: 0.35 }]} testID="folder-next">
            <Text style={styles.sheetNavText}>Volgende</Text>
            <Icon name="chevron-right" size={22} color={colors.brandPrimary} />
          </Pressable>
        </View>
      ) : null}
    </Animated.View>
  );
}

const useStyles = makeStyles((colors) => ({
  searchBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.surfaceSecondary, borderRadius: 12, paddingHorizontal: 12, minHeight: 44 },
  searchInput: { flex: 1, fontSize: 15, fontFamily: fonts.regular, color: colors.onSurface, paddingVertical: 10 },
  page: { width: "100%", height: 480, borderRadius: 12, backgroundColor: colors.surfaceSecondary },
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    zIndex: 2,
    backgroundColor: colors.surface,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  headerBtn: { width: 44, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 18, fontFamily: fonts.bold, color: colors.onSurface },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  muted: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted },
  chip: { height: 34, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceTertiary, justifyContent: "center" },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { fontSize: 13, fontFamily: fonts.medium, color: colors.onSurfaceTertiary },
  chipTextActive: { color: colors.onBrandPrimary, fontFamily: fonts.semibold },
  segment: { flexDirection: "row", backgroundColor: colors.surfaceTertiary, borderRadius: 10, padding: 3 },
  segBtn: { flex: 1, paddingVertical: 7, paddingHorizontal: 2, borderRadius: 8, alignItems: "center" },
  segBtnActive: { backgroundColor: colors.surface },
  segText: { fontSize: 13, fontFamily: fonts.semibold, color: colors.muted },
  segTextActive: { color: colors.onSurface },
  segSub: { fontSize: 11, fontFamily: fonts.regular, color: colors.muted },
  folderLink: { flexDirection: "row", alignItems: "center", gap: 6 },
  sheetNav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.divider },
  sheetNavBtn: { flexDirection: "row", alignItems: "center", gap: 2, paddingVertical: 6 },
  sheetNavText: { fontSize: 14, fontFamily: fonts.semibold, color: colors.brandPrimary },
  folderLinkText: { fontSize: 14, fontFamily: fonts.semibold, color: colors.brandPrimary },
  catChip: { height: 32, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceTertiary, justifyContent: "center" },
  sectionHead: { backgroundColor: colors.surface, paddingVertical: 8 },
  sectionTitle: { fontSize: 17, fontFamily: fonts.bold, color: colors.onSurface },
  card: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 10, gap: 4 },
  imageBox: { height: 120, borderRadius: 10, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  image: { width: "90%", height: "90%" },
  badge: { position: "absolute", top: 6, left: 6, maxWidth: "90%", backgroundColor: colors.warning, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3 },
  badgeText: { fontSize: 12, fontFamily: fonts.bold, color: "#fff" },
  title: { fontSize: 14, fontFamily: fonts.semibold, color: colors.onSurface },
  oldPrice: { fontSize: 12, fontFamily: fonts.regular, color: colors.muted, textDecorationLine: "line-through" },
  price: { fontSize: 16, fontFamily: fonts.bold, color: colors.warning },
  deal: { fontSize: 12, fontFamily: fonts.semibold, color: colors.onSurface },
  combi: { fontSize: 12, fontFamily: fonts.medium, color: colors.brandPrimary },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center" },
  sheet: { backgroundColor: colors.surface, borderRadius: 20, width: "92%", maxWidth: 560, alignSelf: "center", marginVertical: "auto", maxHeight: "92%", padding: 16 },
  sheetTitle: { fontSize: 18, fontFamily: fonts.bold, color: colors.onSurface },
  row: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 8 },
  rowImage: { width: 40, height: 40, borderRadius: 8, backgroundColor: "#fff" },
  rowTitle: { fontSize: 14, fontFamily: fonts.semibold, color: colors.onSurface },
  rowPrice: { fontSize: 14, fontFamily: fonts.bold, color: colors.onSurface },
}));
