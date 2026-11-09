import { describe, expect, it } from "vitest";
import {
  contaDoTurno,
  decidirAnuncio,
  decidirLimiteDaConta,
  fraseDoLimiteDaConta,
  ordemIasDaLista,
  textoDaImpressaoDaConta,
  vinculoSegueSemAcesso,
  voltaDaIa,
  type ContaDaPessoa,
} from "../../../src/domain/contas-da-pessoa.ts";

const AGORA = 1_760_000_000_000;
const HORA = 3_600_000;
const conta = (id: string, ia: ContaDaPessoa["ia"], posicao: number, extra: Partial<ContaDaPessoa> = {}): ContaDaPessoa => ({
  id, ia, apelido: id, plano: "Max", corporativa: false, posicao, entraNaTrocaAutomatica: false, noLimiteAte: null, removidaEm: null, ...extra,
});
/**
 * O exemplo do Marlon (13/10): Claude · Pessoal, ChatGPT · Pessoal, Claude · Lumen (Team), Claude · Pessoal Lumen. Como a
 * 0080 deixa (ADR-108): a 1ª pessoal de cada IA na fila; a 2ª pessoal e a corporativa fora.
 */
const lista = (extra: Record<string, Partial<ContaDaPessoa>> = {}): ContaDaPessoa[] => [
  conta("c-pessoal", "claude-cli", 1, { entraNaTrocaAutomatica: true, ...extra["c-pessoal"] }),
  conta("g-pessoal", "codex-cli", 2, { entraNaTrocaAutomatica: true, ...extra["g-pessoal"] }),
  conta("c-lumen", "claude-cli", 3, { corporativa: true, plano: "Team", ...extra["c-lumen"] }),
  conta("c-pessoal-lumen", "claude-cli", 4, extra["c-pessoal-lumen"]),
];
const todas = new Set(["c-pessoal", "g-pessoal", "c-lumen", "c-pessoal-lumen"]);
const turno = (contas: ContaDaPessoa[], extra: Partial<Parameters<typeof contaDoTurno>[0]> = {}) =>
  contaDoTurno({ contas, naMaquina: todas, escolhidas: {}, ordemDoBot: null, agora: AGORA, ...extra });

describe("textoDaImpressaoDaConta", () => {
  it("a mesma conta dá o mesmo texto com e-mail em outra caixa; outra pessoa ou outra organização mudam o texto", () => {
    const base = { pessoaId: "p1", ia: "claude-cli" as const, email: "Pessoa1@exemplo.com ", orgId: "org-1" };
    expect(textoDaImpressaoDaConta(base)).toBe(textoDaImpressaoDaConta({ ...base, email: "pessoa1@exemplo.com" }));
    expect(textoDaImpressaoDaConta(base)).not.toBe(textoDaImpressaoDaConta({ ...base, pessoaId: "p2" }));
    expect(textoDaImpressaoDaConta(base)).not.toBe(textoDaImpressaoDaConta({ ...base, orgId: "org-2" }));
    expect(textoDaImpressaoDaConta(base)).not.toBe(textoDaImpressaoDaConta({ ...base, ia: "codex-cli" }));
  });
});

