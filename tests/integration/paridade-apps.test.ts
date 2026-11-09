import { afterAll, beforeAll, expect, it } from "vitest";
import { rotasApps } from "../../src/adapters/http/rotas/apps.ts";
import type { DepsRotas } from "../../src/adapters/http/rotas/executar-caso.ts";
import type { ArgsGerirApps, PaginasDto } from "../../src/contracts/apps.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { ACOES_APPS } from "../../src/domain/acoes/apps.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { EXECUTORES_APPS, verPaginas } from "../../src/use-cases/acoes/apps.ts";
import { gerirApps } from "../../src/use-cases/gerir-apps.ts";
import { garantirNod } from "../../src/use-cases/onboarding.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { depsSobreTrx, executar, MARLON, servicosDeTeste, useCasesDeTeste } from "../helpers/deps-l6.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../helpers/servidor-de-teste.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * NOD-445 (ADR-135, ADR-146): o teste de contrato das ações `paginas.*`. A mesma ação pela tela (a rota HTTP, ou o
 * executor com a pessoa de autora quando a ação não tem rota) e pelo chat (gerir_apps de um bot) leva o mesmo estado
 * inicial ao mesmo estado final no banco, e qualquer bot faz igual. É o arquivo que o registro cita como `contrato`.
 */

type Estado = { ordem: string[]; apps: unknown[] };
const retrato = (p: PaginasDto): Estado => {
  const nome = (id: string) => (id.startsWith("app:") ? p.apps.find((a) => `app:${a.id}` === id)?.nome ?? "?" : id);
  return { ordem: p.ordem.map(nome), apps: p.apps.map((a) => [a.nome, a.icone, a.forma, a.fonte, a.fonteRef, a.regraPede, a.dados, a.erroFonte, a.pedeVoce]) };
};

