import type { TipoDecisao } from "../contracts/decisao.ts";
import type { LoteDeFrentes, ResumoFrente } from "../contracts/frente.ts";
import type { EstadoTrabalho } from "../contracts/trabalho.ts";
import { MOTIVOS_DE_QUEDA, MOTIVOS_FALHA_SEM_QUEDA, type PedidoParado } from "../domain/pedido-parado.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { data, jsonb, ms, msOuNull } from "./conversao.ts";

interface LinhaLote {
  id: string;
  agente_id: string;
  aberto_por_turno_id: string;
  trabalho_id: string | null;
  avisar_a_cada_uma: boolean;
  titulo: string | null;
  retorno_turno_id: string | null;
  criado_em: Date;
  devolvido_em: Date | null;
  retorno_concluido_em: Date | null;
}

const COLUNAS_LOTE = "id, agente_id, aberto_por_turno_id, trabalho_id, avisar_a_cada_uma, titulo, retorno_turno_id, criado_em, devolvido_em, retorno_concluido_em";

const paraLote = (l: LinhaLote): LoteDeFrentes => ({
  id: l.id,
  agenteId: l.agente_id,
  abertoPorTurnoId: l.aberto_por_turno_id,
  trabalhoId: l.trabalho_id,
  avisarACadaUma: l.avisar_a_cada_uma,
  titulo: l.titulo,
  retornoTurnoId: l.retorno_turno_id,
  criadoEm: ms(l.criado_em),
  devolvidoEm: msOuNull(l.devolvido_em),
  retornoConcluidoEm: msOuNull(l.retorno_concluido_em),
});

export type NovoLote = {
  agenteId: string;
  abertoPorTurnoId: string;
  /** null (padrão) = lote da conversa do dono. */
  trabalhoId?: string | null;
  avisarACadaUma?: boolean;
  /** O `titulo_do_lote` do modelo, já normalizado (`tituloOuNada`); null (padrão) = sem título (0092). */
  titulo?: string | null;
};

/** O que o fecho do lote lê de cada frente: o estado, o resumo e se ela leu conteúdo de fora (ADR-047). */
export type FrenteDoLote = {
  id: string;
  titulo: string;
  estado: EstadoTrabalho;
  resumo: ResumoFrente | null;
  terminadoEm: number | null;
  /** Um turno da frente leu conteúdo de fora ou nasceu não confiável: o retorno do lote nasce marcado. */
  deFora: boolean;
  /**
   * definido em 2026-10-12 (I3), revisto pela NOD-282 (G4): os motivos crus do último turno terminal dela, separados —
   * `pergunta_vencida` no lugar da interrupção quando a última decisão dela venceu (NOD-264); null = nenhum.
   */
  motivoInterrupcao: string | null;
  motivoFalha: string | null;
  /** NOD-282 (G5): o tipo da decisão vencida (com `pergunta_vencida`); null = nenhuma. */
  vencidaTipo: TipoDecisao | null;
  /** definido em 2026-10-12 (I9): quantos turnos dela caíram por infraestrutura (o retorno diz "caiu 3 vezes"). */
  quedas: number;
};

/**
 * Frentes e lotes (definido em 2026-10-12, ADR-099, 0071). Padrão dos repositórios (tipos.ts): WHERE tenant_id explícito
 * sob RLS, escrita só da dona (owner_id), T | null sem lançar. Só leitura e gravação: quem decide abrir, fechar e
 * devolver é o caso de uso (src/use-cases/frentes.ts e fechar-lote.ts).
 */
