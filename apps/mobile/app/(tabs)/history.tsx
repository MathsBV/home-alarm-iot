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

  const load = useCallback(async (quiet = false) => {
    if (!homeId) return;
    if (!quiet) setLoading(true);
    try {
      const token = await getToken();
      const query = filter ? `?type=${filter}` : "";
      setEvents(await api.events(homeId, token, query));
    } catch (error) {
      if (!quiet) Alert.alert("Histórico indisponível", error instanceof Error ? error.message : "Tente novamente.");
    } finally {
      setLoading(false);
    }
  }, [filter, getToken, homeId]);

  useEffect(() => {
    const initial = setTimeout(() => void load(), 0);
    const timer = setInterval(() => void load(true), 30_000);
    return () => { clearTimeout(initial); clearInterval(timer); };
  }, [load]);

  return (
    <Screen title="Histórico" subtitle="Registro de eventos e violações.">
      <View style={styles.filters}>
        {filters.map((item) => (
          <Pressable
            key={item.label}
            onPress={() => setFilter(item.value)}
            style={[styles.chip, filter === item.value && styles.chipActive]}
          >
            <Text style={[styles.chipText, filter === item.value && styles.chipTextActive]}>
              {item.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />
      ) : !events.length ? (
        <View style={styles.empty}>
          <Ionicons name="file-tray-outline" size={32} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>Nenhum evento</Text>
          <Text style={styles.emptyText}>Os eventos da central aparecerão aqui.</Text>
        </View>
      ) : (
        <View style={styles.list}>
          {events.map((event, index) => (
            <EventRow
              key={event.eventId}
              event={event}
              isLast={index === events.length - 1}
            />
          ))}
        </View>
      )}
    </Screen>
  );
}

function EventRow({ event, isLast }: { event: AlarmEvent; isLast: boolean }) {
  const isCritical = event.severity === "critical";
  const isWarning = event.severity === "warning";
  const accentColor = isCritical ? colors.danger : isWarning ? colors.warning : colors.primary;

  return (
    <View style={[styles.eventRow, !isLast && styles.eventRowSep]}>
      <View style={[styles.eventDot, { backgroundColor: `${accentColor}20` }]}>
        <Ionicons
          name={isCritical ? "warning" : isWarning ? "alert-circle" : "information-circle"}
          size={16}
          color={accentColor}
        />
      </View>
      <View style={styles.eventBody}>
        <View style={styles.eventTop}>
          <Text style={styles.eventTitle} numberOfLines={1}>{event.title}</Text>
          <Text style={styles.eventTime}>
            {new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(event.occurredAt))}
          </Text>
        </View>
        {event.description ? <Text style={styles.eventDesc} numberOfLines={2}>{event.description}</Text> : null}
        <View style={styles.eventMeta}>
          <Text style={styles.eventDate}>
            {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(event.occurredAt))}
          </Text>
          {event.zoneId ? (
            <View style={styles.zoneBadge}>
              <Text style={styles.zoneBadgeText}>Zona {event.zoneId}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 20, paddingVertical: 7, paddingHorizontal: 14 },
  chipActive: { backgroundColor: colors.surfaceElevated, borderColor: colors.primary },
  chipText: { color: colors.textMuted, fontSize: 12, fontWeight: "700" },
  chipTextActive: { color: colors.primary },

  empty: { alignItems: "center", paddingVertical: 50, gap: 8 },
  emptyTitle: { color: colors.text, fontWeight: "800", fontSize: 16 },
  emptyText: { color: colors.textMuted, fontSize: 13, textAlign: "center" },

  list: { backgroundColor: colors.surface, borderRadius: radius.medium, overflow: "hidden" },
  eventRow: { flexDirection: "row", gap: 12, padding: 14, alignItems: "flex-start" },
  eventRowSep: { borderBottomWidth: 1, borderBottomColor: colors.border },
  eventDot: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center", marginTop: 1 },
  eventBody: { flex: 1, gap: 4 },
  eventTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8 },
  eventTitle: { color: colors.text, fontWeight: "700", fontSize: 14, flex: 1 },
  eventTime: { color: colors.textMuted, fontSize: 11 },
  eventDesc: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
  eventMeta: { flexDirection: "row", gap: 8, alignItems: "center", marginTop: 2 },
  eventDate: { color: colors.info, fontSize: 11 },
  zoneBadge: { backgroundColor: colors.surfaceElevated, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  zoneBadgeText: { color: colors.primary, fontSize: 10, fontWeight: "700" },
});
