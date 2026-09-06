export type SparkEnvironment = Record<string, string | boolean | undefined>;
export interface SparkConfig {
  projectId: string;
  apiKey: string;
  authDomain: string;
  appId: string;
  appCheckSiteKey: string;
  emulator: boolean;
}
export function readSparkConfig(
  env: SparkEnvironment,
  mode: string,
  hostname: string,
): SparkConfig {
  const value = (key: string) =>
    typeof env[key] === "string" ? (env[key] as string).trim() : "";
  if (
    value("VITE_API_URL") ||
    value("VITE_DATABASE_URL") ||
    value("VITE_SPARK_PRIVATE_KEY")
  ) {
    throw new Error(
      "Spark must not contain an API URL, SQL URL, or administrator key.",
    );
  }
  if (mode === "emulator") {
    if (!["localhost", "127.0.0.1", "[::1]"].includes(hostname))
      throw new Error("Emulator is loopback-only.");
    if (
      value("VITE_SPARK_PROJECT_ID") &&
      value("VITE_SPARK_PROJECT_ID") !== "demo-simsa-spark"
    ) {
      throw new Error("Emulator cannot target a real project.");
    }
    return {
      projectId: "demo-simsa-spark",
      apiKey: "demo-simsa-spark-not-a-live-key",
      authDomain: "demo-simsa-spark.firebaseapp.com",
      appId: "1:123456789:web:1234567890abcdef",
      appCheckSiteKey: "",
      emulator: true,
    };
  }
  const config: SparkConfig = {
    projectId: value("VITE_SPARK_PROJECT_ID"),
    apiKey: value("VITE_SPARK_API_KEY"),
    authDomain: value("VITE_SPARK_AUTH_DOMAIN"),
    appId: value("VITE_SPARK_APP_ID"),
    appCheckSiteKey: value("VITE_SPARK_APP_CHECK_SITE_KEY"),
    emulator: false,
  };
  if (
    !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(config.projectId) ||
    config.projectId.startsWith("demo-")
  ) {
    throw new Error("An explicit pilot Firebase project is required.");
  }
  if (config.authDomain !== `${config.projectId}.firebaseapp.com`)
    throw new Error("Firebase project/auth domain mismatch.");
  if (!/^AIza[A-Za-z0-9_-]{30,50}$/.test(config.apiKey))
    throw new Error("Firebase public web API key is required.");
  if (!/^1:[0-9]{6,}:web:[a-f0-9]{8,}$/i.test(config.appId))
    throw new Error("Firebase web app ID is required.");
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(config.appCheckSiteKey))
    throw new Error("App Check site key is required.");
  return config;
}
