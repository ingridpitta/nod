import { describe, expect, it } from "vitest";
import { barraDoPedido, comDecisaoBarra, criarFilaDeGravacao, decisoesComPedido, GRUPO_AVISOS, respostaSincrona, lerAviso, lerBarraDesktop, lerDecisaoBarra, lerDecisoesBarra, lerContador, lerPreferencias, lerTemaDesktop, opcoesDoAviso, origemDe, remetenteWebValido } from "../../../desktop/avisos-mac.ts";

/**
 * O que o processo principal aceita da janela web (definido em 2026-09-24, "aviso no Mac"): a página é
 * remota, então remetente e argumentos são conferidos antes de tocar o macOS.
 */
describe("remetente da janela web", () => {
  const servidor = "https://nod.acme.com.br";

  it("só o frame de topo na origem do servidor configurado", () => {
    expect(remetenteWebValido({ frameUrl: "https://nod.acme.com.br/conversa/1", frameDeTopo: true, servidor })).toBe(true);
    expect(remetenteWebValido({ frameUrl: "https://nod.acme.com.br/", frameDeTopo: false, servidor })).toBe(false);
    expect(remetenteWebValido({ frameUrl: "https://nod.acme.com.br.evil.com/", frameDeTopo: true, servidor })).toBe(false);
    expect(remetenteWebValido({ frameUrl: "http://nod.acme.com.br/", frameDeTopo: true, servidor })).toBe(false);
    expect(remetenteWebValido({ frameUrl: "file:///Applications/nod.app/setup.html", frameDeTopo: true, servidor })).toBe(false);
    expect(remetenteWebValido({ frameUrl: "data:text/html,oi", frameDeTopo: true, servidor })).toBe(false);
  });

  it("sem servidor configurado, ninguém", () => {
    expect(remetenteWebValido({ frameUrl: "https://nod.acme.com.br/", frameDeTopo: true, servidor: undefined })).toBe(false);
    expect(origemDe("não é url")).toBeNull();
    expect(origemDe("data:text/html,oi")).toBeNull();
  });
});

