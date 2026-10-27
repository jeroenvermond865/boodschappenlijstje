// Beheer: welke functie hoort bij Standaard, Premium of Ultra, wat het kost, hoeveel AI-vragen per dag,
// en welk AI-model elke taak gebruikt. Wat je hier kiest, geldt meteen voor alle gebruikers.
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button, Field, Icon } from "@/src/components/ui";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { goBack } from "@/src/nav";
import { PLAN_NAME, PREMIUM_FEATURES, type PlanKey, type Plans } from "@/src/premium";
import { useToast } from "@/src/toast";
import { fonts, makeStyles, useTheme } from "@/src/theme";

type Ai = {
  models: { key: string; label: string; model: string; price_in: number; price_out: number }[];
  tasks: { key: string; label: string; tier: string; default: string; month: { n: number; hits: number; cost: number } }[];
};
const LEVELS: PlanKey[] = ["standaard", "premium", "ultra"];
const euro = (n: number) => `€ ${n.toFixed(2).replace(".", ",")}`;

export default function AdminPlansScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const qc = useQueryClient();
  const { refresh } = useAuth();

  const plans = useQuery({ queryKey: ["plans"], queryFn: () => api<Plans>("/plans") });
  const ai = useQuery({ queryKey: ["admin-ai"], queryFn: () => api<Ai>("/admin/ai") });

  const [price, setPrice] = useState<Record<string, string>>({});
  const [limit, setLimit] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!plans.data) return;
    setPrice(Object.fromEntries(plans.data.levels.filter((l) => l.key !== "standaard").map((l) => [l.key, l.price != null ? String(l.price).replace(".", ",") : ""])));
    setLimit(Object.fromEntries(plans.data.levels.map((l) => [l.key, String(l.ai_limit)])));
  }, [plans.data]);

  const savePlans = useMutation({
    mutationFn: (body: object) => api<Plans>("/admin/plans", { method: "PUT", body }),
    onSuccess: (d) => {
      qc.setQueryData(["plans"], d);
      refresh(); // je eigen functies meteen bijwerken
      toast.show("Opgeslagen, geldt meteen voor iedereen", "success");
    },
    onError: (e: any) => toast.show(e?.message ?? "Mislukt", "error"),
  });
  const saveAi = useMutation({
    mutationFn: (tasks: Record<string, string>) => api<Ai>("/admin/ai", { method: "PUT", body: { tasks } }),
    onSuccess: (d) => {
      qc.setQueryData(["admin-ai"], d);
      toast.show("AI-model opgeslagen", "success");
    },
    onError: (e: any) => toast.show(e?.message ?? "Mislukt", "error"),
  });

  const setFeature = (key: string, plan: PlanKey) => {
    const cur = Object.fromEntries((plans.data?.features ?? []).map((f) => [f.key, f.plan]));
    savePlans.mutate({ features: { ...cur, [key]: plan } });
  };
  const setTier = (key: string, tier: string) => {
    const cur = Object.fromEntries((ai.data?.tasks ?? []).map((t) => [t.key, t.tier]));
    saveAi.mutate({ ...cur, [key]: tier });
  };
  const num = (v: string) => Number((v || "0").replace(",", "."));

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable testID="back-button" onPress={() => goBack("/account")} hitSlop={10} style={styles.headerBtn}>
          <Icon name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Abonnementen en AI</Text>
        <View style={styles.headerBtn} />
      </View>
      {plans.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.brandPrimary} />
        </View>
      ) : (
        <KeyboardAwareScrollView bottomOffset={20} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32, gap: 16 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.intro}>
            Kies per functie welk abonnement je nodig hebt. Ultra heeft alles van Premium, Premium alles van Standaard. Wat je kiest, zien gebruikers meteen in de app en op de pagina Abonnementen.
          </Text>

          <Text style={styles.section}>Functies</Text>
          {(plans.data?.features ?? []).map((f) => {
            const info = PREMIUM_FEATURES.find((x) => x.key === f.key);
            return (
              <View key={f.key} style={styles.card} testID={`plan-feature-${f.key}`}>
                <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
                  <Icon name={(info?.icon ?? "star") as any} size={20} color={colors.brandPrimary} />
                  <Text style={[styles.cardTitle, { flex: 1 }]}>{f.title}</Text>
                </View>
                <Seg options={LEVELS.map((l) => ({ key: l, label: PLAN_NAME[l] }))} value={f.plan} onChange={(v) => setFeature(f.key, v as PlanKey)} />
              </View>
            );
          })}

          <Text style={styles.section}>Prijs per maand</Text>
          <View style={styles.card}>
            <View style={{ flexDirection: "row", gap: 10 }}>
              {(["premium", "ultra"] as const).map((k) => (
                <View key={k} style={{ flex: 1 }}>
                  <Field label={PLAN_NAME[k]} keyboardType="decimal-pad" value={price[k] ?? ""} onChangeText={(v) => setPrice((p) => ({ ...p, [k]: v }))} testID={`plan-price-${k}`} />
                </View>
              ))}
            </View>
            <Text style={styles.small}>Dit laat de app zien bij Abonnementen. Betalen kan nog niet in de app; verenigingen krijgen Premium gratis.</Text>
          </View>

          <Text style={styles.section}>Slimme hulp: vragen per dag</Text>
          <View style={styles.card}>
            <View style={{ flexDirection: "row", gap: 10 }}>
              {LEVELS.map((k) => (
                <View key={k} style={{ flex: 1 }}>
                  <Field label={PLAN_NAME[k]} keyboardType="number-pad" value={limit[k] ?? ""} onChangeText={(v) => setLimit((p) => ({ ...p, [k]: v }))} testID={`plan-limit-${k}`} />
                </View>
              ))}
            </View>
            <Text style={styles.small}>Elke vraag kost geld. Standaard staat op 0 zolang de slimme hulp niet bij Standaard hoort.</Text>
          </View>
          <Button
            label="Prijzen en aantallen opslaan"
            loading={savePlans.isPending}
            onPress={() =>
              savePlans.mutate({
                price: Object.fromEntries(Object.entries(price).map(([k, v]) => [k, num(v)])),
                ai_limit: Object.fromEntries(Object.entries(limit).map(([k, v]) => [k, Math.round(num(v))])),
              })
            }
            testID="plans-save"
          />

          <Text style={styles.section}>AI-model per taak</Text>
          <Text style={styles.intro}>
            Haiku is snel en het goedkoopst (ongeveer 40 keer goedkoper dan Opus). Sonnet zit ertussenin. Opus is het slimst, maar het duurst. Antwoorden worden onthouden: dezelfde vraag kost de tweede keer niets.
          </Text>
          {(ai.data?.tasks ?? []).map((t) => (
            <View key={t.key} style={styles.card} testID={`ai-task-${t.key}`}>
              <Text style={styles.cardTitle}>{t.label}</Text>
              <Text style={styles.small}>
                Laatste 30 dagen: {t.month.n} keer AI, {t.month.hits} keer uit het geheugen, {euro(t.month.cost)}
              </Text>
              <Seg
                options={(ai.data?.models ?? []).map((m) => ({ key: m.key, label: m.label.split(" (")[1]?.replace(")", "") ?? m.label }))}
                value={t.tier}
                onChange={(v) => setTier(t.key, v)}
              />
              {t.tier !== t.default ? <Text style={styles.small}>Aangeraden: {(ai.data?.models ?? []).find((m) => m.key === t.default)?.label}</Text> : null}
            </View>
          ))}
        </KeyboardAwareScrollView>
      )}
    </View>
  );
}

