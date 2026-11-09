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
 * ADA-2 F5 (ADR-156) no app inteiro (servidor completo + catcher + a web montada) e no Chrome de verdade:
 *  - celular (390×844, toque): o pronto com ferramentas numa linha ("Usou N ferramenta(s)"); o card de aprovação em
 *    contorno; o composer + · campo · enviar (a pílula entre os redondos); segurar a fala abre o menu de vidro com a
 *    cópia, Responder · Copiar · Criar tarefa disto no topo; "Criar tarefa disto" cria no quadro e o Desfazer apaga;
 *    um toque curto não abre nada; a pílula do quadro com o + e o enviar em contorno;
 *  - computador (1280×800): nada disso muda o computador (sem +, caixa com a borda dela, card cheio), e o ⋯ ganha
 *    "Criar tarefa disto".
 * Sem a web montada (npx vite build) ou sem Chrome, pula, como os outros e2e de Chrome.
 */

const WEB = join(process.cwd(), "dist/web");
const chrome = existsSync(join(WEB, "index.html")) ? (() => { try { return acharChrome(); } catch { return null; } })() : null;
if (process.env.NOD_QA_EXIGE_CHROME === "1" && !chrome) throw new Error("ADA-2 F5: o CI precisa da web montada (npx vite build) e do Chromium");
const ROTINA = { cron: "0 8 * * 1-5", fuso_iana: "America/Sao_Paulo", instrucao: "mande as pautas do dia", fonte: "pedido da pessoa", entregavel: "mensagem nesta conversa", limites_aprovacao: "sem ações externas", politica_sem_dado: "enviar mesmo sem novos dados" };
const RESPOSTA = "Fechei o PR 481 e abri a issue de follow-up para o cache dos convites.";

const descrever = chrome ? describeIntegracao : describe.skip;
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

