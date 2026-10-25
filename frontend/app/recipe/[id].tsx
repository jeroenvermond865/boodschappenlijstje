import { useState } from "react";
import { ActivityIndicator, Image, Linking, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Icon } from "@/src/components/ui";
import { api } from "@/src/api";
import { useTerms } from "@/src/settings";
import { goBack } from "@/src/nav";
import { CATEGORY_ICONS, CATEGORY_LABELS, MEAL_CATEGORIES, MealCategory, formatQty } from "@/src/constants";
import { fonts, makeStyles, useTheme } from "@/src/theme";
import { euro } from "@/src/search";
import { STORE_LABEL } from "@/src/OnlineRecipes";
import type { Product } from "@/app/(tabs)/products";

type Recipe = {
  id: string;
  store: string;
  title: string;
  description?: string | null;
  image?: string | null;
  time?: number | null;
  servings?: number | null;
  tags: string[];
  kcal?: number | null;
  tip?: string | null;
  url: string;
  is_favorite?: boolean;
  steps: string[];
  ingredients: { text: string; name: string; qty: number | null; unit: string; pantry?: boolean; product: Product | null }[];
};

const SITE: Record<string, string> = { ah: "Allerhande", jumbo: "jumbo.com", dirk: "dirk.nl" };

// Gang op de site -> categorie in de app; de titel weegt mee ("Paddenstoelenkoekjes" is geen avondeten)
const SNACK_RE = /borrel|snack|hapje|tussendoor|toetje|dessert|nagerecht|koffietijd|gebak|koek|cookie|cake|taart|brownie|muffin|cupcake|bonbon|truffel|ijs\b|ijsjes|traktatie|smoothie|cocktail|mocktail|limonade|drankje|bonbons|snoep|fudge|wafel|donut|scone|crumble|tiramisu|mousse|pudding|bavarois|chips|dip\b|nacho|bitterbal|kroket|popcorn|energieballetjes|granolareep/;
function guessCategory(r: Recipe): MealCategory {
  const tags = r.tags.join(" ").toLowerCase();
  const title = r.title.toLowerCase();
  if (/ontbijt|brunch/.test(tags) && !/ontbijtkoek/.test(title)) return "ontbijt";
  if (SNACK_RE.test(title)) return "snacks";
  if (/lunch/.test(tags)) return "lunch";
  if (/hoofdgerecht|avondeten|diner/.test(tags)) return "avondeten";
  if (SNACK_RE.test(tags)) return "snacks";
  if (/pannenkoek|wentelteefje|omelet|ontbijt|porridge|havermout|overnight|yoghurt|granola/.test(title)) return "ontbijt";
  if (/tosti|sandwich|broodje|wrap|salade/.test(title)) return "lunch";
  return "avondeten";
}

