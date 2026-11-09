import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { expect, it, vi } from "vitest";
import { rotasConcessoes } from "../../src/adapters/http/rotas/concessoes.ts";
import type { CapacidadeConector } from "../../src/contracts/conector.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import { JANELA_RETOMADA_APOS_LIBERAR_MS } from "../../src/use-cases/retomar-apos-liberar.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { ANA, MARLON, depsSobreTrx, esperarErro } from "../helpers/deps-l6.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * definido em 2026-10-05: o cartão da conversa que oferece liberar apps recém-conectados, no Postgres de verdade —
 * pela rota de pessoa que a web chama (rotas/concessoes.ts), sob RLS. Permitir grava as concessões com o consentimento
 * de cada app (FK da concessão para a mensagem, payload jsonb) e a retomada do bot; "Agora não" grava a dispensa da
 * 0054, que só quem dispensou lê.
 */
const cap = (nome: string, readOnlyHint: boolean): CapacidadeConector => ({ nome, descricao: nome.toLowerCase(), schema: { type: "object" }, readOnlyHint });
const GMAIL = [cap("GMAIL_FETCH_EMAILS", true), cap("GMAIL_GET_PROFILE", true), cap("GMAIL_SEND_EMAIL", false), cap("GMAIL_DELETE_MESSAGE", false)];
const SLACK = [cap("SLACK_LIST_CHANNELS", true), cap("SLACK_SEND_MESSAGE", false)];

function rota(deps: Deps, qual: "GET" | "liberar" | "dispensar", agenteId: string) {
  const achada = rotasConcessoes({ dentro: async (_escopo, fn) => fn(deps) }).find((r) => (qual === "GET" ? r.metodo === "GET" : r.padrao.source.endsWith(`${qual}$`)));
  if (!achada || achada.publica) throw new Error(`rota ${qual}`);
  return async <T>(corpo: unknown = null): Promise<T> => {
    const req = new IncomingMessage(new Socket());
    const json = vi.fn();
    await achada.handler({ req, res: new ServerResponse(req), escopo: deps.escopo, params: { id: agenteId }, corpo: async () => corpo, json });
    return json.mock.calls[0]?.[1] as T;
  };
}

async function preparar(d: Deps) {
  const { data: bot } = await criarAgente(d, { dono: "pessoa", nome: "Assistente pessoal", descricao: "Cuida do dia" });
  const app = async (nome: string, slug: string, catalogo: CapacidadeConector[]) => {
    const c = await d.repos.conectores.criar({ nome, slug: `${slug}-${bot.agente.id.slice(0, 8)}`, transporte: "http", url: "https://example.com/mcp", declaracao: "nao-toca" });
    if (!c) throw new Error("conector");
    const sondado = await d.repos.conectores.registrarSonda(c.id, { ok: true, catalogo, agora: d.agora() });
    if (!sondado?.habilitado) throw new Error("sonda");
    return sondado;
  };
  return { bot, gmail: await app("Gmail", "gmail", GMAIL), slack: await app("Slack", "slack", SLACK) };
}

type Mutacao = { ok: true; ids: Record<string, string> };
type Lista = { concessoes: { conectorId: string; capacidade: string; mensagemId: string }[]; liberacoesDispensadas: Record<string, number> };

