import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import type { Firestore } from "firebase-admin/firestore";
import {
  SCHEMA_VERSION,
  type AlarmCommand,
  type AlarmEvent,
  type AlarmState,
  type Availability,
  type CommandAck,
} from "@home-alarm/contracts";
import { config } from "./config.js";
import type {
  CommandRecord,
  Contact,
  Dashboard,
  Home,
  PushToken,
} from "./types.js";

const now = () => new Date().toISOString();

function demoState(): AlarmState {
  return {
    schemaVersion: SCHEMA_VERSION,
    messageId: crypto.randomUUID(),
    deviceId: config.DEVICE_ID,
    occurredAt: now(),
    sequence: 1,
    mode: "disarmed",
    online: true,
    sirenActive: false,
    delaySeconds: 30,
    triggerCount: 0,
    zones: [
      { id: 1, name: "Porta Principal", sensorType: "Reed Switch", violated: false },
      { id: 2, name: "Janela", sensorType: "Reed Switch", violated: false },
      { id: 3, name: "Sala", sensorType: "PIR + Ultrassonico", violated: false },
      { id: 4, name: "Corredor", sensorType: "IR", violated: false },
      { id: 5, name: "Garagem", sensorType: "Ultrassonico", violated: false },
    ],
    countermeasures: [
      { id: "sirene", name: "Sirene", active: false },
      { id: "estrobo", name: "Estrobo", active: false },
      { id: "cerca", name: "Cerca Eletrica", active: false },
    ],
  };
}

export class Repository {
  private homes = new Map<string, Home>();
  private states = new Map<string, AlarmState>();
  private events = new Map<string, AlarmEvent[]>();
  private contacts = new Map<string, Contact[]>();
  private commands = new Map<string, CommandRecord>();
  private pushTokens = new Map<string, PushToken>();

  constructor(private readonly firestore: Firestore | null) {}

  async seedDemo() {
    if (!config.DEMO_MODE || this.firestore) return;
    const pinHash = await bcrypt.hash(`1234:${config.PIN_PEPPER}`, 10);
    this.homes.set(config.HOME_ID, {
      id: config.HOME_ID,
      name: "Residência de demonstração",
      deviceId: config.DEVICE_ID,
      memberIds: ["demo-user"],
      pinHash,
    });
    this.states.set(config.HOME_ID, demoState());
    this.events.set(config.HOME_ID, []);
    this.contacts.set(config.HOME_ID, []);
  }

  async createHome(input: {
    id: string;
    name: string;
    deviceId: string;
    ownerId: string;
    pinHash: string;
  }) {
    const home: Home = {
      id: input.id,
      name: input.name,
      deviceId: input.deviceId,
      memberIds: [input.ownerId],
      pinHash: input.pinHash,
    };

    if (this.firestore) {
      await this.firestore.collection("homes").doc(home.id).set(home);
      await this.firestore
        .collection("memberships")
        .doc(`${home.id}_${input.ownerId}`)
        .set({ homeId: home.id, userId: input.ownerId, role: "owner" });
    } else {
      this.homes.set(home.id, home);
      this.states.set(home.id, { ...demoState(), deviceId: home.deviceId });
    }
    return home;
  }

  async getHome(homeId: string): Promise<Home | null> {
    if (this.firestore) {
      const snapshot = await this.firestore.collection("homes").doc(homeId).get();
      return snapshot.exists ? (snapshot.data() as Home) : null;
    }
    return this.homes.get(homeId) ?? null;
  }

  async findHomeByDeviceId(deviceId: string): Promise<Home | null> {
    if (this.firestore) {
      const snapshot = await this.firestore
        .collection("homes")
        .where("deviceId", "==", deviceId)
        .limit(1)
        .get();
      return snapshot.empty ? null : (snapshot.docs[0]!.data() as Home);
    }
    return [...this.homes.values()].find((home) => home.deviceId === deviceId) ?? null;
  }

  async isMember(homeId: string, userId: string) {
    if (config.DEMO_MODE && userId === "demo-user") return true;
    if (this.firestore) {
      const membership = await this.firestore
        .collection("memberships")
        .doc(`${homeId}_${userId}`)
        .get();
      return membership.exists;
    }
    return this.homes.get(homeId)?.memberIds.includes(userId) ?? false;
  }

