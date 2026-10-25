import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";

import { Button, Field, Icon } from "@/src/components/ui";
import { api, mediaUrl } from "@/src/api";
import { useAuth } from "@/src/auth";
import { useToast } from "@/src/toast";
import { fonts, makeStyles, useTheme } from "@/src/theme";

const HERO =
  "https://images.unsplash.com/photo-1466220549276-aef9ce186540?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NTY2Nzh8MHwxfHNlYXJjaHwxfHxjYW1wZmlyZSUyMGNvb2tpbmd8ZW58MHx8fHwxNzkxNDQ5MTA2fDA&ixlib=rb-4.1.0&q=85";

export default function LoginScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { login, register, loginWithGoogle } = useAuth();
  const toast = useToast();

  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);

  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: () => api<{ app_name: string; tagline: string; hero_url: string; logo_url: string }>("/settings"),
  });
  const appName = settings?.app_name ?? "Slim Boodschappenlijstje";
  const tagline = settings?.tagline ?? "Plan maaltijden en boodschappen per kampdag";
  const hero = mediaUrl(settings?.hero_url) ?? HERO;
  const logo = mediaUrl(settings?.logo_url);

  const submit = async () => {
    if (!email.trim() || !password) {
      toast.show("Vul e-mail en wachtwoord in", "error");
      return;
    }
    if (mode === "register" && !name.trim()) {
      toast.show("Vul je naam in", "error");
      return;
    }
    setBusy(true);
    try {
      if (mode === "login") {
        await login(email.trim(), password);
      } else {
        await register(name.trim(), email.trim(), password);
      }
    } catch (e: any) {
      toast.show(e?.message ?? "Inloggen mislukt", "error");
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    setBusy(true);
    try {
      await loginWithGoogle();
    } catch (e: any) {
      toast.show(e?.message ?? "Google inloggen mislukt", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <Image source={{ uri: hero }} style={StyleSheet.absoluteFill} contentFit="cover" transition={300} />
      <LinearGradient
        colors={["rgba(38,36,35,0.35)", "rgba(38,36,35,0.65)", colors.surfaceInverse]}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFill}
      />

      <KeyboardAwareScrollView
        bottomOffset={20}
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.brandRow}>
          <View style={styles.logo}>
            {logo ? (
              <Image source={{ uri: logo }} style={styles.logoImg} contentFit="cover" />
            ) : (
              <Icon name="campfire" size={26} color={colors.onBrandPrimary} />
            )}
          </View>
          <Text style={styles.brandName}>{appName}</Text>
        </View>
        <Text style={styles.tagline}>{tagline}</Text>

        <View style={styles.card}>
          <View style={styles.segment}>
            <Pressable
              testID="tab-login"
              onPress={() => setMode("login")}
              style={[styles.segBtn, mode === "login" && styles.segBtnActive]}
            >
              <Text style={[styles.segText, mode === "login" && styles.segTextActive]}>Inloggen</Text>
            </Pressable>
            <Pressable
              testID="tab-register"
              onPress={() => setMode("register")}
              style={[styles.segBtn, mode === "register" && styles.segBtnActive]}
            >
              <Text style={[styles.segText, mode === "register" && styles.segTextActive]}>Registreren</Text>
            </Pressable>
          </View>

          <View style={styles.form}>
            {mode === "register" ? (
              <Field
                label="Naam"
                testID="input-name"
                placeholder="Je naam"
                value={name}
                onChangeText={setName}
                autoCapitalize="words"
              />
            ) : null}
            <Field
              label={mode === "login" ? "E-mail of gebruikersnaam" : "E-mail"}
              testID="input-email"
              placeholder={mode === "login" ? "naam@voorbeeld.nl of gebruikersnaam" : "naam@voorbeeld.nl"}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType={mode === "register" ? "email-address" : "default"}
              autoComplete={mode === "register" ? "email" : "off"}
            />
            <Field
              label="Wachtwoord"
              testID="input-password"
              placeholder="••••••••"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />
            {mode === "login" ? (
              <Pressable testID="forgot-link" onPress={() => setForgotOpen(true)} hitSlop={6} style={styles.forgotWrap}>
                <Text style={styles.forgotText}>Wachtwoord vergeten?</Text>
              </Pressable>
            ) : null}
            <Button
              label={mode === "login" ? "Inloggen" : "Account aanmaken"}
              onPress={submit}
              loading={busy}
              testID="submit-button"
            />

            {process.env.EXPO_PUBLIC_GOOGLE_LOGIN === "1" ? (
              <>
            <View style={styles.divider}>
              <View style={styles.line} />
              <Text style={styles.dividerText}>of</Text>
              <View style={styles.line} />
            </View>

            <Button
              label="Doorgaan met Google"
              variant="ghost"
              icon="google"
              onPress={google}
              testID="google-button"
            />
              </>
            ) : null}
          </View>
        </View>
      </KeyboardAwareScrollView>

      <ForgotPasswordModal visible={forgotOpen} onClose={() => setForgotOpen(false)} />
    </View>
  );
}

function ForgotPasswordModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);

  const close = () => {
    setStep("email");
    setEmail("");
    setCode("");
    setPw("");
    onClose();
  };

  const sendCode = async () => {
    if (!email.trim()) return;
    setBusy(true);
    try {
      await api("/auth/forgot-password", { method: "POST", body: { email: email.trim() } });
      toast.show("Als dit e-mailadres bestaat, is er een code verstuurd", "info");
      setStep("code");
    } catch (e: any) {
      toast.show(e?.message ?? "Mislukt", "error");
    } finally {
      setBusy(false);
    }
  };

  const doReset = async () => {
    if (!code.trim() || !pw) return;
    setBusy(true);
    try {
      await api("/auth/reset-password", { method: "POST", body: { email: email.trim(), code: code.trim(), new_password: pw } });
      toast.show("Wachtwoord gewijzigd, log nu in", "success");
      close();
    } catch (e: any) {
      toast.show(e?.message ?? "Mislukt", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <Pressable style={styles.sheetBackdrop} onPress={close} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.sheetHandle} />
        <Text style={styles.sheetTitle}>Wachtwoord vergeten</Text>
        {step === "email" ? (
          <View style={{ gap: 14 }}>
            <Field
              label="E-mail"
              testID="forgot-email"
              placeholder="naam@voorbeeld.nl"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
            />
            <Button label="Stuur resetcode" onPress={sendCode} loading={busy} testID="forgot-send" />
          </View>
        ) : (
          <View style={{ gap: 14 }}>
            <Field label="Code uit e-mail" testID="forgot-code" placeholder="6-cijferige code" value={code} onChangeText={setCode} keyboardType="number-pad" />
            <Field label="Nieuw wachtwoord" testID="forgot-newpw" placeholder="••••••••" value={pw} onChangeText={setPw} secureTextEntry />
            <Button label="Wachtwoord instellen" onPress={doReset} loading={busy} testID="forgot-reset" />
          </View>
        )}
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surfaceInverse },
  scroll: { flexGrow: 1, justifyContent: "flex-end", paddingHorizontal: 20 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8 },
  logo: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  logoImg: { width: "100%", height: "100%" },
  brandName: { fontSize: 30, fontFamily: fonts.bold, color: colors.onSurfaceInverse },
  tagline: { fontSize: 15, fontFamily: fonts.regular, color: colors.onSurfaceInverse, opacity: 0.85, marginBottom: 20 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 24,
    padding: 20,
  },
  segment: {
    flexDirection: "row",
    backgroundColor: colors.surfaceTertiary,
    borderRadius: 12,
    padding: 4,
    marginBottom: 18,
  },
  segBtn: { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: "center" },
  segBtnActive: { backgroundColor: colors.surface },
  segText: { fontSize: 14, fontFamily: fonts.medium, color: colors.muted },
  segTextActive: { color: colors.onSurface, fontFamily: fonts.semibold },
  form: { gap: 14 },
  divider: { flexDirection: "row", alignItems: "center", gap: 12, marginVertical: 2 },
  line: { flex: 1, height: 1, backgroundColor: colors.divider },
  dividerText: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted },
  forgotWrap: { alignSelf: "flex-end", marginTop: -4 },
  forgotText: { fontSize: 13, fontFamily: fonts.semibold, color: colors.brandPrimary },
  sheetBackdrop: { flex: 1, backgroundColor: "rgba(28,27,26,0.5)" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20 },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, alignSelf: "center", marginBottom: 14 },
  sheetTitle: { fontSize: 19, fontFamily: fonts.bold, color: colors.onSurface, marginBottom: 16 },
}));
