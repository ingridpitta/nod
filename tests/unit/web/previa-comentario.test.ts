import { describe, expect, it } from "vitest";
import { mencionados, quemAcionar } from "../../../src/domain/comentarios-quadro.ts";
import { colunasDe } from "../../../src/domain/colunas.ts";
import { andando } from "../../../src/domain/quadro.ts";
import { previaDoComentario, textoDaPrevia } from "../../../web/lib/previa-comentario.ts";

/**
 * ADA-28 (escopo D): a prévia da tela diz o mesmo que o servidor fará. A web espelha a regra (não importa o domínio,
 * ADR-018); este teste confere o espelho contra `andando` + `mencionados` + `quemAcionar` num leque de casos.
 */
const colunas = colunasDe({ colunas: null });
const agentes = [
  { id: "x", nome: "Faustino", nod: false },
  { id: "g", nome: "Gil", nod: false },
  { id: "gb", nome: "Gilberto", nod: false },
  { id: "d1", nome: "Dev 1", nod: false },
  // QA do PR #702: um nome dentro de outro ("Dev" em "Dev 1") confere que o trecho achado sai antes do nome mais curto.
  { id: "dv", nome: "Dev", nod: false },
  { id: "n", nome: "Nod", nod: true },
];
const nomes = new Map(agentes.map((a) => [a.id, a.nome]));

function doServidor(status: string, agenteId: string | null, texto: string): string[] {
  const mencoes = mencionados(texto, agentes).map((a) => a.id);
  const ids = quemAcionar({ autor: { tipo: "pessoa" }, responsavelId: andando(colunas, status) ? agenteId : null, mencionados: mencoes, nods: new Set(["n"]) });
  return ids.map((id) => nomes.get(id)!);
}

describe("ADA-28: a prévia do comentário", () => {
  const status = colunas.map((c) => c.id);
  const textos = ["oi", "@Gil olha", "@gilberto e @Gil", "@Dev 1 e @Dev", "@Nod faz", "@Faustino de novo", "email a@Gil.com", "@Gilbertos chegou", "@Dev 1 só"];
  for (const s of status)
    for (const resp of ["x", null])
      for (const texto of textos)
        it(`${s} · ${resp ?? "sem responsável"} · "${texto}" bate com o servidor`, () => {
          expect(previaDoComentario({ tarefa: { agenteId: resp, status: s }, colunas, texto, agentes }).acionados).toEqual(doServidor(s, resp, texto));
        });

  it("os textos da linha", () => {
    const col = (id: string) => colunas.find((c) => c.id === id)!.nome;
    const andandoId = colunas.find((c) => andando(colunas, c.id))!.id;
    expect(textoDaPrevia(previaDoComentario({ tarefa: { agenteId: "x", status: andandoId }, colunas, texto: "oi", agentes }), col(andandoId))).toBe("Faustino vai ver agora");
    expect(textoDaPrevia(previaDoComentario({ tarefa: { agenteId: "x", status: andandoId }, colunas, texto: "@Gil", agentes }), col(andandoId))).toBe("Faustino e Gil vão ver agora");
    const p = previaDoComentario({ tarefa: { agenteId: "x", status: "afazer" }, colunas, texto: "oi", agentes });
    expect(p.motivo).toBe("fora_do_andamento");
    // QA do PR #702: a @menção fora do andamento aciona o mencionado, e o motivo diz isso.
    expect(previaDoComentario({ tarefa: { agenteId: "x", status: "afazer" }, colunas, texto: "@Gil olha", agentes }).motivo).toBe("mencao");
    expect(textoDaPrevia(p, col("afazer"))).toBe(`fica só registrado (${col("afazer")} não aciona ninguém; @nome chama um bot)`);
    expect(textoDaPrevia(previaDoComentario({ tarefa: { agenteId: null, status: andandoId }, colunas, texto: "oi", agentes }), null)).toMatch(/não tem responsável/);
  });
});
