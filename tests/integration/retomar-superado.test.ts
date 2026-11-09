import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { Turno } from "../../src/contracts/turno.ts";
import { TEXTO_PERGUNTA_VENCIDA } from "../../src/domain/frente.ts";
import { assentarTurno, REGRA_RETOMAR_SUPERADO } from "../../src/use-cases/assentar-turno.ts";
import { abrirFrentes, devolverResumo } from "../../src/use-cases/frentes.ts";
import { sincronizarTrabalho } from "../../src/use-cases/trabalhos.ts";
import { contexto, depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa, autoriaAgente } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * NOD-261 (G3 e fatos) e NOD-264 (C21), definidos em 2026-10-15. G3: a frente caiu, ficou com o "Retomar" aberto, a pessoa
 * escreveu nela e o turno novo concluiu — o card velho seguia aberto e prendia a frente em "precisa de você" (e o lote
 * nunca fechava). Agora ele fecha por `regra:retomar_superado`, e os fatos só contam o "Retomar" do último turno. C21: a
 * pergunta à pessoa que venceu sem resposta deixava a frente "terminado" com a pergunta como resumo; agora é `falhou`.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const SINAIS = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true };
const SUCESSO = { desfecho: "sucesso" as const, texto: "feito", sessaoCli: null, sinais: SINAIS, custoUsd: 0, tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [] };

