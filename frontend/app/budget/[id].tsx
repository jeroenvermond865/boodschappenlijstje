import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import Modal from "@/src/components/Modal";
import { useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button, EmptyState, Field, Icon } from "@/src/components/ui";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { AISLE_ICONS, formatQty } from "@/src/constants";
import { goBack } from "@/src/nav";
import { useToast } from "@/src/toast";
import { fonts, makeStyles, useTheme } from "@/src/theme";

type Budget = {
  total_cost: number;
  budget_target: number;
  remaining: number;
  over_budget: boolean;
  pct_used: number;
  per_person_per_day: number;
  per_day: { index: number; cost: number; people: number; per_person: number }[];
  per_aisle: { aisle: string; cost: number }[];
  per_store: { store: string; cost: number }[];
  items: { name: string; unit: string; qty: number; cost: number; aisle: string; store: string }[];
  has_prices: boolean;
  multi_store: boolean;
};

const euro = (n: number) => `€ ${formatQty(n)}`;

export default function BudgetScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { has } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const canManage = has("manage_budget");

  const { data, isLoading } = useQuery({
    queryKey: ["budget", id],
    queryFn: () => api<Budget>(`/camps/${id}/budget`),
  });

  const [editing, setEditing] = useState(false);
  const [target, setTarget] = useState("");

  const saveTarget = useMutation({
    mutationFn: () => api(`/camps/${id}`, { method: "PUT", body: { budget_target: parseFloat(target.replace(",", ".")) || 0 } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["budget", id] });
      setEditing(false);
      toast.show("Budget ingesteld", "success");
    },
    onError: (e: any) => toast.show(e?.message ?? "Mislukt", "error"),
  });

  const openEdit = () => {
    setTarget(data?.budget_target ? String(data.budget_target) : "");
    setEditing(true);
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable testID="back-button" onPress={() => goBack("/")} hitSlop={10} style={styles.headerBtn}>
          <Icon name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Budget</Text>
        {canManage ? (
          <Pressable testID="budget-set-button" onPress={openEdit} hitSlop={10} style={styles.headerBtn}>
            <Icon name="wallet-outline" size={22} color={colors.brandPrimary} />
          </Pressable>
        ) : (
          <View style={styles.headerBtn} />
        )}
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.brandPrimary} />
        </View>
      ) : !data ? (
        <View style={styles.center}>
          <EmptyState icon="cash-remove" title="Nog geen budget" subtitle="Er is nog niets te berekenen." />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 16 }}>
          <View style={styles.totalCard}>
            <Text style={styles.totalLabel}>Geschatte kosten tot nu toe</Text>
            <Text style={styles.totalValue}>{euro(data.total_cost)}</Text>
            {data.budget_target > 0 ? (
              <>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { width: `${Math.min(data.pct_used, 100)}%`, backgroundColor: data.over_budget ? colors.error : "rgba(255,255,255,0.9)" }]} />
                </View>
                <Text style={styles.budgetLine}>
                  {data.over_budget
                    ? `€ ${formatQty(Math.abs(data.remaining))} over budget van ${euro(data.budget_target)}`
                    : `nog ${euro(data.remaining)} van ${euro(data.budget_target)} over`}
                </Text>
              </>
            ) : (
              <View style={styles.ppPill}>
                <Icon name="account-cash-outline" size={15} color={colors.onBrandPrimary} />
                <Text style={styles.ppText}>{euro(data.per_person_per_day)} per persoon / dag</Text>
              </View>
            )}
          </View>

          {!data.has_prices ? (
            <View style={styles.noteCard}>
              <Icon name="information-outline" size={18} color={colors.brandSecondary} />
              <Text style={styles.noteText}>Nog geen prijzen. Vul bij producten/gerechten prijzen in voor een compleet overzicht.</Text>
            </View>
          ) : null}

          {data.budget_target > 0 ? (
            <View style={styles.summaryRow}>
              <View style={styles.summaryBox}>
                <Text style={styles.summaryLabel}>Per persoon/dag</Text>
                <Text style={styles.summaryValue}>{euro(data.per_person_per_day)}</Text>
              </View>
              <View style={styles.summaryBox}>
                <Text style={styles.summaryLabel}>Nog te besteden</Text>
                <Text style={[styles.summaryValue, data.over_budget && { color: colors.error }]}>{euro(data.remaining)}</Text>
              </View>
            </View>
          ) : null}

          {data.multi_store ? (
            <View>
              <Text style={styles.sectionLabel}>Per winkel</Text>
              <View style={styles.card}>
                {data.per_store.map((s, idx) => (
                  <View key={s.store} style={[styles.row, idx < data.per_store.length - 1 && styles.rowBorder]}>
                    <View style={styles.rowLeft}>
                      <Icon name="storefront-outline" size={16} color={colors.brandSecondary} />
                      <Text style={styles.rowName}>{s.store}</Text>
                    </View>
                    <Text style={styles.rowCost}>{euro(s.cost)}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {data.has_prices ? (
          <>
          <View>
            <Text style={styles.sectionLabel}>Per dag</Text>
            <View style={styles.card}>
              {data.per_day.map((d, idx) => (
                <View key={d.index} style={[styles.row, idx < data.per_day.length - 1 && styles.rowBorder]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowName}>Dag {d.index + 1}</Text>
                    <Text style={styles.rowSub}>
                      {d.people} pers · {euro(d.per_person)} p.p.
                    </Text>
                  </View>
                  <Text style={styles.rowCost}>{euro(d.cost)}</Text>
                </View>
              ))}
            </View>
          </View>

          <View>
            <Text style={styles.sectionLabel}>Per categorie</Text>
            <View style={styles.card}>
              {data.per_aisle.map((a, idx) => (
                <View key={a.aisle} style={[styles.row, idx < data.per_aisle.length - 1 && styles.rowBorder]}>
                  <View style={styles.rowLeft}>
                    <Icon name={(AISLE_ICONS[a.aisle] ?? "cart-outline") as any} size={16} color={colors.brandSecondary} />
                    <Text style={styles.rowName}>{a.aisle}</Text>
                  </View>
                  <Text style={styles.rowCost}>{euro(a.cost)}</Text>
                </View>
              ))}
            </View>
          </View>

          </>
          ) : null}
        </ScrollView>
      )}

      <Modal visible={editing} transparent animationType="fade" onRequestClose={() => setEditing(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Budget instellen</Text>
              <Pressable testID="budget-modal-close" onPress={() => setEditing(false)} hitSlop={8}>
                <Icon name="close" size={22} color={colors.onSurface} />
              </Pressable>
            </View>
            <Field label="Totaal budget (€)" testID="budget-target-input" value={target} onChangeText={setTarget} keyboardType="decimal-pad" placeholder="Bijv. 250" />
            <Button label="Opslaan" onPress={() => saveTarget.mutate()} loading={saveTarget.isPending} testID="budget-target-save" />
          </View>
        </View>
      </Modal>
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
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  totalCard: { backgroundColor: colors.brandPrimary, borderRadius: 18, padding: 20, alignItems: "center" },
  totalLabel: { fontSize: 14, fontFamily: fonts.medium, color: colors.onBrandPrimary, opacity: 0.9 },
  totalValue: { fontSize: 36, fontFamily: fonts.bold, color: colors.onBrandPrimary, marginTop: 4 },
  ppPill: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,255,255,0.18)", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, marginTop: 10 },
  ppText: { fontSize: 13, fontFamily: fonts.semibold, color: colors.onBrandPrimary },
  barTrack: { height: 8, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.3)", marginTop: 12, overflow: "hidden", width: "100%" },
  barFill: { height: 8, borderRadius: 999 },
  budgetLine: { fontSize: 13, fontFamily: fonts.semibold, color: colors.onBrandPrimary, marginTop: 8 },
  noteCard: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surfaceTertiary, borderRadius: 12, padding: 12 },
  noteText: { flex: 1, fontSize: 13, fontFamily: fonts.regular, color: colors.onSurfaceSecondary },
  summaryRow: { flexDirection: "row", gap: 12 },
  summaryBox: { flex: 1, backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14 },
  summaryLabel: { fontSize: 12, fontFamily: fonts.medium, color: colors.muted },
  summaryValue: { fontSize: 18, fontFamily: fonts.bold, color: colors.onSurface, marginTop: 4 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center" },
  sheet: { backgroundColor: colors.surface, borderRadius: 20, width: "92%", maxWidth: 560, alignSelf: "center", marginVertical: "auto", maxHeight: "92%", padding: 16, gap: 12 },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sheetTitle: { fontSize: 18, fontFamily: fonts.bold, color: colors.onSurface },
  rowSub: { fontSize: 12, fontFamily: fonts.regular, color: colors.muted, marginTop: 1 },
  sectionLabel: { fontSize: 14, fontFamily: fonts.bold, color: colors.onSurface, marginBottom: 8 },
  card: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 13 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.divider },
  rowLeft: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
  rowName: { flex: 1, fontSize: 15, fontFamily: fonts.medium, color: colors.onSurface },
  rowCost: { fontSize: 15, fontFamily: fonts.bold, color: colors.brandPrimary, marginLeft: 10 },
}));
