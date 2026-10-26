// "Waar is je lijst het goedkoopst?": op de startpagina en bij je boodschappenlijst.
// Per winkel wat je lijst kost (met de echte hoeveelheden), zelf producten wisselen, en alles bij één winkel halen.
import { useState } from "react";
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button, Icon } from "@/src/components/ui";
import { api } from "@/src/api";
import { euro } from "@/src/search";
import { useToast } from "@/src/toast";
import { fonts, makeStyles, useTheme } from "@/src/theme";

export type CompareItem = NonNullable<CompareStore["items"]>[number];

export type CompareStore = {
  store: string;
  total: number;
  total_fair?: number; // met een geschatte prijs voor wat deze winkel niet heeft
  estimated?: number;
  found: number;
  count: number;
  items?: { name: string; product: string | null; product_id: string | null; image?: string | null; price: number | null; packs?: number | null; qty?: number | null; unit?: string | null; alternative: boolean; estimate?: number; chosen?: boolean }[];
};

export const SHORT: Record<string, string> = { "Albert Heijn": "AH", Jumbo: "Jumbo", Dirk: "Dirk" };

// Slim splitsen: elk product bij de goedkoopste van de gekozen winkels. Zonder keuze: de goedkoopste combinatie (2 of 3 winkels),
// alleen als het echt scheelt. Per product ook wat het bij de andere winkel kost ("bij Jumbo € 2,49").
type SplitLine = { name: string; product: string | null; store: string; price: number; was?: { store: string; price: number } };
type Split = { stores: string[]; total: number; saving: number; lines: SplitLine[] };

function splitFor(compare: CompareStore[], stores: string[], bestSingle: number): Split | null {
  const per = compare.filter((c) => stores.includes(c.store));
  if (per.length < 2) return null;
  const lines: SplitLine[] = [];
  let total = 0;
  (per[0].items ?? []).forEach((first, k) => {
    const opts = per
      .map((c) => ({ store: c.store, it: c.items?.[k], price: c.items?.[k]?.price ?? null }))
      .filter((o) => o.it && o.price != null)
      .sort((x, y) => (x.price as number) - (y.price as number));
    if (!opts.length) {
      // Geen van de winkels heeft het: de schatting telt mee (zoals bij één winkel)
      if (first.estimate != null) total += first.estimate;
      return;
    }
    const top = opts[0];
    const next = opts.find((o) => (o.price as number) > (top.price as number));
    total += top.price as number;
    lines.push({ name: top.it!.name, product: top.it!.product, store: top.store, price: top.price as number,
                 was: next ? { store: next.store, price: next.price as number } : undefined });
  });
  const round = (x: number) => Math.round(x * 100) / 100;
  return { stores: per.map((c) => c.store), total: round(total), saving: round(bestSingle - total), lines };
}

function bestSplit(compare: CompareStore[], bestSingle: number): Split | null {
  let top: Split | null = null;
  const names = compare.map((c) => c.store);
  // Alle combinaties van 2 of meer winkels
  for (let mask = 0; mask < 1 << names.length; mask++) {
    const pick = names.filter((_, i) => mask & (1 << i));
    if (pick.length < 2) continue;
    const s = splitFor(compare, pick, bestSingle);
    if (!s || new Set(s.lines.map((l) => l.store)).size < pick.length) continue; // elke winkel moet ook echt iets hebben
    // Een winkel extra is pas de moeite als het minstens € 1 scheelt
    if (s.saving >= 1 && (!top || s.total < top.total - (pick.length > top.stores.length ? 1 : 0))) top = s;
  }
  return top;
}


