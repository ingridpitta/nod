import { describe, expect, it } from "vitest";
import type { QuadroDto, TarefaDto } from "../../../src/contracts/quadro.ts";
import type { FrameSse } from "../../../src/contracts/frame.ts";
import { COLUNAS_PADRAO, colunasDto } from "../../../src/domain/colunas.ts";
import { ErroApi } from "../../../web/lib/erro-api.ts";
import {
  campoDePedir, caminhoDoQuadro, deveRecarregar, donoDaTarefa, estadoDoErro, linhaDaTarefaAlheia, podeDesfazer, podeEditar, podeMudarStatus,
  podePedir, podeResponder, quadroDaUrl, releListaDosCompartilhados, rotuloCurtoDoModo, soComenta, textoDaRecusa, textoDoVazio,
} from "../../../web/lib/quadro-compartilhado.ts";

/** NOD-455: o gate da participante no quadro da dona, espelho do servidor (regraDoModo, pendenciaAlheia, tarefaDeOutraPessoa, podeDesfazer). */

const EU = "p-bia";
const DONA = "p-marlon";
const ANA = "p-ana";
const t = (id: string, extra: Partial<TarefaDto> = {}): TarefaDto => ({
  id, quadroId: "q1", titulo: `Tarefa ${id}`, descricao: "", status: "afazer", voltarPara: null, agenteId: "a", ordem: 1, linearId: null, linearUrl: null, prUrl: null,
  pergunta: null, resposta: null, deFora: false, turnoId: null, criadoEm: 1, mudadoEm: 1, terminadaEm: null, execucao: null, agenteNome: "Ada", numero: 1, codigo: `ZE-${id}`, branch: "", ...extra,
});
const q = (tarefas: TarefaDto[], extra: Partial<QuadroDto> = {}): QuadroDto => ({
  id: "q1", agenteId: "a", nome: null, projetoId: null, prefixo: "ZE", modoConversa: "individual", meta: "Meta", prazo: null, cumpridoEm: null, resumo: null, criadoEm: 1, atualizadoEm: 1, metaDesde: 1, agenteNome: "Ada",
  colunas: colunasDto(COLUNAS_PADRAO), tarefas, ultimoLote: null, feitas: 0, total: tarefas.length,
  voce: { pessoaId: EU, papel: "membro", podeDesfazer: false }, dona: { pessoaId: DONA, nome: "Marlon" },
  membros: [{ pessoaId: EU, nome: "Bia", adicionadoEm: 1 }, { pessoaId: ANA, nome: "Ana", adicionadoEm: 1 }], comentarios: [], ...extra,
});
const lote = { id: "l1", quadroId: "q1", autor: { tipo: "pessoa" as const }, resumo: "criou", tarefaIds: ["1"], desfeitoEm: null, criadoEm: 1, pedidoPor: EU };