export default function RecipeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const styles = useStyles();
  const T = useTerms();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const [pick, setPick] = useState(false);
  const [campOpen, setCampOpen] = useState(false);
  const [persons, setPersons] = useState<number | null>(null);

  const q = useQuery({
    queryKey: ["recipe", id],
    queryFn: () => api<Recipe>(`/recipes/detail?id=${encodeURIComponent(id)}`),
    staleTime: 30 * 60 * 1000,
    retry: 1,
  });
  const r = q.data;
  const base = r?.servings || 4;
  const n = persons ?? base;
  const scale = (qty: number | null) => (qty == null ? null : Math.round(((qty * n) / base) * 100) / 100);
  const amount = (i: Recipe["ingredients"][number]) =>
    n !== base && i.qty != null ? `${formatQty(scale(i.qty)!)} ${i.unit === "stuks" ? "" : i.unit + " "}${i.name}` : i.text;
  const [include, setInclude] = useState<number[]>([]);

  const fav = useMutation({
    mutationFn: (on: boolean) =>
      on
        ? api("/recipes/favorite", { method: "POST", body: { id: r!.id, title: r!.title, image: r!.image, store: r!.store, time: r!.time, servings: r!.servings } })
        : api(`/recipes/favorite?id=${encodeURIComponent(r!.id)}`, { method: "DELETE" }),
    onMutate: (on: boolean) => qc.setQueryData(["recipe", id], { ...r!, is_favorite: on }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["recipes", "favorites"] }),
  });

  const importMut = useMutation({
    mutationFn: (category: MealCategory) => api<{ id: string }>("/recipes/import", { method: "POST", body: { id, category, include } }),
    onSuccess: (dish) => {
      setPick(false);
      qc.invalidateQueries({ queryKey: ["dishes"] });
      router.push({ pathname: "/dish/edit", params: { id: dish.id } });
    },
  });

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable testID="back-button" onPress={() => goBack("/dishes")} hitSlop={10} style={styles.headerBtn}>
          <Icon name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {r ? `Recept van ${STORE_LABEL[r.store] ?? r.store}` : "Recept"}
        </Text>
        {r ? (
          <Pressable testID="recipe-fav" onPress={() => fav.mutate(!r.is_favorite)} hitSlop={10} style={styles.headerBtn}>
            <Icon name={r.is_favorite ? "heart" : "heart-outline"} size={24} color={r.is_favorite ? "#E0245E" : colors.muted} />
          </Pressable>
        ) : (
          <View style={styles.headerBtn} />
        )}
      </View>

      {q.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.brandPrimary} />
        </View>
      ) : !r ? (
        <View style={styles.center}>
          <Text style={styles.muted}>{(q.error as Error)?.message ?? "Recept niet gevonden"}</Text>
          <Pressable onPress={() => q.refetch()}>
            <Text style={styles.link}>Opnieuw proberen</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 110 }}>
            {r.image ? <Image source={{ uri: r.image }} style={styles.hero} resizeMode="cover" /> : null}
            <View style={{ padding: 16, gap: 14 }}>
              <Text style={styles.title}>{r.title}</Text>
              <View style={styles.metaRow}>
                {r.time ? <Meta icon="clock-outline" text={`${r.time} min`} /> : null}
                {r.servings ? <Meta icon="account-group-outline" text={`${r.servings} personen`} /> : null}
                {r.kcal ? <Meta icon="fire" text={`${r.kcal} kcal p.p.`} /> : null}
                <Meta icon="format-list-bulleted" text={`${r.ingredients.length} ingrediënten`} />
              </View>
              {r.tags.length ? (
                <View style={styles.tags}>
                  {r.tags.slice(0, 10).map((t) => (
                    <View key={t} style={styles.tag}>
                      <Text style={styles.tagText}>{t}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
              {r.description ? <Text style={styles.body}>{r.description}</Text> : null}

              <View style={styles.personsRow}>
                <Text style={[styles.section, { flex: 1, marginTop: 0 }]}>Ingrediënten</Text>
                <Pressable onPress={() => setPersons(Math.max(1, n - 1))} hitSlop={6} style={styles.stepBtn}>
                  <Icon name="minus" size={18} color={colors.onSurface} />
                </Pressable>
                <Text style={styles.personsText}>{n === 1 ? "1 persoon" : `${n} personen`}</Text>
                <Pressable onPress={() => setPersons(n + 1)} hitSlop={6} style={styles.stepBtn}>
                  <Icon name="plus" size={18} color={colors.onSurface} />
                </Pressable>
              </View>
              {n !== base ? <Text style={styles.muted}>Omgerekend van {base} naar {n === 1 ? "1 persoon" : `${n} personen`}.</Text> : null}
              <View style={styles.card}>
                {r.ingredients.map((i, idx) => ({ i, idx })).filter((x) => !x.i.pantry).map(({ i, idx }, k) => (
                  <IngRow key={idx} i={i} first={k === 0} label={amount(i)} />
                ))}
              </View>

              {r.ingredients.some((i) => i.pantry) ? (
                <>
                  <Text style={styles.section}>Waarschijnlijk al in huis</Text>
                  <Text style={styles.muted}>Deze gaan niet mee op je boodschappenlijst. Tik op + als je ze toch wilt kopen.</Text>
                  <View style={styles.card}>
                    {r.ingredients.map((i, idx) => ({ i, idx })).filter((x) => x.i.pantry).map(({ i, idx }, k) => (
                      <IngRow
                        key={idx}
                        i={i}
                        first={k === 0}
                        label={amount(i)}
                        toggle={{ on: include.includes(idx), onPress: () => setInclude((x) => (x.includes(idx) ? x.filter((v) => v !== idx) : [...x, idx])) }}
                      />
                    ))}
                  </View>
                </>
              ) : null}

              {r.steps.length ? (
                <>
                  <Text style={styles.section}>Bereiding</Text>
                  {r.steps.map((s, n) => (
                    <View key={n} style={styles.step}>
                      <View style={styles.stepNum}>
                        <Text style={styles.stepNumText}>{n + 1}</Text>
                      </View>
                      <Text style={[styles.body, { flex: 1 }]}>{s}</Text>
                    </View>
                  ))}
                </>
              ) : null}
              {r.tip ? (
                <View style={styles.tip}>
                  <Icon name="lightbulb-on-outline" size={18} color={colors.brandPrimary} />
                  <Text style={[styles.body, { flex: 1 }]}>{r.tip}</Text>
                </View>
              ) : null}

              <Pressable onPress={() => Linking.openURL(r.url)} style={styles.siteLink}>
                <Icon name="open-in-new" size={16} color={colors.brandPrimary} />
                <Text style={styles.link}>Bekijk op {SITE[r.store] ?? "de site"}</Text>
              </Pressable>
            </View>
          </ScrollView>

          <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable testID="recipe-import" onPress={() => setPick(true)} style={[styles.primary, styles.secondary]}>
                <Icon name="pencil-outline" size={18} color={colors.brandPrimary} />
                <Text style={[styles.primaryText, { color: colors.brandPrimary }]}>Aanpassen</Text>
              </Pressable>
              <Pressable testID="recipe-to-camp" onPress={() => setCampOpen(true)} style={[styles.primary, { flex: 1 }]}>
                <Icon name="tent" size={18} color={colors.onBrandPrimary} />
                <Text style={styles.primaryText}>{`Toevoegen aan ${T.one}`}</Text>
              </Pressable>
            </View>
          </View>

          <Modal visible={pick} transparent animationType="slide" onRequestClose={() => setPick(false)}>
            <Pressable style={styles.backdrop} onPress={() => setPick(false)}>
              <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]} onPress={() => {}}>
                <Text style={styles.sheetTitle}>Overnemen als eigen gerecht</Text>
                <Text style={styles.muted}>
                  Het recept wordt omgerekend naar één persoon{r.servings ? ` (het is voor ${r.servings})` : ""}. Daarna kun je producten wisselen, weghalen of toevoegen. Bij welke maaltijd hoort het?
                </Text>
                {MEAL_CATEGORIES.map((c) => (
                  <Pressable
                    key={c}
                    disabled={importMut.isPending}
                    onPress={() => importMut.mutate(c)}
                    style={[styles.catRow, c === guessCategory(r) && styles.catRowSuggested]}
                  >
                    <Icon name={CATEGORY_ICONS[c] as any} size={22} color={colors.brandPrimary} />
                    <Text style={styles.catText}>{CATEGORY_LABELS[c]}</Text>
                    {c === guessCategory(r) ? <Text style={styles.suggest}>Voorstel</Text> : null}
                  </Pressable>
                ))}
                {importMut.isPending ? <ActivityIndicator color={colors.brandPrimary} /> : null}
                {importMut.isError ? <Text style={{ color: colors.error }}>{(importMut.error as Error).message}</Text> : null}
              </Pressable>
            </Pressable>
          </Modal>
          <CampSheet open={campOpen} onClose={() => setCampOpen(false)} recipeId={r.id} suggested={guessCategory(r)} include={include} />
        </>
      )}
    </View>
  );
}

