import { describe, expect, it } from "vitest";
import { classificarFimDaFrente, decidirFrenteCaida, decidirPedidoParado, DESISTIR_SEM_SINAL_MS, MAX_QUEDAS_POR_PEDIDO, RETOMAR_ATE_MS, type PedidoParado } from "../../../src/domain/pedido-parado.ts";

/** A regra de src/domain/pedido-parado.ts (2026-10-08): o que fazer com um pedido a colega que parou sem voltar. */
const AGORA = Date.parse("2026-10-08T15:00:00Z");
const legivel = (m: string) => `<${m}>`;
const base: PedidoParado = {
  tarefaId: "tarefa",
  trabalhoColegaId: "colega",
  estadoColega: "falhou",
  ultimoTurnoId: "ultimo",
  ultimoMotivo: "executor_indisponivel",
  ultimoMotivoFalha: null,
  quedaEm: AGORA - 60_000,
  quedas: 1,
  cardRetomar: null,
  sinalDepoisDaQueda: false,
  textoFinal: null,
  turnoDoTextoFinal: null,
};
const decidir = (p: Partial<PedidoParado>) => decidirPedidoParado({ ...base, ...p }, AGORA, legivel);

describe("decidirPedidoParado", () => {
  it("NOD-309 (PR 3): retomada já na fila (a queda no fundo a enfileirou) = esperar, mesmo com sinal, queda velha ou no teto", () => {
    expect(decidir({ retomadaNaFila: true, sinalDepoisDaQueda: true })).toEqual({ tipo: "esperar" });
    expect(decidir({ retomadaNaFila: true, quedaEm: AGORA - 3 * 3_600_000 })).toEqual({ tipo: "esperar" });
    expect(decidir({ retomadaNaFila: true, estadoColega: "precisa_de_voce", quedas: 9 })).toEqual({ tipo: "esperar" });
    expect(decidirFrenteCaida({ ...base, retomadaNaFila: true, sinalDepoisDaQueda: true }, AGORA, legivel)).toEqual({ tipo: "esperar" });
    // Sem ela, a regra de antes: retoma quando as máquinas voltam.
    expect(decidir({ sinalDepoisDaQueda: true })).toMatchObject({ tipo: "retomar" });
  });

  it("terminou: entrega a fala final; sem fala, avisa que terminou sem resposta", () => {
    expect(decidir({ estadoColega: "terminado", textoFinal: "feito", turnoDoTextoFinal: "t9" })).toEqual({ tipo: "entregar_resultado", turnoId: "t9", texto: "feito" });
    expect(decidir({ estadoColega: "terminado" })).toEqual({ tipo: "avisar_falha", motivo: "terminou sem resposta" });
  });

  it("parado: avisa sem esperar nada da cadeia parada (#218)", () => {
    expect(decidir({ estadoColega: "parado" })).toEqual({ tipo: "avisar_falha", motivo: "a task foi parada antes de terminar", semEsperar: true });
  });

  it("caiu por infraestrutura: espera o sinal de volta e retoma, contando a tentativa", () => {
    expect(decidir({})).toEqual({ tipo: "esperar" });
    expect(decidir({ sinalDepoisDaQueda: true })).toEqual({ tipo: "retomar", turnoId: "ultimo", tentativa: 2 });
    expect(decidir({ ultimoMotivo: "maquina_sem_contato", estadoColega: "precisa_de_voce", cardRetomar: { id: "c", aberto: true }, sinalDepoisDaQueda: true })).toMatchObject({ tipo: "retomar" });
  });

  it(`com ${MAX_QUEDAS_POR_PEDIDO} quedas, ou sem sinal em 30 min, desiste e avisa`, () => {
    expect(decidir({ quedas: MAX_QUEDAS_POR_PEDIDO, sinalDepoisDaQueda: true })).toEqual({ tipo: "avisar_falha", motivo: `<executor_indisponivel> (caiu ${MAX_QUEDAS_POR_PEDIDO} vezes)`, semEsperar: true });
    expect(decidir({ quedaEm: AGORA - DESISTIR_SEM_SINAL_MS - 1 })).toMatchObject({ tipo: "avisar_falha", semEsperar: true });
    expect(decidir({ quedaEm: AGORA - DESISTIR_SEM_SINAL_MS + 1 })).toEqual({ tipo: "esperar" });
  });

  it("queda de mais de 2 h não é retomada, mesmo com as máquinas de volta: avisa", () => {
    expect(decidir({ quedaEm: AGORA - RETOMAR_ATE_MS - 1, sinalDepoisDaQueda: true })).toEqual({ tipo: "avisar_falha", motivo: "<executor_indisponivel>, e já faz mais de 2 h", semEsperar: true });
    expect(decidir({ quedaEm: AGORA - RETOMAR_ATE_MS + 1, sinalDepoisDaQueda: true })).toMatchObject({ tipo: "retomar" });
  });

  it("o \"Retomar\" que a pessoa já resolveu é dela: não retoma por cima", () => {
    // Avisa esperando o que a cadeia ainda tiver em aberto: só a desistência de uma queda passa por cima (#218).
    expect(decidir({ ultimoMotivo: "maquina_sem_contato", cardRetomar: { id: "c", aberto: false }, sinalDepoisDaQueda: true })).toEqual({ tipo: "avisar_falha", motivo: "<maquina_sem_contato>" });
    expect(decidir({ ultimoMotivo: "maquina_sem_contato", estadoColega: "precisa_de_voce", cardRetomar: { id: "c", aberto: false } })).toEqual({ tipo: "esperar" });
  });

  it("precisa de você por outra decisão: espera (o vencimento de 24 h já avisa); falhou por outro motivo: avisa com o motivo", () => {
    expect(decidir({ estadoColega: "precisa_de_voce", ultimoMotivo: null })).toEqual({ tipo: "esperar" });
    expect(decidir({ ultimoMotivo: "trabalho_incompleto" })).toEqual({ tipo: "avisar_falha", motivo: "<trabalho_incompleto>" });
  });

  it("NOD-274 (C6): recusado esperando a cota ou a conta — espera, mesmo com sinal de volta, sem retomar nem avisar", () => {
    for (const ultimoMotivoFalha of ["limite_do_plano", "sem_conta"]) {
      expect(decidir({ ultimoMotivoFalha, sinalDepoisDaQueda: true })).toEqual({ tipo: "esperar" });
      expect(decidir({ ultimoMotivoFalha, quedas: MAX_QUEDAS_POR_PEDIDO, quedaEm: AGORA - RETOMAR_ATE_MS - 1 })).toEqual({ tipo: "esperar" });
      expect(decidir({ ultimoMotivoFalha, estadoColega: "precisa_de_voce", cardRetomar: { id: "c", aberto: true }, sinalDepoisDaQueda: true })).toEqual({ tipo: "esperar" });
    }
  });

  it("NOD-274 (C6): sem a IA ou sem login na máquina — avisa na hora, com o motivo da falha, sem esperar sinal nem contar queda", () => {
    for (const ultimoMotivoFalha of ["motor_ausente", "nao_autenticado"]) {
      expect(decidir({ ultimoMotivoFalha, quedas: 0 })).toEqual({ tipo: "avisar_falha", motivo: `<${ultimoMotivoFalha}>`, semEsperar: true });
      expect(decidir({ ultimoMotivoFalha, sinalDepoisDaQueda: true })).toEqual({ tipo: "avisar_falha", motivo: `<${ultimoMotivoFalha}>`, semEsperar: true });
    }
    // O mesmo `executor_indisponivel` sem motivo de recusa continua sendo queda (retoma com sinal).
    expect(decidir({ ultimoMotivoFalha: null, sinalDepoisDaQueda: true })).toMatchObject({ tipo: "retomar" });
  });
});

