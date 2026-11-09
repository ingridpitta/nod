import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { criarPonteInterna, type DepsPonte } from "../../src/adapters/fundo/ponte-interna.ts";
import { assentarPeloExecutor } from "../../src/adapters/revisor/assentar.ts";
import { criarClienteAnthropic } from "../../src/adapters/revisor/cliente-anthropic.ts";
import { criarExecutorRevisor, type ExecutorRevisor } from "../../src/adapters/revisor/executor.ts";
import type { CapacidadeConector } from "../../src/contracts/conector.ts";
import type { FerramentaPlano, PlanoTurno } from "../../src/contracts/plano-turno.ts";
import { abrirTxEscopada, haTxEscopadaAberta, vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import { criarInterruptor } from "../../src/services/interruptor.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { chamarFerramentaFase1 } from "../../src/use-cases/chamar-ferramenta.ts";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import type { Deps, Services } from "../../src/use-cases/tipos.ts";
import { apiAnthropicFalsa, mensagem, type RespostaDaApiFalsa } from "../helpers/api-anthropic-falsa.ts";
import { db } from "../helpers/db.ts";
import { depsSobreTrx, executar, servicosDeTeste, useCasesDeTeste } from "../helpers/deps-l6.ts";
import { autoriaPessoa } from "../helpers/fabricas.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { configDeTeste } from "../helpers/revisor-de-teste.ts";

/**
 * ADR-115 (PR 5 dos modos de aprovação; revisor no servidor desde 2026-10-25) de ponta a ponta, com Postgres e transações
 * commitadas: os quatro passos do revisor nos apps — a fase 1 da chamada direta numa tx (e o pedido ao executor depois do
 * commit), o executor chama a API de mensagens FALSA (servidor HTTP local, pelo cliente de verdade), a fase 3 FECHA numa tx
 * nova, o app roda com NENHUMA tx aberta e o desfecho é ASSENTADO numa terceira (`assentarPeloExecutor`, o mesmo da
 * composição). As jornadas "rotina arquiva e-mails" (A2) e "e-mail pede envio para fora" (A3).
 */
const PESSOA = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
const listarPessoas = async () => [{ tenantId: PESSOA.tenantId, id: PESSOA.pessoaId }];
const PRONTO = { estado: "pronto" as const, versao: "catcher", em: Date.now() };
const CHAVE = "sk-ant-teste-0123456789abcdefghij";
const LIBERA = mensagem('{"decisao":"libera","motivo":"é o que a rotina pede"}');
const SINAIS = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: false };
const criados = { agentes: [] as string[], conversas: [] as string[], conectores: [] as string[] };
let api: Awaited<ReturnType<typeof apiAnthropicFalsa>> | null = null;
const cap = (nome: string, readOnlyHint = false): CapacidadeConector => ({ nome, descricao: nome.toLowerCase(), schema: { type: "object" }, readOnlyHint });
const CATALOGO = [cap("MAILX_FETCH_EMAILS", true), cap("MAILX_SEND_EMAIL"), cap("MAILX_ARCHIVE_EMAIL")];

async function escopado<T>(fn: (trx: Tx) => Promise<T>): Promise<T> {
  const caixa: { valor?: T } = {};
  await db.begin(async (trx) => {
    await vincularEscopo(trx, PESSOA);
    caixa.valor = await fn(trx);
  });
  return caixa.valor as T;
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await api?.fechar();
  api = null;
  await escopado(async (trx) => {
    await trx`set local lock_timeout = '2s'`;
    const p = PESSOA.pessoaId;
    await trx`delete from acoes_pelo_modo where owner_id = ${p}`;
    await trx`delete from itens_aprovacao where owner_id = ${p}`;
    await trx`delete from decisao_eventos_varridos where owner_id = ${p}`;
    await trx`delete from decisoes where owner_id = ${p}`;
    await trx`delete from turno_raio_x where owner_id = ${p}`;
    await trx`delete from turno_entregas where owner_id = ${p}`;
    await trx`delete from concessoes where owner_id = ${p}`;
    await trx`delete from mensagens where owner_id = ${p}`;
    await trx`delete from turnos where owner_id = ${p}`;
    await trx`delete from trabalhos where owner_id = ${p}`;
    await trx`delete from inventario_motores where owner_id = ${p}`;
    if (criados.conectores.length) await trx`delete from conectores where id in ${trx(criados.conectores)}`;
    if (criados.conversas.length) await trx`delete from conversas where id in ${trx(criados.conversas)}`;
    if (criados.agentes.length) await trx`delete from agentes where id in ${trx(criados.agentes)}`;
    await trx`delete from events_outbox where owner_id = ${p}`;
    await trx`delete from events where owner_id = ${p}`;
  });
  criados.agentes.length = criados.conversas.length = criados.conectores.length = 0;
});