type CampLite = { id: string; name: string; days: { index: number; adults: number; children: number; meals?: Record<string, string[]> }[] };

function CampSheet({
  open,
  onClose,
  recipeId,
  suggested,
  include,
}: {
  open: boolean;
  onClose: () => void;
  recipeId: string;
  suggested: MealCategory;
  include: number[];
}) {
  const styles = useStyles();
  const T = useTerms();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const router = useRouter();
  const [campId, setCampId] = useState<string | null>(null);
  const [day, setDay] = useState(0);
  const [cat, setCat] = useState<MealCategory>(suggested);
  const [done, setDone] = useState<string | null>(null);
  const camps = useQuery({ queryKey: ["camps"], queryFn: () => api<{ camps: CampLite[] }>("/camps"), enabled: open });
  const list = camps.data?.camps ?? [];
  const camp = list.find((c) => c.id === campId) ?? (list.length === 1 ? list[0] : undefined);

  const add = useMutation({
    mutationFn: () => api("/recipes/add-to-camp", { method: "POST", body: { id: recipeId, camp_id: camp!.id, day_index: day, category: cat, include } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["camps"] });
      qc.invalidateQueries({ queryKey: ["dishes"] });
      qc.invalidateQueries({ queryKey: ["home"] });
      setDone(camp!.id);
    },
  });

  const close = () => {
    setDone(null);
    onClose();
  };

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close}>
        <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + 16, maxHeight: "85%" }]} onPress={() => {}}>
          {done ? (
            <View style={{ gap: 12, alignItems: "center", paddingVertical: 10 }}>
              <Icon name="check-circle" size={44} color={colors.success} />
              <Text style={styles.sheetTitle}>Toegevoegd aan {camp?.name}</Text>
              <Text style={[styles.muted, { textAlign: "center" }]}>
                Het staat ook bij je eigen gerechten, zodat je producten kunt wisselen. De boodschappenlijst rekent met het aantal mensen per dag.
              </Text>
              <View style={{ flexDirection: "row", gap: 10, alignSelf: "stretch" }}>
                <Pressable onPress={close} style={[styles.primary, styles.secondary, { flex: 1 }]}>
                  <Text style={[styles.primaryText, { color: colors.brandPrimary }]}>Sluiten</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    close();
                    router.push(`/camp/${done}`);
                  }}
                  style={[styles.primary, { flex: 1 }]}
                >
                  <Text style={styles.primaryText}>{`Naar ${T.one}`}</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <ScrollView contentContainerStyle={{ gap: 12 }}>
              <Text style={styles.sheetTitle}>{`Toevoegen aan ${T.one}`}</Text>
              {camps.isLoading ? <ActivityIndicator color={colors.brandPrimary} /> : null}
              {!camps.isLoading && !list.length ? (
                <Pressable
                  onPress={() => {
                    close();
                    router.push("/camp/new");
                  }}
                  style={styles.catRow}
                >
                  <Icon name="plus" size={22} color={colors.brandPrimary} />
                  <Text style={styles.catText}>{`Eerst een ${T.one} maken`}</Text>
                </Pressable>
              ) : null}
              {list.length > 1 ? (
                <View style={{ gap: 8 }}>
                  <Text style={styles.label}>{T.One}</Text>
                  {list.map((c) => (
                    <Pressable key={c.id} onPress={() => { setCampId(c.id); setDay(0); }} style={[styles.catRow, camp?.id === c.id && styles.catRowSuggested]}>
                      <Icon name="tent" size={20} color={colors.brandPrimary} />
                      <Text style={styles.catText}>{c.name}</Text>
                      {camp?.id === c.id ? <Icon name="check" size={20} color={colors.brandPrimary} /> : null}
                    </Pressable>
                  ))}
                </View>
              ) : null}
              {camp ? (
                <>
                  <Text style={styles.label}>Dag</Text>
                  <View style={styles.tags}>
                    {camp.days.map((d, i) => (
                      <Pressable key={i} onPress={() => setDay(i)} style={[styles.chipSel, day === i && styles.chipSelOn]}>
                        <Text style={[styles.chipSelText, day === i && styles.chipSelTextOn]}>
                          Dag {i + 1} · {d.adults + d.children} p.
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <Text style={styles.label}>Maaltijd</Text>
                  <View style={styles.tags}>
                    {MEAL_CATEGORIES.map((c) => (
                      <Pressable key={c} onPress={() => setCat(c)} style={[styles.chipSel, cat === c && styles.chipSelOn]}>
                        <Icon name={CATEGORY_ICONS[c] as any} size={15} color={cat === c ? colors.onBrandPrimary : colors.onSurfaceTertiary} />
                        <Text style={[styles.chipSelText, cat === c && styles.chipSelTextOn]}>{CATEGORY_LABELS[c]}</Text>
                      </Pressable>
                    ))}
                  </View>
                  <Pressable disabled={add.isPending} onPress={() => add.mutate()} style={[styles.primary, add.isPending && { opacity: 0.6 }]}>
                    {add.isPending ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Icon name="plus" size={18} color={colors.onBrandPrimary} />}
                    <Text style={styles.primaryText}>Toevoegen aan dag {day + 1}</Text>
                  </Pressable>
                  {add.isError ? <Text style={{ color: colors.error }}>{(add.error as Error).message}</Text> : null}
                </>
              ) : null}
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function IngRow({
  i,
  first,
  label,
  toggle,
}: {
  i: Recipe["ingredients"][number];
  first: boolean;
  label: string;
  toggle?: { on: boolean; onPress: () => void };
}) {
  const styles = useStyles();
  const T = useTerms();
  const { colors } = useTheme();
  const router = useRouter();
  return (
    <View style={[styles.ingRow, !first && styles.ingBorder]}>
      <Pressable
        disabled={!i.product}
        onPress={() => i.product && router.push(`/product/${i.product.id}`)}
        style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 10 }}
      >
        {i.product?.image ? (
          <Image source={{ uri: i.product.image }} style={[styles.ingImg, toggle && !toggle.on && { opacity: 0.5 }]} resizeMode="contain" />
        ) : (
          <View style={[styles.ingImg, styles.ingDot]}>
            <Icon name="circle-small" size={22} color={colors.muted} />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={[styles.ingText, toggle && !toggle.on && { color: colors.muted }]}>{label}</Text>
          {i.product ? (
            <Text style={styles.ingProd} numberOfLines={1}>
              {toggle ? "Voorstel: " : ""}
              {i.product.name} · {euro(i.product.promo?.price ?? i.product.price)}
            </Text>
          ) : null}
        </View>
      </Pressable>
      {toggle ? (
        <Pressable onPress={toggle.onPress} hitSlop={8} style={[styles.addBtn, toggle.on && styles.addBtnOn]}>
          <Icon name={toggle.on ? "check" : "plus"} size={18} color={toggle.on ? colors.onBrandPrimary : colors.brandPrimary} />
        </Pressable>
      ) : i.product ? (
        <Icon name="chevron-right" size={20} color={colors.muted} />
      ) : null}
    </View>
  );
}

function Meta({ icon, text }: { icon: string; text: string }) {
  const styles = useStyles();
  const T = useTerms();
  const { colors } = useTheme();
  return (
    <View style={styles.meta}>
      <Icon name={icon as any} size={16} color={colors.muted} />
      <Text style={styles.metaText}>{text}</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingBottom: 8, gap: 4 },
  headerBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 16, fontFamily: fonts.semibold, color: colors.onSurface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 24 },
  muted: { fontSize: 14, fontFamily: fonts.regular, color: colors.muted },
  link: { fontSize: 15, fontFamily: fonts.semibold, color: colors.brandPrimary },
  hero: { width: "100%", aspectRatio: 16 / 10, backgroundColor: colors.surfaceTertiary },
  title: { fontSize: 24, fontFamily: fonts.bold, color: colors.onSurface },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 14 },
  meta: { flexDirection: "row", alignItems: "center", gap: 4 },
  metaText: { fontSize: 14, fontFamily: fonts.medium, color: colors.onSurfaceTertiary },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tag: { backgroundColor: colors.brandTertiary, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  tagText: { fontSize: 12, fontFamily: fonts.medium, color: colors.onSurface },
  body: { fontSize: 15, lineHeight: 22, fontFamily: fonts.regular, color: colors.onSurface },
  section: { fontSize: 18, fontFamily: fonts.bold, color: colors.onSurface, marginTop: 6 },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: 16, overflow: "hidden" },
  ingRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10 },
  ingBorder: { borderTopWidth: 1, borderTopColor: colors.divider },
  ingImg: { width: 40, height: 40, borderRadius: 8, backgroundColor: "#fff" },
  ingDot: { backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  ingText: { fontSize: 15, fontFamily: fonts.medium, color: colors.onSurface },
  ingProd: { fontSize: 12, fontFamily: fonts.regular, color: colors.muted, marginTop: 2 },
  step: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  stepNum: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center", marginTop: 1 },
  stepNumText: { color: colors.onBrandPrimary, fontSize: 14, fontFamily: fonts.bold },
  tip: { flexDirection: "row", gap: 8, backgroundColor: colors.brandTertiary, padding: 12, borderRadius: 12 },
  siteLink: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingVertical: 6 },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 12, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.divider },
  primary: { flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", backgroundColor: colors.brandPrimary, borderRadius: 14, paddingVertical: 15 },
  primaryText: { color: colors.onBrandPrimary, fontSize: 16, fontFamily: fonts.semibold },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16, gap: 10 },
  sheetTitle: { fontSize: 18, fontFamily: fonts.bold, color: colors.onSurface },
  catRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.border },
  catRowSuggested: { borderColor: colors.brandPrimary },
  catText: { flex: 1, fontSize: 16, fontFamily: fonts.medium, color: colors.onSurface },
  suggest: { fontSize: 12, fontFamily: fonts.semibold, color: colors.brandPrimary },
  secondary: { backgroundColor: colors.brandTertiary, paddingHorizontal: 18 },
  addBtn: { width: 34, height: 34, borderRadius: 17, borderWidth: 1.5, borderColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  addBtnOn: { backgroundColor: colors.brandPrimary },
  personsRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  personsText: { fontSize: 14, fontFamily: fonts.semibold, color: colors.onSurface, minWidth: 82, textAlign: "center" },
  stepBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  label: { fontSize: 14, fontFamily: fonts.semibold, color: colors.onSurfaceSecondary },
  chipSel: { flexDirection: "row", alignItems: "center", gap: 5, height: 34, paddingHorizontal: 12, borderRadius: 999, backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border },
  chipSelOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipSelText: { fontSize: 13, fontFamily: fonts.medium, color: colors.onSurfaceTertiary },
  chipSelTextOn: { color: colors.onBrandPrimary, fontFamily: fonts.semibold },
}));
