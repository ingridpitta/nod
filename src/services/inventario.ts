import type { Inventario } from "../contracts/inventario.ts";
import { sondaFoiLenta } from "../domain/sonda-lenta.ts";
import { log } from "../obs/log.ts";
import type { Relogio } from "../shared/types.ts";

/**
 * Inventário de motores por pessoa (ADR-019): cache da sonda com TTL e persistência por CALLBACK
 * injetado (EMENDA 3: src/services é sem banco — quem grava em inventario_motores é a L9 via
 * repos.inventario.registrar dentro de uma tx escopada). Sondas concorrentes da mesma pessoa
 * compartilham a mesma promessa: uma consulta de estado, não N.
 */
export type Sondador = (pessoaId: string) => Promise<Inventario>;
export type Persistidor = (pessoaId: string, inventario: Inventario) => Promise<void>;

/** definido em 2026-09-18: 5 min evita repetir consultas de instalação/login; "sondar de novo" permite reconhecer um login recém-concluído. */
export const INVENTARIO_TTL_MS = 300_000;

export type ServicoInventario = {
  /** Devolve o snapshot em cache se mais novo que o TTL; senão sonda, persiste e devolve. */
  obter(pessoaId: string, o?: { forcar?: boolean }): Promise<Inventario>;
  /** Último snapshot conhecido sem sondar (null se nunca sondou). */
  ultimo(pessoaId: string): Inventario | null;
  invalidar(pessoaId: string): void;
};

export function criarInventario(deps: { sondar: Sondador; persistir?: Persistidor; relogio: Relogio; ttlMs?: number }): ServicoInventario {
  const ttl = deps.ttlMs ?? INVENTARIO_TTL_MS;
  const cache = new Map<string, Inventario>();
  const emCurso = new Map<string, Promise<Inventario>>();

  async function sondarEPersistir(pessoaId: string): Promise<Inventario> {
    const inv = await deps.sondar(pessoaId);
    cache.set(pessoaId, inv);
    if (deps.persistir) {
      try {
        await deps.persistir(pessoaId, inv);
      } catch (erro) {
        // persistir falhou: o cache continua válido; quem lê o banco verá o snapshot anterior (ADR-029: nunca silêncio)
        log("aviso", "inventario_persistir_falhou", { pessoa: pessoaId, estado: inv.estado, erro: erro instanceof Error ? erro.name : "desconhecido" });
      }
    }
    return inv;
  }

  return {
    async obter(pessoaId, o = {}) {
      const guardado = cache.get(pessoaId);
      // NOD-178: snapshot de sonda lenta conta como expirado: a lentidão passa, e a próxima consulta sonda de novo.
      if (!o.forcar && guardado && !sondaFoiLenta(guardado) && deps.relogio() - guardado.em < ttl) return guardado;
      const pendente = emCurso.get(pessoaId);
      if (pendente) return pendente;
      const p = sondarEPersistir(pessoaId).finally(() => emCurso.delete(pessoaId));
      emCurso.set(pessoaId, p);
      return p;
    },
    ultimo: (pessoaId) => cache.get(pessoaId) ?? null,
    invalidar: (pessoaId) => {
      cache.delete(pessoaId);
    },
  };
}
