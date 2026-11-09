import { describe, expect, it } from "vitest";
import type { ContasNaTela, PonteContas } from "../../../src/contracts/desktop.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { criarContasDoMac, NOTA_LOGOUT_FALHOU } from "../../../web/lib/contas-do-mac.ts";
import { htmlDoAvisoDosTermos, TERMOS_DA_TROCA } from "../../../web/telas/aviso-termos.ts";
import { UI_IAS_INICIAL, type UiIas } from "../../../web/telas/cartao-ia.ts";
import { planoNaTela, renderContasDaIa } from "../../../web/telas/contas-ia.ts";
import { fraseDoMotivoDaNota, linhaContaSeguiu, linhaContaTrocada, linhaLimiteSemOutra } from "../../../web/telas/ia-fora.ts";

/** ADR-101 (2026-10-12, NOD-211): as contas em Provedores de IA e as linhas do limite na conversa (protótipo v3). */
const AGORA = 1_760_000_000_000;
const HORA = 3_600_000;
const conta = (posicao: number, extra: Partial<ContasNaTela["contas"][number]> = {}): ContasNaTela["contas"][number] => ({
  posicao, apelido: "", plano: "max", corporativa: false, entraNaTrocaAutomatica: false, entraNaTroca: true, noLimiteAte: null, emUso: false, principal: false, ...extra,
});
const TRES: ContasNaTela = {
  ia: "claude-cli",
  modo: "perguntar",
  contas: [conta(1, { apelido: "Pessoal", emUso: true, principal: true }), conta(2, { apelido: "Lumen", plano: "team", corporativa: true }), conta(3, { apelido: "Reserva", plano: "pro" })],
  adicionando: null,
  max: 6,
};
const ui = (extra: Partial<UiIas> = {}): UiIas => ({ ...UI_IAS_INICIAL, noApp: true, contas: { "claude-cli": TRES }, ...extra });

