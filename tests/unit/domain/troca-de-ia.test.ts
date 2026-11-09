import { describe, expect, it } from "vitest";
import { aplicarEmDaTroca, ESPERA_QUE_COMPENSA_MS, fraseDaTroca, PRAZO_DO_LEVAR_MS, recomendacaoDaTroca, temSessaoNaIa } from "../../../src/domain/troca-de-ia.ts";

const AGORA = 1_760_000_000_000;
const MIN = 60_000;

describe("recomendacaoDaTroca (ADR-108 R4)", () => {
  it("volta em até 30 min: esperar (inclusive no limite exato)", () => {
    expect(recomendacaoDaTroca({ voltaEm: AGORA + 11 * MIN, agora: AGORA })).toBe("esperar");
    expect(recomendacaoDaTroca({ voltaEm: AGORA + ESPERA_QUE_COMPENSA_MS, agora: AGORA })).toBe("esperar");
    expect(recomendacaoDaTroca({ voltaEm: AGORA, agora: AGORA })).toBe("esperar");
  });

  it("mais de 30 min: levar", () => {
    expect(recomendacaoDaTroca({ voltaEm: AGORA + ESPERA_QUE_COMPENSA_MS + 1, agora: AGORA })).toBe("levar");
    expect(recomendacaoDaTroca({ voltaEm: AGORA + 16 * 60 * MIN, agora: AGORA })).toBe("levar");
  });

  it("sem hora (o fornecedor não disse quando volta): levar", () => {
    expect(recomendacaoDaTroca({ voltaEm: null, agora: AGORA })).toBe("levar");
  });

  it("só 'levar' tem prazo para o varredor aplicar sozinho: criada + 10 min", () => {
    expect(aplicarEmDaTroca("levar", AGORA)).toBe(AGORA + PRAZO_DO_LEVAR_MS);
    expect(PRAZO_DO_LEVAR_MS).toBe(10 * MIN);
    expect(aplicarEmDaTroca("esperar", AGORA)).toBeNull();
  });
});

describe("temSessaoNaIa", () => {
  it("só conta a sessão guardada na IA que parou", () => {
    expect(temSessaoNaIa({ sessaoCli: "s1", sessaoHarness: "claude-cli" }, "claude-cli")).toBe(true);
    expect(temSessaoNaIa({ sessaoCli: "s1", sessaoHarness: "codex-cli" }, "claude-cli")).toBe(false);
    expect(temSessaoNaIa({ sessaoCli: null, sessaoHarness: "claude-cli" }, "claude-cli")).toBe(false);
    expect(temSessaoNaIa(null, "claude-cli")).toBe(false);
  });
});

describe("fraseDaTroca", () => {
  const quando = () => "às 20:50";
  it("não fixo: o limite, a volta e a recomendação (canvas C1/C2)", () => {
    expect(fraseDaTroca({ nomeDe: "Claude", nomePara: "ChatGPT", nomeDoBot: "Eng 1", recomendacao: "esperar", tasks: 19, fixo: false, voltaEm: AGORA, quando }))
      .toBe("O Claude chegou ao limite · volta às 20:50. Para as 19 tasks, recomendo esperar o Claude: continuam de onde pararam.");
    expect(fraseDaTroca({ nomeDe: "Claude", nomePara: "ChatGPT", nomeDoBot: "Eng 1", recomendacao: "levar", tasks: 1, fixo: false, voltaEm: null, quando }))
      .toBe("O Claude chegou ao limite · o Claude não disse quando volta. Para a task, recomendo levar para o ChatGPT: recomeçam do resumo, mas não ficam paradas.");
  });

  it("revisão do PR 2: a conta do ChatGPT que parou (I1) e a outra IA fora da máquina do bot (C5)", () => {
    expect(fraseDaTroca({ nomeDe: "ChatGPT", nomePara: "ChatGPT", nomeDoBot: "Eng 1", recomendacao: "levar", tasks: 2, fixo: false, voltaEm: null, quando, contaDe: "Pessoal" }))
      .toBe("A conta Pessoal do ChatGPT chegou ao limite · o ChatGPT não disse quando volta. Para as 2 tasks, recomendo levar para outra conta do ChatGPT: recomeçam do resumo, mas não ficam paradas.");
    expect(fraseDaTroca({ nomeDe: "Claude", nomePara: null, nomeDoBot: "Eng 1", recomendacao: "esperar", tasks: 1, fixo: false, voltaEm: AGORA, quando, foraDaMaquina: { nome: "ChatGPT", maquina: "vm-bots" } }))
      .toBe("O Claude chegou ao limite · volta às 20:50. O ChatGPT não está em vm-bots, a máquina do Eng 1. Para a task, recomendo esperar o Claude: continuam de onde pararam.");
  });

  it("NOD-401: a conta que parou (a IA inteira na máquina) dá o apelido sem mudar o destino do 'levar'", () => {
    expect(fraseDaTroca({ nomeDe: "Claude", nomePara: "ChatGPT", nomeDoBot: "Eng 1", recomendacao: "levar", tasks: 1, fixo: false, voltaEm: AGORA, quando, contaQueParou: "marlonwlv (20x)" }))
      .toBe("A conta marlonwlv (20x) do Claude chegou ao limite · volta às 20:50. Para a task, recomendo levar para o ChatGPT: recomeçam do resumo, mas não ficam paradas.");
  });

  it("fixo: o estado do bot e que ele volta sozinho (canvas C3)", () => {
    expect(fraseDaTroca({ nomeDe: "Claude", nomePara: "ChatGPT", nomeDoBot: "Eng 1", recomendacao: "esperar", tasks: 0, fixo: true, voltaEm: AGORA, quando }))
      .toBe("Eng 1 parou até 20:50: as contas do Claude da sua fila acabaram. Volta sozinho às 20:50.");
  });
});
