import { mkdir, mkdtemp, readFile, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { criarContasLocais, inventariosComContas, type IdentidadeDaConta } from "../../../desktop/contas-locais.ts";
import { iniciarContasNoServidor } from "../../../desktop/contas-no-servidor.ts";
import { concluirLoginArmado } from "../../../desktop/login-armado.ts";
import type { IaDesktop } from "../../../src/contracts/desktop.ts";
import type { ContaAnunciada, PuxadaDeContas } from "../../../src/contracts/contas-ia.ts";
import type { Inventario } from "../../../src/contracts/inventario.ts";
import { estadoDaMaquina } from "../../../src/domain/harness.ts";
import { decidirAnuncio } from "../../../src/domain/contas-da-pessoa.ts";

/**
 * ADR-102 no app do Mac (2026-10-13): a lista que vai ao servidor segue a do app (contas.json, ADR-101), o e-mail e a
 * organização ficam na memória (para a tela e, ADR-105, para o anúncio), nunca no arquivo, e a puxada atende "Sair do Mac" e "Desconectar".
 */
async function montar(identidades: Record<string, IdentidadeDaConta>, aoLogout: (env: Record<string, string>) => void = () => undefined) {
  const raiz = await mkdtemp(join(tmpdir(), "nod-contas-locais-"));
  const arquivo = join(raiz, "contas-locais.json");
  const contas = criarContasLocais({
    base: raiz,
    arquivo,
    pessoaId: "pessoa-1",
    padrao: (ia) => join(raiz, ia),
    // O ambiente diz qual pasta: a conta de sempre não tem variável.
    lerIdentidade: async (ia: IaDesktop, env) => identidades[`${ia}:${Object.values(env)[0]?.split("/").at(-1) ?? "padrao"}`] ?? { logado: false, email: null, orgId: null, plano: null },
    logout: async (_ia, env) => { aoLogout(env); return true; },
    agora: Date.now,
  });
  await contas.carregar();
  return { contas, arquivo };
}

const LUMEN: IdentidadeDaConta = { logado: true, email: "pessoa1@exemplo.com", orgId: "org-lumen", plano: "Team", organizacao: "Lumen" };
const PESSOAL: IdentidadeDaConta = { logado: true, email: "marlon@exemplo.com", orgId: "org-p", plano: "Max", organizacao: null };

describe("contas locais no app do Mac (ADR-102)", () => {
  it("NOD-283: a conta sem acesso fica assim (e no arquivo) com o mesmo login; um login noutra conta a solta", async () => {
    const ids: Record<string, IdentidadeDaConta> = { "claude-cli:c-1": LUMEN };
    const m = await montar(ids);
    await m.contas.sincronizar([{ ia: "claude-cli", id: "c-1", apelido: "Lumen" }]);
    await m.contas.ler({ forcar: true });
    const impressao = m.contas.anuncio()[0]!.impressao;
    expect(await m.contas.marcarSemAcesso(impressao)).toBe(true);
    expect(await m.contas.marcarSemAcesso(impressao)).toBe(false);
    await m.contas.ler({ forcar: true });
    expect(m.contas.anuncio()[0]).toMatchObject({ impressao, estado: "sem_acesso" });
    expect(await readFile(m.arquivo, "utf8")).toContain("sem_acesso");
    ids["claude-cli:c-1"] = { ...LUMEN, email: "outra@exemplo.com" };
    await m.contas.ler({ forcar: true });
    expect(m.contas.anuncio().find((c) => c.impressao !== impressao)?.estado).toBe("pronta");
  });

  it("segue a lista do app: conta nova entra e é lida, a que saiu some do anúncio", async () => {
    const m = await montar({ "claude-cli:padrao": PESSOAL, "claude-cli:c-1": LUMEN });
    await m.contas.sincronizar([{ ia: "claude-cli", id: "padrao", apelido: "Pessoal" }, { ia: "claude-cli", id: "c-1", apelido: "Lumen" }, { ia: "codex-cli", id: "padrao", apelido: null }]);
    await m.contas.ler();
    // O apelido igual à organização da conta não sai (red team do PR #306: a ADR-101 o tirava da organização).
    expect(m.contas.anuncio().map((c) => c.apelidoSugerido)).toEqual(["Pessoal", undefined]);
    const sairam = await m.contas.sincronizar([{ ia: "claude-cli", id: "padrao", apelido: "Pessoal" }]);
    expect(sairam.map((c) => c.id)).toEqual(["c-1"]);
    expect(m.contas.anuncio()).toHaveLength(1);
  });

  it("ADR-105: e-mail e organização vão nos detalhes e no anúncio, nunca no arquivo", async () => {
    const m = await montar({ "claude-cli:c-1": LUMEN });
    await m.contas.sincronizar([{ ia: "claude-cli", id: "c-1", apelido: null }]);
    await m.contas.ler();
    expect(m.contas.detalhes()).toEqual([expect.objectContaining({ ia: "claude-cli", email: "pessoa1@exemplo.com", organizacao: "Lumen", plano: "Team" })]);
    expect(m.contas.detalhes()[0]!.impressao).toBe(m.contas.anuncio()[0]!.impressao);
    expect(m.contas.anuncio()[0]).toMatchObject({ email: "pessoa1@exemplo.com", organizacao: "Lumen" });
    expect(await readFile(m.arquivo, "utf8")).not.toContain("exemplo.com");
  });

  it("ADR-105: a conta carregada do arquivo e ainda não relida vai sem e-mail (o servidor mantém o que tinha)", async () => {
    const m = await montar({ "claude-cli:c-1": LUMEN });
    await m.contas.sincronizar([{ ia: "claude-cli", id: "c-1", apelido: null }]);
    await m.contas.ler();
    // O app reaberto: carrega o arquivo e anuncia antes de reler o CLI.
    const raiz = dirname(m.arquivo);
    const reaberta = criarContasLocais({ base: raiz, arquivo: m.arquivo, pessoaId: "pessoa-1", padrao: (ia) => join(raiz, ia), lerIdentidade: async () => LUMEN, logout: async () => true, agora: Date.now });
    await reaberta.carregar();
    expect(reaberta.anuncio()[0]).toMatchObject({ impressao: m.contas.anuncio()[0]!.impressao });
    expect(reaberta.anuncio()[0]).not.toHaveProperty("email");
    expect(reaberta.anuncio()[0]).not.toHaveProperty("organizacao");
  });

  it("red team do PR #306: entre duas cópias da mesma conta, vale a pronta (a vencida não esconde o login novo)", async () => {
    const m = await montar({ "claude-cli:padrao": LUMEN, "claude-cli:c-1": LUMEN });
    await m.contas.sincronizar([{ ia: "claude-cli", id: "padrao", apelido: null }, { ia: "claude-cli", id: "c-1", apelido: null }]);
    await m.contas.ler();
    // A de sempre perde o login; a c-1 segue pronta com a mesma conta.
    const padrao = m.contas.porId("padrao", "claude-cli")!;
    Object.assign(padrao, { estado: "sem_login" });
    expect(m.contas.anuncio()).toEqual([expect.objectContaining({ estado: "pronta" })]);
    expect(m.contas.porImpressao(m.contas.anuncio()[0]!.impressao)?.id).toBe("c-1");
  });

  it("red team do PR #306: o login novo reaproveita a conta de sempre vencida (o `nod-motor entrar` renova o login)", async () => {
    const m = await montar({ "claude-cli:padrao": LUMEN });
    await m.contas.sincronizar([{ ia: "claude-cli", id: "padrao", apelido: null }]);
    await m.contas.ler();
    Object.assign(m.contas.porId("padrao", "claude-cli")!, { estado: "sem_login" });
    expect((await m.contas.pastaParaLogin("claude-cli", null))?.id).toBe("padrao");
  });

  // Regression: ISSUE-002/006 — a mesma conta logada na pasta de sempre e numa pasta nova ficava nas duas, e o "Sair"
  // fazia logout só numa (a conta continuava na máquina). Found by /qa on 2026-10-13.
  it("QA do PR #306: com a mesma conta em duas pastas prontas, a repetida sai e a de sempre fica; o Sair faz logout em todas", async () => {
    const logouts: string[] = [];
    const m = await montar({ "claude-cli:padrao": LUMEN, "claude-cli:c-1": LUMEN, "claude-cli:c-2": LUMEN }, (env) => { logouts.push(Object.values(env)[0]?.split("/").at(-1) ?? "padrao"); });
    await m.contas.sincronizar([{ ia: "claude-cli", id: "padrao", apelido: null }, { ia: "claude-cli", id: "c-1", apelido: null }, { ia: "claude-cli", id: "c-2", apelido: null }]);
    await m.contas.ler();
    Object.assign(m.contas.porId("c-1", "claude-cli")!, { logadaEm: Date.now() + 5 });
    expect(await m.contas.descartarRepetidas()).toBe(2);
    expect(m.contas.listar().filter((c) => c.ia === "claude-cli").map((c) => c.id)).toEqual(["padrao"]);
    // Duas cópias de novo (o login pela tela numa pasta nova): o Sair sai das duas.
    const m2 = await montar({ "claude-cli:padrao": LUMEN, "claude-cli:c-1": LUMEN }, (env) => { logouts.push(Object.values(env)[0]?.split("/").at(-1) ?? "padrao"); });
    await m2.contas.sincronizar([{ ia: "claude-cli", id: "padrao", apelido: null }, { ia: "claude-cli", id: "c-1", apelido: null }]);
    await m2.contas.ler();
    logouts.length = 0;
    await m2.contas.sair(m2.contas.anuncio()[0]!.impressao);
    expect(logouts.sort()).toEqual(["c-1", "padrao"]);
    expect(m2.contas.anuncio()).toEqual([]);
  });

  it("a mesma conta em duas pastas vai ao servidor uma vez só", async () => {
    const m = await montar({ "claude-cli:padrao": LUMEN, "claude-cli:c-1": LUMEN });
    await m.contas.sincronizar([{ ia: "claude-cli", id: "padrao", apelido: null }, { ia: "claude-cli", id: "c-1", apelido: null }]);
    await m.contas.ler();
    expect(m.contas.anuncio()).toHaveLength(1);
  });
});

/**
 * NOD-293 C10 (definido em 2026-10-20): a conta removida pela tela voltava sozinha quando uma máquina a lia pela primeira
 * vez (app reinstalado, `contas-locais.json` perdido): o `logadaEm` era a hora da leitura, sempre depois da remoção, e o
 * servidor a devolvia à lista. Agora o login conta da data do arquivo da credencial (só na primeira leitura) ou da hora em
 * que o nod armou o login (`pastaParaLogin`, `armar`); sem arquivo e sem login pelo nod, 0.
 */
describe("NOD-293 C10: quando a conta foi logada", () => {
  const HORA = 3_600_000;
  const REMOVIDA = Date.UTC(2026, 9, 20, 12, 0);

  async function montarComRelogio(identidades: Record<string, IdentidadeDaConta>, raizDada?: string) {
    const raiz = raizDada ?? await mkdtemp(join(tmpdir(), "nod-contas-c10-"));
    const relogio = { agora: REMOVIDA + HORA };
    const criar = () => criarContasLocais({
      base: raiz,
      arquivo: join(raiz, "contas-locais.json"),
      pessoaId: "pessoa-1",
      padrao: (ia) => join(raiz, ia),
      lerIdentidade: async (ia: IaDesktop, env) => identidades[`${ia}:${Object.values(env)[0]?.split("/").at(-1) ?? "padrao"}`] ?? { logado: false, email: null, orgId: null, plano: null },
      logout: async () => true,
      agora: () => relogio.agora,
    });
    const contas = criar();
    await contas.carregar();
    return { contas, raiz, relogio, criar };
  }

  /** A credencial em arquivo do Claude na conta de sempre (Linux; no Mac ela mora no Keychain e não há arquivo). */
  async function credencial(raiz: string, mtime: number, ia: IaDesktop = "claude-cli"): Promise<string> {
    await mkdir(join(raiz, ia), { recursive: true });
    const arquivo = join(raiz, ia, ia === "claude-cli" ? ".credentials.json" : "auth.json");
    await writeFile(arquivo, "{}");
    await utimes(arquivo, new Date(mtime), new Date(mtime));
    return arquivo;
  }

  it("removida em T, credencial gravada antes de T, primeira leitura: o servidor pede a saída (não devolve a conta)", async () => {
    const m = await montarComRelogio({ "claude-cli:padrao": LUMEN });
    await credencial(m.raiz, REMOVIDA - 2 * HORA);
    await m.contas.ler({ forcar: true });
    const [a] = m.contas.anuncio();
    expect(a!.logadaEm).toBe(REMOVIDA - 2 * HORA);
    expect(decidirAnuncio({ removidaEm: REMOVIDA }, a!.logadaEm)).toBe("sair");
  });

  it("o Codex usa o auth.json da pasta da conta", async () => {
    const m = await montarComRelogio({ "codex-cli:padrao": PESSOAL });
    await credencial(m.raiz, REMOVIDA - HORA, "codex-cli");
    await m.contas.ler({ forcar: true });
    expect(m.contas.anuncio().find((c) => c.ia === "codex-cli")?.logadaEm).toBe(REMOVIDA - HORA);
  });

  it("a renovação do token reescreve o arquivo depois da remoção: o login continua contando da primeira leitura", async () => {
    const m = await montarComRelogio({ "claude-cli:padrao": LUMEN });
    const arquivo = await credencial(m.raiz, REMOVIDA - 2 * HORA);
    await m.contas.ler({ forcar: true });
    // O CLI renovou o token depois da remoção: o arquivo ganha data nova, a conta é a mesma.
    await utimes(arquivo, new Date(REMOVIDA + 30 * 60_000), new Date(REMOVIDA + 30 * 60_000));
    m.relogio.agora += 2 * HORA;
    await m.contas.ler({ forcar: true });
    expect(decidirAnuncio({ removidaEm: REMOVIDA }, m.contas.anuncio()[0]!.logadaEm)).toBe("sair");
    // E o app reaberto (lê o arquivo de contas) também.
    const reaberta = m.criar();
    await reaberta.carregar();
    await reaberta.ler({ forcar: true });
    expect(decidirAnuncio({ removidaEm: REMOVIDA }, reaberta.anuncio()[0]!.logadaEm)).toBe("sair");
  });

  it("sem arquivo de credencial (Keychain do Mac) e sem login pelo nod: logadaEm 0", async () => {
    const m = await montarComRelogio({ "claude-cli:padrao": LUMEN });
    await m.contas.ler({ forcar: true });
    expect(m.contas.anuncio()[0]!.logadaEm).toBe(0);
  });

  it("entrar de novo pelo `nod-motor entrar` (outro processo) depois da remoção: a conta volta de propósito", async () => {
    const ids: Record<string, IdentidadeDaConta> = {};
    const m = await montarComRelogio(ids);
    // O `nod-motor entrar` escolhe a pasta (arma o login) e grava; o login em si é do CLI, no terminal.
    const entrar = m.criar();
    await entrar.carregar();
    expect((await entrar.pastaParaLogin("claude-cli", null))?.id).toBe("padrao");
    expect(await readFile(join(m.raiz, "contas-locais.json"), "utf8")).toContain(`"armadaEm":${REMOVIDA + HORA}`);
    // O serviço relê o arquivo de contas e acha o login; a credencial veio com uma data qualquer (antes da remoção).
    ids["claude-cli:padrao"] = LUMEN;
    await credencial(m.raiz, REMOVIDA - 5 * HORA);
    m.relogio.agora += 60_000;
    await m.contas.carregar();
    await m.contas.ler({ forcar: true });
    expect(decidirAnuncio({ removidaEm: REMOVIDA }, m.contas.anuncio()[0]!.logadaEm)).toBe("voltar");
  });

  it("login pela tela do app do Mac (`armar` antes do login): a conta nova da lista do app volta; sem armar, não", async () => {
    const ids: Record<string, IdentidadeDaConta> = { "claude-cli:c-1": LUMEN };
    const m = await montarComRelogio(ids);
    await mkdir(join(m.raiz, "claude-cli", "c-1"), { recursive: true });
    await m.contas.armar("claude-cli");
    // A conta nova entra pela lista do app depois do login (sincronizar) e é lida.
    m.relogio.agora += 60_000;
    await m.contas.sincronizar([{ ia: "claude-cli", id: "c-1", apelido: null }]);
    await m.contas.ler({ forcar: true });
    expect(decidirAnuncio({ removidaEm: REMOVIDA }, m.contas.anuncio()[0]!.logadaEm)).toBe("voltar");
    // Outra máquina (outro app), sem login pelo nod: a mesma conta lida pela primeira vez não volta.
    const outra = await montarComRelogio({ "claude-cli:c-1": LUMEN });
    await mkdir(join(outra.raiz, "claude-cli", "c-1"), { recursive: true });
    await outra.contas.sincronizar([{ ia: "claude-cli", id: "c-1", apelido: null }]);
    await outra.contas.ler({ forcar: true });
    expect(decidirAnuncio({ removidaEm: REMOVIDA }, outra.contas.anuncio()[0]!.logadaEm)).toBe("sair");
  });
  /** Revisor do PR #429: a conta re-adicionada pela tela do Mac (Keychain, sem arquivo) só volta se a leitura vier antes do desarme. */
  it("conta adicionada com sucesso: a sincronização lê a conta com o marcador armado e só depois ele sai", async () => {
    const ids: Record<string, IdentidadeDaConta> = {};
    const m = await montarComRelogio(ids);
    await mkdir(join(m.raiz, "claude-cli", "c-1"), { recursive: true });
    await m.contas.armar("claude-cli");
    ids["claude-cli:c-1"] = LUMEN;
    m.relogio.agora += 60_000;
    const ordem: string[] = [];
    await concluirLoginArmado({
      antes: async () => { ordem.push("antes"); },
      sincronizar: async () => { ordem.push("sincronizar"); await m.contas.sincronizar([{ ia: "claude-cli", id: "c-1", apelido: null }]); await m.contas.ler({ forcar: true }); },
      desarmar: async () => { ordem.push("desarmar"); await m.contas.desarmar("claude-cli"); },
    });
    expect(ordem).toEqual(["antes", "sincronizar", "desarmar"]);
    expect(decidirAnuncio({ removidaEm: REMOVIDA }, m.contas.anuncio()[0]!.logadaEm)).toBe("voltar");
    expect(await readFile(join(m.raiz, "contas-locais.json"), "utf8")).not.toMatch(/"armadaEm":[1-9]/);
  });

  it("a ordem antiga (desarmar antes da sincronização) deixava a conta re-adicionada removida", async () => {
    const m = await montarComRelogio({ "claude-cli:c-1": LUMEN });
    await mkdir(join(m.raiz, "claude-cli", "c-1"), { recursive: true });
    await m.contas.armar("claude-cli");
    m.relogio.agora += 60_000;
    await m.contas.desarmar("claude-cli");
    await m.contas.sincronizar([{ ia: "claude-cli", id: "c-1", apelido: null }]);
    await m.contas.ler({ forcar: true });
    expect(decidirAnuncio({ removidaEm: REMOVIDA }, m.contas.anuncio()[0]!.logadaEm)).toBe("sair");
  });

  it("a sincronização falhou: o marcador sai do mesmo jeito", async () => {
    const m = await montarComRelogio({});
    await m.contas.armar("claude-cli", "padrao");
    await expect(concluirLoginArmado({ sincronizar: async () => { throw new Error("x"); }, desarmar: () => m.contas.desarmar("claude-cli") })).rejects.toThrow("x");
    expect(await readFile(join(m.raiz, "contas-locais.json"), "utf8")).not.toMatch(/"armadaEm":[1-9]/);
  });

  // Revisor do PR #429: o `iaEntrar` arma e o login não acontece (CLI não instalado, erro ao abrir, saída ≠ 0): desarma.
  it("armar → desarmar (login que não aconteceu) → o login que aparecer depois por fora não volta a conta", async () => {
    const ids: Record<string, IdentidadeDaConta> = {};
    const m = await montarComRelogio(ids);
    await m.contas.armar("claude-cli");
    await m.contas.desarmar("claude-cli");
    // Mais tarde, a pessoa entra pelo terminal (Keychain, sem arquivo): não foi pedido pelo nod.
    ids["claude-cli:padrao"] = LUMEN;
    m.relogio.agora += 60_000;
    await m.contas.ler({ forcar: true });
    expect(decidirAnuncio({ removidaEm: REMOVIDA }, m.contas.anuncio()[0]!.logadaEm)).toBe("sair");
  });
});

describe("puxada de contas no app do Mac (ADR-102)", () => {
  const agendar = (fn: () => void, ms: number) => { const t = setTimeout(fn, ms === 0 ? 0 : 10); return { cancelar: () => clearTimeout(t) }; };
  const esperar = async (cond: () => boolean) => { const ate = Date.now() + 2_000; while (!cond()) { if (Date.now() > ate) throw new Error("tempo"); await new Promise((r) => setTimeout(r, 5)); } };

  it("sair: sai de cada conta pedida e confirma ao servidor", async () => {
    const respostas: (PuxadaDeContas | "sem_rota")[] = [{ logins: [], sair: ["a".repeat(64)], desconectar: false }];
    const saiu: unknown[] = [];
    const sairam: string[] = [];
    const p = iniciarContasNoServidor({ ponte: { puxar: async () => respostas.shift() ?? { logins: [], sair: [], desconectar: false }, saiu: async (i, d) => { saiu.push({ i, d }); return true; } }, sair: async (i) => { sairam.push(i); return true; }, todas: () => [], desconectar: async () => undefined, agendar });
    await esperar(() => saiu.length > 0);
    p.parar();
    expect(sairam).toEqual(["a".repeat(64)]);
    expect(saiu).toEqual([{ i: ["a".repeat(64)], d: false }]);
  });

  it("desconectar com 'sair das contas': sai de todas, confirma desconectada e para", async () => {
    const saiu: unknown[] = [];
    let desconectou = false;
    let puxadas = 0;
    iniciarContasNoServidor({ ponte: { puxar: async () => { puxadas++; return { logins: [], sair: [], desconectar: true }; }, saiu: async (i, d) => { saiu.push({ i, d }); return true; } }, sair: async () => true, todas: () => ["b".repeat(64)], desconectar: async () => { desconectou = true; }, agendar });
    await esperar(() => desconectou);
    await new Promise((r) => setTimeout(r, 40));
    expect(saiu).toEqual([{ i: ["b".repeat(64)], d: true }]);
    expect(puxadas).toBe(1);
  });

  it("ADA-245: removido por outro lugar leva as opções ao desconectar; com 'Continuar ligado' não sai das contas", async () => {
    for (const remover of [{ manterIas: false, manterConexao: false }, { manterIas: true, manterConexao: true }]) {
      const saiu: unknown[] = [];
      const sairam: string[] = [];
      let recebido: unknown = "nada";
      iniciarContasNoServidor({ ponte: { puxar: async () => ({ logins: [], sair: [], desconectar: !remover.manterConexao, remover }), saiu: async (i, d) => { saiu.push({ i, d }); return true; } }, sair: async (i) => { sairam.push(i); return true; }, todas: () => ["c".repeat(64)], desconectar: async (r) => { recebido = r; }, agendar });
      await esperar(() => recebido !== "nada");
      expect(recebido).toEqual(remover);
      expect(sairam).toEqual(remover.manterConexao ? [] : ["c".repeat(64)]);
      expect(saiu).toEqual([{ i: remover.manterConexao ? [] : ["c".repeat(64)], d: true }]);
    }
  });

  it("servidor sem contas (404): para de puxar", async () => {
    let puxadas = 0;
    iniciarContasNoServidor({ ponte: { puxar: async () => { puxadas++; return "sem_rota"; }, saiu: async () => true }, sair: async () => true, todas: () => [], desconectar: async () => undefined, agendar });
    await new Promise((r) => setTimeout(r, 60));
    expect(puxadas).toBe(1);
  });
});

// #313: o anúncio (motor/main.ts e desktop/main.ts) manda `estadoDaMaquina(principal, inventariosComContas(…))`. Antes mandava
// `comContas["claude-cli"] ?? principal`: com o Claude sempre instalado, a máquina só com o ChatGPT nunca ficava pronta.
describe("o estado da máquina no anúncio (#313)", () => {
  const semLogin: Inventario = { estado: "nao_autenticado", motivo: "Entre na conta do harness neste computador", em: 1 };
  const conta = (ia: ContaAnunciada["ia"]): ContaAnunciada => ({ impressao: "a".repeat(64), ia, estado: "pronta", plano: null, corporativa: false, logadaEm: 1 });

  it("só o Codex pronto: a máquina vai pronta pelo Codex", () => {
    const comContas = inventariosComContas({ "claude-cli": semLogin, "codex-cli": { estado: "pronto", versao: "0.162.0", em: 2 } }, []);
    expect(estadoDaMaquina(semLogin, comContas)).toMatchObject({ estado: "pronto", versao: "0.162.0" });
  });

  it("red team do PR #306 continua: a conta de sempre deslogada e outra conta Claude pronta deixam a máquina pronta", () => {
    const comContas = inventariosComContas({ "claude-cli": semLogin, "codex-cli": semLogin }, [conta("claude-cli")]);
    expect(estadoDaMaquina(semLogin, comContas)).toMatchObject({ estado: "pronto" });
  });

  it("nenhuma IA pronta nem conta pronta: vai a explicação da vigia (`principal`)", () => {
    const principal: Inventario = { estado: "nao_autenticado", causa: "teste_falhou", motivo: "testei e não respondeu", em: 3 };
    expect(estadoDaMaquina(principal, inventariosComContas({ "claude-cli": semLogin, "codex-cli": semLogin }, []))).toBe(principal);
  });

  // NOD-283 A5 (QA do PR #337): a sonda testa a conta de sempre; reprovada por um teste de verdade, essa conta pronta na
  // lista local não pode reanunciar o Claude como pronto. Outra conta (outro login) pronta ainda promove.
  it("NOD-283: o teste reprovou a conta de sempre: ela não promove a IA; a Max (outro login) pronta promove", async () => {
    const m = await montar({ "claude-cli:padrao": PESSOAL, "claude-cli:c-1": LUMEN });
    await m.contas.sincronizar([{ ia: "claude-cli", id: "padrao", apelido: "Pessoal" }]);
    await m.contas.ler({ forcar: true });
    const padrao = m.contas.impressoesDaPadrao();
    expect(padrao["claude-cli"]).toBe(m.contas.anuncio()[0]!.impressao);
    const reprovado: Inventario = { estado: "nao_autenticado", causa: "conta_sem_acesso", motivo: "a conta não tem acesso", em: 4 };
    const so = inventariosComContas({ "claude-cli": reprovado }, m.contas.anuncio(), padrao);
    expect(so["claude-cli"]).toBe(reprovado);
    expect(inventariosComContas({ "claude-cli": { ...reprovado, causa: "teste_falhou" } }, m.contas.anuncio(), padrao)["claude-cli"]?.estado).toBe("nao_autenticado");
    // Sem causa de teste (só não logada), a regra do #306 continua: a conta pronta promove.
    expect(inventariosComContas({ "claude-cli": semLogin }, m.contas.anuncio(), padrao)["claude-cli"]?.estado).toBe("pronto");
    await m.contas.sincronizar([{ ia: "claude-cli", id: "padrao", apelido: "Pessoal" }, { ia: "claude-cli", id: "c-1", apelido: "Lumen" }]);
    await m.contas.ler({ forcar: true });
    expect(m.contas.anuncio().filter((c) => c.estado === "pronta")).toHaveLength(2);
    expect(inventariosComContas({ "claude-cli": reprovado }, m.contas.anuncio(), m.contas.impressoesDaPadrao())["claude-cli"]?.estado).toBe("pronto");
  });
});
