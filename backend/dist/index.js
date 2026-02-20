import {
  app_default,
  logger
} from "./chunk-PCWEFH6G.js";
import "./chunk-MDWP4IF7.js";
import "./chunk-Y75PW3VJ.js";
import "./chunk-DL6EWBUY.js";
import {
  env,
  validateEnv
} from "./chunk-YSVDMDWC.js";
import "./chunk-F55GPJUN.js";
import "./chunk-MO3JKA2E.js";
import "./chunk-MR7OZFZ4.js";

// src/index.ts
try {
  validateEnv();
} catch (error) {
  logger.fatal({ err: error }, "Environment validation failed");
  process.exit(1);
}
var PORT = env.PORT;
var server = app_default.listen(PORT, () => {
  logger.info({
    port: PORT,
    env: env.NODE_ENV,
    frontendUrl: env.FRONTEND_URL
  }, `SIMSA Backend running at http://localhost:${PORT}`);
});
function gracefulShutdown(signal) {
  logger.info({ signal }, "Graceful shutdown initiated");
  server.close(() => {
    logger.info("HTTP server closed");
    process.exit(0);
  });
  setTimeout(() => {
    logger.error("Could not close connections in time, forcefully shutting down");
    process.exit(1);
  }, 1e4);
}
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "Unhandled Rejection");
});
process.on("uncaughtException", (error) => {
  logger.fatal({ err: error }, "Uncaught Exception");
  gracefulShutdown("uncaughtException");
});
