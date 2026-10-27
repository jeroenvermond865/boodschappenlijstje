import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import Image from "@/src/components/SafeImage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { EmptyState, Icon } from "@/src/components/ui";
import { api } from "@/src/api";
import { goBack } from "@/src/nav";
import { useToast } from "@/src/toast";
import { fonts, makeStyles, useTheme } from "@/src/theme";

// Barcodes die gebruikers in de winkel aan een product koppelden: eerst controleren, dan pas gebruiken
type Sug = {
  id: string;
  barcode: string;
  user_name?: string | null;
  product: { id: string; name: string; image?: string | null; unit?: string | null; store?: string | null; barcode?: string | null };
  also_on: string[];
};

export default function BarcodeSuggestionsScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["barcode-suggestions"],
    queryFn: () => api<{ suggestions: Sug[] }>("/admin/barcode-suggestions"),
  });

  const review = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "approve" | "reject" }) => api(`/admin/barcode-suggestions/${id}/${action}`, { method: "POST" }),
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ["barcode-suggestions"] });
      qc.invalidateQueries({ queryKey: ["barcode-suggestions-count"] });
      toast.show(v.action === "approve" ? "Barcode gekoppeld" : "Voorstel geweigerd", v.action === "approve" ? "success" : "info");
    },
    onError: (e: any) => toast.show(e?.message ?? "Mislukt", "error"),
  });

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable testID="back-button" onPress={() => goBack("/")} hitSlop={10} style={styles.headerBtn}>
          <Icon name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Barcode-voorstellen</Text>
        <View style={styles.headerBtn} />
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.brandPrimary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 14 }}>
          {(data?.suggestions ?? []).length === 0 ? (
            <View style={styles.center}>
              <EmptyState icon="barcode" title="Geen voorstellen" subtitle="Barcodes die gebruikers in de winkel aan een product koppelen, verschijnen hier." />
            </View>
          ) : (
            (data?.suggestions ?? []).map((x) => (
              <View key={x.id} style={styles.card}>
                <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
                  {x.product.image ? <Image source={{ uri: x.product.image }} style={{ width: 52, height: 52, borderRadius: 8, backgroundColor: "#fff" }} resizeMode="contain" /> : null}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{x.product.name}</Text>
                    <Text style={styles.meta}>{[x.product.store, x.product.unit].filter(Boolean).join(" · ")}</Text>
                  </View>
                </View>
                <Text style={[styles.meta, { fontFamily: fonts.semibold, color: colors.onSurface }]}>Barcode: {x.barcode}</Text>
                {x.product.barcode ? <Text style={styles.meta}>Nu gekoppeld: {x.product.barcode}</Text> : null}
                {x.also_on.length ? <Text style={styles.meta}>Deze barcode staat ook bij: {x.also_on.slice(0, 3).join(", ")}</Text> : null}
                {x.user_name ? <Text style={styles.meta}>Voorgesteld door {x.user_name}</Text> : null}
                <View style={styles.actions}>
                  <Pressable onPress={() => review.mutate({ id: x.id, action: "reject" })} style={[styles.actionBtn, styles.rejectBtn]}>
                    <Icon name="close" size={18} color={colors.error} />
                    <Text style={[styles.actionText, { color: colors.error }]}>Weigeren</Text>
                  </Pressable>
                  <Pressable onPress={() => review.mutate({ id: x.id, action: "approve" })} style={[styles.actionBtn, styles.approveBtn]}>
                    <Icon name="check" size={18} color={colors.onBrandPrimary} />
                    <Text style={[styles.actionText, { color: colors.onBrandPrimary }]}>Koppelen</Text>
                  </Pressable>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  headerBtn: { width: 44, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 18, fontFamily: fonts.bold, color: colors.onSurface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 40 },
  card: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 6 },
  name: { fontSize: 17, fontFamily: fonts.bold, color: colors.onSurface },
  meta: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted },
  actions: { flexDirection: "row", gap: 10, marginTop: 10 },
  actionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: 12 },
  rejectBtn: { borderWidth: 1.5, borderColor: colors.error },
  approveBtn: { backgroundColor: colors.brandPrimary },
  actionText: { fontSize: 14, fontFamily: fonts.semibold },
}));
