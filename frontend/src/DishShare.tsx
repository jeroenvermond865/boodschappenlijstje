// Een gerecht delen: een link waarmee iemand het overneemt in de app, of de boodschappen en bereiding als tekst of PDF
// (voor het aantal personen dat je kiest), net als bij de boodschappenlijst.
import { useEffect, useState } from "react";
import { Linking, Platform, Pressable, Share, Text, View } from "react-native";
import * as ExpoLinking from "expo-linking";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { useQuery } from "@tanstack/react-query";

import Modal from "@/src/components/Modal";
import { Icon, Stepper } from "@/src/components/ui";
import { api, apiBlob } from "@/src/api";
import { CATEGORY_LABELS, formatQty, type MealCategory } from "@/src/constants";
import { dishOrigin } from "@/src/dishInfo";
import { useAuth } from "@/src/auth";
import { useToast } from "@/src/toast";
import { fonts, makeStyles, useTheme } from "@/src/theme";
import type { Dish } from "@/app/(tabs)/dishes";

// Wegklikken van het deelmenu is geen fout
export const isShareCancel = (e: any) => e?.name === "AbortError" || /abort|cancel/i.test(String(e?.message ?? ""));

export type SharePeople = { adults: number; children: number; vegaAdults: number; vegaChildren: number };

type Line = { name: string; qty: string };

function amounts(dish: Dish, p: SharePeople) {
  const va = Math.min(p.vegaAdults, p.adults);
  const vc = Math.min(p.vegaChildren, p.children);
  const hasVega = dish.ingredients.some((i) => i.diet === "vega");
  const groups: { label: string; items: Line[] }[] = [
    { label: "", items: [] },
    { label: "Alleen voor de vleeseters", items: [] },
    { label: "Alleen voor de vegetariërs", items: [] },
  ];
  for (const i of dish.ingredients) {
    const [a, c, g] =
      i.diet === "meat" && (hasVega || va + vc > 0) ? [p.adults - va, p.children - vc, 1] : i.diet === "vega" ? [va, vc, 2] : [p.adults, p.children, 0];
    const q = (i.qty_adult || 0) * a + (i.qty_child || 0) * c;
    if (g && a + c === 0) continue;
    groups[g].items.push({ name: i.name, qty: q ? `${formatQty(Math.round(q * 100) / 100)} ${i.unit}` : "" });
  }
  if (groups[1].items.length || groups[2].items.length) groups[0].label = "Voor iedereen";
  return groups.filter((g) => g.items.length);
}

