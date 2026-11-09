import { describe, expect, it } from "vitest";
import { conteudoNegado, negacaoConectorIndisponivel, negacaoFerramenta, negacaoPlanoAusente, redigirNegacao } from "../../../src/adapters/mcp-proxy/negacao.ts";

const agora = 1_700_000_000_000;

describe("negacao renderizada (ADR-029) e classificada (E5.1)", () => {
  it("plano ausente/expirado/vazio: classe plano_ausente, sempre terminal", () => {
    for (const motivo of ["plano_ausente", "plano_expirado", "catalogo_vazio"] as const) {
      const n = negacaoPlanoAusente(motivo, agora - 5 * 60_000);
      expect(n).toMatchObject({ classe: "plano_ausente", nome: "plano", motivo, terminal: true, desde: agora - 5 * 60_000 });
    }
  });

  it("servidor fora: conector_indisponivel é transitória e a redação diz há quanto tempo", () => {
    const n = negacaoConectorIndisponivel("exemplo__somar", agora - 4 * 60_000);
    expect(n.terminal).toBe(false);
    expect(redigirNegacao(n, agora)).toBe("negado (transitório): conector exemplo__somar indisponível: servidor fora há 4 min. Você pode seguir por outro caminho.");
    expect(negacaoConectorIndisponivel("x", agora, "timeout_transporte").motivo).toBe("timeout_transporte");
  });

  it("NOD-157: 401/403 do MCP gera texto de acesso recusado, transitório, sem 'servidor fora'", () => {
    const n = { ...negacaoConectorIndisponivel("gmail__GMAIL_FETCH_EMAILS", agora, "falha_tecnica"), causa: "acesso_recusado" as const };
    const texto = redigirNegacao(n, agora - 0);
    expect(texto).toBe("negado (transitório): conector gmail__GMAIL_FETCH_EMAILS recusou o acesso: o app precisa ser reconectado. Você pode seguir por outro caminho.");
    expect(texto).not.toContain("servidor fora");
  });

  it("ferramenta negada: terminal manda não tentar outro caminho; alcance_insuficiente via gate de rotina é transitória (EMENDA 15)", () => {
    const t = negacaoFerramenta("exemplo__enviar", "capacidade_desligada", agora);
    expect(t.terminal).toBe(true);
    expect(redigirNegacao(t, agora)).toMatch(/^negado \(terminal\): não tente outro caminho\. ferramenta exemplo__enviar negada: capacidade desligada \(terminal\)$/);
    expect(negacaoFerramenta("x", "alcance_insuficiente", agora).terminal).toBe(true);
    expect(negacaoFerramenta("x", "alcance_insuficiente", agora, { viaGateDeRotina: true }).terminal).toBe(false);
    expect(negacaoFerramenta("x", "args_invalidos", agora).terminal).toBe(false);
    expect(negacaoFerramenta("x", "fora_do_catalogo", agora).terminal).toBe(true);
  });

  it("conteudoNegado é result com isError (o modelo lê a redação), nunca error JSON-RPC", () => {
    const c = conteudoNegado(negacaoFerramenta("x", "parada_ativa", agora), agora);
    expect(c.isError).toBe(true);
    expect(c.content).toHaveLength(1);
    expect(c.content[0]?.text).toContain("negado (terminal)");
  });
});
