import type { Executor } from "../contracts/evento.ts";
import type { JanelaRotina } from "../contracts/rotina.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { alvoDoTurno } from "./alvo-da-maquina.ts";
import { data, ms } from "./conversao.ts";
import { nuvemSuspendePrazo } from "./nuvem-relogio.ts";

interface Linha {
  tenant_id: string;
  rotina_id: string;
  instante_agendado: Date;
  executor: Executor;
  machine_id: string;
  turno_id: string | null;
}

/** Resolvido na 0003/L3.5: JanelaRotina.turnoId já é `string | null` no contrato. Alias mantido para quem importou o nome antigo. */
export type JanelaReivindicada = JanelaRotina;

/** definido em 2026-10-15 (NOD-243): a execução que segura a rotina, com o que o disparo precisa para julgar se venceu. */
export type TurnoAbertoDaRotina = {
  turnoId: string;
  instanteAgendado: number;
  estado: string;
  attempted: boolean;
  acordarEm: number | null;
  criadoEm: number;
  trabalhoId: string | null;
  /** ADR-121 (NOD-92): a máquina-alvo é da nuvem e dorme ou acorda agora — a execução não vence enquanto isso. */
  esperaNuvem?: boolean;
};

/** O turno `t` da janela ainda segura a rotina (ADR-045, ADR-086, ADR-099). */
const ABERTO = `t.estado in ('pendente', 'despachando')
            -- ADR-086 (revisão do #212): a execução que marcou uma volta ("me chame às 16:00") ainda está aberta, mesmo
            -- com o turno da janela já concluído — senão a próxima janela empilhava outra execução por cima.
            or (t.trabalho_id is not null and exists (select 1 from turnos v where v.tenant_id = t.tenant_id and v.trabalho_id = t.trabalho_id and v.estado in ('pendente', 'despachando')))
            -- revisto em 2026-10-12 (ADR-099, I7 revista): a execução sem trabalho (o pedido na fila do dono) continua aberta
            -- enquanto uma retomada dela (a volta marcada, o retorno do lote, a resposta da pessoa) espera ou roda.
            -- NOD-271: a cadeia segue retoma_turno_id pelo índice turnos_por_retoma (0086).
            or (t.trabalho_id is null and exists (
              with recursive c(id, n) as (
                select t.id, 0
                union all
                select r.id, c.n + 1 from c join turnos r on r.tenant_id = t.tenant_id and r.retoma_turno_id = c.id and r.origem = 'retomada' where c.n < 10
              ) select 1 from c join turnos v on v.tenant_id = t.tenant_id and v.id = c.id where v.estado in ('pendente', 'despachando')))`;

const paraJanela = (l: Linha): JanelaRotina => ({
  tenantId: l.tenant_id,
  rotinaId: l.rotina_id,
  instanteAgendado: ms(l.instante_agendado),
  executor: l.executor,
  machineId: l.machine_id,
  turnoId: l.turno_id,
});

/**
 * Trava de execução (ADR-011): UNIQUE (tenant_id, rotina_id, instante_agendado). INSERT ... ON
 * CONFLICT DO NOTHING — a segunda máquina recebe false, sem erro, e cala. Registra QUAL executor
 * ganhou. Provado em tests/concurrency/rotina-janela-unique.test.ts com duas conexões.
 */
