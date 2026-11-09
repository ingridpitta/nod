import { ESTADO_MAX_BYTES_ARTEFATO, type Artefato, type EstadoArtefato, type VersaoArtefato } from "../contracts/artefato.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { ms } from "./conversao.ts";

interface LinhaArtefato {
  id: string;
  agente_id: string;
  conversa_id: string;
  titulo: string;
  versao_atual: number;
  criado_em: Date;
  atualizado_em: Date;
}

interface LinhaVersao {
  artefato_id: string;
  versao: number;
  html: string;
  mensagem_id: string | null;
  criado_em: Date;
}

interface LinhaEstado {
  artefato_id: string;
  dados: unknown;
  atualizado_em: Date;
}

const ARTEFATO = "id, agente_id, conversa_id, titulo, versao_atual, criado_em, atualizado_em";
const VERSAO = "artefato_id, versao, html, mensagem_id, criado_em";

const paraArtefato = (l: LinhaArtefato): Artefato => ({
  id: l.id,
  agenteId: l.agente_id,
  conversaId: l.conversa_id,
  titulo: l.titulo,
  versaoAtual: l.versao_atual,
  criadoEm: ms(l.criado_em),
  atualizadoEm: ms(l.atualizado_em),
});

const paraVersao = (l: LinhaVersao): VersaoArtefato => ({ artefatoId: l.artefato_id, versao: l.versao, html: l.html, mensagemId: l.mensagem_id, criadoEm: ms(l.criado_em) });

const paraEstado = (l: LinhaEstado): EstadoArtefato => ({ artefatoId: l.artefato_id, dados: l.dados, atualizadoEm: ms(l.atualizado_em) });

/**
 * Artefatos do nod (ADR-051, 0031). Tudo é da pessoa do escopo (RLS por owner_id, sem perna extra): outra
 * pessoa do tenant não vê o artefato, a versão nem o estado. O estado é UM por pessoa (UNIQUE com owner_id).
 */
export function artefatosRepo(conn: Conn, escopo: Escopo) {
  return {
    async criar(a: { agenteId: string; conversaId: string; titulo: string }): Promise<Artefato | null> {
      const [l] = await conn<LinhaArtefato[]>`
        insert into artefatos (tenant_id, owner_id, agente_id, conversa_id, titulo)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${a.agenteId}, ${a.conversaId}, ${a.titulo})
        returning ${conn.unsafe(ARTEFATO)}`;
      return l ? paraArtefato(l) : null;
    },

    async buscar(id: string): Promise<Artefato | null> {
      const [l] = await conn<LinhaArtefato[]>`select ${conn.unsafe(ARTEFATO)} from artefatos where tenant_id = ${escopo.tenantId} and id = ${id}`;
      return l ? paraArtefato(l) : null;
    },

    /**
     * A próxima versão: sobe versao_atual e troca o título na MESMA instrução, com a linha travada pelo
     * UPDATE — duas publicações simultâneas do mesmo artefato saem v2 e v3, nunca duas v2. Só a dona
     * (a policy de update é por owner_id); null = não achou (id de outra pessoa ou inexistente).
     */
    async proximaVersao(id: string, titulo: string): Promise<Artefato | null> {
      const [l] = await conn<LinhaArtefato[]>`
        update artefatos set versao_atual = versao_atual + 1, titulo = ${titulo}, atualizado_em = clock_timestamp()
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}
        returning ${conn.unsafe(ARTEFATO)}`;
      return l ? paraArtefato(l) : null;
    },

    async gravarVersao(v: { artefatoId: string; versao: number; html: string; mensagemId: string | null }): Promise<VersaoArtefato | null> {
      const [l] = await conn<LinhaVersao[]>`
        insert into artefato_versoes (tenant_id, owner_id, artefato_id, versao, html, mensagem_id)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${v.artefatoId}, ${v.versao}, ${v.html}, ${v.mensagemId})
        returning ${conn.unsafe(VERSAO)}`;
      return l ? paraVersao(l) : null;
    },

    async versao(artefatoId: string, versao: number): Promise<VersaoArtefato | null> {
      const [l] = await conn<LinhaVersao[]>`
        select ${conn.unsafe(VERSAO)} from artefato_versoes where tenant_id = ${escopo.tenantId} and artefato_id = ${artefatoId} and versao = ${versao}`;
      return l ? paraVersao(l) : null;
    },

    /** O estado DA PESSOA do escopo (o filtro por owner_id é a segunda camada sobre a RLS). */
    async estado(artefatoId: string): Promise<EstadoArtefato | null> {
      const [l] = await conn<LinhaEstado[]>`
        select artefato_id, dados, atualizado_em from artefato_estados
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and artefato_id = ${artefatoId}`;
      return l ? paraEstado(l) : null;
    },

    /**
     * Grava (ou troca) o estado da pessoa. `json` é o texto já validado; o teto é conferido de novo na
     * forma normalizada do jsonb, que é o que o CHECK artefato_estado_tamanho mede — sem caber, nada é
     * gravado e volta null (quem chama recusa com entrada_invalida em vez de o CHECK virar 500).
     */
    async salvarEstado(artefatoId: string, json: string): Promise<EstadoArtefato | null> {
      // `::text::jsonb`, não `::jsonb`: com o parâmetro tipado jsonb o postgres.js serializa a string de novo
      // e o banco guarda um JSON-string (medido em 2026-09-28: `dados` voltava "{\"a\":true}").
      const [l] = await conn<LinhaEstado[]>`
        insert into artefato_estados (tenant_id, owner_id, artefato_id, dados)
        select ${escopo.tenantId}, ${escopo.pessoaId}, ${artefatoId}, d from (select ${json}::text::jsonb as d) novo
        where octet_length(d::text) <= ${ESTADO_MAX_BYTES_ARTEFATO}
        on conflict (tenant_id, artefato_id, owner_id) do update set dados = excluded.dados, atualizado_em = clock_timestamp()
        returning artefato_id, dados, atualizado_em`;
      return l ? paraEstado(l) : null;
    },
  };
}
