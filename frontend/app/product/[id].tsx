import { ActivityIndicator, Linking, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import Image from "@/src/components/SafeImage";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Icon } from "@/src/components/ui";
import { api } from "@/src/api";
import { goBack } from "@/src/nav";
import { AISLE_ICONS } from "@/src/constants";
import { fonts, makeStyles, useTheme } from "@/src/theme";
import { euro } from "@/src/search";
import { PriceAlertCard, PriceHistory } from "@/src/PriceTools";
import { PremiumLock, usePremium } from "@/src/premium";
import { sliceInfo } from "@/src/slices";
import { AddProductButtons } from "@/src/AddProductSheet";
import { BarcodeLink } from "@/src/ShopSwap";
import type { Product, Promo } from "@/app/(tabs)/products";

type Details = {
  source: string;
  url: string;
  description: string | null;
  unit_price: string | null;
  ingredients: string | null;
  allergens: string[];
  nutrition: { columns: string[]; rows: string[][] } | null;
  storage: string | null;
  usage: string | null;
  origin: string | null;
  nutriscore: string | null;
  labels: string[];
  diets: string[];
  extra: { label: string; value: string }[];
};

const NUTRI_COLORS: Record<string, string> = { A: "#038141", B: "#85BB2F", C: "#FECB02", D: "#EE8100", E: "#E63E11" };
const SITE_NAMES: Record<string, string> = { Dirk: "dirk.nl", "Albert Heijn": "ah.nl", Jumbo: "jumbo.com" };

