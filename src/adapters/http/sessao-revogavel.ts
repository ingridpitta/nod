import type { Db, Escopo } from "../../shared/types.ts";
import { corteDaPessoa, criarSessaoConta, pessoaExiste, revogarOutrasSessoes, revogarSessao, sessaoViva, tocarSessao, type OrigemSessao } from "../../repositories/contas.repo.ts";

/**
 * Sessões revogáveis (NOD-345, ADR-124 §4). Só existe com NOD_CONTAS ligada; desligada, o cookie vale como sempre e
 * nenhum pedido vai ao banco por causa da sessão.
 *
 *  - cookie COM sid: vale enquanto a linha de `sessoes` estiver viva e for da mesma pessoa;
 *  - cookie SEM sid (o de antes da 0109): vale até a pessoa ter um corte (sair das outras, senha nova).
 *
 * Cache curto por processo (CACHE_MS): a revogação feita AQUI esquece a entrada na hora; feita na outra cor do deploy
 * azul/verde, vale em até CACHE_MS. O uso (`ultimo_uso_em`) é marcado no máximo a cada TOCAR_A_CADA_MS.
 */
export type GuardaSessao = {
  conferir(escopo: Escopo, sid: string | null): Promise<boolean>;
  criar(escopo: Escopo, origem: OrigemSessao, aparelho: string): Promise<string>;
  revogar(escopo: Escopo, sid: string): Promise<boolean>;
  /** Revoga todas menos `manter` (null = todas) e corta os cookies sem sid. */
  revogarOutras(escopo: Escopo, manter: string | null): Promise<number>;
  /** NOD-346: a revogação feita por outro caminho (troca de e-mail) esquece o cache da pessoa na hora. */
  esquecer?(escopo: Escopo): void;
};

/** definido em 2026-10-23: 3 s de cache — no máximo uma consulta por cookie a cada 3 s, e a revogação vista em 3 s. */
export const CACHE_MS = 3_000;
/** definido em 2026-10-23: a lista de sessões mostra "usada há X min"; mais fino que 5 min só gera escrita. */
export const TOCAR_A_CADA_MS = 5 * 60_000;
const CACHE_MAX = 10_000;

export function criarGuardaSessao(db: Db, agora: () => number = Date.now): GuardaSessao {
  const cache = new Map<string, { ok: boolean; ate: number }>();
  const chave = (e: Escopo, sid: string | null) => `${e.tenantId}:${e.pessoaId}:${sid ?? "-"}`;
  const esquecerPessoa = (e: Escopo) => {
    const prefixo = `${e.tenantId}:${e.pessoaId}:`;
    for (const k of cache.keys()) if (k.startsWith(prefixo)) cache.delete(k);
  };

  return {
    async conferir(escopo, sid) {
      const k = chave(escopo, sid);
      const t = agora();
      const c = cache.get(k);
      if (c && c.ate > t) return c.ok;
      let ok: boolean;
      if (sid) {
        const viva = await sessaoViva(db, sid, escopo);
        ok = viva !== null;
        if (viva && t - viva.ultimoUsoEm > TOCAR_A_CADA_MS) await tocarSessao(db, sid, TOCAR_A_CADA_MS);
      } else {
        // Revisão do PR 506: depois da purga não sobra corte nem pessoa; sem a pessoa, o cookie antigo não vale.
        ok = (await corteDaPessoa(db, escopo)) === null && (await pessoaExiste(db, escopo));
      }
      if (cache.size >= CACHE_MAX) cache.clear();
      cache.set(k, { ok, ate: t + CACHE_MS });
      return ok;
    },
    async criar(escopo, origem, aparelho) {
      return criarSessaoConta(db, { ...escopo, origem, aparelho });
    },
    async revogar(escopo, sid) {
      const r = await revogarSessao(db, escopo, sid);
      cache.delete(chave(escopo, sid));
      return r;
    },
    async revogarOutras(escopo, manter) {
      const ids = await revogarOutrasSessoes(db, escopo, manter);
      esquecerPessoa(escopo);
      return ids.length;
    },
    esquecer: esquecerPessoa,
  };
}
