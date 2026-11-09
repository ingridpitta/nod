import { describe, expect, it } from "vitest";
import {
  CARENCIA_FIM_CONCLUIDO_MS,
  decidirEsperaDeColega,
  duracaoCurta,
  type EsperaDeColega,
  esperaVencida,
  MOTIVO_EXCLUIDO,
  MOTIVO_NAO_COMECOU,
  MOTIVO_PARADO,
  MOTIVO_SEM_RESPOSTA,
  MOTIVO_SEM_TEXTO,
  motivoDaDesistencia,
  podeCobrar,
  PRAZO_ESPERA_DE_COLEGA_MS,
  semResposta,
  TETO_ESPERA_DE_COLEGA_MS,
} from "../../../src/domain/espera-de-colega.ts";
import { motivoEmPortugues } from "../../../src/domain/redacao.ts";

const H = 3_600_000;
const AGORA = 1_800_000_000_000;

function espera(p: Partial<EsperaDeColega> = {}): EsperaDeColega {
  return {
    tarefaId: "t1",
    criadoEm: AGORA - H,
    cobradoEm: null,
    cobrancas: 0,
    colegaExcluido: false,
    colegaLivre: true,
    rodando: false,
    vivo: false,
    aguardando: false,
    naFila: false,
    filaDesde: null,
    rodou: true,
    ultimo: { id: "u1", estado: "concluido", motivo: null, fimEm: AGORA - H },
    textoFinal: "PR revisado.",
    ...p,
  };
}
const decidir = (e: EsperaDeColega, agora = AGORA) => decidirEsperaDeColega(e, agora, motivoEmPortugues);

