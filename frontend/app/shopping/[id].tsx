import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Linking, Platform, Pressable, RefreshControl, ScrollView, Share, Text, View } from "react-native";
import Reanimated, { LinearTransition } from "react-native-reanimated";
import Image from "@/src/components/SafeImage";
import { CheckPop, Confetti, CountUp, SkeletonList } from "@/src/components/motion";
import Modal from "@/src/components/Modal";
import { useHideOnScroll } from "@/src/hideOnScroll";
import { RestockCard } from "@/src/RestockCard";
import { TodayPicks, useToday } from "@/src/TodayCard";
import { TipsTab } from "@/app/slim";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";

import { EmptyState, Icon } from "@/src/components/ui";
import { api, apiBlob } from "@/src/api";
import { cachedApi, offlineText } from "@/src/offline";
import { BetterPack, PackBetter, packText } from "@/src/packs";
import { PriceCompareSheet } from "@/src/PriceCompareSheet";
import { ProductPopup } from "@/src/ProductPopup";
import { ShopSwapSheet } from "@/src/ShopSwap";
import { MembersModal } from "@/app/camp/[id]";
import { useAuth } from "@/src/auth";
import { sliceInfo } from "@/src/slices";
import { AISLE_ICONS, formatQty } from "@/src/constants";
import { goBack } from "@/src/nav";
import { useToast } from "@/src/toast";
import { PremiumValue, useFeature } from "@/src/premium";
import { RouteSheet, useRoute } from "@/src/route";
import { CompareCard, type CompareStore } from "@/src/CompareCard";
import { storage } from "@/src/utils/storage";
import { fonts, makeStyles, softShadow, useTheme } from "@/src/theme";

type Item = { name: string; unit: string; aisle: string; qty: number; packs?: number; pack_unit?: string; price?: number; product?: string; product_id?: string; orig_product_id?: string | null; choose?: "todo" | "auto"; image?: string | null; better?: PackBetter | null; in_pantry?: number; was?: { store: string; price: number; product_id?: string | null; product?: string | null }; promo_then?: { label: string; start?: string | null; period?: string | null } };
type Grouped = { aisle: string; items: Item[] };
type StoreBlock = { store: string; grouped: Grouped[]; flat: Item[]; total?: number; saving?: number };

const euro = (n: number) => `€ ${n.toFixed(2).replace(".", ",")}`;
type PerDay = { index: number; adults: number; children: number; by_store: StoreBlock[] };
type ShoppingData = { premium_value?: number; features?: string[]; by_store: StoreBlock[]; general: StoreBlock[]; per_day: PerDay[]; stores: string[]; multi_store: boolean; has_pantry?: boolean; shop_day?: string | null; promo_then?: number; shop_store?: string | null; split_stores?: string[] };

