import type { IncomingMessage } from "node:http";
import type { FrameSse } from "../../contracts/frame.ts";
import { metricas as registroPadrao, type Metricas } from "../../obs/metricas.ts";
import { interpretarSince, type Barramento, type Retomada, type Since } from "../../services/barramento.ts";
import type { Ctx } from "./roteador.ts";

/**
 * Canal servidor→NAVEGADOR (ADR-016): SSE, e só nesta direção — a ponte servidor↔máquina não usa
 * SSE. O handler do `GET /api/t/:tenantId/eventos` lê o escopo da sessão (o cookie decide a pessoa,
 * então a sessão de ana nunca recebe frame de marlon), aplica o contrato de resume do barramento e
 * fica inscrito até o navegador fechar. Cada conexão aberta conta em `polls_abertos` por pessoa.
 */

/** definido em 2026-09-16: retry do EventSource nativo; o cliente do nod faz o próprio backoff com jitter. */
export const RETRY_MS = 3_000;
/**
 * definido em 2026-09-16: ping a cada 15 s mantém proxies e o Vite sem cortar a conexão ociosa.
 * definido em 2026-10-15 (NOD-254): evento `ping` nomeado, não comentário: o EventSource descarta comentário e o cliente
 * precisa ver o sinal para medir o silêncio (vigia de 45 s em web/lib/live-events.ts). Sem `id:`: não mexe no
 * `lastEventId` nem no contrato de resume, não gasta `seq` nem buffer.
 */
export const PING_MS = 15_000;

/** O bloco do ping, sem `id:` (ver PING_MS). */
export const PING_SSE = "event: ping\ndata: {}\n\n";

export function serializarFrame(frame: FrameSse): string {
  return `id: ${frame.streamId}:${frame.seq}\nevent: ${frame.tipo}\ndata: ${JSON.stringify(frame)}\n\n`;
}

/** O frame `resumed` tem a forma de FrameSse (o cliente parseia tudo igual) e carrega o id da cabeça do stream. */
export function frameDeRetomada(pessoaId: string, r: Retomada): FrameSse {
  return { streamId: r.streamId, seq: r.seq, pessoaId, tipo: "resumed", dados: { resumed: r.resumed } };
}

/** `Last-Event-ID` (reconexão automática do EventSource) ou `?since=` (reconexão manual do cliente do nod). */
export function lerSince(req: IncomingMessage): Since | null {
  const cabecalho = req.headers["last-event-id"];
  const doCabecalho = interpretarSince(Array.isArray(cabecalho) ? cabecalho[0] : cabecalho);
  if (doCabecalho) return doCabecalho;
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  return interpretarSince(url.searchParams.get("since"));
}

/**
 * definido em 2026-10-22 (NOD-218, deploy azul/verde): as conexões SSE abertas deste processo. Na drenagem,
 * `recusarNovas()` faz o `/eventos` responder 503 `{codigo:"drenando"}` (o EventSource tenta de novo em `retry` e o Caddy
 * já manda para a cor nova) e `encerrarTodas()` fecha as abertas — o navegador reconecta com `Last-Event-ID` na outra
 * cor, que retoma pelo outbox (ADR-016). Sem isto, cada aba seguraria a cor velha até o `docker stop` vencer.
 */
export type ConexoesSse = {
  abertas(): number;
  recusarNovas(): void;
  recusando(): boolean;
  encerrarTodas(): void;
  /** Uso interno do handler. */
  registrar(res: { end(): void }): () => void;
};

export function criarConexoesSse(): ConexoesSse {
  const vivas = new Set<{ end(): void }>();
  let recusando = false;
  return {
    abertas: () => vivas.size,
    recusarNovas() {
      recusando = true;
    },
    recusando: () => recusando,
    encerrarTodas() {
      for (const r of [...vivas]) r.end();
      vivas.clear();
    },
    registrar(res) {
      vivas.add(res);
      return () => vivas.delete(res);
    },
  };
}

export interface OpcoesSse {
  metricas?: Metricas;
  conexoes?: ConexoesSse;
  pingMs?: number;
  retryMs?: number;
}

export function criarHandlerSse(barramento: Barramento, opcoes: OpcoesSse = {}): (ctx: Ctx) => Promise<void> {
  const metricas = opcoes.metricas ?? registroPadrao;
  const pingMs = opcoes.pingMs ?? PING_MS;
  const retryMs = opcoes.retryMs ?? RETRY_MS;
  const abertos = new Map<string, number>();

  const contar = (tenantId: string, pessoaId: string, delta: number): void => {
    const chave = `${tenantId}:${pessoaId}`;
    const n = Math.max(0, (abertos.get(chave) ?? 0) + delta);
    if (n === 0) abertos.delete(chave);
    else abertos.set(chave, n);
    metricas.registrar({ metrica: "polls_abertos", tenant_id: tenantId, pessoa_id: pessoaId }, n);
  };

  return async (ctx) => {
    const { req, res, escopo } = ctx;
    if (opcoes.conexoes?.recusando()) {
      ctx.json(503, { codigo: "drenando", mensagem: "servidor trocando de versão; tente de novo" });
      return;
    }
    const since = lerSince(req);
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    res.write(`retry: ${retryMs}\n\n`);

    const escrever = (frame: FrameSse): void => {
      if (!res.writableEnded && !res.destroyed) res.write(serializarFrame(frame));
    };

    // retomar e inscrever são síncronos no mesmo tick: nenhum frame cabe entre os dois (sem furo, sem duplicata).
    const retomada = barramento.retomar(escopo.pessoaId, since);
    if (retomada.resumed) for (const f of retomada.frames) escrever(f);
    escrever(frameDeRetomada(escopo.pessoaId, retomada));
    const cancelar = barramento.inscrever(escopo.pessoaId, escrever);
    contar(escopo.tenantId, escopo.pessoaId, +1);
    const soltar = opcoes.conexoes?.registrar(res);

    // NOD-345: a cada ping, a sessão é reconferida; revogada (sair, sair das outras, senha nova), o canal fecha e a
    // reconexão do navegador recebe 401.
    const ping = setInterval(() => {
      if (res.writableEnded || res.destroyed) return;
      res.write(PING_SSE);
      void ctx.sessaoAindaVale?.().then((vale) => {
        if (!vale && !res.writableEnded) res.end();
      });
    }, pingMs);
    ping.unref();

    // `res` 'close' numa resposta que nunca termina = a conexão caiu (aba fechada, rede, abort).
    res.on("close", () => {
      cancelar();
      soltar?.();
      clearInterval(ping);
      contar(escopo.tenantId, escopo.pessoaId, -1);
    });
  };
}