describe("decidirFrenteCaida (ADR-099, I9): a frente de lote que caiu", () => {
  const caida: Partial<PedidoParado> = { estadoColega: "precisa_de_voce", ultimoMotivo: "maquina_sem_contato", cardRetomar: { id: "c", aberto: true } };
  const frente = (p: Partial<PedidoParado>) => decidirFrenteCaida({ ...base, ...caida, ...p }, AGORA, legivel);

  it("caiu e as máquinas voltaram: retoma, contando a tentativa; sem sinal ainda, espera", () => {
    expect(frente({})).toEqual({ tipo: "esperar" });
    expect(frente({ sinalDepoisDaQueda: true })).toEqual({ tipo: "retomar", turnoId: "ultimo", tentativa: 2 });
    expect(frente({ sinalDepoisDaQueda: true, quedas: 2 })).toEqual({ tipo: "retomar", turnoId: "ultimo", tentativa: 3 });
  });

  it(`na ${MAX_QUEDAS_POR_PEDIDO}ª queda, ou com a queda de mais de 2 h, desiste com o motivo (a frente fecha falhou)`, () => {
    expect(frente({ quedas: MAX_QUEDAS_POR_PEDIDO, sinalDepoisDaQueda: true })).toEqual({ tipo: "desistir", motivo: `<maquina_sem_contato> (caiu ${MAX_QUEDAS_POR_PEDIDO} vezes)` });
    expect(frente({ quedaEm: AGORA - RETOMAR_ATE_MS - 1, sinalDepoisDaQueda: true })).toEqual({ tipo: "desistir", motivo: "<maquina_sem_contato>, e já faz mais de 2 h" });
    expect(frente({ quedaEm: AGORA - RETOMAR_ATE_MS - 1 })).toEqual({ tipo: "desistir", motivo: "<maquina_sem_contato>, e já faz mais de 2 h" });
  });

  it("NOD-241 (CA4c): sem sinal, a frente espera até 2 h, não 30 min — o pedido a colega segue desistindo aos 30 min", () => {
    expect(frente({ quedaEm: AGORA - DESISTIR_SEM_SINAL_MS - 60_000 })).toEqual({ tipo: "esperar" });
    expect(frente({ quedaEm: AGORA - RETOMAR_ATE_MS + 60_000 })).toEqual({ tipo: "esperar" });
    expect(decidir({ quedaEm: AGORA - DESISTIR_SEM_SINAL_MS - 60_000 })).toMatchObject({ tipo: "avisar_falha", semEsperar: true });
  });

  it("o \"Retomar\" já decidido pela pessoa, ou a frente parada por outra pergunta: espera — a decisão é dela", () => {
    expect(frente({ cardRetomar: { id: "c", aberto: false }, sinalDepoisDaQueda: true })).toEqual({ tipo: "esperar" });
    expect(frente({ ultimoMotivo: "trabalho_incompleto" })).toEqual({ tipo: "esperar" });
  });

  it("frente que terminou não é caso do varredor (a I3 já fechou o lote): espera", () => {
    expect(frente({ estadoColega: "terminado", textoFinal: "feito", turnoDoTextoFinal: "t" })).toEqual({ tipo: "esperar" });
  });
});

