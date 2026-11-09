import { describe, expect, it } from "vitest";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { estadoInicial, type Estado, type TurnoVivo } from "../../../web/estado/reducer.ts";
import { renderFalaViva, renderMensagem } from "../../../web/telas/conversa.ts";

/**
 * NOD-378, revisão 6 do PR 540: o cabeçalho ganhou `title` com o texto inteiro (nome e etiqueta cortados com
 * reticência). O nome do bot e o da rotina são texto livre: no atributo vão escapados, senão um `"` fecha o title e
 * injeta atributo (`" onmouseover=…`) ou tag.
 */
const MAU = `"><img src=x onerror=alert(1)>'`;
const MAU_ESC = "&quot;&gt;&lt;img src=x onerror=alert(1)&gt;&#39;";
const autoria = { autor_tipo: "agente" as const, autor_id: "bot1", sob_procuracao_de: null, conta_de_execucao: "p", executor: "local" as const, locality: "local" as const, locality_reason: "motor_ausente" as const, machine_id: null, decidido_por: "regra:localidade" as const, regra_versao: 1 };
const m: Mensagem = { tenantId: "t", id: "m1", conversaId: "c1", turnoId: "t1", autoria, kind: "texto", texto: "Feito.", payload: null, confianca: "confiavel", parcial: false, criadoEm: 0 };
const estado = { ...estadoInicial, sessao: { tenantId: "t", pessoaId: "p" }, frota: { agentes: [{ id: "bot1", nome: MAU, cor: "azul", forma: "gota", excluidoEm: null }] } } as unknown as Estado;

function semInjecao(html: string): void {
  expect(html).not.toContain("<img");
  expect(html).not.toMatch(/title="[^"]*"\s*>?\s*<img/);
}

describe("o title do cabeçalho vai escapado (NOD-378)", () => {
  it("etiqueta da rotina no balão", () => {
    const html = renderMensagem(m, estado, false, { etiqueta: MAU });
    expect(html).toContain(`<span class="etiqueta-origem" title="${MAU_ESC}">`);
    semInjecao(html);
  });

  it("nome do bot no balão de artefato", () => {
    const html = renderMensagem({ ...m, kind: "artefato" as never, payload: { kind: "artefato", artefatoId: "art", versao: 1, titulo: "Painel" } as never }, estado);
    expect(html).toContain("com-artefato");
    expect(html).toContain(`<b title="${MAU_ESC}">${MAU_ESC}</b>`);
    semInjecao(html);
  });

  it("nome do bot na fala viva", () => {
    const t: TurnoVivo = { turnoId: "t1", conversaId: "c1", estado: "rodando", executor: null, machineId: null, desde: 0 };
    const { html } = renderFalaViva(t, undefined, { nome: MAU, cor: "azul", forma: "gota" } as never, estado, "Parar");
    expect(html).toContain(`<b title="${MAU_ESC}">${MAU_ESC}</b>`);
    semInjecao(html);
  });
});
