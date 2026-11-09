import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { CapacidadeConector } from "../../src/contracts/conector.ts";
import type { Repos } from "../../src/repositories/tipos.ts";
import { chamarFerramenta } from "../../src/use-cases/chamar-ferramenta.ts";
import { concederLote } from "../../src/use-cases/conceder.ts";
import { decidirAcesso } from "../../src/use-cases/decidir-acesso.ts";
import { dispararRotina } from "../../src/use-cases/disparar-rotina.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { listarSuaVez } from "../../src/use-cases/listar-sua-vez.ts";
import { pedirAPessoa } from "../../src/use-cases/pedir-a-pessoa.ts";
import { pedirAcesso } from "../../src/use-cases/pedir-acesso.ts";
import { fecharComResposta, retomarComResposta } from "../../src/use-cases/responder-decisao.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const TZ = "America/Sao_Paulo";
const JANELA = Date.parse("2026-09-24T08:00:00-03:00");
const cap = (nome: string, readOnlyHint: boolean): CapacidadeConector => ({ nome, descricao: nome.toLowerCase(), schema: { type: "object" }, readOnlyHint });
const GMAIL = [cap("GMAIL_FETCH_EMAILS", true), cap("GMAIL_LIST_LABELS", true), cap("GMAIL_SEND_EMAIL", false)];

async function conectorPronto(repos: Repos, p: { slug: string; nome: string; catalogo: CapacidadeConector[]; toca?: boolean }) {
  const criado = p.toca
    ? await repos.conectores.criar({ nome: p.nome, slug: p.slug, transporte: "stdio", comando: "node", declaracao: "toca" })
    : await repos.conectores.criar({ nome: p.nome, slug: p.slug, transporte: "http", url: "https://example.com/mcp", declaracao: "nao-toca" });
  if (!criado) throw new Error("conector");
  const sondado = await repos.conectores.registrarSonda(criado.id, { ok: true, catalogo: p.catalogo, agora: JANELA });
  if (!sondado) throw new Error("sonda");
  return sondado;
}

async function disparar(deps: Deps, repos: Repos, rotinaId: string, instante: number): Promise<string> {
  const rotina = await repos.rotinas.buscar(rotinaId);
  if (!rotina) throw new Error("rotina");
  const r = await dispararRotina(deps, { rotina, instanteAgendado: instante, machineId: randomUUID(), executor: "catcher" });
  if (!("turno" in r.data)) throw new Error("janela de outro");
  return r.data.turno.id;
}

