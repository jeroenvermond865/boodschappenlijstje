import { createElement } from "react";
import { Platform, TextInput } from "react-native";

import { fonts, useTheme } from "@/src/theme";

// Datum kiezen (JJJJ-MM-DD); in de browser met de eigen datumkiezer van het toestel
export function DateField({ value, onChange, testID }: { value: string; onChange: (v: string) => void; testID?: string }) {
  const { colors } = useTheme();
  const style = {
    borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15,
    fontFamily: fonts.regular, color: colors.onSurface, backgroundColor: colors.surface,
  };
  if (Platform.OS === "web") {
    return createElement("input", {
      type: "date", value, "data-testid": testID, onChange: (e: any) => onChange(e.target.value),
      style: { ...style, borderStyle: "solid", width: "100%", boxSizing: "border-box", minHeight: 44 },
    });
  }
  return <TextInput testID={testID} value={value} onChangeText={onChange} placeholder="JJJJ-MM-DD" placeholderTextColor={colors.muted} style={style} />;
}

export function niceDate(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "long" });
}
