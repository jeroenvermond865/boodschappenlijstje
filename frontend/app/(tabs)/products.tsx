import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ProductBrowser } from "@/src/ProductBrowser";
import { usesNativeTabs } from "@/src/navigation";
import { useAppSettings } from "@/src/settings";
import { fonts, makeStyles } from "@/src/theme";

export type { Product, Promo } from "@/src/ProductBrowser";

export default function ProductsScreen() {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const s = useAppSettings();
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;
  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ProductBrowser
        bottomPadding={bottomChrome + 96}
        header={
          <View>
            <Text style={styles.title}>{s.tab_products}</Text>
            <Text style={styles.subtitle}>{s.sub_products}</Text>
          </View>
        }
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  title: { fontSize: 32, fontFamily: fonts.bold, color: colors.onSurface },
  subtitle: { fontSize: 15, fontFamily: fonts.regular, color: colors.muted, marginTop: 2, marginBottom: 2 },
}));