function Seg({ options, value, onChange }: { options: { key: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  const styles = useStyles();
  return (
    <View style={styles.seg}>
      {options.map((o) => (
        <Pressable key={o.key} onPress={() => o.key !== value && onChange(o.key)} style={[styles.segBtn, o.key === value && styles.segOn]} testID={`seg-${o.key}`}>
          <Text style={[styles.segText, o.key === value && styles.segTextOn]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 10, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.divider },
  headerBtn: { width: 44, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 18, fontFamily: fonts.bold, color: colors.onSurface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 40 },
  intro: { fontSize: 14, lineHeight: 20, fontFamily: fonts.regular, color: colors.onSurfaceSecondary },
  section: { fontSize: 13, fontFamily: fonts.bold, color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 6 },
  card: { borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 10 },
  cardTitle: { fontSize: 15, fontFamily: fonts.semibold, color: colors.onSurface },
  small: { fontSize: 12, lineHeight: 17, fontFamily: fonts.regular, color: colors.muted },
  seg: { flexDirection: "row", backgroundColor: colors.surfaceSecondary, borderRadius: 12, padding: 3, gap: 3 },
  segBtn: { flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: "center" },
  segOn: { backgroundColor: colors.brandPrimary },
  segText: { fontSize: 13, fontFamily: fonts.medium, color: colors.onSurfaceSecondary },
  segTextOn: { color: colors.onBrandPrimary, fontFamily: fonts.semibold },
}));
