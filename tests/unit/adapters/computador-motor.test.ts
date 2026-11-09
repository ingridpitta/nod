import { describe, expect, it } from "vitest";
import { criarCanalComputador } from "../../../src/adapters/computador/canal.ts";
import { type ComputadorLocalizado, criarDriverMotor, type MaquinaDaPessoa, pisoDoComputador } from "../../../src/adapters/computador/motor.ts";
import { abrirSelo, chaveDaMaquina, conferirAssinatura, gerarParX25519, publicaDeAssinatura } from "../../../src/adapters/computador/selo.ts";
import type { ComandoComputador } from "../../../src/contracts/computador-motor.ts";
import { TETO_PRONTO_MS, TETO_PRONTO_VM_LOCAL_MS } from "../../../src/domain/computador-canal.ts";
import { EsperandoTela, ehFalhaComputador, instrucaoDaFalha } from "../../../src/domain/computador.ts";

const CHAVE = "cd".repeat(32);
const ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const escopo = { tenantId: "t1", pessoaId: "p1" };
const outra = { tenantId: "t1", pessoaId: "p2" };

/**
 * Um mundo falso: relógio que só anda no `dormir`, uma máquina "vm" da pessoa e um motor falso que, a cada passo,
 * puxa a fila e responde pelo `responder` (null = não responde).
 */
function mundo(o: { mac?: MaquinaDaPessoa["vmLocal"]; conectada?: boolean; anuncio?: MaquinaDaPessoa["computador"]; versaoApp?: string; piso?: string; loc?: Partial<ComputadorLocalizado>; relataPub?: boolean | "apos_sonda"; aoPasso?: (t: number, canal: ReturnType<typeof criarCanalComputador>, estado: { conectada: boolean }) => void; responder?: (c: ComandoComputador, t: number) => Parameters<ReturnType<typeof criarCanalComputador>["resultado"]>[2] | null } = {}) {
  let t = 1_000_000;
  const sup = gerarParX25519();
  const canal = criarCanalComputador({ agora: () => t });
  const vistos: ComandoComputador[] = [];
  /** NOD-96 PR 7: as sondas sem assinatura (o supervisor só conhece o computador depois de um comando com o id). */
  const sondas: ComandoComputador[] = [];
  const estado = { conectada: o.conectada ?? true, hospedeira: null as string | null, supervisor: null as string | null };
  const maquinas = (e: typeof escopo): MaquinaDaPessoa[] => e.pessoaId === "p1" && estado.conectada ? [{ machineId: "vm", nome: "vm-1", plataforma: o.mac ? "darwin" : "linux", computador: o.anuncio === undefined ? "pronto" : o.anuncio, ultimoContato: t, ...(o.versaoApp ? { versaoApp: o.versaoApp } : {}), ...(o.mac ? { vmLocal: o.mac } : {}) }] : [];
  const passo = () => {
    o.aoPasso?.(t, canal, estado);
    if (!estado.conectada) return;
    if (o.relataPub === true || o.relataPub === undefined || (o.relataPub === "apos_sonda" && sondas.length > 0)) canal.relatarEstado(escopo, "vm", { computadorId: "", ligado: false, supervisorPub: sup.publica, telas: [] });
    for (const c of canal.puxar(escopo, "vm")) {
      // Como o supervisor real: a sonda sem assinatura é recusada.
      if (c.assinatura === "") { sondas.push(c); canal.resultado(escopo, "vm", { id: c.id, desfecho: "falhou", motivo: "acao_falhou" }); continue; }
      vistos.push(c);
      const r = o.responder ? o.responder(c, t) : { id: c.id, desfecho: "ok" as const };
      if (r) canal.resultado(escopo, "vm", r);
    }
  };
  const driver = criarDriverMotor({
    env: { NOD_CREDENTIAL_KEY: CHAVE, ...(o.piso ? { NOD_COMPUTADOR_VERSAO_MINIMA: o.piso } : {}) },
    canal,
    localizar: async (id) => (id === ID ? { escopo, agenteId: "bot-1", maquinaId: null, hospedeiraId: estado.hospedeira, supervisorPub: estado.supervisor, padraoId: null, uso: "equilibrado", ...o.loc } : null),
    maquinas,
    nomeDaMaquina: async () => "vm-1",
    fixarHospedeira: async (_e, _id, m) => { estado.hospedeira = m; },
    fixarSupervisor: async (_e, _id, pub) => { if (estado.supervisor && estado.supervisor !== pub) return "diferente"; const novo = !estado.supervisor; estado.supervisor = pub; return novo ? "gravada" : "igual"; },
    agora: () => t,
    dormir: async (ms) => { t += ms; passo(); await Promise.resolve(); },
    novoId: (() => { let n = 0; return () => `cmd-${++n}`; })(),
  });
  return { driver, canal, sup, vistos, sondas, estado, agora: () => t, avancar: (ms: number) => { t += ms; } };
}

