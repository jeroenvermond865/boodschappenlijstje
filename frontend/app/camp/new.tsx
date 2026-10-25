import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Button, Card, Field, Icon, Stepper } from "@/src/components/ui";
import { api } from "@/src/api";
import { MEAL_CATEGORIES } from "@/src/constants";
import { goBack } from "@/src/nav";
import { useToast } from "@/src/toast";
import { fonts, makeStyles, useTheme } from "@/src/theme";

export default function NewCampScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();

  const [name, setName] = useState("");
  const [days, setDays] = useState(3);
  const [adults, setAdults] = useState(4);
  const [children, setChildren] = useState(12);
  const [vegaA, setVegaA] = useState(0);
  const [vegaC, setVegaC] = useState(0);

  const create = useMutation({
    mutationFn: () => {
      const emptyMeals = Object.fromEntries(MEAL_CATEGORIES.map((c) => [c, []]));
      const dayArr = Array.from({ length: days }, () => ({
        adults,
        children,
        is_shopping_day: true,
        meals: emptyMeals,
      }));
      return api<{ id: string }>("/camps", {
        method: "POST",
        body: { name: name.trim() || "Nieuw kamp", days: dayArr, vega_adults: vegaA, vega_children: vegaC },
      });
    },
    onSuccess: (camp) => {
      qc.invalidateQueries({ queryKey: ["camps"] });
      toast.show("Kamp aangemaakt", "success");
      router.replace(`/camp/${camp.id}`);
    },
    onError: (e: any) => toast.show(e?.message ?? "Aanmaken mislukt", "error"),
  });

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable testID="close-button" onPress={() => goBack("/camps")} hitSlop={10} style={styles.headerBtn}>
          <Icon name="close" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Nieuw kamp</Text>
        <View style={styles.headerBtn} />
      </View>

      <KeyboardAwareScrollView
        bottomOffset={20}
        contentContainerStyle={{ padding: 16, gap: 16 }}
        keyboardShouldPersistTaps="handled"
      >
        <Field
          label="Naam van het kamp"
          testID="camp-name"
          placeholder="Bijv. Zomerkamp 2026"
          value={name}
          onChangeText={setName}
        />

        <Card style={styles.rowCard}>
          <View style={styles.rowLabel}>
            <View style={styles.rowIcon}>
              <Icon name="calendar-range" size={20} color={colors.brandPrimary} />
            </View>
            <View>
              <Text style={styles.rowTitle}>Aantal dagen</Text>
              <Text style={styles.rowSub}>Hoeveel dagen duurt het kamp?</Text>
            </View>
          </View>
          <Stepper value={days} onChange={setDays} min={1} max={60} testID="days-stepper" />
        </Card>

        <Text style={styles.sectionLabel}>Standaard per dag</Text>
        <Text style={styles.hint}>Je kunt dit per dag later nog aanpassen.</Text>

        <Card style={styles.rowCard}>
          <View style={styles.rowLabel}>
            <View style={styles.rowIcon}>
              <Icon name="account-group" size={20} color={colors.brandPrimary} />
            </View>
            <Text style={styles.rowTitle}>Volwassenen</Text>
          </View>
          <Stepper value={adults} onChange={setAdults} min={0} max={500} testID="adults-stepper" />
        </Card>

        <Card style={styles.rowCard}>
          <View style={styles.rowLabel}>
            <View style={styles.rowIcon}>
              <Icon name="account-child" size={20} color={colors.brandPrimary} />
            </View>
            <Text style={styles.rowTitle}>Kinderen</Text>
          </View>
          <Stepper value={children} onChange={setChildren} min={0} max={500} testID="children-stepper" />
        </Card>

        <Card style={styles.rowCard}>
          <View style={styles.rowLabel}>
            <View style={styles.rowIcon}>
              <Icon name="leaf" size={20} color={colors.brandPrimary} />
            </View>
            <View>
              <Text style={styles.rowTitle}>Vega-eters (volw.)</Text>
              <Text style={styles.rowSub}>Krijgen de vega-optie</Text>
            </View>
          </View>
          <Stepper value={vegaA} onChange={setVegaA} min={0} max={500} testID="vega-adults-stepper" />
        </Card>

        <Card style={styles.rowCard}>
          <View style={styles.rowLabel}>
            <View style={styles.rowIcon}>
              <Icon name="leaf" size={20} color={colors.brandPrimary} />
            </View>
            <Text style={styles.rowTitle}>Vega-eters (kind.)</Text>
          </View>
          <Stepper value={vegaC} onChange={setVegaC} min={0} max={500} testID="vega-children-stepper" />
        </Card>
      </KeyboardAwareScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <Button
          label="Kamp aanmaken"
          onPress={() => create.mutate()}
          loading={create.isPending}
          testID="create-camp-button"
        />
      </View>
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
  headerBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 17, fontFamily: fonts.semibold, color: colors.onSurface },
  rowCard: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  rowLabel: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  rowTitle: { fontSize: 16, fontFamily: fonts.semibold, color: colors.onSurface },
  rowSub: { fontSize: 12, fontFamily: fonts.regular, color: colors.muted, marginTop: 1 },
  sectionLabel: { fontSize: 14, fontFamily: fonts.bold, color: colors.onSurface, marginTop: 4 },
  hint: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted, marginTop: -8 },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    backgroundColor: colors.surface,
  },
}));
