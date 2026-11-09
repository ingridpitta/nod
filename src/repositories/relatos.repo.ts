import type { Confianca } from "../contracts/mensagem.ts";
import type { MotivoFalha, MotivoInterrupcao } from "../contracts/motivos.ts";
import type { AlcanceRelato, CategoriaRelato, DiagnosticoRelato, OrigemRelato, Relato, TipoRelato } from "../contracts/relato.ts";
import type { EstadoTurno, OrigemTurno, SinaisTurno } from "../contracts/turno.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { data, jsonb, ms } from "./conversao.ts";

interface Linha {
  tenant_id: string;
  id: string;
  mensagem_id: string | null;
  tipo: TipoRelato;
  origem: OrigemRelato;
  conversa_id: string;
  turno_id: string | null;
  categoria: CategoriaRelato;
  alcance: AlcanceRelato;
  mensagens_anexadas: number;
  estado_turno: EstadoTurno | null;
  origem_turno: OrigemTurno | null;
  sinais: SinaisTurno | null;
  motivo_falha: MotivoFalha | null;
  motivo_interrupcao: MotivoInterrupcao | null;
  modelo: string | null;
  harness: string | null;
  executor: string | null;
  machine_id: string | null;
  custo_usd: string | null;
  reenvios: number | null;
  confianca_mensagem: Confianca;
  mensagem_parcial: boolean;
  versao_app: string | null;
  correlation_id: string | null;
  criado_em: Date;
}

const COLUNAS =
  "tenant_id, id, mensagem_id, tipo, origem, conversa_id, turno_id, categoria, alcance, mensagens_anexadas, estado_turno, origem_turno, sinais, motivo_falha, motivo_interrupcao, modelo, harness, executor, machine_id, custo_usd, reenvios, confianca_mensagem, mensagem_parcial, versao_app, correlation_id, criado_em";

function paraRelato(l: Linha): Relato {
  return {
    tenantId: l.tenant_id,
    id: l.id,
    mensagemId: l.mensagem_id,
    tipo: l.tipo ?? "bug",
    origem: l.origem ?? "botao",
    conversaId: l.conversa_id,
    turnoId: l.turno_id,
    categoria: l.categoria,
    alcance: l.alcance,
    mensagensAnexadas: l.mensagens_anexadas,
    metadados: {
      estadoTurno: l.estado_turno,
      origemTurno: l.origem_turno,
      sinais: l.sinais,
      motivoFalha: l.motivo_falha,
      motivoInterrupcao: l.motivo_interrupcao,
      modelo: l.modelo,
      harness: l.harness,
      executor: l.executor,
      machineId: l.machine_id,
      custoUsd: l.custo_usd === null ? null : Number(l.custo_usd),
      reenvios: l.reenvios,
      confiancaMensagem: l.confianca_mensagem,
      mensagemParcial: l.mensagem_parcial,
      versaoApp: l.versao_app,
      correlationId: l.correlation_id,
    },
    diagnostico: null,
    criadoEm: ms(l.criado_em),
  };
}

export type NovoRelato = {
  mensagemId: string | null;
  /** Ausentes = 'bug' pelo 'botao' (o relato da mensagem, ADR-041). */
  tipo?: TipoRelato;
  origem?: OrigemRelato;
  conversaId: string;
  turnoId: string | null;
  categoria: CategoriaRelato;
  alcance: AlcanceRelato;
  mensagensAnexadas: number;
  estadoTurno: EstadoTurno | null;
  origemTurno: OrigemTurno | null;
  sinais: SinaisTurno | null;
  motivoFalha: MotivoFalha | null;
  motivoInterrupcao: MotivoInterrupcao | null;
  modelo: string | null;
  harness: string | null;
  executor: string | null;
  machineId: string | null;
  custoUsd: number | null;
  reenvios: number | null;
  confiancaMensagem: Confianca;
  mensagemParcial: boolean;
  versaoApp: string | null;
  correlationId: string | null;
};

