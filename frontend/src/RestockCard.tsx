// Bovenaan de boodschappenlijst: wat in je voorraadkast bijna op is. Met één tik zet je het op deze lijst.
import { useState } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button, Icon } from "@/src/components/ui";
import { api } from "@/src/api";
import { formatQty } from "@/src/constants";
import { usePremium } from "@/src/premium";
import { useToast } from "@/src/toast";
import { fonts, makeStyles, useTheme } from "@/src/theme";

type Low = { id: string; name: string; qty: number; unit: string; image?: string | null; product_name?: string | null; buy: number; buy_unit: string };

export function RestockCard({ campId, compact }: { campId: string; compact?: boolean }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const premium = usePremium();
  const toast = useToast();
  const qc = useQueryClient();
  const [off, setOff] = useState<Set<string>>(new Set());
  const { data } = useQuery({
    queryKey: ["pantry-restock", campId],
    queryFn: () => api<{ items: Low[] }>(`/pantry/restock?camp_id=${encodeURIComponent(campId)}`),
    enabled: premium,
  });
  const add = useMutation({
    mutationFn: (ids: string[]) => api<{ added: number }>(`/camps/${campId}/restock`, { method: "POST", body: { ids } }),
    onSuccess: (r) => {
      toast.show(`${r.added} ${r.added === 1 ? "product" : "producten"} uit je voorraadkast op de lijst gezet`, "success");
      qc.invalidateQueries({ queryKey: ["pantry-restock", campId] });
      qc.invalidateQueries({ queryKey: ["shopping", campId] });
      qc.invalidateQueries({ queryKey: ["camp", campId] });
    },
    onError: (e: any) => toast.show(e?.message ?? "Mislukt", "error"),
  });
  const all = data?.items ?? [];
  const items = compact ? all.slice(0, 4) : all; // op Home kort houden
  if (!premium || !items.length) return null;
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
  card: { gap: 8, borderWidth: 1, borderColor: colors.warning, borderRadius: 16, padding: 12, backgroundColor: colors.surfaceSecondary },
  title: { fontSize: 15, fontFamily: fonts.bold, color: colors.onSurface },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  img: { width: 34, height: 34, borderRadius: 8, backgroundColor: "#fff" },
  name: { fontSize: 14, fontFamily: fonts.semibold, color: colors.onSurface },
  small: { fontSize: 12, fontFamily: fonts.regular, color: colors.muted },
}));
