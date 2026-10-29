// Overal in de app opzij vegen, soepel met de vinger mee:
// - op de tabbladen (Home, Lijstjes, ...) naar het volgende of vorige tabblad
// - bij voorwaarden, privacy, cookies en herroepen naar het volgende stuk
// - op andere schermen naar rechts vegen om terug te gaan (op de iPhone doet de app dat zelf al)
// Onderdelen die zelf opzij bewegen (een rij om opzij te scrollen, de dagen van een lijstje) gaan voor.
import type { ReactNode } from "react";
import { Animated, Platform } from "react-native";
import { router, useGlobalSearchParams, useSegments } from "expo-router";

import { useSwipePages } from "@/src/useSwipePages";

const TAB_PATHS = ["/", "/camps", "/dishes", "/products", "/account"] as const;
const TAB_NAMES = ["index", "camps", "dishes", "products", "account"];
export const LEGAL_ORDER = ["voorwaarden", "privacy", "cookies", "herroepen"] as const;

// Op een computer met muis niet: dan zou tekst selecteren per ongeluk van pagina wisselen
const touch = Platform.OS !== "web" || (typeof window !== "undefined" && ("ontouchstart" in window || (navigator as any)?.maxTouchPoints > 0));

// Op de website: begon het vegen in een rij die zelf opzij scrolt? Dan is het vegen voor die rij
function inSideScroller(e: any): boolean {
  if (Platform.OS !== "web") return false;
  let el = e?.nativeEvent?.target as HTMLElement | null;
  while (el && el !== document.body) {
    if (el.scrollWidth > el.clientWidth + 2) {
      const ox = getComputedStyle(el).overflowX;
      if (ox === "auto" || ox === "scroll") return true;
    }
    el = el.parentElement;
  }
  return false;
}

export function SwipeNav({ children }: { children: ReactNode }) {
  const segments = useSegments() as string[];
  const params = useGlobalSearchParams<{ doc?: string }>();
  const where = segments[0] === "(tabs)" ? "tabs" : segments[0] === "legal" ? "legal" : segments[0] === "login" || segments[0] === "welcome" ? "none" : "page";
  const tab = Math.max(0, TAB_NAMES.indexOf(segments[1] ?? "index"));
  const legal = Math.max(0, LEGAL_ORDER.indexOf((params.doc ?? "voorwaarden") as any));

  const can = (dir: 1 | -1) => {
    if (where === "tabs") return tab + dir >= 0 && tab + dir < TAB_PATHS.length;
    if (where === "legal") return legal + dir >= 0 && legal + dir < LEGAL_ORDER.length;
    // Terug met naar rechts vegen; op de iPhone en Android heeft de app daar zelf al een veeggebaar voor
    return where === "page" && dir === -1 && Platform.OS === "web" && router.canGoBack();
  };
  const go = (dir: 1 | -1) => {
    if (where === "tabs") router.navigate(TAB_PATHS[tab + dir] as any);
    else if (where === "legal") router.setParams({ doc: LEGAL_ORDER[legal + dir] });
    else router.back();
  };
  const swipe = useSwipePages(can, go, { yield: true, enabled: (e) => touch && !inSideScroller(e) });
  return (
    <Animated.View style={[{ flex: 1 }, swipe.style]} {...swipe.panHandlers}>
      {children}
    </Animated.View>
  );
}
