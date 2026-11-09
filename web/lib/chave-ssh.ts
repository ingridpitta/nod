/**
 * NOD-94: a chave SSH colada (ou lida de um arquivo) vira, na tela, uma linha com o tipo e a impressão — e o texto dela
 * sai da tela. Tudo aqui é local: a chave só deixa o navegador cifrada para a instaladora (web/lib/cifra.ts).
 *
 * O formato OpenSSH (`-----BEGIN OPENSSH PRIVATE KEY-----`) traz a chave pública no cabeçalho, sem cifra mesmo quando a
 * privada tem frase-senha: dá o tipo, a impressão (SHA256, a mesma do `ssh-keygen -l`) e se há frase (cifra ≠ "none").
 * O PEM antigo (`BEGIN RSA/EC PRIVATE KEY`) só dá o tipo e se há frase (`Proc-Type: 4,ENCRYPTED`); sem impressão.
 */
export type ResumoDaChave = { tipo: string; impressao: string | null; temFrase: boolean };

const NOMES: Record<string, string> = {
  "ssh-ed25519": "ED25519",
  "ssh-rsa": "RSA",
  "ecdsa-sha2-nistp256": "ECDSA",
  "ecdsa-sha2-nistp384": "ECDSA",
  "ecdsa-sha2-nistp521": "ECDSA",
  "sk-ssh-ed25519@openssh.com": "ED25519-SK",
  "sk-ecdsa-sha2-nistp256@openssh.com": "ECDSA-SK",
};

function base64ParaBytes(b64: string): Uint8Array | null {
  try {
    const bin = atob(b64.replace(/\s+/g, ""));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function bytesParaBase64(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}

/** Lê as strings SSH (uint32 big-endian + bytes) a partir de `pos`. null = acabou antes. */
function leitor(b: Uint8Array) {
  let pos = 0;
  const u32 = (): number | null => {
    if (pos + 4 > b.length) return null;
    const v = ((b[pos]! << 24) >>> 0) + (b[pos + 1]! << 16) + (b[pos + 2]! << 8) + b[pos + 3]!;
    pos += 4;
    return v;
  };
  return {
    pular(n: number): boolean { if (pos + n > b.length) return false; pos += n; return true; },
    u32,
    bytes(): Uint8Array | null {
      const n = u32();
      if (n === null || pos + n > b.length) return null;
      const v = b.subarray(pos, pos + n);
      pos += n;
      return v;
    },
  };
}

const texto = (b: Uint8Array) => new TextDecoder().decode(b);
const MAGICO = "openssh-key-v1\0";

/** O que dá para saber sem cifra nenhuma (puro: os testes rodam sem crypto). `publica`: o blob para a impressão. */
export function lerChave(colada: string): { tipo: string; publica: Uint8Array | null; temFrase: boolean } | null {
  const t = colada.trim();
  const openssh = /-----BEGIN OPENSSH PRIVATE KEY-----([\s\S]*?)-----END OPENSSH PRIVATE KEY-----/.exec(t);
  if (openssh) {
    const b = base64ParaBytes(openssh[1]!);
    if (!b || texto(b.subarray(0, MAGICO.length)) !== MAGICO) return null;
    const r = leitor(b);
    r.pular(MAGICO.length);
    const cifra = r.bytes();
    const kdf = r.bytes();
    const opcoes = r.bytes();
    const n = r.u32();
    const publica = r.bytes();
    if (!cifra || !kdf || !opcoes || n === null || n < 1 || !publica) return null;
    const tipoBruto = leitor(publica).bytes();
    if (!tipoBruto) return null;
    const nome = texto(tipoBruto);
    return { tipo: NOMES[nome] ?? nome, publica, temFrase: texto(cifra) !== "none" };
  }
  const pem = /-----BEGIN (RSA|EC|DSA|ENCRYPTED)? ?PRIVATE KEY-----/.exec(t);
  if (pem && /-----END [A-Z ]*PRIVATE KEY-----/.test(t)) {
    const tipo = pem[1] === "EC" ? "ECDSA" : pem[1] === "DSA" ? "DSA" : "RSA";
    return { tipo, publica: null, temFrase: pem[1] === "ENCRYPTED" || /Proc-Type:\s*4,ENCRYPTED/.test(t) };
  }
  return null;
}

/** null = não parece uma chave privada SSH (a tela diz no campo). */
export async function resumoDaChave(colada: string): Promise<ResumoDaChave | null> {
  const lida = lerChave(colada);
  if (!lida) return null;
  let impressao: string | null = null;
  if (lida.publica) {
    const copia = new Uint8Array(lida.publica);
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", copia.buffer as ArrayBuffer));
    impressao = `SHA256:${bytesParaBase64(hash).replace(/=+$/, "")}`;
  }
  return { tipo: lida.tipo, impressao, temFrase: lida.temFrase };
}

/** O que a pessoa colou foi a chave PÚBLICA (o erro mais comum): a tela pede a privada. */
export function pareceChavePublica(colada: string): boolean {
  return /^(ssh-(ed25519|rsa|dss)|ecdsa-sha2-|sk-)\S* [A-Za-z0-9+/=]+/.test(colada.trim());
}
