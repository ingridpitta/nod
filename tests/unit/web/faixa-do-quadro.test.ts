import { describe, expect, it } from "vitest";
import { frameDaFerramenta } from "../../../src/domain/rotulo-ferramenta.ts";
import { ARMAR_PARAR_MS, CONFERIR_MS, ENCERRADO_MS, GRACA_MS, GUARDADOS_MAX, SILENCIO_MS, resumoDaFala, pedidoSeguido, podeParar, proximaFaixa, retomaSozinho, silencioEm, soORelogio, statusDoTurno, turnoFalhou, vivosDoPedido, type FrameDaFaixa } from "../../../web/lib/faixa-do-quadro.ts";
import type { Faixa } from "../../../web/lib/quadro-dados.ts";

/** ADA-4: a máquina de estados da faixa da pílula do quadro, sem DOM. */
const fr = (tipo: string, dados: Record<string, unknown> = {}): FrameDaFaixa => ({ tipo, dados: { conversaId: "c1", turnoId: "T1", ...dados } });
const enviando = (): Faixa => proximaFaixa({ tipo: "nada" }, { tipo: "enviou", fala: "Cria X", texto: "Cria X", idEnvio: "K1" });
const trabalhando = (agora = 1000): Faixa => proximaFaixa(enviando(), { tipo: "aceito", pedidoId: "m1", turnoId: "T1", agora });

