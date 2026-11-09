import { describe, expect, it } from "vitest";
import { chaveDe, cifrar, decifrar, healthCheckDecifra } from "../../../src/db/cifra.ts";

describe("cifra", () => {
  it("roundtrip e health check", () => {
    const k = chaveDe("0".repeat(64));
    healthCheckDecifra(k);
    const blob = cifrar("slack-token", k);
    expect(blob.startsWith("v1:")).toBe(true);
    expect(blob).not.toContain("slack-token");
    expect(decifrar(blob, k)).toBe("slack-token");
  });
});
