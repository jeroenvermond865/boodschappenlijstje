// Camera die een barcode leest en de cijfers teruggeeft zodra er één in beeld is.
// In de app doet expo-camera dat zelf. In de browser leest expo-camera alleen QR-codes, dus daar lezen we zelf:
// met de ingebouwde BarcodeDetector als de browser die heeft (Chrome op Android), anders met ZXing (iPhone/Safari).
import { useEffect, useRef, useState } from "react";
import { Platform, Text, View } from "react-native";
import { CameraView } from "expo-camera";

const ZXING_URL = "https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js";
const ZXING_SRI = "sha384-BzBxP10ZE72aitqj5UMmUsbKFliP/DZqA8Wq+BNNhlIJDGoEd1tpkMYXOg9+n6sB";

// Een EAN/UPC is pas echt als het controlecijfer klopt; zo voorkomen we halve of verkeerd gelezen codes
export function validEan(code: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false;
  const d = code.split("").map(Number);
  const check = d.pop()!;
  const sum = d.reverse().reduce((n, x, i) => n + x * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

let zxingLoad: Promise<any> | null = null;
function loadZxing(): Promise<any> {
  const g = globalThis as any;
  if (g.ZXing) return Promise.resolve(g.ZXing);
  if (!zxingLoad)
    zxingLoad = new Promise((resolve, reject) => {
      const s = g.document.createElement("script");
      s.src = ZXING_URL;
      s.integrity = ZXING_SRI;
      s.crossOrigin = "anonymous";
      s.onload = () => (g.ZXing ? resolve(g.ZXing) : reject(new Error("ZXing ontbreekt")));
      s.onerror = () => {
        zxingLoad = null;
        reject(new Error("ZXing laden mislukt"));
      };
      g.document.head.appendChild(s);
    });
  return zxingLoad;
}

// Maakt een functie die één beeld van de video leest: geeft de cijfers terug, of null als er (nog) niets te lezen is
async function makeReader(): Promise<(video: any, canvas: any) => Promise<string | null>> {
  const g = globalThis as any;
  if (g.BarcodeDetector) {
    try {
      const supported: string[] = (await g.BarcodeDetector.getSupportedFormats?.()) ?? [];
      const formats = ["ean_13", "ean_8", "upc_a", "upc_e"].filter((f) => !supported.length || supported.includes(f));
      if (formats.length) {
        const det = new g.BarcodeDetector({ formats });
        return async (video) => {
          const found = await det.detect(video);
          return found?.[0]?.rawValue ?? null;
        };
      }
    } catch {
      // dan ZXing
    }
  }
  const Z = await loadZxing();
  const hints = new Map();
  hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.UPC_E]);
  hints.set(Z.DecodeHintType.TRY_HARDER, true);
  const reader = new Z.MultiFormatReader();
  reader.setHints(hints);
  return async (video, canvas) => {
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return null;
    // Alleen de middelste band: daar houd je de barcode, en het is sneller
    const bandH = Math.round(h * 0.5);
    canvas.width = w;
    canvas.height = bandH;
    canvas.getContext("2d", { willReadFrequently: true }).drawImage(video, 0, (h - bandH) / 2, w, bandH, 0, 0, w, bandH);
    try {
      const bmp = new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(canvas)));
      return reader.decodeWithState(bmp).getText();
    } catch {
      return null;
    }
  };
}

function WebScanner({ onCode, onError }: { onCode: (code: string) => void; onError: (msg: string) => void }) {
  const box = useRef<any>(null);
  const [hint, setHint] = useState("Camera starten…");
  const cb = useRef({ onCode, onError });
  cb.current = { onCode, onError };

  useEffect(() => {
    const g = globalThis as any;
    let stream: any = null;
    let stopped = false;
    let timer: any = null;
    const video = g.document.createElement("video");
    video.setAttribute("playsinline", "true");
    video.muted = true;
    Object.assign(video.style, { width: "100%", height: "100%", objectFit: "cover", display: "block" });
    const canvas = g.document.createElement("canvas");
    // De div achter de React Native-View
    const host: any = box.current;
    host?.appendChild?.(video);

    (async () => {
      try {
        stream = await g.navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (stopped) return;
        video.srcObject = stream;
        await video.play();
        const read = await makeReader();
        if (stopped) return;
        setHint("Houd de barcode in het kader");
        // Twee keer dezelfde code achter elkaar = zeker goed gelezen
        let last = "";
        const tick = async () => {
          if (stopped) return;
          let code: string | null = null;
          try {
            code = await read(video, canvas);
          } catch {
            code = null;
          }
          const digits = (code ?? "").replace(/\D/g, "");
          if (digits && validEan(digits)) {
            if (digits === last) {
              stopped = true;
              g.navigator.vibrate?.(60);
              cb.current.onCode(digits);
              return;
            }
            last = digits;
          }
          timer = setTimeout(tick, 120);
        };
        tick();
      } catch (e: any) {
        if (stopped) return;
        cb.current.onError(
          e?.name === "NotAllowedError"
            ? "Geen toegang tot de camera. Typ de cijfers van de barcode of zoek op naam."
            : "Scannen lukt niet op dit apparaat. Typ de cijfers van de barcode of zoek op naam.",
        );
      }
    })();

    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks?.().forEach((t: any) => t.stop());
      video.remove();
    };
  }, []);

  return (
    <View style={{ flex: 1 }}>
      <View ref={box} style={{ flex: 1 }} />
      <View pointerEvents="none" style={{ position: "absolute", left: "10%", right: "10%", top: "30%", bottom: "30%", borderWidth: 2, borderColor: "rgba(255,255,255,0.9)", borderRadius: 12 }} />
      <Text style={{ position: "absolute", top: 10, alignSelf: "center", color: "#fff", fontSize: 13, backgroundColor: "rgba(0,0,0,0.5)", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, overflow: "hidden" }}>
        {hint}
      </Text>
    </View>
  );
}

// Toont de camera; roept onCode één keer aan met de cijfers van een geldige barcode
export function BarcodeScanner({ onCode, onError }: { onCode: (code: string) => void; onError: (msg: string) => void }) {
  const done = useRef(false);
  if (Platform.OS === "web") return <WebScanner onCode={onCode} onError={onError} />;
  return (
    <CameraView
      style={{ flex: 1 }}
      facing="back"
      barcodeScannerSettings={{ barcodeTypes: ["ean13", "ean8", "upc_a", "upc_e"] }}
      onBarcodeScanned={({ data }) => {
        const digits = String(data).replace(/\D/g, "");
        if (done.current || !validEan(digits)) return;
        done.current = true;
        onCode(digits);
      }}
    />
  );
}
