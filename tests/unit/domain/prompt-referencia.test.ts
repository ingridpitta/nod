/**
 * NOD-163 (1º corte dos evals): prompts de referência. Para cada cenário fixo, o prompt de sistema INTEIRO — a parte
 * estável e a volátil, separadas — fica em tests/unit/domain/__prompts__/<cenario>.txt, versionado. Qualquer mudança
 * em prompt-sistema.ts faz este teste falhar com o diff; quem mudou de propósito roda `npm run prompt:referencia`, e
 * o diff de __prompts__/ é revisado no PR como código.
 *
 * O tamanho (caracteres da parte estável e da volátil) fica em __prompts__/tamanhos.json. A parte estável é a que o
 * cache por prefixo paga a cada turno (NOD-155): crescer mais de 10% sobre a referência falha com mensagem própria,
 * mesmo que o texto seja atualizado sem ninguém olhar o tamanho.
 *
 * Entradas fictícias e fixas (_fixtures-prompt.ts): nada de Date.now, id aleatório, e-mail real ou id de produção.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import type { ModoAprovacao } from "../../../src/contracts/agente.ts";
import { partesDoPromptSistema, type EntradaPromptSistema } from "../../../src/domain/prompt-sistema.ts";
import { MANUAL_DO_NOD } from "../../../src/domain/manual-do-nod.ts";
import { agente, conectorTarefas, daOrigem, doConector, f, mem } from "./_fixtures-prompt.ts";

/** Quanto a parte estável pode crescer sobre a referência antes de o teste falhar (sugestão da issue). */
const LIMITE_CRESCIMENTO_ESTAVEL = 0.1;

const ARQUIVO_TAMANHOS = fileURLToPath(new URL("./__prompts__/tamanhos.json", import.meta.url));
type Tamanho = { estavel: number; volatil: number };
const referencia: Record<string, Tamanho> = existsSync(ARQUIVO_TAMANHOS) ? (JSON.parse(readFileSync(ARQUIVO_TAMANHOS, "utf8")) as Record<string, Tamanho>) : {};
const medidos: Record<string, Tamanho> = {};

/**
 * `vitest -u` (e `npm run prompt:referencia`) regrava os .txt; o tamanhos.json acompanha a mesma chave.
 *
 * O vitest não expõe o modo de update em API pública: lemos o campo privado `_updateSnapshot` do SnapshotState
 * ("all" com -u ou UPDATE_SNAPSHOT; "new" local sem -u; "none" sob CI sem -u). Duas travas:
 * - se um upgrade do vitest renomear o campo, falha alto em vez de deixar o tamanhos.json velho sem ninguém ver;
 * - sob CI (`process.env.CI`), nunca regrava, mesmo que alguém ponha -u no workflow.
 */
function atualizando(): boolean {
  const estado = expect.getState().snapshotState as unknown as { _updateSnapshot?: unknown };
  const modo = estado._updateSnapshot;
  if (modo !== "all" && modo !== "new" && modo !== "none") {
    throw new Error(`o vitest mudou a API interna de snapshot (_updateSnapshot = ${String(modo)}); ajuste atualizando() em prompt-referencia.test.ts`);
  }
  return modo === "all" && !process.env.CI;
}

const colegas = [
  { id: "colega-tuca", nome: "Tuca", titulo: "Atendimento", descricao: "Conhece os clientes fictícios do exemplo." },
  { id: "colega-dev", nome: "Dev Exemplo", titulo: "Dev", descricao: "Implementa as tasks do time de exemplo." },
];

const rotinas = [
  { id: "rotina-b", resumo: "toda segunda às 09:00 (America/Sao_Paulo)", instrucao: "Resumir as tarefas abertas da semana", estado: "pausada" as const },
  { id: "rotina-a", resumo: "dias úteis às 08:00 (America/Sao_Paulo)", instrucao: "Listar os PRs abertos do repositório de exemplo", estado: "ativa" as const },
];

