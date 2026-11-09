import type { CodigoCifrado } from "../../src/contracts/contas-ia.ts";

/**
 * O código que a página da Anthropic mostra, cifrado no navegador para a máquina que roda o login (definido em
 * 2026-10-13, ADR-102 item 3). AES-GCM 256 com chave e IV novos; a chave AES vai envolvida em RSA-OAEP (SHA-256) com a
 * chave pública que a máquina gerou para este login. O servidor só repassa; quem decifra é a máquina
 * (src/shared/cifra-do-codigo.ts). `crypto.subtle` existe em contexto seguro (https e localhost) e no app do Mac.
 */
export async function cifrarCodigo(chavePublica: string, codigo: string, subtle: typeof globalThis.crypto.subtle = globalThis.crypto.subtle): Promise<CodigoCifrado> {
  const spki = Uint8Array.from(atob(chavePublica), (c) => c.charCodeAt(0));
  const rsa = await subtle.importKey("spki", spki, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
  const aes = await subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const dados = await subtle.encrypt({ name: "AES-GCM", iv }, aes, new TextEncoder().encode(codigo));
  const chave = await subtle.encrypt({ name: "RSA-OAEP" }, rsa, await subtle.exportKey("raw", aes));
  return { chave: base64(chave), iv: base64(iv), dados: base64(dados) };
}

function base64(b: ArrayBuffer | Uint8Array): string {
  const bytes = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = "";
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s);
}
