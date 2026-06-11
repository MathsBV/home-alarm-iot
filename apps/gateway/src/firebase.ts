import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { config, hasFirebaseCredentials } from "./config.js";

export function getFirebaseServices() {
  if (!hasFirebaseCredentials) {
    return null;
  }

  let credential;
  if (config.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    const serviceAccount = JSON.parse(
      Buffer.from(config.FIREBASE_SERVICE_ACCOUNT_BASE64, "base64").toString("utf8"),
    );
    credential = cert(serviceAccount);
  } else {
    credential = cert({
      projectId: config.FIREBASE_PROJECT_ID,
      clientEmail: config.FIREBASE_CLIENT_EMAIL,
      privateKey: config.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    });
  }

  const app = getApps()[0] ?? initializeApp({ credential });

  const firestore = getFirestore(app);
  firestore.settings({ ignoreUndefinedProperties: true });

  return {
    auth: getAuth(app),
    firestore,
  };
}
