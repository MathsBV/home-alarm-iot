import crypto from "node:crypto";
import { Router } from "express";
import { config } from "./config.js";
import type { Repository } from "./repository.js";
import { eventsToCsv } from "./routes.js";

// Comparação em tempo constante para não vazar a chave por timing.
function safeEqual(a: string, b: string) {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return crypto.timingSafeEqual(bufferA, bufferB);
}

/**
 * Rotas de exploração de dados para BI (Power BI, etc.).
 * Autenticadas por API key fixa (query `key` ou header `x-api-key`),
 * independentes do login Firebase do app — assim o Power BI pode
 * conectar direto na URL e atualizar sozinho.
 */
export function biRoutes(repository: Repository) {
  const router = Router();

  router.get("/events", async (request, response) => {
    try {
      if (!config.POWERBI_API_KEY) {
        return response.status(503).json({ error: "Exportação BI não configurada." });
      }

      const provided =
        (typeof request.query.key === "string" && request.query.key) ||
        request.header("x-api-key") ||
        "";
      if (!safeEqual(provided, config.POWERBI_API_KEY)) {
        return response.status(401).json({ error: "API key inválida." });
      }

      const deviceId =
        (typeof request.query.deviceId === "string" && request.query.deviceId) ||
        config.DEVICE_ID;
      const home = await repository.findHomeByDeviceId(deviceId);
      if (!home) {
        return response.status(404).json({ error: "Dispositivo não encontrado." });
      }

      const events = await repository.listEvents(home.id);
      if (request.query.format === "csv") {
        response.type("text/csv").send(eventsToCsv(events));
        return;
      }
      response.json(events);
    } catch (error) {
      console.error("Erro na exportação BI:", error);
      response.status(500).json({ error: "Erro ao exportar dados." });
    }
  });

  return router;
}
