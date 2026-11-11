import { describe, expect, it } from "vitest";
import { PRAZO_GUARDA, RAZAO_MAXIMA_LINEAR, razaoDeCrescimento } from "../../helpers/crescimento.ts";
import { CAPACIDADES_HARNESS, SEM_CAPACIDADES } from "../../../src/contracts/harness.ts";
import { seguimentoNaRede } from "../../../src/domain/frente.ts";
import { CARACTERES_TITULO_PROVISORIO, esperaDoTrabalho, estadoDoTrabalho, linhaCurta, PALAVRAS_TITULO_PROVISORIO, pastaDoTrabalho, pastaRelativa, podeAbrirTask, podeMandarParaTask, promoveNaRede, REDE_MS, slugDoTrabalho, TITULO_PROVISORIO_RESERVA, tituloDoTrabalho, tituloOuNada, tituloProvisorio, type FatosTrabalho } from "../../../src/domain/trabalho.ts";

const base: FatosTrabalho = { estadoAtual: "na_fila", iniciado: false, parando: 0, despachando: 0, pendentes: 0, esperandoOutro: false, decisaoPendente: false, aguardandoColega: false, ultimo: null };

describe("estadoDoTrabalho (a tabela de estados da #192)", () => {
  it.each([
    ["criado, sem turno despachado", {}, "na_fila"],
    ["turno na fila antes de começar (ou esperando o depois_de)", { pendentes: 1 }, "na_fila"],
    ["turno rodando", { despachando: 1 }, "rodando"],
    ["turno rodando parado numa aprovação dentro do turno", { despachando: 1, decisaoPendente: true }, "precisa_de_voce"],
    ["retomada na fila de um trabalho que já começou", { iniciado: true, pendentes: 1 }, "rodando"],
    ["nada vivo e pergunta aberta", { iniciado: true, decisaoPendente: true, ultimo: { estado: "concluido", motivo: null } }, "precisa_de_voce"],
    ["fechado por memória continua fechado enquanto espera a pessoa", { estadoAtual: "fechado_ocioso", iniciado: true, decisaoPendente: true }, "fechado_ocioso"],
    ["entregou", { iniciado: true, ultimo: { estado: "concluido", motivo: null } }, "terminado"],
    ["a pessoa parou", { iniciado: true, ultimo: { estado: "interrompido", motivo: "parado_pela_pessoa" } }, "parado"],
    ["o Parar foi pedido e o processo ainda acaba", { iniciado: true, parando: 1 }, "parado"],
    ["\"Fazer depois\" com a task já começada: o turno volta à fila e espera a outra", { iniciado: true, pendentes: 1, esperandoOutro: true }, "na_fila"],
    ["o turno parado pelo \"Fazer depois\" ainda acaba, e o pedido já voltou à fila", { iniciado: true, parando: 1, pendentes: 1, esperandoOutro: true }, "na_fila"],
    ["a máquina sumiu sem retomada", { iniciado: true, ultimo: { estado: "interrompido", motivo: "maquina_sem_contato" } }, "falhou"],
    ["parado sem turno nenhum continua parado", { estadoAtual: "parado" }, "parado"],
    // Revisão do épico (S1): o Parar vence a decisão que sobrou e o desfecho do turno que acabou depois dele.
    ["parado com decisão ainda aberta continua parado", { estadoAtual: "parado", iniciado: true, decisaoPendente: true, ultimo: { estado: "concluido", motivo: null } }, "parado"],
    ["parado e o turno acabou concluído depois do Parar: continua parado", { estadoAtual: "parado", iniciado: true, ultimo: { estado: "concluido", motivo: null } }, "parado"],
    ["parado e a pessoa escreveu na task: o turno novo o reabre", { estadoAtual: "parado", iniciado: true, pendentes: 1 }, "rodando"],
    // S3: o turno acabou mas pediu a um colega; a resposta ainda não voltou.
    ["aguardando a resposta de um colega", { estadoAtual: "rodando", iniciado: true, aguardandoColega: true, ultimo: { estado: "concluido", motivo: null } }, "rodando"],
    ["aguardando colega e com pergunta aberta: precisa de você", { iniciado: true, aguardandoColega: true, decisaoPendente: true, ultimo: { estado: "concluido", motivo: null } }, "precisa_de_voce"],
    // ADR-086 (revisão do #212): a volta marcada segura a task rodando, mas não esconde o "precisa de você".
    ["com a volta marcada (me chame às): segue rodando", { estadoAtual: "rodando", iniciado: true, aguardandoDespertar: true, ultimo: { estado: "concluido", motivo: null } }, "rodando"],
    ["volta marcada e pergunta aberta: precisa de você", { estadoAtual: "rodando", iniciado: true, aguardandoDespertar: true, decisaoPendente: true, ultimo: { estado: "concluido", motivo: null } }, "precisa_de_voce"],
  ] as const)("%s → %s", (_nome, fatos, esperado) => {
    expect(estadoDoTrabalho({ ...base, ...fatos })).toBe(esperado);
  });
});

