import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as ouvir from "../../../web/lib/ouvir.ts";
import type { ContextoDeAudio, LeituraAtual, MotivoParada } from "../../../web/lib/ouvir.ts";

/**
 * NOD-106, ressalvas de leitor de tela do Gil no PR #381 (comentário 6230353689):
 * 1. a falha antes do som é anunciada como falha ("Não deu para ouvir agora."), não como "Leitura parada.";
 * 2. no 409 sem consentimento, nada de "Leitura parada." solto antes do diálogo abrir.
 */

function contexto(): ContextoDeAudio {
  return {
    currentTime: 0,
    state: "running",
    destination: {},
    resume: () => Promise.resolve(),
    createBuffer: () => ({ duration: 0, getChannelData: () => new Float32Array(0) }),
    createBufferSource: () => ({ buffer: null, onended: null, connect: () => undefined, start: () => undefined, stop: () => undefined }),
  };
}

/** O que `#anuncio-leitura` diria a cada mudança do tocador (o mesmo caminho de `aoMudarLeitura` em web/main.ts). */
async function anunciosDe(resposta: () => Promise<Response>): Promise<{ resultado: unknown; anuncios: string[] }> {
  const anuncios: string[] = [];
  const t = ouvir.criarTocadorDeLeitura({
    fetch: () => resposta(),
    criarContexto: contexto,
    aoMudar: (atual: LeituraAtual | null, motivo?: MotivoParada) => {
      const texto = ouvir.anuncioDaLeitura(atual, motivo);
      if (texto !== null) anuncios.push(texto);
    },
  });
  const resultado = await t.ouvir("t", "m1");
  return { resultado, anuncios };
}

describe("leitor de tela: falha e 409 do Ouvir (ressalvas do Gil)", () => {
  it("1. falha antes do som não anuncia 'Leitura parada.'; mostrarFalhaLeitura anuncia a falha", async () => {
    for (const resposta of [() => Promise.resolve(Response.json({ codigo: "x" }, { status: 502 })), () => Promise.reject(new TypeError("rede"))]) {
      const { resultado, anuncios } = await anunciosDe(resposta);
      expect(resultado).toEqual({ ok: false, motivo: "falha" });
      expect(anuncios).toEqual(["Carregando a leitura."]);
    }
    expect(ouvir.TEXTO_FALHA_LEITURA).toBe("Não deu para ouvir agora.");
    const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
    expect(main).toMatch(/function mostrarFalhaLeitura\([^)]*\): void \{[\s\S]{0,300}getElementById\("anuncio-leitura"\)[\s\S]{0,120}textContent = TEXTO_FALHA_LEITURA/);
  });

  it("2. 409 sem consentimento: nenhum anúncio de parada antes do diálogo", async () => {
    const { resultado, anuncios } = await anunciosDe(() => Promise.resolve(Response.json({ codigo: "estado_invalido" }, { status: 409 })));
    expect(resultado).toEqual({ ok: false, motivo: "sem_consentimento" });
    expect(anuncios).toEqual(["Carregando a leitura."]);
  });

  it("o resto continua anunciado como antes", () => {
    expect(ouvir.anuncioDaLeitura({ mensagemId: "m1", fase: "carregando" })).toBe("Carregando a leitura.");
    expect(ouvir.anuncioDaLeitura({ mensagemId: "m1", fase: "tocando" })).toBe("Lendo a resposta.");
    for (const m of ["parou", "trocou", "saiu", "ligacao"] as const) expect(ouvir.anuncioDaLeitura(null, m)).toBe("Leitura parada.");
    expect(ouvir.anuncioDaLeitura(null, "terminou")).toBe("Leitura terminada.");
    expect(ouvir.anuncioDaLeitura(null)).toBeNull();
    expect(ouvir.anuncioDaLeitura(null, "falhou")).toBeNull();
    expect(ouvir.anuncioDaLeitura(null, "sem_consentimento")).toBeNull();
  });
});
