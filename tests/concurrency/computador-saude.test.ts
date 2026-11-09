import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { Agente } from "../../src/contracts/agente.ts";
import type { FrotaDto } from "../../src/contracts/api.ts";
import type { ComputadorDto, DriverComputador } from "../../src/contracts/computador.ts";
import type { Conversa } from "../../src/contracts/conversa.ts";
import type { PlanoTurno } from "../../src/contracts/plano-turno.ts";
import { FalhaComputador } from "../../src/domain/computador.ts";
import type { ResultadoChamada } from "../../src/use-cases/chamar-ferramenta.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorCompleto, type ServidorCompleto } from "../helpers/servidor-completo.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * Emenda da ADR-037 (24/09): o computador da Nina ficou dois dias "Up" com o Chromium travado por um
 * SingletonLock velho, e cada execução voltava "indisponível ou tela alterada". Pelo servidor completo,
 * com um driver falso que falha como o runtime novo falha: três falhas seguidas → UMA mensagem → a
 * quarta nem chega ao Docker → o plano seguinte sai sem computador_* → "Tentar de novo" com a máquina
 * ainda quebrada não repete o aviso → Ligar com ela boa zera tudo e as ferramentas voltam.
 */
describeIntegracao("computador do bot fora do ar: três falhas, um aviso, plano sem computador, Ligar religa", () => {
  let srv: ServidorCompleto;
  let bot: { agente: Agente; conversa: Conversa };
  let quebrado = true;
  let iniciados = 0;
  const driver: DriverComputador = {
    ambiente: async () => ({ disponivel: true, motivo: null }),
    estado: async () => ({ disponivel: true, ativo: true, motivo: null, reinicios: quebrado ? 6 : 0 }),
    iniciar: async () => {
      iniciados += 1;
      if (quebrado) throw new FalhaComputador("navegador_nao_abriu", { detalhe: "browserType.launchPersistentContext: Timeout 30000ms exceeded.", reinicios: 6 });
    },
    parar: async () => undefined,
    ligados: async () => new Set<string>(),
    executar: async () => ({ tela: { quadro: "a".repeat(64), imagem: "iVBORw0KGgo=", largura: 1280, altura: 800, titulo: "Teste", url: "https://example.com", texto: "", abas: [] } }),
  };

  beforeAll(async () => {
    srv = await servidorCompleto({ computador: driver, env: { NOD_MODO: "compartilhado" }, intervalos: { orquestradorMs: 3600000, schedulerMs: 3600000, expiracaoMs: 3600000 } });
    bot = await srv.json("POST", "agentes", { dono: "pessoa", interativo: true });
    await srv.app.dentro(srv.pessoa, (d) => d.tx(async (trx) => { await trx`update agentes set confirmado = true where id = ${bot.agente.id}`; }));
  }, 30000);
  afterAll(async () => {
    if (!srv) return;
    await srv.fechar();
    await limparPessoaE2E(srv.db, srv.dbDono, srv.pessoa, { agentes: [bot.agente.id], conversas: [bot.conversa.id] });
    await srv.desligar();
  }, 30000);

  const plano = (): Promise<PlanoTurno> => srv.app.dentro(srv.pessoa, async (d) => {
    const t = await d.repos.turnos.enfileirar({ executor: "catcher", agenteId: bot.agente.id, conversaId: bot.conversa.id, origem: "conversa", prazoEm: Date.now() + 600000, profundidade: 0, entradaTexto: "Use seu computador", entradaConfianca: "confiavel", modelo: "auto", harness: "auto" });
    return (await emitirPlanoTurno(d, { turnoId: t!.id, machineId: randomUUID(), executor: "catcher" })).data;
  });
  async function observar(p: PlanoTurno): Promise<{ erro?: string; instrucao?: string }> {
    const r = await fetch(`${srv.url}/api/interno/ferramentas/computador_observar`, { method: "POST", headers: { authorization: `Bearer ${p.tokenDeTurno}`, "content-type": "application/json" }, body: JSON.stringify({ argumentos: {} }) });
    expect(r.status).toBe(200);
    const corpo = (await r.json()) as ResultadoChamada;
    expect(corpo).toMatchObject({ ok: true, isError: true, confianca: "confiavel" });
    if (!("conteudo" in corpo)) throw new Error("sem conteúdo");
    return JSON.parse(corpo.conteudo) as { erro?: string; instrucao?: string };
  }
  const avisos = () => srv.app.dentro(srv.pessoa, async (d) => (await d.repos.mensagens.listarDaConversa(bot.conversa.id, 200)).filter((m) => m.payload?.kind === "computador_fora_do_ar"));
  const doComputador = (p: PlanoTurno) => p.catalogo.ferramentas.filter((f) => f.origem === "computador").map((f) => f.nome);
  const consultar = () => srv.json<ComputadorDto>("GET", `agentes/${bot.agente.id}/computador`);
  const ligar = () => srv.chamar("POST", `agentes/${bot.agente.id}/computador`, { operacao: "iniciar" });

  it("três falhas da máquina → UMA mensagem → falha rápida → plano sem computador → Tentar de novo quebrado não repete → Ligar zera", async () => {
    const p1 = await plano();
    expect(doComputador(p1)).toContain("computador_observar");

    for (let i = 1; i <= 3; i++) {
      const r = await observar(p1);
      // Código real e instrução de tabela — nunca mais "computador_indisponivel_ou_tela_alterada".
      expect(r).toMatchObject({ erro: "navegador_nao_abriu", instrucao: expect.stringContaining("o navegador do computador não abriu") });
      expect(await avisos()).toHaveLength(i === 3 ? 1 : 0);
    }
    const [aviso] = await avisos();
    expect(aviso).toMatchObject({ kind: "sistema", confianca: "confiavel", payload: { kind: "computador_fora_do_ar", agenteId: bot.agente.id, motivo: "navegador_nao_abriu" } });
    expect(aviso?.texto).toMatch(/^O computador de .+ não responde: o navegador do computador não abriu\. Tirei o computador das próximas execuções até você religá-lo\.$/);

    // A quarta nem chega ao Docker: o computador está fora do ar.
    const antes = iniciados;
    expect(await observar(p1)).toMatchObject({ erro: "navegador_nao_abriu", instrucao: expect.stringContaining("fora do ar") });
    expect(iniciados).toBe(antes);
    expect(await avisos()).toHaveLength(1);

    // O plano seguinte sai sem as ferramentas e com a linha que diz por quê.
    const p2 = await plano();
    expect(doComputador(p2)).toEqual([]);
    expect(p2.promptSistema).toContain("Seu computador está fora do ar (o navegador do computador não abriu)");

    // A frota diz sem abrir o computador; a tela dele diz o motivo, as três falhas e os reinícios.
    const frota = await srv.json<FrotaDto>("GET", "frota");
    expect(frota.agentes.find((a) => a.id === bot.agente.id)?.computadorForaDoAr).toMatchObject({ motivo: "navegador_nao_abriu", desde: expect.any(Number) });
    const fora = await consultar();
    expect(fora.computador).toMatchObject({ falhasSeguidas: 3, falhaMotivo: "navegador_nao_abriu", indisponivelDesde: expect.any(Number) });
    expect(fora.reinicios).toBe(6);
    expect(fora.atividade.filter((a) => a.tipo === "observar" && a.estado === "falhou" && a.motivo === "navegador_nao_abriu")).toHaveLength(3);

    // "Tentar de novo" com a máquina ainda quebrada: 409 (estado), nunca 500, e nenhum aviso novo.
    expect((await ligar()).status).toBe(409);
    expect(await avisos()).toHaveLength(1);
    expect((await consultar()).computador.falhasSeguidas).toBe(4);

    // Ligar com a máquina boa zera a saúde e devolve as ferramentas.
    quebrado = false;
    expect((await ligar()).status).toBe(200);
    expect((await consultar()).computador).toMatchObject({ falhasSeguidas: 0, falhaMotivo: null, indisponivelDesde: null });
    expect((await srv.json<FrotaDto>("GET", "frota")).agentes.find((a) => a.id === bot.agente.id)?.computadorForaDoAr).toBeNull();
    const p3 = await plano();
    expect(doComputador(p3)).toContain("computador_observar");
    expect(p3.promptSistema).not.toContain("fora do ar");
    expect(await avisos()).toHaveLength(1);
  }, 60000);

  it("NOD-96: de volta ao docker, o bot que ficou no computador da pessoa (fora do ar) recebe as ferramentas e ganha um por_bot próprio", async () => {
    quebrado = false;
    const pessoaId = await srv.app.dentro(srv.pessoa, async (d) => {
      const c = await d.repos.computadores.obterDaPessoa();
      await d.repos.computadores.registrarFalha(c.id, { motivo: "sem_resposta", em: Date.now(), limite: 1 });
      expect(await d.repos.computadores.vincularBot(c.id, bot.agente.id)).toBe(true);
      return c.id;
    });
    // A saúde da máquina da pessoa não vale no docker: o plano dá as ferramentas e a frota não diz fora do ar.
    const p = await plano();
    expect(doComputador(p)).toContain("computador_observar");
    expect(p.promptSistema).not.toContain("fora do ar");
    expect((await srv.json<FrotaDto>("GET", "frota")).agentes.find((a) => a.id === bot.agente.id)?.computadorForaDoAr).toBeNull();
    expect((await consultar()).computador).toMatchObject({ falhasSeguidas: 0, indisponivelDesde: null });
    // A 1ª ação dá ao bot um 'por_bot' próprio; a máquina da pessoa segue intacta.
    const r = await fetch(`${srv.url}/api/interno/ferramentas/computador_observar`, { method: "POST", headers: { authorization: `Bearer ${p.tokenDeTurno}`, "content-type": "application/json" }, body: JSON.stringify({ argumentos: {} }) });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, isError: false });
    await srv.app.dentro(srv.pessoa, async (d) => {
      const v = (await d.repos.computadores.buscarVinculo(bot.agente.id))!;
      expect(v.id).not.toBe(pessoaId);
      expect(await d.repos.computadores.travar(v.id)).not.toBeNull();
      expect((await d.repos.computadores.daPessoa())!.falhasSeguidas).toBe(1);
    });
  }, 60000);
});