const key = (store: string, i: Item) => `${store}|${i.name.toLowerCase()}|${i.unit}`;
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export default function ShoppingScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const qc = useQueryClient();
  const { id, day } = useLocalSearchParams<{ id: string; day?: string }>();
  const router = useRouter();

  // Vanaf "Op het menu": meteen alleen het lijstje van die dag, op looproute
  const [onlyDay, setOnlyDay] = useState<number | null>(day != null && day !== "" && !isNaN(Number(day)) ? Number(day) : null);
  const [tab, setTab] = useState<"total" | "perday">(onlyDay != null ? "perday" : "total");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [shareOpen, setShareOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false); // iemand laten meedoen met dit lijstje
  const { user } = useAuth();
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const storageKey = `checked_${id}`;

  // Samen afvinken: wat een ander afvinkt komt elke paar seconden binnen; zonder internet onthouden we
  // jouw vinkjes en sturen ze later alsnog
  const queueKey = `checked_queue_${id}`;
  const queue = useRef<{ on: string[]; off: string[] }>({ on: [], off: [] });
  // Wat je in de winkel afvinkt, heb je gekocht: zo leert de app wat je vaak koopt (Vandaag op Home)
  const bought = useRef<Record<string, { name: string; unit: string; aisle: string; product_id?: string; store: string }>>({});
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
    const meta = Object.fromEntries(Object.entries(bought.current).filter(([k]) => q.on.includes(k)));
    bought.current = {};
    busy.current++;
    try {
      await api(`/camps/${id}/checked`, { method: "POST", body: { ...q, meta } });
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
  const save = (next: Set<string>, learn = false) => {
    const on = [...next].filter((k) => !checked.has(k));
    const off = [...checked].filter((k) => !next.has(k));
    if (learn) {
      on.forEach((k) => {
        const x = allItems.find((a) => key(a.store, a.item) === k);
        if (x) bought.current[k] = { name: x.item.name, unit: x.item.unit, aisle: x.item.aisle, product_id: x.item.product_id, store: x.store };
      });
    }
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

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["shopping", id],
    queryFn: () => cachedApi<ShoppingData>(`/camps/${id}/shopping-list`),
  });
  const { data: camp } = useQuery({
    queryKey: ["camp", id],
    queryFn: () => cachedApi<{ name: string; owner_id?: string }>(`/camps/${id}`),
  });
  // Het snelle lijstje (Vandaag op Home): hier voeg je zelf producten toe
  const todayQ = useToday();
  const [tipsOpen, setTipsOpen] = useState(false); // bespaartips als popup boven het lijstje
  const quick = !!id && todayQ.data?.list?.id === String(id);

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
      toast.show("Terug naar je eigen winkels", "success");
    } catch (e: any) {
      toast.show(e?.message ?? "Dat lukte niet", "error");
    }
  };

  const multi = data?.multi_store ?? false;
  // In andermans lijstje mag je de functies van de eigenaar gebruiken: die stuurt de server mee
  const ownPantry = useFeature("voorraadkast");
  const ownRoute = useFeature("looproute");
  const premium = data?.features ? data.features.includes("voorraadkast") : ownPantry;
  const routeOk = data?.features ? data.features.includes("looproute") : ownRoute;
  const route = useRoute();
  const onRoute = routeOk && route.on;
  const [routeEdit, setRouteEdit] = useState<string | null>(null);
  // Algemeen block first, then each store's totals
  const totalBlocks: { store: string; label: string; grouped: Grouped[]; total?: number }[] = useMemo(() => {
    if (!data) return [];
    const out: { store: string; label: string; grouped: Grouped[]; total?: number }[] = [];
    // Bij het snelle lijstje staat alles al bij de winkel; een apart "Algemeen" zou alles dubbel tonen
    if (!quick)
      (data.general ?? []).forEach((b) =>
        out.push({ store: `alg:${b.store}`, label: multi ? `Algemeen · ${b.store}` : "Algemeen", grouped: b.grouped, total: b.total }),
      );
    (data.by_store ?? []).forEach((b) => out.push({ store: b.store, label: b.store, grouped: b.grouped, total: b.total }));
    // Looproute: afdelingen in de volgorde van de winkel (ook bij delen en printen)
    return onRoute ? out.map((b) => ({ ...b, grouped: route.sort(b.store, b.grouped) })) : out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, multi, onRoute, route.version, quick]);
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

  // Laatste product afgevinkt: een kort feestje (niet als de lijst al af was toen je hem opende)
  const [party, setParty] = useState(0);
  const wasDone = useRef<boolean | null>(null);
  useEffect(() => {
    if (!loaded || !totalCount) return;
    const all = doneCount === totalCount;
    if (wasDone.current === false && all) {
      setParty((n) => n + 1);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
    wasDone.current = all;
  }, [doneCount, totalCount, loaded]);

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
    save(next, true);
  };

  // Voorraadkast (Premium): alles wat je al genoeg in huis hebt in één keer afvinken
  const covered = allItems.filter((x) => (x.item.in_pantry ?? 0) >= x.item.qty && !shown.has(key(x.store, x.item)));
  // Eerst laten zien om welke producten het gaat; je kunt er een paar uitzetten voordat je afvinkt
  const [pantryPick, setPantryPick] = useState<Set<string> | null>(null);
  const checkPantry = () => {
    const pick = pantryPick ?? new Set(covered.map((x) => key(x.store, x.item)));
    const todo = covered.filter((x) => pick.has(key(x.store, x.item)));
    setPantryPick(null);
    if (!todo.length) return;
    const next = new Set(checked);
    todo.forEach((x) => {
      const t = key(x.store, x.item);
      [t, ...(parts.byTotal.get(t) ?? [])].forEach((k) => next.add(k));
    });
    save(next);
    toast.show(`${todo.length} ${todo.length === 1 ? "product" : "producten"} afgevinkt`, "success");
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

  const onShare = () => setShareOpen(true);

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

  // PDF: de server maakt een nette PDF van de lijst zoals je hem ziet (volgorde, afgevinkt). We halen hem alvast op
  // als je "Delen" opent, zodat delen of bewaren op de telefoon meteen werkt.
  const pdfPayload = () => ({
    title: "Boodschappenlijst",
    subtitle: camp?.name ?? "",
    count: totalCount,
    done: doneCount,
    grand: grandTotal || null,
    grand_label: multi ? "Totaal alle winkels" : "Geschat totaal",
    blocks: totalBlocks.map((b) => ({
      label: multi || b.label === "Algemeen" || b.store.startsWith("alg:") ? b.label : "",
      total: b.total ?? null,
      groups: b.grouped
        .map((g) => ({
          aisle: g.aisle,
          items: g.items
            .filter((i) => !(onlyOpen && isDone(b.store, i)))
            .map((i) => ({
              name: i.name,
              sub: [i.packs ? packText(i.packs, i.pack_unit) : "", i.product ?? ""].filter(Boolean).join(" · "),
              qty: `${formatQty(i.qty)} ${i.unit}`,
              price: i.price ?? null,
              done: isDone(b.store, i),
            })),
        }))
        .filter((g) => g.items.length),
    })),
  });
  const pdfRef = useRef<{ sig: string; file: Promise<Blob> } | null>(null);
  const pdfFile = () => {
    const body = pdfPayload();
    const sig = JSON.stringify(body);
    if (!pdfRef.current || pdfRef.current.sig !== sig) pdfRef.current = { sig, file: apiBlob("/pdf/shopping", body) };
    return pdfRef.current.file;
  };
  useEffect(() => {
    if (shareOpen && totalCount > 0 && Platform.OS === "web") pdfFile().catch(() => (pdfRef.current = null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareOpen, onlyOpen]);

  const onExportPdf = async () => {
    if (totalCount === 0) return;
    const fname = `Boodschappenlijst${camp?.name ? `-${camp.name.replace(/[^\w -]/g, "").replace(/ +/g, "-")}` : ""}.pdf`;
    try {
      if (Platform.OS === "web") {
        const blob = await pdfFile();
        const file = new File([blob], fname, { type: "application/pdf" });
        const nav = (globalThis as any).navigator;
        // Telefoon: deelmenu (opslaan in Bestanden, printen, WhatsApp, mail). Computer: downloaden.
        if (nav?.canShare?.({ files: [file] })) {
          try {
            await nav.share({ files: [file], title: fname });
            return;
          } catch (e: any) {
            if (e?.name === "AbortError") return;
          }
        }
        const url = URL.createObjectURL(blob);
        const a = (globalThis as any).document.createElement("a");
        a.href = url;
        a.download = fname;
        a.target = "_blank";
        (globalThis as any).document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        toast.show("PDF gemaakt", "success");
        return;
      }
      const { uri } = await Print.printToFileAsync({ html: `<html><body><h1>Boodschappenlijst</h1></body></html>` });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: "Boodschappenlijst (PDF)" });
      }
    } catch {
      pdfRef.current = null;
      toast.show("PDF maken lukte niet, probeer het nog eens", "error");
    }
  };

  const hide = useHideOnScroll();

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 6, zIndex: 2, backgroundColor: colors.surface }]}>
        <Pressable testID="back-button" onPress={() => goBack()} hitSlop={10} style={styles.headerBtn}>
          <Icon name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>{quick ? "Snel lijstje" : "Boodschappen"}</Text>
          {totalCount > 0 ? (
            <Text style={styles.headerSub}>
              {doneCount}/{totalCount} afgevinkt
            </Text>
          ) : null}
        </View>
        <View style={styles.headerActions}>
          <Pressable testID="share-button" onPress={onShare} hitSlop={10} style={styles.headerBtn}>
            <Icon name="share-variant" size={22} color={colors.brandPrimary} />
          </Pressable>
        </View>
      </View>

      <View style={{ flex: 1 }}>
      {quick ? null : (
      <Animated.View {...hide.blockProps} style={[styles.segmentWrap, { backgroundColor: colors.surface }, hide.blockProps.style]}>
        <View style={styles.segment}>
          <Pressable testID="tab-total" onPress={() => setTab("total")} style={[styles.segBtn, tab === "total" && styles.segBtnActive]}>
            <Text style={[styles.segText, tab === "total" && styles.segTextActive]}>Totaal</Text>
          </Pressable>
          <Pressable testID="tab-perday" onPress={() => setTab("perday")} style={[styles.segBtn, tab === "perday" && styles.segBtnActive]}>
            <Text style={[styles.segText, tab === "perday" && styles.segTextActive]}>Per dag</Text>
          </Pressable>
        </View>
      </Animated.View>
      )}

      {isLoading || !loaded ? (
        <View style={{ paddingTop: hide.padTop }}>
          <SkeletonList rows={6} />
        </View>
      ) : totalCount === 0 && quick ? (
        <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 16 + hide.padTop, paddingBottom: insets.bottom + 32, gap: 16 }}>
          <TodayPicks stores={data?.stores ?? []} />
        </ScrollView>
      ) : totalCount === 0 ? (
        <View style={[styles.center, { paddingTop: hide.padTop }]}>
          <EmptyState
            icon="cart-outline"
            title="Nog geen boodschappen"
            subtitle="Kies maaltijden of voeg losse producten toe, en markeer minstens één dag als inkoopdag."
          />
        </View>
      ) : (
        <ScrollView
          {...hide.scrollProps}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => { refetch(); cmp.refetch(); live.refetch(); }} tintColor={colors.brandPrimary} />}
          contentContainerStyle={{ padding: 16, paddingTop: 16 + hide.padTop, paddingBottom: insets.bottom + 32, gap: 16 }}
        >
          {quick ? <TodayPicks stores={data?.stores ?? []} /> : null}
          <PremiumValue value={data?.premium_value} has={data?.features ? data.features.includes("extra_besparen") : undefined} />
          {id ? <RestockCard campId={String(id)} /> : null}
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
          {data?.shop_store || multi ? (
            // Eén balkje: waar je alles haalt; tik erop om terug te gaan naar je eigen winkels
            <Pressable
              testID="shop-store-banner"
              disabled={!data?.shop_store}
              onPress={backToOwn}
              style={styles.multiBanner}
            >
              <Icon name={data?.shop_store === "split" ? "call-split" : data?.shop_store ? "cart-check" : "storefront-outline"} size={16} color={colors.onBrandTertiary} />
              <Text style={styles.multiText}>
                {data?.shop_store === "split"
                  ? `Je haalt elk product waar het het goedkoopst is: ${(data.split_stores ?? []).join(", ").replace(/, ([^,]*)$/, " en $1")}. Elke winkel heeft een eigen lijstje.`
                  : data?.shop_store
                    ? `Je haalt alles bij ${data.shop_store}, met de producten uit de vergelijking.`
                    : "Meerdere winkels: elke winkel heeft een eigen lijstje."}
                {data?.shop_store ? <Text style={{ fontFamily: fonts.bold }}>{"\n"}Tik om terug te gaan naar je eigen winkels</Text> : null}
              </Text>
              {data?.shop_store ? <Icon name="undo-variant" size={18} color={colors.onBrandTertiary} /> : null}
            </Pressable>
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
                  canSplit={data?.features ? data.features.includes("slim_splitsen") : undefined}
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
          {premium && !(data?.has_pantry && covered.length) ? (
            <Pressable style={styles.pantryLink} onPress={() => router.push("/pantry")} testID="shopping-pantry-link">
              <Icon name="fridge-outline" size={16} color={colors.brandPrimary} />
              <Text style={styles.pantryLinkText}>Al iets in huis? Zet het in je voorraadkast</Text>
            </Pressable>
          ) : null}
          {/* Bespaartips: met Premium, en voor Standaard een paar gratis vragen per maand */}
          <Pressable style={styles.pantryLink} onPress={() => setTipsOpen(true)} testID="shopping-ai-tips">
            <Icon name="piggy-bank-outline" size={16} color={colors.brandPrimary} />
            <Text style={styles.pantryLinkText}>Slimme bespaartips voor deze lijst</Text>
          </Pressable>
          {data?.has_pantry && covered.length ? (
            <Pressable style={styles.multiBanner} onPress={() => setPantryPick(new Set(covered.map((x) => key(x.store, x.item))))} testID="pantry-check">
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
                onPress={() => (routeOk ? route.setOn(!route.on) : router.push("/premium"))}
                style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1 }}
              >
                <Icon name={onRoute ? "checkbox-marked" : "checkbox-blank-outline"} size={20} color={colors.brandPrimary} />
                <Text style={styles.pantryLinkText}>Op looproute van de winkel{routeOk ? "" : " (Premium)"}</Text>
              </Pressable>
              {onRoute ? (
                <Pressable onPress={() => setRouteEdit(data.by_store[0].store)} hitSlop={8}>
                  <Text style={styles.pantryLinkText}>Aanpassen</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          {tab === "total" && onRoute && !route.tipOff && data?.by_store?.length ? (
            // Elke winkel is anders ingedeeld: de standaardvolgorde is een gok, de gebruiker zet hem goed voor zijn eigen filiaal
            <View style={styles.routeTip} testID="route-tip">
              <Icon name="information-outline" size={18} color={colors.brandPrimary} />
              <View style={{ flex: 1, gap: 6 }}>
                <Text style={styles.routeTipText}>
                  De looproute is een gewone indeling van een supermarkt. Elk filiaal ligt anders, dus zet hem bij "Aanpassen" in de volgorde van de winkel waar jij meestal komt. De app onthoudt dat.
                </Text>
                <View style={{ flexDirection: "row", gap: 16 }}>
                  <Pressable onPress={() => setRouteEdit(data.by_store[0].store)} hitSlop={6}>
                    <Text style={styles.pantryLinkText}>Nu instellen</Text>
                  </Pressable>
                  <Pressable onPress={route.hideTip} hitSlop={6} testID="route-tip-hide">
                    <Text style={[styles.pantryLinkText, { color: colors.muted }]}>Niet meer tonen</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          ) : null}
          {tab === "total" && grandTotal > 0 ? (
            <View style={styles.totalCard}>
              <Text style={styles.totalLabel}>Geschat totaal</Text>
              <CountUp style={styles.totalValue} value={grandTotal} format={euro} />
              <Text style={styles.totalHint}>Hele verpakkingen tegen de huidige winkelprijs. Producten zonder prijs tellen niet mee.</Text>
              {promoSaving > 0 ? (
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
            : (
                <>
                  {onlyDay != null ? (
                    <Pressable onPress={() => setOnlyDay(null)} style={styles.onlyDayBar} testID="only-day-bar">
                      <Icon name="calendar-today" size={18} color={colors.brandPrimary} />
                      <Text style={styles.onlyDayText}>Alleen dag {onlyDay + 1}</Text>
                      <Text style={styles.onlyDayLink}>Alle dagen tonen</Text>
                    </Pressable>
                  ) : null}
                  {onlyDay != null && !(data?.per_day ?? []).some((d) => d.index === onlyDay) ? (
                    <Text style={styles.emptyDay}>Voor deze dag staat "Boodschappen deze dag" uit, of alles wordt op een eerdere dag al gekocht.</Text>
                  ) : null}
                  {(data?.per_day ?? [])
                    .filter((d) => onlyDay == null || d.index === onlyDay)
                    .map((d) => (
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
                          // Per afdeling (en op jouw looproute), zodat je de dag in de winkel kunt aflopen en afvinken
                          d.by_store.map((b) => (
                            <View key={`${d.index}-${b.store}`} style={{ gap: 8 }}>
                              {multi ? <Text style={styles.dayStore}>{b.store}</Text> : null}
                              {(onRoute ? route.sort(b.store, b.grouped) : b.grouped).map((g) => (
                                <AisleSection
                                  key={`day${d.index}-${b.store}-${g.aisle}`}
                                  store={`day${d.index}-${b.store}`}
                                  shop={b.store}
                                  aisle={g.aisle}
                                  items={g.items}
                                  checked={shown}
                                  onToggle={toggle}
                                />
                              ))}
                            </View>
                          ))
                        )}
                      </View>
                    ))}
                </>
              )}
        </ScrollView>
      )}
      </View>
      {routeEdit ? (
        <RouteSheet store={routeEdit} order={route.order(routeEdit)} onChange={(o) => route.setOrder(routeEdit, o)} onClose={() => setRouteEdit(null)} />
      ) : null}

      <Modal visible={!!pantryPick} transparent animationType="fade" onRequestClose={() => setPantryPick(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setPantryPick(null)}>
          <Pressable style={[styles.modalCard, { maxHeight: "85%" }]} onPress={() => {}}>
            <Text style={styles.modalTitle}>Al in je voorraadkast</Text>
            <Text style={styles.pantryNote}>Dit heb je volgens je voorraadkast al genoeg in huis. Zet uit wat je toch wilt kopen.</Text>
            <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 2 }}>
              {covered.map((x) => {
                const k = key(x.store, x.item);
                const on = !!pantryPick?.has(k);
                return (
                  <Pressable
                    key={k}
                    testID={`pantry-pick-${x.item.name.toLowerCase()}`}
                    onPress={() =>
                      setPantryPick((cur) => {
                        const n = new Set(cur ?? []);
                        if (n.has(k)) n.delete(k);
                        else n.add(k);
                        return n;
                      })
                    }
                    style={styles.shareToggle}
                  >
                    <Icon name={on ? "checkbox-marked" : "checkbox-blank-outline"} size={22} color={colors.brandPrimary} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.shareToggleText}>{x.item.name}</Text>
                      <Text style={styles.pantryNote}>
                        Nodig {formatQty(x.item.qty)} {x.item.unit} · in huis {formatQty(x.item.in_pantry ?? 0)} {x.item.unit}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
              <Pressable onPress={() => setPantryPick(null)} style={[styles.pantryBtn, { backgroundColor: colors.surfaceSecondary }]} testID="pantry-cancel">
                <Text style={[styles.pantryBtnText, { color: colors.onSurface }]}>Annuleren</Text>
              </Pressable>
              <Pressable
                onPress={checkPantry}
                disabled={!pantryPick?.size}
                style={[styles.pantryBtn, { backgroundColor: colors.brandPrimary, opacity: pantryPick?.size ? 1 : 0.5 }]}
                testID="pantry-confirm"
              >
                <Text style={[styles.pantryBtnText, { color: colors.onBrandPrimary }]}>Afvinken ({pantryPick?.size ?? 0})</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
      <Modal visible={shareOpen} transparent animationType="fade" onRequestClose={() => setShareOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setShareOpen(false)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <Text style={styles.modalTitle}>Lijst delen</Text>
            <ShareOption testID="share-members" icon="account-multiple-plus-outline" label="Samen afvinken (iemand uitnodigen)" onPress={() => { setShareOpen(false); setMembersOpen(true); }} />
            {totalCount === 0 ? <Text style={styles.headerSub}>Zet eerst iets op je lijstje om het als tekst of PDF te delen.</Text> : null}
            {doneCount > 0 ? (
              <Pressable testID="share-only-open" onPress={() => setOnlyOpen((v) => !v)} style={styles.shareToggle}>
                <Icon name={onlyOpen ? "checkbox-marked" : "checkbox-blank-outline"} size={22} color={colors.brandPrimary} />
                <Text style={styles.shareToggleText}>Alleen wat nog niet is afgevinkt</Text>
              </Pressable>
            ) : null}
            {totalCount > 0 ? (
              <>
                <ShareOption testID="share-whatsapp" icon="whatsapp" label="WhatsApp" onPress={() => shareVia("whatsapp")} />
                <ShareOption testID="share-mail" icon="email-outline" label="E-mail" onPress={() => shareVia("mail")} />
                {canCopy ? <ShareOption testID="share-copy" icon="content-copy" label="Tekst kopiëren" onPress={() => shareVia("copy")} /> : null}
                {canNativeShare ? <ShareOption testID="share-other" icon="share-variant" label="Andere app" onPress={() => shareVia("other")} /> : null}
                <ShareOption testID="share-print" icon="file-pdf-box" label="PDF (bewaren, printen of delen)" onPress={() => { setShareOpen(false); onExportPdf(); }} />
              </>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
      {id ? <MembersModal visible={membersOpen} campId={String(id)} isOwner={camp?.owner_id === user?.id} onClose={() => setMembersOpen(false)} /> : null}
      <Confetti fire={party} />
      <Modal visible={tipsOpen} transparent animationType="fade" onRequestClose={() => setTipsOpen(false)}>
        <Pressable style={styles.tipsBackdrop} onPress={() => setTipsOpen(false)}>
          <Pressable style={[styles.tipsSheet, { paddingBottom: insets.bottom + 12 }]} onPress={() => {}}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Icon name="piggy-bank-outline" size={20} color={colors.brandPrimary} />
              <Text style={styles.tipsTitle}>Slimme bespaartips</Text>
              <Pressable onPress={() => setTipsOpen(false)} hitSlop={10} testID="tips-close">
                <Icon name="close" size={22} color={colors.onSurface} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 8 }}>
              {tipsOpen && id ? <TipsTab campId={String(id)} /> : null}
            </ScrollView>
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
  shop,
  aisle,
  items,
  checked,
  onToggle,
  by,
}: {
  store: string;
  shop?: string; // de echte winkel als store een afvink-voorvoegsel heeft (per dag)
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
            store={shop ?? store}
          />
        ))}
      </View>
    </View>
  );
}

function ItemRow({ item, checked, onToggle, last, by, store }: { item: Item; checked: boolean; onToggle: () => void; last?: boolean; by?: string; store?: string }) {
  const [swapOpen, setSwapOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const styles = useStyles();
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const toast = useToast();
  const router = useRouter();
  // Product openen: foto, prijs bij andere winkels en waar het ligt
  const [infoOpen, setInfoOpen] = useState(false);
  const open = item.product_id ? () => setInfoOpen(true) : undefined;
  // Wisselen naar het voordeligere product: alleen voor deze lijst
  const swap = async (b: PackBetter) => {
    try {
      // Door de app gekozen soort: wisselen vanaf het oorspronkelijke product, dan blijft jouw keuze staan
      const from = item.choose === "auto" ? item.orig_product_id ?? item.product_id : item.product_id;
      await api(`/camps/${id}/product-swap`, { method: "POST", body: { from_id: from, to_id: b.product_id } });
      qc.invalidateQueries({ queryKey: ["shopping"] });
      qc.invalidateQueries({ queryKey: ["budget"] });
      toast.show(`Gewisseld naar ${b.name}`, "success");
    } catch (e: any) {
      toast.show(e?.message ?? "Wisselen lukte niet", "error");
    }
  };
  return (
    <Reanimated.View layout={LinearTransition.duration(240)} style={!last && styles.itemRowBorder}>
    <Pressable testID={`item-${item.name.toLowerCase()}`} onPress={onToggle} style={styles.itemRow}>
      <CheckPop checked={checked}>
        <Icon name={checked ? "checkbox-marked-circle" : "checkbox-blank-circle-outline"} size={24} color={checked ? colors.success : colors.borderStrong} />
      </CheckPop>
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
        {(() => {
          // Stuk kaas of vleeswaren: hoeveel plakjes en broodjes
          const si = item.product && item.pack_unit ? sliceInfo(item.product, item.pack_unit) : null;
          return si && !checked ? (
            <Text style={styles.itemPack} numberOfLines={2}>
              ± {si.slices * (item.packs ?? 1)} plakjes{item.unit.startsWith("plak") ? `, je hebt er ${formatQty(item.qty)} nodig` : ""} · genoeg voor ± {si.sandwiches * (item.packs ?? 1)} broodjes
            </Text>
          ) : null;
        })()}
        {item.choose && !checked ? (
          <Pressable onPress={() => setSwapOpen(true)} hitSlop={4} style={[styles.choosePill, item.choose === "auto" && styles.choosePillAuto]} testID={`item-choose-${item.name.toLowerCase()}`}>
            <Icon name={item.choose === "auto" ? "auto-fix" : "gesture-tap"} size={13} color={item.choose === "auto" ? colors.muted : colors.onBrandSecondary} />
            <Text style={[styles.chooseText, item.choose === "auto" && { color: colors.muted }]}>
              {item.choose === "auto" ? "Door de app gekozen, tik om zelf te kiezen" : "Kies zelf je soort"}
            </Text>
          </Pressable>
        ) : null}
        {item.was && item.price ? (
          <Pressable onPress={() => setCompareOpen(true)} hitSlop={4} style={{ flexDirection: "row", alignItems: "center", gap: 2 }} testID={`item-was-${item.name.toLowerCase()}`}>
            <Text style={[styles.itemWas, { textDecorationLine: "underline" }]} numberOfLines={1}>
              Bij {item.was.store} {euro(item.was.price)}, hier {euro(item.price)}
            </Text>
            <Icon name="chevron-right" size={14} color={colors.success} />
          </Pressable>
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
      <ProductPopup
        productId={infoOpen ? item.product_id ?? null : null}
        onClose={() => setInfoOpen(false)}
        onSwapTo={
          checked
            ? undefined
            : (p) => {
                setInfoOpen(false);
                swap({ product_id: p.id, name: p.name } as PackBetter);
              }
        }
        onSwap={
          checked
            ? undefined
            : () => {
                setInfoOpen(false);
                setSwapOpen(true);
              }
        }
      />
      <PriceCompareSheet
        item={compareOpen ? item : null}
        store={store ?? ""}
        onClose={() => setCompareOpen(false)}
        onPick={(p) => swap({ product_id: p.id, name: p.name } as PackBetter)}
        onSearch={() => setSwapOpen(true)}
      />
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
    </Reanimated.View>
  );
}

const useStyles = makeStyles((colors) => ({
  tipsBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center" },
  tipsSheet: { backgroundColor: colors.surface, borderRadius: 20, width: "94%", maxWidth: 600, alignSelf: "center", maxHeight: "88%", padding: 16, gap: 12 },
  tipsTitle: { flex: 1, fontSize: 18, fontFamily: fonts.bold, color: colors.onSurface },
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
  routeTip: { flexDirection: "row", gap: 8, backgroundColor: colors.surfaceSecondary, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: colors.border },
  routeTipText: { fontSize: 13, lineHeight: 18, fontFamily: fonts.regular, color: colors.onSurfaceSecondary },
  multiBanner: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.brandTertiary, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, padding: 10 },
  multiText: { fontSize: 13, fontFamily: fonts.semibold, color: colors.onBrandTertiary, flex: 1 },
  storeHeader: { flexDirection: "row", alignItems: "center", gap: 8, paddingBottom: 2 },
  storeHeaderText: { fontSize: 17, fontFamily: fonts.bold, color: colors.onSurface },
  aisleHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8, paddingHorizontal: 4 },
  aisleTitle: { fontSize: 13, fontFamily: fonts.bold, color: colors.onSurfaceSecondary, textTransform: "uppercase", letterSpacing: 0.5 },
  card: { backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, ...softShadow(colors, 1) },
  itemRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14 },
  itemRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.divider },
  itemName: { flex: 1, fontSize: 15, fontFamily: fonts.medium, color: colors.onSurface },
  itemNameChecked: { color: colors.muted, textDecorationLine: "line-through" },
  itemQty: { fontSize: 15, fontFamily: fonts.semibold, color: colors.brandPrimary },
  itemQtyChecked: { color: colors.muted, textDecorationLine: "line-through" },
  onlyDayBar: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 14, backgroundColor: colors.brandTertiary },
  onlyDayText: { flex: 1, fontSize: 15, fontFamily: fonts.bold, color: colors.onSurface },
  onlyDayLink: { fontSize: 13, fontFamily: fonts.semibold, color: colors.brandPrimary },
  dayBlock: { gap: 10 },
  dayHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 4 },
  dayTitle: { fontSize: 17, fontFamily: fonts.bold, color: colors.onSurface },
  dayMeta: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted },
  dayStore: { fontSize: 13, fontFamily: fonts.bold, color: colors.brandPrimary, paddingHorizontal: 4 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(28,27,26,0.5)", justifyContent: "center", padding: 20 },
  modalCard: { backgroundColor: colors.surface, borderRadius: 20, padding: 20, gap: 4, width: "100%", maxWidth: 420, alignSelf: "center" },
  pantryNote: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted },
  pantryBtn: { flex: 1, borderRadius: 12, paddingVertical: 12, alignItems: "center" },
  pantryBtnText: { fontSize: 15, fontFamily: fonts.bold },
  modalTitle: { fontSize: 18, fontFamily: fonts.bold, color: colors.onSurface, marginBottom: 8 },
  shareToggle: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, marginBottom: 4 },
  shareToggleText: { fontSize: 14, fontFamily: fonts.medium, color: colors.onSurfaceSecondary },
  shareOption: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 13, borderTopWidth: 1, borderTopColor: colors.divider },
  shareOptionText: { fontSize: 16, fontFamily: fonts.semibold, color: colors.onSurface },
  emptyDay: { fontSize: 14, fontFamily: fonts.regular, color: colors.muted, paddingHorizontal: 4 },
  choosePill: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", backgroundColor: colors.brandSecondary, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3, marginTop: 3 },
  choosePillAuto: { backgroundColor: colors.surfaceTertiary },
  chooseText: { fontSize: 11, fontFamily: fonts.semibold, color: colors.onBrandSecondary },
}));
