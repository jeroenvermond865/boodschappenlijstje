// "Bij Dirk € 2,49, hier € 1,99" aantikken: beide producten naast elkaar, en daaronder wat je nog meer kunt kiezen.
// Tik op een product: je ziet het hier groot, met Wissel en Terug. Ook producten bij de andere winkels kun je zo kiezen.
// Klopt de vergelijking niet, dan meld je dat; de app laat het nakijken (AI) en kiest daarna iets beters.
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

type AltProduct = Product & { note?: string | null; offer?: boolean };
type Alts = { groups: { store: string; same_store: boolean; products: AltProduct[] }[]; base: Product | null };
const SHORT: Record<string, string> = { "Albert Heijn": "AH", Jumbo: "Jumbo", Dirk: "Dirk" };

export type CompareItem = {
  name: string;
  product?: string;
  product_id?: string;
  price?: number;
  packs?: number;
  was?: { store: string; price: number; product_id?: string | null; product?: string | null };
};

export function PriceCompareSheet({
  item,
  store,
  onClose,
  onPick,
  onSearch,
}: {
  item: CompareItem | null;
  store: string;
  onClose: () => void;
  onPick: (p: Product) => Promise<void> | void;
  onSearch?: () => void; // zelf een ander product zoeken
}) {
  const [detail, setDetail] = useState<AltProduct | null>(null);
  const [reported, setReported] = useState(false);
  useEffect(() => {
    setDetail(null);
    setReported(false);
  }, [item?.name, item?.product_id]);
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const open = !!item;
  const was = item?.was;
  const alts = useQuery({
    queryKey: ["alternatives", item?.product_id ?? "", item?.name ?? ""],
    queryFn: () => api<Alts>(`/alternatives?name=${encodeURIComponent(item!.name)}&product_id=${encodeURIComponent(item!.product_id ?? "")}`),
    enabled: open,
    staleTime: 10 * 60 * 1000,
  });
  const otherQ = useQuery({
    queryKey: ["product", was?.product_id ?? ""],
    queryFn: () => api<Product>(`/products/${was!.product_id}`),
    enabled: open && !!was?.product_id,
    staleTime: 10 * 60 * 1000,
  });
  const groups = alts.data?.groups ?? [];
  const here = groups.find((g) => g.store === store)?.products ?? [];
  // Het product bij de andere winkel; bij oudere lijstjes weten we alleen de winkel, dan het beste voorstel daar
  // Bij oudere lijstjes kan het product onbekend zijn; dan tonen we alleen de prijs (geen gok, die klopt vaak niet)
  const other = otherQ.data ?? null;
  const base = alts.data?.base ?? null;
  const packs = item?.packs ?? 1;
  const diff = was && item?.price ? was.price - item.price : 0;

  const openProduct = (id: string) => {
    onClose();
    router.push({ pathname: "/product/[id]", params: { id } });
  };
  const report = async () => {
    setReported(true);
    try {
      await api("/compare/wrong", { method: "POST", body: { want: other?.name ?? item?.name ?? "", product_id: base?.id ?? "" } });
    } catch {
      // niet erg: het is een tip
    }
  };

  const Side = ({ label, p, total, cheaper }: { label: string; p: Product | null; total?: number; cheaper?: boolean }) => (
    <Pressable onPress={p ? () => setDetail(p as AltProduct) : undefined} style={[styles.side, cheaper && { borderColor: colors.success, borderWidth: 2 }]}>
      <Text style={[styles.sideLabel, cheaper && { color: colors.success }]}>{label}</Text>
      {p?.image ? <Image source={{ uri: p.image }} style={styles.bigImg} resizeMode="contain" /> : <View style={styles.bigImg} />}
      <Text style={styles.name} numberOfLines={3}>{p?.name ?? (otherQ.isLoading && was?.product_id ? "…" : "Product uit de vergelijking")}</Text>
      {p ? (
        <Text style={styles.meta} numberOfLines={2}>
          {p.unit}
          {p.unit_price ? ` · ${p.unit_price}` : ""}
        </Text>
      ) : null}
      {p && p.price > 0 ? <Text style={styles.meta}>Per stuk {euro(p.promo?.price ?? p.price)}</Text> : null}
      {total ? (
        <Text style={[styles.total, cheaper && { color: colors.success }]}>
          {packs > 1 ? `${packs}× · ` : ""}
          {euro(total)}
        </Text>
      ) : null}
      {p?.promo ? <Text style={[styles.meta, { color: colors.warning, fontFamily: fonts.semibold }]} numberOfLines={2}>{p.promo.label}</Text> : null}
    </Pressable>
  );

  const Row = ({ p, canPick }: { p: AltProduct; canPick: boolean }) => (
    <Pressable onPress={() => setDetail(p)} style={styles.row}>
      {p.image ? <Image source={{ uri: p.image }} style={styles.img} resizeMode="contain" /> : <View style={styles.img} />}
      <View style={{ flex: 1 }}>
        <Text style={styles.rowName} numberOfLines={2}>{p.name}</Text>
        <Text style={styles.meta} numberOfLines={1}>
          {p.unit}
          {p.unit_price ? ` · ${p.unit_price}` : ""}
        </Text>
        {p.note || p.promo ? (
          <Text style={[styles.meta, { color: p.promo ? colors.warning : colors.success, fontFamily: fonts.semibold }]} numberOfLines={1}>
            {p.promo?.label ?? p.note}
          </Text>
        ) : null}
      </View>
      <View style={{ alignItems: "flex-end", gap: 2 }}>
        <Text style={styles.price}>{p.price > 0 ? euro(p.promo?.price ?? p.price) : "—"}</Text>
        <Text style={[styles.meta, { color: colors.brandPrimary, fontFamily: fonts.semibold }]}>{canPick ? "Kies" : "Bekijk"}</Text>
      </View>
    </Pressable>
  );

  return (
    <Modal visible={open} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.head}>
            <Text style={styles.title} numberOfLines={1}>Vergelijken: {item?.name}</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Icon name="close" size={22} color={colors.onSurface} />
            </Pressable>
          </View>
          {detail ? (
            <ScrollView contentContainerStyle={{ gap: 10 }} testID="compare-detail">
              {detail.image ? <Image source={{ uri: detail.image }} style={styles.detailImg} resizeMode="contain" /> : null}
              <Text style={styles.sideLabel}>{detail.source ?? ""}</Text>
              <Text style={[styles.rowName, { fontSize: 18 }]}>{detail.name}</Text>
              <Text style={styles.meta}>
                {detail.unit}
                {detail.unit_price ? ` · ${detail.unit_price}` : ""}
              </Text>
              <Text style={styles.total}>{detail.price > 0 ? euro(detail.promo?.price ?? detail.price) : "—"}</Text>
              {detail.promo ? <Text style={[styles.meta, { color: colors.warning, fontFamily: fonts.semibold }]}>{detail.promo.label}</Text> : null}
              <View style={{ flexDirection: "row", gap: 8 }}>
                {detail.id !== base?.id ? (
                  <Pressable onPress={() => Promise.resolve(onPick(detail)).then(onClose)} style={[styles.btn, { backgroundColor: colors.brandPrimary }]} testID="compare-detail-swap">
                    <Icon name="swap-horizontal" size={18} color={colors.onBrandPrimary} />
                    <Text style={[styles.btnText, { color: colors.onBrandPrimary }]}>Wissel</Text>
                  </Pressable>
                ) : null}
                <Pressable onPress={() => setDetail(null)} style={[styles.btn, { backgroundColor: colors.surfaceSecondary }]} testID="compare-detail-back">
                  <Icon name="arrow-left" size={18} color={colors.onSurface} />
                  <Text style={[styles.btnText, { color: colors.onSurface }]}>Terug</Text>
                </Pressable>
              </View>
              <Pressable onPress={() => openProduct(detail.id)} hitSlop={6}>
                <Text style={[styles.meta, { color: colors.brandPrimary, fontFamily: fonts.semibold, textAlign: "center" }]}>Alles over dit product ›</Text>
              </Pressable>
            </ScrollView>
          ) : (
          <ScrollView contentContainerStyle={{ gap: 10 }}>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Side label={`Hier bij ${SHORT[store] ?? store}`} p={base} total={item?.price} cheaper={diff > 0} />
              {was ? <Side label={`Bij ${SHORT[was.store] ?? was.store}`} p={other} total={was.price} cheaper={diff < 0} /> : null}
            </View>
            {diff > 0 ? (
              <Text style={styles.diff}>
                Hier {euro(diff)} goedkoper voor wat je nodig hebt.
              </Text>
            ) : null}
            <View style={{ flexDirection: "row", gap: 8 }}>
              {onSearch ? (
                <Pressable onPress={() => { onClose(); onSearch(); }} style={[styles.btn, { backgroundColor: colors.surfaceSecondary }]} testID="compare-search">
                  <Icon name="magnify" size={18} color={colors.brandPrimary} />
                  <Text style={[styles.btnText, { color: colors.brandPrimary }]}>Zelf zoeken</Text>
                </Pressable>
              ) : null}
              {was && base ? (
                <Pressable onPress={report} disabled={reported} style={[styles.btn, { backgroundColor: colors.surfaceSecondary }]} testID="compare-wrong">
                  <Icon name={reported ? "check" : "alert-circle-outline"} size={18} color={reported ? colors.success : colors.warning} />
                  <Text style={[styles.btnText, { color: reported ? colors.success : colors.onSurface }]}>{reported ? "Bedankt, we kijken het na" : "Klopt niet"}</Text>
                </Pressable>
              ) : null}
            </View>

            {alts.isLoading ? (
              <ActivityIndicator color={colors.brandPrimary} />
            ) : (
              <>
                {here.length ? (
                  <View style={{ gap: 4 }}>
                    <Text style={styles.groupHead}>Andere keuzes bij {store}</Text>
                    <Text style={styles.meta}>Tik om te wisselen. Groen: per kilo of liter goedkoper, vaak een grotere verpakking.</Text>
                    {here.map((p) => <Row key={p.id} p={p} canPick />)}
                  </View>
                ) : null}
                {groups
                  .filter((g) => g.store !== store && g.products.length)
                  .map((g) => (
                    <View key={g.store} style={{ gap: 4 }}>
                      <Text style={styles.groupHead}>Bij {g.store}</Text>
                      {g.products.map((p) => <Row key={p.id} p={p} canPick={false} />)}
                    </View>
                  ))}
              </>
            )}
          </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center" },
  sheet: { backgroundColor: colors.surface, borderRadius: 20, width: "92%", maxWidth: 560, alignSelf: "center", marginVertical: "auto", maxHeight: "92%", padding: 16, gap: 10 },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  title: { flex: 1, fontSize: 18, fontFamily: fonts.bold, color: colors.onSurface },
  side: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 10, gap: 4, alignItems: "center" },
  sideLabel: { fontSize: 13, fontFamily: fonts.bold, color: colors.muted },
  bigImg: { width: 90, height: 90, borderRadius: 10, backgroundColor: "#fff" },
  total: { fontSize: 18, fontFamily: fonts.bold, color: colors.onSurface, marginTop: 2 },
  detailImg: { width: "100%", height: 170, borderRadius: 14, backgroundColor: "#fff" },
  btn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 8 },
  btnText: { fontSize: 14, fontFamily: fonts.bold },
  diff: { fontSize: 14, fontFamily: fonts.semibold, color: colors.success, textAlign: "center" },
  groupHead: { fontSize: 14, fontFamily: fonts.bold, color: colors.onSurface, marginTop: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, padding: 8, borderRadius: 12, backgroundColor: colors.surfaceSecondary },
  img: { width: 44, height: 44, borderRadius: 8, backgroundColor: "#fff" },
  name: { fontSize: 14, fontFamily: fonts.semibold, color: colors.onSurface, textAlign: "center" },
  rowName: { fontSize: 14, fontFamily: fonts.semibold, color: colors.onSurface },
  meta: { fontSize: 12, fontFamily: fonts.regular, color: colors.muted },
  price: { fontSize: 14, fontFamily: fonts.bold, color: colors.onSurface },
}));
