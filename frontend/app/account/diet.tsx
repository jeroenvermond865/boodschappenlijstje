import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "@/src/components/ui";
import { DIET_RULES, DIETS, useDiet } from "@/src/diet";
import { goBack } from "@/src/nav";
import { fonts, makeStyles, useTheme } from "@/src/theme";

export default function DietScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { selected, toggle } = useDiet();

  const Row = ({ k, label }: { k: string; label: string }) => {
    const on = selected.includes(k);
    return (
      <Pressable testID={`diet-${k}`} onPress={() => toggle(k)} style={styles.row}>
        <Icon name={on ? "checkbox-marked" : "checkbox-blank-outline"} size={22} color={on ? colors.brandPrimary : colors.muted} />
        <Text style={styles.rowText}>{label}</Text>
      </Pressable>
    );
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable testID="back-button" onPress={() => goBack("/account")} hitSlop={10} style={styles.headerBtn}>
          <Icon name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Allergieën & dieet</Text>
        <View style={styles.headerBtn} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 22, paddingBottom: insets.bottom + 24 }}>
        <Text style={styles.intro}>
          Vink aan waar je rekening mee wilt houden. Bij gerechten zie je dan een waarschuwing als er iets in zit, en je kunt filteren op gerechten die
          passen. Deze keuzes blijven alleen op dit apparaat en gaan niet naar onze server.
        </Text>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Dieet</Text>
          {DIETS.map((d) => (
            <Row key={d.key} k={d.key} label={d.label} />
          ))}
        </View>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Allergieën</Text>
          {DIET_RULES.map((d) => (
            <Row key={d.key} k={d.key} label={d.label} />
          ))}
        </View>
        <View style={styles.note}>
          <Icon name="alert-circle-outline" size={18} color={colors.onBrandTertiary} />
          <Text style={styles.noteText}>
            De app kijkt naar de namen van de ingrediënten. Dat is een hulpmiddel en geen garantie. Controleer bij een allergie altijd het etiket van het
            product.
          </Text>
        </View>
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
  section: { gap: 2 },
  sectionTitle: { fontSize: 16, fontFamily: fonts.bold, color: colors.onSurface, marginBottom: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.divider },
  rowText: { fontSize: 15, fontFamily: fonts.medium, color: colors.onSurface },
  note: { flexDirection: "row", gap: 8, backgroundColor: colors.brandTertiary, borderRadius: 12, padding: 12 },
  noteText: { flex: 1, fontSize: 13, lineHeight: 18, fontFamily: fonts.regular, color: colors.onBrandTertiary },
}));
