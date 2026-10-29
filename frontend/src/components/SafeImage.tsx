// Foto die altijd iets laat zien: lukt de foto van de winkel niet, dan via onze eigen server; lukt dat ook niet, dan een rustig vlak.
// Geüploade foto's (van gebruikers) zijn alleen met je inlog te zien: die halen we met je inlog op.
import { useEffect, useState } from "react";
import { Image, ImageProps, View } from "react-native";

import { imageProxyUrl, isPrivateFile, privateFileSrc } from "@/src/api";

export function usePrivateSource(uri?: string) {
  const [src, setSrc] = useState<{ uri: string; headers?: Record<string, string> } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setSrc(null);
    setFailed(false);
    if (uri && isPrivateFile(uri)) {
      privateFileSrc(uri)
        .then((s) => alive && setSrc(s))
        .catch(() => alive && setFailed(true));
    }
    return () => {
      alive = false;
    };
  }, [uri]);
  return { private: !!uri && isPrivateFile(uri), src, failed };
}

export default function SafeImage(props: ImageProps) {
  const src = props.source as { uri?: string } | number | undefined;
  const uri = typeof src === "object" && src && !Array.isArray(src) ? src.uri : undefined;
  const [step, setStep] = useState(0);
  const priv = usePrivateSource(uri);
  useEffect(() => setStep(0), [uri]);
  if (!uri) return <Image {...props} />;
  if (priv.private) {
    if (!priv.src || priv.failed) return <View style={props.style as any} />;
    return <Image {...props} source={priv.src} />;
  }
  const proxied = imageProxyUrl(uri);
  if (step >= 2 || (step === 1 && !proxied)) return <View style={props.style as any} />;
  return (
    <Image
      {...props}
      source={{ ...(src as object), uri: step === 1 ? proxied! : uri }}
      onError={(e) => {
        setStep((s) => s + 1);
        props.onError?.(e);
      }}
    />
  );
}