  async verifyPin(homeId: string, pin: string) {
    const home = await this.getHome(homeId);
    return home ? bcrypt.compare(`${pin}:${config.PIN_PEPPER}`, home.pinHash) : false;
  }

  async dashboard(homeId: string): Promise<Dashboard | null> {
    const home = await this.getHome(homeId);
    if (!home) return null;
    let state: AlarmState | undefined;
    let events: AlarmEvent[] = [];

    if (this.firestore) {
      const [stateDoc, eventDocs] = await Promise.all([
        this.firestore.collection("alarmStates").doc(homeId).get(),
        // Sem orderBy no Firestore para não exigir índice composto;
        // ordenamos em memória (occurredAt é ISO 8601, ordena como string).
        this.firestore
          .collection("events")
          .where("homeId", "==", homeId)
          .get(),
      ]);
      state = stateDoc.exists ? (stateDoc.data() as AlarmState) : undefined;
      events = eventDocs.docs
        .map((doc) => doc.data() as AlarmEvent)
        .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1))
        .slice(0, 10);
    } else {
      state = this.states.get(homeId);
      events = (this.events.get(homeId) ?? []).slice(0, 10);
    }

    // Garante um estado completo mesmo se o documento estiver parcial
    // (ex.: só chegou availability, sem um state completo do dispositivo).
    const base: AlarmState = { ...demoState(), deviceId: home.deviceId, online: false };
    return {
      home: { id: home.id, name: home.name, deviceId: home.deviceId },
      state: state ? { ...base, ...state } : base,
      recentEvents: events,
    };
  }

  async saveState(homeId: string, state: AlarmState) {
    if (this.firestore) {
      await this.firestore.collection("alarmStates").doc(homeId).set(state);
    } else {
      this.states.set(homeId, state);
    }
  }

  async saveAvailability(homeId: string, availability: Availability) {
    // Atualização parcial: não lê o estado inteiro só para marcar online/offline.
    if (this.firestore) {
      await this.firestore.collection("alarmStates").doc(homeId).set(
        {
          online: availability.online,
          occurredAt: availability.occurredAt,
          messageId: availability.messageId,
          sequence: availability.sequence,
        },
        { merge: true },
      );
      return;
    }
    const state = this.states.get(homeId);
    if (!state) return;
    this.states.set(homeId, {
      ...state,
      online: availability.online,
      occurredAt: availability.occurredAt,
      messageId: availability.messageId,
      sequence: availability.sequence,
    });
  }

  async saveEvent(homeId: string, event: AlarmEvent) {
    if (this.firestore) {
      const ref = this.firestore.collection("events").doc(event.eventId);
      const existing = await ref.get();
      if (existing.exists) return false;
      await ref.set({ ...event, homeId });
      return true;
    }
    const events = this.events.get(homeId) ?? [];
    if (events.some((item) => item.eventId === event.eventId)) return false;
    this.events.set(homeId, [event, ...events]);
    return true;
  }

  async listEvents(homeId: string, filters?: { type?: string; zoneId?: number }) {
    let events: AlarmEvent[];
    if (this.firestore) {
      const snapshot = await this.firestore
        .collection("events")
        .where("homeId", "==", homeId)
        .get();
      events = snapshot.docs
        .map((doc) => doc.data() as AlarmEvent)
        .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));
    } else {
      events = this.events.get(homeId) ?? [];
    }
    return events.filter(
      (event) =>
        (!filters?.type || event.type === filters.type) &&
        (!filters?.zoneId || event.zoneId === filters.zoneId),
    );
  }

  async saveCommand(homeId: string, command: AlarmCommand) {
    const record: CommandRecord = { ...command, homeId, status: "pending" };
    if (this.firestore) {
      await this.firestore.collection("commands").doc(command.requestId).set(record);
    } else {
      this.commands.set(command.requestId, record);
    }
  }

  async applyDemoCommand(homeId: string, command: AlarmCommand) {
    if (this.firestore || !config.DEMO_MODE) return;
    const state = this.states.get(homeId);
    if (!state) return;
    const next: AlarmState = {
      ...state,
      messageId: crypto.randomUUID(),
      occurredAt: now(),
      sequence: state.sequence + 1,
    };
    if (command.type === "ARM") next.mode = "armed";
    if (command.type === "DISARM") {
      next.mode = "disarmed";
      next.sirenActive = false;
      next.zones = next.zones.map((zone) => ({ ...zone, violated: false }));
    }
    if (command.type === "SILENCE") {
      next.mode = "silenced";
      next.sirenActive = false;
    }
    if (command.type === "SET_DELAY" && typeof command.value === "number") {
      next.delaySeconds = command.value;
    }
    if (command.type === "SET_COUNTERMEASURE" && typeof command.value === "string") {
      next.countermeasures = next.countermeasures.map((item) =>
        item.id === command.value ? { ...item, active: !item.active } : item,
      );
    }
    this.states.set(homeId, next);
  }

  async triggerDemoAlarm(homeId: string) {
    if (this.firestore || !config.DEMO_MODE) return null;
    const state = this.states.get(homeId);
    if (!state) return null;
    const event: AlarmEvent = {
      schemaVersion: SCHEMA_VERSION,
      messageId: crypto.randomUUID(),
      deviceId: state.deviceId,
      occurredAt: now(),
      sequence: state.sequence + 1,
      eventId: crypto.randomUUID(),
      type: "ALARM_TRIGGERED",
      zoneId: 1,
      title: "Alarme disparado",
      description: "Violação simulada na porta de entrada.",
      severity: "critical",
    };
    this.states.set(homeId, {
      ...state,
      messageId: crypto.randomUUID(),
      occurredAt: event.occurredAt,
      sequence: event.sequence,
      mode: "triggered",
      sirenActive: true,
      triggerCount: state.triggerCount + 1,
      zones: state.zones.map((zone) =>
        zone.id === 1 ? { ...zone, violated: true } : zone,
      ),
    });
    await this.saveEvent(homeId, event);
    return event;
  }

  async acknowledgeCommand(ack: CommandAck) {
    if (this.firestore) {
      await this.firestore.collection("commands").doc(ack.requestId).set(
        { status: ack.accepted ? "accepted" : "rejected", ack },
        { merge: true },
      );
    } else {
      const command = this.commands.get(ack.requestId);
      if (command) {
        command.status = ack.accepted ? "accepted" : "rejected";
        command.ack = ack;
      }
    }
  }

  async listContacts(homeId: string): Promise<Contact[]> {
    if (this.firestore) {
      const snapshot = await this.firestore
        .collection("contacts")
        .where("homeId", "==", homeId)
        .get();
      return snapshot.docs.map((doc) => doc.data() as Contact);
    }
    return this.contacts.get(homeId) ?? [];
  }

  async saveContact(contact: Contact) {
    if (this.firestore) {
      await this.firestore.collection("contacts").doc(contact.id).set(contact);
    } else {
      const contacts = this.contacts.get(contact.homeId) ?? [];
      const next = contacts.filter((item) => item.id !== contact.id);
      this.contacts.set(contact.homeId, [...next, contact]);
    }
    return contact;
  }

  async deleteContact(homeId: string, contactId: string) {
    if (this.firestore) {
      await this.firestore.collection("contacts").doc(contactId).delete();
    } else {
      this.contacts.set(
        homeId,
        (this.contacts.get(homeId) ?? []).filter((item) => item.id !== contactId),
      );
    }
  }

  async savePushToken(token: PushToken) {
    if (this.firestore) {
      await this.firestore.collection("pushTokens").doc(token.token).set(token);
    } else {
      this.pushTokens.set(token.token, token);
    }
  }

  async listPushTokens(homeId: string): Promise<PushToken[]> {
    if (this.firestore) {
      const snapshot = await this.firestore
        .collection("pushTokens")
        .where("homeId", "==", homeId)
        .get();
      return snapshot.docs.map((doc) => doc.data() as PushToken);
    }
    return [...this.pushTokens.values()].filter((token) => token.homeId === homeId);
  }
}
