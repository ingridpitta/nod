import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ContaAnunciada } from "../../../src/contracts/contas-ia.ts";
import { contasPelaCota, cotaDasContas, cotaDasIasComContas, cotaSegura, ENTRADA_DA_VOLTA_DA_COTA, fraseDaEsperaDaCota } from "../../../src/domain/cota-da-ia.ts";
import { contasDaPessoa, cotaDaContaNaLista, seguirComConta } from "../../../src/use-cases/contas-ia.ts";
import { lerContasDaMaquina } from "../../../src/use-cases/contas-do-turno.ts";
import { criarAgente } from "../../../src/use-cases/criar-agente.ts";
import { despacharTurno } from "../../../src/use-cases/despachar-turno.ts";
import { avisarFundoSeguradoPelaCota } from "../../../src/use-cases/fundo-segurado-pela-cota.ts";
import { definirInteligenciaDoBot } from "../../../src/use-cases/inteligencia.ts";
import { listarTrabalhos } from "../../../src/use-cases/trabalhos.ts";
import { entradaDoPedido, pedidoEmUmaLinha } from "../../../src/domain/delegacao.ts";
import { depsEmMemoria, executar, MARLON } from "../../helpers/deps-l6.ts";

/**
 * NOD-302 (continuação da NOD-253, passos 4 e 5): o fundo que a cota por conta segura ganha UMA nota "Seguir com…" na
 * conversa do bot e uma linha na conversa de quem pediu. O exemplo do Marlon: Claude · Pessoal (Max) no limite e
 * Claude · Lumen (Team corporativa) fora da fila (é a 2ª do Claude; NOD-308: nasce fora por isso, não por ser corporativa).
 */
const T0 = Date.parse("2026-10-16T12:00:00-03:00");
const HORA = 3_600_000;
const imp = (n: number) => n.toString(16).padStart(64, "0");
const anuncio = (n: number, ia: ContaAnunciada["ia"], apelido: string, o: Partial<ContaAnunciada> = {}): ContaAnunciada => ({ impressao: imp(n), ia, estado: "pronta", plano: "Max", corporativa: false, logadaEm: T0 - HORA, apelidoSugerido: apelido, ...o });
const PESSOA = { autor_tipo: "pessoa", autor_id: MARLON.pessoaId, sob_procuracao_de: null, conta_de_execucao: MARLON.pessoaId, executor: "local", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "pessoa", regra_versao: 1 } as const;

async function cenario(o: { modo?: "perguntar" | "automatico"; lumenCorporativa?: boolean; origem?: "rotina" | "delegacao"; comTask?: boolean } = {}) {
  const { deps, banco } = depsEmMemoria(MARLON, { relogio: () => T0 });
  const { data: bot } = await executar(deps, criarAgente, { dono: "pessoa", nome: "Ze 1" });
  const chave = await deps.repos.maquinaTokens.criar({ nome: "vm-bots", prefixo: "8f2a", hash: randomBytes(32) });
  const vm = chave!.id;
  await deps.repos.contasIa.doAnuncio(vm, [
    anuncio(1, "claude-cli", "Pessoal"),
    anuncio(2, "codex-cli", "Pessoal"),
    anuncio(3, "claude-cli", "Lumen", o.lumenCorporativa ? { plano: "Team", corporativa: true } : {}),
  ], T0);
  const [cPessoal, gPessoal, cLumen] = (await deps.repos.contasIa.listar()).contas;
  if (o.modo === "automatico") await deps.repos.contasIa.definirModo("automatico");
  await executar(deps, definirInteligenciaDoBot, { agenteId: bot.agente.id, pedido: { modo: "fixa", fixa: "claude-cli" } });
  const agente = (await deps.repos.agentes.buscar(bot.agente.id))!;
  const task = o.comTask ? await deps.repos.trabalhos.criar({ agenteId: bot.agente.id, conversaId: bot.conversa.id, titulo: "Revisar o #861", origem: "rotina", rotinaId: null, forma: "frente" }) : null;
  const t = (await deps.repos.turnos.enfileirar({ conversaId: bot.conversa.id, agenteId: bot.agente.id, origem: o.origem ?? "rotina", prazoEm: T0 + 86_400_000, profundidade: 0, entradaTexto: "revisa o #861", mensagemOrigemId: null, entradaConfianca: "confiavel", modelo: agente.modelo, harness: agente.harness, executor: "local", trabalhoId: task?.id ?? null }))!;
  /** A leitura da cota de uma conta (o que o turno dela trouxe). */
  const uso = (contaId: string, utilizacao: number, renovaEm: number) =>
    deps.repos.usoDoPlano.gravar({ harness: "claude-cli", situacao: "normal", cincoHoras: { utilizacao, renovaEm }, semana: null, medidoEm: T0 - 60_000 }, vm, contaId);
  /** A cota como o puxar da máquina a calcula (contas desta máquina). */
  const cota = async () => {
    const c = await lerContasDaMaquina(deps, vm);
    const preferencias = await deps.repos.preferencias.buscar();
    return cotaDasIasComContas({ usos: await deps.repos.usoDoPlano.listar(), usosPorConta: await deps.repos.usoDoPlano.listarPorConta(), limites: preferencias.iasNoLimite, contas: c, agora: T0 });
  };
  const entrada = async () => ({ machineId: vm, executor: "local" as const, harnessesProntos: ["claude-cli", "codex-cli"], cota: await cota() });
  const avisar = async () => avisarFundoSeguradoPelaCota(deps, await entrada());
  const despachar = async () => executar(deps, despacharTurno, { ...(await entrada()), inventario: { estado: "pronto", versao: "2.1.296", em: T0 } });
  const notas = () => banco.mensagens.filter((m) => m.payload?.kind === "limite_do_plano");
  return { deps, banco, vm, agenteId: bot.agente.id, conversaId: bot.conversa.id, turnoId: t.id, contas: { cPessoal: cPessoal!, gPessoal: gPessoal!, cLumen: cLumen! }, uso, cota, avisar, despachar, notas };
}

