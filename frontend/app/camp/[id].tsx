import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, Switch, Text, TextInput, View } from "react-native";
import Modal from "@/src/components/Modal";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button, EmptyState, Icon, Select, Stepper } from "@/src/components/ui";
import { api } from "@/src/api";
import { cachedApi } from "@/src/offline";
import { useTerms } from "@/src/settings";
import { fetchProducts, useDebounced } from "@/src/search";
import { ProductBrowser } from "@/src/ProductBrowser";
import { OnlineRecipes, type RecipeTile } from "@/src/OnlineRecipes";
import { CATEGORY_ICONS, CATEGORY_LABELS, MEAL_CATEGORIES, MealCategory, formatQty } from "@/src/constants";
import { isOwnDish, type Dish } from "@/app/(tabs)/dishes";
import type { Package } from "@/app/package/edit";
import type { Product } from "@/app/(tabs)/products";
import { useAuth } from "@/src/auth";
import { dietConflicts, useDiet } from "@/src/diet";
import { GOLD, usePremium } from "@/src/premium";
import { goBack } from "@/src/nav";
import { VegaPicker } from "@/src/VegaPicker";
import { MenuWizard } from "@/src/MenuWizard";
import { DateField } from "@/src/DateField";
import { useToast } from "@/src/toast";
import { fonts, makeStyles, useTheme } from "@/src/theme";

type Extra = { name: string; unit: string; qty: number; aisle: string; store?: string | null; product_id?: string | null; meal?: MealCategory | null };
type Day = {
  index: number;
  adults: number;
  children: number;
  is_shopping_day: boolean;
  meals: Record<MealCategory, string[]>;
  extras?: Extra[];
  leftovers?: Partial<Record<MealCategory, number>>; // restje van deze dag (één keer koken voor twee dagen)
  meal_names?: Partial<Record<MealCategory, string>>;
};
type Camp = {
  id: string;
  name: string;
  days: Day[];
  owner_id: string;
  member_ids: string[];
  vega_adults?: number;
  start_date?: string | null;
  vega_children?: number;
  general?: Extra[];
  budget_target?: number;
};

