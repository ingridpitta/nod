import type { TipoDecisao } from "../contracts/decisao.ts";
import type { LoteNaTela } from "../contracts/dono.ts";
import type { MotivoInterrupcao } from "../contracts/motivos.ts";
import type { Executor } from "../contracts/evento.ts";
import type { FormaTrabalho, ResumoFrente } from "../contracts/frente.ts";
import { ESTADOS_ABERTOS_TRABALHO, type EstadoTrabalho, type OrigemTrabalho, type Trabalho } from "../contracts/trabalho.ts";
import type { EstadoTurno } from "../contracts/turno.ts";
import { ENTRADA_DA_VOLTA_DA_COTA } from "../domain/cota-da-ia.ts";
import { IDADE_MAX_PEDIDO_RETOMAVEL_MS, MOTIVOS_DE_QUEDA, MOTIVOS_FALHA_SEM_QUEDA, type PedidoParado } from "../domain/pedido-parado.ts";
import type { FatosLimpeza } from "../domain/limpeza-das-tasks.ts";
import type { FatosTrabalho } from "../domain/trabalho.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { alvoDoTurno } from "./alvo-da-maquina.ts";
import { pedidoAbertoSql } from "./pedidos-de-colega.repo.ts";
import { data, ms, msOuNull } from "./conversao.ts";

interface Linha {
  tenant_id: string;
  id: string;
  agente_id: string;
  conversa_id: string;
  titulo: string;
  origem: OrigemTrabalho;
  pedido_por_agente_id: string | null;
  rotina_id: string | null;
  trabalho_mae_id: string | null;
  depois_de_trabalho_id: string | null;
  estado: EstadoTrabalho;
  sessao_cli: string | null;
  sessao_harness: string | null;
  sessao_executor: string | null;
  pasta: string | null;
  memoria_mb: number | null;
  custo_usd: string | null;
  custo_parcial: boolean;
  pessoa_esperando: boolean;
  forma: FormaTrabalho;
  lote_id: string | null;
  resumo: ResumoFrente | null;
  repo: string | null;
  tarefa_id: string | null;
  criado_em: Date;
  iniciado_em: Date | null;
  terminado_em: Date | null;
}

/**
 * ADR-106 (definido em 2026-10-15): o teto da consulta da limpeza quando a máquina manda os códigos das pastas. A lista
 * vem com até 5.000 (`PASTAS_DA_MAQUINA_MAX`); o dobro cobre pasta com mais de uma task (a decidida por quem chamou).
 */
const TETO_COM_CODIGOS = 10_000;

const COLUNAS =
  "tenant_id, id, agente_id, conversa_id, titulo, origem, pedido_por_agente_id, rotina_id, trabalho_mae_id, depois_de_trabalho_id, estado, sessao_cli, sessao_harness, sessao_executor, pasta, memoria_mb, custo_usd, custo_parcial, pessoa_esperando, forma, lote_id, resumo, repo, tarefa_id, criado_em, iniciado_em, terminado_em";

const paraTrabalho = (l: Linha): Trabalho => ({
  tenantId: l.tenant_id,
  id: l.id,
  agenteId: l.agente_id,
  conversaId: l.conversa_id,
  titulo: l.titulo,
  origem: l.origem,
  pedidoPorAgenteId: l.pedido_por_agente_id,
  rotinaId: l.rotina_id,
  trabalhoMaeId: l.trabalho_mae_id,
  depoisDeTrabalhoId: l.depois_de_trabalho_id,
  estado: l.estado,
  sessaoCli: l.sessao_cli,
  sessaoHarness: l.sessao_harness,
  sessaoExecutor: l.sessao_executor === "local" || l.sessao_executor === "catcher" ? l.sessao_executor : null,
  pasta: l.pasta,
  memoriaMb: l.memoria_mb,
  custoUsd: l.custo_usd === null ? null : Number(l.custo_usd),
  ...(l.custo_parcial ? { custoParcial: true } : {}),
  pessoaEsperando: l.pessoa_esperando,
  forma: l.forma,
  loteId: l.lote_id,
  resumo: l.resumo,
  ...(l.repo ? { repo: l.repo } : {}),
  ...(l.tarefa_id ? { tarefaId: l.tarefa_id } : {}),
  criadoEm: ms(l.criado_em),
  iniciadoEm: msOuNull(l.iniciado_em),
  terminadoEm: msOuNull(l.terminado_em),
});

export type NovoTrabalho = {
  id?: string;
  agenteId: string;
  conversaId: string;
  titulo: string;
  origem: OrigemTrabalho;
  pedidoPorAgenteId?: string | null;
  rotinaId?: string | null;
  trabalhoMaeId?: string | null;
  depoisDeTrabalhoId?: string | null;
  /** A rede de 2 min já nasce `rodando`, com a sessão do turno promovido. */
  estado?: EstadoTrabalho;
  sessaoCli?: string | null;
  sessaoHarness?: string | null;
  sessaoExecutor?: Executor | null;
  pasta?: string | null;
  iniciadoEm?: number | null;
  /** ADR-085: a pessoa pediu e espera (o Mac apertado não segura). */
  pessoaEsperando?: boolean;
  /** ADR-099 (0071): `frente` trabalha por baixo do dono; ausente = `task`. Com `loteId`, a frente nasce no lote. */
  forma?: FormaTrabalho;
  loteId?: string | null;
  /** NOD-315 (0102): o `dono/nome` do GitHub da frente, já validado (`repoDoGithub`). */
  repo?: string | null;
  /** ADA-232 (0153); ADA-289 (0164): também a tarefa do trabalho da própria tarefa (origem `quadro`, forma `task`, um por bot e tarefa). ADA-232 (0157): a tarefa do quadro de onde a frente nasceu — o card conta a frente aberta como trabalhando. ADA-28 (ADR-159): o `terminei` e o `pr_url` da frente valem para a tarefa. */
  tarefaId?: string | null;
};

/** O que a faixa, as listas e o prompt mostram além da linha: lido junto, numa consulta. */
/** `turnosAbertos`: pendentes e rodando (o computador ocupado olha os dois). */
/**
 * `deFora` (revisão do épico, S24, 2026-10-08): o título e o último passo podem trazer texto de fora — a task é de um
 * colega (o título é o pedido de outro bot) ou um turno dela leu conteúdo de fora (ADR-062) ou nasceu não confiável.
 */