describe("ADA-4: proximaFaixa", () => {
  it("enviou → enviando com a fala; aceito → trabalhando no turno do pedido", () => {
    const e = enviando();
    expect(e).toMatchObject({ tipo: "enviando", fala: "Cria X", idEnvio: "K1" });
    const t = trabalhando();
    expect(t).toMatchObject({ tipo: "trabalhando", pedidoId: "m1", turnoId: "T1", status: null, demorando: false });
    expect(podeParar(t)).toBe(true);
    // O Parar só arma ARMAR_PARAR_MS depois do aceito (Enter + clique rápido não para o pedido).
    expect(podeParar(t, 1000 + ARMAR_PARAR_MS - 1)).toBe(false);
    expect(podeParar(t, 1000 + ARMAR_PARAR_MS)).toBe(true);
    expect(pedidoSeguido(t)).toBe("m1");
  });

  it("recusado → falhou com a MESMA chave e o texto (Tentar de novo reusa)", () => {
    const f = proximaFaixa(enviando(), { tipo: "recusado" });
    expect(f).toEqual({ tipo: "falhou", fala: "Cria X", texto: "Cria X", idEnvio: "K1" });
    // Tentar de novo: volta a enviando com a chave guardada.
    const de = f.tipo === "falhou" ? f : null;
    expect(proximaFaixa(f, { tipo: "enviou", fala: de!.fala, texto: de!.texto, idEnvio: de!.idEnvio })).toMatchObject({ tipo: "enviando", idEnvio: "K1" });
  });

  it("turno.atividade vira o status vivo (emUso.texto do payload real, senão rotulo); frame de outro turno é ignorado", () => {
    const t = trabalhando();
    // O payload que o servidor manda (revisão 1 do #646): emUso é {texto, frentes}; o presente, nunca o passado.
    const a = proximaFaixa(t, { tipo: "frame", frame: fr("turno.atividade", frameDaFerramenta("mcp__nod__linear__LINEAR_SEARCH_ISSUES", "u1")), agora: 2000 });
    expect(a).toMatchObject({ status: "Usando Linear", ultimoFrameEm: 2000 });
    expect(statusDoTurno(fr("turno.atividade", frameDaFerramenta("Bash")))).toBe("Rodando um comando");
    const b = proximaFaixa(t, { tipo: "frame", frame: fr("turno.atividade", { rotulo: "Lendo arquivo" }), agora: 2000 });
    expect(b).toMatchObject({ status: "Lendo arquivo" });
    const outro = proximaFaixa(t, { tipo: "frame", frame: fr("turno.atividade", { ...frameDaFerramenta("Read", "u9"), turnoId: "T9" }), agora: 2000 });
    expect(outro).toBe(t);
    const fim = proximaFaixa(t, { tipo: "frame", frame: fr("turno.interrompido", { turnoId: "T9", motivo: "erro" }), agora: 2000 });
    expect(fim).toBe(t);
  });

  it("falha nos dois formatos → janela curta → parou (nunca fica girando)", () => {
    const t = trabalhando();
    for (const frame of [fr("turno.interrompido", { motivo: "executor_indisponivel", motivo_falha: "nao_autenticado" }), fr("turno.interrompido", { motivo: "turno_travado" })]) {
      const g = proximaFaixa(t, { tipo: "frame", frame, agora: 2000 });
      expect(g).toMatchObject({ tipo: "trabalhando", retomando: true, desisteEm: 2000 + GRACA_MS });
      expect(podeParar(g)).toBe(false);
      expect(silencioEm(g, 2000)).toBe(GRACA_MS);
      expect(proximaFaixa(g, { tipo: "silencio", agora: 2000 + GRACA_MS - 1 })).toBe(g);
      expect(proximaFaixa(g, { tipo: "silencio", agora: 2000 + GRACA_MS })).toMatchObject({ tipo: "parou", porVoce: false });
    }
    // encerrado concluido não é falha: fica esperando a resposta, sem Parar; o prazo curto vira "Feito." (não gira).
    const ok = proximaFaixa(t, { tipo: "frame", frame: fr("turno.encerrado", { estado: "concluido" }), agora: 1 });
    expect(ok).toMatchObject({ tipo: "trabalhando", encerrado: true });
    expect(podeParar(ok)).toBe(false);
    expect(silencioEm(ok, 1)).toBe(ENCERRADO_MS);
    expect(proximaFaixa(ok, { tipo: "silencio", agora: ENCERRADO_MS })).toBe(ok);
    expect(proximaFaixa(ok, { tipo: "silencio", agora: 1 + ENCERRADO_MS })).toEqual({ tipo: "resposta", texto: "Feito.", loteId: null, mensagemId: "", pedidoId: "m1" });
  });

  it("a troca de IA no limite e a troca de conta seguem o turno que repete o do pedido; frente e outro pedido não", () => {
    for (const extra of [{ ia_no_limite: "claude", renova_em: 9 }, { conta_de: 1, conta_para: 2 }]) {
      const r = proximaFaixa(trabalhando(), { tipo: "frame", frame: fr("turno.interrompido", { motivo: "executor_indisponivel", ...extra }), agora: 5 });
      expect(r).toMatchObject({ tipo: "trabalhando", retomando: true });
      // A frente e o turno de outro pedido na mesma conversa não são a continuação.
      expect(proximaFaixa(r, { tipo: "frame", frame: fr("turno.iniciado", { turnoId: "T7", trabalho_id: "fr" }), agora: 6 })).toBe(r);
      expect(proximaFaixa(r, { tipo: "frame", frame: fr("turno.iniciado", { turnoId: "T8", repete_turno_id: "T0" }), agora: 6 })).toBe(r);
      const seguiu = proximaFaixa(r, { tipo: "frame", frame: fr("turno.iniciado", { turnoId: "T2", repete_turno_id: "T1" }), agora: 6 });
      expect(seguiu).toMatchObject({ tipo: "trabalhando", retomando: false, turnoId: "T2", desisteEm: null });
      // Seguindo, a janela não vence mais: o silêncio volta a ser o de 90 s.
      expect(proximaFaixa(seguiu, { tipo: "silencio", agora: 6 + GRACA_MS })).toBe(seguiu);
    }
    // conta_para é número no contrato: retoma sem prazo.
    expect(retomaSozinho(fr("turno.interrompido", { conta_para: 2 }))).toBe(true);
  });

  it("só o relógio mudou (turno.delta) → soORelogio; um status novo não", () => {
    const t = trabalhando();
    const d = proximaFaixa(t, { tipo: "frame", frame: fr("turno.delta"), agora: 3000 });
    expect(d).not.toBe(t);
    expect(soORelogio(t, d)).toBe(true);
    const a = proximaFaixa(t, { tipo: "frame", frame: fr("turno.atividade", frameDaFerramenta("Bash")), agora: 3000 });
    expect(soORelogio(t, a)).toBe(false);
  });

  it("parado_pela_pessoa → 'Parado por você', não erro", () => {
    const t = proximaFaixa(trabalhando(), { tipo: "parar" });
    expect(t).toMatchObject({ parando: true });
    expect(podeParar(t)).toBe(false);
    expect(proximaFaixa(t, { tipo: "frame", frame: fr("turno.interrompido", { motivo: "parado_pela_pessoa" }), agora: 1 })).toMatchObject({ tipo: "parou", porVoce: true });
    expect(proximaFaixa(t, { tipo: "parar_falhou" })).toMatchObject({ parando: false });
  });

  it("interrompido que se repete sozinho → retomando sem prazo, e segue só a continuação do pedido", () => {
    for (const [extra, inicio] of [
      [{ repete_sem_resume: true }, { turnoId: "T2", repete_turno_id: "T1" }],
      [{ repete_sem_resume: true }, { turnoId: "T1" }],
      [{ espera_da_cota: "espera", volta_turno_id: "T2" }, { turnoId: "T2", retoma_turno_id: "T0" }],
      [{ volta_turno_id: "T2" }, { turnoId: "T2" }],
    ] as const) {
      const r = proximaFaixa(trabalhando(), { tipo: "frame", frame: fr("turno.interrompido", { motivo: "sessao_rejeitada", ...extra }), agora: 5 });
      expect(r).toMatchObject({ tipo: "trabalhando", retomando: true, desisteEm: null });
      // Um turno qualquer da conversa (a frente) não é seguido.
      expect(proximaFaixa(r, { tipo: "frame", frame: fr("turno.iniciado", { turnoId: "T9" }), agora: 6 })).toBe(r);
      const seguiu = proximaFaixa(r, { tipo: "frame", frame: fr("turno.iniciado", inicio), agora: 6 });
      expect(seguiu).toMatchObject({ tipo: "trabalhando", retomando: false, turnoId: inicio.turnoId });
      // O turno novo falha → janela → parou.
      const g = proximaFaixa(seguiu, { tipo: "frame", frame: fr("turno.interrompido", { turnoId: inicio.turnoId, motivo: "erro" }), agora: 7 });
      expect(proximaFaixa(g, { tipo: "silencio", agora: 7 + GRACA_MS })).toMatchObject({ tipo: "parou" });
    }
    expect(retomaSozinho(fr("turno.interrompido", { espera_da_cota: "nao_rodou" }))).toBe(false);
    expect(turnoFalhou(fr("turno.interrompido", { espera_da_cota: "nao_rodou" }))).toBe(true);
  });

  it("90 s sem frame → demorando; um frame novo volta ao status vivo", () => {
    const t = trabalhando(1000);
    expect(silencioEm(t, 1000)).toBe(SILENCIO_MS);
    expect(proximaFaixa(t, { tipo: "silencio", agora: 1000 + SILENCIO_MS - 1 })).toBe(t);
    const d = proximaFaixa(t, { tipo: "silencio", agora: 1000 + SILENCIO_MS });
    expect(d).toMatchObject({ demorando: true });
    // Revisão 2 do #646: "Ainda trabalhando…" não fica sem relógio: a tela confere a conversa a cada CONFERIR_MS.
    expect(silencioEm(d, 1000 + SILENCIO_MS)).toBe(CONFERIR_MS);
    const vivo = proximaFaixa(d, { tipo: "frame", frame: fr("turno.delta"), agora: 1000 + SILENCIO_MS + 5 });
    expect(vivo).toMatchObject({ demorando: false, ultimoFrameEm: 1000 + SILENCIO_MS + 5 });
  });

  it("frame antes do turnoId (o POST ainda não voltou) é guardado e aplicado no aceito", () => {
    let e = enviando();
    e = proximaFaixa(e, { tipo: "frame", frame: fr("turno.atividade", frameDaFerramenta("mcp__nod__linear__LINEAR_SEARCH_ISSUES")), agora: 1 });
    e = proximaFaixa(e, { tipo: "frame", frame: fr("turno.interrompido", { turnoId: "T9", motivo: "erro" }), agora: 1 });
    const t = proximaFaixa(e, { tipo: "aceito", pedidoId: "m1", turnoId: "T1", agora: 2 });
    expect(t).toMatchObject({ tipo: "trabalhando", status: "Usando Linear" });
    // O turno inteiro acabou antes do POST voltar: o fim também vale.
    let e2 = enviando();
    e2 = proximaFaixa(e2, { tipo: "frame", frame: fr("turno.interrompido", { motivo: "erro" }), agora: 1 });
    const g = proximaFaixa(e2, { tipo: "aceito", pedidoId: "m1", turnoId: "T1", agora: 2 });
    expect(g).toMatchObject({ tipo: "trabalhando", desisteEm: 2 + GRACA_MS });
    expect(proximaFaixa(g, { tipo: "silencio", agora: 2 + GRACA_MS })).toMatchObject({ tipo: "parou" });
  });

  it("estados sem turno não reagem a frame, silêncio nem parar", () => {
    const nada: Faixa = { tipo: "nada" };
    expect(proximaFaixa(nada, { tipo: "frame", frame: fr("turno.atividade", frameDaFerramenta("Read", "u1")), agora: 1 })).toBe(nada);
    expect(proximaFaixa(nada, { tipo: "silencio", agora: 1e9 })).toBe(nada);
    expect(proximaFaixa(nada, { tipo: "parar" })).toBe(nada);
    expect(proximaFaixa(nada, { tipo: "aceito", pedidoId: "m", turnoId: "T", agora: 1 })).toBe(nada);
    expect(statusDoTurno(fr("turno.delta"))).toBeNull();
  });
});

