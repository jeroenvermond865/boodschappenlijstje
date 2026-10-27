import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import Animated, { FadeInLeft, FadeInRight } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/src/components/ui";
import { useAppSettings, useTerms } from "@/src/settings";
import { GOLD } from "@/src/premium";
import { DemoKind, TutorialDemo } from "@/src/TutorialDemos";
import { fonts, makeStyles } from "@/src/theme";

// Elke stap: een kort bewegend voorbeeld uit de app, een titel en een paar korte zinnen
type Step = { demo: DemoKind; title: string; text: string[]; premium?: boolean };

function useSteps(): Step[] {
  const s = useAppSettings();
  const t = useTerms();
  return [
    {
      demo: "welkom",
      title: `Welkom bij ${s.app_name}`,
      text: [
        "Kies wat je wilt eten. De app maakt je boodschappenlijst, rekent uit hoeveel je nodig hebt en zoekt de prijzen erbij.",
        "Kies onder Account > Profiel je favoriete winkel. Die staat dan overal vooraan. Deze uitleg vind je later terug onder Account.",
      ],
    },
    {
      demo: "plannen",
      title: `${t.Many}: je planning`,
      text: [
        `Maak een ${t.nieuw} ${t.one}. Kies de eerste dag, hoeveel dagen en met hoeveel mensen jullie zijn.`,
        "Zet per dag een gerecht bij elke maaltijd en kies op welke dagen je boodschappen doet. Losse producten, zoals koffie, kun je er ook bij zetten.",
      ],
    },
    {
      demo: "lijst",
      title: "Je boodschappenlijst",
      text: [
        "Alles wordt opgeteld en staat per winkel en per afdeling op een rij. In de winkel vink je af wat je in je mandje hebt.",
      ],
    },
    {
      demo: "prijzen",
      title: "Goedkoopste winkel",
      text: [
        "Je ziet wat je lijst bij elke supermarkt kost. Met slim splitsen haal je elk product bij de winkel waar het het goedkoopst is.",
        "Prijzen komen van de websites van de supermarkten. De prijs in de winkel is altijd leidend.",
      ],
    },
    {
      demo: "gerechten",
      title: s.tab_dishes,
      text: [
        "Gerechten staan in blokken, zoals Ontbijt, Soep of Voor grote groepen. Bewaar je favorieten met het hartje, of zoek online recepten en neem ze in één keer over.",
        "Allergie of vegetarisch? Stel het in via Allergieën. Dan zie je bij elk gerecht of het past.",
      ],
    },
    {
      demo: "producten",
      title: s.tab_products,
      text: [
        "Zoek producten en vergelijk prijzen. In de folders zie je de aanbiedingen van deze en volgende week.",
        "Met Premium zet je een prijsalarm. Dan krijg je een mail als het product in de aanbieding is.",
      ],
    },
    {
      demo: "voorraad",
      title: "Voorraadkast",
      text: [
        "Houd bij wat je thuis hebt. De app leert hoe snel iets opgaat en zegt het als het bijna op is. Wat je nog hebt, hoef je niet te kopen.",
      ],
    },
    {
      demo: "slim",
      title: "Slimme hulp",
      premium: true,
      text: [
        "Typ in één zin wat je wilt en je krijgt een menu. Of kook met restjes, plak een recept, spreek je lijst in en krijg bespaartips.",
      ],
    },
    {
      demo: "samen",
      title: "Samen plannen",
      text: [
        `Open ${t.deze} ${t.one} en nodig anderen uit met hun e-mailadres. Dan werken jullie samen aan dezelfde planning en lijst.`,
        "Mis je iets of heb je een idee? Laat het weten via Account > Feedback & verbeteringen.",
      ],
    },
  ];
}

export function Tutorial({ onDone, doneLabel = "Aan de slag" }: { onDone: () => void; doneLabel?: string }) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const steps = useSteps();
  const [i, setI] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const step = steps[i];
  const last = i === steps.length - 1;
  const go = (n: number) => {
    setDir(n >= i ? 1 : -1);
    setI(n);
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Bij elke stap schuift de inhoud vanaf de kant waar je naartoe gaat */}
        <Animated.View key={i} entering={(dir === 1 ? FadeInRight : FadeInLeft).duration(280)} style={styles.step}>
          <TutorialDemo kind={step.demo} />
          <View style={styles.titleRow}>
            <Text style={styles.title}>{step.title}</Text>
            {step.premium ? <Text style={styles.premium}>Premium</Text> : null}
          </View>
          {step.text.map((p, n) => (
            <Text key={n} style={styles.text}>
              {p}
            </Text>
          ))}
        </Animated.View>
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <Text style={styles.count}>
          Stap {i + 1} van {steps.length}
        </Text>
        <View style={styles.dots}>
          {steps.map((_, n) => (
            <Pressable key={n} onPress={() => go(n)} hitSlop={6} testID={`tutorial-dot-${n}`}>
              <View style={[styles.dot, n === i && styles.dotActive]} />
            </Pressable>
          ))}
        </View>
        <Button label={last ? doneLabel : "Volgende"} onPress={() => (last ? onDone() : go(i + 1))} testID="tutorial-next" />
        <View style={styles.row}>
          {i > 0 ? (
            <Pressable onPress={() => go(i - 1)} hitSlop={8} testID="tutorial-back">
              <Text style={styles.link}>Vorige</Text>
            </Pressable>
          ) : (
            <View />
          )}
          {!last ? (
            <Pressable onPress={onDone} hitSlop={8} testID="tutorial-skip">
              <Text style={styles.link}>Overslaan</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  content: { flexGrow: 1, justifyContent: "center", padding: 20 },
  step: { gap: 12, width: "100%", maxWidth: 520, alignSelf: "center" },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 8 },
  premium: {
    fontSize: 12,
    fontFamily: fonts.bold,
    color: GOLD.text,
    backgroundColor: GOLD.bg,
    borderColor: GOLD.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: "hidden",
  },
  count: { fontSize: 12, fontFamily: fonts.medium, color: colors.muted, textAlign: "center" },
  title: { fontSize: 22, fontFamily: fonts.bold, color: colors.onSurface, textAlign: "center" },
  text: { fontSize: 15, lineHeight: 23, fontFamily: fonts.regular, color: colors.onSurfaceSecondary, textAlign: "center" },
  footer: { paddingHorizontal: 20, gap: 12 },
  dots: { flexDirection: "row", justifyContent: "center", gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.borderStrong },
  dotActive: { width: 22, backgroundColor: colors.brandPrimary },
  row: { flexDirection: "row", justifyContent: "space-between", minHeight: 20 },
  link: { fontSize: 14, fontFamily: fonts.semibold, color: colors.brandPrimary },
}));
