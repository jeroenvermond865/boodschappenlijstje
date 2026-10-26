import { useState } from "react";
import { ActivityIndicator, Image, Modal, Pressable, RefreshControl, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Icon } from "@/src/components/ui";
import { niceDate } from "@/src/DateField";
import { api } from "@/src/api";
import { AdSlot, GOLD, usePremium } from "@/src/premium";
import { useTerms } from "@/src/settings";
import { usesNativeTabs } from "@/src/navigation";
import { euro } from "@/src/search";
import { STORE_LABEL, type RecipeTile } from "@/src/OnlineRecipes";
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
  } | null;
  compare: CompareStore[] | null;
  compare_pending?: boolean;
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
  todo: { dishes?: number; products?: number; stores?: number; premium?: number };
  alerts_hit?: number;
  own_dishes: number;
};

type CompareItem = NonNullable<CompareStore["items"]>[number];

type CompareStore = {
  store: string;
  total: number;
  total_fair?: number; // met een geschatte prijs voor wat deze winkel niet heeft
  estimated?: number;
  found: number;
  count: number;
  items?: { name: string; product: string | null; product_id: string | null; image?: string | null; price: number | null; alternative: boolean; estimate?: number; chosen?: boolean }[];
};

const SHORT: Record<string, string> = { "Albert Heijn": "AH", Jumbo: "Jumbo", Dirk: "Dirk" };

