import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { OpQuadro } from "../../src/contracts/quadro.ts";
import { AVISO_SEM_SAIDA, VOLTA_CI_SEM_CHECKS_MS } from "../../src/contracts/quadro-execucoes.ts";
import type { PrDaTarefa } from "../../src/contracts/prs-da-tarefa.ts";
import type { Tx } from "../../src/shared/types.ts";
import { assentarTurno } from "../../src/use-cases/assentar-turno.ts";
import { meChameAs } from "../../src/use-cases/me-chame-as.ts";
import { aplicarLoteQuadro, montarQuadro, type PedidoLote } from "../../src/use-cases/quadro.ts";
import { acordarVoltasDeCi, cuidarDasExecucoesDoQuadro, trabalhoDaTarefa } from "../../src/use-cases/quadro-execucoes.ts";
import { abrirFrentes } from "../../src/use-cases/frentes.ts";
import { comentarTarefa } from "../../src/use-cases/comentar-tarefa.ts";
import { varrerAvisosDosQuadros } from "../../src/use-cases/avisos-quadro.ts";
import { LIMITE_ACIONAMENTOS_HORA } from "../../src/domain/freios-quadro.ts";
import { contexto, depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * ADA-232 (ADR-155): todo trabalho de tarefa termina numa de 4 saídas. O turno que conclui sem dizer o porquê é reacionado
 * uma vez na mesma cadeia (mesma sessão e pasta) e, na 2ª parada seguida, a tarefa vai para Precisa de você. O turno passa
 * pelo assentamento de verdade (assentarTurno): é ele que grava a saída.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const SINAIS = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true };
