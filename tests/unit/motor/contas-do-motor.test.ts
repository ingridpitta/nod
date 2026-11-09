import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ProgressoDoLogin, PuxadaDeContas } from "../../../src/contracts/contas-ia.ts";
import { textoDaImpressaoDaConta } from "../../../src/domain/contas-da-pessoa.ts";
import { criarContasLocais } from "../../../desktop/contas-locais.ts";
import { iniciarContasDoMotor, lerIdentidadeNoCli, logoutNoCli, type ClisDoMotor } from "../../../motor/contas.ts";
import { cifrarCodigo } from "../../../web/lib/cifra.ts";
import type { FimDoPreparo, PassoDoPreparo, PreparoNoMotor } from "../../../motor/preparo-do-login.ts";

/**
 * ADR-102 item 3, no motor: o login de uma conta pela tela, de ponta a ponta com um `claude` falso. O motor puxa o
 * pedido, roda o login numa pasta de conta nova, sobe o link oficial e a chave pública, recebe o código cifrado,
 * decifra e entrega ao CLI; no fim relata `pronto` com a impressão (e-mail + organização + pessoa, nunca em claro).
 * Depois, "Sair desta máquina" faz o logout na pasta da conta e avisa o servidor.
 */
const PESSOA = "pessoa-1";
const parados: (() => void)[] = [];
afterEach(() => { for (const p of parados.splice(0)) p(); });

async function montar(o: { logoutFalha?: boolean; preparo?: PreparoNoMotor; responder?: (p: ProgressoDoLogin) => boolean | "recusado" } = {}) {
  const raiz = await mkdtemp(join(tmpdir(), "nod-contas-motor-"));
  const bin = join(raiz, "claude.mjs");
  await copyFile(new URL("../../fixtures/login-ia/claude-login-falso.mjs", import.meta.url), bin);
  await chmod(bin, 0o755);
  const casa = join(raiz, "casa");
  await mkdir(casa, { recursive: true });
  const clis: ClisDoMotor = { bin: async (ia) => (ia === "claude-cli" ? bin : null), envBase: () => ({ PATH: process.env.PATH ?? "", HOME: casa, CODIGO_CERTO: "codigo-certo-123", EMAIL_FALSO: "Pessoa1@exemplo.com", ORG_FALSA: "org-lumen", ...(o.logoutFalha ? { LOGOUT_FALHA: "1" } : {}) }), home: casa, versao: "teste" };
  const arquivo = join(raiz, "contas-locais.json");
  const contas = criarContasLocais({ base: raiz, arquivo, pessoaId: PESSOA, padrao: (ia) => join(casa, ia === "claude-cli" ? ".claude" : ".codex"), lerIdentidade: (ia, env) => lerIdentidadeNoCli(clis, ia, env), logout: (ia, env) => logoutNoCli(clis, ia, env), agora: Date.now });
  await contas.carregar();
  const progresso: ProgressoDoLogin[] = [];
  const saidas: { impressoes: string[]; desconectada: boolean }[] = [];
  const respostas: (PuxadaDeContas | "sem_rota")[] = [];
  let reanuncios = 0;
  let desconectou = false;
  let remocao: unknown = "nenhuma";
  const atualizar: string[] = [];
  const motor = iniciarContasDoMotor({
    ponte: {
      puxar: async () => respostas.shift() ?? { logins: [], sair: [], desconectar: false },
      progresso: async (p) => { progresso.push(p); return o.responder?.(p) ?? true; },
      saiu: async (impressoes, desconectada) => { saidas.push({ impressoes, desconectada }); return true; },
    },
    contas, clis, arquivo,
    reanunciar: async () => { reanuncios++; },
    desconectar: async (remover) => { desconectou = true; remocao = remover; },
    atualizar: (ia) => { atualizar.push(ia); },
    ...(o.preparo ? { preparo: o.preparo } : {}),
    agora: Date.now,
    agendar: (fn, ms) => { const t = setTimeout(fn, ms <= 3_000 ? 15 : ms); return { cancelar: () => clearTimeout(t) }; },
  });
  parados.push(() => motor.parar());
  const esperar = async (cond: () => boolean, ms = 10_000) => {
    const ate = Date.now() + ms;
    while (!cond()) { if (Date.now() > ate) throw new Error("tempo"); await new Promise((r) => setTimeout(r, 20)); }
  };
  return { contas, progresso, saidas, respostas, esperar, arquivo, atualizar, get reanuncios() { return reanuncios; }, get desconectou() { return desconectou; }, get remocao() { return remocao; } };
}