describe("título, slug e pasta", () => {
  it("título: a primeira linha não vazia, espaços juntos, até 80 caracteres", () => {
    expect(tituloDoTrabalho("\n  Montar   o dashboard de churn \nresto")).toBe("Montar o dashboard de churn");
    expect(tituloDoTrabalho("x".repeat(100))).toHaveLength(80);
    expect(tituloDoTrabalho("   ")).toBe("Trabalho");
  });
  it("título sem letra ('??', '...', só emoji) cai no reserva; o último passo e o nome da rotina seguem a linha curta (PR 5)", () => {
    expect(tituloDoTrabalho("??")).toBe("Trabalho");
    expect(tituloDoTrabalho("...")).toBe("Trabalho");
    expect(tituloDoTrabalho("🎉🎉")).toBe("Trabalho");
    expect(tituloDoTrabalho("??", "Frente")).toBe("Frente");
    expect(tituloDoTrabalho("PR #845?")).toBe("PR #845?");
    expect(tituloOuNada("  ")).toBeNull();
    expect(tituloOuNada("??")).toBeNull();
    expect(tituloOuNada("  frentes   de hero \nresto")).toBe("frentes de hero");
    expect(tituloOuNada("x".repeat(200))).toHaveLength(80);
    // A linha curta não recusa nada: o "??" da última fala continua "??".
    expect(linhaCurta("??")).toBe("??");
    expect(linhaCurta("   ")).toBe("Trabalho");
  });
  it("controle e invisível não entram no título (revisão do PR 5): o NUL derrubava o insert e o hangul vazio passava por letra", () => {
    expect(tituloOuNada("frentes\u0000de hero")).toBe("frentes de hero");
    expect(tituloOuNada("\u3164")).toBeNull();
    expect(tituloOuNada("\u202Eorep")).toBe("orep");
    expect(tituloDoTrabalho("Roteiros\u0007 de animação\u200B")).toBe("Roteiros de animação");
    expect(tituloDoTrabalho("\u0000\u0000")).toBe("Trabalho");
  });
});

