// definido em 2026-10-22 (NOD-96 PR 2, ADR-122 §1): a tela de um bot no computador da pessoa. Um processo por tela,
// filho do supervisor (fork, IPC): Xvfb :1NN + openbox + Chromium (launchPersistentContext num fork do perfil-base, sem
// Cookies), cada um dentro do bwrap (isolamento.mjs), CDP por pipe. Nasce do runtime.mjs do modo docker: as ações são as
// mesmas. Os cookies não ficam no perfil: depois de cada ação a tela manda o diff ao supervisor (loja única) e aplica o
// que ele repassa das outras telas.
import { spawn, execFile } from 'node:child_process';
import { constants, open as abrirDescritor } from 'node:fs';
import net from 'node:net';
import { promisify } from 'node:util';
import { createHash, randomBytes } from 'node:crypto';
import { access, chmod, cp, link, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { URL, pathToFileURL } from 'node:url';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { setTimeout as esperar } from 'node:timers/promises';
import { clearInterval, clearTimeout, setInterval, setTimeout } from 'node:timers';
import { lerTexto, gravarTexto } from './texto.mjs';
import { codigoDaAcao, falhaDe, primeiraLinha, PRAZO_NAVEGADOR_MS, TRAVAS_DO_PERFIL } from './falhas.mjs';
import { argsDoBwrap, aspas, scriptDoBwrap, vizinhosDoTmp } from './isolamento.mjs';
import { mascararForaDaJanela } from './mascara-png.mjs';
import { chaveDoCookie, diffDeCookies } from './loja-cookies.mjs';
import { coletarNaPagina, comPrazo, hashDosDados, origemDe, origemTemLogin, PRAZO_COLETA_MS, restaurarOrigem, ritmoDeColeta, TETO_STORAGE_BYTES } from './login-storage.mjs';
import { importarNoPerfil } from './login-senhas.mjs';

const exec = promisify(execFile);

/** Arquivos do SQLite de cookies que o fork do perfil-base não leva: os cookies vêm da loja. */
/**
 * NOD-95 (ADR-138): o x11vnc só no socket unix. `-rfbport 0`/`-rfbportv6 0` tiram a porta TCP; `-localhost` e `-noipv6`
 * (revisão do PR #599) garantem que, se uma versão ignorar o 0, a porta não sai do loopback. `-noshm`: o Xvfb está no
 * bwrap com --unshare-ipc, e o x11vnc, fora dele, morria no MIT-SHM (1º ensaio no Mac, 29/10). `-noremote` e
 * `-novncconnect` (2ª revisão): um cliente X do mesmo display (o Chromium) não reconfigura o x11vnc pela propriedade X.
 */
export function argumentosDoX11vnc(display, xauthority, sock) {
  return ['-display', display, '-auth', xauthority, '-unixsock', sock, '-rfbport', '0', '-rfbportv6', '0', '-localhost', '-noipv6', '-nopw', '-shared', '-forever', '-quiet', '-xkb', '-noshm', '-noremote', '-novncconnect'];
}

export const COOKIES_DO_PERFIL = ['Default/Cookies', 'Default/Cookies-journal', 'Default/Network/Cookies', 'Default/Network/Cookies-journal'];

/** Esquemas que a tela navega. file:, chrome: e afins ficam de fora: o disco da máquina não é do bot. */
export function urlPermitida(url) {
  if (url === 'about:blank') return true;
  try {
    return ['http:', 'https:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

/**
 * Ganchos da tela (ADR-122; a NOD-97 pendura senhas e storage aqui). Cada lista roda em ordem; um gancho que lança em
 * `antesDeNavegar` recusa a navegação.
 */
export const ganchos = {
  antesDeAbrirChrome: [],
  depoisDaAcao: [],
  aoFecharChrome: [],
  antesDeNavegar: [
    (url) => {
      if (!urlPermitida(url)) throw new Error('url_recusada');
    },
  ],
};
const rodar = async (lista, ...args) => {
  for (const g of lista) await g(...args);
};

/** Faz o perfil do bot a partir do perfil-base (cp --reflink=auto), sem os cookies. Perfil que já existe fica. */
export async function forkDoPerfil(perfilBase, perfil) {
  const existe = await access(perfil).then(() => true, () => false);
  if (!existe) {
    await mkdir(path.dirname(perfil), { recursive: true, mode: 0o700 });
    const temBase = await access(perfilBase).then(() => true, () => false);
    if (temBase) await exec('cp', ['-a', '--reflink=auto', `${perfilBase}/.`, perfil]).catch(async () => cp(perfilBase, perfil, { recursive: true }));
    else await mkdir(perfil, { recursive: true, mode: 0o700 });
  }
  for (const c of COOKIES_DO_PERFIL) await rm(path.join(perfil, c), { force: true });
  for (const nome of TRAVAS_DO_PERFIL) await unlink(path.join(perfil, nome)).catch(() => {});
  await perfilSaiuLimpo(perfil);
}

/** NOD-97 PR 6: o storage de site que o Chrome guarda no perfil (o que o Sair de todos apaga, além dos cookies). */
export const STORAGE_DO_PERFIL = ['Default/Local Storage', 'Default/Session Storage', 'Default/IndexedDB', 'nod-storage.json', 'nod-origens.json'];
const ARQUIVO_DA_GERACAO = 'nod-storage-geracao';
/** As origens que as abas deste perfil já abriram (o que o Sair de todos apaga numa tela aberta). */
export const ARQUIVO_DAS_ORIGENS = 'nod-origens.json';
const TETO_DE_ORIGENS = 5000;

/**
 * NOD-97 PR 6 (revisão do #515): grava `conteudo()` em `arquivo` em fila, uma gravação por vez, e de forma atômica
 * (temporário + rename). writeFile concorrente no mesmo arquivo intercala as escritas e deixa um JSON inválido, que ao
 * reabrir a tela vira [] e esquece as origens. `conteudo` é lido na hora em que a gravação roda, então a última da fila
 * grava o estado atual. A promessa devolvida nunca rejeita.
 */
export function gravadorEmFila(arquivo, conteudo) {
  let fila = Promise.resolve();
  let seq = 0;
  return () =>
    (fila = fila.then(async () => {
      const tmp = `${arquivo}.${process.pid}.${++seq}.tmp`;
      try {
        await writeFile(tmp, conteudo(), { mode: 0o600 });
        await rename(tmp, arquivo);
      } catch {
        await rm(tmp, { force: true }).catch(() => {});
      }
    }));
}

/**
 * QA do #515 @3c77fab4: a tela morta no meio de uma gravação (o supervisor dá SIGKILL depois de 15 s) deixa o temporário
 * do gravadorEmFila no perfil, com as origens visitadas, e nada o apagava (nem o Sair de todos). Sai ao subir a tela e
 * junto com o storage do perfil.
 */
export async function apagarTemporariosDasOrigens(perfil) {
  const nomes = await readdir(perfil).catch(() => []);
  const sobras = nomes.filter((n) => n.startsWith(`${ARQUIVO_DAS_ORIGENS}.`) && n.endsWith('.tmp'));
  await Promise.all(sobras.map((n) => rm(path.join(perfil, n), { force: true }).catch(() => {})));
}

/** A geração do storage em comum que este perfil já aplicou (0 se nunca). */
export async function geracaoDoPerfil(perfil) {
  const n = Number((await readFile(path.join(perfil, ARQUIVO_DA_GERACAO), 'utf8').catch(() => '0')).trim());
  return Number.isSafeInteger(n) && n >= 0 ? n : 0;
}

export const gravarGeracaoDoPerfil = (perfil, geracao) => writeFile(path.join(perfil, ARQUIVO_DA_GERACAO), String(geracao), { mode: 0o600 });

/**
 * NOD-97 PR 6: o Sair de todos sobe a geração do storage em comum. O perfil de uma tela que estava fechada ainda tem o
 * Local Storage/IndexedDB no disco: ao subir com uma geração mais nova que a dele, apaga esse storage ANTES do Chrome
 * abrir e grava a geração. Devolve true se apagou.
 */
export async function aplicarGeracaoNoPerfil(perfil, geracao) {
  if (!Number.isSafeInteger(geracao) || geracao <= (await geracaoDoPerfil(perfil))) return false;
  for (const nome of STORAGE_DO_PERFIL) await rm(path.join(perfil, nome), { recursive: true, force: true });
  await apagarTemporariosDasOrigens(perfil);
  await gravarGeracaoDoPerfil(perfil, geracao);
  return true;
}

/** NOD-97 PR 6: apaga pelo CDP (Storage.clearDataForOrigin) o storage das origens dadas, abertas numa aba ou não. */
export async function limparOrigensNoChrome(context, origens) {
  const lista = [...new Set(origens)].filter((o) => origemDe(o) === o);
  if (!lista.length || !context) return;
  const { cdp, temporaria } = await sessaoQueResponde(context);
  try {
    // Prazo por chamada (QA do #515): uma chamada presa não pode segurar a tela até o supervisor matá-la em 15 s; a
    // limpeza falha a tempo e as origens ficam guardadas para o próximo Sair de todos.
    for (const origin of lista) {
      const r = await comPrazo(cdp.send('Storage.clearDataForOrigin', { origin, storageTypes: 'local_storage,indexeddb,websql,cache_storage,service_workers,file_systems' }), PRAZO_DO_CDP_MS, VENCEU);
      if (r === VENCEU) throw new Error('limpeza_sem_resposta');
    }
  } finally {
    await comPrazo(cdp.detach().catch(() => {}), PRAZO_DO_CDP_MS);
    if (temporaria) await comPrazo(temporaria.close().catch(() => {}), PRAZO_DO_CDP_MS);
  }
}

/**
 * QA do #515: a sessão CDP abre numa aba que responde. A aba presa (página em laço infinito, diálogo de beforeunload)
 * segura o newCDPSession para sempre; as que já foram a about:blank vêm primeiro e, se nenhuma responde, uma aba nova
 * temporária faz a limpeza (o Storage.clearDataForOrigin vale para o navegador inteiro, de qualquer aba).
 */
async function sessaoQueResponde(context) {
  const abas = context.pages().filter((x) => !x.isClosed());
  abas.sort((a, b) => Number(b.url() === 'about:blank') - Number(a.url() === 'about:blank'));
  for (const p of abas.slice(0, ABAS_TENTADAS_NO_CDP)) {
    const pedido = context.newCDPSession(p).catch(() => null);
    const cdp = await comPrazo(pedido, PRAZO_DO_CDP_MS, VENCEU);
    if (cdp === VENCEU) { pedido.then((s) => s?.detach().catch(() => {})); continue; }
    if (cdp) return { cdp, temporaria: null };
  }
  const temporaria = await comPrazo(context.newPage(), PRAZO_DO_CDP_MS * 2, VENCEU);
  if (temporaria === VENCEU) throw new Error('limpeza_sem_resposta');
  const cdp = await comPrazo(context.newCDPSession(temporaria), PRAZO_DO_CDP_MS, VENCEU);
  if (cdp === VENCEU) { await temporaria.close().catch(() => {}); throw new Error('limpeza_sem_resposta'); }
  return { cdp, temporaria };
}

/**
 * Revisão 8 do PR #600: apaga cookies exatos (nome, domínio como o Chrome o guarda, com ou sem ponto, e caminho) pelo
 * CDP (Network.deleteCookies). O `clearCookies(filtro)` do Playwright lê tudo, apaga tudo e devolve o resto: o
 * Set-Cookie que um site gravasse no meio sumia. Conferido num Chromium real (host-only e de domínio, caminhos distintos).
 */
export async function apagarCookiesNoChrome(context, ids) {
  if (!ids.length) return;
  const { cdp, temporaria } = await sessaoQueResponde(context);
  try {
    for (const { name, domain, path: caminho } of ids) {
      const r = await comPrazo(cdp.send('Network.deleteCookies', { name, domain, path: caminho }), PRAZO_DO_CDP_MS, VENCEU);
      if (r === VENCEU) throw new Error('cookies_sem_resposta');
    }
  } finally {
    await comPrazo(cdp.detach().catch(() => {}), PRAZO_DO_CDP_MS);
    if (temporaria) await comPrazo(temporaria.close().catch(() => {}), PRAZO_DO_CDP_MS);
  }
}

/**
 * NOD-97 PR 6 (QA do #515): o Sair de todos numa tela ABERTA. A página viva guarda a sessão na memória e pode regravá-la
 * no storage (o SPA que renova o token): as abas saem para about:blank ANTES de apagar, os cookies saem de novo (o que a
 * página gravou ao sair), o storage de cada origem sai pelo CDP e as abas voltam ao endereço em que estavam, deslogadas.
 */
export async function sairDasAbas(context, origens, pendente = null, aoAceitar = () => {}) {
  if (!context) return;
  const abas = context.pages().filter((p) => !p.isClosed());
  const enderecos = abas.map((p) => [p, p.url()]);
  // QA do #515: o site que pede "sair da página?" (beforeunload, comum em editor e formulário) prende a aba no diálogo: a
  // ida a about:blank não acontece, o SPA segue vivo com a sessão na memória e a sessão CDP da aba trava. No Sair de todos
  // a página sai de qualquer jeito: o diálogo é aceito, o que já estava aberto e os que a ida a about:blank abrir.
  // aoAceitar avisa a tela, que também ouve o 'dialog' da aba e guardaria o diálogo já aceito (revisão do #521).
  const aceitar = (d) => { if (d.type() === 'beforeunload') { d.accept().catch(() => {}); aoAceitar(d); } };
  if (pendente?.type?.() === 'beforeunload') await pendente.accept().catch(() => {});
  for (const p of abas) p.on('dialog', aceitar);
  try {
    // Em paralelo e com prazo curto: o supervisor mata a tela que não responde a limpar_storage em 15 s, e uma aba num
    // site lento não pode segurar o Sair de todos (revisão do #518). A volta só espera o commit; a página carrega depois.
    await Promise.all(abas.map((p) => p.goto('about:blank', { timeout: 3000 }).catch(() => {})));
  } finally {
    for (const p of abas) p.off('dialog', aceitar);
  }
  await context.clearCookies();
  await limparOrigensNoChrome(context, [...origens, ...enderecos.map(([, u]) => origemDe(u)).filter(Boolean)]);
  await Promise.all(enderecos.filter(([, url]) => origemDe(url)).map(([p, url]) => p.goto(url, { waitUntil: 'commit', timeout: 4000 }).catch(() => {})));
}

/** Prazo de cada chamada ao CDP na limpeza (QA do #515): 5000 origens levam ~3 s no total; uma só nunca leva 2 s. */
export const PRAZO_DO_CDP_MS = 2000;
const VENCEU = Symbol('venceu');

/** Igual ao runtime: sem isto o Chromium abre "Restore pages?" depois de uma tela morta. JSON inválido fica. */
export async function perfilSaiuLimpo(perfil) {
  const arquivo = path.join(perfil, 'Default', 'Preferences');
  let prefs;
  try {
    prefs = JSON.parse(await readFile(arquivo, 'utf8'));
  } catch {
    return;
  }
  if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) return;
  const p = prefs.profile && typeof prefs.profile === 'object' && !Array.isArray(prefs.profile) ? prefs.profile : (prefs.profile = {});
  if (p.exit_type === 'Normal' && p.exited_cleanly === true) return;
  p.exit_type = 'Normal';
  p.exited_cleanly = true;
  await writeFile(arquivo, JSON.stringify(prefs));
}

/**
 * NOD-97 PR 3 (ADR-122 §4, emenda): o arquivo Xauthority de uma tela, com um cookie MIT-MAGIC-COOKIE-1 só dela. Uma
 * entrada FamilyWild (vale para qualquer host) no número do display: sem ela o Xvfb aceita qualquer processo da
 * máquina que alcance o socket (o abstrato `@/tmp/.X11-unix/X1NN` é por network namespace, não some no PrivateTmp nem no
 * bwrap: o motor, os CLIs dos bots e o terminal o alcançariam). Gerado aqui, em Node, para não depender do `xauth`.
 */
export function arquivoXauthority(display, cookie = randomBytes(16)) {
  if (!Buffer.isBuffer(cookie) || cookie.length !== 16) throw new Error('cookie_x');
  const campo = (b) => {
    const t = Buffer.alloc(2);
    t.writeUInt16BE(b.length);
    return Buffer.concat([t, b]);
  };
  const familia = Buffer.alloc(2);
  familia.writeUInt16BE(0xffff);
  return Buffer.concat([familia, campo(Buffer.alloc(0)), campo(Buffer.from(String(display))), campo(Buffer.from('MIT-MAGIC-COOKIE-1')), campo(cookie)]);
}

/** Os argumentos do Xvfb: só o socket do caminho (sem TCP nem o abstrato) e só com o cookie (`-auth`). */
export function argsDoXvfb(display, xauthority, extras = []) {
  return [`:${display}`, '-screen', '0', '1280x800x24', '-nolisten', 'tcp', '-nolisten', 'local', '-auth', xauthority, ...extras];
}

/**
 * NOD-97 PR 5: roda na página (context.addInitScript, em TODA navegação e em todo frame, antes do script do site) para
 * o bot nunca ver a senha que o Chrome preenche. Marca com `data-nod-senha` todo input que já foi type=password e
 * injeta um CSS que troca o texto por bolinhas (`-webkit-text-security`), inclusive se o site trocar o input para
 * type=text para "mostrar senha". O valor continua no campo (o site funciona); só não aparece no screenshot nem no
 * innerText que a tela manda ao bot.
 *
 * Shadow DOM: o CSS do documento não atravessa a fronteira de um shadow root. Por isso o `attachShadow` é embrulhado
 * (pega também os roots `closed`, que de fora ninguém alcança), e cada root ganha o mesmo <style> e o mesmo
 * observador; root aberto que já existia (shadow DOM declarativo) é coberto quando aparece na árvore. O <style> volta se
 * o site trocar o conteúdo do root. Fica de fora só o shadow DOM declarativo `closed` (não passa pelo attachShadow nem
 * é alcançável): registrado na ADR-122.
 */
/* eslint-disable no-undef */
/**
 * Revisão 21 do PR #600: com o dock, a página não captura a tela (o seletor "Tela inteira" do Chrome é clicável pelo bot e
 * mostraria o Terminal da pessoa). O Chrome não guarda negação de `display-capture`, então o método some de toda página.
 */
export function semCapturaDeTela() {
  const negar = () => Promise.reject(new DOMException('captura de tela desligada no computador do bot', 'NotAllowedError'));
  try {
    if (globalThis.MediaDevices?.prototype) Object.defineProperty(MediaDevices.prototype, 'getDisplayMedia', { value: negar, configurable: false, writable: false });
  } catch { /* já definido */ }
}

/** Revisão 21: as permissões que o Chrome do bot nega com o dock (a área de transferência é do display inteiro). */
export const PERMISSOES_NEGADAS_COM_DOCK = Object.freeze(['clipboard-read']);

/**
 * Nega as permissões no navegador inteiro (sem origem: vale para todas). A sessão CDP precisa ser a do navegador
 * (`newBrowserCDPSession`): pela sessão de uma página, o Chrome aplica só à origem dela. E a negação vive com a sessão:
 * quem chama não a solta.
 */
export async function negarPermissoes(cdp, nomes = PERMISSOES_NEGADAS_COM_DOCK) {
  for (const name of nomes) await cdp.send('Browser.setPermission', { permission: { name }, setting: 'denied' });
}

export function mascaraDeSenha() {
  const CSS = 'input:-webkit-autofill, input[data-nod-senha]{-webkit-text-security:disc !important;}';
  const cobertas = new Map();
  const opcoes = { childList: true, subtree: true, attributes: true, attributeFilter: ['type'] };
  let obs = null;
  const garantirEstilo = (raiz) => {
    const atual = cobertas.get(raiz);
    if (atual && atual.parentNode === raiz) return;
    const s = document.createElement('style');
    s.setAttribute('data-nod-mascara-senha', '');
    s.textContent = CSS;
    raiz.appendChild(s);
    cobertas.set(raiz, s);
  };
  const cobrir = (raiz) => {
    if (!raiz || cobertas.has(raiz)) return;
    garantirEstilo(raiz);
    marcar(raiz);
    obs?.observe(raiz, opcoes);
  };
  function marcar(raiz) {
    if (!raiz || !raiz.querySelectorAll) return;
    if (raiz.tagName === 'INPUT' && raiz.type === 'password') raiz.setAttribute('data-nod-senha', '');
    if (raiz.shadowRoot) cobrir(raiz.shadowRoot);
    for (const el of raiz.querySelectorAll('*')) {
      if (el.tagName === 'INPUT' && el.type === 'password') el.setAttribute('data-nod-senha', '');
      if (el.shadowRoot) cobrir(el.shadowRoot);
    }
  }
  const original = typeof Element !== 'undefined' ? Element.prototype.attachShadow : null;
  if (original) {
    Element.prototype.attachShadow = function attachShadow(...args) {
      const raiz = original.apply(this, args);
      try { cobrir(raiz); } catch { /* a máscara nunca quebra o site */ }
      return raiz;
    };
  }
  const estiloDoDocumento = () => {
    const cabeca = document.head || document.documentElement;
    if (cabeca && !document.getElementById('nod-mascara-senha')) {
      const s = document.createElement('style');
      s.id = 'nod-mascara-senha';
      s.textContent = CSS;
      cabeca.appendChild(s);
    }
  };
  obs = new MutationObserver((muts) => {
    for (const m of muts) {
      for (const n of m.addedNodes) if (n.nodeType === 1) marcar(n);
      if (m.type === 'attributes' && m.target.tagName === 'INPUT' && m.target.type === 'password') m.target.setAttribute('data-nod-senha', '');
      const raiz = m.target.getRootNode?.();
      if (raiz && raiz !== document && cobertas.has(raiz)) garantirEstilo(raiz);
    }
    // Só o que entrou é varrido (acima); aqui só confere que o <style> do documento continua lá.
    estiloDoDocumento();
  });
  // Roots criados antes do documentElement (raro) já estão em `cobertas`, mas sem observador.
  for (const raiz of cobertas.keys()) obs.observe(raiz, opcoes);
  const iniciar = () => { estiloDoDocumento(); marcar(document); obs.observe(document.documentElement, opcoes); };
  if (document.documentElement) iniciar();
  else document.addEventListener('DOMContentLoaded', iniciar);
}

/**
 * Roda na página: há um campo de senha preenchido pelo Chrome? Devolve só true/false, nunca o valor. Olha também
 * dentro dos shadow roots abertos.
 */
export function temSenhaPreenchida() {
  const SELETOR = 'input[data-nod-senha]:-webkit-autofill, input:-webkit-autofill[type="password"]';
  const olhar = (raiz) => {
    if (raiz.querySelector(SELETOR)) return true;
    for (const el of raiz.querySelectorAll('*')) if (el.shadowRoot && olhar(el.shadowRoot)) return true;
    return false;
  };
  return olhar(document);
}
/* eslint-enable no-undef */

// NOD-410 (definido em 2026-10-30): o desktop tem um dock (tint2) embaixo, como o do Grok: o Chrome continua sem moldura
// e maximizado (ocupa o que o dock deixa); o terminal e os arquivos que a pessoa abre pelo dock vêm com moldura.
/** As classes X do Chrome, em glob do openbox: o mesmo conjunto que CLASSE_DO_CHROME casa no xdotool (revisão do PR #600). */
export const CLASSES_DO_CHROME_NO_OPENBOX = ['Chromium*', 'chromium*', 'Google-chrome*', 'google-chrome*', 'chrome*'];
// Revisão 15 do PR #600: teclado, mouse e menu explícitos. Sem eles valiam os padrões do openbox, cujo menu do botão
// direito na área de trabalho pode abrir um terminal fora do bwrap do dock. Só foco, mover e os botões da janela: sem
// nenhum ShowMenu ligado, o menu do sistema fica inalcançável (conferido num openbox 3.6 real com Xvfb).
export const OPENBOX_XML = `<?xml version="1.0" encoding="UTF-8"?>
<openbox_config xmlns="http://openbox.org/3.4/rc">
  <theme><titleLayout>LC</titleLayout><font place="ActiveWindow"><name>sans</name><size>9</size></font></theme>
  <applications>
${CLASSES_DO_CHROME_NO_OPENBOX.map((c) => `    <application class="${c}">
      <decor>no</decor>
      <maximized>yes</maximized>
    </application>`).join('\n')}
  </applications>
  <keyboard></keyboard>
  <mouse>
    <context name="Frame"><mousebind button="Left" action="Press"><action name="Focus"/><action name="Raise"/></mousebind></context>
    <context name="Client"><mousebind button="Left" action="Press"><action name="Focus"/><action name="Raise"/></mousebind></context>
    <context name="Titlebar"><mousebind button="Left" action="Press"><action name="Focus"/><action name="Raise"/></mousebind><mousebind button="Left" action="Drag"><action name="Move"/></mousebind></context>
    <context name="Close"><mousebind button="Left" action="Click"><action name="Close"/></mousebind></context>
    <context name="Maximize"><mousebind button="Left" action="Click"><action name="ToggleMaximize"/></mousebind></context>
    <context name="Iconify"><mousebind button="Left" action="Click"><action name="Iconify"/></mousebind></context>
  </mouse>
</openbox_config>`;

/** A classe X da janela do Chrome, como regex do xdotool: Chromium, ou Google Chrome (for Testing) do Playwright. */
export const CLASSE_DO_CHROME = '^(Chromium|Google-chrome|google-chrome|chrome)';
/** A altura do dock: o Chrome fica com o resto da tela (1280×800 − dock). */
export const DOCK_ALTURA = 48;
/** O fundo do desktop (o dock e a moldura são escuros; o Chrome cobre quase tudo). */
const COR_DO_FUNDO = '#1f1f23';

/** O tint2 do desktop: só o dock (lançadores + as janelas abertas), embaixo, escuro, sem relógio nem bandeja. */
export function tint2rc(lancadores) {
  return [
    'panel_items = LT',
    'panel_position = bottom center horizontal',
    // Largura pelo conteúdo (`panel_shrink`, o caminho documentado do tint2): um dock flutuante no meio, como o do Grok,
    // não uma barra de ponta a ponta.
    `panel_size = 100% ${DOCK_ALTURA}`,
    'panel_shrink = 1',
    'panel_margin = 0 0',
    'panel_padding = 10 4 10',
    'panel_background_id = 1',
    'panel_layer = top',
    'strut_policy = follow_size',
    'panel_monitor = all',
    'autohide = 0',
    'font_shadow = 0',
    'mouse_effects = 1',
    // Revisão 8 do PR #600: a rolagem do bot cai onde o ponteiro estiver; sobre a barra de tarefas ela minimizava janelas.
    'mouse_scroll_up = none',
    'mouse_scroll_down = none',
    '',
    'rounded = 12',
    'border_width = 0',
    'background_color = #1f1f23 100',
    'border_color = #1f1f23 0',
    '',
    'rounded = 6',
    'border_width = 0',
    'background_color = #3a3a44 100',
    'border_color = #3a3a44 0',
    '',
    'launcher_padding = 6 4 10',
    'launcher_background_id = 0',
    'launcher_icon_background_id = 0',
    'launcher_icon_size = 32',
    'launcher_icon_asb = 100 0 0',
    'launcher_icon_theme = Adwaita',
    'launcher_icon_theme_override = 1',
    'launcher_tooltip = 0',
    ...lancadores.map((l) => `launcher_item_app = ${l}`),
    '',
    'taskbar_mode = single_desktop',
    'taskbar_padding = 8 0 4',
    'taskbar_background_id = 0',
    'task_text = 1',
    // Revisão 22: o tooltip da tarefa traz o título da janela e abre por cima do Chrome, onde a captura do bot vê.
    'task_tooltip = 0',
    'task_icon = 1',
    'task_centered = 1',
    'task_maximum_size = 180 40',
    'task_padding = 8 4 4',
    'task_font = sans 9',
    'task_font_color = #d4d4d8 100',
    'task_active_font_color = #ffffff 100',
    'task_background_id = 0',
    'task_active_background_id = 2',
    'task_icon_asb = 100 0 0',
    'task_active_icon_asb = 100 0 0',
    '',
    'tooltip_padding = 6 4',
    'tooltip_background_id = 2',
    'tooltip_font = sans 9',
    'tooltip_font_color = #ffffff 100',
    '',
  ].join('\n');
}

/** Um lançador do dock (.desktop): nome, ícone do tema e o script que roda no bwrap do desktop. */
export function lancadorDesktop({ nome, icone, exec }) {
  return `[Desktop Entry]\nType=Application\nName=${nome}\nIcon=${icone}\nExec=${exec}\nTerminal=false\n`;
}

/** Resolve pelo PATH sem invocar shell; o dock é opcional e só reduz a janela quando o tint2 existe de verdade. */
export async function binarioDisponivel(binario, env = process.env) {
  if (!binario) return false;
  const candidatos = binario.includes('/') ? [binario] : String(env.PATH ?? '').split(path.delimiter).filter(Boolean).map((p) => path.join(p, binario));
  for (const candidato of candidatos) if (await access(candidato, constants.X_OK).then(() => true, () => false)) return true;
  return false;
}

/**
 * Revisão 15 do PR #600: os programas que só o dock pode abrir (Arquivos, Terminal e os que os chamam, como o xdg-open
 * do "Mostrar na pasta" do Chrome). No bwrap do Chrome e do openbox eles somem atrás do /dev/null: aberto de lá, o
 * Terminal veria o perfil, os logins e o keyring. Devolve os caminhos reais (sem symlink) que existem, sem repetir.
 */
export const PROGRAMAS_SO_DO_DOCK = ['xdg-open', 'x-terminal-emulator', 'x-file-manager', 'exo-open', 'gio', 'xterm'];
export async function programasParaEsconder(nomes, env = process.env) {
  const achados = new Set();
  for (const nome of nomes) {
    if (!nome) continue;
    const candidatos = nome.includes('/') ? [nome] : String(env.PATH ?? '').split(path.delimiter).filter(Boolean).map((p) => path.join(p, nome));
    for (const c of candidatos) {
      const real = await realpath(c).catch(() => null);
      if (real && (await stat(real).then((x) => x.isFile(), () => false))) achados.add(real);
    }
  }
  return [...achados].sort();
}

/**
 * A configuração e os lançadores ficam no mesmo único diretório que o bwrap do dock remonta. Revisão 20: irmão do tmp da
 * tela, nunca dentro dele: o tmp entra com escrita no bwrap do Chrome, e o bot (pelo DevTools, por exemplo) reescreveria o
 * `dock-terminal.sh` que roda quando a pessoa clica no Terminal. O irmão fica sob o `run`, que some no bwrap do Chrome.
 */
/**
 * Revisão 21 do PR #600: a captura crua (a tela inteira, antes da máscara) fica ao lado do tmp, como a pasta do dock: o
 * tmp entra no bwrap do Chrome e o bot a abriria por `file://`. Ao lado, ela fica sob o `run`, que some no bwrap dele.
 */
export function caminhoDaCaptura(tmp) {
  return path.join(path.dirname(tmp), `${path.basename(tmp)}.tela.png`);
}

export function caminhosDoDock(tmp) {
  const pasta = path.join(path.dirname(tmp), `${path.basename(tmp)}.dock`);
  return { pasta, rc: path.join(pasta, 'tint2rc') };
}

/**
 * PR #600 (revisão rodada 3): a entrada do bot (xdotool) vai para a janela em foco, e no display do dock pode estar o
 * Terminal ou os Arquivos que a pessoa abriu. O bot só age no Chrome: devolve a janela do Chrome a ativar antes da ação,
 * ou null se o foco já é dele. Sem janela do Chrome, lança (a ação não sai às cegas).
 */
export function janelaParaFocar(idsDoChrome, ativa) {
  const ids = idsDoChrome.filter(Boolean);
  if (!ids.length) throw new Error('sem_janela_do_chrome');
  return ids.includes(ativa) ? null : ids[0];
}

/**
 * Põe o foco no Chrome antes da entrada do bot. Se o foco já é dele, nada. Senão traz a página `p` à frente (o que
 * também desfaz a minimização: a pessoa pode minimizar o Chrome pelo dock, e o `search --onlyvisible` não acha janela
 * minimizada) e confere de novo; só ativa à mão se ainda não for o Chrome (revisão 4 do PR #600).
 */
export async function focarJanelaDoChrome({ listar, ativa, trazer, ativar }) {
  const ids = (await listar()).filter(Boolean);
  const antes = await ativa();
  if (ids.length && ids.includes(antes)) return { janela: antes, trocou: false };
  await trazer();
  const depois = await ativa();
  const alvo = janelaParaFocar(await listar(), depois);
  if (alvo === null) return { janela: depois, trocou: true };
  await ativar(alvo);
  return { janela: alvo, trocou: true };
}

/**
 * Revisão 8 do PR #600: se o foco precisou voltar ao Chrome, o quadro que o bot observou mostrava outra janela (o
 * Terminal, os Arquivos, o Chrome minimizado). A ação com quadro não sai às cegas: a tela mudou e ele observa de novo.
 */
export function precisaObservarDeNovo(foco, a) {
  return Boolean(foco?.trocou) && 'quadro' in a;
}

/**
 * PR #600 (revisão 7): a entrada do bot vai no MESMO processo do xdotool que reativa o Chrome. Conferir o foco e só
 * depois teclar deixava uma janela (a pessoa clicando no Terminal pelo VNC no meio) receber o texto e o Enter do bot.
 */
export function comFocoNoChrome(janela, args) {
  return janela ? ['windowactivate', '--sync', String(janela), ...args] : args;
}

/**
 * Revisão 9 do PR #600: o `getmouselocation --shell` do xdotool diz onde está o ponteiro. Na faixa do dock (ou sem
 * resposta), o ponteiro vai ao meio do Chrome antes da rolagem; senão fica onde a pessoa ou o bot o deixou.
 */
export function argsParaRolarNoChrome(saida, alturaDoChrome, geometria) {
  const x = Number(/^X=(\d+)$/m.exec(saida)?.[1]);
  const y = Number(/^Y=(\d+)$/m.exec(saida)?.[1]);
  // Revisão 17: com a geometria do Chrome, o ponteiro também precisa estar sobre ele (não sobre o Terminal ao lado).
  const naJanela = geometria === undefined || pontoNaJanela(geometria, x, y);
  if (Number.isFinite(y) && y < alturaDoChrome && naJanela) return [];
  const g = geometria === undefined ? null : geometriaDaJanela(geometria);
  if (g) return ['mousemove', '--sync', String(Math.floor(g.x + g.largura / 2)), String(Math.floor(Math.min(g.y + g.altura / 2, alturaDoChrome / 2)))];
  return ['mousemove', '--sync', '640', String(Math.floor(alturaDoChrome / 2))];
}

/**
 * Revisão 10 do PR #600: a trava do dock (recusa na faixa dele, foco devolvido ao Chrome, ponteiro fora dele) é contra o
 * bot. A ação da pessoa (o caminho de volta quando o ao vivo cai, ADR-138 §1) usa o dock e o Terminal como no VNC.
 */
export const ACOES_DE_ENTRADA = Object.freeze(['clicar', 'arrastar', 'digitar', 'tecla', 'rolar']);

export function regraDoDockVale(dockDisponivel, a, pessoa) {
  return Boolean(dockDisponivel) && !pessoa && ACOES_DE_ENTRADA.includes(a.tipo);
}

/** PR #600: um clique ou arrasto do bot na faixa do dock (abaixo do Chrome) é recusado: o dock é da pessoa. */
export function tocaNoDock(a, alturaDoChrome) {
  if (a.tipo !== 'clicar' && a.tipo !== 'arrastar') return false;
  return a.y >= alturaDoChrome || (a.tipo === 'arrastar' && a.destinoY >= alturaDoChrome);
}

/**
 * Revisão 17 do PR #600: os pontos que um clique ou arrasto do bot toca. Cada um precisa cair dentro da janela do
 * Chrome (que acabou de receber o foco e está na frente): fora dela, o clique iria ao Terminal ou aos Arquivos da pessoa.
 */
export function pontosDoToque(a) {
  if (a.tipo === 'clicar') return [[a.x, a.y]];
  if (a.tipo === 'arrastar') return [[a.x, a.y], [a.destinoX, a.destinoY]];
  return [];
}

/** Lê o `xdotool getwindowgeometry --shell` (X, Y, WIDTH, HEIGHT na raiz) e diz se o ponto cai na janela. Sem leitura, não. */
export function geometriaDaJanela(saida) {
  const [x, y, largura, altura] = ['X', 'Y', 'WIDTH', 'HEIGHT'].map((k) => Number(new RegExp(`^${k}=(-?\\d+)$`, 'm').exec(saida ?? '')?.[1]));
  return [x, y, largura, altura].every(Number.isFinite) ? { x, y, largura, altura } : null;
}

/**
 * Revisão 22: a parte da janela do Chrome que vai ao bot. O tint2 fica por cima de tudo (`panel_layer = top`): se o
 * Chrome descer até a faixa do dock, o retângulo dele cobriria os títulos das tarefas. Corta em `alturaDoChrome`.
 */
export function areaDoChrome(g, alturaDoChrome) {
  if (!g) return null;
  const altura = Math.min(g.y + g.altura, alturaDoChrome) - g.y;
  return altura > 0 ? { ...g, altura } : null;
}

export function pontoNaJanela(saida, x, y) {
  const g = geometriaDaJanela(saida);
  return Boolean(g) && x >= g.x && x < g.x + g.largura && y >= g.y && y < g.y + g.altura;
}

/**
 * Revisão 17: com o dock, o bot clica só com os botões 1 e 3. O do meio cola a seleção primária do X, que pode ser um
 * texto que a pessoa selecionou no Terminal.
 */
export const BOTOES_DO_BOT_COM_DOCK = Object.freeze([1, 3]);

/**
 * Revisão 18 do PR #600: o que a pessoa copiou no Terminal ou nos Arquivos (a área de transferência e a seleção
 * primária do X são do display inteiro) não chega ao bot. Depois que a pessoa mexe (abre o ao vivo ou age pela tela),
 * a primeira ação do bot com o dock esvazia as duas antes de rodar; entre ações do próprio bot, o copiar e colar dele
 * continua valendo.
 * Revisão 24: com o ao vivo aberto, a pessoa copia pelo VNC sem passar pela tela. Com `ler` (a impressão das duas
 * seleções), a guarda anota como o bot as deixou ao fim da ação dele e, se mudaram até a próxima, esvazia. Sem
 * anotação ou com a leitura falhando, esvazia também.
 */
export function criarGuardaDaSelecao(limpar, ler) {
  let daPessoa = false;
  let marca = null;
  return {
    pessoaMexeu() { daPessoa = true; },
    async antesDoBot() {
      let mudou = daPessoa;
      if (!mudou && ler) mudou = marca === null || (await ler().catch(() => null)) !== marca;
      if (!mudou) return;
      marca = null;
      await limpar();
      daPessoa = false;
    },
    async depoisDoBot() {
      if (ler) marca = await ler().catch(() => null);
    },
  };
}

/**
 * Revisão 29 do PR #600 (QA): o `xclip` que grava uma seleção deixa um filho no fundo, dono dela, com a saída herdada.
 * Pelo `execFile` a ação esperava esse filho até o prazo (25 s por seleção, 50 s na guarda: estourava o prazo da ação).
 * Aqui a saída vai para o nada e basta o pai sair. Erro, código diferente de 0 ou o prazo vencido viram falha.
 */
export function gravarSelecaoDoX(bin, selecao, arquivo, env, prazoMs = 5000) {
  return new Promise((ok, falha) => {
    const filho = spawn(bin, ['-selection', selecao, arquivo], { env, stdio: 'ignore' });
    const prazo = setTimeout(() => { filho.kill('SIGKILL'); falha(new Error('xclip_preso')); }, prazoMs);
    filho.on('error', (e) => { clearTimeout(prazo); falha(e); });
    filho.on('exit', (codigo) => { clearTimeout(prazo); if (codigo === 0) ok(); else falha(new Error(`xclip saiu com ${codigo}`)); });
  });
}

/** O quadro observado ainda vale: a tela não mudou desde a captura (mesma revisão) e ele tem menos de 2 min. */
export function quadroVale(observado, revisao, agora) {
  return Boolean(observado) && observado.revision === revisao && agora - observado.em <= 120000;
}

/**
 * PR #600 (revisão 10): lê o FIFO do lançador do Chrome. Aberto em leitura e escrita, sem bloquear: o FIFO nunca dá fim
 * de arquivo (o lançador abre, escreve e fecha) e a abertura não espera um escritor. Cada lote de bytes é um pedido.
 */
export async function vigiarFifo(fifo, aoPedido) {
  const fd = await new Promise((ok, falha) => abrirDescritor(fifo, constants.O_RDWR | constants.O_NONBLOCK, (e, d) => (e ? falha(e) : ok(d))));
  const s = new net.Socket({ fd, readable: true, writable: false });
  s.on('data', () => aoPedido());
  s.on('error', () => {});
  return { close() { s.destroy(); } };
}

/** Sem bwrap (só em desenvolvimento) o terminal do dock rodaria com o ambiente da tela: sem dock. Sem tint2, também. */
export async function dockPossivel(bin) {
  return Boolean(bin.bwrap) && await binarioDisponivel(bin.tint2);
}

/**
 * PR #600: a pasta privada do dock, a única que o bwrap dele recebe (nunca o tmp inteiro da tela, que contém `entrada`,
 * nem o socket DBus do keyring). Ela entra só leitura no sandbox (revisão 10) e sobrevive a uma tela morta (SIGKILL): um
 * symlink plantado faria a tela (fora do bwrap, como nod-pc) gravar noutro lugar. Por isso nasce de novo a cada subida e cada
 * arquivo é criado sem seguir link (`wx`). O tmp é noexec: o Exec chama `/bin/sh <script>`.
 */
export async function prepararPastaDoDock(config, xauthority) {
  const { pasta, rc } = caminhosDoDock(config.tmp);
  await rm(pasta, { recursive: true, force: true });
  await mkdir(pasta, { mode: 0o700 });
  const gravarNovo = (f, conteudo) => writeFile(f, conteudo, { mode: 0o600, flag: 'wx' });
  const xauthorityDoDock = path.join(pasta, 'Xauthority');
  await gravarNovo(xauthorityDoDock, xauthority);
  const script = async (nome, corpo) => {
    const f = path.join(pasta, `${nome}.sh`);
    await gravarNovo(f, `#!/bin/sh\n${corpo}\n`);
    return `/bin/sh ${f}`;
  };
  // O lançador não alcança o Chrome (é do Playwright, noutro bwrap): escreve um byte num FIFO que a tela lê e ela
  // traz/relança. FIFO e não arquivo (revisão 10): a pasta entra só leitura no bwrap do dock, e escrever num FIFO não
  // grava nada no /run nem precisa de escrita na montagem.
  const pedidoDoChrome = path.join(pasta, 'abrir-chrome');
  await exec('mkfifo', ['-m', '600', pedidoDoChrome]);
  const chrome = await script('dock-chrome', `printf 1 > ${aspas(pedidoDoChrome)}`);
  const arquivos = await script('dock-arquivos', `exec ${aspas(config.bin.arquivos ?? 'pcmanfm')} ${aspas(config.workspace)}`);
  // Sem o bus da tela (é o do keyring) e sem servidor: o xfce4-terminal pediria a janela a uma instância que não existe e sairia sem abrir nada.
  // `--command=/bin/bash`: o usuário da tela (nod-pc) é de sistema, sem shell de login; sem isto a janela fechava na hora.
  const terminal = await script('dock-terminal', `cd ${aspas(config.workspace)} && unset DBUS_SESSION_BUS_ADDRESS && exec ${aspas(config.bin.terminalGrafico ?? 'xfce4-terminal')} --disable-server --working-directory=${aspas(config.workspace)} --command=${aspas('/bin/bash --norc --noprofile')}`);
  // O ícone do Chrome é o do próprio Chromium do Playwright (product_logo_48.png ao lado do binário); sem ele, o do tema.
  const logoDoChrome = path.join(path.dirname(config.bin.chromium ?? ''), 'product_logo_48.png');
  const iconeDoChrome = await access(logoDoChrome).then(() => logoDoChrome, () => 'web-browser');
  const lancadores = [];
  for (const [nome, rotulo, icone, exec] of [['chrome', 'Chrome', iconeDoChrome, chrome], ['arquivos', 'Arquivos', 'system-file-manager', arquivos], ['terminal', 'Terminal', 'utilities-terminal', terminal]]) {
    const f = path.join(pasta, `${nome}.desktop`);
    await gravarNovo(f, lancadorDesktop({ nome: rotulo, icone, exec }));
    lancadores.push(f);
  }
  await gravarNovo(rc, tint2rc(lancadores));
  // Os Arquivos não executam com dois cliques sem perguntar (o bot pode plantar um script ou .desktop no workspace):
  // `quick_exec=0` faz o libfm perguntar se abre ou executa (revisão 6; risco residual na ADR-138).
  await mkdir(path.join(pasta, 'libfm'), { mode: 0o700 });
  // Revisão 27: sem miniaturas, o gdk-pixbuf e os geradores externos não processam o que o bot gravou no workspace.
  // Revisão 28: sem lixeira, apagar pelo Arquivos não deixa `.Trash-<uid>` no workspace do bot.
  await gravarNovo(path.join(pasta, 'libfm', 'libfm.conf'), '[config]\nquick_exec=0\nthumbnail_local=0\nshow_thumbnail=0\nuse_trash=0\n');
  return { pasta, rc, xauthority: xauthorityDoDock, pedidoDoChrome, lancadores };
}

/**
 * PR #600: o ciclo do Chrome de uma tela, um por vez. `garantir` abre se não há Chrome e, com uma abertura em curso,
 * espera a mesma (dois cliques no dock não abrem dois Chromes); `relancar(antigo)` fecha o antigo e espera ele sair antes
 * de abrir o novo no mesmo perfil; `soltar` é o `close` do Chrome; `esperar` deixa terminar uma abertura em curso.
 */
/**
 * Revisão 12 do PR #600: os prazos da tela cabem nos do supervisor (que mata a tela com SIGKILL quando vencem). O fechar
 * da tela tem 15 s (PRAZO_FECHAR_TELA_MS): espera a abertura em curso, sobe a última sincronia e fecha o Chrome, cada um
 * com a sua fatia. Fechar o Chrome antigo no relançamento usa PRAZO_FECHAR_CHROME_MS, para o relançamento (fechar +
 * abrir em PRAZO_NAVEGADOR_MS) caber nos 55 s de uma ação.
 */
export const PRAZO_FECHAR_CHROME_MS = 4000;
export const ORCAMENTO_DO_FECHAR = Object.freeze({ total: 12_000, esperarAbertura: 3000, sincronia: 6000, depoisDeMatar: 1500, piso: 1000 });

/**
 * Revisão 17: o Chrome fecha com o que sobra do orçamento do fechar (no caso comum, ~10 s para gravar storage e senhas
 * no disco), não com uma fatia fixa de 2 s. Fica sempre `depoisDeMatar` para confirmar a morte dentro do total.
 */
export function prazoParaFecharOChrome(gastoMs) {
  const o = ORCAMENTO_DO_FECHAR;
  return Math.max(o.piso, o.total - Math.max(0, gastoMs) - o.depoisDeMatar);
}

/**
 * Revisão 13: o prazo total de um pedido dentro da tela, abaixo do que o supervisor espera (PRAZO_ACAO_MS = 55 s e
 * PRAZO_LIMPAR_STORAGE_MS = 45 s). Somadas, as etapas com prazo próprio (relançar, cookies, foco) podem passar dele; a
 * tela responde `sem_resposta` antes e o supervisor não a mata com SIGKILL (o que perderia a última sincronia).
 */
export const PRAZO_DA_ACAO_NA_TELA_MS = 50_000;
export const PRAZO_LIMPAR_STORAGE_NA_TELA_MS = 40_000;
/** Revisão 14: o `limpar_cookies` (o supervisor espera 15 s) responde em 10 s; a saída envenenada cabe nos 5 s que sobram. */
export const PRAZO_LIMPAR_COOKIES_NA_TELA_MS = 10_000;
/** Revisão 14: quantas abas o `sessaoQueResponde` tenta antes da aba temporária (cada uma pode custar o prazo do CDP). */
export const ABAS_TENTADAS_NO_CDP = 2;

/** A resposta de um pedido à tela: o resultado, o erro dele ou `sem_resposta` quando passa de `ms`. */
export async function responderNoPrazo(fazer, ms, codigo = codigoDaAcao) {
  try {
    const r = await comPrazo(Promise.resolve().then(fazer), ms, VENCEU);
    return r === VENCEU ? { erro: 'sem_resposta', detalhe: 'a tela passou do prazo' } : { resultado: r };
  } catch (e) {
    return { erro: codigo(e), detalhe: primeiraLinha(e?.message) };
  }
}

/**
 * Revisão 14 do PR #600: atende um pedido com prazo e, se ele vencer, responde `sem_resposta`. Uma ação presa segurava
 * a fila da entrada para sempre; agora, se nem depois da `graca` ela terminar, chama `aoVencer` (na tela: fechar com
 * prazo e sair), e o supervisor marca a tela como fechada e a reabre na próxima ação.
 * Revisão 15: a graça existe porque o relançamento do Chrome (ORCAMENTO_DO_RELANCAMENTO_MS) tem prazo em cada passo mas
 * pode somar mais que a ação; sem ela, um relançamento lento derrubava a tela e o VNC da pessoa sem necessidade.
 */
export async function atenderNoPrazo(enviar, id, fazer, ms, { aoVencer = () => {}, codigo = codigoDaAcao, graca = 0, atraso = { emGraca: 0 } } = {}) {
  // Revisão 16: enquanto um pedido que já voltou `sem_resposta` termina na graça, os novos voltam na hora, sem entrar
  // na fila. Enfileirado atrás dele, um `navegar` ou `gravar_arquivo` que o bot já recebeu como falha rodaria minutos
  // depois, fora de hora (e cada um gastava 50 s do turno para falhar). Revisão 17: voltam `ocupado`, que não conta
  // para a saúde; com `sem_resposta`, três pedidos na graça tiravam o computador de todos os bots.
  if (atraso.emGraca > 0) {
    const r = { erro: 'ocupado', detalhe: 'a tela ainda termina um pedido anterior' };
    enviar({ tipo: 'resposta', id, ...r });
    return r;
  }
  const tarefa = Promise.resolve().then(fazer);
  const r = await responderNoPrazo(() => tarefa, ms, codigo);
  enviar({ tipo: 'resposta', id, ...r });
  if (r.erro !== 'sem_resposta') return r;
  atraso.emGraca += 1;
  try {
    const terminou = graca > 0 ? await comPrazo(tarefa.then(() => true, () => true), graca, false) : false;
    if (!terminou) await aoVencer();
  } finally {
    atraso.emGraca -= 1;
  }
  return r;
}


/** Revisão 14: o fechar da tela envenenada (uma ação passou do prazo) cabe no que sobra até o SIGKILL do supervisor. */
export const PRAZO_FECHAR_ENVENENADA_MS = 4000;

/**
 * Revisão 12: com o dock, a captura do bot traz o Chrome para a frente antes (o Terminal e os Arquivos da pessoa não
 * vão para o modelo). A da pessoa, não: ela vê pelo VNC o que escolheu ver.
 */
export function capturaTrazOChrome(dockDisponivel, pessoa) {
  return Boolean(dockDisponivel) && !pessoa;
}

/**
 * Revisão 13 do PR #600: fecha o Chrome e confirma que ele saiu. Vencido o prazo, mata (`matar`, o bwrap dele) e espera
 * de novo; se ainda não saiu, devolve false. Quem relança não abre um segundo Chrome no mesmo perfil sem essa
 * confirmação: as travas Singleton* do antigo são apagadas antes da abertura e os dois gravariam os mesmos bancos.
 */
/** O PID do pai (`/proc/<pid>/stat`, 4º campo depois do nome entre parênteses); null se não deu para ler. */
export async function paiDoProcesso(pid) {
  const stat = await readFile(`/proc/${pid}/stat`, 'utf8').catch(() => '');
  const depois = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
  const pai = Number.parseInt(depois[1] ?? '', 10);
  return Number.isInteger(pai) ? pai : null;
}

/** Revisão 14: se o processo `pid` ainda é um filho desta tela (um PID reaproveitado por outro processo não é). */
export async function filhoVivo(pid) {
  return (await paiDoProcesso(pid)) === process.pid;
}

/**
 * Revisão 14 do PR #600: espera o bwrap do Chrome anterior sumir antes de apagar as travas do perfil. O `close` do
 * Playwright vem da desconexão (a pessoa fechou a última janela pelo dock), não da saída do processo: sem esperar, o
 * novo abria enquanto o antigo ainda gravava o perfil. Vencido o prazo, mata e espera de novo; devolve se ele saiu.
 */
export async function esperarQueSaia(pid, { vivo = filhoVivo, matar = (x) => process.kill(x, 'SIGKILL'), prazoMs = PRAZO_FECHAR_CHROME_MS, passoMs = 100 } = {}) {
  if (!pid) return true;
  const esperar = async () => {
    for (const fim = Date.now() + prazoMs; Date.now() < fim;) {
      if (!(await vivo(pid))) return true;
      await new Promise((r) => setTimeout(r, passoMs));
    }
    return !(await vivo(pid));
  };
  if (await esperar()) return true;
  try { await matar(pid); } catch { /* já saiu */ }
  return esperar();
}

export async function fecharOuMatar(c, matar, prazoMs = PRAZO_FECHAR_CHROME_MS, prazoDepoisDeMatar = prazoMs) {
  const fechou = c.close().then(() => true, () => true);
  if (await comPrazo(fechou, prazoMs, false)) return true;
  await Promise.resolve(matar?.(c)).catch(() => {});
  return comPrazo(fechou, prazoDepoisDeMatar, false);
}

export function cicloDoChrome(abrir, { matar } = {}) {
  let atual = null;
  let abrindo = null;
  const soltos = new WeakSet();
  const iniciar = (antes) => {
    abrindo = (async () => {
      // Com prazo (revisão 11) e confirmação (revisão 13): o Chrome congelado é morto; o que nem morto sai faz o
      // relançamento falhar em vez de abrir dois Chromes no mesmo perfil.
      if (antes && !(await fecharOuMatar(antes, matar))) throw new Error('navegador_preso');
      const c = await abrir();
      // Fechou enquanto abria (depois do último await de `abrir`): um Chrome morto nunca fica publicado.
      if (soltos.has(c)) throw new Error('o Chrome fechou enquanto abria');
      atual = c;
      return c;
    })().finally(() => { abrindo = null; });
    return abrindo;
  };
  return {
    atual: () => atual,
    async garantir() {
      if (abrindo) return abrindo;
      if (atual) return atual;
      return iniciar(null);
    },
    async relancar(antigo) {
      if (abrindo) return abrindo;
      if (atual && atual !== antigo) return atual;
      atual = null;
      return iniciar(antigo);
    },
    soltar(c) {
      soltos.add(c);
      if (atual === c) atual = null;
    },
    async esperar() { await abrindo?.catch(() => {}); },
  };
}

/**
 * O que repor no Chrome relançado: a foto conhecida (o que esta tela mandou e recebeu por último), sem o que já
 * venceu. O perfil em disco pode estar até ~30 s atrasado depois de um crash; subir o diff dele contra a foto levaria um
 * token velho à loja com horário novo e deslogaria os outros bots (revisão 4 do PR #600). Repondo a foto antes, só o
 * que é de fato novo no perfil (chave que a foto não tem) vira diff. Quais chaves entram decide criarCookiesDaTela.
 */
export function cookiesDoRelancamento(conhecidos, agoraSeg) {
  return [...conhecidos].filter((c) => !(typeof c.expires === 'number' && c.expires > 0 && c.expires <= agoraSeg));
}

/**
 * PR #600 (revisões 4 a 7): os cookies de uma tela. Segura a foto que a loja conhece (`conhecidos`), os repasses que
 * chegaram com o Chrome fechado, o "Sair de todos" pendente e as lápides (chaves removidas, mandadas ou recebidas);
 * `c` é o contexto do Playwright (ou null, fechado). Tudo passa por uma fila: o `clearCookies` com filtro do Playwright
 * lê, apaga tudo e devolve o resto, e uma leitura no meio (a sincronia) mandaria à loja a remoção de todos os logins.
 *
 * Relançamento (a pessoa fechou a última janela pelo dock, ou o Chrome caiu): a foto do supervisor não volta.
 * - Chave do perfil com lápide e fora da foto: um logout que o disco não gravou; é apagada, não sobe.
 * - Chave do perfil e da foto: vence a de validade maior (o disco ~30 s atrasado depois de um crash não sobe token
 *   velho; o token renovado no fechamento limpo não é trocado pelo da foto).
 * - Cookie de sessão (sem validade) o Chrome nunca grava em disco: a falta não prova nada e ele volta da foto.
 * - Persistente que sumiu do perfil: não é reposto nem vira `removidos` (pode ser o Chrome que não gravou: não desloga
 *   os outros bots); a falta fica local. O logout que a pessoa faz com o Chrome aberto sobe pela sincronia periódica
 *   (`SINCRONIA_DE_COOKIES_MS`) ou ao fechar a última janela.
 * Só a chave nova (sem lápide) ou mais nova do perfil vira diff.
 */
export function ehCookieDeSessao(c) {
  return !(typeof c.expires === 'number' && c.expires > 0);
}

/** PR #600 (revisão 6): de quanto em quanto a tela aberta manda os cookies, para o logout pelo VNC não ficar só local. */
export const SINCRONIA_DE_COOKIES_MS = 10_000;
/** Revisão 8: quanto depois de uma navegação da aba os cookies sobem (o logout pelo VNC quase sempre navega). */
export const COOKIES_DEPOIS_DA_NAVEGACAO_MS = 1000;

/**
 * Revisão 8 do PR #600: junta as navegações de um intervalo num envio só. O primeiro `agendar` marca o envio para
 * `atrasoMs` depois; os seguintes até lá não marcam outro. Assim o logout de um cookie de sessão sobe em ~1 s, e não
 * só na sincronia de 10 s (a pessoa que sai e fecha o Chrome logo depois não o vê voltar no relançamento).
 */
export function criarAgendador({ atrasoMs, fazer, marcar = setTimeout, desmarcar = clearTimeout }) {
  let marcado = null;
  return {
    agendar() {
      if (marcado) return;
      marcado = marcar(() => { marcado = null; fazer(); }, atrasoMs);
      marcado?.unref?.();
    },
    parar() { if (marcado) desmarcar(marcado); marcado = null; },
  };
}

/** Teto de lápides por tela: as mais antigas saem primeiro. */
const TETO_DE_LAPIDES = 1000;

/**
 * Revisão 10 do PR #600: prazo de cada chamada de cookies ao Chrome. Um Chrome congelado (sem morrer) prendia a fila de
 * cookies e, atrás dela, a abertura do Chrome, as ações e o fechar da tela. Vencido, a operação falha como se o Chrome
 * tivesse morrido (o receber guarda para a abertura, o limpar limpa ao abrir, o mandar tenta na próxima rodada).
 */
export const PRAZO_DOS_COOKIES_MS = 5000;

/**
 * Revisão 15: o pior caso de `atual()` relançando o Chrome, somado dos prazos de cada passo: fechar o antigo (fechar e
 * matar) e, em até duas tentativas, esperar o processo anterior sair (esperar e matar), abrir (PRAZO_NAVEGADOR_MS),
 * preparar (máscara, cookies, página, xdotool, pendentes, diff) e, se falhar, fechar o meio aberto.
 */
// apagarCookiesNoChrome travado: as abas tentadas, a temporária (abrir e CDP), um envio, o detach e o fechar.
export const APAGAR_COOKIES_MS = (ABAS_TENTADAS_NO_CDP + 2 + 1 + 1 + 2) * PRAZO_DO_CDP_MS;
// aplicarPendentes: clearCookies, o apagar e o addCookies.
const PENDENTES_DOS_COOKIES_MS = 2 * PRAZO_DOS_COOKIES_MS + APAGAR_COOKIES_MS;
// aoAbrir: addCookies, cookies, o apagar dos enterrados, addCookies, os pendentes e a foto final.
const ABRIR_DOS_COOKIES_MS = 4 * PRAZO_DOS_COOKIES_MS + APAGAR_COOKIES_MS + PENDENTES_DOS_COOKIES_MS;
// prepararChrome: máscara, aoAbrir, nova página, as travas do dock (revisão 22), xdotool (4 s), os pendentes e o diff do
// relançamento (pendentes e foto).
export const PREPARO_DO_CHROME_MS = 2 * PRAZO_DO_CDP_MS + ABRIR_DOS_COOKIES_MS + 2 * PRAZO_DO_CDP_MS + 2 * PRAZO_DO_CDP_MS + 4000 + PENDENTES_DOS_COOKIES_MS + PENDENTES_DOS_COOKIES_MS + PRAZO_DOS_COOKIES_MS;
export const ORCAMENTO_DO_RELANCAMENTO_MS = 2 * PRAZO_FECHAR_CHROME_MS + 2 * (2 * PRAZO_FECHAR_CHROME_MS + PRAZO_NAVEGADOR_MS + PREPARO_DO_CHROME_MS + 2 * PRAZO_FECHAR_CHROME_MS);
/**
 * Revisão 16: o resto de uma ação depois do relançamento: o `goto` (20 s), o observar (títulos, captura, foco) e, no
 * `finally`, o diff de cookies e o de storage (um pendentes e a foto cada).
 */
export const RESTO_DA_ACAO_MS = 20_000 + 30_000 + 2 * (2 * PRAZO_DOS_COOKIES_MS + APAGAR_COOKIES_MS + PRAZO_DOS_COOKIES_MS);
/** Revisão 15: quanto a tela espera, depois de responder `sem_resposta`, antes de se dar por presa e sair. */
export const PRAZO_DE_GRACA_MS = ORCAMENTO_DO_RELANCAMENTO_MS + RESTO_DA_ACAO_MS;

export function criarCookiesDaTela({ fotoInicial = [], avisar, agora = Date.now, prazoMs = PRAZO_DOS_COOKIES_MS }) {
  const noPrazo = async (promessa) => {
    const r = await comPrazo(promessa, prazoMs, VENCEU);
    if (r === VENCEU) {
      promessa.catch?.(() => {});
      throw new Error('cookies_sem_resposta');
    }
    return r;
  };
  let conhecidos = new Map();
  const pendentes = new Map();
  const lapides = new Map();
  let limparAoAbrir = false;
  let iniciado = false;
  let fila = Promise.resolve();
  const foto = (lista) => new Map(lista.map((k) => [chaveDoCookie(k), k]));
  const idDe = (k) => ({ name: k.name, domain: k.domain, path: k.path });
  const enterrar = (k) => {
    const chave = chaveDoCookie(k);
    lapides.delete(chave);
    lapides.set(chave, idDe(k));
    if (lapides.size > TETO_DE_LAPIDES) lapides.delete(lapides.keys().next().value);
  };
  const emFila = (fn) => (...args) => {
    const r = fila.then(() => fn(...args));
    fila = r.catch(() => {});
    return r;
  };
  const validade = (k) => (ehCookieDeSessao(k) ? 0 : k.expires);

  async function aplicarPendentes(c) {
    // Só sai do pendente depois de aplicado (revisão 10): um Chrome que trava ou morre no meio não perde o Sair de todos
    // nem a remoção; repetir o que já entrou é inócuo.
    if (limparAoAbrir) {
      await noPrazo(c.clearCookies());
      limparAoAbrir = false;
    }
    const itens = [...pendentes];
    // Cada chave tem um item só (o Map): a ordem entre remoções e postos não importa.
    await apagarCookiesNoChrome(c, itens.filter(([, i]) => i.removido).map(([, i]) => i.id));
    const postos = itens.filter(([, i]) => !i.removido).map(([, i]) => i.cookie);
    if (postos.length) await noPrazo(c.addCookies(postos));
    for (const [chave, i] of itens) if (pendentes.get(chave) === i) pendentes.delete(chave);
  }

  async function aoAbrir(c) {
    const relancamento = iniciado;
    if (!relancamento && fotoInicial.length) await noPrazo(c.addCookies(fotoInicial));
    if (relancamento) {
      const perfil = foto(await noPrazo(c.cookies()));
      const enterrados = [...lapides].filter(([chave]) => perfil.has(chave) && !conhecidos.has(chave) && !pendentes.has(chave));
      await apagarCookiesNoChrome(c, enterrados.map(([, id]) => id));
      const repor = [];
      for (const k of cookiesDoRelancamento(conhecidos.values(), agora() / 1000)) {
        const noDisco = perfil.get(chaveDoCookie(k));
        if (noDisco ? validade(noDisco) <= validade(k) : ehCookieDeSessao(k)) repor.push(k);
      }
      if (repor.length) await noPrazo(c.addCookies(repor));
      for (const [chave, k] of [...conhecidos]) if (!perfil.has(chave) && !ehCookieDeSessao(k) && !pendentes.has(chave)) conhecidos.delete(chave);
    }
    await aplicarPendentes(c);
    if (!relancamento) conhecidos = foto(await noPrazo(c.cookies()));
    return relancamento;
  }

  async function mandar(c) {
    if (!c) return;
    // Revisão 11: um Chrome que venceu o prazo e voltou a responder ainda tem o que ficou pendente (o Sair de todos, a
    // remoção do repasse). Sem aplicar antes do diff, a foto divergia: o login removido voltava como posto e o Sair de
    // todos vencido reenviava todos os cookies. Se falhar, não manda nada (a próxima rodada tenta de novo).
    if (limparAoAbrir || pendentes.size) await aplicarPendentes(c);
    const atual = await noPrazo(c.cookies());
    const diff = diffDeCookies([...conhecidos.values()], atual);
    conhecidos = foto(atual);
    for (const r of diff.removidos) enterrar(r);
    for (const k of diff.postos) lapides.delete(chaveDoCookie(k));
    if (diff.postos.length || diff.removidos.length) avisar({ tipo: 'cookies', diff, em: agora() });
  }

  async function receber(c, { postos = [], removidos = [] }) {
    for (const r of removidos) enterrar(r);
    for (const k of postos) lapides.delete(chaveDoCookie(k));
    if (c) {
      try {
        await apagarCookiesNoChrome(c, removidos.map(idDe));
        for (const r of removidos) conhecidos.delete(chaveDoCookie(r));
        if (postos.length) await noPrazo(c.addCookies(postos));
        for (const k of postos) conhecidos.set(chaveDoCookie(k), k);
        return;
      } catch {
        // O Chrome morria (a última janela fechou e o contexto ainda não avisou): guarda para a abertura, senão a
        // remoção se perde e o relançamento ressuscitaria o login (revisão 6). Repetir o que já entrou é inócuo.
      }
    }
    for (const r of removidos) {
      pendentes.set(chaveDoCookie(r), { removido: true, id: idDe(r) });
      conhecidos.delete(chaveDoCookie(r));
    }
    for (const k of postos) {
      pendentes.set(chaveDoCookie(k), { removido: false, cookie: k });
      conhecidos.set(chaveDoCookie(k), k);
    }
  }

  async function limpar(c) {
    for (const k of conhecidos.values()) enterrar(k);
    if (c) {
      // O Chrome que morre no meio limpa ao abrir (revisão 8): o Sair de todos não se perde.
      try { await noPrazo(c.clearCookies()); } catch { limparAoAbrir = true; }
    } else limparAoAbrir = true;
    pendentes.clear();
    conhecidos = new Map();
  }

  return {
    /** Antes de publicar o Chrome que abriu. Devolve se é um relançamento. */
    aoAbrir: emFila(aoAbrir),
    /** O Chrome foi publicado: a próxima abertura é relançamento (uma 1ª abertura que falhou não conta). */
    publicado() { iniciado = true; },
    aplicarPendentes: emFila(aplicarPendentes),
    /** Manda ao supervisor o que mudou desde a foto conhecida. */
    mandar: emFila(mandar),
    /** Aplica o que outra tela mudou (repasse do supervisor); fechado, guarda para a abertura. Não volta como diff. */
    receber: emFila(receber),
    /** Sair de todos os sites: fechado, limpa ao abrir. */
    limpar: emFila(limpar),
    /** Depois do Sair de todos com o storage: na fila, não corre na frente de um mandar em curso (revisão 8). */
    esquecer: emFila(async () => { conhecidos = new Map(); }),
  };
}

/**
 * PR #600: o bwrap de uma peça da tela. Só o Xvfb (`pastaX11`) recebe a pasta dos sockets X, porque cria o dele; as
 * outras peças recebem só o socket desta tela. `comPerfil`: true = Chrome; 'workspace' = dock; false = Xvfb/openbox.
 */
export function argsDoBwrapDaTela(config, comPerfil, tmp = config.tmp, { pastaX11 = false, esconder = [] } = {}) {
  if (comPerfil === 'workspace') return argsDoBwrapDoDock(config, tmp);
  return argsDoBwrap({
    raiz: config.raiz, run: config.run, ocultar: config.ocultar, resolv: config.resolv, resolvEm: config.resolvEm, x11: config.x11,
    x11Display: pastaX11 ? undefined : config.display, esconder,
    ...(comPerfil === true
      ? { perfil: config.perfil, workspace: config.workspace, logins: config.logins, bus: config.bus, tmp }
      : { tmp }),
  });
}

/**
 * PR #600: o bwrap do dock e do que a pessoa abre por ele (Arquivos, Terminal). Só o workspace e a pasta privada do dock
 * (`pastaDoDock`); nunca o perfil do Chrome, os logins, o tmp da tela (com a `entrada`) nem o bus do keyring; do X, só
 * o socket desta tela; userns e capacidades explícitos (já são o padrão do bwrap sem setuid). O processo continua sendo o
 * nod-pc no host: o isolamento é o das montagens (risco registrado na ADR-138).
 */
/** PR #600 (revisão 6): o /tmp do dock (HOME e TMPDIR do Terminal e dos Arquivos) tem teto; o resto vai ao workspace. */
export const TETO_DO_TMP_DO_DOCK = 64 * 1024 * 1024;

export function argsDoBwrapDoDock(config, pastaDoDock) {
  return argsDoBwrap({
    raiz: config.raiz, run: config.run, ocultar: config.ocultar, resolv: config.resolv, resolvEm: config.resolvEm,
    x11: config.x11, x11Display: config.display, workspace: config.workspace, tmp: pastaDoDock, semUsuario: true,
    tamanhoDoTmp: TETO_DO_TMP_DO_DOCK, tmpSoLeitura: true,
  });
}

function teclaDoXdotool(k) {
  const nomes = { Control: 'ctrl', Meta: 'super', Enter: 'Return', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Space: 'space', Backspace: 'BackSpace', PageUp: 'Prior', PageDown: 'Next' };
  return k.split('+').map((x) => nomes[x] ?? x).join('+');
}

/** Caminho dentro do workspace (resolve symlinks); fora dele lança `caminho`. */
export async function caminhoNoWorkspace(raiz, c, novo = false) {
  const base = await realpath(raiz);
  const dentro = (p) => p === base || p.startsWith(base + path.sep);
  const absoluto = path.resolve(base, c);
  if (!dentro(absoluto)) throw new Error('caminho');
  if (novo) await mkdir(path.dirname(absoluto), { recursive: true });
  const resolvido = await realpath(absoluto).catch(async (e) => {
    if (!novo || e.code !== 'ENOENT') throw e;
    return path.join(await realpath(path.dirname(absoluto)), path.basename(absoluto));
  });
  if (!dentro(resolvido)) throw new Error('caminho');
  return resolvido;
}

/**
 * NOD-433: ler a marca e apagar não é atômico — a tela nova pode marcar o tmp entre os dois, e o `rm -r` levaria o
 * Xauthority dela. O tmp sai primeiro do lugar (rename atômico para um nome só desta tela) e a marca é conferida lá:
 * se a nova marcou no meio, ele volta para o lugar; senão, só então é apagado. `entre(fase)` é o gancho do teste da
 * corrida: 'lido' (marca conferida, tmp no lugar), 'movido' (tmp já fora do lugar) e 'devolvendo' (logo antes de cada
 * entrada voltar sem sobrescrever).
 */
/**
 * Revisão independente (PR 602): o tmp é gravável pelo Chrome no bwrap, então a marca pode ter sido plantada. Lê sem
 * seguir symlink e sem travar em FIFO: só um arquivo comum vale; o resto ('') não é desta tela. Sem marca: null.
 */
const MARCA_MAX = 64;
async function lerMarca(arquivo) {
  let h;
  try { h = await open(arquivo, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); } catch (e) { return e?.code === 'ENOENT' ? null : ''; }
  // Rodada 2: só os primeiros bytes (o token tem 32); a marca esparsa de GBs não entra inteira na memória do host.
  try {
    if (!(await h.stat()).isFile()) return '';
    const buf = Buffer.alloc(MARCA_MAX);
    const { bytesRead } = await h.read(buf, 0, MARCA_MAX, 0);
    return buf.subarray(0, bytesRead).toString('utf8');
  } catch { return ''; } finally { await h.close().catch(() => {}); }
}

export async function apagarTmpSeDesta(tmp, token, entre = async () => {}) {
  if (!tmpEhDesta(await lerMarca(path.join(tmp, 'dono')), token)) return false;
  await entre('lido');
  const lixo = `${tmp}.fechando-${token}`;
  if (!await rename(tmp, lixo).then(() => true, () => false)) return false;
  await entre('movido');
  if (tmpEhDesta(await lerMarca(path.join(lixo, 'dono')), token)) {
    await rm(lixo, { recursive: true, force: true }).catch(() => {});
    return true;
  }
  // QA (BUG-1): enquanto o tmp estava fora do lugar, a tela nova pode tê-lo recriado (o `mkdir -p` do dock) e o rename
  // de volta falha. Junta o conteúdo: o que a nova recriou fica (é o mais novo), o resto volta, e o lixo sai.
  if (!await rename(lixo, tmp).then(() => true, () => false)) {
    // A nova recriou o tmp enquanto ele estava fora (o `mkdir -p` do dock): devolve entrada por entrada, com `rename`
    // (socket, FIFO e symlink vão como estão; revisão r6). O que a nova já gravou de novo no lugar fica. Se algo não
    // voltar, o lixo fica no disco (`*.fechando-*`) em vez de levar junto o que a nova precisa.
    if (await devolverEntradas(lixo, tmp, entre)) await rm(lixo, { recursive: true, force: true }).catch(() => {});
  }
  return false;
}

/**
 * Move cada entrada do 1º nível de `de` para `para` sem sobrescrever o que a nova gravou. Diz se tudo voltou.
 * Revisão rodada 4 (PR 602): não entra em subpastas. As subpastas do tmp são graváveis pelo Chrome da tela nova, que
 * poderia trocar `tmp/x` por um symlink para fora entre a conferência e o `link`/`mkdir` dentro dela (que seguem o link
 * nos componentes do meio). Só o nome final em `para` é tocado, e nem `rename` nem `link` seguem o nome final.
 */
async function devolverEntradas(de, para, entre = async () => {}) {
  const entradas = await readdir(de, { withFileTypes: true }).catch(() => null);
  if (!entradas) return false;
  let tudo = true;
  for (const e of entradas) {
    const origem = path.join(de, e.name);
    const destino = path.join(para, e.name);
    await entre('devolvendo', destino);
    if (e.isDirectory()) {
      // A pasta volta inteira com `rename`. Se a nova já tem algo com esse nome (pasta com conteúdo, arquivo, link),
      // `rename` recusa (ENOTEMPTY/ENOTDIR/EISDIR) e vale o dela; a antiga fica no lixo. Sobre uma pasta vazia da nova o
      // `rename` troca uma pela outra, sem perder nada.
      if (!await rename(origem, destino).then(() => true, () => false)) tudo = false;
      continue;
    }
    // `link` é a operação sem-sobrescrita atômica para arquivo, symlink, FIFO e socket no mesmo tmp. Só depois de o
    // nome existir no destino a entrada antiga sai; EEXIST significa que a nova venceu a corrida.
    const ligou = await link(origem, destino).then(() => true, (erro) => erro?.code === 'EEXIST' ? false : null);
    if (ligou === true) await unlink(origem).catch(() => { tudo = false; });
    else if (ligou === null) tudo = false;
  }
  return tudo;
}
/**
 * NOD-433 sobre o #600: o dock e a captura moram ao lado do tmp (`vizinhosDoTmp`). Eles só saem junto quando o tmp era
 * desta tela e nenhuma tela nova marcou o lugar depois — a nova grava a marca antes de criar o dock, então com marca no
 * lugar os vizinhos já são dela. Diz se apagou.
 */
export async function apagarTmpEVizinhosSeDesta(tmp, token, entre = async () => {}) {
  if (!await apagarTmpSeDesta(tmp, token, entre)) return false;
  if (await lstat(path.join(tmp, 'dono')).then(() => true, () => false)) return true;
  for (const v of vizinhosDoTmp(tmp)) await rm(v, { recursive: true, force: true }).catch(() => {});
  return true;
}

/** NOD-433: o tmp é desta tela se a marca `dono` é dela; sem marca (tela de antes da marca), é. */
export function tmpEhDesta(dono, token) {
  return dono === null || dono.trim() === token;
}

/**
 * Uma tela viva. `config` (do supervisor): agenteId, display (número), raiz, run (a raiz do run, some no bwrap), ocultar
 * (outras pastas que somem no bwrap), resolv (o resolv.conf do stub, ou nada) e resolvEm (onde montá-lo), perfil, perfilBase, workspace, logins,
 * tmp, x11, bus (pasta) e busEndereco, bin {xvfb, openbox, chromium, bwrap (null = sem bwrap), xdotool, xclip, scrot, x11vnc},
 * sandbox (sandbox do Chromium), cookies (a loja aplicada na subida).
 */
export function criarTela(config, avisar) {
  const filhos = [];
  const quadros = new Map();
  let revision = randomBytes(32).toString('hex');
  let context = null;
  let page = null;
  let dialogo = null;
  /** Os cookies desta tela: a foto que a loja conhece, os repasses com o Chrome fechado e o Sair de todos pendente. */
  const cookies = criarCookiesDaTela({ fotoInicial: config.cookies ?? [], avisar: (m) => avisar(m) });
  /**
   * NOD-97 PR 4: o storage por origem. `versoes` (origem → { em, hash }) é o que este perfil já tem (mandou ou aplicou),
   * gravado no perfil para a próxima subida; `pendentes` é o que outra tela mandou e ainda não entrou (entra quando
   * esta tela navega para a origem e nenhuma aba está nela); `ritmo` segura a coleta a uma por origem a cada 10 s e
   * agenda a rodada do fim da janela para a coleta segurada não se perder.
   */
  const arquivoDeVersoes = path.join(config.perfil, 'nod-storage.json');
  let versoes = {};
  const pendentes = new Map();
  /**
   * NOD-97 PR 6 (QA do #515): toda origem que um frame desta tela abriu, com login rastreado ou não (o site que guarda a
   * sessão só em IndexedDB, sem cookie, também sai no Sair de todos). Gravada no perfil para valer depois de reabrir.
   */
  const arquivoDasOrigens = path.join(config.perfil, ARQUIVO_DAS_ORIGENS);
  let visitadas = new Set();
  // Em fila e atômica (gravadorEmFila): as gravações concorrentes de anotarOrigem/limparStorage corrompiam o arquivo.
  const gravarOrigens = gravadorEmFila(arquivoDasOrigens, () => JSON.stringify([...visitadas]));
  function anotarOrigem(url) {
    const o = origemDe(url);
    if (!o || visitadas.has(o) || visitadas.size >= TETO_DE_ORIGENS) return;
    visitadas.add(o);
    gravarOrigens();
  }
  const ritmo = ritmoDeColeta({ aoVencer: () => { mandarStorage().catch(() => {}); } });
  // NOD-97 PR 5: origens cujo preenchimento de senha já foi avisado, para não repetir o aviso a cada observação.
  const senhasAvisadas = new Set();
  const DISPLAY = `:${config.display}`;
  // O cookie do X fica no tmp desta tela (0600, some no bwrap das outras): só os filhos dela abrem o DISPLAY.
  const XAUTHORITY = path.join(config.tmp, 'Xauthority');
  const ambienteX = { ...process.env, DISPLAY, XAUTHORITY, DBUS_SESSION_BUS_ADDRESS: config.busEndereco ?? '', TMPDIR: config.tmp, HOME: path.join(config.perfil, '..', `casa-${config.agenteId}`) };
  const run = (bin, args, opcoes = {}) => exec(bin, args, { timeout: 25000, maxBuffer: 8 * 1024 * 1024, env: ambienteX, ...opcoes });
  const mudar = () => {
    revision = randomBytes(32).toString('hex');
    quadros.clear();
  };
  // `comPerfil`: true = o Chrome (perfil, workspace e logins); 'workspace' = o dock e o que a pessoa abre por ele (só o
  // workspace e a pasta privada do próprio dock); false = Xvfb e openbox, nada.
  // Só o Xvfb recebe a pasta dos sockets X (ele cria o dele); o resto, só o socket desta tela (PR #600).
  // Revisão 15: os programas do dock somem do bwrap do Chrome e do openbox (preenchido no subir, antes dos scripts).
  let soDoDock = [];
  const bwrapArgs = (comPerfil, tmp, opcoes) => argsDoBwrapDaTela(config, comPerfil, tmp, { ...opcoes, esconder: soDoDock });

  // NOD-96: os scripts do bwrap NÃO ficam no tmp: ele é o /run da unit (noexec no Debian 12: o spawn dá EACCES e o
  // Xvfb "não abre") e entra com escrita no bwrap da tela (o Chromium reescreveria o próprio lançador). Ficam em
  // `config.scripts`, sob a raiz dos computadores (exec, e some atrás do tmpfs dentro do bwrap).
  const pastaDosScripts = config.scripts ?? config.tmp;
  let dockDisponivel = false;
  let alturaDoChrome = 800;
  // Revisão 9 do PR #600: o lançador do dock (que pode relançar o Chrome e trocar a página) e a ação do bot numa fila só.
  let filaDaEntrada = Promise.resolve();
  function naFila(fn) {
    const r = filaDaEntrada.then(() => fn());
    filaDaEntrada = r.catch(() => {});
    return r;
  }
  async function noBwrap(nome, binario, comPerfil, tmp = config.tmp) {
    if (!config.bin.bwrap) return binario;
    await mkdir(pastaDosScripts, { recursive: true, mode: 0o700 });
    const script = path.join(pastaDosScripts, `${nome}.sh`);
    await writeFile(script, scriptDoBwrap({ bwrap: config.bin.bwrap, args: bwrapArgs(comPerfil, tmp, { pastaX11: nome === 'xvfb' }), binario, pidfile: nome === 'chromium' ? path.join(pastaDosScripts, 'chromium.pid') : null }), { mode: 0o700 });
    await chmod(script, 0o700);
    return script;
  }

  let erroAoIniciar = null;
  const watchers = [];
  function iniciar(bin, args, opcoes = {}) {
    const p = spawn(bin, args, { stdio: 'ignore', env: { ...ambienteX, ...(opcoes.env ?? {}) }, detached: true });
    // O erro do spawn (EACCES, ENOENT) vai no detalhe da falha: engolido, só restava "o Xvfb não abriu".
    p.on('error', (e) => { erroAoIniciar ??= `${path.basename(bin)}: ${e?.code ?? e?.message ?? e}`; });
    filhos.push(p);
    return p;
  }
  /** Uma peça do desktop que pode faltar na máquina (o dock): o erro do spawn não derruba a tela. */
  function iniciarOpcional(bin, args, opcoes = {}) {
    const p = spawn(bin, args, { stdio: 'ignore', env: { ...ambienteX, ...(opcoes.env ?? {}) }, detached: true });
    p.on('error', () => {});
    filhos.push(p);
    return p;
  }

  /**
   * NOD-410 (definido em 2026-10-30): o desktop com dock, como o do Grok. Fundo escuro (xsetroot) e o tint2 com três
   * lançadores — Chrome (traz a janela do Chrome para a frente; é o mesmo Chrome do bot), Arquivos (pcmanfm no workspace
   * do bot) e Terminal (xfce4-terminal no workspace) — mais as janelas abertas. O dock e o que a pessoa abre por ele rodam
   * no bwrap do desktop: só o workspace entra; o perfil do Chrome e os logins ficam fora. Sem tint2 na máquina, a tela
   * sobe sem dock.
   */
  async function subirDock() {
    dockDisponivel = await dockPossivel(config.bin);
    if (!dockDisponivel) return;
    const { pasta: pastaDoDock, rc, xauthority: xauthorityDoDock, pedidoDoChrome } = await prepararPastaDoDock(config, await readFile(XAUTHORITY));
    // Um toque gera mais de um evento e qualquer processo do sandbox pode tocar em rajada: um pedido por vez, no máximo a
    // cada 500 ms. O erro do watcher não derruba a tela.
    let ultimoToque = 0;
    let trazendo = false;
    const vigia = await vigiarFifo(pedidoDoChrome, () => {
      const agora = Date.now();
      if (trazendo || agora - ultimoToque < 500) return;
      ultimoToque = agora;
      trazendo = true;
      naFila(trazerChrome).catch(() => {}).finally(() => { trazendo = false; });
    });
    watchers.push(vigia);
    // HOME fora do workspace: um .bashrc/.config plantado pelo bot no workspace não roda no terminal da pessoa. HOME,
    // TMPDIR e cache no /tmp do bwrap do dock (tmpfs próprio com teto, TETO_DO_TMP_DO_DOCK), não na pasta do dock, que
    // fica no /run da máquina: um arquivo grande no Terminal enchia o /run de todos (revisão 6). A config (tint2, libfm)
    // vem da pasta do dock (XDG_CONFIG_HOME), só leitura no bwrap (revisão 10): ler vale, gravar falha sem efeito.
    const ambienteDoDock = { HOME: '/tmp', XAUTHORITY: xauthorityDoDock, TMPDIR: '/tmp', XDG_CONFIG_HOME: pastaDoDock, XDG_CACHE_HOME: '/tmp/cache', DBUS_SESSION_BUS_ADDRESS: '' };
    if (config.bin.xsetroot && await binarioDisponivel(config.bin.xsetroot)) iniciarOpcional(await noBwrap('xsetroot', config.bin.xsetroot, 'workspace', pastaDoDock), ['-solid', COR_DO_FUNDO], { env: ambienteDoDock });
    iniciarOpcional(await noBwrap('tint2', config.bin.tint2, 'workspace', pastaDoDock), ['-c', rc], { env: ambienteDoDock });
    // Só agora o Chrome cede os 48 px: se algo acima falhou, ele segue com a tela inteira.
    alturaDoChrome = 800 - DOCK_ALTURA;
  }

  const donoDoTmp = randomBytes(16).toString('hex');
  async function subir() {
    await mkdir(config.tmp, { recursive: true, mode: 0o700 });
    // 30/10 (NOD-433): a tela que fecha só apaga o tmp se ainda é dela. Num reinício do serviço, a tela nova (mesmo
    // agente, mesmo tmp) nascia enquanto a antiga ainda fechava, e o `rm` da antiga levava o Xauthority e o dock da nova.
    // Um token por instância (não o PID, que se repete entre reinícios); no mesmo supervisor, abrirTela espera o fechar.
    // Revisão independente (PR 602): a marca que sobrou (talvez plantada como symlink pelo Chrome da sessão de antes)
    // sai antes, e a nova nasce com O_EXCL, que não segue symlink: a gravação nunca cai fora do tmp (como o dock, ADR-138).
    // Rodada 2: `recursive` (a marca plantada como pasta travava a tela para sempre; o rm não segue symlink) e uma nova
    // tentativa se algo a recriou entre o rm e o O_EXCL (um Chrome que ainda não saiu).
    const marca = path.join(config.tmp, 'dono');
    for (let i = 0; ; i++) {
      await rm(marca, { recursive: true, force: true });
      try { await writeFile(marca, donoDoTmp, { mode: 0o600, flag: 'wx' }); break; } catch (e) { if (e?.code !== 'EEXIST' || i >= 2) throw e; }
    }
    // NOD-96: com PrivateTmp na unit, o /tmp nasce vazio e o bwrap não monta o /tmp/.X11-unix que não existe.
    await mkdir(config.x11, { recursive: true, mode: 0o1777 }).catch(() => {});
    await mkdir(ambienteX.HOME, { recursive: true, mode: 0o700 });
    await mkdir(config.workspace, { recursive: true });
    await forkDoPerfil(config.perfilBase, config.perfil);
    // NOD-97 PR 6: houve um Sair de todos enquanto esta tela estava fechada: o storage do perfil sai antes do Chrome.
    await aplicarGeracaoNoPerfil(config.perfil, config.geracao);
    // NOD-97 PR 5: as senhas salvas em comum entram no perfil ANTES do Chrome abrir (ele trava o Login Data em uso).
    // Falha de importação nunca impede a tela de subir: o login manual continua valendo.
    if (config.senhas) {
      try {
        importarNoPerfil(config.perfil, config.senhas);
      } catch {
        // falha de importação não impede a tela de subir: o login manual continua valendo
      }
    }
    const socketX = path.join(config.x11, `X${config.display}`);
    await unlink(socketX).catch(() => {});
    await writeFile(XAUTHORITY, arquivoXauthority(config.display), { mode: 0o600 });
    await chmod(XAUTHORITY, 0o600);
    soDoDock = await programasParaEsconder([config.bin.arquivos ?? 'pcmanfm', config.bin.terminalGrafico ?? 'xfce4-terminal', ...PROGRAMAS_SO_DO_DOCK]);
    iniciar(await noBwrap('xvfb', config.bin.xvfb, false), argsDoXvfb(config.display, XAUTHORITY, config.xvfbArgs ?? []));
    for (let i = 0; i < 100; i++) {
      if (await access(socketX).then(() => true, () => false)) break;
      if (i === 99 || erroAoIniciar) throw falhaDe('nao_iniciou', `o Xvfb não abriu${erroAoIniciar ? ` (${erroAoIniciar})` : ''}`);
      await esperar(100);
    }
    const cfg = path.join(config.tmp, 'openbox.xml');
    await writeFile(cfg, OPENBOX_XML);
    iniciar(await noBwrap('openbox', config.bin.openbox, false), ['--config-file', cfg]);
    // O dock é opcional (a tela sobe sem ele), mas a falha não pode sumir calada: foi assim que o QA do PR #600 achou
    // um dock que nunca subia com todos os testes verdes.
    await subirDock().catch((e) => {
      dockDisponivel = false;
      alturaDoChrome = 800;
      process.stderr.write(`[tela] o dock não subiu: ${e?.message ?? e}\n`);
    });
    await lancarChrome();
    await apagarTemporariosDasOrigens(config.perfil); // antes da 1ª gravação desta tela: só sobra de tela morta
    versoes = await readFile(arquivoDeVersoes, 'utf8').then((t) => JSON.parse(t), () => ({}));
    if (!versoes || typeof versoes !== 'object' || Array.isArray(versoes)) versoes = {};
    const lidas = await readFile(arquivoDasOrigens, 'utf8').then((t) => JSON.parse(t), () => []);
    visitadas = new Set((Array.isArray(lidas) ? lidas : []).filter((o) => typeof o === 'string' && origemDe(o) === o).slice(0, TETO_DE_ORIGENS));
    for (const p of context?.pages() ?? []) anotarOrigem(p.url());
    for (const item of config.storage ?? []) receberStorage(item);
    await aplicarPendentes(page, [...pendentes.keys()]).catch(() => {});
  }

  /**
   * Abre o Chrome da tela (o Playwright, no bwrap com o perfil). Também depois do primeiro: a pessoa pode fechar a
   * última janela pelo dock (30/10) e o Chrome morre com ela; a próxima ação do bot ou o lançador Chrome do dock o
   * relançam no mesmo perfil, com os logins em comum de novo.
   */
  let fechando = false;
  // Revisão 13: o PID do bwrap de cada Chrome (o script grava num pidfile), para matar o que não fecha.
  const pidDoChrome = new WeakMap();
  const arquivoDoPid = path.join(pastaDosScripts, 'chromium.pid');
  let ultimoPid = null;
  const matarChrome = (c) => {
    const pid = pidDoChrome.get(c);
    if (!pid) return;
    try { process.kill(pid, 'SIGKILL'); } catch { /* já saiu */ }
  };
  const ciclo = cicloDoChrome(() => abrirChrome(), { matar: matarChrome });
  async function abrirChrome() {
    await rodar(ganchos.antesDeAbrirChrome, config);
    // O Chrome antigo já saiu (cicloDoChrome só abre depois do close). As travas Singleton* dele apontam para um PID de
    // outro namespace do bwrap, que pode ser o do Chrome novo: sem apagar, ele acusaria perfil em uso (revisão 6).
    // Revisão 14: o `close` do dock vem da desconexão, e o processo pode seguir vivo gravando o perfil; espera (ou mata).
    if (!(await esperarQueSaia(ultimoPid))) throw falhaDe('navegador_preso', new Error('o Chrome anterior não saiu'));
    ultimoPid = null;
    for (const nome of TRAVAS_DO_PERFIL) await unlink(path.join(config.perfil, nome)).catch(() => {});
    await unlink(arquivoDoPid).catch(() => {});
    let c;
    try {
      // Importado só aqui: quem usa as funções puras deste arquivo (testes, supervisor) não precisa do playwright-core.
      const { chromium } = await import('playwright-core');
      c = await chromium.launchPersistentContext(config.perfil, {
        executablePath: await noBwrap('chromium', config.bin.chromium, true),
        headless: false, viewport: null, acceptDownloads: true, timeout: PRAZO_NAVEGADOR_MS,
        // NOD-96 (28/10): o Chromium cria o SingletonSocket em $TMPDIR/org.chromium.Chromium.XXXXXX/, e o caminho de um
        // socket unix tem teto de 108 bytes. O tmp da tela (/run/nod-computador-pc/<uuid>/telas/<uuid>) passa disso com os
        // ids reais e o Chrome morria ao abrir ("Socket path too long"). No bwrap o /tmp já é um tmpfs só desta tela.
        chromiumSandbox: config.sandbox !== false, env: { ...ambienteX, TMPDIR: '/tmp' },
        args: ['--password-store=gnome-libsecret', '--start-maximized', `--window-size=1280,${alturaDoChrome}`, '--window-position=0,0', '--disable-dev-shm-usage', '--disable-quic', '--autoplay-policy=no-user-gesture-required', '--test-type', '--hide-crash-restore-bubble', '--no-first-run', '--no-default-browser-check'],
      });
    } catch (e) {
      throw falhaDe('navegador_nao_abriu', e);
    }
    // Só vale o PID de um filho desta tela (conferência extra: o pidfile fica sob a raiz dos computadores, que o bwrap esconde, mas um PID reaproveitado não pode virar alvo): nunca mata outro processo.
    const pid = Number.parseInt(await readFile(arquivoDoPid, 'utf8').catch(() => ''), 10);
    if (Number.isInteger(pid) && pid > 1 && (await filhoVivo(pid))) { pidDoChrome.set(c, pid); ultimoPid = pid; }
    // Só vira `context` no fim, pronto (máscara de senha, cookies, página): antes disso, uma ação do bot ou o lançador do
    // dock esperam a abertura em curso em vez de agir numa aba sem a máscara (revisão do PR #600).
    try {
      return await prepararChrome(c);
    } catch (e) {
      // Um Chrome meio aberto não fica preso no perfil: o próximo pedido relança limpo. Com prazo (revisão 10): um Chrome
      // congelado não prende a abertura.
      await fecharOuMatar(c, matarChrome);
      throw e;
    }
  }

  async function prepararChrome(c) {
    let fechou = false;
    c.on('close', () => {
      fechou = true;
      ciclo.soltar(c);
      // O diálogo era do Chrome que caiu (revisão 10): não aparece no quadro do relançado.
      if (context === c) { context = null; dialogo = null; mudar(); }
    });
    c.setDefaultTimeout(15000);
    // NOD-97 PR 5: em toda página, esconde o que o Chrome preenche nos campos de senha (ver mascaraDeSenha).
    // Revisão 11: com prazo. Congelado aqui, o Chrome prendia a abertura e, atrás dela, a fila da entrada e o fechar.
    // Sem a máscara a abertura falha (o catch de abrirChrome fecha o Chrome): o bot nunca vê um campo de senha preenchido.
    if ((await comPrazo(c.addInitScript(mascaraDeSenha).then(() => true, () => true), PRAZO_DO_CDP_MS * 2, VENCEU)) === VENCEU) throw falhaDe('navegador_nao_abriu', 'o Chrome não respondeu ao abrir');
    // A foto do supervisor só entra na primeira abertura. Num relançamento, criarCookiesDaTela repõe só o que a tela
    // conhece e ainda existe no perfil (o logout feito pelo VNC não volta) e esquece o que sumiu.
    const relancamento = await cookies.aoAbrir(c);
    const primeira = c.pages()[0] ?? (await comPrazo(c.newPage(), PRAZO_DO_CDP_MS * 2, VENCEU));
    if (primeira === VENCEU) throw falhaDe('navegador_nao_abriu', 'o Chrome não abriu a página');
    if (dockDisponivel) {
      // Revisão 21: sem estas travas a abertura falha (fecha o Chrome): a página não lê a área de transferência que a
      // pessoa encheu no Terminal nem captura a tela inteira.
      const travou = async () => {
        await c.addInitScript(semCapturaDeTela);
        const navegador = c.browser();
        if (!navegador) throw new Error('sem a sessão do navegador');
        const cdp = await navegador.newBrowserCDPSession();
        // A sessão fica aberta enquanto o Chrome vive: o Chrome desfaz a negação quando ela é solta.
        await negarPermissoes(cdp);
        return true;
      };
      if ((await comPrazo(travou().catch(() => false), PRAZO_DO_CDP_MS * 2, false)) !== true) throw falhaDe('navegador_nao_abriu', 'o Chrome não aceitou as travas do dock');
    }
    await exec(config.bin.xdotool, ['search', '--onlyvisible', '--class', CLASSE_DO_CHROME, 'windowmove', '0', '0', 'windowsize', '1280', String(alturaDoChrome)], { timeout: 4000, env: ambienteX }).catch(() => {});
    c.pages().forEach(acompanhar);
    c.on('page', (p) => {
      acompanhar(p);
      page = p;
      mudar();
    });
    if (fechou) throw falhaDe('navegador_nao_abriu', 'o Chrome fechou enquanto abria');
    page = primeira;
    context = c;
    // Só aqui: uma primeira abertura que falhou antes não conta como relançamento (a foto do supervisor entra de novo).
    cookies.publicado();
    // O que o supervisor repassou durante a abertura ficou pendente (context ainda era null): entra agora.
    await cookies.aplicarPendentes(c).catch(() => {});
    // Relançado: só o que é novo no perfil vira diff (o valor velho do disco foi sobrescrito pelo conhecido).
    if (relancamento) await mandarCookies().catch(() => {});
    return c;
  }

  async function lancarChrome() {
    if (fechando) throw new Error('tela_fechando');
    await ciclo.garantir();
  }

  /** O lançador Chrome do dock: traz a janela do Chrome para a frente; sem janela (a pessoa fechou), relança o Chrome. */
  /** Antes da entrada do bot com o dock: o foco vai para o Chrome, nunca para o Terminal ou os Arquivos da pessoa. */
  async function focarChrome(p) {
    return focarJanelaDoChrome({
      listar: () => run(config.bin.xdotool, ['search', '--onlyvisible', '--class', CLASSE_DO_CHROME]).then((r) => r.stdout.split('\n'), () => []),
      ativa: () => run(config.bin.xdotool, ['getactivewindow']).then((r) => r.stdout.trim(), () => ''),
      trazer: () => comPrazo(p.bringToFront().catch(() => {}), PRAZO_DO_CDP_MS),
      ativar: (alvo) => run(config.bin.xdotool, ['windowactivate', '--sync', alvo], { timeout: 4000 }),
    });
  }

  async function trazerChrome() {
    if (!context) { await lancarChrome(); return; }
    const p = await atual();
    await comPrazo(p.bringToFront().catch(() => {}), PRAZO_DO_CDP_MS);
    await exec(config.bin.xdotool, ['search', '--onlyvisible', '--class', CLASSE_DO_CHROME, 'windowactivate'], { timeout: 4000, env: ambienteX }).catch(() => {});
  }

  function acompanhar(p) {
    p.on('framenavigated', (f) => {
      anotarOrigem(f.url());
      if (f === p.mainFrame()) { mudar(); cookiesDepoisDaNavegacao.agendar(); }
    });
    p.on('close', () => {
      mudar();
      // A pessoa fechou a última janela pelo dock: o que ela mudou pelo VNC (um logout, um login) sobe antes de o
      // Chrome cair, em melhor esforço (revisão 5 do PR #600). Depois o relançamento não repõe o que sumiu.
      const c = context;
      if (c && !fechando && c.pages().every((x) => x.isClosed())) void cookies.mandar(c).catch(() => {});
    });
    p.on('download', async (d) => {
      try {
        await d.saveAs(path.join(config.workspace, path.basename(d.suggestedFilename())));
      } catch {
        // falha de download fica visível no navegador, como no runtime
      }
    });
    p.on('dialog', (d) => {
      dialogo = d;
      mudar();
    });
  }

  async function atual() {
    const paginaAntes = page;
    const contextoAntes = context;
    const p = await atualSemMarcar();
    // Revisão 19: um Chrome relançado (ou outra aba no lugar da fechada) é outra tela; o quadro de antes não vale.
    if (p !== paginaAntes || context !== contextoAntes) mudar();
    return p;
  }

  async function atualSemMarcar() {
    // Revisão 9 do PR #600: o Chrome que cai logo depois de abrir zera o context; relança uma vez antes de desistir.
    for (let i = 0; i < 2 && !context; i++) await lancarChrome();
    if (!context) throw new Error('navegador_nao_abriu');
    if (page.isClosed()) {
      // A última janela acabou de fechar: o context pode estar morrendo antes de avisar; relança em vez de falhar a ação.
      page = context.pages().at(-1) ?? (await comPrazo(context.newPage().catch(() => null), PRAZO_DO_CDP_MS * 2));
      if (!page) {
        if (fechando) throw new Error('tela_fechando');
        // Fecha o Chrome antigo e espera ele sair ANTES de relançar: as travas Singleton* dele ficam noutro namespace e o
        // novo as julgaria velhas, abrindo dois Chromes no mesmo perfil.
        const antigo = context;
        context = null;
        await ciclo.relancar(antigo);
      }
    }
    return page;
  }

  /**
   * NOD-95 (ADR-138): a tela ao vivo. Sobe o x11vnc desta tela no 1º pedido, só num socket unix no tmp dela (sem porta
   * TCP: `-rfbport 0 -rfbportv6 0`, senão outra tela, que vê a rede, enxergaria esta), e o deixa até a tela fechar
   * (`filhos`). Fora do bwrap, como o scrot e o xdotool: fala com o Xvfb pelo cookie desta tela. Devolve o socket.
   */
  let vnc = null;
  const guardaDaSelecao = criarGuardaDaSelecao(async () => {
    for (const selecao of ['clipboard', 'primary']) await gravarSelecaoDoX(config.bin.xclip, selecao, '/dev/null', ambienteX);
  }, async () => {
    // A impressão das duas seleções. Vazia, o xclip sai com erro (vira ''); preso, o prazo vence e a guarda esvazia.
    const hash = createHash('sha256');
    for (const selecao of ['clipboard', 'primary']) {
      const r = await run(config.bin.xclip, ['-selection', selecao, '-o'], { timeout: 2000, encoding: 'buffer' }).catch((e) => {
        if (e?.killed || e?.code === 'ENOENT') throw e;
        return { stdout: Buffer.alloc(0) };
      });
      hash.update(selecao).update(String(r.stdout.length)).update(':').update(r.stdout);
    }
    return hash.digest('hex');
  });
  async function vivo() {
    guardaDaSelecao.pessoaMexeu();
    // O caminho de um socket unix tem teto de 108 bytes e o tmp da tela (run/<uuid>/telas/<uuid>) passa disso, como o
    // SingletonSocket do Chrome (NOD-96, 28/10). Fica no /tmp do serviço (PrivateTmp): o supervisor o alcança (mesma
    // unit) e as outras telas não (o /tmp delas no bwrap é outro).
    const sock = `/tmp/nod-vnc-${config.display}.sock`;
    if (!vnc || vnc.exitCode !== null) {
      await unlink(sock).catch(() => {});
      let erro = null;
      vnc = iniciar(config.bin.x11vnc, argumentosDoX11vnc(DISPLAY, XAUTHORITY, sock));
      vnc.on('error', (e) => { erro = e?.code ?? e?.message ?? String(e); });
      for (let i = 0; i < 50; i++) {
        if (await access(sock).then(() => true, () => false)) break;
        if (erro || vnc.exitCode !== null) throw falhaDe(erro === 'ENOENT' ? 'faltam_pacotes' : 'acao_falhou', `o x11vnc não abriu${erro ? ` (${erro})` : ''}`);
        if (i === 49) throw falhaDe('acao_falhou', 'o x11vnc não abriu o socket');
        await esperar(100);
      }
    }
    // A pessoa vai mexer sem passar pelas ações: a revisão que o bot conhecia não vale mais.
    mudar();
    return { socket: sock };
  }

  async function observar(pessoa = false) {
    const p = await atual();
    // Revisão 20: com o dock, a captura do bot mostra só a janela do Chrome; o resto (a faixa do dock com os títulos, o
    // Terminal e os Arquivos que a pessoa deixou abertos) vai preto. Sem a geometria, a tela inteira vai preta.
    const soOChrome = capturaTrazOChrome(dockDisponivel, pessoa);
    let geometria = null;
    if (soOChrome) {
      // Revisão 23: sem janela do Chrome (logo depois de um relançamento), a captura vai preta; a ação que já rodou não
      // volta como falha.
      const { janela } = await focarChrome(p).catch(() => ({ janela: null }));
      geometria = janela ? areaDoChrome(geometriaDaJanela(await run(config.bin.xdotool, ['getwindowgeometry', '--shell', janela]).then((r) => r.stdout, () => '')), alturaDoChrome) : null;
    }
    const png = caminhoDaCaptura(config.tmp);
    await run(config.bin.scrot, ['-o', png]);
    const crua = await readFile(png).finally(() => unlink(png).catch(() => {}));
    const imagem = soOChrome ? mascararForaDaJanela(crua, geometria) : crua;
    const quadro = randomBytes(32).toString('hex');
    quadros.set(quadro, { revision, em: Date.now() });
    for (const [id, q] of quadros) if (Date.now() - q.em > 120000 || quadros.size > 256) quadros.delete(id);
    const senhaPreenchida = await olharSenha(p);
    return {
      quadro, imagem: imagem.toString('base64'), largura: 1280, altura: 800, url: p.url(),
      titulo: dialogo ? 'Diálogo do navegador' : await comPrazo(p.title().catch(() => ''), PRAZO_DO_CDP_MS, ''),
      dialogo: dialogo ? { tipo: dialogo.type(), mensagem: dialogo.message() } : undefined,
      texto: dialogo ? dialogo.message() : (await p.locator('body').innerText({ timeout: 1000 }).catch(() => '')).slice(0, 12000),
      abas: await Promise.all((context?.pages() ?? [p]).map(async (t) => ({ url: t.url(), titulo: dialogo ? 'Navegador' : await comPrazo(t.title().catch(() => ''), PRAZO_DO_CDP_MS, ''), ativa: t === p }))),
      ...(senhaPreenchida ? { senhaPreenchida: { origem: senhaPreenchida } } : {}),
    };
  }

  /**
   * NOD-97 PR 5: a página tem um campo de senha preenchido pelo Chrome? Devolve a origem (uma vez por origem, para o
   * servidor avisar a pessoa no chat do bot) ou null. Nunca lê o valor: só pergunta se o autofill aconteceu.
   */
  async function olharSenha(p) {
    const origem = origemDe(p.isClosed() ? '' : p.url());
    // Re-QA do #515: com um diálogo aberto (beforeunload, alert) o evaluate só volta quando ele fecha, e o observar
    // travava sem mostrar o diálogo ao bot. Com diálogo não há o que olhar; aba travada também não segura o observar.
    if (!origem || dialogo) return null;
    const tem = await comPrazo(p.evaluate(temSenhaPreenchida).catch(() => false), 1000, false);
    if (!tem || senhasAvisadas.has(origem)) return null;
    senhasAvisadas.add(origem);
    return origem;
  }

  /** Manda ao supervisor o que mudou nos cookies desde a última foto conhecida. */
  const mandarCookies = () => cookies.mandar(context);
  // Com a pessoa no VNC, o que ela muda (um logout) chega à foto sem esperar uma ação do bot (revisão 6).
  const sincronia = setInterval(() => { if (context && !fechando) mandarCookies().catch(() => {}); }, SINCRONIA_DE_COOKIES_MS);
  sincronia.unref?.();
  const cookiesDepoisDaNavegacao = criarAgendador({ atrasoMs: COOKIES_DEPOIS_DA_NAVEGACAO_MS, fazer: () => { if (context && !fechando) mandarCookies().catch(() => {}); } });
  /** Aplica o que outra tela mudou (repasse do supervisor). A foto conhecida muda junto: não volta como diff. */
  const receberCookies = (diff) => cookies.receber(context, diff);

  const gravarVersoes = () => writeFile(arquivoDeVersoes, JSON.stringify(versoes), { mode: 0o600 }).catch(() => {});

  /**
   * Manda ao supervisor o storage das origens com login abertas nas abas (ou só nas `paginas`), se mudou: no máximo
   * uma vez a cada 10 s por origem, salvo `forcar`. A coleta de cada aba tem prazo (PRAZO_COLETA_MS): aba que não
   * responde fica de fora desta rodada, sem segurar a resposta da ação.
   */
  async function mandarStorage(forcar = false, paginas = null) {
    if (!context) return;
    const cookies = await comPrazo(context.cookies(), PRAZO_DOS_COOKIES_MS, VENCEU);
    if (cookies === VENCEU) throw new Error('cookies_sem_resposta');
    const vistas = new Set();
    let mudou = false;
    for (const p of paginas ?? context.pages()) {
      const origem = origemDe(p.isClosed() ? '' : p.url());
      if (!origem || vistas.has(origem)) continue;
      vistas.add(origem);
      if (!origemTemLogin(origem, cookies)) continue;
      if (!ritmo.liberar(origem, forcar)) continue;
      const dados = await comPrazo(p.evaluate(coletarNaPagina).catch(() => null), PRAZO_COLETA_MS);
      if (!dados) continue;
      const hash = hashDosDados(dados);
      if (versoes[origem]?.hash === hash) continue;
      if (Buffer.byteLength(JSON.stringify(dados)) > TETO_STORAGE_BYTES) continue;
      const em = Math.max(Date.now(), (versoes[origem]?.em ?? 0) + 1);
      versoes[origem] = { em, hash };
      pendentes.delete(origem);
      mudou = true;
      avisar({ tipo: 'storage', origem, em, hash, dados });
    }
    if (mudou) await gravarVersoes();
  }

  /** O supervisor repassou (ou trouxe na subida) a versão de uma origem: fica pendente se é mais nova que a daqui. */
  function receberStorage({ origem, em, hash, dados }) {
    if (!origemDe(origem) || typeof em !== 'number') return;
    const v = versoes[origem];
    if (v && (v.hash === hash || v.em >= em)) return;
    pendentes.set(origem, { em, hash, dados });
  }

  /**
   * Aplica numa aba as versões pendentes das origens pedidas: a aba vai a uma página vazia da origem (page.route, sem
   * passar pelo service worker do site, que poderia servir a página de verdade), restaura e volta a ficar sem rota.
   * Origem aberta em outra aba fica pendente: trocar o storage sob o site vivo o deixaria pela metade.
   */
  async function aplicarPendentes(p, origens) {
    const abertas = new Set(context.pages().filter((x) => !x.isClosed()).map((x) => origemDe(x.url())));
    const itens = origens.filter((o) => pendentes.has(o) && !abertas.has(o));
    if (!itens.length) return;
    const vazia = (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html></html>' }).catch(() => {});
    const cdp = await context.newCDPSession(p).catch(() => null);
    await cdp?.send('Network.setBypassServiceWorker', { bypass: true }).catch(() => {});
    await p.route('**/*', vazia);
    try {
      for (const origem of itens) {
        const item = pendentes.get(origem);
        try {
          await p.goto(`${origem}/`, { waitUntil: 'domcontentloaded', timeout: 10000 });
          // A versão guardada é a do que ficou na aba (o banco só deste perfil fica), para não haver ping-pong.
          versoes[origem] = { em: item.em, hash: await restaurarOrigem(p, item.dados) };
        } catch {
          // a origem que não restaura segue com o storage do perfil; a próxima versão tenta de novo
        }
        pendentes.delete(origem);
      }
    } finally {
      await p.unroute('**/*', vazia).catch(() => {});
      await cdp?.send('Network.setBypassServiceWorker', { bypass: false }).catch(() => {});
      await cdp?.detach().catch(() => {});
      await gravarVersoes();
    }
  }

  const limparCookies = () => cookies.limpar(context);

  /** NOD-97 PR 6 (Sair de todos os sites): esquece o storage em comum e apaga o das abas abertas. */
  async function limparStorage(geracao) {
    // Com o Chrome fechado pela pessoa (dock), o sairDasAbas não teria em quem apagar o storage e a geração ficaria
    // gravada como feita: o Chrome volta antes (revisão rodada 3 do PR #600).
    await ciclo.esperar();
    if (!context) {
      if (fechando) throw new Error('tela_fechando');
      await lancarChrome();
    }
    // As origens que este perfil conhece saem ANTES de zerar o índice: o CDP apaga também as que não estão numa aba, e as
    // visitadas cobrem o site que guarda a sessão só no storage, sem cookie de login (QA do #515).
    const origens = [...Object.keys(versoes), ...pendentes.keys(), ...visitadas];
    // Zera antes de sair das abas: as que voltam ao endereço em que estavam são anotadas de novo. Se a limpeza falha, as
    // origens voltam ao arquivo (revisão do #518): o próximo Sair de todos ainda precisa apagá-las.
    const antes = visitadas;
    visitadas = new Set();
    // O diálogo de beforeunload que estava aberto é aceito no sairDasAbas: a tela deixa de mostrá-lo.
    const pendente = dialogo?.type() === 'beforeunload' ? dialogo : null;
    if (pendente) { dialogo = null; mudar(); }
    try {
      // O diálogo que a ida a about:blank abre e o sairDasAbas aceita não fica na tela como se ainda estivesse aberto.
      await sairDasAbas(context, origens, pendente, (d) => { if (dialogo === d) { dialogo = null; mudar(); } });
    } catch (e) {
      visitadas = new Set([...antes, ...visitadas].slice(0, TETO_DE_ORIGENS));
      await gravarOrigens();
      throw e;
    }
    await gravarOrigens();
    await cookies.esquecer();
    versoes = {};
    pendentes.clear();
    await gravarVersoes();
    if (Number.isSafeInteger(geracao)) await gravarGeracaoDoPerfil(config.perfil, geracao);
  }

  /** A rolagem cai onde o ponteiro está: na faixa do dock, ele vai ao meio do Chrome antes (revisão 9 do PR #600). */
  async function ponteiroForaDoDock(geometriaDoChrome) {
    const r = await run(config.bin.xdotool, ['getmouselocation', '--shell']).catch(() => null);
    return argsParaRolarNoChrome(r?.stdout ?? '', alturaDoChrome, geometriaDoChrome);
  }

  const acao = (a, pessoa = false) => naFila(() => acaoSemFila(a, pessoa));

  async function acaoSemFila(a, pessoa) {
    const observado = quadros.get(a.quadro);
    if ('quadro' in a && !quadroVale(observado, revision, Date.now())) throw new Error('tela_alterada');
    const ws = (c, novo) => caminhoNoWorkspace(config.workspace, c, novo);
    if (a.tipo === 'arquivos') {
      const dir = await ws(a.caminho);
      const nomes = (await readdir(dir)).slice(0, 200);
      const base = await realpath(config.workspace);
      return { arquivos: await Promise.all(nomes.map(async (nome) => { const s = await stat(path.join(dir, nome)); return { nome, caminho: path.relative(base, path.join(dir, nome)), tamanho: s.size, diretorio: s.isDirectory() }; })) };
    }
    if (a.tipo === 'ler_arquivo') { const f = await ws(a.caminho); if ((await stat(f)).size > 524288) throw new Error('arquivo_grande'); return { arquivo: { nome: path.basename(f), base64: (await readFile(f)).toString('base64') } }; }
    if (a.tipo === 'ler_texto') return lerTexto(await ws(a.caminho), a.inicio, a.revisao);
    if (a.tipo === 'gravar_texto') return gravarTexto(await ws(a.caminho, true), a.texto, a.revisao);
    if (a.tipo === 'gravar_arquivo') { const f = await ws(a.caminho, true); await writeFile(f, Buffer.from(a.base64, 'base64')); return { saida: 'Arquivo gravado.' }; }
    // Revisão 19: os arquivos não precisam do Chrome (um Chrome preso não segura a leitura). E o `atual()` pode relançar o
    // Chrome: o quadro que o bot observou é de antes, então é conferido de novo (o clique não cai em outra página).
    const p = await atual();
    if ('quadro' in a && !quadroVale(observado, revision, Date.now())) throw new Error('tela_alterada');
    let janela = null;
    let geometriaDoChrome;
    // Revisão 23: só a entrada da pessoa conta; assistir (o observar a cada 2 s) não apaga o copiar e colar do bot.
    if (pessoa && ACOES_DE_ENTRADA.includes(a.tipo)) guardaDaSelecao.pessoaMexeu();
    const regraDoDock = regraDoDockVale(dockDisponivel, a, pessoa);
    if (regraDoDock) {
      if (tocaNoDock(a, alturaDoChrome)) throw new Error('fora_do_navegador');
      if (a.tipo === 'clicar' && !BOTOES_DO_BOT_COM_DOCK.includes(a.botao ?? 1)) throw new Error('botao_nao_permitido');
      const foco = await focarChrome(p);
      if (precisaObservarDeNovo(foco, a)) { mudar(); throw new Error('tela_alterada'); }
      janela = foco.janela;
      geometriaDoChrome = await run(config.bin.xdotool, ['getwindowgeometry', '--shell', janela]).then((r) => r.stdout, () => '');
      if (!pontosDoToque(a).every(([x, y]) => pontoNaJanela(geometriaDoChrome, x, y))) throw new Error('fora_do_navegador');
      // Revisão 27: a conferência da área de transferência é o último passo antes do xdotool (depois do foco e da
      // geometria), para a brecha até o ctrl+v do bot ser a menor possível.
      await guardaDaSelecao.antesDoBot();
    }
    const xdo = (args) => run(config.bin.xdotool, comFocoNoChrome(janela, args));
    switch (a.tipo) {
      case 'observar': break;
      case 'dialogo': { if (!dialogo) throw new Error('dialogo'); const d = dialogo; dialogo = null; mudar(); await comPrazo((a.aceitar ? d.accept(a.texto) : d.dismiss()).catch(() => {}), PRAZO_DO_CDP_MS, VENCEU); break; }
      // Antes de sair da origem atual, coleta o que ela tem agora (o login gravado dentro da janela de 10 s não se perde).
      case 'navegar': await rodar(ganchos.antesDeNavegar, a.url, config); await mandarStorage(true, [p]).catch(() => {}); await aplicarPendentes(p, [origemDe(a.url)].filter(Boolean)).catch(() => {}); mudar(); await p.goto(a.url, { waitUntil: 'domcontentloaded', timeout: 20000 }); await p.bringToFront(); break;
      case 'abas': if (a.aba !== undefined) { if (!context) await lancarChrome(); const aba = context?.pages()[a.aba]; if (!aba) throw new Error('aba'); page = aba; mudar(); await page.bringToFront(); } break;
      case 'clicar': mudar(); await xdo(['mousemove', '--sync', String(a.x), String(a.y), 'click', '--repeat', String(a.vezes ?? 1), String(a.botao ?? 1)]); break;
      case 'arrastar': mudar(); await xdo(['mousemove', '--sync', String(a.x), String(a.y), 'mousedown', '1', 'mousemove', '--sync', String(a.destinoX), String(a.destinoY), 'mouseup', '1']); break;
      case 'digitar': {
        mudar();
        const entrada = path.join(config.tmp, 'entrada');
        await writeFile(entrada, a.texto, { mode: 0o600 });
        await gravarSelecaoDoX(config.bin.xclip, 'clipboard', entrada, ambienteX);
        await xdo(['key', '--clearmodifiers', 'ctrl+v']);
        await esperar(150);
        await unlink(entrada);
        await gravarSelecaoDoX(config.bin.xclip, 'clipboard', '/dev/null', ambienteX);
        break;
      }
      case 'tecla': mudar(); await xdo(['key', '--clearmodifiers', teclaDoXdotool(a.tecla)]); break;
      case 'rolar': mudar(); await xdo([...(regraDoDock ? await ponteiroForaDoDock(geometriaDoChrome) : []), 'click', '--repeat', String(Math.max(1, Math.ceil(Math.abs(a.delta) / 100))), a.delta < 0 ? '4' : '5']); break;
      case 'anexar': mudar(); await p.locator('input[type=file]').first().setInputFiles(await ws(a.caminho)); break;
      default: throw new Error('acao');
    }
    // Revisão 24: como o bot deixou as seleções (a próxima ação dele confere se a pessoa copiou algo no meio).
    if (regraDoDock) await guardaDaSelecao.depoisDoBot();
    await esperar(100);
    return { tela: await observar(pessoa) };
  }

  async function fechar() {
    const inicioDoFechar = Date.now();
    fechando = true;
    clearInterval(sincronia);
    cookiesDepoisDaNavegacao.parar();
    // Com prazo (revisão 11): uma abertura presa num Chrome congelado não impede a tela de fechar.
    await comPrazo(ciclo.esperar(), ORCAMENTO_DO_FECHAR.esperarAbertura);
    // A última sincronia tem uma fatia só (revisão 12): com o Chrome congelado, o que não subiu fica para a próxima tela.
    ritmo.parar();
    await comPrazo((async () => {
      try {
        await mandarCookies();
      } catch { /* segue */ }
      try {
        await mandarStorage(true);
      } catch { /* segue */ }
    })(), ORCAMENTO_DO_FECHAR.sincronia);
    await rodar(ganchos.aoFecharChrome, config).catch(() => {});
    if (context) await fecharOuMatar(context, matarChrome, prazoParaFecharOChrome(Date.now() - inicioDoFechar), ORCAMENTO_DO_FECHAR.depoisDeMatar);
    for (const watcher of watchers) watcher.close();
    for (const p of filhos.reverse()) {
      try {
        process.kill(-p.pid, 'SIGTERM');
      } catch { /* segue */ }
    }
    await esperar(300);
    for (const p of filhos) {
      try {
        process.kill(-p.pid, 'SIGKILL');
      } catch { /* segue */ }
    }
    await apagarTmpEVizinhosSeDesta(config.tmp, donoDoTmp);
  }

  return {
    subir,
    observar,
    vivo,
    receberCookies,
    limparCookies,
    limparStorage,
    receberStorage,
    /** `pessoa`: a ação veio da pessoa no controle (revisão 10); sem ele, é do bot. */
    async executar(a, { pessoa = false } = {}) {
      try {
        const resultado = await acao(a, pessoa === true);
        await rodar(ganchos.depoisDaAcao, a, config);
        return resultado;
      } finally {
        await mandarCookies().catch(() => {});
        await mandarStorage().catch(() => {});
      }
    },
    fechar,
  };
}

/** O processo da tela: fala com o supervisor por IPC (process.send). */
async function principal() {
  let tela = null;
  const enviar = (m) => process.send?.(m);
  process.on('disconnect', async () => {
    await tela?.fechar().catch(() => {});
    process.exit(0);
  });
  // NOD-97 PR 4: o SIGTERM (supervisor parando, systemd) também fecha direito, para o storage e os cookies saírem.
  process.on('SIGTERM', async () => {
    await tela?.fechar().catch(() => {});
    process.exit(0);
  });
  // Revisão 14: um pedido passou do prazo e a fila da entrada está presa nele. Fecha com prazo (o que der do storage e
  // dos cookies) e sai; o supervisor vê o exit, marca a tela como fechada e a reabre na próxima ação.
  const atraso = { emGraca: 0 };
  const sairEnvenenada = async () => {
    await comPrazo(Promise.resolve(tela?.fechar()).catch(() => {}), PRAZO_FECHAR_ENVENENADA_MS, VENCEU);
    process.exit(0);
  };
  process.on('message', async (m) => {
    try {
      if (m.tipo === 'abrir') {
        tela = criarTela(m.config, enviar);
        try {
          await tela.subir();
          enviar({ tipo: 'pronta' });
        } catch (e) {
          enviar({ tipo: 'falhou', codigo: e?.codigo ?? 'nao_iniciou', detalhe: primeiraLinha(e?.message) });
        }
      } else if (m.tipo === 'acao') {
        await atenderNoPrazo(enviar, m.id, () => tela.executar(m.acao, { pessoa: m.pessoa === true }), PRAZO_DA_ACAO_NA_TELA_MS, { aoVencer: sairEnvenenada, graca: PRAZO_DE_GRACA_MS, atraso });
      } else if (m.tipo === 'vivo') {
        try {
          enviar({ tipo: 'resposta', id: m.id, resultado: await tela.vivo() });
        } catch (e) {
          enviar({ tipo: 'resposta', id: m.id, erro: e?.codigo ?? 'acao_falhou', detalhe: primeiraLinha(e?.message) });
        }
      } else if (m.tipo === 'repasse') {
        await tela?.receberCookies(m);
      } else if (m.tipo === 'storage') {
        tela?.receberStorage(m);
      } else if (m.tipo === 'limpar_cookies') {
        await atenderNoPrazo(enviar, m.id, async () => { await tela?.limparCookies(); return {}; }, PRAZO_LIMPAR_COOKIES_NA_TELA_MS, { aoVencer: sairEnvenenada, codigo: () => 'acao_falhou', graca: PRAZO_DE_GRACA_MS, atraso });
      } else if (m.tipo === 'limpar_storage') {
        await atenderNoPrazo(enviar, m.id, async () => { await tela?.limparStorage(m.geracao); return {}; }, PRAZO_LIMPAR_STORAGE_NA_TELA_MS, { aoVencer: sairEnvenenada, codigo: () => 'acao_falhou', graca: PRAZO_DE_GRACA_MS, atraso });
      } else if (m.tipo === 'fechar') {
        await tela?.fechar();
        enviar({ tipo: 'fechada' });
        process.exit(0);
      }
    } catch (e) {
      if (m.id) enviar({ tipo: 'resposta', id: m.id, erro: 'acao_falhou', detalhe: primeiraLinha(e?.message) });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.send) {
  // Os downloads (workspace/<bot>) nascem 0660/0770: o terminal, outro uid do grupo nod-pc-arquivos, lê e grava neles.
  // O perfil segue 0700 (mkdir com modo explícito), fora do alcance do terminal.
  process.umask(0o007);
  await principal();
}
