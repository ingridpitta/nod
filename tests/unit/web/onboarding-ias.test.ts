import { describe, expect, it } from "vitest";
import type { TesteDeIa } from "../../../src/contracts/desktop.ts";
import type { EstadoIa } from "../../../src/contracts/estado-ia.ts";
import type { EstadoOnboarding } from "../../../src/contracts/onboarding.ts";
import { UI_IAS_INICIAL, type UiIas } from "../../../web/telas/cartao-ia.ts";
import { htmlExecutor, type TesteNaTela } from "../../../web/telas/onboarding.ts";

/**
 * Tela 5 do plano das IAs (protótipo Onboarding, 2026-10-09): dentro do app do Mac com a ponte `ias`, a etapa "A IA dos
 * seus bots" é o mesmo cartão de Provedores de IA. O app já procurou; instalar, entrar e testar acontecem dentro do
 * cartão; a falha fica no passo, em âmbar; com uma IA pronta, a dica sugere a segunda.
 */
const dados = { etapa: "executor", mostrar: true, executor: { pronto: false, ias: [] } } as unknown as EstadoOnboarding;
const teste = (p: Partial<TesteNaTela> = {}): TesteNaTela => ({ rodando: false, vereditos: {}, testando: [], conexao: null, seguindo: false, nome: null, ...p });
const e = (ia: EstadoIa["ia"], estado: EstadoIa["estado"], extra: Partial<EstadoIa> = {}): EstadoIa => ({ ia, estado, mensagem: "", em: 0, ...extra });
const ui = (estados: Partial<Record<EstadoIa["ia"], EstadoIa>>, p: Partial<UiIas> = {}): UiIas => ({ ...UI_IAS_INICIAL, noApp: true, estados, ...p });
const tela = (iasMac: UiIas, t: TesteNaTela = teste()) => htmlExecutor({ dados, procurando: false, iaEntrando: null, notaIa: null, teste: t, iasMac });
const RESPONDEU: TesteDeIa = { ia: "claude-cli", estado: "pronto", resposta: "Oi!" };

describe("onboarding com o cartão de IA", () => {
  it("enquanto o Mac não respondeu a sonda: só 'Procurando o Claude e o ChatGPT neste Mac…'", () => {
    const h = tela(ui({}), teste({ rodando: true }));
    expect(h).toContain("Procurando o Claude e o ChatGPT neste Mac…");
    expect(h).not.toContain("ob-card-ia");
  });

  it("Claude pronto e respondeu, ChatGPT fora: 'Seus bots já têm uma IA', 'Instalar e entrar' em contorno, a dica da segunda e 'Continuar com o Claude'", () => {
    const h = tela(ui({ "claude-cli": e("claude-cli", "pronta"), "codex-cli": e("codex-cli", "nao_instalada") }), teste({ vereditos: { "claude-cli": RESPONDEU } }));
    expect(h).toContain("Seus bots já têm uma IA");
    expect(h).toContain("Conectado · respondeu ao teste");
    expect(h).toContain('<button type="button" class="ob-pilula contorno" data-act="ia-instalar" data-ia="codex-cli">Instalar e entrar</button>');
    expect(h).toContain("Dica: conecte as duas. Se uma chegar ao limite, a outra assume.");
    expect(h).toMatch(/data-act="onboarding-ia-continuar">Continuar com o Claude</);
    expect(h).not.toContain("ia-verificar");
  });

  it("nenhuma IA: os dois botões cheios e o Continuar desligado", () => {
    const h = tela(ui({ "claude-cli": e("claude-cli", "nao_instalada"), "codex-cli": e("codex-cli", "nao_instalada") }));
    expect(h).toContain("A IA dos seus bots");
    expect(h.match(/class="ob-pilula" data-act="ia-instalar"/g)).toHaveLength(2);
    expect(h).toMatch(/data-act="onboarding-ia-continuar" disabled>Continuar</);
    expect(h).toContain("Conecte pelo menos uma IA para seus bots começarem.");
  });

  it("Claude instalado, falta entrar: 'Entrar'; o teste do onboarding gira no cartão quando a IA fica pronta", () => {
    expect(tela(ui({ "claude-cli": e("claude-cli", "falta_entrar"), "codex-cli": e("codex-cli", "nao_instalada") }))).toContain('data-act="ia-entrar" data-ia="claude-cli">Entrar<');
    const h = tela(ui({ "claude-cli": e("claude-cli", "pronta"), "codex-cli": e("codex-cli", "nao_instalada") }), teste({ testando: ["claude-cli"] }));
    expect(h).toContain("Encontrado · testando a resposta");
  });

  it("a instalação do ChatGPT falha: o cartão fica âmbar, o passo diz o motivo e oferece 'Tentar de novo'", () => {
    const falhou = e("codex-cli", "nao_instalada", { instalacao: { fase: "falhou", linha: null, tentativa: 2, causa: "sem_internet", mensagem: "Não deu para instalar: sem conexão com a internet.", registro: "x.log" } });
    const h = tela(ui({ "claude-cli": e("claude-cli", "pronta"), "codex-cli": falhou }, { fluxo: { "codex-cli": { instalar: true } } }), teste({ vereditos: { "claude-cli": RESPONDEU } }));
    expect(h).toContain('<div class="ob-card-ia aberto aviso">');
    expect(h).toContain("Não deu para instalar: sem conexão com a internet.");
    expect(h).toContain('data-act="ia-instalar" data-ia="codex-cli">Tentar de novo');
    expect(h).toContain("Precisa de ajuda?");
  });

  it("as duas responderam: a ordem final em uma linha e o 'Continuar'", () => {
    const h = tela(ui({ "claude-cli": e("claude-cli", "pronta"), "codex-cli": e("codex-cli", "pronta") }), teste({ vereditos: { "claude-cli": RESPONDEU, "codex-cli": { ia: "codex-cli", estado: "pronto" } } }));
    expect(h).toContain('<div class="ordem-final"><span>Seus bots usam</span>');
    expect(h).toContain("<span>e, se ele parar,</span>");
    expect(h).toMatch(/data-act="onboarding-ia-continuar">Continuar</);
  });

  it("sem a ponte `ias` (app antigo), as telas de 2026-10-05 continuam", () => {
    const h = htmlExecutor({ dados, procurando: false, iaEntrando: null, notaIa: null, teste: teste(), iasMac: { ...UI_IAS_INICIAL } });
    expect(h).not.toContain('data-act="ia-instalar"');
  });
});
