import { describe, expect, it } from "vitest";
import { criarAgente, NOME_INICIAL } from "../../../src/use-cases/criar-agente.ts";
import { editarPerfil } from "../../../src/use-cases/editar-perfil.ts";
import { fixarAgente, ocultarAgente } from "../../../src/use-cases/fixar-ocultar-agente.ts";
import { listarFrota } from "../../../src/use-cases/listar-frota.ts";
import { depsEmMemoria, esperarErro, executar } from "../../helpers/deps-l6.ts";

describe("criarAgente (E1.1/E1.2/E1.3, EMENDA 17)", () => {
  it("perfil definido pela pessoa nasce confirmado e pronto para colaborar, sem conceder ferramentas externas", async () => {
    const { deps, banco } = depsEmMemoria();
    const { data } = await executar(deps, criarAgente, { dono: "pessoa", nome: "Vera", titulo: "Engenharia", descricao: "Revisa código e consulta os colegas." });
    expect(data.agente).toMatchObject({ nome: "Vera", titulo: "Engenharia", confirmado: true });
    expect(data.mensagem.texto).toContain("está pronto");
    expect(banco.concessoes).toEqual([]);
    await esperarErro(() => criarAgente(deps, { dono: "pessoa", nome: "a".repeat(61) }), "entrada_invalida");
  });
  it("nasce 'Novo agente' com conversa própria, mensagem 'agente-nasceu' e dois eventos no outbox", async () => {
    const { deps, banco } = depsEmMemoria();
    const { data, events } = await executar(deps, criarAgente, { dono: "pessoa" });
    expect(data.agente.nome).toBe(NOME_INICIAL);
    expect(data.agente.modelo).toBe("auto");
    expect(data.agente).toMatchObject({ dono: "pessoa", visibility: "privado", confirmado: false, fixado: false, oculto: false });
    expect(data.conversa).toMatchObject({ tipo: "propria", agenteId: data.agente.id });
    expect(data.mensagem.kind).toBe("sistema");
    expect(data.mensagem.texto).toContain("identidade de execução vazia");
    expect(events.map((e) => e.kind)).toEqual(["agente_atualizado", "mensagem_criada"]);
    expect(banco.outbox).toHaveLength(2);
    expect(banco.memorias).toEqual([]);
    expect(banco.concessoes).toEqual([]);
    expect(banco.rotinas).toEqual([]);
  });

  it("forma e cor por round-robin; empresa nasce 'equipe'; nome informado é respeitado", async () => {
    const { deps } = depsEmMemoria();
    const a = (await executar(deps, criarAgente, { dono: "pessoa" })).data.agente;
    const b = (await executar(deps, criarAgente, { dono: "empresa", nome: "  Vera " })).data.agente;
    expect(b.forma).not.toBe(a.forma);
    expect(b.cor).not.toBe(a.cor);
    expect(b).toMatchObject({ nome: "Vera", dono: "empresa", visibility: "equipe" });
  });

  it("dono inválido → entrada_invalida (dono é obrigatório, E1.2)", async () => {
    const { deps } = depsEmMemoria();
    await esperarErro(() => criarAgente(deps, { dono: "time" as never }), "entrada_invalida");
  });

  it("frota descreve 'sem acessos · nunca executou' por contagem", async () => {
    const { deps } = depsEmMemoria();
    const { data } = await executar(deps, criarAgente, { dono: "pessoa" });
    const frota = (await listarFrota(deps, {})).data;
    expect(frota.agentes).toHaveLength(1);
    expect(frota.agentes[0]).toMatchObject({ id: data.agente.id, conversaId: data.conversa.id, descricaoEstado: "sem acessos · nunca executou" });
    expect(frota.inventario.estado).toBe("ausente");
  });

  it("editarPerfil recusa dono no corpo (dono_imutavel) e corpo vazio (entrada_invalida); aplica nome/título", async () => {
    const { deps } = depsEmMemoria();
    const { data } = await executar(deps, criarAgente, { dono: "pessoa" });
    await esperarErro(() => editarPerfil(deps, { agenteId: data.agente.id, dono: "empresa" }), "dono_imutavel");
    await esperarErro(() => editarPerfil(deps, { agenteId: data.agente.id }), "entrada_invalida");
    const r = await executar(deps, editarPerfil, { agenteId: data.agente.id, nome: "Vera", titulo: "Revisora" });
    expect(r.data.agente).toMatchObject({ nome: "Vera", titulo: "Revisora", dono: "pessoa" });
  });

  it("0037: o esforço muda sem recomeçar a sessão; \"\" volta ao padrão do modelo; valor fora da lista é recusado", async () => {
    const { deps } = depsEmMemoria();
    const { data } = await executar(deps, criarAgente, { dono: "pessoa" });
    expect((await executar(deps, editarPerfil, { agenteId: data.agente.id, esforco: "high" })).data.agente.esforco).toBe("high");
    expect((await executar(deps, editarPerfil, { agenteId: data.agente.id, nome: "Vera" })).data.agente.esforco).toBe("high");
    expect((await executar(deps, editarPerfil, { agenteId: data.agente.id, esforco: "" })).data.agente.esforco).toBeNull();
    await esperarErro(() => editarPerfil(deps, { agenteId: data.agente.id, esforco: "turbo" }), "entrada_invalida");
  });

  it("fixar alterna; ocultar tira da frota sem apagar", async () => {
    const { deps } = depsEmMemoria();
    const { data } = await executar(deps, criarAgente, { dono: "pessoa" });
    expect((await fixarAgente(deps, { agenteId: data.agente.id })).data.agente.fixado).toBe(true);
    expect((await fixarAgente(deps, { agenteId: data.agente.id })).data.agente.fixado).toBe(false);
    expect((await ocultarAgente(deps, { agenteId: data.agente.id, oculto: true })).data.agente.oculto).toBe(true);
    expect((await listarFrota(deps, {})).data.agentes).toHaveLength(0);
    expect(await deps.repos.agentes.buscar(data.agente.id)).not.toBeNull();
    await esperarErro(() => fixarAgente(deps, { agenteId: "nao-existe" }), "nao_encontrado");
  });
});

