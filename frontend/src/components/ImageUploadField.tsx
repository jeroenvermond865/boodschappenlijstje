import { useState } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, Text, View } from "react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";

import { mediaUrl, uploadImage } from "@/src/api";
import { usePrivateSource } from "@/src/components/SafeImage";
import { Icon } from "@/src/components/ui";
import { fonts, makeStyles, useTheme } from "@/src/theme";

type Props = {
  label: string;
  value?: string | null;
  onChange: (url: string) => void;
  aspect?: number; // width / height of the preview
  circle?: boolean;
  testID?: string;
};

export function ImageUploadField({ label, value, onChange, aspect = 16 / 9, circle, testID }: Props) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [busy, setBusy] = useState(false);

  const pick = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      if (perm.canAskAgain) {
        Alert.alert("Toegang nodig", "Geef toegang tot je foto's om een afbeelding te kiezen.");
      } else {
        Alert.alert(
          "Toegang geweigerd",
          "Sta toegang tot je foto's toe in de instellingen om een afbeelding te kiezen.",
          [
            { text: "Annuleren", style: "cancel" },
            { text: "Instellingen openen", onPress: () => Linking.openSettings() },
          ],
        );
      }
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: circle ? [1, 1] : [16, 9],
      quality: 0.7,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    const name = asset.fileName ?? `upload_${Date.now()}.jpg`;
    const type = asset.mimeType ?? "image/jpeg";
    setBusy(true);
    try {
      const { url } = await uploadImage(asset.uri, name, type);
      onChange(url);
    } catch (e: any) {
      Alert.alert("Mislukt", e?.message ?? "Uploaden mislukt. Probeer het opnieuw.");
    } finally {
      setBusy(false);
    }
  };

  const src = mediaUrl(value);
  const priv = usePrivateSource(src);
  const shown = priv.private ? priv.src : src ? { uri: src } : null;

  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.label}>{label}</Text>
      <Pressable testID={testID} onPress={pick} disabled={busy} style={styles.wrap}>
        <View style={[styles.preview, circle ? styles.circle : { aspectRatio: aspect }]}>
          {shown ? (
            <Image source={shown} style={{ width: "100%", height: "100%" }} contentFit="cover" />
          ) : (
            <Icon name="image-plus" size={28} color={colors.muted} />
          )}
          {busy ? (
            <View style={styles.busy}>
              <ActivityIndicator color={colors.onBrandPrimary} />
            </View>
          ) : null}
        </View>
        <View style={styles.editBadge}>
          <Icon name="camera" size={16} color={colors.onBrandPrimary} />
          <Text style={styles.editText}>{src ? "Wijzigen" : "Kies afbeelding"}</Text>
        </View>
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  label: { fontSize: 14, fontFamily: fonts.semibold, color: colors.onSurface },
  wrap: { gap: 8 },
  preview: {
    width: "100%",
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.divider,
  },
  circle: { width: 96, height: 96, borderRadius: 48, alignSelf: "flex-start" },
  busy: { ...require("react-native").StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.25)" },
  editBadge: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", backgroundColor: colors.brandPrimary, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  editText: { fontSize: 14, fontFamily: fonts.semibold, color: colors.onBrandPrimary },
}));
