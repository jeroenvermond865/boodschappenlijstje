import { Pressable, ScrollView, Text, View } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";

import { Button, Card, Icon } from "@/src/components/ui";
import { api, mediaUrl } from "@/src/api";
import { useAuth } from "@/src/auth";
import { usesNativeTabs } from "@/src/navigation";
import { useAppSettings } from "@/src/settings";
import { fonts, makeStyles, useTheme } from "@/src/theme";
import { GOLD } from "@/src/premium";

export default function AccountScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, logout, has } = useAuth();
  const s = useAppSettings();
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;

  const canReview = has("review_submissions");
  const canUsers = has("manage_users");
  const canRoles = has("manage_roles");
  const canSettings = has("manage_settings");
  const canProducts = has("manage_products");
  const isAdminArea = canReview || canUsers || canRoles || canSettings || canProducts;

  const { data: counts } = useQuery({
    queryKey: ["submissions-count"],
    queryFn: () => api<{ pending: number }>("/admin/submissions/count"),
    enabled: canReview,
    refetchInterval: 15000,
  });
  const pending = counts?.pending ?? 0;

  const { data: scounts } = useQuery({
    queryKey: ["store-requests-count"],
    queryFn: () => api<{ count: number }>("/admin/store-requests/count"),
    enabled: canSettings,
    refetchInterval: 15000,
  });
  const pendingStores = scounts?.count ?? 0;

  const { data: bcounts } = useQuery({
    queryKey: ["barcode-suggestions-count"],
    queryFn: () => api<{ count: number }>("/admin/barcode-suggestions/count"),
    enabled: canProducts,
    refetchInterval: 30000,
  });
  const pendingBarcodes = bcounts?.count ?? 0;

  const { data: preqs } = useQuery({
    queryKey: ["premium-requests"],
    queryFn: () => api<{ requests: unknown[] }>("/admin/premium-requests"),
    enabled: canUsers,
    refetchInterval: 30000,
  });
  const premiumReqs = preqs?.requests.length ?? 0;

  const { data: myReplies } = useQuery({
    queryKey: ["feedback-unread"],
    queryFn: () => api<{ count: number }>("/feedback/unread"),
  });
  const { data: fcounts } = useQuery({
    queryKey: ["feedback-count"],
    queryFn: () => api<{ count: number }>("/admin/feedback/count"),
    enabled: canSettings,
    refetchInterval: 20000,
  });
  const pendingFeedback = fcounts?.count ?? 0;

  const { data: roles } = useQuery({
    queryKey: ["roles"],
    queryFn: () => api<{ roles: { name: string; label: string }[] }>("/roles"),
  });
  const roleLabel = roles?.roles.find((r) => r.name === user?.role)?.label ?? user?.role;

  const initial = (user?.name ?? user?.email ?? "?").charAt(0).toUpperCase();

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>{s.tab_account}</Text>
        <Text style={styles.subtitle}>{s.sub_account}</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: bottomChrome + 24, gap: 16 }}>
        <Card style={styles.profile}>
          <View>
          <View style={styles.avatar}>
            {user?.picture ? (
              <Image source={{ uri: mediaUrl(user.picture) }} style={styles.avatarImg} contentFit="cover" />
            ) : (
              <Text style={styles.avatarText}>{initial}</Text>
            )}
          </View>
            {user?.premium ? (
              <View style={styles.avatarStar}>
                <Icon name="star" size={13} color={colors.onBrandSecondary} />
              </View>
            ) : null}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name} numberOfLines={1}>
              {user?.name}
            </Text>
            <Text style={styles.email} numberOfLines={1}>
              {user?.email}
            </Text>
            <View style={styles.rolePill}>
              <Icon name="shield-account-outline" size={13} color={colors.onBrandTertiary} />
              <Text style={styles.rolePillText}>{roleLabel}</Text>
              {user?.premium ? <Text style={styles.rolePillText}> · {user.plan === "ultra" ? "Ultra" : "Premium"}</Text> : null}
            </View>
          </View>
        </Card>

        {user?.premium ? (
          <Pressable style={styles.premiumCard} testID="premium-card" onPress={() => router.push("/premium")}>
            <View style={styles.premiumIcon}>
              <Icon name="star" size={26} color={colors.onBrandSecondary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.premiumTitle}>{user.plan === "ultra" ? "Ultra" : "Premium"}</Text>
              <Text style={styles.premiumText}>
                {user.premium_org
                  ? `Via ${user.premium_org}. `
                  : user.premium_until
                    ? `Verdiend met delen, tot ${new Date(user.premium_until).toLocaleDateString("nl-NL", { day: "numeric", month: "long" })}. `
                    : "Bedankt voor je steun! "}Bekijk wat je allemaal extra hebt.
              </Text>
            </View>
            <Icon name="chevron-right" size={22} color={GOLD.text} />
          </Pressable>
        ) : (
          <Pressable style={[styles.premiumCard, { borderStyle: "dashed" }]} testID="premium-info-card" onPress={() => router.push("/premium")}>
            <View style={styles.premiumIcon}>
              <Icon name="star-outline" size={26} color={colors.onBrandSecondary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.premiumTitle}>{user.plan === "ultra" ? "Ultra" : "Premium"}</Text>
              <Text style={styles.premiumText}>Gratis voor verenigingen. Bekijk wat je krijgt en vraag het aan.</Text>
            </View>
            <Icon name="chevron-right" size={22} color={GOLD.text} />
          </Pressable>
        )}

        <AdminRow
          testID="invite-link"
          icon="gift-outline"
          label="Deel de app en verdien Premium"
          onPress={() => router.push("/invite")}
        />
        <AdminRow
          testID="profile-link"
          icon="account-edit-outline"
          label="Profiel & wachtwoord"
          onPress={() => router.push("/account/profile")}
        />
        <AdminRow
          testID="history-link"
          icon="history"
          label="Mijn geschiedenis"
          onPress={() => router.push("/account/history")}
        />
        <AdminRow
          testID="trash-link"
          icon="delete-restore"
          label="Recent verwijderd"
          onPress={() => router.push("/admin/trash")}
        />
        <AdminRow
          testID="store-request-link"
          icon="storefront-plus-outline"
          label="Supermarkt aanvragen"
          onPress={() => router.push("/store-request")}
        />
        <AdminRow
          testID="feedback-link"
          icon="message-draw"
          label="Feedback & verbeteringen"
          badge={myReplies?.count}
          onPress={() => router.push("/feedback")}
        />
        <AdminRow
          testID="help-link"
          icon="help-circle-outline"
          label="Zo werkt de app"
          onPress={() => router.push("/help")}
        />
        <AdminRow
          testID="legal-link"
          icon="file-document-outline"
          label="Voorwaarden, privacy & cookies"
          onPress={() => router.push({ pathname: "/legal/[doc]", params: { doc: "voorwaarden" } })}
        />

        {isAdminArea ? (
          <View style={{ gap: 10 }}>
            <Text style={styles.sectionLabel}>Beheer</Text>
            {canReview ? (
              <AdminRow
                testID="admin-submissions-link"
                icon="clipboard-check-outline"
                label="Inzendingen beoordelen"
                badge={pending}
                onPress={() => router.push("/admin/submissions")}
              />
            ) : null}
            {canProducts ? (
              <AdminRow
                testID="admin-dirk-link"
                icon="store-plus-outline"
                label="Supermarkt importeren & prijzen"
                onPress={() => router.push("/admin/dirk")}
              />
            ) : null}
            {canUsers ? (
              <AdminRow
                testID="admin-users-link"
                icon="account-group-outline"
                label="Gebruikers & rollen"
                onPress={() => router.push("/admin/users")}
              />
            ) : null}
            {canUsers ? (
              <AdminRow
                testID="admin-dashboard-link"
                icon="chart-box-outline"
                label="Dashboard (live gebruik en AI-kosten)"
                onPress={() => router.push("/admin/dashboard")}
              />
            ) : null}
            {canSettings ? (
              <AdminRow
                testID="admin-plans-link"
                icon="star-cog-outline"
                label="Abonnementen en AI-model"
                onPress={() => router.push("/admin/plans")}
              />
            ) : null}
            {canUsers ? (
              <AdminRow
                testID="admin-premium-link"
                icon="star-check-outline"
                label="Premium-aanvragen"
                badge={premiumReqs}
                onPress={() => router.push("/admin/premium-requests")}
              />
            ) : null}
            {canRoles ? (
              <AdminRow
                testID="admin-roles-link"
                icon="shield-edit-outline"
                label="Rollen beheren"
                onPress={() => router.push("/admin/roles")}
              />
            ) : null}
            {canSettings ? (
              <AdminRow
                testID="admin-settings-link"
                icon="cog-outline"
                label="App aanpassen"
                onPress={() => router.push("/admin/settings")}
              />
            ) : null}
            {canProducts ? (
              <AdminRow
                testID="admin-barcodes-link"
                icon="barcode"
                label="Barcode-voorstellen"
                badge={pendingBarcodes}
                onPress={() => router.push("/admin/barcodes")}
              />
            ) : null}
            {canSettings ? (
              <AdminRow
                testID="admin-store-requests-link"
                icon="storefront-outline"
                label="Supermarkt-aanvragen"
                badge={pendingStores}
                onPress={() => router.push("/admin/store-requests")}
              />
            ) : null}
            {canSettings ? (
              <AdminRow
                testID="admin-feedback-link"
                icon="message-text-outline"
                label="Feedback van gebruikers"
                badge={pendingFeedback}
                onPress={() => router.push("/admin/feedback")}
              />
            ) : null}
          </View>
        ) : null}

        <Button label="Uitloggen" variant="ghost" icon="logout" onPress={logout} testID="logout-button" />
        <Text style={styles.version}>Slim Boodschappenlijstje · v1.0</Text>
      </ScrollView>
    </View>
  );
}

