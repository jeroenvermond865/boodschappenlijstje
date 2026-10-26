import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";

import { Icon } from "@/src/components/ui";
import { useAuth } from "@/src/auth";
import { useAppSettings } from "@/src/settings";
import { fonts, makeStyles } from "@/src/theme";

export const GOLD = { bg: "#FBF1DC", border: "#E8C77A", text: "#7A5212", icon: "#B07A1E" };

export const PREMIUM_FEATURES: { icon: string; title: string; text: string }[] = [
  { icon: "bell-ring-outline", title: "Prijsalarm", text: "Een seintje als een favoriet product in de aanbieding is of onder jouw prijs zakt." },
  { icon: "chart-line", title: "Prijsgeschiedenis", text: "Zie hoe de prijs van een product zich ontwikkelt, zodat je weet of een aanbieding echt goed is." },
  { icon: "piggy-bank-outline", title: "Bespaaroverzicht", text: "Hoeveel je per maand bespaart door slim te kiezen." },
  { icon: "calendar-star", title: "Automatisch weekmenu", text: "Een weekmenu met gerechten waarvan de ingrediënten nu in de aanbieding zijn." },
  { icon: "fridge-outline", title: "Voorraadkast", text: "Houd bij wat je al in huis hebt, dan gaat dat van je boodschappenlijst af." },
  { icon: "cancel", title: "Geen advertenties", text: "Als er later advertenties komen, zie jij ze niet." },
];

export function usePremium() {
  const { user } = useAuth();
  return !!user?.premium;
}

// Advertenties: staan nog uit (ads_enabled in de app-instellingen). Premium ziet ze nooit.
export function useShowAds() {
  const premium = usePremium();
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
export function PremiumLock({ title, text, plural }: { title: string; text?: string; plural?: boolean }) {
  const styles = useStyles();
  const router = useRouter();
  return (
    <View style={styles.lock} testID="premium-lock">
      <Icon name="star-circle" size={30} color={GOLD.icon} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.lockTitle}>{title} {plural ? "zijn Premium-functies" : "is een Premium-functie"}</Text>
        {text ? <Text style={styles.lockText}>{text}</Text> : null}
        <Pressable onPress={() => router.push("/premium")} hitSlop={8} testID="premium-lock-more">
          <Text style={styles.lockLink}>Meer over Premium</Text>
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
