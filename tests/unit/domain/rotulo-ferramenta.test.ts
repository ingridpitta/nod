import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ferramentaEmUso, frameDaFerramenta, nomeDaFerramenta, rotuloAgora, rotuloFerramenta } from "../../../src/domain/rotulo-ferramenta.ts";
import { NATIVAS_DO_TERMINAL, NATIVAS_DO_TERMINAL_CODEX } from "../../../src/domain/nativas.ts";
import { NOMES_FERRAMENTAS_NOD } from "../../../src/contracts/ferramentas-nod.ts";
import { FERRAMENTA_ANEXAR_MIDIA, FERRAMENTA_LER_MAIS } from "../../../src/contracts/ferramentas-proxy.ts";
import { FERRAMENTAS_COMPUTADOR } from "../../../src/contracts/ferramentas-computador.ts";
import { FERRAMENTAS_WORKSPACE } from "../../../src/contracts/ferramentas-workspace.ts";
import { comRotulos } from "../../../src/domain/subagentes.ts";

describe("ferramentaEmUso: servidor com nome de IA (revisão 3 do #508)", () => {
  it("não mostra o nome da IA: o navegador pelo que é, o resto sem nome; o conector claude_ai segue pelo app", () => {
    expect(ferramentaEmUso("mcp__claude-in-chrome__navigate").texto).toBe("Usando o navegador");
    expect(ferramentaEmUso("mcp__codex__exec").texto).toBe("Usando uma ferramenta");
    expect(ferramentaEmUso("mcp__openai_tools__run").texto).toBe("Usando uma ferramenta");
    expect(ferramentaEmUso("mcp__claude_ai_Linear__list_issues").texto).not.toMatch(/claude/i);
  });

  it("revisão 4: o rótulo do 'ver etapas' e o nome do vigia também não mostram o nome da IA", () => {
    expect(rotuloFerramenta("mcp__claude-in-chrome__navigate")).toBe("Usou o navegador");
    expect(rotuloFerramenta("mcp__codex__exec")).toBe("Usou uma ferramenta");
    expect(nomeDaFerramenta("mcp__claude-in-chrome__navigate")).toBe("Navegador");
    expect(nomeDaFerramenta("mcp__codex__exec")).toBe("uma ferramenta");
    expect(rotuloFerramenta("mcp__claude_ai_Linear__list_issues")).toBe("Usou Linear");
    expect(nomeDaFerramenta("mcp__claude_ai_Linear__list_issues")).toBe("Linear");
    // Revisão 5: os colados também (o servidor de documentação da OpenAI usado com o Codex).
    for (const n of ["mcp__openaiDeveloperDocs__search", "mcp__claudeCode__x", "mcp__myGPT__run"]) {
      expect(rotuloFerramenta(n)).toBe("Usou uma ferramenta");
      expect(nomeDaFerramenta(n)).toBe("uma ferramenta");
      expect(ferramentaEmUso(n).texto).toBe("Usando uma ferramenta");
    }
    expect(rotuloFerramenta("mcp__github__get_pr")).toBe("Usou Github");
    // QA 3: as outras IAs e os outros nomes de navegador.
    expect(ferramentaEmUso("mcp__gemini__ask").texto).toBe("Usando uma ferramenta");
    expect(ferramentaEmUso("mcp__anthropic-browser__open").texto).toBe("Usando o navegador");
    expect(ferramentaEmUso("mcp__codex-navegador__open").texto).toBe("Usando o navegador");
    expect(ferramentaEmUso("mcp__claude_ai__x").texto).toBe("Usando uma ferramenta");
    // Revisão 7: o app de um conector do nod com nome de IA.
    expect(rotuloFerramenta("mcp__nod__openai__OPENAI_LIST_MODELS")).toBe("Consultou uma ferramenta");
    expect(nomeDaFerramenta("mcp__nod__openai__OPENAI_LIST_MODELS")).toBe("uma ferramenta");
    expect(ferramentaEmUso("mcp__nod__anthropic__ANTHROPIC_CREATE_X").texto).toBe("Usando uma ferramenta");
  });
});

