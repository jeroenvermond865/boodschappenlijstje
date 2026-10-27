import { useEffect, useRef, useState } from "react";
import { Animated, Pressable, ScrollView, Text } from "react-native";
import { useQuery } from "@tanstack/react-query";

import { api } from "@/src/api";
import { Icon } from "@/src/components/ui";
import { useDebounced } from "@/src/search";
import { matchScore } from "@/src/smartSearch";
import { fonts, makeStyles, useTheme } from "@/src/theme";

// Suggesties onder een zoekbalk: "tomaten" -> tomatensoep, tomatenpuree; "soep" -> kippensoep, tomatensoep.
// De server zoekt ze eerst zonder AI op en onthoudt wat er gekozen en vaak getypt wordt.
export type SuggestKind = "products" | "dishes";

export function learnSearch(q: string, pick: string, kind: SuggestKind) {
  api("/search/learn", { method: "POST", body: { q, pick, kind } }).catch(() => {});
}

export default function SearchSuggestions({
  q,
  onPick,
  kind = "products",
  within,
  testID,
}: {
  q: string;
  onPick: (s: string) => void;
  kind?: SuggestKind;
  // Zoek je in een vaste lijst (zoals je eigen gerechten)? Dan alleen suggesties die daarin iets vinden
  within?: string[];
  testID?: string;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const dq = useDebounced(q.trim(), 300);
  const [picked, setPicked] = useState<string | null>(null);
  const fade = useRef(new Animated.Value(0)).current;
  const { data } = useQuery({
    queryKey: ["suggest", kind, dq.toLowerCase()],
    queryFn: () => api<{ suggestions: string[] }>(`/search/suggest?kind=${kind}&q=${encodeURIComponent(dq)}`),
    enabled: dq.length >= 3,
    staleTime: 10 * 60 * 1000,
  });
  let list = dq.length >= 3 && dq.toLowerCase() !== picked ? data?.suggestions ?? [] : [];
  if (within) list = list.filter((s) => within.some((t) => matchScore(s, t) >= 0));

  // Wat iemand een tijdje laat staan, telt als zoekwoord (de server bewaart alleen bestaande woorden)
  useEffect(() => {
    if (dq.length < 3 || dq.toLowerCase() === picked) return;
    const t = setTimeout(() => learnSearch(dq, "", kind), 2500);
    return () => clearTimeout(t);
  }, [dq, kind, picked]);

  useEffect(() => {
    fade.setValue(0);
    if (list.length) Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: true }).start();
  }, [list.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!list.length) return null;
  return (
    <Animated.View style={{ opacity: fade }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.row} testID={testID}>
        <Icon name="lightbulb-on-outline" size={16} color={colors.muted} />
        {list.map((s) => (
          <Pressable
            key={s}
            onPress={() => {
              setPicked(s.toLowerCase());
              learnSearch(dq, s, kind);
              onPick(s);
            }}
            style={styles.chip}
          >
            <Text style={styles.chipText}>{s}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </Animated.View>
  );
}

const useStyles = makeStyles((colors) => ({
  row: { gap: 6, alignItems: "center", paddingVertical: 2 },
  chip: {
    height: 30,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: colors.brandTertiary,
    justifyContent: "center",
  },
  chipText: { fontSize: 13, fontFamily: fonts.medium, color: colors.onBrandTertiary },
}));
