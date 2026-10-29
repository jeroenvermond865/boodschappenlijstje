// Bovenaan de boodschappenlijst: wat in je voorraadkast bijna op is. Met één tik zet je het op deze lijst.
// Op Home (compact) een smalle balk met knopjes; tik op een product voor de details, een alternatief of een ander product.
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import Image from "@/src/components/SafeImage";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button, Icon } from "@/src/components/ui";
import { api } from "@/src/api";
import { formatQty } from "@/src/constants";
import { useFeature } from "@/src/premium";
import { ProductPopup } from "@/src/ProductPopup";
import { ExtraAddModal } from "@/app/camp/[id]";
import { useToast } from "@/src/toast";
import { fonts, makeStyles, useTheme } from "@/src/theme";

type Low = { id: string; name: string; qty: number; unit: string; image?: string | null; product_id?: string | null; product_name?: string | null; buy: number; buy_unit: string };

export function RestockCard({ campId, compact }: { campId: string; compact?: boolean }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const premium = useFeature("voorraadkast");
  const toast = useToast();
  const qc = useQueryClient();
  const [off, setOff] = useState<Set<string>>(new Set());
  const { data } = useQuery({
    queryKey: ["pantry-restock", campId],
    queryFn: () => api<{ items: Low[] }>(`/pantry/restock?camp_id=${encodeURIComponent(campId)}`),
    enabled: premium,
  });
  const [pick, setPick] = useState<Low | null>(null); // product in de popup
  const [other, setOther] = useState<Low | null>(null); // een ander product kiezen voor dit voorraadproduct
  const add = useMutation({
    mutationFn: (v: string[] | { ids: string[]; product_id?: string | null }) =>
      api<{ added: number }>(`/camps/${campId}/restock`, { method: "POST", body: Array.isArray(v) ? { ids: v } : v }),
    onSuccess: (r) => {
      toast.show(`${r.added} ${r.added === 1 ? "product" : "producten"} uit je voorraadkast op de lijst gezet`, "success");
      qc.invalidateQueries({ queryKey: ["pantry-restock", campId] });
      qc.invalidateQueries({ queryKey: ["shopping", campId] });
      qc.invalidateQueries({ queryKey: ["camp", campId] });
    },
    onError: (e: any) => toast.show(e?.message ?? "Mislukt", "error"),
  });
  const all = data?.items ?? [];
  if (!premium || !all.length) return null;
  if (compact) {
    return (
      <View style={styles.bar} testID="restock-card">
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Icon name="fridge-alert-outline" size={16} color={colors.warning} />
          <Text style={styles.barTitle}>Bijna op</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          {all.map((i) => (
            <Pressable
              key={i.id}
              testID="restock-chip"
              onPress={() => (i.product_id ? setPick(i) : setOther(i))}
              style={({ pressed }) => [styles.chip, pressed && { opacity: 0.7 }]}
            >
              {i.image ? <Image source={{ uri: i.image }} style={styles.chipImg} resizeMode="contain" /> : null}
              <Text style={styles.chipText} numberOfLines={1}>{i.name}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <ProductPopup
          productId={pick?.product_id ?? null}
          onClose={() => setPick(null)}
          addLabel={pick ? `Op je lijst (${formatQty(pick.buy)} ${pick.buy_unit})` : "Op je lijst"}
          onAdd={() => {
            if (pick) add.mutate([pick.id]);
            setPick(null);
          }}
          swapLabel="Ander product"
          onSwap={() => {
            setOther(pick);
            setPick(null);
          }}
        />
        <ExtraAddModal
          visible={!!other}
          stores={[]}
          onClose={() => setOther(null)}
          onAdd={(ex) => {
            if (other && ex.product_id) add.mutate({ ids: [other.id], product_id: ex.product_id });
            setOther(null);
          }}
        />
      </View>
    );
  }
  const items = all;
  const ids = items.filter((i) => !off.has(i.id)).map((i) => i.id);
  return (
    <View style={styles.card} testID="restock-card">
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Icon name="fridge-alert-outline" size={20} color={colors.warning} />
        <Text style={[styles.title, { flex: 1 }]}>Bijna op in je voorraadkast</Text>
      </View>
      {items.map((i) => {
        const on = !off.has(i.id);
        return (
          <Pressable
            key={i.id}
            onPress={() =>
              setOff((cur) => {
                const n = new Set(cur);
                if (n.has(i.id)) n.delete(i.id);
                else n.add(i.id);
                return n;
              })
            }
            style={styles.row}
          >
            <Icon name={on ? "checkbox-marked" : "checkbox-blank-outline"} size={22} color={on ? colors.brandPrimary : colors.muted} />
            {i.image ? <Image source={{ uri: i.image }} style={styles.img} resizeMode="contain" /> : null}
            <View style={{ flex: 1 }}>
              <Text style={styles.name} numberOfLines={1}>{i.name}</Text>
              <Text style={styles.small} numberOfLines={1}>
                Nog {i.unit === "%" ? `±${Math.round(i.qty)}%` : `${formatQty(i.qty)} ${i.unit}`} · kopen: {formatQty(i.buy)} {i.buy_unit}
              </Text>
            </View>
          </Pressable>
        );
      })}
      <Button
        label={ids.length ? `Zet ${ids.length} op deze lijst` : "Niets gekozen"}
        icon="cart-plus"
        variant="secondary"
        disabled={!ids.length}
        loading={add.isPending}
        onPress={() => add.mutate(ids)}
        testID="restock-add"
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  bar: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 14, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: colors.surfaceSecondary },
  barTitle: { fontSize: 13, fontFamily: fonts.bold, color: colors.onSurface },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, maxWidth: 170, paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  chipImg: { width: 20, height: 20, borderRadius: 4, backgroundColor: "#fff" },
  chipText: { fontSize: 13, fontFamily: fonts.medium, color: colors.onSurface, flexShrink: 1 },
  card: { gap: 8, borderWidth: 1, borderColor: colors.warning, borderRadius: 16, padding: 12, backgroundColor: colors.surfaceSecondary },
  title: { fontSize: 15, fontFamily: fonts.bold, color: colors.onSurface },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  img: { width: 34, height: 34, borderRadius: 8, backgroundColor: "#fff" },
  name: { fontSize: 14, fontFamily: fonts.semibold, color: colors.onSurface },
  small: { fontSize: 12, fontFamily: fonts.regular, color: colors.muted },
}));
