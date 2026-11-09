import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import type { Agente } from "../../src/contracts/agente.ts";
import type { Computador, ComputadorDto, DriverComputador } from "../../src/contracts/computador.ts";
import type { Conversa } from "../../src/contracts/conversa.ts";
import { FalhaComputador } from "../../src/domain/computador.ts";
import { iniciarVarredorOciosidade, varrerOciosos } from "../../src/adapters/fundo/varredor-ociosidade.ts";
import { lerConhecidos } from "../../scripts/computadores-orfaos.ts";
import type { ResultadoChamada } from "../../src/use-cases/chamar-ferramenta.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorCompleto, type ServidorCompleto } from "../helpers/servidor-completo.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * NOD-170: o computador sem atividade há NOD_COMPUTADOR_OCIOSO_MIN desliga sozinho, pelo servidor completo e
 * com um driver falso. Desligar é só o `parar` (os volumes ficam e `habilitado` não muda); reserva viva, a
 * pessoa no controle ou esperada não desligam; a ação que chega durante o desligamento recebe estado_invalido;
 * e o teto do host (limite_de_computadores) não mexe na saúde.
 */
describeIntegracao("computador ocioso desliga sozinho; o teto do host é neutro para a saúde", () => {
  let srv: ServidorCompleto;
  let bot: { agente: Agente; conversa: Conversa };
  const ligados = new Set<string>();
  const chamadas: string[] = [];
  let segurarParar: Promise<void> | null = null;
  let teto = false;
  const LIMITE = { maximo: 3, ociosoMin: 15 };
  const driver: DriverComputador = {
    ambiente: async () => ({ disponivel: true, motivo: null, limite: LIMITE }),
    estado: async (id) => ({ disponivel: true, ativo: ligados.has(id), motivo: null, limite: LIMITE }),
    iniciar: async (id) => {
      chamadas.push(`iniciar ${id}`);
      if (teto && !ligados.has(id)) throw new FalhaComputador("limite_de_computadores", { detalhe: "3 ligados, máximo 3", limite: LIMITE });
      ligados.add(id);
    },
    parar: async (id) => {
      chamadas.push(`parar ${id}`);
      await segurarParar;
      ligados.delete(id);
    },
    executar: async () => ({ tela: { quadro: "a".repeat(64), imagem: "iVBORw0KGgo=", largura: 1280, altura: 800, titulo: "Teste", url: "https://example.com", texto: "", abas: [] } }),
    ligados: async () => new Set(ligados),
  };
  const QUINZE_MIN = 15 * 60_000;

  beforeAll(async () => {
    srv = await servidorCompleto({ computador: driver, env: { NOD_MODO: "compartilhado" }, intervalos: { orquestradorMs: 3600000, schedulerMs: 3600000, expiracaoMs: 3600000, ociosidadeMs: 3600000 } });
    bot = await srv.json("POST", "agentes", { dono: "pessoa", interativo: true });
    await srv.app.dentro(srv.pessoa, (d) => d.tx(async (trx) => { await trx`update agentes set confirmado = true where id = ${bot.agente.id}`; }));
  }, 30000);
  afterAll(async () => {
    if (!srv) return;
    await srv.fechar();
    await limparPessoaE2E(srv.db, srv.dbDono, srv.pessoa, { agentes: [bot.agente.id], conversas: [bot.conversa.id] });
    await srv.desligar();
  }, 30000);

  const consultar = () => srv.json<ComputadorDto>("GET", `agentes/${bot.agente.id}/computador`);
  const configurar = (operacao: string) => srv.chamar("POST", `agentes/${bot.agente.id}/computador`, { operacao });
  const computadores = () => srv.app.computadores!;
  /** O relógio da ociosidade, sem esperar 15 min: a última atividade vai para `minutos` atrás. */
  const envelhecer = (id: string, minutos: number) => srv.app.dentro(srv.pessoa, (d) => d.tx(async (trx) => {
    await trx`update computadores set ultima_atividade_em = now() - ${`${minutos} minutes`}::interval where id = ${id}`;
  }));
  const linha = async (): Promise<Computador & { ultima: Date }> => srv.app.dentro(srv.pessoa, async (d) => {
    const c = (await d.repos.computadores.buscarVinculo(bot.agente.id))!;
    const [l] = await d.tx((trx) => trx<{ ultima_atividade_em: Date }[]>`select ultima_atividade_em from computadores where id = ${c.id}`);
    return { ...c, ultima: l!.ultima_atividade_em };
  });
  const mudar = (id: string, campos: { controle?: string; ocupadoAte?: Date | null; indisponivel?: Date | null }) => srv.app.dentro(srv.pessoa, (d) => d.tx(async (trx) => {
    if (campos.controle) await trx`update computadores set controle = ${campos.controle} where id = ${id}`;
    if (campos.ocupadoAte !== undefined) await trx`update computadores set ocupado_ate = ${campos.ocupadoAte}, operacao_id = ${campos.ocupadoAte ? randomUUID() : null} where id = ${id}`;
    // Fora do ar exige a sequência de falhas (CHECK computador_saude, 0022).
    if (campos.indisponivel !== undefined) await trx`update computadores set indisponivel_desde = ${campos.indisponivel},
      falhas_seguidas = ${campos.indisponivel ? 3 : 0}, falha_motivo = ${campos.indisponivel ? "sem_resposta" : null} where id = ${id}`;
  }));

  beforeEach(async () => {
    teto = false;
    segurarParar = null;
    expect((await configurar("iniciar")).status).toBe(200);
    const c = await linha();
    await mudar(c.id, { controle: "bot", ocupadoAte: null, indisponivel: null });
    chamadas.length = 0;
  }, 30000);

  it("iniciar grava a atividade; o ocioso ligado desliga, sem mexer em habilitado nem na atividade", async () => {
    const c = await linha();
    expect(Date.now() - c.ultima.getTime()).toBeLessThan(60_000);
    expect(await computadores().desligarOciosos(srv.pessoa, await computadores().ligados(), QUINZE_MIN)).toBe(0);
    await envelhecer(c.id, 20);
    const antes = (await linha()).ultima.getTime();
    expect(await computadores().desligarOciosos(srv.pessoa, await computadores().ligados(), QUINZE_MIN)).toBe(1);
    expect(chamadas).toEqual([`parar ${c.id}`]);
    expect(ligados.has(c.id)).toBe(false);
    const depois = await linha();
    // Só o parar: nada de rm (os volumes ficam), habilitado segue e a reserva do varredor foi liberada.
    expect(depois).toMatchObject({ habilitado: true, controle: "bot", ocupadoAte: null, operacaoId: null, falhasSeguidas: 0 });
    expect(depois.ultima.getTime()).toBe(antes);
    expect((await consultar()).ativo).toBe(false);
    // Já desligado: a volta seguinte não chama o Docker de novo.
    expect(await computadores().desligarOciosos(srv.pessoa, await computadores().ligados(), QUINZE_MIN)).toBe(0);
    expect(chamadas).toHaveLength(1);
  });

  it("pula reserva viva, a pessoa no controle e a espera pela pessoa", async () => {
    const c = await linha();
    await envelhecer(c.id, 20);
    for (const campos of [{ ocupadoAte: new Date(Date.now() + 60_000) }, { controle: "pessoa" }, { controle: "aguardando_pessoa" }]) {
      await mudar(c.id, campos);
      expect(await computadores().desligarOciosos(srv.pessoa, await computadores().ligados(), QUINZE_MIN)).toBe(0);
      await mudar(c.id, { controle: "bot", ocupadoAte: null, indisponivel: null });
    }
    // Reserva VENCIDA não segura: o lease de 5 min de uma ação perdida não deixa a máquina ligada para sempre.
    await mudar(c.id, { ocupadoAte: new Date(Date.now() - 1_000) });
    expect(await computadores().desligarOciosos(srv.pessoa, await computadores().ligados(), QUINZE_MIN)).toBe(1);
    expect(chamadas).toEqual([`parar ${c.id}`]);
  });

  it("NOD-97: fechar a tela no controle devolve ao bot, grava a linha cinza uma vez e a máquina volta a poder dormir", async () => {
    const c = await linha();
    const linhas = () => srv.app.dentro(srv.pessoa, async (d) => (await d.repos.mensagens.listarDaConversa(bot.conversa.id, 200)).filter((m) => m.payload?.kind === "computador_tela_fechada"));
    const fechar = () => srv.chamar("POST", `agentes/${bot.agente.id}/computador`, { operacao: "devolver", origem: "fechou_tela" });
    expect((await srv.chamar("POST", `agentes/${bot.agente.id}/computador`, { operacao: "assumir", origem: "clique" })).status).toBe(200);
    expect((await linha()).controle).toBe("pessoa");
    await envelhecer(c.id, 20);
    // No controle da pessoa a máquina não dorme (era o "acordada para sempre" de antes da NOD-97).
    expect(await computadores().desligarOciosos(srv.pessoa, await computadores().ligados(), QUINZE_MIN)).toBe(0);
    // Com uma ação da pessoa em curso, o keepalive devolve do mesmo jeito (é a última chance).
    await mudar(c.id, { ocupadoAte: new Date(Date.now() + 60_000) });
    expect((await fechar()).status).toBe(200);
    await mudar(c.id, { ocupadoAte: null });
    expect(await linha()).toMatchObject({ controle: "bot", ajudaDecisaoId: null });
    const [aviso, ...resto] = await linhas();
    expect(resto).toEqual([]);
    expect(aviso).toMatchObject({ kind: "sistema", confianca: "confiavel", texto: `Você fechou a tela. ${bot.agente.nome} voltou a usar o computador do bot.`, payload: { kind: "computador_tela_fechada", agenteId: bot.agente.id } });
    // O close e o pagehide mandam a mesma chamada: a 2ª é no-op, sem outra linha.
    expect((await fechar()).status).toBe(200);
    expect(await linhas()).toHaveLength(1);
    await envelhecer(c.id, 20);
    expect(await computadores().desligarOciosos(srv.pessoa, await computadores().ligados(), QUINZE_MIN)).toBe(1);
    // origem fora do enum é entrada inválida.
    expect((await srv.chamar("POST", `agentes/${bot.agente.id}/computador`, { operacao: "devolver", origem: "outra" })).status).toBe(400);
  });

  it("NOD-97: com pedido de ajuda aberto, fechar a tela não devolve nem grava linha", async () => {
    const c = await linha();
    const decisaoId = randomUUID();
    const linhas = () => srv.app.dentro(srv.pessoa, async (d) => (await d.repos.mensagens.listarDaConversa(bot.conversa.id, 200)).filter((m) => m.payload?.kind === "computador_tela_fechada"));
    const antes = (await linhas()).length;
    await srv.app.dentro(srv.pessoa, (d) => d.tx(async (trx) => { await trx`update computadores set controle = 'aguardando_pessoa', ajuda = 'Entre no Gmail', ajuda_decisao_id = ${decisaoId} where id = ${c.id}`; }));
    expect((await srv.chamar("POST", `agentes/${bot.agente.id}/computador`, { operacao: "assumir" })).status).toBe(200);
    expect((await srv.chamar("POST", `agentes/${bot.agente.id}/computador`, { operacao: "devolver", origem: "fechou_tela" })).status).toBe(200);
    expect(await linha()).toMatchObject({ controle: "pessoa", ajudaDecisaoId: decisaoId });
    expect(await linhas()).toHaveLength(antes);
    await srv.app.dentro(srv.pessoa, (d) => d.tx(async (trx) => { await trx`update computadores set ajuda = null, ajuda_decisao_id = null where id = ${c.id}`; }));
  });

  it("NOD-97: com o computador desligado (Parar), fechar a tela é no-op: não devolve nem grava linha", async () => {
    const c = await linha();
    const linhas = () => srv.app.dentro(srv.pessoa, async (d) => (await d.repos.mensagens.listarDaConversa(bot.conversa.id, 200)).filter((m) => m.payload?.kind === "computador_tela_fechada"));
    const antes = (await linhas()).length;
    expect((await configurar("parar")).status).toBe(200);
    expect(await linha()).toMatchObject({ habilitado: false, controle: "pessoa" });
    expect((await srv.chamar("POST", `agentes/${bot.agente.id}/computador`, { operacao: "devolver", origem: "fechou_tela" })).status).toBe(200);
    expect(await linha()).toMatchObject({ habilitado: false, controle: "pessoa" });
    expect(await linhas()).toHaveLength(antes);
    expect(chamadas).toEqual([`parar ${c.id}`]);
  });

  // Regression: só `devolver` com `fechou_tela` é o atalho do keepalive; `assumir` com essa origem segue a regra
  // comum (espera a reserva, assume e não grava a linha cinza). Found by /qa (mutante) on 2026-10-22.
  it("NOD-97: assumir com origem fechou_tela não vira o atalho do keepalive", async () => {
    const c = await linha();
    const linhas = () => srv.app.dentro(srv.pessoa, async (d) => (await d.repos.mensagens.listarDaConversa(bot.conversa.id, 200)).filter((m) => m.payload?.kind === "computador_tela_fechada"));
    const antes = (await linhas()).length;
    const assumir = () => srv.chamar("POST", `agentes/${bot.agente.id}/computador`, { operacao: "assumir", origem: "fechou_tela" });
    await mudar(c.id, { ocupadoAte: new Date(Date.now() + 60_000) });
    expect((await assumir()).status).toBe(409);
    await mudar(c.id, { ocupadoAte: null });
    expect((await assumir()).status).toBe(200);
    expect((await linha()).controle).toBe("pessoa");
    expect(await linhas()).toHaveLength(antes);
  });

  // Regression: ISSUE-001 — computador fora do ar e ligado nunca desligava: a ação do bot não vai ao Docker e
  // nada mais o para, então segurava 2 GiB e uma vaga do teto para sempre (3 deles travavam o host no limite).
  // Found by /qa on 2026-10-05
  it("fora do ar, ligado e ocioso: desliga e segue fora do ar; o Tentar de novo religa", async () => {
    const c = await linha();
    await envelhecer(c.id, 20);
    await mudar(c.id, { indisponivel: new Date() });
    expect(await computadores().desligarOciosos(srv.pessoa, await computadores().ligados(), QUINZE_MIN)).toBe(1);
    expect(chamadas).toEqual([`parar ${c.id}`]);
    expect(await linha()).toMatchObject({ habilitado: true, falhasSeguidas: 3, falhaMotivo: "sem_resposta", ocupadoAte: null });
    expect((await linha()).indisponivelDesde).not.toBeNull();
    expect((await configurar("iniciar")).status).toBe(200);
    expect(ligados.has(c.id)).toBe(true);
    expect((await linha()).indisponivelDesde).toBeNull();
  });

  it("a ação que chega enquanto o varredor desliga recebe estado_invalido (livre())", async () => {
    const c = await linha();
    await envelhecer(c.id, 20);
    let soltar!: () => void;
    segurarParar = new Promise<void>((r) => { soltar = r; });
    const desligando = computadores().desligarOciosos(srv.pessoa, await computadores().ligados(), QUINZE_MIN);
    await expect.poll(() => chamadas.length).toBe(1);
    expect((await configurar("assumir")).status).toBe(409);
    expect((await srv.chamar("POST", `agentes/${bot.agente.id}/computador/acoes`, { tipo: "observar" })).status).toBe(409);
    soltar();
    expect(await desligando).toBe(1);
    // Depois de liberar, assumir volta a funcionar e conta como atividade.
    expect((await configurar("assumir")).status).toBe(200);
    expect(Date.now() - (await linha()).ultima.getTime()).toBeLessThan(60_000);
    await configurar("devolver");
  });

  it("o script de órfãos enxerga o computador: lê como nod_app pessoa por pessoa; como nod_dono a RLS esconde tudo", async () => {
    const c = await linha();
    const listarPessoas = async () => [{ tenantId: srv.pessoa.tenantId, id: srv.pessoa.pessoaId }];
    expect(await lerConhecidos(srv.db, listarPessoas)).toEqual(new Set([c.id]));
    // O select cru da versão anterior: FORCE RLS sem policy para o dono devolve zero linhas, sem erro.
    expect(await srv.dbDono<{ id: string }[]>`select id from computadores where id = ${c.id}`).toHaveLength(0);
    // Pessoa que falha aborta a leitura (um id faltando viraria container ligado removido).
    await expect(lerConhecidos(srv.db, async () => [{ tenantId: srv.pessoa.tenantId, id: "" }])).rejects.toThrow();
  });

  it("NOD_COMPUTADOR_OCIOSO_MIN=0 não desliga: o laço nem sobe e limite 0 não faz nada", async () => {
    const c = await linha();
    await envelhecer(c.id, 600);
    const listarPessoas = async () => [{ tenantId: srv.pessoa.tenantId, id: srv.pessoa.pessoaId }];
    const laco = iniciarVarredorOciosidade({ db: srv.db, computadores: computadores(), ociosoMin: 0, intervaloMs: 5, opcoes: { listarPessoas } });
    await new Promise((r) => setTimeout(r, 50));
    laco.parar();
    expect(await varrerOciosos(srv.db, computadores(), 0, { listarPessoas })).toBe(0);
    expect(chamadas).toEqual([]);
    // O mesmo laço, com 15 min, desliga pela volta normal (paraCadaPessoa).
    expect(await varrerOciosos(srv.db, computadores(), QUINZE_MIN, { listarPessoas })).toBe(1);
    expect(chamadas).toEqual([`parar ${c.id}`]);
  });

  it("o teto do host: a ferramenta diz os números e a saúde não anda nem zera", async () => {
    const c = await linha();
    await envelhecer(c.id, 20);
    await computadores().desligarOciosos(srv.pessoa, await computadores().ligados(), QUINZE_MIN);
    await srv.app.dentro(srv.pessoa, (d) => d.tx(async (trx) => { await trx`update computadores set falhas_seguidas = 1, falha_motivo = 'sem_resposta' where id = ${c.id}`; }));
    teto = true;
    const plano = await srv.app.dentro(srv.pessoa, async (d) => {
      const t = await d.repos.turnos.enfileirar({ executor: "catcher", agenteId: bot.agente.id, conversaId: bot.conversa.id, origem: "conversa", prazoEm: Date.now() + 600000, profundidade: 0, entradaTexto: "Use seu computador", entradaConfianca: "confiavel", modelo: "auto", harness: "auto" });
      return (await emitirPlanoTurno(d, { turnoId: t!.id, machineId: randomUUID(), executor: "catcher" })).data;
    });
    const r = await fetch(`${srv.url}/api/interno/ferramentas/computador_observar`, { method: "POST", headers: { authorization: `Bearer ${plano.tokenDeTurno}`, "content-type": "application/json" }, body: JSON.stringify({ argumentos: {} }) });
    const corpo = (await r.json()) as ResultadoChamada;
    expect(corpo).toMatchObject({ ok: true, isError: true, confianca: "confiavel" });
    if (!("conteudo" in corpo)) throw new Error("sem conteúdo");
    expect(JSON.parse(corpo.conteudo)).toEqual({
      erro: "limite_de_computadores",
      instrucao: "Este Mac já tem 3 computadores ligados, o limite. Nada foi executado. Os computadores sem uso há 15 min desligam sozinhos. Não tente de novo neste turno; siga com os acessos que você tem e diga em uma frase o que ficou de fora.",
    });
    // Ligar pela pessoa também bate no teto: 409, e o cartão sabe o motivo pela atividade.
    expect((await configurar("iniciar")).status).toBe(409);
    const dto = await consultar();
    expect(dto.atividade[0]).toMatchObject({ estado: "falhou", motivo: "limite_de_computadores" });
    expect(dto.limite).toEqual(LIMITE);
    expect(dto.computador).toMatchObject({ falhasSeguidas: 1, falhaMotivo: "sem_resposta", indisponivelDesde: null });
  });
});