/** O kit de um bot de conversa completo: colegas, rotinas, apps, computador, pasta, artefato e pendência. */
const kitConversa = [
  f("pedir_aprovacao"), f("pedir_a_pessoa"), f("pedir_a_bot"), f("ver_colegas"), f("lembrar"),
  f("publicar_artefato"), f("criar_rotina"), f("pausar_rotina"), f("pedir_acesso"), f("abrir_frentes"), f("mandar_para_frente"), f("criar_bots"), f("buscar_conversas"), f("ler_conversa"),
  daOrigem("computador_observar", "computador"), daOrigem("workspace_propor_pasta", "workspace"),
  doConector(conectorTarefas, "TAREFAS_LISTAR"),
];

/** O que muda de turno para turno (a parte volátil); o 2º turno do cenário 7 troca só isto. */
const turno1 = {
  memorias: [mem("mem-1", "o time usa um quadro de tarefas fictício", 1), mem("mem-2", "prefere respostas curtas", 2)],
  // ADR-083 (#193): a conversa coordenadora vê as tasks abertas do bot.
  trabalhosAbertos: [{ id: "trab-1", titulo: "Dashboard de exemplo", estado: "rodando", ultimoPasso: "Rodou um comando" }],
  contextoConversa: '{"historico":[{"autor":"Pessoa Exemplo","texto":"bom dia","confianca":"confiavel"}]}',
};
const turno2 = {
  memorias: [...turno1.memorias, mem("mem-3", "o repositório de exemplo usa vitest", 3)],
  trabalhosAbertos: [],
  contextoConversa: '{"historico":[{"autor":"Pessoa Exemplo","texto":"e o PR?","confianca":"confiavel"}]}',
};

function conversa(modoAprovacao: ModoAprovacao): EntradaPromptSistema {
  return {
    agente: { ...agente, modoAprovacao },
    ferramentas: kitConversa,
    nativas: ["Read", "Edit", "Write", "Bash", "Skill", "Agent"],
    pastaDoBot: "Vera",
    pessoaNome: "Pessoa Exemplo",
    modo: "conversa",
    colegas,
    conectores: [conectorTarefas],
    rotinas,
    ...turno1,
  };
}

/** Pedido de colega (ADR-058/063): em profundidade 3, o pedir_a_bot sai do catálogo e entra a linha do limite. */
function pedidoDeColega(profundidade: 1 | 3): EntradaPromptSistema {
  const ferramentas = [f("pedir_a_bot"), f("ver_colegas"), f("pedir_acesso"), f("lembrar"), doConector(conectorTarefas, "TAREFAS_LISTAR")];
  return {
    agente: { ...agente, modoAprovacao: "automatico" },
    ferramentas: profundidade === 3 ? ferramentas.filter((x) => x.nome !== "pedir_a_bot") : ferramentas,
    pessoaNome: "Pessoa Exemplo",
    modo: "delegacao",
    delegacao: { pessoaNome: "Pessoa Exemplo", remetenteNome: "Tuca" },
    profundidade,
    colegas,
    conectores: [conectorTarefas],
    memorias: turno1.memorias,
    contextoConversa: turno1.contextoConversa,
  };
}