export default function ProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const premium = usePremium();

  const product = useQuery({ queryKey: ["product", id], queryFn: () => api<Product>(`/products/${id}`) });
  const details = useQuery({
    queryKey: ["product-details", id],
    queryFn: () => api<Details>(`/products/${id}/details`),
    staleTime: 30 * 60 * 1000,
    retry: 1,
  });

  const toggleFavorite = useMutation({
    mutationFn: (p: Product) => api(`/products/${p.id}/favorite`, { method: p.is_favorite ? "DELETE" : "POST" }),
    onMutate: (p: Product) => qc.setQueryData(["product", id], { ...p, is_favorite: !p.is_favorite }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["product", id] });
      qc.invalidateQueries({ queryKey: ["products", "search"] });
    },
  });

  const p = product.data;
  const d = details.data;

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable testID="back-button" onPress={() => goBack("/products")} hitSlop={10} style={styles.headerBtn}>
          <Icon name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {p?.source ?? "Product"}
        </Text>
        {p ? (
          <Pressable testID="product-detail-fav" onPress={() => toggleFavorite.mutate(p)} hitSlop={10} style={styles.headerBtn}>
            <Icon name={p.is_favorite ? "star" : "star-outline"} size={24} color={p.is_favorite ? "#E8A317" : colors.muted} />
          </Pressable>
        ) : (
          <View style={styles.headerBtn} />
        )}
      </View>

      {product.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.brandPrimary} />
        </View>
      ) : !p ? (
        <View style={styles.center}>
          <Text style={styles.muted}>Product niet gevonden</Text>
        </View>
      ) : (
        <ScrollView
          refreshControl={<RefreshControl refreshing={product.isRefetching} onRefresh={() => { product.refetch(); details.refetch(); }} tintColor={colors.brandPrimary} />}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40, gap: 14 }}
        >
          <View style={styles.imageBox}>
            {p.image ? (
              <Image source={{ uri: p.image }} style={styles.image} resizeMode="contain" />
            ) : (
              <Icon name={(AISLE_ICONS[p.aisle] ?? "cart-outline") as any} size={64} color={colors.brandPrimary} />
            )}
          </View>

          <View style={{ gap: 4 }}>
            {p.brand ? <Text style={styles.brand}>{p.brand}</Text> : null}
            <Text style={styles.name}>{p.name}</Text>
            <Text style={styles.muted}>
              {p.unit} · {p.aisle}
              {p.subcategory ? ` › ${p.subcategory}` : ""}
            </Text>
          </View>

          {(() => {
            const si = sliceInfo(p.name, p.unit);
            return si ? (
              <View style={styles.sliceCard}>
                <Icon name="bread-slice-outline" size={20} color={colors.brandPrimary} />
                <Text style={styles.sliceText}>
                  Hier snijd je ongeveer {si.slices} plakjes van ({si.kind === "kaas" ? "20" : "15"} gram per plakje). Genoeg voor zo'n {si.sandwiches} broodjes met 1 plakje, of{" "}
                  {Math.floor(si.slices / 2)} met 2 plakjes.
                </Text>
              </View>
            ) : null;
          })()}

          <View style={styles.priceRow}>
            {p.promo?.regular && p.promo.regular > (p.promo.price ?? p.price) ? (
              <Text style={styles.oldPrice}>{euro(p.promo.regular)}</Text>
            ) : null}
            <Text style={[styles.price, p.promo && { color: colors.warning }]}>
              {(p.promo?.price ?? p.price) > 0 ? euro(p.promo?.price ?? p.price) : "—"}
            </Text>
            {d?.unit_price || p.unit_price ? <Text style={styles.unitPrice}>{d?.unit_price ?? p.unit_price}</Text> : null}
            {p.on_offer && !p.promo ? (
              <View style={styles.offerBadge}>
                <Text style={styles.offerText}>Aanbieding</Text>
              </View>
            ) : null}
          </View>

          {p.promo ? <PromoCard promo={p.promo} now /> : null}
          {p.promo_next ? <PromoCard promo={p.promo_next} now={false} /> : null}
          <AddProductButtons productId={p.id} productName={p.name} />
          <BarcodeLink productId={p.id} current={p.barcode} />

          {p.is_global ? <OtherStores productId={p.id} /> : null}

          {p.is_global && !premium ? (
            <PremiumLock plural title="Prijsalarm en prijsgeschiedenis" text="Krijg een mail als dit product in de aanbieding is, en zie of een aanbieding echt goed is." />
          ) : p.is_global ? (
            <>
              <PriceAlertCard productId={p.id} price={p.price} />
              <PriceHistory productId={p.id} />
            </>
          ) : null}

          {details.isLoading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator color={colors.brandPrimary} />
              <Text style={styles.muted}>Productinformatie ophalen bij {p.source ?? "de winkel"}…</Text>
            </View>
          ) : details.isError ? (
            <View style={styles.loadingBox}>
              <Text style={styles.muted}>{(details.error as any)?.message ?? "De productinformatie is nu niet op te halen."}</Text>
              <Pressable onPress={() => details.refetch()}>
                <Text style={styles.link}>Opnieuw proberen</Text>
              </Pressable>
            </View>
          ) : d ? (
            <>
              {d.nutriscore || d.labels.length ? (
                <View style={styles.chips}>
                  {d.nutriscore ? (
                    <View style={[styles.nutri, { backgroundColor: NUTRI_COLORS[d.nutriscore] ?? colors.muted }]}>
                      <Text style={styles.nutriText}>Nutri-Score {d.nutriscore}</Text>
                    </View>
                  ) : null}
                  {d.labels.map((l) => (
                    <View key={l} style={styles.chip}>
                      <Icon name="leaf" size={13} color={colors.brandPrimary} />
                      <Text style={styles.chipText}>{l}</Text>
                    </View>
                  ))}
                </View>
              ) : null}

              <Section title="Omschrijving" text={d.description} />
              <Section title="Ingrediënten" text={d.ingredients} />
              {d.allergens.length ? <Section title="Allergie-informatie" text={d.allergens.join("\n")} /> : null}

              {d.nutrition ? (
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>Voedingswaarden</Text>
                  <View style={styles.tableRow}>
                    {d.nutrition.columns.map((c, i) => (
                      <Text key={i} style={[styles.th, i === 0 ? styles.firstCol : styles.valCol]}>
                        {c}
                      </Text>
                    ))}
                  </View>
                  {d.nutrition.rows.map((r, ri) => {
                    const sub = r[0].startsWith("  ") || r[0].toLowerCase().startsWith("waarvan");
                    if (r.slice(1).every((c) => !c) && r[0].startsWith("*")) {
                      return (
                        <Text key={ri} style={[styles.muted, { paddingTop: 6 }]}>
                          {r[0]}
                        </Text>
                      );
                    }
                    return (
                      <View key={ri} style={[styles.tableRow, ri % 2 === 0 && styles.tableRowAlt]}>
                        {r.map((c, i) => (
                          <Text
                            key={i}
                            style={[styles.td, i === 0 ? styles.firstCol : styles.valCol, i === 0 && sub && styles.subRow]}
                          >
                            {i === 0 ? c.trim() : c}
                          </Text>
                        ))}
                      </View>
                    );
                  })}
                </View>
              ) : null}

              {d.diets.length ? (
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>Dieet en allergieën</Text>
                  <View style={styles.chips}>
                    {d.diets.map((x) => (
                      <View key={x} style={styles.chip}>
                        <Icon name="check" size={13} color={colors.brandPrimary} />
                        <Text style={styles.chipText}>{x}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}

              <Section title="Bewaren" text={d.storage} />
              <Section title="Gebruik en bereiding" text={d.usage} />
              <Section title="Herkomst" text={d.origin} />

              {d.extra.length ? (
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>Overige informatie</Text>
                  {d.extra.map((e) => (
                    <View key={e.label} style={{ gap: 2 }}>
                      <Text style={styles.extraLabel}>{e.label}</Text>
                      <Text style={styles.body}>{e.value}</Text>
                    </View>
                  ))}
                </View>
              ) : null}

              {p.barcode ? <Text style={styles.muted}>Barcode: {p.barcode}</Text> : null}

              {d.url ? (
                <Pressable testID="product-open-site" onPress={() => Linking.openURL(d.url)} style={styles.siteBtn}>
                  <Icon name="open-in-new" size={18} color={colors.brandPrimary} />
                  <Text style={styles.siteText}>Bekijk op {SITE_NAMES[d.source] ?? "de site"}</Text>
                </Pressable>
              ) : null}
            </>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

function PromoCard({ promo, now }: { promo: Promo; now: boolean }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={[styles.promoCard, !now && { borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary }]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={[styles.offerBadge, !now && { backgroundColor: colors.brandPrimary }]}>
          <Text style={styles.offerText}>{promo.label}</Text>
        </View>
        <Text style={styles.promoWhen}>{now ? (promo.period ? `Geldig ${promo.period}` : "Nu in de aanbieding") : `Binnenkort: ${promo.period ?? ""}`}</Text>
      </View>
      {promo.title ? <Text style={styles.body}>{promo.title}</Text> : null}
      {promo.deal && promo.deal.count > 1 ? (
        <Text style={styles.promoDeal}>
          Bij {promo.deal.count} stuks betaal je {euro(promo.deal.total)}, dus {euro(promo.deal.each)} per stuk.
        </Text>
      ) : promo.deal && promo.deal.count === 1 && !promo.price ? (
        <Text style={styles.promoDeal}>Met korting: {euro(promo.deal.each)}</Text>
      ) : null}
      {promo.combinable ? <Text style={styles.muted}>Je mag verschillende producten uit deze actie combineren.</Text> : null}
      {promo.note ? <Text style={styles.muted}>{promo.note}</Text> : null}
    </View>
  );
}

type StoreRow = {
  store: string;
  product: string | null;
  product_id?: string;
  unit?: string;
  image?: string | null;
  price?: number;
  same?: boolean;
  unit_price?: string | null;
  diff?: number | null;
  promo?: Promo | null;
  promo_next?: Promo | null;
};

// Wat kost dit (of iets vergelijkbaars) bij de andere winkels?
function OtherStores({ productId }: { productId: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const q = useQuery({
    queryKey: ["product-stores", productId],
    queryFn: () => api<{ stores: StoreRow[] }>(`/products/${productId}/stores`),
    staleTime: 10 * 60 * 1000,
  });
  const rows = q.data?.stores ?? [];
  if (q.isLoading || !rows.length) return null;
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Bij andere winkels</Text>
      {rows.map((r) => (
        <Pressable
          key={r.store}
          disabled={!r.product_id}
          onPress={() => r.product_id && router.push(`/product/${r.product_id}`)}
          style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
        >
          {r.image ? (
            <Image source={{ uri: r.image }} style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: "#fff" }} resizeMode="contain" />
          ) : (
            <View style={{ width: 40, height: 40 }} />
          )}
          <View style={{ flex: 1 }}>
            <Text style={[styles.body, { fontFamily: fonts.semibold }]}>{r.store}</Text>
            {r.promo ? (
              <Text style={{ fontSize: 12, fontFamily: fonts.semibold, color: colors.warning }} numberOfLines={1}>
                Actie: {r.promo.label}{r.promo.period ? ` · ${r.promo.period}` : ""}
              </Text>
            ) : null}
            {r.promo_next ? (
              <Text style={{ fontSize: 12, fontFamily: fonts.semibold, color: colors.success }} numberOfLines={2}>
                Binnenkort: {r.promo_next.label}{r.promo_next.price ? ` voor ${euro(r.promo_next.price)}` : ""}{r.promo_next.period ? ` (${r.promo_next.period})` : ""}
              </Text>
            ) : null}
            <Text style={styles.muted} numberOfLines={1}>
              {!r.product ? "Niet gevonden" : r.same ? `Zelfde product${r.unit ? ` · ${r.unit}` : ""}` : `Vergelijkbaar: ${r.product}${r.unit ? ` · ${r.unit}` : ""}`}
            </Text>
          </View>
          {r.price != null ? (
            <View style={{ alignItems: "flex-end" }}>
              {r.promo?.regular && r.promo.regular > r.price ? <Text style={styles.oldPrice}>{euro(r.promo.regular)}</Text> : null}
              <Text style={[styles.body, { fontFamily: fonts.bold }, r.promo && { color: colors.warning }]}>{euro(r.price)}</Text>
              {r.diff != null && Math.abs(r.diff) >= 0.01 ? (
                <Text style={{ fontSize: 12, fontFamily: fonts.semibold, color: r.diff < 0 ? colors.success : colors.muted }}>
                  {r.diff < 0 ? `${euro(-r.diff)} goedkoper` : `${euro(r.diff)} duurder`}
                </Text>
              ) : r.unit_price ? (
                <Text style={styles.muted}>{r.unit_price}</Text>
              ) : null}
            </View>
          ) : null}
        </Pressable>
      ))}
    </View>
  );
}

function Section({ title, text }: { title: string; text: string | null }) {
  const styles = useStyles();
  if (!text) return null;
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.body}>{text}</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  headerBtn: { width: 44, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 18, fontFamily: fonts.bold, color: colors.onSurface },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  imageBox: { height: 220, borderRadius: 16, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  image: { width: "90%", height: "90%" },
  brand: { fontSize: 13, fontFamily: fonts.semibold, color: colors.brandPrimary, textTransform: "uppercase", letterSpacing: 0.5 },
  name: { fontSize: 22, fontFamily: fonts.bold, color: colors.onSurface },
  muted: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted },
  priceRow: { flexDirection: "row", alignItems: "baseline", flexWrap: "wrap", gap: 10 },
  price: { fontSize: 26, fontFamily: fonts.bold, color: colors.onSurface },
  unitPrice: { fontSize: 14, fontFamily: fonts.medium, color: colors.muted },
  oldPrice: { fontSize: 16, fontFamily: fonts.regular, color: colors.muted, textDecorationLine: "line-through" },
  promoCard: { borderWidth: 1, borderColor: colors.warning, borderRadius: 16, padding: 14, gap: 6 },
  promoWhen: { flex: 1, fontSize: 13, fontFamily: fonts.medium, color: colors.onSurface },
  promoDeal: { fontSize: 14, fontFamily: fonts.semibold, color: colors.onSurface },
  offerBadge: { backgroundColor: colors.warning, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  offerText: { fontSize: 12, fontFamily: fonts.semibold, color: "#fff" },
  loadingBox: { alignItems: "center", gap: 10, padding: 20 },
  link: { fontSize: 14, fontFamily: fonts.semibold, color: colors.brandPrimary },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: colors.brandTertiary },
  chipText: { fontSize: 12, fontFamily: fonts.medium, color: colors.onSurface },
  nutri: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  nutriText: { fontSize: 12, fontFamily: fonts.bold, color: "#fff" },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 14, gap: 8 },
  cardTitle: { fontSize: 16, fontFamily: fonts.bold, color: colors.onSurface },
  body: { fontSize: 14, lineHeight: 20, fontFamily: fonts.regular, color: colors.onSurface },
  tableRow: { flexDirection: "row", paddingVertical: 6, paddingHorizontal: 4, gap: 6 },
  tableRowAlt: { backgroundColor: colors.surfaceSecondary, borderRadius: 6 },
  th: { fontSize: 12, fontFamily: fonts.semibold, color: colors.muted },
  td: { fontSize: 13, fontFamily: fonts.regular, color: colors.onSurface },
  firstCol: { flex: 2 },
  valCol: { flex: 1, textAlign: "right" },
  subRow: { paddingLeft: 12, color: colors.muted },
  extraLabel: { fontSize: 12, fontFamily: fonts.semibold, color: colors.muted },
  siteBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 13, borderRadius: 12, borderWidth: 1, borderColor: colors.brandPrimary },
  siteText: { fontSize: 15, fontFamily: fonts.semibold, color: colors.brandPrimary },
  sliceCard: { flexDirection: "row", gap: 10, alignItems: "flex-start", backgroundColor: colors.surfaceSecondary, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: colors.border },
  sliceText: { flex: 1, fontSize: 13, lineHeight: 19, fontFamily: fonts.regular, color: colors.onSurfaceSecondary },
}));
