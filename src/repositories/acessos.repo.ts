import type { NivelDeAcesso } from "../domain/grupos-de-acesso.ts";
import { ehNivelDeAcesso } from "../domain/acessos-em-lote.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { jsonb, ms, msOuNull } from "./conversao.ts";

/**
 * definido em 2026-11-07 (ADA-241, 0156, ADR-158): o padrão de cada app, a marca de quem já teve o nível escolhido e
 * os lotes (com o antes e o depois, para o Desfazer). Só primitivas: a regra mora em src/domain/acessos-em-lote.ts.
 */

export type MarcaDeAcesso = "pessoa" | "padrao";
export type ConjuntoPorBot = Record<string, string[]>;
export type LoteDeAcessos = {
  id: string;
  conectorId: string;
  nivel: NivelDeAcesso;
  chave: string;
  antes: ConjuntoPorBot;
  depois: ConjuntoPorBot;
  /** A marca de cada bot antes do lote; quem falta não tinha marca ("não definido"). */
  marcasAntes: Record<string, MarcaDeAcesso>;
  autorTipo: "pessoa" | "bot";
  autorId: string | null;
  criadoEm: number;
  desfeitoEm: number | null;
};

interface LinhaLote { id: string; conector_id: string; nivel: string; chave: string; antes: ConjuntoPorBot; depois: ConjuntoPorBot; marcas_antes: Record<string, string>; autor_tipo: string; autor_id: string | null; criado_em: Date; desfeito_em: Date | null }

const COLUNAS_LOTE = "id, conector_id, nivel, chave, antes, depois, marcas_antes, autor_tipo, autor_id, criado_em, desfeito_em";

const paraLote = (l: LinhaLote): LoteDeAcessos => ({
  id: l.id, conectorId: l.conector_id, nivel: ehNivelDeAcesso(l.nivel) ? l.nivel : "nenhum", chave: l.chave, antes: l.antes, depois: l.depois,
  marcasAntes: Object.fromEntries(Object.entries(l.marcas_antes ?? {}).map(([k, v]) => [k, v === "padrao" ? "padrao" : "pessoa"])),
  autorTipo: l.autor_tipo === "bot" ? "bot" : "pessoa", autorId: l.autor_id, criadoEm: ms(l.criado_em), desfeitoEm: msOuNull(l.desfeito_em),
});

