import { randomBytes, randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { criarRepos } from "../../../src/repositories/index.ts";
import { ESPERA_DECLINIO_MS, LEASE_MS } from "../../../src/shared/constantes.ts";
import { expectRejected } from "../../helpers/expect-rejected.ts";
import { agenteComConversa } from "../../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../../helpers/ids.ts";
import { describeIntegracao } from "../../helpers/integracao.ts";
import { withRollback } from "../../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const MAQUINA = randomUUID();
const base = (conversaId: string, agenteId: string, extra: Partial<Parameters<ReturnType<typeof criarRepos>["turnos"]["enfileirar"]>[0]> = {}) => ({
  conversaId,
  agenteId,
  origem: "conversa" as const,
  executor: "catcher" as const,
  prazoEm: Date.now() + 60_000,
  profundidade: 0 as const,
  entradaTexto: "oi",
  entradaConfianca: "confiavel" as const,
  modelo: "claude-haiku-4-5-20251001",
  ...extra,
});

describeIntegracao("turnosRepo: fila por conversa (ADR-010), prioridade humana (EMENDA 12) e agente serial (EMENDA 13)", () => {
  it("nasce pendente com sinais zerados; reivindicar põe despachando com lease e attempted; 2º da mesma conversa espera o 1º assentar", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const t1 = await repos.turnos.enfileirar(base(conversaId, agenteId));
      const t2 = await repos.turnos.enfileirar(base(conversaId, agenteId));
      expect(t1).toMatchObject({ estado: "pendente", sinais: { attempted: false, rejected: false, promptSubmitted: false, producedOutput: false }, machineId: null, leaseAte: null });

      const agora = Date.now();
      const r1 = await repos.turnos.reivindicar({ machineId: MAQUINA, agora });
      expect(r1).toMatchObject({ id: t1?.id, estado: "despachando", machineId: MAQUINA, sinais: { attempted: true } });
      expect(r1?.leaseAte).toBe(agora + LEASE_MS);

      // Serialização por conversa: t2 não sai enquanto t1 está despachando.
      expect(await repos.turnos.reivindicar({ machineId: MAQUINA, agora })).toBeNull();
      expect(await repos.turnos.pendentesRenderizaveis(conversaId)).toEqual([{ id: t2?.id, motivo: "agente_ocupado_em", conversaId }]);

      await repos.turnos.assentar(t1?.id ?? "", { estado: "concluido", sinais: { promptSubmitted: true, producedOutput: true }, custoUsd: 0.02 });
      const r2 = await repos.turnos.reivindicar({ machineId: MAQUINA, agora });
      expect(r2?.id).toBe(t2?.id);
      expect((await repos.turnos.buscar(t1?.id ?? ""))).toMatchObject({ estado: "concluido", custoUsd: 0.02, leaseAte: null, sinais: { promptSubmitted: true, producedOutput: true } });
    });
  });

  it("EMENDA 12: turno de conversa enfileirado DEPOIS passa na frente de rotina enfileirada ANTES", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const outra = await agenteComConversa(trx, MARLON);
      const rotina = await repos.turnos.enfileirar(base(conversaId, agenteId, { origem: "rotina" }));
      const humano = await repos.turnos.enfileirar(base(outra.conversaId, outra.agenteId, { origem: "conversa" }));
      const primeiro = await repos.turnos.reivindicar({ machineId: MAQUINA, agora: Date.now() });
      expect(primeiro?.id).toBe(humano?.id);
      const segundo = await repos.turnos.reivindicar({ machineId: MAQUINA, agora: Date.now() });
      expect(segundo?.id).toBe(rotina?.id);
    });
  });

  it("revisto em 2026-10-07 (ADR-083 §3): o mesmo agente roda na sala e na conversa própria ao mesmo tempo; o pendente da MESMA conversa diz que ela está ocupada", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const sala = await repos.conversas.criar({ tipo: "sala", salaId: randomUUID() });
      // conversa de sala exige a sala (FK deferida): cria a sala apontando para a conversa
      await repos.salas.criarComMembros({ id: sala?.salaId ?? "", nome: "revisão", conversaId: sala?.id ?? "" }, [{ agenteId, pessoaLeitoraId: PESSOA_MARLON }]);

      const naSala = await repos.turnos.enfileirar(base(sala?.id ?? "", agenteId, { origem: "sala" }));
      const naPropria = await repos.turnos.enfileirar(base(conversaId, agenteId));
      const ganhou = await repos.turnos.reivindicar({ machineId: MAQUINA, agora: Date.now() });
      expect(ganhou?.id).toBe(naSala?.id);
      // Conversas diferentes, faixas diferentes: a própria sai também, e nada fica "ocupado em outra conversa".
      expect(await repos.turnos.pendentesRenderizaveis(conversaId)).toEqual([]);
      expect((await repos.turnos.reivindicar({ machineId: MAQUINA, agora: Date.now() }))?.id).toBe(naPropria?.id);
      const segunda = await repos.turnos.enfileirar(base(conversaId, agenteId));
      expect(await repos.turnos.reivindicar({ machineId: MAQUINA, agora: Date.now() })).toBeNull();
      expect(await repos.turnos.pendentesRenderizaveis(conversaId)).toEqual([{ id: segunda?.id, motivo: "agente_ocupado_em", conversaId }]);
      // O turno de um trabalho do mesmo bot não entra no "na fila" da conversa nem espera por ela.
      const trabalho = await repos.trabalhos.criar({ agenteId, conversaId, titulo: "Relatório", origem: "pessoa" });
      const doTrabalho = await repos.turnos.enfileirar(base(conversaId, agenteId, { trabalhoId: trabalho?.id ?? null }));
      expect((await repos.turnos.pendentesRenderizaveis(conversaId)).map((p) => p.id)).toEqual([segunda?.id]);
      expect((await repos.turnos.reivindicar({ machineId: MAQUINA, agora: Date.now() }))?.id).toBe(doTrabalho?.id);
    });
  });

  it("renovarLease leva os sinais e devolve {ativo:false} depois de pedirInterrupcao ou com outra máquina", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      await repos.turnos.enfileirar(base(conversaId, agenteId));
      const t = await repos.turnos.reivindicar({ machineId: MAQUINA, agora: Date.now() });
      const id = t?.id ?? "";
      expect(await repos.turnos.renovarLease(id, MAQUINA, { promptSubmitted: true }, Date.now())).toEqual({ ativo: true });
      expect(await repos.turnos.renovarLease(id, randomUUID(), {}, Date.now())).toEqual({ ativo: false, motivo: "lease_vencido" });
      expect(await repos.turnos.marcarSinal(id, "producedOutput")).toBe(true);
      expect((await repos.turnos.buscar(id))?.sinais).toEqual({ attempted: true, rejected: false, promptSubmitted: true, producedOutput: true });

      expect(await repos.turnos.pedirInterrupcao([id], Date.now())).toBe(1);
      expect(await repos.turnos.renovarLease(id, MAQUINA, {}, Date.now())).toEqual({ ativo: false, motivo: "parado" });
      expect((await repos.turnos.despachandoDaPessoa()).map((x) => x.id)).toContain(id);
    });
  });

  it("máquina reconectada não ressuscita lease vencido antes do varredor", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      await repos.turnos.enfileirar(base(conversaId, agenteId));
      const agora = Date.now();
      const t = await repos.turnos.reivindicar({ machineId: MAQUINA, agora });
      expect(await repos.turnos.renovarLease(t!.id, MAQUINA, { promptSubmitted: true }, agora + LEASE_MS + 1)).toEqual({ ativo: false, motivo: "lease_vencido" });
      expect((await repos.turnos.buscar(t!.id))?.leaseAte).toBe(agora + LEASE_MS);
    });
  });

  it("interromper é terminal e idempotente; 'interrompido' sem motivo é recusado pelo CHECK; profundidade só de 0 a 3 (0043, ADR-063)", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const t = await repos.turnos.enfileirar(base(conversaId, agenteId));
      const id = t?.id ?? "";
      expect((await repos.turnos.interromper(id, "parado_pela_pessoa"))?.motivoInterrupcao).toBe("parado_pela_pessoa");
      expect(await repos.turnos.interromper(id, "sem_progresso")).toBeNull();
      expect(await repos.turnos.assentar(id, { estado: "concluido" })).toBeNull();

      await expectRejected(trx, () => trx`update turnos set estado = 'interrompido', motivo_interrupcao = null where id = ${id}`, "23514");
      await expectRejected(
        trx,
        () => trx`insert into turnos (owner_id, conversa_id, agente_id, origem, prazo_em, profundidade, entrada_texto, entrada_confianca, modelo)
          values (${PESSOA_MARLON}, ${conversaId}, ${agenteId}, 'peer', now(), 4, 'x', 'confiavel', 'm')`,
        "23514",
      );
      await expectRejected(
        trx,
        () => trx`insert into turnos (owner_id, conversa_id, agente_id, origem, prazo_em, profundidade, entrada_texto, entrada_confianca, modelo)
          values (${PESSOA_MARLON}, ${conversaId}, ${agenteId}, 'peer', now(), -1, 'x', 'confiavel', 'm')`,
        "23514",
      );
      // 3 é o limite da corrente e cabe no CHECK (nasce interrompido para não entrar na fila deste teste).
      expect((await repos.turnos.enfileirar(base(conversaId, agenteId, { profundidade: 3, interrompidoCom: "executor_indisponivel" })))?.profundidade).toBe(3);
      // Nasce já interrompido (executor indisponível): nunca entra na fila.
      const morto = await repos.turnos.enfileirar(base(conversaId, agenteId, { interrompidoCom: "executor_indisponivel" }));
      expect(morto).toMatchObject({ estado: "interrompido", motivoInterrupcao: "executor_indisponivel" });
      expect(await repos.turnos.reivindicar({ machineId: MAQUINA, agora: Date.now() })).toBeNull();
    });
  });

  it("vencidos lista só lease vencido; registrarEntrega é idempotente por (turno, seq_local); retomada é turno NOVO", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      await repos.turnos.enfileirar(base(conversaId, agenteId));
      const agora = Date.now();
      const t = await repos.turnos.reivindicar({ machineId: MAQUINA, agora });
      const id = t?.id ?? "";
      expect(await repos.turnos.vencidos(agora + LEASE_MS - 1)).toEqual([]);
      expect((await repos.turnos.vencidos(agora + LEASE_MS + 1)).map((x) => x.id)).toEqual([id]);

      expect(await repos.turnos.registrarEntrega(id, 1)).toBe(true);
      expect(await repos.turnos.registrarEntrega(id, 1)).toBe(false);
      expect(await repos.turnos.registrarEntrega(id, 2)).toBe(true);

      await repos.turnos.interromper(id, "maquina_sem_contato");
      const retomada = await repos.turnos.enfileirar(base(conversaId, agenteId, { origem: "retomada", retomaTurnoId: id, reenvios: 1 }));
      expect(retomada).toMatchObject({ estado: "pendente", retomaTurnoId: id, reenvios: 1, origem: "retomada" });
      expect((await repos.turnos.listarDaConversa(conversaId)).map((x) => x.id)).toEqual([id, retomada?.id]);
    });
  });
});