const sucesso = (ferramentasChamadas: string[]) => ({ desfecho: "sucesso" as const, texto: "rodei o gh pr checks", sessaoCli: null, sinais: SINAIS, custoUsd: 0, tokens: { entrada: 1, saida: 1, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas, negacoesPermissao: [] });

async function montar(trx: Tx) {
  const sufixo = Math.random().toString(36).slice(2, 7);
  const ana = await agenteComConversa(trx, MARLON, { nome: `Ana ${sufixo}` });
  const beto = await agenteComConversa(trx, MARLON, { nome: `Beto ${sufixo}` });
  const { deps, repos } = depsSobre(trx, MARLON);
  await repos.preferencias.gravar({ experimentos: { quadro: true } });
  const p: PedidoLote = { autor: { tipo: "pessoa" }, anfitriaoId: ana.agenteId, executor: "catcher", ops: [] };
  const lote = async (o: OpQuadro[], quem: PedidoLote = p) => {
    const r = await aplicarLoteQuadro(deps, { ...quem, ops: o });
    if (!r.data.ok) throw new Error(r.data.detalhe);
    return r.data;
  };
  await lote([{ tipo: "criar_quadro" }, { tipo: "criar_tarefa", titulo: "T", status: "afazer", agente: `Beto ${sufixo}` }]);
  const tarefa = async () => {
    const q = await repos.quadros.doAgente(ana.agenteId);
    return (await repos.quadros.tarefas(q!.id)).find((t) => t.titulo === "T")!;
  };
  const machineId = randomUUID();
  /** A máquina pega o turno pendente da cadeia (o do começo ou a retomada) e o devolve. */
  const pegar = async () => {
    const t = await repos.turnos.reivindicar({ machineId, agora: Date.now() + 1_000 });
    if (!t) throw new Error("nada para reivindicar");
    return t;
  };
  const assentar = (turnoId: string, ferramentas: string[] = ["Bash"]) =>
    assentarTurno(deps, { turnoId, machineId, seqLocal: 1, fala: { tipo: "texto", texto: "rodei o gh pr checks" }, resultado: sucesso(ferramentas), executor: "catcher" });
  const varrer = () => cuidarDasExecucoesDoQuadro(deps);
  const execs = async () => repos.quadroExecucoes.daTarefa((await tarefa()).id);
  const turnosDoBeto = async () => repos.turnos.listarDaConversa(beto.conversaId, 50);
  return { ana, beto, deps, repos, p, lote, tarefa, pegar, assentar, varrer, execs, turnosDoBeto };
}

describeIntegracao("ADA-232: saída obrigatória do trabalho da tarefa", () => {
  it("regressão ADA-228 (PR #677, 05/11): parou sem saída → 1 reacionamento na mesma cadeia; 2ª parada → Precisa de você", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const raiz = await m.pegar();
      expect(raiz.id).toBe((await m.tarefa()).turnoId);
      // O bot abre o PR, roda o gh pr checks e o turno conclui sem chamar nada no quadro.
      await m.assentar(raiz.id, ["Bash", "Bash"]);
      expect((await m.execs())[0]).toMatchObject({ saida: "nenhuma", semSaida: 0 });
      await m.varrer();
      // A retomada nasce na MESMA cadeia (retoma a raiz: a mesma sessão e pasta), com o aviso das 4 saídas.
      const retomada = (await m.turnosDoBeto()).find((t) => t.origem === "retomada" && t.retomaTurnoId === raiz.id);
      expect(retomada).toBeDefined();
      expect(retomada!.entradaTexto.startsWith(AVISO_SEM_SAIDA)).toBe(true);
      expect((await m.execs())).toHaveLength(1);
      expect((await m.execs())[0]).toMatchObject({ saida: null, semSaida: 1 });
      expect((await m.tarefa()).status).not.toBe("voce");
      // Um 2º passe do varredor não reaciona de novo (a cadeia está viva).
      await m.varrer();
      expect((await m.turnosDoBeto()).filter((t) => t.origem === "retomada")).toHaveLength(1);
      // A retomada também para sem saída: a tarefa vai para Precisa de você com o motivo, e ninguém mais é chamado.
      const segunda = await m.pegar();
      expect(segunda.id).toBe(retomada!.id);
      await m.assentar(segunda.id, []);
      await m.varrer();
      const t = await m.tarefa();
      expect(t.status).toBe("voce");
      expect(t.pergunta).toContain("2x sem saída");
      await m.varrer();
      expect((await m.turnosDoBeto()).filter((x) => x.origem === "retomada")).toHaveLength(1);
    });
  });

  it("P8 (10/11): a ida à espera pelo varredor entra nos movimentos: entradasNaEspera a acha e a pessoa desfaz", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const raiz = await m.pegar();
      await m.assentar(raiz.id, []);
      await m.varrer();
      const segunda = await m.pegar();
      await m.assentar(segunda.id, []);
      await m.varrer();
      const t = await m.tarefa();
      expect(t.status).toBe("voce");
      const entradas = await m.repos.quadros.entradasNaEspera(t.quadroId);
      expect(entradas.find((x) => x.tarefaId === t.id)).toMatchObject({ tipo: "mover", para: "voce", de: t.voltarPara });
      await m.lote([{ tipo: "desfazer_movimento", tarefa: "T" }]);
      expect((await m.tarefa()).status).toBe(t.voltarPara);
    });
  });

  // ADA-289 (P1 do Dante): o varredor tinha um "andando" só de A fazer e Fazendo; o bot acionado em Em revisão (pela
  // passagem da coluna, ADR-142) que parava calado era gravado como "andou" e nunca era cobrado (ADR-155 §1/§3).
  it("Em revisão também cobra a saída: o bot acionado lá que para sem saída grava nenhuma e é reacionado", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const nome = (await m.repos.agentes.buscar(m.beto.agenteId))!.nome;
      await m.lote([{ tipo: "definir_passagem", coluna: "revisao", agente: nome }, { tipo: "criar_tarefa", titulo: "R", status: "revisao", agente: nome }]);
      const q = await m.repos.quadros.doAgente(m.ana.agenteId);
      const r = (await m.repos.quadros.tarefas(q!.id)).find((t) => t.titulo === "R")!;
      expect(r.status).toBe("revisao");
      expect(r.turnoId).not.toBeNull();
      // Descarta o turno da tarefa "T" (criada no montar) para pegar o da "R".
      let turno = await m.pegar();
      if (turno.id !== r.turnoId) { await m.assentar(turno.id, ["Bash"]); turno = await m.pegar(); }
      expect(turno.id).toBe(r.turnoId);
      await m.assentar(turno.id, ["Bash"]);
      expect((await m.repos.quadroExecucoes.daTarefa(r.id))[0]).toMatchObject({ saida: "nenhuma" });
      await m.varrer();
      expect((await m.turnosDoBeto()).some((t) => t.origem === "retomada" && t.retomaTurnoId === turno.id)).toBe(true);
    });
  });

  it("pôr o PR na tarefa é saída (andou): nada é reacionado", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const raiz = await m.pegar();
      // P1 (10/11): o PR leva a tarefa a Em revisão, que agora anda (é cobrada); o "andou" sai do PR ganho durante o turno,
      // não mais de a Revisão contar como "fora". O despacho volta ao agora real, como no teste abaixo.
      await trx`update turnos set despachado_em = clock_timestamp() where id = ${raiz.id}`;
      await m.lote([{ tipo: "mudar_tarefa", tarefa: "T", pr_url: "https://github.com/gamefik/nod/pull/677" }]);
      await m.assentar(raiz.id, ["mcp__nod__gerir_quadro"]);
      expect((await m.execs())[0]!.saida).toBe("andou");
      await m.varrer();
      expect((await m.turnosDoBeto()).filter((t) => t.origem === "retomada")).toHaveLength(0);
    });
  });

  it("revisão: pôr o PR sem mudar de coluna também é saída (andou) — pr_url não entra no histórico da tarefa", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const raiz = await m.pegar();
      // pegar() reivindica com o relógio 1 s à frente (para a retomada de agora valer): o despacho volta para o agora real,
      // depois da criação da tarefa (que entra no histórico) e antes do lote do bot.
      await trx`update turnos set despachado_em = clock_timestamp() where id = ${raiz.id}`;
      const status = (await m.tarefa()).status;
      await m.lote([{ tipo: "mudar_tarefa", tarefa: "T", status, pr_url: "https://github.com/gamefik/nod/pull/677" }]);
      expect((await m.tarefa())).toMatchObject({ status, prUrl: "https://github.com/gamefik/nod/pull/677" });
      await m.assentar(raiz.id, ["mcp__nod__gerir_quadro"]);
      expect((await m.execs())[0]!.saida).toBe("andou");
    });
  });

  it("Precisa de você com a pergunta é saída (voce): nada é reacionado", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const raiz = await m.pegar();
      await m.lote([{ tipo: "mudar_tarefa", tarefa: "T", status: "voce", pergunta: "Qual repo?" }]);
      await m.assentar(raiz.id, ["mcp__nod__gerir_quadro"]);
      expect((await m.execs())[0]!.saida).toBe("voce");
      await m.varrer();
      expect((await m.turnosDoBeto()).filter((t) => t.origem === "retomada")).toHaveLength(0);
      expect((await m.tarefa()).pergunta).toBe("Qual repo?");
    });
  });

  it("me_chame_as é saída (volta): o varredor não cobra, a volta retoma a cadeia", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const raiz = await m.pegar();
      const r = await meChameAs(m.deps, { turnoId: raiz.id, agenteId: m.beto.agenteId, conversaId: m.beto.conversaId, em_minutos: 10, motivo: "a CI do #677" } as Parameters<typeof meChameAs>[1]);
      expect((r.data as { ok: boolean }).ok).toBe(true);
      await m.assentar(raiz.id, ["mcp__nod__me_chame_as"]);
      expect((await m.execs())[0]!.saida).toBe("volta");
      await m.varrer();
      const voltas = (await m.turnosDoBeto()).filter((t) => t.origem === "retomada");
      expect(voltas).toHaveLength(1);
      expect(voltas[0]!.entradaTexto).not.toContain(AVISO_SEM_SAIDA);
      expect((await m.execs())[0]!.semSaida).toBe(0);
    });
  });

  it("revisão: me_chame_as recusado (sem_pr) não é saída — o nome da ferramenta não basta, a volta precisa existir", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const raiz = await m.pegar();
      const r = await meChameAs(m.deps, { turnoId: raiz.id, agenteId: m.beto.agenteId, conversaId: m.beto.conversaId, quando: "ci", motivo: "a CI" } as Parameters<typeof meChameAs>[1]);
      expect(r.data).toMatchObject({ ok: false, erro: "sem_pr" });
      await m.assentar(raiz.id, ["Bash", "mcp__nod__me_chame_as"]);
      expect((await m.execs())[0]!.saida).toBe("nenhuma");
      await m.varrer();
      expect((await m.turnosDoBeto()).filter((t) => t.origem === "retomada" && t.entradaTexto.startsWith(AVISO_SEM_SAIDA))).toHaveLength(1);
    });
  });

  it("revisão: o trabalho que abriu frentes e concluiu espera as frentes (volta), não é parada sem saída", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const raiz = await m.pegar();
      const r = await abrirFrentes(m.deps, { ...contexto(m.beto.agenteId, m.beto.conversaId, raiz.id), frentes: [{ titulo: "Login", pedido: "Conserte o login." }], avisar_a_cada_uma: false });
      if (!r.data.ok) throw new Error(r.data.instrucao);
      await m.assentar(raiz.id, ["mcp__nod__abrir_frentes"]);
      expect((await m.execs())[0]!.saida).toBe("volta");
      await m.varrer();
      expect((await m.turnosDoBeto()).filter((t) => t.origem === "retomada" && t.entradaTexto.startsWith(AVISO_SEM_SAIDA))).toHaveLength(0);
      expect((await m.tarefa()).status).not.toBe("voce");
    });
  });

  it("o recado da pessoa vence o reacionamento; a pessoa que tirou a tarefa do andamento também", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const raiz = await m.pegar();
      await m.assentar(raiz.id, ["Bash"]);
      const r = await trabalhoDaTarefa(m.deps, m.p, { tipo: "recado", tarefa: "T", texto: "olhe o lint" } as Parameters<typeof trabalhoDaTarefa>[2]);
      expect(r.data.ok).toBe(true);
      await m.varrer();
      expect((await m.turnosDoBeto()).filter((t) => t.origem === "retomada" && t.entradaTexto.startsWith(AVISO_SEM_SAIDA))).toHaveLength(0);
    });
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const raiz = await m.pegar();
      await m.lote([{ tipo: "mudar_tarefa", tarefa: "T", status: "backlog" }]);
      await m.assentar(raiz.id, ["Bash"]);
      // Sair do andamento cancela o trabalho (o turno de antes) ou conta como andou: nunca nenhuma.
      expect((await m.execs())[0]!.saida).not.toBe("nenhuma");
      await m.varrer();
      expect((await m.turnosDoBeto()).filter((t) => t.origem === "retomada")).toHaveLength(0);
      expect((await m.tarefa()).status).toBe("backlog");
    });
  });

  it("P1 (comparação Multica, 10/11): o bot acionado pela passagem em Em revisão que para sem saída é cobrado como em Fazendo", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.pegar();
      // A pessoa põe a Ana na Revisão e manda a tarefa para lá: a passagem aciona a Ana na coluna (ADR-142). O turno do
      // Beto é parado (parar_anterior): sem isso ele seguiria vivo, preso à etapa dele, e o varredor esperaria por ele.
      await m.lote([{ tipo: "definir_passagem", coluna: "revisao", agente: m.ana.agenteId }, { tipo: "mudar_tarefa", tarefa: "T", status: "revisao", parar_anterior: true }]);
      const t = await m.tarefa();
      expect(t.status).toBe("revisao");
      const revisao = await m.pegar();
      expect(revisao.id).toBe(t.turnoId);
      await m.assentar(revisao.id, ["Bash"]);
      const exec = (await m.execs()).find((e) => e.turnoId === revisao.id)!;
      expect(exec.saida).toBe("nenhuma");
      await m.varrer();
      const daAna = await m.repos.turnos.listarDaConversa(m.ana.conversaId, 50);
      const retomada = daAna.find((x) => x.origem === "retomada" && x.retomaTurnoId === revisao.id);
      expect(retomada?.entradaTexto.startsWith(AVISO_SEM_SAIDA)).toBe(true);
    });
  });

  it("P4 (10/11, ADR-155 §6): o turno de comentário do responsável que para calado é cobrado; o que só respondeu na tarefa, não", async () => {
    for (const respondeu of [false, true]) {
      await withRollback(MARLON, async (trx) => {
        const m = await montar(trx);
        const raiz = await m.pegar();
        // O trabalho anda (PR → Em revisão) e termina; depois a pessoa comenta e aciona o Beto, responsável.
        await trx`update turnos set despachado_em = clock_timestamp() where id = ${raiz.id}`;
        await m.lote([{ tipo: "mudar_tarefa", tarefa: "T", pr_url: "https://github.com/gamefik/nod/pull/677" }]);
        await m.assentar(raiz.id, ["mcp__nod__gerir_quadro"]);
        await m.varrer();
        // O relógio do teste: tudo na transação grava com o mesmo now(); o que veio antes do comentário vai 1 h para trás.
        await trx`update quadro_tarefa_historico set criado_em = now() - interval '1 hour'`;
        await trx`update quadro_lotes set criado_em = now() - interval '1 hour'`;
        const c = await comentarTarefa(m.deps, m.p, { tipo: "comentar", tarefa: "T", texto: "Beto, qual o status do lint?" });
        expect(c.data.ok).toBe(true);
        const doComentario = await m.pegar();
        expect((await m.execs()).find((e) => e.turnoId === doComentario.id)?.origem).toBe("comentario");
        expect((await m.tarefa()).turnoId).toBe(doComentario.id);
        await trx`update turnos set despachado_em = now() - interval '1 second' where id = ${doComentario.id}`;
        if (respondeu) {
          const r = await comentarTarefa(m.deps, { ...m.p, autor: { tipo: "agente", agenteId: m.beto.agenteId }, turnoId: doComentario.id }, { tipo: "comentar", tarefa: "T", texto: "o lint passou" });
          expect(r.data.ok).toBe(true);
        }
        await m.assentar(doComentario.id, []);
        const exec = (await m.execs()).find((e) => e.turnoId === doComentario.id)!;
        expect(exec.saida).toBe(respondeu ? null : "nenhuma");
        await m.varrer();
        const cobrado = (await m.turnosDoBeto()).some((x) => x.origem === "retomada" && x.retomaTurnoId === doComentario.id && x.entradaTexto.startsWith(AVISO_SEM_SAIDA));
        expect(cobrado).toBe(!respondeu);
      });
    }
  });

  it("saída de verdade zera a série: parar sem saída de novo depois reaciona outra vez", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const raiz = await m.pegar();
      await m.assentar(raiz.id, []);
      await m.varrer();
      const re = await m.pegar();
      // No reacionamento o bot marca a volta (saída), e a volta para sem saída: reaciona de novo (a série zerou).
      await meChameAs(m.deps, { turnoId: re.id, agenteId: m.beto.agenteId, conversaId: m.beto.conversaId, em_minutos: 5, motivo: "CI" } as Parameters<typeof meChameAs>[1]);
      await m.assentar(re.id, ["mcp__nod__me_chame_as"]);
      expect((await m.execs())[0]).toMatchObject({ saida: "volta", semSaida: 0 });
      await trx`update turnos set acordar_em = now() - interval '1 second' where estado = 'pendente' and conversa_id = ${m.beto.conversaId}`;
      const volta = await m.pegar();
      await m.assentar(volta.id, []);
      await m.varrer();
      expect((await m.tarefa()).status).not.toBe("voce");
      expect((await m.execs())[0]!.semSaida).toBe(1);
    });
  });
});