export function frentesRepo(conn: Conn, escopo: Escopo) {
  return {
    async criarLote(n: NovoLote): Promise<LoteDeFrentes | null> {
      const [l] = await conn<LinhaLote[]>`
        insert into lotes_de_frentes (tenant_id, owner_id, agente_id, aberto_por_turno_id, trabalho_id, avisar_a_cada_uma, titulo)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${n.agenteId}, ${n.abertoPorTurnoId}, ${n.trabalhoId ?? null}, ${n.avisarACadaUma === true}, ${n.titulo ?? null})
        returning ${conn.unsafe(COLUNAS_LOTE)}`;
      return l ? paraLote(l) : null;
    },

    async buscarLote(id: string): Promise<LoteDeFrentes | null> {
      const [l] = await conn<LinhaLote[]>`select ${conn.unsafe(COLUNAS_LOTE)} from lotes_de_frentes where tenant_id = ${escopo.tenantId} and id = ${id}`;
      return l ? paraLote(l) : null;
    },

    /** Com trava de linha: o fecho do lote (duas frentes terminando juntas) serializa aqui antes de devolver. */
    async buscarLoteTravado(id: string): Promise<LoteDeFrentes | null> {
      const [l] = await conn<LinhaLote[]>`
        select ${conn.unsafe(COLUNAS_LOTE)} from lotes_de_frentes where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}
        for no key update`;
      return l ? paraLote(l) : null;
    },

    /**
     * Liga frentes soltas ao lote. Só entra frente (`forma = 'frente'`) ainda sem lote, do mesmo bot do lote e com o lote
     * ainda não devolvido; as outras ficam como estão. Devolve quantas entraram.
     */
    async ligarAoLote(loteId: string, trabalhoIds: readonly string[]): Promise<number> {
      if (trabalhoIds.length === 0) return 0;
      const r = await conn`
        update trabalhos w set lote_id = l.id
        from lotes_de_frentes l
        where l.tenant_id = ${escopo.tenantId} and l.id = ${loteId} and l.devolvido_em is null
          and w.tenant_id = l.tenant_id and w.owner_id = ${escopo.pessoaId} and w.id = any(${[...trabalhoIds]}::uuid[])
          and w.agente_id = l.agente_id and w.forma = 'frente' and w.lote_id is null`;
      return r.count;
    },

    /** O que a frente devolve ao dono (validado antes, em src/domain/resumo-da-frente.ts). Grava por cima do anterior. */
    async gravarResumo(trabalhoId: string, resumo: ResumoFrente): Promise<boolean> {
      const r = await conn`
        update trabalhos set resumo = ${jsonb(conn, resumo)}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${trabalhoId} and forma = 'frente'`;
      return r.count === 1;
    },

    /**
     * NOD-282 (G7): a frente que já tinha voltado ao dono foi reaberta — o resumo de antes fica em `resumo_anterior` (o
     * vazio `{}` quando ela não tinha resumo) e o atual zera, para a volta a final ganhar o resumo novo.
     * NOD-376 (`manterAtual`): a frente reaberta pela conversa da pessoa guarda a cópia e mantém o atual — se a conversa
     * só conversa, os dois ficam iguais e nada volta; se vira trabalho (um resumo novo), o complementar sai.
     */
    async arquivarResumo(trabalhoId: string, opcoes: { manterAtual?: true } = {}): Promise<boolean> {
      const manter = opcoes.manterAtual === true;
      const r = await conn`
        update trabalhos set resumo_anterior = coalesce(resumo, '{}'::jsonb), resumo = case when ${manter} then resumo else null end
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${trabalhoId} and forma = 'frente'
          and (not ${manter} or resumo_anterior is null)`;
      return r.count === 1;
    },

    /**
     * NOD-282 (G7): consome o resumo arquivado na reabertura (uma vez: a segunda chamada devolve null) e devolve os dois,
     * o de antes e o atual. É o que deixa o retorno complementar sair uma vez só.
     */
    async consumirResumoAnterior(trabalhoId: string): Promise<{ anterior: ResumoFrente | Record<string, never>; atual: ResumoFrente | null } | null> {
      const [l] = await conn<{ anterior: ResumoFrente | Record<string, never>; atual: ResumoFrente | null }[]>`
        update trabalhos t set resumo_anterior = null
        from (select id, resumo_anterior from trabalhos where tenant_id = ${escopo.tenantId} and id = ${trabalhoId}) a
        where t.tenant_id = ${escopo.tenantId} and t.owner_id = ${escopo.pessoaId} and t.id = a.id and t.resumo_anterior is not null
        returning a.resumo_anterior as anterior, t.resumo as atual`;
      return l ?? null;
    },

    /** As frentes do lote, na ordem em que nasceram (pelo índice `trabalhos_por_lote`). */
    async frentesDoLote(loteId: string): Promise<FrenteDoLote[]> {
      const linhas = await conn<{ id: string; titulo: string; estado: EstadoTrabalho; resumo: ResumoFrente | null; terminado_em: Date | null; de_fora: boolean; vencida_tipo: TipoDecisao | null; motivo_interrupcao: string | null; motivo_falha: string | null; quedas: number }[]>`
        select v.*,
          case when v.vencida_tipo is not null then 'pergunta_vencida' else v.ultimo_interrupcao end as motivo_interrupcao,
          case when v.vencida_tipo is not null then null else v.ultimo_falha end as motivo_falha
        from (select w.id, w.titulo, w.estado, w.resumo, w.terminado_em, w.criado_em,
          (w.origem = 'colega' or exists (select 1 from turnos x where x.tenant_id = w.tenant_id and x.trabalho_id = w.id
            and (x.contaminado_em is not null or x.entrada_confianca <> 'confiavel'))) as de_fora,
          -- NOD-264 (C21): a frente que falhou porque a pergunta à pessoa venceu leva esse motivo (nunca a pergunta).
          -- NOD-282 (G5): e o tipo da decisão vencida (a aprovação tem texto próprio).
          case when w.estado = 'falhou' then (select case when d.estado = 'vencida' and d.turno_id = (select u.id from turnos u
                where u.tenant_id = w.tenant_id and u.trabalho_id = w.id and u.estado in ('concluido', 'interrompido')
                  and coalesce(u.motivo_interrupcao::text, '') <> 'absorvido' order by u.criado_em desc, u.id desc limit 1) then d.tipo end
              from decisoes d join turnos t on t.tenant_id = d.tenant_id and t.id = d.turno_id
              where d.tenant_id = w.tenant_id and t.trabalho_id = w.id and d.tipo <> 'retomar_turno'
              order by d.criado_em desc, d.id desc limit 1) end as vencida_tipo,
          -- NOD-282 (G4): os dois motivos separados (o coalesce escondia a recusa no despacho do fecho).
          x.motivo_interrupcao::text as ultimo_interrupcao, x.motivo_falha::text as ultimo_falha,
          (select count(*)::int from turnos q where q.tenant_id = w.tenant_id and q.trabalho_id = w.id and q.estado = 'interrompido'
            and q.motivo_interrupcao::text = any(${[...MOTIVOS_DE_QUEDA]}::text[]) and (q.motivo_interrupcao::text <> 'maquina_sem_contato' or q.attempted or q.despachado_em is not null)
            and coalesce(q.motivo_falha::text, '') <> all(${[...MOTIVOS_FALHA_SEM_QUEDA]}::text[])) as quedas
        from trabalhos w
        left join lateral (select x.motivo_interrupcao, x.motivo_falha from turnos x
          where x.tenant_id = w.tenant_id and x.trabalho_id = w.id and x.estado in ('concluido', 'interrompido')
          order by x.criado_em desc, x.id desc limit 1) x on true
        where w.tenant_id = ${escopo.tenantId} and w.lote_id = ${loteId}) v
        order by v.criado_em, v.id`;
      return linhas.map((l) => ({ id: l.id, titulo: l.titulo, estado: l.estado, resumo: l.resumo, terminadoEm: msOuNull(l.terminado_em), deFora: l.de_fora, motivoInterrupcao: l.motivo_interrupcao, motivoFalha: l.motivo_falha, vencidaTipo: l.vencida_tipo, quedas: l.quedas }));
    },

    /**
     * definido em 2026-10-12 (ADR-099, I3): os lotes abertos por estes turnos (o fio de um pedido de colega: o turno de
     * `pedir_a_bot` e as retomadas dele). A entrega a quem pediu espera todos voltarem e leva as frentes de todos.
     */
    async lotesAbertosPor(turnoIds: readonly string[]): Promise<LoteDeFrentes[]> {
      if (turnoIds.length === 0) return [];
      const linhas = await conn<LinhaLote[]>`
        select ${conn.unsafe(COLUNAS_LOTE)} from lotes_de_frentes
        where tenant_id = ${escopo.tenantId} and aberto_por_turno_id = any(${[...turnoIds]}::uuid[])
        order by criado_em, id`;
      return linhas.map(paraLote);
    },

    /** NOD-258: o lote cujo retorno é este turno (null = nenhum). */
    async loteDoRetorno(retornoTurnoId: string): Promise<LoteDeFrentes | null> {
      const [l] = await conn<LinhaLote[]>`
        select ${conn.unsafe(COLUNAS_LOTE)} from lotes_de_frentes
        where tenant_id = ${escopo.tenantId} and retorno_turno_id = ${retornoTurnoId} for update`;
      return l ? paraLote(l) : null;
    },

    /**
     * NOD-293 (G10): o turno é o retorno de um lote? Sem trava (quem pergunta é a rede de 2 min, que só lê); o índice UNIQUE
     * `lotes_de_frentes_retorno` (0071) responde.
     */
    async ehRetornoDeLote(turnoId: string): Promise<boolean> {
      const [l] = await conn`select 1 from lotes_de_frentes where tenant_id = ${escopo.tenantId} and retorno_turno_id = ${turnoId} limit 1`;
      return l !== undefined;
    },

    /** NOD-258: o retorno refeito passa a ser o do lote (o UNIQUE de um retorno por lote continua valendo). */
    async trocarRetorno(loteId: string, retornoTurnoId: string): Promise<boolean> {
      const r = await conn`
        update lotes_de_frentes set retorno_turno_id = ${retornoTurnoId}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${loteId} and devolvido_em is not null`;
      return r.count > 0;
    },

    /**
     * NOD-309 (0098): o turno de retorno `retornoTurnoId` terminou `concluido` — o lote dele está entregue. Uma vez só: o
     * segundo assentamento (ou um retorno que já não é o do lote) não muda nada e devolve false.
     */
    async marcarRetornoConcluido(retornoTurnoId: string, agora: number): Promise<boolean> {
      const r = await conn`
        update lotes_de_frentes set retorno_concluido_em = ${data(agora)}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and retorno_turno_id = ${retornoTurnoId}
          and devolvido_em is not null and retorno_concluido_em is null`;
      return r.count > 0;
    },

    /**
     * Marca o lote devolvido, uma vez só: o segundo fecho (já devolvido) não muda nada e devolve null. `retornoTurnoId`
     * é a retomada do dono (UNIQUE na 0071); null = devolvido sem retorno (o dono parou).
     */
    async marcarDevolvido(loteId: string, retornoTurnoId: string | null, agora: number): Promise<LoteDeFrentes | null> {
      const [l] = await conn<LinhaLote[]>`
        update lotes_de_frentes set devolvido_em = ${data(agora)}, retorno_turno_id = ${retornoTurnoId}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${loteId} and devolvido_em is null
        returning ${conn.unsafe(COLUNAS_LOTE)}`;
      return l ? paraLote(l) : null;
    },

    /**
     * definido em 2026-10-12 (ADR-099 itens 5 e 8, I9): as frentes de lote que caíram por infraestrutura e esperam alguém
     * as retomar — o varredor da ADR-084 (src/use-cases/frentes-caidas.ts) decide com a regra do pedido parado. No formato
     * de `pedidosAColegaParados` (tarefaId = trabalhoColegaId = a frente): frente da pessoa, com lote ainda não devolvido,
     * caída desde `desde`, `precisa_de_voce` (o "Retomar" da queda), sem turno vivo nem na fila e com o último turno
     * interrompido por um dos MOTIVOS_DE_QUEDA. NOD-241 (emenda da ADR-084): a queda é o último sinal do turno
     * (`turnos.ultimo_sinal_em`; sem ele, o lease ou a criação), e a janela `desde` conta dela, não da criação da frente — a
     * frente de mais de um dia que cai agora entra. Frente sem lote (a task de antes, migrada pela 0072) fica de fora: o
     * "Retomar" dela continua com a pessoa, como hoje. Até 20, as mais antigas primeiro; `adiados` como no outro (#218).
     */
    async frentesCaidas(desde: number, agora: number, adiados: readonly string[] = []): Promise<PedidoParado[]> {
      const linhas = await conn<{
        id: string; estado: EstadoTrabalho; ultimo_id: string; ultimo_motivo: string | null; ultimo_motivo_falha: string | null; queda_em: Date | null; quedas: number;
        card_id: string | null; card_estado: string | null; sinal: boolean; na_fila: boolean;
      }[]>`
        select w.id, w.estado, u.id as ultimo_id, -- NOD-314: o pendente que o varredor encerrou preso a uma máquina sem contato nunca rodou: não é queda.
          (case when u.motivo_interrupcao::text = 'maquina_sem_contato' and not (u.attempted or u.despachado_em is not null) then 'preso_sem_contato' else u.motivo_interrupcao::text end) as ultimo_motivo, u.motivo_falha as ultimo_motivo_falha, coalesce(u.ultimo_sinal_em, u.lease_ate, u.criado_em) as queda_em,
          (select count(*)::int from turnos q where q.tenant_id = w.tenant_id and q.trabalho_id = w.id and q.estado = 'interrompido'
            and q.motivo_interrupcao::text = any(${[...MOTIVOS_DE_QUEDA]}::text[]) and (q.motivo_interrupcao::text <> 'maquina_sem_contato' or q.attempted or q.despachado_em is not null)
            and coalesce(q.motivo_falha::text, '') <> all(${[...MOTIVOS_FALHA_SEM_QUEDA]}::text[])) as quedas,
          k.id as card_id, k.estado as card_estado,
          -- NOD-309 (PR 3): a retomada que a queda no fundo já enfileirou segura o varredor (pedido-parado.ts).
          exists (select 1 from turnos n where n.tenant_id = w.tenant_id and n.trabalho_id = w.id and n.estado in ('pendente', 'despachando')) as na_fila,
          exists (select 1 from turnos v where v.tenant_id = w.tenant_id and v.owner_id = w.owner_id
            and v.criado_em > coalesce(u.ultimo_sinal_em, u.lease_ate, u.criado_em)
            and (v.estado = 'concluido' or (v.estado = 'despachando' and v.lease_ate > ${data(agora)}))) as sinal
        from trabalhos w
        join lotes_de_frentes l on l.tenant_id = w.tenant_id and l.id = w.lote_id and l.devolvido_em is null
        join lateral (
          select t.id, t.estado, t.motivo_interrupcao, t.motivo_falha, t.ultimo_sinal_em, t.lease_ate, t.criado_em, t.attempted, t.despachado_em from turnos t
          where t.tenant_id = w.tenant_id and t.trabalho_id = w.id and t.estado in ('concluido', 'interrompido')
            and coalesce(t.motivo_interrupcao::text, '') <> 'absorvido'
          order by t.criado_em desc, t.id desc limit 1
        ) u on true
        left join lateral (
          select d.id, d.estado from decisoes d where d.tenant_id = w.tenant_id and d.turno_id = u.id and d.tipo = 'retomar_turno'
          order by d.criado_em desc limit 1
        ) k on true
        where w.tenant_id = ${escopo.tenantId} and w.owner_id = ${escopo.pessoaId} and w.forma = 'frente' and w.estado = 'precisa_de_voce'
          and coalesce(u.ultimo_sinal_em, u.lease_ate, u.criado_em) >= ${data(desde)}
          and u.estado = 'interrompido' and u.motivo_interrupcao::text = any(${[...MOTIVOS_DE_QUEDA]}::text[]) and (u.motivo_interrupcao::text <> 'maquina_sem_contato' or u.attempted or u.despachado_em is not null)
          and not exists (select 1 from turnos x where x.tenant_id = w.tenant_id and x.trabalho_id = w.id and x.estado in ('pendente', 'despachando'))
          and not (w.id::text = any(${[...adiados]}::text[]))
        order by queda_em, w.id
        limit 20`;
      return linhas.map((l) => ({
        tarefaId: l.id,
        trabalhoColegaId: l.id,
        estadoColega: l.estado,
        ultimoTurnoId: l.ultimo_id,
        ultimoMotivo: l.ultimo_motivo,
        ultimoMotivoFalha: l.ultimo_motivo_falha,
        quedaEm: msOuNull(l.queda_em),
        quedas: l.quedas,
        cardRetomar: l.card_id ? { id: l.card_id, aberto: l.card_estado === "pendente" || l.card_estado === "reaberta" } : null,
        retomadaNaFila: l.na_fila,
        sinalDepoisDaQueda: l.sinal,
        textoFinal: null,
        turnoDoTextoFinal: null,
      }));
    },
  };
}
