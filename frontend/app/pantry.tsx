import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Switch, Text, View } from "react-native";
import Image from "@/src/components/SafeImage";
import Modal from "@/src/components/Modal";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button, EmptyState, Field, Icon, Select } from "@/src/components/ui";
import { api } from "@/src/api";
import { AISLES, AISLE_ICONS, formatQty, UNITS } from "@/src/constants";
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
  use_amount?: number | null; // eigen verbruik: zoveel ...
  use_days?: number | null; // ... per zoveel dagen
  for_dishes?: boolean; // telt mee voor gerechten
  group?: string;
  aisle?: string; // afdeling zoals bij Alle producten
  sub?: string; // soort binnen de afdeling
  restock?: number; // bijna op: zoveel voorstellen om te kopen
};

// Verbruik per periode: per dag, per week, per 2 weken, per maand, of zelf een aantal dagen
const PERIODS: { days: number; label: string }[] = [
  { days: 1, label: "per dag" },
  { days: 7, label: "per week" },
  { days: 14, label: "per 2 weken" },
  { days: 30, label: "per maand" },
];
function periodText(days: number) {
  return PERIODS.find((p) => p.days === days)?.label ?? `per ${formatQty(days)} dagen`;
}

// Kort zeggen hoeveel er nog is en wat je zelf gebruikt
function stockText(i: PItem) {
  const left = i.unit === "%" ? `${i.qty >= 80 ? "Vol" : i.qty >= 20 ? "Nog wat" : i.qty > 0 ? "Bijna op" : "Op"} (±${Math.round(i.qty)}%)` : `${formatQty(i.qty)} ${i.unit}`;
  const amount = i.use_amount ?? i.weekly;
  const days = i.use_days ?? 7;
  const use = amount ? ` · ${i.unit === "%" ? `${formatQty(amount)}%` : `${formatQty(amount)} ${i.unit}`} ${periodText(days)}` : "";
  return left + use;
}

