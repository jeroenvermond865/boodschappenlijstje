import { Platform } from "react-native";

// NativeTabs only on iOS 26+. Everything else uses the classic JS Tabs.
export const usesNativeTabs =
  Platform.OS === "ios" && parseInt(String(Platform.Version), 10) >= 26;
