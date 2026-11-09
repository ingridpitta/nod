import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { CapacidadeConector } from "../../src/contracts/conector.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { entradaDaVoltaDaCota } from "../../src/domain/cota-da-ia.ts";
import { NATIVAS_DO_TERMINAL } from "../../src/domain/nativas.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Repos } from "../../src/repositories/tipos.ts";
import { chamarFerramenta } from "../../src/use-cases/chamar-ferramenta.ts";
import { decidirAcesso } from "../../src/use-cases/decidir-acesso.ts";
import { dispararRotina, LIMIAR_PEDIDOS_ABERTOS_MS, nivelDoTempoDosPedidos } from "../../src/use-cases/disparar-rotina.ts";
import { definirDestinoDoLog } from "../../src/obs/log.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { enviarMensagem } from "../../src/use-cases/enviar-mensagem.ts";
import { entregarRespostaPeer } from "../../src/use-cases/entregar-resposta-peer.ts";
import { listarSuaVez } from "../../src/use-cases/listar-sua-vez.ts";
import { pedirAcesso } from "../../src/use-cases/pedir-acesso.ts";
import { JANELA_PEDIDOS_ABERTOS_MS, pedirABot } from "../../src/use-cases/pedir-a-bot.ts";
import { permitirSempre } from "../../src/use-cases/permitir-sempre.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { expectRejected } from "../helpers/expect-rejected.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";
import type { Tx } from "../../src/shared/types.ts";
import { tarefaDoPedido } from "../helpers/pedido.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const ANA = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_ANA };
const AGORA = Date.parse("2026-09-29T20:30:00Z");
const PEDIDO = "Taga, pede ao Dev 1 para me ajudar a revisar o PR #466";
const PRONTO = { estado: "pronto" as const, versao: "t", em: 0 };
const cap = (nome: string, readOnlyHint: boolean): CapacidadeConector => ({ nome, descricao: nome, schema: { type: "object" }, readOnlyHint });

/** Taga (quem pede) e Dev 1 (quem recebe), da mesma dona, e a mensagem de Marlon que abriu o turno do Taga. */
async function cenario(trx: Tx) {
  const taga = await agenteComConversa(trx, MARLON, { nome: "Taga" });
  const dev1 = await agenteComConversa(trx, MARLON, { nome: "Dev 1" });
  const { deps, repos, chamadas } = depsSobre(trx, MARLON, { agora: () => AGORA });
  for (const a of [taga, dev1]) await repos.agentes.atualizarPerfil(a.agenteId, { confirmado: true });
  const { data } = await enviarMensagem(deps, { conversaId: taga.conversaId, texto: PEDIDO, inventario: PRONTO });
  return { taga, dev1, deps, repos, chamadas, turnoTaga: data.turno };
}

function pedir(deps: Deps, p: { turnoId: string; agenteId: string; conversaId: string }, agente = "Dev 1", pedido = "revisar o PR 466") {
  return pedirABot(deps, { ...p, agente, pedido, contexto: "https://github.com/acme/app/pull/466" });
}

/** GitHub com leitura e escrita, concedido ao Dev 1 inteiro. */
async function githubDoDev1(repos: Repos, dev1: { agenteId: string; conversaId: string }) {
  const criado = await repos.conectores.criar({ nome: "GitHub", slug: "github", transporte: "stdio", comando: "node", declaracao: "nao-toca" });
  const sondado = await repos.conectores.registrarSonda(criado?.id ?? "", { ok: true, catalogo: [cap("pr_ver", true), cap("pr_comentar", false), cap("pr_revisar", false)], agora: AGORA });
  if (!sondado) throw new Error("conector");
  const m = await repos.mensagens.criar({ conversaId: dev1.conversaId, autoria: { autor_tipo: "pessoa", autor_id: PESSOA_MARLON, sob_procuracao_de: null, conta_de_execucao: PESSOA_MARLON, executor: "catcher", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "regra:localidade", regra_versao: 1 }, kind: "sistema", assunto: "acesso.concedido", texto: "acesso", confianca: "confiavel" });
  for (const capacidade of ["pr_ver", "pr_comentar"]) await repos.concessoes.conceder({ agenteId: dev1.agenteId, conectorId: sondado.id, capacidade, mensagemId: m?.id ?? "" });
  return sondado;
}

/**
 * Um turno de rotina de verdade: rotina, janela reivindicada e turno ligado a ela. A entrada da rotina é sempre
 * confiável (ADR-066, disparar-rotina.ts); `leuDeFora` = o turno já leu um app de fora (chamar-ferramenta.ts o marca).
 */
async function turnoDeRotina(repos: Repos, de: { agenteId: string; conversaId: string }, exigeAprovacao: boolean, o: { leuDeFora?: boolean } = {}) {
  const rotina = await repos.rotinas.criar({ agenteId: de.agenteId, conversaId: de.conversaId, cron: "*/10 * * * *", fusoIana: "UTC", instrucao: "Ler o Slack", fonte: "Slack", entregavel: "chat", limitesAprovacao: "", politicaSemDado: "", proximaExecucao: AGORA, exigeAprovacao });
  const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId: de.conversaId, agenteId: de.agenteId, origem: "rotina", prazoEm: AGORA + 60_000, profundidade: 0, entradaTexto: "Execução agendada", entradaConfianca: "confiavel", modelo: "m" });
  await repos.rotinaJanelas.reivindicar({ rotinaId: rotina!.id, instanteAgendado: AGORA, machineId: randomUUID(), executor: "catcher" });
  await repos.rotinaJanelas.vincularTurno({ rotinaId: rotina!.id, instanteAgendado: AGORA, turnoId: turno!.id });
  if (o.leuDeFora) await repos.turnos.contaminar(turno!.id, AGORA);
  return turno!;
}

