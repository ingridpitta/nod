import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { MetadadosRelato, Relato } from "../../../src/contracts/relato.ts";
import { CONFIG_UI_INICIAL, estadoInicial, reduzir } from "../../../web/estado/reducer.ts";
import { destinoDoFeedback, renderRelatos, tituloDoRelato, VAZIO_FEEDBACK } from "../../../web/telas/relatos.ts";

/** NOD-367: Configurações › Feedback (protótipo v2 do Gil): título real, data numa coluna, detalhe embaixo, sem <details>. */
const base = { tenantId: "t", conversaId: "c", turnoId: "t1", alcance: "janela" as const, mensagensAnexadas: 6, diagnostico: null, criadoEm: Date.UTC(2026, 9, 26, 17, 12), titulo: null, resumo: null, metadados: { estadoTurno: "concluido", origemTurno: "conversa", sinais: { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true }, motivoFalha: null, motivoInterrupcao: null, modelo: "claude-sonnet-4-5", harness: "claude-cli", executor: "claude-cli", machineId: "MacBook da Ana", custoUsd: null, reenvios: null, confiancaMensagem: "confiavel" as const, mensagemParcial: false, versaoApp: "0.42.1", correlationId: "c-81f2" } as MetadadosRelato };
const LONGO = "A Ada mandou o cronograma com as datas de setembro, não as de outubro que eu tinha pedido na mensagem de cima";
const relato = (id: string, o: Partial<Relato> = {}): Relato => ({ ...base, id, mensagemId: "m1", tipo: "bug", origem: "botao", categoria: "outro", ...o } as Relato);

const RELATOS: Relato[] = [
  relato("r1", { resumo: LONGO }),
  relato("r2", { tipo: "melhoria", resumo: "Queria mandar a proposta direto por e-mail" }),
  relato("r3", { categoria: "travou_ou_parou", metadados: { ...base.metadados, motivoInterrupcao: "sem_progresso" } }),
  relato("r4", { tipo: "duvida" }),
];
const ui = (o: Partial<typeof CONFIG_UI_INICIAL> = {}) => ({ ...CONFIG_UI_INICIAL, ...o });

