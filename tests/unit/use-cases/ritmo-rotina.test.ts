import { describe, expect, it } from "vitest";
import type { DesfechoRotina } from "../../../src/contracts/motivos.ts";
import type { PayloadRotinaRitmo } from "../../../src/contracts/rotina-ritmo.ts";
import { aplicarAtualizacaoRotina, aplicarExclusaoRotina } from "../../../src/use-cases/aplicar-proposta-rotina.ts";
import { dispararRotina, registrarDesfechoRotina } from "../../../src/use-cases/disparar-rotina.ts";
import { contarRitmo, decidirRitmoRotina } from "../../../src/use-cases/ritmo-rotina.ts";
import { pausarRotina } from "../../../src/use-cases/pausar-rotina.ts";
import { atualizarRotinaPeloAgente, excluirRotinaPeloAgente } from "../../../src/use-cases/rotinas-do-agente.ts";
import { contexto, depsMemoria } from "../../helpers/deps-l7.ts";

/** definido em 2026-10-23 (NOD-313): a contagem sem novidade, o card de ritmo e o clique da pessoa. */
const TZ = "America/Sao_Paulo";
const INICIO = Date.parse("2026-10-19T08:00:00-03:00");
const MEIA_HORA = 30 * 60_000;
const TRINTA_DIAS = 30 * 24 * 60 * 60_000;

async function cenario(cron = "*/30 * * * *", fusoIana = TZ, fusoPadrao?: string) {
  const relogio = { t: INICIO };
  const d = depsMemoria({ agora: () => relogio.t, fusoPadrao });
  const agente = await d.deps.repos.agentes.criar({ nome: "Vera", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "claude-haiku-4-5-20251001" });
  const conversa = await d.deps.repos.conversas.criar({ tipo: "propria", agenteId: agente?.id ?? "" });
  const rotina = await d.deps.repos.rotinas.criar({
    agenteId: agente?.id ?? "",
    conversaId: conversa?.id ?? "",
    cron,
    fusoIana,
    instrucao: "Olhar PRs abertos",
    fonte: "PRs abertos",
    entregavel: "resumo",
    limitesAprovacao: "nada sai sem aprovação",
    politicaSemDado: "diga que não houve",
    proximaExecucao: INICIO,
  });
  if (!rotina) throw new Error("rotina não criada");
  let janela = INICIO;
  /** Uma janela da rotina: dispara, registra o desfecho e fecha o turno. */
  async function rodar(desfecho: DesfechoRotina = "sem_novidade") {
    relogio.t = janela + 30_000;
    const atual = (await d.deps.repos.rotinas.buscar(rotina!.id))!;
    const r = await dispararRotina(d.deps, { rotina: atual, instanteAgendado: janela, machineId: "m1", executor: "catcher", preservarAgenda: atual.estado !== "ativa" });
    if (!("turno" in r.data)) throw new Error(`deveria ter disparado: ${JSON.stringify(r.data)}`);
    const motivo = desfecho === "sem_novidade" ? "nada_mudou" : desfecho === "falhou" ? "erro_execucao" : null;
    const res = await registrarDesfechoRotina(d.deps, { turnoId: r.data.turno.id, desfecho, motivo } as Parameters<typeof registrarDesfechoRotina>[1]);
    await d.deps.repos.turnos.assentar(r.data.turno.id, { estado: "concluido" });
    janela += MEIA_HORA;
    return res;
  }
  /** Pula a agenda para depois de `t` (a próxima janela cai lá). */
  function pularPara(t: number) {
    janela = Math.ceil(t / MEIA_HORA) * MEIA_HORA;
  }
  async function rodarVezes(n: number, desfecho: DesfechoRotina = "sem_novidade") {
    for (let i = 0; i < n; i++) await rodar(desfecho);
  }
  const cards = () => d.banco.mensagens.filter((m) => m.payload?.kind === "rotina_ritmo");
  const card = () => {
    const c = cards().at(-1);
    if (!c) throw new Error("sem card");
    return { id: c.id, texto: c.texto, payload: c.payload as PayloadRotinaRitmo };
  };
  const ritmo = () => d.deps.repos.rotinaRitmo.buscar(rotina.id);
  const lida = async () => (await d.deps.repos.rotinas.buscar(rotina.id))!;
  const clicar = (opcao: "espacar" | "uteis" | "pausar" | "deixar" | "desfazer", mensagemId = card().id) => decidirRitmoRotina(d.deps, { rotinaId: rotina.id, mensagemId, opcao });
  return { d, relogio, rotina, agenteId: agente?.id ?? "", conversaId: conversa?.id ?? "", rodar, rodarVezes, pularPara, cards, card, ritmo, lida, clicar };
}

