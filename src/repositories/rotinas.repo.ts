import type { AcessoPedido } from "../contracts/acesso.ts";
import type { EstadoRotina, Rotina } from "../contracts/rotina.ts";
import type { GatilhoRotina } from "../domain/rotina-webhook.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { data, ms } from "./conversao.ts";

interface Linha {
  tenant_id: string;
  id: string;
  owner_id: string;
  agente_id: string;
  conversa_id: string;
  cron: string;
  fuso_iana: string;
  instrucao: string;
  fonte: string;
  entregavel: string;
  limites_aprovacao: string;
  politica_sem_dado: string;
  exige_aprovacao: boolean;
  estado: EstadoRotina;
  proxima_execucao: Date;
  criado_em: Date;
  excluido_em: Date | null;
  acessos: AcessoPedido[] | null;
  gatilho: GatilhoRotina;
  provedor: string | null;
  eventos: string[] | null;
}

const COLUNAS =
  "tenant_id, id, owner_id, agente_id, conversa_id, cron, fuso_iana, instrucao, fonte, entregavel, limites_aprovacao, politica_sem_dado, exige_aprovacao, case when exists (select 1 from agentes a where a.tenant_id = rotinas.tenant_id and a.id = rotinas.agente_id and a.geracao_execucao = rotinas.geracao_execucao and a.excluido_em is null) then estado else 'pausada'::estado_rotina end as estado, proxima_execucao, criado_em, excluido_em, acessos, gatilho, provedor, eventos";

const paraRotina = (l: Linha): Rotina => ({
  tenantId: l.tenant_id,
  id: l.id,
  agenteId: l.agente_id,
  conversaId: l.conversa_id,
  ownerId: l.owner_id,
  cron: l.cron,
  fusoIana: l.fuso_iana,
  instrucao: l.instrucao,
  fonte: l.fonte,
  entregavel: l.entregavel,
  limitesAprovacao: l.limites_aprovacao,
  politicaSemDado: l.politica_sem_dado,
  exigeAprovacao: l.exige_aprovacao,
  estado: l.estado,
  proximaExecucao: ms(l.proxima_execucao),
  criadoEm: ms(l.criado_em),
  excluidoEm: l.excluido_em ? ms(l.excluido_em) : null,
  acessos: l.acessos,
  gatilho: l.gatilho,
  provedor: l.provedor,
  eventos: l.eventos,
});

export type NovaRotina = {
  id?: string;
  agenteId: string;
  conversaId: string;
  cron: string;
  fusoIana: string;
  instrucao: string;
  fonte: string;
  entregavel: string;
  limitesAprovacao: string;
  politicaSemDado: string;
  /** Omitido = DEFAULT true da coluna (E7.3): o gate nasce ligado por schema. */
  exigeAprovacao?: boolean;
  estado?: EstadoRotina;
  proximaExecucao: number;
  /** Omitido = null (rotina sem declaração; o pré-voo lê a fonte). 0027. */
  acessos?: AcessoPedido[] | null;
  /** NOD-84 (0130): omitido = 'horario'. A rotina webhook vem com o cron sentinela e PROXIMA_WEBHOOK. */
  gatilho?: GatilhoRotina;
  provedor?: string | null;
  eventos?: string[] | null;
};

