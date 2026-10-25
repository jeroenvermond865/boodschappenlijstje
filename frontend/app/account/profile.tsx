import { useState } from "react";
import { Pressable, Text, View } from "react-native";
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
  const { user, refresh } = useAuth();
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
        body: { name, username, email, phone, store, picture, email_opt_out: !emailOn },
      });
      await refresh();
      toast.show("Profiel opgeslagen", "success");
    } catch (e: any) {
      toast.show(e?.message ?? "Opslaan mislukt", "error");
    } finally {
      setSavingProfile(false);
    }
  };

  const savePassword = async () => {
    if (newPw.length < 6) {
      toast.show("Nieuw wachtwoord moet minstens 6 tekens zijn", "error");
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
            placeholder="Minstens 6 tekens"
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
      </KeyboardAwareScrollView>
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
}));
