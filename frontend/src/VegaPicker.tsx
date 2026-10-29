import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import Image from "@/src/components/SafeImage";
import Modal from "@/src/components/Modal";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Icon } from "@/src/components/ui";
import { api } from "@/src/api";
import { euro } from "@/src/search";
import { ProductBrowser } from "@/src/ProductBrowser";
import { useToast } from "@/src/toast";
import { fonts, makeStyles, useTheme } from "@/src/theme";
import type { Product } from "@/app/(tabs)/products";
import type { Dish } from "@/app/(tabs)/dishes";
import { formatQty } from "@/src/constants";
import { dishOrigin } from "@/src/dishInfo";
import { useAuth } from "@/src/auth";
import { useTerms } from "@/src/settings";

type VegaItem = { index: number; name: string; unit?: string; qty_adult?: number; meat?: Product | null; options: Product[] };
export type VegaIngredient = { name: string; unit: string; qty_adult: number; qty_child: number; aisle: string; product_id?: string | null; store?: string | null; diet: string };
export type VegaLocalChoice = { index: number; product: Product | null };

// Vlees of vis in een gerecht: kies per onderdeel een vegetarische vervanger (of laat het voor de vegetariërs weg).
// Vanuit een lijstje (campId) geldt de keuze alleen voor dat lijstje. Met "local" kies je in een gerecht dat je nog aan het aanpassen bent:
// dan komt de keuze in het scherm en sla je het daar op.
export function VegaPicker({
  dish,
  onClose,
  campId,
  local,
  onSaved,
}: {
  dish: (Pick<Dish, "id" | "name"> & Partial<Dish>) | null;
  onClose: () => void;
  campId?: string | null;
  local?: { ingredients: VegaIngredient[]; onApply: (choices: VegaLocalChoice[]) => void };
  // Opgeslagen; in een lijstje kan dat een nieuwe versie van het gerecht zijn (met een ander id)
  onSaved?: (dish: Dish) => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();
  const T = useTerms();
  const [choice, setChoice] = useState<Record<number, Product | "skip">>({});
  const [browseFor, setBrowseFor] = useState<number | null>(null);
  useEffect(() => {
    setChoice({});
    setBrowseFor(null);
  }, [dish?.id]);

  const localSig = local ? JSON.stringify(local.ingredients.map((i) => [i.name, i.product_id, i.diet, i.unit])) : "";
  const q = useQuery({
    queryKey: ["vega", dish?.id, localSig],
    enabled: !!dish,
    queryFn: () =>
      local
        ? api<{ items: VegaItem[] }>("/dishes/vega-options", { method: "POST", body: { ingredients: local.ingredients } })
        : api<{ items: VegaItem[] }>(`/dishes/${dish!.id}/vega`),
  });
  // Eerste voorstel staat alvast klaar
  useEffect(() => {
    if (q.data) setChoice((c) => Object.fromEntries(q.data.items.map((i) => [i.index, c[i.index] ?? i.options[0] ?? "skip"])));
  }, [q.data]);

  const picked = (i: VegaItem) => (choice[i.index] && choice[i.index] !== "skip" ? (choice[i.index] as Product) : null);
  const save = useMutation({
    mutationFn: () =>
      api<Dish>(`/dishes/${dish!.id}/vega`, {
        method: "POST",
        body: { camp_id: campId ?? null, choices: (q.data?.items ?? []).map((i) => ({ index: i.index, product_id: picked(i)?.id ?? null })) },
      }),
    onSuccess: (saved) => {
      onSaved?.(saved);
      qc.invalidateQueries({ queryKey: ["dishes"] });
      qc.invalidateQueries({ queryKey: ["dish"] });
      qc.invalidateQueries({ queryKey: ["dish-prep"] });
      qc.invalidateQueries({ queryKey: ["shopping"] });
      qc.invalidateQueries({ queryKey: ["budget"] });
      if (campId) {
        qc.invalidateQueries({ queryKey: ["camp", campId] });
        qc.invalidateQueries({ queryKey: ["camps"] });
      }
      toast.show(campId ? `Vegetarische optie toegevoegd voor ${T.deze} ${T.one}` : "Vegetarische optie toegevoegd aan het gerecht", "success");
      onClose();
    },
    onError: (e: any) => toast.show(e?.message ?? "Opslaan mislukt", "error"),
  });
  const onSave = () => {
    if (local) {
      local.onApply((q.data?.items ?? []).map((i) => ({ index: i.index, product: picked(i) })));
      onClose();
    } else save.mutate();
  };

  const items = q.data?.items ?? [];
  const origin = dish && dish.is_standard !== undefined ? dishOrigin(dish as Dish, user?.id, `${T.deze} ${T.one}`) : null;
  return (
    <Modal visible={!!dish} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
          <View style={styles.head}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Vegetarische optie kiezen</Text>
              <Text style={styles.sub} numberOfLines={1}>{dish?.name}</Text>
              {origin ? (
                <View style={styles.originRow}>
                  <Icon name={origin.icon as any} size={13} color={colors.muted} />
                  <Text style={styles.sub} numberOfLines={1}>{origin.label}</Text>
                </View>
              ) : null}
            </View>
            <Pressable onPress={onClose} hitSlop={10}>
              <Icon name="close" size={24} color={colors.muted} />
            </Pressable>
          </View>
          {browseFor !== null ? (
            <View style={{ height: 520 }}>
              <ProductBrowser
                onPick={(p) => {
                  setChoice((c) => ({ ...c, [browseFor]: p }));
                  setBrowseFor(null);
                }}
                header={
                  <Pressable onPress={() => setBrowseFor(null)} style={styles.backRow}>
                    <Icon name="chevron-left" size={20} color={colors.brandPrimary} />
                    <Text style={styles.link}>Terug naar de voorstellen</Text>
                  </Pressable>
                }
              />
            </View>
          ) : q.isLoading ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.brandPrimary} />
              <Text style={styles.sub}>Vegetarische vervangers zoeken…</Text>
            </View>
          ) : !items.length ? (
            <View style={styles.center}>
              <Text style={styles.sub}>Dit gerecht heeft geen vlees of vis meer zonder vegetarische optie.</Text>
            </View>
          ) : (
            <>
              <Text style={styles.hint}>
                Het vlees of de vis blijft voor de vleeseters. De vervanger komt in dezelfde hoeveelheid op de lijst voor de vegetariërs, en de bereiding zegt hoe je hem apart klaarmaakt.
              </Text>
              <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ gap: 16, paddingBottom: 8 }}>
                {items.map((it) => {
                  const cur = choice[it.index];
                  const opts = [...it.options];
                  if (cur && cur !== "skip" && !opts.some((o) => o.id === cur.id)) opts.unshift(cur);
                  return (
                    <View key={it.index} style={{ gap: 8 }}>
                      <Text style={styles.groupLabel}>Voor de vleeseters</Text>
                      <View style={[styles.opt, styles.optMeat]} testID={`vega-meat-${it.index}`}>
                        {it.meat?.image ? <Image source={{ uri: it.meat.image }} style={styles.img} resizeMode="contain" /> : (
                          <View style={[styles.img, { alignItems: "center", justifyContent: "center" }]}>
                            <Icon name="food-drumstick-outline" size={20} color={colors.muted} />
                          </View>
                        )}
                        <View style={{ flex: 1 }}>
                          <Text style={styles.optName} numberOfLines={2}>{it.meat?.name ?? it.name}</Text>
                          <Text style={styles.sub}>
                            {it.meat?.source ? `${it.meat.source} · ` : ""}
                            {it.meat ? euro(it.meat.promo?.price ?? it.meat.price) : ""}
                            {it.qty_adult ? `${it.meat ? " · " : ""}${formatQty(it.qty_adult)} ${it.unit ?? ""} per volwassene` : ""}
                          </Text>
                        </View>
                        <Icon name="food-drumstick-outline" size={20} color={colors.muted} />
                      </View>
                      <Text style={styles.groupLabel}>Voor de vegetariërs: kies een vervanger</Text>
                      {opts.map((o) => {
                        const on = cur !== "skip" && cur?.id === o.id;
                        return (
                          <Pressable key={o.id} onPress={() => setChoice((c) => ({ ...c, [it.index]: o }))} style={[styles.opt, on && styles.optOn]}>
                            {o.image ? <Image source={{ uri: o.image }} style={styles.img} resizeMode="contain" /> : <View style={styles.img} />}
                            <View style={{ flex: 1 }}>
                              <Text style={styles.optName} numberOfLines={2}>{o.name}</Text>
                              <Text style={styles.sub}>
                                {o.source ? `${o.source} · ` : ""}
                                {euro(o.promo?.price ?? o.price)}
                                {o.unit ? ` · ${o.unit}` : ""}
                              </Text>
                            </View>
                            <Icon name={on ? "radiobox-marked" : "radiobox-blank"} size={22} color={on ? colors.brandPrimary : colors.borderStrong} />
                          </Pressable>
                        );
                      })}
                      <View style={styles.row}>
                        <Pressable onPress={() => setBrowseFor(it.index)} style={styles.smallBtn}>
                          <Icon name="magnify" size={16} color={colors.brandPrimary} />
                          <Text style={styles.link}>Zelf zoeken</Text>
                        </Pressable>
                        <Pressable onPress={() => setChoice((c) => ({ ...c, [it.index]: "skip" }))} style={[styles.smallBtn, cur === "skip" && styles.optOn]}>
                          <Icon name={cur === "skip" ? "check" : "minus-circle-outline"} size={16} color={colors.brandPrimary} />
                          <Text style={styles.link}>Vegetariërs slaan dit over</Text>
                        </Pressable>
                      </View>
                    </View>
                  );
                })}
              </ScrollView>
              <Pressable onPress={onSave} disabled={save.isPending} style={[styles.save, save.isPending && { opacity: 0.6 }]} testID="vega-save">
                {save.isPending ? (
                  <ActivityIndicator color={colors.onBrandPrimary} />
                ) : (
                  <Text style={styles.saveText}>{local ? "Vegetarische optie toevoegen" : "Vegetarische optie opslaan"}</Text>
                )}
              </Pressable>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center" },
  sheet: { backgroundColor: colors.surface, borderRadius: 20, width: "92%", maxWidth: 560, alignSelf: "center", marginVertical: "auto", maxHeight: "92%", padding: 16, gap: 10 },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  title: { fontSize: 18, fontFamily: fonts.bold, color: colors.onSurface },
  sub: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted },
  hint: { fontSize: 13, fontFamily: fonts.regular, color: colors.onSurfaceSecondary },
  center: { alignItems: "center", justifyContent: "center", padding: 30, gap: 8 },
  groupLabel: { fontSize: 13, fontFamily: fonts.bold, color: colors.onSurfaceSecondary, textTransform: "uppercase", letterSpacing: 0.3, marginTop: 4 },
  originRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  optMeat: { backgroundColor: colors.surfaceSecondary, borderStyle: "dashed" },
  opt: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  optOn: { borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary },
  optName: { fontSize: 14, fontFamily: fonts.medium, color: colors.onSurface },
  img: { width: 44, height: 44, borderRadius: 8, backgroundColor: colors.surfaceSecondary },
  row: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  smallBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: colors.border },
  link: { fontSize: 13, fontFamily: fonts.semibold, color: colors.brandPrimary },
  backRow: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 6 },
  save: { backgroundColor: colors.brandPrimary, borderRadius: 14, paddingVertical: 14, alignItems: "center" },
  saveText: { fontSize: 15, fontFamily: fonts.semibold, color: colors.onBrandPrimary },
}));
