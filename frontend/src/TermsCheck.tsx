import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";

import { Icon } from "@/src/components/ui";
import { LEGAL } from "@/src/legal";
import { fonts, makeStyles, useTheme } from "@/src/theme";

// Vinkje "akkoord met voorwaarden en privacy": verplicht voor je een account hebt
export function TermsCheck({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const open = (doc: string) => router.push({ pathname: "/legal/[doc]", params: { doc } });
  return (
    <Pressable testID="terms-check" onPress={() => onChange(!value)} style={styles.row}>
      <Icon name={value ? "checkbox-marked" : "checkbox-blank-outline"} size={22} color={value ? colors.brandPrimary : colors.muted} />
      <View style={{ flex: 1 }}>
        <Text style={styles.text}>
          Ik ga akkoord met de{" "}
          <Text style={styles.link} onPress={() => open("voorwaarden")}>
            algemene voorwaarden
          </Text>{" "}
          en de{" "}
          <Text style={styles.link} onPress={() => open("privacy")}>
            privacyverklaring
          </Text>
          . Ik ben {LEGAL.minAge} jaar of ouder, of heb toestemming van mijn ouder.
        </Text>
      </View>
    </Pressable>
  );
}

export function LegalLinks() {
  const styles = useStyles();
  const router = useRouter();
  const open = (doc: string) => router.push({ pathname: "/legal/[doc]", params: { doc } });
  return (
    <View style={styles.links}>
      <Text style={styles.small} onPress={() => open("voorwaarden")}>Voorwaarden</Text>
      <Text style={styles.small}>·</Text>
      <Text style={styles.small} onPress={() => open("privacy")}>Privacy</Text>
      <Text style={styles.small}>·</Text>
      <Text style={styles.small} onPress={() => open("cookies")}>Cookies</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  row: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 2 },
  text: { fontSize: 13, lineHeight: 19, fontFamily: fonts.regular, color: colors.onSurfaceSecondary },
  link: { fontFamily: fonts.semibold, color: colors.brandPrimary, textDecorationLine: "underline" },
  links: { flexDirection: "row", justifyContent: "center", gap: 8, marginTop: 14 },
  small: { fontSize: 12, fontFamily: fonts.medium, color: colors.onSurfaceInverse, opacity: 0.85 },
}));
