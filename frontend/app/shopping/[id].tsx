import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Share, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";

import { EmptyState, Icon } from "@/src/components/ui";
import { api } from "@/src/api";
import { BetterPack, PackBetter, packText } from "@/src/packs";
import { AISLE_ICONS, formatQty } from "@/src/constants";
import { goBack } from "@/src/nav";
import { useToast } from "@/src/toast";
import { storage } from "@/src/utils/storage";
import { fonts, makeStyles, useTheme } from "@/src/theme";

type Item = { name: string; unit: string; aisle: string; qty: number; packs?: number; pack_unit?: string; price?: number; product?: string; product_id?: string; better?: PackBetter | null };
type Grouped = { aisle: string; items: Item[] };
type StoreBlock = { store: string; grouped: Grouped[]; flat: Item[]; total?: number };

const euro = (n: number) => `€ ${n.toFixed(2).replace(".", ",")}`;
type PerDay = { index: number; adults: number; children: number; by_store: StoreBlock[] };
type ShoppingData = { by_store: StoreBlock[]; general: StoreBlock[]; per_day: PerDay[]; stores: string[]; multi_store: boolean };

const key = (store: string, i: Item) => `${store}|${i.name.toLowerCase()}|${i.unit}`;

export default function ShoppingScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [tab, setTab] = useState<"total" | "perday">("total");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);

  const storageKey = `checked_${id}`;

  useEffect(() => {
    (async () => {
      const saved = await storage.getItem<string[] | null>(storageKey, null);
      if (saved && Array.isArray(saved)) setChecked(new Set(saved));
      setLoaded(true);
    })();
  }, [storageKey]);

  const { data, isLoading } = useQuery({
    queryKey: ["shopping", id],
    queryFn: () => api<ShoppingData>(`/camps/${id}/shopping-list`),
  });
  const { data: camp } = useQuery({
    queryKey: ["camp", id],
    queryFn: () => api<{ name: string }>(`/camps/${id}`),
  });

  const multi = data?.multi_store ?? false;
  // Algemeen block first, then each store's totals
  const totalBlocks: { store: string; label: string; grouped: Grouped[]; total?: number }[] = useMemo(() => {
    if (!data) return [];
    const out: { store: string; label: string; grouped: Grouped[]; total?: number }[] = [];
    (data.general ?? []).forEach((b) =>
      out.push({ store: `alg:${b.store}`, label: multi ? `Algemeen · ${b.store}` : "Algemeen", grouped: b.grouped, total: b.total }),
    );
    (data.by_store ?? []).forEach((b) => out.push({ store: b.store, label: b.store, grouped: b.grouped, total: b.total }));
    return out;
  }, [data, multi]);
  // "Algemeen" staat ook al in de winkeltotalen; het totaal is de som van de winkels
  const grandTotal = (data?.by_store ?? []).reduce((n, b) => n + (b.total ?? 0), 0);

  const allItems = useMemo(() => {
    const arr: { store: string; item: Item }[] = [];
    (data?.by_store ?? []).forEach((b) => b.flat.forEach((it) => arr.push({ store: b.store, item: it })));
    (data?.general ?? []).forEach((b) => b.flat.forEach((it) => arr.push({ store: `alg:${b.store}`, item: it })));
    return arr;
  }, [data]);

  const totalCount = allItems.length;
  const doneCount = useMemo(() => allItems.filter((x) => checked.has(key(x.store, x.item))).length, [allItems, checked]);

  const toggle = (k: string) => {
    Haptics.selectionAsync().catch(() => {});
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      storage.setItem(storageKey, Array.from(next));
      return next;
    });
  };

  const shareLines = () => {
    const lines: string[] = [`🛒 Boodschappenlijst${camp?.name ? ` – ${camp.name}` : ""}`, ""];
    totalBlocks.forEach((b) => {
      if (multi || b.label === "Algemeen") lines.push(`== ${b.label.toUpperCase()} ==`);
      b.grouped.forEach((g) => {
        lines.push(g.aisle.toUpperCase());
        g.items.forEach((i) => lines.push(`• ${i.name}: ${formatQty(i.qty)} ${i.unit}`));
      });
      lines.push("");
    });
    lines.push("Gemaakt met Boodschappenlijstje");
    return lines.join("\n");
  };

  const onShare = async () => {
    if (totalCount === 0) return;
    try {
      await Share.share({ message: shareLines() });
    } catch {
      /* cancelled */
    }
  };

  const onExportPdf = async () => {
    if (totalCount === 0) return;
    const blocks = totalBlocks
      .map((b) => {
        const head = multi || b.label === "Algemeen" ? `<h2 style="color:#1C1B1A;font-size:17px;margin:20px 0 4px">${b.label}</h2>` : "";
        const groups = b.grouped
          .map((g) => {
            const items = g.items
              .map(
                (i) =>
                  `<tr><td style="padding:6px 0;border-bottom:1px solid #eee">${i.name}</td>` +
                  `<td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right;font-weight:600">${formatQty(i.qty)} ${i.unit}</td></tr>`,
              )
              .join("");
            return `<h3 style="color:#2E5E38;margin:12px 0 4px;font-size:14px">${g.aisle}</h3><table style="width:100%;border-collapse:collapse;font-size:14px">${items}</table>`;
          })
          .join("");
        return head + groups;
      })
      .join("");
    const html = `<html><head><meta charset="utf-8"/></head><body style="font-family:Arial,sans-serif;color:#1C1B1A;padding:24px">
      <h1 style="color:#2E5E38;font-size:22px;margin:0 0 4px">Boodschappenlijst</h1>
      <p style="color:#777;margin:0 0 8px">${camp?.name ?? ""}</p>${blocks}
      <p style="color:#999;font-size:11px;margin-top:24px">Gemaakt met Boodschappenlijstje</p></body></html>`;
    try {
      if (Platform.OS === "web") {
        await Print.printAsync({ html });
        return;
      }
      const { uri } = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: "Boodschappenlijst (PDF)" });
      } else {
        toast.show("Delen is niet beschikbaar op dit toestel", "error");
      }
    } catch {
      toast.show("Exporteren mislukt", "error");
    }
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable testID="back-button" onPress={() => goBack()} hitSlop={10} style={styles.headerBtn}>
          <Icon name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Boodschappen</Text>
          {totalCount > 0 ? (
            <Text style={styles.headerSub}>
              {doneCount}/{totalCount} afgevinkt
            </Text>
          ) : null}
        </View>
        <View style={styles.headerActions}>
          <Pressable testID="reset-button" onPress={() => { setChecked(new Set()); storage.removeItem(storageKey); }} hitSlop={10} style={styles.headerBtn}>
            <Icon name="refresh" size={22} color={colors.brandPrimary} />
          </Pressable>
          <Pressable testID="pdf-button" onPress={onExportPdf} hitSlop={10} style={styles.headerBtn}>
            <Icon name="file-pdf-box" size={23} color={colors.brandPrimary} />
          </Pressable>
          <Pressable testID="share-button" onPress={onShare} hitSlop={10} style={styles.headerBtn}>
            <Icon name="share-variant" size={22} color={colors.brandPrimary} />
          </Pressable>
        </View>
      </View>

      <View style={styles.segmentWrap}>
        <View style={styles.segment}>
          <Pressable testID="tab-total" onPress={() => setTab("total")} style={[styles.segBtn, tab === "total" && styles.segBtnActive]}>
            <Text style={[styles.segText, tab === "total" && styles.segTextActive]}>Totaal</Text>
          </Pressable>
          <Pressable testID="tab-perday" onPress={() => setTab("perday")} style={[styles.segBtn, tab === "perday" && styles.segBtnActive]}>
            <Text style={[styles.segText, tab === "perday" && styles.segTextActive]}>Per dag</Text>
          </Pressable>
        </View>
      </View>

      {isLoading || !loaded ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.brandPrimary} />
        </View>
      ) : totalCount === 0 ? (
        <View style={styles.center}>
          <EmptyState
            icon="cart-outline"
            title="Nog geen boodschappen"
            subtitle="Kies maaltijden of voeg losse producten toe, en markeer minstens één dag als inkoopdag."
          />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32, gap: 16 }}>
          {multi ? (
            <View style={styles.multiBanner}>
              <Icon name="storefront-outline" size={16} color={colors.onBrandTertiary} />
              <Text style={styles.multiText}>Meerdere winkels — elk lijstje staat apart.</Text>
            </View>
          ) : null}
          {tab === "total" && grandTotal > 0 ? (
            <View style={styles.totalCard}>
              <Text style={styles.totalLabel}>Geschat totaal</Text>
              <Text style={styles.totalValue}>{euro(grandTotal)}</Text>
              <Text style={styles.totalHint}>Hele verpakkingen tegen de huidige winkelprijs. Producten zonder prijs tellen niet mee.</Text>
            </View>
          ) : null}
          {tab === "total"
            ? totalBlocks.map((b) => (
                <View key={b.store} style={{ gap: 12 }}>
                  {multi || b.label === "Algemeen" ? (
                    <View style={styles.storeHeader}>
                      <Icon name={b.label === "Algemeen" ? "clipboard-list-outline" : "storefront"} size={18} color={colors.brandPrimary} />
                      <Text style={[styles.storeHeaderText, { flex: 1 }]}>{b.label}</Text>
                      {b.total ? <Text style={styles.storeHeaderText}>{euro(b.total)}</Text> : null}
                    </View>
                  ) : null}
                  {b.grouped.map((g) => (
                    <AisleSection key={`${b.store}-${g.aisle}`} store={b.store} aisle={g.aisle} items={g.items} checked={checked} onToggle={toggle} />
                  ))}
                </View>
              ))
            : (data?.per_day ?? []).map((d) => (
                <View key={d.index} style={styles.dayBlock}>
                  <View style={styles.dayHeader}>
                    <Text style={styles.dayTitle}>Dag {d.index + 1}</Text>
                    <Text style={styles.dayMeta}>
                      {d.adults} volw · {d.children} kind
                    </Text>
                  </View>
                  {d.by_store.length === 0 ? (
                    <Text style={styles.emptyDay}>Geen producten voor deze dag</Text>
                  ) : (
                    d.by_store.map((b) => (
                      <View key={`${d.index}-${b.store}`} style={{ gap: 8 }}>
                        {multi ? <Text style={styles.dayStore}>{b.store}</Text> : null}
                        <View style={styles.card}>
                          {b.flat.map((i, idx) => (
                            <ItemRow
                              key={`day${d.index}-${key(b.store, i)}`}
                              item={i}
                              checked={checked.has(`day${d.index}-${key(b.store, i)}`)}
                              onToggle={() => toggle(`day${d.index}-${key(b.store, i)}`)}
                              last={idx === b.flat.length - 1}
                            />
                          ))}
                        </View>
                      </View>
                    ))
                  )}
                </View>
              ))}
        </ScrollView>
      )}
    </View>
  );
}

