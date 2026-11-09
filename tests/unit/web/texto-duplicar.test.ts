import { describe, expect, it } from "vitest";
import { textoDuplicar } from "../../../web/telas/gestao.ts";

describe("textoDuplicar (NOD-316)", () => {
  it.each([true, false])("dona=%s: diz que a cópia nasce em Aprovar automaticamente, sem prometer a aprovação de antes", (dona) => {
    const texto = textoDuplicar(dona);
    expect(texto).toContain("Aprovar automaticamente");
    expect(texto).toContain("mude em Aprovações");
    expect(texto).not.toContain("como estava");
  });

  it("os ramos continuam dizendo o que vem: a dona leva acessos e rotinas; quem não é dona, só o perfil", () => {
    expect(textoDuplicar(true)).toContain("memória, acessos e rotinas");
    expect(textoDuplicar(false)).toContain("Rotinas começam pausadas");
  });
});
