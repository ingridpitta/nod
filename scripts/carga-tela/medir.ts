// Mede a responsividade da web sob carga, num Chrome headless de verdade: tarefas longas, quadros, atraso do laço
// de eventos, a LATÊNCIA DE UMA TECLA no campo de mensagem (o que a pessoa sente) e o perfil de CPU por função.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { abrirChrome, avaliar, type Cdp } from "./cdp.ts";
import { api, botsDeCarga, CONFIG, entrar, escrever, promptStreaming, respostaRica, urlWeb, type Bot, type Sessao } from "./comum.ts";

export const CENARIOS = ["ocioso", "varios-bots", "turno-pesado", "tudo-junto", "frentes"] as const;
export type Cenario = (typeof CENARIOS)[number];

/** Bots escrevendo ao mesmo tempo fora da tela, e quantos pedaços de texto cada um manda. */
const ATIVOS = Number(process.env.CARGA_BOTS_ATIVOS ?? 8);
const DELTAS = Number(process.env.CARGA_DELTAS ?? 160);
/**
 * Chat limpo, PR 7 (QA, 2026-10-18): o lote de frentes da conversa aberta, cada uma narrando e chamando ferramenta, para
 * medir o progresso na fala (web/telas/progresso-na-fala.ts) — quantas vezes a fala inteira é regravada (cada vez perde a
 * seleção de texto nela), quantas só o bloco é trocado no lugar e, com a web instrumentada (medidas `nod:regravar:*` e
 * `nod:progresso`), quanto custa cada uma.
 */
const FRENTES = Number(process.env.CARGA_FRENTES ?? 5);
const CICLOS_DA_FRENTE = Number(process.env.CARGA_CICLOS_FRENTE ?? 12);
/** O turno pesado, na conversa aberta. */
const DELTAS_PESADO = Number(process.env.CARGA_DELTAS_PESADO ?? 600);
const TETO_MS = 150_000;
/** Os itens de primeiro nível da conversa (cada bloco do histórico: um balão, uma linha centralizada, um card), sem a data. */
const ITENS_DA_TIMELINE = "document.querySelectorAll('#timeline-historico > .bloco:not(:has(> .time-sep:only-child))').length";
/**
 * Quanto esperar a aba voltar depois de os turnos terminarem no servidor. medido em 2026-09-30: com o código de
 * antes, o turno pesado na conversa aberta deixou a aba presa por mais de 5 min; passado o teto, o cenário vira
 * "congelada" e os seguintes não rodam (a aba não volta).
 */
const TETO_TELA_MS = Number(process.env.CARGA_TETO_TELA_S ?? 300) * 1000;

// Instalado antes do app: conta os frames do SSE por tipo e mede tarefas longas, quadros e o atraso do laço.
const INSTRUMENTO = `(() => {
  const c = window.__carga = {};
  c.reset = () => { c.frames = {}; c.framesTotal = 0; c.longtasks = []; c.rafGaps = []; c.lags = []; c.falaRegravada = 0; c.blocoTrocado = 0; c.t0 = performance.now(); try { performance.clearMeasures(); } catch {} };
  // O progresso das frentes (chat limpo, PR 7): a fala que sai inteira com o bloco dentro, ou só o bloco trocado no lugar.
  if (typeof MutationObserver === "function") new MutationObserver((ms) => { for (const m of ms) for (const n of m.removedNodes) { if (n.nodeType !== 1) continue; if (n.matches(".progresso")) c.blocoTrocado++; else if (n.querySelector(".progresso")) c.falaRegravada++; } }).observe(document, { childList: true, subtree: true });
  c.reset();
  const add = EventSource.prototype.addEventListener;
  EventSource.prototype.addEventListener = function (tipo, fn, opts) {
    // ping (NOD-254) é sinal de vida a cada 15 s, não frame.
    if (typeof fn !== "function" || tipo === "open" || tipo === "error" || tipo === "ping") return add.call(this, tipo, fn, opts);
    return add.call(this, tipo, function (ev) { c.frames[tipo] = (c.frames[tipo] || 0) + 1; c.framesTotal++; return fn.call(this, ev); }, opts);
  };
  new PerformanceObserver((l) => { for (const e of l.getEntries()) c.longtasks.push({ inicio: e.startTime, dur: e.duration }); }).observe({ type: "longtask", buffered: true });
  let ultimo = 0;
  const quadro = (t) => { if (ultimo) c.rafGaps.push(t - ultimo); ultimo = t; requestAnimationFrame(quadro); };
  requestAnimationFrame(quadro);
  let esperado = performance.now() + 20;
  setInterval(() => { const agora = performance.now(); c.lags.push(Math.max(0, agora - esperado)); esperado = agora + 20; }, 20);
})();`;