type Filter = "all" | "low" | "dishes" | "nodishes" | "use";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "Alles" },
  { key: "low", label: "Bijna op" },
  { key: "dishes", label: "Telt mee bij gerechten" },
  { key: "nodishes", label: "Niet bij gerechten" },
  { key: "use", label: "Met eigen verbruik" },
];

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
    queryFn: () => api<{ items: PItem[] }>("/pantry"),
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
        body: {
          name: i.name,
          qty: i.qty,
          unit: i.unit,
          product_id: i.product_id ?? null,
          weekly: i.use_amount && i.use_days ? null : i.weekly ?? null,
          use_amount: i.use_amount ?? null,
          use_days: i.use_days ?? null,
          for_dishes: i.for_dishes !== false,
        },
      }),
    onSuccess: done,
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/pantry/${id}`, { method: "DELETE" }),
    onSuccess: done,
    onError: fail,
  });
  const [edit, setEdit] = useState<PItem | null>(null);
  const [aisle, setAisle] = useState("all");
  // Bladeren zoals bij Alle producten: eerst de afdeling, dan de soort, dan de producten. Zoeken of filteren toont meteen de lijst.
  const [sub, setSub] = useState<string | null>(null); // null = soorten kiezen, "" = alles in de afdeling
  const goAisle = (a: string) => {
    setAisle(a);
    setSub(null);
  };
  const [filter, setFilter] = useState<Filter>("all");
  const [filterOpen, setFilterOpen] = useState(false);
  // Indeling zoals bij Alle producten: per afdeling, en daarbinnen per soort. Wat je typt bij zoeken filtert ook je voorraad.
  const shownItems = useMemo(() => {
    const q = name.trim().toLowerCase();
    return (data?.items ?? []).filter(
      (i) =>
        (!q || i.name.toLowerCase().includes(q) || (i.product_name ?? "").toLowerCase().includes(q)) &&
        (filter === "all" ||
          (filter === "low" && (i.restock ?? 0) > 0) ||
          (filter === "dishes" && i.for_dishes !== false) ||
          (filter === "nodishes" && i.for_dishes === false) ||
          (filter === "use" && !!(i.use_amount ?? i.weekly))),
    );
  }, [data, name, filter]);
  const aisleCounts = useMemo(() => {
    const c: Record<string, number> = {};
    shownItems.forEach((i) => (c[i.aisle || "Overig"] = (c[i.aisle || "Overig"] ?? 0) + 1));
    return c;
  }, [shownItems]);
  const groups = useMemo(() => {
    const out: { aisle: string; subs: { sub: string; items: PItem[] }[]; n: number }[] = [];
    for (const a of AISLES) {
      if (aisle !== "all" && a !== aisle) continue;
      const items = shownItems.filter((i) => (i.aisle || "Overig") === a && (!sub || (i.sub || "Overig") === sub));
      if (!items.length) continue;
      const subs: { sub: string; items: PItem[] }[] = [];
      for (const it of items) {
        const k = it.sub || "";
        (subs.find((x) => x.sub === k) ?? subs[subs.push({ sub: k, items: [] }) - 1]).items.push(it);
      }
      subs.sort((x, y) => (!x.sub ? 1 : !y.sub ? -1 : x.sub.localeCompare(y.sub, "nl")));
      out.push({ aisle: a, subs, n: items.length });
    }
    return out;
  }, [shownItems, aisle, sub]);
  const browsing = !name.trim() && filter === "all";
  const mode: "cats" | "subs" | "list" = !browsing ? "list" : aisle === "all" ? "cats" : sub === null ? "subs" : "list";
  const subCounts = useMemo(() => {
    const c: Record<string, number> = {};
    shownItems.filter((i) => (i.aisle || "Overig") === aisle).forEach((i) => (c[i.sub || "Overig"] = (c[i.sub || "Overig"] ?? 0) + 1));
    return Object.entries(c).sort((x, y) => (x[0] === "Overig" ? 1 : y[0] === "Overig" ? -1 : x[0].localeCompare(y[0], "nl")));
  }, [shownItems, aisle]);
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
            {/* Bovenaan: zoeken (filtert ook je voorraad) en toevoegen */}
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
                  <Text style={styles.label}>Toevoegen uit de winkel</Text>
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
              {name.trim() ? (
                <>
                  <View style={{ flexDirection: "row", gap: 10 }}>
                    <Field label="Hoeveel" testID="pantry-qty" value={qty} onChangeText={setQty} keyboardType="decimal-pad" containerStyle={{ flex: 1 }} />
                    <View style={{ flex: 1, gap: 6 }}>
                      <Text style={styles.label}>Eenheid</Text>
                      <Select value={unit} options={UNITS} onChange={setUnit} testID="pantry-unit" />
                    </View>
                  </View>
                  <Button label="Toevoegen" onPress={() => add.mutate()} loading={add.isPending} disabled={!name.trim()} testID="pantry-add" />
                </>
              ) : null}
            </View>
            {(() => {
              // Standaard ingeklapt, zodat je meteen je voorraad ziet; alleen bij een lege voorraadkast meteen open
              const empty = !isLoading && (data?.items ?? []).length === 0;
              const show = sugOpen || empty;
              return (
                <View style={styles.addCard}>
                  <Pressable onPress={() => setSugOpen((v) => !v)} disabled={empty} style={{ flexDirection: "row", alignItems: "center", gap: 8 }} testID="pantry-sug-toggle">
                    <Icon name="lightbulb-on-outline" size={20} color={colors.brandPrimary} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowName}>Voorstellen: wat veel mensen al in huis hebben</Text>
                      {show ? <Text style={styles.rowQty}>Vink aan wat jij hebt en zet het in één keer in je voorraadkast.</Text> : null}
                    </View>
                    {empty ? null : <Icon name={show ? "chevron-up" : "chevron-down"} size={20} color={colors.muted} />}
                  </Pressable>
                  {show ? <PantrySuggestions onDone={() => setSugOpen(false)} /> : null}
                </View>
              );
            })()}
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
            {(data?.items ?? []).length ? (
              // Afdelingen en filters zoals bij Alle producten
              <View style={{ gap: 8 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={[styles.groupTitle, { flex: 1, marginTop: 0 }]}>
                    Jouw voorraad <Text style={styles.rowQty}>({shownItems.length})</Text>
                  </Text>
                  <Pressable onPress={() => setFilterOpen(true)} style={[styles.filterBtn, filter !== "all" && styles.filterBtnOn]} testID="pantry-filter">
                    <Icon name="tune-variant" size={16} color={filter !== "all" ? colors.onBrandPrimary : colors.brandPrimary} />
                    <Text style={[styles.filterText, filter !== "all" && { color: colors.onBrandPrimary }]}>
                      {filter === "all" ? "Filters" : FILTERS.find((f) => f.key === filter)?.label}
                    </Text>
                  </Pressable>
                </View>
                <View style={styles.crumbs}>
                  <Pressable onPress={() => goAisle("all")} hitSlop={6} testID="pantry-crumb-all">
                    <Text style={[styles.crumb, mode === "cats" && styles.crumbOn]}>Alle afdelingen</Text>
                  </Pressable>
                  {aisle !== "all" ? (
                    <>
                      <Icon name="chevron-right" size={16} color={colors.muted} />
                      <Pressable onPress={() => setSub(null)} hitSlop={6} testID="pantry-crumb-aisle">
                        <Text style={[styles.crumb, mode === "subs" && styles.crumbOn]} numberOfLines={1}>{aisle}</Text>
                      </Pressable>
                    </>
                  ) : null}
                  {aisle !== "all" && sub !== null ? (
                    <>
                      <Icon name="chevron-right" size={16} color={colors.muted} />
                      <Text style={[styles.crumb, styles.crumbOn, { flexShrink: 1 }]} numberOfLines={1}>{sub || "Alles"}</Text>
                    </>
                  ) : null}
                </View>
              </View>
            ) : null}
            {isLoading ? (
              <ActivityIndicator color={colors.brandPrimary} />
            ) : (data?.items ?? []).length === 0 ? null : mode === "cats" ? (
              <View style={styles.tiles}>
                {AISLES.filter((a) => (aisleCounts[a] ?? 0) > 0).map((a) => (
                  <Pressable key={a} onPress={() => goAisle(a)} style={styles.tile} testID={`pantry-cat-${a}`}>
                    <View style={styles.tileIcon}>
                      <Icon name={(AISLE_ICONS[a] ?? "cart-outline") as any} size={24} color={colors.brandPrimary} />
                    </View>
                    <Text style={styles.tileTitle} numberOfLines={2}>{a}</Text>
                    <Text style={styles.rowQty}>{aisleCounts[a]} in huis</Text>
                  </Pressable>
                ))}
              </View>
            ) : mode === "subs" ? (
              <View style={styles.tiles}>
                <Pressable onPress={() => setSub("")} style={styles.tile} testID="pantry-sub-all">
                  <View style={styles.tileIcon}>
                    <Icon name="view-grid-outline" size={24} color={colors.brandPrimary} />
                  </View>
                  <Text style={styles.tileTitle} numberOfLines={2}>Alles in {aisle}</Text>
                  <Text style={styles.rowQty}>{aisleCounts[aisle] ?? 0} in huis</Text>
                </Pressable>
                {subCounts.map(([k, n]) => (
                  <Pressable key={k} onPress={() => setSub(k)} style={styles.tile} testID={`pantry-sub-${k}`}>
                    <View style={styles.tileIcon}>
                      <Icon name={(AISLE_ICONS[aisle] ?? "cart-outline") as any} size={24} color={colors.brandPrimary} />
                    </View>
                    <Text style={styles.tileTitle} numberOfLines={2}>{k}</Text>
                    <Text style={styles.rowQty}>{n} in huis</Text>
                  </Pressable>
                ))}
              </View>
            ) : groups.length === 0 ? (
              <Text style={styles.rowQty}>Niets gevonden in je voorraad{name.trim() ? ` voor "${name.trim()}"` : ""}.</Text>
            ) : (
              groups.map((g) => (
                <View key={g.aisle} style={{ gap: 6 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Icon name={(AISLE_ICONS[g.aisle] ?? "cart-outline") as any} size={18} color={colors.brandSecondary} />
                    <Text style={styles.groupTitle}>
                      {g.aisle} <Text style={styles.rowQty}>({g.n})</Text>
                    </Text>
                  </View>
                  {g.subs.map((sg) => (
                    <View key={sg.sub || "_"} style={{ gap: 4 }}>
                      {g.subs.length > 1 || sg.sub ? <Text style={styles.subTitle}>{sg.sub || "Overig"}</Text> : null}
                      <View style={styles.list}>
                        {sg.items.map((i, n, arr) => (
                          <Pressable key={i.id} onPress={() => setEdit(i)} style={[styles.row, n < arr.length - 1 && styles.rowBorder]} testID={`pantry-row-${i.id}`}>
                            {i.image ? <Image source={{ uri: i.image }} style={styles.thumb} resizeMode="contain" /> : <View style={styles.thumb}><Icon name="fridge-outline" size={18} color={colors.muted} /></View>}
                            <View style={{ flex: 1 }}>
                              <Text style={styles.rowName} numberOfLines={1}>{i.name}</Text>
                              <Text style={[styles.rowQty, (i.restock ?? 0) > 0 && { color: colors.warning }]} numberOfLines={1}>{stockText(i)}</Text>
                              <Pressable
                                onPress={() => update.mutate({ ...i, for_dishes: i.for_dishes === false })}
                                hitSlop={6}
                                style={[styles.dishChip, i.for_dishes === false && styles.dishChipOff]}
                                testID={`pantry-dish-${i.id}`}
                              >
                                <Icon name={i.for_dishes === false ? "silverware-variant" : "silverware-fork-knife"} size={13} color={i.for_dishes === false ? colors.muted : colors.brandPrimary} />
                                <Text style={[styles.dishChipText, i.for_dishes === false && { color: colors.muted }]}>
                                  {i.for_dishes === false ? "Niet bij gerechten" : "Telt mee bij gerechten"}
                                </Text>
                              </Pressable>
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
                  ))}
                </View>
              ))
            )}
            <Text style={styles.intro}>
              Wat je al in huis hebt, hoef je voor je gerechten niet te kopen. Tik op een product om in te stellen hoe vol het is en hoeveel je er zelf
              gebruikt. Is iets bijna op, dan stellen we voor het in je volgende boodschappenlijst te zetten.
            </Text>
          </>
        )}
      </KeyboardAwareScrollView>
      <Modal visible={filterOpen} transparent animationType="fade" onRequestClose={() => setFilterOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setFilterOpen(false)}>
          <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]} onPress={() => {}}>
            <Text style={styles.headerTitle2}>Filters</Text>
            {FILTERS.map((f) => (
              <Pressable
                key={f.key}
                onPress={() => {
                  setFilter(f.key);
                  setFilterOpen(false);
                }}
                style={styles.filterRow}
                testID={`pantry-filter-${f.key}`}
              >
                <Text style={[styles.rowName, filter === f.key && { color: colors.brandPrimary }]}>{f.label}</Text>
                {filter === f.key ? <Icon name="check" size={18} color={colors.brandPrimary} /> : null}
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
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
  dishChip: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", marginTop: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.brandPrimary },
  dishChipOff: { borderColor: colors.border },
  dishChipText: { fontSize: 11, fontFamily: fonts.semibold, color: colors.brandPrimary },
  dishBox: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary },
  seg: { flexDirection: "row", backgroundColor: colors.surfaceTertiary, borderRadius: 10, padding: 3 },
  segBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center" },
  segOn: { backgroundColor: colors.surface },
  segText: { fontSize: 13, fontFamily: fonts.medium, color: colors.muted },
  segTextOn: { color: colors.onSurface, fontFamily: fonts.semibold },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  headerTitle2: { fontSize: 18, fontFamily: fonts.bold, color: colors.onSurface },
  quick: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceTertiary },
  quickOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  quickText: { fontSize: 13, fontFamily: fonts.medium, color: colors.onSurfaceTertiary },
  quickTextOn: { color: colors.onBrandPrimary },
  thumb: { width: 38, height: 38, borderRadius: 8, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  groupTitle: { fontSize: 15, fontFamily: fonts.bold, color: colors.onSurface, marginTop: 4 },
  subTitle: { fontSize: 13, fontFamily: fonts.semibold, color: colors.muted, marginTop: 2 },
  filterBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: colors.brandPrimary },
  filterBtnOn: { backgroundColor: colors.brandPrimary },
  filterText: { fontSize: 13, fontFamily: fonts.semibold, color: colors.brandPrimary },
  filterRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.divider },
  crumbs: { flexDirection: "row", alignItems: "center", gap: 4, flexWrap: "wrap" },
  crumb: { fontSize: 14, fontFamily: fonts.medium, color: colors.brandPrimary },
  crumbOn: { color: colors.onSurface, fontFamily: fonts.semibold },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  tile: { width: "48%", flexGrow: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 12, gap: 6, backgroundColor: colors.surface },
  tileIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  tileTitle: { fontSize: 14, fontFamily: fonts.semibold, color: colors.onSurface },
  deptChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceTertiary },
  deptChipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  deptText: { fontSize: 13, fontFamily: fonts.medium, color: colors.onSurfaceTertiary },
  deptTextOn: { color: colors.onBrandPrimary },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, gap: 14, maxHeight: "92%" },
  pickRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 8, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  pickImg: { width: 40, height: 40, borderRadius: 8, backgroundColor: "#fff" },
  stepBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
}));

// Eén product instellen: hoe vol het nu is, hoeveel je er zelf van gebruikt per zelf gekozen periode, en of het meetelt voor gerechten.
// Bijhouden in aantal (8 eieren, 500 gram) of in procent (een fles olie: nog 60%, 10% per week).
const PCT_STEPS = [5, 10, 20, 25, 50, 100];

function EditSheet({ item, onClose, onSave, onDelete }: { item: PItem | null; onClose: () => void; onSave: (i: PItem) => void; onDelete: (i: PItem) => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("stuks");
  const [use, setUse] = useState("");
  const [days, setDays] = useState(7);
  const [ownDays, setOwnDays] = useState("");
  const [forDishes, setForDishes] = useState(true);
  const [key, setKey] = useState<string | null>(null);
  if (item && key !== item.id) {
    // Nieuw product geopend: velden vullen
    setKey(item.id);
    setQty(formatQty(item.qty));
    setUnit(item.unit);
    const amount = item.use_amount ?? item.weekly;
    const d = item.use_days ?? 7;
    setUse(amount ? formatQty(amount) : "");
    setDays(d);
    setOwnDays(PERIODS.some((p) => p.days === d) ? "" : formatQty(d));
    setForDishes(item.for_dishes !== false);
  }
  if (!item && key !== null) setKey(null);
  const num = (v: string) => parseFloat(v.replace(",", ".")) || 0;
  const pct = unit === "%";
  const w = num(use);
  const own = !PERIODS.some((p) => p.days === days);
  const setMode = (toPct: boolean) => {
    if (toPct === pct) return;
    setUnit(toPct ? "%" : "stuks");
    setQty(toPct ? "100" : "1");
    setUse("");
  };
  const per = periodText(days);
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
              <ScrollView contentContainerStyle={{ gap: 16 }} keyboardShouldPersistTaps="handled">
                <View style={{ gap: 6 }}>
                  <Text style={styles.label}>Bijhouden in</Text>
                  <View style={styles.seg}>
                    <Pressable onPress={() => setMode(false)} style={[styles.segBtn, !pct && styles.segOn]} testID="pantry-mode-qty">
                      <Text style={[styles.segText, !pct && styles.segTextOn]}>Aantal (stuks, gram…)</Text>
                    </Pressable>
                    <Pressable onPress={() => setMode(true)} style={[styles.segBtn, pct && styles.segOn]} testID="pantry-mode-pct">
                      <Text style={[styles.segText, pct && styles.segTextOn]}>Procent (fles, pot)</Text>
                    </Pressable>
                  </View>
                </View>

                {/* 1. Hoeveel heb je nu */}
                {pct ? (
                  <View style={{ gap: 6 }}>
                    <Text style={styles.label}>Hoe vol is het nu? {Math.round(num(qty))}%</Text>
                    <View style={styles.chips}>
                      {[100, 75, 50, 25, 10].map((v) => (
                        <Pressable key={v} onPress={() => setQty(String(v))} style={[styles.quick, num(qty) === v && styles.quickOn]}>
                          <Text style={[styles.quickText, num(qty) === v && styles.quickTextOn]}>{v === 100 ? "Vol" : `${v}%`}</Text>
                        </Pressable>
                      ))}
                    </View>
                    <Field label="Of precies (%)" value={qty} onChangeText={setQty} keyboardType="decimal-pad" testID="pantry-edit-pct" />
                  </View>
                ) : (
                  <View style={{ flexDirection: "row", gap: 10 }}>
                    <Field label="Hoeveel heb je nu" value={qty} onChangeText={setQty} keyboardType="decimal-pad" containerStyle={{ flex: 1 }} testID="pantry-edit-qty" />
                    <View style={{ flex: 1, gap: 6 }}>
                      <Text style={styles.label}>Eenheid</Text>
                      <Select value={unit} options={UNITS} onChange={setUnit} testID="pantry-edit-unit" />
                    </View>
                  </View>
                )}

                {/* 2. Hoeveel gaat er af, en per welke periode */}
                <View style={{ gap: 6 }}>
                  <Field
                    label={`Zelf gebruikt (${pct ? "%" : unit})`}
                    value={use}
                    onChangeText={setUse}
                    keyboardType="decimal-pad"
                    placeholder={pct ? "Bijv. 10" : "Bijv. 2 (leeg = niet bijhouden)"}
                    testID="pantry-edit-use"
                  />
                  {pct ? (
                    <View style={styles.chips}>
                      {PCT_STEPS.map((v) => (
                        <Pressable key={v} onPress={() => setUse(String(v))} style={[styles.quick, w === v && styles.quickOn]} testID={`pantry-pct-${v}`}>
                          <Text style={[styles.quickText, w === v && styles.quickTextOn]}>{v === 100 ? "Helemaal op" : `${v}%`}</Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                  <Text style={[styles.label, { marginTop: 4 }]}>Per</Text>
                  <View style={styles.chips}>
                    {PERIODS.map((p) => (
                      <Pressable key={p.days} onPress={() => {
                          setDays(p.days);
                          setOwnDays("");
                        }} style={[styles.quick, days === p.days && styles.quickOn]} testID={`pantry-period-${p.days}`}>
                        <Text style={[styles.quickText, days === p.days && styles.quickTextOn]}>{p.label.replace("per ", "")}</Text>
                      </Pressable>
                    ))}
                    <Pressable onPress={() => {
                        setOwnDays(ownDays || "3");
                        setDays(num(ownDays || "3"));
                      }} style={[styles.quick, own && styles.quickOn]} testID="pantry-period-own">
                      <Text style={[styles.quickText, own && styles.quickTextOn]}>Aantal dagen</Text>
                    </Pressable>
                  </View>
                  {own ? (
                    <Field
                      label="Elke hoeveel dagen"
                      value={ownDays}
                      onChangeText={(v) => {
                        setOwnDays(v);
                        if (num(v) >= 1) setDays(num(v));
                      }}
                      keyboardType="decimal-pad"
                      testID="pantry-edit-days"
                    />
                  ) : null}
                  {w ? (
                    <Pressable onPress={() => setUse("")} style={{ alignSelf: "flex-start" }}>
                      <Text style={[styles.rowQty, { color: colors.brandPrimary }]}>Niet bijhouden</Text>
                    </Pressable>
                  ) : null}
                </View>
                <Text style={styles.rowQty}>
                  {w
                    ? `Er gaat ${formatQty(w)}${pct ? "%" : ` ${unit}`} ${per} af. Is het bijna op, dan stellen we voor het te kopen in je volgende boodschappenlijst.`
                    : "Gebruik je dit ook buiten je gerechten (olie, koffie, eieren bij het ontbijt)? Vul dan in hoeveel en per welke periode."}
                </Text>

                <View style={styles.dishBox}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowName}>Meerekenen bij gerechten</Text>
                    <Text style={styles.rowQty}>
                      {forDishes
                        ? w
                          ? "Aan: wat je hebt gaat van je boodschappen af, maar je eigen verbruik houden we apart."
                          : "Aan: wat je hebt, hoef je voor je gerechten niet te kopen."
                        : "Uit: voor gerechten kopen we het gewoon, ook al heb je het in huis."}
                    </Text>
                  </View>
                  <Switch value={forDishes} onValueChange={setForDishes} testID="pantry-edit-dishes" />
                </View>
                <Button
                  label="Opslaan"
                  onPress={() =>
                    onSave({
                      ...item,
                      qty: pct ? Math.min(100, num(qty)) : num(qty),
                      unit,
                      weekly: w > 0 ? (w * 7) / Math.max(1, days) : null,
                      use_amount: w > 0 ? w : null,
                      use_days: w > 0 ? Math.max(1, days) : null,
                      for_dishes: forDishes,
                    })
                  }
                  testID="pantry-edit-save"
                />
                <Pressable onPress={() => onDelete(item)} style={{ alignSelf: "center", flexDirection: "row", gap: 6, alignItems: "center" }} testID="pantry-edit-delete">
                  <Icon name="trash-can-outline" size={18} color={colors.error} />
                  <Text style={[styles.rowName, { color: colors.error }]}>Uit je voorraadkast halen</Text>
                </Pressable>
              </ScrollView>
            </>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