async function montar(o: { modoTurno?: PlanoTurno["modoTurno"]; resposta?: RespostaDaApiFalsa } = {}) {
  api = await apiAnthropicFalsa(() => o.resposta ?? LIBERA);
  /** O app falso: registra a chamada e se havia uma transação escopada aberta na hora (NOD-263: nunca pode haver). */
  const chamadas: { tool: string; args: Record<string, unknown>; txAberta: boolean }[] = [];
  const conectores: Services["conectores"] = {
    async chamar(_id, tool, args) {
      chamadas.push({ tool, args, txAberta: haTxEscopadaAberta() });
      return { conteudo: `ok:${tool}`, isError: false };
    },
    async sondar() {
      return { ok: true, ferramentas: [] };
    },
  };
  const services = { ...servicosDeTeste((t) => criarRepos(t, PESSOA), PESSOA, { interruptor: criarInterruptor() }), conectores, revisor: undefined as ExecutorRevisor | undefined };
  // A composição em miniatura: tx escopada nova por fase, o executor com o cliente HTTP de verdade contra a API falsa.
  const dentro = <T,>(escopo: Escopo, fn: (d: Deps) => Promise<T>) => abrirTxEscopada(db, escopo)((trx) => fn(depsSobreTrx(trx, escopo, { services })));
  const executor = criarExecutorRevisor({ config: configDeTeste(), cliente: criarClienteAnthropic({ chave: CHAVE, url: api.url }), agora: () => Date.now(), assentar: assentarPeloExecutor({ dentro, services }) });
  services.revisor = executor;
  const deps: DepsPonte = { services, useCases: useCasesDeTeste(), executor: "catcher", listarPessoas };
  const ponte = criarPonteInterna(db, deps);
  const machineId = randomUUID();
  await ponte.conectar({ machineId, nome: "Mac", inventario: PRONTO, versaoContrato: 1 });
  const slug = `mailx-${randomUUID().slice(0, 8)}`;
  const { agenteId, conectorId } = await escopado(async (trx) => {
    const d = depsSobreTrx(trx, PESSOA, { services });
    const c = (await executar(d, criarAgente, { dono: "pessoa", nome: `Apps ${randomUUID().slice(0, 4)}` })).data;
    criados.agentes.push(c.agente.id);
    criados.conversas.push(c.conversa.id);
    await d.repos.agentes.atualizarPerfil(c.agente.id, { confirmado: true });
    await d.repos.agentes.definirModoAprovacao(c.agente.id, "automatico");
    const conector = await d.repos.conectores.criar({ nome: "Mailx", slug, transporte: "stdio", comando: "node", declaracao: "toca" });
    const sondado = await d.repos.conectores.registrarSonda(conector!.id, { ok: true, catalogo: CATALOGO, agora: Date.now() });
    await d.repos.conectores.habilitar(sondado!.id, true);
    criados.conectores.push(sondado!.id);
    const consentimento = await d.repos.mensagens.criar({ conversaId: c.conversa.id, autoria: autoriaPessoa(PESSOA.pessoaId), kind: "consentimento", texto: "Permitir Mailx", confianca: "confiavel" });
    for (const k of CATALOGO) await d.repos.concessoes.conceder({ agenteId: c.agente.id, conectorId: sondado!.id, capacidade: k.nome, mensagemId: consentimento?.id ?? "" });
    await d.repos.turnos.enfileirar({ executor: "catcher", conversaId: c.conversa.id, agenteId: c.agente.id, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "arquiva as propagandas", entradaConfianca: "confiavel", modelo: "m" });
    return { agenteId: c.agente.id, conectorId: sondado!.id };
  });
  const puxado = await ponte.puxar(PESSOA.pessoaId);
  if (!puxado) throw new Error("nada puxado");
  const ferramentas: FerramentaPlano[] = CATALOGO.map((k) => ({ nome: `${slug}__${k.nome}`, nomeMcp: `mcp__nod__${slug}__${k.nome}`, origem: "conector", conectorId, readOnlyHint: k.readOnlyHint === true, tocaDadoPessoal: false, schema: { type: "object" } }));
  const plano: PlanoTurno = { ...puxado, catalogo: { ferramentas, servidores: [] }, modoTurno: o.modoTurno ?? "conversa" };
  const renovar = () => ponte.renovar({ turnoId: plano.turnoId, machineId, sinais: SINAIS, eventos: [] });
  /** O proxy chama o app pela rota interna: a fase 1 numa tx commitada e, em revisão, o pedido ao executor depois do commit. */
  const chamar = async (tool: string, argumentos: Record<string, unknown>, entregar = true) => {
    const data = await escopado(async (trx) => (await executar(depsSobreTrx(trx, PESSOA, { services }), chamarFerramentaFase1, { turnoId: plano.turnoId, agenteId, nome: `${slug}__${tool}`, argumentos, plano })).data);
    if (!("emRevisao" in data)) throw new Error(`esperava revisão: ${JSON.stringify(data)}`);
    if (entregar && data.emRevisao.fila) executor.enfileirar(data.emRevisao.fila);
    return { id: data.emRevisao.aguardar, fila: data.emRevisao.fila };
  };
  const ler = (decisaoId: string) => escopado(async (trx) => {
    const repos = criarRepos(trx, PESSOA);
    return { decisao: await repos.decisoes.buscar(decisaoId), acao: await repos.acoesPeloModo.daDecisao(decisaoId), itens: await repos.itensAprovacao.listar(decisaoId) };
  });
  return { ponte, executor, api, plano, renovar, chamar, ler, chamadas };
}

