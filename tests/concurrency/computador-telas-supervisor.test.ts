// NOD-96 PR 7 (definido em 2026-10-22, ADR-122): o supervisor REAL com várias telas ao mesmo tempo. A tela é a falsa
// (tests/helpers/tela-falsa.mjs: o mesmo protocolo IPC da tela.mjs, sem Xvfb nem Chromium), o terminal é o real e a
// loja de cookies é a real (cifrada no disco). O que precisa de Xvfb/Chromium/systemd de verdade é o smoke na VM
// (scripts/e2e-computador-vm.sh); aqui fica o que é do supervisor: login em comum, telas sem vazar, cookies ao mesmo
// tempo, a régua (fila e ociosa) e Atualizar/Redefinir sem perder os logins.
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assinarComando, chaveDaLoja, chaveDaMaquina, chaveDasSenhas, chaveDoStorage, chavesDeAssinatura, selar } from "../../infra/computador/chaves.mjs";
import { arquivoDasSenhas, lerSenhas } from "../../infra/computador/login-senhas.mjs";
import { lerEstado, lerTudo } from "../../infra/computador/login-storage.mjs";
import { cookiesVivos, lerLoja } from "../../infra/computador/loja-cookies.mjs";
import { OCIOSA_APOS_MS } from "../../infra/computador/regua.mjs";
import { criarSupervisor, type Supervisor } from "../../infra/computador/supervisor.mjs";
import { criarServidorTerminal, escutar } from "../../infra/computador/terminal.mjs";

const CRED = "d".repeat(64);
const ID = "pc-e2e";
const TELA_FALSA = fileURLToPath(new URL("../helpers/tela-falsa.mjs", import.meta.url));
const limpar: Array<() => Promise<unknown> | unknown> = [];
afterEach(async () => { for (const f of limpar.splice(0).reverse()) await f(); });

type Nivel = "verde" | "amarela" | "vermelha";
type Tela = { url: string; titulo: string; texto: string; storage?: string; senhas?: number; geracao?: number | null };
type Resultado = { desfecho: string; motivo?: string; quem?: string[]; supervisorPub?: string; resultado?: { tela?: Tela } };

