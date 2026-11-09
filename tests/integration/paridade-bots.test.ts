import { afterAll, beforeAll, expect, it } from "vitest";
import { criarRotasAgentes } from "../../src/adapters/http/rotas/agentes.ts";
import type { DepsRotas } from "../../src/adapters/http/rotas/executar-caso.ts";
import type { Agente } from "../../src/contracts/agente.ts";
import type { EfeitoAposCommit } from "../../src/contracts/acoes.ts";
import type { AcaoLote } from "../../src/contracts/ferramentas-do-nod.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import { EXECUTORES_BOTS } from "../../src/use-cases/acoes/bots.ts";
import { gerirBots } from "../../src/use-cases/gerir-bots.ts";
import { garantirNod } from "../../src/use-cases/onboarding.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { depsSobreTrx, executar, MARLON, servicosDeTeste, useCasesDeTeste } from "../helpers/deps-l6.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../helpers/servidor-de-teste.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * NOD-391 (ADR-135): o teste de contrato do piloto `bots.*`. A mesma ação pela tela (rota HTTP) e pelo chat (gerir_bots do
 * Nod) chega ao MESMO estado no banco, e o excluir dos dois caminhos pede o desligamento do computador depois do commit.
 * É o arquivo que o registro cita como `contrato` das ações vivas (src/domain/acoes/bots.ts).
 */

type Retrato = { nome: string; titulo: string; descricao: string; modelo: string; esforco: string | null; secao: string | null; modo: string | null; excluido: boolean };
const retrato = (a: Agente | null | undefined): Retrato | null =>
  a ? { nome: a.nome, titulo: a.titulo, descricao: a.descricao, modelo: a.modelo, esforco: a.esforco ?? null, secao: a.secao ?? null, modo: a.modoAprovacao ?? null, excluido: a.excluidoEm != null } : null;