describe("renderContasDaIa", () => {
  it("fora do app, ou com uma conta só e a IA desconectada, não aparece", () => {
    expect(renderContasDaIa("claude-cli", ui({ noApp: false }), AGORA, true)).toBe("");
    expect(renderContasDaIa("claude-cli", ui({ contas: { "claude-cli": { ...TRES, contas: [conta(1, { principal: true })] } } }), AGORA, false)).toBe("");
  });

  it("a lista na ordem, a corporativa com selo (sem opt-in, NOD-308), o modo padrão e a nota de privacidade", () => {
    const html = renderContasDaIa("claude-cli", ui(), AGORA, true);
    expect(html.indexOf("Pessoal")).toBeLessThan(html.indexOf("Lumen"));
    expect(html).toContain('<span class="selo">Corporativa</span>');
    expect(html).not.toContain("Fora da troca automática");
    // v4: em "Perguntar antes" a caixa não aparece (só muda algo com "Trocar sozinho")
    expect(html).not.toContain("data-conta-optin");
    expect(html).toMatch(/value="perguntar" data-conta-modo="claude-cli" checked/);
    expect(html).toContain("Perguntar antes de trocar (padrão)");
    expect(html).toContain("+ Adicionar outra conta");
    expect(html).toContain("O servidor do nod não os recebe");
    // a principal não sai pela lista; ▲ da primeira e ▼ da última desligados
    expect(html).toMatch(/data-act="conta-remover" data-ia="claude-cli" data-posicao="1"[^>]*disabled/);
    expect(html).toMatch(/data-act="conta-mover" data-ia="claude-cli" data-posicao="1" data-para="0"[^>]*disabled/);
    expect(html).toMatch(/data-act="conta-mover" data-ia="claude-cli" data-posicao="3" data-para="4"[^>]*disabled/);
  });

  it("em Trocar sozinho (NOD-308), a corporativa fica só com o selo, sem caixa nem texto de fora; no limite, diz até quando", () => {
    const c: ContasNaTela = { ...TRES, modo: "automatico", contas: TRES.contas.map((x) => (x.posicao === 1 ? { ...x, emUso: false, noLimiteAte: AGORA + 2 * HORA } : x.posicao === 3 ? { ...x, emUso: true } : x)) };
    const html = renderContasDaIa("claude-cli", ui({ contas: { "claude-cli": c } }), AGORA, true);
    expect(html).not.toContain("Fora da troca automática");
    expect(html).not.toContain("data-conta-optin");
    expect(html).not.toContain("nunca troca sozinho para esta conta");
    expect(html).not.toContain("Contas corporativas não marcadas ficam de fora");
    expect(html).toContain('<span class="selo">Corporativa</span>');
    expect(html).toContain("No limite até");
    expect(html).toMatch(/value="automatico" data-conta-modo="claude-cli" checked/);
  });

  it("adicionando: o formulário do apelido, depois o login em andamento com Cancelar", () => {
    expect(renderContasDaIa("claude-cli", ui({ contaNova: { "claude-cli": "Le" } }), AGORA, true)).toMatch(/data-form="conta-nova"[\s\S]*value="Le"/);
    const html = renderContasDaIa("claude-cli", ui({ contas: { "claude-cli": { ...TRES, adicionando: { apelido: "Lumen 2" } } } }), AGORA, true);
    expect(html).toContain("Entrando na conta nova (Lumen 2)");
    expect(html).toContain('data-act="ia-cancelar"');
  });

  // QA do NOD-211 (2026-10-12): a adição que falhava sumia calada; agora fica o erro com "Tentar de novo" (mesmo apelido) e "Cancelar".
  it("a adição falhou: o erro, Tentar de novo com o apelido e Cancelar, no lugar do + Adicionar", () => {
    const html = renderContasDaIa("claude-cli", ui({ contas: { "claude-cli": { ...TRES, adicaoFalhou: { apelido: "Lumen 2" } } } }), AGORA, true);
    expect(html).toContain('role="alert"');
    expect(html).toContain("O login da conta nova não terminou");
    expect(html).toMatch(/data-act="conta-tentar-de-novo" data-ia="claude-cli" data-apelido="Lumen 2"/);
    expect(html).toContain('data-act="conta-falha-fechar"');
    expect(html).not.toContain('data-act="conta-form-abrir"');
  });

  // QA do NOD-211: a 2ª conta entrando, com o cartão ainda sem a conta lida — o estado de carregamento e o Cancelar ficam.
  it("adicionando a segunda conta com a IA momentaneamente sem conta lida: o login em andamento continua na tela", () => {
    const uma: ContasNaTela = { ...TRES, contas: [conta(1, { principal: true, emUso: true })], adicionando: { apelido: "" } };
    const html = renderContasDaIa("claude-cli", ui({ contas: { "claude-cli": uma } }), AGORA, false);
    expect(html).toContain("Entrando na conta nova.");
    expect(html).toContain('data-act="ia-cancelar"');
  });

  it("o plano na tela", () => {
    expect(planoNaTela("claude_max")).toBe("Max");
    expect(planoNaTela("team")).toBe("Team");
  });
});

const autoria = { autor_tipo: "agente" as const, autor_id: "b", sob_procuracao_de: null, conta_de_execucao: "p", executor: "local" as const, locality: "local" as const, locality_reason: "motor_ausente" as const, machine_id: null, decidido_por: "regra:localidade" as const, regra_versao: 1 };
const msg = (texto: string, payload: Mensagem["payload"]): Mensagem => ({ tenantId: "t", id: "m1", conversaId: "c1", turnoId: "t1", autoria, kind: "sistema", texto, payload, confianca: "confiavel", parcial: false, criadoEm: AGORA });
const p = (u: UiIas) => ({ nomeDoBot: "Frida", agenteId: "b", agora: AGORA, ui: u, ias: null, fixa: false });

