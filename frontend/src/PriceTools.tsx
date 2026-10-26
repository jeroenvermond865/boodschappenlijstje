import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
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

export function PriceHistory({ productId }: { productId: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const premium = usePremium();
  const { data } = useQuery({
    queryKey: ["price-history", productId],
    queryFn: () => api<History>(`/products/${productId}/price-history`),
    enabled: premium,
  });
  if (!premium) return <PremiumLock title="Prijsgeschiedenis" text="Zie hoe de prijs zich ontwikkelt, zodat je weet of een aanbieding echt goed is." />;
  if (!data) return null;
  const pts = data.points.slice(-24);
  const max = Math.max(...pts.map((x) => x.p), 0.01);
  return (
    <View style={styles.card} testID="price-history">
      <View style={styles.head}>
        <Icon name="chart-line" size={18} color={colors.brandPrimary} />
        <Text style={styles.title}>Prijsgeschiedenis</Text>
      </View>
      {pts.length < 2 ? (
        <Text style={styles.text}>
          {data.since
            ? `We houden de prijs bij sinds ${nlDate(data.since)}. Zodra de prijs verandert, zie je hier het verloop.`
            : "We gaan de prijs van dit product bijhouden. Over een tijdje zie je hier het verloop."}
        </Text>
      ) : (
        <>
          <View style={styles.chart}>
            {pts.map((x, i) => (
              <View key={i} style={styles.barWrap}>
                <View style={[styles.bar, { height: `${Math.max(8, (x.pay / max) * 100)}%`, backgroundColor: x.a ? colors.warning : colors.brandPrimary }]} />
              </View>
            ))}
          </View>
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
          <Text style={styles.small}>Oranje is een aanbieding. Bijgehouden sinds {nlDate(data.since!)}.</Text>
        </>
      )}
    </View>
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
  axis: { flexDirection: "row", justifyContent: "space-between" },
  stats: { flexDirection: "row", gap: 8, marginTop: 4 },
  statValue: { fontSize: 15, fontFamily: fonts.semibold, color: colors.onSurface },
  check: { flexDirection: "row", alignItems: "center", gap: 10 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, minWidth: 80, fontSize: 15, fontFamily: fonts.regular, color: colors.onSurface },
  btn: { flex: 1, alignItems: "center", paddingVertical: 11, borderRadius: 12 },
  btnGhost: { borderWidth: 1, borderColor: colors.border },
  btnText: { fontSize: 14, fontFamily: fonts.semibold },
}));
