import { VERSAO_CONSENTIMENTO_VOZ } from "../../src/contracts/ligacao.ts";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import WebSocket from "ws";
import { criarPonteHttp } from "../../src/adapters/executor/ponte-http.ts";
import { varrerPessoa } from "../../src/adapters/fundo/varredor-lease.ts";
import type { Agente } from "../../src/contracts/agente.ts";
import type { ConversaDto, RespostaMutacao } from "../../src/contracts/api.ts";
import type { Conversa } from "../../src/contracts/conversa.ts";
import type { Ligacao } from "../../src/contracts/ligacao.ts";
import type { PlanoTurno } from "../../src/contracts/plano-turno.ts";
import type { Entrega } from "../../src/contracts/ponte.ts";
import { criarDb } from "../../src/db/client.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { LEASE_MS } from "../../src/shared/constantes.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { urlDonoDeTeste } from "../helpers/db-dono.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorCompleto, type ServidorCompleto } from "../helpers/servidor-completo.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * NOD-175: deploy sem perder turnos. O SIGTERM chama `drenar()` e depois `fechar()` (server.ts); aqui `drenar` é chamado
 * direto sobre o servidor completo, com a ponte de máquina HTTP do modo compartilhado e uma máquina falsa por fetch.
 * Cada bloco sobe o próprio servidor: a drenagem não se desfaz.
 */
const sinais = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true };
const tokensZero = { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 };
const entregaDe = (plano: PlanoTurno, machineId: string, seqLocal: number): Entrega => ({
  turnoId: plano.turnoId, machineId, seqLocal, fala: { tipo: "texto", texto: "Feito" },
  resultado: { desfecho: "sucesso", texto: "Feito", sessaoCli: null, sinais, custoUsd: 0, tokens: tokensZero, ferramentasChamadas: [], negacoesPermissao: [] },
});

/** Servidor compartilhado + uma máquina conectada pela ponte HTTP, e o que a limpeza precisa apagar. */
async function compartilhadoComMaquina(env: Record<string, string> = {}, extra: Pick<Parameters<typeof servidorCompleto>[0] & object, "envolverListarPessoas"> = {}) {
  const srv = await servidorCompleto({ ...extra, env: { NOD_MODO: "compartilhado", ...env } });
  const criados = { agentes: [] as string[], conversas: [] as string[] };
  const { chave, dados } = await srv.json<{ chave: string; dados: { id: string } }>("POST", "maquinas/chaves", { nome: "Mac" });
  const pedir = (nome: string, body: unknown = {}) => fetch(`${srv.url}/api/maquina/${nome}`, {
    method: "POST", headers: { authorization: `Bearer ${chave}`, "content-type": "application/json", "x-nod-versao": "0.1.0" }, body: JSON.stringify(body),
  });
  expect((await pedir("conectar", { nome: "Mac", versaoContrato: 1, inventario: { estado: "pronto", versao: "fake-sem-custo", em: 0 } })).status).toBe(200);
  const bot = async (nome: string) => {
    const r = await srv.json<{ agente: Agente; conversa: Conversa }>("POST", "agentes", { dono: "pessoa", nome });
    criados.agentes.push(r.agente.id);
    criados.conversas.push(r.conversa.id);
    return r.conversa.id;
  };
  const limpar = async () => {
    await srv.fechar();
    await srv.db.begin(async (tx) => { await vincularEscopo(tx, srv.pessoa); await tx`delete from maquina_tokens where owner_id = ${srv.pessoa.pessoaId}`; });
    await limparPessoaE2E(srv.db, srv.dbDono, srv.pessoa, criados);
    await srv.desligar();
  };
  return { srv, machineId: dados.id, chave, pedir, bot, limpar };
}

/** O long-poll dos testes que medem "voltou na hora"; o puxar vazio na drenagem tem que voltar bem antes dele. */
const LONGPOLL_MS = 5_000;

describeIntegracao("NOD-175: drenagem com turno em execução", () => {
  let m: Awaited<ReturnType<typeof compartilhadoComMaquina>>;
  beforeAll(async () => {
    m = await compartilhadoComMaquina({ NOD_LONGPOLL_MS: String(LONGPOLL_MS) });
  });
  afterAll(async () => {
    await m?.limpar();
  });

  it("token vivo segura a drenagem; o puxar volta vazio na hora e o turno novo fica pendente; a entrega libera", async () => {
    const { srv, pedir, bot, machineId } = m;
    const conversaA = await bot("Bot A");
    const enviadaA = await srv.json<RespostaMutacao>("POST", `conversas/${conversaA}/mensagens`, { texto: "Trabalho longo" });
    const { plano } = (await (await pedir("puxar")).json()) as { plano: PlanoTurno };
    expect(plano.turnoId).toBe(enviadaA.ids.turno);
    expect(srv.app.tokens.ativos()).toBe(1);

    let resultado: Awaited<ReturnType<typeof srv.drenar>> | null = null;
    const drenagem = srv.drenar({ prazoMs: 30_000, intervaloMs: 50 }).then((r) => (resultado = r));
    await new Promise((r) => setTimeout(r, 300));
    expect(resultado).toBeNull();

    // Turno novo durante a drenagem: o puxar não o entrega (volta vazio bem antes do long-poll de 5 s) e ele segue pendente.
    const conversaB = await bot("Bot B");
    const enviadaB = await srv.json<RespostaMutacao>("POST", `conversas/${conversaB}/mensagens`, { texto: "Chegou no deploy" });
    const inicio = Date.now();
    const vazio = await pedir("puxar");
    expect(Date.now() - inicio).toBeLessThan(LONGPOLL_MS / 2); // NOD-194: contra o próprio long-poll, não um número mágico
    expect(await vazio.json()).toEqual({ plano: null });
    expect((await srv.json<{ turno: { estado: string } }>("GET", `turnos/${enviadaB.ids.turno}`)).turno.estado).toBe("pendente");

    // renovar segue aceito na drenagem; a entrega solta o token e a drenagem termina sem vencer o prazo.
    expect(((await (await pedir("renovar", { turnoId: plano.turnoId, sinais, eventos: [] })).json()) as { ativo: boolean }).ativo).toBe(true);
    expect(resultado).toBeNull();
    expect((await pedir("entregar", entregaDe(plano, machineId, 1))).status).toBe(200);
    expect(await drenagem).toMatchObject({ vivas: 0, turnos: 0, prazo_vencido: false });
    expect((await srv.json<{ turno: { estado: string } }>("GET", `turnos/${plano.turnoId}`)).turno.estado).toBe("concluido");
    expect((await srv.json<{ turno: { estado: string } }>("GET", `turnos/${enviadaB.ids.turno}`)).turno.estado).toBe("pendente");
    // NOD-218: /api/saude passa a 503 na drenagem (o healthcheck do compose não deve marcar a cor velha como saudável),
    // e /api/saude/lb também, com o motivo — o Caddy tira a cor do balanceamento.
    const saude = await fetch(`${srv.url}/api/saude`);
    expect(saude.status).toBe(503);
    expect(await saude.json()).toMatchObject({ ok: false });
    const lb = await fetch(`${srv.url}/api/saude/lb`);
    expect(lb.status).toBe(503);
    expect(await lb.json()).toMatchObject({ ok: false, motivo: "drenando" });
  });
});