/** Revisão 2 do #646: os payloads reais que a revisão achou faltando. */
describe("ADA-4: revisão 2 — absorvido, fala do meio, conferência", () => {
  const vivo = (f: Faixa) => f as Extract<Faixa, { tipo: "trabalhando" }>;
  const conversa = (f: Faixa, o: { resposta?: { id: string; texto: string } | null; vivos?: string[] | null; conferir?: boolean }): Faixa =>
    proximaFaixa(f, { tipo: "conversa", resposta: o.resposta ?? null, vivos: o.vivos === undefined ? null : o.vivos, conferir: o.conferir ?? false, agora: 5000 });

  it("pedido absorvido pelo turno vivo (motivo absorvido, absorvido_por) segue o turno que o leu, sem 'Parou no meio'", () => {
    const t = trabalhando();
    const fim = fr("turno.interrompido", { motivo: "absorvido", absorvido_por: "T0" });
    expect(turnoFalhou(fim)).toBe(false);
    const a = proximaFaixa(t, { tipo: "frame", frame: fim, agora: 2000 });
    expect(a).toMatchObject({ tipo: "trabalhando", turnoId: "T0", pedidoId: "m1", retomando: false, desisteEm: null });
    // O status do turno que leu sobe; a janela não vence (não há parou).
    const b = proximaFaixa(a, { tipo: "frame", frame: fr("turno.atividade", { ...frameDaFerramenta("Bash", "u2"), turnoId: "T0" }), agora: 2100 });
    expect(b).toMatchObject({ status: "Rodando um comando" });
    expect(proximaFaixa(b, { tipo: "silencio", agora: 2100 + GRACA_MS })).toBe(b);
    // O fim do turno que leu encerra o pedido.
    expect(proximaFaixa(b, { tipo: "frame", frame: fr("turno.encerrado", { turnoId: "T0", estado: "concluido" }), agora: 3000 })).toMatchObject({ encerrado: true });
    expect(pedidoSeguido(b)).toBe("m1");
  });

  it("a fala do meio do turno (sessão viva) vira o status e não encerra a faixa; o fim do turno traz a resposta", () => {
    const t = trabalhando();
    const meio = conversa(t, { resposta: { id: "r1", texto: "Vou organizar as tarefas" }, vivos: ["T1"] });
    expect(meio).toMatchObject({ tipo: "trabalhando", status: "Vou organizar as tarefas" });
    expect(podeParar(meio, 9e9)).toBe(true);
    // Servidor antigo, sem a lista dos vivos (null): a fala final sobe como antes; sem fala, nada muda.
    expect(conversa(t, { resposta: { id: "r1", texto: "Vou" } })).toMatchObject({ tipo: "resposta", texto: "Vou" });
    expect(conversa(t, { conferir: true })).toBe(t);
    const fim = proximaFaixa(meio, { tipo: "frame", frame: fr("turno.encerrado", { estado: "concluido" }), agora: 6000 });
    expect(conversa(fim, { resposta: { id: "r2", texto: "Pronto, criei 3." }, vivos: [] })).toMatchObject({ tipo: "resposta", texto: "Pronto, criei 3.", mensagemId: "r2", pedidoId: "m1" });
  });

  it("frame do fim perdido: com o turno fora dos vivos a resposta sobe; sem resposta, só a conferência conclui 'Parou no meio'", () => {
    const t = trabalhando();
    expect(conversa(t, { resposta: { id: "r1", texto: "Feito X" }, vivos: ["T5"] })).toMatchObject({ tipo: "resposta", texto: "Feito X" });
    expect(conversa(t, { vivos: [] })).toBe(t);
    expect(conversa(t, { vivos: [], conferir: true })).toMatchObject({ tipo: "parou", porVoce: false });
    // Com o turno vivo (na fila ou rodando), a conferência não conclui nada.
    expect(conversa(t, { vivos: ["T1"], conferir: true })).toBe(t);
    // Retomando (janela da falha, cota): quem decide é o próximo frame ou o prazo.
    const r = proximaFaixa(t, { tipo: "frame", frame: fr("turno.interrompido", { motivo: "turno_travado" }), agora: 2000 });
    expect(conversa(r, { vivos: [], conferir: true })).toBe(r);
  });

  it("a espera da cota diz até quando, sem 'Parou no meio'; o turno.vigia não zera o silêncio", () => {
    const t = trabalhando();
    const em = new Date(2026, 10, 4, 14, 30).getTime();
    const c = proximaFaixa(t, { tipo: "frame", frame: fr("turno.interrompido", { motivo: "ia_no_limite", espera_da_cota: "espera", renova_em: em }), agora: 2000 });
    expect(vivo(c)).toMatchObject({ retomando: true, desisteEm: null, status: "Esperando a cota até 14:30" });
    const sem = proximaFaixa(t, { tipo: "frame", frame: fr("turno.interrompido", { espera_da_cota: "espera" }), agora: 2000 });
    expect(sem).toMatchObject({ status: "Esperando a cota…" });
    const v = proximaFaixa(t, { tipo: "frame", frame: fr("turno.vigia", { minutos: 10 }), agora: 50_000 });
    expect(v).toBe(t);
  });
});


