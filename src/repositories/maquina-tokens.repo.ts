import type { ChaveMaquinaDto } from "../contracts/api.ts";
import type { PapelMaquina, PlataformaMaquina } from "../contracts/ponte.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { data, ms, msOuNull } from "./conversao.ts";

interface Linha {
  id: string;
  nome: string;
  prefixo: string;
  criado_em: Date;
  ultimo_uso_em: Date | null;
  revogado_em: Date | null;
  papel: PapelMaquina;
}

/** definido em 2026-10-20 (NOD-293 A8): `ultimo_uso_em` atrasa até isto; a tela mostra o uso em minutos. */
export const MARCAR_USO_A_CADA_MS = 30_000;

const paraDto = (l: Linha): ChaveMaquinaDto => ({ id: l.id, nome: l.nome, prefixo: l.prefixo, criadaEm: ms(l.criado_em), ultimoUsoEm: msOuNull(l.ultimo_uso_em), revogadaEm: msOuNull(l.revogado_em), papel: l.papel });

/**
 * Chaves de máquina da pessoa (ADR-031). Guarda só o hash; NENHUM método devolve o hash para fora
 * do repositório exceto `buscarVivaPorHash`, que existe só para a comparação em tempo constante.
 * Sob RLS a pessoa só vê as próprias (owner_id), e o WHERE repete isso (segunda camada, ADR-003).
 */
