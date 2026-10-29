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
    // De nieuwe pagina komt van de kant waar je naartoe veegt, rustig uitlopend
    x.stopAnimation();
    x.setValue(dir * w.current * 0.3);
    Animated.timing(x, { toValue: 0, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: native }).start();
  };

  // Waar de vinger was toen het vegen begon: anders springt de inhoud bij de eerste beweging een stuk opzij
  const start = useRef(0);

  const pan = useRef(
    PanResponder.create({
      ...(capture
        ? { onMoveShouldSetPanResponderCapture: (_e: any, g: any) => Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.6 }
        : {
            onMoveShouldSetPanResponder: (e: any, g: any) =>
              (enabled.current?.(e) ?? true) && Math.abs(g.dx) > 14 && Math.abs(g.dx) > Math.abs(g.dy) * 1.8 && cb.current.can(g.dx < 0 ? 1 : -1),
          }),
      onPanResponderGrant: (_e, g) => {
        x.stopAnimation();
        start.current = g.dx;
      },
      onPanResponderMove: (_e, g) => {
        // Strak met de vinger mee; kan het die kant niet op, dan voelt het stug (rubberband)
        const dx = g.dx - start.current;
        const ok = cb.current.can(dx < 0 ? 1 : -1);
        if (ok) x.setValue(Math.max(-w.current, Math.min(w.current, dx * 0.9)));
        else x.setValue((Math.sign(dx) * w.current * 0.08 * Math.abs(dx)) / (Math.abs(dx) + w.current * 0.3));
      },
      onPanResponderTerminationRequest: () => false,
      onPanResponderRelease: (_e, g) => {
        const dx = g.dx - start.current;
        const far = Math.abs(dx) > Math.min(80, w.current * 0.2) || (Math.abs(g.vx) > 0.35 && Math.abs(dx) > 24);
        const dir: 1 | -1 = dx < 0 ? 1 : -1; // naar links vegen = volgende
        if (far && cb.current.can(dir)) {
          // Doorlopen in het tempo van de vinger, dan wisselen en de nieuwe pagina laten binnenschuiven
          const rest = w.current * 0.6 - Math.abs(dx * 0.9);
          const speed = Math.max(0.8, Math.abs(g.vx)); // pixels per ms
          const duration = Math.max(80, Math.min(180, rest / speed));
          Animated.timing(x, { toValue: -dir * w.current * 0.6, duration, easing: Easing.out(Easing.quad), useNativeDriver: native }).start(() => {
            cb.current.go(dir);
            // Eén beeld wachten, zodat de nieuwe pagina al getekend is voordat hij gaat schuiven
            requestAnimationFrame(() => slideIn(dir));
          });
        } else {
          Animated.spring(x, { toValue: 0, useNativeDriver: native, speed: 18, bounciness: 3, velocity: g.vx }).start();
        }
      },
      onPanResponderTerminate: () => Animated.spring(x, { toValue: 0, useNativeDriver: native, speed: 20, bounciness: 0 }).start(),
    }),
  ).current;

  return {
    panHandlers: pan.panHandlers,
    style: {
      transform: [{ translateX: x }],
      opacity: x.interpolate({ inputRange: [-500, 0, 500], outputRange: [0.55, 1, 0.55], extrapolate: "clamp" }),
    },
    // Ook bij tikken op een dag even laten schuiven
    slideIn,
  };
}
