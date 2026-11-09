import { createCipheriv, createDecipheriv, createHmac, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes, sign, verify, type KeyObject } from "node:crypto";
import type { ComandoComputador } from "../../contracts/computador-motor.ts";
import { textoAssinado } from "../../domain/computador-canal.ts";

/**
 * A cripto do canal do computador no motor (definido em 2026-10-22, NOD-96 PR 3, ADR-122 item 4). Três coisas, todas a
 * partir de `NOD_CREDENTIAL_KEY` (hex de 64) e do id do computador, nada gravado:
 *
 * - **chave da máquina**: `HMAC-SHA256(chave, "nod-computador:"+id)`, a mesma do cofre do driver docker; desbloqueia o
 *   keyring único da máquina.
 * - **assinatura**: Ed25519 com semente `HKDF-SHA256(chave, sal vazio, "nod-computador-assina:"+id, 32)`, sobre a forma
 *   canônica do comando sem `assinatura` (domain/computador-canal.ts).
 * - **selo**: o segredo do `iniciar` vai para a X25519 do supervisor num envelope efêmero — `epk(32) ‖ iv(12) ‖ tag(16)
 *   ‖ cifra`, em base64; a chave AES-256-GCM é `HKDF-SHA256(ECDH(efêmera, supervisor), sal epk‖pub, "nod-computador-selo-v1", 32)`.
 *   O conteúdo selado é o JSON `{ "chaveMaquina": hex, "confia": base64 da Ed25519 pública }`: o supervisor fixa
 *   `confia` no primeiro boot (TOFU, `confia.pub`) e daí em diante só aceita comando assinado por ela.
 *
 * O supervisor (PR 2) implementa o lado de abrir; `abrirSelo` fica aqui para os testes e para o supervisor local.
 */

const PREFIXO_PKCS8_ED25519 = Buffer.from("302e020100300506032b657004220420", "hex");
const PREFIXO_SPKI_ED25519 = Buffer.from("302a300506032b6570032100", "hex");
const PREFIXO_PKCS8_X25519 = Buffer.from("302e020100300506032b656e04220420", "hex");
const PREFIXO_SPKI_X25519 = Buffer.from("302a300506032b656e032100", "hex");
const INFO_SELO = "nod-computador-selo-v1";

function chaveMestra(credencial: string): Buffer {
  if (!/^[a-f0-9]{64}$/i.test(credencial)) throw new Error("NOD_CREDENTIAL_KEY precisa ser hex de 64");
  return Buffer.from(credencial, "hex");
}

/** A senha do keyring da máquina (o mesmo cofre do driver docker). Hex de 64. */
export function chaveDaMaquina(credencial: string, computadorId: string): string {
  return createHmac("sha256", chaveMestra(credencial)).update(`nod-computador:${computadorId}`).digest("hex");
}

function chaveDeAssinatura(credencial: string, computadorId: string): KeyObject {
  const semente = Buffer.from(hkdfSync("sha256", chaveMestra(credencial), Buffer.alloc(0), `nod-computador-assina:${computadorId}`, 32));
  return createPrivateKey({ key: Buffer.concat([PREFIXO_PKCS8_ED25519, semente]), format: "der", type: "pkcs8" });
}

/** A Ed25519 pública deste computador, em base64 (32 bytes crus): o que o supervisor fixa em `confia.pub`. */
export function publicaDeAssinatura(credencial: string, computadorId: string): string {
  const der = createPublicKey(chaveDeAssinatura(credencial, computadorId)).export({ format: "der", type: "spki" });
  return der.subarray(PREFIXO_SPKI_ED25519.length).toString("base64");
}

/** O comando com a assinatura Ed25519 (base64) sobre a forma canônica do resto. */
export function assinarComando(credencial: string, c: Omit<ComandoComputador, "assinatura">): ComandoComputador {
  const assinatura = sign(null, Buffer.from(textoAssinado(c)), chaveDeAssinatura(credencial, c.computadorId)).toString("base64");
  return { ...c, assinatura };
}

