import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi, type MockInstance } from "vitest";
import type { ChamadaRevisor, ResultadoCliente } from "../../src/adapters/revisor/cliente-anthropic.ts";
import type { ModoAprovacao } from "../../src/contracts/agente.ts";
import type { CapacidadeConector } from "../../src/contracts/conector.ts";
import { FERRAMENTAS_NOD } from "../../src/contracts/ferramentas-nod.ts";
import type { FerramentaPlano, PlanoTurno } from "../../src/contracts/plano-turno.ts";
import { NATIVA_MCP_DA_PESSOA, NATIVAS_DO_TERMINAL } from "../../src/domain/nativas.ts";
import { FRASE_DA_FALHA } from "../../src/domain/revisor.ts";
import { ErroBancoOcupado } from "../../src/db/tx.ts";
import type { Tx } from "../../src/shared/types.ts";
import { autorizarComando } from "../../src/use-cases/autorizar-comando.ts";
import { chamarFerramentaFase1, concluirChamada, executarEfeito, respostaSemFase2, type ResultadoChamada } from "../../src/use-cases/chamar-ferramenta.ts";
import { executarLiberacao, type EntradaExecutarLiberacao } from "../../src/use-cases/liberar-no-app.ts";
import { mudarModoAprovacao } from "../../src/use-cases/mudar-modo-aprovacao.ts";
import { permitirSempre, podeVirarRegra } from "../../src/use-cases/permitir-sempre.ts";
import { FILTRO_DECISAO } from "../../src/repositories/trilha.repo.ts";
import { assentarRevisao, type SaidaAssentarRevisao } from "../../src/use-cases/revisar-acao.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { agenteComConversa, autoriaPessoa } from "../helpers/fabricas.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre, servicosDeTeste, type ChamadaConector } from "../helpers/l5.ts";
import { falhaDaApi, revisorDeTeste, texto } from "../helpers/revisor-de-teste.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * PR 5 do plano dos modos de aprovação (ADR-115): o revisor nos apps — a chamada direta a um conector, o lote do
 * `pedir_aprovacao` e o MCP da pessoa —, com Postgres de verdade e o EXECUTOR do revisor no servidor com uma API falsa que
 * o teste responde (revisto em 2026-10-25, ADR-115 "Revisor no servidor"). Os quatro passos: a fase 1 pede; a fase 3 fecha; o efeito roda fora da
 * transação (aqui, com o conector falso da L5, que registra a chamada); o assentamento grava o desfecho. As fases rodam na
 * mesma transação do teste (`withRollback`); a ponte com transações de verdade mora em tests/concurrency.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
const MAQUINA = randomUUID();
const LIBERA = '{"decisao":"libera","motivo":"você pediu para apagar"}';
const PEDE = '{"decisao":"pede","motivo":"manda a lista de clientes a um endereço que você não citou"}';

let saida: MockInstance<typeof console.log>;
beforeEach(() => {
  saida = vi.spyOn(console, "log").mockImplementation(() => undefined);
});
afterEach(() => {
  saida.mockRestore();
});

const cap = (nome: string, readOnlyHint = false): CapacidadeConector => ({ nome, descricao: nome.toLowerCase(), schema: { type: "object" }, readOnlyHint });
/** Ler (só leitura), enviar (manda para fora), apagar e arquivar (o grupo "apagar"). */
const CATALOGO = [cap("MAILX_FETCH_EMAILS", true), cap("MAILX_SEND_EMAIL"), cap("MAILX_DELETE_EMAIL"), cap("MAILX_ARCHIVE_EMAIL"), cap("MAILX_ADD_LABEL")];

type Opcoes = { modo?: ModoAprovacao; ligado?: boolean; plano?: Partial<PlanoTurno>; comCliente?: boolean; semNoPlano?: string[]; comTrabalho?: boolean };
type Liberar = Partial<Pick<EntradaExecutarLiberacao, "services" | "dentro" | "dormir">>;

