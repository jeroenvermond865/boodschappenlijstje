import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "@/src/components/ui";
import { ProductBrowser } from "@/src/ProductBrowser";
import { useFeature, useFeatureAccent } from "@/src/premium";
import { usesNativeTabs } from "@/src/navigation";
import { useAppSettings } from "@/src/settings";
import { fonts, makeStyles, useTheme } from "@/src/theme";

export type { Product, Promo } from "@/src/ProductBrowser";

export default function ProductsScreen() {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const s = useAppSettings();
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;
  const router = useRouter();
  const { colors } = useTheme();
  const premium = useFeature("prijsalarm");
  const acc = useFeatureAccent("prijsalarm");
  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ProductBrowser
        bottomPadding={bottomChrome + 96}
        header={
          <View style={styles.headRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{s.tab_products}</Text>
              <Text style={styles.subtitle}>{s.sub_products}</Text>
            </View>
            <Pressable testID="alerts-button" onPress={() => router.push("/alerts")} hitSlop={8} style={styles.headBtn}>
              <Icon name="bell-ring-outline" size={22} color={premium ? colors.brandPrimary : acc.c.icon} />
              <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
                <Text style={[styles.headBtnText, !premium && { color: acc.c.icon }]}>Prijsalarm</Text>
                {premium ? null : <Icon name={acc.icon} size={11} color={acc.c.icon} />}
              </View>
            </Pressable>
          </View>
        }
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  headRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  headBtn: { alignItems: "center", gap: 2, paddingTop: 8, paddingHorizontal: 4 },
  headBtnText: { fontSize: 11, fontFamily: fonts.semibold, color: colors.brandPrimary },
  title: { fontSize: 32, fontFamily: fonts.bold, color: colors.onSurface },
  subtitle: { fontSize: 15, fontFamily: fonts.regular, color: colors.muted, marginTop: 2, marginBottom: 2 },
}));
