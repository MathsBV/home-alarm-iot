import mqtt, { type MqttClient } from "mqtt";
import {
  TOPIC_PREFIX,
  parseTopicMessage,
  topics,
  type AlarmCommand,
  type AlarmEvent,
  type NotificationAck,
} from "@home-alarm/contracts";
import { config } from "./config.js";
import type { AlertService } from "./alerts.js";
import type { Repository } from "./repository.js";

export class MqttService {
  private client: MqttClient | null = null;

  // Cache deviceId -> homeId para evitar uma query no Firestore a cada
  // mensagem MQTT (o dispositivo publica estado a cada 2s).
  private homeCache = new Map<string, { homeId: string | null; expires: number }>();
  private static readonly HOME_TTL_MS = 5 * 60_000; // hits
  private static readonly MISS_TTL_MS = 30_000;     // não encontrado

  constructor(
    private readonly repository: Repository,
    private readonly alerts: AlertService,
  ) {}

  private async resolveHomeId(deviceId: string): Promise<string | null> {
    const now = Date.now();
    const cached = this.homeCache.get(deviceId);
    if (cached && cached.expires > now) return cached.homeId;

    const home = await this.repository.findHomeByDeviceId(deviceId);
    const homeId = home?.id ?? null;
    this.homeCache.set(deviceId, {
      homeId,
      expires: now + (homeId ? MqttService.HOME_TTL_MS : MqttService.MISS_TTL_MS),
    });
    return homeId;
  }

  connect() {
    if (!config.MQTT_URL) {
      console.warn("MQTT_URL ausente: gateway iniciado sem conexão MQTT.");
      return;
    }

    this.client = mqtt.connect(config.MQTT_URL, {
      username: config.MQTT_USERNAME,
      password: config.MQTT_PASSWORD,
      reconnectPeriod: 2_000,
      connectTimeout: 10_000,
      clean: false,
      clientId: `gateway-${crypto.randomUUID()}`,
    });

    this.client.on("connect", () => {
      console.log("Gateway conectado ao broker MQTT.");
      this.client?.subscribe(
        [
          `${TOPIC_PREFIX}/+/availability`,
          `${TOPIC_PREFIX}/+/state`,
          `${TOPIC_PREFIX}/+/events`,
          `${TOPIC_PREFIX}/+/command-acks`,
        ],
        { qos: 1 },
      );
    });
    this.client.on("message", (topic, payload) => {
      void this.handleMessage(topic, payload.toString());
    });
    this.client.on("error", (error) => {
      console.error("Erro MQTT:", error.message);
    });
  }

  publishCommand(command: AlarmCommand) {
    if (!this.client?.connected) {
      if (config.DEMO_MODE) return false;
      throw new Error("Broker MQTT indisponível.");
    }
    this.client.publish(
      topics(command.deviceId).commands,
      JSON.stringify(command),
      { qos: 1, retain: false },
    );
    return true;
  }

  publishNotificationAck(ack: NotificationAck) {
    this.client?.publish(
      topics(ack.deviceId).notificationAcks,
      JSON.stringify(ack),
      { qos: 1, retain: false },
    );
  }

  private async handleMessage(topic: string, payload: string) {
    try {
      const message = parseTopicMessage(topic, payload);
      const homeId = await this.resolveHomeId(message.data.deviceId);
      if (!homeId) {
        console.warn(`Dispositivo sem residência vinculada: ${message.data.deviceId}`);
        return;
      }

      if (message.kind === "state") {
        await this.repository.saveState(homeId, message.data);
      } else if (message.kind === "availability") {
        await this.repository.saveAvailability(homeId, message.data);
      } else if (message.kind === "commandAck") {
        await this.repository.acknowledgeCommand(message.data);
      } else {
        await this.handleEvent(homeId, message.data);
      }
    } catch (error) {
      console.error("Mensagem MQTT inválida:", error);
    }
  }

  private async handleEvent(homeId: string, event: AlarmEvent) {
    const inserted = await this.repository.saveEvent(homeId, event);
    if (!inserted || event.type !== "ALARM_TRIGGERED") return;
    const channels = await this.alerts.notify(homeId, event);
    this.publishNotificationAck({
      schemaVersion: 1,
      messageId: crypto.randomUUID(),
      deviceId: event.deviceId,
      occurredAt: new Date().toISOString(),
      sequence: event.sequence,
      eventId: event.eventId,
      channels,
    });
  }
}
