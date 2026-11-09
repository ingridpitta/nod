import { describe, expect, it } from "vitest";
import { criarContasDoApp } from "../../../desktop/contas-no-app.ts";
import { contasIniciaisDoMac, type ContasDoMac } from "../../../desktop/contas-mac.ts";
import type { ResultadoTurno } from "../../../src/contracts/turno.ts";

/**
 * ADR-101 (2026-10-12, NOD-211): o controlador das contas no app do Mac, sem Electron — disco, logout e "a conta
 * mudou" são falsos. O Keychain real fica no roteiro manual do PR #286.
 */
const AGORA = 1_760_000_000_000;
const HORA = 3_600_000;
const BASE = "/u/contas";

function montar(inicial?: (c: ContasDoMac) => void) {
  const c = contasIniciaisDoMac();
  inicial?.(c);
  const gravados: ContasDoMac[] = [];
  const mudouConta: string[] = [];
  const removidos: string[] = [];
  const preparados: string[] = [];
  let ids = 0;
  const app = criarContasDoApp({
    base: BASE,
    padrao: (ia) => (ia === "claude-cli" ? "/h/.claude" : "/h/.codex"),
    ler: async () => structuredClone(c),
    gravar: async (x) => { gravados.push(structuredClone(x)); },
    preparar: async (ia, id) => { preparados.push(`${ia}/${id}`); },
    remover: async (ia, id) => { removidos.push(`${ia}/${id}`); return { logout: true }; },
    aoMudarConta: (ia) => { mudouConta.push(ia); },
    aoMudar: () => undefined,
    agora: () => AGORA,
    novoId: () => `c-${++ids}`,
  });
  return { app, gravados, mudouConta, removidos, preparados };
}

const tresContas = (c: ContasDoMac) => {
  c["claude-cli"].contas.push(
    { id: "lumen", apelido: "Lumen", plano: "team", entraNaTrocaAutomatica: false, noLimiteAte: null },
    { id: "reserva", apelido: "Reserva", plano: "pro", entraNaTrocaAutomatica: false, noLimiteAte: null },
  );
};

const limite = (extra: Partial<ResultadoTurno> = {}): ResultadoTurno => ({
  desfecho: "falha",
  motivoFalha: "limite_do_plano",
  limiteVoltaEm: AGORA + 2 * HORA,
  texto: "",
  sessaoCli: null,
  custoUsd: null,
  sinais: { attempted: true, rejected: false, promptSubmitted: true, producedOutput: false },
  tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 },
  ferramentasChamadas: [],
  negacoesPermissao: [],
  ...extra,
} as ResultadoTurno);
const espera = () => new Promise((r) => setTimeout(r, 0));

