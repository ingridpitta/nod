import type postgres from "postgres";
import { ENTRADA_DA_VOLTA_DA_COTA } from "../domain/cota-da-ia.ts";
import { ENTRADA_DA_COBRANCA, type EsperaDeColega } from "../domain/espera-de-colega.ts";
import { IDADE_MAX_PEDIDO_RETOMAVEL_MS, MOTIVOS_DE_QUEDA, MOTIVOS_FALHA_SEM_QUEDA, type PedidoParado } from "../domain/pedido-parado.ts";
import type { PedidoAberto } from "../domain/triagem.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { data, msOuNull } from "./conversao.ts";

/** Estados de um trabalho ainda aberto (o mesmo recorte do índice `trabalhos_pedidos_abertos` da 0071). */
const ABERTOS = ["na_fila", "rodando", "precisa_de_voce", "fechado_ocioso"] as const;

/**
 * O id de um payload JSON como uuid (revisão do PR #544; NOD-362): `coluna::text = payload->>'x'` não usa o índice da
 * chave e varria a tabela; o cast direto lança com um valor que não é uuid (payload antigo ou forjado). Fora do formato:
 * null. O CASE garante que o cast só roda depois da regex; `~*` aceita maiúsculas e o cast normaliza.
 */
export function uuidDoPayload(conn: Conn, expr: postgres.PendingQuery<postgres.Row[]>) {
  return conn`(case when ${expr} ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (${expr})::uuid end)`;
}

/**
 * NOD-377 (revisão 6 do PR #544, M1): a profundidade da cadeia de retomadas que as esperas leem — a mesma janela da entrega
 * (cadeiaDaDelegacao lê os 500 turnos da conversa). Com o corte de 10 da triagem, uma cadeia longa tinha o "último" errado
 * (aviso de queda com o colega ainda rodando) e pendentes além do 10.º elo ficavam na fila.
 */
export const PROFUNDIDADE_DA_CADEIA = 500;

/** O handoff ainda sem peer_ask da mesma tarefa NA MESMA conversa (CA8) — a parte de pedidoAbertoSql que `abertos` usa. */
export function semRespostaSql(conn: Conn, alias: string) {
  const h = conn(alias);
  return conn`not exists (select 1 from mensagens r where r.tenant_id = ${h}.tenant_id and r.conversa_id = ${h}.conversa_id and r.kind = 'peer_ask'
      and r.payload->>'tarefaId' = ${h}.payload->>'tarefaId')`;
}

/**
 * O pedido a colega ainda aberto (definido em 2026-10-27, NOD-377): a mensagem `alias` é um `handoff` com tarefa, sem
 * `peer_ask` da mesma tarefa NA MESMA conversa (nem resultado nem aviso de falha; a resposta de outra conversa não fecha
 * esta espera) e sem a task de colega de antes já acabada. É a ÚNICA definição: o painel (donos.repo.ts) e o varredor
 * (`esperasDeColega`) usam esta; a espera circular (`abertos`, NOD-362) usa a mesma semRespostaSql e o mesmo filtro do
 * trabalho, depois da CTE materializada — antes cada um tinha a sua, e o painel mostrava o que
 * o varredor já não olhava.
 */
export function pedidoAbertoSql(conn: Conn, alias: string) {
  const h = conn(alias);
  return conn`${h}.kind = 'handoff' and ${h}.payload->>'tarefaId' is not null
    and ${semRespostaSql(conn, alias)}
    and not exists (select 1 from trabalhos k where k.tenant_id = ${h}.tenant_id and k.id = ${uuidDoPayload(conn, conn`${h}.payload->>'trabalhoId'`)}
      and k.estado in ('terminado', 'parado', 'falhou'))`;
}

/** Um pedido aberto como o varredor e as ações do painel (Cobrar, Desistir) o leem. */
export type EsperaDeColegaLida = EsperaDeColega & {
  /** Quem pediu (o bot que espera) e a conversa de onde pediu (a do handoff). */
  deAgenteId: string;
  conversaId: string;
  colegaId: string;
  colegaNome: string;
  deNome: string;
};

/**
 * Os pedidos entre bots vistos pela triagem do dono (definido em 2026-10-12, ADR-099 itens 1a e 8, issue I7 revista).
 * Padrão dos repositórios (tipos.ts): WHERE tenant_id explícito sob RLS. Quem decide é o caso de uso
 * (src/use-cases/pedir-a-bot.ts, pedidos-parados.ts) com as regras puras de src/domain/triagem.ts.
 */
