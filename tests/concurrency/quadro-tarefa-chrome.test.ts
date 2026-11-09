import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acharChrome } from "../../src/adapters/tela/capturador-cdp.ts";
import { abrirChrome, avaliar, type Cdp } from "../../scripts/carga-tela/cdp.ts";

/**
 * NOD-416 (ADR-144) no Chrome de verdade, com o CSS e o JS do app e uma API falsa na página (sem servidor):
 *  - o "+" da coluna (NOD-460) cria pelo título; o card cai no Backlog com o código do quadro (ADA-1), o título e o responsável;
 *  - o link (`?tarefa=ADA-1`, aqui o `abrirTarefa` que o main chama) abre a tarefa em tela cheia, e o código vai para a URL;
 *  - Status e Responsável mudam na tarefa aberta; o histórico mostra quem e quando. Pelo teclado (revisão do PR #623,
 *    WCAG 3.2.2), a seta só escolhe: vale no Enter ou ao sair do campo; com o mouse, na hora. Quando a mudança faz o bot
 *    começar, o recibo diz "Ada começou", com Desfazer;
 *  - "Mover para": escolher não move; o botão Mover confirma, chama a API, volta ao quadro e diz o código novo; a URL
 *    perde o código.
 * Sem Chrome na máquina, o teste é pulado; no CI (NOD_QA_EXIGE_CHROME=1) a falta é erro.
 */

const RAIZ = new URL("../../", import.meta.url);
const chrome = ((): string | null => { try { return acharChrome() ?? null; } catch { return null; } })();
if (!chrome && process.env.NOD_QA_EXIGE_CHROME === "1") throw new Error("NOD-416: o CI precisa do Chrome para provar a tarefa (npx playwright install chromium)");
const descrever = chrome ? describe : describe.skip;