describeIntegracao("NOD-214 (PR 1): o cliente da máquina atravessa o servidor fora do ar", () => {
  let m: Awaited<ReturnType<typeof compartilhadoComMaquina>>;
  beforeAll(async () => {
    m = await compartilhadoComMaquina({ NOD_LONGPOLL_MS: "20" });
  });
  afterAll(async () => {
    await m?.limpar();
  });

  it("a renovação sem resposta vira `indefinido` (o CLI segue) e a entrega insiste até o servidor voltar e concluir o turno", async () => {
    const { srv, bot, machineId, chave } = m;
    // O cliente de verdade do app; `fora` simula o servidor reiniciando (a conexão nem abre).
    let fora = false;
    const fetchImpl: typeof fetch = async (url, init) => {
      if (fora) throw new TypeError("fetch failed");
      return fetch(url, init);
    };
    const { ponte } = criarPonteHttp({ url: srv.url, chave, versao: "0.1.0", fetchImpl });
    await ponte.conectar({ machineId, nome: "Mac", versaoContrato: 1, inventario: { estado: "pronto", versao: "fake-sem-custo", em: 0 } });
    const conversa = await bot("Bot do deploy");
    await srv.json<RespostaMutacao>("POST", `conversas/${conversa}/mensagens`, { texto: "Trabalho no deploy" });
    const plano = await ponte.puxar("ignorado");
    expect(plano).not.toBeNull();

    fora = true;
    // Antes: `{ativo:false}` na primeira renovação perdida, e o laço matava o CLI no meio do deploy.
    expect((await ponte.renovar({ turnoId: plano!.turnoId, machineId, sinais, eventos: [] })).ativo).toBe("indefinido");

    // O servidor volta ~3,5 s depois (o deploy leva ~10 s); antes, a entrega desistia em ~2 s (3 tentativas) e o turno se perdia.
    const volta = setTimeout(() => { fora = false; }, 3_500);
    try {
      await ponte.entregar(entregaDe(plano!, machineId, 1));
    } finally { clearTimeout(volta); }
    expect(fora).toBe(false);
    expect((await srv.json<{ turno: { estado: string } }>("GET", `turnos/${plano!.turnoId}`)).turno.estado).toBe("concluido");
  }, 30_000);
});

describeIntegracao("NOD-175: drenagem com o prazo vencido", () => {
  let m: Awaited<ReturnType<typeof compartilhadoComMaquina>>;
  beforeAll(async () => {
    m = await compartilhadoComMaquina({ NOD_LONGPOLL_MS: "20" });
  });
  afterAll(async () => {
    await m?.limpar();
  });

  it("prazo vencido: drenar resolve com prazo_vencido; o turno fica despachando e o próximo boot o assenta como reinicio_servidor", async () => {
    const { srv, pedir, bot } = m;
    const conversa = await bot("Bot lento");
    await srv.json<RespostaMutacao>("POST", `conversas/${conversa}/mensagens`, { texto: "Nunca termina" });
    const { plano } = (await (await pedir("puxar")).json()) as { plano: PlanoTurno };
    expect(plano).not.toBeNull();

    const inicio = Date.now();
    expect(await srv.drenar({ prazoMs: 300, intervaloMs: 50 })).toMatchObject({ turnos: 1, prazo_vencido: true });
    expect(Date.now() - inicio).toBeLessThan(2_000);
    await srv.fechar();

    const escopo: Escopo = srv.pessoa;
    const escopado = <T>(fn: (trx: Tx) => Promise<T>): Promise<T> => srv.db.begin(async (trx) => {
      await vincularEscopo(trx, escopo);
      return fn(trx);
    }) as Promise<T>;
    const estado = async () => (await escopado((trx) => trx<{ estado: string; motivo_interrupcao: string | null }[]>`select estado, motivo_interrupcao from turnos where id = ${plano.turnoId}`))[0];
    expect(await estado()).toMatchObject({ estado: "despachando" });

    // O processo novo subiu depois do último sinal do turno: o varredor de lease dele assenta reinicio_servidor (ADR-045).
    const novoBoot = Date.now() + 1;
    const r = await varrerPessoa(escopado, escopo, novoBoot + LEASE_MS + 1, { inicioDoProcesso: novoBoot, ultimoContato: () => null });
    expect(r.interrompidos).toEqual([plano.turnoId]);
    expect(await estado()).toEqual({ estado: "interrompido", motivo_interrupcao: "reinicio_servidor" });
  });
});

describeIntegracao("NOD-176: drenagem com uma reserva em voo", () => {
  let m: Awaited<ReturnType<typeof compartilhadoComMaquina>>;
  beforeAll(async () => {
    m = await compartilhadoComMaquina({ NOD_LONGPOLL_MS: String(LONGPOLL_MS) });
  });
  afterAll(async () => {
    await m?.limpar();
  });

  it("puxar em voo segura a drenagem antes de o token existir; a reserva é entregue e a entrega libera", async () => {
    const { srv, pedir, bot, machineId } = m;
    const conversa = await bot("Bot em voo");
    const enviada = await srv.json<RespostaMutacao>("POST", `conversas/${conversa}/mensagens`, { texto: "Reservado no deploy" });

    // O puxar lento: uma tx do teste trava `turnos` em EXCLUSIVE (leitura passa, o UPDATE ... FOR UPDATE SKIP LOCKED da
    // reivindicação espera). O puxar fica parado ANTES de cunhar o token — só `reservasEmVoo()` conta o turno.
    const trava = criarDb(urlDonoDeTeste(), { max: 1 });
    let soltar: () => void = () => undefined;
    let travou: () => void = () => undefined;
    const travada = new Promise<void>((r) => { travou = r; });
    const segurando = trava.begin(async (tx) => {
      await tx`lock table turnos in exclusive mode`;
      travou();
      await new Promise<void>((r) => { soltar = r; });
    });
    try {
      await travada;
      const puxando = pedir("puxar");
      await srv.esperar(async () => srv.app.reservasEmVoo() === 1, { nome: "reserva em voo", intervaloMs: 10 });
      expect(srv.app.tokens.ativos()).toBe(0);
      // Nenhuma ligação viva: só a reserva pode segurar a drenagem.
      expect(srv.app.voz.vivas()).toBe(0);

      let resultado: Awaited<ReturnType<typeof srv.drenar>> | null = null;
      const drenagem = srv.drenar({ prazoMs: 5_000, intervaloMs: 20 }).then((r) => (resultado = r));
      expect(await Promise.race([drenagem.then(() => "resolveu"), new Promise((r) => setTimeout(() => r("pendente"), 200))])).toBe("pendente");

      // A reserva que começou antes da drenagem é ENTREGUE: o token nasce e passa a segurar a drenagem no lugar dela.
      soltar();
      await segurando;
      const { plano } = (await (await puxando).json()) as { plano: PlanoTurno };
      expect(plano.turnoId).toBe(enviada.ids.turno);
      expect(srv.app.reservasEmVoo()).toBe(0);
      expect(srv.app.tokens.ativos()).toBe(1);
      expect(resultado).toBeNull();

      expect((await pedir("entregar", entregaDe(plano, machineId, 1))).status).toBe(200);
      expect(await drenagem).toMatchObject({ vivas: 0, turnos: 0, prazo_vencido: false });
      expect(srv.app.tokens.ativos()).toBe(0);
    } finally {
      soltar();
      await segurando.catch(() => undefined);
      await trava.end({ timeout: 2 });
    }
  });
});

