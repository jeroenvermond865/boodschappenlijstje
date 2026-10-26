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

// Slim splitsen: bij welke twee winkels samen is je lijst het goedkoopst? Alleen tonen als het echt scheelt.
function bestSplit(compare: CompareStore[], bestSingle: number) {
  let top: { stores: string[]; total: number; saving: number; lines: { name: string; product: string | null; store: string; price: number }[] } | null = null;
  for (let a = 0; a < compare.length; a++) {
    for (let b = a + 1; b < compare.length; b++) {
      const A = compare[a], B = compare[b];
      const lines: { name: string; product: string | null; store: string; price: number }[] = [];
      let total = 0;
      (A.items ?? []).forEach((ia, k) => {
        const ib = B.items?.[k];
        // Alleen echte prijzen kiezen; heeft geen van beide het, dan telt de schatting mee (zoals bij één winkel)
        const pa = ia.price, pb = ib?.price ?? null;
        if (pa == null && pb == null && ia.estimate == null) return;
        const useB = pb != null && (pa == null || pb < pa);
        const it = useB ? ib! : ia;
        const price = (useB ? pb : pa ?? ia.estimate) as number;
        total += price;
        lines.push({ name: it.name, product: it.product, store: useB ? B.store : A.store, price });
      });
      const used = new Set(lines.map((l) => l.store));
      const saving = bestSingle - total;
      if (used.size === 2 && saving >= 1 && (!top || total < top.total)) {
        top = { stores: [A.store, B.store], total: Math.round(total * 100) / 100, saving: Math.round(saving * 100) / 100, lines };
      }
    }
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
  const compare = (all ?? []).filter((c) => c.found > 0);
  // Vergelijk eerlijk: wat een winkel niet heeft telt mee met de prijs bij de andere winkels
  const fairTotal = (c: CompareStore) => c.total_fair ?? c.total;
  const best = compare.length > 1 ? compare.reduce((a, b) => (fairTotal(b) < fairTotal(a) ? b : a)) : null;
  const maxTotal = Math.max(1, ...compare.map(fairTotal));
  const split = bestSplit(compare, best ? fairTotal(best) : 0);

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
            {split ? (
              <Pressable testID="compare-split" onPress={() => setSplitOpen((v) => !v)} style={styles.splitBox}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Icon name="call-split" size={20} color={colors.success} />
                  <Text style={[styles.body, { flex: 1, fontFamily: fonts.bold }]}>
                    Slim splitsen: {split.stores.map((s) => SHORT[s] ?? s).join(" + ")}
                  </Text>
                  <Text style={[styles.body, { fontFamily: fonts.bold, color: colors.success }]}>{euro(split.total)}</Text>
                </View>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={styles.small}>
                    Haal elk product waar het het goedkoopst is: {euro(split.saving)} minder dan alles bij {best?.store}.
                  </Text>
                  <Icon name={splitOpen ? "chevron-up" : "chevron-down"} size={18} color={colors.muted} />
                </View>
                {splitOpen
                  ? split.stores.map((st) => (
                      <View key={st} style={{ gap: 2 }}>
                        <Text style={[styles.body, { fontFamily: fonts.semibold, marginTop: 6 }]}>
                          {st} · {euro(split.lines.filter((l) => l.store === st).reduce((a, l) => a + l.price, 0))}
                        </Text>
                        {split.lines
                          .filter((l) => l.store === st)
                          .map((l) => (
                            <View key={l.name} style={styles.cmpRow}>
                              <Text style={[styles.cmpName, { flex: 1 }]} numberOfLines={1}>{l.product ?? l.name}</Text>
                              <Text style={styles.cmpPrice}>{euro(l.price)}</Text>
                            </View>
                          ))}
                      </View>
                    ))
                  : null}
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
  splitBox: { borderRadius: 12, backgroundColor: colors.brandTertiary, padding: 12, gap: 6 },
  compareCard: { borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 14 },
  barTrack: { height: 8, borderRadius: 4, backgroundColor: colors.surfaceTertiary, overflow: "hidden" },
  bar: { height: 8, borderRadius: 4, backgroundColor: colors.brandPrimary },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, gap: 10, width: "100%", maxWidth: 640, alignSelf: "center" },
}));
