import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { comporApp, type App } from "../../src/adapters/http/compor.ts";
import { ROTAS } from "../../src/contracts/api.ts";
import { FERRAMENTAS_NOD } from "../../src/contracts/ferramentas-nod.ts";
import { db } from "../helpers/db.ts";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { planoDeTeste } from "../helpers/l5.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../helpers/servidor-de-teste.ts";

const UUID = "00000000-0000-4000-8000-000000000000";
/**
 * Rotas que ESCREVEM sem pré-condição (parar cria a parada; POST maquinas/chaves emite uma chave de
 * verdade, ADR-031) ou nunca terminam (SSE): fora da varredura da tabela, que promete não commitar.
 * As chaves têm o próprio teste em tests/concurrency/chaves-maquina-http.test.ts (mora lá porque COMMITA).
 */
// NOD-84: as do webhook só existem no modo compartilhado (compor.ts); este app é o local. Provadas em rotina-webhook-rota.test.ts.
const FORA_DA_VARREDURA = new Set(["parar", "eventos", "maquinas/chaves", "rotinas/:id/endereco", "rotinas/:id/testar-webhook"]);

/**
 * A forma HTTP do app composto (critério de pronto da L9): sessão ausente 401, tenant ≠ sessão 404,
 * ErroDeDominio → status/texto da tabela fixa, `remetente` no corpo interno ignorado, id fora de uuid
 * → 404 (path) / 400 (corpo, 22P02 traduzido), nenhuma resposta com err.message, /metrics na raiz e
 * toda entrada de ROTAS casando uma Rota composta. Só caminhos que não gravam: nenhuma linha commita.
 */
