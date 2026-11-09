import { describe, expect, it } from "vitest";
import { criarAgente } from "../../../src/use-cases/criar-agente.ts";
import { duplicarAgente } from "../../../src/use-cases/duplicar-agente.ts";
import { gerirAgente } from "../../../src/use-cases/gerir-agente.ts";
import { mudarModoAprovacao } from "../../../src/use-cases/mudar-modo-aprovacao.ts";
import { ANA, depsEmMemoria, esperarErro, executar } from "../../helpers/deps-l6.ts";
import { revisorDeTeste } from "../../helpers/revisor-de-teste.ts";

describe("mudarModoAprovacao (ADR-059)", () => {
  it("NOD-316: bot novo nasce em Automático; a dona troca, e a troca vira linha na conversa do bot", async () => {
    const { deps, banco } = depsEmMemoria();
    const { agente, conversa } = (await executar(deps, criarAgente, { dono: "pessoa", nome: "Dev 1" })).data;
    expect(agente.modoAprovacao).toBe("automatico");

    const { data, events } = await executar(deps, mudarModoAprovacao, { agenteId: agente.id, modo: "manual" });
    expect(data).toMatchObject({ mudou: true, agente: { modoAprovacao: "manual" } });
    expect(events.map((e) => e.kind)).toEqual(["agente_atualizado", "mensagem_criada"]);
    const linha = banco.mensagens.filter((m) => m.conversaId === conversa.id && m.kind === "sistema").at(-1);
    expect(linha?.texto).toContain("mudou as aprovações de Dev 1 para Aprovar manualmente");
    expect(linha?.autoria.autor_tipo).toBe("pessoa");
  });

  it("2026-10-18: a linha gravada usa a frase do menu, e nenhuma diz que o automático para depois de ler a web", async () => {
    const { deps, banco } = depsEmMemoria();
    const { agente, conversa } = (await executar(deps, criarAgente, { dono: "pessoa", nome: "Dev 1" })).data;
    const linhas: string[] = [];
    // NOD-316: o bot nasce em Automático; o Manual vem primeiro para as três trocas escreverem linha.
    for (const [modo, extra] of [["manual", {}], ["automatico", {}], ["total", { confirmado: true }]] as const) {
      await executar(deps, mudarModoAprovacao, { agenteId: agente.id, modo, ...extra });
      linhas.push(banco.mensagens.filter((m) => m.conversaId === conversa.id && m.kind === "sistema").at(-1)?.texto ?? "");
    }
    expect(linhas[0]).toMatch(/para Aprovar manualmente: pede você antes de tudo que muda algo: commit, push, mensagem, arquivo fora da pasta\.$/);
    expect(linhas[1]).toMatch(/para Aprovar automaticamente: roda sem perguntar o que não for arriscado\. Para no arriscado e no que tocar uma credencial do Mac\.$/);
    // PR 6 dos modos de aprovação: a frase do protótipo — até a credencial, e o que fez fica na Atividade.
    expect(linhas[2]).toMatch(/para Ignorar todas as aprovações: faz tudo sem perguntar, até comandos com as credenciais do seu Mac\. O que ele fez fica na Atividade\.$/);
    for (const l of linhas) expect(l).not.toMatch(/ler a web|depois de ler/);
  });

  it("PR 4 dos modos de aprovação: com o revisor ligado, a linha do Automático diz o revisor (sem 'na sua IA'); desligado, a de hoje", async () => {
    const { deps, banco } = depsEmMemoria();
    deps.services.revisor = revisorDeTeste({ assentar: async () => undefined }).executor;
    const { agente, conversa } = (await executar(deps, criarAgente, { dono: "pessoa", nome: "Dev 1" })).data;
    await executar(deps, mudarModoAprovacao, { agenteId: agente.id, modo: "manual" });
    await executar(deps, mudarModoAprovacao, { agenteId: agente.id, modo: "automatico" });
    const linha = banco.mensagens.filter((m) => m.conversaId === conversa.id && m.kind === "sistema").at(-1)?.texto ?? "";
    expect(linha).toMatch(/para Aprovar automaticamente: roda o que você pediu\. Um revisor confere cada ação arriscada: libera sozinho ou pede o seu ok num cartão\.$/);
    expect(linha).not.toMatch(/sua IA|sua conta/);
  });

  it("2026-10-18: ligar o total exige confirmado: true (o segundo clique); os outros modos não pedem", async () => {
    const { deps } = depsEmMemoria();
    const { agente } = (await executar(deps, criarAgente, { dono: "pessoa", nome: "Dev 1" })).data;
    for (const confirmado of [undefined, false, "true", 1]) {
      await esperarErro(() => mudarModoAprovacao(deps, { agenteId: agente.id, modo: "total", confirmado }), "entrada_invalida");
    }
    expect((await deps.repos.agentes.buscar(agente.id))?.modoAprovacao).toBe("automatico");
    expect((await executar(deps, mudarModoAprovacao, { agenteId: agente.id, modo: "manual" })).data.mudou).toBe(true);
    expect((await executar(deps, mudarModoAprovacao, { agenteId: agente.id, modo: "automatico" })).data.mudou).toBe(true);
    expect((await executar(deps, mudarModoAprovacao, { agenteId: agente.id, modo: "total", confirmado: true })).data.mudou).toBe(true);
  });

  it("repetir o mesmo modo não escreve nada", async () => {
    const { deps } = depsEmMemoria();
    const { agente } = (await executar(deps, criarAgente, { dono: "pessoa", nome: "Dev 1" })).data;
    await executar(deps, mudarModoAprovacao, { agenteId: agente.id, modo: "total", confirmado: true });
    const { data, events } = await executar(deps, mudarModoAprovacao, { agenteId: agente.id, modo: "total", confirmado: true });
    expect(data.mudou).toBe(false);
    expect(events).toEqual([]);
  });

  it("modo fora dos três é entrada inválida; bot que não existe é nao_encontrado", async () => {
    const { deps } = depsEmMemoria();
    const { agente } = (await executar(deps, criarAgente, { dono: "pessoa", nome: "Dev 1" })).data;
    await esperarErro(() => mudarModoAprovacao(deps, { agenteId: agente.id, modo: "auto" }), "entrada_invalida");
    await esperarErro(() => mudarModoAprovacao(deps, { agenteId: "00000000-0000-4000-8000-000000000000", modo: "total", confirmado: true }), "nao_encontrado");
  });

  it("colega que enxerga o bot de equipe não muda o modo dele", async () => {
    const { deps, reposDe } = depsEmMemoria();
    const { agente } = (await executar(deps, criarAgente, { dono: "empresa", nome: "Vera" })).data;
    const daAna = { ...deps, repos: reposDe(ANA), escopo: ANA };
    await esperarErro(() => mudarModoAprovacao(daAna, { agenteId: agente.id, modo: "total", confirmado: true }), "nao_permitido");
  });

  it.each([
    ["total", { confirmado: true }],
    ["manual", {}],
  ] as const)("NOD-316: a cópia de um bot em %s nasce em Automático — não herda o modo do original", async (modo, extra) => {
    const { deps } = depsEmMemoria();
    const { agente } = (await executar(deps, criarAgente, { dono: "pessoa", nome: "Dev 1" })).data;
    await executar(deps, mudarModoAprovacao, { agenteId: agente.id, modo, ...extra });
    const copia = (await executar(deps, duplicarAgente, { agenteId: agente.id })).data.agente;
    expect(copia.modoAprovacao).toBe("automatico");
    expect((await deps.repos.agentes.buscar(agente.id))?.modoAprovacao).toBe(modo);
  });

  it("excluir volta o bot para Manual (restaurar não devolve autonomia)", async () => {
    const { deps } = depsEmMemoria();
    const { agente } = (await executar(deps, criarAgente, { dono: "pessoa", nome: "Dev 1" })).data;
    await executar(deps, mudarModoAprovacao, { agenteId: agente.id, modo: "total", confirmado: true });
    await executar(deps, gerirAgente, { agenteId: agente.id, acao: "excluir" });
    await executar(deps, gerirAgente, { agenteId: agente.id, acao: "restaurar" });
    expect((await deps.repos.agentes.buscar(agente.id))?.modoAprovacao).toBe("manual");
  });
});
