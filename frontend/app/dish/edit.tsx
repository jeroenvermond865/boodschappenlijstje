import { useMemo, useState } from "react";
import { FlatList, Modal, Pressable, ScrollView, Share, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Linking from "expo-linking";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button, Field, Icon, Select } from "@/src/components/ui";
import { api } from "@/src/api";
import {
  AISLES,
  CATEGORY_LABELS,
  MEAL_CATEGORIES,
  MealCategory,
  UNITS,
  formatQty,
} from "@/src/constants";
import type { Dish } from "@/app/(tabs)/dishes";
import type { Product } from "@/app/(tabs)/products";
import { useAuth } from "@/src/auth";
import { goBack } from "@/src/nav";
import { useToast } from "@/src/toast";
import { fonts, makeStyles, useTheme } from "@/src/theme";

type Ing = { name: string; unit: string; qtyAdult: string; qtyChild: string; aisle: string; price: string; productId?: string | null; diet: "all" | "vega" | "meat" };

const DIET_OPTS: { key: "all" | "vega" | "meat"; label: string; icon: string }[] = [
  { key: "all", label: "Iedereen", icon: "account-group-outline" },
  { key: "vega", label: "Vega", icon: "leaf" },
  { key: "meat", label: "Vlees", icon: "food-drumstick-outline" },
];

