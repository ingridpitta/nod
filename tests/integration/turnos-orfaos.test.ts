import { randomBytes, randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { varrerPessoa } from "../../src/adapters/fundo/varredor-expiracao.ts";
import type { Turno } from "../../src/contracts/turno.ts";
import { criarMetricas } from "../../src/obs/metricas.ts";
import type { Repos } from "../../src/repositories/tipos.ts";
import type { Transacao, Tx } from "../../src/shared/types.ts";
import { assentarTurno } from "../../src/use-cases/assentar-turno.ts";
import { dispararRotina } from "../../src/use-cases/disparar-rotina.ts";
import { pedirABot } from "../../src/use-cases/pedir-a-bot.ts";
import { cuidarDosTurnosOrfaos, type TurnosObservados } from "../../src/use-cases/turnos-orfaos.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa, autoriaAgente } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";
import { comoPedidoDeAntes, tarefaDoPedido } from "../helpers/pedido.ts";

/**
 * NOD-219 (plano da Ada, D1–D3): o varredor encerra só o pendente IMPOSSÍVEL de rodar (agente excluído, geração antiga),
 * com o UPDATE condicional do repositório; o despachando, a ligação e a volta marcada ficam intactos; o pendente velho
 * que ainda pode sair só é observado (log + métrica), no máximo 1×/h. O relógio é o real: `criado_em` nasce de now().
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const H = 3_600_000;

async function pendente(repos: Repos, conversaId: string, agenteId: string, agora: number): Promise<Turno> {
  const t = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: agora + 24 * H, profundidade: 0, entradaTexto: "faz isso", entradaConfianca: "confiavel", modelo: "sonnet" });
  if (!t) throw new Error("turno não enfileirado");
  return t;
}

const subirGeracao = (trx: Tx, agenteId: string) => trx`update agentes set geracao_execucao = geracao_execucao + 1 where id = ${agenteId}`;
/** A exclusão "por fora" (sem `agentes.excluir`, que já interrompe os pendentes): o turno que escapou dela. */
const excluirPorFora = (trx: Tx, agenteId: string) => trx`update agentes set excluido_em = now() where id = ${agenteId}`;
const envelhecer = (trx: Tx, turnoId: string, agora: number) => trx`update turnos set criado_em = ${new Date(agora - 30 * H)}, prazo_em = ${new Date(agora - 6 * H)} where id = ${turnoId}`;

describeIntegracao("turnos órfãos na fila (NOD-219): varredor + repositório", () => {
  it("geração antiga: o pendente sai como interrompido, com a linha de sistema e o evento com a causa; a segunda passada não faz nada", async () => {
    await withRollback(MARLON, async (trx) => {
      const agora = Date.now();
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Orfeu" });
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => agora });
      const turno = await pendente(repos, conversaId, agenteId, agora);
      await subirGeracao(trx, agenteId);
      const tx: Transacao = (fn) => fn(trx);
      const opcoes = { services: deps.services, useCases: deps.useCases, agora: () => agora };

      // O bloco roda dentro do varrerPessoa, e o resultado das decisões não muda de forma.
      expect(await varrerPessoa(MARLON, tx, opcoes)).toEqual({ vencidas: [], mensagens: 0, passaramEmBranco: [], pausadas: [] });
      expect(await repos.turnos.buscar(turno.id)).toMatchObject({ estado: "interrompido", motivoInterrupcao: "parado_pela_pessoa", leaseAte: null });
      const sistema = (await repos.mensagens.listarDaConversa(conversaId)).filter((m) => m.kind === "sistema");
      expect(sistema.map((m) => m.texto)).toEqual(["Tirei este pedido da fila: o bot foi reiniciado depois que o pedido entrou na fila, e ele não ia mais sair. Nada foi feito com ele; se ainda precisar, peça de novo."]);
      expect(sistema[0]?.autoria).toMatchObject({ autor_tipo: "agente", autor_id: agenteId, decidido_por: "regra:turno-orfao" });
      const eventos = await trx<{ kind: string; dados: Record<string, unknown> }[]>`select kind, dados from events where turno_id = ${turno.id} order by created_at, kind`;
      expect(eventos.find((e) => e.kind === "turno_interrompido")?.dados).toMatchObject({ motivo: "parado_pela_pessoa", causa: "geracao_antiga", estava: "pendente" });
      expect(eventos.filter((e) => e.kind === "mensagem_criada")).toHaveLength(1);

      await varrerPessoa(MARLON, tx, opcoes);
      expect((await repos.mensagens.listarDaConversa(conversaId)).filter((m) => m.kind === "sistema")).toHaveLength(1);
    });
  });

  it("agente excluído: o pendente encerra com a causa; o despachando do mesmo agente fica intacto (cai pelo lease)", async () => {
    await withRollback(MARLON, async (trx) => {
      const agora = Date.now();
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Ida" });
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => agora });
      const rodando = await pendente(repos, conversaId, agenteId, agora);
      const naFila = await pendente(repos, conversaId, agenteId, agora);
      await trx`update turnos set estado = 'despachando', machine_id = ${randomUUID()}, lease_ate = ${new Date(agora + 60_000)}, attempted = true where id = ${rodando.id}`;
      await excluirPorFora(trx, agenteId);

      const r = await cuidarDosTurnosOrfaos(deps);
      expect(r.data.encerrados).toEqual([{ turnoId: naFila.id, causa: "agente_excluido" }]);
      expect(await repos.turnos.buscar(naFila.id)).toMatchObject({ estado: "interrompido", motivoInterrupcao: "parado_pela_pessoa" });
      expect(await repos.turnos.buscar(rodando.id)).toMatchObject({ estado: "despachando" });
      const textos = (await repos.mensagens.listarDaConversa(conversaId)).filter((m) => m.kind === "sistema").map((m) => m.texto);
      expect(textos).toEqual([expect.stringContaining("o bot foi excluído")]);
      // O UPDATE condicional não pega o despachando, mesmo chamado direto.
      expect(await repos.turnos.encerrarOrfao(rodando.id, agora)).toBeNull();
    });
  });

  it("a volta marcada para mais tarde fica na fila, mesmo com a geração antiga; e o pendente de agente vivo e novo também", async () => {
    await withRollback(MARLON, async (trx) => {
      const agora = Date.now();
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const outro = await agenteComConversa(trx, MARLON);
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => agora });
      const marcada = await pendente(repos, conversaId, agenteId, agora);
      await trx`update turnos set acordar_em = ${new Date(agora + H)} where id = ${marcada.id}`;
      const vivo = await pendente(repos, outro.conversaId, outro.agenteId, agora);
      await subirGeracao(trx, agenteId);

      const r = await cuidarDosTurnosOrfaos(deps);
      expect(r.data.encerrados.map((e) => e.turnoId)).not.toContain(marcada.id);
      expect(r.data.encerrados.map((e) => e.turnoId)).not.toContain(vivo.id);
      expect(r.data.observados.map((e) => e.turnoId)).not.toContain(vivo.id);
      expect(await repos.turnos.buscar(marcada.id)).toMatchObject({ estado: "pendente" });
      expect(await repos.turnos.buscar(vivo.id)).toMatchObject({ estado: "pendente" });
      expect(await repos.turnos.encerrarOrfao(marcada.id, agora)).toBeNull();
      expect(await repos.turnos.encerrarOrfao(vivo.id, agora)).toBeNull();
      // Passada a hora, a volta marcada de um bot de outra geração vira órfã.
      expect(await repos.turnos.encerrarOrfao(marcada.id, agora + H)).toMatchObject({ estado: "interrompido" });
    });
  });

  it("rotina pendente de geração antiga: a execução fica interrompida e nenhuma linha de sistema é escrita", async () => {
    await withRollback(MARLON, async (trx) => {
      const agora = Date.now();
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Rita" });
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => agora });
      const rotina = await repos.rotinas.criar({ agenteId, conversaId, cron: "0 8 * * *", fusoIana: "America/Sao_Paulo", instrucao: "resumo", fonte: "Gmail", entregavel: "resumo", limitesAprovacao: "nada sai sem aprovação", politicaSemDado: "silêncio", proximaExecucao: agora });
      if (!rotina) throw new Error("rotina");
      const disparo = await dispararRotina(deps, { rotina, instanteAgendado: agora, machineId: randomUUID(), executor: "catcher" });
      if (!("turno" in disparo.data)) throw new Error("sem turno");
      const turnoId = disparo.data.turno.id;
      const antes = (await repos.mensagens.listarDaConversa(conversaId)).length;
      await subirGeracao(trx, agenteId);

      const r = await cuidarDosTurnosOrfaos(deps);
      expect(r.data.encerrados).toContainEqual({ turnoId, causa: "geracao_antiga" });
      const execucoes = await repos.rotinaExecucoes.listar(rotina.id);
      expect(execucoes.map((e) => [e.desfecho, e.turnoId])).toEqual([["interrompida", turnoId]]);
      expect(await repos.mensagens.listarDaConversa(conversaId)).toHaveLength(antes);
      // Revisão do PR #307: a interrupção é desta regra, não do varredor de lease.
      const executou = r.events.find((e) => e.kind === "rotina_executou");
      expect(executou?.autoria).toMatchObject({ decidido_por: "regra:turno-orfao" });
    });
  });

  it("pendente velho de agente vivo: observado (log + métrica), nunca encerrado, e no máximo uma vez por hora", async () => {
    await withRollback(MARLON, async (trx) => {
      const agora = Date.now();
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Vel" });
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => agora });
      const turno = await pendente(repos, conversaId, agenteId, agora);
      await envelhecer(trx, turno.id, agora);
      const metricas = criarMetricas();
      const observados: TurnosObservados = new Map();
      const rotulo = { metrica: "turno_velho_na_fila", bloqueio: "condicao_da_maquina", tenant_id: MARLON.tenantId, pessoa_id: MARLON.pessoaId } as const;

      const primeira = await cuidarDosTurnosOrfaos(deps, { observados, metricas });
      expect(primeira.data.observados).toContainEqual({ turnoId: turno.id, bloqueio: "condicao_da_maquina" });
      expect(primeira.data.encerrados.map((e) => e.turnoId)).not.toContain(turno.id);
      const depoisDaPrimeira = metricas.ler(rotulo) ?? 0;
      expect(depoisDaPrimeira).toBeGreaterThanOrEqual(1);

      const segunda = await cuidarDosTurnosOrfaos(deps, { observados, metricas });
      expect(segunda.data.observados.map((o) => o.turnoId)).not.toContain(turno.id);

      const umaHoraDepois = depsSobre(trx, MARLON, { agora: () => agora + H }).deps;
      const terceira = await cuidarDosTurnosOrfaos(umaHoraDepois, { observados, metricas });
      expect(terceira.data.observados).toContainEqual({ turnoId: turno.id, bloqueio: "condicao_da_maquina" });
      expect(metricas.ler(rotulo) ?? 0).toBeGreaterThan(depoisDaPrimeira);
      expect(await repos.turnos.buscar(turno.id)).toMatchObject({ estado: "pendente" });
    });
  });

  it("pendente velho preso atrás de outro da mesma conversa: o bloqueio é a faixa ocupada", async () => {
    await withRollback(MARLON, async (trx) => {
      const agora = Date.now();
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => agora });
      const rodando = await pendente(repos, conversaId, agenteId, agora);
      const preso = await pendente(repos, conversaId, agenteId, agora);
      await trx`update turnos set estado = 'despachando', machine_id = ${randomUUID()}, lease_ate = ${new Date(agora + 60_000)}, attempted = true where id = ${rodando.id}`;
      await envelhecer(trx, preso.id, agora);
      const r = await cuidarDosTurnosOrfaos(deps);
      expect(r.data.observados).toContainEqual({ turnoId: preso.id, bloqueio: "faixa_ocupada" });
    });
  });
});

