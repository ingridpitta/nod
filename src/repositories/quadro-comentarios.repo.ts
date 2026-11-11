import type { AutorLote, ComentarioDto, ComentarioTarefa } from "../contracts/quadro.ts";
import type { Turno } from "../contracts/turno.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { ms } from "./conversao.ts";
import { pedidoAbertoSql, uuidDoPayload } from "./pedidos-de-colega.repo.ts";

interface LinhaComentario {
  id: string;
  quadro_id: string;
  tarefa_id: string;
  autor: "pessoa" | "agente" | "linear" | "sistema";
  autor_agente_id: string | null;
  pedido_por: string | null;
  texto: string;
  de_fora: boolean;
  criado_em: Date;
  pai_id: string | null;
  editado_em: Date | null;
  apagado_em: Date | null;
}

const COLUNAS = "c.id, c.quadro_id, c.tarefa_id, c.autor, c.autor_agente_id, c.pedido_por, c.texto, c.de_fora, c.criado_em, c.pai_id, c.editado_em, c.apagado_em";
/** O texto que fica no lugar do comentário apagado (o CHECK do texto não aceita vazio; o DTO devolve vazio). */
const MARCA_APAGADO = "(apagado)";

const paraComentario = (l: LinhaComentario): ComentarioTarefa => ({
  id: l.id,
  quadroId: l.quadro_id,
  tarefaId: l.tarefa_id,
  // Revisão do PR #630: o comentário trazido do Linear não é da pessoa.
  autor: l.autor === "linear" ? { tipo: "linear" } : l.autor === "sistema" ? { tipo: "sistema" } : l.autor === "agente" && l.autor_agente_id ? { tipo: "agente", agenteId: l.autor_agente_id } : { tipo: "pessoa" },
  texto: l.texto,
  deFora: l.de_fora,
  criadoEm: ms(l.criado_em),
  pedidoPor: l.pedido_por,
});

/** 2026-11-10 (0159): a thread e a marca de editado/apagado, que vão no DTO. */
const extras = (l: LinhaComentario) => ({ paiId: l.pai_id, editadoEm: l.editado_em ? ms(l.editado_em) : null, apagado: l.apagado_em !== null });

/** Um comentário da thread como a rota do domínio o lê (agenteDaThread): quem escreveu e os agentes que ele acionou. */
export type MensagemDaThread = { id: string; autorAgenteId: string | null; acionados: string[]; autorNome: string | null; texto: string; apagado: boolean };

/**
 * definido em 2026-11-02 (NOD-417): os comentários das tarefas do quadro (0138). Só primitivas: quem comenta e aciona é
 * src/use-cases/comentar-tarefa.ts, com o quadro travado.
 */
