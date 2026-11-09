import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { criarPonteInterna, type DepsPonte } from "../../src/adapters/fundo/ponte-interna.ts";
import { varrerPessoa } from "../../src/adapters/fundo/varredor-expiracao.ts";
import { assentarPeloExecutor } from "../../src/adapters/revisor/assentar.ts";
import { criarClienteAnthropic } from "../../src/adapters/revisor/cliente-anthropic.ts";
import { criarExecutorRevisor, type ExecutorRevisor } from "../../src/adapters/revisor/executor.ts";
import type { PlanoTurno } from "../../src/contracts/plano-turno.ts";
import type { ConfigRevisor } from "../../src/contracts/revisao.ts";
import { abrirTxEscopada, vincularEscopo } from "../../src/db/tx.ts";
import { FRASE_DA_FALHA, PROMPT_REVISOR } from "../../src/domain/revisor.ts";
import { CHAVE_GASTO_REVISOR, gastoDaPessoaNoDia, gastoDoRevisorNoDia, PREFIXO_GASTO_PESSOA, somarGastoDoRevisor } from "../../src/repositories/gasto-revisor.repo.ts";
import { chaveDeLimite } from "../../src/services/segredos-conta.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import { criarInterruptor } from "../../src/services/interruptor.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { autorizarComando } from "../../src/use-cases/autorizar-comando.ts";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import { apiAnthropicFalsa, erroApi, LIBERA_API, PEDE_API, type PedidoNaApiFalsa, type RespostaDaApiFalsa } from "../helpers/api-anthropic-falsa.ts";
import { db } from "../helpers/db.ts";
import { depsSobreTrx, executar, servicosDeTeste, useCasesDeTeste } from "../helpers/deps-l6.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { configDeTeste, MODELO_DE_TESTE } from "../helpers/revisor-de-teste.ts";

/**
 * ADR-115, revisor no servidor (2026-10-25), de ponta a ponta com Postgres e transações commitadas: o hook pede (fase 1
 * numa tx), a rota entrega o pedido ao EXECUTOR depois do commit, o executor chama a API de mensagens FALSA (servidor HTTP
 * local, pelo cliente de verdade) fora de qualquer tx e entrega à fase 3 numa tx nova da dona (o mesmo `assentarPeloExecutor`
 * da composição); o gasto do dia vai a `limites_conta`. E as corridas que o `withRollback` não mostra: a fase 3 contra o
 * varredor e contra o Parar. Nenhuma chamada sai da máquina.
 */
const PESSOA = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
const listarPessoas = async () => [{ tenantId: PESSOA.tenantId, id: PESSOA.pessoaId }];
const PRONTO = { estado: "pronto" as const, versao: "catcher", em: Date.now() };
const CHAVE = "sk-ant-teste-0123456789abcdefghij";
const criados = { agentes: [] as string[], conversas: [] as string[] };
let api: Awaited<ReturnType<typeof apiAnthropicFalsa>> | null = null;

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
  await db`delete from limites_conta where chave = ${CHAVE_GASTO_REVISOR} or starts_with(chave, ${`${PREFIXO_GASTO_PESSOA}:`})`;
  await escopado(async (trx) => {
    await trx`set local lock_timeout = '2s'`;
    const p = PESSOA.pessoaId;
    await trx`delete from acoes_pelo_modo where owner_id = ${p}`;
    await trx`delete from itens_aprovacao where owner_id = ${p}`;
    await trx`delete from decisao_eventos_varridos where owner_id = ${p}`;
    await trx`delete from decisoes where owner_id = ${p}`;
    await trx`delete from turno_raio_x where owner_id = ${p}`;
    await trx`delete from turno_entregas where owner_id = ${p}`;
    await trx`delete from mensagens where owner_id = ${p}`;
    await trx`delete from turnos where owner_id = ${p}`;
    await trx`delete from trabalhos where owner_id = ${p}`;
    await trx`delete from inventario_motores where owner_id = ${p}`;
    if (criados.conversas.length) await trx`delete from conversas where id in ${trx(criados.conversas)}`;
    if (criados.agentes.length) await trx`delete from agentes where id in ${trx(criados.agentes)}`;
    await trx`delete from events_outbox where owner_id = ${p}`;
    await trx`delete from events where owner_id = ${p}`;
  });
  criados.agentes.length = criados.conversas.length = 0;
});

