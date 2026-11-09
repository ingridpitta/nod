// definido em 2026-10-22 (NOD-96 PR 2, ADR-122): o supervisor do computador da pessoa. Roda como `nod-pc`
// (nod-computador.service, ativado por socket) e é o único dono dos perfis, da loja de logins e do keyring. Recebe do
// motor, pelo socket Unix /run/nod-computador/ctl.sock, os ComandoComputador assinados pelo servidor (Ed25519, 2 min,
// anti-replay), abre e fecha as telas (tela.mjs, um processo por bot) pela régua de memória, funde os cookies na loja
// única e repassa às outras telas, e relata o estado (RelatoComputador) a quem estiver ligado no socket.
//
// Protocolo do socket: uma linha JSON por mensagem, nos dois sentidos. Entra MensagemAoSupervisor
// ({tipo:"comando", comando} ou {tipo:"pedir_estado"}; o ComandoComputador cru também vale); sai
// {tipo:"resultado", ...ResultadoComandoComputador} para cada comando e {tipo:"estado", ...EstadoComputadorRelatado} ao
// conectar, a cada mudança de tela e a cada batimento.
import { clearInterval, clearTimeout, setInterval, setTimeout } from 'node:timers';
import { fork } from 'node:child_process';
import { mkdir, readFile, readdir, rename, rm, writeFile, chmod } from 'node:fs/promises';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { availableParallelism, totalmem } from 'node:os';
import net from 'node:net';
import { StringDecoder } from 'node:string_decoder';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as esperar } from 'node:timers/promises';
import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { createPrivateKey, randomUUID } from 'node:crypto';
import { abrirSelo, chaveDaLoja, chaveDasSenhas, chaveDoStorage, conferirComando, novoParX25519, publicaX25519, senhaSafeStorage } from './chaves.mjs';
import { atualizarLoja, cookiesVivos, fundir, lerLoja, zerar } from './loja-cookies.mjs';
import { decidirAbertura, leituraLocal } from './regua.mjs';
import { gravarOrigem, lerEstado, lerTudo, limparStorage, pastaDoStorage } from './login-storage.mjs';
import { arquivoDasSenhas, esquecerSenhas, lerSenhas, recolherSenhas } from './login-senhas.mjs';
import { RESOLV_DO_STUB, vizinhosDoTmp } from './isolamento.mjs';
import { desempacotar, desmarcarSaida, empacotar, gravarLoja as gravarLojaImportada, marcarSaida, PARTE_BYTES, partir, recuperar, saiuEm, TETO_LOJA_BYTES, VALIDADE_IMPORTACAO_MS, venceu } from './troca-logins.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
export const ID_VALIDO = /^[A-Za-z0-9_-]{1,64}$/;
export const TIPOS = ['iniciar', 'abrir_tela', 'acao', 'fechar_tela', 'parar', 'atualizar', 'redefinir', 'sair_de_todos', 'esquecer_senhas', 'apagar_perfil', 'exportar_logins', 'importar_logins', 'cancelar_exportacao', 'marcar_saida', 'vivo'];
/**
 * NOD-365 (definido em 2026-10-28): os comandos que podem chegar antes de o computador conhecer a chave do servidor e
 * a fixam (TOFU), como o `iniciar`: a troca de máquina começa na origem e no destino antes de qualquer `iniciar` lá.
 */
export const TIPOS_QUE_FIXAM = ['iniciar', 'exportar_logins', 'importar_logins'];
/** definido em 2026-10-28 (NOD-365): a varredura das pastas que saíram desta máquina roda ao carregar e a cada 6 h. */
export const VARREDURA_MS = 6 * 60 * 60_000;
/** NOD-365: trava durável da origem entre o snapshot e `marcar_saida`/`cancelar_exportacao`. */
export const MARCA_TROCA_EM_CURSO = '.troca-em-curso';
/** Os comandos que dizem a tela (levam `agenteId`). */
export const TIPOS_DA_TELA = ['abrir_tela', 'acao', 'fechar_tela', 'apagar_perfil', 'vivo'];
export const PRAZO_ABRIR_TELA_MS = 60_000;
export const PRAZO_ACAO_MS = 55_000;
/** Quanto o supervisor espera a tela fechar antes do SIGKILL (o orçamento do fechar da tela cabe nele). */
export const PRAZO_FECHAR_TELA_MS = 15_000;
/** Revisão 12 do PR #600: o Sair de todos pode relançar o Chrome que a pessoa fechou pelo dock antes de limpar. */
export const PRAZO_LIMPAR_STORAGE_MS = 45_000;

/**
 * Revisão 15 do PR #600: manda ao filho sem derrubar o supervisor. Entre o filho soltar o canal (a tela que sai sozinha
 * depois de um pedido preso) e o 'exit', o `send` sem callback vira um 'error' sem ouvinte e mata o supervisor com as
 * telas de todos os bots. Devolve false se o canal já fechou; `aoFalhar` recebe o erro de um envio que falhou depois.
 */
export function mandarAoFilho(proc, mensagem, aoFalhar = () => {}) {
  if (!proc?.connected) return false;
  try {
    proc.send(mensagem, (e) => { if (e) aoFalhar(e); });
    return true;
  } catch (e) {
    aoFalhar(e);
    return false;
  }
}
/** NOD-95 (ADR-138): a tela tem 10 s para subir o x11vnc; e, com a pessoa ao vivo, a tela conta como ativa a cada 30 s. */
export const PRAZO_VIVO_MS = 10_000;
export const TOQUE_VIVO_MS = 30_000;
export const BATIMENTO_MS = 30_000;
/** Displays :100 a :199 (ADR-122: Xvfb :1NN). */
export const DISPLAY_BASE = 100;
/**
 * Config do dbus de cada computador: o session.conf padrão sem `<standard_session_servicedirs/>` (nada é ativado sob
 * demanda; o keyring é sempre o que o supervisor sobe destravado). O endereço vem do `--address`.
 */
export const CONF_DO_BUS = `<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-Bus Bus Configuration 1.0//EN"
 "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<busconfig>
  <type>session</type>
  <keep_umask/>
  <listen>unix:tmpdir=/tmp</listen>
  <auth>EXTERNAL</auth>
  <policy context="default">
    <allow send_destination="*" eavesdrop="true"/>
    <allow eavesdrop="true"/>
    <allow own="*"/>
  </policy>
</busconfig>
`;

/** PSS (MB) da árvore de processos de `pid`, via smaps_rollup. 0 se não der para ler. */
export function memoriaDaArvore(pid) {
  if (!pid) return null;
  const pais = new Map();
  try {
    for (const d of readdirSync('/proc')) {
      if (!/^\d+$/.test(d)) continue;
      try {
        const s = readFileSync(`/proc/${d}/stat`, 'utf8');
        pais.set(Number(d), Number(s.slice(s.lastIndexOf(')') + 2).split(' ')[1]));
      } catch { /* segue */ }
    }
  } catch {
    return null;
  }
  const dentro = new Set([pid]);
  for (let mudou = true; mudou; ) {
    mudou = false;
    for (const [p, pp] of pais) if (!dentro.has(p) && dentro.has(pp)) { dentro.add(p); mudou = true; }
  }
  let kb = 0;
  for (const p of dentro) {
    try {
      kb += Number(/^Pss:\s+(\d+) kB/m.exec(readFileSync(`/proc/${p}/smaps_rollup`, 'utf8'))?.[1] ?? 0);
    } catch { /* segue */ }
  }
  return Math.round(kb / 1024);
}

function leituraDoSistema() {
  let meminfo = '';
  let loadavg = '';
  try { meminfo = readFileSync('/proc/meminfo', 'utf8'); } catch { /* segue */ }
  try { loadavg = readFileSync('/proc/loadavg', 'utf8'); } catch { /* segue */ }
  return leituraLocal({ meminfo, loadavg, nucleos: availableParallelism(), simular: process.env.NOD_SIMULAR_PRESSAO });
}

