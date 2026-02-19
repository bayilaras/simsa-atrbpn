import {
  schema_exports
} from "./chunk-F55GPJUN.js";

// src/config/env.ts
import dotenv from "dotenv";
dotenv.config();
var env = {
  NODE_ENV: process.env.NODE_ENV || "development",
  PORT: parseInt(process.env.PORT || "3001", 10),
  // Database
  DATABASE_URL: process.env.DATABASE_URL || "",
  // Better Auth - fail fast if secret is missing (never use empty string)
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET || (() => {
    if (process.env.NODE_ENV === "production") {
      throw new Error("BETTER_AUTH_SECRET is required in production");
    }
    process.stderr.write("WARNING: BETTER_AUTH_SECRET not set. Using insecure default for development only.\n");
    return "dev-only-insecure-secret-do-not-use-in-production";
  })(),
  BETTER_AUTH_URL: process.env.BETTER_AUTH_URL || "http://localhost:3001",
  // Google OAuth
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || "",
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || "",
  // Google Drive
  GOOGLE_SERVICE_ACCOUNT_EMAIL: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "",
  GOOGLE_PRIVATE_KEY: process.env.GOOGLE_PRIVATE_KEY || "",
  GOOGLE_DRIVE_FOLDER_ID: process.env.GOOGLE_DRIVE_FOLDER_ID || "",
  // Frontend
  FRONTEND_URL: process.env.FRONTEND_URL || "http://localhost:5173"
};

// src/config/database.ts
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
if (typeof WebSocket === "undefined") {
  import("ws").then((ws) => {
    neonConfig.webSocketConstructor = ws.default || ws;
  }).catch(() => {
  });
}
var pool = new Pool({ connectionString: env.DATABASE_URL });
var db = drizzle({ client: pool, schema: schema_exports });

export {
  env,
  db
};
