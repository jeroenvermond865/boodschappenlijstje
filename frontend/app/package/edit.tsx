import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import Image from "@/src/components/SafeImage";
import Modal from "@/src/components/Modal";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button, Field, Icon, Stepper } from "@/src/components/ui";
import { api } from "@/src/api";
import { ProductBrowser, type Product } from "@/src/ProductBrowser";
import { goBack } from "@/src/nav";
import { useToast } from "@/src/toast";
import { fonts, makeStyles, useTheme } from "@/src/theme";

export type PackageItem = { name: string; unit: string; qty: number; aisle: string; product_id?: string | null; store?: string | null; image?: string | null };
export type Package = { id: string; name: string; items: PackageItem[] };

// Een pakket: vaste spullen die je elke keer nodig hebt. Je zet het in één keer bij de algemene boodschappen van een activiteit.
export default function PackageEditScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [name, setName] = useState("");
  const [items, setItems] = useState<PackageItem[]>([]);
  const [picking, setPicking] = useState(false);

  const { data } = useQuery({ queryKey: ["package", id], queryFn: () => api<Package>(`/packages/${id}`), enabled: !!id });
  useEffect(() => {
    if (data) {
      setName(data.name);
      setItems(data.items);
    }
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      api<Package>(id ? `/packages/${id}` : "/packages", {
        method: id ? "PUT" : "POST",
        body: { name: name.trim() || "Pakket", items: items.map(({ image, ...i }) => i) },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["packages"] });
      toast.show("Pakket opgeslagen", "success");
      goBack("/dishes?tab=packages");
    },
    onError: (e: any) => toast.show(e?.message ?? "Opslaan mislukt", "error"),
  });
  const remove = useMutation({
    mutationFn: () => api(`/packages/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["packages"] });
      toast.show("Pakket verwijderd", "info");
      goBack("/dishes?tab=packages");
    },
  });

  const add = (p: Product) =>
    setItems((xs) =>
      xs.some((x) => x.product_id === p.id)
        ? xs.map((x) => (x.product_id === p.id ? { ...x, qty: x.qty + 1 } : x))
        : [...xs, { name: p.name, unit: p.unit, qty: 1, aisle: p.aisle, product_id: p.id, store: p.source ?? null, image: p.image }],
    );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable testID="back-button" onPress={() => goBack("/dishes?tab=packages")} hitSlop={10} style={styles.headerBtn}>
          <Icon name="close" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>{id ? "Pakket aanpassen" : "Nieuw pakket"}</Text>
        <View style={styles.headerBtn} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: insets.bottom + 120 }}>
        <Field label="Naam" testID="package-name" value={name} onChangeText={setName} placeholder="Bijv. Schoonmaak, EHBO, Keukenspullen" />
        <Text style={styles.hint}>Zet dit pakket straks bij de algemene boodschappen van een activiteit, dan komt alles in één keer op de lijst.</Text>
        <Text style={styles.section}>Spullen ({items.length})</Text>
        {items.map((it, i) => (
          <View key={`${it.product_id ?? it.name}-${i}`} style={styles.row}>
            {it.image ? <Image source={{ uri: it.image }} style={styles.img} resizeMode="contain" /> : <View style={styles.img} />}
            <View style={{ flex: 1 }}>
              <Text style={styles.name} numberOfLines={2}>{it.name}</Text>
              <Text style={styles.meta}>
                {it.store ? `${it.store} · ` : ""}per {it.unit}
              </Text>
            </View>
            <Stepper value={it.qty} onChange={(v) => setItems((xs) => xs.map((x, k) => (k === i ? { ...x, qty: v } : x)))} min={1} max={999} />
            <Pressable onPress={() => setItems((xs) => xs.filter((_, k) => k !== i))} hitSlop={8}>
              <Icon name="close-circle" size={22} color={colors.muted} />
            </Pressable>
          </View>
        ))}
        <Pressable testID="package-add-product" onPress={() => setPicking(true)} style={styles.addRow}>
          <Icon name="plus-circle-outline" size={22} color={colors.brandPrimary} />
          <Text style={styles.addText}>Product toevoegen</Text>
        </Pressable>
        {id ? (
          <Pressable onPress={() => remove.mutate()} style={styles.addRow}>
            <Icon name="trash-can-outline" size={20} color={colors.error} />
            <Text style={[styles.addText, { color: colors.error }]}>Pakket verwijderen</Text>
          </Pressable>
        ) : null}
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <Button label="Opslaan" onPress={() => save.mutate()} loading={save.isPending} testID="package-save" />
      </View>

      <Modal visible={picking} animationType="fade" transparent onRequestClose={() => setPicking(false)}>
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 8 }]}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Kies producten</Text>
              <Pressable onPress={() => setPicking(false)} hitSlop={8}>
                <Text style={[styles.sheetTitle, { color: colors.brandPrimary, fontSize: 15 }]}>Klaar</Text>
              </Pressable>
            </View>
            <ProductBrowser onPick={add} bottomPadding={16} pickedIds={items.map((x) => x.product_id ?? "")} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.divider },
  headerBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 17, fontFamily: fonts.semibold, color: colors.onSurface },
  hint: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted },
  section: { fontSize: 16, fontFamily: fonts.bold, color: colors.onSurface, marginTop: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: colors.border },
  img: { width: 40, height: 40, borderRadius: 8, backgroundColor: "#fff" },
  name: { fontSize: 14, fontFamily: fonts.semibold, color: colors.onSurface },
  meta: { fontSize: 12, fontFamily: fonts.regular, color: colors.muted, marginTop: 1 },
  addRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8 },
  addText: { fontSize: 15, fontFamily: fonts.semibold, color: colors.brandPrimary },
  footer: { paddingHorizontal: 16, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.divider, backgroundColor: colors.surface },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center" },
  sheet: { height: "92%", backgroundColor: colors.surface, borderRadius: 20, width: "92%", maxWidth: 560, alignSelf: "center", marginVertical: "auto", maxHeight: "92%", paddingTop: 16, gap: 8 },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16 },
  sheetTitle: { fontSize: 18, fontFamily: fonts.bold, color: colors.onSurface },
}));