const CENARIOS: Record<string, EntradaPromptSistema> = {
  // 1. Conversa direta, modo manual, com terminal.
  "conversa-manual": conversa("manual"),
  // 2. Modo automático e modo total (ADR-059).
  "conversa-automatico": conversa("automatico"),
  "conversa-total": conversa("total"),
  // ADR-115 (PR 3a dos modos de aprovação): o Automático com o revisor ligado (`NOD_REVISOR`), no Claude. Desligado, o
  // texto é o de "conversa-automatico", byte a byte.
  "conversa-automatico-revisor": { ...conversa("automatico"), revisor: true },
  // ADR-111: a chave "Calibração" ligada — a mesma conversa manual com a linha a mais na parte estável.
  "conversa-calibracao": { ...conversa("manual"), calibracao: true },
  // ADR-112: a chave "Modo WhatsApp" ligada — a mesma conversa manual com a linha "Tom:" no lugar da "Formatação:" e o
  // fecho do "Progresso:" sem o relatório completo.
  "conversa-whatsapp": { ...conversa("manual"), whatsapp: true },
  // NOD-346 (ADR-126): o bot é da pessoa e ela escreveu o "Sobre mim" — uma linha a mais na parte estável, numa linha só
  // mesmo com quebra no texto.
  "conversa-sobre-mim": { ...conversa("manual"), sobreMim: "Sou designer e mãe de dois.\nPrefiro respostas curtas." },
  // NOD-23: /configurar — a conversa manual em reconfiguração: atualizar_perfil no catálogo e a linha da entrevista no
  // lugar da linha da conversa.
  "conversa-reconfiguracao": { ...conversa("manual"), reconfiguracao: true, ferramentas: [...conversa("manual").ferramentas, f("atualizar_perfil")] },
  // 3. Pedido de colega em profundidade 1 e no limite da corrente (ADR-063).
  "colega-profundidade-1": pedidoDeColega(1),
  "colega-profundidade-3": pedidoDeColega(3),
  // 4. Rotina acordada, com inventário de rotinas.
  "rotina-com-inventario": {
    agente,
    ferramentas: [f("sem_novidade"), f("pedir_a_bot"), f("ver_colegas"), f("listar_rotinas"), f("pausar_rotina"), f("atualizar_rotina"), f("criar_rotina"), f("pedir_acesso"), f("abrir_frentes")],
    trabalho: { titulo: "Triagem de exemplo", origem: "rotina", trabalhoMaeId: null },
    pessoaNome: "Pessoa Exemplo",
    modo: "rotina",
    colegas,
    conectores: [conectorTarefas],
    rotinas,
    memorias: turno1.memorias,
    semTerminal: "rotina",
  },
  // 5. Criação de bot (ADR-050): perfil vazio.
  "criacao-de-bot": {
    agente: { nome: "Novo agente", titulo: "", descricao: "" },
    ferramentas: [f("atualizar_perfil"), f("ver_colegas"), f("pedir_a_bot"), f("criar_rotina"), f("pedir_acesso"), f("pedir_aprovacao"), f("criar_bots")],
    pessoaNome: "Pessoa Exemplo",
    modo: "criacao",
    colegas,
    conectores: [],
    memorias: [],
  },
  // 8. Task filha de uma rotina (ADR-083, #193): não abre outra, e a linha da task diz por quê.
  "task-filha-de-rotina": {
    agente,
    ferramentas: [f("sem_novidade"), f("pedir_a_bot"), f("ver_colegas"), f("pedir_acesso")],
    pessoaNome: "Pessoa Exemplo",
    modo: "rotina",
    colegas,
    conectores: [conectorTarefas],
    memorias: turno1.memorias,
    trabalho: { titulo: "Responder o chamado de exemplo", origem: "rotina", trabalhoMaeId: "trab-mae" },
    semTerminal: "rotina",
  },
  // 9. Uma frente do dono (ADR-099, I2): devolver_resumo no catálogo, sem me_chame_as, e a linha "Frente atual".
  "frente-do-dono": {
    agente,
    ferramentas: [f("pedir_aprovacao"), f("pedir_a_pessoa"), f("pedir_a_bot"), f("ver_colegas"), f("lembrar"), f("publicar_artefato"), f("pedir_acesso"), f("devolver_resumo")],
    nativas: ["Read", "Edit", "Write", "Bash", "Skill", "Agent"],
    pastaDoBot: "Vera/login-no-safari-abc123",
    pessoaNome: "Pessoa Exemplo",
    modo: "conversa",
    colegas,
    conectores: [conectorTarefas],
    memorias: turno1.memorias,
    trabalho: { titulo: "Login no Safari", origem: "pessoa", trabalhoMaeId: null, forma: "frente" },
    contextoConversa: '{"historico":[{"autor":"Vera","texto":"Reproduzi o erro no Safari.","confianca":"confiavel"}]}',
  },
  // ADR-099 (I7 revista): a triagem na entrada — o pedido de colega e o de rotina são um turno curto do dono, sem trabalho.
  "triagem-de-colega": {
    agente: { ...agente, modoAprovacao: "automatico" },
    ferramentas: [f("pedir_a_bot"), f("ver_colegas"), f("pedir_acesso"), f("lembrar"), f("abrir_frentes"), f("mandar_para_frente"), f("me_chame_as")],
    pessoaNome: "Pessoa Exemplo",
    modo: "delegacao",
    delegacao: { pessoaNome: "Pessoa Exemplo", remetenteNome: "Tuca" },
    profundidade: 1,
    colegas,
    conectores: [conectorTarefas],
    memorias: turno1.memorias,
    trabalhosAbertos: turno1.trabalhosAbertos,
    contextoConversa: turno1.contextoConversa,
  },
  "triagem-de-rotina": {
    agente,
    ferramentas: [f("sem_novidade"), f("pedir_a_bot"), f("ver_colegas"), f("pedir_acesso"), f("abrir_frentes"), f("mandar_para_frente"), f("me_chame_as")],
    pessoaNome: "Pessoa Exemplo",
    modo: "rotina",
    colegas,
    conectores: [conectorTarefas],
    rotinas,
    memorias: turno1.memorias,
    trabalhosAbertos: turno1.trabalhosAbertos,
  },
  // 7. O Nod, o bot fixo (ADR-081/082): o manual do produto na parte estável e as ferramentas dele.
  nod: {
    agente: { nome: "Nod", titulo: "Ajudante", descricao: "Seu bot fixo no Nod. Tira dúvidas sobre o produto, cria e ajusta seus bots e anota bugs e ideias para o time do Nod.", modoAprovacao: "manual" },
    ferramentas: [f("gerir_bots"), f("ver_apps_conectados"), f("registrar_relato"), f("ver_colegas"), f("pedir_aprovacao"), f("lembrar")],
    pessoaNome: "Pessoa Exemplo",
    modo: "conversa",
    colegas,
    conectores: [],
    memorias: [],
    manualDoNod: MANUAL_DO_NOD,
  },
  // 6. Sem terminal (um motivo) e computador fora do ar (ADR-065; emenda da ADR-037).
  "sem-terminal-computador-fora": {
    agente,
    ferramentas: [f("pedir_aprovacao"), f("lembrar")],
    pessoaNome: "Pessoa Exemplo",
    modo: "conversa",
    computadorFora: { estado: "fora_do_ar", motivo: "três falhas seguidas ao conectar" },
    semTerminal: "conteudo_de_fora",
    memorias: turno1.memorias,
  },
};

