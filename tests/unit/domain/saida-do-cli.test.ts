import { describe, expect, it } from "vitest";
import { falhaPorPermissao } from "../../../src/domain/saida-do-cli.ts";

// NOD-9: a falha por permissão leva ao passo seguinte da atualização (a reserva, a aprovação).
describe("falhaPorPermissao", () => {
  it.each([
    "npm error code EACCES",
    "npm ERR! Error: EPERM: operation not permitted, rename",
    "Error: permission denied, open '/usr/local/lib/node_modules'",
    "The installation directory isn't writable",
    "/opt/homebrew/bin is not writable",
  ])("reconhece %s", (saida) => expect(falhaPorPermissao(saida)).toBe(true));

  it.each(["npm error code ENOSPC", "Successfully updated from 2.1.290 to 2.1.300", "EACCESSO", ""])("não confunde %s", (saida) => {
    expect(falhaPorPermissao(saida)).toBe(false);
  });
});
