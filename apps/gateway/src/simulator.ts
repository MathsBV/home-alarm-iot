import crypto from "node:crypto";
import "dotenv/config";
import mqtt from "mqtt";
import {
  SCHEMA_VERSION,
  alarmCommandSchema,
  topics,
  type AlarmState,
} from "@home-alarm/contracts";
import { config } from "./config.js";

if (!config.MQTT_URL) {
  throw new Error("Configure MQTT_URL, MQTT_USERNAME e MQTT_PASSWORD para usar o simulador.");
}

const deviceTopics = topics(config.DEVICE_ID);
let sequence = 0;
let state: AlarmState = {
  schemaVersion: SCHEMA_VERSION,
  messageId: crypto.randomUUID(),
  deviceId: config.DEVICE_ID,
  occurredAt: new Date().toISOString(),
  sequence,
  mode: "disarmed",
  online: true,
  sirenActive: false,
  delaySeconds: 10,
  triggerCount: 0,
  zones: Array.from({ length: 5 }, (_, index) => ({
    id: index + 1,
    name: `Zona ${index + 1}`,
    sensorType: ["Reed switch", "PIR", "Ultrassom", "Infravermelho", "Laser"][index]!,
    violated: false,
  })),
  countermeasures: [
    { id: "strobe", name: "Luz estroboscópica", active: false },
    { id: "fog", name: "Gerador de névoa", active: false },
  ],
};

const client = mqtt.connect(config.MQTT_URL, {
  username: config.MQTT_USERNAME,
  password: config.MQTT_PASSWORD,
  clientId: `esp32-simulator-${config.DEVICE_ID}`,
  will: {
    topic: deviceTopics.availability,
    payload: JSON.stringify(base({ online: false, reason: "last-will" })),
    qos: 1,
    retain: true,
  },
});

function base<T extends object>(data: T) {
  return {
    schemaVersion: SCHEMA_VERSION,
    messageId: crypto.randomUUID(),
    deviceId: config.DEVICE_ID,
    occurredAt: new Date().toISOString(),
    sequence: ++sequence,
    ...data,
  };
}

function publishState() {
  state = { ...state, ...base({}) };
  client.publish(deviceTopics.state, JSON.stringify(state), { qos: 1, retain: true });
}

function publishEvent(data: Record<string, unknown>) {
  client.publish(
    deviceTopics.events,
    JSON.stringify(base({ eventId: crypto.randomUUID(), ...data })),
    { qos: 1 },
  );
}

client.on("connect", () => {
  console.log("Simulador ESP32 conectado. Comandos: v=violar zona, r=restaurar, q=sair.");
  client.subscribe(deviceTopics.commands, { qos: 1 });
  client.publish(
    deviceTopics.availability,
    JSON.stringify(base({ online: true, reason: "connected" })),
    { qos: 1, retain: true },
  );
  publishState();
});

client.on("message", (_topic, payload) => {
  try {
    const command = alarmCommandSchema.parse(JSON.parse(payload.toString()));
    if (command.type === "ARM") state.mode = "armed";
    if (command.type === "DISARM") {
      state.mode = "disarmed";
      state.sirenActive = false;
    }
    if (command.type === "SILENCE") {
      state.mode = "silenced";
      state.sirenActive = false;
    }
    if (command.type === "SET_DELAY" && typeof command.value === "number") {
      state.delaySeconds = command.value;
    }
    if (command.type === "SET_COUNTERMEASURE" && typeof command.value === "string") {
      state.countermeasures = state.countermeasures.map((item) =>
        item.id === command.value ? { ...item, active: !item.active } : item,
      );
    }
    client.publish(
      deviceTopics.commandAcks,
      JSON.stringify(base({ requestId: command.requestId, accepted: true })),
      { qos: 1 },
    );
    publishState();
  } catch (error) {
    console.error("Comando inválido:", error);
  }
});

process.stdin.setEncoding("utf8");
process.stdin.on("data", (input) => {
  const key = String(input).trim().toLowerCase();
  if (key === "v" && state.mode === "armed") {
    state.mode = "triggered";
    state.sirenActive = true;
    state.triggerCount += 1;
    state.zones[0] = { ...state.zones[0]!, violated: true };
    publishState();
    publishEvent({
      type: "ALARM_TRIGGERED",
      zoneId: 1,
      title: "Alarme disparado",
      description: "Violação detectada na porta de entrada.",
      severity: "critical",
    });
  } else if (key === "r") {
    state.zones = state.zones.map((zone) => ({ ...zone, violated: false }));
    publishState();
  } else if (key === "q") {
    client.end();
    process.exit(0);
  }
});

setInterval(() => {
  client.publish(
    deviceTopics.availability,
    JSON.stringify(base({ online: true, reason: "heartbeat" })),
    { qos: 1, retain: true },
  );
}, 15_000);
