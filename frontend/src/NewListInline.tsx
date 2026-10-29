// Snel een nieuw lijstje maken zonder het keuzescherm te verlaten (bij "Toevoegen aan lijstje").
// Na het maken is het nieuwe lijstje meteen gekozen, zodat je gewoon verder kunt met toevoegen.
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Button, Field, Icon, Stepper } from "@/src/components/ui";
import { api } from "@/src/api";
import { MEAL_CATEGORIES } from "@/src/constants";
import { useTerms } from "@/src/settings";
import { useToast } from "@/src/toast";
import { fonts, makeStyles, useTheme } from "@/src/theme";

export function NewListInline({ onCreated }: { onCreated: (id: string) => void }) {
  const styles = useStyles();
  const T = useTerms();
  const { colors } = useTheme();
  const toast = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [days, setDays] = useState(3);
  const [people, setPeople] = useState(2);
  const title = `${T.nieuw[0].toUpperCase()}${T.nieuw.slice(1)} ${T.one}`;

  const create = useMutation({
    mutationFn: () => {
      const emptyMeals = Object.fromEntries(MEAL_CATEGORIES.map((c) => [c, []]));
      const dayArr = Array.from({ length: days }, () => ({ adults: people, children: 0, is_shopping_day: true, meals: emptyMeals }));
      return api<{ id: string }>("/camps", { method: "POST", body: { name: name.trim() || title, days: dayArr } });
    },
    onSuccess: async (camp) => {
      await qc.invalidateQueries({ queryKey: ["camps"] });
      qc.invalidateQueries({ queryKey: ["home"] });
      setOpen(false);
      setName("");
      toast.show(`${T.One} aangemaakt`, "success");
      onCreated(camp.id);
    },
    onError: (e: any) => toast.show(e?.message ?? "Aanmaken mislukt", "error"),
  });

  if (!open) {
    return (
      <Pressable testID="new-list-inline" onPress={() => setOpen(true)} style={styles.row}>
        <Icon name="plus" size={20} color={colors.brandPrimary} />
        <Text style={styles.rowText}>{title}</Text>
      </Pressable>
    );
  }
  return (
    <View style={styles.box}>
      <Text style={styles.boxTitle}>{title}</Text>
      <Field placeholder={`Naam, bijv. Boodschappen deze week`} value={name} onChangeText={setName} autoFocus />
      <View style={styles.stepRow}>
        <Text style={styles.stepLabel}>Dagen</Text>
        <Stepper value={days} onChange={setDays} min={1} max={60} />
      </View>
      <View style={styles.stepRow}>
        <Text style={styles.stepLabel}>Personen</Text>
        <Stepper value={people} onChange={setPeople} min={1} max={500} />
      </View>
      <Text style={styles.hint}>Datum, kinderen en vegetariërs kun je later in {T.de} {T.one} aanpassen.</Text>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Button label="Annuleren" variant="secondary" onPress={() => setOpen(false)} style={{ flex: 1 }} />
        <Button label="Maken" icon="check" loading={create.isPending} onPress={() => create.mutate()} style={{ flex: 1 }} testID="new-list-inline-save" />
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.brandPrimary,
  },
  rowText: { flex: 1, fontSize: 15, fontFamily: fonts.semibold, color: colors.brandPrimary },
  box: { gap: 10, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  boxTitle: { fontSize: 16, fontFamily: fonts.semibold, color: colors.onSurface },
  stepRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  stepLabel: { fontSize: 15, fontFamily: fonts.regular, color: colors.onSurface },
  hint: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted },
}));
