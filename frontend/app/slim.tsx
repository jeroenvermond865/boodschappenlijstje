// Slimme hulp (Premium): vijf dingen die de AI voor je doet.
// Menu uit één zin, koken met restjes, recept plakken of fotograferen, je lijst typen of inspreken, en bespaartips.
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, Platform, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import Image from "@/src/components/SafeImage";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Icon } from "@/src/components/ui";
import { api } from "@/src/api";
import { goBack } from "@/src/nav";
import { useSwipePages } from "@/src/useSwipePages";
import { GOLD, PremiumLock, useFeature, useFeatureAccent, usePlans } from "@/src/premium";
import { euro } from "@/src/search";
import { useTerms } from "@/src/settings";
import { useToast } from "@/src/toast";
import { CATEGORY_LABELS, formatQty, type MealCategory } from "@/src/constants";
import { fonts, makeStyles, useTheme } from "@/src/theme";

type Tab = "menu" | "restjes" | "recept" | "lijst" | "tips";
const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: "menu", label: "Menu in één zin", icon: "message-text-outline" },
  { key: "restjes", label: "Restjes koken", icon: "pot-steam-outline" },
  { key: "recept", label: "Recept plakken", icon: "camera-outline" },
  { key: "lijst", label: "Lijst typen", icon: "microphone-outline" },
  { key: "tips", label: "Bespaartips", icon: "piggy-bank-outline" },
];

type Prod = { id: string; name: string; price: number; unit: string; image?: string | null; unit_price?: string | null };
type AiIng = { name: string; qty: number | null; unit: string; text: string; have: boolean; product: Prod | null };
type AiDish = { name: string; category: MealCategory; servings: number; ingredients: AiIng[]; steps: string[]; note: string; url?: string | null; image?: string | null };
type CampLite = { id: string; name: string; days: { index: number; adults: number; children: number }[] };

