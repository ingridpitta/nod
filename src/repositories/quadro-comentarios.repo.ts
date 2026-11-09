import type { AutorLote, ComentarioDto, ComentarioTarefa } from "../contracts/quadro.ts";
import type { Turno } from "../contracts/turno.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { ms } from "./conversao.ts";
import { pedidoAbertoSql, uuidDoPayload } from "./pedidos-de-colega.repo.ts";

interface LinhaComentario {
  id: string;
  quadro_id: string;
  tarefa_id: string;
  autor: "pessoa" | "agente" | "linear";
  autor_agente_id: string | null;
  pedido_por: string | null;
  texto: string;
  de_fora: boolean;
  criado_em: Date;
}

const COLUNAS = "c.id, c.quadro_id, c.tarefa_id, c.autor, c.autor_agente_id, c.pedido_por, c.texto, c.de_fora, c.criado_em";

const paraComentario = (l: LinhaComentario): ComentarioTarefa => ({
  id: l.id,
  quadroId: l.quadro_id,
  tarefaId: l.tarefa_id,
  // Revisão do PR #630: o comentário trazido do Linear não é da pessoa.
  autor: l.autor === "linear" ? { tipo: "linear" } : l.autor === "agente" && l.autor_agente_id ? { tipo: "agente", agenteId: l.autor_agente_id } : { tipo: "pessoa" },
  texto: l.texto,
  deFora: l.de_fora,
  criadoEm: ms(l.criado_em),
  pedidoPor: l.pedido_por,
});

/**
 * definido em 2026-11-02 (NOD-417): os comentários das tarefas do quadro (0138). Só primitivas: quem comenta e aciona é
 * src/use-cases/comentar-tarefa.ts, com o quadro travado.
 */
export function quadroComentariosRepo(conn: Conn, escopo: Escopo) {
  const dona = () => conn`c.tenant_id = ${escopo.tenantId} and c.owner_id = ${escopo.pessoaId}`;
  return {
    async inserir(c: { quadroId: string; tarefaId: string; autor: AutorLote; texto: string; deFora: boolean; pedidoPor?: string | null }): Promise<ComentarioTarefa> {
      const pedidoPor = c.autor.tipo === "agente" && c.pedidoPor ? c.pedidoPor : null;
      const [l] = await conn<LinhaComentario[]>`
        insert into quadro_comentarios as c (tenant_id, owner_id, quadro_id, tarefa_id, autor, autor_agente_id, pedido_por, texto, de_fora)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${c.quadroId}, ${c.tarefaId}, ${c.autor.tipo}, ${c.autor.tipo === "agente" ? c.autor.agenteId : null}, ${pedidoPor}, ${c.texto}, ${c.deFora})
        returning ${conn.unsafe(COLUNAS)}`;
      return paraComentario(l!);
    },
    /** Os turnos que o comentário abriu ou em que se juntou (o dedup do próximo comentário acha o da fila por aqui). */
    async registrarTurnos(id: string, turnos: readonly string[]): Promise<void> {
      if (turnos.length === 0) return;
      await conn`update quadro_comentarios c set turnos = c.turnos || ${conn.array([...turnos])}::uuid[] where ${dona()} and c.id = ${id}`;
    },
    /** Os comentários da tarefa, do mais antigo ao mais novo, com o nome do autor e de quem cada um acionou. */
    async daTarefa(tarefaId: string): Promise<ComentarioDto[]> {
      const ls = await conn<(LinhaComentario & { autor_nome: string | null; acionados: string[] })[]>`
        select ${conn.unsafe(COLUNAS)}, coalesce(c.autor_nome, a.nome) as autor_nome,
          array(select distinct ag.nome from turnos t join agentes ag on ag.tenant_id = t.tenant_id and ag.id = t.agente_id
                where t.tenant_id = c.tenant_id and t.id = any(c.turnos)) as acionados
        from quadro_comentarios c left join agentes a on a.tenant_id = c.tenant_id and a.id = c.autor_agente_id
        where ${dona()} and c.tarefa_id = ${tarefaId}
        order by c.criado_em, c.id`;
      return ls.map((l) => ({ ...paraComentario(l), autorNome: l.autor_nome, acionados: l.acionados ?? [] }));
    },
    /**
     * Revisão 4 do PR #627: há no quadro algum comentário que não é deste bot (da pessoa ou de outro bot)? Uma consulta só
     * pelo quadro, no lugar de uma por tarefa (o Desfazer da criação pelo bot, soDoBot em use-cases/quadro.ts).
     */
    async temDeOutroNoQuadro(quadroId: string, agenteId: string): Promise<boolean> {
      const [l] = await conn<{ ok: boolean }[]>`
        select exists(select 1 from quadro_comentarios c
          where ${dona()} and c.quadro_id = ${quadroId}
            and (c.autor <> 'agente' or c.autor_agente_id is distinct from ${agenteId}::uuid)) as ok`;
      return l?.ok ?? false;
    },
    /**
     * Revisão 4 do PR #622: há um pedido aberto (pedidoAbertoSql) de `de` para `para` nesta tarefa — o handoff cujo turno do
     * colega um comentário da tarefa abriu (ou que é o turno dela). Pelo par e pela tarefa, não pelo turno de quem comenta:
     * a retomada do turno do colega é outro turno e segue atendendo o mesmo pedido.
     */
    async pedidoAbertoNaTarefa(tarefaId: string, de: string, para: string): Promise<boolean> {
      const turnoDoPedido = uuidDoPayload(conn, conn`h.payload->>'tarefaId'`);
      const [l] = await conn<{ ok: boolean }[]>`
        select exists(select 1 from mensagens h
          where h.tenant_id = ${escopo.tenantId} and h.owner_id = ${escopo.pessoaId} and ${pedidoAbertoSql(conn, "h")}
            and h.payload->>'de' = ${de}::text and h.payload->>'para' = ${para}::text
            and (exists (select 1 from quadro_comentarios c where ${dona()} and c.tarefa_id = ${tarefaId} and ${turnoDoPedido} = any(c.turnos))
              or exists (select 1 from quadro_tarefas qt where qt.tenant_id = h.tenant_id and qt.id = ${tarefaId} and qt.turno_id = ${turnoDoPedido}))) as ok`;
      return l?.ok ?? false;
    },
    /**
     * O dedup (NOD-417): o turno ainda na fila (pendente, sem Parar) deste bot nesta tarefa — o que a tarefa começou ou o
     * que um comentário dela abriu. Achou: o gatilho novo se junta a ele em vez de abrir outro.
     */
    async turnoNaFila(tarefaId: string, agenteId: string, turnoDaTarefa: string | null): Promise<Pick<Turno, "id"> | null> {
      const [l] = await conn<{ id: string }[]>`
        select t.id from turnos t
        where t.tenant_id = ${escopo.tenantId} and t.owner_id = ${escopo.pessoaId} and t.agente_id = ${agenteId}
          and t.estado = 'pendente' and t.parar_solicitado_em is null
          and (t.id = ${turnoDaTarefa}::uuid or t.id in (
            select unnest(c.turnos) from quadro_comentarios c where ${dona()} and c.tarefa_id = ${tarefaId}))
        order by t.criado_em desc limit 1`;
      return l ?? null;
    },
  };
}
