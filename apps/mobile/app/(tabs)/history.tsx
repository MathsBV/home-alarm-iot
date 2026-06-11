import type { AlarmEvent, EventType } from "@home-alarm/contracts";
import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { Screen } from "@/components/Screen";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { colors, radius } from "@/theme";

const filters: { label: string; value?: EventType }[] = [
  { label: "Todos" },
  { label: "Disparos", value: "ALARM_TRIGGERED" },
  { label: "Violações", value: "ZONE_VIOLATED" },
  { label: "Comandos", value: "COMMAND_ACCEPTED" },
];

export default function HistoryScreen() {
  const { homeId, getToken } = useAuth();
  const [events, setEvents] = useState<AlarmEvent[]>([]);
  const [filter, setFilter] = useState<EventType | undefined>();
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!homeId) return;
    setLoading(true);
    try {
      const token = await getToken();
      const query = filter ? `?type=${filter}` : "";
      setEvents(await api.events(homeId, token, query));
    } catch (error) {
      Alert.alert("Histórico indisponível", error instanceof Error ? error.message : "Tente novamente.");
    } finally {
      setLoading(false);
    }
  }, [filter, getToken, homeId]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  return (
    <Screen title="Histórico" subtitle="Registro persistente de eventos e violações.">
      <View style={styles.filters}>
        {filters.map((item) => (
          <Pressable key={item.label} onPress={() => setFilter(item.value)} style={[styles.chip, filter === item.value && styles.chipActive]}>
            <Text style={[styles.chipText, filter === item.value && styles.chipTextActive]}>{item.label}</Text>
          </Pressable>
        ))}
      </View>
      {loading ? <ActivityIndicator color={colors.primary} /> : null}
      {!loading && !events.length ? (
        <View style={styles.empty}><Ionicons name="file-tray-outline" size={34} color={colors.textMuted} /><Text style={styles.emptyTitle}>Nenhum evento encontrado</Text><Text style={styles.muted}>Os eventos da central aparecerão aqui.</Text></View>
      ) : null}
      {events.map((event) => <EventCard key={event.eventId} event={event} />)}
    </Screen>
  );
}

function EventCard({ event }: { event: AlarmEvent }) {
  const color = event.severity === "critical" ? colors.danger : event.severity === "warning" ? colors.warning : colors.info;
  return (
    <View style={styles.event}>
      <View style={[styles.eventIcon, { backgroundColor: `${color}20` }]}><Ionicons name={event.severity === "critical" ? "warning" : "information-circle"} size={22} color={color} /></View>
      <View style={styles.eventCopy}>
        <Text style={styles.eventTitle}>{event.title}</Text>
        {event.description ? <Text style={styles.muted}>{event.description}</Text> : null}
        <Text style={styles.date}>{new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium" }).format(new Date(event.occurredAt))}{event.zoneId ? ` · Zona ${event.zoneId}` : ""}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 13 },
  chipActive: { backgroundColor: colors.primaryDark, borderColor: colors.primary },
  chipText: { color: colors.textMuted, fontSize: 12, fontWeight: "700" },
  chipTextActive: { color: colors.white },
  empty: { alignItems: "center", paddingVertical: 50, gap: 8 },
  emptyTitle: { color: colors.text, fontWeight: "800", fontSize: 17 },
  muted: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  event: { flexDirection: "row", gap: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.medium, padding: 14 },
  eventIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  eventCopy: { flex: 1, gap: 4 },
  eventTitle: { color: colors.text, fontWeight: "800" },
  date: { color: colors.textMuted, fontSize: 11, marginTop: 4 },
});
