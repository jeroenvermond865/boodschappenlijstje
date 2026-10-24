import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { EmptyState, Icon } from "@/src/components/ui";
import { api } from "@/src/api";
import { goBack } from "@/src/nav";
import { useToast } from "@/src/toast";
import { fonts, makeStyles, useTheme } from "@/src/theme";

type Kind = "user" | "camp" | "dish" | "product";
type TrashItem = { kind: Kind; id: string; name: string; extra?: string; deleted_at?: string; days_left: number };

const KIND_LABEL: Record<Kind, string> = { user: "Gebruiker", camp: "Kamp", dish: "Gerecht", product: "Product" };
const KIND_ICON: Record<Kind, any> = {
  user: "account-outline",
  camp: "tent",
  dish: "silverware-fork-knife",
  product: "cart-outline",
};

export default function AdminTrashScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-trash"],
    queryFn: () => api<{ items: TrashItem[]; days: number }>("/admin/trash"),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin-trash"] });
    qc.invalidateQueries({ queryKey: ["admin-users"] });
    qc.invalidateQueries({ queryKey: ["camps"] });
    qc.invalidateQueries({ queryKey: ["dishes"] });
    qc.invalidateQueries({ queryKey: ["products"] });
  };

  const restore = useMutation({
    mutationFn: (it: TrashItem) => api(`/admin/trash/${it.kind}/${it.id}/restore`, { method: "POST" }),
    onSuccess: () => {
      invalidate();
      toast.show("Teruggezet", "success");
    },
    onError: (e: any) => toast.show(e?.message ?? "Mislukt", "error"),
  });
  const purge = useMutation({
    mutationFn: (it: TrashItem) => api(`/admin/trash/${it.kind}/${it.id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidate();
      toast.show("Definitief verwijderd", "info");
    },
    onError: (e: any) => toast.show(e?.message ?? "Mislukt", "error"),
  });

  const items = data?.items ?? [];

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable testID="back-button" onPress={() => goBack("/")} hitSlop={10} style={styles.headerBtn}>
          <Icon name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Recent verwijderd</Text>
        <View style={styles.headerBtn} />
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.brandPrimary} />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <EmptyState
            icon="delete-restore"
            title="Niets verwijderd"
            subtitle={`Verwijderde gebruikers, kampen, gerechten en producten blijven hier ${data?.days ?? 30} dagen staan.`}
          />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 12 }}>
          <Text style={styles.intro}>
            Alles blijft hier {data?.days ?? 30} dagen staan en wordt daarna definitief verwijderd.
          </Text>
          {items.map((it) => (
            <View key={`${it.kind}-${it.id}`} style={styles.card} testID={`trash-${it.kind}-${it.id}`}>
              <View style={styles.cardHead}>
                <Icon name={KIND_ICON[it.kind]} size={18} color={colors.muted} />
                <Text style={styles.kind}>{KIND_LABEL[it.kind]}</Text>
                <Text style={styles.days}>
                  {it.days_left === 1 ? "nog 1 dag" : `nog ${it.days_left} dagen`}
                </Text>
              </View>
              <Text style={styles.name}>{it.name || "(zonder naam)"}</Text>
              {it.extra ? <Text style={styles.extra}>{it.extra}</Text> : null}
              <View style={styles.actions}>
                <Pressable testID={`trash-restore-${it.id}`} onPress={() => restore.mutate(it)} style={styles.actionBtn}>
                  <Icon name="restore" size={16} color={colors.brandPrimary} />
                  <Text style={[styles.actionText, { color: colors.brandPrimary }]}>Terugzetten</Text>
                </Pressable>
                <Pressable testID={`trash-purge-${it.id}`} onPress={() => purge.mutate(it)} style={styles.actionBtn}>
                  <Icon name="delete-forever-outline" size={16} color={colors.error} />
                  <Text style={[styles.actionText, { color: colors.error }]}>Nu definitief verwijderen</Text>
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
  intro: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted },
  card: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 6 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  kind: { fontSize: 12, fontFamily: fonts.semibold, color: colors.muted, textTransform: "uppercase" },
  days: { flex: 1, textAlign: "right", fontSize: 12, fontFamily: fonts.regular, color: colors.muted },
  name: { fontSize: 16, fontFamily: fonts.bold, color: colors.onSurface },
  extra: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 16, marginTop: 4 },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 4 },
  actionText: { fontSize: 13, fontFamily: fonts.semibold },
}));
