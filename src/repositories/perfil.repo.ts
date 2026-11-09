import type { TipoFoto } from "../domain/minha-conta.ts";
import type { Conn, Escopo } from "../shared/types.ts";

/**
 * NOD-346 (0110): o perfil da pessoa na linha de `preferencias`. O nome é o `apelido` da 0049 (já é o nome dela nos
 * prompts); o "Sobre mim" e a foto são da 0110. Sem linha = tudo vazio.
 */
export type Perfil = { apelido: string | null; sobreMim: string | null; temFoto: boolean };

export function perfilRepo(conn: Conn, escopo: Escopo) {
  type Linha = { apelido: string | null; sobre_mim: string | null; tem_foto: boolean };
  const paraPerfil = (l: Linha | undefined): Perfil => ({ apelido: l?.apelido ?? null, sobreMim: l?.sobre_mim ?? null, temFoto: l?.tem_foto ?? false });
  const COLUNAS = "apelido, sobre_mim, foto is not null as tem_foto";

  async function gravar(set: Record<string, string | Buffer | Date | null>): Promise<Perfil> {
    const [l] = await conn<Linha[]>`
      insert into preferencias ${conn({ tenant_id: escopo.tenantId, owner_id: escopo.pessoaId, ...set })}
      on conflict (tenant_id, owner_id) do update set ${conn({ ...set, atualizado_em: new Date() })}
      returning ${conn.unsafe(COLUNAS)}`;
    return paraPerfil(l);
  }

  return {
    async buscar(): Promise<Perfil> {
      const [l] = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from preferencias where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId}`;
      return paraPerfil(l);
    },
    /** O "Sobre mim" que entra no prompt dos bots próprios (null = sem linha). */
    async sobreMim(): Promise<string | null> {
      const [l] = await conn<{ sobre_mim: string | null }[]>`
        select sobre_mim from preferencias where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId}`;
      return l?.sobre_mim ?? null;
    },
    /** O que vier muda; `sobreMim: null` apaga. Quem chama já validou (domain/minha-conta.ts: lerPerfil). */
    async atualizar(p: { nome?: string; sobreMim?: string | null }): Promise<Perfil> {
      const set: Record<string, string | null> = {};
      if (p.nome !== undefined) set.apelido = p.nome;
      if (p.sobreMim !== undefined) set.sobre_mim = p.sobreMim;
      if (Object.keys(set).length === 0) return this.buscar();
      return gravar(set);
    },
    async foto(): Promise<{ bytes: Uint8Array; tipo: TipoFoto } | null> {
      const [l] = await conn<{ foto: Uint8Array | null; foto_tipo: TipoFoto | null }[]>`
        select foto, foto_tipo from preferencias where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId}`;
      return l?.foto && l.foto_tipo ? { bytes: l.foto, tipo: l.foto_tipo } : null;
    },
    /** null tira a foto. Quem chama já conferiu a assinatura e o tamanho (tipoDaFoto, FOTO_MAX_BYTES). */
    definirFoto: (f: { bytes: Uint8Array; tipo: TipoFoto } | null): Promise<Perfil> =>
      gravar({ foto: f ? Buffer.from(f.bytes) : null, foto_tipo: f?.tipo ?? null }),
  };
}
