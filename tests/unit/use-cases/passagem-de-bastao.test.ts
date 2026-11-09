import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Autoria } from "../../../src/contracts/evento.ts";
import type { ContaAnunciada } from "../../../src/contracts/contas-ia.ts";
import type { IdHarness } from "../../../src/contracts/harness.ts";
import type { ResultadoTurno } from "../../../src/contracts/turno.ts";
import { ENTRADA_DA_VOLTA_DA_COTA, MARCA_DO_PEDIDO_ORIGINAL } from "../../../src/domain/cota-da-ia.ts";
import { INSTRUCAO_DA_PASSAGEM, TITULO_DA_PASSAGEM } from "../../../src/domain/passagem-de-bastao.ts";
import { assentarTurno } from "../../../src/use-cases/assentar-turno.ts";
import { criarAgente } from "../../../src/use-cases/criar-agente.ts";
import { emitirPlanoTurno } from "../../../src/use-cases/emitir-plano-turno.ts";
import { decidirTrocaDeIa } from "../../../src/use-cases/trocas-de-ia.ts";
import { depsEmMemoria, executar, MARLON } from "../../helpers/deps-l6.ts";

/**
 * NOD-310 (emenda da ADR-108 §5): a task levada para a outra IA começa com a passagem de bastão. O cenário: o Eng 1 na
 * vm-bots com o Claude e o ChatGPT; a task tem sessão, conversa, um PR aberto por aprovação e uma negação; a IA dela
 * chega ao limite e a pessoa escolhe "levar". O primeiro turno na IA nova traz o que já foi feito, sem chamar IA nenhuma.
 */
const T0 = Date.now();
const MIN = 60_000;
const HORA = 60 * MIN;
const imp = (n: number) => n.toString(16).padStart(64, "0");
const anuncio = (n: number, ia: ContaAnunciada["ia"], apelido: string): ContaAnunciada => ({ impressao: imp(n), ia, estado: "pronta", plano: "Max", corporativa: false, logadaEm: T0 - HORA, apelidoSugerido: apelido });
const pronto = { estado: "pronto" as const, versao: "2.1.296", em: T0 };
const base = {
  texto: "", sessaoCli: null, custoUsd: 0, sinais: { attempted: true, rejected: false, promptSubmitted: true, producedOutput: false },
  tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [],
} satisfies Omit<ResultadoTurno, "desfecho">;
const limite = (voltaEm: number): ResultadoTurno => ({ ...base, desfecho: "falha", motivoFalha: "limite_do_plano", limiteVoltaEm: voltaEm, erroCru: "usage limit" });
const autoria = (tipo: "pessoa" | "agente", id: string): Autoria => ({ autor_tipo: tipo, autor_id: id, sob_procuracao_de: null, conta_de_execucao: MARLON.pessoaId, executor: "local", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: tipo === "pessoa" ? "pessoa" : "regra:x", regra_versao: 1 } as Autoria);