/** Um login completo pela tela (o código certo), até o `pronto`. */
async function logar(m: Awaited<ReturnType<typeof montar>>): Promise<void> {
  const id = "55555555-5555-4555-8555-555555555555";
  m.respostas.push({ logins: [{ id, ia: "claude-cli", impressao: null, apelido: null }], sair: [], desconectar: false });
  await m.esperar(() => m.progresso.some((p) => p.fase === "aguardando_pessoa"));
  const chave = m.progresso.find((p) => p.fase === "aguardando_pessoa")!.chavePublica!;
  m.respostas.push({ logins: [{ id, ia: "claude-cli", impressao: null, apelido: null, codigo: await cifrarCodigo(chave, "codigo-certo-123") }], sair: [], desconectar: false });
  await m.esperar(() => m.progresso.some((p) => p.fase === "pronto"));
}

const impressaoEsperada = createHash("sha256").update(textoDaImpressaoDaConta({ pessoaId: PESSOA, ia: "claude-cli", email: "pessoa1@exemplo.com", orgId: "org-lumen" })).digest("hex");

describe("contas do motor (ADR-102)", { timeout: 20_000 }, () => {
  it("login pela tela: link oficial + chave pública, código cifrado decifrado no CLI, pronto com a impressão", async () => {
    const m = await montar();
    m.respostas.push({ logins: [{ id: "11111111-1111-4111-8111-111111111111", ia: "claude-cli", impressao: null, apelido: "Lumen" }], sair: [], desconectar: false });
    await m.esperar(() => m.progresso.some((p) => p.fase === "aguardando_pessoa"));
    const aguardando = m.progresso.find((p) => p.fase === "aguardando_pessoa")!;
    expect(aguardando).toMatchObject({ url: "https://claude.com/cai/oauth/authorize?code=true&client_id=falso&state=xyz", pedeCodigo: true });
    expect(aguardando.chavePublica).toMatch(/^[A-Za-z0-9+/]+=*$/);
    const cifrado = await cifrarCodigo(aguardando.chavePublica!, "codigo-certo-123");
    m.respostas.push({ logins: [{ id: "11111111-1111-4111-8111-111111111111", ia: "claude-cli", impressao: null, apelido: "Lumen", codigo: cifrado }], sair: [], desconectar: false });
    await m.esperar(() => m.progresso.some((p) => p.fase === "pronto" || p.fase === "falhou"));
    expect(m.progresso.at(-1)).toMatchObject({ fase: "pronto", impressao: impressaoEsperada });
    expect(m.progresso.map((p) => p.fase)).toEqual(expect.arrayContaining(["abrindo", "aguardando_pessoa", "conferindo", "pronto"]));
    expect(m.reanuncios).toBeGreaterThan(0);
    // A conta entrou na pasta de sempre (a primeira do Claude nesta máquina), com o apelido para o anúncio.
    expect(m.contas.anuncio()).toEqual([expect.objectContaining({ impressao: impressaoEsperada, ia: "claude-cli", estado: "pronta", apelidoSugerido: "Lumen" })]);
    // ADR-105: o e-mail vai no anúncio (para a tela de Provedores), nunca ao arquivo da lista.
    expect(m.contas.anuncio()[0]!.email?.toLowerCase()).toContain("exemplo.com");
    expect((await readFile(m.arquivo, "utf8")).toLowerCase()).not.toContain("exemplo.com");
  });

  it("código errado: o login falha com a causa do CLI e nada fica pela metade", async () => {
    const m = await montar();
    m.respostas.push({ logins: [{ id: "22222222-2222-4222-8222-222222222222", ia: "claude-cli", impressao: null, apelido: null }], sair: [], desconectar: false });
    await m.esperar(() => m.progresso.some((p) => p.fase === "aguardando_pessoa"));
    const chave = m.progresso.find((p) => p.fase === "aguardando_pessoa")!.chavePublica!;
    m.respostas.push({ logins: [{ id: "22222222-2222-4222-8222-222222222222", ia: "claude-cli", impressao: null, apelido: null, codigo: await cifrarCodigo(chave, "codigo-errado-999") }], sair: [], desconectar: false });
    await m.esperar(() => m.progresso.some((p) => p.fase === "falhou"));
    expect(m.progresso.at(-1)).toMatchObject({ fase: "falhou" });
    expect(m.contas.anuncio()).toEqual([]);
    expect(await readFile(m.arquivo, "utf8")).toContain('"armadaEm":0');
  });

  it("sair desta máquina: logout na pasta da conta, o servidor fica sabendo e a conta some do anúncio", async () => {
    const m = await montar();
    m.respostas.push({ logins: [{ id: "33333333-3333-4333-8333-333333333333", ia: "claude-cli", impressao: null, apelido: null }], sair: [], desconectar: false });
    await m.esperar(() => m.progresso.some((p) => p.fase === "aguardando_pessoa"));
    const chave = m.progresso.find((p) => p.fase === "aguardando_pessoa")!.chavePublica!;
    m.respostas.push({ logins: [{ id: "33333333-3333-4333-8333-333333333333", ia: "claude-cli", impressao: null, apelido: null, codigo: await cifrarCodigo(chave, "codigo-certo-123") }], sair: [], desconectar: false });
    await m.esperar(() => m.progresso.some((p) => p.fase === "pronto"));
    m.respostas.push({ logins: [], sair: [impressaoEsperada], desconectar: false });
    await m.esperar(() => m.saidas.length > 0);
    expect(m.saidas[0]).toEqual({ impressoes: [impressaoEsperada], desconectada: false });
    expect(m.contas.anuncio()).toEqual([]);
  });

  it("NOD-9 PR4: o Atualizar da tela chega na puxada e vai ao atualizador da máquina, uma vez", async () => {
    const m = await montar();
    m.respostas.push({ logins: [], sair: [], desconectar: false, atualizar: ["claude-cli"] });
    await m.esperar(() => m.atualizar.length > 0);
    await new Promise((r) => setTimeout(r, 100));
    expect(m.atualizar).toEqual(["claude-cli"]);
  });

  it("desconectar com 'sair das contas': sai de todas, confirma ao servidor e para o motor", async () => {
    const m = await montar();
    m.respostas.push({ logins: [], sair: [], desconectar: true });
    await m.esperar(() => m.desconectou);
    expect(m.saidas).toEqual([{ impressoes: [], desconectada: true }]);
    expect(m.remocao).toBeUndefined();
  });

  it("ADA-245: desconectar com 'remover' leva as opções da limpeza local ao motor", async () => {
    const m = await montar();
    m.respostas.push({ logins: [], sair: [], desconectar: true, remover: { manterIas: true, manterConexao: false } });
    await m.esperar(() => m.desconectou);
    expect(m.saidas).toEqual([{ impressoes: [], desconectada: true }]);
    expect(m.remocao).toEqual({ manterIas: true, manterConexao: false });
  });

  it("desconectar depois de um login: sai da conta (logout na pasta) e confirma a impressão", async () => {
    const m = await montar();
    await logar(m);
    m.respostas.push({ logins: [], sair: [], desconectar: true });
    await m.esperar(() => m.desconectou);
    expect(m.saidas).toEqual([{ impressoes: [impressaoEsperada], desconectada: true }]);
    expect(m.contas.anuncio()).toEqual([]);
  });

  it("ADA-245: remover com 'Continuar ligado' não sai das contas (sem logout) e leva as opções ao motor", async () => {
    const m = await montar();
    await logar(m);
    m.respostas.push({ logins: [], sair: [], desconectar: false, remover: { manterIas: false, manterConexao: true } });
    await m.esperar(() => m.desconectou);
    expect(m.saidas).toEqual([{ impressoes: [], desconectada: true }]);
    expect(m.remocao).toEqual({ manterIas: false, manterConexao: true });
    expect(m.contas.anuncio()).toEqual([expect.objectContaining({ impressao: impressaoEsperada, estado: "pronta" })]);
  });

  it("revisão do PR #306: logout que falha não é confirmado (a saída fica pendente e a conta continua anunciada)", async () => {
    const m = await montar({ logoutFalha: true });
    await logar(m);
    m.respostas.push({ logins: [], sair: [impressaoEsperada], desconectar: false });
    await m.esperar(() => m.saidas.length > 0);
    expect(m.saidas[0]).toEqual({ impressoes: [], desconectada: false });
    expect(m.contas.anuncio()).toHaveLength(1);
  });

  it("servidor sem contas (404): a puxada para e nada mais acontece", async () => {
    const m = await montar();
    m.respostas.push("sem_rota");
    await new Promise((r) => setTimeout(r, 120));
    m.respostas.push({ logins: [{ id: "44444444-4444-4444-8444-444444444444", ia: "claude-cli", impressao: null, apelido: null }], sair: [], desconectar: false });
    await new Promise((r) => setTimeout(r, 120));
    expect(m.progresso).toEqual([]);
  });
});

