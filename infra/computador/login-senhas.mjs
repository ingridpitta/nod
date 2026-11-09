// definido em 2026-10-24 (NOD-97 PR 5, ADR-122 emenda): as credenciais salvas do Chrome em comum entre as telas.
// Cada tela guarda as credenciais no `Login Data` (SQLite) do perfil dela; o campo de valor fica cifrado pelo Safe
// Storage do keyring da máquina (v11, a mesma chave em todos os perfis: chaves.mjs). NINGUÉM aqui decifra esse campo: o
// supervisor copia as linhas como estão (BLOB em base64) para a loja `logins/principal/senhas.enc` (outra chave HKDF) e
// as põe no `Login Data` de um perfil antes do Chrome dele abrir. A exportação lê uma CÓPIA do arquivo com o journal
// vazio (Chrome parado); a importação só roda com o Chrome fechado.
import { Buffer } from 'node:buffer';
import { statSync } from 'node:fs';
import { copyFile, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { decifrar } from './chaves.mjs';
import { gravarLoja } from './loja-cookies.mjs';

export const arquivoDasSenhas = (logins) => path.join(logins, 'principal', 'senhas.enc');
export const loginDataDo = (perfil) => path.join(perfil, 'Default', 'Login Data');
/** As colunas que formam a linha única no Chrome (o UNIQUE da tabela `logins`). */
export const CHAVE_DA_SENHA = ['origin_url', 'username_element', 'username_value', 'password_element', 'signon_realm'];
/** O id é do arquivo de cada perfil: não viaja. */
const FORA = new Set(['id']);
export const senhasVazias = () => ({ versao: 1, em: 0, esquema: [], meta: [], linhas: {} });

export const chaveDaLinha = (l) => JSON.stringify(CHAVE_DA_SENHA.map((c) => l[c] ?? null));

/**
 * Um inteiro do `Login Data` como número para comparar. As datas do Chrome são microssegundos desde 1601 (~1,3e16),
 * acima de Number.MAX_SAFE_INTEGER: viajam como `{big: "..."}` (ver paraJson) e aqui viram Number, que perde só a
 * unidade (2 µs), irrelevante para o LWW.
 */
const numero = (v) => {
  if (v && typeof v === 'object' && typeof v.big === 'string') return Number(BigInt(v.big));
  return Number(v || 0);
};

/** O instante da linha para o LWW: a última troca; sem ela (linha antiga), a criação. */
export const instanteDaLinha = (l) => numero(l.date_password_modified) || numero(l.date_created);

function paraJson(v) {
  if (v instanceof Uint8Array) return { b64: Buffer.from(v).toString('base64') };
  if (typeof v === 'bigint') return Number.isSafeInteger(Number(v)) ? Number(v) : { big: v.toString() };
  return v;
}
function doJson(v) {
  if (v && typeof v === 'object' && typeof v.b64 === 'string') return Buffer.from(v.b64, 'base64');
  if (v && typeof v === 'object' && typeof v.big === 'string') return BigInt(v.big);
  return v;
}

/** O realm de uma URL como o Chrome grava ("https://site.com/"). Fora de http(s), null. */
export function realmDe(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? `${u.origin}/` : null;
  } catch {
    return null;
  }
}

/**
 * Lê um `Login Data` (de preferência a cópia parada). Devolve o esquema (SQL de `sqlite_master`, para criar o arquivo
 * num perfil novo), as linhas de `meta` e as de `logins` sem o id. Arquivo corrompido lança `login_data`.
 */
export function lerLoginData(arquivo) {
  const db = new DatabaseSync(arquivo, { readOnly: true });
  try {
    const ok = db.prepare('PRAGMA integrity_check').get();
    if (Object.values(ok ?? {})[0] !== 'ok') throw new Error('login_data');
    const esquema = db.prepare("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, rowid").all().map((r) => ({ type: r.type, name: r.name, sql: r.sql }));
    const meta = db.prepare('SELECT key, value FROM meta').all().map((r) => ({ key: r.key, value: r.value }));
    // setReadBigInts: sem ele, o node:sqlite lança RangeError nas datas do Chrome (acima de 2^53).
    const todas = db.prepare('SELECT * FROM logins');
    todas.setReadBigInts(true);
    const linhas = todas.all().map((r) => {
      const l = {};
      for (const [k, v] of Object.entries(r)) if (!FORA.has(k)) l[k] = paraJson(v);
      return l;
    });
    return { esquema, meta, linhas };
  } finally {
    db.close();
  }
}

/**
 * Tira uma cópia parada do `Login Data` de um perfil e a lê. Null se não há arquivo, se há journal com conteúdo (o
 * Chrome está no meio de uma escrita) ou se o arquivo mudou durante a cópia: a próxima exportação tenta de novo.
 */
export async function exportarDoPerfil(perfil, tmpDir) {
  const arquivo = loginDataDo(perfil);
  let antes;
  try { antes = await stat(arquivo); } catch { return null; }
  for (const sufixo of ['-journal', '-wal']) {
    const s = await stat(arquivo + sufixo).catch(() => null);
    if (s && s.size > 0) return null;
  }
  const copia = path.join(tmpDir, `login-data-${process.pid}-${Date.now()}`);
  try {
    await copyFile(arquivo, copia);
    const depois = await stat(arquivo);
    if (depois.mtimeMs !== antes.mtimeMs || depois.size !== antes.size) return null;
    return lerLoginData(copia);
  } catch {
    return null;
  } finally {
    await rm(copia, { force: true });
  }
}

