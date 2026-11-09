import {
  idDaThread,
  idDoTurno,
  interpretarLinhaAppServer,
  notificacaoInitialized,
  pedidoInitialize,
  pedidoTurnInterrupt,
  pedidoTurnSteer,
  respostaNegando,
  type EventoAppServer,
  type IdRpc,
} from "../../../domain/codex-app-server.ts";
import { iniciarProcesso, type Processo } from "../processo.ts";

/**
 * Cliente do `codex app-server` (definido em 2026-10-07, ADR-083 §6, decisão S4 da revisão de engenharia): o que o laço
 * de voz (codex-ligacao.ts, ADR-076) e o chat do Codex (codex-chat.ts) têm em comum, extraído do laço de voz sem mudar
 * o comportamento dele. JSON-RPC por linha no stdio: handshake (initialize → initialized → thread/start), pedidos
 * casados com a resposta pelo id, a máquina de estado do turno (livre → iniciando → ativo → livre), o `turn/steer` contra
 * o turno ativo e a recusa de todo pedido do servidor (o nod decide pelo proxy, nunca pelo Codex).
 *
 * NÃO HOMOLOGADO como o resto do app-server (codex-app-server.ts): só exercitado contra tests/fixtures/codex-falso.mjs.
 */
export type RespostaAppServer = Extract<EventoAppServer, { tipo: "resposta" | "resposta_erro" }>;
export type TurnoConcluidoAppServer = Extract<EventoAppServer, { tipo: "turno_concluido" }>;
export type EstadoTurnoAppServer = { estado: "livre" } | { estado: "iniciando" } | { estado: "ativo"; id: string };

export type ClienteAppServer = {
  processo: Processo;
  /** A thread aberta no handshake ("" antes dele). */
  threadId(): string;
  turno(): EstadoTurnoAppServer;
  /** true depois de `fechar()`: nada mais é escrito no stdin. */
  fechando(): boolean;
  enviar(montar: (id: IdRpc) => string, aoResponder?: (r: RespostaAppServer) => void): void;
  pedir(montar: (id: IdRpc) => string): Promise<Record<string, unknown>>;
  /**
   * initialize → initialized → thread/start; lança (com o processo já encerrado) se ele morre ou não responde no prazo.
   * revisto em 2026-10-14 (ADR-103): `antes` roda entre o initialized e a thread (a confiança do hook do nod; lançar
   * derruba a abertura como qualquer falha do handshake), e `reserva` abre outra thread quando a primeira é recusada
   * (o `thread/resume` de uma thread que esta conta não tem vira uma thread nova).
   */
  abrirThread(p: { versaoNod: string; threadStart: (id: IdRpc) => string; prazoMs: number; antes?: () => Promise<void>; reserva?: (id: IdRpc) => string; aoReserva?: (motivo: string) => void }): Promise<void>;
  /**
   * `turn/start`. `aoAbrir(id)` quando o turno abre; `aoAbrir(null)` quando o app-server o recusa. Não chama quando o
   * turno já concluiu antes de a resposta chegar, nem quando uma interrupção foi pedida enquanto ele subia (ele é
   * interrompido na hora).
   */
  iniciarTurno(montar: (id: IdRpc, threadId: string) => string, aoAbrir: (turnId: string | null, r: RespostaAppServer) => void): void;
  /** `turn/steer` no turno ativo (com `expectedTurnId`); `aceito` = o app-server pôs o texto no turno. */
  steer(texto: string, aoResponder: (aceito: boolean) => void): void;
  /** `turn/interrupt` no turno ativo; com `aoAbrir`, um turno que ainda sobe é interrompido assim que abrir. */
  interromperTurno(o?: { aoAbrir?: boolean }): void;
  /** Fecha o stdin (o app-server sai sozinho quando termina o que tem). */
  fechar(): void;
};

