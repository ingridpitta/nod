import type { MsgCerebroCliente, MsgCerebroServidor } from "../../contracts/voz.ts";
import { log } from "../../obs/log.ts";

/**
 * Cliente do canal do cérebro (definido em 2026-10-04, ADR-071/072): o executor do Mac abre um WebSocket para
 * `/api/interno/voz/v1/cerebro` com o token do turno da ligação — o Mac disca, o servidor nunca disca (ADR-021). Por ele
 * chegam a vez da pessoa, avisos e o pedido de interromper; por ele saem os pedaços da fala do bot.
 *
 * Usa o `WebSocket` global do Node/Electron (undici: aceita `headers` e não manda `Origin`, conferido em 2026-10-04).
 * Queda: tenta religar por até `reconexaoMs`; o servidor segura a ligação nesse intervalo (PRAZOS_PADRAO).
 */
export type CerebroLigacao = {
  enviar(m: MsgCerebroCliente): void;
  aoMensagem(fn: (m: MsgCerebroServidor) => void): void;
  /** O canal caiu de vez (sem religar no prazo) ou o servidor fechou com código de fim. */
  aoFim(fn: (codigo: number) => void): void;
  fechar(): void;
};

type SocketMinimo = {
  readyState: number;
  send(dados: string): void;
  close(codigo?: number, motivo?: string): void;
  addEventListener(tipo: "open" | "message" | "close" | "error", fn: (ev: { data?: unknown; code?: number }) => void): void;
};
export type FabricaSocket = (url: string, headers: Record<string, string>) => SocketMinimo;

const fabricaGlobal: FabricaSocket = (url, headers) => {
  const Ctor: unknown = Reflect.get(globalThis, "WebSocket");
  if (typeof Ctor !== "function") throw new Error("WebSocket global ausente");
  // O WebSocket do undici aceita `headers` como opção (conferido em 2026-10-04); o tipo da DOM não declara.
  return Reflect.construct(Ctor, [url, { headers }]) as SocketMinimo;
};

export function urlDoCerebro(urlNod: string): string {
  const u = new URL("/api/interno/voz/v1/cerebro", urlNod);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  return u.toString();
}

/** Códigos de fechamento que dizem "acabou, não religue" (FECHAMENTOS_VOZ e o fechamento normal). */
const FIM_DEFINITIVO = new Set([1000, 4401, 4404, 4410]);

export function conectarCerebro(p: {
  urlNod: string;
  token: string;
  ligacaoId: string;
  harness: string;
  interrupcao: boolean;
  fabrica?: FabricaSocket;
  reconexaoMs?: number;
  /** Prazo da primeira conexão. */
  prazoMs?: number;
}): Promise<CerebroLigacao> {
  const fabrica = p.fabrica ?? fabricaGlobal;
  const url = urlDoCerebro(p.urlNod);
  const ouvintes: ((m: MsgCerebroServidor) => void)[] = [];
  const aoFimFns: ((codigo: number) => void)[] = [];
  let socket: SocketMinimo | null = null;
  let fechado = false;
  let fila: string[] = [];
  let caiuEm = 0;

  function abrir(primeira: boolean): Promise<void> {
    return new Promise((resolver, rejeitar) => {
      let aberto = false;
      const s = fabrica(url, { Authorization: `Bearer ${p.token}` });
      socket = s;
      const prazo = setTimeout(() => {
        if (!aberto) {
          s.close();
          rejeitar(new Error("cerebro_sem_resposta"));
        }
      }, p.prazoMs ?? 10_000);
      s.addEventListener("open", () => {
        aberto = true;
        clearTimeout(prazo);
        caiuEm = 0;
        s.send(JSON.stringify({ t: "ola", ligacaoId: p.ligacaoId, capacidades: { interrupcao: p.interrupcao, harness: p.harness } } satisfies MsgCerebroCliente));
        for (const f of fila) s.send(f);
        fila = [];
        resolver();
      });
      s.addEventListener("message", (ev) => {
        const texto = typeof ev.data === "string" ? ev.data : ev.data instanceof Buffer ? ev.data.toString("utf8") : "";
        let msg: MsgCerebroServidor | null = null;
        try {
          msg = JSON.parse(texto) as MsgCerebroServidor;
        } catch {
          return;
        }
        if (msg && typeof msg === "object" && typeof msg.t === "string") for (const fn of ouvintes) fn(msg);
      });
      s.addEventListener("error", () => undefined);
      s.addEventListener("close", (ev) => {
        clearTimeout(prazo);
        if (socket !== s) return;
        socket = null;
        const codigo = ev.code ?? 1006;
        if (!aberto && primeira) {
          rejeitar(new Error(`cerebro_recusado_${codigo}`));
          return;
        }
        if (fechado || FIM_DEFINITIVO.has(codigo)) {
          if (!fechado) for (const fn of aoFimFns) fn(codigo);
          return;
        }
        caiuEm ||= Date.now();
        if (Date.now() - caiuEm > (p.reconexaoMs ?? 20_000)) {
          for (const fn of aoFimFns) fn(codigo);
          return;
        }
        log("aviso", "cerebro_religando", { ligacao_id: p.ligacaoId, codigo });
        setTimeout(() => {
          if (!fechado) abrir(false).catch(() => undefined);
        }, 1_000);
      });
    });
  }

  return abrir(true).then(() => ({
    enviar(m) {
      const dados = JSON.stringify(m);
      if (socket && socket.readyState === 1) socket.send(dados);
      else if (!fechado) fila.push(dados);
    },
    aoMensagem(fn) {
      ouvintes.push(fn);
    },
    aoFim(fn) {
      aoFimFns.push(fn);
    },
    fechar() {
      fechado = true;
      socket?.close(1000, "fim");
      socket = null;
    },
  }));
}
