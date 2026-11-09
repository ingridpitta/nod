import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { impressaoDaPasta, lerOpcoesVmLocal, recusaVmLocal } from "../../../scripts/ensaio-computador/vm-local.ts";

/** NOD-93 (passo 11): as partes puras do ensaio da VM local (o roteiro roda manual no Mac). */
describe("scripts/ensaio-computador/vm-local.ts", () => {
  it("recusa fora do Mac, em CI e sem NOD_VM_LOCAL=1", () => {
    expect(recusaVmLocal({ plataforma: "linux", ambiente: { NOD_VM_LOCAL: "1" } })).toMatch(/só no Mac/);
    expect(recusaVmLocal({ plataforma: "darwin", ambiente: { NOD_VM_LOCAL: "1", CI: "true" } })).toMatch(/CI/);
    expect(recusaVmLocal({ plataforma: "darwin", ambiente: {} })).toMatch(/NOD_VM_LOCAL=1/);
    expect(recusaVmLocal({ plataforma: "darwin", ambiente: { NOD_VM_LOCAL: "1" } })).toBeNull();
  });

  it("opções: padrão sem sono; flag desconhecida ou sem valor é erro", () => {
    expect(lerOpcoesVmLocal(["--sono", "--app", "/A/nod.app"])).toMatchObject({ sono: true, app: "/A/nod.app", agente: null });
    expect(() => lerOpcoesVmLocal(["--seco"])).toThrow(/opção inválida/);
    expect(() => lerOpcoesVmLocal(["--api"])).toThrow(/sem valor/);
  });

  it("a impressão do ~/.docker muda quando um arquivo muda e é 'ausente' sem a pasta", () => {
    const raiz = mkdtempSync(join(tmpdir(), "nod-docker-"));
    try {
      expect(impressaoDaPasta(join(raiz, "nada"))).toBe("ausente");
      mkdirSync(join(raiz, "contexts"));
      writeFileSync(join(raiz, "config.json"), "{}");
      const a = impressaoDaPasta(raiz);
      expect(impressaoDaPasta(raiz)).toBe(a);
      writeFileSync(join(raiz, "config.json"), '{"currentContext":"nod"}');
      expect(impressaoDaPasta(raiz)).not.toBe(a);
    } finally { rmSync(raiz, { recursive: true, force: true }); }
  });
});
