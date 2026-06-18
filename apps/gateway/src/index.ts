import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import helmet from "helmet";
import { ZodError } from "zod";
import { AlertService } from "./alerts.js";
import { authMiddleware } from "./auth.js";
import { config } from "./config.js";
import { getFirebaseServices } from "./firebase.js";
import { MqttService } from "./mqtt-service.js";
import { Repository } from "./repository.js";
import { apiRoutes } from "./routes.js";
import { biRoutes } from "./bi-routes.js";

const firebase = getFirebaseServices();
const repository = new Repository(firebase?.firestore ?? null);
await repository.seedDemo();

const alerts = new AlertService(repository);
const mqttService = new MqttService(repository, alerts);
mqttService.connect();

const app = express();
app.use(helmet());
app.use(
  cors({
    origin:
      config.ALLOWED_ORIGINS === "*"
        ? true
        : config.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim()),
  }),
);
app.use(express.json({ limit: "100kb" }));

app.get("/health", (_request, response) => {
  response.json({
    status: "ok",
    mode: config.DEMO_MODE ? "demo" : "production",
    firebase: Boolean(firebase),
    mqtt: Boolean(config.MQTT_URL),
    timestamp: new Date().toISOString(),
  });
});

// Exportação para BI: autenticada por API key própria, fora do login Firebase.
app.use("/bi", biRoutes(repository));

app.use("/api", authMiddleware(firebase?.auth ?? null), apiRoutes(repository, mqttService, alerts));

const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  console.error(error);
  if (error instanceof ZodError) {
    response.status(400).json({ error: "Dados inválidos.", details: error.flatten() });
    return;
  }
  const statusCode =
    typeof error === "object" &&
    error &&
    "statusCode" in error &&
    typeof error.statusCode === "number"
      ? error.statusCode
      : 500;
  response.status(statusCode).json({
    error: statusCode === 500 ? "Erro interno do gateway." : String(error.message),
  });
};
app.use(errorHandler);

app.listen(config.PORT, "0.0.0.0", () => {
  console.log(`Gateway disponível em http://0.0.0.0:${config.PORT}`);
});