describe("ADA-4: revisão 3 — teto da troca de conta, volta da cota, fim sem frame", () => {
  const vivo = (f: Faixa) => f as Extract<Faixa, { tipo: "trabalhando" }>;
  const conversa = (f: Faixa, o: { resposta?: { id: string; texto: string } | null; vivos?: string[] | null; conferir?: boolean }): Faixa =>
    proximaFaixa(f, { tipo: "conversa", resposta: o.resposta ?? null, vivos: o.vivos === undefined ? null : o.vivos, conferir: o.conferir ?? false, agora: 500_000 });

  it("a troca de conta no teto (conta_para sem turno novo) não fica presa: a conferência sem nada vivo conclui", () => {
    const t = trabalhando();
    const r = proximaFaixa(t, { tipo: "frame", frame: fr("turno.interrompido", { motivo: "ia_no_limite", conta_para: "c2" }), agora: 2000 });
    expect(vivo(r)).toMatchObject({ retomando: true, desisteEm: null });
    const d = proximaFaixa(r, { tipo: "silencio", agora: 2000 + SILENCIO_MS });
    expect(vivo(d).demorando).toBe(true);
    expect(conversa(d, { vivos: [] })).toBe(d);
    expect(conversa(d, { vivos: ["T7"], conferir: true })).toBe(d);
    expect(conversa(d, { vivos: [], conferir: true })).toMatchObject({ tipo: "parou", porVoce: false });
    expect(conversa(d, { vivos: [], conferir: true, resposta: { id: "r1", texto: "Troquei de conta." } })).toMatchObject({ tipo: "resposta", texto: "Troquei de conta." });
  });

  it("a volta da cota marcada para depois mantém 'Esperando a cota' até dar sinal de vida", () => {
    const t = trabalhando();
    const em = new Date(2026, 10, 4, 14, 30).getTime();
    const c = proximaFaixa(t, { tipo: "frame", frame: fr("turno.interrompido", { espera_da_cota: "espera", renova_em: em, volta_turno_id: "V1" }), agora: 2000 });
    const i = proximaFaixa(c, { tipo: "frame", frame: fr("turno.iniciado", { turnoId: "V1", acordar_em: em }), agora: 2001 });
    expect(vivo(i)).toMatchObject({ turnoId: "V1", retomando: true, status: "Esperando a cota até 14:30" });
    const a = proximaFaixa(i, { tipo: "frame", frame: fr("turno.atividade", { ...frameDaFerramenta("Bash", "u1"), turnoId: "V1" }), agora: em + 1 });
    expect(vivo(a)).toMatchObject({ turnoId: "V1", retomando: false, status: "Rodando um comando" });
    // A volta sem acordar_em (ou já vencido) sai da retomada na hora, como antes.
    const j = proximaFaixa(c, { tipo: "frame", frame: fr("turno.iniciado", { turnoId: "V1", acordar_em: 1 }), agora: 2001 });
    expect(vivo(j)).toMatchObject({ turnoId: "V1", retomando: false, status: null });
  });

  it("fim sem frame nem resposta: 'acabou sem resposta' (não acusa 'Parou no meio'); com Parando…, é o Parar da pessoa", () => {
    const t = trabalhando();
    expect(conversa(t, { vivos: [], conferir: true })).toMatchObject({ tipo: "parou", porVoce: false, semFim: true });
    const p = proximaFaixa(t, { tipo: "parar" });
    expect(conversa(p, { vivos: [], conferir: true })).toMatchObject({ tipo: "parou", porVoce: true });
  });

  it("com os guardados cheios, o fim do turno não é descartado (só delta e atividade)", () => {
    let e = enviando();
    for (let i = 0; i < GUARDADOS_MAX + 5; i++) e = proximaFaixa(e, { tipo: "frame", frame: fr("turno.delta", { texto: "x" }), agora: 1 });
    e = proximaFaixa(e, { tipo: "frame", frame: fr("turno.encerrado", { estado: "concluido" }), agora: 1 });
    expect(proximaFaixa(e, { tipo: "aceito", pedidoId: "m1", turnoId: "T1", agora: 2 })).toMatchObject({ tipo: "trabalhando", encerrado: true });
  });

  it("a fala do meio vira status curto: a primeira frase, até 80 caracteres", () => {
    expect(resumoDaFala("Criei 3 tarefas. Agora vou ordenar.")).toBe("Criei 3 tarefas.");
    expect(resumoDaFala("Linha um\nlinha dois")).toBe("Linha um");
    expect(resumoDaFala("a".repeat(200))).toHaveLength(80);
    const m = conversa(trabalhando(), { resposta: { id: "r1", texto: "Vou olhar o quadro. Depois conto." }, vivos: ["T1"] });
    expect(m).toMatchObject({ tipo: "trabalhando", status: "Vou olhar o quadro." });
  });
});

