// Kleine bewegende voorbeelden voor de uitleg ("Zo werkt de app").
// Elk voorbeeld lijkt op een stukje van de app en speelt steeds opnieuw af.
// Waar het kan, staan er echte gegevens in: je eigen winkel, echte gerechten en de aanbiedingen van nu.
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  Extrapolation,
  interpolate,
  SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { useQuery } from "@tanstack/react-query";

import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import Image from "@/src/components/SafeImage";
import { Icon } from "@/src/components/ui";
import { DISH_GROUPS } from "@/src/constants";
import { PLAN_NAME, planAccent, planIcon, usePlanOf } from "@/src/premium";
import type { Product } from "@/src/ProductBrowser";
import { euro, fetchProducts, NO_FILTERS } from "@/src/search";
import { fonts, makeStyles, useTheme } from "@/src/theme";
import type { Dish } from "@/app/(tabs)/dishes";

export type DemoKind = "welkom" | "plannen" | "lijst" | "prijzen" | "gerechten" | "producten" | "voorraad" | "slim" | "samen";

// Eén klok per voorbeeld: loopt van 0 naar 1 en begint dan opnieuw.
// Wil je telefoon minder beweging, dan blijft alles stil in de eindstand staan.
function useClock(ms: number) {
  const reduced = useReducedMotion();
  const t = useSharedValue(reduced ? 0.8 : 0);
  useEffect(() => {
    if (reduced) return;
    t.value = withRepeat(withTiming(1, { duration: ms, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms, reduced]);
  return t;
}

const clamp = (t: number, a: number[], b: number[]) => {
  "worklet";
  return interpolate(t, a, b, Extrapolation.CLAMP);
};

// Verschijnt (met een klein veertje) als de klok bij `at` is
function usePop(t: SharedValue<number>, at: number, len = 0.06) {
  return useAnimatedStyle(() => ({
    opacity: clamp(t.value, [at, at + len], [0, 1]),
    transform: [{ scale: clamp(t.value, [at, at + len * 0.7, at + len], [0.6, 1.08, 1]) }],
  }));
}

// Het hele voorbeeld vervaagt aan het eind even, zodat het opnieuw beginnen rustig gaat
function Frame({ t, children, height = 210 }: { t: SharedValue<number>; children: React.ReactNode; height?: number }) {
  const styles = useStyles();
  const fade = useAnimatedStyle(() => ({ opacity: clamp(t.value, [0, 0.04, 0.93, 1], [0, 1, 1, 0]) }));
  return (
    <View style={[styles.frame, { height }]}>
      <Animated.View style={[styles.frameInner, fade]}>{children}</Animated.View>
    </View>
  );
}

export function TutorialDemo({ kind }: { kind: DemoKind }) {
  switch (kind) {
    case "welkom":
      return <WelcomeDemo />;
    case "plannen":
      return <PlanDemo />;
    case "lijst":
      return <ListDemo />;
    case "prijzen":
      return <CompareDemo />;
    case "gerechten":
      return <DishesDemo />;
    case "producten":
      return <ProductsDemo />;
    case "voorraad":
      return <PantryDemo />;
    case "slim":
      return <SmartDemo />;
    case "samen":
      return <TogetherDemo />;
  }
}

// ---------- echte gegevens (met een gewoon voorbeeld als het niet lukt) ----------

const FALLBACK_ITEMS = ["Halfvolle melk", "Bananen", "Volkoren brood", "Pindakaas"];

function useOffers() {
  // Aanbiedingen zonder zoekwoord: snel en zonder AI
  const q = useQuery({
    queryKey: ["tutorial-offers"],
    queryFn: () => fetchProducts({ filters: { ...NO_FILTERS, offer: true }, limit: 8 }),
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
  return (q.data?.products ?? []).filter((p) => p.name).slice(0, 4);
}

function useDinnerName() {
  const q = useQuery({
    queryKey: ["dishes"],
    queryFn: () => api<{ dishes: Dish[] }>("/dishes"),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const list = q.data?.dishes ?? [];
  const d = list.find((x) => x.category === "avondeten" && x.is_standard) ?? list.find((x) => x.category === "avondeten");
  return d?.name ?? "Pasta bolognese";
}

function useStore() {
  const { user } = useAuth();
  return (user as any)?.store || "Albert Heijn";
}

// ---------- 1. Welkom: gerecht → lijst → winkel ----------

function WelcomeDemo() {
  const t = useClock(5200);
  const styles = useStyles();
  const steps = [
    { icon: "silverware-fork-knife", label: "Kies wat je eet" },
    { icon: "format-list-checks", label: "Lijst is klaar" },
    { icon: "cart-outline", label: "Doe boodschappen" },
  ];
  return (
    <Frame t={t}>
      <View style={styles.flowRow}>
        {steps.map((s, n) => (
          <FlowStep key={s.icon} t={t} n={n} icon={s.icon} label={s.label} last={n === steps.length - 1} />
        ))}
      </View>
    </Frame>
  );
}

function FlowStep({ t, n, icon, label, last }: { t: SharedValue<number>; n: number; icon: string; label: string; last: boolean }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const at = 0.08 + n * 0.2;
  const pop = usePop(t, at, 0.08);
  const arrow = useAnimatedStyle(() => ({
    opacity: clamp(t.value, [at + 0.08, at + 0.14], [0, 1]),
    transform: [{ translateX: clamp(t.value, [at + 0.08, at + 0.16], [-8, 0]) }],
  }));
  const glow = useAnimatedStyle(() => ({
    backgroundColor: t.value > at + 0.06 && t.value < at + 0.2 ? colors.brandPrimary : colors.brandTertiary,
  }));
  const iconCol = useAnimatedStyle(() => ({ opacity: t.value > at + 0.06 && t.value < at + 0.2 ? 0 : 1 }));
  const iconWhite = useAnimatedStyle(() => ({ opacity: t.value > at + 0.06 && t.value < at + 0.2 ? 1 : 0 }));
  return (
    <>
      <Animated.View style={[styles.flowStep, pop]}>
        <Animated.View style={[styles.flowIcon, glow]}>
          <Animated.View style={[styles.abs, iconCol]}>
            <Icon name={icon} size={28} color={colors.brandPrimary} />
          </Animated.View>
          <Animated.View style={[styles.abs, iconWhite]}>
            <Icon name={icon} size={28} color={colors.onBrandPrimary} />
          </Animated.View>
        </Animated.View>
        <Text style={styles.flowLabel}>{label}</Text>
      </Animated.View>
      {!last ? (
        <Animated.View style={[styles.flowArrow, arrow]}>
          <Icon name="chevron-right" size={22} color={colors.muted} />
        </Animated.View>
      ) : null}
    </>
  );
}

// ---------- 2. Plannen: een gerecht schuift in de dag ----------

function PlanDemo() {
  const t = useClock(5600);
  const styles = useStyles();
  const { colors } = useTheme();
  const dinner = useDinnerName();
  const drop = useAnimatedStyle(() => ({
    opacity: clamp(t.value, [0.12, 0.2], [0, 1]),
    transform: [
      { translateY: clamp(t.value, [0.12, 0.42], [-70, 0]) },
      { scale: clamp(t.value, [0.12, 0.38, 0.42, 0.48], [1.05, 1.05, 0.94, 1]) },
    ],
  }));
  const slot = useAnimatedStyle(() => ({
    borderColor: t.value > 0.3 && t.value < 0.5 ? colors.brandPrimary : colors.border,
    backgroundColor: t.value > 0.42 ? colors.brandTertiary : colors.surface,
  }));
  const shop = usePop(t, 0.58, 0.07);
  const people = usePop(t, 0.7, 0.07);
  return (
    <Frame t={t}>
      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <Text style={styles.cardTitle}>Maandag</Text>
          <Animated.View style={[styles.pill, { backgroundColor: colors.brandSecondary }, shop]}>
            <Icon name="cart-outline" size={14} color={colors.onBrandSecondary} />
            <Text style={[styles.pillText, { color: colors.onBrandSecondary }]}>Boodschappendag</Text>
          </Animated.View>
        </View>
        <MealRow icon="coffee-outline" label="Ontbijt" value="Brood met beleg" />
        <MealRow icon="food-apple-outline" label="Lunch" value="Tosti's" />
        <Animated.View style={[styles.mealRow, styles.slot, slot]}>
          <Icon name="silverware-fork-knife" size={18} color={colors.muted} />
          <Text style={styles.mealLabel}>Avondeten</Text>
          <Animated.View style={[styles.chip, drop]}>
            <Text style={styles.chipText} numberOfLines={1}>
              {dinner}
            </Text>
          </Animated.View>
        </Animated.View>
        <Animated.View style={[styles.rowStart, people]}>
          <Icon name="account-multiple-outline" size={16} color={colors.brandPrimary} />
          <Text style={styles.small}>Voor 4 personen: de app rekent de hoeveelheden uit</Text>
        </Animated.View>
      </View>
    </Frame>
  );
}

function MealRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={[styles.mealRow, styles.slot]}>
      <Icon name={icon} size={18} color={colors.muted} />
      <Text style={styles.mealLabel}>{label}</Text>
      <View style={styles.chip}>
        <Text style={styles.chipText} numberOfLines={1}>
          {value}
        </Text>
      </View>
    </View>
  );
}

// ---------- 3. Boodschappenlijst: afvinken in de winkel ----------

function ListDemo() {
  const t = useClock(6000);
  const styles = useStyles();
  const { colors } = useTheme();
  const offers = useOffers();
  const items = offers.length >= 4 ? offers.map((p) => p.name) : FALLBACK_ITEMS;
  const done = usePop(t, 0.74, 0.07);
  return (
    <Frame t={t} height={230}>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Boodschappenlijst</Text>
        {items.map((name, n) => (
          <CheckRow key={name + n} t={t} at={0.14 + n * 0.14} name={name} />
        ))}
        <Animated.View style={[styles.rowStart, done]}>
          <Icon name="party-popper" size={16} color={colors.success} />
          <Text style={styles.small}>Alles binnen!</Text>
        </Animated.View>
      </View>
    </Frame>
  );
}

function CheckRow({ t, at, name }: { t: SharedValue<number>; at: number; name: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const fill = useAnimatedStyle(() => ({
    opacity: clamp(t.value, [at, at + 0.03], [0, 1]),
    transform: [{ scale: clamp(t.value, [at, at + 0.03, at + 0.06], [0.4, 1.2, 1]) }],
  }));
  const text = useAnimatedStyle(() => ({ opacity: clamp(t.value, [at + 0.02, at + 0.06], [1, 0.45]) }));
  const strike = useAnimatedStyle(() => ({ width: `${clamp(t.value, [at + 0.02, at + 0.08], [0, 100])}%` }));
  return (
    <View style={styles.checkRow}>
      <View style={styles.box}>
        <Animated.View style={[styles.boxFill, fill]}>
          <Icon name="check-bold" size={14} color={colors.onBrandPrimary} />
        </Animated.View>
      </View>
      <View style={{ flexShrink: 1, justifyContent: "center" }}>
        <Animated.Text style={[styles.itemText, text]} numberOfLines={1}>
          {name}
        </Animated.Text>
        <Animated.View style={[styles.strike, strike]} />
      </View>
    </View>
  );
}

// ---------- 4. Prijzen vergelijken en slim splitsen ----------

const COMPARE = [
  { label: "Albert Heijn", total: 48.2 },
  { label: "Jumbo", total: 45.9 },
  { label: "Dirk", total: 43.75 },
  { label: "Slim splitsen", total: 41.1, gold: true },
];

function CompareDemo() {
  const t = useClock(5600);
  const styles = useStyles();
  const store = useStore();
  // Je eigen winkel bovenaan, net als in de app
  const rows = [...COMPARE].sort((a, b) => (a.label === store ? -1 : b.label === store ? 1 : 0));
  const max = Math.max(...rows.map((r) => r.total));
  return (
    <Frame t={t} height={220}>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Waar is je lijst het goedkoopst?</Text>
        {rows.map((r, n) => (
          <Bar key={r.label} t={t} at={0.1 + n * 0.12} label={r.label} total={r.total} frac={r.total / max} gold={!!r.gold} />
        ))}
        <Text style={styles.tiny}>Voorbeeld. In de app zie je de prijzen van jouw lijst.</Text>
      </View>
    </Frame>
  );
}

function Bar({ t, at, label, total, frac, gold }: { t: SharedValue<number>; at: number; label: string; total: number; frac: number; gold: boolean }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const grow = useAnimatedStyle(() => ({ width: `${clamp(t.value, [at, at + 0.16], [0, frac * 100])}%` }));
  const price = useAnimatedStyle(() => ({ opacity: clamp(t.value, [at + 0.12, at + 0.18], [0, 1]) }));
  const badge = usePop(t, 0.66, 0.07);
  const split = planAccent(usePlanOf("slim_splitsen")); // goud of paars, net als het abonnement van slim splitsen
  return (
    <View style={styles.barRow}>
      <Text style={styles.barLabel} numberOfLines={1}>
        {label}
      </Text>
      <View style={styles.barTrack}>
        <Animated.View style={[styles.barFill, { backgroundColor: gold ? split.icon : colors.brand }, grow]} />
      </View>
      <Animated.Text style={[styles.barPrice, price]}>{euro(total)}</Animated.Text>
      {gold ? (
        <Animated.View style={[styles.crown, badge]}>
          <Icon name="crown" size={14} color={split.icon} />
        </Animated.View>
      ) : null}
    </View>
  );
}

// ---------- 5. Gerechten in blokken ----------

function DishesDemo() {
  const t = useClock(5200);
  const styles = useStyles();
  const groups = DISH_GROUPS.slice(0, 6);
  return (
    <Frame t={t}>
      <View style={styles.grid}>
        {groups.map((g, n) => (
          <GroupTile key={g.key} t={t} at={0.06 + n * 0.07} icon={g.icon} label={g.label} pick={n === 3} />
        ))}
      </View>
    </Frame>
  );
}

function GroupTile({ t, at, icon, label, pick }: { t: SharedValue<number>; at: number; icon: string; label: string; pick: boolean }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const pop = usePop(t, at, 0.07);
  const tap = useAnimatedStyle(() => {
    if (!pick) return {};
    return {
      borderColor: t.value > 0.62 ? colors.brandPrimary : colors.border,
      transform: [{ scale: clamp(t.value, [0.58, 0.61, 0.65], [1, 0.92, 1]) }],
    };
  });
  const heart = usePop(t, 0.7, 0.06);
  return (
    <Animated.View style={[styles.tile, pop]}>
      <Animated.View style={[styles.tileInner, tap]}>
        <Icon name={icon} size={24} color={colors.brandPrimary} />
        <Text style={styles.tileText} numberOfLines={2}>
          {label.split(" / ")[0]}
        </Text>
        {pick ? (
          <Animated.View style={[styles.heart, heart]}>
            <Icon name="heart" size={14} color={colors.error} />
          </Animated.View>
        ) : null}
      </Animated.View>
    </Animated.View>
  );
}

// ---------- 6. Producten: echte aanbiedingen van nu ----------

function ProductsDemo() {
  const t = useClock(5600);
  const styles = useStyles();
  const { colors } = useTheme();
  const offers = useOffers().slice(0, 3);
  const bell = useAnimatedStyle(() => ({
    opacity: clamp(t.value, [0.6, 0.64], [0, 1]),
    transform: [{ rotate: `${clamp(t.value, [0.64, 0.67, 0.7, 0.73, 0.76], [0, -18, 14, -8, 0])}deg` }],
  }));
  const items: (Product | null)[] = offers.length ? offers : [null, null, null];
  return (
    <Frame t={t} height={230}>
      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <Text style={styles.cardTitle}>{offers.length ? "Nu in de aanbieding" : "Aanbiedingen"}</Text>
          <Animated.View style={[styles.pill, { backgroundColor: alarm.bg, borderColor: alarm.border, borderWidth: 1 }, bell]}>
            <Icon name="bell-ring-outline" size={14} color={alarm.icon} />
            <Text style={[styles.pillText, { color: alarm.text }]}>Prijsalarm</Text>
          </Animated.View>
        </View>
        {items.map((p, n) => (
          <OfferRow key={p?.id ?? n} t={t} at={0.1 + n * 0.12} p={p} fallback={FALLBACK_ITEMS[n]} />
        ))}
        <Text style={[styles.tiny, { color: colors.muted }]}>{offers.length ? "Echte aanbiedingen uit de app." : "Voorbeeld."}</Text>
      </View>
    </Frame>
  );
}

function OfferRow({ t, at, p, fallback }: { t: SharedValue<number>; at: number; p: Product | null; fallback: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const slide = useAnimatedStyle(() => ({
    opacity: clamp(t.value, [at, at + 0.08], [0, 1]),
    transform: [{ translateX: clamp(t.value, [at, at + 0.1], [40, 0]) }],
  }));
  return (
    <Animated.View style={[styles.offerRow, slide]}>
      {p?.image ? (
        <Image source={{ uri: p.image }} style={styles.thumb} resizeMode="contain" />
      ) : (
        <View style={[styles.thumb, { alignItems: "center", justifyContent: "center" }]}>
          <Icon name="tag-outline" size={18} color={colors.muted} />
        </View>
      )}
      <Text style={styles.itemText} numberOfLines={1}>
        {p?.name ?? fallback}
      </Text>
      <View style={[styles.pill, { backgroundColor: colors.warning }]}>
        <Text style={[styles.pillText, { color: colors.onWarning }]} numberOfLines={1}>
          {p?.promo?.label || (p ? euro(p.price) : "Actie")}
        </Text>
      </View>
    </Animated.View>
  );
}

// ---------- 7. Voorraadkast: wat raakt op? ----------

function PantryDemo() {
  const t = useClock(5600);
  const styles = useStyles();
  const toast = useAnimatedStyle(() => ({
    opacity: clamp(t.value, [0.62, 0.68], [0, 1]),
    transform: [{ translateY: clamp(t.value, [0.62, 0.7], [16, 0]) }],
  }));
  const { colors } = useTheme();
  return (
    <Frame t={t}>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Voorraadkast</Text>
        <Jar t={t} name="Rijst" from={0.85} to={0.15} low />
        <Jar t={t} name="Pasta" from={0.9} to={0.6} />
        <Jar t={t} name="Olijfolie" from={0.7} to={0.55} />
        <Animated.View style={[styles.toast, toast]}>
          <Icon name="playlist-plus" size={16} color={colors.onSurfaceInverse} />
          <Text style={styles.toastText}>Rijst is bijna op. Op je lijst zetten?</Text>
        </Animated.View>
      </View>
    </Frame>
  );
}

function Jar({ t, name, from, to, low }: { t: SharedValue<number>; name: string; from: number; to: number; low?: boolean }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const level = useAnimatedStyle(() => {
    const v = clamp(t.value, [0.1, 0.5], [from, to]);
    return { width: `${v * 100}%`, backgroundColor: low && v < 0.3 ? colors.warning : colors.brand };
  });
  const badge = usePop(t, 0.5, 0.06);
  return (
    <View style={styles.barRow}>
      <Text style={styles.barLabel}>{name}</Text>
      <View style={styles.barTrack}>
        <Animated.View style={[styles.barFill, level]} />
      </View>
      {low ? (
        <Animated.View style={[styles.pill, { backgroundColor: colors.warning }, badge]}>
          <Text style={[styles.pillText, { color: colors.onWarning }]}>Bijna op</Text>
        </Animated.View>
      ) : (
        <View style={{ width: 62 }} />
      )}
    </View>
  );
}

// ---------- 8. Slimme hulp: een menu uit één zin ----------

const SENTENCE = "Makkelijk eten voor 4 personen, 3 dagen";
const MENU = ["Ma: Wraps met kip", "Di: Pasta pesto", "Wo: Ovenschotel met groente"];

function SmartDemo() {
  const t = useClock(6400);
  const styles = useStyles();
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  // Het typen loopt mee met dezelfde klok, maar de tekst zelf wordt in gewone stappen bijgewerkt
  const [chars, setChars] = useState(reduced ? SENTENCE.length : 0);
  useEffect(() => {
    if (reduced) return;
    let n = 0;
    const id = setInterval(() => {
      n = (n + 1) % 160; // 160 x 40 ms = 6400 ms, net als de klok
      setChars(Math.min(SENTENCE.length, Math.max(0, n - 4)));
    }, 40);
    return () => clearInterval(id);
  }, [reduced]);
  const think = useAnimatedStyle(() => ({ opacity: t.value > 0.3 && t.value < 0.42 ? 1 : 0 }));
  return (
    <Frame t={t} height={220}>
      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <Text style={styles.cardTitle}>Slimme hulp</Text>
          <View style={[styles.pill, { backgroundColor: smart.bg, borderColor: smart.border, borderWidth: 1 }]}>
            <Icon name={planIcon(smartPlan)} size={12} color={smart.icon} />
            <Text style={[styles.pillText, { color: smart.text }]}>{PLAN_NAME[smartPlan]}</Text>
          </View>
        </View>
        <View style={styles.input}>
          <Text style={styles.itemText} numberOfLines={1}>
            {SENTENCE.slice(0, chars)}
            <Text style={{ color: colors.brandPrimary }}>|</Text>
          </Text>
        </View>
        <Animated.View style={[styles.rowStart, think]}>
          <Icon name="creation" size={14} color={colors.brandPrimary} />
          <Text style={styles.small}>Even denken...</Text>
        </Animated.View>
        {MENU.map((m, n) => (
          <MenuLine key={m} t={t} at={0.44 + n * 0.08} text={m} />
        ))}
      </View>
    </Frame>
  );
}

function MenuLine({ t, at, text }: { t: SharedValue<number>; at: number; text: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const st = useAnimatedStyle(() => ({
    opacity: clamp(t.value, [at, at + 0.06], [0, 1]),
    transform: [{ translateY: clamp(t.value, [at, at + 0.06], [8, 0]) }],
  }));
  return (
    <Animated.View style={[styles.rowStart, st]}>
      <Icon name="check-circle" size={16} color={colors.success} />
      <Text style={styles.itemText}>{text}</Text>
    </Animated.View>
  );
}

// ---------- 9. Samen plannen ----------

const PEOPLE = [
  { initials: "JV", color: "#2E5E38" },
  { initials: "NB", color: "#D99C3B" },
  { initials: "TK", color: "#4A7FA8" },
];

function TogetherDemo() {
  const t = useClock(5200);
  const styles = useStyles();
  const { colors } = useTheme();
  const synced = usePop(t, 0.6, 0.07);
  return (
    <Frame t={t}>
      <View style={[styles.card, { alignItems: "center", justifyContent: "center" }]}>
        <View style={styles.avatars}>
          {PEOPLE.map((p, n) => (
            <Avatar key={p.initials} t={t} at={0.08 + n * 0.14} from={n === 0 ? 0 : n % 2 ? 60 : -60} {...p} />
          ))}
        </View>
        <Animated.View style={[styles.rowStart, synced]}>
          <Icon name="sync" size={16} color={colors.brandPrimary} />
          <Text style={styles.small}>Samen aan één lijst, iedereen ziet wat er is afgevinkt</Text>
        </Animated.View>
      </View>
    </Frame>
  );
}

function Avatar({ t, at, from, initials, color }: { t: SharedValue<number>; at: number; from: number; initials: string; color: string }) {
  const styles = useStyles();
  const st = useAnimatedStyle(() => ({
    opacity: clamp(t.value, [at, at + 0.06], [0, 1]),
    transform: [{ translateX: clamp(t.value, [at, at + 0.12], [from, 0]) }, { scale: clamp(t.value, [at, at + 0.08, at + 0.12], [0.7, 1.08, 1]) }],
  }));
  return (
    <Animated.View style={[styles.avatar, { backgroundColor: color }, st]}>
      <Text style={styles.avatarText}>{initials}</Text>
    </Animated.View>
  );
}

const useStyles = makeStyles((colors) => ({
  frame: {
    width: "100%",
    maxWidth: 340,
    alignSelf: "center",
    borderRadius: 22,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    overflow: "hidden",
  },
  frameInner: { flex: 1, justifyContent: "center" },
  abs: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  card: { flex: 1, backgroundColor: colors.surface, borderRadius: 16, padding: 12, gap: 8, borderWidth: 1, borderColor: colors.border },
  cardTitle: { fontSize: 15, fontFamily: fonts.bold, color: colors.onSurface },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  rowStart: { flexDirection: "row", alignItems: "center", gap: 6 },
  small: { flexShrink: 1, fontSize: 12, fontFamily: fonts.medium, color: colors.onSurfaceSecondary },
  tiny: { fontSize: 11, fontFamily: fonts.regular, color: colors.muted },
  pill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  pillText: { fontSize: 11, fontFamily: fonts.semibold },

  flowRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 2 },
  flowStep: { width: 86, alignItems: "center", gap: 8 },
  flowIcon: { width: 60, height: 60, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  flowLabel: { fontSize: 12, fontFamily: fonts.semibold, color: colors.onSurface, textAlign: "center" },
  flowArrow: { marginBottom: 24 },

  mealRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, paddingVertical: 7 },
  slot: { borderRadius: 12, borderWidth: 1, borderColor: colors.border },
  mealLabel: { width: 72, fontSize: 12, fontFamily: fonts.semibold, color: colors.muted },
  chip: { flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  chipText: { fontSize: 13, fontFamily: fonts.semibold, color: colors.onSurface },

  checkRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 3 },
  box: { width: 22, height: 22, borderRadius: 7, borderWidth: 2, borderColor: colors.borderStrong, overflow: "hidden" },
  boxFill: { flex: 1, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  itemText: { flexShrink: 1, fontSize: 14, fontFamily: fonts.medium, color: colors.onSurface },
  strike: { position: "absolute", left: 0, height: 2, backgroundColor: colors.muted, borderRadius: 1 },

  barRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  barLabel: { width: 84, fontSize: 12, fontFamily: fonts.semibold, color: colors.onSurfaceSecondary },
  barTrack: { flex: 1, height: 12, borderRadius: 6, backgroundColor: colors.surfaceTertiary, overflow: "hidden" },
  barFill: { height: 12, borderRadius: 6 },
  barPrice: { width: 58, textAlign: "right", fontSize: 12, fontFamily: fonts.bold, color: colors.onSurface },
  crown: { position: "absolute", right: -2, top: -12 },

  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8 },
  tile: { width: "30%" },
  tileInner: {
    height: 80,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    padding: 4,
  },
  tileText: { fontSize: 11, fontFamily: fonts.semibold, color: colors.onSurface, textAlign: "center" },
  heart: { position: "absolute", top: 4, right: 6 },

  offerRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  thumb: { width: 34, height: 34, borderRadius: 8, backgroundColor: colors.surfaceSecondary },

  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.surfaceInverse,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 2,
  },
  toastText: { flexShrink: 1, fontSize: 12, fontFamily: fonts.semibold, color: colors.onSurfaceInverse },

  input: { borderWidth: 1, borderColor: colors.borderStrong, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8 },

  avatars: { flexDirection: "row", justifyContent: "center", marginBottom: 14 },
  avatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: -6,
    borderWidth: 3,
    borderColor: colors.surface,
  },
  avatarText: { fontSize: 16, fontFamily: fonts.bold, color: "#FFFFFF" },
}));
