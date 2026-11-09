import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { Agente } from "../../src/contracts/agente.ts";
import type { ConversaDto, RespostaMutacao } from "../../src/contracts/api.ts";
import type { Concessao } from "../../src/contracts/concessao.ts";
import type { Conector } from "../../src/contracts/conector.ts";
import type { Conversa } from "../../src/contracts/conversa.ts";
import type { Turno } from "../../src/contracts/turno.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorCompleto, type ServidorCompleto } from "../helpers/servidor-completo.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

const MCP_EXEMPLO = fileURLToPath(new URL("../../scripts/mcp-exemplo.mjs", import.meta.url));

/**
 * definido em 2026-10-05: o cartão que oferece liberar apps recém-conectados, pelo HTTP do servidor COMPLETO com o
 * catcher (custo zero) — a jornada medida em produção no mesmo dia: a pessoa fala com o bot, conecta um app por fora e
 * clica em Permitir no cartão. As rotas passam pelo roteador, pela sessão e pela transação escopada de verdade; o
 * orquestrador pega a retomada e o bot responde sozinho. Mora em concurrency porque COMMITA; a limpeza por dono apaga
 * o bot e o app, e as dispensas da 0054 saem junto pelo ON DELETE CASCADE.
 */
type Lista = { concessoes: Concessao[]; liberacoesDispensadas: Record<string, number> };

