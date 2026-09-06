import { describe, expect, it } from "vitest";
import { readSparkConfig } from "./config";
const live = {
  VITE_SPARK_PROJECT_ID: "simsa-pilot-test",
  VITE_SPARK_AUTH_DOMAIN: "simsa-pilot-test.firebaseapp.com",
  VITE_SPARK_API_KEY: "AIza" + "A".repeat(35),
  VITE_SPARK_APP_ID: "1:123456789:web:1234567890abcdef",
  VITE_SPARK_APP_CHECK_SITE_KEY: "6L" + "B".repeat(30),
};
describe("Spark target boundaries", () => {
  it("requires explicit full live web configuration", () =>
    expect(() => readSparkConfig({}, "production", "site.web.app")).toThrow());
  it("accepts same-project live configuration", () =>
    expect(readSparkConfig(live, "production", "site.web.app").emulator).toBe(
      false,
    ));
  it.each([
    "VITE_SPARK_PROJECT_ID",
    "VITE_SPARK_API_KEY",
    "VITE_SPARK_APP_ID",
    "VITE_SPARK_AUTH_DOMAIN",
    "VITE_SPARK_APP_CHECK_SITE_KEY",
  ])("fails closed without %s", (key) =>
    expect(() =>
      readSparkConfig({ ...live, [key]: "" }, "production", "site.web.app"),
    ).toThrow(),
  );
  it("rejects a foreign Auth domain", () =>
    expect(() =>
      readSparkConfig(
        { ...live, VITE_SPARK_AUTH_DOMAIN: "other.firebaseapp.com" },
        "production",
        "site.web.app",
      ),
    ).toThrow());
  it("never connects an emulator build on a public origin", () =>
    expect(() => readSparkConfig({}, "emulator", "site.web.app")).toThrow());
  it("never directs an emulator build at a real project", () =>
    expect(() => readSparkConfig(live, "emulator", "127.0.0.1")).toThrow());
  it.each(["localhost", "127.0.0.1", "[::1]"])(
    "uses a demo-only project on %s",
    (host) =>
      expect(readSparkConfig({}, "emulator", host).projectId).toBe(
        "demo-simsa-spark",
      ),
  );
  it.each(["VITE_API_URL", "VITE_DATABASE_URL", "VITE_SPARK_PRIVATE_KEY"])(
    "rejects legacy/secret input %s",
    (key) =>
      expect(() =>
        readSparkConfig(
          { ...live, [key]: "forbidden" },
          "production",
          "site.web.app",
        ),
      ).toThrow(),
  );
});
