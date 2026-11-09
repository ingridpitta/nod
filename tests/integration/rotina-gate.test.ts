import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { varrerPessoa } from "../../src/adapters/fundo/varredor-expiracao.ts";
import { montarPlano } from "../../src/domain/plano-turno.ts";
import type { Transacao } from "../../src/shared/types.ts";
import { rotinaDoTurno } from "../../src/use-cases/apoio-l7.ts";
import { dispararRotina, registrarDesfechoRotina } from "../../src/use-cases/disparar-rotina.ts";
import { pedirAPessoa } from "../../src/use-cases/pedir-a-pessoa.ts";
import { fecharComResposta, retomarComResposta } from "../../src/use-cases/responder-decisao.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const TZ = "America/Sao_Paulo";
const JANELA = Date.parse("2026-09-17T08:00:00-03:00");
const AGORA = JANELA + 30_000;

/**
 * revisto em 2026-10-01 (ADR-066, "o bot tem o que você deu; o modo decide"): a política do plano não carrega mais o
 * gate da rotina (EMENDA 15, `efeitoExternoSoPorAprovacao`). O que segue de pé aqui é o gate como DECISÃO: a aprovação
 * pedida pelo turno da rotina segura a janela e, vencida, vira passou_em_branco.
 */
describeIntegracao("gate de rotina (E7.3, E7.5): passou_em_branco ≠ falhou, zero efeito externo; sem gate na política do plano (ADR-066)", () => {
  it("gate vencido sem resposta → execução 'passou_em_branco' motivo ninguem_respondeu_o_gate, mensagem 'nada foi enviado', zero chamadas no conector falso; erro técnico → 'falhou'", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      const { deps, repos, chamadas } = depsSobre(trx, MARLON, { agora: () => AGORA });
      const rotina = await repos.rotinas.criar({ agenteId, conversaId, cron: "0 8 * * 1-5", fusoIana: TZ, instrucao: "i", fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p", proximaExecucao: JANELA });
      const r = await dispararRotina(deps, { rotina: rotina!, instanteAgendado: JANELA, machineId: randomUUID(), executor: "catcher" });
      if (!("turno" in r.data)) throw new Error("deveria disparar");
      const turnoId = r.data.turno.id;
      // A rotina rodou, chamou pedir_aprovacao e encerrou: o gate (tipo gate_rotina, ligado ao turno) ficou em Sua vez.
      const tx: Transacao = (fn) => fn(trx);
      const gate = await repos.decisoes.criar({ tipo: "gate_rotina", agenteId, conversaId, turnoId, prazoDecisaoEm: AGORA - 60_000, frase: "1 e-mail para enviar" });
      expect((await registrarDesfechoRotina(deps, { turnoId, desfecho: "executou" })).data).toEqual({ ignorado: "aguardando_gate" });

      const varrido = await varrerPessoa(MARLON, tx, { services: deps.services, useCases: deps.useCases, agora: () => AGORA });
      expect(varrido.vencidas).toEqual([gate?.id]);
      expect(varrido.passaramEmBranco).toEqual([rotina?.id]);
      const execucoes = await repos.rotinaExecucoes.listar(rotina?.id ?? "");
      expect(execucoes.map((e) => [e.desfecho, e.motivo, e.turnoId])).toEqual([["passou_em_branco", "ninguem_respondeu_o_gate", turnoId]]);
      const mensagens = await repos.mensagens.listarDaConversa(conversaId);
      const branco = mensagens.find((m) => m.kind === "rotina_execucao");
      expect(branco?.texto).toContain("A rotina passou em branco: ninguém respondeu o gate. Nada foi enviado.");
      expect(branco?.payload).toEqual({ kind: "rotina_execucao", rotinaId: rotina?.id, instanteAgendado: JANELA, desfecho: "passou_em_branco" });
      expect(mensagens.find((m) => m.kind === "sistema")?.texto).toContain("Este pedido venceu em");
      expect((await repos.decisoes.buscar(gate?.id ?? ""))?.estado).toBe("vencida");
      // Nenhum efeito externo: o conector falso não foi chamado.
      expect(chamadas.conectores).toEqual([]);
      // medido em 2026-09-16: dois eventos da MESMA transação compartilham created_at (now() é transacional),
      // então nenhuma ordem é garantida entre eles — compara-se como CONJUNTO. Falhou 2x em 3 execuções dos 4 projetos juntos.
      const kinds = await trx<{ kind: string }[]>`select kind from events where turno_id = ${turnoId}`;
      expect(kinds.map((k) => k.kind).sort()).toEqual(["decisao_vencida", "rotina_executou"]);

      // Erro técnico numa outra janela é 'falhou', distinto de 'passou_em_branco'. (O turno da janela
      // anterior terminou; aberto, a janela nova seria pulada — ADR-045.)
      await repos.turnos.assentar(turnoId, { estado: "concluido" });
      const r2 = await dispararRotina(deps, { rotina: (await repos.rotinas.buscar(rotina?.id ?? ""))!, instanteAgendado: JANELA + 86_400_000, machineId: randomUUID(), executor: "catcher" });
      if (!("turno" in r2.data)) throw new Error("deveria disparar");
      const falhou = await registrarDesfechoRotina(deps, { turnoId: r2.data.turno.id, desfecho: "falhou", motivo: "erro_max_turns" });
      expect("execucao" in falhou.data && falhou.data.execucao.desfecho).toBe("falhou");
      // As duas execuções têm o mesmo `em` (relógio injetado): a ordem entre elas é por id, então compara-se como conjunto.
      expect((await repos.rotinaExecucoes.listar(rotina?.id ?? "")).map((e) => e.desfecho).sort()).toEqual(["falhou", "passou_em_branco"]);
    });
  });

  it("o caminho real: pedir_aprovacao cria tipo 'aprovacao' ligada ao turno da rotina → conta como gate (aguardando_gate) e, vencida, vira passou_em_branco; aprovacao de turno comum não toca rotina", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      const { deps, repos, chamadas } = depsSobre(trx, MARLON, { agora: () => AGORA });
      const rotina = await repos.rotinas.criar({ agenteId, conversaId, cron: "0 8 * * 1-5", fusoIana: TZ, instrucao: "i", fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p", proximaExecucao: JANELA });
      const r = await dispararRotina(deps, { rotina: rotina!, instanteAgendado: JANELA, machineId: randomUUID(), executor: "catcher" });
      if (!("turno" in r.data)) throw new Error("deveria disparar");
      const turnoId = r.data.turno.id;
      const gate = await repos.decisoes.criar({ tipo: "aprovacao", agenteId, conversaId, turnoId, prazoDecisaoEm: AGORA - 60_000, frase: "1 e-mail para enviar" });
      // Uma aprovação de um turno comum, vencida no mesmo tick, não é gate de rotina.
      const comum = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: AGORA + 1, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m" });
      const outra = await repos.decisoes.criar({ tipo: "aprovacao", agenteId, conversaId, turnoId: comum?.id ?? null, prazoDecisaoEm: AGORA - 60_000, frase: "2 e-mails" });
      expect((await registrarDesfechoRotina(deps, { turnoId, desfecho: "executou" })).data).toEqual({ ignorado: "aguardando_gate" });

      const tx: Transacao = (fn) => fn(trx);
      const varrido = await varrerPessoa(MARLON, tx, { services: deps.services, useCases: deps.useCases, agora: () => AGORA });
      expect(varrido.vencidas.sort()).toEqual([gate?.id, outra?.id].sort());
      expect(varrido.passaramEmBranco).toEqual([rotina?.id]);
      expect((await repos.rotinaExecucoes.listar(rotina?.id ?? "")).map((e) => [e.desfecho, e.motivo, e.turnoId])).toEqual([["passou_em_branco", "ninguem_respondeu_o_gate", turnoId]]);
      expect(chamadas.conectores).toEqual([]);
      // Depois de vencido o gate, um 'executou' tardio não conta mais como aguardando (o gate já não está pendente).
      expect((await repos.decisoes.buscar(gate?.id ?? ""))?.estado).toBe("vencida");
    });
  });

  it("ADR-066: o plano de um turno de rotina com exige_aprovacao não liga gate nenhum — entrada confiável, política só com prazo e orçamento, ver_colegas no catálogo; rotinaDoTurno acha a rotina pela janela", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => AGORA });
      const rotina = await repos.rotinas.criar({ agenteId, conversaId, cron: "0 8 * * 1-5", fusoIana: TZ, instrucao: "i", fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p", proximaExecucao: JANELA });
      const r = await dispararRotina(deps, { rotina: rotina!, instanteAgendado: JANELA, machineId: randomUUID(), executor: "catcher" });
      if (!("turno" in r.data)) throw new Error("deveria disparar");
      const ligacao = await rotinaDoTurno(repos, r.data.turno.id);
      expect(ligacao?.rotina.id).toBe(rotina?.id);
      expect(ligacao?.instanteAgendado).toBe(JANELA);
      // A rotina continua dizendo que exige aprovação (é o texto que a pessoa confirmou); o plano não traduz isso em gate.
      expect(ligacao?.rotina.exigeAprovacao).toBe(true);
      expect(r.data.turno.entradaConfianca).toBe("confiavel");
      const agente = await repos.agentes.buscar(agenteId);
      const plano = montarPlano({
        turno: r.data.turno,
        agente: agente!,
        memorias: [],
        concessoes: [],
        conectores: [],
        modo: "rotina",
        confianca: r.data.turno.entradaConfianca,
        profundidade: 0,
        inventario: { estado: "pronto", versao: "x", em: AGORA },
        executor: "catcher",
        sessaoCli: null,
        pessoaNome: "Marlon",
        agora: AGORA,
      });
      // Quem decide quando o bot para e pergunta é o modo de aprovação, igual em toda origem: a política só tem prazo e orçamento.
      expect(plano.politicaExecucao).toEqual({ prazoMs: expect.any(Number), orcamentoResultadoChars: expect.any(Number) });
      expect(plano.confiancaEntrada).toBe("confiavel");
      expect(plano.modoTurno).toBe("rotina");
      // ADR-044: pedir_acesso entra na rotina (o modo concede; no manual, a pessoa decide num botão). ADR-051: o artefato
      // também. ADR-064: as pendências não, desde 2026-10-06 ("A fazer" desligado). ADR-066: ver_colegas também (leitura que não incomoda ninguém).
      // NOD-114: a rotina também pode avisar a pessoa por conta própria.
      expect(plano.catalogo.ferramentas.map((f) => f.nome).sort()).toEqual(["abrir_frentes", "avisar_pessoa", "buscar_conversas", "lembrar", "ler_artefato", "ler_conversa", "ler_mais", "mandar_para_frente", "me_chame_as", "pedir_a_bot", "pedir_a_pessoa", "pedir_acesso", "pedir_aprovacao", "publicar_artefato", "sem_novidade", "ver_colegas"]);
      // turno de conversa comum não liga a flag
      const comum = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: AGORA + 1, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m" });
      expect(await rotinaDoTurno(repos, comum?.id ?? "")).toBeNull();
    });
  });

  it("ADR-045: responder a um pedido da rotina deixa UMA linha para a janela — o desfecho da retomada substitui o do turno que perguntou", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Nina" });
      let relogio = AGORA;
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => relogio });
      const rotina = await repos.rotinas.criar({ agenteId, conversaId, cron: "0 8 * * 1-5", fusoIana: TZ, instrucao: "e-mails", fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p", proximaExecucao: JANELA });
      const r = await dispararRotina(deps, { rotina: rotina!, instanteAgendado: JANELA, machineId: randomUUID(), executor: "catcher" });
      if (!("turno" in r.data)) throw new Error("deveria disparar");
      const turnoId = r.data.turno.id;
      // A rotina esbarra num dado que falta, pergunta e encerra. definido em 2026-09-24 (fio da pergunta):
      // o 'executou' do turno que perguntou não conta — a janela espera o fio.
      const pergunta = await pedirAPessoa(deps, { turnoId, conversaId, agenteId, tipo: "falta_de_dado", texto: "falta a planilha", dado: "planilha" });
      expect((await registrarDesfechoRotina(deps, { turnoId, desfecho: "executou" })).data).toEqual({ ignorado: "aguardando_gate" });
      // A pessoa responde; a retomada roda e termina com outro desfecho, na MESMA janela.
      relogio += 3_600_000;
      const { data: fechada } = await fecharComResposta(deps, { decisaoId: pergunta.data.decisao_id, texto: "está no drive" });
      const { data: resposta } = await retomarComResposta(deps, { decisao: fechada.decisao, texto: "está no drive", respondidaPor: { id: PESSOA_MARLON, nome: "Marlon" } });
      const final = await registrarDesfechoRotina(deps, { turnoId: resposta.turno?.id ?? "", desfecho: "falhou", motivo: "erro_execucao" });
      if (!("execucao" in final.data)) throw new Error("deveria registrar");
      const execucoes = await repos.rotinaExecucoes.listar(rotina?.id ?? "");
      expect(execucoes.map((e) => [e.desfecho, e.turnoId, e.instanteAgendado, e.em])).toEqual([["falhou", turnoId, JANELA, relogio]]);
    });
  });
});
