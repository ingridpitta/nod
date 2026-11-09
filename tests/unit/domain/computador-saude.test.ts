import { describe, expect, it } from "vitest";
import { CODIGOS_RUNTIME, codigoDaAcao, codigoDaSubida, falhaDe, primeiraLinha, TRAVAS_DO_PERFIL } from "../../../infra/computador/falhas.mjs";
import type { Agente } from "../../../src/contracts/agente.ts";
import { MOTIVOS_FALHA_COMPUTADOR } from "../../../src/contracts/motivos.ts";
import type { Turno } from "../../../src/contracts/turno.ts";
import { acaoDaFalha, CONTA_PARA_SAUDE, FalhaComputador, ehFalhaComputador, instrucaoDaFalha, LIMITE_FALHAS_SEGUIDAS, limiteDoAmbiente, maquinaRespondeu, MOTIVO_FALHA_EM_PORTUGUES, resumirDetalhe, textoDoLimite } from "../../../src/domain/computador.ts";
import { montarPlano, type EntradaPlano } from "../../../src/domain/plano-turno.ts";
import { redigir } from "../../../src/domain/redacao.ts";
import { MOTIVO_FALHA_TEXTO, textoDoLimite as textoDoLimiteWeb } from "../../../web/lib/computador.ts";

const agora = 1_000_000;
const agente: Agente = { tenantId: "t", id: "a1", ownerId: "p", visibility: "privado", nome: "Nina", titulo: "", descricao: "lê e-mails", dono: "pessoa", forma: "shape-square", cor: "c-red", fixado: false, oculto: false, confirmado: true, modelo: "claude-haiku-4-5-20251001", duplicadoDe: null, criadoEm: 0 };
const turno: Turno = { executor: "catcher", tenantId: "t", id: "t1", conversaId: "c1", agenteId: "a1", ownerId: "p", origem: "conversa", estado: "despachando", sinais: { attempted: true, rejected: false, promptSubmitted: false, producedOutput: false }, machineId: null, leaseAte: null, prazoEm: agora + 86_400_000, motivoInterrupcao: null, motivoFalha: null, semNovidadeMotivo: null, retomaTurnoId: null, profundidade: 0, reenvios: 0, pararSolicitadoEm: null, entradaTexto: "oi", entradaAnexos: [], entradaConfianca: "confiavel", custoUsd: null, modelo: "claude-haiku-4-5-20251001", criadoEm: agora };
const base: EntradaPlano = { turno, agente, memorias: [], concessoes: [], conectores: [], modo: "conversa", confianca: "confiavel", profundidade: 0, inventario: { estado: "pronto", versao: "2.1.272", em: agora }, executor: "local", sessaoCli: null, pessoaNome: "Marlon", agora, computador: true };
const doComputador = (p: ReturnType<typeof montarPlano>) => p.catalogo.ferramentas.filter((f) => f.origem === "computador").map((f) => f.nome);

describe("NOD-407: o que prova que a máquina respondeu", () => {
  it("teto do host e app abaixo do piso são neutros; tela_alterada respondeu; sem_resposta é falha", () => {
    expect(maquinaRespondeu("app_desatualizado")).toBe(false);
    expect(maquinaRespondeu("limite_de_computadores")).toBe(false);
    expect(maquinaRespondeu("tela_alterada")).toBe(true);
    expect(maquinaRespondeu("sem_resposta")).toBe(false);
    expect(CONTA_PARA_SAUDE.has("app_desatualizado")).toBe(false);
  });
});

