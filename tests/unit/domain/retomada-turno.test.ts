import { describe, expect, it } from "vitest";
import { classificarRetomada } from "../../../src/domain/retomada-turno.ts";

describe("classificarRetomada", () => {
  it("turno que pode ter causado efeito não se reexecuta — caso adversarial", () => {
    const r = classificarRetomada(
      { attempted: true, rejected: false, promptSubmitted: true, producedOutput: false },
      0,
      0,
    );
    expect(r.classe).toBe("unknown");
    expect(r.podeReenviar).toBe(false);
  });

  it("producedOutput impede reenvio mesmo com reenvios=0", () => {
    const r = classificarRetomada(
      { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true },
      0,
      0,
    );
    expect(r.podeReenviar).toBe(false);
    expect(r.classe).toBe("after-accept");
  });

  it("antes de aceitar, pode reenviar uma vez", () => {
    const r = classificarRetomada(
      { attempted: false, rejected: false, promptSubmitted: false, producedOutput: false },
      0,
      0,
    );
    expect(r.classe).toBe("before-accept");
    expect(r.podeReenviar).toBe(true);
  });

  it("string de erro não entra na assinatura — o resultado só depende dos sinais", () => {
    const a = classificarRetomada(
      { attempted: true, rejected: false, promptSubmitted: true, producedOutput: false },
      0,
      0,
    );
    const b = classificarRetomada(
      { attempted: true, rejected: false, promptSubmitted: true, producedOutput: false },
      0,
      99,
    );
    expect(a).toEqual(b);
  });
});
