// Eén extra functie: wat hij doet, altijd met een bewegend voorbeeld. Heb je hem, dan onderaan "Bekijk in mijn app"
// (slim splitsen, looproute en weekmenu in je eerstvolgende lijstje). Kan dat nog niet, dan geen knop maar
// "Je moet eerst een lijstje aanmaken". Heb je hem niet, dan een slotje en een knop om het abonnement te nemen.
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, Icon } from "@/src/components/ui";
import { goBack } from "@/src/nav";
import { api } from "@/src/api";
import { PLAN_NAME, PREMIUM_FEATURES, planAccent, planIcon, useFeature, usePlanOf, type FeatureKey } from "@/src/premium";
import { TutorialDemo, type DemoKind } from "@/src/TutorialDemos";
import { FeatureDemo } from "@/src/FeatureDemos";
import { fonts, makeStyles, useTheme } from "@/src/theme";

// Functies met een voorbeeld uit "Zo werkt de app"; de rest heeft een eigen voorbeeld (src/FeatureDemos)
const DEMO: Partial<Record<FeatureKey, DemoKind>> = {
  slimme_hulp: "slim",
  weekmenu: "plannen",
};

// Functies die in een lijstje werken: waar je heen gaat
const IN_LIST: Partial<Record<FeatureKey, (id: string) => string>> = {
  slim_splitsen: (id) => `/shopping/${id}`,
  looproute: (id) => `/shopping/${id}?route=1`,
  weekmenu: (id) => `/camp/${id}?menu=1`,
};

type CampLite = { id: string; start_date?: string | null; days?: unknown[]; daily?: boolean; archived?: boolean; created_at?: string | null };

// Het eerstvolgende lijstje: dat nu loopt of als eerste begint; zonder datum het nieuwste
function nextList(camps: CampLite[]): CampLite | null {
  const today = new Date().toISOString().slice(0, 10);
  const own = camps.filter((c) => !c.daily && !c.archived);
  const end = (c: CampLite) => {
    const d = new Date(`${c.start_date}T12:00:00`);
    d.setDate(d.getDate() + Math.max(0, (c.days?.length ?? 1) - 1));
    return d.toISOString().slice(0, 10);
  };
  const dated = own.filter((c) => c.start_date && end(c) >= today).sort((a, b) => (a.start_date! < b.start_date! ? -1 : 1));
  if (dated.length) return dated[0];
  const undated = own.filter((c) => !c.start_date).sort((a, b) => ((a.created_at ?? "") < (b.created_at ?? "") ? 1 : -1));
  return undated[0] ?? null;
}

export default function FeatureScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { key } = useLocalSearchParams<{ key: string }>();
  const f = PREMIUM_FEATURES.find((x) => x.key === key);
  const has = useFeature((f?.key ?? "prijsalarm") as FeatureKey);
  const plan = usePlanOf(f?.key);
  const c = planAccent(plan);

  const inList = f ? IN_LIST[f.key] : undefined;
  const camps = useQuery({ queryKey: ["camps"], queryFn: () => api<{ camps: CampLite[] }>("/camps"), enabled: !!inList && has });
  const next = camps.data ? nextList(camps.data.camps) : null;

  if (!f) return null;
  const demo = DEMO[f.key];
  // Waar "Bekijk in mijn app" heen gaat; null = kan (nog) niet
  const target = !has ? null : inList ? (next ? inList(next.id) : null) : f.to ?? null;
  const noList = has && !!inList && camps.isSuccess && !next;
  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable testID="back-button" onPress={() => goBack("/premium")} hitSlop={10} style={styles.headerBtn}>
          <Icon name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>{f.title}</Text>
        <View style={styles.headerBtn} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: insets.bottom + 24, width: "100%", maxWidth: 640, alignSelf: "center" }}>
        <View style={[styles.lock, { backgroundColor: c.bg, borderColor: c.border }]} testID={has ? "feature-info" : "feature-lock"}>
          <View style={[styles.lockIcon, { backgroundColor: c.icon }]}>
            <Icon name={has ? f.icon : "lock-outline"} size={22} color="#FFFFFF" />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Icon name={planIcon(plan)} size={16} color={c.icon} />
              <Text style={[styles.lockTitle, { color: c.text }]}>{has ? `${f.title} · ${PLAN_NAME[plan]}` : `${f.title} is een ${PLAN_NAME[plan]}-functie`}</Text>
            </View>
            <Text style={[styles.text, { color: c.text }]}>{f.text}</Text>
          </View>
        </View>

        {/* Altijd een bewegend voorbeeld: zo zie je in een paar tellen wat het doet */}
        <Text style={styles.section}>Zo werkt het</Text>
        {demo ? <TutorialDemo kind={demo} /> : <FeatureDemo k={f.key} accent={c.icon} />}
        {f.where ? <Text style={styles.muted}>In de app: {f.where}</Text> : null}

        {f.more?.length ? (
          <View style={{ gap: 8 }} testID="feature-more">
            <Text style={styles.section}>Wat kan het allemaal?</Text>
            {f.more.map((m, i) => (
              <View key={i} style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
                <View style={{ marginTop: 1 }}>
                  <Icon name="check-circle-outline" size={18} color={c.icon} />
                </View>
                <Text style={[styles.text, { flex: 1 }]}>{m}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {!has ? (
          <Button label={`Probeer ${PLAN_NAME[plan]}`} icon={planIcon(plan)} onPress={() => router.push("/premium")} testID="feature-get" />
        ) : target ? (
          <Button label="Bekijk in mijn app" icon="arrow-right" onPress={() => router.push(target as any)} testID="feature-open" />
        ) : noList ? (
          <View style={styles.note} testID="feature-no-list">
            <Icon name="information-outline" size={18} color={colors.muted} />
            <Text style={[styles.muted, { flex: 1 }]}>Je moet eerst een lijstje aanmaken. Daarna zie je {f.title.toLowerCase()} in je lijstje.</Text>
          </View>
        ) : inList && camps.isLoading ? (
          <ActivityIndicator color={colors.brandPrimary} />
        ) : f.key === "geen_advertenties" ? (
          <View style={styles.note}>
            <Icon name="check-circle-outline" size={18} color={colors.success} />
            <Text style={[styles.muted, { flex: 1 }]}>Dit staat bij jou vanzelf aan, je hoeft niets te doen.</Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  note: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 12, backgroundColor: colors.surfaceSecondary },
  ad: { height: 40, borderRadius: 10, borderWidth: 1, borderStyle: "dashed", borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.divider },
  headerBtn: { width: 44, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 18, fontFamily: fonts.bold, color: colors.onSurface },
  lock: { flexDirection: "row", gap: 12, borderWidth: 1, borderRadius: 16, padding: 14 },
  lockIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  lockTitle: { fontSize: 15, fontFamily: fonts.bold, flexShrink: 1 },
  section: { fontSize: 16, fontFamily: fonts.bold, color: colors.onSurface },
  text: { fontSize: 14, lineHeight: 20, fontFamily: fonts.regular, color: colors.onSurface },
  muted: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted },
  small: { fontSize: 11, fontFamily: fonts.regular, color: colors.muted },
  card: { gap: 10, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 14 },
  cardTitle: { fontSize: 14, fontFamily: fonts.semibold, color: colors.onSurface },
  chart: { flexDirection: "row", height: 120, alignItems: "flex-end" },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  step: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  stepText: { fontSize: 12, fontFamily: fonts.bold, color: "#FFFFFF" },
}));
