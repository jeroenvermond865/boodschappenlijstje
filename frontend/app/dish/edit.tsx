import { useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Image, Pressable, ScrollView, Share, Text, TextInput, View } from "react-native";
import Modal from "@/src/components/Modal";
import { norm } from "@/src/smartSearch";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { PrepSteps } from "@/src/DishPreview";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Linking from "expo-linking";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button, Field, Icon, Select } from "@/src/components/ui";
import { api } from "@/src/api";
import { dietConflicts, useDiet } from "@/src/diet";
import { useTerms } from "@/src/settings";
import { fetchProducts, useDebounced } from "@/src/search";
import { ProductBrowser } from "@/src/ProductBrowser";
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

type Ing = {
  name: string;
  unit: string;
  qtyAdult: string;
  qtyChild: string;
  aisle: string;
  price: string;
  productId?: string | null;
  store?: string | null;
  recipeText?: string | null;
  diet: "all" | "vega" | "meat";
};
type AltProduct = Product & { note?: string | null; offer?: boolean };

// Producten waar iedereen een eigen smaak in heeft (zelfde lijst als _CHOICE_RE op de server)
const CHOICE_RE =
  /\b(chips|tortillachips|nacho\w*|frisdrank|limonade|siroop|ranja|cola|sap|vruchtensap|koek\w*|snoep\w*|drop|chocolade\w*|ijs|roomijs|bier|wijn|toetje\w*|vla|yoghurtdrank|zuiveldrank|smaakje|beleg|zoet beleg|hartig beleg|thee|koffie|ontbijtgranen|muesli|cruesli)\b/;
const isChoice = (name: string) => CHOICE_RE.test(norm(name));
const STORE_SHORT: Record<string, string> = { "Albert Heijn": "AH", Jumbo: "Jumbo", Dirk: "Dirk" };

