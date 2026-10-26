import { useRef, useState } from "react";
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { Icon } from "@/src/components/ui";
import { api } from "@/src/api";
import { PremiumLock, usePremium } from "@/src/premium";
import { euro } from "@/src/search";
import { useToast } from "@/src/toast";
import { fonts, makeStyles, useTheme } from "@/src/theme";

type Point = { d: string; p: number; a: number | null; pay: number };
type History = { points: Point[]; since: string | null; now?: number; regular?: number; lowest?: number; highest?: number; is_lowest?: boolean };

const nlDate = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("nl-NL", { day: "numeric", month: "short" });

// Prijs per dag, week of maand uit de prijswijzigingen (een prijs geldt tot de volgende wijziging)
type Range = "week" | "maand" | "halfjaar" | "jaar" | "5jaar" | "alles";
const RANGES: { key: Range; label: string; days: number | null; step: "dag" | "week" | "maand" }[] = [
  { key: "week", label: "Week", days: 7, step: "dag" },
  { key: "maand", label: "Maand", days: 31, step: "dag" },
  { key: "halfjaar", label: "Halfjaar", days: 183, step: "week" },
  { key: "jaar", label: "Jaar", days: 366, step: "week" },
  { key: "5jaar", label: "5 jaar", days: 5 * 366, step: "maand" },
  { key: "alles", label: "Alles", days: null, step: "maand" },
];
const iso = (t: Date) => t.toISOString().slice(0, 10);

function series(points: Point[], range: Range): Point[] {
  if (!points.length) return [];
  const r = RANGES.find((x) => x.key === range)!;
  const today = new Date();
  const first = new Date(points[0].d + "T12:00:00");
  let start = r.days ? new Date(today.getTime() - (r.days - 1) * 86400000) : first;
  if (start < first) start = first;
  const out: Point[] = [];
  let k = 0;
  let cur: Point | null = null;
  let bucket: Point | null = null;
  let key = "";
  for (let t = new Date(start); t <= today; t = new Date(t.getTime() + 86400000)) {
    const d = iso(t);
    while (k < points.length && points[k].d <= d) cur = points[k++];
    if (!cur) continue;
    const bk = r.step === "dag" ? d : r.step === "week" ? iso(new Date(t.getTime() - ((t.getDay() + 6) % 7) * 86400000)) : d.slice(0, 7);
    if (bk !== key) {
      if (bucket) out.push(bucket);
      key = bk;
      bucket = { d, p: cur.p, a: cur.a, pay: cur.pay };
    } else if (bucket) {
      // Week of maand: de laagste prijs die je kon betalen, en of er een actie was
      bucket.pay = Math.min(bucket.pay, cur.pay);
      bucket.p = Math.max(bucket.p, cur.p);
      if (cur.a) bucket.a = cur.a;
    }
  }
  if (bucket) out.push(bucket);
  return out;
}

function Bars({ pts, height, barWidth, labels }: { pts: Point[]; height: number; barWidth?: number; labels?: boolean }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const max = Math.max(...pts.map((x) => x.p), 0.01);
  return (
    <View style={[styles.chart, { height: height + (labels ? 34 : 0) }]}>
      {pts.map((x, i) => (
        <View key={i} style={[styles.barWrap, barWidth ? { flex: 0, width: barWidth } : null]}>
          {labels && (x.a || i === 0 || pts[i - 1].pay !== x.pay) ? <Text style={styles.barPrice}>{euro(x.pay).replace("€ ", "")}</Text> : null}
          <View style={{ height, justifyContent: "flex-end" }}>
            {/* Bij een actie: de gewone prijs als lichte balk erachter, zodat je ziet dat de sprong door de actie komt */}
            {x.a ? <View style={[styles.ghost, { height: `${Math.max(8, (x.p / max) * 100)}%`, borderColor: colors.brandPrimary }]} /> : null}
            <View style={[styles.bar, { height: `${Math.max(8, (x.pay / max) * 100)}%`, backgroundColor: x.a ? colors.warning : colors.brandPrimary }]} />
          </View>
          {labels ? <Text style={styles.barDate} numberOfLines={1}>{i % 3 === 0 ? nlDate(x.d) : ""}</Text> : null}
        </View>
      ))}
    </View>
  );
}

