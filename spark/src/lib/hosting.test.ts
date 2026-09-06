import { describe, expect, it } from "vitest";
import configuration from "../../firebase.json";

describe("static Spark hosting boundaries", () => {
  const headers = configuration.hosting.headers[0].headers;
  const csp = headers.find(
    (header) => header.key === "Content-Security-Policy",
  )!.value;
  const directives = new Map(
    csp.split(";").map((part) => {
      const [name, ...values] = part.trim().split(/\s+/);
      return [name, values];
    }),
  );

  it("deploys only the live static build, not an emulator or server", () => {
    expect(configuration.hosting.public).toBe("dist");
    expect(configuration.hosting.rewrites).toEqual([
      { source: "**", destination: "/index.html" },
    ]);
    expect(configuration).not.toHaveProperty("functions");
  });

  it("allows documented reCAPTCHA App Check sources without unsafe script directives", () => {
    expect(directives.get("script-src")).toContain(
      "https://www.google.com/recaptcha/",
    );
    expect(directives.get("script-src")).toContain(
      "https://www.gstatic.com/recaptcha/",
    );
    expect(directives.get("connect-src")).toContain(
      "https://www.google.com/recaptcha/",
    );
    expect(directives.get("frame-src")).toContain(
      "https://recaptcha.google.com/recaptcha/",
    );
    expect(csp).not.toContain("'unsafe-inline'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(directives.get("frame-ancestors")).toEqual(["'none'"]);
  });
});
