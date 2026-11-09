import { describe, expect, it } from "vitest";
import { PISO_CLI } from "../../../src/adapters/executor/flag-floors.ts";
import type { IaDesktop } from "../../../src/contracts/desktop.ts";
import type { AtualizacaoDaIa } from "../../../src/contracts/estado-ia.ts";
import type { Inventario } from "../../../src/contracts/inventario.ts";
import type { FimDoPasso, PassoAtualizar } from "../../../desktop/atualizador-ias.ts";
import type { EstadoDoPedido } from "../../../motor/atualizar-ias.ts";
import { criarIasDoMotor, esperarNoTerminal, quemNaoPodeAtualizar, SAIDA_SEM_FIM, type DepsIasDoMotor } from "../../../motor/ias-do-motor.ts";

/** Devolução do #501 (2026-10-23): a fiação do motor, fora do main.ts, com passos falsos. */
function montar(o: { bin?: string; turnos?: IaDesktop[]; motorOcupado?: boolean; configurado?: boolean; segurar?: boolean } = {}) {
  let t = 1_000_000;
  const logs: [string, Record<string, unknown>][] = [];
  const s = { versao: "2.1.100", rodou: 0, turnos: o.turnos ?? [], motorOcupado: o.motorOcupado ?? false, soltar: (o.segurar === false ? () => undefined : null) as null | (() => void) };
  const passo: PassoAtualizar = {
    tipo: "npm_local",
    async rodar(): Promise<FimDoPasso> {
      s.rodou++;
      if (s.soltar === null) await new Promise<void>((r) => { s.soltar = r; });
      const antes = s.versao;
      s.versao = PISO_CLI["claude-cli"];
      return { resultado: "ok", antes, depois: s.versao, atende: true };
    },
  };
  const d: DepsIasDoMotor = {
    home: "/home/nod",
    bin: async () => o.bin ?? "/home/nod/.local/bin/claude",
    configurado: () => o.configurado ?? false,
    lerVersao: async () => s.versao,
    iasDosTurnos: () => s.turnos,
    motorOcupado: () => s.motorOcupado,
    passos: () => [passo],
    depois: () => undefined,
    aoMudar: () => undefined,
    ler: async () => null,
    gravar: async () => undefined,
    agora: () => t,
    hoje: () => "2026-10-23",
    agendar: () => ({ cancelar: () => undefined }),
    registrar: (e, c) => { logs.push([e, c]); },
    log: (_n, e, c) => { logs.push([e, c]); },
  };
  return { ias: criarIasDoMotor(d), s, logs, andar: (ms: number) => { t += ms; } };
}

const espera = () => new Promise((r) => setTimeout(r, 10));

describe("criarIasDoMotor", () => {
  it("o pedido da tela/terminal: 3 por hora por IA, o 4º é limite (com log); a hora seguinte volta a caber", async () => {
    const { ias, s, logs, andar } = montar();
    s.soltar = () => undefined;
    const r = [ias.pedirAtualizacao("claude-cli", "tela"), ias.pedirAtualizacao("claude-cli", "terminal"), ias.pedirAtualizacao("claude-cli", "tela"), ias.pedirAtualizacao("claude-cli", "tela")];
    expect(r.slice(0, 3).every((x) => x !== "limite")).toBe(true);
    expect(r[3]).toBe("limite");
    expect(logs).toContainEqual(["ia_atualizacao_limite", { ia: "claude-cli", origem: "tela" }]);
    await Promise.all(r.slice(0, 3));
    andar(60 * 60_000);
    expect(ias.pedirAtualizacao("claude-cli", "tela")).not.toBe("limite");
  });

  it("iasAtualizando: verdadeiro só enquanto o passo roda; o inventário vira ausente+atualizando", async () => {
    const { ias, s } = montar();
    expect(ias.iasAtualizando()).toBe(false);
    const fim = ias.pedirAtualizacao("claude-cli", "tela") as Promise<unknown>;
    while (s.rodou === 0) await espera();
    expect(ias.iasAtualizando()).toBe(true);
    const inv = ias.comAtualizacao({ "claude-cli": { estado: "pronto", versao: "2.1.100" } as Inventario })["claude-cli"];
    expect(inv).toMatchObject({ estado: "ausente" });
    expect((inv as { atualizacao?: AtualizacaoDaIa }).atualizacao?.fase).toBe("atualizando");
    s.soltar!();
    await fim;
    expect(ias.iasAtualizando()).toBe(false);
  });

  it("um turno da mesma IA segura a atualização; o de outra IA não", async () => {
    const outra = montar({ turnos: ["codex-cli"] });
    outra.s.soltar = () => undefined;
    await outra.ias.pedirAtualizacao("claude-cli", "tela");
    expect(outra.s.rodou).toBe(1);
    const mesma = montar({ turnos: ["claude-cli"] });
    mesma.s.soltar = () => undefined;
    void mesma.ias.pedirAtualizacao("claude-cli", "tela");
    await espera();
    expect(mesma.s.rodou).toBe(0);
    expect(mesma.ias.atualizador.estado("claude-cli")?.fase).toBe("esperando");
  });

  it("o motor ocupado (pedido ao root, drenando) conta como turno em toda IA", async () => {
    const { ias, s } = montar({ motorOcupado: true });
    void ias.pedirAtualizacao("claude-cli", "tela");
    await espera();
    expect(s.rodou).toBe(0);
  });

  it("binário fora do ~/.local: log ia_binario uma vez por caminho; dentro dele ou configurado, nenhum", async () => {
    const fora = montar({ bin: "/usr/local/bin/claude", segurar: false });
    await fora.ias.atualizador.verificar();
    await fora.ias.atualizador.verificar();
    expect(fora.logs.filter(([e]) => e === "ia_binario")).toEqual([["ia_binario", { ia: "claude-cli", fora_do_local: true, bin: "/usr/local/bin/claude", versao: "2.1.100" }]]);
    const dentro = montar({ segurar: false });
    await dentro.ias.atualizador.verificar();
    expect(dentro.logs.some(([e]) => e === "ia_binario")).toBe(false);
    const configurado = montar({ bin: "/opt/claude", configurado: true, segurar: false });
    await configurado.ias.atualizador.verificar();
    expect(configurado.logs.some(([e]) => e === "ia_binario")).toBe(false);
  });

  it("concorrência: dois pedidos ao mesmo tempo rodam o passo uma vez só", async () => {
    const { ias, s } = montar();
    const a = ias.pedirAtualizacao("claude-cli", "tela") as Promise<unknown>;
    const b = ias.pedirAtualizacao("claude-cli", "terminal") as Promise<unknown>;
    while (s.rodou === 0) await espera();
    s.soltar!();
    await Promise.all([a, b]);
    expect(s.rodou).toBe(1);
  });
});

