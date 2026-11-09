import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ContaAnunciada } from "../../../src/contracts/contas-ia.ts";
import type { ResultadoTurno } from "../../../src/contracts/turno.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { TETO_POSTS_SEM_HUMANO } from "../../../src/domain/canal-orcamento.ts";
import { assentarTurno } from "../../../src/use-cases/assentar-turno.ts";
import { contasDaNota, notaDeLimite } from "../../../src/use-cases/contas-do-turno.ts";
import { rodarDestaVezComConta, seguirComConta, tentarDeNovoComConta } from "../../../src/use-cases/contas-ia.ts";
import { criarAgente } from "../../../src/use-cases/criar-agente.ts";
import { criarSala } from "../../../src/use-cases/criar-sala.ts";
import { depsEmMemoria, executar, MARLON } from "../../helpers/deps-l6.ts";

/** QA do PR #329 (pacote A4: NOD-280 + NOD-284): sondas para os critérios que o PR não cobre. */
const T0 = Date.now();
const HORA = 3_600_000;
const imp = (n: number) => n.toString(16).padStart(64, "0");
const anuncio = (n: number, ia: ContaAnunciada["ia"], apelido: string): ContaAnunciada => ({ impressao: imp(n), ia, estado: "pronta", plano: "Max", corporativa: false, logadaEm: T0 - HORA, apelidoSugerido: apelido });
const base = {
  texto: "", sessaoCli: null, custoUsd: 0, sinais: { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true },
  tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [],
} satisfies Omit<ResultadoTurno, "desfecho">;
const limite = (voltaEm: number, texto = ""): ResultadoTurno => ({ ...base, texto, desfecho: "falha", motivoFalha: "limite_do_plano", limiteVoltaEm: voltaEm, erroCru: "usage limit" });

async function montar() {
  let agora = T0;
  const { deps, banco } = depsEmMemoria(MARLON, { relogio: () => agora });
  const { data: ze } = await executar(deps, criarAgente, { dono: "pessoa", nome: "Ze 1" });
  const { data: gil } = await executar(deps, criarAgente, { dono: "pessoa", nome: "Gil" });
  const chave = await deps.repos.maquinaTokens.criar({ nome: "vm-bots", prefixo: "8f2a", hash: randomBytes(32) });
  const vm = chave!.id;
  await deps.repos.contasIa.doAnuncio(vm, [anuncio(1, "claude-cli", "Pessoal"), anuncio(2, "codex-cli", "Pessoal"), anuncio(3, "claude-cli", "Lumen")], T0);
  const [cPessoal, gPessoal, cLumen] = (await deps.repos.contasIa.listar()).contas;
  return { deps, banco, vm, ze: ze.agente.id, zeConversa: ze.conversa.id, gil: gil.agente.id, contas: { cPessoal: cPessoal!, gPessoal: gPessoal!, cLumen: cLumen! }, relogio: (t: number) => (agora = t) };
}

/** Um turno do bot que parou no limite: enfileira, reivindica e assenta com `limite_do_plano`. */
async function turnoNoLimite(c: Awaited<ReturnType<typeof montar>>, p: { conversaId: string; agenteId: string; origem: "conversa" | "sala"; texto?: string; harness?: string; modelo?: string }) {
  const agente = (await c.deps.repos.agentes.buscar(p.agenteId))!;
  const t = (await c.deps.repos.turnos.enfileirar({ conversaId: p.conversaId, agenteId: p.agenteId, origem: p.origem, prazoEm: T0 + 86_400_000, profundidade: 0, entradaTexto: "revisa o #861", mensagemOrigemId: null, entradaConfianca: "confiavel", modelo: p.modelo ?? agente.modelo, harness: (p.harness ?? agente.harness) as never, executor: "local" }))!;
  const r = await c.deps.repos.turnos.reivindicar({ machineId: c.vm, agora: T0 });
  expect(r?.id ?? (r as unknown as { turno?: { id: string } })?.turno?.id).toBeDefined();
  await executar(c.deps, assentarTurno, { turnoId: t.id, machineId: c.vm, seqLocal: 1, fala: { tipo: "texto", texto: p.texto ?? "" }, resultado: limite(T0 + 2 * HORA, p.texto ?? ""), executor: "local", harness: "claude-cli", prontosDaPessoa: ["claude-cli", "codex-cli"] });
  return c.banco.turnos.find((x) => x.id === t.id)!;
}

