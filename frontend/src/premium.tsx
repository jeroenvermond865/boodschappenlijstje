import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { Icon } from "@/src/components/ui";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { useAppSettings } from "@/src/settings";
import { fonts, makeStyles } from "@/src/theme";

export const GOLD = { bg: "#FBF1DC", border: "#E8C77A", text: "#7A5212", icon: "#B07A1E" };

export const ULTRA = { bg: "#EFE8FB", border: "#B9A2E8", text: "#4A2D86", icon: "#7A52C9" };

export type FeatureKey = "prijsalarm" | "prijsgeschiedenis" | "extra_besparen" | "slim_splitsen" | "weekmenu" | "voorraadkast" | "slimme_hulp" | "looproute" | "geen_advertenties";
export type PlanKey = "standaard" | "premium" | "ultra";

export const PREMIUM_FEATURES: { key: FeatureKey; icon: string; title: string; text: string; to?: string; where?: string }[] = [
  { key: "prijsalarm", icon: "bell-ring-outline", title: "Prijsalarm", text: "Een seintje als een favoriet product in de aanbieding is of onder jouw prijs zakt.", to: "/alerts", where: "Bij Producten en bij elk product" },
  { key: "prijsgeschiedenis", icon: "chart-line", title: "Prijsgeschiedenis", text: "Zie hoe de prijs van een product zich ontwikkelt, zodat je weet of een aanbieding echt goed is.", to: "/products", where: "Open een product bij Producten" },
  { key: "extra_besparen", icon: "piggy-bank-outline", title: "Extra besparen", text: "In je bespaaroverzicht tellen ook je voorraadkast, slim splitsen en de acties op je boodschappendag mee.", to: "/savings", where: "Op Home: Bespaaroverzicht" },
  { key: "slim_splitsen", icon: "call-split", title: "Slim splitsen", text: "Haal elk product bij de winkel waar het het goedkoopst is. Wat je daarmee bespaart, telt mee in je bespaaroverzicht.", to: "/", where: "Op Home bij de prijsvergelijking" },
  { key: "weekmenu", icon: "calendar-star", title: "Automatisch weekmenu", text: "Een weekmenu met gerechten waarvan de ingrediënten nu in de aanbieding zijn.", to: "/camps", where: "Bovenaan in je planning" },
  { key: "voorraadkast", icon: "fridge-outline", title: "Voorraadkast", text: "Houd bij wat je al in huis hebt, dan gaat dat van je boodschappenlijst af.", to: "/pantry", where: "Op Home en bij je boodschappenlijst" },
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
  levels: { key: PlanKey; label: string; price?: number | null; ai_limit: number }[];
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
      <Icon name="star-circle" size={30} color={c.icon} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.lockTitle, { color: c.text }]}>{title} {plural ? `zijn ${name}-functies` : `is een ${name}-functie`}</Text>
        {text ? <Text style={[styles.lockText, { color: c.text }]}>{text}</Text> : null}
        <Pressable onPress={() => router.push("/premium")} hitSlop={8} testID="premium-lock-more">
          <Text style={[styles.lockLink, { color: c.icon }]}>Bekijk wat het kost en wat je krijgt</Text>
        </Pressable>
      </View>
    </View>
  );
}

const useStyles = makeStyles(() => ({
  lock: { flexDirection: "row", gap: 12, backgroundColor: GOLD.bg, borderColor: GOLD.border, borderWidth: 1, borderRadius: 16, padding: 14 },
  lockTitle: { fontSize: 15, fontFamily: fonts.bold, color: GOLD.text },
  lockText: { fontSize: 13, lineHeight: 18, fontFamily: fonts.regular, color: GOLD.text },
  ad: { minHeight: 60, borderRadius: 12, borderWidth: 1, borderColor: "#ddd", alignItems: "center", justifyContent: "center" },
  adText: { fontSize: 11, fontFamily: fonts.regular, color: "#999" },
  lockLink: { fontSize: 13, fontFamily: fonts.semibold, color: GOLD.icon, marginTop: 4, textDecorationLine: "underline" },
}));