function AisleSection({
  store,
  aisle,
  items,
  checked,
  onToggle,
}: {
  store: string;
  aisle: string;
  items: Item[];
  checked: Set<string>;
  onToggle: (k: string) => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const sorted = [...items].sort((a, b) => Number(checked.has(key(store, a))) - Number(checked.has(key(store, b))));
  return (
    <View>
      <View style={styles.aisleHeader}>
        <Icon name={(AISLE_ICONS[aisle] ?? "cart-outline") as any} size={16} color={colors.brandSecondary} />
        <Text style={styles.aisleTitle}>{aisle}</Text>
      </View>
      <View style={styles.card}>
        {sorted.map((i, idx) => (
          <ItemRow
            key={key(store, i)}
            item={i}
            checked={checked.has(key(store, i))}
            onToggle={() => onToggle(key(store, i))}
            last={idx === sorted.length - 1}
          />
        ))}
      </View>
    </View>
  );
}

function ItemRow({ item, checked, onToggle, last }: { item: Item; checked: boolean; onToggle: () => void; last?: boolean }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const toast = useToast();
  // Wisselen naar het voordeligere product: alleen voor deze lijst
  const swap = async (b: PackBetter) => {
    try {
      await api(`/camps/${id}/product-swap`, { method: "POST", body: { from_id: item.product_id, to_id: b.product_id } });
      qc.invalidateQueries({ queryKey: ["shopping"] });
      qc.invalidateQueries({ queryKey: ["budget"] });
      toast.show(`Gewisseld naar ${b.name}`, "success");
    } catch (e: any) {
      toast.show(e?.message ?? "Wisselen lukte niet", "error");
    }
  };
  return (
    <View style={!last && styles.itemRowBorder}>
    <Pressable testID={`item-${item.name.toLowerCase()}`} onPress={onToggle} style={styles.itemRow}>
      <Icon name={checked ? "checkbox-marked-circle" : "checkbox-blank-circle-outline"} size={24} color={checked ? colors.success : colors.borderStrong} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.itemName, checked && styles.itemNameChecked]}>{item.name}</Text>
        {item.packs ? (
          <Text style={styles.itemPack} numberOfLines={1}>
            {packText(item.packs, item.pack_unit)}
          </Text>
        ) : null}
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={[styles.itemQty, checked && styles.itemQtyChecked]}>
          {formatQty(item.qty)} {item.unit}
        </Text>
        {item.price ? <Text style={styles.itemPrice}>{euro(item.price)}</Text> : null}
      </View>
    </Pressable>
      {item.better && !checked ? (
        <View style={{ paddingLeft: 36, paddingBottom: 12, marginTop: -8 }}>
          <BetterPack better={item.better} current={item.product} onSwap={item.product_id ? swap : undefined} />
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  itemPack: { fontSize: 12, fontFamily: fonts.regular, color: colors.muted, marginTop: 1 },
  itemPrice: { fontSize: 12, fontFamily: fonts.semibold, color: colors.onSurfaceSecondary, marginTop: 1 },
  totalCard: { borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 2, backgroundColor: colors.surfaceSecondary },
  totalLabel: { fontSize: 13, fontFamily: fonts.medium, color: colors.muted },
  totalValue: { fontSize: 26, fontFamily: fonts.bold, color: colors.onSurface },
  totalHint: { fontSize: 12, fontFamily: fonts.regular, color: colors.muted, marginTop: 2 },
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingBottom: 10 },
  headerBtn: { width: 44, height: 40, alignItems: "center", justifyContent: "center" },
  headerActions: { flexDirection: "row", alignItems: "center" },
  headerTitle: { fontSize: 20, fontFamily: fonts.bold, color: colors.onSurface, textAlign: "center" },
  headerSub: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted, textAlign: "center", marginTop: 1 },
  segmentWrap: { paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.divider },
  segment: { flexDirection: "row", backgroundColor: colors.surfaceTertiary, borderRadius: 12, padding: 4 },
  segBtn: { flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: "center" },
  segBtnActive: { backgroundColor: colors.surface },
  segText: { fontSize: 14, fontFamily: fonts.medium, color: colors.muted },
  segTextActive: { color: colors.onSurface, fontFamily: fonts.semibold },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  multiBanner: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.brandTertiary, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, padding: 10 },
  multiText: { fontSize: 13, fontFamily: fonts.semibold, color: colors.onBrandTertiary, flex: 1 },
  storeHeader: { flexDirection: "row", alignItems: "center", gap: 8, paddingBottom: 2 },
  storeHeaderText: { fontSize: 17, fontFamily: fonts.bold, color: colors.onSurface },
  aisleHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8, paddingHorizontal: 4 },
  aisleTitle: { fontSize: 13, fontFamily: fonts.bold, color: colors.onSurfaceSecondary, textTransform: "uppercase", letterSpacing: 0.5 },
  card: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14 },
  itemRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14 },
  itemRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.divider },
  itemName: { flex: 1, fontSize: 15, fontFamily: fonts.medium, color: colors.onSurface },
  itemNameChecked: { color: colors.muted, textDecorationLine: "line-through" },
  itemQty: { fontSize: 15, fontFamily: fonts.semibold, color: colors.brandPrimary },
  itemQtyChecked: { color: colors.muted, textDecorationLine: "line-through" },
  dayBlock: { gap: 10 },
  dayHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 4 },
  dayTitle: { fontSize: 17, fontFamily: fonts.bold, color: colors.onSurface },
  dayMeta: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted },
  dayStore: { fontSize: 13, fontFamily: fonts.bold, color: colors.brandPrimary, paddingHorizontal: 4 },
  emptyDay: { fontSize: 14, fontFamily: fonts.regular, color: colors.muted, paddingHorizontal: 4 },
}));
