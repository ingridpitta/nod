/**
 * NOD-445 (ADR-146), revisão 1 do PR #626: a conversa da web com o servidor sobre as páginas de cada bot, fora do
 * web/main.ts para ter teste. Lê (`GET /agentes/:id/paginas`) e guarda a ordem (`PUT …/paginas/ordem`); o que o
 * servidor deu vai para web/lib/ordem-das-paginas.ts.
 *
 * Respostas fora de ordem: cada PUT ganha um número de sequência por agente. Só a resposta do último PUT vale (a ordem
 * na tela já é a dele, otimista); a de um anterior, ok ou erro, é descartada. Um GET que saiu antes de um PUT também é
 * descartado: a ordem que ele traz é velha.
 *
 * Leitura que falha: cada render da conversa chama `ler`, e sem memória da falha isso virava um laço de GET. A falha
 * fica lembrada por agente e a próxima tentativa sai sozinha depois de uma espera que dobra (2 s, 4 s… até 60 s); os
 * renders no meio não pedem nada. O frame `paginas.mudaram` (forçar) tenta na hora.
 */
import type { PaginasDto } from "../../src/contracts/apps.ts";
import { definirPaginas, paginasDtoDe } from "./ordem-das-paginas.ts";

export type FonteDasPaginas = {
  ler: (agenteId: string) => Promise<{ paginas: PaginasDto }>;
  ordenar: (agenteId: string, ids: string[]) => Promise<{ paginas: PaginasDto }>;
  /** O servidor respondeu a leitura: redesenha e anima os apps que chegaram. */
  aoLer: (agenteId: string, chegaram: string[]) => void;
  /** A ordem guardada voltou do servidor: redesenha. */
  aoGuardar: (agenteId: string) => void;
  /** O PUT falhou (a última ordem pedida não ficou): mostra o erro; a leitura volta à ordem do servidor. */
  aoFalharOrdem: (agenteId: string, e: unknown) => void;
};

/** definido em 2026-11-02 (revisão 1 do #626): a primeira espera depois de uma falha e o teto, dobrando a cada falha. */
export const ESPERA_INICIAL_MS = 2_000;
export const ESPERA_MAXIMA_MS = 60_000;

export function criarPaginasDoServidor(f: FonteDasPaginas) {
  /** O agente cuja leitura falhou: quantas vezes seguidas e o relógio da nova tentativa. */
  const falhou = new Map<string, { vezes: number; timer: ReturnType<typeof setTimeout> }>();
  const emCurso = new Map<string, Promise<void>>();
  const deNovo = new Set<string>();
  /** O número do último PUT de cada agente. */
  const seq = new Map<string, number>();
  const atual = (agenteId: string): number => seq.get(agenteId) ?? 0;

  function ler(agenteId: string, forcar = false): void {
    // Um GET por agente de cada vez; o frame que chega no meio pede outro quando este voltar (o que está no ar pode ser velho).
    if (emCurso.has(agenteId)) { if (forcar) deNovo.add(agenteId); return; }
    if (!forcar && (paginasDtoDe(agenteId) || falhou.has(agenteId))) return;
    const n = atual(agenteId);
    const p = f.ler(agenteId).then((r) => {
      const antes = falhou.get(agenteId);
      if (antes) clearTimeout(antes.timer);
      falhou.delete(agenteId);
      if (atual(agenteId) !== n) return;
      const chegaram = definirPaginas(r.paginas);
      f.aoLer(agenteId, chegaram);
    }, () => {
      const antes = falhou.get(agenteId);
      if (antes) clearTimeout(antes.timer);
      const vezes = (antes?.vezes ?? 0) + 1;
      const espera = Math.min(ESPERA_MAXIMA_MS, ESPERA_INICIAL_MS * 2 ** (vezes - 1));
      falhou.set(agenteId, { vezes, timer: setTimeout(() => ler(agenteId, true), espera) });
    }).finally(() => {
      emCurso.delete(agenteId);
      if (deNovo.delete(agenteId)) ler(agenteId, true);
    });
    emCurso.set(agenteId, p);
  }

  /** O bot já foi lido (ou tentado): o frame `paginas.mudaram` dele relê. */
  const conhece = (agenteId: string): boolean => paginasDtoDe(agenteId) !== undefined || falhou.has(agenteId);

  function guardar(agenteId: string, ids: string[]): Promise<void> {
    const n = atual(agenteId) + 1;
    seq.set(agenteId, n);
    return f.ordenar(agenteId, ids).then((r) => {
      if (atual(agenteId) !== n) return;
      definirPaginas(r.paginas);
      f.aoGuardar(agenteId);
    }, (e: unknown) => {
      if (atual(agenteId) !== n) return;
      f.aoFalharOrdem(agenteId, e);
      ler(agenteId, true);
    });
  }

  /** A leitura deste bot está no ar (a página de um app vazio mostra o esqueleto enquanto isso). */
  const lendo = (agenteId: string): boolean => emCurso.has(agenteId);

  return { ler, guardar, conhece, lendo };
}