/** Funde as linhas de um `Login Data` lido na loja (LWW por instante da linha). Devolve se algo mudou. */
export function fundirSenhas(loja, lido, agora) {
  let mudou = false;
  if (lido.esquema?.length && !loja.esquema?.length) { loja.esquema = lido.esquema; loja.meta = lido.meta ?? []; mudou = true; }
  for (const l of lido.linhas ?? []) {
    const chave = chaveDaLinha(l);
    const atual = loja.linhas[chave];
    if (atual && instanteDaLinha(atual.l) >= instanteDaLinha(l)) continue;
    loja.linhas[chave] = { l, em: agora };
    mudou = true;
  }
  return mudou;
}

/** A marca de um arquivo para saber se ele mudou: mtime + tamanho. Null se não existe. */
async function marcaDe(arquivo) {
  const s = await stat(arquivo).catch(() => null);
  return s ? `${s.mtimeMs}:${s.size}` : null;
}

/**
 * Lê a cópia parada do perfil e funde na loja cifrada. Serializado por quem chama (o supervisor, na fila). Devolve
 * 'gravou', 'igual', 'parado' ou 'sem_dados'. Com `marcas` (perfil → mtime:tamanho do último recolhido), um `Login
 * Data` que não mudou desde a última leitura nem é copiado ('parado'): a cópia + integrity_check sai de toda ação e
 * só roda quando o Chrome gravou algo. A marca só avança depois de uma leitura que deu certo (journal no meio = tenta
 * de novo na próxima).
 */
export async function recolherSenhas(arquivoLoja, chave, perfil, tmpDir, agora = Date.now(), marcas = null) {
  const marca = marcas ? await marcaDe(loginDataDo(perfil)) : null;
  if (marcas && (marca === null || marcas.get(perfil) === marca)) return marca === null ? 'sem_dados' : 'parado';
  const lido = await exportarDoPerfil(perfil, tmpDir);
  if (!lido) return 'sem_dados';
  marcas?.set(perfil, marca);
  const loja = await lerSenhas(arquivoLoja, chave);
  if (!fundirSenhas(loja, lido, agora)) return 'igual';
  loja.em = agora;
  await gravarLoja(arquivoLoja, chave, loja);
  return 'gravou';
}

/** Lê a loja de senhas cifrada; sem arquivo = vazia. Arquivo que não abre lança `senhas_invalidas`. */
export async function lerSenhas(arquivoLoja, chave) {
  let b;
  try {
    b = await readFile(arquivoLoja);
  } catch (e) {
    if (e.code === 'ENOENT') return senhasVazias();
    throw e;
  }
  try {
    const loja = JSON.parse(decifrar(chave, b));
    if (!loja || typeof loja !== 'object' || typeof loja.linhas !== 'object') throw new Error('forma');
    return { ...senhasVazias(), ...loja };
  } catch {
    throw new Error('senhas_invalidas');
  }
}

/**
 * Põe as senhas da loja no `Login Data` do perfil (upsert pela interseção de colunas, sem o id). Cria o arquivo pelo
 * esquema guardado se ele não existe. O Chrome tem que estar FECHADO. Sem linhas na loja, não mexe. Linha local com
 * instante igual ou mais novo (a pessoa trocou a senha neste perfil e ainda não foi recolhida) fica: o LWW vale também
 * na volta, não só na fusão da loja.
 */
export function importarNoPerfil(perfil, loja) {
  const chaves = Object.values(loja.linhas ?? {});
  if (!chaves.length) return 0;
  const arquivo = loginDataDo(perfil);
  const existe = (() => { try { return !!statSync(arquivo); } catch { return false; } })();
  const db = new DatabaseSync(arquivo);
  try {
    db.exec('PRAGMA journal_mode = DELETE');
    if (!existe && loja.esquema?.length) {
      for (const o of loja.esquema) db.exec(o.sql);
      for (const m of loja.meta ?? []) db.prepare('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)').run(m.key, m.value);
    }
    const colunasDaTabela = new Set(db.prepare('PRAGMA table_info(logins)').all().map((c) => c.name));
    const chaveNaTabela = CHAVE_DA_SENHA.filter((c) => colunasDaTabela.has(c));
    const instantes = ['date_password_modified', 'date_created'].filter((c) => colunasDaTabela.has(c));
    const local = chaveNaTabela.length && instantes.length
      ? db.prepare(`SELECT ${instantes.join(', ')} FROM logins WHERE ${chaveNaTabela.map((c) => `${c} IS ?`).join(' AND ')}`)
      : null;
    local?.setReadBigInts(true);
    let n = 0;
    for (const { l } of chaves) {
      const cols = Object.keys(l).filter((c) => colunasDaTabela.has(c) && !FORA.has(c));
      if (!cols.length) continue;
      const atual = local?.get(...chaveNaTabela.map((c) => doJson(l[c] ?? null)));
      if (atual && instanteDaLinha(atual) >= instanteDaLinha(l)) continue;
      const sql = `INSERT OR REPLACE INTO logins (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
      db.prepare(sql).run(...cols.map((c) => doJson(l[c])));
      n++;
    }
    return n;
  } finally {
    db.close();
  }
}

/**
 * Apaga a loja de senhas e, em todos os perfis dados, o `Login Data` e o `Login Data For Account` (a segunda loja do
 * Chrome, das senhas ligadas a uma conta) com journal/WAL (Esquecer senhas salvas). Os cookies ficam.
 */
export async function esquecerSenhas(arquivoLoja, perfis) {
  await rm(arquivoLoja, { force: true });
  for (const perfil of perfis) {
    for (const base of [loginDataDo(perfil), loginDataDo(perfil) + ' For Account']) {
      for (const sufixo of ['', '-journal', '-wal', '-shm']) await rm(base + sufixo, { force: true });
    }
  }
}
