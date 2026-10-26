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
type Kind = "app" | "recepten" | "eigen";
type Prefs = { categories?: MealCategory[]; style?: Style; diet?: string; store?: string; stores?: string[]; kinds?: Kind[]; cook_twice?: boolean; cheap?: boolean; promos?: boolean; prefer?: string[]; avoid?: string[] };

const STYLES: { key: Style; label: string; sub: string; icon: string }[] = [
  { key: "vertrouwd", label: "Vertrouwd", sub: "Wat je vaker eet", icon: "home-heart" },
  { key: "mix", label: "Mix", sub: "Bekend en nieuw door elkaar", icon: "shuffle-variant" },
  { key: "nieuw", label: "Iets nieuws", sub: "Gerechten die je nog niet had", icon: "star-shooting-outline" },
];

// Soort gerechten: gewone maaltijden, uitgebreide recepten van de winkels, of allebei
const KINDS: { key: Kind; label: string; sub: string; icon: string }[] = [
  { key: "app", label: "App-gerechten", sub: "Gewoon en betaalbaar: brood met beleg, stamppot, pasta, nasi", icon: "bread-slice-outline" },
  { key: "recepten", label: "Recepten", sub: "Uitgebreide recepten van de supermarkten", icon: "chef-hat" },
  { key: "eigen", label: "Eigen gerechten", sub: "Gerechten die je zelf hebt gemaakt", icon: "account-heart-outline" },
];