describe("QA A4 — sala (NOD-284)", () => {
  async function naSala() {
    const c = await montar();
    const s = await criarSala(c.deps, { nome: "revisão", agenteIds: [c.ze, c.gil] });
    await c.deps.repos.agentes.definirMaquina([c.ze, c.gil], c.vm);
    return { ...c, sala: s.data.sala, salaConversa: s.data.conversa.id };
  }

  it("c1: a fala cortada pelo limite entra como parcial e não enfileira turno de outro bot", async () => {
    const c = await naSala();
    const antes = c.banco.turnos.length;
    const t = await turnoNoLimite(c, { conversaId: c.salaConversa, agenteId: c.ze, origem: "sala", texto: "@Gil Vou verificar o" });
    expect(t).toMatchObject({ estado: "interrompido", motivoFalha: "limite_do_plano" });
    const fala = c.banco.mensagens.find((m) => m.turnoId === t.id && m.kind === "texto");
    expect(fala).toMatchObject({ texto: "@Gil Vou verificar o", parcial: true });
    const novos = c.banco.turnos.slice(antes).filter((x) => x.id !== t.id);
    expect(novos.filter((x) => x.agenteId === c.gil)).toEqual([]);
  });

  it("refaz na sala com origem sala; segundo clique = ja_refeito", async () => {
    const c = await naSala();
    const t = await turnoNoLimite(c, { conversaId: c.salaConversa, agenteId: c.ze, origem: "sala" });
    const r = await executar(c.deps, seguirComConta, { contaId: c.contas.cLumen.id, conversaId: c.salaConversa, turnoId: t.id });
    expect(r.data.motivo).toBeNull();
    expect(c.banco.turnos.find((x) => x.id === r.data.turnoId)).toMatchObject({ origem: "sala", agenteId: c.ze, estado: "pendente" });
    const de2 = await executar(c.deps, seguirComConta, { contaId: c.contas.cLumen.id, conversaId: c.salaConversa, turnoId: t.id });
    expect(de2.data.motivo).toBe("ja_refeito");
  });

  it("bot que saiu da sala: bot_fora_da_sala, nada enfileirado", async () => {
    const c = await naSala();
    const t = await turnoNoLimite(c, { conversaId: c.salaConversa, agenteId: c.ze, origem: "sala" });
    const sala = c.banco.salas.find((s) => s.id === c.sala.id)!;
    await c.deps.repos.salas.removerMembro(sala.id, c.ze, T0);
    expect((await c.deps.repos.salas.membros(sala.id)).some((m) => m.agenteId === c.ze)).toBe(false);
    const pend = c.banco.turnos.filter((x) => x.estado === "pendente").length;
    const r = await executar(c.deps, tentarDeNovoComConta, { contaId: c.contas.cPessoal.id, conversaId: c.salaConversa, turnoId: t.id });
    expect(r.data.motivo).toBe("bot_fora_da_sala");
    expect(c.banco.turnos.filter((x) => x.estado === "pendente").length).toBe(pend);
  });

  it("sala no teto do orçamento: orcamento_da_sala, nada enfileirado", async () => {
    const c = await naSala();
    const t = await turnoNoLimite(c, { conversaId: c.salaConversa, agenteId: c.ze, origem: "sala" });
    const sala = c.banco.salas.find((s) => s.id === c.sala.id)!;
    sala.orcamento = { ...sala.orcamento, postsSemHumano: TETO_POSTS_SEM_HUMANO };
    const pend = c.banco.turnos.filter((x) => x.estado === "pendente").length;
    const r = await executar(c.deps, seguirComConta, { contaId: c.contas.cLumen.id, conversaId: c.salaConversa, turnoId: t.id });
    expect(r.data.motivo).toBe("orcamento_da_sala");
    expect(c.banco.turnos.filter((x) => x.estado === "pendente").length).toBe(pend);
  });
});

