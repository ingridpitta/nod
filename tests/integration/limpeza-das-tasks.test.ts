import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { codigoDaPasta } from "../../src/adapters/executor/limpeza-das-tasks.ts";
import { LIMPAR_APOS_MS, RETOMADA_POSSIVEL_MS } from "../../src/domain/limpeza-das-tasks.ts";
import { pastaSemTrabalhoDoTurno, pastasParaLimpar } from "../../src/use-cases/limpeza-das-tasks.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * ADR-088 (definido em 2026-10-09): o servidor diz ao Mac quais pastas de task podem ser limpas. Só task encerrada
 * (terminada ou falha), sem turno vivo nem volta marcada, sem decisão pendente, fora das 2 h da retomada automática.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const HORA = 3_600_000;
const DIA = 24 * HORA;

describeIntegracao("limpeza das pastas de task (ADR-088)", () => {
  it("só oferece task encerrada sem retomada possível; a de menos de 3 dias só com PR mergeado", async () => {
    await withRollback(MARLON, async (trx) => {
      const agora = Date.now();
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => agora });
      const criar = async (slug: string, estado: "terminado" | "falhou" | "parado" | "rodando" | null, haMs: number, pasta: string | null = `~/nod/Vera/${slug}`) => {
        const t = await repos.trabalhos.criar({ agenteId, conversaId, titulo: slug, origem: "pessoa", pasta });
        if (estado) await repos.trabalhos.mudarEstado(t!.id, estado, agora - haMs);
        return t!.id;
      };
      const turnoDo = (trabalhoId: string, acordarEm: number | null = null) =>
        repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: agora + 600_000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m", trabalhoId, acordarEm });

      const antiga = await criar("antiga-aaaaaa", "terminado", 4 * DIA);
      const falhaRecente = await criar("falha-bbbbbb", "falhou", DIA);
      await criar("acabou-agora-cccccc", "terminado", HORA);
      await criar("ativa-dddddd", "rodando", 0);
      await criar("parada-eeeeee", "parado", 10 * DIA);
      // A decisão pendente vem de um turno que já acabou (o "Retomar" e a pergunta ficam depois do turno).
      const comPergunta = await criar("pergunta-hhhhhh", "terminado", 4 * DIA);
      const t = await turnoDo(comPergunta);
      expect((await repos.turnos.reivindicar({ machineId: randomUUID(), agora }))?.id).toBe(t!.id);
      await repos.turnos.assentar(t!.id, { estado: "concluido" });
      await repos.decisoes.criar({ tipo: "pergunta", agenteId, conversaId, turnoId: t!.id, prazoDecisaoEm: agora + DIA, frase: "Qual?" });
      const comVolta = await criar("com-volta-ffffff", "terminado", 4 * DIA);
      await turnoDo(comVolta, agora + HORA);
      const naFila = await criar("na-fila-gggggg", "terminado", 4 * DIA);
      await turnoDo(naFila);
      await criar("sem-pasta", "terminado", 4 * DIA, null);
      await criar("raiz-do-bot", "terminado", 4 * DIA, "~/nod/Vera");
      await criar("velha-iiiiii", "terminado", 40 * DIA);
      // Pasta decidida por quem chamou e dividida com uma task aberta: nunca.
      await criar("dividida", "terminado", 4 * DIA, "~/nod/Vera/compartilhada");
      await criar("dividida-aberta", null, 0, "~/nod/Vera/compartilhada");

      // ADR-106: as mais recentes primeiro.
      const oferecidas = await pastasParaLimpar(deps);
      expect(oferecidas).toEqual([
        { trabalhoId: falhaRecente, pasta: "Vera/falha-bbbbbb", quando: "so_com_pr_mergeado" },
        { trabalhoId: antiga, pasta: "Vera/antiga-aaaaaa", quando: "encerrada" },
      ]);

      // ADR-096: com o disco apertado, a encerrada há mais de 2 h já vale como encerrada.
      expect(await pastasParaLimpar(deps, { apertado: true })).toEqual([
        { trabalhoId: falhaRecente, pasta: "Vera/falha-bbbbbb", quando: "encerrada" },
        { trabalhoId: antiga, pasta: "Vera/antiga-aaaaaa", quando: "encerrada" },
      ]);

      // A task reaberta (mensagem nova) sai da lista; quando volta a acabar, o relógio dos 3 dias recomeça.
      // NOD-256 (F1.3): sair de um estado final exige a flag explícita (a mensagem nova da pessoa reabre).
      await repos.trabalhos.mudarEstado(antiga, "rodando", agora, { reabrir: true });
      expect((await pastasParaLimpar(deps)).map((p) => p.trabalhoId)).toEqual([falhaRecente]);
      await repos.trabalhos.mudarEstado(antiga, "terminado", agora - LIMPAR_APOS_MS + HORA);
      expect(await pastasParaLimpar(deps)).toContainEqual({ trabalhoId: antiga, pasta: "Vera/antiga-aaaaaa", quando: "so_com_pr_mergeado" });
    });
  });

  // ADR-106: estes dois criam mais de 500 tasks, uma a uma (~4 s com a máquina quieta em 15/10); o teto folga para carga.
  const MUITAS_TASKS_MS = 60_000;
  const criarEm = (trx: Parameters<Parameters<typeof withRollback>[1]>[0], agora: number) => async () => {
    const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Cecília" });
    const { deps, repos } = depsSobre(trx, MARLON, { agora: () => agora });
    const criar = async (slug: string, haMs: number, pasta = `~/nod/Cecília/${slug}`) => {
      const t = await repos.trabalhos.criar({ agenteId, conversaId, titulo: slug, origem: "pessoa", pasta });
      await repos.trabalhos.mudarEstado(t!.id, "terminado", agora - haMs);
      return t!.id;
    };
    return { deps, criar };
  };

  it("ADR-106: com os códigos da máquina, só as pastas dela entram (NFC ou NFD no banco), sem o teto de 500 nem a janela de 30 dias", async () => {
    await withRollback(MARLON, async (trx) => {
      const agora = Date.now();
      const { deps, criar } = await criarEm(trx, agora)();
      // 505 tasks que acabaram agora (ainda não podem sair) na frente: com o teto de 500 elas escondiam as que podem.
      const recentes: string[] = [];
      for (let i = 0; i < 505; i++) { const slug = `recente-${String(i).padStart(6, "0")}`; await criar(slug, 10 * 60_000); recentes.push(`Cecília/${slug}`); }
      const nova = await criar("nova-aaaaaa", 4 * DIA);
      // O banco com o acento decomposto (NFD) casa com o código do nome composto (NFC).
      const decomposta = await criar("nfd-dddddd", 6 * DIA, "~/nod/Cecília/nfd-dddddd".normalize("NFD"));
      // Presa há 40 dias: fora da janela, mas a pasta ainda está no disco.
      const presa = await criar("presa-eeeeee", 40 * DIA);
      await criar("fora-da-lista-ffffff", 4 * DIA);

      const pastas = [...recentes, "Cecília/nova-aaaaaa", "Cecília/sumiu-cccccc", "Cecília/nfd-dddddd", "Cecília/presa-eeeeee"];
      const daMaquina = await pastasParaLimpar(deps, { codigos: pastas.map(codigoDaPasta) });
      expect(daMaquina.map((p) => [p.trabalhoId, p.quando])).toEqual([[nova, "encerrada"], [decomposta, "encerrada"], [presa, "encerrada"]]);
      expect(daMaquina[0]!.pasta).toBe("Cecília/nova-aaaaaa");
      expect(await pastasParaLimpar(deps, { codigos: [] })).toEqual([]);
      // A reconfirmação: só o código daquela pasta.
      expect(await pastasParaLimpar(deps, { codigos: [codigoDaPasta("Cecília/nfd-dddddd")] })).toEqual([{ trabalhoId: decomposta, pasta: "Cecília/nfd-dddddd".normalize("NFD"), quando: "encerrada" }]);

      // Revisão do #320: a pasta de duas tasks só sai pela mais recente — a antiga não a oferece como encerrada
      // enquanto a nova acabou há 10 min.
      const comum = "~/nod/Cecília/compartilhada";
      await criar("antiga-da-comum", 20 * DIA, comum);
      await criar("nova-da-comum", 10 * 60_000, comum);
      expect(await pastasParaLimpar(deps, { codigos: [codigoDaPasta("Cecília/compartilhada")] })).toEqual([]);
    });
  }, MUITAS_TASKS_MS);

  it("ADR-106: sem lista (máquina antiga), as 500 mais recentes — a nova não fica atrás das 520 antigas já limpas", async () => {
    await withRollback(MARLON, async (trx) => {
      const agora = Date.now();
      const { deps, criar } = await criarEm(trx, agora)();
      // O caso de 15/10: 1.151 encerradas em 30 dias, as mais antigas já fora do disco.
      for (let i = 0; i < 520; i++) await criar(`velha-${String(i).padStart(6, "0")}`, 20 * DIA);
      const nova = await criar("nova-aaaaaa", 4 * DIA);
      const outra = await criar("outra-bbbbbb", 5 * DIA);
      const semLista = await pastasParaLimpar(deps);
      expect(semLista).toHaveLength(500);
      expect(semLista.slice(0, 2).map((p) => p.trabalhoId)).toEqual([nova, outra]);
    });
  }, MUITAS_TASKS_MS);

  it("ADR-099 (I5): a frente terminada vale `sem_trabalho` na hora, na lista e pelo turno que a fechou; task, falha e frente aberta não", async () => {
    await withRollback(MARLON, async (trx) => {
      const agora = Date.now();
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => agora });
      // A frente nasce num lote (I2); a sem lote é a task de antes migrada pela 0072 (I10) e limpa como task.
      const dono = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: agora + 600_000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m" });
      await repos.turnos.assentar(dono!.id, { estado: "concluido" });
      const lote = await repos.frentes.criarLote({ agenteId, abertoPorTurnoId: dono!.id });
      const comTurno = async (slug: string, forma: "frente" | "task", semLote = false) => {
        const t = await repos.trabalhos.criar({ agenteId, conversaId, titulo: slug, origem: "pessoa", pasta: `~/nod/Vera/${slug}`, forma, loteId: forma === "frente" && !semLote ? lote!.id : null });
        const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: agora + 600_000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m", trabalhoId: t!.id });
        expect((await repos.turnos.reivindicar({ machineId: randomUUID(), agora }))?.id).toBe(turno!.id);
        await repos.turnos.assentar(turno!.id, { estado: "concluido" });
        return { trabalhoId: t!.id, turnoId: turno!.id };
      };
      const frente = await comTurno("frente-aaaaaa", "frente");
      const task = await comTurno("task-bbbbbb", "task");
      const falhou = await comTurno("frente-falhou-cccccc", "frente");
      const aberta = await comTurno("frente-aberta-dddddd", "frente");
      const migrada = await comTurno("frente-migrada-eeeeee", "frente", true);
      await repos.trabalhos.mudarEstado(frente.trabalhoId, "terminado", agora);
      await repos.trabalhos.mudarEstado(task.trabalhoId, "terminado", agora);
      await repos.trabalhos.mudarEstado(migrada.trabalhoId, "terminado", agora);
      await repos.trabalhos.mudarEstado(falhou.trabalhoId, "falhou", agora);

      const semTrabalho = { trabalhoId: frente.trabalhoId, pasta: "Vera/frente-aaaaaa", quando: "sem_trabalho" };
      expect(await pastasParaLimpar(deps)).toEqual([semTrabalho]);
      expect(await pastaSemTrabalhoDoTurno(deps, frente.turnoId)).toEqual(semTrabalho);
      for (const outro of [task, falhou, aberta, migrada]) expect(await pastaSemTrabalhoDoTurno(deps, outro.turnoId)).toBeNull();
      expect(await pastaSemTrabalhoDoTurno(deps, randomUUID())).toBeNull();

      // Com o disco apertado, depois das 2 h ela já é `encerrada` (guardar antes de apagar), e o "limpar agora" não a manda.
      await repos.trabalhos.mudarEstado(frente.trabalhoId, "terminado", agora - RETOMADA_POSSIVEL_MS);
      expect(await pastasParaLimpar(deps, { apertado: true })).toContainEqual({ ...semTrabalho, quando: "encerrada" });
      await repos.trabalhos.mudarEstado(frente.trabalhoId, "terminado", agora - LIMPAR_APOS_MS);
      expect(await pastaSemTrabalhoDoTurno(deps, frente.turnoId)).toBeNull();
    });
  });
});