async function falha(p: Promise<unknown>) {
  try { await p; } catch (e) { if (ehFalhaComputador(e)) return e; throw e; }
  throw new Error("não falhou");
}

describe("driver motor: iniciar", () => {
  it("liga pela máquina da pessoa: comando assinado, segredo selado para o supervisor, hospedeira fixada", async () => {
    const m = mundo();
    await m.driver.iniciar(ID);
    const iniciar = m.vistos.find((c) => c.tipo === "iniciar")!;
    expect(conferirAssinatura(publicaDeAssinatura(CHAVE, ID), iniciar)).toBe(true);
    expect(JSON.parse(abrirSelo(m.sup.privada, iniciar.segredoSelado!).toString())).toMatchObject({ chaveMaquina: chaveDaMaquina(CHAVE, ID) });
    expect(iniciar.prazoMs - m.agora()).toBeLessThanOrEqual(120_000);
    expect(m.estado).toMatchObject({ hospedeira: "vm", supervisor: m.sup.publica });
  });

  it("o portão fala do computador do bot; o comando, o selo e o ligados usam o da pessoa (o do supervisor)", async () => {
    const DA_PESSOA = "00000000-0000-4000-8000-0000000000d1";
    const m = mundo({ loc: { computadorId: DA_PESSOA } });
    await m.driver.iniciar(ID);
    const iniciar = m.vistos.find((c) => c.tipo === "iniciar")!;
    expect(iniciar.computadorId).toBe(DA_PESSOA);
    expect(conferirAssinatura(publicaDeAssinatura(CHAVE, DA_PESSOA), iniciar)).toBe(true);
    // NOD-96 PR 4: o id do portão (a tela do bot) só conta como ligado com a tela aberta.
    m.canal.relatarEstado(escopo, "vm", { computadorId: DA_PESSOA, ligado: true, supervisorPub: m.sup.publica, telas: [] });
    expect(await m.driver.ligados()).toEqual(new Set([DA_PESSOA]));
    m.canal.relatarEstado(escopo, "vm", { computadorId: DA_PESSOA, ligado: true, supervisorPub: m.sup.publica, telas: [{ agenteId: "bot-1", estado: "aberta", ultimaAcaoEm: null, memoriaMb: 300 }] });
    expect(await m.driver.ligados()).toEqual(new Set([DA_PESSOA, ID]));
  });

  it("ligados(): a tela de cada bot conta só com a tela DELE (bot-1) aberta ou abrindo na foto viva; fechada, fechando, esperando ou a de outro bot não contam", async () => {
    const DA_PESSOA = "00000000-0000-4000-8000-0000000000d1";
    const m = mundo({ loc: { computadorId: DA_PESSOA } });
    await m.driver.iniciar(ID);
    const foto = (telas: { agenteId: string; estado: "aberta" | "abrindo" | "fechada" | "fechando" | "esperando" }[]) =>
      m.canal.relatarEstado(escopo, "vm", { computadorId: DA_PESSOA, ligado: true, supervisorPub: m.sup.publica, telas: telas.map((t) => ({ ...t, ultimaAcaoEm: null, memoriaMb: 300 })) });
    foto([{ agenteId: "bot-2", estado: "aberta" }]);
    expect(await m.driver.ligados()).toEqual(new Set([DA_PESSOA]));
    foto([{ agenteId: "bot-1", estado: "fechada" }, { agenteId: "bot-2", estado: "esperando" }]);
    expect(await m.driver.ligados()).toEqual(new Set([DA_PESSOA]));
    foto([{ agenteId: "bot-1", estado: "abrindo" }, { agenteId: "bot-2", estado: "fechando" }]);
    expect(await m.driver.ligados()).toEqual(new Set([DA_PESSOA, ID]));
    // Computador desligado na foto: nenhuma tela conta, mesmo relatada aberta.
    m.canal.relatarEstado(escopo, "vm", { computadorId: DA_PESSOA, ligado: false, supervisorPub: m.sup.publica, telas: [{ agenteId: "bot-1", estado: "aberta", ultimaAcaoEm: null, memoriaMb: 300 }] });
    expect(await m.driver.ligados()).toEqual(new Set());
  });

  it("computador que o escopo não acha: nao_iniciou", async () => {
    const m = mundo();
    expect((await falha(m.driver.iniciar("outro"))).motivo).toBe("nao_iniciou");
  });

  it("máquina desligada: 'Não consegui ligar o computador: vm-1 está sem contato', na hora", async () => {
    const m = mundo({ conectada: false, loc: { maquinaId: "vm" } });
    const antes = m.agora();
    const e = await falha(m.driver.iniciar(ID));
    expect(e.motivo).toBe("maquina_sem_contato");
    expect(m.agora()).toBe(antes);
    const texto = instrucaoDaFalha(e.motivo, null, e.maquina);
    expect(texto).toContain("Não consegui ligar o computador: vm-1 está sem contato");
    expect(texto).not.toMatch(/ERR_/);
  });

  it("app abaixo do piso: app_desatualizado antes de enviar comando (iniciar e executar); no piso liga", async () => {
    const antigo = mundo({ versaoApp: "1.0.0-rc.1", piso: "1.0.0-rc.2" });
    expect((await falha(antigo.driver.iniciar(ID))).motivo).toBe("app_desatualizado");
    expect((await falha(antigo.driver.executar(ID, { tipo: "navegar", url: "https://exemplo.com" }))).motivo).toBe("app_desatualizado");
    expect(antigo.vistos).toEqual([]);
    const atual = mundo({ versaoApp: "1.0.0-rc.2", piso: "1.0.0-rc.2" });
    await expect(atual.driver.iniciar(ID)).resolves.toBeUndefined();
    expect(atual.vistos.some((c) => c.tipo === "iniciar")).toBe(true);
  });

  it("app velho que nem anuncia o computador: pede para atualizar o app, não 'sem suporte' (QA F4)", async () => {
    const velho = mundo({ versaoApp: "0.9.0", piso: "1.0.0-rc.2", anuncio: "sem_suporte" });
    expect((await falha(velho.driver.iniciar(ID))).motivo).toBe("app_desatualizado");
    expect((await falha(mundo({ versaoApp: "1.0.0-rc.2", piso: "1.0.0-rc.2", anuncio: "sem_suporte" }).driver.iniciar(ID))).motivo).toBe("sem_suporte");
  });

  it("sem NOD_COMPUTADOR_VERSAO_MINIMA (ou inválida) o piso fica desligado: app antigo liga", async () => {
    expect(pisoDoComputador({})).toBeNull();
    expect(pisoDoComputador({ NOD_COMPUTADOR_VERSAO_MINIMA: "rc2" })).toBeNull();
    expect(pisoDoComputador({ NOD_COMPUTADOR_VERSAO_MINIMA: " 1.0.0-rc.2 " })).toBe("1.0.0-rc.2");
    const m = mundo({ versaoApp: "0.1.0" });
    await expect(m.driver.iniciar(ID)).resolves.toBeUndefined();
  });

  it("nenhuma máquina conectada: sem contato, sem nome inventado", async () => {
    const m = mundo({ conectada: false });
    const e = await falha(m.driver.iniciar(ID));
    expect(instrucaoDaFalha(e.motivo, null, e.maquina)).toContain("Não consegui ligar o computador: nenhuma máquina conectada roda o computador");
  });

  it("60 s sem ficar pronto: nao_ficou_pronto e o comando sai da fila", async () => {
    const m = mundo({ responder: () => null });
    const antes = m.agora();
    const e = await falha(m.driver.iniciar(ID));
    expect(e.motivo).toBe("nao_ficou_pronto");
    expect(m.agora() - antes).toBeGreaterThanOrEqual(TETO_PRONTO_MS);
    expect(m.agora() - antes).toBeLessThan(TETO_PRONTO_MS + 1_000);
    expect(m.canal.pendentes()).toEqual([]);
    expect(instrucaoDaFalha(e.motivo, null, e.maquina)).toContain("Não consegui ligar o computador: o computador ligou mas não ficou pronto a tempo");
  });

  it("NOD-93: o Mac responde esperando_tela (VM local preparando): o servidor pede de novo e liga quando ela fica pronta", async () => {
    let inicio: number | null = null;
    const m = mundo({ responder: (c, t) => {
      inicio ??= t;
      return t - inicio < 10_000 ? { id: c.id, desfecho: "esperando_tela", progresso: { pct: 50, etapa: "baixando" } } : { id: c.id, desfecho: "ok" };
    } });
    await m.driver.iniciar(ID);
    expect(m.vistos.filter((c) => c.tipo === "iniciar").length).toBeGreaterThan(1);
  });

  it("NOD-93: esperando_tela até o TETO_PRONTO_MS: nao_ficou_pronto", async () => {
    const m = mundo({ responder: (c) => ({ id: c.id, desfecho: "esperando_tela", progresso: { pct: 10, etapa: "baixando" } }) });
    const antes = m.agora();
    expect((await falha(m.driver.iniciar(ID))).motivo).toBe("nao_ficou_pronto");
    expect(m.agora() - antes).toBeGreaterThanOrEqual(TETO_PRONTO_MS);
    expect(m.canal.pendentes()).toEqual([]);
  });

  it("NOD-93 (1º ensaio no Mac): a máquina com a VM local tem 4 min, não 60 s, para ficar pronta (religar ou criar a VM)", async () => {
    const m = mundo({ mac: { estado: "ligando", desde: 0 }, responder: (c) => ({ id: c.id, desfecho: "esperando_tela", progresso: { pct: 0, etapa: "ligando" } }) });
    const antes = m.agora();
    expect((await falha(m.driver.iniciar(ID))).motivo).toBe("nao_ficou_pronto");
    expect(m.agora() - antes).toBeGreaterThanOrEqual(TETO_PRONTO_VM_LOCAL_MS);
    expect(m.agora() - antes).toBeLessThan(TETO_PRONTO_VM_LOCAL_MS + 2_000);
  });

  it("instalação limpa (NOD-96 PR 7): a sonda sem assinatura faz o supervisor relatar a chave; liga bem antes dos 60 s", async () => {
    const m = mundo({ relataPub: "apos_sonda" });
    const antes = m.agora();
    await m.driver.iniciar(ID);
    expect(m.agora() - antes).toBeLessThan(5_000);
    expect(m.sondas).toHaveLength(1);
    expect(m.sondas[0]).toMatchObject({ computadorId: ID, tipo: "parar", assinatura: "" });
    expect(m.vistos.map((c) => c.tipo)).toEqual(["iniciar"]);
    expect(m.estado.supervisor).toBe(m.sup.publica);
    expect(m.canal.pendentes()).toEqual([]);
  });

  it("chave já fixada ou já relatada: nenhuma sonda", async () => {
    const m = mundo();
    m.canal.relatarEstado(escopo, "vm", { computadorId: ID, ligado: false, supervisorPub: m.sup.publica, telas: [] });
    await m.driver.iniciar(ID);
    expect(m.sondas).toEqual([]);
  });

  it("ação no meio do boot espera o iniciar (20 s) e conclui", async () => {
    let inicio = 0;
    let iniciarId: string | null = null;
    const m = mundo({
      responder: (c, t) => {
        if (c.tipo === "iniciar") { inicio = t; iniciarId = c.id; return null; }
        return { id: c.id, desfecho: "ok", resultado: { saida: "feito" } };
      },
      aoPasso: (t, canal) => { if (iniciarId && t - inicio >= 20_000) { canal.resultado(escopo, "vm", { id: iniciarId, desfecho: "ok" }); iniciarId = null; } },
    });
    const p1 = m.driver.iniciar(ID);
    const p2 = (async () => { await m.driver.iniciar(ID); return m.driver.executar(ID, { tipo: "navegar", url: "https://exemplo.com" }); })();
    await p1;
    await expect(p2).resolves.toEqual({ saida: "feito" });
    expect(m.vistos.filter((c) => c.tipo === "iniciar")).toHaveLength(1);
    expect(m.vistos.map((c) => c.tipo)).toEqual(["iniciar", "acao"]);
  });

  it("a máquina cai no meio da espera: sem contato antes dos 60 s", async () => {
    let comeco = 0;
    const m = mundo({ responder: (_c, t) => { comeco = t; return null; }, aoPasso: (t, _canal, estado) => { if (comeco && t - comeco > 10_000) estado.conectada = false; } });
    const antes = m.agora();
    const e = await falha(m.driver.iniciar(ID));
    expect(e.motivo).toBe("maquina_sem_contato");
    expect(m.agora() - antes).toBeLessThan(TETO_PRONTO_MS);
  });

  it("supervisor com outra chave (TOFU): recusa sem selar", async () => {
    const m = mundo({ loc: { supervisorPub: null } });
    m.estado.supervisor = gerarParX25519().publica;
    const e = await falha(m.driver.iniciar(ID));
    expect(e.motivo).toBe("nao_iniciou");
    expect(m.vistos).toEqual([]);
  });

  it("máquina que anuncia faltam_pacotes: diz o motivo, não liga", async () => {
    const m = mundo({ anuncio: "faltam_pacotes" });
    expect((await falha(m.driver.iniciar(ID))).motivo).toBe("faltam_pacotes");
  });

  it("acorda a máquina gerenciada antes de contar os 60 s (gancho NOD-92)", async () => {
    const m = mundo({ conectada: false });
    const d = criarDriverMotor({
      env: { NOD_CREDENTIAL_KEY: CHAVE }, canal: m.canal,
      localizar: async () => ({ escopo, agenteId: null, maquinaId: "vm", hospedeiraId: null, supervisorPub: null, padraoId: null, uso: "pouco" }),
      maquinas: () => (m.estado.conectada ? [{ machineId: "vm", nome: "vm-1", plataforma: "linux", computador: "pronto", ultimoContato: 0 }] : []),
      nomeDaMaquina: async () => "vm-1", fixarHospedeira: async () => undefined, fixarSupervisor: async () => "gravada",
      acordarSePreciso: async () => { m.avancar(90_000); m.estado.conectada = true; return true; },
      agora: m.agora,
      dormir: async (ms) => { m.avancar(ms); m.canal.relatarEstado(escopo, "vm", { computadorId: "", ligado: false, supervisorPub: m.sup.publica, telas: [] }); for (const c of m.canal.puxar(escopo, "vm")) m.canal.resultado(escopo, "vm", { id: c.id, desfecho: "ok" }); },
    });
    await expect(d.iniciar(ID)).resolves.toBeUndefined();
  });
});

