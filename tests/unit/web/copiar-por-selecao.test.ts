import { describe, expect, it } from "vitest";
import { copiarPorSelecao, type DocParaCopiar } from "../../../web/lib/copiar-por-selecao.ts";

/** QA do PR #608 (NOD-84): quando a API da área de transferência falha, o Copiar tenta pela seleção e não deixa o endereço no HTML. */
function doc(copia: boolean | "lanca") {
  const noCorpo: { value: string }[] = [];
  let copiado = "";
  const d: DocParaCopiar = {
    createElement: () => {
      const c = {
        value: "",
        style: { position: "", left: "", opacity: "" },
        setAttribute: () => undefined,
        select: () => undefined,
        remove: () => void noCorpo.splice(noCorpo.indexOf(c), 1),
      };
      return c;
    },
    body: { appendChild: (c) => noCorpo.push(c) },
    execCommand: () => {
      if (copia === "lanca") throw new Error("negado");
      if (copia) copiado = noCorpo[0]?.value ?? "";
      return copia;
    },
  };
  return { d, noCorpo, copiado: () => copiado };
}

describe("copiarPorSelecao", () => {
  it("copia o texto e tira o campo do documento na hora", () => {
    const t = doc(true);
    expect(copiarPorSelecao(t.d, "https://x/api/w/gt_a.b")).toBe(true);
    expect(t.copiado()).toBe("https://x/api/w/gt_a.b");
    expect(t.noCorpo).toHaveLength(0);
  });

  it("navegador que recusa (false ou exceção): devolve false e também não deixa o campo", () => {
    for (const c of [false, "lanca"] as const) {
      const t = doc(c);
      expect(copiarPorSelecao(t.d, "gt_a.b")).toBe(false);
      expect(t.noCorpo).toHaveLength(0);
    }
  });
});
