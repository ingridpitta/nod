import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { conferirSha256, instalarPacote, lerArch, LIMA_VERSAO, pacotes } from "../../../scripts/desktop/vm-local-binarios.ts";
import { binariosVmLocal } from "../../../desktop/vm-local/runtime.ts";

/** NOD-93 (PR 2): os binários da VM local são fixados, conferidos e montados no layout que o runtime procura. */
const tmp = mkdtempSync(join(tmpdir(), "vm-local-bin-t-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("scripts/desktop/vm-local-binarios.ts (NOD-93)", () => {
  it("versões fixas e um sha256 por arquitetura, sem latest", () => {
    for (const arch of ["arm64", "x64"] as const) {
      // ADR-127: só o Lima; o docker CLI saiu do app.
      expect(pacotes(arch)).toHaveLength(1);
      const [lima] = pacotes(arch);
      expect(lima!.url).toContain(`/v${LIMA_VERSAO}/lima-${LIMA_VERSAO}-Darwin-${arch === "arm64" ? "arm64" : "x86_64"}.tar.gz`);
      expect(lima!.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(lima!.url).not.toContain("latest");
      expect(lima!.copiar.map(([, para]) => para)).toEqual(["lima/bin/limactl", `lima/share/lima/lima-guestagent.Linux-${arch === "arm64" ? "aarch64" : "x86_64"}.gz`, "LICENSE"]);
    }
    expect(pacotes("arm64")[0]!.sha256).not.toBe(pacotes("x64")[0]!.sha256);
    expect(() => lerArch("amd64")).toThrow(/arm64 ou x64/);
  });

  it("sha256 diferente é erro", () => {
    const dados = new TextEncoder().encode("abc");
    expect(() => conferirSha256(dados, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", "x")).not.toThrow();
    expect(() => conferirSha256(dados, "0".repeat(64), "x")).toThrow(/não confere/);
  });

  it("extrai só o que o app leva, no layout que o runtime procura, e falha se faltar arquivo", () => {
    const fonte = join(tmp, "fonte");
    mkdirSync(join(fonte, "bin"), { recursive: true });
    mkdirSync(join(fonte, "share/lima"), { recursive: true });
    mkdirSync(join(fonte, "share/doc/lima"), { recursive: true });
    writeFileSync(join(fonte, "share/doc/lima/LICENSE"), "Apache License");
    writeFileSync(join(fonte, "bin/limactl"), "#!/bin/sh\n");
    writeFileSync(join(fonte, "bin/lima"), "nao vai");
    writeFileSync(join(fonte, "share/lima/lima-guestagent.Linux-aarch64.gz"), "ga");
    const tgz = join(tmp, "lima.tgz");
    expect(spawnSync("tar", ["-czf", tgz, "-C", fonte, "."]).status).toBe(0);
    const destino = join(tmp, "dist/arm64");
    instalarPacote(tgz, pacotes("arm64")[0]!, destino);
    // O destino de cada arquivo é o caminho que o runtime abre em Resources/vm-local.
    const b = binariosVmLocal("/R");
    expect(b.limactl).toBe(join("/R/vm-local", pacotes("arm64")[0]!.copiar[0]![1]));
    expect(statSync(join(destino, "lima/bin/limactl")).mode & 0o111).not.toBe(0);
    expect(readFileSync(join(destino, "lima/share/lima/lima-guestagent.Linux-aarch64.gz"), "utf8")).toBe("ga");
    expect(() => statSync(join(destino, "lima/bin/lima"))).toThrow();
    // A licença Apache-2.0 vai junto com os binários (Lima), sem bit de execução.
    expect(readFileSync(join(destino, "LICENSE"), "utf8")).toBe("Apache License");
    expect(statSync(join(destino, "LICENSE")).mode & 0o111).toBe(0);
    expect(() => instalarPacote(tgz, pacotes("x64")[0]!, join(tmp, "dist/x64"))).toThrow(/não trouxe share\/lima\/lima-guestagent\.Linux-x86_64\.gz/);
  });
});