describe("Configurações › Feedback (NOD-367)", () => {
  it("o título é o texto da pessoa até 80 caracteres; sem texto, a categoria; com texto, nunca \"Outra coisa\"", () => {
    const t = tituloDoRelato(RELATOS[0]!);
    expect(t.length).toBe(80);
    expect(t.endsWith("…")).toBe(true);
    expect(LONGO.startsWith(t.slice(0, -1))).toBe(true);
    expect(tituloDoRelato(RELATOS[1]!)).toBe("Queria mandar a proposta direto por e-mail");
    expect(tituloDoRelato(RELATOS[2]!)).toBe("Travou ou parou no meio");
    // relato de outra pessoa: sem prosa na listagem, fica a categoria
    expect(tituloDoRelato(relato("x"))).toBe("Outra coisa");
    expect(tituloDoRelato(relato("n", { origem: "nod", tipo: "melhoria", titulo: "Arrastar bot entre seções" }))).toBe("Arrastar bot entre seções");
    expect(tituloDoRelato(relato("n2", { origem: "nod", tipo: "duvida" }))).toBe("Dúvida");
  });

  it("linhas linhaConfig com a data numa coluna e o status da falha; sem <details> e sem card-prop", () => {
    const html = renderRelatos({ relatos: RELATOS, configUi: ui() });
    expect(html).toContain("<h2>Feedback</h2>");
    expect(html).toContain('data-act="enviar-feedback"');
    expect(html).toContain("Seus envios");
    expect(html).not.toContain("<details");
    expect(html).not.toContain("card-prop");
    expect(html.match(/class="lc-linha cfg-relato lc-link lc-recolhe"/g)).toHaveLength(4);
    expect(html).toMatch(/class="lc-quando"[^>]*>26\/10/);
    expect(html).toMatch(/lc-status lc-tom-atencao[\s\S]{0,60}sem progresso/);
    expect(html).toContain("Bug · Travou ou parou no meio");
    expect(html).not.toContain("O que você escreveu");
  });

  it("clicar abre o detalhe embaixo: o texto, o contexto, os sinais e os detalhes técnicos recolhidos", () => {
    const aberto = renderRelatos({ relatos: RELATOS, configUi: ui({ abertos: ["relato-r1"] }) });
    expect(aberto).toMatch(/aria-expanded="true" aria-controls="lc-sub-relato-r1"/);
    expect(aberto).toContain('role="region" aria-label="Detalhe do envio"');
    expect(aberto).toContain(`<p class="cfg-prosa">${LONGO}</p>`);
    expect(aberto).toContain("Conversa · 6 mensagens anexadas");
    expect(aberto).toContain("Sinais: tentou · prompt enviado · produziu saída");
    expect(aberto).toContain("Detalhes técnicos");
    expect(aberto).not.toContain("c-81f2");
    const tec = renderRelatos({ relatos: RELATOS, configUi: ui({ abertos: ["relato-r1", "relato-tec-r1"] }) });
    expect(tec).toMatch(/<dt>correlation id<\/dt><dd>c-81f2<\/dd>/);
    expect(tec).toMatch(/<dt>modelo<\/dt><dd>claude-sonnet-4-5<\/dd>/);
  });

  it("o filtro mora no estado: mostra só o tipo escolhido e volta para Todos quando o tipo some", () => {
    const e = reduzir({ ...estadoInicial, relatos: RELATOS }, { tipo: "config-ui", mudanca: { filtro: "melhoria" } });
    const html = renderRelatos(e);
    expect(html).toContain('data-filtro-tipo="melhoria" aria-pressed="true"');
    expect(html.match(/cfg-relato lc-link/g)).toHaveLength(1);
    expect(html).toContain("Queria mandar a proposta");
    const semMelhoria = renderRelatos({ ...e, relatos: RELATOS.filter((r) => r.tipo !== "melhoria") });
    expect(semMelhoria).toContain('data-filtro-tipo="todos" aria-pressed="true"');
    expect(semMelhoria.match(/cfg-relato lc-link/g)).toHaveLength(3);
  });

  it("vazio, carregando e erro com Tentar de novo (que não volta a pedir sozinho)", () => {
    expect(renderRelatos({ relatos: [], configUi: ui() })).toContain(`<p class="lc-vazio">${VAZIO_FEEDBACK}</p>`);
    expect(renderRelatos({ relatos: null, configUi: ui() })).toContain("Verificando…");
    const erro = reduzir({ ...estadoInicial, espaco: { secao: "feedback" } }, { tipo: "hidratar-relatos", relatos: null, erro: true });
    expect(renderRelatos(erro)).toContain('data-act="recarregar-relatos"');
    expect(renderRelatos(erro)).toContain("Tentar de novo");
    const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
    expect(main).toMatch(/"recarregar-relatos": \(\) => dispatch\(\{ tipo: "hidratar-relatos", relatos: null, erro: false \}\)/);
  });

  it("Enviar feedback leva à conversa com o Nod e nunca anexa a conversa aberta (ADR-041: a pessoa só aponta)", () => {
    const frota = { agentes: [
      { id: "a-nod", papel: "nod", ownerId: "p", conversaId: "c-nod" },
      { id: "a-nod-x", papel: "nod", ownerId: "x", conversaId: "c-nod-x" },
      { id: "a-sala", papel: null, ownerId: "p", conversaId: "c-sala" },
    ] } as never;
    expect(destinoDoFeedback({ frota, sessao: { tenantId: "t", pessoaId: "p" } })).toEqual({ conversaId: "c-nod", agenteId: "a-nod" });
    expect(destinoDoFeedback({ frota, sessao: { tenantId: "t", pessoaId: "y" } })).toBeNull();
    const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
    const handler = main.slice(main.indexOf('"enviar-feedback": () =>'), main.indexOf("// ADR-082: o card do lote do Nod"));
    expect(handler).toContain("destinoDoFeedback(estado)");
    expect(handler).not.toContain("abrirReportarBug");
    expect(handler).not.toContain("mensagens");
  });
});
