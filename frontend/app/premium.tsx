import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";

import { Button, Field, Icon } from "@/src/components/ui";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { goBack } from "@/src/nav";
import { GOLD, PREMIUM_FEATURES } from "@/src/premium";
import { useToast } from "@/src/toast";
import { fonts, makeStyles, useTheme } from "@/src/theme";

type PReq = { req_id: string; org_name: string; message?: string; status: "pending" | "approved" | "rejected" | "ended"; created_at: string };

export default function PremiumScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const router = useRouter();
  const [org, setOrg] = useState("");
  const [msg, setMsg] = useState("");
  const [sending, setSending] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["premium-request"],
    queryFn: () => api<{ request: PReq | null }>("/premium/request"),
    enabled: !user?.premium,
  });
  const req = data?.request;

  const send = async () => {
    setSending(true);
    try {
      await api("/premium/request", { method: "POST", body: { org_name: org, message: msg } });
      await qc.invalidateQueries({ queryKey: ["premium-request"] });
      toast.show("Aanvraag verstuurd", "success");
    } catch (e: any) {
      toast.show(e?.message ?? "Versturen mislukt", "error");
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable testID="back-button" onPress={() => goBack("/account")} hitSlop={10} style={styles.headerBtn}>
          <Icon name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Premium</Text>
        <View style={styles.headerBtn} />
      </View>
      <KeyboardAwareScrollView bottomOffset={20} contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: insets.bottom + 24 }} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <Icon name="star" size={34} color={GOLD.icon} />
          <Text style={styles.heroTitle}>{user?.premium ? "Je bent Premium" : "Slim Boodschappenlijstje Premium"}</Text>
          <Text style={styles.heroText}>
            {user?.premium
              ? user.premium_org
                ? `Via ${user.premium_org}. Bedankt dat jullie de app gebruiken!`
                : "Bedankt voor je steun! Je hebt alle extra functies."
              : "Extra functies om nog slimmer boodschappen te doen."}
          </Text>
        </View>

        <View style={{ gap: 12 }}>
          {PREMIUM_FEATURES.map((f) => (
            <Pressable
              key={f.title}
              style={styles.feature}
              disabled={!user?.premium || !f.to}
              onPress={() => f.to && router.push(f.to as any)}
              testID={`premium-feature-${f.icon}`}
            >
              <Icon name={f.icon} size={22} color={GOLD.icon} />
              <View style={{ flex: 1 }}>
                <Text style={styles.featureTitle}>{f.title}</Text>
                <Text style={styles.featureText}>{f.text}</Text>
                {f.where ? <Text style={styles.featureWhere}>{f.where}</Text> : null}
              </View>
              {user?.premium && f.to ? <Icon name="chevron-right" size={20} color={colors.muted} /> : null}
            </Pressable>
          ))}
        </View>

        {user?.premium ? null : isLoading ? (
          <ActivityIndicator color={colors.brandPrimary} />
        ) : req?.status === "pending" ? (
          <View style={styles.status} testID="premium-request-pending">
            <Icon name="clock-outline" size={20} color={colors.onBrandTertiary} />
            <Text style={styles.statusText}>
              Je aanvraag voor {req.org_name} is binnen. We bekijken hem zo snel mogelijk. Je krijgt een mail zodra Premium aan staat.
            </Text>
          </View>
        ) : (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Voor verenigingen gratis</Text>
            <Text style={styles.sectionText}>
              Kook je voor een scouting, sportclub of andere vereniging? Dan krijg je Premium gratis. Vraag het hieronder aan, dan zetten wij het voor je aan.
            </Text>
            {req?.status === "rejected" ? (
              <Text style={[styles.sectionText, { color: colors.error }]}>Je vorige aanvraag ({req.org_name}) is niet goedgekeurd. Mail ons gerust als je vragen hebt.</Text>
            ) : null}
            <Field label="Naam van de vereniging" testID="premium-org" placeholder="Bijv. Scouting De Bevers" value={org} onChangeText={setOrg} maxLength={100} />
            <Field
              label="Korte toelichting (niet verplicht)"
              testID="premium-msg"
              placeholder="Bijv. we koken op zomerkamp voor 40 kinderen"
              value={msg}
              onChangeText={setMsg}
              multiline
              maxLength={1000}
              style={{ minHeight: 80, textAlignVertical: "top" }}
            />
            <Button label="Gratis Premium aanvragen" onPress={send} loading={sending} disabled={org.trim().length < 2} testID="premium-request-send" />
            <Text style={styles.small}>Voor thuisgebruik komt Premium later tegen een kleine vergoeding.</Text>
          </View>
        )}
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
  hero: { alignItems: "center", gap: 6, backgroundColor: GOLD.bg, borderColor: GOLD.border, borderWidth: 1, borderRadius: 20, padding: 20 },
  heroTitle: { fontSize: 20, fontFamily: fonts.bold, color: GOLD.text, textAlign: "center" },
  heroText: { fontSize: 14, lineHeight: 20, fontFamily: fonts.regular, color: GOLD.text, textAlign: "center" },
  feature: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  featureTitle: { fontSize: 15, fontFamily: fonts.semibold, color: colors.onSurface },
  featureWhere: { fontSize: 12, fontFamily: fonts.semibold, color: GOLD.icon, marginTop: 2 },
  featureText: { fontSize: 13, lineHeight: 18, fontFamily: fonts.regular, color: colors.muted, marginTop: 1 },
  section: { gap: 12, borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: 18 },
  sectionTitle: { fontSize: 17, fontFamily: fonts.bold, color: colors.onSurface },
  sectionText: { fontSize: 14, lineHeight: 20, fontFamily: fonts.regular, color: colors.onSurfaceSecondary },
  small: { fontSize: 12, fontFamily: fonts.regular, color: colors.muted, textAlign: "center" },
  status: { flexDirection: "row", gap: 10, backgroundColor: colors.brandTertiary, borderRadius: 14, padding: 14 },
  statusText: { flex: 1, fontSize: 14, lineHeight: 20, fontFamily: fonts.medium, color: colors.onBrandTertiary },
}));
