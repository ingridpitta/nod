import { describe, expect, it } from "vitest";
import type { ConexaoApp } from "../../../web/estado/reducer.ts";
import { criarConexoes, FALHA_APP, FALHA_COMPOSIO } from "../../../web/lib/conexao.ts";

// QA do PR #288 (NOD-212), Teodora, 2026-10-12: a web só mostra FALHA_COMPOSIO com causa "composio"; "app", null ou
// ausente (servidor antigo) continuam em FALHA_APP.
async function falhaCom(causa: "composio" | "app" | null | undefined) {
  let agora = 0;
  const mudancas: [string, ConexaoApp | null][] = [];
  const conexoes = criarConexoes({
    conectar: async () => ({ url: "https://login.exemplo/x" }),
    verificar: async () => ({ conectado: false, falhou: true, ...(causa === undefined ? {} : { causa }) }),
    mudou: (slug, valor) => void mudancas.push([slug, valor]),
    conectado: () => undefined,
    abrirJanela: () => ({ closed: false, location: { href: "" }, close() { /* janela falsa */ } }),
    esperar: async (ms) => void (agora += ms),
    agora: () => agora,
  });
  await conexoes.iniciar("slack");
  return (mudancas.at(-1)?.[1] as { falhou?: string } | null)?.falhou;
}

describe("QA #288 item 3 (web): mensagem do Composio só com causa composio", () => {
  it.each([
    { causa: "composio" as const, frase: FALHA_COMPOSIO },
    { causa: "app" as const, frase: FALHA_APP },
    { causa: null, frase: FALHA_APP },
    { causa: undefined, frase: FALHA_APP },
  ])("causa $causa → $frase", async ({ causa, frase }) => {
    expect(await falhaCom(causa)).toBe(frase);
  });
});
