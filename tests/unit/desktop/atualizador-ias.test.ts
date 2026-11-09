import { describe, expect, it } from "vitest";
import type { IaDesktop } from "../../../src/contracts/desktop.ts";
import type { AtualizacaoDaIa, OrigemDoBinario } from "../../../src/contracts/estado-ia.ts";
import { compararVersoes } from "../../../src/adapters/executor/flag-floors.ts";
import { ATUALIZACAO_AUTOMATICA } from "../../../src/domain/atualizacao-automatica.ts";
import { criarAtualizadorDeIas, fimDaInstalacao, inventarioComAtualizacao, lerDiscoAtualizacoes, passosPelaOrigem, PRAZO_PORTAO_MS, type DiscoAtualizacoes, type FimDoPasso, type GatilhoAtualizar, type PassoAtualizar } from "../../../desktop/atualizador-ias.ts";

const T0 = 1_800_000_000_000;
const PISO = "2.1.300";

/** Um Mac de mentira: a versão de cada IA, os turnos, os passos (um roteiro de fins) e um relógio manual. */
function mac(o: { versao?: string | null; origem?: OrigemDoBinario; turnos?: number; roteiro?: FimDoPasso[]; tipos?: PassoAtualizar["tipo"][]; disco?: unknown } = {}) {
  const s = {
    versao: o.versao === undefined ? "2.1.200" : o.versao,
    origem: o.origem ?? ("nvm" as OrigemDoBinario),
    turnos: o.turnos ?? 0,
    ligacao: false,
    roteiro: [...(o.roteiro ?? [{ resultado: "ok", antes: "2.1.200", depois: "2.1.301", atende: true }])] as FimDoPasso[],
    tipos: o.tipos ?? (["oficial", "reserva"] as PassoAtualizar["tipo"][]),
    rodados: [] as { tipo: string; gatilho: GatilhoAtualizar }[],
    fases: [] as (AtualizacaoDaIa["fase"] | null)[],
    disco: o.disco as unknown,
    gravados: [] as DiscoAtualizacoes[],
    agora: T0,
    timers: [] as { fn: () => void; quando: number; vivo: boolean }[],
    depois: 0,
    trava: null as Promise<void> | null,
    eventos: [] as { evento: string; campos: Record<string, unknown> }[],
    passosQuebram: false,
    lerFalha: null as Error | null,
  };
  const atualizador = criarAtualizadorDeIas({
    binario: async (ia: IaDesktop) => (ia === "claude-cli" ? { versao: s.versao, origem: s.origem } : { versao: null, origem: null }),
    piso: () => PISO,
    comparar: compararVersoes,
    turnos: (ia) => (ia === "claude-cli" ? s.turnos : 0),
    emLigacao: () => s.ligacao,
    passos: (_ia, gatilho) => { if (s.passosQuebram) throw new Error("passos quebrados"); return s.tipos.map((tipo) => ({
      tipo,
      rodar: async () => {
        s.rodados.push({ tipo, gatilho });
        if (s.trava) await s.trava;
        const fim = s.roteiro.shift() ?? { resultado: "falhou", antes: s.versao, depois: s.versao, atende: false };
        if (fim.depois) s.versao = fim.depois;
        return fim;
      },
    })); },
    depois: () => { s.depois += 1; },
    aoMudar: (ia, a) => { if (ia === "claude-cli") s.fases.push(a?.fase ?? null); },
    ler: async () => { if (s.lerFalha) throw s.lerFalha; return s.disco; },
    gravar: async (dd) => { s.gravados.push(dd); },
    agora: () => s.agora,
    hoje: (t) => new Date(t).toISOString().slice(0, 10),
    agendar: (fn, ms) => {
      const t = { fn, quando: s.agora + ms, vivo: true };
      s.timers.push(t);
      return { cancelar: () => { t.vivo = false; } };
    },
    registrar: (evento, campos) => { s.eventos.push({ evento, campos }); },
  });
  /** Avança o relógio e dispara os timers vencidos. */
  const avancar = async (ms: number) => {
    s.agora += ms;
    for (const t of s.timers.filter((x) => x.vivo && x.quando <= s.agora)) {
      t.vivo = false;
      t.fn();
    }
    await new Promise((r) => setTimeout(r, 0));
  };
  return { s, a: atualizador, avancar };
}