describe("o fundo que a cota por conta segura (NOD-302, CAs 3–6 da NOD-253)", () => {
  it("NOD-308: a Lumen corporativa ligada na fila recebe o fundo como qualquer conta — nada segura e não há nota", async () => {
    const c = await cenario({ modo: "automatico", lumenCorporativa: true });
    expect(await c.deps.repos.contasIa.definirTrocaAutomatica(c.contas.cLumen.id, true)).toBe(true);
    await c.uso(c.contas.cPessoal.id, 1, T0 + 2 * HORA);
    expect(await c.cota()).toEqual([]);
    const despacho = await c.despachar();
    expect(despacho.data).toMatchObject({ motivo: null, turno: { id: c.turnoId } });
    await c.avisar();
    expect(c.notas()).toHaveLength(0);
  });

  it("CA3: Team corporativa fora da fila (2ª do Claude) — o fundo fica segurado e a conversa ganha a nota com a Lumen para escolher", async () => {
    const c = await cenario({ modo: "automatico", lumenCorporativa: true });
    await c.uso(c.contas.cPessoal.id, 1, T0 + 2 * HORA);
    expect(await c.cota()).toMatchObject([{ ia: "claude-cli", situacao: "limite" }]);
    const despacho = await c.despachar();
    expect(despacho.data).toMatchObject({ plano: null, motivo: "fila_vazia" });
    await c.avisar();
    expect(c.notas()).toHaveLength(1);
    expect(c.notas()[0]).toMatchObject({ conversaId: c.conversaId, turnoId: c.turnoId });
    expect(c.notas()[0]?.payload).toMatchObject({ kind: "limite_do_plano", harness: "claude-cli", contas: { de: { id: c.contas.cPessoal.id }, livres: [{ id: c.contas.cLumen.id }] } });
    expect(c.notas()[0]?.texto).toMatch(/Claude · Pessoal/);
  });

  it("CA4: 'Perguntar antes' — três leituras seguidas da cota dão UMA nota", async () => {
    const c = await cenario();
    await c.uso(c.contas.cPessoal.id, 1, T0 + 2 * HORA);
    await c.avisar();
    await c.avisar();
    await c.avisar();
    expect(c.notas()).toHaveLength(1);
    expect(c.notas()[0]?.payload).toMatchObject({ contas: { livres: [{ id: c.contas.cLumen.id }] } });
  });

  it("CA5: 'Seguir com' com o turno ainda pendente grava a escolhida, fecha a nota e solta o fundo — sem refazer nada", async () => {
    const c = await cenario();
    await c.uso(c.contas.cPessoal.id, 1, T0 + 2 * HORA);
    await c.avisar();
    const { data } = await executar(c.deps, seguirComConta, { contaId: c.contas.cLumen.id, conversaId: c.conversaId });
    expect(data.turnoId).toBeNull();
    expect((await c.deps.repos.contasIa.modo()).escolhidas["claude-cli"]).toBe(c.contas.cLumen.id);
    expect(c.banco.mensagens.filter((m) => m.payload?.kind === "conta_escolhida")).toMatchObject([{ conversaId: c.conversaId, texto: "Seguindo com Claude · Lumen." }]);
    expect(c.banco.turnos).toHaveLength(1);
    // A cota passa a olhar a Lumen: o claude não segura mais e o próprio turno sai.
    expect(await c.cota()).toEqual([]);
    const despacho = await c.despachar();
    expect(despacho.data).toMatchObject({ motivo: null, turno: { id: c.turnoId } });
    // A nota fechada não volta.
    await c.avisar();
    expect(c.notas()).toHaveLength(1);
  });

  it("CA6: todas as contas da IA fixa no limite — nota com a hora da volta e sem oferecer o ChatGPT", async () => {
    const c = await cenario();
    await c.uso(c.contas.cPessoal.id, 1, T0 + 2 * HORA);
    await c.uso(c.contas.cLumen.id, 1, T0 + 3 * HORA);
    expect(await c.cota()).toMatchObject([{ ia: "claude-cli", situacao: "limite", voltaEm: T0 + 2 * HORA }]);
    await c.avisar();
    expect(c.notas()).toHaveLength(1);
    const nota = c.notas()[0]!;
    expect(nota.payload).toMatchObject({ kind: "limite_do_plano", harness: "claude-cli", voltaEm: T0 + 2 * HORA });
    const livres = nota.payload?.kind === "limite_do_plano" ? (nota.payload.contas?.livres ?? []) : [];
    expect(livres.some((l) => l.id === c.contas.gPessoal.id)).toBe(false);
    expect(nota.texto).toMatch(/14:00/);
    expect(nota.texto).not.toMatch(/ChatGPT/);
  });

  it("CA8: a reserva da conta (99%) segura só o fundo novo — o fundo que já começou segue", async () => {
    const c = await cenario({ comTask: true });
    await c.uso(c.contas.cPessoal.id, 0.995, T0 + 2 * HORA);
    await c.uso(c.contas.cLumen.id, 0.995, T0 + 3 * HORA);
    const porConta = cotaDasContas({ usos: await c.deps.repos.usoDoPlano.listarPorConta(), agora: T0 });
    expect(porConta.get(c.contas.cPessoal.id)?.situacao).toBe("reserva");
    expect(cotaSegura("fundo_novo", "reserva")).toBe(true);
    expect(cotaSegura("fundo_seguindo", "reserva")).toBe(false);
    const contas = (await c.deps.repos.contasIa.listar()).contas;
    expect(contasPelaCota(contas, porConta, "fundo_novo").find((x) => x.id === c.contas.cPessoal.id)?.noLimiteAte).toBe(T0 + 2 * HORA);
    expect(contasPelaCota(contas, porConta, "fundo_seguindo").find((x) => x.id === c.contas.cPessoal.id)?.noLimiteAte).toBeNull();
    expect(await c.cota()).toMatchObject([{ ia: "claude-cli", situacao: "reserva" }]);
    // A task ainda não começou: fundo novo, segurado (e avisado).
    expect((await c.despachar()).data).toMatchObject({ plano: null, motivo: "fila_vazia" });
    await c.avisar();
    expect(c.notas()).toHaveLength(1);
    // A task já começou: fundo seguindo, a reserva não a segura.
    const t = c.banco.turnos[0]!;
    const trabalho = c.banco.trabalhos.find((x) => x.id === t.trabalhoId)!;
    trabalho.iniciadoEm = T0 - HORA;
    expect((await c.despachar()).data).toMatchObject({ motivo: null, turno: { id: c.turnoId } });
  });
});

