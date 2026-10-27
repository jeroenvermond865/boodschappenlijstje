// Beheer: live dashboard. Alleen aantallen en kosten, nooit namen of wat iemand op zijn lijstje heeft (privacy).
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import Animated, { FadeIn } from "react-native-reanimated";

import { Icon } from "@/src/components/ui";
import { api } from "@/src/api";
import { goBack } from "@/src/nav";
import { fonts, makeStyles, useTheme } from "@/src/theme";

type Stat = { avg: number; max: number; min: number };
type Dash = {
  days: number;
  users: { total: number; by_plan: Record<string, number>; new: number; active: { today: number; week: number; month: number } };
  made: { lists: number; dishes: number };
  use: { key: string; label: string; n: number }[];
  series: { day: string; active: number; ai: number; hits: number; cost: number }[];
  ai: {
    calls: number;
    hits: number;
    cost: number;
    month_estimate: number;
    tasks: { key: string; label: string; n: number; hits: number; cost: number }[];
    per_person: { people: number; cost: Stat; asks: Stat };
  };
  tasks: { key: string; label: string }[];
};

const PERIODS = [
  { d: 1, label: "Vandaag" },
  { d: 7, label: "7 dagen" },
  { d: 30, label: "30 dagen" },
  { d: 90, label: "90 dagen" },
];
const PLANS = [
  { k: "", label: "Iedereen" },
  { k: "standaard", label: "Standaard" },
  { k: "premium", label: "Premium" },
  { k: "ultra", label: "Ultra" },
];
const euro = (n: number, d = 2) => `€ ${n.toFixed(d).replace(".", ",")}`;

export default function AdminDashboardScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [days, setDays] = useState(7);
  const [plan, setPlan] = useState("");
  const [task, setTask] = useState("");

  // Live: elke 30 seconden opnieuw
  const { data, isLoading, dataUpdatedAt } = useQuery({
    queryKey: ["admin-dashboard", days, plan, task],
    queryFn: () => api<Dash>(`/admin/dashboard?days=${days}&plan=${plan}&task=${task}`),
    refetchInterval: 30 * 1000,
  });
  const maxCost = Math.max(0.0001, ...(data?.series ?? []).map((s) => s.cost));
  const maxActive = Math.max(1, ...(data?.series ?? []).map((s) => s.active));
  const maxUse = Math.max(1, ...(data?.use ?? []).map((u) => u.n));
  const pp = data?.ai.per_person;

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable testID="back-button" onPress={() => goBack("/account")} hitSlop={10} style={styles.headerBtn}>
          <Icon name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Dashboard</Text>
        <View style={styles.headerBtn} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32, gap: 14 }}>
        <Chips items={PERIODS.map((p) => ({ k: String(p.d), label: p.label }))} value={String(days)} onChange={(v) => setDays(Number(v))} />
        <Chips items={PLANS} value={plan} onChange={setPlan} />
        {isLoading || !data ? (
          <ActivityIndicator size="large" color={colors.brandPrimary} style={{ marginTop: 30 }} />
        ) : (
          <Animated.View entering={FadeIn} style={{ gap: 14 }}>
            <View style={styles.live}>
              <View style={styles.dot} />
              <Text style={styles.small}>Live · bijgewerkt {new Date(dataUpdatedAt).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}</Text>
            </View>

            <Text style={styles.section}>Gebruikers</Text>
            <View style={styles.tiles}>
              <Tile n={data.users.active.today} label="actief vandaag" />
              <Tile n={data.users.active.week} label="actief deze week" />
              <Tile n={data.users.active.month} label="actief deze maand" />
              <Tile n={data.users.new} label={`nieuw (${PERIODS.find((p) => p.d === days)?.label.toLowerCase()})`} />
            </View>
            <Text style={styles.small}>
              {data.users.total} accounts: {data.users.by_plan.standaard ?? 0} Standaard, {data.users.by_plan.premium ?? 0} Premium, {data.users.by_plan.ultra ?? 0} Ultra
            </Text>
            {days > 1 ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Actieve gebruikers per dag</Text>
                <Bars values={data.series.map((s) => s.active / maxActive)} color={colors.brandPrimary} />
              </View>
            ) : null}

            <Text style={styles.section}>Wat er gebeurt</Text>
            <View style={styles.tiles}>
              <Tile n={data.made.lists} label="lijstjes gemaakt" />
              <Tile n={data.made.dishes} label="eigen gerechten" />
            </View>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Meest gebruikt</Text>
              {data.use.length ? (
                data.use.map((u) => (
                  <View key={u.key} style={{ gap: 3 }}>
                    <View style={styles.rowBetween}>
                      <Text style={styles.body}>{u.label}</Text>
                      <Text style={styles.small}>{u.n}</Text>
                    </View>
                    <View style={styles.track}>
                      <View style={[styles.fill, { width: `${(u.n / maxUse) * 100}%` }]} />
                    </View>
                  </View>
                ))
              ) : (
                <Text style={styles.small}>Nog geen gegevens. Dit begint te tellen vanaf deze update.</Text>
              )}
            </View>

            <Text style={styles.section}>AI en kosten</Text>
            <Chips items={[{ k: "", label: "Alle taken" }, ...data.tasks.map((t) => ({ k: t.key, label: t.label.split(":")[0] }))]} value={task} onChange={setTask} />
            <View style={styles.tiles}>
              <Tile n={data.ai.calls} label="AI-vragen" />
              <Tile n={data.ai.hits} label="uit geheugen (gratis)" />
              <Tile text={euro(data.ai.cost)} label="kosten" />
              <Tile text={euro(data.ai.month_estimate)} label="per maand (schatting)" />
            </View>
            {days > 1 ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>AI-kosten per dag</Text>
                <Bars values={data.series.map((s) => s.cost / maxCost)} color={colors.brandSecondary} />
              </View>
            ) : null}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Per persoon ({pp?.people ?? 0} {pp?.people === 1 ? "persoon" : "personen"} met slimme hulp)</Text>
              <View style={styles.rowBetween}>
                <Text style={styles.small}> </Text>
                <Text style={[styles.small, styles.col]}>Gemiddeld</Text>
                <Text style={[styles.small, styles.col]}>Meeste</Text>
                <Text style={[styles.small, styles.col]}>Minste</Text>
              </View>
              <View style={styles.rowBetween}>
                <Text style={styles.body}>Kosten</Text>
                <Text style={[styles.body, styles.col]}>{euro(pp?.cost.avg ?? 0, 3)}</Text>
                <Text style={[styles.body, styles.col]}>{euro(pp?.cost.max ?? 0, 3)}</Text>
                <Text style={[styles.body, styles.col]}>{euro(pp?.cost.min ?? 0, 3)}</Text>
              </View>
              {!task ? (
                <View style={styles.rowBetween}>
                  <Text style={styles.body}>Vragen</Text>
                  <Text style={[styles.body, styles.col]}>{(pp?.asks.avg ?? 0).toFixed(1).replace(".", ",")}</Text>
                  <Text style={[styles.body, styles.col]}>{pp?.asks.max ?? 0}</Text>
                  <Text style={[styles.body, styles.col]}>{pp?.asks.min ?? 0}</Text>
                </View>
              ) : null}
              <Text style={styles.small}>Zonder namen. Zoeken, folders lezen en productcontrole tellen niet per persoon mee; die doet de app voor iedereen.</Text>
            </View>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Per taak</Text>
              {data.ai.tasks.length ? (
                data.ai.tasks.map((t) => (
                  <View key={t.key} style={styles.rowBetween}>
                    <Text style={[styles.body, { flex: 1 }]} numberOfLines={2}>{t.label}</Text>
                    <Text style={styles.small}>
                      {t.n}× · {t.hits} gratis · {euro(t.cost)}
                    </Text>
                  </View>
                ))
              ) : (
                <Text style={styles.small}>In deze periode geen AI gebruikt.</Text>
              )}
            </View>
            <Text style={styles.small}>
              Privacy: we tellen alleen hoe vaak iets gebruikt wordt. Wie er actief was, slaan we op als onherkenbare code en na ruim een jaar wordt het gewist.
            </Text>
          </Animated.View>
        )}
      </ScrollView>
    </View>
  );
}