/** Cenários que têm referência em __prompts__/ (o segundo-turno é montado à parte, no próprio teste). */
const CONHECIDOS = new Set([...Object.keys(CENARIOS), "segundo-turno"]);

/** .txt de __prompts__/ sem cenário no teste: o vitest não marca file snapshot como obsoleto, então ninguém veria. */
function referenciasOrfas(): string[] {
  const pasta = dirname(ARQUIVO_TAMANHOS);
  if (!existsSync(pasta)) return [];
  return readdirSync(pasta).filter((n) => n.endsWith(".txt") && !CONHECIDOS.has(n.slice(0, -".txt".length))).sort();
}

function serializar(p: { estavel: string[]; volatil: string[] }, rotuloVolatil = "VOLÁTIL"): string {
  return `=== ESTÁVEL ===\n${p.estavel.join("\n")}\n\n=== ${rotuloVolatil} ===\n${p.volatil.join("\n")}\n`;
}

function tamanho(p: { estavel: string[]; volatil: string[] }): Tamanho {
  return { estavel: p.estavel.join("\n").length, volatil: p.volatil.join("\n").length };
}

/** Falha com mensagem clara se a parte estável cresceu além do limite sobre a referência de tamanhos.json. */
function conferirTamanho(cenario: string, medido: Tamanho): void {
  medidos[cenario] = medido;
  if (atualizando()) return;
  const ref = referencia[cenario];
  if (!ref) throw new Error(`${cenario} não tem tamanho de referência em __prompts__/tamanhos.json; rode npm run prompt:referencia`);
  const crescimento = (medido.estavel - ref.estavel) / ref.estavel;
  if (crescimento > LIMITE_CRESCIMENTO_ESTAVEL) {
    throw new Error(`parte estável de ${cenario} cresceu ${(crescimento * 100).toFixed(1)}% (${ref.estavel} → ${medido.estavel} caracteres; limite ${LIMITE_CRESCIMENTO_ESTAVEL * 100}%); se foi de propósito, rode npm run prompt:referencia`);
  }
}

