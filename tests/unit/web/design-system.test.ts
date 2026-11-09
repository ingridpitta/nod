import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { estadoInicial, type Estado } from "../../../web/estado/reducer.ts";
import { avisoDeEstado } from "../../../web/lib/aviso-estado.ts";
import { aplicarTema, atributoDoTema, CHAVE_TEMA, lerTema } from "../../../web/lib/tema.ts";
import { renderMensagem } from "../../../web/telas/conversa.ts";
import { renderGeral } from "../../../web/telas/config-geral.ts";
import { CONFIG_UI_INICIAL } from "../../../web/estado/reducer.ts";

/** Design system do Nod (definido em 2026-10-04): o aviso de estado, o erro de executor e a escolha de tema. */
const autoria = { autor_tipo: "agente" as const, autor_id: "frida", sob_procuracao_de: null, conta_de_execucao: "marlon", executor: "local" as const, locality: "local" as const, locality_reason: "motor_ausente" as const, machine_id: null, decidido_por: "regra:localidade" as const, regra_versao: 1 };
const TEXTO = "Nenhum trabalho começa: executor indisponível (claude-cli ausente: Abra o app nod e conecte sua conta de IA no seu computador) desde 2026-10-03T02:21:38.450Z.";
const negacao: Mensagem = { tenantId: "t", id: "m1", conversaId: "c1", turnoId: "t1", autoria, kind: "negacao", texto: TEXTO, payload: { kind: "negacao", classe: "plano_ausente", nome: "claude-cli", motivo: "plano_ausente", terminal: true }, confianca: "confiavel", parcial: false, criadoEm: 0 };
const com = (inventario: Estado["inventario"]): Estado => ({ ...estadoInicial, sessao: { tenantId: "t", pessoaId: "marlon" }, inventario });

describe("aviso de estado", () => {
  it("leva ícone, escapa o texto e põe o botão depois dele", () => {
    const html = avisoDeEstado({ tom: "erro", titulo: "Parou.", texto: "<b>x</b>", acao: "<button>Resolver</button>" });
    expect(html).toContain('class="aviso-estado tom-erro"');
    expect(html).toContain("<svg");
    expect(html).toContain("<b>Parou.</b> &lt;b&gt;x&lt;/b&gt;");
    expect(html.indexOf("Resolver")).toBeGreaterThan(html.indexOf("&lt;b&gt;"));
    expect(html).not.toContain("role=");
  });

  it("papel e classe entram no aviso, com a classe escapada", () => {
    const html = avisoDeEstado({ tom: "alerta", texto: "x", papel: "status", classe: 'aviso-compacto" onclick="y' });
    expect(html).toContain('role="status"');
    expect(html).toContain("tom-alerta aviso-compacto");
    expect(html).not.toContain('" onclick="');
  });
});

describe("executor indisponível vira aviso de erro com o próximo passo", () => {
  it("com a IA ainda fora: erro, 'Conectar IA' para a seção Conexão, e o texto técnico só em Detalhes", () => {
    const html = renderMensagem(negacao, com({ estado: "ausente", motivo: "claude-cli ausente", em: 0 }));
    expect(html).toContain("tom-erro");
    expect(html).toContain("Nenhum trabalho começou.");
    expect(html).toContain('data-act="secao-espaco"');
    expect(html).toContain('data-secao="conexao"');
    expect(html).toContain("Conectar IA");
    expect(html).toContain("<summary>Detalhes técnicos</summary>");
    expect(html).not.toContain("tag-ambar");
  });

  it("sem sonda ainda (inventário desconhecido): não afirma que a IA voltou e oferece Conectar IA", () => {
    const html = renderMensagem(negacao, com(null));
    expect(html).not.toContain("já voltou");
    expect(html).toContain("Conectar IA");
  });

  // NOD-213: "de volta" = sonda pronta POSTERIOR à negação (em 1 > criadoEm 0).
  it("com a IA de volta: sem botão, e diz para mandar a mensagem de novo", () => {
    const html = renderMensagem(negacao, com({ estado: "pronto", versao: "2.1.0", em: 1 }));
    expect(html).toContain("mande a mensagem de novo");
    expect(html).not.toContain("Conectar IA");
  });
});

describe("tema", () => {
  const armazem = () => {
    const dados = new Map<string, string>();
    return { dados, getItem: (k: string) => dados.get(k) ?? null, setItem: (k: string, v: string) => void dados.set(k, v), removeItem: (k: string) => void dados.delete(k) };
  };

  it("sistema é o padrão e não grava nada; claro e escuro gravam e marcam data-theme", () => {
    const a = armazem();
    const raiz: { dataset: Record<string, string | undefined> } = { dataset: {} };
    expect(lerTema(a)).toBe("sistema");
    aplicarTema("escuro", raiz, a);
    expect(raiz.dataset.theme).toBe("dark");
    expect(lerTema(a)).toBe("escuro");
    aplicarTema("claro", raiz, a);
    expect(raiz.dataset.theme).toBe("light");
    aplicarTema("sistema", raiz, a);
    expect(raiz.dataset.theme).toBeUndefined();
    expect(a.dados.has(CHAVE_TEMA)).toBe(false);
  });

  it("valor estranho no armazenamento vale como sistema", () => {
    const a = armazem();
    a.setItem(CHAVE_TEMA, "roxo");
    expect(lerTema(a)).toBe("sistema");
    expect(atributoDoTema("sistema")).toBeNull();
  });

  it("armazenamento bloqueado: lê sistema e ainda aplica o atributo", () => {
    const quebrado = { getItem: (): string | null => { throw new Error("bloqueado"); }, setItem: (): void => { throw new Error("bloqueado"); }, removeItem: (): void => { throw new Error("bloqueado"); } };
    expect(lerTema(quebrado)).toBe("sistema");
    const raiz: { dataset: Record<string, string | undefined> } = { dataset: {} };
    expect(() => aplicarTema("escuro", raiz, quebrado)).not.toThrow();
    expect(raiz.dataset.theme).toBe("dark");
    aplicarTema("claro", raiz, null);
    expect(raiz.dataset.theme).toBe("light");
  });

  it("o script do index.html (antes do primeiro quadro) usa a mesma chave e o mesmo mapeamento de tema.ts", () => {
    const html = readFileSync(new URL("../../../web/index.html", import.meta.url), "utf8");
    expect(html).toContain(`localStorage.getItem("${CHAVE_TEMA}")`);
    expect(html).toContain(`t === "claro" ? "${atributoDoTema("claro")}" : "${atributoDoTema("escuro")}"`);
  });

  // NOD-367: o tema é um seletor nativo em Configurações › Geral › Aparência.
  it("a escolha em Geral marca a opção atual", () => {
    const html = renderGeral({ tema: "escuro", avisos: { onde: "mac", situacao: "ligados" }, modoDev: false, experimentos: { calibracao: false, memoriaLonga: false, whatsapp: false, quadro: false } }, CONFIG_UI_INICIAL);
    expect(html).toContain('data-act-change="escolher-tema"');
    expect(html).toContain('<option value="escuro" selected>');
    expect(html).toContain('<option value="sistema">');
  });
});