/** Os binários (sobrescrevíveis por ambiente, para o computador-local e os testes). */
export function binariosDoAmbiente(env = process.env) {
  return {
    xvfb: env.NOD_PC_XVFB ?? 'Xvfb', openbox: env.NOD_PC_OPENBOX ?? 'openbox', chromium: env.NOD_PC_CHROMIUM ?? chromiumDoPlaywright(env),
    bwrap: env.NOD_PC_BWRAP === 'nao' ? null : (env.NOD_PC_BWRAP ?? 'bwrap'), xdotool: env.NOD_PC_XDOTOOL ?? 'xdotool', xclip: env.NOD_PC_XCLIP ?? 'xclip',
    scrot: env.NOD_PC_SCROT ?? 'scrot', x11vnc: env.NOD_PC_X11VNC ?? 'x11vnc', dbus: env.NOD_PC_DBUS ?? 'dbus-daemon',
    // NOD-410: o dock do desktop. Ausentes na máquina, a tela sobe sem dock (só o Chrome), como antes.
    tint2: env.NOD_PC_TINT2 ?? 'tint2', xsetroot: env.NOD_PC_XSETROOT ?? 'xsetroot', terminalGrafico: env.NOD_PC_TERMINAL_GRAFICO ?? 'xfce4-terminal', arquivos: env.NOD_PC_ARQUIVOS ?? 'pcmanfm', keyring: env.NOD_PC_KEYRING ?? 'gnome-keyring-daemon', secretTool: env.NOD_PC_SECRET_TOOL ?? 'secret-tool',
  };
}

/**
 * As pastas do Chromium do Playwright no Linux: chrome-linux64 no x64; no arm64 (a VM do Mac, ADR-127 §4),
 * chrome-linux-arm64 no Playwright atual (chromium-1243, visto no disco 1.0.0-rc.2 em 29/10) e chrome-linux nos antigos.
 * Sem a do arm64, o 1º ensaio no Mac lançava o chrome-linux64 que não existe (`bwrap: execvp ... No such file`).
 */
export const PASTAS_DO_CHROME = ['chrome-linux64', 'chrome-linux-arm64', 'chrome-linux'];

/** O Chromium fixado pelo Playwright em PLAYWRIGHT_BROWSERS_PATH (o instalador usa /opt/nod-motor/chromium). */
export function chromiumDoPlaywright(env = process.env) {
  const base = env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/nod-motor/chromium';
  try {
    const dir = readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort().at(-1);
    if (dir) {
      const achado = PASTAS_DO_CHROME.map((p) => path.join(base, dir, p, 'chrome')).find((c) => existsSync(c));
      return achado ?? path.join(base, dir, PASTAS_DO_CHROME[0], 'chrome');
    }
  } catch { /* segue */ }
  return 'chromium';
}

/** Onde o bwrap monta o resolv.conf do stub: o destino real do /etc/resolv.conf (o bwrap não monta sobre symlink). */
export function destinoDoResolv(arquivo = '/etc/resolv.conf') {
  try { return realpathSync(arquivo); } catch { return arquivo; }
}

const resultado = (id, desfecho, extra = {}) => ({ id, desfecho, ...extra });
const falhou = (id, motivo) => resultado(id, 'falhou', { motivo });

/** Espera a primeira mensagem do filho que satisfaz `cond`, ou a saída dele, ou o prazo. */
function esperarDoFilho(filho, cond, prazoMs) {
  return new Promise((resolve) => {
    const fim = (v) => {
      clearTimeout(t);
      filho.off('message', ouvir);
      filho.off('exit', saiu);
      resolve(v);
    };
    const ouvir = (m) => { if (cond(m)) fim(m); };
    const saiu = () => fim({ tipo: 'saiu' });
    const t = setTimeout(() => fim({ tipo: 'prazo' }), prazoMs);
    filho.on('message', ouvir);
    filho.on('exit', saiu);
  });
}

/**
 * O supervisor, sem socket (o socket é `servirControle`). Opções: raiz (/var/lib/nod-computador), run
 * (/run/nod-computador), terminal (socket do terminal), x11 (/tmp/.X11-unix), bin, sandbox, xvfbArgs, ambienteTela,
 * resolv (o resolv.conf que a tela vê; padrão: o do stub do systemd-resolved, se existir), leitura
 * (() => {memoria, processador}), agora, antesDeRecolher (gancho do teste: segura o fecharTela depois do `fechada`).
 */