export function maquinaTokensRepo(conn: Conn, escopo: Escopo) {
  return {
    /** NOD-94: `papel` ausente = `motor`. O índice `maquina_tokens_um_computador` recusa (23505) o 2º só-computador vivo. */
    async criar(e: { nome: string; prefixo: string; hash: Buffer; papel?: PapelMaquina }): Promise<ChaveMaquinaDto | null> {
      const [l] = await conn<Linha[]>`
        insert into maquina_tokens (tenant_id, owner_id, nome, prefixo, hash, papel)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${e.nome}, ${e.prefixo}, ${e.hash}, ${e.papel ?? "motor"})
        returning id, nome, prefixo, criado_em, ultimo_uso_em, revogado_em, papel`;
      return l ? paraDto(l) : null;
    },

    /**
     * NOD-94 (0105): a máquina só-computador viva da pessoa, depois de revogar (na data em que venceu) a que venceu sem
     * confirmação — ela ainda seguraria a vaga do índice único. null = a vaga está livre.
     */
    async computadorVivo(agora: number): Promise<{ id: string; nome: string } | null> {
      await conn`update maquina_tokens set revogado_em = expira_em
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and papel = 'computador' and revogado_em is null and expira_em <= ${data(agora)}`;
      const [l] = await conn<{ id: string; nome: string }[]>`select id, nome from maquina_tokens
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and papel = 'computador' and revogado_em is null`;
      return l ?? null;
    },

    async listar(): Promise<ChaveMaquinaDto[]> {
      // ADR-102 (revisão do PR #306): a chave que venceu (o "Desconectar" sem confirmação) conta como cancelada na data
      // em que venceu — a tela, a escolha de máquina dos bots e as contas a veem como as revogadas.
      const linhas = await conn<Linha[]>`
        select id, nome, prefixo, criado_em, ultimo_uso_em, papel,
          coalesce(revogado_em, case when expira_em <= now() then expira_em end) as revogado_em
        from maquina_tokens
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId}
        order by criado_em desc`;
      return linhas.map(paraDto);
    },

    /**
     * NOD-89 (corte 1): as chaves vivas (não revogadas e não vencidas) com o sistema que cada máquina anunciou — a linha
     * "Roda em" da rotina. Mesma ordem e mesmo filtro por dona do `listar()`.
     * NOD-94 (emenda 11 da ADR-090): sem a só-computador — ela nunca pega turno, então não segura o "qualquer máquina".
     */
    async vivasComPlataforma(): Promise<{ id: string; nome: string; plataforma: PlataformaMaquina | null }[]> {
      return conn<{ id: string; nome: string; plataforma: PlataformaMaquina | null }[]>`
        select id, nome, plataforma from maquina_tokens
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId}
          and revogado_em is null and (expira_em is null or expira_em > now()) and papel = 'motor'
        order by criado_em desc`.then((ls) => ls.map((l) => ({ id: l.id, nome: l.nome, plataforma: l.plataforma ?? null })));
    },

    /** Revogar é idempotente: a primeira data fica. false = a chave não existe (ou é de outra pessoa). */
    async revogar(id: string, agora: number): Promise<boolean> {
      const linhas = await conn`
        update maquina_tokens set revogado_em = coalesce(revogado_em, ${data(agora)})
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}
        returning id`;
      return linhas.length > 0;
    },

    /**
     * ADR-102 (revisão do PR #306): a chave passa a vencer em `ate` (ou antes, se já vencia antes). É o "Desconectar e
     * sair das contas": a máquina tem até lá para sair das contas e confirmar; sem confirmação, a chave cai sozinha —
     * gravado no banco, sobrevive a um reinício do servidor.
     */
    async vencerEm(id: string, ate: number): Promise<boolean> {
      const r = await conn`update maquina_tokens set expira_em = least(coalesce(expira_em, ${data(ate)}), ${data(ate)})
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and revogado_em is null returning id`;
      return r.length > 0;
    },

    async buscarVivaPorHash(hash: Buffer, agora: number): Promise<{ id: string; hash: Buffer } | null> {
      const [l] = await conn<{ id: string; hash: Buffer }[]>`
        select id, hash from maquina_tokens
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and hash = ${hash}
          and revogado_em is null and (expira_em is null or expira_em > ${data(agora)})`;
      return l ?? null;
    },

    /** ADR-090 (0067): o sistema que a máquina anunciou ao se conectar. Só escreve quando muda. */
    async registrarPlataforma(id: string, plataforma: PlataformaMaquina): Promise<void> {
      await conn`update maquina_tokens set plataforma = ${plataforma}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and plataforma is distinct from ${plataforma}`;
    },

    /**
     * Nome e sistema de uma chave, revogada ou não (o aviso de uma queda antiga ainda a nomeia). null = não é chave da
     * pessoa — no modo local, o Mac que roda o servidor não tem chave.
     */
    async identificar(id: string): Promise<{ nome: string; plataforma: PlataformaMaquina | null; papel: PapelMaquina; ultimoUsoEm: number | null } | null> {
      const [l] = await conn<{ nome: string; plataforma: PlataformaMaquina | null; papel: PapelMaquina; ultimo_uso_em: Date | null }[]>`
        select nome, plataforma, papel, ultimo_uso_em from maquina_tokens where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}`;
      // NOD-365: o último uso gravado é o "sem contato desde" que sobrevive à ponte esquecer a conexão (90 s) e ao reinício.
      return l ? { nome: l.nome, plataforma: l.plataforma, papel: l.papel, ultimoUsoEm: l.ultimo_uso_em?.getTime() ?? null } : null;
    },

    /**
     * NOD-293 A7: a chave existe e não vale mais — revogada, ou vencida em `agora` (o "Desconectar" sem confirmação, como
     * em `listar`). A mesma régua da chave viva de alvo-da-maquina.ts. false = viva ou não é chave da pessoa (o Mac do
     * modo local não tem chave).
     */
    async removida(id: string, agora: number): Promise<boolean> {
      const [l] = await conn<{ removida: boolean }[]>`
        select (revogado_em is not null or (expira_em is not null and expira_em <= ${data(agora)})) as removida
        from maquina_tokens where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}`;
      return l?.removida === true;
    },

    /** ADR-102 (R2): o nome que a pessoa deu à máquina; a tela e as notas usam este, não o hostname anunciado. */
    async renomear(id: string, nome: string): Promise<boolean> {
      const r = await conn`update maquina_tokens set nome = ${nome} where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and revogado_em is null returning id`;
      return r.length > 0;
    },

    /**
     * definido em 2026-10-20 (NOD-293 A8): grava o uso no máximo uma vez a cada MARCAR_USO_A_CADA_MS. Cada pedido da
     * máquina (puxar, renovar, entregar) passava aqui e fazia um UPDATE; quem lê `ultimo_uso_em` (a lista de chaves) tolera
     * esse atraso. true = gravou.
     */
    async marcarUso(id: string, agora: number): Promise<boolean> {
      const r = await conn`update maquina_tokens set ultimo_uso_em = ${data(agora)}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}
          and (ultimo_uso_em is null or ultimo_uso_em < ${data(agora - MARCAR_USO_A_CADA_MS)}) returning id`;
      return r.length > 0;
    },
  };
}
