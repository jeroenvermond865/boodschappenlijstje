// Op een laptop of pc is het scherm veel breder dan een telefoon: de app blijft in het midden
// (maximaal APP_MAX_WIDTH breed) en tegels worden niet groter, er komen er meer naast elkaar.
import { useWindowDimensions } from "react-native";

export const APP_MAX_WIDTH = 1100;

export function useGrid(minTile = 170, gap = 10, padding = 16) {
  const { width } = useWindowDimensions();
  const inner = Math.min(width, APP_MAX_WIDTH) - padding * 2;
  const cols = Math.max(2, Math.min(6, Math.floor((inner + gap) / (minTile + gap))));
  const tile = Math.floor((inner - gap * (cols - 1)) / cols);
  return { cols, tile };
}
