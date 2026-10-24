import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { EmptyState, Icon } from "@/src/components/ui";
import { api } from "@/src/api";
import type { Product } from "@/app/(tabs)/products";
import { goBack } from "@/src/nav";
import { useToast } from "@/src/toast";
import { fonts, makeStyles, useTheme } from "@/src/theme";

type PSub = {
  psub_id: string;
  name: string;
  submitted_by_name?: string;
  product: Product;
};

export default function ProductSubmissionsScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["product-submissions"],
    queryFn: () => api<{ submissions: PSub[] }>("/admin/product-submissions"),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["product-submissions"] });
    qc.invalidateQueries({ queryKey: ["product-submissions-count"] });
    qc.invalidateQueries({ queryKey: ["products"] });
  };

  const approve = useMutation({
    mutationFn: (id: string) => api(`/admin/product-submissions/${id}/approve`, { method: "POST" }),
    onSuccess: () => {
      invalidate();
      toast.show("Toegevoegd aan de algemene lijst", "success");
    },
    onError: (e: any) => toast.show(e?.message ?? "Mislukt", "error"),
  });
  const reject = useMutation({
    mutationFn: (id: string) => api(`/admin/product-submissions/${id}/reject`, { method: "POST" }),
    onSuccess: () => {
      invalidate();
      toast.show("Voorstel geweigerd", "info");
    },
    onError: (e: any) => toast.show(e?.message ?? "Mislukt", "error"),
  });

  const priceSummary = (p: Product) => {
    const vals = Object.entries(p.prices ?? {}).filter(([, v]) => v > 0);
    if (!vals.length) return "Geen prijs opgegeven";
    return vals.map(([s, v]) => `${s}: € ${Number(v).toFixed(2)}`).join(" · ");
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable testID="back-button" onPress={() => goBack("/")} hitSlop={10} style={styles.headerBtn}>
          <Icon name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Nieuwe producten</Text>
        <View style={styles.headerBtn} />
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.brandPrimary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 14 }}>
          {(data?.submissions ?? []).length === 0 ? (
            <View style={styles.center}>
              <EmptyState icon="cart-plus" title="Geen nieuwe producten" subtitle="Producten die gebruikers toevoegen verschijnen hier ter beoordeling." />
            </View>
          ) : (
            (data?.submissions ?? []).map((s) => (
              <View key={s.psub_id} style={styles.card} testID={`psub-${s.psub_id}`}>
                <Text style={styles.name}>{s.name}</Text>
                <Text style={styles.meta}>
                  {s.product.aisle} · per {s.product.unit}
                  {s.product.brand ? ` · ${s.product.brand}` : ""}
                  {s.submitted_by_name ? ` · door ${s.submitted_by_name}` : ""}
                </Text>
                <Text style={styles.price}>{priceSummary(s.product)}</Text>
                <View style={styles.actions}>
                  <Pressable testID={`psub-reject-${s.psub_id}`} onPress={() => reject.mutate(s.psub_id)} style={[styles.actionBtn, styles.rejectBtn]}>
                    <Icon name="close" size={18} color={colors.error} />
                    <Text style={[styles.actionText, { color: colors.error }]}>Weigeren</Text>
                  </Pressable>
                  <Pressable testID={`psub-approve-${s.psub_id}`} onPress={() => approve.mutate(s.psub_id)} style={[styles.actionBtn, styles.approveBtn]}>
                    <Icon name="check" size={18} color={colors.onBrandPrimary} />
                    <Text style={[styles.actionText, { color: colors.onBrandPrimary }]}>Toevoegen</Text>
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
  price: { fontSize: 13, fontFamily: fonts.medium, color: colors.onSurfaceSecondary, marginTop: 2 },
  actions: { flexDirection: "row", gap: 10, marginTop: 12 },
  actionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: 12 },
  rejectBtn: { borderWidth: 1.5, borderColor: colors.error },
  approveBtn: { backgroundColor: colors.brandPrimary },
  actionText: { fontSize: 14, fontFamily: fonts.semibold },
}));