/** NOD-8 passo 10: o passo 1 (Preparar) antes do `auth login`, com um preparo falso que o teste solta quando quer. */
function preparoFalso(passo: PassoDoPreparo | null, fim: FimDoPreparo) {
  const rodados: PassoDoPreparo[] = [];
  let soltar: () => void = () => undefined;
  const solto = new Promise<void>((r) => { soltar = r; });
  const preparo: PreparoNoMotor = {
    precisa: async () => passo,
    rodar: async (_ia, p) => { rodados.push(p); await solto; return fim; },
  };
  return { preparo, rodados, soltar };
}

const ATUALIZOU: FimDoPreparo = { ok: true, depois: "2.1.200", atualizacao: { fase: "sucesso", alvo: "2.1.150", antes: "2.0.1", depois: "2.1.200", caminho: "npm_local", em: 1 } };
const SEM_ESPACO: FimDoPreparo = { ok: false, atualizacao: { fase: "falhou", alvo: "2.1.150", motivo: "sem_espaco", caminho: "npm_local", em: 1, espaco: { livreMb: 1200, precisaMb: 2048 } } };
const pedido = (id: string, extra: Partial<PuxadaDeContas["logins"][number]> = {}): PuxadaDeContas => ({ logins: [{ id, ia: "claude-cli", impressao: null, apelido: null, ...extra }], sair: [], desconectar: false });