function Chips({ items, value, onChange }: { items: { k: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  const styles = useStyles();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {items.map((i) => (
        <Pressable key={i.k || "all"} onPress={() => onChange(i.k)} style={[styles.chip, i.k === value && styles.chipOn]} testID={`dash-chip-${i.k || "all"}`}>
          <Text style={[styles.chipText, i.k === value && styles.chipTextOn]}>{i.label}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function Tile({ n, text, label }: { n?: number; text?: string; label: string }) {
  const styles = useStyles();
  return (
    <View style={styles.tile}>
      <Text style={styles.tileN}>{text ?? n ?? 0}</Text>
      <Text style={styles.small}>{label}</Text>
    </View>
  );
}

// Eenvoudige staafjes; het hoogste staafje is 100%
function Bars({ values, color }: { values: number[]; color: string }) {
  const styles = useStyles();
  return (
    <View style={styles.bars}>
      {values.map((v, i) => (
        <View key={i} style={styles.barSlot}>
          <View style={[styles.bar, { height: `${Math.max(2, v * 100)}%`, backgroundColor: color }]} />
        </View>
      ))}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 10, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.divider },
  headerBtn: { width: 44, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 18, fontFamily: fonts.bold, color: colors.onSurface },
  section: { fontSize: 13, fontFamily: fonts.bold, color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 6 },
  live: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  tile: { flexGrow: 1, flexBasis: "45%", borderRadius: 14, backgroundColor: colors.surfaceSecondary, padding: 12, gap: 2 },
  tileN: { fontSize: 22, fontFamily: fonts.bold, color: colors.onSurface },
  card: { borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 10 },
  cardTitle: { fontSize: 15, fontFamily: fonts.semibold, color: colors.onSurface },
  body: { fontSize: 14, fontFamily: fonts.regular, color: colors.onSurface },
  small: { fontSize: 12, lineHeight: 17, fontFamily: fonts.regular, color: colors.muted },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  col: { width: 76, textAlign: "right" },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceSecondary, overflow: "hidden" },
  fill: { height: 6, borderRadius: 3, backgroundColor: colors.brandPrimary },
  bars: { flexDirection: "row", alignItems: "flex-end", height: 90, gap: 2 },
  barSlot: { flex: 1, height: "100%", justifyContent: "flex-end" },
  bar: { borderRadius: 2, minHeight: 2 },
  chip: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { fontSize: 13, fontFamily: fonts.medium, color: colors.onSurfaceSecondary },
  chipTextOn: { color: colors.onBrandPrimary, fontFamily: fonts.semibold },
}));
