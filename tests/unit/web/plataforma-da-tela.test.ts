import { describe, expect, it } from "vitest";
import { desteMac, nesteMac, plataformaDaTela, terminalDaqui } from "../../../web/lib/plataforma-da-tela.ts";

/** ADA-229 (5/11): a tela do onboarding dizia "neste Mac" na janela do app do Windows e no navegador do Windows. */
describe("plataformaDaTela", () => {
  it("lê o sistema do user-agent", () => {
    expect(plataformaDaTela("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/142 Electron/39")).toBe("windows");
    expect(plataformaDaTela("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15")).toBe("mac");
    expect(plataformaDaTela("Mozilla/5.0 (X11; Linux x86_64) Chrome/142")).toBe("outro");
    expect(plataformaDaTela("")).toBe("outro");
  });
  it("fora do Windows os textos seguem os do Mac (os testes rodam sem navigator)", () => {
    expect(nesteMac()).toBe("neste Mac");
    expect(desteMac()).toBe("deste Mac");
    expect(terminalDaqui()).toBe("No Terminal deste Mac");
  });
  it("no Windows: 'neste computador' e o PowerShell", () => {
    const antes = globalThis.navigator;
    Object.defineProperty(globalThis, "navigator", { value: { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Electron/39" }, configurable: true });
    try {
      expect(nesteMac()).toBe("neste computador");
      expect(desteMac()).toBe("deste computador");
      expect(terminalDaqui()).toBe("No PowerShell deste computador");
    } finally {
      if (antes === undefined) delete (globalThis as { navigator?: unknown }).navigator;
      else Object.defineProperty(globalThis, "navigator", { value: antes, configurable: true });
    }
  });
});