type Coleta = { frames: Record<string, number>; framesTotal: number; longtasks: { inicio: number; dur: number }[]; rafGaps: number[]; lags: number[]; falaRegravada: number; blocoTrocado: number; t0: number };

/** O que a web instrumentada mediu (performance.measure "nod:regravar:<historico|ao-vivo>", "nod:progresso"). */
const REGRAVACOES = `(() => { const r = {}; for (const e of performance.getEntriesByType('measure')) { if (!e.name.startsWith('nod:')) continue; const k = e.name.slice(4); const x = r[k] ??= { n: 0, totalMs: 0, maxMs: 0 }; x.n++; x.totalMs += e.duration; x.maxMs = Math.max(x.maxMs, e.duration); } return r; })()`;
type NoPerfil = { id: number; callFrame: { functionName: string; url: string; lineNumber: number }; children?: number[] };
type Perfil = { nodes: NoPerfil[]; samples: number[]; timeDeltas: number[] };

const pct = (xs: number[], p: number): number => {
  if (xs.length === 0) return 0;
  const o = [...xs].sort((a, b) => a - b);
  return o[Math.min(o.length - 1, Math.floor((p / 100) * o.length))] ?? 0;
};
const r1 = (x: number): number => Math.round(x * 10) / 10;
const maximo = (xs: number[]): number => xs.reduce((a, x) => Math.max(a, x), 0);

/** Tempo próprio e inclusivo por função (as 30/40 maiores), a partir das amostras do Profiler. */
function agregarPerfil(p: Perfil) {
  const pai = new Map<number, number>();
  for (const n of p.nodes) for (const f of n.children ?? []) pai.set(f, n.id);
  const porId = new Map(p.nodes.map((n) => [n.id, n]));
  const chave = (n: NoPerfil): string => {
    const url = n.callFrame.url.replace(/^https?:\/\/[^/]+\//, "").replace(/\?.*$/, "");
    return `${n.callFrame.functionName || "(anônima)"} ${url}${url ? `:${n.callFrame.lineNumber + 1}` : ""}`;
  };
  const proprio = new Map<string, number>();
  const inclusivo = new Map<string, number>();
  let total = 0;
  p.samples.forEach((id, i) => {
    const dur = (p.timeDeltas[i + 1] ?? p.timeDeltas[i] ?? 0) / 1000;
    total += dur;
    const n = porId.get(id);
    if (!n) return;
    proprio.set(chave(n), (proprio.get(chave(n)) ?? 0) + dur);
    const vistos = new Set<string>();
    for (let atual: number | undefined = n.id; atual !== undefined; atual = pai.get(atual)) {
      const no = porId.get(atual);
      if (!no) break;
      const k = chave(no);
      if (!vistos.has(k)) inclusivo.set(k, (inclusivo.get(k) ?? 0) + dur);
      vistos.add(k);
    }
  });
  const topo = (m: Map<string, number>, n: number) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([fn, ms]) => ({ fn, ms: Math.round(ms) }));
  return { totalMs: Math.round(total), proprio: topo(proprio, 30), inclusivo: topo(inclusivo, 40) };
}

