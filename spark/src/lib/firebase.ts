import { initializeApp } from "firebase/app";
import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
} from "firebase/app-check";
import {
  initializeAuth,
  browserSessionPersistence,
  browserPopupRedirectResolver,
  connectAuthEmulator,
  type Auth,
} from "firebase/auth";
import {
  initializeFirestore,
  memoryLocalCache,
  connectFirestoreEmulator,
  type Firestore,
} from "firebase/firestore";
import { readSparkConfig } from "./config";

export interface SparkServices {
  auth: Auth;
  db: Firestore;
}
let services: SparkServices | undefined;
export function getSparkServices(): SparkServices {
  if (services) return services;
  const config = readSparkConfig(
    import.meta.env,
    import.meta.env.MODE,
    window.location.hostname,
  );
  if (
    !config.emulator &&
    (globalThis as { FIREBASE_APPCHECK_DEBUG_TOKEN?: unknown })
      .FIREBASE_APPCHECK_DEBUG_TOKEN !== undefined
  ) {
    throw new Error(
      "App Check debug tokens must not be used in a live Spark client.",
    );
  }
  const app = initializeApp(
    {
      apiKey: config.apiKey,
      authDomain: config.authDomain,
      projectId: config.projectId,
      appId: config.appId,
    },
    "simsa-spark",
  );
  if (!config.emulator)
    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(config.appCheckSiteKey),
      isTokenAutoRefreshEnabled: true,
    });
  const auth = initializeAuth(app, {
    persistence: browserSessionPersistence,
    popupRedirectResolver: browserPopupRedirectResolver,
  });
  auth.languageCode = "id";
  const db = initializeFirestore(app, { localCache: memoryLocalCache() });
  if (config.emulator) {
    connectAuthEmulator(auth, "http://127.0.0.1:9098");
    connectFirestoreEmulator(db, "127.0.0.1", 8088);
  }
  return (services = { auth, db });
}