export function CompareCard({
  campId,
  campName,
  compare: all,
  pending,
  shopStore,
  noTitle,
}: {
  campId: string;
  campName: string;
  compare: CompareStore[] | null | undefined;
  pending?: boolean;
  shopStore?: string | null;
  noTitle?: boolean;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const toast = useToast();
  const [openStore, setOpenStore] = useState<string | null>(null);
  const [swap, setSwap] = useState<{ store: string; item: CompareItem } | null>(null);
  const [splitOpen, setSplitOpen] = useState(false);
  const [splitPick, setSplitPick] = useState<string[] | null>(null); // zelf gekozen winkels om te splitsen
  const compare = (all ?? []).filter((c) => c.found > 0);
  // Vergelijk eerlijk: wat een winkel niet heeft telt mee met de prijs bij de andere winkels
  const fairTotal = (c: CompareStore) => c.total_fair ?? c.total;
  const best = compare.length > 1 ? compare.reduce((a, b) => (fairTotal(b) < fairTotal(a) ? b : a)) : null;
  const maxTotal = Math.max(1, ...compare.map(fairTotal));
  const auto = bestSplit(compare, best ? fairTotal(best) : 0);
  const split = splitPick ? splitFor(compare, splitPick, best ? fairTotal(best) : 0) : auto;
  const togglePick = (st: string) =>
    setSplitPick((cur) => {
      const base = cur ?? auto?.stores ?? [];
      return base.includes(st) ? base.filter((x) => x !== st) : [...base, st];
    });

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["home"] }),
      qc.invalidateQueries({ queryKey: ["compare", campId] }),
      qc.invalidateQueries({ queryKey: ["shopping", campId] }),
      qc.invalidateQueries({ queryKey: ["budget", campId] }),
    ]);
  };
  const setStore = useMutation({
    mutationFn: (store: string | null) => api(`/camps/${campId}/shop-store`, { method: "POST", body: { store } }),
    onSuccess: async (_r, store) => {
      await refresh();
      toast.show(store ? `Je boodschappenlijst staat nu helemaal op ${store}` : "Terug naar je eigen winkels per product", "success");
    },
    onError: (e: any) => toast.show(e?.message ?? "Dat lukte niet", "error"),
  });
  // Gesplitst halen: elk product bij de goedkoopste van de twee winkels
  const setSplit = useMutation({
    mutationFn: (stores: string[]) => api(`/camps/${campId}/shop-store`, { method: "POST", body: { split: stores } }),
    onSuccess: async (_r, stores) => {
      await refresh();
      toast.show(`Je lijst is gesplitst over ${stores.join(" en ")}`, "success");
    },
    onError: (e: any) => toast.show(e?.message ?? "Dat lukte niet", "error"),
  });
  // Zelf een product gewisseld bij de winkel waar je alles haalt: ook je lijst bijwerken
  const onChanged = async (store: string) => {
    await refresh();
    if (shopStore === store) setStore.mutate(store);
  };

  return (
    <>
      {pending ? (
        <View style={{ gap: 10 }}>
          {noTitle ? null : <Text style={styles.section}>Waar is je lijst het goedkoopst?</Text>}
          <View style={[styles.compareCard, { flexDirection: "row", alignItems: "center", gap: 10 }]}>
            <ActivityIndicator color={colors.brandPrimary} />
            <Text style={styles.small}>We zoeken je producten op bij AH, Jumbo en Dirk…</Text>
          </View>
        </View>
      ) : null}
      {compare.length ? (
        <View style={{ gap: 10 }}>
          {noTitle ? null : <Text style={styles.section}>Waar is je lijst het goedkoopst?</Text>}
          <View style={styles.compareCard}>
            {compare.map((c) => (
              <Pressable key={c.store} testID={`compare-${c.store}`} onPress={() => setOpenStore((v) => (v === c.store ? null : c.store))} style={{ gap: 4 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={[styles.body, c === best && { fontFamily: fonts.bold }]}>
                    {c.store}
                    {c === best ? "  ·  goedkoopst" : ""}
                  </Text>
                  <Text style={[styles.body, c === best && { fontFamily: fonts.bold, color: colors.success }]}>{euro(fairTotal(c))}</Text>
                </View>
                <View style={styles.barTrack}>
                  <View style={[styles.bar, { width: `${(fairTotal(c) / maxTotal) * 100}%` }, c === best && { backgroundColor: colors.success }]} />
                </View>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={styles.small}>
                    {c.found} van {c.count} producten
                    {c.items?.some((i) => i.alternative) ? ` · ${c.items.filter((i) => i.alternative).length} vervangen door iets vergelijkbaars` : ""}
                    {c.estimated ? ` · incl. ${euro(c.estimated)} geschat voor wat er niet is` : ""}
                  </Text>
                  <Icon name={openStore === c.store ? "chevron-up" : "chevron-down"} size={18} color={colors.muted} />
                </View>
                {openStore === c.store
                  ? (c.items ?? []).map((i) => (
                      <Pressable
                        key={i.name}
                        onPress={() => setSwap({ store: c.store, item: i })}
                        style={styles.cmpRow}
                      >
                        {i.image ? <Image source={{ uri: i.image }} style={styles.cmpImg} resizeMode="contain" /> : <View style={styles.cmpImg} />}
                        <View style={{ flex: 1 }}>
                          <Text style={styles.cmpName} numberOfLines={1}>{i.product ?? i.name}</Text>
                          <Text style={[styles.small, i.alternative && { color: colors.warning }]} numberOfLines={1}>
                            {i.chosen ? "Zelf gekozen" : !i.product ? (i.estimate ? `Niet gevonden, gerekend met ${euro(i.estimate)} (andere winkels)` : "Niet gevonden in deze winkel") : i.alternative ? `In plaats van ${i.name}` : "Zelfde product"}
                          </Text>
                        </View>
                        <Text style={styles.cmpPrice}>
                          {i.packs && i.packs > 1 ? `${i.packs}× ` : ""}
                          {i.price != null ? euro(i.price) : "—"}
                        </Text>
                        <Icon name="swap-horizontal" size={16} color={colors.muted} />
                      </Pressable>
                    ))
                  : null}
                {openStore === c.store ? (
                  <Button
                    label={shopStore === c.store ? `Je lijst staat op ${c.store}` : `Alles bij ${c.store} halen`}
                    icon={shopStore === c.store ? "check" : "cart-arrow-right"}
                    variant={shopStore === c.store ? "secondary" : "primary"}
                    disabled={shopStore === c.store}
                    loading={setStore.isPending && setStore.variables === c.store}
                    onPress={() => setStore.mutate(c.store)}
                    testID={`compare-shop-${c.store}`}
                  />
                ) : null}
              </Pressable>
            ))}
            {best && !shopStore && openStore !== best.store ? (
              <Button
                label={`Alles bij ${best.store} halen`}
                icon="cart-arrow-right"
                loading={setStore.isPending && setStore.variables === best.store}
                onPress={() => setStore.mutate(best.store)}
                testID="compare-shop-best"
              />
            ) : null}
            {shopStore ? (
              <Pressable onPress={() => setStore.mutate(null)} disabled={setStore.isPending} hitSlop={6}>
                <Text style={styles.link}>Terug naar je eigen winkels per product</Text>
              </Pressable>
            ) : null}
            {compare.length > 1 && (split || splitPick) ? (
              <Pressable testID="compare-split" onPress={() => setSplitOpen((v) => !v)} style={styles.splitBox}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Icon name="call-split" size={20} color={colors.success} />
                  <Text style={[styles.body, { flex: 1, fontFamily: fonts.bold }]}>
                    Slim splitsen{split ? `: ${split.stores.map((s) => SHORT[s] ?? s).join(" + ")}` : ""}
                  </Text>
                  {split ? <Text style={[styles.body, { fontFamily: fonts.bold, color: colors.success }]}>{euro(split.total)}</Text> : null}
                </View>
                {/* Zelf kiezen bij welke winkels je wilt halen */}
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                  {compare.map((c) => {
                    const on = (splitPick ?? auto?.stores ?? []).includes(c.store);
                    return (
                      <Pressable key={c.store} onPress={() => togglePick(c.store)} hitSlop={4}
                        style={[styles.pickChip, on && { backgroundColor: colors.success, borderColor: colors.success }]}>
                        <Icon name={on ? "check" : "plus"} size={14} color={on ? "#fff" : colors.muted} />
                        <Text style={[styles.small, { color: on ? "#fff" : colors.onSurface, fontFamily: fonts.semibold }]}>{SHORT[c.store] ?? c.store}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={[styles.small, { flex: 1 }]}>
                    {!split
                      ? "Kies minstens twee winkels."
                      : split.saving > 0
                        ? `Haal elk product waar het het goedkoopst is: ${euro(split.saving)} minder dan alles bij ${best?.store}.`
                        : `Met deze winkels bespaar je niets ten opzichte van alles bij ${best?.store}.`}
                    {!splitPick && auto ? " Wij kozen de goedkoopste combinatie; tik op een winkel om het zelf te kiezen." : ""}
                  </Text>
                  <Icon name={splitOpen ? "chevron-up" : "chevron-down"} size={18} color={colors.muted} />
                </View>
                {splitOpen && split
                  ? split.stores.map((st) => (
                      <View key={st} style={{ gap: 2 }}>
                        <Text style={[styles.body, { fontFamily: fonts.semibold, marginTop: 6 }]}>
                          {st} · {euro(split.lines.filter((l) => l.store === st).reduce((a, l) => a + l.price, 0))}
                        </Text>
                        {split.lines
                          .filter((l) => l.store === st)
                          .map((l) => (
                            <View key={l.name} style={styles.cmpRow}>
                              <View style={{ flex: 1 }}>
                                <Text style={styles.cmpName} numberOfLines={1}>{l.product ?? l.name}</Text>
                                {l.was ? (
                                  <Text style={[styles.small, { color: colors.success }]}>
                                    Bij {SHORT[l.was.store] ?? l.was.store} {euro(l.was.price)}, hier {euro(l.price)}: {euro(l.was.price - l.price)} goedkoper
                                  </Text>
                                ) : null}
                              </View>
                              <Text style={styles.cmpPrice}>{euro(l.price)}</Text>
                            </View>
                          ))}
                      </View>
                    ))
                  : null}
                {split ? (
                  <Button
                    label={`${shopStore === "split" ? "Opnieuw splitsen" : "Gesplitst halen"} bij ${split.stores.map((s) => SHORT[s] ?? s).join(" + ")}`}
                    icon="call-split"
                    variant={shopStore === "split" ? "secondary" : "primary"}
                    loading={setSplit.isPending}
                    onPress={() => setSplit.mutate(split.stores)}
                    testID="compare-split-apply"
                  />
                ) : null}
              </Pressable>
            ) : null}
            <Text style={styles.small}>
              Voor "{campName}" met de hoeveelheden van je boodschappenlijst (hele verpakkingen). Staat iets niet in een winkel, dan
              rekenen we met het best passende alternatief daar. Tik op een winkel voor de details en om alles daar te halen.
            </Text>
          </View>
        </View>
      ) : null}
      {swap ? <SwapSheet campId={campId} store={swap.store} item={swap.item} onClose={() => setSwap(null)} onChanged={onChanged} /> : null}
    </>
  );
}

type SwapOption = { product_id: string; name: string; unit?: string | null; image?: string | null; price?: number | null };

// Per product in de vergelijking zelf een ander product kiezen (bijv. als de app iets verkeerds vond)
function SwapSheet({ campId, store, item, onClose, onChanged }: { campId: string; store: string; item: CompareItem; onClose: () => void; onChanged: (store: string) => Promise<void> }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const q = new URLSearchParams({ store, name: item.name, ...(item.product_id ? { product_id: item.product_id } : {}) });
  const { data, isLoading } = useQuery({
    queryKey: ["compare-options", store, item.name],
    queryFn: () => api<{ options: SwapOption[] }>(`/compare/options?${q.toString()}`),
  });
  const pick = useMutation({
    mutationFn: (product_id: string | null) =>
      api(`/camps/${campId}/compare-swap`, { method: "POST", body: { store, name: item.name, product_id } }),
    onSuccess: async () => {
      await onChanged(store);
      onClose();
    },
  });
  const options = (data?.options ?? []).filter((o) => o.product_id !== item.product_id);
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]} onPress={() => {}}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={[styles.cardTitle, { flex: 1 }]} numberOfLines={2}>
              {item.name} bij {store}
            </Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Icon name="close" size={22} color={colors.muted} />
            </Pressable>
          </View>
          {item.product ? (
            <View style={styles.cmpRow}>
              {item.image ? <Image source={{ uri: item.image }} style={styles.cmpImg} resizeMode="contain" /> : <View style={styles.cmpImg} />}
              <View style={{ flex: 1 }}>
                <Text style={styles.cmpName} numberOfLines={2}>{item.product}</Text>
                <Text style={styles.small}>Nu gekozen{item.price != null ? ` · ${euro(item.price)}` : ""}</Text>
              </View>
              {item.product_id ? (
                <Pressable
                  onPress={() => {
                    onClose();
                    router.push(`/product/${item.product_id}`);
                  }}
                  hitSlop={8}
                >
                  <Text style={styles.link}>Bekijken</Text>
                </Pressable>
              ) : null}
            </View>
          ) : (
            <Text style={styles.small}>Hier is nog niets voor gevonden. Kies hieronder zelf een product.</Text>
          )}
          <Text style={[styles.body, { fontFamily: fonts.semibold }]}>Kies een ander product</Text>
          <ScrollView style={{ maxHeight: 360 }}>
            {isLoading ? <ActivityIndicator color={colors.brandPrimary} style={{ marginVertical: 16 }} /> : null}
            {!isLoading && !options.length ? <Text style={styles.small}>Geen andere producten gevonden.</Text> : null}
            {options.map((o) => (
              <Pressable key={o.product_id} disabled={pick.isPending} onPress={() => pick.mutate(o.product_id)} style={styles.cmpRow}>
                {o.image ? <Image source={{ uri: o.image }} style={styles.cmpImg} resizeMode="contain" /> : <View style={styles.cmpImg} />}
                <View style={{ flex: 1 }}>
                  <Text style={styles.cmpName} numberOfLines={2}>{o.name}</Text>
                  {o.unit ? <Text style={styles.small}>{o.unit}</Text> : null}
                </View>
                <Text style={styles.cmpPrice}>{o.price != null ? euro(o.price) : "—"}</Text>
              </Pressable>
            ))}
          </ScrollView>
          {item.chosen ? (
            <Pressable disabled={pick.isPending} onPress={() => pick.mutate(null)} style={{ paddingVertical: 8 }}>
              <Text style={styles.link}>Terug naar de keuze van de app</Text>
            </Pressable>
          ) : null}
          {pick.isPending ? <ActivityIndicator color={colors.brandPrimary} /> : null}
          {pick.isError ? <Text style={[styles.small, { color: colors.error }]}>Dat lukte niet, probeer het nog eens.</Text> : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  small: { fontSize: 12, fontFamily: fonts.regular, color: colors.muted },
  body: { fontSize: 15, fontFamily: fonts.regular, color: colors.onSurface },
  link: { fontSize: 14, fontFamily: fonts.semibold, color: colors.brandPrimary },
  section: { fontSize: 19, fontFamily: fonts.bold, color: colors.onSurface },
  cardTitle: { fontSize: 16, fontFamily: fonts.semibold, color: colors.onSurface },
  cmpRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.divider },
  cmpImg: { width: 34, height: 34, borderRadius: 8, backgroundColor: "#fff" },
  cmpName: { fontSize: 14, fontFamily: fonts.medium, color: colors.onSurface },
  cmpPrice: { fontSize: 14, fontFamily: fonts.semibold, color: colors.onSurface },
  pickChip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999,
              borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  splitBox: { borderRadius: 12, backgroundColor: colors.brandTertiary, padding: 12, gap: 6 },
  compareCard: { borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 14 },
  barTrack: { height: 8, borderRadius: 4, backgroundColor: colors.surfaceTertiary, overflow: "hidden" },
  bar: { height: 8, borderRadius: 4, backgroundColor: colors.brandPrimary },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, gap: 10, width: "100%", maxWidth: 640, alignSelf: "center" },
}));
