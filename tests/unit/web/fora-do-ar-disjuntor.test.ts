import { describe, expect, it } from "vitest";
import type { Conector } from "../../../src/contracts/conector.ts";
import { falhaVisivel as falhaVisivelDominio } from "../../../src/domain/disjuntor-conector.ts";
import { falhaVisivel } from "../../../web/lib/fora-do-ar.ts";
import { descreverNegacao } from "../../../src/domain/estado-degradacao.ts";
import { estadoInicial, type Estado } from "../../../web/estado/reducer.ts";
import { situacaoDoApp } from "../../../web/telas/app-acesso.ts";
import { appsParaLiberar } from "../../../web/telas/card-liberar.ts";
import { textoMotivo } from "../../../web/telas/negacao.ts";
import { linhaForaDoAr } from "../../../web/telas/provedores.ts";

/** definido em 2026-10-26 (NOD-374): a falha que ainda espera confirmação não pinta "Fora do ar"; o cartão diz o que o nod faz. */
const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 26, 12, 0);
const conector = (p: Partial<Conector> = {}): Conector => ({
  tenantId: "t", id: "c-gmail", ownerId: "p", visibility: "privado", nome: "Gmail", slug: "gmail", transporte: "http", comando: null, args: [], url: "https://x/mcp", env: {}, declaracao: "toca",
  habilitado: true, catalogo: [{ nome: "GMAIL_LER", descricao: "", schema: {}, readOnlyHint: true, grupo: "ler" }], sondadoEm: T0 - 5 * MIN, ultimaFalha: null, criadoEm: 0, ...p,
});
const ABERTA = { ultimaFalha: { motivo: "timeout_transporte" as const, em: T0 }, falhasSeguidas: 1, foraDoArDesde: null };
const VISIVEL = { ultimaFalha: { motivo: "conector_indisponivel" as const, em: T0 }, falhasSeguidas: 2, foraDoArDesde: T0 + 10 * MIN };

describe("Fora do ar só quando persiste (NOD-374)", () => {
  it("falhaVisivel: sem falha não; falha aberta sem foraDoArDesde não; com foraDoArDesde sim; Conector antigo (sem o campo) sim", () => {
    expect(falhaVisivel(conector())).toBe(false);
    expect(falhaVisivel(conector(ABERTA))).toBe(false);
    expect(falhaVisivel(conector(VISIVEL))).toBe(true);
    expect(falhaVisivel(conector({ ultimaFalha: { motivo: "conector_indisponivel", em: T0 } }))).toBe(true);
    // A web espelha a regra do domínio (não importa valor de src).
    for (const c of [conector(), conector(ABERTA), conector(VISIVEL)]) expect(falhaVisivel(c)).toBe(falhaVisivelDominio(c));
  });

  it("marketplace e ficha: a falha aberta não põe o app em atenção; a visível põe", () => {
    const estado = (c: Conector) => ({ ...estadoInicial, sessao: { tenantId: "t", pessoaId: "p" }, conectores: [c], marketplace: [{ slug: "gmail", nome: "Gmail", descricao: "", categoria: "", logo: null }] }) as unknown as Estado;
    expect(situacaoDoApp(estado(conector(ABERTA)), "gmail")).toBe("conectado");
    expect(situacaoDoApp(estado(conector(VISIVEL)), "gmail")).toBe("atencao");
    // Revisão 2 (M1): "Tentar de novo" que falha de novo grava sondadoEm depois do começo da falha — continua em atenção.
    expect(situacaoDoApp(estado(conector({ ...VISIVEL, sondadoEm: T0 + 15 * MIN })), "gmail")).toBe("atencao");
  });

  it("o card de liberar não some por uma falha que ainda não foi confirmada", () => {
    const entrada = (c: Conector) => ({ agora: T0 + MIN, pessoaId: "p", conversa: { tipo: "propria" as const, agenteId: "a1" }, agente: { id: "a1", ownerId: "p" }, conectores: [c], concessoes: [], dispensadas: {}, propostas: [] });
    expect(appsParaLiberar(entrada(conector(ABERTA)))).toHaveLength(1);
    expect(appsParaLiberar(entrada(conector(VISIVEL)))).toEqual([]);
    expect(appsParaLiberar({ ...entrada(conector({ ...VISIVEL, sondadoEm: T0 + 15 * MIN })), agora: T0 + 16 * MIN })).toEqual([]);
  });

  it("cartão: parou de responder, desde, há quanto e a próxima tentativa sozinha; vencida = em instantes", () => {
    const agora = T0 + 12 * MIN;
    const l = linhaForaDoAr({ motivo: "timeout_transporte", desde: T0, proximaEm: T0 + 20 * MIN }, agora);
    expect(l.motivo).toBe("parou de responder");
    expect(l.detalhe).toMatch(/^desde \d{2}:\d{2} \(há 12 min\) · o nod tenta de novo sozinho; próxima às \d{2}:\d{2}$/);
    expect(linhaForaDoAr({ motivo: "conector_indisponivel", desde: T0, proximaEm: null }, agora).detalhe).toMatch(/próxima em instantes$/);
    expect(linhaForaDoAr({ motivo: "conector_indisponivel", desde: T0, proximaEm: T0 }, agora).detalhe).toMatch(/próxima em instantes$/);
  });

  it("cartão: aberto pelos 5 timeouts (o app responde à sonda) diz que está lento e quando o nod confere de novo", () => {
    const l = linhaForaDoAr({ motivo: "timeout_transporte", desde: T0, proximaEm: T0 + 30 * MIN, lento: true }, T0 + MIN);
    expect(l).toEqual({ motivo: "está demorando demais", detalhe: expect.stringMatching(/ · o nod confere de novo sozinho; próxima às \d{2}:\d{2}$/) });
  });

  it("revisão 4: app desabilitado (fora do laço) não promete re-sonda — pede o Tentar de novo", () => {
    const l = linhaForaDoAr({ motivo: "conector_indisponivel", desde: T0, proximaEm: T0 + MIN, semRessonda: true }, T0 + 12 * MIN);
    expect(l).toEqual({ motivo: "parou de responder", detalhe: expect.stringMatching(/ · toque em Tentar de novo$/) });
    expect(l.detalhe).not.toMatch(/sozinho/);
  });

  it("cartão: acesso recusado (401/403) pede para entrar de novo e não promete voltar sozinho", () => {
    const l = linhaForaDoAr({ motivo: "falha_tecnica", causa: "acesso_recusado", desde: T0, proximaEm: null }, T0 + MIN);
    expect(l.motivo).toBe("recusou o acesso");
    expect(l.detalhe).toMatch(/entre de novo no app$/);
    expect(l.detalhe).not.toMatch(/sozinho/);
  });

  it("'tempo esgotado no transporte' saiu da tela e do domínio", () => {
    expect(textoMotivo("timeout_transporte")).toBe("a conexão com o app demorou demais");
    expect(descreverNegacao({ classe: "ferramenta_negada", nome: "x", motivo: "timeout_transporte", desde: T0, terminal: false }, T0)).toContain("a conexão com o app demorou demais");
  });
});