describe("aoResultado (a decisão no limite)", () => {
  it("uma conta só: nada muda (o limite de sempre)", async () => {
    const { app } = montar();
    await app.iniciar();
    expect(app.aoResultado("claude-cli", limite())).toBeUndefined();
  });

  it("Perguntar antes (padrão): anota as livres e não troca a conta dos turnos", async () => {
    const { app, mudouConta } = montar(tresContas);
    await app.iniciar();
    expect(app.ambienteDoTurno("claude-cli")).toEqual({});
    const r = app.aoResultado("claude-cli", limite());
    expect(r?.contaNoLimite).toEqual({ tipo: "perguntar", de: 1, livres: [2, 3], foraDaTroca: [], voltaEm: AGORA + 2 * HORA });
    await espera();
    // em "perguntar" nada é escolhido: a conta 1 fica no limite e o turno seguinte só muda depois de "Seguir com a conta N"
    expect(app.ambienteDoTurno("claude-cli")).toEqual({});
    expect(app.naTela("claude-cli").contas[0]?.noLimiteAte).toBe(AGORA + 2 * HORA);
    expect(mudouConta).toEqual(["claude-cli"]);
  });

  it("Trocar sozinho (NOD-308): a corporativa livre entra como qualquer conta; o turno seguinte já sai na conta 2", async () => {
    const { app, gravados } = montar((c) => { tresContas(c); c["claude-cli"].modo = "automatico"; });
    await app.iniciar();
    app.ambienteDoTurno("claude-cli"); app.registryRefeito(["claude-cli"]);
    const r = app.aoResultado("claude-cli", limite());
    expect(r?.contaNoLimite).toEqual({ tipo: "trocou", de: 1, para: 2, voltaEm: AGORA + 2 * HORA, foraDaTroca: [] });
    expect(app.ambienteDoTurno("claude-cli")).toEqual({ CLAUDE_CONFIG_DIR: `${BASE}/claude-cli/lumen` });
    await espera();
    expect(gravados.at(-1)?.["claude-cli"].escolhida).toBe("lumen");
  });

  it("o limite do Codex chega como erro com o texto do fornecedor e também decide", async () => {
    const { app } = montar((c) => { c["codex-cli"].contas.push({ id: "b", apelido: "B", plano: "plus", entraNaTrocaAutomatica: false, noLimiteAte: null }); });
    await app.iniciar();
    const r = app.aoResultado("codex-cli", limite({ motivoFalha: "erro_execucao", limiteVoltaEm: null, erroCru: "You've hit your usage limit. Try again later." }));
    expect(r?.contaNoLimite).toMatchObject({ tipo: "perguntar", de: 1, livres: [2] });
    expect(app.aoResultado("codex-cli", limite({ motivoFalha: "erro_execucao", erroCru: "falha qualquer" }))).toBeUndefined();
  });

  it("um turno bom tira do limite a conta que rodou, e só ela", async () => {
    const { app } = montar(tresContas);
    await app.iniciar();
    app.ambienteDoTurno("claude-cli"); app.registryRefeito(["claude-cli"]);
    app.aoResultado("claude-cli", limite());
    await espera();
    const sucesso = { ...limite(), desfecho: "sucesso", motivoFalha: undefined } as ResultadoTurno;
    await app.usar("claude-cli", 2);
    app.ambienteDoTurno("claude-cli"); app.registryRefeito(["claude-cli"]);
    app.aoResultado("claude-cli", sucesso);
    await espera();
    expect(app.naTela("claude-cli").contas[0]?.noLimiteAte).toBe(AGORA + 2 * HORA);
    // a pessoa volta à conta 1 e o turno dá certo: ela sai do limite antes do prazo
    await app.usar("claude-cli", 1);
    expect(app.naTela("claude-cli").contas[0]?.noLimiteAte).toBeNull();
  });
});

