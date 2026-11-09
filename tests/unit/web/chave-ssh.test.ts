import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { lerChave, pareceChavePublica, resumoDaChave } from "../../../web/lib/chave-ssh.ts";

/** Monta um `openssh-key-v1` só com o cabeçalho (a parte privada é lixo): nenhuma chave real no repositório. */
function str(b: Buffer | string): Buffer {
  const v = typeof b === "string" ? Buffer.from(b) : b;
  const n = Buffer.alloc(4);
  n.writeUInt32BE(v.length);
  return Buffer.concat([n, v]);
}
function chaveOpenssh(tipo: string, cifra = "none"): { texto: string; publica: Buffer } {
  const publica = Buffer.concat([str(tipo), str(Buffer.alloc(32, 7))]);
  const um = Buffer.alloc(4);
  um.writeUInt32BE(1);
  const blob = Buffer.concat([Buffer.from("openssh-key-v1\0"), str(cifra), str(cifra === "none" ? "none" : "bcrypt"), str(""), um, str(publica), str(Buffer.alloc(64, 1))]);
  const b64 = blob.toString("base64").replace(/(.{70})/g, "$1\n");
  return { texto: `-----BEGIN OPENSSH PRIVATE KEY-----\n${b64}\n-----END OPENSSH PRIVATE KEY-----\n`, publica };
}

describe("chave SSH colada (NOD-94)", () => {
  it("OpenSSH sem frase: tipo, impressão igual à do ssh-keygen -l e sem frase", async () => {
    const { texto, publica } = chaveOpenssh("ssh-ed25519");
    const esperada = `SHA256:${createHash("sha256").update(publica).digest("base64").replace(/=+$/, "")}`;
    expect(await resumoDaChave(texto)).toEqual({ tipo: "ED25519", impressao: esperada, temFrase: false });
  });

  it("OpenSSH com frase (aes256-ctr): a impressão sai do cabeçalho mesmo assim", async () => {
    const r = await resumoDaChave(chaveOpenssh("ssh-rsa", "aes256-ctr").texto);
    expect(r?.tipo).toBe("RSA");
    expect(r?.temFrase).toBe(true);
    expect(r?.impressao).toMatch(/^SHA256:[A-Za-z0-9+/]+$/);
  });

  it("PEM antigo: tipo e frase, sem impressão", () => {
    const corpo = "MIIBOgIBAAJBAK\n";
    expect(lerChave(`-----BEGIN RSA PRIVATE KEY-----\n${corpo}-----END RSA PRIVATE KEY-----`)).toEqual({ tipo: "RSA", publica: null, temFrase: false });
    expect(lerChave(`-----BEGIN RSA PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\nDEK-Info: AES-128-CBC,AA\n\n${corpo}-----END RSA PRIVATE KEY-----`)?.temFrase).toBe(true);
    expect(lerChave(`-----BEGIN EC PRIVATE KEY-----\n${corpo}-----END EC PRIVATE KEY-----`)?.tipo).toBe("ECDSA");
  });

  it("lixo, cabeçalho quebrado e chave pública não passam; a pública é reconhecida", async () => {
    expect(await resumoDaChave("oi")).toBeNull();
    expect(lerChave("-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----")).toBeNull();
    const pub = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOx m@mac";
    expect(lerChave(pub)).toBeNull();
    expect(pareceChavePublica(pub)).toBe(true);
    expect(pareceChavePublica(chaveOpenssh("ssh-ed25519").texto)).toBe(false);
  });
});
