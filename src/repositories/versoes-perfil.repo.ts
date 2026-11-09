import type { CorAgente, FormaAgente } from "../contracts/agente.ts";
import { type AutorVersao, CAMPOS_VERSIONAVEIS, type CampoVersionavel, type OrigemVersao, type PerfilVersionavel, type VersaoPerfil, VERSOES_POR_PAGINA } from "../contracts/versoes-perfil.ts";
import { redigirPerfil, temRedacao } from "../domain/versoes-perfil.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { ms } from "./conversao.ts";

interface Linha {
  id: string;
  agente_id: string;
  versao: number;
  origem: OrigemVersao;
  autor: AutorVersao;
  proposta_id: string | null;
  restaurada_de: number | null;
  nome: string;
  titulo: string;
  descricao: string;
  forma: FormaAgente;
  cor: CorAgente;
  voz: string | null;
  voz_velocidade: number;
  campos: string[];
  criado_em: Date;
}

const COLUNAS = "id, agente_id, versao, origem, autor, proposta_id, restaurada_de, nome, titulo, descricao, forma, cor, voz, voz_velocidade, campos, criado_em";

const CAMPOS = new Set<string>(CAMPOS_VERSIONAVEIS);

export const paraVersao = (l: Linha): VersaoPerfil => {
  const perfil: PerfilVersionavel = {
    nome: l.nome,
    titulo: l.titulo,
    descricao: l.descricao,
    forma: l.forma,
    cor: l.cor,
    voz: l.voz,
    vozVelocidade: Number(l.voz_velocidade),
  };
  return {
    id: l.id,
    agenteId: l.agente_id,
    versao: l.versao,
    origem: l.origem,
    autor: l.autor,
    propostaId: l.proposta_id,
    restauradaDe: l.restaurada_de,
    perfil,
    campos: l.campos.filter((c): c is CampoVersionavel => CAMPOS.has(c)),
    criadoEm: ms(l.criado_em),
    redigida: temRedacao(perfil),
  };
};

export type NovaVersao = {
  agenteId: string;
  versao: number;
  origem: OrigemVersao;
  autor?: AutorVersao;
  propostaId?: string | null;
  restauradaDe?: number | null;
  perfil: PerfilVersionavel;
  campos: CampoVersionavel[];
};

/**
 * definido em 2026-10-30 (NOD-20): as versões do perfil do bot. Só acrescenta (nod_app sem UPDATE/DELETE); a poda das
 * mais velhas passa pela função SECURITY DEFINER nod_podar_versoes_perfil (0132). Quem grava trava antes a linha do agente.
 */
export function versoesPerfilRepo(conn: Conn, escopo: Escopo) {
  return {
    async inserir(v: NovaVersao): Promise<VersaoPerfil> {
      // A redação mora aqui também (idempotente: o marcador não é remascarado): nenhum chamador grava segredo em claro.
      const p = redigirPerfil(v.perfil);
      const [l] = await conn<Linha[]>`
        insert into agente_perfil_versoes (tenant_id, owner_id, agente_id, versao, origem, autor, proposta_id, restaurada_de,
          nome, titulo, descricao, forma, cor, voz, voz_velocidade, campos)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${v.agenteId}, ${v.versao}, ${v.origem}, ${v.autor ?? "pessoa"}, ${v.propostaId ?? null},
          ${v.restauradaDe ?? null}, ${p.nome}, ${p.titulo}, ${p.descricao}, ${p.forma}, ${p.cor}, ${p.voz}, ${p.vozVelocidade},
          ${conn.array(v.campos)})
        returning ${conn.unsafe(COLUNAS)}`;
      if (!l) throw new Error("versão do perfil não gravada");
      return paraVersao(l);
    },

    /** Mais novas primeiro; `antes` é o número da última versão já mostrada. */
    async listar(agenteId: string, antes?: number | null, limite = VERSOES_POR_PAGINA): Promise<{ versoes: VersaoPerfil[]; mais: boolean }> {
      const cursor = antes ? conn`and versao < ${antes}` : conn``;
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from agente_perfil_versoes
        where tenant_id = ${escopo.tenantId} and agente_id = ${agenteId} ${cursor}
        order by versao desc limit ${limite + 1}`;
      return { versoes: linhas.slice(0, limite).map(paraVersao), mais: linhas.length > limite };
    },

    async buscar(agenteId: string, versao: number): Promise<VersaoPerfil | null> {
      const [l] = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from agente_perfil_versoes where tenant_id = ${escopo.tenantId} and agente_id = ${agenteId} and versao = ${versao}`;
      return l ? paraVersao(l) : null;
    },

    async ultima(agenteId: string): Promise<VersaoPerfil | null> {
      const [l] = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from agente_perfil_versoes where tenant_id = ${escopo.tenantId} and agente_id = ${agenteId}
        order by versao desc limit 1`;
      return l ? paraVersao(l) : null;
    },

    async contar(agenteId: string): Promise<number> {
      const [l] = await conn<{ n: number }[]>`
        select count(*)::int as n from agente_perfil_versoes where tenant_id = ${escopo.tenantId} and agente_id = ${agenteId}`;
      return l?.n ?? 0;
    },

    /** Mantém as 50 últimas do bot (só as da pessoa do escopo). Devolve quantas apagou. */
    async podar(agenteId: string): Promise<number> {
      const [l] = await conn<{ n: number }[]>`select nod_podar_versoes_perfil(${agenteId}::uuid) as n`;
      return l?.n ?? 0;
    },
  };
}