describe("QA A4 — nota só fecha com fala do bot dono (NOD-284 c10)", () => {
  const msg = (o: Partial<Mensagem> & { autor: string; tipo?: "agente" | "pessoa" }): Mensagem => ({
    id: randomBytes(4).toString("hex"), conversaId: "c", turnoId: o.turnoId ?? null, kind: o.kind ?? "texto", texto: o.texto ?? "x", payload: o.payload ?? null,
    autoria: { autor_tipo: o.tipo ?? "agente", autor_id: o.autor } as never, confianca: "confiavel", parcial: false, criadoEm: T0,
  }) as unknown as Mensagem;
  const nota = msg({ autor: "ze", turnoId: "t1", kind: "sistema", payload: { kind: "limite_do_plano", harness: "claude-cli", voltaEm: null } as never });

  it("fala de outro bot depois da nota não fecha", () => {
    expect(notaDeLimite([nota, msg({ autor: "gil", turnoId: "t2" })])?.aberta).toBe(true);
  });
  it("fala do bot dono fecha", () => {
    expect(notaDeLimite([nota, msg({ autor: "ze", turnoId: "t3" })])?.aberta).toBe(false);
  });
  it("filtro por agente acha a nota do bot, não a de outro", () => {
    const notaGil = { ...msg({ autor: "gil", turnoId: "t9", kind: "sistema", payload: { kind: "limite_do_plano", harness: "claude-cli", voltaEm: null } as never }) };
    expect(notaDeLimite([nota, notaGil], "ze")?.nota.turnoId).toBe("t1");
  });
});

describe("QA A4 — conta de outra IA e máquina (NOD-280)", () => {
  async function fixoNoClaude() {
    const c = await montar();
    await c.deps.repos.agentes.definirMaquina([c.ze], c.vm);
    const t = await turnoNoLimite(c, { conversaId: c.zeConversa, agenteId: c.ze, origem: "conversa", harness: "claude-cli", modelo: "claude-sonnet-4-5" });
    return { ...c, t };
  }

  it("bot fixo no Claude: 'Seguir com' ChatGPT = conta_de_outra_ia, nada gravado", async () => {
    const c = await fixoNoClaude();
    const r = await executar(c.deps, seguirComConta, { contaId: c.contas.gPessoal.id, conversaId: c.zeConversa, turnoId: c.t.id });
    expect(r.data.motivo).toBe("conta_de_outra_ia");
    expect((await c.deps.repos.contasIa.modo()).escolhidas["codex-cli"] ?? null).toBeNull();
  });

  it("bot fixo no Claude: 'Tentar de novo' com ChatGPT = conta_de_outra_ia e o limite fica", async () => {
    const c = await fixoNoClaude();
    await c.deps.repos.contasIa.marcarLimite(c.contas.gPessoal.id, T0 + HORA);
    const r = await executar(c.deps, tentarDeNovoComConta, { contaId: c.contas.gPessoal.id, conversaId: c.zeConversa, turnoId: c.t.id });
    expect(r.data.motivo).toBe("conta_de_outra_ia");
    expect((await c.deps.repos.contasIa.buscar(c.contas.gPessoal.id))?.noLimiteAte).toBe(T0 + HORA);
  });

  it("janela de 2 min: 1:59 serve; 2:00 = maquina_sem_contato", async () => {
    const c = await fixoNoClaude();
    const m = c.banco.maquinaTokens.find((x) => x.id === c.vm)!;
    m.ultimoUsoEm = T0 - 120_000;
    const r1 = await executar(c.deps, rodarDestaVezComConta, { conversaId: c.zeConversa, turnoId: c.t.id, maquinaId: c.vm });
    expect(r1.data.motivo).toBe("maquina_sem_contato");
    m.ultimoUsoEm = T0 - 119_000;
    const r2 = await executar(c.deps, rodarDestaVezComConta, { conversaId: c.zeConversa, turnoId: c.t.id, maquinaId: c.vm });
    expect(r2.data.motivo).toBeNull();
  });

  it("máquina revogada: nao_encontrado", async () => {
    const c = await fixoNoClaude();
    const m = c.banco.maquinaTokens.find((x) => x.id === c.vm)!;
    m.ultimoUsoEm = T0;
    m.revogadaEm = T0 - 1;
    await expect(executar(c.deps, rodarDestaVezComConta, { conversaId: c.zeConversa, turnoId: c.t.id, maquinaId: c.vm })).rejects.toMatchObject({ codigo: "nao_encontrado" });
  });

  it("'Rodar no X' sem conta da IA pronta na máquina: conta_fora_da_maquina", async () => {
    const c = await fixoNoClaude();
    c.banco.maquinaTokens.find((x) => x.id === c.vm)!.ultimoUsoEm = T0;
    await c.deps.repos.contasIa.marcarLimite(c.contas.cPessoal.id, T0 + HORA);
    await c.deps.repos.contasIa.marcarLimite(c.contas.cLumen.id, T0 + HORA);
    const r = await executar(c.deps, rodarDestaVezComConta, { conversaId: c.zeConversa, turnoId: c.t.id, maquinaId: c.vm });
    expect(r.data.motivo).toBe("conta_fora_da_maquina");
  });

  it("'Seguir com' cancela a cópia adiada antes de refazer (uma pendente só)", async () => {
    const c = await fixoNoClaude();
    const t = c.t;
    await c.deps.repos.turnos.enfileirar({ conversaId: t.conversaId, agenteId: t.agenteId, origem: "conversa", prazoEm: T0 + 86_400_000, profundidade: 0, entradaTexto: t.entradaTexto, mensagemOrigemId: t.mensagemOrigemId, entradaConfianca: "confiavel", modelo: t.modelo, harness: t.harness, executor: "local", acordarEm: T0 + HORA } as never);
    const adiada = c.banco.turnos.find((x) => x.estado === "pendente" && x.id !== t.id)!;
    if (!adiada.acordarEm) adiada.acordarEm = T0 + HORA;
    const r = await executar(c.deps, seguirComConta, { contaId: c.contas.cLumen.id, conversaId: c.zeConversa, turnoId: t.id });
    expect(r.data.motivo).toBeNull();
    expect(c.banco.turnos.find((x) => x.id === adiada.id)?.estado).toBe("interrompido");
    expect(c.banco.turnos.filter((x) => x.estado === "pendente")).toHaveLength(1);
  });
});