describeIntegracao("NOD-175: modo local", () => {
  let srv: ServidorCompleto;
  const criados = { agentes: [] as string[], conversas: [] as string[] };
  beforeAll(async () => {
    srv = await servidorCompleto({ env: { NOD_LIGACAO: "todas" } });
  });
  afterAll(async () => {
    if (!srv) return;
    await srv.fechar();
    await limparPessoaE2E(srv.db, srv.dbDono, srv.pessoa, criados);
    await srv.desligar();
  });

  it("ligação viva segura a drenagem, ouve o aviso e libera ao desligar; o modo local não espera token", async () => {
    const { agente, conversa } = await srv.json<{ agente: Agente; conversa: Conversa }>("POST", "agentes", { dono: "pessoa", nome: "Nina" });
    criados.agentes.push(agente.id);
    criados.conversas.push(conversa.id);
    await srv.json("POST", "voz/consentimento", { versao: VERSAO_CONSENTIMENTO_VOZ });
    const { ligacao } = await srv.json<{ ligacao: Ligacao }>("POST", "ligacoes", { agenteId: agente.id });

    const host = new URL(srv.url).host;
    const ws = new WebSocket(`${srv.url.replace("http", "ws")}/api/t/${srv.pessoa.tenantId}/voz/v1/midia`, { headers: { cookie: srv.pessoa.cookie, origin: `http://${host}` } });
    const textos: string[] = [];
    ws.on("message", (dados, binario) => {
      if (binario) {
        ws.send(JSON.stringify({ t: "tocou-fim", utt: (dados as Buffer).readUInt16LE(5) }));
        return;
      }
      textos.push(String(dados));
    });
    await new Promise<void>((r, j) => {
      ws.once("open", () => r());
      ws.once("error", j);
    });
    ws.send(JSON.stringify({ t: "ola", v: 1, ligacaoId: ligacao.id, entrada: "pcm16", saida: "pcm16" }));
    await srv.esperar(async () => textos.some((t) => t.includes('"pronto"')), { nome: "pronto" });
    await srv.esperar(async () => srv.app.voz.vivas() === 1, { nome: "ligação viva" });

    let resultado: Awaited<ReturnType<typeof srv.drenar>> | null = null;
    const drenagem = srv.drenar({ prazoMs: 30_000, intervaloMs: 50 }).then((r) => (resultado = r));
    await srv.esperar(async () => textos.some((t) => t.includes("preciso reiniciar")), { nome: "aviso da drenagem" });
    expect(resultado).toBeNull();

    ws.send(JSON.stringify({ t: "tchau" }));
    expect(await drenagem).toMatchObject({ vivas: 0, turnos: 0, prazo_vencido: false });
    ws.close();
  });
});

describeIntegracao("NOD-168: ligação que passa do prazo da drenagem", () => {
  let srv: ServidorCompleto;
  const criados = { agentes: [] as string[], conversas: [] as string[] };
  beforeAll(async () => {
    srv = await servidorCompleto({ env: { NOD_LIGACAO: "todas" } });
  });
  afterAll(async () => {
    if (!srv) return;
    await srv.fechar();
    await limparPessoaE2E(srv.db, srv.dbDono, srv.pessoa, criados);
    await srv.desligar();
  });

  it("prazo vencido com a ligação viva: o fechar encerra com reinicio_servidor e deixa UMA linha na conversa", async () => {
    const { agente, conversa } = await srv.json<{ agente: Agente; conversa: Conversa }>("POST", "agentes", { dono: "pessoa", nome: "Nina" });
    criados.agentes.push(agente.id);
    criados.conversas.push(conversa.id);
    await srv.json("POST", "voz/consentimento", { versao: VERSAO_CONSENTIMENTO_VOZ });
    const { ligacao } = await srv.json<{ ligacao: Ligacao }>("POST", "ligacoes", { agenteId: agente.id });

    const host = new URL(srv.url).host;
    const ws = new WebSocket(`${srv.url.replace("http", "ws")}/api/t/${srv.pessoa.tenantId}/voz/v1/midia`, { headers: { cookie: srv.pessoa.cookie, origin: `http://${host}` } });
    const textos: string[] = [];
    ws.on("message", (dados, binario) => {
      if (binario) {
        ws.send(JSON.stringify({ t: "tocou-fim", utt: (dados as Buffer).readUInt16LE(5) }));
        return;
      }
      textos.push(String(dados));
    });
    await new Promise<void>((r, j) => {
      ws.once("open", () => r());
      ws.once("error", j);
    });
    ws.send(JSON.stringify({ t: "ola", v: 1, ligacaoId: ligacao.id, entrada: "pcm16", saida: "pcm16" }));
    await srv.esperar(async () => srv.app.voz.vivas() === 1, { nome: "ligação viva" });

    // A pessoa não desliga: a drenagem vence o prazo com a ligação viva, e o SIGTERM segue para o fechar (server.ts).
    expect(await srv.drenar({ prazoMs: 300, intervaloMs: 50 })).toMatchObject({ vivas: 1, prazo_vencido: true });
    await srv.app.voz.fechar();
    await srv.esperar(async () => textos.some((t) => t.includes('"reinicio_servidor"')), { nome: "fim na mídia" });

    const linhas = async () => (await srv.json<ConversaDto>("GET", `conversas/${conversa.id}/mensagens`)).mensagens.filter((m) => m.kind === "sistema" && m.texto.startsWith("A ligação"));
    await srv.esperar(async () => (await linhas()).length > 0, { nome: "linha do fim" });
    expect((await linhas()).map((m) => m.texto)).toEqual(["A ligação caiu porque o nod foi atualizado. Ligue de novo."]);
    // Fechar de novo (o fechar do servidor no afterAll) não duplica: o repo só encerra uma vez.
    await srv.app.voz.fechar();
    expect(await linhas()).toHaveLength(1);
    ws.close();
  });
});