describe("criarAtualizadorDeIas (NOD-9)", () => {
  it("abaixo do piso e sem turno: atualiza na hora pelo passo oficial e termina em sucesso", async () => {
    const { s, a } = mac();
    await a.verificar();
    expect(s.rodados).toEqual([{ tipo: "oficial", gatilho: "auto" }]);
    expect(a.estado("claude-cli")).toMatchObject({ fase: "sucesso", antes: "2.1.200", depois: "2.1.301", alvo: PISO, caminho: "oficial" });
    expect(s.fases).toEqual(["atualizando", "atualizando", "sucesso"]);
    expect(s.depois).toBe(1);
    expect(s.gravados.at(-1)?.ias["claude-cli"]?.registro).toEqual({ alvo: PISO, dia: new Date(T0).toISOString().slice(0, 10) });
  });

  it("já no piso, binário configurado ou não instalado: não roda nada", async () => {
    for (const o of [{ versao: PISO }, { origem: "configurado" as const }, { versao: null }]) {
      const { s, a } = mac(o);
      await a.verificar();
      expect(s.rodados).toEqual([]);
      expect(a.estado("claude-cli")).toBeNull();
    }
  });

  it("o clique num binário configurado diz por quê (configurado), sem rodar", async () => {
    const { s, a } = mac({ origem: "configurado" });
    expect(await a.atualizar("claude-cli")).toMatchObject({ fase: "falhou", motivo: "configurado" });
    expect(s.rodados).toEqual([]);
  });

  it("sem permissão no oficial: passa à reserva; sem internet: para ali", async () => {
    const um = mac({ roteiro: [{ resultado: "sem_permissao", antes: "2.1.200", depois: "2.1.200", atende: false }, { resultado: "ok", antes: "2.1.200", depois: "2.1.310", atende: true }] });
    await um.a.verificar();
    expect(um.s.rodados.map((r) => r.tipo)).toEqual(["oficial", "reserva"]);
    expect(um.a.estado("claude-cli")).toMatchObject({ fase: "sucesso", caminho: "reserva" });

    const dois = mac({ roteiro: [{ resultado: "sem_internet", antes: "2.1.200", depois: "2.1.200", atende: false }] });
    await dois.a.verificar();
    expect(dois.s.rodados.map((r) => r.tipo)).toEqual(["oficial"]);
    expect(dois.a.estado("claude-cli")).toMatchObject({ fase: "falhou", motivo: "sem_internet" });
  });

  it("subiu, mas abaixo do alvo: insuficiente, sem tentar a reserva", async () => {
    const { s, a } = mac({ roteiro: [{ resultado: "ok", antes: "2.1.200", depois: "2.1.250", atende: false }] });
    await a.verificar();
    expect(s.rodados).toHaveLength(1);
    expect(a.estado("claude-cli")).toMatchObject({ fase: "insuficiente", motivo: "insuficiente", depois: "2.1.250" });
  });

  it("sem passos (o Codex hoje): falhou com nao_suportado", async () => {
    const { a } = mac({ tipos: [] });
    await a.verificar();
    expect(a.estado("claude-cli")).toMatchObject({ fase: "falhou", motivo: "nao_suportado" });
  });

  it("uma tentativa automática por alvo por dia; o clique não conta", async () => {
    const { s, a } = mac({ roteiro: [{ resultado: "falhou", antes: "2.1.200", depois: "2.1.200", atende: false }, { resultado: "falhou", antes: "2.1.200", depois: "2.1.200", atende: false }] });
    await a.verificar();
    await a.verificar();
    expect(s.rodados).toHaveLength(2); // oficial + reserva da primeira tentativa
    await a.atualizar("claude-cli");
    expect(s.rodados.at(-1)?.gatilho).toBe("clique");
  });

  it("com turno rodando espera; o aviso vem 23 h depois e o segurar com 24 h", async () => {
    const { s, a } = mac({ turnos: 1 });
    await a.verificar();
    expect(a.estado("claude-cli")?.fase).toBe("esperando");
    s.agora = T0 + ATUALIZACAO_AUTOMATICA.segurarDepoisMs - ATUALIZACAO_AUTOMATICA.avisoAntesMs;
    await a.verificar();
    expect(a.estado("claude-cli")).toMatchObject({ fase: "aviso", seguraEm: T0 + ATUALIZACAO_AUTOMATICA.segurarDepoisMs });
    s.agora = T0 + ATUALIZACAO_AUTOMATICA.segurarDepoisMs;
    await a.verificar();
    expect(a.estado("claude-cli")?.fase).toBe("segurando");
    expect(s.rodados).toEqual([]);
    s.turnos = 0;
    await a.verificar();
    expect(a.estado("claude-cli")?.fase).toBe("sucesso");
  });

  it("o clique com turno rodando espera a brecha; com `agora` roda já", async () => {
    const { s, a } = mac({ turnos: 1 });
    expect(await a.atualizar("claude-cli")).toMatchObject({ fase: "esperando" });
    expect(s.rodados).toEqual([]);
    s.turnos = 0;
    await a.verificar();
    expect(s.rodados).toEqual([{ tipo: "oficial", gatilho: "clique" }]);

    const outro = mac({ turnos: 1 });
    expect(await outro.a.atualizar("claude-cli", { agora: true })).toMatchObject({ fase: "sucesso" });
  });

  it("o portão: segura o turno novo enquanto atualiza e solta no fim; quem espera nele não conta como turno", async () => {
    const { s, a } = mac();
    let soltar = () => undefined as void;
    s.trava = new Promise<void>((r) => { soltar = r; });
    const rodando = a.verificar();
    await new Promise((r) => setTimeout(r, 0));
    expect(a.estado("claude-cli")?.fase).toBe("atualizando");
    let passou: boolean | null = null;
    void a.aguardar("claude-cli").then((ok) => { passou = ok; });
    await new Promise((r) => setTimeout(r, 0));
    expect(passou).toBeNull();
    soltar();
    await rodando;
    await new Promise((r) => setTimeout(r, 0));
    expect(passou).toBe(true);
    // Livre: false — não houve atualização, o turno não relê a versão (era true e todo turno relia).
    expect(await a.aguardar("claude-cli")).toBe(false);
  });

  it("o portão segurando: o turno que espera libera a brecha e a atualização roda", async () => {
    const { s, a } = mac({ turnos: 1 });
    s.agora = T0;
    await a.verificar();
    s.agora = T0 + ATUALIZACAO_AUTOMATICA.segurarDepoisMs;
    await a.verificar();
    expect(a.estado("claude-cli")?.fase).toBe("segurando");
    // O único turno contado é o que chegou ao portão: ele não ocupa, a atualização roda e o solta.
    expect(await a.aguardar("claude-cli")).toBe(true);
    expect(a.estado("claude-cli")?.fase).toBe("sucesso");
  });

  it("o portão vence em 3 min e o turno segue", async () => {
    const { s, a, avancar } = mac();
    s.trava = new Promise<void>(() => undefined);
    void a.verificar();
    await new Promise((r) => setTimeout(r, 0));
    let passou: boolean | null = null;
    void a.aguardar("claude-cli").then((ok) => { passou = ok; });
    await avancar(PRAZO_PORTAO_MS);
    expect(passou).toBe(false);
  });

  it("pedirVersao sobe o alvo para a mínima do modelo e espera a atualização acabar (o turno que pediu não ocupa)", async () => {
    // O turno que pediu é o único do provedor: conta em `turnos`, mas não segura a atualização que ele mesmo pediu.
    const { s, a } = mac({ versao: PISO, turnos: 1, roteiro: [{ resultado: "ok", antes: PISO, depois: "2.1.999", atende: true }] });
    expect(await a.pedirVersao("claude-cli", "2.1.999")).toBe(true);
    expect(s.rodados).toHaveLength(1);
    expect(a.estado("claude-cli")).toMatchObject({ fase: "sucesso", alvo: "2.1.999" });
  });

  it("pedirVersao com outro turno do provedor rodando: não roda e resolve false (o turno recusa com modelo_requer_cli)", async () => {
    const { s, a } = mac({ versao: PISO, turnos: 2 });
    expect(await a.pedirVersao("claude-cli", "2.1.999")).toBe(false);
    expect(s.rodados).toEqual([]);
  });

  it("pedirVersao durante uma passada que já leu `ocupado`: espera ela e roda outra (corrida)", async () => {
    const { s, a } = mac({ versao: PISO, turnos: 1, roteiro: [{ resultado: "ok", antes: PISO, depois: "2.1.999", atende: true }] });
    // A passada do timer começa antes do turno pedir: ela vê o turno como ocupado e não roda nada.
    const passada = a.verificar();
    const pedido = a.pedirVersao("claude-cli", "2.1.999");
    await passada;
    expect(await pedido).toBe(true);
    expect(s.rodados).toHaveLength(1);
  });

  it("dois turnos pedem a mesma versão juntos: uma atualização só, os dois sabem que ela terminou", async () => {
    const { s, a } = mac({ versao: PISO, turnos: 2, roteiro: [{ resultado: "ok", antes: PISO, depois: "2.1.999", atende: true }] });
    let soltar = () => undefined as void;
    s.trava = new Promise<void>((r) => { soltar = r; });
    const p1 = a.pedirVersao("claude-cli", "2.1.999");
    const p2 = a.pedirVersao("claude-cli", "2.1.999");
    await new Promise((r) => setTimeout(r, 0));
    soltar();
    expect(await Promise.all([p1, p2])).toEqual([true, true]);
    expect(s.rodados).toHaveLength(1);
  });

  it("pedirVersao vence o prazo do portão: false, o turno segue e recusa", async () => {
    const { s, a, avancar } = mac({ versao: PISO });
    s.trava = new Promise<void>(() => undefined);
    let r: boolean | null = null;
    void a.pedirVersao("claude-cli", "2.1.999").then((v) => { r = v; });
    await new Promise((res) => setTimeout(res, 0));
    await avancar(PRAZO_PORTAO_MS);
    expect(r).toBe(false);
  });

  it("dois turnos no portão ao mesmo tempo: os dois saem com true quando a atualização termina, um só passo rodou", async () => {
    const { s, a } = mac();
    let soltar = () => undefined as void;
    s.trava = new Promise<void>((r) => { soltar = r; });
    const rodando = a.verificar();
    await new Promise((r) => setTimeout(r, 0));
    const turnos = [a.aguardar("claude-cli"), a.aguardar("claude-cli")];
    soltar();
    await rodando;
    expect(await Promise.all(turnos)).toEqual([true, true]);
    expect(s.rodados).toHaveLength(1);
  });

  it("segurando que vira nada (a versão já serve): o portão abre com false — ninguém relê", async () => {
    const { s, a } = mac({ turnos: 1 });
    await a.verificar();
    s.agora = T0 + ATUALIZACAO_AUTOMATICA.segurarDepoisMs;
    await a.verificar();
    expect(a.estado("claude-cli")?.fase).toBe("segurando");
    s.turnos = 2; // o turno do portão não ocupa; outro, sim — a brecha não chega
    const espera = a.aguardar("claude-cli");
    await new Promise((r) => setTimeout(r, 0));
    s.versao = "2.1.301"; // a pessoa atualizou por fora
    await a.verificar();
    expect(await espera).toBe(false);
  });

  it("o registro do dia vai ao disco ANTES do 1º passo (o app que cai no meio não tenta de novo hoje)", async () => {
    const { s, a } = mac();
    let soltar = () => undefined as void;
    s.trava = new Promise<void>((r) => { soltar = r; });
    const rodando = a.verificar();
    await new Promise((r) => setTimeout(r, 0));
    expect(s.rodados).toHaveLength(1);
    expect(s.gravados.at(-1)?.ias["claude-cli"]?.registro).toEqual({ alvo: PISO, dia: new Date(T0).toISOString().slice(0, 10) });
    soltar();
    await rodando;
  });

  it("um erro fora do passo fecha em falhou (nunca fica em Atualizando…) e libera a próxima tentativa", async () => {
    const { s, a } = mac();
    s.passosQuebram = true;
    await a.verificar();
    expect(a.estado("claude-cli")).toMatchObject({ fase: "falhou", motivo: "falhou" });
    expect(s.eventos.some((e) => e.evento === "ia_atualizacao_passo" && e.campos.erro === "passos quebrados")).toBe(true);
    s.passosQuebram = false;
    expect(await a.atualizar("claude-cli")).toMatchObject({ fase: "sucesso" });
  });

  it("arquivo ilegível: vira vazio e vai ao log (ENOENT, a 1ª vez, fica quieto)", async () => {
    const quieto = mac();
    quieto.s.lerFalha = Object.assign(new Error("não existe"), { code: "ENOENT" });
    await quieto.a.carregar();
    expect(quieto.s.eventos).toEqual([]);
    const { s, a } = mac();
    s.lerFalha = Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
    await a.carregar();
    expect(s.eventos).toEqual([{ evento: "ia_atualizacao_disco", campos: { lendo: true, erro: "EACCES: permission denied" } }]);
  });

  it("carrega o registro do disco; disco ilegível vira vazio", async () => {
    const hoje = new Date(T0).toISOString().slice(0, 10);
    const { s, a } = mac({ disco: { v: 1, ias: { "claude-cli": { registro: { alvo: PISO, dia: hoje }, precisaDesde: null, ultimo: null } } } });
    await a.carregar();
    await a.verificar();
    expect(s.rodados).toEqual([]);
    expect(lerDiscoAtualizacoes("lixo")).toBeNull();
    expect(lerDiscoAtualizacoes({ v: 2, ias: {} })).toBeNull();
  });
});