describe("a conversa no limite de uma conta", () => {
  const perguntar = msg("Conta 1 do Claude Code no limite até 14:00. Seguir com a conta 2 ou 3?", { kind: "limite_do_plano", harness: "claude-cli", voltaEm: AGORA + 2 * HORA, conta: { tipo: "perguntar", de: 1, livres: [2, 3], foraDaTroca: [], voltaEm: AGORA + 2 * HORA } });

  it("Perguntar antes: a frase e um botão por conta livre, no app", () => {
    const html = linhaLimiteSemOutra(perguntar, p(ui())) ?? "";
    expect(html).toContain("Seguir com a conta 2 ou 3?");
    expect(html).toContain('data-act="conta-usar" data-ia="claude-cli" data-posicao="2">Seguir com a conta 2</button>');
    expect(html).toContain('data-posicao="3">Seguir com a conta 3</button>');
    expect(html).not.toContain("Lumen");
  });

  it("fora do app, aponta o app do Mac; escolhida, diz com qual seguiu", () => {
    expect(linhaLimiteSemOutra(perguntar, p({ ...UI_IAS_INICIAL }))).toContain("Escolha a conta no app do nod no Mac");
    const escolheu: ContasNaTela = { ...TRES, contas: TRES.contas.map((x) => ({ ...x, emUso: x.posicao === 2 })) };
    expect(linhaLimiteSemOutra(perguntar, p(ui({ contas: { "claude-cli": escolheu } })))).toContain("Seguindo com a conta 2 · mande a mensagem de novo");
  });

  it("uma mensagem antiga com conta fora da troca ainda oferece a conta e a espera, sem o ramo corporativo removido", () => {
    const soCorporativa = msg("Conta 1 do Claude Code no limite até 14:00. A conta 2 está fora da troca automática. Seguir com a conta 2?", { kind: "limite_do_plano", harness: "claude-cli", voltaEm: AGORA + 2 * HORA, conta: { tipo: "perguntar", de: 1, livres: [2], foraDaTroca: [2], voltaEm: AGORA + 2 * HORA } });
    const html = linhaLimiteSemOutra(soCorporativa, p(ui({ estados: { "codex-cli": { ia: "codex-cli", estado: "falta_entrar", mensagem: "", em: 0 } } } as Partial<UiIas>))) ?? "";
    expect(html).toContain('data-posicao="2">Seguir com a conta 2</button>');
    expect(html).not.toContain("ChatGPT");
    expect(html).toMatch(/ou esperar a conta voltar (às|em \d\d\/\d\d às) \d\d:\d\d/);
  });

  it("todas no limite: a frase do servidor, sem botão de conta", () => {
    const m = msg("Todas as contas do Claude Code estão no limite. A primeira volta às 14:00.", { kind: "limite_do_plano", harness: "claude-cli", voltaEm: AGORA + 2 * HORA, conta: { tipo: "todas_no_limite", noLimite: [1, 2], voltaEm: AGORA + 2 * HORA } });
    const html = linhaLimiteSemOutra(m, p(ui())) ?? "";
    expect(html).toContain("Todas as contas do Claude Code estão no limite");
    expect(html).not.toContain("conta-usar");
  });

  it("Trocar sozinho: uma linha discreta, só com posições", () => {
    const m = msg("Conta 1 do Claude Code no limite até 14:00. Seguindo com a conta 3 (conta 2 fora da troca automática).", { kind: "conta_trocada", harness: "claude-cli", de: 1, para: 3, voltaEm: AGORA + 2 * HORA, foraDaTroca: [2] });
    expect(linhaContaTrocada(m)).toContain("Seguindo com a conta 3 (conta 2 fora da troca automática).");
    expect(linhaContaTrocada(perguntar)).toBeNull();
  });
});