const PR = "https://github.com/gamefik/nod/pull/677";

describeIntegracao("ADA-232: volta quando a CI do PR terminar", () => {
  async function comVoltaCi(trx: Tx) {
    const m = await montar(trx);
    const raiz = await m.pegar();
    await m.lote([{ tipo: "mudar_tarefa", tarefa: "T", pr_url: PR }]);
    const r = await meChameAs(m.deps, { turnoId: raiz.id, agenteId: m.beto.agenteId, conversaId: m.beto.conversaId, quando: "ci", motivo: "a CI do #677" } as Parameters<typeof meChameAs>[1]);
    expect((r.data as { ok: boolean }).ok).toBe(true);
    await m.assentar(raiz.id, ["mcp__nod__me_chame_as"]);
    const volta = (await m.turnosDoBeto()).find((t) => t.origem === "retomada" && t.estado === "pendente")!;
    expect(volta).toBeDefined();
    const gravarPr = async (estado: PrDaTarefa["estado"], ci: PrDaTarefa["ci"]) => {
      const t = await m.tarefa();
      await m.repos.quadros.salvarPr(t.quadroId, t.id, { repo: "gamefik/nod", numero: 677, url: PR, branch: "b", estado, ci, conflito: false });
    };
    const acordarEm = async () => (await m.repos.turnos.buscar(volta.id))!.acordarEm!;
    return { m, raiz, volta, gravarPr, acordarEm };
  }

  it("a volta nasce dormindo 24h na mesma cadeia, com a condição; CI rodando não acorda; CI terminada acorda na hora", async () => {
    await withRollback(MARLON, async (trx) => {
      const { m, raiz, volta, gravarPr, acordarEm } = await comVoltaCi(trx);
      expect(volta.retomaTurnoId).toBe(raiz.id);
      expect(volta.entradaTexto).toContain(PR);
      expect((await m.execs())[0]!.saida).toBe("volta");
      expect(await acordarEm()).toBeGreaterThan(Date.now() + 23 * 3_600_000);
      // PR ainda não visto pelo laço de PRs, depois com checks rodando: dorme.
      expect(await acordarVoltasDeCi(m.deps)).toBe(0);
      await gravarPr("aberto", "pendente");
      await m.varrer();
      expect(await acordarEm()).toBeGreaterThan(Date.now() + 23 * 3_600_000);
      // A CI terminou (falhou também conta): o varredor traz a volta para agora e a máquina a pega na mesma sessão.
      await gravarPr("aberto", "falhou");
      await m.varrer();
      expect(await acordarEm()).toBeLessThanOrEqual(Date.now() + 1_000);
      const pega = await m.pegar();
      expect(pega.id).toBe(volta.id);
      // Idempotente: acordar de novo não muda nada.
      expect(await acordarVoltasDeCi(m.deps)).toBe(0);
    });
  });

  it("PR mergeado acorda; sem checks só depois da folga", async () => {
    await withRollback(MARLON, async (trx) => {
      const { m, gravarPr, acordarEm } = await comVoltaCi(trx);
      await gravarPr("aberto", null);
      expect(await acordarVoltasDeCi(m.deps)).toBe(0);
      const depois = { ...m.deps, agora: () => Date.now() + VOLTA_CI_SEM_CHECKS_MS + 1_000 };
      expect(await acordarVoltasDeCi(depois)).toBe(1);
      expect(await acordarEm()).toBeLessThan(Date.now() + VOLTA_CI_SEM_CHECKS_MS + 2_000);
    });
    await withRollback(MARLON, async (trx) => {
      const { m, gravarPr } = await comVoltaCi(trx);
      await gravarPr("mergeado", "pendente");
      expect(await acordarVoltasDeCi(m.deps)).toBe(1);
    });
  });

  it("revisão: a CI terminada de ANTES da volta (o push novo ainda não visto) não acorda; a transição depois dela acorda", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const raiz = await m.pegar();
      await m.lote([{ tipo: "mudar_tarefa", tarefa: "T", pr_url: PR }]);
      const t = await m.tarefa();
      const gravarPr = (ci: PrDaTarefa["ci"]) => m.repos.quadros.salvarPr(t.quadroId, t.id, { repo: "gamefik/nod", numero: 677, url: PR, branch: "b", estado: "aberto", ci, conflito: false });
      // A CI do commit anterior falhou e o laço de PRs a gravou; o bot corrige, faz push e marca a volta.
      await gravarPr("falhou");
      const r = await meChameAs(m.deps, { turnoId: raiz.id, agenteId: m.beto.agenteId, conversaId: m.beto.conversaId, quando: "ci", motivo: "a CI do #677" } as Parameters<typeof meChameAs>[1]);
      expect((r.data as { ok: boolean }).ok).toBe(true);
      await m.assentar(raiz.id, ["mcp__nod__me_chame_as"]);
      expect(await acordarVoltasDeCi(m.deps)).toBe(0);
      // O laço vê a CI nova rodando e depois terminada: aí sim acorda.
      await gravarPr("pendente");
      expect(await acordarVoltasDeCi(m.deps)).toBe(0);
      await gravarPr("ok");
      expect(await acordarVoltasDeCi(m.deps)).toBe(1);
    });
  });

  it("quando: ci sem PR na tarefa é recusado com instrução, e nada é marcado", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const raiz = await m.pegar();
      const r = await meChameAs(m.deps, { turnoId: raiz.id, agenteId: m.beto.agenteId, conversaId: m.beto.conversaId, quando: "ci", motivo: "CI" } as Parameters<typeof meChameAs>[1]);
      expect(r.data).toMatchObject({ ok: false, erro: "sem_pr" });
      expect(await m.repos.turnos.despertarDoTurno(raiz.id)).toBeNull();
    });
  });
});

