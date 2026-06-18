import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import {
  SCHEMA_VERSION,
  alarmCommandSchema,
  commandTypes,
  type AlarmEvent,
} from "@home-alarm/contracts";
import { config } from "./config.js";
import type { AlertService } from "./alerts.js";
import { notificationAck } from "./alerts.js";
import type { MqttService } from "./mqtt-service.js";
import type { Repository } from "./repository.js";

const commandBodySchema = z.object({
  type: z.enum(commandTypes),
  value: z.union([z.boolean(), z.number(), z.string()]).optional(),
  pin: z.string().regex(/^\d{4,8}$/),
});

const contactSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(2).max(80),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().min(8).max(20).optional().or(z.literal("")),
  channels: z.object({
    push: z.boolean(),
    email: z.boolean(),
    sms: z.boolean(),
    whatsapp: z.boolean(),
  }),
});

async function requireMembership(
  repository: Repository,
  homeId: string,
  userId: string,
) {
  if (!(await repository.isMember(homeId, userId))) {
    const error = new Error("Usuário não pertence a esta residência.");
    Object.assign(error, { statusCode: 403 });
    throw error;
  }
}

export function apiRoutes(
  repository: Repository,
  mqttService: MqttService,
  alerts: AlertService,
) {
  const router = Router();

  router.post("/homes", async (request, response) => {
    const body = z
      .object({
        name: z.string().min(2).max(80),
        deviceId: z.string().min(3).max(80),
        pin: z.string().regex(/^\d{4,8}$/),
      })
      .parse(request.body);
    const id = crypto.randomUUID();
    const pinHash = await bcrypt.hash(`${body.pin}:${config.PIN_PEPPER}`, 10);
    const home = await repository.createHome({
      id,
      name: body.name,
      deviceId: body.deviceId,
      ownerId: request.user!.uid,
      pinHash,
    });
    response.status(201).json({ id: home.id, name: home.name, deviceId: home.deviceId });
  });

  router.get("/homes/:homeId/dashboard", async (request, response) => {
    await requireMembership(repository, request.params.homeId!, request.user!.uid);
    const dashboard = await repository.dashboard(request.params.homeId!);
    response.json(dashboard);
  });

  router.post("/homes/:homeId/commands", async (request, response) => {
    const homeId = request.params.homeId!;
    await requireMembership(repository, homeId, request.user!.uid);
    const body = commandBodySchema.parse(request.body);
    if (!(await repository.verifyPin(homeId, body.pin))) {
      return response.status(403).json({ error: "PIN inválido." });
    }
    if (body.type === "SET_DELAY" && (typeof body.value !== "number" || body.value < 0 || body.value > 120)) {
      return response.status(400).json({ error: "O atraso deve estar entre 0 e 120 segundos." });
    }
    const home = await repository.getHome(homeId);
    if (!home) return response.status(404).json({ error: "Residência não encontrada." });

    const occurredAt = new Date();
    const command = alarmCommandSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      messageId: crypto.randomUUID(),
      deviceId: home.deviceId,
      occurredAt: occurredAt.toISOString(),
      sequence: occurredAt.getTime(),
      requestId: crypto.randomUUID(),
      type: body.type,
      value: body.value,
      expiresAt: new Date(occurredAt.getTime() + 30_000).toISOString(),
      requestedBy: request.user!.uid,
    });
    await repository.saveCommand(homeId, command);
    const published = mqttService.publishCommand(command);
    if (!published && config.DEMO_MODE) {
      await repository.applyDemoCommand(homeId, command);
    }
    response.status(202).json({ command, published });
  });

  router.post("/homes/:homeId/demo/trigger", async (request, response) => {
    const homeId = request.params.homeId!;
    await requireMembership(repository, homeId, request.user!.uid);
    if (!config.DEMO_MODE) {
      return response.status(404).json({ error: "Rota disponível apenas no modo demonstração." });
    }
    const event = await repository.triggerDemoAlarm(homeId);
    if (!event) {
      return response.status(404).json({ error: "Residência não encontrada." });
    }
    // Dispara as notificações (push/email/sms) pelo mesmo caminho de um
    // evento real vindo do hardware, para que seja possível validar os
    // canais sem o dispositivo físico.
    const channels = await alerts.notify(homeId, event);
    mqttService.publishNotificationAck(notificationAck(event, channels));
    response.status(201).json({ event, channels });
  });

  router.get("/homes/:homeId/events", async (request, response) => {
    const homeId = request.params.homeId!;
    await requireMembership(repository, homeId, request.user!.uid);
    const zoneId = request.query.zoneId ? Number(request.query.zoneId) : undefined;
    const events = await repository.listEvents(homeId, {
      type: typeof request.query.type === "string" ? request.query.type : undefined,
      zoneId,
    });
    response.json(events);
  });

  router.get("/homes/:homeId/events/export", async (request, response) => {
    const homeId = request.params.homeId!;
    await requireMembership(repository, homeId, request.user!.uid);
    const events = await repository.listEvents(homeId);
    if (request.query.format === "json") return response.json(events);
    response.type("text/csv").send(eventsToCsv(events));
  });

  router.get("/homes/:homeId/contacts", async (request, response) => {
    const homeId = request.params.homeId!;
    await requireMembership(repository, homeId, request.user!.uid);
    response.json(await repository.listContacts(homeId));
  });

  router.post("/homes/:homeId/contacts", async (request, response) => {
    const homeId = request.params.homeId!;
    await requireMembership(repository, homeId, request.user!.uid);
    const body = contactSchema.parse(request.body);
    const contact = await repository.saveContact({
      id: body.id ?? crypto.randomUUID(),
      homeId,
      name: body.name,
      email: body.email || undefined,
      phone: body.phone || undefined,
      channels: body.channels,
    });
    response.status(201).json(contact);
  });

  router.delete("/homes/:homeId/contacts/:contactId", async (request, response) => {
    const homeId = request.params.homeId!;
    await requireMembership(repository, homeId, request.user!.uid);
    await repository.deleteContact(homeId, request.params.contactId!);
    response.status(204).send();
  });

  router.post("/homes/:homeId/push-tokens", async (request, response) => {
    const homeId = request.params.homeId!;
    await requireMembership(repository, homeId, request.user!.uid);
    const { token } = z.object({ token: z.string().min(1) }).parse(request.body);
    await repository.savePushToken({ token, homeId, userId: request.user!.uid });
    response.status(204).send();
  });

  return router;
}

export function eventsToCsv(events: AlarmEvent[]) {
  const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const header = ["eventId", "occurredAt", "deviceId", "type", "zoneId", "severity", "title", "description"];
  return [
    header.join(","),
    ...events.map((event) =>
      [
        event.eventId,
        event.occurredAt,
        event.deviceId,
        event.type,
        event.zoneId,
        event.severity,
        event.title,
        event.description,
      ]
        .map(escape)
        .join(","),
    ),
  ].join("\n");
}
