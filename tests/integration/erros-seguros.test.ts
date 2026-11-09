import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ErroDeDominio } from "../../src/domain/erro.ts";
import { MENSAGEM_FALHA_INTERNA, TABELA_ERROS } from "../../src/adapters/http/erros.ts";
import { listen } from "../../src/adapters/http/server.ts";
import type { Rota } from "../../src/adapters/http/roteador.ts";
import { cunharCookie } from "../../src/adapters/http/sessao.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";

/** ADR-002/004 refinados: a mensagem de erro é canal de vazamento. Nunca err.message na resposta. */
const SEGREDO_VAZAVEL = "cpf 123.456.789-00 do cliente";

const rotas: Rota[] = [
  { metodo: "GET", padrao: /^\/generico$/, async handler() { throw new Error(SEGREDO_VAZAVEL); } },
  { metodo: "GET", padrao: /^\/dominio$/, async handler() { throw new ErroDeDominio("limite_atingido", { cause: SEGREDO_VAZAVEL }); } },
  { metodo: "GET", padrao: /^\/sala$/, async handler() { throw new ErroDeDominio("sala_tamanho"); } },
  { metodo: "POST", padrao: /^\/corpo$/, async handler(ctx) { ctx.json(200, await ctx.corpo()); } },
];

describe("erros seguros", () => {
  let base: string;
  let close: () => Promise<void>;
  let jar: { cookie: string };
  const saida = vi.spyOn(console, "log").mockImplementation(() => {});

  beforeAll(async () => {
    const srv = await listen(0, "127.0.0.1", { rotas, segredoSessao: "s" });
    base = `http://127.0.0.1:${srv.port}`;
    close = srv.close;
    jar = { cookie: `nod_sessao=${cunharCookie({ tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON }, "s")}` };
  });
  afterAll(() => close());

  it("Error genérico → 500 {codigo:'falha_interna'} sem message, e vai para o log", async () => {
    saida.mockClear();
    const r = await fetch(`${base}/api/t/${TENANT_PADRAO}/generico`, { headers: jar });
    expect(r.status).toBe(500);
    const corpo = (await r.json()) as { codigo: string; correlation_id?: string | null };
    expect(corpo.codigo).toBe("falha_interna");
    expect((corpo as { mensagem?: string }).mensagem).toBe(MENSAGEM_FALHA_INTERNA);
    expect(JSON.stringify(corpo)).not.toContain("cpf");
    expect("correlation_id" in corpo).toBe(true);
    const linhas = saida.mock.calls.map((c) => String(c[0]));
    expect(linhas.some((l) => l.includes('"evento":"falha_interna"'))).toBe(true);
    expect(linhas.join("\n")).not.toContain("cpf");
  });

  it("ErroDeDominio → status por código + mensagem da tabela fixa; cause nunca sai", async () => {
    const r = await fetch(`${base}/api/t/${TENANT_PADRAO}/dominio`, { headers: jar });
    expect(r.status).toBe(429);
    expect(await r.json()).toEqual({ codigo: "limite_atingido", mensagem: "Você chegou ao limite por agora. Espere um pouco e tente de novo." });
    const s = await fetch(`${base}/api/t/${TENANT_PADRAO}/sala`, { headers: jar });
    expect(s.status).toBe(400);
    expect(((await s.json()) as { codigo: string }).codigo).toBe("sala_tamanho");
  });

  it("JSON malformado no corpo → 400 entrada_invalida, nunca o texto do parser", async () => {
    const r = await fetch(`${base}/api/t/${TENANT_PADRAO}/corpo`, { method: "POST", headers: jar, body: "{isto não é json" });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ codigo: "entrada_invalida", mensagem: "Algum dado do pedido não está certo. Confira e tente de novo." });
    expect(PESSOA_MARLON.length).toBe(36);
  });

  it("NOD-174: toda mensagem da tabela é frase completa em pt-BR, nunca o código nem snake_case", () => {
    for (const [codigo, { mensagem }] of [...Object.entries(TABELA_ERROS), ["falha_interna", { mensagem: MENSAGEM_FALHA_INTERNA }] as const]) {
      expect(mensagem, codigo).toMatch(/^[A-ZÁÉÍÓÚÂÊÔÃÕÇ]/);
      expect(mensagem, codigo).toMatch(/\.$/);
      expect(mensagem, codigo).not.toMatch(/\b[a-z]+_[a-z_]+\b/);
      expect(mensagem.toLowerCase(), codigo).not.toContain(codigo.replaceAll("_", " "));
    }
  });
});
