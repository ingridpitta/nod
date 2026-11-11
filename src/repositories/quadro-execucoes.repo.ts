import type { MotivoFalha, MotivoInterrupcao } from "../contracts/motivos.ts";
import type { Executor } from "../contracts/evento.ts";
import type { DesfechoExecucao, ExecucaoQuadro, OrigemExecucao, RecadoQuadro, SaidaTrabalho, VoltaDoTrabalho } from "../contracts/quadro-execucoes.ts";
import type { EstadoTurno } from "../contracts/turno.ts";
import type { DesfechoCadeia } from "../domain/quadro-execucoes.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { ms, msOuNull } from "./conversao.ts";
import { pedidoAbertoSql } from "./pedidos-de-colega.repo.ts";

/**
 * definido em 2026-11-02 (NOD-418): os trabalhos das tarefas do quadro e os recados da pessoa (0139). Só primitivas:
 * quem decide é src/use-cases/quadro-execucoes.ts, com o quadro travado.
 */

interface LinhaExecucao {
  id: string;
  tarefa_id: string;
  numero: number;
  sessao: number | null;
  agente_id: string | null;
  coluna: string | null;
  origem: OrigemExecucao;
  turno_id: string;
  motivo: string | null;
  desfecho: DesfechoExecucao | null;
  cancelada_em: Date | null;
  tratada_em: Date | null;
  nova_tentativa_em: Date | null;
  saida: SaidaTrabalho | null;
  sem_saida: number;
  criado_em: Date;
}
interface LinhaRecado {
  id: string;
  tarefa_id: string;
  texto: string;
  entregue_em: Date | null;
  execucao_id: string | null;
  repassado_por: string | null;
  cancelado_em: Date | null;
  criado_em: Date;
}

const COLUNAS = "id, tarefa_id, numero, sessao, agente_id, coluna, origem, turno_id, motivo, desfecho, cancelada_em, tratada_em, nova_tentativa_em, saida, sem_saida, criado_em";
const COLUNAS_RECADO = "id, tarefa_id, texto, entregue_em, execucao_id, repassado_por, cancelado_em, criado_em";

const paraExecucao = (l: LinhaExecucao): ExecucaoQuadro => ({
  id: l.id,
  tarefaId: l.tarefa_id,
  numero: l.numero,
  // O servidor de antes da 0165 no ar no mesmo deploy grava sem sessão: vale o número do gatilho, como no backfill.
  sessao: l.sessao ?? l.numero,
  agenteId: l.agente_id,
  coluna: l.coluna,
  origem: l.origem,
  turnoId: l.turno_id,
  motivo: l.motivo,
  desfecho: l.desfecho,
  canceladaEm: msOuNull(l.cancelada_em),
  tratadaEm: msOuNull(l.tratada_em),
  novaTentativaEm: msOuNull(l.nova_tentativa_em),
  saida: l.saida,
  semSaida: l.sem_saida,
  criadoEm: ms(l.criado_em),
});
const paraRecado = (l: LinhaRecado): RecadoQuadro => ({
  id: l.id,
  tarefaId: l.tarefa_id,
  texto: l.texto,
  entregueEm: msOuNull(l.entregue_em),
  execucaoId: l.execucao_id,
  repassadoPor: l.repassado_por,
  canceladoEm: msOuNull(l.cancelado_em),
  criadoEm: ms(l.criado_em),
});

export type DesfechoComFrase = DesfechoCadeia & { ultimaFrase: string | null; executor: Executor };

/** As decisões que ainda seguram uma cadeia (a pessoa responde e a retomada nasce). O "Retomar" de uma queda não conta. */
const DECISAO_ABERTA = "('pendente', 'reaberta', 'em_revisao')";