export default function SlimScreen() {
  const fa = useFeatureAccent("slimme_hulp"); // goud of paars, net als het abonnement waar de hulp bij hoort
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const premium = useFeature("slimme_hulp");
  // Standaard mag een paar vragen per maand gratis proberen (in te stellen bij Beheer -> Abonnementen)
  const freeLimit = usePlans().data?.levels.find((l) => l.key === "standaard")?.ai_limit ?? 0;
  const allowed = premium || freeLimit > 0;
  const params = useLocalSearchParams<{ tab?: Tab; camp?: string }>();
  const [tab, setTab] = useState<Tab>(TABS.some((t) => t.key === params.tab) ? (params.tab as Tab) : "menu");
  // Opzij vegen naar het volgende of vorige onderdeel
  const pos = TABS.findIndex((t) => t.key === tab);
  const swipe = useSwipePages((dir) => pos + dir >= 0 && pos + dir < TABS.length, (dir) => setTab(TABS[pos + dir].key));

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable testID="back-button" onPress={() => goBack("/")} hitSlop={10} style={styles.headerBtn}>
          <Icon name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Slimme hulp</Text>
        <View style={styles.headerBtn} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {TABS.map((t) => (
            <Pressable key={t.key} onPress={() => setTab(t.key)} style={[styles.tab, { backgroundColor: fa.c.bg, borderColor: fa.c.border }, tab === t.key && { backgroundColor: fa.c.icon, borderColor: fa.c.icon }]} testID={`slim-tab-${t.key}`}>
              <Icon name={t.icon} size={16} color={tab === t.key ? "#FFFFFF" : fa.c.icon} />
              <Text style={[styles.tabText, tab === t.key && { color: "#FFFFFF" }]}>{t.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
        {!premium && freeLimit > 0 ? (
          <Pressable onPress={() => router.push("/premium")} style={styles.freeNote} testID="slim-free-note">
            <Icon name="star-circle" size={18} color={GOLD.icon} />
            <Text style={styles.freeNoteText}>
              Je kunt de slimme hulp {freeLimit} keer per maand gratis gebruiken. Met Premium 100 keer. <Text style={{ fontFamily: fonts.bold }}>Probeer Premium ›</Text>
            </Text>
          </Pressable>
        ) : null}
        <Animated.View style={[{ gap: 14 }, swipe.style]} {...swipe.panHandlers}>
        {!allowed ? (
          <PremiumLock feature="slimme_hulp" title="De slimme hulp" text="Laat de app een menu maken uit één zin, koken met wat je nog hebt, recepten overnemen en besparen." />
        ) : tab === "menu" ? (
          <MenuTab />
        ) : tab === "restjes" ? (
          <LeftoversTab />
        ) : tab === "recept" ? (
          <RecipeTab />
        ) : tab === "lijst" ? (
          <ItemsTab />
        ) : (
          <TipsTab campId={params.camp} />
        )}
        </Animated.View>
      </ScrollView>
    </View>
  );
}

function Intro({ icon, title, text }: { icon: string; title: string; text: string }) {
  const styles = useStyles();
  return (
    <View style={styles.intro}>
      <Icon name={icon} size={26} color={GOLD.icon} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.introTitle}>{title}</Text>
        <Text style={styles.introText}>{text}</Text>
      </View>
    </View>
  );
}

function Big({ label, icon, onPress, busy, disabled, ghost, testID }: { label: string; icon?: string; onPress: () => void; busy?: boolean; disabled?: boolean; ghost?: boolean; testID?: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const fg = ghost ? colors.brandPrimary : colors.onBrandPrimary;
  return (
    <Pressable testID={testID} disabled={busy || disabled} onPress={onPress} style={[styles.btn, ghost && styles.btnGhost, (busy || disabled) && { opacity: 0.55 }]}>
      {busy ? <ActivityIndicator color={fg} /> : icon ? <Icon name={icon} size={18} color={fg} /> : null}
      <Text style={[styles.btnText, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

function Err({ error }: { error: unknown }) {
  const { colors } = useTheme();
  if (!error) return null;
  return <Text style={{ color: colors.error, fontFamily: fonts.medium, fontSize: 14 }}>{(error as Error).message}</Text>;
}

function Waiting({ text }: { text: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.waiting}>
      <ActivityIndicator color={colors.brandPrimary} />
      <Text style={styles.muted}>{text}</Text>
    </View>
  );
}

// 1. Menu uit één zin
function MenuTab() {
  const styles = useStyles();
  const router = useRouter();
  const T = useTerms();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const examples = ["5 dagen avondeten voor 2 personen, vega, max 40 euro", "Een week ontbijt, lunch en avondeten voor 2 volwassenen en 2 kinderen, geen vis", "3 dagen kamp met 20 kinderen en 4 leiding, goedkoop"];
  const run = useMutation({
    mutationFn: () => api<{ camp: { id: string; name: string }; filled: number; understood: any }>("/ai/menu", { method: "POST", body: { text } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["camps"] });
      qc.invalidateQueries({ queryKey: ["home"] });
    },
  });
  const u = run.data?.understood;
  return (
    <View style={{ gap: 12 }}>
      <Intro icon="message-text-outline" title="Menu maken uit één zin" text={`Vertel wat je wilt. De app maakt een nieuw ${T.one} met gerechten en je boodschappenlijst.`} />
      <TextInput value={text} onChangeText={setText} multiline placeholder="Bijvoorbeeld: 5 dagen avondeten voor 2 personen, vega, max 40 euro" style={styles.input} testID="ai-menu-text" />
      <View style={styles.chips}>
        {examples.map((e) => (
          <Pressable key={e} onPress={() => setText(e)} style={styles.chip}>
            <Text style={styles.chipText}>{e}</Text>
          </Pressable>
        ))}
      </View>
      <Big label="Maak mijn menu" icon="auto-fix" busy={run.isPending} disabled={text.trim().length < 4} onPress={() => run.mutate()} testID="ai-menu-go" />
      {run.isPending ? <Waiting text="De app zoekt gerechten die bij je passen. Dit duurt soms een halve minuut." /> : null}
      <Err error={run.error} />
      {run.data ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Klaar: {run.data.camp.name}</Text>
          <Text style={styles.body}>
            {u.days} {u.days === 1 ? "dag" : "dagen"} · {u.adults} {u.adults === 1 ? "volwassene" : "volwassenen"}
            {u.children ? ` en ${u.children} ${u.children === 1 ? "kind" : "kinderen"}` : ""} · {u.categories.map((c: MealCategory) => CATEGORY_LABELS[c].toLowerCase()).join(", ")}
            {u.diet ? ` · ${u.diet.replace(/,/g, ", ")}` : ""}
            {u.budget ? ` · budget ${euro(u.budget)}` : ""}
          </Text>
          {u.prefer?.length ? <Text style={styles.muted}>Zin in: {u.prefer.join(", ")}</Text> : null}
          {u.avoid?.length ? <Text style={styles.muted}>Liever niet: {u.avoid.join(", ")}</Text> : null}
          <Text style={styles.body}>{run.data.filled} maaltijden ingevuld. Je kunt alles nog aanpassen.</Text>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Big label="Bekijk menu" ghost onPress={() => router.push(`/camp/${run.data!.camp.id}`)} />
            </View>
            <View style={{ flex: 1 }}>
              <Big label="Boodschappen" onPress={() => router.push(`/shopping/${run.data!.camp.id}`)} />
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}

// 2. Restjes koken
function LeftoversTab() {
  const styles = useStyles();
  const [text, setText] = useState("");
  const [pantry, setPantry] = useState(true);
  const run = useMutation({ mutationFn: () => api<{ dishes: AiDish[] }>("/ai/leftovers", { method: "POST", body: { text, use_pantry: pantry } }) });
  return (
    <View style={{ gap: 12 }}>
      <Intro icon="pot-steam-outline" title="Koken met wat je nog hebt" text="De app bedenkt gerechten met wat er nog in huis is, zodat je weinig hoeft weg te gooien en weinig hoeft bij te kopen." />
      <TextInput value={text} onChangeText={setText} multiline placeholder="Wat heb je nog? Bijvoorbeeld: halve courgette, 3 eieren, restje rijst, feta" style={styles.input} testID="ai-left-text" />
      <View style={styles.switchRow}>
        <Text style={[styles.body, { flex: 1 }]}>Ook mijn voorraadkast gebruiken</Text>
        <Switch value={pantry} onValueChange={setPantry} />
      </View>
      <Big label="Bedenk gerechten" icon="lightbulb-on-outline" busy={run.isPending} disabled={!text.trim() && !pantry} onPress={() => run.mutate()} testID="ai-left-go" />
      {run.isPending ? <Waiting text="Even nadenken over wat je kunt maken..." /> : null}
      <Err error={run.error} />
      {(run.data?.dishes ?? []).map((d, i) => (
        <DishCard key={`${d.name}-${i}`} dish={d} kind="restjes" />
      ))}
    </View>
  );
}

// Web: foto kleiner maken voor het versturen (een telefoonfoto is vaak te groot)
async function shrinkWeb(uri: string): Promise<string | null> {
  if (Platform.OS !== "web" || typeof document === "undefined") return null;
  const img = new (window as any).Image() as HTMLImageElement;
  img.src = uri;
  await img.decode();
  const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.82);
}

// 3. Recept plakken of fotograferen
function RecipeTab() {
  const styles = useStyles();
  const { colors } = useTheme();
  const [text, setText] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const run = useMutation({ mutationFn: () => api<{ dish: AiDish }>("/ai/recipe", { method: "POST", body: { text, image: image ?? "" } }) });

  const pick = async (camera: boolean) => {
    setPicking(true);
    try {
      if (camera && Platform.OS !== "web") {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) return;
      }
      const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.5, base64: true };
      const res = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
      const a = res.canceled ? null : res.assets?.[0];
      if (!a) return;
      const small = await shrinkWeb(a.uri).catch(() => null);
      setImage(small ?? (a.base64 ? `data:${a.mimeType ?? "image/jpeg"};base64,${a.base64}` : a.uri));
    } finally {
      setPicking(false);
    }
  };

  return (
    <View style={{ gap: 12 }}>
      <Intro icon="book-open-variant" title="Recept overnemen" text="Plak een recept of een link naar een receptensite, of maak een foto van een kookboek. De app maakt er een gerecht van met producten uit jouw winkel." />
      <TextInput value={text} onChangeText={setText} multiline placeholder="Plak hier de link of de tekst van het recept" style={[styles.input, { minHeight: 110 }]} testID="ai-recipe-text" />
      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Big label="Foto maken" icon="camera-outline" ghost busy={picking} onPress={() => pick(true)} />
        </View>
        <View style={{ flex: 1 }}>
          <Big label="Foto kiezen" icon="image-outline" ghost busy={picking} onPress={() => pick(false)} />
        </View>
      </View>
      {image ? (
        <View style={styles.photoRow}>
          <Image source={{ uri: image }} style={styles.photo} resizeMode="cover" />
          <Text style={[styles.body, { flex: 1 }]}>Foto toegevoegd</Text>
          <Pressable onPress={() => setImage(null)} hitSlop={10}>
            <Icon name="close" size={20} color={colors.muted} />
          </Pressable>
        </View>
      ) : null}
      <Big label="Maak er een gerecht van" icon="auto-fix" busy={run.isPending} disabled={!text.trim() && !image} onPress={() => run.mutate()} testID="ai-recipe-go" />
      {run.isPending ? <Waiting text="Het recept wordt gelezen en de producten worden gezocht..." /> : null}
      <Err error={run.error} />
      {run.data ? <DishCard dish={run.data.dish} kind="recept" /> : null}
    </View>
  );
}

function useCamps(enabled = true) {
  return useQuery({ queryKey: ["camps"], queryFn: () => api<{ camps: CampLite[] }>("/camps"), enabled });
}

function CampChips({ camps, value, onChange, allowNone }: { camps: CampLite[]; value: string | null; onChange: (id: string | null) => void; allowNone?: string }) {
  const styles = useStyles();
  return (
    <View style={styles.chips}>
      {allowNone ? (
        <Pressable onPress={() => onChange(null)} style={[styles.chip, value == null && styles.chipOn]}>
          <Text style={[styles.chipText, value == null && styles.chipTextOn]}>{allowNone}</Text>
        </Pressable>
      ) : null}
      {camps.map((c) => (
        <Pressable key={c.id} onPress={() => onChange(c.id)} style={[styles.chip, value === c.id && styles.chipOn]}>
          <Text style={[styles.chipText, value === c.id && styles.chipTextOn]} numberOfLines={1}>
            {c.name}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

// Een gerecht van de AI: ingrediënten met producten, bereiding, en bewaren of op een lijstje zetten
function DishCard({ dish, kind }: { dish: AiDish; kind: "recept" | "restjes" }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const T = useTerms();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [toList, setToList] = useState(false);
  const [campId, setCampId] = useState<string | null>(null);
  const [day, setDay] = useState(0);
  const [saved, setSaved] = useState(false);
  const camps = useCamps(toList);
  const list = camps.data?.camps ?? [];
  const camp = list.find((c) => c.id === campId) ?? (list.length === 1 ? list[0] : undefined);
  const buy = dish.ingredients.filter((i) => !i.have);
  const total = buy.reduce((s, i) => s + (i.product?.price ?? 0), 0);

  const save = useMutation({
    mutationFn: (withCamp: boolean) =>
      api("/ai/dish", {
        method: "POST",
        body: {
          name: dish.name, category: dish.category, servings: dish.servings, steps: dish.steps, url: dish.url ?? null, image: dish.image ?? null, kind,
          ingredients: dish.ingredients.map((i) => ({ name: i.name, qty: i.qty, unit: i.unit, text: i.text, have: i.have, product_id: i.product?.id ?? null })),
          camp_id: withCamp ? camp?.id : null,
          day_index: withCamp ? day : null,
        },
      }),
    onSuccess: (_, withCamp) => {
      setSaved(true);
      setToList(false);
      qc.invalidateQueries({ queryKey: ["dishes"] });
      qc.invalidateQueries({ queryKey: ["camps"] });
      if (withCamp && camp) {
        const id = camp.id;
        toast.show(`Op ${camp.name} gezet`, "success", { label: "Bekijk", onPress: () => router.push(`/camp/${id}`) });
      } else {
        toast.show("Bewaard bij je gerechten", "success", { label: "Bekijk", onPress: () => router.push("/dishes") });
      }
    },
  });

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{dish.name}</Text>
      <Text style={styles.muted}>
        {CATEGORY_LABELS[dish.category]} · {dish.servings} {dish.servings === 1 ? "persoon" : "personen"}
        {total ? ` · erbij kopen ongeveer ${euro(total)}` : ""}
      </Text>
      {dish.note ? <Text style={styles.body}>{dish.note}</Text> : null}
      <View style={{ gap: 6 }}>
        {dish.ingredients.map((i, k) => (
          <View key={k} style={styles.ingRow}>
            {i.have ? (
              <Icon name="home-outline" size={18} color={colors.success} />
            ) : i.product?.image ? (
              <Image source={{ uri: i.product.image }} style={styles.thumb} resizeMode="contain" />
            ) : (
              <Icon name="cart-outline" size={18} color={colors.muted} />
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.body}>{i.text || `${i.qty ? `${formatQty(i.qty)} ${i.unit} ` : ""}${i.name}`}</Text>
              {i.have ? (
                <Text style={[styles.small, { color: colors.success }]}>In huis</Text>
              ) : i.product ? (
                <Text style={styles.small} numberOfLines={1}>
                  {i.product.name} · {i.product.unit} · {euro(i.product.price)}
                </Text>
              ) : (
                <Text style={styles.small}>Geen product gevonden; je kunt het later kiezen</Text>
              )}
            </View>
          </View>
        ))}
      </View>
      {dish.steps.length ? (
        <Pressable onPress={() => setOpen(!open)} style={styles.linkRow}>
          <Icon name={open ? "chevron-up" : "chevron-down"} size={18} color={colors.brandPrimary} />
          <Text style={styles.link}>{open ? "Bereiding verbergen" : "Bereiding bekijken"}</Text>
        </Pressable>
      ) : null}
      {open ? dish.steps.map((s, k) => <Text key={k} style={styles.body}>{`${k + 1}. ${s}`}</Text>) : null}
      {saved ? (
        <Text style={[styles.body, { color: colors.success, fontFamily: fonts.semibold }]}>Bewaard bij je gerechten</Text>
      ) : toList ? (
        <View style={{ gap: 10 }}>
          {camps.isLoading ? <ActivityIndicator color={colors.brandPrimary} /> : null}
          {!camps.isLoading && !list.length ? <Text style={styles.muted}>{`Je hebt nog geen ${T.one}. Bewaar het gerecht, of maak eerst een ${T.one}.`}</Text> : null}
          {list.length > 1 ? <CampChips camps={list} value={camp?.id ?? null} onChange={(id) => { setCampId(id); setDay(0); }} /> : null}
          {camp ? (
            <>
              <Text style={styles.label}>Dag</Text>
              <View style={styles.chips}>
                {camp.days.map((d, k) => (
                  <Pressable key={k} onPress={() => setDay(k)} style={[styles.chip, day === k && styles.chipOn]}>
                    <Text style={[styles.chipText, day === k && styles.chipTextOn]}>
                      Dag {k + 1} · {d.adults + d.children} p.
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Big label={`Op dag ${day + 1} zetten`} icon="plus" busy={save.isPending} onPress={() => save.mutate(true)} />
            </>
          ) : null}
        </View>
      ) : (
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Big label="Bewaren" icon="content-save-outline" ghost busy={save.isPending} onPress={() => save.mutate(false)} />
          </View>
          <View style={{ flex: 1 }}>
            <Big label={`Op ${T.one}`} icon="playlist-plus" onPress={() => setToList(true)} />
          </View>
        </View>
      )}
      <Err error={save.error} />
    </View>
  );
}

// Inspreken in de browser (Chrome, Edge, Safari); anders de microfoon van je toetsenbord
function useSpeech(onText: (t: string) => void) {
  const SR = Platform.OS === "web" && typeof window !== "undefined" ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : null;
  const [on, setOn] = useState(false);
  const rec = useRef<any>(null);
  const cb = useRef(onText);
  cb.current = onText;
  useEffect(() => () => rec.current?.stop?.(), []);
  const toggle = () => {
    if (!SR) return;
    if (on) {
      rec.current?.stop();
      return;
    }
    const r = new SR();
    r.lang = "nl-NL";
    r.continuous = true;
    r.interimResults = false;
    r.onresult = (e: any) => {
      for (let k = e.resultIndex; k < e.results.length; k++) if (e.results[k].isFinal) cb.current(e.results[k][0].transcript);
    };
    r.onend = () => setOn(false);
    r.onerror = () => setOn(false);
    rec.current = r;
    r.start();
    setOn(true);
  };
  return { can: !!SR, on, toggle };
}

type AiItem = { name: string; qty: number; unit: string; product: Prod | null };

// 4. Boodschappen typen of inspreken
function ItemsTab() {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const T = useTerms();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [items, setItems] = useState<AiItem[]>([]);
  const [campId, setCampId] = useState<string | null>(null);
  const speech = useSpeech((t) => setText((x) => (x.trim() ? `${x.trim()}, ${t.trim()}` : t.trim())));
  const camps = useCamps(items.length > 0);
  const list = camps.data?.camps ?? [];
  const camp = list.find((c) => c.id === campId) ?? list[0];

  const run = useMutation({
    mutationFn: () => api<{ items: AiItem[] }>("/ai/items", { method: "POST", body: { text } }),
    onSuccess: (r) => setItems(r.items),
  });
  const add = useMutation({
    mutationFn: () =>
      api<{ added: number }>("/ai/items/add", {
        method: "POST",
        body: { camp_id: camp!.id, day_index: null, items: items.map((i) => ({ name: i.name, qty: i.qty, unit: i.unit, product_id: i.product?.id ?? null })) },
      }),
    onSuccess: (r) => {
      const id = camp!.id;
      qc.invalidateQueries({ queryKey: ["camps"] });
      toast.show(`${r.added} ${r.added === 1 ? "product" : "producten"} op ${camp!.name} gezet`, "success", { label: "Bekijk", onPress: () => router.push(`/shopping/${id}`) });
      setItems([]);
      setText("");
    },
  });

  return (
    <View style={{ gap: 12 }}>
      <Intro icon="microphone-outline" title="Je lijst typen of inspreken" text="Zeg of typ gewoon wat je nodig hebt, zoals je het tegen iemand zou zeggen. De app zoekt de producten erbij." />
      <TextInput value={text} onChangeText={setText} multiline placeholder="Bijvoorbeeld: 2 pakken melk, brood, iets voor bij de koffie en 500 gram gehakt" style={styles.input} testID="ai-items-text" />
      <View style={{ flexDirection: "row", gap: 10 }}>
        {speech.can ? (
          <View style={{ flex: 1 }}>
            <Big label={speech.on ? "Stop" : "Inspreken"} icon={speech.on ? "stop" : "microphone"} ghost onPress={speech.toggle} />
          </View>
        ) : null}
        <View style={{ flex: 1 }}>
          <Big label="Maak mijn lijst" icon="format-list-checks" busy={run.isPending} disabled={text.trim().length < 2} onPress={() => run.mutate()} testID="ai-items-go" />
        </View>
      </View>
      {speech.on ? <Text style={[styles.body, { color: colors.error }]}>Ik luister... Tik op Stop als je klaar bent.</Text> : null}
      {!speech.can ? <Text style={styles.small}>Inspreken kan met de microfoon op je toetsenbord.</Text> : null}
      <Err error={run.error} />
      {items.length ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Gevonden producten</Text>
          {items.map((i, k) => (
            <View key={k} style={styles.ingRow}>
              {i.product?.image ? <Image source={{ uri: i.product.image }} style={styles.thumb} resizeMode="contain" /> : <Icon name="cart-outline" size={18} color={colors.muted} />}
              <View style={{ flex: 1 }}>
                <Text style={styles.body}>
                  {formatQty(i.qty)} {i.unit === "stuks" ? "x" : i.unit} {i.product?.name ?? i.name}
                </Text>
                <Text style={styles.small}>{i.product ? `${i.product.unit} · ${euro(i.product.price)}` : "Geen product gevonden; komt als tekst op je lijst"}</Text>
              </View>
              <Pressable onPress={() => setItems(items.filter((_, j) => j !== k))} hitSlop={10}>
                <Icon name="close" size={20} color={colors.muted} />
              </Pressable>
            </View>
          ))}
          {camps.isLoading ? <ActivityIndicator color={colors.brandPrimary} /> : null}
          {!camps.isLoading && !list.length ? <Text style={styles.muted}>{`Maak eerst een ${T.one}, dan kun je dit erop zetten.`}</Text> : null}
          {list.length > 1 ? (
            <>
              <Text style={styles.label}>{`Op ${T.de === "het" ? "welk" : "welke"} ${T.one}?`}</Text>
              <CampChips camps={list} value={camp?.id ?? null} onChange={setCampId} />
            </>
          ) : null}
          {camp ? <Big label={`Op ${camp.name} zetten`} icon="playlist-plus" busy={add.isPending} onPress={() => add.mutate()} testID="ai-items-add" /> : null}
          <Err error={add.error} />
        </View>
      ) : null}
    </View>
  );
}

type Tip = { kind: string; text: string; saving: number | null; from_id: string | null; to: Prod | null };

// 5. Slimme bespaartips
export function TipsTab({ campId: initial }: { campId?: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const T = useTerms();
  const qc = useQueryClient();
  const toast = useToast();
  const camps = useCamps();
  const list = camps.data?.camps ?? [];
  const [campId, setCampId] = useState<string | null>(initial ?? null);
  const camp = list.find((c) => c.id === campId) ?? list[0];
  const [done, setDone] = useState<Set<number>>(new Set());
  const tips = useQuery({
    queryKey: ["ai-tips", camp?.id],
    queryFn: () => api<{ tips: Tip[]; total: number }>(`/ai/savings-tips?camp_id=${camp!.id}`),
    enabled: !!camp,
    staleTime: 5 * 60_000,
  });
  useEffect(() => setDone(new Set()), [camp?.id]);
  const swap = useMutation({
    mutationFn: ({ tip }: { tip: Tip; k: number }) => api(`/camps/${camp!.id}/product-swap`, { method: "POST", body: { from_id: tip.from_id, to_id: tip.to!.id } }),
    onSuccess: (_, { k, tip }) => {
      setDone((s) => new Set(s).add(k));
      qc.invalidateQueries({ queryKey: ["shopping", camp!.id] });
      toast.show(`Gewisseld naar ${tip.to!.name}`, "success");
    },
  });

  return (
    <View style={{ gap: 12 }}>
      <Intro icon="piggy-bank-outline" title="Slimme bespaartips" text="De app kijkt naar je boodschappenlijst: een grotere verpakking, een goedkoper merk van hetzelfde, acties en slim splitsen." />
      {camps.isLoading ? <ActivityIndicator color={colors.brandPrimary} /> : null}
      {!camps.isLoading && !list.length ? <Text style={styles.muted}>{`Maak eerst een ${T.one} met boodschappen.`}</Text> : null}
      {list.length > 1 ? <CampChips camps={list} value={camp?.id ?? null} onChange={setCampId} /> : null}
      {tips.isLoading ? <Waiting text="Je lijst wordt doorgerekend..." /> : null}
      <Err error={tips.error} />
      {tips.data ? (
        tips.data.tips.length ? (
          <>
            {tips.data.total > 0 ? (
              <View style={styles.hero}>
                <Text style={styles.muted}>Je kunt ongeveer besparen</Text>
                <Text style={styles.heroValue}>{euro(tips.data.total)}</Text>
              </View>
            ) : null}
            {tips.data.tips.map((t, k) => (
              <View key={k} style={styles.card}>
                <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
                  <Icon
                    name={t.kind === "groter" ? "package-variant-closed" : t.kind === "huismerk" ? "swap-horizontal" : t.kind === "actie" ? "tag-outline" : t.kind === "splitsen" ? "call-split" : "lightbulb-on-outline"}
                    size={22}
                    color={GOLD.icon}
                  />
                  <Text style={[styles.body, { flex: 1 }]}>{t.text}</Text>
                  {t.saving ? <Text style={styles.saving}>{euro(t.saving)}</Text> : null}
                </View>
                {t.to && t.from_id ? (
                  done.has(k) ? (
                    <Text style={[styles.small, { color: colors.success }]}>Gewisseld op je lijst</Text>
                  ) : (
                    <View style={styles.ingRow}>
                      {t.to.image ? <Image source={{ uri: t.to.image }} style={styles.thumb} resizeMode="contain" /> : null}
                      <Text style={[styles.small, { flex: 1 }]} numberOfLines={2}>
                        {t.to.name} · {t.to.unit} · {euro(t.to.price)}
                      </Text>
                      <Pressable onPress={() => swap.mutate({ tip: t, k })} style={styles.smallBtn} disabled={swap.isPending}>
                        <Text style={styles.smallBtnText}>Wisselen</Text>
                      </Pressable>
                    </View>
                  )
                ) : null}
              </View>
            ))}
          </>
        ) : (
          <Text style={styles.muted}>Geen tips: je lijst is al lekker voordelig (of nog leeg).</Text>
        )
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  freeNote: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: GOLD.border, backgroundColor: GOLD.bg, borderRadius: 12, padding: 10 },
  freeNoteText: { flex: 1, fontSize: 13, fontFamily: fonts.medium, color: GOLD.text },
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 10, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.divider },
  headerBtn: { width: 44, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 18, fontFamily: fonts.bold, color: colors.onSurface },
  tab: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 20, backgroundColor: GOLD.bg, borderWidth: 1, borderColor: GOLD.border },
  tabOn: { backgroundColor: GOLD.icon, borderColor: GOLD.icon },
  tabText: { fontSize: 13, fontFamily: fonts.semibold, color: GOLD.text },
  intro: { flexDirection: "row", gap: 12, backgroundColor: GOLD.bg, borderColor: GOLD.border, borderWidth: 1, borderRadius: 16, padding: 14 },
  introTitle: { fontSize: 16, fontFamily: fonts.bold, color: GOLD.text },
  introText: { fontSize: 13, lineHeight: 18, fontFamily: fonts.regular, color: GOLD.text },
  input: { minHeight: 80, borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 12, fontSize: 15, fontFamily: fonts.regular, color: colors.onSurface, backgroundColor: colors.surface, textAlignVertical: "top" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 16, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, maxWidth: "100%" },
  chipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { fontSize: 13, fontFamily: fonts.medium, color: colors.onSurfaceSecondary },
  chipTextOn: { color: colors.onBrandPrimary },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 48, borderRadius: 14, paddingHorizontal: 14, backgroundColor: colors.brandPrimary },
  btnGhost: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.brandPrimary },
  btnText: { fontSize: 15, fontFamily: fonts.bold },
  waiting: { flexDirection: "row", alignItems: "center", gap: 10 },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 14, gap: 10, backgroundColor: colors.surface },
  cardTitle: { fontSize: 17, fontFamily: fonts.bold, color: colors.onSurface },
  body: { fontSize: 14, lineHeight: 20, fontFamily: fonts.regular, color: colors.onSurfaceSecondary },
  muted: { fontSize: 13, lineHeight: 18, fontFamily: fonts.regular, color: colors.muted },
  small: { fontSize: 12, lineHeight: 16, fontFamily: fonts.regular, color: colors.muted },
  label: { fontSize: 13, fontFamily: fonts.semibold, color: colors.onSurface },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  ingRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  thumb: { width: 34, height: 34, borderRadius: 6, backgroundColor: "#FFFFFF" },
  photoRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  photo: { width: 56, height: 56, borderRadius: 10 },
  linkRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  link: { fontSize: 14, fontFamily: fonts.semibold, color: colors.brandPrimary },
  hero: { alignItems: "center", gap: 2, backgroundColor: colors.surfaceSecondary, borderRadius: 16, padding: 14 },
  heroValue: { fontSize: 28, fontFamily: fonts.bold, color: colors.success },
  saving: { fontSize: 14, fontFamily: fonts.bold, color: colors.success },
  smallBtn: { backgroundColor: colors.brandPrimary, borderRadius: 10, paddingVertical: 7, paddingHorizontal: 12 },
  smallBtnText: { fontSize: 13, fontFamily: fonts.bold, color: colors.onBrandPrimary },
}));
