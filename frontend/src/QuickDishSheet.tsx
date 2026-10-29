// Snel lijstje: een gerecht erbij zetten. Popup met al je gerechten (met foto), zoeken en per maaltijd;
// tik om het op je lijstje te zetten of er weer af te halen. De ingrediënten komen dan op het lijstje.
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import Image from "@/src/components/SafeImage";
import Modal from "@/src/components/Modal";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Icon } from "@/src/components/ui";
import { api, mediaUrl } from "@/src/api";
import { CATEGORY_LABELS, MEAL_CATEGORIES, type MealCategory } from "@/src/constants";
import { useToast } from "@/src/toast";
import type { Dish } from "@/app/(tabs)/dishes";
import { fonts, makeStyles, useTheme } from "@/src/theme";

export function QuickDishSheet({ visible, listId, onClose }: { visible: boolean; listId?: string | null; onClose: () => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<MealCategory | "all">("all");
  const dishes = useQuery({ queryKey: ["dishes"], queryFn: () => api<{ dishes: Dish[] }>("/dishes"), enabled: visible });
  const camp = useQuery({
    queryKey: ["camp", listId],
    queryFn: () => api<{ days: { meals: Record<string, string[]> }[] }>(`/camps/${listId}`),
    enabled: !!listId && visible,
  });
  const onList = new Set(Object.values(camp.data?.days?.[0]?.meals ?? {}).flat());
  const toggle = useMutation({
    mutationFn: (d: Dish) => api<{ id: string; on: boolean }>("/today/dish", { method: "POST", body: { dish_id: d.id, category: d.category } }),
    onSuccess: (r, d) => {
      toast.show(r.on ? `${d.name} staat op je lijstje` : `${d.name} van je lijstje gehaald`, "success");
      qc.invalidateQueries({ queryKey: ["today"] });
      qc.invalidateQueries({ queryKey: ["camp", r.id] });
      qc.invalidateQueries({ queryKey: ["shopping", r.id] });
    },
    onError: (e: any) => toast.show(e?.message ?? "Mislukt", "error"),
  });
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (dishes.data?.dishes ?? [])
      .filter((d) => (cat === "all" || d.category === cat) && (!t || d.name.toLowerCase().includes(t)))
      .sort((a, b) => Number(onList.has(b.id)) - Number(onList.has(a.id)) || a.name.localeCompare(b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dishes.data, q, cat, camp.data]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]} onPress={() => {}}>
          <View style={styles.head}>
            <Text style={styles.title}>Gerecht toevoegen</Text>
            <Pressable onPress={onClose} hitSlop={10} testID="quick-dish-close">
              <Icon name="close" size={22} color={colors.onSurface} />
            </Pressable>
          </View>
          <View style={styles.search}>
            <Icon name="magnify" size={20} color={colors.muted} />
            <TextInput placeholder="Zoek een gerecht" placeholderTextColor={colors.muted} value={q} onChangeText={setQ} style={styles.input} testID="quick-dish-search" />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} style={{ flexGrow: 0 }}>
            {(["all", ...MEAL_CATEGORIES] as const).map((c) => (
              <Pressable key={c} onPress={() => setCat(c)} style={[styles.chip, cat === c && styles.chipOn]}>
                <Text style={[styles.chipText, cat === c && { color: colors.onBrandPrimary }]}>{c === "all" ? "Alles" : CATEGORY_LABELS[c]}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <ScrollView contentContainerStyle={{ gap: 6, paddingBottom: 6 }}>
            {dishes.isLoading ? <ActivityIndicator color={colors.brandPrimary} style={{ marginVertical: 20 }} /> : null}
            {!dishes.isLoading && !shown.length ? <Text style={styles.muted}>Geen gerechten gevonden.</Text> : null}
            {shown.map((d) => {
              const on = onList.has(d.id);
              const img = mediaUrl(d.image ?? d.source?.image);
              return (
                <Pressable key={d.id} testID="quick-dish-row" disabled={toggle.isPending} onPress={() => toggle.mutate(d)} style={({ pressed }) => [styles.row, on && styles.rowOn, pressed && { opacity: 0.8 }]}>
                  {img ? (
                    <Image source={{ uri: img }} style={styles.img} resizeMode="cover" />
                  ) : (
                    <View style={[styles.img, { alignItems: "center", justifyContent: "center" }]}>
                      <Icon name="silverware-fork-knife" size={18} color={colors.brandPrimary} />
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name} numberOfLines={1}>{d.name}</Text>
                    <Text style={styles.muted}>{CATEGORY_LABELS[d.category as MealCategory] ?? ""} · {d.ingredients.length} ingrediënten</Text>
                  </View>
                  <Icon name={on ? "check-circle" : "plus-circle-outline"} size={24} color={on ? colors.success : colors.brandPrimary} />
                </Pressable>
              );
            })}
          </ScrollView>
          <Pressable
            onPress={() => {
              onClose();
              router.push({ pathname: "/dish/edit", params: { category: cat === "all" ? "avondeten" : cat } });
            }}
            style={styles.newLink}
            testID="quick-dish-new"
          >
            <Icon name="plus" size={16} color={colors.brandPrimary} />
            <Text style={styles.newText}>Nieuw gerecht maken</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center" },
  sheet: { backgroundColor: colors.surface, borderRadius: 20, width: "94%", maxWidth: 560, alignSelf: "center", height: "86%", padding: 16, gap: 10 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: 18, fontFamily: fonts.bold, color: colors.onSurface },
  search: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.surfaceSecondary, borderRadius: 12, paddingHorizontal: 12, minHeight: 44 },
  input: { flex: 1, fontSize: 15, fontFamily: fonts.regular, color: colors.onSurface, paddingVertical: 10 },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, backgroundColor: colors.surfaceSecondary },
  chipOn: { backgroundColor: colors.brandPrimary },
  chipText: { fontSize: 13, fontFamily: fonts.semibold, color: colors.onSurface },
  row: { flexDirection: "row", alignItems: "center", gap: 10, padding: 8, borderRadius: 12, borderWidth: 1, borderColor: colors.border },
  rowOn: { borderColor: colors.success, backgroundColor: colors.brandTertiary },
  img: { width: 48, height: 48, borderRadius: 10, backgroundColor: colors.surfaceSecondary },
  name: { fontSize: 15, fontFamily: fonts.semibold, color: colors.onSurface },
  muted: { fontSize: 12, fontFamily: fonts.regular, color: colors.muted },
  newLink: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "center", paddingVertical: 6 },
  newText: { fontSize: 14, fontFamily: fonts.semibold, color: colors.brandPrimary },
}));
