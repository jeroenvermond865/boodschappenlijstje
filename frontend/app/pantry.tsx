import { useMemo, useState } from "react";
import { ActivityIndicator, Image, Pressable, RefreshControl, Switch, Text, View } from "react-native";
import Modal from "@/src/components/Modal";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button, EmptyState, Field, Icon, Select } from "@/src/components/ui";
import { api } from "@/src/api";
import { formatQty, UNITS } from "@/src/constants";
import { goBack } from "@/src/nav";
import { PremiumLock, usePremium } from "@/src/premium";
import { PantrySuggestions } from "@/src/PantrySuggestions";
import type { Product } from "@/src/ProductBrowser";
import { euro, fetchProducts, useDebounced } from "@/src/search";
import { useToast } from "@/src/toast";
import { fonts, makeStyles, useTheme } from "@/src/theme";

type PItem = {
  id: string;
  name: string;
  qty: number;
  unit: string;
  learned?: boolean;
  product_id?: string | null;
  product_name?: string | null;
  image?: string | null;
  weekly?: number | null; // eigen verbruik per week (in dezelfde eenheid)
  for_dishes?: boolean; // telt mee voor gerechten
  group?: string;
  restock?: number; // bijna op: zoveel voorstellen om te kopen
};

// Kort zeggen hoeveel er nog is en wat je per week gebruikt
function stockText(i: PItem) {
  const left = i.unit === "%" ? `${i.qty >= 80 ? "Vol" : i.qty >= 20 ? "Nog wat" : i.qty > 0 ? "Bijna op" : "Op"} (±${Math.round(i.qty)}%)` : `${formatQty(i.qty)} ${i.unit}`;
  const use = i.weekly ? ` · ${i.unit === "%" ? `${formatQty(i.weekly)}%` : `${formatQty(i.weekly)} ${i.unit}`} per week` : "";
  return left + use;
}

