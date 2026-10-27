// Voorraadkast snel vullen: wat de meeste mensen al in huis hebben, met per stuk het product dat de app erbij kiest.
// Het meeste staat al aangevinkt; tik op een product om een ander te kiezen, net als bij gerechten.
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import Image from "@/src/components/SafeImage";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import Modal from "@/src/components/Modal";
import { Button, Icon } from "@/src/components/ui";
import { api } from "@/src/api";
import type { Product } from "@/src/ProductBrowser";
import { euro, fetchProducts, useDebounced } from "@/src/search";
import { useToast } from "@/src/toast";
import SearchSuggestions from "@/src/SearchSuggestions";
import { fonts, makeStyles, useTheme } from "@/src/theme";

type Suggestion = { name: string; group: string; default: boolean; users: number; product: Product | null };
type AltProduct = Product & { note?: string | null; offer?: boolean };

export function PantrySuggestions({ onDone }: { onDone?: () => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const toast = useToast();
  const qc = useQueryClient();
  // Opnieuw voorstellen: wat je al zag laten we weg, zo krijg je steeds andere dingen
  const [seen, setSeen] = useState<string[]>([]);
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["pantry-suggestions", seen.join("|")],
    queryFn: () => api<{ store: string; items: Suggestion[]; more: boolean }>(`/pantry/suggestions?skip=${encodeURIComponent(seen.join("|"))}`),
    placeholderData: (prev) => prev,
  });
  const again = () => setSeen((cur) => [...cur, ...(data?.items ?? []).map((i) => i.name)]);
  const [on, setOn] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<Record<string, Product>>({});
  const [swap, setSwap] = useState<Suggestion | null>(null);
  // Zelf zoeken (bijv. "dreft"): wat je kiest komt bovenaan, al aangevinkt
  const [extra, setExtra] = useState<Suggestion[]>([]);
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const found = useQuery({
    queryKey: ["products", "search", "pantry-sug", dq.trim()],
    queryFn: () => fetchProducts({ q: dq, limit: 8 }),
    enabled: dq.trim().length > 1,
    placeholderData: (prev) => prev,
  });
  const addFound = (p: Product) => {
    const t = q.trim();
    let name = t ? t.charAt(0).toUpperCase() + t.slice(1) : p.name;
    if (extra.some((x) => x.name === name)) name = p.name;
    setExtra((cur) => [{ name, group: "Zelf gezocht", default: true, users: 0, product: p }, ...cur.filter((x) => x.name !== name)]);
    setOn((cur) => new Set(cur).add(name));
    setQ("");
  };
  useEffect(() => {
    if (data) setOn((cur) => new Set([...extra.map((x) => x.name).filter((n) => cur.has(n)), ...data.items.filter((i) => i.default).map((i) => i.name)]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
  const all = [...extra, ...(data?.items ?? [])];

  const groups = useMemo(() => {
    const out: { group: string; items: Suggestion[] }[] = [];
    for (const it of [...extra, ...(data?.items ?? [])]) {
      const g = out.find((x) => x.group === it.group) ?? out[out.push({ group: it.group, items: [] }) - 1];
      g.items.push(it);
    }
    return out;
  }, [data, extra]);

  const save = useMutation({
    mutationFn: () =>
      api<{ added: number }>("/pantry/bulk", {
        method: "POST",
        body: {
          items: all
            .filter((i) => on.has(i.name))
            .map((i) => ({ name: i.name, qty: 100, unit: "%", product_id: (picked[i.name] ?? i.product)?.id ?? null })),
        },
      }),
    onSuccess: (r) => {
      toast.show(`${r.added} ${r.added === 1 ? "product staat" : "producten staan"} nu in je voorraadkast`, "success");
      qc.invalidateQueries({ queryKey: ["pantry"] });
      qc.invalidateQueries({ queryKey: ["pantry-suggestions"] });
      qc.invalidateQueries({ queryKey: ["shopping"] });
      setExtra([]);
      onDone?.();
    },
    onError: (e: any) => toast.show(e?.message ?? "Mislukt", "error"),
  });

  const toggle = (n: string) =>
    setOn((cur) => {
      const next = new Set(cur);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });

  const search = (
    <View style={{ gap: 6 }}>
      <View style={styles.searchBox}>
        <Icon name="magnify" size={20} color={colors.muted} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Zoek zelf een product, bijv. dreft"
          placeholderTextColor={colors.muted}
          style={styles.searchInput}
          testID="pantry-sug-search"
        />
        {q ? (
          <Pressable onPress={() => setQ("")} hitSlop={8}>
            <Icon name="close-circle" size={18} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>
      <SearchSuggestions q={q} onPick={setQ} />
      {dq.trim().length > 1 && q.trim().length > 1
        ? (found.data?.products ?? []).map((p) => (
            <Pressable key={p.id} onPress={() => addFound(p)} style={styles.row} testID={`pantry-sug-found-${p.id}`}>
              <Icon name="plus-circle-outline" size={22} color={colors.brandPrimary} />
              {p.image ? <Image source={{ uri: p.image }} style={styles.img} resizeMode="contain" /> : <View style={styles.img} />}
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>{p.name}</Text>
                <Text style={styles.small} numberOfLines={1}>{[p.source, p.unit].filter(Boolean).join(" · ")}</Text>
              </View>
              <Text style={styles.price}>{p.price > 0 ? euro(p.price) : ""}</Text>
            </Pressable>
          ))
        : null}
    </View>
  );

  if (isLoading) return <ActivityIndicator color={colors.brandPrimary} />;
  if (!all.length)
    return (
      <View style={{ gap: 8 }}>
        {search}
        <Text style={styles.muted}>{seen.length ? "Meer voorstellen hebben we niet." : "Alles wat we zouden voorstellen staat al in je voorraadkast."}</Text>
        {seen.length ? (
          <Pressable onPress={() => setSeen([])} hitSlop={8}>
            <Text style={styles.link}>Opnieuw beginnen</Text>
          </Pressable>
        ) : null}
      </View>
    );

  return (
    <View style={{ gap: 12 }}>
      {search}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={styles.muted}>{on.size} aangevinkt{data?.store ? ` · producten van ${data.store}` : ""}</Text>
        <Pressable onPress={() => setOn(on.size === all.length ? new Set() : new Set(all.map((i) => i.name)))} hitSlop={8}>
          <Text style={styles.link}>{on.size === all.length ? "Alles uit" : "Alles aan"}</Text>
        </Pressable>
      </View>
      {groups.map((g) => (
        <View key={g.group} style={{ gap: 6 }}>
          <Text style={styles.group}>{g.group}</Text>
          {g.items.map((it) => {
            const p = picked[it.name] ?? it.product;
            const active = on.has(it.name);
            return (
              <View key={it.name} style={[styles.row, active && styles.rowOn]} testID={`pantry-sug-${it.name}`}>
                <Pressable onPress={() => toggle(it.name)} hitSlop={6} style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
                  <Icon name={active ? "checkbox-marked" : "checkbox-blank-outline"} size={22} color={active ? colors.brandPrimary : colors.muted} />
                  {p?.image ? <Image source={{ uri: p.image }} style={styles.img} resizeMode="contain" /> : <View style={styles.img} />}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{it.name}</Text>
                    <Text style={styles.small} numberOfLines={1}>
                      {p ? `${p.name}${p.price > 0 ? ` · ${euro(p.price)}` : ""}` : "Geen product gevonden"}
                      {it.users >= 3 ? ` · ${it.users} gebruikers hebben dit` : ""}
                    </Text>
                  </View>
                </Pressable>
                <Pressable onPress={() => setSwap(it)} hitSlop={8} style={styles.swapBtn} testID={`pantry-sug-swap-${it.name}`}>
                  <Icon name="swap-horizontal" size={18} color={colors.brandPrimary} />
                </Pressable>
              </View>
            );
          })}
        </View>
      ))}
      {data?.more ? (
        <Button label="Andere voorstellen" icon="refresh" variant="secondary" loading={isFetching} onPress={again} testID="pantry-sug-more" />
      ) : null}
      <Button
        label={on.size ? `Zet ${on.size} in je voorraadkast` : "Vink aan wat je in huis hebt"}
        icon="fridge-outline"
        disabled={!on.size}
        loading={save.isPending}
        onPress={() => save.mutate()}
        testID="pantry-sug-save"
      />
      <PickSheet
        item={swap}
        current={swap ? (picked[swap.name] ?? swap.product) : null}
        onClose={() => setSwap(null)}
        onPick={(p) => {
          if (!swap) return;
          if (swap.group === "Zelf gezocht") setExtra((cur) => cur.map((x) => (x.name === swap.name ? { ...x, product: p } : x)));
          else setPicked((cur) => ({ ...cur, [swap.name]: p }));
          setOn((cur) => new Set(cur).add(swap.name));
          setSwap(null);
        }}
      />
    </View>
  );
}

function PickSheet({ item, current, onClose, onPick }: { item: Suggestion | null; current: Product | null; onClose: () => void; onPick: (p: Product) => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const found = useQuery({
    queryKey: ["products", "search", "pantry-pick", dq.trim()],
    queryFn: () => fetchProducts({ q: dq, limit: 30 }),
    enabled: !!item && dq.trim().length > 1,
    placeholderData: (prev) => prev,
  });
  const searching = q.trim().length > 1;
  const alts = useQuery({
    queryKey: ["alternatives", current?.id ?? "", item?.name ?? ""],
    queryFn: () =>
      api<{ groups: { store: string; same_store: boolean; products: AltProduct[] }[] }>(
        `/alternatives?name=${encodeURIComponent(item!.name)}&product_id=${encodeURIComponent(current?.id ?? "")}`,
      ),
    enabled: !!item,
    staleTime: 10 * 60 * 1000,
  });
  return (
    <Modal visible={!!item} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]} onPress={() => {}}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Text style={[styles.title, { flex: 1 }]}>{item?.name}</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Icon name="close" size={24} color={colors.onSurface} />
            </Pressable>
          </View>
          {current ? (
            <View style={[styles.row, styles.rowOn]}>
              {current.image ? <Image source={{ uri: current.image }} style={styles.img} resizeMode="contain" /> : <View style={styles.img} />}
              <View style={{ flex: 1 }}>
                <Text style={styles.small}>Nu gekozen</Text>
                <Text style={styles.name} numberOfLines={2}>{current.name}</Text>
              </View>
              <Text style={styles.price}>{current.price > 0 ? euro(current.price) : ""}</Text>
            </View>
          ) : null}
          <View style={styles.searchBox}>
            <Icon name="magnify" size={20} color={colors.muted} />
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="Of zoek een ander product"
              placeholderTextColor={colors.muted}
              style={styles.searchInput}
              testID="pantry-pick-search"
            />
          </View>
          <SearchSuggestions q={q} onPick={setQ} />
          <ScrollView contentContainerStyle={{ gap: 6 }} keyboardShouldPersistTaps="handled">
            {searching ? (
              (found.data?.products ?? []).map((p) => (
                <Pressable key={p.id} onPress={() => { setQ(""); onPick(p); }} style={styles.row}>
                  {p.image ? <Image source={{ uri: p.image }} style={styles.img} resizeMode="contain" /> : <View style={styles.img} />}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name} numberOfLines={2}>{p.name}</Text>
                    <Text style={styles.small} numberOfLines={1}>{[p.source, p.unit].filter(Boolean).join(" · ")}</Text>
                  </View>
                  <Text style={styles.price}>{p.price > 0 ? euro(p.price) : ""}</Text>
                </Pressable>
              ))
            ) : alts.isLoading ? (
              <ActivityIndicator color={colors.brandPrimary} />
            ) : (
              (alts.data?.groups ?? []).map((g) =>
                g.products.length ? (
                  <View key={g.store} style={{ gap: 6, marginBottom: 6 }}>
                    <Text style={styles.group}>{g.same_store ? `Ook bij ${g.store}` : `Bij ${g.store}`}</Text>
                    {g.products.map((p) => (
                      <Pressable key={p.id} onPress={() => onPick(p)} style={styles.row}>
                        {p.image ? <Image source={{ uri: p.image }} style={styles.img} resizeMode="contain" /> : <View style={styles.img} />}
                        <View style={{ flex: 1 }}>
                          <Text style={styles.name} numberOfLines={2}>{p.name}</Text>
                          <Text style={styles.small} numberOfLines={1}>
                            {p.unit}
                            {p.note ? ` · ${p.note}` : ""}
                          </Text>
                        </View>
                        <Text style={styles.price}>{p.price > 0 ? euro(p.price) : ""}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null,
              )
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  searchBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.surfaceTertiary, borderRadius: 12, paddingHorizontal: 12, minHeight: 44 },
  searchInput: { flex: 1, fontSize: 15, fontFamily: fonts.regular, color: colors.onSurface, paddingVertical: 10 },
  muted: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted },
  link: { fontSize: 13, fontFamily: fonts.semibold, color: colors.brandPrimary },
  group: { fontSize: 13, fontFamily: fonts.bold, color: colors.onSurfaceSecondary, marginTop: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, padding: 8, borderRadius: 12, borderWidth: 1, borderColor: colors.border },
  rowOn: { borderColor: colors.brandPrimary, backgroundColor: colors.surfaceSecondary },
  img: { width: 40, height: 40, borderRadius: 8, backgroundColor: "#fff" },
  name: { fontSize: 14, fontFamily: fonts.semibold, color: colors.onSurface },
  small: { fontSize: 12, fontFamily: fonts.regular, color: colors.muted },
  price: { fontSize: 14, fontFamily: fonts.bold, color: colors.onSurface },
  swapBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, gap: 10, maxHeight: "92%" },
  title: { fontSize: 18, fontFamily: fonts.bold, color: colors.onSurface },
}));
