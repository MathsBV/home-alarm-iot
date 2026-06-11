import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DEMO_MODE: z.string().default("true").transform((value) => value === "true"),
  HOME_ID: z.string().default("home-demo-001"),
  DEVICE_ID: z.string().default("alarm-demo-001"),
  ALLOWED_ORIGINS: z.string().default("*"),
  PIN_PEPPER: z.string().min(8).default("demo-pin-pepper-change-me"),
  MQTT_URL: z.string().optional(),
  MQTT_USERNAME: z.string().optional(),
  MQTT_PASSWORD: z.string().optional(),
  FIREBASE_SERVICE_ACCOUNT_BASE64: z.string().optional(),
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),
  EXPO_ACCESS_TOKEN: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM: z.string().default("Alarme Residencial <onboarding@resend.dev>"),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM: z.string().optional(),
});

export const config = envSchema.parse(process.env);

export const hasFirebaseCredentials = Boolean(
  config.FIREBASE_SERVICE_ACCOUNT_BASE64 ||
    (config.FIREBASE_PROJECT_ID &&
      config.FIREBASE_CLIENT_EMAIL &&
      config.FIREBASE_PRIVATE_KEY),
);
