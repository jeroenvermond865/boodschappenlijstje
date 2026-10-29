import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import Modal from "@/src/components/Modal";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button, Field, Icon, PasswordField } from "@/src/components/ui";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { goBack } from "@/src/nav";
import { useToast } from "@/src/toast";
import { planAccent, planIcon } from "@/src/premium";
import { fonts, makeStyles, useTheme } from "@/src/theme";

type AdminUser = { id: string; name: string; email: string; username?: string | null; phone?: string | null; role: string; premium?: boolean; plan?: "standaard" | "premium" | "ultra";
  terms_ok?: boolean; terms_version?: string | null; terms_accepted_at?: string | null; created_at?: string | null };

const nlDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("nl-NL", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : null;
type Role = { name: string; label: string };
const PAGE = 50;
type SignupReq = { id: string; name?: string; email?: string; auth_provider?: string; created_at?: string | null };

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
  // Accountaanvragen: staat dit aan, dan moet een nieuw account eerst hier worden goedgekeurd
  const { data: signupData } = useQuery({
    queryKey: ["signup-requests"],
    queryFn: () => api<{ enabled: boolean; requests: SignupReq[] }>("/admin/signup-requests"),
  });
  const signupOn = !!signupData?.enabled;
  const signupReqs = signupData?.requests ?? [];
  const afterSignup = () => {
    qc.invalidateQueries({ queryKey: ["signup-requests"] });
    qc.invalidateQueries({ queryKey: ["admin-users"] });
    qc.invalidateQueries({ queryKey: ["settings"] });
    qc.invalidateQueries({ queryKey: ["home"] });
  };
  const toggleSignup = useMutation({
    mutationFn: (enabled: boolean) => api("/admin/signup-approval", { method: "PUT", body: { enabled } }),
    onSuccess: (_d, enabled) => {
      afterSignup();
      toast.show(enabled ? "Nieuwe accounts moeten nu eerst goedgekeurd worden" : "Iedereen kan weer zelf een account aanmaken", "success");
    },
    onError: (e: any) => toast.show(e?.message ?? "Mislukt", "error"),
  });
  const reviewSignup = useMutation({
    mutationFn: (v: { id: string; action: "approve" | "reject" }) => api(`/admin/signup-requests/${v.id}/${v.action}`, { method: "POST" }),
    onSuccess: (_d, v) => {
      afterSignup();
      toast.show(v.action === "approve" ? "Account goedgekeurd, de gebruiker krijgt een e-mail" : "Aanvraag afgewezen", v.action === "approve" ? "success" : "info");
    },
    onError: (e: any) => toast.show(e?.message ?? "Mislukt", "error"),
  });

  // Zoeken op naam, e-mail, gebruikersnaam of telefoon; filteren op rol en abonnement; sorteren; per 50 tonen.
  // Zo blijft het overzichtelijk, ook met duizend gebruikers.
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [planFilter, setPlanFilter] = useState<"all" | "standaard" | "premium" | "ultra">("all");
  const [sort, setSort] = useState<"new" | "name">("new");
  const [shown, setShown] = useState(PAGE);
  const [signupOpen, setSignupOpen] = useState(false);
  const norm = (t?: string | null) => (t ?? "").toLowerCase();
  const terms = norm(q).split(/\s+/).filter(Boolean);
  const allUsers = usersData?.users ?? [];
  const planOf = (u: AdminUser) => u.plan ?? (u.premium ? "premium" : "standaard");
  const users = allUsers
    .filter(
      (u) =>
        (roleFilter === "all" || u.role === roleFilter) &&
        (planFilter === "all" || planOf(u) === planFilter) &&
        terms.every((t) => [u.name, u.email, u.username, u.phone].some((v) => norm(v).includes(t))),
    )
    .sort((a, b) => (sort === "name" ? norm(a.name || a.email).localeCompare(norm(b.name || b.email)) : (b.created_at ?? "").localeCompare(a.created_at ?? "")));
  // Alleen de beheerder kan iemand beheerder maken
  const allRoles = rolesData?.roles ?? [];
  const roles = allRoles.filter((r) => iAmOwner || r.name !== "beheerder");
  const roleLabel = (n: string) => allRoles.find((r) => r.name === n)?.label ?? n;
  const countBy = (f: (u: AdminUser) => boolean) => allUsers.filter(f).length;
  const resetPage = () => setShown(PAGE);

  const PLAN_LABEL: Record<string, string> = { standaard: "Standaard", premium: "Premium", ultra: "Ultra" };
  const setPremium = useMutation({
    mutationFn: (v: { id: string; plan: string }) => api(`/admin/users/${v.id}/plan`, { method: "PUT", body: { plan: v.plan } }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      toast.show(`Abonnement: ${PLAN_LABEL[v.plan]}`, "success");
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
    if (pw.length < 8 || !/[^A-Za-z0-9\s]/.test(pw)) return toast.show("Minstens 8 tekens en een speciaal teken", "error");
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
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 12 }} keyboardShouldPersistTaps="handled">
          {/* Overzicht in getallen; tik om te filteren */}
          <View style={styles.stats}>
            <Stat label="Totaal" n={allUsers.length} on={planFilter === "all" && roleFilter === "all"} onPress={() => { setPlanFilter("all"); setRoleFilter("all"); resetPage(); }} />
            <Stat label="Standaard" n={countBy((u) => planOf(u) === "standaard")} on={planFilter === "standaard"} onPress={() => { setPlanFilter("standaard"); resetPage(); }} />
            <Stat label="Premium" n={countBy((u) => planOf(u) === "premium")} on={planFilter === "premium"} color={planAccent("premium")} onPress={() => { setPlanFilter("premium"); resetPage(); }} />
            <Stat label="Ultra" n={countBy((u) => planOf(u) === "ultra")} on={planFilter === "ultra"} color={planAccent("ultra")} onPress={() => { setPlanFilter("ultra"); resetPage(); }} />
          </View>

          {/* Accountaanvragen: klein, klapt open */}
          <View style={styles.card} testID="signup-approval">
            <Pressable onPress={() => setSignupOpen((v) => !v)} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Icon name="account-clock-outline" size={20} color={colors.brandPrimary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>Accounts eerst goedkeuren: {signupOn ? "aan" : "uit"}</Text>
                {signupReqs.length ? <Text style={[styles.email, { color: colors.brandPrimary }]}>{signupReqs.length === 1 ? "1 aanvraag wacht" : `${signupReqs.length} aanvragen wachten`}</Text> : null}
              </View>
              <Icon name={signupOpen ? "chevron-up" : "chevron-down"} size={22} color={colors.muted} />
            </Pressable>
            {signupOpen ? (
            <Pressable
              testID="signup-approval-toggle"
              onPress={() => toggleSignup.mutate(!signupOn)}
              disabled={toggleSignup.isPending || !signupData}
              style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.email}>
                  {signupOn
                    ? "Aan: wie zich registreert, komt hieronder als aanvraag te staan en kan pas inloggen na jouw goedkeuring."
                    : "Uit: iedereen kan zelf een account aanmaken en meteen beginnen."}
                </Text>
              </View>
              <Icon name={signupOn ? "toggle-switch" : "toggle-switch-off-outline"} size={40} color={signupOn ? colors.brandPrimary : colors.muted} />
            </Pressable>
            ) : null}
            {signupReqs.length ? (
              <View style={{ gap: 10 }}>
                {signupReqs.map((r) => (
                  <View key={r.id} style={styles.signupRow} testID={`signup-${r.id}`}>
                    <Text style={styles.name} numberOfLines={1}>{r.name || r.email}</Text>
                    <Text style={styles.email} numberOfLines={1}>
                      {r.email}
                      {r.auth_provider === "google" ? " (Google)" : ""}
                      {r.created_at ? ` · ${nlDate(r.created_at)}` : ""}
                    </Text>
                    <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
                      <Pressable
                        testID={`signup-reject-${r.id}`}
                        disabled={reviewSignup.isPending}
                        onPress={() => reviewSignup.mutate({ id: r.id, action: "reject" })}
                        style={[styles.signupBtn, { borderWidth: 1.5, borderColor: colors.error }]}
                      >
                        <Icon name="close" size={18} color={colors.error} />
                        <Text style={[styles.signupBtnText, { color: colors.error }]}>Afwijzen</Text>
                      </Pressable>
                      <Pressable
                        testID={`signup-approve-${r.id}`}
                        disabled={reviewSignup.isPending}
                        onPress={() => reviewSignup.mutate({ id: r.id, action: "approve" })}
                        style={[styles.signupBtn, { backgroundColor: colors.brandPrimary }]}
                      >
                        <Icon name="check" size={18} color={colors.onBrandPrimary} />
                        <Text style={[styles.signupBtnText, { color: colors.onBrandPrimary }]}>Goedkeuren</Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
              </View>
            ) : null}
          </View>

          <Field testID="user-search" value={q} onChangeText={(t) => { setQ(t); resetPage(); }} placeholder="Zoek op naam, e-mail, gebruikersnaam of telefoon" autoCapitalize="none" />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {[{ name: "all", label: "Alle rollen" }, ...allRoles].map((r) => {
              const n = r.name === "all" ? allUsers.length : countBy((u) => u.role === r.name);
              if (r.name !== "all" && !n) return null;
              const active = roleFilter === r.name;
              return (
                <Pressable key={r.name} testID={`role-filter-${r.name}`} onPress={() => { setRoleFilter(r.name); resetPage(); }} style={[styles.chip, active && styles.chipActive]}>
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{r.label} ({n})</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={styles.count}>
              {users.length === allUsers.length ? `${allUsers.length} gebruikers` : `${users.length} van ${allUsers.length} gebruikers`}
            </Text>
            <Pressable onPress={() => setSort((v) => (v === "new" ? "name" : "new"))} style={{ flexDirection: "row", alignItems: "center", gap: 4 }} hitSlop={6} testID="user-sort">
              <Icon name="sort" size={18} color={colors.brandPrimary} />
              <Text style={[styles.count, { color: colors.brandPrimary }]}>{sort === "new" ? "Nieuwste eerst" : "Naam A-Z"}</Text>
            </Pressable>
          </View>

          <View style={styles.listCard}>
            {users.slice(0, shown).map((u, i) => {
              const plan = planOf(u);
              const pc = plan === "standaard" ? null : planAccent(plan);
              return (
                <Pressable key={u.id} testID={`user-${u.id}`} onPress={() => openEdit(u)} style={({ pressed }) => [styles.userRow, i > 0 && styles.rowLine, pressed && { opacity: 0.7 }]}>
                  <View style={[styles.avatar, pc && { backgroundColor: pc.icon }]}>
                    <Text style={styles.avatarText}>{(u.name || u.email || "?").charAt(0).toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name} numberOfLines={1}>{u.name || u.email}</Text>
                    <Text style={styles.email} numberOfLines={1}>
                      {u.email}
                      {!u.terms_ok ? " · voorwaarden open" : ""}
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 4 }}>
                    <Text style={styles.rolePill} numberOfLines={1}>{roleLabel(u.role)}</Text>
                    {pc ? (
                      <View style={[styles.premiumPill, { backgroundColor: pc.icon }]}>
                        <Icon name={planIcon(plan)} size={11} color="#FFFFFF" />
                        <Text style={styles.premiumText}>{PLAN_LABEL[plan]}</Text>
                      </View>
                    ) : null}
                  </View>
                  <Icon name="chevron-right" size={20} color={colors.muted} />
                </Pressable>
              );
            })}
            {!users.length ? <Text style={[styles.email, { padding: 14 }]}>Niemand gevonden.</Text> : null}
          </View>
          {users.length > shown ? (
            <Button label={`Meer tonen (${users.length - shown} over)`} variant="secondary" onPress={() => setShown((n) => n + PAGE)} testID="users-more" />
          ) : null}
        </ScrollView>
      )}

      <Modal visible={!!edit} animationType="fade" transparent onRequestClose={() => setEdit(null)}>
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
            {edit ? (
              <View style={{ gap: 8 }}>
                <Text style={styles.pwTitle}>Rol</Text>
                <View style={[styles.chipRow, { flexWrap: "wrap" }]}>
                  {roles.map((r) => {
                    const active = (allUsers.find((x) => x.id === edit.id)?.role ?? edit.role) === r.name;
                    return (
                      <Pressable key={r.name} testID={`user-${edit.id}-role-${r.name}`} disabled={active} onPress={() => setRole.mutate({ id: edit.id, role: r.name })} style={[styles.chip, active && styles.chipActive]}>
                        <Text style={[styles.chipText, active && styles.chipTextActive]}>{r.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Text style={styles.pwTitle}>Abonnement</Text>
                <View style={[styles.chipRow, { flexWrap: "wrap" }]}>
                  {(["standaard", "premium", "ultra"] as const).map((pl) => {
                    const cur = allUsers.find((x) => x.id === edit.id) ?? edit;
                    const active = planOf(cur) === pl;
                    const pc = pl === "standaard" ? null : planAccent(pl);
                    return (
                      <Pressable key={pl} testID={`user-premium-${edit.id}-${pl}`} disabled={active} onPress={() => setPremium.mutate({ id: edit.id, plan: pl })}
                        style={[styles.chip, active && (pc ? { backgroundColor: pc.icon, borderColor: pc.icon } : styles.chipActive)]}>
                        <Text style={[styles.chipText, active && styles.chipTextActive]}>{PLAN_LABEL[pl]}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Text style={styles.email}>
                  {edit.terms_accepted_at
                    ? `Voorwaarden akkoord: ${nlDate(edit.terms_accepted_at)}${edit.terms_ok ? "" : ` (oude versie ${edit.terms_version ?? "?"})`}`
                    : "Voorwaarden nog niet geaccepteerd"}
                  {edit.created_at ? ` · lid sinds ${nlDate(edit.created_at)}` : ""}
                </Text>
              </View>
            ) : null}
            <Field label="Naam" testID="admin-user-name" value={form.name} onChangeText={(t) => setForm((f) => ({ ...f, name: t }))} />
            <Field label="Gebruikersnaam" testID="admin-user-username" value={form.username} onChangeText={(t) => setForm((f) => ({ ...f, username: t }))} autoCapitalize="none" />
            <Field label="E-mail" testID="admin-user-email" value={form.email} onChangeText={(t) => setForm((f) => ({ ...f, email: t }))} autoCapitalize="none" keyboardType="email-address" />
            <Field label="Telefoon" testID="admin-user-phone" value={form.phone} onChangeText={(t) => setForm((f) => ({ ...f, phone: t }))} keyboardType="phone-pad" />
            <Button label="Opslaan" onPress={() => saveUser.mutate()} loading={saveUser.isPending} testID="admin-user-save" />

            <View style={styles.pwBlock}>
              <Text style={styles.pwTitle}>Wachtwoord instellen</Text>
              <Text style={styles.pwHint}>Handig als iemand z'n wachtwoord vergeten is.</Text>
              <PasswordField label="Nieuw wachtwoord" testID="admin-user-pw" placeholder="Minstens 8 tekens en een speciaal teken" value={pw} onChangeText={setPw} />
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

function Stat({ label, n, on, onPress, color }: { label: string; n: number; on: boolean; onPress: () => void; color?: { bg: string; border: string; text: string } }) {
  const styles = useStyles();
  return (
    <Pressable onPress={onPress} style={[styles.stat, color && { backgroundColor: color.bg, borderColor: color.border }, on && styles.statOn]} testID={`stat-${label}`}>
      <Text style={[styles.statN, color && { color: color.text }]}>{n}</Text>
      <Text style={[styles.statLabel, color && { color: color.text }]}>{label}</Text>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  stats: { flexDirection: "row", gap: 8 },
  stat: { flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary },
  statOn: { borderWidth: 2, borderColor: colors.brandPrimary },
  statN: { fontSize: 20, fontFamily: fonts.bold, color: colors.onSurface },
  statLabel: { fontSize: 11, fontFamily: fonts.semibold, color: colors.muted },
  listCard: { borderRadius: 16, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  rowLine: { borderTopWidth: 1, borderTopColor: colors.divider },
  rolePill: { fontSize: 11, fontFamily: fonts.semibold, color: colors.onBrandTertiary, backgroundColor: colors.brandTertiary, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, overflow: "hidden", maxWidth: 110 },
  count: { fontSize: 13, fontFamily: fonts.medium, color: colors.muted },
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
  userRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
  avatar: {
    width: 36,
    height: 36,
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
  premiumText: { fontSize: 11, fontFamily: fonts.semibold, color: "#FFFFFF" },
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
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center" },
  // De witte achtergrond hoort bij het scrollvak zelf; anders schuift de inhoud bij scrollen buiten het witte vlak
  sheetScroll: { maxHeight: "92%", width: "92%", maxWidth: 560, alignSelf: "center", backgroundColor: colors.surface, borderRadius: 20, flexGrow: 0 },
  sheet: { padding: 16, gap: 12 },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sheetTitle: { fontSize: 18, fontFamily: fonts.bold, color: colors.onSurface },
  pwBlock: { gap: 10, borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: 14, marginTop: 2 },
  pwTitle: { fontSize: 15, fontFamily: fonts.bold, color: colors.onSurface },
  pwHint: { fontSize: 12, fontFamily: fonts.regular, color: colors.muted, marginTop: -4 },
  deleteBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12 },
  deleteText: { fontSize: 15, fontFamily: fonts.semibold, color: colors.error },
  signupRow: { borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: 10 },
  signupBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 12 },
  signupBtnText: { fontSize: 14, fontFamily: fonts.semibold },
}));
