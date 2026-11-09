import { describe, expect, it } from "vitest";
import type { ChamadaRaioX, RaioXTurno } from "../../../src/contracts/raio-x.ts";
import { partesFixas, renderRaioX } from "../../../web/telas/raio-x-render.ts";

const chamada = (em: number, contexto: number, ferramentas: ChamadaRaioX["ferramentas"] = [], extra: Partial<ChamadaRaioX> = {}): ChamadaRaioX => ({
  em, contexto, entrada: 10, cacheLido: contexto - 10, cacheNovo: 0, saida: 300, pensamento: 0, subagente: false, ferramentas, ...extra,
});

/** O turno da Clarice que estourou a janela (canvas D2): parte fixa pesada, catálogo no prompt, busca desligada. */
const CLARICE: RaioXTurno = {
  turnoId: "t1", agenteId: "a", estado: "interrompido", custoUsd: 1.02, criadoEm: Date.UTC(2026, 8, 28, 20, 24, 0),
  composicao: {
    modo: "conversa", modelo: "claude-sonnet-5", harness: "claude-cli", sessaoRetomada: true, promptChars: 120_000,
    prompt: [{ secao: "identidade", chars: 1_000, texto: "Você é Clarice" }, { secao: "apps", chars: 99_000, texto: "Conexões cadastradas…" }, { secao: "contexto", chars: 20_000 }],
    ferramentas: [{ grupo: "nod", origem: "nod", quantidade: 16, chars: 16_000 }, { grupo: "clickup", origem: "conector", quantidade: 63, chars: 168_000 }],
    nativas: ["Read", "Bash"], entrada: { chars: 218, anexos: 0, texto: "no checklist diario…\nVamos tentar ?" }, comTexto: true,
  },
  execucao: {
    chamadas: [
      chamada(48_000, 100_500, [{ nome: "mcp__claude_ai_ClickUp__clickup_filter_tasks", resultadoChars: 73_900, erro: false }, { nome: "Read", resultadoChars: 11_000, erro: false }]),
      chamada(87_000, 181_800),
      chamada(166_000, 172_400, [{ nome: "mcp__nod__lembrar", resultadoChars: 16, erro: true }]),
    ],
    chamadasOmitidas: 0,
    compactacoes: [{ em: 77_000, antes: 179_900, depois: 22_700, gatilho: "auto" }],
    janela: 200_000, modelo: "claude-sonnet-5", versaoCli: "2.1.284", custoSessaoUsd: 11.17, ferramentasNoInit: 140, buscaDeFerramentas: false, duracaoMs: 125_000,
  },
};

