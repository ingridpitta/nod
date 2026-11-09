import type { DeQuemPediu } from "../contracts/dono.ts";
import { ENTRADA_DA_COBRANCA } from "../domain/espera-de-colega.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { data, ms } from "./conversao.ts";
import { pedidoAbertoSql, PROFUNDIDADE_DA_CADEIA, uuidDoPayload } from "./pedidos-de-colega.repo.ts";

/** Um comando esperando (`esperar_comando`), com o que a linha aberta mostra e o que a tentativa precisa. */
export type ComandoDoDono = {
  id: string;
  agenteId: string;
  trabalhoId: string | null;
  turnoId: string;
  comando: string;
  motivo: string;
  desde: number;
  /** A saída da espera anterior do mesmo comando, na mesma faixa (a desta só chega quando ela acaba). */
  saidaAnterior: string | null;
  /** O turno que deixou a espera já é uma volta da cadeia; `origem` é o turno que as voltas retomam. */
  emVolta: boolean;
  origem: string;
};

export type VoltaDoDono = { agenteId: string; trabalhoId: string | null; motivo: string | null; desde: number; acordaEm: number };
/**
 * Um pedido a colega sem resposta. NOD-260 (definido em 2026-10-15): o painel "Esperando <bot>" mostra o estado do bot
 * esperado — se roda agora e quantos pedidos tem na fila — e "bot removido" quando ele foi excluído (ou não existe mais).
 */
export type ColegaDoDono = {
  agenteId: string;
  trabalhoId: string | null;
  nome: string | null;
  desde: number;
  colegaId: string | null;
  colegaRemovido: boolean;
  colegaTrabalhando: boolean;
  colegaFila: number;
  /** NOD-377: o pedido (a tarefa do handoff), a última cobrança e quantas houve — para "sem resposta há X" e o Cobrar. */
  tarefaId: string;
  cobradoEm: number | null;
  cobrancas: number;
};
export type PedidoDoDono = { turnoId: string; agenteId: string; de: DeQuemPediu; nome: string | null; desde: number };

export type FatosCrusDosDonos = {
  /** agenteId → desde quando um turno dele fora de frente roda. */
  vivos: Map<string, number>;
  /**
   * NOD-219 (definido em 2026-10-13): o mesmo, só na conversa PRÓPRIA do bot (`conversas.tipo = 'propria'`). `vivos`
   * conta também o turno numa sala; a web, que reconcilia a conversa própria pelo dono, lê este.
   */
  vivosPropria: Map<string, number>;
  /** Os trabalhos (frentes) com turno vivo agora → a máquina do turno vivo mais recente (null = ainda sem máquina). */
  frentesVivas: Map<string, string | null>;
  /** agenteId → as decisões abertas dele e a mais antiga. */
  decisoes: Map<string, { quantas: number; desde: number }>;
  comandos: ComandoDoDono[];
  voltas: VoltaDoDono[];
  colegas: ColegaDoDono[];
  fila: PedidoDoDono[];
};

/**
 * O que o estado do dono lê de cada bot (definido em 2026-10-12, ADR-099 item 10, I10). Padrão dos repositórios
 * (tipos.ts): WHERE tenant_id explícito sob RLS, só leitura. Quem decide é src/domain/estado-do-dono.ts; as frentes vêm
 * da lista de trabalhos de sempre (trabalhos.repo.ts). NOD-276 (definido em 2026-10-15): o pedido a colega sem
 * resposta conta pelo tempo que for, como em `fatos.colega` de trabalhos.repo.ts — a janela de 24 h daqui fazia a linha
 * do dono dizer "livre" enquanto a lista de trabalhos ainda dizia "esperando o colega".
 */