describe("a lista na tela e as escolhas da pessoa", () => {
  it("a corporativa aparece com o selo e já entra na troca (NOD-308); o opt-in antigo segue aceito por compat", async () => {
    const { app } = montar(tresContas);
    await app.iniciar();
    let tela = app.naTela("claude-cli");
    expect(tela.modo).toBe("perguntar");
    expect(tela.contas.map((c) => [c.posicao, c.corporativa, c.entraNaTroca, c.emUso])).toEqual([[1, false, true, true], [2, true, true, false], [3, false, true, false]]);
    tela = await app.definirTrocaAutomatica("claude-cli", 2, true);
    expect(tela.contas[1]).toMatchObject({ entraNaTrocaAutomatica: true, entraNaTroca: true });
    expect((await app.definirTrocaAutomatica("claude-cli", 2, "sim")).contas[1]?.entraNaTrocaAutomatica).toBe(true);
  });

  it("modo, apelido e ordem; valor ruim não muda nada", async () => {
    const { app } = montar(tresContas);
    await app.iniciar();
    expect((await app.definirModo("claude-cli", "automatico")).modo).toBe("automatico");
    expect((await app.definirModo("claude-cli", "x")).modo).toBe("automatico");
    expect((await app.renomear("claude-cli", 3, "  Pessoal 2 ")).contas[2]?.apelido).toBe("Pessoal 2");
    const movida = await app.mover("claude-cli", 3, 1);
    expect([movida.contas[0]?.apelido, movida.contas[2]?.apelido]).toEqual(["Pessoal 2", "Lumen"]);
    expect(app.ambienteDoTurno("claude-cli")).toEqual({ CLAUDE_CONFIG_DIR: `${BASE}/claude-cli/reserva` });
    expect((await app.mover("claude-cli", 1, 9)).contas.map((c) => c.apelido)).toEqual(movida.contas.map((c) => c.apelido));
  });

  it("Seguir com a conta 2 (corporativa) muda o ambiente dos turnos e avisa a vigia", async () => {
    const { app, mudouConta } = montar(tresContas);
    await app.iniciar();
    app.ambienteDoTurno("claude-cli"); app.registryRefeito(["claude-cli"]);
    app.aoResultado("claude-cli", limite());
    await espera();
    expect((await app.usar("claude-cli", 2))?.contas[1]?.emUso).toBe(true);
    expect(app.ambienteDoTurno("claude-cli")).toEqual({ CLAUDE_CONFIG_DIR: `${BASE}/claude-cli/lumen` });
    expect(mudouConta).toEqual(["claude-cli", "claude-cli"]);
    expect(await app.usar("claude-cli", 9)).toBeNull();
  });

  it("remover faz o logout da conta; a conta 1 é recusada", async () => {
    const { app, removidos } = montar(tresContas);
    await app.iniciar();
    expect((await app.remover("claude-cli", 1)).logout).toBe(false);
    const r = await app.remover("claude-cli", 2);
    expect(r.logout).toBe(true);
    expect(removidos).toEqual(["claude-cli/lumen"]);
    expect(r.contas.contas.map((c) => c.posicao)).toEqual([1, 2]);
    expect(r.contas.contas[1]?.apelido).toBe("Reserva");
  });
});

