import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { CapacidadeConector } from "../../src/contracts/conector.ts";
import type { Repos } from "../../src/repositories/tipos.ts";
import type { Tx } from "../../src/shared/types.ts";
import { chamarFerramenta } from "../../src/use-cases/chamar-ferramenta.ts";
import { concederLote } from "../../src/use-cases/conceder.ts";
import { assentarAprovacao } from "../../src/use-cases/decidir.ts";
import { decidirAcesso } from "../../src/use-cases/decidir-acesso.ts";
import { pedirABot } from "../../src/use-cases/pedir-a-bot.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { enviarMensagem } from "../../src/use-cases/enviar-mensagem.ts";
import { avisarFalhaDelegacao, entregarRespostaPeer } from "../../src/use-cases/entregar-resposta-peer.ts";
import { pedirAcesso } from "../../src/use-cases/pedir-acesso.ts";
import { pedirAprovacao } from "../../src/use-cases/pedir-aprovacao.ts";
import { varrerPessoa } from "../../src/adapters/fundo/varredor-expiracao.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa, autoriaPessoa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";
import { tarefaDoPedido } from "../helpers/pedido.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const AGORA = Date.parse("2026-09-24T15:00:00Z");
const PRONTO = { estado: "pronto" as const, versao: "t", em: 0 };
const cap = (nome: string, readOnlyHint: boolean): CapacidadeConector => ({ nome, descricao: nome, schema: { type: "object" }, readOnlyHint });

async function conectorGithub(repos: Repos) {
  const criado = await repos.conectores.criar({ nome: "GitHub", slug: "github", transporte: "stdio", comando: "node", declaracao: "nao-toca" });
  const sondado = await repos.conectores.registrarSonda(criado?.id ?? "", { ok: true, catalogo: [cap("pr_ver", true), cap("pr_comentar", false), cap("pr_revisar", false), cap("pr_merge", false)], agora: AGORA });
  if (!sondado) throw new Error("conector");
  return sondado;
}

/** Taga pede ao Dev 1 a partir da fala de Marlon (pedir_a_bot, ADR-058); o GitHub existe, concedido a quem cada teste disser. */
async function cenario(trx: Tx, pedido = "Taga, pede ao Dev 1 para revisar o PR 466") {
  const taga = await agenteComConversa(trx, MARLON, { nome: "Taga" });
  const dev1 = await agenteComConversa(trx, MARLON, { nome: "Dev 1" });
  const { deps, repos, chamadas } = depsSobre(trx, MARLON, { agora: () => AGORA });
  for (const a of [taga, dev1]) await repos.agentes.atualizarPerfil(a.agenteId, { confirmado: true });
  const github = await conectorGithub(repos);
  const { data } = await enviarMensagem(deps, { conversaId: taga.conversaId, texto: pedido, inventario: PRONTO });
  const delegar = () => pedirABot(deps, { turnoId: data.turno.id, agenteId: taga.agenteId, conversaId: taga.conversaId, agente: "Dev 1", pedido: "revisar o PR 466", contexto: "pull/466" });
  return { taga, dev1, deps, repos, chamadas, github, turnoTaga: data.turno, delegar };
}

