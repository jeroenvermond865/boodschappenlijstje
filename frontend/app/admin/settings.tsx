import { useEffect, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button, Field, Icon } from "@/src/components/ui";
import { ImageUploadField } from "@/src/components/ImageUploadField";
import { api, apiBlob } from "@/src/api";
import { singularOf } from "@/src/settings";
import { goBack } from "@/src/nav";
import { useToast } from "@/src/toast";
import { fonts, makeStyles, useTheme } from "@/src/theme";

type Settings = {
  app_name: string; tagline: string; hero_url: string; logo_url: string;
  tab_camps: string; term_one?: string; tab_dishes: string; tab_products: string; tab_account: string;
  sub_camps: string; sub_dishes: string; sub_products: string; sub_account: string;
};

export default function AppSettingsScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const qc = useQueryClient();

  const { data } = useQuery({ queryKey: ["settings"], queryFn: () => api<Settings>("/settings") });
  const [appName, setAppName] = useState("");
  const [tagline, setTagline] = useState("");
  const [heroUrl, setHeroUrl] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [tabCamps, setTabCamps] = useState("");
  const [termOne, setTermOne] = useState("");
  const [tabDishes, setTabDishes] = useState("");
  const [tabProducts, setTabProducts] = useState("");
  const [tabAccount, setTabAccount] = useState("");
  const [subCamps, setSubCamps] = useState("");
  const [subDishes, setSubDishes] = useState("");
  const [subProducts, setSubProducts] = useState("");
  const [subAccount, setSubAccount] = useState("");

  useEffect(() => {
    if (data) {
      setAppName(data.app_name);
      setTagline(data.tagline);
      setHeroUrl(data.hero_url);
      setLogoUrl(data.logo_url ?? "");
      setTabCamps(data.tab_camps ?? "Kampen");
      setTermOne(data.term_one ?? "");
      setTabDishes(data.tab_dishes ?? "Gerechten");
      setTabProducts(data.tab_products ?? "Producten");
      setTabAccount(data.tab_account ?? "Account");
      setSubCamps(data.sub_camps ?? "");
      setSubDishes(data.sub_dishes ?? "");
      setSubProducts(data.sub_products ?? "");
      setSubAccount(data.sub_account ?? "");
    }
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      api("/settings", {
        method: "PUT",
        body: {
          app_name: appName, tagline, hero_url: heroUrl, logo_url: logoUrl,
          tab_camps: tabCamps, term_one: termOne, tab_dishes: tabDishes, tab_products: tabProducts, tab_account: tabAccount,
          sub_camps: subCamps, sub_dishes: subDishes, sub_products: subProducts, sub_account: subAccount,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
      toast.show("App bijgewerkt", "success");
    },
    onError: (e: any) => toast.show(e?.message ?? "Opslaan mislukt", "error"),
  });

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable testID="back-button" onPress={() => goBack("/")} hitSlop={10} style={styles.headerBtn}>
          <Icon name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>App aanpassen</Text>
        <View style={styles.headerBtn} />
      </View>
      <KeyboardAwareScrollView bottomOffset={20} contentContainerStyle={{ padding: 16, gap: 16 }} keyboardShouldPersistTaps="handled">
        <Text style={styles.group}>Voorpagina & naam</Text>
        <Field label="App-naam" testID="settings-appname" value={appName} onChangeText={setAppName} />
        <Field label="Ondertitel" testID="settings-tagline" value={tagline} onChangeText={setTagline} multiline />
        <ImageUploadField
          label="Achtergrondafbeelding inlogscherm"
          testID="settings-hero-pick"
          value={heroUrl}
          onChange={setHeroUrl}
          aspect={16 / 9}
        />
        <ImageUploadField
          label="Klein logo"
          testID="settings-logo-pick"
          value={logoUrl}
          onChange={setLogoUrl}
          circle
        />
        <Text style={styles.hint}>Dit is wat gebruikers zien op het inlogscherm.</Text>

        <Text style={styles.group}>Tabbladen (naam + ondertitel)</Text>
        <Field label="Tab 1 – naam (meervoud)" testID="settings-tab-camps" value={tabCamps} onChangeText={setTabCamps} />
        <Field
          label="Tab 1 – enkelvoud"
          testID="settings-term-one"
          value={termOne}
          onChangeText={setTermOne}
          placeholder={singularOf(tabCamps || "Kampen")}
        />
        <Text style={styles.hint}>Zo heet één {(termOne || singularOf(tabCamps || "Kampen")).toLowerCase()} overal in de app. Leeg laten = automatisch.</Text>
        <Field label="Tab 1 – ondertitel" testID="settings-sub-camps" value={subCamps} onChangeText={setSubCamps} />
        <Field label="Tab 2 – naam (gerechten)" testID="settings-tab-dishes" value={tabDishes} onChangeText={setTabDishes} />
        <Field label="Tab 2 – ondertitel" testID="settings-sub-dishes" value={subDishes} onChangeText={setSubDishes} />
        <Field label="Tab 3 – naam (producten)" testID="settings-tab-products" value={tabProducts} onChangeText={setTabProducts} />
        <Field label="Tab 3 – ondertitel" testID="settings-sub-products" value={subProducts} onChangeText={setSubProducts} />
        <Field label="Tab 4 – naam (account)" testID="settings-tab-account" value={tabAccount} onChangeText={setTabAccount} />
        <Field label="Tab 4 – ondertitel" testID="settings-sub-account" value={subAccount} onChangeText={setSubAccount} />
        <Text style={styles.hint}>De naam én de ondertitel bovenaan elk tabblad passen zich hierop aan.</Text>

        <Button label="Opslaan" onPress={() => save.mutate()} loading={save.isPending} testID="settings-save" />
        <SourcesCard />
        <BackupCard />
      </KeyboardAwareScrollView>
    </View>
  );
}

