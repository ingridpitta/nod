import type { Confianca } from "../contracts/mensagem.ts";
import type { AutorComentario, EstruturaCanvas, NivelCanvas, TipoComentario } from "../domain/canvas.ts";
import { ehNivelCanvas } from "../domain/canvas.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { jsonb, ms, msOuNull } from "./conversao.ts";

/**
 * definido em 2026-11-04 (ADA-13, 0151, ADR-150): o app Canvas. Só primitivas: as regras (estrutura, ids, versão nova
 * que arquiva) moram em src/domain/canvas.ts e quem as aplica é src/use-cases/canvas.ts.
 */

export type Canvas = { id: string; agenteId: string; issue: string | null; titulo: string; versaoAtual: number; origemUrl: string | null; criadoEm: number; atualizadoEm: number };
export type VersaoCanvas = { canvasId: string; versao: number; estrutura: EstruturaCanvas<string>; confianca: Confianca; criadoEm: number };
export type ComentarioCanvas = {
  id: string;
  canvasId: string;
  telaId: string | null;
  jornada: string | null;
  tipo: TipoComentario;
  x: number | null;
  y: number | null;
  texto: string;
  autorTipo: AutorComentario;
  autorId: string | null;
  autorNome: string | null;
  paiId: string | null;
  versao: number;
  confianca: Confianca;
  resolvidoEm: number | null;
  arquivadoEm: number | null;
  criadoEm: number;
};
export type NovoComentarioCanvas = Omit<ComentarioCanvas, "id" | "resolvidoEm" | "arquivadoEm" | "criadoEm"> & { criadoEm?: number };

interface LinhaCanvas { id: string; agente_id: string; issue: string | null; titulo: string; versao_atual: number; origem_url: string | null; criado_em: Date; atualizado_em: Date }
interface LinhaComentario {
  id: string; canvas_id: string; tela_id: string | null; jornada: string | null; tipo: string; x: number | null; y: number | null; texto: string;
  autor_tipo: string; autor_id: string | null; autor_nome: string | null; pai_id: string | null; versao: number; confianca: Confianca;
  resolvido_em: Date | null; arquivado_em: Date | null; criado_em: Date;
}

const COLUNAS_CANVAS = "id, agente_id, issue, titulo, versao_atual, origem_url, criado_em, atualizado_em";
const COLUNAS_COMENTARIO = "id, canvas_id, tela_id, jornada, tipo, x, y, texto, autor_tipo, autor_id, autor_nome, pai_id, versao, confianca, resolvido_em, arquivado_em, criado_em";

const paraCanvas = (l: LinhaCanvas): Canvas => ({ id: l.id, agenteId: l.agente_id, issue: l.issue, titulo: l.titulo, versaoAtual: l.versao_atual, origemUrl: l.origem_url, criadoEm: ms(l.criado_em), atualizadoEm: ms(l.atualizado_em) });
const paraComentario = (l: LinhaComentario): ComentarioCanvas => ({
  id: l.id, canvasId: l.canvas_id, telaId: l.tela_id, jornada: l.jornada, tipo: l.tipo === "nota" ? "nota" : "pino", x: l.x, y: l.y, texto: l.texto,
  autorTipo: l.autor_tipo === "bot" ? "bot" : l.autor_tipo === "importado" ? "importado" : "pessoa", autorId: l.autor_id, autorNome: l.autor_nome, paiId: l.pai_id,
  versao: l.versao, confianca: l.confianca, resolvidoEm: msOuNull(l.resolvido_em), arquivadoEm: msOuNull(l.arquivado_em), criadoEm: ms(l.criado_em),
});

/** O endereço que o domínio usa para arquivar (mora no domínio; reexportado para os testes do repo). */
export { enderecoDe } from "../domain/canvas.ts";

