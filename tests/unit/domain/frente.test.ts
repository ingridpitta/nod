import { describe, expect, it } from "vitest";
import type { Agente } from "../../../src/contracts/agente.ts";
import { FERRAMENTAS_NOD } from "../../../src/contracts/ferramentas-nod.ts";
import type { Turno } from "../../../src/contracts/turno.ts";
import { BRANCH_NA_FRENTE_ATUAL, branchDaFrente, CORTE_DA_ULTIMA_FALA, DONO_INTEGRA, ehFrente, entradaDaFrente, instrucaoDoResumoInvalido, molduraDaFrente, resumoSemChamada, TEXTO_APROVACAO_VENCIDA, TEXTO_PERGUNTA_VENCIDA, semLinhaDeEmpurrar, textoFrentesAbertas, tituloDoLote } from "../../../src/domain/frente.ts";
import { errosDoSchema } from "../../../src/domain/schema-args.ts";
import { montarPlano, type EntradaPlano } from "../../../src/domain/plano-turno.ts";
import { partesDoPromptSistema, secaoDaLinha } from "../../../src/domain/prompt-sistema.ts";
import { validarResumo, type ErroResumo } from "../../../src/domain/resumo-da-frente.ts";

const agora = 1_000_000;
const agente: Agente = { tenantId: "t", id: "a1", ownerId: "p", visibility: "privado", nome: "Vera", titulo: "", descricao: "revisa PRs", dono: "pessoa", forma: "shape-square", cor: "c-red", fixado: false, oculto: false, confirmado: true, modelo: "claude-haiku-4-5-20251001", duplicadoDe: null, criadoEm: 0 };
const turno: Turno = { executor: "catcher", tenantId: "t", id: "t1", conversaId: "c1", agenteId: "a1", ownerId: "p", origem: "conversa", estado: "despachando", sinais: { attempted: true, rejected: false, promptSubmitted: false, producedOutput: false }, machineId: null, leaseAte: null, prazoEm: agora + 86_400_000, motivoInterrupcao: null, motivoFalha: null, semNovidadeMotivo: null, retomaTurnoId: null, profundidade: 0, reenvios: 0, pararSolicitadoEm: null, entradaTexto: "oi", entradaAnexos: [], entradaConfianca: "confiavel", custoUsd: null, modelo: "claude-haiku-4-5-20251001", criadoEm: agora, mensagemOrigemId: "m0" };
const base: EntradaPlano = { turno, agente, memorias: [], concessoes: [], conectores: [], modo: "conversa", confianca: "confiavel", profundidade: 0, inventario: { estado: "pronto", versao: "2.1.272", em: agora }, executor: "local", sessaoCli: null, pessoaNome: "Marlon", agora };
const nomes = (p: ReturnType<typeof montarPlano>) => p.catalogo.ferramentas.map((f) => f.nome);

