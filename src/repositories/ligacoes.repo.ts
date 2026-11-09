import type { EstadoLigacao, FalaLigacao, Ligacao } from "../contracts/ligacao.ts";
import type { MotivoFimLigacao } from "../contracts/voz.ts";
import { assuntoDe } from "../domain/destino-no-chat.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { data, ms, msOuNull } from "./conversao.ts";

interface Linha {
  id: string;
  agente_id: string;
  conversa_id: string;
  estado: EstadoLigacao;
  iniciada_por: "pessoa" | "produto";
  harness: string | null;
  modelo: string | null;
  provedor_stt: string;
  provedor_tts: string;
  voz: string;
  mensagem_id: string | null;
  iniciada_em: Date;
  atendida_em: Date | null;
  encerrada_em: Date | null;
  motivo_fim: MotivoFimLigacao | null;
  duracao_ms: number | null;
  religacoes: number;
  trocas: number;
  interrupcoes: number;
  stt_segundos: number;
  tts_caracteres: number;
  custo_estimado_usd: string | null;
  latencia_p50_ms: number | null;
  latencia_p95_ms: number | null;
  avaliacao: "boa" | "ruim" | null;
  transcricao_apagada_em: Date | null;
  resumida: boolean;
}

const COLUNAS =
  "id, agente_id, conversa_id, estado, iniciada_por, harness, modelo, provedor_stt, provedor_tts, voz, mensagem_id, iniciada_em, atendida_em, encerrada_em, motivo_fim, duracao_ms, religacoes, trocas, interrupcoes, stt_segundos, tts_caracteres, custo_estimado_usd, latencia_p50_ms, latencia_p95_ms, avaliacao, transcricao_apagada_em, resumida";

function paraLigacao(l: Linha): Ligacao {
  return {
    id: l.id,
    agenteId: l.agente_id,
    conversaId: l.conversa_id,
    estado: l.estado,
    iniciadaPor: l.iniciada_por,
    harness: l.harness,
    modelo: l.modelo,
    provedorStt: l.provedor_stt,
    provedorTts: l.provedor_tts,
    voz: l.voz,
    mensagemId: l.mensagem_id,
    iniciadaEm: ms(l.iniciada_em),
    atendidaEm: msOuNull(l.atendida_em),
    encerradaEm: msOuNull(l.encerrada_em),
    motivoFim: l.motivo_fim,
    duracaoMs: l.duracao_ms,
    religacoes: l.religacoes,
    trocas: l.trocas,
    interrupcoes: l.interrupcoes,
    sttSegundos: l.stt_segundos,
    ttsCaracteres: l.tts_caracteres,
    custoEstimadoUsd: l.custo_estimado_usd === null ? null : Number(l.custo_estimado_usd),
    latenciaP50Ms: l.latencia_p50_ms,
    latenciaP95Ms: l.latencia_p95_ms,
    avaliacao: l.avaliacao,
    transcricaoApagadaEm: msOuNull(l.transcricao_apagada_em),
    resumida: l.resumida,
  };
}

export type NovaLigacao = {
  agenteId: string;
  conversaId: string;
  iniciadaPor: "pessoa" | "produto";
  harness: string | null;
  modelo: string | null;
  provedorStt: string;
  provedorTts: string;
  voz: string;
  /**
   * NOD-218: a cor do processo que abre a ligação (`NOD_COR`); null fora do azul/verde (Mac, local). O boot de uma cor
   * fecha só as vivas dela, e `scripts/ligacoes-orfas.ts` as da cor que saiu.
   */
  instancia?: string | null;
};

/** O que o orquestrador mediu na ligação; gravado uma vez, no fim. */
export type MetricasLigacao = {
  trocas: number;
  interrupcoes: number;
  sttSegundos: number;
  ttsCaracteres: number;
  custoEstimadoUsd: number | null;
  latenciaP50Ms: number | null;
  latenciaP95Ms: number | null;
};

export type NovaFala = FalaLigacao & { ligacaoId: string; confianca?: number | null };

/**
 * Ligações por voz (definido em 2026-10-04, ADR-075, migração 0048). O registro é tipado e fica; a prosa
 * (`ligacao_falas`) a dona apaga. Uma ligação viva por pessoa: o índice único parcial recusa a segunda, e `criar`
 * devolve null nesse caso (o caso de uso responde "já em ligação").
 */
