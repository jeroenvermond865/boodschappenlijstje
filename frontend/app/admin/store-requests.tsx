import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { EmptyState, Icon } from "@/src/components/ui";
import { api } from "@/src/api";
import { goBack } from "@/src/nav";
import { useToast } from "@/src/toast";
import { fonts, makeStyles, useTheme } from "@/src/theme";

type SReq = { req_id: string; name: string; requested_by_name?: string };

export default function StoreRequestsScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["store-requests"],
    queryFn: () => api<{ requests: SReq[] }>("/admin/store-requests"),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["store-requests"] });
    qc.invalidateQueries({ queryKey: ["store-requests-count"] });
    qc.invalidateQueries({ queryKey: ["products"] });
  };

  const approve = useMutation({
    mutationFn: (id: string) => api(`/admin/store-requests/${id}/approve`, { method: "POST" }),
    onSuccess: () => {
      invalidate();
      toast.show("Winkel toegevoegd", "success");
    },
    onError: (e: any) => toast.show(e?.message ?? "Mislukt", "error"),
  });
  const reject = useMutation({
    mutationFn: (id: string) => api(`/admin/store-requests/${id}/reject`, { method: "POST" }),
    onSuccess: () => {
      invalidate();
      toast.show("Aanvraag geweigerd", "info");
    },
    onError: (e: any) => toast.show(e?.message ?? "Mislukt", "error"),
  });

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable testID="back-button" onPress={() => goBack("/")} hitSlop={10} style={styles.headerBtn}>
          <Icon name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Winkelaanvragen</Text>
        <View style={styles.headerBtn} />
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.brandPrimary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 14 }}>
          {(data?.requests ?? []).length === 0 ? (
            <View style={styles.center}>
              <EmptyState icon="storefront-outline" title="Geen aanvragen" subtitle="Winkels die gebruikers aanvragen verschijnen hier." />
            </View>
          ) : (
            (data?.requests ?? []).map((r) => (
              <View key={r.req_id} style={styles.card} testID={`sreq-${r.req_id}`}>
                <Text style={styles.name}>{r.name}</Text>
                {r.requested_by_name ? <Text style={styles.meta}>Aangevraagd door {r.requested_by_name}</Text> : null}
                <View style={styles.actions}>
                  <Pressable testID={`sreq-reject-${r.req_id}`} onPress={() => reject.mutate(r.req_id)} style={[styles.actionBtn, styles.rejectBtn]}>
                    <Icon name="close" size={18} color={colors.error} />
                    <Text style={[styles.actionText, { color: colors.error }]}>Weigeren</Text>
                  </Pressable>
                  <Pressable testID={`sreq-approve-${r.req_id}`} onPress={() => approve.mutate(r.req_id)} style={[styles.actionBtn, styles.approveBtn]}>
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
  actions: { flexDirection: "row", gap: 10, marginTop: 10 },
  actionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: 12 },
  rejectBtn: { borderWidth: 1.5, borderColor: colors.error },
  approveBtn: { backgroundColor: colors.brandPrimary },
  actionText: { fontSize: 14, fontFamily: fonts.semibold },
}));
