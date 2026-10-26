import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Image, Linking, Modal, Pressable, ScrollView, SectionList, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";

import { EmptyState, Icon } from "@/src/components/ui";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { goBack } from "@/src/nav";
import { euro } from "@/src/search";
import { fonts, makeStyles, useTheme } from "@/src/theme";
import { useGrid } from "@/src/layout";
import type { Product } from "@/app/(tabs)/products";

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

type FoldersResponse = { store: string; stores: string[]; periods: FolderPeriod[]; loading: boolean };

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
  const [cat, setCat] = useState<string | null>(null);

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
  // Per categorie, kaarten naast elkaar (op een breed scherm meer per rij)
  const { cols } = useGrid(160);
  const sections = useMemo(() => {
    const groups: { title: string; items: FolderItem[] }[] = [];
    for (const it of period?.items ?? []) {
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
  }, [period, cat, cols]);

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

      <View style={{ paddingHorizontal: 16, paddingTop: 12, gap: 10 }}>
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
          <Text style={styles.muted}>De folder van volgende week staat er nog niet; die verschijnt zodra {store} hem publiceert.</Text>
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
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.brandPrimary} />
        </View>
      ) : !period ? (
        <View style={{ flex: 1 }}>
          <EmptyState
            icon="newspaper-variant-outline"
            title={data?.loading ? "Folders worden opgehaald" : "Geen aanbiedingen gevonden"}
            subtitle={data?.loading ? "Probeer het over een halve minuut opnieuw." : "Probeer het later nog eens."}
          />
          <Pressable onPress={() => refetch()} style={{ alignSelf: "center" }}>
            <Text style={styles.folderLinkText}>Opnieuw laden</Text>
          </Pressable>
        </View>
      ) : period.pages ? (
        <FolderPages pages={period.pages} bottom={insets.bottom + 40} />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(row) => row.map((it) => it.id).join("|")}
          stickySectionHeadersEnabled
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 40 }}
          ListHeaderComponent={
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
          }
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

      <Modal visible={!!open} transparent animationType="slide" onRequestClose={() => setOpen(null)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(null)}>
          <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]} onPress={() => {}}>
            {open ? <ItemSheet item={open} onClose={() => setOpen(null)} onOpenProduct={(id) => { setOpen(null); router.push(`/product/${id}`); }} /> : null}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function FolderPages({ pages, bottom }: { pages: string[]; bottom: number }) {
  // Tientallen grote pagina's: alleen laden wat in beeld komt, in een kleiner formaat
  const styles = useStyles();
  const [w, setW] = useState(0);
  const h = w ? (w - 32) * 1.42 : 480;
  return (
    <FlatList
      data={pages}
      keyExtractor={(u) => u}
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      initialNumToRender={2}
      maxToRenderPerBatch={2}
      windowSize={3}
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: bottom, gap: 12 }}
      getItemLayout={(_, i) => ({ length: h + 12, offset: 10 + (h + 12) * i, index: i })}
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

function ItemSheet({ item, onClose, onOpenProduct }: { item: FolderItem; onClose: () => void; onOpenProduct: (id: string) => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { data, isLoading } = useQuery({
    queryKey: ["products-by-ids", item.product_ids.join(",")],
    queryFn: () => api<{ products: Product[] }>(`/products/by-ids?ids=${item.product_ids.join(",")}`),
    enabled: item.product_ids.length > 0,
  });
  return (
    <View style={{ gap: 10, maxHeight: 560 }}>
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
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  page: { width: "100%", height: 480, borderRadius: 12, backgroundColor: colors.surfaceSecondary },
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
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
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16 },
  sheetTitle: { fontSize: 18, fontFamily: fonts.bold, color: colors.onSurface },
  row: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 8 },
  rowImage: { width: 40, height: 40, borderRadius: 8, backgroundColor: "#fff" },
  rowTitle: { fontSize: 14, fontFamily: fonts.semibold, color: colors.onSurface },
  rowPrice: { fontSize: 14, fontFamily: fonts.bold, color: colors.onSurface },
}));
