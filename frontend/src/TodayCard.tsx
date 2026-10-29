// Snel lijstje: voor wie even snel naar de winkel gaat. Op Home alleen een klein knopje; in het lijstje zelf voeg je
// producten toe en zie je wat je vaak koopt (en wat daarvan in de aanbieding is). Het begint elke dag opnieuw;
// wat je nog niet had, blijft staan. Geen personen: het gaat om boodschappen, niet om koken.
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import Image from "@/src/components/SafeImage";
import { useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Animated, { FadeIn } from "react-native-reanimated";

import { Icon } from "@/src/components/ui";
import { api } from "@/src/api";
import { euro } from "@/src/search";
import { useToast } from "@/src/toast";
import { useAuth } from "@/src/auth";
import { ExtraAddModal } from "@/app/camp/[id]";
import { ShopSwapSheet } from "@/src/ShopSwap";
import { QuickDishSheet } from "@/src/QuickDishSheet";
import { fonts, makeStyles, useTheme } from "@/src/theme";

type Often = { name: string; unit: string; aisle: string; store?: string | null; product_id?: string | null; n: number; image?: string | null; price?: number | null; promo?: string; promo_price?: number | null; on_list?: boolean };
export type Today = { list: { id: string; items: number } | null; people: number; often: Often[]; deals: Often[] };

export const useToday = () => useQuery({ queryKey: ["today"], queryFn: () => api<Today>("/today"), staleTime: 30 * 1000 });

// Op Home: één klein knopje
export function TodayCard() {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const { data } = useToday();
  const open = useMutation({
    mutationFn: () => api<{ id: string }>("/today", { method: "POST", body: {} }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["today"] });
      router.push(`/shopping/${r.id}`);
    },
    onError: (e: any) => toast.show(e?.message ?? "Mislukt", "error"),
  });
  const items = data?.list?.items ?? 0;
  const deals = data?.deals?.length ?? 0;
  return (
    <Pressable testID="today-open" onPress={() => open.mutate()} style={({ pressed }) => [styles.quick, pressed && { opacity: 0.85 }]}>
      <View style={styles.quickIcon}>
        <Icon name="lightning-bolt-outline" size={18} color={colors.brandPrimary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.quickTitle}>Snel lijstje</Text>
        <Text style={styles.small} numberOfLines={1}>
          {items ? `${items} ${items === 1 ? "product" : "producten"}` : "Even snel naar de winkel"}
          {deals ? ` · ${deals} in de aanbieding` : ""}
        </Text>
      </View>
      <Icon name="chevron-right" size={22} color={colors.muted} />
    </Pressable>
  );
}