export function criarSupervisor(op) {
  const raiz = op.raiz ?? '/var/lib/nod-computador';
  const run = op.run ?? '/run/nod-computador';
  const x11 = op.x11 ?? '/tmp/.X11-unix';
  const resolv = op.resolv !== undefined ? op.resolv : (existsSync(RESOLV_DO_STUB) ? RESOLV_DO_STUB : null);
  const resolvEm = destinoDoResolv();
  const bin = op.bin ?? binariosDoAmbiente();
  const leitura = op.leitura ?? leituraDoSistema;
  const agora = op.agora ?? Date.now;
  const terminal = op.terminal ?? path.join(run, 'term.sock');
  const computadores = new Map();
  const ouvintes = new Set();
  const displaysEmUso = new Set();
  const log = op.log ?? ((m) => process.stderr.write(`[supervisor] ${m}\n`));

  const dirs = (id) => {
    const d = path.join(raiz, id);
    return {
      raiz: d, estado: path.join(d, 'estado'), perfis: path.join(d, 'perfis'), perfilBase: path.join(d, 'perfil-base'),
      logins: path.join(d, 'logins'), loja: path.join(d, 'logins', 'principal', 'cookies.enc'), storage: pastaDoStorage(path.join(d, 'logins')), senhas: arquivoDasSenhas(path.join(d, 'logins')), keyring: path.join(d, 'keyring'),
      workspace: path.join(d, 'workspace'), run: path.join(run, id), bus: path.join(run, id, 'bus'),
    };
  };

  async function prepararPastas(d) {
    for (const p of [d.raiz, d.estado, d.perfis, d.perfilBase, d.logins, path.dirname(d.loja), d.storage, d.keyring, d.run, d.bus]) await mkdir(p, { recursive: true, mode: 0o700 });
    await mkdir(d.workspace, { recursive: true, mode: 0o2770 });
    // O umask 077 do serviço come o modo do mkdir. O terminal (outro uid, mesmo grupo nod-pc-arquivos) só atravessa a
    // pasta do computador (--x) e lê/grava o workspace; perfis, logins, estado e keyring seguem 0700 do nod-pc.
    await chmod(d.raiz, 0o2710);
    await chmod(d.workspace, 0o2770);
  }

  async function chaveDoSupervisor(d, nova = false) {
    const arquivo = path.join(d.estado, 'supervisor.key');
    if (!nova) {
      try { return createPrivateKey(await readFile(arquivo, 'utf8')); } catch { /* segue */ }
    }
    const par = novoParX25519();
    await writeFile(arquivo, par.privadaPem, { mode: 0o600 });
    return createPrivateKey(par.privadaPem);
  }

  /**
   * Criações em curso, por id. Dois comandos do mesmo computador novo chegando juntos (dois bots agindo no boot: o
   * servidor manda uma sonda por bot) entravam os dois em `obter`, cada um gerava a própria X25519 e relatava a sua; o
   * servidor fixava a primeira (TOFU) e recusava o `iniciar` com a segunda ("supervisor diferente"). Na CI em máquina
   * rápida isso derrubava o e2e do computador em metade dos runs (2026-11-04). Quem chega durante a criação espera a
   * mesma promessa e recebe o mesmo `c`.
   */
  const criando = new Map();

  async function obter(id) {
    const pronto = computadores.get(id);
    if (pronto) return pronto;
    const emCurso = criando.get(id);
    if (emCurso) return emCurso;
    const p = criar(id).finally(() => criando.delete(id));
    criando.set(id, p);
    return p;
  }

  async function criar(id) {
    let c;
    const d = dirs(id);
    // NOD-365: uma importação que caiu entre os renames termina aqui, ANTES de criar as pastas (o mkdir criaria uma
    // principal vazia e a recuperação descartaria a loja nova completa).
    await recuperar(d.logins).catch((e) => log(`recuperar a loja de ${id}: ${e?.message}`));
    await prepararPastas(d);
    const privX = await chaveDoSupervisor(d);
    const servidorPub = await readFile(path.join(d.estado, 'servidor.pub'), 'utf8').then((s) => s.trim(), () => null);
    const estadoTroca = await readFile(path.join(d.raiz, MARCA_TROCA_EM_CURSO), 'utf8').then((s) => {
      try {
        const e = JSON.parse(s);
        if (!Number.isSafeInteger(e?.epoca) || e.epoca <= 0) return null;
        const exportacao = e.exportacao && ID_VALIDO.test(e.exportacao.troca) && e.exportacao.epoca === e.epoca && Number.isFinite(e.exportacao.em)
          ? e.exportacao : null;
        return { epoca: e.epoca, exportacao };
      } catch { return null; }
    }, () => null);
    c = { id, d, privX, pubX: publicaX25519(privX), servidorPub, vistos: new Map(), ligado: false, chaveLoja: null, chaveStorage: null, chaveSenhas: null, marcasSenhas: new Map(), busEndereco: null, procs: [], telas: new Map(), operacao: null, fila: Promise.resolve(), exportacao: null, importacao: null, trocaEpoca: estadoTroca?.epoca ?? 0, trocaEmCurso: estadoTroca?.exportacao ?? null };
    computadores.set(id, c);
    return c;
  }

  function estadoDe(c) {
    return {
      computadorId: c.id, ligado: c.ligado, supervisorPub: c.pubX,
      ligadoDesde: c.ligado ? c.ligadoDesde ?? null : null, memoriaTotalMb: Math.round(totalmem() / 1048576),
      operacao: c.operacao ? { tipo: c.operacao.tipo, pct: c.operacao.pct, etapa: c.operacao.etapa } : null,
      telas: [...c.telas.entries()].map(([agenteId, t]) => ({ agenteId, estado: t.estado, ultimaAcaoEm: t.ultimaAcaoEm ?? null, titulo: t.titulo ?? null, memoriaMb: t.estado === 'aberta' ? memoriaDaArvore(t.proc?.pid) : null })),
    };
  }
  const relatar = (m) => { for (const f of ouvintes) { try { f(m); } catch { /* segue */ } } };
  const relatarEstado = (c) => relatar({ tipo: 'estado', ...estadoDe(c) });
  /** Avança o progresso da operação em curso e relata a foto (o servidor grava em computadores.operacao_*). */
  const etapa = (c, pct, nome) => {
    if (!c.operacao) return;
    c.operacao.pct = pct;
    c.operacao.etapa = nome;
    relatarEstado(c);
  };

  // --- máquina: dbus + keyring + Safe Storage ---
  function iniciarProc(binario, args, env, stdin) {
    const p = spawn(binario, args, { env: { ...process.env, ...env }, stdio: [stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'], detached: true });
    p.on('error', () => {});
    if (stdin !== undefined) p.stdin.end(stdin);
    return p;
  }
  const primeiraLinhaDe = (p, prazoMs) => new Promise((resolve) => {
    let buf = '';
    const t = setTimeout(() => resolve(null), prazoMs);
    p.stdout.on('data', (b) => { buf += b; const i = buf.indexOf('\n'); if (i >= 0) { clearTimeout(t); resolve(buf.slice(0, i).trim()); } });
    p.on('exit', () => { clearTimeout(t); resolve(buf.trim() || null); });
  });
  const terminou = (p, prazoMs) => new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), prazoMs);
    p.on('exit', (code) => { clearTimeout(t); resolve(code); });
  });

  async function ligarMaquina(c, chaveMaquina) {
    const socketBus = path.join(c.d.bus, 'socket');
    await rm(socketBus, { force: true });
    // NOD-96: barramento SEM ativação de serviço. Com o session.conf padrão, o secret-tool que chega antes do nosso
    // keyring tomar o nome ativa um 2º gnome-keyring (sem senha) pelo org.freedesktop.secrets.service; ele fica com o
    // nome, o nosso sai com "another secret service is running" e o store morre pedindo prompt: "o keyring não destravou".
    const confBus = path.join(c.d.run, 'bus.conf');
    await writeFile(confBus, CONF_DO_BUS, { mode: 0o600 });
    const dbus = iniciarProc(bin.dbus, [`--config-file=${confBus}`, '--nofork', '--nopidfile', `--address=unix:path=${socketBus}`, '--print-address=1'], {});
    c.procs.push(dbus);
    const endereco = await primeiraLinhaDe(dbus, 10_000);
    if (!endereco) throw Object.assign(new Error('o dbus não abriu'), { codigo: 'nao_iniciou' });
    c.busEndereco = endereco;
    const env = { DBUS_SESSION_BUS_ADDRESS: endereco, XDG_DATA_HOME: c.d.keyring, XDG_RUNTIME_DIR: c.d.run, HOME: c.d.keyring };
    const keyring = iniciarProc(bin.keyring, ['--foreground', '--unlock', '--components=secrets'], env, chaveMaquina);
    c.procs.push(keyring);
    // O keyring entra no barramento e destrava; o Safe Storage é gravado (idempotente) antes do primeiro Chrome.
    let gravou = false;
    for (let i = 0; i < 50 && !gravou; i++) {
      const p = iniciarProc(bin.secretTool, ['store', '--label=Chromium Safe Storage', 'application', 'chromium'], env, senhaSafeStorage(chaveMaquina));
      gravou = (await terminou(p, 5_000)) === 0;
      if (!gravou) await esperar(100);
    }
    if (!gravou) throw Object.assign(new Error('o keyring não destravou'), { codigo: 'cofre_invalido' });
    c.chaveLoja = chaveDaLoja(chaveMaquina);
    await lerLoja(c.d.loja, c.chaveLoja).catch((e) => { throw Object.assign(e, { codigo: 'cofre_invalido' }); });
    c.chaveStorage = chaveDoStorage(chaveMaquina);
    // Storage ilegível não impede a máquina de ligar (os cookies são o login): fica no log, e a tela abre sem ele.
    await lerEstado(c.d.storage, c.chaveStorage).catch((e) => log(`storage: ${e?.message}`));
    c.chaveSenhas = chaveDasSenhas(chaveMaquina);
    // Senhas ilegíveis também não impedem ligar: fica no log, e a tela abre sem as senhas salvas em comum.
    await lerSenhas(c.d.senhas, c.chaveSenhas).catch((e) => log(`senhas: ${e?.message}`));
    c.ligado = true;
    c.ligadoDesde = agora();
  }

  async function desligarMaquina(c) {
    for (const agenteId of [...c.telas.keys()]) await fecharTela(c, agenteId);
    for (const p of c.procs.splice(0)) {
      try { process.kill(-p.pid, 'SIGTERM'); } catch { /* segue */ }
    }
    c.ligado = false;
    c.chaveLoja = null;
    c.chaveStorage = null;
    c.chaveSenhas = null;
    c.marcasSenhas.clear();
    c.busEndereco = null;
  }

  // --- telas ---
  function novoDisplay() {
    for (let n = 0; n < 100; n++) {
      const numero = DISPLAY_BASE + n;
      if (displaysEmUso.has(numero)) continue;
      try { readFileSync(`/tmp/.X${numero}-lock`); continue; } catch { /* segue */ }
      displaysEmUso.add(numero);
      return numero;
    }
    return null;
  }

  function aoMensagemDaTela(c, agenteId, m) {
    if (m?.tipo === 'storage') return aoStorageDaTela(c, agenteId, m);
    if (m?.tipo !== 'cookies') return;
    c.fila = c.fila.then(async () => {
      if (!c.chaveLoja) return;
      const { efetivo } = await atualizarLoja(c.d.loja, c.chaveLoja, (loja) => fundir(loja, m.diff, m.em, agora()));
      if (!efetivo.postos.length && !efetivo.removidos.length) return;
      for (const [outro, t] of c.telas) if (outro !== agenteId && t.estado === 'aberta') mandarAoFilho(t.proc, { tipo: 'repasse', ...efetivo });
    }).catch((e) => log(`loja de cookies: ${e?.message}`));
  }

  /** NOD-97 PR 4: a versão de uma origem que uma tela mandou: grava se vence (LWW) e repassa às outras telas abertas. */
  function aoStorageDaTela(c, agenteId, m) {
    c.fila = c.fila.then(async () => {
      if (!c.chaveStorage) return;
      const item = { origem: m.origem, em: m.em, hash: m.hash, dados: m.dados };
      const r = await gravarOrigem(c.d.storage, c.chaveStorage, item);
      if (r === 'grande') log(`storage de ${agenteId}: origem acima do teto, fica só no perfil`);
      if (r !== 'gravou') return;
      for (const [outro, t] of c.telas) if (outro !== agenteId && t.estado === 'aberta') mandarAoFilho(t.proc, { tipo: 'storage', ...item });
    }).catch((e) => log(`storage: ${e?.message}`));
  }

  /**
   * NOD-97 PR 5: recolhe o `Login Data` do perfil de um bot para a loja (LWW). Serializa na fila da máquina (a mesma dos
   * cookies e do storage). Uma senha nova salva numa tela entra no perfil das OUTRAS na próxima vez que elas abrirem.
   * Só copia o arquivo quando o mtime ou o tamanho mudou desde a última leitura (marcasSenhas).
   */
  function recolherDaTela(c, agenteId) {
    c.fila = c.fila.then(async () => {
      if (!c.chaveSenhas) return;
      const perfil = path.join(c.d.perfis, agenteId);
      const r = await recolherSenhas(c.d.senhas, c.chaveSenhas, perfil, c.d.run, agora(), c.marcasSenhas);
      if (r === 'gravou') log(`senhas de ${agenteId}: recolhidas`);
    }).catch((e) => log(`senhas: ${e?.message}`));
    return c.fila;
  }

  async function abrirTela(c, agenteId, uso) {
    let t = c.telas.get(agenteId);
    // NOD-433: a tela deste agente ainda fecha (ociosidade, parar): a nova só nasce depois, senão as duas dividiam o tmp
    // e o `fechada` da antiga caía por cima da nova.
    if (t?.estado === 'fechando' && t.fechou) { await t.fechou; t = c.telas.get(agenteId); }
    if (t?.estado === 'aberta') return { ok: true };
    if (t?.estado === 'abrindo') return t.abrindo;
    for (let volta = 0; volta < 10; volta++) {
      const { memoria, processador } = leitura();
      const telas = [...c.telas.entries()].map(([id, x]) => ({ agenteId: id, estado: x.estado, ocupada: x.ocupada, ultimaAcaoEm: x.ultimaAcaoEm }));
      const d = decidirAbertura({ uso, memoria, processador, telas, agenteId, agora: agora() });
      if (d.acao === 'abrir') break;
      if (d.acao === 'fechar') { await fecharTela(c, d.agenteId); continue; }
      t = c.telas.get(agenteId) ?? { estado: 'fechada' };
      if (t.estado !== 'esperando') c.telas.set(agenteId, { ...t, estado: 'esperando', esperandoDesde: agora() });
      relatarEstado(c);
      return { esperando: d.quem };
    }
    // NOD-433: duas ações do mesmo bot que acordaram do mesmo `fechou` (ou de um `fecharTela` no laço): a primeira já
    // abriu; a segunda espera aquela em vez de abrir outra tela do mesmo agente.
    t = c.telas.get(agenteId);
    if (t?.estado === 'aberta') return { ok: true };
    if (t?.estado === 'abrindo') return t.abrindo;
    const display = novoDisplay();
    if (display === null) return { esperando: [...c.telas.keys()].filter((k) => k !== agenteId) };
    const proc = fork(op.tela ?? process.env.NOD_PC_TELA ?? path.join(AQUI, 'tela.mjs'), [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'], env: { ...process.env, ...(op.ambienteTela ?? {}) } });
    t = { estado: 'abrindo', proc, display, ocupada: false, uso, ultimaAcaoEm: agora(), pendentes: new Map() };
    c.telas.set(agenteId, t);
    relatarEstado(c);
    proc.on('message', (m) => {
      aoMensagemDaTela(c, agenteId, m);
      if (m?.tipo === 'resposta') { t.pendentes.get(m.id)?.(m); t.pendentes.delete(m.id); }
    });
    // Revisão 15: um envio a um canal que fechou emite 'error'; sem ouvinte, derrubava o supervisor. O 'exit' trata a saída.
    proc.on('error', (e) => log(`tela ${agenteId}: ${e?.message}`));
    proc.on('exit', () => {
      displaysEmUso.delete(display);
      for (const r of t.pendentes.values()) r({ erro: 'sem_resposta' });
      t.pendentes.clear();
      // NOD-433 (revisão r4): a tela que fecha sai logo depois do `fechada`, com o fecharTela ainda recolhendo o Login
      // Data. Quem marca a fechada é ele; trocar a entrada aqui deixava outra ação abrir a tela nova no meio.
      if (c.telas.get(agenteId) === t && t.estado !== 'fechada' && t.estado !== 'fechando') { c.telas.set(agenteId, { estado: 'fechada', ultimaAcaoEm: t.ultimaAcaoEm }); relatarEstado(c); }
    });
    t.abrindo = (async () => {
      // NOD-96: lê na fila da máquina, DEPOIS das fusões em curso. A tela manda o diff de cookies antes da resposta da
      // ação; lida fora da fila, a loja ainda não tinha o login que outra tela acabou de fazer, e o repasse só alcança as
      // telas já abertas: a tela que abria logo depois ficava deslogada ("login em comum entre as telas" na VM).
      const { loja, storage } = await naFila(c, async () => ({
        loja: await lerLoja(c.d.loja, c.chaveLoja),
        storage: await lerTudo(c.d.storage, c.chaveStorage).catch((e) => { log(`storage: ${e?.message}`); return { itens: [] }; }),
      }));
      // NOD-97 PR 5: as senhas salvas em comum viajam no config (o valor já vem cifrado pelo Safe Storage); a tela as
      // importa no perfil ANTES de abrir o Chrome. Senhas ilegíveis não seguram a tela (abre sem elas).
      const senhas = await lerSenhas(c.d.senhas, c.chaveSenhas).catch((e) => { log(`senhas: ${e?.message}`); return null; });
      proc.send({
        tipo: 'abrir',
        config: {
          agenteId, display, raiz, run, ocultar: [path.dirname(terminal)], resolv, resolvEm, perfil: path.join(c.d.perfis, agenteId), perfilBase: c.d.perfilBase, workspace: path.join(c.d.workspace, agenteId),
          logins: c.d.logins, tmp: path.join(c.d.run, 'telas', agenteId), scripts: path.join(c.d.raiz, 'bwrap', agenteId), x11, bus: c.d.bus, busEndereco: c.busEndereco, bin, sandbox: op.sandbox !== false,
          xvfbArgs: op.xvfbArgs, cookies: cookiesVivos(loja, agora()), storage: storage.itens, geracao: storage.geracao, senhas,
        },
      });
      const m = await esperarDoFilho(proc, (x) => x?.tipo === 'pronta' || x?.tipo === 'falhou', PRAZO_ABRIR_TELA_MS);
      if (m.tipo !== 'pronta') {
        log(`tela ${agenteId} não abriu: ${m.codigo ?? m.tipo} ${m.detalhe ?? ''}`);
        try { proc.kill('SIGKILL'); } catch { /* segue */ }
        c.telas.set(agenteId, { estado: 'fechada', ultimaAcaoEm: t.ultimaAcaoEm });
        relatarEstado(c);
        return { motivo: m.codigo === 'navegador_nao_abriu' ? 'navegador_nao_abriu' : 'nao_iniciou' };
      }
      t.estado = 'aberta';
      t.ultimaAcaoEm = agora();
      relatarEstado(c);
      return { ok: true };
    })();
    return t.abrindo;
  }

  async function fecharTela(c, agenteId) {
    const t = c.telas.get(agenteId);
    if (t?.estado === 'fechando' && t.fechou) return t.fechou;
    if (!t?.proc || t.estado === 'fechada') { c.telas.delete(agenteId); return; }
    t.estado = 'fechando';
    relatarEstado(c);
    t.fechou = (async () => {
      if (t.proc.exitCode === null) {
        mandarAoFilho(t.proc, { tipo: 'fechar' });
        const m = await esperarDoFilho(t.proc, (x) => x?.tipo === 'fechada', PRAZO_FECHAR_TELA_MS);
        if (m.tipo === 'prazo') { try { t.proc.kill('SIGKILL'); } catch { /* segue */ } }
      }
      await op.antesDeRecolher?.(agenteId);
      await c.fila;
      // NOD-97 PR 5: o Chrome fechou e soltou o Login Data; recolhe a senha que a tela possa ter salvado nesta sessão.
      if (c.ligado) await recolherDaTela(c, agenteId);
      // Só marca fechada se a entrada ainda é desta tela (uma nova não sobrescreve).
      if (c.telas.get(agenteId) === t) c.telas.set(agenteId, { estado: 'fechada', ultimaAcaoEm: t.ultimaAcaoEm });
      relatarEstado(c);
    })().catch((e) => {
      // O canal com a tela já fechou (ela morreu no meio): o `exit` marca a entrada; quem espera o `fechou` segue.
      log(`tela ${agenteId} fechou com erro: ${e?.message}`);
      try { t.proc.kill('SIGKILL'); } catch { /* segue */ }
      if (c.telas.get(agenteId) === t) { c.telas.set(agenteId, { estado: 'fechada', ultimaAcaoEm: t.ultimaAcaoEm }); relatarEstado(c); }
    });
    return t.fechou;
  }

  function pedirATela(t, mensagem, prazoMs = PRAZO_ACAO_MS) {
    const id = randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => { t.pendentes.delete(id); try { t.proc.kill('SIGKILL'); } catch { /* segue */ } resolve({ erro: 'sem_resposta' }); }, prazoMs);
      const responder = (m) => { clearTimeout(timer); t.pendentes.delete(id); resolve(m); };
      t.pendentes.set(id, responder);
      if (!mandarAoFilho(t.proc, { ...mensagem, id }, () => responder({ erro: 'sem_resposta' }))) responder({ erro: 'sem_resposta' });
    });
  }

  function pedirAoTerminal(computadorId, comando) {
    return new Promise((resolve) => {
      const s = net.connect(terminal);
      let corpo = '';
      s.setTimeout(40_000, () => s.destroy());
      s.on('data', (b) => { corpo += b; });
      s.on('error', () => resolve({ erro: 'sem_resposta' }));
      s.on('close', () => { try { resolve(JSON.parse(corpo)); } catch { resolve({ erro: 'sem_resposta' }); } });
      s.end(JSON.stringify({ computadorId, comando }));
    });
  }

  async function acao(c, cmd) {
    const aberta = await abrirTela(c, cmd.agenteId, cmd.uso);
    if (aberta.esperando) return resultado(cmd.id, 'esperando_tela', { quem: aberta.esperando });
    if (!aberta.ok) return falhou(cmd.id, aberta.motivo);
    const t = c.telas.get(cmd.agenteId);
    if (t.ocupada) return falhou(cmd.id, 'ocupado');
    t.ocupada = true;
    try {
      let extra = {};
      let pedido = cmd.acao;
      if (cmd.acao.tipo === 'terminal') {
        const r = await pedirAoTerminal(c.id, cmd.acao.comando);
        if (r.erro) {
          log(`terminal de ${cmd.agenteId}: ${r.erro}`);
          return falhou(cmd.id, r.erro === 'nao_iniciou' ? 'nao_iniciou' : 'acao_falhou');
        }
        extra = r.resultado;
        pedido = { tipo: 'observar' };
      }
      // Revisão 10 do PR #600: a tela sabe se a ação é da pessoa (a trava do dock é só contra o bot).
      const m = await pedirATela(t, { tipo: 'acao', acao: pedido, ...(cmd.pessoa === true ? { pessoa: true } : {}) });
      if (m.erro) {
        log(`ação ${cmd.acao.tipo} de ${cmd.agenteId}: ${m.erro} ${m.detalhe ?? ''}`);
        return falhou(cmd.id, ['tela_alterada', 'sem_resposta', 'ocupado'].includes(m.erro) ? m.erro : 'acao_falhou');
      }
      if (typeof m.resultado?.titulo === 'string') t.titulo = m.resultado.titulo.slice(0, 200);
      return resultado(cmd.id, 'ok', { resultado: { ...extra, ...m.resultado } });
    } finally {
      t.ocupada = false;
      t.ultimaAcaoEm = agora();
      // Uma ação pode ter salvado uma senha no Chrome; recolhe sem segurar a resposta.
      recolherDaTela(c, cmd.agenteId);
    }
  }

  /** NOD-97 PR 6: espera as telas em 'abrindo' terminarem de abrir (ou desistirem), para a operação as alcançar. */
  async function esperarAsQueAbrem(c) {
    await Promise.all([...c.telas.values()].filter((t) => t.estado === 'abrindo' && t.abrindo).map((t) => t.abrindo.catch(() => {})));
  }

  /** Roda `fn` na fila da máquina e devolve o resultado (ou a falha); a fila segue viva mesmo se `fn` falhar. */
  function naFila(c, fn) {
    const p = c.fila.then(fn);
    c.fila = p.catch(() => {});
    return p;
  }

  async function fecharTodas(c, de, ate) {
    const abertas = [...c.telas.keys()];
    for (const [i, agenteId] of abertas.entries()) {
      await fecharTela(c, agenteId);
      etapa(c, Math.round(de + ((ate - de) * (i + 1)) / abertas.length), 'Preparando');
    }
  }

  /** Redefinir: apaga tudo menos os logins (e o estado, onde fica a chave do servidor), recria o perfil-base e gera a X25519 nova. */
  async function redefinir(c) {
    etapa(c, 10, 'Preparando');
    await fecharTodas(c, 10, 30);
    etapa(c, 35, 'Preparando');
    await desligarMaquina(c);
    etapa(c, 50, 'Apagando seus dados');
    for (const nome of await readdir(c.d.raiz)) if (nome !== 'logins' && nome !== 'estado') await rm(path.join(c.d.raiz, nome), { recursive: true, force: true });
    await rm(path.join(c.d.estado, 'supervisor.key'), { force: true });
    etapa(c, 75, 'Criando');
    await prepararPastas(c.d);
    c.telas.clear();
    etapa(c, 90, 'Iniciando');
    c.privX = await chaveDoSupervisor(c.d, true);
    c.pubX = publicaX25519(c.privX);
  }

  /** O bot foi excluído: fecha a tela dele e apaga o perfil do Chrome (os logins em comum ficam). */
  async function apagarPerfil(c, agenteId) {
    await fecharTela(c, agenteId);
    c.telas.delete(agenteId);
    await rm(path.join(c.d.perfis, agenteId), { recursive: true, force: true });
    await rm(path.join(c.d.run, 'telas', agenteId), { recursive: true, force: true });
    for (const v of vizinhosDoTmp(path.join(c.d.run, 'telas', agenteId))) await rm(v, { recursive: true, force: true });
    await rm(path.join(c.d.raiz, 'bwrap', agenteId), { recursive: true, force: true });
    relatarEstado(c);
  }

  /**
   * NOD-96 PR 7 (definido em 2026-10-22): o servidor sela `{ chaveMaquina, confia }` (src/adapters/computador/selo.ts);
   * o texto cru (só a chave em hex) segue aceito. `confia` tem de ser a Ed25519 já fixada (a do `servidorPub`).
   */
  function chaveDoSelo(c, texto) {
    if (!texto.startsWith('{')) return texto;
    const s = JSON.parse(texto);
    if (typeof s?.chaveMaquina !== 'string') throw new Error('selo_invalido');
    if (s.confia !== undefined && s.confia !== c.servidorPub) throw new Error('selo_de_outro_servidor');
    return s.chaveMaquina;
  }

  async function executar(c, cmd) {
    switch (cmd.tipo) {
      case 'iniciar': {
        let chave;
        try { chave = chaveDoSelo(c, abrirSelo(c.privX, cmd.segredoSelado)); } catch { return falhou(cmd.id, 'cofre_invalido'); }
        if (!/^[a-f0-9]{64}$/.test(chave)) return falhou(cmd.id, 'cofre_invalido');
        if (c.ligado) return resultado(cmd.id, 'ok');
        try {
          await ligarMaquina(c, chave);
        } catch (e) {
          log(`iniciar ${c.id}: ${e?.message}`);
          await desligarMaquina(c);
          return falhou(cmd.id, e?.codigo === 'cofre_invalido' ? 'cofre_invalido' : 'nao_iniciou');
        }
        // NOD-365: o computador voltou a morar aqui; a pasta não é mais apagada pela varredura.
        await desmarcarSaida(c.d.raiz).catch(() => {});
        relatarEstado(c);
        return resultado(cmd.id, 'ok');
      }
      case 'abrir_tela': {
        if (!c.ligado) return falhou(cmd.id, 'nao_iniciou');
        const r = await abrirTela(c, cmd.agenteId, cmd.uso);
        if (r.esperando) return resultado(cmd.id, 'esperando_tela', { quem: r.esperando });
        return r.ok ? resultado(cmd.id, 'ok') : falhou(cmd.id, r.motivo);
      }
      case 'acao':
        if (!c.ligado) return falhou(cmd.id, 'nao_iniciou');
        if (!cmd.acao || typeof cmd.acao.tipo !== 'string') return falhou(cmd.id, 'acao_falhou');
        return acao(c, cmd);
      case 'vivo': {
        // NOD-95 (ADR-138): a tela ao vivo da pessoa. Pede à tela o socket do VNC dela; quem liga o fluxo é o
        // servirControle, na própria conexão que trouxe o comando. `vnc` é o caminho do socket e fica só entre os dois:
        // nunca sobe ao servidor. 5ª revisão: o vivo não abre tela (a web a abre pela captura antes). Ele vem por uma
        // conexão própria e pode chegar depois do `fechar_tela` do Parar: reabrir deixaria a tela da pessoa segurando a
        // máquina acordada. Só a tela aberta, ou abrindo, serve.
        if (!c.ligado) return falhou(cmd.id, 'nao_iniciou');
        const estado = c.telas.get(cmd.agenteId)?.estado;
        if (estado !== 'aberta' && estado !== 'abrindo') return falhou(cmd.id, 'tela_alterada');
        const aberta = await abrirTela(c, cmd.agenteId, cmd.uso);
        if (aberta.esperando) return resultado(cmd.id, 'esperando_tela', { quem: aberta.esperando });
        if (!aberta.ok) return falhou(cmd.id, aberta.motivo);
        const t = c.telas.get(cmd.agenteId);
        if (t?.estado !== 'aberta') return falhou(cmd.id, 'tela_alterada');
        const m = await pedirATela(t, { tipo: 'vivo' }, PRAZO_VIVO_MS);
        if (m.erro) {
          log(`vivo de ${cmd.agenteId}: ${m.erro} ${m.detalhe ?? ''}`);
          return falhou(cmd.id, m.erro === 'faltam_pacotes' ? 'faltam_pacotes' : 'acao_falhou');
        }
        t.ultimaAcaoEm = agora();
        return resultado(cmd.id, 'ok', { vnc: m.resultado.socket });
      }
      case 'fechar_tela':
        await fecharTela(c, cmd.agenteId);
        return resultado(cmd.id, 'ok');
      case 'parar':
        await desligarMaquina(c);
        relatarEstado(c);
        return resultado(cmd.id, 'ok');
      case 'apagar_perfil':
        await apagarPerfil(c, cmd.agenteId);
        return resultado(cmd.id, 'ok');
      case 'sair_de_todos': {
        if (!c.ligado) return falhou(cmd.id, 'nao_iniciou');
        etapa(c, 20, 'Saindo das contas');
        let falha = null;
        // Na fila da máquina pelo naFila: a loja que não grava marca a falha sem deixar a fila rejeitada para as outras.
        await naFila(c, () => atualizarLoja(c.d.loja, c.chaveLoja, (loja) => zerar(loja, agora(), agora()))).catch((e) => { falha = e; log(`loja de cookies: ${e?.message}`); });
        // NOD-97 PR 6: o storage em comum também sai. A geração nova zera o índice; as telas abertas apagam o do perfil
        // (CDP, cada origem conhecida) e as fechadas o apagam do disco ao subir com essa geração.
        let geracao;
        if (c.chaveStorage) geracao = await naFila(c, () => limparStorage(c.d.storage, c.chaveStorage)).catch((e) => { falha ??= e; log(`storage: ${e?.message}`); });
        await esperarAsQueAbrem(c); // as que estão abrindo levaram os cookies e o storage antigos no config
        const abertas = [...c.telas.entries()].filter(([, t]) => t.estado === 'aberta');
        etapa(c, 50, 'Limpando');
        for (const [agenteId, t] of abertas) {
          // Tela que não limpou (erro ou sem resposta) ainda tem a sessão: a operação falha, mas as outras seguem.
          for (const pedido of [{ tipo: 'limpar_cookies' }, { tipo: 'limpar_storage', geracao }]) {
            const r = await pedirATela(t, pedido, pedido.tipo === 'limpar_storage' ? PRAZO_LIMPAR_STORAGE_MS : 15_000);
            if (r?.erro) {
              falha ??= new Error(r.erro);
              log(`${pedido.tipo} em ${agenteId}: ${r.erro}${r.detalhe ? ` (${r.detalhe})` : ''}`);
            }
          }
        }
        // O storage guardado ou o de uma tela aberta não saiu: a pessoa não pode ver "saiu de todos" com a sessão viva.
        if (falha) return falhou(cmd.id, 'acao_falhou');
        return resultado(cmd.id, 'ok', { progresso: { pct: 100, etapa: 'pronto' } });
      }
      case 'esquecer_senhas': {
        if (!c.ligado) return falhou(cmd.id, 'nao_iniciou');
        etapa(c, 15, 'Esquecendo senhas');
        // Os Chromes abertos seguram o Login Data e o reescrevem ao sair; fecha todos antes de apagar e reabre depois.
        // A tela que está abrindo já levou as senhas no config: espera ela ficar aberta e entra na mesma conta.
        await esperarAsQueAbrem(c);
        const abertas = [...c.telas.entries()].filter(([, t]) => t.estado === 'aberta').map(([agenteId, t]) => ({ agenteId, uso: t.uso }));
        for (const { agenteId } of abertas) await fecharTela(c, agenteId);
        etapa(c, 50, 'Apagando senhas salvas');
        const perfis = [c.d.perfilBase, ...(await readdir(c.d.perfis).catch(() => [])).map((n) => path.join(c.d.perfis, n))];
        let falha = null;
        await naFila(c, () => esquecerSenhas(c.d.senhas, perfis)).catch((e) => { falha = e; log(`esquecer_senhas: ${e?.message}`); });
        etapa(c, 75, 'Reabrindo');
        let relancados = 0;
        for (const { agenteId, uso } of abertas) { const r = await abrirTela(c, agenteId, uso); if (r?.ok) relancados++; }
        // As telas voltam de qualquer jeito; mas, se alguma senha ficou no disco, a operação falha (não diz "esqueceu").
        if (falha) return falhou(cmd.id, 'acao_falhou');
        return resultado(cmd.id, 'ok', { progresso: { pct: 100, etapa: 'pronto' }, relancados });
      }
      case 'atualizar':
        // Os binários novos vêm do instalador do motor; aqui fecha tudo (perfis, logins e workspace ficam) para o
        // serviço reiniciar com eles.
        etapa(c, 10, 'Preparando');
        await fecharTodas(c, 10, 60);
        etapa(c, 70, 'Reiniciando');
        await desligarMaquina(c);
        // Reinicia o serviço depois de responder, para o systemd (ativado por socket) carregar os arquivos novos do disco.
        if (op.aoAtualizar) setTimeout(op.aoAtualizar, 200).unref?.();
        return resultado(cmd.id, 'ok', { progresso: { pct: 100, etapa: 'pronto' } });
      case 'redefinir':
        await redefinir(c);
        // A X25519 nova vai na resposta deste comando, que veio assinado com a chave do servidor: é assim que o
        // servidor troca a supervisor_pub fixada (TOFU) sem aceitar uma chave diferente vinda de uma foto qualquer.
        return resultado(cmd.id, 'ok', { progresso: { pct: 100, etapa: 'pronto' }, supervisorPub: c.pubX });
      case 'exportar_logins':
        return exportarLogins(c, cmd);
      case 'importar_logins':
        return importarLogins(c, cmd);
      case 'cancelar_exportacao':
        if (!trocaValida(cmd.troca) || !epocaValida(cmd.epocaTroca) || c.trocaEmCurso?.troca !== cmd.troca || c.trocaEmCurso.epoca !== cmd.epocaTroca) return falhou(cmd.id, 'acao_falhou');
        await limparTrocaEmCurso(c);
        c.exportacao = null;
        return resultado(cmd.id, 'ok');
      case 'marcar_saida':
        if (!epocaValida(cmd.epocaTroca) || cmd.epocaTroca < c.trocaEpoca) return falhou(cmd.id, 'acao_falhou');
        if (cmd.epocaTroca > c.trocaEpoca) { c.trocaEpoca = cmd.epocaTroca; await salvarEstadoTroca(c); }
        await desligarMaquina(c);
        await marcarSaida(c.d.raiz, agora());
        await limparTrocaEmCurso(c);
        c.exportacao = null;
        relatarEstado(c);
        return resultado(cmd.id, 'ok');
      default:
        return falhou(cmd.id, 'acao_falhou');
    }
  }

  const trocaValida = (t) => typeof t === 'string' && ID_VALIDO.test(t);
  const epocaValida = (e) => Number.isSafeInteger(e) && e > 0;
  async function salvarEstadoTroca(c) {
    const arquivo = path.join(c.d.raiz, MARCA_TROCA_EM_CURSO);
    const tmp = `${arquivo}.novo`;
    await writeFile(tmp, JSON.stringify({ epoca: c.trocaEpoca, exportacao: c.trocaEmCurso }), { mode: 0o600 });
    await rename(tmp, arquivo);
  }
  async function marcarTrocaEmCurso(c, troca, epoca) {
    c.trocaEpoca = epoca;
    c.trocaEmCurso = { troca, epoca, em: agora() };
    await salvarEstadoTroca(c);
  }
  async function renovarTrocaEmCurso(c) {
    if (!c.trocaEmCurso) return;
    c.trocaEmCurso.em = agora();
    await salvarEstadoTroca(c);
  }
  async function limparTrocaEmCurso(c) {
    c.trocaEmCurso = null;
    await salvarEstadoTroca(c);
  }

  /**
   * NOD-365 (definido em 2026-10-28): a origem da troca. Na parte 0 fecha as telas, desliga (a loja para de mudar) e
   * empacota; as partes seguintes saem do mesmo pacote, pelo id da troca. Os arquivos vão cifrados como estão.
   */
  async function exportarLogins(c, cmd) {
    const parte = cmd.parte ?? 0;
    if (!trocaValida(cmd.troca) || !epocaValida(cmd.epocaTroca) || !Number.isInteger(parte) || parte < 0) return falhou(cmd.id, 'acao_falhou');
    const vencida = c.exportacao && agora() - c.exportacao.em > VALIDADE_IMPORTACAO_MS;
    if (parte === 0 || vencida || c.exportacao?.troca !== cmd.troca) {
      if (parte !== 0) return falhou(cmd.id, 'acao_falhou');
      if (cmd.epocaTroca <= c.trocaEpoca) return falhou(cmd.id, 'acao_falhou');
      await desligarMaquina(c);
      relatarEstado(c);
      try {
        const partes = partir(await naFila(c, () => empacotar(c.d.logins)));
        await marcarTrocaEmCurso(c, cmd.troca, cmd.epocaTroca);
        c.exportacao = { troca: cmd.troca, epoca: cmd.epocaTroca, partes, em: agora() };
      } catch (e) {
        log(`exportar_logins ${c.id}: ${e?.message}`);
        c.exportacao = null;
        // A loja acima do teto também é `acao_falhou` (o motivo é um enum do banco); o log diz qual.
        return falhou(cmd.id, 'acao_falhou');
      }
    }
    if (c.exportacao.epoca !== cmd.epocaTroca) return falhou(cmd.id, 'acao_falhou');
    await renovarTrocaEmCurso(c);
    const { partes } = c.exportacao;
    if (parte >= partes.length) return falhou(cmd.id, 'acao_falhou');
    const r = resultado(cmd.id, 'ok', { logins: { parte, total: partes.length, dados: partes[parte] } });
    return r;
  }

  /**
   * NOD-365: o destino da troca. As partes chegam em ordem, pelo id da troca; uma troca nova descarta a anterior e a
   * que passa de 10 min vence. Na última, desliga (se estiver ligado), confere o pacote e troca a loja inteira de uma vez.
   */
  async function importarLogins(c, cmd) {
    const { troca, parte, total, dados } = cmd;
    if (!trocaValida(troca) || !epocaValida(cmd.epocaTroca) || !Number.isInteger(parte) || !Number.isInteger(total) || total < 1 || parte < 0 || parte >= total || typeof dados !== 'string') return falhou(cmd.id, 'acao_falhou');
    // O pacote nunca passa do teto da loja (mais o JSON e o base64 dos arquivos): a memória do supervisor não cresce sem limite.
    if (total > Math.ceil((TETO_LOJA_BYTES * 1.4 + 1024) / PARTE_BYTES)) return falhou(cmd.id, 'acao_falhou');
    if (c.importacao && (c.importacao.troca !== troca || agora() - c.importacao.em > VALIDADE_IMPORTACAO_MS)) c.importacao = null;
    if (parte === 0) {
      if (cmd.epocaTroca <= c.trocaEpoca) return falhou(cmd.id, 'acao_falhou');
      c.trocaEpoca = cmd.epocaTroca;
      await salvarEstadoTroca(c);
      c.importacao = { troca, epoca: cmd.epocaTroca, total, partes: [], em: agora() };
    }
    const imp = c.importacao;
    if (!imp || imp.epoca !== cmd.epocaTroca || imp.total !== total || imp.partes.length !== parte) {
      c.importacao = null;
      return falhou(cmd.id, 'acao_falhou');
    }
    imp.partes.push(Buffer.from(dados, 'base64'));
    if (parte < total - 1) return resultado(cmd.id, 'ok');
    c.importacao = null;
    try {
      const arquivos = desempacotar(Buffer.concat(imp.partes));
      await desligarMaquina(c);
      await naFila(c, () => gravarLojaImportada(c.d.logins, arquivos));
      await desmarcarSaida(c.d.raiz);
      await limparTrocaEmCurso(c);
      // A máquina virou destino: qualquer snapshot antigo que ela ainda servia deixa de representar a loja atual.
      c.exportacao = null;
    } catch (e) {
      log(`importar_logins ${c.id}: ${e?.message}`);
      return falhou(cmd.id, 'acao_falhou');
    }
    relatarEstado(c);
    return resultado(cmd.id, 'ok');
  }

  /**
   * NOD-365 (definido em 2026-10-28): apaga as pastas dos computadores que saíram desta máquina há 30 dias ou mais (a
   * marca `.saiu-em`). O ligado não sai: voltou a morar aqui sem passar pelo `iniciar` ainda.
   */
  async function varrer() {
    let nomes = [];
    try { nomes = await readdir(raiz); } catch { return []; }
    const apagados = [];
    for (const n of nomes) {
      if (!ID_VALIDO.test(n)) continue;
      const c = computadores.get(n);
      if (c?.ligado) continue;
      if (!venceu(await saiuEm(path.join(raiz, n)), agora())) continue;
      await rm(path.join(raiz, n), { recursive: true, force: true });
      await rm(path.join(run, n), { recursive: true, force: true });
      computadores.delete(n);
      apagados.push(n);
      log(`varredura: ${n} saiu há 30 dias; apagado`);
    }
    return apagados;
  }

  const OPERACOES = new Set(['atualizar', 'redefinir', 'sair_de_todos', 'esquecer_senhas']);
  const TIPOS_DO_LUGAR = new Set(['iniciar', 'abrir_tela', 'exportar_logins', 'importar_logins', 'cancelar_exportacao', 'marcar_saida']);
  // A primeira etapa de cada operação, com o nome que a web lista (web/lib/computador-pessoa.ts, ETAPAS).
  const PRIMEIRA_ETAPA = { sair_de_todos: 'Saindo das contas', esquecer_senhas: 'Esquecendo senhas' };

  /** Trata um ComandoComputador e devolve o ResultadoComandoComputador. Nunca lança. */
  async function tratar(cmd) {
    const id = typeof cmd?.id === 'string' ? cmd.id : '';
    try {
      if (!cmd || typeof cmd !== 'object' || !ID_VALIDO.test(String(cmd.computadorId ?? '')) || !TIPOS.includes(cmd.tipo)) { log(`comando ${id} recusado: forma (${cmd?.tipo ?? 'sem tipo'})`); return falhou(id, 'acao_falhou'); }
      if (cmd.agenteId !== undefined && !ID_VALIDO.test(String(cmd.agenteId))) { log(`comando ${id} recusado: agenteId`); return falhou(id, 'acao_falhou'); }
      if (TIPOS_DA_TELA.includes(cmd.tipo) && !cmd.agenteId) { log(`comando ${id} recusado: ${cmd.tipo} sem agenteId`); return falhou(id, 'acao_falhou'); }
      const novo = !computadores.has(cmd.computadorId);
      const c = await obter(cmd.computadorId);
      // NOD-96 PR 7 (definido em 2026-10-22): o computador que nasce aqui (instalação limpa, a sonda do driver) é
      // relatado na hora — o servidor só manda o `iniciar` depois de ver a X25519 dele.
      if (novo) relatarEstado(c);
      // A chave do servidor fica fixada no primeiro `iniciar` (TOFU, como a do supervisor do lado de lá).
      const fixar = !c.servidorPub && TIPOS_QUE_FIXAM.includes(cmd.tipo) && typeof cmd.servidorPub === 'string';
      const publica = c.servidorPub ?? (fixar ? cmd.servidorPub : null);
      const recusa = publica ? conferirComando(cmd, publica, c.vistos, agora()) : 'sem_chave_do_servidor';
      if (recusa) {
        log(`comando ${id} recusado: ${recusa}`);
        return falhou(id, 'acao_falhou');
      }
      if (fixar) {
        await writeFile(path.join(c.d.estado, 'servidor.pub'), publica, { mode: 0o600 });
        c.servidorPub = publica;
      }
      if (c.operacao && cmd.tipo !== 'parar') return falhou(id, 'atualizando');
      if (OPERACOES.has(cmd.tipo)) {
        c.operacao = { tipo: cmd.tipo, pct: 0, etapa: PRIMEIRA_ETAPA[cmd.tipo] ?? 'Preparando' };
        relatarEstado(c);
      }
      try {
        // NOD-365: o iniciar, a exportação, a importação e a marca de saída mexem no mesmo lugar (ligado, loja, .saiu-em):
        // um de cada vez, para o desligar da exportação não correr com um iniciar em voo.
        if (TIPOS_DO_LUGAR.has(cmd.tipo)) {
          const vez = (c.serieDoLugar ?? Promise.resolve()).then(async () => {
            // Esta guarda precisa estar DENTRO da série: exportar e iniciar podem chegar no mesmo tick, quando
            // `c.exportacao` ainda é null. Depois de a exportação rodar, o iniciar enfileirado deve ser recusado.
            // Se o servidor caiu e perdeu o id da troca, a origem volta sozinha depois de 10 min sem nenhuma parte.
            if (c.trocaEmCurso && agora() - c.trocaEmCurso.em > VALIDADE_IMPORTACAO_MS) {
              await limparTrocaEmCurso(c);
              c.exportacao = null;
            }
            if ((cmd.tipo === 'iniciar' || cmd.tipo === 'abrir_tela') && c.trocaEmCurso) return falhou(id, 'atualizando');
            return executar(c, cmd);
          });
          c.serieDoLugar = vez.catch(() => {});
          return await vez;
        }
        return await executar(c, cmd);
      } finally {
        if (OPERACOES.has(cmd.tipo)) {
          c.operacao = null;
          relatarEstado(c);
        }
      }
    } catch (e) {
      log(`comando ${id}: ${e?.message}`);
      return falhou(id, 'acao_falhou');
    }
  }

  /** Os computadores que já existem no disco (para o relato ao conectar). */
  async function carregar() {
    let nomes = [];
    await varrer().catch((e) => log(`varredura: ${e?.message}`));
    try { nomes = await readdir(raiz); } catch { /* segue */ }
    for (const n of nomes) if (ID_VALIDO.test(n)) await obter(n).catch(() => {});
  }

  const batimento = setInterval(() => { for (const c of computadores.values()) relatarEstado(c); }, op.batimentoMs ?? BATIMENTO_MS);
  batimento.unref();
  const varredura = setInterval(() => { void varrer().catch((e) => log(`varredura: ${e?.message}`)); }, op.varreduraMs ?? VARREDURA_MS);
  varredura.unref();

  return {
    tratar,
    carregar,
    varrer,
    estados: () => [...computadores.values()].map(estadoDe),
    ouvir(f) { ouvintes.add(f); return () => ouvintes.delete(f); },
    /** NOD-95: a pessoa está ao vivo nesta tela: conta como ação (a régua e o servidor não a fecham por ociosidade). */
    tocarTela(computadorId, agenteId) {
      const c = computadores.get(computadorId);
      const t = c?.telas.get(agenteId);
      if (!t || t.estado !== 'aberta') return;
      t.ultimaAcaoEm = agora();
      relatarEstado(c);
    },
    /** Espera as fusões de cookies em curso (testes). */
    async assentar() { for (const c of computadores.values()) await c.fila; },
    async encerrar() {
      clearInterval(batimento);
      clearInterval(varredura);
      for (const c of computadores.values()) await desligarMaquina(c).catch(() => {});
    },
  };
}

