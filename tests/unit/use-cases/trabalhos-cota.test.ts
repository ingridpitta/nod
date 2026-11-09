import { describe, expect, it } from "vitest";
import { cotaDasIas, situacaoDaCotaDoTrabalho } from "../../../src/domain/cota-da-ia.ts";

/**
 * NOD-260 (definido em 2026-10-15, D3): "esperando a cota" só quando nenhuma IA pronta pode pegar o trabalho. Automático:
 * `iasParaOAutomatico` sobre as IAs prontas das máquinas vivas; IA fixa: a do turno pendente mais antigo. Na dúvida, livre.
 */
const AGORA = Date.UTC(2026, 9, 15, 15, 0);
const HORA = 3_600_000;
const noLimite = (ia: "claude-cli" | "codex-cli") => cotaDasIas({ usos: [{ harness: ia, situacao: "normal", cincoHoras: { utilizacao: 1, renovaEm: AGORA + 2 * HORA }, semana: null, medidoEm: AGORA - 60_000 }], limites: {}, agora: AGORA });
const auto = { harness: "auto", modelo: "auto" };
const claude = { harness: "claude-cli", modelo: "sonnet" };
const base = { bot: auto, noLimite: [] as string[], conhecidas: ["claude-cli", "codex-cli"] };

describe("situacaoDaCotaDoTrabalho (D3)", () => {
  it("Automático com o Claude no limite e o Codex pronto: livre (o Codex pega)", () => {
    expect(situacaoDaCotaDoTrabalho({ ...base, pendente: auto, cota: noLimite("claude-cli"), iasProntas: ["claude-cli", "codex-cli"] })).toBe("livre");
  });

  it("Automático com a única IA pronta no limite: espera a cota", () => {
    expect(situacaoDaCotaDoTrabalho({ ...base, pendente: auto, cota: noLimite("claude-cli"), iasProntas: ["claude-cli"] })).toBe("limite");
  });

  it("IA fixa: vale a do turno pendente mais antigo, mesmo com outra pronta", () => {
    expect(situacaoDaCotaDoTrabalho({ ...base, pendente: claude, cota: noLimite("claude-cli"), iasProntas: ["claude-cli", "codex-cli"] })).toBe("limite");
    expect(situacaoDaCotaDoTrabalho({ ...base, pendente: claude, cota: noLimite("codex-cli"), iasProntas: ["claude-cli", "codex-cli"] })).toBe("livre");
  });

  it("sem turno pendente vale a preferência do bot", () => {
    expect(situacaoDaCotaDoTrabalho({ ...base, bot: claude, pendente: null, cota: noLimite("claude-cli"), iasProntas: ["codex-cli"] })).toBe("limite");
  });

  it("na dúvida, livre: nenhuma IA pronta conhecida, nenhuma cota, nenhum turno", () => {
    expect(situacaoDaCotaDoTrabalho({ ...base, pendente: auto, cota: noLimite("claude-cli"), iasProntas: [] })).toBe("livre");
    expect(situacaoDaCotaDoTrabalho({ ...base, pendente: auto, cota: [], iasProntas: ["claude-cli"] })).toBe("livre");
    expect(situacaoDaCotaDoTrabalho({ ...base, bot: null, pendente: null, cota: noLimite("claude-cli"), iasProntas: ["claude-cli"] })).toBe("livre");
  });

  it("a IA que a pessoa marcou no limite sai do Automático enquanto houver outra pronta", () => {
    expect(situacaoDaCotaDoTrabalho({ ...base, noLimite: ["codex-cli"], pendente: auto, cota: noLimite("claude-cli"), iasProntas: ["claude-cli", "codex-cli"] })).toBe("limite");
  });

  it("sem o serviço das máquinas (iasProntas null): o comportamento de antes, pelas IAs conhecidas", () => {
    expect(situacaoDaCotaDoTrabalho({ ...base, pendente: auto, cota: noLimite("claude-cli"), iasProntas: null })).toBe("livre");
    expect(situacaoDaCotaDoTrabalho({ ...base, conhecidas: ["claude-cli"], pendente: auto, cota: noLimite("claude-cli"), iasProntas: null })).toBe("limite");
  });
});
