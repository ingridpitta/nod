import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { IaDesktop, NodDesktop } from "../../../src/contracts/desktop.ts";
import type { EstadoIa } from "../../../src/contracts/estado-ia.ts";
import type { IaNoMac } from "../../../src/contracts/onboarding.ts";
import { CHIPS_OBJETIVO, htmlConversaTexto, nomeDoEmail } from "../../../web/telas/conversa-texto.ts";
import { criarEsteComputador, estadoDaTela, htmlEsteComputador, LOGIN_DEMOROU_MS, telaDaIa, type FonteIa } from "../../../web/telas/este-computador.ts";

/**
 * ADA-242 (spec onboarding-jornada-a §3–4, protótipo prancha-a 2a–2g): "Este computador" é uma função pura sobre o
 * estado da IA (Mac) ou o inventário do motor (Windows); a conversa por texto tem duas perguntas e chips.
 */
const mac = (estado: EstadoIa["estado"], extra: Partial<EstadoIa> = {}): FonteIa => ({ mac: { ia: "claude-cli", estado, mensagem: "", em: 0, ...extra } });
const login = (o: Partial<NonNullable<EstadoIa["login"]>>): EstadoIa["login"] => ({ fase: "aguardando", host: null, codigoDoDispositivo: null, pedeCodigo: false, codigoEnviado: false, expiraEm: null, verificarDeNovo: false, mensagem: "", ...o });
const inv = (estado: IaNoMac["estado"], extra: Partial<IaNoMac> = {}): FonteIa => ({ inventario: { id: "claude-cli", estado, ...extra } });

describe("estadoDaTela pelo estado do app (Mac)", () => {
  it("os sete estados do protótipo", () => {
    expect(telaDaIa(mac("pronta"), 0)).toBe("2a");
    expect(telaDaIa(mac("no_limite"), 0)).toBe("2a");
    expect(telaDaIa(mac("falta_entrar"), 0)).toBe("2b");
    expect(telaDaIa(mac("nao_instalada"), 0)).toBe("2c");
    expect(telaDaIa(mac("entrando", { login: login({}) }), 0)).toBe("2d");
    expect(telaDaIa(mac("nao_instalada", { instalacao: { fase: "falhou", mensagem: "" } as EstadoIa["instalacao"] }), 0)).toBe("2e");
    expect(telaDaIa(mac("entrando", { login: login({ verificarDeNovo: true }) }), 0)).toBe("2f");
    expect(telaDaIa(mac("falta_entrar", { login: login({ fase: "expirou" }) }), 0)).toBe("2f");
    expect(telaDaIa(mac("sem_acesso", { causa: "conta_sem_acesso" }), 0)).toBe("2g");
    expect(telaDaIa(mac("instalando"), 0)).toBe("instalando");
    expect(telaDaIa(mac("procurando"), 0)).toBe("procurando");
  });

  it("o login que passou do prazo vira 2f", () => {
    expect(telaDaIa({ ...mac("entrando", { login: login({}) }), aguardandoDesde: 0 }, LOGIN_DEMOROU_MS - 1)).toBe("2d");
    expect(telaDaIa({ ...mac("entrando", { login: login({}) }), aguardandoDesde: 0 }, LOGIN_DEMOROU_MS)).toBe("2f");
  });
});

describe("estadoDaTela pelo inventário (Windows)", () => {
  it("pronto, ausente, sem login, esperando, sem acesso, prazo e falha", () => {
    expect(telaDaIa(inv("pronto"), 0)).toBe("2a");
    expect(telaDaIa(inv("ausente"), 0)).toBe("2c");
    expect(telaDaIa(inv("nao_autenticado"), 0)).toBe("2b");
    expect(telaDaIa({ ...inv("nao_autenticado"), aguardandoDesde: 0 }, 1)).toBe("2d");
    expect(telaDaIa({ ...inv("nao_autenticado"), aguardandoDesde: 0 }, LOGIN_DEMOROU_MS)).toBe("2f");
    expect(telaDaIa(inv("nao_autenticado", { causa: "conta_sem_acesso" }), 0)).toBe("2g");
    expect(telaDaIa({ ...inv("ausente"), falhouInstalar: true }, 0)).toBe("2e");
  });

  it("a tela segue a IA pronta; senão a que está em foco; senão o Claude", () => {
    const fontes: Partial<Record<IaDesktop, FonteIa>> = { "claude-cli": inv("ausente"), "codex-cli": { inventario: { id: "codex-cli", estado: "pronto" } } };
    expect(estadoDaTela(fontes, 0)).toMatchObject({ tela: "2a", principal: "codex-cli" });
    expect(estadoDaTela({ "claude-cli": inv("ausente"), "codex-cli": { inventario: { id: "codex-cli", estado: "nao_autenticado" } } }, 0, "codex-cli")).toMatchObject({ tela: "2b", principal: "codex-cli" });
    expect(estadoDaTela({}, 0).principal).toBe("claude-cli");
  });
});

