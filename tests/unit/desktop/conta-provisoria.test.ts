import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { pedirProvisorio, segredoDeTroca, servidorOfereceProvisorio, trocarChaveDoApp, verificadorNovo, verificadorValido } from "../../../desktop/conta-provisoria.ts";
import { rotasConta } from "../../../src/adapters/http/rotas/conta.ts";
import { listen } from "../../../src/adapters/http/server.ts";
import type { GuardaSessao } from "../../../src/adapters/http/sessao-revogavel.ts";
import type { Quem, ServicoConta } from "../../../src/use-cases/conta.ts";

/**
 * NOD-345: o lado do app — primeira abertura sem cadastro (o mesmo verificador volta ao mesmo espaço) e a troca de chave
 * depois de entrar numa conta. Servidor real em porta 0 com as rotas de conta e um serviço falso (o verdadeiro tem o
 * próprio teste no Postgres).
 */
const SEGREDO = "segredo-de-teste-do-app-com-mais-de-32-chars";
const PROVA = "p".repeat(43);
const ESPACO = { tenantId: "00000000-0000-4000-8000-0000000000a1", pessoaId: "00000000-0000-4000-8000-0000000000b1" };

function servidor(bootstrap: boolean) {
  const porVerificador = new Map<string, string>();
  const pedidos: { verificador: unknown; nome: unknown; aparelho: string }[] = [];
  const guarda: GuardaSessao = { conferir: async () => false, criar: async () => "s", revogar: async () => false, revogarOutras: async () => 0 };
  const servico = {
    provisorio: async (q: Quem, e: { verificador: string; nome?: unknown }) => {
      pedidos.push({ verificador: e.verificador, nome: e.nome, aparelho: q.aparelho });
      if (!porVerificador.has(e.verificador)) porVerificador.set(e.verificador, `nodm_${porVerificador.size + 1}`);
      return { escopo: ESPACO, chave: porVerificador.get(e.verificador)!, sessao: null, novo: true };
    },
    trocarApp: async (_q: Quem, e: { codigo: unknown; prova: unknown }) => (e.codigo === "codigo-de-troca-valido-0123" && e.prova === PROVA ? { chave: "nodm_da_conta" } : null),
  } as unknown as ServicoConta;
  const rotas = rotasConta({ servico, guarda, segredo: SEGREDO, seguro: false, bootstrap, google: false, agora: () => Date.now() });
  return { pedidos, abrir: () => listen(0, "127.0.0.1", { segredoSessao: SEGREDO, contas: { guarda, google: false, bootstrap, rotas } }) };
}

describe("app: espaço provisório e troca de chave", () => {
  const com = servidor(true);
  const sem = servidor(false);
  let base = "";
  let baseSem = "";
  const fechar: (() => Promise<void>)[] = [];
  beforeAll(async () => {
    const a = await com.abrir();
    const b = await sem.abrir();
    base = `http://127.0.0.1:${a.port}`;
    baseSem = `http://127.0.0.1:${b.port}`;
    fechar.push(a.close, b.close);
  });
  afterAll(async () => { for (const f of fechar) await f(); });

  it("o verificador é aleatório e aceito pelo servidor", () => {
    const v = verificadorNovo();
    expect(verificadorValido(v)).toBe(true);
    expect(verificadorNovo()).not.toBe(v);
    expect(verificadorValido("curto")).toBe(false);
  });

  it("só pede o provisório se o servidor anuncia; fora do ar = não", async () => {
    expect(await servidorOfereceProvisorio(base)).toBe(true);
    expect(await servidorOfereceProvisorio(baseSem)).toBe(false);
    expect(await servidorOfereceProvisorio("http://127.0.0.1:1")).toBe(false);
  });

  it("reabrir com o mesmo verificador recupera o mesmo espaço; o aparelho sai como app do nod", async () => {
    const v = verificadorNovo();
    const a = await pedirProvisorio({ servidor: base, verificador: v, nome: "marlon", versao: "1.2.3" });
    const b = await pedirProvisorio({ servidor: base, verificador: v, nome: "marlon", versao: "1.2.3" });
    expect(a).toBe("nodm_1");
    expect(b).toBe(a);
    expect(await pedirProvisorio({ servidor: base, verificador: verificadorNovo(), nome: "x", versao: "1" })).toBe("nodm_2");
    expect(com.pedidos[0]).toMatchObject({ verificador: v, nome: "marlon" });
    expect(com.pedidos[0]?.aparelho).toContain("app do nod");
  });

  it("sem bootstrap no servidor, ou verificador inválido: null (o app mostra a tela de conexão)", async () => {
    expect(await pedirProvisorio({ servidor: baseSem, verificador: verificadorNovo(), nome: "x", versao: "1" })).toBeNull();
    expect(await pedirProvisorio({ servidor: base, verificador: "x", nome: "x", versao: "1" })).toBeNull();
  });

  it("NOD-408: resolve o desafio do 429 e repete o bootstrap uma vez", async () => {
    const corpos: Record<string, unknown>[] = [];
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      corpos.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      if (corpos.length === 1) return new Response(JSON.stringify({ desafio: "desafio-do-app", bits: 16 }), { status: 429 });
      return new Response(JSON.stringify({ chave: "nodm_depois_da_prova" }), { status: 200 });
    }) as typeof fetch;
    expect(await pedirProvisorio({ servidor: base, verificador: verificadorNovo(), nome: "x", versao: "1", fetchImpl })).toBe("nodm_depois_da_prova");
    expect(corpos).toHaveLength(2);
    const resposta = String(corpos[1]?.resposta);
    expect(createHash("sha256").update(`desafio-do-app:${resposta}`).digest().subarray(0, 2)).toEqual(Buffer.from([0, 0]));
  });

  it("NOD-408: recusa dificuldade fora do protocolo sem repetir nem congelar", async () => {
    let chamadas = 0;
    const fetchImpl = (async () => { chamadas++; return new Response(JSON.stringify({ desafio: "x", bits: 30 }), { status: 429 }); }) as typeof fetch;
    expect(await pedirProvisorio({ servidor: base, verificador: verificadorNovo(), nome: "x", versao: "1", fetchImpl })).toBeNull();
    expect(chamadas).toBe(1);
  });

  it("troca de chave: código válido → chave da conta; inválido, curto ou não-string → null", async () => {
    expect(await trocarChaveDoApp({ servidor: base, prova: "p".repeat(43), codigo: "codigo-de-troca-valido-0123" })).toBe("nodm_da_conta");
    expect(await trocarChaveDoApp({ servidor: base, prova: "p".repeat(43), codigo: "codigo-de-troca-errado-0123" })).toBeNull();
    expect(await trocarChaveDoApp({ servidor: base, prova: "p".repeat(43), codigo: "curto" })).toBeNull();
    expect(await trocarChaveDoApp({ servidor: base, prova: "p".repeat(43), codigo: 42 })).toBeNull();
    // A prova vai junto; sem a certa, o código não vira chave.
    expect(await trocarChaveDoApp({ servidor: base, prova: "q".repeat(43), codigo: "codigo-de-troca-valido-0123" })).toBeNull();
  });

  it("segredo de troca: a página vê só o desafio, que é o SHA-256 da prova; cada abertura sorteia outro", () => {
    const a = segredoDeTroca();
    expect(a.prova).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.desafio).toBe(createHash("sha256").update(a.prova).digest("base64url"));
    expect(a.desafio).not.toBe(a.prova);
    expect(segredoDeTroca().prova).not.toBe(a.prova);
  });
});
