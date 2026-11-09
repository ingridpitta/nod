import { randomUUID } from "node:crypto";
import type { FrameSse, TipoFrame } from "../contracts/frame.ts";
import { log } from "../obs/log.ts";
import { BUFFER_SSE_FRAMES } from "../shared/constantes.ts";

/**
 * Barramento de frames por PESSOA (ADR-016 revisado): a chave do buffer de replay é a pessoa,
 * nunca o tenant — com um tenant só, buffer por tenant é buffer global e o frame do turno privado
 * de uma pessoa entraria no replay da outra. SEM BANCO (EMENDA 3): quem persiste é o outbox; aqui
 * mora só o que está em voo. Deltas de turno entram no mesmo contador de seq sem passar pelo
 * outbox (são efêmeros: o executor chama `publicar` direto).
 *
 * CONTRATO DE RESUME (fixado no dia 1 porque vive nos dois lados ao mesmo tempo):
 *  - toda pessoa tem um `streamId` e um `seq` monotônico; a linha `id:` do SSE é `${streamId}:${seq}`;
 *  - o cliente reconecta com `since` = último id recebido;
 *  - replay COMPLETO desde since+1 só quando o streamId é o mesmo E `buffer[0].seq <= since+1`
 *    (nenhum frame entre since e o buffer foi podado);
 *  - senão, NUNCA replay parcial: `resumed:false` com streamId NOVO — o cliente reidrata por REST.
 *    definido em 2026-09-16: o streamId gira a cada resume que falha para nenhum `since` antigo
 *    casar por acaso depois; as outras abas da mesma pessoa seguem o id novo pelas próprias linhas
 *    `id:` (o EventSource atualiza lastEventId a cada frame). O gatilho de reversão do ADR-016 é
 *    resumed:false virar rotina medida.
 *  - primeira conexão (sem since): `resumed:false` — não há o que retomar e o cliente hidrata
 *    depois de conhecer a cabeça do stream, o que fecha a janela entre o GET e o primeiro frame.
 */
export type Since = { streamId: string; seq: number };

export type Retomada =
  | { resumed: true; streamId: string; seq: number; frames: FrameSse[] }
  | { resumed: false; streamId: string; seq: number };

export type Inscrito = (frame: FrameSse) => void;

export interface Barramento {
  /** O frame publicado; null quando é um `turno.delta` guardado para sair junto com os próximos (`juntarDeltasMs`). */
  publicar(pessoaId: string, tipo: TipoFrame, dados: Record<string, unknown>): FrameSse | null;
  /** Devolve a função que cancela a inscrição. */
  inscrever(pessoaId: string, fn: Inscrito): () => void;
  retomar(pessoaId: string, since: Since | null): Retomada;
  posicao(pessoaId: string): { streamId: string; seq: number };
  inscritos(pessoaId: string): number;
}

/** Os `turno.delta` de um turno à espera: os dados do primeiro e os textos na ordem em que chegaram. */
type DeltaGuardado = { dados: Record<string, unknown>; textos: string[] };

type Fluxo = { streamId: string; seq: number; frames: FrameSse[]; inscritos: Set<Inscrito>; deltas: Map<string, DeltaGuardado>; timer: unknown };

export interface OpcoesBarramento {
  /** Default BUFFER_SSE_FRAMES (src/shared/constantes.ts). */
  bufferFrames?: number;
  gerarStreamId?: () => string;
  /**
   * Junta os `turno.delta` de um mesmo turno que chegam dentro desta janela num frame só, com o texto
   * concatenado; 0 (o default) publica cada um na hora. Qualquer outro frame da pessoa descarrega antes os
   * deltas dela, então a ordem que o navegador vê é a da publicação — inclusive o `turno.encerrado`, que
   * chega pelo outbox. Produção usa JUNTAR_DELTAS_MS (src/shared/constantes.ts).
   */
  juntarDeltasMs?: number;
  /** Relógio injetável para o teste (default setTimeout sem segurar o processo vivo). */
  agendar?: (fn: () => void, ms: number) => unknown;
  cancelar?: (timer: unknown) => void;
}

/** `${streamId}:${seq}` → Since; qualquer outra forma → null (o handler trata como primeira conexão). */
export function interpretarSince(valor: string | null | undefined): Since | null {
  if (!valor) return null;
  const i = valor.lastIndexOf(":");
  if (i <= 0) return null;
  const streamId = valor.slice(0, i);
  const seq = Number(valor.slice(i + 1));
  if (!Number.isInteger(seq) || seq < 0) return null;
  return { streamId, seq };
}