/** Rotinas (ADR-011): quem avalia cron é o servidor; o repositório só guarda proxima_execucao. */
export function rotinasRepo(conn: Conn, escopo: Escopo) {
  return {
    async criar(r: NovaRotina): Promise<Rotina | null> {
      const [l] = await conn<Linha[]>`
        insert into rotinas (tenant_id, id, owner_id, agente_id, conversa_id, cron, fuso_iana, instrucao, fonte, entregavel, limites_aprovacao,
          politica_sem_dado, exige_aprovacao, estado, proxima_execucao, acessos, gatilho, provedor, eventos)
        values (${escopo.tenantId}, ${r.id ?? conn`gen_random_uuid()`}, ${escopo.pessoaId}, ${r.agenteId}, ${r.conversaId}, ${r.cron}, ${r.fusoIana},
          ${r.instrucao}, ${r.fonte}, ${r.entregavel}, ${r.limitesAprovacao}, ${r.politicaSemDado},
          ${r.exigeAprovacao === undefined ? conn`default` : r.exigeAprovacao}, ${r.estado ?? "ativa"}, ${data(r.proximaExecucao)}, ${r.acessos ? conn.json(r.acessos) : null},
          ${r.gatilho ?? "horario"}, ${r.provedor ?? null}, ${r.eventos ?? null})
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraRotina(l) : null;
    },

    async buscar(id: string): Promise<Rotina | null> {
      const [l] = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from rotinas where tenant_id = ${escopo.tenantId} and id = ${id}`;
      return l ? paraRotina(l) : null;
    },

    /**
     * definido em 2026-10-06 (NOD-182): `buscar` com a linha TRAVADA até o fim da transação, para confirmar uma proposta
     * de mudar/excluir. A segunda confirmação concorrente espera a primeira e relê a rotina já mudada. Só a dona: o
     * FOR UPDATE passa pela policy de UPDATE (0004), então rotina de outra pessoa do tenant volta null.
     */
    async buscarParaAtualizar(id: string): Promise<Rotina | null> {
      const [l] = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from rotinas where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} for update`;
      return l ? paraRotina(l) : null;
    },

    async listar(): Promise<Rotina[]> {
      const linhas = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from rotinas where tenant_id = ${escopo.tenantId} and excluido_em is null and exists (select 1 from agentes a where a.tenant_id = rotinas.tenant_id and a.id = rotinas.agente_id and a.excluido_em is null) order by criado_em`;
      return linhas.map(paraRotina);
    },

    async listarDoAgente(agenteId: string): Promise<Rotina[]> {
      const linhas = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from rotinas where tenant_id = ${escopo.tenantId} and agente_id = ${agenteId} and excluido_em is null order by criado_em`;
      return linhas.map(paraRotina);
    },

    /** Para podeCriarRotina (50 por bot, src/domain/rotina-limites.ts). */
    async contarDoAgente(agenteId: string): Promise<number> {
      const [l] = await conn<{ n: number }[]>`select count(*)::int as n from rotinas where tenant_id = ${escopo.tenantId} and agente_id = ${agenteId} and excluido_em is null`;
      return l?.n ?? 0;
    },

    /** O tick do scheduler (L7): ativas da pessoa cuja próxima execução já passou. Só as de horário (NOD-84): a webhook nunca vence. */
    async ativasVencidas(agora: number): Promise<Rotina[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from rotinas
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and estado = 'ativa' and excluido_em is null and exists (select 1 from agentes a where a.tenant_id = rotinas.tenant_id and a.id = rotinas.agente_id and a.excluido_em is null and a.geracao_execucao = rotinas.geracao_execucao) and gatilho = 'horario' and proxima_execucao <= ${data(agora)}
        order by proxima_execucao`;
      return linhas.map(paraRotina);
    },

    async atualizarEstado(id: string, estado: EstadoRotina): Promise<Rotina | null> {
      const [l] = await conn<Linha[]>`update rotinas set estado = ${estado} where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraRotina(l) : null;
    },

    /**
     * Aplica a atualização JÁ NORMALIZADA do payload da proposta (E7.1). Campo ausente fica como
     * está — por isso `coalesce` com null em vez de montar SQL dinâmico. Só a dona: como em
     * atualizarEstado/reagendar, devolve null para quem não é (a perna de equipe só abre LEITURA).
     * O trigger nod_rotina_agente_ativo é `UPDATE OF estado ... WHEN (NEW.estado = 'ativa')`
     * (0011), então este UPDATE não passa por ele: mexer em cron/instrução de rotina de agente
     * excluído não levanta 23514 — conferido em 2026-09-21.
     * `acessos` (0027): presente troca a lista inteira; ausente fica como está (coalesce não serve — a
     * lista vazia é uma declaração, não "sem mudança").
     */
    async atualizar(id: string, campos: Partial<Pick<Rotina, "cron" | "fusoIana" | "instrucao" | "fonte" | "entregavel" | "limitesAprovacao" | "politicaSemDado" | "proximaExecucao">> & { acessos?: AcessoPedido[]; eventos?: string[] }): Promise<Rotina | null> {
      const [l] = await conn<Linha[]>`
        update rotinas set
          cron = coalesce(${campos.cron ?? null}, cron),
          fuso_iana = coalesce(${campos.fusoIana ?? null}, fuso_iana),
          instrucao = coalesce(${campos.instrucao ?? null}, instrucao),
          fonte = coalesce(${campos.fonte ?? null}, fonte),
          entregavel = coalesce(${campos.entregavel ?? null}, entregavel),
          limites_aprovacao = coalesce(${campos.limitesAprovacao ?? null}, limites_aprovacao),
          politica_sem_dado = coalesce(${campos.politicaSemDado ?? null}, politica_sem_dado),
          proxima_execucao = coalesce(${campos.proximaExecucao === undefined ? null : data(campos.proximaExecucao)}, proxima_execucao),
          acessos = ${campos.acessos === undefined ? conn`acessos` : conn.json(campos.acessos)},
          eventos = ${campos.eventos === undefined ? conn`eventos` : campos.eventos}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and excluido_em is null
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraRotina(l) : null;
    },

    /**
     * Exclusão RECUPERÁVEL (ADR-034): carimba excluido_em e some das listagens, do teto e do tick.
     * Nunca DELETE — a trilha é imutável (ADR-004) e as execuções passadas continuam existindo.
     * Idempotente: `excluido_em is null` faz a segunda chamada devolver null sem reescrever a data.
     */
    async excluir(id: string, em: number): Promise<Rotina | null> {
      const [l] = await conn<Linha[]>`
        update rotinas set excluido_em = ${data(em)}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and excluido_em is null
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraRotina(l) : null;
    },

    async reagendar(id: string, proximaExecucao: number): Promise<Rotina | null> {
      const [l] = await conn<Linha[]>`
        update rotinas set proxima_execucao = ${data(proximaExecucao)} where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraRotina(l) : null;
    },
  };
}