describe("argumentos", () => {
  it("o aviso vem copiado, com texto dentro do teto e alvo conhecido", () => {
    const alvo = { tipo: "conversa", conversaId: "7f0c1b8e-1111-4a2b-9c3d-000000000001", agenteId: "7f0c1b8e-1111-4a2b-9c3d-000000000002", extra: "x" };
    expect(lerAviso({ titulo: "Nina precisa de você", corpo: "Posso ler o Gmail?", alvo, html: "<b>" })).toEqual({
      titulo: "Nina precisa de você",
      corpo: "Posso ler o Gmail?",
      alvo: { tipo: "conversa", conversaId: alvo.conversaId, agenteId: alvo.agenteId },
    });
    expect(lerAviso({ titulo: "2 pedidos esperando por você", corpo: "", alvo: { tipo: "sua-vez" } })).toMatchObject({ alvo: { tipo: "sua-vez" } });
  });

  it("recusa título vazio, texto longo, alvo estranho e o que não é objeto", () => {
    expect(lerAviso({ titulo: " ", corpo: "x", alvo: { tipo: "sua-vez" } })).toBeNull();
    expect(lerAviso({ titulo: "x".repeat(121), corpo: "x", alvo: { tipo: "sua-vez" } })).toBeNull();
    expect(lerAviso({ titulo: "x", corpo: "x".repeat(301), alvo: { tipo: "sua-vez" } })).toBeNull();
    expect(lerAviso({ titulo: "x", corpo: "x", alvo: { tipo: "conversa", conversaId: "../../etc", agenteId: "a" } })).toBeNull();
    expect(lerAviso({ titulo: "x", corpo: "x", alvo: { tipo: "url", url: "https://evil.com" } })).toBeNull();
    expect(lerAviso("oi")).toBeNull();
    expect(lerAviso(null)).toBeNull();
  });

  it("o número do Dock é inteiro de 0 a 9999", () => {
    expect(lerContador(3)).toBe(3);
    expect(lerContador(0)).toBe(0);
    expect(lerContador(123_456)).toBe(9_999);
    expect(lerContador(-1)).toBeNull();
    expect(lerContador(1.5)).toBeNull();
    expect(lerContador("3")).toBeNull();
  });

  it("preferencias.json: ausente ou corrompido, os avisos nascem ligados e o tema segue o sistema", () => {
    expect(lerPreferencias(null)).toEqual({ avisos: true, tema: "sistema", som: true, barra: null });
    expect(lerPreferencias("{")).toEqual({ avisos: true, tema: "sistema", som: true, barra: null });
    expect(lerPreferencias('{"avisos":"sim"}')).toEqual({ avisos: true, tema: "sistema", som: true, barra: null });
    expect(lerPreferencias('{"avisos":false}')).toEqual({ avisos: false, tema: "sistema", som: true, barra: null });
  });

  it("preferencias.json: o tema só aceita sistema, claro e escuro (ADR-070)", () => {
    expect(lerPreferencias('{"avisos":false,"tema":"escuro"}')).toEqual({ avisos: false, tema: "escuro", som: true, barra: null });
    expect(lerPreferencias('{"tema":"roxo"}')).toEqual({ avisos: true, tema: "sistema", som: true, barra: null });
    expect(lerTemaDesktop("claro")).toBe("claro");
    expect(lerTemaDesktop("<script>")).toBeNull();
    expect(lerTemaDesktop(1)).toBeNull();
  });

  it("preferencias.json: o som (NOD-196) nasce ligado sem arquivo, corrompido, ausente ou não booleano", () => {
    expect(lerPreferencias(null).som).toBe(true);
    expect(lerPreferencias("{").som).toBe(true);
    expect(lerPreferencias("[]").som).toBe(true);
    expect(lerPreferencias('{"avisos":false}').som).toBe(true);
    expect(lerPreferencias('{"som":"nao"}').som).toBe(true);
    expect(lerPreferencias('{"som":0}').som).toBe(true);
    expect(lerPreferencias('{"som":null}').som).toBe(true);
    expect(lerPreferencias('{"som":false}')).toEqual({ avisos: true, tema: "sistema", som: false, barra: null });
    // Com os avisos desligados, a escolha do som continua guardada.
    expect(lerPreferencias('{"avisos":false,"tema":"claro","som":false}')).toEqual({ avisos: false, tema: "claro", som: false, barra: null });
  });

  it("preferencias.json: gravar e reler (JSON.stringify, como gravarPreferencias) mantém avisos, tema e som", () => {
    // definirSom grava `{ ...preferencias, som }`: trocar o som não pode apagar avisos nem tema, e vice-versa.
    for (const p of [
      { avisos: false, tema: "escuro" as const, som: false, barra: null },
      { avisos: true, tema: "claro" as const, som: false, barra: null },
      { avisos: false, tema: "sistema" as const, som: true, barra: null },
    ]) {
      expect(lerPreferencias(JSON.stringify(p))).toEqual(p);
      expect(lerPreferencias(JSON.stringify({ ...p, som: !p.som }))).toEqual({ ...p, som: !p.som });
    }
    // Arquivo de antes da NOD-196 (sem `som`): avisos e tema ficam, o som nasce ligado.
    expect(lerPreferencias(JSON.stringify({ avisos: false, tema: "escuro" }))).toEqual({ avisos: false, tema: "escuro", som: true, barra: null });
  });
});

describe("opcoesDoAviso (NOD-196)", () => {
  const aviso = { titulo: "Nina precisa de você", corpo: "Aprovar o envio?", alvo: { tipo: "sua-vez" as const } };

  it("som desligado → silent: true; ligado → silent: false; título, corpo e grupo iguais aos de antes", () => {
    expect(opcoesDoAviso(aviso, { som: false })).toEqual({ title: "Nina precisa de você", body: "Aprovar o envio?", groupId: "nod-sua-vez", silent: true });
    expect(opcoesDoAviso(aviso, { som: true })).toEqual({ title: "Nina precisa de você", body: "Aprovar o envio?", groupId: "nod-sua-vez", silent: false });
    expect(GRUPO_AVISOS).toBe("nod-sua-vez");
  });

  it("não leva o alvo nem nada além das quatro opções ao macOS", () => {
    expect(Object.keys(opcoesDoAviso(aviso, { som: true })).sort()).toEqual(["body", "groupId", "silent", "title"]);
  });
});