describeIntegracao("acesso em um clique também na rotina (ADR-044)", () => {
  it("rotina sem acesso pede por botão (leitura ou escrita, ADR-066); o disparo seguinte reaproveita; permitir concede o lote com UM consentimento e roda a rotina de novo em modo rotina", async () => {
    await withRollback(MARLON, async (trx) => {
      let agora = JANELA + 30_000;
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Nina" });
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => agora });
      await repos.agentes.atualizarPerfil(agenteId, { confirmado: true, descricao: "Cuida dos e-mails" });
      await conectorPronto(repos, { slug: "gmail", nome: "Gmail (Composio)", catalogo: GMAIL });
      // A fonte não cita o app: o turno roda e pede no meio. Com "Gmail" na fonte o pré-voo (emenda da
      // ADR-044) pararia a janela antes do turno — tests/integration/rotina-bloqueio.test.ts.
      const rotina = await repos.rotinas.criar({ agenteId, conversaId, cron: "0 8,13,18 * * *", fusoIana: TZ, instrucao: "E-mails às 8h, 13h e 18h", fonte: "a caixa de entrada", entregavel: "resumo", limitesAprovacao: "nada sai sem aprovação", politicaSemDado: "silêncio", proximaExecucao: JANELA });
      if (!rotina) throw new Error("rotina");
      const oito = await disparar(deps, repos, rotina.id, JANELA);

      const pedido = await pedirAcesso(deps, { turnoId: oito, conversaId, agenteId, conector: "gmail", capacidades: [], nivel: "leitura", nao_pedido: [] });
      expect(pedido.data.estado).toBe("aguardando_pessoa");
      expect((await repos.events.gravarComOutbox(pedido.events ?? [])).ids).toHaveLength(2);
      const proposta = await repos.propostas.buscar(pedido.data.proposta_id);
      expect(proposta?.payload).toEqual({ kind: "acesso", turnoId: oito, conector: "gmail", capacidades: ["GMAIL_FETCH_EMAILS", "GMAIL_LIST_LABELS"], nivel: "leitura", naoPedido: [], rotinaId: rotina.id });
      expect(await repos.decisoes.buscar(pedido.data.proposta_id)).toMatchObject({ tipo: "acesso", estado: "pendente", turnoId: oito, frase: "Nina precisa ler seu Gmail para a rotina “E-mails às 8h, 13h e 18h”. Não inclui: enviar, apagar, arquivar." });

      // O disparo das 13h esbarra no mesmo buraco: nada novo nasce. (O das 8h já tinha terminado:
      // com ele aberto a janela seria pulada — uma execução aberta por rotina, ADR-045.) Desde a emenda
      // de 2026-09-24 nem turno nasce: o pedido aberto da rotina para a janela no pré-voo.
      await repos.turnos.assentar(oito, { estado: "concluido" });
      const rotinaDas13 = await repos.rotinas.buscar(rotina.id);
      if (!rotinaDas13) throw new Error("rotina");
      const treze = await dispararRotina(deps, { rotina: rotinaDas13, instanteAgendado: JANELA + 5 * 3_600_000, machineId: randomUUID(), executor: "catcher" });
      expect(treze.data).toMatchObject({ bloqueada: "sem_acesso", propostaId: pedido.data.proposta_id });
      expect((await pedirAcesso(deps, { turnoId: oito, conversaId, agenteId, conector: "gmail", capacidades: [], nivel: "leitura", nao_pedido: [] })).data.proposta_id).toBe(pedido.data.proposta_id);
      // ADR-066: a rotina também pede escrita (antes, nao_permitido); com o card do app aberto, é ele que responde — UM por app.
      expect((await pedirAcesso(deps, { turnoId: oito, conversaId, agenteId, conector: "gmail", capacidades: [], nivel: "escrita", nao_pedido: [] })).data).toMatchObject({ proposta_id: pedido.data.proposta_id, estado: "aguardando_pessoa" });
      expect((await repos.propostas.pendentesDaConversa(conversaId)).filter((p) => p.kind === "acesso")).toHaveLength(1);

      // "Sua vez" leva a proposta junto, para a web rotular "Permitir e rodar agora".
      const fila = await listarSuaVez(deps, { marcarVista: false });
      expect(fila.data.itens.find((i) => i.decisao.id === pedido.data.proposta_id)?.proposta?.payload).toMatchObject({ kind: "acesso", rotinaId: rotina.id });

      agora = JANELA + 6 * 3_600_000 + 417;
      const r = await decidirAcesso(deps, { decisaoId: pedido.data.proposta_id, recusar: false, executor: "catcher" });
      await repos.events.gravarComOutbox(r.events ?? []);
      expect(r.data).toMatchObject({ concessoes: 2, rotinaId: rotina.id, turnoId: expect.any(String) });
      const concessoes = await repos.concessoes.doAgente(agenteId);
      expect(concessoes.map((g) => g.capacidade).sort()).toEqual(["GMAIL_FETCH_EMAILS", "GMAIL_LIST_LABELS"]);
      expect(new Set(concessoes.map((g) => g.mensagemId))).toEqual(new Set([r.data.consentimentoId]));
      expect((await repos.mensagens.listarDaConversa(conversaId, 200)).filter((m) => m.kind === "consentimento")).toHaveLength(1);
      expect((await repos.propostas.buscar(pedido.data.proposta_id))?.estado).toBe("confirmada");

      const novo = await repos.turnos.buscar(r.data.turnoId ?? "");
      expect(novo).toMatchObject({ origem: "rotina", retomaTurnoId: null, conversaId });
      expect((await repos.rotinaJanelas.buscarPorTurno(novo?.id ?? ""))?.instanteAgendado).toBe(agora);
      // A agenda não muda: a execução agora é extra.
      expect((await repos.rotinas.buscar(rotina.id))?.proximaExecucao).toBe(JANELA + 5 * 3_600_000 + 5 * 3_600_000);
      const plano = await emitirPlanoTurno(deps, { turnoId: novo?.id ?? "", machineId: randomUUID(), executor: "catcher" });
      expect(plano.data.catalogo.ferramentas.map((f) => f.nome)).toEqual(expect.arrayContaining(["gmail__GMAIL_FETCH_EMAILS", "gmail__GMAIL_LIST_LABELS", "pedir_acesso", "sem_novidade"]));
      expect(plano.events?.[0]?.dados.modo).toBe("rotina");
    });
  });

  it("agente excluído, restaurado e pedido reaberto: permitir registra a concessão, mas a rotina da geração antiga não é reativada nem disparada", async () => {
    await withRollback(MARLON, async (trx) => {
      const agora = JANELA + 30_000;
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Nina" });
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => agora });
      await conectorPronto(repos, { slug: "gmail", nome: "Gmail", catalogo: GMAIL });
      // Fonte sem o app: o turno roda e pede (o card do pré-voo, sem turno, tem o seu teste em rotina-bloqueio).
      const rotina = await repos.rotinas.criar({ agenteId, conversaId, cron: "0 8,13,18 * * *", fusoIana: TZ, instrucao: "E-mails às 8h, 13h e 18h", fonte: "a caixa de entrada", entregavel: "resumo", limitesAprovacao: "nada sai sem aprovação", politicaSemDado: "silêncio", proximaExecucao: JANELA });
      if (!rotina) throw new Error("rotina");
      const disparado = await disparar(deps, repos, rotina.id, JANELA);
      const pedido = await pedirAcesso(deps, { turnoId: disparado, conversaId, agenteId, conector: "gmail", capacidades: [], nivel: "leitura", nao_pedido: [] });
      // Excluir sobe a geração de execução (ADR-034) e vence as decisões abertas; restaurar não devolve a
      // geração. A pessoa reabre o pedido vencido e permite.
      await repos.agentes.excluir(agenteId, agora);
      await repos.agentes.restaurar(agenteId);
      expect((await repos.decisoes.buscar(pedido.data.proposta_id))?.estado).toBe("vencida");
      expect(await repos.decisoes.reabrir(pedido.data.proposta_id, agora + 86_400_000)).not.toBeNull();
      expect(await repos.agentes.execucaoBloqueada(disparado)).toBe(true);

      const r = await decidirAcesso(deps, { decisaoId: pedido.data.proposta_id, recusar: false, executor: "catcher" });
      expect(r.data).toMatchObject({ concessoes: 2, rotinaId: rotina.id, turnoId: null });
      expect((await repos.concessoes.doAgente(agenteId)).map((g) => g.capacidade).sort()).toEqual(["GMAIL_FETCH_EMAILS", "GMAIL_LIST_LABELS"]);
      expect((await repos.rotinas.buscar(rotina.id))?.estado).toBe("pausada");
      expect((await repos.turnos.listarDaConversa(conversaId, 50)).map((t) => t.id)).toEqual([disparado]);
    });
  });

  // revisto em 2026-10-01 (ADR-066): a rotina não nasce mais não confiável pelo app que a fonte cita (confiancaDaFonte saiu),
  // e o catálogo não encolhe. A marca de conteúdo de fora vem do que o bot LÊ, e a retomada a herda — não se lava.
  it("ADR-066: rotina que cita app de fora nasce confiável e com a escrita no catálogo; LER o app marca o turno, e a retomada herda a marca, em modo rotina e em sessão nova", async () => {
    await withRollback(MARLON, async (trx) => {
      const agora = JANELA + 30_000;
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Nina" });
      const { deps, repos, chamadas } = depsSobre(trx, MARLON, { agora: () => agora });
      await repos.agentes.atualizarPerfil(agenteId, { confirmado: true, descricao: "Cuida da turma" });
      // App sem curadoria de conteúdo interno (e que toca dado pessoal): antes a rotina nascia nao_confiavel.
      const diario = await conectorPronto(repos, { slug: "diario", nome: "Diário de classe", catalogo: [cap("LER_NOTAS", true), cap("LANCAR_NOTA", false)], toca: true });
      await concederLote(deps, { agenteId, conectorId: diario.id, capacidades: ["LER_NOTAS", "LANCAR_NOTA"], autorTipo: "pessoa" });
      await repos.conversas.atualizarSessaoCli(conversaId, randomUUID(), "catcher");
      const rotina = await repos.rotinas.criar({ agenteId, conversaId, cron: "0 8 * * 1-5", fusoIana: TZ, instrucao: "Resumo das notas", fonte: "diario", entregavel: "resumo", limitesAprovacao: "nada sai sem aprovação", politicaSemDado: "silêncio", proximaExecucao: JANELA });
      if (!rotina) throw new Error("rotina");
      const disparado = await disparar(deps, repos, rotina.id, JANELA);
      const original = await repos.turnos.buscar(disparado);
      expect(original?.entradaConfianca).toBe("confiavel");
      expect(await repos.turnos.contaminado(disparado)).toBe(false);

      const doDisparo = await emitirPlanoTurno(deps, { turnoId: disparado, machineId: randomUUID(), executor: "catcher" });
      expect(doDisparo.data.confiancaEntrada).toBe("confiavel");
      expect(doDisparo.data.catalogo.ferramentas.map((f) => f.nome)).toEqual(expect.arrayContaining(["diario__LER_NOTAS", "diario__LANCAR_NOTA"]));
      // Ler o app de fora é o que marca o turno (chamar-ferramenta.ts).
      expect((await chamarFerramenta(deps, { turnoId: disparado, agenteId, nome: "diario__LER_NOTAS", argumentos: {}, plano: doDisparo.data })).data).toMatchObject({ ok: true });
      expect(chamadas.conectores.map((c) => c.tool)).toEqual(["LER_NOTAS"]);
      expect(await repos.turnos.contaminado(disparado)).toBe(true);

      const pergunta = await pedirAPessoa(deps, { turnoId: disparado, conversaId, agenteId, tipo: "falta_de_dado", texto: "falta a planilha de faltas", dado: "planilha de faltas" });
      const { data: fechada } = await fecharComResposta(deps, { decisaoId: pergunta.data.decisao_id, texto: "está no drive" });
      const { data: resposta } = await retomarComResposta(deps, { decisao: fechada.decisao, texto: "está no drive", respondidaPor: { id: PESSOA_MARLON, nome: "Marlon" }, executor: "catcher" });
      const retomada = resposta.turno;
      expect(retomada).toMatchObject({ origem: "retomada", retomaTurnoId: disparado, entradaConfianca: "confiavel" });
      // A resposta da pessoa não lava o que a rotina já leu: a marca passa para a retomada (enfileirar-retomada.ts).
      expect(await repos.turnos.contaminado(retomada?.id ?? "")).toBe(true);
      expect(retomada?.entradaTexto).toContain("Entrada original da rotina:");
      expect(retomada?.entradaTexto).toContain(original?.entradaTexto ?? "—");

      const plano = await emitirPlanoTurno(deps, { turnoId: retomada?.id ?? "", machineId: randomUUID(), executor: "catcher" });
      const nomes = plano.data.catalogo.ferramentas.map((f) => f.nome);
      expect(plano.events?.[0]?.dados.modo).toBe("rotina");
      expect(plano.data.confiancaEntrada).toBe("confiavel");
      expect(plano.data.politicaExecucao).not.toHaveProperty("efeitoExternoSoPorAprovacao");
      // Nunca a sessão da conversa; a do turno que ela continua só vale se ele abriu uma (este nunca rodou).
      expect(plano.data.entrada.sessaoCli).toBeNull();
      expect(nomes).toEqual(expect.arrayContaining(["diario__LER_NOTAS", "diario__LANCAR_NOTA", "pedir_acesso"]));
      // O kit da CONVERSA não volta pela retomada: nada de mexer em rotina nem criar outra.
      for (const n of ["listar_rotinas", "pausar_rotina", "criar_rotina", "excluir_rotina"]) expect(nomes).not.toContain(n);

      // SEGURANÇA, agora pelo modo: no manual a escrita do turno marcado pede a pessoa (peça aprovação), sem chegar ao app.
      const lancar = await chamarFerramenta(deps, { turnoId: retomada?.id ?? "", agenteId, nome: "diario__LANCAR_NOTA", argumentos: {}, plano: plano.data });
      expect(lancar.data).toMatchObject({ ok: false, negacao: { motivo: "alcance_insuficiente", terminal: false } });
      expect(chamadas.conectores.map((c) => c.tool)).toEqual(["LER_NOTAS"]);

      // Dois saltos de retomada continuam ligados à rotina.
      const deNovo = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "retomada", retomaTurnoId: retomada?.id, prazoEm: agora + 600_000, profundidade: 0, entradaTexto: "continue", entradaConfianca: "confiavel", modelo: "m" });
      const segundo = await emitirPlanoTurno(deps, { turnoId: deNovo?.id ?? "", machineId: randomUUID(), executor: "catcher" });
      expect(segundo.events?.[0]?.dados.modo).toBe("rotina");
      expect(segundo.data.politicaExecucao).not.toHaveProperty("efeitoExternoSoPorAprovacao");
    });
  });

  // revisto em 2026-10-01 (ADR-066): não há mais gate de rotina; a escrita direta passa pela MESMA decisão do card, e o modo decide.
  it("ADR-066: na retomada de rotina a escrita direta passa pela decisão do modo — no manual é negada (peça aprovação, transitória); no automático sai", async () => {
    await withRollback(MARLON, async (trx) => {
      const agora = JANELA + 30_000;
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Nina" });
      const { deps, repos, chamadas } = depsSobre(trx, MARLON, { agora: () => agora });
      await repos.agentes.atualizarPerfil(agenteId, { confirmado: true, descricao: "Cuida dos e-mails" });
      const gmail = await conectorPronto(repos, { slug: "gmail", nome: "Gmail", catalogo: GMAIL });
      await concederLote(deps, { agenteId, conectorId: gmail.id, capacidades: ["GMAIL_FETCH_EMAILS", "GMAIL_SEND_EMAIL"], autorTipo: "pessoa" });
      const rotina = await repos.rotinas.criar({ agenteId, conversaId, cron: "0 8 * * 1-5", fusoIana: TZ, instrucao: "Responder e-mails", fonte: "planilha de clientes", entregavel: "respostas", limitesAprovacao: "nada sai sem aprovação", politicaSemDado: "silêncio", proximaExecucao: JANELA });
      if (!rotina) throw new Error("rotina");
      const disparado = await disparar(deps, repos, rotina.id, JANELA);
      const pergunta = await pedirAPessoa(deps, { turnoId: disparado, conversaId, agenteId, tipo: "pergunta", texto: "respondo o cliente?" });
      const { data: fechada } = await fecharComResposta(deps, { decisaoId: pergunta.data.decisao_id, texto: "pode" });
      const { data: resposta } = await retomarComResposta(deps, { decisao: fechada.decisao, texto: "pode", respondidaPor: { id: PESSOA_MARLON, nome: "Marlon" }, executor: "catcher" });
      const plano = (await emitirPlanoTurno(deps, { turnoId: resposta.turno?.id ?? "", machineId: randomUUID(), executor: "catcher" })).data;
      expect(plano.catalogo.ferramentas.map((f) => f.nome)).toContain("gmail__GMAIL_SEND_EMAIL");
      expect(plano.politicaExecucao).not.toHaveProperty("efeitoExternoSoPorAprovacao");
      const enviar = () => chamarFerramenta(deps, { turnoId: resposta.turno?.id ?? "", agenteId, nome: "gmail__GMAIL_SEND_EMAIL", argumentos: {}, plano });
      expect((await enviar()).data).toMatchObject({ ok: false, negacao: { motivo: "alcance_insuficiente", terminal: false } });
      expect(chamadas.conectores).toEqual([]);
      await repos.agentes.definirModoAprovacao(agenteId, "automatico");
      expect((await enviar()).data).toMatchObject({ ok: true });
      expect(chamadas.conectores.map((c) => c.tool)).toEqual(["GMAIL_SEND_EMAIL"]);
    });
  });

  // definido em 2026-10-01 (ADR-066): no automático e no total o pré-voo concede como o turno já concedia, sem disparar de
  // novo (`semDisparar`) — o disparo segue no mesmo passo. No banco de verdade: a concessão, a decisão fechada pela regra,
  // os eventos no outbox e UM turno para a janela.
  it("ADR-066: no automático o pré-voo concede pelo modo e a janela roda — decisão fechada pela regra, eventos no outbox, UM turno, nada bloqueado", async () => {
    await withRollback(MARLON, async (trx) => {
      const agora = JANELA + 30_000;
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Nina" });
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => agora });
      await repos.agentes.atualizarPerfil(agenteId, { confirmado: true, descricao: "Cuida dos e-mails" });
      await repos.agentes.definirModoAprovacao(agenteId, "automatico");
      const gmail = await conectorPronto(repos, { slug: "gmail", nome: "Gmail (Composio)", catalogo: GMAIL });
      // A fonte cita o app e o bot não tem acesso: no manual a janela pararia no pré-voo (rotina-bloqueio.test.ts).
      const rotina = await repos.rotinas.criar({ agenteId, conversaId, cron: "0 8 * * 1-5", fusoIana: TZ, instrucao: "Resumo do Gmail", fonte: "Gmail", entregavel: "resumo", limitesAprovacao: "nada sai sem aprovação", politicaSemDado: "silêncio", proximaExecucao: JANELA });
      if (!rotina) throw new Error("rotina");
      const turnoId = await disparar(deps, repos, rotina.id, JANELA);

      expect((await repos.concessoes.doAgente(agenteId)).filter((g) => g.conectorId === gmail.id).map((g) => g.capacidade).sort()).toEqual(["GMAIL_FETCH_EMAILS", "GMAIL_LIST_LABELS"]);
      const [proposta] = (await repos.propostas.pendentesDaConversa(conversaId)).filter((p) => p.kind === "acesso");
      expect(proposta).toBeUndefined();
      const decisoes = await trx<{ id: string; estado: string; desfecho: { tipo: string; regra: string; regraVersao: number } | null }[]>`select id, estado, desfecho from decisoes where conversa_id = ${conversaId} and tipo = 'acesso'`;
      expect(decisoes).toHaveLength(1);
      expect(decisoes[0]).toMatchObject({ estado: "decidida", desfecho: { tipo: "decidida_por_regra", regra: "regra:modo_automatico", regraVersao: 2 } });
      expect((await repos.propostas.buscar(decisoes[0]?.id ?? ""))).toMatchObject({ estado: "confirmada", payload: { kind: "acesso", rotinaId: rotina.id } });
      expect((await repos.turnos.listarDaConversa(conversaId, 50)).map((t) => t.id)).toEqual([turnoId]);
      expect((await repos.rotinaExecucoes.listar(rotina.id)).filter((e) => e.desfecho === "bloqueada")).toHaveLength(0);
      const kinds = (await trx<{ kind: string }[]>`select kind from events where conversa_id = ${conversaId}`).map((k) => k.kind);
      expect(kinds).toEqual(expect.arrayContaining(["decisao_decidida", "concessao_criada"]));
      expect(kinds).not.toContain("decisao_criada");
    });
  });
});
