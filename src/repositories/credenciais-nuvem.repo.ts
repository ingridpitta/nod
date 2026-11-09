import type { CredencialNuvem } from "../contracts/provedor-nuvem.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { data } from "./conversao.ts";

type Linha = { id: string; provedor: "gcp"; projeto: string; conta_servico: string };
const credencial = (l: Linha): CredencialNuvem => ({ id: l.id, provedor: l.provedor, projeto: l.projeto, contaServico: l.conta_servico });

/**
 * ADR-121 (NOD-92): a chave da conta de serviço do projeto da pessoa no Google, cifrada (cifrar(), NOD_CREDENTIAL_KEY).
 * O repositório só guarda e devolve o texto cifrado; quem decifra é o adaptador da nuvem, na hora de chamar a API. A chave
 * nunca vai para log nem para a tela.
 */
export function credenciaisNuvemRepo(conn: Conn, escopo: Escopo) {
  return {
    /** Grava (ou gira, no Reconectar) a chave do projeto. Uma linha por projeto: a chave nova substitui a velha. */
    async gravar(c: { provedor: "gcp"; projeto: string; contaServico: string; chaveCifrada: string; chaveNome?: string | null }): Promise<CredencialNuvem> {
      const [l] = await conn<Linha[]>`
        insert into credenciais_nuvem (tenant_id, owner_id, provedor, projeto, conta_servico, chave_cifrada, chave_nome)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${c.provedor}, ${c.projeto}, ${c.contaServico}, ${c.chaveCifrada}, ${c.chaveNome ?? null})
        on conflict (tenant_id, owner_id, provedor, projeto) do update
          set conta_servico = excluded.conta_servico, chave_cifrada = excluded.chave_cifrada, chave_nome = excluded.chave_nome, criada_em = clock_timestamp(), revogada_em = null
        returning id, provedor, projeto, conta_servico`;
      return credencial(l!);
    },

    /** A credencial viva mais recente da pessoa (uma conta Google por pessoa na v1). */
    async atual(provedor: "gcp" = "gcp"): Promise<CredencialNuvem | null> {
      const [l] = await conn<Linha[]>`select id, provedor, projeto, conta_servico from credenciais_nuvem
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and provedor = ${provedor} and revogada_em is null
        order by criada_em desc limit 1`;
      return l ? credencial(l) : null;
    },

    /** O texto cifrado da chave. Só o adaptador da nuvem chama. */
    async chaveCifrada(id: string): Promise<string | null> {
      const [l] = await conn<{ chave_cifrada: string }[]>`select chave_cifrada from credenciais_nuvem
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and revogada_em is null`;
      return l?.chave_cifrada ?? null;
    },

    async revogar(id: string, agora: number): Promise<boolean> {
      const r = await conn`update credenciais_nuvem set revogada_em = coalesce(revogada_em, ${data(agora)})
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} returning id`;
      return r.length > 0;
    },
  };
}