describe("NOD-8 passo 10: preparo no login da VM", { timeout: 20_000 }, () => {
  it("abaixo do piso: preparando → o orquestrador roda → abrindo com o antes/depois → o login segue", async () => {
    const f = preparoFalso({ acao: "atualizar", antes: "2.0.1" }, ATUALIZOU);
    const m = await montar({ preparo: f.preparo });
    const id = "66666666-6666-4666-8666-666666666661";
    m.respostas.push(pedido(id));
    await m.esperar(() => f.rodados.length === 1);
    expect(m.progresso.map((p) => p.fase)).toEqual(["preparando"]);
    expect(m.progresso[0]).toMatchObject({ loginId: id, preparo: { acao: "atualizar", antes: "2.0.1" } });
    // Enquanto prepara, a puxada segue (o preparo não segura a volta) e não abre um segundo login.
    m.respostas.push(pedido(id), pedido(id));
    await m.esperar(() => m.respostas.length === 0);
    expect(f.rodados).toHaveLength(1);
    f.soltar();
    await m.esperar(() => m.progresso.some((p) => p.fase === "aguardando_pessoa"));
    const abrindo = m.progresso.find((p) => p.fase === "abrindo")!;
    expect(abrindo.preparo).toMatchObject({ acao: "atualizar", antes: "2.0.1", depois: "2.1.200", atualizacao: { fase: "sucesso" } });
    expect(m.progresso.findIndex((p) => p.fase === "preparando")).toBeLessThan(m.progresso.findIndex((p) => p.fase === "abrindo"));
  });

  it("IA pronta: nada de preparando, abre direto como antes", async () => {
    const f = preparoFalso(null, ATUALIZOU);
    const m = await montar({ preparo: f.preparo });
    m.respostas.push(pedido("66666666-6666-4666-8666-666666666662"));
    await m.esperar(() => m.progresso.some((p) => p.fase === "aguardando_pessoa"));
    expect(f.rodados).toHaveLength(0);
    expect(m.progresso[0]).toEqual({ loginId: "66666666-6666-4666-8666-666666666662", fase: "abrindo" });
  });

  it("falha do preparo (sem espaço): falhou/preparo_falhou com o motivo, sem abrir o login e sem pasta pela metade", async () => {
    const f = preparoFalso({ acao: "instalar" }, SEM_ESPACO);
    const m = await montar({ preparo: f.preparo });
    m.respostas.push(pedido("66666666-6666-4666-8666-666666666663"));
    await m.esperar(() => f.rodados.length === 1);
    f.soltar();
    await m.esperar(() => m.progresso.some((p) => p.fase === "falhou"));
    expect(m.progresso.map((p) => p.fase)).toEqual(["preparando", "falhou"]);
    expect(m.progresso[1]).toMatchObject({ erro: "preparo_falhou", preparo: { acao: "instalar", atualizacao: { motivo: "sem_espaco", espaco: { livreMb: 1200, precisaMb: 2048 } } } });
    expect(m.contas.anuncio()).toEqual([]);
  });

  it("servidor de antes (400 ao preparando): repete com abrindo e não manda o preparo depois", async () => {
    const f = preparoFalso({ acao: "atualizar", antes: "2.0.1" }, ATUALIZOU);
    const m = await montar({ preparo: f.preparo, responder: (p) => (p.fase === "preparando" || p.preparo ? "recusado" : true) });
    m.respostas.push(pedido("66666666-6666-4666-8666-666666666664"));
    await m.esperar(() => f.rodados.length === 1);
    expect(m.progresso.map((p) => p.fase)).toEqual(["preparando", "abrindo"]);
    f.soltar();
    await m.esperar(() => m.progresso.some((p) => p.fase === "aguardando_pessoa"));
    expect(m.progresso.filter((p) => p.preparo)).toHaveLength(1); // só o preparando recusado
  });

  it("revisão do PR #511: servidor que conhece preparando mas recusa a `atualizacao` no fim: o falhou vai sem o preparo", async () => {
    const f = preparoFalso({ acao: "instalar" }, SEM_ESPACO);
    const m = await montar({ preparo: f.preparo, responder: (p) => (p.preparo?.atualizacao ? "recusado" : true) });
    m.respostas.push(pedido("66666666-6666-4666-8666-666666666666"));
    await m.esperar(() => f.rodados.length === 1);
    f.soltar();
    await m.esperar(() => m.progresso.filter((p) => p.fase === "falhou").length === 2);
    // O 400 não deixa o fim pendente para sempre (a tela veria "Preparando…" até a puxada esquecer o login).
    expect(m.progresso.map((p) => p.fase)).toEqual(["preparando", "falhou", "falhou"]);
    expect(m.progresso[2]).toEqual({ loginId: "66666666-6666-4666-8666-666666666666", fase: "falhou", erro: "preparo_falhou" });
  });

  it("cancelado no preparo: o login acaba sem abrir o CLI quando o preparo termina", async () => {
    const f = preparoFalso({ acao: "instalar" }, ATUALIZOU);
    const m = await montar({ preparo: f.preparo });
    const id = "66666666-6666-4666-8666-666666666665";
    m.respostas.push(pedido(id));
    await m.esperar(() => f.rodados.length === 1);
    m.respostas.push(pedido(id, { cancelado: true }));
    await m.esperar(() => m.respostas.length === 0);
    await new Promise((r) => setTimeout(r, 60));
    f.soltar();
    await new Promise((r) => setTimeout(r, 200));
    expect(m.progresso.map((p) => p.fase)).toEqual(["preparando"]);
    expect(m.contas.anuncio()).toEqual([]);
  });
});