export function pedidosDeColegaRepo(conn: Conn, escopo: Escopo) {
  return {
    /**
     * Serializa os pedidos entre bots do tenant até o fim da transação: a checagem de espera circular lê os pedidos
     * abertos, e dois pedidos cruzados ao mesmo tempo (A→B e B→A) a liam antes de o outro gravar — o mesmo padrão do
     * `travarEsperas` do "Fazer depois da …". Pedidos são raros (um por chamada de ferramenta): a trava é curta.
     */
    async travar(): Promise<void> {
      await conn`select pg_advisory_xact_lock(hashtext(${escopo.tenantId}), hashtext('pedir_a_bot'))`;
    },

    /**
     * NOD-377 (revisão do PR #544): a entrega de UMA tarefa (resultado ou aviso) é serializada pela raiz. Sem ela, o
     * assentar do turno e o varredor (ou o Desistir) liam "nada entregue" ao mesmo tempo e gravavam dois peer_ask.
     */
    async travarTarefa(tarefaId: string): Promise<void> {
      await conn`select pg_advisory_xact_lock(hashtext(${escopo.tenantId}), hashtext(${"peer_ask:" + tarefaId}))`;
    },

    /**
     * NOD-377 (revisão 5 do PR #544, M1): os trabalhos dos turnos da cadeia do pedido, travados (FOR UPDATE, em ordem de
     * id) ANTES da raiz. O assentar do turno do colega trava o trabalho dele e depois a raiz (entregar); o varredor, o
     * Cobrar e o Desistir, que pegavam a raiz e depois o trabalho (sincronizar ao cancelar o pendente), fechavam o ciclo.
     */
    async travarTrabalhosDaCadeia(tarefaId: string): Promise<void> {
      await conn`
        with recursive cadeia(id, n) as (
          select ${tarefaId}::uuid, 0
          union all
          select r.id, c.n + 1 from cadeia c
          join turnos r on r.tenant_id = ${escopo.tenantId} and r.retoma_turno_id = c.id and r.origem = 'retomada'
          where c.n < ${PROFUNDIDADE_DA_CADEIA}
        )
        select k.id from trabalhos k
        where k.tenant_id = ${escopo.tenantId} and k.id in (select t.trabalho_id from cadeia c join turnos t on t.tenant_id = ${escopo.tenantId} and t.id = c.id where t.trabalho_id is not null)
        order by k.id for update of k`;
    },

    /**
     * Os pedidos ainda sem resposta (a aresta `de → para` da espera circular), de duas fontes:
     * - o `handoff` de quem pediu, desde `desde`, sem `peer_ask` da mesma tarefa (nem resultado nem aviso de falha) e sem
     *   a task de colega de antes já acabada — cobre o pedido de antes (task de colega) e o que entra pela triagem do dono;
     * - a frente aberta para o pedido de um colega (`pedido_por_agente_id`), enquanto ela não acaba.
     * NOD-279 (C22, definido em 2026-10-15): o handoff mais velho que `desde` segue aberto enquanto a cadeia da tarefa (o
     * turno da tarefa e as retomadas dele, ou os turnos da task do colega) tem turno pendente ou despachando — a espera da
     * cota não vence a janela. Piso de IDADE_MAX_PEDIDO_RETOMAVEL_MS antes de `desde`, para não montar a cadeia do
     * histórico todo. `semPiso` (NOD-362) pula esse ramo: só os handoffs desde `desde` (o aviso no prompt da rotina).
     *
     * revisto em 2026-10-28 (NOD-362): a consulta levava de 12 a 83 s em produção e travava o tick do agendador.
     * - Os ids do payload viram uuid antes de comparar (`uuidDoPayload`), com a coluna nua: assim valem a PK de `turnos`,
     *   `turnos_por_trabalho` e a PK de `trabalhos` (o `id::text = payload->>…` de antes varria `turnos` por handoff). O
     *   cast é guardado pela regex: um id que não é uuid vira null (não casa com nada), sem derrubar a consulta.
     * - Os handoffs vêm por `mensagens_handoffs_por_tempo` e a resposta por `mensagens_peer_ask_por_conversa` (0115).
     * - A CTE `materialized` tira os respondidos ANTES de montar a cadeia de retomadas, que é a parte cara por handoff.
     * - Sem `de`, a consulta não leva o filtro (antes `${de} is null or …` deixava o plano genérico).
     */
    async abertos(desde: number, filtro: { de?: string; semPiso?: boolean } = {}): Promise<PedidoAberto[]> {
      // NOD-259: com o pedido em si (tarefaId, criadoEm, texto = `motivo` do handoff) e, opcional, só os de um bot.
      const de = filtro.de;
      const piso = filtro.semPiso ? desde : desde - IDADE_MAX_PEDIDO_RETOMAVEL_MS;
      const linhas = await conn<{ de: string; para: string; tarefa_id: string | null; criado_em: Date; texto: string | null }[]>`
        with h as materialized (
          select m.payload->>'de' as de, m.payload->>'para' as para, m.payload->>'tarefaId' as tarefa_id, m.criado_em,
            m.payload->>'motivo' as texto, ${uuidDoPayload(conn, conn`m.payload->>'tarefaId'`)} as tarefa, ${uuidDoPayload(conn, conn`m.payload->>'trabalhoId'`)} as trabalho
          from mensagens m
          where m.tenant_id = ${escopo.tenantId} and m.kind = 'handoff' and m.payload->>'tarefaId' is not null
            and m.criado_em >= ${data(piso)}
            ${de === undefined ? conn`` : conn`and m.payload->>'de' = ${de}::text`}
            -- NOD-377 (CA5): a mesma "sem resposta" do painel e do varredor (pedidoAbertoSql); o trabalho fechado vem depois.
            and ${semRespostaSql(conn, "m")}
        )
        select h.de, h.para, h.tarefa_id, h.criado_em, h.texto from h
        where not exists (select 1 from trabalhos k where k.tenant_id = ${escopo.tenantId} and h.trabalho is not null and k.id = h.trabalho
            and k.estado in ('terminado', 'parado', 'falhou'))
          ${filtro.semPiso ? conn`` : conn`and (h.criado_em >= ${data(desde)}
            -- o "is not null" casa com o predicado de turnos_por_trabalho (sem ele o plano varre turnos num subplano hashed).
            or exists (select 1 from turnos v where v.tenant_id = ${escopo.tenantId} and h.trabalho is not null and v.trabalho_id is not null
              and v.trabalho_id = h.trabalho and v.estado in ('pendente', 'despachando'))
            or exists (
              with recursive cadeia(id, n) as (
                select d.id, 0 from turnos d where d.tenant_id = ${escopo.tenantId} and d.id = h.tarefa
                union all
                select r.id, c.n + 1 from cadeia c join turnos r on r.tenant_id = ${escopo.tenantId} and r.retoma_turno_id = c.id and r.origem = 'retomada'
                where c.n < 10
              )
              select 1 from cadeia c join turnos v on v.tenant_id = ${escopo.tenantId} and v.id = c.id where v.estado in ('pendente', 'despachando')))`}
        union
        select w.pedido_por_agente_id::text, w.agente_id::text, null, w.criado_em, null from trabalhos w
        where w.tenant_id = ${escopo.tenantId} and w.pedido_por_agente_id is not null and w.estado = any(${[...ABERTOS]}::text[])
          ${de === undefined ? conn`` : conn`and w.pedido_por_agente_id::text = ${de}::text`}`;
      return linhas
        .filter((l) => l.de && l.para)
        .map((l) => ({ de: l.de, para: l.para, tarefaId: l.tarefa_id, criadoEm: l.criado_em.getTime(), texto: l.texto }));
    },

    /**
     * Dos bots dados, os livres agora (ADR-099 item 8, "o bot pode sugerir um colega livre"): sem turno vivo (despachando)
     * e sem turno pronto na fila — a volta marcada para depois não conta, ela só espera.
     */
    async livres(agenteIds: readonly string[], agora: number): Promise<string[]> {
      if (agenteIds.length === 0) return [];
      const linhas = await conn<{ id: string }[]>`
        select a.id from agentes a
        where a.tenant_id = ${escopo.tenantId} and a.id = any(${[...agenteIds]}::uuid[])
          and not exists (select 1 from turnos t where t.tenant_id = a.tenant_id and t.agente_id = a.id
            and (t.estado = 'despachando' or (t.estado = 'pendente' and (t.acordar_em is null or t.acordar_em <= ${data(agora)}))))`;
      const livres = new Set(linhas.map((l) => l.id));
      return agenteIds.filter((id) => livres.has(id));
    },

    /**
     * Quantas frentes ainda abertas há nos lotes que estes turnos abriram e que ainda não foram devolvidos (0071). É o
     * "aguardando_frentes" da entrega ao colega e do desfecho da rotina: o turno de triagem que abriu frentes não é o fim
     * do pedido. A I3 marca o lote devolvido (`marcarDevolvido`) antes de entregar; com isso o lote sai daqui.
     */
    async frentesAbertasDosTurnos(turnoIds: readonly string[]): Promise<number> {
      if (turnoIds.length === 0) return 0;
      const [l] = await conn<{ n: number }[]>`
        select count(*)::int as n from lotes_de_frentes l
        join trabalhos w on w.tenant_id = l.tenant_id and w.lote_id = l.id
        where l.tenant_id = ${escopo.tenantId} and l.aberto_por_turno_id = any(${[...turnoIds]}::uuid[]) and l.devolvido_em is null
          and w.estado = any(${[...ABERTOS]}::text[])`;
      return l?.n ?? 0;
    },

    /**
     * Quantas esperas de comando (0070, ADR-099 parte 2) estes turnos deixaram rodando. A triagem que espera uma dependência
     * por `esperar_comando` não entregou o resultado: ele sai na retomada, quando o comando acaba (aguardando_volta).
     */
    async esperasRodandoDosTurnos(turnoIds: readonly string[]): Promise<number> {
      if (turnoIds.length === 0) return 0;
      const [l] = await conn<{ n: number }[]>`
        select count(*)::int as n from esperas where tenant_id = ${escopo.tenantId} and turno_id = any(${[...turnoIds]}::uuid[]) and estado = 'rodando'`;
      return l?.n ?? 0;
    },

    /**
     * Pedidos que entraram pela triagem do dono e caíram (definido em 2026-10-12, ADR-099 item 8 e emenda à ADR-084): o
     * mesmo formato de `trabalhos.pedidosAColegaParados`, para a mesma regra (src/domain/pedido-parado.ts). Handoff sem
     * `trabalhoId` (o pedido não virou task), feito desde `desde`, sem `peer_ask` da tarefa, com quem pediu ainda no ar; a
     * tarefa é o turno `delegacao` do dono, fora de trabalho, e a cadeia de retomadas dele não tem turno vivo nem na fila
     * e acabou interrompida (o concluído já entregou ou espera frentes, volta ou colega: não é parado). Até 20, os mais
     * antigos primeiro; `adiados` como no outro (#218).
     *
     * definido em 2026-10-15 (NOD-257, H5): a janela de `desde` vale para o ÚLTIMO turno da cadeia, não para o handoff —
     * um pedido de dois dias que caiu agora ainda aparece. O handoff só limita a busca (IDADE_MAX_PEDIDO_RETOMAVEL_MS, 7 dias).
     */
    async triagensParadas(desde: number, agora: number, adiados: readonly string[] = []): Promise<PedidoParado[]> {
      const linhas = await conn<{
        tarefa_id: string; ultimo_id: string; ultimo_motivo: string | null; ultimo_motivo_falha: string | null; queda_em: Date | null; quedas: number;
        card_id: string | null; card_estado: string | null; sinal: boolean;
      }[]>`
        with recursive pedidos as (
          select h.id as handoff_id, h.criado_em, d.id as tarefa_id, d.owner_id from mensagens h
          join turnos d on d.tenant_id = h.tenant_id and d.id::text = h.payload->>'tarefaId' and d.origem = 'delegacao' and d.trabalho_id is null
          where h.tenant_id = ${escopo.tenantId} and h.owner_id = ${escopo.pessoaId} and h.kind = 'handoff'
            and h.payload->>'trabalhoId' is null
            -- NOD-241 (revisão) / NOD-257 (H5): piso da idade do pedido; a janela de desde é medida na cadeia, abaixo.
            and h.criado_em >= ${data(Math.min(desde, agora - IDADE_MAX_PEDIDO_RETOMAVEL_MS))}
            and exists (select 1 from agentes a where a.tenant_id = h.tenant_id and a.id::text = h.payload->>'de' and a.excluido_em is null)
            and not exists (select 1 from mensagens r where r.tenant_id = h.tenant_id and r.conversa_id = h.conversa_id and r.kind = 'peer_ask'
              and r.payload->>'tarefaId' = h.payload->>'tarefaId')
            and not (h.payload->>'tarefaId' = any(${[...adiados]}::text[]))
        ), cadeia(raiz, id, n) as (
          select p.tarefa_id, p.tarefa_id, 0 from pedidos p
          union all
          select c.raiz, r.id, c.n + 1 from cadeia c
          join turnos r on r.tenant_id = ${escopo.tenantId} and r.retoma_turno_id = c.id and r.origem = 'retomada'
          where c.n < 10
        )
        select p.tarefa_id, u.id as ultimo_id, -- NOD-314: o pendente que o varredor encerrou preso a uma máquina sem contato nunca rodou: não é queda.
          (case when u.motivo_interrupcao::text = 'maquina_sem_contato' and not (u.attempted or u.despachado_em is not null) then 'preso_sem_contato' else u.motivo_interrupcao::text end) as ultimo_motivo, u.motivo_falha as ultimo_motivo_falha, coalesce(u.ultimo_sinal_em, u.lease_ate, u.criado_em) as queda_em,
          (select count(*)::int from cadeia c join turnos q on q.tenant_id = ${escopo.tenantId} and q.id = c.id
            where c.raiz = p.tarefa_id and q.estado = 'interrompido' and q.motivo_interrupcao::text = any(${[...MOTIVOS_DE_QUEDA]}::text[]) and (q.motivo_interrupcao::text <> 'maquina_sem_contato' or q.attempted or q.despachado_em is not null)
            and coalesce(q.motivo_falha::text, '') <> all(${[...MOTIVOS_FALHA_SEM_QUEDA]}::text[])) as quedas,
          k.id as card_id, k.estado as card_estado,
          exists (select 1 from turnos v where v.tenant_id = ${escopo.tenantId} and v.owner_id = p.owner_id
            and v.criado_em > coalesce(u.ultimo_sinal_em, u.lease_ate, u.criado_em)
            and (v.estado = 'concluido' or (v.estado = 'despachando' and v.lease_ate > ${data(agora)}))) as sinal
        from pedidos p
        join lateral (
          select q.id, q.estado, q.motivo_interrupcao, q.motivo_falha, q.ultimo_sinal_em, q.lease_ate, q.criado_em, q.attempted, q.despachado_em from cadeia c join turnos q on q.tenant_id = ${escopo.tenantId} and q.id = c.id
          where c.raiz = p.tarefa_id and coalesce(q.motivo_interrupcao::text, '') <> 'absorvido'
          order by q.criado_em desc, q.id desc limit 1
        ) u on true
        left join lateral (
          select d.id, d.estado from decisoes d where d.tenant_id = ${escopo.tenantId} and d.turno_id = u.id and d.tipo = 'retomar_turno'
          order by d.criado_em desc limit 1
        ) k on true
        -- NOD-279 (C22): o fim da espera da cota na cadeia (o maior acordar_em das voltas da cota).
        left join lateral (
          select max(q.acordar_em) as fim from cadeia c join turnos q on q.tenant_id = ${escopo.tenantId} and q.id = c.id
          where c.raiz = p.tarefa_id and q.acordar_em is not null and starts_with(q.entrada_texto, ${ENTRADA_DA_VOLTA_DA_COTA})
        ) ec on true
        where u.estado = 'interrompido'
          -- NOD-241: a janela conta da queda quando o último turno caiu; NOD-257 (H5): ou do último turno da cadeia;
          -- NOD-279 (C22, definido em 2026-10-15): senão, do maior entre o pedido e o fim da espera da cota.
          and (greatest(p.criado_em, ec.fim) >= ${data(desde)} or u.criado_em >= ${data(desde)}
            or (u.motivo_interrupcao::text = any(${[...MOTIVOS_DE_QUEDA]}::text[]) and (u.motivo_interrupcao::text <> 'maquina_sem_contato' or u.attempted or u.despachado_em is not null) and coalesce(u.ultimo_sinal_em, u.lease_ate, u.criado_em) >= ${data(desde)}))
          and not exists (select 1 from cadeia c join turnos v on v.tenant_id = ${escopo.tenantId} and v.id = c.id
            where c.raiz = p.tarefa_id and v.estado in ('pendente', 'despachando'))
        order by p.criado_em, p.handoff_id
        limit 20`;
      return linhas.map((l) => {
        const cardAberto = l.card_estado === "pendente" || l.card_estado === "reaberta";
        return {
          tarefaId: l.tarefa_id,
          trabalhoColegaId: null,
          // Sem task, o estado vem do último turno: com o "Retomar" aberto ele espera a pessoa; sem, caiu.
          estadoColega: cardAberto ? "precisa_de_voce" : "falhou",
          ultimoTurnoId: l.ultimo_id,
          ultimoMotivo: l.ultimo_motivo,
        ultimoMotivoFalha: l.ultimo_motivo_falha,
          quedaEm: msOuNull(l.queda_em),
          quedas: l.quedas,
          cardRetomar: l.card_id ? { id: l.card_id, aberto: cardAberto } : null,
          sinalDepoisDaQueda: l.sinal,
          textoFinal: null,
          turnoDoTextoFinal: null,
        };
      });
    },

    /**
     * Os pedidos abertos da pessoa (pedidoAbertoSql), SEM janela de idade (definido em 2026-10-27, NOD-377), com o que a
     * regra de src/domain/espera-de-colega.ts precisa. A cadeia é o turno da tarefa e as retomadas dele (a triagem do
     * dono, ADR-099) mais os turnos da task de colega de antes (`trabalhoId`). As cobranças são as retomadas marcadas com
     * ENTRADA_DA_COBRANCA + a tarefa, na conversa dela. Quem pediu excluído fica fora (não há a quem entregar). Até
     * `limite`, os mais antigos primeiro; `tarefaId`/`de` filtram um pedido (as ações do painel).
     */
    async esperasDeColega(agora: number, o: { adiados?: readonly string[]; tarefaId?: string; tarefaIds?: readonly string[]; de?: string; limite?: number } = {}): Promise<EsperaDeColegaLida[]> {
      // Revisão 10 do PR #544 (M2): os filtros entram só quando vêm (o `x is null or …` deixava o plano genérico, NOD-362).
      // `tarefaIds`: o painel lê de uma vez as esperas vencidas de todos os bots (antes, uma consulta por espera).
      const tarefas = o.tarefaIds ?? (o.tarefaId === undefined ? null : [o.tarefaId]);
      if (tarefas?.length === 0) return [];
      const adiados = o.adiados ?? [];
      const linhas = await conn<{
        tarefa_id: string; de_id: string; conversa_id: string; criado_em: Date; colega_id: string; colega_nome: string; de_nome: string; colega_excluido: boolean; colega_livre: boolean;
        cobrado_em: Date | null; cobrancas: number; rodando: boolean; vivo: boolean; aguardando: boolean; na_fila: boolean; fila_desde: Date | null; rodou: boolean;
        ultimo_id: string | null; ultimo_estado: string | null; ultimo_motivo: string | null; ultimo_fim: Date | null; texto_final: string | null; retomar_de: string | null;
      }[]>`
        with recursive pedidos as (
          select h.id as handoff_id, h.criado_em, h.conversa_id, ${uuidDoPayload(conn, conn`h.payload->>'de'`)} as de_id, ${uuidDoPayload(conn, conn`h.payload->>'trabalhoId'`)} as trabalho_id, d.id as tarefa_id, d.conversa_id as tarefa_conversa, d.agente_id as colega_id
          from mensagens h
          join turnos d on d.tenant_id = h.tenant_id and d.id = ${uuidDoPayload(conn, conn`h.payload->>'tarefaId'`)}
          where h.tenant_id = ${escopo.tenantId} and h.owner_id = ${escopo.pessoaId} and ${pedidoAbertoSql(conn, "h")}
            and exists (select 1 from agentes a where a.tenant_id = h.tenant_id and a.id = ${uuidDoPayload(conn, conn`h.payload->>'de'`)} and a.excluido_em is null)
            ${adiados.length === 0 ? conn`` : conn`and not (h.payload->>'tarefaId' = any(${[...adiados]}::text[]))`}
            ${tarefas === null ? conn`` : conn`and h.payload->>'tarefaId' = any(${[...tarefas]}::text[])`}
            ${o.de === undefined ? conn`` : conn`and h.payload->>'de' = ${o.de}::text`}
        ), cadeia(raiz, id, n) as (
          select p.tarefa_id, p.tarefa_id, 0 from pedidos p
          union all
          select c.raiz, r.id, c.n + 1 from cadeia c
          join turnos r on r.tenant_id = ${escopo.tenantId} and r.retoma_turno_id = c.id and r.origem = 'retomada'
          where c.n < ${PROFUNDIDADE_DA_CADEIA}
        ), membros as (
          select raiz, id from cadeia
          union
          select p.tarefa_id, t.id from pedidos p join turnos t on t.tenant_id = ${escopo.tenantId} and t.trabalho_id = p.trabalho_id
        )
        select p.tarefa_id, p.de_id, p.conversa_id, p.criado_em, p.colega_id, g.nome as colega_nome, quem.nome as de_nome,
          (g.excluido_em is not null) as colega_excluido,
          not exists (select 1 from turnos t where t.tenant_id = g.tenant_id and t.agente_id = g.id
            and (t.estado = 'despachando' or (t.estado = 'pendente' and (t.acordar_em is null or t.acordar_em <= ${data(agora)})))) as colega_livre,
          cb.ultima as cobrado_em, coalesce(cb.quantas, 0) as cobrancas,
          coalesce(f.rodando, false) or exists (select 1 from esperas e join membros mb on mb.id = e.turno_id
            where e.tenant_id = ${escopo.tenantId} and mb.raiz = p.tarefa_id and e.estado = 'rodando') as rodando,
          -- Revisão do PR #544: a triagem do dono com frentes abertas, ou uma decisão da pessoa em aberto, não é "sem resposta".
          (exists (select 1 from lotes_de_frentes l join membros mb on mb.id = l.aberto_por_turno_id
              where l.tenant_id = ${escopo.tenantId} and mb.raiz = p.tarefa_id and l.devolvido_em is null)
            or exists (select 1 from decisoes dc join membros mb on mb.id = dc.turno_id
              where dc.tenant_id = ${escopo.tenantId} and mb.raiz = p.tarefa_id and dc.estado in ('pendente', 'reaberta', 'em_revisao'))
            -- Revisão 4 do PR #544 (M2): o colega que pediu a um terceiro e espera a resposta dele também está trabalhando
            -- (o mesmo "aguardando_colega" de entregar-resposta-peer.ts). A espera de lá tem fim pela regra dela.
            or exists (select 1 from mensagens hh join membros mb on mb.id = hh.turno_id
              where hh.tenant_id = ${escopo.tenantId} and mb.raiz = p.tarefa_id and ${pedidoAbertoSql(conn, "hh")})) as aguardando,
          coalesce(f.vivo, false) as vivo,
          coalesce(f.na_fila, false) as na_fila, f.fila_desde, coalesce(f.rodou, false) as rodou,
          u.id as ultimo_id, u.estado::text as ultimo_estado, u.motivo_interrupcao::text as ultimo_motivo, u.fim as ultimo_fim,
          x.texto as texto_final, rc.id as retomar_de
        from pedidos p
        join agentes g on g.tenant_id = ${escopo.tenantId} and g.id = p.colega_id
        join agentes quem on quem.tenant_id = ${escopo.tenantId} and quem.id = p.de_id
        -- Revisão 3 do PR #544 (M4): as cobranças são as retomadas DA CADEIA do pedido que COMEÇAM pela marca — não a
        -- conversa inteira do colega, nem um texto de terceiro que repita a frase no meio (a resposta de outro colega que cai
        -- numa retomada começa por "Resposta de").
        left join lateral (
          select max(q.criado_em) as ultima, count(*)::int as quantas from cadeia c join turnos q on q.tenant_id = ${escopo.tenantId} and q.id = c.id
          where c.raiz = p.tarefa_id and q.origem = 'retomada'
            and left(q.entrada_texto, length(${ENTRADA_DA_COBRANCA} || p.tarefa_id::text)) = ${ENTRADA_DA_COBRANCA} || p.tarefa_id::text
        ) cb on true
        left join lateral (
          -- Revisão 9 do PR #544 (A1): a volta da cota pendente é a espera da cota (C22), não fila parada — "Seguir com",
          -- conta nova, trocar a IA e Levar tasks a acordam zerando acordar_em, e o criado_em dela é o da queda. Conta como
          -- rodando (o teto da espera ainda vale) e fica fora da fila e do fila_desde.
          select bool_or(q.estado = 'despachando' or (q.estado = 'pendente' and (q.acordar_em > ${data(agora)} or starts_with(q.entrada_texto, ${ENTRADA_DA_VOLTA_DA_COTA})))) as rodando,
            bool_or(q.estado = 'pendente' and (q.acordar_em is null or q.acordar_em <= ${data(agora)}) and not starts_with(q.entrada_texto, ${ENTRADA_DA_VOLTA_DA_COTA})) as na_fila,
            -- Revisão 8 do PR #544 (A1): desde quando o turno mais antigo da fila está pronto (criado ou acordado).
            min(greatest(q.criado_em, coalesce(q.acordar_em, q.criado_em))) filter (where q.estado = 'pendente' and (q.acordar_em is null or q.acordar_em <= ${data(agora)}) and not starts_with(q.entrada_texto, ${ENTRADA_DA_VOLTA_DA_COTA})) as fila_desde,
            bool_or(q.estado = 'despachando') as vivo,
            bool_or(q.attempted or q.despachado_em is not null) as rodou
          from membros mb join turnos q on q.tenant_id = ${escopo.tenantId} and q.id = mb.id where mb.raiz = p.tarefa_id
        ) f on true
        left join lateral (
          select q.id, q.estado, q.motivo_interrupcao, coalesce(q.ultimo_sinal_em, q.lease_ate, q.despachado_em, q.criado_em) as fim
          from membros mb join turnos q on q.tenant_id = ${escopo.tenantId} and q.id = mb.id
          where mb.raiz = p.tarefa_id and coalesce(q.motivo_interrupcao::text, '') <> 'absorvido'
          order by q.criado_em desc, q.id desc limit 1
        ) u on true
        -- Revisão 2 do PR #544 (M2): de onde a reentrega retoma — o último da cadeia de retomadas, nunca da task antiga.
        left join lateral (
          select q.id from cadeia c join turnos q on q.tenant_id = ${escopo.tenantId} and q.id = c.id
          where c.raiz = p.tarefa_id and coalesce(q.motivo_interrupcao::text, '') <> 'absorvido'
          order by q.criado_em desc, q.id desc limit 1
        ) rc on true
        -- Revisão 10 do PR #544 (M1): a fala final é a do ÚLTIMO turno (u). Uma fala de um turno anterior da cadeia (antes de
        -- uma reentrega ou cobrança que acabou calada) é intermediária ou superada: sem fala no último, "sem resposta".
        left join lateral (
          select m.texto from mensagens m
          where m.tenant_id = ${escopo.tenantId} and m.turno_id = u.id and m.kind = 'texto' and m.autor_tipo = 'agente' and m.autor_id = p.colega_id
            and coalesce(m.parcial, false) = false
          order by m.criado_em desc, m.id desc limit 1
        ) x on true
        order by p.criado_em, p.handoff_id
        limit ${o.limite ?? (tarefas ? tarefas.length : 50)}`;
      return linhas.map((l) => ({
        tarefaId: l.tarefa_id,
        deAgenteId: l.de_id,
        conversaId: l.conversa_id,
        colegaId: l.colega_id,
        colegaNome: l.colega_nome,
        deNome: l.de_nome,
        criadoEm: l.criado_em.getTime(),
        cobradoEm: msOuNull(l.cobrado_em),
        cobrancas: l.cobrancas,
        colegaExcluido: l.colega_excluido,
        colegaLivre: l.colega_livre,
        rodando: l.rodando,
        vivo: l.vivo,
        aguardando: l.aguardando,
        naFila: l.na_fila,
        filaDesde: msOuNull(l.fila_desde),
        rodou: l.rodou,
        ultimo: l.ultimo_id && l.ultimo_estado && l.ultimo_fim ? { id: l.ultimo_id, estado: l.ultimo_estado, motivo: l.ultimo_motivo, fimEm: l.ultimo_fim.getTime() } : null,
        textoFinal: l.texto_final,
        retomarDe: l.retomar_de,
      }));
    },

    /**
     * NOD-377 (revisão 2 do PR #544, M5): os turnos da cadeia de retomadas do pedido ainda na fila (pendentes, de agora ou
     * de uma volta marcada). Fechado o pedido de vez (o aviso do prazo, o Desistir), eles saem da fila: o colega não
     * trabalha para quem não espera mais.
     */
    async pendentesDaCadeia(tarefaId: string): Promise<string[]> {
      const linhas = await conn<{ id: string }[]>`
        with recursive cadeia(id, n) as (
          select ${tarefaId}::uuid, 0
          union all
          select r.id, c.n + 1 from cadeia c
          join turnos r on r.tenant_id = ${escopo.tenantId} and r.retoma_turno_id = c.id and r.origem = 'retomada'
          where c.n < ${PROFUNDIDADE_DA_CADEIA}
        )
        select t.id from cadeia c join turnos t on t.tenant_id = ${escopo.tenantId} and t.id = c.id
        where t.estado = 'pendente' order by t.criado_em, t.id`;
      return linhas.map((l) => l.id);
    },
  };
}