descrever("ADA-2 F5: conversa do celular (Chrome real)", () => {
  let srv: ServidorCompleto;
  let cdp: Cdp;
  let dir: string;
  const agentes: string[] = [];
  const conversas: string[] = [];

  beforeAll(async () => {
    srv = await servidorCompleto({ env: { NOD_STATIC_DIR: WEB, NOD_PRAZO_DECISAO_MS: "86400000" }, drivers: ({ urlNod }) => [criarCatcherDriver({ urlNod, atrasoMs: 0 })] });
    const onb = await srv.json<EstadoOnboarding>("GET", "onboarding");
    if (onb.guia) { agentes.push(onb.guia.id); conversas.push(onb.guia.conversaId); }
    await srv.json("POST", "onboarding/concluir", {});
    await srv.json("PUT", "preferencias", { experimentos: { quadro: true } });
    dir = mkdtempSync(join(tmpdir(), "ada2f5-"));
    process.env.CARGA_CHROME = chrome!;
    ({ cdp } = await abrirChrome(9650 + (process.pid % 150), join(dir, "perfil")));
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

  async function criarBot(nome: string): Promise<{ id: string; conversaId: string }> {
    const r = await srv.json<{ agente: Agente; conversa: Conversa }>("POST", "agentes", { dono: "pessoa", nome, descricao: "Cuida das pautas" });
    agentes.push(r.agente.id);
    conversas.push(r.conversa.id);
    // Manual: a rotina vira o card de proposta (é o card que fica em contorno no celular).
    await srv.json("POST", `agentes/${r.agente.id}/modo-aprovacao`, { modo: "manual" });
    await srv.json("POST", `agentes/${r.agente.id}/quadro`, { meta: "Pautas da semana" });
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

  async function abrir(largura: number, altura: number): Promise<void> {
    const celular = largura < 700;
    // Densidade 2 no celular, como um aparelho. O Chrome arredonda a borda de 1.5 px para 1 px no estilo calculado
    // (em qualquer densidade); a largura declarada é provada no teste de CSS, aqui só o contorno sólido em --ink.
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: largura, height: altura, deviceScaleFactor: celular ? 2 : 1, mobile: celular });
    await cdp.enviar("Emulation.setTouchEmulationEnabled", { enabled: celular, maxTouchPoints: celular ? 5 : 1 });
    await cdp.enviar("Emulation.setEmulatedMedia", { features: [
      { name: "hover", value: celular ? "none" : "hover" }, { name: "pointer", value: celular ? "coarse" : "fine" },
      { name: "prefers-color-scheme", value: "light" }, { name: "prefers-reduced-motion", value: "reduce" },
    ] });
    await cdp.enviar("Page.navigate", { url: `${srv.url}/` });
    await ate(`document.querySelector('[data-act="abrir-conversa"]')`, "a lista de bots");
  }

  async function abrirConversa(bot: { id: string }): Promise<void> {
    await clicar(`[data-bot-contexto="${bot.id}"] [data-act="abrir-conversa"], button[data-bot-contexto="${bot.id}"]`);
    await ate(`document.getElementById("composer-texto")`, "a conversa");
  }

  /** Manda o pedido; o catcher chama criar_rotina (o card) e responde com RESPOSTA. */
  async function pedirRotina(): Promise<void> {
    const texto = `Crie uma rotina das pautas [[tool: criar_rotina ${JSON.stringify(ROTINA)}]] [[texto: ${RESPOSTA}]]`;
    await avaliar(cdp, `(() => { const ta = document.getElementById("composer-texto"); ta.focus(); ta.value = ${JSON.stringify(texto)}; ta.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await clicar('.composer [data-act="enviar"]');
    await ate(`document.querySelector("#timeline .cp .cp-sim")`, "o card de proposta", 25_000);
    // A fala da pessoa também contém RESPOSTA (no [[texto: …]]): espera o balão do BOT, não qualquer mensagem.
    await ate(seletorDaResposta, "a resposta do bot", 25_000);
  }

  const seletorDaResposta = `[...document.querySelectorAll("#timeline .message.bot[data-mensagem]")].find((m) => m.querySelector(".bubble")?.textContent.includes(${JSON.stringify(RESPOSTA)}))`;

  async function tocar(ms: number, seletor = seletorDaResposta, dentro = ".bubble"): Promise<void> {
    const r = await avaliar<{ x: number; y: number }>(cdp, `(() => { const m = ${seletor}; m.scrollIntoView({ block: "center" }); const b = m.querySelector(${JSON.stringify(dentro)}).getBoundingClientRect(); return { x: Math.round(b.left + 20), y: Math.round(b.top + b.height / 2) }; })()`);
    await cdp.enviar("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: r.x, y: r.y }] });
    await espera(ms);
    await cdp.enviar("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }

  async function tarefasDoQuadro(botId: string): Promise<{ titulo: string; descricao: string; status: string; agenteId: string | null }[]> {
    const r = await srv.json<{ quadro: { tarefas: { titulo: string; descricao: string; status: string; agenteId: string | null }[] } | null }>("GET", `agentes/${botId}/quadro`);
    return r.quadro?.tarefas ?? [];
  }

  it("390: ferramentas numa linha, card em contorno, composer de três peças, toque longo, Criar tarefa e Desfazer", async () => {
    const bot = await criarBot("Pautas F5");
    await abrir(390, 844);
    await abrirConversa(bot);
    await pedirRotina();

    // (a) O pronto com ferramentas: uma linha "Usou 1 ferramenta", o tempo no title e o rótulo inteiro no aria-label.
    await ate(`document.querySelector('#timeline .pensar[data-fase="pronto"] > .pensar-ferr')`, "a linha das ferramentas", 25_000);
    const ferr = await avaliar<{ texto: string; aria: string; title: string; altura: number }>(cdp, `(() => { const s = document.querySelector('#timeline .pensar[data-fase="pronto"] > .pensar-ferr');
      return { texto: s.querySelector(".fala-viva-estado").textContent, aria: s.getAttribute("aria-label"), title: s.getAttribute("title"), altura: s.getBoundingClientRect().height }; })()`);
    expect(ferr.texto).toMatch(/^Usou \d+ ferramentas?( · \d+ (falhou|falharam))?$/);
    expect(ferr.aria).toMatch(/^Ver (a ferramenta usada|as \d+ ferramentas usadas)/);
    expect(ferr.title).toMatch(/^Pensou por /);
    expect(ferr.altura).toBeGreaterThanOrEqual(44);
    // QA ADA-20 (C1): tocar na linha abre a lista das chamadas (o <details>), sem fundo nem borda e em 14 px --ink-3.
    const estiloFerr = await avaliar<{ fundo: string; borda: string; fonte: string; cor: boolean }>(cdp, `(() => { const s = document.querySelector('#timeline .pensar[data-fase="pronto"] > .pensar-ferr'); const c = getComputedStyle(s); const t = getComputedStyle(s.querySelector(".fala-viva-estado"));
      const ink3 = getComputedStyle(document.documentElement).getPropertyValue("--ink-3").trim(); const p = document.createElement("i"); p.style.color = ink3; document.body.append(p); const ref = getComputedStyle(p).color; p.remove();
      return { fundo: c.backgroundColor, borda: c.borderTopWidth, fonte: t.fontSize, cor: t.color === ref }; })()`);
    expect(estiloFerr).toEqual({ fundo: "rgba(0, 0, 0, 0)", borda: "0px", fonte: "14px", cor: true });
    // Com a máquina carregada o CDP pode atrasar o touchEnd e o toque vira o toque longo do Chrome (sem clique): tenta de novo.
    const aberta = `document.querySelector('#timeline .pensar[data-fase="pronto"]')?.open`;
    for (let i = 0; i < 4 && !(await avaliar<boolean>(cdp, `!!(${aberta})`)); i++) {
      await tocar(40, `document.querySelector('#timeline .pensar[data-fase="pronto"]')`, ".pensar-ferr");
      for (let t = 0; t < 20 && !(await avaliar<boolean>(cdp, `!!(${aberta})`)); t++) await espera(100);
    }
    await ate(`${aberta} && [...document.querySelectorAll('#timeline .pensar[data-fase="pronto"] .pensar-acao')].some((li) => li.getBoundingClientRect().height > 0)`, "a lista das ferramentas aberta pelo toque");

    // (c) O card em contorno: o verbo é pílula transparente com borda 1.5 em --ink, raio 22, 44 de altura.
    const card = await avaliar<{ fundo: string; borda: string; raio: string; altura: number; cardRaio: string }>(cdp, `(() => { const b = document.querySelector("#timeline .cp .cp-sim"); const s = getComputedStyle(b);
      return { fundo: s.backgroundColor, borda: s.borderTopStyle + " " + (parseFloat(s.borderTopWidth) >= 1) + " " + (s.borderTopColor === s.color), raio: s.borderTopLeftRadius, altura: b.getBoundingClientRect().height, cardRaio: getComputedStyle(b.closest(".cp")).borderTopLeftRadius }; })()`);
    expect(card).toMatchObject({ fundo: "rgba(0, 0, 0, 0)", borda: "solid true true", raio: "22px", cardRaio: "16px" });
    expect(card.altura).toBeGreaterThanOrEqual(44);

    // (d) O composer: + | pílula | enviar. O + e o enviar ficam fora da pílula (o ::before), todos com 46.
    await avaliar(cdp, `(() => { const ta = document.getElementById("composer-texto"); ta.value = "oi"; ta.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    const cmp = await avaliar<{ mais: { left: number; right: number; width: number; height: number }; ta: { left: number; right: number }; envio: { left: number; width: number; height: number }; pilEsq: string; pilDir: string; borda: string; fundo: string; caixaBorda: string; boxRight: number }>(cdp, `(() => {
      const box = document.querySelector(".composer .box"); const r = (el) => el.getBoundingClientRect().toJSON();
      const antes = getComputedStyle(box, "::before"); const send = box.querySelector(".send"); const s = getComputedStyle(send);
      return { mais: r(box.querySelector(".mais-campo")), ta: r(box.querySelector("textarea")), envio: r(send), pilEsq: antes.left, pilDir: antes.right, borda: s.borderTopStyle + " " + (parseFloat(s.borderTopWidth) >= 1) + " " + (s.borderTopColor === s.color), fundo: s.backgroundColor,
        caixaBorda: getComputedStyle(box).borderTopWidth, boxRight: box.getBoundingClientRect().right }; })()`);
    expect(cmp.pilEsq).toBe("52px");
    expect(cmp.pilDir).toBe("52px");
    expect(cmp.caixaBorda).toBe("0px");
    expect(cmp.mais.width).toBe(46);
    expect(cmp.mais.right).toBeLessThanOrEqual(cmp.ta.left);
    expect(cmp.envio).toMatchObject({ width: 46, height: 46 });
    expect(cmp.envio.left).toBeGreaterThanOrEqual(cmp.ta.right);
    expect(Math.round(cmp.boxRight - (cmp.envio.left + cmp.envio.width))).toBe(0);
    expect(cmp).toMatchObject({ borda: "solid true true", fundo: "rgba(0, 0, 0, 0)" });
    await avaliar(cdp, `(() => { const ta = document.getElementById("composer-texto"); ta.value = ""; ta.dispatchEvent(new Event("input", { bubbles: true })); ta.blur(); })()`);
    // QA ADA-20 (C5): campo vazio — a ponta (mic com ditado; sem ditado, o enviar, S7) segue à vista com 46; a fileira
    // fica dentro de 390 − 2×12; o texto em 16 px (o iOS não dá zoom no foco).
    const vazio = await avaliar<{ ponta: number; esq: number; dir: number; fonte: string }>(cdp, `(() => { const box = document.querySelector(".composer .box"); const r = box.getBoundingClientRect();
      const ponta = [...box.querySelectorAll(":scope > .mic, :scope > .send")].filter((b) => b.getBoundingClientRect().width > 0);
      return { ponta: ponta.length ? Math.round(ponta[0].getBoundingClientRect().width) : 0, esq: r.left, dir: r.right, fonte: getComputedStyle(box.querySelector("textarea")).fontSize }; })()`);
    expect(vazio.ponta).toBe(46);
    expect(vazio.esq).toBeGreaterThanOrEqual(11.5);
    expect(vazio.dir).toBeLessThanOrEqual(390 - 11.5);
    expect(vazio.fonte).toBe("16px");

    // (b) Toque curto: nada abre.
    // Com a máquina carregada o CDP pode entregar o touchEnd bem depois dos 60 ms: o toque vira longo de verdade. Mede
    // no próprio Chrome (timeStamp dos eventos) e só cobra "nada abre" quando o toque durou menos que o toque longo.
    // QA ADA-20: até 5 tentativas, para ao menos um toque medido como curto ser cobrado (antes, sob carga, nenhum era).
    let curtosMedidos = 0;
    for (let i = 0; i < 5 && curtosMedidos === 0; i++) {
      await avaliar(cdp, `(() => { window.__toque = {}; addEventListener("pointerdown", (e) => { window.__toque.d = e.timeStamp; }, { capture: true, once: true }); addEventListener("pointerup", (e) => { window.__toque.u = e.timeStamp; }, { capture: true, once: true }); })()`);
      await tocar(60);
      await espera(200);
      const curto = await avaliar<{ abriu: boolean; durou: number; amostra: boolean; barra: string }>(cdp, `({ abriu: !!document.querySelector(".bot-menu.menu-fala-seg"), durou: window.__toque.u - window.__toque.d,
        amostra: !!document.querySelector(".acoes-a-mostra"), barra: getComputedStyle((${seletorDaResposta}).querySelector(".msg-actions")).display + "/" + getComputedStyle((${seletorDaResposta}).querySelector(".msg-actions")).visibility })`);
      if (curto.durou < 400) {
        curtosMedidos++;
        expect(curto.abriu).toBe(false);
        // QA ADA-20 (C2, S3): o toque curto também não mostra as ações da fala.
        expect(curto.amostra).toBe(false);
        expect(curto.barra).toMatch(/^none\/|\/hidden$/);
      }
      else await avaliar(cdp, `(() => { document.querySelector(".bot-menu.menu-fala-seg")?.close(); for (const m of document.querySelectorAll(".acoes-a-mostra")) m.classList.remove("acoes-a-mostra"); })()`);
    }
    expect(curtosMedidos, "nenhum toque saiu curto (máquina carregada?)").toBeGreaterThan(0);

    // QA ADA-20 (C2): arrastar o dedo (mais de 10 px) e continuar segurando não abre o menu — o gesto virou rolagem.
    // Na horizontal: o Chrome não começa rolagem nenhuma (e não manda pointercancel), então quem cancela é o movimento.
    {
      const p = await avaliar<{ x: number; y: number }>(cdp, `(() => { const m = ${seletorDaResposta}; m.scrollIntoView({ block: "center" }); const b = m.querySelector(".bubble").getBoundingClientRect(); return { x: Math.round(b.left + 20), y: Math.round(b.top + b.height / 2) }; })()`);
      await cdp.enviar("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [p] });
      await espera(40);
      for (const dx of [8, 16, 24, 32]) await cdp.enviar("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: p.x + dx, y: p.y }] });
      await espera(700);
      const arrastou = await avaliar<boolean>(cdp, `!!document.querySelector(".bot-menu.menu-fala-seg")`);
      await cdp.enviar("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      expect(arrastou).toBe(false);
    }
    // Segurar a linha das ferramentas (um <summary> dentro da fala) não abre o menu da fala.
    expect(await avaliar<boolean>(cdp, `!!document.querySelector('#timeline .pensar[data-fase="pronto"]').closest("[data-mensagem]")`)).toBe(true);
    await tocar(650, `document.querySelector('#timeline .pensar[data-fase="pronto"]')`, ".pensar-ferr");
    await espera(200);
    expect(await avaliar<boolean>(cdp, `!!document.querySelector(".bot-menu.menu-fala-seg")`)).toBe(false);

    // Segurar: o menu de vidro com a cópia da fala; a bolha original some; os três primeiros itens na ordem.
    await tocar(650);
    await ate(`document.querySelector(".bot-menu.menu-fala-seg")`, "o menu do toque longo");
    const menu = await avaliar<{ itens: string[]; copia: boolean; escondida: string; foco: string | null; largura: number }>(cdp, `(() => { const d = document.querySelector(".bot-menu.menu-fala-seg");
      return { itens: [...d.querySelectorAll("[data-fala]")].map((b) => b.getAttribute("data-fala")), copia: !!d.querySelector(".fala-copia")?.textContent.includes(${JSON.stringify(RESPOSTA)}),
        escondida: getComputedStyle((${seletorDaResposta}).querySelector(".bubble")).visibility, foco: document.activeElement?.getAttribute("data-fala") ?? null, largura: d.getBoundingClientRect().width }; })()`);
    expect(menu.itens.slice(0, 3)).toEqual(["responder", "copiar", "criar-tarefa"]);
    expect(menu.itens).toContain("relatar");
    expect(menu.copia).toBe(true);
    expect(menu.escondida).toBe("hidden");
    expect(menu.largura).toBeGreaterThan(0);

    // QA ADA-20 (C2): Esc fecha; o toque fora (no fundo) fecha; Copiar leva a fala inteira; Responder cita e foca o campo.
    const segurar = async (seletor = seletorDaResposta) => {
      await tocar(650, seletor);
      await ate(`document.querySelector(".bot-menu.menu-fala-seg")`, "o menu do toque longo");
    };
    const fechado = `!document.querySelector(".bot-menu.menu-fala-seg")`;
    await cdp.enviar("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await cdp.enviar("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await ate(fechado, "o Esc fechar o menu");
    await segurar();
    const fundo = await avaliar<{ x: number; y: number }>(cdp, `(() => { const r = document.querySelector(".bot-menu.menu-fala-seg").getBoundingClientRect(); return { x: 370, y: r.top > 60 ? 20 : 830 }; })()`);
    await cdp.enviar("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [fundo] });
    await espera(40);
    await cdp.enviar("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await ate(fechado, "o toque fora fechar o menu");
    await segurar();
    await avaliar(cdp, `(() => { window.__copiado = null; Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: (t) => { window.__copiado = t; return Promise.resolve(); } } }); })()`);
    await clicar('.bot-menu.menu-fala-seg [data-fala="copiar"]');
    await ate(`window.__copiado !== null`, "o Copiar");
    expect(await avaliar<string>(cdp, `window.__copiado`)).toBe(RESPOSTA);
    await segurar();
    await clicar('.bot-menu.menu-fala-seg [data-fala="responder"]');
    await ate(`${fechado} && document.activeElement?.id === "composer-texto"`, "o Responder focar o campo");
    await avaliar(cdp, `document.getElementById("composer-texto").blur()`);
    await segurar();

    // Criar tarefa disto: o aviso com Abrir e Desfazer, e a tarefa no quadro com o começo da fala.
    await clicar('.bot-menu.menu-fala-seg [data-fala="criar-tarefa"]');
    await ate(`[...document.querySelectorAll(".nl-desfazer.nl-abrir")].some((b) => b.offsetParent)`, "o aviso Tarefa criada com Abrir");
    await ate(`!document.querySelector(".bot-menu.menu-fala-seg")`, "o menu fechado");
    const criadas = await tarefasDoQuadro(bot.id);
    expect(criadas).toHaveLength(1);
    expect(criadas[0]!.titulo).toBe(RESPOSTA);
    expect(criadas[0]!.descricao).toContain("Da conversa com Pautas F5");
    expect(criadas[0]!.descricao).toContain(RESPOSTA);
    // QA ADA-20 (C3, S5): no Backlog e sem responsável (ninguém começa).
    expect(criadas[0]).toMatchObject({ status: "backlog", agenteId: null });
    // A bolha volta ao normal depois que o menu fecha.
    expect(await avaliar<string>(cdp, `getComputedStyle((${seletorDaResposta}).querySelector(".bubble")).visibility`)).toBe("visible");
    await clicar(".nl-desfazer.nl-desfazer-acao");
    for (let t = 0; t < 50 && (await tarefasDoQuadro(bot.id)).length > 0; t++) await espera(100);
    expect(await tarefasDoQuadro(bot.id)).toHaveLength(0);

    // QA ADA-20: a tarefa criada da fala DA PESSOA também diz de que conversa veio (com o bot, não "com você").
    const seletorDaMinha = `[...document.querySelectorAll("#timeline .message.pessoa[data-mensagem], #timeline .message:not(.bot)[data-mensagem]")].find((m) => m.querySelector(".bubble")?.textContent.includes("Crie uma rotina das pautas"))`;
    await segurar(seletorDaMinha);
    await clicar('.bot-menu.menu-fala-seg [data-fala="criar-tarefa"]');
    for (let t = 0; t < 50 && (await tarefasDoQuadro(bot.id)).length === 0; t++) await espera(100);
    const daMinha = await tarefasDoQuadro(bot.id);
    expect(daMinha).toHaveLength(1);
    expect(daMinha[0]!.descricao).toMatch(/^Da conversa com Pautas F5, /);
    await ate(`[...document.querySelectorAll(".nl-desfazer.nl-desfazer-acao")].some((b) => b.offsetParent)`, "o Desfazer da fala da pessoa");
    await clicar(".nl-desfazer.nl-desfazer-acao");
    for (let t = 0; t < 50 && (await tarefasDoQuadro(bot.id)).length > 0; t++) await espera(100);

    // Revisão do PR #703: a fala de vários balões (um por parágrafo) que abre com bloco de código. Todos os balões se escondem,
    // então todos ganham cópia; e as setas/Home andam só entre os itens do menu (o Copiar do código na cópia é inert).
    const LONGA = "```\nx = 1\n```\n\nDepois do código, o parágrafo da fala longa.";
    await avaliar(cdp, `(() => { const ta = document.getElementById("composer-texto"); ta.focus(); ta.value = ${JSON.stringify(`Mais uma [[texto: ${LONGA}]]`)}; ta.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await clicar('.composer [data-act="enviar"]');
    const seletorDaLonga = `[...document.querySelectorAll("#timeline .message.bot[data-mensagem]")].find((m) => [...m.querySelectorAll(".bubble")].some((b) => b.textContent.includes("parágrafo da fala longa")))`;
    await ate(`(${seletorDaLonga})?.querySelectorAll(".bubble").length >= 2 && (${seletorDaLonga}).querySelector('[data-act="copiar-codigo"]')`, "a fala longa em balões, com o código", 25_000);
    await tocar(650, seletorDaLonga);
    await ate(`document.querySelector(".bot-menu.menu-fala-seg")`, "o menu da fala longa");
    const longa = await avaliar<{ baloes: number; copias: number; textos: boolean }>(cdp, `(() => { const d = document.querySelector(".bot-menu.menu-fala-seg"); const m = ${seletorDaLonga};
      const copias = [...d.querySelectorAll(".fala-copia")];
      return { baloes: m.querySelectorAll(".bubble").length, copias: copias.length, textos: copias.map((c) => c.textContent).join(" ").includes("x = 1") }; })()`);
    expect.soft(longa.copias).toBe(longa.baloes);
    expect.soft(longa.textos).toBe(true);
    // O soltar do dedo leva o foco ao próprio <dialog> (fora da lista): o Home tem de ir ao primeiro item DO MENU.
    const tecla = (k: string) => avaliar(cdp, `document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(k)}, bubbles: true, cancelable: true }))`);
    const focoNoMenu = `(() => { const d = document.querySelector(".bot-menu.menu-fala-seg"); return { primeiro: document.activeElement === d.querySelector('[role="menu"] button'), ultimo: document.activeElement === [...d.querySelectorAll('[role="menu"] button')].at(-1) }; })()`;
    await tecla("Home");
    expect(await avaliar<{ primeiro: boolean }>(cdp, focoNoMenu)).toMatchObject({ primeiro: true });
    await tecla("ArrowUp");
    expect(await avaliar<{ ultimo: boolean }>(cdp, focoNoMenu)).toMatchObject({ ultimo: true });
    await avaliar(cdp, `document.querySelector(".bot-menu.menu-fala-seg").close()`);
  }, 150_000);

  it("390: a pílula do quadro tem o + (abre o seletor de arquivo) e o enviar em contorno, fora da pílula", async () => {
    const bot = await criarBot("Quadro F5");
    await abrir(390, 844);
    await abrirConversa(bot);
    // A doca de páginas da pílula: a página 0 é a conversa; as outras controlam o #quadro.
    await ate(`document.querySelector('#cabecalho [data-act="pagina"][aria-controls="quadro"]')`, "a doca com o quadro");
    await clicar('#cabecalho [data-act="pagina"][aria-controls="quadro"]');
    await ate(`document.querySelector('#quadro .qc-pil[data-form="conversa-no-quadro"]')?.getBoundingClientRect().width > 0`, "a pílula do quadro");
    const q = await avaliar<{ mais: string; clipe: string; pilEsq: string; enviarBorda: string; enviarFundo: string; enviarLargura: number; clipeLargura: number; act: string | null }>(cdp, `(() => {
      const pil = document.querySelector("#quadro .qc-pil"); const c = pil.querySelector(".qc-clipe"); const e = pil.querySelector(".qc-enviar");
      return { mais: getComputedStyle(c.querySelector(".qc-ic-mais")).display, clipe: getComputedStyle(c.querySelector("svg:not(.qc-ic-mais)")).display, pilEsq: getComputedStyle(pil, "::before").left,
        enviarBorda: (() => { const t = getComputedStyle(e); return t.borderTopStyle + " " + (parseFloat(t.borderTopWidth) >= 1); })(), enviarFundo: getComputedStyle(e).backgroundColor, enviarLargura: e.getBoundingClientRect().width, clipeLargura: c.getBoundingClientRect().width, act: c.getAttribute("data-act") }; })()`);
    expect(q).toMatchObject({ mais: "block", clipe: "none", pilEsq: "52px", enviarBorda: "solid true", enviarFundo: "rgba(0, 0, 0, 0)", enviarLargura: 46, clipeLargura: 46, act: "anexar" });
  }, 90_000);

  it("1280: o computador fica como era — sem +, caixa com borda própria, card cheio — e o ⋯ ganha Criar tarefa disto", async () => {
    const bot = await criarBot("Mesa F5");
    await abrir(1280, 800);
    await abrirConversa(bot);
    await pedirRotina();
    const mesa = await avaliar<{ mais: string; caixaBorda: string; antes: string; cardFundo: string }>(cdp, `(() => { const box = document.querySelector(".composer .box");
      return { mais: getComputedStyle(box.querySelector(".mais-campo")).display, caixaBorda: getComputedStyle(box).borderTopWidth, antes: getComputedStyle(box, "::before").content,
        cardFundo: getComputedStyle(document.querySelector("#timeline .cp .cp-sim")).backgroundColor }; })()`);
    expect(mesa.mais).toBe("none");
    expect(mesa.caixaBorda).not.toBe("0px");
    expect(mesa.antes).toBe("none");
    expect(mesa.cardFundo).not.toBe("rgba(0, 0, 0, 0)");
    // QA ADA-20 (C1, #290): a linha das ferramentas vale também no computador, 14 px.
    await ate(`document.querySelector('#timeline .pensar[data-fase="pronto"] > .pensar-ferr')`, "a linha das ferramentas no computador", 25_000);
    expect(await avaliar<{ texto: string; fonte: string }>(cdp, `(() => { const t = document.querySelector('#timeline .pensar[data-fase="pronto"] > .pensar-ferr .fala-viva-estado'); return { texto: t.textContent, fonte: getComputedStyle(t).fontSize }; })()`))
      .toMatchObject({ texto: expect.stringMatching(/^Usou \d+ ferramentas?/), fonte: "14px" });
    await avaliar(cdp, `(${seletorDaResposta}).querySelector('[data-act="mais-da-fala"]').click()`);
    await ate(`document.querySelector('.bot-menu [data-fala="criar-tarefa"]')`, "o ⋯ com Criar tarefa disto");
    const itens = await avaliar<string[]>(cdp, `[...document.querySelectorAll(".bot-menu [data-fala]")].map((b) => b.getAttribute("data-fala"))`);
    expect(itens.indexOf("criar-tarefa")).toBe(itens.indexOf("copiar") + 1);
  }, 120_000);
});
