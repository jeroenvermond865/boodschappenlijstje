import { Pressable, Text, View } from "react-native";
import Modal from "@/src/components/Modal";
import { useRouter } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";

import { Icon } from "@/src/components/ui";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { useAppSettings } from "@/src/settings";
import { fonts, getScheme, makeStyles } from "@/src/theme";

type Accent = { bg: string; border: string; text: string; icon: string };
// Goud (Premium) en paars (Ultra), met een eigen donkere variant. Lees ze in een render of in makeStyles,
// dan wisselen ze vanzelf mee met licht en donker.
function accent(light: Accent, dark: Accent): Accent {
  const pick = () => (getScheme() === "dark" ? dark : light);
  return {
    get bg() { return pick().bg; },
    get border() { return pick().border; },
    get text() { return pick().text; },
    get icon() { return pick().icon; },
  };
}

export const GOLD = accent(
  { bg: "#FBF1DC", border: "#E8C77A", text: "#7A5212", icon: "#B07A1E" },
  { bg: "#2B2415", border: "#5E4B22", text: "#F0DCAE", icon: "#E2AC52" },
);

export const ULTRA = accent(
  { bg: "#EFE8FB", border: "#B9A2E8", text: "#4A2D86", icon: "#7A52C9" },
  { bg: "#231C33", border: "#4F407C", text: "#DCCFF7", icon: "#A88BE6" },
);

// Kleur en ster per abonnement: Premium goud, Ultra paars (overal hetzelfde)
export const planAccent = (p?: PlanKey | null) => (p === "ultra" ? ULTRA : GOLD);
export const planIcon = (p?: PlanKey | null) => (p === "ultra" ? "star-shooting" : "star");

// Kleur van de functie: paars als hij bij Ultra hoort
export function useFeatureAccent(key?: FeatureKey) {
  const plan = usePlanOf(key);
  return { plan, c: planAccent(plan), icon: planIcon(plan), name: PLAN_NAME[plan] };
}

export type FeatureKey = "prijsalarm" | "prijsgeschiedenis" | "extra_besparen" | "slim_splitsen" | "weekmenu" | "voorraadkast" | "slimme_hulp" | "looproute" | "geen_advertenties";
export type PlanKey = "standaard" | "premium" | "ultra";

// more: langere uitleg op de functiepagina (Wat kan het allemaal?)
export const PREMIUM_FEATURES: { key: FeatureKey; icon: string; title: string; text: string; to?: string; where?: string; more?: string[] }[] = [
  { key: "prijsalarm", icon: "bell-ring-outline", title: "Prijsalarm", text: "Een seintje als een favoriet product in de aanbieding is of onder jouw prijs zakt.", to: "/alerts", where: "Bij Producten en bij elk product" },
  { key: "prijsgeschiedenis", icon: "chart-line", title: "Prijsgeschiedenis", text: "Zie hoe de prijs van een product zich ontwikkelt, zodat je weet of een aanbieding echt goed is.", to: "/products", where: "Open een product bij Producten" },
  { key: "extra_besparen", icon: "piggy-bank-outline", title: "Extra besparen", text: "In je bespaaroverzicht tellen ook je voorraadkast, slim splitsen en de acties op je boodschappendag mee.", to: "/savings", where: "Op Home: Bespaaroverzicht" },
  { key: "slim_splitsen", icon: "call-split", title: "Slim splitsen", text: "Haal elk product bij de winkel waar het het goedkoopst is. Wat je daarmee bespaart, telt mee in je bespaaroverzicht.", to: "/", where: "Bij je boodschappenlijst, onder Waar is je lijst het goedkoopst?",
    more: [
      "Zonder splitsen haal je alles bij één winkel. De app laat zien wat je lijst bij AH, Jumbo en Dirk kost.",
      "Tik op Gesplitst halen. De app kiest de goedkoopste combinatie en zet elk product bij de winkel waar het het minst kost.",
      "Zelf kiezen kan ook: tik op de winkels waar je heen wilt. Met 2 winkels scheelt het vaak al veel, met alle 3 het meest.",
      "Elke winkel krijgt een eigen lijstje, op de looproute van die winkel. Je ziet per product wat het bij de andere winkel had gekost.",
      "Liever toch één winkel? Tik bovenaan op Terug naar je eigen winkels.",
      "Wat je gesplitst haalt en afvinkt, telt mee in je bespaaroverzicht.",
    ] },
  { key: "weekmenu", icon: "calendar-star", title: "Automatisch weekmenu", text: "Een weekmenu met gerechten waarvan de ingrediënten nu in de aanbieding zijn.", to: "/camps", where: "Bovenaan in je planning" },
  { key: "voorraadkast", icon: "fridge-outline", title: "Voorraadkast", text: "Houd bij wat je al in huis hebt, dan gaat dat van je boodschappenlijst af.", to: "/pantry", where: "Op Home en bij je boodschappenlijst",
    more: [
      "Wat je al in huis hebt, gaat vanzelf van je boodschappenlijst af. Bij het product zie je: In je voorraadkast.",
      "Per product stel je in hoe vol het is (vol, half, bijna op) of hoeveel je er hebt (bijvoorbeeld 8 eieren).",
      "Vul je eigen verbruik in, zoals 10 eieren per week. Dan rekent de app uit wanneer het op is.",
      "Bijna op? Dan krijg je een seintje en kun je het met één tik op je lijstje zetten, genoeg voor deze en volgende week.",
      "Snel vullen met voorstellen: wat de meeste mensen al in huis hebben, zoals zout, olie en bloem. Je vinkt aan wat je hebt.",
      "Bij een recept tik je op Heb ik al en kies je hoe vol het nog is. Dan staat het meteen in je voorraadkast.",
      "Wat je niet hoeft te kopen omdat je het al had, telt mee in je bespaaroverzicht.",
    ] },
  { key: "slimme_hulp", icon: "auto-fix", title: "Slimme hulp", text: "Een menu uit één zin, koken met restjes, een recept of foto overnemen, je lijst inspreken en slimme bespaartips.", to: "/slim", where: "Op Home: Slimme hulp" },
  { key: "looproute", icon: "map-marker-path", title: "Looproute", text: "Je boodschappenlijst in de volgorde van de schappen in jouw winkel, zodat je niet heen en weer loopt.", to: "/", where: "Bij je boodschappenlijst" },
  { key: "geen_advertenties", icon: "cancel", title: "Geen advertenties", text: "Als er later advertenties komen, zie jij ze niet." },
];