describe("rotuloFerramenta", () => {
  it("ferramenta nod tem rótulo próprio", () => {
    expect(rotuloFerramenta("mcp__nod__pedir_aprovacao")).toBe("Pediu aprovação");
    expect(rotuloFerramenta("mcp__nod__lembrar")).toBe("Anotou na memória");
  });
  it("conector: capacidade de leitura consulta, o resto altera", () => {
    expect(rotuloFerramenta("mcp__nod__gmail__search_threads")).toBe("Consultou Gmail");
    expect(rotuloFerramenta("mcp__nod__gmail__label_thread")).toBe("Alterou Gmail");
    expect(rotuloFerramenta("mcp__nod__google-calendar__list_events")).toBe("Consultou Google calendar");
    expect(rotuloFerramenta("mcp__nod__gmail__GMAIL_FETCH_EMAILS")).toBe("Consultou Gmail");
    expect(rotuloFerramenta("mcp__nod__gmail__GMAIL_ADD_LABEL_TO_EMAIL")).toBe("Alterou Gmail");
  });
  it("computador e pasta de trabalho viram um rótulo só", () => {
    expect(rotuloFerramenta("mcp__nod__computador_observar")).toBe("Usou o computador");
    expect(rotuloFerramenta("mcp__nod__workspace_ler_texto")).toBe("Usou a pasta de trabalho");
  });
  it("fora do proxy nod: nome nativo ou servidor MCP do Codex", () => {
    expect(rotuloFerramenta("Bash")).toBe("Rodou um comando");
    expect(rotuloFerramenta("TaskUpdate")).toBe("Organizou as tarefas");
    expect(rotuloFerramenta("Skill")).toBe("Usou uma skill");
    // NOD-352: nativa desconhecida não mostra o id cru.
    expect(rotuloFerramenta("Ferramenta_nova")).toBe("Usou uma ferramenta");
    expect(rotuloFerramenta("mcp__outro__fazer")).toBe("Usou Outro");
    expect(rotuloFerramenta("")).toBe("Usou uma ferramenta");
  });
});

describe("nomeDaFerramenta (NOD-73: o nome curto do aviso do vigia)", () => {
  it("nativas, conectores, computador e desconhecidas", () => {
    expect(nomeDaFerramenta("Bash")).toBe("Terminal");
    expect(nomeDaFerramenta("mcp__nod__gmail__search_threads")).toBe("Gmail");
    expect(nomeDaFerramenta("mcp__nod__computador_observar")).toBe("Computador");
    expect(nomeDaFerramenta("mcp__nod__workspace_ler_texto")).toBe("Pasta de trabalho");
    expect(nomeDaFerramenta("Ferramenta_nova")).toBe("uma ferramenta");
    expect(nomeDaFerramenta("")).toBe("uma ferramenta");
  });
});

// NOD-348/NOD-352: a fala viva diz o que o bot faz agora, com verbo no presente.
describe("ferramentaEmUso", () => {
  it("nativas no presente; desconhecida e vazia viram 'uma ferramenta' (nunca o id cru)", () => {
    expect(ferramentaEmUso("Bash")).toEqual({ texto: "Rodando um comando", frentes: false });
    expect(ferramentaEmUso("WebSearch").texto).toBe("Pesquisando na web");
    expect(ferramentaEmUso("FerramentaNova").texto).toBe("Usando uma ferramenta");
    expect(ferramentaEmUso("").texto).toBe("Usando uma ferramenta");
  });
  it("conector segue 'Usando ‹app›'; computador e pasta de trabalho com artigo", () => {
    expect(ferramentaEmUso("mcp__nod__linear__LINEAR_LIST_ISSUES").texto).toBe("Usando Linear");
    expect(ferramentaEmUso("mcp__nod__gmail__search_threads").texto).toBe("Usando Gmail");
    expect(ferramentaEmUso("mcp__nod__computador_clicar").texto).toBe("Usando o computador");
    expect(ferramentaEmUso("mcp__nod__workspace_ler_texto").texto).toBe("Usando a pasta de trabalho");
    expect(ferramentaEmUso("mcp__outro__fazer").texto).toBe("Usando Outro");
  });
  it("frentes têm estado próprio; o resto do nod diz o que faz (NOD-352)", () => {
    expect(ferramentaEmUso("mcp__nod__abrir_frentes")).toEqual({ texto: "Abrindo frentes", frentes: true });
    expect(ferramentaEmUso("mcp__nod__mandar_para_frente").frentes).toBe(true);
    expect(ferramentaEmUso("mcp__nod__mandar_para_frente")).toEqual({ texto: "Abrindo frentes", frentes: true });
    expect(rotuloFerramenta("mcp__nod__mandar_para_frente")).toBe("Repassou a uma frente");
    expect(ferramentaEmUso("mcp__nod__criar_bots")).toEqual({ texto: "Criando bots", frentes: false });
    expect(ferramentaEmUso("mcp__nod__lembrar").texto).toBe("Anotando na memória");
    // Uma ferramenta do nod que ainda não tem rótulo: genérica, nunca o id.
    expect(ferramentaEmUso("mcp__nod__ferramenta_futura").texto).toBe("Usando uma ferramenta");
    expect(rotuloFerramenta("mcp__nod__ferramenta_futura")).toBe("Usou uma ferramenta");
    expect(ferramentaEmUso("mcp__outro__abrir_frentes").frentes).toBe(false);
  });
  it("o conector do CLI não mostra o nome da IA", () => {
    expect(ferramentaEmUso("mcp__claude_ai_Linear__list_issues").texto).toBe("Usando Linear");
    // QA 2 do #508: o "ver etapas" e o aviso do vigia também sem o nome da IA.
    expect(rotuloFerramenta("mcp__claude_ai_Linear__list_issues")).toBe("Usou Linear");
    expect(nomeDaFerramenta("mcp__claude_ai_Linear__list_issues")).toBe("Linear");
    expect(ferramentaEmUso("mcp__claude_ai_Linear__list_issues").texto).not.toMatch(/claude/i);
  });
});

