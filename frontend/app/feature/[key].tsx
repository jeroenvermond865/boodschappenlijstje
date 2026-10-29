// Eén extra functie: heb je hem, dan ga je er meteen heen. Zo niet, dan een slotje, wat hij doet,
// een voorbeeld van hoe het eruitziet en een knop om het abonnement te nemen.
import { useEffect } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, Icon } from "@/src/components/ui";
import { goBack } from "@/src/nav";
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

  // Heb je hem al? Dan meteen naar de functie zelf
  useEffect(() => {
    if (f && has && f.to) router.replace(f.to as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f?.key, has]);

  if (!f) return null;
  const demo = DEMO[f.key];
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

        <Text style={styles.section}>Zo ziet het eruit</Text>
        {demo ? <TutorialDemo kind={demo} /> : <Example k={f.key} accent={c.icon} />}
        {f.where ? <Text style={styles.muted}>Je vindt het straks: {f.where}</Text> : null}

        <Button label={`Probeer ${PLAN_NAME[plan]}`} icon={planIcon(plan)} onPress={() => router.push("/premium")} testID="feature-get" />
      </ScrollView>
    </View>
  );
}

// Stilstaand voorbeeld, voor functies zonder bewegend voorbeeld
function Example({ k, accent }: { k: FeatureKey; accent: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  if (k === "prijsgeschiedenis") {
    const pts = [2.49, 2.49, 2.29, 2.49, 1.79, 2.49, 2.59, 2.19];
    const max = Math.max(...pts);
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Halfvolle melk 1 L · laatste 8 weken</Text>
        <View style={styles.chart}>
          {pts.map((p, i) => (
            <View key={i} style={{ flex: 1, alignItems: "center", justifyContent: "flex-end", gap: 2 }}>
              <Text style={styles.small}>{p.toFixed(2).replace(".", ",")}</Text>
              <View style={{ width: "60%", height: (p / max) * 90, borderRadius: 4, backgroundColor: p < 2 ? colors.success : accent }} />
            </View>
          ))}
        </View>
        <Text style={styles.small}>De groene week was een echte aanbieding: zo zie je of een actie de moeite waard is.</Text>
      </View>
    );
  }
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
  if (k === "looproute") {
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Je lijst in de volgorde van de winkel</Text>
        {["Groente & fruit", "Brood", "Zuivel", "Vlees", "Diepvries", "Kassa"].map((a, i) => (
          <View key={a} style={styles.row}>
            <View style={[styles.step, { backgroundColor: accent }]}>
              <Text style={styles.stepText}>{i + 1}</Text>
            </View>
            <Text style={styles.text}>{a}</Text>
          </View>
        ))}
      </View>
    );
  }
  return (
    <View style={styles.card}>
      <Text style={styles.text}>Geen advertenties in de app, ook als die er later komen.</Text>
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
