import { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Icon } from "@/src/components/ui";
import { api } from "@/src/api";
import { goBack } from "@/src/nav";
import { useToast } from "@/src/toast";
import { fonts, makeStyles, useTheme } from "@/src/theme";

export default function StoreRequestScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState("");

  const request = useMutation({
    mutationFn: () => api<{ ok: boolean; already?: boolean }>("/store-requests", { method: "POST", body: { name: name.trim() } }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["store-requests-count"] });
      toast.show(res.already ? "Deze supermarkt is al aangevraagd" : "Aanvraag verstuurd, bedankt!", "success");
      setName("");
      goBack("/account");
    },
    onError: (e: any) => toast.show(e?.message ?? "Mislukt", "error"),
  });

  const canSend = name.trim().length > 0 && !request.isPending;

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable testID="back-button" onPress={() => goBack("/account")} hitSlop={10} style={styles.headerBtn}>
          <Icon name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Supermarkt aanvragen</Text>
        <View style={styles.headerBtn} />
      </View>

      <View style={{ padding: 16, gap: 12 }}>
        <Text style={styles.intro}>
          Mis je een supermarkt? Vraag hem hier aan. Wij koppelen dan het hele assortiment met prijzen en foto's.
        </Text>
        <TextInput
          testID="store-request-input"
          value={name}
          onChangeText={setName}
          placeholder="Bijv. Jumbo, Lidl, Plus"
          placeholderTextColor={colors.muted}
          style={styles.input}
          onSubmitEditing={() => canSend && request.mutate()}
          returnKeyType="send"
        />
        <Pressable
          testID="store-request-send"
          onPress={() => request.mutate()}
          disabled={!canSend}
          style={[styles.button, !canSend && { opacity: 0.5 }]}
        >
          {request.isPending ? (
            <ActivityIndicator color={colors.onBrandPrimary} />
          ) : (
            <Icon name="send" size={18} color={colors.onBrandPrimary} />
          )}
          <Text style={styles.buttonText}>Aanvragen</Text>
        </Pressable>
      </View>
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
  intro: { fontSize: 14, fontFamily: fonts.regular, color: colors.muted },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontFamily: fonts.regular,
    color: colors.onSurface,
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: colors.brandPrimary,
  },
  buttonText: { fontSize: 15, fontFamily: fonts.semibold, color: colors.onBrandPrimary },
}));