describe("catálogo por forma (ADR-099, I2)", () => {
  it("o dono (conversa sem trabalho) tem abrir_frentes e mandar_para_frente; não tem devolver_resumo nem os sinônimos", () => {
    const n = nomes(montarPlano(base));
    expect(n).toEqual(expect.arrayContaining(["abrir_frentes", "mandar_para_frente", "me_chame_as"]));
    for (const fora of ["devolver_resumo", "abrir_task", "mandar_para_task"]) expect(n).not.toContain(fora);
  });

  it("a frente ganha devolver_resumo e perde me_chame_as, esperar_comando, abrir_frentes e mandar_para_frente", () => {
    const n = nomes(montarPlano({ ...base, trabalho: { titulo: "Login", origem: "pessoa", trabalhoMaeId: null, forma: "frente" } }));
    expect(n).toContain("devolver_resumo");
    for (const fora of ["me_chame_as", "esperar_comando", "abrir_frentes", "mandar_para_frente", "abrir_task"]) expect(n).not.toContain(fora);
    // A frente ainda pergunta à pessoa na hora (decisão 6).
    expect(n).toContain("pedir_a_pessoa");
  });

  it("a task de antes (forma task) segue como era: sem devolver_resumo, com me_chame_as; a rotina-mãe abre frentes", () => {
    const task = nomes(montarPlano({ ...base, trabalho: { titulo: "Login", origem: "pessoa", trabalhoMaeId: null, forma: "task" } }));
    expect(task).toContain("me_chame_as");
    expect(task).not.toContain("devolver_resumo");
    expect(task).not.toContain("abrir_frentes");
    const mae = nomes(montarPlano({ ...base, modo: "rotina", trabalho: { titulo: "Triagem", origem: "rotina", trabalhoMaeId: null, forma: "task" } }));
    expect(mae).toContain("abrir_frentes");
    expect(mae).not.toContain("mandar_para_frente");
    const filha = nomes(montarPlano({ ...base, modo: "rotina", trabalho: { titulo: "Chamado", origem: "rotina", trabalhoMaeId: "mae", forma: "frente" } }));
    expect(filha).toContain("devolver_resumo");
    expect(filha).not.toContain("abrir_frentes");
    expect(filha).not.toContain("me_chame_as");
  });

  it("o prompt da frente diz o que ela é, que devolve fatos com devolver_resumo e que não espera nada de fora", () => {
    const plano = montarPlano({ ...base, trabalho: { titulo: "Login no Safari", origem: "pessoa", trabalhoMaeId: null, forma: "frente" } });
    const { estavel, volatil } = plano.promptSistemaPartes!;
    expect(estavel).toContain("Frente: você é uma frente do dono");
    expect(estavel).toContain("devolver_resumo");
    expect(estavel).toContain("Não espere nada de fora");
    expect(estavel).not.toContain("me_chame_as com em quantos minutos");
    expect(volatil).toContain('Frente atual: você está na frente "Login no Safari"');
    expect(volatil).not.toContain("Task atual:");
    // NOD-376: a fala da pessoa na frente é respondida primeiro, e espera longa roda em segundo plano.
    expect(volatil).toContain("Se a pessoa escrever nesta frente, responda a ela primeiro");
    expect(volatil).toContain("CI e deploy de fora você não espera aqui: devolva o fato");
    const daConversa = montarPlano(base).promptSistemaPartes!;
    expect([...daConversa.estavel, ...daConversa.volatil].join("\n")).not.toContain("Se a pessoa escrever nesta frente");
    expect(secaoDaLinha("Frente: x")).toBe("ferramentas");
    expect(secaoDaLinha("Frentes: x")).toBe("ferramentas");
    expect(secaoDaLinha("Frente atual: x")).toBe("contexto");
  });

  it("o schema das ferramentas: um lote pede ao menos uma frente; o resumo pede só `feito`", () => {
    expect(FERRAMENTAS_NOD.abrir_frentes.required).toEqual(["frentes"]);
    expect(FERRAMENTAS_NOD.abrir_frentes.properties.frentes.minItems).toBe(1);
    expect(FERRAMENTAS_NOD.devolver_resumo.required).toEqual(["feito"]);
    expect(FERRAMENTAS_NOD.mandar_para_frente.required).toEqual(["trabalho_id", "texto"]);
    // A parte estável do prompt do dono cita as ferramentas novas, não as antigas.
    const { estavel } = partesDoPromptSistema({ agente, ferramentas: montarPlano(base).catalogo.ferramentas, pessoaNome: "Marlon", modo: "conversa", memorias: [] });
    expect(estavel.join("\n")).toContain("abrir_frentes uma vez por pedido");
    expect(estavel.join("\n")).not.toContain("abrir_task");
  });
});

