import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Linking, Modal, Platform, Pressable, ScrollView, Share, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
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
import { usePremium } from "@/src/premium";
import { storage } from "@/src/utils/storage";
import { fonts, makeStyles, useTheme } from "@/src/theme";

type Item = { name: string; unit: string; aisle: string; qty: number; packs?: number; pack_unit?: string; price?: number; product?: string; product_id?: string; better?: PackBetter | null; in_pantry?: number };
type Grouped = { aisle: string; items: Item[] };
type StoreBlock = { store: string; grouped: Grouped[]; flat: Item[]; total?: number; saving?: number };

const euro = (n: number) => `€ ${n.toFixed(2).replace(".", ",")}`;
type PerDay = { index: number; adults: number; children: number; by_store: StoreBlock[] };
type ShoppingData = { by_store: StoreBlock[]; general: StoreBlock[]; per_day: PerDay[]; stores: string[]; multi_store: boolean; has_pantry?: boolean };

const key = (store: string, i: Item) => `${store}|${i.name.toLowerCase()}|${i.unit}`;
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export default function ShoppingScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [tab, setTab] = useState<"total" | "perday">("total");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [shareOpen, setShareOpen] = useState(false);
  const [onlyOpen, setOnlyOpen] = useState(false);
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
  const promoSaving = (data?.by_store ?? []).reduce((n, b) => n + (b.saving ?? 0), 0);
  const premium = usePremium();

  // Elk product staat één keer in het winkeltotaal; per dag en bij "Algemeen" zijn dat delen ervan.
  // Afvinken houden we op alle plekken gelijk: totaal af = alle delen af, alle delen af = totaal af.
  const allItems = useMemo(() => {
    const arr: { store: string; item: Item }[] = [];
    (data?.by_store ?? []).forEach((b) => b.flat.forEach((it) => arr.push({ store: b.store, item: it })));
    return arr;
  }, [data]);
  const parts = useMemo(() => {
    const byTotal = new Map<string, string[]>();
    const totalOf = new Map<string, string>();
    const totals = new Set(allItems.map((x) => key(x.store, x.item)));
    const link = (t: string, part: string) => {
      if (!totals.has(t)) return;
      byTotal.set(t, [...(byTotal.get(t) ?? []), part]);
      totalOf.set(part, t);
    };
    (data?.general ?? []).forEach((b) => b.flat.forEach((it) => link(key(b.store, it), key(`alg:${b.store}`, it))));
    (data?.per_day ?? []).forEach((d) => d.by_store.forEach((b) => b.flat.forEach((it) => link(key(b.store, it), `day${d.index}-${key(b.store, it)}`))));
    return { byTotal, totalOf };
  }, [data, allItems]);

  // Wat je op het scherm afgevinkt ziet
  const shown = useMemo(() => {
    const out = new Set(checked);
    parts.byTotal.forEach((ps, t) => {
      if (checked.has(t)) ps.forEach((p) => out.add(p));
      else if (ps.length && ps.every((p) => checked.has(p))) out.add(t);
    });
    return out;
  }, [checked, parts]);

  const totalCount = allItems.length;
  const doneCount = useMemo(() => allItems.filter((x) => shown.has(key(x.store, x.item))).length, [allItems, shown]);

  const toggle = (k: string) => {
    Haptics.selectionAsync().catch(() => {});
    const on = !shown.has(k);
    const t = parts.byTotal.has(k) ? k : parts.totalOf.get(k);
    const ps = t ? parts.byTotal.get(t) ?? [] : [];
    const next = new Set(checked);
    if (!t) {
      if (on) next.add(k);
      else next.delete(k);
    } else if (k === t) {
      [t, ...ps].forEach((x) => (on ? next.add(x) : next.delete(x)));
    } else if (on) {
      next.add(k);
      if (ps.every((p) => next.has(p))) next.add(t);
    } else {
      // Eén deel weer open: het totaal is dan ook niet meer helemaal af, de andere delen blijven zoals je ze zag
      ps.forEach((p) => (shown.has(p) ? next.add(p) : next.delete(p)));
      next.delete(k);
      next.delete(t);
    }
    setChecked(next);
    storage.setItem(storageKey, Array.from(next));
  };

  // Voorraadkast (Premium): alles wat je al genoeg in huis hebt in één keer afvinken
  const covered = allItems.filter((x) => (x.item.in_pantry ?? 0) >= x.item.qty && !shown.has(key(x.store, x.item)));
  const checkPantry = () => {
    const next = new Set(checked);
    covered.forEach((x) => {
      const t = key(x.store, x.item);
      [t, ...(parts.byTotal.get(t) ?? [])].forEach((k) => next.add(k));
    });
    setChecked(next);
    storage.setItem(storageKey, Array.from(next));
    toast.show(`${covered.length} ${covered.length === 1 ? "product" : "producten"} afgevinkt`, "success");
  };

  const isDone = (store: string, i: Item) => shown.has(key(store, i));

  const shareLines = (open = false) => {
    const lines: string[] = [`🛒 Boodschappenlijst${camp?.name ? ` – ${camp.name}` : ""}`];
    if (open) lines.push("(alleen wat nog niet is afgevinkt)");
    lines.push("");
    totalBlocks.forEach((b) => {
      const groups = b.grouped
        .map((g) => ({ aisle: g.aisle, items: g.items.filter((i) => !(open && isDone(b.store, i))) }))
        .filter((g) => g.items.length);
      if (!groups.length) return;
      if (multi || b.label === "Algemeen") lines.push(`== ${b.label.toUpperCase()} ==`);
      groups.forEach((g) => {
        lines.push(g.aisle.toUpperCase());
        g.items.forEach((i) => lines.push(`${isDone(b.store, i) ? "✅" : "▫️"} ${i.name}: ${formatQty(i.qty)} ${i.unit}`));
      });
      if (b.total && !open) lines.push(`Geschat totaal: ${euro(b.total)}`);
      lines.push("");
    });
    lines.push("Gemaakt met Slim Boodschappenlijstje");
    return lines.join("\n");
  };

  const onShare = () => {
    if (totalCount === 0) return;
    setShareOpen(true);
  };

  const shareVia = async (how: "whatsapp" | "mail" | "copy" | "other") => {
    const text = shareLines(onlyOpen);
    const title = `Boodschappenlijst${camp?.name ? ` – ${camp.name}` : ""}`;
    setShareOpen(false);
    try {
      if (how === "whatsapp") await Linking.openURL(`https://wa.me/?text=${encodeURIComponent(text)}`);
      else if (how === "mail") await Linking.openURL(`mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(text)}`);
      else if (how === "copy") {
        await (globalThis as any).navigator.clipboard.writeText(text);
        toast.show("Lijst gekopieerd");
      } else await Share.share({ message: text, title });
    } catch {
      if (how === "copy") toast.show("Kopiëren lukt niet in deze browser", "error");
    }
  };
  const canCopy = Platform.OS === "web" && !!(globalThis as any).navigator?.clipboard;
  const canNativeShare = Platform.OS !== "web" || !!(globalThis as any).navigator?.share;

  const onExportPdf = async () => {
    if (totalCount === 0) return;
    const blocks = totalBlocks
      .map((b) => {
        const head = multi || b.label === "Algemeen" ? `<h2 style="color:#1C1B1A;font-size:17px;margin:20px 0 4px">${esc(b.label)}</h2>` : "";
        const td = "padding:6px 0;border-bottom:1px solid #eee";
        const groups = b.grouped
          .map((g) => {
            const items = g.items
              .map(
                (i) =>
                  `<tr><td style="${td};width:22px;font-size:16px;color:#2E5E38">${isDone(b.store, i) ? "&#9745;" : "&#9744;"}</td>` +
                  `<td style="${td}">${esc(i.name)}${i.product ? `<br/><span style="color:#888;font-size:11px">${esc(i.packs ? `${packText(i.packs, i.pack_unit)} · ` : "")}${esc(i.product)}</span>` : ""}</td>` +
                  `<td style="${td};text-align:right;font-weight:600;white-space:nowrap">${formatQty(i.qty)} ${esc(i.unit)}</td>` +
                  `<td style="${td};text-align:right;color:#555;white-space:nowrap;padding-left:10px">${i.price ? euro(i.price) : ""}</td></tr>`,
              )
              .join("");
            return `<h3 style="color:#2E5E38;margin:12px 0 4px;font-size:14px">${esc(g.aisle)}</h3><table style="width:100%;border-collapse:collapse;font-size:14px">${items}</table>`;
          })
          .join("");
        const total = b.total ? `<p style="text-align:right;font-weight:700;margin:8px 0 0">Geschat totaal: ${euro(b.total)}</p>` : "";
        return head + groups + total;
      })
      .join("");
    const html = `<html><head><meta charset="utf-8"/></head><body style="font-family:Arial,sans-serif;color:#1C1B1A;padding:24px">
      <h1 style="color:#2E5E38;font-size:22px;margin:0 0 4px">Boodschappenlijst</h1>
      <p style="color:#777;margin:0 0 8px">${esc(camp?.name ?? "")}</p>${blocks}
      ${multi && grandTotal ? `<p style="text-align:right;font-size:16px;font-weight:700;margin-top:16px">Totaal alle winkels: ${euro(grandTotal)}</p>` : ""}
      <p style="color:#999;font-size:11px;margin-top:24px">Prijzen zijn een schatting op basis van de websites van supermarkten. Gemaakt met Slim Boodschappenlijstje.</p></body></html>`;
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
          {premium && !(data?.has_pantry && covered.length) ? (
            <Pressable style={styles.pantryLink} onPress={() => router.push("/pantry")} testID="shopping-pantry-link">
              <Icon name="fridge-outline" size={16} color={colors.brandPrimary} />
              <Text style={styles.pantryLinkText}>Al iets in huis? Zet het in je voorraadkast</Text>
            </Pressable>
          ) : null}
          {data?.has_pantry && covered.length ? (
            <Pressable style={styles.multiBanner} onPress={checkPantry} testID="pantry-check">
              <Icon name="fridge-outline" size={18} color={colors.onBrandTertiary} />
              <Text style={styles.multiText}>
                {covered.length} {covered.length === 1 ? "product heb" : "producten heb"} je al genoeg in huis. Tik om af te vinken.
              </Text>
            </Pressable>
          ) : null}
          {tab === "total" && grandTotal > 0 ? (
            <View style={styles.totalCard}>
              <Text style={styles.totalLabel}>Geschat totaal</Text>
              <Text style={styles.totalValue}>{euro(grandTotal)}</Text>
              <Text style={styles.totalHint}>Hele verpakkingen tegen de huidige winkelprijs. Producten zonder prijs tellen niet mee.</Text>
              {premium && promoSaving > 0 ? (
                <Pressable onPress={() => router.push("/savings")} testID="promo-saving">
                  <Text style={styles.savingText}>Aanbiedingen schelen je {euro(promoSaving)} op deze lijst. Bekijk je bespaaroverzicht</Text>
                </Pressable>
              ) : null}
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
                    <AisleSection key={`${b.store}-${g.aisle}`} store={b.store} aisle={g.aisle} items={g.items} checked={shown} onToggle={toggle} />
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
                              checked={shown.has(`day${d.index}-${key(b.store, i)}`)}
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

      <Modal visible={shareOpen} transparent animationType="fade" onRequestClose={() => setShareOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setShareOpen(false)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <Text style={styles.modalTitle}>Lijst delen</Text>
            {doneCount > 0 ? (
              <Pressable testID="share-only-open" onPress={() => setOnlyOpen((v) => !v)} style={styles.shareToggle}>
                <Icon name={onlyOpen ? "checkbox-marked" : "checkbox-blank-outline"} size={22} color={colors.brandPrimary} />
                <Text style={styles.shareToggleText}>Alleen wat nog niet is afgevinkt</Text>
              </Pressable>
            ) : null}
            <ShareOption testID="share-whatsapp" icon="whatsapp" label="WhatsApp" onPress={() => shareVia("whatsapp")} />
            <ShareOption testID="share-mail" icon="email-outline" label="E-mail" onPress={() => shareVia("mail")} />
            {canCopy ? <ShareOption testID="share-copy" icon="content-copy" label="Tekst kopiëren" onPress={() => shareVia("copy")} /> : null}
            {canNativeShare ? <ShareOption testID="share-other" icon="share-variant" label="Andere app" onPress={() => shareVia("other")} /> : null}
            <ShareOption testID="share-print" icon="printer-outline" label="Printen of PDF" onPress={() => { setShareOpen(false); onExportPdf(); }} />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function ShareOption({ icon, label, onPress, testID }: { icon: string; label: string; onPress: () => void; testID: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <Pressable testID={testID} onPress={onPress} style={styles.shareOption}>
      <Icon name={icon} size={22} color={colors.brandPrimary} />
      <Text style={styles.shareOptionText}>{label}</Text>
    </Pressable>
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
        {item.in_pantry ? (
          <Text style={styles.itemPantry} numberOfLines={1}>
            In je voorraadkast: {formatQty(item.in_pantry)} {item.unit}
            {item.in_pantry >= item.qty ? " (genoeg)" : ""}
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
  itemPantry: { fontSize: 12, fontFamily: fonts.semibold, color: colors.success, marginTop: 1 },
  itemPack: { fontSize: 12, fontFamily: fonts.regular, color: colors.muted, marginTop: 1 },
  itemPrice: { fontSize: 12, fontFamily: fonts.semibold, color: colors.onSurfaceSecondary, marginTop: 1 },
  totalCard: { borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 2, backgroundColor: colors.surfaceSecondary },
  totalLabel: { fontSize: 13, fontFamily: fonts.medium, color: colors.muted },
  totalValue: { fontSize: 26, fontFamily: fonts.bold, color: colors.onSurface },
  pantryLink: { flexDirection: "row", alignItems: "center", gap: 6 },
  pantryLinkText: { fontSize: 13, fontFamily: fonts.semibold, color: colors.brandPrimary },
  savingText: { fontSize: 13, fontFamily: fonts.semibold, color: colors.success, marginTop: 6 },
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
  modalBackdrop: { flex: 1, backgroundColor: "rgba(28,27,26,0.5)", justifyContent: "center", padding: 20 },
  modalCard: { backgroundColor: colors.surface, borderRadius: 20, padding: 20, gap: 4, width: "100%", maxWidth: 420, alignSelf: "center" },
  modalTitle: { fontSize: 18, fontFamily: fonts.bold, color: colors.onSurface, marginBottom: 8 },
  shareToggle: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, marginBottom: 4 },
  shareToggleText: { fontSize: 14, fontFamily: fonts.medium, color: colors.onSurfaceSecondary },
  shareOption: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 13, borderTopWidth: 1, borderTopColor: colors.divider },
  shareOptionText: { fontSize: 16, fontFamily: fonts.semibold, color: colors.onSurface },
  emptyDay: { fontSize: 14, fontFamily: fonts.regular, color: colors.muted, paddingHorizontal: 4 },
}));
