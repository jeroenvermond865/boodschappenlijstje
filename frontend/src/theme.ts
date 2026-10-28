// Design tokens for ScoutKook. Light and dark theme (nature / scouting palette).
// Keys match the "color" block of /app/design_guidelines.json.

import { useMemo, useSyncExternalStore } from "react";
import { Appearance, StyleSheet } from "react-native";

export type ColorScheme = "light" | "dark";

const light = {
  surface: "#FCFAF8",
  onSurface: "#1C1B1A",
  surfaceSecondary: "#F2EFEA",
  onSurfaceSecondary: "#2C2A28",
  surfaceTertiary: "#E8E4DD",
  onSurfaceTertiary: "#3B3835",
  surfaceInverse: "#262423",
  onSurfaceInverse: "#F5F3EF",
  muted: "#757068",

  brand: "#3A6B44",
  onBrand: "#FFFFFF",
  brandPrimary: "#2E5E38",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#D99C3B",
  onBrandSecondary: "#1C1B1A",
  brandTertiary: "#E6F0E8",
  onBrandTertiary: "#1F4526",

  success: "#427A5B",
  onSuccess: "#FFFFFF",
  warning: "#C85A32",
  onWarning: "#FFFFFF",
  error: "#B83B3B",
  onError: "#FFFFFF",
  info: "#4A524D",
  onInfo: "#FFFFFF",

  border: "#E1DDD5",
  borderStrong: "#C7C1B5",
  divider: "#EBE7DF",

  // Zachte schaduw onder kaarten en knoppen
  shadow: "rgba(28, 27, 26, 0.07)",
};

export type ThemeColors = typeof light;

// Donkere modus: warm donker, met dezelfde groene en gouden accenten. Volgt de instelling van je telefoon.
const dark: ThemeColors = {
  surface: "#151614",
  onSurface: "#F2F0EC",
  surfaceSecondary: "#1C1E1B",
  onSurfaceSecondary: "#DAD6CF",
  surfaceTertiary: "#272A26",
  onSurfaceTertiary: "#CAC5BC",
  surfaceInverse: "#F2F0EC",
  onSurfaceInverse: "#1C1B1A",
  muted: "#9C978E",

  brand: "#4F8F5A",
  onBrand: "#FFFFFF",
  brandPrimary: "#5A9E66",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#E2AC52",
  onBrandSecondary: "#1C1B1A",
  brandTertiary: "#1E3223",
  onBrandTertiary: "#CDE6D2",

  success: "#5DA47B",
  onSuccess: "#FFFFFF",
  warning: "#D96D43",
  onWarning: "#FFFFFF",
  error: "#D65858",
  onError: "#FFFFFF",
  info: "#6E7771",
  onInfo: "#FFFFFF",

  border: "#2C2F2B",
  borderStrong: "#41453F",
  divider: "#242723",

  shadow: "rgba(0, 0, 0, 0.35)",
};

export const defaultScheme = "light" satisfies ColorScheme;

export const themes: { light: ThemeColors; dark?: ThemeColors } = { light, dark };

export const fonts = {
  regular: "PlusJakarta_400Regular",
  medium: "PlusJakarta_500Medium",
  semibold: "PlusJakarta_600SemiBold",
  bold: "PlusJakarta_700Bold",
};

export function setColorScheme(scheme: ColorScheme | null) {
  Appearance.setColorScheme?.(scheme ?? "unspecified");
}

setColorScheme?.(themes.dark ? null : defaultScheme);

// Eén luisteraar voor de hele app. useColorScheme van react-native-web meldt zich bij elke render opnieuw aan;
// wisselt je telefoon van licht naar donker, dan kregen daardoor maar een paar onderdelen het door en bleef de rest
// in de oude kleur hangen. Hier hoort iedereen het tegelijk.
function systemScheme(): ColorScheme {
  const s = Appearance.getColorScheme();
  return s === "dark" && themes.dark ? "dark" : s === "light" ? "light" : defaultScheme;
}
let currentScheme: ColorScheme = systemScheme();
const schemeListeners = new Set<() => void>();
Appearance.addChangeListener(() => {
  const next = systemScheme();
  if (next === currentScheme) return;
  currentScheme = next;
  [...schemeListeners].forEach((f) => f());
});
function subscribeScheme(f: () => void) {
  schemeListeners.add(f);
  return () => {
    schemeListeners.delete(f);
  };
}
export const getScheme = () => currentScheme;

export function useTheme(): { scheme: ColorScheme; colors: ThemeColors } {
  const scheme = useSyncExternalStore(subscribeScheme, getScheme, getScheme);
  return { scheme, colors: themes[scheme] ?? themes.light };
}

export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (colors: ThemeColors) => T & StyleSheet.NamedStyles<any>,
): () => T {
  return function useStyles(): T {
    const { colors } = useTheme();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}

// Zachte schaduw voor kaarten (in donkere modus vrijwel onzichtbaar, daar doet de rand het werk)
export function softShadow(colors: ThemeColors, lift = 1) {
  return {
    shadowColor: colors.shadow,
    shadowOpacity: 1,
    shadowRadius: 10 + lift * 6,
    shadowOffset: { width: 0, height: 2 + lift * 2 },
    elevation: lift * 2,
  };
}
