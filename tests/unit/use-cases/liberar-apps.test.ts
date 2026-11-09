import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { rotasConcessoes } from "../../../src/adapters/http/rotas/concessoes.ts";
import type { CapacidadeConector } from "../../../src/contracts/conector.ts";
import { criarAgente } from "../../../src/use-cases/criar-agente.ts";
import { dispensarLiberacao, MAX_APPS_POR_LIBERACAO } from "../../../src/use-cases/dispensar-liberacao.ts";
import { JANELA_RETOMADA_APOS_LIBERAR_MS, notaDaLiberacao, retomarAposLiberar } from "../../../src/use-cases/retomar-apos-liberar.ts";
import type { Deps } from "../../../src/use-cases/tipos.ts";
import { ANA, depsEmMemoria, esperarErro } from "../../helpers/deps-l6.ts";

/**
 * definido em 2026-10-05: o cartão da conversa que oferece liberar apps recém-conectados. Permitir passa pela rota de
 * pessoa `acessos/liberar` (a mesma regra do nível, sem revogar), deixa um consentimento por app e chama o bot de volta
 * com a nota do produto; "Agora não" guarda a dispensa. Aqui em memória, pela rota que a web chama.
 */
const cap = (nome: string, readOnlyHint: boolean): CapacidadeConector => ({ nome, descricao: nome.toLowerCase(), schema: { type: "object" }, readOnlyHint });
const GMAIL = [cap("GMAIL_FETCH_EMAILS", true), cap("GMAIL_GET_PROFILE", true), cap("GMAIL_SEND_EMAIL", false), cap("GMAIL_DELETE_MESSAGE", false)];
const SLACK = [cap("SLACK_LIST_CHANNELS", true), cap("SLACK_SEND_MESSAGE", false)];

function chamar(deps: Deps, sufixo: "liberar" | "dispensar", agenteId: string) {
  const rota = rotasConcessoes({ dentro: async (_escopo, fn) => fn(deps) }).find((r) => r.padrao.source.endsWith(`${sufixo}$`));
  if (!rota || rota.publica) throw new Error(`rota ${sufixo}`);
  return async (corpo: unknown) => {
    const req = new IncomingMessage(new Socket());
    const json = vi.fn();
    await rota.handler({ req, res: new ServerResponse(req), escopo: deps.escopo, params: { id: agenteId }, corpo: async () => corpo, json });
    return json.mock.calls[0]?.[1] as { ok: true; ids: Record<string, string> };
  };
}

async function preparar(opcoes: { comTurno?: boolean } = {}) {
  const { deps, banco, reposDe } = depsEmMemoria();
  const { data: bot } = await criarAgente(deps, { dono: "pessoa", nome: "Assistente pessoal", descricao: "Cuida do dia" });
  const app = async (nome: string, slug: string, catalogo: CapacidadeConector[]) => {
    const c = await deps.repos.conectores.criar({ nome, slug, transporte: "http", url: "https://example.com/mcp", declaracao: "toca" });
    if (!c) throw new Error("conector");
    c.habilitado = true;
    c.catalogo = catalogo;
    return c;
  };
  const gmail = await app("Gmail", "gmail", GMAIL);
  const slack = await app("Slack", "slack", SLACK);
  const turno = opcoes.comTurno === false
    ? null
    : await deps.repos.turnos.enfileirar({ executor: "catcher", conversaId: bot.conversa.id, agenteId: bot.agente.id, origem: "conversa", prazoEm: deps.agora() + 10_000, profundidade: 0, entradaTexto: "já liberei", entradaConfianca: "confiavel", harness: "claude-cli", modelo: "sonnet" });
  const retomadas = () => banco.turnos.filter((t) => t.origem === "retomada");
  const consentimentos = () => banco.mensagens.filter((m) => m.kind === "consentimento");
  return { deps, banco, reposDe, bot, gmail, slack, turno, retomadas, consentimentos, liberar: chamar(deps, "liberar", bot.agente.id), dispensar: chamar(deps, "dispensar", bot.agente.id) };
}