describeIntegracao("ADA-232: freios contam retomadas; zelador não cobra quem espera", () => {
  it("as retomadas da cadeia somam no teto da hora; no teto, o reacionamento vira Precisa de você", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const t0 = await m.tarefa();
      const antes = (await m.repos.quadros.acionamentosNaHora(t0.quadroId)).get(t0.id) ?? 0;
      const raiz = await m.pegar();
      await m.assentar(raiz.id, []);
      await m.varrer();
      // O reacionamento é uma retomada: conta.
      expect((await m.repos.quadros.acionamentosNaHora(t0.quadroId)).get(t0.id)).toBe(antes + 1);
      // Simula a hora cheia: 12 retomadas na cadeia; a próxima parada sem saída não reaciona, vai para Precisa de você.
      const re = await m.pegar();
      for (let i = 0; i < 12; i++) {
        await trx`insert into turnos (tenant_id, id, owner_id, conversa_id, agente_id, origem, estado, prazo_em, profundidade, entrada_texto, entrada_confianca, retoma_turno_id, executor, modelo)
          select tenant_id, gen_random_uuid(), owner_id, conversa_id, agente_id, 'retomada', 'concluido', prazo_em, profundidade, 'x', entrada_confianca, ${raiz.id}, executor, modelo from turnos where id = ${raiz.id}`;
      }
      await m.repos.quadroExecucoes.gravarSaida((await m.execs())[0]!.id, "volta", Date.now());
      await m.assentar(re.id, []);
      await m.varrer();
      const t = await m.tarefa();
      expect(t.status).toBe("voce");
      expect(t.pergunta).toContain("Freio");
      expect((await m.turnosDoBeto()).filter((x) => x.origem === "retomada" && x.estado === "pendente")).toHaveLength(0);
      // Revisão: o freio zera a conta, como o freio do lote (sem isso, depois que a pessoa devolve a tarefa, a próxima parada
      // sem saída na hora caía direto no freio e o comentário ficava sem vaga).
      expect((await m.repos.quadros.acionamentosNaHora(t0.quadroId)).get(t0.id) ?? 0).toBe(0);
      await m.lote([{ tipo: "mudar_tarefa", tarefa: "T", status: "fazendo" }]);
      expect((await m.tarefa()).status).toBe("fazendo");
    });
  });

  // Regression: QA do PR #705 — o teto de 12/h tem borda: 11 na hora ainda reaciona, 12 já freia (como o freio do lote).
  // Found by /qa on 2026-11-08 (mutante `>=` → `>` sobrevivia: o teste de cima passava com 13+).
  it("QA: a borda do teto — com 11 acionamentos na hora o reacionamento sai; com 12, Precisa de você pelo freio", async () => {
    for (const [na, freia] of [[LIMITE_ACIONAMENTOS_HORA - 1, false], [LIMITE_ACIONAMENTOS_HORA, true]] as const) {
      await withRollback(MARLON, async (trx) => {
        const m = await montar(trx);
        const raiz = await m.pegar();
        await m.assentar(raiz.id, []);
        const t0 = await m.tarefa();
        const ja = (await m.repos.quadros.acionamentosNaHora(t0.quadroId)).get(t0.id) ?? 0;
        const movs = Array.from({ length: na - ja }, () => ({ tarefaId: t0.id, tipo: "acionou" as const, de: t0.status, para: t0.status, agenteAntes: t0.agenteId, agenteDepois: t0.agenteId, autor: { tipo: "pessoa" as const }, motivo: null, acionou: true }));
        await m.repos.quadros.inserirMovimentos(t0.quadroId, null, movs);
        expect((await m.repos.quadros.acionamentosNaHora(t0.quadroId)).get(t0.id)).toBe(na);
        await m.varrer();
        const t = await m.tarefa();
        const reacionou = (await m.turnosDoBeto()).some((x) => x.origem === "retomada" && x.entradaTexto.startsWith(AVISO_SEM_SAIDA));
        expect({ na, reacionou, voce: t.status === "voce", freio: (t.pergunta ?? "").includes("Freio") }).toEqual({ na, reacionou: !freia, voce: freia, freio: freia });
      });
    }
  });

  // Regression: QA do PR #705 — o zelador não cobra a tarefa com volta marcada (critério 4). Só a função pura era testada:
  // tirar o `ocupadas` da chamada no use case não quebrava nada. Found by /qa on 2026-11-08.
  it("QA: o zelador de prazo não cobra a tarefa com volta marcada; sem a volta, cobra", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.lote([{ tipo: "renomear_coluna", coluna: "fazendo", prazo_min: 30 }]);
      await m.lote([{ tipo: "mudar_tarefa", tarefa: "T", status: "fazendo" }], { ...m.p, autor: { tipo: "agente", agenteId: m.beto.agenteId } });
      const raiz = await m.pegar();
      await meChameAs(m.deps, { turnoId: raiz.id, agenteId: m.beto.agenteId, conversaId: m.beto.conversaId, em_minutos: 600, motivo: "o deploy" } as Parameters<typeof meChameAs>[1]);
      await m.assentar(raiz.id, ["mcp__nod__me_chame_as"]);
      const volta = (await m.turnosDoBeto()).find((t) => t.origem === "retomada" && t.estado === "pendente")!;
      expect(volta).toBeDefined();
      const antes = (await m.tarefa()).turnoId;
      const nTurnos = (await m.turnosDoBeto()).length;
      const depois = { ...m.deps, agora: () => Date.now() + 61 * 60_000 };
      await varrerAvisosDosQuadros(depois);
      expect((await m.tarefa()).turnoId).toBe(antes);
      expect((await m.turnosDoBeto()).length).toBe(nTurnos);
      // Controle: sem a volta (a pessoa a parou), a mesma tarefa parada além do prazo é cobrada.
      await trx`update turnos set estado = 'interrompido', motivo_interrupcao = 'parado_pela_pessoa' where id = ${volta.id}`;
      await varrerAvisosDosQuadros(depois);
      expect((await m.tarefa()).turnoId).not.toBe(antes);
    });
  });

  it("a volta marcada aparece na situação da tarefa (o zelador a deixa fora da cobrança), com o motivo e o turno a acordar", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const raiz = await m.pegar();
      await meChameAs(m.deps, { turnoId: raiz.id, agenteId: m.beto.agenteId, conversaId: m.beto.conversaId, em_minutos: 600, motivo: "o deploy" } as Parameters<typeof meChameAs>[1]);
      await m.assentar(raiz.id, ["mcp__nod__me_chame_as"]);
      const t = await m.tarefa();
      const { situacaoDasTarefas } = await import("../../src/use-cases/situacao-trabalho.ts");
      const s = (await situacaoDasTarefas(m.deps, [t.id])).get(t.id)!;
      expect(s.volta).toMatchObject({ motivo: "o deploy", quando: null });
      expect(s.volta!.turnoId).toBeTruthy();
    });
  });
});