async function cenario(ia: IdHarness) {
  const relogio = { agora: T0 };
  const { deps, banco } = depsEmMemoria(MARLON, { relogio: () => relogio.agora });
  const { data: bot } = await executar(deps, criarAgente, { dono: "pessoa", nome: "Eng 1" });
  const vm = (await deps.repos.maquinaTokens.criar({ nome: "vm-bots", prefixo: "8f2a", hash: randomBytes(32) }))!.id;
  await deps.repos.agentes.definirMaquina([bot.agente.id], vm);
  await deps.repos.contasIa.doAnuncio(vm, [anuncio(1, "claude-cli", "Pessoal"), anuncio(2, "codex-cli", "Pessoal")], T0);
  const lista = (await deps.repos.contasIa.listar()).contas;
  const conta = (h: IdHarness) => lista.find((c) => c.ia === h)!;
  const agente = (await deps.repos.agentes.buscar(bot.agente.id))!;
  const conversaId = bot.conversa.id;

  const t = (await deps.repos.trabalhos.criar({ agenteId: bot.agente.id, conversaId, titulo: "NOD-310", origem: "pessoa", rotinaId: null, forma: "frente", iniciadoEm: T0 - HORA }))!;
  await deps.repos.trabalhos.atualizarSessao(t.id, `sessao-${ia}`, ia, "local");
  if (ia === "codex-cli") await deps.repos.trabalhos.definirContaDaSessao(t.id, conta("codex-cli").id);
  const turno = (await deps.repos.turnos.enfileirar({ conversaId, agenteId: bot.agente.id, origem: "conversa", prazoEm: T0 + 86_400_000, profundidade: 0, entradaTexto: "implementa a passagem de bastão", entradaConfianca: "confiavel", modelo: agente.modelo, harness: agente.harness, executor: "local", trabalhoId: t.id }))!;

  // O que aconteceu na task antes do limite.
  await deps.repos.mensagens.criar({ conversaId, turnoId: turno.id, autoria: autoria("agente", bot.agente.id), texto: "Abri o PR draft e escrevi o domínio.", confianca: "confiavel", kind: "texto" });
  await deps.repos.mensagens.criar({ conversaId, turnoId: turno.id, autoria: autoria("pessoa", MARLON.pessoaId), texto: "pode seguir sem schema zod", confianca: "confiavel", kind: "texto" });
  const decisao = (await deps.repos.decisoes.criar({ tipo: "aprovacao", agenteId: bot.agente.id, conversaId, turnoId: turno.id, prazoDecisaoEm: T0 + HORA, frase: "Abrir o PR" }))!;
  await deps.repos.itensAprovacao.criarLote(decisao.id, [{ idx: 0, texto: "PR #432 gamefik/nod", destino: { conector: "github", ferramenta: "criar_pr", argumentos: {} }, origemSensivel: false, desfecho: "executado" }]);
  await deps.repos.trilha.registrar({ agenteId: bot.agente.id, turnoId: turno.id, ferramenta: "Bash", kind: "negacao", motivo: "fora_da_pasta", regra: "regra:nativas", regraVersao: 1 });

  const bateNoLimite = async () => {
    const x = banco.turnos.find((y) => y.id === turno.id)!;
    Object.assign(x, { estado: "despachando", machineId: vm, leaseAte: relogio.agora + HORA });
    await deps.repos.turnos.registrarConta(turno.id, conta(ia).id);
    const prontosPorMaquina = { [vm]: ["claude-cli", "codex-cli"] as IdHarness[] };
    return executar(deps, assentarTurno, { turnoId: turno.id, machineId: vm, seqLocal: 1, fala: { tipo: "texto", texto: "" }, resultado: limite(T0 + 16 * HORA), executor: "local", harness: ia, prontosDaPessoa: ["claude-cli", "codex-cli"], prontosPorMaquina });
  };
  const emitir = (turnoId: string) => executar(deps, emitirPlanoTurno, { turnoId, machineId: vm, executor: "local", harnesses: { "claude-cli": pronto, "codex-cli": pronto } });
  const voltaDe = () => banco.turnos.find((x) => x.retomaTurnoId === turno.id);
  return { deps, banco, bot: bot.agente, conversaId, trabalhoId: t.id, turno, bateNoLimite, emitir, voltaDe, autoria };
}

