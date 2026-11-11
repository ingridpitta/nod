import { describe, expect, it } from "vitest";
import { AO_VIVO_MUDO_MS, deveVigiarQuadro } from "../../../web/lib/quadro.ts";

/**
 * 2026-11-10 (Marlon: a ENG-7 seguia em Fazendo "Trabalhando" minutos depois de o Dev 1 passar ao Ze 1 e o Ze 1 levar a
 * Feito). O servidor publicou os `quadro.mudou` dos agentes, mas o túnel do servidor de teste segura o SSE e nenhum chega:
 * com o stream mudo, o quadro à vista relê sozinho; com o SSE entregando, não.
 */
describe("deveVigiarQuadro (a releitura de segurança do quadro)", () => {
  const agora = 10_000_000;
  const base = { agora, visivel: true, comVivo: true, aberta: false };
  it("SSE mudo (nenhum dado há 20 s) e trabalho vivo no quadro: relê", () => {
    expect(deveVigiarQuadro({ ...base, ultimoDado: agora - AO_VIVO_MUDO_MS })).toBe(true);
    expect(deveVigiarQuadro({ ...base, ultimoDado: 0 })).toBe(true);
  });
  it("com a tarefa aberta também relê, mesmo sem trabalho vivo (o agente terminou e moveu)", () => {
    expect(deveVigiarQuadro({ ...base, comVivo: false, aberta: true, ultimoDado: 0 })).toBe(true);
  });
  it("SSE entregando (dado recente): não relê; quadro escondido ou parado: não relê", () => {
    expect(deveVigiarQuadro({ ...base, ultimoDado: agora - 3_000 })).toBe(false);
    expect(deveVigiarQuadro({ ...base, visivel: false, ultimoDado: 0 })).toBe(false);
    expect(deveVigiarQuadro({ ...base, comVivo: false, ultimoDado: 0 })).toBe(false);
  });
});
