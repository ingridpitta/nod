import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FERRAMENTAS_CANVAS } from "../../../src/contracts/ferramentas-canvas.ts";
import { FERRAMENTAS_NATIVAS, PERMISSOES_NATIVAS } from "../../../src/contracts/pacote.ts";
import { NIVEIS_CANVAS } from "../../../src/domain/canvas.ts";
import { compativel, lerPacote, permissoesEfetivas } from "../../../src/domain/pacote.ts";
import { DESCRICAO_CANVAS, SLUG_CANVAS } from "../../../web/telas/marketplace-canvas.ts";

/**
 * ADA-283 (ADR-164): o Canvas empacotado no formato `nod-pacote` é a prova do formato. Este teste é o contrato entre o
 * manifesto e o app que roda: se o código do Canvas ganhar um nível, uma ferramenta ou outro slug sem o manifesto
 * acompanhar (ou o contrário), ele quebra.
 */
const bruto = JSON.parse(readFileSync(new URL("../../../pacotes/canvas/nod-pacote.json", import.meta.url), "utf8")) as unknown;
const versaoNod = (JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as { version: string }).version;

describe("pacote do Canvas", () => {
  const r = lerPacote(bruto);
  it("é um pacote válido do formato 1", () => {
    expect(r.ok ? [] : r.problemas).toEqual([]);
  });
  if (!r.ok) return;
  const p = r.pacote;

  it("é o app nativo do nod com o slug do marketplace", () => {
    expect(p).toMatchObject({ tipo: "app", nativo: true, slug: `nod/${SLUG_CANVAS}` });
  });
  it("as permissões são exatamente os níveis do Canvas", () => {
    expect(p.permissoes.map((x) => x.id).sort()).toEqual(NIVEIS_CANVAS.map((n) => `canvas.${n}`).sort());
  });
  it("criar e publicar inclui ver e comentar, como no runtime", () => {
    expect(permissoesEfetivas({ permissoes: p.permissoes.filter((x) => x.id === "canvas.criar_publicar"), apps_conectados: [] })).toEqual(["canvas.criar_publicar", "canvas.ver_comentar"]);
  });
  it("as ferramentas são as do Canvas", () => {
    expect(p.ferramentas).toEqual(Object.keys(FERRAMENTAS_CANVAS));
    expect(FERRAMENTAS_NATIVAS[p.slug]).toEqual(Object.keys(FERRAMENTAS_CANVAS));
  });
  it("o que o nativo pode pedir no código são os níveis do Canvas, e o manifesto pede tudo isso", () => {
    expect([...(PERMISSOES_NATIVAS[p.slug] ?? [])].sort()).toEqual(NIVEIS_CANVAS.map((n) => `canvas.${n}`).sort());
    expect(permissoesEfetivas(p)).toEqual([...(PERMISSOES_NATIVAS[p.slug] ?? [])].sort());
  });
  it("o nome e a descrição são os do cartão do marketplace", () => {
    expect(p.nome).toBe("Canvas");
    expect(p.descricao).toBe(DESCRICAO_CANVAS);
  });
  it("não pede app conectado, é grátis e roda neste nod", () => {
    expect(p.apps_conectados).toEqual([]);
    expect(p.preco).toEqual({ modelo: "gratis" });
    expect(compativel(p, versaoNod)).toBe(true);
  });
  it("mutante: um nível a mais no manifesto quebra o contrato", () => {
    const mutante = { ...(bruto as Record<string, unknown>), permissoes: [...p.permissoes, { id: "canvas.apagar", motivo: "x" }] };
    const m = lerPacote(mutante);
    expect(m.ok && m.pacote.permissoes.map((x) => x.id).sort()).not.toEqual(NIVEIS_CANVAS.map((n) => `canvas.${n}`).sort());
  });
});
