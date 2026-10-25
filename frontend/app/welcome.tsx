import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, Icon } from "@/src/components/ui";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { useToast } from "@/src/toast";
import { TermsCheck } from "@/src/TermsCheck";
import { Tutorial } from "@/src/Tutorial";
import { fonts, makeStyles, useTheme } from "@/src/theme";

// Eerste keer inloggen: eerst akkoord met voorwaarden (ook na een wijziging of via Google), daarna de uitleg
export default function WelcomeScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const { user, refresh, logout } = useAuth();
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);

  // Alleen opnieuw akkoord nodig (uitleg al gezien): daarna meteen terug naar de app
  const done = !!user?.terms_ok && !!user?.onboarded;
  useEffect(() => {
    if (done) router.replace("/");
  }, [done, router]);

  const accept = async () => {
    if (!agree) {
      toast.show("Zet eerst het vinkje", "error");
      return;
    }
    setBusy(true);
    try {
      await api("/auth/accept-terms", { method: "POST" });
      await refresh();
    } catch (e: any) {
      toast.show(e?.message ?? "Mislukt", "error");
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    try {
      await api("/auth/onboarded", { method: "POST" });
      await refresh();
    } catch {
      // niet erg: dan zie je de uitleg de volgende keer nog eens
    }
    router.replace("/");
  };

  if (user && !user.terms_ok) {
    const isNew = !user.onboarded;
    return (
      <View style={[styles.root, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.center}>
          <View style={styles.iconWrap}>
            <Icon name="file-document-check-outline" size={44} color={colors.brandPrimary} />
          </View>
          <Text style={styles.title}>{isNew ? "Nog één ding" : "Onze voorwaarden zijn aangepast"}</Text>
          <Text style={styles.text}>
            {isNew
              ? "Voordat je de app gebruikt, vragen we je akkoord te gaan met de voorwaarden en de privacyverklaring. Daarin lees je wat je van ons kunt verwachten en wat we met je gegevens doen."
              : "We hebben de voorwaarden of de privacyverklaring bijgewerkt. Lees ze even door en geef akkoord om verder te gaan."}
          </Text>
          <TermsCheck value={agree} onChange={setAgree} />
        </View>
        <View style={{ gap: 12, paddingHorizontal: 20 }}>
          <Button label="Akkoord en verder" onPress={accept} loading={busy} disabled={!agree} testID="accept-terms" />
          <Button label="Uitloggen" variant="ghost" onPress={logout} testID="welcome-logout" />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Tutorial onDone={finish} />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, justifyContent: "center", paddingHorizontal: 24, gap: 16 },
  iconWrap: {
    width: 88,
    height: 88,
    borderRadius: 28,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
  },
  title: { fontSize: 24, fontFamily: fonts.bold, color: colors.onSurface, textAlign: "center" },
  text: { fontSize: 16, lineHeight: 24, fontFamily: fonts.regular, color: colors.onSurfaceSecondary, textAlign: "center" },
}));
