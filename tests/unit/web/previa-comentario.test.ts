import { describe, expect, it } from "vitest";
import { mencionados } from "../../../src/domain/comentarios-quadro.ts";
import { colunasDe } from "../../../src/domain/colunas.ts";
import { mencionaTodos, rotaDoComentario } from "../../../src/domain/rota-comentario.ts";
import { previaDoComentario, textoDaPrevia } from "../../../web/lib/previa-comentario.ts";

/**
 * ADA-28 (escopo D): a prévia da tela diz o mesmo que o servidor fará. A web espelha a regra (não importa o domínio,
 * ADR-018); este teste confere o espelho contra `mencionados` + `mencionaTodos` + `rotaDoComentario` num leque de casos.
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
  void status; // 2026-11-10: a coluna não decide mais (o responsável é acionado em qualquer uma)
  const ids = rotaDoComentario({ autor: { tipo: "pessoa" }, responsavelId: agenteId, mencionados: mencoes, todos: mencionaTodos(texto), nods: new Set(["n"]) }).map((r) => r.agenteId);
  return ids.map((id) => nomes.get(id)!);
}

describe("ADA-28: a prévia do comentário", () => {
  const status = colunas.map((c) => c.id);
  const textos = ["oi", "@todos aviso", "@todos e @Gil", "@Gil olha", "@gilberto e @Gil", "@Dev 1 e @Dev", "@Nod faz", "@Faustino de novo", "email a@Gil.com", "@Gilbertos chegou", "@Dev 1 só"];
  for (const s of status)
    for (const resp of ["x", null])
      for (const texto of textos)
        it(`${s} · ${resp ?? "sem responsável"} · "${texto}" bate com o servidor`, () => {
          expect(previaDoComentario({ tarefa: { agenteId: resp, status: s }, colunas, texto, agentes }).acionados).toEqual(doServidor(s, resp, texto));
        });

  it("os textos da linha", () => {
    expect(textoDaPrevia(previaDoComentario({ tarefa: { agenteId: "x", status: "afazer" }, colunas, texto: "oi", agentes }))).toBe("Faustino vai ver agora");
    expect(textoDaPrevia(previaDoComentario({ tarefa: { agenteId: "x", status: "feito" }, colunas, texto: "@Gil", agentes }))).toBe("Faustino e Gil vão ver agora");
    expect(textoDaPrevia(previaDoComentario({ tarefa: { agenteId: "x", status: "feito" }, colunas, texto: "@todos amanhã", agentes }))).toMatch(/@todos é anúncio/);
    expect(textoDaPrevia(previaDoComentario({ tarefa: { agenteId: null, status: "afazer" }, colunas, texto: "oi", agentes }))).toMatch(/não tem responsável/);
});
});
