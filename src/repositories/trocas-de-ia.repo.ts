import type { IdHarness } from "../contracts/harness.ts";
import type { InteligenciaBot } from "../contracts/inteligencia.ts";
import type { DecisaoDaTroca, RecomendacaoDaTroca, TrocaDeIa } from "../contracts/troca-de-ia.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { data, dataOuNull, jsonb, ms, msOuNull } from "./conversao.ts";

interface Linha {
  id: string;
  agente_id: string;
  conversa_id: string;
  ia_de: IdHarness;
  ia_para: IdHarness | null;
  recomendacao: RecomendacaoDaTroca;
  volta_em: Date | null;
  criada_em: Date;
  aplicar_em: Date | null;
  decidido_em: Date | null;
  decisao: DecisaoDaTroca | null;
  mensagem_id: string | null;
  fixo: boolean;
  volta_ao_fixo: InteligenciaBot | null;
  restaurado_em: Date | null;
  machine_id: string | null;
  conta_de: string | null;
  voltou_em: Date | null;
}

const COLUNAS = "id, agente_id, conversa_id, ia_de, ia_para, recomendacao, volta_em, criada_em, aplicar_em, decidido_em, decisao, mensagem_id, fixo, volta_ao_fixo, restaurado_em, machine_id, conta_de, voltou_em";

const paraTroca = (l: Linha): TrocaDeIa => ({
  id: l.id,
  agenteId: l.agente_id,
  conversaId: l.conversa_id,
  iaDe: l.ia_de,
  iaPara: l.ia_para,
  recomendacao: l.recomendacao,
  voltaEm: msOuNull(l.volta_em),
  criadaEm: ms(l.criada_em),
  aplicarEm: msOuNull(l.aplicar_em),
  decididoEm: msOuNull(l.decidido_em),
  decisao: l.decisao,
  mensagemId: l.mensagem_id,
  fixo: l.fixo,
  voltaAoFixo: l.volta_ao_fixo,
  restauradoEm: msOuNull(l.restaurado_em),
  machineId: l.machine_id,
  contaDe: l.conta_de,
  voltouEm: msOuNull(l.voltou_em),
});

export type NovaTroca = {
  agenteId: string;
  conversaId: string;
  iaDe: IdHarness;
  iaPara: IdHarness | null;
  recomendacao: RecomendacaoDaTroca;
  voltaEm: number | null;
  /** Só "levar": quando o varredor aplica sozinho. Num aviso que já existia, o prazo de antes vale (não recomeça). */
  aplicarEm: number | null;
  fixo: boolean;
  /** C2: a máquina-alvo das tasks do bot (null = nenhuma; vale o limite da IA). */
  machineId: string | null;
  /** I1: a conta do ChatGPT da sessão que parou (só quando "levar" é para outra conta da mesma IA). */
  contaDe?: string | null;
  agora: number;
};

/**
 * Os avisos de troca de IA (0080, ADR-108). Um aberto por bot e IA que parou (índice único parcial; revisão do PR 2, I2):
 * `abrir` cria ou atualiza o aberto daquela IA. Fechar é `UPDATE … WHERE decidido_em IS NULL` — o clique da pessoa e o
 * varredor ao mesmo tempo: o primeiro fecha, o segundo recebe null e não aplica nada.
 */
