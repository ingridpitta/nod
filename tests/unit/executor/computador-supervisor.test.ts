// NOD-96 PR 2 (ADR-122): o supervisor como processo comum, com dbus/keyring/secret-tool falsos e sem telas reais.
import { Buffer } from "node:buffer";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assinarComando, chaveDaLoja, chaveDaMaquina, chaveDoStorage, chavesDeAssinatura, selar } from "../../../infra/computador/chaves.mjs";
import { fundir, gravarLoja, lerLoja, lojaVazia, cookiesVivos } from "../../../infra/computador/loja-cookies.mjs";
import { gravarOrigem, hashDosDados, lerTudo, pastaDoStorage } from "../../../infra/computador/login-storage.mjs";
import { criarSupervisor, escutarControle, servirControle, type Supervisor } from "../../../infra/computador/supervisor.mjs";
import { criarServidorTerminal, escutar } from "../../../infra/computador/terminal.mjs";
import { ETAPAS } from "../../../web/lib/computador-pessoa.ts";

const CRED = "b".repeat(64);
const ID = "pc1";
const limpar: Array<() => Promise<unknown> | unknown> = [];
afterEach(async () => { for (const f of limpar.splice(0).reverse()) await f(); });

async function montar(leitura = () => ({ memoria: "verde" as unknown, processador: "verde" as unknown }), aoAtualizar?: () => void, agora?: () => number, extra: { tela?: string } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "nod-supervisor-test-"));
  limpar.push(() => rm(dir, { recursive: true, force: true }));
  const bin = async (nome: string, corpo: string) => {
    const f = join(dir, nome);
    await writeFile(f, `#!/bin/sh\n${corpo}\n`);
    await chmod(f, 0o755);
    return f;
  };
  const registro = join(dir, "registro");
  const binarios = {
    dbus: await bin("dbus", 'for a in "$@"; do case "$a" in --address=*) echo "${a#--address=}";; esac; done; exec sleep 60'),
    // Como os de verdade: o keyring só "destrava" depois de ler a senha inteira (grava e renomeia, atômico), e o
    // secret-tool falha até o keyring estar de pé — o supervisor tenta de novo. Antes o secret-tool passava na hora e o
    // teste podia ler o .keyring ainda vazio (corrida).
    keyring: await bin("keyring", `cat > "${registro}.keyring.tmp" && mv "${registro}.keyring.tmp" "${registro}.keyring"; exec sleep 60`),
    secretTool: await bin("secret-tool", `[ -f "${registro}.keyring" ] || { cat >/dev/null; exit 1; }; cat > "${registro}.safe"`),
    xvfb: "Xvfb", openbox: "openbox", chromium: "chromium", bwrap: null, xdotool: "xdotool", xclip: "xclip", scrot: "scrot",
  };
  const terminal = join(dir, "term.sock");
  const st = criarServidorTerminal({ raiz: join(dir, "raiz") });
  await escutar(st, terminal);
  limpar.push(() => new Promise((r) => st.close(r)));
  const logs: string[] = [];
  const sup = criarSupervisor({ raiz: join(dir, "raiz"), run: join(dir, "run"), terminal, bin: binarios, leitura, log: (m) => logs.push(m), aoAtualizar, agora, ...extra });
  limpar.push(() => sup.encerrar());
  return { dir, sup, registro, logs, terminal, binarios };
}

const { privada, publica } = chavesDeAssinatura(CRED, ID);
let n = 0;
let epocaTeste = 1_000;
let ultimaEpocaTeste = epocaTeste;
const epocasPorTroca = new Map<string, number>();
const cmd = (c: Record<string, unknown>, chave = privada) => {
  const tipo = c.tipo;
  const daTroca = tipo === "exportar_logins" || tipo === "importar_logins" || tipo === "cancelar_exportacao" || tipo === "marcar_saida";
  let epocaTroca = c.epocaTroca;
  if (daTroca && epocaTroca === undefined) {
    const troca = typeof c.troca === "string" ? c.troca : null;
    if (troca) {
      epocaTroca = epocasPorTroca.get(troca) ?? ++epocaTeste;
      epocasPorTroca.set(troca, epocaTroca as number);
      ultimaEpocaTeste = epocaTroca as number;
    } else epocaTroca = ultimaEpocaTeste;
  }
  return assinarComando({ id: `c${++n}`, computadorId: ID, uso: "equilibrado", prazoMs: Date.now() + 60_000, ...c, ...(daTroca ? { epocaTroca } : {}) }, chave);
};

async function iniciar(sup: Supervisor) {
  // Qualquer comando cria o computador no disco (e o par X25519); antes do TOFU ele é recusado.
  if (!sup.estados().some((e) => e.computadorId === ID)) await sup.tratar(cmd({ tipo: "parar" }));
  const supervisorPub = sup.estados().find((e) => e.computadorId === ID)!.supervisorPub;
  return sup.tratar(cmd({ tipo: "iniciar", servidorPub: publica, segredoSelado: selar(supervisorPub, chaveDaMaquina(CRED, ID)) }));
}

