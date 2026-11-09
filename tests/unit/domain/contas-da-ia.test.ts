import { describe, expect, it } from "vitest";
import {
  contaEmUso,
  contaVoltou,
  contaNoLimiteValida,
  contasIniciais,
  decidirNoLimite,
  ehCorporativa,
  fraseDaDecisao,
  normalizarContas,
  usarConta,
  type ContaGuardada,
  type ContasDaIa,
} from "../../../src/domain/contas-da-ia.ts";

const AGORA = 1_760_000_000_000;
const HORA = 3_600_000;
const conta = (id: string, plano: string | null, extra: Partial<ContaGuardada> = {}): ContaGuardada => ({ id, apelido: id, plano, entraNaTrocaAutomatica: false, noLimiteAte: null, ...extra });
/** O cenário do protótipo v3: conta 1 pessoal Max, conta 2 Lumen Team, conta 3 reserva Pro. */
const tres = (extra: Partial<ContasDaIa> = {}): ContasDaIa => ({ modo: "perguntar", contas: [conta("padrao", "max"), conta("lumen", "team"), conta("reserva", "pro")], escolhida: null, ...extra });
const quando = (t: number) => (t === AGORA + 2 * HORA ? "14:00" : t === AGORA + 3 * HORA ? "15:00" : "?");
const frase = (d: Parameters<typeof fraseDaDecisao>[0]) => fraseDaDecisao(d, { ia: "Claude Code", quando, quandoVolta: (t) => `às ${quando(t)}` });

describe("ehCorporativa", () => {
  it("planos de empresa e plano desconhecido são corporativos; os pessoais não", () => {
    for (const p of ["team", "Enterprise", "business", "edu", null, "algo_novo"]) expect(ehCorporativa(p), String(p)).toBe(true);
    for (const p of ["free", "pro", "max", "plus", "claude_max", "chatgpt_plus", "max_20x"]) expect(ehCorporativa(p), p).toBe(false);
  });
});

describe("decidirNoLimite", () => {
  it("Perguntar antes (padrão): oferece todas as livres, inclusive a corporativa, e não troca", () => {
    const { cfg, decisao } = decidirNoLimite(tres(), { id: "padrao", ate: AGORA + 2 * HORA, agora: AGORA });
    expect(decisao).toEqual({ tipo: "perguntar", de: 1, livres: [2, 3], foraDaTroca: [], voltaEm: AGORA + 2 * HORA });
    expect(cfg.escolhida).toBeNull();
    expect(cfg.contas[0]?.noLimiteAte).toBe(AGORA + 2 * HORA);
    expect(frase(decisao)).toBe("Conta 1 do Claude Code no limite até 14:00. Seguir com a conta 2 ou 3?");
  });

  it("Trocar sozinho (NOD-308): a corporativa livre entra na ordem como qualquer conta, sem estar marcada", () => {
    const { cfg, decisao } = decidirNoLimite(tres({ modo: "automatico" }), { id: "padrao", ate: AGORA + 2 * HORA, agora: AGORA });
    expect(decisao).toEqual({ tipo: "trocou", de: 1, para: 2, voltaEm: AGORA + 2 * HORA, foraDaTroca: [] });
    expect(cfg.escolhida).toBe("lumen");
    expect(frase(decisao)).toBe("Conta 1 do Claude Code no limite até 14:00. Seguindo com a conta 2.");
  });

  it("Trocar sozinho (NOD-308): só sobrou a corporativa livre, troca para ela em vez de perguntar", () => {
    const base = tres({ modo: "automatico" });
    base.contas[2] = { ...(base.contas[2] as ContaGuardada), noLimiteAte: AGORA + 3 * HORA };
    const { cfg, decisao } = decidirNoLimite(base, { id: "padrao", ate: AGORA + 2 * HORA, agora: AGORA });
    expect(decisao).toEqual({ tipo: "trocou", de: 1, para: 2, voltaEm: AGORA + 2 * HORA, foraDaTroca: [] });
    expect(cfg.escolhida).toBe("lumen");
  });

  it("todas no limite: diz quando a primeira volta", () => {
    const base = tres();
    base.contas = base.contas.map((c, i) => (i === 0 ? c : { ...c, noLimiteAte: AGORA + 3 * HORA }));
    const { cfg, decisao } = decidirNoLimite(base, { id: "padrao", ate: AGORA + 2 * HORA, agora: AGORA });
    expect(decisao).toEqual({ tipo: "todas_no_limite", noLimite: [1, 2, 3], voltaEm: AGORA + 2 * HORA });
    expect(cfg.escolhida).toBeNull();
    expect(frase(decisao)).toBe("Todas as contas do Claude Code estão no limite. A primeira volta às 14:00.");
  });

  it("sem horário do fornecedor: a conta fica 1 h no limite e a frase não inventa hora", () => {
    const { cfg, decisao } = decidirNoLimite(tres(), { id: "padrao", ate: null, agora: AGORA });
    expect(cfg.contas[0]?.noLimiteAte).toBe(AGORA + HORA);
    expect(frase(decisao)).toBe("Conta 1 do Claude Code no limite. Seguir com a conta 2 ou 3?");
  });

  it("uma conta só (o caso de hoje): todas no limite", () => {
    const { decisao } = decidirNoLimite(contasIniciais(), { id: "padrao", ate: AGORA + 2 * HORA, agora: AGORA });
    expect(decisao.tipo).toBe("todas_no_limite");
  });
});