describe("NOD-310: a task levada para a outra IA começa com a passagem de bastão", () => {
  for (const [de, para] of [["claude-cli", "codex-cli"], ["codex-cli", "claude-cli"]] as const) {
    it(`${de} → ${para}: aviso, pedido original, o PR como efeito, a negação e passagem.git`, async () => {
      const c = await cenario(de);
      await c.bateNoLimite();
      await executar(c.deps, decidirTrocaDeIa, { agenteId: c.bot.id, decisao: "levar" });
      const volta = c.voltaDe()!;
      expect(volta).toMatchObject({ harness: para });
      const { data: plano } = await c.emitir(volta.id);
      const texto = plano!.entrada.texto;
      expect(plano!.entrada.sessaoCli).toBeNull();
      expect(plano!.entrada.passagem).toEqual({ git: true });
      expect(texto.startsWith(ENTRADA_DA_VOLTA_DA_COTA)).toBe(true);
      expect(texto).toContain(TITULO_DA_PASSAGEM);
      expect(texto).toMatch(/Pedido original:\nimplementa a passagem de bastão/);
      expect(texto).toMatch(/Abri o PR draft e escrevi o domínio\./);
      expect(texto).toMatch(/A pessoa: pode seguir sem schema zod/);
      expect(texto).toMatch(/Efeitos externos já feitos \(não repita\):\n- github\/criar_pr \(aprovado e executado\): PR #432 gamefik\/nod/);
      expect(texto).toMatch(/Negado: Bash \(fora_da_pasta\)\./);
      expect(texto).toContain(INSTRUCAO_DA_PASSAGEM);
      // A passagem fica entre o aviso e o resto da entrada da volta.
      expect(texto.indexOf(TITULO_DA_PASSAGEM)).toBeGreaterThan(0);
    });
  }

  it("NOD-70: as linhas da trilha do cartão, do clique e do lote não repetem o item de aprovação na passagem", async () => {
    const c = await cenario("claude-cli");
    const linha = { agenteId: c.bot.id, turnoId: c.turno.id, ferramenta: "github__criar_pr", regraVersao: 1 };
    await c.deps.repos.trilha.registrar({ ...linha, kind: "cartao", motivo: "acao_arriscada", regra: "regra:cartao" });
    await c.deps.repos.trilha.registrar({ ...linha, kind: "negacao", motivo: "retirado_pela_pessoa", regra: "regra:clique" });
    await c.deps.repos.trilha.registrar({ ...linha, ferramenta: "pedir_a_bot", kind: "tool_call", motivo: "item_de_aprovacao", regra: "regra:modo_automatico" });
    await c.bateNoLimite();
    await executar(c.deps, decidirTrocaDeIa, { agenteId: c.bot.id, decisao: "levar" });
    const texto = (await c.emitir(c.voltaDe()!.id)).data!.entrada.texto;
    expect(texto).toMatch(/Negado: Bash \(fora_da_pasta\)\./);
    expect(texto).not.toContain("Negado: github__criar_pr");
    expect(texto).not.toContain("pedir_a_bot: chamada");
  });

  it("o turno que retoma a mesma sessão não ganha passagem", async () => {
    const c = await cenario("claude-cli");
    const { data: plano } = await c.emitir(c.turno.id);
    expect(plano!.entrada.sessaoCli).toBe("sessao-claude-cli");
    expect(plano!.entrada.passagem).toBeUndefined();
    expect(plano!.entrada.texto).not.toContain(TITULO_DA_PASSAGEM);
  });

  it("achado 2 do QA (#432): 60 falas do bot — entram as 50 mais recentes e as 10 mais antigas viram contagem", async () => {
    const c = await cenario("claude-cli");
    for (let i = 0; i < 60; i++) {
      const m = await c.deps.repos.mensagens.criar({ conversaId: c.conversaId, turnoId: c.turno.id, autoria: c.autoria("agente", c.bot.id), texto: `passo ${i}`, confianca: "confiavel", kind: "texto" });
      Object.assign(c.banco.mensagens.find((x) => x.id === m!.id)!, { criadoEm: T0 + (i + 1) * MIN });
    }
    await c.bateNoLimite();
    await executar(c.deps, decidirTrocaDeIa, { agenteId: c.bot.id, decisao: "levar" });
    const { data: plano } = await c.emitir(c.voltaDe()!.id);
    const texto = plano!.entrada.texto;
    expect(texto).toMatch(/- passo 59\n/);
    expect(texto).not.toMatch(/- passo 9\n/);
    // 60 passos + "Abri o PR draft…" (bot) e "pode seguir…" (pessoa): 62 falas, 50 entram; as 12 mais antigas são 11 do bot e 1 da pessoa.
    expect(texto).toMatch(/\(…mais 11 itens omitidos\)/);
    expect(texto).toMatch(/\(…mais 1 item omitido\)/);
  });

  it("achado 3 do QA (#432): a volta levada que já traz o pedido original não o repete na passagem", async () => {
    const c = await cenario("claude-cli");
    await c.bateNoLimite();
    await executar(c.deps, decidirTrocaDeIa, { agenteId: c.bot.id, decisao: "levar" });
    const volta = c.banco.turnos.find((x) => x.id === c.voltaDe()!.id)!;
    volta.entradaTexto = `${volta.entradaTexto}${MARCA_DO_PEDIDO_ORIGINAL}implementa a passagem de bastão`;
    const { data: plano } = await c.emitir(volta.id);
    const texto = plano!.entrada.texto;
    expect(texto).toContain(TITULO_DA_PASSAGEM);
    expect(texto.split("implementa a passagem de bastão")).toHaveLength(2);
  });

  it("achado 4 do QA (#432): depois da sessão recusada (sessao_rejeitada, sessão largada), o turno seguinte ganha a passagem", async () => {
    const c = await cenario("claude-cli");
    await c.deps.repos.turnos.interromper(c.turno.id, "sessao_rejeitada");
    await c.deps.repos.trabalhos.largarSessao(c.trabalhoId);
    const agente = (await c.deps.repos.agentes.buscar(c.bot.id))!;
    const seguinte = (await c.deps.repos.turnos.enfileirar({ conversaId: c.conversaId, agenteId: c.bot.id, origem: "conversa", prazoEm: T0 + 86_400_000, profundidade: 0, entradaTexto: "continua", entradaConfianca: "confiavel", modelo: agente.modelo, harness: agente.harness, executor: "local", trabalhoId: c.trabalhoId }))!;
    const { data: plano } = await c.emitir(seguinte.id);
    expect(plano!.entrada.sessaoCli).toBeNull();
    expect(plano!.entrada.passagem).toEqual({ git: true });
    expect(plano!.entrada.texto).toContain(TITULO_DA_PASSAGEM);
  });

  it("achado 1 do Revisor (#432): a leitura dos turnos do trabalho falha — o plano sai sem passagem, sem cair", async () => {
    const c = await cenario("claude-cli");
    await c.deps.repos.turnos.interromper(c.turno.id, "sessao_rejeitada");
    await c.deps.repos.trabalhos.largarSessao(c.trabalhoId);
    const agente = (await c.deps.repos.agentes.buscar(c.bot.id))!;
    const seguinte = (await c.deps.repos.turnos.enfileirar({ conversaId: c.conversaId, agenteId: c.bot.id, origem: "conversa", prazoEm: T0 + 86_400_000, profundidade: 0, entradaTexto: "continua", entradaConfianca: "confiavel", modelo: agente.modelo, harness: agente.harness, executor: "local", trabalhoId: c.trabalhoId }))!;
    c.deps.repos.turnos.doTrabalho = async () => {
      throw new Error("banco fora");
    };
    const { data: plano } = await c.emitir(seguinte.id);
    expect(plano!.entrada.passagem).toBeUndefined();
    expect(plano!.entrada.texto).not.toContain(TITULO_DA_PASSAGEM);
  });

  it("a primeira volta de um trabalho sem sessão nenhuma não ganha passagem", async () => {
    const c = await cenario("claude-cli");
    await c.deps.repos.trabalhos.largarSessao(c.trabalhoId);
    const { data: plano } = await c.emitir(c.turno.id);
    expect(plano!.entrada.passagem).toBeUndefined();
  });
});