describe("ADA-4: revisão 4 — a fala adiada pela cota não vira falha falsa", () => {
  const vivo = (f: Faixa) => f as Extract<Faixa, { tipo: "trabalhando" }>;
  const conferir = (f: Faixa, agora: number, vivos: string[] = []): Faixa => proximaFaixa(f, { tipo: "conversa", resposta: null, vivos, conferir: true, agora });

  it("adiarFala: interrompido sem marca + iniciado com acordar_em futuro; a conferência com vivos:[] (como o servidor devolve) não conclui antes da hora", () => {
    const em = new Date(2026, 10, 4, 18, 5).getTime();
    const t = trabalhando(em - 3_600_000);
    const i0 = proximaFaixa(t, { tipo: "frame", frame: fr("turno.interrompido", { motivo: "ia_no_limite" }), agora: em - 3_599_000 });
    const i = proximaFaixa(i0, { tipo: "frame", frame: fr("turno.iniciado", { turnoId: "T2", repete_turno_id: "T1", acordar_em: em }), agora: em - 3_598_000 });
    expect(vivo(i)).toMatchObject({ turnoId: "T2", retomando: true, desisteEm: null, acordaEm: em, status: "Esperando a cota até 18:05" });
    // A reconexão na hora e a conferência do silêncio: a volta marcada não está nos vivos (ADR-086).
    expect(conferir(i, em - 3_590_000)).toBe(i);
    const d = proximaFaixa(i, { tipo: "silencio", agora: em - 3_598_000 + SILENCIO_MS });
    expect(conferir(d, em - 1000)).toBe(d);
    // Depois da hora, sem nada vivo, conclui como antes.
    expect(conferir(d, em + CONFERIR_MS)).toMatchObject({ tipo: "parou", porVoce: false });
    // A volta que acorda tira a espera.
    const a = proximaFaixa(i, { tipo: "frame", frame: fr("turno.atividade", { ...frameDaFerramenta("Bash", "u1"), turnoId: "T2" }), agora: em + 1 });
    expect(vivo(a)).toMatchObject({ retomando: false, acordaEm: null, status: "Rodando um comando" });
  });

  it("o interrompido com volta marcada (renova_em/volta_em) também segura a conferência até a hora", () => {
    const em = 10_000_000;
    const c = proximaFaixa(trabalhando(), { tipo: "frame", frame: fr("turno.interrompido", { espera_da_cota: "espera", renova_em: em, volta_turno_id: "V1" }), agora: 2000 });
    expect(conferir(c, em - 1)).toBe(c);
    const e = proximaFaixa(trabalhando(), { tipo: "frame", frame: fr("turno.interrompido", { espera_da_cota: "espera", espera_no_fundo: "erro_transitorio", volta_em: em, volta_turno_id: "V1" }), agora: 2000 });
    expect(conferir(e, em - 1)).toBe(e);
    // A nova tentativa depois de erro não se diz "cota".
    expect(vivo(e).status).toMatch(/^Tentando de novo às \d\d:\d\d$/);
  });

  it("o Parar durante a espera, com o frame do fim perdido, é 'Parado por você'", () => {
    const c = proximaFaixa(trabalhando(), { tipo: "frame", frame: fr("turno.interrompido", { motivo: "ia_no_limite", conta_para: "c2" }), agora: 2000 });
    const p = proximaFaixa(c, { tipo: "parar" });
    expect(conferir(p, 500_000)).toMatchObject({ tipo: "parou", porVoce: true });
  });
});

