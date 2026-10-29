// Eén extra functie: heb je hem, dan ga je er meteen heen. Zo niet, dan een slotje, wat hij doet,
// een voorbeeld van hoe het eruitziet en een knop om het abonnement te nemen.
// Slim splitsen, looproute en weekmenu horen bij een lijstje: die openen in je eerstvolgende lijstje.
// Heb je nog geen lijstje, dan zie je het voorbeeld en de vraag om eerst een lijstje te maken.
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

  // Heb je hem al? Dan meteen naar de functie zelf (bij een lijstje-functie: je eerstvolgende lijstje)
  useEffect(() => {
    if (!f || !has) return;
    if (inList) {
      if (next) router.replace(inList(next.id) as any);
    } else if (f.to) router.replace(f.to as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f?.key, has, next?.id]);

  if (!f) return null;
  const demo = DEMO[f.key];
  const noList = has && !!inList && camps.isSuccess && !next;
  if (has && (!inList || camps.isLoading || next)) {
    return (
      <View style={[styles.root, { alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator color={colors.brandPrimary} />
      </View>
    );
  }
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
        {noList ? (
          <View style={[styles.lock, { backgroundColor: c.bg, borderColor: c.border }]} testID="feature-no-list">
            <View style={[styles.lockIcon, { backgroundColor: c.icon }]}>
              <Icon name="clipboard-plus-outline" size={22} color="#FFFFFF" />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[styles.lockTitle, { color: c.text }]}>Maak eerst een lijstje aan</Text>
              <Text style={[styles.text, { color: c.text }]}>{f.title} werkt in je lijstje. Hieronder zie je hoe het eruitziet.</Text>
            </View>
          </View>
        ) : (
        <View style={[styles.lock, { backgroundColor: c.bg, borderColor: c.border }]} testID="feature-lock">
          <View style={[styles.lockIcon, { backgroundColor: c.icon }]}>
            <Icon name="lock-outline" size={22} color="#FFFFFF" />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Icon name={planIcon(plan)} size={16} color={c.icon} />
              <Text style={[styles.lockTitle, { color: c.text }]}>{f.title} is een {PLAN_NAME[plan]}-functie</Text>
            </View>
            <Text style={[styles.text, { color: c.text }]}>{f.text}</Text>
          </View>
        </View>
        )}

        <Text style={styles.section}>Zo ziet het eruit</Text>
        {demo ? <TutorialDemo kind={demo} /> : <Example k={f.key} accent={c.icon} />}
        {f.where ? <Text style={styles.muted}>Je vindt het straks: {f.where}</Text> : null}

        {noList ? (
          <Button label="Lijstje maken" icon="plus" onPress={() => router.push("/camp/new")} testID="feature-new-list" />
        ) : (
          <Button label={`Probeer ${PLAN_NAME[plan]}`} icon={planIcon(plan)} onPress={() => router.push("/premium")} testID="feature-get" />
        )}
      </ScrollView>
    </View>
  );
}

// Stilstaand voorbeeld, voor functies zonder bewegend voorbeeld
function Example({ k, accent }: { k: FeatureKey; accent: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  if (k === "prijsgeschiedenis") return <HistoryDemo accent={accent} />;
  if (k === "prijsalarm") {
    return (
      <View style={styles.card}>
        {[
          { n: "Koffiebonen 1 kg", t: "Nu € 8,99 bij Jumbo (was € 12,49)", on: true },
          { n: "Wasmiddel", t: "Onder jouw prijs van € 6,00", on: true },
          { n: "Olijfolie 1 L", t: "Wacht op een aanbieding", on: false },
        ].map((x) => (
          <View key={x.n} style={styles.row}>
            <Icon name={x.on ? "bell-ring" : "bell-outline"} size={20} color={x.on ? accent : colors.muted} />
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{x.n}</Text>
              <Text style={[styles.small, x.on && { color: colors.success }]}>{x.t}</Text>
            </View>
          </View>
        ))}
      </View>
    );
  }
  if (k === "extra_besparen") {
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Je bespaaroverzicht deze maand</Text>
        {[
          ["Aanbiedingen", "€ 6,40"],
          ["Al in je voorraadkast", "€ 4,15"],
          ["Slim splitsen", "€ 7,80"],
          ["Acties op je boodschappendag", "€ 2,35"],
        ].map(([a, b]) => (
          <View key={a} style={styles.row}>
            <Text style={[styles.text, { flex: 1 }]}>{a}</Text>
            <Text style={[styles.cardTitle, { color: accent }]}>{b}</Text>
          </View>
        ))}
      </View>
    );
  }
  if (k === "looproute") return <RouteDemo accent={accent} />;
  return (
    <View style={styles.card}>
      <Text style={styles.text}>Geen advertenties in de app, ook als die er later komen.</Text>
    </View>
  );
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

const useStyles = makeStyles((colors) => ({
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
