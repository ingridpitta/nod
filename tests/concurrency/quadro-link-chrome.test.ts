import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarCatcherDriver } from "../../src/adapters/executor/drivers/catcher.ts";
import { acharChrome } from "../../src/adapters/tela/capturador-cdp.ts";
import type { Agente } from "../../src/contracts/agente.ts";
import type { Conversa } from "../../src/contracts/conversa.ts";
import type { QuadroDto } from "../../src/contracts/quadro.ts";
import { abrirChrome, avaliar, type Cdp } from "../../scripts/carga-tela/cdp.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorCompleto, type ServidorCompleto } from "../helpers/servidor-completo.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * Revisão 7 do PR #623 (NOD-416, ADR-144): o boot com `?tarefa=COD` no app inteiro (servidor completo + catcher + a web
 * montada) e no Chrome de verdade. Sem sessão, o link fica guardado; a pessoa entra (login stub) e a tarefa abre em tela
 * cheia no Quadro do bot dela, com o código de volta na URL. Um código que não existe vira o aviso "Tarefa … não
 * encontrada." Sem a web montada (npx vite build) ou sem Chrome, pula, como rotina-no-chat-chrome.test.ts.
 */

const WEB = join(process.cwd(), "dist/web");
const chrome = existsSync(join(WEB, "index.html")) ? (() => { try { return acharChrome(); } catch { return null; } })() : null;
if (process.env.NOD_QA_EXIGE_CHROME === "1" && !chrome) throw new Error("NOD-416: o CI precisa da web montada (npx vite build) e do Chromium para o e2e do link da tarefa");

const descrever = chrome ? describeIntegracao : describe.skip;
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

