import { Pressable, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "@/src/components/ui";
import { LEGAL, LEGAL_DOCS, type LegalDoc } from "@/src/legal";
import { goBack } from "@/src/nav";
import { WithdrawForm } from "@/src/WithdrawForm";
import { fonts, makeStyles, useTheme } from "@/src/theme";

const TABS: { key: LegalDoc; label: string }[] = [
  { key: "voorwaarden", label: "Voorwaarden" },
  { key: "privacy", label: "Privacy" },
  { key: "cookies", label: "Cookies" },
  { key: "herroepen", label: "Herroepen" },
];

// Leesbaar zonder in te loggen: ook vanaf het registratiescherm
export default function LegalScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ doc: string }>();
  const key: LegalDoc = params.doc in LEGAL_DOCS ? (params.doc as LegalDoc) : "voorwaarden";
  const doc = LEGAL_DOCS[key];

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable testID="back-button" onPress={() => goBack("/")} hitSlop={10} style={styles.headerBtn}>
          <Icon name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>{doc.title}</Text>
        <View style={styles.headerBtn} />
      </View>
      <View style={styles.segment}>
        {TABS.map((t) => (
          <Pressable
            key={t.key}
            testID={`legal-tab-${t.key}`}
            onPress={() => router.setParams({ doc: t.key })}
            style={[styles.segBtn, key === t.key && styles.segBtnActive]}
          >
            <Text style={[styles.segText, key === t.key && styles.segTextActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32, gap: 18 }}>
        <Text style={styles.updated}>Laatst bijgewerkt: {LEGAL.updated}</Text>
        <Text style={styles.body}>{doc.intro}</Text>
        {doc.sections.map((s, si) => (
          <View key={s.h} style={{ gap: 8 }}>
            <Text style={styles.h}>{s.h}</Text>
            {s.p.map((p, i) => (
              <Text key={i} style={styles.body}>
                {p}
              </Text>
            ))}
            {/* De herroepknop direct onder de uitleg, vóór het modelformulier */}
            {key === "herroepen" && si === 0 ? <View style={{ marginTop: 8 }}><WithdrawForm /></View> : null}
          </View>
        ))}
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
  segment: {
    flexDirection: "row",
    backgroundColor: colors.surfaceTertiary,
    borderRadius: 12,
    padding: 4,
    marginHorizontal: 16,
    marginTop: 12,
  },
  segBtn: { flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: "center" },
  segBtnActive: { backgroundColor: colors.surface },
  segText: { fontSize: 13, fontFamily: fonts.medium, color: colors.muted },
  segTextActive: { color: colors.onSurface, fontFamily: fonts.semibold },
  updated: { fontSize: 12, fontFamily: fonts.regular, color: colors.muted },
  h: { fontSize: 16, fontFamily: fonts.bold, color: colors.onSurface },
  body: { fontSize: 15, lineHeight: 22, fontFamily: fonts.regular, color: colors.onSurfaceSecondary },
}));
