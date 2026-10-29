import { Children, useState, type ReactNode } from "react";
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
import { planAccent, planIcon } from "@/src/premium";
import { APP_VERSION } from "@/src/changelog";
import { usePrivateSource } from "@/src/components/SafeImage";

export default function AccountScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, logout, has } = useAuth();
  const pc = planAccent(user?.plan as any); // Premium goud, Ultra paars
  // Je profielfoto is alleen met je inlog op te halen
  const picUri = user?.picture ? mediaUrl(user.picture) : undefined;
  const picPriv = usePrivateSource(picUri);
  const pic = { src: picPriv.private ? picPriv.src : picUri ? { uri: picUri } : null };
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
        {/* Tik op je naam voor profiel & wachtwoord; Premium/Ultra staat er klein onder */}
        <View style={{ gap: 8 }}>
        <Pressable testID="profile-link" onPress={() => router.push("/account/profile")} style={({ pressed }) => pressed && { opacity: 0.8 }}>
        <Card style={styles.profile}>
          <View>
          <View style={styles.avatar}>
            {user?.picture ? (
              pic.src ? <Image source={pic.src} style={styles.avatarImg} contentFit="cover" /> : <Text style={styles.avatarText}>{initial}</Text>
            ) : (
              <Text style={styles.avatarText}>{initial}</Text>
            )}
          </View>
            {user?.premium ? (
              <View style={[styles.avatarStar, { backgroundColor: pc.icon }]}>
                <Icon name={planIcon(user.plan as any)} size={13} color="#FFFFFF" />
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
              {user?.premium ? <Text style={[styles.rolePillText, { color: pc.icon, fontFamily: fonts.bold }]}> · {user.plan === "ultra" ? "Ultra" : "Premium"}</Text> : null}
            </View>
          </View>
          <Icon name="chevron-right" size={22} color={colors.muted} />
        </Card>
        </Pressable>

        {user?.premium ? (
          <Pressable style={[styles.premiumCard, { backgroundColor: pc.bg, borderColor: pc.border }]} testID="premium-card" onPress={() => router.push("/premium")}>
            <View style={[styles.premiumIcon, { backgroundColor: pc.icon }]}>
              <Icon name={planIcon(user.plan as any)} size={18} color="#FFFFFF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.premiumTitle, { color: pc.text }]}>{user.plan === "ultra" ? "Ultra" : "Premium"}</Text>
              <Text style={[styles.premiumText, { color: pc.text }]}>
                {(user as any).trial
                  ? "Je probeert het 14 dagen gratis. "
                  : (user as any).premium_household
                  ? `Via ${(user as any).premium_household} (Ultra, voor het hele huishouden). `
                  : user.premium_org
                  ? `Via ${user.premium_org}. `
                  : user.subscription === "active"
                    ? "Je betaalt per maand. "
                    : user.subscription === "cancelled" && user.premium_until
                      ? `Opgezegd, loopt nog tot ${new Date(user.premium_until).toLocaleDateString("nl-NL", { day: "numeric", month: "long" })}. `
                      : user.premium_until
                    ? `Verdiend met delen, tot ${new Date(user.premium_until).toLocaleDateString("nl-NL", { day: "numeric", month: "long" })}. `
                    : "Bedankt voor je steun! "}Bekijk wat je allemaal extra hebt.
              </Text>
            </View>
            <Icon name="chevron-right" size={22} color={pc.text} />
          </Pressable>
        ) : (
          <Pressable style={[styles.premiumCard, { borderStyle: "dashed" }]} testID="premium-info-card" onPress={() => router.push("/premium")}>
            <View style={styles.premiumIcon}>
              <Icon name="star-outline" size={18} color={colors.onBrandSecondary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.premiumTitle}>{user.plan === "ultra" ? "Ultra" : "Premium"}</Text>
              <Text style={styles.premiumText}>Gratis voor verenigingen. Bekijk wat je krijgt en vraag het aan.</Text>
            </View>
            <Icon name="chevron-right" size={22} color={planAccent("premium").text} />
          </Pressable>
        )}
        </View>

        <AdminRow
          testID="invite-link"
          icon="gift-outline"
          label="Deel de app en verdien Premium"
          onPress={() => router.push("/invite")}
        />

        {/* In groepjes, anders wordt het een lange rij regels onder elkaar */}
        <RowGroup testID="group-account" icon="account-cog-outline" title="Mijn account">
          <AdminRow testID="history-link" icon="history" label="Mijn geschiedenis" onPress={() => router.push("/account/history")} />
          <AdminRow testID="trash-link" icon="delete-restore" label="Recent verwijderd" onPress={() => router.push("/admin/trash")} />
        </RowGroup>
        <RowGroup testID="group-help" icon="lifebuoy" title="Hulp & contact" badge={myReplies?.count}>
          <AdminRow testID="help-link" icon="help-circle-outline" label="Zo werkt de app" onPress={() => router.push("/help")} />
          <AdminRow testID="feedback-link" icon="message-draw" label="Feedback & ideeën" sub="Tip, fout of supermarkt aanvragen" badge={myReplies?.count} onPress={() => router.push("/feedback")} />
          <AdminRow
            testID="legal-link"
            icon="file-document-outline"
            label="Voorwaarden, privacy, cookies & herroepen"
            onPress={() => router.push({ pathname: "/legal/[doc]", params: { doc: "voorwaarden" } })}
          />
        </RowGroup>

        {isAdminArea ? (
          <View style={{ gap: 10 }}>
            <Text style={styles.sectionLabel}>Beheer</Text>
            <RowGroup
              testID="group-admin-content"
              icon="clipboard-check-outline"
              title="Inzendingen & producten"
              badge={(canReview ? pending ?? 0 : 0) + (canProducts ? pendingBarcodes ?? 0 : 0) + (canSettings ? (pendingStores ?? 0) + (pendingFeedback ?? 0) : 0)}
            >
              {canReview ? (
                <AdminRow testID="admin-submissions-link" icon="clipboard-check-outline" label="Inzendingen beoordelen" badge={pending} onPress={() => router.push("/admin/submissions")} />
              ) : null}
              {canProducts ? (
                <AdminRow testID="admin-barcodes-link" icon="barcode" label="Barcode-voorstellen" badge={pendingBarcodes} onPress={() => router.push("/admin/barcodes")} />
              ) : null}
              {canSettings ? (
                <AdminRow testID="admin-feedback-link" icon="message-text-outline" label="Feedback & aanvragen" sub="Berichten, ideeën en supermarkt-aanvragen" badge={(pendingFeedback ?? 0) + (pendingStores ?? 0)} onPress={() => router.push("/admin/feedback")} />
              ) : null}
              {canProducts ? (
                <AdminRow testID="admin-dirk-link" icon="store-plus-outline" label="Supermarkt importeren & prijzen" onPress={() => router.push("/admin/dirk")} />
              ) : null}
            </RowGroup>
            <RowGroup testID="group-admin-users" icon="account-group-outline" title="Gebruikers" badge={canUsers ? premiumReqs : 0}>
              {canUsers ? (
                <AdminRow testID="admin-users-link" icon="account-group-outline" label="Gebruikers & rollen" onPress={() => router.push("/admin/users")} />
              ) : null}
              {canUsers ? (
                <AdminRow testID="admin-premium-link" icon="star-check-outline" label="Premium-aanvragen" badge={premiumReqs} onPress={() => router.push("/admin/premium-requests")} />
              ) : null}
              {canRoles ? (
                <AdminRow testID="admin-roles-link" icon="shield-edit-outline" label="Rollen beheren" onPress={() => router.push("/admin/roles")} />
              ) : null}
            </RowGroup>
            <RowGroup testID="group-admin-app" icon="cog-outline" title="App & kosten">
              {canUsers ? (
                <AdminRow testID="admin-dashboard-link" icon="chart-box-outline" label="Dashboard (live gebruik en AI-kosten)" onPress={() => router.push("/admin/dashboard")} />
              ) : null}
              {canSettings ? (
                <AdminRow testID="admin-plans-link" icon="star-cog-outline" label="Abonnementen en AI-model" onPress={() => router.push("/admin/plans")} />
              ) : null}
              {canSettings ? (
                <AdminRow testID="admin-settings-link" icon="cog-outline" label="App aanpassen" onPress={() => router.push("/admin/settings")} />
              ) : null}
            </RowGroup>
          </View>
        ) : null}

        <Button label="Uitloggen" variant="ghost" icon="logout" onPress={logout} testID="logout-button" />
        <Text style={styles.version}>Slim Boodschappenlijstje · v{APP_VERSION}</Text>
      </ScrollView>
    </View>
  );
}