describe("a linha para quem pediu (NOD-302, CA10 da NOD-253)", () => {
  it("o pedido de colega sem task segurado ganha UMA linha na conversa de origem, com a espera e a hora", async () => {
    const c = await cenario({ origem: "delegacao" });
    const { data: ada } = await executar(c.deps, criarAgente, { dono: "pessoa", nome: "Ada" });
    await c.deps.repos.mensagens.criar({ conversaId: c.conversaId, turnoId: c.turnoId, autoria: PESSOA, kind: "texto", texto: "revisa o #861", payload: { kind: "peer_pedido", conversaOrigemId: ada.conversa.id, turnoOrigemId: "t-origem" }, confianca: "confiavel" });
    await c.uso(c.contas.cPessoal.id, 1, T0 + 2 * HORA);
    await c.uso(c.contas.cLumen.id, 1, T0 + 2 * HORA);
    await c.avisar();
    await c.avisar();
    const linhas = c.banco.mensagens.filter((m) => m.payload?.kind === "pedido_na_fila_da_cota");
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ conversaId: ada.conversa.id, kind: "sistema", payload: { turnoId: c.turnoId, agenteId: c.agenteId, ia: "claude-cli", voltaEm: T0 + 2 * HORA } });
    expect(linhas[0]?.texto).toBe("Pedido para Ze 1 na fila: a cota do Claude Code chegou ao limite; o pedido espera na fila até ela renovar, às 14:00.");
  });

  it("a conversa de origem de outro dono não ganha a linha (nada vaza entre pessoas)", async () => {
    const c = await cenario({ origem: "delegacao" });
    const { data: ada } = await executar(c.deps, criarAgente, { dono: "pessoa", nome: "Ada" });
    await c.deps.repos.mensagens.criar({ conversaId: c.conversaId, turnoId: c.turnoId, autoria: PESSOA, kind: "texto", texto: "revisa o #861", payload: { kind: "peer_pedido", conversaOrigemId: ada.conversa.id, turnoOrigemId: "t-origem" }, confianca: "confiavel" });
    c.banco.conversas.find((x) => x.id === ada.conversa.id)!.ownerId = "outra-pessoa";
    await c.uso(c.contas.cPessoal.id, 1, T0 + 2 * HORA);
    await c.uso(c.contas.cLumen.id, 1, T0 + 2 * HORA);
    await c.avisar();
    expect(c.banco.mensagens.some((m) => m.payload?.kind === "pedido_na_fila_da_cota")).toBe(false);
  });

  it("o pedido com task não ganha a linha (a task mostra a espera em Trabalhos)", async () => {
    const c = await cenario({ origem: "delegacao", comTask: true });
    await c.uso(c.contas.cPessoal.id, 1, T0 + 2 * HORA);
    await c.avisar();
    expect(c.banco.mensagens.some((m) => m.payload?.kind === "pedido_na_fila_da_cota")).toBe(false);
  });
});

