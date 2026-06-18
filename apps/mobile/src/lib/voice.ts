import type { CommandType } from "@home-alarm/contracts";

export type ParsedVoiceCommand = {
  type: CommandType;
  value?: number | string;
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

  // "desarmar" contém "armar", por isso é checado primeiro.
  if (value.includes("desarmar")) return { type: "DISARM", label: "Desarmar alarme" };
  if (value.includes("armar")) return { type: "ARM", label: "Armar alarme" };
  if (value.includes("silenciar") || value.includes("calar")) {
    return { type: "SILENCE", label: "Silenciar sirene" };
  }

  // Atraso: "atraso 30", "definir atraso para 45 segundos".
  if (value.includes("atraso") || value.includes("temporiza")) {
    const match = value.match(/(\d{1,3})/);
    if (match) {
      const segundos = Math.min(120, Math.max(0, parseInt(match[1]!, 10)));
      return { type: "SET_DELAY", value: segundos, label: `Definir atraso para ${segundos}s` };
    }
  }

  // Contramedidas: "ligar sirene", "alternar estrobo", "ativar cerca".
  if (value.includes("sirene")) {
    return { type: "SET_COUNTERMEASURE", value: "sirene", label: "Alternar sirene" };
  }
  if (value.includes("estrobo") || value.includes("flash")) {
    return { type: "SET_COUNTERMEASURE", value: "estrobo", label: "Alternar estrobo" };
  }
  if (value.includes("cerca")) {
    return { type: "SET_COUNTERMEASURE", value: "cerca", label: "Alternar cerca" };
  }

  return null;
}
