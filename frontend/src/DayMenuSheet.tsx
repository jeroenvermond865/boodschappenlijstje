// "Op het menu" op Home: één dag in een venster. Tik een gerecht voor de ingrediënten en de bereiding,
// en ga in één keer naar het lijstje van die dag (op looproute, klaar om af te vinken).
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import Image from "@/src/components/SafeImage";
import Modal from "@/src/components/Modal";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AltSwapList, PrepSteps, dishProductFor, fullDishRoute, type AltSwap } from "@/src/DishPreview";
import { useToast } from "@/src/toast";

import { Icon } from "@/src/components/ui";
import { api } from "@/src/api";
import { formatQty } from "@/src/constants";
import { fonts, makeStyles, useTheme } from "@/src/theme";

export type SoonDay = { date: string; index: number; in_list?: boolean; meals: { meal: string; dish_id: string; name: string; image?: string | null }[] };

type Dish = {
  id: string;
  name: string;
  ingredients: { name: string; qty_adult: number; qty_child: number; unit: string; aisle: string; product_id?: string | null }[];
  source?: { recipe_id: string; url?: string } | null;
};

export const MEAL_WORD: Record<string, string> = { ontbijt: "Ontbijt", lunch: "Lunch", avondeten: "Avondeten", snacks: "Tussendoor" };

export function dayWord(iso: string) {
  const d = new Date(`${iso}T12:00:00`);
  const t = new Date();
  t.setHours(12, 0, 0, 0);
  const diff = Math.round((d.getTime() - t.getTime()) / 86400000);
  if (diff === 0) return "Vandaag";
  if (diff === 1) return "Morgen";
  return d.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" });
}

