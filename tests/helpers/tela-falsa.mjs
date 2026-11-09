// NOD-96 PR 7 (definido em 2026-10-22, ADR-122): a tela do supervisor sem Xvfb nem Chromium, para o e2e local.
// Fala o MESMO protocolo IPC de infra/computador/tela.mjs (abrir/pronta, acao/resposta, cookies, repasse,
// limpar_cookies, fechar/fechada) e guarda os cookies num pote em memória, como o contexto do Playwright faria.
//
// O "site" é a URL: `?entrar=nome:valor` grava o cookie no host (o login), `?sair=nome` apaga. A resposta de toda ação
// é a tela, com `texto` = os cookies do host atual em JSON — é assim que o teste vê se a tela está logada.
// NOD-97 PR 4: `?guardar=nome:valor` grava no localStorage da origem; a tela manda o storage da origem com login
// depois de cada ação (como mandarStorage), guarda o que o supervisor repassa e aplica ao navegar para a origem; a
// resposta traz `storage` = o localStorage da origem atual em JSON.
// NOD-97 PR 5: a resposta traz `senhas` = quantas senhas salvas a tela recebeu no config (só a contagem, nunca o valor).
// NOD_TELA_FALSA_ATRASO_MS segura o `pronta` (o boot lento); NOD_TELA_FALSA_ACAO_MS segura cada ação;
// NOD_TELA_FALSA_FECHAR_MS segura o `fechada`; NOD_TELA_FALSA_DIARIO anota abrir/fechar/fechada num arquivo.
// NOD_TELA_FALSA_LIMPAR_FALHA=cookies|storage faz o limpar_cookies ou o limpar_storage responder com erro (o CDP que
// falha na tela real), sem limpar.
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync } from 'node:fs';
import process from 'node:process';
import { setTimeout } from 'node:timers';
import { URL } from 'node:url';
import { chaveDoCookie, diffDeCookies } from '../../infra/computador/loja-cookies.mjs';
import { hashDosDados, origemDe, origemTemLogin } from '../../infra/computador/login-storage.mjs';

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const ATRASO_ABRIR = Number(process.env.NOD_TELA_FALSA_ATRASO_MS ?? 0);
const ATRASO_ACAO = Number(process.env.NOD_TELA_FALSA_ACAO_MS ?? 0);
/** NOD-433: segura o `fechada` (o Chrome que demora a sair), para a tela nova chegar com a antiga ainda fechando. */
const ATRASO_FECHAR = Number(process.env.NOD_TELA_FALSA_FECHAR_MS ?? 0);
/** Codex (PR 602): com NOD_TELA_FALSA_FECHAR_PORTAO=<arquivo>, o `fechada` só sai quando o teste cria o arquivo (sem corrida de relógio). */
const PORTAO_FECHAR = process.env.NOD_TELA_FALSA_FECHAR_PORTAO ?? '';
const LIMPAR_FALHA = process.env.NOD_TELA_FALSA_LIMPAR_FALHA ?? '';
/** NOD-433 (revisão r3): NOD_TELA_FALSA_DIARIO grava, uma linha JSON por evento, quando cada processo abre, recebe o fechar e responde fechada. */
const DIARIO = process.env.NOD_TELA_FALSA_DIARIO ?? '';
const anotar = (ev) => { if (DIARIO) appendFileSync(DIARIO, `${JSON.stringify({ pid: process.pid, agente: config?.agenteId ?? null, ev })}\n`); };
// NOD_TELA_FALSA_ERRO_DA_ACAO=<código> faz toda ação responder esse erro (o `ocupado` da graça, revisão 17 do PR #600).
const ERRO_DA_ACAO = process.env.NOD_TELA_FALSA_ERRO_DA_ACAO ?? '';

let config = null;
let url = 'about:blank';
/** chave do cookie → cookie (a forma do Playwright). */
let pote = new Map();
let conhecidos = new Map();
const enviar = (m) => process.send?.(m);
/** origem → [[nome, valor]] (o localStorage); versões que a tela tem e as pendentes, como na tela real. */
const storage = new Map();
let geracao = null;
const versoes = new Map();
const pendentes = new Map();

function mandarStorage() {
  const origem = origemDe(url);
  if (!origem || !origemTemLogin(origem, [...pote.values()])) return;
  const dados = { localStorage: storage.get(origem) ?? [], indexedDB: [], pulados: [] };
  const hash = hashDosDados(dados);
  if (versoes.get(origem)?.hash === hash) return;
  const em = Math.max(Date.now(), (versoes.get(origem)?.em ?? 0) + 1);
  versoes.set(origem, { em, hash });
  enviar({ tipo: 'storage', origem, em, hash, dados });
}

function receberStorage({ origem, em, hash, dados }) {
  const v = versoes.get(origem);
  if (v && (v.hash === hash || v.em >= em)) return;
  pendentes.set(origem, { em, hash, dados });
}

function host() {
  try { return new URL(url).hostname; } catch { return ''; }
}