export type ExtrasTrabalho = {
  pedidoPorNome: string | null;
  rotinaNome: string | null;
  ultimaFala: string | null;
  turnoVivoId: string | null;
  turnosAbertos: string[];
  deFora: boolean;
  /** O pedido a colega mais antigo ainda sem volta (a mesma regra de `fatos.colega`): de quem, desde quando e a task dele. */
  esperandoColega: { nome: string; desde: number; trabalhoId: string | null; tarefaId?: string | null } | null;
  /** Soma, por turno com Raio-X, do começo ao último sinal (o que roda conta até agora), em ms. */
  trabalhouMs: number;
  /** ADR-086: a volta marcada ("me chame às 16:00") ainda por vir — a mais próxima; null = nenhuma. */
  acordaEm: number | null;
  /** ADR-099 (parte 2): o comando que o trabalho deixou esperando e ainda roda — o motivo e desde quando; null = nenhum. */
  esperandoComando: { motivo: string; desde: number } | null;
  /**
   * definido em 2026-10-09 (a tela fala por máquina): a máquina do turno que roda agora (`turnos.machine_id`) e o alvo do
   * turno pendente mais antigo (alvo-da-maquina.ts, a regra do `reivindicar`). null = sem turno vivo / sem alvo (qualquer
   * máquina; com o servidor no Mac, o Mac).
   */
  maquinaVivaId: string | null;
  maquinaAlvoId: string | null;
  /**
   * NOD-260 (definido em 2026-10-15, D3): a IA e o modelo do turno pendente mais antigo — quem decide se a cota segura é
   * a IA que vai rodar, não a de agora do bot (a pessoa pode ter trocado). null = sem turno pendente.
   */
  pendente?: { harness: string; modelo: string } | null;
  /** ADR-099 (I10): o motivo da volta marcada mais próxima; null = nenhuma (ou sem motivo). */
  acordaMotivo?: string | null;
  /** ADR-099 (I10): o lote da frente; null = sem lote. */
  lote?: LoteNaTela | null;
  /** Plano chat limpo (PR 5, 0092): o `titulo_do_lote` gravado; null = sem lote ou o modelo não mandou. */
  loteTitulo?: string | null;
};

/**
 * Trabalhos do bot (ADR-083, 0063). Padrão dos repositórios (tipos.ts): WHERE tenant_id explícito sob RLS, escrita só
 * da dona (owner_id), T | null sem lançar. O estado é decidido em src/domain/trabalho.ts (estadoDoTrabalho) a partir de
 * `fatos`; aqui só se grava.
 */
