import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, Text, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";

import { Button, Field, Icon } from "@/src/components/ui";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { goBack } from "@/src/nav";
import { GOLD, PLAN_NAME, PREMIUM_FEATURES, ULTRA, usePlans, type PlanKey } from "@/src/premium";
import { useToast } from "@/src/toast";
import { fonts, makeStyles, useTheme } from "@/src/theme";

type Billing = { enabled: boolean; plan: PlanKey | null; active: boolean; cancelled: boolean; paid_until: string | null; test: boolean };
type PReq = { req_id: string; org_name: string; message?: string; status: "pending" | "approved" | "rejected" | "ended"; created_at: string };

export default function PremiumScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user, refresh } = useAuth();
  const { betaald } = useLocalSearchParams<{ betaald?: string }>();
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
  // Betalen via Mollie: alleen zichtbaar als de beheerder Mollie heeft gekoppeld, anders blijft alles zoals het was
  const billing = useQuery({ queryKey: ["billing"], queryFn: () => api<Billing>("/billing") });
  const bill = billing.data;
  const [paying, setPaying] = useState<PlanKey | null>(null);
  const [stopAsk, setStopAsk] = useState(false);
  const [stopping, setStopping] = useState(false);
  const canBuy = !!bill?.enabled && (!user?.premium || !!bill.plan);

  // Terug van iDEAL: de betaling komt via Mollie binnen, haal je account een paar keer opnieuw op
  useEffect(() => {
    if (!betaald) return;
    toast.show("Bedankt! Je betaling wordt verwerkt.", "success");
    let n = 0;
    const t = setInterval(() => {
      n += 1;
      refresh().catch(() => {});
      qc.invalidateQueries({ queryKey: ["billing"] });
      if (n >= 5) clearInterval(t);
    }, 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [betaald]);

  const buy = async (plan: PlanKey) => {
    setPaying(plan);
    try {
      const r = await api<{ checkout_url: string }>("/billing/start", { method: "POST", body: { plan } });
      if (Platform.OS === "web" && typeof window !== "undefined") window.location.href = r.checkout_url;
      else await Linking.openURL(r.checkout_url);
    } catch (e: any) {
      toast.show(e?.message ?? "Betalen lukt nu niet", "error");
      setPaying(null);
    }
  };
  const stop = async () => {
    setStopping(true);
    try {
      await api("/billing/cancel", { method: "POST" });
      await Promise.all([refresh(), qc.invalidateQueries({ queryKey: ["billing"] })]);
      setStopAsk(false);
      toast.show("Opgezegd. Je houdt alles tot het eind van de betaalde maand.", "success");
    } catch (e: any) {
      toast.show(e?.message ?? "Opzeggen lukte niet", "error");
    } finally {
      setStopping(false);
    }
  };
  const nice = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "long" }) : "");
  const plans = usePlans();
  const mine: PlanKey = (user?.plan as PlanKey) ?? (user?.premium ? "premium" : "standaard");
  const planOf = (k: string) => plans.data?.features.find((f) => f.key === k)?.plan ?? "premium";
  const levels = plans.data?.levels ?? [];
  const rank = { standaard: 0, premium: 1, ultra: 2 } as const;

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
        <Text style={styles.headerTitle}>Abonnementen</Text>
        <View style={styles.headerBtn} />
      </View>
      <KeyboardAwareScrollView bottomOffset={20} contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: insets.bottom + 24 }} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <Icon name="star" size={34} color={GOLD.icon} />
          <Text style={styles.heroTitle}>{user?.premium ? `Je hebt ${PLAN_NAME[mine]}` : "Wat kost het en wat krijg je?"}</Text>
          <Text style={styles.heroText}>
            {user?.premium
              ? user.premium_org
                ? `Via ${user.premium_org}. Bedankt dat jullie de app gebruiken!`
                : "Bedankt voor je steun! Je hebt alle extra functies."
              : "Extra functies om nog slimmer boodschappen te doen."}
          </Text>
        </View>

        {/* Wat kost het en wat krijg je: de drie abonnementen naast elkaar */}
        <View style={styles.plans}>
          {levels.map((l) => {
            const c = l.key === "ultra" ? ULTRA : l.key === "premium" ? GOLD : null;
            const extra = PREMIUM_FEATURES.filter((f) => planOf(f.key) === l.key);
            return (
              <View key={l.key} style={[styles.plan, c && { backgroundColor: c.bg, borderColor: c.border }, mine === l.key && styles.planMine]} testID={`plan-${l.key}`}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  {l.key !== "standaard" ? <Icon name="star" size={16} color={c!.icon} /> : null}
                  <Text style={[styles.planName, c && { color: c.text }]}>{l.label}</Text>
                  {mine === l.key ? <Text style={styles.planNow}>Jouw abonnement</Text> : null}
                </View>
                <Text style={[styles.planPrice, c && { color: c.text }]}>
                  {l.key === "standaard" ? "Gratis" : l.price ? `€ ${l.price.toFixed(2).replace(".", ",")} per maand` : "Prijs volgt"}
                </Text>
                <Text style={styles.featureText}>
                  {l.key === "standaard"
                    ? "Lijstjes, gerechten, aanbiedingen, prijzen vergelijken, delen, Vandaag en Wat je vaak koopt."
                    : `Alles van ${l.key === "ultra" ? "Premium" : "Standaard"}${extra.length ? ", plus:" : "."}`}
                </Text>
                {extra.map((f) => (
                  <Text key={f.key} style={styles.planLine}>• {f.title}</Text>
                ))}
                {l.ai_limit ? <Text style={styles.planLine}>• {l.ai_limit} vragen per dag aan de slimme hulp</Text> : null}
                {canBuy && l.key !== "standaard" && l.price && !(bill?.active && bill.plan === l.key) ? (
                  <Button
                    label={bill?.active ? `Overstappen naar ${l.label}` : `Neem ${l.label}`}
                    icon="credit-card-outline"
                    onPress={() => buy(l.key as PlanKey)}
                    loading={paying === l.key}
                    testID={`plan-buy-${l.key}`}
                    style={{ marginTop: 8 }}
                  />
                ) : null}
              </View>
            );
          })}
        </View>

        <View style={{ gap: 12 }}>
          {PREMIUM_FEATURES.map((f) => {
            const need = planOf(f.key);
            const have = rank[mine] >= rank[need];
            return (
              <Pressable
                key={f.title}
                style={styles.feature}
                disabled={!have || !f.to}
                onPress={() => f.to && router.push(f.to as any)}
                testID={`premium-feature-${f.icon}`}
              >
                <Icon name={f.icon} size={22} color={need === "ultra" ? ULTRA.icon : GOLD.icon} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.featureTitle}>
                    {f.title}
                    {need !== "standaard" ? <Text style={styles.featureWhere}>{`  ${PLAN_NAME[need]}`}</Text> : null}
                  </Text>
                  <Text style={styles.featureText}>{f.text}</Text>
                  {f.where ? <Text style={styles.featureWhere}>{f.where}</Text> : null}
                </View>
                {have && f.to ? <Icon name="chevron-right" size={20} color={colors.muted} /> : null}
              </Pressable>
            );
          })}
        </View>

        {bill?.plan && user?.premium ? (
          <View style={styles.section} testID="billing-status">
            <Text style={styles.sectionTitle}>Je abonnement</Text>
            {bill.cancelled ? (
              <Text style={styles.sectionText}>Opgezegd. Je houdt {PLAN_NAME[bill.plan]} tot {nice(bill.paid_until)}, daarna ga je vanzelf terug naar Standaard. Er wordt niets meer afgeschreven.</Text>
            ) : (
              <>
                <Text style={styles.sectionText}>
                  Je betaalt elke maand automatisch voor {PLAN_NAME[bill.plan]}. Opzeggen kan altijd: je houdt alles tot het eind van de maand die je al betaald hebt.
                </Text>
                {stopAsk ? (
                  <View style={{ gap: 8 }}>
                    <Text style={styles.sectionText}>Weet je het zeker?</Text>
                    <Button label="Ja, opzeggen" variant="secondary" onPress={stop} loading={stopping} testID="billing-cancel-confirm" />
                    <Button label="Toch niet" onPress={() => setStopAsk(false)} />
                  </View>
                ) : (
                  <Button label="Abonnement opzeggen" variant="secondary" onPress={() => setStopAsk(true)} testID="billing-cancel" />
                )}
              </>
            )}
          </View>
        ) : null}
        {bill?.test && canBuy ? <Text style={styles.small}>Testmodus: er wordt nog geen echt geld afgeschreven.</Text> : null}

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
            {bill?.enabled ? null : <Text style={styles.small}>Voor thuisgebruik komt Premium later tegen een kleine vergoeding.</Text>}
          </View>
        )}
        <Text style={styles.small}>
          Je betaalt nooit ongemerkt, kunt altijd opzeggen en hebt bij kopen 14 dagen bedenktijd.{"\n"}
          <Text style={styles.link} onPress={() => router.push({ pathname: "/legal/[doc]", params: { doc: "voorwaarden" } })} testID="premium-terms">
            Voorwaarden
          </Text>
          {"  ·  "}
          <Text style={styles.link} onPress={() => router.push({ pathname: "/legal/[doc]", params: { doc: "herroepen" } })} testID="premium-withdraw">
            Herroepen
          </Text>
        </Text>
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
  plans: { gap: 10 },
  plan: { gap: 4, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary, padding: 14 },
  planMine: { borderWidth: 2, borderColor: colors.brandPrimary },
  planName: { fontSize: 16, fontFamily: fonts.bold, color: colors.onSurface },
  planNow: { marginLeft: "auto", fontSize: 11, fontFamily: fonts.semibold, color: colors.onBrandPrimary, backgroundColor: colors.brandPrimary, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, overflow: "hidden" },
  planPrice: { fontSize: 15, fontFamily: fonts.semibold, color: colors.onSurface },
  planLine: { fontSize: 13, lineHeight: 18, fontFamily: fonts.regular, color: colors.onSurfaceSecondary },
  featureTitle: { fontSize: 15, fontFamily: fonts.semibold, color: colors.onSurface },
  featureWhere: { fontSize: 12, fontFamily: fonts.semibold, color: GOLD.icon, marginTop: 2 },
  featureText: { fontSize: 13, lineHeight: 18, fontFamily: fonts.regular, color: colors.muted, marginTop: 1 },
  section: { gap: 12, borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: 18 },
  sectionTitle: { fontSize: 17, fontFamily: fonts.bold, color: colors.onSurface },
  sectionText: { fontSize: 14, lineHeight: 20, fontFamily: fonts.regular, color: colors.onSurfaceSecondary },
  small: { fontSize: 12, lineHeight: 18, fontFamily: fonts.regular, color: colors.muted, textAlign: "center" },
  link: { fontFamily: fonts.semibold, color: colors.brandPrimary, textDecorationLine: "underline" },
  status: { flexDirection: "row", gap: 10, backgroundColor: colors.brandTertiary, borderRadius: 14, padding: 14 },
  statusText: { flex: 1, fontSize: 14, lineHeight: 20, fontFamily: fonts.medium, color: colors.onBrandTertiary },
}));
