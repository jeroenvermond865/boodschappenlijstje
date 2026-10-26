// Updates: als de server even herstart (bij een update) zie je een nette melding in plaats van foutmeldingen,
// en op de website zie je wanneer er een nieuwe versie klaarstaat.
import { useEffect, useRef, useState } from "react";
import { AppState, Platform, Pressable, Text, View } from "react-native";

import { Icon } from "@/src/components/ui";
import { fonts, makeStyles, useTheme } from "@/src/theme";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL ?? "";
let down = false;
const listeners = new Set<(v: boolean) => void>();

export function setServerDown(v: boolean) {
  if (down === v) return;
  down = v;
  listeners.forEach((l) => l(v));
}

export function UpdateNotices() {
  const styles = useStyles();
  const { colors } = useTheme();
  const [isDown, setIsDown] = useState(down);
  const [newVersion, setNewVersion] = useState(false);
  const loaded = useRef<string | null>(null);

  useEffect(() => {
    listeners.add(setIsDown);
    return () => {
      listeners.delete(setIsDown);
    };
  }, []);

  // Server weer terug? Elke paar seconden kijken
  useEffect(() => {
    if (!isDown) return;
    const t = setInterval(async () => {
      try {
        const r = await fetch(`${BASE}/healthz`, { cache: "no-store" });
        if (r.ok) setServerDown(false);
      } catch {}
    }, 4000);
    return () => clearInterval(t);
  }, [isDown]);

  // Website: nieuwe versie? Bij openen, elke 5 minuten en als je terugkomt naar het tabblad
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const check = async () => {
      try {
        const r = await fetch(`${BASE}/api/version`, { cache: "no-store" });
        const v = (await r.json())?.version as string | null;
        if (!v) return;
        if (loaded.current === null) loaded.current = v;
        else if (v !== loaded.current) setNewVersion(true);
      } catch {}
    };
    check();
    const t = setInterval(check, 5 * 60 * 1000);
    const sub = AppState.addEventListener("change", (s) => s === "active" && check());
    return () => {
      clearInterval(t);
      sub.remove();
    };
  }, []);

  if (isDown) {
    return (
      <View style={styles.overlay} pointerEvents="auto">
        <View style={styles.card}>
          <Icon name="rocket-launch-outline" size={40} color={colors.brandPrimary} />
          <Text style={styles.title}>Even geduld, we zijn aan het updaten</Text>
          <Text style={styles.text}>Slim Boodschappenlijstje krijgt een update. Over een minuutje ben je weer verder, deze pagina doet het daarna vanzelf weer.</Text>
        </View>
      </View>
    );
  }
  if (newVersion) {
    return (
      <View style={styles.bar}>
        <Icon name="star-four-points-outline" size={18} color={colors.onBrandPrimary} />
        <Text style={styles.barText}>Er is een nieuwe versie van de app.</Text>
        <Pressable
          onPress={() => {
            if (typeof window !== "undefined") window.location.reload();
          }}
          style={styles.barBtn}
        >
          <Text style={styles.barBtnText}>Vernieuwen</Text>
        </Pressable>
      </View>
    );
  }
  return null;
}

const useStyles = makeStyles((colors) => ({
  overlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(28,27,26,0.55)", alignItems: "center", justifyContent: "center", padding: 24, zIndex: 1000 },
  card: { backgroundColor: colors.surface, borderRadius: 20, padding: 24, gap: 10, alignItems: "center", maxWidth: 420 },
  title: { fontSize: 18, fontFamily: fonts.bold, color: colors.onSurface, textAlign: "center" },
  text: { fontSize: 14, lineHeight: 20, fontFamily: fonts.regular, color: colors.onSurfaceSecondary, textAlign: "center" },
  bar: { position: "absolute", left: 16, right: 16, bottom: 90, zIndex: 1000, flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.brandPrimary, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 14, maxWidth: 560, alignSelf: "center" },
  barText: { flex: 1, fontSize: 14, fontFamily: fonts.semibold, color: colors.onBrandPrimary },
  barBtn: { backgroundColor: colors.surface, borderRadius: 10, paddingVertical: 6, paddingHorizontal: 12 },
  barBtnText: { fontSize: 13, fontFamily: fonts.bold, color: colors.brandPrimary },
}));