describe("Permitir no cartão de liberar apps", () => {
  it("concede o nível escolhido em cada app, deixa um recibo por app na conversa do bot e chama o bot de volta com a nota", async () => {
    const { banco, bot, gmail, slack, turno, retomadas, consentimentos, liberar } = await preparar();
    const r = await liberar({ apps: [{ conectorId: gmail.id, nivel: "leitura" }, { conectorId: slack.id, nivel: "escrita" }] });
    expect(r.ids).toMatchObject({ concedidas: "4", apps: "2", turno: expect.any(String) });
    expect(banco.concessoes.map((c) => c.capacidade).sort()).toEqual(["GMAIL_FETCH_EMAILS", "GMAIL_GET_PROFILE", "SLACK_LIST_CHANNELS", "SLACK_SEND_MESSAGE"]);
    // Um consentimento por app, o mesmo tipo de mensagem que a decisão de acesso deixa: é o recibo "Acesso permitido".
    expect(consentimentos().map((m) => [m.conversaId, m.payload])).toEqual([
      [bot.conversa.id, expect.objectContaining({ kind: "consentimento", slug: "gmail", capacidades: ["GMAIL_FETCH_EMAILS", "GMAIL_GET_PROFILE"] })],
      [bot.conversa.id, expect.objectContaining({ kind: "consentimento", slug: "slack", capacidades: ["SLACK_LIST_CHANNELS", "SLACK_SEND_MESSAGE"] })],
    ]);
    expect(consentimentos().every((m) => m.autoria.autor_tipo === "pessoa" && m.autoria.decidido_por === "pessoa")).toBe(true);
    expect(retomadas()).toHaveLength(1);
    expect(retomadas()[0]).toMatchObject({ id: r.ids.turno, retomaTurnoId: turno?.id, conversaId: bot.conversa.id, agenteId: bot.agente.id, harness: "claude-cli", modelo: "sonnet", estado: "pendente" });
    expect(retomadas()[0]?.entradaTexto).toBe(notaDaLiberacao([{ nome: "Gmail", nivel: "leitura" }, { nome: "Slack", nivel: "escrita" }]));
    expect(banco.events.map((e) => e.kind)).toEqual(expect.arrayContaining(["concessao_criada", "turno_criado"]));
  });

  it("a nota diz os apps com os níveis, que nada foi executado, e não manda repetir a entrada antiga", () => {
    const nota = notaDaLiberacao([{ nome: "Gmail", nivel: "leitura" }, { nome: "Slack", nivel: "escrita" }]);
    expect(nota).toContain("os apps: Gmail (ler), Slack (ler e alterar).");
    expect(nota).toContain("A liberação não executou nenhuma ação.");
    expect(notaDaLiberacao([{ nome: "Gmail", nivel: "leitura" }])).toContain("o app: Gmail (ler).");
  });

  it("clicar de novo não duplica nada: o que já está concedido não vira recibo novo nem acorda o bot outra vez", async () => {
    const { banco, gmail, retomadas, consentimentos, liberar } = await preparar();
    await liberar({ apps: [{ conectorId: gmail.id, nivel: "leitura" }] });
    const r = await liberar({ apps: [{ conectorId: gmail.id, nivel: "leitura" }] });
    expect(r.ids).toEqual({ concedidas: "0", apps: "0" });
    expect(banco.concessoes).toHaveLength(2);
    expect(consentimentos()).toHaveLength(1);
    expect(retomadas()).toHaveLength(1);
  });

  it("é uma oferta: 'Ler' num cartão velho não revoga o 'Ler e alterar' que o bot já ganhou por outro caminho", async () => {
    const { banco, slack, liberar } = await preparar();
    await liberar({ apps: [{ conectorId: slack.id, nivel: "escrita" }] });
    await liberar({ apps: [{ conectorId: slack.id, nivel: "leitura" }] });
    expect(banco.concessoes.map((c) => c.capacidade).sort()).toEqual(["SLACK_LIST_CHANNELS", "SLACK_SEND_MESSAGE"]);
  });

  it("dois cliques seguidos, um app em cada: a segunda nota se junta à retomada que ainda está na fila", async () => {
    const { gmail, slack, retomadas, liberar } = await preparar();
    await liberar({ apps: [{ conectorId: gmail.id, nivel: "leitura" }] });
    await liberar({ apps: [{ conectorId: slack.id, nivel: "leitura" }] });
    expect(retomadas()).toHaveLength(1);
    expect(retomadas()[0]?.entradaTexto).toContain("Gmail (ler)");
    expect(retomadas()[0]?.entradaTexto).toContain("Slack (ler)");
  });

  it("sem conversa recente com o bot, o acesso é dado e ninguém é acordado: sem turno, turno de mais de 24 h, parado pela pessoa, bot excluído", async () => {
    const semTurno = await preparar({ comTurno: false });
    expect((await semTurno.liberar({ apps: [{ conectorId: semTurno.gmail.id, nivel: "leitura" }] })).ids).toEqual({ concedidas: "2", apps: "1" });
    expect(semTurno.retomadas()).toEqual([]);

    const antigo = await preparar();
    if (antigo.turno) antigo.turno.criadoEm = Date.now() - JANELA_RETOMADA_APOS_LIBERAR_MS - 60_000;
    await antigo.liberar({ apps: [{ conectorId: antigo.gmail.id, nivel: "leitura" }] });
    expect(antigo.banco.concessoes).toHaveLength(2);
    expect(antigo.retomadas()).toEqual([]);

    const parado = await preparar();
    if (parado.turno) Object.assign(parado.turno, { estado: "interrompido", motivoInterrupcao: "parado_pela_pessoa" });
    await parado.liberar({ apps: [{ conectorId: parado.gmail.id, nivel: "leitura" }] });
    expect(parado.retomadas()).toEqual([]);

    const comParada = await preparar();
    await comParada.deps.repos.paradas.ativar({ conversaId: comParada.bot.conversa.id, agora: Date.now() });
    await comParada.liberar({ apps: [{ conectorId: comParada.gmail.id, nivel: "leitura" }] });
    expect(comParada.retomadas()).toEqual([]);

    const excluido = await preparar();
    const semApps = await retomarAposLiberar(excluido.deps, { agenteId: excluido.bot.agente.id, apps: [] });
    expect(semApps.data.turnoId).toBeNull();
    await excluido.deps.repos.agentes.excluir(excluido.bot.agente.id, Date.now());
    const r = await retomarAposLiberar(excluido.deps, { agenteId: excluido.bot.agente.id, apps: [{ nome: "Gmail", nivel: "leitura" }] });
    expect(r.data.turnoId).toBeNull();
  });

  it("só turno que a PESSOA abriu é retomado: a execução de rotina mais recente não vira a tarefa a continuar", async () => {
    const { deps, bot, gmail, turno, retomadas, liberar } = await preparar();
    await deps.repos.turnos.enfileirar({ executor: "catcher", conversaId: bot.conversa.id, agenteId: bot.agente.id, origem: "rotina", prazoEm: deps.agora() + 10_000, profundidade: 0, entradaTexto: "resumo da manhã", entradaConfianca: "confiavel", modelo: "sonnet" });
    await liberar({ apps: [{ conectorId: gmail.id, nivel: "leitura" }] });
    expect(retomadas().map((t) => t.retomaTurnoId)).toEqual([turno?.id]);
  });

  it("recusa o que não é um pedido do cartão e o que não é da pessoa, sem conceder nada", async () => {
    const { banco, deps, reposDe, bot, gmail, slack, liberar } = await preparar();
    for (const corpo of [{}, { apps: [] }, { apps: [{ conectorId: gmail.id, nivel: "nenhum" }] }, { apps: [{ conectorId: gmail.id }] }, { apps: [{ conectorId: gmail.id, nivel: "leitura" }, { conectorId: gmail.id, nivel: "escrita" }] }, { apps: Array.from({ length: MAX_APPS_POR_LIBERACAO + 1 }, (_, i) => ({ conectorId: `c${i}`, nivel: "leitura" })) }]) {
      await esperarErro(() => liberar(corpo), "entrada_invalida");
    }
    // App de colega (visível por 'equipe') e bot de colega: 404, como no nível.
    const daAna = await reposDe(ANA).conectores.criar({ nome: "Notion", slug: "notion", transporte: "http", url: "https://example.com/mcp", declaracao: "toca" });
    if (!daAna) throw new Error("conector da Ana");
    Object.assign(daAna, { habilitado: true, catalogo: SLACK });
    await esperarErro(() => liberar({ apps: [{ conectorId: daAna.id, nivel: "leitura" }] }), "nao_encontrado");
    await esperarErro(() => chamar({ ...deps, repos: reposDe(ANA), escopo: ANA }, "liberar", bot.agente.id)({ apps: [{ conectorId: gmail.id, nivel: "leitura" }] }), "nao_encontrado");
    // App desconectado: 409, como no nível.
    slack.habilitado = false;
    await esperarErro(() => liberar({ apps: [{ conectorId: slack.id, nivel: "leitura" }] }), "estado_invalido");
    expect(banco.concessoes).toEqual([]);
  });
});

