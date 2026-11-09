import { spawn, type ChildProcess } from "node:child_process";
import type { TransporteConector } from "../../contracts/conector.ts";
import { classificarFalhaHttp, ehRedirecionamentoRecusado, esperaAntes, lerRetryAfterMs, podeRepetir, prazoDaTentativa, type FalhaHttp } from "../../domain/nova-tentativa.ts";
import { log } from "../../obs/log.ts";
import { ORCAMENTO_CONECTOR_MS } from "../../shared/constantes.ts";
import { CODIGO, interpretar, notificacao, requisicao, type ErroJsonRpc } from "./jsonrpc.ts";
import { lerRespostaHttp, TETO_CATALOGO_MCP_BYTES, TETO_RESPOSTA_MCP_BYTES } from "./resposta-http.ts";
import { criarLineSplitter } from "./line-splitter.ts";
import { BinarioSemSuporte, resolverBinario } from "../executor/plataforma.ts";

/**
 * Cliente MCP do SERVIDOR do nod para os conectores registrados (ADR-013: o env decifrado nunca sai
 * do servidor; core-features §credencial). JSON-RPC 2.0 puro, sem SDK: stdio (spawn + linhas) ou
 * http (POST JSON-RPC; aceita resposta JSON ou SSE de um evento). Uma requisição por vez por cliente
 * (fila serializada) — o CLI também serializa (ADR-013). stderr do conector só vai ao log, em bytes.
 */
export type ConfigClienteMcp = {
  nome: string;
  transporte: TransporteConector;
  comando?: string | null;
  args?: string[];
  url?: string | null;
  env?: Record<string, string>;
  /** definido em 2026-09-16: teto por requisição; a sonda usa PROBE_MS (8 s), a chamada CHAMADA_CONECTOR_MS. */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** Relógio, espera e aleatório da nova tentativa (NOD-157) entram injetados para os testes serem determinísticos. */
  agora?: () => number;
  dormir?: (ms: number) => Promise<void>;
  aleatorio?: () => number;
  /**
   * Orçamento de cada operação (transporte http): tentativas, esperas e páginas cabem nele, e o prazo de cada
   * requisição é cortado ao que sobra. Padrão ORCAMENTO_CONECTOR_MS; null = sem nova tentativa nem corte
   * (o envio de arquivo, que tem prazo próprio de 600 s).
   */
  orcamentoMs?: number | null;
};

export type FerramentaDescoberta = {
  name: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: { readOnlyHint?: boolean } & Record<string, unknown>;
};

export type ResultadoChamadaMcp = { conteudo: string; isError: boolean };

export class ErroTransporteMcp extends Error {
  readonly motivo: "conector_indisponivel" | "timeout_transporte" | "falha_tecnica";
  /** Status HTTP da resposta que falhou (só transporte http): a nova tentativa e o log decidem por ele. */
  readonly status?: number;
  readonly retryAfterMs?: number;
  /**
   * NOD-193: 404 numa requisição que LEVAVA `mcp-session-id`. Pela spec MCP (2025-06-18, Session Management)
   * o servidor encerrou a sessão e não executou o pedido; o cliente abre outra com `initialize` e repete.
   */
  readonly sessaoExpirada?: true;
  constructor(motivo: "conector_indisponivel" | "timeout_transporte" | "falha_tecnica", cause?: unknown, http: { status?: number; retryAfterMs?: number; sessaoExpirada?: true } = {}) {
    super(motivo, { cause });
    this.name = "ErroTransporteMcp";
    this.motivo = motivo;
    if (http.status !== undefined) this.status = http.status;
    if (http.retryAfterMs !== undefined) this.retryAfterMs = http.retryAfterMs;
    if (http.sessaoExpirada) this.sessaoExpirada = true;
  }
}

export type OpcoesChamadaMcp = {
  /** readOnlyHint da ferramenta. Ausente = escrita (o lado seguro: não repete o que pode duplicar efeito). */
  somenteLeitura?: boolean;
};

export interface ClienteMcp {
  iniciar(): Promise<void>;
  listar(): Promise<FerramentaDescoberta[]>;
  chamar(tool: string, args: Record<string, unknown>, opcoes?: OpcoesChamadaMcp): Promise<ResultadoChamadaMcp>;
  fechar(): Promise<void>;
}