/** A Ada pede ao Dev (pedir_a_bot) e o turno dela termina: o pedido fica pendente na conversa do Dev. */
async function adaPedeAoDev(trx: Tx) {
  const ada = await agenteComConversa(trx, MARLON, { nome: "Ada" });
  const dev = await agenteComConversa(trx, MARLON, { nome: "Dev" });
  const { deps, repos } = depsSobre(trx, MARLON);
  for (const a of [ada, dev]) await repos.agentes.atualizarPerfil(a.agenteId, { confirmado: true });
  const t = await repos.turnos.enfileirar({ executor: "catcher", conversaId: ada.conversaId, agenteId: ada.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "faça", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli" });
  if (!t) throw new Error("turno");
  const machineId = randomUUID();
  for (let i = 0; i < 10; i++) {
    const r = await repos.turnos.reivindicar({ machineId, agora: Date.now() });
    if (!r || r.id === t.id) break;
  }
  const { data } = await pedirABot(deps, { turnoId: t.id, agenteId: ada.agenteId, conversaId: ada.conversaId, agente: "Dev", pedido: "revise o PR 42" });
  const tarefaId = tarefaDoPedido(data);
  await assentarTurno(deps, { turnoId: t.id, machineId, seqLocal: 1, fala: { tipo: "texto", texto: "Pedi ao Dev." }, resultado: { desfecho: "sucesso", texto: "Pedi ao Dev.", sessaoCli: null, sinais: { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true }, custoUsd: 0, tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [] }, executor: "catcher" });
  const avisosDaAda = async () => (await repos.mensagens.listarDaConversa(ada.conversaId, 500)).filter((m) => m.payload?.kind === "peer_ask");
  return { ada, dev, deps, repos, data, tarefaId, avisosDaAda };
}

describeIntegracao("turnos órfãos na fila (NOD-219, revisão do PR #307): pedido de colega", () => {
  // Revisão: com o colega EXCLUÍDO, o aviso a quem pediu buscava o bot alvo sem os excluídos e lançava `nao_encontrado` —
  // a tx inteira do bloco voltava, a cada passada, e nenhum órfão da pessoa saía (o candidato é o primeiro da fila).
  it("colega excluído: o pedido sai da fila e quem pediu recebe UM aviso de falha, mesmo com o varredor passando duas vezes", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await adaPedeAoDev(trx);
      await excluirPorFora(trx, m.dev.agenteId);
      const tx: Transacao = (fn) => fn(trx);
      const opcoes = { services: m.deps.services, useCases: m.deps.useCases, agora: () => Date.now() };

      await varrerPessoa(MARLON, tx, opcoes);
      expect(await m.repos.turnos.buscar(m.tarefaId)).toMatchObject({ estado: "interrompido", motivoInterrupcao: "parado_pela_pessoa" });
      const avisos = await m.avisosDaAda();
      expect(avisos).toHaveLength(1);
      expect(avisos[0]?.payload).toMatchObject({ kind: "peer_ask", tarefaId: m.tarefaId, falhou: true });

      await varrerPessoa(MARLON, tx, opcoes);
      expect(await m.avisosDaAda()).toHaveLength(1);
    });
  });

  it("colega reiniciado (geração antiga): o pedido sai da fila com UM aviso a quem pediu", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await adaPedeAoDev(trx);
      await subirGeracao(trx, m.dev.agenteId);
      const tx: Transacao = (fn) => fn(trx);
      const opcoes = { services: m.deps.services, useCases: m.deps.useCases, agora: () => Date.now() };
      await varrerPessoa(MARLON, tx, opcoes);
      await varrerPessoa(MARLON, tx, opcoes);
      expect(await m.repos.turnos.buscar(m.tarefaId)).toMatchObject({ estado: "interrompido" });
      expect(await m.avisosDaAda()).toHaveLength(1);
    });
  });

  it("pedido de antes (task de colega): a task sai de `na_fila` e quem pediu recebe UM aviso", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await adaPedeAoDev(trx);
      const colegaId = await comoPedidoDeAntes(trx, m.deps, m.data);
      await excluirPorFora(trx, m.dev.agenteId);
      const tx: Transacao = (fn) => fn(trx);
      const opcoes = { services: m.deps.services, useCases: m.deps.useCases, agora: () => Date.now() };
      await varrerPessoa(MARLON, tx, opcoes);
      await varrerPessoa(MARLON, tx, opcoes);
      expect(await m.repos.turnos.buscar(m.tarefaId)).toMatchObject({ estado: "interrompido" });
      // QA do PR #307: a decisão da TL (D2) é `parado`, não `falhou` — a causa fica no evento.
      expect((await m.repos.trabalhos.buscar(colegaId))?.estado).toBe("parado");
      expect(await m.avisosDaAda()).toHaveLength(1);
    });
  });
});