describe("ritmo da rotina (NOD-313)", () => {
  it("20 execuções seguidas sem novidade escrevem UM card na conversa da rotina; com ele aberto, não escreve outro", async () => {
    const c = await cenario();
    await c.rodarVezes(19);
    expect(c.cards()).toHaveLength(0);
    expect((await c.ritmo())?.semNovidadeSeguidas).toBe(19);
    const vigesima = await c.rodar();
    expect(vigesima.events?.map((e) => e.kind)).toContain("mensagem_criada");
    expect(c.cards()).toHaveLength(1);
    const { texto, payload } = c.card();
    expect(texto).toBe("A rotina “Olhar PRs abertos” rodou 20 vezes seguidas sem novidade. Hoje: a cada 30 min. Quer ajustar?");
    expect(payload).toMatchObject({ rotinaId: c.rotina.id, seguidas: 20, hoje: "a cada 30 min", cronAtual: "*/30 * * * *", espacar: { cron: "0 */2 * * *", rotulo: "a cada 2 h" }, decisao: null });
    expect(c.d.banco.mensagens.find((m) => m.payload?.kind === "rotina_ritmo")?.conversaId).toBe(c.conversaId);
    await c.rodarVezes(15);
    expect(c.cards()).toHaveLength(1);
  });

  it("REGRA: a rotina NUNCA é pausada nem alterada sozinha — nem com 60 sem novidade, nem com o card aberto há dias", async () => {
    const c = await cenario();
    const antes = await c.lida();
    await c.rodarVezes(60);
    c.relogio.t += 10 * 86_400_000;
    await c.rodar();
    const depois = await c.lida();
    expect(depois).toMatchObject({ cron: antes.cron, fusoIana: antes.fusoIana, estado: "ativa", excluidoEm: null });
    expect(c.cards()).toHaveLength(1);
    expect(c.card().payload.decisao).toBeNull();
    expect((await c.ritmo())?.sugeridaEm).not.toBeNull();
  });

  it("execução com novidade, com erro ou a edição da rotina zeram a contagem", async () => {
    for (const desfecho of ["executou", "falhou"] as const) {
      const c = await cenario();
      await c.rodarVezes(19);
      await c.rodar(desfecho);
      expect((await c.ritmo())?.semNovidadeSeguidas).toBe(0);
      await c.rodarVezes(19);
      expect(c.cards()).toHaveLength(0);
      await c.rodar();
      expect(c.cards()).toHaveLength(1);
    }
    const c = await cenario();
    await c.rodarVezes(19);
    const up = await atualizarRotinaPeloAgente(c.d.deps, { ...contexto(c.agenteId, c.conversaId), rotina_id: c.rotina.id, instrucao: "Olhar PRs abertos e issues" });
    if ("erro" in up.data) throw new Error("proposta");
    await aplicarAtualizacaoRotina(c.d.deps, { propostaId: up.data.proposta_id });
    expect((await c.ritmo())?.semNovidadeSeguidas).toBe(0);
    await c.rodar();
    expect(c.cards()).toHaveLength(0);
  });

  it("passou em branco é neutro: não soma nem zera", async () => {
    const c = await cenario();
    await c.rodarVezes(10);
    await c.rodar("passou_em_branco");
    expect((await c.ritmo())?.semNovidadeSeguidas).toBe(10);
  });

  it("Espaçar: aplica o cron do degrau seguinte, fecha o card numa linha e o desfazer restaura e reabre", async () => {
    const c = await cenario();
    await c.rodarVezes(20);
    const r = await c.clicar("espacar");
    expect(r.data).toEqual({ aplicada: true });
    expect(r.events?.map((e) => e.kind)).toEqual(["rotina_atualizada"]);
    const espacada = await c.lida();
    expect(espacada).toMatchObject({ cron: "0 */2 * * *", fusoIana: TZ, estado: "ativa" });
    expect(espacada.proximaExecucao).toBeGreaterThan(c.relogio.t);
    const fechado = c.card();
    expect(fechado.texto).toBe("✓ Rotina “Olhar PRs abertos” espaçada para a cada 2 h (ajuste sugerido pelo nod, aceito por você).");
    expect(fechado.payload.decisao).toMatchObject({ opcao: "espacar", desfazivel: true });
    expect(await c.ritmo()).toMatchObject({ sugeridaEm: null, semNovidadeSeguidas: 0 });
    // O segundo clique (outra aba) não aplica de novo.
    expect((await c.clicar("pausar")).data).toEqual({ aplicada: false, motivo: "ja_decidido" });
    expect((await c.lida()).estado).toBe("ativa");

    expect((await c.clicar("desfazer")).data).toEqual({ aplicada: true });
    expect(await c.lida()).toMatchObject({ cron: "*/30 * * * *", estado: "ativa" });
    expect(c.card().payload.decisao).toBeNull();
    expect(c.card().texto).toContain("Quer ajustar?");
    expect(c.cards()).toHaveLength(1);
    expect((await c.ritmo())?.sugeridaEm).not.toBeNull();
    expect((await c.clicar("deixar")).data).toEqual({ aplicada: true });
    expect((await c.lida()).estado).toBe("ativa");
    expect((await c.clicar("desfazer")).data).toEqual({ aplicada: false, motivo: "ja_decidido" });
  });

  it("Só dias úteis 8h–19h: segunda a sexta dentro do horário comercial", async () => {
    const c = await cenario();
    await c.rodarVezes(20);
    expect((await c.clicar("uteis")).data).toEqual({ aplicada: true });
    expect((await c.lida()).cron).toBe("*/30 8,9,10,11,12,13,14,15,16,17,18 * * 1-5");
    expect(c.card().texto).toContain("agora roda só em dias úteis, das 8h às 19h");
  });

  it("usa o NOD_FUSO_PADRAO configurado no card e ao aplicar dias úteis", async () => {
    const c = await cenario("0 12 * * *", "UTC", "America/Manaus");
    await c.rodarVezes(20);
    expect(c.card().payload.uteis).toEqual({ cron: "0 8 * * 1-5", fusoIana: "America/Manaus" });
    expect((await c.clicar("uteis")).data).toEqual({ aplicada: true });
    expect(await c.lida()).toMatchObject({ cron: "0 8 * * 1-5", fusoIana: "America/Manaus" });
  });

  it("Pausar: pausa pelo fluxo normal, sem linha duplicada, e o desfazer reativa", async () => {
    const c = await cenario();
    await c.rodarVezes(20);
    const linhasAntes = c.d.banco.mensagens.length;
    expect((await c.clicar("pausar")).data).toEqual({ aplicada: true });
    expect((await c.lida()).estado).toBe("pausada");
    expect(c.d.banco.mensagens.length).toBe(linhasAntes);
    expect(c.card().texto).toMatch(/^✓ Rotina “Olhar PRs abertos” pausada \(ajuste sugerido pelo nod, aceito por você\)\./);
    expect((await c.clicar("desfazer")).data).toEqual({ aplicada: true });
    expect((await c.lida()).estado).toBe("ativa");
  });

  it("Deixar como está: silencia por 30 dias e sugere de novo depois", async () => {
    const c = await cenario();
    await c.rodarVezes(20);
    expect((await c.clicar("deixar")).data).toEqual({ aplicada: true });
    expect(c.card().texto).toBe("✓ Rotina “Olhar PRs abertos” segue como está; não pergunto de novo por 30 dias.");
    expect(c.card().payload.decisao).toMatchObject({ opcao: "deixar", desfazivel: false });
    expect(await c.lida()).toMatchObject({ cron: "*/30 * * * *", estado: "ativa" });
    const silencio = (await c.ritmo())?.silenciadaAte;
    expect(silencio).toBe(c.relogio.t + TRINTA_DIAS);
    await c.rodarVezes(40);
    expect(c.cards()).toHaveLength(1);
    expect((await c.lida()).estado).toBe("ativa");
  });

  it("depois dos 30 dias do Deixar, o próximo sem novidade abre um card novo", async () => {
    const c = await cenario();
    await c.rodarVezes(20);
    await c.clicar("deixar");
    await c.rodarVezes(25);
    expect(c.cards()).toHaveLength(1);
    // Pula para depois do silêncio pelo caminho real (dispara, registra o desfecho): a próxima janela abre um card novo.
    const r = await c.ritmo();
    c.pularPara(r!.silenciadaAte! + 1);
    await c.rodar();
    expect(c.cards()).toHaveLength(2);
    expect(c.card().payload.decisao).toBeNull();
  });

  it("a rotina mudou, foi pausada ou excluída antes do clique: o card fecha sem aplicar nada", async () => {
    const c = await cenario();
    await c.rodarVezes(20);
    await c.d.deps.repos.rotinas.atualizar(c.rotina.id, { cron: "0 9 * * *" });
    expect((await c.clicar("espacar")).data).toEqual({ aplicada: false, motivo: "rotina_mudou" });
    expect((await c.lida()).cron).toBe("0 9 * * *");
    expect(c.card().payload.invalida).toBe(true);

    const p = await cenario();
    await p.rodarVezes(20);
    await p.d.deps.repos.rotinas.atualizarEstado(p.rotina.id, "pausada");
    expect((await p.clicar("uteis")).data).toEqual({ aplicada: false, motivo: "rotina_mudou" });
    expect((await p.lida()).cron).toBe("*/30 * * * *");
    expect(p.card().payload.invalida).toBe(true);

    // Só o fuso mudou (cron igual): também é outra rotina — a revisão do card pega.
    const f = await cenario();
    await f.rodarVezes(20);
    await f.d.deps.repos.rotinas.atualizar(f.rotina.id, { fusoIana: "Europe/Lisbon" });
    expect((await f.clicar("pausar")).data).toEqual({ aplicada: false, motivo: "rotina_mudou" });
    expect((await f.lida()).estado).toBe("ativa");
  });

  it("não abre card com o retrato antigo de uma rotina já pausada e não desfaz cron sobre pausa posterior", async () => {
    const corrida = await cenario();
    const antiga = { ...(await corrida.lida()) };
    await corrida.d.deps.repos.rotinas.atualizarEstado(corrida.rotina.id, "pausada");
    await contarRitmo(corrida.d.deps, antiga, "sem_novidade", null);
    expect(corrida.cards()).toHaveLength(0);
    expect((await corrida.ritmo())?.semNovidadeSeguidas).toBe(0);

    const desfazer = await cenario();
    await desfazer.rodarVezes(20);
    await desfazer.clicar("espacar");
    await desfazer.d.deps.repos.rotinas.atualizarEstado(desfazer.rotina.id, "pausada");
    expect((await desfazer.clicar("desfazer")).data).toEqual({ aplicada: false, motivo: "rotina_mudou" });
    expect(await desfazer.lida()).toMatchObject({ cron: "0 */2 * * *", estado: "pausada" });
  });

  it("editar a rotina pela proposta, pausar pela tela ou excluir fecham o card aberto como inválido", async () => {
    const e = await cenario();
    await e.rodarVezes(20);
    const up = await atualizarRotinaPeloAgente(e.d.deps, { ...contexto(e.agenteId, e.conversaId), rotina_id: e.rotina.id, instrucao: "Olhar PRs e issues" });
    if ("erro" in up.data) throw new Error("proposta");
    const aplicada = await aplicarAtualizacaoRotina(e.d.deps, { propostaId: up.data.proposta_id });
    expect(aplicada.events?.some((ev) => ev.kind === "rotina_atualizada" && (ev as { dados?: { origem?: string } }).dados?.origem === "ritmo_invalidado")).toBe(true);
    expect(e.card().payload.invalida).toBe(true);
    expect(e.card().texto).toContain("mudou desde esta sugestão");
    expect(await e.ritmo()).toMatchObject({ semNovidadeSeguidas: 0, sugeridaEm: null });
    expect((await e.clicar("espacar")).data).toEqual({ aplicada: false, motivo: "ja_decidido" });

    const p = await cenario();
    await p.rodarVezes(20);
    await pausarRotina(p.d.deps, { rotinaId: p.rotina.id, estado: "pausada" });
    expect(p.card().payload.invalida).toBe(true);
    expect((await p.ritmo())?.sugeridaEm).toBeNull();

    const x = await cenario();
    await x.rodarVezes(20);
    const del = await excluirRotinaPeloAgente(x.d.deps, { ...contexto(x.agenteId, x.conversaId), rotina_id: x.rotina.id });
    if ("erro" in del.data) throw new Error("proposta de exclusão");
    await aplicarExclusaoRotina(x.d.deps, { propostaId: del.data.proposta_id });
    expect(x.card().payload.invalida).toBe(true);
  });

  it("Deixar avisa a outra tela; desfazer num card antigo, depois de nascer outro, não mexe em nada", async () => {
    const c = await cenario();
    await c.rodarVezes(20);
    const deixar = await c.clicar("deixar");
    expect(deixar.events?.map((e) => e.kind)).toEqual(["rotina_atualizada"]);

    const v = await cenario();
    await v.rodarVezes(20);
    const antigo = v.card().id;
    await v.clicar("espacar");
    await v.rodarVezes(20);
    expect(v.cards()).toHaveLength(2);
    const anterior = v.cards().find((m) => m.id === antigo)?.payload as PayloadRotinaRitmo;
    expect(anterior.decisao?.desfazivel).toBe(false);
    expect((await v.clicar("desfazer", antigo)).data).toEqual({ aplicada: false, motivo: "ja_decidido" });
    expect((await v.lida()).cron).toBe("0 */2 * * *");
  });

  it("o clique só vale para o card da própria rotina", async () => {
    const c = await cenario();
    await c.rodarVezes(20);
    await expect(c.clicar("espacar", "00000000-0000-4000-8000-000000000000")).rejects.toMatchObject({ codigo: "nao_encontrado" });
    expect((await c.lida()).cron).toBe("*/30 * * * *");
  });
});
