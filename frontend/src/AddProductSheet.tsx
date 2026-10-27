// Vanaf een product (bijv. uit de aanbiedingen) meteen op een lijstje of aan een gerecht toevoegen.
// Beheerders kunnen het ook aan standaardgerechten (app-gerechten) toevoegen.
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import Modal from "@/src/components/Modal";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button, Icon } from "@/src/components/ui";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { useTerms } from "@/src/settings";
import { useToast } from "@/src/toast";
import { CATEGORY_LABELS, MEAL_CATEGORIES, type MealCategory } from "@/src/constants";
import { fonts, makeStyles, useTheme } from "@/src/theme";
import { NewListInline } from "@/src/NewListInline";
import { isOwnDish, type Dish } from "@/app/(tabs)/dishes";

type CampLite = { id: string; name: string; days: { index: number; date?: string | null }[] };

export function AddProductButtons({ productId, productName }: { productId: string; productName: string }) {
  const [mode, setMode] = useState<"camp" | "dish" | null>(null);
  const T = useTerms();
  return (
    <>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Button label={`Op ${T.one}`} sub="toevoegen" icon="playlist-plus" onPress={() => setMode("camp")} testID="product-to-camp" />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="Aan gerecht" sub="toevoegen" icon="silverware-fork-knife" variant="secondary" onPress={() => setMode("dish")} testID="product-to-dish" />
        </View>
      </View>
      <AddSheet mode={mode} onClose={() => setMode(null)} productId={productId} productName={productName} />
    </>
  );
}

