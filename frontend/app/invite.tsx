// Deel de app en verdien Premium: wie via jouw link komt en Premium neemt, levert jou een maand Premium op
import { useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Share, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button, Icon } from "@/src/components/ui";
import { api } from "@/src/api";
import { goBack } from "@/src/nav";
import { GOLD } from "@/src/premium";
import { useToast } from "@/src/toast";
import { fonts, makeStyles, useTheme } from "@/src/theme";

type Ref = {
  code: string;
  link: string | null;
  invited: number;
  rewarded: number;
  months: number;
  max_months: number;
  bank: number;
  referred: boolean;
  can_claim: boolean;
};

const STEPS = [
  { icon: "share-variant", text: "Deel je persoonlijke link met vrienden, familie of je club." },
  { icon: "account-plus-outline", text: "Ze maken via jouw link een account aan." },
  { icon: "star-outline", text: "Nemen ze Premium? Dan krijg jij een maand Premium cadeau." },
];

export default function InviteScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const { data, isLoading } = useQuery({ queryKey: ["referral"], queryFn: () => api<Ref>("/referral") });

  const text = data
    ? `Ik gebruik Slim Boodschappenlijstje voor mijn weekmenu en boodschappen: je ziet meteen waar je lijst het goedkoopst is. Probeer het ook!${data.link ? ` ${data.link}` : ""}`
    : "";
  const share = async () => {
    if (!data) return;
    try {
      if (Platform.OS === "web" && typeof navigator !== "undefined") {
        if ((navigator as any).share) {
          await (navigator as any).share({ text });
          return;
        }
        await navigator.clipboard?.writeText(data.link ?? text);
        toast.show("Link gekopieerd", "success");
        return;
      }
      await Share.share({ message: text });
    } catch {
      // gebruiker brak het delen af
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(data?.link ?? data?.code ?? "");
      toast.show("Link gekopieerd", "success");
    } catch {
      toast.show("Kopiëren lukte niet", "error");
    }
  };
  const claim = useMutation({
    mutationFn: () => api<{ ok: boolean; detail?: string; by?: string }>("/referral/claim", { method: "POST", body: { code } }),
    onSuccess: (r) => {
      toast.show(r.ok ? `Gelukt! Je bent uitgenodigd door ${r.by || "een vriend"}.` : r.detail ?? "Dat lukte niet", r.ok ? "success" : "info");
      qc.invalidateQueries({ queryKey: ["referral"] });
    },
    onError: (e: any) => toast.show(e?.message ?? "Deze code klopt niet", "error"),
  });

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable testID="back-button" onPress={() => goBack("/account")} hitSlop={10} style={styles.headerBtn}>
          <Icon name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Deel en verdien Premium</Text>
        <View style={styles.headerBtn} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: insets.bottom + 24, width: "100%", maxWidth: 640, alignSelf: "center" }}>
        <View style={styles.hero}>
          <Icon name="gift-outline" size={34} color={GOLD.icon} />
          <Text style={styles.heroTitle}>Een maand Premium voor elke vriend</Text>
          <Text style={styles.heroText}>Voor elke vriend die via jouw link Premium neemt, krijg jij een maand Premium cadeau. Tot {data?.max_months ?? 12} maanden.</Text>
        </View>

        <View style={{ gap: 10 }}>
          {STEPS.map((s, i) => (
            <View key={i} style={styles.step}>
              <View style={styles.stepIcon}>
                <Icon name={s.icon} size={18} color={colors.brandPrimary} />
              </View>
              <Text style={styles.stepText}>{s.text}</Text>
            </View>
          ))}
        </View>

        {isLoading || !data ? (
          <ActivityIndicator color={colors.brandPrimary} />
        ) : (
          <>
            <View style={styles.card}>
              <Text style={styles.label}>Jouw link</Text>
              <Pressable onPress={copy} style={styles.linkBox} testID="invite-copy">
                <Text style={styles.linkText} numberOfLines={1}>{data.link ?? data.code}</Text>
                <Icon name="content-copy" size={18} color={colors.brandPrimary} />
              </Pressable>
              <Text style={styles.small}>Of geef je code door: <Text style={{ fontFamily: fonts.bold, color: colors.onSurface }}>{data.code}</Text></Text>
              <Button label="Delen" icon="share-variant" onPress={share} testID="invite-share" />
            </View>

            <View style={styles.stats}>
              <View style={styles.stat}>
                <Text style={styles.statN}>{data.invited}</Text>
                <Text style={styles.statLabel}>aangemeld</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statN}>{data.rewarded}</Text>
                <Text style={styles.statLabel}>Premium genomen</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statN}>{data.months}</Text>
                <Text style={styles.statLabel}>maanden verdiend</Text>
              </View>
            </View>
            {data.bank ? (
              <Text style={styles.small}>
                {data.bank === 1 ? "1 maand staat" : `${data.bank} maanden staan`} op je tegoed. Die gaan in zodra je huidige Premium stopt.
              </Text>
            ) : null}

            {data.can_claim ? (
              <View style={styles.card}>
                <Text style={styles.label}>Uitgenodigd door iemand?</Text>
                <Text style={styles.small}>Vul hun code in, dan krijgt diegene een maand Premium als jij Premium neemt.</Text>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <TextInput
                    value={code}
                    onChangeText={(t) => setCode(t.toUpperCase())}
                    placeholder="Code"
                    autoCapitalize="characters"
                    placeholderTextColor={colors.muted}
                    style={[styles.input, { flex: 1 }]}
                    testID="invite-code"
                  />
                  <Button label="Invullen" variant="secondary" onPress={() => claim.mutate()} loading={claim.isPending} disabled={code.trim().length < 4} />
                </View>
              </View>
            ) : null}
            <Text style={styles.small}>
              De beloning komt als je vriend echt Premium neemt, niet al bij het aanmelden. Jezelf uitnodigen telt niet mee.
            </Text>
          </>
        )}
      </ScrollView>
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
  hero: { alignItems: "center", gap: 6, padding: 18, borderRadius: 18, backgroundColor: GOLD.bg, borderWidth: 1, borderColor: GOLD.border },
  heroTitle: { fontSize: 19, fontFamily: fonts.bold, color: GOLD.text, textAlign: "center" },
  heroText: { fontSize: 14, lineHeight: 20, fontFamily: fonts.regular, color: GOLD.text, textAlign: "center" },
  step: { flexDirection: "row", alignItems: "center", gap: 10 },
  stepIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  stepText: { flex: 1, fontSize: 14, lineHeight: 20, fontFamily: fonts.regular, color: colors.onSurface },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 14, gap: 10 },
  label: { fontSize: 15, fontFamily: fonts.bold, color: colors.onSurface },
  linkBox: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 12, backgroundColor: colors.surfaceTertiary, paddingHorizontal: 12, paddingVertical: 10 },
  linkText: { flex: 1, fontSize: 14, fontFamily: fonts.medium, color: colors.onSurface },
  small: { fontSize: 12, lineHeight: 17, fontFamily: fonts.regular, color: colors.muted },
  stats: { flexDirection: "row", gap: 10 },
  stat: { flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: 14, backgroundColor: colors.surfaceTertiary },
  statN: { fontSize: 22, fontFamily: fonts.bold, color: colors.onSurface },
  statLabel: { fontSize: 11, fontFamily: fonts.medium, color: colors.muted, textAlign: "center" },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, fontFamily: fonts.regular, color: colors.onSurface },
}));
