// Pop-up met een rustige animatie: de achtergrond fade in en de pop-up veert een klein stukje omhoog.
// Zelfde gebruik als Modal uit react-native.
import { useEffect, useRef } from "react";
import { Animated, Easing, Modal as RNModal, ModalProps } from "react-native";

export default function Modal({ visible, children, animationType, ...rest }: ModalProps) {
  const v = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) {
      v.setValue(0);
      return;
    }
    Animated.timing(v, { toValue: 1, duration: 260, easing: Easing.out(Easing.back(1.4)), useNativeDriver: true }).start();
  }, [visible, v]);

  return (
    <RNModal visible={visible} animationType="fade" {...rest}>
      <Animated.View
        style={{
          flex: 1,
          transform: [
            { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [28, 0] }) },
            { scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
          ],
        }}
      >
        {children}
      </Animated.View>
    </RNModal>
  );
}
