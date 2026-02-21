import {
  app_default,
  logger
} from "./chunk-S2RRN5WH.js";
import "./chunk-PXURFYUM.js";
import "./chunk-VFKTQ3F4.js";
import "./chunk-BZ77VRLB.js";
import {
  env,
  validateEnv
} from "./chunk-X3RJFYZ5.js";
import "./chunk-YYVU23BY.js";
import "./chunk-URNS5VUA.js";
import "./chunk-LEWE3LDX.js";

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