async function metricas(cdp: Cdp): Promise<Record<string, number>> {
  const r = await cdp.enviar<{ metrics: { name: string; value: number }[] }>("Performance.getMetrics");
  return Object.fromEntries(r.metrics.map((m) => [m.name, m.value]));
}

async function esperarOcioso(s: Sessao, conversas: string[], inicio: number): Promise<number> {
  const pendentes = new Set(conversas);
  while (pendentes.size > 0 && Date.now() - inicio < TETO_MS) {
    await new Promise((r) => setTimeout(r, 700));
    for (const id of [...pendentes]) {
      const c = await api<{ turnosEmCurso?: unknown[] }>(s, "GET", `conversas/${id}/mensagens`);
      if ((c.turnosEmCurso?.length ?? 0) === 0) pendentes.delete(id);
    }
  }
  return Date.now() - inicio;
}

async function disparar(s: Sessao, cenario: Cenario, pesada: Bot, ativos: Bot[]): Promise<string[]> {
  const envios: Promise<unknown>[] = [];
  const conversas: string[] = [];
  if (cenario === "varios-bots" || cenario === "tudo-junto") {
    ativos.forEach((b, k) => {
      conversas.push(b.conversaId);
      envios.push(api(s, "POST", `conversas/${b.conversaId}/mensagens`, { texto: promptStreaming(DELTAS, respostaRica(900 + k), `Carga ${k}`) }));
    });
  }
  if (cenario === "turno-pesado" || cenario === "tudo-junto") {
    conversas.push(pesada.conversaId);
    envios.push(api(s, "POST", `conversas/${pesada.conversaId}/mensagens`, { texto: promptStreaming(DELTAS_PESADO, respostaRica(999), "Turno pesado") }));
  }
  if (cenario === "frentes") {
    // Cada frente narra e chama uma ferramenta por ciclo (a narração recomeça a cada ferramenta, como no Claude).
    const pedido = (i: number): string => Array.from({ length: CICLOS_DA_FRENTE }, (_, k) => `[[delta: Lendo a parte ${k + 1} ]] [[delta: do relatório ${i}. ]] [[tool: ver_colegas {}]] [[espera: 1500]]`).join(" ") + " [[texto: Pronto.]]";
    const frentes = Array.from({ length: FRENTES }, (_, i) => ({ titulo: `Relatório ${i + 1}`, pedido: pedido(i + 1) }));
    conversas.push(pesada.conversaId);
    envios.push(api(s, "POST", `conversas/${pesada.conversaId}/mensagens`, { texto: `Frentes de carga [[tool: abrir_frentes ${JSON.stringify({ frentes })}]] [[texto: Abri ${FRENTES} frentes, uma por relatório.]]` }));
  }
  await Promise.all(envios);
  return conversas;
}