describe("driver motor: executar, parar, estado", () => {
  it("a ação leva a tela do bot; falhou vira o motivo; esperando_tela vira EsperandoTela com quem ocupa", async () => {
    const respostas = [{ desfecho: "ok" as const, resultado: { saida: "a" } }, { desfecho: "falhou" as const, motivo: "tela_alterada" as const }, { desfecho: "esperando_tela" as const, quem: ["bot-2"] }];
    let i = 0;
    const m = mundo({ responder: (c) => (c.tipo === "acao" ? { id: c.id, ...respostas[i++]! } : { id: c.id, desfecho: "ok" }) });
    await m.driver.iniciar(ID);
    const acao = { tipo: "observar" as const };
    await expect(m.driver.executar(ID, acao)).resolves.toEqual({ saida: "a" });
    expect(m.vistos.find((c) => c.tipo === "acao")).toMatchObject({ agenteId: "bot-1", acao });
    // Revisão 10 do PR #600: a ação do bot não leva `pessoa`; só a da pessoa (a tela solta a trava do dock para ela).
    expect(m.vistos.find((c) => c.tipo === "acao")).not.toHaveProperty("pessoa");
    expect((await falha(m.driver.executar(ID, acao))).motivo).toBe("tela_alterada");
    const e = await m.driver.executar(ID, acao).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(EsperandoTela);
    expect((e as EsperandoTela).quem).toEqual(["bot-2"]);
  });

  it("a ação da pessoa vai assinada com `pessoa: true` (revisão 10 do PR #600)", async () => {
    const m = mundo({ responder: (c) => ({ id: c.id, desfecho: "ok" }) });
    await m.driver.iniciar(ID);
    await m.driver.executar(ID, { tipo: "observar" }, undefined, "pessoa");
    await m.driver.executar(ID, { tipo: "observar" }, undefined, "bot");
    const acoes = m.vistos.filter((c) => c.tipo === "acao");
    expect(acoes[0]).toMatchObject({ pessoa: true });
    expect(acoes[1]).not.toHaveProperty("pessoa");
  });

  it("parar a tela de um bot manda fechar_tela com o bot; o computador da pessoa (sem bot) manda parar", async () => {
    const m = mundo({ loc: { maquinaId: "vm" } });
    await m.driver.parar(ID);
    expect(m.vistos.at(-1)).toMatchObject({ tipo: "fechar_tela", agenteId: "bot-1" });
    const p = mundo({ loc: { maquinaId: "vm", agenteId: null } });
    await p.driver.parar(ID);
    expect(p.vistos.at(-1)?.tipo).toBe("parar");
    expect(p.vistos.at(-1)?.agenteId).toBeUndefined();
  });

  it("parar sem contato não lança; estado diz por quê", async () => {
    const m = mundo({ conectada: false, loc: { maquinaId: "vm" } });
    await expect(m.driver.parar(ID)).resolves.toBeUndefined();
    expect(await m.driver.estado(ID)).toMatchObject({ disponivel: false, ativo: false, motivo: "A máquina do computador está sem contato" });
  });

  it("ligados e motivoParaFicarAcordada vêm da foto do supervisor", async () => {
    const m = mundo();
    m.canal.relatarEstado(escopo, "vm", { computadorId: ID, ligado: true, supervisorPub: m.sup.publica, telas: [{ agenteId: "bot-1", estado: "aberta", ultimaAcaoEm: null, memoriaMb: 400 }] });
    expect(await m.driver.ligados()).toEqual(new Set([ID]));
    expect(m.driver.motivoParaFicarAcordada("vm")).toBe(true);
    m.avancar(46_000);
    expect(await m.driver.ligados()).toEqual(new Set());
  });
});