describe("NOD-114: alvo da task e um grupo por bot", () => {
  const trabalho = { tipo: "trabalho" as const, trabalhoId: "tr-1", agenteId: "ag-1", conversaId: "c-1" };

  it("lerAlvo aceita o alvo trabalho e recusa id fora do padrão", () => {
    expect(lerAviso({ titulo: "Nina", corpo: "x", alvo: trabalho })).toEqual({ titulo: "Nina", corpo: "x", alvo: trabalho });
    expect(lerAviso({ titulo: "Nina", corpo: "x", alvo: { ...trabalho, trabalhoId: "../../etc" } })).toBeNull();
    expect(lerAviso({ titulo: "Nina", corpo: "x", alvo: { ...trabalho, agenteId: "a b" } })).toBeNull();
    expect(lerAviso({ titulo: "Nina", corpo: "x", alvo: { ...trabalho, conversaId: "x".repeat(65) } })).toBeNull();
    expect(lerAviso({ titulo: "Nina", corpo: "x", alvo: { tipo: "trabalho", trabalhoId: "tr-1", agenteId: "ag-1" } })).toBeNull();
  });

  it("o grupo é o bot: id validado, copiado, e vira um groupId por bot dentro do grupo do nod", () => {
    const aviso = lerAviso({ titulo: "Nina", corpo: "x", alvo: { tipo: "sua-vez" }, grupo: "ag-1" });
    expect(aviso).toEqual({ titulo: "Nina", corpo: "x", alvo: { tipo: "sua-vez" }, grupo: "ag-1" });
    expect(lerAviso({ titulo: "Nina", corpo: "x", alvo: { tipo: "sua-vez" }, grupo: "../x" })).toBeNull();
    expect(lerAviso({ titulo: "Nina", corpo: "x", alvo: { tipo: "sua-vez" }, grupo: 3 })).toBeNull();
    expect(opcoesDoAviso(aviso!, { som: true }).groupId).toBe(`${GRUPO_AVISOS}:ag-1`);
    expect(opcoesDoAviso({ ...aviso!, grupo: "ag-2" }, { som: true }).groupId).not.toBe(opcoesDoAviso(aviso!, { som: true }).groupId);
  });
});

describe("NOD-119: a barra lateral guardada no app do Mac", () => {
  it("só os valores do contrato; o resto vira o padrão (null)", () => {
    for (const v of ["compacta", "compacta:recolhida", "compacta:larga", "confortavel:recolhida"]) expect(lerBarraDesktop(v)).toBe(v);
    for (const v of ["", "confortavel", "__proto__", "constructor", 1, null, undefined, {}]) expect(lerBarraDesktop(v)).toBeNull();
  });
  it("lerPreferencias traz a barra, e sem ela fica no padrão", () => {
    expect(lerPreferencias(JSON.stringify({ barra: "compacta:larga" })).barra).toBe("compacta:larga");
    expect(lerPreferencias(JSON.stringify({ barra: "toString" })).barra).toBeNull();
    expect(lerPreferencias(JSON.stringify({ avisos: false })).barra).toBeNull();
    expect(lerPreferencias(null).barra).toBeNull();
  });
});

