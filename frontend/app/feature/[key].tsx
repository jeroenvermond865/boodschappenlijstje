// Eén extra functie: wat hij doet, altijd met een bewegend voorbeeld. Heb je hem, dan onderaan "Bekijk in mijn app"
// (slim splitsen, looproute en weekmenu in je eerstvolgende lijstje). Kan dat nog niet, dan geen knop maar
// "Je moet eerst een lijstje aanmaken". Heb je hem niet, dan een slotje en een knop om het abonnement te nemen.
import { useEffect, useRef } from "react";
import { ActivityIndicator, Animated, Easing, Pressable, ScrollView, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, Icon } from "@/src/components/ui";
import { goBack } from "@/src/nav";
import { api } from "@/src/api";
import { PLAN_NAME, PREMIUM_FEATURES, planAccent, planIcon, useFeature, usePlanOf, type FeatureKey } from "@/src/premium";
import { TutorialDemo, type DemoKind } from "@/src/TutorialDemos";
import { fonts, makeStyles, useTheme } from "@/src/theme";

// Functies met een bewegend voorbeeld uit "Zo werkt de app"; de rest krijgt een stilstaand voorbeeld hieronder
const DEMO: Partial<Record<FeatureKey, DemoKind>> = {
  slim_splitsen: "prijzen",
  voorraadkast: "voorraad",
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
        {demo ? <TutorialDemo kind={demo} /> : <Example k={f.key} accent={c.icon} />}
        {f.where ? <Text style={styles.muted}>In de app: {f.where}</Text> : null}

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

// Bewegende voorbeelden voor functies die er in "Zo werkt de app" geen hebben
function Example({ k, accent }: { k: FeatureKey; accent: string }) {
  if (k === "prijsgeschiedenis") return <HistoryDemo accent={accent} />;
  if (k === "prijsalarm") return <AlarmDemo accent={accent} />;
  if (k === "extra_besparen") return <SavingsDemo accent={accent} />;
  if (k === "looproute") return <RouteDemo accent={accent} />;
  return <NoAdsDemo accent={accent} />;
}

// Steeds opnieuw van 0 naar 1 (met een korte pauze), voor de bewegende voorbeelden
function useLoop(ms: number) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, { toValue: 1, duration: ms, easing: Easing.inOut(Easing.cubic), useNativeDriver: false }),
        Animated.delay(1400),
        Animated.timing(t, { toValue: 0, duration: 0, useNativeDriver: false }),
        Animated.delay(500),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [t, ms]);
  return t;
}

// Prijsgeschiedenis: de prijs per week groeit van links naar rechts in beeld; de aanbieding kleurt groen
const WEEKS = [
  { w: "wk 32", p: 2.49 }, { w: "wk 33", p: 2.49 }, { w: "wk 34", p: 2.29 }, { w: "wk 35", p: 2.49 }, { w: "wk 36", p: 1.79 },
  { w: "wk 37", p: 2.49 }, { w: "wk 38", p: 2.59 }, { w: "wk 39", p: 2.39 }, { w: "wk 40", p: 1.99 }, { w: "wk 41", p: 2.49 },
];
function HistoryDemo({ accent }: { accent: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const t = useLoop(3200);
  const max = Math.max(...WEEKS.map((x) => x.p));
  const low = Math.min(...WEEKS.map((x) => x.p));
  const n = WEEKS.length;
  return (
    <View style={styles.card} testID="demo-history">
      <Text style={styles.cardTitle}>Prijs per week · laatste 10 weken</Text>
      <View style={styles.chart}>
        {WEEKS.map((x, i) => {
          const grow = t.interpolate({ inputRange: [i / n, (i + 1) / n], outputRange: [0, 1], extrapolate: "clamp" });
          const deal = x.p === low;
          return (
            <View key={x.w} style={{ flex: 1, alignItems: "center", justifyContent: "flex-end", gap: 2 }}>
              <Animated.Text style={[styles.small, { opacity: grow }, deal && { color: colors.success, fontFamily: fonts.bold }]}>
                {x.p.toFixed(2).replace(".", ",")}
              </Animated.Text>
              <Animated.View
                style={{
                  width: "62%",
                  borderRadius: 4,
                  height: grow.interpolate({ inputRange: [0, 1], outputRange: [0, (x.p / max) * 90] }),
                  backgroundColor: deal ? colors.success : accent,
                }}
              />
              <Text style={[styles.small, { fontSize: 9 }]}>{x.w}</Text>
            </View>
          );
        })}
      </View>
      <Animated.Text style={[styles.small, { opacity: t.interpolate({ inputRange: [0.85, 1], outputRange: [0, 1], extrapolate: "clamp" }) }]}>
        Laagste prijs: € {low.toFixed(2).replace(".", ",")} (groen). Zo zie je of een aanbieding echt goedkoop is.
      </Animated.Text>
    </View>
  );
}

// Looproute: je lijst staat door elkaar en schuift in de volgorde van de winkel
const ROUTE = [
  { n: "Melk", a: "Zuivel", at: 2 },
  { n: "Bananen", a: "Groente & fruit", at: 0 },
  { n: "Diepvriespizza", a: "Diepvries", at: 4 },
  { n: "Brood", a: "Brood", at: 1 },
  { n: "Kipfilet", a: "Vlees", at: 3 },
];
const ROW_H = 40;
function RouteDemo({ accent }: { accent: string }) {
  const styles = useStyles();
  const t = useLoop(1800);
  return (
    <View style={styles.card} testID="demo-route">
      <Animated.Text style={[styles.cardTitle, { opacity: t.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 0, 0] }) }]}>Zonder looproute: door elkaar</Animated.Text>
      <Animated.Text style={[styles.cardTitle, { position: "absolute", top: 14, left: 14, opacity: t.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 0, 1] }) }]}>
        Met looproute: zoals je door de winkel loopt
      </Animated.Text>
      <View style={{ height: ROUTE.length * ROW_H }}>
        {ROUTE.map((x, i) => (
          <Animated.View
            key={x.n}
            style={[
              styles.row,
              { position: "absolute", left: 0, right: 0, height: ROW_H },
              { top: t.interpolate({ inputRange: [0, 1], outputRange: [i * ROW_H, x.at * ROW_H] }) },
            ]}
          >
            <Animated.View style={[styles.step, { backgroundColor: accent, opacity: t.interpolate({ inputRange: [0.6, 1], outputRange: [0, 1], extrapolate: "clamp" }) }]}>
              <Text style={styles.stepText}>{x.at + 1}</Text>
            </Animated.View>
            <View style={{ flex: 1 }}>
              <Text style={styles.text}>{x.n}</Text>
              <Text style={styles.small}>{x.a}</Text>
            </View>
          </Animated.View>
        ))}
      </View>
    </View>
  );
}

