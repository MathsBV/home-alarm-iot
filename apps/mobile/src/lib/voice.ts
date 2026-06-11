import type { CommandType } from "@home-alarm/contracts";

export type ParsedVoiceCommand = {
  type: CommandType;
  label: string;
};

const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

export function parseVoiceCommand(transcript: string): ParsedVoiceCommand | null {
  const value = normalize(transcript);
  if (value.includes("desarmar")) return { type: "DISARM", label: "Desarmar alarme" };
  if (value.includes("armar")) return { type: "ARM", label: "Armar alarme" };
  if (value.includes("silenciar") || value.includes("calar")) {
    return { type: "SILENCE", label: "Silenciar sirene" };
  }
  return null;
}