export function PriceHistory({ productId }: { productId: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const premium = usePremium();
  const [big, setBig] = useState(false);
  const { data } = useQuery({
    queryKey: ["price-history", productId],
    queryFn: () => api<History>(`/products/${productId}/price-history`),
    enabled: premium,
  });
  if (!premium) return <PremiumLock title="Prijsgeschiedenis" text="Zie hoe de prijs zich ontwikkelt, zodat je weet of een aanbieding echt goed is." />;
  if (!data) return null;
  const pts = data.points.slice(-24);
  const hasPromo = data.points.some((x) => x.a);
  return (
    <Pressable style={styles.card} testID="price-history" onPress={() => pts.length >= 2 && setBig(true)} disabled={pts.length < 2}>
      <View style={styles.head}>
        <Icon name="chart-line" size={18} color={colors.brandPrimary} />
        <Text style={[styles.title, { flex: 1 }]}>Prijsgeschiedenis</Text>
        {pts.length >= 2 ? <Icon name="arrow-expand" size={18} color={colors.muted} /> : null}
      </View>
      {pts.length < 2 ? (
        <Text style={styles.text}>
          {data.since
            ? `We houden de prijs bij sinds ${nlDate(data.since)}. Zodra de prijs verandert, zie je hier het verloop.`
            : "We gaan de prijs van dit product bijhouden. Over een tijdje zie je hier het verloop."}
        </Text>
      ) : (
        <>
          <Bars pts={pts} height={90} />
          <View style={styles.axis}>
            <Text style={styles.small}>{nlDate(pts[0].d)}</Text>
            <Text style={styles.small}>{nlDate(pts[pts.length - 1].d)}</Text>
          </View>
          <View style={styles.stats}>
            <Stat label="Normaal" value={data.regular} />
            <Stat label="Laagste" value={data.lowest} />
            <Stat label="Hoogste" value={data.highest} />
          </View>
          {data.is_lowest ? <Text style={[styles.text, { color: colors.success, fontFamily: fonts.semibold }]}>Nu de laagste prijs die we gezien hebben.</Text> : null}
          <Text style={styles.small}>
            Oranje is een aanbieding{hasPromo ? "; de lichte balk erachter is de gewone prijs. Gaat de prijs na oranje omhoog, dan is de actie voorbij" : ""}. Tik om groot te bekijken. Bijgehouden sinds {nlDate(data.since!)}.
          </Text>
        </>
      )}
      <HistoryModal open={big} onClose={() => setBig(false)} data={data} />
    </Pressable>
  );
}

function HistoryModal({ open, onClose, data }: { open: boolean; onClose: () => void; data: History }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [range, setRange] = useState<Range>("maand");
  const [zoom, setZoom] = useState(1);
  const scroll = useRef<ScrollView>(null);
  const pts = series(data.points, range);
  const width = Math.round(22 * zoom);
  return (
    <Modal visible={open} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.full, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.head}>
          <Text style={[styles.title, { flex: 1, fontSize: 20 }]}>Prijsverloop</Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Icon name="close" size={26} color={colors.onSurface} />
          </Pressable>
        </View>
        <View style={styles.rangeRow}>
          {RANGES.map((r) => (
            <Pressable key={r.key} onPress={() => setRange(r.key)} style={[styles.rangeChip, range === r.key && { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary }]}>
              <Text style={[styles.small, { color: range === r.key ? colors.onBrandPrimary : colors.onSurface, fontFamily: fonts.semibold }]}>{r.label}</Text>
            </Pressable>
          ))}
        </View>
        {pts.length ? (
          <ScrollView horizontal ref={scroll} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })} contentContainerStyle={{ paddingVertical: 8 }}>
            <Bars pts={pts} height={260} barWidth={width} labels />
          </ScrollView>
        ) : (
          <Text style={styles.text}>Voor deze periode hebben we nog geen prijzen.</Text>
        )}
        <View style={styles.zoomRow}>
          <Text style={[styles.small, { flex: 1 }]}>
            {RANGES.find((r) => r.key === range)!.step === "dag" ? "Per dag" : RANGES.find((r) => r.key === range)!.step === "week" ? "Per week (laagste prijs)" : "Per maand (laagste prijs)"}
          </Text>
          <Pressable onPress={() => setZoom((z) => Math.max(0.5, z / 1.5))} hitSlop={8} style={styles.zoomBtn}>
            <Icon name="magnify-minus-outline" size={20} color={colors.onSurface} />
          </Pressable>
          <Pressable onPress={() => setZoom((z) => Math.min(4, z * 1.5))} hitSlop={8} style={styles.zoomBtn}>
            <Icon name="magnify-plus-outline" size={20} color={colors.onSurface} />
          </Pressable>
        </View>
        <View style={styles.legend}>
          <View style={[styles.dot, { backgroundColor: colors.brandPrimary }]} />
          <Text style={styles.small}>Gewone prijs</Text>
          <View style={[styles.dot, { backgroundColor: colors.warning }]} />
          <Text style={styles.small}>Aanbieding</Text>
          <View style={[styles.dot, { borderWidth: 1, borderColor: colors.brandPrimary }]} />
          <Text style={styles.small}>Prijs zonder actie</Text>
        </View>
        <Text style={styles.text}>
          Na een aanbieding gaat de prijs vaak flink omhoog. Dat komt doordat de actie voorbij is, niet doordat het product duurder is geworden.
          Kijk naar de groene balken voor de echte prijs.
        </Text>
        <View style={styles.stats}>
          <Stat label="Normaal" value={data.regular} />
          <Stat label="Laagste" value={data.lowest} />
          <Stat label="Hoogste" value={data.highest} />
        </View>
      </View>
    </Modal>
  );
}

