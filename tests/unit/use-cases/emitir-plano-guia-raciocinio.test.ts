import { describe, expect, it } from "vitest";
import { MODELO_MAIS_POTENTE } from "../../../src/contracts/modelos.ts";
import { raciociniosDoModelo } from "../../../src/domain/inteligencia.ts";
import { criarAgente } from "../../../src/use-cases/criar-agente.ts";
import { atualizarPerfil } from "../../../src/use-cases/atualizar-perfil.ts";
import { autoriaAgente } from "../../../src/use-cases/autoria-evento.ts";
import { emitirPlanoTurno } from "../../../src/use-cases/emitir-plano-turno.ts";
import { enviarMensagem } from "../../../src/use-cases/enviar-mensagem.ts";
import { definirInteligenciaDoBot } from "../../../src/use-cases/inteligencia.ts";
import { depsEmMemoria, executar, MARLON } from "../../helpers/deps-l6.ts";

/**
 * NOD-293 (B7, 2026-10-20): a guia no "auto" troca o modelo pelo mais potente da IA (MODELO_MAIS_POTENTE) depois que o
 * raciocínio foi validado contra o recomendado. O "max" que o recomendado do Codex aceita não vale no mais potente dele:
 * o plano tem de levar um raciocínio que o modelo trocado aceita, nunca o "max" cru.
 */
describe("NOD-293 (B7): a guia no mais potente não leva um raciocínio que o modelo não aceita", () => {
  const pronto = { estado: "pronto" as const, versao: "fake", em: Date.now() };

  it("Codex com 'max' escolhido no recomendado: no gpt-6-astra o plano sai com o médio", async () => {
    const maisPotente = MODELO_MAIS_POTENTE["codex-cli"]!;
    expect(raciociniosDoModelo("codex-cli", maisPotente)).not.toContain("max");
    const { deps } = depsEmMemoria(MARLON);
    const { data: bot } = await executar(deps, criarAgente, { dono: "pessoa", nome: "Guia" });
    await executar(deps, definirInteligenciaDoBot, { agenteId: bot.agente.id, pedido: { modo: "auto", escolhas: { "codex-cli": { raciocinio: "max" } } } });
    await deps.repos.onboarding.definirGuia(bot.agente.id);
    const agente = (await deps.repos.agentes.buscar(bot.agente.id))!;
    expect(agente.modelo).toBe("auto");
    const turno = (await deps.repos.turnos.enfileirar({ conversaId: bot.conversa.id, agenteId: agente.id, origem: "conversa", prazoEm: Date.now() + 86_400_000, profundidade: 0, entradaTexto: "oi", entradaConfianca: "confiavel", modelo: agente.modelo, harness: agente.harness, executor: "local" }))!;
    const { data } = await executar(deps, emitirPlanoTurno, { turnoId: turno.id, machineId: "maquina-1", executor: "local", harnesses: { "codex-cli": pronto } });
    expect(data.entrada.modelo).toBe(maisPotente);
    expect(data.entrada.esforco).toBe("medium");
  });
});

