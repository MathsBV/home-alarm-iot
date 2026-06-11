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

  constructor(
    private readonly repository: Repository,
    private readonly alerts: AlertService,
  ) {}

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
      const home = await this.repository.findHomeByDeviceId(message.data.deviceId);
      if (!home) {
        console.warn(`Dispositivo sem residência vinculada: ${message.data.deviceId}`);
        return;
      }

      if (message.kind === "state") {
        await this.repository.saveState(home.id, message.data);
      } else if (message.kind === "availability") {
        await this.repository.saveAvailability(home.id, message.data);
      } else if (message.kind === "commandAck") {
        await this.repository.acknowledgeCommand(message.data);
      } else {
        await this.handleEvent(home.id, message.data);
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