describe("canal: a puxada só entrega à máquina e à pessoa do comando", () => {
  const comando = (id: string): ComandoComputador => ({ id, computadorId: ID, tipo: "acao", uso: "livre", prazoMs: 2_000_000, assinatura: "x" });
  it("outra pessoa com a mesma chave de máquina não leva nem responde; resultado repetido ou desconhecido é ignorado", async () => {
    const canal = criarCanalComputador({ agora: () => 1_000_000 });
    const p = canal.enviar(escopo, "vm", comando("c1"));
    expect(canal.puxar(outra, "vm")).toEqual([]);
    expect(canal.puxar(escopo, "outra-vm")).toEqual([]);
    expect(canal.resultado(outra, "vm", { id: "c1", desfecho: "ok" })).toBe(false);
    expect(canal.puxar(escopo, "vm").map((c) => c.id)).toEqual(["c1"]);
    // Reservado: a segunda puxada não leva de novo.
    expect(canal.puxar(escopo, "vm")).toEqual([]);
    expect(canal.resultado(escopo, "vm", { id: "c1", desfecho: "ok" })).toBe(true);
    await expect(p).resolves.toMatchObject({ id: "c1" });
    expect(canal.resultado(escopo, "vm", { id: "c1", desfecho: "ok" })).toBe(false);
    expect(canal.resultado(escopo, "vm", { id: "nunca", desfecho: "ok" })).toBe(false);
  });
  it("reserva vence em 2 min e o comando vencido não sai mais", () => {
    let t = 1_000_000;
    const canal = criarCanalComputador({ agora: () => t });
    void canal.enviar(escopo, "vm", { ...comando("c1"), prazoMs: t + 200_000 }).catch(() => undefined);
    expect(canal.puxar(escopo, "vm")).toHaveLength(1);
    t += 120_000;
    expect(canal.puxar(escopo, "vm")).toHaveLength(1);
    t += 120_000;
    expect(canal.puxar(escopo, "vm")).toHaveLength(0);
  });
});