describe("quemNaoPodeAtualizar (sudo)", () => {
  const ids = (uid: number | null, euid: number | null = uid) => ({ uid, euid });
  it("o dono da pasta roda; root (sudo) e outro usuário são recusados", () => {
    expect(quemNaoPodeAtualizar(ids(1001), 1001)).toBeNull();
    expect(quemNaoPodeAtualizar(ids(0), 1001)).toMatch(/root/);
    expect(quemNaoPodeAtualizar(ids(1002), 1001)).toMatch(/usuário do motor/);
    expect(quemNaoPodeAtualizar(ids(null), 1001)).toBeNull();
    expect(quemNaoPodeAtualizar(ids(1001), null)).toBeNull();
  });
  it("QA do #501 (achado 3): sudo com HOME=/root (pasta de root ou inexistente) é recusado; euid 0 também", () => {
    expect(quemNaoPodeAtualizar(ids(0), 0)).toMatch(/root/);
    expect(quemNaoPodeAtualizar(ids(0), null)).toMatch(/root/);
    expect(quemNaoPodeAtualizar(ids(1001, 0), 1001)).toMatch(/root/);
    expect(quemNaoPodeAtualizar(ids(0, 1001), 1001)).toMatch(/root/);
    expect(quemNaoPodeAtualizar(ids(1001, 1002), 1001)).toMatch(/usuário do motor/);
  });
});

describe("esperarNoTerminal", () => {
  const ia = "claude-cli" as const;
  function terminal(estados: (EstadoDoPedido | null)[], o: { passo?: number } = {}) {
    let t = 0;
    const out: string[] = [];
    const err: string[] = [];
    const fila = [...estados];
    const r = esperarNoTerminal({
      nome: "Claude Code", ia, pedidoEm: 0,
      lerEstado: async () => (fila.length > 1 ? fila.shift()! : fila[0] ?? null),
      esperar: async () => { t += o.passo ?? 1_000; },
      agora: () => t,
      escrever: (x) => out.push(x), erro: (x) => err.push(x),
      esperaDaRespostaMs: 15_000, esperaDoServicoMs: 5 * 60_000,
    });
    return { r, out, err };
  }
  const a = (fase: AtualizacaoDaIa["fase"], em = 1): AtualizacaoDaIa => ({ fase, em, alvo: "2.1.290" });
  const e = (atualizacao: AtualizacaoDaIa | null, extra: Partial<EstadoDoPedido> = {}): EstadoDoPedido => ({ ia, pedidoEm: 0, atendido: false, atualizacao, ...extra });

  it("sem resposta em 15 s: direto (o terminal roda o npm)", async () => {
    expect(await terminal([null]).r).toBe("direto");
  });

  it("o serviço respondeu e o fim não veio no prazo (motor reiniciou): sai com 75, nunca 0, e diz por quê", async () => {
    const { r, err } = terminal([e(a("atualizando"))]);
    expect(await r).toBe(SAIDA_SEM_FIM);
    expect(SAIDA_SEM_FIM).not.toBe(0);
    expect(err.join("")).toMatch(/reiniciou/);
  });

  it("sucesso 0, falhou 1, limite 1, em dia 0", async () => {
    expect(await terminal([e(a("atualizando")), e(a("sucesso", 5))]).r).toBe(0);
    expect(await terminal([e(a("falhou", 5))]).r).toBe(1);
    expect(await terminal([e(null, { atendido: true, recusado: "limite" })]).r).toBe(1);
    expect(await terminal([e(null, { atendido: true })]).r).toBe(0);
  });

  it("o estado de outro pedido não conta como resposta", async () => {
    expect(await terminal([e(a("sucesso", 5), { pedidoEm: 999 })]).r).toBe("direto");
  });
});