describe("NOD-23: a reconfiguração começa no turno do comando", () => {
  const pronto = { estado: "pronto" as const, versao: "fake", em: Date.now() };

  it("uma fala anterior ao /configurar não recebe o prompt nem atualizar_perfil", async () => {
    const { deps, banco } = depsEmMemoria(MARLON);
    const { data: bot } = await executar(deps, criarAgente, { dono: "pessoa", nome: "Vera" });
    await deps.repos.agentes.atualizarPerfil(bot.agente.id, { descricao: "Revisa código", confirmado: true });
    const enviar = async (texto: string) => (await executar(deps, enviarMensagem, { conversaId: bot.conversa.id, texto, inventario: pronto })).data.turno;
    const antes = await enviar("antes");
    const configurar = await enviar("/configurar");
    const configurarDeNovo = await enviar("/setup muda só o tom");
    const depois = await enviar("depois");
    Object.assign(banco.turnos.find((t) => t.id === antes.id)!, { criadoEm: 1 });
    Object.assign(banco.turnos.find((t) => t.id === configurar.id)!, { criadoEm: 2 });
    Object.assign(banco.turnos.find((t) => t.id === configurarDeNovo.id)!, { criadoEm: 3 });
    Object.assign(banco.turnos.find((t) => t.id === depois.id)!, { criadoEm: 4 });

    const { data: plano } = await executar(deps, emitirPlanoTurno, { turnoId: antes.id, machineId: "maquina-1", executor: "local", harnesses: { "claude-cli": pronto } });
    expect("catalogo" in plano ? plano.catalogo.ferramentas.map((f) => f.nome) : []).not.toContain("atualizar_perfil");
    expect("promptSistema" in plano ? plano.promptSistema : "").not.toContain("Modo de reconfiguração");
    for (const turnoId of [configurar.id, configurarDeNovo.id, depois.id]) {
      const { data } = await executar(deps, emitirPlanoTurno, { turnoId, machineId: "maquina-1", executor: "local", harnesses: { "claude-cli": pronto } });
      expect("catalogo" in data ? data.catalogo.ferramentas.map((f) => f.nome) : []).toContain("atualizar_perfil");
    }
    Object.assign(banco.agentes.find((a) => a.id === bot.agente.id)!, { configurandoDesde: 0 });
    const tokenDeTurno = deps.services.tokenTurno.cunhar(configurarDeNovo.id, { ...MARLON, agenteId: bot.agente.id });
    const { data: recomposto } = await executar(deps, emitirPlanoTurno, { turnoId: configurarDeNovo.id, machineId: "maquina-1", executor: "local", harnesses: { "claude-cli": pronto }, recompor: { tokenDeTurno, harness: "claude-cli" } });
    expect("catalogo" in recomposto ? recomposto.catalogo.ferramentas.map((f) => f.nome) : []).not.toContain("atualizar_perfil");
  });

  it("um comando ainda não emitido reabre se o card anterior fechar enquanto ele esperava na fila", async () => {
    const { deps, banco } = depsEmMemoria(MARLON);
    const { data: bot } = await executar(deps, criarAgente, { dono: "pessoa", nome: "Vera" });
    await deps.repos.agentes.atualizarPerfil(bot.agente.id, { descricao: "Revisa código", confirmado: true });
    const enviar = async () => (await executar(deps, enviarMensagem, { conversaId: bot.conversa.id, texto: "/configurar", inventario: pronto })).data.turno;
    const anterior = await enviar();
    const novo = await enviar();
    Object.assign(banco.turnos.find((t) => t.id === anterior.id)!, { criadoEm: 1 });
    Object.assign(banco.turnos.find((t) => t.id === novo.id)!, { criadoEm: 2 });
    await deps.repos.agentes.encerrarConfiguracao(bot.agente.id, anterior.id);
    expect((await deps.repos.agentes.buscar(bot.agente.id))?.configurandoDesde).toBeNull();

    const { data } = await executar(deps, emitirPlanoTurno, { turnoId: novo.id, machineId: "maquina-1", executor: "local", harnesses: { "claude-cli": pronto } });
    expect("catalogo" in data ? data.catalogo.ferramentas.map((f) => f.nome) : []).toContain("atualizar_perfil");
    expect((await deps.repos.agentes.buscar(bot.agente.id))?.configurandoTurnoId).toBe(novo.id);
  });

  it("a proposta exige resumo com Certo?, confirmação e no máximo 4 perguntas", async () => {
    const { deps, banco } = depsEmMemoria(MARLON);
    const { data: bot } = await executar(deps, criarAgente, { dono: "pessoa", nome: "Vera" });
    await deps.repos.agentes.atualizarPerfil(bot.agente.id, { descricao: "Revisa código", confirmado: true });
    const inicio = (await executar(deps, enviarMensagem, { conversaId: bot.conversa.id, texto: "/configurar", inventario: pronto })).data.turno;
    Object.assign(banco.turnos.find((t) => t.id === inicio.id)!, { criadoEm: 1 });
    await expect(atualizarPerfil(deps, { agenteId: bot.agente.id, conversaId: bot.conversa.id, turnoId: inicio.id, descricao: "Mais direta" })).rejects.toMatchObject({ codigo: "estado_invalido" });

    const autoria = autoriaAgente({ agenteId: bot.agente.id, contaDeExecucao: MARLON.pessoaId, executor: "local" });
    await deps.repos.mensagens.criar({ conversaId: bot.conversa.id, turnoId: inicio.id, autoria, kind: "texto", texto: "Resumo: mais direta. Certo?", confianca: "confiavel" });
    const task = (await deps.repos.turnos.enfileirar({ conversaId: bot.conversa.id, agenteId: bot.agente.id, origem: "conversa", prazoEm: Date.now() + 60_000, profundidade: 0, entradaTexto: "task", entradaConfianca: "confiavel", modelo: "auto", executor: "local", trabalhoId: "trabalho-paralelo" }))!;
    Object.assign(banco.turnos.find((t) => t.id === task.id)!, { criadoEm: 1.5 });
    await deps.repos.mensagens.criar({ conversaId: bot.conversa.id, turnoId: task.id, autoria, kind: "texto", texto: "A task terminou. Certo?", confianca: "confiavel" });
    const negacao = (await executar(deps, enviarMensagem, { conversaId: bot.conversa.id, texto: "certo, mas não aplique", inventario: pronto })).data.turno;
    Object.assign(banco.turnos.find((t) => t.id === negacao.id)!, { criadoEm: 1.8 });
    Object.assign(banco.mensagens.find((m) => m.texto === "certo, mas não aplique")!, { criadoEm: 3.5 });
    await expect(atualizarPerfil(deps, { agenteId: bot.agente.id, conversaId: bot.conversa.id, turnoId: inicio.id, descricao: "Não aplique" })).rejects.toMatchObject({ codigo: "estado_invalido" });
    const sim = (await executar(deps, enviarMensagem, { conversaId: bot.conversa.id, texto: "sim, pode propor", inventario: pronto })).data.turno;
    Object.assign(banco.turnos.find((t) => t.id === sim.id)!, { criadoEm: 2 });
    Object.assign(banco.mensagens.find((m) => m.texto === "/configurar")!, { criadoEm: 1 });
    Object.assign(banco.mensagens.find((m) => m.texto === "Resumo: mais direta. Certo?")!, { criadoEm: 2 });
    Object.assign(banco.mensagens.find((m) => m.texto === "A task terminou. Certo?")!, { criadoEm: 3 });
    Object.assign(banco.mensagens.find((m) => m.texto === "sim, pode propor")!, { criadoEm: 4 });
    // A fala "sim" foi absorvida pela sessão viva: a ferramenta ainda roda no turno inicial.
    const valida = await atualizarPerfil(deps, { agenteId: bot.agente.id, conversaId: bot.conversa.id, turnoId: inicio.id, descricao: "Mais direta" });
    expect("proposta_id" in valida.data).toBe(true);
    await deps.repos.agentes.encerrarConfiguracao(bot.agente.id, inicio.id);
    await expect(atualizarPerfil(deps, { agenteId: bot.agente.id, conversaId: bot.conversa.id, turnoId: inicio.id, descricao: "Plano antigo" })).rejects.toMatchObject({ codigo: "estado_invalido" });

    const outro = depsEmMemoria(MARLON);
    const { data: bot2 } = await executar(outro.deps, criarAgente, { dono: "pessoa", nome: "Tuca" });
    await outro.deps.repos.agentes.atualizarPerfil(bot2.agente.id, { descricao: "Ajuda", confirmado: true });
    const inicio2 = (await executar(outro.deps, enviarMensagem, { conversaId: bot2.conversa.id, texto: "/configurar", inventario: pronto })).data.turno;
    Object.assign(outro.banco.turnos.find((t) => t.id === inicio2.id)!, { criadoEm: 1 });
    const autoria2 = autoriaAgente({ agenteId: bot2.agente.id, contaDeExecucao: MARLON.pessoaId, executor: "local" });
    for (let i = 1; i <= 5; i++) await outro.deps.repos.mensagens.criar({ conversaId: bot2.conversa.id, turnoId: inicio2.id, autoria: autoria2, kind: "texto", texto: `Pergunta ${i}?`, confianca: "confiavel" });
    await outro.deps.repos.mensagens.criar({ conversaId: bot2.conversa.id, turnoId: inicio2.id, autoria: autoria2, kind: "texto", texto: "Resumo final. Certo?", confianca: "confiavel" });
    const sim2 = (await executar(outro.deps, enviarMensagem, { conversaId: bot2.conversa.id, texto: "sim", inventario: pronto })).data.turno;
    Object.assign(outro.banco.turnos.find((t) => t.id === sim2.id)!, { criadoEm: 2 });
    await expect(atualizarPerfil(outro.deps, { agenteId: bot2.agente.id, conversaId: bot2.conversa.id, turnoId: sim2.id, descricao: "Mais direta" })).rejects.toMatchObject({ codigo: "estado_invalido" });
  });
});
