// Je geschiedenis wissen: wat je bekeek telt mee voor je voorstellen (aanbiedingen op Home, recepten).
// Wis alles of een deel, voor een bepaalde periode. Wat de app van iedereen samen leerde, blijft.
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button, Icon } from "@/src/components/ui";
import { api } from "@/src/api";
import { goBack } from "@/src/nav";
import { useToast } from "@/src/toast";
import { fonts, makeStyles, useTheme } from "@/src/theme";

type Kind = "producten" | "recepten" | "voorraad";
type Period = "vandaag" | "week" | "maand" | "alles";
type History = { kinds: Record<Kind, { items: number; since: string | null }>; no_personal: boolean };

const KINDS: { key: Kind; label: string; sub: string }[] = [
  { key: "producten", label: "Bekeken producten", sub: "Bepaalt welke aanbiedingen je op Home ziet." },
  { key: "recepten", label: "Bekeken en gekozen recepten", sub: "Bepaalt welke recepten je voorgesteld krijgt." },
  { key: "voorraad", label: "Geleerde voorraad", sub: "Wat de voorraadkast zelf onthield ('al in huis' bij een recept). Wat je zelf invulde blijft." },
];
const PERIODS: { key: Period; label: string }[] = [
  { key: "vandaag", label: "Vandaag" },
  { key: "week", label: "Afgelopen week" },
  { key: "maand", label: "Afgelopen maand" },
  { key: "alles", label: "Alles" },
];

export default function HistoryScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const qc = useQueryClient();
  const [kinds, setKinds] = useState<Kind[]>(["producten", "recepten"]);
  const [period, setPeriod] = useState<Period>("alles");
  const [sure, setSure] = useState(false);

  const q = useQuery({ queryKey: ["my-history"], queryFn: () => api<History>("/me/history") });
  const del = useMutation({
    mutationFn: () => api("/me/history/delete", { method: "POST", body: { kinds, period } }),
    onSuccess: () => {
      setSure(false);
      ["my-history", "home", "recipes", "online-recipes"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      toast.show("Geschiedenis gewist", "success");
    },
    onError: (e: any) => toast.show(e?.message ?? "Wissen lukte niet", "error"),
  });
  const toggle = (k: Kind) => {
    setSure(false);
    setKinds((x) => (x.includes(k) ? x.filter((y) => y !== k) : [...x, k]));
  };
  const nice = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("nl-NL", { day: "numeric", month: "long" });

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable testID="back-button" onPress={() => goBack("/account")} hitSlop={10} style={styles.headerBtn}>
          <Icon name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Mijn geschiedenis</Text>
        <View style={styles.headerBtn} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: insets.bottom + 24 }}>
        <Text style={styles.intro}>
          Wat je bekijkt en kiest, gebruikt de app om je betere voorstellen te doen. Wis je dat, dan beginnen jouw voorstellen voor die periode
          opnieuw. Wat de app van alle gebruikers samen leerde (bijvoorbeeld welk product bij een ingrediënt past) blijft.
        </Text>
        {q.data?.no_personal ? (
          <View style={styles.note}>
            <Icon name="information-outline" size={18} color={colors.onBrandTertiary} />
            <Text style={styles.noteText}>Persoonlijke voorstellen staan uit bij Profiel. De app houdt nu niets bij.</Text>
          </View>
        ) : null}

        <View>
          <Text style={styles.sectionTitle}>Wat wil je wissen?</Text>
          {q.isLoading ? <ActivityIndicator color={colors.brandPrimary} /> : null}
          {KINDS.map((k) => {
            const on = kinds.includes(k.key);
            const info = q.data?.kinds[k.key];
            return (
              <Pressable key={k.key} testID={`history-${k.key}`} onPress={() => toggle(k.key)} style={styles.row}>
                <Icon name={on ? "checkbox-marked" : "checkbox-blank-outline"} size={22} color={on ? colors.brandPrimary : colors.muted} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.rowText}>{k.label}</Text>
                  <Text style={styles.sub}>{k.sub}</Text>
                  {info ? (
                    <Text style={styles.sub}>
                      {info.items ? `${info.items} onthouden` : "Niets onthouden"}
                      {info.since ? `, per dag bijgehouden sinds ${nice(info.since)}` : ""}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </View>

        <View>
          <Text style={styles.sectionTitle}>Welke periode?</Text>
          <View style={styles.chips}>
            {PERIODS.map((p) => (
              <Pressable key={p.key} testID={`history-period-${p.key}`} onPress={() => { setPeriod(p.key); setSure(false); }}
                style={[styles.chip, period === p.key && styles.chipOn]}>
                <Text style={[styles.chipText, period === p.key && styles.chipTextOn]}>{p.label}</Text>
              </Pressable>
            ))}
          </View>
          {period !== "alles" ? (
            <Text style={[styles.sub, { marginTop: 8 }]}>Wat je eerder bekeek, blijft dan meetellen.</Text>
          ) : null}
        </View>

        {sure ? (
          <View style={{ gap: 10 }}>
            <Text style={styles.rowText}>Weet je het zeker? Dit kun je niet terugdraaien.</Text>
            <Button label="Ja, wissen" icon="delete-outline" onPress={() => del.mutate()} loading={del.isPending} testID="history-confirm" />
            <Button label="Annuleren" variant="secondary" onPress={() => setSure(false)} />
          </View>
        ) : (
          <Button label="Wissen" icon="delete-outline" disabled={!kinds.length} onPress={() => setSure(true)} testID="history-delete" />
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
  intro: { fontSize: 14, lineHeight: 20, fontFamily: fonts.regular, color: colors.onSurfaceSecondary },
  sectionTitle: { fontSize: 16, fontFamily: fonts.bold, color: colors.onSurface, marginBottom: 6 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.divider },
  rowText: { fontSize: 15, fontFamily: fonts.medium, color: colors.onSurface },
  sub: { fontSize: 13, lineHeight: 18, fontFamily: fonts.regular, color: colors.muted },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: colors.brandTertiary },
  chipOn: { backgroundColor: colors.brandPrimary },
  chipText: { fontSize: 14, fontFamily: fonts.semibold, color: colors.onBrandTertiary },
  chipTextOn: { color: colors.onBrandPrimary },
  note: { flexDirection: "row", gap: 8, backgroundColor: colors.brandTertiary, borderRadius: 12, padding: 12 },
  noteText: { flex: 1, fontSize: 13, lineHeight: 18, fontFamily: fonts.regular, color: colors.onBrandTertiary },
}));