describe("Trabalhos: o pedido sem task \"na fila (cota)\" (NOD-302, CA11 da NOD-253)", () => {
  it("GET trabalhos manda à parte o pedido de colega sem task que a cota segura, com quem pediu, o pedido e a volta", async () => {
    const c = await cenario({ origem: "delegacao" });
    const t = c.banco.turnos.find((x) => x.id === c.turnoId)!;
    t.entradaTexto = entradaDoPedido({ pessoaNome: "Marlon", remetenteNome: "Ada", pedidos: [], pedido: "Revise o PR 42." });
    expect((await executar(c.deps, listarTrabalhos, {})).data.pedidosNaFila).toEqual([]);
    await c.uso(c.contas.cPessoal.id, 1, T0 + 2 * HORA);
    await c.uso(c.contas.cLumen.id, 0.995, T0 + 3 * HORA);
    // "Perguntar antes": a Pessoal no limite e nenhuma escolhida — o Claude segura todo o fundo até a Pessoal renovar.
    const { data } = await executar(c.deps, listarTrabalhos, {});
    expect(data.pedidosNaFila).toEqual([{ turnoId: c.turnoId, agenteId: c.agenteId, de: "Ada", pedido: "Revise o PR 42.", ia: "claude-cli", situacao: "limite", voltaEm: T0 + 2 * HORA, criadoEm: t.criadoEm }]);
    expect(data.trabalhos).toEqual([]);
  });

  it("o pedido em uma linha: quem pediu e o pedido; outro formato, a primeira linha", () => {
    expect(pedidoEmUmaLinha(entradaDoPedido({ pessoaNome: "Marlon", remetenteNome: "Ada", pedidos: ["oi"], pedido: "Revise o PR 42.", contexto: "urgente" }))).toEqual({ de: "Ada", pedido: "Revise o PR 42." });
    expect(pedidoEmUmaLinha("\nrevisa o #861\nmais")).toEqual({ de: null, pedido: "revisa o #861" });
    expect(pedidoEmUmaLinha("x".repeat(200)).pedido).toHaveLength(120);
  });
});