export function criarClienteAppServer(o: {
  bin: string;
  args: readonly string[];
  env: Record<string, string>;
  cwd: string;
  sigtermParaSigkillMs?: number;
  /** Notificações (delta, item, uso, erro, ignorado, turno_iniciado): o que cada laço faz com elas é dele. */
  aoEvento(ev: EventoAppServer): void;
  /** O turno atual concluiu (o estado já voltou a `livre`); turno velho ou repetido não chega aqui. */
  aoTurnoConcluido(ev: TurnoConcluidoAppServer): void;
  /** Um pedido do servidor foi negado (só o método, para o log). */
  aoNegado?(metodo: string): void;
}): ClienteAppServer {
  const aguardando = new Map<IdRpc, (r: RespostaAppServer) => void>();
  let proximoId = 1;
  let threadId = "";
  let turno: EstadoTurnoAppServer = { estado: "livre" };
  const encerrados = new Set<string>();
  let fechando = false;
  /** NOD-167: a interrupção dura foi pedida enquanto o turn/start ainda não tinha voltado. */
  let interromperAoAbrir = false;

  const processo = iniciarProcesso({
    bin: o.bin,
    args: o.args,
    env: o.env,
    cwd: o.cwd,
    sigtermParaSigkillMs: o.sigtermParaSigkillMs,
    aoLinha(linha) {
      tratar(interpretarLinhaAppServer(linha));
    },
  });

  const enviar = (montar: (id: IdRpc) => string, aoResponder?: (r: RespostaAppServer) => void) => {
    if (fechando) return;
    const id = proximoId++;
    if (aoResponder) aguardando.set(id, aoResponder);
    processo.escrever(montar(id));
  };
  const pedir = (montar: (id: IdRpc) => string) =>
    new Promise<Record<string, unknown>>((resolver, rejeitar) => {
      enviar(montar, (r) => (r.tipo === "resposta" ? resolver(r.resultado) : rejeitar(new Error(`app_server_erro_${r.codigo ?? "sem_codigo"}`))));
    });

  function tratar(ev: EventoAppServer): void {
    switch (ev.tipo) {
      case "resposta":
      case "resposta_erro": {
        const fn = aguardando.get(ev.id);
        aguardando.delete(ev.id);
        fn?.(ev);
        return;
      }
      case "pedido_servidor":
        // Sem resposta o turno trava; o nod nunca aprova pelo Codex.
        o.aoNegado?.(ev.metodo);
        processo.escrever(respostaNegando(ev.id, ev.metodo));
        return;
      case "turno_concluido": {
        if (ev.turnId) {
          if (encerrados.has(ev.turnId)) return;
          encerrados.add(ev.turnId);
        }
        const atual = turno.estado === "ativo" ? turno.id : null;
        if (ev.turnId && atual && ev.turnId !== atual) return; // turno velho
        turno = { estado: "livre" };
        interromperAoAbrir = false;
        o.aoTurnoConcluido(ev);
        return;
      }
      default:
        // O resto de um turno que já concluiu (o interrompido segue soltando delta) não chega a ninguém.
        if (ev.tipo === "delta" && ev.turnId && encerrados.has(ev.turnId)) return;
        o.aoEvento(ev);
    }
  }

  return {
    processo,
    threadId: () => threadId,
    turno: () => turno,
    fechando: () => fechando,
    enviar,
    pedir,

    async abrirThread(p) {
      let prazo: ReturnType<typeof setTimeout> | null = null;
      try {
        await Promise.race([
          (async () => {
            await pedir((id) => pedidoInitialize(id, { nome: "nod", versao: p.versaoNod }));
            processo.escrever(notificacaoInitialized());
            if (p.antes) await p.antes();
            const r = await pedir(p.threadStart).catch((e: unknown) => {
              if (!p.reserva) throw e;
              p.aoReserva?.(e instanceof Error ? e.message : "recusada");
              return pedir(p.reserva);
            });
            const id = idDaThread(r);
            if (!id) throw new Error("thread_sem_id");
            threadId = id;
          })(),
          processo.fim.then((f) => Promise.reject(new Error(f.erroSpawn ? "app_server_nao_subiu" : `app_server_saiu_${f.exitCode ?? f.signal ?? "?"}`))),
          new Promise<never>((_, rejeitar) => {
            prazo = setTimeout(() => rejeitar(new Error("app_server_sem_resposta")), p.prazoMs);
          }),
        ]);
      } catch (e) {
        await processo.interromper();
        await processo.fim;
        throw e;
      } finally {
        if (prazo) clearTimeout(prazo);
      }
    },

    iniciarTurno(montar, aoAbrir) {
      turno = { estado: "iniciando" };
      enviar((id) => montar(id, threadId), (r) => {
        const id = r.tipo === "resposta" ? idDoTurno(r.resultado) : null;
        if (id === null) {
          turno = { estado: "livre" };
          interromperAoAbrir = false;
          return aoAbrir(null, r);
        }
        // O turno já concluiu antes da resposta chegar: o interrupt pedido para ele morre junto, senão cortaria o próximo.
        if (encerrados.has(id)) {
          interromperAoAbrir = false;
          return;
        }
        turno = { estado: "ativo", id };
        if (interromperAoAbrir) {
          interromperAoAbrir = false;
          return enviar((rid) => pedidoTurnInterrupt(rid, { threadId, turnId: id }));
        }
        aoAbrir(id, r);
      });
    },

    steer(texto, aoResponder) {
      if (turno.estado !== "ativo") return aoResponder(false);
      const turnoEsperado = turno.id;
      enviar((id) => pedidoTurnSteer(id, { threadId, texto, turnoEsperado }), (r) => aoResponder(r.tipo === "resposta"));
    },

    interromperTurno(op) {
      if (turno.estado === "ativo") {
        const turnId = turno.id;
        enviar((id) => pedidoTurnInterrupt(id, { threadId, turnId }));
      } else if (turno.estado === "iniciando" && op?.aoAbrir) {
        interromperAoAbrir = true;
      }
    },

    fechar() {
      if (fechando) return;
      fechando = true;
      processo.fecharStdin();
    },
  };
}