describe("re-QA A4 — o que as sondas não cobriam", () => {
  it("m23: 'Rodar no X' nomeando a conta num turno já refeito = ja_refeito e a escolhida não muda", async () => {
    const c = await montar();
    await c.deps.repos.agentes.definirMaquina([c.ze], c.vm);
    const t = await turnoNoLimite(c, { conversaId: c.zeConversa, agenteId: c.ze, origem: "conversa", harness: "claude-cli", modelo: "claude-sonnet-4-5" });
    c.banco.maquinaTokens.find((x) => x.id === c.vm)!.ultimoUsoEm = T0;
    const antes = (await c.deps.repos.contasIa.modo()).escolhidas["claude-cli"] ?? null;
    const r1 = await executar(c.deps, rodarDestaVezComConta, { conversaId: c.zeConversa, turnoId: t.id, maquinaId: c.vm });
    expect(r1.data.motivo).toBeNull();
    const r2 = await executar(c.deps, rodarDestaVezComConta, { conversaId: c.zeConversa, turnoId: t.id, maquinaId: c.vm, contaId: c.contas.cLumen.id });
    expect(r2.data).toMatchObject({ turnoId: null, motivo: "ja_refeito" });
    expect((await c.deps.repos.contasIa.modo()).escolhidas["claude-cli"] ?? null).toBe(antes);
  });

  it("m28: na sala a troca vira o botão 'Seguir com' a conta para onde iria (mesma IA, na máquina)", async () => {
    const c = await montar();
    const de = (await c.deps.repos.contasIa.buscar(c.contas.cPessoal.id))!;
    const para = (await c.deps.repos.contasIa.buscar(c.contas.cLumen.id))!;
    const notaDaSala = contasDaNota(de as never, { tipo: "trocou", para } as never, { id: c.vm, nome: "vm-bots" }, null);
    expect(notaDaSala.livres).toEqual([{ id: para.id, apelido: para.apelido, ia: "claude-cli", naMaquina: true, outraMaquina: null }]);
    expect(contasDaNota(de as never, { tipo: "todas_no_limite", voltaEm: null } as never, null, null).livres).toEqual([]);
  });
});
