import { FlatList, Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import type { ReactElement } from "react";
import Image from "@/src/components/SafeImage";

import { PressScale } from "@/src/components/motion";
import { Icon } from "@/src/components/ui";
import { useGrid } from "@/src/layout";
import { fonts, makeStyles, softShadow, useTheme } from "@/src/theme";

export type GroupTile = { key: string; label: string; icon: string; sub?: string; image?: string | null };

// Hoofdcategorieën als blokken, net als de afdelingen bij Producten
export function GroupTiles({
  tiles,
  onPress,
  padTop = 0,
  bottomPadding,
  header,
  listProps,
  testPrefix = "group",
}: {
  tiles: GroupTile[];
  onPress: (key: string) => void;
  padTop?: number;
  bottomPadding: number;
  header?: ReactElement | null;
  listProps?: object;
  testPrefix?: string;
}) {
  const styles = useStyles();
  const grid = useGrid(150);
  const { colors } = useTheme();
  return (
    <FlatList
      {...listProps}
      key={`${testPrefix}-${grid.cols}`}
      data={tiles}
      keyExtractor={(t) => t.key}
      numColumns={grid.cols}
      columnWrapperStyle={{ gap: 10 }}
      ListHeaderComponent={header}
      contentContainerStyle={{ padding: 16, paddingTop: 8 + padTop, paddingBottom: bottomPadding, gap: 10 }}
      renderItem={({ item: t, index }) => (
        <Animated.View entering={index < 12 ? FadeIn.delay(index * 30).duration(220) : undefined} style={{ flex: 1, maxWidth: grid.tile }}>
        <PressScale
          testID={`${testPrefix}-${t.key}`}
          onPress={() => onPress(t.key)}
          style={styles.tile}
        >
          {t.image ? (
            <Image source={{ uri: t.image }} style={styles.tileImage} resizeMode="cover" />
          ) : (
            <View style={styles.tileIcon}>
              <Icon name={t.icon as any} size={26} color={colors.brandPrimary} />
            </View>
          )}
          <Text style={styles.tileTitle} numberOfLines={2}>{t.label}</Text>
          {t.sub ? <Text style={styles.tileCount} numberOfLines={1}>{t.sub}</Text> : null}
        </PressScale>
        </Animated.View>
      )}
    />
  );
}

const useStyles = makeStyles((colors) => ({
  tile: { flex: 1, borderRadius: 18, borderWidth: 1, borderColor: colors.border, padding: 12, gap: 6, backgroundColor: colors.surface, ...softShadow(colors, 1) },
  tileIcon: { width: 52, height: 52, borderRadius: 14, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  tileImage: { width: 52, height: 52, borderRadius: 10, backgroundColor: "#fff" },
  tileTitle: { fontSize: 15, fontFamily: fonts.semibold, color: colors.onSurface },
  tileCount: { fontSize: 12, fontFamily: fonts.regular, color: colors.muted },
}));
