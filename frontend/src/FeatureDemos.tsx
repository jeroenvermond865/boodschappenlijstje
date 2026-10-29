// Bewegende voorbeelden van de extra functies. Gebruikt op de functiepagina (Abonnementen) en in "Zo werkt de app".
// Alles is een verzonnen voorbeeld; het speelt steeds opnieuw af.
import { useEffect, useRef, type ReactNode } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";

import { Icon } from "@/src/components/ui";
import type { FeatureKey } from "@/src/premium";
import { fonts, makeStyles, useTheme } from "@/src/theme";

// Het voorbeeld bij een functie (null: die heeft een voorbeeld uit "Zo werkt de app")
export function FeatureDemo({ k, accent }: { k: FeatureKey; accent: string }) {
  switch (k) {
    case "prijsgeschiedenis":
      return <HistoryDemo accent={accent} />;
    case "prijsalarm":
      return <AlarmDemo accent={accent} />;
    case "extra_besparen":
      return <SavingsDemo accent={accent} />;
    case "looproute":
      return <RouteDemo accent={accent} />;
    case "slim_splitsen":
      return <SplitDemo accent={accent} />;
    case "voorraadkast":
      return <PantryMoreDemo accent={accent} />;
    case "geen_advertenties":
      return <NoAdsDemo accent={accent} />;
    default:
      return null;
  }
}

// Steeds opnieuw van 0 naar 1 (met een korte pauze), voor de bewegende voorbeelden
export function useLoop(ms: number, linear = false) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, { toValue: 1, duration: ms, easing: linear ? Easing.linear : Easing.inOut(Easing.cubic), useNativeDriver: false }),
        Animated.delay(1400),
        Animated.timing(t, { toValue: 0, duration: 0, useNativeDriver: false }),
        Animated.delay(500),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [t, ms, linear]);
  return t;
}