export function DishShareSheet({
  dish,
  campId,
  people,
  onClose,
}: {
  dish: Dish | null;
  campId?: string | null;
  people?: Partial<SharePeople>;
  onClose: () => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const toast = useToast();
  const { user } = useAuth();
  const [p, setP] = useState<SharePeople>({ adults: 2, children: 0, vegaAdults: 0, vegaChildren: 0 });
  useEffect(() => {
    if (dish)
      setP({
        adults: people?.adults ?? Math.max(1, dish.source?.servings ?? 2),
        children: people?.children ?? 0,
        vegaAdults: people?.vegaAdults ?? 0,
        vegaChildren: people?.vegaChildren ?? 0,
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dish?.id]);
  // De bereiding staat meestal al klaar (zelfde vraag als op het scherm)
  const prep = useQuery({
    queryKey: ["dish-prep", dish?.id ?? "", campId ?? ""],
    queryFn: () => api<{ steps: string[]; kind: string }>(`/dishes/${dish!.id}/preparation${campId ? `?camp_id=${campId}` : ""}`),
    enabled: !!dish,
    staleTime: 30 * 60 * 1000,
    retry: 1,
  });
  // De link alvast klaarzetten: dan opent het deelmenu meteen als je tikt (sommige browsers willen dat)
  const tok = useQuery({
    queryKey: ["dish-share-token", dish?.id ?? ""],
    queryFn: () => api<{ token: string }>(`/dishes/${dish!.id}/share`, { method: "POST" }),
    enabled: !!dish,
    staleTime: Infinity,
    retry: false,
  });
  if (!dish) return null;
  const hasVega = dish.ingredients.some((i) => i.diet === "vega");
  const origin = dishOrigin(dish, user?.id);
  const groups = amounts(dish, p);
  const steps = prep.data?.steps ?? [];
  const who = [
    `${p.adults} ${p.adults === 1 ? "volwassene" : "volwassenen"}`,
    p.children ? `${p.children} ${p.children === 1 ? "kind" : "kinderen"}` : "",
    p.vegaAdults + p.vegaChildren ? `waarvan ${p.vegaAdults + p.vegaChildren} vegetarisch` : "",
  ]
    .filter(Boolean)
    .join(", ");

  const link = async () => {
    const { token } = tok.data ?? (await api<{ token: string }>(`/dishes/${dish.id}/share`, { method: "POST" }));
    return ExpoLinking.createURL(`/dish/shared/${token}`);
  };
  const text = (url?: string) => {
    const out = [`🍽️ ${dish.name}`, origin.label, `Voor ${who}`, ""];
    out.push("WAT HEB JE NODIG");
    groups.forEach((g) => {
      if (g.label) out.push(`${g.label}:`);
      g.items.forEach((i) => out.push(`▫️ ${i.name}${i.qty ? `: ${i.qty}` : ""}`));
    });
    if (dish.pantry?.length) out.push(`Waarschijnlijk al in huis: ${dish.pantry.map((x) => x.name).join(", ")}`);
    if (steps.length) {
      out.push("", "BEREIDING");
      steps.forEach((s, k) => out.push(`${k + 1}. ${s}`));
    }
    if (url) out.push("", `Neem dit gerecht over in Slim Boodschappenlijstje: ${url}`);
    else out.push("", "Gemaakt met Slim Boodschappenlijstje");
    return out.join("\n");
  };

  const run = async (how: "link" | "whatsapp" | "mail" | "copy" | "other") => {
    onClose();
    try {
      // Bij een link kan de ander het gerecht overnemen; bij tekst sturen we de link ook mee (lukt dat niet, dan zonder)
      const url = await link().catch((e) => {
        if (how === "link") throw e;
        return undefined;
      });
      if (how === "link") {
        await Share.share({ message: `Bekijk mijn gerecht "${dish.name}" in Slim Boodschappenlijstje:\n${url}` });
        return;
      }
      const t = text(url);
      if (how === "whatsapp") await Linking.openURL(`https://wa.me/?text=${encodeURIComponent(t)}`);
      else if (how === "mail") await Linking.openURL(`mailto:?subject=${encodeURIComponent(dish.name)}&body=${encodeURIComponent(t)}`);
      else if (how === "copy") {
        await (globalThis as any).navigator.clipboard.writeText(t);
        toast.show("Gerecht gekopieerd");
      } else await Share.share({ message: t, title: dish.name });
    } catch (e: any) {
      if (isShareCancel(e)) return;
      toast.show(how === "copy" ? "Kopiëren lukt niet in deze browser" : e?.message ?? "Delen mislukt", "error");
    }
  };

  const pdf = async () => {
    onClose();
    const fname = `${dish.name.replace(/[^\w -]/g, "").replace(/ +/g, "-") || "Gerecht"}.pdf`;
    const body = {
      title: dish.name,
      subtitle: origin.label,
      chips: [`Voor ${who}`, CATEGORY_LABELS[dish.category as MealCategory] ?? ""].filter(Boolean),
      groups: groups.map((g) => ({ label: g.label, items: g.items.map((i) => ({ name: i.name, qty: i.qty })) })),
      steps,
      note: dish.pantry?.length ? `Waarschijnlijk al in huis: ${dish.pantry.map((x) => x.name).join(", ")}` : "",
    };
    try {
      if (Platform.OS === "web") {
        const blob = await apiBlob("/pdf/dish", body);
        const file = new File([blob], fname, { type: "application/pdf" });
        const nav = (globalThis as any).navigator;
        if (nav?.canShare?.({ files: [file] })) {
          try {
            await nav.share({ files: [file], title: fname });
            return;
          } catch (e: any) {
            if (isShareCancel(e)) return;
          }
        }
        const url = URL.createObjectURL(blob);
        const a = (globalThis as any).document.createElement("a");
        a.href = url;
        a.download = fname;
        a.target = "_blank";
        (globalThis as any).document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        toast.show("PDF gemaakt", "success");
        return;
      }
      const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c);
      const html = `<html><body style="font-family:sans-serif"><h1>${esc(dish.name)}</h1><p>${esc(origin.label)} · Voor ${esc(who)}</p>${groups
        .map((g) => `${g.label ? `<h3>${esc(g.label)}</h3>` : ""}<ul>${g.items.map((i) => `<li>${esc(i.name)} ${esc(i.qty)}</li>`).join("")}</ul>`)
        .join("")}${steps.length ? `<h2>Bereiding</h2><ol>${steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>` : ""}</body></html>`;
      const { uri } = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: dish.name });
    } catch (e: any) {
      if (isShareCancel(e)) return;
      toast.show("PDF maken lukte niet, probeer het nog eens", "error");
    }
  };

  const canCopy = Platform.OS === "web" && !!(globalThis as any).navigator?.clipboard;
  const canNativeShare = Platform.OS !== "web" || !!(globalThis as any).navigator?.share;
  const row = (label: string, value: number, set: (v: number) => void, testID: string, icon?: string) => (
    <View style={styles.counterRow}>
      <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 4 }}>
        {icon ? <Icon name={icon as any} size={14} color={colors.success} /> : null}
        <Text style={styles.counterLabel}>{label}</Text>
      </View>
      <Stepper value={value} onChange={set} min={0} max={500} testID={testID} />
    </View>
  );

  return (
    <Modal visible={!!dish} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Text style={[styles.title, { flex: 1 }]}>Gerecht delen</Text>
            <Pressable onPress={onClose} hitSlop={10} testID="dish-share-close">
              <Icon name="close" size={22} color={colors.onSurface} />
            </Pressable>
          </View>
          <Text style={styles.sub} numberOfLines={1}>
            {dish.name} · {origin.label}
          </Text>
          <ShareOption testID="dish-share-link" icon="link-variant" label="Link: iemand neemt het gerecht over in de app" onPress={() => run("link")} />
          <Text style={styles.section}>Boodschappen en bereiding, voor hoeveel personen?</Text>
          {row("Volwassenen", p.adults, (v) => setP({ ...p, adults: Math.max(v, 0) }), "dish-share-adults")}
          {row("Kinderen", p.children, (v) => setP({ ...p, children: v }), "dish-share-children")}
          {hasVega || p.vegaAdults + p.vegaChildren > 0 ? (
            <>
              {row("Vegetarische volwassenen", p.vegaAdults, (v) => setP({ ...p, vegaAdults: Math.min(v, p.adults) }), "dish-share-vega-adults", "leaf")}
              {row("Vegetarische kinderen", p.vegaChildren, (v) => setP({ ...p, vegaChildren: Math.min(v, p.children) }), "dish-share-vega-children", "leaf")}
            </>
          ) : null}
          <ShareOption testID="dish-share-whatsapp" icon="whatsapp" label="WhatsApp" onPress={() => run("whatsapp")} />
          <ShareOption testID="dish-share-mail" icon="email-outline" label="E-mail" onPress={() => run("mail")} />
          {canCopy ? <ShareOption testID="dish-share-copy" icon="content-copy" label="Tekst kopiëren" onPress={() => run("copy")} /> : null}
          {canNativeShare ? <ShareOption testID="dish-share-other" icon="share-variant" label="Andere app" onPress={() => run("other")} /> : null}
          <ShareOption testID="dish-share-pdf" icon="file-pdf-box" label="PDF (bewaren, printen of delen)" onPress={pdf} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ShareOption({ icon, label, onPress, testID }: { icon: string; label: string; onPress: () => void; testID: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <Pressable testID={testID} onPress={onPress} style={styles.option}>
      <Icon name={icon as any} size={22} color={colors.brandPrimary} />
      <Text style={styles.optionText}>{label}</Text>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  backdrop: { flex: 1, backgroundColor: "rgba(28,27,26,0.5)", justifyContent: "center", padding: 20 },
  card: { backgroundColor: colors.surface, borderRadius: 20, padding: 20, gap: 4, width: "100%", maxWidth: 440, alignSelf: "center", maxHeight: "94%" },
  title: { fontSize: 18, fontFamily: fonts.bold, color: colors.onSurface },
  sub: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted, marginBottom: 6 },
  section: { fontSize: 14, fontFamily: fonts.bold, color: colors.onSurface, marginTop: 12, marginBottom: 2 },
  counterRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 3 },
  counterLabel: { fontSize: 14, fontFamily: fonts.medium, color: colors.onSurface },
  option: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.divider },
  optionText: { fontSize: 15, fontFamily: fonts.semibold, color: colors.onSurface, flex: 1 },
}));