describe("NOD-119 (revisão 4): as decisões do card da barra no preferencias.json", () => {
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  it("só aceita id de mensagem (uuid) e aplicada/recusada", () => {
    expect(lerDecisaoBarra(id(1), "aplicada")).toEqual([id(1), "aplicada"]);
    expect(lerDecisaoBarra(id(1), "recusada")).toEqual([id(1), "recusada"]);
    expect(lerDecisaoBarra(id(1), "talvez")).toBeNull();
    expect(lerDecisaoBarra("__proto__", "aplicada")).toBeNull();
    expect(lerDecisaoBarra("x".repeat(36), "aplicada")).toBeNull();
    expect(lerDecisaoBarra(42, "aplicada")).toBeNull();
  });
  it("a mais nova vai ao fim, a repetida não duplica e passando de 50 saem as mais antigas", () => {
    let d = {};
    for (let n = 0; n < 55; n++) d = comDecisaoBarra(d, id(n), "aplicada");
    expect(Object.keys(d)).toHaveLength(50);
    expect(Object.keys(d)[0]).toBe(id(5));
    d = comDecisaoBarra(d, id(10), "recusada");
    expect(Object.keys(d)).toHaveLength(50);
    expect(Object.keys(d).at(-1)).toBe(id(10));
    expect((d as Record<string, string>)[id(10)]).toBe("recusada");
  });
  it("lê o campo do arquivo: sem arquivo, corrompido ou com lixo, só o que é válido", () => {
    expect(lerDecisoesBarra(null)).toEqual({});
    expect(lerDecisoesBarra("{")).toEqual({});
    expect(lerDecisoesBarra('{"decisoesBarra":[1]}')).toEqual({});
    expect(lerDecisoesBarra(JSON.stringify({ barra: "compacta", decisoesBarra: { [id(1)]: "aplicada", ruim: "aplicada", [id(2)]: "x" } }))).toEqual({ [id(1)]: "aplicada" });
    const muitas = Object.fromEntries(Array.from({ length: 60 }, (_, n) => [id(n), "recusada"]));
    expect(Object.keys(lerDecisoesBarra(JSON.stringify({ decisoesBarra: muitas })))).toHaveLength(50);
  });
});

describe("NOD-119 (revisão 5): a fila do preferencias.json", () => {
  it("uma gravação só começa quando a anterior termina, na ordem de chegada; a que falha não trava as seguintes", async () => {
    const fila = criarFilaDeGravacao();
    const log: string[] = [];
    const lenta = (n: string, ms: number) => async () => { log.push(`inicio ${n}`); await new Promise((r) => setTimeout(r, ms)); log.push(`fim ${n}`); };
    const a = fila(lenta("a", 20));
    const b = fila(async () => { log.push("b"); throw new Error("disco"); });
    const c = fila(lenta("c", 1));
    await a;
    await expect(b).rejects.toThrow("disco");
    await c;
    expect(log).toEqual(["inicio a", "fim a", "b", "inicio c", "fim c"]);
  });
});

describe("NOD-119 (revisão 6): os canais da barra no processo principal", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const recusa = () => { throw new Error("origem_invalida"); };
  it("o sendSync devolve o guardado à janela web e o padrão a qualquer outro remetente", () => {
    expect(respostaSincrona(() => undefined, () => "compacta", null)).toBe("compacta");
    expect(respostaSincrona(recusa, () => "compacta", null)).toBeNull();
    expect(respostaSincrona<Record<string, string>>(recusa, () => ({ [id]: "aplicada" }), {})).toEqual({});
    expect(respostaSincrona(() => undefined, () => { throw new Error("x"); }, {})).toEqual({});
  });
  it("definirBarra: valor conhecido ou null; o resto é recusado", () => {
    expect(barraDoPedido("compacta:recolhida")).toBe("compacta:recolhida");
    expect(barraDoPedido(null)).toBeNull();
    expect(() => barraDoPedido("gigante")).toThrow("entrada_invalida");
    expect(() => barraDoPedido(undefined)).toThrow("entrada_invalida");
  });
  it("definirDecisaoBarra: guarda a decisão válida e recusa id ou decisão inválidos sem mexer nas guardadas", () => {
    expect(decisoesComPedido({}, id, "recusada")).toEqual({ [id]: "recusada" });
    expect(() => decisoesComPedido({}, "__proto__", "aplicada")).toThrow("entrada_invalida");
    expect(() => decisoesComPedido({}, id, "talvez")).toThrow("entrada_invalida");
  });
});

