import React from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleProp,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from "react-native";
import Modal from "@/src/components/Modal";
import { useState } from "react";
import * as Haptics from "expo-haptics";
import MaterialDesignIcons from "@react-native-vector-icons/material-design-icons";

import { PressScale } from "@/src/components/motion";
import { fonts, makeStyles, softShadow, useTheme } from "@/src/theme";

export function Icon({
  name,
  size = 22,
  color,
}: {
  name: any;
  size?: number;
  color?: string;
}) {
  const { colors } = useTheme();
  return <MaterialDesignIcons name={name} size={size} color={color ?? colors.onSurface} />;
}

export function Button({
  label,
  onPress,
  variant = "primary",
  loading,
  disabled,
  icon,
  testID,
  style,
  sub,
}: {
  label: string;
  sub?: string; // klein tweede regeltje onder de tekst, bijv. "toevoegen"
  onPress: () => void;
  variant?: "primary" | "secondary" | "ghost";
  loading?: boolean;
  disabled?: boolean;
  icon?: any;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const isDisabled = disabled || loading;

  const bg =
    variant === "primary" ? styles.btnPrimary : variant === "secondary" ? styles.btnSecondary : styles.btnGhost;
  const fg =
    variant === "primary" ? colors.onBrandPrimary : variant === "secondary" ? colors.onBrandSecondary : colors.brandPrimary;

  return (
    <PressScale
      testID={testID}
      disabled={isDisabled}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
        onPress();
      }}
      style={[styles.btn, bg, isDisabled && styles.btnDisabled, style]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={styles.btnRow}>
          {icon ? <Icon name={icon} size={18} color={fg} /> : null}
          {sub ? (
            <View style={{ alignItems: "center" }}>
              <Text style={[styles.btnText, { color: fg }]} numberOfLines={1}>{label}</Text>
              <Text style={{ fontSize: 11, fontFamily: fonts.medium, color: fg, opacity: 0.85, marginTop: -1 }}>{sub}</Text>
            </View>
          ) : (
            <Text style={[styles.btnText, { color: fg }]}>{label}</Text>
          )}
        </View>
      )}
    </PressScale>
  );
}

export function Stepper({
  value,
  onChange,
  min = 0,
  max = 999,
  testID,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  testID?: string;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const tap = (next: number) => {
    Haptics.selectionAsync().catch(() => {});
    onChange(Math.max(min, Math.min(max, next)));
  };
  return (
    <View style={styles.stepper} testID={testID}>
      <Pressable
        testID={testID ? `${testID}-minus` : undefined}
        onPress={() => tap(value - 1)}
        style={({ pressed }) => [styles.stepBtn, pressed && styles.btnPressed]}
        hitSlop={6}
      >
        <Icon name="minus" size={20} color={colors.onSurface} />
      </Pressable>
      <Text style={styles.stepValue} testID={testID ? `${testID}-value` : undefined}>
        {value}
      </Text>
      <Pressable
        testID={testID ? `${testID}-plus` : undefined}
        onPress={() => tap(value + 1)}
        style={({ pressed }) => [styles.stepBtn, pressed && styles.btnPressed]}
        hitSlop={6}
      >
        <Icon name="plus" size={20} color={colors.onSurface} />
      </Pressable>
    </View>
  );
}

export function Field({
  label,
  style,
  containerStyle,
  ...props
}: TextInputProps & { label?: string; containerStyle?: StyleProp<ViewStyle> }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={[styles.fieldWrap, containerStyle]}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={colors.muted}
        style={[styles.input, style]}
        {...props}
      />
    </View>
  );
}

export function PasswordField({
  label,
  containerStyle,
  ...props
}: TextInputProps & { label?: string; containerStyle?: StyleProp<ViewStyle> }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [show, setShow] = useState(false);
  return (
    <View style={[styles.fieldWrap, containerStyle]}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      <View style={styles.pwRow}>
        <TextInput
          placeholderTextColor={colors.muted}
          style={[styles.input, styles.pwInput]}
          secureTextEntry={!show}
          autoCapitalize="none"
          {...props}
        />
        <Pressable onPress={() => setShow((v) => !v)} hitSlop={10} style={styles.pwEye}>
          <Icon name={show ? "eye-off-outline" : "eye-outline"} size={20} color={colors.muted} />
        </Pressable>
      </View>
    </View>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const styles = useStyles();
  return <View style={[styles.card, style]}>{children}</View>;
}

export function EmptyState({
  icon,
  title,
  subtitle,
}: {
  icon: any;
  title: string;
  subtitle?: string;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.empty} testID="empty-state">
      <View style={styles.emptyIcon}>
        <Icon name={icon} size={34} color={colors.brandPrimary} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      {subtitle ? <Text style={styles.emptySub}>{subtitle}</Text> : null}
    </View>
  );
}

