import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { EmptyState, Icon } from "@/src/components/ui";
import { api } from "@/src/api";
import { CATEGORY_LABELS, formatQty, MealCategory } from "@/src/constants";
import { goBack } from "@/src/nav";
import { useToast } from "@/src/toast";
import { fonts, makeStyles, useTheme } from "@/src/theme";

type Submission = {
  submission_id: string;
  name: string;
  category: MealCategory;
  submitter_name: string;
  ingredients: { name: string; unit: string; qty_adult: number; qty_child: number }[];
};

export default function SubmissionsScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["submissions"],
    queryFn: () => api<{ submissions: Submission[] }>("/admin/submissions"),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["submissions"] });
    qc.invalidateQueries({ queryKey: ["submissions-count"] });
    qc.invalidateQueries({ queryKey: ["dishes"] });
  };

  const approve = useMutation({
    mutationFn: (sid: string) => api(`/admin/submissions/${sid}/approve`, { method: "POST" }),
    onSuccess: () => {
      invalidate();
      toast.show("Toegevoegd als standaardgerecht", "success");
    },
    onError: (e: any) => toast.show(e?.message ?? "Mislukt", "error"),
  });
  const reject = useMutation({
    mutationFn: (sid: string) => api(`/admin/submissions/${sid}/reject`, { method: "POST" }),
    onSuccess: () => {
      invalidate();
      toast.show("Inzending geweigerd", "info");
    },
    onError: (e: any) => toast.show(e?.message ?? "Mislukt", "error"),
  });

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable testID="back-button" onPress={() => goBack("/")} hitSlop={10} style={styles.headerBtn}>
          <Icon name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Inzendingen</Text>
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
              <EmptyState icon="clipboard-check-outline" title="Geen inzendingen" subtitle="Nieuwe voorstellen voor standaardgerechten verschijnen hier." />
            </View>
          ) : (
            (data?.submissions ?? []).map((s) => (
              <View key={s.submission_id} style={styles.card} testID={`submission-${s.submission_id}`}>
                <Text style={styles.name}>{s.name}</Text>
                <Text style={styles.meta}>
                  {CATEGORY_LABELS[s.category]} · door {s.submitter_name}
                </Text>
                <View style={styles.ings}>
                  {s.ingredients.map((i, idx) => (
                    <Text key={idx} style={styles.ing}>
                      • {i.name} — {formatQty(i.qty_adult)}/{formatQty(i.qty_child)} {i.unit} (volw/kind)
                    </Text>
                  ))}
                </View>
                <View style={styles.actions}>
                  <Pressable
                    testID={`reject-${s.submission_id}`}
                    onPress={() => reject.mutate(s.submission_id)}
                    style={[styles.actionBtn, styles.rejectBtn]}
                  >
                    <Icon name="close" size={18} color={colors.error} />
                    <Text style={[styles.actionText, { color: colors.error }]}>Weigeren</Text>
                  </Pressable>
                  <Pressable
                    testID={`approve-${s.submission_id}`}
                    onPress={() => approve.mutate(s.submission_id)}
                    style={[styles.actionBtn, styles.approveBtn]}
                  >
                    <Icon name="check" size={18} color={colors.onBrandPrimary} />
                    <Text style={[styles.actionText, { color: colors.onBrandPrimary }]}>Goedkeuren</Text>
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
  ings: { gap: 2, marginTop: 6 },
  ing: { fontSize: 13, fontFamily: fonts.regular, color: colors.onSurfaceSecondary },
  actions: { flexDirection: "row", gap: 10, marginTop: 12 },
  actionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: 12 },
  rejectBtn: { borderWidth: 1.5, borderColor: colors.error },
  approveBtn: { backgroundColor: colors.brandPrimary },
  actionText: { fontSize: 14, fontFamily: fonts.semibold },
}));
