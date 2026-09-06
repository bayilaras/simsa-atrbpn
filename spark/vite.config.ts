import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { readSparkConfig } from "./src/lib/config";

export default defineConfig(({ command, mode }) => {
  if (command === "build")
    readSparkConfig(
      loadEnv(mode, process.cwd(), "VITE_"),
      mode,
      mode === "emulator" ? "127.0.0.1" : "build.invalid",
    );
  return {
    plugins: [react()],
    server: { host: "127.0.0.1", port: 5188, strictPort: true },
    build: {
      sourcemap: false,
      outDir: mode === "emulator" ? "dist-emulator" : "dist",
    },
    test: {
      environment: "jsdom",
      include: ["src/**/*.test.{ts,tsx}"],
      setupFiles: ["./tests/setup.ts"],
      clearMocks: true,
      restoreMocks: true,
    },
  };
});
