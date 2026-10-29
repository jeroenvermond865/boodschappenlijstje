// Een product als venster (bijv. vanaf de boodschappenlijst): foto, prijs, wat het bij de andere winkels kost,
// en meteen door naar wisselen. "Alles over dit product" opent de hele productpagina.
// Tik je op een product bij een andere winkel, dan zie je dat product hier, met Wissel en Terug.
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import Image from "@/src/components/SafeImage";
import Modal from "@/src/components/Modal";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";

import { Icon } from "@/src/components/ui";
import { api } from "@/src/api";
import { euro } from "@/src/search";
import { fonts, makeStyles, useTheme } from "@/src/theme";
import type { Product } from "@/src/ProductBrowser";

type Other = { store: string; product_id?: string; product: string | null; unit?: string; image?: string | null; price?: number; same?: boolean; unit_price?: string | null };

export function ProductPopup({
  productId,
  onClose,
  onSwap,
  onSwapTo,
  swapLabel = "Wisselen",
  onAdd,
  addLabel = "Op je lijst",
  extra,
}: {
  productId: string | null;
  onClose: () => void;
  onSwap?: () => void;
  onSwapTo?: (p: Product) => void; // meteen wisselen naar een product dat je hier hebt geopend
  swapLabel?: string;
  onAdd?: () => void;
  addLabel?: string;
  extra?: { label: string; icon: string; onPress: () => void; danger?: boolean }[]; // extra knopjes, bijv. bij Bijna op
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const open = !!productId;
  // Doorgeklikte producten (bij andere winkels); Terug gaat er één terug
  const [stack, setStack] = useState<string[]>([]);
  useEffect(() => setStack([]), [productId]);
  const cur = stack[stack.length - 1] ?? productId;
  const p = useQuery({ queryKey: ["product", cur ?? ""], queryFn: () => api<Product>(`/products/${cur}`), enabled: open && !!cur, staleTime: 10 * 60 * 1000 });
  const others = useQuery({
    queryKey: ["product-stores", productId ?? ""],
    queryFn: () => api<{ stores: Other[] }>(`/products/${productId}/stores`),
    enabled: open,
    staleTime: 10 * 60 * 1000,
  });
  const d = p.data;
  return (
    <Modal visible={open} animationType="fade" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]} onPress={() => {}}>
          <View style={styles.head}>
            {stack.length ? (
              <Pressable onPress={() => setStack((x) => x.slice(0, -1))} hitSlop={8} style={{ flexDirection: "row", alignItems: "center" }} testID="product-popup-back">
                <Icon name="chevron-left" size={22} color={colors.brandPrimary} />
                <Text style={styles.store}>Terug</Text>
              </Pressable>
            ) : null}
            <Text style={[styles.store, { flex: 1, textAlign: stack.length ? "center" : "left" }]}>{d?.source ?? ""}</Text>
            <Pressable onPress={onClose} hitSlop={8} testID="product-popup-close">
              <Icon name="close" size={22} color={colors.onSurface} />
            </Pressable>
          </View>
          {!d ? (
            <ActivityIndicator color={colors.brandPrimary} />
          ) : (
            <ScrollView contentContainerStyle={{ gap: 10 }}>
              {d.image ? <Image source={{ uri: d.image }} style={styles.img} resizeMode="contain" /> : null}
              <Text style={styles.name}>{d.name}</Text>
              <Text style={styles.meta}>
                {d.unit}
                {d.unit_price ? ` · ${d.unit_price}` : ""}
              </Text>
              <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
                <Text style={styles.price}>{d.price > 0 ? euro(d.promo?.price ?? d.price) : "—"}</Text>
                {d.promo ? <Text style={[styles.meta, { color: colors.warning, fontFamily: fonts.semibold }]}>{d.promo.label}</Text> : null}
              </View>
              {onAdd ? (
                <Pressable onPress={onAdd} style={[styles.btn, { backgroundColor: colors.brandPrimary, flex: 0 }]} testID="product-popup-add">
                  <Icon name="cart-plus" size={18} color={colors.onBrandPrimary} />
                  <Text style={[styles.btnText, { color: colors.onBrandPrimary }]}>{addLabel}</Text>
                </Pressable>
              ) : null}
              <View style={{ flexDirection: "row", gap: 8 }}>
                {stack.length && onSwapTo ? (
                  <Pressable onPress={() => onSwapTo(d)} style={[styles.btn, { backgroundColor: colors.brandPrimary }]} testID="product-popup-swap-to">
                    <Icon name="swap-horizontal" size={18} color={colors.onBrandPrimary} />
                    <Text style={[styles.btnText, { color: colors.onBrandPrimary }]}>Wissel naar dit product</Text>
                  </Pressable>
                ) : null}
                {stack.length ? (
                  <Pressable onPress={() => setStack((x) => x.slice(0, -1))} style={[styles.btn, { backgroundColor: colors.surfaceSecondary }]}>
                    <Icon name="arrow-left" size={18} color={colors.onSurface} />
                    <Text style={[styles.btnText, { color: colors.onSurface }]}>Terug</Text>
                  </Pressable>
                ) : null}
                {onSwap && !stack.length ? (
                  <Pressable onPress={onSwap} style={[styles.btn, { backgroundColor: colors.brandPrimary }]} testID="product-popup-swap">
                    <Icon name="swap-horizontal" size={18} color={colors.onBrandPrimary} />
                    <Text style={[styles.btnText, { color: colors.onBrandPrimary }]}>{swapLabel}</Text>
                  </Pressable>
                ) : null}
                {stack.length ? null : (
                <Pressable
                  onPress={() => {
                    onClose();
                    router.push({ pathname: "/product/[id]", params: { id: d.id } });
                  }}
                  style={[styles.btn, { backgroundColor: colors.surfaceSecondary }]}
                >
                  <Icon name="information-outline" size={18} color={colors.onSurface} />
                  <Text style={[styles.btnText, { color: colors.onSurface }]}>Alles over dit product</Text>
                </Pressable>
                )}
              </View>
              {extra?.length ? (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {extra.map((x) => (
                    <Pressable key={x.label} onPress={x.onPress} style={[styles.btn, { flex: 0, backgroundColor: colors.surfaceSecondary, paddingVertical: 9 }]}>
                      <Icon name={x.icon as any} size={16} color={x.danger ? colors.error : colors.onSurface} />
                      <Text style={[styles.btnText, { color: x.danger ? colors.error : colors.onSurface }]}>{x.label}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              {!stack.length && (others.data?.stores ?? []).some((o) => o.product) ? (
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>Bij andere winkels</Text>
                  {onSwapTo ? <Text style={styles.meta}>Tik op een product om het te bekijken of te wisselen.</Text> : null}
                  {(others.data?.stores ?? [])
                    .filter((o) => o.product)
                    .map((o) => (
                      <Pressable
                        key={o.store}
                        disabled={!o.product_id}
                        onPress={() => o.product_id && setStack((x) => [...x, o.product_id!])}
                        style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
                        testID={`product-popup-other-${o.store}`}
                      >
                        {o.image ? <Image source={{ uri: o.image }} style={styles.small} resizeMode="contain" /> : <View style={styles.small} />}
                        <View style={{ flex: 1 }}>
                          <Text style={styles.rowStore}>{o.store}</Text>
                          <Text style={styles.meta} numberOfLines={1}>
                            {o.same ? "" : "Vergelijkbaar: "}
                            {o.product}
                          </Text>
                        </View>
                        <View style={{ alignItems: "flex-end" }}>
                          <Text style={styles.rowPrice}>{o.price ? euro(o.price) : "—"}</Text>
                          {o.unit_price ? <Text style={styles.meta}>{o.unit_price}</Text> : null}
                        </View>
                        {o.product_id ? <Icon name="chevron-right" size={18} color={colors.muted} /> : null}
                      </Pressable>
                    ))}
                </View>
              ) : null}
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center" },
  sheet: { backgroundColor: colors.surface, borderRadius: 20, width: "92%", maxWidth: 520, alignSelf: "center", maxHeight: "90%", padding: 16, gap: 10 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  store: { fontSize: 13, fontFamily: fonts.bold, color: colors.brandPrimary },
  img: { width: "100%", height: 180, borderRadius: 14, backgroundColor: "#fff" },
  name: { fontSize: 20, fontFamily: fonts.bold, color: colors.onSurface },
  meta: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted },
  price: { fontSize: 24, fontFamily: fonts.bold, color: colors.onSurface },
  btn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 8 },
  btnText: { fontSize: 14, fontFamily: fonts.bold },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 12, gap: 8 },
  cardTitle: { fontSize: 15, fontFamily: fonts.bold, color: colors.onSurface },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  small: { width: 40, height: 40, borderRadius: 8, backgroundColor: "#fff" },
  rowStore: { fontSize: 14, fontFamily: fonts.semibold, color: colors.onSurface },
  rowPrice: { fontSize: 14, fontFamily: fonts.bold, color: colors.onSurface },
}));
