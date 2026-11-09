// definido em 2026-10-28 (NOD-365): a loja de logins do computador muda de máquina. A loja inteira (cookies, senhas e
// storage) fica em logins/principal e está cifrada com chaves derivadas do id do COMPUTADOR (chaves.mjs), não da
// máquina: os arquivos .enc vão como estão, em partes, pelo servidor, que nunca os decifra. Os arquivos do workspace
// não vão; a pasta antiga fica marcada com `.saiu-em` e a varredura a apaga depois de 30 dias.
import { Buffer } from 'node:buffer';
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** definido em 2026-10-28: a resposta do supervisor sobe pela ponte (1 MiB por corpo); 384 KiB crus viram ~512 KiB em base64. */
export const PARTE_BYTES = 384 * 1024;
/** definido em 2026-10-28: o storage tem teto de 5 MiB por origem; acima de 64 MiB a loja não muda de máquina (`loja_grande`). */
export const TETO_LOJA_BYTES = 64 * 1024 * 1024;
/** definido em 2026-10-28: a importação em partes que não termina em 10 min é descartada. */
export const VALIDADE_IMPORTACAO_MS = 10 * 60_000;
/** definido em 2026-10-28 (NOD-365): a pasta do computador que saiu desta máquina é apagada depois de 30 dias. */
export const PRAZO_SAIDA_MS = 30 * 24 * 60 * 60_000;
export const MARCA_SAIDA = '.saiu-em';
export const VERSAO_PACOTE = 1;

/** Os únicos nomes que entram no pacote e que a importação aceita (relativos a logins/principal). */
const NOME_VALIDO = /^(cookies\.enc|senhas\.enc|storage\/estado\.enc|storage\/[0-9a-f]{64}\.enc)$/;
export const nomeValido = (n) => typeof n === 'string' && NOME_VALIDO.test(n);

/** A pasta da loja e as pastas da troca, dentro de `logins`. */
const pastas = (logins) => ({ principal: path.join(logins, 'principal'), novo: path.join(logins, 'principal.novo'), velho: path.join(logins, 'principal.velho') });

/** Os arquivos da loja que vão na troca (temporários, travas e qualquer outro nome ficam). */
async function arquivosDaLoja(principal) {
  const nomes = [];
  for (const n of await readdir(principal).catch(() => [])) if (nomeValido(n)) nomes.push(n);
  for (const n of await readdir(path.join(principal, 'storage')).catch(() => [])) if (nomeValido(`storage/${n}`)) nomes.push(`storage/${n}`);
  return nomes.sort();
}

/** Empacota a loja: JSON `{ versao, arquivos: [{ nome, dados }] }`, com os .enc em base64. Lança `loja_grande` acima do teto. */
export async function empacotar(logins, teto = TETO_LOJA_BYTES) {
  const { principal } = pastas(logins);
  const arquivos = [];
  let total = 0;
  for (const nome of await arquivosDaLoja(principal)) {
    const f = path.join(principal, nome);
    // Só arquivo comum: um symlink plantado na pasta não leva outro arquivo da máquina junto.
    if (!(await lstat(f)).isFile()) continue;
    const dados = await readFile(f);
    total += dados.length;
    if (total > teto) throw Object.assign(new Error('a loja de logins passa do teto da troca'), { codigo: 'loja_grande' });
    arquivos.push({ nome, dados: dados.toString('base64') });
  }
  return Buffer.from(JSON.stringify({ versao: VERSAO_PACOTE, arquivos }));
}

/** O pacote em partes (base64), na ordem. Um pacote vazio ainda é uma parte. */
export function partir(pacote, tamanho = PARTE_BYTES) {
  const partes = [];
  for (let i = 0; i < pacote.length || i === 0; i += tamanho) partes.push(pacote.subarray(i, i + tamanho).toString('base64'));
  return partes;
}

/** Abre e confere o pacote: versão, nomes da lista, sem repetição. Lança `pacote_invalido`. */
export function desempacotar(pacote) {
  let p;
  try { p = JSON.parse(pacote.toString('utf8')); } catch { throw Object.assign(new Error('pacote ilegível'), { codigo: 'pacote_invalido' }); }
  if (!p || p.versao !== VERSAO_PACOTE || !Array.isArray(p.arquivos)) throw Object.assign(new Error('versão do pacote'), { codigo: 'pacote_invalido' });
  const vistos = new Set();
  return p.arquivos.map((a) => {
    if (!a || !nomeValido(a.nome) || vistos.has(a.nome) || typeof a.dados !== 'string') throw Object.assign(new Error(`arquivo recusado: ${String(a?.nome).slice(0, 80)}`), { codigo: 'pacote_invalido' });
    vistos.add(a.nome);
    return { nome: a.nome, dados: Buffer.from(a.dados, 'base64') };
  });
}

/**
 * Grava a loja importada no lugar da atual sem deixar a pasta pela metade: tudo vai para principal.novo; a atual vira
 * principal.velho; a nova vira principal; a velha sai. `recuperar` termina uma troca interrompida no meio.
 */
export async function gravarLoja(logins, arquivos) {
  const p = pastas(logins);
  await rm(p.novo, { recursive: true, force: true });
  await mkdir(path.join(p.novo, 'storage'), { recursive: true, mode: 0o700 });
  for (const a of arquivos) await writeFile(path.join(p.novo, a.nome), a.dados, { mode: 0o600 });
  await rm(p.velho, { recursive: true, force: true });
  await rename(p.principal, p.velho).catch((e) => { if (e?.code !== 'ENOENT') throw e; });
  await rename(p.novo, p.principal);
  await rm(p.velho, { recursive: true, force: true });
}

/** Termina a troca interrompida: sem principal, a velha (ou a nova completa) volta; as sobras saem. */
export async function recuperar(logins) {
  const p = pastas(logins);
  const existe = (f) => lstat(f).then(() => true, () => false);
  if (!(await existe(p.principal))) {
    // Caiu entre os dois renames: a nova já estava completa (só é renomeada depois de gravada).
    if (await existe(p.novo)) await rename(p.novo, p.principal);
    else if (await existe(p.velho)) await rename(p.velho, p.principal);
  }
  await rm(p.novo, { recursive: true, force: true });
  await rm(p.velho, { recursive: true, force: true });
}

/** Marca a pasta do computador como saída desta máquina (epoch em ms). */
export const marcarSaida = (pasta, agora) => writeFile(path.join(pasta, MARCA_SAIDA), String(agora), { mode: 0o600 });
export const desmarcarSaida = (pasta) => rm(path.join(pasta, MARCA_SAIDA), { force: true });
/** Desde quando a pasta saiu, ou null. */
export async function saiuEm(pasta) {
  const s = await readFile(path.join(pasta, MARCA_SAIDA), 'utf8').catch(() => null);
  const n = s === null ? NaN : Number(s.trim());
  return Number.isFinite(n) ? n : null;
}
/** A pasta saiu há 30 dias ou mais (e não antes). */
export const venceu = (desde, agora) => desde !== null && agora - desde >= PRAZO_SAIDA_MS;
