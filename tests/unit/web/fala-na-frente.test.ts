import { describe, expect, it } from "vitest";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import type { TrabalhoDetalheDto, TrabalhoDto } from "../../../src/contracts/trabalho.ts";
import { aplicarFrame, estadoInicial, reduzir, type Estado } from "../../../web/estado/reducer.ts";
import { chipDaFalaNaFrente } from "../../../web/telas/conversa.ts";
import { blocosDoHistoricoDaTask } from "../../../web/telas/trabalhos.ts";

/** NOD-376: a fala que a pessoa escreve na tela da frente mostra onde está — "Na fila" / "Entregue" — até o bot responder. */
const AGORA = new Date(2026, 9, 26, 20, 0).getTime();
const trabalho = (extra: Partial<TrabalhoDto> = {}): TrabalhoDto => ({
  id: "f1", agenteId: "x", conversaId: "c-x", titulo: "NOD-370", origem: "pessoa", pedidoPorAgenteId: null, rotinaId: null, trabalhoMaeId: null, depoisDeTrabalhoId: null, estado: "rodando",
  pasta: null, memoriaMb: null, custoUsd: null, criadoEm: AGORA - 600_000, iniciadoEm: AGORA - 500_000, terminadoEm: null, pedidoPorNome: null, rotinaNome: null, ultimoPasso: null, turnoVivoId: "tv", esperandoComputadorDe: null, ...extra,
});
const pessoa = { autor_tipo: "pessoa", autor_id: "p", sob_procuracao_de: null, conta_de_execucao: "p", executor: "catcher", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "regra:teste", regra_versao: 1 } as const;
const fala = (id: string, texto: string): Mensagem => ({ tenantId: "t", id, conversaId: "c-x", turnoId: null, autoria: pessoa, kind: "texto", texto, payload: null, confianca: "confiavel", parcial: false, criadoEm: AGORA - 1000, trabalhoId: "f1", origemTurno: "conversa", fimDoTurno: false }) as Mensagem;

function naFrente(t: TrabalhoDto, falasNaFila?: TrabalhoDetalheDto["falasNaFila"]): Estado {
  const base: Estado = {
    ...estadoInicial, agora: AGORA, sessao: { tenantId: "t", pessoaId: "p" },
    frota: { agentes: [{ id: "x", nome: "Faustino", conversaId: "c-x", cor: "c-green", forma: "shape-square", ownerId: "p", titulo: "Eng", descricao: "", confirmado: true }] } as never,
    trabalhos: { trabalhos: [t], pressao: null, memoriaTotalMb: null },
    tela: { tipo: "trabalho", id: "f1", voltar: { tipo: "conversa", conversaId: "c-x", agenteId: "x" } },
  };
  return reduzir(base, { tipo: "hidratar-trabalho", detalhe: { trabalho: t, mensagens: [fala("m1", "Oi"), fala("m2", "E o deploy?")], ...(falasNaFila ? { falasNaFila } : {}) }, agora: AGORA });
}
const htmlDe = (e: Estado, id: string) => blocosDoHistoricoDaTask(e, "f1").find((b) => b.chave === id)?.html ?? "";

describe("NOD-376: o chip da fala na tela da frente", () => {
  it("o texto diz quem lê e quando, e escapa o nome", () => {
    expect(chipDaFalaNaFrente("na_fila", "Faustino", { rodando: true })).toContain("Na fila · Faustino lê no próximo passo");
    expect(chipDaFalaNaFrente("na_fila", "Faustino", { rodando: false })).toContain("Na fila · Faustino volta à frente para responder");
    expect(chipDaFalaNaFrente("entregue", "Faustino", { rodando: true })).toContain("Entregue · Faustino lê ao fim do passo atual");
    expect(chipDaFalaNaFrente("lendo", "Faustino", { rodando: true })).toContain("Entregue · Faustino está lendo agora");
    expect(chipDaFalaNaFrente("na_fila", "Faustino", { rodando: false, precisaDeVoce: true })).toContain("lê depois que você responder o que ele perguntou");
    expect(chipDaFalaNaFrente("na_fila", "<b>", { rodando: true })).toContain("&lt;b&gt;");
    expect(chipDaFalaNaFrente("na_fila", "X", { rodando: true })).toContain('class="fila-chip" role="status"');
  });

  it("só a fala listada em falasNaFila ganha o chip, embaixo do balão dela", () => {
    const e = naFrente(trabalho(), [{ mensagemId: "m2", situacao: "na_fila" }]);
    expect(htmlDe(e, "m2")).toContain("Na fila · Faustino lê no próximo passo");
    expect(htmlDe(e, "m1")).not.toContain("fila-chip");
  });

  it("o turno que começa na conversa da frente relê o detalhe da task (o chip não fica velho na reabertura)", () => {
    const e = naFrente(trabalho({ estado: "terminado", turnoVivoId: null }), [{ mensagemId: "m2", situacao: "na_fila" }]);
    const depois = aplicarFrame(e, { streamId: "s", seq: 1, pessoaId: "p", tipo: "turno.iniciado", dados: { turnoId: "t2", conversaId: "c-x", kind: "turno_despachado" } } as never, AGORA);
    expect(depois.invalidacoes).toContain("trabalho:f1");
  });

  it("a frente parada diz que o bot volta para responder; entregue muda o texto; sem situação, sem chip", () => {
    expect(htmlDe(naFrente(trabalho({ estado: "terminado", turnoVivoId: null }), [{ mensagemId: "m1", situacao: "na_fila" }]), "m1")).toContain("volta à frente para responder");
    expect(htmlDe(naFrente(trabalho(), [{ mensagemId: "m1", situacao: "entregue" }]), "m1")).toContain("Entregue · Faustino");
    expect(htmlDe(naFrente(trabalho()), "m1")).not.toContain("fila-chip");
  });
});
