import type {
  AlarmCommand,
  AlarmEvent,
  AlarmState,
  CommandAck,
} from "@home-alarm/contracts";

export type UserContext = {
  uid: string;
  email?: string;
};

export type Contact = {
  id: string;
  homeId: string;
  name: string;
  email?: string;
  phone?: string;
  channels: {
    push: boolean;
    email: boolean;
    sms: boolean;
  };
};

export type Home = {
  id: string;
  name: string;
  deviceId: string;
  memberIds: string[];
  pinHash: string;
};

export type PushToken = {
  token: string;
  userId: string;
  homeId: string;
};

export type CommandRecord = AlarmCommand & {
  homeId: string;
  status: "pending" | "accepted" | "rejected" | "timeout";
  ack?: CommandAck;
};

export type Dashboard = {
  home: Omit<Home, "pinHash" | "memberIds">;
  state: AlarmState;
  recentEvents: AlarmEvent[];
};