describeIntegracao("NOD-176: modo local com token vivo", () => {
  let srv: ServidorCompleto;
  beforeAll(async () => {
    srv = await servidorCompleto();
  });
  afterAll(async () => {
    if (!srv) return;
    await srv.fechar();
    await limparPessoaE2E(srv.db, srv.dbDono, srv.pessoa, { agentes: [], conversas: [] });
    await srv.desligar();
  });

  it("token vivo sem ligação: drenar resolve na primeira verificação com turnos 0", async () => {
    // O modo local não tem a ponte HTTP de máquina: o token nasce pelo serviço, como o despacho local o cunharia.
    const turnoId = randomUUID();
    srv.app.tokens.cunhar(turnoId, { tenantId: srv.pessoa.tenantId, pessoaId: srv.pessoa.pessoaId, agenteId: randomUUID() });
    try {
      expect(srv.app.tokens.ativos()).toBe(1);
      expect(srv.app.voz.vivas()).toBe(0);
      const r = await srv.drenar({ prazoMs: 5_000, intervaloMs: 1_000 });
      expect(r).toMatchObject({ vivas: 0, turnos: 0, prazo_vencido: false });
      // Abaixo de um intervalo: resolveu na primeira verificação, sem dormir esperando o token.
      expect(r.duracao_ms).toBeLessThan(1_000);
      expect(srv.app.tokens.ativos()).toBe(1);
    } finally {
      srv.app.tokens.revogar(turnoId);
    }
  });
});

describeIntegracao("NOD-214 (PR 2): deploy com uma frente longa na máquina que atravessa o reinício", () => {
  // Dois processos sobre o mesmo banco e a mesma pessoa: o velho drena e fecha, o novo sobe e continua a fila.
  let velho: ServidorCompleto | null = null;
  let novo: ServidorCompleto | null = null;
  const criados = { agentes: [] as string[], conversas: [] as string[] };
  afterAll(async () => {
    await novo?.fechar();
    await velho?.fechar();
    if (velho) {
      const v = velho;
      await v.db.begin(async (tx) => { await vincularEscopo(tx, v.pessoa); await tx`delete from maquina_tokens where owner_id = ${v.pessoa.pessoaId}`; });
      await limparPessoaE2E(v.db, v.dbDono, v.pessoa, criados);
    }
    await novo?.desligar();
    await velho?.desligar();
  });

  it("a drenagem não espera a frente; o processo novo despacha a fila e aceita renovar e entregar da frente antiga pelo token", async () => {
    const env = { NOD_MODO: "compartilhado", NOD_LONGPOLL_MS: "20" };
    velho = await servidorCompleto({ env });
    const v = velho;
    const { chave, dados } = await v.json<{ chave: string; dados: { id: string } }>("POST", "maquinas/chaves", { nome: "Mac" });
    const machineId = dados.id;
    const pedirEm = (srv: ServidorCompleto) => (nome: string, body: unknown = {}, token?: string) => fetch(`${srv.url}/api/maquina/${nome}`, {
      method: "POST",
      headers: { authorization: `Bearer ${chave}`, "content-type": "application/json", "x-nod-versao": "0.1.0", ...(token ? { "x-nod-token-turno": token } : {}) },
      body: JSON.stringify(body),
    });
    const conectar = { nome: "Mac", versaoContrato: 1, inventario: { estado: "pronto", versao: "fake-sem-custo", em: 0 }, sobreviveReinicio: true };
    const bot = async (srv: ServidorCompleto, nome: string) => {
      const r = await srv.json<{ agente: Agente; conversa: Conversa }>("POST", "agentes", { dono: "pessoa", nome });
      criados.agentes.push(r.agente.id);
      criados.conversas.push(r.conversa.id);
      return r.conversa.id;
    };
    const escopado = <T>(fn: (trx: Tx) => Promise<T>): Promise<T> => v.db.begin(async (trx) => {
      await vincularEscopo(trx, v.pessoa);
      return fn(trx);
    }) as Promise<T>;
    const linhaDoTurno = async (id: string) => (await escopado((trx) => trx<{ estado: string; sessao_cli: string | null }[]>`select estado, sessao_cli from turnos where id = ${id}`))[0];
    const credencial = async (id: string) => (await escopado((trx) => trx<{ linha: string }[]>`select row_to_json(c)::text as linha from turno_credenciais c where turno_id = ${id}`))[0]?.linha ?? null;

    // A frente longa começa no processo velho.
    const pedirV = pedirEm(v);
    expect((await pedirV("conectar", conectar)).status).toBe(200);
    const conversaA = await bot(v, "Frente longa");
    await v.json<RespostaMutacao>("POST", `conversas/${conversaA}/mensagens`, { texto: "Trabalho de horas" });
    const { plano: frente } = (await (await pedirV("puxar")).json()) as { plano: PlanoTurno };
    expect(frente).not.toBeNull();
    const sessao = randomUUID();
    expect(((await (await pedirV("renovar", { turnoId: frente.turnoId, sinais, eventos: [], sessaoCli: sessao }, frente.tokenDeTurno)).json()) as { ativo: boolean }).ativo).toBe(true);
    expect((await linhaDoTurno(frente.turnoId))?.sessao_cli).toBe(sessao);
    // O banco guarda só o hash: nem o token inteiro nem a parte aleatória aparecem na linha.
    const gravada = await credencial(frente.turnoId);
    expect(gravada).not.toBeNull();
    expect(gravada).not.toContain(frente.tokenDeTurno);
    expect(gravada).not.toContain(frente.tokenDeTurno.split(".")[1]!);

    // Antes: o token vivo segurava a drenagem até o prazo (10 min no deploy) e a fila parava junto.
    const inicio = Date.now();
    expect(await v.drenar({ prazoMs: 600_000, intervaloMs: 50 })).toMatchObject({ turnos: 0, prazo_vencido: false });
    expect(Date.now() - inicio).toBeLessThan(2_000);
    await v.fechar();

    // O processo novo: a máquina reconecta e a fila anda (um turno novo é despachado com a frente ainda rodando).
    novo = await servidorCompleto({ env, pessoaId: v.pessoa.pessoaId });
    const n = novo;
    const pedirN = pedirEm(n);
    expect((await pedirN("conectar", conectar)).status).toBe(200);
    const conversaB = await bot(n, "Chegou no deploy");
    const enviadaB = await n.json<RespostaMutacao>("POST", `conversas/${conversaB}/mensagens`, { texto: "Responde rápido" });
    const { plano: novoTurno } = (await (await pedirN("puxar")).json()) as { plano: PlanoTurno };
    expect(novoTurno?.turnoId).toBe(enviadaB.ids.turno);

    // A chave de máquina sozinha não adota; o token de OUTRO turno também não.
    expect(((await (await pedirN("renovar", { turnoId: frente.turnoId, sinais, eventos: [] })).json()) as { ativo: boolean }).ativo).toBe(false);
    expect(((await (await pedirN("renovar", { turnoId: frente.turnoId, sinais, eventos: [] }, novoTurno.tokenDeTurno)).json()) as { ativo: boolean }).ativo).toBe(false);
    expect((await linhaDoTurno(frente.turnoId))?.estado).toBe("despachando");

    // Com o token da frente: renova (a sessão do CLI fica), entrega e conclui. Duas renovações ao mesmo tempo (a da
    // frente e a repetida pelo cliente) adotam o mesmo turno sem uma derrubar a outra.
    const duas = await Promise.all([0, 1].map(async () => ((await (await pedirN("renovar", { turnoId: frente.turnoId, sinais, eventos: [] }, frente.tokenDeTurno)).json()) as { ativo: boolean }).ativo));
    expect(duas).toEqual([true, true]);
    // Os dois tokens (o adotado e o do turno novo) são de máquina que sobrevive: nenhum segura a próxima drenagem.
    expect(n.app.tokens.ativos()).toBe(2);
    expect(n.app.tokens.ativos({ semSobrevive: true })).toBe(0);
    expect((await pedirN("entregar", entregaDe(frente, machineId, 1), frente.tokenDeTurno)).status).toBe(200);
    expect(await linhaDoTurno(frente.turnoId)).toEqual({ estado: "concluido", sessao_cli: sessao });
    expect(await credencial(frente.turnoId)).toBeNull();

    // A entrega repetida cuja resposta se perdeu (outro seqLocal, plano já solto): 200 `ja_assentado`, não 403.
    const repetida = await pedirN("entregar", entregaDe(frente, machineId, 2), frente.tokenDeTurno);
    expect(repetida.status).toBe(200);
    expect(await repetida.json()).toMatchObject({ ok: true, codigo: "ja_assentado" });

    expect((await pedirN("entregar", entregaDe(novoTurno, machineId, 1))).status).toBe(200);
    expect((await linhaDoTurno(novoTurno.turnoId))?.estado).toBe("concluido");
  }, 30_000);
});