export function canvasRepo(conn: Conn, escopo: Escopo) {
  const dona = (c: Conn = conn) => c`tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId}`;
  return {
    // ---------- Instalação e acessos ----------
    /** travar = for share: segura a instalação até o fim da transação (dar acesso × desinstalar, revisão 5 do #649). */
    async instalado(travar = false): Promise<boolean> {
      const [l] = travar
        ? await conn<{ n: number }[]>`select 1 as n from canvas_instalacoes where ${dona()} for share`
        : await conn<{ n: number }[]>`select 1 as n from canvas_instalacoes where ${dona()}`;
      return l !== undefined;
    },
    /** true = instalou agora; false = já estava. */
    async instalar(): Promise<boolean> {
      const r = await conn`insert into canvas_instalacoes (tenant_id, owner_id) values (${escopo.tenantId}, ${escopo.pessoaId}) on conflict do nothing`;
      return r.count > 0;
    },
    /** Desinstala e tira o acesso de todos os bots (os canvas ficam: voltam ao reinstalar). true = estava instalado. */
    async desinstalar(): Promise<boolean> {
      // A instalação sai antes: espera quem a segura (for share) e só então apaga os acessos já gravados por ele.
      const r = await conn`delete from canvas_instalacoes where ${dona()}`;
      await conn`delete from canvas_acessos where ${dona()}`;
      return r.count > 0;
    },
    async acessos(): Promise<{ agenteId: string; nivel: NivelCanvas }[]> {
      const ls = await conn<{ agente_id: string; nivel: string }[]>`select agente_id, nivel from canvas_acessos where ${dona()} order by atualizado_em, agente_id`;
      return ls.flatMap((l) => (ehNivelCanvas(l.nivel) ? [{ agenteId: l.agente_id, nivel: l.nivel }] : []));
    },
    /** O nível do bot só vale com o app instalado (null = sem acesso). */
    async nivelDe(agenteId: string): Promise<NivelCanvas | null> {
      const [l] = await conn<{ nivel: string }[]>`
        select a.nivel from canvas_acessos a
        where a.tenant_id = ${escopo.tenantId} and a.owner_id = ${escopo.pessoaId} and a.agente_id = ${agenteId}
          and exists (select 1 from canvas_instalacoes i where i.tenant_id = a.tenant_id and i.owner_id = a.owner_id)`;
      return l && ehNivelCanvas(l.nivel) ? l.nivel : null;
    },
    /** null tira o acesso. Devolve o nível anterior. */
    async definirNivel(agenteId: string, nivel: NivelCanvas | null): Promise<NivelCanvas | null> {
      const [antes] = await conn<{ nivel: string }[]>`select nivel from canvas_acessos where ${dona()} and agente_id = ${agenteId} for update`;
      if (nivel === null) await conn`delete from canvas_acessos where ${dona()} and agente_id = ${agenteId}`;
      else await conn`
        insert into canvas_acessos (tenant_id, owner_id, agente_id, nivel) values (${escopo.tenantId}, ${escopo.pessoaId}, ${agenteId}, ${nivel})
        on conflict (tenant_id, owner_id, agente_id) do update set nivel = excluded.nivel, atualizado_em = clock_timestamp()`;
      return antes && ehNivelCanvas(antes.nivel) ? antes.nivel : null;
    },

    // ---------- Canvas e versões ----------
    async doAgente(agenteId: string): Promise<Canvas[]> {
      const ls = await conn<LinhaCanvas[]>`select ${conn.unsafe(COLUNAS_CANVAS)} from canvas where ${dona()} and agente_id = ${agenteId} order by atualizado_em desc, id`;
      return ls.map(paraCanvas);
    },
    /**
     * `trava`: "update" serializa duas publicações (a segunda espera e lê a versão da primeira); "share" segura a versão
     * enquanto um comentário entra (a publicação que arquivaria a tela dele espera o commit). Revisão 1 do #649 (A1, A2).
     */
    async buscar(id: string, trava?: "update" | "share"): Promise<Canvas | null> {
      const lock = trava === "update" ? conn.unsafe(" for update") : trava === "share" ? conn.unsafe(" for share") : conn.unsafe("");
      const [l] = await conn<LinhaCanvas[]>`select ${conn.unsafe(COLUNAS_CANVAS)} from canvas where ${dona()} and id = ${id}${lock}`;
      return l ? paraCanvas(l) : null;
    },
    async porIssue(agenteId: string, issue: string): Promise<Canvas | null> {
      const [l] = await conn<LinhaCanvas[]>`select ${conn.unsafe(COLUNAS_CANVAS)} from canvas where ${dona()} and agente_id = ${agenteId} and issue = ${issue}`;
      return l ? paraCanvas(l) : null;
    },
    /**
     * Cria o canvas na versão 1. null = já há um canvas dessa issue no bot (duas publicações ao mesmo tempo): quem chama
     * relê e publica como versão nova.
     */
    async criar(c: { agenteId: string; issue: string | null; titulo: string; origemUrl: string | null }): Promise<Canvas | null> {
      const [l] = await conn<LinhaCanvas[]>`
        insert into canvas (tenant_id, owner_id, agente_id, issue, titulo, origem_url) values (${escopo.tenantId}, ${escopo.pessoaId}, ${c.agenteId}, ${c.issue}, ${c.titulo}, ${c.origemUrl})
        on conflict (tenant_id, owner_id, agente_id, issue) where issue is not null do nothing
        returning ${conn.unsafe(COLUNAS_CANVAS)}`;
      return l ? paraCanvas(l) : null;
    },
    /** Sobe a versão com a linha travada (serializa duas publicações) e devolve o canvas com a versão nova. */
    async subirVersao(id: string, c: { titulo: string; origemUrl: string | null }): Promise<Canvas | null> {
      const [l] = await conn<LinhaCanvas[]>`
        update canvas set versao_atual = versao_atual + 1, titulo = ${c.titulo}, origem_url = coalesce(${c.origemUrl}, origem_url), atualizado_em = clock_timestamp()
        where ${dona()} and id = ${id} returning ${conn.unsafe(COLUNAS_CANVAS)}`;
      return l ? paraCanvas(l) : null;
    },
    async gravarVersao(v: { canvasId: string; versao: number; estrutura: EstruturaCanvas<string>; confianca: Confianca }): Promise<void> {
      await conn`insert into canvas_versoes (tenant_id, owner_id, canvas_id, versao, estrutura, confianca) values (${escopo.tenantId}, ${escopo.pessoaId}, ${v.canvasId}, ${v.versao}, ${jsonb(conn, v.estrutura)}, ${v.confianca})`;
    },
    async versao(canvasId: string, versao: number): Promise<VersaoCanvas | null> {
      const [l] = await conn<{ canvas_id: string; versao: number; estrutura: EstruturaCanvas<string>; confianca: Confianca; criado_em: Date }[]>`
        select canvas_id, versao, estrutura, confianca, criado_em from canvas_versoes where ${dona()} and canvas_id = ${canvasId} and versao = ${versao}`;
      return l ? { canvasId: l.canvas_id, versao: l.versao, estrutura: l.estrutura, confianca: l.confianca, criadoEm: ms(l.criado_em) } : null;
    },

    // ---------- Blobs ----------
    /** Grava os blobs que faltam (o hash é do conteúdo: o repetido não muda nada). */
    async gravarBlobs(blobs: readonly { hash: string; conteudo: string }[]): Promise<void> {
      for (const b of blobs) await conn`insert into canvas_blobs (tenant_id, owner_id, hash, conteudo) values (${escopo.tenantId}, ${escopo.pessoaId}, ${b.hash}, ${b.conteudo}) on conflict do nothing`;
    },
    async blobs(hashes: readonly string[]): Promise<Record<string, string>> {
      if (hashes.length === 0) return {};
      const ls = await conn<{ hash: string; conteudo: string }[]>`select hash, conteudo from canvas_blobs where ${dona()} and hash = any(${conn.array([...hashes])}::text[])`;
      return Object.fromEntries(ls.map((l) => [l.hash, l.conteudo]));
    },
    /** O tamanho somado dos blobs (para o teto da versão, contando os reusados). */
    async tamanhoDosBlobs(hashes: readonly string[]): Promise<number> {
      if (hashes.length === 0) return 0;
      const [l] = await conn<{ n: string | null }[]>`select sum(octet_length(conteudo))::text as n from canvas_blobs where ${dona()} and hash = any(${conn.array([...hashes])}::text[])`;
      return Number(l?.n ?? 0);
    },

    // ---------- Comentários ----------
    async comentarios(canvasId: string): Promise<ComentarioCanvas[]> {
      const ls = await conn<LinhaComentario[]>`select ${conn.unsafe(COLUNAS_COMENTARIO)} from canvas_comentarios where ${dona()} and canvas_id = ${canvasId} order by criado_em, id`;
      return ls.map(paraComentario);
    },
    async comentario(id: string): Promise<ComentarioCanvas | null> {
      const [l] = await conn<LinhaComentario[]>`select ${conn.unsafe(COLUNAS_COMENTARIO)} from canvas_comentarios where ${dona()} and id = ${id}`;
      return l ? paraComentario(l) : null;
    },
    async comentar(c: NovoComentarioCanvas): Promise<ComentarioCanvas> {
      const [l] = await conn<LinhaComentario[]>`
        insert into canvas_comentarios (tenant_id, owner_id, canvas_id, tela_id, jornada, tipo, x, y, texto, autor_tipo, autor_id, autor_nome, pai_id, versao, confianca, criado_em)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${c.canvasId}, ${c.telaId}, ${c.jornada}, ${c.tipo}, ${c.x}, ${c.y}, ${c.texto}, ${c.autorTipo}, ${c.autorId}, ${c.autorNome}, ${c.paiId}, ${c.versao}, ${c.confianca},
          ${c.criadoEm !== undefined ? new Date(c.criadoEm) : conn`clock_timestamp()`})
        returning ${conn.unsafe(COLUNAS_COMENTARIO)}`;
      if (!l) throw new Error("canvas_comentarios: insert sem linha");
      return paraComentario(l);
    },
    /** Resolve (ou reabre) o comentário e as respostas dele. null = não existe. */
    async resolver(id: string, resolvido: boolean, agora: number): Promise<ComentarioCanvas | null> {
      const em = resolvido ? new Date(agora) : null;
      const [l] = await conn<LinhaComentario[]>`update canvas_comentarios set resolvido_em = ${em} where ${dona()} and id = ${id} returning ${conn.unsafe(COLUNAS_COMENTARIO)}`;
      if (!l) return null;
      await conn`update canvas_comentarios set resolvido_em = ${em} where ${dona()} and pai_id = ${id}`;
      return paraComentario(l);
    },
    async arquivar(ids: readonly string[], agora: number): Promise<void> {
      if (ids.length) await conn`update canvas_comentarios set arquivado_em = ${new Date(agora)} where ${dona()} and id = any(${conn.array([...ids])}::uuid[]) and arquivado_em is null`;
    },
    async desarquivar(ids: readonly string[]): Promise<void> {
      if (ids.length) await conn`update canvas_comentarios set arquivado_em = null where ${dona()} and id = any(${conn.array([...ids])}::uuid[])`;
    },
  };
}