describe("a cota de cada conta na lista de contas (NOD-302, CA12 da NOD-253)", () => {
  it("CA12: GET contas-ia devolve, por conta, as janelas vigentes, a situação e a volta; sem leitura, null", async () => {
    const c = await cenario();
    await c.uso(c.contas.cPessoal.id, 1, T0 + 2 * HORA);
    // A Lumen leu 99,5% (reserva) numa janela vigente; uma janela que já renovou não aparece.
    await c.deps.repos.usoDoPlano.gravar({ harness: "claude-cli", situacao: "perto", cincoHoras: { utilizacao: 0.995, renovaEm: T0 + 3 * HORA }, semana: { utilizacao: 0.4, renovaEm: T0 - HORA }, medidoEm: T0 - 30_000 }, c.vm, c.contas.cLumen.id);
    const { contas } = await contasDaPessoa(c.deps);
    const por = new Map(contas.map((k) => [k.id, k.cota]));
    expect(por.get(c.contas.cPessoal.id)).toMatchObject({ cincoHoras: { utilizacao: 1, renovaEm: T0 + 2 * HORA }, semana: null, situacao: "limite", voltaEm: T0 + 2 * HORA, medidoEm: T0 - 60_000 });
    // NOD-12: a semana que já renovou sai das janelas, mas a tela sabe quando renovou; e a máquina que mediu vem junto.
    expect(por.get(c.contas.cLumen.id)).toEqual({ cincoHoras: { utilizacao: 0.995, renovaEm: T0 + 3 * HORA }, semana: null, situacao: "reserva", voltaEm: T0 + 3 * HORA, medidoEm: T0 - 30_000, maquinaId: c.vm, renovou: { cincoHoras: null, semana: T0 - HORA } });
    expect(por.get(c.contas.gPessoal.id)).toBeNull();
  });
});