/** Só o texto dos blocos `text` entra no contexto (blocos binários viram marca). */
export function textoDoConteudo(result: unknown): ResultadoChamadaMcp {
  const r = (typeof result === "object" && result !== null ? result : {}) as { content?: unknown; isError?: unknown };
  const blocos = Array.isArray(r.content) ? r.content : [];
  const partes: string[] = [];
  for (const b of blocos) {
    const bloco = (typeof b === "object" && b !== null ? b : {}) as { type?: unknown; text?: unknown };
    if (bloco.type === "text" && typeof bloco.text === "string") partes.push(bloco.text);
    else if (typeof bloco.type === "string") partes.push(`[conteúdo ${bloco.type} omitido]`);
  }
  return { conteudo: partes.join("\n"), isError: r.isError === true };
}

export const PROTOCOLO_MCP = "2025-06-18";

type Transporte = {
  /**
   * `prazoMs` corta o timeout desta requisição (só http; o stdio usa sempre o seu). `tetoBytes` (NOD-212, só http):
   * teto da resposta; padrão TETO_RESPOSTA_MCP_BYTES.
   */
  enviar(linha: string, prazoMs?: number, tetoBytes?: number): Promise<{ result?: unknown; error?: ErroJsonRpc } | null>;
  fechar(): Promise<void>;
};

