import { describe, expect, it } from "vitest";
import {
  CATEGORIAS_ESPERA,
  chaveDoClipe,
  decidirEspera,
  ehConversaSocial,
  ehPedido,
  escolherFala,
  FALAS_DE_ESPERA,
  FERRAMENTAS_COM_FALA,
  sortearReconhecimento,
  TEMPOS_ESPERA,
  VERSAO_FALAS_DE_ESPERA,
  type EsperaTocada,
  type EstadoEspera,
} from "../../../src/domain/ligacao-espera.ts";

const estado = (e: Partial<EstadoEspera> = {}): EstadoEspera => ({
  botFalando: false,
  pessoaFalando: false,
  janelaAprovacao: false,
  onboarding: false,
  reconhecer: false,
  p50CerebroMs: null,
  aguardandoRespostaDesde: null,
  ferramenta: null,
  trabalhandoDesde: null,
  perguntaDoBotEm: null,
  ultimaAtividadeEm: 0,
  ociosidadeSuspensa: false,
  historico: [],
  ...e,
});
const tocou = (categoria: EsperaTocada["categoria"], em: number, id = `${categoria}.01`): EsperaTocada => ({ id, categoria, em });
const sempre = (x: number) => () => x;

describe("biblioteca de falas", () => {
  it("toda categoria tem fala; as principais têm pelo menos 6", () => {
    for (const c of CATEGORIAS_ESPERA) expect(FALAS_DE_ESPERA.some((f) => f.categoria === c), c).toBe(true);
    for (const c of ["reconhecimento", "pensando", "tarefa_longa", "nao_entendi", "ociosidade", "pensando_longo"] as const) {
      expect(FALAS_DE_ESPERA.filter((f) => f.categoria === c).length, c).toBeGreaterThanOrEqual(6);
    }
  });

  it("toda ferramenta do nod tem fala própria", () => {
    for (const f of FERRAMENTAS_COM_FALA) expect(FALAS_DE_ESPERA.some((x) => x.categoria === "ferramenta" && x.ferramenta === f), f).toBe(true);
    expect(FALAS_DE_ESPERA.some((x) => x.categoria === "ferramenta" && x.ferramenta === undefined)).toBe(true);
  });

  it("ids estáveis e únicos, com versão", () => {
    const ids = FALAS_DE_ESPERA.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of FALAS_DE_ESPERA) {
      expect(f.id).toMatch(/^[a-z_]+(\.[a-z_]+)?\.\d{2}$/);
      expect(f.versao).toBeGreaterThanOrEqual(1);
    }
    expect(FALAS_DE_ESPERA.find((f) => f.id === "pensando.01")?.texto).toBe("Hum, deixa eu ver…");
    expect(FALAS_DE_ESPERA.find((f) => f.id === "ferramenta.criar_rotina.01")?.texto).toBe("Tô montando a rotina…");
    expect(VERSAO_FALAS_DE_ESPERA).toBeGreaterThanOrEqual(1);
  });

  it("textos curtos, sem repetição e neutros em gênero", () => {
    const textos = FALAS_DE_ESPERA.map((f) => f.texto);
    expect(new Set(textos.map((t) => `${t}`)).size).toBeGreaterThan(textos.length - 3);
    for (const t of textos) {
      expect(t.length, t).toBeLessThanOrEqual(60);
      expect(t, t).not.toMatch(/\b(pront[ao]s?|obrigad[ao]s?|cansad[ao]|ocupad[ao]|sozinh[ao]|preparad[ao]|animad[ao]|perdid[ao])\b/i);
    }
  });

  it("chave do clipe junta provedor, voz, velocidade, id e versão", () => {
    expect(chaveDoClipe({ provedor: "google", voz: "clara", velocidade: 1.25, fala: { id: "pensando.01", versao: 2 } })).toBe("google/clara/1.25/pensando.01@2");
  });
});