describeIntegracao("ADA-232: Acordar agora (quadro.acordar_trabalho)", () => {
  it("a volta marcada dispara já, na mesma cadeia; sem volta, é recusado e nada muda", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const raiz = await m.pegar();
      // Sem volta marcada (o turno está rodando): nada a acordar.
      const sem = await trabalhoDaTarefa(m.deps, m.p, { tipo: "acordar_trabalho", tarefa: "T" });
      expect(sem.data).toMatchObject({ ok: false, erro: "estado_invalido" });
      const r = await meChameAs(m.deps, { turnoId: raiz.id, agenteId: m.beto.agenteId, conversaId: m.beto.conversaId, em_minutos: 600, motivo: "o deploy" } as Parameters<typeof meChameAs>[1]);
      expect((r.data as { ok: boolean }).ok).toBe(true);
      await m.assentar(raiz.id, ["mcp__nod__me_chame_as"]);
      const volta = (await m.turnosDoBeto()).find((t) => t.origem === "retomada" && t.retomaTurnoId === raiz.id)!;
      expect(volta.acordarEm).toBeGreaterThan(Date.now() + 9 * 3_600_000);
      const ok = await trabalhoDaTarefa(m.deps, m.p, { tipo: "acordar_trabalho", tarefa: "T" });
      expect(ok.data, JSON.stringify(ok.data)).toMatchObject({ ok: true, trabalho: { numero: 1 } });
      expect((await m.repos.turnos.buscar(volta.id))!.acordarEm).toBeLessThanOrEqual(Date.now() + 1_000);
      // A máquina pega a mesma retomada (a mesma sessão), não um turno novo.
      expect((await m.pegar()).id).toBe(volta.id);
      // Já acordada e rodando: não há volta dormindo para acordar de novo.
      expect((await trabalhoDaTarefa(m.deps, m.p, { tipo: "acordar_trabalho", tarefa: "T" })).data).toMatchObject({ ok: false, erro: "estado_invalido" });
    });
  });
});