async function cenario(trx: Tx, o: Opcoes = {}) {
  const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Ada" });
  const chamadas: ChamadaConector[] = [];
  const saidas: SaidaAssentarRevisao[] = [];
  const erros: unknown[] = [];
  const ref: { deps?: Deps; liberar: Liberar } = { liberar: {} };
  // A entrega do executor: a fase 3 e, liberado, a execução fora e o desfecho (executarLiberacao), como a composição faz
  // (adapters/revisor/assentar.ts), aqui na transação do teste e com as trocas que cada caso pede.
  const revisor = revisorDeTeste({
    config: { ligado: o.ligado ?? true },
    ...(o.comCliente === false ? { comCliente: false } : {}),
    async assentar(p) {
      try {
        const d = ref.deps!;
        const r = await assentarRevisao(d, { decisaoId: p.decisaoId, resultado: p.resultado });
        if (r.events?.length) await repos.events.gravarComOutbox(r.events);
        saidas.push(r.data);
        if (r.data.lote) await executarLiberacao({ escopo: MARLON, services: d.services, lote: r.data.lote, dentro: (fn) => fn(d), ...ref.liberar });
      } catch (e) {
        erros.push(e);
        throw e;
      }
    },
  });
  const deps: Deps = depsSobre(repos, MARLON, { services: { ...servicosDeTeste({ chamadas }), revisor: revisor.executor }, trx });
  ref.deps = deps;
  const slug = `mailx-${randomUUID().slice(0, 8)}`;
  const conector = await repos.conectores.criar({ nome: "Mailx", slug, transporte: "stdio", comando: "node", declaracao: "toca" });
  const sondado = await repos.conectores.registrarSonda(conector?.id ?? "", { ok: true, catalogo: CATALOGO, agora: Date.now() });
  if (!sondado) throw new Error("conector");
  await repos.conectores.habilitar(sondado.id, true);
  const consentimento = await repos.mensagens.criar({ conversaId, autoria: autoriaPessoa(MARLON.pessoaId), kind: "consentimento", texto: "Permitir Mailx", confianca: "confiavel" });
  for (const c of CATALOGO) await repos.concessoes.conceder({ agenteId, conectorId: sondado.id, capacidade: c.nome, mensagemId: consentimento?.id ?? "" });
  await mudarModoAprovacao(deps, { agenteId, modo: o.modo ?? "automatico", confirmado: true });
  await repos.mensagens.criar({ conversaId, autoria: autoriaPessoa(MARLON.pessoaId), kind: "texto", texto: "apaga os e-mails de propaganda da semana", confianca: "confiavel" });
  const trabalho = o.comTrabalho ? await repos.trabalhos.criar({ agenteId, conversaId, titulo: "Limpar a caixa", origem: "pessoa" }) : null;
  const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "apaga os e-mails de propaganda", entradaConfianca: "confiavel", modelo: "m", ...(trabalho ? { trabalhoId: trabalho.id } : {}) });
  if (!turno) throw new Error("turno");
  await trx`update turnos set estado = 'despachando', machine_id = ${MAQUINA}, lease_ate = now() + interval '5 minutes', attempted = true where id = ${turno.id}`;
  const ferramentas: FerramentaPlano[] = [
    { nome: "pedir_aprovacao", nomeMcp: "mcp__nod__pedir_aprovacao", origem: "nod", conectorId: null, readOnlyHint: false, tocaDadoPessoal: false, schema: FERRAMENTAS_NOD.pedir_aprovacao },
    ...CATALOGO.filter((c) => !(o.semNoPlano ?? []).includes(c.nome)).map((c): FerramentaPlano => ({ nome: `${slug}__${c.nome}`, nomeMcp: `mcp__nod__${slug}__${c.nome}`, origem: "conector", conectorId: sondado.id, readOnlyHint: c.readOnlyHint === true, tocaDadoPessoal: false, schema: { type: "object" } })),
  ];
  const plano: PlanoTurno = {
    tenantId: TENANT_PADRAO, turnoId: turno.id, agenteId, conversaId, localidade: "local", machineId: MAQUINA, executor: "local", superficie: "maquina_da_pessoa",
    decididoPor: "regra:montagem-ferramentas", autoria: autoriaPessoa(MARLON.pessoaId), confiancaEntrada: "confiavel", profundidade: 0,
    catalogo: { ferramentas, servidores: [] }, promptSistema: "", entrada: { texto: "apaga os e-mails de propaganda", sessaoCli: null, modelo: "m" },
    politicaExecucao: { prazoMs: 1, orcamentoResultadoChars: 8000 }, semprePermitir: [], tokenDeTurno: "tok",
    expiraEm: Date.now() + 60_000, nativas: [...NATIVAS_DO_TERMINAL, NATIVA_MCP_DA_PESSOA], modoTurno: "conversa", ...o.plano,
  };

  /** O proxy chama a ferramenta pela rota interna: a fase 1; o pedido ao executor depois do "commit"; o efeito fora e a fase 2. */
  const chamar = async (nome: string, argumentos: unknown, p: PlanoTurno = plano): Promise<ResultadoChamada> => {
    const f1 = await chamarFerramentaFase1(deps, { turnoId: p.turnoId, agenteId, nome: nome.includes("__") || nome === "pedir_aprovacao" ? nome : `${slug}__${nome}`, argumentos, plano: p });
    if (f1.events?.length) await repos.events.gravarComOutbox(f1.events);
    const data = f1.data;
    if ("emRevisao" in data) {
      if (data.emRevisao.fila) revisor.executor.enfileirar(data.emRevisao.fila);
      return { aguardar: data.emRevisao.aguardar };
    }
    if (!("efeito" in data)) return data;
    const desfecho = await executarEfeito(deps.services, data.efeito);
    const direto = respostaSemFase2(data.efeito, desfecho);
    if (direto) return direto;
    const f2 = await concluirChamada(deps, { efeito: data.efeito, desfecho });
    if (f2.events?.length) await repos.events.gravarComOutbox(f2.events);
    return f2.data;
  };
  const pedirAprovacao = (itens: { texto: string; ferramenta: string; argumentos?: Record<string, unknown> }[], resumo = "Apagar os e-mails de propaganda") =>
    chamar("pedir_aprovacao", { resumo, itens: itens.map((i) => ({ texto: i.texto, destino: { conector: slug, ferramenta: i.ferramenta, argumentos: i.argumentos ?? {} } })) });
  /** A API falsa responde; o executor assenta (fase 3) e, liberado, executa fora e assenta o desfecho. */
  const revisar = async (responder: (c: ChamadaRevisor) => ResultadoCliente, liberar: Liberar = {}) => {
    ref.liberar = liberar;
    const antes = saidas.length;
    const pedidos = await revisor.revisar(responder);
    ref.liberar = {};
    return { pedidos, saidas: saidas.slice(antes) };
  };
  const naFila = () => revisor.executor.emMemoria().esperando + revisor.executor.emMemoria().emVoo;
  const ler = async (decisaoId: string) => ({ decisao: await repos.decisoes.buscar(decisaoId), itens: await repos.itensAprovacao.listar(decisaoId), acao: await repos.acoesPeloModo.daDecisao(decisaoId) });
  return { trx, repos, deps, naFila, erros, chamadas, slug, conectorId: sondado.id, agenteId, conversaId, turno, trabalho, plano, chamar, pedirAprovacao, revisar, ler };
}

