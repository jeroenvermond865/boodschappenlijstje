import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";

import { EmptyState, Icon } from "@/src/components/ui";
import { api } from "@/src/api";
import { goBack } from "@/src/nav";
import { GOLD } from "@/src/premium";
import { euro } from "@/src/search";
import { fonts, makeStyles, useTheme } from "@/src/theme";

type Parts = { promo: number; smart: number; pantry: number; promo_day: number; split?: number; standard: number; premium: number; saving: number; total: number };
type Month = Parts & { month: string; lists: { id: string; name: string; standard: number; premium: number; saving: number; total: number }[] };
type Savings = Parts & { months: Month[]; is_premium: boolean };

const monthName = (m: string) => new Date(`${m}-15T12:00:00`).toLocaleDateString("nl-NL", { month: "long", year: "numeric" });

export default function SavingsScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["savings"],
    queryFn: () => api<Savings>("/savings"),
  });
  const premium = !!data?.is_premium;
  const max = Math.max(0.01, ...(data?.months ?? []).map((m) => m.saving));

  const Line = ({ label, value, gold, strong }: { label: string; value: number; gold?: boolean; strong?: boolean }) => (
    <View style={styles.line}>
      <Text style={[styles.lineLabel, strong && styles.strong, gold && { color: GOLD.text }]}>{label}</Text>
      <Text style={[styles.lineValue, strong && styles.strong, gold && { color: GOLD.text }]}>{euro(value)}</Text>
    </View>
  );

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable testID="back-button" onPress={() => goBack("/")} hitSlop={10} style={styles.headerBtn}>
          <Icon name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Bespaaroverzicht</Text>
        <View style={styles.headerBtn} />
      </View>
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: insets.bottom + 24 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.brandPrimary} />}
      >
        {isLoading ? (
          <ActivityIndicator color={colors.brandPrimary} />
        ) : !(data?.months ?? []).length ? (
          <EmptyState icon="piggy-bank-outline" title="Nog niets te zien" subtitle="Open een boodschappenlijst. Daarna zie je hier wat de app je scheelt." />
        ) : (
          <>
            <View style={styles.hero} testID="savings-total">
              <Icon name="piggy-bank" size={30} color={colors.success} />
              <Text style={styles.heroLabel}>{premium ? "Totaal bespaard" : "Bespaard met de app"}</Text>
              <Text style={styles.heroValue}>{euro(data!.saving)}</Text>
              <Text style={styles.heroSub}>op {euro(data!.total)} aan boodschappen in de laatste 12 maanden</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Met de app</Text>
              <Line label="Aanbiedingen op je lijstjes" value={data!.promo} />
              <Line label="Alles bij de goedkoopste winkel" value={data!.smart} />
              <Line label="Samen" value={data!.standard} strong />
            </View>

            <View style={[styles.card, styles.gold]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Icon name="star" size={16} color={GOLD.icon} />
                <Text style={[styles.cardTitle, { color: GOLD.text }]}>{premium ? "Extra met Premium" : "Extra met Premium had je kunnen besparen"}</Text>
              </View>
              <Line label="Al in je voorraadkast" value={data!.pantry} gold />
              <Line label="Slim splitsen over winkels" value={data!.split ?? 0} gold />
              <Line label="Acties op je boodschappendag" value={data!.promo_day} gold />
              <Line label="Samen" value={data!.premium} gold strong />
              {premium ? (
                <Line label="Totaal bespaard" value={data!.saving} gold strong />
              ) : (
                <Pressable onPress={() => router.push("/premium")} style={styles.goldBtn}>
                  <Text style={styles.goldBtnText}>Meer over Premium</Text>
                </Pressable>
              )}
            </View>

            {data!.months.map((m) => (
              <View key={m.month} style={styles.card}>
                <View style={styles.monthHead}>
                  <Text style={styles.month}>{monthName(m.month)}</Text>
                  <Text style={styles.monthSaving}>{euro(m.saving)}</Text>
                </View>
                <View style={styles.barTrack}>
                  <View style={[styles.bar, { width: `${Math.max(2, (m.saving / max) * 100)}%` }]} />
                </View>
                {m.lists.map((l) => (
                  <Pressable key={l.id} onPress={() => router.push({ pathname: "/shopping/[id]", params: { id: l.id } })} style={styles.listRow}>
                    <Text style={styles.listName} numberOfLines={1}>
                      {l.name}
                    </Text>
                    <Text style={styles.listMeta}>
                      {euro(l.saving)} van {euro(l.total)}
                      {!premium && l.premium > 0 ? ` · +${euro(l.premium)} met Premium` : ""}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ))}
            <Text style={styles.small}>
              We tellen de korting van aanbiedingen en wat je scheelt door alles bij de goedkoopste winkel te halen. Met Premium ook slim splitsen over
              winkels, wat je al in je voorraadkast hebt en de acties op de dag dat je boodschappen doet. Het overzicht wordt bijgewerkt als je een lijst opent. De prijs in de winkel is
              altijd leidend.
            </Text>
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
  hero: { alignItems: "center", gap: 4, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: 20, padding: 20 },
  heroLabel: { fontSize: 14, fontFamily: fonts.medium, color: colors.onSurfaceSecondary },
  heroValue: { fontSize: 32, fontFamily: fonts.bold, color: colors.success },
  heroSub: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted, textAlign: "center" },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 14, gap: 8 },
  gold: { backgroundColor: GOLD.bg, borderColor: GOLD.border },
  cardTitle: { fontSize: 15, fontFamily: fonts.bold, color: colors.onSurface, flexShrink: 1 },
  line: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  lineLabel: { flex: 1, fontSize: 14, fontFamily: fonts.regular, color: colors.onSurfaceSecondary },
  lineValue: { fontSize: 14, fontFamily: fonts.semibold, color: colors.onSurface },
  strong: { fontFamily: fonts.bold, color: colors.onSurface },
  goldBtn: { alignSelf: "flex-start", backgroundColor: GOLD.icon, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12, marginTop: 4 },
  goldBtnText: { fontSize: 13, fontFamily: fonts.bold, color: "#FFFFFF" },
  monthHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  month: { fontSize: 16, fontFamily: fonts.bold, color: colors.onSurface, textTransform: "capitalize" },
  monthSaving: { fontSize: 16, fontFamily: fonts.bold, color: colors.success },
  barTrack: { height: 8, borderRadius: 4, backgroundColor: colors.surfaceTertiary, overflow: "hidden" },
  bar: { height: 8, borderRadius: 4, backgroundColor: colors.success },
  listRow: { flexDirection: "row", justifyContent: "space-between", gap: 8, paddingVertical: 4 },
  listName: { flex: 1, fontSize: 14, fontFamily: fonts.medium, color: colors.onSurfaceSecondary },
  listMeta: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted, flexShrink: 1, textAlign: "right" },
  small: { fontSize: 12, lineHeight: 17, fontFamily: fonts.regular, color: colors.muted },
}));