type Sources = { recipe_content: boolean; image_proxy: boolean; full_import: boolean };
const SOURCE_ROWS: { key: keyof Sources; title: string; sub: string }[] = [
  { key: "recipe_content", title: "Recepten van de winkel volledig tonen", sub: "Hun bereiding, beschrijving, tips en foto's. Uit: alleen titel, ingrediënten en een link; de bereiding schrijft de app zelf." },
  { key: "image_proxy", title: "Winkelfoto's via onze server", sub: "Uit: de browser laat productfoto's direct bij de winkel zien." },
  { key: "full_import", title: "Hele assortiment ophalen", sub: "Alle producten via zoektermen, en nieuwe producten bij de dagelijkse prijsronde. Uit: alleen wat er al is en wat gebruikers zoeken." },
];

// Supermarktbronnen: alles staat uit tot een winkel toestemming geeft; dan zet je het hier weer aan
function SourcesCard() {
  const styles = useStyles();
  const { colors } = useTheme();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin-sources"], queryFn: () => api<Sources>("/admin/sources") });
  const save = useMutation({
    mutationFn: (ch: Partial<Sources>) => api<Sources>("/admin/sources", { method: "PUT", body: ch }),
    onSuccess: (r) => {
      qc.setQueryData(["admin-sources"], r);
      toast.show("Opgeslagen", "success");
    },
    onError: (e: any) => toast.show(e?.message ?? "Opslaan lukte niet", "error"),
  });
  return (
    <View style={{ gap: 10, marginTop: 12 }}>
      <Text style={styles.group}>Supermarktbronnen</Text>
      <Text style={[styles.hint, { marginTop: 0 }]}>
        Zolang er geen toestemming is, staat dit uit. Heeft een supermarkt ja gezegd, dan zet je het hier weer aan. Het geldt voor alle winkels tegelijk.
      </Text>
      {SOURCE_ROWS.map((row) => {
        const on = !!q.data?.[row.key];
        return (
          <Pressable
            key={row.key}
            testID={`source-${row.key}`}
            disabled={!q.data || save.isPending}
            onPress={() => save.mutate({ [row.key]: !on })}
            style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 6 }, pressed && { opacity: 0.7 }]}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 15, fontFamily: fonts.semibold, color: colors.onSurface }}>{row.title}</Text>
              <Text style={[styles.hint, { marginTop: 2 }]}>{row.sub}</Text>
            </View>
            <View style={{ width: 46, height: 28, borderRadius: 14, padding: 3, backgroundColor: on ? colors.brandPrimary : colors.border, alignItems: on ? "flex-end" : "flex-start" }}>
              <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: colors.surface }} />
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