describeIntegracao("turnos órfãos na fila (NOD-219, revisão do PR #307): passada robusta", () => {
  // Revisão: um candidato que lançava desfazia a tx inteira do bloco — e, como os impossíveis vêm primeiro, o mesmo turno
  // derrubava todas as passadas seguintes. Agora cada um roda num SAVEPOINT (o varredor passa `isolar`).
  it("um candidato que lança volta sozinho (fica pendente) e o outro órfão da mesma passada sai", async () => {
    await withRollback(MARLON, async (trx) => {
      const agora = Date.now();
      const a = await agenteComConversa(trx, MARLON, { nome: "Quebra" });
      const b = await agenteComConversa(trx, MARLON, { nome: "Inteiro" });
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => agora });
      const ta = await pendente(repos, a.conversaId, a.agenteId, agora);
      const tb = await pendente(repos, b.conversaId, b.agenteId, agora);
      await subirGeracao(trx, a.agenteId);
      await subirGeracao(trx, b.agenteId);
      const turnos = deps.repos.turnos;
      // Quebra DEPOIS do UPDATE: prova que o que o candidato já gravou volta junto.
      const quebrado = { ...deps, repos: { ...deps.repos, turnos: { ...turnos, encerrarOrfao: async (id: string, em: number) => {
        const t = await turnos.encerrarOrfao(id, em);
        if (id === ta.id) throw new Error("falha no meio");
        return t;
      } } } };
      const isolar = async <T>(fn: () => Promise<T>): Promise<T> => {
        const caixa: { valor?: T } = {};
        await trx.savepoint(async () => {
          caixa.valor = await fn();
        });
        return caixa.valor as T;
      };

      const r = await cuidarDosTurnosOrfaos(quebrado, { isolar });
      expect(r.data.encerrados.map((e) => e.turnoId)).toEqual([tb.id]);
      expect(await repos.turnos.buscar(ta.id)).toMatchObject({ estado: "pendente" });
      expect(await repos.turnos.buscar(tb.id)).toMatchObject({ estado: "interrompido" });
    });
  });

  // Revisão: com o `limite` da consulta, os observados na última hora voltavam nela e eram pulados depois — os mesmos
  // velhos ocupavam a passada e o seguinte nunca era observado. Agora saem já na consulta (como os adiados do #218).
  it("com limite 1 e dois velhos, a segunda passada observa o segundo", async () => {
    await withRollback(MARLON, async (trx) => {
      const agora = Date.now();
      const a = await agenteComConversa(trx, MARLON, { nome: "Velho1" });
      const b = await agenteComConversa(trx, MARLON, { nome: "Velho2" });
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => agora });
      const ta = await pendente(repos, a.conversaId, a.agenteId, agora);
      const tb = await pendente(repos, b.conversaId, b.agenteId, agora);
      await envelhecer(trx, ta.id, agora);
      await trx`update turnos set criado_em = ${new Date(agora - 29 * H)}, prazo_em = ${new Date(agora - 5 * H)} where id = ${tb.id}`;
      const observados: TurnosObservados = new Map();

      const primeira = await cuidarDosTurnosOrfaos(deps, { observados, limite: 1 });
      expect(primeira.data.observados.map((o) => o.turnoId)).toEqual([ta.id]);
      const segunda = await cuidarDosTurnosOrfaos(deps, { observados, limite: 1 });
      expect(segunda.data.observados.map((o) => o.turnoId)).toEqual([tb.id]);
      // E um observado que vira impossível (agente excluído) volta à consulta e sai, mesmo dentro da hora.
      await excluirPorFora(trx, a.agenteId);
      const terceira = await cuidarDosTurnosOrfaos(deps, { observados, limite: 1 });
      expect(terceira.data.encerrados.map((e) => e.turnoId)).toEqual([ta.id]);
    });
  });
});