describeIntegracao("liberar app conectado: Permitir e Agora não do cartão da conversa (0054)", () => {
  it("Permitir concede o nível de cada app com um consentimento por app e enfileira a retomada do último turno da pessoa", async () => {
    await withRollback(MARLON, async (trx) => {
      const d = depsSobreTrx(trx, MARLON);
      const { bot, gmail, slack } = await preparar(d);
      const turno = await d.repos.turnos.enfileirar({ executor: "catcher", conversaId: bot.conversa.id, agenteId: bot.agente.id, origem: "conversa", prazoEm: d.agora() + 60_000, profundidade: 0, entradaTexto: "já liberei", entradaConfianca: "confiavel", modelo: "claude-haiku-4-5-20251001" });
      if (!turno) throw new Error("turno");

      const r = await rota(d, "liberar", bot.agente.id)<Mutacao>({ apps: [{ conectorId: gmail.id, nivel: "leitura" }, { conectorId: slack.id, nivel: "escrita" }] });
      expect(r.ids).toMatchObject({ concedidas: "4", apps: "2", turno: expect.any(String) });

      const lista = await rota(d, "GET", bot.agente.id)<Lista>();
      expect(lista.liberacoesDispensadas).toEqual({});
      expect(lista.concessoes.map((c) => c.capacidade).sort()).toEqual(["GMAIL_FETCH_EMAILS", "GMAIL_GET_PROFILE", "SLACK_LIST_CHANNELS", "SLACK_SEND_MESSAGE"]);
      const recibos = (await d.repos.mensagens.listarDaConversa(bot.conversa.id)).filter((m) => m.kind === "consentimento");
      expect(recibos.map((m) => m.payload)).toEqual([
        expect.objectContaining({ kind: "consentimento", conectorId: gmail.id, slug: gmail.slug, capacidades: ["GMAIL_FETCH_EMAILS", "GMAIL_GET_PROFILE"] }),
        expect.objectContaining({ kind: "consentimento", conectorId: slack.id, slug: slack.slug, capacidades: ["SLACK_LIST_CHANNELS", "SLACK_SEND_MESSAGE"] }),
      ]);
      expect(recibos.every((m) => m.autoria.autor_tipo === "pessoa" && m.autoria.autor_id === MARLON.pessoaId)).toBe(true);
      // Cada concessão aponta para o consentimento do SEU app.
      for (const c of lista.concessoes) expect(c.mensagemId).toBe(recibos[c.conectorId === gmail.id ? 0 : 1]?.id);

      const retomada = await d.repos.turnos.buscar(r.ids.turno ?? "");
      expect(retomada).toMatchObject({ origem: "retomada", retomaTurnoId: turno.id, estado: "pendente", conversaId: bot.conversa.id, agenteId: bot.agente.id, modelo: turno.modelo });
      expect(retomada?.entradaTexto).toContain("os apps: Gmail (ler), Slack (ler e alterar).");
      expect(retomada?.entradaTexto).toContain("A liberação não executou nenhuma ação.");

      // De novo: nada a conceder, nenhum recibo novo, nenhuma retomada a mais.
      expect((await rota(d, "liberar", bot.agente.id)<Mutacao>({ apps: [{ conectorId: gmail.id, nivel: "leitura" }] })).ids).toEqual({ concedidas: "0", apps: "0" });
      expect((await d.repos.mensagens.listarDaConversa(bot.conversa.id)).filter((m) => m.kind === "consentimento")).toHaveLength(2);
      expect((await d.repos.turnos.listarDaConversa(bot.conversa.id)).filter((t) => t.origem === "retomada")).toHaveLength(1);
    });
  });

  it("sem turno da pessoa nas últimas 24 h o acesso é dado e nenhum turno nasce", async () => {
    await withRollback(MARLON, async (trx) => {
      let agora = Date.now();
      const d = depsSobreTrx(trx, MARLON, { relogio: () => agora });
      const { bot, gmail, slack } = await preparar(d);
      expect((await rota(d, "liberar", bot.agente.id)<Mutacao>({ apps: [{ conectorId: gmail.id, nivel: "leitura" }] })).ids).toEqual({ concedidas: "2", apps: "1" });

      // O turno nasce com o relógio do banco (agora de verdade); um dia e um minuto depois ele já não é retomado.
      await d.repos.turnos.enfileirar({ executor: "catcher", conversaId: bot.conversa.id, agenteId: bot.agente.id, origem: "conversa", prazoEm: agora + 60_000, profundidade: 0, entradaTexto: "oi", entradaConfianca: "confiavel", modelo: "claude-haiku-4-5-20251001" });
      agora += JANELA_RETOMADA_APOS_LIBERAR_MS + 60_000;
      expect((await rota(d, "liberar", bot.agente.id)<Mutacao>({ apps: [{ conectorId: slack.id, nivel: "leitura" }] })).ids).toEqual({ concedidas: "1", apps: "1" });
      expect((await d.repos.turnos.listarDaConversa(bot.conversa.id)).map((t) => t.origem)).toEqual(["conversa"]);
    });
  });

  it("'Agora não' grava a dispensa por bot e app, nunca anda para trás, e só quem dispensou a lê", async () => {
    await withRollback(MARLON, async (trx) => {
      let agora = Date.parse("2026-10-05T15:00:00-03:00");
      const d = depsSobreTrx(trx, MARLON, { relogio: () => agora });
      const { bot, gmail, slack } = await preparar(d);
      const dispensar = rota(d, "dispensar", bot.agente.id);
      const ler = rota(d, "GET", bot.agente.id);

      expect((await dispensar<Mutacao>({ conectorIds: [gmail.id] })).ids).toEqual({ dispensadas: "1" });
      expect(await ler<Lista>()).toEqual({ concessoes: [], liberacoesDispensadas: { [gmail.id]: agora } });

      // Um clique atrasado de outra aba, com relógio anterior, não rejuvenesce a dispensa; o segundo app entra.
      const primeira = agora;
      agora -= 5_000;
      expect((await dispensar<Mutacao>({ conectorIds: [gmail.id, slack.id] })).ids).toEqual({ dispensadas: "2" });
      expect((await ler<Lista>()).liberacoesDispensadas).toEqual({ [gmail.id]: primeira, [slack.id]: agora });
      // Reconectar e dispensar de novo, mais tarde: a data anda para a frente.
      agora = primeira + 3_600_000;
      await dispensar<Mutacao>({ conectorIds: [gmail.id] });
      expect((await ler<Lista>()).liberacoesDispensadas[gmail.id]).toBe(agora);

      await esperarErro(() => dispensar({ conectorIds: [] }), "entrada_invalida");
      // App que não existe para a pessoa: 404, e nada é gravado.
      await esperarErro(() => dispensar({ conectorIds: ["00000000-0000-4000-8000-000000000000"] }), "nao_encontrado");

      // A Ana, no mesmo tenant: não dispensa pelo bot do Marlon e não lê as dispensas dele (RLS + owner_id).
      await vincularEscopo(trx, ANA);
      const comoAna = { ...d, repos: criarRepos(trx, ANA), escopo: ANA };
      await esperarErro(() => rota(comoAna, "dispensar", bot.agente.id)({ conectorIds: [gmail.id] }), "nao_encontrado");
      expect(await comoAna.repos.liberacoesDispensadas.doAgente(bot.agente.id)).toEqual({});
      expect(await trx`select count(*)::int as n from liberacoes_dispensadas where agente_id = ${bot.agente.id}`).toEqual([{ n: 0 }]);
      await vincularEscopo(trx, MARLON);
      expect(await trx`select count(*)::int as n from liberacoes_dispensadas where agente_id = ${bot.agente.id}`).toEqual([{ n: 2 }]);
    });
  });
});