export function quadroComentariosRepo(conn: Conn, escopo: Escopo) {
  const dona = () => conn`c.tenant_id = ${escopo.tenantId} and c.owner_id = ${escopo.pessoaId}`;
  return {
    async inserir(c: { quadroId: string; tarefaId: string; autor: AutorLote | { tipo: "sistema" }; texto: string; deFora: boolean; pedidoPor?: string | null; paiId?: string | null }): Promise<ComentarioTarefa & { paiId: string | null }> {
      const pedidoPor = c.autor.tipo === "agente" && c.pedidoPor ? c.pedidoPor : null;
      const [l] = await conn<LinhaComentario[]>`
        insert into quadro_comentarios as c (tenant_id, owner_id, quadro_id, tarefa_id, autor, autor_agente_id, pedido_por, texto, de_fora, pai_id)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${c.quadroId}, ${c.tarefaId}, ${c.autor.tipo}, ${c.autor.tipo === "agente" ? c.autor.agenteId : null}, ${pedidoPor}, ${c.texto}, ${c.deFora}, ${c.paiId ?? null})
        returning ${conn.unsafe(COLUNAS)}`;
      return { ...paraComentario(l!), paiId: l!.pai_id };
    },
    /** Um comentário da tarefa (a raiz de uma resposta, o que se edita ou apaga). */
    async buscar(tarefaId: string, id: string): Promise<(ComentarioTarefa & { paiId: string | null; apagado: boolean; turnos: string[] }) | null> {
      const [l] = await conn<(LinhaComentario & { turnos: string[] })[]>`
        select ${conn.unsafe(COLUNAS)}, c.turnos from quadro_comentarios c where ${dona()} and c.tarefa_id = ${tarefaId} and c.id = ${id}`;
      return l ? { ...paraComentario(l), paiId: l.pai_id, apagado: l.apagado_em !== null, turnos: l.turnos ?? [] } : null;
    },
    /** A thread inteira (a raiz e as respostas, em ordem), com os agentes que cada comentário acionou. */
    async thread(raizId: string): Promise<MensagemDaThread[]> {
      const ls = await conn<{ id: string; autor_agente_id: string | null; acionados: string[]; autor_nome: string | null; texto: string; apagado: boolean }[]>`
        select c.id, c.autor_agente_id, coalesce(c.autor_nome, a.nome) as autor_nome, c.texto, c.apagado_em is not null as apagado,
          array(select t.agente_id from turnos t where t.tenant_id = c.tenant_id and t.id = any(c.turnos) order by t.criado_em) as acionados
        from quadro_comentarios c left join agentes a on a.tenant_id = c.tenant_id and a.id = c.autor_agente_id
        where ${dona()} and (c.id = ${raizId} or c.pai_id = ${raizId})
        order by (c.id = ${raizId}) desc, c.criado_em, c.id`;
      return ls.map((l) => ({ id: l.id, autorAgenteId: l.autor_agente_id, acionados: l.acionados ?? [], autorNome: l.autor_nome, texto: l.apagado ? "" : l.texto, apagado: l.apagado }));
    },
    /**
     * A thread em que o turno raiz `turnoId` foi acionado nesta tarefa (a raiz dela), para a resposta do agente cair na
     * mesma thread sem ele precisar dizer. null = o turno não veio de comentário (o trabalho da tarefa).
     */
    async threadDoTurno(tarefaId: string, turnoId: string): Promise<string | null> {
      const [l] = await conn<{ raiz: string }[]>`
        select coalesce(c.pai_id, c.id) as raiz from quadro_comentarios c
        where ${dona()} and c.tarefa_id = ${tarefaId} and ${turnoId}::uuid = any(c.turnos)
        order by c.criado_em desc limit 1`;
      return l?.raiz ?? null;
    },
    /** O autor troca o texto do próprio comentário (o caso de uso confere o autor). */
    async editar(id: string, texto: string): Promise<boolean> {
      const ls = await conn`update quadro_comentarios c set texto = ${texto}, editado_em = clock_timestamp() where ${dona()} and c.id = ${id} and c.apagado_em is null returning c.id`;
      return ls.length > 0;
    },
    /** Apagar é lógico: o texto vira marcador e as respostas seguem penduradas na raiz. */
    async apagar(id: string): Promise<boolean> {
      const ls = await conn`update quadro_comentarios c set texto = ${MARCA_APAGADO}, apagado_em = clock_timestamp() where ${dona()} and c.id = ${id} and c.apagado_em is null returning c.id`;
      return ls.length > 0;
    },
    /** Os turnos que o comentário abriu ou em que se juntou (o dedup do próximo comentário acha o da fila por aqui). */
    async registrarTurnos(id: string, turnos: readonly string[]): Promise<void> {
      if (turnos.length === 0) return;
      await conn`update quadro_comentarios c set turnos = c.turnos || ${conn.array([...turnos])}::uuid[] where ${dona()} and c.id = ${id}`;
    },
    /** Os comentários da tarefa, do mais antigo ao mais novo, com o nome do autor e de quem cada um acionou. */
    async daTarefa(tarefaId: string): Promise<ComentarioDto[]> {
      const ls = await conn<(LinhaComentario & { autor_nome: string | null; acionados: string[]; turnos: string[]; respostas: boolean })[]>`
        select ${conn.unsafe(COLUNAS)}, coalesce(c.autor_nome, a.nome) as autor_nome, c.turnos,
          exists(select 1 from quadro_comentarios r where r.tenant_id = c.tenant_id and r.pai_id = c.id and r.apagado_em is null) as respostas,
          array(select distinct ag.nome from turnos t join agentes ag on ag.tenant_id = t.tenant_id and ag.id = t.agente_id
                where t.tenant_id = c.tenant_id and t.id = any(c.turnos)) as acionados
        from quadro_comentarios c left join agentes a on a.tenant_id = c.tenant_id and a.id = c.autor_agente_id
        where ${dona()} and c.tarefa_id = ${tarefaId}
        order by c.criado_em, c.id`;
      // O apagado sem resposta viva some; com resposta, fica como marcador sem texto (a thread não perde a raiz).
      return ls.filter((l) => l.apagado_em === null || l.respostas).map((l) => ({ ...paraComentario(l), ...extras(l), texto: l.apagado_em ? "" : l.texto, autorNome: l.autor_nome, acionados: l.acionados ?? [], turnos: l.turnos ?? [] }));
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
     * que um comentário dela abriu. Achou: o gatilho novo se junta a ele em vez de abrir outro. É o do lote (a tarefa que
     * começa); o comentário usa turnoNaFilaDaThread.
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
    async turnoNaFilaDaThread(tarefaId: string, agenteId: string, raizId: string): Promise<Pick<Turno, "id"> | null> {
      // 2026-11-10 (coalesce por thread, como o Multica): só o turno da fila que um comentário DESTA thread abriu (a raiz
      // e as respostas). Outra thread, ou o trabalho da tarefa (início, Repetir), tem a sua vez; o mesmo bot roda em série
      // na conversa dele.
      const [l] = await conn<{ id: string }[]>`
        select t.id from turnos t
        where t.tenant_id = ${escopo.tenantId} and t.owner_id = ${escopo.pessoaId} and t.agente_id = ${agenteId}
          and t.estado = 'pendente' and t.parar_solicitado_em is null
          and t.id in (select unnest(c.turnos) from quadro_comentarios c where ${dona()} and c.tarefa_id = ${tarefaId} and (c.id = ${raizId} or c.pai_id = ${raizId}))
        order by t.criado_em desc limit 1`;
      return l ?? null;
    },
    /**
     * O resumo de cada cadeia (o turno raiz e as retomadas) para a linha do tempo e o Registro de execução: o agente, quando
     * nasceu, o custo e os tokens somados nos gastos e o último sinal (o fim, quando a cadeia acabou). O estado e a frase
     * vêm de quadroExecucoes.desfechos, a mesma leitura do trabalho da tarefa.
     */
    async resumoDasCadeias(ids: readonly string[]): Promise<Map<string, { agenteId: string; criadoEm: number; custoUsd: number | null; tokens: number | null; fimEm: number | null }>> {
      if (ids.length === 0) return new Map();
      const ls = await conn<{ raiz: string; agente_id: string; criado_em: Date; custo: string | null; tokens: string | null; fim: Date | null }[]>`
        with recursive desce(raiz, id, n) as (
          select id, id, 0 from turnos where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = any(${conn.array([...ids])}::uuid[])
          union all
          select d.raiz, t.id, d.n + 1 from turnos t join desce d on t.tenant_id = ${escopo.tenantId} and t.retoma_turno_id = d.id where d.n < 50
        )
        select r.id as raiz, r.agente_id, r.criado_em,
          (select sum(g.custo_usd) from gastos g where g.tenant_id = ${escopo.tenantId} and g.turno_id in (select id from desce where desce.raiz = r.id)) as custo,
          (select sum(g.tokens_entrada + g.tokens_saida) from gastos g where g.tenant_id = ${escopo.tenantId} and g.turno_id in (select id from desce where desce.raiz = r.id)) as tokens,
          greatest((select max(g.em) from gastos g where g.tenant_id = ${escopo.tenantId} and g.turno_id in (select id from desce where desce.raiz = r.id)),
            (select max(t2.ultimo_sinal_em) from turnos t2 where t2.tenant_id = ${escopo.tenantId} and t2.id in (select id from desce where desce.raiz = r.id))) as fim
        from turnos r where r.tenant_id = ${escopo.tenantId} and r.owner_id = ${escopo.pessoaId} and r.id = any(${conn.array([...ids])}::uuid[])`;
      return new Map(ls.map((l) => [l.raiz, { agenteId: l.agente_id, criadoEm: ms(l.criado_em), custoUsd: l.custo === null ? null : Number(l.custo), tokens: l.tokens === null ? null : Number(l.tokens), fimEm: l.fim ? ms(l.fim) : null }]));
    },
    /** Os turnos vivos (fila ou rodando, sem Parar) deste bot que comentários desta tarefa abriram: o "no lugar" os para. */
    async turnosVivos(tarefaId: string, agenteId: string): Promise<{ id: string; estado: "pendente" | "despachando" }[]> {
      return conn<{ id: string; estado: "pendente" | "despachando" }[]>`
        select t.id, t.estado from turnos t
        where t.tenant_id = ${escopo.tenantId} and t.owner_id = ${escopo.pessoaId} and t.agente_id = ${agenteId}
          and t.estado in ('pendente', 'despachando') and t.parar_solicitado_em is null
          and t.id in (select unnest(c.turnos) from quadro_comentarios c where ${dona()} and c.tarefa_id = ${tarefaId})
        order by t.criado_em`;
    },
  };
}
