import { describe, expect, it } from "vitest";
import type { TrabalhoDto } from "../../../src/contracts/trabalho.ts";
import { estadoInicial, type Estado } from "../../../web/estado/reducer.ts";
import { foraDoMac, pontoTrabalho, quandoVolta, situacaoDe, voltaMarcada } from "../../../web/lib/trabalhos.ts";
import { hora } from "../../../web/lib/render.ts";
import { renderEsteMac } from "../../../web/telas/este-mac.ts";
import { renderTopoTrabalho } from "../../../web/telas/trabalhos.ts";

/** ADR-086 (definido em 2026-10-08): a espera que não ocupa o Mac — um colega ou a volta marcada ("me chame às 16:00"). */

const AGORA = new Date(2026, 9, 8, 15, 0).getTime();
const VOLTA = AGORA + 20 * 60_000;
const trabalho = (id: string, extra: Partial<TrabalhoDto> = {}): TrabalhoDto => ({
  id, agenteId: "cec", conversaId: "c-cec", titulo: id, origem: "pessoa", pedidoPorAgenteId: null, rotinaId: null, trabalhoMaeId: null, depoisDeTrabalhoId: null, estado: "rodando",
  pasta: null, memoriaMb: null, custoUsd: null, criadoEm: AGORA - 3_600_000, iniciadoEm: AGORA - 3_600_000, terminadoEm: null, pedidoPorNome: null, rotinaNome: null, ultimoPasso: null, turnoVivoId: null, esperandoComputadorDe: null, ...extra,
});

const comVolta = trabalho("Acompanhar o CI", { acordaEm: VOLTA });
const comColega = trabalho("Orquestrar", { esperandoColega: { nome: "Eng 2", desde: AGORA - 600_000, trabalhoId: "t-eng" } });
const trabalhando = trabalho("Rodar os testes", { turnoVivoId: "turno-1", memoriaMb: 300 });

function estadoCom(trabalhos: TrabalhoDto[], resto: Partial<Estado> = {}): Estado {
  return {
    ...estadoInicial, agora: AGORA, sessao: { tenantId: "t", pessoaId: "p" },
    frota: { agentes: [{ id: "cec", nome: "Cecília", conversaId: "c-cec", cor: "c-amber", forma: "shape-capsule", ownerId: "p", titulo: "PM", descricao: "", confirmado: true }] } as never,
    trabalhos: { trabalhos, pressao: "verde", memoriaTotalMb: 300, processador: "verde", cargaProcessador: 0.3, segurando: false },
    ...resto,
  };
}

describe("fora do Mac (ADR-086)", () => {
  it("a volta marcada: só rodando e sem turno vivo; a linha diz quando volta e o ponto é o vazado da espera", () => {
    expect(voltaMarcada(comVolta)).toBe(VOLTA);
    expect(voltaMarcada({ ...comVolta, turnoVivoId: "turno-2" })).toBeNull();
    expect(voltaMarcada({ ...comVolta, estado: "terminado" })).toBeNull();
    expect(situacaoDe(comVolta, [], false, AGORA)).toBe(`volta às ${hora(VOLTA)}`);
    expect(pontoTrabalho(comVolta, "c-amber")).toContain("ponto-trabalho fora-do-mac");
  });

  it("fora do Mac = esperando colega ou a volta marcada; quem tem processo vivo não", () => {
    expect(foraDoMac(comVolta)).toBe(true);
    expect(foraDoMac(comColega)).toBe(true);
    expect(foraDoMac(trabalhando)).toBe(false);
  });

  it("Este Mac: quem espera fora do Mac aparece à parte de quem trabalha", () => {
    const html = renderEsteMac(estadoCom([trabalhando, comVolta, comColega]));
    expect(html).toContain("Fora do Mac · 2");
    expect(html).toContain("esperando sem ocupar o Mac; voltam sozinhas");
    expect(html).toContain(`volta às ${hora(VOLTA)}`);
    expect(html).toContain("esperando Eng 2");
    expect(html).toContain("Trabalhando · 1");
  });

  it("o cartão do tempo diz que a espera não ocupa o Mac e que volta sozinha", () => {
    const colega = renderTopoTrabalho(estadoCom([comColega], { tempoTaskAberto: comColega.id }), comColega.id);
    // Um fecho só, no rodapé, com a hora uma vez (revisão do #212).
    expect(colega).toContain(`Eng 2 recebeu o pedido às ${hora(comColega.esperandoColega!.desde)} · fora do Mac, volta sozinha`);
    expect(colega).not.toContain("tk-pop-fora");
    const volta = renderTopoTrabalho(estadoCom([comVolta], { tempoTaskAberto: comVolta.id }), comVolta.id);
    expect(volta).toContain(`<div class="tk-pop-rodape"><span>fora do Mac · volta às ${hora(VOLTA)}</span></div>`);
    expect(volta).toMatch(/class="tk-status fora-do-mac"[^>]*>volta às/);
  });

  it("revisão do #212: a volta de outro dia diz o dia — 'amanhã às 09:00' não lê como hoje", () => {
    const amanha = new Date(2026, 9, 9, 9, 0).getTime();
    const depois = new Date(2026, 9, 12, 9, 0).getTime();
    expect(quandoVolta(VOLTA, AGORA)).toBe(`às ${hora(VOLTA)}`);
    expect(quandoVolta(amanha, AGORA)).toBe(`amanhã às ${hora(amanha)}`);
    expect(quandoVolta(depois, AGORA)).toBe(`em 12/10 às ${hora(depois)}`);
    expect(situacaoDe({ ...comVolta, acordaEm: amanha }, [], false, AGORA)).toBe(`volta amanhã às ${hora(amanha)}`);
  });
});
