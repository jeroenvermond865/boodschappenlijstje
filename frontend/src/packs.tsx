import { Text } from "react-native";

import { euro } from "@/src/search";
import { fonts, makeStyles } from "@/src/theme";

// Hoeveel verpakkingen je nodig hebt, en of een andere verpakking voordeliger is (zie /packs/plan en de boodschappenlijst)
export type PackBetter = { product_id: string; name: string; image?: string | null; pack_unit: string; packs: number; pack_price: number; cost: number; saving: number };
export type PackPlan = { packs: number; pack_unit: string; pack_price: number; cost: number; better?: PackBetter | null };

export function packText(packs: number, unit?: string) {
  return `${packs}× ${unit ? `${unit} ` : ""}nodig`;
}

export function BetterPack({ better }: { better?: PackBetter | null }) {
  const styles = useStyles();
  if (!better) return null;
  return (
    <Text style={styles.better} numberOfLines={2}>
      Voordeliger: {better.packs}× {better.name}
      {better.pack_unit ? ` (${better.pack_unit})` : ""} · {euro(better.cost)}, {euro(better.saving)} minder
    </Text>
  );
}

const useStyles = makeStyles((colors) => ({
  better: { fontSize: 12, fontFamily: fonts.medium, color: colors.success, marginTop: 2 },
}));
