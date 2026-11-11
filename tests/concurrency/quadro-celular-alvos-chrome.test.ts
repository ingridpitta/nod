import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarCatcherDriver } from "../../src/adapters/executor/drivers/catcher.ts";
import { acharChrome } from "../../src/adapters/tela/capturador-cdp.ts";
import type { Agente } from "../../src/contracts/agente.ts";
import type { Conversa } from "../../src/contracts/conversa.ts";
import type { QuadroDto } from "../../src/contracts/quadro.ts";
import type { RunDaTarefa } from "../../src/contracts/quadro-comentarios.ts";
import { abrirChrome, avaliar, type Cdp } from "../../scripts/carga-tela/cdp.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorCompleto, type ServidorCompleto } from "../helpers/servidor-completo.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * 2026-11-11 (PR #725, pontas soltas do celular): no Chrome de verdade a 390×844, com toque e `pointer: coarse`:
 * - o aviso do Backlog (a dica do grupo e o "Parada no Backlog" da tarefa) e a prioridade editável (as barrinhas da linha
 *   e o chip da tarefa) aparecem no celular, com o mesmo código do computador;
 * - todo alvo de toque à vista nas telas do quadro e da tarefa (botões, chips, Repetir/Parar/Ver o trabalho, o chip do
 *   "manda agora", a prioridade) mede pelo menos 44×44;
 * - "Ver o trabalho" diz a máquina onde o run rodou.
 * Sem a web montada (npx vite build) ou sem Chrome, pula, como quadro-celular-chrome.test.ts.
 */

const WEB = join(process.cwd(), "dist/web");
const chrome = existsSync(join(WEB, "index.html")) ? (() => { try { return acharChrome(); } catch { return null; } })() : null;
if (process.env.NOD_QA_EXIGE_CHROME === "1" && !chrome) throw new Error("o CI precisa da web montada (npx vite build) e do Chromium para o e2e dos alvos do celular");

const descrever = chrome ? describeIntegracao : describe.skip;
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ALVO = 44;

/**
 * Os alvos de toque à vista dentro de `raiz` menores que 44×44 (o retângulo do próprio elemento). Fora: o que só o leitor
 * de tela vê (.qd-sr), o que não tem caixa e os links dentro de texto corrido (a exceção "inline" do WCAG 2.5.8).
 */
const MEDIR = (raiz: string) => `(() => {
  const sel = 'button, a[href], select, input:not([type=hidden]), textarea, summary, [role=button], [role=menuitem], [role=menuitemradio], [role=radio]';
  const pequenos = [];
  for (const el of document.querySelectorAll(${JSON.stringify(raiz)} + ' :is(' + sel + ')')) {
    if (el.closest('.qd-sr') || el.classList.contains('qd-sr')) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden') continue;
    const inline = el.tagName === 'A' && el.closest('p, li') && !el.closest('.qd-prop, .ta-run-acoes, .qd-cel-it');
    if (inline) continue;
    if (r.width + 0.5 < ${ALVO} || r.height + 0.5 < ${ALVO}) pequenos.push((el.getAttribute('data-act') || el.className || el.tagName) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' «' + (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30) + '»');
  }
  return pequenos;
})()`;

descrever("celular: aviso do Backlog, prioridade, alvos de 44 px e a máquina em Ver o trabalho (Chrome real, 390×844)", () => {
  let srv: ServidorCompleto;
  let cdp: Cdp;
  let dir: string;
  let agente: Agente;
  const cod: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const agentes: string[] = [];
  const conversas: string[] = [];

  beforeAll(async () => {
    srv = await servidorCompleto({
      env: { NOD_STATIC_DIR: WEB, NOD_QUADROS: "todos", NOD_PRAZO_DECISAO_MS: "86400000" },
      drivers: ({ urlNod }) => [criarCatcherDriver({ urlNod, atrasoMs: 0 })],
    });
    await srv.json("POST", "onboarding/concluir", {});
    await srv.json("PUT", "preferencias", { experimentos: { quadro: true } });
    const r = await srv.json<{ agente: Agente; conversa: Conversa }>("POST", "agentes", { dono: "pessoa", nome: "Alva" });
    agente = r.agente;
    agentes.push(r.agente.id);
    conversas.push(r.conversa.id);
    await srv.json("POST", `agentes/${agente.id}/quadro`, { meta: "Alvos do celular" });
    await srv.json("POST", `agentes/${agente.id}/quadro/tarefas`, { titulo: "Parada no backlog" });
    await srv.json("POST", `agentes/${agente.id}/quadro/tarefas`, { titulo: "Rodou uma vez" });
    let { quadro } = await srv.json<{ quadro: QuadroDto | null }>("GET", `agentes/${agente.id}/quadro`);
    for (const t of quadro!.tarefas) { cod[t.titulo] = t.codigo!; ids[t.titulo] = t.id; }
    await srv.json("PATCH", `agentes/${agente.id}/quadro/tarefas/${ids["Parada no backlog"]}`, { status: "backlog", agente: agente.id, prioridade: "alta" });
    await srv.json("PATCH", `agentes/${agente.id}/quadro/tarefas/${ids["Rodou uma vez"]}`, { status: "afazer", agente: agente.id, prioridade: "urgente" });
    // O catcher roda o trabalho da tarefa de A fazer; a máquina do turno é a desta chave (o Mac do servidor não tem nome).
    let runs: RunDaTarefa[] = [];
    for (let i = 0; i < 300 && !runs.some((x) => x.estado !== "fila" && x.estado !== "rodando"); i++) {
      runs = (await srv.json<{ runs: RunDaTarefa[] }>("GET", `agentes/${agente.id}/quadro/tarefas/${ids["Rodou uma vez"]}/comentarios`)).runs ?? [];
      await espera(100);
    }
    expect(runs.length).toBeGreaterThan(0);
    await srv.db.begin(async (trx) => {
      await trx`select set_config('nod.tenant_id', ${srv.pessoa.tenantId}, true), set_config('nod.pessoa_id', ${srv.pessoa.pessoaId}, true)`;
      const [maq] = await trx<{ id: string }[]>`insert into maquina_tokens (tenant_id, owner_id, nome, prefixo, hash)
        values (${srv.pessoa.tenantId}, ${srv.pessoa.pessoaId}, 'nod-motor-teste', ${randomBytes(4).toString("hex")}, ${randomBytes(32)}) returning id`;
      await trx`update turnos set machine_id = ${maq!.id} where id = ${runs[0]!.turnoId}`;
    });
    ({ quadro } = await srv.json<{ quadro: QuadroDto | null }>("GET", `agentes/${agente.id}/quadro`));
    dir = mkdtempSync(join(tmpdir(), "cel-alvos-"));
    process.env.CARGA_CHROME = chrome!;
    ({ cdp } = await abrirChrome(9650 + (process.pid % 150), join(dir, "perfil")));
    await cdp.enviar("Page.enable");
    await cdp.enviar("Network.enable");
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await cdp.enviar("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await cdp.enviar("Emulation.setEmulatedMedia", { features: [{ name: "hover", value: "none" }, { name: "pointer", value: "coarse" }] });
  }, 120_000);

  afterAll(async () => {
    cdp?.fechar();
    if (dir) rmSync(dir, { recursive: true, force: true });
    if (!srv) return;
    await srv.db.begin(async (trx) => {
      await trx`select set_config('nod.tenant_id', ${srv.pessoa.tenantId}, true), set_config('nod.pessoa_id', ${srv.pessoa.pessoaId}, true)`;
      await trx`update turnos set machine_id = null where tenant_id = ${srv.pessoa.tenantId} and owner_id = ${srv.pessoa.pessoaId}`;
      await trx`delete from maquina_tokens where tenant_id = ${srv.pessoa.tenantId} and owner_id = ${srv.pessoa.pessoaId} and nome = 'nod-motor-teste'`;
    }).catch(() => {});
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
  const json = async <T>(expr: string): Promise<T> => JSON.parse(await avaliar<string>(cdp, `JSON.stringify(${expr})`)) as T;
  const clicar = (sel: string) => avaliar(cdp, `(() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.getClientRects().length) ?? document.querySelector(${JSON.stringify(sel)}); if (!el) throw new Error("não achei ${sel.replace(/"/g, "'")}"); el.click(); return true; })()`);
  /** Com NOD_PRINTS=<pasta>, guarda o print da tela (a prova visual a 390×844). */
  const print = async (nome: string): Promise<void> => {
    const pasta = process.env.NOD_PRINTS;
    if (!pasta) return;
    mkdirSync(pasta, { recursive: true });
    const { data } = await cdp.enviar<{ data: string }>("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(pasta, `${nome}.png`), Buffer.from(data, "base64"));
  };
  const tarefaNaApi = async (titulo: string) => (await srv.json<{ quadro: QuadroDto | null }>("GET", `agentes/${agente.id}/quadro`)).quadro!.tarefas.find((t) => t.titulo === titulo)!;

  async function abrirTarefa(titulo: string): Promise<void> {
    await cdp.enviar("Page.navigate", { url: `${srv.url}/?tarefa=${encodeURIComponent(cod[titulo]!)}` });
    const entrar = `[data-act="entrar"][data-pessoa="${srv.pessoa.pessoaId}"]`;
    await ate(`document.querySelector(${JSON.stringify(entrar)}) || document.querySelector("#quadro .qd-tarefa-cel")`, "a tela de entrar ou a tarefa");
    if (await avaliar<boolean>(cdp, `!!document.querySelector(${JSON.stringify(entrar)})`)) await clicar(entrar);
    await ate(`document.querySelector("#quadro .qd-tarefa-cel")`, `a tarefa ${titulo} no celular`);
    await espera(300);
  }
  async function abrirQuadro(): Promise<void> {
    await abrirTarefa("Parada no backlog");
    await clicar('#quadro [data-act="voltar-ao-quadro"]');
    await ate(`document.querySelector("#quadro .qd-cel .qd-cl")`, "o quadro no celular");
    // O Backlog pode vir recolhido: abre o grupo para a dica e a linha aparecerem.
    if (await avaliar<boolean>(cdp, `document.querySelector('#quadro .qd-cel [data-act="abrir-coluna"][data-status="backlog"]')?.getAttribute("aria-expanded") === "false"`)) {
      await clicar('#quadro .qd-cel [data-act="abrir-coluna"][data-status="backlog"]');
    }
    await ate(`document.querySelector('#quadro .qd-cel [data-tarefa="${ids["Parada no backlog"]}"]')`, "a linha do Backlog");
    await espera(200);
  }

  it("o quadro: a dica do Backlog no grupo, as barrinhas da prioridade na linha abrem o seletor e gravam", async () => {
    await abrirQuadro();
    const m = await json<{ dica: string | null; pri: string | null }>(`(() => {
      const g = document.querySelector('#quadro .qd-cel .qd-cg-cab [data-status="backlog"]').closest('.qd-cg');
      const li = document.querySelector('#quadro .qd-cel [data-tarefa="${ids["Parada no backlog"]}"]');
      return { dica: g.querySelector('.qd-cg-dica')?.textContent ?? null, pri: li.querySelector('.qd-cl-pri [data-act="tarefa-prioridade"]')?.getAttribute('aria-label') ?? null };
    })()`);
    expect(m.dica).toMatch(/^Parada no Backlog: mova para A fazer para começar\.$/);
    expect(m.pri).toBe("Prioridade: Alta. Mudar");
    await print("1-quadro-dica-e-prioridade");
    await clicar(`#quadro .qd-cel [data-tarefa="${ids["Parada no backlog"]}"] [data-act="tarefa-prioridade"]`);
    await ate(`document.querySelector('#quadro .qd-cel .qd-menu-pri [data-valor="baixa"]')`, "o seletor de prioridade na linha");
    await print("2-quadro-seletor-de-prioridade");
    expect(await avaliar<string[]>(cdp, MEDIR("#quadro .qd-cel"))).toEqual([]);
    await clicar('#quadro .qd-cel .qd-menu-pri [data-valor="baixa"]');
    for (let i = 0; i < 100 && (await tarefaNaApi("Parada no backlog")).prioridade !== "baixa"; i++) await espera(100);
    expect((await tarefaNaApi("Parada no backlog")).prioridade).toBe("baixa");
  }, 60_000);

  it("alvos de 44 px no quadro (lista, cabeçalhos, +, topo, folha da visão e do toque longo)", async () => {
    await abrirQuadro();
    expect(await avaliar<string[]>(cdp, MEDIR("#quadro"))).toEqual([]);
    // Os popovers da barra (o funil, a pílula de quem trabalha e as Opções), um de cada vez.
    for (const [act, pop] of [["fil-abrir", "#qm-pop-fil"], ["ativos-abrir", "#qm-pop-ativos"], ["op-abrir", "#qm-pop-op"]] as const) {
      await clicar(`#quadro [data-act="${act}"]`);
      await ate(`document.querySelector('${pop}')`, `o popover ${pop}`);
      expect(await avaliar<string[]>(cdp, MEDIR(pop))).toEqual([]);
      await clicar(`#quadro [data-act="${act}"]`);
      await ate(`!document.querySelector('${pop}')`, `o popover ${pop} fechar`);
    }
    await clicar('#quadro [data-act="cel-visao"]');
    await ate(`document.querySelector("#quadro .qd-cel-folha")`, "a folha da visão");
    expect(await avaliar<string[]>(cdp, MEDIR("#quadro .qd-cel-folha"))).toEqual([]);
    await clicar('#quadro [data-act="cel-visao-escolher"][data-visao="colunas"]');
    await ate(`document.querySelector("#quadro .qd-cel-cols")`, "as colunas");
    await espera(200);
    expect(await avaliar<string[]>(cdp, MEDIR("#quadro .qd-cel-cols"))).toEqual([]);
    await clicar('#quadro [data-act="cel-visao"]');
    await clicar('#quadro [data-act="cel-visao-escolher"][data-visao="lista"]');
    await ate(`document.querySelector("#quadro .qd-cel-lista")`, "a lista de volta");
  }, 60_000);

  it("a tarefa no Backlog: o aviso de parada, o chip de Prioridade abre a folha e grava; alvos de 44 px (com o chip de quem o comentário aciona e o menu dele)", async () => {
    await abrirTarefa("Parada no backlog");
    const m = await json<{ parada: string | null; chip: string | null }>(`({ parada: document.querySelector('#quadro .qd-tarefa-cel .ta-parada')?.textContent ?? null,
      chip: document.querySelector('#quadro .qd-tarefa-cel #qd-t-prioridade')?.getAttribute('aria-label') ?? null })`);
    expect(m.parada).toMatch(/^Parada no Backlog: o responsável só começa quando ela for para A fazer/);
    expect(m.chip).toBe("Prioridade: Baixa");
    await print("3-tarefa-backlog-aviso-e-prioridade");
    expect(await avaliar<string[]>(cdp, MEDIR("#quadro .qd-tarefa-cel"))).toEqual([]);
    await clicar("#quadro #qd-t-prioridade");
    await ate(`document.querySelector('#qd-folha-tarefa [data-folha-acao="prioridade"][data-valor="media"]')`, "a folha da prioridade");
    await print("4-tarefa-folha-da-prioridade");
    expect(await avaliar<string[]>(cdp, MEDIR("#qd-folha-tarefa"))).toEqual([]);
    await clicar('#qd-folha-tarefa [data-folha-acao="prioridade"][data-valor="media"]');
    for (let i = 0; i < 100 && (await tarefaNaApi("Parada no backlog")).prioridade !== "media"; i++) await espera(100);
    expect((await tarefaNaApi("Parada no backlog")).prioridade).toBe("media");
    await ate(`document.querySelector('#quadro #qd-t-prioridade')?.getAttribute('aria-label') === 'Prioridade: Média'`, "o chip com a prioridade nova");
    // Os chips de quem o comentário aciona aparecem ao escrever (a prévia do servidor).
    await avaliar(cdp, `(() => { const ts = [...document.querySelectorAll('#quadro .qd-tarefa-cel .ta-campo textarea.qd-com-in')]; const t = ts[ts.length - 1]; t.focus(); t.value = 'mais um ajuste'; t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await ate(`document.querySelector('#quadro .qd-tarefa-cel .ta-chip')`, "o chip de quem o comentário aciona").catch(async (e) => {
      throw new Error(`${e.message}: ${await avaliar<string>(cdp, `JSON.stringify({ n: document.querySelectorAll('#quadro .qd-tarefa-cel .ta-campo textarea.qd-com-in').length, chips: [...document.querySelectorAll('#quadro .ta-chips')].map((x) => x.outerHTML.slice(0, 300)), ativo: document.activeElement?.className })`)}`);
    });
    await espera(200);
    expect(await avaliar<string[]>(cdp, MEDIR("#quadro .qd-tarefa-cel"))).toEqual([]);
    await clicar('#quadro .qd-tarefa-cel .ta-chip[data-act="chip-menu"]');
    await ate(`document.querySelector('#quadro .qd-tarefa-cel .ta-chip-op')`, "o menu do chip");
    expect(await avaliar<string[]>(cdp, MEDIR("#quadro .qd-tarefa-cel .ta-chip-menu"))).toEqual([]);
    await avaliar(cdp, `(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true; })()`);
  }, 60_000);

  it("a tarefa que rodou: Repetir e Ver o trabalho com 44 px, e Ver o trabalho diz a máquina", async () => {
    await abrirTarefa("Rodou uma vez");
    await ate(`document.querySelector('#quadro .qd-tarefa-cel [data-act="run-ver"]')`, "o bloco do run com Ver o trabalho");
    expect(await avaliar<string[]>(cdp, MEDIR("#quadro .qd-tarefa-cel"))).toEqual([]);
    await clicar('#quadro .qd-tarefa-cel [data-act="run-ver"]');
    await ate(`document.querySelector('#ta-trans')`, "o diálogo Ver o trabalho");
    const det = await avaliar<string>(cdp, `document.querySelector('#ta-trans').textContent`);
    expect(det).toContain("máquina nod-motor-teste");
    await print("5-ver-o-trabalho-com-a-maquina");
    expect(await avaliar<string[]>(cdp, MEDIR("#ta-trans"))).toEqual([]);
  }, 90_000);
});