export function ligacoesRepo(conn: Conn, escopo: Escopo) {
  return {
    async criar(n: NovaLigacao): Promise<Ligacao | null> {
      const linhas = await conn<Linha[]>`
        insert into ligacoes (tenant_id, owner_id, agente_id, conversa_id, iniciada_por, harness, modelo, provedor_stt, provedor_tts, voz, instancia)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${n.agenteId}, ${n.conversaId}, ${n.iniciadaPor}, ${n.harness}, ${n.modelo}, ${n.provedorStt}, ${n.provedorTts}, ${n.voz}, ${n.instancia ?? null})
        on conflict do nothing
        returning ${conn.unsafe(COLUNAS)}`;
      const [l] = linhas;
      return l ? paraLigacao(l) : null;
    },

    async buscar(id: string): Promise<Ligacao | null> {
      const [l] = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from ligacoes where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}`;
      return l ? paraLigacao(l) : null;
    },

    async viva(): Promise<Ligacao | null> {
      const [l] = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from ligacoes
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and estado in ('chamando', 'em_curso')
        order by iniciada_em desc limit 1`;
      return l ? paraLigacao(l) : null;
    },

    /**
     * Ligações vivas de qualquer bot desta pessoa — o boot fecha as que não têm mais orquestrador em memória.
     * NOD-218: com `instancia`, só as abertas por aquela cor; com `semInstancia`, também as de instância nula (as da
     * imagem anterior ao azul/verde, na transição). Sem filtro, todas (Mac, local).
     */
    async vivas(f: { instancia?: string; semInstancia?: boolean } = {}): Promise<Ligacao[]> {
      const filtro =
        f.instancia === undefined ? conn`` : f.semInstancia ? conn`and (instancia = ${f.instancia} or instancia is null)` : conn`and instancia = ${f.instancia}`;
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from ligacoes
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and estado in ('chamando', 'em_curso') ${filtro}`;
      return linhas.map(paraLigacao);
    },

    async vincularMensagem(id: string, mensagemId: string): Promise<void> {
      await conn`update ligacoes set mensagem_id = ${mensagemId} where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}`;
    },

    async atender(id: string, agora: number): Promise<Ligacao | null> {
      const [l] = await conn<Linha[]>`
        update ligacoes set estado = 'em_curso', atendida_em = coalesce(atendida_em, ${data(agora)})
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and estado in ('chamando', 'em_curso')
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraLigacao(l) : null;
    },

    async religou(id: string): Promise<void> {
      await conn`update ligacoes set religacoes = religacoes + 1 where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}`;
    },

    /** Só fecha uma vez: a segunda chamada (Desligar e queda do canal juntos) devolve null. */
    async encerrar(id: string, p: { motivo: MotivoFimLigacao; agora: number; metricas?: MetricasLigacao }): Promise<Ligacao | null> {
      const m = p.metricas;
      const [l] = await conn<Linha[]>`
        update ligacoes set
          estado = case when atendida_em is null then 'nao_atendida' else 'encerrada' end,
          encerrada_em = ${data(p.agora)},
          motivo_fim = case when atendida_em is null and ${p.motivo} in ('pessoa_desligou', 'cerebro_caiu', 'midia_caiu') then 'nao_atendida' else ${p.motivo} end,
          duracao_ms = case when atendida_em is null then 0 else greatest(0, (extract(epoch from (${data(p.agora)}::timestamptz - atendida_em)) * 1000)::int) end,
          trocas = ${m?.trocas ?? 0}, interrupcoes = ${m?.interrupcoes ?? 0},
          stt_segundos = ${m?.sttSegundos ?? 0}, tts_caracteres = ${m?.ttsCaracteres ?? 0},
          custo_estimado_usd = ${m?.custoEstimadoUsd ?? null},
          latencia_p50_ms = ${m?.latenciaP50Ms ?? null}, latencia_p95_ms = ${m?.latenciaP95Ms ?? null}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and estado in ('chamando', 'em_curso')
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraLigacao(l) : null;
    },

    async marcarResumida(id: string): Promise<void> {
      await conn`update ligacoes set resumida = true where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}`;
    },

    /** Milissegundos de ligação da pessoa desde `desde` (o limite diário). Só as iniciadas por ela contam. */
    async duracaoDesde(desde: number): Promise<number> {
      const [l] = await conn<{ total: string | null }[]>`
        select sum(coalesce(duracao_ms, 0)) as total from ligacoes
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and iniciada_em >= ${data(desde)} and iniciada_por = 'pessoa'`;
      return l?.total === null || l?.total === undefined ? 0 : Number(l.total);
    },

    async gravarFala(f: NovaFala): Promise<boolean> {
      const linhas = await conn`
        insert into ligacao_falas (tenant_id, owner_id, ligacao_id, seq, autor_tipo, tipo, texto, inicio_ms, fim_ms, interrompida, confianca)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${f.ligacaoId}, ${f.seq}, ${f.autor}, ${f.tipo}, ${f.texto.slice(0, 4000)}, ${Math.max(0, Math.round(f.inicioMs))},
          ${Math.max(0, Math.round(f.fimMs))}, ${f.interrompida}, ${f.confianca ?? null})
        on conflict (tenant_id, ligacao_id, seq) do nothing
        returning id`;
      return linhas.length === 1;
    },

    async falas(ligacaoId: string, limite = 2000): Promise<FalaLigacao[]> {
      const linhas = await conn<{ seq: number; autor_tipo: "pessoa" | "bot"; tipo: FalaLigacao["tipo"]; texto: string; inicio_ms: number; fim_ms: number; interrompida: boolean }[]>`
        select seq, autor_tipo, tipo, texto, inicio_ms, fim_ms, interrompida from ligacao_falas
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and ligacao_id = ${ligacaoId}
        order by seq limit ${limite}`;
      return linhas.map((l) => ({ seq: l.seq, autor: l.autor_tipo, tipo: l.tipo, texto: l.texto, inicioMs: l.inicio_ms, fimMs: l.fim_ms, interrompida: l.interrompida }));
    },

    /** As últimas `n` falas, em ordem crescente (contexto da religação e do resumo de queda). */
    async ultimasFalas(ligacaoId: string, n: number): Promise<FalaLigacao[]> {
      const todas = await this.falas(ligacaoId);
      return todas.slice(-n);
    },

    /** Apaga a prosa (como nod_app, pela policy da dona) e marca quando; o registro e o resumo ficam. */
    async apagarFalas(ligacaoId: string, agora: number): Promise<number> {
      const r = await conn`delete from ligacao_falas where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and ligacao_id = ${ligacaoId}`;
      await conn`update ligacoes set transcricao_apagada_em = ${data(agora)} where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${ligacaoId}`;
      return r.count;
    },

    async avaliar(id: string, nota: "boa" | "ruim", motivo: string | null): Promise<boolean> {
      const r = await conn`
        update ligacoes set avaliacao = ${nota}, avaliacao_motivo = ${motivo}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and estado in ('encerrada', 'nao_atendida')`;
      return r.count === 1;
    },

    /** Consentimento de voz (0048): a versão aceita e quando. */
    async consentimento(): Promise<{ versao: number | null; em: number | null }> {
      const [l] = await conn<{ voz_consentimento_versao: number | null; voz_consentimento_em: Date | null }[]>`
        select voz_consentimento_versao, voz_consentimento_em from preferencias where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId}`;
      return { versao: l?.voz_consentimento_versao ?? null, em: msOuNull(l?.voz_consentimento_em ?? null) };
    },

    async consentir(versao: number, agora: number): Promise<void> {
      await conn`
        insert into preferencias (tenant_id, owner_id, voz_consentimento_versao, voz_consentimento_em)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${versao}, ${data(agora)})
        on conflict (tenant_id, owner_id) do update set voz_consentimento_versao = excluded.voz_consentimento_versao,
          voz_consentimento_em = excluded.voz_consentimento_em, atualizado_em = clock_timestamp()`;
    },

    /** A linha "Chat de voz" é criada no início e atualizada no fim (duração e estado). */
    async atualizarLinha(mensagemId: string, payload: { kind: "ligacao"; ligacaoId: string; duracaoMs: number | null; estado: EstadoLigacao }, texto: string): Promise<void> {
      await conn`
        update mensagens set payload = ${conn.json(payload)}, texto = ${texto}, assunto = ${assuntoDe("sistema", payload, null)}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${mensagemId} and kind = 'sistema'`;
    },
  };
}