const ENTRADA = `
import { criarQuadroNaTela } from "./web/lib/quadro-na-tela.ts";
import { ErroApi } from "./web/lib/erro-api.ts";
import { comColunas } from "./web/lib/colunas.ts";
const agora = 1_700_000_000_000;
const chamadas = [];
const urls = [];
let n = 0;
const nomes = { a: "Ada", c: "Caio" };
const q = { id: "q1", agenteId: "a", prefixo: "ADA", meta: null, prazo: null, cumpridoEm: null, resumo: null, criadoEm: agora, atualizadoEm: agora, metaDesde: agora,
  agenteNome: "Ada", ultimoLote: null, feitas: 0, total: 0, tarefas: [] };
const q2 = { ...structuredClone(q), id: "q2", agenteId: "c", prefixo: "CA", agenteNome: "Caio" };
const historico = new Map();
const lote = (ids) => ({ id: "L" + (++n), quadroId: "q1", autor: { tipo: "pessoa" }, resumo: "mudou", tarefaIds: ids, desfeitoEm: null, criadoEm: agora });
const anotar = (id, e) => historico.set(id, [...(historico.get(id) ?? []), { id: "h" + historico.size + Math.random(), autor: "pessoa", autorAgenteId: null, autorNome: null, criadoEm: agora, ...e }]);
const mutacao = (ids, comecaram = []) => { q.total = q.tarefas.length; const l = lote(ids); q.ultimoLote = l; return { ok: true, quadro: structuredClone(q), lote: l, comecaram, desfeito: false }; };
const api = {
  quadro: async (a) => ({ quadro: structuredClone(a === "c" ? q2 : q) }),
  conversa: async () => ({ mensagens: [] }),
  enviar: async () => ({ ok: true }),
  responderTarefa: async () => mutacao([]),
  desfazerLoteQuadro: async () => mutacao([]),
  criarQuadro: async () => mutacao([]),
  editarQuadro: async () => mutacao([]),
  removerQuadro: async () => mutacao([]),
  criarTarefa: async (a, campos) => {
    chamadas.push(["criar", campos]);
    // Revisão do PR #645: o teste segura a criação para provar que o Enter duplo não cria duas.
    if (window.__segurarCriar) await window.__segurarCriar;
    const i = q.tarefas.length + 1;
    const t = { id: "t" + i, quadroId: "q1", titulo: campos.titulo, descricao: "", status: campos.status ?? "backlog", voltarPara: null, agenteId: "a", ordem: i, linearId: null, linearUrl: null, prUrl: null,
      pergunta: null, resposta: null, deFora: false, turnoId: null, criadoEm: agora, mudadoEm: agora, terminadaEm: null, execucao: null, agenteNome: "Ada", numero: i,
      codigo: "ADA-" + i, branch: "ada-" + i + "-revisar-a-copy" };
    q.tarefas.push(t);
    anotar(t.id, { campo: "criada", de: null, para: "backlog", deNome: null, paraNome: "Backlog" });
    return mutacao([t.id]);
  },
  mudarTarefa: async (a, id, campos) => {
    chamadas.push(["mudar", id, campos]);
    // Revisão 5 do PR #623: o teste segura a resposta para provar a trava (uma mudança por vez).
    if (window.__segurar) await window.__segurar;
    const t = q.tarefas.find((x) => x.id === id);
    if (campos.status) { anotar(id, { campo: "status", de: t.status, para: campos.status, deNome: "Backlog", paraNome: "A fazer" }); t.status = campos.status; }
    if (campos.agente !== undefined) { anotar(id, { campo: "agente", de: t.agenteId, para: campos.agente, deNome: nomes[t.agenteId] ?? null, paraNome: nomes[campos.agente] ?? null }); t.agenteId = campos.agente; t.agenteNome = nomes[campos.agente] ?? null; }
    t.mudadoEm++;
    // Como o servidor: A fazer com responsável começa (o recibo diz quem começou).
    const comecou = t.status === "afazer" && t.agenteId ? [{ tarefaId: id, agenteId: t.agenteId, agenteNome: nomes[t.agenteId], turnoId: "turno" + n }] : [];
    return mutacao([id], comecou);
  },
  moverTarefa: async (a, id, destino) => {
    chamadas.push(["mover", id, destino]);
    // Revisão 2 do PR #623: o primeiro mover perde a corrida (409 com o motivo da lista branca); o segundo vai.
    if (!window.__moverDeCara && chamadas.filter((c) => c[0] === "mover").length === 1) {
      const e = new ErroApi(409, "estado_invalido", "Isso não pode ser feito agora. Atualize a página e tente de novo.");
      e.motivo = "mudou_de_quadro";
      throw e;
    }
    const movida = q.tarefas.find((x) => x.id === id);
    q.tarefas = q.tarefas.filter((x) => x.id !== id);
    q2.tarefas.push({ ...movida, quadroId: "q2", numero: 1, codigo: "CA-1", branch: "ca-1" });
    return { ok: true, quadro: null, lote: null, comecaram: [], desfeito: false, movida: { tarefaId: id, codigo: "CA-1", codigoAntigo: "ADA-1" } };
  },
  historicoTarefa: async (a, id) => ({ historico: structuredClone(historico.get(id) ?? []) }),
  quadros: async () => ({ quadros: [{ id: "q1", agenteId: "a", agenteNome: "Ada", prefixo: "ADA" }, { id: "q2", agenteId: "c", agenteNome: "Caio", prefixo: "CA" }] }),
  // NOD-460 (0149): o Exibir guardado por quadro e a gravação (\`__exibirFalha\` = o servidor recusa).
  preferencias: async () => ({ quadroExibir: structuredClone(window.__exibirGuardado ?? {}) }),
  exibirQuadro: async (quadroId, e) => {
    chamadas.push(["exibir", quadroId, e]);
    if (window.__exibirFalha) throw new ErroApi(500, "erro_interno", "falhou");
    return { quadroExibir: { [quadroId]: e } };
  },
};
window.__chamadas = chamadas;
window.__q2 = q2;
window.__api = api;
// Revisão 7 do PR #623: Em revisão passa para o Caio (ADR-142, a passagem do NOD-417).
window.__comPassagem = () => { q.colunas = comColunas(q).colunas.map((c) => (c.id === "revisao" ? { ...c, responsavel: "c", responsavelNome: "Caio" } : c)); };
window.__segurarMudancas = () => { window.__segurar = new Promise((ok) => { window.__soltar = () => { window.__segurar = null; ok(); }; }); };
window.__urls = urls;
window.__montar = () => {
  document.getElementById("timeline").innerHTML = "<p>conversa</p>";
  document.getElementById("composer").innerHTML = "<textarea></textarea>";
  const t = criarQuadroNaTela(document, { reduzido: () => true, dados: { api: () => api, agente: (id) => (nomes[id] ? { avatar: "", nome: nomes[id] } : null), hora: () => "10:00", recolherEm: 60_000, juntarEm: 10,
    confirmar: (texto) => { chamadas.push(["confirmar", texto]); return true; },
    agentes: () => [{ id: "a", nome: "Ada" }, { id: "c", nome: "Caio" }],
    naUrl: (codigo) => urls.push(codigo),
    irParaTarefa: (ag, id) => (window.__ida ? window.__ida(ag, id) : false) } });
  t.sincronizar({ chave: "c1", nome: "Ada", agenteId: "a" });
  t.trocar("quadro");
  window.__q = t;
};
// QA do PR #623 (D4): como o main, \`irParaTarefa\` leva à conversa do bot destino (o sincronizar com a chave dele) e
// abre a tarefa pelo mesmo caminho do link.
window.__montarComIda = () => {
  window.__montar();
  const t = window.__q;
  window.__idas = [];
  // Revisão 8 do PR #623: \`__sumirNoDestino\` simula a corrida em que a tarefa sai do destino antes de a tela chegar.
  window.__ida = (ag, id) => { window.__idas.push([ag, id]); if (window.__sumirNoDestino) window.__q2.tarefas = []; t.sincronizar({ chave: "c-" + ag, nome: nomes[ag], agenteId: ag }); t.abrirTarefa(ag, id); return true; };
};
// Revisão 5 do PR #623: como no boot do app, a conversa já está à vista, mas o quadro ainda não está liberado (as
// preferências chegam depois da frota): o sincronizar vem com chave nula.
window.__montarSemFlag = () => {
  document.getElementById("timeline").innerHTML = "<p>conversa</p>";
  document.getElementById("composer").innerHTML = "<textarea></textarea>";
  const t = criarQuadroNaTela(document, { reduzido: () => true, dados: { api: () => api, agente: (id) => (nomes[id] ? { avatar: "", nome: nomes[id] } : null), hora: () => "10:00", recolherEm: 60_000, juntarEm: 10,
    agentes: () => [{ id: "a", nome: "Ada" }, { id: "c", nome: "Caio" }],
    naUrl: (codigo) => urls.push(codigo) } });
  t.sincronizar({ chave: null, nome: "Ada", agenteId: null });
  window.__q = t;
};
`;

