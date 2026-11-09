import { describe, expect, it } from "vitest";
import type { ComandosDto } from "../../../src/contracts/comandos.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { comandoNoTexto, listaDaBarra, nomeDigitado, recentesDaConversa } from "../../../web/lib/barra.ts";
import { renderDicaBarra, renderListaBarra } from "../../../web/telas/barra.ts";
import { comChipDeComando } from "../../../web/telas/conversa.ts";

const DTO: ComandosDto = {
  doMacEm: 1,
  doMac: {
    versaoCli: "2.1.284",
    soDoTerminal: ["doctor", "color"],
    comandos: [
      { nome: "review", descricao: "Pre-landing PR review.", origem: "gstack" },
      { nome: "investigate", descricao: "Systematic debugging.", origem: "gstack" },
      { nome: "code-review", descricao: "Revisa um pull request", origem: "Claude Code" },
      { nome: "security-review", descricao: "Revisão de segurança", origem: "Claude Code" },
      { nome: "ship", descricao: "Ship workflow.", origem: "gstack" },
      { nome: "qa", descricao: "QA.", origem: "gstack" },
      { nome: "impeccable-polish", descricao: "Polish.", origem: "impeccable" },
      { nome: "posthog:auditing-endpoints", descricao: "Audita.", origem: "posthog" },
    ],
  },
  daConversa: [
    { nome: "contexto", apelidos: ["context"], descricao: "Quanto da janela", acao: "turno", cli: "/context", gratis: true },
    { nome: "nova-sessao", apelidos: ["clear"], descricao: "Começa do zero", acao: "nod" },
    { nome: "modelo", apelidos: ["model", "effort"], descricao: "Modelo e esforço", acao: "tela" },
  ],
};

const minha = (texto: string): Mensagem => ({ tenantId: "t", id: texto, conversaId: "c", turnoId: null, autoria: { autor_tipo: "pessoa", autor_id: "p" }, kind: "texto", texto, payload: null, confianca: "confiavel", parcial: false, criadoEm: 1 }) as Mensagem;

describe("o / do campo", () => {
  it("a lista abre só enquanto o cursor está no nome depois da barra", () => {
    expect(nomeDigitado("/", 1)).toBe("");
    expect(nomeDigitado("/rev", 4)).toBe("rev");
    expect(nomeDigitado("/review 420", 11)).toBeNull();
    expect(nomeDigitado("oi /rev", 7)).toBeNull();
  });

  it("sem filtro: as que você usou, as da conversa e as primeiras skills, sem repetir", () => {
    const l = listaDaBarra(DTO, "", ["review"]);
    expect(l.itens.map((i) => `${i.grupo}:${i.nome}`)).toEqual([
      "recentes:review",
      "conversa:contexto", "conversa:nova-sessao", "conversa:modelo",
      "skills:investigate", "skills:code-review", "skills:security-review", "skills:ship", "skills:qa",
    ]);
    expect(l.maisSkills).toBe(2);
    expect(l.itens.find((i) => i.nome === "contexto")?.etiqueta).toBe("context · grátis");
  });

  it("filtrando: prefixo antes de trecho; o nome do terminal acha o da conversa", () => {
    expect(listaDaBarra(DTO, "rev", []).itens.map((i) => i.nome)).toEqual(["review", "code-review", "security-review"]);
    expect(listaDaBarra(DTO, "clear", []).itens.map((i) => i.nome)).toEqual(["nova-sessao"]);
    expect(listaDaBarra(DTO, "doctor", []).soDoTerminal).toBe("doctor");
    expect(listaDaBarra(DTO, "revieww", []).itens).toEqual([]);
    expect(listaDaBarra(null, "", []).semCatalogo).toBe(true);
  });

  it("os recentes saem das mensagens da pessoa, do mais novo", () => {
    expect(recentesDaConversa([minha("/review 420"), minha("oi"), minha("/qa"), minha("/review 421")])).toEqual(["review", "qa"]);
  });

  it("o comando no texto: da conversa pelo apelido, skill pelo nome, e o resto como argumento", () => {
    expect(comandoNoTexto(DTO, "/clear")).toMatchObject({ conversa: { nome: "nova-sessao" }, resto: "" });
    expect(comandoNoTexto(DTO, "/review 420, foca no escopo")).toMatchObject({ mac: { nome: "review" }, resto: "420, foca no escopo" });
    expect(comandoNoTexto(DTO, "/nada")).toBeNull();
    expect(comandoNoTexto(DTO, "sem barra")).toBeNull();
  });
});

