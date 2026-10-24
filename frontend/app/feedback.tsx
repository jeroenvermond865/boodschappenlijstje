import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation } from "@tanstack/react-query";

import { Button, Icon } from "@/src/components/ui";
import { api } from "@/src/api";
import { goBack } from "@/src/nav";
import { useToast } from "@/src/toast";
import { fonts, makeStyles, useTheme } from "@/src/theme";

export default function FeedbackScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [message, setMessage] = useState("");

  const send = useMutation({
    mutationFn: () => api("/feedback", { method: "POST", body: { message } }),
    onSuccess: () => {
      setMessage("");
      toast.show("Bedankt voor je feedback!", "success");
      goBack("/");
    },
    onError: (e: any) => toast.show(e?.message ?? "Mislukt", "error"),
  });

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable testID="back-button" onPress={() => goBack("/")} hitSlop={10} style={styles.headerBtn}>
          <Icon name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Feedback & verbeteringen</Text>
        <View style={styles.headerBtn} />
      </View>
      <KeyboardAwareScrollView bottomOffset={20} contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>
          Heb je een tip, idee of loop je ergens tegenaan? Laat het hier weten — de beheerder leest het in de app.
        </Text>
        <View style={{ gap: 7 }}>
          <Text style={styles.label}>Jouw bericht</Text>
          <TextInput
            testID="feedback-input"
            value={message}
            onChangeText={setMessage}
            multiline
            placeholder="Schrijf hier je feedback of idee…"
            placeholderTextColor={colors.muted}
            style={styles.textInput}
          />
        </View>
        <Button
          label="Versturen"
          icon="send"
          onPress={() => message.trim() && send.mutate()}
          loading={send.isPending}
          disabled={!message.trim()}
          testID="feedback-send"
        />
      </KeyboardAwareScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  headerBtn: { width: 44, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 18, fontFamily: fonts.bold, color: colors.onSurface },
  intro: { fontSize: 14, fontFamily: fonts.regular, color: colors.onSurfaceSecondary, lineHeight: 20 },
  label: { fontSize: 13, fontFamily: fonts.semibold, color: colors.onSurfaceSecondary },
  textInput: {
    backgroundColor: colors.surfaceTertiary,
    borderRadius: 12,
    paddingHorizontal: 15,
    paddingVertical: 14,
    fontSize: 16,
    fontFamily: fonts.regular,
    color: colors.onSurface,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 140,
    textAlignVertical: "top",
  },
}));