describe("contaEmUso, usarConta, contaVoltou", () => {
  it("a preferida volta quando renova; enquanto isso, vale a escolhida", () => {
    const { cfg } = decidirNoLimite(tres({ modo: "automatico" }), { id: "padrao", ate: AGORA + 2 * HORA, agora: AGORA });
    expect(contaEmUso(cfg, AGORA + HORA).id).toBe("lumen");
    expect(contaEmUso(cfg, AGORA + 2 * HORA).id).toBe("padrao");
  });

  it("Seguir com a conta 2 (escolha da pessoa) vale também para a corporativa", () => {
    const { cfg } = decidirNoLimite(tres(), { id: "padrao", ate: AGORA + 2 * HORA, agora: AGORA });
    const usada = usarConta(cfg, 2);
    expect(usada && contaEmUso(usada, AGORA).id).toBe("lumen");
    expect(usarConta(cfg, 9)).toBeNull();
  });

  // QA do NOD-211: a escolha de antes não pode valer em silêncio quando o nod volta a perguntar.
  it("Perguntar antes com uma escolha antiga: a conta 1 parou de novo, a pergunta vale e o turno não vai sozinho na antiga", () => {
    const ontem = usarConta(decidirNoLimite(tres(), { id: "padrao", ate: AGORA - HORA, agora: AGORA - 3 * HORA }).cfg, 2)!;
    expect(ontem.escolhida).toBe("lumen");
    const { cfg, decisao } = decidirNoLimite(ontem, { id: "padrao", ate: AGORA + 2 * HORA, agora: AGORA });
    expect(decisao).toMatchObject({ tipo: "perguntar", de: 1, livres: [2, 3] });
    expect(cfg.escolhida).toBeNull();
    expect(contaEmUso(cfg, AGORA).id).toBe("padrao");
  });

  it("um turno que deu certo tira a conta do limite", () => {
    const { cfg } = decidirNoLimite(tres(), { id: "padrao", ate: AGORA + 2 * HORA, agora: AGORA });
    expect(contaEmUso(contaVoltou(cfg, "padrao"), AGORA).id).toBe("padrao");
  });
});

