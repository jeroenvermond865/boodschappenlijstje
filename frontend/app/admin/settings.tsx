import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button, Field, Icon } from "@/src/components/ui";
import { ImageUploadField } from "@/src/components/ImageUploadField";
import { api } from "@/src/api";
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
  group: { fontSize: 15, fontFamily: fonts.bold, color: colors.onSurface, marginTop: 4 },
  hint: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted, marginTop: -8 },
}));
