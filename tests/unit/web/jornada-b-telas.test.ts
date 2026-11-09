import { describe, expect, it } from "vitest";
import { htmlPassoIa, iaAqui, mostrarEsteComputador } from "../../../web/telas/oi-de-novo-passo.ts";
import { htmlTelaB, mostrarTelaB } from "../../../web/telas/onde-trabalham.ts";

/** ADA-243 (jornada B): as decisões e os textos das telas "Oi de novo · este computador" e "Onde os bots trabalham". */

describe("mostrarEsteComputador (critérios 1 e 5)", () => {
  const base = { flag: true, temPonte: true, estaMaquina: true, maquinaConectada: true, onboardingConcluido: true, vistoAqui: false };
  it("conta existente, computador sem 'já vi': aparece", () => expect(mostrarEsteComputador(base)).toBe(true));
  it("reinstalação limpa apaga o 'já vi' (arquivo local): aparece de novo", () => expect(mostrarEsteComputador({ ...base, vistoAqui: false })).toBe(true));
  it("já viu nesta máquina: não aparece", () => expect(mostrarEsteComputador({ ...base, vistoAqui: true })).toBe(false));
  it("flag desligada, web pura, sem esta máquina ou pessoa nova (a A cuida): não aparece", () => {
    expect(mostrarEsteComputador({ ...base, flag: false })).toBe(false);
    expect(mostrarEsteComputador({ ...base, temPonte: false })).toBe(false);
    expect(mostrarEsteComputador({ ...base, estaMaquina: false })).toBe(false);
    expect(mostrarEsteComputador({ ...base, onboardingConcluido: false })).toBe(false);
  });
  it("esta máquina ainda não conectada (ou fora da lista): espera, para não mostrar 'sem IA' por engano e gravar o 'já vi'", () => {
    expect(mostrarEsteComputador({ ...base, maquinaConectada: false })).toBe(false);
  });
});

describe("iaAqui: o estado real da IA DESTE computador", () => {
  it("2a pronta, 2b instalada sem login, 2c nada (e sem a máquina na lista ainda)", () => {
    expect(iaAqui({ ias: { "codex-cli": "pronto", "claude-cli": "ausente" } })).toEqual({ tipo: "pronta", ia: "codex-cli" });
    expect(iaAqui({ ias: { "claude-cli": "nao_autenticado" } })).toEqual({ tipo: "sem_login", ia: "claude-cli" });
    expect(iaAqui({ ias: { "claude-cli": "ausente" } })).toEqual({ tipo: "nada", ia: "claude-cli" });
    expect(iaAqui(undefined)).toEqual({ tipo: "nada", ia: "claude-cli" });
  });

  it("o passo diz Oi de novo com o nome e este computador, sem 'Mac'", () => {
    for (const ia of [iaAqui({ ias: { "claude-cli": "pronto" } }), iaAqui({ ias: { "claude-cli": "nao_autenticado" } }), iaAqui({ ias: {} })]) {
      const h = htmlPassoIa({ nome: "Ana", estaMaquinaNome: "DESKTOP-7Q2", ia });
      expect(h).toContain("Oi de novo, Ana");
      expect(h).toContain("este computador · DESKTOP-7Q2");
      expect(h).not.toMatch(/\bMac\b/);
    }
    expect(htmlPassoIa({ nome: "", estaMaquinaNome: "PC", ia: { tipo: "pronta", ia: "claude-cli" } })).toContain(">Oi de novo</h2>");
    expect(htmlPassoIa({ nome: "Ana", estaMaquinaNome: "PC", ia: { tipo: "sem_login", ia: "claude-cli" } })).toContain('data-ia-acao="entrar"');
    expect(htmlPassoIa({ nome: "Ana", estaMaquinaNome: "PC", ia: { tipo: "nada", ia: "claude-cli" } })).toContain('data-ia-acao="instalar"');
    expect(htmlPassoIa({ nome: "<b>", estaMaquinaNome: "<i>", ia: { tipo: "pronta", ia: "claude-cli" } })).not.toMatch(/<b>|<i>/);
  });
});

describe("mostrarTelaB (critério 2)", () => {
  const mac = { id: "mac", nome: "MacBook de Ana", conectada: false };
  it("IA pronta aqui e a padrão (Mac) desligada: aparece", () => expect(mostrarTelaB({ estaMaquinaId: "win", padrao: mac, iaProntaAqui: true })).toBe(true));
  it("padrão é outra máquina ligada, ou nenhuma: aparece", () => {
    expect(mostrarTelaB({ estaMaquinaId: "win", padrao: { ...mac, conectada: true }, iaProntaAqui: true })).toBe(true);
    expect(mostrarTelaB({ estaMaquinaId: "win", padrao: null, iaProntaAqui: true })).toBe(true);
  });
  it("a padrão é esta, mas desligada: aparece (QA ADA-243)", () => expect(mostrarTelaB({ estaMaquinaId: "win", padrao: { id: "win", nome: "PC", conectada: false }, iaProntaAqui: true })).toBe(true));
  it("a padrão é esta e está ligada: segue direto", () => expect(mostrarTelaB({ estaMaquinaId: "win", padrao: { id: "win", nome: "PC", conectada: true }, iaProntaAqui: true })).toBe(false));
  it("sem IA pronta aqui ou sem esta máquina: não aparece", () => {
    expect(mostrarTelaB({ estaMaquinaId: "win", padrao: mac, iaProntaAqui: false })).toBe(false);
    expect(mostrarTelaB({ estaMaquinaId: null, padrao: mac, iaProntaAqui: true })).toBe(false);
  });

  it("os textos nomeiam a padrão e oferecem as duas saídas", () => {
    const h = htmlTelaB({ padrao: mac, estaMaquinaNome: "DESKTOP-7Q2" });
    expect(h).toContain("Hoje seus bots trabalham no <b>MacBook de Ana</b>, que está desligado.");
    expect(h).toContain(">Manter no MacBook de Ana<");
    expect(h).toContain('data-b="aqui"');
    expect(h).toContain(">Trabalhar neste computador<");
    expect(htmlTelaB({ padrao: null, estaMaquinaNome: "PC" })).toContain(">Manter como está<");
  });
});