export function donosRepo(conn: Conn, escopo: Escopo) {
  return {
    async fatos(agenteIds: readonly string[], agora: number): Promise<FatosCrusDosDonos> {
      const vazio: FatosCrusDosDonos = { vivos: new Map(), vivosPropria: new Map(), frentesVivas: new Map(), decisoes: new Map(), comandos: [], voltas: [], colegas: [], fila: [] };
      if (agenteIds.length === 0) return vazio;
      const ids = [...agenteIds];
      const [vivos, frentesVivas, decisoes, comandos, voltas, colegas, fila] = await Promise.all([
        conn<{ agente_id: string; desde: Date; desde_propria: Date | null }[]>`
          select t.agente_id, min(coalesce(t.despachado_em, t.criado_em)) as desde, min(coalesce(t.despachado_em, t.criado_em)) filter (where c.tipo = 'propria') as desde_propria
          from turnos t left join conversas c on c.tenant_id = t.tenant_id and c.id = t.conversa_id
          where t.tenant_id = ${escopo.tenantId} and t.agente_id = any(${ids}::uuid[]) and t.estado = 'despachando' and t.trabalho_id is null
          group by t.agente_id`,
        // NOD-300: com a máquina do turno vivo mais recente de cada frente (a presença dela decide se a frente trabalha).
        conn<{ trabalho_id: string; machine_id: string | null }[]>`
          select distinct on (trabalho_id) trabalho_id, machine_id from turnos
          where tenant_id = ${escopo.tenantId} and agente_id = any(${ids}::uuid[]) and estado = 'despachando' and trabalho_id is not null
          order by trabalho_id, coalesce(despachado_em, criado_em) desc`,
        conn<{ agente_id: string; quantas: number; desde: Date }[]>`
          select agente_id, count(*)::int as quantas, min(criado_em) as desde from decisoes
          where tenant_id = ${escopo.tenantId} and agente_id = any(${ids}::uuid[]) and estado in ('pendente', 'reaberta')
          group by agente_id`,
        conn<{ id: string; agente_id: string; trabalho_id: string | null; turno_id: string; comando: string; motivo: string; criado_em: Date; saida_anterior: string | null; em_volta: boolean; origem: string }[]>`
          select e.id, e.agente_id, e.trabalho_id, e.turno_id, e.comando, e.motivo, e.criado_em,
            (select p.saida from esperas p where p.tenant_id = e.tenant_id and p.agente_id = e.agente_id
              and p.trabalho_id is not distinct from e.trabalho_id and p.comando = e.comando and p.estado <> 'rodando'
              and p.criado_em < e.criado_em order by p.criado_em desc limit 1) as saida_anterior,
            (t.acordar_em is not null and t.retoma_turno_id is not null) as em_volta,
            case when t.acordar_em is not null and t.retoma_turno_id is not null then t.retoma_turno_id else t.id end as origem
          from esperas e join turnos t on t.tenant_id = e.tenant_id and t.id = e.turno_id
          where e.tenant_id = ${escopo.tenantId} and e.agente_id = any(${ids}::uuid[]) and e.estado = 'rodando'
          order by e.criado_em, e.id`,
        // A volta marcada para mais tarde (ADR-086); o motivo é o do turno que a marcou (o mesmo `despertar_em`).
        conn<{ agente_id: string; trabalho_id: string | null; motivo: string | null; criado_em: Date; acordar_em: Date }[]>`
          select t.agente_id, t.trabalho_id, m.despertar_motivo as motivo, t.criado_em, t.acordar_em from turnos t
          left join lateral (
            select x.despertar_motivo from turnos x where x.tenant_id = t.tenant_id and x.despertar_em = t.acordar_em
              and (x.id = t.retoma_turno_id or x.retoma_turno_id = t.retoma_turno_id)
            order by x.criado_em desc limit 1
          ) m on true
          where t.tenant_id = ${escopo.tenantId} and t.agente_id = any(${ids}::uuid[]) and t.estado = 'pendente' and t.acordar_em > ${data(agora)}
          order by t.criado_em, t.id`,
        // O pedido a colega sem resposta, da conversa ou de uma frente. NOD-377: "aberto" é o pedidoAbertoSql, o mesmo do varredor.
        conn<{ agente_id: string; trabalho_id: string | null; tarefa_id: string; nome: string | null; criado_em: Date; colega_id: string | null; colega_removido: boolean; colega_trabalhando: boolean; colega_fila: number; cobrado_em: Date | null; cobrancas: number }[]>`
          select t.agente_id, t.trabalho_id, h.payload->>'tarefaId' as tarefa_id, g.nome, h.criado_em, g.id as colega_id,
            (g.excluido_em is not null) as colega_removido,
            exists (select 1 from turnos q where q.tenant_id = g.tenant_id and q.agente_id = g.id and q.estado = 'despachando') as colega_trabalhando,
            (select count(*)::int from turnos q where q.tenant_id = h.tenant_id and q.agente_id = g.id and q.estado = 'pendente'
              and (q.acordar_em is null or q.acordar_em <= ${data(agora)})) as colega_fila,
            cb.ultima as cobrado_em, coalesce(cb.quantas, 0) as cobrancas
          from mensagens h
          join turnos t on t.tenant_id = h.tenant_id and t.id = h.turno_id
          -- Revisão 2 do PR #544 (B3): os mesmos joins do varredor (esperasDeColega) — o colega é o dono do turno da tarefa;
          -- sem o turno, o painel não mostra o que o varredor nunca fecharia.
          join turnos d on d.tenant_id = h.tenant_id and d.id = ${uuidDoPayload(conn, conn`h.payload->>'tarefaId'`)}
          join agentes g on g.tenant_id = h.tenant_id and g.id = d.agente_id
          -- NOD-377: as cobranças do pedido (Cobrar ou a reentrega automática). Revisão 3 do PR #544 (M4): só as retomadas
          -- da cadeia da tarefa que COMEÇAM pela marca, como no varredor (esperasDeColega).
          left join lateral (
            with recursive cadeia(id, n) as (
              select d.id, 0
              union all
              select r.id, c.n + 1 from cadeia c join turnos r on r.tenant_id = h.tenant_id and r.retoma_turno_id = c.id and r.origem = 'retomada'
              where c.n < ${PROFUNDIDADE_DA_CADEIA}
            )
            select max(q.criado_em) as ultima, count(*)::int as quantas from cadeia c join turnos q on q.tenant_id = h.tenant_id and q.id = c.id
            where q.origem = 'retomada' and left(q.entrada_texto, length(${ENTRADA_DA_COBRANCA} || d.id::text)) = ${ENTRADA_DA_COBRANCA} || d.id::text
          ) cb on true
          -- Os mesmos filtros do varredor (esperasDeColega): da pessoa e com quem pediu vivo (o painel só mostra o que fecha).
          where h.tenant_id = ${escopo.tenantId} and h.owner_id = ${escopo.pessoaId} and h.kind = 'handoff'
            and t.agente_id = any(${ids}::uuid[]) and ${pedidoAbertoSql(conn, "h")}
            and exists (select 1 from agentes a where a.tenant_id = h.tenant_id and a.id = ${uuidDoPayload(conn, conn`h.payload->>'de'`)} and a.excluido_em is null)
          order by h.criado_em, h.id`,
        // Os pedidos na fila do dono, ainda não começados: a fala da pessoa, a triagem de um colega ou de uma rotina. A
        // ordem é a do reivindicar no que importa à tela: a pessoa passa na frente, o resto por chegada.
        conn<{ id: string; agente_id: string; origem: string; criado_em: Date; colega: string | null; rotina: string | null }[]>`
          select t.id, t.agente_id, t.origem, t.criado_em,
            (select g.nome from mensagens m join agentes g on g.tenant_id = m.tenant_id and g.id = m.autor_id
              where m.tenant_id = t.tenant_id and m.turno_id = t.id and m.kind = 'texto' and m.autor_tipo = 'agente' and m.autor_id <> t.agente_id
              order by m.criado_em limit 1) as colega,
            (select r.instrucao from rotina_janelas j join rotinas r on r.tenant_id = j.tenant_id and r.id = j.rotina_id
              where j.tenant_id = t.tenant_id and j.turno_id = t.id limit 1) as rotina
          from turnos t
          where t.tenant_id = ${escopo.tenantId} and t.agente_id = any(${ids}::uuid[]) and t.estado = 'pendente' and t.trabalho_id is null
            and (t.acordar_em is null or t.acordar_em <= ${data(agora)}) and t.origem in ('conversa', 'delegacao', 'peer', 'rotina')
          order by (t.origem = 'conversa') desc, t.criado_em, t.id`,
      ]);
      return {
        vivos: new Map(vivos.map((l) => [l.agente_id, ms(l.desde)])),
        vivosPropria: new Map(vivos.flatMap((l) => (l.desde_propria ? [[l.agente_id, ms(l.desde_propria)] as const] : []))),
        frentesVivas: new Map(frentesVivas.map((l) => [l.trabalho_id, l.machine_id])),
        decisoes: new Map(decisoes.map((l) => [l.agente_id, { quantas: l.quantas, desde: ms(l.desde) }])),
        comandos: comandos.map((l) => ({ id: l.id, agenteId: l.agente_id, trabalhoId: l.trabalho_id, turnoId: l.turno_id, comando: l.comando, motivo: l.motivo, desde: ms(l.criado_em), saidaAnterior: l.saida_anterior, emVolta: l.em_volta, origem: l.origem })),
        voltas: voltas.map((l) => ({ agenteId: l.agente_id, trabalhoId: l.trabalho_id, motivo: l.motivo, desde: ms(l.criado_em), acordaEm: ms(l.acordar_em) })),
        colegas: colegas.map((l) => ({ agenteId: l.agente_id, trabalhoId: l.trabalho_id, tarefaId: l.tarefa_id, nome: l.nome, desde: ms(l.criado_em), colegaId: l.colega_id, colegaRemovido: l.colega_removido, colegaTrabalhando: l.colega_trabalhando, colegaFila: l.colega_fila, cobradoEm: l.cobrado_em ? ms(l.cobrado_em) : null, cobrancas: l.cobrancas })),
        fila: fila.map((l) => {
          const de: DeQuemPediu = l.origem === "conversa" ? "pessoa" : l.origem === "rotina" ? "rotina" : "colega";
          return { turnoId: l.id, agenteId: l.agente_id, de, nome: de === "colega" ? l.colega : de === "rotina" ? l.rotina : null, desde: ms(l.criado_em) };
        }),
      };
    },
  };
}
