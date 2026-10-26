import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from "react-native";
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

type VegaItem = { index: number; name: string; unit?: string; qty_adult?: number; options: Product[] };

// Vlees of vis in een gerecht: kies per onderdeel een vega-vervanger (of laat het voor de vega-eters weg)
export function VegaPicker({ dish, onClose }: { dish: { id: string; name: string } | null; onClose: () => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const toast = useToast();
  const [choice, setChoice] = useState<Record<number, Product | "skip">>({});
  const [browseFor, setBrowseFor] = useState<number | null>(null);
  useEffect(() => {
    setChoice({});
    setBrowseFor(null);
  }, [dish?.id]);

  const q = useQuery({
    queryKey: ["vega", dish?.id],
    enabled: !!dish,
    queryFn: () => api<{ items: VegaItem[] }>(`/dishes/${dish!.id}/vega`),
  });
  // Eerste voorstel staat alvast klaar
  useEffect(() => {
    if (q.data) setChoice((c) => Object.fromEntries(q.data.items.map((i) => [i.index, c[i.index] ?? i.options[0] ?? "skip"])));
  }, [q.data]);

  const save = useMutation({
    mutationFn: () =>
      api(`/dishes/${dish!.id}/vega`, {
        method: "POST",
        body: { choices: (q.data?.items ?? []).map((i) => ({ index: i.index, product_id: choice[i.index] && choice[i.index] !== "skip" ? (choice[i.index] as Product).id : null })) },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dishes"] });
      qc.invalidateQueries({ queryKey: ["shopping"] });
      qc.invalidateQueries({ queryKey: ["budget"] });
      toast.show("Vega-optie toegevoegd aan het gerecht", "success");
      onClose();
    },
    onError: (e: any) => toast.show(e?.message ?? "Opslaan mislukt", "error"),
  });

  const items = q.data?.items ?? [];
  return (
    <Modal visible={!!dish} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
          <View style={styles.head}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Vega-optie kiezen</Text>
              <Text style={styles.sub} numberOfLines={1}>{dish?.name}</Text>
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
              <Text style={styles.sub}>Vega-vervangers zoeken…</Text>
            </View>
          ) : !items.length ? (
            <View style={styles.center}>
              <Text style={styles.sub}>Dit gerecht heeft geen vlees of vis meer zonder vega-optie.</Text>
            </View>
          ) : (
            <>
              <Text style={styles.hint}>
                Het vlees gaat dan alleen naar de vleeseters; de vervanger komt in dezelfde hoeveelheid op de lijst voor de vega-eters.
              </Text>
              <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ gap: 16, paddingBottom: 8 }}>
                {items.map((it) => {
                  const cur = choice[it.index];
                  const opts = [...it.options];
                  if (cur && cur !== "skip" && !opts.some((o) => o.id === cur.id)) opts.unshift(cur);
                  return (
                    <View key={it.index} style={{ gap: 8 }}>
                      <Text style={styles.ingName}>In plaats van {it.name}</Text>
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
                          <Text style={styles.link}>Vega-eters slaan dit over</Text>
                        </Pressable>
                      </View>
                    </View>
                  );
                })}
              </ScrollView>
              <Pressable onPress={() => save.mutate()} disabled={save.isPending} style={[styles.save, save.isPending && { opacity: 0.6 }]}>
                {save.isPending ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveText}>Vega-optie opslaan</Text>}
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
  ingName: { fontSize: 15, fontFamily: fonts.semibold, color: colors.onSurface },
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
