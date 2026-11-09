import type { DestinoItem } from "../contracts/item-aprovacao.ts";
import type { FalhaRevisao, VereditoRevisao } from "../contracts/revisao.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { data, msOuNull } from "./conversao.ts";

/** O que a linha registra (0093): o modo decidiu sem a pessoa, ou mandou ao revisor. Texto livre só aqui, nunca na trilha. */
export type TipoAcaoDoModo = "comando" | "arquivo" | "leitura_credencial" | "app" | "mcp";
export type GatilhoAcaoDoModo = "arriscado" | "envio_apos_fora" | "credencial" | "fora_da_pasta" | "comum";

export type NovaAcaoDoModo = {
  agenteId: string;
  conversaId: string;
  turnoId: string;
  decisaoId: string | null;
  modo: "automatico" | "total";
  tipo: TipoAcaoDoModo;
  /** Já redigido por quem chama (`resumoDaAcao`); cortado de novo aqui. */
  resumo: string;
  gatilho: GatilhoAcaoDoModo;
  risco: string | null;
  veredito?: VereditoRevisao | null;
  falha?: FalhaRevisao | null;
  motivo?: string | null;
  /** O modelo a que o pedido foi; null = cartão direto, sem revisor. Os tetos contam só as linhas com modelo. */
  revisorModelo?: string | null;
  /** `servidor` desde 2026-10-25 (ADR-115, "Revisor no servidor"). */
  revisorHarness?: string | null;
  /** A máquina do laço no desenho anterior (revisor na IA da pessoa); o revisor no servidor deixa nula. */
  revisorMaquina?: string | null;
};

export type AcaoDoModo = NovaAcaoDoModo & {
  id: string;
  entregueEm: number | null;
  revisorMs: number | null;
  fichasEntrada: number | null;
  fichasSaida: number | null;
  desfechoPessoa: "aprovou" | "negou" | "venceu" | null;
  /** "Devia ter perguntado" (PR 4): quando a dona contestou a liberação do revisor. */
  contestadaEm: number | null;
  criadoEm: number;
};

interface Linha {
  id: string;
  agente_id: string;
  conversa_id: string;
  turno_id: string;
  decisao_id: string | null;
  modo: "automatico" | "total";
  tipo: TipoAcaoDoModo;
  resumo: string;
  gatilho: GatilhoAcaoDoModo;
  risco: string | null;
  veredito: VereditoRevisao | null;
  falha: FalhaRevisao | null;
  motivo: string | null;
  revisor_modelo: string | null;
  revisor_harness: string | null;
  revisor_maquina: string | null;
  entregue_em: Date | null;
  revisor_ms: number | null;
  fichas_entrada: number | null;
  fichas_saida: number | null;
  desfecho_pessoa: "aprovou" | "negou" | "venceu" | null;
  contestada_em: Date | null;
  criado_em: Date;
}

/** Uma ação na linha embaixo da fala: a do total (PR 6) ou a que o revisor liberou (PR 4, com o `motivo` dele). */
export type LinhaNaFala = {
  id: string; turno_id: string; modo: "automatico" | "total"; tipo: TipoAcaoDoModo; gatilho: GatilhoAcaoDoModo; resumo: string; risco: string | null; veredito: VereditoRevisao | null; motivo: string | null; criado_em: Date; linux: boolean;
  /** PR 4b: o item da decisão quando ela tem UM só (o comando, ou a ação no app), para a frase da ação; senão null. */
  item: { texto_final: string; destino: DestinoItem } | null;
};
/** Uma ação que rodou sem a pessoa, como a Atividade a lista (PR 6); `motivo` e `contestada_em` do revisor (PR 4). */
export type LinhaSemAprovacao = { id: string; modo: "automatico" | "total"; tipo: TipoAcaoDoModo; gatilho: GatilhoAcaoDoModo; resumo: string; risco: string | null; veredito: VereditoRevisao | null; motivo: string | null; contestada_em: Date | null; criado_em: Date };
/** O que a contestação devolve (PR 4): a linha contestada, para o log e a resposta. */
export type AcaoContestada = { id: string; agente_id: string; tipo: TipoAcaoDoModo; gatilho: GatilhoAcaoDoModo; criado_em: Date; contestada_em: Date };