describe("saúde do computador do bot (emenda da ADR-037)", () => {
  it("só a MÁQUINA sem responder conta; a ação que falhou numa máquina viva não conta", () => {
    expect([...CONTA_PARA_SAUDE].sort()).toEqual(["cofre_invalido", "docker_indisponivel", "imagem_ausente", "maquina_sem_contato", "nao_ficou_pronto", "nao_iniciou", "navegador_nao_abriu", "sem_resposta"]);
    // NOD-96 (ADR-122): faltar pacote, não ter suporte e estar atualizando são a máquina respondendo — não contam.
    for (const m of ["acao_falhou", "tela_alterada", "ocupado", "limite_de_computadores", "faltam_pacotes", "sem_suporte", "atualizando"] as const) expect(CONTA_PARA_SAUDE.has(m)).toBe(false);
    expect(LIMITE_FALHAS_SEGUIDAS).toBe(3);
    const f = new FalhaComputador("navegador_nao_abriu", { detalhe: "Target page, context or browser has been closed", reinicios: 6 });
    expect(ehFalhaComputador(f)).toBe(true);
    expect(f).toMatchObject({ motivo: "navegador_nao_abriu", reinicios: 6, message: "navegador_nao_abriu" });
    expect(ehFalhaComputador(new Error("navegador_nao_abriu"))).toBe(false);
  });

  it("NOD-96: máquina sem os pacotes ou sem suporte não se insiste neste turno e nada foi executado", () => {
    for (const m of ["faltam_pacotes", "sem_suporte"] as const) {
      expect(instrucaoDaFalha(m)).toContain("Nada foi executado");
      expect(instrucaoDaFalha(m)).toContain("Não tente de novo neste turno");
    }
    // NOD-96 PR 5: atualizando é espera: o bot tenta de novo quando a operação acabar.
    expect(instrucaoDaFalha("atualizando")).toContain("o computador está atualizando; tento de novo quando terminar".replace(/^o/, "O"));
    expect(instrucaoDaFalha("atualizando")).not.toContain("Não tente de novo");
    expect(instrucaoDaFalha("maquina_sem_contato", null, "vm-1")).toContain("Não consegui ligar o computador: vm-1 está sem contato. Nada foi executado. Não tente de novo neste turno");
    expect(instrucaoDaFalha("nao_ficou_pronto")).toContain("Não consegui ligar o computador: ");
  });

  it("NOD-96 PR 5: o erro acionável aponta a ação no painel do computador", () => {
    for (const m of ["maquina_sem_contato", "sem_resposta", "nao_ficou_pronto"] as const) {
      expect(acaoDaFalha(m)).toEqual({ op: "atualizar", rotulo: "⚙ Atualizar o computador" });
      expect(instrucaoDaFalha(m)).toContain("⚙ Atualizar o computador");
    }
    expect(acaoDaFalha("navegador_nao_abriu")).toEqual({ op: "tentar_de_novo", rotulo: "Tentar de novo" });
    for (const m of ["tela_alterada", "acao_falhou", "atualizando", "limite_de_computadores"] as const) expect(acaoDaFalha(m)).toBeNull();
  });

  it("a ferramenta devolve instrução de tabela: máquina fora não se insiste; tela velha se observa de novo", () => {
    expect(instrucaoDaFalha("navegador_nao_abriu")).toContain("o navegador do computador não abriu");
    expect(instrucaoDaFalha("navegador_nao_abriu")).toContain("Não tente de novo neste turno");
    expect(instrucaoDaFalha("tela_alterada")).toContain("Observe de novo");
    expect(instrucaoDaFalha("acao_falhou")).toContain("não afirme que executou");
    for (const m of MOTIVOS_FALHA_COMPUTADOR) expect(instrucaoDaFalha(m)).not.toMatch(/indispon[íi]vel ou tela alterada/);
  });

  it("NOD-170: o teto do host diz os números ao bot, manda não insistir e não fala de máquina quebrada", () => {
    const limite = { maximo: 3, ociosoMin: 15 };
    const f = new FalhaComputador("limite_de_computadores", { limite });
    expect(f.limite).toEqual(limite);
    expect(new FalhaComputador("sem_resposta").limite).toBeNull();
    expect(instrucaoDaFalha("limite_de_computadores", limite)).toBe("Este Mac já tem 3 computadores ligados, o limite. Nada foi executado. Os computadores sem uso há 15 min desligam sozinhos. Não tente de novo neste turno; siga com os acessos que você tem e diga em uma frase o que ficou de fora.");
    // Sem ociosidade, a promessa de desligar sozinho some; sem números, o texto genérico.
    expect(textoDoLimite({ maximo: 2, ociosoMin: 0 })).toBe("Este Mac já tem 2 computadores ligados, o limite. Nada foi executado.");
    expect(instrucaoDaFalha("limite_de_computadores")).toMatch(/^Este Mac já tem o máximo de computadores ligados\. Nada foi executado\. Não tente de novo/);
    expect(instrucaoDaFalha("limite_de_computadores")).not.toContain("não respondeu");
  });

  it("NOD-170: as variáveis do host, com padrão para ausente ou inválido e 0 desligando a ociosidade", () => {
    expect(limiteDoAmbiente({})).toEqual({ maximo: 3, ociosoMin: 15 });
    expect(limiteDoAmbiente({ NOD_COMPUTADORES_MAX: "5", NOD_COMPUTADOR_OCIOSO_MIN: "0" })).toEqual({ maximo: 5, ociosoMin: 0 });
    expect(limiteDoAmbiente({ NOD_COMPUTADORES_MAX: "0", NOD_COMPUTADOR_OCIOSO_MIN: "-1" })).toEqual({ maximo: 3, ociosoMin: 15 });
    expect(limiteDoAmbiente({ NOD_COMPUTADORES_MAX: "2.5", NOD_COMPUTADOR_OCIOSO_MIN: "abc" })).toEqual({ maximo: 3, ociosoMin: 15 });
    expect(limiteDoAmbiente({ NOD_COMPUTADORES_MAX: " ", NOD_COMPUTADOR_OCIOSO_MIN: "30" })).toEqual({ maximo: 3, ociosoMin: 30 });
  });

  it("a mensagem única diz de quem é o computador, o motivo em palavras e o que foi feito", () => {
    const texto = redigir("computador-fora-do-ar", agora, { agente: "Nina", motivo: MOTIVO_FALHA_EM_PORTUGUES.navegador_nao_abriu });
    expect(texto).toBe("O computador de Nina não responde: o navegador do computador não abriu. Tirei o computador das próximas execuções até você religá-lo.");
  });

  it("o detalhe do log é a 1ª linha, curta e sem nada com cara de segredo", () => {
    expect(resumirDetalhe("\n  Error response from daemon: No such container: nod-computador-x\nstack…")).toBe("Error response from daemon: No such container: nod-computador-x");
    expect(resumirDetalhe(`token=${"a".repeat(64)} e Bearer abc.def.ghi.jkl`)).toBe("token=«redigido: 64 caracteres» e Bearer «redigido: 15 caracteres»");
    expect(resumirDetalhe(`chave ${"0f".repeat(32)} vazou`)).toBe("chave «redigido: 64 caracteres» vazou");
    // Regression: ISSUE-001 — o resumirDetalhe antigo pegava `senha=` curta; o redator novo deixava passar
    expect(resumirDetalhe("Error: senha=hunter2 recusada")).toBe("Error: senha=«redigido: 7 caracteres» recusada");
    // o teto de 200 nunca parte o marcador
    const cortada = resumirDetalhe(`${"x ".repeat(95)}token=${"b".repeat(30)}`)!;
    expect(cortada.length).toBeLessThanOrEqual(200);
    expect(cortada).not.toContain("«");
    expect(resumirDetalhe("x".repeat(500))?.length).toBeLessThanOrEqual(200);
    expect(resumirDetalhe(null)).toBeNull();
    expect(resumirDetalhe("  \n ")).toBeNull();
  });

  it("a web fala a mesma língua do servidor: as duas tabelas de motivo são iguais", () => {
    expect(MOTIVO_FALHA_TEXTO).toEqual(MOTIVO_FALHA_EM_PORTUGUES);
    for (const l of [{ maximo: 3, ociosoMin: 15 }, { maximo: 1, ociosoMin: 0 }]) expect(textoDoLimiteWeb(l)).toBe(textoDoLimite(l));
    expect(Object.keys(MOTIVO_FALHA_EM_PORTUGUES)).toEqual([...MOTIVOS_FALHA_COMPUTADOR]);
  });
});