describe("frameDaFerramenta (QA do #508)", () => {
  it("leva nome, rótulo e emUso", () => {
    expect(frameDaFerramenta("mcp__nod__linear__LINEAR_LIST_ISSUES")).toEqual({ nome: "mcp__nod__linear__LINEAR_LIST_ISSUES", rotulo: rotuloFerramenta("mcp__nod__linear__LINEAR_LIST_ISSUES"), emUso: { texto: "Usando Linear", frentes: false }, resumo: null, classe: "app", ferramenta: "linear__LINEAR_LIST_ISSUES" });
  });
  it("compor.ts: todo turno.atividade de ferramenta sai por frameDaFerramenta (a ponte e o laço local)", () => {
    const compor = readFileSync(new URL("../../../src/adapters/http/compor.ts", import.meta.url), "utf8");
    const publicacoes = [...compor.matchAll(/publicarDoPlano\(plano, "turno\.atividade", ([^)]*\)?)/g)].map((x) => x[1]);
    // Revisão 3 do #523: o laço local publica pelo `frameVivoDoEvento`, que monta o frame com o mesmo frameDaFerramenta.
    expect(publicacoes.length).toBeGreaterThanOrEqual(1);
    for (const p of publicacoes) expect(p).toMatch(/^frameDaFerramenta\(/);
    expect(compor).toMatch(/const f = frameVivoDoEvento\(ev\); if \(f\) publicarDoPlano\(plano, f\.tipo, f\.dados\)/);
  });
});