// Vlees en vis zijn alleen voor de vleeseters (zelfde regel als op de server)
const MEAT_RE = /kip|gehakt|worst|spek(?!ul)|\bham\b|bacon|biefstuk|varken|rund|kalkoen|kalfs|lams|burger|schnitzel|shoarma|gyros|saucijs|slavink|frikandel|salami|chorizo|pancetta|prosciutto|ossenhaas|entrecote|steak|stoofvlees|riblap|sukade|vlees|karbonade|\bvis\b|visstick|zalm|tonijn|kabeljauw|pangasius|koolvis|tilapia|garna|kibbeling|lekkerbek|makreel|haring|mosselen|inktvis|ansjovis|surimi/;
const VEGA_RE = /vega|vegetari|plantaardig|vegan|veggie|garden gourmet|beyond|valess|like meat|vivera|quorn|tofu|tempeh|seitan|falafel|bouillon|fond\b|kruiden|saus|vleestomaat|smaak/;
export function guessDiet(name: string): "all" | "meat" {
  const n = name.toLowerCase();
  return MEAT_RE.test(n) && !VEGA_RE.test(n) ? "meat" : "all";
}

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
  const params = useLocalSearchParams<{ id?: string; category?: string; campId?: string }>();
  // Vanuit een activiteit: aanpassingen gelden alleen voor die activiteit
  const campId = params.campId || null;
  const T = useTerms();
  const [alsoOwn, setAlsoOwn] = useState(false);
  const { has } = useAuth();
  const canManageStandard = has("manage_standard_dishes");
  const { selected: diet } = useDiet();

  const { data: dishesData } = useQuery({
    queryKey: ["dishes"],
    queryFn: () => api<{ dishes: Dish[] }>("/dishes"),
  });

  const existing = useMemo(
    () => (params.id ? dishesData?.dishes.find((d) => d.id === params.id) : undefined),
    [params.id, dishesData],
  );
  const readOnly = !campId && !!existing?.is_standard && !canManageStandard;
  const isNew = !params.id;
  const [asStandard, setAsStandard] = useState(false);

  const [name, setName] = useState(existing?.name ?? "");
  const [category, setCategory] = useState<MealCategory>(
    existing?.category ?? ((params.category as MealCategory) || "avondeten"),
  );
  const toIng = (i: Dish["ingredients"][number]): Ing => ({
    name: i.name,
    unit: i.unit,
    qtyAdult: formatQty(i.qty_adult),
    qtyChild: formatQty(i.qty_child),
    aisle: i.aisle,
    price: formatQty(i.price ?? 0),
    productId: i.product_id ?? null,
    store: i.store ?? null,
    recipeText: i.recipe_text ?? null,
    diet: ((i as any).diet as "all" | "vega" | "meat") ?? "all",
  });
  const [pantry, setPantry] = useState<Ing[]>((existing?.pantry ?? []).map(toIng));
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
          store: i.store ?? null,
          recipeText: i.recipe_text ?? null,
          diet: ((i as any).diet as "all" | "vega" | "meat") ?? "all",
        }))
      : [],
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [swapIdx, setSwapIdx] = useState<number | null>(null);
  // Pop-up met het product zelf (en eventueel het voorstel om te wisselen) voordat je kiest
  const [swapFocus, setSwapFocus] = useState<{ current?: AltProduct | null; suggest?: AltProduct | null }>({});
  const openSwap = (idx: number, focus: { current?: AltProduct | null; suggest?: AltProduct | null } = {}) => {
    setSwapFocus(focus);
    setSwapIdx(idx);
  };

  // Gekoppelde producten (foto, winkel, prijs) en voorstellen om te wisselen
  const linkedIds = ings.map((i) => i.productId).filter(Boolean) as string[];
  const linked = useQuery({
    queryKey: ["products", "by-ids", linkedIds.join(",")],
    queryFn: () => api<{ products: Product[] }>(`/products/by-ids?ids=${linkedIds.join(",")}`),
    enabled: linkedIds.length > 0,
    placeholderData: (prev) => prev,
  });
  const byId = useMemo(() => Object.fromEntries((linked.data?.products ?? []).map((p) => [p.id, p])), [linked.data]);
  const suggest = useQuery({
    queryKey: ["dish-suggestions", ings.map((i) => `${i.productId ?? ""}:${i.name}`).join("|")],
    queryFn: () =>
      api<{ suggestions: (AltProduct | null)[] }>("/dishes/suggestions", {
        method: "POST",
        body: { ingredients: ings.map((i) => ({ product_id: i.productId ?? null, name: i.name })) },
      }),
    enabled: !readOnly && linkedIds.length > 0,
    staleTime: 10 * 60 * 1000,
    placeholderData: (prev) => prev,
  });
  const [dismissed, setDismissed] = useState<Record<string, boolean>>({});

  // Ingrediënten zonder product (bijv. app-gerechten): meteen het best passende product in jouw winkel erbij zoeken
  const matched = useRef(false);
  useEffect(() => {
    if (matched.current || !ings.length) return;
    matched.current = true;
    const missing = ings.map((i, k) => (!i.productId && i.name.trim() ? k : -1)).filter((k) => k >= 0);
    if (!missing.length) return;
    api<{ matches: (Product | null)[] }>("/dishes/match", { method: "POST", body: { names: missing.map((k) => ings[k].name) } })
      .then((r) =>
        setIngs((prev) =>
          prev.map((it, k) => {
            const p = missing.includes(k) ? r.matches[missing.indexOf(k)] : null;
            return p && !it.productId ? { ...it, productId: p.id, store: p.source ?? null } : it;
          }),
        ),
      )
      .catch(() => {});
  }, [ings]);

  const toBody = (i: Ing) => ({
    name: i.name.trim(),
    unit: i.unit,
    qty_adult: parseFloat(i.qtyAdult.replace(",", ".")) || 0,
    qty_child: parseFloat(i.qtyChild.replace(",", ".")) || 0,
    aisle: i.aisle,
    price: parseFloat(i.price.replace(",", ".")) || 0,
    product_id: i.productId ?? null,
    store: i.store ?? null,
    recipe_text: i.recipeText ?? null,
    diet: i.diet,
  });
  const buildBody = () => ({
    name: name.trim(),
    category,
    is_standard: asStandard,
    pantry: pantry.map(toBody),
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
        store: i.store ?? null,
        recipe_text: i.recipeText ?? null,
        diet: i.diet,
      })),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["dishes"] });
    qc.invalidateQueries({ queryKey: ["camps"] });
  };

  const save = useMutation({
    mutationFn: async () => {
      const body = buildBody();
      if (campId && params.id) {
        const out = await api(`/camps/${campId}/dishes/${params.id}`, { method: "PUT", body });
        if (alsoOwn) await api("/dishes", { method: "POST", body });
        return out;
      }
      return params.id && !readOnly
        ? api(`/dishes/${params.id}`, { method: "PUT", body })
        : api("/dishes", { method: "POST", body });
    },
    onSuccess: () => {
      invalidate();
      if (campId) qc.invalidateQueries({ queryKey: ["camp", campId] });
      // Andere producten: de bereiding opnieuw laten maken
      qc.invalidateQueries({ queryKey: ["dish-prep"] });
      qc.invalidateQueries({ queryKey: ["dish"] });
      toast.show(campId ? (alsoOwn ? `Opgeslagen voor ${T.deze} ${T.one} en bij je eigen gerechten` : `Opgeslagen voor ${T.deze} ${T.one}`) : "Gerecht opgeslagen", "success");
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
      { name: p.name, unit: p.unit, qtyAdult: "1", qtyChild: "1", aisle: p.aisle, price: "0", productId: p.id, store: p.source ?? null, diet: guessDiet(p.name) },
    ]);
  };

  const swapProduct = (idx: number, p: Product) => {
    updateIng(idx, { productId: p.id, name: p.name, aisle: p.aisle, store: p.source ?? null, price: String(p.price ?? 0) });
    setSwapIdx(null);
  };

  const onShare = async () => {
    if (!params.id) return;
    try {
      const { token } = await api<{ token: string }>(`/dishes/${params.id}/share`, { method: "POST" });
      const url = Linking.createURL(`/dish/shared/${token}`);
      await Share.share({ message: `Bekijk mijn gerecht "${name}" in Slim Boodschappenlijstje:\n${url}` });
    } catch (e: any) {
      toast.show(e?.message ?? "Delen mislukt", "error");
    }
  };

  const dietWarn = dietConflicts([...ings, ...pantry], diet);
  const title = isNew ? "Nieuw gerecht" : readOnly ? existing?.name : campId ? `Gerecht in ${T.deze} ${T.one}` : "Gerecht bewerken";

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
            {!readOnly && !campId ? (
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

        {dietWarn.length ? (
          <View style={[styles.banner, { backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.error }]} testID="dish-diet-warning">
            <Icon name="alert-circle-outline" size={18} color={colors.error} />
            <Text style={[styles.bannerText, { color: colors.error }]}>Bevat mogelijk: {dietWarn.join(", ")}. Controleer het etiket.</Text>
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
                <>
                <Pressable
                  testID={`ing-pantry-${idx}`}
                  hitSlop={8}
                  onPress={() => {
                    setPantry((prev) => [...prev, ing]);
                    setIngs((prev) => prev.filter((_, i) => i !== idx));
                  }}
                >
                  <Icon name="home-import-outline" size={22} color={colors.muted} />
                </Pressable>
                <Pressable
                  testID={`ing-remove-${idx}`}
                  hitSlop={8}
                  onPress={() => setIngs((prev) => prev.filter((_, i) => i !== idx))}
                >
                  <Icon name="close-circle" size={22} color={colors.muted} />
                </Pressable>
                </>
              ) : null}
            </View>

            {ing.recipeText ? <Text style={styles.recipeText}>In het recept: {ing.recipeText}</Text> : null}
            {isChoice(ing.name) ? (
              <View style={styles.chooseHint}>
                <Icon name="gesture-tap" size={14} color={colors.brandPrimary} />
                <Text style={styles.chooseHintText}>Smaak verschilt per persoon: je kiest de soort zelf op je boodschappenlijst.</Text>
              </View>
            ) : null}

            {ing.productId && byId[ing.productId] ? (
              <View style={styles.linkedRow}>
                <Pressable
                  testID={`ing-product-${idx}`}
                  onPress={() => openSwap(idx, { current: byId[ing.productId!] })}
                  style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 10 }}
                >
                {byId[ing.productId].image ? (
                  <Image source={{ uri: byId[ing.productId].image! }} style={styles.linkedImg} resizeMode="contain" />
                ) : (
                  <View style={styles.linkedImg} />
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.linkedName} numberOfLines={1}>
                    {byId[ing.productId].name}
                  </Text>
                  <Text style={styles.linkedMeta} numberOfLines={1}>
                    {STORE_SHORT[byId[ing.productId].source ?? ""] ?? byId[ing.productId].source ?? ""} · {byId[ing.productId].unit} ·{" "}
                    {byId[ing.productId].price > 0 ? `€ ${(byId[ing.productId].promo?.price ?? byId[ing.productId].price).toFixed(2).replace(".", ",")}` : "—"}
                  </Text>
                </View>
                </Pressable>
                {!readOnly ? (
                  <Pressable onPress={() => openSwap(idx, { current: byId[ing.productId!] })} style={styles.swapBtn} testID={`ing-swap-${idx}`}>
                    <Icon name="swap-horizontal" size={16} color={colors.brandPrimary} />
                    <Text style={styles.swapText}>Wissel</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : !readOnly ? (
              <Pressable onPress={() => openSwap(idx)} style={styles.linkBtn} testID={`ing-link-${idx}`}>
                <Icon name="link-variant-plus" size={16} color={colors.brandPrimary} />
                <Text style={styles.swapText}>Koppel aan een product</Text>
              </Pressable>
            ) : null}

            {(() => {
              const sg = suggest.data?.suggestions?.[idx];
              if (readOnly || !sg || !ing.productId || dismissed[`${ing.productId}>${sg.id}`]) return null;
              return (
                <View style={styles.hint}>
                  <Icon name="lightbulb-on-outline" size={16} color={colors.success} />
                  <Pressable onPress={() => openSwap(idx, { current: byId[ing.productId!], suggest: sg })} style={{ flex: 1 }} testID={`ing-hint-${idx}`}>
                    <Text style={styles.hintText} numberOfLines={2}>
                      Bij {STORE_SHORT[sg.source ?? ""] ?? sg.source}: {sg.name} · {sg.note}
                    </Text>
                  </Pressable>
                  <Pressable onPress={() => openSwap(idx, { current: byId[ing.productId!], suggest: sg })} hitSlop={6}>
                    <Text style={styles.swapText}>Bekijk</Text>
                  </Pressable>
                  <Pressable onPress={() => setDismissed((d) => ({ ...d, [`${ing.productId}>${sg.id}`]: true }))} hitSlop={6}>
                    <Icon name="close" size={16} color={colors.muted} />
                  </Pressable>
                </View>
              );
            })()}

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

        {pantry.length ? (
          <View style={{ gap: 8 }}>
            <Text style={styles.label}>Waarschijnlijk al in huis</Text>
            <Text style={styles.recipeText}>Staat niet op je boodschappenlijst. Voeg toe wat je toch moet kopen.</Text>
            {pantry.map((pi, k) => (
              <View key={k} style={styles.pantryRow}>
                <Icon name="home-outline" size={18} color={colors.muted} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.linkedName} numberOfLines={1}>
                    {pi.recipeText || pi.name}
                  </Text>
                  {pi.recipeText && pi.productId ? (
                    <Text style={styles.linkedMeta} numberOfLines={1}>
                      Voorstel: {pi.name}
                    </Text>
                  ) : null}
                </View>
                {!readOnly ? (
                  <Pressable
                    onPress={() => {
                      setIngs((prev) => [...prev, pi]);
                      setPantry((prev) => prev.filter((_, j) => j !== k));
                    }}
                    style={styles.swapBtn}
                  >
                    <Icon name="plus" size={16} color={colors.brandPrimary} />
                    <Text style={styles.swapText}>Toevoegen</Text>
                  </Pressable>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}

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

        {!isNew && existing && !existing.is_standard && !campId ? (
          <Pressable testID="submit-standard-button" onPress={() => submit.mutate()} style={styles.submitRow}>
            <Icon name="send-circle-outline" size={20} color={colors.brandSecondary} />
            <Text style={styles.submitText}>Aanmelden als standaardgerecht</Text>
          </Pressable>
        ) : null}
        {params.id ? (
          <View style={{ marginTop: 8 }}>
            <PrepSteps dishId={params.id} campId={campId ?? undefined} />
          </View>
        ) : null}
      </KeyboardAwareScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        {readOnly ? (
          <Button label="Kopiëren naar Eigen" icon="content-copy" onPress={() => copyToOwn.mutate()} loading={copyToOwn.isPending} testID="copy-dish-button" />
        ) : (
          <>
            {campId ? (
              <Pressable testID="also-own" onPress={() => setAlsoOwn((v) => !v)} style={styles.alsoOwn}>
                <Icon name={alsoOwn ? "checkbox-marked" : "checkbox-blank-outline"} size={22} color={colors.brandPrimary} />
                <Text style={styles.alsoOwnText}>Ook opslaan bij mijn eigen gerechten</Text>
              </Pressable>
            ) : null}
            <Button label={campId ? `Opslaan voor ${T.deze} ${T.one}` : "Opslaan"} onPress={onSave} loading={save.isPending} testID="save-dish-button" />
          </>
        )}
      </View>

      <DishProductPicker key={pickerOpen ? "open" : "closed"} open={pickerOpen} onClose={() => setPickerOpen(false)} onPick={addProductIngredient} />
      <SwapSheet
        ing={swapIdx != null ? ings[swapIdx] : null}
        focus={swapFocus}
        readOnly={readOnly}
        onClose={() => setSwapIdx(null)}
        onPick={(p) => swapIdx != null && swapProduct(swapIdx, p)}
      />
    </View>
  );
}

function SwapSheet({
  ing,
  focus,
  readOnly,
  onClose,
  onPick,
}: {
  ing: Ing | null;
  focus?: { current?: AltProduct | null; suggest?: AltProduct | null };
  readOnly?: boolean;
  onClose: () => void;
  onPick: (p: Product) => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState("");
  const [src, setSrc] = useState<string>("");
  const debouncedQ = useDebounced(q);
  const open = !!ing;
  const alts = useQuery({
    queryKey: ["alternatives", ing?.productId ?? "", ing?.name ?? ""],
    queryFn: () =>
      api<{ terms: string; groups: { store: string; same_store: boolean; products: AltProduct[] }[] }>(
        `/alternatives?name=${encodeURIComponent(ing!.name)}&product_id=${encodeURIComponent(ing!.productId ?? "")}`,
      ),
    enabled: open,
    staleTime: 10 * 60 * 1000,
  });
  const search = useQuery({
    queryKey: ["products", "search", "swap", debouncedQ.trim(), src],
    queryFn: () => fetchProducts({ q: debouncedQ, source: src || undefined, limit: 40 }),
    enabled: open && debouncedQ.trim().length > 1,
    placeholderData: (prev) => prev,
  });
  const close = () => {
    setQ("");
    onClose();
  };
  const searching = debouncedQ.trim().length > 1;

  const Row = ({ p }: { p: AltProduct }) => (
    <Pressable onPress={() => { setQ(""); onPick(p); }} style={styles.altRow}>
      {p.image ? <Image source={{ uri: p.image }} style={styles.altImg} resizeMode="contain" /> : <View style={styles.altImg} />}
      <View style={{ flex: 1 }}>
        <Text style={styles.pickerName} numberOfLines={2}>
          {p.name}
        </Text>
        <Text style={styles.pickerMeta} numberOfLines={1}>
          {STORE_SHORT[p.source ?? ""] ?? p.source ?? "Eigen"} · {p.unit}
          {p.unit_price ? ` · ${p.unit_price}` : ""}
        </Text>
        {p.note || p.offer || p.promo ? (
          <View style={{ flexDirection: "row", gap: 6, marginTop: 3, flexWrap: "wrap" }}>
            {p.note ? <Text style={styles.altGood}>{p.note}</Text> : null}
            {p.offer || p.promo ? <Text style={styles.altOffer}>{p.promo?.label ?? "Aanbieding"}</Text> : null}
          </View>
        ) : null}
      </View>
      <Text style={styles.pickerPrice}>{p.price > 0 ? `€ ${(p.promo?.price ?? p.price).toFixed(2).replace(".", ",")}` : "—"}</Text>
    </Pressable>
  );

  const Big = ({ p, label, action }: { p: AltProduct; label: string; action?: { text: string; onPress: () => void } }) => (
    <View style={styles.bigCard}>
      <Text style={styles.altHead}>{label}</Text>
      <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
        {p.image ? <Image source={{ uri: p.image }} style={styles.bigImg} resizeMode="contain" /> : <View style={styles.bigImg} />}
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.bigName}>{p.name}</Text>
          <Text style={styles.pickerMeta}>
            {STORE_SHORT[p.source ?? ""] ?? p.source ?? "Eigen"} · {p.unit}
            {p.unit_price ? ` · ${p.unit_price}` : ""}
          </Text>
          <Text style={styles.bigPrice}>{p.price > 0 ? `€ ${(p.promo?.price ?? p.price).toFixed(2).replace(".", ",")}` : "—"}</Text>
          {p.promo || p.note ? (
            <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
              {p.note ? <Text style={styles.altGood}>{p.note}</Text> : null}
              {p.promo ? <Text style={styles.altOffer}>{p.promo.label ?? "Aanbieding"}</Text> : null}
            </View>
          ) : null}
        </View>
      </View>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        {action ? (
          <Pressable onPress={action.onPress} style={[styles.swapBtn, { backgroundColor: colors.brandPrimary }]}>
            <Icon name="swap-horizontal" size={16} color={colors.onBrandPrimary} />
            <Text style={[styles.swapText, { color: colors.onBrandPrimary }]}>{action.text}</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => {
            close();
            router.push(`/product/${p.id}`);
          }}
          style={styles.swapBtn}
        >
          <Icon name="information-outline" size={16} color={colors.brandPrimary} />
          <Text style={styles.swapText}>Alles over dit product</Text>
        </Pressable>
      </View>
    </View>
  );

  return (
    <Modal visible={open} animationType="fade" transparent onRequestClose={close}>
      <View style={styles.pickerBackdrop}>
        <View style={[styles.pickerSheet, { paddingBottom: insets.bottom + 16, maxHeight: "92%" }]}>
          <View style={styles.pickerHeader}>
            <Text style={styles.pickerTitle} numberOfLines={1}>
              {focus?.current || focus?.suggest ? ing?.name : `Ander product voor ${ing?.name}`}
            </Text>
            <Pressable onPress={close} hitSlop={8}>
              <Icon name="close" size={22} color={colors.onSurface} />
            </Pressable>
          </View>
          {focus?.current || focus?.suggest ? (
            <View style={{ gap: 10, flexShrink: 0 }}>
              {focus.suggest ? (
                <Big
                  p={focus.suggest}
                  label="Voorstel"
                  action={readOnly ? undefined : { text: "Wissel naar dit product", onPress: () => onPick(focus.suggest!) }}
                />
              ) : null}
              {focus.current && !focus.suggest ? <Big p={focus.current} label="In dit gerecht" /> : null}
              {!readOnly ? <Text style={styles.altHead}>Of kies een ander product</Text> : null}
            </View>
          ) : null}
          {readOnly ? null : (
          <View style={styles.pickerSearch}>
            <Icon name="magnify" size={20} color={colors.muted} />
            <TextInput
              placeholder="Zelf zoeken in alle producten"
              placeholderTextColor={colors.muted}
              value={q}
              onChangeText={setQ}
              style={styles.pickerSearchInput}
            />
          </View>
          )}
          {searching ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8, alignItems: "center", paddingVertical: 2 }}
              style={{ flexGrow: 0, flexShrink: 0, minHeight: 40 }}
            >
              {["", "Albert Heijn", "Jumbo", "Dirk"].map((s) => (
                <Pressable key={s || "all"} onPress={() => setSrc(s)} style={[styles.chip, { minHeight: 34, justifyContent: "center" }, src === s && styles.chipActive]}>
                  <Text style={[styles.chipText, src === s && styles.chipTextActive]}>{s ? STORE_SHORT[s] : "Alle winkels"}</Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 4 }} style={readOnly ? { display: "none" } : undefined}>
            {searching ? (
              (search.data?.products ?? []).map((p) => <Row key={p.id} p={p} />)
            ) : alts.isLoading ? (
              <Text style={styles.pickerEmpty}>Voorstellen zoeken…</Text>
            ) : (
              (alts.data?.groups ?? []).map((g) =>
                g.products.length ? (
                  <View key={g.store} style={{ gap: 4, marginBottom: 8 }}>
                    <Text style={styles.altHead}>
                      {g.same_store ? `Ook bij ${g.store}` : `Bij ${g.store}`}
                    </Text>
                    {g.products.map((p) => (
                      <Row key={p.id} p={p} />
                    ))}
                  </View>
                ) : null,
              )
            )}
            {!searching && alts.data && !alts.data.groups.some((g) => g.products.length) ? (
              <Text style={styles.pickerEmpty}>Geen voorstellen gevonden. Zoek hierboven zelf een product.</Text>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function DishProductPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (p: Product) => void }) {
  // Zelfde zoeken en filters als de Producten-pagina
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [picked, setPicked] = useState<string[]>([]);
  return (
    <Modal visible={open} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.pickerBackdrop}>
        <View style={[styles.pickerSheet, { height: "92%", paddingHorizontal: 0, paddingBottom: insets.bottom + 8 }]}>
          <View style={[styles.pickerHeader, { paddingHorizontal: 16 }]}>
            <Text style={styles.pickerTitle}>Kies een product</Text>
            <Pressable testID="dish-picker-close" onPress={onClose} hitSlop={8}>
              <Text style={[styles.pickerTitle, { color: colors.brandPrimary, fontSize: 15 }]}>{picked.length ? `Klaar (${picked.length})` : "Sluiten"}</Text>
            </Pressable>
          </View>
          <ProductBrowser
            bottomPadding={16}
            pickedIds={picked}
            onPick={(p) => {
              setPicked((x) => (x.includes(p.id) ? x : [...x, p.id]));
              onPick(p);
            }}
          />
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  pantryRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 12, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  recipeText: { fontSize: 12, fontFamily: fonts.regular, color: colors.muted, marginTop: -6 },
  linkedRow: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surface, borderRadius: 12, padding: 8, borderWidth: 1, borderColor: colors.border },
  linkedImg: { width: 40, height: 40, borderRadius: 8, backgroundColor: "#fff" },
  linkedName: { fontSize: 14, fontFamily: fonts.semibold, color: colors.onSurface },
  linkedMeta: { fontSize: 12, fontFamily: fonts.regular, color: colors.muted, marginTop: 1 },
  swapBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: colors.brandTertiary },
  swapText: { fontSize: 13, fontFamily: fonts.semibold, color: colors.brandPrimary },
  linkBtn: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingVertical: 4 },
  hint: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.surface, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderColor: colors.success },
  hintText: { flex: 1, fontSize: 12, fontFamily: fonts.medium, color: colors.onSurface },
  altRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.divider },
  altImg: { width: 44, height: 44, borderRadius: 8, backgroundColor: "#fff" },
  altHead: { fontSize: 13, fontFamily: fonts.bold, color: colors.onSurfaceSecondary, marginTop: 6 },
  altGood: { fontSize: 11, fontFamily: fonts.semibold, color: colors.success },
  altOffer: { fontSize: 11, fontFamily: fonts.semibold, color: colors.warning },
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
  alsoOwn: { flexDirection: "row", alignItems: "center", gap: 8, paddingBottom: 10 },
  alsoOwnText: { fontSize: 14, fontFamily: fonts.medium, color: colors.onSurface },
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
  pickerBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center" },
  pickerSheet: { backgroundColor: colors.surface, borderRadius: 20, width: "92%", maxWidth: 560, alignSelf: "center", marginVertical: "auto", maxHeight: "92%", padding: 16, gap: 12 },
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
  bigCard: { gap: 10, padding: 12, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary },
  bigImg: { width: 96, height: 96, borderRadius: 12, backgroundColor: colors.surface },
  bigName: { fontSize: 16, fontFamily: fonts.bold, color: colors.onSurface },
  bigPrice: { fontSize: 16, fontFamily: fonts.bold, color: colors.brandPrimary },
  chooseHint: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  chooseHintText: { flex: 1, fontSize: 12, fontFamily: fonts.medium, color: colors.brandPrimary },
}));
