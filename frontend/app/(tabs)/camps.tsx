import { useCallback, useState } from "react";
import Modal from "@/src/components/Modal";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Animated, { FadeInDown } from "react-native-reanimated";

import { PressScale, SkeletonList } from "@/src/components/motion";
import { Button, EmptyState, Icon } from "@/src/components/ui";
import { api } from "@/src/api";
import { cachedApi } from "@/src/offline";
import { usesNativeTabs } from "@/src/navigation";
import { useAppSettings, useTerms } from "@/src/settings";
import { useToast } from "@/src/toast";
import { fonts, makeStyles, softShadow, useTheme } from "@/src/theme";

type Day = { index: number; adults: number; children: number; is_shopping_day: boolean };
type Camp = { id: string; name: string; days: Day[] };

export default function CampsScreen() {
  const styles = useStyles();
  const T = useTerms();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const s = useAppSettings();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;

  // Bewaarde (gearchiveerde) lijstjes: niet weggegooid, alleen uit het gewone overzicht
  const [showArchived, setShowArchived] = useState(false);
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: showArchived ? ["camps", "archived"] : ["camps"],
    queryFn: () => cachedApi<{ camps: Camp[]; archived_count?: number }>(showArchived ? "/camps?archived=true" : "/camps"),
  });
  const archivedCount = useQuery({
    queryKey: ["camps"],
    queryFn: () => cachedApi<{ camps: Camp[]; archived_count?: number }>("/camps"),
    enabled: showArchived,
  }).data?.archived_count ?? data?.archived_count ?? 0;

  const archive = useMutation({
    mutationFn: ({ id, keep }: { id: string; keep: boolean }) => api(`/camps/${id}/archive?keep=${keep}`, { method: "POST" }),
    onSuccess: (_d, { id, keep }) => {
      setAsk(null);
      qc.invalidateQueries({ queryKey: ["camps"] });
      qc.invalidateQueries({ queryKey: ["home"] });
      if (keep) toast.show(`${T.One} bewaard`, "success", { label: "Ongedaan maken", onPress: () => archive.mutate({ id, keep: false }) });
      else toast.show(`${T.One} staat weer bij je ${T.many}`, "success");
    },
    onError: (e: any) => toast.show(e?.message ?? "Bewaren mislukt", "error"),
  });

  const restore = useMutation({
    mutationFn: (id: string) => api(`/camps/${id}/restore`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["camps"] }),
    onError: (e: any) => toast.show(e?.message ?? "Herstellen mislukt", "error"),
  });

  const duplicate = useMutation({
    mutationFn: (id: string) => api(`/camps/${id}/duplicate`, { method: "POST" }),
    onSuccess: () => {
      toast.show(`${T.One} gekopieerd`, "success");
      qc.invalidateQueries({ queryKey: ["camps"] });
    },
    onError: (e: any) => toast.show(e?.message ?? "Kopiëren mislukt", "error"),
  });

  // Verwijderen: wat al is afgevinkt (gekocht) mag blijven meetellen in je bespaaroverzicht
  const [ask, setAsk] = useState<Camp | null>(null);
  const del = useMutation({
    mutationFn: ({ id, keep }: { id: string; keep: boolean }) => api(`/camps/${id}?keep_savings=${keep}`, { method: "DELETE" }),
    onSuccess: (_d, { id }) => {
      setAsk(null);
      qc.invalidateQueries({ queryKey: ["savings"] });
      qc.invalidateQueries({ queryKey: ["camps"] });
      toast.show(`${T.One} verwijderd`, "info", { label: "Ongedaan maken", onPress: () => restore.mutate(id) });
    },
    onError: (e: any) => toast.show(e?.message ?? "Verwijderen mislukt", "error"),
  });

  const renderCard = useCallback(
    ({ item, index }: { item: Camp; index: number }) => {
      const totalAdults = item.days.reduce((s, d) => s + d.adults, 0);
      const totalChildren = item.days.reduce((s, d) => s + d.children, 0);
      const maxPeople = item.days.reduce((m, d) => Math.max(m, d.adults + d.children), 0);
      return (
        <Animated.View entering={FadeInDown.delay(Math.min(index, 6) * 40).duration(260)}>
          <PressScale
            testID={`camp-card-${item.id}`}
            onPress={() => router.push(`/camp/${item.id}`)}
            style={styles.card}
          >
            <View style={styles.cardIcon}>
              <Icon name="clipboard-list-outline" size={24} color={colors.brandPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={styles.cardMeta}>
                {item.days.length} {item.days.length === 1 ? "dag" : "dagen"} · max {maxPeople} pers.
              </Text>
              <View style={styles.badgeRow}>
                <View style={styles.badge}>
                  <Icon name="account" size={13} color={colors.onBrandTertiary} />
                  <Text style={styles.badgeText}>{totalAdults} volw.</Text>
                </View>
                <View style={styles.badge}>
                  <Icon name="account-child" size={13} color={colors.onBrandTertiary} />
                  <Text style={styles.badgeText}>{totalChildren} kind.</Text>
                </View>
              </View>
            </View>
            <View style={styles.cardActions}>
              {showArchived ? (
                <Pressable
                  testID={`camp-unarchive-${item.id}`}
                  hitSlop={8}
                  onPress={() => archive.mutate({ id: item.id, keep: false })}
                  style={styles.cardActionBtn}
                  accessibilityLabel="Terugzetten"
                >
                  <Icon name="archive-arrow-up-outline" size={20} color={colors.brandPrimary} />
                </Pressable>
              ) : (
                <Pressable
                  testID={`camp-archive-${item.id}`}
                  hitSlop={8}
                  onPress={() => archive.mutate({ id: item.id, keep: true })}
                  style={styles.cardActionBtn}
                  accessibilityLabel="Bewaren"
                >
                  <Icon name="archive-arrow-down-outline" size={20} color={colors.muted} />
                </Pressable>
              )}
              <Pressable
                testID={`camp-duplicate-${item.id}`}
                hitSlop={8}
                onPress={() => duplicate.mutate(item.id)}
                style={styles.cardActionBtn}
              >
                <Icon name="content-copy" size={19} color={colors.muted} />
              </Pressable>
              <Pressable
                testID={`camp-delete-${item.id}`}
                hitSlop={8}
                onPress={() => setAsk(item)}
                style={styles.cardActionBtn}
              >
                <Icon name="trash-can-outline" size={20} color={colors.muted} />
              </Pressable>
            </View>
          </PressScale>
        </Animated.View>
      );
    },
    [styles, colors, router, del, duplicate, archive, showArchived],
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>{s.tab_camps}</Text>
        <Text style={styles.subtitle}>{showArchived ? `Bewaarde ${T.many}: niet weg, alleen uit je overzicht. Zet ze terug wanneer je wilt.` : s.sub_camps}</Text>
        {showArchived || archivedCount > 0 ? (
          <Pressable testID="camps-archived-toggle" onPress={() => setShowArchived((v) => !v)} hitSlop={6} style={styles.archToggle}>
            <Icon name={showArchived ? "arrow-left" : "archive-outline"} size={17} color={colors.brandPrimary} />
            <Text style={styles.archToggleText}>{showArchived ? `Terug naar ${T.many}` : `Bewaarde ${T.many} (${archivedCount})`}</Text>
          </Pressable>
        ) : null}
      </View>

      {isLoading ? (
        <SkeletonList rows={4} />
      ) : isError ? (
        <View style={styles.center}>
          <EmptyState icon="wifi-off" title={`Kon ${T.many} niet laden`} subtitle="Controleer je verbinding" />
          <Button label="Opnieuw" variant="secondary" onPress={() => refetch()} style={{ marginTop: 12 }} />
        </View>
      ) : (
        <FlatList
          data={data?.camps ?? []}
          keyExtractor={(c) => c.id}
          renderItem={renderCard}
          contentContainerStyle={{ padding: 16, paddingBottom: bottomChrome + 96, gap: 12 }}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.brandPrimary} />
          }
          ListEmptyComponent={
            showArchived ? (
              <EmptyState icon="archive-outline" title={`Geen bewaarde ${T.many}`} subtitle={`Tik bij ${T.de} ${T.one} op het doosje om hem te bewaren.`} />
            ) : (
            <EmptyState
              icon="clipboard-list-outline"
              title={`Nog geen ${T.many} gepland`}
              subtitle={`Maak een ${T.one} aan en plan per dag de maaltijden en het aantal personen.`}
            />
            )
          }
        />
      )}

      <Pressable
        testID="new-camp-fab"
        onPress={() => router.push("/camp/new")}
        style={({ pressed }) => [styles.fab, { bottom: bottomChrome + 16 }, pressed && { opacity: 0.9 }]}
      >
        <Icon name="plus" size={22} color={colors.onBrandPrimary} />
        <Text style={styles.fabText}>{`${T.nieuw[0].toUpperCase()}${T.nieuw.slice(1)} ${T.one}`}</Text>
      </Pressable>
      <Modal visible={!!ask} transparent animationType="fade" onRequestClose={() => setAsk(null)}>
        <Pressable style={styles.askBackdrop} onPress={() => setAsk(null)}>
          <Pressable style={styles.askBox} onPress={() => {}}>
            <Text style={styles.cardTitle}>"{ask?.name}" verwijderen?</Text>
            <Text style={styles.askText}>
              Wat je op dit lijstje al hebt afgevinkt, heb je gekocht. Die besparing kan blijven meetellen in je bespaaroverzicht.
            </Text>
            <Button
              label={`Liever bewaren (niet weggooien)`}
              icon="archive-arrow-down-outline"
              variant="secondary"
              loading={archive.isPending}
              onPress={() => ask && archive.mutate({ id: ask.id, keep: true })}
              testID="camp-delete-archive"
            />
            <Button
              label="Verwijderen, besparing bewaren"
              icon="piggy-bank-outline"
              loading={del.isPending && del.variables?.keep === true}
              onPress={() => ask && del.mutate({ id: ask.id, keep: true })}
              testID="camp-delete-keep"
            />
            <Button
              label="Verwijderen en alles vergeten"
              icon="trash-can-outline"
              variant="secondary"
              loading={del.isPending && del.variables?.keep === false}
              onPress={() => ask && del.mutate({ id: ask.id, keep: false })}
              testID="camp-delete-forget"
            />
            <Pressable onPress={() => setAsk(null)} hitSlop={8} style={{ alignSelf: "center" }}>
              <Text style={styles.askText}>Annuleren</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  askBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: 24 },
  askBox: { backgroundColor: colors.surface, borderRadius: 20, padding: 18, gap: 12, maxWidth: 440, width: "100%", alignSelf: "center" },
  archToggle: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", marginTop: 10, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, backgroundColor: colors.brandTertiary },
  archToggleText: { fontSize: 14, fontFamily: fonts.semibold, color: colors.brandPrimary },
  askText: { fontSize: 14, lineHeight: 20, fontFamily: fonts.regular, color: colors.onSurfaceSecondary },
  root: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8 },
  title: { fontSize: 32, fontFamily: fonts.bold, color: colors.onSurface },
  subtitle: { fontSize: 15, fontFamily: fonts.regular, color: colors.muted, marginTop: 2 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    ...softShadow(colors, 1),
  },
  cardIcon: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitle: { fontSize: 17, fontFamily: fonts.semibold, color: colors.onSurface },
  cardMeta: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted, marginTop: 2 },
  badgeRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.brandTertiary,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  badgeText: { fontSize: 12, fontFamily: fonts.medium, color: colors.onBrandTertiary },
  cardActions: { flexDirection: "column", gap: 10, alignItems: "center" },
  cardActionBtn: { padding: 4 },
  fab: {
    position: "absolute",
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 999,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  fabText: { color: colors.onBrandPrimary, fontSize: 15, fontFamily: fonts.semibold },
}));