export function trabalhosRepo(conn: Conn, escopo: Escopo) {
  return {
    async criar(n: NovoTrabalho): Promise<Trabalho | null> {
      const [l] = await conn<Linha[]>`
        insert into trabalhos (tenant_id, id, owner_id, agente_id, conversa_id, titulo, origem, pedido_por_agente_id, rotina_id, trabalho_mae_id,
          depois_de_trabalho_id, estado, sessao_cli, sessao_harness, sessao_executor, pasta, iniciado_em, pessoa_esperando, forma, lote_id, repo, tarefa_id)
        values (${escopo.tenantId}, ${n.id ?? conn`gen_random_uuid()`}, ${escopo.pessoaId}, ${n.agenteId}, ${n.conversaId}, ${n.titulo}, ${n.origem},
          ${n.pedidoPorAgenteId ?? null}, ${n.rotinaId ?? null}, ${n.trabalhoMaeId ?? null}, ${n.depoisDeTrabalhoId ?? null}, ${n.estado ?? "na_fila"},
          ${n.sessaoCli ?? null}, ${n.sessaoHarness ?? null}, ${n.sessaoCli ? (n.sessaoExecutor ?? null) : null}, ${n.pasta ?? null}, ${n.iniciadoEm === undefined || n.iniciadoEm === null ? null : data(n.iniciadoEm)}, ${n.pessoaEsperando === true},
          ${n.forma ?? "task"}, ${n.loteId ?? null}, ${n.repo ?? null}, ${n.tarefaId ?? null})
        ${n.tarefaId && n.origem === "quadro" && (n.forma ?? "task") === "task" ? conn`on conflict (tenant_id, agente_id, tarefa_id) where tarefa_id is not null and origem = 'quadro' and forma = 'task' do nothing` : conn``}
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraTrabalho(l) : null;
    },

    /**
     * ADA-16 (ADR-163): o trabalho do bot na tarefa do quadro (um só por par, índice `trabalhos_da_tarefa`), em qualquer
     * estado. Com `travar`, FOR NO KEY UPDATE: duas etapas da mesma tarefa abrindo turno ao mesmo tempo se enfileiram.
     */
    async daTarefa(agenteId: string, tarefaId: string, o: { travar?: boolean } = {}): Promise<Trabalho | null> {
      const [l] = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from trabalhos
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and agente_id = ${agenteId} and tarefa_id = ${tarefaId} and origem = 'quadro' and forma = 'task'
        ${o.travar ? conn`for no key update` : conn``}`;
      return l ? paraTrabalho(l) : null;
    },

    /** ADA-232: das tarefas dadas, as que têm uma frente aberta (nascida delas, ainda em estado aberto). */
    async tarefasComFrenteAberta(tarefaIds: string[]): Promise<Set<string>> {
      if (tarefaIds.length === 0) return new Set();
      const ls = await conn<{ tarefa_id: string }[]>`select distinct tarefa_id from trabalhos
        where tenant_id = ${escopo.tenantId} and tarefa_id = any(${tarefaIds}::uuid[]) and forma = 'frente' and estado = any(${[...ESTADOS_ABERTOS_TRABALHO]}::text[])`;
      return new Set(ls.map((l) => l.tarefa_id));
    },

    async buscar(id: string): Promise<Trabalho | null> {
      const [l] = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from trabalhos where tenant_id = ${escopo.tenantId} and id = ${id}`;
      return l ? paraTrabalho(l) : null;
    },

    /**
     * Com trava de linha: quem recalcula o estado serializa com o Parar e com a outra sincronização. revisto em 2026-10-08
     * (revisão do épico, S20): FOR NO KEY UPDATE — o turno novo que aponta para o trabalho (FK, FOR KEY SHARE) não espera.
     */
    async buscarTravado(id: string): Promise<Trabalho | null> {
      const [l] = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from trabalhos where tenant_id = ${escopo.tenantId} and id = ${id} for no key update`;
      return l ? paraTrabalho(l) : null;
    },

    /**
     * Os abertos e os que terminaram desde `terminadosDesde` (a tela filtra "hoje" no fuso dela), do bot ou de todos
     * os bots da pessoa. Abertos primeiro, mais novos primeiro.
     */
    async listar(p: { agenteId?: string; terminadosDesde: number }): Promise<Trabalho[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from trabalhos
        where tenant_id = ${escopo.tenantId} ${p.agenteId ? conn`and agente_id = ${p.agenteId}` : conn``}
          and (estado in ('na_fila', 'rodando', 'precisa_de_voce', 'fechado_ocioso') or terminado_em >= ${data(p.terminadosDesde)})
        order by (terminado_em is null) desc, criado_em desc, id desc
        limit 200`;
      return linhas.map(paraTrabalho);
    },

    async abertosDoAgente(agenteId: string): Promise<Trabalho[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from trabalhos
        where tenant_id = ${escopo.tenantId} and agente_id = ${agenteId} and estado in ('na_fila', 'rodando', 'precisa_de_voce', 'fechado_ocioso')
        order by criado_em, id`;
      return linhas.map(paraTrabalho);
    },

    /** Os trabalhos que uma task de rotina abriu (profundidade 1). */
    async filhos(maeId: string): Promise<Trabalho[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from trabalhos where tenant_id = ${escopo.tenantId} and trabalho_mae_id = ${maeId} order by criado_em, id`;
      return linhas.map(paraTrabalho);
    },

    /**
     * definido em 2026-10-08 (revisão do épico, S12): uma task aberta por uma execução desta rotina (filha, com mãe) que
     * ainda não acabou. Enquanto houver, a próxima execução do agendador é pulada. revisto em 2026-10-12 (ADR-099, I7
     * revista): também a frente que o dono abriu na triagem da rotina (sem mãe: o lote é do dono). revisto na I10: a
     * execução de rotina de antes, migrada pela 0072 para `frente` sem lote, não segura a próxima (como antes).
     * revisto em 2026-10-16 (NOD-274, C9): com `colegaAntesDe`, a frente 'rodando' sem turno vivo cujo único fato aberto é
     * um pedido a colega feito antes desse instante (a regra de fatos.colega) não segura a rotina — não devolve a frente,
     * só destrava a rotina. Quem chama passa agora − 2 períodos do cron (mín. 2 h).
     */
    async filhaAbertaDaRotina(rotinaId: string, colegaAntesDe: number | null = null): Promise<Trabalho | null> {
      const [l] = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from trabalhos w
        where tenant_id = ${escopo.tenantId} and rotina_id = ${rotinaId} and (trabalho_mae_id is not null or (forma = 'frente' and lote_id is not null))
          and estado in ('na_fila', 'rodando', 'precisa_de_voce', 'fechado_ocioso')
          and not (${colegaAntesDe === null ? null : data(colegaAntesDe)}::timestamptz is not null and w.estado = 'rodando'
            and not exists (select 1 from turnos v where v.tenant_id = w.tenant_id and v.trabalho_id = w.id and v.estado in ('pendente', 'despachando'))
            and not exists (select 1 from esperas e where e.tenant_id = w.tenant_id and e.trabalho_id = w.id and e.estado = 'rodando')
            and not exists (select 1 from decisoes d join turnos t on t.tenant_id = d.tenant_id and t.id = d.turno_id
              where d.tenant_id = w.tenant_id and t.trabalho_id = w.id and d.estado in ('pendente', 'reaberta'))
            and exists (select 1 from mensagens h join turnos t on t.tenant_id = h.tenant_id and t.id = h.turno_id
              where h.tenant_id = w.tenant_id and t.trabalho_id = w.id and h.kind = 'handoff' and h.payload->>'tarefaId' is not null
                and h.criado_em < ${colegaAntesDe === null ? null : data(colegaAntesDe)}::timestamptz
                and ${pedidoAbertoSql(conn, "h")}))
        order by criado_em limit 1`;
      return l ? paraTrabalho(l) : null;
    },

    /**
     * definido em 2026-10-15 (NOD-243): o que a frente da rotina ainda tem de vivo — turnos pendentes ou rodando e
     * comandos esperando — e a última atividade (criação ou último sinal de um turno dela; sem turno, a criação dela).
     * A frente sem nada vivo há mais de 24 h deixa de segurar a agenda da rotina.
     */
    async atividade(id: string): Promise<{ vivos: number; ultimaEm: number | null }> {
      const [l] = await conn<{ vivos: number; ultima: Date | null }[]>`
        select
          (select count(*)::int from turnos t where t.tenant_id = ${escopo.tenantId} and t.trabalho_id = ${id} and t.estado in ('pendente', 'despachando'))
          + (select count(*)::int from esperas e where e.tenant_id = ${escopo.tenantId} and e.trabalho_id = ${id} and e.estado = 'rodando') as vivos,
          (select max(greatest(t.criado_em, coalesce(t.ultimo_sinal_em, t.criado_em))) from turnos t where t.tenant_id = ${escopo.tenantId} and t.trabalho_id = ${id}) as ultima`;
      return { vivos: l?.vivos ?? 0, ultimaEm: l?.ultima ? ms(l.ultima) : null };
    },

    /**
     * Grava o estado e os carimbos: `iniciado_em` na primeira vez que roda; `terminado_em` só nos finais (CHECK da 0063).
     * definido em 2026-10-15 (NOD-256, F1.3): sair de um estado final (`terminado`, `parado`, `falhou`) para um aberto só
     * com `reabrir` — o caminho da pessoa (mensagem na task, Retomar). Sem a flag a linha não muda e volta `null`: a
     * resposta de um colega ou uma sincronização atrasada não reabrem a task que a pessoa parou.
     */
    async mudarEstado(id: string, estado: EstadoTrabalho, agora: number, opcoes: { reabrir?: true } = {}): Promise<Trabalho | null> {
      const final = estado === "terminado" || estado === "parado" || estado === "falhou";
      const podeSairDoFinal = final || opcoes.reabrir === true;
      const [l] = await conn<Linha[]>`
        update trabalhos set estado = ${estado},
          iniciado_em = case when ${estado === "rodando" || estado === "precisa_de_voce"} then coalesce(iniciado_em, ${data(agora)}) else iniciado_em end,
          terminado_em = ${final ? data(agora) : null}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}
          and (estado not in ('terminado', 'parado', 'falhou') or ${podeSairDoFinal})
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraTrabalho(l) : null;
    },

    /**
     * A sessão do CLI do trabalho (nunca a da conversa), o harness e o executor que a criaram, como conversas.sessao_harness
     * (0030) e conversas.sessao_executor (0005).
     */
    async atualizarSessao(id: string, sessaoCli: string, harness: string | null, executor: Executor | null = null, maquinaId: string | null = null): Promise<boolean> {
      const r = await conn`
        update trabalhos set sessao_cli = ${sessaoCli}, sessao_harness = ${harness}, sessao_executor = ${executor}, sessao_conta_id = null, sessao_maquina_id = ${maquinaId}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}`;
      return r.count === 1;
    },

    /** ADR-102 (R1): a conta em que a sessão do trabalho foi criada. */
    async definirContaDaSessao(id: string, contaId: string | null): Promise<void> {
      await conn`update trabalhos set sessao_conta_id = ${contaId} where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}`;
    },

    async contaDaSessao(id: string): Promise<string | null> {
      const [l] = await conn<{ sessao_conta_id: string | null }[]>`select sessao_conta_id from trabalhos where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}`;
      return l?.sessao_conta_id ?? null;
    },

    /** NOD-273: o trabalho teve turno com consumo e sem custo informado (o Codex) — o custo dele é parcial. */
    async marcarCustoParcial(id: string): Promise<void> {
      await conn`
        update trabalhos set custo_parcial = true
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and not custo_parcial`;
    },

    /** ADR-107 (NOD-281): o CLI recusou a sessão; a próxima volta do trabalho vai sem resume, com o histórico. */
    async largarSessao(id: string): Promise<boolean> {
      const r = await conn`
        update trabalhos set sessao_cli = null, sessao_harness = null, sessao_executor = null, sessao_conta_id = null, sessao_maquina_id = null
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}`;
      return r.count === 1;
    },

    /** ADR-107 (NOD-281): a máquina em que a sessão do trabalho foi criada. */
    async maquinaDaSessao(id: string): Promise<string | null> {
      const [l] = await conn<{ sessao_maquina_id: string | null }[]>`select sessao_maquina_id from trabalhos where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}`;
      return l?.sessao_maquina_id ?? null;
    },

    async somarCusto(id: string, custoUsd: number): Promise<boolean> {
      const r = await conn`
        update trabalhos set custo_usd = coalesce(custo_usd, 0) + ${custoUsd}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}`;
      return r.count === 1;
    },

    /**
     * #194: a última leitura de memória do grupo de processos de cada turno lido, no trabalho dele. ADR-097 (fase 0c):
     * também o pico, que é o que calibra a reserva por agente e a fila do trabalho pesado.
     */
    async atualizarMemoria(porTurno: readonly { turnoId: string; mb: number }[]): Promise<number> {
      if (porTurno.length === 0) return 0;
      const r = await conn`
        update trabalhos w set memoria_mb = l.mb, memoria_pico_mb = greatest(coalesce(w.memoria_pico_mb, 0), l.mb)
        from (select unnest(${porTurno.map((p) => p.turnoId)}::uuid[]) as turno_id, unnest(${porTurno.map((p) => Math.max(0, Math.round(p.mb)))}::int[]) as mb) l
        join turnos t on t.tenant_id = ${escopo.tenantId} and t.id = l.turno_id
        where w.tenant_id = ${escopo.tenantId} and w.owner_id = ${escopo.pessoaId} and w.id = t.trabalho_id
          -- definido em 2026-10-08 (revisão do épico, S22): a mesma leitura a cada 30 s não reescreve a linha (nem a trava).
          and w.memoria_mb is distinct from l.mb`;
      return r.count;
    },

    /**
     * definido em 2026-10-08 (revisão do épico, S11): serializa quem mexe nas esperas (`depois_de`) dos trabalhos de um
     * bot até o fim da transação — a checagem de ciclo lê a corrente inteira, e duas transações cruzadas a liam antes
     * de a outra gravar.
     */
    async travarEsperas(agenteId: string): Promise<void> {
      await conn`select pg_advisory_xact_lock(hashtext(${escopo.tenantId}), hashtext(${`depois_de:${agenteId}`}))`;
    },

    /** "Fazer depois da …": grava a espera. Null tira. */
    async marcarDepoisDe(id: string, depoisDeId: string | null): Promise<Trabalho | null> {
      const [l] = await conn<Linha[]>`
        update trabalhos set depois_de_trabalho_id = ${depoisDeId}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraTrabalho(l) : null;
    },

    /**
     * A rede de 2 min (#193): a próxima mensagem da conversa segue numa CÓPIA desta sessão quando ela é de um trabalho
     * `rede` (o turno promovido continua nela).
     */
    async redeComSessao(conversaId: string, sessaoCli: string): Promise<Trabalho | null> {
      const [l] = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from trabalhos
        where tenant_id = ${escopo.tenantId} and conversa_id = ${conversaId} and origem = 'rede' and sessao_cli = ${sessaoCli}
        order by criado_em desc limit 1`;
      return l ? paraTrabalho(l) : null;
    },

    /**
     * ADR-088 (2026-10-09): as tasks da pessoa encerradas (terminada ou falha) desde `desde`, com pasta, e o que a regra
     * de limpeza precisa (src/domain/limpeza-das-tasks.ts). Lê pelo índice `trabalhos_terminados`; até 500.
     * `parado` fica de fora já aqui. ADR-099 (I5, 2026-10-12): com `id`, só aquele trabalho (o `limparAgora` da frente
     * que acabou de terminar); a `forma` vai junto.
     *
     * revisto em 2026-10-15 (ADR-106): com `codigos`, só as tasks cuja pasta tem um desses códigos — o sha256 em hex de
     * `<bot>/<slug>` em NFC, as pastas que a máquina ainda tem no disco. Aí o teto sobe para `TETO_COM_CODIGOS`: a
     * lista da máquina já limita, e com 500 as tasks recentes que ainda não podem sair escondiam as antigas que podem.
     * E as mais RECENTES primeiro: antes eram as mais antigas, e com 1.151 encerradas em 30 dias as 500 da resposta
     * paravam em 09/10, todas já limpas; a VM dos bots encheu sem a limpeza ver as pastas novas.
     */
    async candidatosALimpeza(desde: number, o: { id?: string; codigos?: readonly string[] } = {}): Promise<(FatosLimpeza & { id: string })[]> {
      const id = o.id ?? null;
      const codigos = o.codigos ?? null;
      const linhas = await conn<{ id: string; estado: EstadoTrabalho; pasta: string | null; terminado_em: Date | null; vivos: number; decisao: boolean; dividida: boolean; forma: FormaTrabalho }[]>`
        -- ADR-099 (I10): a task de antes, migrada pela 0072 sem lote, limpa como task (formaEfetiva, domain/frente.ts).
        select w.id, w.estado, w.pasta, w.terminado_em, case when w.lote_id is null then 'task' else w.forma end as forma,
          (select count(*)::int from turnos t where t.tenant_id = w.tenant_id and t.trabalho_id = w.id and t.estado in ('pendente', 'despachando')) as vivos,
          exists (select 1 from decisoes d join turnos t on t.tenant_id = d.tenant_id and t.id = d.turno_id
            where d.tenant_id = w.tenant_id and t.trabalho_id = w.id and d.estado in ('pendente', 'reaberta')) as decisao,
          -- revisão do #320 (ADR-106): também a pasta que outra task usou e encerrou DEPOIS desta. Só a task mais
          -- recente da pasta decide: sem isso, a antiga oferecia como "encerrada" a pasta de uma task que acabou de
          -- terminar (e sem a janela de 30 dias, qualquer task do histórico serviria).
          exists (select 1 from trabalhos o where o.tenant_id = w.tenant_id and o.pasta = w.pasta and o.id <> w.id
            and (o.estado not in ('terminado', 'falhou') or o.terminado_em > w.terminado_em
              or (o.terminado_em = w.terminado_em and o.id > w.id))) as dividida
        from trabalhos w
        where w.tenant_id = ${escopo.tenantId} and w.owner_id = ${escopo.pessoaId} and w.terminado_em >= ${data(desde)}
          and w.estado in ('terminado', 'falhou') and w.pasta is not null
          and (${id}::uuid is null or w.id = ${id}::uuid)
          and (${codigos}::text[] is null or (w.pasta like '~/nod/%'
            and encode(sha256(convert_to(normalize(substr(w.pasta, 7), NFC), 'UTF8')), 'hex') = any(${codigos}::text[])))
        order by w.terminado_em desc, w.id
        limit ${codigos ? TETO_COM_CODIGOS : 500}`;
      return linhas.map((l) => ({ id: l.id, estado: l.estado, pasta: l.pasta, terminadoEm: msOuNull(l.terminado_em), turnosVivos: l.vivos, decisaoPendente: l.decisao, pastaDividida: l.dividida, forma: l.forma }));
    },

    /** O que decide o estado (src/domain/trabalho.ts), numa consulta. */
    async fatos(id: string): Promise<Omit<FatosTrabalho, "estadoAtual" | "iniciado"> | null> {
      const [l] = await conn<{ parando: number; despachando: number; pendentes: number; despertar: boolean; comando: boolean; esperando: boolean; decisao: boolean; colega: boolean; pergunta_vencida: boolean; vencida_tipo: TipoDecisao | null; ultimo_estado: EstadoTurno | null; ultimo_motivo: MotivoInterrupcao | null }[]>`
        select
          (select count(*)::int from turnos t where t.tenant_id = ${escopo.tenantId} and t.trabalho_id = ${id} and t.estado = 'despachando' and t.parar_solicitado_em is not null) as parando,
          (select count(*)::int from turnos t where t.tenant_id = ${escopo.tenantId} and t.trabalho_id = ${id} and t.estado = 'despachando' and t.parar_solicitado_em is null) as despachando,
          -- ADR-086 (revisão do #212): a volta marcada para mais tarde não é fila — conta à parte, abaixo da decisão.
          (select count(*)::int from turnos t where t.tenant_id = ${escopo.tenantId} and t.trabalho_id = ${id} and t.estado = 'pendente' and (t.acordar_em is null or t.acordar_em <= now())) as pendentes,
          exists (select 1 from turnos t where t.tenant_id = ${escopo.tenantId} and t.trabalho_id = ${id} and t.estado = 'pendente' and t.acordar_em > now()) as despertar,
          -- ADR-099 (parte 2): o comando que o trabalho deixou esperando; o fim dele acorda o trabalho.
          exists (select 1 from esperas e where e.tenant_id = ${escopo.tenantId} and e.trabalho_id = ${id} and e.estado = 'rodando') as comando,
          exists (select 1 from trabalhos x join trabalhos dep on dep.tenant_id = x.tenant_id and dep.id = x.depois_de_trabalho_id
            where x.tenant_id = ${escopo.tenantId} and x.id = ${id} and dep.estado not in ('terminado', 'parado', 'falhou')) as esperando,
          -- NOD-261: o "Retomar" só conta se for do último turno terminal; o de um turno anterior ficou superado.
          exists (select 1 from decisoes d join turnos t on t.tenant_id = d.tenant_id and t.id = d.turno_id
            where d.tenant_id = ${escopo.tenantId} and t.trabalho_id = ${id} and d.estado in ('pendente', 'reaberta')
              and (d.tipo <> 'retomar_turno' or t.id = u.id)) as decisao,
          -- NOD-264 (C21): a última pergunta do trabalho venceu sem resposta e foi feita pelo último turno terminal.
          -- NOD-282 (G5): o tipo dela vem junto (a aprovação vencida tem texto próprio no resumo).
          (select case when d.estado = 'vencida' and d.turno_id = u.id then d.tipo end from decisoes d join turnos t on t.tenant_id = d.tenant_id and t.id = d.turno_id
            where d.tenant_id = ${escopo.tenantId} and t.trabalho_id = ${id} and d.tipo <> 'retomar_turno'
            order by d.criado_em desc, d.id desc limit 1) as vencida_tipo,
          coalesce((select d.estado = 'vencida' and d.turno_id = u.id from decisoes d join turnos t on t.tenant_id = d.tenant_id and t.id = d.turno_id
            where d.tenant_id = ${escopo.tenantId} and t.trabalho_id = ${id} and d.tipo <> 'retomar_turno'
            order by d.criado_em desc, d.id desc limit 1), false) as pergunta_vencida,
          -- definido em 2026-10-08 (revisão do épico, S3): pedido a colega feito por um turno do trabalho que não voltou —
          -- handoff com tarefaId sem peer_ask da mesma tarefa (a regra de pedidosEmAberto). O trabalho do colega já
          -- acabado sem peer_ask (a pessoa o parou) não segura este: senão ele ficaria rodando para sempre.
          exists (select 1 from mensagens h join turnos t on t.tenant_id = h.tenant_id and t.id = h.turno_id
            where h.tenant_id = ${escopo.tenantId} and t.trabalho_id = ${id} and h.kind = 'handoff' and h.payload->>'tarefaId' is not null
              and ${pedidoAbertoSql(conn, "h")}) as colega,
          u.estado as ultimo_estado, u.motivo_interrupcao as ultimo_motivo
        from (select 1) um
        left join lateral (
          select id, estado, motivo_interrupcao from turnos t
          where t.tenant_id = ${escopo.tenantId} and t.trabalho_id = ${id} and t.estado in ('concluido', 'interrompido')
            and coalesce(t.motivo_interrupcao::text, '') <> 'absorvido'
          order by t.criado_em desc, t.id desc limit 1
        ) u on true`;
      return l ? { parando: l.parando, despachando: l.despachando, pendentes: l.pendentes, aguardandoDespertar: l.despertar, aguardandoComando: l.comando, esperandoOutro: l.esperando, decisaoPendente: l.decisao, aguardandoColega: l.colega, ...(l.pergunta_vencida ? { perguntaVencida: true, ...(l.vencida_tipo ? { vencidaTipo: l.vencida_tipo } : {}) } : {}), ultimo: l.ultimo_estado ? { estado: l.ultimo_estado, motivo: l.ultimo_motivo } : null } : null;
    },

    /** Nome de quem pediu, da rotina, a última fala e o turno vivo de cada trabalho, numa consulta. */
    async extras(ids: readonly string[], agora: number = Date.now()): Promise<Map<string, ExtrasTrabalho>> {
      if (ids.length === 0) return new Map();
      const linhas = await conn<{
        id: string; pedido_por_nome: string | null; rotina_instrucao: string | null; ultima_fala: string | null; turno_vivo_id: string | null; abertos: string[] | null; de_fora: boolean;
        maquina_viva_id: string | null; maquina_alvo_id: string | null; pendente_harness: string | null; pendente_modelo: string | null;
        colega_nome: string | null; colega_desde: Date | null; colega_trabalho_id: string | null; colega_tarefa_id?: string | null; trabalhou_ms: string | number | null; acorda_em: Date | null;
        espera_motivo: string | null; espera_desde: Date | null; acorda_motivo: string | null;
        lote_id: string | null; lote_criado_em: Date | null; lote_frentes: number | null; lote_abertas: number | null; lote_titulo: string | null;
      }[]>`
        select w.id, a.nome as pedido_por_nome, r.instrucao as rotina_instrucao, f.texto as ultima_fala, v.id as turno_vivo_id,
          v.machine_id as maquina_viva_id, case when pe.tem then pe.alvo else bt.alvo end as maquina_alvo_id,
          pe.harness as pendente_harness, pe.modelo as pendente_modelo,
          c.nome as colega_nome, c.desde as colega_desde, c.trabalho_id as colega_trabalho_id, c.tarefa_id as colega_tarefa_id,
          -- definido em 2026-10-08 (tempo da task): o tempo trabalhado é o dos turnos (Raio-X: começo → último sinal); o
          -- resto do "aberta há" é espera. O turno que roda conta até agora.
          (select coalesce(sum(extract(epoch from ((case when t.estado = 'despachando' then clock_timestamp() else x.atualizado_em end) - x.criado_em)) * 1000), 0)
            from turnos t join turno_raio_x x on x.tenant_id = t.tenant_id and x.turno_id = t.id
            where t.tenant_id = w.tenant_id and t.trabalho_id = w.id) as trabalhou_ms,
          (w.origem = 'colega' or exists (select 1 from turnos x where x.tenant_id = w.tenant_id and x.trabalho_id = w.id
            and (x.contaminado_em is not null or x.entrada_confianca <> 'confiavel'))) as de_fora,
          ab.abertos, ab.acorda_em, es.motivo as espera_motivo, es.criado_em as espera_desde, am.motivo as acorda_motivo,
          lt.id as lote_id, lt.criado_em as lote_criado_em, lt.frentes as lote_frentes, lt.abertas as lote_abertas, lt.titulo as lote_titulo
        from trabalhos w
        left join agentes a on a.tenant_id = w.tenant_id and a.id = w.pedido_por_agente_id
        left join rotinas r on r.tenant_id = w.tenant_id and r.id = w.rotina_id
        left join lateral (
          select m.texto from mensagens m join turnos t on t.tenant_id = m.tenant_id and t.id = m.turno_id
          where m.tenant_id = w.tenant_id and t.trabalho_id = w.id and m.kind = 'texto' and m.autor_tipo = 'agente'
          order by m.criado_em desc, m.id desc limit 1
        ) f on true
        left join lateral (
          select t.id, t.machine_id::text as machine_id from turnos t where t.tenant_id = w.tenant_id and t.trabalho_id = w.id and t.estado = 'despachando' order by t.criado_em limit 1
        ) v on true
        -- A tela fala por máquina (2026-10-09): de qual máquina o turno pendente espera, pela regra do reivindicar. Sem turno
        -- pendente (esperando um colega, a pessoa ou a hora marcada), onde o próximo turno do bot iria: a mesma regra sem o
        -- "desta vez", que é de um turno só. O próximo turno é deste trabalho: a máquina da sessão dele vale (NOD-293, G11).
        left join lateral (
          select true as tem, ${alvoDoTurno(conn, agora)} as alvo, coalesce(t.harness, 'auto') as harness, t.modelo from turnos t
          where t.tenant_id = w.tenant_id and t.trabalho_id = w.id and t.estado = 'pendente' order by t.criado_em, t.id limit 1
        ) pe on true
        left join lateral (
          select ${alvoDoTurno(conn, agora)} as alvo from (select w.tenant_id, w.owner_id, w.id as trabalho_id, null::uuid as maquina_desta_vez, w.agente_id) t
        ) bt on true
        -- Os abertos e a volta marcada (ADR-086) numa leitura só dos turnos vivos do trabalho. A volta aparece até ser
        -- reivindicada (a hora pode ter passado com o Mac fora).
        left join lateral (
          select array_agg(t.id order by t.criado_em) as abertos, min(t.acordar_em) filter (where t.estado = 'pendente') as acorda_em
          from turnos t where t.tenant_id = w.tenant_id and t.trabalho_id = w.id and t.estado in ('pendente', 'despachando')
        ) ab on true
        -- ADR-099 (parte 2): o comando esperando (o índice esperas_rodando_por_trabalho).
        left join lateral (
          select e.motivo, e.criado_em from esperas e
          where e.tenant_id = w.tenant_id and e.trabalho_id = w.id and e.estado = 'rodando' order by e.criado_em limit 1
        ) es on true
        left join lateral (
          -- O pedido a colega em aberto mais antigo, pela regra de fatos.colega (sem peer_ask da tarefa, task do colega não final).
          select g.nome, h.criado_em as desde, h.payload->>'trabalhoId' as trabalho_id, h.payload->>'tarefaId' as tarefa_id
          from mensagens h join turnos t on t.tenant_id = h.tenant_id and t.id = h.turno_id
          left join agentes g on g.tenant_id = h.tenant_id and g.id::text = h.payload->>'para'
          where h.tenant_id = w.tenant_id and t.trabalho_id = w.id and h.kind = 'handoff' and h.payload->>'tarefaId' is not null
            and ${pedidoAbertoSql(conn, "h")}
          order by h.criado_em, h.id limit 1
        ) c on true
        -- ADR-099 (I10): o motivo da volta marcada mais próxima — o do turno que a marcou (o mesmo despertar_em).
        left join lateral (
          select (select x.despertar_motivo from turnos x where x.tenant_id = t.tenant_id and x.despertar_em = t.acordar_em
              and (x.id = t.retoma_turno_id or x.retoma_turno_id = t.retoma_turno_id) order by x.criado_em desc limit 1) as motivo
          from turnos t where t.tenant_id = w.tenant_id and t.trabalho_id = w.id and t.estado = 'pendente' and t.acordar_em is not null
          order by t.acordar_em limit 1
        ) am on true
        -- ADR-099 (I10): o lote (o pedido) da frente — quando o dono o abriu e quantas frentes dele seguem abertas.
        left join lateral (
          select l.id, l.criado_em, l.titulo, count(o.id)::int as frentes,
            (count(o.id) filter (where o.estado in ('na_fila', 'rodando', 'precisa_de_voce', 'fechado_ocioso')))::int as abertas
          from lotes_de_frentes l join trabalhos o on o.tenant_id = l.tenant_id and o.lote_id = l.id
          where l.tenant_id = w.tenant_id and l.id = w.lote_id
          group by l.id, l.criado_em, l.titulo
        ) lt on true
        where w.tenant_id = ${escopo.tenantId} and w.id = any(${[...ids]}::uuid[])`;
      return new Map(
        linhas.map((l) => [
          l.id,
          {
            pedidoPorNome: l.pedido_por_nome,
            rotinaNome: l.rotina_instrucao,
            ultimaFala: l.ultima_fala,
            turnoVivoId: l.turno_vivo_id,
            turnosAbertos: l.abertos ?? [],
            deFora: l.de_fora,
            esperandoColega: l.colega_desde ? { nome: l.colega_nome ?? "um colega", desde: ms(l.colega_desde), trabalhoId: l.colega_trabalho_id, tarefaId: l.colega_tarefa_id ?? null } : null,
            trabalhouMs: Math.max(0, Math.round(Number(l.trabalhou_ms ?? 0))),
            acordaEm: l.acorda_em ? ms(l.acorda_em) : null,
            esperandoComando: l.espera_motivo !== null && l.espera_desde ? { motivo: l.espera_motivo, desde: ms(l.espera_desde) } : null,
            maquinaVivaId: l.maquina_viva_id,
            maquinaAlvoId: l.maquina_alvo_id,
            pendente: l.pendente_harness !== null && l.pendente_modelo !== null ? { harness: l.pendente_harness, modelo: l.pendente_modelo } : null,
            acordaMotivo: l.acorda_motivo,
            lote: l.lote_id && l.lote_criado_em ? { id: l.lote_id, abertoEm: ms(l.lote_criado_em), frentes: l.lote_frentes ?? 0, abertas: l.lote_abertas ?? 0 } : null,
            loteTitulo: l.lote_titulo,
          },
        ]),
      );
    },

    /**
     * Pedidos a colega que pararam sem voltar (definido em 2026-10-08, src/domain/pedido-parado.ts): handoff com tarefa,
     * feito desde `desde`, sem peer_ask da mesma tarefa na conversa de quem pediu, com a task do colega acabada ou
     * esperando a pessoa — e quem pediu não está numa task parada nem foi excluído (não há a quem entregar). Até 20 por vez,
     * os mais antigos primeiro.
     */
    /** `adiados` (#218): tarefas que o varredor deixou para depois — fora do `limit 20`, para não segurar os pedidos novos. */
    async pedidosAColegaParados(desde: number, agora: number, adiados: readonly string[] = []): Promise<PedidoParado[]> {
      const linhas = await conn<{
        tarefa_id: string; colega_id: string; colega_estado: EstadoTrabalho; ultimo_id: string | null; ultimo_motivo: string | null; ultimo_motivo_falha: string | null; queda_em: Date | null;
        quedas: number; card_id: string | null; card_estado: string | null; sinal: boolean; na_fila: boolean; texto_final: string | null; turno_texto: string | null;
      }[]>`
        select h.payload->>'tarefaId' as tarefa_id, c.id as colega_id, c.estado as colega_estado,
          u.id as ultimo_id, -- NOD-314: o pendente que o varredor encerrou preso a uma máquina sem contato nunca rodou: não é queda.
          (case when u.motivo_interrupcao::text = 'maquina_sem_contato' and not (u.attempted or u.despachado_em is not null) then 'preso_sem_contato' else u.motivo_interrupcao::text end) as ultimo_motivo, u.motivo_falha as ultimo_motivo_falha, coalesce(u.ultimo_sinal_em, u.lease_ate, u.criado_em) as queda_em,
          (select count(*)::int from turnos q where q.tenant_id = c.tenant_id and q.trabalho_id = c.id and q.estado = 'interrompido'
            and q.motivo_interrupcao::text = any(${[...MOTIVOS_DE_QUEDA]}::text[]) and (q.motivo_interrupcao::text <> 'maquina_sem_contato' or q.attempted or q.despachado_em is not null)
            and coalesce(q.motivo_falha::text, '') <> all(${[...MOTIVOS_FALHA_SEM_QUEDA]}::text[])) as quedas,
          k.id as card_id, k.estado as card_estado,
          -- NOD-309 (PR 3): a retomada que a queda no fundo já enfileirou segura o varredor (pedido-parado.ts).
          exists (select 1 from turnos n where n.tenant_id = c.tenant_id and n.trabalho_id = c.id and n.estado in ('pendente', 'despachando')) as na_fila,
          exists (select 1 from turnos v where v.tenant_id = c.tenant_id and v.owner_id = c.owner_id and u.id is not null
            and v.criado_em > coalesce(u.ultimo_sinal_em, u.lease_ate, u.criado_em)
            and (v.estado = 'concluido' or (v.estado = 'despachando' and v.lease_ate > ${data(agora)}))) as sinal,
          f.texto as texto_final, f.turno_id as turno_texto
        from mensagens h
        join trabalhos c on c.tenant_id = h.tenant_id and c.id::text = h.payload->>'trabalhoId'
        left join turnos tp on tp.tenant_id = h.tenant_id and tp.id = h.turno_id
        left join trabalhos rp on rp.tenant_id = h.tenant_id and rp.id = tp.trabalho_id
        left join lateral (
          select t.id, t.motivo_interrupcao, t.motivo_falha, t.ultimo_sinal_em, t.lease_ate, t.criado_em, t.attempted, t.despachado_em from turnos t
          where t.tenant_id = c.tenant_id and t.trabalho_id = c.id and t.estado in ('concluido', 'interrompido')
            and coalesce(t.motivo_interrupcao::text, '') <> 'absorvido'
          order by t.criado_em desc, t.id desc limit 1
        ) u on true
        left join lateral (
          select d.id, d.estado from decisoes d where d.tenant_id = c.tenant_id and d.turno_id = u.id and d.tipo = 'retomar_turno'
          order by d.criado_em desc limit 1
        ) k on true
        left join lateral (
          select m.texto, m.turno_id from mensagens m join turnos t on t.tenant_id = m.tenant_id and t.id = m.turno_id
          where m.tenant_id = c.tenant_id and t.trabalho_id = c.id and m.kind = 'texto' and m.autor_tipo = 'agente' and m.autor_id = c.agente_id
            and coalesce(m.parcial, false) = false
          order by m.criado_em desc, m.id desc limit 1
        ) f on true
        -- NOD-279 (C22): o fim da espera da cota na task do colega (o maior acordar_em das voltas da cota).
        left join lateral (
          select max(t.acordar_em) as fim from turnos t
          where t.tenant_id = c.tenant_id and t.trabalho_id = c.id and t.acordar_em is not null and starts_with(t.entrada_texto, ${ENTRADA_DA_VOLTA_DA_COTA})
        ) ec on true
        where h.tenant_id = ${escopo.tenantId} and h.owner_id = ${escopo.pessoaId} and h.kind = 'handoff'
          and h.payload->>'tarefaId' is not null
          -- NOD-241: a janela conta da queda quando o último turno caiu; senão, do pedido (como antes).
          -- NOD-241 (revisão): e nunca o pedido de mais de IDADE_MAX_PEDIDO_RETOMAVEL_MS, para as laterais não rodarem sobre o histórico todo.
          -- NOD-279 (C22, definido em 2026-10-15): fora da queda, a âncora é o maior entre o pedido e o fim da espera da
          -- cota — as 24 h não vencem enquanto o pedido espera a IA renovar. Sem espera da cota, greatest = o pedido.
          and h.criado_em >= ${data(agora - IDADE_MAX_PEDIDO_RETOMAVEL_MS)}
          and (greatest(h.criado_em, ec.fim) >= ${data(desde)} or (u.motivo_interrupcao::text = any(${[...MOTIVOS_DE_QUEDA]}::text[]) and (u.motivo_interrupcao::text <> 'maquina_sem_contato' or u.attempted or u.despachado_em is not null) and coalesce(u.ultimo_sinal_em, u.lease_ate, u.criado_em) >= ${data(desde)}))
          and c.estado in ('terminado', 'parado', 'falhou', 'precisa_de_voce')
          and coalesce(rp.estado, '') <> 'parado'
          and exists (select 1 from agentes a where a.tenant_id = h.tenant_id and a.id::text = h.payload->>'de' and a.excluido_em is null)
          and not exists (select 1 from mensagens r where r.tenant_id = h.tenant_id and r.conversa_id = h.conversa_id and r.kind = 'peer_ask'
            and r.payload->>'tarefaId' = h.payload->>'tarefaId')
          and not (h.payload->>'tarefaId' = any(${[...adiados]}::text[]))
        order by h.criado_em, h.id
        limit 20`;
      return linhas.map((l) => ({
        tarefaId: l.tarefa_id,
        trabalhoColegaId: l.colega_id,
        estadoColega: l.colega_estado,
        ultimoTurnoId: l.ultimo_id,
        ultimoMotivo: l.ultimo_motivo,
        ultimoMotivoFalha: l.ultimo_motivo_falha,
        quedaEm: msOuNull(l.queda_em),
        quedas: l.quedas,
        cardRetomar: l.card_id ? { id: l.card_id, aberto: l.card_estado === "pendente" || l.card_estado === "reaberta" } : null,
        retomadaNaFila: l.na_fila,
        sinalDepoisDaQueda: l.sinal,
        textoFinal: l.texto_final,
        turnoDoTextoFinal: l.turno_texto,
      }));
    },
  };
}
