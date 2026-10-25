import { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";

import { EmptyState, Icon } from "@/src/components/ui";
import { OnlineRecipes } from "@/src/OnlineRecipes";
import { api } from "@/src/api";
import { CATEGORY_ICONS, CATEGORY_LABELS, MEAL_CATEGORIES, MealCategory } from "@/src/constants";
import { usesNativeTabs } from "@/src/navigation";
import { useAppSettings } from "@/src/settings";
import { fonts, makeStyles, useTheme } from "@/src/theme";

export type Dish = {
  id: string;
  name: string;
  category: MealCategory;
  is_standard: boolean;
  ingredients: { name: string; unit: string; qty_adult: number; qty_child: number; aisle: string; price?: number; product_id?: string | null }[];
};

const TABS = [
  { key: "own", label: "Eigen gerechten" },
  { key: "online", label: "Online gerechten" },
] as const;

export default function DishesScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const s = useAppSettings();
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;

  const [search, setSearch] = useState("");
  const [cat, setCat] = useState<MealCategory | "all">("all");
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("own");

  const { data, isLoading } = useQuery({
    queryKey: ["dishes"],
    queryFn: () => api<{ dishes: Dish[] }>("/dishes"),
  });

  const filtered = useMemo(() => {
    let list = data?.dishes ?? [];
    if (cat !== "all") list = list.filter((d) => d.category === cat);
    if (search.trim()) list = list.filter((d) => d.name.toLowerCase().includes(search.trim().toLowerCase()));
    return list;
  }, [data, cat, search]);

  const chips: ({ key: MealCategory | "all"; label: string })[] = [
    { key: "all", label: "Alle" },
    ...MEAL_CATEGORIES.map((c) => ({ key: c, label: CATEGORY_LABELS[c] })),
  ];

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>{s.tab_dishes}</Text>
        <Text style={styles.subtitle}>{s.sub_dishes}</Text>
        <View style={styles.segment}>
          {TABS.map((t) => (
            <Pressable
              key={t.key}
              testID={`tab-${t.key}`}
              onPress={() => setTab(t.key)}
              style={[styles.segBtn, tab === t.key && styles.segBtnActive]}
            >
              <Text style={[styles.segText, tab === t.key && styles.segTextActive]}>{t.label}</Text>
            </Pressable>
          ))}
        </View>

        {tab === "own" ? (
          <>
        <View style={styles.searchBox}>
          <Icon name="magnify" size={20} color={colors.muted} />
          <TextInput
            testID="dish-search"
            placeholder="Zoek gerecht"
            placeholderTextColor={colors.muted}
            value={search}
            onChangeText={setSearch}
            style={styles.searchInput}
          />
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
          style={styles.chipScroll}
        >
          {chips.map((c) => {
            const active = cat === c.key;
            return (
              <Pressable
                key={c.key}
                testID={`cat-chip-${c.key}`}
                onPress={() => setCat(c.key)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{c.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
          </>
        ) : null}
      </View>

      {tab === "online" ? (
        <OnlineRecipes bottomPadding={bottomChrome + 24} />
      ) : isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.brandPrimary} />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(d) => d.id}
          contentContainerStyle={{ padding: 16, paddingTop: 8, paddingBottom: bottomChrome + 96, gap: 10 }}
          renderItem={({ item }) => (
            <Pressable
              testID={`dish-row-${item.id}`}
              onPress={() => router.push({ pathname: "/dish/edit", params: { id: item.id } })}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.9 }]}
            >
              <View style={styles.rowIcon}>
                <Icon name={CATEGORY_ICONS[item.category] as any} size={20} color={colors.brandPrimary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.rowSub}>
                  {CATEGORY_LABELS[item.category]} · {item.ingredients.length} producten
                </Text>
              </View>
              {!item.is_standard ? (
                <View style={styles.ownBadge}>
                  <Text style={styles.ownBadgeText}>Eigen</Text>
                </View>
              ) : null}
              <Icon name="chevron-right" size={22} color={colors.muted} />
            </Pressable>
          )}
          ListEmptyComponent={
            <EmptyState
              icon="silverware-variant"
              title={data?.dishes.length ? "Geen gerechten gevonden" : "Nog geen eigen gerechten"}
              subtitle={data?.dishes.length ? "Pas je filters aan of voeg een nieuw gerecht toe." : "Maak een gerecht met de knop hieronder, of neem er een over uit Online gerechten."}
            />
          }
        />
      )}

      {tab === "own" ? (
      <Pressable
        testID="new-dish-fab"
        onPress={() => router.push("/dish/edit")}
        style={({ pressed }) => [styles.fab, { bottom: bottomChrome + 16 }, pressed && { opacity: 0.9 }]}
      >
        <Icon name="plus" size={22} color={colors.onBrandPrimary} />
        <Text style={styles.fabText}>Gerecht</Text>
      </Pressable>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: 16, paddingTop: 8, gap: 12 },
  title: { fontSize: 32, fontFamily: fonts.bold, color: colors.onSurface },
  subtitle: { fontSize: 15, fontFamily: fonts.regular, color: colors.muted, marginTop: 2, marginBottom: 2 },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: { flex: 1, paddingVertical: 12, fontSize: 15, fontFamily: fonts.regular, color: colors.onSurface },
  segment: { flexDirection: "row", backgroundColor: colors.surfaceTertiary, borderRadius: 10, padding: 3 },
  segBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center" },
  segBtnActive: { backgroundColor: colors.surface },
  segText: { fontSize: 13, fontFamily: fonts.medium, color: colors.muted },
  segTextActive: { color: colors.onSurface, fontFamily: fonts.semibold },
  chipScroll: { marginHorizontal: -16, height: 44 },
  chipRow: { gap: 8, paddingHorizontal: 16, alignItems: "center" },
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
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
  },
  rowIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  rowTitle: { fontSize: 16, fontFamily: fonts.semibold, color: colors.onSurface },
  rowSub: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted, marginTop: 2 },
  ownBadge: { backgroundColor: colors.brandSecondary, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  ownBadgeText: { fontSize: 11, fontFamily: fonts.semibold, color: colors.onBrandSecondary },
  fab: {
    position: "absolute",
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 999,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  fabText: { color: colors.onBrandPrimary, fontSize: 15, fontFamily: fonts.semibold },
}));
