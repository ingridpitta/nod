import { describe, expect, it } from "vitest";
import type { CamposEntrevista } from "../../../src/contracts/onboarding.ts";
import { FERRAMENTAS_NOD_ONBOARDING } from "../../../src/domain/plano-turno.ts";
import { MARCADOR_PARTE_DINAMICA, montarPromptLigacao } from "../../../src/domain/prompt-ligacao.ts";
import {
  camposQueFaltam, linhasDoPromptOnboarding, MODELOS_DE_BOT, modeloDoObjetivo, normalizarCampo, objetivoDoTexto, passoDaConfiguracao, PERGUNTAS_ENTREVISTA, resumoDaEntrevista,
  saudacaoDoOnboarding, sugestoesDoOnboarding, tamanhoDoTexto, textoTudoMontado,
} from "../../../src/domain/roteiro-onboarding.ts";
import { ehNod, nomeReservadoAoNod, NOME_DO_NOD } from "../../../src/domain/nod.ts";

const VAZIO: CamposEntrevista = { apelido: null, comoConheceu: null, objetivo: null, tamanhoTime: null };
const CHEIO: CamposEntrevista = { apelido: "Ana", comoConheceu: "Indicação", objetivo: "Responder clientes mais rápido", tamanhoTime: "2_10" };