/**
 * O socket de controle: uma linha JSON por mensagem. Devolve o net.Server.
 *
 * NOD-95 (ADR-138): a mensagem `vivo` muda o que a conexão é. Até ela, linhas JSON (e os estados que o supervisor
 * manda a todos). Aceita, a conexão vira o fluxo cru do VNC da tela (RFB), nos dois sentidos, e os estados param de
 * chegar nela; o motor abre uma conexão só para isso. Recusada, a conexão fecha depois do `ok: false`.
 */
export function servirControle(supervisor) {
  return net.createServer((socket) => {
    socket.on('error', () => {});
    const escrever = (m) => { if (!socket.destroyed) socket.write(`${JSON.stringify(m)}\n`); };
    let parar = supervisor.ouvir(escrever);
    socket.on('close', () => parar());
    for (const e of supervisor.estados()) escrever({ tipo: 'estado', ...e });
    const decoder = new StringDecoder('utf8');
    let buf = '';
    /** O socket do x11vnc, depois do `vivo` aceito: daqui em diante os bytes passam direto. */
    let vnc = null;
    async function abrirVivo(cmd) {
      const r = await supervisor.tratar(cmd?.tipo === 'vivo' ? cmd : null);
      // Revisão do PR #599: o motor desistiu enquanto a tela subia; não abre o VNC (nem o toque que a mantém ativa).
      if (socket.destroyed) return;
      if (r.desfecho !== 'ok' || typeof r.vnc !== 'string') {
        process.stderr.write(`[supervisor] vivo ${cmd?.id ?? '?'} recusado: ${r.desfecho} ${r.motivo ?? ''} ${r.desfecho === 'ok' ? 'sem vnc' : ''}\n`);
        escrever({ tipo: 'vivo', ok: false, motivo: r.motivo ?? 'acao_falhou' });
        socket.end();
        return;
      }
      const v = net.connect(r.vnc);
      v.on('error', () => {});
      // Fechou antes de o VNC atender: o socket do VNC não fica pendurado.
      socket.on('close', () => v.destroy());
      v.once('connect', () => {
        if (socket.destroyed) { v.destroy(); return; }
        parar();
        parar = () => {};
        vnc = v;
        escrever({ tipo: 'vivo', ok: true });
        // Contrapressão nos dois sentidos (revisão do PR #599): quem escreve pausa quem lê até o outro drenar.
        v.on('data', (b) => { if (!socket.destroyed && !socket.write(b)) { v.pause(); socket.once('drain', () => v.resume()); } });
        v.on('close', () => socket.destroy());
        const toque = setInterval(() => supervisor.tocarTela?.(cmd.computadorId, cmd.agenteId), TOQUE_VIVO_MS);
        socket.on('close', () => clearInterval(toque));
      });
      v.once('close', () => { if (vnc !== v) { escrever({ tipo: 'vivo', ok: false, motivo: 'acao_falhou' }); socket.end(); } });
    }
    socket.on('data', (b) => {
      if (vnc) { if (!vnc.write(b)) { socket.pause(); vnc.once('drain', () => socket.resume()); } return; }
      buf += decoder.write(b);
      if (buf.length > 4_000_000) { socket.destroy(); return; }
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const linha = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!linha) continue;
        let m;
        try { m = JSON.parse(linha); } catch { escrever({ tipo: 'resultado', id: '', desfecho: 'falhou', motivo: 'acao_falhou' }); continue; }
        // MensagemAoSupervisor (NOD-96 PR 3) é o envelope do motor; o comando cru segue aceito.
        if (m?.tipo === 'pedir_estado') { for (const e of supervisor.estados()) escrever({ tipo: 'estado', ...e }); continue; }
        if (m?.tipo === 'vivo') { void abrirVivo(m.comando); return; }
        const cmd = m?.tipo === 'comando' && m.comando && typeof m.comando === 'object' ? m.comando : m;
        // O `vivo` só vale como mensagem própria (acima): pelo envelope comum ele não tem como ligar o fluxo.
        if (cmd?.tipo === 'vivo') { escrever({ tipo: 'resultado', id: typeof cmd.id === 'string' ? cmd.id : '', desfecho: 'falhou', motivo: 'acao_falhou' }); continue; }
        void supervisor.tratar(cmd).then((r) => { const { vnc: _v, ...semVnc } = r; escrever({ tipo: 'resultado', ...semVnc }); });
      }
    });
  });
}