describe("htmlEsteComputador", () => {
  const vista = { agora: 0, emFoco: null, ocupado: false, colarCodigo: true, nota: null };
  it("2c: Instalar e entrar nas duas IAs e Pular por agora; 2a: Continuar e a conta", () => {
    const c = htmlEsteComputador({ ...vista, fontes: { "claude-cli": inv("ausente"), "codex-cli": { inventario: { id: "codex-cli", estado: "ausente" } } } });
    expect(c).toContain('data-estado="2c"');
    expect(c.match(/data-act="computador-instalar"/g)).toHaveLength(2);
    expect(c).toContain('data-act="computador-pular"');
    expect(c).toContain("Também funciona sozinho ou como reserva do Claude.");
    expect(c).not.toContain("Outras IAs");
    const a = htmlEsteComputador({ ...vista, fontes: { "claude-cli": mac("pronta", { conta: { email: "ana@x.com" } as EstadoIa["conta"] }) } });
    expect(a).toContain("O Claude já está aqui.");
    expect(a).toContain("Conectado como ana@x.com");
    expect(a).toContain('data-act="computador-continuar"');
  });

  it("2f: Conferir de novo, Abrir de novo e o campo do código só com a ponte do Mac; 2d: Cancelar no lugar de Pular", () => {
    const f = { "claude-cli": mac("entrando", { login: login({ verificarDeNovo: true }) }) };
    const comCampo = htmlEsteComputador({ ...vista, fontes: f });
    expect(comCampo).toContain('data-act="computador-conferir"');
    expect(comCampo).toContain('data-form="computador-codigo"');
    expect(htmlEsteComputador({ ...vista, colarCodigo: false, fontes: f })).not.toContain('data-form="computador-codigo"');
    const d = htmlEsteComputador({ ...vista, fontes: { "claude-cli": mac("entrando", { login: login({}) }) } });
    expect(d).toContain('data-act="computador-cancelar"');
    expect(d).not.toContain('data-act="computador-pular"');
  });

  it("escapa a conta vinda do CLI", () => {
    const h = htmlEsteComputador({ ...vista, fontes: { "claude-cli": mac("pronta", { conta: { email: "<img src=x>" } as EstadoIa["conta"] }) } });
    expect(h).not.toContain("<img src=x>");
  });
});