export function DayMenuSheet({ campId, days, start, onClose }: { campId: string; days: SoonDay[]; start: number | null; onClose: () => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const [pos, setPos] = useState(0);
  // Het hele gerecht openen, net als bij Gerechten (online recept of gerecht)
  const openFull = (d: Dish) => {
    onClose();
    router.push(fullDishRoute(d));
  };
  const [openDish, setOpenDish] = useState<string | null>(null);
  useEffect(() => {
    if (start != null) {
      setPos(start);
      setOpenDish(null);
    }
  }, [start]);
  const d = start != null ? days[pos] : undefined;
  const go = (n: number) => {
    setPos(n);
    setOpenDish(null);
  };

  return (
    <Modal visible={start != null && !!d} animationType="fade" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]} onPress={() => {}}>
          {d ? (
            <>
              <View style={styles.head}>
                <Pressable onPress={() => go(pos - 1)} disabled={pos === 0} hitSlop={8} style={{ opacity: pos === 0 ? 0.3 : 1 }}>
                  <Icon name="chevron-left" size={26} color={colors.onSurface} />
                </Pressable>
                <View style={{ flex: 1, alignItems: "center" }}>
                  <Text style={styles.title}>{dayWord(d.date)}</Text>
                  <Text style={styles.meta}>Dag {d.index + 1}</Text>
                </View>
                <Pressable onPress={() => go(pos + 1)} disabled={pos >= days.length - 1} hitSlop={8} style={{ opacity: pos >= days.length - 1 ? 0.3 : 1 }}>
                  <Icon name="chevron-right" size={26} color={colors.onSurface} />
                </Pressable>
                <Pressable onPress={onClose} hitSlop={8} testID="day-menu-close" style={{ marginLeft: 6 }}>
                  <Icon name="close" size={22} color={colors.onSurface} />
                </Pressable>
              </View>
              <ScrollView contentContainerStyle={{ gap: 8 }}>
                {d.meals.map((m) => {
                  const k = `${m.meal}-${m.dish_id}`;
                  const isOpen = openDish === k;
                  return (
                    <View key={k} style={styles.mealCard}>
                      <Pressable
                        onPress={() => {
                          // Nog een keer tikken op een open gerecht: het hele gerecht openen
                          const full = isOpen ? qc.getQueryData<Dish>(["dish", m.dish_id]) : undefined;
                          if (full) openFull(full);
                          else setOpenDish(isOpen ? null : k);
                        }}
                        style={styles.mealRow} testID={`day-menu-dish-${m.dish_id}`}>
                        {m.image ? (
                          <Image source={{ uri: m.image }} style={styles.img} />
                        ) : (
                          <View style={[styles.img, { alignItems: "center", justifyContent: "center" }]}>
                            <Icon name="silverware-fork-knife" size={20} color={colors.brandPrimary} />
                          </View>
                        )}
                        <View style={{ flex: 1 }}>
                          <Text style={styles.meal}>{MEAL_WORD[m.meal] ?? m.meal}</Text>
                          <Text style={styles.name}>{m.name}</Text>
                        </View>
                        <Icon name={isOpen ? "chevron-up" : "chevron-down"} size={22} color={colors.muted} />
                      </Pressable>
                      {isOpen ? <DishDetail dishId={m.dish_id} campId={campId} dayIndex={d.index} meal={m.meal} onOpen={openFull} /> : null}
                    </View>
                  );
                })}
              </ScrollView>
              {d.in_list === false ? <Text style={styles.meta}>Voor deze dag staat "Boodschappen deze dag" uit.</Text> : null}
              <Pressable
                testID="day-menu-shopping"
                onPress={() => {
                  onClose();
                  router.push({ pathname: "/shopping/[id]", params: { id: campId, day: String(d.index) } });
                }}
                style={styles.btn}
              >
                <Icon name="cart-outline" size={20} color={colors.onBrandPrimary} />
                <Text style={styles.btnText}>Boodschappen voor {dayWord(d.date).toLowerCase()}</Text>
              </Pressable>
            </>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

type CampSwaps = {
  product_swaps?: Record<string, string>;
  days?: { index: number; extras?: { product_id?: string | null; meal?: string | null }[] }[];
};

function DishDetail({ dishId, campId, dayIndex, meal, onOpen }: { dishId: string; campId: string; dayIndex: number; meal: string; onOpen: (d: Dish) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const camp = useQuery({ queryKey: ["camp", campId], queryFn: () => api<CampSwaps>(`/camps/${campId}`), staleTime: 60 * 1000 });
  const styles = useStyles();
  const { colors } = useTheme();
  const dish = useQuery({ queryKey: ["dish", dishId], queryFn: () => api<Dish>(`/dishes/${dishId}`), staleTime: 10 * 60 * 1000 });
  const rid = dish.data?.source?.recipe_id;
  // Bereiding staat bij recepten van de supermarkt-sites; app-gerechten hebben alleen ingrediënten
  const rec = useQuery({
    queryKey: ["recipe", rid ?? ""],
    queryFn: () => api<{ steps: string[]; alt_swaps?: AltSwap[] }>(`/recipes/detail?id=${encodeURIComponent(rid!)}`),
    enabled: !!rid,
    staleTime: 30 * 60 * 1000,
    retry: 1,
  });
  if (dish.isLoading) return <ActivityIndicator color={colors.brandPrimary} style={{ margin: 10 }} />;
  if (!dish.data) return <Text style={[styles.meta, { padding: 10 }]}>Dit gerecht kon niet geladen worden.</Text>;
  // "Liever vlees? Vervang ...": voor dit hele lijstje wisselen
  // Nog een keer tikken: terug wisselen. Een tip als "lekker met feta" zet het product bij deze maaltijd (of haalt het weg)
  const isDone = (sw: AltSwap) => {
    if (sw.kind === "add") {
      const day = camp.data?.days?.find((x) => x.index === dayIndex);
      return !!day && (day.extras ?? []).some((ex) => ex.product_id === sw.product.id && (ex.meal ?? null) === meal);
    }
    const from = dish.data ? dishProductFor(dish.data as any, sw) : null;
    return !!from && camp.data?.product_swaps?.[from] === sw.product.id;
  };
  const swap = async (sw: AltSwap) => {
    const on = isDone(sw);
    try {
      if (sw.kind === "add") {
        await api(`/camps/${campId}/tip-extra`, { method: "POST", body: { product_id: sw.product.id, day_index: dayIndex, meal, on: !on } });
      } else {
        const from = dish.data ? dishProductFor(dish.data as any, sw) : null;
        if (!from) return toast.show("Dit product staat niet in het gerecht; pas het gerecht aan om te wisselen", "error");
        await api(`/camps/${campId}/product-swap`, { method: "POST", body: on ? { from_id: sw.product.id, to_id: from } : { from_id: from, to_id: sw.product.id } });
      }
      await Promise.all(["camp", "shopping", "budget"].map((k) => qc.invalidateQueries({ queryKey: [k, campId] })));
      qc.invalidateQueries({ queryKey: ["dish-prep"] });
      toast.show(
        sw.kind === "add"
          ? on ? `${sw.product.name} weggehaald` : `${sw.product.name} toegevoegd`
          : on ? `Terug gewisseld naar ${sw.from}` : `${sw.from} vervangen door ${sw.product.name}`,
        "success",
      );
    } catch (e: any) {
      toast.show(e?.message ?? "Wisselen mislukt", "error");
    }
  };
  return (
    <View style={styles.detail}>
      <Text style={styles.sub}>Ingrediënten (per volwassene)</Text>
      {dish.data.ingredients.map((i, k) => (
        <Text key={`${i.name}-${k}`} style={styles.line}>
          • {i.name}
          {i.qty_adult ? ` · ${formatQty(i.qty_adult)} ${i.unit ?? ""}` : ""}
        </Text>
      ))}
      <AltSwapList
        swaps={rec.data?.alt_swaps ?? []}
        done={isDone}
        onSwap={swap}
      />
      <View style={{ marginTop: 6 }}>
        <PrepSteps dishId={dishId} campId={campId} />
      </View>
      <Pressable onPress={() => onOpen(dish.data!)} style={styles.link} testID="day-menu-open-dish">
        <Text style={styles.linkText}>Hele gerecht openen</Text>
        <Icon name="chevron-right" size={18} color={colors.brandPrimary} />
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center" },
  sheet: { backgroundColor: colors.surface, borderRadius: 20, width: "92%", maxWidth: 520, alignSelf: "center", maxHeight: "90%", padding: 16, gap: 10 },
  head: { flexDirection: "row", alignItems: "center", gap: 6 },
  title: { fontSize: 20, fontFamily: fonts.bold, color: colors.onSurface, textTransform: "capitalize" },
  meta: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted },
  mealCard: { borderWidth: 1, borderColor: colors.border, borderRadius: 14, overflow: "hidden" },
  mealRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10 },
  img: { width: 48, height: 48, borderRadius: 10, backgroundColor: colors.brandTertiary },
  meal: { fontSize: 12, fontFamily: fonts.medium, color: colors.muted },
  name: { fontSize: 15, fontFamily: fonts.semibold, color: colors.onSurface },
  detail: { paddingHorizontal: 12, paddingBottom: 12, gap: 4 },
  sub: { fontSize: 14, fontFamily: fonts.bold, color: colors.onSurface },
  line: { fontSize: 14, fontFamily: fonts.regular, color: colors.onSurface, lineHeight: 20 },
  stepNo: { fontSize: 14, fontFamily: fonts.bold, color: colors.brandPrimary, width: 18 },
  link: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6 },
  linkText: { fontSize: 14, fontFamily: fonts.semibold, color: colors.brandPrimary },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 14, paddingVertical: 14, backgroundColor: colors.brandPrimary },
  btnText: { fontSize: 15, fontFamily: fonts.bold, color: colors.onBrandPrimary },
}));
