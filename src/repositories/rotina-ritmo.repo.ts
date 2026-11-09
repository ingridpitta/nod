import type { DesfazerRitmo, RitmoRotina } from "../contracts/rotina-ritmo.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { data, dataOuNull, jsonb, msOuNull } from "./conversao.ts";

interface Linha {
  rotina_id: string;
  sem_novidade_seguidas: number;
  sugestao_mensagem_id: string | null;
  sugerida_em: Date | null;
  silenciada_ate: Date | null;
  desfazer: DesfazerRitmo | null;
}

const COLUNAS = "rotina_id, sem_novidade_seguidas, sugestao_mensagem_id, sugerida_em, silenciada_ate, desfazer";

const paraRitmo = (l: Linha): RitmoRotina => ({
  rotinaId: l.rotina_id,
  semNovidadeSeguidas: l.sem_novidade_seguidas,
  sugestaoMensagemId: l.sugestao_mensagem_id,
  sugeridaEm: msOuNull(l.sugerida_em),
  silenciadaAte: msOuNull(l.silenciada_ate),
  desfazer: l.desfazer,
});

/**
 * definido em 2026-10-23 (NOD-313): a contagem de execuções sem novidade e o card de sugestão de ritmo de cada rotina.
 * Só a dona lê e escreve (RLS de `nod_escopar_tabela` + owner_id do escopo). Ninguém aqui muda a rotina.
 */
export function rotinaRitmoRepo(conn: Conn, escopo: Escopo) {
  return {
    async buscar(rotinaId: string): Promise<RitmoRotina | null> {
      const [l] = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from rotina_ritmo where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and rotina_id = ${rotinaId}`;
      return l ? paraRitmo(l) : null;
    },

    /** O desfazer não espera um fechamento que já trava ritmo: assim não inverte rotina→ritmo contra janela→ritmo. */
    async tentarTravarParaDesfazer(rotinaId: string): Promise<RitmoRotina | null> {
      const [l] = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from rotina_ritmo where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and rotina_id = ${rotinaId} for update skip locked`;
      return l ? paraRitmo(l) : null;
    },

    /**
     * Soma uma execução sem novidade (cria a linha na primeira) ou zera a contagem, atômico sob a trava da linha. Zerar
     * não cria linha (revisão do PR): a rotina que nunca somou não tem o que zerar — null.
     */
    async contar(rotinaId: string, efeito: "soma" | "zera"): Promise<RitmoRotina | null> {
      if (efeito === "zera") {
        const [z] = await conn<Linha[]>`
          update rotina_ritmo set sem_novidade_seguidas = 0, atualizado_em = clock_timestamp()
          where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and rotina_id = ${rotinaId}
          returning ${conn.unsafe(COLUNAS)}`;
        return z ? paraRitmo(z) : null;
      }
      const [l] = await conn<Linha[]>`
        insert into rotina_ritmo (tenant_id, owner_id, rotina_id, sem_novidade_seguidas)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${rotinaId}, 1)
        on conflict (tenant_id, rotina_id) do update set
          sem_novidade_seguidas = rotina_ritmo.sem_novidade_seguidas + 1, atualizado_em = clock_timestamp()
        returning ${conn.unsafe(COLUNAS)}`;
      if (!l) throw new Error("rotina_ritmo: upsert sem linha");
      return paraRitmo(l);
    },

    /**
     * Reivindica o card: só um aberto por rotina e fora do silêncio. A condição é reavaliada sob a trava da linha, então
     * dois desfechos simultâneos não abrem dois cards. Devolve false quando outro já abriu (ou o silêncio vale).
     */
    async reivindicarCard(rotinaId: string, agora: number, minimo: number): Promise<boolean> {
      const r = await conn`
        update rotina_ritmo set sugerida_em = ${data(agora)}, atualizado_em = clock_timestamp()
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and rotina_id = ${rotinaId}
          and sugerida_em is null and sem_novidade_seguidas >= ${minimo}
          and (silenciada_ate is null or silenciada_ate <= ${data(agora)})`;
      return r.count === 1;
    },

    async fixarCard(rotinaId: string, mensagemId: string): Promise<void> {
      await conn`update rotina_ritmo set sugestao_mensagem_id = ${mensagemId}, desfazer = null, atualizado_em = clock_timestamp()
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and rotina_id = ${rotinaId}`;
    },

    /** Fecha o card: zera a contagem, grava o silêncio (Deixar como está) e o que o "desfazer" restaura. */
    async fecharCard(rotinaId: string, campos: { silenciadaAte: number | null; desfazer: DesfazerRitmo | null }): Promise<void> {
      await conn`update rotina_ritmo set sugerida_em = null, sem_novidade_seguidas = 0,
          silenciada_ate = coalesce(${dataOuNull(campos.silenciadaAte)}, silenciada_ate),
          desfazer = ${campos.desfazer ? jsonb(conn, campos.desfazer) : null}, atualizado_em = clock_timestamp()
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and rotina_id = ${rotinaId}`;
    },

    /** O "desfazer" reabre o mesmo card (a pessoa volta à escolha). */
    async reabrirCard(rotinaId: string, agora: number): Promise<void> {
      await conn`update rotina_ritmo set sugerida_em = ${data(agora)}, desfazer = null, atualizado_em = clock_timestamp()
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and rotina_id = ${rotinaId}`;
    },
  };
}
