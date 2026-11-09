// definido em 2026-10-24 (NOD-97 PR 4, ADR-122 emenda): o storage por origem (localStorage e IndexedDB) em comum entre
// as telas, como os cookies da loja única. Só as origens "com login" (há cookie httpOnly vivo para o host) entram: o
// resto do storage fica no perfil de cada bot. A tela coleta na própria aba (coletarNaPagina) e manda ao supervisor;
// o supervisor cifra (AES-256-GCM, HKDF "login:principal:storage-v1") em `logins/principal/storage/<sha256(origem)>.enc`,
// guarda o índice `estado.enc` ({ geracao, versoes }) e repassa às outras telas. Último a escrever vence, por origem.
//
// Por que não `storageState`/`setStorageState` do Playwright: o primeiro abre uma aba escondida por origem já visitada a
// cada coleta, e o segundo limpa os cookies e o storage do contexto inteiro antes de aplicar. Os dois scripts de página
// abaixo seguem o formato de dados do StorageScript do Playwright 1.63, só por origem.
/* global window, atob, btoa, setTimeout, clearTimeout -- coletarNaPagina e restaurarNaPagina rodam na página (page.evaluate); os timers são os globais para o relógio falso dos testes */
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { URL } from 'node:url';
import { decifrar } from './chaves.mjs';
import { gravarLoja } from './loja-cookies.mjs';

/** Teto por origem (JSON dos dados): acima disso a origem não é compartilhada. */
export const TETO_STORAGE_BYTES = 5 * 1024 * 1024;
/** Uma coleta por origem a cada 10 s, no máximo (fora o fechamento da tela). */
export const INTERVALO_COLETA_MS = 10_000;
/** Prazo da coleta numa aba: página cujo `indexedDB.databases()` não resolve não segura a resposta da ação. */
export const PRAZO_COLETA_MS = 5_000;

/** A promessa, ou `seVencer` se ela não resolver em `ms` (o timer não segura o processo). */
export function comPrazo(promessa, ms, seVencer = null) {
  let t;
  const prazo = new Promise((ok) => {
    t = setTimeout(() => ok(seVencer), ms);
    t.unref?.();
  });
  return Promise.race([promessa, prazo]).finally(() => clearTimeout(t));
}

/**
 * O ritmo da coleta: uma por origem a cada `intervalo`. Coleta segurada pelo ritmo não se perde: agenda uma rodada
 * (`aoVencer`) para quando a janela da origem acabar, para o login gravado logo depois da última coleta sair mesmo que
 * nenhuma ação venha depois. `forcar` (antes de navegar e ao fechar) passa por cima do ritmo.
 */
export function ritmoDeColeta({ intervalo = INTERVALO_COLETA_MS, aoVencer, agora = Date.now }) {
  const coletadoEm = new Map();
  let timer = null;
  let vence = Infinity;
  const agendar = (ms) => {
    const quando = agora() + ms;
    if (timer && vence <= quando) return;
    if (timer) clearTimeout(timer);
    vence = quando;
    timer = setTimeout(() => {
      timer = null;
      vence = Infinity;
      aoVencer();
    }, ms);
    timer.unref?.();
  };
  return {
    /** true se a origem pode ser coletada agora (e marca o instante); senão agenda a rodada do fim da janela. */
    liberar(origem, forcar = false) {
      const falta = intervalo - (agora() - (coletadoEm.get(origem) ?? -Infinity));
      if (!forcar && falta > 0) {
        agendar(falta);
        return false;
      }
      coletadoEm.set(origem, agora());
      return true;
    },
    parar() {
      if (timer) clearTimeout(timer);
      timer = null;
      vence = Infinity;
    },
  };
}

export const pastaDoStorage = (logins) => path.join(logins, 'principal', 'storage');
export const arquivoDaOrigem = (pasta, origem) => path.join(pasta, `${createHash('sha256').update(origem).digest('hex')}.enc`);
const ESTADO = 'estado.enc';

/** A origem http(s) da URL, ou null. */
export function origemDe(url) {
  try {
    const u = new URL(url);
    return ['http:', 'https:'].includes(u.protocol) ? u.origin : null;
  } catch {
    return null;
  }
}

