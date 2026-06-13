import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import * as Notifications from "expo-notifications";
import { router, Tabs } from "expo-router";
import { useEffect, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { PUSH_ENABLED_KEY, registerForPushNotifications } from "@/lib/notifications";
import { colors } from "@/theme";

export default function TabsLayout() {
  const { homeId, getToken } = useAuth();
  const handledInitial = useRef(false);

  useEffect(() => {
    if (!homeId) return;
    void (async () => {
      try {
        const token = await registerForPushNotifications();
        if (!token) return;
        await api.registerPushToken(homeId, await getToken(), token);
        await AsyncStorage.setItem(PUSH_ENABLED_KEY, "true");
      } catch {
        // best-effort — não travar o app se push falhar
      }
    })();
  }, [homeId, getToken]);

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(() => {
      router.replace("/(tabs)");
    });
    if (!handledInitial.current) {
      handledInitial.current = true;
      void Notifications.getLastNotificationResponseAsync().then((response) => {
        if (response) router.replace("/(tabs)");
      });
    }
    return () => sub.remove();
  }, []);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: 70,
          paddingTop: 8,
          paddingBottom: 10,
        },
        tabBarLabelStyle: { fontSize: 10, fontWeight: "700", letterSpacing: 0.4 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Painel", tabBarIcon: ({ color, size }) => <Ionicons name="grid" size={size} color={color} /> }} />
      <Tabs.Screen name="history" options={{ title: "Histórico", tabBarIcon: ({ color, size }) => <Ionicons name="time" size={size} color={color} /> }} />
      <Tabs.Screen name="contacts" options={{ title: "Contatos", tabBarIcon: ({ color, size }) => <Ionicons name="people" size={size} color={color} /> }} />
      <Tabs.Screen name="settings" options={{ title: "Ajustes", tabBarIcon: ({ color, size }) => <Ionicons name="settings" size={size} color={color} /> }} />
    </Tabs>
  );
}