const USE_STEPS = [0, 5, 10, 15, 20, 25, 30, 40, 50];

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
  const [sugOpen, setSugOpen] = useState(false);
  // Zoeken naar een echt product; de naam blijft wat je typte ("Rijst"), zodat hij past bij je gerechten
  const [pick, setPick] = useState<Product | null>(null);
  const dq = useDebounced(name);
  const found = useQuery({
    queryKey: ["products", "search", "pantry", dq.trim()],
    queryFn: () => fetchProducts({ q: dq, limit: 8 }),
    enabled: premium && !pick && dq.trim().length > 1,
    placeholderData: (prev) => prev,
  });

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["pantry"],
    queryFn: () => api<{ items: PItem[]; weekly_use: number }>("/pantry"),
    enabled: premium,
  });
  const done = () => {
    qc.invalidateQueries({ queryKey: ["pantry"] });
    qc.invalidateQueries({ queryKey: ["shopping"] });
  };
  const fail = (e: any) => toast.show(e?.message ?? "Mislukt", "error");

  const add = useMutation({
    mutationFn: () =>
      api("/pantry", { method: "POST", body: { name: name.trim(), qty: parseFloat(qty.replace(",", ".")) || 0, unit, product_id: pick?.id ?? null } }),
    onSuccess: () => {
      setName("");
      setPick(null);
      setQty("1");
      done();
    },
    onError: fail,
  });
  const update = useMutation({
    mutationFn: (i: PItem) =>
      api(`/pantry/${i.id}`, {
        method: "PUT",
        body: { name: i.name, qty: i.qty, unit: i.unit, product_id: i.product_id ?? null, weekly: i.weekly ?? null, for_dishes: i.for_dishes !== false },
      }),
    onSuccess: done,
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/pantry/${id}`, { method: "DELETE" }),
    onSuccess: done,
    onError: fail,
  });
  const setUse = useMutation({
    mutationFn: (v: number) => api("/pantry/settings", { method: "PUT", body: { weekly_use: v } }),
    onSuccess: done,
    onError: fail,
  });
  const [edit, setEdit] = useState<PItem | null>(null);
  // Overzicht in groepen (kruiden, olie en sauzen, ...); wat bijna op is apart bovenaan
  const groups = useMemo(() => {
    const out: { group: string; items: PItem[] }[] = [];
    for (const it of data?.items ?? []) {
      const g = it.group || "Overig";
      (out.find((x) => x.group === g) ?? out[out.push({ group: g, items: [] }) - 1]).items.push(it);
    }
    return out.sort((a, b) => (a.group === "Overig" ? 1 : b.group === "Overig" ? -1 : a.group.localeCompare(b.group, "nl")));
  }, [data]);
  const low = (data?.items ?? []).filter((i) => (i.restock ?? 0) > 0);
  const step = (i: PItem, dir: 1 | -1) => {
    const by = i.unit === "%" ? 10 : i.unit === "gram" || i.unit === "ml" ? 100 : 1;
    const next = Math.min(i.unit === "%" ? 100 : Infinity, Math.max(0, Math.round((i.qty + dir * by) * 100) / 100));
    if (next === 0) remove.mutate(i.id);
    else update.mutate({ ...i, qty: next });
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable testID="back-button" onPress={() => goBack("/")} hitSlop={10} style={styles.headerBtn}>
          <Icon name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Voorraadkast</Text>
        <View style={styles.headerBtn} />
      </View>
      <KeyboardAwareScrollView refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} tintColor={colors.brandPrimary} />} bottomOffset={20} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: insets.bottom + 24 }} keyboardShouldPersistTaps="handled">
        {!premium ? (
          <PremiumLock title="De voorraadkast" text="Houd bij wat je al in huis hebt. Op je boodschappenlijst zie je dan meteen wat je niet hoeft te kopen." />
        ) : (
          <>
            <Text style={styles.intro}>
              Wat je al in huis hebt, hoef je voor je gerechten niet te kopen. Tik op een product om in te stellen hoeveel je er zelf per week van gebruikt.
              Is iets bijna op, dan stellen we voor het in je volgende boodschappenlijst te zetten.
            </Text>
            {low.length ? (
              <View style={[styles.addCard, { borderColor: colors.warning }]} testID="pantry-low">
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Icon name="cart-arrow-down" size={20} color={colors.warning} />
                  <Text style={[styles.rowName, { flex: 1 }]}>Bijna op: volgende keer kopen</Text>
                </View>
                {low.map((i) => (
                  <Pressable key={i.id} onPress={() => setEdit(i)} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    {i.image ? <Image source={{ uri: i.image }} style={styles.thumb} resizeMode="contain" /> : <View style={styles.thumb} />}
                    <Text style={[styles.rowQty, { flex: 1 }]} numberOfLines={1}>
                      <Text style={styles.rowName}>{i.name}</Text> · {stockText(i)}
                    </Text>
                  </Pressable>
                ))}
                <Text style={styles.rowQty}>Je ziet ze ook bovenaan je boodschappenlijst; daar zet je ze er met één tik bij.</Text>
              </View>
            ) : null}
            {isLoading ? (
              <ActivityIndicator color={colors.brandPrimary} />
            ) : (data?.items ?? []).length === 0 ? null : (
              groups.map((g) => (
                <View key={g.group} style={{ gap: 6 }}>
                  <Text style={styles.groupTitle}>
                    {g.group} <Text style={styles.rowQty}>({g.items.length})</Text>
                  </Text>
                  <View style={styles.list}>
                    {g.items.map((i, n, arr) => (
                      <Pressable key={i.id} onPress={() => setEdit(i)} style={[styles.row, n < arr.length - 1 && styles.rowBorder]} testID={`pantry-row-${i.id}`}>
                        {i.image ? <Image source={{ uri: i.image }} style={styles.thumb} resizeMode="contain" /> : <View style={styles.thumb}><Icon name="fridge-outline" size={18} color={colors.muted} /></View>}
                        <View style={{ flex: 1 }}>
                          <Text style={styles.rowName} numberOfLines={1}>{i.name}</Text>
                          <Text style={[styles.rowQty, (i.restock ?? 0) > 0 && { color: colors.warning }]} numberOfLines={1}>{stockText(i)}</Text>
                          {i.for_dishes === false ? <Text style={styles.rowQty}>Niet voor gerechten</Text> : null}
                        </View>
                        <Pressable onPress={() => step(i, -1)} hitSlop={6} style={styles.stepBtn} testID={`pantry-minus-${i.id}`}>
                          <Icon name="minus" size={18} color={colors.onSurface} />
                        </Pressable>
                        <Pressable onPress={() => step(i, 1)} hitSlop={6} style={styles.stepBtn} testID={`pantry-plus-${i.id}`}>
                          <Icon name="plus" size={18} color={colors.onSurface} />
                        </Pressable>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ))
            )}
            {(() => {
              // Lege voorraadkast: de voorstellen staan meteen open, zo is hij in één keer grotendeels gevuld
              const empty = !isLoading && (data?.items ?? []).length === 0;
              const show = sugOpen || empty;
              return (
                <View style={styles.addCard}>
                  <Pressable onPress={() => setSugOpen((v) => !v)} disabled={empty} style={{ flexDirection: "row", alignItems: "center", gap: 8 }} testID="pantry-sug-toggle">
                    <Icon name="lightbulb-on-outline" size={20} color={colors.brandPrimary} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowName}>Voorstellen: wat veel mensen al in huis hebben</Text>
                      <Text style={styles.rowQty}>Vink aan wat jij hebt en zet het in één keer in je voorraadkast.</Text>
                    </View>
                    {empty ? null : <Icon name={show ? "chevron-up" : "chevron-down"} size={20} color={colors.muted} />}
                  </Pressable>
                  {show ? <PantrySuggestions onDone={() => setSugOpen(false)} /> : null}
                </View>
              );
            })()}
            <View style={styles.addCard}>
              <Field
                label="Zoek een product"
                testID="pantry-name"
                placeholder="Bijv. rijst, olijfolie, koffie"
                value={name}
                onChangeText={(v) => {
                  setName(v);
                  setPick(null);
                }}
                maxLength={80}
              />
              {pick ? (
                <View style={styles.pickRow}>
                  {pick.image ? <Image source={{ uri: pick.image }} style={styles.pickImg} resizeMode="contain" /> : null}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowName} numberOfLines={2}>{pick.name}</Text>
                    <Text style={styles.rowQty}>{[pick.source, pick.unit, pick.price > 0 ? euro(pick.price) : ""].filter(Boolean).join(" · ")}</Text>
                  </View>
                  <Pressable onPress={() => setPick(null)} hitSlop={8} testID="pantry-pick-clear">
                    <Icon name="close-circle" size={20} color={colors.muted} />
                  </Pressable>
                </View>
              ) : name.trim().length > 1 ? (
                <View style={{ gap: 4 }}>
                  {found.isLoading ? <ActivityIndicator color={colors.brandPrimary} /> : null}
                  {(found.data?.products ?? []).map((p) => (
                    <Pressable
                      key={p.id}
                      onPress={() => {
                        setPick(p);
                        // Typte je "rijst", dan heet hij in je voorraadkast "Rijst" (zo vinden je gerechten hem)
                        const t = name.trim();
                        setName(t.charAt(0).toUpperCase() + t.slice(1));
                      }}
                      style={styles.pickRow}
                      testID={`pantry-found-${p.id}`}
                    >
                      {p.image ? <Image source={{ uri: p.image }} style={styles.pickImg} resizeMode="contain" /> : <View style={styles.pickImg} />}
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rowName} numberOfLines={1}>{p.name}</Text>
                        <Text style={styles.rowQty}>{[p.source, p.unit].filter(Boolean).join(" · ")}</Text>
                      </View>
                      <Text style={styles.rowName}>{p.price > 0 ? euro(p.price) : ""}</Text>
                    </Pressable>
                  ))}
                  {!found.isLoading && found.data && !found.data.products.length ? (
                    <Text style={styles.rowQty}>Geen product gevonden. Je kunt het ook gewoon met deze naam toevoegen.</Text>
                  ) : null}
                </View>
              ) : null}
              <View style={{ flexDirection: "row", gap: 10 }}>
                <Field label="Hoeveel" testID="pantry-qty" value={qty} onChangeText={setQty} keyboardType="decimal-pad" containerStyle={{ flex: 1 }} />
                <View style={{ flex: 1, gap: 6 }}>
                  <Text style={styles.label}>Eenheid</Text>
                  <Select value={unit} options={UNITS} onChange={setUnit} testID="pantry-unit" />
                </View>
              </View>
              <Button label="Toevoegen" onPress={() => add.mutate()} loading={add.isPending} disabled={!name.trim()} testID="pantry-add" />
            </View>
            <View style={styles.addCard}>
              <Text style={styles.label}>Standaard verbruik voor flessen en potten</Text>
              <Text style={styles.rowQty}>
                Voor producten zonder eigen verbruik (zoals olie of kruiden in %): zoveel gaat er elke week vanaf. Per product stel je het zelf in door erop te tikken.
              </Text>
              <Select
                testID="pantry-weekly"
                value={`${data?.weekly_use ?? 10}% per week`}
                options={USE_STEPS.map((v) => `${v}% per week`)}
                onChange={(v) => setUse.mutate(parseInt(v, 10) || 0)}
              />
            </View>
          </>
        )}
      </KeyboardAwareScrollView>
      <EditSheet
        item={edit}
        onClose={() => setEdit(null)}
        onSave={(i) => {
          update.mutate(i);
          setEdit(null);
        }}
        onDelete={(i) => {
          remove.mutate(i.id);
          setEdit(null);
        }}
      />
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
  headerTitle2: { fontSize: 18, fontFamily: fonts.bold, color: colors.onSurface },
  quick: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceTertiary },
  quickOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  quickText: { fontSize: 13, fontFamily: fonts.medium, color: colors.onSurfaceTertiary },
  quickTextOn: { color: colors.onBrandPrimary },
  thumb: { width: 38, height: 38, borderRadius: 8, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  groupTitle: { fontSize: 15, fontFamily: fonts.bold, color: colors.onSurface, marginTop: 4 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, gap: 14, maxHeight: "92%" },
  pickRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 8, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  pickImg: { width: 40, height: 40, borderRadius: 8, backgroundColor: "#fff" },
  stepBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
}));

// Eén product instellen: hoeveel je hebt, hoeveel je er zelf per week van gebruikt en of het meetelt voor gerechten
function EditSheet({ item, onClose, onSave, onDelete }: { item: PItem | null; onClose: () => void; onSave: (i: PItem) => void; onDelete: (i: PItem) => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("stuks");
  const [weekly, setWeekly] = useState("");
  const [forDishes, setForDishes] = useState(true);
  const [key, setKey] = useState<string | null>(null);
  if (item && key !== item.id) {
    // Nieuw product geopend: velden vullen
    setKey(item.id);
    setQty(formatQty(item.qty));
    setUnit(item.unit);
    setWeekly(item.weekly ? formatQty(item.weekly) : "");
    setForDishes(item.for_dishes !== false);
  }
  if (!item && key !== null) setKey(null);
  const num = (v: string) => parseFloat(v.replace(",", ".")) || 0;
  const unitText = unit === "%" ? "%" : unit;
  const w = num(weekly);
  return (
    <Modal visible={!!item} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]} onPress={() => {}}>
          {item ? (
            <>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                {item.image ? <Image source={{ uri: item.image }} style={styles.thumb} resizeMode="contain" /> : null}
                <View style={{ flex: 1 }}>
                  <Text style={styles.headerTitle2}>{item.name}</Text>
                  {item.product_name ? <Text style={styles.rowQty} numberOfLines={1}>{item.product_name}</Text> : null}
                </View>
                <Pressable onPress={onClose} hitSlop={10}>
                  <Icon name="close" size={24} color={colors.onSurface} />
                </Pressable>
              </View>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <Field label="Hoeveel heb je nu" value={qty} onChangeText={setQty} keyboardType="decimal-pad" containerStyle={{ flex: 1 }} testID="pantry-edit-qty" />
                <View style={{ flex: 1, gap: 6 }}>
                  <Text style={styles.label}>Eenheid</Text>
                  <Select value={unit} options={UNITS.includes("%") ? UNITS : [...UNITS, "%"]} onChange={setUnit} testID="pantry-edit-unit" />
                </View>
              </View>
              <View style={{ gap: 6 }}>
                <Field
                  label={`Zelf gebruikt per week (${unitText})`}
                  value={weekly}
                  onChangeText={setWeekly}
                  keyboardType="decimal-pad"
                  placeholder="Bijv. 8"
                  testID="pantry-edit-weekly"
                />
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                  <Pressable onPress={() => setWeekly("")} style={[styles.quick, !w && styles.quickOn]}>
                    <Text style={[styles.quickText, !w && styles.quickTextOn]}>Niet bijhouden</Text>
                  </Pressable>
                  <Pressable onPress={() => setWeekly(unit === "%" ? "100" : qty || "1")} style={styles.quick} testID="pantry-edit-allweek">
                    <Text style={styles.quickText}>Elke week helemaal op</Text>
                  </Pressable>
                </View>
                <Text style={styles.rowQty}>
                  {w
                    ? `Elke week gaat er ${formatQty(w)} ${unitText} af. Komt het onder één week verbruik, dan stellen we voor om het te kopen.`
                    : "Gebruik je dit ook buiten je gerechten (zoals eieren bij het ontbijt of een krop sla)? Vul dan in hoeveel per week."}
                </Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowName}>Telt mee voor gerechten</Text>
                  <Text style={styles.rowQty}>
                    {forDishes
                      ? w
                        ? `Wat je zelf per week gebruikt houden we apart. Gebruik je ${formatQty(w)} per week en heeft een gerecht er nog 6 nodig, dan zorgen we dat er genoeg is voor allebei.`
                        : "Wat je hebt, hoef je voor je gerechten niet te kopen."
                      : "Voor gerechten kopen we het gewoon, ook al heb je het in huis."}
                  </Text>
                </View>
                <Switch value={forDishes} onValueChange={setForDishes} testID="pantry-edit-dishes" />
              </View>
              <Button
                label="Opslaan"
                onPress={() => onSave({ ...item, qty: num(qty), unit, weekly: w > 0 ? w : null, for_dishes: forDishes })}
                testID="pantry-edit-save"
              />
              <Pressable onPress={() => onDelete(item)} style={{ alignSelf: "center", flexDirection: "row", gap: 6, alignItems: "center" }} testID="pantry-edit-delete">
                <Icon name="trash-can-outline" size={18} color={colors.error} />
                <Text style={[styles.rowName, { color: colors.error }]}>Uit je voorraadkast halen</Text>
              </Pressable>
            </>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
