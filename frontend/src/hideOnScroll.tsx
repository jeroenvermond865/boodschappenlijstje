// Bovenbalk die meeschuift: scroll je naar beneden, dan schuift het blok mee omhoog uit beeld.
// Scroll je weer omhoog (ook halverwege de lijst), dan komt het meteen terug.
import { useRef, useState } from "react";
import { Animated, Easing, LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from "react-native";

export function useHideOnScroll(keep = 0) {
  // keep: zoveel pixels blijven staan (bijv. de ruimte voor de statusbalk)
  const [height, setHeight] = useState(0);
  const hidden = useRef(new Animated.Value(0)).current; // hoeveel pixels van het blok uit beeld is
  const cur = useRef(0);
  const lastY = useRef(0);
  const anim = useRef<Animated.CompositeAnimation | null>(null);

  const to = (v: number) => {
    if (cur.current === v) return;
    cur.current = v;
    anim.current?.stop();
    anim.current = Animated.timing(hidden, { toValue: v, duration: 180, easing: Easing.out(Easing.cubic), useNativeDriver: false });
    anim.current.start();
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = Math.max(0, e.nativeEvent.contentOffset.y);
    const dy = y - lastY.current;
    lastY.current = y;
    if (!height) return;
    if (y <= 4) return to(0);
    if (dy < -3) return to(0); // omhoog: meteen terug
    const max = Math.max(0, height - keep);
    if (dy > 0 && cur.current < max) {
      // omlaag: schuift met de lijst mee
      anim.current?.stop();
      cur.current = Math.min(max, cur.current + dy);
      hidden.setValue(cur.current);
    }
  };

  return {
    scrollProps: { onScroll, scrollEventThrottle: 16 },
    blockProps: {
      onLayout: (e: LayoutChangeEvent) => {
        const h = Math.round(e.nativeEvent.layout.height);
        if (h && Math.abs(h - height) > 1) setHeight(h);
      },
      style: { marginTop: Animated.multiply(hidden, -1), zIndex: 0 },
    },
    reset: () => to(0),
  };
}
