import { Expo } from "expo-server-sdk";
import { Resend } from "resend";
import twilio from "twilio";
import type { AlarmEvent, NotificationAck } from "@home-alarm/contracts";
import { SCHEMA_VERSION } from "@home-alarm/contracts";
import { config } from "./config.js";
import type { Repository } from "./repository.js";

type ChannelResult = "sent" | "failed" | "skipped";

export class AlertService {
  private expo = new Expo({ accessToken: config.EXPO_ACCESS_TOKEN });
  private resend = config.RESEND_API_KEY ? new Resend(config.RESEND_API_KEY) : null;
  private sms =
    config.TWILIO_ACCOUNT_SID && config.TWILIO_AUTH_TOKEN
      ? twilio(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN)
      : null;

  constructor(private readonly repository: Repository) {}

  async notify(homeId: string, event: AlarmEvent): Promise<NotificationAck["channels"]> {
    const [contacts, tokens] = await Promise.all([
      this.repository.listContacts(homeId),
      this.repository.listPushTokens(homeId),
    ]);

    // TESTE: quando há override configurado, ignoramos a lista de contatos e
    // enviamos para o destinatário travado. Caso contrário, usamos os contatos.
    const emailAddresses = config.ALERT_OVERRIDE_EMAIL
      ? [config.ALERT_OVERRIDE_EMAIL]
      : contacts.filter((item) => item.channels.email).flatMap((item) => item.email ?? []);
    const smsNumbers = config.ALERT_OVERRIDE_SMS
      ? [config.ALERT_OVERRIDE_SMS]
      : contacts.filter((item) => item.channels.sms).flatMap((item) => item.phone ?? []);

    const channels = {
      push: await this.sendPush(tokens.map((item) => item.token), event),
      email: await this.sendEmails(emailAddresses, event),
      sms: await this.sendSms(smsNumbers, event),
      whatsapp: await this.sendWhatsapp(
        contacts.filter((item) => item.channels.whatsapp).flatMap((item) => item.phone ?? []),
        event,
      ),
    };
    return channels;
  }

  private async sendPush(tokens: string[], event: AlarmEvent): Promise<ChannelResult> {
    const validTokens = tokens.filter(Expo.isExpoPushToken);
    if (!validTokens.length) return "skipped";
    try {
      const tickets = await this.expo.sendPushNotificationsAsync(
        validTokens.map((to) => ({
          to,
          sound: "default",
          title: event.title,
          body: event.description ?? "Abra o aplicativo para consultar os detalhes.",
          priority: "high",
          data: { eventId: event.eventId, deviceId: event.deviceId },
        })),
      );
      return tickets.some((ticket) => ticket.status === "error") ? "failed" : "sent";
    } catch {
      return "failed";
    }
  }

  private async sendEmails(addresses: string[], event: AlarmEvent): Promise<ChannelResult> {
    if (!addresses.length || !this.resend) return "skipped";
    try {
      await this.resend.emails.send({
        from: config.RESEND_FROM,
        to: addresses,
        subject: `[Alarme] ${event.title}`,
        text: `${event.title}\n\n${event.description ?? ""}\n\nData: ${event.occurredAt}`,
      });
      return "sent";
    } catch {
      return "failed";
    }
  }

  private async sendSms(numbers: string[], event: AlarmEvent): Promise<ChannelResult> {
    if (!numbers.length || !this.sms || !config.TWILIO_FROM) return "skipped";
    try {
      await Promise.all(
        numbers.map((to) =>
          this.sms!.messages.create({
            from: config.TWILIO_FROM,
            to,
            body: `ALARME: ${event.title}. ${event.description ?? ""}`.slice(0, 1500),
          }),
        ),
      );
      return "sent";
    } catch {
      return "failed";
    }
  }

  private async sendWhatsapp(numbers: string[], event: AlarmEvent): Promise<ChannelResult> {
    if (!numbers.length || !this.sms || !config.TWILIO_WHATSAPP_FROM) return "skipped";
    try {
      await Promise.all(
        numbers.map((to) =>
          this.sms!.messages.create({
            from: config.TWILIO_WHATSAPP_FROM,
            // O Twilio exige o prefixo "whatsapp:" também no destinatário.
            to: to.startsWith("whatsapp:") ? to : `whatsapp:${to}`,
            body: `ALARME: ${event.title}. ${event.description ?? ""}`.slice(0, 1500),
          }),
        ),
      );
      return "sent";
    } catch {
      return "failed";
    }
  }
}

export function notificationAck(
  event: AlarmEvent,
  channels: NotificationAck["channels"],
): NotificationAck {
  return {
    schemaVersion: SCHEMA_VERSION,
    messageId: crypto.randomUUID(),
    deviceId: event.deviceId,
    occurredAt: new Date().toISOString(),
    sequence: event.sequence,
    eventId: event.eventId,
    channels,
  };
}