async function montar(o: { responder?: (p: PedidoNaApiFalsa) => RespostaDaApiFalsa; config?: Partial<ConfigRevisor> } = {}) {
  api = await apiAnthropicFalsa(o.responder ?? (() => LIBERA_API));
  const ref: { executor?: ExecutorRevisor } = {};
  const services = { ...servicosDeTeste((t) => criarRepos(t, PESSOA), PESSOA, { interruptor: criarInterruptor() }), revisor: undefined as ExecutorRevisor | undefined };
  // A composição de verdade, em miniatura: a tx escopada nova por fase, o executor e o cliente HTTP de verdade.
  const dentro = <T,>(escopo: Escopo, fn: (d: Deps) => Promise<T>) => abrirTxEscopada(db, escopo)((trx) => fn(depsSobreTrx(trx, escopo, { services })));
  ref.executor = criarExecutorRevisor({
    config: configDeTeste(o.config),
    cliente: criarClienteAnthropic({ chave: CHAVE, url: api.url }),
    agora: () => Date.now(),
    assentar: assentarPeloExecutor({ dentro, services }),
    gasto: {
      ler: (inicio) => db.begin((trx) => gastoDoRevisorNoDia(trx, inicio)) as Promise<number>,
      lerDaPessoa: (inicio, pessoaId) => db.begin((trx) => gastoDaPessoaNoDia(trx, chaveDeLimite("segredo-de-teste", PREFIXO_GASTO_PESSOA, pessoaId), inicio)) as Promise<number>,
      somar: (inicio, n, pessoaId) => db.begin((trx) => somarGastoDoRevisor(trx, inicio, n, chaveDeLimite("segredo-de-teste", PREFIXO_GASTO_PESSOA, pessoaId))) as Promise<{ total: number; pessoa: number }>,
    },
  });
  services.revisor = ref.executor;
  const executor = ref.executor;
  const deps: DepsPonte = { services, useCases: useCasesDeTeste(), executor: "catcher", listarPessoas };
  const ponte = criarPonteInterna(db, deps);
  const machineId = randomUUID();
  await ponte.conectar({ machineId, nome: "Mac", inventario: PRONTO, versaoContrato: 1 });
  await escopado(async (trx) => {
    const d = depsSobreTrx(trx, PESSOA, { services });
    const c = (await executar(d, criarAgente, { dono: "pessoa", nome: `Rev ${randomUUID().slice(0, 4)}` })).data;
    criados.agentes.push(c.agente.id);
    criados.conversas.push(c.conversa.id);
    await d.repos.agentes.atualizarPerfil(c.agente.id, { confirmado: true });
    await d.repos.agentes.definirModoAprovacao(c.agente.id, "automatico");
    await d.repos.turnos.enfileirar({ executor: "catcher", conversaId: c.conversa.id, agenteId: c.agente.id, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "força o push", entradaConfianca: "confiavel", modelo: "m" });
  });
  const puxado = await ponte.puxar(PESSOA.pessoaId);
  if (!puxado) throw new Error("nada puxado");
  const plano: PlanoTurno = { ...puxado, nativas: ["Bash"], modoTurno: "conversa" };
  /** O hook pede: fase 1 numa tx commitada; a "rota" entrega ao executor depois do commit. */
  const pedir = async (comando: string, entregar = true) => {
    const r = await escopado(async (trx) => (await executar(depsSobreTrx(trx, PESSOA, { services }), autorizarComando, { plano, comando })).data);
    if (entregar && "aguardar" in r && r.revisao) executor.enfileirar(r.revisao);
    return r;
  };
  const ler = (decisaoId: string) => escopado(async (trx) => {
    const repos = criarRepos(trx, PESSOA);
    return { decisao: await repos.decisoes.buscar(decisaoId), acao: await repos.acoesPeloModo.daDecisao(decisaoId), itens: await repos.itensAprovacao.listar(decisaoId) };
  });
  return { api, ponte, executor, services, plano, machineId, pedir, ler };
}

