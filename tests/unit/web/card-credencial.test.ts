import { afterEach, describe, expect, it } from "vitest";
import type { PayloadPropostaCredencial, Proposta } from "../../../src/contracts/conversa.ts";
import { paraDoCartao } from "../../../src/use-cases/pedir-credencial.ts";
import { erroDaResposta, marcarFase, renderCardCredencial } from "../../../web/telas/card-credencial.ts";

const ID = "11111111-2222-4333-8444-555555555555";

function proposta(payload: Partial<PayloadPropostaCredencial> = {}): Proposta & { payload: PayloadPropostaCredencial } {
  return {
    tenantId: "t" as Proposta["tenantId"], id: ID, conversaId: "c", agenteId: "a", kind: "credencial", estado: "pendente", criadoEm: 0,
    payload: { kind: "credencial", alvo: "conector", conectorId: "k", app: "Loja <b>", chave: "LOJA_API_KEY", para: "Ler os pedidos.", turnoId: "t1", ...payload },
  } as Proposta & { payload: PayloadPropostaCredencial };
}

describe("o 'para' do cartão (NOD-50: até 80 caracteres, com padrão)", () => {
  it("vazio ou só espaço vira o padrão", () => {
    expect(paraDoCartao(undefined)).toBe("Para seguir com o que você pediu.");
    expect(paraDoCartao("   ")).toBe("Para seguir com o que você pediu.");
    // 80 sem pontuação não vira 81 com o ponto; o corte não parte um emoji.
    expect(Array.from(paraDoCartao("a".repeat(80))).length).toBeLessThanOrEqual(80);
    expect(Array.from(paraDoCartao(`${"a".repeat(78)}😀😀😀`)).length).toBeLessThanOrEqual(80);
    expect(paraDoCartao(`${"a".repeat(78)}😀😀😀`)).not.toMatch(/[\uD800-\uDBFF]…/);
  });
  it("capitaliza, junta espaços e põe ponto final; não duplica pontuação", () => {
    expect(paraDoCartao("  ler   os pedidos ")).toBe("Ler os pedidos.");
    expect(paraDoCartao("Ler os pedidos?")).toBe("Ler os pedidos?");
  });
  it("mais de 80 caracteres corta com reticências e nunca passa de 80", () => {
    const r = paraDoCartao("a".repeat(200));
    expect(r.length).toBe(80);
    expect(r.endsWith("…")).toBe(true);
    expect(paraDoCartao("b".repeat(79))).toHaveLength(80);
  });
});

describe("o erro da rota vira o estado do cartão pelo código, nunca pela mensagem", () => {
  it.each([
    [null, null, "rede"],
    [403, "integracao_autenticacao", "recusada"],
    [400, "entrada_invalida", "formato"],
    [409, "estado_invalido", "resolvido"],
    [404, "nao_encontrado", "resolvido"],
    [503, "conector_indisponivel", "indisponivel"],
    [500, null, "indisponivel"],
  ] as const)("%s %s → %s", (status, codigo, esperado) => {
    expect(erroDaResposta(status, codigo)).toBe(esperado);
  });
});

describe("o cartão de credencial (protótipo nod-50)", () => {
  afterEach(() => marcarFase(ID, null));

  it("campo de senha sem autocompletar, nome da chave e do app escapados, frase de sigilo", () => {
    const html = renderCardCredencial(proposta(), "Ada <i>");
    expect(html).toContain('type="password"');
    expect(html).toContain('autocomplete="off" data-1p-ignore data-lpignore="true"');
    expect(html).not.toContain("new-password");
    expect(html).toContain('maxlength="4096"');
    expect(html).toContain('data-form="guardar-credencial"');
    expect(html).toContain("<code>LOJA_API_KEY</code>");
    expect(html).toContain("Chave para Loja &lt;b&gt;");
    expect(html).not.toContain("<b>");
    expect(html).toContain("Ada &lt;i&gt; não vê a chave.");
    expect(html).toContain('data-act="recusar-credencial"');
    expect(html).not.toContain("value=");
  });

  it("ocupado: campo só leitura, Guardando…, sem Deixar de lado, status anunciado", () => {
    marcarFase(ID, { ocupado: true, erro: null });
    const html = renderCardCredencial(proposta(), "Ada");
    expect(html).toContain(" readonly");
    expect(html).toContain("Guardando…");
    expect(html).toContain('aria-busy="true" disabled');
    expect(html).not.toContain("Deixar de lado");
    expect(html).toContain('role="status"');
  });

  it("chave recusada marca o campo inválido e explica; rede oferece Tentar de novo sem culpar o campo", () => {
    marcarFase(ID, { ocupado: false, erro: "recusada" });
    const recusada = renderCardCredencial(proposta(), "Ada");
    expect(recusada).toContain('aria-invalid="true"');
    expect(recusada).toContain("recusou essa chave");
    marcarFase(ID, { ocupado: false, erro: "rede" });
    const rede = renderCardCredencial(proposta({ alvo: "github_token", app: "GitHub", chave: null, conectorId: null }), "Ada");
    expect(rede).not.toContain("aria-invalid");
    expect(rede).toContain("Tentar de novo");
    expect(rede).toContain("Não deu para confirmar se o token foi guardado. Tente de novo.");
    expect(rede).toContain("Token do GitHub");
  });

  it("Mostrar troca o tipo do campo e o rótulo do botão", () => {
    marcarFase(ID, { ocupado: false, erro: null, mostrando: true });
    const html = renderCardCredencial(proposta({ alvo: "composio", app: "Composio", chave: null, conectorId: null }), "Ada");
    expect(html).toContain('type="text"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Ocultar");
    expect(html).toContain("Chave do Composio do time");
  });

  it("conversa e Sua vez geram ids diferentes para o mesmo cartão", () => {
    const c = renderCardCredencial(proposta(), "Ada", "c");
    const sv = renderCardCredencial(proposta(), "Ada", "sv");
    expect(c).toContain(`id="cr-c-${ID}-v"`);
    expect(sv).toContain(`id="cr-sv-${ID}-v"`);
  });
});

describe("QA do PR 553: a conversa lembra o histórico, e o erro do cartão precisa furar essa lembrança", () => {
  afterEach(() => marcarFase(ID, null));
  it("com a fase nos extras de `lembrar`, Guardar vazio mostra o erro sem sair da conversa", async () => {
    const { lembrar } = await import("../../../web/lib/lembrar.ts");
    const { versaoDasFases } = await import("../../../web/telas/card-credencial.ts");
    const estado = { propostas: [proposta()] };
    const desenhar = (e: typeof estado) => e.propostas.map((p) => renderCardCredencial(p as never, "Bot")).join("");
    const antes = lembrar("qa-553", estado, [versaoDasFases()], desenhar);
    expect(antes).not.toContain("p50-erro");
    marcarFase(ID, { ocupado: false, erro: "vazio" });
    const depois = lembrar("qa-553", estado, [versaoDasFases()], desenhar);
    expect(depois).toContain("Cole a chave antes de guardar.");
    marcarFase(ID, { ocupado: true, erro: null });
    expect(lembrar("qa-553", estado, [versaoDasFases()], desenhar)).toContain("Guardando");
  });
  it("os dois históricos lembrados da web (conversa e task) levam a versão das fases nos extras", async () => {
    const { readFileSync } = await import("node:fs");
    const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
    expect(main).toMatch(/lembrar\("timeline-historico", estado, \[[^\]]*versaoDasFases\(\)[^\]]*\]/);
    expect(main).toMatch(/lembrar\("task-historico", estado, \[[^\]]*versaoDasFases\(\)[^\]]*\]/);
  });
});
