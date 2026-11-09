import type { EstadoProposta, KindProposta, PayloadProposta, PayloadPropostaAcesso, Proposta } from "../contracts/conversa.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { data, ms } from "./conversao.ts";

interface Linha {
  tenant_id: string;
  id: string;
  conversa_id: string;
  agente_id: string;
  kind: KindProposta;
  estado: EstadoProposta;
  payload: PayloadProposta;
  criado_em: Date;
}

const COLUNAS = "tenant_id, id, conversa_id, agente_id, kind, estado, payload, criado_em";

const paraProposta = (l: Linha): Proposta => ({
  tenantId: l.tenant_id,
  id: l.id,
  conversaId: l.conversa_id,
  agenteId: l.agente_id,
  kind: l.kind,
  estado: l.estado,
  payload: l.payload,
  criadoEm: ms(l.criado_em),
});

export type NovaProposta = { id?: string; conversaId: string; agenteId: string; payload: PayloadProposta };

/** Proposta do modelo (ferramenta tipada): nada aplicado antes da confirmação (E1.1). kind vem do payload. */
export function propostasRepo(conn: Conn, escopo: Escopo) {
  /** O pedido de rotina pendente para (agente, app) — a linha do índice único da 0026, se houver. */
  async function acessoDeRotinaAberto(agenteId: string, conector: string): Promise<Proposta | null> {
    const [l] = await conn<Linha[]>`
      select ${conn.unsafe(COLUNAS)} from propostas
      where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and agente_id = ${agenteId} and payload->>'conector' = ${conector}
        and kind = 'acesso' and estado = 'pendente' and payload ? 'rotinaId'`;
    return l ? paraProposta(l) : null;
  }

  return {
    acessoDeRotinaAberto,

    async criar(p: NovaProposta): Promise<Proposta | null> {
      const [l] = await conn<Linha[]>`
        insert into propostas (tenant_id, id, owner_id, conversa_id, agente_id, kind, payload)
        values (${escopo.tenantId}, ${p.id ?? conn`gen_random_uuid()`}, ${escopo.pessoaId}, ${p.conversaId}, ${p.agenteId}, ${p.payload.kind}, ${conn.json(p.payload)})
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraProposta(l) : null;
    },

    async buscar(id: string): Promise<Proposta | null> {
      const [l] = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from propostas where tenant_id = ${escopo.tenantId} and id = ${id}`;
      return l ? paraProposta(l) : null;
    },

    /** NOD-50: serializa os pedidos de credencial do mesmo turno (o anti-repetição lê e depois cria). */
    async travarPedidosDoTurno(turnoId: string): Promise<void> {
      await conn`select pg_advisory_xact_lock(hashtextextended(${`${escopo.tenantId}:${escopo.pessoaId}:credencial:${turnoId}`}, 0))`;
    },

    /**
     * definido em 2026-10-07 (NOD-197): `buscar` com a linha TRAVADA até o fim da transação. Ordem única dos cards de
     * rotina: PROPOSTA e depois DECISÃO — a conversa já trava a proposta primeiro (propostas.decidir), e "Sua vez"
     * passa a travar aqui antes de fechar a decisão. Mesmo filtro de `decidir` (só a dona): o FOR UPDATE passa pela
     * policy de UPDATE, então a proposta de outra pessoa do tenant volta null.
     */
    async buscarParaAtualizar(id: string): Promise<Proposta | null> {
      const [l] = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from propostas where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} for update`;
      return l ? paraProposta(l) : null;
    },

    /**
     * Pedido de acesso vindo de ROTINA (definido em 2026-09-24, emenda da ADR-044): UM pendente por
     * (dona, agente, app), qualquer que seja a rotina — índice propostas_acesso_de_rotina_aberta (0026).
     * INSERT ... ON CONFLICT DO NOTHING e, perdendo, devolve o que já estava: duas rotinas no mesmo tick,
     * ou pedir_acesso contra o pré-voo, nunca viram 23505. Quem perde para uma tx ainda aberta espera o
     * commit dela no índice e então lê a linha commitada. `criada` diz quem inseriu (só ele abre a decisão).
     */
    async criarAcessoDeRotina(p: { id?: string; conversaId: string; agenteId: string; payload: PayloadPropostaAcesso & { rotinaId: string } }): Promise<{ proposta: Proposta; criada: boolean } | null> {
      const [l] = await conn<Linha[]>`
        insert into propostas (tenant_id, id, owner_id, conversa_id, agente_id, kind, payload)
        values (${escopo.tenantId}, ${p.id ?? conn`gen_random_uuid()`}, ${escopo.pessoaId}, ${p.conversaId}, ${p.agenteId}, 'acesso', ${conn.json(p.payload)})
        on conflict (tenant_id, owner_id, agente_id, (payload->>'conector')) where kind = 'acesso' and estado = 'pendente' and payload ? 'rotinaId' do nothing
        returning ${conn.unsafe(COLUNAS)}`;
      if (l) return { proposta: paraProposta(l), criada: true };
      const existente = await acessoDeRotinaAberto(p.agenteId, p.payload.conector);
      return existente ? { proposta: existente, criada: false } : null;
    },

    /** Pedidos de acesso pendentes que ESTA rotina abriu (pelo pré-voo ou por pedir_acesso num turno dela). */
    async pendentesDeAcessoDaRotina(rotinaId: string): Promise<Proposta[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from propostas
        where tenant_id = ${escopo.tenantId} and kind = 'acesso' and estado = 'pendente' and payload->>'rotinaId' = ${rotinaId}
        order by criado_em, id`;
      return linhas.map(paraProposta);
    },

    /**
     * definido em 2026-09-25: os cards "Conecte o X" desta pessoa ainda abertos, em qualquer conversa —
     * quando o login do app termina, cada um vira o card de permitir sem a pessoa voltar a ele (ao-conectar-app.ts).
     */
    async conexoesPendentes(conector: string): Promise<Proposta[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from propostas
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and kind = 'acesso' and estado = 'pendente'
          and payload->>'conector' = ${conector} and payload ? 'conectar'
        order by criado_em, id`;
      return linhas.map(paraProposta);
    },

    /** NOD-430: os cards 'quadro_exclusao' ainda abertos de um quadro (reaproveitar no pedido repetido; fechar quando ele sai). */
    async exclusoesPendentesDoQuadro(quadroId: string): Promise<Proposta[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from propostas
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and kind = 'quadro_exclusao' and estado = 'pendente'
          and payload->>'quadroId' = ${quadroId}
        order by criado_em, id`;
      return linhas.map(paraProposta);
    },

    /** NOD-422 (PR 2): os cards 'assumir_quadro' de um quadro num estado, o mais novo primeiro (o pendente a reaproveitar; o confirmado a desfazer). */
    async assumirDoQuadro(quadroId: string, estado: "pendente" | "confirmada"): Promise<Proposta[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from propostas
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and kind = 'assumir_quadro' and estado = ${estado}
          and payload->>'quadroId' = ${quadroId}
        order by criado_em desc, id desc`;
      return linhas.map(paraProposta);
    },

    async pendentesDaConversa(conversaId: string): Promise<Proposta[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from propostas where tenant_id = ${escopo.tenantId} and conversa_id = ${conversaId} and estado = 'pendente' order by criado_em`;
      return linhas.map(paraProposta);
    },

    /** Pendentes de acesso criadas em [desde, ate): o varredor acha o card de conexão que venceu (ADR-047). */
    async acessosPendentesCriadosEntre(desde: number, ate: number): Promise<Proposta[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from propostas where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and estado = 'pendente' and kind = 'acesso'
          and criado_em >= ${data(desde)} and criado_em < ${data(ate)} order by criado_em`;
      return linhas.map(paraProposta);
    },

    /** ADR-082: o lote do Nod grava o desfecho de cada ação no próprio payload ao ser decidido. Só a dona. */
    async atualizarPayload(id: string, payload: PayloadProposta): Promise<Proposta | null> {
      const [l] = await conn<Linha[]>`
        update propostas set payload = ${conn.json(payload)} where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and kind = ${payload.kind} returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraProposta(l) : null;
    },

    /** Só sai de 'pendente': confirmar/recusar duas vezes devolve null (idempotência para a rota). */
    /**
     * ADR-115 (revisão do PR 3a): a última mudança CONFIRMADA da rotina (`rotina_atualizacao`) e se quem a confirmou foi uma
     * regra (o modo do bot) em vez da pessoa. É o que diz se a instrução atual ainda é palavra da pessoa — o revisor só a
     * põe na parte confiável quando é. null = a rotina nunca mudou depois de criada.
     */
    async ultimaMudancaDaRotina(rotinaId: string): Promise<{ porRegra: boolean } | null> {
      const [l] = await conn<{ tipo: string | null }[]>`
        select d.desfecho->>'tipo' as tipo from propostas p join decisoes d on d.tenant_id = p.tenant_id and d.id = p.id
        where p.tenant_id = ${escopo.tenantId} and p.owner_id = ${escopo.pessoaId} and p.kind = 'rotina_atualizacao' and p.payload->>'rotinaId' = ${rotinaId}
          and p.estado = 'confirmada' and d.estado = 'decidida'
        order by d.decidida_em desc nulls last, p.criado_em desc limit 1`;
      return l ? { porRegra: l.tipo === "decidida_por_regra" } : null;
    },

    async decidir(id: string, estado: "confirmada" | "recusada"): Promise<Proposta | null> {
      const [l] = await conn<Linha[]>`
        update propostas set estado = ${estado} where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and estado = 'pendente' returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraProposta(l) : null;
    },
  };
}
