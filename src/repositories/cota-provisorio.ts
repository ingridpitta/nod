import { ErroDeDominio } from "../domain/erro.ts";
import { cotaDoProvisorio, turnoNovoParaCota } from "../domain/salvaguardas-provisorio.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { ehProvisorio, travarInstalacaoViva } from "./contas.repo.ts";
import type { turnosRepo } from "./turnos.repo.ts";

/**
 * Cota por espaço provisório (NOD-408, ADR-137 §1). O portão fica no `enfileirar`, o ponto único de todo turno (fala
 * da pessoa, rotina, colega, delegação, sala), para que nenhum caminho novo escape. Só turno NOVO conta e é barrado
 * (turnoNovoParaCota): retomada e repetição continuam um turno já contado.
 *
 * O teto é do processo (flag `NOD_PROVISORIO_COTA_TURNOS`, lida no boot por compor-contas.ts); `null` = desligada, e o
 * `enfileirar` fica exatamente o de antes. Quando ligada, uma trava transacional por tenant torna a admissão atômica.
 */
let teto: number | null = null;

export function definirCotaDoProvisorio(n: number | null): void {
  teto = n;
}

export function cotaDoProvisorioAtual(): number | null {
  return teto;
}

/** Turnos novos já contados neste espaço (o tenant do provisório é pessoal). Para de contar no teto. */
export async function turnosNovosDoEspaco(conn: Conn, escopo: Escopo, ate: number): Promise<number> {
  const [l] = await conn<{ n: number }[]>`
    select count(*)::int as n from (
      select 1 from turnos where tenant_id = ${escopo.tenantId} and conta_cota_provisorio
      limit ${ate}) x`;
  return l?.n ?? 0;
}

type RepoDeTurnos = ReturnType<typeof turnosRepo>;

export function comCotaDoProvisorio(repo: RepoDeTurnos, conn: Conn, escopo: Escopo): RepoDeTurnos {
  const enfileirar = repo.enfileirar.bind(repo);
  return {
    ...repo,
    async enfileirar(t) {
      const n = teto;
      if (n !== null && turnoNovoParaCota(t)) {
        // A mesma linha é travada pela conversão em conta. Assim, o burst fica em fila e quem esperou reconsulta o modo:
        // se a conversão ganhou, não há cota; se o turno ganhou, cada concorrente reconta antes do INSERT.
        if ((await travarInstalacaoViva(conn, escopo)) && (await ehProvisorio(conn, escopo))) {
          if (cotaDoProvisorio({ usados: await turnosNovosDoEspaco(conn, escopo, n), teto: n }).esgotada) throw new ErroDeDominio("cota_provisorio");
        }
      }
      return enfileirar(t);
    },
  };
}