describe("contaDoTurno", () => {
  it("máquina sem conta anunciada: null (segue como hoje)", () => {
    expect(turno(lista(), { naMaquina: new Set() })).toBeNull();
  });

  it("a lista intercalada decide: a 1ª conta responde e a ordem das IAs segue a posição da conta em uso", () => {
    const r = turno(lista())!;
    expect(r.porIa["claude-cli"]?.id).toBe("c-pessoal");
    expect(r.porIa["codex-cli"]?.id).toBe("g-pessoal");
    expect(r.ordemIas).toEqual(["claude-cli", "codex-cli"]);
    expect(r.iasSemConta).toEqual([]);
  });

  it("a 1ª do Claude no limite sem outra do Claude na fila: o Claude fica sem conta e o ChatGPT assume (outra IA, no Automático)", () => {
    const r = turno(lista({ "c-pessoal": { noLimiteAte: AGORA + HORA } }))!;
    expect(r.porIa["claude-cli"]).toBeNull();
    expect(r.ordemIas).toEqual(["codex-cli"]);
    expect(r.iasSemConta).toEqual(["claude-cli"]);
  });

  it("a escolhida pela pessoa vale enquanto a 1ª da IA está no limite, e a 1ª volta sozinha quando renova", () => {
    const noLimite = lista({ "c-pessoal": { noLimiteAte: AGORA + HORA } });
    expect(turno(noLimite, { escolhidas: { "claude-cli": "c-pessoal-lumen" } })!.porIa["claude-cli"]?.id).toBe("c-pessoal-lumen");
    expect(turno(lista({ "c-pessoal": { noLimiteAte: AGORA - 1 } }), { escolhidas: { "claude-cli": "c-pessoal-lumen" } })!.porIa["claude-cli"]?.id).toBe("c-pessoal");
  });

  it("ADR-108 (R1): a lista é a fila — passa sozinho para a próxima NA FILA, em ordem; a fora da fila (pessoal ou corporativa) é pulada", () => {
    const noLimite = lista({ "c-pessoal": { noLimiteAte: AGORA + HORA }, "c-pessoal-lumen": { entraNaTrocaAutomatica: true } });
    expect(turno(noLimite)!.porIa["claude-cli"]?.id).toBe("c-pessoal-lumen");
    const corporativaNaFila = lista({ "c-pessoal": { noLimiteAte: AGORA + HORA }, "c-lumen": { entraNaTrocaAutomatica: true }, "c-pessoal-lumen": { entraNaTrocaAutomatica: true } });
    expect(turno(corporativaNaFila)!.porIa["claude-cli"]?.id).toBe("c-lumen");
    // Fora da fila, nunca sozinha (nem a pessoal): sem outra na fila, o Claude fica sem conta.
    expect(turno(lista({ "c-pessoal": { noLimiteAte: AGORA + HORA } }))!.porIa["claude-cli"]).toBeNull();
  });

  it("ADR-108 (E4): a 1ª da fila livre vale mesmo que outra da IA venha antes na lista fora da fila", () => {
    const l = [conta("c-fora", "claude-cli", 1), conta("c-fila", "claude-cli", 2, { entraNaTrocaAutomatica: true })];
    expect(turno(l, { naMaquina: new Set(["c-fora", "c-fila"]) })!.porIa["claude-cli"]?.id).toBe("c-fila");
  });

  it("ADR-108 (E4): nenhuma conta da IA na fila nesta máquina — a 1ª dela aqui, para a pessoa nunca ficar sem IA; a escolhida vem antes", () => {
    const l = [conta("c-a", "claude-cli", 1), conta("c-b", "claude-cli", 2)];
    expect(turno(l, { naMaquina: new Set(["c-a", "c-b"]) })!.porIa["claude-cli"]?.id).toBe("c-a");
    expect(turno(l, { naMaquina: new Set(["c-a", "c-b"]), escolhidas: { "claude-cli": "c-b" } })!.porIa["claude-cli"]?.id).toBe("c-b");
    // A 1ª no limite: a 2ª (fora da fila) não entra sozinha.
    expect(turno([conta("c-a", "claude-cli", 1, { noLimiteAte: AGORA + HORA }), conta("c-b", "claude-cli", 2)], { naMaquina: new Set(["c-a", "c-b"]) })!.porIa["claude-cli"]).toBeNull();
  });

  it("só as contas logadas na máquina contam: sem a da fila aqui, a 1ª do Claude NESTA máquina é a preferida dela", () => {
    const r = turno(lista(), { naMaquina: new Set(["g-pessoal", "c-lumen"]) })!;
    expect(r.porIa["claude-cli"]?.id).toBe("c-lumen");
    expect(r.ordemIas).toEqual(["codex-cli", "claude-cli"]);
  });

  it("a ordem própria do bot manda entre as IAs; conta removida não entra", () => {
    expect(turno(lista(), { ordemDoBot: ["codex-cli", "claude-cli"] })!.ordemIas).toEqual(["codex-cli", "claude-cli"]);
    const semPessoal = lista({ "c-pessoal": { removidaEm: AGORA - HORA } });
    expect(turno(semPessoal)!.porIa["claude-cli"]?.id).toBe("c-lumen");
  });
});