type Trx = Parameters<Parameters<typeof withRollback>[1]>[0];
async function montar(trx: Trx) {
  const ada = await agenteComConversa(trx, MARLON, { nome: "Ada" });
  const { deps, repos } = depsSobre(trx, MARLON);
  const dono = (await repos.turnos.enfileirar({ executor: "catcher", conversaId: ada.conversaId, agenteId: ada.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "conserte o login e a CI", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli" }))!;
  const r = await abrirFrentes(deps, { ...contexto(dono.agenteId, dono.conversaId, dono.id), frentes: [{ titulo: "Login no Safari", pedido: "Conserte o login." }, { titulo: "CI vermelha", pedido: "Descubra por que a CI quebrou." }] });
  if (!r.data.ok) throw new Error(`deveria abrir: ${r.data.instrucao}`);
  await repos.turnos.assentar(dono.id, { estado: "concluido" });
  const [login, ci] = r.data.frentes.map((f) => f.trabalho_id) as [string, string];
  const turnoVivo = async (trabalhoId: string) => (await repos.turnos.doTrabalho(trabalhoId)).filter((t) => t.estado === "pendente" || t.estado === "despachando").at(-1)!;
  const retomar = async (t: Turno) => repos.decisoes.criar({ tipo: "retomar_turno", agenteId: t.agenteId, conversaId: t.conversaId, turnoId: t.id, prazoDecisaoEm: Date.now() + 86_400_000, frase: "O turno parou." });
  const cair = async (trabalhoId: string) => {
    const t = await turnoVivo(trabalhoId);
    await repos.turnos.interromper(t.id, "maquina_sem_contato");
    const card = (await retomar(t))!;
    await sincronizarTrabalho(deps, trabalhoId);
    return { turno: t, card };
  };
  const terminar = async (trabalhoId: string, feito: string) => {
    const t = await turnoVivo(trabalhoId);
    await devolverResumo(deps, { ...contexto(t.agenteId, t.conversaId, t.id), feito });
    await repos.turnos.assentar(t.id, { estado: "concluido" });
    return sincronizarTrabalho(deps, trabalhoId);
  };
  /** A pessoa escreve na frente: um turno novo no mesmo trabalho, rodado e entregue pela ponte (assentarTurno). */
  const recado = async (trabalhoId: string, o: { resumo?: string } = {}) => {
    const t = (await repos.turnos.enfileirar({ executor: "catcher", conversaId: ada.conversaId, agenteId: ada.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "e então?", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli", trabalhoId }))!;
    const machineId = randomUUID();
    expect((await repos.turnos.reivindicar({ machineId, agora: Date.now() }))?.id).toBe(t.id);
    if (o.resumo) await devolverResumo(deps, { ...contexto(t.agenteId, t.conversaId, t.id), feito: o.resumo });
    const r = await assentarTurno(deps, { turnoId: t.id, machineId, seqLocal: 1, fala: { tipo: "texto", texto: "feito" }, resultado: SUCESSO, executor: "catcher" });
    return { turno: t, events: r.events ?? [] };
  };
  const estado = async (id: string) => (await repos.trabalhos.buscar(id))?.estado;
  const retornos = async () => (await repos.turnos.listarDaConversa(ada.conversaId, 500)).filter((t) => t.origem === "retomada" && t.retomaTurnoId === dono.id);
  return { ada, deps, repos, dono, loteId: r.data.lote_id, login, ci, turnoVivo, retomar, cair, terminar, recado, estado, retornos };
}

describeIntegracao("o Retomar superado e a pergunta vencida (NOD-261 G3, NOD-264 C21)", () => {
  it("G3: frente caída com o Retomar aberto + recado novo que conclui → o card fecha por retomar_superado, a frente termina e o lote fecha", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.terminar(m.login, "Login corrigido");
      const { card } = await m.cair(m.ci);
      expect(await m.estado(m.ci)).toBe("precisa_de_voce");

      const { events } = await m.recado(m.ci, { resumo: "CI verde" });
      expect(await m.repos.decisoes.buscar(card.id)).toMatchObject({ estado: "decidida", desfecho: { tipo: "decidida_por_regra", regra: REGRA_RETOMAR_SUPERADO } });
      expect(events.some((e) => e.kind === "decisao_decidida" && (e.dados as { regra?: string }).regra === REGRA_RETOMAR_SUPERADO)).toBe(true);
      expect(await m.estado(m.ci)).toBe("terminado");
      expect((await m.repos.frentes.buscarLote(m.loteId))?.devolvidoEm).not.toBeNull();
      expect(await m.retornos()).toHaveLength(1);
    });
  });

  it("G3: o Retomar de OUTRA frente não é superado pelo recado nesta", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const { card: doLogin } = await m.cair(m.login);
      await m.cair(m.ci);
      await m.recado(m.ci, { resumo: "CI verde" });
      expect(await m.repos.decisoes.buscar(doLogin.id)).toMatchObject({ estado: "pendente" });
      expect(await m.estado(m.login)).toBe("precisa_de_voce");
    });
  });

  it("fatos: só conta o Retomar do último turno terminal — card de turno velho não prende; card do último prende", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const { card } = await m.cair(m.ci);
      expect(await m.estado(m.ci)).toBe("precisa_de_voce");
      const novo = (opcoes: { texto: string }) => m.repos.turnos.enfileirar({ executor: "catcher", conversaId: m.ada.conversaId, agenteId: m.ada.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: opcoes.texto, entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli", trabalhoId: m.ci });
      // Um turno novo conclui por fora do assentamento (o card velho segue aberto, como nos dados de antes do G3).
      const t2 = (await novo({ texto: "e então?" }))!;
      await m.repos.turnos.assentar(t2.id, { estado: "concluido" });
      await sincronizarTrabalho(m.deps, m.ci);
      expect(await m.repos.decisoes.buscar(card.id)).toMatchObject({ estado: "pendente" });
      expect(await m.estado(m.ci)).toBe("terminado");
      // O último turno cai com o próprio card: esse prende.
      const t3 = (await novo({ texto: "mais uma" }))!;
      await m.repos.turnos.interromper(t3.id, "maquina_sem_contato");
      await sincronizarTrabalho(m.deps, m.ci);
      expect(await m.estado(m.ci)).toBe("falhou");
      await m.retomar(t3);
      await sincronizarTrabalho(m.deps, m.ci);
      expect(await m.estado(m.ci)).toBe("precisa_de_voce");
    });
  });

  it("C21: a pergunta à pessoa venceu sem resposta → a frente fica falhou e o retorno leva o motivo, nunca a pergunta", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.terminar(m.login, "Login corrigido");
      const t = await m.turnoVivo(m.ci);
      const pergunta = "Posso apagar o workflow antigo da CI?";
      await m.repos.mensagens.criar({ conversaId: t.conversaId, turnoId: t.id, autoria: autoriaAgente(t.agenteId, PESSOA_MARLON), kind: "texto", texto: pergunta, confianca: "confiavel" });
      await m.repos.decisoes.criar({ tipo: "pergunta", agenteId: t.agenteId, conversaId: t.conversaId, turnoId: t.id, prazoDecisaoEm: Date.now() + 1_000, frase: pergunta });
      await m.repos.turnos.assentar(t.id, { estado: "concluido" });
      await sincronizarTrabalho(m.deps, m.ci);
      expect(await m.estado(m.ci)).toBe("precisa_de_voce");

      expect(await m.repos.decisoes.vencerPendentes(Date.now() + 2_000)).toHaveLength(1);
      await sincronizarTrabalho(m.deps, m.ci);
      expect(await m.estado(m.ci)).toBe("falhou");
      expect((await m.repos.frentes.buscarLote(m.loteId))?.devolvidoEm).not.toBeNull();
      const [retorno, ...mais] = await m.retornos();
      expect(mais).toHaveLength(0);
      const json = JSON.parse(retorno!.entradaTexto.split("\n")[1]!) as Record<string, unknown>[];
      expect(json.map((f) => [f.titulo, f.estado])).toEqual([["Login no Safari", "terminado"], ["CI vermelha", "falhou"]]);
      expect(json[1]!.motivo).toBe(TEXTO_PERGUNTA_VENCIDA);
      expect(retorno!.entradaTexto).not.toContain(pergunta);
    });
  });
});
