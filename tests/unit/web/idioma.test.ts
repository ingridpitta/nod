import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Varredura pt-BR (NOD-174): a interface do nod é em português. O menu do Mac saía "Edit / Undo / Quit" e o banner da
 * web "falha_interna — falha"; nada impedia a volta. Este teste é o que impede: uma palavra de interface em inglês
 * dentro de uma string (ou de um texto entre tags) em web/ ou desktop/ quebra, a não ser numa linha marcada com
 * "idioma-fixo: <motivo>" — nome de produto, rótulo que o macOS exige, texto que nunca chega à pessoa.
 *
 * Molde: cores-por-token.test.ts. Comentário não conta; identificador também não (só o que está entre aspas ou entre
 * `>` e `<`). Nomes próprios (Claude, Codex, Harness) ficam fora da lista de propósito.
 */
const RAIZ = fileURLToPath(new URL("../../../", import.meta.url));
const PASTAS = ["web", "desktop"] as const;
const EXTENSOES = /\.(?:ts|js|html)$/;
const FORA = /(?:^|\/)(?:vendor|public|resources)(?:\/|$)|\.d\.ts$|\.worklet\.ts$/;

/** Palavras de interface em inglês. Maiúscula na frente: o que aparece em botão, título e aviso. */
const PROIBIDAS = [
  "Error", "Failed", "Failure", "Loading", "Cancel", "Retry", "Settings", "Preferences", "Quit", "Save", "Delete",
  "Close", "Submit", "Undo", "Redo", "Cut", "Copy", "Paste", "Select All", "Reload", "Zoom In", "Zoom Out",
  "Actual Size", "Full Screen", "Edit", "View", "Window", "Help", "Search", "Send", "Open", "Back", "Next", "Done",
  "Warning", "Success", "Unknown", "Untitled", "Please", "Sorry", "Something went wrong", "Try again", "Sign in",
  "Log in", "Logout",
] as const;
const PALAVRA = new RegExp(`\\b(?:${PROIBIDAS.map((p) => p.replace(" ", "\\s+")).join("|")})\\b`);

/** Trechos onde a pessoa lê texto: entre aspas da mesma espécie, ou entre o fim de uma tag e o começo da próxima. */
const TRECHOS = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|>[^<>]*</g;
const COMENTARIO = /^\s*(?:\/\/|\/?\*|<!--)/;
/** Código fechado escrito direto na tela ("<td>erro_execucao</td>", title="falha_interna"): a pessoa lê o enum. */
const CODIGO_VISIVEL = /(?:>|\b(?:title|aria-label)=")[a-z]+_[a-z_]+(?:<|")/;

/** Linhas de um arquivo que mostram inglês (ou um código cru) à pessoa. O caso plantado prova que o teste morde. */
function achados(nome: string, texto: string): string[] {
  return texto
    .split("\n")
    .map((linha, i) => ({ linha, n: i + 1 }))
    .filter(({ linha }) => !COMENTARIO.test(linha) && !linha.includes("idioma-fixo:"))
    .filter(({ linha }) => CODIGO_VISIVEL.test(linha) || (linha.replace(/\s\/\/\s.*$/, "").match(TRECHOS) ?? []).some((t) => PALAVRA.test(t)))
    .map(({ linha, n }) => `${nome}:${n} ${linha.trim().slice(0, 140)}`);
}

function arquivos(pasta: string): string[] {
  return readdirSync(join(RAIZ, pasta), { recursive: true, encoding: "utf8" })
    .map((r) => join(pasta, r))
    .filter((r) => EXTENSOES.test(r) && !FORA.test(r) && !/\.test\.ts$/.test(r));
}

describe("interface só em pt-BR", () => {
  it("o teste morde: uma string plantada em inglês é achada, a mesma com idioma-fixo passa, comentário não conta", () => {
    expect(achados("plantado.ts", 'const rotulo = "Cancel";')).toHaveLength(1);
    expect(achados("plantado.ts", "return `<button>Retry</button>`;")).toHaveLength(1);
    expect(achados("plantado.html", "  <h1>Something went wrong</h1>")).toHaveLength(1);
    expect(achados("plantado.ts", "  { label: 'Quit' },")).toHaveLength(1);
    expect(achados("plantado.ts", 'const rotulo = "Cancel"; // idioma-fixo: exemplo')).toEqual([]);
    expect(achados("plantado.ts", "// Cancel aqui é comentário")).toEqual([]);
    expect(achados("plantado.ts", 'if (e.name === "AbortError") return;')).toEqual([]);
    expect(achados("plantado.ts", 'const rotulo = "Cancelar";')).toEqual([]);
    expect(achados("plantado.ts", "return `<span>erro_execucao</span>`;")).toHaveLength(1);
    expect(achados("plantado.ts", 'return `<span title="falha_interna">x</span>`;')).toHaveLength(1);
  });

  for (const pasta of PASTAS) {
    it(`${pasta}/ não mostra inglês fora de linha marcada com idioma-fixo`, () => {
      const lista = arquivos(pasta);
      expect(lista.length).toBeGreaterThan(0);
      const soltos = lista.flatMap((r) => achados(relative(RAIZ, join(RAIZ, r)), readFileSync(join(RAIZ, r), "utf8")));
      expect(soltos).toEqual([]);
    });
  }
});