describe("o gate da participante", () => {
  const minha = t("1", { pedidoPor: EU });
  const daAna = t("2", { pedidoPor: ANA });
  const daDona = t("3", { pedidoPor: null });

  it("individual: muda o status de qualquer uma; edita e exclui só a dela", () => {
    const quadro = q([minha, daAna, daDona]);
    for (const x of [minha, daAna, daDona]) expect(podeMudarStatus(quadro, x)).toBe(true);
    expect(podeEditar(quadro, minha)).toBe(true);
    expect(podeEditar(quadro, daAna)).toBe(false);
    // A tarefa sem quem pediu é da dona (o servidor também lê assim).
    expect(podeEditar(quadro, daDona)).toBe(false);
    expect(podePedir(quadro)).toBe(true);
  });

  it("a que espera alguém: só quem decide responde ou a tira de Com você", () => {
    const minhaVez = t("4", { status: "voce", pergunta: "?", decide: { pessoaId: EU, nome: "Bia", voce: true, saiu: null } });
    const vezDaAna = t("5", { status: "voce", pergunta: "?", decide: { pessoaId: ANA, nome: "Ana", voce: false, saiu: null } });
    const quadro = q([minhaVez, vezDaAna]);
    expect(podeResponder(quadro, minhaVez)).toBe(true);
    expect(podeMudarStatus(quadro, minhaVez)).toBe(true);
    expect(podeResponder(quadro, vezDaAna)).toBe(false);
    expect(podeMudarStatus(quadro, vezDaAna)).toBe(false);
    expect(podeResponder(quadro, t("6"))).toBe(false);
    // QA: a frase não promete o select que não aparece.
    expect(linhaDaTarefaAlheia(quadro, { ...vezDaAna, pedidoPor: ANA })).toBe("Tarefa da Ana: você comenta");
    // G6: a que espera alguém sem `decide` (o servidor não disse quem): ninguém de fora muda o status.
    expect(podeMudarStatus(quadro, t("7", { status: "voce", pergunta: "?" }))).toBe(false);
  });

  it("só a dona: só comenta (nem status, nem editar, nem responder, nem desfazer, nem pedir)", () => {
    const minhaVez = t("4", { status: "voce", pedidoPor: EU, decide: { pessoaId: EU, nome: "Bia", voce: true, saiu: null } });
    const quadro = q([minha, minhaVez], { modoConversa: "so_dono", voce: { pessoaId: EU, papel: "membro", podeDesfazer: true }, ultimoLote: lote });
    expect(soComenta(quadro)).toBe(true);
    expect(podeMudarStatus(quadro, minha)).toBe(false);
    expect(podeEditar(quadro, minha)).toBe(false);
    expect(podeResponder(quadro, minhaVez)).toBe(false);
    expect(podeDesfazer(quadro)).toBe(false);
    expect(podePedir(quadro)).toBe(false);
    expect(campoDePedir(quadro)).toEqual({ tipo: "recado", placeholder: "Deixar recado para Marlon", botao: "Deixar recado" });
    expect(textoDoVazio(quadro)).toBe("Nada no quadro do Marlon ainda. Deixe um recado.");
    expect(linhaDaTarefaAlheia(quadro, daAna)).toBe("Tarefa da Ana: você comenta");
  });

  it("desfaz só o lote dela (o servidor diz em voce.podeDesfazer) e nunca o já desfeito", () => {
    expect(podeDesfazer(q([], { ultimoLote: lote, voce: { pessoaId: EU, papel: "membro", podeDesfazer: true } }))).toBe(true);
    expect(podeDesfazer(q([], { ultimoLote: { ...lote, pedidoPor: ANA }, voce: { pessoaId: EU, papel: "membro", podeDesfazer: false } }))).toBe(false);
    expect(podeDesfazer(q([], { ultimoLote: { ...lote, desfeitoEm: 2 }, voce: { pessoaId: EU, papel: "membro", podeDesfazer: true } }))).toBe(false);
    expect(podeDesfazer(q([], { ultimoLote: null, voce: { pessoaId: EU, papel: "membro", podeDesfazer: true } }))).toBe(false);
  });

  it("G2: a dona abrindo o próprio quadro por /quadros/:qid no 'só a dona' faz tudo (não só comenta)", () => {
    const dona = q([t("1", { pedidoPor: ANA })], { modoConversa: "so_dono", voce: { pessoaId: DONA, papel: "dona", podeDesfazer: true }, ultimoLote: lote });
    expect(soComenta(dona)).toBe(false);
    expect(podeMudarStatus(dona, dona.tarefas[0]!)).toBe(true);
    expect(podeEditar(dona, dona.tarefas[0]!)).toBe(true);
    expect(podePedir(dona)).toBe(true);
  });

  it("sem `voce` (o servidor não disse quem lê), nada se faz", () => {
    const quadro = q([minha], { voce: undefined });
    expect(soComenta(quadro)).toBe(true);
    expect(podeMudarStatus(quadro, minha)).toBe(false);
    expect(podeEditar(quadro, minha)).toBe(false);
  });

  it("a linha da tarefa alheia diz de quem é; na dela, nenhuma", () => {
    const quadro = q([minha, daAna, daDona]);
    expect(linhaDaTarefaAlheia(quadro, minha)).toBeNull();
    expect(linhaDaTarefaAlheia(quadro, daAna)).toBe("Tarefa da Ana: você muda o status e comenta");
    expect(linhaDaTarefaAlheia(quadro, daDona)).toBe("Tarefa da Marlon: você muda o status e comenta");
    expect(donoDaTarefa(quadro, t("9", { pedidoPor: "quem-saiu" }))).toBe("outra pessoa");
    // Quem pediu e saiu: o servidor ainda manda o nome.
    expect(donoDaTarefa(quadro, t("9", { pedidoPor: "quem-saiu", pedidoPorNome: "Caio" }))).toBe("Caio");
  });

  it("o campo, o vazio e o rótulo curto do modo", () => {
    expect(campoDePedir(q([])).tipo).toBe("pedir");
    expect(textoDoVazio(q([]))).toBe("Nada no quadro do Marlon ainda. Peça algo aqui embaixo.");
    expect(rotuloCurtoDoModo({ modo: "so_dono", donaNome: "Marlon" })).toBe("Só a Marlon");
    expect(rotuloCurtoDoModo({ modo: "individual", donaNome: "Marlon" })).toBeNull();
  });
});

