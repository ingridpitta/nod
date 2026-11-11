import type { Assunto } from "../contracts/destino-no-chat.ts";
import type { Mensagem } from "../contracts/mensagem.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { assuntoNaLeitura } from "../domain/assunto-do-texto.ts";
import { MOTIVOS_DE_CONECTOR_FORA } from "../domain/decisoes.ts";
import { colunaPrimeira, COLUNAS_MENSAGEM, paraMensagem, type LinhaMensagem } from "./mensagens.repo.ts";

/**
 * As três fontes da Atividade do bot num dia (definido em 2026-10-18, chat limpo, PR 1; ADR-114). O dia é uma FAIXA em
 * `criado_em`/`em`/`terminado_em` (`[ini, fim)`), calculada uma vez pelo Postgres no fuso; nunca
 * `(em at time zone fuso)::date = dia`, que não usa índice (trilha.repo.ts `filtrar`).
 *
 * - mensagens: a conversa própria, no índice mensagens_por_conversa (tenant, conversa, criado_em), com os assuntos que a
 *   Atividade lista. `trabalho_aberto`, `frentes_abertas` e `frentes_terminadas` de um trabalho que a fonte 3 já conta
 *   naquele dia não repetem;
 * - trilha: as negações de conector indisponível do bot, no índice parcial trilha_negacoes_por_agente (0091), uma linha
 *   por conector e causa;
 * - trabalhos: os do bot que começaram ou terminaram no dia (trabalhos_por_conversa), uma linha por começo e uma por fim.
 *
 * Linha sem assunto (de antes da 0091, que o backfill ainda não alcançou; chat limpo, PR 2): entra como candidata quando
 * não é fala (kind texto sem payload, ou com o resumo das ações da NOD-353) e o assunto é resolvido na leitura, como o backfill faria (assuntoNaLeitura); fica
 * se ele está entre os da Atividade. A contagem resolve as candidatas do mesmo jeito.
 *
 * As contagens usam os MESMOS filtros das listas: `contagem=1` e o `total` da página batem sempre. Os `coalesce` na não
 * repetição são de propósito: sem eles, a mensagem sem payload dava `not (null)` e sumia (medido em 2026-10-18 no teste
 * de integração: o "Anotei" do dia não aparecia).
 */
export type Faixa = { ini: Date; fim: Date };

/** Os motivos da negação de conector indisponível (adapters/mcp-proxy/negacao.ts): a trilha não grava a classe. */
export const MOTIVOS_DE_CONECTOR = MOTIVOS_DE_CONECTOR_FORA;

export type LinhaNegacaoDeConector = { chave: string; motivo: string; ferramenta: string; conector: string | null; vezes: number; em: Date };
/** definido em 2026-10-27 (NOD-374): as voltas de um app (kind conector_recuperado), uma linha por app, com a mais recente. */
export type LinhaRecuperacaoDeConector = { chave: string; ferramenta: string; conector: string | null; vezes: number; em: Date };
export type LinhaTrabalhoDoDia = { id: string; titulo: string; forma: "task" | "frente"; origem: string; estado: string; criado_em: Date; terminado_em: Date | null };

/** O assunto da linha se ele é um dos `assuntos` (o gravado, ou o resolvido na leitura na linha sem backfill). */
function assuntoDaLinha(l: Pick<LinhaMensagem, "assunto" | "kind" | "payload" | "texto" | "decidido_por"> & { primeira: boolean | null }, assuntos: readonly Assunto[]): Assunto | null {
  const lido = assuntoNaLeitura({ assunto: l.assunto, kind: l.kind, payload: l.payload, texto: l.texto, decididoPor: l.decidido_por, primeiraDaConversa: l.primeira === true });
  return assuntos.find((a) => a === lido) ?? null;
}

