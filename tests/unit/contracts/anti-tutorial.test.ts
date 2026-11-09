import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { FERRAMENTAS_NOD } from "../../../src/contracts/ferramentas-nod.ts";
import { FERRAMENTAS_WORKSPACE } from "../../../src/contracts/ferramentas-workspace.ts";
import { montarPromptSistema } from "../../../src/domain/prompt-sistema.ts";
import type { FerramentaPlano } from "../../../src/contracts/plano-turno.ts";
import type { Agente } from "../../../src/contracts/agente.ts";

/**
 * definido em 2026-09-18, a partir de um teste real: pedindo código numa pasta, o agente respondia
 * "use a opção Pasta de trabalho", "procure no Finder por nod" e chutava "~/Projetos/nod" para um
 * repositório que mora em ~/code/nod. Isso não era alucinação: estava escrito nas instruções.
 * Este teste guarda o texto que chega ao modelo, porque uma edição de copy reintroduz o problema
 * sem quebrar nenhum outro teste.
 */
const PROIBIDOS = [
  { padrao: /use a op[çc][ãa]o\s+\*{0,2}pasta de trabalho/i, porque: "mandar a pessoa abrir o menu em vez de descobrir a pasta" },
  { padrao: /clique em\s+\*{0,2}pasta de trabalho/i, porque: "instruir clique de menu" },
  { padrao: /oriente a pessoa a usar/i, porque: "delegar configuração à pessoa" },
  { padrao: /procur\w*\s+no finder/i, porque: "mandar procurar no Finder" },
  { padrao: /~\/Projetos\//, porque: "chutar um caminho plausível que não foi verificado" },
  { padrao: /depois\s+(me\s+)?(envie|mande)\s+(qualquer\s+)?(uma\s+)?mensagem/i, porque: "exigir uma nova mensagem em vez de retomar sozinho" },
];

/**
 * As proibições valem para o texto que INSTRUI o comportamento, não para o que o proíbe:
 * "não peça para procurar no Finder" é justamente a correção, e precisa continuar passando.
 */
const NEGACAO = /(n[ãa]o|nunca|jamais)\s+\S*\s*(peça|pedir|mande|mandar|instrua|instruir|sugira|sugerir|descreva|descrever|afirme|afirmar|invente|inventar|procure|procurar|use|usar)/i;
function verificar(texto: string, origem: string) {
  for (const { padrao, porque } of PROIBIDOS) {
    const achado = texto.match(padrao);
    if (!achado) continue;
    const antes = texto.slice(Math.max(0, achado.index! - 160), achado.index!);
    // Basta uma negação na mesma frase (do último ponto final até o trecho) para ser proibição.
    const frase = antes.slice(antes.lastIndexOf(". ") + 1);
    if (!NEGACAO.test(frase)) expect.fail(`${origem} volta a ${porque}: "${achado[0]}"`);
  }
}

it("as descrições das ferramentas de workspace não mandam a pessoa configurar", () => {
  for (const [nome, schema] of Object.entries(FERRAMENTAS_WORKSPACE)) {
    verificar((schema as { description: string }).description, `descrição de ${nome}`);
  }
});

// definido em 2026-09-24 (emenda da ADR-045): a pergunta virou a fala do agente na conversa; a descrição
// que a pede é copy que chega ao modelo e passa pela mesma guarda.
it("a descrição de pedir_a_pessoa pede fala natural, não tutorial", () => {
  verificar(FERRAMENTAS_NOD.pedir_a_pessoa.description, "descrição de pedir_a_pessoa");
  for (const [campo, schema] of Object.entries(FERRAMENTAS_NOD.pedir_a_pessoa.properties)) {
    verificar((schema as { description?: string }).description ?? "", `descrição de pedir_a_pessoa.${campo}`);
  }
});

it("as instruções devolvidas pelo gateway mandam agir, não delegar", async () => {
  const fonte = await readFile(fileURLToPath(new URL("../../../src/adapters/fundo/workspaces.ts", import.meta.url)), "utf8");
  for (const linha of fonte.split("\n").filter((l) => l.includes("instrucao:"))) verificar(linha, "instrução do gateway");
  // O caminho sem pasta precisa apontar a ferramenta que resolve, senão o modelo improvisa.
  expect(fonte).toMatch(/estado: "precisa_pasta"[\s\S]{0,400}workspace_propor_pasta/);
});

it("o prompt de sistema orienta descobrir a pasta em vez de pedir menu", () => {
  const ferramentas: FerramentaPlano[] = Object.keys(FERRAMENTAS_WORKSPACE).map((nome) => ({ nome, nomeMcp: `mcp__nod__${nome}`, origem: "workspace", conectorId: null, readOnlyHint: false, tocaDadoPessoal: true, schema: { type: "object" } }));
  const agente = { nome: "Dev Sr", titulo: "", descricao: "" } as Agente;
  const prompt = montarPromptSistema({ agente, pessoaNome: "Marlon", ferramentas, modo: "conversa", memorias: [] });
  verificar(prompt, "prompt de sistema");
  expect(prompt).toContain("workspace_propor_pasta");
});

it("sem ferramentas de workspace o prompt não abre o bloco de pastas do computador", () => {
  const agente = { nome: "Dev Sr", titulo: "", descricao: "" } as Agente;
  const prompt = montarPromptSistema({ agente, pessoaNome: "Marlon", ferramentas: [], modo: "conversa", memorias: [] });
  expect(prompt).not.toContain("Pastas do computador da pessoa");
});