describeIntegracao("liberar app conectado pelo HTTP real, com o catcher", () => {
  let srv: ServidorCompleto;
  const agentes: string[] = [];
  const conversas: string[] = [];

  const criarBot = async (nome: string) => {
    const b = await srv.json<{ agente: Agente; conversa: Conversa }>("POST", "agentes", { dono: "pessoa", nome });
    agentes.push(b.agente.id);
    conversas.push(b.conversa.id);
    return b;
  };
  const conectarApp = async (slug: string): Promise<Conector> => {
    const criado = await srv.json<{ ids: { conector: string } }>("POST", "conectores", { nome: `Exemplo ${slug}`, slug, transporte: "stdio", comando: process.execPath, args: [MCP_EXEMPLO], declaracao: "nao-toca" });
    const sonda = await srv.json<{ ok: boolean; conector: Conector }>("POST", `conectores/${criado.ids.conector}/sondar`);
    expect(sonda.ok).toBe(true);
    return sonda.conector;
  };
  const esperarTurno = (id: string) =>
    srv.esperar(async () => {
      const { turno } = await srv.json<{ turno: Turno }>("GET", `turnos/${id}`);
      return turno.estado === "concluido" || turno.estado === "interrompido" ? turno : null;
    }, { nome: `turno ${id} terminar`, timeoutMs: 15_000 });

  beforeAll(async () => {
    srv = await servidorCompleto();
  }, 30_000);
  afterAll(async () => {
    if (!srv) return;
    await srv.fechar();
    await limparPessoaE2E(srv.db, srv.dbDono, srv.pessoa, { agentes, conversas });
    await srv.desligar();
  });

  it("a pessoa conecta por fora e permite no cartão: recibo na conversa, o bot é chamado de volta e responde; dois cliques juntos concedem uma vez só", { timeout: 60_000 }, async () => {
    const b = await criarBot("Liberar HTTP");
    const enviada = await srv.json<RespostaMutacao>("POST", `conversas/${b.conversa.id}/mensagens`, { texto: "como conectar o exemplo?" });
    const original = await esperarTurno(enviada.ids.turno ?? "");
    expect(original.estado).toBe("concluido");

    const app = await conectarApp("exemplo-liberar");
    expect(app).toMatchObject({ habilitado: true, ownerId: srv.pessoa.pessoaId });
    // O que a web lê para desenhar o cartão: app conectado agora, bot sem concessão nenhuma, nada dispensado.
    expect(await srv.json<Lista>("GET", `agentes/${b.agente.id}/concessoes`)).toEqual({ concessoes: [], liberacoesDispensadas: {} });

    // Dois cliques ao mesmo tempo (duas abas): a trava por bot e app serializa, e só um concede e chama o bot.
    const cliques = await Promise.all([1, 2].map(() => srv.json<RespostaMutacao>("POST", `agentes/${b.agente.id}/acessos/liberar`, { apps: [{ conectorId: app.id, nivel: "leitura" }] })));
    expect(cliques.map((c) => c.ids.concedidas).sort()).toEqual(["0", "1"]);
    const turnoId = cliques.find((c) => c.ids.turno)?.ids.turno ?? "";
    expect(cliques.filter((c) => c.ids.turno)).toHaveLength(1);

    const lista = await srv.json<Lista>("GET", `agentes/${b.agente.id}/concessoes`);
    expect(lista.concessoes.map((c) => [c.conectorId, c.capacidade])).toEqual([[app.id, "listar_contatos"]]);

    const retomada = await esperarTurno(turnoId);
    expect(retomada).toMatchObject({ estado: "concluido", origem: "retomada", retomaTurnoId: original.id, conversaId: b.conversa.id });
    expect(retomada.entradaTexto).toContain("Exemplo exemplo-liberar (ler)");
    const dto = await srv.json<ConversaDto>("GET", `conversas/${b.conversa.id}/mensagens`);
    const recibos = dto.mensagens.filter((m) => m.kind === "consentimento");
    expect(recibos.map((m) => m.payload)).toEqual([expect.objectContaining({ kind: "consentimento", slug: "exemplo-liberar", capacidades: ["listar_contatos"] })]);
    expect(lista.concessoes[0]?.mensagemId).toBe(recibos[0]?.id);
    // A fala que o bot escreveu sozinho, no turno da retomada.
    expect(dto.mensagens.some((m) => m.turnoId === turnoId && m.kind === "texto" && m.autoria.autor_tipo === "agente")).toBe(true);
    // Nada além do que o nível "Ler" dá: enviar_email continua fora.
    expect(lista.concessoes.some((c) => c.capacidade === "enviar_email")).toBe(false);
  });

  it("'Agora não' fica guardado entre pedidos; corpo inválido é 400 e bot ou app que não é da pessoa é 404, nunca 500", async () => {
    const b = await criarBot("Dispensar HTTP");
    const app = await conectarApp("exemplo-dispensar");
    const antes = Date.now();
    expect((await srv.json<RespostaMutacao>("POST", `agentes/${b.agente.id}/acessos/dispensar`, { conectorIds: [app.id] })).ids).toEqual({ dispensadas: "1" });
    const lista = await srv.json<Lista>("GET", `agentes/${b.agente.id}/concessoes`);
    expect(lista.concessoes).toEqual([]);
    expect(Object.keys(lista.liberacoesDispensadas)).toEqual([app.id]);
    expect(lista.liberacoesDispensadas[app.id]).toBeGreaterThanOrEqual(antes);

    const outra = srv.sessaoDe({ tenantId: srv.pessoa.tenantId, pessoaId: "00000000-0000-4000-8000-0000000000aa" });
    for (const [caminho, corpo, status, sessao] of [
      [`agentes/${b.agente.id}/acessos/dispensar`, {}, 400, undefined],
      [`agentes/${b.agente.id}/acessos/dispensar`, { conectorIds: ["nao-e-uuid"] }, 400, undefined],
      [`agentes/${b.agente.id}/acessos/dispensar`, { conectorIds: [app.id] }, 404, outra],
      [`agentes/nao-e-uuid/acessos/dispensar`, { conectorIds: [app.id] }, 404, undefined],
      [`agentes/${b.agente.id}/acessos/liberar`, {}, 400, undefined],
      [`agentes/${b.agente.id}/acessos/liberar`, { apps: [{ conectorId: "nao-e-uuid", nivel: "leitura" }] }, 400, undefined],
      [`agentes/${b.agente.id}/acessos/liberar`, { apps: [{ conectorId: app.id, nivel: "nenhum" }] }, 400, undefined],
      [`agentes/${b.agente.id}/acessos/liberar`, { apps: [{ conectorId: app.id, nivel: "leitura" }] }, 404, outra],
      [`agentes/nao-e-uuid/acessos/liberar`, { apps: [{ conectorId: app.id, nivel: "leitura" }] }, 404, undefined],
    ] as const) {
      const r = await srv.chamar("POST", caminho, corpo, sessao);
      expect(r.status, `${caminho} ${JSON.stringify(corpo)}`).toBe(status);
    }
    // As recusas não concederam nem dispensaram nada a mais.
    expect(await srv.json<Lista>("GET", `agentes/${b.agente.id}/concessoes`)).toEqual(lista);
  });
});
