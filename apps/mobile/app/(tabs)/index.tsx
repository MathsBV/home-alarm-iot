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
import { colors, radius } from "@/theme";

type PendingCommand = {
  type: CommandType;
  value?: boolean | number | string;
  label: string;
};

const modeConfig: Record<AlarmMode, { label: string; color: string; icon: keyof typeof Ionicons.glyphMap }> = {
  disarmed: { label: "Desarmado", color: colors.info, icon: "shield-outline" },
  armed:    { label: "Armado",    color: colors.success, icon: "shield-checkmark" },
  pending:  { label: "Temporizando", color: colors.warning, icon: "timer-outline" },
  triggered:{ label: "Disparado", color: colors.danger, icon: "warning" },
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
    return () => { clearTimeout(initial); clearInterval(timer); };
  }, [load]);

  if (loading || !data) {
    return (
      <View style={styles.loadingView}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Conectando à central...</Text>
      </View>
    );
  }

  const mode = modeConfig[data.state.mode];
  const command = (next: PendingCommand) => setPending(next);

  const primaryAction = data.state.mode === "disarmed"
    ? { type: "ARM" as CommandType, label: "Armar Sistema", displayLabel: "ARMAR SISTEMA", icon: "lock-closed" as const, bg: colors.success }
    : { type: "DISARM" as CommandType, label: "Desarmar alarme", displayLabel: "DESARMAR", icon: "lock-open" as const, bg: colors.danger };

  const alertedZones = data.state.zones.filter((z) => z.violated).length;

  return (
    <Screen
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void load()} tintColor={colors.primary} />
      }
    >
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.homeName}>{data.home.name}</Text>
          <Text style={styles.deviceId}>Central {data.home.deviceId}</Text>
        </View>
        <View style={[styles.onlinePill, { borderColor: `${data.state.online ? colors.success : colors.danger}55` }]}>
          <View style={[styles.onlineDot, { backgroundColor: data.state.online ? colors.success : colors.danger }]} />
          <Text style={[styles.onlineLabel, { color: data.state.online ? colors.success : colors.danger }]}>
            {data.state.online ? "Online" : "Offline"}
          </Text>
        </View>
      </View>

      {/* State Hero */}
      <View style={[styles.hero, { backgroundColor: `${mode.color}12` }]}>
        <View style={[styles.heroIconWrap, { backgroundColor: `${mode.color}20` }]}>
          <Ionicons name={mode.icon} size={30} color={mode.color} />
        </View>
        <View style={styles.heroInfo}>
          <Text style={styles.heroEyebrow}>ESTADO DO SISTEMA</Text>
          <Text style={[styles.heroState, { color: mode.color }]}>{mode.label}</Text>
          <Text style={styles.heroTime}>Atualizado {formatTime(data.state.occurredAt)}</Text>
        </View>
      </View>

      {/* Pending countdown */}
      {data.state.mode === "pending" ? (
        <View style={styles.pendingBanner}>
          <Ionicons name="timer" color={colors.warning} size={17} />
          <Text style={styles.pendingText}>
            DISPARO EM {data.state.pendingSeconds ?? data.state.delaySeconds} SEGUNDOS
          </Text>
        </View>
      ) : null}

      {/* Primary action */}
      <Pressable
        onPress={() => command({ type: primaryAction.type, label: primaryAction.label })}
        style={({ pressed }) => [styles.primaryAction, { backgroundColor: primaryAction.bg }, pressed && styles.pressed]}
      >
        <Ionicons name={primaryAction.icon} size={21} color={colors.white} />
        <Text style={styles.primaryActionLabel}>{primaryAction.displayLabel}</Text>
      </Pressable>

      {/* Secondary actions */}
      <View style={styles.secondaryRow}>
        <Pressable
          onPress={() => command({ type: "SILENCE", label: "Silenciar sirene" })}
          disabled={!data.state.sirenActive}
          style={({ pressed }) => [
            styles.secondaryAction,
            pressed && styles.pressed,
            !data.state.sirenActive && styles.dimmed,
          ]}
        >
          <Ionicons
            name="volume-mute-outline"
            size={19}
            color={data.state.sirenActive ? colors.warning : colors.textMuted}
          />
          <Text style={[styles.secondaryLabel, data.state.sirenActive && { color: colors.warning }]}>
            Silenciar
          </Text>
        </Pressable>
        <VoiceCommandButton onCommand={command} />
      </View>

      {/* Zones */}
      <SectionLabel text="ZONAS MONITORADAS" right={`${alertedZones} em alerta`} />
      <View style={styles.zoneList}>
        {data.state.zones.map((zone, index) => (
          <View
            key={zone.id}
            style={[
              styles.zoneRow,
              zone.violated && styles.zoneRowAlert,
              index < data.state.zones.length - 1 && styles.zoneRowSep,
            ]}
          >
            {zone.violated && <View style={styles.zoneAlertStripe} />}
            <View style={[styles.zoneDot, { backgroundColor: zone.violated ? colors.danger : colors.success }]} />
            <View style={styles.zoneText}>
              <Text style={styles.zoneName}>{zone.name}</Text>
              <Text style={styles.zoneSensor}>{zone.sensorType}</Text>
            </View>
            <Text style={[styles.zoneTag, zone.violated && { color: colors.danger }]}>Z{zone.id}</Text>
          </View>
        ))}
      </View>

      {/* Delay */}
      <SectionLabel text="TEMPORIZAÇÃO" right="0 – 120 s" />
      <View style={styles.rowCard}>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle}>Atraso antes do disparo</Text>
          <Text style={styles.rowSub}>Configurado na central FPGA</Text>
        </View>
        <TextInput
          value={delay}
          onChangeText={setDelay}
          keyboardType="number-pad"
          maxLength={3}
          style={styles.delayInput}
        />
        <Pressable
          style={styles.saveBtn}
          onPress={() => {
            const value = Number(delay);
            if (!Number.isInteger(value) || value < 0 || value > 120) {
              Alert.alert("Valor inválido", "Use um número inteiro entre 0 e 120.");
              return;
            }
            command({ type: "SET_DELAY", value, label: `Alterar atraso para ${value}s` });
          }}
        >
          <Ionicons name="checkmark" color={colors.white} size={18} />
        </Pressable>
      </View>

      {/* Countermeasures */}
      <SectionLabel text="CONTRAMEDIDAS" right="Controle manual" />
      {data.state.countermeasures.map((item) => (
        <Pressable
          key={item.id}
          onPress={() => command({ type: "SET_COUNTERMEASURE", value: item.id, label: `${item.active ? "Desligar" : "Ligar"} ${item.name}` })}
          style={({ pressed }) => [styles.rowCard, pressed && styles.pressed]}
        >
          <View style={[styles.counterIcon, item.active && styles.counterIconOn]}>
            <Ionicons
              name={item.id === "strobe" ? "flash" : "cloud"}
              size={19}
              color={item.active ? colors.warning : colors.textMuted}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>{item.name}</Text>
            <Text style={styles.rowSub}>{item.active ? "Ativa" : "Desativada"}</Text>
          </View>
          <View style={[styles.toggle, item.active && styles.toggleOn]}>
            <View style={[styles.toggleKnob, item.active && styles.toggleKnobOn]} />
          </View>
        </Pressable>
      ))}

      {/* Stats */}
      <View style={styles.stats}>
        <StatItem value={String(data.state.triggerCount)} label="disparos" />
        <View style={styles.statSep} />
        <StatItem value={String(data.recentEvents.length)} label="eventos" />
        <View style={styles.statSep} />
        <StatItem
          value={data.state.sirenActive ? "ON" : "OFF"}
          label="sirene"
          color={data.state.sirenActive ? colors.danger : undefined}
        />
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

