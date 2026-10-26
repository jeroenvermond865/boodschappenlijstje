import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, Linking, Modal, Platform, Pressable, ScrollView, Share, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";

import { EmptyState, Icon } from "@/src/components/ui";
import { api } from "@/src/api";
import { cachedApi, offlineText } from "@/src/offline";
import { BetterPack, PackBetter, packText } from "@/src/packs";
import { ShopSwapSheet } from "@/src/ShopSwap";
import { AISLE_ICONS, formatQty } from "@/src/constants";
import { goBack } from "@/src/nav";
import { useToast } from "@/src/toast";
import { usePremium } from "@/src/premium";
import { RouteSheet, useRoute } from "@/src/route";
import { CompareCard, type CompareStore } from "@/src/CompareCard";
import { storage } from "@/src/utils/storage";
import { fonts, makeStyles, useTheme } from "@/src/theme";

type Item = { name: string; unit: string; aisle: string; qty: number; packs?: number; pack_unit?: string; price?: number; product?: string; product_id?: string; image?: string | null; better?: PackBetter | null; in_pantry?: number; was?: { store: string; price: number }; promo_then?: { label: string; start?: string | null; period?: string | null } };
type Grouped = { aisle: string; items: Item[] };
type StoreBlock = { store: string; grouped: Grouped[]; flat: Item[]; total?: number; saving?: number };

const euro = (n: number) => `€ ${n.toFixed(2).replace(".", ",")}`;
type PerDay = { index: number; adults: number; children: number; by_store: StoreBlock[] };
type ShoppingData = { by_store: StoreBlock[]; general: StoreBlock[]; per_day: PerDay[]; stores: string[]; multi_store: boolean; has_pantry?: boolean; shop_day?: string | null; promo_then?: number; shop_store?: string | null; split_stores?: string[] };

