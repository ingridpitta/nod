import type { Executor } from "../contracts/evento.ts";
import type { IdHarness } from "../contracts/harness.ts";
import type { ModoTurno } from "../contracts/plano-turno.ts";
import type { IdentidadeSemTurno } from "../contracts/servicos.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { data, ms } from "./conversao.ts";

/**
 * definido em 2026-10-12 (NOD-214, 0073): a credencial do turno despachado, para o processo novo reconhecer o turno que a
 * máquina continuou rodando durante o deploy. Guarda só o sha256 do token; nenhum método recebe ou devolve o token em
 * claro. Sob RLS a pessoa só vê as próprias (owner_id), e o WHERE repete isso (segunda camada, ADR-003).
 */
export type CredencialTurno = {
  turnoId: string;
  tokenHash: Buffer;
  epoch: number;
  identidade: IdentidadeSemTurno;
  harness: IdHarness | null;
  executor: Executor;
  modo: ModoTurno | null;
  despachadoEm: number;
  bifurcou: boolean;
  sobreviveReinicio: boolean;
  falasSeq: number;
};

interface Linha {
  turno_id: string;
  token_hash: Buffer;
  epoch: number;
  identidade: IdentidadeSemTurno;
  harness: string | null;
  executor: string;
  modo: string | null;
  despachado_em: Date;
  bifurcou: boolean;
  sobrevive_reinicio: boolean;
  falas_seq: number;
}

const paraCredencial = (l: Linha): CredencialTurno => ({
  turnoId: l.turno_id,
  tokenHash: l.token_hash,
  epoch: l.epoch,
  identidade: l.identidade,
  harness: l.harness as IdHarness | null,
  executor: l.executor as Executor,
  modo: l.modo as ModoTurno | null,
  despachadoEm: ms(l.despachado_em),
  bifurcou: l.bifurcou,
  sobreviveReinicio: l.sobrevive_reinicio,
  falasSeq: l.falas_seq,
});

export function turnoCredenciaisRepo(conn: Conn, escopo: Escopo) {
  return {
    /** Na tx do puxar, logo depois do despacho. Cunhar de novo (epoch maior) troca a linha. */
    async gravar(c: Omit<CredencialTurno, "falasSeq">): Promise<void> {
      await conn`
        insert into turno_credenciais (tenant_id, owner_id, turno_id, token_hash, epoch, identidade, harness, executor, modo, despachado_em, bifurcou, sobrevive_reinicio)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${c.turnoId}, ${c.tokenHash}, ${c.epoch}, ${conn.json(c.identidade)}, ${c.harness}, ${c.executor}, ${c.modo}, ${data(c.despachadoEm)}, ${c.bifurcou}, ${c.sobreviveReinicio})
        on conflict (tenant_id, turno_id) do update set
          token_hash = excluded.token_hash, epoch = excluded.epoch, identidade = excluded.identidade, harness = excluded.harness,
          executor = excluded.executor, modo = excluded.modo, despachado_em = excluded.despachado_em, bifurcou = excluded.bifurcou,
          sobrevive_reinicio = excluded.sobrevive_reinicio, falas_seq = 0
        where turno_credenciais.epoch <= excluded.epoch`;
    },

    async buscar(turnoId: string): Promise<CredencialTurno | null> {
      const [l] = await conn<Linha[]>`
        select turno_id, token_hash, epoch, identidade, harness, executor, modo, despachado_em, bifurcou, sobrevive_reinicio, falas_seq
        from turno_credenciais where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and turno_id = ${turnoId}`;
      return l ? paraCredencial(l) : null;
    },

    /** O token apresentado, pelo hash (no escopo que o token alega). A comparação em tempo constante é de quem chama. */
    async buscarPorHash(hash: Buffer): Promise<CredencialTurno | null> {
      const [l] = await conn<Linha[]>`
        select turno_id, token_hash, epoch, identidade, harness, executor, modo, despachado_em, bifurcou, sobrevive_reinicio, falas_seq
        from turno_credenciais where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and token_hash = ${hash}`;
      return l ? paraCredencial(l) : null;
    },

    /** ADR-067 na tx do renovar: só sobe (a renovação repetida com as mesmas falas não volta o número). */
    async registrarFalas(turnoId: string, seq: number): Promise<void> {
      await conn`update turno_credenciais set falas_seq = greatest(falas_seq, ${seq})
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and turno_id = ${turnoId}`;
    },

    /** Ao assentar (entrega ou lease) e ao revogar o token. Idempotente. */
    async apagar(turnoId: string): Promise<void> {
      await conn`delete from turno_credenciais where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and turno_id = ${turnoId}`;
    },

    /** Os turnos com credencial de máquina que sobrevive ao reinício, entre estes (a carência do varredor no boot). */
    async quaisSobrevivem(turnoIds: readonly string[]): Promise<Set<string>> {
      if (turnoIds.length === 0) return new Set();
      const linhas = await conn<{ turno_id: string }[]>`
        select turno_id from turno_credenciais where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId}
          and turno_id in ${conn(turnoIds as string[])} and sobrevive_reinicio`;
      return new Set(linhas.map((l) => l.turno_id));
    },
  };
}

export type TurnoCredenciaisRepo = ReturnType<typeof turnoCredenciaisRepo>;
