import { useEffect, useMemo, useState } from "react";
import { Animated, FlatList, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import Image from "@/src/components/SafeImage";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";

import Reanimated, { FadeInDown } from "react-native-reanimated";
import { PressScale, SkeletonList } from "@/src/components/motion";
import { EmptyState, Icon } from "@/src/components/ui";
import type { Package } from "@/app/package/edit";
import { OnlineRecipes } from "@/src/OnlineRecipes";
import { useHideOnScroll } from "@/src/hideOnScroll";
import { smartFilter } from "@/src/smartSearch";
import { api } from "@/src/api";
import { dietConflicts, useDiet } from "@/src/diet";
import { useAuth } from "@/src/auth";
import { CATEGORY_ICONS, CATEGORY_LABELS, DISH_GROUPS, DishGroup, MealCategory } from "@/src/constants";
import { GroupTiles } from "@/src/GroupTiles";
import { usesNativeTabs } from "@/src/navigation";
import { useAppSettings } from "@/src/settings";
import { fonts, makeStyles, softShadow, useTheme } from "@/src/theme";

export type Dish = {
  id: string;
  name: string;
  category: MealCategory;
  groups?: DishGroup[]; // hoofdcategorieën, zoals "Soep" of "Voor grote groepen"
  groups_set?: boolean; // zelf gekozen; anders kiest de app
  is_standard: boolean;
  ingredients: { name: string; unit: string; qty_adult: number; qty_child: number; aisle: string; price?: number; product_id?: string | null; store?: string | null; recipe_text?: string | null }[];
  pantry?: Dish["ingredients"];
  image?: string | null;
  price_pp?: Record<string, number> | null;
  source?: { recipe_id: string; url?: string; image?: string; store?: string; servings?: number } | null;
  needs_vega?: boolean; // vlees of vis zonder vega-vervanger
  online?: boolean; // online gerecht dat in een kamp staat, nog niet aangepast
  camp_id?: string | null; // alleen voor één activiteit aangepast
  owner_id?: string | null;
};

// Hoort in "Eigen gerechten": standaard of van jou, en niet alleen voor een activiteit of als online gerecht
export const isOwnDish = (d: Dish, me?: string) => !d.online && !d.camp_id && (d.is_standard || !d.owner_id || d.owner_id === me);

const TABS = [
  { key: "app", label: "App" },
  { key: "online", label: "Online" },
  { key: "own", label: "Eigen" },
  { key: "packages", label: "Pakketten" },
] as const;

const PACKAGES_INTRO =
  "Vaste spullen die je elke keer nodig hebt, zoals een afwasborstel of vuilniszakken. Zet een pakket in één keer bij de algemene boodschappen van een activiteit.";

const nDishes = (n: number) => `${n} ${n === 1 ? "gerecht" : "gerechten"}`;

// Een passend plaatje bij een pakket, op naam
function packageIcon(name: string) {
  const n = name.toLowerCase();
  if (/afwas/.test(n)) return "dishwasher";
  if (/schoonma|poets/.test(n)) return "spray-bottle";
  if (/keuken/.test(n)) return "chef-hat";
  if (/voorraad/.test(n)) return "archive-outline";
  if (/ontbijt|lunch|brood/.test(n)) return "baguette";
  if (/toilet|verzorg|hygi/.test(n)) return "toilet";
  if (/wegwerp|groep|feest/.test(n)) return "party-popper";
  if (/ehbo|pleister|medic/.test(n)) return "medical-bag";
  return "package-variant-closed";
}

export default function DishesScreen() {
  const { user } = useAuth();
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const s = useAppSettings();
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;

  const [search, setSearch] = useState("");
  const [group, setGroup] = useState<DishGroup | "all">("all");
  // Bladeren zoals bij Producten: eerst de hoofdcategorieën als blokken, dan de gerechten. Zoeken toont meteen de lijst.
  const [allDishes, setAllDishes] = useState(false);
  const { selected: diet } = useDiet();
  const [fitsOnly, setFitsOnly] = useState(false);
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>(
    params.tab === "online" || params.tab === "packages" || params.tab === "own" ? params.tab : "app",
  );
  useEffect(() => {
    if (params.tab === "online" || params.tab === "own" || params.tab === "packages" || params.tab === "app") setTab(params.tab);
  }, [params.tab]);
  const packages = useQuery({
    queryKey: ["packages"],
    queryFn: () => api<{ packages: Package[] }>("/packages"),
    enabled: tab === "packages",
  });

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["dishes"],
    queryFn: () => api<{ dishes: Dish[] }>("/dishes"),
  });

  const base = useMemo(() => {
    // App-gerechten (standaard voor iedereen) of je eigen gerechten; online gerechten en kampversies horen hier niet
    let list = (data?.dishes ?? []).filter((d) => isOwnDish(d, user?.id) && (tab === "app" ? d.is_standard : !d.is_standard));
    if (search.trim()) list = smartFilter(list, search, (d) => [d.name, d.name, ...(d.ingredients ?? []).map((i) => i.name)]);
    if (fitsOnly && diet.length) list = list.filter((d) => !dietConflicts(d.ingredients, diet).length);
    return list;
  }, [data, search, fitsOnly, diet, tab, user?.id]);
  const filtered = useMemo(() => (group === "all" ? base : base.filter((d) => d.groups?.includes(group))), [base, group]);
  const inGroup = (g: DishGroup) => base.filter((d) => d.groups?.includes(g));
  const browsing = !search.trim();
  const showTiles = browsing && group === "all" && !allDishes && base.length > 0;
  const groupLabel = DISH_GROUPS.find((g) => g.key === group)?.label;
  const dishTiles = [
    { key: "all", label: tab === "app" ? "Alle app-gerechten" : "Alle eigen gerechten", icon: "view-grid-outline", sub: nDishes(base.length) },
    ...DISH_GROUPS.map((g) => ({ ...g, list: inGroup(g.key) }))
      .filter((g) => g.list.length)
      .map((g) => ({ key: g.key, label: g.label, icon: g.icon, sub: nDishes(g.list.length), image: g.list.find((d) => d.image)?.image })),
  ];

  const chips: ({ key: DishGroup | "all"; label: string })[] = [
    { key: "all", label: "Alle" },
    ...DISH_GROUPS.filter((g) => inGroup(g.key).length).map((g) => ({ key: g.key, label: g.label })),
  ];

  const hide = useHideOnScroll();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    hide.reset();
    setGroup("all");
    setAllDishes(false);
  }, [tab]);
  const listProps = {
    ...hide.scrollProps,
    refreshControl: (
      <RefreshControl
        refreshing={isRefetching || packages.isRefetching}
        onRefresh={() => (tab === "packages" ? packages.refetch() : refetch())}
        tintColor={colors.brandPrimary}
      />
    ),
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={{ flex: 1 }}>
      <Animated.View {...hide.blockProps} style={[styles.header, { backgroundColor: colors.surface, paddingBottom: 2 }, hide.blockProps.style]}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{s.tab_dishes}</Text>
            <Text style={styles.subtitle}>{s.sub_dishes}</Text>
          </View>
          <Pressable testID="diet-button" onPress={() => router.push("/account/diet")} hitSlop={8} style={styles.headBtn}>
            <Icon name="tune-variant" size={22} color={colors.brandPrimary} />
            <Text style={styles.headBtnText}>Voorkeuren</Text>
          </Pressable>
        </View>
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

        {tab === "own" || tab === "app" ? (
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

        {diet.length ? (
          <Pressable testID="diet-chip" onPress={() => setFitsOnly((v) => !v)} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Icon name={fitsOnly ? "checkbox-marked" : "checkbox-blank-outline"} size={20} color={fitsOnly ? colors.brandPrimary : colors.muted} />
            <Text style={styles.rowSub}>Alleen gerechten die passen bij mijn voorkeuren</Text>
          </Pressable>
        ) : null}
        {browsing ? (
          <View style={styles.crumbs}>
            <Pressable testID="crumb-all" onPress={() => { setGroup("all"); setAllDishes(false); }} hitSlop={6}>
              <Text style={[styles.crumb, showTiles && styles.crumbActive]}>Alle soorten</Text>
            </Pressable>
            {!showTiles && base.length ? (
              <>
                <Icon name="chevron-right" size={16} color={colors.muted} />
                <Text style={[styles.crumb, styles.crumbActive, { flexShrink: 1 }]} numberOfLines={1}>{groupLabel ?? "Alles"}</Text>
              </>
            ) : null}
          </View>
        ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
          style={styles.chipScroll}
        >
          {chips.map((c) => {
            const active = group === c.key;
            return (
              <Pressable
                key={c.key}
                testID={`cat-chip-${c.key}`}
                onPress={() => setGroup(c.key)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{c.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        )}
          </>
        ) : null}
      </Animated.View>

      {tab === "online" ? (
        <OnlineRecipes bottomPadding={bottomChrome + 24} outer={hide} />
      ) : tab === "packages" ? (
        packages.isLoading ? (
          <View style={{ paddingTop: hide.padTop }}>
            <SkeletonList rows={5} />
          </View>
        ) : (packages.data?.packages ?? []).length ? (
          <GroupTiles
            listProps={listProps}
            testPrefix="package-row"
            padTop={hide.padTop}
            bottomPadding={bottomChrome + 96}
            header={<Text style={[styles.rowSub, { marginBottom: 4 }]}>{PACKAGES_INTRO}</Text>}
            tiles={(packages.data?.packages ?? []).map((p) => ({
              key: p.id,
              label: p.name,
              icon: packageIcon(p.name),
              sub: `${p.items.length} ${p.items.length === 1 ? "product" : "producten"}`,
            }))}
            onPress={(id) => router.push({ pathname: "/package/edit", params: { id } })}
          />
        ) : (
          <View style={{ padding: 16, paddingTop: 8 + hide.padTop, gap: 10 }}>
            <Text style={styles.rowSub}>{PACKAGES_INTRO}</Text>
            <EmptyState icon="package-variant" title="Nog geen pakketten" subtitle="Maak een pakket met de knop hieronder, bijvoorbeeld 'Schoonmaak'." />
          </View>
        )
      ) : isLoading ? (
        <View style={{ paddingTop: hide.padTop }}>
          <SkeletonList rows={6} />
        </View>
      ) : showTiles ? (
        <GroupTiles
          listProps={listProps}
          testPrefix="dish-group"
          padTop={hide.padTop}
          bottomPadding={bottomChrome + 96}
          tiles={dishTiles}
          onPress={(k) => (k === "all" ? setAllDishes(true) : setGroup(k as DishGroup))}
        />
      ) : (
        <FlatList
          {...listProps}
          data={filtered}
          keyExtractor={(d) => d.id}
          contentContainerStyle={{ padding: 16, paddingTop: 8 + hide.padTop, paddingBottom: bottomChrome + 96, gap: 10 }}
          renderItem={({ item, index }) => {
            const warn = dietConflicts(item.ingredients, diet);
            return (
            <Reanimated.View entering={index < 8 ? FadeInDown.delay(index * 35).duration(240) : undefined}>
            <PressScale
              testID={`dish-row-${item.id}`}
              onPress={() => router.push({ pathname: "/dish/edit", params: { id: item.id } })}
              style={styles.row}
            >
              {item.image ? (
                <Image source={{ uri: item.image }} style={[styles.rowIcon, { backgroundColor: "#fff" }]} resizeMode="contain" />
              ) : (
                <View style={styles.rowIcon}>
                  <Icon name={CATEGORY_ICONS[item.category] as any} size={20} color={colors.brandPrimary} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.rowSub}>
                  {CATEGORY_LABELS[item.category]} · {item.ingredients.length} producten
                  {item.price_pp?.[user?.store ?? ""] ?? item.price_pp?.["Albert Heijn"]
                    ? ` · ± € ${(item.price_pp?.[user?.store ?? ""] ?? item.price_pp!["Albert Heijn"]).toFixed(2).replace(".", ",")} p.p.`
                    : ""}
                </Text>
                {warn.length ? (
                  <Text style={styles.warnText} numberOfLines={1} testID={`dish-warn-${item.id}`}>
                    ⚠ Bevat mogelijk: {warn.join(", ")}
                  </Text>
                ) : null}
              </View>
              {!item.is_standard ? (
                <View style={styles.ownBadge}>
                  <Text style={styles.ownBadgeText}>Eigen</Text>
                </View>
              ) : null}
              <Icon name="chevron-right" size={22} color={colors.muted} />
            </PressScale>
            </Reanimated.View>
            );
          }}
          ListEmptyComponent={
            <EmptyState
              icon="silverware-variant"
              title={tab === "own" && !data?.dishes.some((d) => isOwnDish(d, user?.id) && !d.is_standard) ? "Nog geen eigen gerechten" : "Geen gerechten gevonden"}
              subtitle={tab === "app" || data?.dishes.some((d) => isOwnDish(d, user?.id) && !d.is_standard) ? "Pas je filters aan of voeg een nieuw gerecht toe." : "Maak een gerecht met de knop hieronder, of neem er een over uit Online gerechten."}
            />
          }
        />
      )}
      </View>

      {tab === "packages" ? (
        <Pressable
          testID="new-package-fab"
          onPress={() => router.push("/package/edit")}
          style={({ pressed }) => [styles.fab, { bottom: bottomChrome + 16 }, pressed && { opacity: 0.9 }]}
        >
          <Icon name="plus" size={22} color={colors.onBrandPrimary} />
          <Text style={styles.fabText}>Pakket</Text>
        </Pressable>
      ) : null}
      {tab === "own" || tab === "app" ? (
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
  headBtn: { alignItems: "center", gap: 2, paddingTop: 8, paddingHorizontal: 4 },
  headBtnText: { fontSize: 11, fontFamily: fonts.semibold, color: colors.brandPrimary },
  dietChip: { flexDirection: "row", alignItems: "center", gap: 6 },
  warnText: { fontSize: 12, fontFamily: fonts.semibold, color: colors.error, marginTop: 2 },
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
    ...softShadow(colors, 1),
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
  crumbs: { flexDirection: "row", alignItems: "center", gap: 4, flexWrap: "wrap", minHeight: 34 },
  crumb: { fontSize: 14, fontFamily: fonts.medium, color: colors.brandPrimary },
  crumbActive: { color: colors.onSurface, fontFamily: fonts.bold },
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
