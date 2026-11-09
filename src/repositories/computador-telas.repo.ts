import type { ControleComputador, PoliticaComputador } from "../contracts/computador.ts";
import type { EstadoTelaComputador, TelaComputadorBot } from "../contracts/computador-motor.ts";
import type { MotivoFalhaComputador } from "../contracts/motivos.ts";
import type { Conn, Escopo } from "../shared/types.ts";

/**
 * definido em 2026-10-22 (NOD-96, ADR-122): as telas dos bots no computador da pessoa (0106). Uma por bot por
 * computador; o controle, a política e o pedido de ajuda que eram do computador por bot passam a ser da tela. A fila da
 * régua (ADR-085/097) é a tela em 'esperando', pela ordem de `esperando_desde`.
 */
type Linha = {
  id: string; computador_id: string; agente_id: string; estado: EstadoTelaComputador; esperando_desde: Date | null;
  controle: ControleComputador; politica: PoliticaComputador; ajuda: string | null; ajuda_decisao_id: string | null;
  operacao_id: string | null; ocupado_ate: Date | null; ultima_atividade_em: Date; memoria_mb: number | null;
  falha_motivo: MotivoFalhaComputador | null; criado_em: Date;
};
const tela = (l: Linha): TelaComputadorBot => ({
  id: l.id, computadorId: l.computador_id, agenteId: l.agente_id, estado: l.estado, esperandoDesde: l.esperando_desde?.getTime() ?? null,
  controle: l.controle, politica: l.politica, ajuda: l.ajuda, ajudaDecisaoId: l.ajuda_decisao_id, operacaoId: l.operacao_id,
  ocupadoAte: l.ocupado_ate?.getTime() ?? null, ultimaAtividadeEm: l.ultima_atividade_em.getTime(), memoriaMb: l.memoria_mb,
  falhaMotivo: l.falha_motivo, criadoEm: l.criado_em.getTime(),
});

