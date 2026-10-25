import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Modal, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button, EmptyState, Icon, Select, Stepper } from "@/src/components/ui";
import { api } from "@/src/api";
import { useTerms } from "@/src/settings";
import { fetchProducts, useDebounced } from "@/src/search";
import { CATEGORY_ICONS, CATEGORY_LABELS, MEAL_CATEGORIES, MealCategory, formatQty } from "@/src/constants";
import type { Dish } from "@/app/(tabs)/dishes";
import type { Product } from "@/app/(tabs)/products";
import { useAuth } from "@/src/auth";
import { goBack } from "@/src/nav";
import { useToast } from "@/src/toast";
import { fonts, makeStyles, useTheme } from "@/src/theme";

type Extra = { name: string; unit: string; qty: number; aisle: string; store?: string | null; product_id?: string | null };
type Day = {
  index: number;
  adults: number;
  children: number;
  is_shopping_day: boolean;
  meals: Record<MealCategory, string[]>;
  extras?: Extra[];
};
type Camp = {
  id: string;
  name: string;
  days: Day[];
  owner_id: string;
  member_ids: string[];
  vega_adults?: number;
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
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [budgetInput, setBudgetInput] = useState("");

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

  const { data: camp, isLoading } = useQuery({
    queryKey: ["camp", id],
    queryFn: () => api<Camp>(`/camps/${id}`),
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
      return { ...d, meals: { ...d.meals, [category]: next } };
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
      const days = camp.days.map((d) => (d.index === selected ? { ...d, extras: [...(d.extras ?? []), ex] } : d));
      applyDays(days);
    }
    setExtraTarget(null);
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
                {d.is_shopping_day ? (
                  <View style={[styles.pillDot, { backgroundColor: active ? colors.onBrandPrimary : colors.brandSecondary }]} />
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32, gap: 14 }}>
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

        {selected === -1 ? (
          <View style={styles.card}>
            <View style={styles.mealHeader}>
              <View style={styles.rowLabel}>
                <View style={styles.mealIcon}>
                  <Icon name="clipboard-list-outline" size={18} color={colors.brandPrimary} />
                </View>
                <Text style={styles.mealTitle}>Algemene boodschappen</Text>
              </View>
              <Pressable testID="add-general-extra" onPress={() => setExtraTarget("general")} style={styles.addBtn}>
                <Icon name="plus" size={16} color={colors.onBrandTertiary} />
                <Text style={styles.addBtnText}>Product</Text>
              </Pressable>
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
                <Pressable
                  testID={`add-dish-${cat}`}
                  onPress={() => setPickerCat(cat)}
                  style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.85 }]}
                >
                  <Icon name="plus" size={16} color={colors.onBrandTertiary} />
                  <Text style={styles.addBtnText}>Gerecht</Text>
                </Pressable>
              </View>

              {ids.length === 0 ? (
                <Text style={styles.noMeal}>Nog geen gerecht gekozen</Text>
              ) : (
                <View style={{ gap: 8, marginTop: 10 }}>
                  {ids.map((dishId) => {
                    const dish = dishesById[dishId];
                    return (
                      <View key={dishId} style={styles.dishRow}>
                        <Text style={styles.dishName} numberOfLines={1}>
                          {dish?.name ?? "Onbekend gerecht"}
                        </Text>
                        <Pressable
                          testID={`remove-dish-${cat}-${dishId}`}
                          hitSlop={8}
                          onPress={() => toggleDish(cat, dishId)}
                        >
                          <Icon name="close-circle" size={20} color={colors.muted} />
                        </Pressable>
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
          {(day.extras ?? []).length === 0 ? (
            <Text style={styles.noMeal}>Nog geen losse producten voor deze dag</Text>
          ) : (
            <View style={{ gap: 8, marginTop: 10 }}>
              {(day.extras ?? []).map((ex, i) => (
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
        onClose={() => setExtraTarget(null)}
        onAdd={addExtra}
      />

      <Modal visible={budgetOpen} transparent animationType="slide" onRequestClose={() => setBudgetOpen(false)}>
        <View style={[styles.modalBackdrop, { justifyContent: "flex-end" }]}>
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
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Product | null>(null);
  const [qty, setQty] = useState(1);
  const [store, setStore] = useState(defaultStore ?? stores[0] ?? "Overig");

  const debouncedQ = useDebounced(q);
  const { data } = useQuery({
    queryKey: ["products", "search", "picker", debouncedQ.trim()],
    queryFn: () => fetchProducts({ q: debouncedQ, limit: 60 }),
    enabled: visible,
    placeholderData: (prev) => prev,
  });

  useEffect(() => {
    if (visible) {
      setSel(null);
      setQty(1);
    }
  }, [visible]);

  useEffect(() => {
    setStore((prev) => prev || defaultStore || stores[0] || "Overig");
  }, [defaultStore, stores]);

  const list = data?.products ?? [];

  const confirm = () => {
    if (!sel) return;
    onAdd({ name: sel.name, unit: sel.unit, qty, aisle: sel.aisle, store, product_id: sel.id });
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={[styles.modalBackdrop, { justifyContent: "flex-end" }]}>
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
            <View style={{ gap: 12 }}>
              <View style={styles.pickerSearch}>
                <Icon name="magnify" size={20} color={colors.muted} />
                <TextInput
                  testID="extra-product-search"
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
                style={{ maxHeight: 340 }}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => (
                  <Pressable testID={`extra-product-${item.id}`} onPress={() => setSel(item)} style={styles.pickerRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.selName} numberOfLines={1}>{item.name}</Text>
                      <Text style={styles.selMeta}>{item.aisle} · per {item.unit}</Text>
                    </View>
                    <Text style={styles.pickerPrice}>{item.price > 0 ? `€ ${item.price.toFixed(2)}` : "—"}</Text>
                    <Icon name="plus-circle-outline" size={22} color={colors.brandPrimary} />
                  </Pressable>
                )}
                ListEmptyComponent={<Text style={styles.noMeal}>Geen product gevonden.</Text>}
              />
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

  useEffect(() => {
    if (visible) {
      setName(camp.name);
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
      return api(`/camps/${camp.id}`, { method: "PUT", body: { name: name.trim() || camp.name, days, vega_adults: vegaA, vega_children: vegaC } });
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
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
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
            <Text style={styles.editLabel}>Vega-eters (volwassenen)</Text>
            <Text style={styles.editWarn2}>Hiervoor komt de vega-optie op de lijst.</Text>
          </View>
          <Stepper value={vegaA} onChange={setVegaA} min={0} max={500} testID="edit-vega-adults" />
        </View>
        <View style={[styles.editRow, { marginTop: 12 }]}>
          <Text style={styles.editLabel}>Vega-eters (kinderen)</Text>
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
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
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
  const T = useTerms();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState("");
  const list = (category ? dishes.filter((d) => d.category === category) : []).filter(
    (d) => !q.trim() || d.name.toLowerCase().includes(q.trim().toLowerCase()),
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.sheetHandle} />
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{category ? CATEGORY_LABELS[category] : ""} kiezen</Text>
          <Pressable testID="picker-close" onPress={onClose} hitSlop={8}>
            <Icon name="close" size={22} color={colors.onSurface} />
          </Pressable>
        </View>
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
        <FlatList
          data={list}
          keyExtractor={(d) => d.id}
          style={{ maxHeight: 420 }}
          contentContainerStyle={{ paddingBottom: 8, gap: 8 }}
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
                  <Text style={styles.pickerSub}>{item.ingredients.length} producten</Text>
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
            <EmptyState icon="silverware-variant" title="Geen gerechten" subtitle="Voeg een nieuw gerecht toe voor deze categorie." />
          }
        />
        <Pressable testID="picker-create" onPress={onCreate} style={styles.createRow}>
          <Icon name="plus-circle-outline" size={20} color={colors.brandPrimary} />
          <Text style={styles.createText}>Nieuw gerecht toevoegen</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
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
  modalBackdrop: { flex: 1, backgroundColor: "rgba(28,27,26,0.45)" },
  budgetBar: { backgroundColor: colors.brandTertiary, borderRadius: 16, padding: 14, gap: 8 },
  budgetTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  budgetUsed: { fontSize: 18, fontFamily: fonts.bold, color: colors.onBrandTertiary },
  budgetRemain: { fontSize: 14, fontFamily: fonts.semibold, color: colors.brandPrimary },
  budgetTrack: { height: 8, borderRadius: 999, backgroundColor: colors.surface, overflow: "hidden" },
  budgetFill: { height: 8, borderRadius: 999 },
  budgetSub: { fontSize: 12, fontFamily: fonts.regular, color: colors.onBrandTertiary },
  budgetSetBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12, borderRadius: 14, borderWidth: 1, borderStyle: "dashed", borderColor: colors.brandPrimary },
  budgetSetText: { fontSize: 14, fontFamily: fonts.semibold, color: colors.brandPrimary },
  budgetField: { backgroundColor: colors.surfaceTertiary, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, fontFamily: fonts.regular, color: colors.onSurface, borderWidth: 1, borderColor: colors.border },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 16,
  },
  sheetHandle: {
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
