import type { NextFunction, Request, Response } from "express";
import type { Auth } from "firebase-admin/auth";
import { config } from "./config.js";
import type { UserContext } from "./types.js";

declare global {
  namespace Express {
    interface Request {
      user?: UserContext;
    }
  }
}

export function authMiddleware(auth: Auth | null) {
  return async (request: Request, response: Response, next: NextFunction) => {
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (config.DEMO_MODE && token === "demo-token") {
      request.user = { uid: "demo-user", email: "demo@alarme.local" };
      return next();
    }
    if (!token || !auth) {
      return response.status(401).json({ error: "Autenticação obrigatória." });
    }
    try {
      const decoded = await auth.verifyIdToken(token);
      request.user = { uid: decoded.uid, email: decoded.email };
      return next();
    } catch {
      return response.status(401).json({ error: "Token inválido ou expirado." });
    }
  };
}