it("criação rápida persiste nome distinto e boas-vindas do bot sem gastar turno nem conceder acessos", async () => {
  const { deps, banco } = depsEmMemoria();
  const a = (await criarAgente(deps, { dono: "pessoa", interativo: true })).data;
  const b = (await criarAgente(deps, { dono: "pessoa", interativo: true })).data;
  expect(a.agente.nome).toBe("Frida");
  expect(b.agente.nome).toBe("Nina");
  expect(a.agente.confirmado).toBe(false);
  expect(a.mensagem).toMatchObject({ kind: "texto", payload: { kind: "boas_vindas" }, autoria: { autor_tipo: "agente", autor_id: a.agente.id } });
  expect(a.mensagem.texto).toContain("Para que você quer minha ajuda?");
  expect(banco.turnos).toHaveLength(0);
  expect(banco.concessoes).toHaveLength(0);
});

 it("modelo explícito é preservado; trocar para Sonnet limpa a sessão antiga sem apagar mensagens", async () => {
  const { deps } = depsEmMemoria();
  const { data } = await executar(deps, criarAgente, { dono: "pessoa", modelo: "claude-haiku-4-5-20251001" });
  expect(data.agente.modelo).toBe("claude-haiku-4-5-20251001");
  await deps.repos.conversas.atualizarSessaoCli(data.conversa.id, "sessao-haiku", "local");
  await editarPerfil(deps, { agenteId: data.agente.id, titulo: "Triagem" });
  expect((await deps.repos.conversas.buscar(data.conversa.id))?.sessaoCli).toBe("sessao-haiku");
  await editarPerfil(deps, { agenteId: data.agente.id, modelo: "sonnet" });
  expect((await deps.repos.agentes.buscar(data.agente.id))?.modelo).toBe("sonnet");
  expect((await deps.repos.conversas.buscar(data.conversa.id))?.sessaoCli).toBeNull();
  expect(await deps.repos.mensagens.listarDaConversa(data.conversa.id)).toHaveLength(1);
 });