describe("NOD-163: prompts de referência (__prompts__/)", () => {
  afterAll(() => {
    if (!atualizando()) return;
    // Mescla com o que já existe: rodar com -t num cenário só não apaga os outros. Cenário que saiu do teste
    // sai do arquivo também, para o tamanhos.json não acumular referência morta.
    const todos = { ...referencia, ...medidos };
    const ordenado = Object.fromEntries(Object.keys(todos).filter((k) => CONHECIDOS.has(k)).sort().map((k) => [k, todos[k]]));
    mkdirSync(dirname(ARQUIVO_TAMANHOS), { recursive: true });
    writeFileSync(ARQUIVO_TAMANHOS, `${JSON.stringify(ordenado, null, 2)}\n`);
  });

  for (const [cenario, entrada] of Object.entries(CENARIOS)) {
    it(cenario, async () => {
      await expect(serializar(partesDoPromptSistema(entrada))).toMatchFileSnapshot(`./__prompts__/${cenario}.txt`);
    });
    // Separado do snapshot: o diff do texto e o aviso de tamanho aparecem juntos, cada um com a sua mensagem.
    it(`${cenario}: tamanho da parte estável`, () => {
      conferirTamanho(cenario, tamanho(partesDoPromptSistema(entrada)));
    });
  }

  // 7. 2º turno da mesma sessão: só a parte volátil muda, e a estável é idêntica (prova da NOD-155).
  it("segundo-turno", async () => {
    const base = conversa("total");
    const p1 = partesDoPromptSistema({ ...base, ...turno1 });
    const p2 = partesDoPromptSistema({ ...base, ...turno2 });
    expect(p2.estavel).toEqual(p1.estavel);
    expect(p2.volatil).not.toEqual(p1.volatil);
    const texto = `${serializar(p1, "VOLÁTIL (1º turno)")}\n=== VOLÁTIL (2º turno) ===\n${p2.volatil.join("\n")}\n`;
    await expect(texto).toMatchFileSnapshot("./__prompts__/segundo-turno.txt");
  });

  it("segundo-turno: tamanho da parte estável", () => {
    conferirTamanho("segundo-turno", tamanho(partesDoPromptSistema({ ...conversa("total"), ...turno2 })));
  });

  // Cenário removido do teste: com -u, o .txt dele sai junto com a chave do tamanhos.json; sem -u, falha.
  it("__prompts__/ não tem referência de cenário que saiu do teste", () => {
    const orfas = referenciasOrfas();
    if (atualizando()) {
      for (const n of orfas) rmSync(join(dirname(ARQUIVO_TAMANHOS), n));
      return;
    }
    expect(orfas, "referência sem cenário em __prompts__/; rode npm run prompt:referencia para apagá-la").toEqual([]);
  });

  it("as referências não têm e-mail nem segredo", () => {
    for (const [cenario, entrada] of Object.entries(CENARIOS)) {
      const texto = serializar(partesDoPromptSistema(entrada));
      expect(texto, cenario).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
      expect(texto, cenario).not.toMatch(/\b(sk|ghp|xox[bp])[-_][A-Za-z0-9]/);
    }
  });
});
