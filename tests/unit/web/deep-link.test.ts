import { describe, expect, it, vi } from "vitest";
import type { AlvoAviso, NodDesktop } from "../../../src/contracts/desktop.ts";
import { readFileSync } from "node:fs";
import { criarPuxadorDeepLink, destinoDoAlvo, leituraConta } from "../../../web/lib/deep-link.ts";

/**
 * NOD-136 (web/lib/deep-link.ts): a página busca o link `nod://` da fila do app quando tem sessão, frota e salas — quando
 * as duas leituras de cada sessão chegaram e a cada aviso do app — e o abre pelo mesmo caminho do clique no aviso.
 */
const ALVO: AlvoAviso = { tipo: "conversa", conversaId: "3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b" };
const esperar = () => new Promise((r) => setTimeout(r, 0));
/** Uma passada do `reidratar` que lê só `q` (cada chamada pega o leitor da sessão atual). */
const ler = (d: ReturnType<typeof criarPuxadorDeepLink>, q: "frota" | "salas") => d.leitor()(q);

function ponte(fila: (AlvoAviso | null)[]) {
  let aviso: (() => void) | null = null;
  const pendente = vi.fn(async () => fila.shift() ?? null);
  const mac: NodDesktop = {
    avisar: async () => true,
    contador: async () => undefined,
    preferencias: async () => ({ avisos: true, tema: "sistema", som: true, bloqueados: false }),
    definirAvisos: async () => ({ avisos: true, tema: "sistema", som: true, bloqueados: false }),
    aoAbrir: () => undefined,
    aoDeepLink: (fn) => { aviso = fn; },
    deepLinkPendente: pendente,
  };
  return { mac, pendente, avisar: () => aviso?.() };
}

describe("puxador do deep link", () => {
  it("abre o link que esperava quando frota e salas chegaram; as leituras seguintes não perguntam de novo", async () => {
    const p = ponte([ALVO]);
    const abrir = vi.fn();
    const d = criarPuxadorDeepLink(p.mac, () => true, abrir);
    ler(d, "frota");
    await esperar();
    expect(p.pendente).not.toHaveBeenCalled();
    ler(d, "salas");
    await esperar();
    expect(abrir).toHaveBeenCalledWith(ALVO);
    ler(d, "frota");
    ler(d, "salas");
    await esperar();
    expect(p.pendente).toHaveBeenCalledTimes(1);
  });

  it("revisão do Codex: o link de uma sala não é consumido só com a frota (as salas, em ordem qualquer)", async () => {
    const p = ponte([ALVO]);
    const abrir = vi.fn();
    const d = criarPuxadorDeepLink(p.mac, () => true, abrir);
    p.avisar();
    ler(d, "salas");
    await esperar();
    expect(p.pendente).not.toHaveBeenCalled();
    ler(d, "frota");
    await esperar();
    expect(abrir).toHaveBeenCalledWith(ALVO);
  });

  it("sem sessão, frota ou salas, o aviso não busca: o link fica na fila do app até a página ficar pronta", async () => {
    const p = ponte([ALVO]);
    const abrir = vi.fn();
    let pronta = false;
    const d = criarPuxadorDeepLink(p.mac, () => pronta, abrir);
    p.avisar();
    ler(d, "frota");
    ler(d, "salas");
    await esperar();
    expect(p.pendente).not.toHaveBeenCalled();
    pronta = true;
    ler(d, "salas");
    await esperar();
    expect(abrir).toHaveBeenCalledWith(ALVO);
  });

  it("com a página pronta, o aviso do app busca e abre na hora", async () => {
    const p = ponte([null, { tipo: "sua-vez" }]);
    const abrir = vi.fn();
    const d = criarPuxadorDeepLink(p.mac, () => true, abrir);
    ler(d, "frota");
    ler(d, "salas");
    await esperar();
    expect(abrir).not.toHaveBeenCalled();
    p.avisar();
    await esperar();
    expect(abrir).toHaveBeenCalledWith({ tipo: "sua-vez" });
  });

  it("outra sessão volta a buscar na primeira frota dela", async () => {
    const p = ponte([null, ALVO]);
    const abrir = vi.fn();
    const d = criarPuxadorDeepLink(p.mac, () => true, abrir);
    ler(d, "frota");
    ler(d, "salas");
    d.novaSessao();
    ler(d, "frota");
    await esperar();
    expect(p.pendente).toHaveBeenCalledTimes(1);
    ler(d, "salas");
    await esperar();
    expect(p.pendente).toHaveBeenCalledTimes(2);
    expect(abrir).toHaveBeenCalledWith(ALVO);
  });

  it("app antigo (sem os métodos) ou navegador: nada acontece; falha da ponte não quebra", async () => {
    const abrir = vi.fn();
    const semPonte = criarPuxadorDeepLink(undefined, () => true, abrir);
    ler(semPonte, "frota");
    ler(semPonte, "salas");
    const { aoDeepLink: _a, deepLinkPendente: _d, ...antigo } = ponte([ALVO]).mac;
    const velho = criarPuxadorDeepLink(antigo, () => true, abrir);
    ler(velho, "frota");
    ler(velho, "salas");
    const falha = ponte([]);
    falha.mac.deepLinkPendente = async () => { throw new Error("origem_invalida"); };
    const quebrado = criarPuxadorDeepLink(falha.mac, () => true, abrir);
    ler(quebrado, "frota");
    ler(quebrado, "salas");
    await esperar();
    expect(abrir).not.toHaveBeenCalled();
  });

  it("revisão: falha da ponte não marca como conferido; a próxima leitura busca de novo", async () => {
    const p = ponte([ALVO]);
    let falhar = true;
    const original = p.pendente;
    p.mac.deepLinkPendente = async () => { if (falhar) throw new Error("origem_invalida"); return original(); };
    const abrir = vi.fn();
    const d = criarPuxadorDeepLink(p.mac, () => true, abrir);
    ler(d, "frota");
    ler(d, "salas");
    await esperar();
    expect(abrir).not.toHaveBeenCalled();
    falhar = false;
    ler(d, "salas");
    await esperar();
    expect(abrir).toHaveBeenCalledWith(ALVO);
  });
});