describe("revisão 5 — só os turnos do pedido seguram a faixa", () => {
  it("a frente (outro turno, outra mensagem) não conta; o turno seguido e o da mensagem do pedido contam", () => {
    const t = trabalhando();
    const vivos = vivosDoPedido(t, "m1", [{ id: "FRENTE", mensagemId: "outra" }, { id: "T1", mensagemId: null }, { id: "T9", mensagemId: "m1" }], [{ id: "ALHEIA" }]);
    expect(vivos).toEqual(["T1", "T9"]);
    expect(vivosDoPedido(t, "m1", undefined, undefined)).toBeNull();
  });

  it("Retomando com só a frente viva: a conferência encerra a faixa (não fica presa)", () => {
    const t = { ...trabalhando(), retomando: true, desisteEm: null } as Faixa;
    const vivos = vivosDoPedido(t, "m1", [{ id: "FRENTE", mensagemId: "outra" }], []);
    const r = proximaFaixa(t, { tipo: "conversa", resposta: { id: "r1", texto: "Feito." }, vivos, conferir: true, agora: 5000 });
    expect(r).toMatchObject({ tipo: "resposta", mensagemId: "r1" });
  });

  it("na retomada, uma pendência de id novo ainda segura (a volta pode ter nascido num frame perdido)", () => {
    const g = { ...trabalhando(), retomando: true } as Faixa;
    expect(vivosDoPedido(g, "m1", [{ id: "FRENTE", mensagemId: "outra" }], [{ id: "VOLTA" }])).toEqual(["VOLTA"]);
  });
});

