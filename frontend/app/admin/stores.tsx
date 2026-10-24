import { useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button, Field, Icon } from "@/src/components/ui";
import { api } from "@/src/api";
import { goBack } from "@/src/nav";
import { useToast } from "@/src/toast";
import { fonts, makeStyles, useTheme } from "@/src/theme";

type Store = { name: string };
type SReq = { req_id: string; name: string; requested_by_name?: string };

export default function AdminStoresScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-stores"],
    queryFn: () => api<{ stores: Store[] }>("/admin/stores"),
  });
  const { data: reqData } = useQuery({
    queryKey: ["store-requests"],
    queryFn: () => api<{ requests: SReq[] }>("/admin/store-requests"),
    refetchInterval: 15000,
  });
  const requests = reqData?.requests ?? [];

  const [open, setOpen] = useState(false);
  const [original, setOriginal] = useState<string | null>(null);
  const [name, setName] = useState("");

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin-stores"] });
    qc.invalidateQueries({ queryKey: ["products"] });
  };

  const invalidateReqs = () => {
    qc.invalidateQueries({ queryKey: ["store-requests"] });
    qc.invalidateQueries({ queryKey: ["store-requests-count"] });
    qc.invalidateQueries({ queryKey: ["admin-stores"] });
    qc.invalidateQueries({ queryKey: ["products"] });
  };

  const approveReq = useMutation({
    mutationFn: (id: string) => api(`/admin/store-requests/${id}/approve`, { method: "POST" }),
    onSuccess: () => {
      invalidateReqs();
      toast.show("Winkel toegevoegd", "success");
    },
    onError: (e: any) => toast.show(e?.message ?? "Mislukt", "error"),
  });
  const rejectReq = useMutation({
    mutationFn: (id: string) => api(`/admin/store-requests/${id}/reject`, { method: "POST" }),
    onSuccess: () => {
      invalidateReqs();
      toast.show("Aanvraag geweigerd", "info");
    },
    onError: (e: any) => toast.show(e?.message ?? "Mislukt", "error"),
  });

  const openNew = () => {
    setOriginal(null);
    setName("");
    setOpen(true);
  };
  const openEdit = (s: Store) => {
    setOriginal(s.name);
    setName(s.name);
    setOpen(true);
  };

  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim() };
      return original
        ? api(`/admin/stores/${encodeURIComponent(original)}`, { method: "PUT", body })
        : api("/admin/stores", { method: "POST", body });
    },
    onSuccess: () => {
      invalidate();
      toast.show("Winkel opgeslagen", "success");
      setOpen(false);
    },
    onError: (e: any) => toast.show(e?.message ?? "Mislukt", "error"),
  });

  const remove = useMutation({
    mutationFn: (sn: string) => api(`/admin/stores/${encodeURIComponent(sn)}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidate();
      toast.show("Winkel verwijderd", "info");
    },
    onError: (e: any) => toast.show(e?.message ?? "Mislukt", "error"),
  });

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable testID="back-button" onPress={() => goBack("/")} hitSlop={10} style={styles.headerBtn}>
          <Icon name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Winkels & aanvragen</Text>
        <Pressable testID="add-store-button" onPress={openNew} hitSlop={10} style={styles.headerBtn}>
          <Icon name="plus" size={24} color={colors.brandPrimary} />
        </Pressable>
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.brandPrimary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 10 }}>
          {requests.length > 0 ? (
            <View style={styles.reqBlock} testID="store-requests-block">
              <Text style={styles.reqTitle}>Nieuwe aanvragen ({requests.length})</Text>
              {requests.map((r) => (
                <View key={r.req_id} style={styles.reqCard} testID={`sreq-${r.req_id}`}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{r.name}</Text>
                    {r.requested_by_name ? <Text style={styles.sub}>Aangevraagd door {r.requested_by_name}</Text> : null}
                  </View>
                  <Pressable testID={`sreq-reject-${r.req_id}`} onPress={() => rejectReq.mutate(r.req_id)} hitSlop={8} style={styles.iconBtn}>
                    <Icon name="close" size={20} color={colors.error} />
                  </Pressable>
                  <Pressable testID={`sreq-approve-${r.req_id}`} onPress={() => approveReq.mutate(r.req_id)} hitSlop={8} style={[styles.iconBtn, styles.approveBtn]}>
                    <Icon name="check" size={20} color={colors.onBrandPrimary} />
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}
          {(data?.stores ?? []).map((s) => (
            <View key={s.name} style={styles.row} testID={`store-${s.name}`}>
              <Icon name="storefront-outline" size={22} color={colors.brandPrimary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{s.name}</Text>
              </View>
              <Pressable testID={`store-edit-${s.name}`} onPress={() => openEdit(s)} hitSlop={8} style={styles.iconBtn}>
                <Icon name="pencil-outline" size={20} color={colors.onSurfaceSecondary} />
              </Pressable>
              <Pressable testID={`store-delete-${s.name}`} onPress={() => remove.mutate(s.name)} hitSlop={8} style={styles.iconBtn}>
                <Icon name="trash-can-outline" size={20} color={colors.error} />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{original ? "Winkel bewerken" : "Winkel toevoegen"}</Text>
              <Pressable testID="store-modal-close" onPress={() => setOpen(false)} hitSlop={8}>
                <Icon name="close" size={22} color={colors.onSurface} />
              </Pressable>
            </View>
            <Field label="Naam" testID="store-name-input" value={name} onChangeText={setName} />
            <Button label="Opslaan" onPress={() => name.trim() && save.mutate()} loading={save.isPending} testID="store-save-button" />
          </View>
        </View>
      </Modal>
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
  hint: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted, marginBottom: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14 },
  name: { fontSize: 16, fontFamily: fonts.semibold, color: colors.onSurface },
  sub: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted, marginTop: 1 },
  iconBtn: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  approveBtn: { backgroundColor: colors.brandPrimary, borderRadius: 10 },
  reqBlock: { gap: 10, backgroundColor: colors.brandTertiary, borderRadius: 16, padding: 14, marginBottom: 6 },
  reqTitle: { fontSize: 14, fontFamily: fonts.bold, color: colors.onBrandTertiary },
  reqCard: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.surface, borderRadius: 12, padding: 12 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16, gap: 12 },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sheetTitle: { fontSize: 18, fontFamily: fonts.bold, color: colors.onSurface },
}));