describe("adicionar uma conta", () => {
  it("o login roda na pasta nova enquanto os turnos seguem na conta em uso; ao concluir entra no fim e na troca (NOD-308)", async () => {
    const { app, preparados } = montar();
    await app.iniciar();
    expect(await app.comecarAdicao("claude-cli", "Lumen")).toBe(true);
    expect(await app.comecarAdicao("claude-cli", "outra")).toBe(false);
    expect(preparados).toEqual(["claude-cli/c-1"]);
    expect(app.ambienteDoLogin("claude-cli")).toEqual({ CLAUDE_CONFIG_DIR: `${BASE}/claude-cli/c-1` });
    expect(app.ambienteDoTurno("claude-cli")).toEqual({});
    expect(app.naTela("claude-cli").adicionando).toEqual({ apelido: "Lumen" });
    // QA do NOD-211: a releitura do cartão durante a adição segue na conta em uso, não na pasta nova
    expect(app.ambienteDaContaEmUso("claude-cli")).toEqual({});
    await app.concluirAdicao("claude-cli", { email: "x@exemplo.com", organizacao: "Lumen", plano: "Team" } as never);
    const tela = app.naTela("claude-cli");
    expect(tela.adicionando).toBeNull();
    expect(tela.contas[1]).toMatchObject({ posicao: 2, apelido: "Lumen", plano: "team", corporativa: true, entraNaTrocaAutomatica: false, entraNaTroca: true });
    expect(app.ambienteDoLogin("claude-cli")).toEqual({});
  });

  it("sem apelido usa a organização; login que falha apaga a pasta e nada entra", async () => {
    const { app, removidos } = montar();
    await app.iniciar();
    await app.comecarAdicao("codex-cli", "");
    await app.cancelarAdicao("codex-cli");
    expect(removidos).toEqual(["codex-cli/c-1"]);
    expect(app.naTela("codex-cli").contas).toHaveLength(1);
    await app.comecarAdicao("codex-cli", "");
    await app.concluirAdicao("codex-cli", { organizacao: "Acme", plano: "plus" } as never);
    expect(app.naTela("codex-cli").contas[1]).toMatchObject({ apelido: "Acme", corporativa: false, entraNaTroca: true });
  });

  it("conta 1 corporativa mostra o selo e entra na troca (NOD-308); conta 1 sem plano lido não ganha selo (v4)", async () => {
    const { app } = montar();
    await app.iniciar();
    expect(app.naTela("claude-cli").contas[0]).toMatchObject({ posicao: 1, corporativa: false });
    const { app: corp } = montar((c) => { (c["claude-cli"].contas[0] as { plano: string | null }).plano = "team"; });
    await corp.iniciar();
    expect(corp.naTela("claude-cli").contas[0]).toMatchObject({ posicao: 1, corporativa: true, entraNaTrocaAutomatica: false, entraNaTroca: true });
  });

  // QA do NOD-211 (2026-10-12): a adição que falhava voltava calada ao "+ Adicionar outra conta" — sem erro nem "Tentar de novo".
  it("login que falha ou expira deixa o erro na tela com o apelido; cancelar pela pessoa não; adicionar de novo ou fechar limpa", async () => {
    const { app } = montar();
    await app.iniciar();
    await app.comecarAdicao("claude-cli", "Lumen");
    await app.cancelarAdicao("claude-cli", { falhou: true });
    expect(app.naTela("claude-cli")).toMatchObject({ adicionando: null, adicaoFalhou: { apelido: "Lumen" } });
    expect(app.naTela("claude-cli").contas).toHaveLength(1);
    await app.comecarAdicao("claude-cli", "Lumen");
    expect(app.naTela("claude-cli").adicaoFalhou).toBeNull();
    await app.cancelarAdicao("claude-cli");
    expect(app.naTela("claude-cli").adicaoFalhou).toBeNull();
    await app.comecarAdicao("claude-cli", "");
    await app.cancelarAdicao("claude-cli", { falhou: true });
    expect((await app.fecharFalha("claude-cli")).adicaoFalhou).toBeNull();
  });

  it("no máximo de contas não começa", async () => {
    const { app } = montar((c) => {
      for (let i = 0; i < 5; i++) c["claude-cli"].contas.push({ id: `x-${i}`, apelido: `X${i}`, plano: "pro", entraNaTrocaAutomatica: false, noLimiteAte: null });
    });
    await app.iniciar();
    expect(app.naTela("claude-cli").contas).toHaveLength(app.naTela("claude-cli").max);
    expect(await app.comecarAdicao("claude-cli", "mais")).toBe(false);
  });
});

/**
 * QA do NOD-211 (2026-10-12): a conta 1 renovou e os turnos seguiam na conta 2 — com as IAs prontas a vigia não sonda de
 * novo, e o registry só muda com `aoMudarConta`. Agora um timer confere na hora da volta.
 */