describe("criarEsteComputador", () => {
  function montar(ponte: Partial<NodDesktop> | undefined, inventario: IaNoMac[] = []) {
    const aoMudar = vi.fn();
    const reler = vi.fn(async () => undefined);
    let agora = 0;
    const c = criarEsteComputador({ ponte: () => ponte as NodDesktop | undefined, estadosMac: () => ({}), inventario: () => inventario, reler, agora: () => agora, aoMudar });
    return { c, reler, avancar: (ms: number) => { agora += ms; } };
  }

  it("só aparece no app e uma vez por máquina", async () => {
    expect(await montar(undefined).c.decidir()).toBe(false);
    const marcar = vi.fn(async () => undefined);
    const nova = montar({ iaEntrar: async () => ({ ok: true }), esteComputador: { jaViu: async () => false, marcar } });
    expect(await nova.c.decidir()).toBe(true);
    await nova.c.passar();
    expect(marcar).toHaveBeenCalledOnce();
    expect(await nova.c.decidir()).toBe(false);
    expect(await montar({ iaEntrar: async () => ({ ok: true }), esteComputador: { jaViu: async () => true, marcar } }).c.decidir()).toBe(false);
  });

  it("app sem a ponte do 'já vi' (ADR-157 §4): a tela aparece só enquanto a IA não estiver pronta", async () => {
    const antiga = { iaEntrar: async () => ({ ok: true as const }) };
    const pronta = montar(antiga, [{ id: "claude-cli", estado: "pronto" } as IaNoMac]);
    expect(await pronta.c.decidir()).toBe(false);
    expect(pronta.c.mostrar()).toBe(false);
    const ausente = montar(antiga, [{ id: "claude-cli", estado: "ausente" } as IaNoMac]);
    expect(await ausente.c.decidir()).toBe(true);
    expect(ausente.c.mostrar()).toBe(true);
    await ausente.c.passar();
    expect(await ausente.c.decidir()).toBe(false);
  });

  it("Windows: Instalar e entrar usa iaInstalar + iaEntrar, espera (2d) e relê o inventário; a falha da instalação vira 2e", async () => {
    const chamadas: string[] = [];
    const inventario: IaNoMac[] = [{ id: "claude-cli", estado: "ausente" }, { id: "codex-cli", estado: "ausente" }];
    const m = montar({ iaInstalar: async (ia) => { chamadas.push(`instalar ${ia}`); return { ok: true }; }, iaEntrar: async (ia) => { chamadas.push(`entrar ${ia}`); return { ok: true }; } }, inventario);
    await m.c.acoes["computador-instalar"]("claude-cli");
    expect(chamadas).toEqual(["instalar claude-cli", "entrar claude-cli"]);
    expect(m.c.estado().tela).toBe("2d");
    await m.c.sondar();
    expect(m.reler).toHaveBeenCalled();
    m.avancar(LOGIN_DEMOROU_MS);
    expect(m.c.estado().tela).toBe("2f");

    const falha = montar({ iaInstalar: async () => ({ ok: false, motivo: "falhou" }), iaEntrar: async () => ({ ok: true }) }, inventario);
    await falha.c.acoes["computador-instalar"]("claude-cli");
    expect(falha.c.estado().tela).toBe("2e");
  });

  it("Mac: a instalação que volta 'nao_instalada' (sem instalacao.fase falhou) vira 2e com Tentar de novo, não volta a 2c", async () => {
    const estados: Partial<Record<IaDesktop, EstadoIa>> = { "claude-cli": { ia: "claude-cli", estado: "nao_instalada", mensagem: "", em: 0 } };
    const entrar = vi.fn();
    const ias = { instalar: async () => estados["claude-cli"]!, entrar };
    const c = criarEsteComputador({ ponte: () => ({ ias } as unknown as NodDesktop), estadosMac: () => estados, inventario: () => [], reler: async () => undefined, agora: () => 0, aoMudar: () => undefined });
    await c.acoes["computador-instalar"]("claude-cli");
    expect(c.estado().tela).toBe("2e");
    expect(c.html()).toContain("Tentar de novo");
    expect(entrar).not.toHaveBeenCalled();
  });

  it("Windows: iaInstalar só abre a página; o CLI ainda ausente não vira erro de login, avisa e a sonda relê até instalar", async () => {
    const inventario: IaNoMac[] = [{ id: "claude-cli", estado: "ausente" }];
    let entrou = 0;
    const m = montar({ iaInstalar: async () => ({ ok: true }), iaEntrar: async () => (++entrou === 1 ? { ok: false, motivo: "nao_instalado" } : { ok: true }) }, inventario);
    await m.c.acoes["computador-instalar"]("claude-cli");
    const h = m.c.html();
    expect(h).not.toContain("Não deu para abrir o login");
    expect(h).toContain("Termine a instalação do Claude");
    expect(m.c.estado().tela).toBe("2c");
    await m.c.sondar();
    expect(m.reler).toHaveBeenCalled();
    // A instalação terminou: o inventário mostra o CLI sem login e a sonda segue para o login sozinha.
    inventario[0] = { id: "claude-cli", estado: "nao_autenticado" };
    await m.c.sondar();
    expect(entrou).toBe(2);
    expect(m.c.estado().tela).toBe("2d");
  });
});