type BackupStatus = { at: string | null; ok: boolean | null; size: number | null; error: string | null; to: string; ok_at: string | null };

const BACKUP_STALE_MS = 2 * 24 * 3600 * 1000; // langer geen geslaagde back-up: waarschuwen

// Back-up: elke nacht gaat er een naar je mail; hier zie je de laatste, en mail of download je er zelf een
function BackupCard() {
  const styles = useStyles();
  const { colors } = useTheme();
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const status = useQuery({ queryKey: ["backup-status"], queryFn: () => api<BackupStatus>("/admin/backup/status") });
  const mail = useMutation({
    mutationFn: () => api<BackupStatus>("/admin/backup/mail", { method: "POST" }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["backup-status"] });
      toast.show(r.ok ? `Back-up gemaild naar ${r.to}` : r.error ?? "Mailen lukte niet", r.ok ? "success" : "error");
    },
    onError: (e: any) => toast.show(e?.message ?? "Mailen lukte niet", "error"),
  });
  const download = async () => {
    if (Platform.OS !== "web") return toast.show("Downloaden kan op de website", "error");
    setBusy(true);
    try {
      const blob = await apiBlob("/admin/backup?history=true");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `backup-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    } catch (e: any) {
      toast.show(e?.message ?? "Downloaden lukte niet", "error");
    } finally {
      setBusy(false);
    }
  };
  const s = status.data;
  const stale = !!s && (!s.ok_at || Date.now() - new Date(s.ok_at).getTime() > BACKUP_STALE_MS);
  return (
    <View style={{ gap: 10, marginTop: 12 }}>
      <Text style={styles.group}>Back-up</Text>
      <Text style={[styles.hint, { marginTop: 0 }]}>
        Elke nacht gaat er een back-up van alle gegevens (gebruikers, lijstjes, gerechten, voorraad) naar {s?.to ?? "je mail"}.
        Winkelproducten zitten er niet in, die haalt de app zelf weer op.
      </Text>
      {stale ? (
        <Text style={[styles.hint, { marginTop: 0, color: colors.error, fontFamily: fonts.bold }]} testID="backup-stale">
          {s?.ok_at
            ? `Let op: de laatste geslaagde back-up is van ${new Date(s.ok_at).toLocaleDateString("nl-NL", { dateStyle: "medium" })}. Mail of download er nu een.`
            : "Let op: er is nog geen geslaagde back-up. Mail of download er nu een."}
        </Text>
      ) : null}
      {s ? (
        <Text style={[styles.hint, { marginTop: 0, color: s.at && s.ok === false ? colors.error : undefined }]}>
          {s.at
            ? `Laatste: ${new Date(s.at).toLocaleString("nl-NL", { dateStyle: "medium", timeStyle: "short" })}${s.size ? `, ${Math.max(1, Math.round(s.size / 1024))} kB` : ""}${s.ok ? ", gemaild" : s.error ? `. ${s.error}` : ""}`
            : "Nog geen back-up gemaakt."}
        </Text>
      ) : null}
      <Button label="Nu een back-up mailen" icon="email-outline" variant="secondary" onPress={() => mail.mutate()} loading={mail.isPending} testID="backup-mail" />
      <Button label="Back-up downloaden" sub="met prijsgeschiedenis" icon="download" variant="secondary" onPress={download} loading={busy} testID="backup-download" />
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
  group: { fontSize: 15, fontFamily: fonts.bold, color: colors.onSurface, marginTop: 4 },
  hint: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted, marginTop: -8 },
}));