function AddSheet({ mode, onClose, productId, productName }: { mode: "camp" | "dish" | null; onClose: () => void; productId: string; productName: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const toast = useToast();
  const T = useTerms();
  const { user, has } = useAuth();
  const [campId, setCampId] = useState<string | null>(null);
  const [day, setDay] = useState<number | null>(null); // leeg = algemene boodschappen
  const [meal, setMeal] = useState<MealCategory | null>(null);
  const [qty, setQty] = useState(1);
  const [dishTab, setDishTab] = useState<"eigen" | "app">("eigen");

  const camps = useQuery({ queryKey: ["camps"], queryFn: () => api<{ camps: CampLite[] }>("/camps"), enabled: mode === "camp" });
  const dishes = useQuery({ queryKey: ["dishes"], queryFn: () => api<{ dishes: Dish[] }>("/dishes"), enabled: mode === "dish" });
  const list = camps.data?.camps ?? [];
  const camp = list.find((c) => c.id === campId) ?? (list.length === 1 ? list[0] : undefined);
  const canStandard = has("manage_standard_dishes");
  const myDishes = (dishes.data?.dishes ?? []).filter(
    (d) => isOwnDish(d, user?.id) && (dishTab === "app" ? d.is_standard && canStandard : !d.is_standard),
  );

  const close = () => {
    setCampId(null);
    setDay(null);
    setMeal(null);
    setQty(1);
    onClose();
  };
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["camps"] });
    qc.invalidateQueries({ queryKey: ["home"] });
    qc.invalidateQueries({ queryKey: ["shopping"] });
  };

  const toCamp = useMutation({
    mutationFn: () =>
      api(`/products/${productId}/to-camp`, { method: "POST", body: { camp_id: camp!.id, day_index: day, meal: day == null ? null : meal, qty } }),
    onSuccess: () => {
      refresh();
      const c = camp!;
      close();
      toast.show(`${productName} staat op ${c.name}`, "success");
    },
    onError: (e: any) => toast.show(e?.message ?? "Toevoegen lukte niet", "error"),
  });
  const toDish = useMutation({
    mutationFn: (d: Dish) => api(`/products/${productId}/to-dish`, { method: "POST", body: { dish_id: d.id, qty_adult: qty, qty_child: qty } }),
    onSuccess: (_r, d) => {
      qc.invalidateQueries({ queryKey: ["dishes"] });
      close();
      toast.show(`${productName} toegevoegd aan ${d.name}`, "success");
    },
    onError: (e: any) => toast.show(e?.message ?? "Toevoegen lukte niet", "error"),
  });

  return (
    <Modal visible={mode != null} transparent animationType="fade" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close}>
        <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]} onPress={() => {}}>
          <ScrollView contentContainerStyle={{ gap: 12 }}>
            <Text style={styles.title}>{mode === "camp" ? `Op ${T.one} zetten` : "Aan gerecht toevoegen"}</Text>
            <Text style={styles.muted} numberOfLines={2}>{productName}</Text>

            <View style={styles.qtyRow}>
              <Text style={[styles.body, { flex: 1 }]}>{mode === "dish" ? "Per persoon" : "Aantal"}</Text>
              <Pressable onPress={() => setQty((q) => Math.max(1, q - 1))} hitSlop={8} style={styles.qtyBtn}>
                <Icon name="minus" size={18} color={colors.onSurface} />
              </Pressable>
              <Text style={[styles.body, { fontFamily: fonts.bold, minWidth: 24, textAlign: "center" }]}>{qty}</Text>
              <Pressable onPress={() => setQty((q) => q + 1)} hitSlop={8} style={styles.qtyBtn}>
                <Icon name="plus" size={18} color={colors.onSurface} />
              </Pressable>
            </View>

            {mode === "camp" ? (
              <>
                {camps.isLoading ? <ActivityIndicator color={colors.brandPrimary} /> : null}
                {list.length
                  ? list.map((c) => (
                      <Pressable key={c.id} onPress={() => { setCampId(c.id); setDay(null); }} style={[styles.row, camp?.id === c.id && styles.rowOn]}>
                        <Icon name="clipboard-list-outline" size={20} color={colors.brandPrimary} />
                        <Text style={styles.rowText}>{c.name}</Text>
                        {camp?.id === c.id ? <Icon name="check" size={20} color={colors.brandPrimary} /> : null}
                      </Pressable>
                    ))
                  : null}
                {!camps.isLoading ? <NewListInline onCreated={(id) => { setCampId(id); setDay(null); }} /> : null}
                {camp ? (
                  <>
                    <Text style={styles.label}>Wanneer?</Text>
                    <View style={styles.chips}>
                      <Pressable onPress={() => setDay(null)} style={[styles.chip, day == null && styles.chipOn]}>
                        <Text style={[styles.chipText, day == null && styles.chipTextOn]}>Algemeen</Text>
                      </Pressable>
                      {camp.days.map((d) => (
                        <Pressable key={d.index} onPress={() => setDay(d.index)} style={[styles.chip, day === d.index && styles.chipOn]}>
                          <Text style={[styles.chipText, day === d.index && styles.chipTextOn]}>Dag {d.index + 1}</Text>
                        </Pressable>
                      ))}
                    </View>
                    {day != null ? (
                      <>
                        <Text style={styles.label}>Bij welke maaltijd? (mag leeg)</Text>
                        <View style={styles.chips}>
                          {MEAL_CATEGORIES.map((m) => (
                            <Pressable key={m} onPress={() => setMeal((x) => (x === m ? null : m))} style={[styles.chip, meal === m && styles.chipOn]}>
                              <Text style={[styles.chipText, meal === m && styles.chipTextOn]}>{CATEGORY_LABELS[m]}</Text>
                            </Pressable>
                          ))}
                        </View>
                      </>
                    ) : null}
                    <Button label={`Op ${camp.name} zetten`} icon="check" loading={toCamp.isPending} onPress={() => toCamp.mutate()} testID="product-to-camp-save" />
                  </>
                ) : null}
              </>
            ) : (
              <>
                {canStandard ? (
                  <View style={styles.chips}>
                    <Pressable onPress={() => setDishTab("eigen")} style={[styles.chip, dishTab === "eigen" && styles.chipOn]}>
                      <Text style={[styles.chipText, dishTab === "eigen" && styles.chipTextOn]}>Eigen gerechten</Text>
                    </Pressable>
                    <Pressable onPress={() => setDishTab("app")} style={[styles.chip, dishTab === "app" && styles.chipOn]}>
                      <Text style={[styles.chipText, dishTab === "app" && styles.chipTextOn]}>App-gerechten</Text>
                    </Pressable>
                  </View>
                ) : null}
                {dishes.isLoading ? <ActivityIndicator color={colors.brandPrimary} /> : null}
                {!dishes.isLoading && !myDishes.length ? (
                  <Text style={styles.muted}>Nog geen gerechten. Maak er eerst een bij Gerechten.</Text>
                ) : null}
                {myDishes.map((d) => (
                  <Pressable key={d.id} onPress={() => toDish.mutate(d)} disabled={toDish.isPending} style={styles.row}>
                    <Icon name="silverware-fork-knife" size={18} color={colors.brandPrimary} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowText}>{d.name}</Text>
                      <Text style={styles.muted}>{CATEGORY_LABELS[d.category]}</Text>
                    </View>
                    <Icon name="plus-circle-outline" size={22} color={colors.brandPrimary} />
                  </Pressable>
                ))}
              </>
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center" },
  sheet: { backgroundColor: colors.surface, borderRadius: 20, width: "92%", maxWidth: 560, alignSelf: "center", marginVertical: "auto", maxHeight: "92%", padding: 18 },
  title: { fontSize: 20, fontFamily: fonts.bold, color: colors.onSurface },
  body: { fontSize: 15, fontFamily: fonts.regular, color: colors.onSurface },
  muted: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted },
  label: { fontSize: 13, fontFamily: fonts.semibold, color: colors.muted, marginTop: 4 },
  qtyRow: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surfaceSecondary, borderRadius: 12, padding: 10 },
  qtyBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, backgroundColor: colors.surfaceSecondary },
  rowOn: { backgroundColor: colors.brandTertiary },
  rowText: { flex: 1, fontSize: 15, fontFamily: fonts.semibold, color: colors.onSurface },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { fontSize: 13, fontFamily: fonts.semibold, color: colors.onSurface },
  chipTextOn: { color: colors.onBrandPrimary },
}));