// Prijsalarm: de meldingen komen één voor één binnen
const ALARMS = [
  { n: "Koffiebonen 1 kg", t: "Nu € 8,99 bij Jumbo (was € 12,49)" },
  { n: "Wasmiddel", t: "Onder jouw prijs van € 6,00" },
  { n: "Olijfolie 1 L", t: "In de aanbieding bij AH: 2e halve prijs" },
];
function AlarmDemo({ accent }: { accent: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const t = useLoop(2400);
  return (
    <View style={styles.card} testID="demo-alarm">
      <Text style={styles.cardTitle}>Je prijsalarmen</Text>
      {ALARMS.map((x, i) => {
        const v = t.interpolate({ inputRange: [i / 3, (i + 0.7) / 3], outputRange: [0, 1], extrapolate: "clamp" });
        return (
          <Animated.View key={x.n} style={[styles.row, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [-10, 0] }) }] }]}>
            <Icon name="bell-ring" size={20} color={accent} />
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{x.n}</Text>
              <Text style={[styles.small, { color: colors.success }]}>{x.t}</Text>
            </View>
          </Animated.View>
        );
      })}
    </View>
  );
}

// Extra besparen: de bedragen komen erbij en het totaal verschijnt
const SAVES = [
  { a: "Aanbiedingen", v: 6.4 },
  { a: "Al in je voorraadkast", v: 4.15 },
  { a: "Slim splitsen", v: 7.8 },
  { a: "Acties op je boodschappendag", v: 2.35 },
];
function SavingsDemo({ accent }: { accent: string }) {
  const styles = useStyles();
  const t = useLoop(2600);
  const total = SAVES.reduce((n, x) => n + x.v, 0);
  return (
    <View style={styles.card} testID="demo-savings">
      <Text style={styles.cardTitle}>Je bespaaroverzicht deze maand</Text>
      {SAVES.map((x, i) => {
        const v = t.interpolate({ inputRange: [i / 5, (i + 1) / 5], outputRange: [0, 1], extrapolate: "clamp" });
        return (
          <Animated.View key={x.a} style={[styles.row, { opacity: v }]}>
            <Text style={[styles.text, { flex: 1 }]}>{x.a}</Text>
            <Text style={[styles.cardTitle, { color: accent }]}>€ {x.v.toFixed(2).replace(".", ",")}</Text>
          </Animated.View>
        );
      })}
      <View style={{ height: 8, borderRadius: 4, backgroundColor: "rgba(0,0,0,0.08)", overflow: "hidden" }}>
        <Animated.View style={{ height: 8, backgroundColor: accent, width: t.interpolate({ inputRange: [0, 0.8], outputRange: ["0%", "100%"], extrapolate: "clamp" }) }} />
      </View>
      <Animated.View style={[styles.row, { opacity: t.interpolate({ inputRange: [0.8, 1], outputRange: [0, 1], extrapolate: "clamp" }) }]}>
        <Text style={[styles.cardTitle, { flex: 1 }]}>Samen bespaard</Text>
        <Text style={[styles.section, { color: accent }]}>€ {total.toFixed(2).replace(".", ",")}</Text>
      </Animated.View>
    </View>
  );
}

// Geen advertenties: een advertentieblok verdwijnt en de inhoud schuift netjes op
function NoAdsDemo({ accent }: { accent: string }) {
  const styles = useStyles();
  const t = useLoop(1600);
  return (
    <View style={styles.card} testID="demo-noads">
      <Text style={styles.cardTitle}>Je lijstje</Text>
      <View style={styles.row}>
        <Icon name="checkbox-blank-circle-outline" size={20} color={accent} />
        <Text style={styles.text}>Bananen</Text>
      </View>
      <Animated.View
        style={{
          overflow: "hidden",
          height: t.interpolate({ inputRange: [0.3, 0.8], outputRange: [44, 0], extrapolate: "clamp" }),
          opacity: t.interpolate({ inputRange: [0, 0.5], outputRange: [1, 0], extrapolate: "clamp" }),
        }}
      >
        <View style={styles.ad}>
          <Text style={styles.small}>Advertentie</Text>
        </View>
      </Animated.View>
      <View style={styles.row}>
        <Icon name="checkbox-blank-circle-outline" size={20} color={accent} />
        <Text style={styles.text}>Melk</Text>
      </View>
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
