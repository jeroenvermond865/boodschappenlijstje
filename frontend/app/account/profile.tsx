import { useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";

import { Button, Field, Icon, PasswordField, Select } from "@/src/components/ui";
import { ImageUploadField } from "@/src/components/ImageUploadField";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { goBack } from "@/src/nav";
import { useToast } from "@/src/toast";
import { fonts, makeStyles, useTheme } from "@/src/theme";

export default function ProfileScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user, refresh, logout } = useAuth();
  const toast = useToast();

  const { data: storeData } = useQuery({
    queryKey: ["stores"],
    queryFn: () => api<{ stores: string[] }>("/stores"),
  });
  const stores = storeData?.stores ?? ["Albert Heijn"];

  const [name, setName] = useState(user?.name ?? "");
  const [username, setUsername] = useState(user?.username ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [store, setStore] = useState(user?.store ?? "Albert Heijn");
  const [picture, setPicture] = useState(user?.picture ?? "");
  const [emailOn, setEmailOn] = useState(!(user?.email_opt_out ?? false));
  const [personalOn, setPersonalOn] = useState(!(user?.no_personal ?? false));
  const [savingProfile, setSavingProfile] = useState(false);

  const [current, setCurrent] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [savingPw, setSavingPw] = useState(false);

  const saveProfile = async () => {
    setSavingProfile(true);
    try {
      await api("/auth/profile", {
        method: "PUT",
        body: { name, username, email, phone, store, picture, email_opt_out: !emailOn, no_personal: !personalOn },
      });
      await refresh();
      toast.show("Profiel opgeslagen", "success");
    } catch (e: any) {
      toast.show(e?.message ?? "Opslaan mislukt", "error");
    } finally {
      setSavingProfile(false);
    }
  };

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePw, setDeletePw] = useState("");
  const [deleting, setDeleting] = useState(false);

  const deleteAccount = async () => {
    setDeleting(true);
    try {
      await api("/auth/delete-account", { method: "POST", body: { password: deletePw } });
      setDeleteOpen(false);
      toast.show("Je account en gegevens zijn verwijderd", "success");
      await logout();
    } catch (e: any) {
      toast.show(e?.message ?? "Verwijderen mislukt", "error");
    } finally {
      setDeleting(false);
    }
  };

  const savePassword = async () => {
    if (newPw.length < 8) {
      toast.show("Nieuw wachtwoord moet minstens 8 tekens zijn", "error");
      return;
    }
    if (newPw !== confirmPw) {
      toast.show("De twee wachtwoorden zijn niet gelijk", "error");
      return;
    }
    setSavingPw(true);
    try {
      await api("/auth/change-password", {
        method: "POST",
        body: { current_password: current, new_password: newPw },
      });
      setCurrent("");
      setNewPw("");
      setConfirmPw("");
      toast.show("Wachtwoord gewijzigd", "success");
    } catch (e: any) {
      toast.show(e?.message ?? "Mislukt", "error");
    } finally {
      setSavingPw(false);
    }
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable testID="back-button" onPress={() => goBack("/")} hitSlop={10} style={styles.headerBtn}>
          <Icon name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Profiel & wachtwoord</Text>
        <View style={styles.headerBtn} />
      </View>

      <KeyboardAwareScrollView
        bottomOffset={20}
        contentContainerStyle={{ padding: 16, gap: 22 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Gegevens</Text>
          <ImageUploadField label="Profielfoto" testID="profile-photo" value={picture} onChange={setPicture} circle />
          <Field label="Naam" testID="profile-name" value={name} onChangeText={setName} />
          <Field
            label="Gebruikersnaam"
            testID="profile-username"
            placeholder="Kies een gebruikersnaam"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
          />
          <Field
            label="E-mail"
            testID="profile-email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <Field
            label="Telefoonnummer"
            testID="profile-phone"
            placeholder="Bijv. 0612345678"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
          />
          <View style={{ gap: 8 }}>
            <Text style={styles.fieldLabel}>Favoriete winkel</Text>
            <Select testID="profile-store" value={store} options={stores} icon="storefront-outline" onChange={setStore} />
            <Text style={styles.storeHint}>Deze winkel staat overal in de app vooraan: bij producten, folders, recepten en aanbiedingen. Prijzen en budget rekenen ook met deze winkel.</Text>
          </View>
          <Pressable testID="email-toggle" onPress={() => setEmailOn((v) => !v)} style={styles.emailToggle}>
            <Icon name={emailOn ? "checkbox-marked" : "checkbox-blank-outline"} size={22} color={emailOn ? colors.brandPrimary : colors.muted} />
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>E-mails ontvangen</Text>
              <Text style={styles.storeHint}>Bijv. uitnodigingen. Belangrijke berichten zoals wachtwoord-reset blijven altijd komen.</Text>
            </View>
          </Pressable>
          <Pressable testID="personal-toggle" onPress={() => setPersonalOn((v) => !v)} style={styles.emailToggle}>
            <Icon name={personalOn ? "checkbox-marked" : "checkbox-blank-outline"} size={22} color={personalOn ? colors.brandPrimary : colors.muted} />
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>Persoonlijke aanbiedingen en recepten</Text>
              <Text style={styles.storeHint}>
                We onthouden welke afdelingen, merken en recepten je bekijkt, zodat wat bij jou past bovenaan staat. Zet je dit uit, dan wissen we wat we hadden bijgehouden.
              </Text>
            </View>
          </Pressable>
          <Button label="Gegevens opslaan" onPress={saveProfile} loading={savingProfile} testID="save-profile-button" />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Wachtwoord wijzigen</Text>
          <PasswordField
            label="Huidig wachtwoord"
            testID="profile-current-pw"
            placeholder="••••••••"
            value={current}
            onChangeText={setCurrent}
          />
          <PasswordField
            label="Nieuw wachtwoord"
            testID="profile-new-pw"
            placeholder="Minstens 8 tekens"
            value={newPw}
            onChangeText={setNewPw}
          />
          <PasswordField
            label="Herhaal nieuw wachtwoord"
            testID="profile-confirm-pw"
            placeholder="Nogmaals hetzelfde"
            value={confirmPw}
            onChangeText={setConfirmPw}
          />
          <Button
            label="Wachtwoord opslaan"
            variant="secondary"
            onPress={savePassword}
            loading={savingPw}
            testID="save-password-button"
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account verwijderen</Text>
          <Text style={styles.storeHint}>
            Je account en alles wat van jou is, worden direct en definitief gewist. Gedeelde planningen blijven bestaan voor de anderen. Dit kun je niet ongedaan maken.
          </Text>
          <Pressable testID="delete-account-button" onPress={() => setDeleteOpen(true)} style={styles.dangerBtn}>
            <Icon name="account-remove-outline" size={18} color={colors.error} />
            <Text style={styles.dangerText}>Account verwijderen</Text>
          </Pressable>
        </View>
      </KeyboardAwareScrollView>

      <Modal visible={deleteOpen} transparent animationType="fade" onRequestClose={() => setDeleteOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.sectionTitle}>Weet je het zeker?</Text>
            <Text style={styles.storeHint}>
              Al je gegevens worden definitief verwijderd: je profiel, je eigen planningen, gerechten, pakketten en favorieten.
            </Text>
            {user?.has_password ? (
              <PasswordField
                label="Je wachtwoord ter bevestiging"
                testID="delete-account-pw"
                placeholder="••••••••"
                value={deletePw}
                onChangeText={setDeletePw}
              />
            ) : null}
            <Pressable
              testID="delete-account-confirm"
              disabled={deleting || (!!user?.has_password && !deletePw)}
              onPress={deleteAccount}
              style={[styles.dangerBtnSolid, (deleting || (!!user?.has_password && !deletePw)) && { opacity: 0.5 }]}
            >
              <Text style={styles.dangerSolidText}>{deleting ? "Bezig…" : "Ja, verwijder mijn account"}</Text>
            </Pressable>
            <Button label="Annuleren" variant="ghost" onPress={() => setDeleteOpen(false)} testID="delete-account-cancel" />
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
  section: { gap: 14 },
  sectionTitle: { fontSize: 16, fontFamily: fonts.bold, color: colors.onSurface },
  fieldLabel: { fontSize: 14, fontFamily: fonts.semibold, color: colors.onSurface },
  storeHint: { fontSize: 12, fontFamily: fonts.regular, color: colors.muted },
  emailToggle: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 4 },
  dangerBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.error,
  },
  dangerText: { fontSize: 15, fontFamily: fonts.semibold, color: colors.error },
  dangerBtnSolid: { paddingVertical: 14, borderRadius: 14, backgroundColor: colors.error, alignItems: "center" },
  dangerSolidText: { fontSize: 15, fontFamily: fonts.semibold, color: colors.onError },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(28,27,26,0.5)", justifyContent: "center", padding: 20 },
  modalCard: { backgroundColor: colors.surface, borderRadius: 20, padding: 20, gap: 14 },
}));