describeIntegracao("rotas-http: o app composto responde como a tabela ROTAS promete", () => {
  let app: App;
  let srv: ServidorDeTeste;
  let marlon: { cookie: string; tenantId: string; pessoaId: string };

  beforeAll(async () => {
    app = comporApp({ db, env: { NOD_EXECUTOR: "catcher", NOD_CREDENTIAL_KEY: "0".repeat(63) + "3" }, listarPessoas: async () => [] });
    srv = await servidorDeTeste(app.rotas, { autorizarTokenTurno: app.tokens.autorizar });
    // a ordem do boot: listen → registry (ADR-012: sombra com motivo escrito). Sem isto o inventário esperaria o registry até o prazo.
    const sombra = { estado: "sombra", motivo: "teste de rotas sem driver" } as const;
    app.ligarRegistry({ catcher: sombra, "claude-cli": sombra });
    marlon = await srv.entrar("marlon");
  });
  afterAll(async () => {
    await srv.close();
    await app.fechar();
  });

  it("sessão ausente → 401; tenant da URL ≠ sessão → 404; sessão válida chega ao handler composto", async () => {
    expect((await fetch(`${srv.url}/api/t/${TENANT_PADRAO}/frota`)).status).toBe(401);
    expect((await fetch(`${srv.url}/api/t/${UUID}/frota`, { headers: { cookie: marlon.cookie } })).status).toBe(404);
    const frota = await srv.chamar(marlon, "GET", "frota");
    expect(frota.status).toBe(200);
    expect(await frota.json()).toMatchObject({ agentes: expect.any(Array), inventario: { estado: expect.any(String) }, negacoes: [] });
  });

  it("ErroDeDominio vira status e texto da tabela fixa (nunca err.message)", async () => {
    const naoEncontrado = await srv.chamar(marlon, "GET", `conversas/${UUID}/mensagens`);
    expect(naoEncontrado.status).toBe(404);
    expect(await naoEncontrado.json()).toEqual({ codigo: "nao_encontrado", mensagem: "Não encontramos o que você pediu. Talvez tenha sido apagado; atualize a página." });
    // ADR-045: "Entendi" num aviso que não existe (ou de outra pessoa, invisível pela RLS) é 404, nunca 500.
    const aviso = await srv.chamar(marlon, "POST", `incidentes/${UUID}/dispensar`, {});
    expect(aviso.status).toBe(404);
    expect(await aviso.json()).toEqual({ codigo: "nao_encontrado", mensagem: "Não encontramos o que você pediu. Talvez tenha sido apagado; atualize a página." });
    const fuso = await srv.chamar(marlon, "POST", "rotinas", { agenteId: UUID, cron: "0 8 * * *", fusoIana: "+03:00" });
    expect(fuso.status).toBe(400);
    expect(await fuso.json()).toEqual({ codigo: "fuso_invalido", mensagem: "Fuso horário inválido. Use o nome de uma região, como America/Sao_Paulo, e não uma diferença de horas." });
    const tamanho = await srv.chamar(marlon, "POST", "salas", { nome: "x", agenteIds: [UUID] });
    expect(tamanho.status).toBe(400);
    expect(((await tamanho.json()) as { codigo: string }).codigo).toBe("sala_tamanho");
  });

  it("id fora do formato uuid: no path → 404 (roteador); no corpo/query → 400 entrada_invalida (22P02 traduzido), sem ecoar o valor", async () => {
    expect((await srv.chamar(marlon, "GET", "agentes/nao-e-uuid/memoria")).status).toBe(404);
    expect((await srv.chamar(marlon, "POST", "decisoes/123/decidir", {})).status).toBe(404);
    expect((await srv.chamar(marlon, "POST", "incidentes/nao-e-uuid/dispensar", {})).status).toBe(404);
    expect((await srv.chamar(marlon, "PATCH", `agentes/${UUID}/memoria/abc`, { texto: "x" })).status).toBe(404);
    const corpo = await srv.chamar(marlon, "GET", "trilha?agente=valor-que-nao-e-uuid");
    expect(corpo.status).toBe(400);
    const texto = await corpo.text();
    expect(JSON.parse(texto)).toEqual({ codigo: "entrada_invalida", mensagem: "Algum dado do pedido não está certo. Confira e tente de novo." });
    expect(texto).not.toContain("valor-que-nao-e-uuid");
  });

  it("rota interna: a identidade vem do TOKEN; `remetente` no corpo é ignorado (ADR-024)", async () => {
    const turnoId = randomUUID();
    const agenteId = randomUUID();
    const token = app.tokens.cunhar(turnoId, { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON, agenteId });
    app.tokens.guardarPlano(
      planoDeTeste({
        tenantId: TENANT_PADRAO,
        turnoId,
        agenteId,
        conversaId: UUID,
        tokenDeTurno: token,
        expiraEm: Date.now() + 60_000,
        catalogo: { ferramentas: [{ nome: "lembrar", nomeMcp: "mcp__nod__lembrar", origem: "nod", conectorId: null, readOnlyHint: false, tocaDadoPessoal: false, schema: FERRAMENTAS_NOD.lembrar }], servidores: [] },
      }),
    );
    // O agente do token não existe no banco: o caso de uso responde nao_encontrado (404) — e não 500, nem
    // o agente/pessoa do `remetente` forjado no corpo.
    const r = await fetch(`${srv.url}/api/interno/ferramentas/lembrar`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ argumentos: { tipo: "fato", texto: "x" }, remetente: { pessoaId: PESSOA_ANA, agenteId: UUID, turnoId: UUID } }),
    });
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ codigo: "nao_encontrado", mensagem: "Não encontramos o que você pediu. Talvez tenha sido apagado; atualize a página." });
    expect((await fetch(`${srv.url}/api/interno/plano`, { headers: { authorization: `Bearer ${token}`, origin: "http://evil" } })).status).toBe(403);
    expect((await fetch(`${srv.url}/api/interno/plano`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(200);
    app.tokens.revogar(turnoId);
  });

  it("/metrics responde na RAIZ (convenção Prometheus, EMENDA-L9 §3) e em /api/metrics", async () => {
    for (const caminho of ["/metrics", "/api/metrics"]) {
      const r = await fetch(`${srv.url}${caminho}`);
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toContain("text/plain");
    }
  });

  it("toda entrada escopada da tabela ROTAS casa uma Rota composta (nenhuma responde 'rota não encontrada')", async () => {
    const escopadas = ROTAS.filter((r) => !r.caminho.startsWith("/") && !FORA_DA_VARREDURA.has(r.caminho));
    expect(escopadas.length).toBeGreaterThan(30);
    for (const entrada of escopadas) {
      const caminho = entrada.caminho.replace(/:id\b/g, UUID).replace(/:mid\b/g, UUID);
      const r = await srv.chamar(marlon, entrada.metodo, caminho, entrada.metodo === "GET" ? undefined : {});
      const corpo = (await r.json()) as { codigo?: string; mensagem?: string };
      expect(r.status, `${entrada.metodo} ${entrada.caminho} → ${r.status} ${JSON.stringify(corpo)}`).not.toBe(500);
      expect(corpo.mensagem, `${entrada.metodo} ${entrada.caminho}`).not.toBe("rota não encontrada");
    }
    // As internas da tabela existem (401 sem token, nunca 404 de rota).
    for (const entrada of ROTAS.filter((r) => r.caminho.startsWith("/api/interno"))) {
      const r = await fetch(`${srv.url}${entrada.caminho.replace(/:id\b/g, UUID).replace(/:nome\b/g, "lembrar")}`, { method: entrada.metodo });
      expect(r.status, `${entrada.metodo} ${entrada.caminho}`).toBe(401);
    }
  });
});

describeIntegracao("comporApp valida o modelo da ligação (NOD-164)", () => {
  it("valor inválido em NOD_MODELO_LIGACAO_* lança erro em pt-BR antes de compor", () => {
    const env = { NOD_EXECUTOR: "catcher", NOD_CREDENTIAL_KEY: "0".repeat(63) + "3" };
    expect(() => comporApp({ db, env: { ...env, NOD_MODELO_LIGACAO_CLAUDE: "claude-sonnet-4-6 esforco=turbo" }, listarPessoas: async () => [] })).toThrow(/^NOD_MODELO_LIGACAO_CLAUDE inválida: /);
    expect(() => comporApp({ db, env: { ...env, NOD_MODELO_LIGACAO_CODEX: "gpt-6-luna esforco=low" }, listarPessoas: async () => [] })).toThrow(/^NOD_MODELO_LIGACAO_CODEX inválida: /);
  });
});
