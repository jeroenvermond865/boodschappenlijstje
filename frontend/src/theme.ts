// Design tokens for ScoutKook. Light theme (nature / scouting palette).
// Keys match the "color" block of /app/design_guidelines.json.

import { useMemo } from "react";
import { Appearance, StyleSheet, useColorScheme } from "react-native";

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
};

export type ThemeColors = typeof light;

export const defaultScheme = "light" satisfies ColorScheme;

export const themes: { light: ThemeColors; dark?: ThemeColors } = { light };

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

export function useTheme(): { scheme: ColorScheme; colors: ThemeColors } {
  const system = useColorScheme();
  const scheme: ColorScheme = system && themes[system] ? system : defaultScheme;
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
