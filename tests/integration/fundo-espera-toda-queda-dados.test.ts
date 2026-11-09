import { expect, it } from "vitest";
import { contexto, depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";
import { abrirFrentes } from "../../src/use-cases/frentes.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };

/** NOD-309, PR 1: as colunas da 0098 e o que os repos leem e gravam delas. O comportamento vem nos PRs 2 a 4. */
describeIntegracao("fundo espera por toda queda: dados (NOD-309, 0098)", () => {
  it("o turno nasce com 0 tentativas transitórias e a retomada grava o número que recebe", async () => {
    await withRollback(MARLON, async (trx) => {
      const ada = await agenteComConversa(trx, MARLON, { nome: "Ada" });
      const { repos } = depsSobre(trx, MARLON);
      const novo = { executor: "catcher", conversaId: ada.conversaId, agenteId: ada.agenteId, prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "rode a rotina", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli" } as const;
      const origem = (await repos.turnos.enfileirar({ ...novo, origem: "rotina" }))!;
      expect(origem.tentativasTransitorias).toBe(0);
      const volta = (await repos.turnos.enfileirar({ ...novo, origem: "retomada", retomaTurnoId: origem.id, tentativasTransitorias: 2 }))!;
      expect(volta.tentativasTransitorias).toBe(2);
      expect((await repos.turnos.buscar(volta.id))?.tentativasTransitorias).toBe(2);
    });
  });

  it("o lote só fica entregue quando o retorno conclui, uma vez só; antes, retornoConcluidoEm é nulo", async () => {
    await withRollback(MARLON, async (trx) => {
      const ada = await agenteComConversa(trx, MARLON, { nome: "Ada" });
      const { deps, repos } = depsSobre(trx, MARLON);
      const dono = (await repos.turnos.enfileirar({ executor: "catcher", conversaId: ada.conversaId, agenteId: ada.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "duas coisas", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli" }))!;
      const r = await abrirFrentes(deps, { ...contexto(dono.agenteId, dono.conversaId, dono.id), frentes: [{ titulo: "Uma", pedido: "Faça uma." }, { titulo: "Duas", pedido: "Faça duas." }], avisar_a_cada_uma: false });
      if (!r.data.ok) throw new Error(`deveria abrir: ${r.data.instrucao}`);
      const loteId = r.data.lote_id;
      expect((await repos.frentes.buscarLote(loteId))?.retornoConcluidoEm).toBeNull();

      const retorno = (await repos.turnos.enfileirar({ executor: "catcher", conversaId: ada.conversaId, agenteId: ada.agenteId, origem: "retomada", retomaTurnoId: dono.id, prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "as frentes terminaram", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli" }))!;
      // Sem devolução, o retorno não é do lote: nada muda.
      expect(await repos.frentes.marcarRetornoConcluido(retorno.id, Date.now())).toBe(false);
      await repos.frentes.marcarDevolvido(loteId, retorno.id, Date.now());
      expect((await repos.frentes.buscarLote(loteId))?.retornoConcluidoEm).toBeNull();

      const em = Date.now();
      expect(await repos.frentes.marcarRetornoConcluido(retorno.id, em)).toBe(true);
      expect(await repos.frentes.marcarRetornoConcluido(retorno.id, em + 1000)).toBe(false);
      expect((await repos.frentes.buscarLote(loteId))?.retornoConcluidoEm).toBe(em);
    });
  });

  it("NOD-386: quedasDaCadeia conta só as quedas de `desde` em diante, pela hora do último sinal (borda inclusa)", async () => {
    await withRollback(MARLON, async (trx) => {
      const ada = await agenteComConversa(trx, MARLON, { nome: "Ada" });
      const { repos } = depsSobre(trx, MARLON);
      const novo = { executor: "catcher", conversaId: ada.conversaId, agenteId: ada.agenteId, prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "rode a rotina", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli" } as const;
      const raiz = (await repos.turnos.enfileirar({ ...novo, origem: "rotina" }))!;
      const desde = Date.now() - 2 * 60 * 60_000;
      const cair = async (id: string, sinal: number | null, criado: number) =>
        trx`update turnos set estado = 'interrompido', motivo_interrupcao = 'maquina_sem_contato', ultimo_sinal_em = ${sinal === null ? null : new Date(sinal)}, criado_em = ${new Date(criado)} where id = ${id}`;
      await cair(raiz.id, desde - 1, Date.now());
      const a = (await repos.turnos.enfileirar({ ...novo, origem: "retomada", retomaTurnoId: raiz.id }))!;
      await cair(a.id, desde, desde - 60_000);
      const b = (await repos.turnos.enfileirar({ ...novo, origem: "retomada", retomaTurnoId: a.id }))!;
      await cair(b.id, null, desde + 1);
      const atual = (await repos.turnos.enfileirar({ ...novo, origem: "retomada", retomaTurnoId: b.id }))!;
      // raiz: sinal 1 ms antes (fora, mesmo criado agora); a: sinal na borda (dentro, mesmo criado antes); b: sem sinal, pela criação.
      expect(await repos.turnos.quedasDaCadeia(raiz.id, atual.id, desde)).toBe(2);
      expect(await repos.turnos.quedasDaCadeia(raiz.id, b.id, desde)).toBe(1);
      expect(await repos.turnos.quedasDaCadeia(raiz.id, atual.id, 0)).toBe(3);
    });
  });
});
