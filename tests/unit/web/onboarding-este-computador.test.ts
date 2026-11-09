import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NodDesktop } from "../../../src/contracts/desktop.ts";
import type { EstadoOnboarding } from "../../../src/contracts/onboarding.ts";
import { criarTelaOnboarding, type DepsOnboarding } from "../../../web/telas/onboarding-controle.ts";

/**
 * ADA-242, aceite 6 da spec (docs/specs/onboarding-jornada-a.md): reinstalação limpa com o mesmo e-mail mostra
 * "Este computador" de novo; a conversa com o Nod não se repete. A etapa é por pessoa (já concluída); o "já vi" é
 * desta máquina.
 */
const concluido = { etapa: "concluido", mostrar: false, guia: null, executor: { pronto: false, ias: [] }, campos: {}, modelo: { app: { slug: "gmail" } } } as unknown as EstadoOnboarding;

function montar(ponte: Partial<NodDesktop> | undefined, dados: EstadoOnboarding = concluido, texto = true) {
  let aberto = false;
  const etapa = vi.fn();
  const abrir = vi.fn((v: boolean) => { aberto = v; });
  const deps = {
    api: () => ({ etapaOnboarding: etapa, onboarding: async () => dados }),
    dados: () => dados,
    aberto: () => aberto,
    hidratar: () => undefined,
    abrir,
    ligacao: { ativa: () => null, cheia: () => false, atenderOnboarding: () => false },
    garantirAgente: async () => true,
    irParaConversa: () => undefined,
    iniciarConexao: () => undefined,
    conectando: () => false,
    conectorHabilitado: async () => null,
    invalidar: () => undefined,
    erro: () => undefined,
    aoMudar: () => undefined,
    texto: () => texto,
  } as unknown as DepsOnboarding;
  (globalThis as { window?: unknown }).window = { nodDesktop: ponte, setTimeout, clearTimeout, setInterval, clearInterval };
  return { t: criarTelaOnboarding(deps), abrir, etapa };
}

describe("Este computador numa máquina nova, onboarding da pessoa já concluído", () => {
  const original = (globalThis as { window?: unknown }).window;
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); (globalThis as { window?: unknown }).window = original; });

  it("a máquina que não viu a tela abre só 'Este computador'; Continuar grava o já vi e fecha, sem mexer na etapa", async () => {
    const marcar = vi.fn(async () => undefined);
    const m = montar({ iaEntrar: async () => ({ ok: true }), esteComputador: { jaViu: async () => false, marcar } });
    await m.t.verificarMaquina();
    expect(m.abrir).toHaveBeenLastCalledWith(true);
    expect(m.t.camada()).toContain('aria-label="Este computador"');
    expect(m.t.cobre()).toBe(true);
    await m.t.acoes["computador-continuar"]!({ dataset: {} } as HTMLElement);
    expect(marcar).toHaveBeenCalledOnce();
    expect(m.abrir).toHaveBeenLastCalledWith(false);
    expect(m.etapa).not.toHaveBeenCalled();
  });

  it("a máquina que já viu, o navegador e a flag desligada não abrem nada", async () => {
    const ja = montar({ iaEntrar: async () => ({ ok: true }), esteComputador: { jaViu: async () => true, marcar: async () => undefined } });
    await ja.t.verificarMaquina();
    expect(ja.abrir).not.toHaveBeenCalled();
    const web = montar(undefined);
    await web.t.verificarMaquina();
    expect(web.abrir).not.toHaveBeenCalled();
    const desligada = montar({ iaEntrar: async () => ({ ok: true }), esteComputador: { jaViu: async () => false, marcar: async () => undefined } }, concluido, false);
    await desligada.t.verificarMaquina();
    expect(desligada.abrir).not.toHaveBeenCalled();
    expect(desligada.t.camada()).toBe("");
  });

  it("app antigo (sem a ponte do 'já vi') com a IA pronta não cobre a tela a cada sessão", async () => {
    const pronta = { ...concluido, executor: { pronto: true, ias: [{ id: "claude-cli", estado: "pronto" }] } } as unknown as EstadoOnboarding;
    const m = montar({ iaEntrar: async () => ({ ok: true }) }, pronta);
    await m.t.verificarMaquina();
    expect(m.abrir).not.toHaveBeenCalled();
    expect(m.t.cobre()).toBe(false);
  });
});