export function trocasDeIaRepo(conn: Conn, escopo: Escopo) {
  const doDono = () => conn`tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId}`;
  return {
    /** Cria o aviso do bot para a IA ou atualiza o aberto. `nova` = não havia aberto (a tela ganha uma linha nova). */
    async abrir(n: NovaTroca): Promise<{ troca: TrocaDeIa; nova: boolean }> {
      const [l] = await conn<(Linha & { nova: boolean })[]>`
        insert into trocas_de_ia (tenant_id, owner_id, agente_id, conversa_id, ia_de, ia_para, recomendacao, volta_em, criada_em, aplicar_em, fixo, machine_id, conta_de)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${n.agenteId}, ${n.conversaId}, ${n.iaDe}, ${n.iaPara}, ${n.recomendacao}, ${dataOuNull(n.voltaEm)}, ${data(n.agora)}, ${dataOuNull(n.aplicarEm)}, ${n.fixo}, ${n.machineId}, ${n.contaDe ?? null})
        on conflict (tenant_id, agente_id, ia_de) where decidido_em is null do update set
          ia_para = excluded.ia_para, recomendacao = excluded.recomendacao, volta_em = excluded.volta_em, fixo = excluded.fixo,
          machine_id = excluded.machine_id, conta_de = coalesce(excluded.conta_de, trocas_de_ia.conta_de),
          aplicar_em = case when excluded.recomendacao = 'levar' then coalesce(trocas_de_ia.aplicar_em, excluded.aplicar_em) else null end
        returning ${conn.unsafe(COLUNAS)}, (xmax = 0) as nova`;
      return { troca: paraTroca(l!), nova: l!.nova };
    },

    async definirMensagem(id: string, mensagemId: string): Promise<void> {
      await conn`update trocas_de_ia set mensagem_id = ${mensagemId} where ${doDono()} and id = ${id}`;
    },

    async buscar(id: string): Promise<TrocaDeIa | null> {
      const [l] = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from trocas_de_ia where ${doDono()} and id = ${id}`;
      return l ? paraTroca(l) : null;
    },

    /** O aviso aberto do bot para a IA `iaDe` (sem `iaDe`: o mais antigo aberto do bot, qualquer IA). */
    async abertaDoAgente(agenteId: string, iaDe?: IdHarness): Promise<TrocaDeIa | null> {
      const [l] = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from trocas_de_ia where ${doDono()} and agente_id = ${agenteId} and decidido_em is null
        ${iaDe ? conn`and ia_de = ${iaDe}` : conn``} order by criada_em limit 1`;
      return l ? paraTroca(l) : null;
    },

    /** Todos os avisos abertos do bot (um por IA no máximo). */
    async abertasDoAgente(agenteId: string): Promise<TrocaDeIa[]> {
      const linhas = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from trocas_de_ia where ${doDono()} and agente_id = ${agenteId} and decidido_em is null order by criada_em`;
      return linhas.map(paraTroca);
    },

    /**
     * C3: a decisão "esperar" do bot para a IA que ainda não voltou (a próxima task que para herda dela, sem aviso novo).
     * null = não há.
     */
    async esperaDecidida(agenteId: string, iaDe: IdHarness): Promise<TrocaDeIa | null> {
      const [l] = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from trocas_de_ia
        where ${doDono()} and agente_id = ${agenteId} and ia_de = ${iaDe} and decisao = 'esperar' and voltou_em is null
        order by decidido_em desc limit 1`;
      return l ? paraTroca(l) : null;
    },

    /** C2: o último aviso do bot para a IA fechado a partir de `desde` (o aviso que reabre reaproveita a linha dele). */
    async fechadaRecente(agenteId: string, iaDe: IdHarness, desde: number): Promise<TrocaDeIa | null> {
      const [l] = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from trocas_de_ia
        where ${doDono()} and agente_id = ${agenteId} and ia_de = ${iaDe} and decidido_em is not null and decidido_em >= ${data(desde)} and mensagem_id is not null
        order by decidido_em desc limit 1`;
      return l ? paraTroca(l) : null;
    },

    /**
     * Fecha o aviso UMA vez. null = já estava fechado (outro clique, outra aba ou o varredor chegou antes). `voltaAoFixo`
     * (R6 b) é gravado no mesmo comando.
     */
    async fechar(id: string, decisao: DecisaoDaTroca, agora: number, voltaAoFixo?: InteligenciaBot): Promise<TrocaDeIa | null> {
      const [l] = await conn<Linha[]>`
        update trocas_de_ia set decidido_em = ${data(agora)}, decisao = ${decisao}, volta_ao_fixo = ${voltaAoFixo ? jsonb(conn, voltaAoFixo) : null}
        where ${doDono()} and id = ${id} and decidido_em is null
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraTroca(l) : null;
    },

    /** O bot volta à inteligência de antes (R6 b) UMA vez. */
    async marcarRestaurada(id: string, agora: number): Promise<boolean> {
      const r = await conn`update trocas_de_ia set restaurado_em = ${data(agora)} where ${doDono()} and id = ${id} and volta_ao_fixo is not null and restaurado_em is null returning id`;
      return r.length > 0;
    },

    /** C3/I4: a IA do aviso decidido ("esperar"/"conta") voltou — UMA vez. */
    async marcarVoltou(id: string, agora: number): Promise<boolean> {
      const r = await conn`update trocas_de_ia set voltou_em = ${data(agora)} where ${doDono()} and id = ${id} and decisao in ('esperar', 'conta') and voltou_em is null returning id`;
      return r.length > 0;
    },

    /**
     * O que o varredor olha: os avisos abertos, os bots fixos que ainda esperam voltar à IA deles e as decisões "esperar"/
     * "conta" que ainda esperam a IA voltar.
     */
    async paraVarrer(): Promise<TrocaDeIa[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from trocas_de_ia
        where ${doDono()} and (decidido_em is null or (volta_ao_fixo is not null and restaurado_em is null) or (decisao in ('esperar', 'conta') and voltou_em is null))
        order by criada_em limit 200`;
      return linhas.map(paraTroca);
    },
  };
}