export function Select({
  value,
  options,
  onChange,
  icon,
  disabled,
  testID,
  style,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  icon?: any;
  disabled?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        testID={testID}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={[styles.select, style]}
      >
        {icon ? <Icon name={icon} size={14} color={colors.onSurfaceTertiary} /> : null}
        <Text style={styles.selectText} numberOfLines={1}>
          {value}
        </Text>
        {!disabled ? <Icon name="chevron-down" size={16} color={colors.muted} /> : null}
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.selectBackdrop} onPress={() => setOpen(false)}>
          <View style={styles.selectSheet}>
            <ScrollView>
              {options.map((opt) => {
                const active = opt === value;
                return (
                  <Pressable
                    key={opt}
                    testID={testID ? `${testID}-opt-${opt}` : undefined}
                    onPress={() => {
                      onChange(opt);
                      setOpen(false);
                    }}
                    style={[styles.selectOpt, active && styles.selectOptActive]}
                  >
                    <Text style={[styles.selectOptText, active && styles.selectOptTextActive]}>{opt}</Text>
                    {active ? <Icon name="check" size={18} color={colors.brandPrimary} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const useStyles = makeStyles((colors) => ({
  btn: {
    borderRadius: 16,
    paddingVertical: 15,
    paddingHorizontal: 20,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 52,
  },
  btnRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  btnPrimary: { backgroundColor: colors.brandPrimary, ...softShadow(colors, 1) },
  btnSecondary: { backgroundColor: colors.brandSecondary, ...softShadow(colors, 1) },
  btnGhost: { backgroundColor: "transparent", borderWidth: 1.5, borderColor: colors.borderStrong },
  btnDisabled: { opacity: 0.5 },
  btnPressed: { opacity: 0.85, transform: [{ scale: 0.94 }] },
  btnText: { fontSize: 16, fontFamily: fonts.semibold },

  stepper: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surfaceTertiary,
    borderRadius: 999,
    padding: 4,
  },
  stepBtn: {
    width: 38,
    height: 38,
    borderRadius: 999,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  stepValue: {
    minWidth: 44,
    textAlign: "center",
    fontSize: 17,
    fontFamily: fonts.bold,
    color: colors.onSurface,
  },

  fieldWrap: { gap: 7 },
  fieldLabel: { fontSize: 13, fontFamily: fonts.semibold, color: colors.onSurfaceSecondary },
  pwRow: { position: "relative", justifyContent: "center" },
  pwInput: { paddingRight: 48 },
  pwEye: { position: "absolute", right: 10, padding: 6 },
  input: {
    backgroundColor: colors.surfaceTertiary,
    borderRadius: 12,
    paddingHorizontal: 15,
    paddingVertical: 14,
    fontSize: 16,
    fontFamily: fonts.regular,
    color: colors.onSurface,
    borderWidth: 1,
    borderColor: colors.border,
  },

  card: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    ...softShadow(colors, 1),
  },

  empty: { alignItems: "center", justifyContent: "center", paddingVertical: 40, gap: 10, paddingHorizontal: 24 },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 999,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  emptyTitle: { fontSize: 18, fontFamily: fonts.bold, color: colors.onSurface, textAlign: "center" },
  emptySub: { fontSize: 14, fontFamily: fonts.regular, color: colors.muted, textAlign: "center", lineHeight: 20 },
  select: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  selectText: { flex: 1, fontSize: 13, fontFamily: fonts.semibold, color: colors.onSurfaceTertiary },
  selectBackdrop: { flex: 1, backgroundColor: "rgba(28,27,26,0.45)", alignItems: "center", justifyContent: "center", padding: 32 },
  selectSheet: { backgroundColor: colors.surface, borderRadius: 16, width: "100%", maxHeight: 360, paddingVertical: 6 },
  selectOpt: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 18, paddingVertical: 14 },
  selectOptActive: { backgroundColor: colors.brandTertiary },
  selectOptText: { fontSize: 15, fontFamily: fonts.medium, color: colors.onSurface },
  selectOptTextActive: { color: colors.onBrandTertiary, fontFamily: fonts.semibold },
}));