// Recepten van welke winkels? Je eigen supermarkt staat altijd aan als je dit opent
const STORES: { key: string; label: string }[] = [
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
  const [diets, setDiets] = useState<string[]>([]);
  const toggleDiet = (k: string) => setDiets((v) => (v.includes(k) ? v.filter((x) => x !== k) : [...v, k]));
  const { user } = useAuth();
  const own = storeKey(user?.store);
  const [stores, setStores] = useState<string[]>(own ? [own] : []);
  const [kinds, setKinds] = useState<Kind[]>(["app", "recepten", "eigen"]);
  const [cheap, setCheap] = useState(false);
  const [twice, setTwice] = useState(true);
  const [promos, setPromos] = useState(true);
  const [prefer, setPrefer] = useState("");
  const [avoid, setAvoid] = useState("");
  // Per dag andere maaltijden: tik op een dag en zet die dag zelf aan of uit (standaard wat voor alle dagen geldt)
  const [sel, setSel] = useState<number | null>(null);
  const [dayCats, setDayCats] = useState<Record<number, MealCategory[]>>({});
  const catsOf = (i: number | null) => (i == null ? cats : dayCats[i] ?? cats);
  const toggleCat = (c: MealCategory) => {
    const flip = (v: MealCategory[]) => (v.includes(c) ? v.filter((x) => x !== c) : [...v, c]);
    if (sel == null) setCats(flip);
    else setDayCats((m) => ({ ...m, [sel]: flip(m[sel] ?? cats) }));
  };
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);

  // Je vorige keuzes staan alvast klaar
  useEffect(() => {
    if (!visible) return;
    api<Prefs>("/menu-prefs")
      .then((p) => {
        if (p.categories?.length) setCats(p.categories);
        if (p.style) setStyle(p.style);
        setDiets((p.diet ?? "").split(",").filter(Boolean));
        const saved = p.stores ?? (p.store ? [p.store] : []);
        setStores([...new Set([...(own ? [own] : []), ...saved])]);
        if (p.kinds?.length) setKinds(p.kinds);
        setCheap(!!p.cheap);
        setTwice(p.cook_twice ?? true);
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
      const res = await api<{ filled: number; promo_dishes: string[]; pool: number; added_online?: number; twice?: number }>(`/camps/${campId}/auto-menu`, {
        method: "POST",
        body: {
          categories: cats,
          day_categories: Object.fromEntries(Object.entries(dayCats).filter(([, v]) => v.join() !== cats.join())),
          exclude,
          overwrite,
          style,
          diet: diets.join(","),
          stores,
          kinds,
          cheap,
          promos,
          cook_twice: twice,
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
          ? `${res.filled} maaltijden ingevuld${res.promo_dishes.length ? `, ${res.promo_dishes.length} met aanbiedingen` : ""}${res.twice ? `, ${res.twice}× restjes van de dag ervoor` : ""}${res.added_online ? ` (${res.added_online} nieuwe recepten)` : ""}`
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
            <Text style={styles.head}>Welke dagen?</Text>
            <View style={styles.chips}>
              <Chip on={sel == null} label="Alle dagen" onPress={() => setSel(null)} />
              {days.map((d) => {
                const own = dayCats[d.index];
                const off = own && !own.length;
                const diff = own && own.join() !== cats.join();
                return (
                  <Chip
                    key={d.index}
                    on={sel === d.index}
                    label={`${dayLabel(d.index)}${off ? " (niets)" : diff ? " •" : ""}`}
                    onPress={() => setSel((v) => (v === d.index ? null : d.index))}
                  />
                );
              })}
            </View>
            <Text style={styles.sub}>Tik op een dag om de maaltijden van alleen die dag te kiezen.</Text>

            <Text style={styles.head}>{sel == null ? "Welke maaltijden?" : `Welke maaltijden op ${dayLabel(sel)}?`}</Text>
            {MEAL_CATEGORIES.map((c) => (
              <Check
                key={c}
                testID={`auto-menu-cat-${c}`}
                on={catsOf(sel).includes(c)}
                label={CATEGORY_LABELS[c]}
                onPress={() => toggleCat(c)}
              />
            ))}
            {sel != null && dayCats[sel] ? (
              <Pressable onPress={() => setDayCats(({ [sel]: _, ...rest }) => rest)} hitSlop={6}>
                <Text style={[styles.sub, { color: colors.brandPrimary, fontFamily: fonts.bold }]}>Zelfde als alle dagen</Text>
              </Pressable>
            ) : null}

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

            <Text style={styles.head}>Soort gerechten</Text>
            {KINDS.map((k) => (
              <Pressable
                key={k.key}
                onPress={() => setKinds((v) => (v.includes(k.key) ? (v.length > 1 ? v.filter((x) => x !== k.key) : v) : [...v, k.key]))}
                style={[styles.style, kinds.includes(k.key) && styles.styleOn]}
              >
                <Icon name={k.icon} size={20} color={kinds.includes(k.key) ? colors.brandPrimary : colors.muted} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowText}>{k.label}</Text>
                  <Text style={styles.sub}>{k.sub}</Text>
                </View>
                <Icon name={kinds.includes(k.key) ? "checkbox-marked" : "checkbox-blank-outline"} size={20} color={kinds.includes(k.key) ? colors.brandPrimary : colors.muted} />
              </Pressable>
            ))}

            {kinds.includes("recepten") ? (
              <>
                <Text style={styles.head}>Recepten van</Text>
                <View style={styles.chips}>
                  {STORES.map((s) => (
                    <Chip
                      key={s.key}
                      on={stores.includes(s.key)}
                      label={s.label}
                      onPress={() => setStores((v) => (v.includes(s.key) ? v.filter((x) => x !== s.key) : [...v, s.key]))}
                    />
                  ))}
                </View>
                <Text style={styles.sub}>Zet een of meer winkels aan. Staat er geen aan, dan zoeken we bij alle winkels.</Text>
              </>
            ) : null}

            <Text style={styles.head}>Voorkeuren</Text>
            <View style={styles.chips}>
              <Chip on={!diets.length} label="Alles" onPress={() => setDiets([])} />
              <Chip on={diets.includes("vega")} label="Vegetarisch" onPress={() => toggleDiet("vega")} />
              <Chip on={diets.includes("vegan")} label="Veganistisch" onPress={() => toggleDiet("vegan")} />
              <Chip on={diets.includes("vlees")} label="Met vlees" onPress={() => toggleDiet("vlees")} />
              <Chip on={diets.includes("vis")} label="Met vis" onPress={() => toggleDiet("vis")} />
            </View>
            <Check on={promos} label="Gerechten met aanbiedingen eerst" onPress={() => setPromos((v) => !v)} />
            <Check on={cheap} label="Goedkope gerechten eerst" onPress={() => setCheap((v) => !v)} />
            <Check on={twice} label="Restjes slim gebruiken: één keer koken voor twee dagen" onPress={() => setTwice((v) => !v)} />
            <Text style={styles.sub}>Voor kleine groepen (tot 4 personen) bij lunch en avondeten. Je koopt dan één keer in en houdt minder over.</Text>
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
            disabled={days.every((d) => !catsOf(d.index).length)}
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
