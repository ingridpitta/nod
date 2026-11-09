import { describe, expect, it } from "vitest";
import { HARNESSES, type CatalogoHarness, type ModeloHarness } from "../../../src/contracts/harness.ts";
import type { Inventario } from "../../../src/contracts/inventario.ts";
import { capacidadesDe, causaHarnessIndisponivel, estadoDaMaquina, harnessFixado, iaAtualDoCatalogo, inventarioHarnessSemSonda, modeloMaisPotente, motivoHarnessIndisponivel, motivoSemIaPronta, resolverHarness, validarInteligencia, versaoMinimaDoModelo } from "../../../src/domain/harness.ts";
import { iaDoModelo } from "../../../src/domain/ia-do-modelo.ts";
import { inteligenciaDoAgente } from "../../../src/domain/inteligencia.ts";

describe("escolha de inteligência", () => {
  it("escolhe uma conta conectada sem configurar harness ou modelo", () => {
    // revisto em 2026-10-10 (emenda da ADR-036): o Recomendado é Opus no Claude e GPT-5.6 Sol no Codex, raciocínio médio.
    expect(resolverHarness({ modelo: "auto", prontos: ["codex-cli"] })).toEqual({ harness: "codex-cli", modelo: "gpt-5.6-sol", raciocinio: "medium" });
    expect(resolverHarness({ modelo: "auto", prontos: ["codex-cli", "claude-cli"] })).toEqual({ harness: "claude-cli", modelo: "opus", raciocinio: "medium" });
  });
  it("respeita a preferência da máquina apenas quando disponível", () => {
    expect(resolverHarness({ modelo: "auto", prontos: ["codex-cli", "claude-cli"], preferido: "codex-cli" }).harness).toBe("codex-cli");
    expect(resolverHarness({ modelo: "auto", prontos: ["claude-cli"], preferido: "codex-cli" }).harness).toBe("claude-cli");
  });
  it("nunca troca silenciosamente um fornecedor escolhido nem simula falta de conexão", () => {
    expect(() => resolverHarness({ harness: "codex-cli", modelo: "auto", prontos: ["claude-cli"] })).toThrow("executor_indisponivel");
    expect(() => resolverHarness({ modelo: "auto", prontos: [] })).toThrow("executor_indisponivel");
    expect(() => resolverHarness({ modelo: "sonnet", prontos: ["codex-cli"] })).toThrow("executor_indisponivel");
  });
  it("recusa combinação de fornecedores, harness não integrado e entrada inválida", () => {
    for (const [h, m] of [["codex-cli", "sonnet"], ["claude-cli", "gpt-6-astra"], ["hermes", "auto"], ["auto", "--model x"], ["auto", null], [null, "auto"]]) expect(() => validarInteligencia(h, m)).toThrow("entrada_invalida");
    expect(() => validarInteligencia("auto", "claude-haiku-4-5-20251001")).not.toThrow();
  });
  it("o mais potente acompanha o Fable mais novo no Claude e é o topo do catálogo no Codex", () => {
    expect(modeloMaisPotente("claude-cli")).toBe("fable");
    expect(modeloMaisPotente("codex-cli")).toBe("gpt-6-astra");
    expect(modeloMaisPotente("hermes")).toBeNull();
  });

  describe("NOD-171: harness fixado e indisponível", () => {
    const causaDe = (f: () => unknown) => { try { f(); } catch (e) { return causaHarnessIndisponivel(e); } return null; };
    it("diz qual harness faltou", () => {
      expect(causaDe(() => resolverHarness({ harness: "codex-cli", modelo: "auto", prontos: ["claude-cli"] }))).toEqual({ harness: "codex-cli" });
      expect(causaDe(() => resolverHarness({ modelo: "sonnet", prontos: ["codex-cli"] }))).toEqual({ harness: "claude-cli" });
      expect(causaDe(() => resolverHarness({ modelo: "auto", prontos: [] }))).toBeNull();
    });
    it("modelo inválido vira indisponibilidade com causa, não entrada_invalida (sem laço na fila)", () => {
      expect(() => resolverHarness({ harness: "codex-cli", modelo: "sonnet", prontos: ["codex-cli"] })).toThrow("executor_indisponivel");
      expect(causaDe(() => resolverHarness({ harness: "codex-cli", modelo: "sonnet", prontos: ["codex-cli"] }))).toEqual({ harness: "codex-cli", modelo: "sonnet", motivo: "modelo_invalido" });
      expect(causaDe(() => resolverHarness({ modelo: "gpt-zz", prontos: ["claude-cli"] }))).toEqual({ harness: "claude-cli", modelo: "gpt-zz", motivo: "modelo_invalido" });
    });
    it("modelo gravado antes continua resolvendo", () => {
      expect(resolverHarness({ modelo: "haiku", prontos: ["claude-cli"] })).toEqual({ harness: "claude-cli", modelo: "haiku", raciocinio: "medium" });
      expect(resolverHarness({ harness: "codex-cli", modelo: "gpt-5.6-luna", prontos: ["codex-cli"] })).toEqual({ harness: "codex-cli", modelo: "gpt-5.6-luna", raciocinio: "medium" });
    });
    it("harnessFixado: auto/auto não fixa; modelo do Claude fixa no Claude", () => {
      expect(harnessFixado("auto", "auto")).toBeNull();
      expect(harnessFixado("auto", "opus")).toBe("claude-cli");
      expect(harnessFixado("codex-cli", "auto")).toBe("codex-cli");
    });
    it("a negação nomeia o harness escolhido e o estado dele, nunca 'motor pronto'", () => {
      const ausente = motivoHarnessIndisponivel("codex-cli", { estado: "ausente", motivo: "Harness não encontrado neste computador", em: 0 });
      expect(ausente).toBe("Codex não instalado: Harness não encontrado neste computador");
      expect(motivoHarnessIndisponivel("codex-cli", { estado: "ausente", causa: "cli_antigo", versao: "0.158.0", minima: "0.159.0", motivo: "O Codex deste Mac (0.158.0) é mais antigo", em: 0 })).toContain("Codex desatualizado");
      expect(motivoHarnessIndisponivel("claude-cli", { estado: "nao_autenticado", motivo: "faça login", em: 0 })).toBe("Claude Code sem conta conectada: faça login");
      expect(motivoHarnessIndisponivel("codex-cli", { estado: "pronto", versao: "1", em: 0 })).toBe("Codex indisponível");
      expect(motivoHarnessIndisponivel("codex-cli", { estado: "pronto", versao: "1", em: 0 }, "sonnet")).toContain("modelo sonnet");
      // NOD-9: o CLI que o nod está atualizando não é "não instalado".
      expect(motivoHarnessIndisponivel("claude-cli", { estado: "ausente", causa: "atualizando", motivo: "Atualizando o Claude Code…", em: 0 })).toBe("Claude Code atualizando: Atualizando o Claude Code…");
      for (const t of [ausente]) expect(t).not.toContain("motor pronto");
    });
    it("sem sonda do harness não afirma 'não instalado'", () => {
      expect(motivoHarnessIndisponivel("codex-cli", inventarioHarnessSemSonda(0))).toBe("Codex não está pronto em nenhum computador conectado");
    });
  });

  // #313: quem só conectou o ChatGPT nunca rodava nada — o anúncio mandava o estado do Claude como o da máquina.
  describe("#313: a máquina está pronta se qualquer IA dela está", () => {
    const semLogin: Inventario = { estado: "nao_autenticado", motivo: "Entre na conta do harness neste computador", em: 1 };
    const claude: Inventario = { estado: "pronto", versao: "2.1.290", em: 2 };
    const codex: Inventario = { estado: "pronto", versao: "0.162.0", em: 3 };
    it.each([
      ["o inventário já pronto fica", claude, { "codex-cli": codex }, claude],
      ["só o Codex pronto: a máquina fica pronta pelo Codex", semLogin, { "claude-cli": semLogin, "codex-cli": codex }, codex],
      ["nenhuma pronta: a explicação de quem chamou", semLogin, { "claude-cli": semLogin, "codex-cli": { ...semLogin, em: 9 } }, semLogin],
      ["as duas prontas: o Claude, na ordem do catálogo", semLogin, { "codex-cli": codex, "claude-cli": claude }, claude],
      ["sem IAs anunciadas (app antigo): o inventário puro", semLogin, {}, semLogin],
    ] as const)("%s", (_, inv, ias, esperado) => {
      expect(estadoDaMaquina(inv, ias)).toBe(esperado);
    });
    it("sem IA para nomear, a negação diz onde faltou, não chama ninguém de Claude Code e guarda o motivo do inventário", () => {
      expect(motivoSemIaPronta("maquinas", semLogin)).toBe("nenhuma IA pronta nas suas máquinas: Entre na conta do harness neste computador");
      expect(motivoSemIaPronta("maquina_do_bot", { estado: "ausente", motivo: "NOD_EXECUTOR desconhecido", em: 0 })).toBe("nenhuma IA pronta na máquina deste bot: NOD_EXECUTOR desconhecido");
    });
  });

  describe("NOD-213: a IA do bot sai do modelo (uma regra só)", () => {
    const causaDe = (f: () => unknown) => { try { f(); } catch (e) { return causaHarnessIndisponivel(e); } return null; };
    it("iaDoModelo: GPT é do Codex, Claude (apelido ou prefixo) do Claude Code, auto e desconhecido não têm IA", () => {
      expect(iaDoModelo("gpt-5.6-sol")).toBe("codex-cli");
      expect(iaDoModelo("gpt-6-astra")).toBe("codex-cli");
      expect(iaDoModelo("opus")).toBe("claude-cli");
      expect(iaDoModelo("claude-haiku-4-5-20251001")).toBe("claude-cli");
      expect(iaDoModelo("auto")).toBeNull();
      expect(iaDoModelo("gpt-zz")).toBeNull();
    });
    it("harnessFixado: auto + GPT fixa no Codex (antes caía no Claude Code)", () => {
      expect(harnessFixado("auto", "gpt-5.6-sol")).toBe("codex-cli");
      expect(validarInteligencia("auto", "gpt-5.6-sol")).toBeUndefined();
    });
    it("auto + GPT com Codex e Claude prontos roda no Codex", () => {
      expect(resolverHarness({ modelo: "gpt-5.6-sol", prontos: ["claude-cli", "codex-cli"] })).toMatchObject({ harness: "codex-cli", modelo: "gpt-5.6-sol" });
    });
    it("auto + GPT com Codex fora e Claude pronto: a negação nomeia o Codex, não o Claude", () => {
      expect(() => resolverHarness({ modelo: "gpt-5.6-sol", prontos: ["claude-cli"] })).toThrow("executor_indisponivel");
      expect(causaDe(() => resolverHarness({ modelo: "gpt-5.6-sol", prontos: ["claude-cli"] }))).toEqual({ harness: "codex-cli" });
    });
    it("codex-cli + GPT com o Codex no limite: indisponível e nomeando o Codex", () => {
      expect(causaDe(() => resolverHarness({ harness: "codex-cli", modelo: "gpt-5.6-sol", prontos: ["claude-cli"], noLimite: ["codex-cli"] }))).toEqual({ harness: "codex-cli" });
    });
    // QA (Teodora, 2026-10-12): o passo 3 da 0068 trocaria um bot `auto`+GPT anterior a ela para `claude-cli`+GPT (o
    // passo 1 grava o modelo em escolhas["claude-cli"] e o 4 põe "Uma IA só"). Nenhum caminho validado gravava `auto`+GPT
    // (validarInteligencia recusa desde a 0013) e a 0068 já rodou em produção; se a linha existir, ela não roda no Claude
    // com um modelo GPT nem some em silêncio: o despacho recusa como modelo inválido nomeando o Claude Code.
    it("linha que a 0068 geraria de um `auto`+GPT (claude-cli + GPT): fica no Claude e é recusada como modelo inválido", () => {
      const linha = { harness: "claude-cli" as const, modelo: "gpt-5.6-sol", esforco: null, inteligencia: { modo: "fixa" as const, fixa: "claude-cli" as const, ordem: null, escolhas: { "claude-cli": { modelo: "gpt-5.6-sol" } } } };
      expect(inteligenciaDoAgente(linha)).toEqual(linha.inteligencia);
      expect(causaDe(() => resolverHarness({ harness: "claude-cli", modelo: "gpt-5.6-sol", prontos: ["claude-cli", "codex-cli"] }))).toEqual({ harness: "claude-cli", modelo: "gpt-5.6-sol", motivo: "modelo_invalido" });
    });
    it("auto + modelo do Claude continua no Claude; auto + auto continua no Automático", () => {
      expect(resolverHarness({ modelo: "sonnet", prontos: ["claude-cli", "codex-cli"] })).toMatchObject({ harness: "claude-cli", modelo: "sonnet" });
      expect(resolverHarness({ modelo: "auto", prontos: ["codex-cli", "claude-cli"] })).toEqual({ harness: "claude-cli", modelo: "opus", raciocinio: "medium" });
    });
  });
});

