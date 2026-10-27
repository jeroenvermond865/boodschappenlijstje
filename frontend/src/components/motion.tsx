// Kleine animaties die overal in de app terugkomen: meeveren bij tikken, een vinkje dat plopt,
// bedragen die optellen, rustige schaduwvormen tijdens het laden en confetti als je lijst af is.
// Wil je telefoon minder beweging (instelling "Beperk beweging"), dan blijft alles stil.
import { useEffect, useRef, useState } from "react";
import { Pressable, PressableProps, StyleProp, Text, TextStyle, useWindowDimensions, View, ViewStyle } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { makeStyles } from "@/src/theme";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// Knop of kaart die heel even iets kleiner wordt als je erop drukt
export function PressScale({ style, scaleTo = 0.97, onPressIn, onPressOut, ...rest }: PressableProps & { style?: StyleProp<ViewStyle>; scaleTo?: number }) {
  const reduced = useReducedMotion();
  const s = useSharedValue(1);
  const st = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return (
    <AnimatedPressable
      {...rest}
      onPressIn={(e) => {
        if (!reduced) s.value = withTiming(scaleTo, { duration: 90, easing: Easing.out(Easing.quad) });
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        s.value = withSpring(1, { damping: 14, stiffness: 260 });
        onPressOut?.(e);
      }}
      style={[style, st]}
    />
  );
}

// Een vinkje dat even groter wordt en terugveert als je het aanzet
export function CheckPop({ checked, children }: { checked: boolean; children: React.ReactNode }) {
  const reduced = useReducedMotion();
  const s = useSharedValue(1);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (checked && !reduced) s.value = withSequence(withTiming(1.3, { duration: 110 }), withSpring(1, { damping: 9, stiffness: 240 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checked]);
  const st = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return <Animated.View style={st}>{children}</Animated.View>;
}

// Bedrag dat vanaf het vorige bedrag naar het nieuwe optelt (of aftelt)
export function CountUp({ value, format, style, ms = 650 }: { value: number; format: (v: number) => string; style?: StyleProp<TextStyle>; ms?: number }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(reduced ? value : 0);
  const from = useRef(reduced ? value : 0);
  useEffect(() => {
    if (reduced) {
      setShown(value);
      return;
    }
    const start = from.current;
    const t0 = Date.now();
    let raf = 0;
    const tick = () => {
      const p = Math.min(1, (Date.now() - t0) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = start + (value - start) * eased;
      from.current = v;
      setShown(v);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, ms, reduced]);
  return <Text style={style}>{format(shown)}</Text>;
}

// Grijze vorm die rustig oplicht, als voorproefje van wat er gaat komen
export function Skeleton({ style }: { style?: StyleProp<ViewStyle> }) {
  const styles = useStyles();
  const reduced = useReducedMotion();
  const o = useSharedValue(0.55);
  useEffect(() => {
    if (reduced) return;
    o.value = withRepeat(withSequence(withTiming(1, { duration: 700 }), withTiming(0.55, { duration: 700 })), -1, false);
    return () => cancelAnimation(o);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);
  const st = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[styles.bone, style, st]} />;
}

// Een rijtje kaarten in schaduwvorm (afbeelding links, twee regels tekst)
export function SkeletonList({ rows = 5, style }: { rows?: number; style?: StyleProp<ViewStyle> }) {
  const styles = useStyles();
  return (
    <View style={[styles.list, style]} testID="skeleton">
      {Array.from({ length: rows }).map((_, n) => (
        <View key={n} style={styles.row}>
          <Skeleton style={styles.thumb} />
          <View style={{ flex: 1, gap: 8 }}>
            <Skeleton style={{ height: 14, width: `${70 - (n % 3) * 12}%` }} />
            <Skeleton style={{ height: 11, width: `${45 - (n % 2) * 10}%` }} />
          </View>
        </View>
      ))}
    </View>
  );
}

// Confetti die van boven naar beneden dwarrelt. Verhoog `fire` om hem af te laten gaan.
const CONFETTI_COLORS = ["#2E5E38", "#D99C3B", "#E0245E", "#4A7FA8", "#E8C77A", "#427A5B"];

export function Confetti({ fire }: { fire: number }) {
  const { width, height } = useWindowDimensions();
  const reduced = useReducedMotion();
  const [shot, setShot] = useState(0);
  useEffect(() => {
    if (!fire || reduced) return;
    setShot(fire);
    const id = setTimeout(() => setShot(0), 2200);
    return () => clearTimeout(id);
  }, [fire, reduced]);
  if (!shot) return null;
  return (
    <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 50 }}>
      {Array.from({ length: 36 }).map((_, n) => (
        <Piece key={`${shot}-${n}`} n={n} w={Math.min(width, 700)} h={height} />
      ))}
    </View>
  );
}

function Piece({ n, w, h }: { n: number; w: number; h: number }) {
  // Vaste "willekeur" per stukje, zodat elk stukje anders valt
  const r = (k: number) => {
    const x = Math.sin(n * 12.9898 + k * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };
  const x0 = r(1) * w;
  const drift = (r(2) - 0.5) * 120;
  const size = 6 + r(3) * 6;
  const delay = r(4) * 300;
  const dur = 1300 + r(5) * 600;
  const rot = r(6) > 0.5 ? 540 : -540;
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withDelay(delay, withTiming(1, { duration: dur, easing: Easing.out(Easing.quad) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const st = useAnimatedStyle(() => ({
    opacity: p.value < 0.85 ? 1 : (1 - p.value) / 0.15,
    transform: [
      { translateX: x0 + drift * p.value },
      { translateY: -20 + p.value * h * 0.75 },
      { rotate: `${p.value * rot}deg` },
    ],
  }));
  return (
    <Animated.View
      style={[
        { position: "absolute", top: 0, left: 0, width: size, height: size * (r(7) > 0.5 ? 1 : 0.45), borderRadius: r(8) > 0.7 ? size : 2, backgroundColor: CONFETTI_COLORS[n % CONFETTI_COLORS.length] },
        st,
      ]}
    />
  );
}

const useStyles = makeStyles((colors) => ({
  bone: { backgroundColor: colors.surfaceTertiary, borderRadius: 8 },
  list: { gap: 12, padding: 16 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 18,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  thumb: { width: 48, height: 48, borderRadius: 12 },
}));