describe("normalizarContas", () => {
  it("lixo vira o padrão: perguntar, uma conta, opt-in false", () => {
    expect(normalizarContas(null)).toEqual(contasIniciais());
    expect(normalizarContas({ modo: "x", contas: "y" })).toEqual(contasIniciais());
  });

  it("opt-in só com true explícito; id sem forma, repetido e escolhida desconhecida caem; a conta 1 é garantida", () => {
    const n = normalizarContas({
      modo: "automatico",
      contas: [{ id: "lumen", apelido: " Lumen\n Team ", plano: "TEAM", entraNaTrocaAutomatica: "sim" }, { id: "lumen" }, { id: "../fora" }, { id: "b", entraNaTrocaAutomatica: true }],
      escolhida: "zzz",
    });
    expect(n.modo).toBe("automatico");
    expect(n.contas.map((c) => c.id)).toEqual(["padrao", "lumen", "b"]);
    expect(n.contas[1]).toMatchObject({ apelido: "Lumen Team", plano: "team", entraNaTrocaAutomatica: false });
    expect(n.contas[2]?.entraNaTrocaAutomatica).toBe(true);
    expect(n.escolhida).toBeNull();
  });
});

describe("contaNoLimiteValida (o que vem do Mac pela ponte)", () => {
  it("as três decisões do domínio passam iguais", () => {
    for (const base of [tres(), tres({ modo: "automatico" })]) {
      const { decisao } = decidirNoLimite(base, { id: "padrao", ate: AGORA + 2 * HORA, agora: AGORA });
      expect(contaNoLimiteValida(decisao, AGORA)).toEqual(decisao);
    }
    const { decisao } = decidirNoLimite(contasIniciais(), { id: "padrao", ate: null, agora: AGORA });
    expect(contaNoLimiteValida(decisao, AGORA)).toEqual(decisao);
  });

  it("posição fora de 1..6, repetida, trocar para a mesma, hora absurda e tipo desconhecido caem", () => {
    const ruins: unknown[] = [
      null,
      "trocou",
      { tipo: "trocou", de: 1, para: 1, voltaEm: null, foraDaTroca: [] },
      { tipo: "trocou", de: 0, para: 2, voltaEm: null, foraDaTroca: [] },
      { tipo: "trocou", de: 1, para: 2, voltaEm: AGORA + 40 * 24 * HORA, foraDaTroca: [] },
      { tipo: "perguntar", de: 1, livres: [2, 2], foraDaTroca: [], voltaEm: null },
      { tipo: "perguntar", de: 1, livres: [1], foraDaTroca: [], voltaEm: null },
      { tipo: "perguntar", de: 1, livres: [2], foraDaTroca: [3], voltaEm: null },
      { tipo: "todas_no_limite", noLimite: [], voltaEm: null },
      { tipo: "outro", de: 1 },
      { tipo: "trocou", de: 1, para: 7, voltaEm: null, foraDaTroca: [] },
    ];
    for (const r of ruins) expect(contaNoLimiteValida(r, AGORA), JSON.stringify(r)).toBeUndefined();
  });

  it("só posições saem: apelido e plano que vierem a mais são descartados", () => {
    expect(contaNoLimiteValida({ tipo: "trocou", de: 1, para: 2, voltaEm: null, foraDaTroca: [], apelido: "Lumen" }, AGORA)).toEqual({ tipo: "trocou", de: 1, para: 2, voltaEm: null, foraDaTroca: [] });
  });
});

describe("fraseDaDecisao na sala (re-QA A4, m17 — NOD-284)", () => {
  it("troca na sala nunca diz 'Seguindo com': pede para falar de novo; na conversa segue dizendo 'Seguindo com'", () => {
    const d = { tipo: "trocou" as const, de: 1, para: 3, voltaEm: null, foraDaTroca: [2] };
    const naSala = fraseDaDecisao(d, { ia: "Claude Code", quando, quandoVolta: (t) => `às ${quando(t)}`, origem: "sala" });
    expect(naSala).toBe("Conta 1 do Claude Code no limite. Fale de novo para seguir com a conta 3.");
    expect(naSala).not.toContain("Seguindo com");
    expect(frase(d)).toContain("Seguindo com a conta 3");
  });
});