async function montar(o: { ambienteTela?: Record<string, string>; antesDeRecolher?: (agenteId: string) => Promise<void> } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "nod-telas-e2e-"));
  limpar.push(() => rm(dir, { recursive: true, force: true }));
  const bin = async (nome: string, corpo: string) => {
    const f = join(dir, nome);
    await writeFile(f, `#!/bin/sh\n${corpo}\n`);
    await chmod(f, 0o755);
    return f;
  };
  const binarios = {
    dbus: await bin("dbus", 'for a in "$@"; do case "$a" in --address=*) echo "${a#--address=}";; esac; done; exec sleep 60'),
    keyring: await bin("keyring", "cat >/dev/null; exec sleep 60"),
    secretTool: await bin("secret-tool", "cat >/dev/null"),
    xvfb: "Xvfb", openbox: "openbox", chromium: "chromium", bwrap: null, xdotool: "xdotool", xclip: "xclip", scrot: "scrot",
  };
  const terminal = join(dir, "term.sock");
  const st = criarServidorTerminal({ raiz: join(dir, "raiz") });
  await escutar(st, terminal);
  limpar.push(() => new Promise((r) => st.close(r)));
  // A régua lê a memória daqui: vermelha com `limite` telas de pé (fechar uma devolve a memória, como na máquina de
  // verdade); o relógio anda para a tela ficar ociosa.
  const maquina = { limite: Infinity, desvio: 0 };
  const dePe = () => (sup.estados()[0]?.telas ?? []).filter((t) => t.estado === "aberta" || t.estado === "abrindo").length;
  const agora = () => Date.now() + maquina.desvio;
  const logs: string[] = [];
  const sup = criarSupervisor({
    raiz: join(dir, "raiz"), run: join(dir, "run"), terminal, bin: binarios, tela: TELA_FALSA, ambienteTela: o.ambienteTela, antesDeRecolher: o.antesDeRecolher,
    leitura: () => ({ memoria: (dePe() >= maquina.limite ? "vermelha" : "verde") as Nivel, processador: "verde" }), agora, log: (m) => logs.push(m),
  });
  limpar.push(() => sup.encerrar());
  const { privada, publica } = chavesDeAssinatura(CRED, ID);
  let n = 0;
  const cmd = (c: Record<string, unknown>) =>
    assinarComando({ id: `c${++n}`, computadorId: ID, uso: "equilibrado", prazoMs: agora() + 60_000, ...c }, privada);
  const tratar = (c: Record<string, unknown>) => sup.tratar(cmd(c)) as Promise<Resultado>;
  const iniciar = async () => {
    if (!sup.estados().some((e) => e.computadorId === ID)) await tratar({ tipo: "parar" });
    const supervisorPub = sup.estados().find((e) => e.computadorId === ID)!.supervisorPub;
    const r = await tratar({ tipo: "iniciar", servidorPub: publica, segredoSelado: selar(supervisorPub, chaveDaMaquina(CRED, ID)) });
    expect(r.desfecho).toBe("ok");
  };
  const navegar = (agenteId: string, url: string) => tratar({ tipo: "acao", agenteId, acao: { tipo: "navegar", url } });
  /** Os cookies que a tela do bot vê no host da URL (navega até ela, sem login). */
  const cookiesEm = async (agenteId: string, url: string) => {
    const r = await navegar(agenteId, url);
    expect(r.desfecho, JSON.stringify(r)).toBe("ok");
    return Object.fromEntries((JSON.parse(r.resultado!.tela!.texto) as { name: string; value: string }[]).map((c) => [c.name, c.value]));
  };
  const telas = () => Object.fromEntries((sup.estados()[0]?.telas ?? []).map((t) => [t.agenteId, t.estado]));
  const loja = async () => cookiesVivos(await lerLoja(join(dir, "raiz", ID, "logins", "principal", "cookies.enc"), chaveDaLoja(chaveDaMaquina(CRED, ID))));
  /** O localStorage que a tela do bot vê na origem da URL (navega até ela). */
  const storageEm = async (agenteId: string, url: string) => {
    const r = await navegar(agenteId, url);
    expect(r.desfecho, JSON.stringify(r)).toBe("ok");
    return Object.fromEntries(JSON.parse(r.resultado!.tela!.storage ?? "[]") as [string, string][]);
  };
  const pastaStorage = join(dir, "raiz", ID, "logins", "principal", "storage");
  const perfilDe = (agenteId: string) => join(dir, "raiz", ID, "perfis", agenteId);
  const arquivoSenhas = arquivoDasSenhas(join(dir, "raiz", ID, "logins"));
  const senhas = () => lerSenhas(arquivoSenhas, chaveDasSenhas(chaveDaMaquina(CRED, ID)));
  return { sup, perfilDe, arquivoSenhas, senhas, dir, maquina, tratar, iniciar, navegar, cookiesEm, storageEm, pastaStorage, telas, loja, logs, assentar: () => (sup as Supervisor).assentar() };
}

const MAIL = "https://mail.exemplo.com/";

/** O Chrome de um bot "salva" uma senha: grava o Login Data no perfil (o BLOB carrega `valor` em claro, o pior caso). */
async function salvarSenhaNoPerfil(perfil: string, valor: string, url = "https://portal.exemplo.com/") {
  await mkdir(join(perfil, "Default"), { recursive: true });
  const db = new DatabaseSync(join(perfil, "Default", "Login Data"));
  db.exec("CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR); INSERT INTO meta VALUES ('version', '43');");
  db.exec("CREATE TABLE logins (origin_url VARCHAR NOT NULL, username_element VARCHAR, username_value VARCHAR, password_element VARCHAR, password_value BLOB, signon_realm VARCHAR NOT NULL, date_created INTEGER NOT NULL, date_password_modified INTEGER NOT NULL DEFAULT 0, id INTEGER PRIMARY KEY AUTOINCREMENT, UNIQUE (origin_url, username_element, username_value, password_element, signon_realm))");
  db.prepare("INSERT INTO logins (origin_url, username_element, username_value, password_element, password_value, signon_realm, date_created, date_password_modified) VALUES (?, 'u', 'ana', 'p', ?, ?, ?, ?)")
    .run(url, Buffer.from(valor), url, 13_380_000_000_000_000n, 13_380_000_000_000_000n);
  db.close();
}

/** Codex (PR 602): o `fechada` da tela falsa espera o teste abrir o portão, em vez de um atraso que a CPU lenta vence. */
async function portaoDoFechar(): Promise<{ arquivo: string; abrir: () => Promise<void> }> {
  const pasta = await mkdtemp(join(tmpdir(), "nod-portao-"));
  limpar.push(() => rm(pasta, { recursive: true, force: true }));
  const arquivo = join(pasta, "abrir");
  return { arquivo, abrir: () => writeFile(arquivo, "") };
}