/** O host casa com o domínio do cookie (com ou sem o ponto da frente). */
export function hostCasa(host, dominio) {
  const d = String(dominio ?? '').replace(/^\./, '').toLowerCase();
  const h = String(host ?? '').toLowerCase();
  return d !== '' && (h === d || h.endsWith(`.${d}`));
}

/** A origem tem login quando o jar tem um cookie httpOnly vivo que vai para o host dela. */
export function origemTemLogin(origem, cookies, agora = Date.now()) {
  let host;
  try {
    host = new URL(origem).hostname;
  } catch {
    return false;
  }
  return (cookies ?? []).some((c) => c.httpOnly && (c.expires === undefined || c.expires === -1 || c.expires * 1000 > agora) && hostCasa(host, c.domain));
}

/**
 * O hash do conteúdo que se compartilha. `pulados` fica de fora: é o que este perfil tem e não sai dele (banco com
 * Blob), então muda de bot para bot sem que o conteúdo compartilhado mude; com ele no hash, o bot que recebe recoletava
 * com hash diferente e devolvia uma versão "mais nova" do mesmo conteúdo (ping-pong).
 */
export const hashDosDados = (dados) => {
  const { pulados: _pulados, ...compartilhado } = dados ?? {};
  return createHash('sha256').update(JSON.stringify(compartilhado)).digest('hex');
};
export const estadoVazio = () => ({ geracao: 0, versoes: {} });

/** LWW por origem: 'gravar', 'igual' (mesmo conteúdo) ou 'velho' (já há uma versão mais nova). */
export function decidir(estado, origem, em, hash) {
  const v = estado.versoes[origem];
  if (!v) return 'gravar';
  if (v.hash === hash) return 'igual';
  return em >= v.em ? 'gravar' : 'velho';
}

