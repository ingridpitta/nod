import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * NOD-254 (definido em 2026-10-15): no Mac, voltar para uma janela coberta pode disparar só `focus` (sem
 * `visibilitychange`); o `retomarStream` do main.ts precisa ouvi-lo para reabrir um stream mudo na hora.
 */
describe("main.ts: retomar o stream ao voltar para a janela (NOD-254)", () => {
  it("retomarStream escuta focus, visibilitychange, online e pageshow", () => {
    const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
    expect(main).toMatch(/window\.addEventListener\("focus", retomarStream\)/);
    expect(main).toMatch(/document\.addEventListener\("visibilitychange", retomarStream\)/);
    expect(main).toMatch(/window\.addEventListener\("online", retomarStream\)/);
    expect(main).toMatch(/window\.addEventListener\("pageshow", retomarStream\)/);
  });
});