export function acessosRepo(conn: Conn, escopo: Escopo) {
  const dona = () => conn`tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId}`;
  return {
    /** O padrão de um app da dona; sem linha = Nenhum. */
    async padrao(conectorId: string): Promise<NivelDeAcesso> {
      const [l] = await conn<{ nivel: string }[]>`select nivel from acessos_padrao where ${dona()} and conector_id = ${conectorId}`;
      return l && ehNivelDeAcesso(l.nivel) ? l.nivel : "nenhum";
    },
    /** Os padrões diferentes de Nenhum (o bot novo nasce com eles). */
    async padroes(): Promise<{ conectorId: string; nivel: NivelDeAcesso }[]> {
      const ls = await conn<{ conector_id: string; nivel: string }[]>`select conector_id, nivel from acessos_padrao where ${dona()} and nivel <> 'nenhum' order by conector_id`;
      return ls.flatMap((l) => (ehNivelDeAcesso(l.nivel) ? [{ conectorId: l.conector_id, nivel: l.nivel }] : []));
    },
    /**
     * Grava o padrão (trava a linha até o fim da tx) e devolve o anterior. A linha nasce como Nenhum antes da leitura
     * travada: FOR UPDATE não trava linha que não existe, e dois primeiros padrões ao mesmo tempo liam ambos "nenhum"
     * (revisão do PR #706).
     */
    async definirPadrao(conectorId: string, nivel: NivelDeAcesso): Promise<NivelDeAcesso> {
      await conn`
        insert into acessos_padrao (tenant_id, owner_id, conector_id, nivel) values (${escopo.tenantId}, ${escopo.pessoaId}, ${conectorId}, 'nenhum')
        on conflict (tenant_id, conector_id) do nothing`;
      const [antes] = await conn<{ nivel: string }[]>`select nivel from acessos_padrao where ${dona()} and conector_id = ${conectorId} for update`;
      await conn`
        insert into acessos_padrao (tenant_id, owner_id, conector_id, nivel) values (${escopo.tenantId}, ${escopo.pessoaId}, ${conectorId}, ${nivel})
        on conflict (tenant_id, conector_id) do update set nivel = excluded.nivel, atualizado_em = clock_timestamp()`;
      return antes && ehNivelDeAcesso(antes.nivel) ? antes.nivel : "nenhum";
    },
    /** A marca de um bot num app (lida sob a trava do par: a de `marcas` pode ter mudado enquanto esperava). */
    async marca(agenteId: string, conectorId: string): Promise<MarcaDeAcesso | null> {
      const [l] = await conn<{ origem: string }[]>`select origem from acessos_definidos where ${dona()} and agente_id = ${agenteId} and conector_id = ${conectorId}`;
      return l ? (l.origem === "padrao" ? "padrao" : "pessoa") : null;
    },
    /** As marcas de um app: agente → origem. */
    async marcas(conectorId: string): Promise<Map<string, MarcaDeAcesso>> {
      const ls = await conn<{ agente_id: string; origem: string }[]>`select agente_id, origem from acessos_definidos where ${dona()} and conector_id = ${conectorId}`;
      return new Map(ls.map((l) => [l.agente_id, l.origem === "padrao" ? "padrao" : "pessoa"]));
    },
    async marcar(agenteId: string, conectorId: string, origem: MarcaDeAcesso): Promise<void> {
      await conn`
        insert into acessos_definidos (tenant_id, owner_id, agente_id, conector_id, origem) values (${escopo.tenantId}, ${escopo.pessoaId}, ${agenteId}, ${conectorId}, ${origem})
        on conflict (tenant_id, agente_id, conector_id) do update set origem = excluded.origem, atualizado_em = clock_timestamp()`;
    },
    /** Tira a marca: o bot volta a "não definido" (o Desfazer de quem não tinha marca antes do lote). */
    async desmarcar(agenteId: string, conectorId: string): Promise<void> {
      await conn`delete from acessos_definidos where ${dona()} and agente_id = ${agenteId} and conector_id = ${conectorId}`;
    },
    async criarLote(l: Pick<LoteDeAcessos, "conectorId" | "nivel" | "chave" | "antes" | "depois" | "marcasAntes" | "autorTipo" | "autorId">): Promise<LoteDeAcessos | null> {
      const [r] = await conn<LinhaLote[]>`
        insert into acessos_lotes (tenant_id, owner_id, conector_id, nivel, chave, antes, depois, marcas_antes, autor_tipo, autor_id)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${l.conectorId}, ${l.nivel}, ${l.chave}, ${jsonb(conn, l.antes)}, ${jsonb(conn, l.depois)}, ${jsonb(conn, l.marcasAntes)}, ${l.autorTipo}, ${l.autorId})
        on conflict (tenant_id, owner_id, chave) do nothing
        returning ${conn.unsafe(COLUNAS_LOTE)}`;
      return r ? paraLote(r) : null;
    },
    async loteDaChave(chave: string): Promise<LoteDeAcessos | null> {
      const [r] = await conn<LinhaLote[]>`select ${conn.unsafe(COLUNAS_LOTE)} from acessos_lotes where ${dona()} and chave = ${chave}`;
      return r ? paraLote(r) : null;
    },
    /** O lote, travado (for update): dois Desfazer ao mesmo tempo, o segundo vê desfeito_em. */
    async loteTravado(id: string): Promise<LoteDeAcessos | null> {
      const [r] = await conn<LinhaLote[]>`select ${conn.unsafe(COLUNAS_LOTE)} from acessos_lotes where ${dona()} and id = ${id} for update`;
      return r ? paraLote(r) : null;
    },
    async marcarDesfeito(id: string): Promise<void> {
      await conn`update acessos_lotes set desfeito_em = clock_timestamp() where ${dona()} and id = ${id}`;
    },
  };
}