async function lerCifrado(arquivo, chave) {
  let b;
  try {
    b = await readFile(arquivo);
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
  try {
    return JSON.parse(decifrar(chave, b));
  } catch {
    throw new Error('storage_invalido');
  }
}

export async function lerEstado(pasta, chave) {
  const e = await lerCifrado(path.join(pasta, ESTADO), chave);
  if (!e) return estadoVazio();
  if (typeof e.geracao !== 'number' || !e.versoes || typeof e.versoes !== 'object') throw new Error('storage_invalido');
  return e;
}

/**
 * Grava a versão de uma origem se ela vence (LWW) e cabe no teto. Devolve o motivo: 'gravou', 'igual', 'velho' ou
 * 'grande'. Quem chama serializa (o supervisor, na fila da máquina): é o único que escreve aqui.
 */
export async function gravarOrigem(pasta, chave, { origem, em, hash, dados }) {
  if (!origemDe(origem) || origemDe(origem) !== origem || typeof em !== 'number') return 'velho';
  if (Buffer.byteLength(JSON.stringify(dados ?? null)) > TETO_STORAGE_BYTES) return 'grande';
  const estado = await lerEstado(pasta, chave);
  const d = decidir(estado, origem, em, hash);
  if (d !== 'gravar') return d;
  await gravarLoja(arquivoDaOrigem(pasta, origem), chave, { origem, em, hash, dados });
  estado.versoes[origem] = { em, hash };
  await gravarLoja(path.join(pasta, ESTADO), chave, estado);
  return 'gravou';
}

/**
 * Tudo o que está guardado (para a tela que abre). Origem ilegível fica de fora, sem derrubar as outras. A tela pode
 * abrir durante uma gravação (a leitura não entra na fila do supervisor): como a origem é gravada antes do índice, o
 * arquivo dela pode estar uma versão à frente do `estado.enc` lido, e essa versão mais nova vale.
 */
export async function lerTudo(pasta, chave) {
  const estado = await lerEstado(pasta, chave);
  const itens = [];
  for (const [origem, v] of Object.entries(estado.versoes)) {
    const item = await lerCifrado(arquivoDaOrigem(pasta, origem), chave).catch(() => null);
    if (item?.origem === origem && item.em >= v.em) itens.push({ origem, em: item.em, hash: item.hash, dados: item.dados });
  }
  return { geracao: estado.geracao, itens };
}

/** Apaga o storage guardado e sobe a geração (Sair de todos os sites). Devolve a geração nova. */
export async function limparStorage(pasta, chave) {
  const estado = await lerEstado(pasta, chave).catch(() => estadoVazio());
  const nomes = await readdir(pasta).catch(() => []);
  for (const n of nomes) if (n !== ESTADO && !n.startsWith(`${ESTADO}.`)) await rm(path.join(pasta, n), { force: true });
  const geracao = estado.geracao + 1;
  await gravarLoja(path.join(pasta, ESTADO), chave, { geracao, versoes: {} });
  return geracao;
}

/**
 * Roda na aba (page.evaluate): o localStorage e o IndexedDB da origem atual. Valor que não serializa (Blob, File,
 * CryptoKey, ciclo) tira o banco inteiro da coleta (`pulados`), para não restaurar um banco pela metade.
 */
export async function coletarNaPagina() {
  const b64 = (u8) => {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const cod = (v, vistos) => {
    if (v === undefined) return { v: 'undefined' };
    if (v === null || typeof v === 'boolean' || typeof v === 'string') return v;
    if (typeof v === 'number') {
      if (Number.isNaN(v)) return { v: 'NaN' };
      if (v === Infinity) return { v: 'Infinity' };
      if (v === -Infinity) return { v: '-Infinity' };
      if (Object.is(v, -0)) return { v: '-0' };
      return v;
    }
    if (typeof v === 'bigint') return { bi: String(v) };
    if (typeof v !== 'object') throw new Error('valor');
    if (v instanceof Date) return { d: v.getTime() };
    if (v instanceof RegExp) return { r: { p: v.source, f: v.flags } };
    if (v instanceof ArrayBuffer) return { ab: b64(new Uint8Array(v)) };
    if (ArrayBuffer.isView(v)) return { ta: { k: v.constructor.name, b: b64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) } };
    if (vistos.has(v)) throw new Error('ciclo');
    vistos.add(v);
    try {
      if (Array.isArray(v)) return { a: v.map((x) => cod(x, vistos)) };
      if (v instanceof Map) return { m: [...v].map(([k, x]) => [cod(k, vistos), cod(x, vistos)]) };
      if (v instanceof Set) return { s: [...v].map((x) => cod(x, vistos)) };
      const proto = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== null) throw new Error('valor');
      return { o: Object.keys(v).map((k) => [k, cod(v[k], vistos)]) };
    } finally {
      vistos.delete(v);
    }
  };
  const pedido = (r) => new Promise((ok, erro) => {
    r.onsuccess = () => ok(r.result);
    r.onerror = () => erro(r.error);
  });
  const localStorage = Object.keys(window.localStorage).map((n) => [n, window.localStorage.getItem(n)]);
  const indexedDB = [];
  const pulados = [];
  const bancos = (await window.indexedDB.databases?.().catch(() => [])) ?? [];
  for (const info of bancos) {
    if (!info.name) continue;
    let db;
    try {
      db = await pedido(window.indexedDB.open(info.name));
      const nomes = [...db.objectStoreNames];
      const lojas = [];
      if (nomes.length) {
        const tx = db.transaction(nomes, 'readonly');
        for (const nome of nomes) {
          const s = tx.objectStore(nome);
          const [chaves, valores] = await Promise.all([pedido(s.getAllKeys()), pedido(s.getAll())]);
          lojas.push({
            nome, keyPath: s.keyPath, autoIncrement: s.autoIncrement,
            indices: [...s.indexNames].map((n) => { const i = s.index(n); return { nome: n, keyPath: i.keyPath, unique: i.unique, multiEntry: i.multiEntry }; }),
            registros: valores.map((v, i) => (s.keyPath === null ? { k: cod(chaves[i], new Set()), v: cod(v, new Set()) } : { v: cod(v, new Set()) })),
          });
        }
      }
      indexedDB.push({ nome: info.name, versao: db.version, lojas });
    } catch {
      pulados.push(info.name);
    } finally {
      db?.close();
    }
  }
  return { localStorage, indexedDB, pulados };
}

/**
 * Roda na aba (page.evaluate), numa página vazia da origem: aplica a versão `dados` vinda de outro bot. A regra do
 * IndexedDB (ADR-122, emenda do PR 4) é "só troca o que veio": um banco é apagado e regravado só quando está em
 * `dados.indexedDB`. Banco deste perfil que não veio no snapshot (inclusive os `pulados` do outro bot) fica como está, e
 * banco em `manter` (os que este perfil não consegue coletar, ex.: com Blob; vêm de `coletarNaPagina` deste perfil)
 * não é apagado nem substituído, mesmo que o snapshot traga um de mesmo nome: a versão daqui ganha, porque não há como
 * devolvê-la depois. O `localStorage` da origem é trocado inteiro. Quem chama é `restaurarOrigem`.
 */