describe("classificarFimDaFrente (NOD-282, G4): a classificação única do fecho e do varredor", () => {
  it.each([
    ["executor_indisponivel", "motor_ausente", "recusa_aviso"],
    ["executor_indisponivel", "nao_autenticado", "recusa_aviso"],
    ["executor_indisponivel", "limite_do_plano", "recusa_espera"],
    ["executor_indisponivel", "sem_conta", "recusa_espera"],
    ["executor_indisponivel", null, "queda"],
    ["maquina_sem_contato", null, "queda"],
    ["reinicio_servidor", null, "queda"],
    ["executor_indisponivel", "erro_do_bot", "queda"],
    ["pergunta_vencida", null, "outro"],
    ["parado_pela_pessoa", null, "outro"],
    [null, null, "outro"],
  ] as const)("%s + %s → %s", (mi, mf, esperado) => {
    expect(classificarFimDaFrente(mi, mf)).toBe(esperado);
  });

  it("o varredor segue a mesma régua: recusa de espera espera, de aviso avisa sem esperar, queda retoma", () => {
    expect(decidirPedidoParado({ ...base, ultimoMotivoFalha: "limite_do_plano" }, AGORA, legivel)).toEqual({ tipo: "esperar" });
    expect(decidirPedidoParado({ ...base, ultimoMotivoFalha: "nao_autenticado" }, AGORA, legivel)).toEqual({ tipo: "avisar_falha", motivo: "<nao_autenticado>", semEsperar: true });
    expect(decidirPedidoParado({ ...base, sinalDepoisDaQueda: true }, AGORA, legivel)).toEqual({ tipo: "retomar", turnoId: "ultimo", tentativa: 2 });
  });
});
