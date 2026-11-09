import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { vincularEscopo } from "../../../src/db/tx.ts";
import { criarRepos } from "../../../src/repositories/index.ts";
import { agenteComConversa } from "../../helpers/fabricas.ts";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_PADRAO } from "../../helpers/ids.ts";
import { describeIntegracao } from "../../helpers/integracao.ts";
import { withRollback } from "../../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const ANA = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_ANA };
const MAQUINA = randomUUID();
const turno = (conversaId: string, agenteId: string, trabalhoId: string | null) => ({
  conversaId, agenteId, origem: "conversa" as const, prazoEm: Date.now() + 60_000, profundidade: 0 as const, entradaTexto: "x", entradaConfianca: "confiavel" as const, modelo: "m", trabalhoId, executor: "catcher" as const,
});

describeIntegracao("trabalhos (0060, ADR-083)", () => {
  it("cria, lista os abertos e os terminados desde, muda de estado com os carimbos e guarda sessão, custo e memória", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const a = await repos.trabalhos.criar({ agenteId, conversaId, titulo: "Login do app", origem: "pessoa", pasta: "~/nod/Vera/login-do-app-abc123" });
      const b = await repos.trabalhos.criar({ agenteId, conversaId, titulo: "Relatório", origem: "pessoa" });
      expect(a?.estado).toBe("na_fila");
      const agora = Date.now();
      expect((await repos.trabalhos.mudarEstado(a!.id, "rodando", agora))?.iniciadoEm).toBe(agora);
      const terminado = await repos.trabalhos.mudarEstado(b!.id, "terminado", agora);
      expect(terminado?.terminadoEm).toBe(agora);
      expect((await repos.trabalhos.listar({ agenteId, terminadosDesde: agora - 1000 })).map((t) => t.id)).toEqual([a!.id, b!.id]);
      expect((await repos.trabalhos.listar({ agenteId, terminadosDesde: agora + 1000 })).map((t) => t.id)).toEqual([a!.id]);
      expect((await repos.trabalhos.abertosDoAgente(agenteId)).map((t) => t.id)).toEqual([a!.id]);
      // NOD-256 (F1.3): sair de um estado final sem `reabrir` é recusado — a linha não muda.
      expect(await repos.trabalhos.mudarEstado(b!.id, "rodando", agora)).toBeNull();
      expect((await repos.trabalhos.buscar(b!.id))?.estado).toBe("terminado");
      // Reaberto pela pessoa (uma mensagem nova para a task): o carimbo de fim sai, o CHECK trabalho_terminado segue de pé.
      expect((await repos.trabalhos.mudarEstado(b!.id, "rodando", agora, { reabrir: true }))?.terminadoEm).toBeNull();
      // De final para final não é reabrir: passa sem a flag.
      expect((await repos.trabalhos.mudarEstado(b!.id, "parado", agora))?.estado).toBe("parado");
      expect((await repos.trabalhos.mudarEstado(b!.id, "falhou", agora))?.estado).toBe("falhou");

      expect(await repos.trabalhos.atualizarSessao(a!.id, "sessao-1", "claude-cli")).toBe(true);
      expect(await repos.trabalhos.somarCusto(a!.id, 0.25)).toBe(true);
      expect(await repos.trabalhos.somarCusto(a!.id, 0.5)).toBe(true);
      const t = await repos.turnos.enfileirar(turno(conversaId, agenteId, a!.id));
      expect(await repos.trabalhos.atualizarMemoria([{ turnoId: t!.id, mb: 412.6 }, { turnoId: randomUUID(), mb: 1 }])).toBe(1);
      // Revisão do épico (S22): a mesma leitura de novo não reescreve a linha.
      expect(await repos.trabalhos.atualizarMemoria([{ turnoId: t!.id, mb: 413 }])).toBe(0);
      expect(await repos.trabalhos.buscar(a!.id)).toMatchObject({ sessaoCli: "sessao-1", sessaoHarness: "claude-cli", custoUsd: 0.75, memoriaMb: 413, pasta: "~/nod/Vera/login-do-app-abc123" });
      // ADR-097 (fase 0c): a leitura que cai muda a última, e o pico fica no maior que o servidor viu.
      expect(await repos.trabalhos.atualizarMemoria([{ turnoId: t!.id, mb: 300 }])).toBe(1);
      const [linha] = await trx<{ memoria_mb: number; memoria_pico_mb: number }[]>`select memoria_mb, memoria_pico_mb from trabalhos where id = ${a!.id}`;
      expect(linha).toEqual({ memoria_mb: 300, memoria_pico_mb: 413 });
      expect((await repos.trabalhos.redeComSessao(conversaId, "sessao-1"))).toBeNull();
    });
  });

  it("fatos: despachando, pendentes, a espera do depois_de, decisão pendente de um turno dele e o desfecho do último (absorvido não conta)", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const w = await repos.trabalhos.criar({ agenteId, conversaId, titulo: "Fatos", origem: "pessoa" });
      expect(await repos.trabalhos.fatos(w!.id)).toEqual({ parando: 0, despachando: 0, pendentes: 0, aguardandoDespertar: false, aguardandoComando: false, esperandoOutro: false, decisaoPendente: false, aguardandoColega: false, ultimo: null });
      // "Fazer depois da …": espera enquanto a outra está aberta, e para de esperar quando ela acaba.
      const antes = await repos.trabalhos.criar({ agenteId, conversaId, titulo: "Antes", origem: "pessoa" });
      await repos.trabalhos.marcarDepoisDe(w!.id, antes!.id);
      expect((await repos.trabalhos.fatos(w!.id))?.esperandoOutro).toBe(true);
      await repos.trabalhos.mudarEstado(antes!.id, "terminado", Date.now());
      expect((await repos.trabalhos.fatos(w!.id))?.esperandoOutro).toBe(false);
      const t1 = await repos.turnos.enfileirar(turno(conversaId, agenteId, w!.id));
      expect((await repos.trabalhos.fatos(w!.id))?.pendentes).toBe(1);
      await repos.turnos.reivindicar({ machineId: MAQUINA, agora: Date.now() });
      expect((await repos.trabalhos.fatos(w!.id))?.despachando).toBe(1);
      await repos.decisoes.criar({ tipo: "pergunta", agenteId, conversaId, turnoId: t1!.id, prazoDecisaoEm: Date.now() + 60_000, frase: "Qual?" });
      expect((await repos.trabalhos.fatos(w!.id))?.decisaoPendente).toBe(true);
      await repos.turnos.assentar(t1!.id, { estado: "concluido" });
      expect((await repos.trabalhos.fatos(w!.id))?.ultimo).toEqual({ estado: "concluido", motivo: null });
    });
  });

  it("extras: quem pediu, a rotina, a última fala do bot nos turnos dele e o turno vivo", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const chico = await repos.agentes.criar({ nome: "Chico", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m" });
      const w = await repos.trabalhos.criar({ agenteId, conversaId, titulo: "Pedido", origem: "colega", pedidoPorAgenteId: chico!.id });
      const t = await repos.turnos.enfileirar(turno(conversaId, agenteId, w!.id));
      await repos.turnos.reivindicar({ machineId: MAQUINA, agora: Date.now() });
      const autoria = { autor_tipo: "agente" as const, autor_id: agenteId, sob_procuracao_de: null, conta_de_execucao: PESSOA_MARLON, executor: "catcher" as const, locality: "local" as const, locality_reason: "tudo_local_nesta_rodada" as const, machine_id: null, decidido_por: "regra:localidade" as const, regra_versao: 1 };
      await repos.mensagens.criar({ conversaId, turnoId: t!.id, autoria, kind: "texto", texto: "Lendo o PR", confianca: "confiavel" });
      const extras = (await repos.trabalhos.extras([w!.id])).get(w!.id);
      // esperandoColega e trabalhouMs (tempo da task, 2026-10-08) se provam em tests/integration/tempo-da-task.test.ts.
      expect(extras).toEqual({ pedidoPorNome: "Chico", rotinaNome: null, ultimaFala: "Lendo o PR", turnoVivoId: t!.id, turnosAbertos: [t!.id], deFora: true, esperandoColega: null, trabalhouMs: 0, acordaEm: null, esperandoComando: null, maquinaVivaId: MAQUINA, maquinaAlvoId: null, acordaMotivo: null, lote: null, loteTitulo: null, pendente: null });
    });
  });

  it("RLS (#192, critério 4): os trabalhos de uma pessoa não aparecem para outra, e ela não muda o de outra", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const w = await repos.trabalhos.criar({ agenteId, conversaId, titulo: "Privado", origem: "pessoa" });
      await vincularEscopo(trx, ANA);
      const comoAna = criarRepos(trx, ANA);
      expect(await comoAna.trabalhos.buscar(w!.id)).toBeNull();
      expect(await comoAna.trabalhos.listar({ terminadosDesde: 0 })).toEqual([]);
      expect(await comoAna.trabalhos.mudarEstado(w!.id, "parado", Date.now())).toBeNull();
      await vincularEscopo(trx, MARLON);
      expect((await repos.trabalhos.buscar(w!.id))?.estado).toBe("na_fila");
    });
  });

  it("a retomada herda o trabalho do turno que continua; a fila lida junta só junta a mesma faixa", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const w = await repos.trabalhos.criar({ agenteId, conversaId, titulo: "Herança", origem: "pessoa" });
      const original = await repos.turnos.enfileirar(turno(conversaId, agenteId, w!.id));
      const retomada = await repos.turnos.enfileirar({ ...turno(conversaId, agenteId, null), trabalhoId: undefined, origem: "retomada", retomaTurnoId: original!.id });
      expect(retomada?.trabalhoId).toBe(w!.id);

      const daConversa = await repos.turnos.enfileirar({ ...turno(conversaId, agenteId, null), mensagemOrigemId: null });
      const autoria = { autor_tipo: "pessoa" as const, autor_id: PESSOA_MARLON, sob_procuracao_de: null, conta_de_execucao: PESSOA_MARLON, executor: "catcher" as const, locality: "local" as const, locality_reason: "tudo_local_nesta_rodada" as const, machine_id: null, decidido_por: "pessoa" as const, regra_versao: 1 };
      const m1 = await repos.mensagens.criar({ conversaId, autoria, kind: "texto", texto: "um", confianca: "confiavel" });
      const m2 = await repos.mensagens.criar({ conversaId, autoria, kind: "texto", texto: "dois", confianca: "confiavel" });
      const m3 = await repos.mensagens.criar({ conversaId, autoria, kind: "texto", texto: "para a task", confianca: "confiavel" });
      const a = await repos.turnos.enfileirar({ ...turno(conversaId, agenteId, null), mensagemOrigemId: m1!.id });
      await repos.turnos.enfileirar({ ...turno(conversaId, agenteId, null), mensagemOrigemId: m2!.id });
      const daTask = await repos.turnos.enfileirar({ ...turno(conversaId, agenteId, w!.id), mensagemOrigemId: m3!.id });
      const { absorvidos } = await repos.turnos.absorverPendentes(a!, (textos) => textos.join("|"));
      expect(absorvidos.map((t) => t.entradaTexto)).toEqual(["x"]);
      expect((await repos.turnos.buscar(daTask!.id))?.estado).toBe("pendente");
      expect((await repos.turnos.buscar(daConversa!.id))?.estado).toBe("pendente");
    });
  });
});
