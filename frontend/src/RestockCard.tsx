// Wat in je voorraadkast bijna op is, als smalle balk met knopjes (op Home en bovenaan een boodschappenlijst).
// Tik op een product: details, op je lijst zetten, een ander product kiezen (meteen in dezelfde afdeling),
// niet meer tonen of uit je voorraad halen.
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import Image from "@/src/components/SafeImage";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Icon } from "@/src/components/ui";
import { api } from "@/src/api";
import { formatQty } from "@/src/constants";
import { useFeature } from "@/src/premium";
import { ProductPopup } from "@/src/ProductPopup";
import { ExtraAddModal } from "@/app/camp/[id]";
import { useToast } from "@/src/toast";
import { fonts, makeStyles, useTheme } from "@/src/theme";

type Low = { id: string; name: string; qty: number; unit: string; image?: string | null; product_id?: string | null; product_name?: string | null; aisle?: string | null; buy: number; buy_unit: string };

export function RestockCard({ campId }: { campId: string; compact?: boolean }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const premium = useFeature("voorraadkast");
  const toast = useToast();
  const qc = useQueryClient();
  const [pick, setPick] = useState<Low | null>(null); // product in de popup
  const [other, setOther] = useState<Low | null>(null); // een ander product kiezen voor dit voorraadproduct
  const { data } = useQuery({
    queryKey: ["pantry-restock", campId],
    queryFn: () => api<{ items: Low[] }>(`/pantry/restock?camp_id=${encodeURIComponent(campId)}`),
    enabled: premium,
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["pantry-restock"] });
    qc.invalidateQueries({ queryKey: ["shopping", campId] });
    qc.invalidateQueries({ queryKey: ["camp", campId] });
    qc.invalidateQueries({ queryKey: ["pantry"] });
  };
  const add = useMutation({
    mutationFn: (v: { ids: string[]; product_id?: string | null }) => api<{ added: number }>(`/camps/${campId}/restock`, { method: "POST", body: v }),
    onSuccess: (r) => {
      toast.show(r.added ? "Op je lijst gezet" : "Stond er al op", "success");
      refresh();
    },
    onError: (e: any) => toast.show(e?.message ?? "Mislukt", "error"),
  });
  const hide = useMutation({
    mutationFn: (i: Low) => api(`/pantry/${i.id}/restock-off`, { method: "POST", body: {} }),
    onSuccess: () => {
      toast.show("Wordt niet meer getoond tot je het weer aanvult", "success");
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (i: Low) => api(`/pantry/${i.id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.show("Uit je voorraad gehaald", "success");
      refresh();
    },
  });
  const all = data?.items ?? [];
  if (!premium || !all.length) return null;
  const close = (fn?: () => void) => {
    const p = pick;
    setPick(null);
    if (p && fn) fn();
  };
  return (
    <View style={styles.bar} testID="restock-card">
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Icon name="fridge-alert-outline" size={16} color={colors.warning} />
        <Text style={styles.barTitle}>Bijna op</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        {all.map((i) => (
          <Pressable key={i.id} testID="restock-chip" onPress={() => setPick(i)} style={({ pressed }) => [styles.chip, pressed && { opacity: 0.7 }]}>
            {i.image ? <Image source={{ uri: i.image }} style={styles.chipImg} resizeMode="contain" /> : null}
            <Text style={styles.chipText} numberOfLines={1}>{i.name}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <ProductPopup
        productId={pick?.product_id ?? null}
        onClose={() => setPick(null)}
        addLabel={pick ? `Op je lijst (${formatQty(pick.buy)} ${pick.buy_unit})` : "Op je lijst"}
        onAdd={() => close(() => add.mutate({ ids: [pick!.id] }))}
        swapLabel="Ander product"
        onSwap={() => close(() => setOther(pick))}
        extra={[
          { label: "Niet meer tonen", icon: "eye-off-outline", onPress: () => close(() => hide.mutate(pick!)) },
          { label: "Uit voorraad halen", icon: "delete-outline", danger: true, onPress: () => close(() => remove.mutate(pick!)) },
        ]}
      />
      {/* Zonder gekoppeld product: meteen een product kiezen */}
      {pick && !pick.product_id ? (
        <ExtraAddModal
          visible
          stores={[]}
          title={`Product voor ${pick.name}`}
          initialSearch={pick.name}
          initialAisle={pick.aisle ?? undefined}
          onClose={() => setPick(null)}
          onAdd={(ex) => {
            const p = pick;
            setPick(null);
            if (ex.product_id) add.mutate({ ids: [p.id], product_id: ex.product_id });
          }}
        />
      ) : null}
      <ExtraAddModal
        visible={!!other}
        stores={[]}
        title={other ? `Ander product voor ${other.name}` : undefined}
        initialSearch={other?.product_name ?? other?.name}
        initialAisle={other?.aisle ?? undefined}
        onClose={() => setOther(null)}
        onAdd={(ex) => {
          if (other && ex.product_id) add.mutate({ ids: [other.id], product_id: ex.product_id });
          setOther(null);
        }}
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
}));