describe("decidirLimiteDaConta", () => {
  const base = { naMaquina: todas, noutraMaquina: new Map(), escolhidas: {}, ordemDoBot: null, agora: AGORA };

  it("sem outra conta do Claude na fila e com outra IA em uso na máquina, troca de provedor sozinha (no Automático)", () => {
    const r = decidirLimiteDaConta({ ...base, contas: lista(), contaId: "c-pessoal", ate: AGORA + 2 * HORA });
    expect(r.decisao).toMatchObject({ tipo: "outra_ia", para: { id: "g-pessoal" } });
    expect(r.contas.find((c) => c.id === "c-pessoal")?.noLimiteAte).toBe(AGORA + 2 * HORA);
  });

  it("ADR-108 (R1): com outra conta do MESMO provedor na fila, segue nela sem perguntar, antes de mudar de IA", () => {
    const r = decidirLimiteDaConta({ ...base, contas: lista({ "c-pessoal-lumen": { entraNaTrocaAutomatica: true } }), contaId: "c-pessoal", ate: AGORA + HORA });
    expect(r.decisao).toMatchObject({ tipo: "trocou", para: { id: "c-pessoal-lumen" } });
  });

  it("ADR-108 (R2): com a IA fixa, nunca devolve outra_ia — segue na fila dela ou pergunta só com as contas dela", () => {
    const comFila = decidirLimiteDaConta({ ...base, iaFixa: "claude-cli", contas: lista({ "c-pessoal-lumen": { entraNaTrocaAutomatica: true } }), contaId: "c-pessoal", ate: AGORA + HORA });
    expect(comFila.decisao).toMatchObject({ tipo: "trocou", para: { id: "c-pessoal-lumen" } });
    const semFila = decidirLimiteDaConta({ ...base, iaFixa: "claude-cli", contas: lista(), contaId: "c-pessoal", ate: AGORA + HORA });
    expect(semFila.decisao.tipo).toBe("perguntar");
    if (semFila.decisao.tipo === "perguntar") expect(semFila.decisao.livres.map((c) => c.ia)).toEqual(["claude-cli", "claude-cli"]);
    // Todas do Claude no limite, com o ChatGPT livre: todas no limite (a volta do Claude), nunca o ChatGPT.
    const todasDoClaude = lista({ "c-lumen": { noLimiteAte: AGORA + 2 * HORA }, "c-pessoal-lumen": { noLimiteAte: AGORA + 3 * HORA } });
    const r = decidirLimiteDaConta({ ...base, iaFixa: "claude-cli", contas: todasDoClaude, contaId: "c-pessoal", ate: AGORA + HORA });
    expect(r.decisao).toEqual({ tipo: "todas_no_limite", voltaEm: AGORA + HORA });
    // Sem a IA fixa, as mesmas contas trocam de IA.
    expect(decidirLimiteDaConta({ ...base, contas: todasDoClaude, contaId: "c-pessoal", ate: AGORA + HORA }).decisao.tipo).toBe("outra_ia");
  });

  it("sem outra IA e sem outra conta na fila: pergunta com as livres (fora da fila), dizendo onde cada uma está", () => {
    const contas = lista({ "g-pessoal": { noLimiteAte: AGORA + HORA } });
    const r = decidirLimiteDaConta({ ...base, contas, naMaquina: new Set(["c-pessoal", "g-pessoal", "c-lumen"]), noutraMaquina: new Map([["c-pessoal-lumen", { id: "m-mac", nome: "MacBook" }]]), contaId: "c-pessoal", ate: AGORA + HORA });
    expect(r.decisao).toEqual({
      tipo: "perguntar",
      livres: [
        { id: "c-lumen", apelido: "c-lumen", ia: "claude-cli", naMaquina: true, outraMaquina: null },
        { id: "c-pessoal-lumen", apelido: "c-pessoal-lumen", ia: "claude-cli", naMaquina: false, outraMaquina: { id: "m-mac", nome: "MacBook" } },
      ],
    });
  });

  it("todas no limite: a volta mais cedo; sem horário do fornecedor, a conta fica 1 h", () => {
    const contas = lista({ "g-pessoal": { noLimiteAte: AGORA + 3 * HORA }, "c-lumen": { noLimiteAte: AGORA + 2 * HORA }, "c-pessoal-lumen": { noLimiteAte: AGORA + 5 * HORA } });
    const r = decidirLimiteDaConta({ ...base, contas, contaId: "c-pessoal", ate: null });
    expect(r.decisao).toEqual({ tipo: "todas_no_limite", voltaEm: AGORA + HORA });
  });

  it("a escolha antiga da IA não sobrevive ao limite: pergunta de novo", () => {
    const contas = lista({ "c-pessoal": { noLimiteAte: AGORA + HORA }, "g-pessoal": { noLimiteAte: AGORA + HORA } });
    const r = decidirLimiteDaConta({ ...base, contas, escolhidas: { "claude-cli": "c-pessoal-lumen" }, contaId: "c-pessoal-lumen", ate: AGORA + HORA });
    expect(r.decisao.tipo).toBe("perguntar");
  });
});

