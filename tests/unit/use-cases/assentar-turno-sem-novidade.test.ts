import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assentarTurno } from "../../../src/use-cases/assentar-turno.ts";
import { criarAgente } from "../../../src/use-cases/criar-agente.ts";
import { depsEmMemoria, executar } from "../../helpers/deps-l6.ts";

const SINAIS = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true };
const RESULTADO = { sessaoCli: null, sinais: SINAIS, custoUsd: 0.01, tokens: { entrada: 1, saida: 1, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [] };

/**
 * A supressão da FALA (definido em 2026-09-21). O outro ponto — o marcador "Rotina executou em ..."
 * — é coberto em tests/integration/rotina-sem-novidade.test.ts; os dois juntos é que dão o silêncio.
 *
 * O modelo pode chamar sem_novidade E ainda assim devolver texto (é comum: ele explica o que fez).
 * Esse texto não entra na conversa: quem pediu silêncio não fala.
 */
describe("assentarTurno: turno marcado com sem_novidade não escreve a fala na conversa", () => {
  async function cenario(origem: "rotina" | "conversa", opcoes: { marcar: boolean; desfecho?: "sucesso" | "interrompido" } = { marcar: true }) {
    const { deps, banco } = depsEmMemoria();
    const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
    const conversaId = criado.conversa.id;
    const turno = await deps.repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId: criado.agente.id, origem, entradaTexto: "verificar o Slack", entradaConfianca: "confiavel", prazoEm: deps.agora() + 60_000, profundidade: 0, modelo: "claude-haiku-4-5-20251001" });
    const machineId = randomUUID();
    await deps.repos.turnos.reivindicar({ machineId, agora: deps.agora() });
    if (opcoes.marcar) await deps.repos.turnos.marcarSemNovidade(turno!.id, "nada_mudou");
    const antes = (await deps.repos.mensagens.listarDaConversa(conversaId)).length;
    await executar(deps, assentarTurno, {
      turnoId: turno!.id,
      machineId,
      seqLocal: 1,
      fala: { tipo: "texto", texto: "Consultei o Slack: o Daniel ainda não respondeu, nenhum update." },
      resultado: opcoes.desfecho === "interrompido" ? { ...RESULTADO, desfecho: "interrompido" as const, texto: "", motivoInterrupcao: "trabalho_incompleto" as const } : { ...RESULTADO, desfecho: "sucesso" as const, texto: "ok" },
    });
    const depois = await deps.repos.mensagens.listarDaConversa(conversaId);
    return { novas: depois.slice(antes), banco };
  }

  it("turno de rotina com a marca: o texto do agente NÃO vira mensagem", async () => {
    const { novas } = await cenario("rotina");
    expect(novas).toEqual([]);
  });

  it("sem a marca, o mesmo turno de rotina escreve normalmente", async () => {
    const { novas } = await cenario("rotina", { marcar: false });
    expect(novas.map((m) => m.kind)).toEqual(["texto"]);
  });

  it("em conversa a marca é ignorada: a pessoa está esperando resposta", async () => {
    const { novas } = await cenario("conversa");
    expect(novas.map((m) => m.kind)).toEqual(["texto"]);
  });

  it("turno interrompido não é silenciado: o texto pode ser um relato parcial de bloqueio", async () => {
    const { novas } = await cenario("rotina", { marcar: true, desfecho: "interrompido" });
    expect(novas.map((m) => m.kind)).toContain("texto");
  });
});