describe("NOD-171 (revisão): a IA 'atual' do modo compartilhado", () => {
  const catalogo = (padrao: CatalogoHarness["padrao"], inv: Record<string, Inventario>): CatalogoHarness => ({
    padrao, simulacao: false, legado: "claude-cli",
    opcoes: HARNESSES.map((h) => ({ ...h, capacidades: capacidadesDe(h.id), integrado: h.id === "claude-cli" || h.id === "codex-cli" ? true : h.integrado, inventario: inv[h.id] ?? { estado: "ausente", motivo: "não encontrado", em: 0 } })),
  });
  const antigo: Inventario = { estado: "ausente", motivo: "abaixo do piso", causa: "cli_antigo", versao: "0.147.0", minima: "0.159.0", em: 0 };

  it("com uma IA pronta, é o padrão do catálogo", () => {
    expect(iaAtualDoCatalogo(catalogo("codex-cli", { "codex-cli": { estado: "pronto", em: 0 } as Inventario }))).toBe("codex-cli");
  });
  it("sem nenhuma pronta, o Codex desatualizado vence o Claude ausente", () => {
    expect(iaAtualDoCatalogo(catalogo(null, { "codex-cli": antigo }))).toBe("codex-cli");
  });
  it("sem nada no Mac, segue o Claude", () => {
    expect(iaAtualDoCatalogo(catalogo(null, {}))).toBe("claude-cli");
  });
});