describeIntegracao("paridade tela × chat das páginas do bot, paginas.* (NOD-445, ADR-135)", () => {
  let servidor: ServidorDeTeste;
  let trxAtual: Tx | null = null;

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
      executor: "catcher",
    };
    servidor = await servidorDeTeste(rotasApps(deps));
  });
  afterAll(() => servidor.close());

  async function turnoDe(d: Deps, agenteId: string, conversaId: string) {
    const turno = await d.repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "pedido", entradaConfianca: "confiavel", modelo: "auto" });
    if (!turno) throw new Error("turno");
    return { turnoId: turno.id, agenteId, conversaId };
  }

  async function montar(trx: Tx) {
    const d = depsSobreTrx(trx, MARLON);
    await d.repos.preferencias.gravar({ experimentos: { quadro: true } });
    const sufixo = Math.random().toString(36).slice(2, 7);
    const tela = await agenteComConversa(trx, MARLON, { nome: `Tela ${sufixo}` });
    const chat = await agenteComConversa(trx, MARLON, { nome: `Chat ${sufixo}` });
    return { d, tela, chat };
  }
  type M = Awaited<ReturnType<typeof montar>>;

  /** O mesmo preparo nos dois bots: Vagas e Leituras (pelo repo, como se o card já tivesse sido confirmado). */
  async function preparar(m: M, agenteId: string) {
    for (const nome of ["Vagas", "Leituras"]) await m.d.repos.appsDoBot.criar({ agenteId, nome, icone: "lista", fonte: "bot", fonteRef: null, forma: "lista", quemVe: "so_eu", regraPede: null });
  }
  const estado = async (m: M, agenteId: string) => {
    const r = await executar(m.d, verPaginas, { agenteId });
    return retrato(r.data.paginas);
  };
  const idDe = async (m: M, agenteId: string, nome: string) => (await m.d.repos.appsDoBot.doAgente(agenteId)).find((a) => a.nome === nome)!.id;
  const peloChat = async (m: M, quem: { agenteId: string; conversaId: string }, args: ArgsGerirApps) => {
    const r = await executar(m.d, gerirApps, { ...(await turnoDe(m.d, quem.agenteId, quem.conversaId)), ...args });
    expect(r.data, JSON.stringify(r.data)).toMatchObject({ ok: true });
    return r.data;
  };

  type Cenario = {
    id: (typeof ACOES_APPS)[number]["id"];
    /** Antes da ação, nos dois bots (depois do preparo). */
    antes?: (m: M, agenteId: string) => Promise<void>;
    tela: (m: M, agenteId: string) => Promise<void>;
    chat: (m: M) => Promise<void>;
  };
  const CENARIOS: Cenario[] = [
    {
      // Pela tela, criar é o Criar do card (o executor da decisão); pelo chat, o propor abre o card e a pessoa confirma.
      id: "paginas.criar_app",
      tela: async (m, agenteId) => {
        const p = await peloChat(m, m.tela, { op: "propor", bot: agenteId, nome: "Contas", forma: "painel", regra_pede: "conta vencendo" });
        if (!p.ok) throw new Error("sem card");
        await executar(m.d, EXECUTORES_APPS["paginas.criar_app"], { decisaoId: p.proposta_id!, recusar: false });
      },
      chat: async (m) => {
        const p = await peloChat(m, m.chat, { op: "propor", nome: "Contas", forma: "painel", regra_pede: "conta vencendo" });
        if (!p.ok) throw new Error("sem card");
        // Antes de confirmar, nada nasceu.
        expect((await estado(m, m.chat.agenteId)).ordem).not.toContain("Contas");
        await executar(m.d, EXECUTORES_APPS["paginas.criar_app"], { decisaoId: p.proposta_id!, recusar: false });
      },
    },
    {
      // Sem rota: editar o app é pela conversa. O lado da tela é o executor com a pessoa de autora.
      id: "paginas.editar_app",
      tela: async (m, agenteId) => {
        await executar(m.d, EXECUTORES_APPS["paginas.editar_app"], { agenteId, app: await idDe(m, agenteId, "Vagas"), nome: "Vagas abertas", forma: "quadro", regra_pede: "sem resposta há 2 dias", dados: { itens: [{ titulo: "Dev", pede: true }] } });
      },
      chat: async (m) => {
        await peloChat(m, m.chat, { op: "editar", app: "vagas", nome: "Vagas abertas", forma: "quadro", regra_pede: "sem resposta há 2 dias", dados: { itens: [{ titulo: "Dev", pede: true }] } });
      },
    },
    {
      // Qualquer página muda de lugar, a Conversa inclusive; a primeira é a home.
      id: "paginas.ordenar",
      tela: async (m, agenteId) => {
        const s = await servidor.entrar("marlon");
        const r = await servidor.chamar(s, "PUT", `/agentes/${agenteId}/paginas/ordem`, { pagina: "conversa", depois_de: "Leituras" });
        expect(r.status, await r.clone().text()).toBe(200);
      },
      chat: async (m) => {
        await peloChat(m, m.chat, { op: "ordenar", pagina: "Conversa", depois_de: "leituras" });
      },
    },
    {
      id: "paginas.remover_app",
      tela: async (m, agenteId) => {
        const s = await servidor.entrar("marlon");
        const r = await servidor.chamar(s, "DELETE", `/agentes/${agenteId}/apps/${await idDe(m, agenteId, "Vagas")}`);
        expect(r.status, await r.clone().text()).toBe(200);
      },
      chat: async (m) => {
        await peloChat(m, m.chat, { op: "remover", app: "Vagas" });
      },
    },
    {
      // O Desfazer: o app volta no MESMO lugar (a ordem guardada ainda tem o id).
      id: "paginas.restaurar_app",
      antes: async (m, agenteId) => {
        await executar(m.d, EXECUTORES_APPS["paginas.ordenar"], { agenteId, pagina: "Vagas", posicao: 1 });
        await executar(m.d, EXECUTORES_APPS["paginas.remover_app"], { agenteId, app: await idDe(m, agenteId, "Vagas") });
      },
      tela: async (m, agenteId) => {
        const s = await servidor.entrar("marlon");
        const id = await removidoDe(m, agenteId);
        const r = await servidor.chamar(s, "POST", `/agentes/${agenteId}/apps/${id}/restaurar`);
        expect(r.status, await r.clone().text()).toBe(200);
      },
      chat: async (m) => {
        await peloChat(m, m.chat, { op: "restaurar", app: await removidoDe(m, m.chat.agenteId) });
      },
    },
  ];

  /** O id do app removido do bot (o Desfazer o tem no toast; o bot, no resultado do remover). */
  async function removidoDe(m: M, agenteId: string): Promise<string> {
    const ordem = (await m.d.repos.appsDoBot.ordem(agenteId)) ?? [];
    const vivos = new Set((await m.d.repos.appsDoBot.doAgente(agenteId)).map((a) => `app:${a.id}`));
    const id = ordem.find((p) => p.startsWith("app:") && !vivos.has(p));
    if (!id) throw new Error("sem removido");
    return id.slice(4);
  }

  it("cobre exatamente as ações das páginas, e o executor de cada uma existe", () => {
    expect(CENARIOS.map((c) => c.id).sort()).toEqual(ACOES_APPS.map((a) => a.id).sort());
    expect(Object.keys(EXECUTORES_APPS).sort()).toEqual(ACOES_APPS.map((a) => a.id).sort());
  });

  it.each(CENARIOS)("$id: a tela e o gerir_apps levam o mesmo estado inicial ao mesmo estado final", async (c) => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const m = await montar(trx);
      for (const a of [m.tela.agenteId, m.chat.agenteId]) {
        await preparar(m, a);
        await c.antes?.(m, a);
      }
      const inicial = await estado(m, m.tela.agenteId);
      expect(await estado(m, m.chat.agenteId)).toEqual(inicial);
      await c.tela(m, m.tela.agenteId);
      await c.chat(m);
      const final = await estado(m, m.tela.agenteId);
      expect(final).not.toEqual(inicial);
      expect(await estado(m, m.chat.agenteId)).toEqual(final);
    });
  });

  it("qualquer bot: o Nod e um bot comum fazem a mesma jornada e chegam às mesmas páginas", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      // A trava do Nod ANTES das preferências (o montar grava): o garantirNod trava e depois grava as preferências (a guia);
      // na ordem inversa, outro arquivo em paralelo com o Nod da mesma pessoa fazia deadlock (CI da main @0d2345b4).
      const { nod } = (await executar(depsSobreTrx(trx, MARLON), garantirNod, {})).data;
      const m = await montar(trx);
      const jornada = async (quem: { agenteId: string; conversaId: string }, alvo: string) => {
        const p = await peloChat(m, quem, { op: "propor", bot: alvo, nome: "Vagas", forma: "lista", regra_pede: "vaga parada" });
        if (!p.ok) throw new Error("sem card");
        await executar(m.d, EXECUTORES_APPS["paginas.criar_app"], { decisaoId: p.proposta_id!, recusar: false });
        await peloChat(m, quem, { op: "ordenar", bot: alvo, pagina: "Vagas", posicao: 1 });
        // Configuração vale de qualquer bot; o retrato, só do bot dono do app (revisão 5 do #626).
        await peloChat(m, quem, { op: "editar", bot: alvo, app: "Vagas", forma: "quadro" });
      };
      await jornada({ agenteId: nod.id, conversaId: nod.conversaId }, m.tela.agenteId);
      const retratoAlheio = await executar(m.d, gerirApps, { ...(await turnoDe(m.d, nod.id, nod.conversaId)), op: "editar", bot: m.tela.agenteId, app: "Vagas", dados: { itens: [{ titulo: "Dev" }] } });
      expect(retratoAlheio.data).toMatchObject({ ok: false, erro: "entrada_invalida" });
      await jornada(m.chat, m.chat.agenteId);
      const final = await estado(m, m.tela.agenteId);
      expect(final.ordem).toEqual(["Vagas", "conversa"]);
      expect(await estado(m, m.chat.agenteId)).toEqual(final);
    });
  });
});