/** Uma fala da pessoa gravada na conversa: o marcador que faz o turno ser "da pessoa" (mensagem_origem_id). */
async function fala(repos: ReturnType<typeof criarRepos>, conversaId: string, texto: string): Promise<string> {
  const autoria = { autor_tipo: "pessoa" as const, autor_id: PESSOA_MARLON, sob_procuracao_de: null, conta_de_execucao: PESSOA_MARLON, executor: "catcher" as const, locality: "local" as const, locality_reason: "tudo_local_nesta_rodada" as const, machine_id: null, decidido_por: "pessoa" as const, regra_versao: 1 };
  const m = await repos.mensagens.criar({ conversaId, autoria, kind: "texto", texto, confianca: "confiavel" });
  return m?.id ?? "";
}

describeIntegracao("turnosRepo: a fala da pessoa passa na frente na fila do dono (ADR-099, I6)", () => {
  it("a pessoa sai antes da volta marcada já vencida (me_chame_as), mesmo chegando depois; a volta sai em seguida", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const agora = Date.now();
      const original = await repos.turnos.enfileirar(base(conversaId, agenteId));
      await repos.turnos.assentar(original?.id ?? "", { estado: "concluido" });
      const volta = await repos.turnos.enfileirar(base(conversaId, agenteId, { origem: "retomada", retomaTurnoId: original?.id ?? null, acordarEm: agora - 60_000 }));
      const pessoa = await repos.turnos.enfileirar(base(conversaId, agenteId, { entradaTexto: "e o relatório?", mensagemOrigemId: await fala(repos, conversaId, "e o relatório?") }));
      expect((await repos.turnos.reivindicar({ machineId: MAQUINA, agora }))?.id).toBe(pessoa?.id);
      // Mesma conversa: a volta espera a fala assentar (um turno de conversa por vez).
      expect(await repos.turnos.reivindicar({ machineId: MAQUINA, agora })).toBeNull();
      await repos.turnos.assentar(pessoa?.id ?? "", { estado: "concluido" });
      expect((await repos.turnos.reivindicar({ machineId: MAQUINA, agora }))?.id).toBe(volta?.id);
    });
  });

  it("a pessoa sai antes do despertar de uma espera (retomada que acorda agora), e nunca tira do lugar quem já está despachando", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const agora = Date.now();
      const rodando = await repos.turnos.enfileirar(base(conversaId, agenteId, { origem: "retomada" }));
      expect((await repos.turnos.reivindicar({ machineId: MAQUINA, agora }))?.id).toBe(rodando?.id);
      // Enquanto a retomada roda, chegam o despertar de uma espera e depois a fala da pessoa.
      const despertar = await repos.turnos.enfileirar(base(conversaId, agenteId, { origem: "retomada", retomaTurnoId: rodando?.id ?? null, acordarEm: agora }));
      const pessoa = await repos.turnos.enfileirar(base(conversaId, agenteId, { mensagemOrigemId: await fala(repos, conversaId, "e aí?") }));
      // A fala não interrompe: nada mais sai da conversa enquanto há um turno dela despachando.
      expect(await repos.turnos.reivindicar({ machineId: MAQUINA, agora })).toBeNull();
      expect(await repos.turnos.buscar(rodando?.id ?? "")).toMatchObject({ estado: "despachando", machineId: MAQUINA });
      expect((await repos.turnos.buscar(pessoa?.id ?? ""))?.estado).toBe("pendente");
      await repos.turnos.assentar(rodando?.id ?? "", { estado: "concluido" });
      expect((await repos.turnos.reivindicar({ machineId: MAQUINA, agora }))?.id).toBe(pessoa?.id);
      await repos.turnos.assentar(pessoa?.id ?? "", { estado: "concluido" });
      expect((await repos.turnos.reivindicar({ machineId: MAQUINA, agora }))?.id).toBe(despertar?.id);
    });
  });

  it("a pessoa sai antes da continuação de colega (a retomada de quem pediu e a resposta 'peer'), que mantêm a ordem de antes", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const agora = Date.now();
      const pediu = await repos.turnos.enfileirar(base(conversaId, agenteId));
      await repos.turnos.assentar(pediu?.id ?? "", { estado: "concluido" });
      // entregar-resposta-peer.ts: 'retomada' quando a tarefa foi delegada, 'peer' quando foi uma pergunta.
      const continuacao = await repos.turnos.enfileirar(base(conversaId, agenteId, { origem: "retomada", retomaTurnoId: pediu?.id ?? null, profundidade: 1, entradaConfianca: "nao_confiavel" }));
      const resposta = await repos.turnos.enfileirar(base(conversaId, agenteId, { origem: "peer", profundidade: 1, entradaConfianca: "nao_confiavel" }));
      const pessoa = await repos.turnos.enfileirar(base(conversaId, agenteId, { mensagemOrigemId: await fala(repos, conversaId, "pode parar") }));
      const ordem: (string | undefined)[] = [];
      for (let i = 0; i < 3; i++) {
        const t = await repos.turnos.reivindicar({ machineId: MAQUINA, agora });
        ordem.push(t?.id);
        await repos.turnos.assentar(t?.id ?? "", { estado: "concluido" });
      }
      expect(ordem).toEqual([pessoa?.id, continuacao?.id, resposta?.id]);
    });
  });

  it("duas falas da pessoa mantêm a ordem de chegada entre si, as duas antes da volta; turno de conversa sem fala (sem mensagem_origem_id) não fura", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const outra = await agenteComConversa(trx, MARLON);
      const agora = Date.now();
      const semFala = await repos.turnos.enfileirar(base(outra.conversaId, outra.agenteId));
      const volta = await repos.turnos.enfileirar(base(outra.conversaId, outra.agenteId, { origem: "retomada", acordarEm: agora - 1_000 }));
      const primeira = await repos.turnos.enfileirar(base(conversaId, agenteId, { mensagemOrigemId: await fala(repos, conversaId, "um") }));
      const segunda = await repos.turnos.enfileirar(base(outra.conversaId, outra.agenteId, { mensagemOrigemId: await fala(repos, outra.conversaId, "dois") }));
      const ordem: (string | undefined)[] = [];
      for (let i = 0; i < 4; i++) {
        const t = await repos.turnos.reivindicar({ machineId: MAQUINA, agora });
        ordem.push(t?.id);
        await repos.turnos.assentar(t?.id ?? "", { estado: "concluido" });
      }
      expect(ordem).toEqual([primeira?.id, segunda?.id, semFala?.id, volta?.id]);
    });
  });

  it("a faixa do trabalho não muda: a fala mandada a uma task não passa na frente da volta de outra conversa", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const outra = await agenteComConversa(trx, MARLON);
      const agora = Date.now();
      const volta = await repos.turnos.enfileirar(base(outra.conversaId, outra.agenteId, { origem: "retomada", acordarEm: agora - 1_000 }));
      const trabalho = await repos.trabalhos.criar({ agenteId, conversaId, titulo: "Relatório", origem: "pessoa" });
      const naTask = await repos.turnos.enfileirar(base(conversaId, agenteId, { trabalhoId: trabalho?.id ?? null, mensagemOrigemId: await fala(repos, conversaId, "para a task") }));
      expect((await repos.turnos.reivindicar({ machineId: MAQUINA, agora }))?.id).toBe(volta?.id);
      expect((await repos.turnos.reivindicar({ machineId: MAQUINA, agora }))?.id).toBe(naTask?.id);
    });
  });
});