describeIntegracao("NOD-245/NOD-252: a entrega adotada depois do deploy assenta pelo desfecho certo (adotar para assentar)", () => {
  // Dois processos sobre o mesmo banco: o velho despacha duas frentes e fecha; a máquina desistiu delas (CLI morto) e só
  // ENTREGA no processo novo, sem renovar antes. A adoção da entrega (`para: "assentar"`) não renova o lease nem recusa o
  // Parar pendente: a entrega é aceita (200, não 403) e o assentamento decide o desfecho.
  let velho: ServidorCompleto | null = null;
  let novo: ServidorCompleto | null = null;
  const criados = { agentes: [] as string[], conversas: [] as string[] };
  afterAll(async () => {
    await novo?.fechar();
    await velho?.fechar();
    if (velho) {
      const v = velho;
      await v.db.begin(async (tx) => { await vincularEscopo(tx, v.pessoa); await tx`delete from maquina_tokens where owner_id = ${v.pessoa.pessoaId}`; });
      await limparPessoaE2E(v.db, v.dbDono, v.pessoa, criados);
    }
    await novo?.desligar();
    await velho?.desligar();
  });

  it("Parar pendente → 200 e parado_pela_pessoa, sem Retomar; sem motivo e sem Parar → reinicio_servidor com UM Retomar", async () => {
    const env = { NOD_MODO: "compartilhado", NOD_LONGPOLL_MS: "20" };
    velho = await servidorCompleto({ env });
    const v = velho;
    const { chave, dados } = await v.json<{ chave: string; dados: { id: string } }>("POST", "maquinas/chaves", { nome: "Mac" });
    const machineId = dados.id;
    const pedirEm = (srv: ServidorCompleto) => (nome: string, body: unknown = {}, token?: string) => fetch(`${srv.url}/api/maquina/${nome}`, {
      method: "POST",
      headers: { authorization: `Bearer ${chave}`, "content-type": "application/json", "x-nod-versao": "0.1.0", ...(token ? { "x-nod-token-turno": token } : {}) },
      body: JSON.stringify(body),
    });
    const conectar = { nome: "Mac", versaoContrato: 1, inventario: { estado: "pronto", versao: "fake-sem-custo", em: 0 }, sobreviveReinicio: true };
    const bot = async (nome: string) => {
      const r = await v.json<{ agente: Agente; conversa: Conversa }>("POST", "agentes", { dono: "pessoa", nome });
      criados.agentes.push(r.agente.id);
      criados.conversas.push(r.conversa.id);
      return r.conversa.id;
    };
    const escopado = <T>(fn: (trx: Tx) => Promise<T>): Promise<T> => v.db.begin(async (trx) => {
      await vincularEscopo(trx, v.pessoa);
      return fn(trx);
    }) as Promise<T>;
    const linhaDoTurno = async (id: string) => (await escopado((trx) => trx<{ estado: string; motivo_interrupcao: string | null }[]>`select estado, motivo_interrupcao from turnos where id = ${id}`))[0];
    const decisoes = (id: string) => escopado((trx) => trx<{ tipo: string; estado: string }[]>`select tipo, estado from decisoes where turno_id = ${id}`);
    const cortada = (plano: PlanoTurno): Entrega => {
      const e = entregaDe(plano, machineId, 1);
      return { ...e, fala: { tipo: "texto", texto: "Vou verificar" }, resultado: { ...e.resultado, desfecho: "interrompido", texto: "Vou verificar" } };
    };

    const pedirV = pedirEm(v);
    expect((await pedirV("conectar", conectar)).status).toBe(200);
    const conversaParada = await bot("Parado no deploy");
    await v.json<RespostaMutacao>("POST", `conversas/${conversaParada}/mensagens`, { texto: "Trabalho longo A" });
    const { plano: parado } = (await (await pedirV("puxar")).json()) as { plano: PlanoTurno };
    expect(parado).not.toBeNull();
    const conversaCortada = await bot("Cortado no deploy");
    await v.json<RespostaMutacao>("POST", `conversas/${conversaCortada}/mensagens`, { texto: "Trabalho longo B" });
    const { plano: cortado } = (await (await pedirV("puxar")).json()) as { plano: PlanoTurno };
    expect(cortado).not.toBeNull();
    // A pessoa aperta Parar na conversa A com o processo velho ainda de pé; o deploy chega antes de a máquina entregar.
    expect((await v.chamar("POST", `conversas/${conversaParada}/parar`)).status).toBe(200);
    expect(await v.drenar({ prazoMs: 600_000, intervaloMs: 50 })).toMatchObject({ prazo_vencido: false });
    await v.fechar();

    novo = await servidorCompleto({ env, pessoaId: v.pessoa.pessoaId });
    const pedirN = pedirEm(novo);
    expect((await pedirN("conectar", conectar)).status).toBe(200);

    // NOD-252 (CA3): antes, a adoção renovava o lease e recusava o turno com Parar pendente → 403 na entrega.
    expect((await pedirN("entregar", cortada(parado), parado.tokenDeTurno)).status).toBe(200);
    expect(await linhaDoTurno(parado.turnoId)).toEqual({ estado: "interrompido", motivo_interrupcao: "parado_pela_pessoa" });
    expect(await decisoes(parado.turnoId)).toEqual([]);

    // NOD-245 (CA3): a entrega adotada, cortada sem motivo e sem Parar, é o reinício que derrubou o turno.
    expect((await pedirN("entregar", cortada(cortado), cortado.tokenDeTurno)).status).toBe(200);
    expect(await linhaDoTurno(cortado.turnoId)).toEqual({ estado: "interrompido", motivo_interrupcao: "reinicio_servidor" });
    expect(await decisoes(cortado.turnoId)).toEqual([{ tipo: "retomar_turno", estado: "pendente" }]);
  }, 30_000);
});