describe("o CLI abaixo do piso (desatualizado) tem saída: atualizar, não só entrar", () => {
  it("Mac 'desatualizada' e Windows 'cli_antigo' não viram 2b; o botão atualiza e segue para o login", async () => {
    expect(telaDaIa(mac("desatualizada"), 0)).toBe("2c");
    expect(telaDaIa(inv("nao_autenticado", { causa: "cli_antigo" }), 0)).toBe("2c");
    const h = htmlEsteComputador({ agora: 0, emFoco: null, ocupado: false, colarCodigo: true, nota: null, fontes: { "claude-cli": mac("desatualizada") } });
    expect(h).toContain("Atualizar e entrar");
    expect(h).not.toContain('data-act="computador-entrar"');

    const chamadas: string[] = [];
    const estados: Partial<Record<IaDesktop, EstadoIa>> = { "claude-cli": { ia: "claude-cli", estado: "desatualizada", mensagem: "", em: 0 } };
    const ias = {
      instalar: async () => { chamadas.push("instalar"); return estados["claude-cli"]!; },
      atualizar: async () => { chamadas.push("atualizar"); return { ia: "claude-cli", estado: "falta_entrar", mensagem: "", em: 0 } as EstadoIa; },
      entrar: async () => { chamadas.push("entrar"); return estados["claude-cli"]!; },
    };
    const c = criarEsteComputador({ ponte: () => ({ ias } as unknown as NodDesktop), estadosMac: () => estados, inventario: () => [], reler: async () => undefined, agora: () => 0, aoMudar: () => undefined });
    await c.acoes["computador-instalar"]("claude-cli");
    expect(chamadas).toEqual(["atualizar", "entrar"]);
  });
});

describe("os formulários do onboarding chegam ao submit do documento", () => {
  it("todo form do controle (o nome, o objetivo escrito, o código do login) está no FORMS do web/main.ts", () => {
    const controle = readFileSync(new URL("../../../web/telas/onboarding-controle.ts", import.meta.url), "utf8");
    const bloco = controle.slice(controle.indexOf("const forms: Record<string"), controle.indexOf("\n  };", controle.indexOf("const forms: Record<string")));
    const chaves = [...bloco.matchAll(/^\s{4}"([a-z-]+)": \(form\)/gm)].map((m) => m[1]);
    expect(chaves).toEqual(expect.arrayContaining(["onboarding-bot", "computador-codigo", "texto-apelido", "texto-objetivo"]));
    const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
    const forms = main.slice(main.indexOf("const FORMS: Record<string"), main.indexOf("\n};", main.indexOf("const FORMS: Record<string")));
    const espalha = /\.\.\.[^\n]*telaOnboarding\.forms/.test(forms);
    for (const k of chaves) expect(espalha || forms.includes(`"${k}":`), `form ${k} sem tratador no FORMS`).toBe(true);
  });
});

describe("conversa por texto", () => {
  it("o nome sugerido sai do e-mail; sem nome, pergunta como chamar", () => {
    expect(nomeDoEmail("ana.souza@x.com")).toBe("Ana");
    expect(nomeDoEmail("12345@x.com")).toBeNull();
    expect(nomeDoEmail(null)).toBeNull();
    expect(htmlConversaTexto({ passo: "apelido" }, { sugestao: "Ana", ocupado: false, erro: null })).toContain("Posso te chamar de Ana?");
    expect(htmlConversaTexto({ passo: "apelido" }, { sugestao: null, ocupado: false, erro: null })).toContain("Como posso te chamar?");
  });

  it("a segunda pergunta tem os cinco chips e Pular as perguntas; sem tamanho do time", () => {
    const h = htmlConversaTexto({ passo: "objetivo", apelido: "Ana" }, { sugestao: "Ana", ocupado: false, erro: null });
    // Os cinco do protótipo (jornadas.html#a, OPCOES), com o texto exato.
    expect(CHIPS_OBJETIVO).toEqual(["Atender clientes por e-mail", "Organizar minha agenda", "Cuidar do financeiro", "Mexer em código", "Só quero olhar"]);
    expect(h.match(/data-act="texto-objetivo"/g)).toHaveLength(5);
    for (const c of CHIPS_OBJETIVO) expect(h).toContain(c);
    expect(h).toContain('data-act="texto-pular"');
    expect(h).not.toMatch(/quantas pessoas|tamanho/i);
  });
});

describe("copy por plataforma (redação do motor)", () => {
  it("as falhas da IA dizem 'neste computador', nunca 'neste Mac' (o app também roda no Windows)", async () => {
    const { motivoEmPortugues } = await import("../../../src/domain/redacao.ts");
    for (const m of ["lancamento_falhou", "motor_ausente", "nao_autenticado"]) {
      expect(motivoEmPortugues(m)).toContain("neste computador");
      expect(motivoEmPortugues(m)).not.toContain("Mac");
    }
  });
});