describe("regras puras das frentes (ADR-099, I2)", () => {
  it("ehFrente só para forma frente", () => {
    expect(ehFrente({ forma: "frente" })).toBe(true);
    expect(ehFrente({ forma: "task" })).toBe(false);
    expect(ehFrente({})).toBe(false);
    expect(ehFrente(null)).toBe(false);
  });

  it("o título do lote (plano chat limpo, PR 5): o do modelo; sem ele, a frente (uma) ou 'N frentes'", () => {
    expect(tituloDoLote("frentes de hero", 5, "Hero da home")).toBe("frentes de hero");
    expect(tituloDoLote(null, 1, "Roteiros de animação")).toBe("Roteiros de animação");
    expect(tituloDoLote(null, 3, "Login no Safari")).toBe("3 frentes");
    expect(tituloDoLote("frentes de hero", 1, "Hero da home")).toBe("frentes de hero");
  });

  it("a linha do lote: uma frente pelo nome, várias pela contagem e a lista", () => {
    expect(textoFrentesAbertas(["Login"])).toBe("Começou a frente Login");
    expect(textoFrentesAbertas(["Login", "CI"])).toBe("Começou 2 frentes: Login e CI");
    expect(textoFrentesAbertas(["A", "B", "C"])).toBe("Começou 3 frentes: A, B e C");
  });

  it("a entrada da frente: a moldura, o pedido e, se houver, o repositório e o branch de partida", () => {
    expect(entradaDaFrente({ titulo: "Login", pedido: " Conserte o login. ", deRotina: false })).toBe(`${molduraDaFrente("Login", false)}Conserte o login.\n\nSe mexer num repositório, não empurre: devolva o branch e o SHA.`);
    expect(entradaDaFrente({ titulo: "Login", pedido: "x", deRotina: false, repo: "gamefik/nod" })).toContain("Repositório: gamefik/nod. Parta de origin/main.");
    expect(entradaDaFrente({ titulo: "Login", pedido: "x", deRotina: false, repo: "gamefik/nod", branchBase: "feat/a" })).toContain("Parta de feat/a.");
    expect(entradaDaFrente({ titulo: "Login", pedido: "x", deRotina: true, branchBase: "feat/a" })).toBe(`${molduraDaFrente("Login", true)}x\n\nParta do branch feat/a.\nNão empurre: devolva o branch e o SHA.`);
    expect(molduraDaFrente("Login", false)).toContain("devolver_resumo");
  });

  it("o resumo sem chamada passa na validação, corta a última fala e diz o estado", () => {
    const longa = "palavra ".repeat(400);
    for (const estado of ["terminado", "falhou", "parado"] as const) {
      for (const ultimaFala of [null, "", "Corrigi o login.", longa]) {
        const r = resumoSemChamada({ estado, ultimaFala });
        expect(validarResumo(r)).toEqual({ ok: true, resumo: r });
      }
    }
    expect(resumoSemChamada({ estado: "terminado", ultimaFala: "Corrigi o login." })).toEqual({ feito: "Corrigi o login." });
    expect(resumoSemChamada({ estado: "terminado", ultimaFala: null }).feito).toBe("A frente terminou sem dizer o que fez.");
    expect(resumoSemChamada({ estado: "falhou", ultimaFala: "Rodando os testes" })).toMatchObject({ feito: "A frente falhou antes de devolver o resumo. Última fala: Rodando os testes", falta: expect.any(String) });
    expect(resumoSemChamada({ estado: "parado", ultimaFala: null }).feito).toBe("A pessoa parou a frente antes do fim.");
    expect(resumoSemChamada({ estado: "terminado", ultimaFala: longa }).feito.length).toBe(CORTE_DA_ULTIMA_FALA);
  });

  it("toda recusa do resumo vira instrução com o campo", () => {
    const erros: ErroResumo[] = ["nao_e_objeto", "campo_desconhecido", "feito_vazio", "texto_invalido", "texto_longo", "pr_invalido", "sha_invalido", "resumo_grande"];
    for (const e of erros) expect(instrucaoDoResumoInvalido(e, "sha")).toMatch(/^O resumo não foi guardado \(sha\): .+ Chame devolver_resumo de novo\.$/);
  });
});

