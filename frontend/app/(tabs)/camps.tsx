import { useCallback } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Animated, { FadeInDown } from "react-native-reanimated";

import { Button, EmptyState, Icon } from "@/src/components/ui";
import { api } from "@/src/api";
import { cachedApi } from "@/src/offline";
import { usesNativeTabs } from "@/src/navigation";
import { useAppSettings, useTerms } from "@/src/settings";
import { useToast } from "@/src/toast";
import { fonts, makeStyles, useTheme } from "@/src/theme";

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

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["camps"],
    queryFn: () => cachedApi<{ camps: Camp[] }>("/camps"),
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

  const del = useMutation({
    mutationFn: (id: string) => api(`/camps/${id}`, { method: "DELETE" }),
    onSuccess: (_d, id) => {
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
        <Animated.View entering={FadeInDown.delay(index * 50).springify()}>
          <Pressable
            testID={`camp-card-${item.id}`}
            onPress={() => router.push(`/camp/${item.id}`)}
            style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}
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
                onPress={() => del.mutate(item.id)}
                style={styles.cardActionBtn}
              >
                <Icon name="trash-can-outline" size={20} color={colors.muted} />
              </Pressable>
            </View>
          </Pressable>
        </Animated.View>
      );
    },
    [styles, colors, router, del, duplicate],
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>{s.tab_camps}</Text>
        <Text style={styles.subtitle}>{s.sub_camps}</Text>
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.brandPrimary} />
        </View>
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
            <EmptyState
              icon="clipboard-list-outline"
              title={`Nog geen ${T.many} gepland`}
              subtitle={`Maak een ${T.one} aan en plan per dag de maaltijden en het aantal personen.`}
            />
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
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
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