describe("troca de sessão (revisão, 2ª rodada)", () => {
  it("a leitura da sessão anterior que volta depois de novaSessao não conta", async () => {
    const p = ponte([ALVO]);
    const abrir = vi.fn();
    const d = criarPuxadorDeepLink(p.mac, () => true, abrir);
    const antiga = d.leitor();
    d.novaSessao();
    antiga("frota");
    antiga("salas");
    await esperar();
    expect(p.pendente).not.toHaveBeenCalled();
    ler(d, "frota");
    await esperar();
    expect(p.pendente).not.toHaveBeenCalled();
    ler(d, "salas");
    await esperar();
    expect(abrir).toHaveBeenCalledWith(ALVO);
  });

  it("o pull em voo quando outra sessão começa não abre o alvo na sessão nova", async () => {
    let soltar: (a: AlvoAviso | null) => void = () => undefined;
    const p = ponte([]);
    p.mac.deepLinkPendente = () => new Promise((r) => { soltar = r; });
    const abrir = vi.fn();
    const d = criarPuxadorDeepLink(p.mac, () => true, abrir);
    ler(d, "frota");
    ler(d, "salas");
    d.novaSessao();
    soltar(ALVO);
    await esperar();
    expect(abrir).not.toHaveBeenCalled();
  });
});

