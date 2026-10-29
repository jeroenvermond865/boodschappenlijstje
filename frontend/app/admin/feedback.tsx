import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { EmptyState, Icon } from "@/src/components/ui";
import { api } from "@/src/api";
import { goBack } from "@/src/nav";
import { useRouter } from "expo-router";
import { useToast } from "@/src/toast";
import { fonts, makeStyles, useTheme } from "@/src/theme";

type Feedback = {
  feedback_id: string;
  message: string;
  user_name?: string;
  status: string;
  created_at?: string;
  folder?: string | null;
  reply?: string | null;
  replied_at?: string | null;
};

// Mappen: nieuw binnen, en daarna verwerkt als gebruikt, niet gebruikt of voor later
const TABS = [
  { key: "open", label: "Nieuw" },
  { key: "gebruikt", label: "Gebruikt" },
  { key: "niet_gebruikt", label: "Niet gebruikt" },
  { key: "later", label: "Voor later" },
] as const;

export default function AdminFeedbackScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const qc = useQueryClient();
  const router = useRouter();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-feedback"],
    queryFn: () => api<{ feedback: Feedback[] }>("/admin/feedback"),
  });
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("open");
  const inTab = (f: Feedback) => (tab === "open" ? !f.folder : f.folder === tab);
  const list = (data?.feedback ?? []).filter(inTab);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin-feedback"] });
    qc.invalidateQueries({ queryKey: ["feedback-count"] });
  };

  const markRead = useMutation({
    mutationFn: (id: string) => api(`/admin/feedback/${id}/read`, { method: "POST" }),
    onSuccess: invalidate,
  });
  const reply = useMutation({
    mutationFn: (v: { id: string; reply: string; folder: string | null }) =>
      api(`/admin/feedback/${v.id}/reply`, { method: "POST", body: { reply: v.reply, folder: v.folder } }),
    onSuccess: (_, v) => {
      invalidate();
      toast.show(v.reply ? "Reactie verstuurd" : "Verplaatst", "success");
    },
    onError: (e: any) => toast.show(e?.message ?? "Mislukt", "error"),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/admin/feedback/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidate();
      toast.show("Verwijderd", "info");
    },
  });

  const fmt = (iso?: string) => {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable testID="back-button" onPress={() => goBack("/")} hitSlop={10} style={styles.headerBtn}>
          <Icon name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Feedback & aanvragen</Text>
        <View style={styles.headerBtn} />
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.brandPrimary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 12 }} keyboardShouldPersistTaps="handled">
          <Pressable testID="admin-store-requests-link" onPress={() => router.push("/admin/store-requests")} style={[styles.tab, { flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "stretch" }]}>
            <Icon name="storefront-outline" size={18} color={colors.brandPrimary} />
            <Text style={[styles.tabText, { flex: 1 }]}>Supermarkt-aanvragen</Text>
            <Icon name="chevron-right" size={20} color={colors.muted} />
          </Pressable>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {TABS.map((t) => {
              const n = (data?.feedback ?? []).filter((f) => (t.key === "open" ? !f.folder : f.folder === t.key)).length;
              return (
                <Pressable key={t.key} onPress={() => setTab(t.key)} style={[styles.tab, tab === t.key && styles.tabOn]}>
                  <Text style={[styles.tabText, tab === t.key && styles.tabTextOn]}>
                    {t.label} ({n})
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
          {!list.length ? (
            <EmptyState icon="message-text-outline" title="Niets in deze map" subtitle="Reacties en ideeën van gebruikers verschijnen bij Nieuw." />
          ) : null}
          {list.map((f) => (
            <FeedbackCard
              key={f.feedback_id}
              f={f}
              date={fmt(f.created_at)}
              onRead={() => markRead.mutate(f.feedback_id)}
              onDelete={() => remove.mutate(f.feedback_id)}
              onReply={(text, folder) => reply.mutate({ id: f.feedback_id, reply: text, folder })}
              busy={reply.isPending}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function FeedbackCard({
  f,
  date,
  onRead,
  onDelete,
  onReply,
  busy,
}: {
  f: Feedback;
  date: string;
  onRead: () => void;
  onDelete: () => void;
  onReply: (text: string, folder: string | null) => void;
  busy: boolean;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [text, setText] = useState("");
  const [folder, setFolder] = useState<string | null>(f.folder ?? null);
  return (
    <View style={[styles.card, f.status === "new" && styles.cardNew]} testID={`feedback-${f.feedback_id}`}>
      <View style={styles.cardHead}>
        <Text style={styles.author}>{f.user_name ?? "Gebruiker"}</Text>
        {f.status === "new" ? <View style={styles.dot} /> : null}
        <Text style={styles.date}>{date}</Text>
      </View>
      <Text style={styles.message}>{f.message}</Text>
      {f.reply ? (
        <View style={styles.replyBox}>
          <Text style={styles.replyLabel}>Jouw reactie</Text>
          <Text style={styles.message}>{f.reply}</Text>
        </View>
      ) : null}
      <TextInput
        value={text}
        onChangeText={setText}
        multiline
        placeholder={f.reply ? "Nog een reactie sturen…" : "Reageer: wat heb je ermee gedaan?"}
        placeholderTextColor={colors.muted}
        style={styles.input}
      />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {TABS.filter((t) => t.key !== "open").map((t) => (
          <Pressable key={t.key} onPress={() => setFolder(folder === t.key ? null : t.key)} style={[styles.tab, folder === t.key && styles.tabOn]}>
            <Text style={[styles.tabText, folder === t.key && styles.tabTextOn]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.actions}>
        <Pressable
          testID={`feedback-reply-${f.feedback_id}`}
          disabled={busy || (!text.trim() && folder === (f.folder ?? null))}
          onPress={() => {
            onReply(text.trim(), folder);
            setText("");
          }}
          style={[styles.actionBtn, busy || (!text.trim() && folder === (f.folder ?? null)) ? { opacity: 0.4 } : null]}
        >
          <Icon name="send" size={16} color={colors.brandPrimary} />
          <Text style={[styles.actionText, { color: colors.brandPrimary }]}>{text.trim() ? "Versturen" : "Opslaan"}</Text>
        </Pressable>
        {f.status === "new" ? (
          <Pressable testID={`feedback-read-${f.feedback_id}`} onPress={onRead} style={styles.actionBtn}>
            <Icon name="check" size={16} color={colors.brandPrimary} />
            <Text style={[styles.actionText, { color: colors.brandPrimary }]}>Gelezen</Text>
          </Pressable>
        ) : null}
        <Pressable testID={`feedback-delete-${f.feedback_id}`} onPress={onDelete} style={styles.actionBtn}>
          <Icon name="trash-can-outline" size={16} color={colors.error} />
          <Text style={[styles.actionText, { color: colors.error }]}>Verwijderen</Text>
        </Pressable>
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  tab: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: colors.border },
  tabOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  tabText: { fontSize: 13, fontFamily: fonts.medium, color: colors.onSurface },
  tabTextOn: { color: colors.onBrandPrimary },
  replyBox: { backgroundColor: colors.surfaceTertiary, borderRadius: 12, padding: 10, gap: 2 },
  replyLabel: { fontSize: 12, fontFamily: fonts.bold, color: colors.brandPrimary },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 10, minHeight: 60, fontSize: 14, fontFamily: fonts.regular, color: colors.onSurface, textAlignVertical: "top" },
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
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 40 },
  card: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 8 },
  cardNew: { borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  author: { fontSize: 15, fontFamily: fonts.bold, color: colors.onSurface },
  dot: { width: 8, height: 8, borderRadius: 999, backgroundColor: colors.brandPrimary },
  date: { flex: 1, textAlign: "right", fontSize: 12, fontFamily: fonts.regular, color: colors.muted },
  message: { fontSize: 15, fontFamily: fonts.regular, color: colors.onSurface, lineHeight: 21 },
  actions: { flexDirection: "row", gap: 16, marginTop: 2 },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 4 },
  actionText: { fontSize: 13, fontFamily: fonts.semibold },
}));