const key = (store: string, i: Item) => `${store}|${i.name.toLowerCase()}|${i.unit}`;
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export default function ShoppingScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const qc = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [tab, setTab] = useState<"total" | "perday">("total");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [shareOpen, setShareOpen] = useState(false);
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const storageKey = `checked_${id}`;

  // Samen afvinken: wat een ander afvinkt komt elke paar seconden binnen; zonder internet onthouden we
  // jouw vinkjes en sturen ze later alsnog
  const queueKey = `checked_queue_${id}`;
  const queue = useRef<{ on: string[]; off: string[] }>({ on: [], off: [] });
  const busy = useRef(0);

  useEffect(() => {
    (async () => {
      const saved = await storage.getItem<string[] | null>(storageKey, null);
      if (saved && Array.isArray(saved)) setChecked(new Set(saved));
      const q = await storage.getItem<string | null>(queueKey, null);
      if (q) queue.current = JSON.parse(q);
      setLoaded(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const flush = async () => {
    const q = queue.current;
    if (!q.on.length && !q.off.length) return true;
    queue.current = { on: [], off: [] };
    busy.current++;
    try {
      await api(`/camps/${id}/checked`, { method: "POST", body: q });
      if (!queue.current.on.length && !queue.current.off.length) storage.removeItem(queueKey);
      return true;
    } catch {
      queue.current = { on: [...new Set([...q.on, ...queue.current.on])], off: [...new Set([...q.off, ...queue.current.off])] };
      storage.setItem(queueKey, JSON.stringify(queue.current));
      return false;
    } finally {
      busy.current--;
    }
  };
  const live = useQuery({
    queryKey: ["checked", id],
    queryFn: async () => {
      await flush();
      return api<{ keys: string[]; by: Record<string, string>; shared: boolean }>(`/camps/${id}/checked`);
    },
    enabled: loaded,
    refetchInterval: 5000,
  });
  const seeded = useRef(false);
  const lastSave = useRef(0);
  useEffect(() => {
    const d = live.data;
    // Een antwoord van vóór je laatste vinkje is al achterhaald
    if (!d || busy.current || queue.current.on.length || queue.current.off.length || live.dataUpdatedAt < lastSave.current + 2000) return;
    if (!seeded.current) {
      seeded.current = true;
      // Eerste keer: wat je hier al had afgevinkt (van voor samen afvinken) ook naar de anderen
      const mine = [...checked].filter((k) => !d.keys.includes(k));
      if (mine.length) {
        queue.current = { on: mine, off: [] };
        flush();
        return;
      }
    }
    const next = new Set(d.keys);
    if (next.size !== checked.size || [...next].some((k) => !checked.has(k))) {
      setChecked(next);
      storage.setItem(storageKey, Array.from(next));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.data]);
  const save = (next: Set<string>) => {
    const on = [...next].filter((k) => !checked.has(k));
    const off = [...checked].filter((k) => !next.has(k));
    lastSave.current = Date.now();
    setChecked(next);
    storage.setItem(storageKey, Array.from(next));
    queue.current = {
      on: [...new Set([...queue.current.on.filter((k) => !off.includes(k)), ...on])],
      off: [...new Set([...queue.current.off.filter((k) => !on.includes(k)), ...off])],
    };
    storage.setItem(queueKey, JSON.stringify(queue.current));
    flush();
  };

  const { data, isLoading } = useQuery({
    queryKey: ["shopping", id],
    queryFn: () => cachedApi<ShoppingData>(`/camps/${id}/shopping-list`),
  });
  const { data: camp } = useQuery({
    queryKey: ["camp", id],
    queryFn: () => cachedApi<{ name: string }>(`/camps/${id}`),
  });

  // Waar is deze lijst het goedkoopst? Wordt op de achtergrond uitgerekend, dus even later nog eens vragen
  const [showCompare, setShowCompare] = useState(true);
  const cmp = useQuery({
    queryKey: ["compare", id],
    queryFn: () => api<{ compare: CompareStore[] | null; compare_pending?: boolean; shop_store?: string | null }>(`/camps/${id}/compare`),
    enabled: !!data && !data.offline_at,
    staleTime: 60 * 1000,
    refetchInterval: (q) => (q.state.data?.compare_pending ? 4000 : false),
  });
  const cmpFound = (cmp.data?.compare ?? []).filter((c) => c.found > 0);
  const cmpBest = cmpFound.length > 1 ? cmpFound.reduce((a, b) => ((b.total_fair ?? b.total) < (a.total_fair ?? a.total) ? b : a)) : null;
  const backToOwn = async () => {
    try {
      await api(`/camps/${id}/shop-store`, { method: "POST", body: { store: null } });
      await Promise.all(["shopping", "compare", "home", "budget"].map((k) => qc.invalidateQueries({ queryKey: k === "home" ? [k] : [k, id] })));
    } catch (e: any) {
      toast.show(e?.message ?? "Dat lukte niet", "error");
    }
  };

  const multi = data?.multi_store ?? false;
  const premium = usePremium();
  const route = useRoute();
  const onRoute = premium && route.on;
  const [routeEdit, setRouteEdit] = useState<string | null>(null);
  // Algemeen block first, then each store's totals
  const totalBlocks: { store: string; label: string; grouped: Grouped[]; total?: number }[] = useMemo(() => {
    if (!data) return [];
    const out: { store: string; label: string; grouped: Grouped[]; total?: number }[] = [];
    (data.general ?? []).forEach((b) =>
      out.push({ store: `alg:${b.store}`, label: multi ? `Algemeen · ${b.store}` : "Algemeen", grouped: b.grouped, total: b.total }),
    );
    (data.by_store ?? []).forEach((b) => out.push({ store: b.store, label: b.store, grouped: b.grouped, total: b.total }));
    // Looproute: afdelingen in de volgorde van de winkel (ook bij delen en printen)
    return onRoute ? out.map((b) => ({ ...b, grouped: route.sort(b.store, b.grouped) })) : out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, multi, onRoute, route.version]);
  // "Algemeen" staat ook al in de winkeltotalen; het totaal is de som van de winkels
  const grandTotal = (data?.by_store ?? []).reduce((n, b) => n + (b.total ?? 0), 0);
  const promoSaving = (data?.by_store ?? []).reduce((n, b) => n + (b.saving ?? 0), 0);

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
    save(next);
  };

  // Voorraadkast (Premium): alles wat je al genoeg in huis hebt in één keer afvinken
  const covered = allItems.filter((x) => (x.item.in_pantry ?? 0) >= x.item.qty && !shown.has(key(x.store, x.item)));
  const checkPantry = () => {
    const next = new Set(checked);
    covered.forEach((x) => {
      const t = key(x.store, x.item);
      [t, ...(parts.byTotal.get(t) ?? [])].forEach((k) => next.add(k));
    });
    save(next);
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
          <Pressable testID="reset-button" onPress={() => save(new Set())} hitSlop={10} style={styles.headerBtn}>
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
          {data?.offline_at ? (
            <View style={styles.multiBanner}>
              <Icon name="wifi-off" size={16} color={colors.onBrandTertiary} />
              <Text style={styles.multiText}>{offlineText(data.offline_at)} Afvinken werkt gewoon.</Text>
            </View>
          ) : null}
          {live.data?.shared ? (
            <View style={styles.multiBanner}>
              <Icon name="account-multiple-check-outline" size={16} color={colors.onBrandTertiary} />
              <Text style={styles.multiText}>Samen boodschappen doen: wat de anderen afvinken, zie je hier meteen.</Text>
            </View>
          ) : null}
          {data?.shop_store ? (
            <View style={styles.multiBanner}>
              <Icon name="cart-check" size={16} color={colors.onBrandTertiary} />
              <Text style={styles.multiText}>
                {data.shop_store === "split"
                  ? `Je haalt elk product waar het het goedkoopst is: ${(data.split_stores ?? []).join(" en ")}.`
                  : `Je haalt alles bij ${data.shop_store}, met de producten uit de vergelijking.`}{" "}
                <Text onPress={backToOwn} style={{ fontFamily: fonts.bold, textDecorationLine: "underline" }}>
                  Terug naar je eigen winkels
                </Text>
              </Text>
            </View>
          ) : null}
          {cmp.data && (cmp.data.compare_pending || cmpFound.length > 1) ? (
            <View style={{ gap: 10 }}>
              <Pressable testID="shopping-compare-toggle" onPress={() => setShowCompare((v) => !v)} style={styles.pantryLink}>
                <Icon name="scale-balance" size={16} color={colors.brandPrimary} />
                <Text style={[styles.pantryLinkText, { flex: 1 }]}>
                  {cmpBest ? `Waar is je lijst het goedkoopst? ${cmpBest.store}` : "Waar is je lijst het goedkoopst?"}
                </Text>
                <Icon name={showCompare ? "chevron-up" : "chevron-down"} size={18} color={colors.brandPrimary} />
              </Pressable>
              {showCompare ? (
                <CompareCard
                  campId={id}
                  campName={camp?.name ?? "je lijst"}
                  compare={cmp.data.compare}
                  pending={cmp.data.compare_pending}
                  shopStore={data?.shop_store}
                  noTitle
                />
              ) : null}
            </View>
          ) : null}
          {data?.promo_then ? (
            <View style={styles.multiBanner}>
              <Icon name="tag-outline" size={16} color={colors.onBrandTertiary} />
              <Text style={styles.multiText}>
                Op je inkoopdag ({new Date(data.shop_day!).toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" })}) zijn{" "}
                {data.promo_then === 1 ? "1 product" : `${data.promo_then} producten`} in de aanbieding. Ze staan hieronder gemarkeerd.
              </Text>
            </View>
          ) : null}
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
          {tab === "total" && data?.by_store?.length ? (
            <View style={styles.routeRow}>
              <Pressable
                testID="route-toggle"
                onPress={() => (premium ? route.setOn(!route.on) : router.push("/premium"))}
                style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1 }}
              >
                <Icon name={onRoute ? "checkbox-marked" : "checkbox-blank-outline"} size={20} color={colors.brandPrimary} />
                <Text style={styles.pantryLinkText}>Op looproute van de winkel{premium ? "" : " (Premium)"}</Text>
              </Pressable>
              {onRoute ? (
                <Pressable onPress={() => setRouteEdit(data.by_store[0].store)} hitSlop={8}>
                  <Text style={styles.pantryLinkText}>Aanpassen</Text>
                </Pressable>
              ) : null}
            </View>
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
                      {onRoute && multi && !b.store.startsWith("alg:") ? (
                        <Pressable onPress={() => setRouteEdit(b.store)} hitSlop={8}>
                          <Icon name="map-marker-path" size={18} color={colors.brandPrimary} />
                        </Pressable>
                      ) : null}
                      {b.total ? <Text style={styles.storeHeaderText}>{euro(b.total)}</Text> : null}
                    </View>
                  ) : null}
                  {b.grouped.map((g) => (
                    <AisleSection key={`${b.store}-${g.aisle}`} store={b.store} aisle={g.aisle} items={g.items} checked={shown} onToggle={toggle} by={live.data?.by} />
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
                              store={b.store}
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
      {routeEdit ? (
        <RouteSheet store={routeEdit} order={route.order(routeEdit)} onChange={(o) => route.setOrder(routeEdit, o)} onClose={() => setRouteEdit(null)} />
      ) : null}

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
  by,
}: {
  store: string;
  aisle: string;
  items: Item[];
  checked: Set<string>;
  onToggle: (k: string) => void;
  by?: Record<string, string>;
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
            by={checked.has(key(store, i)) ? by?.[key(store, i)] : undefined}
            store={store}
          />
        ))}
      </View>
    </View>
  );
}

function ItemRow({ item, checked, onToggle, last, by, store }: { item: Item; checked: boolean; onToggle: () => void; last?: boolean; by?: string; store?: string }) {
  const [swapOpen, setSwapOpen] = useState(false);
  const styles = useStyles();
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const toast = useToast();
  const router = useRouter();
  // Product openen: foto, prijs bij andere winkels en waar het ligt
  const open = item.product_id ? () => router.push({ pathname: "/product/[id]", params: { id: item.product_id! } }) : undefined;
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
      {item.image ? (
        <Pressable onPress={open} hitSlop={4} testID={`item-image-${item.name.toLowerCase()}`}>
          <Image source={{ uri: item.image }} style={[styles.itemImg, checked && { opacity: 0.4 }]} resizeMode="contain" />
        </Pressable>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text style={[styles.itemName, checked && styles.itemNameChecked]}>{item.name}</Text>
        {item.product && open ? (
          <Pressable onPress={open} hitSlop={4} style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
            <Text style={styles.itemProduct} numberOfLines={1}>{item.product}</Text>
            <Icon name="chevron-right" size={14} color={colors.brandPrimary} />
          </Pressable>
        ) : null}
        {item.packs ? (
          <Text style={styles.itemPack} numberOfLines={1}>
            {packText(item.packs, item.pack_unit)}
          </Text>
        ) : null}
        {item.was && item.price ? (
          <Text style={styles.itemWas} numberOfLines={1}>
            Bij {item.was.store} {euro(item.was.price)}, hier {euro(item.price)}
          </Text>
        ) : null}
        {by ? <Text style={styles.itemPack}>Afgevinkt door {by}</Text> : null}
        {item.promo_then ? (
          <Text style={styles.itemPromo} numberOfLines={2}>
            {item.promo_then.label}
            {item.promo_then.period ? ` · ${item.promo_then.period}` : ""}
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
      {item.product_id && !checked ? (
        <Pressable onPress={() => setSwapOpen(true)} hitSlop={8} style={{ paddingLeft: 4 }} testID={`item-swap-${item.name.toLowerCase()}`}>
          <Icon name="swap-horizontal" size={22} color={colors.brandPrimary} />
        </Pressable>
      ) : null}
    </Pressable>
      <ShopSwapSheet
        item={swapOpen ? item : null}
        store={store ?? ""}
        onClose={() => setSwapOpen(false)}
        onPick={(p) => swap({ product_id: p.id, name: p.name } as PackBetter)}
      />
      {item.better && !checked ? (
        <View style={{ paddingLeft: 36, paddingBottom: 12, marginTop: -8 }}>
          <BetterPack better={item.better} current={item.product} onSwap={item.product_id ? swap : undefined} />
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  itemWas: { fontSize: 12, fontFamily: fonts.semibold, color: colors.success, marginTop: 1 },
  itemImg: { width: 44, height: 44, borderRadius: 8, backgroundColor: "#fff" },
  itemProduct: { fontSize: 12, fontFamily: fonts.semibold, color: colors.brandPrimary, flexShrink: 1 },
  itemPromo: { fontSize: 12, fontFamily: fonts.semibold, color: colors.warning, marginTop: 1 },
  itemPantry: { fontSize: 12, fontFamily: fonts.semibold, color: colors.success, marginTop: 1 },
  itemPack: { fontSize: 12, fontFamily: fonts.regular, color: colors.muted, marginTop: 1 },
  itemPrice: { fontSize: 12, fontFamily: fonts.semibold, color: colors.onSurfaceSecondary, marginTop: 1 },
  totalCard: { borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 2, backgroundColor: colors.surfaceSecondary },
  totalLabel: { fontSize: 13, fontFamily: fonts.medium, color: colors.muted },
  totalValue: { fontSize: 26, fontFamily: fonts.bold, color: colors.onSurface },
  pantryLink: { flexDirection: "row", alignItems: "center", gap: 6 },
  routeRow: { flexDirection: "row", alignItems: "center", gap: 10 },
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
