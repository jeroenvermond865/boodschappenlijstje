import { useState } from "react";
import { ActivityIndicator, Image, Pressable, RefreshControl, Text, View } from "react-native";
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

type PItem = { id: string; name: string; qty: number; unit: string; learned?: boolean; product_name?: string | null; image?: string | null };

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
    mutationFn: (i: PItem) => api(`/pantry/${i.id}`, { method: "PUT", body: { name: i.name, qty: i.qty, unit: i.unit } }),
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
              Zet hier wat je al in huis hebt. Op je boodschappenlijst zie je dan bij elk product hoeveel je nog hebt, en vink je in één keer af wat je niet
              hoeft te kopen. Gebruik dezelfde naam als in je gerechten, bijvoorbeeld "Rijst" of "Melk". Neem je bij een recept iets niet mee omdat je het al
              in huis hebt, dan zet de app het hier vanzelf bij.
            </Text>
            {(() => {
              // Lege voorraadkast: de voorstellen staan meteen open, zo is hij in één keer grotendeels gevuld
              const empty = !isLoading && (data?.items ?? []).length === 0;
              const show = sugOpen || empty;
              return (
                <View style={styles.addCard}>
                  <Pressable onPress={() => setSugOpen((v) => !v)} disabled={empty} style={{ flexDirection: "row", alignItems: "center", gap: 8 }} testID="pantry-sug-toggle">
                    <Icon name="lightbulb-on-outline" size={20} color={colors.brandPrimary} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowName}>Wat veel mensen al in huis hebben</Text>
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
              <Text style={styles.label}>Verbruik per week</Text>
              <Text style={styles.rowQty}>
                Sommige dingen gebruik je ook als ze niet in je gerechten staan, zoals olie of kruiden. Zoveel gaat er elke week van je voorraad af.
              </Text>
              <Select
                testID="pantry-weekly"
                value={`${data?.weekly_use ?? 10}% per week`}
                options={USE_STEPS.map((v) => `${v}% per week`)}
                onChange={(v) => setUse.mutate(parseInt(v, 10) || 0)}
              />
            </View>
            {isLoading ? (
              <ActivityIndicator color={colors.brandPrimary} />
            ) : (data?.items ?? []).length === 0 ? (
              <EmptyState icon="fridge-outline" title="Je voorraadkast is leeg" subtitle="Vink hierboven aan wat je al in huis hebt, of voeg zelf iets toe." />
            ) : (
              <View style={styles.list}>
                {(data?.items ?? []).map((i, n, arr) => (
                  <View key={i.id} style={[styles.row, n < arr.length - 1 && styles.rowBorder]} testID={`pantry-row-${i.id}`}>
                    {i.image ? <Image source={{ uri: i.image }} style={{ width: 36, height: 36, borderRadius: 8, backgroundColor: "#fff" }} resizeMode="contain" /> : null}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowName}>{i.name}</Text>
                      {i.product_name ? <Text style={styles.rowQty} numberOfLines={1}>{i.product_name}</Text> : null}
                      <Text style={styles.rowQty}>
                        {i.unit === "%"
                          ? `${i.qty >= 80 ? "Vol" : i.qty >= 20 ? "Nog wat" : "Bijna op"} · ±${Math.round(i.qty)}%${i.learned ? " · geleerd uit je recepten" : ""}`
                          : `${formatQty(i.qty)} ${i.unit}`}
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
  pickRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 8, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  pickImg: { width: 40, height: 40, borderRadius: 8, backgroundColor: "#fff" },
  stepBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
}));