function aguardarDe(r: ResultadoChamada): string {
  if (!("aguardar" in r)) throw new Error(`esperava aguardar, veio ${JSON.stringify(r)}`);
  return r.aguardar;
}

describeIntegracao("revisor nos apps (PR 5 dos modos de aprovação, ADR-115)", () => {
  it("A4, chamada direta: apagar pedido na conversa vai ao revisor (aguardar, nada roda); libera → o app roda fora, o desfecho é assentado e a fala vai à Atividade", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      const id = aguardarDe(await c.chamar("MAILX_DELETE_EMAIL", { id: "m-1" }));
      let e = await c.ler(id);
      expect(e.decisao?.estado).toBe("em_revisao");
      expect(e.itens).toHaveLength(1);
      expect(e.itens[0]).toMatchObject({ destino: { conector: c.slug, ferramenta: "MAILX_DELETE_EMAIL", argumentos: { id: "m-1" } }, motivoManual: "revisor_falhou", sempreServe: true, desfecho: null });
      expect(e.acao).toMatchObject({ tipo: "app", gatilho: "arriscado", risco: "apaga ou arquiva num app", veredito: null, revisorMaquina: null, revisorHarness: "servidor" });
      expect(c.chamadas).toHaveLength(0);
      // Nem a trilha de chamada nem o frame da decisão: nada rodou e a tela não vê a revisão.
      expect(await trx`select 1 from trilha where turno_id = ${c.turno.id} and kind = 'tool_call'`).toHaveLength(0);
      expect(await trx`select 1 from events where turno_id = ${c.turno.id} and kind = 'decisao_criada'`).toHaveLength(0);

      const { pedidos, saidas } = await c.revisar(() => texto(LIBERA));
      expect(pedidos[0]?.entrada).toContain("- apaga os e-mails de propaganda da semana");
      expect(pedidos[0]?.entrada).toMatch(/<<<DADO-[A-Za-z0-9_-]{24}\n/);
      expect(pedidos[0]?.entrada).toContain(`\n│ App ${c.slug}, ferramenta MAILX_DELETE_EMAIL, argumentos: {"id":"m-1"}`);
      expect(saidas[0]).toMatchObject({ estado: "liberada", veredito: "libera", lote: { decisaoId: id, regra: "regra:revisor" } });
      expect(c.chamadas).toEqual([{ conectorId: c.conectorId, tool: "MAILX_DELETE_EMAIL", args: { id: "m-1" } }]);
      e = await c.ler(id);
      expect(e.decisao).toMatchObject({ estado: "decidida", desfecho: { tipo: "decidida_por_regra", regra: "regra:revisor", regraVersao: 1 } });
      expect(e.itens[0]).toMatchObject({ selecionado: true, motivoManual: null, desfecho: "executado" });
      expect(e.acao).toMatchObject({ veredito: "libera", motivo: "você pediu para apagar" });
      // A fala do recibo vai para a Atividade (chat limpo) e diz que foi o revisor; o turno que espera é quem continua.
      const [fala] = await trx<{ texto: string; assunto: string | null }[]>`select texto, assunto from mensagens where conversa_id = ${c.conversaId} and kind = 'resultado_aprovacao'`;
      expect(fala).toMatchObject({ assunto: "aprovacao.automatica" });
      expect(fala?.texto).toContain("Fiz sem perguntar (1 ação) · o revisor liberou");
      const [cont] = await trx<{ continuada_por: string | null }[]>`select continuada_por from decisoes where id = ${id}`;
      expect(cont?.continuada_por).toBe("turno");
    });
  });

  it("pede: o cartão do apagar num turno limpo oferece 'Sempre permitir' (sempreServe); a regra clicada pula o revisor no turno limpo seguinte e não no contaminado", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      const id = aguardarDe(await c.chamar("MAILX_DELETE_EMAIL", { id: "m-2" }));
      await c.revisar(() => texto('{"decisao":"pede","motivo":"apaga um e-mail que não é propaganda"}'));
      const e = await c.ler(id);
      expect(e.decisao?.estado).toBe("pendente");
      expect(e.itens[0]).toMatchObject({ motivoManual: "revisor_pediu", justificativa: "apaga um e-mail que não é propaganda", sempreServe: true });
      expect(podeVirarRegra(e.itens[0]!)).toBe(true);
      expect(c.chamadas).toHaveLength(0);
      expect(await trx`select 1 from events where turno_id = ${c.turno.id} and kind = 'decisao_criada'`).toHaveLength(1);
      expect((await permitirSempre(c.deps, { decisaoId: id, itemIds: [e.itens[0]!.id] })).data.criadas).toHaveLength(1);
      // Turno limpo: a regra da pessoa vem antes do modo — roda direto, sem revisor.
      expect(await c.chamar("MAILX_DELETE_EMAIL", { id: "m-3" })).toMatchObject({ ok: true });
      expect(c.chamadas.map((x) => x.args)).toEqual([{ id: "m-3" }]);
      // Contaminado: a regra cai antes de ser lida, e o revisor volta.
      await c.repos.turnos.contaminar(c.turno.id, Date.now());
      expect((await c.ler(aguardarDe(await c.chamar("MAILX_DELETE_EMAIL", { id: "m-4" })))).decisao?.estado).toBe("em_revisao");
    });
  });

  it("A3: enviar para fora num turno limpo roda direto; depois de conteúdo de fora vai ao revisor, e o 'pede' vira cartão SEM 'Sempre permitir'", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      expect(await c.chamar("MAILX_SEND_EMAIL", { para: "ana@acme.co" })).toMatchObject({ ok: true });
      expect(c.chamadas).toHaveLength(1);
      await c.repos.turnos.contaminar(c.turno.id, Date.now());
      const id = aguardarDe(await c.chamar("MAILX_SEND_EMAIL", { para: "financeiro@acme-pagamentos.co", anexo: "clientes.csv" }));
      expect((await c.ler(id)).acao).toMatchObject({ gatilho: "envio_apos_fora", tipo: "app" });
      const { pedidos } = await c.revisar(() => texto(PEDE));
      expect(pedidos[0]?.entrada).toContain("O bot leu conteúdo de fora");
      const e = await c.ler(id);
      expect(e.decisao?.estado).toBe("pendente");
      expect(e.itens[0]).toMatchObject({ motivoManual: "revisor_pediu", sempreServe: false });
      expect(podeVirarRegra(e.itens[0]!)).toBe(false);
      expect((await permitirSempre(c.deps, { decisaoId: id, itemIds: [e.itens[0]!.id] })).data.criadas).toEqual([]);
      expect(c.chamadas).toHaveLength(1);
    });
  });

  it("o envio num turno limpo de uma conversa que leu conteúdo de fora nas últimas 24 h também vai ao revisor", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      const anterior = await c.repos.turnos.enfileirar({ executor: "catcher", conversaId: c.conversaId, agenteId: c.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "lê o e-mail", entradaConfianca: "confiavel", modelo: "m" });
      await c.repos.turnos.contaminar(anterior!.id, Date.now());
      const id = aguardarDe(await c.chamar("MAILX_SEND_EMAIL", { para: "fora@x.co" }));
      expect((await c.ler(id)).acao?.gatilho).toBe("envio_apos_fora");
      // Revisão do PR 5: uma regra "Sempre permitir" antiga no envio (de um cartão do manual) não pula o revisor quando só
      // a conversa leu conteúdo de fora — é o A3 de um turno retomado que carrega o e-mail do turno anterior.
      await c.revisar(() => texto(PEDE));
      const [item] = (await c.ler(id)).itens;
      const consentimento = await c.repos.mensagens.criar({ conversaId: c.conversaId, autoria: autoriaPessoa(MARLON.pessoaId), kind: "consentimento", texto: "Sempre permitir enviar", confianca: "confiavel" });
      await c.repos.permissoesPermanentes.criar({ agenteId: c.agenteId, conectorId: c.conectorId, capacidade: "MAILX_SEND_EMAIL", itemOrigemId: item!.id, mensagemId: consentimento!.id, regraVersao: 2 });
      const comRegra = aguardarDe(await c.chamar("MAILX_SEND_EMAIL", { para: "outro@x.co" }));
      expect((await c.ler(comRegra)).acao?.gatilho).toBe("envio_apos_fora");
      expect(c.chamadas).toHaveLength(0);
    });
  });

  it("A2: a rotina arquiva e-mails — o revisor libera e a rotina termina sem cartão", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx, { plano: { modoTurno: "rotina" } });
      const id = aguardarDe(await c.chamar("MAILX_ARCHIVE_EMAIL", { ids: ["a", "b", "c"] }));
      const { pedidos } = await c.revisar(() => texto('{"decisao":"libera","motivo":"é o que a rotina pede"}'));
      expect(pedidos[0]?.entrada).toContain("rotina agendada");
      expect((await c.ler(id)).decisao?.estado).toBe("decidida");
      expect(c.chamadas.map((x) => x.tool)).toEqual(["MAILX_ARCHIVE_EMAIL"]);
      expect((await c.repos.decisoes.listarSuaVez(Date.now())).map((d) => d.id)).not.toContain(id);
    });
  });

  it("falha do revisor: cartão revisor_falhou com a frase da causa e sem 'Sempre permitir', mesmo no apagar limpo; nunca roda no erro", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      const id = aguardarDe(await c.chamar("MAILX_DELETE_EMAIL", { id: "m-9" }));
      await c.revisar(() => falhaDaApi(429));
      const e = await c.ler(id);
      expect(e.itens[0]).toMatchObject({ motivoManual: "revisor_falhou", justificativa: FRASE_DA_FALHA.api, sempreServe: false });
      expect(podeVirarRegra(e.itens[0]!)).toBe(false);
      // Liberou, mas o turno parou: cartão, e nada roda (a fase 3 não devolve lote).
      const outra = aguardarDe(await c.chamar("MAILX_DELETE_EMAIL", { id: "m-10" }));
      await trx`update turnos set parar_solicitado_em = now() where id = ${c.turno.id}`;
      const { saidas } = await c.revisar(() => texto(LIBERA));
      expect(saidas[0]).toEqual({ estado: "cartao", veredito: "libera" });
      expect((await c.ler(outra)).itens[0]).toMatchObject({ motivoManual: "revisor_falhou", justificativa: FRASE_DA_FALHA.turno, desfecho: null });
      expect(c.chamadas).toHaveLength(0);
    });
  });

  it("a mesma ação de app depois de 'pede' vai direto ao cartão (repetida), pelo destino; outros argumentos vão ao revisor", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      aguardarDe(await c.chamar("MAILX_DELETE_EMAIL", { id: "x", pasta: "inbox" }));
      await c.revisar(() => texto(PEDE));
      // Mesmos argumentos em outra ordem: a mesma ação (jsonb compara pelo valor).
      const denovo = aguardarDe(await c.chamar("MAILX_DELETE_EMAIL", { pasta: "inbox", id: "x" }));
      expect(await c.ler(denovo)).toMatchObject({ decisao: { estado: "pendente" }, acao: { falha: "repetida", veredito: "nao_revisado" } });
      const outra = aguardarDe(await c.chamar("MAILX_DELETE_EMAIL", { id: "y", pasta: "inbox" }));
      expect((await c.ler(outra)).decisao?.estado).toBe("em_revisao");
    });
  });

  it("pedir_aprovacao: o lote com um item arriscado vai inteiro numa revisão só; libera → os dois itens rodam, um recibo", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      const id = aguardarDe(await c.pedirAprovacao([{ texto: "Apagar a newsletter da Loja X", ferramenta: "MAILX_DELETE_EMAIL", argumentos: { id: "n1" } }, { texto: "Etiquetar como lido", ferramenta: "MAILX_ADD_LABEL", argumentos: { id: "n2" } }], "Limpar a caixa: 1 apagar, 1 etiqueta"));
      const e = await c.ler(id);
      expect(e.decisao).toMatchObject({ estado: "em_revisao", frase: "Limpar a caixa: 1 apagar, 1 etiqueta" });
      expect(e.itens.map((i) => [i.textoOriginal, i.sempreServe])).toEqual([["Apagar a newsletter da Loja X", true], ["Etiquetar como lido", false]]);
      expect(e.acao).toMatchObject({ tipo: "app", gatilho: "arriscado" });
      const { pedidos } = await c.revisar(() => texto(LIBERA));
      expect(pedidos).toHaveLength(1);
      expect(pedidos[0]?.entrada).toContain("Resumo que o bot escreveu: Limpar a caixa: 1 apagar, 1 etiqueta");
      expect(pedidos[0]?.entrada).toContain("2 ações, que rodam juntas ou nenhuma");
      expect(pedidos[0]?.entrada).toContain("O que o bot escreveu no pedido: Apagar a newsletter da Loja X");
      expect(c.chamadas.map((x) => x.tool)).toEqual(["MAILX_DELETE_EMAIL", "MAILX_ADD_LABEL"]);
      expect((await c.ler(id)).itens.map((i) => i.desfecho)).toEqual(["executado", "executado"]);
      expect(await trx`select 1 from mensagens where conversa_id = ${c.conversaId} and kind = 'resultado_aprovacao'`).toHaveLength(1);
    });
  });

  it("pedir_aprovacao: pede → o cartão leva o lote inteiro; lote misto (um item fora do alcance) pergunta tudo sem chamar o revisor", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx, { semNoPlano: ["MAILX_ADD_LABEL"] });
      const id = aguardarDe(await c.pedirAprovacao([{ texto: "Apagar", ferramenta: "MAILX_DELETE_EMAIL" }, { texto: "Enviar resumo", ferramenta: "MAILX_SEND_EMAIL" }]));
      await c.revisar(() => texto(PEDE));
      expect((await c.ler(id)).itens.map((i) => i.motivoManual)).toEqual(["revisor_pediu", "revisor_pediu"]);
      const misto = aguardarDe(await c.pedirAprovacao([{ texto: "Apagar", ferramenta: "MAILX_DELETE_EMAIL", argumentos: { id: "z" } }, { texto: "Etiquetar", ferramenta: "MAILX_ADD_LABEL" }]));
      const e = await c.ler(misto);
      expect(e.decisao?.estado).toBe("pendente");
      expect(e.itens.map((i) => i.motivoManual)).toEqual(["acao_arriscada", "fora_do_catalogo"]);
      expect(e.acao).toBeNull();
      expect(c.naFila()).toBe(0);
      expect(c.chamadas).toHaveLength(0);
    });
  });

  it("Codex: o revisor no servidor vale para ele também (o app e o MCP da pessoa vão ao revisor); sem chave, cartão na hora", async () => {
    await withRollback(MARLON, async (trx) => {
      const codex = await cenario(trx, { plano: { harness: "codex-cli" } });
      const id = aguardarDe(await codex.chamar("MAILX_DELETE_EMAIL", { id: "c" }));
      expect((await codex.ler(id)).decisao?.estado).toBe("em_revisao");
      await codex.revisar(() => texto(LIBERA));
      expect(await codex.ler(id)).toMatchObject({ decisao: { estado: "decidida", desfecho: { regra: "regra:revisor" } }, itens: [{ desfecho: "executado" }] });
      // O MCP da pessoa no Codex (ADR-103): envio depois de conteúdo de fora → revisor, como no Claude.
      await codex.repos.turnos.contaminar(codex.turno.id, Date.now());
      const mcp = await autorizarComando(codex.deps, { plano: codex.plano, mcp: "gmail.send {\"para\":\"fora@x.co\"}" });
      if (!("aguardar" in mcp.data)) throw new Error("esperava aguardar");
      expect(mcp.data.revisao).toBeTruthy();
      expect((await codex.repos.decisoes.buscar(mcp.data.aguardar))?.estado).toBe("em_revisao");
      const semChave = await cenario(trx, { comCliente: false });
      expect((await semChave.ler(aguardarDe(await semChave.pedirAprovacao([{ texto: "Apagar", ferramenta: "MAILX_DELETE_EMAIL" }])))).itens[0]).toMatchObject({ justificativa: FRASE_DA_FALHA.sem_revisor, sempreServe: false });
    });
  });

  it("sem pedido ao executor (sem chave), o cartão que nasce pendente põe a task em 'precisa de você' na hora — na chamada direta e no pedir_aprovacao; em revisão, não", async () => {
    await withRollback(MARLON, async (trx) => {
      const estadoDa = async (c: Awaited<ReturnType<typeof cenario>>) => (await c.repos.trabalhos.buscar(c.trabalho!.id))?.estado;
      const direta = await cenario(trx, { comCliente: false, comTrabalho: true });
      aguardarDe(await direta.chamar("MAILX_DELETE_EMAIL", { id: "c" }));
      expect(await estadoDa(direta)).toBe("precisa_de_voce");
      const lote = await cenario(trx, { comCliente: false, comTrabalho: true });
      aguardarDe(await lote.pedirAprovacao([{ texto: "Apagar", ferramenta: "MAILX_DELETE_EMAIL" }]));
      expect(await estadoDa(lote)).toBe("precisa_de_voce");
      // Em revisão a tela não vê nada: a task só muda se o revisor pedir.
      const emRevisao = await cenario(trx, { comTrabalho: true });
      aguardarDe(await emRevisao.chamar("MAILX_DELETE_EMAIL", { id: "r" }));
      expect(await estadoDa(emRevisao)).not.toBe("precisa_de_voce");
    });
  });

  it("liberar no app: o app que falha vira falhou_na_execucao, sem reenvio; o banco ocupado repete só a escrita; esgotado, o item fica sem desfecho (o risco aceito)", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      // O app falha: a decisão fecha por regra:revisor e o desfecho diz a verdade (nunca "executado").
      let tentativas = 0;
      const quebrado = { ...c.deps.services, conectores: { ...c.deps.services.conectores, async chamar() { tentativas += 1; throw new Error("app fora do ar"); } } };
      const falhou = aguardarDe(await c.chamar("MAILX_DELETE_EMAIL", { id: "f-1" }));
      await c.revisar(() => texto(LIBERA), { services: quebrado });
      expect(tentativas).toBe(1);
      expect(await c.ler(falhou)).toMatchObject({ decisao: { estado: "decidida", desfecho: { regra: "regra:revisor" } }, itens: [{ desfecho: "falhou_na_execucao" }] });

      // Banco ocupado duas vezes no assentamento: repete só a escrita, o app roda uma vez.
      let ocupado = 2;
      const dentro: EntradaExecutarLiberacao["dentro"] = (fn) => (ocupado-- > 0 ? Promise.reject(new ErroBancoOcupado("c", 100)) : fn(c.deps));
      const repetiu = aguardarDe(await c.chamar("MAILX_DELETE_EMAIL", { id: "f-2" }));
      await c.revisar(() => texto(LIBERA), { dentro, dormir: async () => undefined });
      expect(c.chamadas.filter((k) => k.args["id"] === "f-2")).toHaveLength(1);
      expect((await c.ler(repetiu)).itens).toMatchObject([{ desfecho: "executado" }]);

      // Esgotou as tentativas: relança (a composição loga), o app rodou uma vez e o item fica liberado sem desfecho (ADR-115,
      // risco aceito).
      const esgotou = aguardarDe(await c.chamar("MAILX_DELETE_EMAIL", { id: "f-3" }));
      await c.revisar(() => texto(LIBERA), { dentro: () => Promise.reject(new ErroBancoOcupado("c", 100)), dormir: async () => undefined });
      expect(c.erros.at(-1)).toBeInstanceOf(ErroBancoOcupado);
      expect(c.chamadas.filter((k) => k.args["id"] === "f-3")).toHaveLength(1);
      expect(await c.ler(esgotou)).toMatchObject({ decisao: { estado: "decidida" }, itens: [{ desfecho: null }] });
    });
  });

  it("gh do Mac (ADR-048): o item liberado que roda na máquina fica sem desfecho e espera o Mac puxar, sem chamar o conector do servidor", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      const plano = { ...c.plano, catalogo: { ...c.plano.catalogo, ferramentas: c.plano.catalogo.ferramentas.map((f) => (f.nome.endsWith("MAILX_DELETE_EMAIL") ? { ...f, execucao: "maquina" as const } : f)) } };
      const id = aguardarDe(await c.chamar("MAILX_DELETE_EMAIL", { id: "gh" }, plano));
      await c.revisar(() => texto(LIBERA));
      expect(c.chamadas).toHaveLength(0);
      const e = await c.ler(id);
      expect(e.decisao?.estado).toBe("decidida");
      expect(e.itens[0]).toMatchObject({ desfecho: null, destino: { execucao: "maquina" } });
      expect((await c.repos.itensAprovacao.pendentesNaMaquina()).map((x) => x.item.id)).toContain(e.itens[0]!.id);
      // NOD-70: a autorização do revisor vai à trilha na hora, antes de o Mac puxar (que o relato não grava outra está provado em github-conector.test.ts).
      expect((await trx<{ ferramenta: string; regra: string; motivo: string }[]>`select ferramenta, regra, motivo from trilha where turno_id = ${c.turno.id} and kind = 'tool_call' and motivo = 'item_de_aprovacao'`).map((l) => [l.ferramenta, l.regra])).toEqual([[`${c.slug}__MAILX_DELETE_EMAIL`, "regra:revisor"]]);
    });
  });

  it("chave DESLIGADA: a decisão de hoje nos apps (apagar na conversa roda, fora dela é a negação de sempre, envio contaminado roda), sem revisão nem linha em acoes_pelo_modo", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx, { ligado: false });
      expect(await c.chamar("MAILX_DELETE_EMAIL", { id: "1" })).toMatchObject({ ok: true });
      await c.repos.turnos.contaminar(c.turno.id, Date.now());
      expect(await c.chamar("MAILX_SEND_EMAIL", { para: "fora@x.co" })).toMatchObject({ ok: true });
      // O lote do apagar pedido na conversa sai sozinho pelo modo, como hoje (emenda de 30/09 da ADR-059).
      expect(await c.pedirAprovacao([{ texto: "Apagar", ferramenta: "MAILX_DELETE_EMAIL", argumentos: { id: "2" } }])).toMatchObject({ ok: true, conteudo: expect.stringContaining("\"desfecho\":\"executado\"") });
      expect(c.chamadas.map((x) => x.tool)).toEqual(["MAILX_DELETE_EMAIL", "MAILX_SEND_EMAIL", "MAILX_DELETE_EMAIL"]);
      const rotina = await cenario(trx, { ligado: false, plano: { modoTurno: "rotina" } });
      expect(await rotina.chamar("MAILX_DELETE_EMAIL", { id: "3" })).toMatchObject({ ok: false, negacao: { motivo: "alcance_insuficiente" } });
      const card = aguardarDe(await rotina.pedirAprovacao([{ texto: "Apagar", ferramenta: "MAILX_DELETE_EMAIL", argumentos: { id: "3" } }]));
      expect(await rotina.ler(card)).toMatchObject({ decisao: { estado: "pendente" }, itens: [{ motivoManual: "acao_arriscada" }], acao: null });
      expect((await rotina.ler(card)).itens[0]?.sempreServe).toBeUndefined();
      expect(c.naFila() + rotina.naFila()).toBe(0);
      expect(await c.repos.acoesPeloModo.doTurno(c.turno.id)).toEqual([]);
    });
  });

  it("NOD-70: cada caminho dos apps grava a sua regra e o seu motivo na trilha (leitura, Automático, Total, revisor libera/pede/falha, lote misto)", async () => {
    await withRollback(MARLON, async (trx) => {
      const trilha = async (c: Awaited<ReturnType<typeof cenario>>, desde = 0) =>
        (await trx<{ ferramenta: string; kind: string; motivo: string | null; regra: string }[]>`
          select ferramenta, kind, motivo, regra from trilha where agente_id = ${c.agenteId} and ${trx.unsafe(FILTRO_DECISAO)} order by em, id`)
          .slice(desde)
          .map((l) => [l.ferramenta.split("__")[1] ?? l.ferramenta, l.kind, l.motivo, l.regra]);

      const c = await cenario(trx);
      // Escrita comum no Automático, turno limpo: a regra do modo.
      expect(await c.chamar("MAILX_ADD_LABEL", { id: "e-1" })).toMatchObject({ ok: true });
      expect(await trilha(c)).toEqual([["MAILX_ADD_LABEL", "tool_call", null, "regra:modo_automatico"]]);

      // O revisor libera: o lote fecha por regra:revisor (uma linha por item, sem cartão).
      let n = (await trilha(c)).length;
      aguardarDe(await c.chamar("MAILX_DELETE_EMAIL", { id: "r-1" }));
      await c.revisar(() => texto(LIBERA));
      expect(await trilha(c, n)).toEqual([["MAILX_DELETE_EMAIL", "tool_call", "item_de_aprovacao", "regra:revisor"]]);

      // O revisor pede: cartão com revisor_pediu.
      n = (await trilha(c)).length;
      aguardarDe(await c.chamar("MAILX_DELETE_EMAIL", { id: "r-2" }));
      await c.revisar(() => texto(PEDE));
      expect(await trilha(c, n)).toEqual([["MAILX_DELETE_EMAIL", "cartao", "revisor_pediu", "regra:cartao"]]);

      // O revisor falha: cartão com revisor_falhou.
      n = (await trilha(c)).length;
      aguardarDe(await c.chamar("MAILX_DELETE_EMAIL", { id: "r-3" }));
      await c.revisar(() => falhaDaApi(429));
      expect(await trilha(c, n)).toEqual([["MAILX_DELETE_EMAIL", "cartao", "revisor_falhou", "regra:cartao"]]);

      // Leitura de app (por último: ela contamina o turno): não passa pela decisão, grava a regra da consulta.
      n = (await trilha(c)).length;
      expect(await c.chamar("MAILX_FETCH_EMAILS", {})).toMatchObject({ ok: true });
      expect(await trilha(c, n)).toEqual([["MAILX_FETCH_EMAILS", "tool_call", null, "regra:consulta_sem_decisao"]]);

      // Total, mesmo contaminado: a regra do modo Total.
      const total = await cenario(trx, { modo: "total" });
      await total.repos.turnos.contaminar(total.turno.id, Date.now());
      expect(await total.chamar("MAILX_DELETE_EMAIL", { id: "t" })).toMatchObject({ ok: true });
      expect(await trilha(total)).toEqual([["MAILX_DELETE_EMAIL", "tool_call", null, "regra:modo_total"]]);

      // Lote misto: o item que sairia sozinho para no cartão com lote_misto; o outro leva o seu motivo.
      const misto = await cenario(trx, { semNoPlano: ["MAILX_SEND_EMAIL"] });
      aguardarDe(await misto.pedirAprovacao([{ texto: "Etiquetar", ferramenta: "MAILX_ADD_LABEL" }, { texto: "Enviar", ferramenta: "MAILX_SEND_EMAIL" }]));
      // As linhas do lote têm o mesmo instante: a ordem é a do id (aleatório), então compara ordenado.
      expect((await trilha(misto)).sort()).toEqual([
        ["MAILX_ADD_LABEL", "cartao", "lote_misto", "regra:cartao"],
        ["MAILX_SEND_EMAIL", "cartao", "fora_do_catalogo", "regra:cartao"],
      ]);
    });
  });

  it("chave LIGADA não muda o manual nem o total nos apps", async () => {
    await withRollback(MARLON, async (trx) => {
      const manual = await cenario(trx, { modo: "manual" });
      expect(await manual.chamar("MAILX_DELETE_EMAIL", { id: "1" })).toMatchObject({ ok: false, negacao: { motivo: "alcance_insuficiente" } });
      const total = await cenario(trx, { modo: "total" });
      await total.repos.turnos.contaminar(total.turno.id, Date.now());
      expect(await total.chamar("MAILX_DELETE_EMAIL", { id: "1" })).toMatchObject({ ok: true });
      expect(await total.chamar("MAILX_SEND_EMAIL", { para: "fora@x.co" })).toMatchObject({ ok: true });
      expect(manual.naFila() + total.naFila()).toBe(0);
    });
  });
});
