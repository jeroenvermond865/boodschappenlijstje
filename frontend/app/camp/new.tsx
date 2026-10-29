import { useState } from "react";
import { Pressable, Switch, Text, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Button, Card, Field, Icon, Stepper } from "@/src/components/ui";
import { api } from "@/src/api";
import { DateField } from "@/src/DateField";
import { useTerms } from "@/src/settings";
import { MEAL_CATEGORIES } from "@/src/constants";
import { goBack } from "@/src/nav";
import { useToast } from "@/src/toast";
import { fonts, makeStyles, useTheme } from "@/src/theme";

export default function NewCampScreen() {
  const styles = useStyles();
  const T = useTerms();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();

  const [startDate, setStartDate] = useState("");
  const [name, setName] = useState("");
  const [days, setDays] = useState(3);
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [vegaA, setVegaA] = useState(0);
  const [vegaC, setVegaC] = useState(0);
  const [hasVega, setHasVega] = useState(false);

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
        body: { name: name.trim() || `${T.nieuw[0].toUpperCase()}${T.nieuw.slice(1)} ${T.one}`, days: dayArr, vega_adults: vegaA, vega_children: vegaC, start_date: startDate || null },
      });
    },
    onSuccess: (camp) => {
      qc.invalidateQueries({ queryKey: ["camps"] });
      toast.show(`${T.One} aangemaakt`, "success");
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
        <Text style={styles.headerTitle}>{`${T.nieuw[0].toUpperCase()}${T.nieuw.slice(1)} ${T.one}`}</Text>
        <View style={styles.headerBtn} />
      </View>

      <KeyboardAwareScrollView
        bottomOffset={20}
        contentContainerStyle={{ padding: 16, gap: 16 }}
        keyboardShouldPersistTaps="handled"
      >
        <Field
          label={`Naam van ${T.de} ${T.one}`}
          testID="camp-name"
          placeholder={`Bijv. Zomer${T.one} 2026`}
          value={name}
          onChangeText={setName}
        />

        <View style={{ gap: 6 }}>
          <Text style={styles.sectionLabel}>Eerste dag</Text>
          <DateField value={startDate} onChange={setStartDate} testID="camp-start-date" />
          <Text style={styles.rowSub}>Op de startpagina zie je dan waar het eerstvolgende lijstje het goedkoopst is.</Text>
        </View>

        <Card style={styles.rowCard}>
          <View style={styles.rowLabel}>
            <View style={styles.rowIcon}>
              <Icon name="calendar-range" size={20} color={colors.brandPrimary} />
            </View>
            <View>
              <Text style={styles.rowTitle}>Aantal dagen</Text>
              <Text style={styles.rowSub}>{`Hoeveel dagen duurt ${T.de} ${T.one}?`}</Text>
            </View>
          </View>
          <Stepper value={days} onChange={setDays} min={1} max={60} testID="days-stepper" />
        </Card>

        <Card style={{ gap: 14 }}>
          <View>
            <Text style={styles.rowTitle}>Wie eten er mee?</Text>
            <Text style={styles.rowSub}>Per dag. Je kunt dit later per dag nog aanpassen.</Text>
          </View>
          <View style={styles.cols}>
            <View style={styles.col}>
              <View style={styles.colHead}>
                <Icon name="account" size={18} color={colors.brandPrimary} />
                <Text style={styles.colTitle}>Volwassenen</Text>
              </View>
              <Stepper
                value={adults}
                onChange={(v) => {
                  setAdults(v);
                  setVegaA((x) => Math.min(x, v));
                }}
                min={0}
                max={500}
                testID="adults-stepper"
              />
            </View>
            <View style={styles.col}>
              <View style={styles.colHead}>
                <Icon name="account-child" size={18} color={colors.brandPrimary} />
                <Text style={styles.colTitle}>Kinderen</Text>
              </View>
              <Stepper
                value={children}
                onChange={(v) => {
                  setChildren(v);
                  setVegaC((x) => Math.min(x, v));
                }}
                min={0}
                max={500}
                testID="children-stepper"
              />
            </View>
          </View>

          <Pressable
            testID="vega-toggle"
            onPress={() => {
              if (hasVega) {
                setVegaA(0);
                setVegaC(0);
              }
              setHasVega(!hasVega);
            }}
            style={styles.vegaToggle}
          >
            <Icon name="leaf" size={20} color={colors.brandPrimary} />
            <Text style={[styles.colTitle, { flex: 1 }]}>Eet er iemand vegetarisch?</Text>
            <Switch
              value={hasVega}
              onValueChange={(v) => {
                if (!v) {
                  setVegaA(0);
                  setVegaC(0);
                }
                setHasVega(v);
              }}
            />
          </Pressable>
          {hasVega ? (
            <>
              <Text style={styles.rowSub}>Hoeveel daarvan eten vegetarisch? Zij krijgen de vegetarische optie van een gerecht.</Text>
              <View style={styles.cols}>
                <View style={styles.col}>
                  <Text style={styles.colSub}>van de {adults} volwassenen</Text>
                  <Stepper value={vegaA} onChange={setVegaA} min={0} max={adults} testID="vega-adults-stepper" />
                </View>
                <View style={styles.col}>
                  <Text style={styles.colSub}>van de {children} kinderen</Text>
                  <Stepper value={vegaC} onChange={setVegaC} min={0} max={children} testID="vega-children-stepper" />
                </View>
              </View>
            </>
          ) : null}

          <View style={styles.summary}>
            <Text style={styles.summaryText}>
              Totaal {adults + children} {adults + children === 1 ? "persoon" : "personen"}
              {vegaA + vegaC ? `, waarvan ${vegaA + vegaC} vegetarisch` : ""}.
            </Text>
          </View>
        </Card>
      </KeyboardAwareScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <Button
          label={`${T.One} aanmaken`}
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
  cols: { flexDirection: "row", gap: 12 },
  col: { flex: 1, alignItems: "center", gap: 8, paddingVertical: 10, borderRadius: 14, backgroundColor: colors.surfaceTertiary },
  colHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  colTitle: { fontSize: 15, fontFamily: fonts.semibold, color: colors.onSurface },
  colSub: { fontSize: 12, fontFamily: fonts.medium, color: colors.muted },
  vegaToggle: { flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.divider },
  summary: { borderRadius: 10, backgroundColor: colors.brandTertiary, paddingHorizontal: 12, paddingVertical: 8 },
  summaryText: { fontSize: 13, fontFamily: fonts.medium, color: colors.onBrandTertiary },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    backgroundColor: colors.surface,
  },
}));
