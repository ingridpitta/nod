import { afterAll, describe, expect, it } from "vitest";
import { rotasInternas } from "../../src/adapters/http/rotas/interno.ts";
import { criarTokenTurno } from "../../src/services/token-turno.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { dentroEmMemoria, inicializarProxy, planoDeTeste, spawnProxy, type ProxyReal } from "../helpers/l5.ts";
import { servidorDeTeste } from "../helpers/servidor-de-teste.ts";

type ConteudoTexto = { content: { type: string; text: string }[]; isError?: boolean };

/**
 * ADR-029: servidor fora (ECONNREFUSED) NÃO vira recusa seca — o proxy responde conector
 * indisponível com nome, causa e relógio ("servidor fora há …"), transitória, e tools/list volta
 * a [] porque o plano não é cacheado.
 */
describe("proxy com o servidor fora do ar", () => {
  let proxy: ProxyReal | null = null;
  afterAll(async () => {
    if (proxy) await proxy.fechar();
  });

  it("plano obtido, servidor cai: tools/call → conector_indisponivel com 'servidor fora há'; tools/list → []", async () => {
    const agora = () => Date.now();
    const tokens = criarTokenTurno({ agora });
    const { dentro } = dentroEmMemoria({ agora });
    const srv = await servidorDeTeste(rotasInternas({ dentro, tokens, agora }), { autorizarTokenTurno: tokens.autorizar });
    const token = tokens.cunhar("t1", { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON, agenteId: "a1" });
    tokens.guardarPlano(planoDeTeste({ turnoId: "t1", expiraEm: agora() + 60_000 }));

    proxy = spawnProxy({ NOD_URL: srv.url, NOD_TOKEN_TURNO: token });
    await inicializarProxy(proxy);
    expect(((await proxy.pedir("tools/list")).result as { tools: unknown[] }).tools).toHaveLength(2);

    await srv.close();

    const r = (await proxy.pedir("tools/call", { name: "exemplo__somar", arguments: { a: 1, b: 2 } })).result as ConteudoTexto;
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toContain("negado (transitório)");
    expect(r.content[0]?.text).toContain("conector exemplo__somar indisponível: servidor fora há menos de 1 min");

    const r2 = (await proxy.pedir("tools/call", { name: "lembrar", arguments: { tipo: "fato", texto: "x" } })).result as ConteudoTexto;
    expect(r2.content[0]?.text).toContain("conector lembrar indisponível: servidor fora há");

    // Sem cache: a lista seguinte tenta o servidor de novo e falha fechado.
    expect((await proxy.pedir("tools/list")).result).toEqual({ tools: [] });
    // revisto em 2026-10-12 (NOD-214): o plano sumiu porque o servidor caiu (o deploy), não porque o turno acabou —
    // a chamada é "indisponível, tente de novo" (transitória), e não plano_ausente (terminal).
    const depois = (await proxy.pedir("tools/call", { name: "lembrar", arguments: { tipo: "fato", texto: "x" } })).result as ConteudoTexto;
    expect(depois.isError).toBe(true);
    expect(depois.content[0]?.text).toContain("negado (transitório)");
    expect(depois.content[0]?.text).toContain("conector lembrar indisponível: servidor fora há");
  });
});