/** Abre o SSE e junta o texto; `ids()` devolve os `id:` lidos e `terminou` resolve quando o servidor fecha o stream. */
async function abrirSse(url: string, sessao: { tenantId: string; cookie: string }, since?: string) {
  const abort = new AbortController();
  const res = await fetch(`${url}/api/t/${sessao.tenantId}/eventos`, { headers: { cookie: sessao.cookie, ...(since ? { "last-event-id": since } : {}) }, signal: abort.signal });
  let texto = "";
  const terminou = (async () => {
    if (res.status !== 200 || !res.body) return;
    const leitor = res.body.getReader();
    const dec = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await leitor.read();
        if (done) return;
        texto += dec.decode(value, { stream: true });
      }
    } catch { /* abortado pelo teste */ }
  })();
  const retomadas = () => [...texto.matchAll(/^id: (\S+)\nevent: resumed\ndata: (.+)$/gm)].map((m) => ({ id: m[1]!, resumed: (JSON.parse(m[2]!) as { dados: { resumed: boolean } }).dados.resumed }));
  return { res, terminou, retomadas, fechar: () => abort.abort() };
}

describeIntegracao("NOD-218: drenar() para os laços, fecha o SSE e autoriza o token só pelo banco", () => {
  let m: Awaited<ReturnType<typeof compartilhadoComMaquina>>;
  let novo: ServidorCompleto | null = null;
  beforeAll(async () => {
    m = await compartilhadoComMaquina({ NOD_LONGPOLL_MS: "20" });
  });
  afterAll(async () => {
    await novo?.fechar();
    await novo?.desligar();
    await m?.limpar();
  });

  it("laços parados, outbox novo intocado, SSE encerrado e recusado, retomada no 2º servidor sem resumed e token revogado negado", async () => {
    const { srv, pedir, bot } = m;
    expect(srv.estado()).toMatchObject({ pronto: true, drenando: false, ativa: true, cor: null, lacosLigados: true });

    // SSE aberto antes: a retomada no MESMO processo dá resumed:true (o anel tem o stream); vale como controle.
    const sse = await abrirSse(srv.url, srv.pessoa);
    expect(sse.res.status).toBe(200);
    await srv.esperar(async () => sse.retomadas().length > 0, { nome: "resumed inicial" });
    const cabeca = sse.retomadas()[0]!.id;
    const controle = await abrirSse(srv.url, srv.pessoa, cabeca);
    await srv.esperar(async () => controle.retomadas().length > 0, { nome: "resumed do controle" });
    expect(controle.retomadas()[0]!.resumed).toBe(true);
    controle.fechar();

    // Turno na máquina: o token segura a drenagem; ele nasce na memória e em turno_credenciais.
    const conversa = await bot("Bot NOD-218");
    await srv.json<RespostaMutacao>("POST", `conversas/${conversa}/mensagens`, { texto: "Antes do deploy" });
    const { plano } = (await (await pedir("puxar")).json()) as { plano: PlanoTurno };
    expect(srv.app.tokens.autorizar(plano.tokenDeTurno)?.turnoId).toBe(plano.turnoId);

    const drenagem = srv.drenar({ prazoMs: 3_000, intervaloMs: 50 });
    // O stream aberto termina pelo servidor; SSE novo recebe 503 drenando.
    await sse.terminou;
    const recusado = await fetch(`${srv.url}/api/t/${srv.pessoa.tenantId}/eventos`, { headers: { cookie: srv.pessoa.cookie } });
    expect(recusado.status).toBe(503);
    expect(await recusado.json()).toMatchObject({ codigo: "drenando" });
    expect(srv.app.sse.abertas()).toBe(0);
    expect(srv.estado()).toMatchObject({ drenando: true });
    // NOD-331: o SSE fecha ANTES de parar os laços; eles param logo depois (nada preso aqui).
    await srv.esperar(async () => !srv.estado().lacosLigados, { nome: "laços parados" });

    // O token só vale pelo banco. Turno ainda despachando → autoriza; assentado por outro processo → nega,
    // mesmo com a cópia na memória daqui.
    expect(srv.app.tokens.autorizar(plano.tokenDeTurno)).toBeNull();
    expect((await srv.app.tokens.autorizarComBanco(plano.tokenDeTurno))?.turnoId).toBe(plano.turnoId);
    await srv.db.begin(async (tx) => {
      await vincularEscopo(tx, srv.pessoa);
      await tx`update turnos set estado = 'interrompido', motivo_interrupcao = 'reinicio_servidor' where id = ${plano.turnoId}`;
    });
    expect(await srv.app.tokens.autorizarComBanco(plano.tokenDeTurno)).toBeNull();

    // O despachante parou. Uma mensagem gravada agora deixa outbox pendente que ESTE processo não marca.
    const { marco } = (await srv.dbDono<{ marco: Date }[]>`select clock_timestamp() as marco`)[0]!;
    const depois = await srv.json<RespostaMutacao>("POST", `conversas/${conversa}/mensagens`, { texto: "Durante o deploy" });
    await new Promise((r) => setTimeout(r, 400)); // 10× o outboxMs do servidor de teste
    const pendentes = await srv.db.begin(async (tx) => {
      await vincularEscopo(tx, srv.pessoa);
      return tx<{ n: number; entregues: number }[]>`select count(*)::int as n, count(entregue_em)::int as entregues from events_outbox
        where owner_id = ${srv.pessoa.pessoaId} and criado_em >= ${marco}`;
    });
    expect(pendentes[0]!.n).toBeGreaterThan(0);
    expect(pendentes[0]!.entregues).toBe(0);
    expect((await srv.json<{ turno: { estado: string } }>("GET", `turnos/${depois.ids.turno}`)).turno.estado).toBe("pendente");

    // O navegador reconecta no processo novo com o Last-Event-ID do velho: o anel lá não tem o stream → resumed:false
    // (o cliente reidrata por REST).
    srv.app.tokens.revogar(plano.turnoId);
    await drenagem;
    novo = await servidorCompleto({ pessoaId: srv.pessoa.pessoaId, env: { NOD_MODO: "compartilhado", NOD_LONGPOLL_MS: "20" } });
    const n = novo;
    const noNovo = await abrirSse(n.url, srv.pessoa, cabeca);
    expect(noNovo.res.status).toBe(200);
    await n.esperar(async () => noNovo.retomadas().length > 0, { nome: "resumed no novo" });
    expect(noNovo.retomadas()[0]!.resumed).toBe(false);
    noNovo.fechar();
    // E o processo novo, ativo, entrega o outbox que o velho deixou.
    await n.esperar(async () => {
      const r = await n.db.begin(async (tx) => {
        await vincularEscopo(tx, n.pessoa);
        return tx<{ n: number }[]>`select count(*)::int as n from events_outbox where owner_id = ${n.pessoa.pessoaId} and entregue_em is null and abandonado_em is null and cancelado_em is null`;
      });
      return r[0]!.n === 0;
    }, { nome: "outbox entregue pelo novo" });
  });
});

