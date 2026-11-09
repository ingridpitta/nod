// definido em 2026-10-22 (NOD-96 PR 2, ADR-122 §3 e §4): as chaves do computador por pessoa. Puro (só node:crypto):
// o supervisor usa para conferir e abrir; o servidor (PR 3) usa as mesmas funções para assinar e selar.
import {
  createCipheriv, createDecipheriv, createHmac, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync,
  hkdfSync, randomBytes, sign, verify,
} from 'node:crypto';
import { Buffer } from 'node:buffer';

/** Prefixos DER PKCS#8 de uma chave de 32 bytes crus (RFC 8410). */
const PKCS8_ED25519 = Buffer.from('302e020100300506032b657004220420', 'hex');
const SPKI_X25519 = Buffer.from('302a300506032b656e032100', 'hex');
const SPKI_ED25519 = Buffer.from('302a300506032b6570032100', 'hex');

const hexDaChave = (chave) => {
  if (!/^[a-f0-9]{64}$/i.test(chave ?? '')) throw new Error('chave_invalida');
  return Buffer.from(chave, 'hex');
};
const hkdf = (chave, info, tamanho = 32) => Buffer.from(hkdfSync('sha256', chave, Buffer.alloc(0), info, tamanho));

/** A chave da máquina (destrava o keyring), como no modo docker: HMAC(NOD_CREDENTIAL_KEY, "nod-computador:"+id), hex. */
export function chaveDaMaquina(credencial, computadorId) {
  return createHmac('sha256', hexDaChave(credencial)).update(`nod-computador:${computadorId}`).digest('hex');
}

/** A senha "Chromium Safe Storage": determinística, a mesma em todos os forks do perfil e depois de Atualizar/Redefinir. */
export function senhaSafeStorage(chaveMaquina) {
  return hkdf(hexDaChave(chaveMaquina), 'login:principal:chrome-safe-storage-v1').toString('base64');
}

/** A chave AES-256 da loja de cookies `logins/principal/cookies.enc`. */
export function chaveDaLoja(chaveMaquina) {
  return hkdf(hexDaChave(chaveMaquina), 'login:principal:cookies-v1');
}

/** NOD-97 PR 4: a chave AES-256 do storage por origem `logins/principal/storage/` (outra info, outra chave). */
export function chaveDoStorage(chaveMaquina) {
  return hkdf(hexDaChave(chaveMaquina), 'login:principal:storage-v1');
}

/** NOD-97 PR 5: a chave AES-256 da loja de senhas `logins/principal/senhas.enc` (outra info, outra chave). */
export function chaveDasSenhas(chaveMaquina) {
  return hkdf(hexDaChave(chaveMaquina), 'login:principal:senhas-v1');
}

/** Ed25519 do servidor para um computador: semente HKDF(NOD_CREDENTIAL_KEY, "nod-computador-assina:"+id). */
export function chavesDeAssinatura(credencial, computadorId) {
  const semente = hkdf(hexDaChave(credencial), `nod-computador-assina:${computadorId}`);
  const privada = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519, semente]), format: 'der', type: 'pkcs8' });
  const publica = createPublicKey(privada).export({ format: 'der', type: 'spki' }).subarray(SPKI_ED25519.length);
  return { privada, publica: publica.toString('base64') };
}

const publicaEd25519 = (b64) => {
  const crua = Buffer.from(String(b64 ?? ''), 'base64');
  if (crua.length !== 32) throw new Error('chave_invalida');
  return createPublicKey({ key: Buffer.concat([SPKI_ED25519, crua]), format: 'der', type: 'spki' });
};

/** JSON com as chaves em ordem, sem espaços e sem `undefined`: a forma que se assina. */
export function canonico(valor) {
  if (valor === null || typeof valor !== 'object') return JSON.stringify(valor);
  if (Array.isArray(valor)) return `[${valor.map((v) => (v === undefined ? 'null' : canonico(v))).join(',')}]`;
  const chaves = Object.keys(valor).filter((k) => valor[k] !== undefined).sort();
  return `{${chaves.map((k) => `${JSON.stringify(k)}:${canonico(valor[k])}`).join(',')}}`;
}

const semAssinatura = (comando) => {
  const { assinatura: _fora, ...resto } = comando;
  return resto;
};

/** Assina um ComandoComputador (sem o campo `assinatura`) e devolve o comando com ela. */
export function assinarComando(comando, privada) {
  const corpo = semAssinatura(comando);
  return { ...corpo, assinatura: sign(null, Buffer.from(canonico(corpo)), privada).toString('base64') };
}

/** Validade máxima de um comando (ADR-122 §4) e a folga de relógio aceita entre servidor e máquina. */
export const VALIDADE_COMANDO_MS = 2 * 60_000;
export const FOLGA_RELOGIO_MS = 30_000;

/**
 * Confere um comando: assinatura Ed25519 da chave pública `publicaB64`, `prazoMs` (epoch em ms até quando vale) no
 * máximo 2 min (+ folga) à frente e não vencido, e `id` ainda não visto. `vistos` é o Map id → prazo do anti-replay:
 * quem aceita grava nele. Devolve null se vale, ou o motivo.
 */
