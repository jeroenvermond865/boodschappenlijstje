import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, RefreshControl, ScrollView, Text, View, useWindowDimensions } from "react-native";
import Image from "@/src/components/SafeImage";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import Animated, { FadeInRight } from "react-native-reanimated";

import { Icon } from "@/src/components/ui";
import { niceDate } from "@/src/DateField";
import { api } from "@/src/api";
import { cachedApi } from "@/src/offline";
import { AdSlot, GOLD, PLAN_NAME, useFeature, usePlanOf } from "@/src/premium";
import { TodayCard } from "@/src/TodayCard";
import { useTerms } from "@/src/settings";
import { usesNativeTabs } from "@/src/navigation";
import { euro } from "@/src/search";
import { STORE_LABEL, type RecipeTile } from "@/src/OnlineRecipes";
import { RestockCard } from "@/src/RestockCard";
import { DayMenuSheet, MEAL_WORD, dayWord, type SoonDay } from "@/src/DayMenuSheet";
import { SHORT, type CompareStore } from "@/src/CompareCard";
import { fonts, makeStyles, useTheme } from "@/src/theme";

type Home = {
  name: string;
  camp: {
    id: string;
    name: string;
    days: number;
    max_people: number;
    shopping_days: number;
    meals_planned: number;
    products: number;
    other_camps: number;
    start_date?: string | null;
    soon?: SoonDay[];
    deals?: { name: string; product_id: string; product: string; store: string; image?: string | null; label?: string; price?: number | null; regular?: number }[];
  } | null;
  compare: CompareStore[] | null;
  compare_pending?: boolean;
  shop_store?: string | null;
  promos: {
    id?: string;
    store: string;
    title: string;
    label: string;
    image: string;
    price?: number | null;
    regular?: number | null;
    product_ids: string[];
    end?: string | null;
  }[];
  recipes: RecipeTile[];
  todo: { dishes?: number; products?: number; stores?: number; premium?: number; signups?: number };
  alerts_hit?: number;
  own_dishes: number;
};

function greeting() {
  const h = new Date().getHours();
  return h < 6 ? "Goedenacht" : h < 12 ? "Goedemorgen" : h < 18 ? "Goedemiddag" : "Goedenavond";
}