export function usePremium() {
  const { user } = useAuth();
  return !!user?.premium;
}

// Heb je deze functie met jouw abonnement? Beheer kiest per functie: Standaard, Premium of Ultra
export function useFeature(key: FeatureKey) {
  const { user } = useAuth();
  if (user?.features) return user.features.includes(key);
  return !!user?.premium;
}

export type Plans = {
  levels: { key: PlanKey; label: string; price?: number | null; price_year?: number | null; ai_limit: number }[];
  features: { key: FeatureKey; title: string; plan: PlanKey }[];
  mine: PlanKey;
};

export function usePlans() {
  return useQuery({ queryKey: ["plans"], queryFn: () => api<Plans>("/plans"), staleTime: 10 * 60 * 1000 });
}

// Bij welk abonnement hoort een functie (voor de tekst op een slotje)
export function usePlanOf(key?: FeatureKey): PlanKey {
  const { data } = usePlans();
  return (key && data?.features.find((f) => f.key === key)?.plan) || "premium";
}

export const PLAN_NAME: Record<PlanKey, string> = { standaard: "Standaard", premium: "Premium", ultra: "Ultra" };

// Advertenties: staan nog uit (ads_enabled in de app-instellingen). Premium ziet ze nooit.
export function useShowAds() {
  const premium = useFeature("geen_advertenties");
  const s = useAppSettings() as { ads_enabled?: boolean };
  return !premium && !!s.ads_enabled;
}

// Vaste plek voor een advertentie; hier komt later de code van de advertentiepartij
export function AdSlot({ place }: { place: string }) {
  const show = useShowAds();
  const styles = useStyles();
  if (!show) return null;
  return (
    <View style={styles.ad} testID={`ad-${place}`}>
      <Text style={styles.adText}>Advertentie</Text>
    </View>
  );
}

// Wat je ziet bij een Premium-functie als je nog geen Premium hebt
export function PremiumLock({ title, text, plural, feature }: { title: string; text?: string; plural?: boolean; feature?: FeatureKey }) {
  const styles = useStyles();
  const router = useRouter();
  const plan = usePlanOf(feature);
  const name = PLAN_NAME[plan];
  const c = plan === "ultra" ? ULTRA : GOLD;
  return (
    <View style={[styles.lock, { backgroundColor: c.bg, borderColor: c.border }]} testID="premium-lock">
      <Icon name={planIcon(plan)} size={30} color={c.icon} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.lockTitle, { color: c.text }]}>{title} {plural ? `zijn ${name}-functies` : `is een ${name}-functie`}</Text>
        {text ? <Text style={[styles.lockText, { color: c.text }]}>{text}</Text> : null}
        <Pressable onPress={() => (feature ? router.push({ pathname: "/feature/[key]", params: { key: feature } }) : router.push("/premium"))} hitSlop={8} testID="premium-lock-more">
          <Text style={[styles.lockLink, { color: c.icon }]}>Probeer {name} ›</Text>
        </Pressable>
      </View>
    </View>
  );
}

const eur = (n: number) => `€ ${n.toFixed(2).replace(".", ",")}`;

