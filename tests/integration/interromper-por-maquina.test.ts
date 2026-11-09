import { randomBytes, randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { Turno } from "../../src/contracts/turno.ts";
import type { Repos } from "../../src/repositories/index.ts";
import { PRAZO_DESCONEXAO_MS } from "../../src/services/logins-na-maquina.ts";
import { LEASE_MS } from "../../src/shared/constantes.ts";
import type { Tx } from "../../src/shared/types.ts";
import { revogarChaveMaquina } from "../../src/use-cases/chaves-maquina.ts";
import { interromperPorMaquina, registrarVoltaDasMaquinas } from "../../src/use-cases/interromper-por-maquina.ts";
import { retomarTurno } from "../../src/use-cases/retomar-turno.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const T0 = Date.parse("2026-10-20T09:00:00-03:00");
/** Depois do lease do turno reivindicado em T0: o varredor só lê vencidos. */
const VENCIDO = T0 + LEASE_MS + 60_000;
const FRASE_REMOVIDA = "Turno interrompido: a máquina foi removida; a frente parou. O que já saiu fica marcado como parcial; nada foi reenviado.";

async function chaveDe(repos: Repos, nome: string): Promise<string> {
  const c = await repos.maquinaTokens.criar({ nome, prefixo: randomBytes(4).toString("hex"), hash: randomBytes(32) });
  if (!c) throw new Error("chave não criada");
  return c.id;
}

/** Um turno de conversa rodando na máquina `maquina`, reivindicado em `desde`. */
async function turnoRodando(repos: Repos, agenteId: string, conversaId: string, maquina: string, desde: number): Promise<Turno> {
  const t = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: desde + 86_400_000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m" });
  const r = await repos.turnos.reivindicar({ machineId: maquina, agora: desde });
  if (!t || r?.id !== t.id) throw new Error("turno não reivindicado");
  return r;
}

const totalDeIncidentes = async (trx: Tx) => Number((await trx<{ n: string }[]>`select count(*)::text as n from incidentes where owner_id = ${PESSOA_MARLON}`)[0]?.n ?? "0");
const revogar = (trx: Tx, id: string, agora: number) => revogarChaveMaquina(depsSobre(trx, MARLON, { agora: () => agora }).deps, { id });

describeIntegracao("NOD-293 A7: a máquina removida para a frente sem aviso de 'sem contato'", () => {
  it("revogar com turno rodando: o varredor assenta 'maquina_removida', 0 incidentes, Retomar com a frase; a retomada segue o alvo normal", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Taga" });
      const removida = await chaveDe(repos, "MacBook velho");
      const outra = await chaveDe(repos, "MacBook novo");
      // O bot estava preso à máquina removida: o alvo dela não vale mais e a retomada sai para qualquer máquina.
      await repos.agentes.definirMaquina([agenteId], removida);
      const t = await turnoRodando(repos, agenteId, conversaId, removida, T0);
      const antes = await totalDeIncidentes(trx);

      await revogar(trx, removida, T0 + 60_000);
      const r = await interromperPorMaquina({ repos, escopo: MARLON, agora: () => VENCIDO }, { turnos: [t], maquinaPresente: () => false });

      expect(r.data.interrompidos).toEqual([t.id]);
      expect(r.data.incidenteId).toBeNull();
      expect(r.data.porMotivo).toEqual({ maquina_sem_contato: 0, reinicio_servidor: 0, reinicio_do_motor: 0 });
      expect(await totalDeIncidentes(trx)).toBe(antes);
      expect(await repos.incidentes.visiveis(0)).toEqual([]);
      expect((await repos.turnos.buscar(t.id))?.motivoInterrupcao).toBe("maquina_removida");
      const avisos = (await repos.mensagens.listarDaConversa(conversaId, 50)).filter((m) => m.kind === "sistema").map((m) => m.texto);
      expect(avisos).toEqual([FRASE_REMOVIDA]);
      const [decisao] = await repos.decisoes.pendentesDaConversa(conversaId);
      expect(decisao).toMatchObject({ tipo: "retomar_turno", turnoId: t.id, frase: FRASE_REMOVIDA });

      // Retomar: turno novo na fila, que a máquina viva pega (a removida não é mais alvo de nada).
      const { deps } = depsSobre(trx, MARLON, { agora: () => VENCIDO + 1_000 });
      const retomada = await retomarTurno(deps, { decisaoId: decisao?.id ?? "", texto: "continua" });
      expect(retomada.data.turno).toMatchObject({ origem: "retomada", retomaTurnoId: t.id });
      expect((await repos.turnos.reivindicar({ machineId: outra, agora: VENCIDO + 2_000 }))?.id).toBe(retomada.data.turno.id);
    });
  });

  it("incidente aberto antes da revogação termina dispensado; a queda seguinte da máquina removida não abre outro", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Taga" });
      const ada = await agenteComConversa(trx, MARLON, { nome: "Ada" });
      const maquina = await chaveDe(repos, "MacBook");
      const caiu = await turnoRodando(repos, agenteId, conversaId, maquina, T0);
      // O segundo turno renovou depois: o lease dele ainda vale quando o primeiro cai.
      const rodando = await turnoRodando(repos, ada.agenteId, ada.conversaId, maquina, T0 + 2 * LEASE_MS);

      const queda = await interromperPorMaquina({ repos, escopo: MARLON, agora: () => VENCIDO }, { turnos: [caiu], maquinaPresente: () => false });
      expect(queda.data.incidenteId).not.toBeNull();
      expect((await repos.incidentes.emCurso()).map((i) => i.id)).toEqual([queda.data.incidenteId]);

      await revogar(trx, maquina, VENCIDO + 60_000);
      expect(await repos.incidentes.emCurso()).toEqual([]);
      expect(await repos.incidentes.visiveis(0)).toEqual([]);

      const depois = VENCIDO + 3 * LEASE_MS;
      const r = await interromperPorMaquina({ repos, escopo: MARLON, agora: () => depois }, { turnos: [rodando], maquinaPresente: () => false });
      expect(r.data.incidenteId).toBeNull();
      expect((await repos.turnos.buscar(rodando.id))?.motivoInterrupcao).toBe("maquina_removida");
      expect(await repos.incidentes.visiveis(0)).toEqual([]);
      expect(await repos.incidentes.emCurso()).toEqual([]);
    });
  });

  it("ordem inversa: o varredor antes da revogação; revogar dispensa o aviso e repetir tudo não muda nada", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Taga" });
      const maquina = await chaveDe(repos, "MacBook");
      const t = await turnoRodando(repos, agenteId, conversaId, maquina, T0);

      const queda = await interromperPorMaquina({ repos, escopo: MARLON, agora: () => VENCIDO }, { turnos: [t], maquinaPresente: () => false });
      expect((await repos.turnos.buscar(t.id))?.motivoInterrupcao).toBe("maquina_sem_contato");
      expect(queda.data.incidenteId).not.toBeNull();
      const totalAntes = await totalDeIncidentes(trx);

      await revogar(trx, maquina, VENCIDO + 60_000);
      await revogar(trx, maquina, VENCIDO + 120_000);
      const denovo = await interromperPorMaquina({ repos, escopo: MARLON, agora: () => VENCIDO + 180_000 }, { turnos: [t], maquinaPresente: () => false });

      expect(denovo.data).toMatchObject({ interrompidos: [], incidenteId: null });
      expect(await totalDeIncidentes(trx)).toBe(totalAntes);
      expect(await repos.incidentes.visiveis(0)).toEqual([]);
      expect(await repos.incidentes.emCurso()).toEqual([]);
      // O turno fica com o motivo de quando caiu; nenhum aviso a mais na conversa.
      expect((await repos.turnos.buscar(t.id))?.motivoInterrupcao).toBe("maquina_sem_contato");
      expect((await repos.mensagens.listarDaConversa(conversaId, 50)).filter((m) => m.kind === "sistema")).toHaveLength(1);
    });
  });

  it("revogar chave inexistente segue 404 e não toca o aviso de outra máquina", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Taga" });
      const maquina = await chaveDe(repos, "MacBook");
      const outra = await chaveDe(repos, "iMac");
      const t = await turnoRodando(repos, agenteId, conversaId, maquina, T0);
      const queda = await interromperPorMaquina({ repos, escopo: MARLON, agora: () => VENCIDO }, { turnos: [t], maquinaPresente: () => false });
      await expect(revogar(trx, randomUUID(), VENCIDO + 1)).rejects.toMatchObject({ codigo: "nao_encontrado" });
      await revogar(trx, outra, VENCIDO + 2);
      expect((await repos.incidentes.emCurso()).map((i) => i.id)).toEqual([queda.data.incidenteId]);
    });
  });

  it("QA: 'Desconectar e sair das contas' e a máquina some antes de confirmar — quando a chave vence, o varredor dispensa o aviso 'sem contato'", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Taga" });
      const maquina = await chaveDe(repos, "MacBook");
      const t = await turnoRodando(repos, agenteId, conversaId, maquina, T0);
      // A rota de desconectar (máquina no ar, com "sair das contas") só põe prazo na chave: vence em PRAZO_DESCONEXAO_MS.
      expect(await repos.maquinaTokens.vencerEm(maquina, VENCIDO - 1_000 + PRAZO_DESCONEXAO_MS)).toBe(true);
      // A máquina some antes do prazo: o turno cai como "sem contato" e abre o aviso.
      const queda = await interromperPorMaquina({ repos, escopo: MARLON, agora: () => VENCIDO }, { turnos: [t], maquinaPresente: () => false });
      expect(queda.data.incidenteId).not.toBeNull();
      const deps = (agora: number) => ({ repos, escopo: MARLON, agora: () => agora });

      // Dentro do prazo a máquina ainda pode voltar e confirmar: o aviso fica.
      await registrarVoltaDasMaquinas(deps(VENCIDO + 1_000), () => false);
      expect((await repos.incidentes.emCurso()).map((i) => i.id)).toEqual([queda.data.incidenteId]);

      // Venceu sem confirmar: a chave caiu sozinha e a máquina não volta — o aviso sai, como no revogar.
      await registrarVoltaDasMaquinas(deps(VENCIDO + PRAZO_DESCONEXAO_MS + 1_000), () => false);
      expect(await repos.incidentes.emCurso()).toEqual([]);
      expect(await repos.incidentes.visiveis(0)).toEqual([]);
    });
  });
});