function tela() {
  const h = host();
  const doHost = [...pote.values()].filter((c) => h && (c.domain === h || c.domain === `.${h}` || h.endsWith(c.domain))).map((c) => ({ name: c.name, value: c.value }));
  return {
    quadro: randomBytes(32).toString('hex'), imagem: 'iVBORw0KGgo=', largura: 1280, altura: 800, url, titulo: `${h || 'about:blank'} (${config?.agenteId})`,
    texto: JSON.stringify(doHost.sort((a, b) => a.name.localeCompare(b.name))), abas: [{ url, titulo: h, ativa: true }],
    storage: JSON.stringify(storage.get(origemDe(url)) ?? []),
    senhas: Object.keys(config?.senhas?.linhas ?? {}).length,
    // NOD-97 PR 6: a geração do storage em comum que este perfil aplicou (no config ao abrir ou no limpar_storage).
    geracao,
  };
}

/** Manda ao supervisor o que mudou desde a última foto (como mandarCookies da tela real). */
function mandarCookies() {
  const agora = [...pote.values()];
  const diff = diffDeCookies([...conhecidos.values()], agora);
  conhecidos = new Map(agora.map((c) => [chaveDoCookie(c), c]));
  if (diff.postos.length || diff.removidos.length) enviar({ tipo: 'cookies', diff, em: Date.now() });
}

function navegar(destino) {
  const u = new URL(destino);
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('url');
  const p = pendentes.get(u.origin);
  if (p && origemDe(url) !== u.origin) {
    storage.set(u.origin, p.dados.localStorage);
    versoes.set(u.origin, { em: p.em, hash: p.hash });
    pendentes.delete(u.origin);
  }
  url = u.toString();
  const guardar = u.searchParams.get('guardar');
  if (guardar) {
    const [nome, valor] = guardar.split(':');
    const ls = (storage.get(u.origin) ?? []).filter(([n]) => n !== nome);
    storage.set(u.origin, [...ls, [nome, valor]]);
  }
  const entrar = u.searchParams.get('entrar');
  if (entrar) {
    const [name, value] = entrar.split(':');
    const c = { name, value, domain: u.hostname, path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'Lax' };
    pote.set(chaveDoCookie(c), c);
  }
  const sair = u.searchParams.get('sair');
  if (sair) for (const [k, c] of pote) if (c.name === sair && c.domain === u.hostname) pote.delete(k);
}

process.on('disconnect', () => process.exit(0));
process.on('message', async (m) => {
  try {
    if (m.tipo === 'abrir') {
      config = m.config;
      anotar('abrir');
      geracao = config.geracao ?? null;
      for (const c of config.cookies ?? []) pote.set(chaveDoCookie(c), c);
      conhecidos = new Map(pote);
      for (const item of config.storage ?? []) receberStorage(item);
      await esperar(ATRASO_ABRIR);
      enviar({ tipo: 'pronta' });
    } else if (m.tipo === 'acao') {
      // Como na tela real (o finally de executar), os cookies saem ANTES da resposta.
      let resposta;
      if (ERRO_DA_ACAO) { enviar({ tipo: 'resposta', id: m.id, erro: ERRO_DA_ACAO, detalhe: 'tela falsa' }); return; }
      try {
        await esperar(ATRASO_ACAO);
        if (m.acao.tipo === 'navegar') navegar(m.acao.url);
        else if (m.acao.tipo !== 'observar') throw new Error('acao');
        resposta = { tipo: 'resposta', id: m.id, resultado: { tela: tela() } };
      } catch (e) {
        resposta = { tipo: 'resposta', id: m.id, erro: 'acao_falhou', detalhe: String(e?.message) };
      }
      mandarCookies();
      mandarStorage();
      enviar(resposta);
    } else if (m.tipo === 'repasse') {
      for (const r of m.removidos ?? []) { pote.delete(chaveDoCookie(r)); conhecidos.delete(chaveDoCookie(r)); }
      for (const c of m.postos ?? []) { pote.set(chaveDoCookie(c), c); conhecidos.set(chaveDoCookie(c), c); }
    } else if (m.tipo === 'storage') {
      receberStorage(m);
    } else if ((m.tipo === 'limpar_cookies' && LIMPAR_FALHA === 'cookies') || (m.tipo === 'limpar_storage' && LIMPAR_FALHA === 'storage')) {
      enviar({ tipo: 'resposta', id: m.id, erro: 'acao_falhou', detalhe: 'limpeza falhou (tela falsa)' });
    } else if (m.tipo === 'limpar_cookies') {
      pote = new Map();
      conhecidos = new Map();
      enviar({ tipo: 'resposta', id: m.id, resultado: {} });
    } else if (m.tipo === 'limpar_storage') {
      storage.clear();
      if (Number.isSafeInteger(m.geracao)) geracao = m.geracao;
      versoes.clear();
      pendentes.clear();
      enviar({ tipo: 'resposta', id: m.id, resultado: {} });
    } else if (m.tipo === 'fechar') {
      anotar('fechar');
      if (ATRASO_FECHAR) await esperar(ATRASO_FECHAR);
      if (PORTAO_FECHAR) while (!existsSync(PORTAO_FECHAR)) await esperar(10);
      mandarCookies();
      mandarStorage();
      anotar('fechada');
      enviar({ tipo: 'fechada' });
      setTimeout(() => process.exit(0), 20);
    }
  } catch (e) {
    if (m.id) enviar({ tipo: 'resposta', id: m.id, erro: 'acao_falhou', detalhe: String(e?.message) });
  }
});