describe("destino do alvo (abrirAlvoDoAviso, critério 4)", () => {
  const EU = "pessoa-eu";
  const contexto = {
    pessoaId: EU,
    agentes: [
      { id: "bot-meu", conversaId: "c-minha", ownerId: EU },
      { id: "bot-outro", conversaId: "c-de-outro", ownerId: "pessoa-outra" },
    ],
    salas: [{ sala: { id: "sala-1", conversaId: "c-sala" } }],
  };

  it("conversa de um bot meu abre a conversa", () => {
    expect(destinoDoAlvo({ tipo: "conversa", conversaId: "c-minha" }, contexto)).toEqual({ tipo: "conversa", conversaId: "c-minha", agenteId: "bot-meu" });
  });

  it("conversa de uma sala abre a sala", () => {
    expect(destinoDoAlvo({ tipo: "conversa", conversaId: "c-sala" }, contexto)).toEqual({ tipo: "sala", salaId: "sala-1", conversaId: "c-sala" });
  });

  it("conversa de outra pessoa ou inexistente vira Sua vez", () => {
    expect(destinoDoAlvo({ tipo: "conversa", conversaId: "c-de-outro" }, contexto)).toEqual({ tipo: "sua-vez" });
    expect(destinoDoAlvo({ tipo: "conversa", conversaId: "nao-existe" }, contexto)).toEqual({ tipo: "sua-vez" });
  });

  it("sua-vez e computador-do-bot", () => {
    expect(destinoDoAlvo({ tipo: "sua-vez" }, contexto)).toEqual({ tipo: "sua-vez" });
    expect(destinoDoAlvo({ tipo: "computador-do-bot" }, contexto)).toEqual({ tipo: "computador-do-bot", primeiroUso: false });
  });
});

describe("ligação na página (web/main.ts)", () => {
  const main = readFileSync("web/main.ts", "utf8");

  it("as leituras da frota e das salas avisam o puxador, só da mesma sessão; a nova sessão o zera", () => {
    expect(main).toContain("const lerParaDeepLink = deepLink.leitor();");
    expect(main).toMatch(/canalAvisos\.contador\(0\);\n\s*deepLink\.novaSessao\(\);/);
    expect(main).toMatch(/criarPuxadorDeepLink\(window\.nodDesktop, \(\) => !!estado\.sessao, \(alvo\) => abrirAlvoDoAviso\(alvo\)\)/);
    expect(main).toContain("const destino = destinoDoAlvo(alvo, { pessoaId: estado.sessao.pessoaId, agentes: estado.frota?.agentes ?? [], salas: estado.salas });");
    // QA: o leitor é pego antes do primeiro await do reidratar (depois dele, a leitura da sessão antiga contaria na nova).
    const corpo = main.slice(main.indexOf("async function reidratar()"));
    expect(corpo.indexOf("const lerParaDeepLink = deepLink.leitor();")).toBeGreaterThan(-1);
    expect(corpo.indexOf("const lerParaDeepLink = deepLink.leitor();")).toBeLessThan(corpo.indexOf("await "));
    expect(main).toMatch(/const lida = acao \? leituraConta\(q, \{ acao: acao\.tipo \}\) : null;\n\s*if \(lida\) lerParaDeepLink\(lida\);/);
  });
});

describe("leituraConta (revisão, 3ª rodada)", () => {
  it("frota e salas hidratadas contam; outra ação não", () => {
    expect(leituraConta("frota", { acao: "hidratar-frota" })).toBe("frota");
    expect(leituraConta("salas", { acao: "hidratar-salas" })).toBe("salas");
    expect(leituraConta("tarefas", { acao: "hidratar-tarefas" })).toBeNull();
  });

  it("salas que falharam sem ser por rede contam; por rede, não; outra leitura que falha, nunca", () => {
    expect(leituraConta("salas", { erroDeRede: false })).toBe("salas");
    expect(leituraConta("salas", { erroDeRede: true })).toBeNull();
    expect(leituraConta("frota", { erroDeRede: false })).toBeNull();
  });

  it("no web/main, a falha das salas conta só depois do `break` da rede", () => {
    const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
    expect(main).toMatch(/break;\n\s*\}\n[\s\S]{0,400}?leituraConta\(q, \{ erroDeRede: false \}\);\n\s*if \(lida\) lerParaDeepLink\(lida\);/);
    expect(main).toContain("const lida = acao ? leituraConta(q, { acao: acao.tipo }) : null;");
  });
});