describe("Raio-X do turno (revisão contra o canvas, D2 e D3)", () => {
  it("a parte fixa em partes, da maior para a menor; o Claude Code com número, e a maior em âmbar quando passa de meia janela", () => {
    const partes = partesFixas(CLARICE, CLARICE.execucao!, CLARICE.execucao!.chamadas[0]!);
    expect(partes.map((p) => [p.nome, p.tokens])).toEqual([
      ["Definições das 63 ferramentas de apps", 42_000],
      ["Catálogo de apps no prompt", 24_750],
      ["Claude Code: prompt base, nativas, histórico da sessão e a mensagem", 100_500 - 42_000 - 24_750 - 5_250 - 4_000],
      ["Prompt do nod", 5_250],
      ["Ferramentas do nod", 4_000],
    ]);
    expect(partes[0]!.pesada).toBe(true);
    expect(partes.filter((p) => p.pesada)).toHaveLength(1);
  });

  it("com a busca de ferramentas ligada, as de apps ficam sob demanda e fora da barra", () => {
    const r = { ...CLARICE, execucao: { ...CLARICE.execucao!, buscaDeFerramentas: true } };
    const apps = partesFixas(r, r.execucao, r.execucao.chamadas[0]!).find((p) => p.nome.startsWith("Ferramentas de apps"))!;
    expect(apps).toMatchObject({ tokens: 0, nota: "sob demanda" });
  });

  it("custo e contexto: cartões, barra com legenda e sobra, uma linha por chamada com o resultado grande em negrito", () => {
    const html = renderRaioX(CLARICE, "Clarice");
    expect(html).toContain('<b class="rx-valor">US$ 1,02</b><span class="rx-sub">sessão: US$ 11,17 acumulado</span>');
    expect(html).toContain(`<span class="rx-sub rx-atencao">+${"\u00a0"}1${"\u00a0"}compactação</span>`);
    expect(html).toContain("sobram 99,5 mil para a conversa e os resultados");
    expect(html).toContain('<div class="rx-pilha" role="img" aria-label="Definições das 63 ferramentas de apps ~42 mil, ');
    expect(html).toContain("<code>clickup_filter_tasks</code> → <b>73,9 mil</b>");
    expect(html).toContain("<code>Read</code> → 11 mil caract.");
    expect(html).toContain('<code>lembrar</code> → 16 caract. <span class="rx-erro">erro</span>');
    expect(html).toContain("⟳ compactou: 179,9 mil → 22,7 mil");
    expect(html).toContain("✕ turno interrompido");
    expect(html).not.toContain("o resto");
  });

  it("o que foi enviado: seta nas linhas que abrem, total das ferramentas, a seção que pesa destacada e a mensagem como texto", () => {
    const html = renderRaioX(CLARICE, "Clarice");
    expect(html).toContain('<details class="rx-item rx-pesada" data-disclosure="rx-apps"><summary><span class="rx-seta" aria-hidden="true"></span><span class="rx-item-nome">Apps e conexões</span>');
    expect(html).toContain('<div class="rx-item"><span class="rx-seta rx-seta-vazia" aria-hidden="true"></span><span class="rx-item-nome">Contexto recente da conversa</span>');
    expect(html).toContain('<h3>2 · Definições de ferramentas</h3><span class="rx-num">184 mil caract.</span>');
    expect(html).toContain("Busca de ferramentas do Claude Code: <b>desligada</b>");
    expect(html).toContain('<p class="rx-texto rx-citacao">“no checklist diario…\nVamos tentar ?”</p>');
  });

  it("abas ligadas aos painéis, uma focável por vez; fechar com rótulo", () => {
    const html = renderRaioX(CLARICE, "Clarice");
    expect(html).toContain('role="tab" id="rx-aba-custo" aria-controls="rx-painel-custo" aria-selected="true" tabindex="0"');
    expect(html).toContain('role="tab" id="rx-aba-enviado" aria-controls="rx-painel-enviado" aria-selected="false" tabindex="-1"');
    expect(html).toContain('role="tabpanel" id="rx-painel-enviado" aria-labelledby="rx-aba-enviado"');
    expect(html).toContain('aria-label="Fechar o Raio-X"');
  });

  it("turno que caiu antes da primeira chamada diz isso, sem lista vazia nem pico zero", () => {
    const r: RaioXTurno = { ...CLARICE, estado: "concluido", execucao: { ...CLARICE.execucao!, chamadas: [], compactacoes: [] } };
    const html = renderRaioX(r, "Clarice");
    expect(html).toContain("Nenhuma chamada chegou a ser registrada neste turno.");
    expect(html).toContain('<span class="rx-rotulo">Pico do contexto</span><b class="rx-valor">—</b>');
    expect(html).not.toContain('class="rx-linha"');
  });

  it("sessão nova não repete o custo como acumulado, e a janela de 1 milhão lê \"1 mi\"", () => {
    const r: RaioXTurno = { ...CLARICE, estado: "concluido", composicao: { ...CLARICE.composicao!, sessaoRetomada: false }, execucao: { ...CLARICE.execucao!, janela: 1_000_000 } };
    const html = renderRaioX(r, "Dev 1");
    expect(html).not.toContain("acumulado");
    expect(html).toContain("de 1 mi");
    expect(html).not.toContain("1.000 mil");
    expect(html).not.toContain("rx-pesada\"><span class=\"rx-cor");
  });

  it("ADR-112: \"O que foi enviado\" diz se o Modo WhatsApp valeu; turno de antes da 0089 lê desligado", () => {
    const com = (experimentos: NonNullable<RaioXTurno["composicao"]>["experimentos"]): RaioXTurno => ({ ...CLARICE, composicao: { ...CLARICE.composicao!, experimentos } });
    expect(renderRaioX(com({ calibracao: true, memoriaLonga: false, whatsapp: true, anexosAnteriores: 0 }), "Clarice")).toContain("Calibração <b>ligada</b> · Memória longa <b>desligada</b> · Modo WhatsApp <b>ligado</b>");
    expect(renderRaioX(com({ calibracao: false, memoriaLonga: false, anexosAnteriores: 0 }), "Clarice")).toContain("Modo WhatsApp <b>desligado</b>");
    expect(renderRaioX(CLARICE, "Clarice")).not.toContain("Modo WhatsApp");
  });
});

describe("2026-11-09: a versão do app no cabeçalho do Raio-X", () => {
  it("com a versão gravada pelo servidor, o cabeçalho diz qual app rodou o turno; sem ela, nada muda", () => {
    const comApp = renderRaioX({ ...CLARICE, execucao: { ...CLARICE.execucao!, versaoApp: "1.0.0-rc.6" } }, "Clarice");
    expect(comApp).toContain("Claude Code 2.1.284 · app 1.0.0-rc.6");
    expect(renderRaioX(CLARICE, "Clarice")).not.toContain("app 1.0.0");
  });
});

