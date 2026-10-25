import { useState } from "react";
import { ActivityIndicator, Image, Linking, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Icon } from "@/src/components/ui";
import { api } from "@/src/api";
import { goBack } from "@/src/nav";
import { CATEGORY_ICONS, CATEGORY_LABELS, MEAL_CATEGORIES, MealCategory } from "@/src/constants";
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
  steps: string[];
  ingredients: { text: string; name: string; qty: number | null; unit: string; product: Product | null }[];
};

const SITE: Record<string, string> = { ah: "Allerhande", jumbo: "jumbo.com", dirk: "dirk.nl" };

// Gang op de site -> categorie in de app
function guessCategory(r: Recipe): MealCategory {
  const t = r.tags.join(" ").toLowerCase();
  if (/ontbijt|brunch/.test(t)) return "ontbijt";
  if (/lunch/.test(t)) return "lunch";
  if (/borrel|snack|tussendoor|toetje|dessert|nagerecht|koffietijd/.test(t)) return "snacks";
  return "avondeten";
}

export default function RecipeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const [pick, setPick] = useState(false);

  const q = useQuery({
    queryKey: ["recipe", id],
    queryFn: () => api<Recipe>(`/recipes/detail?id=${encodeURIComponent(id)}`),
    staleTime: 30 * 60 * 1000,
    retry: 1,
  });
  const r = q.data;

  const importMut = useMutation({
    mutationFn: (category: MealCategory) => api<{ id: string }>("/recipes/import", { method: "POST", body: { id, category } }),
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
        <View style={styles.headerBtn} />
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

              <Text style={styles.section}>Ingrediënten{r.servings ? ` voor ${r.servings} personen` : ""}</Text>
              <View style={styles.card}>
                {r.ingredients.map((i, n) => (
                  <Pressable
                    key={n}
                    disabled={!i.product}
                    onPress={() => i.product && router.push(`/product/${i.product.id}`)}
                    style={[styles.ingRow, n > 0 && styles.ingBorder]}
                  >
                    {i.product?.image ? (
                      <Image source={{ uri: i.product.image }} style={styles.ingImg} resizeMode="contain" />
                    ) : (
                      <View style={[styles.ingImg, styles.ingDot]}>
                        <Icon name="circle-small" size={22} color={colors.muted} />
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.ingText}>{i.text}</Text>
                      {i.product ? (
                        <Text style={styles.ingProd} numberOfLines={1}>
                          {i.product.name} · {euro(i.product.promo?.price ?? i.product.price)}
                        </Text>
                      ) : null}
                    </View>
                    {i.product ? <Icon name="chevron-right" size={20} color={colors.muted} /> : null}
                  </Pressable>
                ))}
              </View>

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
            <Pressable testID="recipe-import" onPress={() => setPick(true)} style={styles.primary}>
              <Icon name="plus" size={20} color={colors.onBrandPrimary} />
              <Text style={styles.primaryText}>Toevoegen aan eigen gerechten</Text>
            </Pressable>
          </View>

          <Modal visible={pick} transparent animationType="slide" onRequestClose={() => setPick(false)}>
            <Pressable style={styles.backdrop} onPress={() => setPick(false)}>
              <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]} onPress={() => {}}>
                <Text style={styles.sheetTitle}>Bij welke maaltijd hoort dit?</Text>
                <Text style={styles.muted}>
                  De hoeveelheden worden omgerekend naar één persoon{r.servings ? ` (het recept is voor ${r.servings})` : ""}. Je kunt alles daarna nog aanpassen.
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
        </>
      )}
    </View>
  );
}

function Meta({ icon, text }: { icon: string; text: string }) {
  const styles = useStyles();
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
}));
