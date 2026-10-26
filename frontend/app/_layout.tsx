import { useEffect } from "react";
import { ActivityIndicator, LogBox, View } from "react-native";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter, useSegments } from "expo-router";
import { useFonts } from "expo-font";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { ErrorBoundary } from "@/src/components/error-boundary";
import { queryClient } from "@/src/query-client";
import { AuthProvider, useAuth } from "@/src/auth";
import { ToastProvider } from "@/src/toast";
import { PremiumWelcome } from "@/src/PremiumWelcome";
import { useTheme } from "@/src/theme";

LogBox.ignoreAllLogs(true);

function Gate() {
  const { status, user } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const { colors } = useTheme();

  useEffect(() => {
    if (status === "loading") return;
    const inAuth = segments[0] === "login";
    const inLegal = segments[0] === "legal";
    // Eerst akkoord met de voorwaarden en de uitleg gezien, daarna pas de app
    const needsWelcome = status === "authed" && !!user && (!user.terms_ok || !user.onboarded);
    if (status === "guest" && !inAuth && !inLegal) {
      router.replace("/login");
    } else if (needsWelcome && segments[0] !== "welcome" && !inLegal) {
      router.replace("/welcome");
    } else if (status === "authed" && inAuth) {
      router.replace("/");
    }
  }, [status, user, segments, router]);

  if (status === "loading") {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface }}>
        <ActivityIndicator size="large" color={colors.brandPrimary} />
      </View>
    );
  }

  return (
    <>
    <PremiumWelcome />
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surface } }}>
      <Stack.Screen name="login" />
      <Stack.Screen name="welcome" />
      <Stack.Screen name="help" />
      <Stack.Screen name="legal/[doc]" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="camp/new" options={{ presentation: "modal" }} />
      <Stack.Screen name="camp/[id]" />
      <Stack.Screen name="shopping/[id]" />
      <Stack.Screen name="dish/edit" options={{ presentation: "modal" }} />
      <Stack.Screen name="package/edit" options={{ presentation: "modal" }} />
      <Stack.Screen name="dish/shared/[token]" />
      <Stack.Screen name="admin/submissions" />
      <Stack.Screen name="admin/store-requests" />
      <Stack.Screen name="admin/premium-requests" />
      <Stack.Screen name="premium" />
      <Stack.Screen name="pantry" />
      <Stack.Screen name="store-request" options={{ presentation: "modal" }} />
      <Stack.Screen name="product/[id]" />
      <Stack.Screen name="folders" />
      <Stack.Screen name="recipe/[id]" />
      <Stack.Screen name="admin/users" />
      <Stack.Screen name="admin/roles" />
      <Stack.Screen name="account/profile" />
      <Stack.Screen name="account/diet" />
      <Stack.Screen name="budget/[id]" />
      <Stack.Screen name="admin/settings" />
    </Stack>
    </>
  );
}

export default function RootLayout() {
  useFonts({
    PlusJakarta_400Regular: "https://cdn.jsdelivr.net/fontsource/fonts/plus-jakarta-sans@latest/latin-400-normal.ttf",
    PlusJakarta_500Medium: "https://cdn.jsdelivr.net/fontsource/fonts/plus-jakarta-sans@latest/latin-500-normal.ttf",
    PlusJakarta_600SemiBold: "https://cdn.jsdelivr.net/fontsource/fonts/plus-jakarta-sans@latest/latin-600-normal.ttf",
    PlusJakarta_700Bold: "https://cdn.jsdelivr.net/fontsource/fonts/plus-jakarta-sans@latest/latin-700-normal.ttf",
  });

  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <QueryClientProvider client={queryClient}>
            <KeyboardProvider>
              <ToastProvider>
                <AuthProvider>
                  <StatusBar style="dark" />
                  <Gate />
                </AuthProvider>
              </ToastProvider>
            </KeyboardProvider>
          </QueryClientProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