function SectionLabel({ text, right }: { text: string; right?: string }) {
  return (
    <View style={styles.sectionLabel}>
      <Text style={styles.sectionLabelText}>{text}</Text>
      {right ? <Text style={styles.sectionLabelRight}>{right}</Text> : null}
    </View>
  );
}

function StatItem({ value, label, color }: { value: string; label: string; color?: string }) {
  return (
    <View style={styles.statItem}>
      <Text style={[styles.statValue, color ? { color } : null]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

const styles = StyleSheet.create({
  loadingView: { flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center", gap: 14 },
  loadingText: { color: colors.textMuted, fontSize: 13 },

  // Header
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  homeName: { color: colors.text, fontSize: 20, fontWeight: "900", letterSpacing: -0.3 },
  deviceId: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  onlinePill: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: 20, paddingHorizontal: 11, paddingVertical: 6 },
  onlineDot: { width: 6, height: 6, borderRadius: 3 },
  onlineLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.3 },

  // Hero
  hero: { borderRadius: radius.large, padding: 20, flexDirection: "row", alignItems: "center", gap: 16 },
  heroIconWrap: { width: 62, height: 62, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  heroInfo: { flex: 1, gap: 4 },
  heroEyebrow: { color: colors.textMuted, fontSize: 10, fontWeight: "700", letterSpacing: 1.4 },
  heroState: { fontSize: 34, fontWeight: "900", lineHeight: 38, letterSpacing: -0.5 },
  heroTime: { color: colors.textMuted, fontSize: 11 },

  // Pending
  pendingBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    padding: 12,
    borderRadius: radius.medium,
    backgroundColor: colors.warningSurface,
    borderLeftWidth: 3,
    borderLeftColor: colors.warning,
  },
  pendingText: { color: colors.warning, fontWeight: "800", fontSize: 13, letterSpacing: 0.5 },

  // Primary action
  primaryAction: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 11,
    height: 62,
    borderRadius: radius.medium,
  },
  primaryActionLabel: { color: colors.white, fontWeight: "800", fontSize: 16, letterSpacing: 0.8 },
  pressed: { opacity: 0.72 },

  // Secondary actions
  secondaryRow: { flexDirection: "row", gap: 10 },
  secondaryAction: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 50,
    borderRadius: radius.medium,
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryLabel: { color: colors.textMuted, fontWeight: "700", fontSize: 13, letterSpacing: 0.3 },
  dimmed: { opacity: 0.35 },

  // Section labels
  sectionLabel: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 6 },
  sectionLabelText: { color: colors.textMuted, fontSize: 11, fontWeight: "700", letterSpacing: 0.9 },
  sectionLabelRight: { color: colors.info, fontSize: 11, fontWeight: "600" },

  // Zone list
  zoneList: { backgroundColor: colors.surface, borderRadius: radius.medium, overflow: "hidden" },
  zoneRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 13, paddingHorizontal: 14 },
  zoneRowSep: { borderBottomWidth: 1, borderBottomColor: colors.border },
  zoneRowAlert: { backgroundColor: `${colors.danger}0D` },
  zoneAlertStripe: { position: "absolute", left: 0, top: 0, bottom: 0, width: 3, backgroundColor: colors.danger },
  zoneDot: { width: 8, height: 8, borderRadius: 4 },
  zoneText: { flex: 1, gap: 2 },
  zoneName: { color: colors.text, fontWeight: "700", fontSize: 14 },
  zoneSensor: { color: colors.textMuted, fontSize: 11 },
  zoneTag: { color: colors.primary, fontSize: 11, fontWeight: "800" },

  // Row card (delay + countermeasures)
  rowCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: radius.medium,
    padding: 14,
  },
  rowTitle: { color: colors.text, fontWeight: "700", fontSize: 14 },
  rowSub: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  delayInput: {
    width: 54,
    height: 42,
    borderRadius: radius.small,
    color: colors.text,
    backgroundColor: colors.surfaceElevated,
    textAlign: "center",
    fontSize: 18,
    fontWeight: "800",
  },
  saveBtn: {
    width: 42,
    height: 42,
    borderRadius: radius.small,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primaryDark,
  },
  counterIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceElevated,
  },
  counterIconOn: { backgroundColor: colors.warningSurface },
  toggle: { width: 42, height: 24, borderRadius: 12, backgroundColor: colors.border, padding: 3 },
  toggleOn: { backgroundColor: colors.primaryDark },
  toggleKnob: { width: 18, height: 18, borderRadius: 9, backgroundColor: colors.white },
  toggleKnobOn: { alignSelf: "flex-end" },

  // Stats
  stats: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.medium,
    paddingVertical: 18,
  },
  statItem: { alignItems: "center", gap: 3 },
  statValue: { color: colors.text, fontSize: 22, fontWeight: "900" },
  statLabel: { color: colors.textMuted, fontSize: 11 },
  statSep: { width: 1, height: 32, backgroundColor: colors.border },
});