describeIntegracao("pedir_a_bot — revisão independente (ADR-047, revista na ADR-058)", () => {
  it("[1] ADR-066: aprovar PR e merge pela chamada direta seguem o modo de quem recebe — no manual pedem a pessoa, mesmo com a concessão de escrita; no automático comentar, aprovar PR e merge rodam", async () => {
    await withRollback(MARLON, async (trx) => {
      const { dev1, deps, chamadas, github, delegar } = await cenario(trx);
      await concederLote(deps, { agenteId: dev1.agenteId, conectorId: github.id, capacidades: ["pr_ver", "pr_comentar", "pr_revisar", "pr_merge"], autorTipo: "pessoa" });
      const { data } = await delegar();
      const plano = (await emitirPlanoTurno(deps, { turnoId: tarefaDoPedido(data), machineId: randomUUID(), executor: "catcher" })).data;
      expect(plano.confiancaEntrada).toBe("confiavel");
      expect(Object.keys(plano.politicaExecucao).sort()).toEqual(["orcamentoResultadoChars", "prazoMs"]);
      const chamar = (nome: string) => chamarFerramenta(deps, { turnoId: tarefaDoPedido(data), agenteId: dev1.agenteId, nome, argumentos: {}, plano });
      // Manual: aprovar PR e merge nunca viram "Sempre permitir" (nuncaPermanente) e pedem a pessoa toda vez.
      for (const nome of ["github__pr_revisar", "github__pr_merge"]) expect((await chamar(nome)).data, nome).toMatchObject({ ok: false, negacao: { motivo: "alcance_insuficiente" } });
      expect(chamadas.conectores).toEqual([]);
      // Automático: antes desta ADR, aprovar PR e merge eram negados na chamada direta em todo modo (só por item
      // aprovado), e o modelo dava a volta até o pedir_aprovacao. Agora passam pela decisão do card, e nem aprovar nem
      // fazer merge de PR são ação arriscada — saem sozinhos também no pedido de colega, onde ninguém pediu na conversa.
      await deps.repos.agentes.definirModoAprovacao(dev1.agenteId, "automatico");
      for (const nome of ["github__pr_comentar", "github__pr_revisar", "github__pr_merge"]) expect((await chamar(nome)).data, nome).toMatchObject({ ok: true });
      expect(chamadas.conectores.map((c) => c.tool)).toEqual(["pr_comentar", "pr_revisar", "pr_merge"]);
    });
  });

  it("[2] ADR-058/066: o que quem pede leu antes (conector, computador, pasta, sessão retomada, resposta de bot) não reduz o catálogo de quem recebe; o app de fora que ele leu faz o turno de quem recebe nascer marcado, e no automático isso não para", async () => {
    await withRollback(MARLON, async (trx) => {
      const { taga, dev1, deps, repos, chamadas, github, turnoTaga, delegar } = await cenario(trx, "resume meus e-mails e pede ao Dev 1 para responder o que for de PR");
      await concederLote(deps, { agenteId: taga.agenteId, conectorId: github.id, capacidades: ["pr_ver"], autorTipo: "pessoa" });
      await concederLote(deps, { agenteId: dev1.agenteId, conectorId: github.id, capacidades: ["pr_ver", "pr_comentar"], autorTipo: "pessoa" });
      const planoTaga = (await emitirPlanoTurno(deps, { turnoId: turnoTaga.id, machineId: randomUUID(), executor: "catcher" })).data;
      expect((await chamarFerramenta(deps, { turnoId: turnoTaga.id, agenteId: taga.agenteId, nome: "github__pr_ver", argumentos: {}, plano: planoTaga })).data).toMatchObject({ ok: true, confianca: "nao_confiavel" });
      // ADR-066: o GitHub está fora da curadoria de conteúdo interno — lê-lo marca o turno de quem lê.
      expect(await repos.turnos.contaminado(turnoTaga.id)).toBe(true);
      await repos.trilha.registrar({ agenteId: taga.agenteId, turnoId: turnoTaga.id, ferramenta: "computador_observar", kind: "tool_call", regra: "regra:chamar_ferramenta", regraVersao: 1 });
      await repos.mensagens.criar({ conversaId: taga.conversaId, autoria: { ...autoriaPessoa(PESSOA_MARLON), autor_tipo: "agente", autor_id: dev1.agenteId }, kind: "peer_ask", texto: "resposta antiga de colega", confianca: "nao_confiavel" });
      await repos.conversas.atualizarSessaoCli(taga.conversaId, randomUUID(), "catcher");

      const { data } = await delegar();
      expect(await repos.turnos.buscar(tarefaDoPedido(data))).toMatchObject({ origem: "delegacao", entradaConfianca: "confiavel", sobProcuracaoDe: PESSOA_MARLON });
      const plano = (await emitirPlanoTurno(deps, { turnoId: tarefaDoPedido(data), machineId: randomUUID(), executor: "catcher" })).data;
      expect(plano.catalogo.ferramentas.map((f) => f.nome)).toEqual(expect.arrayContaining(["pedir_acesso", "pedir_aprovacao", "github__pr_ver", "github__pr_comentar"]));
      expect(Object.keys(plano.politicaExecucao).sort()).toEqual(["orcamentoResultadoChars", "prazoMs"]);
      // No lugar da trava herdada: a marca de quem pediu passa a quem recebe — só pesa no manual.
      expect(await repos.turnos.contaminado(tarefaDoPedido(data))).toBe(true);
      await repos.agentes.definirModoAprovacao(dev1.agenteId, "automatico");
      expect((await chamarFerramenta(deps, { turnoId: tarefaDoPedido(data), agenteId: dev1.agenteId, nome: "github__pr_comentar", argumentos: {}, plano })).data).toMatchObject({ ok: true });
      expect(chamadas.conectores.map((c) => c.tool)).toEqual(["pr_ver", "pr_comentar"]);
    });
  });

  it("[4] entrega uma vez por raiz: o turno original e a retomada da aprovação não entregam duas vezes", async () => {
    await withRollback(MARLON, async (trx) => {
      const { taga, dev1, deps, repos, delegar } = await cenario(trx);
      const { data } = await delegar();
      await repos.turnos.assentar(tarefaDoPedido(data), { estado: "concluido" });
      const primeira = await entregarRespostaPeer(deps, { tarefaId: tarefaDoPedido(data), texto: "Revisei." });
      expect("mensagem" in primeira.data).toBe(true);
      const retomada = await repos.turnos.enfileirar({ executor: "catcher", conversaId: dev1.conversaId, agenteId: dev1.agenteId, origem: "retomada", prazoEm: AGORA + 60_000, profundidade: 1, entradaTexto: "aprovação decidida", entradaConfianca: "confiavel", modelo: "m", retomaTurnoId: tarefaDoPedido(data), sobProcuracaoDe: PESSOA_MARLON });
      await repos.turnos.assentar(retomada?.id ?? "", { estado: "concluido" });
      expect((await entregarRespostaPeer(deps, { tarefaId: retomada?.id ?? "", texto: "Revisei de novo." })).data).toEqual({ ignorado: "ja_entregue" });
      expect((await repos.mensagens.listarDaConversa(taga.conversaId)).filter((m) => m.kind === "peer_ask")).toHaveLength(1);
    });
  });

  it("[5] pedido pendente em QUALQUER turno da cadeia segura a entrega, não só no turno que assentou", async () => {
    await withRollback(MARLON, async (trx) => {
      const { dev1, deps, repos, delegar } = await cenario(trx);
      const { data } = await delegar();
      await pedirAcesso(deps, { turnoId: tarefaDoPedido(data), conversaId: dev1.conversaId, agenteId: dev1.agenteId, conector: "github", capacidades: ["pr_ver"], nivel: "leitura", nao_pedido: [] });
      await repos.turnos.assentar(tarefaDoPedido(data), { estado: "concluido" });
      const irma = await repos.turnos.enfileirar({ executor: "catcher", conversaId: dev1.conversaId, agenteId: dev1.agenteId, origem: "retomada", prazoEm: AGORA + 60_000, profundidade: 1, entradaTexto: "continua", entradaConfianca: "confiavel", modelo: "m", retomaTurnoId: tarefaDoPedido(data), sobProcuracaoDe: PESSOA_MARLON });
      await repos.turnos.assentar(irma?.id ?? "", { estado: "concluido" });
      expect((await entregarRespostaPeer(deps, { tarefaId: irma?.id ?? "", texto: "Parcial" })).data).toEqual({ ignorado: "aguardando_pessoa" });
    });
  });

  it("[6] fail-closed: além do teto de saltos a retomada continua delegação (sem --resume da conversa); a retomada da aprovação mantém profundidade e confiança", async () => {
    await withRollback(MARLON, async (trx) => {
      const { dev1, deps, repos, delegar } = await cenario(trx);
      await repos.conversas.atualizarSessaoCli(dev1.conversaId, randomUUID(), "catcher");
      const { data } = await delegar();
      let anterior = tarefaDoPedido(data);
      for (let i = 0; i < 12; i++) {
        const t = await repos.turnos.enfileirar({ executor: "catcher", conversaId: dev1.conversaId, agenteId: dev1.agenteId, origem: "retomada", prazoEm: AGORA + 60_000, profundidade: 0, entradaTexto: "de novo", entradaConfianca: "confiavel", modelo: "m", retomaTurnoId: anterior, sobProcuracaoDe: PESSOA_MARLON });
        await repos.turnos.assentar(t?.id ?? "", { estado: "concluido" });
        anterior = t?.id ?? "";
      }
      const plano = await emitirPlanoTurno(deps, { turnoId: anterior, machineId: randomUUID(), executor: "catcher" });
      expect(plano.events?.[0]?.dados.modo).toBe("delegacao");
      expect(plano.data.entrada.sessaoCli).toBeNull();
      expect(plano.data.catalogo.ferramentas.map((f) => f.nome)).not.toContain("criar_rotina");

      const d = await repos.decisoes.criar({ tipo: "aprovacao", agenteId: dev1.agenteId, conversaId: dev1.conversaId, turnoId: tarefaDoPedido(data), prazoDecisaoEm: AGORA + 86_400_000, frase: "Comentar no PR" });
      await trx`update turnos set entrada_confianca = 'nao_confiavel' where id = ${tarefaDoPedido(data)}`;
      const r = await assentarAprovacao(deps, { decisaoId: d?.id ?? "", desfechos: [] });
      expect(await repos.turnos.buscar(r.data.turnoRetomadaId ?? "")).toMatchObject({ origem: "retomada", profundidade: 1, entradaConfianca: "nao_confiavel", sobProcuracaoDe: PESSOA_MARLON });
    });
  });

  it("[8] acesso recusado ou turno interrompido: o remetente recebe UM aviso curto; o resultado posterior ainda sai", async () => {
    await withRollback(MARLON, async (trx) => {
      const { taga, dev1, deps, repos, delegar } = await cenario(trx);
      const { data } = await delegar();
      const pedido = await pedirAcesso(deps, { turnoId: tarefaDoPedido(data), conversaId: dev1.conversaId, agenteId: dev1.agenteId, conector: "github", capacidades: ["pr_ver"], nivel: "leitura", nao_pedido: [] });
      await repos.turnos.assentar(tarefaDoPedido(data), { estado: "concluido" });
      await decidirAcesso(deps, { decisaoId: pedido.data.proposta_id, recusar: true, executor: "catcher" });
      const avisos = () => repos.mensagens.listarDaConversa(taga.conversaId).then((ms) => ms.filter((m) => m.payload?.kind === "peer_ask" && m.payload.falhou));
      const [aviso] = await avisos();
      expect(aviso?.texto).toMatch(/^Dev 1 não concluiu: .* não permitiu o acesso a github$/);
      expect(aviso?.payload).toMatchObject({ kind: "peer_ask", tarefaId: tarefaDoPedido(data), delegada: true, falhou: true });

      // Um segundo motivo (o turno parou) não repete o aviso.
      await repos.turnos.interromper(tarefaDoPedido(data), "parado_pela_pessoa");
      expect((await avisarFalhaDelegacao(deps, { turnoId: tarefaDoPedido(data), motivo: "você pediu para parar" })).data).toEqual({ ignorado: "ja_entregue" });
      expect(await avisos()).toHaveLength(1);
      // A pessoa retoma e a tarefa conclui: o resultado sai mesmo depois do aviso.
      const retomada = await repos.turnos.enfileirar({ executor: "catcher", conversaId: dev1.conversaId, agenteId: dev1.agenteId, origem: "retomada", prazoEm: AGORA + 60_000, profundidade: 1, entradaTexto: "retome", entradaConfianca: "confiavel", modelo: "m", retomaTurnoId: tarefaDoPedido(data), sobProcuracaoDe: PESSOA_MARLON });
      await repos.turnos.assentar(retomada?.id ?? "", { estado: "concluido" });
      expect("mensagem" in (await entregarRespostaPeer(deps, { tarefaId: retomada?.id ?? "", texto: "Revisei." })).data).toBe(true);
    });
  });

  it("merge/review liberados só pelo readOnlyHint do catálogo: CHECK_…_MERGED (leitura declarada) roda; LIST_REVIEWS sem a declaração é tratada como escrita", async () => {
    await withRollback(MARLON, async (trx) => {
      const { dev1, deps, repos, chamadas, delegar } = await cenario(trx);
      const criado = await repos.conectores.criar({ nome: "GitHub (Composio)", slug: "github-composio", transporte: "stdio", comando: "node", declaracao: "nao-toca" });
      const conector = await repos.conectores.registrarSonda(criado?.id ?? "", { ok: true, catalogo: [cap("GITHUB_CHECK_IF_A_PULL_REQUEST_HAS_BEEN_MERGED", true), cap("GITHUB_LIST_REVIEWS_FOR_A_PULL_REQUEST", false)], agora: AGORA });
      await concederLote(deps, { agenteId: dev1.agenteId, conectorId: conector?.id ?? "", capacidades: ["GITHUB_CHECK_IF_A_PULL_REQUEST_HAS_BEEN_MERGED", "GITHUB_LIST_REVIEWS_FOR_A_PULL_REQUEST"], autorTipo: "pessoa" });
      const { data } = await delegar();
      const plano = (await emitirPlanoTurno(deps, { turnoId: tarefaDoPedido(data), machineId: randomUUID(), executor: "catcher" })).data;
      const chamar = (nome: string) => chamarFerramenta(deps, { turnoId: tarefaDoPedido(data), agenteId: dev1.agenteId, nome: `github-composio__${nome}`, argumentos: {}, plano });
      expect((await chamar("GITHUB_CHECK_IF_A_PULL_REQUEST_HAS_BEEN_MERGED")).data).toMatchObject({ ok: true });
      expect((await chamar("GITHUB_LIST_REVIEWS_FOR_A_PULL_REQUEST")).data).toMatchObject({ ok: false, negacao: { motivo: "alcance_insuficiente" } });
      expect(chamadas.conectores.map((c) => c.tool)).toEqual(["GITHUB_CHECK_IF_A_PULL_REQUEST_HAS_BEEN_MERGED"]);
    });
  });

  it("pedir_aprovacao exige concessão do AGENTE: ferramenta só no catálogo do conector é recusada", async () => {
    await withRollback(MARLON, async (trx) => {
      const { dev1, deps, github, delegar } = await cenario(trx);
      const { data } = await delegar();
      const pedir = () => pedirAprovacao(deps, { turnoId: tarefaDoPedido(data), agenteId: dev1.agenteId, conversaId: dev1.conversaId, resumo: "comentar", itens: [{ texto: "comentar", destino: { conector: "github", ferramenta: "pr_comentar", argumentos: {} } }] });
      await expect(pedir()).rejects.toMatchObject({ codigo: "nao_permitido" });
      await concederLote(deps, { agenteId: dev1.agenteId, conectorId: github.id, capacidades: ["pr_comentar"], autorTipo: "pessoa" });
      expect((await pedir()).data).toMatchObject({ estado: "pendente" });
    });
  });

  it("card de conexão sem decisão segura a entrega só até o próprio prazo; depois o varredor avisa o remetente", async () => {
    await withRollback(MARLON, async (trx) => {
      const { taga, dev1, deps, repos, delegar } = await cenario(trx);
      const { data } = await delegar();
      const conexao = await pedirAcesso(deps, { turnoId: tarefaDoPedido(data), conversaId: dev1.conversaId, agenteId: dev1.agenteId, conector: "notion", capacidades: [], nivel: "leitura", nao_pedido: [] });
      expect(await repos.decisoes.buscar(conexao.data.proposta_id)).toBeNull();
      await repos.turnos.assentar(tarefaDoPedido(data), { estado: "concluido" });
      expect((await avisarFalhaDelegacao(deps, { turnoId: tarefaDoPedido(data), motivo: "x" })).data).toEqual({ ignorado: "aguardando_pessoa" });
      await trx`update propostas set criado_em = ${new Date(AGORA - 1.5 * 86_400_000)} where id = ${conexao.data.proposta_id}`;
      await varrerPessoa(MARLON, (fn) => fn(trx), { services: deps.services, useCases: deps.useCases, agora: () => AGORA });
      const avisos = (await repos.mensagens.listarDaConversa(taga.conversaId)).filter((m) => m.payload?.kind === "peer_ask" && m.payload.falhou);
      expect(avisos.map((m) => m.texto)).toEqual(["Dev 1 não concluiu: o pedido de conexão venceu sem resposta"]);
    });
  });

  it("[8] o pedido de acesso do alvo vence sem resposta: o varredor avisa o remetente", async () => {
    await withRollback(MARLON, async (trx) => {
      const { taga, dev1, deps, repos, delegar } = await cenario(trx);
      const { data } = await delegar();
      await pedirAcesso(deps, { turnoId: tarefaDoPedido(data), conversaId: dev1.conversaId, agenteId: dev1.agenteId, conector: "github", capacidades: ["pr_ver"], nivel: "leitura", nao_pedido: [] });
      await repos.turnos.assentar(tarefaDoPedido(data), { estado: "concluido" });
      await varrerPessoa(MARLON, (fn) => fn(trx), { services: deps.services, useCases: deps.useCases, agora: () => AGORA + 30 * 86_400_000 });
      const avisos = (await repos.mensagens.listarDaConversa(taga.conversaId)).filter((m) => m.payload?.kind === "peer_ask" && m.payload.falhou);
      expect(avisos.map((m) => m.texto)).toEqual(["Dev 1 não concluiu: o pedido de acesso venceu sem resposta"]);
    });
  });
});