describe("QA do PR #369 (regressões do passo 4)", () => {
  it("'Seguir com' na nota do fundo segurado também antecipa as esperas da cota da IA escolhida (como o 'Seguir com' do limite)", async () => {
    const c = await cenario();
    await c.uso(c.contas.cPessoal.id, 1, T0 + 2 * HORA);
    await c.avisar();
    // Outro bot tem uma volta da cota do Claude marcada para a renovação.
    const { data: outro } = await executar(c.deps, criarAgente, { dono: "pessoa", nome: "Ze 2" });
    const ag = (await c.deps.repos.agentes.buscar(outro.agente.id))!;
    const espera = (await c.deps.repos.turnos.enfileirar({ conversaId: outro.conversa.id, agenteId: outro.agente.id, origem: "retomada", prazoEm: T0 + 86_400_000, profundidade: 0, entradaTexto: `${ENTRADA_DA_VOLTA_DA_COTA}Claude Code renovou.`, mensagemOrigemId: null, entradaConfianca: "confiavel", modelo: ag.modelo, harness: "claude-cli", executor: "local", trabalhoId: null }))!;
    c.banco.turnos.find((t) => t.id === espera.id)!.acordarEm = T0 + 2 * HORA;
    await executar(c.deps, seguirComConta, { contaId: c.contas.cLumen.id, conversaId: c.conversaId });
    expect(c.banco.turnos.find((t) => t.id === espera.id)?.acordarEm ?? null).toBeNull();
  });

  it("o segundo clique em 'Seguir com' (nota já fechada) não repete a linha 'Seguindo com'", async () => {
    const c = await cenario();
    await c.uso(c.contas.cPessoal.id, 1, T0 + 2 * HORA);
    await c.avisar();
    await executar(c.deps, seguirComConta, { contaId: c.contas.cLumen.id, conversaId: c.conversaId });
    await executar(c.deps, seguirComConta, { contaId: c.contas.cLumen.id, conversaId: c.conversaId });
    expect(c.banco.mensagens.filter((m) => m.payload?.kind === "conta_escolhida")).toHaveLength(1);
  });

  it("merge da main (#329/NOD-284): o botão com o turnoId da nota (como a web manda) também solta o fundo pendente — uma linha, sem refazer, sem motivo", async () => {
    const c = await cenario();
    await c.uso(c.contas.cPessoal.id, 1, T0 + 2 * HORA);
    await c.avisar();
    expect(c.notas()[0]).toMatchObject({ turnoId: c.turnoId });
    const um = await executar(c.deps, seguirComConta, { contaId: c.contas.cLumen.id, conversaId: c.conversaId, turnoId: c.turnoId });
    const dois = await executar(c.deps, seguirComConta, { contaId: c.contas.cLumen.id, conversaId: c.conversaId, turnoId: c.turnoId });
    expect(um.data).toEqual({ turnoId: null, motivo: null });
    expect(dois.data).toEqual({ turnoId: null, motivo: null });
    expect((await c.deps.repos.contasIa.modo()).escolhidas["claude-cli"]).toBe(c.contas.cLumen.id);
    expect(c.banco.mensagens.filter((m) => m.payload?.kind === "conta_escolhida")).toMatchObject([{ conversaId: c.conversaId, turnoId: c.turnoId, texto: "Seguindo com Claude · Lumen." }]);
    expect(c.banco.turnos).toHaveLength(1);
    const despacho = await c.despachar();
    expect(despacho.data).toMatchObject({ motivo: null, turno: { id: c.turnoId } });
  });

  it("merge da main (#329/NOD-224): conta de outra IA no 'Seguir com' do fundo pendente é recusada antes de gravar", async () => {
    const c = await cenario();
    await c.uso(c.contas.cPessoal.id, 1, T0 + 2 * HORA);
    await c.avisar();
    const r = await executar(c.deps, seguirComConta, { contaId: c.contas.gPessoal.id, conversaId: c.conversaId, turnoId: c.turnoId });
    expect(r.data).toEqual({ turnoId: null, motivo: "conta_de_outra_ia" });
    expect((await c.deps.repos.contasIa.modo()).escolhidas["codex-cli"] ?? null).toBeNull();
    expect(c.banco.mensagens.filter((m) => m.payload?.kind === "conta_escolhida")).toHaveLength(0);
  });

  it("re-QA @20f233f: conta da MESMA IA no limite no 'Seguir com' do fundo pendente é recusada antes de gravar (não promete o que o portão segura)", async () => {
    const c = await cenario();
    await c.uso(c.contas.cPessoal.id, 1, T0 + 2 * HORA);
    await c.avisar();
    await c.deps.repos.contasIa.marcarLimite(c.contas.cLumen.id, T0 + HORA);
    const r = await executar(c.deps, seguirComConta, { contaId: c.contas.cLumen.id, conversaId: c.conversaId, turnoId: c.turnoId });
    expect(r.data).toEqual({ turnoId: null, motivo: "conta_no_limite" });
    expect((await c.deps.repos.contasIa.modo()).escolhidas["claude-cli"] ?? null).toBeNull();
    expect(c.banco.mensagens.filter((m) => m.payload?.kind === "conta_escolhida")).toHaveLength(0);
  });

  it("re-QA @20f233f: 'Seguir com' no fundo pendente fecha o aviso troca_de_ia aberto do bot (ADR-108), como o 'Seguir com' do limite", async () => {
    const c = await cenario();
    await c.uso(c.contas.cPessoal.id, 1, T0 + 2 * HORA);
    await c.avisar();
    const { troca } = await c.deps.repos.trocasDeIa.abrir({ agenteId: c.agenteId, conversaId: c.conversaId, iaDe: "claude-cli", iaPara: null, recomendacao: "esperar", voltaEm: T0 + 2 * HORA, aplicarEm: null, fixo: true, machineId: c.vm, agora: T0 });
    const r = await executar(c.deps, seguirComConta, { contaId: c.contas.cLumen.id, conversaId: c.conversaId, turnoId: c.turnoId });
    expect(r.data).toEqual({ turnoId: null, motivo: null });
    expect(await c.deps.repos.trocasDeIa.buscar(troca.id)).toMatchObject({ decisao: "conta", decididoEm: T0 });
    expect(r.events).toContainEqual(expect.objectContaining({ kind: "agente_atualizado" }));
  });

  it("re-QA @20f233f: com dois pendentes, o clique com o turnoId do que NÃO tem a nota grava a escolhida mas não escreve a linha (a nota do outro segue aberta)", async () => {
    const c = await cenario();
    const ag = (await c.deps.repos.agentes.buscar(c.agenteId))!;
    const novo = (await c.deps.repos.turnos.enfileirar({ conversaId: c.conversaId, agenteId: c.agenteId, origem: "rotina", prazoEm: T0 + 86_400_000, profundidade: 0, entradaTexto: "outra coisa", mensagemOrigemId: null, entradaConfianca: "confiavel", modelo: ag.modelo, harness: ag.harness, executor: "local", trabalhoId: null }))!;
    c.banco.turnos.find((t) => t.id === c.turnoId)!.criadoEm = T0 - 1;
    c.banco.turnos.find((t) => t.id === novo.id)!.criadoEm = T0;
    await c.uso(c.contas.cPessoal.id, 1, T0 + 2 * HORA);
    await c.avisar();
    expect(c.notas()[0]?.turnoId).toBe(c.turnoId);
    const r = await executar(c.deps, seguirComConta, { contaId: c.contas.cLumen.id, conversaId: c.conversaId, turnoId: novo.id });
    expect(r.data).toEqual({ turnoId: null, motivo: null });
    expect((await c.deps.repos.contasIa.modo()).escolhidas["claude-cli"]).toBe(c.contas.cLumen.id);
    expect(c.banco.mensagens.filter((m) => m.payload?.kind === "conta_escolhida")).toHaveLength(0);
  });

  it("re-QA @20f233f: numa sala, a nota aberta de OUTRO bot depois da deste não tira a linha 'Seguindo com' deste bot (NOD-284)", async () => {
    const c = await cenario();
    await c.uso(c.contas.cPessoal.id, 1, T0 + 2 * HORA);
    await c.avisar();
    const minha = c.notas()[0]!;
    const { data: outro } = await executar(c.deps, criarAgente, { dono: "pessoa", nome: "Ze 2" });
    c.banco.mensagens.push({ ...minha, id: crypto.randomUUID(), turnoId: crypto.randomUUID(), autoria: { ...minha.autoria, autor_id: outro.agente.id }, criadoEm: minha.criadoEm + 1 });
    const r = await executar(c.deps, seguirComConta, { contaId: c.contas.cLumen.id, conversaId: c.conversaId, turnoId: c.turnoId });
    expect(r.data).toEqual({ turnoId: null, motivo: null });
    expect(c.banco.mensagens.filter((m) => m.payload?.kind === "conta_escolhida")).toMatchObject([{ turnoId: c.turnoId, texto: "Seguindo com Claude · Lumen." }]);
  });

  it("dois turnos segurados do mesmo bot: a nota única aponta para o mais antigo (o primeiro a sair)", async () => {
    const c = await cenario();
    const ag = (await c.deps.repos.agentes.buscar(c.agenteId))!;
    const novo = (await c.deps.repos.turnos.enfileirar({ conversaId: c.conversaId, agenteId: c.agenteId, origem: "rotina", prazoEm: T0 + 86_400_000, profundidade: 0, entradaTexto: "outra coisa", mensagemOrigemId: null, entradaConfianca: "confiavel", modelo: ag.modelo, harness: ag.harness, executor: "local", trabalhoId: null }))!;
    c.banco.turnos.find((t) => t.id === c.turnoId)!.criadoEm = T0 - 1;
    c.banco.turnos.find((t) => t.id === novo.id)!.criadoEm = T0;
    await c.uso(c.contas.cPessoal.id, 1, T0 + 2 * HORA);
    await c.avisar();
    expect(c.notas()).toHaveLength(1);
    expect(c.notas()[0]?.turnoId).toBe(c.turnoId);
  });
});

