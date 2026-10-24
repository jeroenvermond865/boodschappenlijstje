import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { EmptyState, Icon } from "@/src/components/ui";
import { api } from "@/src/api";
import { goBack } from "@/src/nav";
import { useToast } from "@/src/toast";
import { fonts, makeStyles, useTheme } from "@/src/theme";

type Feedback = { feedback_id: string; message: string; user_name?: string; status: string; created_at?: string };

export default function AdminFeedbackScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-feedback"],
    queryFn: () => api<{ feedback: Feedback[] }>("/admin/feedback"),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin-feedback"] });
    qc.invalidateQueries({ queryKey: ["feedback-count"] });
  };

  const markRead = useMutation({
    mutationFn: (id: string) => api(`/admin/feedback/${id}/read`, { method: "POST" }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/admin/feedback/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidate();
      toast.show("Verwijderd", "info");
    },
  });

  const fmt = (iso?: string) => {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable testID="back-button" onPress={() => goBack("/")} hitSlop={10} style={styles.headerBtn}>
          <Icon name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Feedback van gebruikers</Text>
        <View style={styles.headerBtn} />
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.brandPrimary} />
        </View>
      ) : (data?.feedback ?? []).length === 0 ? (
        <View style={styles.center}>
          <EmptyState icon="message-text-outline" title="Nog geen feedback" subtitle="Reacties en ideeën van gebruikers verschijnen hier." />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 12 }}>
          {(data?.feedback ?? []).map((f) => (
            <View key={f.feedback_id} style={[styles.card, f.status === "new" && styles.cardNew]} testID={`feedback-${f.feedback_id}`}>
              <View style={styles.cardHead}>
                <Text style={styles.author}>{f.user_name ?? "Gebruiker"}</Text>
                {f.status === "new" ? <View style={styles.dot} /> : null}
                <Text style={styles.date}>{fmt(f.created_at)}</Text>
              </View>
              <Text style={styles.message}>{f.message}</Text>
              <View style={styles.actions}>
                {f.status === "new" ? (
                  <Pressable testID={`feedback-read-${f.feedback_id}`} onPress={() => markRead.mutate(f.feedback_id)} style={styles.actionBtn}>
                    <Icon name="check" size={16} color={colors.brandPrimary} />
                    <Text style={[styles.actionText, { color: colors.brandPrimary }]}>Gelezen</Text>
                  </Pressable>
                ) : null}
                <Pressable testID={`feedback-delete-${f.feedback_id}`} onPress={() => remove.mutate(f.feedback_id)} style={styles.actionBtn}>
                  <Icon name="trash-can-outline" size={16} color={colors.error} />
                  <Text style={[styles.actionText, { color: colors.error }]}>Verwijderen</Text>
                </Pressable>
              </View>
            </View>
          ))}
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
  card: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 8 },
  cardNew: { borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  author: { fontSize: 15, fontFamily: fonts.bold, color: colors.onSurface },
  dot: { width: 8, height: 8, borderRadius: 999, backgroundColor: colors.brandPrimary },
  date: { flex: 1, textAlign: "right", fontSize: 12, fontFamily: fonts.regular, color: colors.muted },
  message: { fontSize: 15, fontFamily: fonts.regular, color: colors.onSurface, lineHeight: 21 },
  actions: { flexDirection: "row", gap: 16, marginTop: 2 },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 4 },
  actionText: { fontSize: 13, fontFamily: fonts.semibold },
}));
