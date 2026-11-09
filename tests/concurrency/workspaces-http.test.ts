import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { Agente } from "../../src/contracts/agente.ts";
import type { Conversa } from "../../src/contracts/conversa.ts";
import type { PlanoTurno } from "../../src/contracts/plano-turno.ts";
import type { ResultadoChamada } from "../../src/use-cases/chamar-ferramenta.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { servidorCompleto, type ServidorCompleto } from "../helpers/servidor-completo.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";
import { criarClaudeCliDriver } from "../../src/adapters/executor/drivers/claude-cli.ts";
import { criarCodexCliDriver } from "../../src/adapters/executor/drivers/codex-cli.ts";
import { configDosDrivers } from "../../src/adapters/executor/registry.ts";
import { CAMINHO_PROXY } from "../../src/adapters/http/boot.ts";

describeIntegracao("pastas locais pela conversa", () => {
  let srv: ServidorCompleto;
  let bot: { agente: Agente; conversa: Conversa };
  let raiz: string;
  let pasta: string;
  const caminho = () => `conversas/${bot.conversa.id}/workspace`;
  beforeAll(async () => {
    // realpath: no macOS /var é link para /private/var, e a busca devolve o caminho resolvido.
    raiz = await realpath(await mkdtemp(join(tmpdir(), "nod-workspace-http-")));
    pasta = join(raiz, "documentos"); await mkdir(pasta);
    srv = await servidorCompleto({ env: { NOD_HOME: join(raiz, "nod"), NOD_MODO: "local", NOD_BUSCA_BASE: raiz }, intervalos: { orquestradorMs: 3600000, schedulerMs: 3600000, expiracaoMs: 3600000 } });
    bot = await srv.json("POST", "agentes", { dono: "pessoa", interativo: true });
    await srv.app.dentro(srv.pessoa, d => d.tx(async trx => { await trx`update agentes set confirmado = true where id = ${bot.agente.id}`; }));
  }, 30000);
  afterAll(async () => {
    if (srv) { await srv.fechar(); await limparPessoaE2E(srv.db, srv.dbDono, srv.pessoa, { agentes: [bot.agente.id], conversas: [bot.conversa.id] }); await srv.desligar(); }
    if (raiz) await rm(raiz, { recursive: true, force: true });
  }, 30000);
  async function plano(harness: "claude-cli" | "codex-cli" = "claude-cli") {
    return srv.app.dentro(srv.pessoa, async d => {
      const t = await d.repos.turnos.enfileirar({ executor: "catcher", agenteId: bot.agente.id, conversaId: bot.conversa.id, origem: "conversa", prazoEm: Date.now() + 600000, profundidade: 0, entradaTexto: "Prepare o relatório", entradaConfianca: "confiavel", modelo: "auto", harness });
      // definido em 2026-09-18: o teste dirige o adapter; impedir que o catcher consuma o mesmo turno.
      await d.tx(async trx => { await trx`update turnos set estado = 'despachando', machine_id = ${srv.app.machineId}, lease_ate = ${new Date(Date.now() + 600000)} where id = ${t!.id}`; });
      return (await emitirPlanoTurno(d, { turnoId: t!.id, machineId: srv.app.machineId, executor: "local", harnesses: { [harness]: { estado: "pronto", em: Date.now() } } })).data;
    });
  }
  async function chamar(p: PlanoTurno, nome: string, argumentos: Record<string, unknown> = {}) {
    const r = await fetch(`${srv.url}/api/interno/ferramentas/${nome}`, { method: "POST", headers: { authorization: `Bearer ${p.tokenDeTurno}`, "content-type": "application/json" }, body: JSON.stringify({ argumentos }) });
    expect(r.status).toBe(200); return await r.json() as ResultadoChamada;
  }
  it("ninguém recebe acesso por citar um caminho no prompt", async () => {
    expect(await srv.json("GET", caminho())).toMatchObject({ disponivel: true, vinculo: null });
    const p = await plano();
    expect(await chamar(p, "workspace_consultar")).toMatchObject({ ok: true, conteudo: expect.stringContaining("precisa_pasta") });
    const outra = srv.sessaoDe({ tenantId: srv.pessoa.tenantId, pessoaId: randomUUID() });
    expect((await srv.chamar("POST", caminho(), { pasta }, outra)).status).toBe(404);
  });
  it("escolhe uma vez, grava por Claude e lê o mesmo arquivo por Codex", async () => {
    expect((await srv.chamar("POST", caminho(), { pasta })).status).toBe(200);
    const claude = await plano();
    expect(await chamar(claude, "workspace_preparar", { modo: "direto" })).toMatchObject({ ok: true, isError: false });
    expect(await chamar(claude, "workspace_gravar_texto", { caminho: "relatorio.txt", texto: "Resultado verificável", revisao: "novo" })).toMatchObject({ ok: true, isError: false });
    const codex = await plano("codex-cli");
    expect(codex.workspaceId).toBe(claude.workspaceId);
    expect(await chamar(codex, "workspace_ler_texto", { caminho: "relatorio.txt" })).toMatchObject({ ok: true, conteudo: expect.stringContaining("Resultado verificável") });
    expect(await readFile(join(pasta, "relatorio.txt"), "utf8")).toBe("Resultado verificável");
  });
  it("revogação invalida plano antigo sem apagar entregáveis", async () => {
    const p = await plano();
    expect((await srv.chamar("DELETE", caminho())).status).toBe(200);
    expect(await chamar(p, "workspace_gravar_texto", { caminho: "indevido.txt", texto: "não", revisao: "novo" })).toMatchObject({ conteudo: expect.stringContaining("precisa_pasta") });
    await expect(readFile(join(pasta, "indevido.txt"))).rejects.toThrow();
    expect(await readFile(join(pasta, "relatorio.txt"), "utf8")).toBe("Resultado verificável");
  });
  // definido em 2026-09-18: o print do MetaNod — o agente mandava a pessoa abrir menu, procurar no
  // Finder e remandar a mensagem. Este bloco prova o fluxo que substitui o tutorial.
  it("sem projeto autorizado o catálogo do turno só oferece consultar e propor", async () => {
    expect((await srv.chamar("DELETE", caminho())).status).toBe(200);
    const p = await plano();
    const doWorkspace = p.catalogo.ferramentas.filter(f => f.origem === "workspace").map(f => f.nome);
    expect(doWorkspace.sort()).toEqual(["workspace_consultar", "workspace_propor_pasta"]);
    expect(p.workspaceId).toBeNull();
  });
  it("propor cria o card com a pasta achada e NÃO concede acesso", async () => {
    const p = await plano();
    const r = await chamar(p, "workspace_propor_pasta", { projeto: "documentos", motivo: "para escrever o relatório" });
    expect(r).toMatchObject({ ok: true, conteudo: expect.stringContaining("proposta_criada") });
    // definido em 2026-09-25: o modelo recebe o nome da sugerida, não o caminho absoluto — o card o mostra.
    const conteudo = JSON.parse("conteudo" in r ? r.conteudo : "{}") as Record<string, unknown>;
    expect(conteudo).toMatchObject({ estado: "proposta_criada", encontradas: 1 });
    expect(conteudo).not.toHaveProperty("candidatas");
    expect(conteudo).not.toHaveProperty("sugerida");
    expect(JSON.stringify(r)).not.toContain(raiz);
    // O modelo propôs; nada foi autorizado.
    expect(await srv.json("GET", caminho())).toMatchObject({ vinculo: null });
    const propostas = await srv.app.dentro(srv.pessoa, d => d.repos.propostas.pendentesDaConversa(bot.conversa.id));
    const daPasta = propostas.find(x => x.payload.kind === "pasta");
    expect(daPasta).toBeTruthy();
    // Chamar de novo não empilha cards.
    expect(await chamar(await plano(), "workspace_propor_pasta", { projeto: "documentos", motivo: "de novo" })).toMatchObject({ conteudo: expect.stringContaining("ja_proposto") });
  });
  it("permitir concede a pasta e retoma a tarefa sozinho", async () => {
    // Independente da ordem: garante a proposta neste próprio teste.
    await srv.chamar("DELETE", caminho());
    await chamar(await plano(), "workspace_propor_pasta", { projeto: "documentos", motivo: "para o relatório" });
    const propostas = await srv.app.dentro(srv.pessoa, d => d.repos.propostas.pendentesDaConversa(bot.conversa.id));
    const daPasta = propostas.find(x => x.payload.kind === "pasta")!;
    expect(daPasta).toBeTruthy();
    const r = await srv.json("POST", `propostas/${daPasta.id}/permitir-pasta`, { pasta }) as { ok: boolean; ids: { turnoRetomada?: string } };
    expect(r.ok).toBe(true);
    expect(r.ids.turnoRetomada).toBeTruthy();
    expect(await srv.json("GET", caminho())).toMatchObject({ vinculo: { ativoId: expect.any(String) } });
    // A pessoa não remandou nada: o turno de retomada carrega a entrada original.
    const t = await srv.app.dentro(srv.pessoa, d => d.repos.turnos.buscar(r.ids.turnoRetomada!));
    expect(t?.origem).toBe("retomada");
    expect(t?.entradaTexto).toContain("Prepare o relatório");
    expect(t?.entradaTexto).toContain(pasta);
    // O card some; o registro de que a pasta foi aberta fica na conversa.
    const mensagens = await srv.app.dentro(srv.pessoa, d => d.repos.mensagens.listarDaConversa(bot.conversa.id));
    expect(mensagens.filter(m => m.payload?.kind === "pasta_aberta" && m.payload.propostaId === daPasta.id)).toEqual([
      expect.objectContaining({ kind: "sistema", payload: expect.objectContaining({ pasta, nome: "documentos", agenteId: bot.agente.id }) }),
    ]);
    // O turno novo já nasce com o catálogo completo.
    const p = await plano();
    expect(p.catalogo.ferramentas.filter(f => f.origem === "workspace").map(f => f.nome)).toContain("workspace_gravar_texto");
  });
  it("outra pessoa não permite a pasta de uma proposta alheia", async () => {
    const p = await plano();
    await chamar(p, "workspace_propor_pasta", { projeto: "documentos", motivo: "x" });
    const propostas = await srv.app.dentro(srv.pessoa, d => d.repos.propostas.pendentesDaConversa(bot.conversa.id));
    const daPasta = propostas.find(x => x.payload.kind === "pasta");
    if (daPasta) {
      const outra = srv.sessaoDe({ tenantId: srv.pessoa.tenantId, pessoaId: randomUUID() });
      expect([403, 404]).toContain((await srv.chamar("POST", `propostas/${daPasta.id}/permitir-pasta`, { pasta }, outra)).status);
    }
  });
  it("o mesmo bot guarda dois projetos e o plano leva os dois ao harness", async () => {
    const outro = join(raiz, "segundo-projeto"); await mkdir(outro, { recursive: true });
    expect((await srv.chamar("POST", caminho(), { pasta })).status).toBe(200);
    expect((await srv.chamar("POST", caminho(), { pasta: outro })).status).toBe(200);
    const v = await srv.json("GET", caminho()) as { vinculo: { projetos: { pasta: string }[] } };
    expect(v.vinculo.projetos.map(x => x.pasta).sort()).toEqual([outro, pasta].sort());
    const p = await plano();
    // Transitar entre projetos aprovados não exige reautorizar: os dois vão ao harness.
    expect(p.workspacePastas?.aprovadas.sort()).toEqual([outro, pasta].sort());
    expect(p.workspacePastas?.ativa).toBe(outro);
  });

  // definido em 2026-09-18: opt-in pago explícito; nunca roda inferência no gate/CI comum.
  it.skipIf(process.env.NOD_SMOKE_HARNESSES !== "1")("aceite pago: Claude grava e Codex continua pela ponte MCP real", async () => {
    await srv.json("POST", caminho(), { pasta });
    const cfg = await configDosDrivers({ ...process.env, NOD_HOME: join(raiz, "cli") }, { shellDeLogin: false });
    const lig = { urlNod: srv.url, proxyPath: CAMINHO_PROXY, sondaSemTurno: true };
    const casos = [
      { driver: criarClaudeCliDriver(lig), harness: "claude-cli" as const, modelo: "opus", arquivo: "claude-real.txt", texto: "claude-confirmado", prompt: "Crie claude-real.txt com conteúdo exato claude-confirmado na pasta de trabalho já autorizada. Use as ferramentas workspace para criar e reler o arquivo; não apenas descreva os passos. Não altere outros arquivos." },
      { driver: criarCodexCliDriver(lig), harness: "codex-cli" as const, modelo: "gpt-6-astra", arquivo: "codex-real.txt", texto: process.env.NOD_SMOKE_HARNESS === "codex-cli" ? "Resultado verificável" : "claude-confirmado", prompt: `Continue o trabalho na pasta já autorizada: leia ${process.env.NOD_SMOKE_HARNESS === "codex-cli" ? "relatorio.txt" : "claude-real.txt"} usando workspace_ler_texto e copie seu conteúdo exato para codex-real.txt usando workspace_gravar_texto com revisao novo. Releia para verificar. Não altere outros arquivos.` },
    ];
    for (const caso of casos.filter(c => !process.env.NOD_SMOKE_HARNESS || c.harness === process.env.NOD_SMOKE_HARNESS)) {
      const instance = await caso.driver.create(cfg);
      try {
        expect((await instance.sondar()).estado).toBe("pronto");
        const p = await plano(caso.harness);
        p.entrada = { ...p.entrada, texto: caso.prompt, modelo: caso.modelo, sessaoCli: null };
        p.catalogo.ferramentas = p.catalogo.ferramentas.filter(f => f.origem === "workspace");
        p.politicaExecucao.prazoMs = 120_000;
        const adapter = instance.adapter(p);
        const timer = setTimeout(() => { void adapter.interromper(); }, 120_000);
        const r = await adapter.rodarTurno({ async sinal() {}, evento(e) { if (e.tipo === "tool_use") process.stdout.write(`Ferramenta real: ${e.nome}\n`); }, delta() {} }).finally(() => clearTimeout(timer));
        process.stdout.write(JSON.stringify({ harness: caso.harness, desfecho: r.desfecho, custoUsd: r.custoUsd, ferramentas: r.ferramentasChamadas, negacoes: r.negacoesPermissao, resposta: r.texto.slice(0, 1000) }) + "\n");
        expect(r.desfecho, r.texto.slice(0, 500)).toBe("sucesso");
        expect(await readFile(join(pasta, caso.arquivo), "utf8")).toBe(caso.texto);
      } finally { await instance.dispose(); }
    }
  }, 300_000);
});
