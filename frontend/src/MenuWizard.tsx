// Weekmenu automatisch invullen (Premium): eerst je voorkeuren kiezen, dan vult de app de maaltijden.
// Houdt rekening met wat je eerder at, je smaak, aanbiedingen op je inkoopdag en je allergieën.
import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";

import { Button, Icon } from "@/src/components/ui";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { CATEGORY_LABELS, MEAL_CATEGORIES, MealCategory } from "@/src/constants";
import { dietConflicts } from "@/src/diet";
import { useToast } from "@/src/toast";
import { fonts, makeStyles, useTheme } from "@/src/theme";

type Style = "vertrouwd" | "mix" | "nieuw";
type Prefs = { categories?: MealCategory[]; style?: Style; diet?: string; store?: string; cheap?: boolean; promos?: boolean; prefer?: string[]; avoid?: string[] };

const STYLES: { key: Style; label: string; sub: string; icon: string }[] = [
  { key: "vertrouwd", label: "Vertrouwd", sub: "Wat je vaker eet", icon: "home-heart" },
  { key: "mix", label: "Mix", sub: "Bekend en nieuw door elkaar", icon: "shuffle-variant" },
  { key: "nieuw", label: "Iets nieuws", sub: "Gerechten die je nog niet had", icon: "star-shooting-outline" },
];

// Recepten van welke winkel? Standaard je eigen supermarkt
const STORES: { key: string; label: string }[] = [
  { key: "", label: "Alle winkels" },
  { key: "ah", label: "Albert Heijn" },
  { key: "jumbo", label: "Jumbo" },
  { key: "dirk", label: "Dirk" },
];
const storeKey = (label?: string | null) => STORES.find((s) => s.key && s.label === label)?.key ?? "";

const words = (t: string) =>
  t
    .split(/[,;\n]/)
    .map((x) => x.trim())
    .filter(Boolean);