describe("o / desenhado", () => {
  it("a lista: grupos, destaque do que foi digitado, o selecionado e os casos do canvas", () => {
    const html = renderListaBarra(listaDaBarra(DTO, "rev", ["review"]), { filtro: "rev", selecionado: 0, bot: "Dev 1", doMacEm: null });
    expect(html).toContain("Você usou com Dev 1");
    expect(html).toContain('/<b>rev</b>iew');
    expect(html).toContain('aria-selected="true" data-indice="0" data-nome="review"');
    expect(renderListaBarra(listaDaBarra(DTO, "doctor", []), { filtro: "doctor", selecionado: 0, bot: "Dev 1", doMacEm: null })).toContain("é só do terminal");
    expect(renderListaBarra(listaDaBarra(DTO, "revieww", []), { filtro: "revieww", selecionado: 0, bot: "Dev 1", doMacEm: null })).toContain("Nenhum comando com “revieww”");
  });

  it("a dica do comando escrito e o chip na mensagem, com o texto escapado", () => {
    expect(renderDicaBarra(comandoNoTexto(DTO, "/review ")!, "Dev 1")).toContain("gstack · roda no seu Mac · escreva o que ela recebe");
    expect(renderDicaBarra(comandoNoTexto(DTO, "/clear")!, "Dev 1")).toContain("acontece na hora, sem turno");
    expect(comChipDeComando("/review 420 <b>")).toBe('<span class="chip-comando">/review</span> 420 &lt;b&gt;');
    expect(comChipDeComando("sem comando")).not.toContain("chip-comando");
  });
});

describe("ADR-125 (NOD-349): Planejar e Pedir ajuda no / da conversa", () => {
  it("na conversa com bot, os atalhos vêm primeiro e trazem o texto que entra no campo", () => {
    const l = listaDaBarra(DTO, "", [], true);
    expect(l.itens.slice(0, 2).map((i) => [i.nome, i.grupo])).toEqual([["planejar", "atalhos"], ["pedir-ajuda", "atalhos"]]);
    expect(l.itens[0]?.texto).toBe("Me ajude a planejar esta tarefa: ");
  });

  it("o filtro vale para os atalhos; fora da conversa (sem comAtalhos) eles não aparecem", () => {
    expect(listaDaBarra(DTO, "plan", [], true).itens.map((i) => i.nome)).toContain("planejar");
    expect(listaDaBarra(DTO, "plan", [], true).itens.map((i) => i.nome)).not.toContain("pedir-ajuda");
    expect(listaDaBarra(DTO, "", []).itens.some((i) => i.grupo === "atalhos")).toBe(false);
  });
});

describe("NOD-23: /configurar só na conversa com bot próprio", () => {
  const COM_CONFIGURAR: ComandosDto = { ...DTO, daConversa: [...DTO.daConversa, { nome: "configurar", apelidos: ["setup", "config"], descricao: "O bot te entrevista e propõe um perfil novo", acao: "turno", soBotProprio: true }] };
  it("bot próprio vê; o Nod, bot alheio ou tela sem bot não", () => {
    expect(listaDaBarra(COM_CONFIGURAR, "setup", [], true, true).itens.map((i) => i.nome)).toContain("configurar");
    expect(listaDaBarra(COM_CONFIGURAR, "conf", [], true, true).itens.map((i) => i.nome)).toContain("configurar");
    expect(listaDaBarra(COM_CONFIGURAR, "conf", [], true, false).itens.map((i) => i.nome)).not.toContain("configurar");
    expect(listaDaBarra(COM_CONFIGURAR, "", []).itens.map((i) => i.nome)).not.toContain("configurar");
  });
});