describe("NOD-312: o chip da sessão no Raio-X", () => {
  const abrir = (composicao: Partial<NonNullable<RaioXTurno["composicao"]>>) => renderRaioX({ ...CLARICE, composicao: { ...CLARICE.composicao!, ...composicao } }, "Clarice");
  it("motivo desconhecido (servidor mais novo): só 'recomeçou', nunca 'undefined' (revisão 9)", () => {
    const html = abrir({ sessaoRetomada: false, recomeco: { motivo: "troca_de_galaxia" as never, avisoChars: 200, resumoChars: 0, historicoChars: 0 } });
    expect(html).toContain('<span class="rx-num p312-chip">recomeçou</span>');
    expect(html).not.toContain("undefined");
  });
  it("recomeçou: o motivo no chip e no cabeçalho, e as partes que foram no prompt", () => {
    const html = abrir({ sessaoRetomada: false, recomeco: { motivo: "troca_de_conta", avisoChars: 200, resumoChars: 1_100, historicoChars: 2_900 } });
    expect(html).toContain('<span class="rx-num p312-chip">recomeçou · troca de conta</span>');
    expect(html).toMatch(/rx-meta">[^<]*recomeçou · troca de conta/);
    expect(html).toContain(">Aviso de recomeço<");
    expect(html).toContain(">Resumo do trabalho<");
    expect(html).toContain(">Últimas falas<");
    // Revisão 1: o aviso e o resumo vão na entrada do turno (seção 4), as falas no histórico (seção 3).
    const s3 = html.slice(html.indexOf("3 · Histórico"), html.indexOf("4 · Entrada"));
    const s4 = html.slice(html.indexOf("4 · Entrada"));
    expect(s3).toContain(">Últimas falas<");
    expect(s3).not.toContain(">Aviso de recomeço<");
    expect(s4).toContain(">Aviso de recomeço<");
    expect(s4).toContain(">Resumo do trabalho<");
    expect(s3).toContain("vão na entrada do turno");
  });
  it("QA (bug 2): a fala com \"/\" que recomeçou leva o chip, sem prometer aviso nem resumo na entrada", () => {
    const html = abrir({ sessaoRetomada: false, recomeco: { motivo: "troca_de_ia", avisoChars: 0, resumoChars: 0, historicoChars: 900 } });
    expect(html).toContain('<span class="rx-num p312-chip">recomeçou · troca de IA</span>');
    expect(html).not.toContain(">Aviso de recomeço<");
    expect(html).not.toContain("vão na entrada do turno");
    expect(html).toContain("sem o aviso de recomeço");
  });
  it("retomada: \"lembrando\"; sessão nova sem recomeço: segue \"sessão nova\", sem chip", () => {
    expect(abrir({ sessaoRetomada: true })).toContain('<span class="rx-num p312-chip">lembrando</span>');
    const nova = abrir({ sessaoRetomada: false });
    expect(nova).toContain('<span class="rx-num">sessão nova</span>');
    expect(nova).not.toContain("Aviso de recomeço");
  });
});

describe("NOD-60: a memória do turno no Raio-X", () => {
  const com = (memoria: NonNullable<RaioXTurno["composicao"]>["memoria"]): RaioXTurno => ({ ...CLARICE, composicao: { ...CLARICE.composicao!, ...(memoria ? { memoria } : {}) } });
  it("mostra total, núcleo e busca do turno", () => {
    expect(renderRaioX(com({ total: 60, nucleo: 22, recall: 9 }), "Clarice")).toContain("Memória: <b>31</b> de 60 no prompt · núcleo <b>22</b> · busca do turno <b>9</b>");
  });
  it("turno antigo ou ligação (sem o campo): sem a linha", () => {
    expect(renderRaioX(com(undefined), "Clarice")).not.toContain("busca do turno");
  });
});

describe("NOD-352: o Raio-X mostra o id técnico e o nome amigável no title", () => {
  it("com o mapa do servidor, o code ganha o title; sem ele (servidor antigo), fica só o id", () => {
    const comNomes = renderRaioX({ ...CLARICE, nomesDasFerramentas: { Read: "Leu um arquivo", "mcp__nod__lembrar": "Anotou na memória" } }, "Clarice");
    expect(comNomes).toContain('<code title="Leu um arquivo">Read</code>');
    expect(comNomes).toContain('<code title="Anotou na memória">lembrar</code>');
    const semNomes = renderRaioX(CLARICE, "Clarice");
    expect(semNomes).toContain("<code>Read</code>");
    expect(semNomes).not.toContain("<code title=");
  });
  it("o nome amigável é escapado e chave herdada do objeto não vira title", () => {
    const r = { ...CLARICE, execucao: { ...CLARICE.execucao!, chamadas: [{ ...CLARICE.execucao!.chamadas[0]!, ferramentas: [{ nome: "constructor", resultadoChars: null, erro: false }, { nome: "Bash", resultadoChars: null, erro: false }] }] } };
    const html = renderRaioX({ ...r, nomesDasFerramentas: { Bash: '"><script>' } }, "Clarice");
    expect(html).toContain("<code>constructor</code>");
    expect(html).not.toContain("<script>");
    expect(html).toContain('<code title="&quot;&gt;&lt;script&gt;">Bash</code>');
  });
});