describe("título provisório da frente da rede (plano chat limpo, PR 5)", () => {
  it.each([
    // A mensagem longa vira a primeira oração, até 6 palavras e 40 caracteres, sem pontuação no fim.
    ["Os resultados estão ficando muito bons, mas preciso que você refaça os roteiros de animação do hero com mais calma", "Os resultados estão ficando muito bons"],
    ["levante os números do trimestre", "Levante os números do trimestre"],
    // Sem a saudação e o vocativo; a oração acaba no "?".
    ["Bom dia, Nina! Pode refazer os roteiros de animação do hero? Obrigado", "Pode refazer os roteiros de animação"],
    ["Oi, tudo bem? Preciso que você revise o contrato da Acme hoje", "Preciso que você revise o contrato"],
    ["e aí Nina, bora fechar a versão 1.2 do app?", "Bora fechar a versão 1.2"],
    // A vírgula fecha a oração com 3 palavras ou mais antes dela; antes disso fica.
    ["Faz o deploy, depois roda os testes e me avisa", "Faz o deploy"],
    ["Hoje, refaça os roteiros", "Hoje, refaça os roteiros"],
    // "v1.2" e "12:30" não fecham a oração; o ponto com espaço fecha.
    ["Preciso que vc veja o v1.2 às 12:30 sem falta", "Preciso que vc veja o v1.2"],
    ["revise o PR #845 e veja se a CI passou. depois me fala", "Revise o PR #845 e veja"],
    // O link sai; o que sobra vira o título.
    ["olha isso https://github.com/gamefik/nod/pull/391", "Olha isso"],
    ["?? refaz os roteiros", "Refaz os roteiros"],
    ["🎉 Refazer os roteiros 🎉", "Refazer os roteiros"],
    // Revisão do PR 5 (2026-10-18): "fala", "salve" e "hello" só são saudação com pontuação, no fim ou com vocativo; o
    // vocativo não começa por palavra de ligação.
    ["Salve o arquivo em PDF no Drive", "Salve o arquivo em PDF"],
    ["Salve as planilhas, depois manda o link", "Salve as planilhas"],
    ["Fala sobre o projeto X no README", "Fala sobre o projeto X"],
    ["Hello world em Rust", "Hello world em Rust"],
    ["Fala Nina, refaz o hero", "Refaz o hero"],
    ["Fala, Nina! Pode refazer os roteiros?", "Pode refazer os roteiros"],
    ["Oi, as planilhas de setembro estão erradas", "As planilhas de setembro estão erradas"],
    // O rótulo curto antes de dois-pontos fica com o que vem depois.
    ["Bug: o login quebra no Safari", "Bug: o login quebra no Safari"],
    ["**Urgente**: refazer o deploy da API", "Urgente: refazer o deploy da API"],
    ["Preciso de duas coisas: o deploy e os testes", "Preciso de duas coisas"],
    // Oração sem letra é pulada, e a seguinte ainda acaba no ponto.
    ["??\nFaz o deploy. Depois roda os testes do backend", "Faz o deploy"],
    // Markdown: o link vira o texto dele, o bloco de código e a citação saem quando há pedido fora deles.
    ["[veja aqui](https://github.com/gamefik/nod/pull/391) e corrige", "Veja aqui e corrige"],
    ["```ts\nconst x = 1\n```\narruma isso", "Arruma isso"],
    ["```npm test``` falhou de novo", "Npm test falhou de novo"],
    ["> Os resultados estão ruins\nRefaz o gráfico de churn", "Refaz o gráfico de churn"],
    ["> Os resultados estão ruins", "Os resultados estão ruins"],
    // Outras línguas: a pontuação de largura cheia fecha a oração; a ligação do espanhol e do inglês não fecha título.
    ["请帮我修复登录页面的错误。谢谢", "请帮我修复登录页面的错误"],
    ["Por favor, arregla el login y despliega", "Por favor, arregla el login"],
    ["Hi team, can you fix the flaky test?", "Can you fix the flaky test"],
    // Regressão (QA do PR 5, 2026-10-18): a saudação do espanhol sai, com o "¿"/"¡" de abertura.
    ["Hola, ¿puedes arreglar el login y revisar los textos de la página de precios?", "Puedes arreglar el login y revisar"],
    ["Buenos días Nina, ¿puedes revisar el contrato?", "Puedes revisar el contrato"],
    ["¡Hola! Arregla el login en Safari", "Arregla el login en Safari"],
    ["¿Puedes revisar el contrato de Acme?", "Puedes revisar el contrato de Acme"],
    // Tom de pele, bandeira e controle saem; a maiúscula que vira duas letras não passa dos 40.
    ["👍🏽 refazer o hero 🇧🇷", "Refazer o hero"],
    ["\u202Erefazer o hero", "Refazer o hero"],
    [`ß${"a".repeat(39)}`, `ß${"a".repeat(39)}`],
    // O "Abrir task com isto" da fala (ADR-113): o título é o assunto citado, não o pedido.
    ["Abre uma task com isto: «O deploy de ontem quebrou o login do app quando a…»", "O deploy de ontem quebrou"],
    ["Abre uma task com isto.", "Abre uma task com isto"],
  ])("%j → %j", (texto, esperado) => {
    expect(tituloProvisorio(texto)).toBe(esperado);
  });

  it.each([["https://github.com/gamefik/nod/pull/391"], ["www.exemplo.com/x"], ["🎉🎉"], ["👍🏽"], ["??"], ["..."], [""], ["   \n  "], ["Oi"], ["bom dia!"], ["¡Hola!"], ["Buenas"]])("sem letra depois de limpar (%j) → reserva", (texto) => {
    expect(tituloProvisorio(texto)).toBe(TITULO_PROVISORIO_RESERVA);
  });

  it("nunca passa de 6 palavras nem de 40 caracteres, nem é a mensagem crua de uma mensagem longa", () => {
    const longa = "Quero que você pesquise todos os concorrentes diretos da Acme no Brasil e monte uma tabela comparativa com preços";
    const t = tituloProvisorio(longa);
    expect(t).toBe("Quero que você pesquise todos"); // o "os" do fim é palavra de ligação e sai
    expect(t.split(" ").length).toBeLessThanOrEqual(PALAVRAS_TITULO_PROVISORIO);
    expect(t.length).toBeLessThanOrEqual(CARACTERES_TITULO_PROVISORIO);
    expect(tituloProvisorio("Supercalifragilisticexpialidocious".repeat(3))).toHaveLength(CARACTERES_TITULO_PROVISORIO);
    expect(tituloProvisorio("Supercalifragilisticexpialidocious espetacularmente grandioso")).toBe("Supercalifragilisticexpialidocious");
  });

  // Meio par substituto: alto sem baixo depois, ou baixo sem alto antes (String#isWellFormed é do ES2024, fora do lib).
  const SUBSTITUTO_SOLTO = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
  it("o corte nunca parte uma letra fora do plano básico ao meio (revisão do PR 5)", () => {
    // "x" + 30 "𝐀" (2 unidades UTF-16 cada): o corte em 40 cairia no meio do 20º "𝐀".
    const t = tituloProvisorio(`x${"𝐀".repeat(30)}`);
    expect(t).toBe(`X${"𝐀".repeat(19)}`);
    expect(t).not.toMatch(SUBSTITUTO_SOLTO);
    const linha = linhaCurta(`x${"𝐀".repeat(60)}`);
    expect(linha).not.toMatch(SUBSTITUTO_SOLTO);
    expect(linha.endsWith("…")).toBe(true);
  });

  // A mensagem da pessoa pode ser longa: tirar a pontuação do fim não pode ser quadrático numa sequência de pontuação
  // no meio ("a-----…-----b"), como seria com /[pontuação]+$/ (cada posição da sequência varre até o fim dela).
  it("é linear no tamanho da mensagem, também com uma sequência longa de pontuação no meio", PRAZO_GUARDA, () => {
    expect(razaoDeCrescimento((n) => `a${"-".repeat(n)}b`, tituloProvisorio, 4000)).toBeLessThan(RAZAO_MAXIMA_LINEAR);
    expect(razaoDeCrescimento((n) => `Oi, ${"refaça os roteiros, ".repeat(n / 20)}`, tituloProvisorio, 4000)).toBeLessThan(RAZAO_MAXIMA_LINEAR);
    // Revisão do PR 5: muitas orações sem letra ("1. 1. …", cada uma é pulada; medido em 2026-10-18: razão 16 com o laço
    // relendo do começo a cada oração), cercas, citações e colchetes sem par.
    expect(razaoDeCrescimento((n) => `${"1. ".repeat(n / 3)}fim`, tituloProvisorio, 4000)).toBeLessThan(RAZAO_MAXIMA_LINEAR);
    expect(razaoDeCrescimento((n) => `${"```\n> a\n".repeat(n / 8)}`, tituloProvisorio, 4000)).toBeLessThan(RAZAO_MAXIMA_LINEAR);
    expect(razaoDeCrescimento((n) => `Oi ${"[".repeat(n)}](x`, tituloProvisorio, 4000)).toBeLessThan(RAZAO_MAXIMA_LINEAR);
  });
  it("slug sem acento nem símbolo, com o começo do id: o mesmo título nunca dá a mesma pasta", () => {
    expect(slugDoTrabalho("Revisão do PR #481!", "ABCDEF12-0000")).toBe("revisao-do-pr-481-abcdef");
    expect(pastaDoTrabalho("Ada", "Login", "111111aa")).not.toBe(pastaDoTrabalho("Ada", "Login", "222222bb"));
    expect(slugDoTrabalho("!!!", "c0ffee99")).toBe("task-c0ffee");
    expect(pastaRelativa("~/nod/Ada/login-111111")).toBe("Ada/login-111111");
    expect(pastaRelativa("/tmp/x")).toBeNull();
  });
});

describe("quem abre e quem repassa (#193)", () => {
  it("a conversa e a task de rotina sem mãe abrem; a filha da rotina, a da pessoa, a de colega e a da rede não", () => {
    expect(podeAbrirTask(null)).toBe(true);
    expect(podeAbrirTask({ origem: "rotina", trabalhoMaeId: null })).toBe(true);
    expect(podeAbrirTask({ origem: "rotina", trabalhoMaeId: "mae" })).toBe(false);
    // ADA-232 × ADA-16 (ADR-163): o trabalho da tarefa do quadro abre frentes, como o turno da tarefa abria antes.
    expect(podeAbrirTask({ origem: "quadro", trabalhoMaeId: null })).toBe(true);
    for (const origem of ["pessoa", "colega", "rede"] as const) expect(podeAbrirTask({ origem, trabalhoMaeId: null })).toBe(false);
    expect(podeMandarParaTask(null)).toBe(true);
    expect(podeMandarParaTask({ origem: "rotina" })).toBe(false);
  });
});

describe("promoveNaRede (rede de 2 min)", () => {
  const ok = { origem: "conversa" as const, trabalhoId: null, estado: "despachando" as const, despachadoHaMs: REDE_MS, fezFerramenta: true, capacidades: CAPACIDADES_HARNESS["claude-cli"] };
  it("promove só o turno do dono rodando há 2 min, com ferramenta", () => {
    expect(promoveNaRede(ok)).toBe(true);
    expect(promoveNaRede({ ...ok, despachadoHaMs: REDE_MS - 1 })).toBe(false);
    expect(promoveNaRede({ ...ok, fezFerramenta: false })).toBe(false);
    expect(promoveNaRede({ ...ok, trabalhoId: "w" })).toBe(false);
    expect(promoveNaRede({ ...ok, estado: "pendente" })).toBe(false);
    for (const origem of ["sala", "rotina", "delegacao", "retomada", "ligacao", "peer"] as const) expect(promoveNaRede({ ...ok, origem })).toBe(false);
  });
  it("ADR-099 (I8): a retomada do dono em modo conversa também; a de rotina, colega, sala ou sem modo, não", () => {
    expect(promoveNaRede({ ...ok, origem: "retomada", modo: "conversa" })).toBe(true);
    for (const modo of ["rotina", "delegacao", "peer", "sala", "ligacao", "criacao", null, undefined] as const) expect(promoveNaRede({ ...ok, origem: "retomada", modo })).toBe(false);
    // O modo não muda nada para o turno da fala da pessoa.
    expect(promoveNaRede({ ...ok, modo: "criacao" })).toBe(true);
  });
  it("ADR-099 (I8): as três combinações de capacidade — bifurca promove; nem retoma promove; retoma sem bifurcar, não", () => {
    const comoClaude = { ...SEM_CAPACIDADES, retomaSessao: true, bifurcaSessao: true };
    const comoCodex = { ...SEM_CAPACIDADES, retomaSessao: false, bifurcaSessao: false };
    const retomaSemBifurcar = { ...SEM_CAPACIDADES, retomaSessao: true, bifurcaSessao: false };
    expect(promoveNaRede({ ...ok, capacidades: comoClaude })).toBe(true);
    expect(promoveNaRede({ ...ok, capacidades: comoCodex })).toBe(true);
    expect(promoveNaRede({ ...ok, capacidades: retomaSemBifurcar })).toBe(false);
    // Os harnesses de hoje, pelas capacidades declaradas (nunca pelo nome): Codex e o desconhecido promovem com o histórico.
    expect(promoveNaRede({ ...ok, capacidades: CAPACIDADES_HARNESS["codex-cli"] })).toBe(true);
    expect(promoveNaRede({ ...ok, capacidades: SEM_CAPACIDADES })).toBe(true);
  });
  it("o prazo do e2e (redeMs) troca só o limite de tempo; ausente vale REDE_MS", () => {
    expect(promoveNaRede({ ...ok, despachadoHaMs: 3_000, redeMs: 3_000 })).toBe(true);
    expect(promoveNaRede({ ...ok, despachadoHaMs: 2_999, redeMs: 3_000 })).toBe(false);
    expect(promoveNaRede({ ...ok, despachadoHaMs: 3_000, redeMs: 3_000, capacidades: { ...SEM_CAPACIDADES, retomaSessao: true } })).toBe(false);
    expect(promoveNaRede({ ...ok, despachadoHaMs: 3_000 })).toBe(false);
  });
});

describe("seguimentoNaRede (ADR-099, I8: como o dono segue depois da promoção)", () => {
  it("bifurca só com o harness E a máquina; sem a máquina, larga a sessão; sem retomar, segue com o histórico", () => {
    expect(seguimentoNaRede(CAPACIDADES_HARNESS["claude-cli"], true)).toBe("bifurcar");
    expect(seguimentoNaRede(CAPACIDADES_HARNESS["claude-cli"], false)).toBe("largar_sessao");
    expect(seguimentoNaRede(CAPACIDADES_HARNESS["codex-cli"], true)).toBe("bifurcar");
    expect(seguimentoNaRede(CAPACIDADES_HARNESS["codex-cli"], false)).toBe("largar_sessao");
    expect(seguimentoNaRede(SEM_CAPACIDADES, true)).toBe("historico");
    expect(seguimentoNaRede({ retomaSessao: true, bifurcaSessao: false }, true)).toBe("largar_sessao");
  });
});

describe("esperaDoTrabalho (ADR-099, parte 1: esperar não é trabalhar)", () => {
  const rodando = { estado: "rodando" as const, turnoVivoId: null };
  const colega = { nome: "Ze 1", desde: 1, trabalhoId: null };
  it.each([
    ["volta marcada, sem turno vivo", { ...rodando, acordaEm: 2_000 }, "volta"],
    ["esperando colega, sem turno vivo", { ...rodando, esperandoColega: colega }, "colega"],
    ["colega e volta juntos: o colega", { ...rodando, esperandoColega: colega, acordaEm: 2_000 }, "colega"],
    ["com turno vivo trabalha, mesmo com a volta ou o colega", { ...rodando, turnoVivoId: "t", esperandoColega: colega, acordaEm: 2_000 }, null],
    ["rodando sem nada a esperar (retomada na fila)", rodando, null],
    ["precisa de você não é espera", { ...rodando, estado: "precisa_de_voce" as const, acordaEm: 2_000 }, null],
    ["na fila não é espera", { ...rodando, estado: "na_fila" as const, esperandoColega: colega }, null],
  ])("%s", (_nome, t, esperado) => {
    expect(esperaDoTrabalho(t)).toBe(esperado);
  });
});
