import { describe, expect, it } from "vitest";
import { classificarComando } from "../../../src/domain/comando.ts";
import { decidirQuedaDaEspera, ESPERA_SEM_CONTATO_MS, ESPERA_SEM_INICIO_MS, esperaSemNoticia, fraseDaVolta, instrucaoDaRecusa, MAX_QUEDAS_ESPERA, SAIDA_ESPERA_MAX, ultimasLinhas, validarPedidoEspera } from "../../../src/domain/espera-comando.ts";
import { motivoDaEsperaNegada } from "../../../src/domain/espera-em-laco.ts";

/** ADR-099 item 4 (parte 2, definido em 2026-10-12): as regras puras do `esperar_comando`. */
describe("esperar_comando: o pedido", () => {
  it("os comandos que acompanham até o fim passam (gh pr checks --watch, gh run watch, kubectl rollout status)", () => {
    for (const comando of ["gh pr checks 845 --watch -R gamefik/app", "gh run watch 123 -R gamefik/app --exit-status", "kubectl rollout status deploy/app --timeout=30m", "  gh pr checks 845 --watch  "]) {
      const v = validarPedidoEspera({ comando, motivo: "a CI do PR #845" });
      expect(v, comando).toMatchObject({ ok: true, pedido: { comando: comando.trim(), motivo: "a CI do PR #845" } });
    }
  });

  it("o laço com sleep e o sleep longo da ADR-089 são recusados com a instrução de usar um watch", () => {
    for (const comando of ["while true; do gh pr checks 845; sleep 30; done", "until gh run view 1 --exit-status; do sleep 15; done", "sleep 600 && gh pr checks 845"]) {
      const v = validarPedidoEspera({ comando, motivo: "a CI" });
      expect(v, comando).toMatchObject({ ok: false, erro: "laco_com_sleep" });
      if (!v.ok) expect(instrucaoDaRecusa(v)).toContain("gh pr checks <n> --watch");
    }
  });

  it("vazio, longo, script de várias linhas e motivo vazio são recusados", () => {
    expect(validarPedidoEspera({ comando: "  ", motivo: "x" })).toMatchObject({ ok: false, erro: "comando_vazio" });
    expect(validarPedidoEspera({ comando: "a".repeat(4_001), motivo: "x" })).toMatchObject({ ok: false, erro: "comando_longo" });
    expect(validarPedidoEspera({ comando: "gh pr checks 1\ngh pr checks 2", motivo: "x" })).toMatchObject({ ok: false, erro: "multilinha" });
    expect(validarPedidoEspera({ comando: "gh pr checks 1 --watch", motivo: "   " })).toMatchObject({ ok: false, erro: "motivo_vazio" });
  });

  it("gh run watch só lê: roda direto no manual, como gh run view", () => {
    expect(classificarComando("gh run watch 123 -R gamefik/app").tipo).toBe("leitura");
    expect(classificarComando("gh pr checks 845 --watch").tipo).toBe("leitura");
  });

  it("a negação do laço com sleep aponta o esperar_comando quando ele está no catálogo", () => {
    const espera = { tipo: "laco_com_sleep" as const, segundos: 30 };
    expect(motivoDaEsperaNegada(espera, true, true)).toContain("esperar_comando");
    expect(motivoDaEsperaNegada(espera, true, false)).not.toContain("esperar_comando");
  });
});

describe("esperar_comando: a saída, a queda e a volta", () => {
  it("as últimas linhas cabem no teto e começam numa linha inteira", () => {
    const texto = Array.from({ length: 2_000 }, (_, i) => `linha ${i}`).join("\n");
    const cauda = ultimasLinhas(texto);
    expect(cauda.length).toBeLessThanOrEqual(SAIDA_ESPERA_MAX);
    expect(cauda.endsWith("linha 1999")).toBe(true);
    expect(cauda.startsWith("linha ")).toBe(true);
    expect(ultimasLinhas("ok\r\n")).toBe("ok");
  });

  it("relançar conta queda; na MAX_QUEDAS_ESPERA-ésima desiste", () => {
    expect(MAX_QUEDAS_ESPERA).toBe(3);
    expect(decidirQuedaDaEspera(0)).toEqual({ tipo: "relancar", quedas: 1 });
    expect(decidirQuedaDaEspera(1)).toEqual({ tipo: "relancar", quedas: 2 });
    expect(decidirQuedaDaEspera(2)).toEqual({ tipo: "desistir", quedas: 3 });
  });

  it("sem notícia: nunca começou em 3 min, ou parou de dar notícia por 30 min", () => {
    const criadoEm = 1_000_000;
    expect(esperaSemNoticia({ criadoEm, vistoEm: null, agora: criadoEm + ESPERA_SEM_INICIO_MS - 1 })).toBeNull();
    expect(esperaSemNoticia({ criadoEm, vistoEm: null, agora: criadoEm + ESPERA_SEM_INICIO_MS })).toBe("sem_inicio");
    expect(esperaSemNoticia({ criadoEm, vistoEm: criadoEm, agora: criadoEm + ESPERA_SEM_CONTATO_MS - 1 })).toBeNull();
    expect(esperaSemNoticia({ criadoEm, vistoEm: criadoEm, agora: criadoEm + ESPERA_SEM_CONTATO_MS })).toBe("sem_contato");
  });

  it("a frase da volta: código, comando e saída num bloco; a queda diz o motivo; a terceira manda perguntar à pessoa", () => {
    const fim = fraseDaVolta({ estado: "terminou", comando: "gh pr checks 845 --watch", motivo: "a CI do PR #845", codigo: 1, saida: "X tests ```falhou```" });
    expect(fim).toContain("O comando que você esperava terminou (código 1): a CI do PR #845");
    expect(fim).toContain("$ gh pr checks 845 --watch");
    expect(fim).toContain("X tests '''falhou'''");
    expect(fraseDaVolta({ estado: "terminou", comando: "c", motivo: "m", codigo: null, saida: "" })).toContain("sem código");
    expect(fraseDaVolta({ estado: "caiu", comando: "c", motivo: "m", causa: "sem_contato" })).toContain("A espera caiu: a máquina deste trabalho ficou mais de 30 min sem dar notícia");
    const tres = fraseDaVolta({ estado: "caiu", comando: "c", motivo: "m", causa: "quedas" });
    expect(tres).toContain("caiu 3 vezes");
    expect(tres).toContain("pergunte como seguir");
  });
});
