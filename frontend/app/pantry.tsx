import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button, EmptyState, Field, Icon, Select } from "@/src/components/ui";
import { api } from "@/src/api";
import { formatQty, UNITS } from "@/src/constants";
import { goBack } from "@/src/nav";
import { PremiumLock, usePremium } from "@/src/premium";
import { useToast } from "@/src/toast";
import { fonts, makeStyles, useTheme } from "@/src/theme";

type PItem = { id: string; name: string; qty: number; unit: string };

export default function PantryScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const qc = useQueryClient();
  const premium = usePremium();
  const [name, setName] = useState("");
  const [qty, setQty] = useState("1");
  const [unit, setUnit] = useState("stuks");

  const { data, isLoading } = useQuery({
    queryKey: ["pantry"],
    queryFn: () => api<{ items: PItem[] }>("/pantry"),
    enabled: premium,
  });
  const done = () => {
    qc.invalidateQueries({ queryKey: ["pantry"] });
    qc.invalidateQueries({ queryKey: ["shopping"] });
  };
  const fail = (e: any) => toast.show(e?.message ?? "Mislukt", "error");

  const add = useMutation({
    mutationFn: () => api("/pantry", { method: "POST", body: { name, qty: parseFloat(qty.replace(",", ".")) || 0, unit } }),
    onSuccess: () => {
      setName("");
      setQty("1");
      done();
    },
    onError: fail,
  });
  const update = useMutation({
    mutationFn: (i: PItem) => api(`/pantry/${i.id}`, { method: "PUT", body: { name: i.name, qty: i.qty, unit: i.unit } }),
    onSuccess: done,
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/pantry/${id}`, { method: "DELETE" }),
    onSuccess: done,
    onError: fail,
  });
  const step = (i: PItem, dir: 1 | -1) => {
    const by = i.unit === "gram" || i.unit === "ml" ? 100 : 1;
    const next = Math.max(0, i.qty + dir * by);
    if (next === 0) remove.mutate(i.id);
    else update.mutate({ ...i, qty: next });
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable testID="back-button" onPress={() => goBack("/account")} hitSlop={10} style={styles.headerBtn}>
          <Icon name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Voorraadkast</Text>
        <View style={styles.headerBtn} />
      </View>
      <KeyboardAwareScrollView bottomOffset={20} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: insets.bottom + 24 }} keyboardShouldPersistTaps="handled">
        {!premium ? (
          <PremiumLock title="De voorraadkast" text="Houd bij wat je al in huis hebt. Op je boodschappenlijst zie je dan meteen wat je niet hoeft te kopen." />
        ) : (
          <>
            <Text style={styles.intro}>
              Zet hier wat je al in huis hebt. Op je boodschappenlijst zie je dan bij elk product hoeveel je nog hebt, en vink je in één keer af wat je niet
              hoeft te kopen. Gebruik dezelfde naam als in je gerechten, bijvoorbeeld "Rijst" of "Melk".
            </Text>
            <View style={styles.addCard}>
              <Field label="Product" testID="pantry-name" placeholder="Bijv. Rijst" value={name} onChangeText={setName} maxLength={80} />
              <View style={{ flexDirection: "row", gap: 10 }}>
                <Field label="Hoeveel" testID="pantry-qty" value={qty} onChangeText={setQty} keyboardType="decimal-pad" containerStyle={{ flex: 1 }} />
                <View style={{ flex: 1, gap: 6 }}>
                  <Text style={styles.label}>Eenheid</Text>
                  <Select value={unit} options={UNITS} onChange={setUnit} testID="pantry-unit" />
                </View>
              </View>
              <Button label="Toevoegen" onPress={() => add.mutate()} loading={add.isPending} disabled={!name.trim()} testID="pantry-add" />
            </View>
            {isLoading ? (
              <ActivityIndicator color={colors.brandPrimary} />
            ) : (data?.items ?? []).length === 0 ? (
              <EmptyState icon="fridge-outline" title="Je voorraadkast is leeg" subtitle="Voeg hierboven toe wat je al in huis hebt." />
            ) : (
              <View style={styles.list}>
                {(data?.items ?? []).map((i, n, arr) => (
                  <View key={i.id} style={[styles.row, n < arr.length - 1 && styles.rowBorder]} testID={`pantry-row-${i.id}`}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowName}>{i.name}</Text>
                      <Text style={styles.rowQty}>
                        {formatQty(i.qty)} {i.unit}
                      </Text>
                    </View>
                    <Pressable onPress={() => step(i, -1)} hitSlop={6} style={styles.stepBtn} testID={`pantry-minus-${i.id}`}>
                      <Icon name="minus" size={18} color={colors.onSurface} />
                    </Pressable>
                    <Pressable onPress={() => step(i, 1)} hitSlop={6} style={styles.stepBtn} testID={`pantry-plus-${i.id}`}>
                      <Icon name="plus" size={18} color={colors.onSurface} />
                    </Pressable>
                    <Pressable onPress={() => remove.mutate(i.id)} hitSlop={6} style={styles.stepBtn} testID={`pantry-del-${i.id}`}>
                      <Icon name="trash-can-outline" size={18} color={colors.error} />
                    </Pressable>
                  </View>
                ))}
              </View>
            )}
          </>
        )}
      </KeyboardAwareScrollView>
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
  label: { fontSize: 13, fontFamily: fonts.semibold, color: colors.onSurfaceSecondary },
  addCard: { gap: 12, backgroundColor: colors.surfaceSecondary, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 14 },
  list: { borderRadius: 16, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 12 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.divider },
  rowName: { fontSize: 15, fontFamily: fonts.semibold, color: colors.onSurface },
  rowQty: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted, marginTop: 1 },
  stepBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
}));