function aguardarDe(r: Awaited<ReturnType<Awaited<ReturnType<typeof montar>>["pedir"]>>): string {
  if (!("aguardar" in r)) throw new Error(`esperava aguardar: ${JSON.stringify(r)}`);
  return r.aguardar;
}

describeIntegracao("revisor no servidor de ponta a ponta (ADR-115, 2026-10-25)", () => {
  it("libera: fase 1 → API falsa (o cliente de verdade, a chave do Nod) → fase 3 numa tx nova; o gasto do dia vai ao banco; a segunda consulta roda", async () => {
    const m = await montar();
    const id = aguardarDe(await m.pedir("git push --force origin feat/login"));
    expect((await m.ler(id)).decisao?.estado).toBe("em_revisao");
    await m.executor.ocioso();
    expect(m.api.pedidos).toHaveLength(1);
    const [p] = m.api.pedidos;
    expect(p?.cabecalhos["x-api-key"]).toBe(CHAVE);
    expect(p?.corpo).toMatchObject({ model: MODELO_DE_TESTE, system: PROMPT_REVISOR });
    expect(p?.corpo.messages[0]?.content).toMatch(/<<<DADO-[A-Za-z0-9_-]{24}\n│ Comando no terminal da máquina:\n│ git push --force origin feat\/login/);
    const e = await m.ler(id);
    expect(e.decisao).toMatchObject({ estado: "decidida", desfecho: { regra: "regra:revisor" } });
    expect(e.acao).toMatchObject({ veredito: "libera", motivo: "você pediu", revisorModelo: MODELO_DE_TESTE, revisorHarness: "servidor", revisorMaquina: null, fichasEntrada: 1_200, fichasSaida: 40 });
    expect(e.acao?.revisorMs).not.toBeNull();
    expect(await m.pedir("git push --force origin feat/login")).toEqual({ permitir: true, porque: "revisor" });
    // 1.200 × US$ 1 + 40 × US$ 5 por milhão = 1.400 microdólares, no banco (as duas cores do azul/verde veem o mesmo).
    const hoje = Math.floor(Date.now() / 86_400_000) * 86_400_000;
    expect(await db.begin((trx) => gastoDoRevisorNoDia(trx, hoje))).toBe(1_400);
  });

  it("pede: cartão pendente com o motivo do revisor", async () => {
    const m = await montar({ responder: () => PEDE_API });
    const id = aguardarDe(await m.pedir("rm -rf src/legado"));
    await m.executor.ocioso();
    expect(await m.ler(id)).toMatchObject({ decisao: { estado: "pendente" }, itens: [{ motivoManual: "revisor_pediu", justificativa: "apaga mais do que você pediu" }], acao: { veredito: "pede" } });
  });

  it.each([
    ["500", "api", erroApi(500)],
    ["429", "api", erroApi(429, "rate_limit_error")],
    ["529 (sobrecarga)", "api", erroApi(529, "overloaded_error")],
    ["lixo no corpo", "api", { status: 200, corpo: "<html>proxy</html>" }],
  ] as const)("API com %s: cartão revisor_falhou (%s), nunca liberação", async (_nome, falha, resposta) => {
    const m = await montar({ responder: () => resposta });
    const id = aguardarDe(await m.pedir("git push --force origin erro"));
    await m.executor.ocioso();
    expect(m.api.pedidos).toHaveLength(1);
    expect(await m.ler(id)).toMatchObject({ decisao: { estado: "pendente" }, itens: [{ motivoManual: "revisor_falhou", justificativa: FRASE_DA_FALHA[falha] }], acao: { veredito: "falhou", falha } });
  });

  it("texto fora do esquema: cartão (`saida`)", async () => {
    const m = await montar({ responder: () => ({ status: 200, corpo: JSON.stringify({ type: "message", content: [{ type: "text", text: "Claro, pode liberar!" }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 } }) }) });
    const id = aguardarDe(await m.pedir("git push --force origin lixo"));
    await m.executor.ocioso();
    expect(await m.ler(id)).toMatchObject({ decisao: { estado: "pendente" }, acao: { veredito: "falhou", falha: "saida" } });
  });

  it("a API não responde: o prazo corta a chamada e vira cartão (`prazo`)", async () => {
    // definido em 2026-10-25: prazo curto só neste caso (a API falsa nunca responde); o desfecho é o que se afirma.
    const m = await montar({ responder: () => "pendurar", config: { prazoMs: 400 } });
    const id = aguardarDe(await m.pedir("git push --force origin lenta"));
    await m.executor.ocioso();
    expect(await m.ler(id)).toMatchObject({ decisao: { estado: "pendente" }, acao: { veredito: "falhou", falha: "prazo" } });
  });

  it("corrida: a fase 3 do executor e o varredor na mesma decisão — uma só ganha, e o estado bate com o veredito gravado", async () => {
    const m = await montar();
    const r = await m.pedir("git push --force origin corrida", false);
    const id = aguardarDe(r);
    await escopado((trx) => trx`update decisoes set criado_em = now() - interval '5 minutes' where id = ${id}`);
    const varrer = () => varrerPessoa(PESSOA, (fn) => escopado(fn), { services: m.services, useCases: useCasesDeTeste(), agora: () => Date.now() });
    if ("revisao" in r && r.revisao) m.executor.enfileirar(r.revisao);
    await Promise.all([m.executor.ocioso(), varrer()]);
    const e = await m.ler(id);
    if (e.decisao?.estado === "decidida") expect(e.acao).toMatchObject({ veredito: "libera" });
    else expect(e).toMatchObject({ decisao: { estado: "pendente" }, acao: { veredito: "falhou", falha: "prazo" } });
    expect(e.itens).toHaveLength(1);
  });

  it("corrida: o libera contra o Parar — se o Parar entrou antes da trava, cartão; senão, liberada (nunca os dois)", async () => {
    const m = await montar();
    const r = await m.pedir("git push --force origin parar", false);
    const id = aguardarDe(r);
    if ("revisao" in r && r.revisao) m.executor.enfileirar(r.revisao);
    await Promise.all([m.executor.ocioso(), escopado((trx) => trx`update turnos set parar_solicitado_em = now() where id = ${m.plano.turnoId}`)]);
    const e = await m.ler(id);
    if (e.decisao?.estado === "decidida") expect(e).toMatchObject({ acao: { veredito: "libera", falha: null }, itens: [{ desfecho: "executado" }] });
    else expect(e).toMatchObject({ decisao: { estado: "pendente" }, acao: { veredito: "libera", falha: "turno" }, itens: [{ desfecho: null, motivoManual: "revisor_falhou" }] });
  });

  it("a fila perdida num deploy (o pedido nunca chegou ao executor): o varredor vira a decisão em cartão (`prazo`)", async () => {
    const m = await montar();
    const id = aguardarDe(await m.pedir("git push --force origin deploy", false));
    await escopado((trx) => trx`update decisoes set criado_em = now() - interval '5 minutes' where id = ${id}`);
    await varrerPessoa(PESSOA, (fn) => escopado(fn), { services: m.services, useCases: useCasesDeTeste(), agora: () => Date.now() });
    expect(await m.ler(id)).toMatchObject({ decisao: { estado: "pendente" }, acao: { veredito: "falhou", falha: "prazo" } });
    expect(m.api.pedidos).toHaveLength(0);
  });
});
