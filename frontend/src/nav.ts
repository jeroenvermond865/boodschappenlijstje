import { router } from "expo-router";

// Safe back: if there is history pop it, otherwise go to a known route.
// Prevents the "GO_BACK was not handled by any navigator" error that happens
// when a screen was reached via replace / deep link with no stack entry.
export function goBack(fallback: string = "/") {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace(fallback as any);
  }
}
