import { describe, expect, it } from "vitest";
import { lerPoolMax, POOL_MAX_PADRAO } from "../../../src/db/client.ts";
import { TIMEOUTS_TX } from "../../../src/db/tx.ts";
import { CHAMADA_COM_ARQUIVO_MS } from "../../../src/services/conectores-vivos.ts";
import { ORCAMENTO_CONECTOR_MS } from "../../../src/shared/constantes.ts";

/** NOD-266, critério 4: o tamanho do pool vem de NOD_DB_POOL_MAX; sem env, 15; inválido derruba o boot. */
describe("lerPoolMax", () => {
  it("sem NOD_DB_POOL_MAX (ou vazio), 15", () => {
    expect(POOL_MAX_PADRAO).toBe(15);
    expect(lerPoolMax({})).toBe(15);
    expect(lerPoolMax({ NOD_DB_POOL_MAX: "" })).toBe(15);
    expect(lerPoolMax({ NOD_DB_POOL_MAX: "  " })).toBe(15);
  });

  it.each([["1", 1], ["8", 8], [" 20 ", 20], ["50", 50]])("respeita %j → %d", (bruto, n) => {
    expect(lerPoolMax({ NOD_DB_POOL_MAX: bruto })).toBe(n);
  });

  it.each(["0", "51", "-3", "2.5", "1e1", "abc", "0x10", "15abc"])("recusa %j com mensagem que nomeia a variável", (bruto) => {
    expect(() => lerPoolMax({ NOD_DB_POOL_MAX: bruto })).toThrow(/NOD_DB_POOL_MAX/);
  });
});

/**
 * Revisão do PR #321, revista na NOD-263: o idle_in_transaction só é seguro enquanto for MAIOR que a conversa com o app de
 * fora que ainda roda dentro da tx — a sonda do conector (issue irmã da NOD-263), com orçamento ORCAMENTO_CONECTOR_MS. A
 * chamada do bot (até CHAMADA_COM_ARQUIVO_MS com arquivo) saiu da tx e por isso não entra mais na conta: o idle fica abaixo.
 */
describe("idle_in_transaction × conversa com o app de fora", () => {
  const idleMs = () => {
    const m = /^(\d+)s$/.exec(TIMEOUTS_TX.idleNaTx);
    expect(m, `idleNaTx em segundos: ${TIMEOUTS_TX.idleNaTx}`).not.toBeNull();
    return Number(m?.[1]) * 1_000;
  };
  it("o idle da tx é maior que o orçamento da sonda, que ainda roda dentro da tx", () => {
    expect(idleMs()).toBeGreaterThan(ORCAMENTO_CONECTOR_MS);
  });
  it("NOD-263: a chamada com arquivo não cabe mais no idle — ela roda fora da tx", () => {
    expect(idleMs()).toBeLessThan(CHAMADA_COM_ARQUIVO_MS);
  });
});
