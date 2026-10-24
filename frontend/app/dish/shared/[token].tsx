import { ActivityIndicator, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button, Icon } from "@/src/components/ui";
import { api } from "@/src/api";
import { CATEGORY_LABELS, formatQty } from "@/src/constants";
import { goBack } from "@/src/nav";
import { useToast } from "@/src/toast";
import { fonts, makeStyles, useTheme } from "@/src/theme";

type Shared = {
  name: string;
  category: string;
  ingredients: { name: string; unit: string; qty_adult: number; qty_child: number; aisle: string }[];
};

export default function SharedDishScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const { token } = useLocalSearchParams<{ token: string }>();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["shared-dish", token],
    queryFn: () => api<Shared>(`/shared/dish/${token}`),
    enabled: !!token,
  });

  const importDish = useMutation({
    mutationFn: () => api(`/shared/dish/${token}/import`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dishes"] });
      toast.show("Gerecht toegevoegd aan jouw gerechten", "success");
      router.replace("/(tabs)/dishes");
    },
    onError: (e: any) => toast.show(e?.message ?? "Toevoegen mislukt", "error"),
  });

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <View style={styles.headerBtn} />
        <Text style={styles.headerTitle}>Gedeeld gerecht</Text>
        <View style={styles.headerBtn} />
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.brandPrimary} />
        </View>
      ) : isError || !data ? (
        <View style={styles.center}>
          <Icon name="link-off" size={48} color={colors.muted} />
          <Text style={styles.msg}>Dit gedeelde gerecht bestaat niet meer.</Text>
          <Button label="Naar gerechten" onPress={() => router.replace("/(tabs)/dishes")} testID="to-dishes" />
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <View style={styles.hero}>
            <View style={styles.heroIcon}>
              <Icon name="silverware-fork-knife" size={28} color={colors.onBrandPrimary} />
            </View>
            <Text style={styles.name}>{data.name}</Text>
            <Text style={styles.cat}>{CATEGORY_LABELS[data.category] ?? data.category}</Text>
          </View>
          <View style={styles.list}>
            <Text style={styles.listTitle}>Ingrediënten (per persoon)</Text>
            {data.ingredients.map((i, idx) => (
              <View key={idx} style={styles.ingRow}>
                <Text style={styles.ingName}>{i.name}</Text>
                <Text style={styles.ingQty}>
                  🧑 {formatQty(i.qty_adult)} {i.unit} · 🧒 {formatQty(i.qty_child)} {i.unit}
                </Text>
              </View>
            ))}
          </View>
          <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
            <Button
              label="Toevoegen aan mijn gerechten"
              icon="plus"
              onPress={() => importDish.mutate()}
              loading={importDish.isPending}
              testID="import-dish-button"
            />
          </View>
        </View>
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  headerBtn: { width: 40, height: 40 },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 17, fontFamily: fonts.semibold, color: colors.onSurface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 24 },
  msg: { fontSize: 15, fontFamily: fonts.regular, color: colors.onSurfaceSecondary, textAlign: "center" },
  hero: { alignItems: "center", gap: 8, padding: 24 },
  heroIcon: { width: 64, height: 64, borderRadius: 20, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  name: { fontSize: 24, fontFamily: fonts.bold, color: colors.onSurface, textAlign: "center" },
  cat: { fontSize: 14, fontFamily: fonts.medium, color: colors.brandPrimary },
  list: { flex: 1, paddingHorizontal: 16, gap: 10 },
  listTitle: { fontSize: 14, fontFamily: fonts.semibold, color: colors.onSurfaceSecondary, marginBottom: 2 },
  ingRow: { backgroundColor: colors.surfaceSecondary, borderRadius: 12, padding: 14, gap: 4 },
  ingName: { fontSize: 16, fontFamily: fonts.semibold, color: colors.onSurface },
  ingQty: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted },
  footer: { paddingHorizontal: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.divider },
}));
