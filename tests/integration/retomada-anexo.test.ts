import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { Inventario } from "../../src/contracts/inventario.ts";
import { autoriaPessoa } from "../../src/use-cases/autoria-evento.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { enfileirarRetomada } from "../../src/use-cases/enfileirar-retomada.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre, servicosDeTeste } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * NOD-285 (K2) no Postgres: a retomada (aprovação, resposta, queda) leva os anexos da fala de origem; o plano dela os
 * traz (é por `plano.entrada.anexos` que a rota interna `GET /anexos/:aid` serve os bytes ao driver); a junção numa
 * retomada da fila une sem duplicar; sem sessão, o histórico marca "[anexou X]".
 */
const escopo = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const pronto: Inventario = { estado: "pronto", versao: "teste", em: Date.now() };

describeIntegracao("o anexo acompanha a retomada (NOD-285)", () => {
  async function montar(trx: Parameters<Parameters<typeof withRollback>[1]>[0]) {
    const base = await agenteComConversa(trx, escopo);
    const agora = () => Date.now();
    const deps = depsSobre(base.repos, escopo, { services: servicosDeTeste({ agora }), agora, trx });
    const fala = (await base.repos.mensagens.criar({ conversaId: base.conversaId, autoria: autoriaPessoa(escopo), kind: "texto", texto: "olha o contrato", confianca: "confiavel" }))!;
    const anexo = (await base.repos.anexos.criar({ conversaId: base.conversaId, nome: "contrato.pdf", mime: "application/pdf", conteudo: new Uint8Array([37, 80, 68, 70]) }))!;
    await base.repos.anexos.prender([anexo.id], { conversaId: base.conversaId, mensagemId: fala.id });
    const original = (await base.repos.turnos.enfileirar({ executor: "local", agenteId: base.agenteId, conversaId: base.conversaId, origem: "conversa", prazoEm: agora() + 60_000, profundidade: 0, entradaTexto: "olha o contrato", entradaConfianca: "confiavel", modelo: "auto", harness: "auto", mensagemOrigemId: fala.id, entradaAnexos: [anexo.id] }))!;
    await trx`update turnos set estado = 'concluido' where id = ${original.id}`;
    const plano = async (turnoId: string) => (await emitirPlanoTurno(deps, { turnoId, machineId: randomUUID(), executor: "local", harnesses: { "claude-cli": pronto } })).data;
    return { ...base, deps, trx, anexo, original, plano };
  }

  it("critério 4: a retomada da aprovação nasce com o mesmo entradaAnexos e o plano dela traz o arquivo para a rota interna", async () => {
    await withRollback(escopo, async (trx) => {
      const m = await montar(trx);
      const { turno } = await enfileirarRetomada(m.deps, { original: m.original, prazoEm: Date.now() + 60_000, entradaTexto: "Continuando a tarefa: aprovado" });
      expect(turno?.entradaAnexos).toEqual([m.anexo.id]);
      const p = await m.plano(turno!.id);
      expect(p.entrada.anexos?.map((a) => a.id)).toEqual([m.anexo.id]);
      // O mesmo que `GET /anexos/:aid` lê depois de conferir o plano.
      expect((await m.repos.anexos.conteudo(m.anexo.id))?.bytes.byteLength).toBe(4);
    });
  });

  it("a retomada que já estava na fila (nascida sem anexo) ganha os da origem na junção, sem duplicar", async () => {
    await withRollback(escopo, async (trx) => {
      const m = await montar(trx);
      const velha = (await m.repos.turnos.enfileirar({ executor: "local", agenteId: m.agenteId, conversaId: m.conversaId, origem: "retomada", retomaTurnoId: m.original.id, prazoEm: Date.now() + 60_000, profundidade: 0, entradaTexto: "primeira decisão", entradaConfianca: "confiavel", modelo: "auto", harness: "auto" }))!;
      const extra = randomUUID();
      await trx`update turnos set entrada_anexos = ${[extra]}::uuid[] where id = ${velha.id}`;
      const r1 = await enfileirarRetomada(m.deps, { original: m.original, prazoEm: Date.now() + 60_000, entradaTexto: "segunda decisão" });
      expect(r1).toMatchObject({ nova: false, turno: { id: velha.id } });
      expect(r1.turno?.entradaAnexos).toEqual([extra, m.anexo.id]);
      const r2 = await enfileirarRetomada(m.deps, { original: m.original, prazoEm: Date.now() + 60_000, entradaTexto: "terceira decisão" });
      expect(r2.turno?.entradaAnexos).toEqual([extra, m.anexo.id]);
    });
  });

  it("critério 5: sem sessão o histórico marca '[anexou contrato.pdf]'; com sessão o histórico nem vai", async () => {
    await withRollback(escopo, async (trx) => {
      const m = await montar(trx);
      const seguinte = (await m.repos.turnos.enfileirar({ executor: "local", agenteId: m.agenteId, conversaId: m.conversaId, origem: "conversa", prazoEm: Date.now() + 60_000, profundidade: 0, entradaTexto: "e aí?", entradaConfianca: "confiavel", modelo: "auto", harness: "auto" }))!;
      const semSessao = await m.plano(seguinte.id);
      expect(semSessao.entrada.sessaoCli).toBeNull();
      expect(semSessao.promptSistema).toContain("olha o contrato [anexou contrato.pdf]");
      await m.repos.conversas.atualizarSessaoCli(m.conversaId, randomUUID(), "local", "claude-cli");
      const comSessao = await m.plano(seguinte.id);
      expect(comSessao.entrada.sessaoCli).not.toBeNull();
      expect(comSessao.promptSistema).not.toContain("[anexou");
    });
  });
});