/** Escuta no fd do systemd (LISTEN_FDS) ou no caminho dado. */
export async function escutarControle(servidor, caminho) {
  if (process.env.LISTEN_FDS === '1' && process.env.LISTEN_PID === String(process.pid)) {
    servidor.listen({ fd: 3 });
    return;
  }
  await mkdir(path.dirname(caminho), { recursive: true });
  await rm(caminho, { force: true });
  await new Promise((r) => servidor.listen(caminho, r));
  await chmod(caminho, 0o660).catch(() => {});
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.umask(0o077);
  // Depois do Atualizar o processo sai e o systemd (Restart=always) o sobe de novo com os arquivos do disco.
  const aoAtualizar = () => void supervisor.encerrar().finally(() => process.exit(0));
  const supervisor = criarSupervisor({ raiz: process.env.NOD_PC_RAIZ, run: process.env.NOD_PC_RUN, terminal: process.env.NOD_PC_TERMINAL, aoAtualizar });
  await supervisor.carregar();
  const servidor = servirControle(supervisor);
  await escutarControle(servidor, process.env.NOD_PC_SOCKET ?? '/run/nod-computador/ctl.sock');
  const sair = () => void supervisor.encerrar().finally(() => process.exit(0));
  process.on('SIGTERM', sair);
  process.on('SIGINT', sair);
}