describe("fimDaInstalacao e inventarioComAtualizacao (NOD-9)", () => {
  it("a reserva: sucesso vira ok (atende pela versão); as falhas do npm viram o motivo", () => {
    expect(fimDaInstalacao({ fase: "sucesso", linha: null, tentativa: 1, mensagem: "", versao: "2.1.301" }, "2.1.200", PISO, compararVersoes)).toMatchObject({ resultado: "ok", depois: "2.1.301", atende: true });
    expect(fimDaInstalacao({ fase: "sucesso", linha: null, tentativa: 1, mensagem: "", versao: "2.1.250" }, "2.1.200", PISO, compararVersoes)).toMatchObject({ resultado: "ok", atende: false });
    expect(fimDaInstalacao({ fase: "falhou", linha: null, tentativa: 3, mensagem: "", causa: "sem_internet" }, "2.1.200", PISO, compararVersoes).resultado).toBe("sem_internet");
    expect(fimDaInstalacao({ fase: "falhou", linha: null, tentativa: 1, mensagem: "", causa: "pacote_indisponivel" }, "2.1.200", PISO, compararVersoes).resultado).toBe("falhou");
    expect(fimDaInstalacao({ fase: "cancelado", linha: null, tentativa: 1, mensagem: "" }, "2.1.200", PISO, compararVersoes).resultado).toBe("falhou");
  });

  it("enquanto atualiza, o inventário vai como ausente + atualizando; depois, a fase vai junto sem mudar o estado", () => {
    const inv = { estado: "pronto" as const, versao: "2.1.200", em: T0 };
    const atualizando: AtualizacaoDaIa = { fase: "atualizando", alvo: PISO, em: T0 };
    expect(inventarioComAtualizacao(inv, atualizando, "Claude Code")).toEqual({ estado: "ausente", causa: "atualizando", motivo: expect.stringContaining("Atualizando o Claude Code"), versao: "2.1.200", atualizacao: atualizando, em: T0 });
    const segurando: AtualizacaoDaIa = { fase: "segurando", alvo: PISO, em: T0 };
    expect(inventarioComAtualizacao(inv, segurando, "Claude Code")).toMatchObject({ estado: "ausente", causa: "atualizando", atualizacao: segurando });
    const fim: AtualizacaoDaIa = { fase: "sucesso", alvo: PISO, depois: "2.1.301", em: T0 };
    expect(inventarioComAtualizacao(inv, fim, "Claude Code")).toEqual({ ...inv, atualizacao: fim });
    expect(inventarioComAtualizacao(inv, null, "Claude Code")).toBe(inv);
  });
});

