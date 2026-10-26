import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

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
  const qc = useQueryClient();
  // Je eerdere berichten, met de reactie van de beheerder
  const mine = useQuery({
    queryKey: ["feedback-mine"],
    queryFn: () => api<{ feedback: { feedback_id: string; message: string; reply?: string | null; reply_by?: string | null; folder?: string | null; new_reply: boolean; created_at?: string }[] }>("/feedback/mine"),
  });

  const send = useMutation({
    mutationFn: () => api("/feedback", { method: "POST", body: { message } }),
    onSuccess: () => {
      setMessage("");
      toast.show("Bedankt voor je feedback!", "success");
      qc.invalidateQueries({ queryKey: ["feedback-mine"] });
      qc.invalidateQueries({ queryKey: ["feedback-unread"] });
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
        {(mine.data?.feedback ?? []).length ? <Text style={[styles.label, { marginTop: 10 }]}>Jouw eerdere berichten</Text> : null}
        {(mine.data?.feedback ?? []).map((f) => (
          <View key={f.feedback_id} style={[styles.card, f.new_reply && styles.cardNew]}>
            <Text style={styles.msg}>{f.message}</Text>
            {f.reply ? (
              <View style={styles.reply}>
                <Text style={styles.replyBy}>
                  Reactie van {f.reply_by ?? "de beheerder"}
                  {f.folder ? ` · ${f.folder}` : ""}
                  {f.new_reply ? " · nieuw" : ""}
                </Text>
                <Text style={styles.msg}>{f.reply}</Text>
              </View>
            ) : (
              <Text style={styles.wait}>{f.folder ? f.folder : "Nog geen reactie"}</Text>
            )}
          </View>
        ))}
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
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 12, gap: 8 },
  cardNew: { borderColor: colors.brandPrimary },
  msg: { fontSize: 14, lineHeight: 20, fontFamily: fonts.regular, color: colors.onSurface },
  reply: { backgroundColor: colors.brandTertiary, borderRadius: 10, padding: 10, gap: 2 },
  replyBy: { fontSize: 12, fontFamily: fonts.bold, color: colors.brandPrimary },
  wait: { fontSize: 12, fontFamily: fonts.regular, color: colors.muted },
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
