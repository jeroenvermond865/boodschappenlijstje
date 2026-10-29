import { useState } from "react";
import { Text, View } from "react-native";

import { Button, Field, Icon } from "@/src/components/ui";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { useToast } from "@/src/toast";
import { fonts, makeStyles, useTheme } from "@/src/theme";

// Herroepknop (bedenktijd): eerst "Herroep de overeenkomst hier", dan gegevens en "Bevestig herroeping".
// Werkt ook zonder in te loggen; de gebruiker krijgt een bevestiging per e-mail.
export function WithdrawForm() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { user } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [orderedOn, setOrderedOn] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ id: string; email: string } | null>(null);

  // Niet ingelogd met dit adres? Dan eerst een code per mail, zodat niemand namens een ander kan herroepen
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const needCode = !(user?.email && user.email.toLowerCase() === email.trim().toLowerCase());
  const send = async () => {
    setBusy(true);
    try {
      if (needCode && !codeSent) {
        await api("/legal/withdraw/code", { method: "POST", body: { email: email.trim() } });
        setCodeSent(true);
        toast.show(`We hebben een code gestuurd naar ${email.trim()}`, "success");
        return;
      }
      const r = await api<{ id: string }>("/legal/withdraw", {
        method: "POST",
        body: { name, email, ordered_on: orderedOn, note, code: code.trim() },
      });
      setDone({ id: r.id, email: email.trim() });
    } catch (e: any) {
      toast.show(e?.message ?? "Versturen mislukt. Mail ons gerust.", "error");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <View style={styles.box} testID="withdraw-done">
        <Icon name="check-circle-outline" size={26} color={colors.brandPrimary} />
        <Text style={styles.title}>Je herroeping is verstuurd</Text>
        <Text style={styles.text}>
          We hebben een bevestiging gestuurd naar {done.email} (kenmerk {done.id}). Heb je betaald, dan krijg je je geld binnen 14 dagen terug.
        </Text>
      </View>
    );
  }

  if (!open) {
    return <Button label="Herroep de overeenkomst hier" icon="undo-variant" variant="secondary" onPress={() => setOpen(true)} testID="withdraw-open" />;
  }

  return (
    <View style={styles.box}>
      <Text style={styles.title}>Herroepen</Text>
      <Field label="Je naam" testID="withdraw-name" value={name} onChangeText={setName} maxLength={100} />
      <Field
        label="E-mailadres van je account"
        testID="withdraw-email"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        maxLength={200}
      />
      <Field label="Wanneer heb je Premium afgesloten? (niet verplicht)" testID="withdraw-date" placeholder="Bijv. 1 november 2026" value={orderedOn} onChangeText={setOrderedOn} maxLength={40} />
      <Field
        label="Toelichting (niet verplicht)"
        testID="withdraw-note"
        value={note}
        onChangeText={setNote}
        multiline
        maxLength={1000}
        style={{ minHeight: 70, textAlignVertical: "top" }}
      />
      <Text style={styles.small}>Dienst: Slim Boodschappenlijstje Premium. Je hoeft geen reden te geven.</Text>
      {needCode && codeSent ? (
        <Field label="Code uit de mail" testID="withdraw-code" value={code} onChangeText={setCode} keyboardType="number-pad" />
      ) : null}
      <Button
        label={needCode && !codeSent ? "Stuur een code naar mijn e-mail" : "Bevestig herroeping"}
        icon="check"
        onPress={send}
        loading={busy}
        disabled={name.trim().length < 2 || !email.includes("@") || (needCode && codeSent && code.trim().length < 6)}
        testID="withdraw-confirm"
      />
      <Button label="Annuleren" variant="ghost" onPress={() => setOpen(false)} testID="withdraw-cancel" />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  box: { gap: 12, backgroundColor: colors.surfaceTertiary, borderRadius: 16, padding: 16 },
  title: { fontSize: 16, fontFamily: fonts.bold, color: colors.onSurface },
  text: { fontSize: 14, lineHeight: 20, fontFamily: fonts.regular, color: colors.onSurfaceSecondary },
  small: { fontSize: 12, lineHeight: 17, fontFamily: fonts.regular, color: colors.muted },
}));