const COLUNAS = "id, agente_id, conversa_id, turno_id, decisao_id, modo, tipo, resumo, gatilho, risco, veredito, falha, motivo, revisor_modelo, revisor_harness, revisor_maquina, entregue_em, revisor_ms, fichas_entrada, fichas_saida, desfecho_pessoa, contestada_em, criado_em";

const paraAcao = (l: Linha): AcaoDoModo => ({
  id: l.id,
  agenteId: l.agente_id,
  conversaId: l.conversa_id,
  turnoId: l.turno_id,
  decisaoId: l.decisao_id,
  modo: l.modo,
  tipo: l.tipo,
  resumo: l.resumo,
  gatilho: l.gatilho,
  risco: l.risco,
  veredito: l.veredito,
  falha: l.falha,
  motivo: l.motivo,
  revisorModelo: l.revisor_modelo,
  revisorHarness: l.revisor_harness,
  revisorMaquina: l.revisor_maquina,
  entregueEm: msOuNull(l.entregue_em),
  revisorMs: l.revisor_ms,
  fichasEntrada: l.fichas_entrada,
  fichasSaida: l.fichas_saida,
  desfechoPessoa: l.desfecho_pessoa,
  contestadaEm: msOuNull(l.contestada_em),
  criadoEm: l.criado_em.getTime(),
});

/** Inteiro não negativo ou null: as fichas e o tempo vêm da máquina (já validados na rota); aqui só a segunda camada. */
const naoNegativo = (n: number | null | undefined): number | null => (typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.min(Math.round(n), 2_000_000_000) : null);

/**
 * `acoes_pelo_modo` (0093, ADR-115): o registro do que o modo decidiu sem a pessoa. Privado da dona (RLS da
 * `nod_escopar_tabela`); apagável por nod_poda, e a própria dona poda o que passou de 90 dias (varredor de expiração).
 */