describe("criarContasDoMac", () => {
  function montar(confirma: boolean) {
    let estado: UiIas = ui();
    const chamadas: string[] = [];
    const confirmacoes: string[] = [];
    const avisos: string[] = [];
    const contas: Partial<PonteContas> = {
      definirModo: async (_ia, modo) => { chamadas.push(`modo ${modo}`); return { ...TRES, modo }; },
      usar: async (_ia, pos) => { chamadas.push(`usar ${pos}`); return { ...TRES, contas: TRES.contas.map((x) => ({ ...x, emUso: x.posicao === pos })) }; },
      remover: async (_ia, pos) => { chamadas.push(`remover ${pos}`); return { contas: { ...TRES, contas: TRES.contas.filter((x) => x.posicao !== pos) }, logout: false }; },
      adicionar: async (_ia, apelido) => { chamadas.push(`adicionar ${apelido}`); return true; },
    };
    const c = criarContasDoMac({
      mac: () => ({ contas: contas as PonteContas }),
      ui: () => estado,
      mudar: (m) => { estado = { ...estado, ...m }; },
      confirmar: (t) => { confirmacoes.push(t); return confirma; },
      avisarTermos: async (ia) => { avisos.push(ia); return confirma; },
    });
    return { c, chamadas, confirmacoes, avisos, estado: () => estado };
  }

  it("ligar o Trocar sozinho mostra o aviso dos termos; recusado, nada muda; desligar é direto", async () => {
    const recusa = montar(false);
    await recusa.c.definirModo("claude-cli", "automatico");
    expect(recusa.avisos).toEqual(["claude-cli"]);
    expect(recusa.chamadas).toEqual([]);
    const aceita = montar(true);
    await aceita.c.definirModo("claude-cli", "automatico");
    expect(aceita.chamadas).toEqual(["modo automatico"]);
    await aceita.c.definirModo("claude-cli", "perguntar");
    expect(aceita.avisos).toHaveLength(1);
  });

  it("o aviso dos termos (v4, Gil): cada frase com a fonte certa, links, Cancelar primário e com foco", () => {
    const claude = htmlDoAvisoDosTermos("claude-cli");
    expect(claude).toContain("Trocar de conta sozinho no Claude Code?");
    expect(claude).toContain(TERMOS_DA_TROCA["claude-cli"].texto);
    expect(TERMOS_DA_TROCA["claude-cli"].texto).toContain("Pro e Max");
    expect(claude).toContain('href="https://code.claude.com/docs/en/legal-and-compliance"');
    expect(claude).toContain('href="https://www.anthropic.com/legal/consumer-terms"');
    expect(claude).toMatch(/<button class="bt pri" data-nao type="button" autofocus>Cancelar<\/button>/);
    expect(claude).toMatch(/<button class="bt" data-sim type="button">Ligar mesmo assim<\/button>/);
    const codex = htmlDoAvisoDosTermos("codex-cli");
    expect(codex).toContain("Os Termos de Uso da OpenAI proíbem contornar limites de uso");
    expect(codex).toContain('href="https://openai.com/policies/terms-of-use/"');
    expect(codex).not.toContain("Pro e Max");
  });

  it("Seguir com a conta 2 deixa a nota de mandar de novo", async () => {
    const t = montar(true);
    expect(await t.c.usar("claude-cli", 2)).toBe(true);
    expect(t.estado().nota["claude-cli"]).toContain("Mande a mensagem de novo");
    expect(t.estado().contas["claude-cli"]?.contas[1]?.emUso).toBe(true);
  });

  it("remover pede confirmação, não remove a principal e avisa quando o logout falhou", async () => {
    const t = montar(true);
    await t.c.remover("claude-cli", 1);
    expect(t.chamadas).toEqual([]);
    await t.c.remover("claude-cli", 2);
    expect(t.confirmacoes.at(-1)).toContain("Remover a conta Lumen?");
    expect(t.chamadas).toEqual(["remover 2"]);
    expect(t.estado().nota["claude-cli"]).toBe(NOTA_LOGOUT_FALHOU);
    await expect(montar(false).c.remover("claude-cli", 2)).resolves.toBeUndefined();
  });

  it("adicionar fecha o formulário e começa o login com o apelido", async () => {
    const t = montar(true);
    t.c.abrirForm("claude-cli");
    expect(t.estado().contaNova["claude-cli"]).toBe("");
    await t.c.adicionar("claude-cli", "  Lumen ");
    expect(t.chamadas).toEqual(["adicionar Lumen"]);
    expect(t.estado().contaNova["claude-cli"]).toBeUndefined();
  });
});