/** NOD-314: o bot preso a uma chave que não fala há 24 h. A chave vira o alvo do bot (ADR-090) e o contato é envelhecido. */
async function presoAoMac(trx: Tx, repos: Repos, agenteId: string, agora: number, semContatoHa = 25 * H) {
  const c = await repos.maquinaTokens.criar({ nome: "MacBook do Marlon", prefixo: randomBytes(4).toString("hex"), hash: randomBytes(32) });
  if (!c) throw new Error("chave");
  await repos.agentes.definirMaquina([agenteId], c.id);
  await trx`update maquina_tokens set criado_em = ${new Date(agora - 30 * 24 * H)}, ultimo_uso_em = ${new Date(agora - semContatoHa)} where id = ${c.id}`;
  return c.id;
}
const desdeHa = (trx: Tx, turnoId: string, agora: number, ms: number) => trx`update turnos set criado_em = ${new Date(agora - ms)} where id = ${turnoId}`;

describeIntegracao("turno preso a uma máquina sem contato (NOD-314)", () => {
  it("conversa: 24 h sem contato encerra com maquina_sem_contato, UMA linha com o payload turno_preso; 23h59 fica", async () => {
    await withRollback(MARLON, async (trx) => {
      const agora = Date.now();
      const a = await agenteComConversa(trx, MARLON, { nome: "Preso" });
      const b = await agenteComConversa(trx, MARLON, { nome: "Quase" });
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => agora });
      const mac = await presoAoMac(trx, repos, a.agenteId, agora, 3 * 24 * H);
      await presoAoMac(trx, repos, b.agenteId, agora, 23 * H + 59 * 60_000);
      const preso = await pendente(repos, a.conversaId, a.agenteId, agora);
      const quase = await pendente(repos, b.conversaId, b.agenteId, agora);
      await desdeHa(trx, preso.id, agora, 24 * H);
      await desdeHa(trx, quase.id, agora, 30 * H);

      const r = await cuidarDosTurnosOrfaos(deps);
      expect(r.data.encerrados).toContainEqual({ turnoId: preso.id, causa: "maquina_alvo_sem_contato" });
      expect(r.data.encerrados.map((e) => e.turnoId)).not.toContain(quase.id);
      expect(await repos.turnos.buscar(preso.id)).toMatchObject({ estado: "interrompido", motivoInterrupcao: "maquina_sem_contato", leaseAte: null });
      expect(await repos.turnos.buscar(quase.id)).toMatchObject({ estado: "pendente" });
      const sistema = (await repos.mensagens.listarDaConversa(a.conversaId)).filter((m) => m.kind === "sistema");
      expect(sistema).toHaveLength(1);
      expect(sistema[0]?.texto).toBe("Tirei este pedido da fila: MacBook do Marlon ficou sem contato por mais de 24 h. Nada foi feito com ele.");
      // QA do NOD-314 (achado 2): a IA fixada do turno ("sonnet" → Claude Code) vai junto; o atalho só oferece máquina com conta dela.
      expect(sistema[0]?.payload).toEqual({ kind: "turno_preso", maquinaId: mac, ia: "claude-cli" });
      expect(r.events.find((e) => e.kind === "turno_interrompido" && e.turnoId === preso.id)?.dados).toMatchObject({ motivo: "maquina_sem_contato", causa: "maquina_alvo_sem_contato" });

      await cuidarDosTurnosOrfaos(deps);
      expect((await repos.mensagens.listarDaConversa(a.conversaId)).filter((m) => m.kind === "sistema")).toHaveLength(1);
    });
  });

  it("jornada C: a fala guardada sem IA (negação aguardaIa) espera os 7 dias, não as 24 h — o varredor e o UPDATE condicional", async () => {
    await withRollback(MARLON, async (trx) => {
      const agora = Date.now();
      const a = await agenteComConversa(trx, MARLON, { nome: "Sem IA" });
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => agora });
      await presoAoMac(trx, repos, a.agenteId, agora, 3 * 24 * H);
      const guardado = await pendente(repos, a.conversaId, a.agenteId, agora);
      await repos.mensagens.criar({ conversaId: a.conversaId, turnoId: guardado.id, autoria: autoriaAgente(a.agenteId, PESSOA_MARLON), kind: "negacao", texto: "Recebi. Estou sem IA neste computador…", payload: { kind: "negacao", classe: "plano_ausente", nome: "claude-cli", motivo: "plano_ausente", terminal: false, aguardaIa: true }, confianca: "confiavel" });
      await trx`update turnos set criado_em = ${new Date(agora - 3 * 24 * H)}, prazo_em = ${new Date(agora + 4 * 24 * H)} where id = ${guardado.id}`;

      // QA do PR #693: a consulta já dá ao guardado os 7 dias (não entra como candidato) e leva o fato ao domínio.
      expect((await repos.turnos.orfaosCandidatos(agora)).map((c) => c.id)).not.toContain(guardado.id);
      expect((await repos.turnos.orfaosCandidatos(agora, { ids: [guardado.id] }))[0]).toMatchObject({ id: guardado.id, aguardaIa: true });
      const r = await cuidarDosTurnosOrfaos(deps);
      expect(r.data.encerrados.map((e) => e.turnoId)).not.toContain(guardado.id);
      expect(await repos.turnos.buscar(guardado.id)).toMatchObject({ estado: "pendente" });
      expect(await repos.turnos.encerrarPresoSemContato(guardado.id, agora)).toBeNull();
      // Passados os 7 dias sem contato, sai como qualquer preso.
      expect(await repos.turnos.encerrarPresoSemContato(guardado.id, agora + 4 * 24 * H)).toMatchObject({ estado: "interrompido", motivoInterrupcao: "maquina_sem_contato" });
    });
  });

  it("QA do NOD-314 (achado 3): a retomada presa ganha só o texto — o atalho vai só onde a nota refaz (conversa e sala)", async () => {
    await withRollback(MARLON, async (trx) => {
      const agora = Date.now();
      const a = await agenteComConversa(trx, MARLON, { nome: "Retomada" });
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => agora });
      await presoAoMac(trx, repos, a.agenteId, agora, 3 * 24 * H);
      const t = await repos.turnos.enfileirar({ executor: "catcher", conversaId: a.conversaId, agenteId: a.agenteId, origem: "retomada", prazoEm: agora + 24 * H, profundidade: 0, entradaTexto: "continua", entradaConfianca: "confiavel", modelo: "sonnet" });
      if (!t) throw new Error("turno");
      await desdeHa(trx, t.id, agora, 25 * H);

      const r = await cuidarDosTurnosOrfaos(deps);
      expect(r.data.encerrados).toContainEqual({ turnoId: t.id, causa: "maquina_alvo_sem_contato" });
      const sistema = (await repos.mensagens.listarDaConversa(a.conversaId)).filter((m) => m.kind === "sistema" && m.turnoId === t.id);
      expect(sistema).toHaveLength(1);
      expect(sistema[0]?.texto).toContain("ficou sem contato por mais de 24 h");
      expect(sistema[0]?.payload ?? null).toBeNull();
    });
  });

  it("o Mac que fala no meio (marcarUso) segura o turno; o turno novo atrás de um Mac velho espera 24 h desde que entrou", async () => {
    await withRollback(MARLON, async (trx) => {
      const agora = Date.now();
      const a = await agenteComConversa(trx, MARLON, { nome: "Voltou" });
      const b = await agenteComConversa(trx, MARLON, { nome: "Novo" });
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => agora });
      const mac = await presoAoMac(trx, repos, a.agenteId, agora);
      await presoAoMac(trx, repos, b.agenteId, agora, 3 * 24 * H);
      const ta = await pendente(repos, a.conversaId, a.agenteId, agora);
      const tb = await pendente(repos, b.conversaId, b.agenteId, agora);
      await desdeHa(trx, ta.id, agora, 30 * H);
      await desdeHa(trx, tb.id, agora, 2 * H);
      await repos.maquinaTokens.marcarUso(mac, agora - 60_000);

      const r = await cuidarDosTurnosOrfaos(deps);
      expect(r.data.encerrados.map((e) => e.turnoId)).not.toContain(ta.id);
      expect(r.data.encerrados.map((e) => e.turnoId)).not.toContain(tb.id);
      expect(await repos.turnos.encerrarPresoSemContato(ta.id, agora)).toBeNull();
      expect(await repos.turnos.encerrarPresoSemContato(tb.id, agora)).toBeNull();
      expect(await repos.turnos.encerrarPresoSemContato(tb.id, agora + 22 * H)).toMatchObject({ estado: "interrompido" });
    });
  });

  it("rotina presa: a execução fica nao_rodou/maquina_sem_contato, só com a linha da rotina (NOD-309)", async () => {
    await withRollback(MARLON, async (trx) => {
      const agora = Date.now();
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Rotineira" });
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => agora });
      await presoAoMac(trx, repos, agenteId, agora);
      const rotina = await repos.rotinas.criar({ agenteId, conversaId, cron: "0 8 * * *", fusoIana: "America/Sao_Paulo", instrucao: "resumo", fonte: "Gmail", entregavel: "resumo", limitesAprovacao: "nada sai sem aprovação", politicaSemDado: "silêncio", proximaExecucao: agora });
      if (!rotina) throw new Error("rotina");
      const disparo = await dispararRotina(deps, { rotina, instanteAgendado: agora, machineId: randomUUID(), executor: "catcher" });
      if (!("turno" in disparo.data)) throw new Error("sem turno");
      const turnoId = disparo.data.turno.id;
      await desdeHa(trx, turnoId, agora, 25 * H);
      const antes = (await repos.mensagens.listarDaConversa(conversaId)).length;

      const r = await cuidarDosTurnosOrfaos(deps);
      expect(r.data.encerrados).toContainEqual({ turnoId, causa: "maquina_alvo_sem_contato" });
      const execucoes = await repos.rotinaExecucoes.listar(rotina.id);
      expect(execucoes.map((e) => [e.desfecho, e.motivo, e.turnoId])).toEqual([["nao_rodou", "maquina_sem_contato", turnoId]]);
      // Com o NOD-309 (#436) toda janela 'nao_rodou' ganha a linha da rotina ("Não rodou · …"); a do turno órfão não sai.
      const novas = (await repos.mensagens.listarDaConversa(conversaId)).slice(antes);
      expect(novas.map((m) => m.kind)).toEqual(["rotina_execucao"]);
      expect(novas[0]?.texto).toMatch(/^Não rodou · o computador do bot ficou sem contato/);
    });
  });

  it("pedido de colega preso: UM aviso a quem pediu, mesmo com duas passadas, e o varredor de pedidos parados não retoma", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await adaPedeAoDev(trx);
      const agora = Date.now();
      await presoAoMac(trx, m.repos, m.dev.agenteId, agora);
      await desdeHa(trx, m.tarefaId, agora, 25 * H);
      const tx: Transacao = (fn) => fn(trx);
      const opcoes = { services: m.deps.services, useCases: m.deps.useCases, agora: () => agora };

      await varrerPessoa(MARLON, tx, opcoes);
      expect(await m.repos.turnos.buscar(m.tarefaId)).toMatchObject({ estado: "interrompido", motivoInterrupcao: "maquina_sem_contato" });
      const avisos = await m.avisosDaAda();
      expect(avisos).toHaveLength(1);
      expect(avisos[0]?.payload).toMatchObject({ kind: "peer_ask", tarefaId: m.tarefaId, falhou: true });
      const pendentesDoDev = async () => (await trx<{ n: number }[]>`select count(*)::int as n from turnos where agente_id = ${m.dev.agenteId} and estado = 'pendente'`)[0]?.n;
      expect(await pendentesDoDev()).toBe(0);

      await varrerPessoa(MARLON, tx, opcoes);
      await varrerPessoa(MARLON, tx, { ...opcoes, agora: () => agora + 10 * 60_000 });
      expect(await m.avisosDaAda()).toHaveLength(1);
      expect(await pendentesDoDev()).toBe(0);
    });
  });
});

