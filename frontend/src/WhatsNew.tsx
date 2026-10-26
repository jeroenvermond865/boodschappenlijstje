// Na een update: bovenin kort een melding met wat er nieuw is. Tik erop voor alles wat er veranderd is.
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, ScrollView, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import Modal from "@/src/components/Modal";
import { Button, Icon } from "@/src/components/ui";
import { useAuth } from "@/src/auth";
import { CHANGELOG, Change } from "@/src/changelog";
import { fonts, makeStyles, useTheme } from "@/src/theme";

const KEY = "whatsnew_seen";
const KIND: Record<Change["kind"], { label: string; icon: string }> = {
  nieuw: { label: "Nieuw", icon: "star-four-points-outline" },
  beter: { label: "Beter", icon: "arrow-up-bold-circle-outline" },
  opgelost: { label: "Opgelost", icon: "wrench-outline" },
};

export function WhatsNew() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { status, user } = useAuth();
  const latest = CHANGELOG[0];
  const [show, setShow] = useState(false);
  const [open, setOpen] = useState(false);
  const y = useRef(new Animated.Value(-120)).current;

  const ready = status === "authed" && !!user?.terms_ok && !!user?.onboarded;

  useEffect(() => {
    if (!ready || !latest) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    AsyncStorage.getItem(KEY)
      .then((seen) => {
        if (seen === latest.id) return;
        setShow(true);
        Animated.timing(y, { toValue: 0, duration: 380, easing: Easing.out(Easing.back(1.2)), useNativeDriver: true }).start();
        t = setTimeout(() => hide(), 9000); // kort laten zien
      })
      .catch(() => {});
    return () => {
      if (t) clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const markSeen = () => AsyncStorage.setItem(KEY, latest.id).catch(() => {});
  const hide = () => {
    markSeen();
    Animated.timing(y, { toValue: -140, duration: 260, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() => setShow(false));
  };

  if (!latest || (!show && !open)) return null;
  return (
    <>
      {show ? (
        <Animated.View style={[styles.wrap, { top: insets.top + 8, transform: [{ translateY: y }] }]} pointerEvents="box-none">
          <Pressable
            testID="whatsnew-banner"
            onPress={() => {
              setOpen(true);
              hide();
            }}
            style={styles.bar}
          >
            <Icon name="rocket-launch-outline" size={20} color={colors.onBrandPrimary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.barTitle}>De app is bijgewerkt: {latest.title.toLowerCase()}</Text>
              <Text style={styles.barText} numberOfLines={1}>
                {latest.changes[0]?.text} Tik voor alles.
              </Text>
            </View>
            <Pressable onPress={hide} hitSlop={10}>
              <Icon name="close" size={18} color={colors.onBrandPrimary} />
            </Pressable>
          </Pressable>
        </Animated.View>
      ) : null}
      <Modal visible={open} transparent onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={styles.title}>Wat is er nieuw?</Text>
            <Text style={styles.date}>{latest.date}</Text>
            <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 10, paddingVertical: 8 }}>
              {latest.changes.map((c, i) => (
                <View key={i} style={styles.row}>
                  <View style={styles.kind}>
                    <Icon name={KIND[c.kind].icon} size={14} color={colors.brandPrimary} />
                    <Text style={styles.kindText}>{KIND[c.kind].label}</Text>
                  </View>
                  <Text style={styles.text}>{c.text}</Text>
                </View>
              ))}
            </ScrollView>
            <Button label="Top!" onPress={() => setOpen(false)} testID="whatsnew-close" />
          </View>
        </View>
      </Modal>
    </>
  );
}

const useStyles = makeStyles((colors) => ({
  wrap: { position: "absolute", left: 12, right: 12, zIndex: 1001, alignItems: "center" },
  bar: {
    width: "100%",
    maxWidth: 560,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.brandPrimary,
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 14,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  barTitle: { fontSize: 14, fontFamily: fonts.bold, color: colors.onBrandPrimary },
  barText: { fontSize: 12, fontFamily: fonts.regular, color: colors.onBrandPrimary, opacity: 0.9 },
  backdrop: { flex: 1, backgroundColor: "rgba(28,27,26,0.45)", justifyContent: "center" },
  sheet: { backgroundColor: colors.surface, borderRadius: 20, width: "92%", maxWidth: 560, alignSelf: "center", maxHeight: "92%", padding: 18, gap: 6 },
  title: { fontSize: 20, fontFamily: fonts.bold, color: colors.onSurface },
  date: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted },
  row: { gap: 4 },
  kind: { flexDirection: "row", alignItems: "center", gap: 4 },
  kindText: { fontSize: 12, fontFamily: fonts.bold, color: colors.brandPrimary, textTransform: "uppercase" },
  text: { fontSize: 14, lineHeight: 20, fontFamily: fonts.regular, color: colors.onSurfaceSecondary },
}));