describe("conversa por texto: as respostas vão ao servidor e o pular conclui (critério 5)", () => {
  const original = (globalThis as { window?: unknown }).window;
  afterEach(() => { (globalThis as { window?: unknown }).window = original; });
  const configurando = { ...concluido, etapa: "configurando", mostrar: true, guia: { conversaId: "conv-nod" } } as unknown as EstadoOnboarding;

  function comConcluir() {
    const concluir = vi.fn(async () => concluido);
    const etapa = vi.fn(async () => configurando);
    const deps = {
      api: () => ({ etapaOnboarding: etapa, concluirOnboarding: concluir, onboarding: async () => configurando }),
      dados: () => configurando, aberto: () => true, hidratar: () => undefined, abrir: () => undefined,
      ligacao: { ativa: () => null, cheia: () => false, atenderOnboarding: () => false },
      garantirAgente: async () => true, irParaConversa: () => undefined, iniciarConexao: () => undefined, conectando: () => false,
      conectorHabilitado: async () => null, invalidar: () => undefined, erro: () => undefined, aoMudar: () => undefined,
      texto: () => true, nomeSugerido: () => "Ana",
    } as unknown as DepsOnboarding;
    (globalThis as { window?: unknown }).window = { nodDesktop: undefined, setTimeout, clearTimeout, setInterval, clearInterval };
    return { t: criarTelaOnboarding(deps), etapa, concluir };
  }
  const el = (valor?: string) => ({ dataset: valor ? { valor } : {} }) as unknown as HTMLElement;

  it("apelido aceito + chip do objetivo saem juntos na etapa 'configurando' e o fluxo segue (não conclui)", async () => {
    const m = comConcluir();
    m.t.acoes["texto-apelido-sim"]!(el());
    await m.t.acoes["texto-objetivo"]!(el("Organizar minha agenda"));
    expect(m.etapa).toHaveBeenCalledWith({ etapa: "configurando", semVoz: true, respostas: { apelido: "Ana", objetivo: "Organizar minha agenda" } });
    expect(m.concluir).not.toHaveBeenCalled();
  });

  it("'Só quero olhar' manda só o apelido e conclui; 'Pular as perguntas' conclui sem mandar respostas", async () => {
    const olhar = comConcluir();
    olhar.t.acoes["texto-apelido-sim"]!(el());
    await olhar.t.acoes["texto-objetivo"]!(el("Só quero olhar"));
    expect(olhar.etapa).toHaveBeenCalledWith({ etapa: "configurando", semVoz: true, respostas: { apelido: "Ana" } });
    expect(olhar.concluir).toHaveBeenCalledOnce();

    const pular = comConcluir();
    await pular.t.acoes["texto-pular"]!(el());
    expect(pular.concluir).toHaveBeenCalledOnce();
    expect(pular.etapa).not.toHaveBeenCalled();
  });
});

describe("a ida para a conversa por texto que falhou deixa tentar de novo", () => {
  const original = (globalThis as { window?: unknown }).window;
  afterEach(() => { (globalThis as { window?: unknown }).window = original; });
  const ola = { ...concluido, etapa: "ola", mostrar: true } as unknown as EstadoOnboarding;

  it("no navegador, o 'olá' cujo semVoz falhou aceita o pular de novo (antes ficava preso no olá)", async () => {
    const m = montar(undefined, ola);
    const erro = new Error("rede");
    m.etapa.mockRejectedValueOnce(erro).mockResolvedValue(ola);
    await m.t.acoes["onboarding-pular-ola"]!({ dataset: {} } as HTMLElement);
    expect(m.etapa).toHaveBeenCalledTimes(1);
    await m.t.acoes["onboarding-pular-ola"]!({ dataset: {} } as HTMLElement);
    expect(m.etapa).toHaveBeenCalledTimes(2);
  });

  it("em 'Este computador', o Continuar cujo semVoz falhou continua na tela para tentar de novo", async () => {
    const m = montar({ iaEntrar: async () => ({ ok: true }), esteComputador: { jaViu: async () => false, marcar: async () => undefined } }, ola);
    m.abrir(true);
    m.etapa.mockRejectedValueOnce(new Error("rede")).mockResolvedValue(ola);
    await m.t.acoes["onboarding-pular-ola"]!({ dataset: {} } as HTMLElement);
    expect(m.t.camada()).toContain('aria-label="Este computador"');
    await m.t.acoes["computador-continuar"]!({ dataset: {} } as HTMLElement);
    expect(m.etapa).toHaveBeenCalledTimes(1);
    expect(m.t.camada()).toContain('aria-label="Este computador"');
    await m.t.acoes["computador-continuar"]!({ dataset: {} } as HTMLElement);
    expect(m.etapa).toHaveBeenCalledTimes(2);
  });
});