/**
 * definido em 2026-10-20 (NOD-309, PR 4, emenda da ADR-045): o fundo pendente que a máquina segura antes do despacho —
 * o bot vivo, ninguém puxou. Aos 10 min, UMA linha por cadeia ("fica na fila e retoma quando o Mac voltar") e uma a quem
 * pediu; passadas 24 h, o pedido de colega sai da fila e quem pediu recebe a falha uma vez.
 */
describeIntegracao("NOD-309 (PR 4): o fundo que a máquina segura antes do despacho", () => {
  const atrasar = (trx: Tx, turnoId: string, ms: number) => trx`update turnos set criado_em = now() - ${`${Math.round(ms / 1000)} seconds`}::interval where id = ${turnoId}`;

  it("10 min: o pedido de colega ganha UMA linha na conversa do colega e UMA a quem pediu; a conversa comum não", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await adaPedeAoDev(trx);
      const comum = await pendente(m.repos, m.dev.conversaId, m.dev.agenteId, Date.now());
      await atrasar(trx, m.tarefaId, 11 * 60_000);
      await atrasar(trx, comum.id, 11 * 60_000);
      const primeira = await cuidarDosTurnosOrfaos(m.deps);
      expect(primeira.data.avisados).toEqual([{ turnoId: m.tarefaId, fundo: "colega" }]);
      await cuidarDosTurnosOrfaos(m.deps);
      const doDev = (await m.repos.mensagens.listarDaConversa(m.dev.conversaId)).filter((x) => x.kind === "sistema" && x.texto.includes("fica na fila"));
      expect(doDev.map((x) => x.texto)).toEqual(["O computador do bot está sem contato. Este pedido fica na fila e retoma quando o contato voltar, de onde parou."]);
      expect(doDev[0]?.autoria).toMatchObject({ decidido_por: "regra:fundo-preso" });
      const daAda = (await m.repos.mensagens.listarDaConversa(m.ada.conversaId, 500)).filter((x) => x.texto.includes("fica na fila"));
      expect(daAda).toHaveLength(1);
      expect(await m.repos.turnos.buscar(m.tarefaId)).toMatchObject({ estado: "pendente" });
    });
  });

  it("10 min com uma conta no limite: a nota da cota fala, não esta linha", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await adaPedeAoDev(trx);
      await atrasar(trx, m.tarefaId, 11 * 60_000);
      const conta = randomUUID();
      await trx`insert into contas_ia (tenant_id, owner_id, id, ia, impressao, apelido, posicao, no_limite_ate) values (${TENANT_PADRAO}, ${PESSOA_MARLON}, ${conta}, 'claude-cli', ${"a".repeat(64)}, 'pessoal', 1, now() + interval '1 hour')`;
      const r = await cuidarDosTurnosOrfaos(m.deps);
      expect(r.data.avisados ?? []).toEqual([]);
    });
  });

  it("24 h: o pedido de colega sai da fila ('vencido') e quem pediu recebe a falha UMA vez", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await adaPedeAoDev(trx);
      await atrasar(trx, m.tarefaId, 25 * H);
      const r = await cuidarDosTurnosOrfaos(m.deps);
      expect(r.data.desistidos).toEqual([{ turnoId: m.tarefaId, fundo: "colega" }]);
      await cuidarDosTurnosOrfaos(m.deps);
      expect(await m.repos.turnos.buscar(m.tarefaId)).toMatchObject({ estado: "interrompido", motivoInterrupcao: "vencido" });
      const falhas = (await m.avisosDaAda()).filter((x) => (x.payload as { falhou?: boolean } | null)?.falhou === true);
      expect(falhas).toHaveLength(1);
      const doDev = (await m.repos.mensagens.listarDaConversa(m.dev.conversaId)).filter((x) => x.kind === "sistema" && x.texto.startsWith("Tirei este pedido da fila"));
      expect(doDev.map((x) => x.texto)).toEqual([expect.stringContaining("ficou mais de 24 h esperando o computador do bot")]);
    });
  });
});
