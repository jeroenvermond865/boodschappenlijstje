// Tijdens het winkelen een product wisselen: voorstellen (zoals elders in de app), zelf zoeken, of de barcode scannen.
// Lukt scannen niet (geen camera of geen toestemming), dan typ je de cijfers. Is de barcode onbekend, dan zoek je het product
// zelf in alle winkels; de barcode wordt dan voorgesteld voor dat product (een beheerder keurt het goed).
import { useState } from "react";
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { CameraView, useCameraPermissions } from "expo-camera";

import { Icon } from "@/src/components/ui";
import { api } from "@/src/api";
import { euro, fetchProducts, useDebounced } from "@/src/search";
import { fonts, makeStyles, useTheme } from "@/src/theme";
import type { Product } from "@/app/(tabs)/products";

type AltProduct = Product & { note?: string | null; offer?: boolean };
const SHORT: Record<string, string> = { "Albert Heijn": "AH", Jumbo: "Jumbo", Dirk: "Dirk" };

export function ShopSwapSheet({
  item,
  store,
  onClose,
  onPick,
}: {
  item: { name: string; product?: string; product_id?: string } | null;
  store: string;
  onClose: () => void;
  onPick: (p: Product) => Promise<void> | void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState("");
  const [scan, setScan] = useState(false);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [unknown, setUnknown] = useState<string | null>(null); // gescande barcode die we nog niet kennen
  const [here, setHere] = useState(false); // alleen in deze winkel zoeken
  const [perm, requestPerm] = useCameraPermissions();
  const dq = useDebounced(q);
  const open = !!item;
  const alts = useQuery({
    queryKey: ["alternatives", item?.product_id ?? "", item?.name ?? ""],
    queryFn: () =>
      api<{ groups: { store: string; same_store: boolean; products: AltProduct[] }[] }>(
        `/alternatives?name=${encodeURIComponent(item!.name)}&product_id=${encodeURIComponent(item!.product_id ?? "")}`,
      ),
    enabled: open,
    staleTime: 10 * 60 * 1000,
  });
  const search = useQuery({
    queryKey: ["products", "search", "shopswap", dq.trim(), here ? store : ""],
    queryFn: () => fetchProducts({ q: dq, source: here ? store : undefined, limit: 40 }),
    enabled: open && dq.trim().length > 1,
    placeholderData: (prev) => prev,
  });
  const close = () => {
    setQ("");
    setScan(false);
    setCode("");
    setMsg(null);
    setUnknown(null);
    onClose();
  };
  const pick = async (p: Product) => {
    setBusy(true);
    try {
      await onPick(p);
      if (unknown) {
        // Deze barcode hoort bij dit product: voorstellen, een beheerder keurt het goed
        await api(`/products/${p.id}/barcode`, { method: "POST", body: { barcode: unknown } }).catch(() => null);
      }
      close();
    } finally {
      setBusy(false);
    }
  };

  // Barcode opzoeken: eerst bij onze producten (en live bij de winkels), anders de naam uit de open database (Open Food Facts)
  const lookup = async (raw: string) => {
    const ean = raw.replace(/\D/g, "");
    if (ean.length < 8) {
      setMsg("Die barcode is te kort. Typ alle cijfers onder de streepjes.");
      return;
    }
    setScan(false);
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ products: Product[] }>(`/products/by-barcode/${ean}`);
      const hit = r.products.find((p) => p.source === store) ?? r.products[0];
      if (hit) {
        await onPick(hit);
        close();
        return;
      }
      throw new Error("onbekend");
    } catch {
      setUnknown(ean);
      setMsg("Deze barcode kennen we nog niet. Zoek het product hieronder in alle winkels; als je het kiest, koppelen we de barcode eraan (na controle door een beheerder).");
    } finally {
      setBusy(false);
    }
  };

  const startScan = async () => {
    setMsg(null);
    try {
      const p = perm?.granted ? perm : await requestPerm();
      if (!p?.granted) {
        setMsg("Geen toegang tot de camera. Typ de cijfers van de barcode of zoek op naam.");
        return;
      }
      setScan(true);
    } catch {
      setMsg("Scannen lukt niet op dit apparaat. Typ de cijfers van de barcode of zoek op naam.");
    }
  };

  const Row = ({ p }: { p: AltProduct }) => (
    <Pressable onPress={() => pick(p)} disabled={busy} style={styles.row}>
      {p.image ? <Image source={{ uri: p.image }} style={styles.img} resizeMode="contain" /> : <View style={styles.img} />}
      <View style={{ flex: 1 }}>
        <Text style={styles.name} numberOfLines={2}>{p.name}</Text>
        <Text style={styles.meta} numberOfLines={1}>
          {SHORT[p.source ?? ""] ?? p.source ?? "Eigen"} · {p.unit}
          {p.unit_price ? ` · ${p.unit_price}` : ""}
        </Text>
        {p.note || p.promo ? (
          <Text style={[styles.meta, { color: p.promo ? colors.warning : colors.success, fontFamily: fonts.semibold }]} numberOfLines={1}>
            {p.promo?.label ?? p.note}
          </Text>
        ) : null}
      </View>
      <Text style={styles.price}>{p.price > 0 ? euro(p.promo?.price ?? p.price) : "—"}</Text>
    </Pressable>
  );

  const searching = dq.trim().length > 1;
  // Eerst wat in deze winkel ligt: je staat er nu
  const groups = [...(alts.data?.groups ?? [])].sort((a, b) => Number(b.store === store) - Number(a.store === store));

  return (
    <Modal visible={open} animationType="slide" transparent onRequestClose={close}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.head}>
            <Text style={styles.title} numberOfLines={1}>Wisselen: {item?.product ?? item?.name}</Text>
            <Pressable onPress={close} hitSlop={8}>
              <Icon name="close" size={22} color={colors.onSurface} />
            </Pressable>
          </View>

          {scan ? (
            <View style={styles.camBox}>
              <CameraView
                style={{ flex: 1 }}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ["ean13", "ean8", "upc_a", "upc_e"] }}
                onBarcodeScanned={busy ? undefined : ({ data }) => lookup(data)}
              />
              <Pressable onPress={() => setScan(false)} style={styles.camClose}>
                <Text style={styles.camCloseText}>Stoppen</Text>
              </Pressable>
            </View>
          ) : (
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable onPress={startScan} style={styles.scanBtn} testID="shop-swap-scan">
                <Icon name="barcode-scan" size={20} color={colors.onBrandPrimary} />
                <Text style={styles.scanText}>Scan barcode</Text>
              </Pressable>
              <View style={[styles.search, { flex: 1 }]}>
                <TextInput
                  placeholder="Cijfers barcode"
                  placeholderTextColor={colors.muted}
                  value={code}
                  onChangeText={setCode}
                  keyboardType="number-pad"
                  onSubmitEditing={() => lookup(code)}
                  style={styles.input}
                />
                {code.length >= 8 ? (
                  <Pressable onPress={() => lookup(code)} hitSlop={8}>
                    <Icon name="arrow-right-circle" size={22} color={colors.brandPrimary} />
                  </Pressable>
                ) : null}
              </View>
            </View>
          )}
          {busy ? <ActivityIndicator color={colors.brandPrimary} /> : null}
          {msg ? <Text style={styles.msg}>{msg}</Text> : null}

          <View style={styles.search}>
            <Icon name="magnify" size={20} color={colors.muted} />
            <TextInput placeholder="Zoek in alle producten" placeholderTextColor={colors.muted} value={q} onChangeText={setQ} style={styles.input} />
          </View>
          {searching ? (
            <View style={{ flexDirection: "row", gap: 6 }}>
              {[false, true].map((h) => (
                <Pressable key={String(h)} onPress={() => setHere(h)} style={[styles.chip, here === h && { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary }]}>
                  <Text style={[styles.meta, { fontFamily: fonts.semibold, color: here === h ? colors.onBrandPrimary : colors.onSurface }]}>
                    {h ? `Alleen ${SHORT[store] ?? store}` : "Alle winkels"}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 4 }}>
            {searching ? (
              // Eerst wat in deze winkel ligt, daarna de andere winkels
              [...(search.data?.products ?? [])]
                .sort((a, b) => Number(b.source === store) - Number(a.source === store))
                .map((p) => <Row key={p.id} p={p as AltProduct} />)
            ) : alts.isLoading ? (
              <Text style={styles.meta}>Voorstellen zoeken…</Text>
            ) : (
              groups.map((g) =>
                g.products.length ? (
                  <View key={g.store} style={{ gap: 4, marginBottom: 8 }}>
                    <Text style={styles.groupHead}>{g.store === store ? `Hier bij ${g.store}` : `Bij ${g.store}`}</Text>
                    {g.products.map((p) => <Row key={p.id} p={p} />)}
                  </View>
                ) : null,
              )
            )}
            {!searching && alts.data && !groups.some((g) => g.products.length) ? (
              <Text style={styles.meta}>Geen voorstellen gevonden. Scan de barcode of zoek hierboven zelf.</Text>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, gap: 10, maxHeight: "92%" },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  title: { flex: 1, fontSize: 18, fontFamily: fonts.bold, color: colors.onSurface },
  search: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.surfaceSecondary, borderRadius: 12, paddingHorizontal: 12, minHeight: 44 },
  input: { flex: 1, fontSize: 15, fontFamily: fonts.regular, color: colors.onSurface, paddingVertical: 10 },
  scanBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.brandPrimary, borderRadius: 12, paddingHorizontal: 12, minHeight: 44 },
  scanText: { fontSize: 14, fontFamily: fonts.semibold, color: colors.onBrandPrimary },
  camBox: { height: 260, borderRadius: 14, overflow: "hidden", backgroundColor: "#000" },
  camClose: { position: "absolute", bottom: 10, alignSelf: "center", backgroundColor: "rgba(0,0,0,0.6)", borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8 },
  camCloseText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 14 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: colors.border },
  msg: { fontSize: 13, fontFamily: fonts.semibold, color: colors.muted },
  groupHead: { fontSize: 13, fontFamily: fonts.bold, color: colors.muted, marginTop: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, padding: 8, borderRadius: 12, backgroundColor: colors.surfaceSecondary },
  img: { width: 44, height: 44, borderRadius: 8, backgroundColor: "#fff" },
  name: { fontSize: 14, fontFamily: fonts.semibold, color: colors.onSurface },
  meta: { fontSize: 12, fontFamily: fonts.regular, color: colors.muted },
  price: { fontSize: 14, fontFamily: fonts.bold, color: colors.onSurface },
}));