describe("computador da pessoa: várias telas no supervisor real (NOD-96 PR 7)", () => {
  it("login em comum: o que um bot entra vale nas telas abertas e no bot criado depois; sair também", async () => {
    const m = await montar();
    await m.iniciar();
    expect(await m.cookiesEm("ana", MAIL)).toEqual({});
    expect((await m.navegar("beto", `${MAIL}?entrar=sid:abc`)).desfecho).toBe("ok");
    await m.assentar();
    // A tela da Ana já estava aberta: recebeu o repasse.
    expect(await m.cookiesEm("ana", MAIL)).toEqual({ sid: "abc" });
    // O Caio nunca teve tela: nasce com a loja.
    expect(await m.cookiesEm("caio", MAIL)).toEqual({ sid: "abc" });
    expect(m.telas()).toEqual({ ana: "aberta", beto: "aberta", caio: "aberta" });
    // Sair num bot sai em todos.
    await m.navegar("caio", `${MAIL}?sair=sid`);
    await m.assentar();
    expect(await m.cookiesEm("ana", MAIL)).toEqual({});
    expect(await m.cookiesEm("beto", MAIL)).toEqual({});
    expect(await m.loja()).toEqual([]);
  });

  it("bots em paralelo: cada ação volta com a tela do próprio bot, nunca a de outro", async () => {
    const m = await montar({ ambienteTela: { NOD_TELA_FALSA_ACAO_MS: "7" } });
    await m.iniciar();
    const bots = ["ana", "beto", "caio", "duda"];
    for (let volta = 0; volta < 15; volta++) {
      const rs = await Promise.all(bots.map((b) => m.navegar(b, `https://${b}.exemplo.com/pagina-${volta}`)));
      rs.forEach((r, i) => {
        expect(r.desfecho).toBe("ok");
        expect(r.resultado?.tela?.url).toBe(`https://${bots[i]}.exemplo.com/pagina-${volta}`);
        expect(r.resultado?.tela?.titulo).toContain(`(${bots[i]})`);
      });
    }
    // Duas ações ao mesmo tempo no MESMO bot: uma passa, a outra é `ocupado` (a reserva é por tela).
    const [x, y] = await Promise.all([m.navegar("ana", "https://a.exemplo.com/1"), m.navegar("ana", "https://a.exemplo.com/2")]);
    expect([x.desfecho, y.desfecho].sort()).toEqual(["falhou", "ok"]);
    expect([x.motivo, y.motivo]).toContain("ocupado");
  });

  it("cookies ao mesmo tempo em 6 telas: a loja não corrompe, ninguém perde o seu e o comum fica com o último", async () => {
    const m = await montar();
    await m.iniciar();
    const bots = ["b1", "b2", "b3", "b4", "b5", "b6"];
    // 6 telas abertas de uma vez, com memória sobrando (a régua não segura nenhuma).
    const abertas = await Promise.all(bots.map((agenteId) => m.tratar({ tipo: "abrir_tela", agenteId })));
    expect(abertas.map((r) => r.desfecho)).toEqual(bots.map(() => "ok"));
    expect(Object.values(m.telas()).filter((e) => e === "aberta")).toHaveLength(6);
    const VOLTAS = 30;
    await Promise.all(bots.map(async (b) => {
      for (let v = 0; v < VOLTAS; v++) {
        const r = await m.navegar(b, `${MAIL}?entrar=${b}:${v}`);
        expect(r.desfecho).toBe("ok");
        await m.navegar(b, `${MAIL}?entrar=comum:${b}-${v}`);
      }
    }));
    await m.assentar();
    const loja = Object.fromEntries((await m.loja()).map((c) => [c.name, String(c.value)]));
    for (const b of bots) expect(loja[b]).toBe(String(VOLTAS - 1));
    // O comum: o último escrito ganha (LWW), que é a última volta de algum bot.
    expect(loja.comum).toMatch(new RegExp(`^b[1-6]-${VOLTAS - 1}$`));
    // Cada tela vê o cookie próprio de todas as outras (o repasse chegou a todas).
    for (const b of bots) {
      const vistos = await m.cookiesEm(b, MAIL);
      for (const outro of bots) expect(vistos[outro]).toBe(String(VOLTAS - 1));
    }
    // Uma tela nova nasce com a loja inteira, inclusive o comum que ganhou.
    expect(await m.cookiesEm("b7", MAIL)).toEqual(loja);
    expect(m.logs.filter((l) => l.startsWith("loja de cookies"))).toEqual([]);
  });

  it("fila por memória: sem memória e sem ociosa espera com quem ocupa; ociosa fecha a mais antiga e reabre logada", async () => {
    const m = await montar();
    await m.iniciar();
    await m.navegar("ana", `${MAIL}?entrar=sid:xyz`);
    await m.navegar("beto", MAIL);
    await m.assentar();
    m.maquina.limite = 2;
    // Sem tela ociosa: o Caio espera (não é erro) e sabe quem ocupa.
    const espera = await m.navegar("caio", MAIL);
    expect(espera).toMatchObject({ desfecho: "esperando_tela" });
    expect(espera.quem?.sort()).toEqual(["ana", "beto"]);
    expect(m.telas().caio).toBe("esperando");
    // Passou o tempo de ociosa e o Beto seguiu usando: fecha a da Ana e abre a do Caio, já logada.
    m.maquina.desvio += OCIOSA_APOS_MS + 1000;
    await m.navegar("beto", MAIL);
    expect(await m.cookiesEm("caio", MAIL)).toEqual({ sid: "xyz" });
    expect(m.telas()).toMatchObject({ ana: "fechada", beto: "aberta", caio: "aberta" });
    // A Ana volta: a ociosa mais antiga agora é a do Beto; a da Ana reabre com o login.
    m.maquina.desvio += OCIOSA_APOS_MS + 1000;
    expect(await m.cookiesEm("ana", MAIL)).toEqual({ sid: "xyz" });
    expect(m.telas()).toMatchObject({ ana: "aberta", beto: "fechada", caio: "aberta" });
    // Com memória de novo, abre sem fechar ninguém.
    m.maquina.limite = Infinity;
    expect(await m.cookiesEm("beto", MAIL)).toEqual({ sid: "xyz" });
    expect(Object.values(m.telas()).filter((e) => e === "aberta")).toHaveLength(3);
  });

  it("a tela que o servidor fechou por ociosidade (fechar_tela, 15 min) reabre na próxima ação, logada", async () => {
    const m = await montar();
    await m.iniciar();
    await m.navegar("ana", `${MAIL}?entrar=sid:15min`);
    expect((await m.tratar({ tipo: "fechar_tela", agenteId: "ana" })).desfecho).toBe("ok");
    expect(m.telas().ana).toBe("fechada");
    expect(await m.cookiesEm("ana", MAIL)).toEqual({ sid: "15min" });
    expect(m.telas().ana).toBe("aberta");
  });

  it("NOD-433: a ação que chega com a tela do bot ainda fechando espera o fechar e abre uma tela nova, que não é marcada fechada", async () => {
    const portao = await portaoDoFechar();
    const m = await montar({ ambienteTela: { NOD_TELA_FALSA_FECHAR_PORTAO: portao.arquivo } });
    await m.iniciar();
    await m.navegar("ana", `${MAIL}?entrar=sid:fechando`);
    const fechar = m.tratar({ tipo: "fechar_tela", agenteId: "ana" });
    await vi.waitFor(() => expect(m.telas().ana).toBe("fechando"));
    const acao = m.navegar("ana", MAIL);
    // A tela antiga segue fechando (o portão fechado) enquanto a ação chega ao supervisor.
    await new Promise((r) => setTimeout(r, 200));
    expect(m.telas().ana).toBe("fechando");
    await portao.abrir();
    const [f, a] = await Promise.all([fechar, acao]);
    expect(f.desfecho).toBe("ok");
    expect(a.desfecho, JSON.stringify(a)).toBe("ok");
    expect(m.telas().ana).toBe("aberta");
    expect(await m.cookiesEm("ana", MAIL)).toEqual({ sid: "fechando" });
  });

  it("NOD-433 (revisão r2): dois fechar com a tela do bot fechando: o segundo espera o primeiro (não fecha a tela nova) e a ação abre uma só", async () => {
    const diario = join(await mkdtemp(join(tmpdir(), "nod-diario-")), "telas.jsonl");
    limpar.push(() => rm(join(diario, ".."), { recursive: true, force: true }));
    const portao = await portaoDoFechar();
    const m = await montar({ ambienteTela: { NOD_TELA_FALSA_FECHAR_PORTAO: portao.arquivo, NOD_TELA_FALSA_DIARIO: diario } });
    await m.iniciar();
    await m.navegar("ana", `${MAIL}?entrar=sid:dupla`);
    const fechar1 = m.tratar({ tipo: "fechar_tela", agenteId: "ana" });
    await vi.waitFor(() => expect(m.telas().ana).toBe("fechando"));
    const fechar2 = m.tratar({ tipo: "fechar_tela", agenteId: "ana" });
    const acoes = Promise.all([m.navegar("ana", MAIL), m.navegar("ana", MAIL)]);
    await new Promise((r) => setTimeout(r, 200));
    expect(m.telas().ana).toBe("fechando");
    await portao.abrir();
    const [a1, a2] = await acoes;
    expect((await fechar1).desfecho).toBe("ok");
    expect((await fechar2).desfecho).toBe("ok");
    expect(a1.desfecho, JSON.stringify(a1)).toBe("ok");
    expect(["ok", "ocupado"]).toContain(a2.desfecho === "ok" ? "ok" : a2.motivo);
    await m.assentar();
    expect(m.telas().ana).toBe("aberta");
    expect(await m.cookiesEm("ana", MAIL)).toEqual({ sid: "dupla" });
    // Revisão r3: o estado final não basta (a guarda de dona no fecharTela o disfarça). Pelo diário dos processos da
    // tela: a nova só abre depois do `fechada` da antiga, nunca há duas vivas, e cada processo recebe um fechar só.
    const eventos = (await readFile(diario, "utf8")).trim().split("\n").map((l) => JSON.parse(l) as { pid: number; agente: string; ev: string }).filter((e) => e.agente === "ana");
    const vivas = new Set<number>();
    const fechares = new Map<number, number>();
    for (const e of eventos) {
      if (e.ev === "abrir") { expect([...vivas], JSON.stringify(eventos)).toEqual([]); vivas.add(e.pid); }
      if (e.ev === "fechar") fechares.set(e.pid, (fechares.get(e.pid) ?? 0) + 1);
      if (e.ev === "fechada") vivas.delete(e.pid);
    }
    expect(eventos.filter((e) => e.ev === "abrir")).toHaveLength(2);
    expect([...fechares.values()]).toEqual([1]);
  });

  it("NOD-433 (revisão r4): a tela que sai logo depois do fechada não libera a nova antes do fecharTela terminar", async () => {
    const diario = join(await mkdtemp(join(tmpdir(), "nod-diario-")), "telas.jsonl");
    limpar.push(() => rm(join(diario, ".."), { recursive: true, force: true }));
    let soltar = () => {};
    const segura = new Promise<void>((r) => { soltar = r; });
    let segurando = false;
    const m = await montar({ ambienteTela: { NOD_TELA_FALSA_DIARIO: diario }, antesDeRecolher: async (id) => { if (id === "ana" && !segurando) { segurando = true; await segura; } } });
    await m.iniciar();
    await m.navegar("ana", `${MAIL}?entrar=sid:r4`);
    const ler = async () => (await readFile(diario, "utf8")).trim().split("\n").map((l) => JSON.parse(l) as { pid: number; agente: string; ev: string }).filter((e) => e.agente === "ana");
    const fechar = m.tratar({ tipo: "fechar_tela", agenteId: "ana" });
    // A tela antiga respondeu `fechada` e o processo já saiu; o fecharTela ainda está preso antes do recolhimento.
    const antiga = (await ler())[0]!.pid;
    await vi.waitFor(() => { expect(segurando).toBe(true); expect(() => process.kill(antiga, 0)).toThrow(); }, { timeout: 5_000 });
    await new Promise((r) => setTimeout(r, 50));
    expect(m.telas().ana).toBe("fechando");
    const acao = m.navegar("ana", MAIL);
    await new Promise((r) => setTimeout(r, 200));
    expect((await ler()).filter((e) => e.ev === "abrir")).toHaveLength(1);
    soltar();
    expect((await fechar).desfecho).toBe("ok");
    expect((await acao).desfecho).toBe("ok");
    expect((await ler()).filter((e) => e.ev === "abrir")).toHaveLength(2);
  });

  it("Atualizar e Redefinir fecham as telas e mantêm os logins; Sair de todos não", async () => {
    const m = await montar();
    await m.iniciar();
    await m.navegar("ana", `${MAIL}?entrar=sid:fica`);
    await m.navegar("beto", MAIL);
    await m.assentar();
    expect((await m.tratar({ tipo: "atualizar" })).desfecho).toBe("ok");
    expect(Object.values(m.telas()).filter((e) => e === "aberta")).toEqual([]);
    // Depois do Atualizar o servidor liga de novo no próximo comando.
    expect((await m.navegar("ana", MAIL)).motivo).toBe("nao_iniciou");
    await m.iniciar();
    expect(await m.cookiesEm("beto", MAIL)).toEqual({ sid: "fica" });
    const r = await m.tratar({ tipo: "redefinir" });
    expect(r.desfecho).toBe("ok");
    // A X25519 é nova: o iniciar sela para ela (o servidor a recebeu na resposta do redefinir).
    expect(r.supervisorPub).toBe(m.sup.estados()[0]?.supervisorPub);
    await m.iniciar();
    expect(await m.cookiesEm("ana", MAIL)).toEqual({ sid: "fica" });
    expect(await m.cookiesEm("caio", MAIL)).toEqual({ sid: "fica" });
    expect((await m.tratar({ tipo: "sair_de_todos" })).desfecho).toBe("ok");
    expect(await m.cookiesEm("ana", MAIL)).toEqual({});
    expect(await m.cookiesEm("duda", MAIL)).toEqual({});
  });

  it("storage em comum (NOD-97 PR 4): a origem com login vale nas telas abertas e nas novas; sem login fica no bot", async () => {
    const m = await montar();
    await m.iniciar();
    // A Ana fica aberta noutra origem: o repasse entra quando ela navega para o mail.
    expect(await m.storageEm("ana", "https://outro.exemplo.com/")).toEqual({});
    await m.navegar("beto", `${MAIL}?entrar=sid:abc&guardar=token:1`);
    await m.navegar("beto", "https://semlogin.exemplo.org/?guardar=x:1");
    await m.assentar();
    expect(await m.storageEm("ana", MAIL)).toEqual({ token: "1" });
    expect(await m.storageEm("caio", MAIL)).toEqual({ token: "1" });
    expect(await m.storageEm("caio", "https://semlogin.exemplo.org/")).toEqual({});
    // Último a escrever vence; a Ana está no mail (a origem aberta) e só pega ao voltar para ela.
    await m.navegar("caio", `${MAIL}?guardar=token:2`);
    await m.assentar();
    expect(await m.storageEm("ana", MAIL)).toEqual({ token: "1" });
    await m.navegar("ana", "https://outro.exemplo.com/");
    expect(await m.storageEm("ana", MAIL)).toEqual({ token: "2" });
    // Fechar e reabrir a tela mantém a versão (vem da loja); o disco é cifrado.
    await m.tratar({ tipo: "fechar_tela", agenteId: "beto" });
    expect(await m.storageEm("beto", MAIL)).toEqual({ token: "2" });
    const arquivos = await readdir(m.pastaStorage);
    expect(arquivos.filter((a) => a.endsWith(".enc"))).toHaveLength(2);
    for (const a of arquivos.filter((x) => x.endsWith(".enc"))) expect((await readFile(join(m.pastaStorage, a))).toString("latin1")).not.toContain("token");
    // NOD-97 PR 6: Sair de todos leva o storage em comum junto com os cookies, nas telas abertas e no que fica no disco.
    expect((await m.tratar({ tipo: "sair_de_todos" })).desfecho).toBe("ok");
    expect(await m.storageEm("ana", MAIL)).toEqual({});
    expect(await m.storageEm("duda", MAIL)).toEqual({});
    expect((await readdir(m.pastaStorage)).some((a) => a !== "estado.enc" && a.endsWith(".enc"))).toBe(false);
    // A geração nova chega à tela aberta (limpar_storage) e à que estava fechada (config): esta apaga o storage do
    // perfil no disco antes de o Chrome subir (aplicarGeracaoNoPerfil, testado num Chromium de verdade).
    expect((await m.navegar("ana", MAIL)).resultado?.tela?.geracao).toBe(1);
    expect((await m.navegar("beto", MAIL)).resultado?.tela?.geracao).toBe(1);
  });

  it("revisão 17 do PR #600: o `ocupado` da tela (um pedido anterior termina na graça) chega como `ocupado`, que não conta para a saúde", async () => {
    const m = await montar({ ambienteTela: { NOD_TELA_FALSA_ERRO_DA_ACAO: "ocupado" } });
    await m.iniciar();
    const r = await m.navegar("ana", MAIL);
    expect(r.desfecho).toBe("falhou");
    expect(r.motivo).toBe("ocupado");
  });

  it.each(["cookies", "storage"])("Sair de todos (NOD-97 PR 6): a tela que falha ao limpar %s faz a operação falhar, e a fila segue", async (qual) => {
    const m = await montar({ ambienteTela: { NOD_TELA_FALSA_LIMPAR_FALHA: qual } });
    await m.iniciar();
    await m.navegar("ana", `${MAIL}?entrar=sid:abc&guardar=token:1`);
    await m.assentar();
    const r = await m.tratar({ tipo: "sair_de_todos" });
    expect(r.desfecho).toBe("falhou");
    expect(r.motivo).toBe("acao_falhou");
    expect(m.logs.some((l) => l.includes(`limpar_${qual}`) && l.includes("ana"))).toBe(true);
    expect((await m.navegar("beto", MAIL)).desfecho).toBe("ok");
  });

  it("Sair de todos (NOD-97 PR 6): a loja de cookies que não grava faz a operação falhar sem envenenar a fila da máquina", async () => {
    const m = await montar();
    await m.iniciar();
    await m.navegar("ana", `${MAIL}?entrar=sid:abc`);
    await m.assentar();
    const arquivo = join(m.dir, "raiz", ID, "logins", "principal", "cookies.enc");
    await writeFile(arquivo, "corrompida");
    const r = await m.tratar({ tipo: "sair_de_todos" });
    expect(r.desfecho).toBe("falhou");
    expect(r.motivo).toBe("acao_falhou");
    // A fila continua: com a loja de volta, o login de um bot chega à tela do outro.
    await rm(arquivo, { force: true });
    await m.navegar("beto", `${MAIL}?entrar=sid:novo`);
    await m.assentar();
    expect(await m.cookiesEm("caio", MAIL)).toEqual({ sid: "novo" });
  });

  it("storage ao mesmo tempo (NOD-97 PR 4): dois bots logando juntos 100 vezes, o store sempre decifra e o LWW vence", async () => {
    const m = await montar();
    await m.iniciar();
    const chave = chaveDoStorage(chaveDaMaquina(CRED, ID));
    const bots = ["ana", "beto"];
    for (const b of bots) expect((await m.navegar(b, `${MAIL}?entrar=sid-${b}:1`)).desfecho).toBe("ok");
    const VOLTAS = 100;
    let escrevendo = true;
    let leituras = 0;
    // Enquanto os dois escrevem, um leitor confere sem parar que o índice e cada origem decifram (a gravação é atômica).
    const leitor = (async () => {
      while (escrevendo) {
        const estado = await lerEstado(m.pastaStorage, chave);
        const tudo = await lerTudo(m.pastaStorage, chave);
        expect(tudo.itens.length).toBe(Object.keys(estado.versoes).length > 0 ? 1 : 0);
        leituras++;
        await new Promise((r) => setTimeout(r, 1));
      }
    })();
    await Promise.all(bots.map(async (b) => {
      for (let v = 0; v < VOLTAS; v++) expect((await m.navegar(b, `${MAIL}?guardar=token:${b}-${v}`)).desfecho).toBe("ok");
    }));
    await m.assentar();
    escrevendo = false;
    await leitor;
    expect(leituras).toBeGreaterThan(0);
    const estado = await lerEstado(m.pastaStorage, chave);
    const { itens } = await lerTudo(m.pastaStorage, chave);
    expect(itens).toHaveLength(1);
    const vencedor = itens[0]!;
    expect(vencedor.origem).toBe(new URL(MAIL).origin);
    expect(estado.versoes[vencedor.origem]).toEqual({ em: vencedor.em, hash: vencedor.hash });
    // O último a escrever vence: a última volta de algum dos dois (cada bot escreve com `em` crescente).
    const token = Object.fromEntries(vencedor.dados.localStorage).token;
    expect(token).toMatch(new RegExp(`^(ana|beto)-${VOLTAS - 1}$`));
    // Na pasta só o índice e a origem (decifrados acima; nenhum temporário largado) e uma tela nova nasce com o vencedor.
    expect((await readdir(m.pastaStorage)).sort()).toHaveLength(2);
    expect(await m.storageEm("caio", MAIL)).toEqual({ token });
    expect(m.logs.filter((l) => l.startsWith("storage"))).toEqual([]);
  }, 60_000);

  it("senhas salvas (NOD-97 PR 5): o Login Data de um bot vai para a loja e para a tela do outro, e a senha nunca sai para o bot", async () => {
    const m = await montar();
    await m.iniciar();
    // A tela da Ana abre (cria o perfil); o Chrome dela "salva" uma senha: o BLOB carrega a marcadora em claro, o pior caso.
    await m.navegar("ana", "https://portal.exemplo.com/");
    const MARCADORA = "MARCADORA-SENHA-7f3a";
    await mkdir(join(m.perfilDe("ana"), "Default"), { recursive: true });
    const db = new DatabaseSync(join(m.perfilDe("ana"), "Default", "Login Data"));
    db.exec("CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR); INSERT INTO meta VALUES ('version', '43');");
    db.exec("CREATE TABLE logins (origin_url VARCHAR NOT NULL, username_element VARCHAR, username_value VARCHAR, password_element VARCHAR, password_value BLOB, signon_realm VARCHAR NOT NULL, date_created INTEGER NOT NULL, date_password_modified INTEGER NOT NULL DEFAULT 0, id INTEGER PRIMARY KEY AUTOINCREMENT, UNIQUE (origin_url, username_element, username_value, password_element, signon_realm))");
    db.prepare("INSERT INTO logins (origin_url, username_element, username_value, password_element, password_value, signon_realm, date_created, date_password_modified) VALUES (?, 'u', 'ana', 'p', ?, ?, ?, ?)")
      .run("https://portal.exemplo.com/", Buffer.from(MARCADORA), "https://portal.exemplo.com/", 13_380_000_000_000_000n, 13_380_000_000_000_000n);
    db.close();
    // A próxima ação recolhe; a tela do Beto, aberta depois, recebe a senha no config.
    const resultados: unknown[] = [await m.navegar("ana", "https://portal.exemplo.com/entrar")];
    await m.assentar();
    expect(Object.keys((await m.senhas()).linhas)).toHaveLength(1);
    const beto = await m.navegar("beto", "https://portal.exemplo.com/");
    resultados.push(beto);
    expect(beto.resultado?.tela?.senhas).toBe(1);
    // Nada que volta ao bot ou fica no log tem a senha, nem em claro nem em base64; a loja no disco é cifrada.
    const b64 = Buffer.from(MARCADORA).toString("base64");
    const visto = JSON.stringify(resultados) + m.logs.join("\n");
    expect(visto).not.toContain(MARCADORA);
    expect(visto).not.toContain(b64);
    const disco = (await readFile(m.arquivoSenhas)).toString("latin1");
    expect(disco).not.toContain(MARCADORA);
    expect(disco).not.toContain(b64);
    expect(m.logs.filter((l) => l.startsWith("senhas:"))).toEqual([]);
  });

  it("esquecer senhas (NOD-97 PR 6): fecha e reabre as telas abertas e a que estava abrindo, e nenhuma fica com a senha", async () => {
    const m = await montar({ ambienteTela: { NOD_TELA_FALSA_ATRASO_MS: "300" } });
    await m.iniciar();
    const PORTAL = "https://portal.exemplo.com/";
    await m.navegar("ana", PORTAL);
    await salvarSenhaNoPerfil(m.perfilDe("ana"), "MARCADORA-ESQUECER");
    await m.navegar("ana", `${PORTAL}entrar`);
    await m.assentar();
    expect(Object.keys((await m.senhas()).linhas)).toHaveLength(1);
    // A tela do Caio está abrindo (o config dela já levou a senha) quando a pessoa pede Esquecer senhas salvas.
    const caio = m.navegar("caio", PORTAL);
    await vi.waitFor(() => expect(m.telas().caio).toBe("abrindo"));
    const r = await m.tratar({ tipo: "esquecer_senhas" });
    expect(r).toMatchObject({ desfecho: "ok", relancados: 2 });
    await caio;
    expect(Object.keys((await m.senhas()).linhas)).toHaveLength(0);
    // As duas reabriram sem senha nenhuma no config, e nada a devolveu à loja ao fechar.
    for (const bot of ["ana", "caio"]) expect((await m.navegar(bot, PORTAL)).resultado?.tela?.senhas, bot).toBe(0);
    await m.assentar();
    expect(Object.keys((await m.senhas()).linhas)).toHaveLength(0);
  });

  it("instalação limpa: a sonda sem assinatura é recusada, mas o computador novo é relatado na hora com a X25519", async () => {
    const m = await montar();
    const relatos: { tipo: string; computadorId?: string; supervisorPub?: string }[] = [];
    m.sup.ouvir((r) => relatos.push(r as (typeof relatos)[number]));
    expect(m.sup.estados()).toEqual([]);
    const r = await m.sup.tratar({ id: "sonda-1", computadorId: ID, tipo: "parar", uso: "equilibrado", prazoMs: Date.now() + 60_000, assinatura: "" }) as Resultado;
    expect(r.desfecho).toBe("falhou");
    const estado = relatos.find((x) => x.tipo === "estado" && x.computadorId === ID);
    expect(estado?.supervisorPub).toBe(m.sup.estados()[0]?.supervisorPub);
    expect(m.sup.estados()[0]?.ligado).toBe(false);
    // Recusada de verdade: o servidor ainda não está fixado e nada ligou.
    await m.iniciar();
  });
});