describe("runtime do computador: códigos fixos (infra/computador/falhas.mjs)", () => {
  it("todo código que o runtime emite existe no enum do servidor", () => {
    for (const c of CODIGOS_RUNTIME) expect(MOTIVOS_FALHA_COMPUTADOR).toContain(c);
  });

  it("ação: só a tela velha tem código próprio; subida: o código marcado pelo passo, ou nao_iniciou", () => {
    expect(codigoDaAcao(new Error("tela_alterada"))).toBe("tela_alterada");
    expect(codigoDaAcao(new Error("page.goto: net::ERR_NAME_NOT_RESOLVED"))).toBe("acao_falhou");
    expect(codigoDaAcao("texto solto")).toBe("acao_falhou");
    expect(codigoDaSubida(falhaDe("navegador_nao_abriu", new Error("browserType.launchPersistentContext: Timeout 30000ms exceeded.\n=== logs ===")))).toBe("navegador_nao_abriu");
    expect(falhaDe("cofre_invalido", "o cofre de logins não abriu").message).toBe("o cofre de logins não abriu");
    expect(codigoDaSubida(new Error("Command failed: pactl"))).toBe("nao_iniciou");
    expect(codigoDaSubida(Object.assign(new Error("x"), { codigo: "inventado" }))).toBe("nao_iniciou");
    expect(primeiraLinha("\nlinha 1\nlinha 2")).toBe("linha 1");
    expect(primeiraLinha(undefined)).toBeNull();
  });

  it("a trava do Chromium que o container anterior deixou no volume é apagada antes de abrir o navegador", () => {
    expect([...TRAVAS_DO_PERFIL]).toEqual(["SingletonLock", "SingletonSocket", "SingletonCookie"]);
  });
});