describeIntegracao("ADA-232: o card numa linha (estadoLinha) e a volta no detalhe", () => {
  it("volta marcada → esperando com o motivo no card e no detalhe; Precisa de você e Bloqueado vencem", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const quadro = async () => (await montarQuadro(m.deps, (await m.repos.quadros.doAgente(m.ana.agenteId))!)).tarefas.find((t) => t.titulo === "T")!;
      const raiz = await m.pegar();
      expect((await quadro()).estadoLinha).toMatchObject({ tipo: "trabalhando", frente: false });
      await meChameAs(m.deps, { turnoId: raiz.id, agenteId: m.beto.agenteId, conversaId: m.beto.conversaId, em_minutos: 600, motivo: "o deploy" } as Parameters<typeof meChameAs>[1]);
      await m.assentar(raiz.id, ["mcp__nod__me_chame_as"]);
      expect((await quadro()).estadoLinha).toMatchObject({ tipo: "esperando", motivo: "o deploy" });
      const { trabalhosDaTarefa } = await import("../../src/use-cases/quadro-execucoes.ts");
      const det = await trabalhosDaTarefa(m.deps, await m.tarefa());
      expect(JSON.stringify(det)).toContain('"motivo":"o deploy"');
      await m.lote([{ tipo: "mudar_tarefa", tarefa: "T", status: "bloqueado", motivo: "sem acesso" }]);
      expect((await quadro()).estadoLinha).toEqual({ tipo: "bloqueado" });
    });
  });

  it("frente aberta por um turno do trabalho da tarefa grava tarefa_id e o card conta como trabalhando", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.repos.agentes.atualizarPerfil(m.beto.agenteId, { confirmado: true });
      const raiz = await m.pegar();
      const { abrirFrentes } = await import("../../src/use-cases/frentes.ts");
      const r = await abrirFrentes(m.deps, { turnoId: raiz.id, agenteId: m.beto.agenteId, conversaId: m.beto.conversaId, frentes: [{ titulo: "CI", pedido: "veja a CI" }] });
      expect(r.data, JSON.stringify(r.data)).toMatchObject({ ok: true });
      const t = await m.tarefa();
      expect(await m.repos.trabalhos.tarefasComFrenteAberta([t.id])).toEqual(new Set([t.id]));
      // QA: depois que o turno que abriu a frente termina, o card (montarQuadro) segue "trabalhando" pela frente.
      await m.assentar(raiz.id, ["mcp__nod__abrir_frentes"]);
      const card = (await montarQuadro(m.deps, (await m.repos.quadros.doAgente(m.ana.agenteId))!)).tarefas.find((x) => x.titulo === "T")!;
      expect(card.estadoLinha).toMatchObject({ tipo: "trabalhando", frente: true });
    });
  });

  it("revisão: trabalhos.tarefa_id tem índice (o card lê por ele; apagar a tarefa varre por ele no ON DELETE SET NULL)", async () => {
    await withRollback(MARLON, async (trx) => {
      const ls = await trx<{ indexdef: string }[]>`select indexdef from pg_indexes where schemaname = current_schema() and tablename = 'trabalhos'`;
      expect(ls.some((l) => /\(tenant_id, tarefa_id\)/.test(l.indexdef))).toBe(true);
    });
  });
});

