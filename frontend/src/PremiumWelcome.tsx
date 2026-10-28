import { useState } from "react";
import { Text, View } from "react-native";
import Modal from "@/src/components/Modal";

import { Button, Icon } from "@/src/components/ui";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { fonts, makeStyles, useTheme } from "@/src/theme";
import { GOLD } from "@/src/premium";

// Felicitatie de eerste keer dat iemand de app opent nadat premium is aangezet
export function PremiumWelcome() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { user, refresh } = useAuth();
  const [busy, setBusy] = useState(false);
  if (!user?.premium_welcome || !user.terms_ok || !user.onboarded) return null;

  const close = async () => {
    setBusy(true);
    try {
      await api("/auth/premium-seen", { method: "POST" });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={close}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.badge}>
            <Icon name="star" size={46} color={colors.onBrandSecondary} />
          </View>
          <Text style={styles.title}>Je bent nu Premium!</Text>
          <Text style={styles.text}>Bedankt voor je steun aan Slim Boodschappenlijstje. Je ziet je premium-status voortaan onder Account.</Text>
          <Button label="Top!" onPress={close} loading={busy} testID="premium-welcome-ok" style={{ alignSelf: "stretch" }} />
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  backdrop: { flex: 1, backgroundColor: "rgba(28,27,26,0.55)", justifyContent: "center", padding: 24 },
  card: { backgroundColor: colors.surface, borderRadius: 24, padding: 24, gap: 14, alignItems: "center" },
  badge: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: colors.brandSecondary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 4,
    borderColor: GOLD.border,
  },
  title: { fontSize: 24, fontFamily: fonts.bold, color: colors.onSurface, textAlign: "center" },
  text: { fontSize: 15, lineHeight: 22, fontFamily: fonts.regular, color: colors.onSurfaceSecondary, textAlign: "center" },
}));
