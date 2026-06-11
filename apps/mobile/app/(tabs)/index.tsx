import type { AlarmMode, CommandType } from "@home-alarm/contracts";
import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { PinModal } from "@/components/PinModal";
import { Screen } from "@/components/Screen";
import { VoiceCommandButton } from "@/components/VoiceCommandButton";
import { router } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { api, type DashboardResponse } from "@/lib/api";
import { colors, radius, shadow } from "@/theme";

type PendingCommand = {
  type: CommandType;
  value?: boolean | number | string;
  label: string;
};

const modeCopy: Record<AlarmMode, { label: string; color: string; icon: keyof typeof Ionicons.glyphMap }> = {
  disarmed: { label: "Desarmado", color: colors.info, icon: "shield-outline" },
  armed: { label: "Armado", color: colors.success, icon: "shield-checkmark" },
  pending: { label: "Temporizando", color: colors.warning, icon: "timer-outline" },
  triggered: { label: "Disparado", color: colors.danger, icon: "warning" },
  silenced: { label: "Silenciado", color: colors.textMuted, icon: "volume-mute" },
};

export default function DashboardScreen() {
  const { homeId, getToken, setHomeId } = useAuth();
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pending, setPending] = useState<PendingCommand | null>(null);
  const [delay, setDelay] = useState("30");

  const load = useCallback(async (quiet = false) => {
    if (!homeId) return;
    if (!quiet) setRefreshing(true);
    try {
      const token = await getToken();
      const dashboard = await api.dashboard(homeId, token);
      setData(dashboard);
      setDelay(String(dashboard.state.delaySeconds));
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode === 403) {
        await setHomeId(null);
        router.replace("/setup");
        return;
      }
      if (!quiet) Alert.alert("Painel indisponível", error instanceof Error ? error.message : "Tente novamente.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [getToken, homeId]);

  useEffect(() => {
    const initial = setTimeout(() => void load(true), 0);
    const timer = setInterval(() => void load(true), 4_000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [load]);

  if (loading || !data) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.muted}>Conectando à central...</Text>
      </View>
    );
  }

  const mode = modeCopy[data.state.mode];
  const command = (next: PendingCommand) => setPending(next);

  return (
    <Screen
      title={data.home.name}
      subtitle={`Central ${data.home.deviceId}`}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load()} tintColor={colors.primary} />}
    >
      <View style={[styles.hero, { borderColor: `${mode.color}55` }]}>
        <View style={[styles.heroIcon, { backgroundColor: `${mode.color}20` }]}>
          <Ionicons name={mode.icon} size={34} color={mode.color} />
        </View>
        <View style={styles.heroCopy}>
          <Text style={styles.eyebrow}>ESTADO DA CENTRAL</Text>
          <Text style={[styles.heroTitle, { color: mode.color }]}>{mode.label}</Text>
          <Text style={styles.muted}>
            {data.state.online ? "ESP32 conectado" : "ESP32 sem comunicação"} · Atualizado {formatTime(data.state.occurredAt)}
          </Text>
        </View>
        <View style={[styles.onlineDot, { backgroundColor: data.state.online ? colors.success : colors.danger }]} />
      </View>

      {data.state.mode === "pending" ? (
        <View style={styles.pendingBanner}>
          <Ionicons name="timer" color={colors.warning} size={20} />
          <Text style={styles.pendingText}>Disparo em {data.state.pendingSeconds ?? data.state.delaySeconds} segundos</Text>
        </View>
      ) : null}

      <View style={styles.actions}>
        <ActionButton
          icon={data.state.mode === "disarmed" ? "lock-closed" : "lock-open"}
          label={data.state.mode === "disarmed" ? "Armar" : "Desarmar"}
          color={data.state.mode === "disarmed" ? colors.success : colors.danger}
          onPress={() =>
            command({
              type: data.state.mode === "disarmed" ? "ARM" : "DISARM",
              label: data.state.mode === "disarmed" ? "Armar alarme" : "Desarmar alarme",
            })
          }
        />
        <ActionButton
          icon="volume-mute"
          label="Silenciar"
          color={colors.warning}
          disabled={!data.state.sirenActive}
          onPress={() => command({ type: "SILENCE", label: "Silenciar sirene" })}
        />
      </View>

      <VoiceCommandButton onCommand={command} />

      <SectionTitle title="Zonas monitoradas" detail={`${data.state.zones.filter((zone) => zone.violated).length} em alerta`} />
      <View style={styles.zoneGrid}>
        {data.state.zones.map((zone) => (
          <View key={zone.id} style={[styles.zoneCard, zone.violated && styles.zoneCardAlert]}>
            <View style={styles.zoneTop}>
              <Text style={styles.zoneNumber}>Z{zone.id}</Text>
              <Ionicons
                name={zone.violated ? "alert-circle" : "checkmark-circle"}
                size={19}
                color={zone.violated ? colors.danger : colors.success}
              />
            </View>
            <Text style={styles.zoneName} numberOfLines={1}>{zone.name}</Text>
            <Text style={styles.zoneSensor} numberOfLines={1}>{zone.sensorType}</Text>
          </View>
        ))}
      </View>

      <SectionTitle title="Temporização" detail="0 a 120 segundos" />
      <View style={styles.inlineCard}>
        <View style={styles.delayCopy}>
          <Text style={styles.cardTitle}>Atraso antes do disparo</Text>
          <Text style={styles.muted}>Configurado na central FPGA</Text>
        </View>
        <TextInput
          value={delay}
          onChangeText={setDelay}
          keyboardType="number-pad"
          maxLength={3}
          style={styles.delayInput}
        />
        <Pressable
          style={styles.saveSmall}
          onPress={() => {
            const value = Number(delay);
            if (!Number.isInteger(value) || value < 0 || value > 120) {
              Alert.alert("Valor inválido", "Use um número inteiro entre 0 e 120.");
              return;
            }
            command({ type: "SET_DELAY", value, label: `Alterar atraso para ${value}s` });
          }}
        >
          <Ionicons name="save-outline" color={colors.white} size={20} />
        </Pressable>
      </View>

      <SectionTitle title="Contramedidas" detail="Controle manual" />
      {data.state.countermeasures.map((item) => (
        <Pressable
          key={item.id}
          onPress={() => command({ type: "SET_COUNTERMEASURE", value: item.id, label: `${item.active ? "Desligar" : "Ligar"} ${item.name}` })}
          style={({ pressed }) => [styles.countermeasure, pressed && styles.pressed]}
        >
          <View style={[styles.counterIcon, item.active && styles.counterIconActive]}>
            <Ionicons name={item.id === "strobe" ? "flash" : "cloud"} size={22} color={item.active ? colors.warning : colors.textMuted} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>{item.name}</Text>
            <Text style={styles.muted}>{item.active ? "Ativa" : "Desativada"}</Text>
          </View>
          <View style={[styles.switch, item.active && styles.switchActive]}>
            <View style={[styles.switchKnob, item.active && styles.switchKnobActive]} />
          </View>
        </Pressable>
      ))}

      <View style={styles.stats}>
        <View><Text style={styles.statValue}>{data.state.triggerCount}</Text><Text style={styles.muted}>disparos</Text></View>
        <View style={styles.divider} />
        <View><Text style={styles.statValue}>{data.recentEvents.length}</Text><Text style={styles.muted}>eventos recentes</Text></View>
        <View style={styles.divider} />
        <View><Text style={styles.statValue}>{data.state.sirenActive ? "ON" : "OFF"}</Text><Text style={styles.muted}>sirene</Text></View>
      </View>

      <PinModal
        visible={Boolean(pending)}
        command={pending}
        onClose={() => setPending(null)}
        onSuccess={() => {
          [500, 1200, 2200, 3500].forEach((ms) => setTimeout(() => void load(true), ms));
        }}
      />
    </Screen>
  );
}

