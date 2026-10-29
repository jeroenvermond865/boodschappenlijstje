// Een gerecht bekijken (bijv. vanuit "Op het menu" op Home): foto, wat je nodig hebt en de bereiding.
// Bewerken kan met de knop onderaan.
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import Image from "@/src/components/SafeImage";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";

import { Icon } from "@/src/components/ui";
import { api, mediaUrl } from "@/src/api";
import { goBack } from "@/src/nav";
import { CATEGORY_LABELS, formatQty, type MealCategory } from "@/src/constants";
import { PrepSteps } from "@/src/DishPreview";
import type { Dish } from "@/app/(tabs)/dishes";
import { fonts, makeStyles, useTheme } from "@/src/theme";

export default function DishScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id, camp } = useLocalSearchParams<{ id: string; camp?: string }>();
  const q = useQuery({ queryKey: ["dish", id], queryFn: () => api<Dish>(`/dishes/${id}`), enabled: !!id });
  const d = q.data;
  const image = d ? mediaUrl(d.image ?? d.source?.image) : undefined;

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable testID="back-button" onPress={() => goBack()} hitSlop={10} style={styles.headerBtn}>
          <Icon name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>{d?.name ?? ""}</Text>
        <View style={styles.headerBtn} />
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
              </View>

              <View style={{ gap: 6 }}>
                <Text style={styles.section}>Wat heb je nodig (per volwassene)</Text>
                {d.ingredients.map((i, k) => (
                  <Text key={`${i.name}-${k}`} style={styles.line}>
                    • {i.name}
                    {i.qty_adult ? ` · ${formatQty(i.qty_adult)} ${i.unit}` : ""}
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
              onPress={() => router.push({ pathname: "/dish/edit", params: { id: d.id } })}
              style={({ pressed }) => [styles.btn, pressed && { opacity: 0.85 }]}
            >
              <Icon name="pencil-outline" size={18} color={colors.onBrandPrimary} />
              <Text style={styles.btnText}>Bewerken</Text>
            </Pressable>
          </View>
        </>
      )}
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
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 10, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.divider },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.brandPrimary, borderRadius: 14, paddingVertical: 13 },
  btnText: { fontSize: 15, fontFamily: fonts.semibold, color: colors.onBrandPrimary },
}));
