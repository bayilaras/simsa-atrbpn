import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import os from "node:os";

// This launcher has no deploy/provision verb and no overridable target or port.
const action = process.argv[2];
if (!["test", "start"].includes(action) || process.argv.length !== 3)
  throw new Error("Use emulators.mjs test|start");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) =>
      !/^(FIREBASE_|GOOGLE_|GCLOUD_|CLOUDSDK_|VITE_|DATABASE_|DB_|BLOB_|GCS_|VERCEL_|AWS_|SUPABASE_)/i.test(
        key,
      ) &&
      !/^(NODE_OPTIONS|NODE_PATH|JAVA_TOOL_OPTIONS|JDK_JAVA_OPTIONS|_JAVA_OPTIONS)$/i.test(
        key,
      ),
  ),
);
// configstore honors XDG_CONFIG_HOME (also on Windows). A private empty
// directory prevents inherited Firebase CLI logins/projects from participating.
// Keep it for diagnosis; it contains no user credentials and no cleanup is
// allowed to broaden beyond this exact generated directory.
env.XDG_CONFIG_HOME = mkdtempSync(path.join(os.tmpdir(), "simsa-spark-cli-"));
Object.assign(env, {
  GCLOUD_PROJECT: "demo-simsa-spark",
  GOOGLE_CLOUD_PROJECT: "demo-simsa-spark",
  FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9098",
  FIRESTORE_EMULATOR_HOST: "127.0.0.1:8088",
  FIREBASE_CLI_DISABLE_UPDATE_CHECK: "true",
  CI: "true",
});
env.PATH = `${path.dirname(process.execPath)}${path.delimiter}${env.PATH || env.Path || ""}`;
delete env.Path;
// Use a private IPC channel, not child.kill(): on Windows Node's kill API
// terminates the child instead of running Firebase CLI's graceful handlers.
// The preload queues an early request until the CLI installs its own handler.
// A console signal already received by the CLI needs no additional forwarding.
const shutdownBridge = `
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT'];
  let requestedSignal;
  let delivered = false;
  function deliver() {
    if (delivered || !requestedSignal || process.listenerCount(requestedSignal) < 2) return;
    delivered = true;
    process.emit(requestedSignal);
  }
  for (const signal of signals) {
    process.on(signal, () => {
      requestedSignal ??= signal;
      if (process.listenerCount(signal) > 1) delivered = true;
    });
  }
  process.on('newListener', event => {
    if (signals.includes(event)) queueMicrotask(deliver);
  });
  function requestShutdown() {
    requestedSignal ??= 'SIGINT';
    deliver();
  }
  process.on('message', message => {
    if (message?.type === 'simsa-emulator-shutdown') requestShutdown();
  });
  process.on('disconnect', requestShutdown);
  process.channel?.unref();
`;
const args = [
  "--import",
  `data:text/javascript,${encodeURIComponent(shutdownBridge)}`,
  path.join(root, "node_modules/firebase-tools/lib/bin/firebase.js"),
  action === "test" ? "emulators:exec" : "emulators:start",
  "--only",
  "auth,firestore",
  "--project",
  "demo-simsa-spark",
  "--config",
  "firebase.json",
];
if (action === "test")
  args.push(
    "node node_modules/vitest/vitest.mjs run --config vitest.emulator.config.ts",
  );
const child = spawn(process.execPath, args, {
  cwd: root,
  env,
  stdio: ["inherit", "inherit", "inherit", "ipc"],
  windowsHide: true,
});
const signalExitCodes = {
  SIGINT: 130,
  SIGTERM: 143,
  SIGHUP: 129,
  SIGQUIT: 131,
};
let shutdownSignal;
let shutdownWarning;
for (const signal of Object.keys(signalExitCodes)) {
  process.on(signal, () => {
    // Never send a second request: Firebase CLI treats repeated signals as an
    // instruction to skip cleanup. Wait for its child processes to shut down.
    if (shutdownSignal) return;
    shutdownSignal = signal;
    if (child.connected) {
      child.send({ type: "simsa-emulator-shutdown" }, (error) => {
        if (error && child.exitCode === null && child.signalCode === null) {
          console.error(
            `Could not request emulator shutdown: ${error.message}`,
          );
          process.exitCode = 1;
        }
      });
    }
    shutdownWarning = setTimeout(() => {
      console.error(
        "Still waiting for Firebase CLI cleanup; no processes have been force-killed.",
      );
    }, 10000);
    shutdownWarning.unref();
  });
}
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("close", (code, signal) => {
  clearTimeout(shutdownWarning);
  // An interrupted test/start must not be reported as a successful completion,
  // even when Firebase CLI exits zero after its graceful shutdown.
  process.exitCode =
    code ||
    signalExitCodes[shutdownSignal || signal] ||
    process.exitCode ||
    (code === 0 ? 0 : 1);
});