function SectionTitle({ title, detail }: { title: string; detail: string }) {
  return <View style={styles.sectionTitle}><Text style={styles.sectionHeading}>{title}</Text><Text style={styles.sectionDetail}>{detail}</Text></View>;
}

function ActionButton({ icon, label, color, onPress, disabled }: {
  icon: keyof typeof Ionicons.glyphMap; label: string; color: string; onPress: () => void; disabled?: boolean;
}) {
  return (
    <Pressable disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.actionButton, pressed && styles.pressed, disabled && styles.disabled]}>
      <View style={[styles.actionIcon, { backgroundColor: `${color}20` }]}><Ionicons name={icon} color={color} size={23} /></View>
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

const styles = StyleSheet.create({
  loading: { flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center", gap: 14 },
  muted: { color: colors.textMuted, fontSize: 12 },
  hero: { backgroundColor: colors.surface, borderWidth: 1, borderRadius: radius.large, padding: 18, flexDirection: "row", alignItems: "center", gap: 14, ...shadow },
  heroIcon: { width: 62, height: 62, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  heroCopy: { flex: 1, gap: 3 },
  eyebrow: { color: colors.textMuted, fontSize: 10, fontWeight: "900", letterSpacing: 1.3 },
  heroTitle: { fontSize: 25, fontWeight: "900" },
  onlineDot: { width: 9, height: 9, borderRadius: 5, alignSelf: "flex-start" },
  pendingBanner: { flexDirection: "row", gap: 8, alignItems: "center", padding: 13, borderRadius: radius.medium, backgroundColor: "#3B2C13" },
  pendingText: { color: colors.warning, fontWeight: "800" },
  actions: { flexDirection: "row", gap: 12 },
  actionButton: { flex: 1, minHeight: 82, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.medium, padding: 13, flexDirection: "row", alignItems: "center", gap: 10 },
  actionIcon: { width: 42, height: 42, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  actionLabel: { color: colors.text, fontWeight: "800", flexShrink: 1 },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.35 },
  sectionTitle: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginTop: 8 },
  sectionHeading: { color: colors.text, fontSize: 18, fontWeight: "800" },
  sectionDetail: { color: colors.textMuted, fontSize: 12 },
  zoneGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  zoneCard: { width: "48.5%", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.medium, padding: 13, gap: 4 },
  zoneCardAlert: { borderColor: colors.danger, backgroundColor: "#2B151D" },
  zoneTop: { flexDirection: "row", justifyContent: "space-between" },
  zoneNumber: { color: colors.primary, fontSize: 11, fontWeight: "900" },
  zoneName: { color: colors.text, fontSize: 14, fontWeight: "800" },
  zoneSensor: { color: colors.textMuted, fontSize: 11 },
  inlineCard: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.medium, padding: 14 },
  delayCopy: { flex: 1, gap: 3 },
  cardTitle: { color: colors.text, fontWeight: "800" },
  delayInput: { width: 58, height: 44, borderRadius: 12, color: colors.text, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, textAlign: "center", fontSize: 18, fontWeight: "800" },
  saveSmall: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.primaryDark },
  countermeasure: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.medium, padding: 14 },
  counterIcon: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  counterIconActive: { backgroundColor: "#403115" },
  switch: { width: 44, height: 25, borderRadius: 13, backgroundColor: colors.border, padding: 3 },
  switchActive: { backgroundColor: colors.primaryDark },
  switchKnob: { width: 19, height: 19, borderRadius: 10, backgroundColor: colors.white },
  switchKnobActive: { alignSelf: "flex-end" },
  stats: { flexDirection: "row", justifyContent: "space-around", alignItems: "center", backgroundColor: colors.surface, borderRadius: radius.medium, padding: 18 },
  statValue: { color: colors.text, fontSize: 21, fontWeight: "900", textAlign: "center" },
  divider: { height: 35, width: 1, backgroundColor: colors.border },
});
