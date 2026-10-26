import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";

import { EmptyState, Icon } from "@/src/components/ui";
import { api } from "@/src/api";
import { goBack } from "@/src/nav";
import { GOLD, PremiumLock, usePremium } from "@/src/premium";
import { euro } from "@/src/search";
import { fonts, makeStyles, useTheme } from "@/src/theme";

type Month = { month: string; saving: number; total: number; lists: { id: string; name: string; saving: number; total: number }[] };

const monthName = (m: string) => new Date(`${m}-15T12:00:00`).toLocaleDateString("nl-NL", { month: "long", year: "numeric" });

export default function SavingsScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const premium = usePremium();
  const { data, isLoading } = useQuery({
    queryKey: ["savings"],
    queryFn: () => api<{ months: Month[]; saving: number; total: number }>("/savings"),
    enabled: premium,
  });
  const max = Math.max(0.01, ...(data?.months ?? []).map((m) => m.saving));

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable testID="back-button" onPress={() => goBack("/")} hitSlop={10} style={styles.headerBtn}>
          <Icon name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Bespaaroverzicht</Text>
        <View style={styles.headerBtn} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: insets.bottom + 24 }}>
        {!premium ? (
          <PremiumLock title="Het bespaaroverzicht" text="Zie per maand hoeveel je bespaart door aanbiedingen op je boodschappenlijsten." />
        ) : isLoading ? (
          <ActivityIndicator color={colors.brandPrimary} />
        ) : !(data?.months ?? []).length ? (
          <EmptyState icon="piggy-bank-outline" title="Nog niets te zien" subtitle="Open een boodschappenlijst. Daarna zie je hier wat de aanbiedingen je schelen." />
        ) : (
          <>
            <View style={styles.hero} testID="savings-total">
              <Icon name="piggy-bank" size={30} color={GOLD.icon} />
              <Text style={styles.heroLabel}>Bespaard met aanbiedingen</Text>
              <Text style={styles.heroValue}>{euro(data!.saving)}</Text>
              <Text style={styles.heroSub}>op {euro(data!.total)} aan boodschappen in de laatste 12 maanden</Text>
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
                    </Text>
                  </Pressable>
                ))}
              </View>
            ))}
            <Text style={styles.small}>
              We tellen de korting van aanbiedingen op je lijsten (zoals 1+1 gratis of een lagere prijs). Het overzicht wordt bijgewerkt als je een lijst opent. De
              prijs in de winkel is altijd leidend.
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
  hero: { alignItems: "center", gap: 4, backgroundColor: GOLD.bg, borderColor: GOLD.border, borderWidth: 1, borderRadius: 20, padding: 20 },
  heroLabel: { fontSize: 14, fontFamily: fonts.medium, color: GOLD.text },
  heroValue: { fontSize: 32, fontFamily: fonts.bold, color: GOLD.text },
  heroSub: { fontSize: 13, fontFamily: fonts.regular, color: GOLD.text, textAlign: "center" },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 14, gap: 8 },
  monthHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  month: { fontSize: 16, fontFamily: fonts.bold, color: colors.onSurface, textTransform: "capitalize" },
  monthSaving: { fontSize: 16, fontFamily: fonts.bold, color: colors.success },
  barTrack: { height: 8, borderRadius: 4, backgroundColor: colors.surfaceTertiary, overflow: "hidden" },
  bar: { height: 8, borderRadius: 4, backgroundColor: colors.success },
  listRow: { flexDirection: "row", justifyContent: "space-between", gap: 8, paddingVertical: 4 },
  listName: { flex: 1, fontSize: 14, fontFamily: fonts.medium, color: colors.onSurfaceSecondary },
  listMeta: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted },
  small: { fontSize: 12, lineHeight: 17, fontFamily: fonts.regular, color: colors.muted },
}));