// Slim splitsen: bij welke twee winkels samen is je lijst het goedkoopst? Alleen tonen als het echt scheelt.
function bestSplit(compare: CompareStore[], bestSingle: number) {
  let top: { stores: string[]; total: number; saving: number; lines: { name: string; product: string | null; store: string; price: number }[] } | null = null;
  for (let a = 0; a < compare.length; a++) {
    for (let b = a + 1; b < compare.length; b++) {
      const A = compare[a], B = compare[b];
      const lines: { name: string; product: string | null; store: string; price: number }[] = [];
      let total = 0;
      (A.items ?? []).forEach((ia, k) => {
        const ib = B.items?.[k];
        // Alleen echte prijzen kiezen; heeft geen van beide het, dan telt de schatting mee (zoals bij één winkel)
        const pa = ia.price, pb = ib?.price ?? null;
        if (pa == null && pb == null && ia.estimate == null) return;
        const useB = pb != null && (pa == null || pb < pa);
        const it = useB ? ib! : ia;
        const price = (useB ? pb : pa ?? ia.estimate) as number;
        total += price;
        lines.push({ name: it.name, product: it.product, store: useB ? B.store : A.store, price });
      });
      const used = new Set(lines.map((l) => l.store));
      const saving = bestSingle - total;
      if (used.size === 2 && saving >= 1 && (!top || total < top.total)) {
        top = { stores: [A.store, B.store], total: Math.round(total * 100) / 100, saving: Math.round(saving * 100) / 100, lines };
      }
    }
  }
  return top;
}

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
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;

  const { data, refetch, isRefetching, isLoading } = useQuery({
    queryKey: ["home"],
    queryFn: () => api<Home>("/home"),
    staleTime: 60 * 1000,
    // De vergelijking wordt op de achtergrond uitgerekend: even later nog eens vragen
    refetchInterval: (q) => (q.state.data?.compare_pending ? 4000 : false),
  });
  const [openStore, setOpenStore] = useState<string | null>(null);
  const [swap, setSwap] = useState<{ store: string; item: CompareItem } | null>(null);

  const premium = usePremium();
  const today = new Date().toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" });
  const actions = [
    { icon: "tent", label: `${T.nieuw[0].toUpperCase()}${T.nieuw.slice(1)} ${T.one}`, onPress: () => router.push("/camp/new") },
    { icon: "silverware-fork-knife", label: "Gerechten", onPress: () => router.push("/dishes") },
    { icon: "magnify", label: "Product zoeken", onPress: () => router.push("/products") },
    { icon: "newspaper-variant-outline", label: "Folders", onPress: () => router.push("/folders") },
  ];
  const compare = (data?.compare ?? []).filter((c) => c.found > 0);
  // Vergelijk eerlijk: wat een winkel niet heeft telt mee met de prijs bij de andere winkels
  const fairTotal = (c: CompareStore) => c.total_fair ?? c.total;
  const best = compare.length > 1 ? compare.reduce((a, b) => (fairTotal(b) < fairTotal(a) ? b : a)) : null;
  const maxTotal = Math.max(1, ...compare.map(fairTotal));
  const split = bestSplit(compare, best ? fairTotal(best) : 0);
  const [splitOpen, setSplitOpen] = useState(false);
  const todo = data?.todo ?? {};
  const todoRows = [
    todo.dishes ? { n: todo.dishes, label: "gerechten wachten op goedkeuring", to: "/admin/submissions" } : null,
    todo.products ? { n: todo.products, label: "productvoorstellen wachten op goedkeuring", to: "/admin/submissions" } : null,
    todo.stores ? { n: todo.stores, label: "winkelaanvragen", to: "/admin/store-requests" } : null,
    data?.alerts_hit ? { n: data.alerts_hit, label: data.alerts_hit === 1 ? "prijsalarm: product is goedkoper" : "prijsalarmen: producten zijn goedkoper", to: "/alerts" } : null,
    todo.premium ? { n: todo.premium, label: todo.premium === 1 ? "premium-aanvraag" : "premium-aanvragen", to: "/admin/premium-requests" } : null,
  ].filter(Boolean) as { n: number; label: string; to: string }[];

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: bottomChrome + 40, gap: 22 }}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.brandPrimary} />}
    >
      <View style={styles.pad}>
        <Text style={styles.date}>{today.charAt(0).toUpperCase() + today.slice(1)}</Text>
        <Text style={styles.hello}>
          {greeting()}
          {data?.name ? `, ${data.name}` : ""}
        </Text>
      </View>

      {/* Je kamp */}
      <View style={styles.pad}>
        {data?.camp ? (
          <Pressable testID="home-camp" onPress={() => router.push(`/camp/${data.camp!.id}`)} style={styles.campCard}>
            <View style={styles.campTop}>
              <View style={styles.campIcon}>
                <Icon name="tent" size={26} color={colors.onBrandPrimary} />
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
            <Icon name="tent" size={28} color={colors.brandPrimary} />
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

      {/* Premium: voorraad en besparing */}
      {premium ? (
        <View style={[styles.pad, styles.actions]}>
          <Pressable testID="home-pantry" onPress={() => router.push("/pantry")} style={styles.premTile}>
            <Icon name="fridge-outline" size={22} color={GOLD.icon} />
            <Text style={styles.premTileText}>Voorraadkast</Text>
          </Pressable>
          <Pressable testID="home-savings" onPress={() => router.push("/savings")} style={styles.premTile}>
            <Icon name="piggy-bank-outline" size={22} color={GOLD.icon} />
            <Text style={styles.premTileText}>Bespaaroverzicht</Text>
          </Pressable>
          <Pressable testID="home-alerts" onPress={() => router.push("/alerts")} style={styles.premTile}>
            <Icon name="bell-ring-outline" size={22} color={GOLD.icon} />
            <Text style={styles.premTileText}>Prijsalarmen</Text>
          </Pressable>
        </View>
      ) : null}

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
              <Pressable
                key={i}
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
            {data.recipes.map((r) => (
              <Pressable key={r.id} onPress={() => router.push({ pathname: "/recipe/[id]", params: { id: r.id } })} style={styles.recipe}>
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
                </View>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {/* Prijsvergelijking */}
      {data?.compare_pending && data?.camp ? (
        <View style={[styles.pad, { gap: 10 }]}>
          <Text style={styles.section}>Waar is je lijst het goedkoopst?</Text>
          <View style={[styles.compareCard, { flexDirection: "row", alignItems: "center", gap: 10 }]}>
            <ActivityIndicator color={colors.brandPrimary} />
            <Text style={styles.small}>We zoeken je producten op bij AH, Jumbo en Dirk…</Text>
          </View>
        </View>
      ) : null}
      {compare.length && data?.camp ? (
        <View style={[styles.pad, { gap: 10 }]}>
          <Text style={styles.section}>Waar is je lijst het goedkoopst?</Text>
          <View style={styles.compareCard}>
            {compare.map((c) => (
              <Pressable key={c.store} testID={`compare-${c.store}`} onPress={() => setOpenStore((v) => (v === c.store ? null : c.store))} style={{ gap: 4 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={[styles.body, c === best && { fontFamily: fonts.bold }]}>
                    {c.store}
                    {c === best ? "  ·  goedkoopst" : ""}
                  </Text>
                  <Text style={[styles.body, c === best && { fontFamily: fonts.bold, color: colors.success }]}>{euro(fairTotal(c))}</Text>
                </View>
                <View style={styles.barTrack}>
                  <View style={[styles.bar, { width: `${(fairTotal(c) / maxTotal) * 100}%` }, c === best && { backgroundColor: colors.success }]} />
                </View>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={styles.small}>
                    {c.found} van {c.count} producten
                    {c.items?.some((i) => i.alternative) ? ` · ${c.items.filter((i) => i.alternative).length} vervangen door iets vergelijkbaars` : ""}
                    {c.estimated ? ` · incl. ${euro(c.estimated)} geschat voor wat er niet is` : ""}
                  </Text>
                  <Icon name={openStore === c.store ? "chevron-up" : "chevron-down"} size={18} color={colors.muted} />
                </View>
                {openStore === c.store
                  ? (c.items ?? []).map((i) => (
                      <Pressable
                        key={i.name}
                        onPress={() => setSwap({ store: c.store, item: i })}
                        style={styles.cmpRow}
                      >
                        {i.image ? <Image source={{ uri: i.image }} style={styles.cmpImg} resizeMode="contain" /> : <View style={styles.cmpImg} />}
                        <View style={{ flex: 1 }}>
                          <Text style={styles.cmpName} numberOfLines={1}>{i.product ?? i.name}</Text>
                          <Text style={[styles.small, i.alternative && { color: colors.warning }]} numberOfLines={1}>
                            {i.chosen ? "Zelf gekozen" : !i.product ? (i.estimate ? `Niet gevonden, gerekend met ${euro(i.estimate)} (andere winkels)` : "Niet gevonden in deze winkel") : i.alternative ? `In plaats van ${i.name}` : "Zelfde product"}
                          </Text>
                        </View>
                        <Text style={styles.cmpPrice}>{i.price != null ? euro(i.price) : "—"}</Text>
                        <Icon name="swap-horizontal" size={16} color={colors.muted} />
                      </Pressable>
                    ))
                  : null}
              </Pressable>
            ))}
            {split ? (
              <Pressable testID="compare-split" onPress={() => setSplitOpen((v) => !v)} style={styles.splitBox}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Icon name="call-split" size={20} color={colors.success} />
                  <Text style={[styles.body, { flex: 1, fontFamily: fonts.bold }]}>
                    Slim splitsen: {split.stores.map((s) => SHORT[s] ?? s).join(" + ")}
                  </Text>
                  <Text style={[styles.body, { fontFamily: fonts.bold, color: colors.success }]}>{euro(split.total)}</Text>
                </View>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={styles.small}>
                    Haal elk product waar het het goedkoopst is: {euro(split.saving)} minder dan alles bij {best?.store}.
                  </Text>
                  <Icon name={splitOpen ? "chevron-up" : "chevron-down"} size={18} color={colors.muted} />
                </View>
                {splitOpen
                  ? split.stores.map((st) => (
                      <View key={st} style={{ gap: 2 }}>
                        <Text style={[styles.body, { fontFamily: fonts.semibold, marginTop: 6 }]}>
                          {st} · {euro(split.lines.filter((l) => l.store === st).reduce((a, l) => a + l.price, 0))}
                        </Text>
                        {split.lines
                          .filter((l) => l.store === st)
                          .map((l) => (
                            <View key={l.name} style={styles.cmpRow}>
                              <Text style={[styles.cmpName, { flex: 1 }]} numberOfLines={1}>{l.product ?? l.name}</Text>
                              <Text style={styles.cmpPrice}>{euro(l.price)}</Text>
                            </View>
                          ))}
                      </View>
                    ))
                  : null}
              </Pressable>
            ) : null}
            <Text style={styles.small}>
              Indicatie voor "{data.camp.name}": per product één verpakking. Staat iets niet in een winkel, dan rekenen we met het best
              passende alternatief daar. Tik op een winkel voor de details.
            </Text>
          </View>
        </View>
      ) : null}
      <AdSlot place="home" />
      {swap && data?.camp ? <SwapSheet campId={data.camp.id} store={swap.store} item={swap.item} onClose={() => setSwap(null)} /> : null}
    </ScrollView>
  );
}

type SwapOption = { product_id: string; name: string; unit?: string | null; image?: string | null; price?: number | null };

// Per product in de vergelijking zelf een ander product kiezen (bijv. als de app iets verkeerds vond)
function SwapSheet({ campId, store, item, onClose }: { campId: string; store: string; item: CompareItem; onClose: () => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const q = new URLSearchParams({ store, name: item.name, ...(item.product_id ? { product_id: item.product_id } : {}) });
  const { data, isLoading } = useQuery({
    queryKey: ["compare-options", store, item.name],
    queryFn: () => api<{ options: SwapOption[] }>(`/compare/options?${q.toString()}`),
  });
  const pick = useMutation({
    mutationFn: (product_id: string | null) =>
      api(`/camps/${campId}/compare-swap`, { method: "POST", body: { store, name: item.name, product_id } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["home"] });
      onClose();
    },
  });
  const options = (data?.options ?? []).filter((o) => o.product_id !== item.product_id);
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]} onPress={() => {}}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={[styles.cardTitle, { flex: 1 }]} numberOfLines={2}>
              {item.name} bij {store}
            </Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Icon name="close" size={22} color={colors.muted} />
            </Pressable>
          </View>
          {item.product ? (
            <View style={styles.cmpRow}>
              {item.image ? <Image source={{ uri: item.image }} style={styles.cmpImg} resizeMode="contain" /> : <View style={styles.cmpImg} />}
              <View style={{ flex: 1 }}>
                <Text style={styles.cmpName} numberOfLines={2}>{item.product}</Text>
                <Text style={styles.small}>Nu gekozen{item.price != null ? ` · ${euro(item.price)}` : ""}</Text>
              </View>
              {item.product_id ? (
                <Pressable
                  onPress={() => {
                    onClose();
                    router.push(`/product/${item.product_id}`);
                  }}
                  hitSlop={8}
                >
                  <Text style={styles.link}>Bekijken</Text>
                </Pressable>
              ) : null}
            </View>
          ) : (
            <Text style={styles.small}>Hier is nog niets voor gevonden. Kies hieronder zelf een product.</Text>
          )}
          <Text style={[styles.body, { fontFamily: fonts.semibold }]}>Kies een ander product</Text>
          <ScrollView style={{ maxHeight: 360 }}>
            {isLoading ? <ActivityIndicator color={colors.brandPrimary} style={{ marginVertical: 16 }} /> : null}
            {!isLoading && !options.length ? <Text style={styles.small}>Geen andere producten gevonden.</Text> : null}
            {options.map((o) => (
              <Pressable key={o.product_id} disabled={pick.isPending} onPress={() => pick.mutate(o.product_id)} style={styles.cmpRow}>
                {o.image ? <Image source={{ uri: o.image }} style={styles.cmpImg} resizeMode="contain" /> : <View style={styles.cmpImg} />}
                <View style={{ flex: 1 }}>
                  <Text style={styles.cmpName} numberOfLines={2}>{o.name}</Text>
                  {o.unit ? <Text style={styles.small}>{o.unit}</Text> : null}
                </View>
                <Text style={styles.cmpPrice}>{o.price != null ? euro(o.price) : "—"}</Text>
              </Pressable>
            ))}
          </ScrollView>
          {item.chosen ? (
            <Pressable disabled={pick.isPending} onPress={() => pick.mutate(null)} style={{ paddingVertical: 8 }}>
              <Text style={styles.link}>Terug naar de keuze van de app</Text>
            </Pressable>
          ) : null}
          {pick.isPending ? <ActivityIndicator color={colors.brandPrimary} /> : null}
          {pick.isError ? <Text style={[styles.small, { color: colors.error }]}>Dat lukte niet, probeer het nog eens.</Text> : null}
        </Pressable>
      </Pressable>
    </Modal>
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
  premTile: { flex: 1, alignItems: "center", gap: 6, paddingVertical: 12, borderRadius: 14, backgroundColor: GOLD.bg, borderWidth: 1, borderColor: GOLD.border },
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
  cmpRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.divider },
  cmpImg: { width: 34, height: 34, borderRadius: 8, backgroundColor: "#fff" },
  cmpName: { fontSize: 14, fontFamily: fonts.medium, color: colors.onSurface },
  cmpPrice: { fontSize: 14, fontFamily: fonts.semibold, color: colors.onSurface },
  splitBox: { borderRadius: 12, backgroundColor: colors.brandTertiary, padding: 12, gap: 6 },
  compareCard: { borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 14 },
  barTrack: { height: 8, borderRadius: 4, backgroundColor: colors.surfaceTertiary, overflow: "hidden" },
  bar: { height: 8, borderRadius: 4, backgroundColor: colors.brandPrimary },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, gap: 10, width: "100%", maxWidth: 640, alignSelf: "center" },
}));