describe("a conta 1 volta sozinha quando renova", () => {
  function comRelogio() {
    let agora = AGORA;
    const timers: { fn: () => void; em: number; cancelado: boolean }[] = [];
    const c = contasIniciaisDoMac();
    c["claude-cli"].contas.push({ id: "reserva", apelido: "Reserva", plano: "pro", entraNaTrocaAutomatica: false, noLimiteAte: null });
    const mudouConta: string[] = [];
    const app = criarContasDoApp({
      base: BASE, padrao: () => "/h/.claude", ler: async () => structuredClone(c), gravar: async () => undefined, preparar: async () => undefined,
      remover: async () => ({ logout: true }), aoMudarConta: (ia) => { mudouConta.push(ia); }, aoMudar: () => undefined, agora: () => agora,
      agendar: (fn, ms) => { const t = { fn, em: agora + ms, cancelado: false }; timers.push(t); return { cancelar: () => { t.cancelado = true; } }; },
    });
    const avancar = async (ms: number) => {
      agora += ms;
      for (const t of timers.filter((x) => !x.cancelado && x.em <= agora)) { t.cancelado = true; t.fn(); }
      await espera();
    };
    return { app, mudouConta, avancar, timers };
  }

  it("Seguir com a conta 2 e, passado o limite da conta 1, o registry é refeito na conta 1", async () => {
    const { app, mudouConta, avancar } = comRelogio();
    await app.iniciar();
    app.ambienteDoTurno("claude-cli"); app.registryRefeito(["claude-cli"]);
    app.aoResultado("claude-cli", limite({ limiteVoltaEm: AGORA + HORA }));
    await app.usar("claude-cli", 2);
    expect(app.ambienteDoTurno("claude-cli")).toEqual({ CLAUDE_CONFIG_DIR: `${BASE}/claude-cli/reserva` });
    app.registryRefeito(["claude-cli"]); // a sondagem que o usar pediu refez o driver na conta 2
    const antes = mudouConta.length;
    await avancar(HORA - 1_000);
    expect(mudouConta.length, "antes da volta nada muda").toBe(antes);
    await avancar(2_000);
    expect(mudouConta.slice(antes)).toEqual(["claude-cli"]);
    expect(app.naTela("claude-cli").contas.find((x) => x.emUso)?.posicao).toBe(1);
    expect(app.ambienteDoTurno("claude-cli")).toEqual({});
  });

  it("Trocar sozinho também volta; sem conta no limite não fica timer", async () => {
    const { app, mudouConta, avancar, timers } = comRelogio();
    await app.iniciar();
    expect(timers).toHaveLength(0);
    await app.definirModo("claude-cli", "automatico");
    app.ambienteDoTurno("claude-cli"); app.registryRefeito(["claude-cli"]);
    expect(app.aoResultado("claude-cli", limite({ limiteVoltaEm: AGORA + HORA }))?.contaNoLimite).toMatchObject({ tipo: "trocou", para: 2 });
    await espera();
    app.ambienteDoTurno("claude-cli"); app.registryRefeito(["claude-cli"]);
    const antes = mudouConta.length;
    await avancar(HORA + 1);
    expect(mudouConta.slice(antes)).toEqual(["claude-cli"]);
    expect(timers.filter((t) => !t.cancelado)).toHaveLength(0);
  });
});

// QA do NOD-211 (2026-10-12): o turno repetido depois do "trocou" saía no driver da conta antiga (o registry só muda
// quando a vigia sonda de novo), batia no limite outra vez e a conversa enchia de "Seguindo com a conta N".
describe("o trocou espera o registry novo antes da entrega", () => {
  function comSondagem() {
    const c = contasIniciaisDoMac();
    tresContas(c);
    c["claude-cli"].modo = "automatico";
    const timers: { fn: () => void; ms: number; cancelado: boolean }[] = [];
    let soltar: () => void = () => undefined;
    const app = criarContasDoApp({
      base: BASE, padrao: () => "/h/.claude", ler: async () => structuredClone(c), gravar: async () => undefined, preparar: async () => undefined,
      remover: async () => ({ logout: true }), aoMudar: () => undefined, agora: () => AGORA,
      aoMudarConta: () => new Promise<void>((ok) => { soltar = ok; }),
      agendar: (fn, ms) => { const t = { fn, ms, cancelado: false }; timers.push(t); return { cancelar: () => { t.cancelado = true; } }; },
    });
    return { app, timers, soltar: () => soltar() };
  }

  it("esperarTroca só resolve quando a sondagem da conta nova termina", async () => {
    const { app, soltar, timers } = comSondagem();
    await app.iniciar();
    app.ambienteDoTurno("claude-cli"); app.registryRefeito(["claude-cli"]);
    expect(app.aoResultado("claude-cli", limite())?.contaNoLimite).toMatchObject({ tipo: "trocou", para: 2 });
    let pronto = false;
    const espera1 = app.esperarTroca("claude-cli").then(() => { pronto = true; });
    await espera(); await espera();
    expect(pronto, "o registry ainda não foi refeito").toBe(false);
    soltar();
    await espera1;
    expect(pronto).toBe(true);
    expect(timers.filter((t) => t.ms === 30_000).every((t) => t.cancelado), "o teto é cancelado").toBe(true);
    // sem troca pendente, não espera nada
    await app.esperarTroca("claude-cli");
    await app.esperarTroca("codex-cli");
  });

  it("a sondagem travou: passado o teto, entrega do mesmo jeito", async () => {
    const { app, timers } = comSondagem();
    await app.iniciar();
    app.ambienteDoTurno("claude-cli"); app.registryRefeito(["claude-cli"]);
    app.aoResultado("claude-cli", limite());
    let pronto = false;
    const espera1 = app.esperarTroca("claude-cli", 30_000).then(() => { pronto = true; });
    await espera(); await espera();
    expect(pronto).toBe(false);
    timers.find((t) => t.ms === 30_000 && !t.cancelado)?.fn();
    await espera1;
    expect(pronto).toBe(true);
  });
});