export default function HomeScreen() {
  const { width } = useWindowDimensions();
  const wide = width >= 700;
  const styles = useStyles();
  const T = useTerms();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [dayOpen, setDayOpen] = useState<number | null>(null);
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;

  // Verversen (omlaag trekken): andere recepten en acties die nog steeds bij je passen
  const shuffle = useRef(0);
  const { data, refetch, isRefetching, isLoading } = useQuery({
    queryKey: ["home"],
    queryFn: () => {
      const s = shuffle.current;
      shuffle.current = 0;
      return s ? api<Home>(`/home?shuffle=${s}`) : cachedApi<Home>("/home");
    },
    staleTime: 60 * 1000,
    // De vergelijking wordt op de achtergrond uitgerekend: even later nog eens vragen
    refetchInterval: (q) => (q.state.data?.compare_pending && q.state.dataUpdateCount < 24 ? 5000 : false),
  });

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const on = () => (shuffle.current = Date.now() % 1e9);
    window.addEventListener("app:pull-refresh", on);
    return () => window.removeEventListener("app:pull-refresh", on);
  }, []);
  const pullRefresh = () => {
    shuffle.current = Date.now() % 1e9;
    refetch();
  };

  const premium = useFeature("extra_besparen");
  const hasPantry = useFeature("voorraadkast");
  const hasAlerts = useFeature("prijsalarm");
  const hasSlim = useFeature("slimme_hulp");
  const slimPlan = usePlanOf("slimme_hulp");
  const today = new Date().toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" });
  const actions = [
    { icon: "clipboard-plus-outline", label: `${T.nieuw[0].toUpperCase()}${T.nieuw.slice(1)} ${T.one}`, onPress: () => router.push("/camp/new") },
    { icon: "silverware-fork-knife", label: "Gerechten", onPress: () => router.push("/dishes") },
    { icon: "magnify", label: "Product zoeken", onPress: () => router.push("/products") },
    { icon: "newspaper-variant-outline", label: "Folders", onPress: () => router.push("/folders") },
  ];
  const todo = data?.todo ?? {};
  const todoRows = [
    todo.dishes ? { n: todo.dishes, label: "gerechten wachten op goedkeuring", to: "/admin/submissions" } : null,
    todo.products ? { n: todo.products, label: "productvoorstellen wachten op goedkeuring", to: "/admin/submissions" } : null,
    todo.stores ? { n: todo.stores, label: "winkelaanvragen", to: "/admin/store-requests" } : null,
    data?.alerts_hit ? { n: data.alerts_hit, label: data.alerts_hit === 1 ? "prijsalarm: product is goedkoper" : "prijsalarmen: producten zijn goedkoper", to: "/alerts" } : null,
    todo.signups ? { n: todo.signups, label: todo.signups === 1 ? "accountaanvraag" : "accountaanvragen", to: "/admin/users" } : null,
    todo.premium ? { n: todo.premium, label: todo.premium === 1 ? "premium-aanvraag" : "premium-aanvragen", to: "/admin/premium-requests" } : null,
  ].filter(Boolean) as { n: number; label: string; to: string }[];

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: bottomChrome + 40, gap: 22 }}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={pullRefresh} tintColor={colors.brandPrimary} />}
    >
      <View style={styles.pad}>
        <Text style={styles.date}>{today.charAt(0).toUpperCase() + today.slice(1)}</Text>
        <Text style={styles.hello}>
          {greeting()}
          {data?.name ? `, ${data.name}` : ""}
        </Text>
      </View>

      {/* Snel lijstje (klein knopje) en wat bijna op is: bovenaan, maar niet groot */}
      <View style={[styles.pad, { gap: 8 }]}>
        <TodayCard />
        {data?.camp ? <RestockCard campId={data.camp.id} compact /> : null}
      </View>

      {/* Je kamp */}
      <View style={styles.pad}>
        {data?.camp ? (
          <Pressable testID="home-camp" onPress={() => router.push(`/camp/${data.camp!.id}`)} style={styles.campCard}>
            <View style={styles.campTop}>
              <View style={styles.campIcon}>
                <Icon name="clipboard-list-outline" size={26} color={colors.onBrandPrimary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.campLabel}>{data.camp.start_date ? `Eerstvolgende ${T.one} · ${niceDate(data.camp.start_date)}` : `Je ${T.one}`}</Text>
                <Text style={styles.campName} numberOfLines={1}>
                  {data.camp.name}
                </Text>
              </View>
              <Icon name="chevron-right" size={24} color={colors.onBrandPrimary} />
            </View>
            <View style={styles.campStats}>
              <Stat n={data.camp.days} label={data.camp.days === 1 ? "dag" : "dagen"} />
              <Stat n={data.camp.max_people} label="personen" />
              <Stat n={data.camp.meals_planned} label="maaltijden" />
              <Stat n={data.camp.shopping_days} label="boodschap­dagen" />
            </View>
            <View style={styles.campBtns}>
              <Pressable onPress={() => router.push(`/shopping/${data.camp!.id}`)} style={styles.campBtn}>
                <Icon name="format-list-checks" size={18} color={colors.brandPrimary} />
                <Text style={styles.campBtnText}>Boodschappenlijst</Text>
              </Pressable>
              <Pressable onPress={() => router.push("/camps")} style={[styles.campBtn, styles.campBtnGhost]}>
                <Text style={styles.campBtnGhostText}>
                  {data.camp.other_camps ? `Alle ${T.many} (${data.camp.other_camps + 1})` : `Alle ${T.many}`}
                </Text>
              </Pressable>
            </View>
          </Pressable>
        ) : !isLoading ? (
          <Pressable onPress={() => router.push("/camp/new")} style={styles.emptyCamp}>
            <Icon name="clipboard-list-outline" size={28} color={colors.brandPrimary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{`Plan je eerste ${T.one}`}</Text>
              <Text style={styles.muted}>Kies dagen, mensen en gerechten. De app maakt je boodschappenlijst.</Text>
            </View>
            <Icon name="chevron-right" size={22} color={colors.muted} />
          </Pressable>
        ) : (
          <View style={[styles.campCard, { height: 190, opacity: 0.4 }]} />
        )}
      </View>

      {/* Snelle knoppen */}
      <View style={[styles.pad, styles.actions]}>
        {actions.map((a) => (
          <Pressable key={a.label} onPress={a.onPress} style={({ pressed }) => [styles.action, pressed && { opacity: 0.8 }]}>
            <View style={styles.actionIcon}>
              <Icon name={a.icon as any} size={22} color={colors.brandPrimary} />
            </View>
            <Text style={styles.actionText} numberOfLines={2}>
              {a.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Besparing (voor iedereen), voorraad en prijsalarm (Premium) */}
      <View style={[styles.pad, styles.actions]}>
        <Pressable testID="home-savings" onPress={() => router.push("/savings")} style={premium ? styles.premTile : [styles.premTile, styles.stdTile]}>
          <Icon name="piggy-bank-outline" size={22} color={premium ? GOLD.icon : colors.brandPrimary} />
          <Text style={premium ? styles.premTileText : [styles.premTileText, { color: colors.onSurface }]}>Bespaaroverzicht</Text>
        </Pressable>
        {hasPantry ? (
          <Pressable testID="home-pantry" onPress={() => router.push("/pantry")} style={styles.premTile}>
            <Icon name="fridge-outline" size={22} color={GOLD.icon} />
            <Text style={styles.premTileText}>Voorraadkast</Text>
          </Pressable>
        ) : null}
        {hasAlerts ? (
          <Pressable testID="home-alerts" onPress={() => router.push("/alerts")} style={styles.premTile}>
            <Icon name="bell-ring-outline" size={22} color={GOLD.icon} />
            <Text style={styles.premTileText}>Prijsalarmen</Text>
          </Pressable>
        ) : null}
      </View>

      {/* Slimme hulp (Premium): menu uit één zin, restjes, recept overnemen, lijst inspreken, bespaartips */}
      <View style={styles.pad}>
        <Pressable testID="home-slim" onPress={() => router.push("/slim")} style={styles.slim}>
          <Icon name="auto-fix" size={26} color={GOLD.icon} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.premTileText, { fontSize: 15, textAlign: "left", fontFamily: fonts.bold }]}>Slimme hulp{hasSlim ? "" : ` (${PLAN_NAME[slimPlan]})`}</Text>
            <Text style={[styles.premTileText, { textAlign: "left", fontFamily: fonts.regular }]}>
              Menu uit één zin, koken met restjes, recept of foto overnemen, je lijst inspreken en bespaartips
            </Text>
          </View>
          <Icon name="chevron-right" size={22} color={GOLD.icon} />
        </Pressable>
      </View>

      {/* Admin-taken */}
      {todoRows.length ? (
        <View style={[styles.pad, { gap: 8 }]}>
          {todoRows.map((t) => (
            <Pressable key={t.label} onPress={() => router.push(t.to as any)} style={styles.todo}>
              <View style={styles.todoBadge}>
                <Text style={styles.todoBadgeText}>{t.n}</Text>
              </View>
              <Text style={[styles.body, { flex: 1 }]}>{t.label}</Text>
              <Icon name="chevron-right" size={20} color={colors.muted} />
            </Pressable>
          ))}
        </View>
      ) : null}

      {/* Aanbiedingen */}
      {data?.promos.length ? (
        <View style={{ gap: 10 }}>
          <SectionHead title="Nu in de aanbieding" link="Alle folders" onPress={() => router.push("/folders")} />
          {/* Eén rij om opzij te scrollen; op een laptop met zichtbare schuifbalk */}
          <ScrollView horizontal showsHorizontalScrollIndicator={wide} contentContainerStyle={styles.hRow}>
            {data.promos.map((p, i) => (
              // Na verversen schuiven de nieuwe acties één voor één in beeld
              <Animated.View key={`${p.store}-${p.id}`} entering={FadeInRight.delay(Math.min(i, 8) * 45).springify()}>
              <Pressable
                onPress={() =>
                  p.product_ids.length === 1
                    ? router.push(`/product/${p.product_ids[0]}`)
                    : router.push({ pathname: "/folders", params: { store: p.store, promo: p.id } })
                }
                style={styles.promo}
              >
                <View style={styles.promoImgBox}>
                  <Image source={{ uri: p.image }} style={styles.promoImg} resizeMode="contain" />
                  <View style={styles.storeBadge}>
                    <Text style={styles.storeBadgeText}>{SHORT[p.store] ?? p.store}</Text>
                  </View>
                </View>
                <View style={styles.promoLabel}>
                  <Text style={styles.promoLabelText} numberOfLines={1}>
                    {p.label}
                  </Text>
                </View>
                <Text style={styles.promoTitle} numberOfLines={2}>
                  {p.title}
                </Text>
                {p.price ? (
                  <View style={{ flexDirection: "row", gap: 6, alignItems: "baseline" }}>
                    {p.regular && p.regular > p.price ? <Text style={styles.old}>{euro(p.regular)}</Text> : null}
                    <Text style={styles.promoPrice}>{euro(p.price)}</Text>
                  </View>
                ) : null}
              </Pressable>
              </Animated.View>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {/* Recepten */}
      {data?.recipes.length ? (
        <View style={{ gap: 10 }}>
          <SectionHead
            title="Recept-inspiratie"
            link="Alle recepten"
            onPress={() => router.push({ pathname: "/dishes", params: { tab: "online" } })}
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={wide} contentContainerStyle={styles.hRow}>
            {data.recipes.map((r, i) => (
              <Animated.View key={r.id} entering={FadeInRight.delay(i * 60).springify()}>
              <Pressable onPress={() => router.push({ pathname: "/recipe/[id]", params: { id: r.id } })} style={styles.recipe}>
                {r.image ? <Image source={{ uri: r.image }} style={styles.recipeImg} resizeMode="cover" /> : <View style={styles.recipeImg} />}
                <View style={styles.storeBadge}>
                  <Text style={styles.storeBadgeText}>{STORE_LABEL[r.store] ?? r.store}</Text>
                </View>
                <View style={{ padding: 10, gap: 3 }}>
                  <Text style={styles.recipeTitle} numberOfLines={2}>
                    {r.title}
                  </Text>
                  {r.time ? (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                      <Icon name="clock-outline" size={13} color={colors.muted} />
                      <Text style={styles.small}>{r.time} min</Text>
                    </View>
                  ) : null}
                  {r.price_pp ? (
                    <Text style={[styles.small, { fontFamily: fonts.semibold, color: colors.onSurface }]}>
                      ± {euro(r.price_pp)} p.p.{r.price_total ? ` · ${euro(r.price_total)} totaal` : ""}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
              </Animated.View>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {data?.camp?.soon?.length ? (
        // De komende dagen met maaltijden (tot een week): veeg opzij voor meer, tik voor die dag
        <View style={{ gap: 0 }}>
          <Text style={[styles.soonTitle, styles.pad]}>Op het menu</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingHorizontal: 16 }}>
            {data.camp.soon.map((d, k) => (
              <Pressable
                key={d.date}
                testID={`home-soon-${d.date}`}
                onPress={() => setDayOpen(k)}
                style={[styles.soonCard, { width: data.camp!.soon!.length > 1 ? 230 : 320 }]}
              >
                <View style={styles.soonHead}>
                  <Text style={styles.soonDay}>{dayWord(d.date)}</Text>
                  <Icon name="chevron-right" size={20} color={colors.muted} />
                </View>
                {d.meals.map((m) => (
                  <View key={`${m.meal}-${m.dish_id}`} style={styles.soonRow}>
                    {m.image ? (
                      <Image source={{ uri: m.image }} style={styles.soonImg} />
                    ) : (
                      <View style={[styles.soonImg, { alignItems: "center", justifyContent: "center" }]}>
                        <Icon name="silverware-fork-knife" size={18} color={colors.brandPrimary} />
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.soonMeal}>{MEAL_WORD[m.meal] ?? m.meal}</Text>
                      <Text style={styles.soonName} numberOfLines={2}>{m.name}</Text>
                    </View>
                  </View>
                ))}
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}
      {data?.camp?.soon?.length ? (
        <DayMenuSheet campId={data.camp.id} days={data.camp.soon} start={dayOpen} onClose={() => setDayOpen(null)} />
      ) : null}
      {data?.camp?.deals?.length ? (
        // Compact: wat op je lijstje staat en nu in de aanbieding is
        <View style={styles.pad}>
          <Text style={styles.soonTitle}>Jouw lijst in de aanbieding</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
            {data.camp.deals.map((d) => (
              <Pressable
                key={d.product_id}
                onPress={() => router.push({ pathname: "/product/[id]", params: { id: d.product_id } })}
                style={styles.dealTile}
              >
                {d.image ? <Image source={{ uri: d.image }} style={styles.dealImg} resizeMode="contain" /> : <View style={styles.dealImg} />}
                <Text style={styles.dealName} numberOfLines={2}>{d.name}</Text>
                <Text style={styles.dealLabel} numberOfLines={2}>{d.label}</Text>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={styles.dealStore}>{SHORT[d.store] ?? d.store}</Text>
                  {d.price ? <Text style={styles.dealPrice}>{euro(d.price)}</Text> : null}
                </View>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}
      <AdSlot place="home" />
    </ScrollView>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  const styles = useStyles();
  const T = useTerms();
  return (
    <View style={{ flex: 1, alignItems: "center" }}>
      <Text style={styles.statN}>{n}</Text>
      <Text style={styles.statLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function SectionHead({ title, link, onPress }: { title: string; link: string; onPress: () => void }) {
  const styles = useStyles();
  const T = useTerms();
  return (
    <View style={[styles.pad, { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }]}>
      <Text style={styles.section}>{title}</Text>
      <Pressable onPress={onPress} hitSlop={8}>
        <Text style={styles.link}>{link}</Text>
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  soonTitle: { fontSize: 18, fontFamily: fonts.bold, color: colors.onSurface, marginBottom: 10 },
  soonCard: { borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 12, gap: 8, backgroundColor: colors.surface },
  soonHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  soonDay: { fontSize: 15, fontFamily: fonts.bold, color: colors.brandPrimary, textTransform: "capitalize" },
  soonRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  soonImg: { width: 36, height: 36, borderRadius: 8, backgroundColor: colors.brandTertiary },
  dealLabel: { fontSize: 12, fontFamily: fonts.semibold, color: colors.success },
  dealTile: { width: 132, borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 10, gap: 4, backgroundColor: colors.surface },
  dealImg: { width: "100%", height: 70, borderRadius: 8, backgroundColor: "#fff" },
  dealName: { fontSize: 13, fontFamily: fonts.semibold, color: colors.onSurface, minHeight: 34 },
  dealStore: { fontSize: 11, fontFamily: fonts.bold, color: colors.muted },
  dealPrice: { fontSize: 14, fontFamily: fonts.bold, color: colors.onSurface },
  soonMeal: { fontSize: 12, fontFamily: fonts.medium, color: colors.muted },
  soonName: { fontSize: 14, fontFamily: fonts.semibold, color: colors.onSurface },
  root: { flex: 1, backgroundColor: colors.surface },
  pad: { paddingHorizontal: 16 },
  date: { fontSize: 14, fontFamily: fonts.medium, color: colors.muted },
  hello: { fontSize: 30, fontFamily: fonts.bold, color: colors.onSurface, marginTop: 2 },
  muted: { fontSize: 14, fontFamily: fonts.regular, color: colors.muted },
  small: { fontSize: 12, fontFamily: fonts.regular, color: colors.muted },
  body: { fontSize: 15, fontFamily: fonts.regular, color: colors.onSurface },
  link: { fontSize: 14, fontFamily: fonts.semibold, color: colors.brandPrimary },
  section: { fontSize: 19, fontFamily: fonts.bold, color: colors.onSurface },
  cardTitle: { fontSize: 16, fontFamily: fonts.semibold, color: colors.onSurface },
  campCard: { backgroundColor: colors.brandPrimary, borderRadius: 20, padding: 16, gap: 14 },
  campTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  campIcon: { width: 48, height: 48, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" },
  campLabel: { fontSize: 13, fontFamily: fonts.medium, color: colors.onBrandPrimary, opacity: 0.8 },
  campName: { fontSize: 20, fontFamily: fonts.bold, color: colors.onBrandPrimary },
  campStats: { flexDirection: "row", backgroundColor: "rgba(255,255,255,0.12)", borderRadius: 14, paddingVertical: 10 },
  statN: { fontSize: 20, fontFamily: fonts.bold, color: colors.onBrandPrimary },
  statLabel: { fontSize: 11, fontFamily: fonts.medium, color: colors.onBrandPrimary, opacity: 0.85 },
  campBtns: { flexDirection: "row", gap: 10 },
  campBtn: { flex: 1, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, borderRadius: 12, paddingVertical: 11 },
  campBtnText: { fontSize: 14, fontFamily: fonts.semibold, color: colors.brandPrimary },
  campBtnGhost: { backgroundColor: "rgba(255,255,255,0.15)" },
  campBtnGhostText: { fontSize: 14, fontFamily: fonts.semibold, color: colors.onBrandPrimary },
  emptyCamp: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.brandTertiary },
  actions: { flexDirection: "row", gap: 10 },
  stdTile: { backgroundColor: colors.surface, borderColor: colors.border },
  premTile: { flex: 1, alignItems: "center", gap: 6, paddingVertical: 12, borderRadius: 14, backgroundColor: GOLD.bg, borderWidth: 1, borderColor: GOLD.border },
  slim: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 16, backgroundColor: GOLD.bg, borderWidth: 1, borderColor: GOLD.border },
  premTileText: { fontSize: 12, fontFamily: fonts.semibold, color: GOLD.text, textAlign: "center" },
  action: { flex: 1, alignItems: "center", gap: 6, paddingVertical: 12, paddingHorizontal: 4, borderRadius: 16, borderWidth: 1, borderColor: colors.border },
  actionIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  actionText: { fontSize: 12, fontFamily: fonts.medium, color: colors.onSurface, textAlign: "center" },
  todo: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 14, backgroundColor: colors.surfaceTertiary },
  todoBadge: { minWidth: 26, height: 26, borderRadius: 13, backgroundColor: colors.warning, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  todoBadgeText: { fontSize: 13, fontFamily: fonts.bold, color: colors.onWarning },
  hRow: { gap: 10, paddingHorizontal: 16 },
  promo: { width: 150, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 10, gap: 6 },
  promoImgBox: { height: 110, borderRadius: 10, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  promoImg: { width: "90%", height: "90%" },
  promoLabel: { alignSelf: "flex-start", backgroundColor: colors.warning, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, maxWidth: "100%" },
  promoLabelText: { fontSize: 12, fontFamily: fonts.bold, color: colors.onWarning },
  promoTitle: { fontSize: 13, fontFamily: fonts.medium, color: colors.onSurface, minHeight: 34 },
  promoPrice: { fontSize: 15, fontFamily: fonts.bold, color: colors.onSurface },
  old: { fontSize: 12, fontFamily: fonts.regular, color: colors.muted, textDecorationLine: "line-through" },
  storeBadge: { position: "absolute", top: 6, left: 6, backgroundColor: "rgba(0,0,0,0.6)", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999 },
  storeBadgeText: { color: "#fff", fontSize: 11, fontFamily: fonts.semibold },
  recipe: { width: 200, borderRadius: 16, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  recipeImg: { width: "100%", height: 120, backgroundColor: colors.surfaceTertiary },
  recipeTitle: { fontSize: 14, fontFamily: fonts.semibold, color: colors.onSurface, minHeight: 36 },
}));
