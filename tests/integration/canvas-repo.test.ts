import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import { mesclarComentarios, normalizarEstrutura, trocarPorHashes, type EstruturaCanvas } from "../../src/domain/canvas.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import { enderecoDe } from "../../src/repositories/canvas.repo.ts";
import { ANA, MARLON } from "../helpers/deps-l6.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const estrutura = (telas: string[]): EstruturaCanvas<string> => {
  const n = normalizarEstrutura({ titulo: "Canvas", issue: "ADA-13", jornadas: [{ titulo: "J", telas: telas.map((t) => ({ id: t, html: `<p>${t}</p>` })) }] });
  if (!n.ok) throw new Error(n.erro);
  const h = trocarPorHashes(n.estrutura, sha, null);
  if (!h.ok) throw new Error(h.erro);
  return h.estrutura;
};

/** ADA-13 (0151): as primitivas do Canvas no Postgres de verdade, com a RLS separando as pessoas. */
describeIntegracao("canvas: repositório (ADA-13)", () => {
  it("instala, dá nível e só vale instalado; desinstalar tira os acessos", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId } = await agenteComConversa(trx, MARLON);
      expect(await repos.canvas.instalado()).toBe(false);
      expect(await repos.canvas.definirNivel(agenteId, "criar_publicar")).toBeNull();
      expect(await repos.canvas.nivelDe(agenteId)).toBeNull(); // sem o app instalado, nada vale
      expect(await repos.canvas.instalar()).toBe(true);
      expect(await repos.canvas.instalar()).toBe(false);
      expect(await repos.canvas.nivelDe(agenteId)).toBe("criar_publicar");
      expect(await repos.canvas.definirNivel(agenteId, "ver_comentar")).toBe("criar_publicar");
      expect(await repos.canvas.acessos()).toEqual([{ agenteId, nivel: "ver_comentar" }]);
      expect(await repos.canvas.desinstalar()).toBe(true);
      expect(await repos.canvas.acessos()).toEqual([]);
      expect(await repos.canvas.desinstalar()).toBe(false);
    });
  });

  it("um canvas por issue, versão sobe travada, blobs deduplicados", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId } = await agenteComConversa(trx, MARLON);
      const c = await repos.canvas.criar({ agenteId, issue: "ADA-13", titulo: "Canvas", origemUrl: null });
      expect(c?.versaoAtual).toBe(1);
      expect(await repos.canvas.criar({ agenteId, issue: "ADA-13", titulo: "Outro", origemUrl: null })).toBeNull();
      expect((await repos.canvas.porIssue(agenteId, "ADA-13"))?.id).toBe(c?.id);
      if (!c) return;
      await repos.canvas.gravarVersao({ canvasId: c.id, versao: 1, estrutura: estrutura(["J1-1"]), confianca: "confiavel" });
      const v2 = await repos.canvas.subirVersao(c.id, { titulo: "Canvas v2", origemUrl: null });
      expect(v2?.versaoAtual).toBe(2);
      expect((await repos.canvas.versao(c.id, 1))?.estrutura.jornadas[0]?.telas[0]?.id).toBe("J1-1");
      const blob = { hash: sha("<p>x</p>"), conteudo: "<p>x</p>" };
      await repos.canvas.gravarBlobs([blob, blob]);
      await repos.canvas.gravarBlobs([blob]);
      expect(await repos.canvas.blobs([blob.hash, sha("nada")])).toEqual({ [blob.hash]: "<p>x</p>" });
      expect(await repos.canvas.tamanhoDosBlobs([blob.hash])).toBe(8);
      // Codex no #649 (P2): o reusado conta em bytes, como o novo (Buffer.byteLength); "é" e o emoji não passam por menos.
      const multi = { hash: sha("é😀"), conteudo: "é😀" };
      await repos.canvas.gravarBlobs([multi]);
      expect(await repos.canvas.tamanhoDosBlobs([multi.hash])).toBe(Buffer.byteLength("é😀", "utf8"));
      expect(await repos.canvas.doAgente(agenteId)).toHaveLength(1);
    });
  });

  it("versão nova arquiva o comentário da tela que saiu e desarquiva quando ela volta; resolver leva as respostas", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId } = await agenteComConversa(trx, MARLON);
      const c = await repos.canvas.criar({ agenteId, issue: null, titulo: "Sem issue", origemUrl: null });
      if (!c) throw new Error("sem canvas");
      const base = { canvasId: c.id, autorTipo: "pessoa" as const, autorId: MARLON.pessoaId, autorNome: "Marlon", versao: 1, confianca: "confiavel" as const };
      const pino = await repos.canvas.comentar({ ...base, telaId: "J1-2", jornada: "J1", tipo: "pino", x: 0.3, y: 0.4, texto: "aqui", paiId: null });
      const resp = await repos.canvas.comentar({ ...base, telaId: null, jornada: null, tipo: "pino", x: null, y: null, texto: "ok", paiId: pino.id, autorTipo: "bot", autorId: agenteId });
      const lista = async () => {
        const cs = await repos.canvas.comentarios(c.id);
        const porId = new Map(cs.map((x) => [x.id, x]));
        return cs.map((x) => enderecoDe(x, porId));
      };
      const sai = mesclarComentarios(estrutura(["J1-1"]), await lista());
      expect(sai.arquivar.sort()).toEqual([pino.id, resp.id].sort());
      await repos.canvas.arquivar(sai.arquivar, Date.now());
      const volta = mesclarComentarios(estrutura(["J1-1", "J1-2"]), await lista());
      expect(volta).toEqual({ arquivar: [], desarquivar: expect.arrayContaining([pino.id, resp.id]) });
      await repos.canvas.desarquivar(volta.desarquivar);
      expect((await repos.canvas.comentarios(c.id)).every((x) => x.arquivadoEm === null)).toBe(true);
      expect((await repos.canvas.resolver(pino.id, true, Date.now()))?.resolvidoEm).not.toBeNull();
      expect((await repos.canvas.comentario(resp.id))?.resolvidoEm).not.toBeNull();
      expect(await repos.canvas.resolver("00000000-0000-4000-8000-000000000000", true, Date.now())).toBeNull();
    });
  });

  it("o banco recusa pino sem tela e coordenada fora de [0,1]", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId } = await agenteComConversa(trx, MARLON);
      const c = await repos.canvas.criar({ agenteId, issue: null, titulo: "T", origemUrl: null });
      if (!c) throw new Error("sem canvas");
      const base = { canvasId: c.id, autorTipo: "pessoa" as const, autorId: null, autorNome: null, versao: 1, confianca: "confiavel" as const, paiId: null, texto: "x" };
      await expect(trx.savepoint((sp) => criarRepos(sp, MARLON).canvas.comentar({ ...base, telaId: null, jornada: "J1", tipo: "pino", x: 0.5, y: 0.5 }))).rejects.toThrow();
      await expect(trx.savepoint((sp) => criarRepos(sp, MARLON).canvas.comentar({ ...base, telaId: "J1-1", jornada: "J1", tipo: "pino", x: 1.5, y: 0.5 }))).rejects.toThrow();
      expect(repos).toBeDefined();
    });
  });

  it("RLS: a Ana não vê nem mexe no canvas, nos blobs e na instalação do Marlon", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId } = await agenteComConversa(trx, MARLON);
      await repos.canvas.instalar();
      await repos.canvas.definirNivel(agenteId, "criar_publicar");
      const c = await repos.canvas.criar({ agenteId, issue: "ADA-13", titulo: "Do Marlon", origemUrl: null });
      if (!c) throw new Error("sem canvas");
      const blob = { hash: sha("segredo"), conteudo: "segredo" };
      await repos.canvas.gravarBlobs([blob]);
      await vincularEscopo(trx, ANA);
      const ana = criarRepos(trx, ANA);
      expect(await ana.canvas.instalado()).toBe(false);
      expect(await ana.canvas.nivelDe(agenteId)).toBeNull();
      expect(await ana.canvas.buscar(c.id)).toBeNull();
      expect(await ana.canvas.doAgente(agenteId)).toEqual([]);
      expect(await ana.canvas.blobs([blob.hash])).toEqual({});
      expect(await ana.canvas.subirVersao(c.id, { titulo: "x", origemUrl: null })).toBeNull();
      expect(await ana.canvas.comentarios(c.id)).toEqual([]);
      await vincularEscopo(trx, MARLON);
      expect((await repos.canvas.buscar(c.id))?.versaoAtual).toBe(1);
    });
  });

  it("RLS no SQL cru (revisão 1 do #649, M6): como a Ana, nenhuma linha do Marlon aparece nem muda, sem filtro de dono", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId } = await agenteComConversa(trx, MARLON);
      await repos.canvas.instalar();
      await repos.canvas.definirNivel(agenteId, "criar_publicar");
      const c = await repos.canvas.criar({ agenteId, issue: "ADA-13", titulo: "Do Marlon", origemUrl: null });
      if (!c) throw new Error("sem canvas");
      await repos.canvas.gravarVersao({ canvasId: c.id, versao: 1, estrutura: estrutura([sha("t")]), confianca: "confiavel" });
      await repos.canvas.gravarBlobs([{ hash: sha("segredo"), conteudo: "segredo" }]);
      await repos.canvas.comentar({ canvasId: c.id, telaId: "J1-1", jornada: null, tipo: "nota", x: null, y: null, texto: "oi", autorTipo: "pessoa", autorId: MARLON.pessoaId, autorNome: null, paiId: null, versao: 1, confianca: "confiavel" });
      const contar = async () => {
        const [r] = await trx<{ n: number }[]>`select
          (select count(*) from canvas)::int + (select count(*) from canvas_versoes)::int + (select count(*) from canvas_comentarios)::int
          + (select count(*) from canvas_blobs)::int + (select count(*) from canvas_acessos)::int + (select count(*) from canvas_instalacoes)::int as n`;
        return r!.n;
      };
      expect(await contar()).toBeGreaterThanOrEqual(6);
      await vincularEscopo(trx, ANA);
      expect(await contar()).toBe(0);
      expect((await trx`update canvas set titulo = 'da Ana' where id = ${c.id}`).count).toBe(0);
      expect((await trx`update canvas_comentarios set texto = 'da Ana' where canvas_id = ${c.id}`).count).toBe(0);
      expect((await trx`update canvas_blobs set conteudo = 'da Ana' where hash = ${sha("segredo")}`).count).toBe(0);
      await vincularEscopo(trx, MARLON);
      expect((await repos.canvas.buscar(c.id))?.titulo).toBe("Do Marlon");
    });
  });
});
