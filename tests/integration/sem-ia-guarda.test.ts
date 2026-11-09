import { randomBytes } from "node:crypto";
import { expect, it } from "vitest";
import type { Tx } from "../../src/shared/types.ts";
import { FALA_SEM_IA_PRIMEIRA, FALA_SEM_IA_SEGUINTE, PRAZO_SEM_IA_MS } from "../../src/domain/sem-ia.ts";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import { despacharTurno } from "../../src/use-cases/despachar-turno.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { enviarMensagem, lerConversa } from "../../src/use-cases/enviar-mensagem.ts";
import { depsSobreTrx, executar, MARLON } from "../helpers/deps-l6.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * Jornada C do onboarding (docs/specs/onboarding-jornada-c.md): sem IA neste computador, a fala da pessoa fica guardada
 * (turno `pendente` por 7 dias, a fala fixa do bot) e roda quando uma IA conecta. Só com `guardarSemIa`
 * (NOD_ONBOARDING_TEXTO=1); sem ela, nada muda.
 */
const PRONTO = { estado: "pronto" as const, versao: "teste", em: 0 };
const AUSENTE = { estado: "ausente" as const, motivo: "claude não encontrado", em: 0 };

async function montar(trx: Tx) {
  const deps = depsSobreTrx(trx, MARLON);
  const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
  const conversaId = criado.conversa.id;
  const agenteId = criado.agente.id;
  const chave = async () => {
    const c = await deps.repos.maquinaTokens.criar({ nome: "PC da Ana", prefixo: randomBytes(4).toString("hex"), hash: randomBytes(32) });
    if (!c) throw new Error("chave");
    return c.id;
  };
  return { deps, conversaId, agenteId, chave };
}