/** Abre a conversa pesada (Carga 01) num Chrome headless e mede cada cenário; grava `<saida>/<rotulo>-<cenario>.json`. */
export async function medir(rotulo: string, cenarios: readonly Cenario[] = CENARIOS): Promise<void> {
  mkdirSync(CONFIG.saida, { recursive: true });
  const s = await entrar();
  const bots = await botsDeCarga(s);
  const pesada = bots[0];
  if (!pesada) throw new Error("sem bots de carga: rode `node scripts/carga-tela/rodar.ts preparar` antes");
  const ativos = bots.slice(1, 1 + ATIVOS);
  const { cdp } = await abrirChrome(CONFIG.cdpPorta, join(CONFIG.saida, "chrome-perfil"));
  try {
    for (const d of ["Page", "Runtime", "Network", "Performance", "Profiler"]) await cdp.enviar(`${d}.enable`);
    // Sem foco emulado, document.hasFocus() é falso e a web não marca nada como lido (ver web/main.ts naFrente).
    await cdp.enviar("Emulation.setFocusEmulationEnabled", { enabled: true });
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    const [nome = "", ...valor] = s.cookie.split("=");
    await cdp.enviar("Network.setCookie", { name: nome, value: valor.join("="), domain: "127.0.0.1", path: "/", httpOnly: true });
    await cdp.enviar("Page.addScriptToEvaluateOnNewDocument", { source: INSTRUMENTO });
    await cdp.enviar("Page.navigate", { url: urlWeb() });
    const linha = `[data-act="abrir-conversa"][data-agente="${pesada.id}"]`;
    for (let i = 0; i < 150 && !(await avaliar<boolean>(cdp, `!!document.querySelector('${linha}')`)); i++) await new Promise((r) => setTimeout(r, 200));
    await avaliar(cdp, `document.querySelector('${linha}').click()`);
    // S10 (definido em 2026-10-07, ADR-083): conta os itens da timeline (balões e linhas centralizadas, um bloco cada), não só
    // `.message` — com o chat limpo, execuções de rotina e pedidos entre bots viram uma linha só e a conta de balões cai.
    for (let i = 0; i < 150 && (await avaliar<number>(cdp, ITENS_DA_TIMELINE)) < 100; i++) await new Promise((r) => setTimeout(r, 200));
    await new Promise((r) => setTimeout(r, 3000));
    const dom = await avaliar<Record<string, number>>(cdp, `({ nos: document.getElementsByTagName('*').length, mascotes: document.querySelectorAll('nod-mascote').length, mensagens: document.querySelectorAll('#timeline .message').length, itens: ${ITENS_DA_TIMELINE} })`);
    escrever(`[${rotulo}] conversa aberta: ${JSON.stringify(dom)}`);

    for (const cenario of cenarios) {
      await avaliar(cdp, "(() => { const t = document.getElementById('composer-texto'); t.value = ''; t.focus(); window.__carga.reset(); return true; })()");
      const antes = await metricas(cdp);
      await cdp.enviar("Profiler.setSamplingInterval", { interval: 500 });
      await cdp.enviar("Profiler.start");
      const inicio = Date.now();
      // Uma tecla a cada 250 ms no campo: o tempo até o Chrome confirmar que a página a tratou é o que a pessoa sente.
      let digitando = true;
      const rtts: number[] = [];
      const digitar = (async () => {
        while (digitando) {
          const t = performance.now();
          await cdp.enviar("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", text: "a", unmodifiedText: "a", windowsVirtualKeyCode: 65 });
          await cdp.enviar("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65 });
          rtts.push(performance.now() - t);
          await new Promise((r) => setTimeout(r, 250));
        }
      })();
      let duracao = 8000;
      if (cenario === "ocioso") await new Promise((r) => setTimeout(r, duracao));
      else {
        duracao = await esperarOcioso(s, await disparar(s, cenario, pesada, ativos), inicio);
        await new Promise((r) => setTimeout(r, 1500));
      }
      digitando = false;
      // A tela "volta" quando o thread principal atende uma avaliação: o atraso acumulado depois do servidor terminar.
      const voltou = await Promise.race([
        (async () => {
          await digitar;
          await avaliar(cdp, "1");
          return true;
        })(),
        new Promise<false>((r) => setTimeout(() => r(false), TETO_TELA_MS)),
      ]);
      if (!voltou) {
        const presa = { rotulo, cenario, duracaoS: r1(duracao / 1000), telaLivreS: null, congeladaAlemDeS: r1((Date.now() - inicio) / 1000), digitacao: { n: rtts.length, p50: r1(pct(rtts, 50)), max: Math.round(maximo(rtts)), teclaPresa: true } };
        writeFileSync(join(CONFIG.saida, `${rotulo}-${cenario}.json`), JSON.stringify(presa, null, 2));
        escrever(`[${rotulo}] ${cenario}: turnos ${presa.duracaoS} s, e a aba continuava congelada ${presa.congeladaAlemDeS} s depois do início (teto); os cenários seguintes não rodam`);
        return;
      }
      const telaLivreS = r1((Date.now() - inicio) / 1000);
      const { profile } = await cdp.enviar<{ profile: Perfil }>("Profiler.stop");
      const depois = await metricas(cdp);
      const c = await avaliar<Coleta>(cdp, "JSON.parse(JSON.stringify(window.__carga))");
      const lt = c.longtasks.filter((x) => x.inicio >= c.t0);
      const janelaS = duracao / 1000;
      const delta = (k: string): number => (depois[k] ?? 0) - (antes[k] ?? 0);
      const resumo = {
        rotulo,
        cenario,
        duracaoS: r1(janelaS),
        telaLivreS,
        frames: c.framesTotal,
        framesPorTipo: c.frames,
        tarefasLongas: { n: lt.length, totalMs: Math.round(lt.reduce((a, x) => a + x.dur, 0)), maxMs: Math.round(maximo(lt.map((x) => x.dur))), tbtMs: Math.round(lt.reduce((a, x) => a + Math.max(0, x.dur - 50), 0)) },
        quadros: { n: c.rafGaps.length + 1, fps: r1((c.rafGaps.length + 1) / janelaS), acima50: c.rafGaps.filter((g) => g > 50).length, acima100: c.rafGaps.filter((g) => g > 100).length, acima250: c.rafGaps.filter((g) => g > 250).length, maxMs: Math.round(maximo(c.rafGaps)) },
        atrasoLaco: { p50: r1(pct(c.lags, 50)), p95: r1(pct(c.lags, 95)), p99: r1(pct(c.lags, 99)), max: Math.round(maximo(c.lags)) },
        digitacao: { n: rtts.length, p50: r1(pct(rtts, 50)), p95: r1(pct(rtts, 95)), max: Math.round(maximo(rtts)) },
        chrome: { tarefaS: r1(delta("TaskDuration")), scriptS: r1(delta("ScriptDuration")), layoutS: r1(delta("LayoutDuration")), estiloS: r1(delta("RecalcStyleDuration")), layouts: delta("LayoutCount"), estilos: delta("RecalcStyleCount"), nos: depois.Nodes, heapMB: r1((depois.JSHeapUsedSize ?? 0) / 1e6) },
        perfil: agregarPerfil(profile),
        dom,
        ...(cenario === "frentes" ? { frentes: { falaRegravada: c.falaRegravada, porMinuto: r1(c.falaRegravada / (janelaS / 60)), blocoTrocado: c.blocoTrocado, regravacoes: await avaliar<Record<string, { n: number; totalMs: number; maxMs: number }>>(cdp, REGRAVACOES) } } : {}),
      };
      writeFileSync(join(CONFIG.saida, `${rotulo}-${cenario}.json`), JSON.stringify(resumo, null, 2));
      escrever(`[${rotulo}] ${cenario}: turnos ${resumo.duracaoS} s, tela livre em ${telaLivreS} s, ${resumo.frames} frames, maior tarefa ${resumo.tarefasLongas.maxMs} ms, TBT ${resumo.tarefasLongas.tbtMs} ms, tecla p50/p95/max ${resumo.digitacao.p50}/${resumo.digitacao.p95}/${resumo.digitacao.max} ms`);
      if (resumo.frentes) escrever(`  frentes: fala regravada ${resumo.frentes.falaRegravada}× (${resumo.frentes.porMinuto}/min; cada uma perde a seleção de texto nela), só o bloco trocado ${resumo.frentes.blocoTrocado}×, regravações ${JSON.stringify(resumo.frentes.regravacoes)}`);
      escrever(`  mais caro (próprio): ${resumo.perfil.proprio.slice(0, 8).map((x) => `${x.ms}ms ${x.fn}`).join(" | ")}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  } finally {
    cdp.fechar();
  }
}