describe("a conversa no limite de uma conta da lista (ADR-102, CMD-1)", () => {
  const nota = msg("Claude · Pessoal no limite na vm-bots até 14:00. Seguir com Claude · Lumen?", {
    kind: "limite_do_plano", harness: "claude-cli", voltaEm: AGORA + 2 * HORA,
    contas: {
      de: { id: "c1", apelido: "Pessoal", ia: "claude-cli" },
      livres: [
        { id: "c2", apelido: "Lumen", ia: "claude-cli", naMaquina: true, outraMaquina: null },
        { id: "c3", apelido: "<img src=x>", ia: "claude-cli", naMaquina: false, outraMaquina: { id: "m2", nome: "MacBook" } },
      ],
      maquina: { id: "m1", nome: "vm-bots" },
      voltaEm: AGORA + 2 * HORA,
    },
  });

  it("um passo por saída: seguir com a conta da máquina, rodar no outro, entrar com ela aqui, ou esperar", () => {
    const html = linhaLimiteSemOutra(nota, p(ui())) ?? "";
    // NOD-284: todo passo leva o turno da nota.
    expect(html).toContain('data-act="cl-seguir" data-id="c2" data-conversa="c1" data-turno="t1">Seguir com Claude · Lumen</button>');
    expect(html).toContain('data-act="rodar-desta-vez" data-conversa="c1" data-maquina="m2" data-turno="t1">Rodar no MacBook desta vez</button>');
    // NOD-280: "Tentar de novo" com a conta que bateu no limite.
    expect(html).toContain('data-act="cl-tentar-de-novo" data-id="c1" data-conversa="c1" data-turno="t1">Tentar de novo com Pessoal</button>');
    expect(html).toContain('data-act="cl-entrar-chat" data-id="c3" data-ia="claude-cli"');
    expect(html).toContain("na vm-bots</button>");
    expect(html).toMatch(/ou esperar até \d\d:\d\d/);
    // O apelido é da pessoa, mas passa escapado.
    expect(html).not.toContain("<img");
  });

  it("re-QA A4 (m25): conta livre que não está em máquina nenhuma ainda ganha 'Entrar com' aqui", () => {
    const sem = msg("Claude · Pessoal no limite.", {
      kind: "limite_do_plano", harness: "claude-cli", voltaEm: null,
      contas: {
        de: { id: "c1", apelido: "Pessoal", ia: "claude-cli" },
        livres: [{ id: "c6", apelido: "Nova", ia: "claude-cli", naMaquina: false, outraMaquina: null }],
        maquina: { id: "m1", nome: "vm-bots" },
        voltaEm: null,
      },
    });
    const html = linhaLimiteSemOutra(sem, p(ui())) ?? "";
    expect(html).toContain('data-act="cl-entrar-chat" data-id="c6"');
    expect(html).toContain("Entrar com Claude · Nova na vm-bots");
    expect(html).not.toContain("rodar-desta-vez");
  });

  it("NOD-280: um 'Rodar no X' por máquina, 'Entrar com' por conta e nunca uma conta de outra IA (NOD-224)", () => {
    const outra = msg("Claude · Pessoal no limite.", {
      kind: "limite_do_plano", harness: "claude-cli", voltaEm: null,
      contas: {
        de: { id: "c1", apelido: "Pessoal", ia: "claude-cli" },
        livres: [
          { id: "c3", apelido: "A", ia: "claude-cli", naMaquina: false, outraMaquina: { id: "m2", nome: "MacBook" } },
          { id: "c4", apelido: "B", ia: "claude-cli", naMaquina: false, outraMaquina: { id: "m2", nome: "MacBook" } },
          { id: "c5", apelido: "GPT", ia: "codex-cli", naMaquina: true, outraMaquina: null },
        ],
        maquina: { id: "m1", nome: "vm-bots" },
        voltaEm: null,
      },
    });
    const html = linhaLimiteSemOutra(outra, p(ui())) ?? "";
    expect(html.match(/Rodar no MacBook desta vez/g)).toHaveLength(1);
    expect(html).toContain("Entrar com Claude · A na vm-bots");
    expect(html).toContain("Entrar com Claude · B na vm-bots");
    expect(html).not.toContain("c5");
    expect(html).toContain("Tentar de novo com Pessoal");
  });

  it("NOD-280: sem conta livre e sem prazo, a nota ainda oferece 'Tentar de novo'", () => {
    const so = msg("Claude · Pessoal no limite.", {
      kind: "limite_do_plano", harness: "claude-cli", voltaEm: null,
      contas: { de: { id: "c1", apelido: "Pessoal", ia: "claude-cli" }, livres: [], maquina: null, voltaEm: null },
    });
    expect(linhaLimiteSemOutra(so, p(ui())) ?? "").toContain('data-act="cl-tentar-de-novo" data-id="c1"');
  });

  it("NOD-284: o aviso diz por que a nota não refez; refeita, nada a avisar", () => {
    expect(fraseDoMotivoDaNota("ja_refeito")).toContain("já foi refeita");
    expect(fraseDoMotivoDaNota("maquina_sem_contato")).toContain("não responde");
    expect(fraseDoMotivoDaNota(null)).toBeNull();
  });

  it("as linhas de conta seguida e escolhida", () => {
    expect(linhaContaSeguiu(msg("Seguindo com Claude · Lumen.", { kind: "conta_escolhida", contaId: "c2", apelido: "Lumen", ia: "claude-cli" }))).toContain("Seguindo com Claude · Lumen.");
    expect(linhaContaSeguiu(msg("x", { kind: "parada", interrompidas: 0, nadaRodando: true }))).toBeNull();
  });
});