/**
 * NOD-331: trava a fonte das pessoas só para o varredor de expiração (pela pilha da chamada: o laço chama `listarPessoas`
 * de forma síncrona a partir do `varrer`). É um tick preso num laço só; o despachante e os outros seguem livres.
 */
function portaoDoVarredor() {
  type Pessoas = { tenantId: string; id: string }[];
  let travado = false;
  const presos: (() => void)[] = [];
  return {
    envolver: (listar: () => Promise<Pessoas>) => (): Promise<Pessoas> => {
      if (travado && (new Error().stack ?? "").includes("varredor-expiracao")) return new Promise<Pessoas>((r) => { presos.push(() => void listar().then(r)); });
      return listar();
    },
    travar: () => { travado = true; },
    soltar: () => {
      travado = false;
      for (const p of presos.splice(0)) p();
    },
    presos: () => presos.length,
  };
}

describeIntegracao("NOD-331: drenagem com um tick preso (prazo para parar os laços, SSE e token antes)", () => {
  let m: Awaited<ReturnType<typeof compartilhadoComMaquina>>;
  const portao = portaoDoVarredor();
  beforeAll(async () => {
    m = await compartilhadoComMaquina({ NOD_LONGPOLL_MS: "20" }, { envolverListarPessoas: portao.envolver });
  });
  afterAll(async () => {
    portao.soltar();
    await m?.limpar();
  });

  it("o tick preso não segura a drenagem além do prazo; SSE e token pelo banco vêm antes; o despachante para junto", async () => {
    const { srv, pedir, bot } = m;
    const sse = await abrirSse(srv.url, srv.pessoa);
    await srv.esperar(async () => sse.retomadas().length > 0, { nome: "resumed inicial" });
    const conversa = await bot("Bot NOD-331");
    await srv.json<RespostaMutacao>("POST", `conversas/${conversa}/mensagens`, { texto: "Antes do deploy" });
    const { plano } = (await (await pedir("puxar")).json()) as { plano: PlanoTurno };

    portao.travar();
    await srv.esperar(async () => portao.presos() > 0, { nome: "varredor preso" });
    const inicio = Date.now();
    let resultado: Awaited<ReturnType<typeof srv.drenar>> | null = null;
    const drenagem = srv.drenar({ prazoMs: 5_000, intervaloMs: 50, prazoLacosMs: 1_500 }).then((r) => (resultado = r));

    // (a) Com os laços ainda parando (o varredor preso): o SSE aberto já terminou, o novo dá 503 e o token vale só pelo
    // banco — assentado lá, é negado mesmo com a cópia na memória daqui.
    await sse.terminou;
    const recusado = await fetch(`${srv.url}/api/t/${srv.pessoa.tenantId}/eventos`, { headers: { cookie: srv.pessoa.cookie } });
    expect(recusado.status).toBe(503);
    expect(srv.app.tokens.autorizar(plano.tokenDeTurno)).toBeNull();
    await srv.db.begin(async (tx) => {
      await vincularEscopo(tx, srv.pessoa);
      await tx`update turnos set estado = 'interrompido', motivo_interrupcao = 'reinicio_servidor' where id = ${plano.turnoId}`;
    });
    expect(await srv.app.tokens.autorizarComBanco(plano.tokenDeTurno)).toBeNull();

    // (b) O despachante parou junto (não esperou o varredor): o outbox gravado agora não é marcado por este processo.
    const { marco } = (await srv.dbDono<{ marco: Date }[]>`select clock_timestamp() as marco`)[0]!;
    await srv.json<RespostaMutacao>("POST", `conversas/${conversa}/mensagens`, { texto: "Durante o deploy" });
    await new Promise((r) => setTimeout(r, 400)); // 10× o outboxMs do servidor de teste
    expect(resultado).toBeNull();
    expect(portao.presos()).toBeGreaterThan(0);
    const entregues = async () => (await srv.db.begin(async (tx) => {
      await vincularEscopo(tx, srv.pessoa);
      return tx<{ n: number; entregues: number }[]>`select count(*)::int as n, count(entregue_em)::int as entregues from events_outbox
        where owner_id = ${srv.pessoa.pessoaId} and criado_em >= ${marco}`;
    }))[0]!;
    expect((await entregues()).n).toBeGreaterThan(0);
    expect((await entregues()).entregues).toBe(0);

    // O turno da máquina sai da memória (a outra cor o assentou); só o prazo dos laços segura a drenagem.
    srv.app.tokens.revogar(plano.turnoId);
    expect(await drenagem).toMatchObject({ turnos: 0, prazo_vencido: false, lacos_prazo_vencido: true });
    expect(Date.now() - inicio).toBeLessThan(2_500);
    expect(portao.presos()).toBeGreaterThan(0); // o tick segue preso: a drenagem não esperou por ele
    expect((await entregues()).entregues).toBe(0);
  });
});

