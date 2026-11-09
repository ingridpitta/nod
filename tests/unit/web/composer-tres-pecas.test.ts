import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { htmlComposer } from "../../../web/telas/conversa.ts";

/** ADA-2 F5 (ADR-156 §5): no celular, o composer em três peças, + · campo · mic/enviar, sem mudar a árvore do computador. */
const css = readFileSync(new URL("../../../web/celular-base.css", import.meta.url), "utf8");
const query = css.slice(css.indexOf("@media (hover: none) and (pointer: coarse)"));
const regra = (seletor: string): string => {
  const i = query.indexOf(`\n  ${seletor} {`);
  if (i < 0) throw new Error(`sem a regra ${seletor}`);
  return query.slice(i, query.indexOf("}", i));
};

describe("composer de três peças no celular", () => {
  it("a árvore continua a mesma: + antes do texto, mic e enviar depois (a ordem de foco segue a visual)", () => {
    const html = htmlComposer("Mensagem", [], { anexos: "tudo", aprovacao: true, bot: "Ze" });
    const pos = (s: string) => html.indexOf(s);
    expect(pos('class="mais-campo"')).toBeGreaterThan(-1);
    expect(pos('class="mais-campo"')).toBeLessThan(pos("<textarea"));
    expect(pos("<textarea")).toBeLessThan(pos('class="mic"'));
    expect(pos('class="mic"')).toBeLessThan(pos('class="parar-envio"'));
    expect(pos('class="parar-envio"')).toBeLessThan(pos('class="send"'));
  });

  it("a pílula é o ::before da .box, entre os dois redondos (46 + 6), com o vidro do topo", () => {
    const pilula = regra(".composer .box:not(.gravando)::before");
    expect(pilula).toContain("inset: 0 calc(var(--cmp-redondo) + var(--cmp-vao))");
    expect(pilula).toContain("border-radius: 23px");
    expect(pilula).toContain("backdrop-filter: blur(20px) saturate(1.6)");
    expect(regra(".composer")).toContain("--cmp-redondo: 46px");
    expect(regra(".composer")).toContain("--cmp-vidro: color-mix(in srgb, var(--surface) 72%, transparent)");
    // A própria .box perde a borda e o fundo (senão seriam duas pílulas).
    expect(regra(".composer .box:not(.gravando)")).toMatch(/border: 0;[^}]*background: none;/);
  });

  it("sem o +, a pílula começa na borda esquerda", () => {
    expect(query).toContain(".composer .box:not(.gravando):not(.com-mais)::before, .composer .box:not(.gravando):has(> .mais-campo[hidden])::before { left: 0; }");
  });

  it("o enviar é contorno --ink 1.5 px, transparente, 46; + e mic são redondos de vidro de 46", () => {
    const enviar = regra(".composer .box:not(.gravando) > .send");
    expect(enviar).toContain("width: var(--cmp-redondo)");
    expect(enviar).toContain("border: 1.5px solid var(--ink)");
    expect(enviar).toContain("background: transparent");
    const redondos = regra(".composer .box:not(.gravando) > .mais-campo, .composer .box:not(.gravando) > .mic");
    expect(redondos).toContain("border-radius: 50%");
    expect(redondos).toContain("background: var(--cmp-vidro)");
  });

  it("a gravação do ditado não ganha a pílula (ela tem o próprio layout)", () => {
    expect(query).not.toMatch(/\.composer \.box\.gravando::before/);
    expect(query).toMatch(/\.composer \.box:not\(\.gravando\)::before/);
  });

  it("a troca mic ↔ enviar e o 'sem ditado, enviar sempre' continuam os da mobile.css (nada regravado)", () => {
    const mobile = readFileSync(new URL("../../../web/mobile.css", import.meta.url), "utf8");
    expect(mobile).toContain(".composer .box:not(.gravando):has(.mic:not([hidden])):has(textarea:placeholder-shown):not(:has(.anexos-fila:not([hidden]))) .send { display: none; }");
    expect(mobile).toContain(".composer .box:has(textarea:not(:placeholder-shown)) .mic");
    expect(mobile).toMatch(/max-height: calc\(6 \* 22px \+ 22px\)/);
  });
});

describe("o mesmo composer na pílula do quadro e da tarefa (S6)", () => {
  it("o clipe leva o + do celular, com o mesmo data-act (o + abre o seletor direto: a folha teria um item só)", async () => {
    const { pilulaDoQuadro } = await import("../../../web/telas/quadro-real.ts");
    const html = String(pilulaDoQuadro({ meta: null, nome: "Ada", anexos: "tudo" }));
    expect(html).toMatch(/<button type="button" class="qc-bt qc-clipe" data-act="anexar" data-composer="clipe" aria-label="Anexar arquivo"><svg[^>]*>.*<\/svg><svg class="qc-ic-mais"/);
    const quadro = readFileSync(new URL("../../../web/quadro.css", import.meta.url), "utf8");
    expect(quadro).toContain(".qc-clipe .qc-ic-mais { display: none; }");
    expect(query).toContain(".qc-clipe .qc-ic-mais { display: block; }");
    expect(query).toContain(".qc-clipe svg:not(.qc-ic-mais) { display: none; }");
  });

  it("a pílula do quadro é o ::before, entre o + e a ponta; sem anexo, começa na borda", () => {
    expect(regra(".qc-pil:not(.gravando)::before")).toContain("inset: 0 calc(var(--cmp-redondo) + var(--cmp-vao))");
    expect(query).toContain(".qc-pil:not(.gravando):not(:has(> .qc-clipe))::before { left: 0; }");
    expect(regra(".qc-pil:not(.gravando)")).toMatch(/border: 0;[^}]*background: none;/);
  });

  it("o enviar do quadro em contorno (sem o círculo cheio da quadro.css) e o mic redondo de vidro", () => {
    const enviar = regra(".qc-pil:not(.gravando) > .qc-bt.qc-enviar");
    expect(enviar).toContain("border: 1.5px solid var(--ink)");
    expect(enviar).toContain("background: transparent");
    expect(query).toContain(".qc-pil:not(.gravando) > .qc-bt.qc-enviar::before { content: none; }");
    expect(regra(".qc-pil:not(.gravando) > .qc-clipe, .qc-pil:not(.gravando) > .mic")).toContain("background: var(--cmp-vidro)");
  });
});
