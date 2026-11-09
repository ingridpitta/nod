import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarCatcherDriver } from "../../src/adapters/executor/drivers/catcher.ts";
import { cookieDeSessao } from "../../src/adapters/http/rotas/tela.ts";
import { acharChrome } from "../../src/adapters/tela/capturador-cdp.ts";
import type { Agente } from "../../src/contracts/agente.ts";
import type { Conversa } from "../../src/contracts/conversa.ts";
import type { EstadoOnboarding } from "../../src/contracts/onboarding.ts";
import { abrirChrome, avaliar, type Cdp } from "../../scripts/carga-tela/cdp.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorCompleto, type ServidorCompleto } from "../helpers/servidor-completo.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * NOD-444 no app inteiro (servidor completo + catcher + a web montada) e no Chrome de verdade, no computador (1440) e no
 * celular (390, toque): o "+ Nova" das Rotinas não abre formulário; leva à conversa do bot com "Crie uma rotina para " e o
 * cursor no fim, sem enviar nada. Completar a frase e enviar mostra o card de proposta da rotina. Com rascunho na caixa, o
 * texto fica e a frase vira pílula; tocar nela junta a frase numa linha nova.
 * Sem a web montada (npx vite build) ou sem Chrome, pula, como o bot de QA (qa-pelas-acoes.test.ts).
 */

const WEB = join(process.cwd(), "dist/web");
const chrome = existsSync(join(WEB, "index.html")) ? (() => { try { return acharChrome(); } catch { return null; } })() : null;
// O job do CI que monta a web e o Chromium (NOD_QA_EXIGE_CHROME=1) não pode pular o critério 7 calado (revisão 4 do PR #613).
if (process.env.NOD_QA_EXIGE_CHROME === "1" && !chrome) throw new Error("NOD-444: o CI precisa da web montada (npx vite build) e do Chromium para o e2e do “+ Nova”");
const FRASE = "Crie uma rotina para ";
const ROTINA = { cron: "0 8 * * 1-5", fuso_iana: "America/Sao_Paulo", instrucao: "mande as pautas do dia", fonte: "pedido da pessoa", entregavel: "mensagem nesta conversa", limites_aprovacao: "sem ações externas", politica_sem_dado: "enviar mesmo sem novos dados" };

const descrever = chrome ? describeIntegracao : describe.skip;
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

