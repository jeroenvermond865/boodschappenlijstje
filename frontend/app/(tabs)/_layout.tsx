import { Platform } from "react-native";
import { Tabs } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";

import { Icon } from "@/src/components/ui";
import { usesNativeTabs } from "@/src/navigation";
import { useAppSettings } from "@/src/settings";
import { fonts, useTheme } from "@/src/theme";

export default function TabsLayout() {
  const { colors } = useTheme();
  const s = useAppSettings();

  if (usesNativeTabs) {
    return (
      <NativeTabs>
        <NativeTabs.Trigger name="index">
          <NativeTabs.Trigger.Icon sf="house.fill" />
          <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="camps">
          <NativeTabs.Trigger.Icon sf="tent" />
          <NativeTabs.Trigger.Label>{s.tab_camps}</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="dishes">
          <NativeTabs.Trigger.Icon sf="fork.knife" />
          <NativeTabs.Trigger.Label>{s.tab_dishes}</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="products">
          <NativeTabs.Trigger.Icon sf="cart" />
          <NativeTabs.Trigger.Label>{s.tab_products}</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="account">
          <NativeTabs.Trigger.Icon sf="person.fill" />
          <NativeTabs.Trigger.Label>{s.tab_account}</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      </NativeTabs>
    );
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brandPrimary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          ...(Platform.OS === "web" ? { height: 64 } : {}),
        },
        tabBarItemStyle: { alignSelf: "center" },
        tabBarLabelStyle: { fontFamily: fonts.medium, fontSize: 11 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color, size }) => <Icon name="home-variant-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="camps"
        options={{
          title: s.tab_camps,
          tabBarIcon: ({ color, size }) => <Icon name="tent" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="dishes"
        options={{
          title: s.tab_dishes,
          tabBarIcon: ({ color, size }) => <Icon name="silverware-fork-knife" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="products"
        options={{
          title: s.tab_products,
          tabBarIcon: ({ color, size }) => <Icon name="cart-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: s.tab_account,
          tabBarIcon: ({ color, size }) => <Icon name="account-outline" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