export async function restaurarNaPagina({ dados, manter: proprios } = {}) {
  const u8 = (b) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
  const tipos = { Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array, DataView };
  const dec = (v) => {
    if (v === null || typeof v !== 'object') return v;
    if ('v' in v) return { undefined, NaN, Infinity, '-Infinity': -Infinity, '-0': -0 }[v.v];
    if ('bi' in v) return BigInt(v.bi);
    if ('d' in v) return new Date(v.d);
    if ('r' in v) return new RegExp(v.r.p, v.r.f);
    if ('ab' in v) return u8(v.ab).buffer;
    if ('ta' in v) { const C = tipos[v.ta.k] ?? Uint8Array; return new C(u8(v.ta.b).buffer); }
    if ('a' in v) return v.a.map(dec);
    if ('m' in v) return new Map(v.m.map(([k, x]) => [dec(k), dec(x)]));
    if ('s' in v) return new Set(v.s.map(dec));
    if ('o' in v) { const o = {}; for (const [k, x] of v.o) if (k !== '__proto__') o[k] = dec(x); return o; }
    return undefined;
  };
  const pedido = (r) => new Promise((ok, erro) => {
    r.onsuccess = () => ok(r.result);
    r.onerror = () => erro(r.error);
  });
  const manter = new Set(proprios ?? []);
  const vindos = (dados?.indexedDB ?? []).filter((b) => !manter.has(b.nome));
  const trocar = new Set(vindos.map((b) => b.nome));
  for (const info of (await window.indexedDB.databases?.().catch(() => [])) ?? []) {
    if (info.name && trocar.has(info.name)) {
      await new Promise((ok) => { const r = window.indexedDB.deleteDatabase(info.name); r.onsuccess = r.onerror = r.onblocked = () => ok(); });
    }
  }
  for (const banco of vindos) {
    const abrir = window.indexedDB.open(banco.nome, banco.versao);
    abrir.onupgradeneeded = () => {
      for (const l of banco.lojas) {
        const s = abrir.result.createObjectStore(l.nome, { keyPath: l.keyPath ?? undefined, autoIncrement: l.autoIncrement });
        for (const i of l.indices) s.createIndex(i.nome, i.keyPath, { unique: i.unique, multiEntry: i.multiEntry });
      }
    };
    const db = await pedido(abrir);
    try {
      if (banco.lojas.length) {
        const tx = db.transaction(banco.lojas.map((l) => l.nome), 'readwrite');
        const fim = new Promise((ok, erro) => { tx.oncomplete = ok; tx.onerror = () => erro(tx.error); tx.onabort = () => erro(tx.error); });
        for (const l of banco.lojas) {
          const s = tx.objectStore(l.nome);
          for (const r of l.registros) {
            if ('k' in r) s.put(dec(r.v), dec(r.k));
            else s.put(dec(r.v));
          }
        }
        await fim;
      }
    } finally {
      db.close();
    }
  }
  window.localStorage.clear();
  for (const [n, v] of dados?.localStorage ?? []) window.localStorage.setItem(n, v);
}

/**
 * Aplica numa aba (já na página vazia da origem) a versão `dados` de outro bot. Coleta antes o que este perfil tem,
 * para proteger os bancos que ele não consegue coletar (`pulados` daqui), e depois de novo, para devolver o hash do que
 * ficou de fato: é esse o hash que a tela guarda como versão da origem. Com o hash do snapshot, um banco que ficou só
 * aqui faria a próxima coleta parecer mudança e o bot devolveria a versão (ping-pong). Sem a coleta local (prazo
 * vencido), não restaura: sem saber o que é só deste perfil, restaurar podia apagá-lo.
 */
export async function restaurarOrigem(pagina, dados, prazo = PRAZO_COLETA_MS) {
  const coletar = () => comPrazo(pagina.evaluate(coletarNaPagina), prazo);
  const local = await coletar();
  if (!local) throw new Error('coleta_local');
  await pagina.evaluate(restaurarNaPagina, { dados, manter: local.pulados });
  const depois = await coletar();
  if (!depois) throw new Error('coleta_local');
  return hashDosDados(depois);
}