describe("driver motor: operações da pessoa (NOD-96 PR 5)", () => {
  it("atualizar e redefinir vão sem tela; o redefinir devolve a X25519 nova; a espera passa dos 2 min do comando", async () => {
    const nova = gerarParX25519().publica;
    let pedidoEm = 0;
    let pendente: ComandoComputador | null = null;
    const m = mundo({
      loc: { agenteId: null, maquinaId: "vm" },
      responder: (c, t) => { if (c.tipo === "redefinir") { pedidoEm = t; pendente = c; return null; } return { id: c.id, desfecho: "ok" }; },
      aoPasso: (t, canal) => { if (pendente && t - pedidoEm >= 5 * 60_000) { canal.resultado(escopo, "vm", { id: pendente.id, desfecho: "ok", supervisorPub: nova }); pendente = null; } },
    });
    await expect(m.driver.operar!(ID, "atualizar")).resolves.toEqual({});
    expect(m.vistos.at(-1)).toMatchObject({ tipo: "atualizar" });
    expect(m.vistos.at(-1)?.agenteId).toBeUndefined();
    await expect(m.driver.operar!(ID, "redefinir")).resolves.toEqual({ supervisorPub: nova });
    const r = m.vistos.find((c) => c.tipo === "redefinir")!;
    expect(r.prazoMs - pedidoEm).toBeLessThanOrEqual(120_000);
  });

  it("sair de todos liga o computador antes; falhou vira o motivo (atualizando)", async () => {
    const m = mundo({ loc: { agenteId: null }, responder: (c) => (c.tipo === "sair_de_todos" ? { id: c.id, desfecho: "falhou", motivo: "atualizando" } : { id: c.id, desfecho: "ok" }) });
    const e = await falha(m.driver.operar!(ID, "sair_de_todos"));
    expect(e.motivo).toBe("atualizando");
    expect(m.vistos.map((c) => c.tipo)).toEqual(["iniciar", "sair_de_todos"]);
  });

  it("esquecer senhas (NOD-97 PR 6) também liga o computador antes e não manda tela; ok volta sem extra", async () => {
    const m = mundo({ loc: { agenteId: null }, responder: (c) => ({ id: c.id, desfecho: "ok", ...(c.tipo === "esquecer_senhas" ? { relancados: 2 } : {}) }) });
    await expect(m.driver.operar!(ID, "esquecer_senhas")).resolves.toEqual({});
    expect(m.vistos.map((c) => c.tipo)).toEqual(["iniciar", "esquecer_senhas"]);
    expect(m.vistos.at(-1)?.agenteId).toBeUndefined();
  });

  it("esquecer senhas que falha no supervisor (não apagou) vira acao_falhou", async () => {
    const m = mundo({ loc: { agenteId: null }, responder: (c) => (c.tipo === "esquecer_senhas" ? { id: c.id, desfecho: "falhou", motivo: "acao_falhou" } : { id: c.id, desfecho: "ok" }) });
    expect((await falha(m.driver.operar!(ID, "esquecer_senhas"))).motivo).toBe("acao_falhou");
  });

  it("sem resposta em 10 min: sem_resposta e o comando sai da fila", async () => {
    const m = mundo({ loc: { agenteId: null, maquinaId: "vm" }, responder: () => null });
    const antes = m.agora();
    expect((await falha(m.driver.operar!(ID, "atualizar"))).motivo).toBe("sem_resposta");
    expect(m.agora() - antes).toBeGreaterThanOrEqual(10 * 60_000);
    expect(m.canal.pendentes()).toEqual([]);
  });

  it("apagar_perfil leva o bot excluído; sem contato não lança", async () => {
    const m = mundo({ loc: { agenteId: null, maquinaId: "vm" } });
    await m.driver.apagarPerfil!(ID, "bot-9");
    expect(m.vistos.at(-1)).toMatchObject({ tipo: "apagar_perfil", agenteId: "bot-9" });
    const s = mundo({ conectada: false, loc: { agenteId: null, maquinaId: "vm" } });
    await expect(s.driver.apagarPerfil!(ID, "bot-9")).resolves.toBeUndefined();
    expect(s.vistos).toEqual([]);
  });

  it("maquinaDoComputador traz o preparo da VM local quando a máquina é um Mac (NOD-93)", async () => {
    const preparo = { estado: "baixando" as const, bytes: 870, total: 1100, desde: 1 };
    expect((await mundo({ mac: preparo, loc: { agenteId: null } }).driver.maquinaDoComputador!(ID))?.preparo).toEqual(preparo);
    expect((await mundo({ loc: { agenteId: null } }).driver.maquinaDoComputador!(ID))).not.toHaveProperty("preparo");
  });

  it("maquinaDoComputador traz appDesatualizado (versões e plataforma) só abaixo do piso ligado (NOD-407)", async () => {
    expect((await mundo({ versaoApp: "1.0.0-rc.1", piso: "1.0.0-rc.2", loc: { agenteId: null } }).driver.maquinaDoComputador!(ID))?.appDesatualizado).toEqual({ atual: "1.0.0-rc.1", minima: "1.0.0-rc.2", plataforma: "linux" });
    expect(await mundo({ versaoApp: "1.0.0-rc.2", piso: "1.0.0-rc.2", loc: { agenteId: null } }).driver.maquinaDoComputador!(ID)).not.toHaveProperty("appDesatualizado");
    expect(await mundo({ versaoApp: "0.1.0", loc: { agenteId: null } }).driver.maquinaDoComputador!(ID)).not.toHaveProperty("appDesatualizado");
  });

  it("maquinaDoComputador diz o nome e o contato; ligando enquanto o iniciar corre", async () => {
    const m = mundo({ loc: { agenteId: null } });
    expect(await m.driver.maquinaDoComputador!(ID)).toEqual({ id: "vm", nome: "vm-1", contato: expect.any(Number), foto: null });
    m.canal.relatarEstado(escopo, "vm", { computadorId: ID, ligado: true, supervisorPub: m.sup.publica, ligadoDesde: 5, memoriaTotalMb: 8000, telas: [{ agenteId: "bot-1", estado: "aberta", ultimaAcaoEm: null, memoriaMb: 300, titulo: "Caixa de entrada" }] });
    expect((await m.driver.maquinaDoComputador!(ID))?.foto).toEqual({ ligadoDesde: 5, memoriaTotalMb: 8000, titulos: { "bot-1": "Caixa de entrada" } });
    const s = mundo({ conectada: false, loc: { agenteId: null, maquinaId: "vm" } });
    expect(await s.driver.maquinaDoComputador!(ID)).toEqual({ id: "vm", nome: "vm-1", contato: null, foto: null, ultimoContato: null });
    expect(await mundo({ conectada: false, loc: { agenteId: null } }).driver.maquinaDoComputador!(ID)).toBeNull();
    const p = m.driver.iniciar(ID);
    expect(m.driver.ligando!(ID)).toBe(true);
    await p;
    expect(m.driver.ligando!(ID)).toBe(false);
  });
});
