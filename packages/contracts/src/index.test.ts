import { describe, expect, it } from "vitest";
import {
  SCHEMA_VERSION,
  alarmCommandSchema,
  alarmStateSchema,
  parseTopicMessage,
  topics,
} from "./index.js";

const base = {
  schemaVersion: SCHEMA_VERSION,
  messageId: "msg-1",
  deviceId: "alarm-1",
  occurredAt: "2026-06-10T12:00:00.000Z",
  sequence: 1,
};

describe("MQTT contracts", () => {
  it("builds stable device topics", () => {
    expect(topics("alarm-1").events).toBe("home-alarm/v1/alarm-1/events");
  });

  it("accepts a complete five-zone state", () => {
    const state = alarmStateSchema.parse({
      ...base,
      mode: "armed",
      online: true,
      sirenActive: false,
      delaySeconds: 30,
      triggerCount: 0,
      zones: Array.from({ length: 5 }, (_, index) => ({
        id: index + 1,
        name: `Zona ${index + 1}`,
        sensorType: "PIR",
        violated: false,
      })),
      countermeasures: [
        { id: "strobe", name: "Luz estroboscópica", active: false },
        { id: "fog", name: "Gerador de névoa", active: false },
      ],
    });

    expect(state.zones).toHaveLength(5);
  });

  it("rejects delay values outside 0-120 seconds", () => {
    expect(() =>
      alarmCommandSchema.parse({
        ...base,
        requestId: "req-1",
        type: "SET_DELAY",
        value: 121,
        expiresAt: "2026-06-10T12:01:00.000Z",
        requestedBy: "user-1",
      }),
    ).toThrow();
  });

  it("parses an event based on the topic", () => {
    const message = parseTopicMessage(
      topics("alarm-1").events,
      JSON.stringify({
        ...base,
        eventId: "evt-1",
        type: "ALARM_TRIGGERED",
        title: "Alarme disparado",
        severity: "critical",
      }),
    );

    expect(message.kind).toBe("event");
  });
});
