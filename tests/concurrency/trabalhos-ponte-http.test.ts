import { afterAll, beforeAll, expect, it } from "vitest";
import type { Agente } from "../../src/contracts/agente.ts";
import type { Conversa } from "../../src/contracts/conversa.ts";
import type { PlanoTurno } from "../../src/contracts/plano-turno.ts";
import type { TrabalhosDto } from "../../src/contracts/trabalho.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarTrabalho } from "../../src/use-cases/trabalhos.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorCompleto, type ServidorCompleto } from "../helpers/servidor-completo.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * ADR-083 pela ponte HTTP das máquinas (modo compartilhado), com commit: a memória do Mac na renovação (#194) e a fala
 * mandada à task entrando no turno vivo dela (#193). Limpeza própria por pessoa.
 */
describeIntegracao("trabalhos pela ponte HTTP: memória do Mac e mensagem para a task", () => {
  let srv: ServidorCompleto;
  let chave = "", agenteId = "", conversaId = "";
  const sinais = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true };
  const pedir = (nome: string, body: unknown = {}) => fetch(`${srv.url}/api/maquina/${nome}`, {
    method: "POST", headers: { authorization: `Bearer ${chave}`, "content-type": "application/json", "x-nod-versao": "0.1.0" }, body: JSON.stringify(body),
  });
  const pressoes = () => srv.db.begin(async (tx) => {
    await vincularEscopo(tx, srv.pessoa);
    return (await tx<{ dados: { nivel: string } }[]>`select dados from events where owner_id = ${srv.pessoa.pessoaId} and kind = 'pressao_memoria' order by created_at`).map((l) => l.dados.nivel);
  });

  beforeAll(async () => {
    srv = await servidorCompleto({ env: { NOD_MODO: "compartilhado", NOD_LONGPOLL_MS: "20" } });
    const a = await srv.json<{ chave: string }>("POST", "maquinas/chaves", { nome: "Mac A" });
    chave = a.chave;
    const bot = await srv.json<{ agente: Agente; conversa: Conversa }>("POST", "agentes", { dono: "pessoa", nome: "Bot das tasks", descricao: "Trabalha em paralelo" });
    agenteId = bot.agente.id; conversaId = bot.conversa.id;
    expect((await pedir("conectar", { nome: "Mac", versaoContrato: 1, inventario: { estado: "pronto", versao: "fake-sem-custo", em: 0 } })).status).toBe(200);
  });
  afterAll(async () => {
    if (!srv) return;
    await srv.fechar();
    await srv.db.begin(async (tx) => { await vincularEscopo(tx, srv.pessoa); await tx`delete from maquina_tokens where owner_id = ${srv.pessoa.pessoaId}`; });
    await limparPessoaE2E(srv.db, srv.dbDono, srv.pessoa, { agentes: [agenteId], conversas: [conversaId] });
    await srv.desligar();
  });

  it("#194: amarela publica uma vez, repetir não republica, vermelha publica de novo e nada é encerrado; a memória do turno vai para a task", async () => {
    const trabalhoId = await srv.app.dentro(srv.pessoa, async (d) => {
      const { trabalho, events } = await criarTrabalho(d, { agenteId, conversaId, titulo: "Relatório pesado", origem: "pessoa" });
      await d.repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", trabalhoId: trabalho.id, prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "monte o relatório", entradaConfianca: "confiavel", modelo: "auto", harness: "auto" });
      await d.repos.events.gravarComOutbox(events);
      return trabalho.id;
    });
    const { plano } = await (await pedir("puxar")).json() as { plano: PlanoTurno };
    expect(plano.turnoId).toBeTruthy();
    const renovar = (nivel: "verde" | "amarela" | "vermelha", mb: number) => pedir("renovar", { turnoId: plano.turnoId, sinais, eventos: [], memoria: { nivel, totalMb: 9000, porTurno: [{ turnoId: plano.turnoId, mb }] } });

    expect((await (await renovar("amarela", 512)).json() as { ativo: boolean }).ativo).toBe(true);
    expect((await (await renovar("amarela", 600)).json() as { ativo: boolean }).ativo).toBe(true);
    expect(await pressoes()).toEqual(["amarela"]);
    const lista = await srv.json<TrabalhosDto>("GET", `trabalhos?agenteId=${agenteId}`);
    expect(lista.pressao).toBe("amarela");
    expect(lista.memoriaTotalMb).toBe(9000);
    expect(lista.trabalhos.find((t) => t.id === trabalhoId)).toMatchObject({ estado: "rodando", memoriaMb: 600, turnoVivoId: plano.turnoId });

    // Vermelha: aviso de novo, e o turno segue vivo (nenhum trabalho rodando é encerrado).
    expect((await (await renovar("vermelha", 700)).json() as { ativo: boolean }).ativo).toBe(true);
    expect(await pressoes()).toEqual(["amarela", "vermelha"]);
    expect((await pedir("renovar", { turnoId: plano.turnoId, sinais, eventos: [], memoria: { nivel: "roxa", totalMb: 1, porTurno: [] } })).status).toBe(400);

    // #193: a pessoa escreve na tela da task; a renovação com a entrada aberta entrega o texto ao turno vivo dela.
    expect((await srv.chamar("POST", `trabalhos/${trabalhoId}/mensagens`, { texto: "Inclua o mês passado" })).status).toBe(201);
    const comMensagem = await (await pedir("renovar", { turnoId: plano.turnoId, sinais, eventos: [], aceitaMensagens: true })).json() as { ativo: boolean; mensagens?: string[] };
    expect(comMensagem.mensagens).toEqual(["Inclua o mês passado"]);
    const detalhe = await srv.json<{ mensagens: { texto: string; trabalhoId: string | null }[] }>("GET", `trabalhos/${trabalhoId}`);
    expect(detalhe.mensagens.map((m) => [m.texto, m.trabalhoId])).toContainEqual(["Inclua o mês passado", trabalhoId]);

    await pedir("entregar", { turnoId: plano.turnoId, machineId: plano.machineId, seqLocal: 1, fala: { tipo: "texto", texto: "Relatório pronto." }, resultado: {
      desfecho: "sucesso", texto: "Relatório pronto.", sessaoCli: null, sinais, custoUsd: 0, tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [],
    } });
    const fim = await srv.json<TrabalhosDto>("GET", `trabalhos?agenteId=${agenteId}`);
    expect(fim.trabalhos.find((t) => t.id === trabalhoId)?.estado).toBe("terminado");
  });
});