// Prijsgeschiedenis: de prijs per week groeit van links naar rechts in beeld; de aanbieding kleurt groen
const WEEKS = [
  { w: "wk 32", p: 2.49 }, { w: "wk 33", p: 2.49 }, { w: "wk 34", p: 2.29 }, { w: "wk 35", p: 2.49 }, { w: "wk 36", p: 1.79 },
  { w: "wk 37", p: 2.49 }, { w: "wk 38", p: 2.59 }, { w: "wk 39", p: 2.39 }, { w: "wk 40", p: 1.99 }, { w: "wk 41", p: 2.49 },
];
export function HistoryDemo({ accent }: { accent: string }) {
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
export function RouteDemo({ accent }: { accent: string }) {
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
export function AlarmDemo({ accent }: { accent: string }) {
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
export function SavingsDemo({ accent }: { accent: string }) {
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
export function NoAdsDemo({ accent }: { accent: string }) {
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

// Een scène die op het juiste moment in- en uitfaadt (van/tot zijn delen van 0..1 van de lus)
function Scene({ t, from, to, children }: { t: Animated.Value; from: number; to: number; children: ReactNode }) {
  const op = t.interpolate({ inputRange: [from - 0.001, from, from + 0.04, to - 0.04, to, to + 0.001], outputRange: [0, 0, 1, 1, 0, 0], extrapolate: "clamp" });
  return <Animated.View style={{ position: "absolute", left: 14, right: 14, top: 14, opacity: op }}>{children}</Animated.View>;
}

// Slim splitsen: eerst alles bij één winkel, dan de knop, dan 2 of 3 winkels kiezen en wat elke winkel haalt
const SPLIT_ITEMS = [
  { n: "Kipfilet", s: ["AH", "Dirk", "Dirk"] },
  { n: "Pasta", s: ["Dirk", "Dirk", "Dirk"] },
  { n: "Kaas", s: ["AH", "AH", "Jumbo"] },
  { n: "Paprika", s: ["Dirk", "Dirk", "AH"] },
  { n: "Koffie", s: ["AH", "AH", "Jumbo"] },
];
export function SplitDemo({ accent }: { accent: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const t = useLoop(9000, true);
  const press = t.interpolate({ inputRange: [0.2, 0.24, 0.28], outputRange: [1, 0.92, 1], extrapolate: "clamp" });
  const Chip = ({ label, on }: { label: string; on: boolean }) => (
    <View style={[styles.chip, on && { backgroundColor: accent, borderColor: accent }]}>
      <Text style={[styles.small, { color: on ? "#FFFFFF" : colors.onSurface, fontFamily: fonts.semibold }]}>{label}</Text>
    </View>
  );
  const Lists = ({ k, stores }: { k: number; stores: string[] }) => (
    <View style={{ flexDirection: "row", gap: 6 }}>
      {stores.map((st) => (
        <View key={st} style={styles.miniList}>
          <Text style={[styles.cardTitle, { color: accent }]}>{st}</Text>
          {SPLIT_ITEMS.filter((x) => x.s[k] === st).map((x) => (
            <Text key={x.n} style={styles.small}>• {x.n}</Text>
          ))}
        </View>
      ))}
    </View>
  );
  return (
    <View style={[styles.card, { height: 250 }]} testID="demo-split">
      <Scene t={t} from={0} to={0.3}>
        <View style={{ gap: 8 }}>
          <Text style={styles.cardTitle}>Eerst: alles bij Jumbo</Text>
          {SPLIT_ITEMS.map((x) => (
            <Text key={x.n} style={styles.small}>• {x.n}</Text>
          ))}
          <View style={styles.row}>
            <Text style={[styles.text, { flex: 1 }]}>Totaal</Text>
            <Text style={styles.section}>€ 45,90</Text>
          </View>
          <Animated.View style={[styles.splitBtn, { backgroundColor: accent, transform: [{ scale: press }] }]}>
            <Icon name="call-split" size={16} color="#FFFFFF" />
            <Text style={[styles.cardTitle, { color: "#FFFFFF" }]}>Gesplitst halen</Text>
          </Animated.View>
        </View>
      </Scene>
      <Scene t={t} from={0.3} to={0.64}>
        <View style={{ gap: 8 }}>
          <Text style={styles.cardTitle}>Kies 2 winkels</Text>
          <View style={{ flexDirection: "row", gap: 6 }}>
            <Chip label="AH" on />
            <Chip label="Jumbo" on={false} />
            <Chip label="Dirk" on />
          </View>
          <Lists k={0} stores={["AH", "Dirk"]} />
          <View style={styles.row}>
            <Text style={[styles.text, { flex: 1 }]}>Samen</Text>
            <Text style={[styles.section, { color: colors.success }]}>€ 42,30 · € 3,60 minder</Text>
          </View>
        </View>
      </Scene>
      <Scene t={t} from={0.64} to={1}>
        <View style={{ gap: 8 }}>
          <Text style={styles.cardTitle}>Of alle 3 winkels</Text>
          <View style={{ flexDirection: "row", gap: 6 }}>
            <Chip label="AH" on />
            <Chip label="Jumbo" on />
            <Chip label="Dirk" on />
          </View>
          <Lists k={2} stores={["AH", "Jumbo", "Dirk"]} />
          <View style={styles.row}>
            <Text style={[styles.text, { flex: 1 }]}>Samen</Text>
            <Text style={[styles.section, { color: colors.success }]}>€ 41,10 · € 4,80 minder</Text>
          </View>
        </View>
      </Scene>
    </View>
  );
}

// Voorraadkast: raakt iets op, dan een seintje en het gaat op je lijst; wat je nog hebt gaat van je lijst af
const JARS = [
  { n: "Rijst", from: 0.8, to: 0.12 },
  { n: "Olijfolie", from: 0.7, to: 0.55 },
  { n: "Pasta", from: 0.9, to: 0.7 },
];
export function PantryMoreDemo({ accent }: { accent: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const t = useLoop(9000, true);
  return (
    <View style={[styles.card, { height: 240 }]} testID="demo-pantry">
      <Scene t={t} from={0} to={0.36}>
        <View style={{ gap: 10 }}>
          <Text style={styles.cardTitle}>Je voorraadkast raakt langzaam leeg</Text>
          {JARS.map((j) => {
            const w = t.interpolate({ inputRange: [0.02, 0.26], outputRange: [`${j.from * 100}%`, `${j.to * 100}%`], extrapolate: "clamp" });
            return (
              <View key={j.n} style={styles.row}>
                <Text style={[styles.text, { width: 80 }]}>{j.n}</Text>
                <View style={styles.track}>
                  <Animated.View style={{ height: "100%", width: w, borderRadius: 5, backgroundColor: j.to < 0.3 ? colors.warning : accent }} />
                </View>
              </View>
            );
          })}
          <Animated.View style={[styles.toast, { opacity: t.interpolate({ inputRange: [0.26, 0.29], outputRange: [0, 1], extrapolate: "clamp" }) }]}>
            <Icon name="alert-outline" size={16} color="#FFFFFF" />
            <Text style={[styles.small, { color: "#FFFFFF", flex: 1 }]}>Rijst is bijna op. Op je lijst zetten?</Text>
          </Animated.View>
        </View>
      </Scene>
      <Scene t={t} from={0.36} to={0.68}>
        <View style={{ gap: 8 }}>
          <Text style={styles.cardTitle}>Je boodschappenlijst</Text>
          {[
            { n: "Rijst", note: "Bijna op, genoeg voor 2 weken", c: colors.warning, s: false },
            { n: "Olijfolie", note: "Heb je nog: gaat van je lijst af", c: colors.success, s: true },
            { n: "Kipfilet", note: "", c: colors.muted, s: false },
          ].map((x) => (
            <View key={x.n} style={styles.row}>
              <Icon name={x.s ? "check-circle" : "checkbox-blank-circle-outline"} size={18} color={x.s ? colors.success : accent} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.text, x.s && { textDecorationLine: "line-through", color: colors.muted }]}>{x.n}</Text>
                {x.note ? <Text style={[styles.small, { color: x.c }]}>{x.note}</Text> : null}
              </View>
            </View>
          ))}
          <Text style={[styles.small, { color: colors.success, fontFamily: fonts.semibold }]}>€ 4,15 bespaard omdat je het al in huis had</Text>
        </View>
      </Scene>
      <Scene t={t} from={0.68} to={1}>
        <View style={{ gap: 8 }}>
          <Text style={styles.cardTitle}>Bij een recept: Heb ik al</Text>
          <Text style={styles.small}>Bloem · hoe vol is het nog?</Text>
          {["Vol", "Half", "Bijna op"].map((o, i) => {
            const on = t.interpolate({ inputRange: [0.8, 0.82], outputRange: [0, i === 1 ? 1 : 0], extrapolate: "clamp" });
            return (
              <View key={o} style={styles.option}>
                <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: 10, backgroundColor: accent, opacity: on }]} />
                <Text style={styles.text}>{o}</Text>
              </View>
            );
          })}
          <Animated.Text style={[styles.small, { color: colors.success, fontFamily: fonts.semibold, opacity: t.interpolate({ inputRange: [0.86, 0.9], outputRange: [0, 1], extrapolate: "clamp" }) }]}>
            Staat nu in je voorraadkast (half vol)
          </Animated.Text>
        </View>
      </Scene>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  ad: { height: 40, borderRadius: 10, borderWidth: 1, borderStyle: "dashed", borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  section: { fontSize: 16, fontFamily: fonts.bold, color: colors.onSurface },
  text: { fontSize: 14, lineHeight: 20, fontFamily: fonts.regular, color: colors.onSurface },
  small: { fontSize: 11, fontFamily: fonts.regular, color: colors.muted },
  card: { gap: 10, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 14, backgroundColor: colors.surface, overflow: "hidden" },
  cardTitle: { fontSize: 14, fontFamily: fonts.semibold, color: colors.onSurface },
  chart: { flexDirection: "row", height: 120, alignItems: "flex-end" },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  step: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  stepText: { fontSize: 12, fontFamily: fonts.bold, color: "#FFFFFF" },
  chip: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: colors.border },
  miniList: { flex: 1, gap: 2, padding: 8, borderRadius: 10, backgroundColor: colors.surfaceSecondary },
  splitBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 12, paddingVertical: 10 },
  track: { flex: 1, height: 10, borderRadius: 5, backgroundColor: colors.surfaceSecondary, overflow: "hidden" },
  toast: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 12, backgroundColor: "#333" },
  option: { padding: 10, borderRadius: 10, backgroundColor: colors.surfaceSecondary, overflow: "hidden" },
}));
