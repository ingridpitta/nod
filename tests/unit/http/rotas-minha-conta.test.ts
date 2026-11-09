import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rotasConta } from "../../../src/adapters/http/rotas/conta.ts";
import { listen } from "../../../src/adapters/http/server.ts";
import { cunharCookie } from "../../../src/adapters/http/sessao-cookie.ts";
import type { GuardaSessao } from "../../../src/adapters/http/sessao-revogavel.ts";
import { ErroDeDominio } from "../../../src/domain/erro.ts";
import type { Escopo } from "../../../src/shared/types.ts";
import type { Quem, ServicoConta } from "../../../src/use-cases/conta.ts";
import type { ServicoMinhaConta } from "../../../src/use-cases/minha-conta.ts";

/**
 * NOD-346: a camada HTTP da Minha conta (`/api/conta/eu/*`) sobre o servidor real em porta 0, com o serviço falso (o
 * serviço tem o próprio teste no Postgres: tests/integration/minha-conta.test.ts). Prova o que só o HTTP faz: a flag, o
 * Origin, o `motivo` que a tela usa (e que causa desconhecida não vaza), a foto e o zip com os cabeçalhos certos.
 */
const SEGREDO = "segredo-de-teste-das-contas-com-mais-de-32";
const ANA: Escopo = { tenantId: "00000000-0000-4000-8000-0000000000a1", pessoaId: "00000000-0000-4000-8000-0000000000b1" };
const SID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

async function subir(minhaConta: ServicoMinhaConta | null) {
  const vivas = new Set<string>([SID]);
  const guarda: GuardaSessao = {
    conferir: async (_e, sid) => sid !== null && vivas.has(sid),
    criar: async () => "x",
    revogar: async () => true,
    revogarOutras: async () => 0,
  };
  const rotas = rotasConta({ servico: {} as ServicoConta, guarda, segredo: SEGREDO, seguro: false, bootstrap: false, google: false, agora: () => Date.now(), minhaConta });
  const srv = await listen(0, "127.0.0.1", { segredoSessao: SEGREDO, contas: { guarda, google: false, bootstrap: false, minhaConta: !!minhaConta, rotas } });
  return { base: `http://127.0.0.1:${srv.port}`, close: srv.close };
}

describe("rotas da Minha conta (HTTP)", () => {
  const vistos: Quem[] = [];
  const servico = {
    estado: async (q: Quem) => { vistos.push(q); return { perfil: { nome: "Ana" } }; },
    excluir: async () => { throw new ErroDeDominio("nao_permitido", { cause: "reautenticar" }); },
    removerGoogle: async () => { throw new ErroDeDominio("estado_invalido", { cause: "ultima_forma_de_entrada" }); },
    pedirTrocaEmail: async () => { throw new ErroDeDominio("estado_invalido", { cause: "detalhe interno com dado" }); },
    foto: async () => ({ bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]), tipo: "image/png" }),
    baixarExportacao: async (_q: Quem, id: unknown) => { if (id !== ID) throw new ErroDeDominio("nao_encontrado"); return Uint8Array.from([0x50, 0x4b, 5, 6]); },
    salvarPerfil: async (_q: Quem, e: unknown) => e,
  } as unknown as ServicoMinhaConta;
  let ligado: Awaited<ReturnType<typeof subir>>;
  let desligado: Awaited<ReturnType<typeof subir>>;
  beforeAll(async () => {
    ligado = await subir(servico);
    desligado = await subir(null);
  });
  afterAll(async () => { await ligado.close(); await desligado.close(); });
  const cookie = { cookie: `nod_sessao=${cunharCookie(ANA, SEGREDO, SID)}` };

  it("flag desligada: as rotas não existem e o modo não anuncia a Minha conta", async () => {
    expect((await fetch(`${desligado.base}/api/conta/eu`, { headers: cookie })).status).toBe(404);
    expect(((await (await fetch(`${desligado.base}/api/sessao/modo`)).json()) as { contas: object }).contas).toEqual({ google: false, bootstrap: false });
    expect(((await (await fetch(`${ligado.base}/api/sessao/modo`)).json()) as { contas: object }).contas).toEqual({ google: false, bootstrap: false, minhaConta: true });
  });

  it("estado com a sessão do cookie; no-store", async () => {
    const r = await fetch(`${ligado.base}/api/conta/eu`, { headers: cookie });
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(vistos.at(-1)).toMatchObject({ escopo: ANA, sid: SID });
  });

  it("motivo conhecido sai para a tela; causa desconhecida não vaza", async () => {
    const r1 = await fetch(`${ligado.base}/api/conta/eu/excluir`, { method: "POST", headers: cookie });
    expect(r1.status).toBe(403);
    expect(await r1.json()).toMatchObject({ codigo: "nao_permitido", motivo: "reautenticar" });
    const r2 = await fetch(`${ligado.base}/api/conta/eu/google/remover`, { method: "POST", headers: cookie });
    expect(await r2.json()).toMatchObject({ codigo: "estado_invalido", motivo: "ultima_forma_de_entrada" });
    const r3 = await fetch(`${ligado.base}/api/conta/eu/email`, { method: "POST", headers: { ...cookie, "content-type": "application/json" }, body: JSON.stringify({ email: "a@b.com" }) });
    const c3 = (await r3.json()) as { codigo: string; motivo?: string };
    expect(c3.codigo).toBe("estado_invalido");
    expect(c3.motivo).toBeUndefined();
    expect(JSON.stringify(c3)).not.toContain("detalhe interno");
  });

  it("POST com Origin de outro host → 403", async () => {
    const r = await fetch(`${ligado.base}/api/conta/eu/perfil`, { method: "POST", headers: { ...cookie, origin: "https://malicioso.example", "content-type": "application/json" }, body: JSON.stringify({ nome: "x" }) });
    expect(r.status).toBe(403);
  });

  it("foto: tipo dos bytes, nosniff e CSP fechada", async () => {
    const r = await fetch(`${ligado.base}/api/conta/eu/foto`, { headers: cookie });
    expect(r.headers.get("content-type")).toBe("image/png");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("content-security-policy")).toBe("default-src 'none'");
    expect([...new Uint8Array(await r.arrayBuffer())]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it("download: zip como anexo; id que não é uuid nem chega ao serviço", async () => {
    const r = await fetch(`${ligado.base}/api/conta/eu/exportacao/${ID}`, { headers: cookie });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/zip");
    expect(r.headers.get("content-disposition")).toContain("attachment");
    expect((await fetch(`${ligado.base}/api/conta/eu/exportacao/..%2F..%2Fx`, { headers: cookie })).status).toBe(404);
  });
});
