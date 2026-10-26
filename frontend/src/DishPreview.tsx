// Een gerecht of online recept als venster: foto, wat erin zit en de bereiding, met knoppen eronder
// (bijv. "Toevoegen" en "Terug" bij het kiezen, of "Gerecht openen" en "Aanpassen" in je lijstje).
import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from "react-native";
import Modal from "@/src/components/Modal";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";

import { Icon } from "@/src/components/ui";
import { api } from "@/src/api";
import { CATEGORY_LABELS, MealCategory, formatQty } from "@/src/constants";
import { fonts, makeStyles, useTheme } from "@/src/theme";
import type { Dish } from "@/app/(tabs)/dishes";
import type { RecipeTile } from "@/src/OnlineRecipes";
import type { Product } from "@/src/ProductBrowser";

export type PreviewAction = { label: string; icon?: string; onPress: () => void; primary?: boolean; testID?: string };
export type PreviewTarget = { dish: Dish } | { recipe: RecipeTile };

// Wisseltip van de site ("Liever vlees? Vervang de vega gyros door gyros") met het product om naar te wisselen
export type AltSwap = { index: number; label: string; from: string; to: string; text: string; product: Product };
type RecipeDetail = {
  title: string;
  image?: string | null;
  description?: string | null;
  tip?: string | null;
  time?: number | null;
  servings?: number | null;
  steps: string[];
  ingredients: { text: string; name: string; product?: Product | null }[];
  alt_swaps?: AltSwap[];
};

// Het product in een gerecht dat bij een wisseltip hoort (op naam, anders op volgorde)
export function dishProductFor(dish: Dish, s: AltSwap): string | null {
  const words = s.from.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const hit =
    dish.ingredients.find((i) => words.every((w) => i.name.toLowerCase().includes(w))) ??
    dish.ingredients.find((i) => words.some((w) => i.name.toLowerCase().includes(w) && w.length > 3));
  return hit?.product_id ?? null;
}