function AdminRow({
  icon,
  label,
  badge,
  onPress,
  testID,
}: {
  icon: any;
  label: string;
  badge?: number;
  onPress: () => void;
  testID?: string;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  // De hele balk is klikbaar, niet alleen het pijltje
  return (
    <Pressable testID={testID} onPress={onPress} style={({ pressed }) => pressed && { opacity: 0.7 }}>
      <Card style={styles.adminRow}>
        <View style={styles.adminIcon}>
          <Icon name={icon} size={20} color={colors.brandPrimary} />
        </View>
        <Text style={styles.adminLabel}>{label}</Text>
        {badge && badge > 0 ? (
          <View style={styles.badge} testID={`${testID}-badge`}>
            <Text style={styles.badgeText}>{badge}</Text>
          </View>
        ) : null}
        <View style={styles.adminChevron}>
          <Icon name="chevron-right" size={22} color={colors.muted} />
        </View>
      </Card>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8 },
  title: { fontSize: 32, fontFamily: fonts.bold, color: colors.onSurface },
  subtitle: { fontSize: 15, fontFamily: fonts.regular, color: colors.muted, marginTop: 2 },
  profile: { flexDirection: "row", alignItems: "center", gap: 14 },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarImg: { width: "100%", height: "100%" },
  avatarStar: {
    position: "absolute",
    right: -2,
    bottom: -2,
    zIndex: 1,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.brandSecondary,
    borderWidth: 2,
    borderColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  premiumCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 16,
    borderRadius: 16,
    backgroundColor: GOLD.bg,
    borderWidth: 1,
    borderColor: colors.brandSecondary,
  },
  premiumIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.brandSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  premiumTitle: { fontSize: 17, fontFamily: fonts.bold, color: GOLD.text },
  premiumText: { fontSize: 13, fontFamily: fonts.regular, color: GOLD.text, marginTop: 2 },
  avatarText: { fontSize: 24, fontFamily: fonts.bold, color: colors.onBrandPrimary },
  name: { fontSize: 18, fontFamily: fonts.semibold, color: colors.onSurface },
  email: { fontSize: 14, fontFamily: fonts.regular, color: colors.muted, marginTop: 2 },
  rolePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    backgroundColor: colors.brandTertiary,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    marginTop: 8,
  },
  rolePillText: { fontSize: 12, fontFamily: fonts.semibold, color: colors.onBrandTertiary },
  sectionLabel: { fontSize: 14, fontFamily: fonts.bold, color: colors.onSurface },
  adminRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14 },
  adminIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  adminLabel: { flex: 1, fontSize: 15, fontFamily: fonts.semibold, color: colors.onSurface },
  adminChevron: { padding: 2 },
  badge: { backgroundColor: colors.warning, borderRadius: 999, minWidth: 22, paddingHorizontal: 6, paddingVertical: 2, alignItems: "center" },
  badgeText: { fontSize: 12, fontFamily: fonts.bold, color: colors.onWarning },
  version: { textAlign: "center", fontSize: 12, fontFamily: fonts.regular, color: colors.muted, marginTop: 8 },
}));
