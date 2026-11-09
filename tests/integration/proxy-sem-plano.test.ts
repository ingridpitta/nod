import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rotasInternas } from "../../src/adapters/http/rotas/interno.ts";
import { CODIGO } from "../../src/adapters/mcp-proxy/jsonrpc.ts";
import type { Negacao } from "../../src/contracts/negacao.ts";
import { criarTokenTurno } from "../../src/services/token-turno.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { dentroEmMemoria, inicializarProxy, planoDeTeste, spawnProxy, type ProxyReal } from "../helpers/l5.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../helpers/servidor-de-teste.ts";

/**
 * Escrito PRIMEIRO (ADR-024/029): sem token, com token expirado, com plano expirado e com catálogo
 * vazio, o proxy REAL (spawnado) responde tools/list [] e tools/call com erro tipado
 * {code:-32001, data: Negacao{classe:'plano_ausente'}} — nunca lista de cache, nunca silêncio.
 * Sem banco: o plano vive junto do token no servidor de teste.
 */
const identidade = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON, agenteId: "a1" };

async function chamadaNegada(proxy: ProxyReal): Promise<Negacao> {
  const r = await proxy.pedir("tools/call", { name: "lembrar", arguments: { tipo: "fato", texto: "x" } });
  expect(r.result).toBeUndefined();
  expect(r.error?.code).toBe(CODIGO.negacaoNod);
  return r.error?.data as Negacao;
}

describe("proxy sem plano: fail-closed renderizado", () => {
  // O proxy spawnado lê Date.now(); o relógio do servidor de teste parte do mesmo instante e só avança onde o teste manda.
  let relogio = Date.now();
  const agora = () => relogio;
  const tokens = criarTokenTurno({ agora, validadeMs: 60_000 });
  let srv: ServidorDeTeste;
  const proxies: ProxyReal[] = [];

  beforeAll(async () => {
    const { dentro } = dentroEmMemoria({ agora });
    srv = await servidorDeTeste(rotasInternas({ dentro, tokens, agora }), { autorizarTokenTurno: tokens.autorizar });
  });
  afterAll(async () => {
    for (const p of proxies) await p.fechar();
    await srv.close();
  });

  it("sem token no ambiente: initialize responde, tools/list é [] e tools/call é plano_ausente", async () => {
    const proxy = spawnProxy({});
    proxies.push(proxy);
    const init = (await inicializarProxy(proxy)) as { serverInfo: { name: string }; protocolVersion: string };
    expect(init.serverInfo.name).toBe("nod");
    expect(init.protocolVersion).toBe("2025-06-18");
    expect((await proxy.pedir("tools/list")).result).toEqual({ tools: [] });
    const n = await chamadaNegada(proxy);
    expect(n).toMatchObject({ classe: "plano_ausente", motivo: "plano_ausente", terminal: true });
    expect(typeof n.desde).toBe("number");
  });

  it("token expirado: o servidor devolve 401 e o proxy trata como plano ausente", async () => {
    const token = tokens.cunhar("t-exp", identidade);
    tokens.guardarPlano(planoDeTeste({ turnoId: "t-exp", expiraEm: relogio + 60_000 }));
    relogio += 61_000;
    const proxy = spawnProxy({ NOD_URL: srv.url, NOD_TOKEN_TURNO: token });
    proxies.push(proxy);
    await inicializarProxy(proxy);
    expect((await proxy.pedir("tools/list")).result).toEqual({ tools: [] });
    expect((await chamadaNegada(proxy)).motivo).toBe("plano_ausente");
  });

  it("plano expirado (token vivo): tools/list [] e tools/call plano_expirado", async () => {
    const token = tokens.cunhar("t-plano-velho", identidade);
    tokens.guardarPlano(planoDeTeste({ turnoId: "t-plano-velho", expiraEm: Date.now() - 1 }));
    const proxy = spawnProxy({ NOD_URL: srv.url, NOD_TOKEN_TURNO: token });
    proxies.push(proxy);
    await inicializarProxy(proxy);
    expect((await proxy.pedir("tools/list")).result).toEqual({ tools: [] });
    expect((await chamadaNegada(proxy)).motivo).toBe("plano_expirado");
  });

  it("catálogo vazio: tools/list [] e tools/call catalogo_vazio", async () => {
    const token = tokens.cunhar("t-vazio", identidade);
    tokens.guardarPlano(planoDeTeste({ turnoId: "t-vazio", expiraEm: relogio + 60_000, catalogo: { ferramentas: [], servidores: [] } }));
    const proxy = spawnProxy({ NOD_URL: srv.url, NOD_TOKEN_TURNO: token });
    proxies.push(proxy);
    await inicializarProxy(proxy);
    expect((await proxy.pedir("tools/list")).result).toEqual({ tools: [] });
    expect((await chamadaNegada(proxy)).motivo).toBe("catalogo_vazio");
  });

  it("token bom mas servidor sem plano guardado (404): plano_ausente; método desconhecido é -32601", async () => {
    const token = tokens.cunhar("t-sem-plano", identidade);
    const proxy = spawnProxy({ NOD_URL: srv.url, NOD_TOKEN_TURNO: token });
    proxies.push(proxy);
    await inicializarProxy(proxy);
    expect((await chamadaNegada(proxy)).motivo).toBe("plano_ausente");
    expect((await proxy.pedir("resources/list")).error?.code).toBe(CODIGO.methodNotFound);
    expect((await proxy.pedir("ping")).result).toEqual({});
  });
});
