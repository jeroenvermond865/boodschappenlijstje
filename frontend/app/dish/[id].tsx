// Een gerecht bekijken (bijv. vanuit "Op het menu" op Home of vanuit een lijstje): foto, waar het vandaan komt, wat je nodig hebt
// en de bereiding. Vanuit een lijstje kun je hier ook de vegetarische optie kiezen. Bewerken en delen kan ook.
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import Image from "@/src/components/SafeImage";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";

import { Icon } from "@/src/components/ui";
import { api, mediaUrl } from "@/src/api";
import { goBack } from "@/src/nav";
import { CATEGORY_LABELS, formatQty, type MealCategory } from "@/src/constants";
import { PrepSteps, dietTag, fullDishRoute } from "@/src/DishPreview";
import { DishShareSheet } from "@/src/DishShare";
import { VegaPicker } from "@/src/VegaPicker";
import { dishOrigin } from "@/src/dishInfo";
import { useAuth } from "@/src/auth";
import { useTerms } from "@/src/settings";
import type { Dish } from "@/app/(tabs)/dishes";
import { fonts, makeStyles, useTheme } from "@/src/theme";

export default function DishScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id, camp } = useLocalSearchParams<{ id: string; camp?: string }>();
  const { user } = useAuth();
  const T = useTerms();
  const [shareOpen, setShareOpen] = useState(false);
  const [vegaOpen, setVegaOpen] = useState(false);
  const q = useQuery({ queryKey: ["dish", id], queryFn: () => api<Dish>(`/dishes/${id}`), enabled: !!id });
  const d = q.data;
  // Vanuit een lijstje: hoeveel personen en vegetariërs er meeeten
  const campQ = useQuery({
    queryKey: ["camp", camp],
    queryFn: () => api<{ vega_adults?: number; vega_children?: number; days: { adults: number; children: number }[] }>(`/camps/${camp}`),
    enabled: !!camp,
  });
  const vegaCount = (campQ.data?.vega_adults ?? 0) + (campQ.data?.vega_children ?? 0);
  const origin = d ? dishOrigin(d, user?.id, `${T.deze} ${T.one}`) : null;
  const rid = d?.source?.recipe_id;
  const image = d ? mediaUrl(d.image ?? d.source?.image) : undefined;

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable testID="back-button" onPress={() => goBack()} hitSlop={10} style={styles.headerBtn}>
          <Icon name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>{d?.name ?? ""}</Text>
        {d ? (
          <Pressable testID="dish-share" onPress={() => setShareOpen(true)} hitSlop={10} style={styles.headerBtn}>
            <Icon name="share-variant" size={22} color={colors.brandPrimary} />
          </Pressable>
        ) : (
          <View style={styles.headerBtn} />
        )}
      </View>
      {!d ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          {q.isError ? <Text style={styles.muted}>Gerecht niet gevonden</Text> : <ActivityIndicator size="large" color={colors.brandPrimary} />}
        </View>
      ) : (
        <>
          <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}>
            {image ? (
              <View>
                <Image source={{ uri: image }} style={styles.hero} resizeMode="cover" />
                {(d as any).photo_ai ? <Text style={styles.aiTag}>AI-afbeelding</Text> : null}
              </View>
            ) : (
              <View style={[styles.hero, styles.heroEmpty]}>
                <Icon name="silverware-fork-knife" size={40} color={colors.brandPrimary} />
              </View>
            )}
            <View style={{ padding: 16, gap: 14 }}>
              <View style={{ gap: 4 }}>
                <Text style={styles.title}>{d.name}</Text>
                <Text style={styles.muted}>{CATEGORY_LABELS[d.category as MealCategory] ?? ""}</Text>
                {origin ? (
                  <View style={styles.originRow} testID="dish-origin">
                    <Icon name={origin.icon as any} size={15} color={colors.brandPrimary} />
                    <Text style={styles.originText}>{origin.label}</Text>
                    {rid ? (
                      <Pressable onPress={() => router.push(fullDishRoute(d))} hitSlop={6} testID="dish-original">
                        <Text style={styles.link}>Origineel recept</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}
              </View>

              {camp && d.needs_vega && vegaCount > 0 ? (
                <Pressable onPress={() => setVegaOpen(true)} style={styles.vegaCard} testID="dish-vega">
                  <Icon name="leaf" size={20} color={colors.success} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.vegaTitle}>Vegetarische optie kiezen</Text>
                    <Text style={styles.muted}>
                      Er {vegaCount === 1 ? "eet 1 vegetariër" : `eten ${vegaCount} vegetariërs`} mee. Kies een vervanger voor het vlees of de vis; de bereiding past zich aan.
                    </Text>
                  </View>
                  <Icon name="chevron-right" size={20} color={colors.success} />
                </Pressable>
              ) : null}

              <View style={{ gap: 6 }}>
                <Text style={styles.section}>Wat heb je nodig (per volwassene)</Text>
                {d.ingredients.map((i, k) => (
                  <Text key={`${i.name}-${k}`} style={styles.line}>
                    • {i.name}
                    {i.qty_adult ? ` · ${formatQty(i.qty_adult)} ${i.unit}` : ""}
                    {dietTag(d, i)}
                  </Text>
                ))}
                {d.pantry?.length ? <Text style={styles.muted}>Waarschijnlijk al in huis: {d.pantry.map((p) => p.name).join(", ")}</Text> : null}
              </View>

              <PrepSteps dishId={d.id} campId={camp} />
            </View>
          </ScrollView>
          <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
            <Pressable
              testID="dish-edit"
              onPress={() => router.push({ pathname: "/dish/edit", params: camp ? { id: d.id, campId: camp } : { id: d.id } })}
              style={({ pressed }) => [styles.btn, pressed && { opacity: 0.85 }]}
            >
              <Icon name="pencil-outline" size={18} color={colors.onBrandPrimary} />
              <Text style={styles.btnText}>{camp ? `Aanpassen voor ${T.deze} ${T.one}` : "Bewerken"}</Text>
            </Pressable>
          </View>
        </>
      )}
      <VegaPicker
        dish={vegaOpen && d ? d : null}
        campId={camp}
        onClose={() => setVegaOpen(false)}
        onSaved={(nd) => nd.id !== d?.id && router.setParams({ id: nd.id })}
      />
      <DishShareSheet
        dish={shareOpen && d ? d : null}
        campId={camp}
        people={
          campQ.data
            ? {
                adults: Math.max(1, ...campQ.data.days.map((x) => x.adults || 0)),
                children: Math.max(0, ...campQ.data.days.map((x) => x.children || 0)),
                vegaAdults: campQ.data.vega_adults ?? 0,
                vegaChildren: campQ.data.vega_children ?? 0,
              }
            : undefined
        }
        onClose={() => setShareOpen(false)}
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: colors.divider },
  headerBtn: { width: 44, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 17, fontFamily: fonts.bold, color: colors.onSurface },
  hero: { width: "100%", height: 220, backgroundColor: colors.surfaceSecondary },
  heroEmpty: { alignItems: "center", justifyContent: "center" },
  aiTag: { position: "absolute", right: 10, bottom: 10, fontSize: 11, fontFamily: fonts.semibold, color: "#fff", backgroundColor: "rgba(0,0,0,0.45)", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, overflow: "hidden" },
  title: { fontSize: 24, fontFamily: fonts.bold, color: colors.onSurface },
  section: { fontSize: 16, fontFamily: fonts.bold, color: colors.onSurface },
  line: { fontSize: 15, lineHeight: 21, fontFamily: fonts.regular, color: colors.onSurface },
  muted: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted },
  originRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 2 },
  originText: { fontSize: 14, fontFamily: fonts.semibold, color: colors.brandPrimary },
  link: { fontSize: 14, fontFamily: fonts.semibold, color: colors.brandSecondary, textDecorationLine: "underline" },
  vegaCard: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: colors.success, backgroundColor: colors.surfaceSecondary },
  vegaTitle: { fontSize: 15, fontFamily: fonts.bold, color: colors.onSurface },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 10, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.divider },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.brandPrimary, borderRadius: 14, paddingVertical: 13 },
  btnText: { fontSize: 15, fontFamily: fonts.semibold, color: colors.onBrandPrimary },
}));