describeIntegracao("jornada C: sem IA, o bot responde e guarda a mensagem", () => {
  it("critérios 1 e 2: três mensagens sem IA — três turnos pendentes por 7 dias, três falas do bot (a primeira e duas curtas), nenhum interrompido", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps, conversaId } = await montar(trx);
      const antes = deps.agora();
      const saidas = [];
      for (const texto of ["oi", "me ajuda com a agenda", "e o e-mail?"]) saidas.push(await executar(deps, enviarMensagem, { conversaId, texto, inventario: AUSENTE, guardarSemIa: true }));
      for (const { data, events } of saidas) {
        expect(data.turno).toMatchObject({ estado: "pendente" });
        expect(data.turno.prazoEm - PRAZO_SEM_IA_MS).toBeGreaterThanOrEqual(antes);
        expect(data.turno.prazoEm - PRAZO_SEM_IA_MS).toBeLessThanOrEqual(deps.agora());
        expect(data.negacao?.payload).toMatchObject({ kind: "negacao", aguardaIa: true, terminal: false });
        expect(events.map((e) => e.kind)).toEqual(["mensagem_criada", "turno_criado", "mensagem_criada"]);
      }
      expect(saidas.map((s) => s.data.negacao?.texto)).toEqual([FALA_SEM_IA_PRIMEIRA, FALA_SEM_IA_SEGUINTE, FALA_SEM_IA_SEGUINTE]);
      const turnos = await deps.repos.turnos.listarDaConversa(conversaId);
      expect(turnos.filter((t) => t.estado === "interrompido")).toEqual([]);
      const lida = (await executar(deps, lerConversa, { conversaId })).data;
      expect(lida.mensagens.some((m) => m.texto.includes("Turno interrompido"))).toBe(false);
      expect(lida.turnosEmCurso.map((t) => t.estado)).toEqual(["pendente", "pendente", "pendente"]);
    });
  });

  it("sem a flag, o caminho de sempre: o turno nasce interrompido com a negação plano_ausente", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps, conversaId } = await montar(trx);
      const { data } = await executar(deps, enviarMensagem, { conversaId, texto: "oi", inventario: AUSENTE });
      expect(data.turno).toMatchObject({ estado: "interrompido", motivoInterrupcao: "executor_indisponivel" });
      expect(data.negacao?.payload).toMatchObject({ classe: "plano_ausente", terminal: true });
      expect(data.negacao?.payload).not.toHaveProperty("aguardaIa");
    });
  });

  it("com a IA pronta, a flag não muda nada (o turno nasce pendente com o prazo de sempre e sem fala)", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps, conversaId } = await montar(trx);
      const antes = deps.agora();
      const { data } = await executar(deps, enviarMensagem, { conversaId, texto: "oi", inventario: PRONTO, guardarSemIa: true, prazoMs: 1000 });
      expect(data.negacao).toBeNull();
      expect(data.turno.prazoEm - 1000).toBeGreaterThanOrEqual(antes);
      expect(data.turno.prazoEm - 1000).toBeLessThanOrEqual(deps.agora());
    });
  });

  it("reivindicar: a máquina-alvo sem IA não pega a fala guardada; o turno sem fala guardada continua indo para ela (não regressão)", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps, conversaId, agenteId, chave } = await montar(trx);
      const maquina = await chave();
      await deps.repos.agentes.definirMaquina([agenteId], maquina);
      const guardado = (await executar(deps, enviarMensagem, { conversaId, texto: "oi", inventario: AUSENTE, guardarSemIa: true })).data.turno;
      expect(await deps.repos.turnos.reivindicar({ machineId: maquina, agora: deps.agora(), harnessesProntos: [] })).toBeNull();
      // Com a IA do turno pronta na máquina, ela pega a fala guardada.
      expect(await deps.repos.turnos.reivindicar({ machineId: maquina, agora: deps.agora(), harnessesProntos: ["claude-cli"] })).toMatchObject({ id: guardado.id });
    });
    await withRollback(MARLON, async (trx) => {
      const { deps, conversaId, agenteId, chave } = await montar(trx);
      const maquina = await chave();
      await deps.repos.agentes.definirMaquina([agenteId], maquina);
      const comum = (await executar(deps, enviarMensagem, { conversaId, texto: "oi", inventario: PRONTO })).data.turno;
      // ADR-090: a máquina-alvo sem IA pega o turno comum para o despacho recusar nomeando a IA, como antes.
      expect(await deps.repos.turnos.reivindicar({ machineId: maquina, agora: deps.agora(), harnessesProntos: [] })).toMatchObject({ id: comum.id });
    });
  });

  it("critério 3: a IA conecta e a fala guardada roda — a fila lida junta, na ordem, sem a fala fixa do bot no contexto do modelo", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps, conversaId, agenteId, chave } = await montar(trx);
      const maquina = await chave();
      await deps.repos.agentes.definirMaquina([agenteId], maquina);
      // Fora do modo de criação: só assim o plano leva o histórico da conversa (onde a fala fixa poderia vazar).
      await deps.repos.agentes.atualizarPerfil(agenteId, { confirmado: true });
      for (const texto of ["primeira pergunta", "segunda pergunta"]) await executar(deps, enviarMensagem, { conversaId, texto, inventario: AUSENTE, guardarSemIa: true });
      expect((await executar(deps, despacharTurno, { machineId: maquina, inventario: AUSENTE, harnessesProntos: [] })).data).toMatchObject({ plano: null, motivo: "fila_vazia" });
      const { data } = await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO, harnessesProntos: ["claude-cli"] });
      expect(data.plano).not.toBeNull();
      const plano = JSON.stringify(data.plano);
      expect(plano.indexOf("primeira pergunta")).toBeGreaterThan(-1);
      expect(plano.indexOf("primeira pergunta")).toBeLessThan(plano.indexOf("segunda pergunta"));
      expect(plano).not.toContain("Estou sem IA neste computador");
      expect(plano).not.toContain("Ainda sem IA aqui");
      // O plano de verdade (o dublê do deps-l6 monta só pelo domínio, sem o histórico): o modelo vê as perguntas na
      // janela da conversa e nunca a fala fixa do bot.
      const real = (await emitirPlanoTurno(deps, { turnoId: data.turno?.id ?? "", machineId: maquina, executor: "catcher" })).data;
      const volatil = real.promptSistemaPartes?.volatil ?? real.promptSistema;
      expect(volatil).toContain('"historico":[');
      expect(volatil).toContain("primeira pergunta");
      expect(volatil).not.toContain("Estou sem IA neste computador");
      expect(volatil).not.toContain("Ainda sem IA aqui");
    });
  });
});
