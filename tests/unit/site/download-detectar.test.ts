import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ADA-226: o botão de download do site escolhe a versão pelo sistema de quem visita (como a página do Grok).
 * As funções puras moram inline no index.html (a CSP só deixa script inline), entre os marcadores dl:inicio e dl:fim;
 * o teste as recorta e roda como estão.
 */
const html = readFileSync(join(import.meta.dirname, "../../../site/index.html"), "utf8");
const trecho = /\/\* dl:inicio \*\/([\s\S]*?)\/\* dl:fim \*\//.exec(html)?.[1] ?? "";
type Escolha = { rotulo: string; href: string } | null;
const fns = new Function(`${trecho}; return { dlSistema, dlArqPorUA, dlArqPorGpu, dlEscolha };`)() as {
  dlSistema: (nav: object) => "mac" | "windows" | null;
  dlArqPorUA: (v: unknown) => "arm64" | "x64" | null;
  dlArqPorGpu: (r: unknown) => "arm64" | "x64" | null;
  dlEscolha: (so: string | null, arq: string | null) => Escolha;
};

const UA = {
  win: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  linux: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36",
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
};

describe("ADA-226: detecção do sistema para o botão de download", () => {
  it("o trecho existe no index.html", () => {
    expect(trecho).toContain("function dlSistema");
  });

  it("reconhece Windows e Mac pelo userAgent e pelo platform", () => {
    expect(fns.dlSistema({ userAgent: UA.win, platform: "Win32" })).toBe("windows");
    expect(fns.dlSistema({ userAgent: UA.mac, platform: "MacIntel", maxTouchPoints: 0 })).toBe("mac");
    expect(fns.dlSistema({ userAgent: "", userAgentData: { platform: "Windows", mobile: false } })).toBe("windows");
    expect(fns.dlSistema({ userAgent: "", userAgentData: { platform: "macOS", mobile: false } })).toBe("mac");
  });

  it("Linux, celular e iPad (que se diz Macintosh) não têm detecção: fica só o menu", () => {
    expect(fns.dlSistema({ userAgent: UA.linux, platform: "Linux x86_64" })).toBeNull();
    expect(fns.dlSistema({ userAgent: UA.android, platform: "Linux armv8l" })).toBeNull();
    expect(fns.dlSistema({ userAgent: UA.iphone, platform: "iPhone" })).toBeNull();
    expect(fns.dlSistema({ userAgent: UA.mac, platform: "MacIntel", maxTouchPoints: 5 })).toBeNull();
    expect(fns.dlSistema({ userAgent: UA.win, userAgentData: { platform: "Windows", mobile: true } })).toBeNull();
    expect(fns.dlSistema({})).toBeNull();
  });

  it("arquitetura pelo userAgentData (Chrome) e pela GPU (plano B)", () => {
    expect(fns.dlArqPorUA("arm")).toBe("arm64");
    expect(fns.dlArqPorUA("x86")).toBe("x64");
    expect(fns.dlArqPorUA("")).toBeNull();
    expect(fns.dlArqPorUA(undefined)).toBeNull();
    expect(fns.dlArqPorGpu("ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version)")).toBe("arm64");
    expect(fns.dlArqPorGpu("Apple M1")).toBe("arm64");
    expect(fns.dlArqPorGpu("Intel(R) Iris(TM) Plus Graphics 655")).toBe("x64");
    expect(fns.dlArqPorGpu("AMD Radeon Pro 5500M OpenGL Engine")).toBe("x64");
    // O Safari mascara a GPU como "Apple GPU" em todo Mac: não dá para saber.
    expect(fns.dlArqPorGpu("Apple GPU")).toBeNull();
    expect(fns.dlArqPorGpu("")).toBeNull();
  });

  it("Windows baixa o .exe; Mac baixa o .dmg da arquitetura, com Apple Silicon quando não dá para saber", () => {
    expect(fns.dlEscolha("windows", null)).toEqual({ rotulo: "Baixar para Windows", href: "/download/windows" });
    expect(fns.dlEscolha("mac", "arm64")).toEqual({ rotulo: "Baixar para macOS", href: "/download/mac" });
    expect(fns.dlEscolha("mac", "x64")).toEqual({ rotulo: "Baixar para macOS", href: "/download/mac-intel" });
    expect(fns.dlEscolha("mac", null)).toEqual({ rotulo: "Baixar para macOS", href: "/download/mac" });
    expect(fns.dlEscolha(null, null)).toBeNull();
  });

  it("os dois menus têm todas as versões e o botão principal sem JS já baixa o .dmg do Apple Silicon", () => {
    const menus = [...html.matchAll(/<details class="dl-menu[^"]*">([\s\S]*?)<\/details>/g)].map((m) => m[1]!);
    expect(menus).toHaveLength(2);
    for (const m of menus) {
      for (const href of ["/download/windows", "/download/mac", "/download/mac-intel"]) expect(m).toContain(`href="${href}"`);
      expect(m).toContain("irm nodbot.ai/windows | iex");
    }
    const principais = [...html.matchAll(/<a class="btn pri"[^>]*data-dl="rotulo"[^>]*>/g)].map((m) => m[0]);
    expect(principais).toHaveLength(2);
    for (const a of principais) expect(a).toContain('href="/download/mac"');
  });
});