export default function CampDetailScreen() {
  const styles = useStyles();
  const T = useTerms();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, has } = useAuth();

  const [selected, setSelected] = useState(0);
  const [pickerCat, setPickerCat] = useState<MealCategory | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [extraTarget, setExtraTarget] = useState<"day" | "general" | null>(null);
  const [extraMeal, setExtraMeal] = useState<MealCategory | null>(null); // los product bij een maaltijd (bijv. ontbijt)
  const [packOpen, setPackOpen] = useState(false);
  const [vegaDish, setVegaDish] = useState<Dish | null>(null);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [budgetInput, setBudgetInput] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const premium = usePremium();
  const { selected: diet } = useDiet();

  const canViewBudget = has("view_budget");
  const canManageBudget = has("manage_budget");

  const { data: storesData } = useQuery({
    queryKey: ["stores"],
    queryFn: () => api<{ stores: string[] }>("/stores"),
  });
  const stores = storesData?.stores ?? [];

  const { data: budget } = useQuery({
    queryKey: ["budget", id],
    queryFn: () => api<{ total_cost: number; budget_target: number; remaining: number; over_budget: boolean; pct_used: number }>(`/camps/${id}/budget`),
    enabled: canViewBudget,
  });

  const { data: camp, isLoading, refetch: refetchCamp, isRefetching } = useQuery({
    queryKey: ["camp", id],
    queryFn: () => cachedApi<Camp>(`/camps/${id}`),
  });

  const { data: dishesData } = useQuery({
    queryKey: ["dishes"],
    queryFn: () => api<{ dishes: Dish[] }>("/dishes"),
  });
  const dishesById = useMemo(() => {
    const m: Record<string, Dish> = {};
    (dishesData?.dishes ?? []).forEach((d) => (m[d.id] = d));
    return m;
  }, [dishesData]);

  const update = useMutation({
    mutationFn: (days: Day[]) => api(`/camps/${id}`, { method: "PUT", body: { days } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["camps"] });
      qc.invalidateQueries({ queryKey: ["shopping", id] });
    },
    onError: (e: any) => toast.show(e?.message ?? "Opslaan mislukt", "error"),
  });

  const applyDays = (days: Day[]) => {
    qc.setQueryData<Camp>(["camp", id], (old) => (old ? { ...old, days } : old));
    update.mutate(days);
  };

  const patchDay = (patch: Partial<Day>) => {
    if (!camp) return;
    const days = camp.days.map((d) => (d.index === selected ? { ...d, ...patch } : d));
    applyDays(days);
  };

  const toggleDish = (category: MealCategory, dishId: string) => {
    if (!camp) return;
    const days = camp.days.map((d) => {
      if (d.index !== selected) return d;
      const current = d.meals[category] ?? [];
      const next = current.includes(dishId) ? current.filter((x) => x !== dishId) : [...current, dishId];
      // Zelf aangepast: dan is het geen restje meer
      const { [category]: _drop, ...leftovers } = d.leftovers ?? {};
      return { ...d, meals: { ...d.meals, [category]: next }, leftovers };
    });
    applyDays(days);
  };

  const patchCamp = useMutation({
    mutationFn: (body: any) => api(`/camps/${id}`, { method: "PUT", body }),
    onSuccess: (updated: any) => {
      qc.setQueryData(["camp", id], updated);
      qc.invalidateQueries({ queryKey: ["shopping", id] });
      qc.invalidateQueries({ queryKey: ["budget", id] });
    },
    onError: (e: any) => toast.show(e?.message ?? "Opslaan mislukt", "error"),
  });

  const saveBudget = useMutation({
    mutationFn: () => api(`/camps/${id}`, { method: "PUT", body: { budget_target: parseFloat(budgetInput.replace(",", ".")) || 0 } }),
    onSuccess: (updated: any) => {
      qc.setQueryData(["camp", id], updated);
      qc.invalidateQueries({ queryKey: ["budget", id] });
      setBudgetOpen(false);
      toast.show("Budget opgeslagen", "success");
    },
    onError: (e: any) => toast.show(e?.message ?? "Mislukt", "error"),
  });

  const openBudget = () => {
    setBudgetInput(budget?.budget_target ? String(budget.budget_target) : "");
    setBudgetOpen(true);
  };

  const addExtra = (ex: Extra) => {
    if (!camp) return;
    if (extraTarget === "general") {
      patchCamp.mutate({ general: [...(camp.general ?? []), ex] });
    } else {
      const item = extraMeal ? { ...ex, meal: extraMeal } : ex;
      const days = camp.days.map((d) => (d.index === selected ? { ...d, extras: [...(d.extras ?? []), item] } : d));
      applyDays(days);
    }
    setExtraTarget(null);
    setExtraMeal(null);
  };

  // Een pakket in één keer bij de algemene boodschappen; wat er al staat wordt opgeteld
  const addPackage = (p: Package) => {
    if (!camp) return;
    const general = [...(camp.general ?? [])];
    for (const it of p.items) {
      const k = general.findIndex((g) => (it.product_id ? g.product_id === it.product_id : g.name.toLowerCase() === it.name.toLowerCase() && g.unit === it.unit));
      if (k >= 0) general[k] = { ...general[k], qty: general[k].qty + it.qty };
      else general.push({ name: it.name, unit: it.unit, qty: it.qty, aisle: it.aisle, product_id: it.product_id ?? undefined, store: it.store ?? undefined } as Extra);
    }
    patchCamp.mutate({ general });
    setPackOpen(false);
    toast.show(`${p.name} toegevoegd`, "success");
  };

  const removeExtra = (where: "day" | "general", idx: number) => {
    if (!camp) return;
    if (where === "general") {
      patchCamp.mutate({ general: (camp.general ?? []).filter((_, i) => i !== idx) });
    } else {
      const days = camp.days.map((d) => (d.index === selected ? { ...d, extras: (d.extras ?? []).filter((_, i) => i !== idx) } : d));
      applyDays(days);
    }
  };

  if (isLoading || !camp) {
    return (
      <View style={[styles.root, styles.center, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={colors.brandPrimary} />
      </View>
    );
  }

  const day = camp.days.find((d) => d.index === selected) ?? camp.days[0];
  const maxPerDay = Math.max(0, ...camp.days.map((d) => (d.adults || 0) + (d.children || 0)));
  const vegaA = camp.vega_adults ?? 0;
  const vegaC = camp.vega_children ?? 0;
  // Gerechten met vlees of vis waar de vega-eters nog niets voor hebben
  const vegaTodo = (d: Day) =>
    vegaA + vegaC > 0 ? MEAL_CATEGORIES.flatMap((c) => (d.meals[c] ?? []).map((x) => dishesById[x]).filter((x) => x?.needs_vega)) : [];
  const vegaOpen = [...new Map(camp.days.flatMap((d) => vegaTodo(d)).map((x) => [x.id, x])).values()];

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable testID="back-button" onPress={() => goBack("/camps")} hitSlop={10} style={styles.headerBtn}>
          <Icon name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <Pressable testID="edit-camp-button" onPress={() => setEditOpen(true)} style={styles.titlePress} hitSlop={6}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {camp.name}
          </Text>
          <Icon name="pencil" size={15} color={colors.muted} />
        </Pressable>
        <View style={styles.headerActions}>
          {has("view_budget") ? (
            <Pressable
              testID="budget-button"
              onPress={() => router.push(`/budget/${id}`)}
              hitSlop={10}
              style={styles.headerBtn}
            >
              <Icon name="cash-multiple" size={22} color={colors.brandPrimary} />
            </Pressable>
          ) : null}
          <Pressable
            testID="members-button"
            onPress={() => setMembersOpen(true)}
            hitSlop={10}
            style={styles.headerBtn}
          >
            <Icon name="account-multiple-outline" size={23} color={colors.brandPrimary} />
          </Pressable>
          <Pressable
            testID="open-shopping-button"
            onPress={() => router.push(`/shopping/${id}`)}
            hitSlop={10}
            style={styles.headerBtn}
          >
            <Icon name="cart-outline" size={24} color={colors.brandPrimary} />
          </Pressable>
        </View>
      </View>

      {/* Day pills */}
      <View style={styles.pillsWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillRow}>
          <Pressable
            testID="day-pill-general"
            onPress={() => setSelected(-1)}
            style={[styles.pill, selected === -1 && styles.pillActive]}
          >
            <Icon name="clipboard-list-outline" size={14} color={selected === -1 ? colors.onBrandPrimary : colors.brandSecondary} />
            <Text style={[styles.pillText, selected === -1 && styles.pillTextActive]}>Algemeen</Text>
          </Pressable>
          {camp.days.map((d) => {
            const active = d.index === selected;
            return (
              <Pressable
                key={d.index}
                testID={`day-pill-${d.index}`}
                onPress={() => setSelected(d.index)}
                style={[styles.pill, active && styles.pillActive]}
              >
                <Text style={[styles.pillText, active && styles.pillTextActive]}>Dag {d.index + 1}</Text>
                {vegaTodo(d).length ? <Icon name="leaf-off" size={13} color={active ? colors.onBrandPrimary : colors.warning} /> : null}
                {d.is_shopping_day ? (
                  <View style={[styles.pillDot, { backgroundColor: active ? colors.onBrandPrimary : colors.brandSecondary }]} />
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => { refetchCamp(); qc.invalidateQueries({ queryKey: ["dishes"] }); qc.invalidateQueries({ queryKey: ["budget", id] }); }} tintColor={colors.brandPrimary} />}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32, gap: 14 }}
      >
        <Pressable testID="auto-menu-button" onPress={() => (premium ? setMenuOpen(true) : router.push("/premium"))} style={styles.autoMenuBtn}>
          <Icon name="calendar-star" size={18} color={GOLD.icon} />
          <Text style={styles.autoMenuText}>Menu automatisch invullen</Text>
          <Icon name={premium ? "chevron-right" : "star"} size={18} color={GOLD.icon} />
        </Pressable>
        {canViewBudget && budget ? (
          budget.budget_target > 0 ? (
            <Pressable
              testID="camp-budget-bar"
              onPress={canManageBudget ? openBudget : () => router.push(`/budget/${id}`)}
              style={styles.budgetBar}
            >
              <View style={styles.budgetTop}>
                <Text style={styles.budgetUsed}>€ {formatQty(budget.total_cost)}</Text>
                <Text style={[styles.budgetRemain, budget.over_budget && { color: colors.error }]}>
                  {budget.over_budget ? `€ ${formatQty(Math.abs(budget.remaining))} over` : `nog € ${formatQty(budget.remaining)}`}
                </Text>
              </View>
              <View style={styles.budgetTrack}>
                <View style={[styles.budgetFill, { width: `${Math.min(budget.pct_used, 100)}%`, backgroundColor: budget.over_budget ? colors.error : colors.brandPrimary }]} />
              </View>
              <Text style={styles.budgetSub}>Budget € {formatQty(budget.budget_target)} · {canManageBudget ? "tik om aan te passen" : "tik voor details"}</Text>
            </Pressable>
          ) : canManageBudget ? (
            <Pressable testID="camp-budget-set" onPress={openBudget} style={styles.budgetSetBtn}>
              <Icon name="wallet-plus-outline" size={18} color={colors.brandPrimary} />
              <Text style={styles.budgetSetText}>{`Budget instellen`}</Text>
            </Pressable>
          ) : null
        ) : null}

        {vegaOpen.length ? (
          <View testID="vega-todo" style={styles.vegaBanner}>
            <View style={styles.rowLabel}>
              <Icon name="leaf" size={18} color={colors.warning} />
              <Text style={styles.vegaTitle}>
                {vegaOpen.length === 1 ? "1 gerecht heeft nog geen vega-optie" : `${vegaOpen.length} gerechten hebben nog geen vega-optie`}
              </Text>
            </View>
            <Text style={styles.vegaSub}>Er {vegaA + vegaC === 1 ? "eet 1 persoon" : `eten ${vegaA + vegaC} personen`} vega mee. Kies een vervanger voor het vlees of de vis:</Text>
            <View style={styles.vegaChips}>
              {vegaOpen.map((x) => (
                <Pressable key={x.id} onPress={() => setVegaDish(x)} style={styles.vegaChip}>
                  <Text style={styles.vegaChipText} numberOfLines={1}>{x.name}</Text>
                  <Icon name="chevron-right" size={16} color={colors.warning} />
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {selected === -1 ? (
          <View style={styles.card}>
            <View style={styles.mealHeader}>
              <View style={styles.rowLabel}>
                <View style={styles.mealIcon}>
                  <Icon name="clipboard-list-outline" size={18} color={colors.brandPrimary} />
                </View>
                <Text style={styles.mealTitle}>Algemene boodschappen</Text>
              </View>
              <View style={{ flexDirection: "row", gap: 6 }}>
                <Pressable testID="add-general-package" onPress={() => setPackOpen(true)} style={styles.addBtn}>
                  <Icon name="package-variant-closed" size={16} color={colors.onBrandTertiary} />
                  <Text style={styles.addBtnText}>Pakket</Text>
                </Pressable>
                <Pressable testID="add-general-extra" onPress={() => setExtraTarget("general")} style={styles.addBtn}>
                  <Icon name="plus" size={16} color={colors.onBrandTertiary} />
                  <Text style={styles.addBtnText}>Product</Text>
                </Pressable>
              </View>
            </View>
            <Text style={styles.counterSub}>{`Losse spullen voor ${T.de} hele ${T.one} (komt op de lijst bij dag 1).`}</Text>
            {(camp.general ?? []).length === 0 ? (
              <Text style={styles.noMeal}>Nog geen losse producten</Text>
            ) : (
              <View style={{ gap: 8, marginTop: 10 }}>
                {(camp.general ?? []).map((ex, i) => (
                  <View key={`${ex.name}-${i}`} style={styles.dishRow}>
                    <Text style={styles.dishName} numberOfLines={1}>
                      {formatQty(ex.qty)} {ex.unit} · {ex.name}
                      {ex.store ? ` (${ex.store})` : ""}
                    </Text>
                    <Pressable testID={`remove-general-${i}`} hitSlop={8} onPress={() => removeExtra("general", i)}>
                      <Icon name="close-circle" size={20} color={colors.muted} />
                    </Pressable>
                  </View>
                ))}
              </View>
            )}
          </View>
        ) : (
        <>
        {/* Headcount */}
        <View style={styles.card}>
          <View style={styles.counterRow}>
            <View style={styles.rowLabel}>
              <Icon name="account-group" size={20} color={colors.brandPrimary} />
              <Text style={styles.counterLabel}>Volwassenen</Text>
            </View>
            <Stepper value={day.adults} onChange={(v) => patchDay({ adults: v })} min={0} max={500} testID="day-adults" />
          </View>
          <View style={styles.cardDivider} />
          <View style={styles.counterRow}>
            <View style={styles.rowLabel}>
              <Icon name="account-child" size={20} color={colors.brandPrimary} />
              <Text style={styles.counterLabel}>Kinderen</Text>
            </View>
            <Stepper value={day.children} onChange={(v) => patchDay({ children: v })} min={0} max={500} testID="day-children" />
          </View>
          <View style={styles.cardDivider} />
          <View style={styles.counterRow}>
            <View style={styles.rowLabel}>
              <Icon name="cart-check" size={20} color={colors.brandPrimary} />
              <View>
                <Text style={styles.counterLabel}>Boodschappen deze dag</Text>
                <Text style={styles.counterSub}>Meenemen in de lijst</Text>
              </View>
            </View>
            <Switch
              testID="day-shopping-toggle"
              value={day.is_shopping_day}
              onValueChange={(v) => patchDay({ is_shopping_day: v })}
              trackColor={{ true: colors.brandPrimary, false: colors.borderStrong }}
              thumbColor={colors.surface}
            />
          </View>
          <View style={styles.cardDivider} />
          <Text style={styles.counterSub}>
            {day.adults + day.children} personen vandaag · max {maxPerDay} per dag in {T.deze} {T.one}
            {vegaA + vegaC > 0 ? ` · ${vegaA + vegaC} vega-eter(s)` : ""}
          </Text>
        </View>

        {/* Meals */}
        {MEAL_CATEGORIES.map((cat) => {
          const ids = day.meals[cat] ?? [];
          return (
            <View key={cat} style={styles.card}>
              <View style={styles.mealHeader}>
                <View style={styles.rowLabel}>
                  <View style={styles.mealIcon}>
                    <Icon name={CATEGORY_ICONS[cat] as any} size={18} color={colors.brandPrimary} />
                  </View>
                  <Text style={styles.mealTitle}>{CATEGORY_LABELS[cat]}</Text>
                </View>
                <View style={{ flexDirection: "row", gap: 6 }}>
                <Pressable
                  testID={`add-dish-${cat}`}
                  onPress={() => setPickerCat(cat)}
                  style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.85 }]}
                >
                  <Icon name="plus" size={16} color={colors.onBrandTertiary} />
                  <Text style={styles.addBtnText}>Gerecht</Text>
                </Pressable>
                <Pressable
                  testID={`add-extra-${cat}`}
                  onPress={() => {
                    setExtraMeal(cat);
                    setExtraTarget("day");
                  }}
                  style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.85 }]}
                >
                  <Icon name="plus" size={16} color={colors.onBrandTertiary} />
                  <Text style={styles.addBtnText}>Product</Text>
                </Pressable>
                </View>
              </View>

              {(day.extras ?? []).some((ex) => ex.meal === cat) ? (
                <View style={{ gap: 8, marginTop: 10 }}>
                  {day.meal_names?.[cat] ? (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Icon name="bread-slice-outline" size={16} color={colors.brandPrimary} />
                      <Text style={[styles.dishName, { flex: 1 }]} numberOfLines={1}>{day.meal_names[cat]}</Text>
                    </View>
                  ) : null}
                  {(day.extras ?? []).map((ex, i) =>
                    ex.meal === cat ? (
                      <View key={`${ex.name}-${i}`} style={styles.dishRow}>
                        <Icon name="basket-outline" size={15} color={colors.muted} />
                        <Text style={[styles.dishName, { flex: 1 }]} numberOfLines={1}>
                          {formatQty(ex.qty)} {ex.unit} · {ex.name}
                          {ex.store ? ` (${ex.store})` : ""}
                        </Text>
                        <Pressable testID={`remove-meal-extra-${cat}-${i}`} hitSlop={8} onPress={() => removeExtra("day", i)}>
                          <Icon name="close-circle" size={20} color={colors.muted} />
                        </Pressable>
                      </View>
                    ) : null,
                  )}
                </View>
              ) : null}

              {ids.length === 0 ? (
                (day.extras ?? []).some((ex) => ex.meal === cat) ? null : <Text style={styles.noMeal}>Nog geen gerecht of product gekozen</Text>
              ) : (
                <View style={{ gap: 8, marginTop: 10 }}>
                  {ids.map((dishId) => {
                    const dish = dishesById[dishId];
                    // Restje: zelfde gerecht als een eerdere dag. Of: wordt morgen als restje gegeten
                    const from = day.leftovers?.[cat];
                    const isLeft = from != null && (camp.days.find((x) => x.index === from)?.meals[cat] ?? []).includes(dishId);
                    const next = camp.days.find((x) => x.leftovers?.[cat] === day.index && (x.meals[cat] ?? []).includes(dishId));
                    return (
                      <View key={dishId} style={{ gap: 4 }}>
                      <View style={styles.dishRow}>
                        <Pressable
                          disabled={!dish}
                          onPress={() => router.push({ pathname: "/dish/edit", params: { id: dishId, campId: camp.id } })}
                          style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 6 }}
                        >
                          {dish?.online ? <Icon name="web" size={15} color={colors.muted} /> : null}
                          <Text style={[styles.dishName, { flex: 1 }]} numberOfLines={1}>
                            {dish?.name ?? "Onbekend gerecht"}
                          </Text>
                        </Pressable>
                        {dish?.needs_vega && vegaA + vegaC > 0 ? (
                          <Pressable testID={`vega-${dishId}`} onPress={() => setVegaDish(dish)} style={styles.vegaBadge}>
                            <Icon name="leaf" size={13} color={colors.onWarning} />
                            <Text style={styles.vegaBadgeText}>Vega-optie kiezen</Text>
                          </Pressable>
                        ) : null}
                        <Pressable
                          testID={`remove-dish-${cat}-${dishId}`}
                          hitSlop={8}
                          onPress={() => toggleDish(cat, dishId)}
                        >
                          <Icon name="close-circle" size={20} color={colors.muted} />
                        </Pressable>
                      </View>
                      {isLeft ? (
                        <View style={styles.leftBadge}>
                          <Icon name="recycle" size={14} color={colors.onBrandTertiary} />
                          <Text style={styles.leftText}>Restje van dag {from! + 1}: al gekookt, niets extra kopen</Text>
                        </View>
                      ) : next ? (
                        <View style={styles.leftBadge}>
                          <Icon name="pot-steam-outline" size={14} color={colors.onBrandTertiary} />
                          <Text style={styles.leftText}>Kook dubbel: dag {next.index + 1} eet je de rest{next.index - day.index >= 3 ? " (vries het tussendoor in)" : ""}. Je koopt het één keer in.</Text>
                        </View>
                      ) : null}
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          );
        })}

        <View style={styles.card}>
          <View style={styles.mealHeader}>
            <View style={styles.rowLabel}>
              <View style={styles.mealIcon}>
                <Icon name="basket-outline" size={18} color={colors.brandPrimary} />
              </View>
              <Text style={styles.mealTitle}>Losse producten</Text>
            </View>
            <Pressable testID="add-day-extra" onPress={() => setExtraTarget("day")} style={styles.addBtn}>
              <Icon name="plus" size={16} color={colors.onBrandTertiary} />
              <Text style={styles.addBtnText}>Product</Text>
            </Pressable>
          </View>
          {!(day.extras ?? []).some((ex) => !ex.meal) ? (
            <Text style={styles.noMeal}>Nog geen losse producten voor deze dag</Text>
          ) : (
            <View style={{ gap: 8, marginTop: 10 }}>
              {(day.extras ?? []).map((ex, i) => ex.meal ? null : (
                <View key={`${ex.name}-${i}`} style={styles.dishRow}>
                  <Text style={styles.dishName} numberOfLines={1}>
                    {formatQty(ex.qty)} {ex.unit} · {ex.name}
                    {ex.store ? ` (${ex.store})` : ""}
                  </Text>
                  <Pressable testID={`remove-day-extra-${i}`} hitSlop={8} onPress={() => removeExtra("day", i)}>
                    <Icon name="close-circle" size={20} color={colors.muted} />
                  </Pressable>
                </View>
              ))}
            </View>
          )}
        </View>
        </>
        )}
      </ScrollView>

      <VegaPicker dish={vegaDish} onClose={() => setVegaDish(null)} />
      <PackagePickerModal visible={packOpen} onClose={() => setPackOpen(false)} onPick={addPackage} />

      {/* Dish picker */}
      <DishPickerModal
        visible={pickerCat !== null}
        category={pickerCat}
        dishes={dishesData?.dishes ?? []}
        selectedIds={pickerCat ? day.meals[pickerCat] ?? [] : []}
        onToggle={(dishId) => pickerCat && toggleDish(pickerCat, dishId)}
        onClose={() => setPickerCat(null)}
        onCreate={() => {
          const cat = pickerCat;
          setPickerCat(null);
          router.push({ pathname: "/dish/edit", params: { category: cat ?? "avondeten" } });
        }}
      />

      <MembersModal
        visible={membersOpen}
        campId={id!}
        isOwner={camp.owner_id === user?.id}
        onClose={() => setMembersOpen(false)}
      />

      <EditCampModal
        visible={editOpen}
        camp={camp}
        onClose={() => setEditOpen(false)}
        onSaved={(newCount) => {
          if (selected >= newCount) setSelected(Math.max(0, newCount - 1));
        }}
      />

      <ExtraAddModal
        visible={extraTarget !== null}
        stores={stores}
        defaultStore={user?.store}
        onClose={() => {
          setExtraTarget(null);
          setExtraMeal(null);
        }}
        onAdd={addExtra}
      />

      <MenuWizard
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        campId={id}
        days={camp?.days ?? []}
        startDate={camp?.start_date}
        dishes={dishesData?.dishes ?? []}
        diet={diet}
      />

      <Modal visible={budgetOpen} transparent animationType="fade" onRequestClose={() => setBudgetOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{`Budget`}</Text>
              <Pressable testID="budget-modal-close" onPress={() => setBudgetOpen(false)} hitSlop={8}>
                <Icon name="close" size={22} color={colors.onSurface} />
              </Pressable>
            </View>
            <Text style={styles.editLabel}>Totaal budget (€)</Text>
            <TextInput
              testID="camp-budget-input"
              value={budgetInput}
              onChangeText={setBudgetInput}
              keyboardType="decimal-pad"
              placeholder="Bijv. 250"
              placeholderTextColor={colors.muted}
              style={styles.budgetField}
            />
            <Button label="Opslaan" onPress={() => saveBudget.mutate()} loading={saveBudget.isPending} testID="camp-budget-save" />
          </View>
        </View>
      </Modal>
    </View>
  );
}

function ExtraAddModal({
  visible,
  stores,
  defaultStore,
  onClose,
  onAdd,
}: {
  visible: boolean;
  stores: string[];
  defaultStore?: string;
  onClose: () => void;
  onAdd: (ex: Extra) => void;
}) {
  const styles = useStyles();
  const T = useTerms();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [sel, setSel] = useState<Product | null>(null);
  const [qty, setQty] = useState(1);
  const [store, setStore] = useState(defaultStore ?? stores[0] ?? "Overig");

  useEffect(() => {
    if (visible) {
      setSel(null);
      setQty(1);
    }
  }, [visible]);

  useEffect(() => {
    setStore((prev) => prev || defaultStore || stores[0] || "Overig");
  }, [defaultStore, stores]);

  const confirm = () => {
    if (!sel) return;
    onAdd({ name: sel.name, unit: sel.unit, qty, aisle: sel.aisle, store, product_id: sel.id });
  };

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{sel ? "Aantal & winkel" : "Kies een product"}</Text>
            <Pressable testID="extra-close" onPress={onClose} hitSlop={8}>
              <Icon name="close" size={22} color={colors.onSurface} />
            </Pressable>
          </View>

          {sel ? (
            <View style={{ gap: 14 }}>
              <View style={styles.selProduct}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.selName} numberOfLines={1}>{sel.name}</Text>
                  <Text style={styles.selMeta}>{sel.aisle} · per {sel.unit}</Text>
                </View>
                <Pressable testID="extra-change-product" onPress={() => setSel(null)} hitSlop={8}>
                  <Text style={styles.changeLink}>Wijzig</Text>
                </Pressable>
              </View>
              <View style={styles.editRow}>
                <Text style={styles.editLabel}>Aantal</Text>
                <Stepper value={qty} onChange={setQty} min={1} max={999} testID="extra-qty" />
              </View>
              {stores.length > 0 ? (
                <View style={{ gap: 6 }}>
                  <Text style={styles.editLabel}>Winkel</Text>
                  <Select testID="extra-store" value={store} options={stores} icon="storefront-outline" onChange={setStore} />
                </View>
              ) : null}
              <Button label="Toevoegen" onPress={confirm} testID="extra-add-button" />
            </View>
          ) : (
            <View style={{ height: 560, marginHorizontal: -16 }}>
              <ProductBrowser onPick={setSel} bottomPadding={16} />
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

function EditCampModal({
  visible,
  camp,
  onClose,
  onSaved,
}: {
  visible: boolean;
  camp: Camp;
  onClose: () => void;
  onSaved: (newCount: number) => void;
}) {
  const styles = useStyles();
  const T = useTerms();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(camp.name);
  const [count, setCount] = useState(camp.days.length);
  const [vegaA, setVegaA] = useState(camp.vega_adults ?? 0);
  const [vegaC, setVegaC] = useState(camp.vega_children ?? 0);
  const [startDate, setStartDate] = useState(camp.start_date ?? "");

  useEffect(() => {
    if (visible) {
      setName(camp.name);
      setStartDate(camp.start_date ?? "");
      setCount(camp.days.length);
      setVegaA(camp.vega_adults ?? 0);
      setVegaC(camp.vega_children ?? 0);
    }
  }, [visible, camp]);

  const save = useMutation({
    mutationFn: () => {
      const emptyMeals = Object.fromEntries(MEAL_CATEGORIES.map((c) => [c, []]));
      const last = camp.days[camp.days.length - 1];
      let days = camp.days.slice(0, count);
      while (days.length < count) {
        days = [
          ...days,
          {
            index: days.length,
            adults: last?.adults ?? 0,
            children: last?.children ?? 0,
            is_shopping_day: true,
            meals: emptyMeals as any,
          },
        ];
      }
      return api(`/camps/${camp.id}`, { method: "PUT", body: { name: name.trim() || camp.name, days, vega_adults: vegaA, vega_children: vegaC, start_date: startDate } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["camp", camp.id] });
      qc.invalidateQueries({ queryKey: ["camps"] });
      qc.invalidateQueries({ queryKey: ["shopping", camp.id] });
      toast.show(`${T.One} bijgewerkt`, "success");
      onSaved(count);
      onClose();
    },
    onError: (e: any) => toast.show(e?.message ?? "Opslaan mislukt", "error"),
  });

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.sheetHandle} />
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{`${T.One} aanpassen`}</Text>
          <Pressable testID="edit-camp-close" onPress={onClose} hitSlop={8}>
            <Icon name="close" size={22} color={colors.onSurface} />
          </Pressable>
        </View>

        <View style={{ gap: 8, marginBottom: 14 }}>
          <Text style={styles.editLabel}>Naam</Text>
          <TextInput
            testID="edit-camp-name"
            value={name}
            onChangeText={setName}
            placeholder={`Naam van ${T.de} ${T.one}`}
            placeholderTextColor={colors.muted}
            style={styles.memberInput}
          />
        </View>

        <View style={{ gap: 8, marginBottom: 14 }}>
          <Text style={styles.editLabel}>Eerste dag</Text>
          <DateField value={startDate} onChange={setStartDate} testID="edit-camp-date" />
        </View>

        <View style={styles.editRow}>
          <View>
            <Text style={styles.editLabel}>Aantal dagen</Text>
            {count < camp.days.length ? (
              <Text style={styles.editWarn}>Dagen {count + 1}–{camp.days.length} worden verwijderd</Text>
            ) : null}
          </View>
          <Stepper value={count} onChange={setCount} min={1} max={60} testID="edit-camp-days" />
        </View>

        <View style={[styles.editRow, { marginTop: 14 }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.editLabel}>Vegetarisch: volwassenen</Text>
            <Text style={styles.editWarn2}>Hoeveel eten er vegetarisch? Zij krijgen de vega-optie.</Text>
          </View>
          <Stepper value={vegaA} onChange={setVegaA} min={0} max={500} testID="edit-vega-adults" />
        </View>
        <View style={[styles.editRow, { marginTop: 12 }]}>
          <Text style={styles.editLabel}>Vegetarisch: kinderen</Text>
          <Stepper value={vegaC} onChange={setVegaC} min={0} max={500} testID="edit-vega-children" />
        </View>

        <View style={{ marginTop: 18 }}>
          <Button label="Opslaan" onPress={() => save.mutate()} loading={save.isPending} testID="edit-camp-save" />
        </View>
      </View>
    </Modal>
  );
}

function MembersModal({
  visible,
  campId,
  isOwner,
  onClose,
}: {
  visible: boolean;
  campId: string;
  isOwner: boolean;
  onClose: () => void;
}) {
  const styles = useStyles();
  const T = useTerms();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const toast = useToast();
  const [email, setEmail] = useState("");

  type Member = { id: string; name: string; email: string; is_owner: boolean };
  const { data } = useQuery({
    queryKey: ["camp-members", campId],
    queryFn: () => api<{ members: Member[] }>(`/camps/${campId}/members`),
    enabled: visible,
  });

  const add = useMutation({
    mutationFn: () => api(`/camps/${campId}/members`, { method: "POST", body: { email: email.trim() } }),
    onSuccess: () => {
      setEmail("");
      qc.invalidateQueries({ queryKey: ["camp-members", campId] });
      toast.show("Leider toegevoegd", "success");
    },
    onError: (e: any) => toast.show(e?.message ?? "Toevoegen mislukt", "error"),
  });

  const remove = useMutation({
    mutationFn: (memberId: string) => api(`/camps/${campId}/members/${memberId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["camp-members", campId] });
      toast.show("Leider verwijderd", "success");
    },
    onError: (e: any) => toast.show(e?.message ?? "Verwijderen mislukt", "error"),
  });

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.sheetHandle} />
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>Samen plannen</Text>
          <Pressable testID="members-close" onPress={onClose} hitSlop={8}>
            <Icon name="close" size={22} color={colors.onSurface} />
          </Pressable>
        </View>

        {isOwner ? (
          <View style={styles.addMemberRow}>
            <TextInput
              testID="member-email-input"
              placeholder="E-mail van leider"
              placeholderTextColor={colors.muted}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              style={styles.memberInput}
            />
            <Pressable
              testID="member-add-button"
              onPress={() => email.trim() && add.mutate()}
              style={styles.memberAddBtn}
            >
              <Icon name="plus" size={22} color={colors.onBrandPrimary} />
            </Pressable>
          </View>
        ) : (
          <Text style={styles.memberHint}>Alleen de eigenaar kan leiders toevoegen of verwijderen.</Text>
        )}

        <View style={{ gap: 8, marginTop: 12 }}>
          {(data?.members ?? []).map((m) => (
            <View key={m.id} style={styles.memberRow}>
              <View style={styles.memberAvatar}>
                <Text style={styles.memberAvatarText}>{(m.name ?? m.email ?? "?").charAt(0).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.memberName} numberOfLines={1}>
                  {m.name}
                </Text>
                <Text style={styles.memberEmail} numberOfLines={1}>
                  {m.email}
                </Text>
              </View>
              {m.is_owner ? (
                <View style={styles.ownerBadge}>
                  <Text style={styles.ownerBadgeText}>Eigenaar</Text>
                </View>
              ) : isOwner ? (
                <Pressable testID={`member-remove-${m.id}`} hitSlop={8} onPress={() => remove.mutate(m.id)}>
                  <Icon name="close-circle" size={22} color={colors.muted} />
                </Pressable>
              ) : null}
            </View>
          ))}
        </View>
      </View>
    </Modal>
  );
}

function PackagePickerModal({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (p: Package) => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { data, isLoading } = useQuery({ queryKey: ["packages"], queryFn: () => api<{ packages: Package[] }>("/packages"), enabled: visible });
  const list = data?.packages ?? [];
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.sheetHandle} />
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>Pakket toevoegen</Text>
          <Pressable onPress={onClose} hitSlop={8}>
            <Icon name="close" size={22} color={colors.onSurface} />
          </Pressable>
        </View>
        {isLoading ? <Text style={styles.noMeal}>Laden…</Text> : null}
        {!isLoading && !list.length ? <Text style={styles.noMeal}>Je hebt nog geen pakketten.</Text> : null}
        <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: 8 }}>
          {list.map((p) => (
            <Pressable key={p.id} testID={`package-${p.id}`} onPress={() => onPick(p)} style={styles.pickerRow}>
              <Icon name="package-variant-closed" size={22} color={colors.brandPrimary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.pickerName}>{p.name}</Text>
                <Text style={styles.pickerSub} numberOfLines={1}>
                  {p.items.length} producten{p.items.length ? ` · ${p.items.slice(0, 3).map((i) => i.name).join(", ")}` : ""}
                </Text>
              </View>
              <Icon name="plus-circle-outline" size={22} color={colors.brandPrimary} />
            </Pressable>
          ))}
        </ScrollView>
        <Pressable
          onPress={() => {
            onClose();
            router.push("/package/edit");
          }}
          style={styles.createRow}
        >
          <Icon name="plus-circle-outline" size={20} color={colors.brandPrimary} />
          <Text style={styles.createText}>Nieuw pakket maken</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

// Kies uit je eigen gerechten (eerst die van deze maaltijd) of uit de online recepten van AH, Jumbo en Dirk
const COURSE_FOR: Record<MealCategory, string[]> = {
  ontbijt: ["ontbijt"],
  lunch: ["lunch"],
  avondeten: ["hoofdgerecht"],
  snacks: ["borrel", "dessert"],
};

function DishPickerModal({
  visible,
  category,
  dishes,
  selectedIds,
  onToggle,
  onClose,
  onCreate,
}: {
  visible: boolean;
  category: MealCategory | null;
  dishes: Dish[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  onClose: () => void;
  onCreate: () => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"own" | "online">("own");
  const [allCats, setAllCats] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  useEffect(() => {
    if (visible) {
      setQ("");
      setAllCats(false);
      setTab(category && !dishes.some((d) => isOwnDish(d, user?.id) && d.category === category) ? "online" : "own");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, category]);

  const { user } = useAuth();
  const mine = dishes.filter((d) => isOwnDish(d, user?.id));
  const own = category && !allCats ? mine.filter((d) => d.category === category) : mine;
  const list = own.filter((d) => !q.trim() || d.name.toLowerCase().includes(q.trim().toLowerCase()));
  const pickedRecipes = dishes
    .filter((d) => selectedIds.includes(d.id) && d.source?.recipe_id)
    .map((d) => d.source!.recipe_id.replace(":", "-"));

  const pickOnline = async (r: RecipeTile) => {
    if (!category || busyId) return;
    const existing = dishes.find((d) => d.source?.recipe_id?.replace(":", "-") === r.id);
    if (existing) return onToggle(existing.id);
    setBusyId(r.id);
    try {
      const dish = await api<Dish>("/recipes/import", { method: "POST", body: { id: r.id, category, reuse: true } });
      await qc.invalidateQueries({ queryKey: ["dishes"] });
      onToggle(dish.id);
      toast.show(`${r.title} toegevoegd`, "success");
    } catch (e: any) {
      toast.show(e?.message ?? "Toevoegen mislukt", "error");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose} />
      <View style={[styles.sheet, { height: "92%", paddingHorizontal: 0, paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.sheetHandle} />
        <View style={[styles.sheetHeader, { paddingHorizontal: 16 }]}>
          <Text style={styles.sheetTitle}>{category ? CATEGORY_LABELS[category] : ""} kiezen</Text>
          <Pressable testID="picker-close" onPress={onClose} hitSlop={8}>
            <Icon name="close" size={22} color={colors.onSurface} />
          </Pressable>
        </View>
        <View style={[styles.pickTabs, { marginHorizontal: 16 }]}>
          {(["own", "online"] as const).map((t) => (
            <Pressable key={t} testID={`picker-tab-${t}`} onPress={() => setTab(t)} style={[styles.pickTab, tab === t && styles.pickTabActive]}>
              <Text style={[styles.pickTabText, tab === t && styles.pickTabTextActive]}>{t === "own" ? "Eigen gerechten" : "Online gerechten"}</Text>
            </Pressable>
          ))}
        </View>
        {tab === "online" ? (
          <View style={{ flex: 1 }}>
            <OnlineRecipes
              key={category ?? "x"}
              bottomPadding={16}
              initialFilters={category ? { gang: COURSE_FOR[category] } : undefined}
              onPick={pickOnline}
              pickedIds={pickedRecipes}
              busyId={busyId}
            />
          </View>
        ) : (
          <View style={{ flex: 1, paddingHorizontal: 16, gap: 10 }}>
            <View style={styles.pickerSearch}>
              <Icon name="magnify" size={18} color={colors.muted} />
              <TextInput
                testID="picker-search"
                placeholder="Zoek gerecht"
                placeholderTextColor={colors.muted}
                value={q}
                onChangeText={setQ}
                style={styles.pickerSearchInput}
              />
            </View>
            {category ? (
              <Pressable testID="picker-all-cats" onPress={() => setAllCats((v) => !v)} style={styles.createRow}>
                <Icon name={allCats ? "checkbox-marked-outline" : "checkbox-blank-outline"} size={20} color={colors.brandPrimary} />
                <Text style={styles.createText}>Ook gerechten van andere maaltijden tonen</Text>
              </Pressable>
            ) : null}
            <FlatList
              data={list}
              keyExtractor={(d) => d.id}
              style={{ flex: 1 }}
              contentContainerStyle={{ paddingBottom: 8, gap: 8 }}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const checked = selectedIds.includes(item.id);
                return (
                  <Pressable
                    testID={`picker-dish-${item.id}`}
                    onPress={() => onToggle(item.id)}
                    style={[styles.pickerRow, checked && styles.pickerRowChecked]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.pickerName}>{item.name}</Text>
                      <Text style={styles.pickerSub}>
                        {item.ingredients.length} producten
                        {allCats && item.category !== category ? ` · ${CATEGORY_LABELS[item.category as MealCategory] ?? item.category}` : ""}
                      </Text>
                    </View>
                    <Icon
                      name={checked ? "check-circle" : "circle-outline"}
                      size={24}
                      color={checked ? colors.brandPrimary : colors.borderStrong}
                    />
                  </Pressable>
                );
              }}
              ListEmptyComponent={
                <EmptyState
                  icon="silverware-variant"
                  title="Geen gerechten"
                  subtitle="Kijk bij Online gerechten, of maak een nieuw gerecht voor deze maaltijd."
                />
              }
            />
            <Pressable testID="picker-create" onPress={onCreate} style={styles.createRow}>
              <Icon name="plus-circle-outline" size={20} color={colors.brandPrimary} />
              <Text style={styles.createText}>Nieuw gerecht toevoegen</Text>
            </Pressable>
          </View>
        )}
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  leftBadge: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", backgroundColor: colors.brandTertiary, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  leftText: { fontSize: 12, fontFamily: fonts.medium, color: colors.onBrandTertiary },
  vegaBanner: { borderRadius: 16, borderWidth: 1, borderColor: colors.warning, backgroundColor: colors.surface, padding: 14, gap: 8 },
  vegaTitle: { fontSize: 15, fontFamily: fonts.bold, color: colors.warning, flexShrink: 1 },
  vegaSub: { fontSize: 13, fontFamily: fonts.regular, color: colors.onSurfaceSecondary },
  vegaChips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  vegaChip: { flexDirection: "row", alignItems: "center", gap: 4, maxWidth: "100%", paddingVertical: 7, paddingLeft: 12, paddingRight: 8, borderRadius: 999, borderWidth: 1, borderColor: colors.warning },
  vegaChipText: { fontSize: 13, fontFamily: fonts.semibold, color: colors.warning, flexShrink: 1 },
  vegaBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.warning, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 8 },
  vegaBadgeText: { fontSize: 11, fontFamily: fonts.semibold, color: colors.onWarning },
  pickTabs: { flexDirection: "row", backgroundColor: colors.surfaceTertiary, borderRadius: 10, padding: 3, marginBottom: 6 },
  pickTab: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center" },
  pickTabActive: { backgroundColor: colors.surface },
  pickTabText: { fontSize: 13, fontFamily: fonts.medium, color: colors.muted },
  pickTabTextActive: { color: colors.onSurface, fontFamily: fonts.semibold },
  root: { flex: 1, backgroundColor: colors.surface },
  center: { alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingBottom: 10,
  },
  headerBtn: { width: 44, height: 40, alignItems: "center", justifyContent: "center" },
  headerActions: { flexDirection: "row", alignItems: "center" },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 18, fontFamily: fonts.bold, color: colors.onSurface },
  titlePress: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  pillsWrap: { borderBottomWidth: 1, borderBottomColor: colors.divider, height: 56, justifyContent: "center" },
  pillRow: { gap: 8, paddingHorizontal: 16, alignItems: "center" },
  pill: {
    height: 36,
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: colors.surfaceTertiary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pillActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  pillText: { fontSize: 14, fontFamily: fonts.medium, color: colors.onSurfaceTertiary },
  pillTextActive: { color: colors.onBrandPrimary },
  pillDot: { width: 6, height: 6, borderRadius: 3 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  counterRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 4 },
  rowLabel: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  counterLabel: { fontSize: 15, fontFamily: fonts.semibold, color: colors.onSurface },
  counterSub: { fontSize: 12, fontFamily: fonts.regular, color: colors.muted },
  cardDivider: { height: 1, backgroundColor: colors.divider, marginVertical: 8 },
  mealHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  mealIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  mealTitle: { fontSize: 16, fontFamily: fonts.bold, color: colors.onSurface },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.brandTertiary,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
  },
  addBtnText: { fontSize: 13, fontFamily: fonts.semibold, color: colors.onBrandTertiary },
  noMeal: { fontSize: 14, fontFamily: fonts.regular, color: colors.muted, marginTop: 10 },
  dishRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  dishName: { flex: 1, fontSize: 15, fontFamily: fonts.medium, color: colors.onSurface, marginRight: 10 },
  modalBackdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(28,27,26,0.45)", justifyContent: "center" },
  budgetBar: { backgroundColor: colors.brandTertiary, borderRadius: 16, padding: 14, gap: 8 },
  budgetTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  budgetUsed: { fontSize: 18, fontFamily: fonts.bold, color: colors.onBrandTertiary },
  budgetRemain: { fontSize: 14, fontFamily: fonts.semibold, color: colors.brandPrimary },
  budgetTrack: { height: 8, borderRadius: 999, backgroundColor: colors.surface, overflow: "hidden" },
  budgetFill: { height: 8, borderRadius: 999 },
  budgetSub: { fontSize: 12, fontFamily: fonts.regular, color: colors.onBrandTertiary },
  autoMenuBtn: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: GOLD.border, backgroundColor: GOLD.bg },
  autoMenuText: { flex: 1, fontSize: 14, fontFamily: fonts.semibold, color: GOLD.text },
  budgetSetBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12, borderRadius: 14, borderWidth: 1, borderStyle: "dashed", borderColor: colors.brandPrimary },
  budgetSetText: { fontSize: 14, fontFamily: fonts.semibold, color: colors.brandPrimary },
  budgetField: { backgroundColor: colors.surfaceTertiary, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, fontFamily: fonts.regular, color: colors.onSurface, borderWidth: 1, borderColor: colors.border },
  sheet: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    width: "92%",
    maxWidth: 560,
    alignSelf: "center",
    marginVertical: "auto",
    maxHeight: "92%",
    padding: 16,
  },
  sheetHandle: {
    display: "none",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
    alignSelf: "center",
    marginBottom: 12,
  },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  sheetTitle: { fontSize: 18, fontFamily: fonts.bold, color: colors.onSurface },
  pickerSearch: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: 12,
    paddingHorizontal: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pickerSearchInput: { flex: 1, paddingVertical: 11, fontSize: 15, fontFamily: fonts.regular, color: colors.onSurface },
  pickerPrice: { fontSize: 14, fontFamily: fonts.semibold, color: colors.brandPrimary, marginRight: 10 },
  selProduct: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surfaceTertiary, borderRadius: 12, padding: 12 },
  selName: { fontSize: 15, fontFamily: fonts.semibold, color: colors.onSurface },
  selMeta: { fontSize: 12, fontFamily: fonts.regular, color: colors.muted, marginTop: 2 },
  changeLink: { fontSize: 13, fontFamily: fonts.semibold, color: colors.brandPrimary },
  newProductBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.brandPrimary, borderStyle: "dashed" },
  newProductText: { fontSize: 14, fontFamily: fonts.semibold, color: colors.brandPrimary },
  pickerRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pickerRowChecked: { borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary },
  pickerName: { fontSize: 15, fontFamily: fonts.semibold, color: colors.onSurface },
  pickerSub: { fontSize: 12, fontFamily: fonts.regular, color: colors.muted, marginTop: 2 },
  createRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    marginTop: 4,
  },
  createText: { fontSize: 15, fontFamily: fonts.semibold, color: colors.brandPrimary },
  addMemberRow: { flexDirection: "row", gap: 10, alignItems: "center" },
  memberInput: {
    flex: 1,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    fontFamily: fonts.regular,
    color: colors.onSurface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  memberAddBtn: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  memberHint: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  memberAvatar: {
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  memberAvatarText: { fontSize: 17, fontFamily: fonts.bold, color: colors.onBrandPrimary },
  memberName: { fontSize: 15, fontFamily: fonts.semibold, color: colors.onSurface },
  memberEmail: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted, marginTop: 1 },
  ownerBadge: { backgroundColor: colors.brandSecondary, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  ownerBadgeText: { fontSize: 11, fontFamily: fonts.semibold, color: colors.onBrandSecondary },
  editLabel: { fontSize: 13, fontFamily: fonts.semibold, color: colors.onSurfaceSecondary },
  editRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  editWarn: { fontSize: 12, fontFamily: fonts.regular, color: colors.warning, marginTop: 2, maxWidth: 200 },
  editWarn2: { fontSize: 12, fontFamily: fonts.regular, color: colors.muted, marginTop: 2, maxWidth: 220 },
}));
