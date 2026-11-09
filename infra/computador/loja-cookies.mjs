// definido em 2026-10-22 (NOD-96 PR 2, ADR-122 §2): a loja única de cookies do computador da pessoa. Dois Chromes
// no mesmo SQLite `Cookies` não é seguro; cada tela manda o diff depois da ação, o supervisor funde aqui (último a
// escrever por `em` — o lastAccess da tela — e a sequência do supervisor), grava atômico e repassa às outras telas.
// Remoção vira lápide, para um diff atrasado de outra tela não ressuscitar o cookie.
import { open, readFile, rename, stat, unlink, mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { setTimeout as esperar } from 'node:timers/promises';
import { cifrar, decifrar } from './chaves.mjs';

/** Lápides somem depois disto: um diff com mais de 30 dias de atraso não existe. */
export const VIDA_DA_LAPIDE_MS = 30 * 24 * 3_600_000;

export const lojaVazia = () => ({ versao: 1, seq: 0, entradas: {} });

/** A identidade do cookie no Chromium: nome, domínio, caminho e partição. */
export function chaveDoCookie(c) {
  return `${c.name}\u0000${c.domain}\u0000${c.path}\u0000${c.partitionKey ?? ''}`;
}

const idDoCookie = (c) => ({ name: c.name, domain: c.domain, path: c.path, ...(c.partitionKey ? { partitionKey: c.partitionKey } : {}) });
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const vencido = (c, agora) => typeof c.expires === 'number' && c.expires > 0 && c.expires * 1000 < agora;

/** O que mudou entre duas fotos de `context.cookies()`: os postos (novos ou alterados) e os removidos. */
export function diffDeCookies(antes, depois) {
  const velhos = new Map(antes.map((c) => [chaveDoCookie(c), c]));
  const novos = new Map(depois.map((c) => [chaveDoCookie(c), c]));
  const postos = [];
  const removidos = [];
  for (const [k, c] of novos) if (!velhos.has(k) || !igual(velhos.get(k), c)) postos.push(c);
  for (const [k, c] of velhos) if (!novos.has(k)) removidos.push(idDoCookie(c));
  return { postos, removidos };
}

/** (em, seq) de `a` vem depois de (em, seq) de `b`? */
const depoisDe = (a, b) => a.em > b.em || (a.em === b.em && a.seq > b.seq);

/**
 * Funde um diff na loja. `em` é o lastAccess da tela que mandou (o fim da ação dela). Devolve a loja nova e o diff
 * EFETIVO — só o que ganhou —, que é o que se repassa às outras telas. Não muda a loja recebida.
 */
export function fundir(loja, diff, em, agora = Date.now()) {
  const seq = loja.seq + 1;
  const entradas = { ...loja.entradas };
  const efetivo = { postos: [], removidos: [] };
  const marca = { em, seq };
  const vale = (k) => !entradas[k] || depoisDe(marca, entradas[k]);
  for (const c of diff.postos ?? []) {
    const k = chaveDoCookie(c);
    if (!vale(k)) continue;
    if (vencido(c, agora)) {
      if (entradas[k] && !entradas[k].removido) efetivo.removidos.push(idDoCookie(c));
      entradas[k] = { removido: true, id: idDoCookie(c), ...marca };
      continue;
    }
    if (entradas[k] && !entradas[k].removido && igual(entradas[k].cookie, c)) {
      entradas[k] = { ...entradas[k], ...marca };
      continue;
    }
    entradas[k] = { cookie: c, ...marca };
    efetivo.postos.push(c);
  }
  for (const id of diff.removidos ?? []) {
    const k = chaveDoCookie(id);
    if (!vale(k)) continue;
    if (entradas[k] && !entradas[k].removido) efetivo.removidos.push(idDoCookie(id));
    entradas[k] = { removido: true, id: idDoCookie(id), ...marca };
  }
  for (const [k, e] of Object.entries(entradas)) {
    if (e.removido && e.em < agora - VIDA_DA_LAPIDE_MS) delete entradas[k];
    else if (!e.removido && vencido(e.cookie, agora)) entradas[k] = { removido: true, id: idDoCookie(e.cookie), em: e.em, seq: e.seq };
  }
  return { loja: { versao: 1, seq, entradas }, efetivo };
}

/** Os cookies vivos da loja, para quem abre uma tela (`addCookies`). */
export function cookiesVivos(loja, agora = Date.now()) {
  return Object.values(loja.entradas).filter((e) => !e.removido && !vencido(e.cookie, agora)).map((e) => e.cookie);
}

/** Zera a loja (Sair de todos os sites): lápide para tudo o que estava vivo. */
export function zerar(loja, em, agora = Date.now()) {
  const vivos = cookiesVivos(loja, agora);
  return fundir(loja, { postos: [], removidos: vivos.map(idDoCookie) }, em, agora);
}

const ESPERA_TRAVA_MS = 5_000;
const TRAVA_VELHA_MS = 10_000;

/**
 * Fila do próprio processo, por trava. NOD-96 PR 5: sem ela, N escritas concorrentes do mesmo processo disputavam o
 * arquivo de trava por polling e a última esperava N × (escrita + fsync) — com fsync lento (CI) passava dos 5 s e
 * lançava `loja_travada` (o teste das 20 escritas falhava às vezes). Com a fila, dentro do processo a vez é por ordem
 * de chegada e sem prazo; o prazo de 5 s vale só para esperar OUTRO processo (a trava O_EXCL abaixo).
 */
const filas = new Map();

/** Trava por arquivo: fila no processo, depois O_EXCL entre processos. Devolve a função que solta. */
async function travar(arquivo) {
  const trava = `${arquivo}.lock`;
  const anterior = filas.get(trava) ?? Promise.resolve();
  let liberar;
  const minha = new Promise((r) => { liberar = r; });
  const cauda = anterior.then(() => minha);
  filas.set(trava, cauda);
  await anterior;
  let soltarArquivo;
  try {
    soltarArquivo = await travarArquivo(trava);
  } catch (e) {
    liberar();
    if (filas.get(trava) === cauda) filas.delete(trava);
    throw e;
  }
  return async () => {
    try {
      await soltarArquivo();
    } finally {
      liberar();
      if (filas.get(trava) === cauda) filas.delete(trava);
    }
  };
}

/** Trava entre processos (O_EXCL). Trava com mais de 10 s é de um processo que morreu: sai. */
async function travarArquivo(trava) {
  const limite = Date.now() + ESPERA_TRAVA_MS;
  for (;;) {
    try {
      const h = await open(trava, 'wx', 0o600);
      await h.writeFile(String(process.pid));
      await h.close();
      return async () => unlink(trava).catch(() => {});
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const s = await stat(trava).catch(() => null);
      if (s && Date.now() - s.mtimeMs > TRAVA_VELHA_MS) {
        await unlink(trava).catch(() => {});
        continue;
      }
      if (Date.now() > limite) throw new Error('loja_travada');
      await esperar(20);
    }
  }
}

/** Lê a loja cifrada; sem arquivo = vazia. Arquivo que não abre lança `loja_invalida` (nunca vira vazia em silêncio). */
export async function lerLoja(arquivo, chave) {
  let b;
  try {
    b = await readFile(arquivo);
  } catch (e) {
    if (e.code === 'ENOENT') return lojaVazia();
    throw e;
  }
  try {
    const loja = JSON.parse(decifrar(chave, b));
    if (!loja || typeof loja !== 'object' || typeof loja.seq !== 'number' || !loja.entradas) throw new Error('forma');
    return loja;
  } catch {
    throw new Error('loja_invalida');
  }
}

/** Grava atômico: trava, arquivo temporário com fsync, rename. */
export async function gravarLoja(arquivo, chave, loja) {
  await mkdir(path.dirname(arquivo), { recursive: true, mode: 0o700 });
  const soltar = await travar(arquivo);
  const tmp = `${arquivo}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  try {
    const h = await open(tmp, 'w', 0o600);
    try {
      await h.writeFile(cifrar(chave, JSON.stringify(loja)));
      await h.sync();
    } finally {
      await h.close();
    }
    await rename(tmp, arquivo);
  } catch (e) {
    await unlink(tmp).catch(() => {});
    throw e;
  } finally {
    await soltar();
  }
}

/**
 * Lê, funde e grava sob a mesma trava do arquivo: duas escritas (ou dois processos) não perdem o diff uma da outra.
 * `mudar(loja)` devolve `{ loja, efetivo }` (fundir ou zerar).
 */
export async function atualizarLoja(arquivo, chave, mudar) {
  await mkdir(path.dirname(arquivo), { recursive: true, mode: 0o700 });
  const soltar = await travar(`${arquivo}.rmw`);
  try {
    const { loja, efetivo } = mudar(await lerLoja(arquivo, chave));
    await gravarLoja(arquivo, chave, loja);
    return { loja, efetivo };
  } finally {
    await soltar();
  }
}
