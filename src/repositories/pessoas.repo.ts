import type { Conn, Escopo } from "../shared/types.ts";

export interface Pessoa {
  tenantId: string;
  id: string;
  nome: string;
  iniciais: string;
  /** null = pessoa que não loga pelo Google (ADR-030: ausência de e-mail é recusa, não convite). */
  email: string | null;
}

interface Linha {
  tenant_id: string;
  id: string;
  nome: string;
  iniciais: string;
  email: string | null;
}

const paraPessoa = (l: Linha): Pessoa => ({ tenantId: l.tenant_id, id: l.id, nome: l.nome, iniciais: l.iniciais, email: l.email });

/** Tabela SEM RLS por pessoa (catálogo de identidade): lida sem escopo pelos laços de fundo. */
export async function listarTodas(conn: Conn): Promise<Pessoa[]> {
  const linhas = await conn<Linha[]>`select tenant_id, id, nome, iniciais, email from pessoas order by tenant_id, nome`;
  return linhas.map(paraPessoa);
}

/**
 * Busca de LOGIN (ADR-030): roda ANTES de existir sessão, logo SEM escopo — abrirTxEscopada exige
 * tenantId+pessoaId e lançaria escopo_vazio. Vale pelo mesmo motivo que listarTodas: pessoas é
 * catálogo SEM RLS e nod_app tem GRANT SELECT (0001). Recebe o pool direto, nunca um Tx escopado.
 * Sem diferenciar caixa, pelo mesmo lower() do índice pessoas_email_unico (0006).
 */
export async function buscarPorEmail(conn: Conn, email: string): Promise<Pessoa | null> {
  const alvo = email.trim().toLowerCase();
  if (alvo === "") return null;
  const linhas = await conn<Linha[]>`
    select tenant_id, id, nome, iniciais, email from pessoas
    where email is not null and lower(email) = ${alvo}
    order by tenant_id limit 2`;
  // Dois tenants com o mesmo e-mail seria ambíguo: recusa em vez de escolher (fail-closed).
  if (linhas.length !== 1) return null;
  const l = linhas[0];
  return l ? paraPessoa(l) : null;
}

/**
 * Primeira entrada por domínio admitido (emenda de 2026-10-05 da ADR-030). SEM escopo, como buscarPorEmail:
 * roda antes de existir sessão. nod_app não escreve em `pessoas`; quem insere é a função do dono
 * `nod_admitir_pessoa` (0052), e só quando o domínio do e-mail está em `dominios_admitidos`.
 * null = não admitido (domínio fora da lista, e-mail ou nome fora da forma).
 */
export async function admitirPorDominio(conn: Conn, p: { email: string; nome: string; iniciais: string }): Promise<{ tenantId: string; id: string; criada: boolean } | null> {
  const linhas = await conn<{ o_tenant_id: string; o_pessoa_id: string; o_criada: boolean }[]>`
    select o_tenant_id, o_pessoa_id, o_criada from nod_admitir_pessoa(${p.email}, ${p.nome}, ${p.iniciais})`;
  const l = linhas[0];
  return l ? { tenantId: l.o_tenant_id, id: l.o_pessoa_id, criada: l.o_criada } : null;
}

export function pessoasRepo(conn: Conn, escopo: Escopo) {
  return {
    async buscar(id: string): Promise<Pessoa | null> {
      const linhas = await conn<Linha[]>`select tenant_id, id, nome, iniciais, email from pessoas where tenant_id = ${escopo.tenantId} and id = ${id}`;
      const l = linhas[0];
      return l ? paraPessoa(l) : null;
    },
    async listarDoTenant(): Promise<Pessoa[]> {
      const linhas = await conn<Linha[]>`select tenant_id, id, nome, iniciais, email from pessoas where tenant_id = ${escopo.tenantId} order by nome`;
      return linhas.map(paraPessoa);
    },
  };
}
