import type { DadosDaAtividade } from "../../contracts/frame.ts";
import type { PlanoTurno } from "../../contracts/plano-turno.ts";
import { RESUMO_DO_PASSO_MAX, type PassoDoRun } from "../../contracts/quadro-comentarios.ts";
import { redigirResumo } from "../../domain/resumo-do-passo.ts";
import { log } from "../../obs/log.ts";
import type { NovoPasso } from "../../repositories/turno-passos.repo.ts";

/**
 * Os passos do run gravados no MESMO ponto em que os frames ao vivo saem (ADR-165, definido em 2026-11-10): todo turno,
 * de qualquer conversa (filtrar só os do quadro custaria uma leitura por turno e deixaria o run da conversa sem lista).
 * - `turno.delta`: o texto entra no bloco de fala aberto do turno; o bloco vira UM passo `texto` quando a próxima
 *   ferramenta chega ou quando o turno acaba (`encerrar`), com os primeiros 160 caracteres redigidos.
 * - `turno.atividade`: grava o bloco pendente e a ferramenta numa transação, e publica o frame com o `seq` do passo.
 * - `turno.acao_fim` com `falhou`: marca o passo daquela chamada.
 * Os frames de um turno saem NA ORDEM: enquanto uma gravação está em voo, os seguintes esperam numa fila por turno; sem
 * gravação pendente o delta sai na hora. A gravação que falha vira log e o frame sai sem `seq` (a tela ao vivo não para).
 */

/** definido em 2026-11-10: o começo do bloco que se guarda (o resumo é de 160; a folga deixa a redação ver a chave inteira). */
const TEXTO_GUARDADO = 600;
/** definido em 2026-11-10: turnos com estado em memória (o turno que some sem `encerrar` — lease vencido — sai pelo teto). */
const TURNOS_GUARDADOS = 1000;

/** O rótulo do passo de texto (o bloco de fala do modelo). */
export const ROTULO_DO_TEXTO = "Escreveu";

type TipoVivo = "turno.delta" | "turno.atividade" | "turno.acao_fim";

export type DepsPassosVivos = {
  gravar(plano: PlanoTurno, passos: NovoPasso[]): Promise<PassoDoRun[]>;
  marcarFalha(plano: PlanoTurno, acaoId: string): Promise<unknown>;
  publicar(plano: PlanoTurno, tipo: TipoVivo, dados: Record<string, unknown>): void;
};

type Estado = { plano: PlanoTurno; texto: string; pendentes: number; fila: Promise<void> };

export function criarPassosVivos(d: DepsPassosVivos) {
  const turnos = new Map<string, Estado>();

  function estado(plano: PlanoTurno): Estado {
    let e = turnos.get(plano.turnoId);
    if (!e) {
      e = { plano, texto: "", pendentes: 0, fila: Promise.resolve() };
      turnos.set(plano.turnoId, e);
      while (turnos.size > TURNOS_GUARDADOS) turnos.delete(turnos.keys().next().value!);
    }
    return e;
  }

  /** Roda `fn` depois do que já está na fila do turno; sem nada pendente, roda já (o delta sai no mesmo tique). */
  function enfileirar(e: Estado, fn: () => void | Promise<void>): Promise<void> {
    // Nada aqui rejeita: um erro (do publicar) vira log e a fila do turno segue com o próximo frame.
    const seguro = (): void | Promise<void> => {
      const falhou = (err: unknown): void => {
        log("aviso", "turno_passos_frame_falhou", { turno_id: e.plano.turnoId, erro: err instanceof Error ? err.name : "desconhecido" });
      };
      try {
        const r = fn();
        return r ? r.catch(falhou) : undefined;
      } catch (err) {
        falhou(err);
      }
    };
    if (e.pendentes === 0) {
      const r = seguro();
      if (!r) return Promise.resolve();
      e.pendentes++;
      e.fila = r.finally(() => { e.pendentes--; });
      return e.fila;
    }
    e.pendentes++;
    e.fila = e.fila.then(seguro).finally(() => { e.pendentes--; });
    return e.fila;
  }

  /** O bloco de fala aberto como passo (null = só espaço); o estado volta a vazio. */
  function blocoPendente(e: Estado): NovoPasso | null {
    const resumo = redigirResumo(e.texto, RESUMO_DO_PASSO_MAX);
    e.texto = "";
    return resumo ? { tipo: "texto", classe: "texto", ferramenta: null, rotulo: ROTULO_DO_TEXTO, resumo, acaoId: null, falhou: false } : null;
  }

  async function gravar(plano: PlanoTurno, passos: NovoPasso[]): Promise<PassoDoRun[]> {
    if (!passos.length) return [];
    try {
      return await d.gravar(plano, passos);
    } catch (err) {
      log("aviso", "turno_passos_gravacao_falhou", { turno_id: plano.turnoId, passos: passos.length, erro: err instanceof Error ? err.name : "desconhecido" });
      return [];
    }
  }

  return {
    /** O frame vivo do turno: grava o que é passo e publica, na ordem. Devolve quando o frame saiu (para os testes). */
    registrar(plano: PlanoTurno, tipo: TipoVivo, dados: Record<string, unknown>): Promise<void> {
      const e = estado(plano);
      if (tipo === "turno.delta") {
        return enfileirar(e, () => {
          const t = typeof dados.texto === "string" ? dados.texto : "";
          if (e.texto.length < TEXTO_GUARDADO) e.texto = (e.texto + t).slice(0, TEXTO_GUARDADO);
          d.publicar(plano, tipo, dados);
        });
      }
      if (tipo === "turno.atividade") {
        return enfileirar(e, async () => {
          const a = dados as Omit<DadosDaAtividade, "seq">;
          const bloco = blocoPendente(e);
          const passo: NovoPasso = { tipo: "ferramenta", classe: a.classe, ferramenta: a.ferramenta, rotulo: a.rotulo, resumo: a.resumo, acaoId: a.id ?? null, falhou: false };
          const gravados = await gravar(plano, bloco ? [bloco, passo] : [passo]);
          const seq = gravados.find((p) => p.tipo === "ferramenta")?.seq ?? null;
          d.publicar(plano, tipo, { ...dados, seq });
        });
      }
      return enfileirar(e, async () => {
        if (dados.falhou === true && typeof dados.id === "string") {
          try {
            await d.marcarFalha(plano, dados.id);
          } catch (err) {
            log("aviso", "turno_passos_falha_nao_marcada", { turno_id: plano.turnoId, erro: err instanceof Error ? err.name : "desconhecido" });
          }
        }
        d.publicar(plano, tipo, dados);
      });
    },

    /** O turno acabou (assentado ou não): grava o último bloco de fala e esquece o turno. */
    encerrar(turnoId: string): Promise<void> {
      const e = turnos.get(turnoId);
      if (!e) return Promise.resolve();
      return enfileirar(e, async () => {
        const bloco = blocoPendente(e);
        if (bloco) await gravar(e.plano, [bloco]);
      }).finally(() => {
        if (e.pendentes === 0 && turnos.get(turnoId) === e) turnos.delete(turnoId);
      });
    },
  };
}