function transporteStdio(cfg: ConfigClienteMcp, timeoutMs: number): Transporte {
  if (!cfg.comando) throw new ErroTransporteMcp("falha_tecnica", "conector stdio sem comando");
  let filho: ChildProcess | null = null;
  const pendentes = new Map<string | number, { resolver(v: { result?: unknown; error?: ErroJsonRpc }): void; rejeitar(e: unknown): void }>();
  const splitter = criarLineSplitter();
  let bytesStderr = 0;

  function garantir(): ChildProcess {
    if (filho && filho.exitCode === null && !filho.killed) return filho;
    // ADA-11 (ADR-147): no Windows o `npx` é um `.cmd`; ele vira node + script pelo PATH do conector, nunca `cmd.exe /c`.
    let alvo: { bin: string; args: string[] } | null;
    try {
      alvo = resolverBinario(cfg.comando ?? "", { env: cfg.env ?? {} });
    } catch (e) {
      throw new ErroTransporteMcp("conector_indisponivel", e instanceof BinarioSemSuporte ? e.message : "comando do conector sem suporte nesta máquina");
    }
    if (alvo === null) throw new ErroTransporteMcp("conector_indisponivel", `comando não encontrado: ${cfg.comando ?? ""}`);
    const p = spawn(alvo.bin, [...alvo.args, ...(cfg.args ?? [])], { env: cfg.env ?? {}, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    p.stdout?.on("data", (chunk: Buffer) => {
      for (const linha of splitter.alimentar(chunk)) {
        const m = interpretar(linha);
        if (m.tipo !== "resposta" || m.id === null) continue;
        const pend = pendentes.get(m.id);
        if (!pend) continue;
        pendentes.delete(m.id);
        pend.resolver({ result: m.result, error: m.error });
      }
    });
    p.stderr?.on("data", (chunk: Buffer) => {
      bytesStderr += chunk.length;
    });
    p.on("exit", (code, signal) => {
      log("aviso", "conector_saiu", { conector: cfg.nome, code, signal, bytes_stderr: bytesStderr });
      for (const [id, pend] of pendentes) {
        pendentes.delete(id);
        pend.rejeitar(new ErroTransporteMcp("conector_indisponivel", `saiu com ${code ?? signal}`));
      }
    });
    p.on("error", (e) => {
      for (const [id, pend] of pendentes) {
        pendentes.delete(id);
        pend.rejeitar(new ErroTransporteMcp("conector_indisponivel", e));
      }
    });
    filho = p;
    return p;
  }

  return {
    enviar(linha) {
      const p = garantir();
      const msg = interpretar(linha);
      const escrever = () =>
        new Promise<void>((res, rej) => {
          if (!p.stdin || p.stdin.destroyed) {
            rej(new ErroTransporteMcp("conector_indisponivel", "stdin fechado"));
            return;
          }
          p.stdin.write(`${linha}\n`, (e) => (e ? rej(new ErroTransporteMcp("conector_indisponivel", e)) : res()));
        });
      if (msg.tipo !== "requisicao") return escrever().then(() => null);
      return new Promise((resolver, rejeitar) => {
        const t = setTimeout(() => {
          pendentes.delete(msg.id);
          rejeitar(new ErroTransporteMcp("timeout_transporte", `${timeoutMs}ms`));
        }, timeoutMs);
        pendentes.set(msg.id, {
          resolver: (v) => {
            clearTimeout(t);
            resolver(v);
          },
          rejeitar: (e) => {
            clearTimeout(t);
            rejeitar(e);
          },
        });
        escrever().catch((e: unknown) => {
          clearTimeout(t);
          pendentes.delete(msg.id);
          rejeitar(e);
        });
      });
    },
    async fechar() {
      const p = filho;
      filho = null;
      if (!p || p.exitCode !== null) return;
      await new Promise<void>((res) => {
        const t = setTimeout(() => {
          p.kill("SIGKILL");
          res();
        }, 2_000);
        p.once("exit", () => {
          clearTimeout(t);
          res();
        });
        p.stdin?.end();
        p.kill("SIGTERM");
      });
    },
  };
}

function transporteHttp(cfg: ConfigClienteMcp, timeoutMs: number): Transporte {
  if (!cfg.url) throw new ErroTransporteMcp("falha_tecnica", "conector http sem url");
  const f = cfg.fetchImpl ?? fetch;
  const url = cfg.url;
  let sessao: string | null = null;
  return {
    async enviar(linha, prazoMs, tetoBytes = TETO_RESPOSTA_MCP_BYTES) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), Math.min(timeoutMs, prazoMs ?? timeoutMs));
      try {
        const cabecalhos: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream", ...(cfg.env ?? {}) };
        const comSessao = sessao;
        if (comSessao) cabecalhos["mcp-session-id"] = comSessao;
        cabecalhos["mcp-protocol-version"] = PROTOCOLO_MCP;
        const r = await f(url, { method: "POST", headers: cabecalhos, redirect: "error", body: linha, signal: ctrl.signal });
        if (r.status === 404 && comSessao !== null) {
          // Sessão encerrada pelo servidor: zera para o próximo initialize ir SEM session id. 404 sem sessão segue abaixo, como erro do pedido.
          if (sessao === comSessao) sessao = null;
          await r.body?.cancel().catch(() => undefined);
          throw new ErroTransporteMcp("conector_indisponivel", "sessao_expirada", { status: 404, sessaoExpirada: true });
        }
        const sid = r.headers.get("mcp-session-id");
        if (sid) sessao = sid;
        if (r.status === 202 || r.status === 204) return null;
        if (!r.ok) {
          // Descarta o corpo do 429/5xx antes da nova tentativa: corpo não lido segura a conexão.
          await r.body?.cancel().catch(() => undefined);
          throw new ErroTransporteMcp("conector_indisponivel", `http ${r.status}`, { status: r.status, retryAfterMs: lerRetryAfterMs(r.headers.get("retry-after"), (cfg.agora ?? Date.now)()) });
        }
        const pedido = interpretar(linha);
        const id = pedido.tipo === "requisicao" ? pedido.id : null;
        const m = await lerRespostaHttp(r, id, tetoBytes);
        if (!m) {
          if (id === null) return null;
          throw new ErroTransporteMcp("falha_tecnica", "resposta não JSON-RPC");
        }
        return { result: m.result, error: m.error };
      } catch (e) {
        if (e instanceof ErroTransporteMcp) throw e;
        if (e instanceof Error && e.name === "AbortError") throw new ErroTransporteMcp("timeout_transporte", e);
        throw new ErroTransporteMcp("conector_indisponivel", e);
      } finally {
        clearTimeout(t);
      }
    },
    async fechar() {
      sessao = null;
    },
  };
}

const RESPOSTA_GRANDE = "resposta_mcp_grande: o resultado passou de 1 MiB e foi descartado. Refaça a chamada pedindo menos itens ou sem o corpo completo (ex.: limite de resultados menor, só metadados).";

