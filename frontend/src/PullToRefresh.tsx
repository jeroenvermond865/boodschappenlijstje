// Naar beneden trekken om te verversen, op elke pagina van de webapp.
// De browser kent de RefreshControl van de app niet; daarom kijken we hier zelf naar de vinger:
// sta je bovenaan een lijst en trek je omlaag, dan verschijnt een rondje. Laat je los na genoeg trekken,
// dan halen we alles wat op het scherm staat opnieuw op.
import { useEffect } from "react";
import { Platform } from "react-native";

import { queryClient } from "@/src/query-client";
import { useTheme } from "@/src/theme";

const LIMIT = 70; // zo ver trekken (px) en loslaten = verversen
const MAX = 110;

function scrollParent(el: Element | null): HTMLElement | null {
  for (let n = el as HTMLElement | null; n && n !== document.body; n = n.parentElement) {
    const st = getComputedStyle(n);
    if (/(auto|scroll)/.test(st.overflowY) && n.scrollHeight > n.clientHeight + 1) return n;
  }
  return null;
}

export function PullToRefresh() {
  const { colors } = useTheme();
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const wrap = document.createElement("div");
    wrap.setAttribute("aria-hidden", "true");
    Object.assign(wrap.style, {
      position: "fixed", left: "50%", top: "0px", width: "40px", height: "40px", marginLeft: "-20px", borderRadius: "20px",
      background: colors.surface, boxShadow: "0 2px 10px rgba(0,0,0,0.18)", zIndex: "9999", display: "flex",
      alignItems: "center", justifyContent: "center", transform: "translateY(-60px)", opacity: "0", pointerEvents: "none",
    } as CSSStyleDeclaration);
    const ring = document.createElement("div");
    Object.assign(ring.style, {
      width: "20px", height: "20px", borderRadius: "10px", border: `3px solid ${colors.brandPrimary}`, borderTopColor: "transparent",
      boxSizing: "border-box",
    } as CSSStyleDeclaration);
    wrap.appendChild(ring);
    document.body.appendChild(wrap);
    const style = document.createElement("style");
    style.textContent = "@keyframes ptr-spin{to{transform:rotate(360deg)}}";
    document.head.appendChild(style);

    let startY = 0;
    let startX = 0;
    let pull = 0;
    let active = false;
    let busy = false;
    let scroller: HTMLElement | null = null;

    const show = (p: number, animate: boolean) => {
      wrap.style.transition = animate ? "transform 0.25s ease, opacity 0.25s ease" : "none";
      const top = Math.min(p, MAX) - 50;
      wrap.style.transform = `translateY(calc(env(safe-area-inset-top, 0px) + ${top}px))`;
      wrap.style.opacity = p > 8 ? String(Math.min(1, p / LIMIT)) : "0";
      if (!busy) ring.style.transform = `rotate(${p * 4}deg)`;
    };

    const onStart = (e: TouchEvent) => {
      if (busy || e.touches.length !== 1) return;
      const t = e.target as Element;
      // In een pop-up, een veld of een kaart die zelf beweegt niet verversen
      if (t.closest?.('[aria-modal="true"], input, textarea, [data-no-ptr]')) return;
      scroller = scrollParent(t);
      if ((scroller?.scrollTop ?? window.scrollY) > 0) return;
      startY = e.touches[0].clientY;
      startX = e.touches[0].clientX;
      pull = 0;
      active = true;
    };
    const onMove = (e: TouchEvent) => {
      if (!active) return;
      const dy = e.touches[0].clientY - startY;
      const dx = e.touches[0].clientX - startX;
      if (pull === 0 && (Math.abs(dx) > Math.abs(dy) || dy < 0 || (scroller?.scrollTop ?? 0) > 0)) {
        if (Math.abs(dx) > 6 || dy < -6) active = false; // opzij vegen of omhoog scrollen: niet voor ons
        return;
      }
      pull = Math.max(0, dy * 0.5);
      if (pull > 0 && e.cancelable) e.preventDefault(); // anders schiet de pagina mee
      show(pull, false);
    };
    const onEnd = () => {
      if (!active) return;
      active = false;
      if (pull >= LIMIT) {
        busy = true;
        show(LIMIT, true);
        ring.style.animation = "ptr-spin 0.8s linear infinite";
        const started = Date.now();
        queryClient
          .refetchQueries({ type: "active" })
          .catch(() => undefined)
          .finally(() => {
            // Altijd even laten zien dat er ververst is, ook als het heel snel ging
            setTimeout(() => {
              busy = false;
              ring.style.animation = "";
              show(0, true);
            }, Math.max(0, 500 - (Date.now() - started)));
          });
      } else {
        show(0, true);
      }
      pull = 0;
    };

    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd);
    document.addEventListener("touchcancel", onEnd);
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onEnd);
      wrap.remove();
      style.remove();
    };
  }, [colors.surface, colors.brandPrimary]);
  return null;
}