// Wat Premium je oplevert, bij een lijstje: met Premium "dit scheelt je", zonder Premium "dit had je extra bespaard"
export function PremiumValue({ value, has: listHas }: { value?: number | null; has?: boolean }) {
  const styles = useStyles();
  const router = useRouter();
  const own = useFeature("extra_besparen");
  const acc = useFeatureAccent("extra_besparen");
  const has = listHas ?? own;
  if (!value || value < 0.5) return null;
  return (
    <Pressable onPress={() => router.push(has ? "/savings" : "/premium")} style={[styles.value, { backgroundColor: acc.c.bg, borderColor: acc.c.border }]} testID="premium-value">
      <Icon name="piggy-bank-outline" size={18} color={acc.c.icon} />
      <Text style={[styles.valueText, { color: acc.c.text }]}>
        {has ? `${acc.name} scheelt je bij dit lijstje ${eur(value)}` : `Met ${acc.name} had je hier ${eur(value)} extra bespaard`}
        {has ? "" : <Text style={{ fontFamily: fonts.bold }}> · Probeer {acc.name} ›</Text>}
      </Text>
    </Pressable>
  );
}

// Op Home: hoe lang je proef nog loopt, en als hij voorbij is één keer wat Premium je in die tijd opleverde
export function TrialNotice() {
  const styles = useStyles();
  const router = useRouter();
  const { user, refresh } = useAuth() as any;
  const ended = !!user?.trial_ended;
  const saved = useQuery({ queryKey: ["savings"], queryFn: () => api<{ premium_bought?: number; premium?: number }>("/savings"), enabled: ended });
  const seen = useMutation({ mutationFn: () => api("/auth/trial-seen", { method: "POST", body: {} }), onSettled: () => refresh?.() });
  if (user?.trial && user?.premium_until) {
    const days = Math.max(1, Math.ceil((new Date(user.premium_until).getTime() - Date.now()) / 86400000));
    return (
      <Pressable onPress={() => router.push("/premium")} style={[styles.value, { backgroundColor: GOLD.bg, borderColor: GOLD.border }]} testID="trial-banner">
        <Icon name="star-circle" size={18} color={GOLD.icon} />
        <Text style={[styles.valueText, { color: GOLD.text }]}>
          Je probeert Premium gratis: nog {days} {days === 1 ? "dag" : "dagen"} <Text style={{ fontFamily: fonts.bold }}>›</Text>
        </Text>
      </Pressable>
    );
  }
  if (!ended) return null;
  const amount = saved.data?.premium_bought || saved.data?.premium || 0;
  const close = (go?: boolean) => {
    seen.mutate();
    if (go) router.push("/premium");
  };
  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => close()}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Icon name="star-circle" size={40} color={GOLD.icon} />
          <Text style={styles.sheetTitle}>Je proefperiode is voorbij</Text>
          <Text style={styles.sheetText}>
            {amount >= 0.5
              ? `In de afgelopen 14 dagen bespaarde je ${eur(amount)} extra met Premium.`
              : "Je hebt 14 dagen alles van Premium kunnen proberen."}{" "}
            Je gaat nu verder met Standaard: alles wat je maakte, blijft gewoon staan.
          </Text>
          <Pressable onPress={() => close(true)} style={[styles.sheetBtn, { backgroundColor: GOLD.icon }]} testID="trial-ended-premium">
            <Text style={styles.sheetBtnText}>Bekijk Premium</Text>
          </Pressable>
          <Pressable onPress={() => close()} hitSlop={8} testID="trial-ended-later">
            <Text style={[styles.lockLink, { color: GOLD.icon, textDecorationLine: "none" }]}>Nu niet</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  lock: { flexDirection: "row", gap: 12, backgroundColor: GOLD.bg, borderColor: GOLD.border, borderWidth: 1, borderRadius: 16, padding: 14 },
  lockTitle: { fontSize: 15, fontFamily: fonts.bold, color: GOLD.text },
  lockText: { fontSize: 13, lineHeight: 18, fontFamily: fonts.regular, color: GOLD.text },
  ad: { minHeight: 60, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  adText: { fontSize: 11, fontFamily: fonts.regular, color: colors.muted },
  lockLink: { fontSize: 13, fontFamily: fonts.semibold, color: GOLD.icon, marginTop: 4, textDecorationLine: "underline" },
  value: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 12, paddingVertical: 9, paddingHorizontal: 12 },
  valueText: { flex: 1, fontSize: 13, fontFamily: fonts.semibold },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center" },
  sheet: { backgroundColor: colors.surface, borderRadius: 20, width: "90%", maxWidth: 440, alignSelf: "center", padding: 22, gap: 12, alignItems: "center" },
  sheetTitle: { fontSize: 20, fontFamily: fonts.bold, color: colors.onSurface, textAlign: "center" },
  sheetText: { fontSize: 15, lineHeight: 21, fontFamily: fonts.regular, color: colors.onSurface, textAlign: "center" },
  sheetBtn: { alignSelf: "stretch", alignItems: "center", borderRadius: 14, paddingVertical: 13 },
  sheetBtnText: { fontSize: 15, fontFamily: fonts.semibold, color: "#FFFFFF" },
}));