describe("QA do PR #369 (regressões do passo 5)", () => {
  const pedidoDaAda = async (c: Awaited<ReturnType<typeof cenario>>) => {
    const { data: ada } = await executar(c.deps, criarAgente, { dono: "pessoa", nome: "Ada" });
    await c.deps.repos.mensagens.criar({ conversaId: c.conversaId, turnoId: c.turnoId, autoria: PESSOA, kind: "texto", texto: "revisa o #861", payload: { kind: "peer_pedido", conversaOrigemId: ada.conversa.id, turnoOrigemId: "t-origem" }, confianca: "confiavel" });
    return ada;
  };

  it("o pedido de colega COM task (e com o peer_pedido) não ganha a linha", async () => {
    const c = await cenario({ origem: "delegacao", comTask: true });
    await pedidoDaAda(c);
    await c.uso(c.contas.cPessoal.id, 1, T0 + 2 * HORA);
    await c.uso(c.contas.cLumen.id, 1, T0 + 2 * HORA);
    await c.avisar();
    expect(c.banco.mensagens.some((m) => m.payload?.kind === "pedido_na_fila_da_cota")).toBe(false);
  });

  it("Automático com as duas IAs seguradas: a linha dá a volta da que renova PRIMEIRO", async () => {
    const c = await cenario({ origem: "delegacao" });
    await pedidoDaAda(c);
    const t = c.banco.turnos.find((x) => x.id === c.turnoId)!;
    t.harness = "auto";
    t.modelo = "auto";
    await c.uso(c.contas.cPessoal.id, 1, T0 + 3 * HORA);
    await c.uso(c.contas.cLumen.id, 1, T0 + 3 * HORA);
    await c.deps.repos.usoDoPlano.gravar({ harness: "codex-cli", situacao: "normal", cincoHoras: { utilizacao: 1, renovaEm: T0 + HORA }, semana: null, medidoEm: T0 - 60_000 }, c.vm, c.contas.gPessoal.id);
    await c.avisar();
    const linhas = c.banco.mensagens.filter((m) => m.payload?.kind === "pedido_na_fila_da_cota");
    expect(linhas).toHaveLength(1);
    expect(linhas[0]?.payload).toMatchObject({ voltaEm: T0 + HORA });
    expect(linhas[0]?.texto).toMatch(/13:00/);
  });

  it("a frase da espera não promete uma hora que já passou", () => {
    expect(fraseDaEsperaDaCota({ ia: "claude-cli", situacao: "limite", voltaEm: T0 - 60_000, agora: T0 })).toBe("a cota do Claude Code chegou ao limite; o pedido espera na fila até ela renovar");
    expect(fraseDaEsperaDaCota({ ia: "claude-cli", situacao: "limite", voltaEm: T0, agora: T0 })).not.toMatch(/\d\d:\d\d/);
    expect(fraseDaEsperaDaCota({ ia: "claude-cli", situacao: "limite", voltaEm: null, agora: T0 })).not.toMatch(/\d\d:\d\d/);
  });
});