// definido em 2026-10-20 (NOD-301): a máquina sem conta livre da IA deixa passar o turno sem alvo por até
// ESPERA_DECLINIO_MS quando outra máquina viva tem conta livre dela (iasSoNoutraMaquina decide a lista; aqui, a fila).
describeIntegracao("turnosRepo.reivindicar: declínio do turno sem alvo (NOD-301)", () => {
  const MAC = randomUUID();
  const VM = randomUUID();
  const CLAUDE = { ias: ["claude-cli"], auto: false } as const;
  const envelhecer = (trx: Parameters<Parameters<typeof withRollback>[1]>[0], id: string, ms: number) => trx`update turnos set criado_em = criado_em - ${`${ms} milliseconds`}::interval where id = ${id}`;

  it("CA1/CA2: com o declínio o Mac não pega e a VM pega; sem ele, o Mac pega como antes", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const t = await repos.turnos.enfileirar(base(conversaId, agenteId));
      const agora = Date.now();
      expect(await repos.turnos.reivindicar({ machineId: MAC, agora, harnessesProntos: ["claude-cli"], declinio: CLAUDE })).toBeNull();
      expect((await repos.turnos.reivindicar({ machineId: VM, agora, harnessesProntos: ["claude-cli"] }))?.id).toBe(t?.id);

      const outro = await agenteComConversa(trx, MARLON);
      const t2 = await repos.turnos.enfileirar(base(outro.conversaId, outro.agenteId));
      expect((await repos.turnos.reivindicar({ machineId: MAC, agora, harnessesProntos: ["claude-cli"] }))?.id).toBe(t2?.id);
    });
  });

  it("CA4: turno com alvo (maquina_desta_vez ou a máquina do bot) não declina", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const chave = (await repos.maquinaTokens.criar({ nome: "Mac", prefixo: randomBytes(4).toString("hex"), hash: randomBytes(32) }))!;
      const destaVez = await repos.turnos.enfileirar(base(conversaId, agenteId, { maquinaDestaVez: chave.id }));
      expect((await repos.turnos.reivindicar({ machineId: chave.id, agora: Date.now(), harnessesProntos: ["claude-cli"], declinio: CLAUDE }))?.id).toBe(destaVez?.id);

      const outro = await agenteComConversa(trx, MARLON);
      await repos.agentes.definirMaquina([outro.agenteId], chave.id);
      const doBot = await repos.turnos.enfileirar(base(outro.conversaId, outro.agenteId));
      expect((await repos.turnos.reivindicar({ machineId: chave.id, agora: Date.now(), harnessesProntos: ["claude-cli"], declinio: CLAUDE }))?.id).toBe(doBot?.id);
    });
  });

  it("CA5: o turno mais velho que ESPERA_DECLINIO_MS volta ao Mac; a volta marcada conta da hora dela", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const t = await repos.turnos.enfileirar(base(conversaId, agenteId));
      await envelhecer(trx, t!.id, ESPERA_DECLINIO_MS + 1_000);
      expect((await repos.turnos.reivindicar({ machineId: MAC, agora: Date.now(), harnessesProntos: ["claude-cli"], declinio: CLAUDE }))?.id).toBe(t?.id);

      const outro = await agenteComConversa(trx, MARLON);
      const agora = Date.now();
      const volta = await repos.turnos.enfileirar(base(outro.conversaId, outro.agenteId, { acordarEm: agora - 1_000 }));
      await envelhecer(trx, volta!.id, 10 * 60_000);
      expect(await repos.turnos.reivindicar({ machineId: MAC, agora, harnessesProntos: ["claude-cli"], declinio: CLAUDE })).toBeNull();
      expect((await repos.turnos.reivindicar({ machineId: MAC, agora: agora + ESPERA_DECLINIO_MS, harnessesProntos: ["claude-cli"], declinio: CLAUDE }))?.id).toBe(volta?.id);
    });
  });

  it("CA8: a ligação nunca declina", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const ligacao = await repos.ligacoes.criar({ iniciadaPor: "pessoa", harness: null, modelo: null, provedorStt: "falso", provedorTts: "falso", voz: "padrao", agenteId, conversaId });
      const t = await repos.turnos.enfileirar(base(conversaId, agenteId, { origem: "ligacao", ligacaoId: ligacao!.id }));
      expect((await repos.turnos.reivindicar({ machineId: MAC, agora: Date.now(), harnessesProntos: ["claude-cli"], aceitaLigacao: true, declinio: CLAUDE }))?.id).toBe(t?.id);
    });
  });

  it("CA9: conversa e rotina sem alvo declinam; IA fixa fora da lista e o Automático com auto:false não", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const agora = Date.now();
      await repos.turnos.enfileirar(base(conversaId, agenteId, { origem: "rotina" }));
      const outra = await agenteComConversa(trx, MARLON);
      await repos.turnos.enfileirar(base(outra.conversaId, outra.agenteId));
      expect(await repos.turnos.reivindicar({ machineId: MAC, agora, harnessesProntos: ["claude-cli"], declinio: CLAUDE })).toBeNull();
      // O Codex declinado não segura o turno do Claude.
      expect(await repos.turnos.reivindicar({ machineId: MAC, agora, harnessesProntos: ["claude-cli"], declinio: { ias: ["codex-cli"], auto: false } })).not.toBeNull();

      const auto = await agenteComConversa(trx, MARLON);
      const tAuto = await repos.turnos.enfileirar(base(auto.conversaId, auto.agenteId, { harness: "auto", modelo: "auto" }));
      const terceira = await agenteComConversa(trx, MARLON);
      const tAuto2 = await repos.turnos.enfileirar(base(terceira.conversaId, terceira.agenteId, { harness: "auto", modelo: "auto" }));
      expect((await repos.turnos.reivindicar({ machineId: MAC, agora, harnessesProntos: ["claude-cli", "codex-cli"], declinio: { ias: ["claude-cli"], auto: false } }))?.id).not.toBeUndefined();
      // Com todas as IAs do Automático só noutra máquina (auto:true), o Automático declina também.
      const restante = [tAuto?.id, tAuto2?.id];
      const pendentes = await trx<{ id: string }[]>`select id from turnos where id = any(${restante as string[]}::uuid[]) and estado = 'pendente'`;
      expect(pendentes).toHaveLength(1);
      expect(await repos.turnos.reivindicar({ machineId: MAC, agora, harnessesProntos: ["claude-cli"], declinio: { ias: ["claude-cli"], auto: true } })).toBeNull();
    });
  });

  it("a task com sessão do CLI não declina (a sessão é desta máquina); a sem sessão declina", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const agora = Date.now();
      const semSessao = await repos.trabalhos.criar({ agenteId, conversaId, titulo: "Sem sessão", origem: "pessoa" });
      await repos.turnos.enfileirar(base(conversaId, agenteId, { trabalhoId: semSessao!.id }));
      expect(await repos.turnos.reivindicar({ machineId: MAC, agora, harnessesProntos: ["claude-cli"], declinio: CLAUDE })).toBeNull();
      const comSessao = await repos.trabalhos.criar({ agenteId, conversaId, titulo: "Com sessão", origem: "pessoa", sessaoCli: "sessao-do-mac", sessaoHarness: "claude-cli" });
      const t = await repos.turnos.enfileirar(base(conversaId, agenteId, { trabalhoId: comSessao!.id }));
      expect((await repos.turnos.reivindicar({ machineId: MAC, agora, harnessesProntos: ["claude-cli"], declinio: CLAUDE }))?.id).toBe(t?.id);
    });
  });

  it("lista vazia é o mesmo que sem declínio", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const t = await repos.turnos.enfileirar(base(conversaId, agenteId));
      expect((await repos.turnos.reivindicar({ machineId: MAC, agora: Date.now(), harnessesProntos: ["claude-cli"], declinio: { ias: [], auto: true } }))?.id).toBe(t?.id);
    });
  });
});
