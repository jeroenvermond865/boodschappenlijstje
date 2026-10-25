import { useState } from "react";
import { Image, Modal, Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "@/src/components/ui";
import { euro } from "@/src/search";
import { fonts, makeStyles, useTheme } from "@/src/theme";

// Hoeveel verpakkingen je nodig hebt, en of een andere verpakking voordeliger is (zie /packs/plan en de boodschappenlijst)
export type PackBetter = { product_id: string; name: string; image?: string | null; pack_unit: string; packs: number; pack_price: number; cost: number; saving: number };
export type PackPlan = { packs: number; pack_unit: string; pack_price: number; cost: number; better?: PackBetter | null };

export function packText(packs: number, unit?: string) {
  return `${packs}× ${unit ? `${unit} ` : ""}nodig`;
}

// Tik op de groene regel: dan zie je het voordeligere product en kun je het bekijken of meteen wisselen
export function BetterPack({ better, current, onSwap }: { better?: PackBetter | null; current?: string; onSwap?: (b: PackBetter) => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  if (!better) return null;
  return (
    <>
      <Pressable onPress={() => setOpen(true)} hitSlop={4} style={styles.line}>
        <Icon name="tag-arrow-down-outline" size={14} color={colors.success} />
        <Text style={styles.better} numberOfLines={2}>
          Voordeliger: {better.packs}× {better.name}
          {better.pack_unit ? ` (${better.pack_unit})` : ""} · {euro(better.cost)}, {euro(better.saving)} minder
        </Text>
        <Icon name="chevron-right" size={14} color={colors.success} />
      </Pressable>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]} onPress={() => {}}>
            <View style={styles.head}>
              <Text style={styles.title}>Voordeliger alternatief</Text>
              <Pressable onPress={() => setOpen(false)} hitSlop={10}>
                <Icon name="close" size={22} color={colors.muted} />
              </Pressable>
            </View>
            <View style={styles.card}>
              {better.image ? <Image source={{ uri: better.image }} style={styles.img} resizeMode="contain" /> : <View style={styles.img} />}
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.name}>{better.name}</Text>
                <Text style={styles.sub}>
                  {better.pack_unit ? `${better.pack_unit} · ` : ""}
                  {euro(better.pack_price)} per stuk
                </Text>
                <Text style={styles.sub}>
                  {packText(better.packs, better.pack_unit)} · {euro(better.cost)}
                </Text>
                <Text style={styles.better}>{euro(better.saving)} goedkoper{current ? ` dan ${current}` : ""}</Text>
              </View>
            </View>
            <View style={styles.row}>
              <Pressable
                onPress={() => {
                  setOpen(false);
                  router.push(`/product/${better.product_id}`);
                }}
                style={[styles.btn, styles.btnGhost]}
              >
                <Text style={styles.btnGhostText}>Bekijken</Text>
              </Pressable>
              {onSwap ? (
                <Pressable
                  onPress={() => {
                    setOpen(false);
                    onSwap(better);
                  }}
                  style={[styles.btn, styles.btnMain]}
                >
                  <Icon name="swap-horizontal" size={18} color={colors.onBrandPrimary} />
                  <Text style={styles.btnMainText}>Wisselen</Text>
                </Pressable>
              ) : null}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const useStyles = makeStyles((colors) => ({
  line: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2, alignSelf: "flex-start" },
  better: { fontSize: 12, fontFamily: fonts.medium, color: colors.success, flexShrink: 1 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, gap: 14 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: 18, fontFamily: fonts.bold, color: colors.onSurface },
  card: { flexDirection: "row", gap: 12, alignItems: "center", padding: 12, borderRadius: 14, borderWidth: 1, borderColor: colors.border },
  img: { width: 64, height: 64, borderRadius: 10, backgroundColor: colors.surfaceSecondary },
  name: { fontSize: 15, fontFamily: fonts.semibold, color: colors.onSurface },
  sub: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted },
  row: { flexDirection: "row", gap: 10 },
  btn: { flex: 1, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", paddingVertical: 13, borderRadius: 14 },
  btnGhost: { borderWidth: 1, borderColor: colors.border },
  btnGhostText: { fontSize: 15, fontFamily: fonts.semibold, color: colors.brandPrimary },
  btnMain: { backgroundColor: colors.brandPrimary },
  btnMainText: { fontSize: 15, fontFamily: fonts.semibold, color: colors.onBrandPrimary },
}));