describe("cada frente no próprio branch; só o dono integra (ADR-099, I4)", () => {
  type TrabalhoDoTeste = NonNullable<EntradaPlano["trabalho"]>;
  const frente: TrabalhoDoTeste = { titulo: "Login no Safari", origem: "pessoa", trabalhoMaeId: null, forma: "frente" };
  const pasta = "Vera/login-no-safari-abc123";
  const promptDa = (p: { trabalho?: TrabalhoDoTeste; pastaDoBot?: string; linux?: boolean; modo?: "conversa" | "rotina" }) => {
    const modo = p.modo ?? "conversa";
    const ferramentas = montarPlano({ ...base, modo, trabalho: p.trabalho }).catalogo.ferramentas;
    const { estavel, volatil } = partesDoPromptSistema({ agente, ferramentas, nativas: ["Read", "Edit", "Write", "Bash"], pastaDoBot: p.pastaDoBot ?? pasta, pessoaNome: "Marlon", modo, memorias: [], trabalho: p.trabalho ?? null, maquina: p.linux ? { nome: "vm-bots", plataforma: "linux" } : null });
    return { estavel: estavel.join("\n"), volatil: volatil.join("\n") };
  };

  it("a frente cria a worktree no próprio branch frente/<slug> a partir do branch_base e só empurra o dela com autorização", () => {
    const { estavel, volatil } = promptDa({ trabalho: frente });
    expect(branchDaFrente(pasta)).toBe("frente/login-no-safari-abc123");
    expect(estavel).toContain(`worktree add ~/nod/${pasta}/<repo> -b frente/login-no-safari-abc123 <branch_base> (o branch de onde a entrada mandou partir; sem ele, origin/main)`);
    expect(estavel).toContain("Commite só nesse branch e nunca empurre um branch que você não criou");
    expect(estavel).toContain("Empurre o seu branch ou abra PR só se a entrada disser que o dono autorizou");
    expect(estavel).toContain("devolva o branch e o SHA no devolver_resumo");
    expect(estavel).not.toContain("-b <branch> origin/main");
    expect(volatil).toContain('Frente atual: você está na frente "Login no Safari"');
    expect(volatil).toContain(BRANCH_NA_FRENTE_ATUAL);
    // A frente não integra: a regra do dono não aparece para ela.
    expect(estavel).not.toContain(DONO_INTEGRA);
  });

  it("numa máquina Linux a frente parte do clone desta máquina, com as mesmas regras de branch", () => {
    const { estavel } = promptDa({ trabalho: frente, linux: true });
    expect(estavel).toContain("num branch só seu, a partir do clone: git -C <clone> fetch origin");
    expect(estavel).toContain("-b frente/login-no-safari-abc123 <branch_base>");
    expect(estavel).toContain("nunca empurre um branch que você não criou");
  });

  it("a task de antes (forma task) segue com o texto de sempre, sem branch de frente", () => {
    const { estavel, volatil } = promptDa({ trabalho: { ...frente, forma: "task" } });
    expect(estavel).toContain(`worktree add ~/nod/${pasta}/<repo> -b <branch> origin/main`);
    expect(estavel).not.toContain("frente/");
    expect(volatil).not.toContain(BRANCH_NA_FRENTE_ATUAL);
  });

  it("o dono e a rotina-mãe veem a regra de integração: branch_base por frente, merge na própria worktree, só ele empurra", () => {
    expect(promptDa({ pastaDoBot: "Vera" }).estavel).toContain(DONO_INTEGRA);
    expect(DONO_INTEGRA).toContain("dê a cada frente o repo e o branch_base");
    expect(DONO_INTEGRA).toContain("integre esses branches na sua worktree (git merge, sem push");
    expect(DONO_INTEGRA).toContain("só você empurra no branch do PR");
    expect(DONO_INTEGRA).toContain("nunca peça a duas frentes que empurrem no mesmo branch");
    expect(promptDa({ modo: "rotina", trabalho: { titulo: "Triagem", origem: "rotina", trabalhoMaeId: null, forma: "task" } }).estavel).toContain(DONO_INTEGRA);
  });

  it("pode_empurrar vira uma linha clara na entrada da frente; o padrão é não empurrar", () => {
    const sem = entradaDaFrente({ titulo: "Login", pedido: "x", deRotina: false, repo: "gamefik/nod", branchBase: "feat/pr-845" });
    expect(sem.endsWith("Repositório: gamefik/nod. Parta de feat/pr-845.\nNão empurre: devolva o branch e o SHA.")).toBe(true);
    expect(entradaDaFrente({ titulo: "Login", pedido: "x", deRotina: false, repo: "gamefik/nod", podeEmpurrar: false })).toContain("Não empurre: devolva o branch e o SHA.");
    const com = entradaDaFrente({ titulo: "Login", pedido: "x", deRotina: false, repo: "gamefik/nod", podeEmpurrar: true });
    expect(com.endsWith("Repositório: gamefik/nod. Parta de origin/main.\nO dono autorizou empurrar o seu branch e abrir PR.")).toBe(true);
    expect(com).not.toContain("Não empurre");
    expect(entradaDaFrente({ titulo: "Notas", pedido: "x", deRotina: false, podeEmpurrar: true }).endsWith("x\n\nO dono autorizou empurrar o seu branch e abrir PR.")).toBe(true);
    // O "Fazer aqui" devolve o pedido ao dono sem a linha, que só faz sentido na frente.
    const moldura = molduraDaFrente("Login", false);
    expect(semLinhaDeEmpurrar(com.slice(moldura.length))).toBe("x\n\nRepositório: gamefik/nod. Parta de origin/main.");
    expect(semLinhaDeEmpurrar(entradaDaFrente({ titulo: "Login", pedido: "x", deRotina: false }).slice(moldura.length))).toBe("x");
    expect(semLinhaDeEmpurrar("sem linha nenhuma")).toBe("sem linha nenhuma");
  });

  it("o schema de abrir_frentes aceita pode_empurrar booleano e recusa outro tipo", () => {
    const schema = FERRAMENTAS_NOD.abrir_frentes;
    const lote = (extra: Record<string, unknown>) => ({ frentes: [{ titulo: "Login", pedido: "x", repo: "gamefik/nod", branch_base: "feat/a", ...extra }] });
    expect(errosDoSchema(schema, lote({}))).toEqual([]);
    expect(errosDoSchema(schema, lote({ pode_empurrar: true }))).toEqual([]);
    expect(errosDoSchema(schema, lote({ pode_empurrar: false }))).toEqual([]);
    expect(errosDoSchema(schema, lote({ pode_empurrar: "sim" }))).not.toEqual([]);
    expect(errosDoSchema(schema, lote({ empurrar: true }))).not.toEqual([]);
    expect(schema.properties.frentes.items.properties?.pode_empurrar?.type).toBe("boolean");
  });
});

describe("resumoSemChamada (NOD-282, G5): a decisão vencida pelo tipo", () => {
  it("aprovação vencida leva o texto da aprovação; pergunta ou sem tipo, o da pergunta", () => {
    expect(resumoSemChamada({ estado: "falhou", ultimaFala: "Posso enviar?", perguntaVencida: true, vencidaTipo: "aprovacao" }).feito).toBe(`A frente parou: ${TEXTO_APROVACAO_VENCIDA}.`);
    expect(resumoSemChamada({ estado: "falhou", ultimaFala: "Qual?", perguntaVencida: true, vencidaTipo: "pergunta" }).feito).toBe(`A frente parou: ${TEXTO_PERGUNTA_VENCIDA}.`);
    expect(resumoSemChamada({ estado: "falhou", ultimaFala: "Qual?", perguntaVencida: true }).feito).toBe(`A frente parou: ${TEXTO_PERGUNTA_VENCIDA}.`);
  });
});
