import { describe, expect, it } from "vitest";
import type { ColunaDto } from "../../../src/contracts/quadro.ts";
import { COLUNAS_PADRAO, colunasDto } from "../../../src/domain/colunas.ts";
import { popoverDePassagem } from "../../../web/telas/colunas-quadro.ts";
import { fraseDaEspera } from "../../../web/lib/quadro-dados.ts";
import { chipDeEspera } from "../../../web/telas/quadro.ts";

/** 2026-11-10: as saídas da etapa no popover da coluna (paridade com definir_passagem {proxima, volta_para}) */
const CS: ColunaDto[] = colunasDto(COLUNAS_PADRAO.map((c) => (c.id === "afazer" ? { ...c, responsavel: "dev" } : c.id === "revisao" ? { ...c, responsavel: "ze", volta: "backlog" } : c)));
const col = (id: string) => CS.find((c) => c.id === id)!;
const AGENTES = [{ id: "dev", nome: "Dev 1" }, { id: "ze", nome: "Ze 1" }];

describe("o popover da passagem com as saídas da etapa", () => {
  it("mostra o padrão de cada saída e só as colunas que o servidor aceita", () => {
    const h = popoverDePassagem(col("afazer"), AGENTES, CS);
    expect(h).toContain(`<label class="qd-rotulo" for="qd-pas-proxima">Etapa concluída vai para</label>`);
    expect(h).toContain(`<option value="">Fazendo (padrão)</option>`);
    expect(h).toContain(`<option value="">Sem volta (comente na tarefa)</option>`);
    const proxima = h.slice(h.indexOf(`name="proxima"`), h.indexOf("</select>", h.indexOf(`name="proxima"`)));
    expect(proxima).not.toContain(`value="bloqueado"`);
    expect(proxima).not.toContain(`value="afazer"`);
    expect(proxima).toContain(`value="revisao"`);
  });

  it("a volta configurada vem marcada; o padrão da volta é a etapa anterior com responsável", () => {
    const h = popoverDePassagem(col("revisao"), AGENTES, CS);
    expect(h).toContain(`<option value="">A fazer (padrão)</option>`);
    expect(h).toContain(`<option value="backlog" selected>Backlog</option>`);
    const volta = h.slice(h.indexOf(`name="volta"`), h.indexOf("</select>", h.indexOf(`name="volta"`)));
    expect(volta).not.toContain(`value="feito"`);
    expect(volta).not.toContain(`value="bloqueado"`);
  });

  it("sem as colunas (chamador antigo), o popover fica como antes", () => {
    expect(popoverDePassagem(col("afazer"), AGENTES)).not.toContain(`name="proxima"`);
  });
});

describe("item 5 (2026-11-10): a espera num chip com sino", () => {
  const agora = new Date(2026, 10, 10, 9, 0).getTime();
  const volta = (o: Partial<{ em: number | null; quando: "ci" | null; motivo: string | null }>) => ({ tipo: "esperando" as const, motivo: null, volta: { motivo: null, em: null, quando: null, prUrl: null, ...o } });
  it("a pessoa, a CI, a volta marcada (hoje e outro dia) e a outra espera", () => {
    expect(fraseDaEspera({ esperaPessoa: true, decide: null, estadoLinha: null }, agora)).toEqual({ texto: "Esperando você responder", voce: true });
    expect(fraseDaEspera({ esperaPessoa: true, decide: { pessoaId: "p", nome: "Breno", voce: false, saiu: null }, estadoLinha: null }, agora)).toEqual({ texto: "Esperando Breno responder", voce: false });
    expect(fraseDaEspera({ esperaPessoa: false, decide: null, estadoLinha: volta({ quando: "ci" }) }, agora)?.texto).toBe("Esperando a CI");
    expect(fraseDaEspera({ esperaPessoa: false, decide: null, estadoLinha: volta({ em: new Date(2026, 10, 10, 14, 0).getTime() }) }, agora)?.texto).toBe("Volta às 14:00");
    expect(fraseDaEspera({ esperaPessoa: false, decide: null, estadoLinha: volta({ em: new Date(2026, 10, 12, 8, 5).getTime() }) }, agora)?.texto).toBe("Volta 12/11 às 08:05");
    expect(fraseDaEspera({ esperaPessoa: false, decide: null, estadoLinha: { ...volta({}), motivo: "o comando" } }, agora)?.texto).toBe("Esperando · o comando");
    expect(fraseDaEspera({ esperaPessoa: false, decide: null, estadoLinha: { tipo: "trabalhando", frente: false } }, agora)).toBeNull();
  });
  it("o chip: sino, frase escapada, contorno sem fundo; o de você com a classe forte", () => {
    const h = String(chipDeEspera({ texto: "Esperando <b> responder", voce: false }));
    expect(h).toMatch(/^<span class="qd-espera" title="Esperando &lt;b&gt; responder"><svg class="qd-espera-ic"/);
    expect(String(chipDeEspera({ texto: "x", voce: true }))).toContain(`class="qd-espera qd-espera-voce"`);
  });
});