describe("plano de turno com o computador fora de uso (emenda da ADR-037)", () => {
  it("ligado e respondendo: as ferramentas computador_* entram", () => {
    const p = montarPlano(base);
    expect(doComputador(p)).toContain("computador_observar");
    expect(p.promptSistema).not.toContain("fora do ar");
  });

  it("fora do ar: nenhuma ferramenta de computador, e o prompt diz por quê (sem tutorial)", () => {
    const p = montarPlano({ ...base, computadorFora: { estado: "fora_do_ar", motivo: MOTIVO_FALHA_EM_PORTUGUES.navegador_nao_abriu } });
    expect(doComputador(p)).toEqual([]);
    expect(p.promptSistema).toContain("Seu computador está fora do ar (o navegador do computador não abriu)");
    expect(p.promptSistema).not.toContain("Você tem um computador persistente");
  });

  it("desligado pela pessoa: nenhuma ferramenta — antes o plano as oferecia com habilitado=false", () => {
    const p = montarPlano({ ...base, computadorFora: { estado: "desligado" } });
    expect(doComputador(p)).toEqual([]);
    expect(p.promptSistema).toContain("Seu computador está desligado pela pessoa");
  });

  it("sem o serviço de computador, ou em modo sem computador, a linha não aparece", () => {
    expect(montarPlano({ ...base, computador: false, computadorFora: { estado: "desligado" } }).promptSistema).not.toContain("Seu computador");
    expect(montarPlano({ ...base, modo: "peer", profundidade: 1, computadorFora: { estado: "desligado" } }).promptSistema).not.toContain("Seu computador");
    // ADR-050: bot novo é bot completo — a criação tem computador, e o aviso de desligado aparece nela também.
    expect(montarPlano({ ...base, modo: "criacao", computadorFora: { estado: "desligado" } }).promptSistema).toContain("Seu computador está desligado pela pessoa");
  });
});