describe("erros, frames e a URL", () => {
  it("404/403/nao_encontrado/nao_permitido ao abrir = sem acesso; rede e 500 = erro com Tentar de novo", () => {
    expect(estadoDoErro(new ErroApi(404, "nao_encontrado", "x"))).toBe("fora");
    expect(estadoDoErro(new ErroApi(403, "nao_permitido", "x"))).toBe("fora");
    expect(estadoDoErro(new ErroApi(403, "outro", "x"))).toBe("fora");
    expect(estadoDoErro(new ErroApi(404, "outro", "x"))).toBe("fora");
    expect(estadoDoErro(new ErroApi(500, "erro_interno", "x"))).toBe("erro");
    expect(estadoDoErro(new TypeError("Failed to fetch"))).toBe("erro");
  });

  it("a recusa com o dono novo", () => {
    expect(textoDaRecusa("excluir", "Ana")).toBe("Não excluí: agora é da Ana");
    expect(textoDaRecusa("excluir", null)).toBe("Não deu para excluir agora");
  });

  it("relê só no quadro.mudou deste quadro", () => {
    const f = (tipo: string, quadroId: unknown): FrameSse => ({ streamId: "s", seq: 1, pessoaId: EU, tipo: tipo as FrameSse["tipo"], dados: { quadroId } });
    expect(deveRecarregar(f("quadro.mudou", "q1"), "q1")).toBe(true);
    expect(deveRecarregar(f("quadro.mudou", "q2"), "q1")).toBe(false);
    expect(deveRecarregar(f("turno.terminou", "q1"), "q1")).toBe(false);
  });

  it("a barra relê a lista só quando ela pode ter mudado (revisão 3)", () => {
    const f = (dados: Record<string, unknown>, tipo = "quadro.mudou"): FrameSse => ({ streamId: "s", seq: 1, pessoaId: EU, tipo: tipo as FrameSse["tipo"], dados });
    const lista = ["q1"];
    // Trabalho dos bots da dona num quadro já listado: não relê.
    expect(releListaDosCompartilhados(f({ quadroId: "q1", tarefas: "t1,t2" }), lista)).toBe(false);
    // Entrou num quadro novo, o quadro sumiu, ou um lote sem tarefa (pessoas, modo): relê.
    expect(releListaDosCompartilhados(f({ quadroId: "q2", tarefas: "t1" }), lista)).toBe(true);
    expect(releListaDosCompartilhados(f({ quadroId: "q1", removido: true }), lista)).toBe(true);
    expect(releListaDosCompartilhados(f({ quadroId: "q1", tarefas: "" }), lista)).toBe(true);
    expect(releListaDosCompartilhados(f({ quadroId: "q1" }), lista)).toBe(true);
    // Outro tipo ou sem quadroId: nada.
    expect(releListaDosCompartilhados(f({ quadroId: "q2" }, "turno.terminou"), lista)).toBe(false);
    expect(releListaDosCompartilhados(f({}), lista)).toBe(false);
  });

  it("o link direto: /quadros/<uuid>, e nada mais", () => {
    const id = "0b6f1c1e-1d2a-4c3b-9a8e-1234567890ab";
    expect(quadroDaUrl(`/quadros/${id}`)).toBe(id);
    expect(quadroDaUrl(`/quadros/${id.toUpperCase()}/`)).toBe(id);
    expect(quadroDaUrl("/quadros/nao-e-uuid")).toBeNull();
    expect(quadroDaUrl(`/quadros/${id}/tarefas`)).toBeNull();
    expect(quadroDaUrl("/")).toBeNull();
    expect(caminhoDoQuadro(id)).toBe(`/quadros/${id}`);
  });
});