describe("ordemIasDaLista e decidirAnuncio", () => {
  it("a ordem das IAs é a da primeira aparição na lista, depois as que faltam", () => {
    const l = [conta("g", "codex-cli", 1), conta("c", "claude-cli", 2)];
    expect(ordemIasDaLista(l, ["claude-cli", "codex-cli", "cursor-cli"])).toEqual(["codex-cli", "claude-cli", "cursor-cli"]);
    expect(ordemIasDaLista([], ["claude-cli", "codex-cli"])).toEqual(["claude-cli", "codex-cli"]);
  });

  it("conta removida só volta com um login mais novo que a remoção (R4); senão a máquina sai dela", () => {
    expect(decidirAnuncio(null, AGORA)).toBe("criar");
    expect(decidirAnuncio({ removidaEm: null }, AGORA)).toBe("atualizar");
    expect(decidirAnuncio({ removidaEm: AGORA }, AGORA - HORA)).toBe("sair");
    expect(decidirAnuncio({ removidaEm: AGORA - HORA }, AGORA)).toBe("voltar");
  });
});

describe("voltaDaIa (ADR-108 R4)", () => {
  it("a volta é a da primeira conta da fila que sai do limite; com uma livre (ou sem conta da IA), null", () => {
    const l = lista({ "c-pessoal": { noLimiteAte: AGORA + 3 * HORA }, "c-pessoal-lumen": { entraNaTrocaAutomatica: true, noLimiteAte: AGORA + 2 * HORA } });
    // A corporativa fora da fila e livre não conta: a IA "volta" quando a fila volta.
    expect(voltaDaIa(l, "claude-cli", AGORA)).toBe(AGORA + 2 * HORA);
    expect(voltaDaIa(lista(), "claude-cli", AGORA)).toBeNull();
    expect(voltaDaIa([conta("g", "codex-cli", 1)], "claude-cli", AGORA)).toBeNull();
    // Sem conta da IA na fila: vale qualquer uma dela.
    expect(voltaDaIa([conta("c-a", "claude-cli", 1, { noLimiteAte: AGORA + HORA })], "claude-cli", AGORA)).toBe(AGORA + HORA);
  });
});