export function computadorTelasRepo(conn: Conn, escopo: Escopo) {
  return {
    /** A tela do bot no computador, sem criar. */
    async buscar(computadorId: string, agenteId: string): Promise<TelaComputadorBot | null> {
      const [l] = await conn<Linha[]>`select * from computador_telas where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId}
        and computador_id = ${computadorId} and agente_id = ${agenteId}`;
      return l ? tela(l) : null;
    },
    /**
     * A tela do bot, criada fechada na primeira vez. null = o bot ou o computador não são desta pessoa (ou o bot foi
     * excluído, ou o computador não é do motor): ninguém abre tela no computador de outra pessoa.
     */
    async obter(computadorId: string, agenteId: string): Promise<TelaComputadorBot | null> {
      await conn`insert into computador_telas (tenant_id, owner_id, computador_id, agente_id)
        select ${escopo.tenantId}, ${escopo.pessoaId}, c.id, a.id from computadores c
        join agentes a on a.tenant_id = c.tenant_id and a.id = ${agenteId} and a.owner_id = ${escopo.pessoaId} and a.excluido_em is null
        where c.tenant_id = ${escopo.tenantId} and c.owner_id = ${escopo.pessoaId} and c.id = ${computadorId} and c.modelo = 'por_pessoa' and c.arquivado_em is null
        on conflict (tenant_id, computador_id, agente_id) do nothing`;
      return this.buscar(computadorId, agenteId);
    },
    /** A tela pelo id, sem travar (o driver localiza o computador e o bot por ela). */
    async porId(id: string): Promise<TelaComputadorBot | null> {
      const [l] = await conn<Linha[]>`select * from computador_telas where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}`;
      return l ? tela(l) : null;
    },
    async travar(id: string): Promise<TelaComputadorBot | null> {
      const [l] = await conn<Linha[]>`select * from computador_telas where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} for update`;
      return l ? tela(l) : null;
    },
    /** As telas do computador, da mais ativa para a menos (a de mais tempo parada é a primeira a fechar). */
    async doComputador(computadorId: string): Promise<TelaComputadorBot[]> {
      const linhas = await conn<Linha[]>`select * from computador_telas where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId}
        and computador_id = ${computadorId} order by ultima_atividade_em desc, id`;
      return linhas.map(tela);
    },
    /** A fila da régua: as telas esperando vez, da que chegou primeiro à última. */
    async fila(computadorId: string): Promise<TelaComputadorBot[]> {
      const linhas = await conn<Linha[]>`select * from computador_telas where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId}
        and computador_id = ${computadorId} and estado = 'esperando' order by esperando_desde, id`;
      return linhas.map(tela);
    },
    /**
     * Muda o estado da tela. `de` restringe a transição (falso = a tela não estava em nenhum deles). Entrar em
     * 'esperando' marca a chegada na fila (mantida se já esperava); sair dela a apaga (CHECK computador_telas_fila).
     */
    async mudarEstado(id: string, estado: EstadoTelaComputador, em: number, de?: readonly EstadoTelaComputador[]): Promise<boolean> {
      const linhas = await conn`update computador_telas set estado = ${estado},
          esperando_desde = case when ${estado} = 'esperando' then coalesce(esperando_desde, ${new Date(em)}::timestamptz) end,
          falha_motivo = case when ${estado} = 'aberta' then null else falha_motivo end
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}
          and (${de === undefined} or estado = any(${de === undefined ? [] : [...de]}::estado_tela_computador[]))
        returning id`;
      return linhas.length > 0;
    },
    /** O mesmo que computadores.configurar, agora por tela. `atividadeEm` adia o fechamento por ociosidade. */
    async configurar(id: string, c: { controle?: ControleComputador; politica?: PoliticaComputador; ajuda?: string | null; ajudaDecisaoId?: string | null; atividadeEm?: number }): Promise<void> {
      await conn`update computador_telas set controle = coalesce(${c.controle ?? null}, controle), politica = coalesce(${c.politica ?? null}, politica),
        ultima_atividade_em = coalesce(${c.atividadeEm === undefined ? null : new Date(c.atividadeEm)}::timestamptz, ultima_atividade_em),
        ajuda = case when ${c.ajuda !== undefined} then ${c.ajuda ?? null} else ajuda end,
        ajuda_decisao_id = case when ${c.ajudaDecisaoId !== undefined} then ${c.ajudaDecisaoId ?? null}::uuid else ajuda_decisao_id end
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}`;
    },
    async ocupar(id: string, operacaoId: string, ate: number): Promise<void> {
      await conn`update computador_telas set operacao_id = ${operacaoId}, ocupado_ate = ${new Date(ate)} where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}`;
    },
    async liberar(id: string, operacaoId: string, atividadeEm?: number): Promise<void> {
      await conn`update computador_telas set operacao_id = null, ocupado_ate = null,
        ultima_atividade_em = coalesce(${atividadeEm === undefined ? null : new Date(atividadeEm)}::timestamptz, ultima_atividade_em)
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and operacao_id = ${operacaoId}`;
    },
    /** O que o supervisor relatou da tela (RelatoComputador 'estado'): a memória medida e a última ação. */
    async relatar(id: string, r: { memoriaMb: number | null; ultimaAcaoEm: number | null }): Promise<void> {
      const memoria = r.memoriaMb === null ? null : Math.max(0, Math.round(r.memoriaMb));
      await conn`update computador_telas set memoria_mb = ${memoria},
        ultima_atividade_em = greatest(ultima_atividade_em, coalesce(${r.ultimaAcaoEm === null ? null : new Date(r.ultimaAcaoEm)}::timestamptz, ultima_atividade_em))
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}`;
    },
    /** NOD-96 PR 5: o bot foi excluído e o perfil dele apagado; a tela some (o registro das ações fica, sem a tela). */
    async apagar(id: string): Promise<void> {
      await conn`delete from computador_telas where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}`;
    },
    /** Por que a tela não abriu (ou caiu); a próxima abertura que der certo limpa. */
    async registrarFalha(id: string, motivo: MotivoFalhaComputador): Promise<void> {
      await conn`update computador_telas set falha_motivo = ${motivo} where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}`;
    },
  };
}
