import { describe, expect, it } from "vitest";
import { avisoDeRecomeco, montarResumoDoRecomeco, RESUMO_DO_RECOMECO_MAX, TITULO_DO_RESUMO } from "../../../src/domain/recomeco.ts";
import { criarAgente } from "../../../src/use-cases/criar-agente.ts";
import { dadosDoResumo, umaLinha } from "../../../src/use-cases/resumo-do-recomeco.ts";
import { depsEmMemoria, executar, MARLON } from "../../helpers/deps-l6.ts";

/**
 * NOD-312: o resumo do trabalho do turno de conversa que recomeça. Só o registro do nod (nomes, contagens, desfechos),
 * nunca a saída crua de uma ferramenta, e nenhum segredo — mesmo quando ele aparece no texto de uma ação aprovada.
 */
const rep = (s: string, n: number) => s.repeat(n);
const GITHUB = `ghp_${rep("a1B2", 9)}`;
const OPENAI = `sk-proj-${rep("Zx9_", 8)}`;

describe("resumo do recomeço", () => {
  it("conta ferramentas, separa efeitos e erros, e redige os segredos", async () => {
    const { deps } = depsEmMemoria(MARLON);
    const { data: bot } = await executar(deps, criarAgente, { dono: "pessoa", nome: "Gil" });
    const conversaId = bot.conversa.id;
    const turno = (await deps.repos.turnos.enfileirar({ conversaId, agenteId: bot.agente.id, origem: "conversa", prazoEm: Date.now() + 60_000, profundidade: 0, entradaTexto: "roda", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli", executor: "local" }))!;
    for (let i = 0; i < 3; i++) await deps.repos.trilha.registrar({ agenteId: bot.agente.id, turnoId: turno.id, ferramenta: "Bash", kind: "tool_call", regra: "regra:nativas", regraVersao: 1 });
    await deps.repos.trilha.registrar({ agenteId: bot.agente.id, turnoId: turno.id, ferramenta: "pedir_a_bot", kind: "tool_call", regra: "regra:nativas", regraVersao: 1 });
    await deps.repos.trilha.registrar({ agenteId: bot.agente.id, turnoId: turno.id, ferramenta: "Read", kind: "negacao", motivo: "fora_da_pasta", regra: "regra:nativas", regraVersao: 1 });
    const decisao = (await deps.repos.decisoes.criar({ tipo: "aprovacao", agenteId: bot.agente.id, conversaId, turnoId: turno.id, prazoDecisaoEm: Date.now() + 60_000, frase: "Comentar" }))!;
    // O texto da ação aprovada trazia a saída de um comando com um token — já na 1ª linha (a que entra no resumo).
    await deps.repos.itensAprovacao.criarLote(decisao.id, [{ idx: 0, texto: `GH_TOKEN=${GITHUB}\nOPENAI_API_KEY=${OPENAI}`, destino: { conector: "github", ferramenta: "comentar", argumentos: {} }, origemSensivel: false, desfecho: "executado" }]);
    // Revisão 2: a frase de uma pergunta também passa pela redação.
    const pergunta = (await deps.repos.decisoes.criar({ tipo: "pergunta", agenteId: bot.agente.id, conversaId, turnoId: turno.id, prazoDecisaoEm: Date.now() + 60_000, frase: `Uso a chave ${OPENAI}?` }))!;
    await deps.repos.decisoes.decidir(pergunta.id, { por: MARLON.pessoaId, agora: Date.now() });

    const dados = await dadosDoResumo(deps, [turno], []);
    expect(dados.ferramentas.map((i) => i.texto)).toEqual(["Bash × 3"]);
    expect(dados.efeitos.map((i) => i.texto)).toContain("pedir_a_bot × 1");
    expect(dados.erros.map((i) => i.texto)).toContain("Negado: Read (fora_da_pasta).");

    const resumo = montarResumoDoRecomeco(dados)!;
    expect(resumo.startsWith(TITULO_DO_RESUMO)).toBe(true);
    expect(resumo).toContain("Bash × 3");
    expect(resumo).toContain("github/comentar (aprovado e executado)");
    expect(resumo).toContain("Pergunta (respondida): Uso a chave");
    expect(resumo).toContain("GH_TOKEN=");
    expect(resumo).not.toContain(GITHUB);
    expect(resumo).not.toContain(OPENAI);
    expect(resumo).not.toContain("OPENAI_API_KEY"); // revisão 1: só a 1ª linha do texto entra
  });

  it("NOD-70: cartão, clique e lote vêm pelo item de aprovação, não pela linha da trilha", async () => {
    const { deps } = depsEmMemoria(MARLON);
    const { data: bot } = await executar(deps, criarAgente, { dono: "pessoa", nome: "Gil" });
    const turno = (await deps.repos.turnos.enfileirar({ conversaId: bot.conversa.id, agenteId: bot.agente.id, origem: "conversa", prazoEm: Date.now() + 60_000, profundidade: 0, entradaTexto: "roda", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli", executor: "local" }))!;
    const linha = { agenteId: bot.agente.id, turnoId: turno.id, ferramenta: "github__comentar", regraVersao: 1 };
    await deps.repos.trilha.registrar({ ...linha, kind: "cartao", motivo: "acao_arriscada", regra: "regra:cartao" });
    await deps.repos.trilha.registrar({ ...linha, kind: "tool_call", motivo: "item_de_aprovacao", regra: "regra:clique" });
    await deps.repos.trilha.registrar({ ...linha, kind: "negacao", motivo: "retirado_pela_pessoa", regra: "regra:clique" });
    await deps.repos.trilha.registrar({ ...linha, kind: "tool_call", motivo: "item_de_aprovacao", regra: "regra:modo_automatico" });
    await deps.repos.trilha.registrar({ ...linha, ferramenta: "Bash", kind: "tool_call", regra: "regra:nativas" });
    const dados = await dadosDoResumo(deps, [turno], []);
    expect(dados.ferramentas.map((i) => i.texto)).toEqual(["Bash × 1"]);
    expect([...dados.efeitos, ...dados.erros].map((i) => i.texto).join("\n")).not.toContain("github__comentar");
  });

  it("montarResumoDoRecomeco redige o segredo que chega cru em qualquer seção (revisão 7)", () => {
    const resumo = montarResumoDoRecomeco({ ferramentas: [], efeitos: [{ texto: `deploy com ${GITHUB}`, em: 1 }], erros: [{ texto: `falhou: ${OPENAI}`, em: 2 }], decisoes: [] })!;
    expect(resumo).toContain("deploy com");
    expect(resumo).not.toContain(GITHUB);
    expect(resumo).not.toContain(OPENAI);
  });

  it("a sessão recusada e a fala absorvida não entram como erro do trabalho; outra interrupção entra (revisões 7 e 9)", async () => {
    const { deps } = depsEmMemoria(MARLON);
    const { data: bot } = await executar(deps, criarAgente, { dono: "pessoa", nome: "Gil" });
    const turno = (await deps.repos.turnos.enfileirar({ conversaId: bot.conversa.id, agenteId: bot.agente.id, origem: "conversa", prazoEm: Date.now() + 60_000, profundidade: 0, entradaTexto: "roda", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli", executor: "local" }))!;
    const recusada = { ...turno, estado: "interrompido", motivoInterrupcao: "sessao_rejeitada" } as typeof turno;
    const parada = { ...turno, id: "outro", estado: "interrompido", motivoInterrupcao: "parado_pela_pessoa" } as unknown as typeof turno;
    const absorvido = { ...turno, id: "abs", estado: "interrompido", motivoInterrupcao: "absorvido" } as unknown as typeof turno;
    const dados = await dadosDoResumo(deps, [recusada, parada, absorvido], []);
    expect(dados.erros.map((i) => i.texto)).toEqual(["Turno interrompido (parado_pela_pessoa)."]);
  });

  it("respeita o teto e diz o que omitiu; sem nada a dizer, não há resumo", () => {
    const muitos = Array.from({ length: 200 }, (_, i) => ({ texto: `ferramenta_${i} × ${i + 1}`, em: i }));
    const resumo = montarResumoDoRecomeco({ ferramentas: muitos, efeitos: [], erros: [], decisoes: [] })!;
    expect(resumo.length).toBeLessThanOrEqual(RESUMO_DO_RECOMECO_MAX);
    expect(resumo).toMatch(/mais \d+ itens omitidos/);
    expect(resumo).toContain("ferramenta_199"); // o mais recente fica
    expect(montarResumoDoRecomeco({ ferramentas: [], efeitos: [], erros: [], decisoes: [] })).toBeNull();
  });

  it("o aviso diz o porquê sem jargão e manda reler só o necessário", () => {
    expect(avisoDeRecomeco("troca_de_conta")).toContain("outra conta da IA");
    expect(avisoDeRecomeco("sessao_recusada")).toContain("releia só o necessário");
    expect(avisoDeRecomeco("troca_de_ia")).not.toMatch(/sess[aã]o do CLI|--resume/);
    // Revisão 4: sem resumo, o aviso não promete um "abaixo" que não vem.
    expect(avisoDeRecomeco("troca_de_ia")).toContain("resumo do trabalho abaixo");
    expect(avisoDeRecomeco("troca_de_ia", { comResumo: false })).not.toContain("resumo");
  });
  it("do texto do efeito, só a 1ª linha curta (revisão 1)", () => {
    expect(umaLinha("\n  Oi Ana,\nsegue o contrato\ncom a senha")).toBe("Oi Ana,");
    // Revisão 5: o corte de 120 cai no meio do token; redigido antes, nenhum pedaço dele sobra.
    const antes = `${"x".repeat(100)} ${GITHUB}`;
    expect(umaLinha(antes)).not.toContain("ghp_");
    expect(umaLinha(antes)).not.toContain("a1B2");
    expect(umaLinha(`${"y".repeat(170)} sk-proj-${rep("abcde", 8)}`, 200)).not.toContain("sk-proj-abc");
    const longa = umaLinha("x".repeat(300));
    expect(longa).toHaveLength(120);
    expect(longa.endsWith("…")).toBe(true);
  });
});