/** O roteiro do onboarding por ligação (definido em 2026-10-04, ADR-077; textos do protótipo HiFiMac). */
describe("roteiro do onboarding", () => {
  it("a primeira fala leva o nome do Nod (a guia desde a ADR-081) e não tem dois-pontos (é falada)", () => {
    expect(saudacaoDoOnboarding(NOME_DO_NOD)).toBe("Oi! Eu sou o Nod, seu bot fixo aqui no nod. Como você quer que eu te chame?");
    for (const fala of [saudacaoDoOnboarding(NOME_DO_NOD), resumoDaEntrevista(CHEIO), ...Object.values(PERGUNTAS_ENTREVISTA)]) expect(fala).not.toContain(":");
    expect(textoTudoMontado(NOME_DO_NOD)).toBe("Tudo montado. Quando quiser, é só chamar o Nod por aqui.");
  });

  it("as perguntas seguem a ordem apelido → como conheceu → objetivo → time", () => {
    expect(camposQueFaltam(VAZIO)).toEqual(["apelido", "como_conheceu", "objetivo", "tamanho_time"]);
    expect(camposQueFaltam({ ...VAZIO, apelido: "Ana", objetivo: "x" })).toEqual(["como_conheceu", "tamanho_time"]);
    expect(camposQueFaltam(CHEIO)).toEqual([]);
  });

  it("o objetivo dito vira um dos quatro modelos; nada que case = clientes", () => {
    expect(objetivoDoTexto("Revisar o código do time")).toBe("codigo");
    expect(objetivoDoTexto("quero que revise os PRs")).toBe("codigo");
    expect(objetivoDoTexto("Organizar meu dia")).toBe("dia");
    expect(objetivoDoTexto("minhas reuniões")).toBe("dia");
    expect(objetivoDoTexto("Acompanhar o trabalho do time")).toBe("time");
    expect(objetivoDoTexto("Responder clientes mais rápido")).toBe("clientes");
    expect(objetivoDoTexto("não sei ainda")).toBe("clientes");
    expect(objetivoDoTexto(null)).toBe("clientes");
    for (const m of Object.values(MODELOS_DE_BOT)) {
      expect(objetivoDoTexto(m.fala)).toBe(m.objetivo);
      expect(m.rotinas).toHaveLength(3);
      expect(m.pode.length).toBeGreaterThan(0);
    }
    expect(modeloDoObjetivo("organizar meu dia").app.slug).toBe("googlecalendar");
  });

  it("o tamanho do time sai das palavras e dos números", () => {
    expect(tamanhoDoTexto("Só eu")).toBe("so_eu");
    expect(tamanhoDoTexto("trabalho sozinha")).toBe("so_eu");
    expect(tamanhoDoTexto("Somos uns cinco")).toBe("2_10");
    expect(tamanhoDoTexto("Umas trinta pessoas")).toBe("11_50");
    expect(tamanhoDoTexto("uns 200")).toBe("51_mais");
    expect(tamanhoDoTexto("11_50")).toBe("11_50");
    expect(tamanhoDoTexto("não sei")).toBeNull();
  });

  it("normalizarCampo corta nos tetos da 0049 e recusa vazio e tamanho sem número", () => {
    expect(normalizarCampo("apelido", "  Ana  ")).toBe("Ana");
    expect(normalizarCampo("apelido", "x".repeat(80))).toHaveLength(60);
    expect(normalizarCampo("como_conheceu", "y".repeat(300))).toHaveLength(200);
    expect(normalizarCampo("objetivo", "   ")).toBeNull();
    expect(normalizarCampo("tamanho_time", "muita gente")).toBeNull();
    expect(normalizarCampo("tamanho_time", "uns cinco")).toBe("2_10");
  });

  it("o resumo termina em Certo? e usa o modelo do objetivo", () => {
    expect(resumoDaEntrevista(CHEIO)).toBe("Então, você é Ana, chegou por indicação, quer responder clientes mais rápido e trabalha com 2 a 10 pessoas. Certo?");
    expect(resumoDaEntrevista({ ...CHEIO, tamanhoTime: "so_eu" })).toContain("trabalha com ninguém, por enquanto. Certo?");
  });

  it("os chips 'Diga algo como' seguem a etapa e o passo", () => {
    expect(sugestoesDoOnboarding({ etapa: "entrevista", campos: VAZIO, pessoaNome: "Marlon Wanderllich" })).toEqual(["Me chama de Marlon"]);
    expect(sugestoesDoOnboarding({ etapa: "entrevista", campos: { ...VAZIO, apelido: "M" } })).toEqual(["Um amigo me indicou", "Vi no LinkedIn", "Pesquisando no Google"]);
    expect(sugestoesDoOnboarding({ etapa: "entrevista", campos: { ...CHEIO, objetivo: null } })).toEqual(Object.values(MODELOS_DE_BOT).map((m) => m.fala));
    expect(sugestoesDoOnboarding({ etapa: "entrevista", campos: { ...CHEIO, tamanhoTime: null } })).toEqual(["Só eu", "Somos uns cinco", "Umas trinta pessoas"]);
    expect(sugestoesDoOnboarding({ etapa: "entrevista", campos: CHEIO })).toEqual(["Quero corrigir", "Isso mesmo"]);
    expect(sugestoesDoOnboarding({ etapa: "configurando", campos: CHEIO, passo: "bot", nomeBot: "Atendente" })).toEqual(["Pode ser Atendente"]);
    expect(sugestoesDoOnboarding({ etapa: "configurando", campos: CHEIO, passo: "app" })).toEqual(["Conecta aí"]);
    expect(sugestoesDoOnboarding({ etapa: "configurando", campos: CHEIO, passo: "rotina" })).toEqual(["Dias úteis, 8:00", "De hora em hora"]);
    expect(sugestoesDoOnboarding({ etapa: "configurando", campos: CHEIO, passo: "fim" })).toEqual(["Pode desligar"]);
    expect(sugestoesDoOnboarding({ etapa: "concluido", campos: CHEIO })).toEqual([]);
  });

  it("o passo da configuração vem do que existe: bot → app → rotina → fim", () => {
    expect(passoDaConfiguracao({ temBot: false, appConectado: true, temRotina: true })).toBe("bot");
    expect(passoDaConfiguracao({ temBot: true, appConectado: false, temRotina: true })).toBe("app");
    expect(passoDaConfiguracao({ temBot: true, appConectado: true, temRotina: false })).toBe("rotina");
    expect(passoDaConfiguracao({ temBot: true, appConectado: true, temRotina: true })).toBe("fim");
  });

  it("o prompt de voz ganha o roteiro só no onboarding, depois do marcador (o roteiro muda a cada campo)", () => {
    const base = { nomeBot: "Nina", generoVoz: "feminina" as const, titulo: "Guia", descricao: "x", pessoaNome: "Ana", memorias: [], ultimasMensagens: [], colegas: [], apps: [], modoAprovacao: "manual" as const };
    const roteiro = linhasDoPromptOnboarding({ nomeGuia: "Nina", campos: { ...VAZIO, apelido: "Ana" }, etapa: "entrevista" });
    expect(roteiro.join("\n")).toContain("anotar_entrevista");
    expect(roteiro.join("\n")).toContain("Ela já respondeu: apelido: Ana.");
    expect(roteiro.join("\n")).toContain("Ainda falta: como_conheceu, objetivo, tamanho_time.");
    const comRoteiro = montarPromptLigacao({ ...base, onboarding: true, roteiroOnboarding: roteiro });
    expect(comRoteiro.indexOf("anotar_entrevista")).toBeGreaterThan(comRoteiro.indexOf(MARCADOR_PARTE_DINAMICA));
    expect(montarPromptLigacao({ ...base, roteiroOnboarding: roteiro })).not.toContain("anotar_entrevista");
    expect(linhasDoPromptOnboarding({ nomeGuia: "Nina", campos: CHEIO, etapa: "configurando" }).join("\n")).toContain("para_bot");
  });

  it("o roteiro manda falar antes de anotar, sem anunciar a ferramenta, e dizer a transição antes de concluir", () => {
    const roteiro = linhasDoPromptOnboarding({ nomeGuia: "Nina", campos: VAZIO, etapa: "entrevista" }).join("\n");
    expect(roteiro).toContain("fale primeiro: uma reação curta e a próxima pergunta. Só depois, na mesma resposta, chame anotar_entrevista");
    expect(roteiro).toContain("Não anuncie essa ferramenta");
    expect(roteiro).toContain("siga o que a ferramenta devolver");
    expect(roteiro).toContain('diga só uma ponte curta ("Deixa eu juntar tudo.") antes de anotar_entrevista');
    expect(roteiro).toContain("e só depois chame concluir_entrevista");
    // A ordem antiga (anotar e depois perguntar) custava duas respostas do modelo antes do primeiro som.
    expect(roteiro).not.toContain("Assim que ela responder uma pergunta, chame anotar_entrevista");
  });

  it("as três ferramentas do onboarding; o nome Nod é reservado ao bot fixo (ADR-081)", () => {
    expect([...FERRAMENTAS_NOD_ONBOARDING]).toEqual(["anotar_entrevista", "concluir_entrevista", "propor_bot"]);
    for (const nome of ["Nod", "nod", " NOD "]) expect(nomeReservadoAoNod(nome)).toBe(true);
    for (const nome of ["Nod (seu)", "Nodo", "Nina"]) expect(nomeReservadoAoNod(nome)).toBe(false);
    expect(ehNod({ papel: "nod" })).toBe(true);
    expect(ehNod({ papel: null })).toBe(false);
    expect(ehNod(null)).toBe(false);
  });
});
