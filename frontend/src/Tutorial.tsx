import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, Icon } from "@/src/components/ui";
import { useAppSettings, useTerms } from "@/src/settings";
import { fonts, makeStyles, useTheme } from "@/src/theme";

type Step = { icon: string; title: string; text: string[] };

function useSteps(): Step[] {
  const s = useAppSettings();
  const t = useTerms();
  return [
    {
      icon: "cart-heart",
      title: `Welkom bij ${s.app_name}`,
      text: [
        "Plan je maaltijden en de app maakt je boodschappenlijst. Hij rekent uit hoeveel je nodig hebt en zoekt de prijzen bij de supermarkt erbij.",
        "In een paar stappen laten we zien hoe het werkt. Je kunt deze uitleg later altijd terugvinden onder Account.",
      ],
    },
    {
      icon: "home-variant-outline",
      title: "Home",
      text: [
        "Op Home zie je aanbiedingen en recepten om inspiratie op te doen. Tik op het hartje bij een recept om het te bewaren.",
        "Kies bij Account → Profiel & wachtwoord je favoriete winkel. Die staat dan overal vooraan, en prijzen en budget rekenen met die winkel.",
      ],
    },
    {
      icon: "clipboard-list-outline",
      title: `${t.Many}: je planning`,
      text: [
        `Maak bij ${t.Many} een ${t.nieuw} ${t.one}. Kies de eerste dag, hoeveel dagen het duurt en met hoeveel mensen jullie zijn. Eten er vegetariërs mee, vul dat ook in.`,
        "Per dag kies je de gerechten voor elke maaltijd en geef je aan op welke dagen je boodschappen doet. Losse producten, zoals koffie of schoonmaakspullen, kun je er ook bij zetten.",
      ],
    },
    {
      icon: "format-list-checks",
      title: "Je boodschappenlijst",
      text: [
        "De app telt alles bij elkaar op voor het aantal mensen en zet het per winkel en per afdeling op een rij. In de winkel vink je af wat je hebt.",
        "Je ziet ook waar je lijst het goedkoopst is en kunt een budget instellen om bij te houden wat je uitgeeft. Prijzen komen van de websites van supermarkten. De prijs in de winkel is altijd leidend.",
      ],
    },
    {
      icon: "silverware-fork-knife",
      title: s.tab_dishes,
      text: [
        "Hier staan standaardgerechten voor iedereen en je eigen gerechten. Je kunt ook online recepten zoeken en die in één keer als gerecht overnemen.",
        "Met pakketten maak je een vaste set producten, zoals 'ontbijt en lunch basis', die je snel aan een dag toevoegt.",
        "Heb je een allergie of eet je vegetarisch? Stel dat in via Allergieën, rechtsboven. Dan zie je bij elk gerecht of het past.",
      ],
    },
    {
      icon: "storefront-outline",
      title: s.tab_products,
      text: [
        "Zoek producten en vergelijk prijzen van verschillende supermarkten. In de folders zie je wat er deze week in de aanbieding is. Favoriete producten bewaar je met het hartje.",
        "Met Premium zet je een prijsalarm op een product. Dan krijg je een mail als het in de aanbieding is.",
      ],
    },
    {
      icon: "account-multiple-plus-outline",
      title: "Samen plannen",
      text: [
        `Open ${t.deze} ${t.one} en nodig anderen uit met hun e-mailadres. Dan werken jullie samen aan dezelfde planning en lijst.`,
        "Mis je iets of heb je een idee? Laat het weten via Account → Feedback & verbeteringen.",
      ],
    },
  ];
}

export function Tutorial({ onDone, doneLabel = "Aan de slag" }: { onDone: () => void; doneLabel?: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const steps = useSteps();
  const [i, setI] = useState(0);
  const step = steps[i];
  const last = i === steps.length - 1;

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.iconWrap}>
          <Icon name={step.icon} size={44} color={colors.brandPrimary} />
        </View>
        <Text style={styles.title}>{step.title}</Text>
        {step.text.map((p, n) => (
          <Text key={n} style={styles.text}>
            {p}
          </Text>
        ))}
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.dots}>
          {steps.map((_, n) => (
            <Pressable key={n} onPress={() => setI(n)} hitSlop={6} testID={`tutorial-dot-${n}`}>
              <View style={[styles.dot, n === i && styles.dotActive]} />
            </Pressable>
          ))}
        </View>
        <Button label={last ? doneLabel : "Volgende"} onPress={() => (last ? onDone() : setI(i + 1))} testID="tutorial-next" />
        <View style={styles.row}>
          {i > 0 ? (
            <Pressable onPress={() => setI(i - 1)} hitSlop={8} testID="tutorial-back">
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
  content: { flexGrow: 1, justifyContent: "center", padding: 24, gap: 14 },
  iconWrap: {
    width: 88,
    height: 88,
    borderRadius: 28,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginBottom: 8,
  },
  title: { fontSize: 24, fontFamily: fonts.bold, color: colors.onSurface, textAlign: "center" },
  text: { fontSize: 16, lineHeight: 24, fontFamily: fonts.regular, color: colors.onSurfaceSecondary, textAlign: "center" },
  footer: { paddingHorizontal: 20, gap: 14 },
  dots: { flexDirection: "row", justifyContent: "center", gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.borderStrong },
  dotActive: { width: 22, backgroundColor: colors.brandPrimary },
  row: { flexDirection: "row", justifyContent: "space-between", minHeight: 20 },
  link: { fontSize: 14, fontFamily: fonts.semibold, color: colors.brandPrimary },
}));