export function quadroExecucoesRepo(conn: Conn, escopo: Escopo) {
  const dona = () => conn`tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId}`;
  const pendente = () => conn`entregue_em is null and execucao_id is null and cancelado_em is null`;
  /**
   * Revisão 5 do PR #625: o recado pendente só põe a tarefa na conta do varredor onde ele pode fazer algo: a coluna abre
   * trabalho (podeAbrirTrabalho: A fazer, as do andamento, a bloqueada) ou a tarefa saiu (Feito, Cancelado: o recado sai
   * cancelado). No Backlog (ou Precisa de você sem coluna de antes) ele fica guardado para o próximo Repetir/início, sem
   * a tarefa voltar à conta a cada passo. `t` = quadro_tarefas, `q` = quadros (o grupo da coluna da pessoa).
   */
  const recadoAndaSql = () => conn`(t.status in ('afazer', 'fazendo', 'revisao', 'bloqueado', 'feito', 'cancelado')
    or (t.status = 'voce' and t.voltar_para is not null and t.voltar_para <> 'voce')
    or (t.status not in ('backlog', 'voce') and exists (select 1 from jsonb_array_elements(coalesce(q.colunas, '[]'::jsonb)) c
      where c->>'id' = t.status and c->>'grupo' in ('iniciado', 'feito', 'fechado'))))`;
  return {
    /**
     * Um gatilho novo, com o número seguinte da tarefa. O mesmo turno raiz não vira dois (null = já era trabalho).
     * ADA-10 (0165): a sessão sai aqui, num statement só (sem corrida entre ler e gravar): o bot do turno raiz repete a
     * última sessão dele na tarefa; o Repetir, ou um bot sem sessão nela, abre a seguinte. A coluna é a da tarefa agora
     * (quem chama já gravou a coluna nova antes de abrir o turno). A linha sem sessão (gravada pelo servidor de antes da
     * 0165 no mesmo deploy) vale pelo número dela, como no backfill: a sessão nova nunca repete o número de outra.
     */
    async inserir(e: { tarefaId: string; origem: OrigemExecucao; turnoId: string }): Promise<ExecucaoQuadro | null> {
      const [l] = await conn<LinhaExecucao[]>`
        with bot as (select agente_id from turnos where tenant_id = ${escopo.tenantId} and id = ${e.turnoId}),
        antes as (select numero, sessao, agente_id from quadro_execucoes where ${dona()} and tarefa_id = ${e.tarefaId}),
        dele as (select coalesce(a.sessao, a.numero) as sessao from antes a, bot b where a.agente_id = b.agente_id order by a.numero desc limit 1)
        insert into quadro_execucoes (tenant_id, owner_id, tarefa_id, numero, sessao, agente_id, coluna, origem, turno_id)
        select ${escopo.tenantId}, ${escopo.pessoaId}, ${e.tarefaId},
          coalesce((select max(numero) from antes), 0) + 1,
          coalesce(case when ${e.origem} <> 'repetir' then (select sessao from dele) end, coalesce((select max(coalesce(sessao, numero)) from antes), 0) + 1),
          (select agente_id from bot),
          (select status from quadro_tarefas where ${dona()} and id = ${e.tarefaId}),
          ${e.origem}, ${e.turnoId}
        on conflict (tenant_id, tarefa_id, turno_id) do nothing
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraExecucao(l) : null;
    },
    /** Os trabalhos de uma tarefa, do primeiro ao último. */
    async daTarefa(tarefaId: string): Promise<ExecucaoQuadro[]> {
      const ls = await conn<LinhaExecucao[]>`select ${conn.unsafe(COLUNAS)} from quadro_execucoes where ${dona()} and tarefa_id = ${tarefaId} order by numero`;
      return ls.map(paraExecucao);
    },
    /** O último trabalho de cada tarefa (o resumo do quadro que o bot lê). */
    async atuaisDasTarefas(tarefaIds: readonly string[]): Promise<ExecucaoQuadro[]> {
      if (tarefaIds.length === 0) return [];
      const ls = await conn<LinhaExecucao[]>`select distinct on (tarefa_id) ${conn.unsafe(COLUNAS)} from quadro_execucoes
        where ${dona()} and tarefa_id = any(${conn.array([...tarefaIds])}::uuid[]) order by tarefa_id, numero desc`;
      return ls.map(paraExecucao);
    },
    /**
     * As tarefas da pessoa com trabalho ainda não tratado, com recado pendente, ou com um trabalho já tratado cuja cadeia
     * ganhou uma retomada viva depois (o "Retomar" de uma queda, a resposta tardia: o varredor o reabre). A subida parte
     * dos turnos vivos que retomam outro (poucos), não dos trabalhos (muitos).
     */
    async tarefasAbertas(): Promise<string[]> {
      const ls = await conn<{ tarefa_id: string }[]>`
        with recursive sobe(id, retoma, n) as (
          select id, retoma_turno_id, 0 from turnos
          where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and estado in ('pendente', 'despachando')
            and parar_solicitado_em is null and retoma_turno_id is not null
          union all
          select t.id, t.retoma_turno_id, s.n + 1 from turnos t join sobe s on t.tenant_id = ${escopo.tenantId} and t.id = s.retoma where s.n < 50
        )
        select tarefa_id from quadro_execucoes where ${dona()} and tratada_em is null
        union select tarefa_id from quadro_execucoes where ${dona()} and nova_tentativa_em is not null
        union select r.tarefa_id from quadro_recados r
          join quadro_tarefas t on t.tenant_id = r.tenant_id and t.id = r.tarefa_id
          join quadros q on q.tenant_id = t.tenant_id and q.id = t.quadro_id
          where r.tenant_id = ${escopo.tenantId} and r.owner_id = ${escopo.pessoaId}
            and r.entregue_em is null and r.execucao_id is null and r.cancelado_em is null
            and ${recadoAndaSql()}
            and not exists (select 1 from (select cancelada_em, desfecho from quadro_execucoes x
              where x.tenant_id = r.tenant_id and x.tarefa_id = r.tarefa_id and x.origem <> 'comentario' order by x.numero desc limit 1) u
              where u.cancelada_em is not null or u.desfecho = 'cancelado')
        union select tarefa_id from quadro_execucoes where ${dona()} and tratada_em is not null and cancelada_em is null
          and turno_id in (select id from sobe)`;
      return ls.map((l) => l.tarefa_id);
    },
    /** O trabalho cujo turno raiz é este (a sessão viva acha a tarefa por aqui). */
    async doTurnoRaiz(turnoId: string): Promise<ExecucaoQuadro | null> {
      const [l] = await conn<LinhaExecucao[]>`select ${conn.unsafe(COLUNAS)} from quadro_execucoes where ${dona()} and turno_id = ${turnoId} order by criado_em desc limit 1`;
      return l ? paraExecucao(l) : null;
    },
    /**
     * ADA-10 (QA do PR marlonwlv/nod#11): a pessoa pediu Repetir no trabalho deste turno depois que ele nasceu. A sessão
     * que ele entrega (a entrega tardia do turno cancelado) já não é a do trabalho: o Repetir a largou de propósito.
     */
    async repetidoDepois(turnoId: string): Promise<boolean> {
      const [l] = await conn<{ sim: boolean }[]>`
        select exists (select 1 from quadro_execucoes e
          join turnos n on n.tenant_id = e.tenant_id and n.id = e.turno_id
          join turnos v on v.tenant_id = n.tenant_id and v.id = ${turnoId}
          where e.tenant_id = ${escopo.tenantId} and e.owner_id = ${escopo.pessoaId} and e.origem = 'repetir'
            and n.trabalho_id = v.trabalho_id and n.id <> v.id and e.criado_em > v.criado_em) as sim`;
      return l?.sim ?? false;
    },
    /** O fim do trabalho foi tratado: o desfecho fica gravado (vale depois da poda); `motivo` = a falha em palavras. */
    async tratar(id: string, desfecho: DesfechoExecucao, motivo: string | null): Promise<void> {
      await conn`update quadro_execucoes set tratada_em = coalesce(tratada_em, clock_timestamp()), desfecho = coalesce(desfecho, ${desfecho}),
        motivo = coalesce(${motivo}, motivo) where ${dona()} and id = ${id}`;
    },
    /**
     * ADA-232: a saída do turno da cadeia que acabou de assentar concluído. Vale a última; a saída de verdade zera a conta
     * dos reacionamentos sem saída da série (a próxima parada sem saída reaciona de novo).
     */
    async gravarSaida(id: string, saida: SaidaTrabalho, agora: number): Promise<void> {
      await conn`update quadro_execucoes set saida = ${saida}, saida_em = ${new Date(agora)},
        sem_saida = case when ${saida} = 'nenhuma' then sem_saida else 0 end
        where ${dona()} and id = ${id}`;
    },
    /** ADA-232: o varredor reacionou o trabalho sem saída (a série conta mais um). Só o tratado: dois passes não contam 2x. */
    async contarReacionamento(id: string): Promise<boolean> {
      const r = await conn`update quadro_execucoes set sem_saida = sem_saida + 1, saida = null
        where ${dona()} and id = ${id} and saida = 'nenhuma' and cancelada_em is null`;
      return r.count === 1;
    },
    /** Uma retomada nasceu na cadeia depois do tratamento: o trabalho volta a ser tratado quando ela acabar. */
    async reabrir(id: string): Promise<boolean> {
      const r = await conn`update quadro_execucoes set tratada_em = null, desfecho = null, motivo = null, nova_tentativa_em = null
        where ${dona()} and id = ${id} and tratada_em is not null and cancelada_em is null`;
      return r.count === 1;
    },
    /**
     * A nova tentativa sozinha fica para `em` (o varredor a abre quando passar). Revisão 5 do PR #625: `em` vem do relógio
     * do app (deps.agora() + o intervalo), o mesmo com que o varredor compara: um relógio só, não o now() do banco.
     */
    async agendarNovaTentativa(id: string, em: number): Promise<void> {
      await conn`update quadro_execucoes set nova_tentativa_em = ${new Date(em)}
        where ${dona()} and id = ${id} and tratada_em is not null and cancelada_em is null`;
    },
    /** Desfaz a nova tentativa agendada: a da tarefa toda (o Repetir, o Cancelar, o recado que abriu trabalho) ou uma só. */
    async desagendarNovaTentativa(alvo: { tarefaId: string } | { id: string }): Promise<number> {
      const r = "id" in alvo
        ? await conn`update quadro_execucoes set nova_tentativa_em = null where ${dona()} and id = ${alvo.id} and nova_tentativa_em is not null`
        : await conn`update quadro_execucoes set nova_tentativa_em = null where ${dona()} and tarefa_id = ${alvo.tarefaId} and nova_tentativa_em is not null`;
      return r.count;
    },
    async cancelar(id: string): Promise<void> {
      await conn`update quadro_execucoes set cancelada_em = coalesce(cancelada_em, clock_timestamp()) where ${dona()} and id = ${id}`;
    },
    /** O desfecho da cadeia de cada turno raiz: o vivo, senão o mais recente, com a última fala do agente na cadeia. */
    async desfechos(ids: readonly string[]): Promise<Map<string, DesfechoComFrase>> {
      if (ids.length === 0) return new Map();
      const ls = await conn<{ raiz: string; atual: string; estado: EstadoTurno; motivo_interrupcao: MotivoInterrupcao | null; motivo_falha: MotivoFalha | null; parado: boolean; despachado_em: Date | null; executor: Executor; frase: string | null; aguardando: boolean }[]>`
        with recursive desce(raiz, id, n) as (
          select id, id, 0 from turnos where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = any(${conn.array([...ids])}::uuid[])
          union all
          select d.raiz, t.id, d.n + 1 from turnos t join desce d on t.tenant_id = ${escopo.tenantId} and t.retoma_turno_id = d.id where d.n < 50
        ),
        atual as (
          select distinct on (d.raiz) d.raiz, t.id as atual, t.estado, t.motivo_interrupcao, t.motivo_falha, t.parar_solicitado_em is not null as parado, t.despachado_em, t.executor
          from desce d join turnos t on t.tenant_id = ${escopo.tenantId} and t.id = d.id
          order by d.raiz, (t.estado in ('pendente', 'despachando') and t.parar_solicitado_em is null) desc, t.criado_em desc, d.n desc
        )
        select a.*, (
          select m.texto from mensagens m
          where m.tenant_id = ${escopo.tenantId} and m.autor_tipo = 'agente' and m.kind = 'texto' and m.parcial = false
            and m.turno_id in (select id from desce where desce.raiz = a.raiz)
          order by m.criado_em desc limit 1
        ) as frase,
        -- A cadeia ainda espera (a decisão ou a aprovação da pessoa, o comando de fundo como o CI): o fim dela é uma
        -- retomada, então o trabalho não acabou. O "Retomar" de uma queda (retomar_turno) é a falha, não espera.
        (exists (select 1 from decisoes x where x.tenant_id = ${escopo.tenantId} and x.estado in ${conn.unsafe(DECISAO_ABERTA)} and x.tipo <> 'retomar_turno'
            and x.turno_id in (select id from desce where desce.raiz = a.raiz))
          or exists (select 1 from esperas x where x.tenant_id = ${escopo.tenantId} and x.estado = 'rodando'
            and x.turno_id in (select id from desce where desce.raiz = a.raiz))
          -- Revisão 4 do PR #625: o pedido a um colega (pedir_a_bot) que ainda não voltou também é espera — a resposta
          -- abre a retomada da cadeia. Sem isto o trabalho saía concluído (ou falho, e repetia) com o colega trabalhando.
          or exists (select 1 from mensagens h where h.tenant_id = ${escopo.tenantId}
            and h.turno_id in (select id from desce where desce.raiz = a.raiz) and ${pedidoAbertoSql(conn, "h")})) as aguardando
        from atual a`;
      return new Map(
        ls.map((l) => [l.raiz, { estado: l.estado, motivoInterrupcao: l.motivo_interrupcao, motivoFalha: l.motivo_falha, parado: l.parado, turnoAtual: l.atual, despachadoEm: msOuNull(l.despachado_em), aguardando: l.aguardando, executor: l.executor, ultimaFrase: l.frase }]),
      );
    },
    /**
     * ADA-232 (ADR-155): a volta que cada cadeia espera — a retomada pendente que ainda dorme (me_chame_as, com o motivo do
     * turno que a marcou e a condição 'ci') ou o comando de fundo que roda (esperar_comando, com o motivo dele). Sem
     * nenhuma das duas a cadeia não está na lista. `turnoId` = a retomada que "Acordar agora" traz para já (null no comando).
     */
    async voltasDasCadeias(raizes: readonly string[]): Promise<Map<string, VoltaDoTrabalho & { turnoId: string | null }>> {
      if (raizes.length === 0) return new Map();
      const ls = await conn<{ raiz: string; turno_id: string | null; em: Date | null; quando: "ci" | null; pr_url: string | null; motivo: string | null }[]>`
        with recursive desce(raiz, id, n) as (
          select id, id, 0 from turnos where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = any(${conn.array([...raizes])}::uuid[])
          union all
          select d.raiz, t.id, d.n + 1 from turnos t join desce d on t.tenant_id = ${escopo.tenantId} and t.retoma_turno_id = d.id where d.n < 50
        ),
        dorme as (
          select distinct on (d.raiz) d.raiz, t.id as turno_id, t.acordar_em as em, t.acordar_quando as quando, t.acordar_pr_url as pr_url,
            (select m.despertar_motivo from desce d2 join turnos m on m.tenant_id = ${escopo.tenantId} and m.id = d2.id
              where d2.raiz = d.raiz and m.despertar_motivo is not null order by m.criado_em desc limit 1) as motivo
          from desce d join turnos t on t.tenant_id = ${escopo.tenantId} and t.id = d.id
          where t.estado = 'pendente' and t.parar_solicitado_em is null and t.acordar_em > clock_timestamp()
          order by d.raiz, t.acordar_em
        ),
        comando as (
          select distinct on (d.raiz) d.raiz, null::uuid as turno_id, null::timestamptz as em, null::text as quando, null::text as pr_url, x.motivo
          from desce d join esperas x on x.tenant_id = ${escopo.tenantId} and x.turno_id = d.id and x.estado = 'rodando'
          where d.raiz not in (select raiz from dorme)
          order by d.raiz, x.criado_em desc
        )
        select * from dorme union all select * from comando`;
      return new Map(ls.map((l) => [l.raiz, { turnoId: l.turno_id, em: msOuNull(l.em), quando: l.quando, prUrl: l.pr_url, motivo: l.motivo }]));
    },
    /**
     * O Repetir e o Cancelar soltam a cadeia antiga: as decisões abertas dela, também a `em_revisao` do revisor (ADR-115;
     * revisão 3 do PR #625: sem ela, o veredito que chegava depois virava cartão e a aprovação continuava a cadeia velha)
     * — quem fecha é o caso de uso, por regra — e
     * os comandos de fundo que ainda rodam (cancelados aqui). Sem isso a resposta tardia ou o fim do CI abria a retomada
     * antiga em paralelo com o trabalho novo.
     */
    async decisoesAbertasDasCadeias(raizes: readonly string[]): Promise<string[]> {
      if (raizes.length === 0) return [];
      const ls = await conn<{ id: string }[]>`
        with recursive desce(id, n) as (
          select id, 0 from turnos where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = any(${conn.array([...raizes])}::uuid[])
          union all
          select t.id, d.n + 1 from turnos t join desce d on t.tenant_id = ${escopo.tenantId} and t.retoma_turno_id = d.id where d.n < 50
        )
        select x.id from decisoes x where x.tenant_id = ${escopo.tenantId}
          and x.estado in ${conn.unsafe(DECISAO_ABERTA)} and x.turno_id in (select id from desce)
        order by x.criado_em`;
      return ls.map((l) => l.id);
    },
    /**
     * Revisão 5 do PR #625: os pedidos a colega ainda abertos (pedidoAbertoSql) feitos nas cadeias: o turno do colega
     * (`payload.tarefaId` do handoff). O Repetir e o Cancelar os fecham e param o colega, como fazem com as decisões.
     */
    async pedidosAbertosDasCadeias(raizes: readonly string[]): Promise<string[]> {
      if (raizes.length === 0) return [];
      const ls = await conn<{ colega: string }[]>`
        with recursive desce(id, n) as (
          select id, 0 from turnos where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = any(${conn.array([...raizes])}::uuid[])
          union all
          select t.id, d.n + 1 from turnos t join desce d on t.tenant_id = ${escopo.tenantId} and t.retoma_turno_id = d.id where d.n < 50
        )
        select distinct h.payload->>'tarefaId' as colega from mensagens h where h.tenant_id = ${escopo.tenantId}
          and h.turno_id in (select id from desce) and ${pedidoAbertoSql(conn, "h")}`;
      return ls.map((l) => l.colega).filter((id) => /^[0-9a-f-]{36}$/i.test(id));
    },
    async cancelarEsperasDasCadeias(raizes: readonly string[], motivoFim: string, agora: number): Promise<number> {
      if (raizes.length === 0) return 0;
      const r = await conn`
        with recursive desce(id, n) as (
          select id, 0 from turnos where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = any(${conn.array([...raizes])}::uuid[])
          union all
          select t.id, d.n + 1 from turnos t join desce d on t.tenant_id = ${escopo.tenantId} and t.retoma_turno_id = d.id where d.n < 50
        )
        update esperas set estado = 'cancelada', motivo_fim = ${motivoFim}, terminado_em = ${new Date(agora)}
        where tenant_id = ${escopo.tenantId} and estado = 'rodando' and turno_id in (select id from desce)`;
      return r.count;
    },

    /** `repassadoPor`: o bot que repassou o pedido da pessoa feito na conversa (null = ela, pela tela). */
    async inserirRecado(tarefaId: string, texto: string, repassadoPor: string | null = null): Promise<RecadoQuadro> {
      const [l] = await conn<LinhaRecado[]>`
        insert into quadro_recados (tenant_id, owner_id, tarefa_id, texto, repassado_por) values (${escopo.tenantId}, ${escopo.pessoaId}, ${tarefaId}, ${texto}, ${repassadoPor})
        returning ${conn.unsafe(COLUNAS_RECADO)}`;
      return paraRecado(l!);
    },
    /** Os recados ainda não lidos, na ordem em que a pessoa mandou. */
    /** Algum recado pendente da pessoa (o curto-circuito da oferta em cada renovação; o índice parcial é pequeno). */
    async temRecadoPendente(): Promise<boolean> {
      const [l] = await conn<{ tem: boolean }[]>`select exists (select 1 from quadro_recados where ${dona()} and ${pendente()}) as tem`;
      return l?.tem ?? false;
    },
    async recadosPendentes(tarefaId: string): Promise<RecadoQuadro[]> {
      const ls = await conn<LinhaRecado[]>`select ${conn.unsafe(COLUNAS_RECADO)} from quadro_recados where ${dona()} and tarefa_id = ${tarefaId} and ${pendente()} order by criado_em, id`;
      return ls.map(paraRecado);
    },
    /** Os pendentes e o último lido (a tela mostra "Leu seu recado"). */
    async recadosDaTela(tarefaId: string): Promise<RecadoQuadro[]> {
      const ls = await conn<LinhaRecado[]>`
        (select ${conn.unsafe(COLUNAS_RECADO)} from quadro_recados where ${dona()} and tarefa_id = ${tarefaId} and ${pendente()})
        union all
        (select ${conn.unsafe(COLUNAS_RECADO)} from quadro_recados where ${dona()} and tarefa_id = ${tarefaId} and entregue_em is not null order by entregue_em desc limit 1)`;
      return ls.map(paraRecado).sort((a, b) => a.criadoEm - b.criadoEm);
    },
    /**
     * A sessão viva confirmou a entrega (só os ainda pendentes; repetir a confirmação não muda nada). Só os recados da
     * tarefa cujo trabalho (não cancelado) roda na cadeia deste turno: o id de outra tarefa, ou de um turno que não é de
     * trabalho do quadro, não sai lido.
     */
    async entregarRecados(ids: readonly string[], turnoId: string): Promise<number> {
      if (ids.length === 0) return 0;
      const r = await conn`
        with recursive sobe(id, retoma, n) as (
          select id, retoma_turno_id, 0 from turnos where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${turnoId}
          union all
          select t.id, t.retoma_turno_id, s.n + 1 from turnos t join sobe s on t.tenant_id = ${escopo.tenantId} and t.id = s.retoma where s.n < 50
        )
        update quadro_recados r set entregue_em = clock_timestamp(), entregue_turno_id = ${turnoId}
        where r.tenant_id = ${escopo.tenantId} and r.owner_id = ${escopo.pessoaId} and r.id = any(${conn.array([...ids])}::uuid[])
          and r.entregue_em is null and r.execucao_id is null and r.cancelado_em is null
          and exists (select 1 from quadro_execucoes e where e.tenant_id = r.tenant_id and e.owner_id = r.owner_id and e.tarefa_id = r.tarefa_id
            and e.cancelada_em is null and e.turno_id in (select id from sobe))`;
      return r.count;
    },
    /** Os pendentes entram no pedido de um turno (o trabalho novo, ou o da fila): saem da fila, lidos por ele. */
    async levarRecados(tarefaId: string, execucaoId: string, turnoId: string, ids: readonly string[]): Promise<void> {
      if (ids.length === 0) return;
      await conn`update quadro_recados set execucao_id = ${execucaoId}, entregue_em = clock_timestamp(), entregue_turno_id = ${turnoId}
        where ${dona()} and tarefa_id = ${tarefaId} and id = any(${conn.array([...ids])}::uuid[]) and (${pendente()} or (entregue_em is not null and execucao_id is null and entregue_turno_id is null))`;
    },
    /**
     * Revisão 4 do PR #625: o trabalho novo toma os pendentes ANTES de montar o pedido, e o pedido leva só o que este
     * update marcou (returning). A confirmação da sessão viva que chega no meio (entregarRecados, sem a trava do quadro)
     * não acha o recado pendente: ele não sai em dois lugares por esta corrida. `levarRecados` completa a marca com o trabalho.
     */
    async tomarPendentes(tarefaId: string): Promise<RecadoQuadro[]> {
      const ls = await conn<LinhaRecado[]>`update quadro_recados set entregue_em = clock_timestamp()
        where ${dona()} and tarefa_id = ${tarefaId} and ${pendente()}
        returning ${conn.unsafe(COLUNAS_RECADO)}`;
      return ls.map(paraRecado).sort((a, b) => a.criadoEm - b.criadoEm || (a.id < b.id ? -1 : 1));
    },
    /** Devolve à fila o que `tomarPendentes` tomou e nenhum trabalho levou (o turno novo não abriu). */
    async devolverTomados(tarefaId: string, ids: readonly string[]): Promise<void> {
      if (ids.length === 0) return;
      await conn`update quadro_recados set entregue_em = null
        where ${dona()} and tarefa_id = ${tarefaId} and id = any(${conn.array([...ids])}::uuid[]) and execucao_id is null and entregue_turno_id is null`;
    },
    async cancelarRecados(tarefaId: string): Promise<number> {
      const r = await conn`update quadro_recados set cancelado_em = clock_timestamp() where ${dona()} and tarefa_id = ${tarefaId} and ${pendente()}`;
      return r.count;
    },
  };
}