describe("fraseDoLimiteDaConta", () => {
  const p = { maquina: "vm-bots", quando: () => "14:00", quandoVolta: () => "às 14:00", voltaEm: AGORA + HORA };
  const de = { ia: "claude-cli" as const, apelido: "Pessoal" };
  it("cita a conta pelo apelido e a máquina", () => {
    expect(fraseDoLimiteDaConta(de, { tipo: "outra_ia", para: conta("Pessoal", "codex-cli", 2) }, p)).toBe("Claude · Pessoal no limite na vm-bots até 14:00. Seguindo com ChatGPT · Pessoal.");
    expect(fraseDoLimiteDaConta(de, { tipo: "perguntar", livres: [{ id: "x", apelido: "Lumen", ia: "claude-cli", naMaquina: true, outraMaquina: null }] }, p)).toBe("Claude · Pessoal no limite na vm-bots até 14:00. Seguir com Claude · Lumen?");
    expect(fraseDoLimiteDaConta(de, { tipo: "perguntar", livres: [{ id: "x", apelido: "Freela", ia: "claude-cli", naMaquina: false, outraMaquina: null }] }, p)).toBe("Claude · Pessoal no limite na vm-bots até 14:00. Claude · Freela está livre, mas não está na vm-bots.");
    expect(fraseDoLimiteDaConta(de, { tipo: "todas_no_limite", voltaEm: AGORA + HORA }, p)).toBe("Todas as suas contas estão no limite. A primeira volta às 14:00.");
  });

  it("NOD-284: na sala a troca não refaz sozinha — a frase pede para falar de novo", () => {
    expect(fraseDoLimiteDaConta(de, { tipo: "outra_ia", para: conta("Pessoal", "codex-cli", 2) }, { ...p, origem: "sala" })).toBe("Claude · Pessoal no limite na vm-bots até 14:00. Fale de novo para seguir com ChatGPT · Pessoal.");
  });

  it("ADR-108 (R7): na mesma IA a linha é leve — quem acabou, quando, e com quem seguiu no mesmo modelo", () => {
    const d = { tipo: "trocou" as const, para: conta("Marlon 20x", "claude-cli", 4) };
    expect(fraseDoLimiteDaConta({ ia: "claude-cli", apelido: "marlonwlv (20x)" }, d, { ...p, quando: () => "20:39", acabouEm: AGORA })).toBe("marlonwlv (20x) acabou às 20:39 → seguindo no Claude · Marlon 20x · mesmo modelo");
  });
});

describe("bot preso a uma IA no limite da conta (NOD-253)", () => {
  const base = { naMaquina: todas, noutraMaquina: new Map(), escolhidas: {}, ordemDoBot: null, agora: AGORA };

  it("preso ao Claude: nunca 'outra_ia' — oferece só contas do Claude", () => {
    const r = decidirLimiteDaConta({ ...base, contas: lista(), contaId: "c-pessoal", ate: AGORA + HORA, iaFixa: "claude-cli" });
    expect(r.decisao.tipo).not.toBe("outra_ia");
    expect(JSON.stringify(r.decisao)).not.toContain("g-pessoal");
  });

  it("preso ao ChatGPT e a única conta dele no limite: espera a volta DELA, não a do Claude", () => {
    const contas = lista({ "c-pessoal": { noLimiteAte: AGORA + 10 * HORA } });
    const r = decidirLimiteDaConta({ ...base, contas, contaId: "g-pessoal", ate: AGORA + 2 * HORA, iaFixa: "codex-cli" });
    expect(r.decisao).toMatchObject({ tipo: "todas_no_limite" });
    expect(JSON.stringify(r.decisao)).not.toContain("c-lumen");
  });
});

describe("vinculoSegueSemAcesso (NOD-283)", () => {
  it("o anúncio 'pronta' com o mesmo login não solta a conta sem acesso; um login mais novo solta", () => {
    expect(vinculoSegueSemAcesso(AGORA, "pronta", AGORA - HORA)).toBe(true);
    expect(vinculoSegueSemAcesso(AGORA, "pronta", AGORA + 1)).toBe(false);
    expect(vinculoSegueSemAcesso(AGORA, "sem_login", AGORA - HORA)).toBe(false);
    expect(vinculoSegueSemAcesso(null, "pronta", AGORA - HORA)).toBe(false);
  });
});