export function atividadeRepo(conn: Conn, escopo: Escopo) {
  /** Os trabalhos da conversa que começaram ou terminaram no dia (o recorte da fonte 3 e da não repetição). */
  const filtroTrabalhos = (conversaId: string, f: Faixa) => conn`
    tenant_id = ${escopo.tenantId} and conversa_id = ${conversaId} and criado_em < ${f.fim}
      and (criado_em >= ${f.ini} or (terminado_em >= ${f.ini} and terminado_em < ${f.fim}))`;
  const trabalhosDoDia = (conversaId: string, f: Faixa) => conn`select id from trabalhos where ${filtroTrabalhos(conversaId, f)}`;

  const filtroMensagens = (conversaId: string, f: Faixa, assuntos: readonly string[]) => conn`
    m.tenant_id = ${escopo.tenantId} and m.conversa_id = ${conversaId} and m.criado_em >= ${f.ini} and m.criado_em < ${f.fim}
      and (m.assunto = any(${[...assuntos]}::text[]) or (m.assunto is null and (m.kind <> 'texto' or coalesce(m.payload->>'kind', 'acoes_do_turno') <> 'acoes_do_turno')))
      and not (coalesce(m.payload->>'kind', '') = 'trabalho_aberto' and coalesce(m.payload->>'trabalhoId', '') in (select d.id::text from (${trabalhosDoDia(conversaId, f)}) d))
      and not (coalesce(m.payload->>'kind', '') in ('frentes_abertas', 'frentes_terminadas') and exists (
        select 1 from jsonb_array_elements(coalesce(m.payload->'frentes', '[]'::jsonb)) fr
        where fr->>'trabalhoId' in (select d.id::text from (${trabalhosDoDia(conversaId, f)}) d)))`;

  const filtroTrilha = (agenteId: string, f: Faixa) => conn`
    t.tenant_id = ${escopo.tenantId} and t.agente_id = ${agenteId} and t.kind = 'negacao' and t.em >= ${f.ini} and t.em < ${f.fim}
      and t.motivo = any(${[...MOTIVOS_DE_CONECTOR]}::text[])`;

  const filtroRecusaDoQuadro = (agenteId: string, f: Faixa) => conn`
    t.tenant_id = ${escopo.tenantId} and t.agente_id = ${agenteId} and t.kind = 'negacao' and t.ferramenta = 'gerir_quadro'
      and t.regra = 'regra:quadro_recusou' and t.em >= ${f.ini} and t.em < ${f.fim}`;

  const filtroRecuperacao = (agenteId: string, f: Faixa) => conn`
    t.tenant_id = ${escopo.tenantId} and t.agente_id = ${agenteId} and t.kind = 'conector_recuperado' and t.em >= ${f.ini} and t.em < ${f.fim}`;

  return {
    /** `[ini, fim)` do dia no fuso, pelo relógio de fusos do Postgres (o mesmo que compara as colunas). */
    async faixaDoDia(dia: string, fuso: string): Promise<Faixa> {
      const [l] = await conn<{ ini: Date; fim: Date }[]>`
        select (${dia}::date::timestamp at time zone ${fuso}) as ini, ((${dia}::date + 1)::timestamp at time zone ${fuso}) as fim`;
      if (!l) throw new Error("faixa do dia sem resposta");
      return l;
    },

    /** As mensagens do dia com o assunto (o gravado, ou o resolvido na leitura): sempre um dos `assuntos`. */
    async mensagens(conversaId: string, f: Faixa, assuntos: readonly Assunto[], limite: number): Promise<{ mensagem: Mensagem; assunto: Assunto }[]> {
      const linhas = await conn<(LinhaMensagem & { primeira: boolean | null })[]>`
        select ${conn.unsafe(COLUNAS_MENSAGEM.split(", ").map((c) => `m.${c}`).join(", "))}, ${colunaPrimeira(conn, "m")} from mensagens m
        where ${filtroMensagens(conversaId, f, assuntos)}
        order by m.criado_em desc, m.id desc limit ${limite}`;
      return linhas.flatMap((l) => {
        const assunto = assuntoDaLinha(l, assuntos);
        return assunto ? [{ mensagem: paraMensagem(l), assunto }] : [];
      });
    },

    async contarMensagens(conversaId: string, f: Faixa, assuntos: readonly Assunto[]): Promise<number> {
      const [l] = await conn<{ n: number }[]>`select count(*)::int as n from mensagens m where ${filtroMensagens(conversaId, f, assuntos)} and m.assunto is not null`;
      const semAssunto = await conn<(LinhaMensagem & { primeira: boolean | null })[]>`
        select m.kind, m.payload, m.texto, m.decidido_por, m.assunto, ${colunaPrimeira(conn, "m")} from mensagens m
        where ${filtroMensagens(conversaId, f, assuntos)} and m.assunto is null`;
      return (l?.n ?? 0) + semAssunto.filter((x) => assuntoDaLinha(x, assuntos) !== null).length;
    },

    /** Uma linha por conector (ou ferramenta, sem conector) e causa, com quantas vezes e a mais recente. */
    async negacoesDeConector(agenteId: string, f: Faixa): Promise<LinhaNegacaoDeConector[]> {
      return conn<LinhaNegacaoDeConector[]>`
        select coalesce(t.conector_id::text, t.ferramenta) as chave, t.motivo, max(t.ferramenta) as ferramenta, max(c.nome) as conector,
          count(*)::int as vezes, max(t.em) as em
        from trilha t left join conectores c on c.tenant_id = t.tenant_id and c.id = t.conector_id
        where ${filtroTrilha(agenteId, f)}
        group by coalesce(t.conector_id::text, t.ferramenta), t.motivo
        order by max(t.em) desc`;
    },

    async contarNegacoesDeConector(agenteId: string, f: Faixa): Promise<number> {
      const [l] = await conn<{ n: number }[]>`
        select count(*)::int as n from (select 1 from trilha t where ${filtroTrilha(agenteId, f)} group by coalesce(t.conector_id::text, t.ferramenta), t.motivo) g`;
      return l?.n ?? 0;
    },

    /** ADA-26: as recusas do gerir_quadro no dia (uma linha, com quantas vezes e a mais recente). */
    async recusasDoQuadro(agenteId: string, f: Faixa): Promise<{ vezes: number; em: Date }[]> {
      return conn<{ vezes: number; em: Date }[]>`
        select count(*)::int as vezes, max(t.em) as em from trilha t where ${filtroRecusaDoQuadro(agenteId, f)} having count(*) > 0`;
    },

    async contarRecusasDoQuadro(agenteId: string, f: Faixa): Promise<number> {
      const [l] = await conn<{ n: number }[]>`select (count(*) > 0)::int as n from trilha t where ${filtroRecusaDoQuadro(agenteId, f)}`;
      return l?.n ?? 0;
    },

    /** NOD-374: "Gmail voltou sozinho" — uma linha por app no dia, com quantas vezes e a mais recente. */
    async recuperacoesDeConector(agenteId: string, f: Faixa): Promise<LinhaRecuperacaoDeConector[]> {
      return conn<LinhaRecuperacaoDeConector[]>`
        select coalesce(t.conector_id::text, t.ferramenta) as chave, max(t.ferramenta) as ferramenta, max(c.nome) as conector,
          count(*)::int as vezes, max(t.em) as em
        from trilha t left join conectores c on c.tenant_id = t.tenant_id and c.id = t.conector_id
        where ${filtroRecuperacao(agenteId, f)}
        group by coalesce(t.conector_id::text, t.ferramenta)
        order by max(t.em) desc`;
    },

    async contarRecuperacoesDeConector(agenteId: string, f: Faixa): Promise<number> {
      const [l] = await conn<{ n: number }[]>`
        select count(distinct coalesce(t.conector_id::text, t.ferramenta))::int as n from trilha t where ${filtroRecuperacao(agenteId, f)}`;
      return l?.n ?? 0;
    },

    // O filtro direto, sem `id in (…)`: medido em 2026-10-18 (EXPLAIN num banco sintético de 3.000 trabalhos), o `in`
    // levava o Postgres a varrer a tabela inteira para o lado de fora do hash join.
    async trabalhos(conversaId: string, f: Faixa, limite: number): Promise<LinhaTrabalhoDoDia[]> {
      return conn<LinhaTrabalhoDoDia[]>`
        select id, titulo, forma, origem, estado, criado_em, terminado_em from trabalhos
        where ${filtroTrabalhos(conversaId, f)}
        order by greatest(criado_em, coalesce(terminado_em, criado_em)) desc, id desc limit ${limite}`;
    },

    /** Um item por começo no dia e um por fim no dia (o trabalho que começou e terminou hoje conta dois). */
    async contarTrabalhos(conversaId: string, f: Faixa): Promise<number> {
      const [l] = await conn<{ n: number }[]>`
        select (count(*) filter (where criado_em >= ${f.ini}) + count(*) filter (where terminado_em >= ${f.ini} and terminado_em < ${f.fim}))::int as n
        from trabalhos where ${filtroTrabalhos(conversaId, f)}`;
      return l?.n ?? 0;
    },
  };
}