/** O que o supervisor faz: confere a assinatura com a pública fixada (base64 de 32 bytes). */
export function conferirAssinatura(publica: string, c: ComandoComputador): boolean {
  const cru = Buffer.from(publica, "base64");
  if (cru.length !== 32) return false;
  const chave = createPublicKey({ key: Buffer.concat([PREFIXO_SPKI_ED25519, cru]), format: "der", type: "spki" });
  return verify(null, Buffer.from(textoAssinado(c)), chave, Buffer.from(c.assinatura, "base64"));
}

function publicaX25519(base64: string): { cru: Buffer; chave: KeyObject } {
  const cru = Buffer.from(base64, "base64");
  if (cru.length !== 32) throw new Error("chave X25519 inválida");
  return { cru, chave: createPublicKey({ key: Buffer.concat([PREFIXO_SPKI_X25519, cru]), format: "der", type: "spki" }) };
}

function chaveDoSelo(compartilhado: Buffer, epk: Buffer, pub: Buffer): Buffer {
  return Buffer.from(hkdfSync("sha256", compartilhado, Buffer.concat([epk, pub]), INFO_SELO, 32));
}

/** Sela `dados` para a X25519 do supervisor (base64 de 32 bytes). Cada selo tem efêmera e iv próprios. */
export function selar(supervisorPub: string, dados: Buffer): string {
  const destino = publicaX25519(supervisorPub);
  const efemera = generateKeyPairSync("x25519");
  const epk = efemera.publicKey.export({ format: "der", type: "spki" }).subarray(PREFIXO_SPKI_X25519.length);
  const chave = chaveDoSelo(diffieHellman({ privateKey: efemera.privateKey, publicKey: destino.chave }), epk, destino.cru);
  const iv = randomBytes(12);
  const cifra = createCipheriv("aes-256-gcm", chave, iv);
  // NOD-96 PR 7 (definido em 2026-10-22): a pública do destino entra no AAD, como no supervisor (infra/computador/chaves.mjs);
  // sem ela a tag do GCM não batia e todo `iniciar` voltava `cofre_invalido`.
  cifra.setAAD(destino.cru);
  const corpo = Buffer.concat([cifra.update(dados), cifra.final()]);
  return Buffer.concat([epk, iv, cifra.getAuthTag(), corpo]).toString("base64");
}

/** O segredo do `iniciar`: a chave da máquina e a Ed25519 pública que o supervisor deve fixar. */
export function seloDoIniciar(credencial: string, computadorId: string, supervisorPub: string): string {
  return selar(supervisorPub, Buffer.from(JSON.stringify({ chaveMaquina: chaveDaMaquina(credencial, computadorId), confia: publicaDeAssinatura(credencial, computadorId) })));
}

/** Um par X25519 cru (base64), como o supervisor gera no primeiro boot. Para testes e o supervisor local. */
export function gerarParX25519(): { privada: string; publica: string } {
  const par = generateKeyPairSync("x25519");
  return {
    privada: par.privateKey.export({ format: "der", type: "pkcs8" }).subarray(PREFIXO_PKCS8_X25519.length).toString("base64"),
    publica: par.publicKey.export({ format: "der", type: "spki" }).subarray(PREFIXO_SPKI_X25519.length).toString("base64"),
  };
}

/** O lado do supervisor: abre o selo com a X25519 privada (base64 de 32 bytes). Lança se não for para ela. */
export function abrirSelo(privada: string, selo: string): Buffer {
  const chavePrivada = createPrivateKey({ key: Buffer.concat([PREFIXO_PKCS8_X25519, Buffer.from(privada, "base64")]), format: "der", type: "pkcs8" });
  const pub = createPublicKey(chavePrivada).export({ format: "der", type: "spki" }).subarray(PREFIXO_SPKI_X25519.length);
  const bruto = Buffer.from(selo, "base64");
  if (bruto.length < 32 + 12 + 16) throw new Error("selo curto");
  const epk = bruto.subarray(0, 32);
  const iv = bruto.subarray(32, 44);
  const tag = bruto.subarray(44, 60);
  const chave = chaveDoSelo(diffieHellman({ privateKey: chavePrivada, publicKey: publicaX25519(epk.toString("base64")).chave }), epk, pub);
  const decifra = createDecipheriv("aes-256-gcm", chave, iv);
  decifra.setAAD(pub);
  decifra.setAuthTag(tag);
  return Buffer.concat([decifra.update(bruto.subarray(60)), decifra.final()]);
}
