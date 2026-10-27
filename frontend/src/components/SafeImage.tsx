// Foto die altijd iets laat zien: lukt de foto van de winkel niet, dan via onze eigen server; lukt dat ook niet, dan een rustig vlak
import { useEffect, useState } from "react";
import { Image, ImageProps, View } from "react-native";

import { imageProxyUrl } from "@/src/api";

export default function SafeImage(props: ImageProps) {
  const src = props.source as { uri?: string } | number | undefined;
  const uri = typeof src === "object" && src && !Array.isArray(src) ? src.uri : undefined;
  const [step, setStep] = useState(0);
  useEffect(() => setStep(0), [uri]);
  if (!uri) return <Image {...props} />;
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