describe("passosPelaOrigem (NOD-9, os passos montados em desktop/main.ts)", () => {
  const reserva: PassoAtualizar = { tipo: "reserva", rodar: async () => ({ resultado: "ok", antes: null, depois: null, atende: true }) };
  const montados: (readonly string[])[] = [];
  const oficial = (args: readonly string[]): PassoAtualizar => { montados.push(args); return { tipo: "oficial", rodar: async () => ({ resultado: "ok", antes: null, depois: null, atende: true }) }; };

  it("o binário do nod nunca roda `claude update`: só a reserva (o instalador)", () => {
    montados.length = 0;
    expect(passosPelaOrigem({ origem: "nod", args: ["update"], oficial, reserva }).map((p) => p.tipo)).toEqual(["reserva"]);
    expect(montados).toEqual([]);
  });

  it("sem binário ou sem atualizador conhecido (o Codex): só a reserva", () => {
    montados.length = 0;
    expect(passosPelaOrigem({ origem: null, args: ["update"], oficial, reserva }).map((p) => p.tipo)).toEqual(["reserva"]);
    expect(passosPelaOrigem({ origem: "nvm", args: null, oficial, reserva }).map((p) => p.tipo)).toEqual(["reserva"]);
    expect(montados).toEqual([]);
  });

  it("binário de fora: o oficial (`claude update`) e depois a reserva", () => {
    montados.length = 0;
    for (const origem of ["processo", "extra", "nvm", "shell", "node_do_nod", "path"] as OrigemDoBinario[]) {
      expect(passosPelaOrigem({ origem, args: ["update"], oficial, reserva }).map((p) => p.tipo)).toEqual(["oficial", "reserva"]);
    }
    expect(montados.every((a) => a.join(" ") === "update")).toBe(true);
  });
});