describe("o anexo decide a IA do Automático (NOD-285)", () => {
  const ordem = ["codex-cli", "claude-cli"] as const;
  it("só considera a IA pronta que lê todos os tipos; o limite continua valendo entre elas", () => {
    expect(resolverHarness({ modelo: "auto", prontos: ["codex-cli", "claude-cli"], ordem, tiposDeAnexo: ["pdf"] }).harness).toBe("claude-cli");
    expect(resolverHarness({ modelo: "auto", prontos: ["codex-cli"], ordem, tiposDeAnexo: ["imagem", "texto"] }).harness).toBe("codex-cli");
    expect(resolverHarness({ modelo: "auto", prontos: ["codex-cli", "claude-cli"], ordem, tiposDeAnexo: [] }).harness).toBe("codex-cli");
    // A única que lê está no limite: vale a regra de "todas no limite" (a primeira pronta entre as que leem).
    expect(resolverHarness({ modelo: "auto", prontos: ["codex-cli", "claude-cli"], ordem, noLimite: ["claude-cli"], tiposDeAnexo: ["pdf"] }).harness).toBe("claude-cli");
  });
  it("nenhuma pronta lê: executor_indisponivel com anexo_nao_lido, o tipo e a IA que o Automático pegaria", () => {
    let erro: unknown;
    try { resolverHarness({ modelo: "auto", prontos: ["codex-cli"], ordem, tiposDeAnexo: ["imagem", "pdf"] }); } catch (e) { erro = e; }
    expect(causaHarnessIndisponivel(erro)).toEqual({ harness: "codex-cli", motivo: "anexo_nao_lido", tipo: "pdf" });
    expect(motivoHarnessIndisponivel("codex-cli", { estado: "pronto", versao: "x", em: 0 }, undefined, "pdf")).toBe("nenhuma IA pronta agora lê PDF; deixe o Claude Code pronto ou cole o conteúdo como texto");
  });
  it("a IA fixa segue a regra de antes (quem confere é a entrada)", () => {
    expect(resolverHarness({ harness: "codex-cli", modelo: "auto", prontos: ["codex-cli"], tiposDeAnexo: ["pdf"] }).harness).toBe("codex-cli");
  });
});

describe("NOD-9: a versão do CLI que o modelo pede", () => {
  it("o apelido fora do catálogo vem do mapa; modelo do catálogo sem mínima, modelo ou IA desconhecidos: null", () => {
    expect(versaoMinimaDoModelo("claude-cli", "fable")).toBe("2.1.289");
    expect(versaoMinimaDoModelo("claude-cli", "sonnet")).toBeNull();
    expect(versaoMinimaDoModelo("claude-cli", "inventado")).toBeNull();
    expect(versaoMinimaDoModelo("codex-cli", "fable")).toBeNull();
    expect(versaoMinimaDoModelo("cursor-cli", "fable")).toBeNull();
  });
  it("a mínima do catálogo vale antes do mapa, e toda mínima declarada tem a forma x.y.z", () => {
    for (const h of HARNESSES) for (const m of h.modelos as readonly ModeloHarness[]) {
      if (m.versaoMinima) expect(versaoMinimaDoModelo(h.id, m.id)).toBe(m.versaoMinima);
      if (m.versaoMinima) expect(m.versaoMinima).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });
});