describe("NOD-352: varredura de passado e presente", () => {
  const nativas = [...new Set<string>([...NATIVAS_DO_TERMINAL, ...NATIVAS_DO_TERMINAL_CODEX, "Task", "BashOutput"])];
  const doNod = [...NOMES_FERRAMENTAS_NOD, FERRAMENTA_LER_MAIS.nome, FERRAMENTA_ANEXAR_MIDIA.nome];
  const IA = /claude|codex|openai|anthropic|gemini|gpt/i;

  function semIdCru(rotulo: string, id: string) {
    // Nenhuma palavra do rótulo é o id ("Usou Monitor"), e nada de `_` de id técnico ("Usou apply_patch").
    expect(rotulo.toLowerCase().split(/\s+/)).not.toContain(id.toLowerCase());
    expect(rotulo).not.toContain("_");
    expect(rotulo).not.toMatch(IA);
  }

  it.each(nativas)("nativa %s tem passado e presente próprios, sem o id", (n) => {
    expect(rotuloFerramenta(n)).not.toBe("Usou uma ferramenta");
    expect(rotuloAgora(n)).not.toBe("Usando uma ferramenta");
    // "Skill" é palavra da tela ("Usou uma skill"); o resto não pode levar o id.
    if (n !== "Skill") { semIdCru(rotuloFerramenta(n), n); semIdCru(rotuloAgora(n), n); semIdCru(nomeDaFerramenta(n), n); }
    expect(nomeDaFerramenta(n)).not.toBe("uma ferramenta");
  });

  it.each(doNod)("ferramenta do nod %s diz o que faz no passado e no presente", (n) => {
    const nome = `mcp__nod__${n}`;
    expect(rotuloFerramenta(nome)).not.toBe("Usou uma ferramenta");
    expect(rotuloAgora(nome)).not.toMatch(/^Usando (uma ferramenta|o nod)$/);
    semIdCru(rotuloFerramenta(nome), n);
    semIdCru(rotuloAgora(nome), n);
    expect(rotuloAgora(nome)).toMatch(/ndo /); // gerúndio: verbo no presente
    // O nome curto do vigia também não é o id formatado ("Lembrar").
    expect(nomeDaFerramenta(nome)).toBe("o nod");
  });

  it("os critérios com copy fechada (Gil)", () => {
    expect([rotuloFerramenta("Monitor"), rotuloAgora("Monitor")]).toEqual(["Acompanhou um processo", "Acompanhando um processo"]);
    for (const n of ["Task", "Agent", "spawn_agent"]) expect([rotuloFerramenta(n), rotuloAgora(n)]).toEqual(["Chamou um subagente", "Chamando um subagente"]);
    for (const n of Object.keys(FERRAMENTAS_COMPUTADOR)) {
      expect([rotuloFerramenta(`mcp__nod__${n}`), rotuloAgora(`mcp__nod__${n}`), nomeDaFerramenta(`mcp__nod__${n}`)]).toEqual(["Usou o computador", "Usando o computador", "Computador"]);
    }
    for (const n of Object.keys(FERRAMENTAS_WORKSPACE)) expect(rotuloAgora(`mcp__nod__${n}`)).toBe("Usando a pasta de trabalho");
  });

  it("desconhecida e chave herdada do objeto caem no genérico", () => {
    for (const n of ["", "FerramentaNova", "constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(rotuloFerramenta(n)).toBe("Usou uma ferramenta");
      expect(rotuloAgora(n)).toBe("Usando uma ferramenta");
      expect(nomeDaFerramenta(n)).toBe("uma ferramenta");
    }
    expect(rotuloFerramenta("mcp__nod__constructor")).toBe("Usou uma ferramenta");
    expect(rotuloAgora("mcp__nod__toString")).toBe("Usando uma ferramenta");
  });

  it("nomes antigos do CLI (revisão do #578)", () => {
    expect([rotuloFerramenta("TodoWrite"), rotuloAgora("TodoWrite")]).toEqual(["Organizou as tarefas", "Organizando as tarefas"]);
    for (const n of ["KillShell", "KillBash"]) expect([rotuloFerramenta(n), rotuloAgora(n)]).toEqual(["Parou um processo", "Parando um processo"]);
  });

  it("um conector do CLI chamado nod não se passa pelo nod (revisão do #578)", () => {
    expect(rotuloFerramenta("mcp__claude_ai_nod__lembrar")).toBe("Usou uma ferramenta");
    expect(rotuloAgora("mcp__claude_ai_nod__lembrar")).not.toBe("Anotando na memória");
    expect(nomeDaFerramenta("mcp__claude_ai_nod__lembrar")).toBe("uma ferramenta");
  });

  it("só o servidor do nod usa o mapa do nod: um MCP de fora com o mesmo nome segue pelo app", () => {
    expect(rotuloFerramenta("mcp__outro__lembrar")).toBe("Usou Outro");
    expect(rotuloAgora("mcp__outro__lembrar")).toBe("Usando Outro");
  });

  it("o presente no frame também tem o teto do rótulo (revisão 2 do #578)", () => {
    const longo = `mcp__nod__${"a".repeat(200)}__LIST_X`;
    expect(frameDaFerramenta(longo).emUso.texto.length).toBeLessThanOrEqual(120);
    expect(nomeDaFerramenta("Monitor")).toBe("Acompanhamento de processo");
  });

  it("frameDaFerramenta manda o rotuloAgora em emUso.texto", () => {
    for (const n of [...nativas, ...doNod.map((x) => `mcp__nod__${x}`), "mcp__nod__gmail__GMAIL_FETCH_EMAILS", "Desconhecida"]) {
      const f = frameDaFerramenta(n);
      expect(f.emUso.texto).toBe(rotuloAgora(n));
      expect(f.rotulo).toBe(rotuloFerramenta(n));
    }
  });

  it("o último passo do subagente (NOD-350) usa o mesmo rótulo do passado", () => {
    const [s] = comRotulos([{ id: "a", natureza: "agente", descricao: "x", estado: "trabalhando", passo: "Monitor", chamadas: 1, duracaoMs: 0 }]);
    expect(s!.passo).toBe(rotuloFerramenta("Monitor"));
    expect(s!.passo).toBe("Acompanhou um processo");
  });
});