// In het snelle lijstje zelf: iets toevoegen, en met één tik wat je vaak koopt
export function TodayPicks({ stores }: { stores: string[] }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const toast = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data } = useToday();
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [dishOpen, setDishOpen] = useState(false);
  const listId = data?.list?.id;
  const save = useMutation({
    mutationFn: () => api<{ id: string; name: string }>("/today/save", { method: "POST", body: {} }),
    onSuccess: (r) => {
      toast.show(`Bewaard bij je lijstjes als "${r.name}"`, "success");
      qc.invalidateQueries({ queryKey: ["today"] });
      qc.invalidateQueries({ queryKey: ["camps"] });
      router.replace(`/camp/${r.id}`);
    },
    onError: (e: any) => toast.show(e?.message ?? "Mislukt", "error"),
  });
  const add = useMutation({
    mutationFn: (o: { name: string; unit: string; aisle: string; qty?: number; product_id?: string | null; store?: string | null }) =>
      api<{ id: string; already?: boolean }>("/today/add", { method: "POST", body: { ...o, qty: o.qty ?? 1 } }),
    onSuccess: (r, o) => {
      toast.show(r.already ? `${o.name} staat er al op` : `${o.name} staat op je lijstje`, "success");
      qc.invalidateQueries({ queryKey: ["today"] });
      qc.invalidateQueries({ queryKey: ["shopping", r.id] });
    },
    onError: (e: any) => toast.show(e?.message ?? "Mislukt", "error"),
  });
  const often = data?.often ?? [];
  const deals = data?.deals ?? [];

  return (
    <View style={styles.card} testID="today-picks">
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Pressable testID="today-add" onPress={() => setAdding(true)} style={({ pressed }) => [styles.btn, { flex: 1 }, pressed && { opacity: 0.85 }]}>
          <Icon name="plus" size={18} color={colors.onBrandPrimary} />
          <Text style={styles.btnText}>Product</Text>
        </Pressable>
        <Pressable testID="today-dish" onPress={() => setDishOpen(true)} style={({ pressed }) => [styles.btn2, pressed && { opacity: 0.85 }]}>
          <Icon name="silverware-fork-knife" size={18} color={colors.brandPrimary} />
          <Text style={styles.btn2Text}>Gerecht</Text>
        </Pressable>
        <Pressable testID="today-scan" onPress={() => setScanning(true)} style={({ pressed }) => [styles.btn2, pressed && { opacity: 0.85 }]}>
          <Icon name="barcode-scan" size={18} color={colors.brandPrimary} />
          <Text style={styles.btn2Text}>Scan</Text>
        </Pressable>
      </View>

      {deals.length ? (
        <Animated.View entering={FadeIn} style={{ gap: 6 }}>
          <Text style={styles.sub}>In de aanbieding van wat je vaak koopt</Text>
          {deals.map((d) => (
            <Pressable key={`deal-${d.name}`} onPress={() => add.mutate(d)} style={styles.deal} testID="today-deal">
              {d.image ? <Image source={{ uri: d.image }} style={styles.img} resizeMode="contain" /> : <Icon name="tag-outline" size={22} color={colors.brandSecondary} />}
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>{d.name}</Text>
                <Text style={styles.promo} numberOfLines={1}>
                  {d.promo}
                  {d.promo_price ? ` · ${euro(d.promo_price)}` : ""}
                </Text>
              </View>
              <Icon name={d.on_list ? "check-circle" : "plus-circle-outline"} size={22} color={d.on_list ? colors.success : colors.brandPrimary} />
            </Pressable>
          ))}
        </Animated.View>
      ) : null}

      {often.length ? (
        <>
          <Text style={styles.sub}>Wat je vaak koopt</Text>
          <View style={styles.chips}>
            {often.map((o, i) => (
              <Animated.View key={o.name} entering={FadeIn.delay(Math.min(i, 10) * 30)}>
                <Pressable onPress={() => add.mutate(o)} style={[styles.chip, o.on_list && styles.chipOn]} testID="today-often">
                  <Icon name={o.on_list ? "check" : "plus"} size={14} color={o.on_list ? colors.success : colors.brandPrimary} />
                  <Text style={styles.chipText} numberOfLines={1}>{o.name}</Text>
                  {o.promo ? <Icon name="tag" size={13} color={colors.brandSecondary} /> : null}
                </Pressable>
              </Animated.View>
            ))}
          </View>
        </>
      ) : (
        <Text style={styles.small}>Vink in de winkel af wat je koopt. Dan onthoudt de app wat je vaak haalt, en zet je het hier met één tik op je lijstje.</Text>
      )}

      {data?.list ? (
        <Pressable testID="today-save" onPress={() => save.mutate()} disabled={save.isPending} style={styles.saveLink}>
          <Icon name="content-save-outline" size={16} color={colors.brandPrimary} />
          <Text style={styles.saveText}>Bewaar bij mijn lijstjes</Text>
        </Pressable>
      ) : null}

      <ShopSwapSheet
        item={scanning ? { name: "" } : null}
        store={user?.store ?? "Albert Heijn"}
        title="Product toevoegen"
        onClose={() => setScanning(false)}
        onPick={(p) => {
          add.mutate({ name: p.name, unit: (p as any).unit ?? "stuks", aisle: (p as any).aisle ?? "Overig", product_id: p.id, store: (p as any).source ?? null });
        }}
      />
      <QuickDishSheet visible={dishOpen} listId={listId} onClose={() => setDishOpen(false)} />
      <ExtraAddModal
        visible={adding}
        stores={stores}
        defaultStore={user?.store}
        onClose={() => setAdding(false)}
        onAdd={(ex) => {
          setAdding(false);
          add.mutate({ name: ex.name, unit: ex.unit, aisle: ex.aisle, qty: ex.qty, product_id: ex.product_id, store: ex.store });
        }}
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  quick: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: colors.brandTertiary },
  quickIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  quickTitle: { fontSize: 15, fontFamily: fonts.semibold, color: colors.onSurface },
  card: { gap: 12, borderRadius: 20, padding: 16, backgroundColor: colors.brandTertiary },
  small: { fontSize: 13, lineHeight: 18, fontFamily: fonts.regular, color: colors.muted },
  sub: { fontSize: 13, fontFamily: fonts.semibold, color: colors.onSurfaceSecondary, marginTop: 2 },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.brandPrimary, borderRadius: 14, paddingVertical: 12 },
  btnText: { fontSize: 15, fontFamily: fonts.semibold, color: colors.onBrandPrimary },
  btn2: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: colors.surface, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 12 },
  btn2Text: { fontSize: 14, fontFamily: fonts.semibold, color: colors.brandPrimary },
  saveLink: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start" },
  saveText: { fontSize: 14, fontFamily: fonts.semibold, color: colors.brandPrimary },
  deal: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surface, borderRadius: 12, padding: 8 },
  img: { width: 34, height: 34, borderRadius: 8, backgroundColor: "#fff" },
  name: { fontSize: 14, fontFamily: fonts.semibold, color: colors.onSurface },
  promo: { fontSize: 12, fontFamily: fonts.semibold, color: colors.brandSecondary },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, maxWidth: 200, paddingVertical: 7, paddingHorizontal: 11, borderRadius: 999, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  chipOn: { borderColor: colors.success },
  chipText: { fontSize: 13, fontFamily: fonts.medium, color: colors.onSurface, flexShrink: 1 },
}));