// QA do NOD-211 (2026-10-12): a config é montada para as duas IAs, mas a sondagem pode refazer só uma. A outra seguia no
// driver velho e o app a dava como já na conta nova: o limite ia para a conta errada e a volta à conta 1 não acontecia.
describe("sondagem parcial: só a IA sondada muda de conta no registry", () => {
  it("o turno do Claude ainda no driver da conta 1 marca a conta 1, não a escolhida que o registry ainda não tem", async () => {
    const { app } = montar(tresContas);
    await app.iniciar();
    app.ambienteDoTurno("claude-cli"); app.ambienteDoTurno("codex-cli"); app.registryRefeito(["claude-cli", "codex-cli"]);
    app.aoResultado("claude-cli", limite());
    await espera();
    await app.usar("claude-cli", 2);
    // a config nova (Claude na conta 2) foi montada, mas a sondagem que rodou foi só a do Codex
    app.ambienteDoTurno("claude-cli"); app.ambienteDoTurno("codex-cli"); app.registryRefeito(["codex-cli"]);
    const r = app.aoResultado("claude-cli", limite({ limiteVoltaEm: AGORA + 3 * HORA }));
    expect(r?.contaNoLimite).toMatchObject({ de: 1 });
    await espera();
    expect(app.naTela("claude-cli").contas[1]?.noLimiteAte, "a conta 2 nem rodou: não está no limite").toBeNull();
  });
});

// QA do NOD-211 (2026-10-12): remover a conta em uso apagava a pasta com o driver ainda nela.
describe("remover a conta em uso", () => {
  it("tira da lista, espera o registry voltar à conta 1 e só então faz o logout e apaga a pasta", async () => {
    const c = contasIniciaisDoMac();
    tresContas(c);
    const ordem: string[] = [];
    let soltar: () => void = () => undefined;
    const app = criarContasDoApp({
      base: BASE, padrao: () => "/h/.claude", ler: async () => structuredClone(c), gravar: async () => undefined, preparar: async () => undefined,
      remover: async (ia, id) => { ordem.push(`remover ${ia}/${id}`); return { logout: true }; },
      aoMudarConta: () => { ordem.push("sondar"); return new Promise<void>((ok) => { soltar = () => { ordem.push("registry refeito"); ok(); }; }); },
      aoMudar: () => undefined, agora: () => AGORA,
    });
    await app.iniciar();
    app.ambienteDoTurno("claude-cli"); app.registryRefeito(["claude-cli"]);
    app.aoResultado("claude-cli", limite());
    await espera();
    await app.usar("claude-cli", 2);
    soltar();
    app.ambienteDoTurno("claude-cli"); app.registryRefeito(["claude-cli"]);
    ordem.length = 0;
    const r = app.remover("claude-cli", 2);
    await espera(); await espera();
    expect(ordem, "a pasta ainda não foi tocada").toEqual(["sondar"]);
    soltar();
    expect((await r).contas.contas.map((x) => x.apelido)).toEqual(["Conta 1", "Reserva"]);
    expect(ordem).toEqual(["sondar", "registry refeito", "remover claude-cli/lumen"]);
  });
});
