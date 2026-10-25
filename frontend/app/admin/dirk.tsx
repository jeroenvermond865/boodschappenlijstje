import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button, Icon } from "@/src/components/ui";
import { api } from "@/src/api";
import { goBack } from "@/src/nav";
import { useToast } from "@/src/toast";
import { fonts, makeStyles, useTheme } from "@/src/theme";

type ImportStatus = { status?: string; found?: number; todo?: number; added?: number; skipped?: number; added_ah?: number; added_jumbo?: number; finished_at?: string | null; error?: string | null; running: boolean };

type DirkResult = { image?: string | null; source_id: string; name: string; brand?: string | null; quantity?: string | null; price: number; on_offer?: boolean; aisle: string };

const COUPLED = ["Dirk", "Albert Heijn", "Jumbo"];

export default function DirkImportScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const qc = useQueryClient();

  const [store, setStore] = useState("Dirk");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<DirkResult[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [searching, setSearching] = useState(false);

  const { data: status } = useQuery({
    queryKey: ["dirk-refresh-status"],
    queryFn: () => api<{ linked: number; refreshed_at: string | null }>("/admin/products/refresh-status"),
  });

  const { data: importStatus } = useQuery({
    queryKey: ["dirk-import-all"],
    queryFn: () => api<ImportStatus>("/admin/products/import-dirk-all"),
    // Blijf vragen zolang de import loopt; dat houdt de server ook wakker
    refetchInterval: (query) => (query.state.data?.running ? 5000 : false),
  });

  const importAllMut = useMutation({
    mutationFn: (only?: string) => api(`/admin/products/import-dirk-all${only ? `?only=${only}` : ""}`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dirk-import-all"] });
      toast.show("Import gestart, dit duurt een tijdje", "info");
    },
    onError: (e: any) => toast.show(e?.message ?? "Mislukt", "error"),
  });

  const wasRunning = importStatus?.running;
  const importLine = importStatus?.running
    ? `Bezig: ${importStatus.status ?? ""} · ${importStatus.found ?? 0} gevonden · ${(importStatus.added ?? 0) + (importStatus.added_ah ?? 0) + (importStatus.added_jumbo ?? 0)} toegevoegd. Laat dit scherm open.`
    : importStatus?.status === "klaar"
      ? `Klaar: ${importStatus.added ?? 0} van Dirk, ${importStatus.added_ah ?? 0} van Albert Heijn en ${importStatus.added_jumbo ?? 0} van Jumbo toegevoegd.${importStatus.skipped ? ` ${importStatus.skipped} Dirk-producten zijn niet leverbaar en overgeslagen.` : ""}`
      : importStatus?.status === "onderbroken"
        ? "De vorige import is onderbroken. Start hem opnieuw; wat er al is, wordt overgeslagen."
        : importStatus?.status === "mislukt"
          ? `Mislukt: ${importStatus.error ?? "onbekende fout"}`
          : "Haalt het hele assortiment van Dirk, Albert Heijn en Jumbo binnen. Dit kan een half uur duren.";

  const runSearch = async () => {
    if (!q.trim()) return;
    setSearching(true);
    try {
      const r = await api<{ results: DirkResult[] }>(`/stores/search?q=${encodeURIComponent(q.trim())}&store=${encodeURIComponent(store)}`);
      setResults(r.results);
      setPicked(new Set(r.results.map((x) => x.source_id)));
    } catch (e: any) {
      toast.show(e?.message ?? "Zoeken mislukt", "error");
    } finally {
      setSearching(false);
    }
  };

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const importMut = useMutation({
    mutationFn: () => {
      const items = results
        .filter((r) => picked.has(r.source_id))
        .map((r) => ({ source_id: r.source_id, image: r.image, name: r.name, brand: r.brand, quantity: r.quantity, price: r.price, aisle: r.aisle }));
      return api<{ added: number; skipped: number }>("/admin/products/import-dirk", { method: "POST", body: { store, items } });
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["dirk-refresh-status"] });
      toast.show(`${res.added} toegevoegd${res.skipped ? `, ${res.skipped} bestond al` : ""}`, "success");
      setResults([]);
      setPicked(new Set());
      setQ("");
    },
    onError: (e: any) => toast.show(e?.message ?? "Mislukt", "error"),
  });

  const refreshMut = useMutation({
    mutationFn: () => api<{ updated: number; checked: number }>("/admin/products/refresh-prices", { method: "POST" }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["dirk-refresh-status"] });
      toast.show(`${res.updated} prijzen bijgewerkt`, "success");
    },
    onError: (e: any) => toast.show(e?.message ?? "Verversen mislukt", "error"),
  });

  const lastRefresh = status?.refreshed_at
    ? new Date(status.refreshed_at).toLocaleString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : "nog niet";

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable testID="back-button" onPress={() => goBack("/")} hitSlop={10} style={styles.headerBtn}>
          <Icon name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Supermarkt importeren</Text>
        <View style={styles.headerBtn} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 14 }} keyboardShouldPersistTaps="handled">
        <View style={styles.storeRow}>
          {COUPLED.map((s) => (
            <Pressable key={s} testID={`import-store-${s}`} onPress={() => { setStore(s); setResults([]); setPicked(new Set()); }} style={[styles.storeChip, store === s && styles.storeChipActive]}>
              <Text style={[styles.storeChipText, store === s && styles.storeChipTextActive]}>{s}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.refreshCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.refreshTitle}>Automatische prijsupdate</Text>
            <Text style={styles.refreshSub}>{status?.linked ?? 0} gekoppelde producten · laatst: {lastRefresh}</Text>
          </View>
          <Pressable testID="refresh-prices" onPress={() => refreshMut.mutate()} disabled={refreshMut.isPending} style={styles.refreshBtn}>
            {refreshMut.isPending ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Icon name="refresh" size={18} color={colors.onBrandPrimary} />}
            <Text style={styles.refreshBtnText}>Ververs nu</Text>
          </Pressable>
        </View>

        <View style={styles.refreshCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.refreshTitle}>Alle producten importeren</Text>
            <Text style={styles.refreshSub}>{importLine}</Text>
          </View>
          <Pressable
            testID="import-all"
            onPress={() => importAllMut.mutate(undefined)}
            disabled={importAllMut.isPending || !!wasRunning}
            style={styles.refreshBtn}
          >
            {importAllMut.isPending || wasRunning ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Icon name="download" size={18} color={colors.onBrandPrimary} />}
            <Text style={styles.refreshBtnText}>Start</Text>
          </Pressable>
        </View>
        <Pressable
          testID="import-only-store"
          onPress={() => importAllMut.mutate(store === "Jumbo" ? "jumbo" : store === "Albert Heijn" ? "ah" : "dirk")}
          disabled={importAllMut.isPending || !!wasRunning}
          style={styles.storeChip}
        >
          <Text style={styles.storeChipText}>Alleen {store} importeren</Text>
        </Pressable>

        <Text style={styles.hint}>Zoek een product bij {store} en voeg het toe aan de algemene productenlijst. Prijzen worden daarna elke dag automatisch bijgewerkt.</Text>

        <View style={styles.searchRow}>
          <View style={styles.searchBox}>
            <Icon name="magnify" size={20} color={colors.muted} />
            <TextInput
              testID="dirk-search-input"
              placeholder="Bijv. melk, patat, appel"
              placeholderTextColor={colors.muted}
              value={q}
              onChangeText={setQ}
              onSubmitEditing={runSearch}
              returnKeyType="search"
              style={styles.searchInput}
            />
          </View>
          <Pressable testID="dirk-search-go" onPress={runSearch} style={styles.goBtn}>
            {searching ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Icon name="arrow-right" size={20} color={colors.onBrandPrimary} />}
          </Pressable>
        </View>

        {results.map((r) => {
          const on = picked.has(r.source_id);
          return (
            <Pressable key={r.source_id} testID={`dirk-res-${r.source_id}`} onPress={() => toggle(r.source_id)} style={styles.resRow}>
              <Icon name={on ? "checkbox-marked" : "checkbox-blank-outline"} size={22} color={on ? colors.brandPrimary : colors.muted} />
              <View style={{ flex: 1 }}>
                <Text style={styles.resName} numberOfLines={1}>{r.name}</Text>
                <Text style={styles.resMeta} numberOfLines={1}>
                  {r.aisle}{r.quantity ? ` · ${r.quantity}` : ""}
                </Text>
              </View>
              <Text style={[styles.resPrice, r.on_offer && { color: colors.error }]}>{r.price > 0 ? `€ ${r.price.toFixed(2)}` : "—"}</Text>
            </Pressable>
          );
        })}

        {results.length > 0 ? (
          <Button
            label={`Voeg ${picked.size} toe aan algemene lijst`}
            icon="cart-plus"
            onPress={() => picked.size && importMut.mutate()}
            loading={importMut.isPending}
            disabled={picked.size === 0}
            testID="dirk-import-button"
          />
        ) : null}
      </ScrollView>
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
  refreshCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.brandTertiary, borderRadius: 16, padding: 14 },
  refreshTitle: { fontSize: 15, fontFamily: fonts.bold, color: colors.onBrandTertiary },
  refreshSub: { fontSize: 12, fontFamily: fonts.regular, color: colors.onBrandTertiary, marginTop: 2 },
  refreshBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.brandPrimary, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  refreshBtnText: { fontSize: 13, fontFamily: fonts.semibold, color: colors.onBrandPrimary },
  hint: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted },
  storeRow: { flexDirection: "row", gap: 8 },
  storeChip: { flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: 12, backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border },
  storeChipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  storeChipText: { fontSize: 14, fontFamily: fonts.semibold, color: colors.onSurfaceTertiary },
  storeChipTextActive: { color: colors.onBrandPrimary },
  searchRow: { flexDirection: "row", gap: 8 },
  searchBox: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.surfaceTertiary, borderRadius: 12, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.border },
  searchInput: { flex: 1, paddingVertical: 12, fontSize: 15, fontFamily: fonts.regular, color: colors.onSurface },
  goBtn: { width: 48, borderRadius: 12, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  resRow: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 12 },
  resName: { fontSize: 15, fontFamily: fonts.semibold, color: colors.onSurface },
  resMeta: { fontSize: 12, fontFamily: fonts.regular, color: colors.muted, marginTop: 2 },
  resPrice: { fontSize: 15, fontFamily: fonts.bold, color: colors.brandPrimary },
}));
