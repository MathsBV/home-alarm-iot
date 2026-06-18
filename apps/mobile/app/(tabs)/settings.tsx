import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import type { PropsWithChildren } from "react";
import { useEffect, useState } from "react";
import { Alert, Share, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Screen } from "@/components/Screen";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { demoMode } from "@/lib/firebase";
import { PUSH_ENABLED_KEY, registerForPushNotifications } from "@/lib/notifications";
import { colors, radius } from "@/theme";

export default function SettingsScreen() {
  const { session, homeId, getToken, logout, setHomeId } = useAuth();
  const [pushEnabled, setPushEnabled] = useState(false);

  useEffect(() => {
    void AsyncStorage.getItem(PUSH_ENABLED_KEY).then((val) => {
      if (val === "true") setPushEnabled(true);
    });
  }, []);

  const enablePush = async () => {
    if (!homeId) return;
    try {
      const token = await registerForPushNotifications();
      if (!token) {
        Alert.alert("Push ainda não configurado", "Use um Development Build em aparelho físico e configure o projectId do EAS.");
        return;
      }
      await api.registerPushToken(homeId, await getToken(), token);
      await AsyncStorage.setItem(PUSH_ENABLED_KEY, "true");
      setPushEnabled(true);
      Alert.alert("Notificações ativadas", "Este aparelho receberá alertas críticos.");
    } catch (error) {
      Alert.alert("Falha ao ativar", error instanceof Error ? error.message : "Tente novamente.");
    }
  };

  const exit = async () => {
    await AsyncStorage.removeItem(PUSH_ENABLED_KEY);
    await logout();
    router.replace("/login");
  };

  const exportar = async (format: "csv" | "json") => {
    if (!homeId) return;
    try {
      const content = await api.exportData(homeId, await getToken(), format);
      await Share.share({ message: content });
    } catch (error) {
      Alert.alert("Exportação indisponível", error instanceof Error ? error.message : "Tente novamente.");
    }
  };

  return (
    <Screen title="Ajustes" subtitle="Integrações, dados e segurança.">
      {demoMode ? (
        <View style={styles.demoBanner}>
          <Ionicons name="flask" size={16} color={colors.warning} />
          <Text style={styles.demoBannerText}>MODO DEMONSTRAÇÃO · PIN 1234</Text>
        </View>
      ) : null}

      {demoMode ? (
        <Button
          title="Simular disparo na Zona 1"
          variant="danger"
          onPress={async () => {
            if (!homeId) return;
            try {
              const { channels } = await api.triggerDemo(homeId, await getToken());
              const label = { sent: "enviado", failed: "falhou", skipped: "não configurado" };
              Alert.alert(
                "Disparo simulado",
                `Notificações:\n• Push: ${label[channels.push]}\n• E-mail: ${label[channels.email]}\n• SMS: ${label[channels.sms]}\n• WhatsApp: ${label[channels.whatsapp]}`,
              );
            } catch (error) {
              Alert.alert("Simulação indisponível", error instanceof Error ? error.message : "Tente novamente.");
            }
          }}
        />
      ) : null}

      <SectionGroup>
        <SettingRow icon="notifications" title="Notificações push" detail={pushEnabled ? "Ativadas neste aparelho" : "Requer Development Build"} />
        <View style={styles.groupAction}>
          <Button title={pushEnabled ? "Push ativado" : "Ativar notificações"} onPress={enablePush} disabled={pushEnabled} />
        </View>
      </SectionGroup>

      <SectionGroup>
        <SettingRow icon="download" title="Exportação de eventos" detail="Compartilhe os eventos em CSV ou JSON." />
        {homeId ? <Text style={styles.endpoint}>{api.exportUrl(homeId, "csv")}</Text> : null}
        <View style={styles.exportRow}>
          <View style={{ flex: 1 }}>
            <Button title="Exportar CSV" variant="secondary" onPress={() => void exportar("csv")} />
          </View>
          <View style={{ flex: 1 }}>
            <Button title="Exportar JSON" variant="secondary" onPress={() => void exportar("json")} />
          </View>
        </View>
      </SectionGroup>

      <SectionGroup>
        <SettingRow icon="person-circle" title="Conta conectada" detail={session?.email ?? "Usuário de demonstração"} />
      </SectionGroup>

      <View style={styles.actions}>
        <Button
          title="Trocar residência"
          variant="secondary"
          onPress={async () => { await setHomeId(null); router.replace("/setup"); }}
        />
        <Button title="Sair da conta" variant="danger" onPress={exit} />
      </View>

      <Text style={styles.version}>Alarme Residencial · v1.0.0</Text>
    </Screen>
  );
}

function SectionGroup({ children }: PropsWithChildren) {
  return <View style={styles.group}>{children}</View>;
}

function SettingRow({ icon, title, detail }: { icon: keyof typeof Ionicons.glyphMap; title: string; detail: string }) {
  return (
    <View style={styles.settingRow}>
      <View style={styles.settingIcon}>
        <Ionicons name={icon} size={19} color={colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.settingTitle}>{title}</Text>
        <Text style={styles.settingDetail}>{detail}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  demoBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 11,
    borderRadius: radius.medium,
    backgroundColor: colors.warningSurface,
    borderLeftWidth: 3,
    borderLeftColor: colors.warning,
  },
  demoBannerText: { color: colors.warning, fontWeight: "800", fontSize: 12, letterSpacing: 0.5 },

  group: {
    backgroundColor: colors.surface,
    borderRadius: radius.medium,
    overflow: "hidden",
  },
  groupAction: { padding: 12, borderTopWidth: 1, borderTopColor: colors.border },

  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    padding: 14,
  },
  settingIcon: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceElevated,
  },
  settingTitle: { color: colors.text, fontWeight: "700", fontSize: 14 },
  settingDetail: { color: colors.textMuted, fontSize: 12, marginTop: 2 },

  endpoint: {
    color: colors.textMuted,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.small,
    padding: 12,
    fontSize: 11,
    marginHorizontal: 14,
    marginBottom: 12,
  },
  exportRow: { flexDirection: "row", gap: 10, padding: 12, borderTopWidth: 1, borderTopColor: colors.border },
  actions: { gap: 10 },
  version: { color: colors.textMuted, textAlign: "center", fontSize: 11, marginTop: 4 },
});