/** 2026-11-10 (os wakeups do Multica): merge, conflito e outra tarefa do quadro, pelo mesmo varredor da volta por CI. */
describeIntegracao("volta por evento: merge, conflito e outra tarefa", () => {
  async function comVolta(trx: Tx, args: Record<string, unknown>, comPr = true) {
    const m = await montar(trx);
    const raiz = await m.pegar();
    if (comPr) await m.lote([{ tipo: "mudar_tarefa", tarefa: "T", pr_url: PR }]);
    const r = await meChameAs(m.deps, { turnoId: raiz.id, agenteId: m.beto.agenteId, conversaId: m.beto.conversaId, motivo: "esperar", ...args } as Parameters<typeof meChameAs>[1]);
    const gravarPr = async (estado: PrDaTarefa["estado"], conflito = false) => {
      const t = await m.tarefa();
      await m.repos.quadros.salvarPr(t.quadroId, t.id, { repo: "gamefik/nod", numero: 677, url: PR, branch: "b", estado, ci: "ok", conflito });
    };
    return { m, raiz, r: r.data as { ok: boolean; erro?: string; instrucao: string }, gravarPr };
  }

  it("merge: PR aberto (mesmo com CI ok) dorme; mergeado acorda, e a volta diz o que esperava", async () => {
    await withRollback(MARLON, async (trx) => {
      const { m, raiz, r, gravarPr } = await comVolta(trx, { quando: "merge" });
      expect(r.ok).toBe(true);
      expect(r.instrucao).toContain("mergeado");
      await m.assentar(raiz.id, ["mcp__nod__me_chame_as"]);
      const volta = (await m.turnosDoBeto()).find((t) => t.origem === "retomada" && t.estado === "pendente")!;
      expect(volta.entradaTexto).toContain(`${PR} fosse mergeado`);
      await gravarPr("aberto");
      expect(await acordarVoltasDeCi(m.deps)).toBe(0);
      await gravarPr("mergeado");
      expect(await acordarVoltasDeCi(m.deps)).toBe(1);
    });
  });

  it("conflito: sem conflito dorme; com conflito acorda; o card leva a espera por conflito", async () => {
    await withRollback(MARLON, async (trx) => {
      const { m, raiz, r, gravarPr } = await comVolta(trx, { quando: "conflito" });
      expect(r.ok).toBe(true);
      await m.assentar(raiz.id, ["mcp__nod__me_chame_as"]);
      const q = await montarQuadro(m.deps, (await m.repos.quadros.doAgente(m.ana.agenteId))!);
      const linha = q!.tarefas.find((t) => t.titulo === "T")!.estadoLinha;
      expect(linha).toMatchObject({ tipo: "esperando", volta: { quando: "conflito" } });
      await gravarPr("aberto", false);
      expect(await acordarVoltasDeCi(m.deps)).toBe(0);
      await gravarPr("aberto", true);
      expect(await acordarVoltasDeCi(m.deps)).toBe(1);
    });
  });

  it("merge e conflito sem PR na tarefa são recusados com instrução", async () => {
    await withRollback(MARLON, async (trx) => {
      const { r } = await comVolta(trx, { quando: "merge" }, false);
      expect(r).toMatchObject({ ok: false, erro: "sem_pr" });
    });
  });

  it("tarefa: espera outra tarefa do quadro pelo código; acorda quando ela chega no estado, e o card mostra o código", async () => {
    await withRollback(MARLON, async (trx) => {
      const m0 = await montar(trx);
      await m0.lote([{ tipo: "criar_tarefa", titulo: "Outra" }]);
      const q0 = (await m0.repos.quadros.doAgente(m0.ana.agenteId))!;
      const outra = (await m0.repos.quadros.tarefas(q0.id)).find((t) => t.titulo === "Outra")!;
      const qDto = await montarQuadro(m0.deps, q0);
      const codigo = qDto!.tarefas.find((t) => t.id === outra.id)!.codigo;
      const raiz = await m0.pegar();
      const r = await meChameAs(m0.deps, { turnoId: raiz.id, agenteId: m0.beto.agenteId, conversaId: m0.beto.conversaId, motivo: "esperar a Outra", quando: "tarefa", tarefa: codigo, estado: "revisao" } as Parameters<typeof meChameAs>[1]);
      expect((r.data as { ok: boolean }).ok).toBe(true);
      await m0.assentar(raiz.id, ["mcp__nod__me_chame_as"]);
      const linha = (await montarQuadro(m0.deps, q0))!.tarefas.find((t) => t.titulo === "T")!.estadoLinha;
      expect(linha).toMatchObject({ tipo: "esperando", volta: { quando: "tarefa", tarefa: codigo } });
      // Em Fazendo ainda não; em Em revisão acorda.
      await m0.lote([{ tipo: "mudar_tarefa", tarefa: "Outra", status: "fazendo", sem_iniciar: true }]);
      expect(await acordarVoltasDeCi(m0.deps)).toBe(0);
      await m0.lote([{ tipo: "mudar_tarefa", tarefa: "Outra", status: "revisao", sem_iniciar: true }]);
      expect(await acordarVoltasDeCi(m0.deps)).toBe(1);
    });
  });

  it("tarefa: sem código, código de fora do quadro ou a própria tarefa são recusados (sem_tarefa)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const raiz = await m.pegar();
      const pedir = (extra: Record<string, unknown>) => meChameAs(m.deps, { turnoId: raiz.id, agenteId: m.beto.agenteId, conversaId: m.beto.conversaId, motivo: "x", quando: "tarefa", ...extra } as Parameters<typeof meChameAs>[1]);
      expect((await pedir({})).data).toMatchObject({ ok: false, erro: "sem_tarefa" });
      expect((await pedir({ tarefa: "ZZZ-999" })).data).toMatchObject({ ok: false, erro: "sem_tarefa" });
      expect((await pedir({ tarefa: (await m.tarefa()).id })).data).toMatchObject({ ok: false, erro: "sem_tarefa" });
    });
  });
});
