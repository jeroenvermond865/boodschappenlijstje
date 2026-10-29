// Opzij vegen naar de vorige of volgende pagina (bijv. de dagen van een lijstje).
// De inhoud schuift met de vinger mee; laat je ver genoeg los, dan schuift hij weg en komt de volgende
// van de andere kant binnen. Omhoog en omlaag scrollen blijft gewoon werken.
import { useRef } from "react";
import { Animated, Easing, PanResponder, Platform, useWindowDimensions } from "react-native";

const native = Platform.OS !== "web";

export function useSwipePages(can: (dir: 1 | -1) => boolean, go: (dir: 1 | -1) => void, opts?: { yield?: boolean; enabled?: (e: any) => boolean }) {
  // can: is er een volgende/vorige pagina? Zo niet, dan veert de inhoud terug. go: wissel echt van pagina
  // yield: eerst de onderdelen erin laten kiezen (opzij scrollen, dagen van een lijstje); dit vangt pas wat over blijft
  const capture = !opts?.yield;
  const enabled = useRef(opts?.enabled);
  enabled.current = opts?.enabled;
  const { width } = useWindowDimensions();
  const x = useRef(new Animated.Value(0)).current;
  const cb = useRef({ can, go });
  cb.current = { can, go };
  const w = useRef(width);
  w.current = Math.min(width, 700);

  const slideIn = (dir: 1 | -1) => {
    // De nieuwe pagina komt van de kant waar je naartoe veegt
    x.setValue(dir * w.current * 0.25);
    Animated.timing(x, { toValue: 0, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: native }).start();
  };

  const pan = useRef(
    PanResponder.create({
      ...(capture
        ? { onMoveShouldSetPanResponderCapture: (_e: any, g: any) => Math.abs(g.dx) > 14 && Math.abs(g.dx) > Math.abs(g.dy) * 1.8 }
        : {
            onMoveShouldSetPanResponder: (e: any, g: any) =>
              (enabled.current?.(e) ?? true) && Math.abs(g.dx) > 18 && Math.abs(g.dx) > Math.abs(g.dy) * 2 && cb.current.can(g.dx < 0 ? 1 : -1),
          }),
      onPanResponderMove: (_e, g) => {
        // Met de vinger mee, maar nooit verder dan een stukje; kan het die kant niet op, dan voelt het stug
        const ok = cb.current.can(g.dx < 0 ? 1 : -1);
        const max = w.current * (ok ? 0.35 : 0.08);
        const d = g.dx * (ok ? 0.55 : 0.15);
        x.setValue(Math.max(-max, Math.min(max, d)));
      },
      onPanResponderTerminationRequest: () => false,
      onPanResponderRelease: (_e, g) => {
        const far = Math.abs(g.dx) > Math.min(90, w.current * 0.22) || Math.abs(g.vx) > 0.5;
        const dir: 1 | -1 = g.dx < 0 ? 1 : -1; // naar links vegen = volgende
        if (far && cb.current.can(dir)) {
          Animated.timing(x, { toValue: -dir * w.current * 0.4, duration: 120, easing: Easing.in(Easing.quad), useNativeDriver: native }).start(() => {
            cb.current.go(dir);
            slideIn(dir);
          });
        } else {
          Animated.spring(x, { toValue: 0, useNativeDriver: native, speed: 20, bounciness: 4 }).start();
        }
      },
      onPanResponderTerminate: () => Animated.spring(x, { toValue: 0, useNativeDriver: native, speed: 20, bounciness: 0 }).start(),
    }),
  ).current;

  return {
    panHandlers: pan.panHandlers,
    style: {
      transform: [{ translateX: x }],
      opacity: x.interpolate({ inputRange: [-400, 0, 400], outputRange: [0.4, 1, 0.4], extrapolate: "clamp" }),
    },
    // Ook bij tikken op een dag even laten schuiven
    slideIn,
  };
}