describe("QA do PR #369 (regressões do passo 6)", () => {
  const pedidoNaFila = async () => {
    const c = await cenario({ origem: "delegacao" });
    c.banco.turnos.find((x) => x.id === c.turnoId)!.entradaTexto = entradaDoPedido({ pessoaNome: "Marlon", remetenteNome: "Ada", pedidos: [], pedido: "Revise o PR 42." });
    await c.uso(c.contas.cPessoal.id, 1, T0 + 2 * HORA);
    await c.uso(c.contas.cLumen.id, 1, T0 + 2 * HORA);
    return c;
  };

  it("o pedido do bot excluído não aparece \"na fila (cota)\"", async () => {
    const c = await pedidoNaFila();
    expect((await executar(c.deps, listarTrabalhos, {})).data.pedidosNaFila).toHaveLength(1);
    c.banco.agentes.find((a) => a.id === c.agenteId)!.excluidoEm = T0;
    expect((await executar(c.deps, listarTrabalhos, {})).data.pedidosNaFila).toEqual([]);
  });

  it("Trabalhos de UM bot só lista os pedidos na fila desse bot", async () => {
    const c = await pedidoNaFila();
    const { data: outro } = await executar(c.deps, criarAgente, { dono: "pessoa", nome: "Ze 2" });
    expect((await executar(c.deps, listarTrabalhos, { agenteId: c.agenteId })).data.pedidosNaFila).toHaveLength(1);
    expect((await executar(c.deps, listarTrabalhos, { agenteId: outro.agente.id })).data.pedidosNaFila).toEqual([]);
  });

  it("a cota da conta na lista usa a leitura MAIS NOVA da conta (duas máquinas leram)", () => {
    const velha = { harness: "claude-cli" as const, situacao: "normal" as const, cincoHoras: { utilizacao: 1, renovaEm: T0 + 2 * HORA }, semana: null, medidoEm: T0 - HORA, contaId: "k1" };
    const nova = { ...velha, cincoHoras: { utilizacao: 0.2, renovaEm: T0 + 4 * HORA }, medidoEm: T0 - 60_000 };
    for (const usos of [[velha, nova], [nova, velha]]) {
      expect(cotaDaContaNaLista(usos, T0).get("k1")).toMatchObject({ cincoHoras: { utilizacao: 0.2 }, situacao: "livre", voltaEm: null, medidoEm: T0 - 60_000 });
    }
  });
});