/** A política de execução sem gate nem trava (ADR-066): só prazo e orçamento. */
const SEM_GATE = ["orcamentoResultadoChars", "prazoMs"];
const chavesDaPolitica = (p: { politicaExecucao: object }) => Object.keys(p.politicaExecucao).sort();

async function planoDe(deps: Deps, turnoId: string) {
  return emitirPlanoTurno(deps, { turnoId, machineId: randomUUID(), executor: "catcher" });
}

describeIntegracao("pedir_a_bot (ADR-058): quem recebe usa os acessos dele", () => {
  it("de uma conversa: turno 'delegacao' confiável sob procuração de Marlon; a mensagem dele vai junto; o plano tem o catálogo inteiro (ADR-066: ver_colegas, artefato e, no Claude Code, o kit do terminal) e nenhuma trava", async () => {
    await withRollback(MARLON, async (trx) => {
      const { taga, dev1, deps, repos, chamadas, turnoTaga } = await cenario(trx);
      await githubDoDev1(repos, dev1);
      const r = await pedir(deps, { turnoId: turnoTaga.id, agenteId: taga.agenteId, conversaId: taga.conversaId });
      const tarefa = await repos.turnos.buscar(tarefaDoPedido(r.data));
      expect(tarefa).toMatchObject({ agenteId: dev1.agenteId, conversaId: dev1.conversaId, origem: "delegacao", profundidade: 1, entradaConfianca: "confiavel", sobProcuracaoDe: PESSOA_MARLON, estado: "pendente" });
      expect(tarefa?.entradaTexto).toContain("Pedido de Taga:\n<pedido_do_colega>\nPedido: revisar o PR 466\nContexto: https://github.com/acme/app/pull/466\n</pedido_do_colega>");
      expect(tarefa?.entradaTexto).toContain(`<pedido_da_pessoa>\n${PEDIDO}\n</pedido_da_pessoa>`);

      const [pedido] = (await repos.mensagens.listarDaConversa(dev1.conversaId)).filter((m) => m.payload?.kind === "peer_pedido");
      expect(pedido).toMatchObject({ turnoId: tarefa?.id, kind: "texto", texto: "revisar o PR 466\n\nhttps://github.com/acme/app/pull/466", payload: { kind: "peer_pedido", conversaOrigemId: taga.conversaId, turnoOrigemId: turnoTaga.id, nome: "Taga" } });
      expect(pedido?.autoria).toMatchObject({ autor_tipo: "agente", autor_id: taga.agenteId, sob_procuracao_de: PESSOA_MARLON, conta_de_execucao: PESSOA_MARLON });
      // Chat limpo (PR 3): o handoff guarda o nome de quem recebe, como o peer_pedido guarda o de quem pediu.
      const [handoff] = (await repos.mensagens.listarDaConversa(taga.conversaId)).filter((m) => m.payload?.kind === "handoff");
      expect(handoff?.payload).toMatchObject({ kind: "handoff", para: dev1.agenteId, tarefaId: tarefa?.id, nomePara: "Dev 1" });
      // ADR-099 (I7 revista): o handoff e o turno de triagem; não nasce task em quem recebe (era + o trabalho_mudou, ADR-083).
      expect((await repos.events.gravarComOutbox(r.events ?? [])).ids).toHaveLength(2);

      const plano = await planoDe(deps, tarefa?.id ?? "");
      expect(plano.events?.[0]?.dados.modo).toBe("delegacao");
      expect(plano.data.autoria.sob_procuracao_de).toBe(PESSOA_MARLON);
      expect(plano.data.catalogo.ferramentas.map((f) => f.nome)).toEqual(expect.arrayContaining(["github__pr_ver", "github__pr_comentar", "pedir_acesso", "pedir_aprovacao", "ver_colegas", "publicar_artefato", "ler_artefato"]));
      expect(chavesDaPolitica(plano.data)).toEqual(SEM_GATE);
      expect(plano.data.promptSistema).toContain("Modo de pedido de colega: Taga, outro bot de");
      expect(plano.data.entrada.sessaoCli).toBeNull();
      // Quem pediu não tinha lido nada de fora: o turno de quem recebe nasce sem marca.
      expect(await repos.turnos.contaminado(tarefa?.id ?? "")).toBe(false);
      // Sem trava, a escrita concedida segue o MODO de quem recebe (ADR-062): no manual, pede card; no automático, roda direto.
      const comentar = () => chamarFerramenta(deps, { turnoId: tarefa?.id ?? "", agenteId: dev1.agenteId, nome: "github__pr_comentar", argumentos: {}, plano: plano.data });
      expect((await comentar()).data).toMatchObject({ ok: false, negacao: { motivo: "alcance_insuficiente" } });
      await repos.agentes.definirModoAprovacao(dev1.agenteId, "automatico");
      expect((await comentar()).data).toMatchObject({ ok: true });
      expect(chamadas.conectores.map((c) => c.tool)).toEqual(["pr_comentar"]);

      // ADR-066: com o Claude Code e o hook do nod (executor local), quem recebe tem o kit do terminal — antes a
      // delegação ficava sem, e em 30/09 os Devs não implementaram nenhum dos pedidos do Chico.
      await repos.inventario.registrar("claude-cli", { estado: "pronto", versao: "2.1.272", em: AGORA });
      const local = await emitirPlanoTurno(deps, { turnoId: tarefa?.id ?? "", machineId: randomUUID(), executor: "local" });
      expect(local.data.nativas).toEqual([...NATIVAS_DO_TERMINAL]);
    });
  });

  it("de uma rotina com exige_aprovacao — o caso da Clarice (ADR-066): sem trava herdada; se a rotina leu algo de fora, o turno do colega nasce marcado e só o manual pede", async () => {
    await withRollback(MARLON, async (trx) => {
      const { taga, dev1, deps, repos, chamadas } = await cenario(trx);
      await githubDoDev1(repos, dev1);
      // O "Sempre permitir" que Marlon clicou em comentar no PR, para o Dev 1 (ADR-042).
      const d = await repos.decisoes.criar({ tipo: "aprovacao", agenteId: dev1.agenteId, conversaId: dev1.conversaId, turnoId: null, prazoDecisaoEm: AGORA + 86_400_000, frase: "Comentar no PR" });
      const itens = await repos.itensAprovacao.criarLote(d?.id ?? "", [{ idx: 0, texto: "Comentar no PR 466", destino: { conector: "github", ferramenta: "pr_comentar", argumentos: {} }, origemSensivel: false }]);
      expect((await permitirSempre(deps, { decisaoId: d?.id ?? "", itemIds: itens.map((i) => i.id) })).data.criadas).toHaveLength(1);

      // A rotina do Taga leu um app de fora antes de pedir.
      const daRotina = await turnoDeRotina(repos, taga, true, { leuDeFora: true });
      const r = await pedir(deps, { turnoId: daRotina.id, agenteId: taga.agenteId, conversaId: taga.conversaId });
      const tarefa = await repos.turnos.buscar(tarefaDoPedido(r.data));
      expect(tarefa).toMatchObject({ origem: "delegacao", entradaConfianca: "confiavel" });
      expect(tarefa?.entradaTexto).not.toContain("pedido_da_pessoa");
      // A página que a rotina leu não se lava pelo pedido (ADR-062): a marca passa a quem recebe, no lugar da trava.
      expect(await repos.turnos.contaminado(tarefa?.id ?? "")).toBe(true);

      const plano = await planoDe(deps, tarefa?.id ?? "");
      expect(plano.data.catalogo.ferramentas.map((f) => f.nome)).toEqual(expect.arrayContaining(["github__pr_ver", "github__pr_comentar"]));
      expect(chavesDaPolitica(plano.data)).toEqual(SEM_GATE);
      expect(plano.data.promptSistema).not.toContain("O pedido nasceu de uma rotina");
      const chamar = (turnoId: string, nome: string, p = plano.data) => chamarFerramenta(deps, { turnoId, agenteId: dev1.agenteId, nome, argumentos: {}, plano: p });
      expect((await chamar(tarefa?.id ?? "", "github__pr_ver")).data).toMatchObject({ ok: true });
      // Manual: depois de conteúdo de fora o "Sempre permitir" cai, e a escrita direta recebe "peça aprovação".
      expect((await chamar(tarefa?.id ?? "", "github__pr_comentar")).data).toMatchObject({ ok: false, negacao: { motivo: "alcance_insuficiente" } });

      // Rotina que não leu nada de fora, mesmo com exige_aprovacao: nada passa a quem recebe, e a regra dele vale.
      // NOD-259: outra janela, outro pedido — o mesmo texto ainda aberto seria recusado como repetido.
      const limpa = await pedir(deps, { turnoId: (await turnoDeRotina(repos, taga, true)).id, agenteId: taga.agenteId, conversaId: taga.conversaId }, "Dev 1", "revisar o PR 467");
      expect(await repos.turnos.contaminado(tarefaDoPedido(limpa.data))).toBe(false);
      const planoLimpo = await planoDe(deps, tarefaDoPedido(limpa.data));
      expect(chavesDaPolitica(planoLimpo.data)).toEqual(SEM_GATE);
      expect((await chamar(tarefaDoPedido(limpa.data), "github__pr_comentar", planoLimpo.data)).data).toMatchObject({ ok: true });

      // Automático: a marca não para — o pedido nascido da rotina que leu algo de fora comenta sozinho.
      await repos.agentes.definirModoAprovacao(dev1.agenteId, "automatico");
      expect((await chamar(tarefa?.id ?? "", "github__pr_comentar")).data).toMatchObject({ ok: true });
      expect(chamadas.conectores.map((c) => c.tool)).toEqual(["pr_ver", "pr_comentar", "pr_comentar"]);
    });
  });

  it("pede de qualquer turno abaixo do limite (retomada, sem mensagem, não confiável, delegação em 1 e 2), um passe mais fundo — o de entrada não confiável passa a marca (ADR-066); em 3 não repassa; turno de outro bot não serve", async () => {
    await withRollback(MARLON, async (trx) => {
      const { taga, dev1, deps, repos, turnoTaga } = await cenario(trx);
      const base = { conversaId: taga.conversaId, agenteId: taga.agenteId, prazoEm: AGORA + 60_000, entradaTexto: "x", modelo: "m" };
      const aceitos = [
        await repos.turnos.enfileirar({ executor: "catcher", ...base, origem: "retomada", profundidade: 0, entradaConfianca: "confiavel", retomaTurnoId: turnoTaga.id }),
        await repos.turnos.enfileirar({ executor: "catcher", ...base, origem: "conversa", profundidade: 0, entradaConfianca: "nao_confiavel" }),
        await repos.turnos.enfileirar({ executor: "catcher", ...base, origem: "conversa", profundidade: 0, entradaConfianca: "confiavel" }),
        // ADR-063: quem cumpre um pedido, ou a continuação de quem pediu, ainda pede até o limite da corrente.
        await repos.turnos.enfileirar({ executor: "catcher", ...base, origem: "delegacao", profundidade: 1, entradaConfianca: "confiavel", sobProcuracaoDe: PESSOA_MARLON }),
        await repos.turnos.enfileirar({ executor: "catcher", ...base, origem: "retomada", profundidade: 2, entradaConfianca: "confiavel", retomaTurnoId: turnoTaga.id }),
      ];
      // NOD-259: cada pedido com texto próprio e respondido antes do seguinte — o teto de pedidos abertos ao mesmo colega
      // recusaria o quarto.
      for (const [i, t] of aceitos.entries()) {
        const tarefa = await repos.turnos.buscar(tarefaDoPedido((await pedir(deps, { turnoId: t?.id ?? "", agenteId: taga.agenteId, conversaId: taga.conversaId }, "Dev 1", `revisar o PR ${466 + i}`)).data));
        expect(tarefa).toMatchObject({ origem: "delegacao", profundidade: (t?.profundidade ?? 0) + 1, entradaConfianca: "confiavel" });
        expect(await repos.turnos.contaminado(tarefa?.id ?? "")).toBe(t?.entradaConfianca === "nao_confiavel");
        await repos.turnos.assentar(tarefa?.id ?? "", { estado: "concluido" });
        await entregarRespostaPeer(deps, { tarefaId: tarefa?.id ?? "", texto: "feito" });
      }

      const noLimite = [
        await repos.turnos.enfileirar({ executor: "catcher", ...base, origem: "delegacao", profundidade: 3, entradaConfianca: "confiavel", sobProcuracaoDe: PESSOA_MARLON }),
        await repos.turnos.enfileirar({ executor: "catcher", ...base, origem: "retomada", profundidade: 3, entradaConfianca: "confiavel", retomaTurnoId: turnoTaga.id }),
      ];
      for (const t of noLimite) await expect(pedir(deps, { turnoId: t?.id ?? "", agenteId: taga.agenteId, conversaId: taga.conversaId })).rejects.toMatchObject({ codigo: "nao_permitido" });
      await expect(pedir(deps, { turnoId: turnoTaga.id, agenteId: dev1.agenteId, conversaId: dev1.conversaId }, "Taga")).rejects.toMatchObject({ codigo: "nao_permitido" });
      expect((await repos.turnos.listarDaConversa(dev1.conversaId)).filter((t) => t.origem === "delegacao")).toHaveLength(aceitos.length);
    });
  });

  it("a 0043 aceita 0 a 3 e recusa 4; a corrente Taga → Dev 1 → Chico → Dev 2 para no terceiro passe; ADR-066: sem trava em nenhum passe, e a marca da rotina que leu algo de fora vai de ponta a ponta", async () => {
    await withRollback(MARLON, async (trx) => {
      const { taga, dev1, deps, repos } = await cenario(trx);
      const chico = await agenteComConversa(trx, MARLON, { nome: "Chico" });
      const dev2 = await agenteComConversa(trx, MARLON, { nome: "Dev 2" });
      for (const a of [chico, dev2]) await repos.agentes.atualizarPerfil(a.agenteId, { confirmado: true });
      const base = { conversaId: taga.conversaId, agenteId: taga.agenteId, origem: "conversa" as const, prazoEm: AGORA + 60_000, entradaTexto: "x", entradaConfianca: "confiavel" as const, modelo: "m" };
      expect((await repos.turnos.enfileirar({ executor: "catcher", ...base, profundidade: 3 }))?.profundidade).toBe(3);
      await expectRejected(trx, () => trx`insert into turnos (tenant_id, owner_id, conversa_id, agente_id, origem, prazo_em, profundidade, entrada_texto, entrada_confianca, modelo)
        values (${TENANT_PADRAO}, ${PESSOA_MARLON}, ${taga.conversaId}, ${taga.agenteId}, 'conversa', now(), 4, 'x', 'confiavel', 'm')`, "23514");

      const rotina = await turnoDeRotina(repos, taga, true, { leuDeFora: true });
      const tarefa = async (de: { agenteId: string; conversaId: string }, turnoId: string, agente: string) => (await repos.turnos.buscar(tarefaDoPedido((await pedir(deps, { turnoId, agenteId: de.agenteId, conversaId: de.conversaId }, agente)).data)))!;
      const d1 = await tarefa(taga, rotina.id, "Dev 1");
      const d2 = await tarefa(dev1, d1.id, "Chico");
      const d3 = await tarefa(chico, d2.id, "Dev 2");
      expect([d1, d2, d3].map((t) => t.profundidade)).toEqual([1, 2, 3]);
      await expect(pedir(deps, { turnoId: d3.id, agenteId: dev2.agenteId, conversaId: dev2.conversaId }, "Taga")).rejects.toMatchObject({ codigo: "nao_permitido" });
      for (const t of [d1, d2, d3]) {
        expect(chavesDaPolitica((await planoDe(deps, t.id)).data)).toEqual(SEM_GATE);
        expect(await repos.turnos.contaminado(t.id)).toBe(true);
      }
      const noUltimo = (await planoDe(deps, d3.id)).data;
      expect(noUltimo.catalogo.ferramentas.map((f) => f.nome)).not.toContain("pedir_a_bot");
      expect(noUltimo.promptSistema).toContain("Limite da corrente:");
      expect(noUltimo.promptSistema).toContain("Faça o que der e diga na sua resposta a Chico, com uma pitada de humor, o que falta e para quem");
      const noSegundo = (await planoDe(deps, d2.id)).data;
      expect(noSegundo.catalogo.ferramentas.map((f) => f.nome)).toContain("pedir_a_bot");
      expect(noSegundo.promptSistema).toContain("Quem receber um pedido seu agora já estará no último passe da corrente");
    });
  });

  it("dono diferente: sem procuração → nao_permitido; classe alheia não basta; a classe antiga delegar_tarefa vale", async () => {
    await withRollback(MARLON, async (trx) => {
      const taga = await agenteComConversa(trx, MARLON, { nome: "Taga" });
      await vincularEscopo(trx, ANA);
      const dev1 = await agenteComConversa(trx, ANA, { nome: "Dev 1", dono: "empresa" });
      await vincularEscopo(trx, MARLON);
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => AGORA });
      const { data } = await enviarMensagem(deps, { conversaId: taga.conversaId, texto: PEDIDO, inventario: PRONTO });
      const ctx = { turnoId: data.turno.id, agenteId: taga.agenteId, conversaId: taga.conversaId };
      await expect(pedir(deps, ctx)).rejects.toMatchObject({ codigo: "nao_permitido" });
      await vincularEscopo(trx, ANA);
      const procuracao = await criarRepos(trx, ANA).procuracoes.criar({ agenteConcedenteId: dev1.agenteId, agenteBeneficiarioId: taga.agenteId, classesPermitidas: ["outra"], tetoDiario: 5 });
      await trx`update procuracoes set visibility = 'equipe' where id = ${procuracao?.id ?? ""}`;
      await trx`update conversas set visibility = 'equipe' where id = ${dev1.conversaId}`;
      await vincularEscopo(trx, MARLON);
      await expect(pedir(deps, ctx)).rejects.toMatchObject({ codigo: "nao_permitido", cause: "classe_nao_permitida" });

      await vincularEscopo(trx, ANA);
      await trx`update procuracoes set classes_permitidas = ${["delegar_tarefa"]} where id = ${procuracao?.id ?? ""}`;
      await vincularEscopo(trx, MARLON);
      const r = await pedir(deps, ctx);
      expect(await repos.turnos.buscar(tarefaDoPedido(r.data))).toMatchObject({ agenteId: dev1.agenteId, origem: "delegacao", sobProcuracaoDe: PESSOA_MARLON });
    });
  });

  it("falta acesso: o card nasce na conversa do Dev 1; aprovar retoma o pedido; só o resultado final volta, como retomada do turno do Taga", async () => {
    await withRollback(MARLON, async (trx) => {
      const { taga, dev1, deps, repos, turnoTaga } = await cenario(trx);
      const criado = await repos.conectores.criar({ nome: "GitHub", slug: "github", transporte: "stdio", comando: "node", declaracao: "nao-toca" });
      await repos.conectores.registrarSonda(criado?.id ?? "", { ok: true, catalogo: [cap("pr_ver", true), cap("pr_comentar", false)], agora: AGORA });
      const r = await pedir(deps, { turnoId: turnoTaga.id, agenteId: taga.agenteId, conversaId: taga.conversaId });
      const tarefaId = tarefaDoPedido(r.data);

      const pedido = await pedirAcesso(deps, { turnoId: tarefaId, conversaId: dev1.conversaId, agenteId: dev1.agenteId, conector: "github", capacidades: ["pr_ver", "pr_comentar"], nivel: "escrita", nao_pedido: ["aprovar ou fazer merge"] });
      expect(pedido.data.estado).toBe("aguardando_pessoa");
      expect((await repos.propostas.pendentesDaConversa(taga.conversaId)).length).toBe(0);
      await repos.turnos.assentar(tarefaId, { estado: "concluido" });
      expect((await entregarRespostaPeer(deps, { tarefaId, texto: "Pedi acesso ao GitHub." })).data).toEqual({ ignorado: "aguardando_pessoa" });

      const decidido = await decidirAcesso(deps, { decisaoId: pedido.data.proposta_id, recusar: false, executor: "catcher" });
      const retomada = await repos.turnos.buscar(decidido.data.turnoId ?? "");
      expect(retomada).toMatchObject({ origem: "retomada", retomaTurnoId: tarefaId, conversaId: dev1.conversaId, profundidade: 1, entradaConfianca: "confiavel", sobProcuracaoDe: PESSOA_MARLON });
      expect((await planoDe(deps, retomada?.id ?? "")).events?.[0]?.dados.modo).toBe("delegacao");

      await repos.turnos.assentar(retomada?.id ?? "", { estado: "concluido" });
      const entrega = await entregarRespostaPeer(deps, { tarefaId: retomada?.id ?? "", texto: "Revisei o PR 466: dois comentários." });
      if (!("mensagem" in entrega.data)) throw new Error("deveria entregar");
      expect(entrega.data.mensagem).toMatchObject({ conversaId: taga.conversaId, kind: "peer_ask", payload: { kind: "peer_ask", agenteId: dev1.agenteId, tarefaId, delegada: true, turnoOrigemId: turnoTaga.id } });
      expect(entrega.data.continuacao).toMatchObject({ conversaId: taga.conversaId, agenteId: taga.agenteId, origem: "retomada", retomaTurnoId: turnoTaga.id, profundidade: 1, entradaConfianca: "confiavel", sobProcuracaoDe: null });
      expect(entrega.data.continuacao.entradaTexto).toContain("Resposta de Dev 1 ao seu pedido: Revisei o PR 466: dois comentários.");
      // A continuação volta no modo de quem pediu (conversa) e, abaixo do limite, ainda pede a outro colega (ADR-063).
      const plano = await planoDe(deps, entrega.data.continuacao.id);
      expect(plano.events?.[0]?.dados.modo).toBe("conversa");
      expect(plano.data.catalogo.ferramentas.map((f) => f.nome)).toContain("pedir_a_bot");
      expect(plano.data.promptSistema).not.toContain("Limite da corrente:");
      expect(plano.data.promptSistema).toContain("tarefaOriginal");
    });
  });

  it("'Sempre permitir' não nasce para aprovar PR: o clique aprova, a regra de pr_revisar não é criada, e Sua vez marca o item", async () => {
    await withRollback(MARLON, async (trx) => {
      const { dev1, deps, repos } = await cenario(trx);
      await githubDoDev1(repos, dev1);
      const d = await repos.decisoes.criar({ tipo: "aprovacao", agenteId: dev1.agenteId, conversaId: dev1.conversaId, turnoId: null, prazoDecisaoEm: AGORA + 86_400_000, frase: "Revisar o PR 466" });
      const itens = await repos.itensAprovacao.criarLote(d?.id ?? "", [
        { idx: 0, texto: "Comentar no PR 466", destino: { conector: "github", ferramenta: "pr_comentar", argumentos: {} }, origemSensivel: false },
        { idx: 1, texto: "Aprovar o PR 466", destino: { conector: "github", ferramenta: "pr_revisar", argumentos: { evento: "APPROVE" } }, origemSensivel: false },
      ]);
      const sua = await listarSuaVez(deps, { marcarVista: false });
      expect(sua.data.itens.find((i) => i.decisao.id === d?.id)?.nuncaPermanente).toEqual([itens[1]?.id]);
      const r = await permitirSempre(deps, { decisaoId: d?.id ?? "", itemIds: itens.map((i) => i.id) });
      expect(r.data.criadas).toHaveLength(1);
      expect((await repos.permissoesPermanentes.ativasDoAgente(dev1.agenteId)).map((p) => p.capacidade)).toEqual(["pr_comentar"]);
      expect((await permitirSempre(deps, { decisaoId: d?.id ?? "", itemIds: [itens[1]?.id ?? ""] })).data).toEqual({ criadas: [], mensagemId: null });
    });
  });

  it("pedido com 30 h na cota segue em abertos", async () => {
    // NOD-279 (C22): a janela de 24 h da espera circular não vence enquanto a cadeia da tarefa espera a cota da IA.
    await withRollback(MARLON, async (trx) => {
      const { taga, dev1, deps, repos, turnoTaga } = await cenario(trx);
      const tarefaId = tarefaDoPedido((await pedir(deps, { turnoId: turnoTaga!.id, agenteId: taga.agenteId, conversaId: taga.conversaId })).data);
      await trx`update mensagens set criado_em = ${new Date(AGORA - 30 * 3_600_000)} where kind = 'handoff' and payload->>'tarefaId' = ${tarefaId}`;
      // A triagem parou no limite da IA; a volta da cota espera a renovação.
      await trx`update turnos set estado = 'interrompido', motivo_interrupcao = 'trabalho_incompleto' where id = ${tarefaId}`;
      const volta = await repos.turnos.enfileirar({ executor: "catcher", conversaId: dev1.conversaId, agenteId: dev1.agenteId, origem: "retomada", retomaTurnoId: tarefaId, prazoEm: AGORA + 86_400_000, profundidade: 1, entradaTexto: entradaDaVoltaDaCota("Claude Code"), entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli", acordarEm: AGORA + 3_600_000 });
      // NOD-259: `abertos` traz o pedido inteiro (tarefaId, criadoEm, texto); casa o deste pedido pela aresta e a tarefa.
      const aresta = expect.objectContaining({ de: taga.agenteId, para: dev1.agenteId, tarefaId });
      expect(await repos.pedidosDeColega.abertos(AGORA - JANELA_PEDIDOS_ABERTOS_MS)).toContainEqual(aresta);
      // A cadeia acabou sem resposta: o pedido de 30 h sai da espera circular, como antes.
      await trx`update turnos set estado = 'interrompido', motivo_interrupcao = 'trabalho_incompleto' where id = ${volta!.id}`;
      expect(await repos.pedidosDeColega.abertos(AGORA - JANELA_PEDIDOS_ABERTOS_MS)).not.toContainEqual(aresta);
    });
  });

  it("NOD-362: tarefaId/trabalhoId do handoff que não é uuid não derruba abertos (com e sem de, com e sem o piso)", async () => {
    await withRollback(MARLON, async (trx) => {
      const { taga, deps, repos, turnoTaga } = await cenario(trx);
      const tarefaId = tarefaDoPedido((await pedir(deps, { turnoId: turnoTaga!.id, agenteId: taga.agenteId, conversaId: taga.conversaId })).data);
      // Um com 2 h (na janela) e um com 30 h (cai no ramo do piso, que monta a cadeia pelo tarefaId).
      for (const [ids, horas] of [[{ tarefaId: "nao-e-uuid", trabalhoId: "tambem-nao" }, 2], [{ tarefaId: "00000000-0000-0000-0000-00000000000g", trabalhoId: "" }, 30],
        // uuid cercado de lixo: sem as âncoras da regex o cast quebraria a consulta (mutante do QA).
        [{ tarefaId: `x${tarefaId}`, trabalhoId: `${randomUUID()} ` }, 30]] as const) {
        await trx`insert into mensagens (tenant_id, owner_id, visibility, conversa_id, autor_tipo, autor_id, conta_de_execucao, executor, locality, locality_reason, decidido_por, regra_versao, kind, texto, confianca, payload, criado_em)
          select tenant_id, owner_id, visibility, conversa_id, autor_tipo, autor_id, conta_de_execucao, executor, locality, locality_reason, decidido_por, regra_versao, kind, texto, confianca,
            payload || ${trx.json(ids)}, ${new Date(AGORA - horas * 3_600_000)}
          from mensagens where kind = 'handoff' and payload->>'tarefaId' = ${tarefaId}`;
      }
      const desde = AGORA - JANELA_PEDIDOS_ABERTOS_MS;
      const daTaga = (ps: readonly { de: string; tarefaId: string | null }[]) => ps.filter((p) => p.de === taga.agenteId).map((p) => p.tarefaId).sort();
      for (const filtro of [{}, { de: taga.agenteId }, { semPiso: true }, { de: taga.agenteId, semPiso: true }]) {
        // O de 2 h segue aberto (nenhuma resposta da tarefa "nao-e-uuid"); o de 30 h sem cadeia viva sai, como antes.
        expect(daTaga(await repos.pedidosDeColega.abertos(desde, filtro))).toEqual(["nao-e-uuid", tarefaId].sort());
      }
    });
  });

  it("NOD-362: abertos desce pelos índices da 0115 e pela PK de trabalhos, sem varrer turnos, com e sem de", async () => {
    // Critério 1: a consulta real, contada pelos scans da própria transação (sob RLS, como nod_app). Sem seq scan para
    // o planejador não preferir varrer as tabelas pequenas do teste.
    await withRollback(MARLON, async (trx) => {
      const { taga, dev1, deps, repos, turnoTaga } = await cenario(trx);
      const tarefaId = tarefaDoPedido((await pedir(deps, { turnoId: turnoTaga!.id, agenteId: taga.agenteId, conversaId: taga.conversaId })).data);
      const w = (await repos.trabalhos.criar({ agenteId: dev1.agenteId, conversaId: dev1.conversaId, titulo: "task", origem: "pessoa" }))!;
      // 30 h e com trabalhoId: passa pelos ramos do turno da task e da cadeia de retomadas.
      await trx`update mensagens set criado_em = ${new Date(AGORA - 30 * 3_600_000)}, payload = payload || ${trx.json({ trabalhoId: w.id })}
        where kind = 'handoff' and payload->>'tarefaId' = ${tarefaId}`;
      // Estabilização (CI de 29/10, run 40801477655): com `mensagens` quase vazia e sem ANALYZE (banco novo do CI, antes
      // do autovacuum passar), o custo de `mensagens_por_conversa` (tenant_id, conversa_id, criado_em) empata com o dos
      // parciais da 0115 e, no empate, ganha o índice mais antigo (0002). O que muda entre execuções é o reltuples/relpages
      // e o tamanho físico da tabela (ANALYZE/VACUUM do autovacuum, linhas mortas dos rollbacks em paralelo). Com o volume
      // de produção (falas comuns, que não são handoff nem peer_ask), os parciais ganham por tamanho: as falas abaixo (na
      // janela, rolam com a transação) dão esse volume ao teste, com ou sem estatísticas, sem mudar o que ele prova. Não
      // suba o volume a ponto de o planejador abrir plano paralelo: o scan de worker não entra em pg_stat_get_xact_numscans.
      await trx`insert into mensagens (tenant_id, owner_id, visibility, conversa_id, autor_tipo, autor_id, conta_de_execucao, executor, locality, locality_reason, decidido_por, regra_versao, kind, texto, confianca, payload, criado_em)
        select tenant_id, owner_id, visibility, conversa_id, autor_tipo, autor_id, conta_de_execucao, executor, locality, locality_reason, decidido_por, regra_versao, 'texto', 'fala', confianca,
          '{}'::jsonb, ${new Date(AGORA - 3_600_000)}::timestamptz - make_interval(secs => g)
        from (select * from mensagens where kind = 'handoff' and payload->>'tarefaId' = ${tarefaId} limit 1) m, generate_series(1, 5000) g`;
      await trx`set local enable_seqscan = off`;
      // Em `turnos` o índice escolhido varia com o volume (pkey, turnos_vivos, turnos_por_trabalho); o que não pode é varrer.
      const indices = ["mensagens_handoffs_por_tempo", "mensagens_peer_ask_por_conversa", "trabalhos_pkey"];
      const scans = async () => {
        const [l] = await trx<{ indices: Record<string, number>; seq_turnos: number }[]>`
          select (select jsonb_object_agg(n, pg_stat_get_xact_numscans(n::regclass)) from unnest(${indices}::text[]) n) as indices,
            (select seq_scan from pg_stat_xact_user_tables where relname = 'turnos')::int as seq_turnos`;
        return l!;
      };
      for (const filtro of [{}, { de: taga.agenteId }]) {
        const antes = await scans();
        await repos.pedidosDeColega.abertos(AGORA - JANELA_PEDIDOS_ABERTOS_MS, filtro);
        const depois = await scans();
        for (const i of indices) expect({ filtro, i, usou: (depois.indices[i] ?? 0) > (antes.indices[i] ?? 0) }).toEqual({ filtro, i, usou: true });
        expect(depois.seq_turnos).toBe(antes.seq_turnos);
      }
    });
  });

  it("NOD-362: handoff de 30 h com trabalhoId (uuid) segue aberto pelo turno vivo da task e sai quando a task acaba", async () => {
    await withRollback(MARLON, async (trx) => {
      const { taga, dev1, deps, repos, turnoTaga } = await cenario(trx);
      const tarefaId = tarefaDoPedido((await pedir(deps, { turnoId: turnoTaga!.id, agenteId: taga.agenteId, conversaId: taga.conversaId })).data);
      const w = (await repos.trabalhos.criar({ agenteId: dev1.agenteId, conversaId: dev1.conversaId, titulo: "task do colega", origem: "pessoa" }))!;
      await trx`update mensagens set criado_em = ${new Date(AGORA - 30 * 3_600_000)}, payload = payload || ${trx.json({ trabalhoId: w.id })}
        where kind = 'handoff' and payload->>'tarefaId' = ${tarefaId}`;
      // A cadeia do tarefaId acabou: o que segura o pedido é só o turno pendente da task (ramo `turnos_por_trabalho`).
      await trx`update turnos set estado = 'interrompido', motivo_interrupcao = 'trabalho_incompleto' where id = ${tarefaId}`;
      const daTask = await repos.turnos.enfileirar({ executor: "catcher", conversaId: dev1.conversaId, agenteId: dev1.agenteId, origem: "conversa", prazoEm: AGORA + 60_000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m" });
      await trx`update turnos set trabalho_id = ${w.id} where id = ${daTask!.id}`;
      const desde = AGORA - JANELA_PEDIDOS_ABERTOS_MS;
      const aresta = expect.objectContaining({ de: taga.agenteId, tarefaId });
      expect(await repos.pedidosDeColega.abertos(desde)).toContainEqual(aresta);
      expect(await repos.pedidosDeColega.abertos(desde, { de: taga.agenteId })).toContainEqual(aresta);
      // O turno da task acabou: sem cadeia viva, o de 30 h sai.
      await trx`update turnos set estado = 'interrompido', motivo_interrupcao = 'trabalho_incompleto' where id = ${daTask!.id}`;
      expect(await repos.pedidosDeColega.abertos(desde)).not.toContainEqual(aresta);
      // Na janela (2 h), só a task terminada fecha o pedido (`not exists` por `trabalhos_pkey`).
      await trx`update mensagens set criado_em = ${new Date(AGORA - 2 * 3_600_000)} where kind = 'handoff' and payload->>'tarefaId' = ${tarefaId}`;
      expect(await repos.pedidosDeColega.abertos(desde)).toContainEqual(aresta);
      await trx`update trabalhos set estado = 'terminado', terminado_em = now() where id = ${w.id}`;
      expect(await repos.pedidosDeColega.abertos(desde)).not.toContainEqual(aresta);
      expect(await repos.pedidosDeColega.abertos(desde, { de: taga.agenteId, semPiso: true })).not.toContainEqual(aresta);
    });
  });

  it("NOD-362: no disparo da rotina o pedido de 2 h entra no prompt e o de 30 h preso na cota não, mas segue em abertos", async () => {
    await withRollback(MARLON, async (trx) => {
      const { taga, dev1, deps, repos, turnoTaga } = await cenario(trx);
      const recente = tarefaDoPedido((await pedir(deps, { turnoId: turnoTaga!.id, agenteId: taga.agenteId, conversaId: taga.conversaId }, "Dev 1", "revisar o PR recente")).data);
      const outroTurno = await repos.turnos.enfileirar({ executor: "catcher", conversaId: taga.conversaId, agenteId: taga.agenteId, origem: "conversa", prazoEm: AGORA + 60_000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m" });
      const antigo = tarefaDoPedido((await pedir(deps, { turnoId: outroTurno!.id, agenteId: taga.agenteId, conversaId: taga.conversaId }, "Dev 1", "revisar o PR antigo na cota")).data);
      await trx`update mensagens set criado_em = ${new Date(AGORA - 2 * 3_600_000)} where kind = 'handoff' and payload->>'tarefaId' = ${recente}`;
      await trx`update mensagens set criado_em = ${new Date(AGORA - 30 * 3_600_000)} where kind = 'handoff' and payload->>'tarefaId' = ${antigo}`;
      // O de 30 h: a triagem parou no limite da IA e a volta da cota espera a renovação (o cenário da NOD-279).
      await trx`update turnos set estado = 'interrompido', motivo_interrupcao = 'trabalho_incompleto' where id = ${antigo}`;
      await repos.turnos.enfileirar({ executor: "catcher", conversaId: dev1.conversaId, agenteId: dev1.agenteId, origem: "retomada", retomaTurnoId: antigo, prazoEm: AGORA + 86_400_000, profundidade: 1, entradaTexto: entradaDaVoltaDaCota("Claude Code"), entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli", acordarEm: AGORA + 3_600_000 });

      const rotina = await repos.rotinas.criar({ agenteId: taga.agenteId, conversaId: taga.conversaId, cron: "0 * * * *", fusoIana: "UTC", instrucao: "Ver o board", fonte: "Linear", entregavel: "chat", limitesAprovacao: "", politicaSemDado: "", proximaExecucao: AGORA, exigeAprovacao: false });
      const logs: { nivel: string; evento: string; ms?: number; pedidos?: number; rotina_id?: string }[] = [];
      definirDestinoDoLog((linha) => logs.push(JSON.parse(linha) as (typeof logs)[number]));
      const r = await dispararRotina(deps, { rotina: rotina!, instanteAgendado: AGORA, machineId: randomUUID(), executor: "catcher" }).finally(() => definirDestinoDoLog(null));
      if (!("turno" in r.data)) throw new Error("a rotina deveria disparar");
      // O tempo da consulta vai para o log (critério 5): info abaixo do limiar, com o número de pedidos do aviso.
      const tempo = logs.find((l) => l.evento === "pedidos_abertos_ms");
      expect(tempo).toMatchObject({ nivel: "info", rotina_id: rotina!.id, pedidos: 1 });
      expect(tempo?.ms).toEqual(expect.any(Number));
      expect([nivelDoTempoDosPedidos(LIMIAR_PEDIDOS_ABERTOS_MS), nivelDoTempoDosPedidos(LIMIAR_PEDIDOS_ABERTOS_MS + 1)]).toEqual(["info", "aviso"]);
      const entrada = (await repos.turnos.buscar(r.data.turno.id))?.entradaTexto ?? "";
      expect(entrada).toContain("Pedidos seus a colegas ainda sem resposta");
      expect(entrada).toContain("revisar o PR recente");
      expect(entrada).not.toContain("revisar o PR antigo na cota");
      // A guarda do pedir_a_bot (sem a opção) segue vendo o pedido preso na cota.
      const tarefas = (await repos.pedidosDeColega.abertos(AGORA - JANELA_PEDIDOS_ABERTOS_MS, { de: taga.agenteId })).map((p) => p.tarefaId);
      expect(tarefas).toEqual(expect.arrayContaining([recente, antigo]));
      expect((await repos.pedidosDeColega.abertos(AGORA - JANELA_PEDIDOS_ABERTOS_MS)).map((p) => p.tarefaId)).toEqual(expect.arrayContaining([recente, antigo]));
    });
  });
});