/** O que a pessoa escreveu e o recorte que ela anexou. Vive separado e some sozinho (ADR-004). */
export type NovaProsaRelato = {
  relatoId: string;
  /** 0062: o título do relato contado ao Nod; o do botão não tem. */
  titulo?: string | null;
  textoPessoa: string | null;
  trecho: { mensagens: { id: string; autor: string; kind: string; texto: string; em: number; naAtividade?: true }[] } | null;
};

export type NovoDiagnostico = {
  turnoId: string;
  erroCru: string | null;
  ferramentas: string[];
  negacoes: string[];
  sessaoCli: string | null;
  em: number;
};

/**
 * Relatos de comportamento indesejado (ADR-041). A prosa mora em `relato_prosa`, apagável por
 * nod_poda; este repositório nunca devolve o texto junto do registro — quem precisa dele pede.
 */
export function relatosRepo(conn: Conn, escopo: Escopo) {
  return {
    async criar(r: NovoRelato): Promise<Relato | null> {
      const [l] = await conn<Linha[]>`
        insert into relatos (
          tenant_id, owner_id, mensagem_id, tipo, origem, conversa_id, turno_id, categoria, alcance, mensagens_anexadas,
          estado_turno, origem_turno, sinais, motivo_falha, motivo_interrupcao, modelo, harness, executor,
          machine_id, custo_usd, reenvios, confianca_mensagem, mensagem_parcial, versao_app, correlation_id)
        values (
          ${escopo.tenantId}, ${escopo.pessoaId}, ${r.mensagemId}, ${r.tipo ?? "bug"}, ${r.origem ?? "botao"}, ${r.conversaId}, ${r.turnoId},
          ${r.categoria}, ${r.alcance}, ${r.mensagensAnexadas}, ${r.estadoTurno}, ${r.origemTurno},
          ${r.sinais === null ? null : jsonb(conn, r.sinais)}, ${r.motivoFalha}, ${r.motivoInterrupcao},
          ${r.modelo}, ${r.harness}, ${r.executor}, ${r.machineId}, ${r.custoUsd}, ${r.reenvios},
          ${r.confiancaMensagem}, ${r.mensagemParcial}, ${r.versaoApp}, ${r.correlationId})
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraRelato(l) : null;
    },

    async gravarProsa(p: NovaProsaRelato): Promise<void> {
      // Nada a guardar: sem texto e sem trecho, a linha de prosa não existe (o relato fica só com
      // os metadados). O caso de uso hoje sempre manda trecho, mas o repositório não depende disso.
      if (!p.titulo && p.textoPessoa === null && (p.trecho === null || p.trecho.mensagens.length === 0)) return;
      await conn`
        insert into relato_prosa (tenant_id, owner_id, relato_id, titulo, texto_pessoa, trecho)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${p.relatoId}, ${p.titulo ?? null}, ${p.textoPessoa},
                ${p.trecho === null ? null : jsonb(conn, p.trecho)})`;
    },

    /**
     * Traz o diagnóstico junto: é o campo que a feature existe para resgatar do stdout, e sem o join
     * a triagem nunca o veria (paraRelato sozinho devolve diagnostico: null). DISTINCT ON pega a
     * PRIMEIRA linha por turno: uma entrega tardia insere uma segunda, mais pobre, e a causa real
     * da falha é a da primeira (definido em 2026-09-21).
     */
    async listar(limite = 100): Promise<Relato[]> {
      // 0062: o título e o começo do texto só dos relatos da PRÓPRIA pessoa — sem eles o relato seria só "Bug" na lista.
      // NOD-367 (emenda ao ADR-041): vale também para o do botão, cujo título passa a ser o texto dela, e não mais
      // "Outra coisa". O de outra pessoa continua sem prosa: o filtro por owner_id no join repete a RLS de relato_prosa
      // (privada, ADR-004) de propósito, para a lista não depender só dela.
      const linhas = await conn<(Linha & { erro_cru: string | null; ferramentas: string[] | null; negacoes: string[] | null; sessao_cli: string | null; titulo: string | null; resumo: string | null })[]>`
        select r.${conn.unsafe(COLUNAS.split(", ").join(", r."))},
               d.erro_cru, d.ferramentas, d.negacoes, d.sessao_cli,
               p.titulo, left(p.texto_pessoa, 160) as resumo
        from relatos r
        left join relato_prosa p on p.tenant_id = r.tenant_id and p.relato_id = r.id and p.owner_id = ${escopo.pessoaId}
        left join (
          select distinct on (tenant_id, turno_id) tenant_id, turno_id, erro_cru, ferramentas, negacoes, sessao_cli
          from turno_diagnosticos where tenant_id = ${escopo.tenantId}
          order by tenant_id, turno_id, em asc
        ) d on d.tenant_id = r.tenant_id and d.turno_id = r.turno_id
        where r.tenant_id = ${escopo.tenantId}
        order by r.criado_em desc, r.id desc limit ${limite}`;
      return linhas.map((l) => ({
        ...paraRelato(l),
        titulo: l.titulo,
        resumo: l.resumo,
        diagnostico: l.erro_cru === null && l.ferramentas === null ? null : { erroCru: l.erro_cru, ferramentas: l.ferramentas ?? [], negacoes: l.negacoes ?? [], sessaoCli: l.sessao_cli },
      }));
    },

    async buscar(id: string): Promise<Relato | null> {
      const [l] = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from relatos where tenant_id = ${escopo.tenantId} and id = ${id}`;
      return l ? paraRelato(l) : null;
    },

    /** Quantos relatos esta pessoa contou ao Nod desde `desde` (o teto diário de registrar_relato). */
    async contarDoNodDesde(desde: number): Promise<number> {
      const [l] = await conn<{ n: number }[]>`select count(*)::int as n from relatos
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and origem = 'nod' and criado_em >= ${data(desde)}`;
      return l?.n ?? 0;
    },

    /** Só quem for abrir o relato lê a prosa: ela não viaja na listagem (o título e o resumo, só os próprios). */
    async prosaDe(relatoId: string): Promise<NovaProsaRelato | null> {
      const [l] = await conn<{ relato_id: string; texto_pessoa: string | null; trecho: NovaProsaRelato["trecho"] }[]>`
        select relato_id, texto_pessoa, trecho from relato_prosa
        where tenant_id = ${escopo.tenantId} and relato_id = ${relatoId} limit 1`;
      return l ? { relatoId: l.relato_id, textoPessoa: l.texto_pessoa, trecho: l.trecho } : null;
    },

    /**
     * Diagnóstico do turno que não concluiu, gravado pela ponte. Sem linha (turno que deu certo,
     * ou entrega anterior a esta migração) o relato simplesmente não tem diagnóstico.
     */
    async registrarDiagnostico(d: NovoDiagnostico): Promise<void> {
      await conn`
        insert into turno_diagnosticos (tenant_id, owner_id, turno_id, erro_cru, ferramentas, negacoes, sessao_cli, em)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${d.turnoId}, ${d.erroCru},
                ${d.ferramentas}, ${d.negacoes}, ${d.sessaoCli}, ${data(d.em)})`;
    },

    /**
     * A PRIMEIRA linha do turno, não a última: uma entrega tardia assenta de novo e grava um segundo
     * diagnóstico, geralmente mais pobre — e a causa real da falha é a da primeira (ADR-010).
     */
    async diagnosticoDoTurno(turnoId: string): Promise<DiagnosticoRelato | null> {
      const [l] = await conn<{ erro_cru: string | null; ferramentas: string[]; negacoes: string[]; sessao_cli: string | null }[]>`
        select erro_cru, ferramentas, negacoes, sessao_cli from turno_diagnosticos
        where tenant_id = ${escopo.tenantId} and turno_id = ${turnoId} order by em asc limit 1`;
      return l ? { erroCru: l.erro_cru, ferramentas: l.ferramentas, negacoes: l.negacoes, sessaoCli: l.sessao_cli } : null;
    },
  };
}