export function MenuWizard({
  visible,
  onClose,
  campId,
  days,
  startDate,
  dishes,
  diet,
}: {
  visible: boolean;
  onClose: () => void;
  campId: string;
  days: { index: number }[];
  startDate?: string | null;
  dishes: { id: string; ingredients?: { name: string }[] }[];
  diet: string[];
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const toast = useToast();
  const [cats, setCats] = useState<MealCategory[]>(["avondeten"]);
  const [style, setStyle] = useState<Style>("mix");
  const [dietPick, setDietPick] = useState("");
  const { user } = useAuth();
  const [store, setStore] = useState(storeKey(user?.store));
  const [cheap, setCheap] = useState(false);
  const [promos, setPromos] = useState(true);
  const [prefer, setPrefer] = useState("");
  const [avoid, setAvoid] = useState("");
  const [allDays, setAllDays] = useState(true);
  const [pickDays, setPickDays] = useState<number[]>([]);
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);

  // Je vorige keuzes staan alvast klaar
  useEffect(() => {
    if (!visible) return;
    api<Prefs>("/menu-prefs")
      .then((p) => {
        if (p.categories?.length) setCats(p.categories);
        if (p.style) setStyle(p.style);
        setDietPick(p.diet ?? "");
        setStore(p.store !== undefined ? p.store : storeKey(user?.store));
        setCheap(!!p.cheap);
        setPromos(p.promos ?? true);
        setPrefer((p.prefer ?? []).join(", "));
        setAvoid((p.avoid ?? []).join(", "));
      })
      .catch(() => {});
  }, [visible]);

  const dayLabel = (i: number) => {
    if (!startDate) return `Dag ${i + 1}`;
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    return d.toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" });
  };

  const run = async () => {
    setBusy(true);
    try {
      const exclude = dishes.filter((d) => dietConflicts(d.ingredients, diet).length).map((d) => d.id);
      const res = await api<{ filled: number; promo_dishes: string[]; pool: number; added_online?: number }>(`/camps/${campId}/auto-menu`, {
        method: "POST",
        body: {
          categories: cats,
          exclude,
          overwrite,
          days: allDays ? null : pickDays,
          style,
          diet: dietPick,
          store,
          cheap,
          promos,
          prefer: words(prefer),
          avoid: words(avoid),
        },
      });
      qc.invalidateQueries({ queryKey: ["camp", campId] });
      qc.invalidateQueries({ queryKey: ["shopping", campId] });
      qc.invalidateQueries({ queryKey: ["budget", campId] });
      onClose();
      toast.show(
        res.filled
          ? `${res.filled} maaltijden ingevuld${res.promo_dishes.length ? `, ${res.promo_dishes.length} met aanbiedingen` : ""}${res.added_online ? ` (${res.added_online} nieuwe recepten van AH, Jumbo en Dirk)` : ""}`
          : res.pool
            ? "Alle maaltijden waren al gekozen. Vink 'Ook maaltijden vervangen' aan om ze te vervangen."
            : "Geen gerechten gevonden die bij je keuzes passen",
        res.filled ? "success" : "info",
      );
    } catch (e: any) {
      toast.show(e?.message ?? "Invullen mislukt", "error");
    } finally {
      setBusy(false);
    }
  };

  const Check = ({ on, label, onPress, testID }: { on: boolean; label: string; onPress: () => void; testID?: string }) => (
    <Pressable testID={testID} style={styles.row} onPress={onPress}>
      <Icon name={on ? "checkbox-marked" : "checkbox-blank-outline"} size={22} color={on ? colors.brandPrimary : colors.muted} />
      <Text style={styles.rowText}>{label}</Text>
    </Pressable>
  );
  const Chip = ({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) => (
    <Pressable onPress={onPress} style={[styles.chip, on && styles.chipOn]}>
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Text style={[styles.title, { flex: 1 }]}>Menu automatisch invullen</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Icon name="close" size={22} color={colors.muted} />
            </Pressable>
          </View>
          <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={{ gap: 6 }}>
            <Text style={styles.head}>Welke maaltijden?</Text>
            {MEAL_CATEGORIES.map((c) => (
              <Check
                key={c}
                testID={`auto-menu-cat-${c}`}
                on={cats.includes(c)}
                label={CATEGORY_LABELS[c]}
                onPress={() => setCats((v) => (v.includes(c) ? v.filter((x) => x !== c) : [...v, c]))}
              />
            ))}

            <Text style={styles.head}>Welke dagen?</Text>
            <View style={styles.chips}>
              <Chip on={allDays} label="Alle dagen" onPress={() => setAllDays(true)} />
              {days.map((d) => (
                <Chip
                  key={d.index}
                  on={!allDays && pickDays.includes(d.index)}
                  label={dayLabel(d.index)}
                  onPress={() => {
                    setAllDays(false);
                    setPickDays((v) => (allDays ? [d.index] : v.includes(d.index) ? v.filter((x) => x !== d.index) : [...v, d.index]));
                  }}
                />
              ))}
            </View>

            <Text style={styles.head}>Waar heb je zin in?</Text>
            {STYLES.map((s) => (
              <Pressable key={s.key} onPress={() => setStyle(s.key)} style={[styles.style, style === s.key && styles.styleOn]}>
                <Icon name={s.icon} size={20} color={style === s.key ? colors.brandPrimary : colors.muted} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowText}>{s.label}</Text>
                  <Text style={styles.sub}>{s.sub}</Text>
                </View>
                {style === s.key ? <Icon name="check" size={18} color={colors.brandPrimary} /> : null}
              </Pressable>
            ))}

            <Text style={styles.head}>Recepten van</Text>
            <View style={styles.chips}>
              {STORES.map((s) => (
                <Chip key={s.key || "all"} on={store === s.key} label={s.label} onPress={() => setStore(s.key)} />
              ))}
            </View>

            <Text style={styles.head}>Voorkeuren</Text>
            <View style={styles.chips}>
              <Chip on={dietPick === ""} label="Alles" onPress={() => setDietPick("")} />
              <Chip on={dietPick === "vega"} label="Vegetarisch" onPress={() => setDietPick("vega")} />
              <Chip on={dietPick === "vegan"} label="Veganistisch" onPress={() => setDietPick("vegan")} />
            </View>
            <Check on={promos} label="Gerechten met aanbiedingen eerst" onPress={() => setPromos((v) => !v)} />
            <Check on={cheap} label="Goedkope gerechten eerst" onPress={() => setCheap((v) => !v)} />
            <Text style={styles.label}>Graag (bijv. pasta, kip, Mexicaans)</Text>
            <TextInput value={prefer} onChangeText={setPrefer} placeholder="Laat leeg als het niet uitmaakt" placeholderTextColor={colors.muted} style={styles.input} />
            <Text style={styles.label}>Liever niet (bijv. vis, champignons)</Text>
            <TextInput value={avoid} onChangeText={setAvoid} placeholder="Laat leeg als het niet uitmaakt" placeholderTextColor={colors.muted} style={styles.input} />

            <Check testID="auto-menu-overwrite" on={overwrite} label="Ook maaltijden vervangen die al gekozen zijn" onPress={() => setOverwrite((v) => !v)} />
            <Text style={styles.sub}>
              We kijken ook naar wat je eerder op je lijstjes had en wat je de laatste twee weken at, voor afwisseling.
              {diet.length ? " Gerechten die niet passen bij je allergieën of dieet slaan we over." : ""} Je keuzes onthouden we voor de volgende keer.
            </Text>
          </ScrollView>
          <Button
            label="Invullen"
            onPress={run}
            loading={busy}
            disabled={!cats.length || (!allDays && !pickDays.length)}
            testID="auto-menu-run"
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  backdrop: { flex: 1, backgroundColor: "rgba(28,27,26,0.5)", justifyContent: "center", padding: 20 },
  card: { backgroundColor: colors.surface, borderRadius: 20, padding: 20, gap: 10, width: "100%", maxWidth: 480, alignSelf: "center" },
  title: { fontSize: 18, fontFamily: fonts.bold, color: colors.onSurface },
  head: { fontSize: 13, fontFamily: fonts.bold, color: colors.onSurfaceSecondary, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 5 },
  rowText: { fontSize: 15, fontFamily: fonts.medium, color: colors.onSurface, flex: 1 },
  sub: { fontSize: 12, fontFamily: fonts.regular, color: colors.muted, lineHeight: 17 },
  label: { fontSize: 13, fontFamily: fonts.medium, color: colors.onSurface, marginTop: 4 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, fontFamily: fonts.regular, color: colors.onSurface },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { fontSize: 13, fontFamily: fonts.medium, color: colors.onSurface },
  chipTextOn: { color: colors.onBrandPrimary },
  style: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: colors.border },
  styleOn: { borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary },
}));
