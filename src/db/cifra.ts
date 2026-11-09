import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

const ALGO = "aes-256-gcm";

export function chaveDe(hexOuFrase: string): Buffer {
  if (/^[0-9a-f]{64}$/i.test(hexOuFrase)) return Buffer.from(hexOuFrase, "hex");
  return createHash("sha256").update(hexOuFrase).digest();
}

export function cifrar(texto: string, chave: Buffer): string {
  const iv = randomBytes(12);
  const c = createCipheriv(ALGO, chave, iv);
  const enc = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  const tag = c.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function decifrar(blob: string, chave: Buffer): string {
  const [v, ivB, tagB, dataB] = blob.split(":");
  if (v !== "v1" || !ivB || !tagB || !dataB) throw new Error("blob de credencial inválido");
  const d = createDecipheriv(ALGO, chave, Buffer.from(ivB, "base64"));
  d.setAuthTag(Buffer.from(tagB, "base64"));
  return Buffer.concat([d.update(Buffer.from(dataB, "base64")), d.final()]).toString("utf8");
}

export function healthCheckDecifra(chave: Buffer): void {
  const p = "nod-health-check";
  const round = decifrar(cifrar(p, chave), chave);
  if (round !== p) throw new Error("health check de decifra falhou");
}