describe("revisão 7 — a troca de conta escolhida e o prazo em dúvida", () => {
  it("a pessoa escolhe outra conta na espera da cota: a faixa segue o turno novo (repete o ORIGINAL), não diz Parado por você", () => {
    let f = trabalhando();
    f = proximaFaixa(f, { tipo: "frame", frame: fr("turno.interrompido", { espera_da_cota: "espera", volta_turno_id: "T2", renova_em: 1_700_000_000_000 }), agora: 2000 });
    f = proximaFaixa(f, { tipo: "frame", frame: fr("turno.iniciado", { turnoId: "T2", acordar_em: 9_999_999 }), agora: 2100 });
    expect(f).toMatchObject({ tipo: "trabalhando", turnoId: "T2", retomando: true });
    // A cópia adiada é parada pela troca escolhida, e o turno novo diz repetir o turno original do pedido (T1).
    f = proximaFaixa(f, { tipo: "frame", frame: fr("turno.interrompido", { turnoId: "T2", motivo: "parado_pela_pessoa", substituido_por_escolha: true }), agora: 2200 });
    expect(f.tipo).toBe("trabalhando");
    f = proximaFaixa(f, { tipo: "frame", frame: fr("turno.iniciado", { turnoId: "T3", repete_turno_id: "T1" }), agora: 2300 });
    expect(f).toMatchObject({ tipo: "trabalhando", turnoId: "T3", retomando: false });
  });

  it("o Parar de verdade (sem substituido_por_escolha) continua Parado por você", () => {
    const f = proximaFaixa(trabalhando(), { tipo: "frame", frame: fr("turno.interrompido", { motivo: "parado_pela_pessoa" }), agora: 2000 });
    expect(f).toMatchObject({ tipo: "parou", porVoce: true });
  });

  it("o prazo vencido vira Não saiu em dúvida; o aceito da conferência o leva ao turno, o Não saiu de rede não", () => {
    const d = proximaFaixa(enviando(), { tipo: "recusado", duvida: true });
    expect(d).toMatchObject({ tipo: "falhou", duvida: true, idEnvio: "K1" });
    expect(proximaFaixa(d, { tipo: "aceito", pedidoId: "m1", turnoId: "T1", agora: 3000 })).toMatchObject({ tipo: "trabalhando", pedidoId: "m1", turnoId: "T1" });
    const r = proximaFaixa(enviando(), { tipo: "recusado" });
    expect(proximaFaixa(r, { tipo: "aceito", pedidoId: "m1", turnoId: "T1", agora: 3000 })).toBe(r);
  });
});
