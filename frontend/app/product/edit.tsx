import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Modal, Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button, Field, Icon, Select } from "@/src/components/ui";
import { api } from "@/src/api";
import { AISLES, UNITS } from "@/src/constants";
import type { Product } from "@/app/(tabs)/products";
import { useAuth } from "@/src/auth";
import { goBack } from "@/src/nav";
import { useToast } from "@/src/toast";
import { fonts, makeStyles, useTheme } from "@/src/theme";

type OffResult = { name: string; brand?: string | null; barcode?: string | null; quantity?: string | null; price?: number; on_offer?: boolean; aisle?: string; store?: string };

export default function ProductEditScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ id?: string; name?: string; brand?: string; barcode?: string; unit?: string }>();
  const { has } = useAuth();
  const canManage = has("manage_products");

  const { data: storesData } = useQuery({
    queryKey: ["stores"],
    queryFn: () => api<{ stores: string[] }>("/stores"),
  });
  const stores = storesData?.stores ?? ["Dirk", "Albert Heijn"];
  // Direct tonen vanuit de al geladen productlijst, daarna vers ophalen
  const cached = useMemo(() => {
    if (!params.id) return undefined;
    for (const [, d] of qc.getQueriesData<any>({ queryKey: ["products", "search"] })) {
      const list: Product[] = d?.pages ? d.pages.flatMap((pg: any) => pg.products) : d?.products ?? [];
      const hit = list.find((p) => p.id === params.id);
      if (hit) return hit;
    }
    return undefined;
  }, [params.id, qc]);
  const { data: fetched } = useQuery({
    queryKey: ["products", "item", params.id],
    queryFn: () => api<Product>(`/products/${params.id}`),
    enabled: !!params.id,
    placeholderData: cached,
  });
  const existing = params.id ? fetched : undefined;
  const isNew = !params.id;
  const readOnly = !!existing?.is_global && !canManage;

  const [name, setName] = useState(existing?.name ?? params.name ?? "");
  const [brand, setBrand] = useState(existing?.brand ?? params.brand ?? "");
  const [barcode, setBarcode] = useState(existing?.barcode ?? params.barcode ?? "");
  const [aisle, setAisle] = useState(existing?.aisle ?? "Overig");
  const [unit, setUnit] = useState(existing?.unit ?? params.unit ?? "stuks");
  const [asGlobal, setAsGlobal] = useState(existing?.is_global ?? false);
  const [prices, setPrices] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const [s, v] of Object.entries(existing?.prices ?? {})) {
      out[s] = v ? String(v) : "";
    }
    return out;
  });

  const [searchOpen, setSearchOpen] = useState(false);
  const [unavailable, setUnavailable] = useState<string[]>(existing?.unavailable ?? []);

  // Als het product pas na het openen binnenkomt: velden alsnog vullen
  const seeded = useRef(!!existing);
  useEffect(() => {
    if (!existing || seeded.current) return;
    seeded.current = true;
    setName(existing.name);
    setBrand(existing.brand ?? "");
    setBarcode(existing.barcode ?? "");
    setAisle(existing.aisle);
    setUnit(existing.unit);
    setAsGlobal(existing.is_global);
    setPrices(Object.fromEntries(Object.entries(existing.prices ?? {}).map(([k, v]) => [k, v ? String(v) : ""])));
    setUnavailable(existing.unavailable ?? []);
  }, [existing]);
  const toggleUnavailable = (s: string) =>
    setUnavailable((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  const buildBody = () => ({
    name: name.trim(),
    brand: brand.trim() || null,
    barcode: barcode.trim() || null,
    aisle,
    unit,
    is_global: asGlobal,
    unavailable,
    prices: Object.fromEntries(
      Object.entries(prices)
        .map(([s, v]) => [s, parseFloat(v.replace(",", ".")) || 0])
        .filter(([s, v]) => (v as number) > 0 && !unavailable.includes(s as string)),
    ),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["products"] });
    qc.invalidateQueries({ queryKey: ["product-submissions-count"] });
  };

  const save = useMutation({
    mutationFn: () =>
      params.id && !readOnly
        ? api(`/products/${params.id}`, { method: "PUT", body: buildBody() })
        : api("/products", { method: "POST", body: buildBody() }),
    onSuccess: () => {
      invalidate();
      toast.show(
        !canManage && !readOnly && isNew
          ? "Product opgeslagen — de beheerder kan het aan de algemene lijst toevoegen"
          : "Product opgeslagen",
        "success",
      );
      router.back();
    },
    onError: (e: any) => toast.show(e?.message ?? "Opslaan mislukt", "error"),
  });

  const copyToOwn = useMutation({
    mutationFn: () => api("/products", { method: "POST", body: { ...buildBody(), is_global: false, name: `${name} (eigen)` } }),
    onSuccess: () => {
      invalidate();
      toast.show("Gekopieerd naar eigen producten", "success");
      router.back();
    },
    onError: (e: any) => toast.show(e?.message ?? "Mislukt", "error"),
  });

  const remove = useMutation({
    mutationFn: () => api(`/products/${params.id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidate();
      toast.show("Product verwijderd", "info");
      router.back();
    },
    onError: (e: any) => toast.show(e?.message ?? "Verwijderen mislukt", "error"),
  });

  const onSave = () => {
    if (!name.trim()) {
      toast.show("Geef het product een naam", "error");
      return;
    }
    save.mutate();
  };

  const applyOff = (r: OffResult) => {
    setName(r.name);
    if (r.brand) setBrand(r.brand);
    if (r.barcode) setBarcode(r.barcode);
    if (r.aisle) setAisle(r.aisle);
    if (r.price && r.price > 0 && r.store) {
      const st = r.store;
      setPrices((p) => ({ ...p, [st]: String(r.price) }));
      setUnavailable((prev) => prev.filter((x) => x !== st));
    }
    setSearchOpen(false);
  };

  const title = isNew ? "Nieuw product" : readOnly ? name : "Product bewerken";

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable testID="close-button" onPress={() => goBack("/products")} hitSlop={10} style={styles.headerBtn}>
          <Icon name="close" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
        {!readOnly && !isNew ? (
          <Pressable testID="delete-product-button" onPress={() => remove.mutate()} hitSlop={10} style={styles.headerBtn}>
            <Icon name="trash-can-outline" size={22} color={colors.error} />
          </Pressable>
        ) : (
          <View style={styles.headerBtn} />
        )}
      </View>

      <KeyboardAwareScrollView bottomOffset={20} contentContainerStyle={{ padding: 16, gap: 16 }} keyboardShouldPersistTaps="handled">
        {readOnly ? (
          <View style={styles.banner}>
            <Icon name="information-outline" size={18} color={colors.onBrandTertiary} />
            <Text style={styles.bannerText}>Algemeen product — kopieer naar eigen om aan te passen.</Text>
          </View>
        ) : null}

        {!readOnly ? (
          <View style={styles.toolRow}>
            <Pressable testID="off-search-button" onPress={() => setSearchOpen(true)} style={styles.toolBtn}>
              <Icon name="magnify" size={18} color={colors.brandPrimary} />
              <Text style={styles.toolText}>Zoek online</Text>
            </Pressable>
            <Pressable testID="scan-button" onPress={() => router.push("/product/scan")} style={styles.toolBtn}>
              <Icon name="barcode-scan" size={18} color={colors.brandPrimary} />
              <Text style={styles.toolText}>Scan barcode</Text>
            </Pressable>
          </View>
        ) : null}

        <Field label="Naam" testID="product-name" placeholder="Bijv. Pindakaas" value={name} onChangeText={setName} editable={!readOnly} />
        <Field label="Merk (optioneel)" testID="product-brand" value={brand} onChangeText={setBrand} editable={!readOnly} />

        <View style={{ gap: 8 }}>
          <Text style={styles.label}>Categorie</Text>
          <Select testID="product-aisle" value={aisle} options={AISLES} disabled={readOnly} icon="tag-outline" onChange={setAisle} />
        </View>
        <View style={{ gap: 8 }}>
          <Text style={styles.label}>Eenheid</Text>
          <Select testID="product-unit" value={unit} options={UNITS} disabled={readOnly} icon="scale-balance" onChange={setUnit} />
        </View>

        <View style={{ gap: 10 }}>
          <Text style={styles.label}>Prijs per winkel (per {unit})</Text>
          {stores.map((s) => {
            const na = unavailable.includes(s);
            return (
              <View key={s} style={styles.priceBlock}>
                <View style={styles.priceRow}>
                  <Text style={styles.storeName}>{s}</Text>
                  <View style={[styles.priceInputWrap, na && { opacity: 0.4 }]}>
                    <Text style={styles.priceEuro}>€</Text>
                    {readOnly ? (
                      <Text style={styles.priceRead}>{na ? "n.v.t." : prices[s] || "—"}</Text>
                    ) : (
                      <TextInput
                        testID={`price-${s}`}
                        keyboardType="decimal-pad"
                        editable={!na}
                        value={na ? "" : (prices[s] ?? "")}
                        placeholder="0,00"
                        placeholderTextColor={colors.muted}
                        onChangeText={(t) => setPrices((p) => ({ ...p, [s]: t }))}
                        style={styles.priceInput}
                      />
                    )}
                  </View>
                </View>
                {!readOnly ? (
                  <Pressable testID={`unavailable-${s}`} onPress={() => toggleUnavailable(s)} style={styles.naRow}>
                    <Icon name={na ? "checkbox-marked" : "checkbox-blank-outline"} size={18} color={na ? colors.brandSecondary : colors.muted} />
                    <Text style={styles.naText}>Niet verkrijgbaar in deze winkel</Text>
                  </Pressable>
                ) : na ? (
                  <Text style={styles.naText}>Niet verkrijgbaar in deze winkel</Text>
                ) : null}
              </View>
            );
          })}
        </View>

        {canManage && !readOnly ? (
          <Pressable testID="as-global-toggle" onPress={() => setAsGlobal((v) => !v)} style={styles.toggle}>
            <Icon name={asGlobal ? "checkbox-marked" : "checkbox-blank-outline"} size={22} color={asGlobal ? colors.brandPrimary : colors.muted} />
            <Text style={styles.toggleText}>Algemeen product (zichtbaar voor iedereen)</Text>
          </Pressable>
        ) : null}

        <Field label="Barcode (optioneel)" testID="product-barcode" value={barcode} onChangeText={setBarcode} editable={!readOnly} autoCapitalize="none" />
      </KeyboardAwareScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        {readOnly ? (
          <Button label="Kopiëren naar eigen" icon="content-copy" onPress={() => copyToOwn.mutate()} loading={copyToOwn.isPending} testID="copy-product-button" />
        ) : (
          <Button label="Opslaan" onPress={onSave} loading={save.isPending} testID="save-product-button" />
        )}
      </View>

      <OffSearchModal open={searchOpen} onClose={() => setSearchOpen(false)} onPick={applyOff} initial={name} />
    </View>
  );
}

function OffSearchModal({ open, onClose, onPick, initial }: { open: boolean; onClose: () => void; onPick: (r: OffResult) => void; initial: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState(initial);
  const [results, setResults] = useState<OffResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [source, setSource] = useState<"dirk" | "ah" | "off">("dirk");

  const run = async (src: "dirk" | "ah" | "off" = source) => {
    if (!q.trim()) return;
    setLoading(true);
    setDone(false);
    try {
      const path =
        src === "dirk"
          ? `/stores/search?store=Dirk&q=${encodeURIComponent(q.trim())}`
          : src === "ah"
            ? `/stores/search?store=${encodeURIComponent("Albert Heijn")}&q=${encodeURIComponent(q.trim())}`
            : `/off/search?q=${encodeURIComponent(q.trim())}`;
      const d = await api<{ results: OffResult[] }>(path);
      const store = src === "dirk" ? "Dirk" : src === "ah" ? "Albert Heijn" : undefined;
      setResults(d.results.map((r) => ({ ...r, store })));
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
      setDone(true);
    }
  };

  const pickSource = (s: "dirk" | "ah" | "off") => {
    setSource(s);
    setResults([]);
    setDone(false);
    if (q.trim()) run(s);
  };

  return (
    <Modal visible={open} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Product online zoeken</Text>
            <Pressable testID="off-close" onPress={onClose} hitSlop={8}>
              <Icon name="close" size={22} color={colors.onSurface} />
            </Pressable>
          </View>
          <View style={styles.sourceRow}>
            <Pressable testID="src-dirk" onPress={() => pickSource("dirk")} style={[styles.srcBtn, source === "dirk" && styles.srcBtnActive]}>
              <Text style={[styles.srcText, source === "dirk" && styles.srcTextActive]}>Dirk</Text>
            </Pressable>
            <Pressable testID="src-ah" onPress={() => pickSource("ah")} style={[styles.srcBtn, source === "ah" && styles.srcBtnActive]}>
              <Text style={[styles.srcText, source === "ah" && styles.srcTextActive]}>Albert Heijn</Text>
            </Pressable>
            <Pressable testID="src-off" onPress={() => pickSource("off")} style={[styles.srcBtn, source === "off" && styles.srcBtnActive]}>
              <Text style={[styles.srcText, source === "off" && styles.srcTextActive]}>Algemeen</Text>
            </Pressable>
          </View>
          <View style={styles.searchRow}>
            <TextInput
              testID="off-search-input"
              placeholder={source === "off" ? "Bijv. Calvé pindakaas" : "Bijv. melk, patat, pindakaas"}
              placeholderTextColor={colors.muted}
              value={q}
              onChangeText={setQ}
              onSubmitEditing={() => run()}
              returnKeyType="search"
              style={styles.offInput}
            />
            <Pressable testID="off-search-go" onPress={() => run()} style={styles.offGo}>
              <Icon name="magnify" size={20} color={colors.onBrandPrimary} />
            </Pressable>
          </View>
          {loading ? (
            <View style={{ padding: 24 }}>
              <ActivityIndicator color={colors.brandPrimary} />
            </View>
          ) : (
            <FlatList
              data={results}
              keyExtractor={(_, i) => String(i)}
              style={{ maxHeight: 360 }}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <Pressable testID={`off-result-${item.barcode ?? item.name}`} onPress={() => onPick(item)} style={styles.offRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.offName} numberOfLines={1}>{item.name}</Text>
                    <Text style={styles.offMeta} numberOfLines={1}>
                      {[item.brand, item.quantity].filter(Boolean).join(" · ") || "—"}
                    </Text>
                  </View>
                  {item.price && item.price > 0 ? (
                    <Text style={[styles.offPrice, item.on_offer && { color: colors.brandSecondary }]}>€ {item.price.toFixed(2)}</Text>
                  ) : null}
                  <Icon name="plus-circle-outline" size={22} color={colors.brandPrimary} />
                </Pressable>
              )}
              ListEmptyComponent={
                done ? <Text style={styles.offEmpty}>Geen resultaten. Pas je zoekterm aan of voer handmatig in.</Text> : null
              }
            />
          )}
        </View>
      </View>
    </Modal>
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
  headerTitle: { flex: 1, textAlign: "center", fontSize: 17, fontFamily: fonts.semibold, color: colors.onSurface },
  banner: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.brandTertiary, borderRadius: 12, padding: 12 },
  bannerText: { flex: 1, fontSize: 13, fontFamily: fonts.medium, color: colors.onBrandTertiary },
  label: { fontSize: 13, fontFamily: fonts.semibold, color: colors.onSurfaceSecondary },
  toolRow: { flexDirection: "row", gap: 10 },
  toolBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.brandPrimary,
  },
  toolText: { fontSize: 14, fontFamily: fonts.semibold, color: colors.brandPrimary },
  priceRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  priceBlock: { gap: 4 },
  naRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 2 },
  naText: { fontSize: 12, fontFamily: fonts.medium, color: colors.muted },
  storeName: { fontSize: 14, fontFamily: fonts.medium, color: colors.onSurface },
  priceInputWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minWidth: 100,
  },
  priceEuro: { fontSize: 15, fontFamily: fonts.semibold, color: colors.muted },
  priceInput: { flex: 1, fontSize: 15, fontFamily: fonts.bold, color: colors.onSurface, padding: 0, textAlign: "right" },
  priceRead: { flex: 1, fontSize: 15, fontFamily: fonts.bold, color: colors.onSurface, textAlign: "right" },
  toggle: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 },
  toggleText: { flex: 1, fontSize: 14, fontFamily: fonts.medium, color: colors.onSurfaceSecondary },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    backgroundColor: colors.surface,
  },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16, gap: 12 },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sheetTitle: { fontSize: 18, fontFamily: fonts.bold, color: colors.onSurface },
  searchRow: { flexDirection: "row", gap: 8 },
  offInput: {
    flex: 1,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 15,
    fontFamily: fonts.regular,
    color: colors.onSurface,
  },
  offGo: { width: 46, borderRadius: 10, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  sourceRow: { flexDirection: "row", gap: 8 },
  srcBtn: { flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: "center", backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border },
  srcBtnActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  srcText: { fontSize: 13, fontFamily: fonts.semibold, color: colors.onSurfaceSecondary },
  srcTextActive: { color: colors.onBrandPrimary },
  offPrice: { fontSize: 14, fontFamily: fonts.bold, color: colors.onSurface, marginRight: 8 },
  offRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.divider },
  offName: { fontSize: 15, fontFamily: fonts.semibold, color: colors.onSurface },
  offMeta: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted, marginTop: 2 },
  offEmpty: { fontSize: 14, fontFamily: fonts.regular, color: colors.muted, textAlign: "center", padding: 20 },
}));
