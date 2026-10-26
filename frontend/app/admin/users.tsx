import { useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button, Field, Icon, PasswordField } from "@/src/components/ui";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { goBack } from "@/src/nav";
import { useToast } from "@/src/toast";
import { fonts, makeStyles, useTheme } from "@/src/theme";

type AdminUser = { id: string; name: string; email: string; username?: string | null; phone?: string | null; role: string; premium?: boolean };
type Role = { name: string; label: string };

export default function AdminUsersScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const qc = useQueryClient();
  const { user: me } = useAuth();
  const iAmOwner = me?.role === "beheerder";

  const { data: usersData, isLoading } = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => api<{ users: AdminUser[] }>("/admin/users"),
  });
  const { data: rolesData } = useQuery({
    queryKey: ["roles"],
    queryFn: () => api<{ roles: Role[] }>("/roles"),
  });
  // Alleen de beheerder kan iemand beheerder maken
  const roles = (rolesData?.roles ?? []).filter((r) => iAmOwner || r.name !== "beheerder");

  const setPremium = useMutation({
    mutationFn: (v: { id: string; premium: boolean }) =>
      api(`/admin/users/${v.id}/premium`, { method: "PUT", body: { premium: v.premium } }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      toast.show(v.premium ? "Premium aangezet" : "Premium uitgezet", "success");
    },
    onError: (e: any) => toast.show(e?.message ?? "Mislukt", "error"),
  });

  const setRole = useMutation({
    mutationFn: (v: { id: string; role: string }) =>
      api(`/admin/users/${v.id}/role`, { method: "PUT", body: { role: v.role } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      toast.show("Rol bijgewerkt", "success");
    },
    onError: (e: any) => toast.show(e?.message ?? "Mislukt", "error"),
  });

  const [edit, setEdit] = useState<AdminUser | null>(null);
  const [form, setForm] = useState({ name: "", username: "", email: "", phone: "" });
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");

  const openEdit = (u: AdminUser) => {
    setForm({ name: u.name ?? "", username: u.username ?? "", email: u.email ?? "", phone: u.phone ?? "" });
    setPw("");
    setPw2("");
    setEdit(u);
  };

  const saveUser = useMutation({
    mutationFn: () => api(`/admin/users/${edit!.id}`, { method: "PUT", body: form }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      toast.show("Gebruiker bijgewerkt", "success");
      setEdit(null);
    },
    onError: (e: any) => toast.show(e?.message ?? "Mislukt", "error"),
  });

  const deleteUser = useMutation({
    mutationFn: () => api(`/admin/users/${edit!.id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      toast.show("Gebruiker staat 30 dagen in Recent verwijderd", "info");
      setEdit(null);
    },
    onError: (e: any) => toast.show(e?.message ?? "Mislukt", "error"),
  });

  const setPassword = useMutation({
    mutationFn: () => api(`/admin/users/${edit!.id}/set-password`, { method: "POST", body: { new_password: pw } }),
    onSuccess: () => {
      setPw("");
      setPw2("");
      toast.show("Wachtwoord ingesteld", "success");
    },
    onError: (e: any) => toast.show(e?.message ?? "Mislukt", "error"),
  });

  const submitPassword = () => {
    if (pw.length < 8) return toast.show("Minstens 8 tekens", "error");
    if (pw !== pw2) return toast.show("De twee wachtwoorden zijn niet gelijk", "error");
    setPassword.mutate();
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable testID="back-button" onPress={() => goBack("/")} hitSlop={10} style={styles.headerBtn}>
          <Icon name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Gebruikers & rollen</Text>
        <View style={styles.headerBtn} />
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.brandPrimary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 12 }}>
          {(usersData?.users ?? []).map((u) => (
            <View key={u.id} style={styles.card} testID={`user-${u.id}`}>
              <View style={styles.userRow}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{(u.name ?? u.email).charAt(0).toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.nameRow}>
                    <Text style={[styles.name, { flexShrink: 1 }]} numberOfLines={1}>
                      {u.name}
                    </Text>
                    {u.premium ? (
                      <View style={styles.premiumPill}>
                        <Icon name="star" size={11} color={colors.onBrandSecondary} />
                        <Text style={styles.premiumText}>Premium</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.email} numberOfLines={1}>
                    {u.email}
                  </Text>
                </View>
                <Pressable
                  testID={`user-premium-${u.id}`}
                  onPress={() => setPremium.mutate({ id: u.id, premium: !u.premium })}
                  hitSlop={8}
                  style={styles.editBtn}
                >
                  <Icon name={u.premium ? "star" : "star-outline"} size={22} color={u.premium ? colors.brandSecondary : colors.muted} />
                </Pressable>
                <Pressable testID={`user-edit-${u.id}`} onPress={() => openEdit(u)} hitSlop={8} style={styles.editBtn}>
                  <Icon name="pencil-outline" size={20} color={colors.brandPrimary} />
                </Pressable>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                {roles.map((r) => {
                  const active = u.role === r.name;
                  return (
                    <Pressable
                      key={r.name}
                      testID={`user-${u.id}-role-${r.name}`}
                      disabled={active}
                      onPress={() => setRole.mutate({ id: u.id, role: r.name })}
                      style={[styles.chip, active && styles.chipActive]}
                    >
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>{r.label}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          ))}
        </ScrollView>
      )}

      <Modal visible={!!edit} animationType="slide" transparent onRequestClose={() => setEdit(null)}>
        <View style={styles.modalBackdrop}>
          <ScrollView
            style={styles.sheetScroll}
            contentContainerStyle={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Gebruiker bewerken</Text>
              <Pressable testID="admin-user-close" onPress={() => setEdit(null)} hitSlop={8}>
                <Icon name="close" size={22} color={colors.onSurface} />
              </Pressable>
            </View>
            <Field label="Naam" testID="admin-user-name" value={form.name} onChangeText={(t) => setForm((f) => ({ ...f, name: t }))} />
            <Field label="Gebruikersnaam" testID="admin-user-username" value={form.username} onChangeText={(t) => setForm((f) => ({ ...f, username: t }))} autoCapitalize="none" />
            <Field label="E-mail" testID="admin-user-email" value={form.email} onChangeText={(t) => setForm((f) => ({ ...f, email: t }))} autoCapitalize="none" keyboardType="email-address" />
            <Field label="Telefoon" testID="admin-user-phone" value={form.phone} onChangeText={(t) => setForm((f) => ({ ...f, phone: t }))} keyboardType="phone-pad" />
            <Button label="Opslaan" onPress={() => saveUser.mutate()} loading={saveUser.isPending} testID="admin-user-save" />

            <View style={styles.pwBlock}>
              <Text style={styles.pwTitle}>Wachtwoord instellen</Text>
              <Text style={styles.pwHint}>Handig als iemand z'n wachtwoord vergeten is.</Text>
              <PasswordField label="Nieuw wachtwoord" testID="admin-user-pw" placeholder="Minstens 8 tekens" value={pw} onChangeText={setPw} />
              <PasswordField label="Herhaal wachtwoord" testID="admin-user-pw2" placeholder="Nogmaals hetzelfde" value={pw2} onChangeText={setPw2} />
              <Button label="Wachtwoord instellen" variant="secondary" onPress={submitPassword} loading={setPassword.isPending} testID="admin-user-set-pw" />
            </View>

            <Pressable testID="admin-user-delete" onPress={() => deleteUser.mutate()} style={styles.deleteBtn}>
              <Icon name="trash-can-outline" size={18} color={colors.error} />
              <Text style={styles.deleteText}>Account verwijderen</Text>
            </Pressable>
          </ScrollView>
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
  card: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 12 },
  userRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 999,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 17, fontFamily: fonts.bold, color: colors.onBrandPrimary },
  name: { fontSize: 15, fontFamily: fonts.semibold, color: colors.onSurface },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  premiumPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: colors.brandSecondary,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
  },
  premiumText: { fontSize: 11, fontFamily: fonts.semibold, color: colors.onBrandSecondary },
  email: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted, marginTop: 1 },
  chipRow: { gap: 8, alignItems: "center" },
  chip: {
    height: 34,
    flexShrink: 0,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: colors.surfaceTertiary,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: "center",
  },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { fontSize: 13, fontFamily: fonts.medium, color: colors.onSurfaceTertiary },
  chipTextActive: { color: colors.onBrandPrimary },
  editBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheetScroll: { maxHeight: "88%" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16, gap: 12 },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sheetTitle: { fontSize: 18, fontFamily: fonts.bold, color: colors.onSurface },
  pwBlock: { gap: 10, borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: 14, marginTop: 2 },
  pwTitle: { fontSize: 15, fontFamily: fonts.bold, color: colors.onSurface },
  pwHint: { fontSize: 12, fontFamily: fonts.regular, color: colors.muted, marginTop: -4 },
  deleteBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12 },
  deleteText: { fontSize: 15, fontFamily: fonts.semibold, color: colors.error },
}));