describeIntegracao("paridade tela × chat do piloto bots.* (NOD-391, ADR-135)", () => {
  let servidor: ServidorDeTeste;
  let trxAtual: Tx | null = null;
  const efeitosDaRota: { escopo: Escopo; efeito: EfeitoAposCommit }[] = [];

  beforeAll(async () => {
    const deps: DepsRotas = {
      abrirTx:
        (escopo: Escopo) =>
        async <T,>(fn: (t: Tx) => Promise<T>): Promise<T> => {
          const trx = trxAtual;
          if (!trx) throw new Error("teste sem transação aberta");
          const caixa: { valor?: T } = {};
          await trx.savepoint(async (sp) => {
            await vincularEscopo(sp, escopo);
            caixa.valor = await fn(sp);
          });
          return caixa.valor as T;
        },
      services: servicosDeTeste((t) => criarRepos(t, MARLON), MARLON),
      useCases: useCasesDeTeste(),
      prazoDecisaoMs: 60_000,
      executor: "catcher",
      // Um padrão diferente de "auto": a tela e o lote criam o bot sem modelo com o MESMO padrão (bug do QA do #563).
      modeloPadrao: "sonnet",
      rodarAposCommit: async (escopo, efeito) => {
        efeitosDaRota.push({ escopo, efeito });
      },
    };
    servidor = await servidorDeTeste(criarRotasAgentes(deps));
  });
  afterAll(() => servidor.close());

  /** O Nod em "Ignorar todas as aprovações": o lote roda na hora, sem card, para comparar o efeito puro. */
  async function nodQueFaz(d: Deps) {
    const { nod } = (await executar(d, garantirNod, {})).data;
    await d.repos.agentes.definirModoAprovacao(nod.id, "total");
    const turno = await d.repos.turnos.enfileirar({ executor: "catcher", conversaId: nod.conversaId, agenteId: nod.id, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "pedido", entradaConfianca: "confiavel", modelo: "auto" });
    if (!turno) throw new Error("turno");
    return { turnoId: turno.id, agenteId: nod.id, conversaId: nod.conversaId };
  }

  const pessoaBot = async (d: Deps, nome: string) => (await executar(d, criarAgente, { dono: "pessoa", nome, descricao: `${nome} trabalha.` })).data;
  const porNome = async (d: Deps, nome: string) => (await d.repos.agentes.listar({ incluirOcultos: true, incluirExcluidos: true })).find((a) => a.nome === nome && a.ownerId === MARLON.pessoaId) ?? null;
  const estadoDe = async (d: Deps, nome: string) => retrato(await porNome(d, nome));
  /** O mesmo retrato, com o nome do lado da tela trocado pelo do chat ("Tela" → "Chat"; a descrição padrão repete o nome). */
  const comoChat = <T,>(v: T): T => JSON.parse(JSON.stringify(v).replaceAll("Tela", "Chat")) as T;

  type Cenario = {
    id: string;
    /** O que a tela faz sobre o bot "Bot Tela" (status esperado incluso). */
    tela: (alvo: string) => { metodo: string; caminho: string; corpo?: unknown; status: number };
    /** A mesma ação no lote, sobre o bot "Bot Chat". */
    chat: (alvo: string) => AcaoLote;
    /** Os bots cujo estado final é comparado (nomes do lado da tela). */
    comparar: string[];
    /** Preparo igual nos dois bots antes da ação (NOD-20: restaurar precisa de uma versão anterior). */
    preparar?: (d: Deps, agenteId: string) => Promise<void>;
  };
  const CENARIOS: Cenario[] = [
    { id: "bots.criar", tela: () => ({ metodo: "POST", caminho: "/agentes", corpo: { dono: "pessoa", nome: "Novo Tela", titulo: "Revisor", descricao: "Revisa PR." }, status: 201 }), chat: () => ({ tipo: "criar", nome: "Novo Chat", titulo: "Revisor", descricao: "Revisa PR." }), comparar: ["Novo Tela"] },
    { id: "bots.duplicar", tela: (a) => ({ metodo: "POST", caminho: `/agentes/${a}/duplicar`, status: 201 }), chat: (a) => ({ tipo: "duplicar", bot: a }), comparar: ["Bot Tela", "Bot Tela (cópia)"] },
    { id: "bots.editar", tela: (a) => ({ metodo: "PATCH", caminho: `/agentes/${a}`, corpo: { titulo: "Dev", descricao: "Escreve código.", modelo: "opus", esforco: "high" }, status: 200 }), chat: (a) => ({ tipo: "editar", bot: a, titulo: "Dev", descricao: "Escreve código.", modelo: "opus", esforco: "high" }), comparar: ["Bot Tela"] },
    { id: "bots.mover", tela: (a) => ({ metodo: "PATCH", caminho: `/agentes/${a}/organizacao`, corpo: { secao: "Engenharia" }, status: 200 }), chat: (a) => ({ tipo: "mover", bot: a, secao: "Engenharia" }), comparar: ["Bot Tela"] },
    { id: "bots.mudar_modo", tela: (a) => ({ metodo: "POST", caminho: `/agentes/${a}/modo-aprovacao`, corpo: { modo: "automatico" }, status: 200 }), chat: (a) => ({ tipo: "mudar_modo", bot: a, modo: "automatico" }), comparar: ["Bot Tela"] },
    // NOD-20: os dois bots ganham a v2 (missão nova) e voltam à v1 — mesma descrição, mesma versão nova (3, restauracao).
    { id: "bots.restaurar_versao", preparar: async (d, a) => void (await executar(d, EXECUTORES_BOTS["bots.editar"], { agenteId: a, descricao: "Missão nova." })), tela: (a) => ({ metodo: "POST", caminho: `/agentes/${a}/perfil/versoes/1/restaurar`, status: 200 }), chat: (a) => ({ tipo: "restaurar_versao", bot: a, versao: 1 }), comparar: ["Bot Tela"] },
    { id: "bots.excluir", tela: (a) => ({ metodo: "DELETE", caminho: `/agentes/${a}`, status: 200 }), chat: (a) => ({ tipo: "excluir", bot: a }), comparar: ["Bot Tela"] },
  ];

  it("cobre exatamente as ações vivas do piloto", () => {
    expect(CENARIOS.map((c) => c.id).sort()).toEqual(Object.keys(EXECUTORES_BOTS).sort());
  });

  it.each(CENARIOS)("$id: a rota e o gerir_bots levam o mesmo estado inicial ao mesmo estado final", async (c) => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      efeitosDaRota.length = 0;
      const d = depsSobreTrx(trx, MARLON);
      const efeitosDoLote: EfeitoAposCommit[] = [];
      const dChat: Deps = { ...d, modeloPadrao: "sonnet", aposCommit: (e) => void efeitosDoLote.push(e) };
      const sessao = await servidor.entrar("marlon");
      const ctx = await nodQueFaz(d);
      // O mesmo estado inicial dos dois lados: um bot com uma rotina ativa.
      const [tela, chat] = [await pessoaBot(d, "Bot Tela"), await pessoaBot(d, "Bot Chat")];
      for (const b of [tela, chat]) await d.repos.rotinas.criar({ agenteId: b.agente.id, conversaId: b.conversa.id, cron: "0 8 * * *", fusoIana: "UTC", instrucao: "Olhar PRs", fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p", proximaExecucao: Date.now() + 60_000 });
      expect(comoChat(retrato(tela.agente))).toEqual(retrato(chat.agente));
      for (const b of [tela, chat]) await c.preparar?.(d, b.agente.id);

      const t = c.tela(tela.agente.id);
      expect((await servidor.chamar(sessao, t.metodo, t.caminho, t.corpo)).status).toBe(t.status);
      const r = await gerirBots(dChat, { ...ctx, resumo: c.id, acoes: [c.chat(chat.agente.id)] });
      expect(r.data).toMatchObject({ ok: true, esperando: [], falhas: [] });

      for (const nome of c.comparar) {
        const doLadoDaTela = await estadoDe(d, nome);
        expect(doLadoDaTela).not.toBeNull();
        expect(await estadoDe(d, nome.replace("Tela", "Chat"))).toEqual(comoChat(doLadoDaTela));
      }

      if (c.id === "bots.restaurar_versao") {
        const versoes = async (id: string) => (await d.repos.versoesPerfil.listar(id, null, 10)).versoes.map((v) => [v.versao, v.origem, v.restauradaDe, v.perfil.descricao]);
        expect(await versoes(tela.agente.id)).toEqual(comoChat(await versoes(chat.agente.id)).map((v) => v.map((x) => (typeof x === "string" ? x.replaceAll("Chat", "Tela") : x))));
        expect((await versoes(tela.agente.id))[0]).toEqual([3, "restauracao", 1, "Bot Tela trabalha."]);
        // QA (bug 3): quem restaurou pelo chat foi o Nod; pela tela, a pessoa.
        const autor = async (id: string) => (await d.repos.versoesPerfil.listar(id, null, 1)).versoes[0]?.autor;
        expect([await autor(chat.agente.id), await autor(tela.agente.id)]).toEqual(["nod", "pessoa"]);
        // Revisão 3 M2: a falha leva a causa ao Nod (a Atual: igual_a_atual), não só o código.
        const igual = await gerirBots(dChat, { ...ctx, resumo: "de novo", acoes: [{ tipo: "restaurar_versao", bot: chat.agente.id, versao: 3 }] });
        expect(igual.data).toMatchObject({ ok: true, falhas: [{ i: 0, erro: "igual_a_atual" }] });
      }

      if (c.id === "bots.criar") {
        // Iguais E no padrão de NOD_MODELO: os dois lados caírem juntos no "auto" também seria divergência da tela de hoje.
        expect((await estadoDe(d, "Novo Tela"))?.modelo).toBe("sonnet");
      }

      if (c.id === "bots.excluir") {
        // O computador: os dois caminhos pedem o desligamento do bot excluído, depois do commit (a diferença que a ADR-135 fechou).
        expect(efeitosDaRota).toEqual([{ escopo: expect.objectContaining({ tenantId: MARLON.tenantId, pessoaId: MARLON.pessoaId }), efeito: { tipo: "desligar_computador", agenteId: tela.agente.id } }]);
        expect(efeitosDoLote).toEqual([{ tipo: "desligar_computador", agenteId: chat.agente.id }]);
      } else {
        expect(efeitosDaRota).toEqual([]);
        expect(efeitosDoLote).toEqual([]);
      }

      if (c.id === "bots.duplicar") {
        // A diferença escrita (ADR-135 §4): pelo Nod a cópia nasce com as rotinas pausadas; pela tela, como no original.
        const rotinasDa = async (nome: string) => (await d.repos.rotinas.listarDoAgente((await porNome(d, nome))?.id ?? "")).map((x) => x.estado);
        expect(await rotinasDa("Bot Tela (cópia)")).toEqual(["ativa"]);
        expect(await rotinasDa("Bot Chat (cópia)")).toEqual(["pausada"]);
      }
    });
  });
});
