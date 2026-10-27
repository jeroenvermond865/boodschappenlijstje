// Op Home: voor wie (bijna) elke dag even boodschappen doet. Eén lijstje voor vandaag, met wat je vaak koopt
// en wat daarvan vandaag in de aanbieding is. Het lijstje begint elke dag opnieuw; wat je nog niet had, blijft staan.
import { Pressable, Text, View } from "react-native";
import Image from "@/src/components/SafeImage";
import { useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Animated, { FadeIn, ZoomIn } from "react-native-reanimated";

import { Icon } from "@/src/components/ui";
import { api } from "@/src/api";
import { euro } from "@/src/search";
import { useToast } from "@/src/toast";
import { fonts, makeStyles, useTheme } from "@/src/theme";

type Often = { name: string; unit: string; aisle: string; store?: string | null; product_id?: string | null; n: number; image?: string | null; price?: number | null; promo?: string; promo_price?: number | null; on_list?: boolean };
type Today = { list: { id: string; items: number } | null; people: number; often: Often[]; deals: Often[] };

export function TodayCard() {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["today"], queryFn: () => api<Today>("/today"), staleTime: 30 * 1000 });

  const open = useMutation({
    mutationFn: (people?: number) => api<{ id: string; people: number }>("/today", { method: "POST", body: { people } }),
    onSuccess: (r, people) => {
      qc.invalidateQueries({ queryKey: ["today"] });
      qc.invalidateQueries({ queryKey: ["shopping", r.id] });
      if (people == null) router.push(`/shopping/${r.id}`);
    },
    onError: (e: any) => toast.show(e?.message ?? "Mislukt", "error"),
  });
  const add = useMutation({
    mutationFn: (o: Often) =>
      api<{ id: string; already?: boolean }>("/today/add", { method: "POST", body: { name: o.name, unit: o.unit, aisle: o.aisle, product_id: o.product_id, store: o.store } }),
    onSuccess: (r, o) => {
      toast.show(r.already ? `${o.name} staat er al op` : `${o.name} op je lijstje voor vandaag`, "success");
      qc.invalidateQueries({ queryKey: ["today"] });
      qc.invalidateQueries({ queryKey: ["shopping", r.id] });
    },
    onError: (e: any) => toast.show(e?.message ?? "Mislukt", "error"),
  });

  const people = data?.people ?? 2;
  const items = data?.list?.items ?? 0;
  const often = data?.often ?? [];
  const deals = data?.deals ?? [];

  return (
    <View style={styles.card} testID="today-card">
      <View style={styles.head}>
        <View style={styles.icon}>
          <Icon name="weather-sunny" size={22} color={colors.brandPrimary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Vandaag</Text>
          <Text style={styles.small}>Even snel naar de winkel? Alles voor vandaag op één lijstje.</Text>
        </View>
      </View>

      {/* Kleine porties: voor hoeveel personen je vandaag kookt */}
      <View style={styles.people}>
        <Text style={styles.label}>Voor</Text>
        <Pressable testID="today-people-min" disabled={people <= 1} onPress={() => open.mutate(people - 1)} hitSlop={8} style={[styles.step, people <= 1 && { opacity: 0.4 }]}>
          <Icon name="minus" size={18} color={colors.brandPrimary} />
        </Pressable>
        <Animated.Text key={people} entering={ZoomIn.duration(180)} style={styles.peopleN}>{people}</Animated.Text>
        <Pressable testID="today-people-plus" disabled={people >= 12} onPress={() => open.mutate(people + 1)} hitSlop={8} style={styles.step}>
          <Icon name="plus" size={18} color={colors.brandPrimary} />
        </Pressable>
        <Text style={styles.label}>{people === 1 ? "persoon" : "personen"}</Text>
      </View>

      <Pressable testID="today-open" onPress={() => open.mutate(undefined)} style={({ pressed }) => [styles.btn, pressed && { opacity: 0.85 }]}>
        <Icon name="format-list-checks" size={18} color={colors.onBrandPrimary} />
        <Text style={styles.btnText}>{items ? `Lijstje voor vandaag (${items})` : "Lijstje voor vandaag"}</Text>
      </Pressable>

      {deals.length ? (
        <Animated.View entering={FadeIn} style={{ gap: 6 }}>
          <Text style={styles.sub}>Vandaag in de aanbieding van wat je vaak koopt</Text>
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

      <Text style={styles.sub}>Wat je vaak koopt</Text>
      {often.length ? (
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
      ) : (
        <Text style={styles.small}>Vink in de winkel af wat je koopt. Dan onthoudt de app wat je vaak haalt, en zet je het hier met één tik op je lijstje.</Text>
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  card: { gap: 12, borderRadius: 20, padding: 16, backgroundColor: colors.brandTertiary },
  head: { flexDirection: "row", alignItems: "center", gap: 12 },
  icon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 17, fontFamily: fonts.bold, color: colors.onSurface },
  small: { fontSize: 13, lineHeight: 18, fontFamily: fonts.regular, color: colors.muted },
  sub: { fontSize: 13, fontFamily: fonts.semibold, color: colors.onSurfaceSecondary, marginTop: 2 },
  label: { fontSize: 14, fontFamily: fonts.medium, color: colors.onSurface },
  people: { flexDirection: "row", alignItems: "center", gap: 10 },
  step: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  peopleN: { minWidth: 20, textAlign: "center", fontSize: 17, fontFamily: fonts.bold, color: colors.onSurface },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.brandPrimary, borderRadius: 14, paddingVertical: 12 },
  btnText: { fontSize: 15, fontFamily: fonts.semibold, color: colors.onBrandPrimary },
  deal: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surface, borderRadius: 12, padding: 8 },
  img: { width: 34, height: 34, borderRadius: 8, backgroundColor: "#fff" },
  name: { fontSize: 14, fontFamily: fonts.semibold, color: colors.onSurface },
  promo: { fontSize: 12, fontFamily: fonts.semibold, color: colors.brandSecondary },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, maxWidth: 200, paddingVertical: 7, paddingHorizontal: 11, borderRadius: 999, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  chipOn: { borderColor: colors.success },
  chipText: { fontSize: 13, fontFamily: fonts.medium, color: colors.onSurface, flexShrink: 1 },
}));
