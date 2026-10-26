// Bovenbalk die meeschuift: scroll je naar beneden, dan schuift het blok geleidelijk mee omhoog uit beeld.
// Scroll je weer omhoog, dan komt het net zo geleidelijk terug. Stop je halverwege, dan schuift het netjes
// helemaal open of dicht.
// Het blok ligt bovenop de lijst (absoluut); de lijst krijgt bovenaan evenveel ruimte (padTop), zodat er
// niets verspringt terwijl het blok beweegt.
// Twee blokken onder elkaar (Gerechten > Online): het binnenste krijgt het buitenste mee als `outer` en
// stuurt ze samen; eerst gaat het bovenste weg, dan het onderste.
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from "react-native";

export type HideOnScroll = {
  max: number;
  padTop: number;
  scrollProps: { onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void; scrollEventThrottle: number };
  blockProps: { onLayout: (e: LayoutChangeEvent) => void; style: any };
  follow: (v: number, animated: boolean) => void;
  reset: () => void;
};

export function useHideOnScroll(keep = 0, outer?: HideOnScroll | null): HideOnScroll {
  // keep: zoveel pixels blijven staan (bijv. de ruimte voor de statusbalk)
  const [height, setHeight] = useState(0);
  const hidden = useRef(new Animated.Value(0)).current; // hoeveel pixels van het blok uit beeld is
  const cur = useRef(0);
  const lastY = useRef(0);
  const anim = useRef<Animated.CompositeAnimation | null>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const above = outer?.padTop ?? 0;
  const max = Math.max(0, height - keep) + (outer ? outer.max : 0);

  useEffect(() => () => {
    if (settle.current) clearTimeout(settle.current);
  }, []);

  const set = (v: number, animated: boolean) => {
    cur.current = v;
    anim.current?.stop();
    outer?.follow(v, animated);
    if (animated) {
      anim.current = Animated.timing(hidden, { toValue: v, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: false });
      anim.current.start();
    } else {
      hidden.setValue(v);
    }
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = Math.max(0, e.nativeEvent.contentOffset.y);
    const dy = y - lastY.current;
    lastY.current = y;
    if (!max) return;
    // Precies met de vinger mee, beide kanten op; bovenaan de lijst altijd helemaal zichtbaar
    const next = y <= 0 ? 0 : Math.min(max, Math.max(0, cur.current + dy), y);
    if (next !== cur.current) set(next, false);
    if (settle.current) clearTimeout(settle.current);
    settle.current = setTimeout(() => {
      // Halverwege blijven hangen staat rommelig: afmaken naar de kant die het dichtstbij is
      if (cur.current > 0 && cur.current < max) set(cur.current > max / 2 && lastY.current > max ? max : 0, true);
    }, 160);
  };

  return {
    max,
    scrollProps: { onScroll, scrollEventThrottle: 16 },
    // Zoveel ruimte moet de lijst bovenaan houden voor het blok (en het blok erboven)
    padTop: above + height,
    blockProps: {
      onLayout: (e: LayoutChangeEvent) => {
        const h = Math.round(e.nativeEvent.layout.height);
        if (h && Math.abs(h - height) > 1) setHeight(h);
      },
      style: {
        position: "absolute" as const,
        top: above,
        left: 0,
        right: 0,
        zIndex: outer ? 4 : 5,
        transform: [{ translateY: Animated.multiply(hidden, -1) }],
      },
    },
    // Voor een blok eronder dat dit blok meestuurt
    follow: (v: number, animated: boolean) => {
      const own = Math.min(v, Math.max(0, height - keep));
      if (own === cur.current) return;
      cur.current = own;
      anim.current?.stop();
      if (animated) {
        anim.current = Animated.timing(hidden, { toValue: own, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: false });
        anim.current.start();
      } else {
        hidden.setValue(own);
      }
    },
    reset: () => {
      lastY.current = 0;
      set(0, true);
    },
  };
}
