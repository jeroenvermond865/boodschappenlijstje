import { useRef, useState } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, Icon } from "@/src/components/ui";
import { api } from "@/src/api";
import { goBack } from "@/src/nav";
import { useToast } from "@/src/toast";
import { fonts, makeStyles, useTheme } from "@/src/theme";

export default function ScanScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const [permission, requestPermission] = useCameraPermissions();
  const [looking, setLooking] = useState(false);
  const handled = useRef(false);

  const onScanned = async ({ data }: { data: string }) => {
    if (handled.current || looking) return;
    handled.current = true;
    setLooking(true);
    try {
      const r = await api<{ name: string; brand?: string; barcode?: string }>(`/off/barcode/${encodeURIComponent(data)}`);
      router.replace({
        pathname: "/product/edit",
        params: { name: r.name, brand: r.brand ?? "", barcode: r.barcode ?? data },
      });
    } catch {
      toast.show("Geen product gevonden voor deze barcode — vul handmatig in", "info");
      router.replace({ pathname: "/product/edit", params: { barcode: data } });
    }
  };

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
      <Pressable testID="back-button" onPress={() => goBack("/products")} hitSlop={10} style={styles.headerBtn}>
        <Icon name="close" size={24} color={colors.onSurface} />
      </Pressable>
      <Text style={styles.headerTitle}>Barcode scannen</Text>
      <View style={styles.headerBtn} />
    </View>
  );

  if (Platform.OS === "web") {
    return (
      <View style={styles.root}>
        {header}
        <View style={styles.center}>
          <Icon name="barcode-off" size={48} color={colors.muted} />
          <Text style={styles.msg}>Scannen werkt alleen in de app op je telefoon, niet in de webversie.</Text>
          <Button label="Handmatig invoeren" onPress={() => router.replace("/product/edit")} testID="manual-button" />
        </View>
      </View>
    );
  }

  if (!permission) {
    return (
      <View style={styles.root}>
        {header}
        <View style={styles.center}>
          <ActivityIndicator color={colors.brandPrimary} />
        </View>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.root}>
        {header}
        <View style={styles.center}>
          <Icon name="camera-outline" size={48} color={colors.muted} />
          <Text style={styles.msg}>Geef toegang tot de camera om barcodes te scannen.</Text>
          {permission.canAskAgain ? (
            <Button label="Camera toestaan" onPress={requestPermission} testID="grant-camera" />
          ) : (
            <Button label="Instellingen openen" onPress={() => Linking.openSettings()} testID="open-settings" />
          )}
          <Pressable onPress={() => router.replace("/product/edit")}>
            <Text style={styles.manualLink}>Handmatig invoeren</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {header}
      <View style={styles.cameraWrap}>
        <CameraView
          style={{ flex: 1 }}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ["ean13", "ean8", "upc_a", "upc_e"] }}
          onBarcodeScanned={onScanned}
        />
        <View style={styles.overlay} pointerEvents="none">
          <View style={styles.frame} />
          <Text style={styles.hint}>Richt op de streepjescode</Text>
        </View>
        {looking ? (
          <View style={styles.looking}>
            <ActivityIndicator color={colors.onBrandPrimary} />
            <Text style={styles.lookingText}>Product opzoeken…</Text>
          </View>
        ) : null}
      </View>
      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <Button label="Handmatig invoeren" variant="ghost" onPress={() => router.replace("/product/edit")} testID="manual-button" />
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  headerBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 17, fontFamily: fonts.semibold, color: colors.onSurface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 24 },
  msg: { fontSize: 15, fontFamily: fonts.regular, color: colors.onSurfaceSecondary, textAlign: "center" },
  manualLink: { fontSize: 15, fontFamily: fonts.semibold, color: colors.brandPrimary, marginTop: 4 },
  cameraWrap: { flex: 1, overflow: "hidden" },
  overlay: { ...{ position: "absolute" as const, top: 0, left: 0, right: 0, bottom: 0 }, alignItems: "center", justifyContent: "center", gap: 16 },
  frame: { width: 240, height: 150, borderWidth: 3, borderColor: "#fff", borderRadius: 16 },
  hint: { color: "#fff", fontSize: 15, fontFamily: fonts.semibold },
  looking: {
    position: "absolute",
    bottom: 24,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
  },
  lookingText: { color: colors.onBrandPrimary, fontSize: 14, fontFamily: fonts.semibold },
  footer: { paddingHorizontal: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.divider, backgroundColor: colors.surface },
}));
