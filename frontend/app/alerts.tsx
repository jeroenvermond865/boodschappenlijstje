import { ActivityIndicator, Image, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { EmptyState, Icon } from "@/src/components/ui";
import { api } from "@/src/api";
import { goBack } from "@/src/nav";
import { PremiumLock, usePremium } from "@/src/premium";
import { euro } from "@/src/search";
import { fonts, makeStyles, useTheme } from "@/src/theme";

type A = {
  product_id: string;
  name?: string;
  image?: string;
  store?: string;
  unit?: string;
  on_promo: boolean;
  target: number | null;
  price: number;
  promo: number | null;
  promo_label?: string | null;
  hit: boolean;
  gone: boolean;
};

export default function AlertsScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const premium = usePremium();
  const { data, isLoading } = useQuery({
    queryKey: ["price-alerts"],
    queryFn: () => api<{ alerts: A[]; auto?: A[]; auto_on?: boolean }>("/price-alerts"),
    enabled: premium,
  });
  const qc = useQueryClient();
  const setAuto = useMutation({
    mutationFn: (on: boolean) => api("/price-alerts/auto", { method: "PUT", body: { on } }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["price-alerts"] }),
  });
  const autoOn = setAuto.isPending ? !!setAuto.variables : data?.auto_on ?? true;

  const row = (a: A, auto = false) => (
    <Pressable
      key={a.product_id}
      testID={`alert-${a.product_id}`}
      onPress={() => !a.gone && router.push({ pathname: "/product/[id]", params: { id: a.product_id } })}
      style={[styles.row, a.hit && styles.rowHit]}
    >
      {a.image ? <Image source={{ uri: a.image }} style={styles.img} resizeMode="contain" /> : <View style={styles.img} />}
      <View style={{ flex: 1 }}>
        <Text style={styles.name} numberOfLines={2}>
          {a.name ?? "Product bestaat niet meer"}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {[a.store, auto ? "vaak gekocht" : a.on_promo ? "bij aanbieding" : null, a.target ? `onder ${euro(a.target)}` : null].filter(Boolean).join(" · ")}
        </Text>
        {a.hit ? <Text style={styles.hit}>{a.promo_label ? `Nu: ${a.promo_label}` : "Nu goedkoper!"}</Text> : null}
      </View>
      <View style={{ alignItems: "flex-end" }}>
        {a.promo ? <Text style={styles.old}>{euro(a.price)}</Text> : null}
        <Text style={[styles.price, a.promo ? { color: colors.warning } : null]}>{a.price ? euro(a.promo ?? a.price) : "—"}</Text>
      </View>
    </Pressable>
  );
  const autoBlock = premium && data ? (
    <View style={{ gap: 10, marginTop: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Text style={styles.section}>Vaak gekocht</Text>
          <Text style={styles.intro}>Automatisch een seintje als iets wat je vaak op je lijst hebt in de aanbieding is.</Text>
        </View>
        <Switch testID="auto-alerts" value={autoOn} onValueChange={(v) => setAuto.mutate(v)} />
      </View>
      {autoOn && !(data.auto ?? []).length ? (
        <Text style={styles.meta}>Nog niets: zodra je een product in minstens twee lijstjes hebt, houden we het hier in de gaten.</Text>
      ) : null}
      {autoOn ? (data.auto ?? []).map((a) => row(a, true)) : null}
    </View>
  ) : null;

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable testID="back-button" onPress={() => goBack("/products")} hitSlop={10} style={styles.headerBtn}>
          <Icon name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Prijsalarmen</Text>
        <View style={styles.headerBtn} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: insets.bottom + 24 }}>
        {!premium ? (
          <PremiumLock title="Prijsalarm" text="Krijg een mail als een product in de aanbieding is of onder jouw prijs zakt." />
        ) : isLoading ? (
          <ActivityIndicator color={colors.brandPrimary} />
        ) : (
          <>
            {!(data?.alerts ?? []).length ? (
              <EmptyState
                icon="bell-outline"
                title="Nog geen eigen prijsalarmen"
                subtitle="Open een product bij Producten en tik op Prijsalarm instellen. Je krijgt dan een mail als het goedkoper wordt."
              />
            ) : (
              <>
                <Text style={styles.intro}>Na de dagelijkse prijsronde krijg je een mail als een van deze producten raak is.</Text>
                {(data?.alerts ?? []).map((a) => row(a))}
              </>
            )}
            {autoBlock}
          </>
        )}
      </ScrollView>
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
  section: { fontSize: 17, fontFamily: fonts.bold, color: colors.onSurface },
  intro: { fontSize: 14, lineHeight: 20, fontFamily: fonts.regular, color: colors.onSurfaceSecondary },
  row: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 12 },
  rowHit: { borderColor: colors.warning, borderWidth: 1.5 },
  img: { width: 48, height: 48, borderRadius: 10, backgroundColor: colors.surfaceTertiary },
  name: { fontSize: 15, fontFamily: fonts.semibold, color: colors.onSurface },
  meta: { fontSize: 12, fontFamily: fonts.regular, color: colors.muted, marginTop: 2 },
  hit: { fontSize: 13, fontFamily: fonts.bold, color: colors.warning, marginTop: 2 },
  old: { fontSize: 12, fontFamily: fonts.regular, color: colors.muted, textDecorationLine: "line-through" },
  price: { fontSize: 16, fontFamily: fonts.bold, color: colors.onSurface },
}));
