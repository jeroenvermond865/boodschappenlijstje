import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { FadeInUp, FadeOutUp } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fonts, useTheme } from "@/src/theme";

type ToastType = "success" | "error" | "info";
type ToastAction = { label: string; onPress: () => void };
type ToastState = { message: string; type: ToastType; action?: ToastAction } | null;

type ToastContextType = { show: (message: string, type?: ToastType, action?: ToastAction) => void };

const ToastContext = createContext<ToastContextType | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const show = useCallback((message: string, type: ToastType = "info", action?: ToastAction) => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ message, type, action });
    timer.current = setTimeout(() => setToast(null), action ? 5000 : 2800);
  }, []);

  const bg =
    toast?.type === "success" ? colors.success : toast?.type === "error" ? colors.error : colors.surfaceInverse;
  const fg =
    toast?.type === "success" ? colors.onSuccess : toast?.type === "error" ? colors.onError : colors.onSurfaceInverse;

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {toast ? (
        <Animated.View
          entering={FadeInUp}
          exiting={FadeOutUp}
          pointerEvents="box-none"
          style={[styles.wrap, { top: insets.top + 8 }]}
          testID="app-toast"
        >
          <View style={[styles.toast, { backgroundColor: bg }]}>
            <Text style={[styles.text, { color: fg }]} numberOfLines={2}>
              {toast.message}
            </Text>
            {toast.action ? (
              <Pressable
                testID="toast-action"
                hitSlop={8}
                onPress={() => {
                  if (timer.current) clearTimeout(timer.current);
                  const a = toast.action;
                  setToast(null);
                  a?.onPress();
                }}
                style={styles.actionBtn}
              >
                <Text style={[styles.actionText, { color: fg }]}>{toast.action.label}</Text>
              </Pressable>
            ) : null}
          </View>
        </Animated.View>
      ) : null}
    </ToastContext.Provider>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    paddingHorizontal: 16,
    zIndex: 9999,
  },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    maxWidth: 480,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 14,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  text: { flexShrink: 1, fontSize: 14, fontFamily: fonts.medium },
  actionBtn: { paddingHorizontal: 4, paddingVertical: 2 },
  actionText: { fontSize: 14, fontFamily: fonts.bold, textDecorationLine: "underline" },
});