export function acoesPeloModoRepo(conn: Conn, escopo: Escopo) {
  return {
    async registrar(a: NovaAcaoDoModo): Promise<string> {
      const [l] = await conn<{ id: string }[]>`
        insert into acoes_pelo_modo (tenant_id, owner_id, agente_id, conversa_id, turno_id, decisao_id, modo, tipo, resumo, gatilho, risco, veredito, falha, motivo, revisor_modelo, revisor_harness, revisor_maquina)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${a.agenteId}, ${a.conversaId}, ${a.turnoId}, ${a.decisaoId}, ${a.modo}, ${a.tipo}, ${a.resumo.slice(0, 500)}, ${a.gatilho},
          ${a.risco?.slice(0, 200) ?? null}, ${a.veredito ?? null}, ${a.falha ?? null}, ${a.motivo?.slice(0, 160) ?? null}, ${a.revisorModelo?.slice(0, 80) ?? null},
          ${a.revisorHarness?.slice(0, 32) ?? null}, ${a.revisorMaquina?.slice(0, 128) ?? null})
        returning id`;
      if (!l) throw new Error("acoes_pelo_modo sem id");
      return l.id;
    },

    async daDecisao(decisaoId: string): Promise<AcaoDoModo | null> {
      const [l] = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from acoes_pelo_modo where tenant_id = ${escopo.tenantId} and decisao_id = ${decisaoId}`;
      return l ? paraAcao(l) : null;
    },

    async doTurno(turnoId: string): Promise<AcaoDoModo[]> {
      const linhas = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from acoes_pelo_modo where tenant_id = ${escopo.tenantId} and turno_id = ${turnoId} order by criado_em, id`;
      return linhas.map(paraAcao);
    },

    /**
     * O veredito da fase 3, uma vez só (`veredito is null`): o relato repetido, o prazo e o varredor não regravam.
     * Devolve se gravou.
     */
    async concluir(decisaoId: string, c: { veredito: VereditoRevisao; falha?: FalhaRevisao | null; motivo?: string | null; entregueEm?: number | null; revisorMs?: number | null; fichasEntrada?: number | null; fichasSaida?: number | null }): Promise<boolean> {
      const r = await conn`
        update acoes_pelo_modo set veredito = ${c.veredito}, falha = ${c.falha ?? null}, motivo = ${c.motivo?.slice(0, 160) ?? null},
          entregue_em = ${c.entregueEm ? data(c.entregueEm) : null}, revisor_ms = ${naoNegativo(c.revisorMs)},
          fichas_entrada = ${naoNegativo(c.fichasEntrada)}, fichas_saida = ${naoNegativo(c.fichasSaida)}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and decisao_id = ${decisaoId} and veredito is null`;
      return r.count === 1;
    },

    /** Quantas revisões o turno já mandou ao revisor (o teto de 20, plano 3c). */
    async revisoesDoTurno(turnoId: string): Promise<number> {
      const [l] = await conn<{ n: number }[]>`
        select count(*)::int as n from acoes_pelo_modo where tenant_id = ${escopo.tenantId} and turno_id = ${turnoId} and revisor_modelo is not null`;
      return l?.n ?? 0;
    },

    /** Quantas ações deste turno o revisor mandou à pessoa (vai no pedido: revisão de engenharia 3). */
    async pedidasNoTurno(turnoId: string): Promise<number> {
      const [l] = await conn<{ n: number }[]>`
        select count(*)::int as n from acoes_pelo_modo where tenant_id = ${escopo.tenantId} and turno_id = ${turnoId} and veredito = 'pede'`;
      return l?.n ?? 0;
    },

    /**
     * Quantas revisões a pessoa mandou ao revisor desde `desde` (o teto do dia). Na tx escopada dela a RLS mostra todas as
     * linhas dela — de todos os bots e de todas as contas de IA —, que é exatamente o que o teto conta.
     */
    async revisoesDaPessoaDesde(desde: number): Promise<number> {
      const [l] = await conn<{ n: number }[]>`
        select count(*)::int as n from acoes_pelo_modo
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and criado_em >= ${data(desde)} and revisor_modelo is not null`;
      return l?.n ?? 0;
    },

    /** O desfecho do cartão que a revisão deixou, quando a pessoa decide ou ele vence (só a primeira vez). */
    async registrarDesfechoPessoa(decisaoId: string, desfecho: "aprovou" | "negou" | "venceu"): Promise<void> {
      await conn`update acoes_pelo_modo set desfecho_pessoa = ${desfecho}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and decisao_id = ${decisaoId} and desfecho_pessoa is null`;
    },

    /**
     * PR 6 dos modos de aprovação: o que o total rodou nos turnos da janela e entra na linha embaixo da fala (a credencial e
     * o arriscado; `entraNaFala`). `linux`: o turno rodou numa máquina Linux (ADR-090, 0067) — a frase diz "desta máquina".
     * PR 4: também o que o revisor do Automático liberou (telas A1 e A2), com o motivo dele. Pela RLS, só a dona vê as
     * próprias linhas.
     */
    async naFalaDosTurnos(turnoIds: readonly string[]): Promise<LinhaNaFala[]> {
      if (turnoIds.length === 0) return [];
      return conn<LinhaNaFala[]>`
        select a.id, a.turno_id, a.modo, a.tipo, a.gatilho, a.resumo, a.risco, a.veredito, a.motivo, a.criado_em, coalesce(mt.plataforma = 'linux', false) as linux,
          case when it.n = 1 then jsonb_build_object('texto_final', it.texto_final, 'destino', it.destino) end as item
        from acoes_pelo_modo a
          join turnos t on t.tenant_id = a.tenant_id and t.id = a.turno_id
          left join maquina_tokens mt on mt.tenant_id = t.tenant_id and mt.id = t.machine_id
          left join lateral (
            select count(*)::int as n, min(i.texto_final) as texto_final, (array_agg(i.destino))[1] as destino
            from itens_aprovacao i where i.tenant_id = a.tenant_id and i.decisao_id = a.decisao_id
          ) it on a.modo = 'automatico' and a.veredito = 'libera' and a.decisao_id is not null
        where a.tenant_id = ${escopo.tenantId} and a.turno_id = any(${turnoIds as string[]}::uuid[])
          and ((a.modo = 'total' and a.gatilho in ('credencial', 'arriscado')) or (a.modo = 'automatico' and a.veredito = 'libera'))
        order by a.criado_em, a.id`;
    },

    /**
     * A quarta fonte da Atividade (PR 6): o que rodou sem a pessoa no dia — tudo o que o total registrou e o que o revisor
     * liberou (`rodouSemAprovacao`). Os mais recentes primeiro, até `limite`.
     */
    async semAprovacaoDoDia(agenteId: string, f: { ini: Date; fim: Date }, limite: number): Promise<LinhaSemAprovacao[]> {
      return conn<LinhaSemAprovacao[]>`
        select id, modo, tipo, gatilho, resumo, risco, veredito, motivo, contestada_em, criado_em from acoes_pelo_modo
        where tenant_id = ${escopo.tenantId} and agente_id = ${agenteId} and criado_em >= ${f.ini} and criado_em < ${f.fim}
          and (modo = 'total' or veredito = 'libera')
        order by criado_em desc, id desc limit ${limite}`;
    },

    async contarSemAprovacaoDoDia(agenteId: string, f: { ini: Date; fim: Date }): Promise<number> {
      const [l] = await conn<{ n: number }[]>`
        select count(*)::int as n from acoes_pelo_modo
        where tenant_id = ${escopo.tenantId} and agente_id = ${agenteId} and criado_em >= ${f.ini} and criado_em < ${f.fim}
          and (modo = 'total' or veredito = 'libera')`;
      return l?.n ?? 0;
    },

    /**
     * "Devia ter perguntado" (PR 4, plano 3g): a dona marca uma ação que o revisor liberou. Grava `contestada_em` uma vez
     * (a segunda não regrava) e não desfaz nada. Só a liberação do revisor se contesta: o total não perguntou a ninguém.
     * Devolve a linha contestada, a já contestada (`jaContestada`), ou null quando não há liberação do revisor com esse id
     * para esta pessoa (pela RLS, a de outra pessoa nem aparece).
     */
    async contestar(id: string): Promise<{ acao: AcaoContestada; jaContestada: boolean } | null> {
      const [nova] = await conn<AcaoContestada[]>`
        update acoes_pelo_modo set contestada_em = clock_timestamp()
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}
          and modo = 'automatico' and veredito = 'libera' and contestada_em is null
        returning id, agente_id, tipo, gatilho, criado_em, contestada_em`;
      if (nova) return { acao: nova, jaContestada: false };
      const [antiga] = await conn<AcaoContestada[]>`
        select id, agente_id, tipo, gatilho, criado_em, contestada_em from acoes_pelo_modo
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}
          and modo = 'automatico' and veredito = 'libera' and contestada_em is not null`;
      return antiga ? { acao: antiga, jaContestada: true } : null;
    },

    /** Retenção de 90 dias (0093): a dona apaga as próprias linhas mais velhas que `antesDe`. Devolve quantas. */
    async podar(antesDe: number): Promise<number> {
      const r = await conn`delete from acoes_pelo_modo where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and criado_em < ${data(antesDe)}`;
      return r.count;
    },
  };
}
