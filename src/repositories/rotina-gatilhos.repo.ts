import type { GatilhoDaRotina } from "../contracts/rotina.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { data, ms, msOuNull } from "./conversao.ts";

interface Linha {
  id: string;
  rotina_id: string;
  prefixo: string;
  hash: Buffer;
  token_cifrado: string;
  segredo_hmac_cifrado: string;
  criado_em: Date;
  assinado_em: Date | null;
}

/** O vivo com o que só a rota pública e o Copiar usam: o hash para comparar e os segredos cifrados. Nunca vai à tela. */
export type GatilhoVivo = GatilhoDaRotina & { hash: Buffer; tokenCifrado: string; segredoHmacCifrado: string };

const COLUNAS = "id, rotina_id, prefixo, hash, token_cifrado, segredo_hmac_cifrado, criado_em, assinado_em";

const paraVivo = (l: Linha): GatilhoVivo => ({
  id: l.id,
  rotinaId: l.rotina_id,
  prefixo: l.prefixo,
  criadoEm: ms(l.criado_em),
  assinadoEm: msOuNull(l.assinado_em),
  hash: l.hash,
  tokenCifrado: l.token_cifrado,
  segredoHmacCifrado: l.segredo_hmac_cifrado,
});

/**
 * O endereço secreto da rotina webhook (NOD-84, ADR-139). Guarda o hash do token (a comparação é em tempo constante no
 * Node, casaHashGatilho) e o token e o segredo HMAC CIFRADOS (NOD_CREDENTIAL_KEY), só para o Copiar da dona. Um vivo
 * por rotina (índice único parcial): gerar novo revoga o anterior na mesma transação. Sob RLS só a dona vê os dela; o
 * WHERE repete isso (ADR-003).
 */
export function rotinaGatilhosRepo(conn: Conn, escopo: Escopo) {
  return {
    async criar(e: { rotinaId: string; prefixo: string; hash: Buffer; tokenCifrado: string; segredoHmacCifrado: string }, agora: number): Promise<GatilhoDaRotina | null> {
      await conn`update rotina_gatilhos set revogado_em = ${data(agora)}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and rotina_id = ${e.rotinaId} and revogado_em is null`;
      const [l] = await conn<Linha[]>`
        insert into rotina_gatilhos (tenant_id, owner_id, rotina_id, prefixo, hash, token_cifrado, segredo_hmac_cifrado, criado_em)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${e.rotinaId}, ${e.prefixo}, ${e.hash}, ${e.tokenCifrado}, ${e.segredoHmacCifrado}, ${data(agora)})
        returning ${conn.unsafe(COLUNAS)}`;
      if (!l) return null;
      const { hash: _h, tokenCifrado: _t, segredoHmacCifrado: _s, ...dto } = paraVivo(l);
      return dto;
    },

    /** O vivo da rotina. `travar` = FOR UPDATE até o fim da tx (a rota pública serializa as chamadas da mesma rotina). */
    async vivoDaRotina(rotinaId: string, opcoes?: { travar?: boolean }): Promise<GatilhoVivo | null> {
      const [l] = opcoes?.travar
        ? await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from rotina_gatilhos
            where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and rotina_id = ${rotinaId} and revogado_em is null for update`
        : await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from rotina_gatilhos
            where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and rotina_id = ${rotinaId} and revogado_em is null`;
      return l ? paraVivo(l) : null;
    },

    /** Os vivos das rotinas da pessoa (a lista e o card mostram o endereço mascarado). */
    async vivosDaPessoa(): Promise<GatilhoDaRotina[]> {
      const linhas = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from rotina_gatilhos
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and revogado_em is null`;
      return linhas.map((l) => ({ id: l.id, rotinaId: l.rotina_id, prefixo: l.prefixo, criadoEm: ms(l.criado_em), assinadoEm: msOuNull(l.assinado_em) }));
    },

    /** Excluir ou pausar não revoga; excluir a rotina sim (o endereço morre com ela). Idempotente. */
    async revogarDaRotina(rotinaId: string, agora: number): Promise<number> {
      const r = await conn`update rotina_gatilhos set revogado_em = ${data(agora)}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and rotina_id = ${rotinaId} and revogado_em is null`;
      return r.count;
    },

    /** A 1ª chamada com assinatura válida: dali em diante a assinatura vira obrigatória. A primeira data fica. */
    async marcarAssinado(id: string, agora: number): Promise<boolean> {
      const r = await conn`update rotina_gatilhos set assinado_em = coalesce(assinado_em, ${data(agora)})
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and revogado_em is null`;
      return r.count === 1;
    },
  };
}