describe("espera de colega (NOD-377): toda espera tem fim", () => {
  it("o pedido de 30 dias com o colega terminado é fechado em silêncio (teto de 7 d), de qualquer jeito que a cadeia acabou", () => {
    for (const ultimo of [
      { id: "u1", estado: "concluido", motivo: null, fimEm: AGORA - 30 * 24 * H },
      { id: "u1", estado: "interrompido", motivo: "maquina_sem_contato", fimEm: AGORA - 30 * 24 * H },
      { id: "u1", estado: "interrompido", motivo: "executor_indisponivel", fimEm: AGORA - 30 * 24 * H },
      { id: "u1", estado: "interrompido", motivo: "parado_pela_pessoa", fimEm: AGORA - 30 * 24 * H },
    ]) {
      expect(decidir(espera({ criadoEm: AGORA - 30 * 24 * H, ultimo, textoFinal: null }))).toEqual({ tipo: "limpar", turnoId: "t1", resultado: null });
    }
    // Revisão do PR #544 (M6): concluído com fala e nunca entregue — o teto entrega a fala (sem acordar), pela raiz (revisão 2, M2).
    const concluiu = { id: "u1", estado: "concluido", motivo: null, fimEm: AGORA - 29 * 24 * H };
    expect(decidir(espera({ criadoEm: AGORA - 30 * 24 * H, ultimo: concluiu }))).toEqual({ tipo: "limpar", turnoId: "t1", resultado: "PR revisado." });
    // Revisão 2 (M6): com a cadeia ainda aguardando frentes, a última fala é intermediária — fecha com o aviso.
    expect(decidir(espera({ criadoEm: AGORA - 30 * 24 * H, ultimo: concluiu, aguardando: true, textoFinal: "Abri 3 frentes; volto com o resultado." }))).toEqual({ tipo: "limpar", turnoId: "t1", resultado: null });
    // Caído com fala parcial: não é resultado.
    expect(decidir(espera({ criadoEm: AGORA - 30 * 24 * H, ultimo: { id: "u1", estado: "interrompido", motivo: "maquina_sem_contato", fimEm: AGORA - 29 * 24 * H } }))).toEqual({ tipo: "limpar", turnoId: "t1", resultado: null });
    // Até rodando: uma semana sem resposta não é mais espera.
    expect(decidir(espera({ criadoEm: AGORA - TETO_ESPERA_DE_COLEGA_MS, rodando: true }))).toMatchObject({ tipo: "limpar" });
    // A cobrança recomeça o relógio do teto também.
    expect(decidir(espera({ criadoEm: AGORA - 8 * 24 * H, cobradoEm: AGORA - H, cobrancas: 1, rodando: true }))).toEqual({ tipo: "esperar" });
  });

  it("concluído sem entrega: entrega a última fala depois da carência; sem fala, avisa", () => {
    // Pela raiz (revisão 2 do PR #544, M2): o último turno pode ser de uma task de colega antiga, fora da cadeia.
    expect(decidir(espera())).toEqual({ tipo: "entregar", turnoId: "t1", texto: "PR revisado." });
    expect(decidir(espera({ ultimo: { id: "u1", estado: "concluido", motivo: null, fimEm: AGORA - CARENCIA_FIM_CONCLUIDO_MS + 1 } }))).toEqual({ tipo: "esperar" });
    expect(decidir(espera({ textoFinal: null }))).toEqual({ tipo: "avisar", motivo: MOTIVO_SEM_TEXTO, turnoId: "t1", final: false });
  });

  it("caiu: as últimas 24 h da queda são do varredor de pedidos parados; depois, avisa com o motivo legível", () => {
    const caiu = (fimEm: number, motivo = "executor_indisponivel") => espera({ criadoEm: AGORA - 3 * 24 * H, ultimo: { id: "u1", estado: "interrompido", motivo, fimEm } });
    expect(decidir(caiu(AGORA - 2 * H))).toEqual({ tipo: "esperar" });
    expect(decidir(caiu(AGORA - 25 * H))).toEqual({ tipo: "avisar", motivo: motivoEmPortugues("executor_indisponivel"), turnoId: "t1", final: false });
    expect(decidir(caiu(AGORA - 25 * H, "maquina_sem_contato"))).toEqual({ tipo: "avisar", motivo: motivoEmPortugues("maquina_sem_contato"), turnoId: "t1", final: false });
  });

  it("Parar da pessoa e colega excluído: avisa na hora", () => {
    expect(decidir(espera({ ultimo: { id: "u1", estado: "interrompido", motivo: "parado_pela_pessoa", fimEm: AGORA } }))).toEqual({ tipo: "avisar", motivo: MOTIVO_PARADO, turnoId: "t1", final: false });
    expect(decidir(espera({ colegaExcluido: true, rodando: true }))).toEqual({ tipo: "avisar", motivo: MOTIVO_EXCLUIDO, turnoId: "t1", final: false });
  });

  it("rodando espera (até o teto); na fila espera até P e depois avisa 'sem resposta em 24 h'", () => {
    expect(decidir(espera({ criadoEm: AGORA - 3 * 24 * H, rodando: true }))).toEqual({ tipo: "esperar" });
    expect(decidir(espera({ naFila: true }))).toEqual({ tipo: "esperar" });
    expect(decidir(espera({ naFila: true, criadoEm: AGORA - PRAZO_ESPERA_DE_COLEGA_MS }))).toEqual({ tipo: "avisar", motivo: MOTIVO_SEM_RESPOSTA, turnoId: "t1", final: true });
    // Revisão 8 do PR #544 (A1): o pedido é velho, mas o turno da fila ficou pronto há 1 h (a decisão aprovada, a volta
    // da cota): espera; parado há P, "sem resposta".
    expect(decidir(espera({ naFila: true, criadoEm: AGORA - 30 * H, filaDesde: AGORA - H }))).toEqual({ tipo: "esperar" });
    expect(decidir(espera({ naFila: true, criadoEm: AGORA - 30 * H, filaDesde: AGORA - PRAZO_ESPERA_DE_COLEGA_MS }))).toMatchObject({ tipo: "avisar", motivo: MOTIVO_SEM_RESPOSTA });
    // Cobrado há 1 h: o prazo recomeçou.
    expect(decidir(espera({ naFila: true, criadoEm: AGORA - 30 * H, cobradoEm: AGORA - H, cobrancas: 1 }))).toEqual({ tipo: "esperar" });
  });

  it("a triagem com frentes abertas ou decisão da pessoa em aberto espera até o teto, sem aviso (revisão do PR #544)", () => {
    expect(decidir(espera({ criadoEm: AGORA - 3 * 24 * H, aguardando: true }))).toEqual({ tipo: "esperar" });
    expect(decidir(espera({ criadoEm: AGORA - TETO_ESPERA_DE_COLEGA_MS, aguardando: true }))).toMatchObject({ tipo: "limpar" });
  });

  it("nunca rodou: com o colega livre, uma reentrega depois da carência do varredor de pedidos parados; na segunda vez, avisa; com o colega ocupado, espera até P", () => {
    const nunca = (p: Partial<EsperaDeColega>, fimEm = AGORA - 25 * H) => espera({ criadoEm: AGORA - 26 * H, rodou: false, ultimo: { id: "u1", estado: "interrompido", motivo: "preso_sem_contato", fimEm }, ...p });
    // A reentrega retoma o último da cadeia de retomadas (retomarDe), nunca o `ultimo` de uma task antiga (M2); sem ele, a raiz.
    expect(decidir(nunca({ retomarDe: "r1" }))).toEqual({ tipo: "reentregar", turnoId: "r1" });
    expect(decidir(nunca({}))).toEqual({ tipo: "reentregar", turnoId: "t1" });
    // Revisão do PR #544 (M9): a queda das últimas 24 h ainda é do varredor de pedidos parados (ADR-084).
    expect(decidir(nunca({ criadoEm: AGORA - 2 * H }, AGORA - H))).toEqual({ tipo: "esperar" });
    expect(decidir(nunca({ cobrancas: 1, cobradoEm: AGORA - H }))).toEqual({ tipo: "avisar", motivo: MOTIVO_NAO_COMECOU, turnoId: "t1", final: true });
    expect(decidir(nunca({ colegaLivre: false, criadoEm: AGORA - 2 * H }))).toEqual({ tipo: "esperar" });
    expect(decidir(nunca({ colegaLivre: false }))).toEqual({ tipo: "avisar", motivo: MOTIVO_SEM_RESPOSTA, turnoId: "t1", final: true });
  });

  it("vencida, Cobrar e a duração do 'sem resposta há X'", () => {
    expect(esperaVencida(espera({ criadoEm: AGORA - 26 * H }), AGORA)).toBe(true);
    expect(esperaVencida(espera({ criadoEm: AGORA - 26 * H, cobradoEm: AGORA - 60_000 }), AGORA)).toBe(false);
    expect(podeCobrar(espera({ criadoEm: AGORA - 26 * H }), AGORA)).toBe(true);
    expect(podeCobrar(espera({ criadoEm: AGORA - 50 * H, cobradoEm: AGORA - 25 * H, cobrancas: 1 }), AGORA)).toBe(false);
    expect(podeCobrar(espera({ criadoEm: AGORA - 26 * H, colegaExcluido: true }), AGORA)).toBe(false);
    expect(podeCobrar(espera({ criadoEm: AGORA - H }), AGORA)).toBe(false);
    // M8: com a cadeia ocupada (rodando, na fila, frentes ou decisão), cobrar só duplicaria o trabalho.
    expect(podeCobrar({ ...espera({ criadoEm: AGORA - 26 * H }), ocupada: true }, AGORA)).toBe(false);
    expect(duracaoCurta(26 * H)).toBe("26 h");
    expect(duracaoCurta(21 * 24 * H)).toBe("21 d");
    expect(duracaoCurta(40 * 60_000)).toBe("40 min");
    expect(motivoDaDesistencia(AGORA - 26 * H, AGORA)).toBe("a pessoa desistiu depois de 26 h sem resposta");
  });
  it("revisão 9 do PR #544 (B1): semResposta — rodando ou aguardando nunca; na fila, só com a fila parada há P; parada, pelo relógio do pedido", () => {
    const velha = AGORA - PRAZO_ESPERA_DE_COLEGA_MS - H;
    expect(semResposta(espera({ criadoEm: velha }), AGORA)).toBe(true);
    expect(semResposta(espera({ criadoEm: AGORA - H }), AGORA)).toBe(false);
    expect(semResposta(espera({ criadoEm: velha, rodando: true }), AGORA)).toBe(false);
    expect(semResposta(espera({ criadoEm: velha, aguardando: true }), AGORA)).toBe(false);
    expect(semResposta(espera({ criadoEm: velha, naFila: true, filaDesde: AGORA - H }), AGORA)).toBe(false);
    expect(semResposta(espera({ criadoEm: velha, naFila: true, filaDesde: velha }), AGORA)).toBe(true);
    // Cobrada há pouco, o relógio recomeça.
    expect(semResposta(espera({ criadoEm: velha, cobradoEm: AGORA - H }), AGORA)).toBe(false);
  });
  it("revisão 10 do PR #544: sem turno na cadeia, espera até P e depois avisa 'sem resposta'", () => {
    expect(decidir(espera({ ultimo: null, criadoEm: AGORA - H }))).toEqual({ tipo: "esperar" });
    expect(decidir(espera({ ultimo: null, criadoEm: AGORA - PRAZO_ESPERA_DE_COLEGA_MS - H }))).toEqual({ tipo: "avisar", motivo: MOTIVO_SEM_RESPOSTA, turnoId: "t1", final: true });
  });
  it("QA do PR #544 (bug 1): no teto, com um turno vivo agora, espera; sem ele, limpa", () => {
    const velha = AGORA - TETO_ESPERA_DE_COLEGA_MS - H;
    expect(decidir(espera({ criadoEm: velha, rodando: true, vivo: true }))).toEqual({ tipo: "esperar" });
    expect(decidir(espera({ criadoEm: velha, rodando: true }))).toMatchObject({ tipo: "limpar" });
  });
});