export function AltSwapList({ swaps, done, onSwap }: { swaps: AltSwap[]; done: (s: AltSwap) => boolean; onSwap: (s: AltSwap) => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  if (!swaps.length) return null;
  return (
    <View style={{ gap: 8 }}>
      {swaps.map((s) => {
        const on = done(s);
        return (
          <View key={`${s.index}-${s.to}`} style={styles.swap}>
            {s.product.image ? <Image source={{ uri: s.product.image }} style={styles.swapImg} resizeMode="contain" /> : null}
            <View style={{ flex: 1 }}>
              <Text style={styles.swapTitle}>{s.label}?</Text>
              <Text style={styles.meta} numberOfLines={2}>
                {s.from} vervangen door {s.product.name}
              </Text>
            </View>
            <Pressable onPress={() => onSwap(s)} style={[styles.swapBtn, on && { backgroundColor: colors.success }]} testID={`alt-swap-${s.index}`}>
              <Text style={styles.swapBtnText}>{on ? "Gewisseld" : "Vervangen"}</Text>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

// Het volledige scherm van een gerecht, zoals bij Gerechten: online recepten openen als recept, de rest als gerecht
export function fullDishRoute(d: Pick<Dish, "id" | "source">) {
  const rid = d.source?.recipe_id;
  return rid ? { pathname: "/recipe/[id]" as const, params: { id: rid.replace(":", "-") } } : { pathname: "/dish/edit" as const, params: { id: d.id } };
}

export function DishPreview({
  target,
  onClose,
  actions,
  swapDone,
  onAltSwap,
}: {
  target: PreviewTarget | null;
  onClose: () => void;
  actions: PreviewAction[];
  swapDone?: (s: AltSwap) => boolean;
  onAltSwap?: (s: AltSwap) => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const dish = target && "dish" in target ? target.dish : null;
  const tile = target && "recipe" in target ? target.recipe : null;
  const rid = tile?.id ?? dish?.source?.recipe_id ?? null;
  const rec = useQuery({
    queryKey: ["recipe", (rid ?? "").replace(":", "-")],
    queryFn: () => api<RecipeDetail>(`/recipes/detail?id=${encodeURIComponent(rid!.replace(":", "-"))}`),
    enabled: !!rid,
    staleTime: 30 * 60 * 1000,
    retry: 1,
  });
  const title = dish?.name ?? tile?.title ?? rec.data?.title ?? "";
  const image = dish?.image ?? tile?.image ?? rec.data?.image ?? null;
  const steps = rec.data?.steps ?? [];

  return (
    <Modal visible={!!target} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 14 }]}>
          <View style={styles.head}>
            <Pressable onPress={onClose} hitSlop={8} style={styles.back} testID="preview-back">
              <Icon name="chevron-left" size={24} color={colors.brandPrimary} />
              <Text style={styles.backText}>Terug</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ gap: 10, paddingBottom: 8 }}>
            {image ? <Image source={{ uri: image }} style={styles.img} resizeMode="cover" /> : null}
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.meta}>
              {[
                dish ? CATEGORY_LABELS[dish.category as MealCategory] : null,
                tile?.time || rec.data?.time ? `${tile?.time ?? rec.data?.time} min` : null,
                rec.data?.servings ? `${rec.data.servings} personen` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </Text>
            {rec.data?.description ? <Text style={styles.line}>{rec.data.description}</Text> : null}
            {onAltSwap ? <AltSwapList swaps={rec.data?.alt_swaps ?? []} done={swapDone ?? (() => false)} onSwap={onAltSwap} /> : null}

            <Text style={styles.sub}>Wat heb je nodig{dish ? " (per volwassene)" : ""}</Text>
            {dish ? (
              dish.ingredients.map((i, k) => (
                <Text key={`${i.name}-${k}`} style={styles.line}>
                  • {i.name}
                  {i.qty_adult ? ` · ${formatQty(i.qty_adult)} ${i.unit}` : ""}
                </Text>
              ))
            ) : rec.isLoading ? (
              <ActivityIndicator color={colors.brandPrimary} />
            ) : (
              (rec.data?.ingredients ?? []).map((i, k) => (
                <Text key={k} style={styles.line}>
                  • {i.text}
                </Text>
              ))
            )}
            {dish?.pantry?.length ? (
              <Text style={styles.meta}>Waarschijnlijk al in huis: {dish.pantry.map((p) => p.name).join(", ")}</Text>
            ) : null}

            <Text style={[styles.sub, { marginTop: 4 }]}>Bereiding</Text>
            {rid && rec.isLoading ? (
              <ActivityIndicator color={colors.brandPrimary} />
            ) : steps.length ? (
              steps.map((st, k) => (
                <View key={k} style={{ flexDirection: "row", gap: 8 }}>
                  <Text style={styles.stepNo}>{k + 1}</Text>
                  <Text style={[styles.line, { flex: 1 }]}>{st}</Text>
                </View>
              ))
            ) : (
              <Text style={styles.meta}>Bij dit gerecht staat geen bereiding.</Text>
            )}
          </ScrollView>
          <View style={{ gap: 8 }}>
            {actions.map((a) => (
              <Pressable key={a.label} onPress={a.onPress} style={[styles.btn, a.primary ? styles.btnPrimary : styles.btnSecondary]} testID={a.testID}>
                {a.icon ? <Icon name={a.icon as any} size={20} color={a.primary ? colors.onBrandPrimary : colors.brandPrimary} /> : null}
                <Text style={[styles.btnText, { color: a.primary ? colors.onBrandPrimary : colors.brandPrimary }]}>{a.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center" },
  sheet: { backgroundColor: colors.surface, borderRadius: 20, width: "92%", maxWidth: 560, alignSelf: "center", height: "92%", padding: 16, gap: 10 },
  head: { flexDirection: "row", alignItems: "center" },
  back: { flexDirection: "row", alignItems: "center", gap: 2 },
  backText: { fontSize: 15, fontFamily: fonts.semibold, color: colors.brandPrimary },
  img: { width: "100%", height: 190, borderRadius: 14, backgroundColor: colors.brandTertiary },
  title: { fontSize: 20, fontFamily: fonts.bold, color: colors.onSurface },
  meta: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted },
  sub: { fontSize: 15, fontFamily: fonts.bold, color: colors.onSurface },
  line: { fontSize: 14, fontFamily: fonts.regular, color: colors.onSurface, lineHeight: 20 },
  stepNo: { fontSize: 14, fontFamily: fonts.bold, color: colors.brandPrimary, width: 18 },
  swap: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 14, backgroundColor: colors.brandTertiary },
  swapImg: { width: 44, height: 44, borderRadius: 8, backgroundColor: "#fff" },
  swapTitle: { fontSize: 14, fontFamily: fonts.bold, color: colors.onSurface },
  swapBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: colors.brandPrimary },
  swapBtnText: { fontSize: 13, fontFamily: fonts.bold, color: colors.onBrandPrimary },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 14, paddingVertical: 13 },
  btnPrimary: { backgroundColor: colors.brandPrimary },
  btnSecondary: { backgroundColor: colors.brandTertiary },
  btnText: { fontSize: 15, fontFamily: fonts.bold },
}));