export function conferirComando(comando, publicaB64, vistos, agora = Date.now()) {
  if (!comando || typeof comando !== 'object' || typeof comando.assinatura !== 'string') return 'sem_assinatura';
  if (typeof comando.id !== 'string' || !comando.id) return 'comando_invalido';
  let valida = false;
  try {
    valida = verify(null, Buffer.from(canonico(semAssinatura(comando))), publicaEd25519(publicaB64), Buffer.from(comando.assinatura, 'base64'));
  } catch {
    valida = false;
  }
  if (!valida) return 'assinatura_invalida';
  if (typeof comando.prazoMs !== 'number' || !Number.isFinite(comando.prazoMs)) return 'comando_invalido';
  if (comando.prazoMs < agora) return 'vencido';
  if (comando.prazoMs > agora + VALIDADE_COMANDO_MS + FOLGA_RELOGIO_MS) return 'prazo_longo';
  for (const [id, prazo] of vistos) if (prazo < agora - FOLGA_RELOGIO_MS) vistos.delete(id);
  if (vistos.has(comando.id)) return 'repetido';
  vistos.set(comando.id, comando.prazoMs);
  return null;
}

/** Par X25519 novo do supervisor: a privada em PEM (fica no disco, 0600) e a pública crua em base64. */
export function novoParX25519() {
  const { privateKey } = generateKeyPairSync('x25519');
  return { privadaPem: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(), publica: publicaX25519(privateKey) };
}

export function publicaX25519(privada) {
  const chave = typeof privada === 'string' ? createPrivateKey(privada) : privada;
  return createPublicKey(chave).export({ format: 'der', type: 'spki' }).subarray(SPKI_X25519.length).toString('base64');
}

const INFO_SELO = 'nod-computador-selo-v1';

/**
 * Sela um texto para a chave pública X25519 do supervisor (ECIES: efêmera X25519 + HKDF-SHA256 + AES-256-GCM).
 * Formato, em base64: pública efêmera (32) | iv (12) | tag (16) | cifrado. A pública do destino entra no AAD.
 */
export function selar(publicaB64, texto) {
  const destino = Buffer.from(publicaB64, 'base64');
  if (destino.length !== 32) throw new Error('chave_invalida');
  const efemera = generateKeyPairSync('x25519');
  const publicaDestino = createPublicKey({ key: Buffer.concat([SPKI_X25519, destino]), format: 'der', type: 'spki' });
  const segredo = diffieHellman({ privateKey: efemera.privateKey, publicKey: publicaDestino });
  const pubEfemera = Buffer.from(publicaX25519(efemera.privateKey), 'base64');
  const chave = Buffer.from(hkdfSync('sha256', segredo, Buffer.concat([pubEfemera, destino]), INFO_SELO, 32));
  const iv = randomBytes(12);
  const cifra = createCipheriv('aes-256-gcm', chave, iv);
  cifra.setAAD(destino);
  const dados = Buffer.concat([cifra.update(Buffer.from(texto, 'utf8')), cifra.final()]);
  return Buffer.concat([pubEfemera, iv, cifra.getAuthTag(), dados]).toString('base64');
}

/** Abre o selo com a privada X25519 (PEM ou KeyObject). Selo adulterado ou para outra chave lança. */
export function abrirSelo(privada, selado) {
  const chavePrivada = typeof privada === 'string' ? createPrivateKey(privada) : privada;
  const b = Buffer.from(String(selado ?? ''), 'base64');
  if (b.length < 32 + 12 + 16) throw new Error('selo_invalido');
  const pubEfemera = b.subarray(0, 32);
  const destino = Buffer.from(publicaX25519(chavePrivada), 'base64');
  const segredo = diffieHellman({
    privateKey: chavePrivada,
    publicKey: createPublicKey({ key: Buffer.concat([SPKI_X25519, pubEfemera]), format: 'der', type: 'spki' }),
  });
  const chave = Buffer.from(hkdfSync('sha256', segredo, Buffer.concat([pubEfemera, destino]), INFO_SELO, 32));
  const decifra = createDecipheriv('aes-256-gcm', chave, b.subarray(32, 44));
  decifra.setAAD(destino);
  decifra.setAuthTag(b.subarray(44, 60));
  return Buffer.concat([decifra.update(b.subarray(60)), decifra.final()]).toString('utf8');
}

/** AES-256-GCM no formato do checkpoint de hoje: iv (12) | tag (16) | dados. */
export function cifrar(chave, texto) {
  const iv = randomBytes(12);
  const cifra = createCipheriv('aes-256-gcm', chave, iv);
  const dados = Buffer.concat([cifra.update(Buffer.from(texto, 'utf8')), cifra.final()]);
  return Buffer.concat([iv, cifra.getAuthTag(), dados]);
}

export function decifrar(chave, b) {
  const decifra = createDecipheriv('aes-256-gcm', chave, b.subarray(0, 12));
  decifra.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([decifra.update(b.subarray(28)), decifra.final()]).toString('utf8');
}