descrever("NOD-444: “+ Nova” rotina começa no chat (Chrome real)", () => {
  let srv: ServidorCompleto;
  let cdp: Cdp;
  let dir: string;
  const agentes: string[] = [];
  const conversas: string[] = [];

  beforeAll(async () => {
    srv = await servidorCompleto({ env: { NOD_STATIC_DIR: WEB, NOD_PRAZO_DECISAO_MS: "86400000" }, drivers: ({ urlNod }) => [criarCatcherDriver({ urlNod, atrasoMs: 0 })] });
    // O onboarding concluído: a guia não cobre a tela.
    const onb = await srv.json<EstadoOnboarding>("GET", "onboarding");
    if (onb.guia) { agentes.push(onb.guia.id); conversas.push(onb.guia.conversaId); }
    await srv.json("POST", "onboarding/concluir", {});
    dir = mkdtempSync(join(tmpdir(), "nod444-"));
    process.env.CARGA_CHROME = chrome!;
    ({ cdp } = await abrirChrome(9800 + (process.pid % 150), join(dir, "perfil")));
    await cdp.enviar("Page.enable");
    await cdp.enviar("Network.enable");
    const u = new URL(srv.url);
    await cdp.enviar("Network.setCookie", { name: "nod_sessao", value: cookieDeSessao(srv.pessoa.cookie), domain: u.hostname, path: "/" });
  }, 120_000);

  afterAll(async () => {
    cdp?.fechar();
    if (dir) rmSync(dir, { recursive: true, force: true });
    if (!srv) return;
    await srv.fechar();
    await limparPessoaE2E(srv.db, srv.dbDono, srv.pessoa, { agentes, conversas });
    await srv.desligar();
  }, 30_000);

  async function criarBot(nome: string, manual = true): Promise<{ id: string; conversaId: string }> {
    const r = await srv.json<{ agente: Agente; conversa: Conversa }>("POST", "agentes", { dono: "pessoa", nome, descricao: "Cuida das pautas" });
    agentes.push(r.agente.id);
    // No modo Manual a rotina vira o card de proposta (no Automático, o padrão, ela já nasce ativa, sem card).
    if (manual) await srv.json("POST", `agentes/${r.agente.id}/modo-aprovacao`, { modo: "manual" });
    conversas.push(r.conversa.id);
    return { id: r.agente.id, conversaId: r.conversa.id };
  }

  async function ate(expressao: string, oQue: string, ms = 15_000): Promise<void> {
    for (let t = 0; t < ms; t += 100) {
      if (await avaliar<boolean>(cdp, `!!(${expressao})`)) return;
      await espera(100);
    }
    throw new Error(`esperei ${ms} ms por ${oQue}`);
  }
  const clicar = (sel: string) => avaliar(cdp, `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) throw new Error("não achei ${sel.replace(/"/g, "'")}"); el.click(); return true; })()`);

  /** 1440 é o computador; 390 é o celular (toque, sem hover: a CONSULTA_CELULAR casa). */
  async function abrir(largura: number, tema: "light" | "dark"): Promise<void> {
    const celular = largura < 700;
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: largura, height: celular ? 844 : 900, deviceScaleFactor: 1, mobile: celular });
    await cdp.enviar("Emulation.setTouchEmulationEnabled", { enabled: celular, maxTouchPoints: celular ? 5 : 1 });
    await cdp.enviar("Emulation.setEmulatedMedia", { features: [
      { name: "hover", value: celular ? "none" : "hover" }, { name: "pointer", value: celular ? "coarse" : "fine" },
      { name: "prefers-color-scheme", value: tema }, { name: "prefers-reduced-motion", value: "reduce" },
    ] });
    await cdp.enviar("Page.navigate", { url: `${srv.url}/` });
    await ate(`document.querySelector('[data-act="abrir-conversa"]')`, "a lista de bots");
  }

  /** No computador o painel do bot começa oculto: a pessoa abre pela pílula do cabeçalho. */
  async function abrirPainel(): Promise<void> {
    if (!(await caixa()).gavetaVisivel) await clicar("#cabecalho .pilula-bot");
    await ate(`document.getElementById("detalhes").getBoundingClientRect().width > 0`, "o painel do bot aberto");
  }

  /** O estado da caixa da conversa como a pessoa vê. */
  const caixa = () => avaliar<{ valor: string; focada: boolean; ini: number; fim: number; pilula: boolean; gavetaVisivel: boolean; perfilAberto: boolean; formulario: boolean }>(cdp, `(() => {
    const ta = document.getElementById("composer-texto");
    const p = document.getElementById("composer-sugestao");
    const det = document.getElementById("detalhes");
    const r = det?.getBoundingClientRect();
    return { valor: ta?.value ?? "", focada: document.activeElement === ta, ini: ta?.selectionStart ?? -1, fim: ta?.selectionEnd ?? -1,
      pilula: !!p && !p.hidden && p.getBoundingClientRect().height > 0,
      gavetaVisivel: !!r && r.width > 0 && r.left < innerWidth && getComputedStyle(det).visibility !== "hidden",
      perfilAberto: document.querySelector(".app")?.classList.contains("detalhes-abertos") ?? false,
      formulario: !!document.querySelector('[data-form="criar-rotina"]') };
  })()`);

  async function mensagensDaConversa(conversaId: string): Promise<{ kind: string; texto: string; autoria: { autor_tipo: string } }[]> {
    return (await srv.json<{ mensagens: { kind: string; texto: string; autoria: { autor_tipo: string } }[] }>("GET", `conversas/${conversaId}/mensagens`)).mensagens;
  }

  /** Completa a frase, envia e espera o card de proposta da rotina na timeline. */
  async function completarEEnviar(conversaId: string): Promise<void> {
    const resto = `mandar as pautas todo dia útil às 8 [[tool: criar_rotina ${JSON.stringify(ROTINA)}]] [[texto: Proposta de rotina enviada.]]`;
    await avaliar(cdp, `(() => { const ta = document.getElementById("composer-texto"); ta.setRangeText(${JSON.stringify(resto)}, ta.value.length, ta.value.length, "end"); ta.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await clicar('.composer [data-act="enviar"]');
    await ate(`[...document.querySelectorAll("#timeline .cp")].some((c) => c.textContent.includes("Criar uma rotina para"))`, "o card de proposta da rotina", 25_000);
    const msgs = await mensagensDaConversa(conversaId);
    expect(msgs.some((m) => m.kind === "texto" && m.autoria.autor_tipo === "pessoa" && m.texto.startsWith(`${FRASE}mandar as pautas`))).toBe(true);
  }

  it("1440 (claro): “+ Nova” foca a caixa com a frase e o cursor no fim, nada enviado, gaveta aberta; completar e enviar mostra o card", async () => {
    const bot = await criarBot("Pautas");
    await abrir(1440, "light");
    await clicar(`[data-bot-contexto="${bot.id}"] [data-act="abrir-conversa"], button[data-bot-contexto="${bot.id}"]`);
    await ate(`document.querySelector('#detalhes [data-act="rotina-no-chat"][data-agente="${bot.id}"]')`, "o + Nova na gaveta");
    expect(await avaliar<string>(cdp, `document.querySelector("#detalhes .gvn-vazio")?.textContent ?? ""`)).toContain("Peça na conversa, do seu jeito");
    await abrirPainel();
    expect((await caixa()).pilula).toBe(false); // a pílula nasce escondida
    await clicar(`#detalhes [data-act="rotina-no-chat"][data-agente="${bot.id}"]`);
    const c = await caixa();
    expect(c).toMatchObject({ valor: FRASE, focada: true, ini: FRASE.length, fim: FRASE.length, pilula: false, gavetaVisivel: true, formulario: false });
    await espera(300);
    expect((await mensagensDaConversa(bot.conversaId)).some((m) => m.kind === "texto")).toBe(false);
    await completarEEnviar(bot.conversaId);
  }, 90_000);

  it("1440 (escuro): com rascunho, o texto fica e a frase vira pílula; tocar junta numa linha nova; digitar tira a pílula", async () => {
    const bot = await criarBot("Rascunho");
    await abrir(1440, "dark");
    await clicar(`[data-bot-contexto="${bot.id}"] [data-act="abrir-conversa"], button[data-bot-contexto="${bot.id}"]`);
    await ate(`document.getElementById("composer-texto") && document.querySelector('#detalhes [data-act="rotina-no-chat"][data-agente="${bot.id}"]')`, "a conversa e o + Nova");
    await abrirPainel();
    await avaliar(cdp, `(() => { const ta = document.getElementById("composer-texto"); ta.focus(); ta.value = "me lembra do relatório"; ta.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await clicar(`#detalhes [data-act="rotina-no-chat"][data-agente="${bot.id}"]`);
    expect(await caixa()).toMatchObject({ valor: "me lembra do relatório", focada: true, pilula: true });
    expect(await avaliar<string>(cdp, `document.querySelector("#composer-sugestao .composer-chip").textContent`)).toBe("Crie uma rotina para…");
    await clicar("#composer-sugestao .composer-chip");
    const junto = `me lembra do relatório\n${FRASE}`;
    expect(await caixa()).toMatchObject({ valor: junto, focada: true, ini: junto.length, fim: junto.length, pilula: false });
    // "+ Nova" de novo com a frase no fim não repete a frase nem mostra a pílula (QA do PR #613).
    await clicar(`#detalhes [data-act="rotina-no-chat"][data-agente="${bot.id}"]`);
    expect(await caixa()).toMatchObject({ valor: junto, pilula: false });
    // Com outro rascunho, a pílula volta com um novo "+ Nova" e some ao digitar.
    await avaliar(cdp, `(() => { const ta = document.getElementById("composer-texto"); ta.value = "outro rascunho"; ta.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await clicar(`#detalhes [data-act="rotina-no-chat"][data-agente="${bot.id}"]`);
    expect((await caixa()).pilula).toBe(true);
    await avaliar(cdp, `(() => { const ta = document.getElementById("composer-texto"); ta.value += "x"; ta.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    expect((await caixa()).pilula).toBe(false);
  }, 90_000);

  it("1440: a caixa cresce com a linha nova, a pílula é descrita ao leitor de tela, some com Esc (na caixa e nela) e ao enviar; a frase fica guardada ao trocar de conversa", async () => {
    const bot = await criarBot("Guardar");
    const outro = await criarBot("Outro");
    await abrir(1440, "light");
    const abrirBot = async (id: string) => {
      await clicar(`[data-bot-contexto="${id}"] [data-act="abrir-conversa"], button[data-bot-contexto="${id}"]`);
      await ate(`document.getElementById("composer-texto") && document.querySelector('#detalhes [data-act="rotina-no-chat"][data-agente="${id}"]')`, `a conversa de ${id}`);
    };
    await abrirBot(bot.id);
    await abrirPainel();
    const altura = () => avaliar<number>(cdp, `document.getElementById("composer-texto").getBoundingClientRect().height`);
    const descrita = () => avaliar<string | null>(cdp, `document.getElementById("composer-texto").getAttribute("aria-describedby")`);
    await avaliar(cdp, `(() => { const ta = document.getElementById("composer-texto"); ta.focus(); ta.value = "rascunho"; ta.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    const antes = await altura();
    await clicar(`#detalhes [data-act="rotina-no-chat"][data-agente="${bot.id}"]`);
    expect((await caixa()).pilula).toBe(true);
    expect(await descrita()).toBe("composer-sugestao");
    // Esc na caixa tira a pílula (e a descrição).
    await avaliar(cdp, `document.getElementById("composer-texto").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
    expect((await caixa()).pilula).toBe(false);
    expect(await descrita()).toBe(null);
    // Esc com o foco na própria pílula também tira, e o foco volta à caixa.
    await clicar(`#detalhes [data-act="rotina-no-chat"][data-agente="${bot.id}"]`);
    await avaliar(cdp, `(() => { const b = document.querySelector("#composer-sugestao .composer-chip"); b.focus(); b.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); })()`);
    expect(await caixa()).toMatchObject({ pilula: false, focada: true, valor: "rascunho" });
    // Tocar na pílula junta numa linha nova: a caixa cresce.
    await clicar(`#detalhes [data-act="rotina-no-chat"][data-agente="${bot.id}"]`);
    await clicar("#composer-sugestao .composer-chip");
    expect(await altura()).toBeGreaterThan(antes);
    // Trocar de conversa e voltar: o texto com a frase está guardado na conversa dele.
    await abrirBot(outro.id);
    expect((await caixa()).valor).toBe("");
    await abrirBot(bot.id);
    expect((await caixa()).valor).toBe(`rascunho\n${FRASE}`);
    // Enviar com a pílula à vista tira a pílula e a descrição (o rascunho entra sem input, para a pílula seguir à vista).
    await avaliar(cdp, `(() => { const ta = document.getElementById("composer-texto"); ta.value = "oi [[texto: oi]]"; })()`);
    await clicar(`#detalhes [data-act="rotina-no-chat"][data-agente="${bot.id}"]`);
    expect((await caixa()).pilula).toBe(true);
    await clicar('.composer [data-act="enviar"]');
    await ate(`document.getElementById("composer-sugestao")?.hidden !== false`, "a pílula sumir ao enviar");
    expect(await descrita()).toBe(null);
  }, 90_000);

  it("1440 com duas perguntas abertas: a pílula sozinha não muda o destino do rascunho, um Esc só tira a pílula; a frase na caixa vazia manda como assunto novo", async () => {
    const bot = await criarBot("Perguntas");
    for (const p of ["qual relatório?", "e o prazo?"]) {
      const r = await srv.json<{ ids: { turno?: string } }>("POST", `conversas/${bot.conversaId}/mensagens`, { texto: `oi [[tool: pedir_a_pessoa {"tipo":"pergunta","texto":"${p}"}]] [[texto: perguntei]]` });
      await srv.esperar(async () => ((await srv.json<{ turno: { estado: string } }>("GET", `turnos/${r.ids.turno}`)).turno.estado === "concluido" ? true : null), { nome: "turno da pergunta", timeoutMs: 15_000 });
    }
    await abrir(1440, "light");
    await clicar(`[data-bot-contexto="${bot.id}"] [data-act="abrir-conversa"], button[data-bot-contexto="${bot.id}"]`);
    await ate(`document.querySelector(".caixa-respondendo")`, "a caixa Respondendo");
    await abrirPainel();
    const respondendo = () => avaliar<boolean>(cdp, `!!document.querySelector(".caixa-respondendo")`);
    await avaliar(cdp, `(() => { const ta = document.getElementById("composer-texto"); ta.focus(); ta.value = "o mensal"; ta.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await clicar(`#detalhes [data-act="rotina-no-chat"][data-agente="${bot.id}"]`);
    expect(await caixa()).toMatchObject({ valor: "o mensal", pilula: true });
    expect(await respondendo()).toBe(true);
    await avaliar(cdp, `document.getElementById("composer-texto").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))`);
    expect((await caixa()).pilula).toBe(false);
    expect(await respondendo()).toBe(true);
    // Tocar na pílula põe a frase na caixa: o pedido de rotina passa a ir como assunto novo (a caixa Respondendo sai).
    await clicar(`#detalhes [data-act="rotina-no-chat"][data-agente="${bot.id}"]`);
    await clicar('#composer-sugestao [data-act="usar-sugestao-rotina"]');
    expect((await caixa()).valor).toBe(`o mensal\n${FRASE}`);
    await ate(`!document.querySelector(".caixa-respondendo")`, "a caixa Respondendo sair com a pílula");
    // Caixa vazia: a frase entra e o pedido de rotina vai como assunto novo (a caixa Respondendo sai, como no × dela).
    await avaliar(cdp, `(() => { const ta = document.getElementById("composer-texto"); ta.value = ""; ta.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await clicar(`#detalhes [data-act="rotina-no-chat"][data-agente="${bot.id}"]`);
    expect((await caixa()).valor).toBe(FRASE);
    await ate(`!document.querySelector(".caixa-respondendo")`, "a caixa Respondendo sair");
  }, 90_000);

  it("1440 no Automático (o padrão): “+ Nova” → completar → enviar cria a rotina ativa, que aparece nas Rotinas da gaveta", async () => {
    const bot = await criarBot("Automatico", false);
    await abrir(1440, "light");
    await clicar(`[data-bot-contexto="${bot.id}"] [data-act="abrir-conversa"], button[data-bot-contexto="${bot.id}"]`);
    await ate(`document.querySelector('#detalhes [data-act="rotina-no-chat"][data-agente="${bot.id}"]')`, "o + Nova");
    await abrirPainel();
    await clicar(`#detalhes [data-act="rotina-no-chat"][data-agente="${bot.id}"]`);
    expect((await caixa()).valor).toBe(FRASE);
    const resto = `mandar as pautas todo dia útil às 8 [[tool: criar_rotina ${JSON.stringify(ROTINA)}]] [[texto: Rotina criada.]]`;
    await avaliar(cdp, `(() => { const ta = document.getElementById("composer-texto"); ta.setRangeText(${JSON.stringify(resto)}, ta.value.length, ta.value.length, "end"); ta.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await clicar('.composer [data-act="enviar"]');
    await srv.esperar(async () => ((await srv.json<{ rotinas: { rotina: { agenteId: string; estado: string } }[] }>("GET", "rotinas")).rotinas.some((r) => r.rotina.agenteId === bot.id && r.rotina.estado === "ativa") ? true : null), { nome: "a rotina ativa", timeoutMs: 25_000 });
    await ate(`!document.querySelector("#detalhes .gvn-vazio")`, "a gaveta sem o vazio das rotinas", 15_000);
  }, 90_000);

  it("1000 (gaveta sobreposta): “+ Nova” fecha a gaveta para a caixa ficar à vista", async () => {
    const bot = await criarBot("Meio");
    await abrir(1000, "light");
    await clicar(`[data-bot-contexto="${bot.id}"] [data-act="abrir-conversa"], button[data-bot-contexto="${bot.id}"]`);
    await ate(`document.getElementById("composer-texto")`, "a conversa");
    await abrirPainel();
    await ate(`document.querySelector('#detalhes [data-act="rotina-no-chat"][data-agente="${bot.id}"]')`, "o + Nova");
    await clicar(`#detalhes [data-act="rotina-no-chat"][data-agente="${bot.id}"]`);
    await ate(`!document.querySelector(".app").classList.contains("detalhes-abertos")`, "a gaveta fechar");
    expect(await caixa()).toMatchObject({ valor: FRASE, focada: true, formulario: false });
  }, 90_000);

  it("390 (celular, toque): “Nova rotina” do perfil fecha o perfil e abre a conversa com a frase e o foco; completar e enviar mostra o card", async () => {
    const bot = await criarBot("Celular");
    await abrir(390, "light");
    await clicar(`[data-bot-contexto="${bot.id}"] [data-act="abrir-conversa"], button[data-bot-contexto="${bot.id}"]`);
    await ate(`document.querySelector("#cabecalho .pilula-bot")`, "a conversa do bot");
    await clicar("#cabecalho .pilula-bot");
    await ate(`document.querySelector('#detalhes [data-nivel="rotinas"]')`, "a linha Rotinas do perfil");
    await clicar('#detalhes [data-nivel="rotinas"]');
    await ate(`document.querySelector('#detalhes .pfc-vazio')`, "o vazio das rotinas");
    const vazio = await avaliar<{ texto: string; botoes: number }>(cdp, `({ texto: document.querySelector("#detalhes .pfc-vazio").textContent, botoes: document.querySelectorAll('#detalhes [data-act="rotina-no-chat"]').length })`);
    expect(vazio.texto).toContain("Peça na conversa, do seu jeito");
    expect(vazio.texto).not.toContain("Criar rotina");
    expect(vazio.botoes).toBe(1);
    await clicar(`#detalhes [data-act="rotina-no-chat"][data-agente="${bot.id}"]`);
    const c = await caixa();
    expect(c).toMatchObject({ valor: FRASE, focada: true, ini: FRASE.length, fim: FRASE.length, perfilAberto: false, formulario: false });
    await completarEEnviar(bot.conversaId);
  }, 90_000);
});