export function rotinaJanelasRepo(conn: Conn, escopo: Escopo) {
  const repo = {
    async reivindicar(p: { rotinaId: string; instanteAgendado: number; machineId: string; executor: Executor }): Promise<boolean> {
      const linhas = await conn`
        insert into rotina_janelas (tenant_id, owner_id, rotina_id, instante_agendado, executor, machine_id)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${p.rotinaId}, ${data(p.instanteAgendado)}, ${p.executor}, ${p.machineId})
        on conflict (tenant_id, rotina_id, instante_agendado) do nothing returning id`;
      return linhas.length === 1;
    },

    /** O turno nasce na mesma tx logo depois da reivindicação; aqui ele é ligado à janela. */
    async vincularTurno(p: { rotinaId: string; instanteAgendado: number; turnoId: string }): Promise<boolean> {
      const r = await conn`
        update rotina_janelas set turno_id = ${p.turnoId}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and rotina_id = ${p.rotinaId} and instante_agendado = ${data(p.instanteAgendado)}`;
      return r.count === 1;
    },

    /**
     * Trava a linha da janela (FOR UPDATE) até o fim da tx. definido em 2026-09-24 (ADR-045): quem
     * registra desfecho da janela (varredor, entrega, retomada) passa aqui, e a segunda transação lê a
     * execução que a primeira gravou — uma linha por janela, nunca duas.
     */
    async travar(rotinaId: string, instanteAgendado: number): Promise<boolean> {
      const linhas = await conn`
        select 1 from rotina_janelas
        where tenant_id = ${escopo.tenantId} and rotina_id = ${rotinaId} and instante_agendado = ${data(instanteAgendado)}
        for update`;
      return linhas.length === 1;
    },

    /**
     * O turno de uma janela desta rotina que ainda está pendente ou rodando, ou cujo trabalho ainda tem turno vivo
     * (ADR-045: uma execução aberta por rotina). null = pode abrir outra.
     * revisto em 2026-10-15 (NOD-243/NOD-271): devolve também o estado do turno da janela — o disparo decide com ele se
     * a execução anterior venceu (pendente, nunca começou, sem volta marcada) — e só olha as janelas dos últimos 7 dias
     * com turno ligado: a de antes disso não segura a agenda, e a busca não varre o histórico inteiro a cada janela.
     * `agora` é o relógio do servidor (o mesmo do disparo), não o now() do banco.
     */
    async turnoAberto(rotinaId: string, agora: number): Promise<TurnoAbertoDaRotina | null> {
      const [l] = await conn<{ turno_id: string; instante_agendado: Date; estado: string; attempted: boolean; acordar_em: Date | null; criado_em: Date; trabalho_id: string | null; espera_nuvem: boolean }[]>`
        select j.turno_id, j.instante_agendado, t.estado, t.attempted, t.acordar_em, t.criado_em, t.trabalho_id,
          ${nuvemSuspendePrazo(conn, conn`t.tenant_id`, alvoDoTurno(conn, agora))} as espera_nuvem
        from rotina_janelas j
        join turnos t on t.tenant_id = j.tenant_id and t.id = j.turno_id
        where j.tenant_id = ${escopo.tenantId} and j.rotina_id = ${rotinaId}
          and j.turno_id is not null and j.instante_agendado > ${data(agora)}::timestamptz - interval '7 days'
          and (${conn.unsafe(ABERTO)})
        order by j.instante_agendado desc limit 1`;
      return l
        ? { turnoId: l.turno_id, instanteAgendado: ms(l.instante_agendado), estado: l.estado, attempted: l.attempted, acordarEm: l.acordar_em ? ms(l.acordar_em) : null, criadoEm: ms(l.criado_em), trabalhoId: l.trabalho_id, esperaNuvem: l.espera_nuvem }
        : null;
    },

    /**
     * NOD-84 (ADR-139): quantas execuções desta rotina ainda estão abertas (a mesma régua de `turnoAberto`, 7 dias). A
     * rotina webhook não espera a anterior acabar, mas recusa a chamada com 429 quando já há PENDENTES_MAX abertas.
     */
    async contarAbertas(rotinaId: string, agora: number): Promise<number> {
      const [l] = await conn<{ n: number }[]>`
        select count(*)::int as n
        from rotina_janelas j
        join turnos t on t.tenant_id = j.tenant_id and t.id = j.turno_id
        where j.tenant_id = ${escopo.tenantId} and j.rotina_id = ${rotinaId}
          and j.turno_id is not null and j.instante_agendado > ${data(agora)}::timestamptz - interval '7 days'
          and (${conn.unsafe(ABERTO)})`;
      return l?.n ?? 0;
    },

    /**
     * definido em 2026-10-15 (pacote A3): a mesma execução aberta de `turnoAberto`, com o instante da janela dela — a lista
     * de rotinas conta os horários pulados desde ali (src/domain/janelas-puladas.ts). revisto em 2026-10-16 (integração
     * no #335): lê `turnoAberto` (a mesma régua de 7 dias da NOD-271).
     */
    async execucaoAberta(rotinaId: string, agora: number): Promise<{ turnoId: string; instanteAgendado: number } | null> {
      const a = await repo.turnoAberto(rotinaId, agora);
      return a ? { turnoId: a.turnoId, instanteAgendado: a.instanteAgendado } : null;
    },

    /**
     * definido em 2026-10-15 (NOD-272): os turnos ainda pendentes das execuções abertas desta rotina — o da janela, os
     * do trabalho dela e a cadeia de retomadas. Pausar a rotina encerra estes; o que já está rodando segue até acabar.
     */
    async turnosPendentesDaRotina(rotinaId: string, agora: number): Promise<{ turnoId: string; conversaId: string; janelaTurnoId: string }[]> {
      const linhas = await conn<{ id: string; conversa_id: string; janela_turno_id: string }[]>`
        with recursive base as (
          select t.id, t.trabalho_id from rotina_janelas j
          join turnos t on t.tenant_id = j.tenant_id and t.id = j.turno_id
          where j.tenant_id = ${escopo.tenantId} and j.rotina_id = ${rotinaId}
            and j.turno_id is not null and j.instante_agendado > ${data(agora)}::timestamptz - interval '7 days'
        ), c(id, raiz, n) as (
          select b.id, b.id, 0 from base b
          union all
          select v.id, b.id, 0 from base b join turnos v on v.tenant_id = ${escopo.tenantId} and v.trabalho_id = b.trabalho_id and v.id <> b.id where b.trabalho_id is not null
          union all
          select r.id, c.raiz, c.n + 1 from c join turnos r on r.tenant_id = ${escopo.tenantId} and r.retoma_turno_id = c.id and r.origem = 'retomada' where c.n < 10
        )
        select distinct v.id, v.conversa_id, c.raiz as janela_turno_id from c join turnos v on v.tenant_id = ${escopo.tenantId} and v.id = c.id
        where v.estado = 'pendente'`;
      return linhas.map((l) => ({ turnoId: l.id, conversaId: l.conversa_id, janelaTurnoId: l.janela_turno_id }));
    },

    /**
     * definido em 2026-10-15 (NOD-271): apaga as janelas desta rotina com mais de 30 dias cujo turno já acabou (ou que
     * nunca tiveram turno). A trava da janela (ADR-011) só importa enquanto o instante pode voltar a ser disputado.
     */
    async podar(rotinaId: string, agora: number): Promise<number> {
      const r = await conn`
        delete from rotina_janelas j
        where j.tenant_id = ${escopo.tenantId} and j.owner_id = ${escopo.pessoaId} and j.rotina_id = ${rotinaId}
          and j.instante_agendado < ${data(agora)}::timestamptz - interval '30 days'
          and (j.turno_id is null or not exists (
            select 1 from turnos t where t.tenant_id = j.tenant_id and t.id = j.turno_id and t.estado in ('pendente', 'despachando')))`;
      return r.count;
    },

    /**
     * definido em 2026-10-15 (NOD-255, I3): a retomada da execução que começou em `raizId` (a volta marcada, a resposta da
     * pessoa, o retorno do lote) que ainda espera ou roda — a mesma cadeia que turnoAberto segue (retoma_turno_id, origem
     * 'retomada', até 10 saltos). `exceto` é o turno que está registrando o desfecho agora: ele não segura a si mesmo.
     */
    async retomadaPendenteDe(raizId: string, exceto: string): Promise<string | null> {
      const [l] = await conn<{ id: string }[]>`
        with recursive c(id, n) as (
          select ${raizId}::uuid, 0
          union all
          select r.id, c.n + 1 from c join turnos r on r.tenant_id = ${escopo.tenantId} and r.retoma_turno_id = c.id and r.origem = 'retomada' where c.n < 10
        ) select v.id from c join turnos v on v.tenant_id = ${escopo.tenantId} and v.id = c.id
        where c.n > 0 and v.id <> ${exceto}::uuid and v.estado in ('pendente', 'despachando')
        limit 1`;
      return l?.id ?? null;
    },

    /**
     * definido em 2026-10-16 (NOD-274, C7/C10): a volta da cota que ainda espera na cadeia de retomadas de `raizId` (a
     * execução da rotina, ou o turno de delegação do pedido ao colega) — a retomada pendente com hora marcada no futuro
     * cuja entrada é a da volta da cota (ENTRADA_DA_VOLTA_DA_COTA). null = nada esperando a cota.
     */
    async esperaDaCotaDe(raizId: string, prefixo: string, agora: number): Promise<{ voltaEm: number; entrada: string; harness: string | null } | null> {
      const [l] = await conn<{ acordar_em: Date; entrada_texto: string; harness: string | null }[]>`
        with recursive c(id, n) as (
          select ${raizId}::uuid, 0
          union all
          select r.id, c.n + 1 from c join turnos r on r.tenant_id = ${escopo.tenantId} and r.retoma_turno_id = c.id and r.origem = 'retomada' where c.n < 10
        ) select v.acordar_em, v.entrada_texto, v.harness from c join turnos v on v.tenant_id = ${escopo.tenantId} and v.id = c.id
        where c.n > 0 and v.estado = 'pendente' and v.acordar_em > ${data(agora)} and starts_with(v.entrada_texto, ${prefixo})
        order by v.acordar_em limit 1`;
      return l ? { voltaEm: ms(l.acordar_em), entrada: l.entrada_texto, harness: l.harness } : null;
    },

    /** A janela que ligou este turno à rotina (índice rotina_janelas_turno_idx, 0004) — pendência L7 §5. */
    async buscarPorTurno(turnoId: string): Promise<JanelaRotina | null> {
      const [l] = await conn<Linha[]>`
        select tenant_id, rotina_id, instante_agendado, executor, machine_id, turno_id from rotina_janelas
        where tenant_id = ${escopo.tenantId} and turno_id = ${turnoId}`;
      return l ? paraJanela(l) : null;
    },

    async listar(rotinaId: string): Promise<JanelaRotina[]> {
      const linhas = await conn<Linha[]>`
        select tenant_id, rotina_id, instante_agendado, executor, machine_id, turno_id from rotina_janelas
        where tenant_id = ${escopo.tenantId} and rotina_id = ${rotinaId} order by instante_agendado`;
      return linhas.map(paraJanela);
    },
  };
  return repo;
}