// Een kopje dat openklapt; zonder regels erin (geen rechten) laten we het helemaal weg
function RowGroup({ icon, title, badge, children, testID }: { icon: any; title: string; badge?: number; children: ReactNode; testID?: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const rows = Children.toArray(children);
  if (!rows.length) return null;
  return (
    <View style={{ gap: 8 }}>
      <Pressable testID={testID} onPress={() => setOpen((o) => !o)} style={({ pressed }) => pressed && { opacity: 0.7 }}>
        <Card style={styles.adminRow}>
          <View style={styles.adminIcon}>
            <Icon name={icon} size={20} color={colors.brandPrimary} />
          </View>
          <Text style={styles.adminLabel}>{title}</Text>
          {!open && badge && badge > 0 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{badge}</Text>
            </View>
          ) : null}
          <View style={styles.adminChevron}>
            <Icon name={open ? "chevron-up" : "chevron-down"} size={22} color={colors.muted} />
          </View>
        </Card>
      </Pressable>
      {open ? <View style={{ gap: 8, paddingLeft: 14 }}>{rows}</View> : null}
    </View>
  );
}

function AdminRow({
  icon,
  label,
  sub,
  badge,
  onPress,
  testID,
}: {
  icon: any;
  label: string;
  sub?: string; // korte uitleg onder de naam
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
        {sub ? (
          <View style={{ flex: 1 }}>
            <Text style={styles.adminLabel}>{label}</Text>
            <Text style={styles.adminSub}>{sub}</Text>
          </View>
        ) : (
          <Text style={styles.adminLabel}>{label}</Text>
        )}
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
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: planAccent("premium").bg,
    borderWidth: 1,
    borderColor: colors.brandSecondary,
  },
  premiumIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.brandSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  premiumTitle: { fontSize: 15, fontFamily: fonts.bold, color: planAccent("premium").text },
  premiumText: { fontSize: 12, fontFamily: fonts.regular, color: planAccent("premium").text, marginTop: 1 },
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
  adminSub: { fontSize: 12, fontFamily: fonts.regular, color: colors.muted, marginTop: 1 },
  adminChevron: { padding: 2 },
  badge: { backgroundColor: colors.warning, borderRadius: 999, minWidth: 22, paddingHorizontal: 6, paddingVertical: 2, alignItems: "center" },
  badgeText: { fontSize: 12, fontFamily: fonts.bold, color: colors.onWarning },
  version: { textAlign: "center", fontSize: 12, fontFamily: fonts.regular, color: colors.muted, marginTop: 8 },
}));