function Stat({ label, value }: { label: string; value?: number }) {
  const styles = useStyles();
  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.small}>{label}</Text>
      <Text style={styles.statValue}>{value ? euro(value) : "—"}</Text>
    </View>
  );
}

type Alert = { on_promo: boolean; target: number | null } | null;

export function PriceAlertCard({ productId, price }: { productId: string; price: number }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const premium = usePremium();
  const toast = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [onPromo, setOnPromo] = useState(true);
  const [target, setTarget] = useState("");
  const { data } = useQuery({
    queryKey: ["price-alert", productId],
    queryFn: () => api<{ alert: Alert }>(`/products/${productId}/price-alert`),
    enabled: premium,
  });
  if (!premium) return <PremiumLock title="Prijsalarm" text="Krijg een mail als dit product in de aanbieding is of onder jouw prijs zakt." />;
  const alert = data?.alert;

  const open = () => {
    setOnPromo(alert ? alert.on_promo : true);
    setTarget(alert?.target ? String(alert.target).replace(".", ",") : "");
    setEditing(true);
  };
  const save = async () => {
    const t = parseFloat(target.replace(",", "."));
    try {
      await api(`/products/${productId}/price-alert`, { method: "PUT", body: { on_promo: onPromo, target: t > 0 ? t : null } });
      qc.invalidateQueries({ queryKey: ["price-alert", productId] });
      qc.invalidateQueries({ queryKey: ["price-alerts"] });
      setEditing(false);
      toast.show("Prijsalarm staat aan", "success");
    } catch (e: any) {
      toast.show(e?.message ?? "Opslaan mislukt", "error");
    }
  };
  const remove = async () => {
    await api(`/products/${productId}/price-alert`, { method: "DELETE" }).catch(() => {});
    qc.invalidateQueries({ queryKey: ["price-alert", productId] });
    qc.invalidateQueries({ queryKey: ["price-alerts"] });
    setEditing(false);
    toast.show("Prijsalarm uit");
  };

  if (!editing) {
    return (
      <Pressable style={styles.card} onPress={open} testID="price-alert-open">
        <View style={styles.head}>
          <Icon name={alert ? "bell-ring" : "bell-outline"} size={18} color={colors.brandPrimary} />
          <Text style={[styles.title, { flex: 1 }]}>{alert ? "Prijsalarm staat aan" : "Prijsalarm instellen"}</Text>
          <Icon name="chevron-right" size={20} color={colors.muted} />
        </View>
        <Text style={styles.text}>
          {alert
            ? [alert.on_promo ? "bij een aanbieding" : null, alert.target ? `onder ${euro(alert.target)}` : null].filter(Boolean).join(" of ").replace(/^./, (c) => c.toUpperCase()) + ". Je krijgt dan een mail."
            : "Krijg een mail als dit product in de aanbieding is of goedkoper wordt."}
        </Text>
      </Pressable>
    );
  }
  return (
    <View style={styles.card} testID="price-alert-edit">
      <View style={styles.head}>
        <Icon name="bell-ring-outline" size={18} color={colors.brandPrimary} />
        <Text style={styles.title}>Prijsalarm</Text>
      </View>
      <Pressable style={styles.check} onPress={() => setOnPromo((v) => !v)} testID="price-alert-promo">
        <Icon name={onPromo ? "checkbox-marked" : "checkbox-blank-outline"} size={22} color={onPromo ? colors.brandPrimary : colors.muted} />
        <Text style={styles.text}>Als het in de aanbieding is</Text>
      </Pressable>
      <View style={styles.check}>
        <Text style={styles.text}>Of als de prijs zakt onder €</Text>
        <TextInput
          value={target}
          onChangeText={setTarget}
          placeholder={price ? (price * 0.9).toFixed(2).replace(".", ",") : "0,00"}
          placeholderTextColor={colors.muted}
          keyboardType="decimal-pad"
          style={styles.input}
          testID="price-alert-target"
        />
      </View>
      <View style={{ flexDirection: "row", gap: 10 }}>
        {alert ? (
          <Pressable style={[styles.btn, styles.btnGhost]} onPress={remove} testID="price-alert-delete">
            <Text style={[styles.btnText, { color: colors.error }]}>Uitzetten</Text>
          </Pressable>
        ) : (
          <Pressable style={[styles.btn, styles.btnGhost]} onPress={() => setEditing(false)}>
            <Text style={[styles.btnText, { color: colors.onSurface }]}>Annuleren</Text>
          </Pressable>
        )}
        <Pressable style={[styles.btn, { backgroundColor: colors.brandPrimary }]} onPress={save} testID="price-alert-save">
          <Text style={[styles.btnText, { color: colors.onBrandPrimary }]}>Opslaan</Text>
        </Pressable>
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 14, gap: 8 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 15, fontFamily: fonts.bold, color: colors.onSurface },
  text: { fontSize: 14, lineHeight: 20, fontFamily: fonts.regular, color: colors.onSurfaceSecondary },
  small: { fontSize: 12, fontFamily: fonts.regular, color: colors.muted },
  chart: { flexDirection: "row", alignItems: "flex-end", height: 90, gap: 3, marginTop: 4 },
  barWrap: { flex: 1, height: "100%", justifyContent: "flex-end" },
  bar: { borderTopLeftRadius: 3, borderTopRightRadius: 3, minHeight: 4 },
  ghost: { position: "absolute", bottom: 0, left: 0, right: 0, borderWidth: 1, borderStyle: "dashed", borderTopLeftRadius: 3, borderTopRightRadius: 3, opacity: 0.6 },
  barPrice: { fontSize: 9, fontFamily: fonts.semibold, color: colors.muted, textAlign: "center", height: 14 },
  barDate: { fontSize: 9, fontFamily: fonts.regular, color: colors.muted, textAlign: "left", height: 14, width: 60 },
  full: { flex: 1, backgroundColor: colors.surface, paddingHorizontal: 16, gap: 12 },
  rangeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  rangeChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: colors.border },
  zoomRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  zoomBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  legend: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  dot: { width: 12, height: 12, borderRadius: 3 },
  axis: { flexDirection: "row", justifyContent: "space-between" },
  stats: { flexDirection: "row", gap: 8, marginTop: 4 },
  statValue: { fontSize: 15, fontFamily: fonts.semibold, color: colors.onSurface },
  check: { flexDirection: "row", alignItems: "center", gap: 10 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, minWidth: 80, fontSize: 15, fontFamily: fonts.regular, color: colors.onSurface },
  btn: { flex: 1, alignItems: "center", paddingVertical: 11, borderRadius: 12 },
  btnGhost: { borderWidth: 1, borderColor: colors.border },
  btnText: { fontSize: 14, fontFamily: fonts.semibold },
}));