export function criarBarramento(opcoes: OpcoesBarramento = {}): Barramento {
  const max = opcoes.bufferFrames ?? BUFFER_SSE_FRAMES;
  const gerar = opcoes.gerarStreamId ?? randomUUID;
  const juntarMs = opcoes.juntarDeltasMs ?? 0;
  const agendar = opcoes.agendar ?? ((fn: () => void, ms: number) => setTimeout(fn, ms).unref());
  const cancelar = opcoes.cancelar ?? ((timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  const fluxos = new Map<string, Fluxo>();

  const fluxoDe = (pessoaId: string): Fluxo => {
    let f = fluxos.get(pessoaId);
    if (!f) {
      f = { streamId: gerar(), seq: 0, frames: [], inscritos: new Set(), deltas: new Map(), timer: null };
      fluxos.set(pessoaId, f);
    }
    return f;
  };

  const reiniciar = (f: Fluxo): void => {
    f.streamId = gerar();
    f.seq = 0;
    f.frames = [];
  };

  const emitir = (pessoaId: string, f: Fluxo, tipo: TipoFrame, dados: Record<string, unknown>): FrameSse => {
    f.seq += 1;
    const frame: FrameSse = { streamId: f.streamId, seq: f.seq, pessoaId, tipo, dados };
    f.frames.push(frame);
    if (f.frames.length > max) f.frames.splice(0, f.frames.length - max);
    for (const fn of f.inscritos) {
      try {
        fn(frame);
      } catch (e) {
        // Um inscrito quebrado não derruba a publicação nem os outros inscritos.
        log("aviso", "sse_inscrito_falhou", { pessoa_id: pessoaId, tipo, erro: e instanceof Error ? e.name : "desconhecido" });
      }
    }
    return frame;
  };

  /** Solta os deltas guardados da pessoa, um frame por turno, na ordem em que os turnos começaram a escrever. */
  const descarregar = (pessoaId: string, f: Fluxo): void => {
    if (f.timer !== null) {
      cancelar(f.timer);
      f.timer = null;
    }
    if (f.deltas.size === 0) return;
    const guardados = [...f.deltas.values()];
    f.deltas.clear();
    for (const g of guardados) emitir(pessoaId, f, "turno.delta", { ...g.dados, texto: g.textos.join("") });
  };

  return {
    publicar(pessoaId, tipo, dados) {
      const f = fluxoDe(pessoaId);
      const turnoId = dados.turnoId;
      if (juntarMs > 0 && tipo === "turno.delta" && typeof turnoId === "string" && typeof dados.texto === "string") {
        const guardado = f.deltas.get(turnoId);
        if (guardado) guardado.textos.push(dados.texto);
        else f.deltas.set(turnoId, { dados, textos: [dados.texto] });
        f.timer ??= agendar(() => {
          f.timer = null;
          descarregar(pessoaId, f);
        }, juntarMs);
        return null;
      }
      descarregar(pessoaId, f);
      return emitir(pessoaId, f, tipo, dados);
    },

    inscrever(pessoaId, fn) {
      const f = fluxoDe(pessoaId);
      f.inscritos.add(fn);
      return () => {
        f.inscritos.delete(fn);
      };
    },

    retomar(pessoaId, since) {
      const f = fluxoDe(pessoaId);
      if (since === null) return { resumed: false, streamId: f.streamId, seq: f.seq };
      if (since.streamId === f.streamId && since.seq <= f.seq) {
        if (since.seq === f.seq) return { resumed: true, streamId: f.streamId, seq: f.seq, frames: [] };
        const primeiro = f.frames[0];
        if (primeiro && primeiro.seq <= since.seq + 1) {
          return { resumed: true, streamId: f.streamId, seq: f.seq, frames: f.frames.filter((x) => x.seq > since.seq) };
        }
      }
      reiniciar(f);
      return { resumed: false, streamId: f.streamId, seq: f.seq };
    },

    posicao(pessoaId) {
      const f = fluxoDe(pessoaId);
      return { streamId: f.streamId, seq: f.seq };
    },

    inscritos(pessoaId) {
      return fluxos.get(pessoaId)?.inscritos.size ?? 0;
    },
  };
}