describe("conversa social e pedido", () => {
  it("cumprimento curto é social, não pedido", () => {
    for (const t of ["oi", "Oi, tudo bem?", "e aí", "bom dia!", "tudo bem com você?", "valeu, obrigada", "oi Nina"]) {
      expect(ehConversaSocial(t, "Nina"), t).toBe(true);
      expect(ehPedido(t, "Nina"), t).toBe(false);
    }
  });

  it("pedido tem pelo menos 3 palavras de conteúdo", () => {
    expect(ehPedido("cria uma rotina pra mim")).toBe(true);
    expect(ehPedido("bom dia, lê meus e-mails")).toBe(true);
    expect(ehPedido("uhum, tá bom")).toBe(false);
    expect(ehPedido("e amanhã?")).toBe(false);
  });

  it("sortearReconhecimento: ≤40%, só em pedido, nunca no onboarding", () => {
    const pedido = "vê minha agenda de amanhã";
    expect(sortearReconhecimento({ texto: pedido, onboarding: false, aleatorio: sempre(0.39) })).toBe(true);
    expect(sortearReconhecimento({ texto: pedido, onboarding: false, aleatorio: sempre(0.4) })).toBe(false);
    expect(sortearReconhecimento({ texto: pedido, onboarding: true, aleatorio: sempre(0) })).toBe(false);
    expect(sortearReconhecimento({ texto: "oi, tudo bem?", onboarding: false, aleatorio: sempre(0) })).toBe(false);
    let n = 0;
    let semente = 1;
    const aleatorio = () => ((semente = (semente * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 1000; i++) if (sortearReconhecimento({ texto: pedido, onboarding: false, aleatorio })) n++;
    expect(n / 1000).toBeGreaterThan(0.33);
    expect(n / 1000).toBeLessThan(0.47);
  });
});

describe("decidirEspera", () => {
  const T0 = 100_000;

  it("reconhecimento aos 300 ms (200 com cérebro lento), só com o sorteio e fora do onboarding", () => {
    const e = estado({ aguardandoRespostaDesde: T0, reconhecer: true });
    expect(decidirEspera(e, T0 + 299)).toBeNull();
    expect(decidirEspera(e, T0 + 300)).toEqual({ categoria: "reconhecimento" });
    expect(decidirEspera({ ...e, p50CerebroMs: 1600 }, T0 + 200)).toEqual({ categoria: "reconhecimento" });
    expect(decidirEspera({ ...e, p50CerebroMs: 1400 }, T0 + 200)).toBeNull();
    expect(decidirEspera({ ...e, reconhecer: false }, T0 + 300)).toBeNull();
    expect(decidirEspera({ ...e, onboarding: true }, T0 + 300)).toBeNull();
    expect(decidirEspera({ ...e, historico: [tocou("reconhecimento", T0 + 300)] }, T0 + 2400)).toEqual({ categoria: "pensando" });
  });

  it("pensando aos 1,6 s e outra variante (pensando longo) aos 4 s", () => {
    const e = estado({ aguardandoRespostaDesde: T0 });
    expect(decidirEspera(e, T0 + 1599)).toBeNull();
    expect(decidirEspera(e, T0 + 1600)).toEqual({ categoria: "pensando" });
    const depois = { ...e, historico: [tocou("pensando", T0 + 1600)] };
    expect(decidirEspera(depois, T0 + 3999)).toBeNull();
    expect(decidirEspera(depois, T0 + 4000)).toEqual({ categoria: "pensando_longo" });
  });

  it("nada toca com alguém falando, na janela de aprovação ou a menos de 2 s da última espera", () => {
    const e = estado({ aguardandoRespostaDesde: T0 });
    expect(decidirEspera({ ...e, botFalando: true }, T0 + 1600)).toBeNull();
    expect(decidirEspera({ ...e, pessoaFalando: true }, T0 + 1600)).toBeNull();
    expect(decidirEspera({ ...e, janelaAprovacao: true }, T0 + 1600)).toBeNull();
    expect(decidirEspera({ ...e, historico: [tocou("ociosidade", T0 + 1000)] }, T0 + 2999)).toBeNull();
    expect(decidirEspera({ ...e, historico: [tocou("ociosidade", T0 + 1000)] }, T0 + 3000)).toEqual({ categoria: "pensando" });
  });

  it("ferramenta aos 1,2 s do início, sem narração, com o nome", () => {
    const f = { nome: "mcp__nod__criar_rotina", desde: T0, narrada: false };
    expect(decidirEspera(estado({ ferramenta: f }), T0 + 1199)).toBeNull();
    expect(decidirEspera(estado({ ferramenta: f }), T0 + 1200)).toEqual({ categoria: "ferramenta", ferramenta: "mcp__nod__criar_rotina" });
    expect(decidirEspera(estado({ ferramenta: { ...f, narrada: true } }), T0 + 1200)).toBeNull();
    expect(decidirEspera(estado({ ferramenta: f, historico: [tocou("ferramenta", T0 + 1200)] }), T0 + 4000)).toBeNull();
  });

  it("com ferramenta rodando, pensando não toca por cima", () => {
    const e = estado({ aguardandoRespostaDesde: T0, ferramenta: { nome: "lembrar", desde: T0 + 100, narrada: true } });
    expect(decidirEspera(e, T0 + 1600)).toBeNull();
  });

  it("tarefa longa aos 8, 20 e 45 s e depois a cada 60 s, no máximo 4", () => {
    const base = estado({ trabalhandoDesde: T0, ferramenta: { nome: "x", desde: T0, narrada: true } });
    const h: EsperaTocada[] = [];
    const quando: number[] = [];
    for (let t = T0; t <= T0 + 400_000; t += 100) {
      const d = decidirEspera({ ...base, historico: h }, t);
      if (d?.categoria === "tarefa_longa") {
        h.push(tocou("tarefa_longa", t, `tarefa_longa.0${h.length + 1}`));
        quando.push(t - T0);
      }
    }
    expect(quando).toEqual([8_000, 20_000, 45_000, 105_000]);
    expect(TEMPOS_ESPERA.tarefaLongaMax).toBe(4);
  });

  it("cérebro demorado sem ferramenta também chega à tarefa longa aos 8 s", () => {
    const h = [tocou("pensando", T0 + 1600), tocou("pensando_longo", T0 + 4000)];
    expect(decidirEspera(estado({ aguardandoRespostaDesde: T0, historico: h }), T0 + 8000)).toEqual({ categoria: "tarefa_longa" });
  });

  it("ociosidade 7 s e 20 s depois de uma pergunta do bot, e só duas vezes", () => {
    const e = estado({ perguntaDoBotEm: T0, ultimaAtividadeEm: T0 });
    expect(decidirEspera(e, T0 + 6999)).toBeNull();
    expect(decidirEspera(e, T0 + 7000)).toEqual({ categoria: "ociosidade" });
    const uma = { ...e, historico: [tocou("ociosidade", T0 + 7000)] };
    expect(decidirEspera(uma, T0 + 19_999)).toBeNull();
    expect(decidirEspera(uma, T0 + 20_000)).toEqual({ categoria: "ociosidade" });
    const duas = { ...e, historico: [tocou("ociosidade", T0 + 7000), tocou("ociosidade", T0 + 20_000, "ociosidade.02")] };
    expect(decidirEspera(duas, T0 + 60_000)).toBeNull();
  });

  it("despedida aos 3 min de silêncio, suspensa com card, tarefa ou login aberto", () => {
    const e = estado({ ultimaAtividadeEm: T0 });
    expect(decidirEspera(e, T0 + 179_999)).toBeNull();
    expect(decidirEspera(e, T0 + 180_000)).toEqual({ categoria: "ociosidade_final" });
    expect(decidirEspera({ ...e, ociosidadeSuspensa: true }, T0 + 180_000)).toBeNull();
    expect(decidirEspera({ ...e, trabalhandoDesde: T0 + 1000 }, T0 + 180_000)?.categoria).not.toBe("ociosidade_final");
    expect(decidirEspera({ ...e, historico: [tocou("ociosidade_final", T0 + 180_000)] }, T0 + 200_000)).toBeNull();
  });
});

describe("escolherFala", () => {
  const T = 1_000_000;

  it("sorteia dentro da categoria com o aleatório injetado", () => {
    const pensando = FALAS_DE_ESPERA.filter((f) => f.categoria === "pensando");
    expect(escolherFala("pensando", [], T, sempre(0))?.id).toBe(pensando[0]!.id);
    expect(escolherFala("pensando", [], T, sempre(0.999))?.id).toBe(pensando[pensando.length - 1]!.id);
  });

  it("respeita 2 s desde a última espera", () => {
    expect(escolherFala("pensando", [tocou("reconhecimento", T - 1999)], T, sempre(0))).toBeNull();
    expect(escolherFala("pensando", [tocou("reconhecimento", T - 2000)], T, sempre(0))).not.toBeNull();
  });

  it("não repete nos últimos 60 s nem entre as últimas ⌈n/2⌉ da categoria", () => {
    const pensando = FALAS_DE_ESPERA.filter((f) => f.categoria === "pensando");
    const n = pensando.length;
    // As ⌈n/2⌉ mais recentes, todas há mais de 60 s: continuam bloqueadas.
    const h = pensando.slice(0, Math.ceil(n / 2)).map((f, i) => ({ id: f.id, categoria: f.categoria, em: T - 120_000 - i * 1000 }));
    for (let x = 0; x < 1; x += 0.05) {
      const f = escolherFala("pensando", h, T, sempre(x));
      expect(h.some((y) => y.id === f?.id)).toBe(false);
    }
    // Uma mais antiga que as ⌈n/2⌉ recentes e fora dos 60 s volta a valer.
    const velha = { id: pensando[n - 1]!.id, categoria: "pensando" as const, em: T - 999_000 };
    const comVelha = [...h, velha];
    const escolhidas = new Set(Array.from({ length: 20 }, (_, i) => escolherFala("pensando", comVelha, T, sempre(i / 20))?.id));
    expect(escolhidas.has(velha.id)).toBe(true);
  });

  it("qualquer fala tocada nos últimos 60 s fica de fora, mesmo de outra rodada", () => {
    const r = FALAS_DE_ESPERA.filter((f) => f.categoria === "reconhecimento");
    const h = r.map((f, i) => ({ id: f.id, categoria: f.categoria, em: T - 59_000 + i * 1000 }));
    expect(escolherFala("reconhecimento", h, T, sempre(0))).toBeNull();
    // um minuto depois da primeira, ela volta
    expect(escolherFala("reconhecimento", h, T + 1000, sempre(0))?.id).toBe(r[0]!.id);
  });

  it("ferramenta: a fala própria, a de app para conector, a genérica para o resto e quando a própria se esgota", () => {
    expect(escolherFala("ferramenta", [], T, sempre(0), "mcp__nod__criar_rotina")?.ferramenta).toBe("criar_rotina");
    expect(escolherFala("ferramenta", [], T, sempre(0), "pedir_acesso")?.ferramenta).toBe("pedir_acesso");
    expect(escolherFala("ferramenta", [], T, sempre(0), "mcp__nod__gmail__GMAIL_FETCH_EMAILS")?.ferramenta).toBe("conector");
    expect(escolherFala("ferramenta", [], T, sempre(0), "iniciar_tarefa")?.ferramenta).toBeUndefined();
    expect(escolherFala("ferramenta", [], T, sempre(0))?.ferramenta).toBeUndefined();
    const proprias = FALAS_DE_ESPERA.filter((f) => f.ferramenta === "criar_rotina").map((f, i) => ({ id: f.id, categoria: f.categoria, em: T - 30_000 + i }));
    const f = escolherFala("ferramenta", proprias, T, sempre(0), "criar_rotina");
    expect(f?.categoria).toBe("ferramenta");
    expect(f?.ferramenta).toBeUndefined();
  });

  it("informativa toca mesmo repetida e sem esperar 2 s: a menos recente", () => {
    const quedas = FALAS_DE_ESPERA.filter((f) => f.categoria === "queda_cerebro");
    const h = quedas.map((f, i) => ({ id: f.id, categoria: f.categoria, em: T - 10_000 + i * 1000 }));
    const f = escolherFala("queda_cerebro", h, T, sempre(0));
    expect(f?.id).toBe(quedas[0]!.id);
    expect(escolherFala("despedida", [tocou("pensando", T - 100)], T, sempre(0))).not.toBeNull();
  });
});
