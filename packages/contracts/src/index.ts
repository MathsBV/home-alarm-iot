import { z } from "zod";

export const SCHEMA_VERSION = 1 as const;
export const TOPIC_PREFIX = "home-alarm/v1";

export const alarmModes = [
  "disarmed",
  "armed",
  "pending",
  "triggered",
  "silenced",
] as const;

export const commandTypes = [
  "ARM",
  "DISARM",
  "SET_DELAY",
  "SILENCE",
  "SET_COUNTERMEASURE",
] as const;

export const eventTypes = [
  "ZONE_VIOLATED",
  "ALARM_TRIGGERED",
  "ALARM_ARMED",
  "ALARM_DISARMED",
  "ALARM_SILENCED",
  "DEVICE_ONLINE",
  "DEVICE_OFFLINE",
  "COMMAND_ACCEPTED",
  "COMMAND_REJECTED",
] as const;

const baseMessageSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  messageId: z.string().min(1),
  deviceId: z.string().min(1),
  occurredAt: z.string().datetime(),
  sequence: z.number().int().nonnegative(),
});

export const zoneSchema = z.object({
  id: z.number().int().min(1).max(5),
  name: z.string().min(1).max(60),
  sensorType: z.string().min(1).max(60),
  violated: z.boolean(),
});

export const countermeasureSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().min(1).max(60),
  active: z.boolean(),
});

export const alarmStateSchema = baseMessageSchema.extend({
  mode: z.enum(alarmModes),
  online: z.boolean(),
  sirenActive: z.boolean(),
  delaySeconds: z.number().int().min(0).max(120),
  pendingSeconds: z.number().int().min(0).max(120).optional(),
  triggerCount: z.number().int().nonnegative(),
  zones: z.array(zoneSchema).length(5),
  countermeasures: z.array(countermeasureSchema).min(2).max(4),
});

export const alarmEventSchema = baseMessageSchema.extend({
  eventId: z.string().min(1),
  type: z.enum(eventTypes),
  zoneId: z.number().int().min(1).max(5).optional(),
  title: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  severity: z.enum(["info", "warning", "critical"]),
});

export const alarmCommandSchema = baseMessageSchema
  .extend({
    requestId: z.string().min(1),
    type: z.enum(commandTypes),
    value: z.union([z.boolean(), z.number(), z.string()]).optional(),
    expiresAt: z.string().datetime(),
    requestedBy: z.string().min(1),
  })
  .superRefine((command, context) => {
    if (
      command.type === "SET_DELAY" &&
      (typeof command.value !== "number" ||
        !Number.isInteger(command.value) ||
        command.value < 0 ||
        command.value > 120)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: "SET_DELAY requires an integer from 0 to 120.",
      });
    }
    if (
      command.type === "SET_COUNTERMEASURE" &&
      (typeof command.value !== "string" || command.value.length === 0)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: "SET_COUNTERMEASURE requires a countermeasure id.",
      });
    }
  });

export const commandAckSchema = baseMessageSchema.extend({
  requestId: z.string().min(1),
  accepted: z.boolean(),
  reason: z.string().max(300).optional(),
});

export const availabilitySchema = baseMessageSchema.extend({
  online: z.boolean(),
  reason: z.enum(["connected", "heartbeat", "last-will", "shutdown"]),
});

export const notificationAckSchema = baseMessageSchema.extend({
  eventId: z.string().min(1),
  channels: z.object({
    push: z.enum(["sent", "failed", "skipped"]),
    email: z.enum(["sent", "failed", "skipped"]),
    sms: z.enum(["sent", "failed", "skipped"]),
    whatsapp: z.enum(["sent", "failed", "skipped"]),
  }),
});

export type AlarmMode = (typeof alarmModes)[number];
export type CommandType = (typeof commandTypes)[number];
export type EventType = (typeof eventTypes)[number];
export type AlarmState = z.infer<typeof alarmStateSchema>;
export type AlarmEvent = z.infer<typeof alarmEventSchema>;
export type AlarmCommand = z.infer<typeof alarmCommandSchema>;
export type CommandAck = z.infer<typeof commandAckSchema>;
export type Availability = z.infer<typeof availabilitySchema>;
export type NotificationAck = z.infer<typeof notificationAckSchema>;
export type Zone = z.infer<typeof zoneSchema>;
export type Countermeasure = z.infer<typeof countermeasureSchema>;

export function topics(deviceId: string) {
  const root = `${TOPIC_PREFIX}/${deviceId}`;
  return {
    root,
    availability: `${root}/availability`,
    state: `${root}/state`,
    events: `${root}/events`,
    commands: `${root}/commands`,
    commandAcks: `${root}/command-acks`,
    notificationAcks: `${root}/notification-acks`,
  };
}

export function parseTopicMessage(topic: string, payload: string) {
  const leaf = topic.split("/").at(-1);
  const data: unknown = JSON.parse(payload);

  switch (leaf) {
    case "availability":
      return { kind: "availability" as const, data: availabilitySchema.parse(data) };
    case "state":
      return { kind: "state" as const, data: alarmStateSchema.parse(data) };
    case "events":
      return { kind: "event" as const, data: alarmEventSchema.parse(data) };
    case "command-acks":
      return { kind: "commandAck" as const, data: commandAckSchema.parse(data) };
    default:
      throw new Error(`Unsupported MQTT topic: ${topic}`);
  }
}