describe("'Agora não' no cartão de liberar apps", () => {
  it("guarda a dispensa por bot e app, e ela volta junto com as concessões", async () => {
    const { deps, bot, gmail, slack, dispensar } = await preparar();
    const listar = rotasConcessoes({ dentro: async (_escopo, fn) => fn(deps) }).find((r) => r.metodo === "GET");
    if (!listar || listar.publica) throw new Error("rota GET");
    const ler = async () => {
      const req = new IncomingMessage(new Socket());
      const json = vi.fn();
      await listar.handler({ req, res: new ServerResponse(req), escopo: deps.escopo, params: { id: bot.agente.id }, corpo: async () => null, json });
      return json.mock.calls[0]?.[1] as { concessoes: unknown[]; liberacoesDispensadas: Record<string, number> };
    };
    expect(await ler()).toEqual({ concessoes: [], liberacoesDispensadas: {} });
    const antes = Date.now();
    expect((await dispensar({ conectorIds: [gmail.id, slack.id, gmail.id] })).ids).toEqual({ dispensadas: "2" });
    const lido = await ler();
    expect(Object.keys(lido.liberacoesDispensadas).sort()).toEqual([gmail.id, slack.id].sort());
    expect(lido.liberacoesDispensadas[gmail.id]).toBeGreaterThanOrEqual(antes);
    expect(lido.concessoes).toEqual([]);
  });

  it("nenhum acesso muda; corpo sem apps, bot ou app de outra pessoa são recusados", async () => {
    const { banco, deps, reposDe, bot, gmail, dispensar } = await preparar();
    await dispensar({ conectorIds: [gmail.id] });
    expect(banco.concessoes).toEqual([]);
    for (const corpo of [{}, { conectorIds: [] }, { conectorIds: [1] }, { conectorIds: "x" }]) await esperarErro(() => dispensar(corpo), "entrada_invalida");
    await esperarErro(() => dispensarLiberacao(deps, { agenteId: bot.agente.id, conectorIds: ["inexistente"] }), "nao_encontrado");
    await esperarErro(() => dispensarLiberacao({ ...deps, repos: reposDe(ANA), escopo: ANA }, { agenteId: bot.agente.id, conectorIds: [gmail.id] }), "nao_encontrado");
    // A dispensa é de quem dispensou: a Ana não vê a do Marlon.
    expect(await reposDe(ANA).liberacoesDispensadas.doAgente(bot.agente.id)).toEqual({});
  });
});