describeIntegracao("NOD-331: ligação viva e um tick preso — o que a outra cor entregou chega à ligação", () => {
  let srv: ServidorCompleto;
  const portao = portaoDoVarredor();
  const criados = { agentes: [] as string[], conversas: [] as string[] };
  beforeAll(async () => {
    srv = await servidorCompleto({ env: { NOD_LIGACAO: "todas" }, envolverListarPessoas: portao.envolver });
  });
  afterAll(async () => {
    portao.soltar();
    if (!srv) return;
    await srv.fechar();
    await limparPessoaE2E(srv.db, srv.dbDono, srv.pessoa, criados);
    await srv.desligar();
  });

  it("o modo só ligações começa junto com a parada (desde antecipado) e publica no barramento local o que a ativa marcou", async () => {
    const { agente, conversa } = await srv.json<{ agente: Agente; conversa: Conversa }>("POST", "agentes", { dono: "pessoa", nome: "Nina" });
    criados.agentes.push(agente.id);
    criados.conversas.push(conversa.id);
    await srv.json("POST", "voz/consentimento", { versao: VERSAO_CONSENTIMENTO_VOZ });
    const { ligacao } = await srv.json<{ ligacao: Ligacao }>("POST", "ligacoes", { agenteId: agente.id });
    const host = new URL(srv.url).host;
    const ws = new WebSocket(`${srv.url.replace("http", "ws")}/api/t/${srv.pessoa.tenantId}/voz/v1/midia`, { headers: { cookie: srv.pessoa.cookie, origin: `http://${host}` } });
    ws.on("message", (dados, binario) => {
      if (binario) ws.send(JSON.stringify({ t: "tocou-fim", utt: (dados as Buffer).readUInt16LE(5) }));
    });
    await new Promise<void>((r, j) => {
      ws.once("open", () => r());
      ws.once("error", j);
    });
    ws.send(JSON.stringify({ t: "ola", v: 1, ligacaoId: ligacao.id, entrada: "pcm16", saida: "pcm16" }));
    await srv.esperar(async () => srv.app.voz.vivas() === 1, { nome: "ligação viva" });

    const eventos: unknown[] = [];
    const sair = srv.app.barramento.inscrever(srv.pessoa.pessoaId, (f) => eventos.push(f.dados.eventoId));
    portao.travar();
    await srv.esperar(async () => portao.presos() > 0, { nome: "varredor preso" });
    let resultado: Awaited<ReturnType<typeof srv.drenar>> | null = null;
    const drenagem = srv.drenar({ prazoMs: 30_000, intervaloMs: 50, prazoLacosMs: 20_000 }).then((r) => (resultado = r));
    await new Promise((r) => setTimeout(r, 200));

    // A outra cor grava e já marca entregue (ela ganha sempre a corrida dos pendentes) enquanto o varredor daqui segue preso.
    const eventoId = randomUUID();
    await srv.db.begin(async (tx) => {
      await vincularEscopo(tx, srv.pessoa);
      await tx`insert into events_outbox (id, owner_id, evento_id, tipo, entregue_em)
        values (${randomUUID()}, ${srv.pessoa.pessoaId}, ${eventoId}, 'negacao', clock_timestamp())`;
    });
    await srv.esperar(async () => eventos.includes(eventoId), { nome: "frame da outra cor no barramento local" });
    expect(resultado).toBeNull();
    expect(portao.presos()).toBeGreaterThan(0);

    portao.soltar();
    ws.send(JSON.stringify({ t: "tchau" }));
    expect(await drenagem).toMatchObject({ vivas: 0, prazo_vencido: false, lacos_prazo_vencido: false });
    sair();
    ws.close();
    await srv.db.begin(async (tx) => {
      await vincularEscopo(tx, srv.pessoa);
      await tx`delete from events_outbox where evento_id = ${eventoId}`;
    });
  });
});

/**
 * NOD-331 (item 2): o turno que a outra cor assentou deixa de segurar a drenagem. A cada `PODA_TOKENS_MS` o processo
 * velho confere no banco os tokens que espera e poda o que já não está `despachando`. A poda roda sem await: presa, ela
 * não segura a checagem do prazo.
 */
describeIntegracao("NOD-331: a drenagem poda pelo banco o token do turno assentado em outro processo", () => {
  let m: Awaited<ReturnType<typeof compartilhadoComMaquina>>;
  beforeAll(async () => {
    m = await compartilhadoComMaquina({ NOD_LONGPOLL_MS: "20" });
  });
  afterAll(async () => {
    await m?.limpar();
  });

  it("turno assentado no banco: a drenagem termina com turnos 0, sem vencer o prazo, em menos de 7 s", async () => {
    const { srv, pedir, bot } = m;
    const conversa = await bot("Bot poda");
    await srv.json<RespostaMutacao>("POST", `conversas/${conversa}/mensagens`, { texto: "Antes do deploy" });
    const { plano } = (await (await pedir("puxar")).json()) as { plano: PlanoTurno };
    expect(srv.app.tokens.ativos({ semSobrevive: true })).toBe(1);
    // A outra cor (a ativa) assentou o turno; a memória deste processo não sabe.
    await srv.db.begin(async (tx) => {
      await vincularEscopo(tx, srv.pessoa);
      await tx`update turnos set estado = 'interrompido', motivo_interrupcao = 'reinicio_servidor' where id = ${plano.turnoId}`;
    });
    const inicio = Date.now();
    const r = await srv.drenar({ prazoMs: 30_000, intervaloMs: 50 });
    expect(Date.now() - inicio).toBeLessThan(7_000);
    expect(r).toMatchObject({ turnos: 0, prazo_vencido: false });
    expect(srv.app.tokens.credencialDe(plano.turnoId)).toBeNull();
  });
});

describeIntegracao("NOD-331: poda presa não segura o prazo da drenagem", () => {
  let m: Awaited<ReturnType<typeof compartilhadoComMaquina>>;
  beforeAll(async () => {
    m = await compartilhadoComMaquina({ NOD_LONGPOLL_MS: "20" });
  });
  afterAll(async () => {
    await m?.limpar();
  });

  it("com a consulta da poda que nunca volta, drenar({prazoMs: 500}) resolve no prazo com prazo_vencido", async () => {
    const { srv, pedir, bot } = m;
    const conversa = await bot("Bot poda presa");
    await srv.json<RespostaMutacao>("POST", `conversas/${conversa}/mensagens`, { texto: "Antes do deploy" });
    const { plano } = (await (await pedir("puxar")).json()) as { plano: PlanoTurno };
    let chamadas = 0;
    srv.app.tokens.podarPeloBanco = () => {
      chamadas += 1;
      return new Promise<number>(() => undefined);
    };
    const inicio = Date.now();
    const r = await srv.drenar({ prazoMs: 500, intervaloMs: 50 });
    expect(Date.now() - inicio).toBeLessThan(2_000);
    expect(r).toMatchObject({ turnos: 1, prazo_vencido: true });
    // Uma em voo por vez: presa, a próxima não sai.
    expect(chamadas).toBe(1);
    srv.app.tokens.revogar(plano.turnoId);
  });
});
