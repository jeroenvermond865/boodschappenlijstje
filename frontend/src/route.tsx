// Looproute (Premium): de boodschappenlijst in de volgorde waarin je door de winkel loopt.
// Per winkel een gewone indeling; zelf aanpassen kan, dat wordt op dit toestel onthouden.
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import Modal from "@/src/components/Modal";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "@/src/components/ui";
import { AISLE_ICONS } from "@/src/constants";
import { storage } from "@/src/utils/storage";
import { fonts, makeStyles, useTheme } from "@/src/theme";

const BASE = [
  "Aardappelen, groente & fruit",
  "Brood, beleg & koek",
  "Vlees & vis",
  "Maaltijden, salades & tapas",
  "Zuivel & kaas",
  "Voorraadkast",
  "Snacks & snoep",
  "Dranken, sap, koffie & thee",
  "Kind & drogisterij",
  "Huishoud & huisdieren",
  "Non food",
  "Overig",
  "Diepvries",
];

// Zo ongeveer ligt een gewone winkel ingedeeld: vers bij de ingang, diepvries als laatste
export const DEFAULT_ROUTE: Record<string, string[]> = {
  "Albert Heijn": BASE,
  Jumbo: BASE,
  Dirk: [
    "Aardappelen, groente & fruit",
    "Vlees & vis",
    "Maaltijden, salades & tapas",
    "Zuivel & kaas",
    "Brood, beleg & koek",
    "Voorraadkast",
    "Dranken, sap, koffie & thee",
    "Snacks & snoep",
    "Huishoud & huisdieren",
    "Kind & drogisterij",
    "Non food",
    "Overig",
    "Diepvries",
  ],
};

const KEY = "route_v1";
const storeOf = (s: string) => s.replace(/^alg:/, "");

export function useRoute() {
  const [on, setOnState] = useState(false);
  const [custom, setCustom] = useState<Record<string, string[]>>({});
  useEffect(() => {
    storage.getItem<string | null>(KEY, null).then((raw) => {
      if (!raw) return;
      try {
        const v = JSON.parse(raw);
        setOnState(!!v.on);
        setCustom(v.custom ?? {});
      } catch {}
    });
  }, []);
  const save = (next: { on: boolean; custom: Record<string, string[]> }) => storage.setItem(KEY, JSON.stringify(next));
  const order = (store: string) => custom[storeOf(store)] ?? DEFAULT_ROUTE[storeOf(store)] ?? BASE;
  return {
    version: JSON.stringify(custom),
    on,
    setOn: (v: boolean) => {
      setOnState(v);
      save({ on: v, custom });
    },
    order,
    setOrder: (store: string, list: string[] | null) => {
      const next = { ...custom };
      if (list) next[storeOf(store)] = list;
      else delete next[storeOf(store)];
      setCustom(next);
      save({ on, custom: next });
    },
    sort: <G extends { aisle: string }>(store: string, groups: G[]) => {
      const o = order(store);
      const rank = (a: string) => (o.includes(a) ? o.indexOf(a) : o.length);
      return [...groups].sort((a, b) => rank(a.aisle) - rank(b.aisle));
    },
  };
}

export function RouteSheet({ store, order, onChange, onClose }: { store: string; order: string[]; onChange: (o: string[] | null) => void; onClose: () => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]} onPress={() => {}}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Text style={[styles.title, { flex: 1 }]}>Looproute {storeOf(store)}</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Icon name="close" size={22} color={colors.muted} />
            </Pressable>
          </View>
          <Text style={styles.sub}>Zet de afdelingen in de volgorde waarin je door jouw winkel loopt.</Text>
          <ScrollView style={{ maxHeight: 420 }}>
            {order.map((a, i) => (
              <View key={a} style={styles.row}>
                <Icon name={(AISLE_ICONS[a] ?? "cart-outline") as any} size={18} color={colors.brandSecondary} />
                <Text style={styles.name}>{a}</Text>
                <Pressable onPress={() => move(i, -1)} hitSlop={6} disabled={i === 0} style={{ opacity: i === 0 ? 0.3 : 1 }}>
                  <Icon name="chevron-up" size={22} color={colors.onSurface} />
                </Pressable>
                <Pressable onPress={() => move(i, 1)} hitSlop={6} disabled={i === order.length - 1} style={{ opacity: i === order.length - 1 ? 0.3 : 1 }}>
                  <Icon name="chevron-down" size={22} color={colors.onSurface} />
                </Pressable>
              </View>
            ))}
          </ScrollView>
          <Pressable onPress={() => onChange(null)} style={{ paddingVertical: 6 }}>
            <Text style={styles.link}>Standaardvolgorde terugzetten</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center" },
  sheet: { backgroundColor: colors.surface, borderRadius: 20, width: "92%", maxWidth: 560, alignSelf: "center", marginVertical: "auto", maxHeight: "92%", padding: 16, gap: 10, width: "100%", maxWidth: 640, alignSelf: "center" },
  title: { fontSize: 17, fontFamily: fonts.bold, color: colors.onSurface },
  sub: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.divider },
  name: { flex: 1, fontSize: 14, fontFamily: fonts.medium, color: colors.onSurface },
  link: { fontSize: 14, fontFamily: fonts.semibold, color: colors.brandPrimary },
}));
