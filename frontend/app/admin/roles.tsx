import { useState } from "react";
import { ActivityIndicator, Alert, Platform, Pressable, Text, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button, Field, Icon } from "@/src/components/ui";
import { api } from "@/src/api";
import { goBack } from "@/src/nav";
import { useToast } from "@/src/toast";
import { fonts, makeStyles, useTheme } from "@/src/theme";

type Role = { name: string; label: string; permissions: string[]; is_system: boolean };

const PERM_LABELS: Record<string, string> = {
  manage_standard_dishes: "Standaardgerechten beheren",
  review_submissions: "Inzendingen beoordelen",
  manage_users: "Gebruikers beheren",
  manage_roles: "Rollen beheren",
};

export default function AdminRolesScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const qc = useQueryClient();
  const router = useRouter();

  const [newLabel, setNewLabel] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["roles-full"],
    queryFn: () => api<{ roles: Role[]; all_permissions: string[] }>("/roles"),
  });
  const allPerms = data?.all_permissions ?? [];

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["roles-full"] });
    qc.invalidateQueries({ queryKey: ["roles"] });
  };

  const update = useMutation({
    mutationFn: (v: { name: string; permissions: string[] }) =>
      api(`/admin/roles/${v.name}`, { method: "PUT", body: { permissions: v.permissions } }),
    onSuccess: refresh,
    onError: (e: any) => toast.show(e?.message ?? "Mislukt", "error"),
  });

  const create = useMutation({
    mutationFn: () => api("/admin/roles", { method: "POST", body: { name: newLabel.trim(), label: newLabel.trim(), permissions: [] } }),
    onSuccess: () => {
      setNewLabel("");
      refresh();
      toast.show("Rol aangemaakt", "success");
    },
    onError: (e: any) => toast.show(e?.message ?? "Mislukt", "error"),
  });

  const askRemove = (role: Role) => {
    const msg = `Rol "${role.label}" verwijderen? Wie deze rol heeft, krijgt de standaardrol.`;
    if (Platform.OS === "web") {
      if (window.confirm(msg)) remove.mutate(role.name);
    } else {
      Alert.alert("Rol verwijderen", msg, [
        { text: "Annuleren", style: "cancel" },
        { text: "Verwijderen", style: "destructive", onPress: () => remove.mutate(role.name) },
      ]);
    }
  };

  const remove = useMutation({
    mutationFn: (name: string) => api(`/admin/roles/${name}`, { method: "DELETE" }),
    onSuccess: () => {
      refresh();
      toast.show("Rol verwijderd", "info");
    },
    onError: (e: any) => toast.show(e?.message ?? "Mislukt", "error"),
  });

  const togglePerm = (role: Role, perm: string) => {
    const next = role.permissions.includes(perm)
      ? role.permissions.filter((p) => p !== perm)
      : [...role.permissions, perm];
    update.mutate({ name: role.name, permissions: next });
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable testID="back-button" onPress={() => goBack("/")} hitSlop={10} style={styles.headerBtn}>
          <Icon name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Rollen beheren</Text>
        <View style={styles.headerBtn} />
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.brandPrimary} />
        </View>
      ) : (
        <KeyboardAwareScrollView
          bottomOffset={20}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 14 }}
          keyboardShouldPersistTaps="handled"
        >
          <Pressable testID="roles-plans-link" onPress={() => router.push("/admin/plans")} style={styles.plansLink}>
            <Icon name="star-cog-outline" size={22} color={colors.brandPrimary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.roleLabel}>Standaard, Premium en Ultra</Text>
              <Text style={styles.roleMeta}>Kies welke functies bij welk abonnement horen</Text>
            </View>
            <Icon name="chevron-right" size={22} color={colors.muted} />
          </Pressable>
          {(data?.roles ?? []).map((role) => {
            const locked = role.name === "beheerder";
            return (
              <View key={role.name} style={styles.card} testID={`role-${role.name}`}>
                <View style={styles.roleHead}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.roleLabel}>{role.label}</Text>
                    <Text style={styles.roleMeta}>{locked ? "Vaste rol" : `${role.name}`}</Text>
                  </View>
                  {!locked ? (
                    <Pressable testID={`delete-role-${role.name}`} onPress={() => askRemove(role)} hitSlop={8}>
                      <Icon name="trash-can-outline" size={20} color={colors.muted} />
                    </Pressable>
                  ) : null}
                </View>
                {locked ? (
                  <Text style={styles.lockedText}>Beheerder heeft altijd alle rechten.</Text>
                ) : (
                  <View style={styles.perms}>
                    {allPerms.map((p) => {
                      const on = role.permissions.includes(p);
                      return (
                        <Pressable
                          key={p}
                          testID={`role-${role.name}-perm-${p}`}
                          onPress={() => togglePerm(role, p)}
                          style={[styles.permChip, on && styles.permChipOn]}
                        >
                          <Icon
                            name={on ? "check-circle" : "circle-outline"}
                            size={16}
                            color={on ? colors.brandPrimary : colors.muted}
                          />
                          <Text style={[styles.permText, on && styles.permTextOn]}>{PERM_LABELS[p] ?? p}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                )}
              </View>
            );
          })}

          <View style={styles.createCard}>
            <Text style={styles.createTitle}>Nieuwe rol</Text>
            <Field
              testID="new-role-name"
              placeholder="Naam van de rol"
              value={newLabel}
              onChangeText={setNewLabel}
              autoCapitalize="words"
            />
            <Button
              label="Rol aanmaken"
              onPress={() => newLabel.trim() && create.mutate()}
              loading={create.isPending}
              testID="create-role-button"
            />
          </View>
        </KeyboardAwareScrollView>
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
  card: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 10 },
  roleHead: { flexDirection: "row", alignItems: "center" },
  roleLabel: { fontSize: 16, fontFamily: fonts.bold, color: colors.onSurface },
  roleMeta: { fontSize: 12, fontFamily: fonts.regular, color: colors.muted, marginTop: 1 },
  lockedText: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted },
  perms: { gap: 8 },
  permChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  permChipOn: { borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary },
  permText: { fontSize: 14, fontFamily: fonts.medium, color: colors.onSurfaceSecondary },
  permTextOn: { color: colors.onBrandTertiary, fontFamily: fonts.semibold },
  createCard: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 12,
  },
  plansLink: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 16, padding: 14, backgroundColor: colors.brandTertiary },
  createTitle: { fontSize: 16, fontFamily: fonts.bold, color: colors.onSurface },
}));
