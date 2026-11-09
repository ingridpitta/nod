import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { varrerPessoa } from "../../src/adapters/fundo/varredor-lease.ts";
import { LEASE_MS } from "../../src/shared/constantes.ts";
import type { Transacao } from "../../src/shared/types.ts";
import { assentarTurno } from "../../src/use-cases/assentar-turno.ts";
import { decidir } from "../../src/use-cases/decidir.ts";
import { REGRA_APROVACAO_CONTINUADA } from "../../src/use-cases/interromper-por-maquina.ts";
import { pedirAprovacao } from "../../src/use-cases/pedir-aprovacao.ts";
import { agenteComConversa, autoriaPessoa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre, servicosDeTeste } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const SINAIS = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true };
const RESULTADO = { desfecho: "sucesso" as const, texto: "feito", sessaoCli: null, sinais: SINAIS, custoUsd: 0.01, tokens: { entrada: 1, saida: 1, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [] };
type Trx = Parameters<Parameters<typeof withRollback>[1]>[0];

/**
 * NOD-261 (E2), definido em 2026-10-15: a pessoa aprovou enquanto o turno ainda aparecia "despachando" — o assentamento
 * da aprovação confiou no turno vivo e não criou continuação. A máquina tinha caído: o varredor interrompia, abria o
 * "Retomar" e a aprovação ficava sem seguir. Agora a queda continua a aprovação numa continuação só, e o "Retomar" sai.
 */
describeIntegracao("aprovação decidida com o turno caído segue numa continuação só (NOD-261, E2)", () => {
  async function cenario(trx: Trx) {
    const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Ada" });
    const email = await repos.conectores.criar({ nome: "Email", slug: "email", transporte: "stdio", comando: "node", declaracao: "nao-toca" });
    await repos.conectores.registrarSonda(email?.id ?? "", { ok: true, catalogo: [{ nome: "enviar", descricao: "envia", schema: { type: "object" }, readOnlyHint: false }], agora: Date.now() });
    const consentimento = await repos.mensagens.criar({ conversaId, autoria: autoriaPessoa(PESSOA_MARLON), kind: "consentimento", texto: "ok", confianca: "confiavel" });
    await repos.concessoes.conceder({ agenteId, conectorId: email?.id ?? "", capacidade: "enviar", mensagemId: consentimento?.id ?? "" });
    const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "monte e envie", entradaConfianca: "confiavel", modelo: "m" });
    const machineId = randomUUID();
    expect((await repos.turnos.reivindicar({ machineId, agora: Date.now() }))?.id).toBe(turno?.id);
    const deps = depsSobre(repos, MARLON, { services: servicosDeTeste({}), trx });
    const turnoId = turno?.id ?? "";
    const p = await pedirAprovacao(deps, { turnoId, agenteId, conversaId, resumo: "e-mail para ana", itens: [{ texto: "e-mail para ana", destino: { conector: "email", ferramenta: "enviar", argumentos: { texto: "oi" } } }] });
    if (p.data.estado !== "pendente") throw new Error("esperava pendente");
    const tx: Transacao = ((fn: (t: Trx) => Promise<unknown>) => fn(trx)) as Transacao;
    const varrer = (em: number) => varrerPessoa(tx, MARLON, em);
    const retomadas = async () => (await repos.turnos.listarDaConversa(conversaId, 50)).filter((t) => t.origem === "retomada");
    const tardia = () => assentarTurno(deps, { turnoId, machineId, seqLocal: 1, fala: { tipo: "texto", texto: "feito" }, resultado: RESULTADO, executor: "catcher" });
    return { repos, deps, turnoId, conversaId, decisaoId: p.data.decisao_id, varrer, retomadas, tardia };
  }

  it("aprovada com o turno 'vivo', o varredor interrompe duas vezes e a entrega chega tarde: UMA continuação, o Retomar fechado", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      const r = await decidir(c.deps, { decisaoId: c.decisaoId });
      // Com o turno ainda "despachando", a aprovação confia que ele vai recebê-la: nada na hora.
      expect(r.data.turnoRetomadaId).toBeNull();
      expect(await c.retomadas()).toHaveLength(0);

      const vencido = Date.now() + LEASE_MS + 1;
      const primeira = await c.varrer(vencido);
      expect(primeira.interrompidos).toEqual([c.turnoId]);
      const [continuacao, ...outras] = await c.retomadas();
      expect(outras).toHaveLength(0);
      expect(continuacao).toMatchObject({ retomaTurnoId: c.turnoId, estado: "pendente" });
      expect(continuacao?.entradaTexto).toContain("Continuando a tarefa: a pessoa decidiu a aprovação que você pediu");
      // O "Retomar" do turno caído fecha: retomar de novo refaria o que a pessoa aprovou.
      const [card] = primeira.decisoes;
      expect(await c.repos.decisoes.buscar(card ?? "")).toMatchObject({ tipo: "retomar_turno", estado: "decidida", desfecho: { tipo: "decidida_por_regra", regra: REGRA_APROVACAO_CONTINUADA } });
      expect((await c.repos.decisoes.pendentesDaConversa(c.conversaId)).filter((d) => d.tipo === "retomar_turno")).toHaveLength(0);

      // O varredor de novo: nada novo.
      expect(await c.varrer(vencido + 5_000)).toEqual({ interrompidos: [], decisoes: [] });
      // A entrega tardia (com a continuação já na fila): o turno segue interrompido e não continua de novo.
      await c.tardia();
      expect(await c.repos.turnos.buscar(c.turnoId)).toMatchObject({ estado: "interrompido" });
      expect(await c.retomadas()).toHaveLength(1);
    });
  });

  it("sem aprovação decidida, a queda continua como hoje: o Retomar fica aberto e nenhuma continuação nasce", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      const r = await c.varrer(Date.now() + LEASE_MS + 1);
      expect(r.interrompidos).toEqual([c.turnoId]);
      expect(await c.retomadas()).toHaveLength(0);
      expect(await c.repos.decisoes.buscar(r.decisoes[0] ?? "")).toMatchObject({ tipo: "retomar_turno", estado: "pendente" });
    });
  });
});