describe("supervisor", () => {
  it("recusa comando sem a chave do servidor fixada, fixa no primeiro iniciar (TOFU) e liga a máquina", async () => {
    const { sup, registro, dir } = await montar();
    expect((await sup.tratar(cmd({ tipo: "parar" }))).motivo).toBe("acao_falhou");
    const r = await iniciar(sup);
    expect(r).toMatchObject({ desfecho: "ok" });
    expect((await readFile(join(dir, "raiz", ID, "estado", "servidor.pub"), "utf8")).trim()).toBe(publica);
    const chave = chaveDaMaquina(CRED, ID);
    expect(await readFile(`${registro}.keyring`, "utf8")).toBe(chave);
    expect((await readFile(`${registro}.safe`, "utf8")).length).toBeGreaterThan(20);
    expect(sup.estados()[0]?.ligado).toBe(true);
    // Outra chave de servidor não entra depois de fixada, nem num iniciar.
    const outra = chavesDeAssinatura("c".repeat(64), ID);
    expect((await sup.tratar(cmd({ tipo: "parar", servidorPub: outra.publica }, outra.privada))).desfecho).toBe("falhou");
  });

  it("comando repetido ou vencido é recusado", async () => {
    const { sup } = await montar();
    await iniciar(sup);
    const c = cmd({ tipo: "fechar_tela", agenteId: "bot1" });
    expect((await sup.tratar(c)).desfecho).toBe("ok");
    expect((await sup.tratar(c)).desfecho).toBe("falhou");
    expect((await sup.tratar(cmd({ tipo: "fechar_tela", agenteId: "bot1", prazoMs: Date.now() - 1 }))).desfecho).toBe("falhou");
  });

  it("segredo selado para outra chave é cofre_invalido", async () => {
    const { sup } = await montar();
    await sup.tratar(cmd({ tipo: "parar" }));
    const r = await sup.tratar(cmd({ tipo: "iniciar", servidorPub: publica, segredoSelado: "AAAA" }));
    expect(r).toMatchObject({ desfecho: "falhou", motivo: "cofre_invalido" });
  });

  it("sob pressão e sem tela ociosa, a tela espera (esperando_tela), nunca erro", async () => {
    const { sup } = await montar(() => ({ memoria: "vermelha", processador: "verde" }));
    await iniciar(sup);
    const r = await sup.tratar(cmd({ tipo: "acao", agenteId: "bot1", acao: { tipo: "observar" } }));
    expect(r).toMatchObject({ desfecho: "esperando_tela", quem: [] });
    expect(sup.estados()[0]?.telas).toEqual([expect.objectContaining({ agenteId: "bot1", estado: "esperando" })]);
  });

  it("sair de todos zera a loja; redefinir troca a chave do supervisor e mantém logins/", async () => {
    const { sup, dir } = await montar();
    await iniciar(sup);
    const arquivo = join(dir, "raiz", ID, "logins", "principal", "cookies.enc");
    const chave = chaveDaLoja(chaveDaMaquina(CRED, ID));
    await gravarLoja(arquivo, chave, fundir(lojaVazia(), { postos: [{ name: "s", value: "1", domain: ".a.com", path: "/" }], removidos: [] }, Date.now()).loja);
    // NOD-97 PR 6: o storage em comum também sai no Sair de todos.
    const storage = pastaDoStorage(join(dir, "raiz", ID, "logins"));
    const chaveSt = chaveDoStorage(chaveDaMaquina(CRED, ID));
    const dados = { localStorage: [["k", "v"]], indexedDB: [], pulados: [] };
    await gravarOrigem(storage, chaveSt, { origem: "https://a.com", em: Date.now(), hash: hashDosDados(dados), dados });
    expect((await lerTudo(storage, chaveSt)).itens).toHaveLength(1);
    expect((await sup.tratar(cmd({ tipo: "sair_de_todos" }))).desfecho).toBe("ok");
    expect(cookiesVivos(await lerLoja(arquivo, chave))).toHaveLength(0);
    expect((await lerTudo(storage, chaveSt)).itens).toHaveLength(0);
    const antes = sup.estados()[0]?.supervisorPub;
    await mkdir(join(dir, "raiz", ID, "perfis", "bot1"), { recursive: true });
    const r = await sup.tratar(cmd({ tipo: "redefinir" }));
    expect(r).toMatchObject({ desfecho: "ok", progresso: { pct: 100 } });
    expect(sup.estados()[0]).toMatchObject({ ligado: false, operacao: null });
    expect(sup.estados()[0]?.supervisorPub).not.toBe(antes);
    // A chave nova volta na resposta do comando assinado (o servidor troca a fixada por ela).
    expect(r.supervisorPub).toBe(sup.estados()[0]?.supervisorPub);
    await expect(lerLoja(arquivo, chave)).resolves.toBeTruthy();
    await expect(stat(join(dir, "raiz", ID, "perfis", "bot1"))).rejects.toThrow();
    await expect(stat(join(dir, "raiz", ID, "perfil-base"))).resolves.toBeTruthy();
    // A chave do servidor fixada continua: o próximo comando assinado entra.
    expect((await sup.tratar(cmd({ tipo: "fechar_tela", agenteId: "bot1" }))).desfecho).toBe("ok");
  });

  it("esquecer senhas apaga a loja de senhas e o Login Data de cada perfil, e o computador segue ligado", async () => {
    const { sup, dir } = await montar();
    await iniciar(sup);
    const raiz = join(dir, "raiz", ID);
    const senhas = join(raiz, "logins", "principal", "senhas.enc");
    const loginData = (p: string) => join(raiz, p, "Default", "Login Data");
    await mkdir(join(raiz, "logins", "principal"), { recursive: true });
    await writeFile(senhas, "cifrado");
    for (const p of ["perfil-base", "perfis/bot1"]) {
      await mkdir(join(raiz, p, "Default"), { recursive: true });
      await writeFile(loginData(p), "sqlite");
      await writeFile(`${loginData(p)}-journal`, "j");
    }
    const r = await sup.tratar(cmd({ tipo: "esquecer_senhas" }));
    expect(r).toMatchObject({ desfecho: "ok", progresso: { pct: 100, etapa: "pronto" }, relancados: 0 });
    await expect(stat(senhas)).rejects.toThrow();
    await expect(stat(loginData("perfil-base"))).rejects.toThrow();
    await expect(stat(loginData("perfis/bot1"))).rejects.toThrow();
    await expect(stat(`${loginData("perfis/bot1")}-journal`)).rejects.toThrow();
    // Os perfis e os logins (cookies) ficam; só as senhas saem.
    await expect(stat(join(raiz, "perfis", "bot1"))).resolves.toBeTruthy();
    expect(sup.estados()[0]?.ligado).toBe(true);
    // A chave do servidor segue fixada: o próximo comando entra.
    expect((await sup.tratar(cmd({ tipo: "fechar_tela", agenteId: "bot1" }))).desfecho).toBe("ok");
  });

  it("esquecer senhas que não consegue apagar um Login Data falha (não diz que esqueceu) e o computador segue de pé", async () => {
    const { sup, dir, logs } = await montar();
    await iniciar(sup);
    const pasta = join(dir, "raiz", ID, "perfis", "bot1", "Default");
    await mkdir(pasta, { recursive: true });
    await writeFile(join(pasta, "Login Data"), "sqlite");
    await chmod(pasta, 0o500); // o rm do Login Data falha (EACCES)
    limpar.push(() => chmod(pasta, 0o700));
    const r = await sup.tratar(cmd({ tipo: "esquecer_senhas" }));
    expect(r).toMatchObject({ desfecho: "falhou", motivo: "acao_falhou" });
    expect(logs.some((l) => l.startsWith("esquecer_senhas:"))).toBe(true);
    await chmod(pasta, 0o700);
    // A fila da máquina não ficou presa na falha: a próxima operação roda e apaga.
    expect((await sup.tratar(cmd({ tipo: "esquecer_senhas" }))).desfecho).toBe("ok");
    await expect(stat(join(pasta, "Login Data"))).rejects.toThrow();
    expect(sup.estados()[0]).toMatchObject({ ligado: true, operacao: null });
  });

  it("sair de todos que não consegue apagar o storage guardado falha (não diz que saiu) e a fila segue viva", async () => {
    const { sup, dir } = await montar();
    await iniciar(sup);
    const storage = pastaDoStorage(join(dir, "raiz", ID, "logins"));
    const chaveSt = chaveDoStorage(chaveDaMaquina(CRED, ID));
    const dados = { localStorage: [["k", "v"]], indexedDB: [], pulados: [] };
    await gravarOrigem(storage, chaveSt, { origem: "https://a.com", em: Date.now(), hash: hashDosDados(dados), dados });
    await chmod(storage, 0o500);
    limpar.push(() => chmod(storage, 0o700));
    expect(await sup.tratar(cmd({ tipo: "sair_de_todos" }))).toMatchObject({ desfecho: "falhou", motivo: "acao_falhou" });
    await chmod(storage, 0o700);
    expect((await sup.tratar(cmd({ tipo: "sair_de_todos" }))).desfecho).toBe("ok");
    expect((await lerTudo(storage, chaveSt)).itens).toHaveLength(0);
  });

  it("dois comandos do mesmo computador novo chegando juntos criam UMA X25519, e os dois relatos mostram a mesma", async () => {
    // O e2e do computador na CI em máquina rápida (2026-11-04): dois bots no boot, duas sondas do servidor, o supervisor
    // criava o computador duas vezes com chaves diferentes; o servidor fixava a primeira (TOFU) e recusava o iniciar.
    const { sup } = await montar();
    const relatadas: string[] = [];
    sup.ouvir((m) => {
      const f = m as { tipo: string; computadorId?: string; supervisorPub?: string };
      if (f.tipo === "estado" && f.computadorId === ID && f.supervisorPub) relatadas.push(f.supervisorPub);
    });
    await Promise.all([sup.tratar(cmd({ tipo: "parar" })), sup.tratar(cmd({ tipo: "parar" }))]);
    const fixa = sup.estados().find((e) => e.computadorId === ID)!.supervisorPub;
    expect(relatadas.length).toBeGreaterThan(0);
    expect(new Set(relatadas)).toEqual(new Set([fixa]));
    expect((await iniciar(sup)).desfecho).toBe("ok");
  });

  it("as etapas que o supervisor emite em Sair de todos e Esquecer senhas são as que a web lista (ETAPAS)", async () => {
    const { sup } = await montar();
    await iniciar(sup);
    const vistas: Record<string, string[]> = {};
    sup.ouvir((m) => {
      const f = m as { tipo: string; operacao?: { tipo: string; etapa: string } | null };
      if (f.tipo === "estado" && f.operacao && f.operacao.etapa !== "pronto") (vistas[f.operacao.tipo] ??= []).push(f.operacao.etapa);
    });
    for (const tipo of ["sair_de_todos", "esquecer_senhas"] as const) {
      expect((await sup.tratar(cmd({ tipo }))).desfecho).toBe("ok");
      expect(vistas[tipo]?.length, tipo).toBeGreaterThan(0);
      for (const e of vistas[tipo]!) expect(ETAPAS[tipo], `${tipo}: ${e}`).toContain(e);
    }
  });

  it("as operações relatam o progresso em etapas e, durante elas, os outros comandos esperam (atualizando)", async () => {
    let reiniciou = 0;
    const { sup } = await montar(undefined, () => { reiniciou++; });
    await iniciar(sup);
    const fotos: Array<{ tipo: string; operacao?: { tipo: string; pct: number; etapa: string } | null }> = [];
    let durante: Promise<{ motivo?: string }> | null = null;
    sup.ouvir((m) => {
      const f = m as (typeof fotos)[number];
      if (f.tipo !== "estado") return;
      fotos.push(f);
      if (f.operacao && !durante) durante = sup.tratar(cmd({ tipo: "acao", agenteId: "bot1", acao: { tipo: "observar" } }));
    });
    const r = await sup.tratar(cmd({ tipo: "atualizar" }));
    expect(r).toMatchObject({ desfecho: "ok", progresso: { pct: 100, etapa: "pronto" } });
    const pcts = fotos.flatMap((f) => (f.operacao ? [f.operacao.pct] : []));
    expect(pcts.length).toBeGreaterThanOrEqual(3);
    expect(pcts).toEqual([...pcts].sort((a, b) => a - b));
    expect(fotos.at(-1)?.operacao).toBeNull();
    expect(await durante).toMatchObject({ desfecho: "falhou", motivo: "atualizando" });
    expect(sup.estados()[0]).toMatchObject({ ligado: false });
    // As etapas têm os nomes que a web mostra (ETAPAS.atualizar do #494).
    const etapas = new Set(fotos.flatMap((f) => (f.operacao ? [f.operacao.etapa] : [])));
    expect([...etapas].every((e) => ["Preparando", "Baixando a versão nova", "Reiniciando", "Reconectando"].includes(e))).toBe(true);
    await new Promise((r) => setTimeout(r, 300));
    expect(reiniciou).toBe(1);
  });

  it("apagar_perfil apaga o perfil do bot e deixa os outros e os logins", async () => {
    const { sup, dir } = await montar();
    await iniciar(sup);
    const raiz = join(dir, "raiz", ID);
    await mkdir(join(raiz, "perfis", "bot1"), { recursive: true });
    await mkdir(join(raiz, "perfis", "bot2"), { recursive: true });
    expect((await sup.tratar(cmd({ tipo: "apagar_perfil" }))).desfecho).toBe("falhou");
    expect((await sup.tratar(cmd({ tipo: "apagar_perfil", agenteId: "../x" }))).desfecho).toBe("falhou");
    expect((await sup.tratar(cmd({ tipo: "apagar_perfil", agenteId: "bot1" }))).desfecho).toBe("ok");
    await expect(stat(join(raiz, "perfis", "bot1"))).rejects.toThrow();
    await expect(stat(join(raiz, "perfis", "bot2"))).resolves.toBeTruthy();
    await expect(stat(join(raiz, "logins"))).resolves.toBeTruthy();
  });

  it("o socket de controle fala NDJSON: estado ao conectar e resultado por comando", async () => {
    const { sup, dir } = await montar();
    await iniciar(sup);
    const caminho = join(dir, "ctl.sock");
    const srv = servirControle(sup);
    await escutarControle(srv, caminho);
    limpar.push(() => new Promise((r) => srv.close(r)));
    const linhas: Array<Record<string, unknown>> = [];
    const s = connect(caminho);
    limpar.push(() => s.destroy());
    let buf = "";
    const chegou = (cond: (m: Record<string, unknown>) => boolean) => new Promise<Record<string, unknown>>((resolve) => {
      const ver = () => { const m = linhas.find(cond); if (m) resolve(m); else setTimeout(ver, 10); };
      ver();
    });
    s.on("data", (b) => { buf += b; let i; while ((i = buf.indexOf("\n")) >= 0) { linhas.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
    expect(await chegou((m) => m.tipo === "estado")).toMatchObject({ computadorId: ID, ligado: true });
    const c = cmd({ tipo: "fechar_tela", agenteId: "bot9" });
    s.write(`${JSON.stringify(c)}\nlixo\n`);
    expect(await chegou((m) => m.tipo === "resultado" && m.id === c.id)).toMatchObject({ desfecho: "ok" });
    expect(await chegou((m) => m.tipo === "resultado" && m.id === "")).toMatchObject({ desfecho: "falhou" });
    // O envelope do motor (MensagemAoSupervisor): comando embrulhado e pedido da foto.
    const e = cmd({ tipo: "fechar_tela", agenteId: "bot8" });
    s.write(`${JSON.stringify({ tipo: "comando", comando: e })}\n`);
    expect(await chegou((m) => m.tipo === "resultado" && m.id === e.id)).toMatchObject({ desfecho: "ok" });
    const fotosAntes = linhas.filter((m) => m.tipo === "estado").length;
    s.write(`${JSON.stringify({ tipo: "pedir_estado" })}\n`);
    await chegou(() => linhas.filter((m) => m.tipo === "estado").length > fotosAntes);
  });
});

describe("NOD-95 (ADR-138): o `vivo` no socket de controle", () => {
  /** Uma tela de mentira: abre na hora e, no `vivo`, serve um "VNC" num socket unix que fala primeiro e ecoa em maiúsculas. */
  const TELA_FALSA = `
import net from "node:net";
import path from "node:path";
import { mkdir } from "node:fs/promises";
let cfg = null;
process.on("message", async (m) => {
  if (m.tipo === "abrir") { cfg = m.config; await mkdir(cfg.tmp, { recursive: true }); process.send({ tipo: "pronta" }); }
  else if (m.tipo === "vivo") {
    const socket = path.join(cfg.tmp, "vnc.sock");
    const srv = net.createServer((s) => { s.write("RFB 003.008\\n"); s.on("data", (b) => s.write(b.toString().toUpperCase())); });
    srv.listen(socket, () => process.send({ tipo: "resposta", id: m.id, resultado: { socket } }));
  }
  else if (m.tipo === "acao") process.send({ tipo: "resposta", id: m.id, resultado: { quadro: "q", imagem: "", largura: 1280, altura: 800, url: "", titulo: "", texto: "", abas: [] } });
  else if (m.tipo === "fechar") { process.send({ tipo: "fechada" }); process.exit(0); }
});
`;

  it("aceito, a conexão vira o fluxo cru do VNC; o envelope comum recusa o vivo; a tela conta como ativa", async () => {
    const tela = join(tmpdir(), `nod-tela-falsa-${process.pid}-${Date.now()}.mjs`);
    await writeFile(tela, TELA_FALSA);
    limpar.push(() => rm(tela, { force: true }));
    const { sup, dir } = await montar(undefined, undefined, undefined, { tela });
    await iniciar(sup);
    const caminho = join(dir, "ctl.sock");
    const srv = servirControle(sup);
    await escutarControle(srv, caminho);
    limpar.push(() => new Promise((r) => srv.close(r)));
    const abrir = () => {
      const s = connect(caminho);
      limpar.push(() => s.destroy());
      const pedacos: Buffer[] = [];
      s.on("data", (b: Buffer) => pedacos.push(Buffer.from(b)));
      const texto = () => Buffer.concat(pedacos).toString("utf8");
      const ate = async (cond: () => boolean) => { for (let i = 0; i < 300 && !cond(); i++) await new Promise((r) => setTimeout(r, 10)); expect(cond()).toBe(true); };
      return { s, texto, ate, pedacos };
    };
    // 5ª revisão: o vivo não abre tela. Um vivo atrasado que chega depois do `fechar_tela` do Parar é recusado e a
    // tela continua fechada (antes ele a reabria e ela segurava a máquina acordada com a pessoa no controle).
    const tarde = abrir();
    const ct = cmd({ tipo: "vivo", agenteId: "bot1", vivo: { sessao: "st", token: "tt" } });
    tarde.s.write(`${JSON.stringify({ tipo: "vivo", comando: ct })}\n`);
    await tarde.ate(() => tarde.texto().includes('"tipo":"vivo","ok":false'));
    expect(tarde.texto()).toContain('{"tipo":"vivo","ok":false,"motivo":"tela_alterada"}');
    expect(sup.estados().find((e) => e.computadorId === ID)?.telas.find((t) => t.agenteId === "bot1")?.estado ?? "fechada").toBe("fechada");
    // A web abre a tela pela captura (`observar`) antes de pedir o ao vivo.
    expect((await sup.tratar(cmd({ tipo: "abrir_tela", agenteId: "bot1" }))).desfecho).toBe("ok");
    // Pelo envelope comum, o vivo é recusado: não tem como ligar o fluxo ali.
    const comum = abrir();
    const c0 = cmd({ tipo: "vivo", agenteId: "bot1", vivo: { sessao: "s0", token: "t0" } });
    comum.s.write(`${JSON.stringify({ tipo: "comando", comando: c0 })}\n`);
    await comum.ate(() => comum.texto().includes(`"id":"${c0.id}"`));
    expect(comum.texto()).toContain(`{"tipo":"resultado","id":"${c0.id}","desfecho":"falhou","motivo":"acao_falhou"}`);
    // Pela mensagem própria: ok, e depois dele só VNC — a tela de mentira fala primeiro e ecoa em maiúsculas.
    const vivo = abrir();
    const c1 = cmd({ tipo: "vivo", agenteId: "bot1", vivo: { sessao: "s1", token: "t1" } });
    vivo.s.write(`${JSON.stringify({ tipo: "vivo", comando: c1 })}\n`);
    await vivo.ate(() => vivo.texto().includes('{"tipo":"vivo","ok":true}'));
    await vivo.ate(() => vivo.texto().includes("RFB 003.008\n"));
    const antes = vivo.texto().length;
    vivo.s.write("ola");
    await vivo.ate(() => vivo.texto().length >= antes + 3);
    expect(vivo.texto().slice(antes)).toBe("OLA");
    // Depois do ok, nenhum estado JSON entra no fluxo (o supervisor relata ao tocar a tela e ao mudar).
    sup.tocarTela(ID, "bot1");
    await new Promise((r) => setTimeout(r, 50));
    expect(vivo.texto().slice(antes)).toBe("OLA");
    expect(sup.estados().find((e) => e.computadorId === ID)?.telas.find((t) => t.agenteId === "bot1")?.estado).toBe("aberta");
    // O vivo sem assinatura válida é recusado antes de qualquer fluxo.
    const falso = abrir();
    falso.s.write(`${JSON.stringify({ tipo: "vivo", comando: { ...c1, id: "x", assinatura: "errada" } })}\n`);
    await falso.ate(() => falso.texto().includes('"tipo":"vivo","ok":false'));
    expect(falso.texto()).toContain('{"tipo":"vivo","ok":false,"motivo":"acao_falhou"}');
  });
});

describe("NOD-365: a loja de logins muda de máquina", () => {
  const chave = chaveDaLoja(chaveDaMaquina(CRED, ID));
  const loja = (dir: string) => join(dir, "raiz", ID, "logins", "principal", "cookies.enc");
  const comCookie = async (dir: string, valor: string) => gravarLoja(loja(dir), chave, fundir(lojaVazia(), { postos: [{ name: "s", value: valor, domain: ".a.com", path: "/" }], removidos: [] }, Date.now()).loja);

  /** Leva a loja da origem ao destino como o driver leva: exporta parte a parte e importa cada uma, na ordem. */
  async function levar(origem: Supervisor, destino: Supervisor, troca = "t1") {
    const partes: string[] = [];
    let total = 1;
    for (let i = 0; i < total; i++) {
      const r = await origem.tratar(cmd({ tipo: "exportar_logins", troca, parte: i, servidorPub: publica }));
      expect(r.desfecho).toBe("ok");
      total = r.logins!.total;
      partes.push(r.logins!.dados);
    }
    for (let i = 0; i < total; i++) {
      const r = await destino.tratar(cmd({ tipo: "importar_logins", troca, parte: i, total, dados: partes[i], servidorPub: publica }));
      expect(r.desfecho).toBe("ok");
    }
    return partes;
  }

  it("ida e volta: a loja cifrada chega igual, o destino sem TOFU fixa a chave e o canal não leva texto claro", async () => {
    const a = await montar();
    const b = await montar();
    await iniciar(a.sup);
    await comCookie(a.dir, "segredo-do-cookie");
    const partes = await levar(a.sup, b.sup);
    // A origem desligou (a loja parou de mudar) e o destino passou a confiar na mesma chave do servidor.
    expect(a.sup.estados()[0]?.ligado).toBe(false);
    expect((await readFile(join(b.dir, "raiz", ID, "estado", "servidor.pub"), "utf8")).trim()).toBe(publica);
    expect(Buffer.from(partes.join(""), "base64").toString("latin1")).not.toContain("segredo-do-cookie");
    expect(await readFile(loja(b.dir))).toEqual(await readFile(loja(a.dir)));
    expect(cookiesVivos(await lerLoja(loja(b.dir), chave)).map((c) => c.value)).toEqual(["segredo-do-cookie"]);
    // E volta: a loja do destino substitui a da origem inteira.
    await comCookie(b.dir, "mudou-no-destino");
    await levar(b.sup, a.sup, "t2");
    expect(cookiesVivos(await lerLoja(loja(a.dir), chave)).map((c) => c.value)).toEqual(["mudou-no-destino"]);
  });

  it("a importação recusa parte fora de ordem, troca trocada e pacote com nome fora da lista", async () => {
    const b = await montar();
    const imp = (c: Record<string, unknown>) => b.sup.tratar(cmd({ tipo: "importar_logins", servidorPub: publica, ...c }));
    expect((await imp({ troca: "t", parte: 1, total: 2, dados: "" })).desfecho).toBe("falhou");
    expect((await imp({ troca: "t", parte: 0, total: 2, dados: "" })).desfecho).toBe("ok");
    expect((await imp({ troca: "outra", parte: 1, total: 2, dados: "" })).desfecho).toBe("falhou");
    expect((await imp({ troca: "t", parte: 0, total: 99_999, dados: "" })).desfecho).toBe("falhou");
    for (const nome of ["../../estado/servidor.pub", "storage/../../x.enc", "Cookies", "storage/estado.enc/../a"]) {
      const pacote = Buffer.from(JSON.stringify({ versao: 1, arquivos: [{ nome, dados: "AA==" }] })).toString("base64");
      expect((await imp({ troca: `n${++n}`, parte: 0, total: 1, dados: pacote })).desfecho).toBe("falhou");
    }
    const versao2 = Buffer.from(JSON.stringify({ versao: 2, arquivos: [] })).toString("base64");
    expect((await imp({ troca: "v2", parte: 0, total: 1, dados: versao2 })).desfecho).toBe("falhou");
    await expect(stat(join(b.dir, "raiz", ID, "estado", "x.enc"))).rejects.toThrow();
  });

  it("a exportação não segue um symlink plantado na loja", async () => {
    const a = await montar();
    await iniciar(a.sup);
    const { symlink } = await import("node:fs/promises");
    await symlink(join(a.dir, "raiz", ID, "estado", "supervisor.key"), join(a.dir, "raiz", ID, "logins", "principal", "senhas.enc"));
    const r = await a.sup.tratar(cmd({ tipo: "exportar_logins", troca: "s", parte: 0, servidorPub: publica }));
    const pacote = JSON.parse(Buffer.from(r.logins!.dados, "base64").toString("utf8")) as { arquivos: { nome: string }[] };
    expect(pacote.arquivos.map((x) => x.nome)).not.toContain("senhas.enc");
  });

  it("uma importação que caiu entre os renames é recuperada ao carregar, sem perder a loja nova", async () => {
    const a = await montar();
    const logins = join(a.dir, "raiz", ID, "logins");
    await mkdir(join(logins, "principal.novo"), { recursive: true });
    await writeFile(join(logins, "principal.novo", "cookies.enc"), "novo");
    await mkdir(join(logins, "principal.velho"), { recursive: true });
    await a.sup.carregar();
    expect(await readFile(join(logins, "principal", "cookies.enc"), "utf8")).toBe("novo");
    await expect(stat(join(logins, "principal.velho"))).rejects.toThrow();
  });

  it("o iniciar em voo termina antes de a exportação desligar: a origem fica desligada e a loja parada", async () => {
    const a = await montar();
    // A chave do servidor já fixada: sem isso, os dois comandos gravam o servidor.pub ao mesmo tempo e, sob carga, a
    // exportação pode entrar na fila antes do iniciar (o teste ficava instável).
    await iniciar(a.sup);
    await a.sup.tratar(cmd({ tipo: "parar" }));
    expect(a.sup.estados()[0]?.ligado).toBe(false);
    const supervisorPub = a.sup.estados().find((e) => e.computadorId === ID)!.supervisorPub;
    const ligando = a.sup.tratar(cmd({ tipo: "iniciar", servidorPub: publica, segredoSelado: selar(supervisorPub, chaveDaMaquina(CRED, ID)) }));
    const exportando = a.sup.tratar(cmd({ tipo: "exportar_logins", troca: "voo", parte: 0, servidorPub: publica }));
    expect((await ligando).desfecho).toBe("ok");
    expect((await exportando).desfecho).toBe("ok");
    expect(a.sup.estados()[0]?.ligado).toBe(false);
  });

  it("exportar e iniciar no mesmo tick: o iniciar enfileirado revalida e não religa a origem", async () => {
    const a = await montar();
    await iniciar(a.sup);
    await a.sup.tratar(cmd({ tipo: "parar" }));
    await writeFile(loja(a.dir), Buffer.alloc(600 * 1024, 7));
    const supervisorPub = a.sup.estados().find((e) => e.computadorId === ID)!.supervisorPub;
    const exportando = a.sup.tratar(cmd({ tipo: "exportar_logins", troca: "mesmo-tick", parte: 0, servidorPub: publica }));
    const ligando = a.sup.tratar(cmd({ tipo: "iniciar", servidorPub: publica, segredoSelado: selar(supervisorPub, chaveDaMaquina(CRED, ID)) }));
    expect((await exportando).logins!.total).toBeGreaterThan(1);
    expect(await ligando).toMatchObject({ desfecho: "falhou", motivo: "atualizando" });
    expect(a.sup.estados()[0]?.ligado).toBe(false);
  });

  it("com a exportação aberta (partes faltando), o iniciar e o abrir_tela recusam com atualizando", async () => {
    const a = await montar();
    await iniciar(a.sup);
    // Uma loja de ~600 KiB sai em duas partes de 384 KiB.
    await writeFile(loja(a.dir), Buffer.alloc(600 * 1024, 7));
    const p0 = await a.sup.tratar(cmd({ tipo: "exportar_logins", troca: "aberta", parte: 0, servidorPub: publica }));
    expect(p0.logins!.total).toBeGreaterThan(1);
    const supervisorPub = a.sup.estados().find((e) => e.computadorId === ID)!.supervisorPub;
    const religar = () => a.sup.tratar(cmd({ tipo: "iniciar", servidorPub: publica, segredoSelado: selar(supervisorPub, chaveDaMaquina(CRED, ID)) }));
    expect(await religar()).toMatchObject({ desfecho: "falhou", motivo: "atualizando" });
    expect(await a.sup.tratar(cmd({ tipo: "abrir_tela", agenteId: "ag1" }))).toMatchObject({ desfecho: "falhou", motivo: "atualizando" });
    for (let i = 1; i < p0.logins!.total; i++) expect((await a.sup.tratar(cmd({ tipo: "exportar_logins", troca: "aberta", parte: i, servidorPub: publica }))).desfecho).toBe("ok");
    // Entregar a última parte não libera a origem: só o cancelamento explícito (falha) ou marcar_saida (sucesso).
    expect(await religar()).toMatchObject({ desfecho: "falhou", motivo: "atualizando" });
    expect((await a.sup.tratar(cmd({ tipo: "cancelar_exportacao", troca: "aberta" }))).desfecho).toBe("ok");
    // A loja de teste é lixo (o iniciar pode falhar ao lê-la), mas o bloqueio da exportação acabou.
    expect((await religar()).motivo).not.toBe("atualizando");
  });

  it("pacote de uma parte continua bloqueando a origem até cancelar", async () => {
    const a = await montar();
    await iniciar(a.sup);
    const supervisorPub = a.sup.estados().find((e) => e.computadorId === ID)!.supervisorPub;
    const p0 = await a.sup.tratar(cmd({ tipo: "exportar_logins", troca: "curta", parte: 0, servidorPub: publica }));
    expect(p0.logins!.total).toBe(1);
    const religar = () => a.sup.tratar(cmd({ tipo: "iniciar", servidorPub: publica, segredoSelado: selar(supervisorPub, chaveDaMaquina(CRED, ID)) }));
    expect(await religar()).toMatchObject({ desfecho: "falhou", motivo: "atualizando" });
    expect((await a.sup.tratar(cmd({ tipo: "cancelar_exportacao", troca: "curta" }))).desfecho).toBe("ok");
    expect((await religar()).motivo).not.toBe("atualizando");
  });

  it("virar destino invalida o snapshot antigo que ainda tinha partes", async () => {
    const a = await montar();
    await iniciar(a.sup);
    await writeFile(loja(a.dir), Buffer.alloc(600 * 1024, 7));
    const p0 = await a.sup.tratar(cmd({ tipo: "exportar_logins", troca: "antiga", parte: 0, servidorPub: publica }));
    expect(p0.logins!.total).toBeGreaterThan(1);
    const vazio = Buffer.from(JSON.stringify({ versao: 1, arquivos: [] })).toString("base64");
    expect((await a.sup.tratar(cmd({ tipo: "importar_logins", troca: "nova", parte: 0, total: 1, dados: vazio, servidorPub: publica }))).desfecho).toBe("ok");
    expect(await a.sup.tratar(cmd({ tipo: "exportar_logins", troca: "antiga", parte: 1, servidorPub: publica }))).toMatchObject({ desfecho: "falhou", motivo: "acao_falhou" });
  });

  it("recusa partes e trocas antigas pela época, inclusive depois de reiniciar", async () => {
    const a = await montar();
    await iniciar(a.sup);
    await writeFile(loja(a.dir), Buffer.alloc(600 * 1024, 7));
    const p0 = await a.sup.tratar(cmd({ tipo: "exportar_logins", troca: "epoca-atual", epocaTroca: 20_000, parte: 0, servidorPub: publica }));
    expect(p0.logins!.total).toBeGreaterThan(1);
    expect(await a.sup.tratar(cmd({ tipo: "exportar_logins", troca: "epoca-atual", epocaTroca: 19_999, parte: 1, servidorPub: publica }))).toMatchObject({ desfecho: "falhou", motivo: "acao_falhou" });
    const sup2 = criarSupervisor({ raiz: join(a.dir, "raiz"), run: join(a.dir, "run-epoca"), terminal: a.terminal, bin: a.binarios, log: () => {} });
    limpar.push(() => sup2.encerrar());
    await sup2.carregar();
    const vazio = Buffer.from(JSON.stringify({ versao: 1, arquivos: [] })).toString("base64");
    expect(await sup2.tratar(cmd({ tipo: "importar_logins", troca: "replay-antigo", epocaTroca: 19_999, parte: 0, total: 1, dados: vazio, servidorPub: publica }))).toMatchObject({ desfecho: "falhou", motivo: "acao_falhou" });
  });

  it("o bloqueio da origem sobrevive ao reinício do supervisor", async () => {
    const a = await montar();
    await iniciar(a.sup);
    expect((await a.sup.tratar(cmd({ tipo: "exportar_logins", troca: "reinicio", parte: 0, servidorPub: publica }))).desfecho).toBe("ok");
    const sup2 = criarSupervisor({ raiz: join(a.dir, "raiz"), run: join(a.dir, "run2"), terminal: a.terminal, bin: a.binarios, log: () => {} });
    limpar.push(() => sup2.encerrar());
    await sup2.carregar();
    const supervisorPub = sup2.estados().find((e) => e.computadorId === ID)!.supervisorPub;
    expect(await sup2.tratar(cmd({ tipo: "iniciar", servidorPub: publica, segredoSelado: selar(supervisorPub, chaveDaMaquina(CRED, ID)) }))).toMatchObject({ desfecho: "falhou", motivo: "atualizando" });
    expect((await sup2.tratar(cmd({ tipo: "cancelar_exportacao", troca: "reinicio" }))).desfecho).toBe("ok");
  });

  it("uma exportação abandonada destrava a origem após 10 min sem partes, inclusive depois de reiniciar", async () => {
    let agora = Date.now();
    const a = await montar(undefined, undefined, () => agora);
    await iniciar(a.sup);
    expect((await a.sup.tratar(cmd({ tipo: "exportar_logins", troca: "abandonada", parte: 0, servidorPub: publica }))).desfecho).toBe("ok");
    agora += 10 * 60_000 + 1;
    const sup2 = criarSupervisor({ raiz: join(a.dir, "raiz"), run: join(a.dir, "run-expirada"), terminal: a.terminal, bin: a.binarios, agora: () => agora, log: () => {} });
    limpar.push(() => sup2.encerrar());
    await sup2.carregar();
    const supervisorPub = sup2.estados().find((e) => e.computadorId === ID)!.supervisorPub;
    expect(await sup2.tratar(cmd({ tipo: "iniciar", prazoMs: agora + 60_000, servidorPub: publica, segredoSelado: selar(supervisorPub, chaveDaMaquina(CRED, ID)) }))).toMatchObject({ desfecho: "ok" });
  });

  it("marcar_saida que não grava a marca mantém a origem bloqueada", async () => {
    const a = await montar();
    await iniciar(a.sup);
    expect((await a.sup.tratar(cmd({ tipo: "exportar_logins", troca: "marca-falha", parte: 0, servidorPub: publica }))).desfecho).toBe("ok");
    const raizDoComputador = join(a.dir, "raiz", ID);
    await chmod(raizDoComputador, 0o500);
    expect((await a.sup.tratar(cmd({ tipo: "marcar_saida" }))).desfecho).toBe("falhou");
    await chmod(raizDoComputador, 0o700);
    const supervisorPub = a.sup.estados().find((e) => e.computadorId === ID)!.supervisorPub;
    expect(await a.sup.tratar(cmd({ tipo: "iniciar", servidorPub: publica, segredoSelado: selar(supervisorPub, chaveDaMaquina(CRED, ID)) }))).toMatchObject({ desfecho: "falhou", motivo: "atualizando" });
    expect((await a.sup.tratar(cmd({ tipo: "cancelar_exportacao", troca: "marca-falha" }))).desfecho).toBe("ok");
  });

  it("marcar_saida desliga e a varredura apaga a pasta só com 30 dias; o iniciar desmarca", async () => {
    let agora = Date.now();
    const dir = await mkdtemp(join(tmpdir(), "nod-supervisor-varre-"));
    limpar.push(() => rm(dir, { recursive: true, force: true }));
    const sup = criarSupervisor({ raiz: join(dir, "raiz"), run: join(dir, "run"), terminal: join(dir, "t.sock"), bin: { dbus: "true", keyring: "true", secretTool: "true", xvfb: "Xvfb", openbox: "openbox", chromium: "chromium", bwrap: null, xdotool: "xdotool", xclip: "xclip", scrot: "scrot" }, agora: () => agora, log: () => {} });
    limpar.push(() => sup.encerrar());
    await sup.tratar(cmd({ tipo: "exportar_logins", troca: "m", parte: 0, servidorPub: publica }));
    expect((await sup.tratar(cmd({ tipo: "marcar_saida" }))).desfecho).toBe("ok");
    agora += 29 * 24 * 3_600_000;
    expect(await sup.varrer()).toEqual([]);
    agora += 24 * 3_600_000;
    expect(await sup.varrer()).toEqual([ID]);
    await expect(stat(join(dir, "raiz", ID))).rejects.toThrow();
  });
});

describe("a ação da pessoa chega à tela marcada (revisão 11 do PR #600)", () => {
  it("o comando assinado com `pessoa: true` leva a marca à tela; o do bot, não (a trava do dock é só contra o bot)", async () => {
    const pasta = await mkdtemp(join(tmpdir(), "nod-tela-pessoa-"));
    limpar.push(() => rm(pasta, { recursive: true, force: true }));
    const registro = join(pasta, "acoes");
    const tela = join(pasta, "tela.mjs");
    await writeFile(tela, `
import { appendFileSync, mkdirSync } from "node:fs";
process.on("message", (m) => {
  if (m.tipo === "abrir") { mkdirSync(m.config.tmp, { recursive: true }); process.send({ tipo: "pronta" }); }
  else if (m.tipo === "acao") { appendFileSync(${JSON.stringify(registro)}, JSON.stringify({ tipo: m.acao.tipo, pessoa: m.pessoa ?? null }) + "\\n"); process.send({ tipo: "resposta", id: m.id, resultado: { quadro: "q", imagem: "", largura: 1280, altura: 800, url: "", titulo: "", texto: "", abas: [] } }); }
  else if (m.tipo === "fechar") { process.send({ tipo: "fechada" }); process.exit(0); }
});
`);
    const { sup } = await montar(undefined, undefined, undefined, { tela });
    await iniciar(sup);
    expect((await sup.tratar(cmd({ tipo: "acao", agenteId: "bot1", acao: { tipo: "clicar", x: 10, y: 790 }, pessoa: true }))).desfecho).toBe("ok");
    expect((await sup.tratar(cmd({ tipo: "acao", agenteId: "bot1", acao: { tipo: "clicar", x: 10, y: 790 } }))).desfecho).toBe("ok");
    const linhas = (await readFile(registro, "utf8")).trim().split("\n").map((l) => JSON.parse(l));
    expect(linhas).toEqual([{ tipo: "clicar", pessoa: true }, { tipo: "clicar", pessoa: null }]);
  });
});
