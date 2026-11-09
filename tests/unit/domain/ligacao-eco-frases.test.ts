import { describe, expect, it } from "vitest";
import { COMANDOS_QUE_APROVAM, interpretarComando } from "../../../src/domain/comando-de-voz.ts";
import { ehEco } from "../../../src/domain/ligacao-eco.ts";
import { palavrasDaFala } from "../../../src/domain/ligacao-turno.ts";
import { COMANDOS_DE_ECO, FRASES_DE_ECO, MOLDES, linhaParaIa, vereditoDoEco } from "../../../scripts/uat/frases-eco.ts";

/**
 * NOD-165: as 50 leituras da UAT do eco. O microfone ouve o bot ler uma frase com um comando dentro; o trecho que o
 * STT devolve (inteiro, só o comando ou com palavras trocadas) é descartado como eco e nunca vira aprovação.
 */
const BOT = { inicioMs: 10_000, fimMs: 16_000 };
const fala = (texto: string) => [{ texto, ...BOT }];
/** Troca uma palavra a cada 3: o STT errando o que ouviu do alto-falante. */
const degradado = (texto: string) => palavrasDaFala(texto).map((p, i) => (i % 3 === 2 ? "xablau" : p)).join(" ");

describe("eco das 50 frases de comando", () => {
  it("são 50, sem repetição, cada uma com o comando dentro e mais de 8 palavras", () => {
    expect(FRASES_DE_ECO).toHaveLength(50);
    expect(new Set(FRASES_DE_ECO.map((f) => f.texto)).size).toBe(50);
    for (const f of FRASES_DE_ECO) {
      expect(palavrasDaFala(f.texto).join(" ")).toContain(palavrasDaFala(f.comando).join(" "));
      expect(palavrasDaFala(f.texto).length).toBeGreaterThan(8);
    }
  });

  it.each(FRASES_DE_ECO.map((f) => [f.texto, f] as const))("%s", (_t, f) => {
    const falasBot = fala(f.texto);
    // A leitura inteira, ouvida por cima do bot.
    expect(ehEco({ texto: f.texto, inicioMs: 11_000, fimMs: 15_500, falasBot })).toBe(true);
    // Só o comando: o pedaço que o STT pode cortar e que, sozinho, aprovaria.
    expect(ehEco({ texto: f.comando, inicioMs: 12_000, fimMs: 12_800, falasBot })).toBe(true);
    // O comando na cauda, terminando dentro da margem de 300 ms depois do fim do bot.
    expect(ehEco({ texto: f.comando, inicioMs: 15_600, fimMs: 16_250, falasBot })).toBe(true);
    // A leitura com uma palavra a cada 3 trocada pelo STT.
    expect(ehEco({ texto: degradado(f.texto), inicioMs: 11_000, fimMs: 15_500, falasBot })).toBe(true);
    // A leitura inteira nunca é comando: passa de 8 palavras.
    expect(interpretarComando(f.texto, f.perfil, "Nina").acao).not.toBe("aprovar");
    // Controle: o comando sozinho aprova no perfil dele; é a guarda de eco que protege.
    expect(interpretarComando(f.comando, f.perfil, "Nina").acao).toBe("aprovar");
  });

  it("os 10 comandos da sessão aprovam no perfil declarado (a lista não envelhece quieta)", () => {
    for (const { comando, perfil } of COMANDOS_DE_ECO) expect(COMANDOS_QUE_APROVAM[perfil as "estrito" | "proposta"]).toContain(comando);
  });

  // A sessão ao vivo lê só 10 comandos; aqui todo comando que aprova sozinho passa pelos mesmos 5 moldes.
  const todos = (["estrito", "proposta"] as const).flatMap((perfil) => COMANDOS_QUE_APROVAM[perfil].map((comando) => [perfil, comando] as const));
  it.each(todos)("todo comando que aprova é eco dentro da leitura: %s · %s", (perfil, comando) => {
    for (const molde of MOLDES) {
      const texto = molde(comando);
      const falasBot = fala(texto);
      expect(ehEco({ texto: comando, inicioMs: 12_000, fimMs: 12_800, falasBot })).toBe(true);
      expect(ehEco({ texto: comando, inicioMs: 15_600, fimMs: 16_250, falasBot })).toBe(true);
      expect(interpretarComando(texto, perfil, "Nina").acao).not.toBe("aprovar");
    }
    expect(interpretarComando(comando, perfil, "Nina").acao).toBe("aprovar");
  });

  it("a pessoa falando o comando depois da margem não é eco", () => {
    const f = FRASES_DE_ECO[0]!;
    expect(ehEco({ texto: f.comando, inicioMs: 16_400, fimMs: 17_000, falasBot: fala(f.texto) })).toBe(false);
  });

  // Regressão: QA da NOD-165 (Teodora, 2026-10-05). Com o cérebro fora do ar o `--eco` imprimia "05/5 lida" e
  // "comandos: 0 ✅" sem ter lido nada.
  it("o pré-teste só passa com todas as leituras feitas e nenhum comando", () => {
    expect(vereditoDoEco({ pedidas: 50, lidas: 50, comandos: 0 }).passou).toBe(true);
    const semLeitura = vereditoDoEco({ pedidas: 5, lidas: 0, comandos: 0 });
    expect(semLeitura.passou).toBe(false);
    expect(semLeitura.linhas.join("\n")).toContain("leituras feitas: 0/5 ❌");
    expect(semLeitura.linhas.join("\n")).not.toContain("✅");
    expect(vereditoDoEco({ pedidas: 5, lidas: 3, comandos: 0 }).passou).toBe(false);
    expect(vereditoDoEco({ pedidas: 0, lidas: 0, comandos: 0 }).passou).toBe(false);
    expect(vereditoDoEco({ pedidas: 5, lidas: 5, comandos: 1 }).passou).toBe(false);
  });

  it("o pedido de leitura para a IA de verdade leva a frase inteira e nenhum marcador do catcher", () => {
    for (const f of FRASES_DE_ECO) {
      const l = linhaParaIa(f);
      expect(l).toContain(`«${f.texto}»`);
      expect(l).not.toContain("[[");
    }
  });
});