export function criarClienteMcp(cfg: ConfigClienteMcp): ClienteMcp {
  const timeoutMs = cfg.timeoutMs ?? 8_000;
  const transporte = cfg.transporte === "stdio" ? transporteStdio(cfg, timeoutMs) : transporteHttp(cfg, timeoutMs);
  let proximoId = 1;
  let fila: Promise<unknown> = Promise.resolve();
  let iniciado = false;

  function serializado<T>(fn: () => Promise<T>): Promise<T> {
    const r = fila.then(fn, fn);
    fila = r.catch(() => undefined);
    return r;
  }

  const agora = cfg.agora ?? Date.now;
  const dormir = cfg.dormir ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const aleatorio = cfg.aleatorio ?? Math.random;
  const orcamentoMs = cfg.transporte === "http" && cfg.orcamentoMs !== null ? (cfg.orcamentoMs ?? ORCAMENTO_CONECTOR_MS) : null;
  const prazo = (inicio: number) => (orcamentoMs === null ? undefined : prazoDaTentativa(timeoutMs, orcamentoMs - (agora() - inicio)));

  /** Uma operação (iniciar, listar, chamar): o orçamento corre desde `inicio` e a sessão se renova no máximo uma vez. */
  type Operacao = { inicio: number; renovou: boolean };
  const operacao = (): Operacao => ({ inicio: agora(), renovou: false });

  /**
   * NOD-193: renova só o 404 de sessão, fora do próprio initialize, uma vez por operação, e só se ainda cabe um
   * prazo inteiro de requisição no orçamento (a mesma folga que a nova tentativa exige). Sem orçamento, sempre cabe.
   */
  function podeRenovar(e: unknown, metodo: string, op: Operacao): boolean {
    if (!(e instanceof ErroTransporteMcp) || e.sessaoExpirada !== true) return false;
    if (metodo === "initialize" || op.renovou) return false;
    return orcamentoMs === null || orcamentoMs - (agora() - op.inicio) >= timeoutMs;
  }

  /** Falha de transporte → entrada da política; só o que é do HTTP e não é erro do protocolo entra. */
  function falhaDe(e: unknown): FalhaHttp | null {
    if (!(e instanceof ErroTransporteMcp)) return null;
    if (e.motivo === "timeout_transporte") return "timeout";
    if (e.status !== undefined) return e.status;
    if (e.motivo !== "conector_indisponivel") return null;
    // Resposta acima do teto não é queda: o conector respondeu.
    if (e.cause instanceof Error && e.cause.message === "resposta_mcp_grande") return null;
    if (ehRedirecionamentoRecusado(e.cause)) return null;
    return "rede";
  }

  /**
   * NOD-157: nova tentativa SÓ no transporte http. Cada tentativa usa um id JSON-RPC novo. A fila é
   * serializada, então a espera segura as outras chamadas do mesmo conector — aceitável porque tudo cabe
   * em ORCAMENTO_CONECTOR_MS (`inicio` é o começo da operação, que o initialize também consome).
   */
  async function pedir(metodo: string, params: unknown, op: Operacao, somenteLeitura: boolean, rotulo = metodo): Promise<unknown> {
    const { inicio } = op;
    // `anterior` é a falha que provocou a tentativa em curso; vira o log `conector_nova_tentativa` quando ela termina.
    let anterior: { status: number | "rede"; espera: number } | null = null;
    let r: Awaited<ReturnType<Transporte["enviar"]>> = null;
    // A tentativa em curso é o reenvio depois de renovar a sessão: o desfecho dela vira `conector_sessao_renovada`.
    let renovada = false;
    const logRenovacao = (desfecho: "recuperou" | "falhou") => {
      if (!renovada) return;
      renovada = false;
      log("info", "conector_sessao_renovada", { conector: cfg.nome, ferramenta: rotulo, desfecho });
    };
    for (let tentativa = 1; ; tentativa++) {
      const campos = (desfecho: string) => ({ conector: cfg.nome, ferramenta: rotulo, status: anterior?.status, tentativa, espera_ms: anterior?.espera, desfecho });
      try {
        // NOD-212: o catálogo (tools/list) tem teto próprio; acima de 1 MiB ele falhava sempre, e a re-sonda repetia a falha.
        r = await transporte.enviar(requisicao(proximoId++, metodo, params), prazo(inicio), metodo === "tools/list" ? TETO_CATALOGO_MCP_BYTES : undefined);
        if (anterior) log("info", "conector_nova_tentativa", campos("recuperou"));
        logRenovacao("recuperou");
        break;
      } catch (e) {
        // NOD-193: antes da política de nova tentativa (lá o 404 continua "pedido"). O servidor não executou o
        // pedido, então vale também para escrita. Repete com id novo; o initialize consome o mesmo orçamento.
        if (podeRenovar(e, metodo, op)) {
          op.renovou = true;
          anterior = null;
          iniciado = false;
          try {
            await iniciarDentro(op);
          } catch (erroInicio) {
            log("info", "conector_sessao_renovada", { conector: cfg.nome, ferramenta: rotulo, desfecho: "falhou" });
            // Erro JSON-RPC do initialize não pode virar "erro da ferramenta" no chamar(): embrulha a causa.
            throw erroInicio instanceof ErroTransporteMcp && erroInicio.motivo === "falha_tecnica" ? new ErroTransporteMcp("falha_tecnica", erroInicio) : erroInicio;
          }
          renovada = true;
          // O reenvio não conta como nova tentativa: a política (máximo de tentativas e espera) recomeça na sessão nova.
          tentativa--;
          continue;
        }
        const falha = orcamentoMs !== null ? falhaDe(e) : null;
        const retryAfterMs = e instanceof ErroTransporteMcp ? e.retryAfterMs : undefined;
        const repetir =
          falha !== null &&
          podeRepetir({
            classe: classificarFalhaHttp(falha),
            ...(typeof falha === "number" ? { status: falha } : {}),
            somenteLeitura,
            tentativa,
            restanteMs: (orcamentoMs ?? 0) - (agora() - inicio),
            prazoMs: timeoutMs,
            ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
          });
        if (anterior) log("aviso", "conector_nova_tentativa", campos(repetir ? "repetindo" : "esgotou"));
        if (!repetir || falha === null || falha === "timeout") {
          logRenovacao("falhou");
          throw e;
        }
        const espera = esperaAntes(tentativa, aleatorio(), retryAfterMs);
        anterior = { status: falha, espera };
        await dormir(espera);
      }
    }
    if (!r) throw new ErroTransporteMcp("falha_tecnica", `sem resposta para ${metodo}`);
    if (r.error) {
      if (r.error.code === CODIGO.methodNotFound) throw new ErroTransporteMcp("falha_tecnica", r.error.message);
      throw new ErroTransporteMcp("falha_tecnica", `${r.error.code} ${r.error.message}`);
    }
    return r.result;
  }

  async function iniciarDentro(op: Operacao): Promise<void> {
    if (iniciado) return;
    await pedir("initialize", { protocolVersion: PROTOCOLO_MCP, capabilities: {}, clientInfo: { name: "nod", version: "0.1.0" } }, op, true);
    await transporte.enviar(notificacao("notifications/initialized"), prazo(op.inicio));
    iniciado = true;
  }

  return {
    iniciar: () => serializado(() => iniciarDentro(operacao())),
    listar: () =>
      serializado(async () => {
        const op = operacao();
        await iniciarDentro(op);
        const ferramentas: FerramentaDescoberta[] = [];
        const vistos = new Set<string>();
        let cursor: string | undefined;
        do {
          // Renovar a sessão repete a página em curso com o mesmo cursor; cursor recusado sobe como erro.
          const r = (await pedir("tools/list", cursor ? { cursor } : undefined, op, true)) as { tools?: unknown; nextCursor?: unknown };
          if (!Array.isArray(r?.tools)) throw new ErroTransporteMcp("falha_tecnica");
          ferramentas.push(...(r.tools as FerramentaDescoberta[]).filter((t) => typeof t?.name === "string"));
          cursor = typeof r.nextCursor === "string" && r.nextCursor !== "" ? r.nextCursor : undefined;
          if (cursor && (vistos.has(cursor) || vistos.size >= 20)) throw new ErroTransporteMcp("falha_tecnica");
          if (cursor) vistos.add(cursor);
        } while (cursor);
        return ferramentas;
      }),
    chamar: (tool, args, opcoes) =>
      serializado(async () => {
        const op = operacao();
        await iniciarDentro(op);
        try {
          return textoDoConteudo(await pedir("tools/call", { name: tool, arguments: args }, op, opcoes?.somenteLeitura === true, tool));
        } catch (e) {
          // Erro JSON-RPC da ferramenta (ex.: -32602) não é queda do conector: volta como isError para o modelo.
          if (e instanceof ErroTransporteMcp && e.motivo === "falha_tecnica" && typeof e.cause === "string" && /^-\d+ /.test(e.cause)) {
            return { conteudo: e.cause, isError: true };
          }
          // Resposta acima do teto (resposta-http) também não é queda: o conector respondeu; o modelo refaz pedindo menos.
          if (e instanceof ErroTransporteMcp && e.cause instanceof Error && e.cause.message === "resposta_mcp_grande") {
            return { conteudo: RESPOSTA_GRANDE, isError: true };
          }
          throw e;
        }
      }),
    fechar: () =>
      serializado(async () => {
        iniciado = false;
        await transporte.fechar();
      }),
  };
}
