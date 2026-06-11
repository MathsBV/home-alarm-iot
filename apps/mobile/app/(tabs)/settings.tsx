import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Screen } from "@/components/Screen";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { demoMode } from "@/lib/firebase";
import { registerForPushNotifications } from "@/lib/notifications";
import { colors, radius } from "@/theme";

export default function SettingsScreen() {
  const { session, homeId, getToken, logout, setHomeId } = useAuth();
  const [pushEnabled, setPushEnabled] = useState(false);

  const enablePush = async () => {
    if (!homeId) return;
    try {
      const token = await registerForPushNotifications();
      if (!token) {
        Alert.alert("Push ainda não configurado", "Use um Development Build em aparelho físico e configure o projectId do EAS.");
        return;
      }
      await api.registerPushToken(homeId, await getToken(), token);
      setPushEnabled(true);
      Alert.alert("Notificações ativadas", "Este aparelho receberá alertas críticos.");
    } catch (error) {
      Alert.alert("Falha ao ativar", error instanceof Error ? error.message : "Tente novamente.");
    }
  };

  const exit = async () => {
    await logout();
    router.replace("/login");
  };

  return (
    <Screen title="Ajustes" subtitle="Integrações, dados e segurança da conta.">
      {demoMode ? <View style={styles.notice}><Ionicons name="flask" size={20} color={colors.warning} /><Text style={styles.noticeText}>Modo demonstração ativo. Use o PIN 1234.</Text></View> : null}
      {demoMode ? (
        <Button
          title="Simular disparo na Zona 1"
          variant="danger"
          onPress={async () => {
            if (!homeId) return;
            try {
              await api.triggerDemo(homeId, await getToken());
              Alert.alert("Disparo simulado", "Abra o painel para acompanhar o evento.");
            } catch (error) {
              Alert.alert("Simulação indisponível", error instanceof Error ? error.message : "Tente novamente.");
            }
          }}
        />
      ) : null}
      <Setting icon="notifications" title="Notificações push" detail={pushEnabled ? "Ativadas neste aparelho" : "Requer Development Build"} />
      <Button title={pushEnabled ? "Push ativado" : "Ativar notificações"} onPress={enablePush} disabled={pushEnabled} />
      <Setting icon="download" title="Exportação Power BI" detail="Endpoints CSV e JSON protegidos por token Firebase" />
      {homeId ? <Text style={styles.endpoint}>{api.exportUrl(homeId, "csv")}</Text> : null}
      <Setting icon="person-circle" title="Conta conectada" detail={session?.email ?? "Usuário de demonstração"} />
      <Button title="Trocar residência" variant="secondary" onPress={async () => { await setHomeId(null); router.replace("/setup"); }} />
      <Button title="Sair da conta" variant="danger" onPress={exit} />
      <Text style={styles.version}>Alarme Residencial · versão 1.0.0</Text>
    </Screen>
  );
}

function Setting({ icon, title, detail }: { icon: keyof typeof Ionicons.glyphMap; title: string; detail: string }) {
  return <View style={styles.item}><View style={styles.icon}><Ionicons name={icon} size={21} color={colors.primary} /></View><View style={{ flex: 1, gap: 3 }}><Text style={styles.title}>{title}</Text><Text style={styles.detail}>{detail}</Text></View></View>;
}

const styles = StyleSheet.create({
  notice: { flexDirection: "row", gap: 9, padding: 13, borderRadius: radius.medium, backgroundColor: "#3B2C13" },
  noticeText: { color: colors.warning, fontWeight: "700", flex: 1 },
  item: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.medium, padding: 14 },
  icon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  title: { color: colors.text, fontWeight: "800" },
  detail: { color: colors.textMuted, fontSize: 12 },
  endpoint: { color: colors.textMuted, backgroundColor: colors.surface, borderRadius: 10, padding: 12, fontSize: 11 },
  version: { color: colors.textMuted, textAlign: "center", fontSize: 11, marginTop: 12 },
});