export default function DishEditScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ id?: string; category?: string }>();
  const { has } = useAuth();
  const canManageStandard = has("manage_standard_dishes");

  const { data: dishesData } = useQuery({
    queryKey: ["dishes"],
    queryFn: () => api<{ dishes: Dish[] }>("/dishes"),
  });

  const existing = useMemo(
    () => (params.id ? dishesData?.dishes.find((d) => d.id === params.id) : undefined),
    [params.id, dishesData],
  );
  const readOnly = !!existing?.is_standard && !canManageStandard;
  const isNew = !params.id;
  const [asStandard, setAsStandard] = useState(false);

  const [name, setName] = useState(existing?.name ?? "");
  const [category, setCategory] = useState<MealCategory>(
    existing?.category ?? ((params.category as MealCategory) || "avondeten"),
  );
  const [ings, setIngs] = useState<Ing[]>(
    existing
      ? existing.ingredients.map((i) => ({
          name: i.name,
          unit: i.unit,
          qtyAdult: formatQty(i.qty_adult),
          qtyChild: formatQty(i.qty_child),
          aisle: i.aisle,
          price: formatQty(i.price ?? 0),
          productId: i.product_id ?? null,
          diet: ((i as any).diet as "all" | "vega" | "meat") ?? "all",
        }))
      : [],
  );
  const [pickerOpen, setPickerOpen] = useState(false);

  const buildBody = () => ({
    name: name.trim(),
    category,
    is_standard: asStandard,
    ingredients: ings
      .filter((i) => i.name.trim())
      .map((i) => ({
        name: i.name.trim(),
        unit: i.unit,
        qty_adult: parseFloat(i.qtyAdult.replace(",", ".")) || 0,
        qty_child: parseFloat(i.qtyChild.replace(",", ".")) || 0,
        aisle: i.aisle,
        price: parseFloat(i.price.replace(",", ".")) || 0,
        product_id: i.productId ?? null,
        diet: i.diet,
      })),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["dishes"] });
    qc.invalidateQueries({ queryKey: ["camps"] });
  };

  const save = useMutation({
    mutationFn: () => {
      const body = buildBody();
      return params.id && !readOnly
        ? api(`/dishes/${params.id}`, { method: "PUT", body })
        : api("/dishes", { method: "POST", body });
    },
    onSuccess: () => {
      invalidate();
      toast.show("Gerecht opgeslagen", "success");
      router.back();
    },
    onError: (e: any) => toast.show(e?.message ?? "Opslaan mislukt", "error"),
  });

  const copyToOwn = useMutation({
    mutationFn: () => api("/dishes", { method: "POST", body: { ...buildBody(), name: `${name} (kopie)` } }),
    onSuccess: () => {
      invalidate();
      toast.show("Gekopieerd naar Eigen gerechten", "success");
      router.back();
    },
    onError: (e: any) => toast.show(e?.message ?? "Kopiëren mislukt", "error"),
  });

  const remove = useMutation({
    mutationFn: () => api(`/dishes/${params.id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidate();
      const dishId = params.id;
      toast.show("Gerecht verwijderd", "info", {
        label: "Ongedaan maken",
        onPress: async () => {
          try {
            await api(`/dishes/${dishId}/restore`, { method: "POST" });
            invalidate();
          } catch {
            toast.show("Herstellen mislukt", "error");
          }
        },
      });
      router.back();
    },
    onError: (e: any) => toast.show(e?.message ?? "Verwijderen mislukt", "error"),
  });

  const submit = useMutation({
    mutationFn: () => api(`/dishes/${params.id}/submit`, { method: "POST" }),
    onSuccess: () => {
      toast.show("Ingezonden ter beoordeling", "success");
    },
    onError: (e: any) => toast.show(e?.message ?? "Aanmelden mislukt", "error"),
  });

  const onSave = () => {
    if (!name.trim()) {
      toast.show("Geef het gerecht een naam", "error");
      return;
    }
    if (buildBody().ingredients.length === 0) {
      toast.show("Voeg minstens één product toe", "error");
      return;
    }
    save.mutate();
  };

  const updateIng = (idx: number, patch: Partial<Ing>) =>
    setIngs((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  const addProductIngredient = (p: Product) => {
    setIngs((prev) => [
      ...prev,
      { name: p.name, unit: p.unit, qtyAdult: "1", qtyChild: "1", aisle: p.aisle, price: "0", productId: p.id, diet: "all" },
    ]);
    setPickerOpen(false);
  };

  const onShare = async () => {
    if (!params.id) return;
    try {
      const { token } = await api<{ token: string }>(`/dishes/${params.id}/share`, { method: "POST" });
      const url = Linking.createURL(`/dish/shared/${token}`);
      await Share.share({ message: `Bekijk mijn gerecht "${name}" in Boodschappenlijstje:\n${url}` });
    } catch (e: any) {
      toast.show(e?.message ?? "Delen mislukt", "error");
    }
  };

  const title = isNew ? "Nieuw gerecht" : readOnly ? existing?.name : "Gerecht bewerken";

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable testID="close-button" onPress={() => goBack()} hitSlop={10} style={styles.headerBtn}>
          <Icon name="close" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {title}
        </Text>
        {!isNew ? (
          <View style={{ flexDirection: "row" }}>
            <Pressable testID="share-dish-button" onPress={onShare} hitSlop={10} style={styles.headerBtn}>
              <Icon name="share-variant" size={22} color={colors.brandPrimary} />
            </Pressable>
            {!readOnly ? (
              <Pressable testID="delete-dish-button" onPress={() => remove.mutate()} hitSlop={10} style={styles.headerBtn}>
                <Icon name="trash-can-outline" size={22} color={colors.error} />
              </Pressable>
            ) : null}
          </View>
        ) : (
          <View style={styles.headerBtn} />
        )}
      </View>

      <KeyboardAwareScrollView
        bottomOffset={20}
        contentContainerStyle={{ padding: 16, gap: 16 }}
        keyboardShouldPersistTaps="handled"
      >
        {readOnly ? (
          <View style={styles.banner}>
            <Icon name="information-outline" size={18} color={colors.onBrandTertiary} />
            <Text style={styles.bannerText}>Standaardgerecht — kopieer naar Eigen om aan te passen.</Text>
          </View>
        ) : existing?.is_standard && canManageStandard ? (
          <View style={styles.banner}>
            <Icon name="shield-account" size={18} color={colors.onBrandTertiary} />
            <Text style={styles.bannerText}>Standaardgerecht — je bewerkt dit voor iedereen (beheer).</Text>
          </View>
        ) : null}

        {!readOnly ? (
          <Field label="Naam gerecht" testID="dish-name" placeholder="Bijv. Spaghetti" value={name} onChangeText={setName} />
        ) : null}

        <View style={{ gap: 8 }}>
          <Text style={styles.label}>Categorie</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {MEAL_CATEGORIES.map((c) => {
              const active = category === c;
              return (
                <Pressable
                  key={c}
                  testID={`dish-cat-${c}`}
                  disabled={readOnly}
                  onPress={() => setCategory(c)}
                  style={[styles.chip, active && styles.chipActive, readOnly && { opacity: active ? 1 : 0.5 }]}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{CATEGORY_LABELS[c]}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        <View style={styles.ingHeaderRow}>
          <Text style={styles.label}>Producten (per persoon)</Text>
        </View>

        {ings.map((ing, idx) => (
          <View key={idx} style={styles.ingCard}>
            <View style={styles.ingTopRow}>
              {readOnly ? (
                <Text style={styles.ingNameRead}>{ing.name}</Text>
              ) : (
                <TextInput
                  testID={`ing-name-${idx}`}
                  placeholder="Product"
                  placeholderTextColor={colors.muted}
                  value={ing.name}
                  onChangeText={(t) => updateIng(idx, { name: t })}
                  style={styles.ingNameInput}
                />
              )}
              {!readOnly ? (
                <Pressable
                  testID={`ing-remove-${idx}`}
                  hitSlop={8}
                  onPress={() => setIngs((prev) => prev.filter((_, i) => i !== idx))}
                >
                  <Icon name="close-circle" size={22} color={colors.muted} />
                </Pressable>
              ) : null}
            </View>

            <View style={styles.qtyRow}>
              <View style={styles.qtyBox}>
                <Text style={styles.qtyLabel}>Volwassene</Text>
                {readOnly ? (
                  <Text style={styles.qtyRead}>{ing.qtyAdult}</Text>
                ) : (
                  <TextInput
                    testID={`ing-adult-${idx}`}
                    keyboardType="decimal-pad"
                    value={ing.qtyAdult}
                    onChangeText={(t) => updateIng(idx, { qtyAdult: t })}
                    style={styles.qtyInput}
                  />
                )}
              </View>
              <View style={styles.qtyBox}>
                <Text style={styles.qtyLabel}>Kind</Text>
                {readOnly ? (
                  <Text style={styles.qtyRead}>{ing.qtyChild}</Text>
                ) : (
                  <TextInput
                    testID={`ing-child-${idx}`}
                    keyboardType="decimal-pad"
                    value={ing.qtyChild}
                    onChangeText={(t) => updateIng(idx, { qtyChild: t })}
                    style={styles.qtyInput}
                  />
                )}
              </View>
            </View>

            <View style={styles.dietRow}>
              {DIET_OPTS.map((d) => {
                const active = ing.diet === d.key;
                return (
                  <Pressable
                    key={d.key}
                    testID={`ing-diet-${idx}-${d.key}`}
                    disabled={readOnly}
                    onPress={() => updateIng(idx, { diet: d.key })}
                    style={[styles.dietChip, active && styles.dietChipActive, readOnly && { opacity: active ? 1 : 0.5 }]}
                  >
                    <Icon name={d.icon as any} size={14} color={active ? colors.onBrandPrimary : colors.onSurfaceTertiary} />
                    <Text style={[styles.dietText, active && styles.dietTextActive]}>{d.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.selRow}>
              <Select
                testID={`ing-unit-${idx}`}
                value={ing.unit}
                options={UNITS}
                disabled={readOnly}
                icon="scale-balance"
                onChange={(v) => updateIng(idx, { unit: v })}
                style={{ flex: 1 }}
              />
              <Select
                testID={`ing-aisle-${idx}`}
                value={ing.aisle}
                options={AISLES}
                disabled={readOnly}
                icon="tag-outline"
                onChange={(v) => updateIng(idx, { aisle: v })}
                style={{ flex: 1 }}
              />
            </View>

            <View style={styles.priceRow}>
              {ing.productId ? (
                <View style={styles.linkedPrice}>
                  <Icon name="link-variant" size={15} color={colors.brandSecondary} />
                  <Text style={styles.linkedPriceText}>Prijs via productenlijst</Text>
                </View>
              ) : (
                <>
                  <Text style={styles.priceLabel}>Prijs per {ing.unit}</Text>
                  <View style={styles.priceInputWrap}>
                    <Text style={styles.priceEuro}>€</Text>
                    {readOnly ? (
                      <Text style={styles.priceRead}>{ing.price}</Text>
                    ) : (
                      <TextInput
                        testID={`ing-price-${idx}`}
                        keyboardType="decimal-pad"
                        value={ing.price}
                        onChangeText={(t) => updateIng(idx, { price: t })}
                        style={styles.priceInput}
                      />
                    )}
                  </View>
                </>
              )}
            </View>
          </View>
        ))}

        {!readOnly ? (
          <Pressable testID="pick-product-button" onPress={() => setPickerOpen(true)} style={styles.addIng}>
            <Icon name="cart-plus" size={20} color={colors.brandPrimary} />
            <Text style={styles.addIngText}>Product toevoegen</Text>
          </Pressable>
        ) : null}

        {isNew && canManageStandard ? (
          <Pressable
            testID="as-standard-toggle"
            onPress={() => setAsStandard((v) => !v)}
            style={styles.stdToggle}
          >
            <Icon
              name={asStandard ? "checkbox-marked" : "checkbox-blank-outline"}
              size={22}
              color={asStandard ? colors.brandPrimary : colors.muted}
            />
            <Text style={styles.stdToggleText}>Opslaan als standaardgerecht (zichtbaar voor iedereen)</Text>
          </Pressable>
        ) : null}

        {!isNew && existing && !existing.is_standard ? (
          <Pressable testID="submit-standard-button" onPress={() => submit.mutate()} style={styles.submitRow}>
            <Icon name="send-circle-outline" size={20} color={colors.brandSecondary} />
            <Text style={styles.submitText}>Aanmelden als standaardgerecht</Text>
          </Pressable>
        ) : null}
      </KeyboardAwareScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        {readOnly ? (
          <Button label="Kopiëren naar Eigen" icon="content-copy" onPress={() => copyToOwn.mutate()} loading={copyToOwn.isPending} testID="copy-dish-button" />
        ) : (
          <Button label="Opslaan" onPress={onSave} loading={save.isPending} testID="save-dish-button" />
        )}
      </View>

      <DishProductPicker open={pickerOpen} onClose={() => setPickerOpen(false)} onPick={addProductIngredient} />
    </View>
  );
}

function DishProductPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (p: Product) => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [q, setQ] = useState("");
  const { data } = useQuery({
    queryKey: ["products"],
    queryFn: () => api<{ products: Product[] }>("/products"),
    enabled: open,
  });
  const list = (data?.products ?? []).filter(
    (p) => !q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase()),
  );
  return (
    <Modal visible={open} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.pickerBackdrop}>
        <View style={[styles.pickerSheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.pickerHeader}>
            <Text style={styles.pickerTitle}>Kies een product</Text>
            <Pressable testID="dish-picker-close" onPress={onClose} hitSlop={8}>
              <Icon name="close" size={22} color={colors.onSurface} />
            </Pressable>
          </View>
          <View style={styles.pickerSearch}>
            <Icon name="magnify" size={20} color={colors.muted} />
            <TextInput
              testID="dish-product-search"
              placeholder="Zoek product"
              placeholderTextColor={colors.muted}
              value={q}
              onChangeText={setQ}
              style={styles.pickerSearchInput}
            />
          </View>
          <FlatList
            data={list}
            keyExtractor={(p) => p.id}
            style={{ maxHeight: 400 }}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <Pressable testID={`dish-product-${item.id}`} onPress={() => onPick(item)} style={styles.pickerRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.pickerName} numberOfLines={1}>{item.name}</Text>
                  <Text style={styles.pickerMeta}>{item.aisle} · per {item.unit}</Text>
                </View>
                <Text style={styles.pickerPrice}>{item.price > 0 ? `€ ${item.price.toFixed(2)}` : "—"}</Text>
                <Icon name="plus-circle-outline" size={22} color={colors.brandPrimary} />
              </Pressable>
            )}
            ListEmptyComponent={<Text style={styles.pickerEmpty}>Geen producten gevonden.</Text>}
          />
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  headerBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 17, fontFamily: fonts.semibold, color: colors.onSurface },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.brandTertiary,
    borderRadius: 12,
    padding: 12,
  },
  bannerText: { flex: 1, fontSize: 13, fontFamily: fonts.medium, color: colors.onBrandTertiary },
  label: { fontSize: 13, fontFamily: fonts.semibold, color: colors.onSurfaceSecondary },
  chipRow: { gap: 8, paddingVertical: 2 },
  chip: {
    height: 36,
    flexShrink: 0,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: colors.surfaceTertiary,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: "center",
  },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { fontSize: 14, fontFamily: fonts.medium, color: colors.onSurfaceTertiary },
  chipTextActive: { color: colors.onBrandPrimary },
  ingHeaderRow: { marginTop: 4 },
  ingCard: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 12,
  },
  ingTopRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  ingNameInput: {
    flex: 1,
    fontSize: 16,
    fontFamily: fonts.semibold,
    color: colors.onSurface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: 6,
  },
  ingNameRead: { flex: 1, fontSize: 16, fontFamily: fonts.semibold, color: colors.onSurface },
  qtyRow: { flexDirection: "row", gap: 10 },
  qtyBox: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 10,
    gap: 4,
  },
  qtyLabel: { fontSize: 11, fontFamily: fonts.medium, color: colors.muted },
  qtyInput: { fontSize: 18, fontFamily: fonts.bold, color: colors.onSurface, padding: 0 },
  qtyRead: { fontSize: 18, fontFamily: fonts.bold, color: colors.onSurface },
  selRow: { flexDirection: "row", gap: 10 },
  dietRow: { flexDirection: "row", gap: 6 },
  dietChip: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 8, borderRadius: 10, backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border },
  dietChipActive: { backgroundColor: colors.brandSecondary, borderColor: colors.brandSecondary },
  dietText: { fontSize: 12, fontFamily: fonts.semibold, color: colors.onSurfaceTertiary },
  dietTextActive: { color: colors.onBrandSecondary },
  selBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  selText: { fontSize: 13, fontFamily: fonts.semibold, color: colors.onSurfaceTertiary },
  priceRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  priceLabel: { fontSize: 13, fontFamily: fonts.medium, color: colors.onSurfaceSecondary },
  priceInputWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minWidth: 90,
  },
  priceEuro: { fontSize: 15, fontFamily: fonts.semibold, color: colors.muted },
  priceInput: { flex: 1, fontSize: 15, fontFamily: fonts.bold, color: colors.onSurface, padding: 0, textAlign: "right" },
  priceRead: { flex: 1, fontSize: 15, fontFamily: fonts.bold, color: colors.onSurface, textAlign: "right" },
  addIng: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: colors.borderStrong,
  },
  addRow: { flexDirection: "row", gap: 10 },
  linkedPrice: { flexDirection: "row", alignItems: "center", gap: 6 },
  linkedPriceText: { fontSize: 13, fontFamily: fonts.semibold, color: colors.brandSecondary },
  pickerBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  pickerSheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16, gap: 12 },
  pickerHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  pickerTitle: { fontSize: 18, fontFamily: fonts.bold, color: colors.onSurface },
  pickerSearch: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
  },
  pickerSearchInput: { flex: 1, paddingVertical: 11, fontSize: 15, fontFamily: fonts.regular, color: colors.onSurface },
  pickerRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.divider },
  pickerName: { fontSize: 15, fontFamily: fonts.semibold, color: colors.onSurface },
  pickerMeta: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted, marginTop: 2 },
  pickerPrice: { fontSize: 14, fontFamily: fonts.bold, color: colors.onSurface },
  pickerEmpty: { fontSize: 14, fontFamily: fonts.regular, color: colors.muted, textAlign: "center", padding: 20 },
  newProductBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 12, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.brandPrimary, borderStyle: "dashed" },
  newProductText: { fontSize: 14, fontFamily: fonts.semibold, color: colors.brandPrimary },
  addIngText: { fontSize: 15, fontFamily: fonts.semibold, color: colors.brandPrimary },
  stdToggle: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 },
  stdToggleText: { flex: 1, fontSize: 14, fontFamily: fonts.medium, color: colors.onSurfaceSecondary },
  submitRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.brandSecondary,
  },
  submitText: { fontSize: 15, fontFamily: fonts.semibold, color: colors.onSurfaceSecondary },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    backgroundColor: colors.surface,
  },
}));
