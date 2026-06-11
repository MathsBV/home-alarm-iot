import type { AlarmEvent, AlarmState, CommandType } from "@home-alarm/contracts";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

export type DashboardResponse = {
  home: { id: string; name: string; deviceId: string };
  state: AlarmState;
  recentEvents: AlarmEvent[];
};

export type Contact = {
  id: string;
  homeId: string;
  name: string;
  email?: string;
  phone?: string;
  channels: { push: boolean; email: boolean; sms: boolean };
};

async function request<T>(
  path: string,
  token: string,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...options?.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = new Error(body.error ?? `Erro HTTP ${response.status}`);
    Object.assign(error, { statusCode: response.status });
    throw error;
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  dashboard: (homeId: string, token: string) =>
    request<DashboardResponse>(`/api/homes/${homeId}/dashboard`, token),
  events: (homeId: string, token: string, query = "") =>
    request<AlarmEvent[]>(`/api/homes/${homeId}/events${query}`, token),
  contacts: (homeId: string, token: string) =>
    request<Contact[]>(`/api/homes/${homeId}/contacts`, token),
  createHome: (
    token: string,
    body: { name: string; deviceId: string; pin: string },
  ) =>
    request<{ id: string; name: string; deviceId: string }>("/api/homes", token, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  command: (
    homeId: string,
    token: string,
    body: { type: CommandType; value?: boolean | number | string; pin: string },
  ) =>
    request(`/api/homes/${homeId}/commands`, token, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  saveContact: (
    homeId: string,
    token: string,
    body: Omit<Contact, "id" | "homeId"> & { id?: string },
  ) =>
    request<Contact>(`/api/homes/${homeId}/contacts`, token, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  deleteContact: (homeId: string, token: string, contactId: string) =>
    request<void>(`/api/homes/${homeId}/contacts/${contactId}`, token, {
      method: "DELETE",
    }),
  registerPushToken: (homeId: string, token: string, pushToken: string) =>
    request<void>(`/api/homes/${homeId}/push-tokens`, token, {
      method: "POST",
      body: JSON.stringify({ token: pushToken }),
    }),
  triggerDemo: (homeId: string, token: string) =>
    request<AlarmEvent>(`/api/homes/${homeId}/demo/trigger`, token, {
      method: "POST",
    }),
  exportUrl: (homeId: string, format: "csv" | "json") =>
    `${API_URL}/api/homes/${homeId}/events/export?format=${format}`,
};