describeIntegracao("revisor nos apps de ponta a ponta (ADR-115, PR 5; revisor no servidor)", () => {
  it("A2: a rotina arquiva e-mails — fase 1 commitada, a API libera, o app roda sem tx aberta e o desfecho fica gravado; nenhum cartão", async () => {
    const m = await montar({ modoTurno: "rotina" });
    expect((await m.renovar()).ativo).toBe(true);
    const { id, fila } = await m.chamar("MAILX_ARCHIVE_EMAIL", { ids: ["p1", "p2"] }, false);
    expect((await m.ler(id)).decisao?.estado).toBe("em_revisao");
    expect(m.chamadas).toHaveLength(0);
    m.executor.enfileirar(fila!);
    await m.executor.ocioso();
    expect(m.api.pedidos).toHaveLength(1);
    expect(m.api.pedidos[0]?.corpo.messages[0]?.content).toContain("rotina agendada");
    expect(m.chamadas).toEqual([{ tool: "MAILX_ARCHIVE_EMAIL", args: { ids: ["p1", "p2"] }, txAberta: false }]);
    const e = await m.ler(id);
    expect(e.decisao).toMatchObject({ estado: "decidida", desfecho: { regra: "regra:revisor" } });
    expect(e.itens).toMatchObject([{ desfecho: "executado", motivoManual: null }]);
    expect(e.acao).toMatchObject({ veredito: "libera", tipo: "app" });
    // O pedido repetido (um deploy que reentregasse) não roda o app de novo: a fase 3 é idempotente.
    m.executor.enfileirar(fila!);
    await m.executor.ocioso();
    expect(m.chamadas).toHaveLength(1);
  });

  it("A3: o e-mail lido pede envio para fora — a API pede e vira cartão; o app não roda", async () => {
    const m = await montar({ resposta: mensagem('{"decisao":"pede","motivo":"o pedido veio do e-mail, não de você"}') });
    await m.renovar();
    await escopado((trx) => criarRepos(trx, PESSOA).turnos.contaminar(m.plano.turnoId, Date.now()));
    const { id } = await m.chamar("MAILX_SEND_EMAIL", { para: "financeiro@acme-pagamentos.co" });
    await m.executor.ocioso();
    expect(m.api.pedidos[0]?.corpo.messages[0]?.content).toContain("O bot leu conteúdo de fora");
    const e = await m.ler(id);
    expect(e.decisao?.estado).toBe("pendente");
    expect(e.itens).toMatchObject([{ motivoManual: "revisor_pediu", justificativa: "o pedido veio do e-mail, não de você", sempreServe: false, desfecho: null }]);
    expect(m.chamadas).toHaveLength(0);
  });

  it("corrida: o libera contra o Parar — liberada e executada, ou cartão sem execução (nunca liberada sem rodar)", async () => {
    const m = await montar();
    await m.renovar();
    const { id, fila } = await m.chamar("MAILX_ARCHIVE_EMAIL", { ids: ["c1"] }, false);
    m.executor.enfileirar(fila!);
    await Promise.all([m.executor.ocioso(), escopado((trx) => trx`update turnos set parar_solicitado_em = now() where id = ${m.plano.turnoId}`)]);
    const e = await m.ler(id);
    if (e.decisao?.estado === "decidida") {
      expect(e.itens).toMatchObject([{ desfecho: "executado" }]);
      expect(m.chamadas).toHaveLength(1);
    } else {
      expect(e).toMatchObject({ decisao: { estado: "pendente" }, itens: [{ desfecho: null, motivoManual: "revisor_falhou" }] });
      expect(m.chamadas).toHaveLength(0);
    }
  });
});
