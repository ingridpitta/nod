import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rotasContasIa, type DepsRotasContas } from "../../../src/adapters/http/rotas/contas-ia.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../../helpers/servidor-de-teste.ts";

/**
 * ADA-245 (revisão do PR #694): a prévia e o POST de remover um computador são da jornada D, atrás de
 * NOD_ONBOARDING_TEXTO=1 (desligada). Desligada, as duas rotas respondem 404 sem abrir transação nem revogar nada.
 */
const ID = "11111111-1111-4111-8111-111111111111";

describe("rotas de remover computador atrás da flag", () => {
  let srv: ServidorDeTeste;
  let transacoes = 0;
  const deps = (onboardingTexto?: boolean): DepsRotasContas => ({
    dentro: async () => {
      transacoes++;
      throw new Error("não deveria abrir transação com a flag desligada");
    },
    logins: {} as never,
    dispositivo: {} as never,
    compartilhado: true,
    avisar: () => undefined,
    maquinaViva: () => true,
    ...(onboardingTexto === undefined ? {} : { onboardingTexto }),
  });
  beforeAll(async () => {
    srv = await servidorDeTeste(rotasContasIa(deps()));
  });
  afterAll(() => srv.close());

  it("flag desligada: GET da prévia e POST de remover dão 404 e nada roda", async () => {
    const s = await srv.entrar("marlon");
    const previa = await srv.chamar(s, "GET", `/maquinas/${ID}/remover/previa`);
    const remover = await srv.chamar(s, "POST", `/maquinas/${ID}/remover`, { manterIas: false, manterConexao: false });
    expect(previa.status).toBe(404);
    expect(remover.status).toBe(404);
    expect(transacoes).toBe(0);
  });
});