// Op de productpagina: zelf de barcode koppelen (scannen of typen); een beheerder keurt het goed
export function BarcodeLink({ productId, current }: { productId: string; current?: string | null }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [scan, setScan] = useState(false);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [perm, requestPerm] = useCameraPermissions();
  const send = async (raw: string) => {
    const ean = raw.replace(/\D/g, "");
    setScan(false);
    if (ean.length < 8) {
      setMsg("Die barcode is te kort. Typ alle cijfers onder de streepjes.");
      return;
    }
    try {
      const r = await api<{ status: string }>(`/products/${productId}/barcode`, { method: "POST", body: { barcode: ean } });
      setMsg(r.status === "known" ? "Deze barcode staat al bij dit product." : "Bedankt! Een beheerder controleert de barcode en koppelt hem dan.");
      setCode("");
    } catch (e: any) {
      setMsg(e?.message ?? "Dat lukte niet");
    }
  };
  const startScan = async () => {
    setMsg(null);
    try {
      const p = perm?.granted ? perm : await requestPerm();
      if (!p?.granted) {
        setMsg("Geen toegang tot de camera. Typ de cijfers van de barcode.");
        return;
      }
      setScan(true);
    } catch {
      setMsg("Scannen lukt niet op dit apparaat. Typ de cijfers van de barcode.");
    }
  };
  return (
    <>
      <Pressable onPress={() => setOpen(true)} style={{ flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start" }} testID="barcode-link">
        <Icon name="barcode" size={18} color={colors.brandPrimary} />
        <Text style={[styles.meta, { color: colors.brandPrimary, fontFamily: fonts.semibold }]}>
          {current ? `Barcode ${current} · klopt niet?` : "Barcode koppelen"}
        </Text>
      </Pressable>
      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.head}>
              <Text style={styles.title}>Barcode koppelen</Text>
              <Pressable onPress={() => { setOpen(false); setScan(false); setMsg(null); }} hitSlop={8}>
                <Icon name="close" size={22} color={colors.onSurface} />
              </Pressable>
            </View>
            <Text style={styles.meta}>Scan de barcode op de verpakking. Een beheerder controleert hem voordat hij gekoppeld wordt.</Text>
            {scan ? (
              <View style={styles.camBox}>
                <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ["ean13", "ean8", "upc_a", "upc_e"] }}
                  onBarcodeScanned={({ data }) => send(data)} />
                <Pressable onPress={() => setScan(false)} style={styles.camClose}>
                  <Text style={styles.camCloseText}>Stoppen</Text>
                </Pressable>
              </View>
            ) : (
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Pressable onPress={startScan} style={styles.scanBtn}>
                  <Icon name="barcode-scan" size={20} color={colors.onBrandPrimary} />
                  <Text style={styles.scanText}>Scan barcode</Text>
                </Pressable>
                <View style={[styles.search, { flex: 1 }]}>
                  <TextInput placeholder="Cijfers barcode" placeholderTextColor={colors.muted} value={code} onChangeText={setCode}
                    keyboardType="number-pad" onSubmitEditing={() => send(code)} style={styles.input} />
                  {code.length >= 8 ? (
                    <Pressable onPress={() => send(code)} hitSlop={8}>
                      <Icon name="arrow-right-circle" size={22} color={colors.brandPrimary} />
                    </Pressable>
                  ) : null}
                </View>
              </View>
            )}
            {msg ? <Text style={styles.msg}>{msg}</Text> : null}
          </View>
        </View>
      </Modal>
    </>
  );
}