descrever("revisão 7 do PR #623: o link ?tarefa= no boot do app (Chrome real)", () => {
  let srv: ServidorCompleto;
  let cdp: Cdp;
  let dir: string;
  const agentes: string[] = [];
  const conversas: string[] = [];

  beforeAll(async () => {
    srv = await servidorCompleto({
      env: { NOD_STATIC_DIR: WEB, NOD_QUADROS: "todos", NOD_PRAZO_DECISAO_MS: "86400000" },
      drivers: ({ urlNod }) => [criarCatcherDriver({ urlNod, atrasoMs: 0 })],
    });
    await srv.json("POST", "onboarding/concluir", {});
    await srv.json("PUT", "preferencias", { experimentos: { quadro: true } });
    dir = mkdtempSync(join(tmpdir(), "nod416-link-"));
    process.env.CARGA_CHROME = chrome!;
    ({ cdp } = await abrirChrome(9650 + (process.pid % 150), join(dir, "perfil")));
    await cdp.enviar("Page.enable");
    await cdp.enviar("Network.enable");
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  }, 120_000);

  afterAll(async () => {
    cdp?.fechar();
    if (dir) rmSync(dir, { recursive: true, force: true });
    if (!srv) return;
    await srv.fechar();
    await limparPessoaE2E(srv.db, srv.dbDono, srv.pessoa, { agentes, conversas });
    await srv.desligar();
  }, 30_000);

  async function ate(expressao: string, oQue: string, ms = 20_000): Promise<void> {
    for (let t = 0; t < ms; t += 100) {
      if (await avaliar<boolean>(cdp, `!!(${expressao})`)) return;
      await espera(100);
    }
    throw new Error(`esperei ${ms} ms por ${oQue}`);
  }
  const clicar = (sel: string) => avaliar(cdp, `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) throw new Error("não achei ${sel.replace(/"/g, "'")}"); el.click(); return true; })()`);

  it("sem sessão: o link espera o login; ao entrar, a tarefa abre no Quadro do bot com o código na URL", async () => {
    const r = await srv.json<{ agente: Agente; conversa: Conversa }>("POST", "agentes", { dono: "pessoa", nome: "Linka" });
    agentes.push(r.agente.id);
    conversas.push(r.conversa.id);
    await srv.json("POST", `agentes/${r.agente.id}/quadro`, { meta: "Abrir pelo link" });
    await srv.json("POST", `agentes/${r.agente.id}/quadro/tarefas`, { titulo: "A do link" });
    const { quadro } = await srv.json<{ quadro: QuadroDto | null }>("GET", `agentes/${r.agente.id}/quadro`);
    const codigo = quadro!.tarefas.find((t) => t.titulo === "A do link")!.codigo;

    await cdp.enviar("Page.navigate", { url: `${srv.url}/?tarefa=${encodeURIComponent(codigo)}` });
    // A tela de entrar (stub) lista a pessoa; o parâmetro já saiu da URL e ficou guardado na sessão do navegador.
    const entrar = `[data-act="entrar"][data-pessoa="${srv.pessoa.pessoaId}"]`;
    await ate(`document.querySelector(${JSON.stringify(entrar)})`, "a tela de entrar");
    expect(await avaliar<string>(cdp, "location.search")).toBe("");
    expect(await avaliar<boolean>(cdp, `!document.querySelector("#quadro .qd-tarefa")`)).toBe(true);
    await clicar(entrar);

    await ate(`document.querySelector("#quadro .qd-tarefa .qd-id")?.textContent === ${JSON.stringify(codigo)}`, "a tarefa do link aberta");
    expect(await avaliar<string>(cdp, `document.querySelector("#quadro .qd-tarefa")?.textContent ?? ""`)).toContain("A do link");
    expect(await avaliar<string | null>(cdp, `new URL(location.href).searchParams.get("tarefa")`)).toBe(codigo);
  }, 60_000);

  it("com sessão: um código que não existe vira o aviso, sem abrir tarefa nenhuma", async () => {
    await cdp.enviar("Page.navigate", { url: `${srv.url}/?tarefa=ZZZ-999999` });
    await ate(`document.body.textContent.includes("Tarefa ZZZ-999999 não encontrada.")`, "o aviso do código que não existe");
    expect(await avaliar<boolean>(cdp, `!document.querySelector("#quadro .qd-tarefa")`)).toBe(true);
  }, 60_000);

  it("revisão 8 do PR #623 (D4 no app inteiro): mover pela tarefa aberta leva à conversa do bot destino, com a tarefa aberta no código novo", async () => {
    const criar = async (nome: string) => {
      const r = await srv.json<{ agente: Agente; conversa: Conversa }>("POST", "agentes", { dono: "pessoa", nome });
      agentes.push(r.agente.id);
      conversas.push(r.conversa.id);
      await srv.json("POST", `agentes/${r.agente.id}/quadro`, { meta: null });
      return r;
    };
    const de = await criar("Movea");
    const para = await criar("Destina");
    await srv.json("POST", `agentes/${de.agente.id}/quadro/tarefas`, { titulo: "A que muda" });
    const lido = async (id: string) => (await srv.json<{ quadro: QuadroDto | null }>("GET", `agentes/${id}/quadro`)).quadro!;
    const origem = await lido(de.agente.id);
    const destino = await lido(para.agente.id);
    const tarefa = origem.tarefas.find((t) => t.titulo === "A que muda")!;

    await cdp.enviar("Page.navigate", { url: `${srv.url}/?tarefa=${encodeURIComponent(tarefa.codigo!)}` });
    await ate(`document.querySelector("#quadro .qd-tarefa .qd-id")?.textContent === ${JSON.stringify(tarefa.codigo)}`, "a tarefa aberta na origem");
    const opcao = `#qd-t-mover option[value="${destino.id}"]`;
    await ate(`document.querySelector(${JSON.stringify(opcao)})`, "o destino no Mover para");
    await avaliar(cdp, `(() => { const s = document.querySelector("#qd-t-mover"); s.value = ${JSON.stringify(destino.id)}; s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    await ate(`!document.querySelector('[data-act="mover-quadro"]').disabled`, "o botão Mover ligado");
    await clicar('[data-act="mover-quadro"]');

    // O irParaTarefa do main: a conversa do destino passa a ser a atual e a tarefa abre lá, com o código novo na URL.
    const codigoNovo = `${destino.prefixo}-1`;
    await ate(`document.querySelector('[aria-current="true"][data-conversa="${para.conversa.id}"]')`, "a conversa do bot destino");
    await ate(`document.querySelector("#quadro .qd-tarefa .qd-id")?.textContent === ${JSON.stringify(codigoNovo)}`, "a tarefa aberta no destino");
    expect(await avaliar<string>(cdp, `document.querySelector("#quadro .qd-tarefa")?.textContent ?? ""`)).toContain("A que muda");
    expect(await avaliar<string | null>(cdp, `new URL(location.href).searchParams.get("tarefa")`)).toBe(codigoNovo);
    expect((await lido(para.agente.id)).tarefas.map((t) => t.id)).toEqual([tarefa.id]);
  }, 60_000);
});