async function pagina(dir: string): Promise<string> {
  const js = await build({ stdin: { contents: ENTRADA, resolveDir: RAIZ.pathname, loader: "ts" }, bundle: true, format: "iife", write: false, logLevel: "silent" });
  let html = readFileSync(new URL("web/index.html", RAIZ), "utf8");
  html = html.replace(/<link rel="stylesheet" href="\/([\w-]+\.css)" \/>/g, (_, f: string) => `<style>${readFileSync(new URL(`web/${f}`, RAIZ), "utf8")}</style>`);
  html = html.replace(/<script type="module" src="\/main.ts"><\/script>/, () => `<script>${js.outputFiles[0]!.text}</script>`);
  const arq = join(dir, "tarefa.html");
  writeFileSync(arq, html);
  return pathToFileURL(arq).href;
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

descrever("NOD-416 no Chrome real: criar, abrir pelo link, mudar status e responsável, mudar de quadro", () => {
  let cdp: Cdp;
  let dir: string;
  let url: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "nod416-"));
    url = await pagina(dir);
    process.env.CARGA_CHROME = chrome!;
    ({ cdp } = await abrirChrome(9000 + (process.pid % 400), join(dir, "perfil")));
    await cdp.enviar("Page.enable");
  }, 120_000);
  afterAll(() => { cdp?.fechar(); rmSync(dir, { recursive: true, force: true }); });

  const ate = async (expr: string, ms = 5000): Promise<void> => {
    for (let i = 0; i < ms / 50; i++) { if (await avaliar<boolean>(cdp, `!!(${expr})`)) return; await esperar(50); }
    throw new Error(`não chegou: ${expr}`);
  };
  const texto = (sel: string) => avaliar<string>(cdp, `document.querySelector(${JSON.stringify(sel)})?.textContent ?? ""`);
  const chamadas = () => avaliar<unknown[][]>(cdp, "window.__chamadas");
  const tecla = async (key: string, code: string, keyCode: number): Promise<void> => {
    for (const type of ["rawKeyDown", "keyUp"]) await cdp.enviar("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
  };
  const mudancas = async () => (await chamadas()).filter((c) => c[0] === "mudar").map((c) => c[2]);
  const escolher = (sel: string, valor: string) => avaliar(cdp, `(() => { const s = document.querySelector(${JSON.stringify(sel)}); s.value = ${JSON.stringify(valor)}; s.dispatchEvent(new Event("change", { bubbles: true })); })()`);

  it("a jornada da tarefa pela tela", async () => {
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.enviar("Page.navigate", { url });
    await ate("window.__montar");
    await avaliar(cdp, "window.__montar()");
    // NOD-460: o "+" do Backlog abre o campo no topo da coluna, com o foco nele.
    const mais = `#quadro .qd-so-largo [data-act="col-nova-tarefa"][data-status="backlog"]`;
    // O Backlog vazio começa recolhido (tira, sem "+"): abre a coluna antes.
    await ate(`document.querySelector('#quadro .qd-so-largo [data-act="abrir-coluna"][data-status="backlog"]')`);
    if (!(await avaliar<boolean>(cdp, `!!document.querySelector('${mais}')`))) await avaliar(cdp, `document.querySelector('#quadro .qd-so-largo [data-act="abrir-coluna"][data-status="backlog"]').click()`);
    await ate(`document.querySelector('${mais}')`);
    await avaliar(cdp, `document.querySelector('${mais}').click()`);
    await ate(`document.activeElement?.id === "qd-nova-grade-backlog"`);

    // Cai no Backlog, com o código do quadro, o título e o responsável; o campo fica aberto e limpo para a próxima.
    await avaliar(cdp, `document.querySelector("#qd-nova-grade-backlog").value = "Revisar a copy"`);
    await avaliar(cdp, `document.querySelector('#quadro [data-form="nova-tarefa"]').requestSubmit()`);
    await ate(`document.querySelector('#quadro .qd-so-largo [data-act="abrir-tarefa"][data-id="t1"]')`);
    expect((await chamadas())[0]).toEqual(["criar", { titulo: "Revisar a copy", status: "backlog" }]);
    const card = await avaliar<string>(cdp, `document.querySelector('#quadro .qd-so-largo [data-act="abrir-tarefa"][data-id="t1"]').closest(".qd-col").textContent`);
    expect(card).toContain("Backlog");
    expect(card).toContain("ADA-1");
    expect(card).toContain("Revisar a copy");
    expect(card).toContain("Ada");
    expect(await avaliar<string>(cdp, `document.querySelector("#qd-nova-grade-backlog").value`)).toBe("");
    // Esc fecha o campo e o foco volta ao "+".
    await tecla("Escape", "Escape", 27);
    await ate(`!document.querySelector("#qd-nova-grade-backlog") && document.activeElement?.matches('${mais}')`);
    // Revisão 2 do PR #623: o recibo vem da resposta (a coluna onde caiu e quem começou), não de um "no Backlog" fixo.
    expect(await texto("#qc-faixa")).toContain("Revisar a copy: em Backlog. Ninguém começou.");

    // O link: a tarefa abre em tela cheia, o código vai para a URL e o histórico carrega.
    await avaliar(cdp, `window.__q.abrirTarefa("a", "t1")`);
    await ate(`document.querySelector("#quadro .qd-tarefa .qd-id")`);
    expect(await texto("#quadro .qd-tarefa .qd-id")).toBe("ADA-1");
    expect(await avaliar<unknown[]>(cdp, "window.__urls")).toEqual(["ADA-1"]);
    await ate(`/criou em Backlog/.test(document.querySelector("#quadro .qd-hist")?.textContent ?? "")`);
    expect(await texto("#quadro .qd-branch")).toBe("ada-1-revisar-a-copy");

    // Status pelo teclado (WCAG 3.2.2): a seta troca o valor no select fechado, mas nada sai até o Enter.
    await avaliar(cdp, `document.querySelector("#qd-t-status").focus()`);
    await tecla("ArrowDown", "ArrowDown", 40);
    expect(await avaliar<string>(cdp, `document.querySelector("#qd-t-status").value`)).toBe("afazer");
    await esperar(300);
    expect(await mudancas()).toEqual([]);
    await tecla("Enter", "Enter", 13);
    await ate(`window.__chamadas.some((c) => c[0] === "mudar" && c[2].status === "afazer")`);
    await ate(`/Status: Backlog → A fazer/.test(document.querySelector("#quadro .qd-hist")?.textContent ?? "")`);
    expect(await texto("#quadro .qd-hist")).toContain("Você");
    // A fazer com responsável: o bot começou. O recibo diz quem, com o Desfazer do lote.
    expect(await texto("#qc-faixa")).toContain("Ada começou");
    expect(await avaliar<boolean>(cdp, `!!document.querySelector('#qc-faixa [data-act="qc-desfazer"]')`)).toBe(true);

    // Responsável pelo teclado: a seta só escolhe; sair do campo aplica. Na tarefa em A fazer, Caio começa.
    await avaliar(cdp, `document.querySelector("#qd-t-resp").focus()`);
    await tecla("ArrowDown", "ArrowDown", 40);
    expect(await avaliar<string>(cdp, `document.querySelector("#qd-t-resp").value`)).toBe("c");
    await esperar(300);
    expect(await mudancas()).toEqual([{ status: "afazer" }]);
    await avaliar(cdp, `document.querySelector("#qd-t-tit").focus()`);
    await ate(`/Responsável: Ada → Caio/.test(document.querySelector("#quadro .qd-hist")?.textContent ?? "")`);
    expect(await mudancas()).toEqual([{ status: "afazer" }, { agente: "c" }]);
    expect(await texto("#qc-faixa")).toContain("Caio começou");

    // Com o mouse (a escolha no popup): vale na hora. Backlog não começa ninguém: o recibo de sempre.
    await escolher("#qd-t-status", "backlog");
    await ate(`window.__chamadas.filter((c) => c[0] === "mudar").length === 3`);
    await ate(`/Revisar a copy: Backlog/.test(document.querySelector("#qc-faixa")?.textContent ?? "")`);
    expect(await texto("#qc-faixa")).not.toContain("começou");
    // "Precisa de você" não está no Status (pede pergunta).
    expect(await avaliar<boolean>(cdp, `!document.querySelector('#qd-t-status option[value="voce"]')`)).toBe(true);

    // Revisão 6 do PR #623: a região viva já está no rodapé, vazia, antes de qualquer anúncio (criada junto com o texto,
    // nem todo leitor de tela a lê).
    expect(await avaliar<string | null>(cdp, `document.querySelector("#quadro > .qc-wrap > .qd-anuncio[role=status][aria-live=polite]")?.textContent ?? null`)).toBe("");
    // Mover para: escolher não move; o botão Mover (desligado até a escolha) confirma.
    await ate(`document.querySelector('#qd-t-mover option[value="q2"]')`);
    expect(await avaliar<boolean>(cdp, `!document.querySelector('#qd-t-mover option[value="q1"]')`)).toBe(true);
    expect(await avaliar<boolean>(cdp, `document.querySelector('[data-act="mover-quadro"]').disabled`)).toBe(true);
    await escolher("#qd-t-mover", "q2");
    await esperar(300);
    expect((await chamadas()).some((c) => c[0] === "mover")).toBe(false);
    expect(await avaliar<boolean>(cdp, `document.querySelector('[data-act="mover-quadro"]').disabled`)).toBe(false);
    // O primeiro perde a corrida: a faixa diz o porquê do servidor (não "Não deu" genérico) e a tarefa segue aberta.
    await avaliar(cdp, `document.querySelector('[data-act="mover-quadro"]').click()`);
    await ate(`/outra mudança levou a tarefa/.test(document.querySelector("#qc-faixa")?.textContent ?? "")`);
    expect(await texto("#qc-faixa")).toContain("Não deu para mudar a tarefa de quadro: outra mudança levou a tarefa para outro quadro antes. Relendo.");
    expect(await avaliar<boolean>(cdp, `!!document.querySelector("#quadro .qd-tarefa")`)).toBe(true);
    await ate(`document.querySelector('#qd-t-mover option[value="q2"]')`);
    await escolher("#qd-t-mover", "q2");
    await ate(`!document.querySelector('[data-act="mover-quadro"]').disabled`);
    await avaliar(cdp, `document.querySelector('[data-act="mover-quadro"]').click()`);
    await ate(`!document.querySelector("#quadro .qd-tarefa") && window.__chamadas.filter((c) => c[0] === "mover").length === 2`);
    const ch = await chamadas();
    expect(ch.filter((c) => c[0] === "mover")).toEqual([["mover", "t1", "q2"], ["mover", "t1", "q2"]]);
    expect(ch.some((c) => c[0] === "confirmar")).toBe(false);
    expect(await texto("#qc-faixa")).toContain("como CA-1 (ADA-1 continua abrindo)");
    // Revisão 5 do PR #623 (a11y): a tarefa saiu da tela; o foco vai para o quadro, e o leitor de tela ouve para onde foi.
    await ate(`document.querySelector("#quadro .qd-conteudo")?.contains(document.activeElement)`);
    // O texto entra no quadro de animação seguinte, na mesma região que já existia.
    await ate(`/foi para o quadro de Caio/.test(document.querySelector("#quadro > .qc-wrap > .qd-anuncio")?.textContent ?? "")`);
    expect(await avaliar<number>(cdp, `document.querySelectorAll("#quadro .qd-anuncio").length`)).toBe(1);
    expect(await texto("#quadro .qd-sr[role=status]")).toContain("Revisar a copy foi para o quadro de Caio como CA-1");
    expect((await avaliar<unknown[]>(cdp, "window.__urls")).at(-1)).toBeNull();
    expect(await avaliar<boolean>(cdp, `!document.querySelector('#quadro [data-id="t1"]')`)).toBe(true);
  }, 60_000);

  it("revisão 7 do PR #623: o Status da tarefa aberta numa coluna com responsável pede o mesmo \"Confirmar · Não iniciar ainda\" do card", async () => {
    await cdp.enviar("Page.navigate", { url });
    await ate("window.__montar");
    await avaliar(cdp, "window.__comPassagem()");
    await avaliar(cdp, `window.__api.criarTarefa("a", { titulo: "Passa" })`);
    await avaliar(cdp, "window.__montar()");
    await ate(`document.querySelector('#quadro [data-act="abrir-tarefa"][data-id="t1"]')`);
    await avaliar(cdp, `window.__q.abrirTarefa("a", "t1")`);
    await ate(`document.querySelector("#qd-t-status")`);
    // Escolher Em revisão não manda nada: a linha do card solto aparece sob o Status, com o foco no Confirmar.
    await escolher("#qd-t-status", "revisao");
    await ate(`document.querySelector("#quadro .qd-t-soltar .qd-soltar")`);
    expect(await texto("#quadro .qd-t-soltar")).toContain("Caio começa agora.");
    expect(await avaliar<string>(cdp, `document.activeElement?.dataset?.act ?? ""`)).toBe("col-soltar");
    await esperar(200);
    expect(await mudancas()).toEqual([]);
    // Esc desiste: a linha some, o Status volta ao Backlog e o foco volta a ele.
    await tecla("Escape", "Escape", 27);
    await ate(`!document.querySelector("#quadro .qd-t-soltar")`);
    expect(await avaliar<string>(cdp, `document.querySelector("#qd-t-status").value`)).toBe("backlog");
    expect(await avaliar<string>(cdp, "document.activeElement?.id ?? ''")).toBe("qd-t-status");
    expect(await mudancas()).toEqual([]);
    // "Não iniciar ainda": muda e passa sem acionar (sem_iniciar), e o recibo diz "passa para".
    await escolher("#qd-t-status", "revisao");
    await ate(`document.querySelector('#quadro .qd-t-soltar [data-act="col-soltar-sem"]')`);
    await avaliar(cdp, `document.querySelector('#quadro .qd-t-soltar [data-act="col-soltar-sem"]').click()`);
    await ate(`window.__chamadas.some((c) => c[0] === "mudar")`);
    expect(await mudancas()).toEqual([{ status: "revisao", sem_iniciar: true }]);
    await ate(`/passa para Caio/.test(document.querySelector("#qc-faixa")?.textContent ?? "")`);
    await ate(`!document.querySelector("#quadro .qd-t-soltar") && document.querySelector("#qd-t-status").value === "revisao"`);
    // De volta ao Backlog (sem responsável: direto) e de novo a Em revisão, agora Confirmar: muda sem sem_iniciar.
    await escolher("#qd-t-status", "backlog");
    await ate(`window.__chamadas.filter((c) => c[0] === "mudar").length === 2`);
    await ate(`document.querySelector("#qd-t-status").value === "backlog"`);
    await escolher("#qd-t-status", "revisao");
    await ate(`document.querySelector('#quadro .qd-t-soltar [data-act="col-soltar"]')`);
    await avaliar(cdp, `document.querySelector('#quadro .qd-t-soltar [data-act="col-soltar"]').click()`);
    await ate(`window.__chamadas.filter((c) => c[0] === "mudar").length === 3`);
    expect((await mudancas()).at(-1)).toEqual({ status: "revisao" });
    await ate(`/Caio começa/.test(document.querySelector("#qc-faixa")?.textContent ?? "")`);
  }, 30_000);

  it("revisão 5 do PR #623: com uma mudança no ar, a outra é descartada e o select volta ao valor de verdade", async () => {
    await cdp.enviar("Page.navigate", { url });
    await ate("window.__montar");
    await avaliar(cdp, `window.__api.criarTarefa("a", { titulo: "Trava" })`);
    await avaliar(cdp, "window.__montar()");
    await ate(`document.querySelector('#quadro [data-act="abrir-tarefa"][data-id="t1"]')`);
    await avaliar(cdp, `window.__q.abrirTarefa("a", "t1")`);
    await ate(`document.querySelector("#qd-t-status")`);
    await avaliar(cdp, "window.__segurarMudancas()");
    await escolher("#qd-t-status", "afazer");
    await ate(`window.__chamadas.some((c) => c[0] === "mudar")`);
    // A segunda escolha chega com a primeira no ar: não sai, e o campo não pode mentir (volta ao Backlog de agora).
    await escolher("#qd-t-resp", "c");
    await ate(`document.querySelector("#qd-t-resp").value === "a"`, 2000);
    expect(await mudancas()).toEqual([{ status: "afazer" }]);
    await avaliar(cdp, "window.__soltar()");
    await ate(`document.querySelector("#qd-t-status").value === "afazer"`);
    expect(await avaliar<string>(cdp, `document.querySelector("#qd-t-resp").value`)).toBe("a");
  }, 30_000);

  it("NOD-460: o Exibir guardado no servidor vale ao abrir, e mudar grava só o deste quadro (a falha avisa e a tela fica com o novo)", async () => {
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.enviar("Page.navigate", { url });
    await ate("window.__montar");
    await avaliar(cdp, `window.__exibirGuardado = { q1: { recolhidas: false, compacto: true }, q2: { recolhidas: true, compacto: false } }`);
    await avaliar(cdp, `window.__api.criarTarefa("a", { titulo: "Uma", status: "afazer" })`);
    await avaliar(cdp, "window.__montar()");
    // Compacto e sem as colunas recolhidas (o Backlog vazio nasce recolhido: some).
    await ate(`document.querySelector("#quadro .qd-compacto")`);
    expect(await avaliar<boolean>(cdp, `!document.querySelector('#quadro .qd-so-largo [data-act="abrir-coluna"][data-status="backlog"]')`)).toBe(true);
    await avaliar(cdp, `document.querySelector('#quadro [data-act="exibir-abrir"]').click()`);
    await ate(`document.querySelector('#qd-menu-exibir [data-chave="compacto"]')`);
    await avaliar(cdp, `document.querySelector('#qd-menu-exibir [data-chave="compacto"]').click()`);
    await ate(`!document.querySelector("#quadro .qd-compacto")`);
    await ate(`window.__chamadas.some((c) => c[0] === "exibir")`);
    expect((await chamadas()).filter((c) => c[0] === "exibir")).toEqual([["exibir", "q1", { recolhidas: false, compacto: false }]]);
    // O servidor recusa: a faixa avisa, e a tela fica com o que a pessoa escolheu.
    await avaliar(cdp, "window.__exibirFalha = true");
    await avaliar(cdp, `document.querySelector('#qd-menu-exibir [data-chave="recolhidas"]').click()`);
    await ate(`document.querySelector("#qc-faixa")?.textContent.includes("Não consegui guardar o Exibir")`);
    await ate(`document.querySelector('#quadro .qd-so-largo [data-act="abrir-coluna"][data-status="backlog"]')`);
    await avaliar(cdp, "window.__exibirFalha = false; window.__exibirGuardado = null");
  }, 30_000);

  it("revisão do PR #645: Enter duplo cria uma tarefa só, a busca espera a composição (IME), clicar num chip com o Exibir aberto filtra, e as setas andam no menu", async () => {
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.enviar("Page.navigate", { url });
    await ate("window.__montar");
    await avaliar(cdp, `window.__api.criarTarefa("a", { titulo: "Uma", status: "afazer" })`);
    await avaliar(cdp, "window.__chamadas.length = 0");
    await avaliar(cdp, "window.__montar()");
    const mais = `#quadro .qd-so-largo [data-act="col-nova-tarefa"][data-status="afazer"]`;
    await ate(`document.querySelector('${mais}')`);
    await avaliar(cdp, `document.querySelector('${mais}').click()`);
    await ate(`document.activeElement?.id === "qd-nova-grade-afazer"`);
    // Enter duplo com a criação no ar: uma chamada só.
    await avaliar(cdp, `window.__soltarCriar = null; window.__segurarCriar = new Promise((r) => { window.__soltarCriar = r; }); 0`);
    await avaliar(cdp, `document.querySelector("#qd-nova-grade-afazer").value = "Dupla"`);
    await avaliar(cdp, `document.querySelector('#quadro [data-form="nova-tarefa"]').requestSubmit()`);
    await avaliar(cdp, `document.querySelector('#quadro [data-form="nova-tarefa"]')?.requestSubmit()`);
    await avaliar(cdp, "window.__soltarCriar(); window.__segurarCriar = null");
    await ate(`[...document.querySelectorAll('#quadro .qd-so-largo [data-act="abrir-tarefa"]')].some((b) => b.textContent.includes("Dupla"))`);
    expect((await chamadas()).filter((c) => c[0] === "criar")).toHaveLength(1);
    // E não mostra um erro que não houve: o campo segue aberto, vazio e sem o aviso.
    await esperar(100);
    expect(await avaliar<boolean>(cdp, `!document.querySelector("#quadro .qd-nova-erro") && document.querySelector("#qd-nova-grade-afazer")?.value === ""`)).toBe(true);
    await tecla("Escape", "Escape", 27);

    // IME: o input no meio da composição não filtra; o compositionend filtra.
    const busca = `document.querySelector("#qd-busca")`;
    await avaliar(cdp, `(() => { const b = ${busca}; b.value = "zz"; b.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true })); })()`);
    await esperar(150);
    expect(await avaliar<boolean>(cdp, `!document.querySelector("#quadro .qd-vazio-1")`)).toBe(true);
    await avaliar(cdp, `${busca}.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "zz" }))`);
    await ate(`document.querySelector("#quadro .qd-vazio-1")?.textContent.includes("zz")`);
    await avaliar(cdp, `document.querySelector('#quadro .qd-vazio-1 [data-act="busca-limpar"]').click()`);
    await ate(`!document.querySelector("#quadro .qd-vazio-1")`);

    // Com o Exibir aberto, o clique no chip não se perde: filtra e fecha o menu.
    await avaliar(cdp, `document.querySelector('#quadro [data-act="exibir-abrir"]').click()`);
    await ate(`document.querySelector("#qd-menu-exibir")`);
    await avaliar(cdp, `document.querySelector('#quadro [data-act="filtro-do-quadro"][data-filtro="agente:a"]').click()`);
    await ate(`document.querySelector('#quadro [data-filtro="agente:a"]')?.getAttribute("aria-pressed") === "true"`);
    expect(await avaliar<boolean>(cdp, `!document.querySelector("#qd-menu-exibir")`)).toBe(true);
    await avaliar(cdp, `document.querySelector('#quadro [data-act="filtro-do-quadro"][data-filtro="todos"]').click()`);

    // Setas, Home e End andam entre os itens do Exibir.
    await avaliar(cdp, `document.querySelector('#quadro [data-act="exibir-abrir"]').click()`);
    await ate(`document.querySelector('#qd-menu-exibir [role="menuitemcheckbox"]')`);
    const itens = `[...document.querySelectorAll('#qd-menu-exibir [role="menuitemcheckbox"]')]`;
    await avaliar(cdp, `${itens}[0].focus()`);
    await tecla("ArrowDown", "ArrowDown", 40);
    expect(await avaliar<boolean>(cdp, `document.activeElement === ${itens}[1]`)).toBe(true);
    await tecla("Home", "Home", 36);
    expect(await avaliar<boolean>(cdp, `document.activeElement === ${itens}[0]`)).toBe(true);
    await tecla("End", "End", 35);
    expect(await avaliar<boolean>(cdp, `document.activeElement === ${itens}.at(-1)`)).toBe(true);
    await tecla("Escape", "Escape", 27);
  }, 30_000);

  it("revisão 5 do PR #623: o link abre a tarefa mesmo quando o quadro é liberado depois (as preferências chegam por último)", async () => {
    await cdp.enviar("Page.navigate", { url });
    await ate("window.__montarSemFlag");
    await avaliar(cdp, `window.__api.criarTarefa("a", { titulo: "Do link" })`);
    await avaliar(cdp, "window.__montarSemFlag()");
    // O main chama abrirTarefa logo depois de navegar para a conversa, ainda sem a flag do quadro.
    await avaliar(cdp, `window.__q.abrirTarefa("a", "t1")`);
    await esperar(100);
    expect(await avaliar<boolean>(cdp, `!document.querySelector("#quadro .qd-tarefa")`)).toBe(true);
    // As preferências chegam: o render sincroniza com o quadro liberado, e o pedido guardado abre a tarefa.
    await avaliar(cdp, `window.__q.sincronizar({ chave: "c1", nome: "Ada", agenteId: "a" })`);
    await ate(`document.querySelector("#quadro .qd-tarefa .qd-id")`);
    expect(await texto("#quadro .qd-tarefa .qd-id")).toBe("ADA-1");
    expect(await avaliar<string>(cdp, "window.__q.modo()")).toBe("quadro");
    expect(await avaliar<unknown[]>(cdp, "window.__urls")).toEqual(["ADA-1"]);
  }, 30_000);

  it("revisão 7 do PR #623: o link de uma tarefa que não está no quadro abre o quadro e anuncia \"Tarefa não encontrada neste quadro.\"", async () => {
    await cdp.enviar("Page.navigate", { url });
    await ate("window.__montarSemFlag");
    await avaliar(cdp, `window.__api.criarTarefa("a", { titulo: "Fica" })`);
    await avaliar(cdp, "window.__montarSemFlag()");
    await avaliar(cdp, `window.__q.abrirTarefa("a", "nao-existe")`);
    await avaliar(cdp, `window.__q.sincronizar({ chave: "c1", nome: "Ada", agenteId: "a" })`);
    await ate(`/Tarefa não encontrada neste quadro\\./.test(document.querySelector("#quadro > .qc-wrap > .qd-anuncio[role=status]")?.textContent ?? "")`);
    expect(await avaliar<string>(cdp, "window.__q.modo()")).toBe("quadro");
    expect(await avaliar<boolean>(cdp, `!document.querySelector("#quadro .qd-tarefa")`)).toBe(true);
    expect(await avaliar<unknown[]>(cdp, "window.__urls")).toEqual([]);
  }, 30_000);

  it("revisão 5 do PR #623: o link guardado é esquecido quando a pessoa vai para outra conversa antes da flag", async () => {
    await cdp.enviar("Page.navigate", { url });
    await ate("window.__montarSemFlag");
    await avaliar(cdp, `window.__api.criarTarefa("a", { titulo: "Do link" })`);
    await avaliar(cdp, "window.__montarSemFlag()");
    await avaliar(cdp, `window.__q.abrirTarefa("a", "t1")`);
    await avaliar(cdp, `window.__q.sincronizar({ chave: "c2", nome: "Caio", agenteId: "c" })`);
    await avaliar(cdp, `window.__q.sincronizar({ chave: "c1", nome: "Ada", agenteId: "a" })`);
    await esperar(200);
    expect(await avaliar<string>(cdp, "window.__q.modo()")).toBe("conversa");
    expect(await avaliar<unknown[]>(cdp, "window.__urls")).toEqual([]);
  }, 30_000);

  it("QA do PR #623 (D4): mover leva a pessoa até a tarefa, aberta no quadro destino com o código novo; o select de destino não corta o nome", async () => {
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.enviar("Page.navigate", { url });
    await ate("window.__montarComIda");
    await avaliar(cdp, "window.__moverDeCara = true");
    await avaliar(cdp, `window.__api.criarTarefa("a", { titulo: "Revisar a copy" })`);
    await avaliar(cdp, "window.__montarComIda()");
    await ate(`document.querySelector('#quadro [data-act="abrir-tarefa"][data-id="t1"]')`);
    await avaliar(cdp, `window.__q.abrirTarefa("a", "t1")`);
    await ate(`document.querySelector('#qd-t-mover option[value="q2"]')`);
    // Item 4: o select tem largura para o nome (não encolhe atrás do botão) e o title diz o nome inteiro.
    const largura = await avaliar<number>(cdp, `document.querySelector("#qd-t-mover").getBoundingClientRect().width`);
    expect(largura).toBeGreaterThanOrEqual(120);
    expect(await avaliar<string>(cdp, `document.querySelector('#qd-t-mover option[value="q2"]').title`)).toBe("Caio (CA)");
    await escolher("#qd-t-mover", "q2");
    expect(await avaliar<string>(cdp, `document.querySelector("#qd-t-mover").title`)).toBe("Caio (CA)");
    await ate(`!document.querySelector('[data-act="mover-quadro"]').disabled`);
    await avaliar(cdp, `document.querySelector('[data-act="mover-quadro"]').click()`);
    // Item 2: a tela vai para o quadro do Caio com a tarefa aberta, o código novo na URL e o aviso de onde ela está.
    await ate(`document.querySelector("#quadro .qd-tarefa .qd-id")?.textContent === "CA-1"`);
    expect(await avaliar<unknown[]>(cdp, "window.__idas")).toEqual([["c", "t1"]]);
    expect((await avaliar<unknown[]>(cdp, "window.__urls")).at(-1)).toBe("CA-1");
    expect(await avaliar<string>(cdp, "window.__q.modo()")).toBe("quadro");
    await ate(`/foi para o quadro de Caio como CA-1/.test(document.querySelector("#qc-faixa")?.textContent ?? "")`);
    await ate(`/foi para o quadro de Caio como CA-1/.test(document.querySelector("#quadro > .qc-wrap > .qd-anuncio")?.textContent ?? "")`);
  }, 30_000);

  it("revisão 8 do PR #623: se a tarefa saiu do destino antes de a tela chegar (corrida), o aviso do mover também é dito, com o \"não encontrada\"", async () => {
    await cdp.enviar("Page.navigate", { url });
    await ate("window.__montarComIda");
    await avaliar(cdp, "window.__moverDeCara = true; window.__sumirNoDestino = true");
    await avaliar(cdp, `window.__api.criarTarefa("a", { titulo: "Revisar a copy" })`);
    await avaliar(cdp, "window.__montarComIda()");
    await ate(`document.querySelector('#quadro [data-act="abrir-tarefa"][data-id="t1"]')`);
    await avaliar(cdp, `window.__q.abrirTarefa("a", "t1")`);
    await ate(`document.querySelector('#qd-t-mover option[value="q2"]')`);
    await escolher("#qd-t-mover", "q2");
    await ate(`!document.querySelector('[data-act="mover-quadro"]').disabled`);
    await avaliar(cdp, `document.querySelector('[data-act="mover-quadro"]').click()`);
    const anuncio = `document.querySelector("#quadro > .qc-wrap > .qd-anuncio[role=status]")?.textContent ?? ""`;
    await ate(`/foi para o quadro de Caio como CA-1.*Tarefa não encontrada neste quadro\\./.test(${anuncio})`);
    await ate(`/foi para o quadro de Caio como CA-1/.test(document.querySelector("#qc-faixa")?.textContent ?? "")`);
    expect(await avaliar<unknown[]>(cdp, "window.__idas")).toEqual([["c", "t1"]]);
    expect(await avaliar<string>(cdp, "window.__q.modo()")).toBe("quadro");
    expect(await avaliar<boolean>(cdp, `!document.querySelector("#quadro .qd-tarefa")`)).toBe(true);
  }, 30_000);
});
