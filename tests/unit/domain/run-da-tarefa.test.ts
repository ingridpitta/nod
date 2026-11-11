import { describe, expect, it } from "vitest";
import { esperaDoRun, origemDoRun, precisaDeVoce, rotuloDaFalha } from "../../../src/domain/run-da-tarefa.ts";

describe("o estado verdadeiro do run (Passo 1)", () => {
  it("a espera: a volta pela CI com o PR, a hora marcada, o comando, a pessoa e o colega, nessa ordem", () => {
    const base = { aguardaPessoa: false, aguardaColega: false, tarefaEsperaPessoa: false };
    expect(esperaDoRun({ ...base, volta: { motivo: null, em: 5, quando: "ci", prUrl: "https://github.com/a/b/pull/12", turnoId: "t" } })).toEqual({ tipo: "ci", texto: "a CI do PR #12", em: 5, prUrl: "https://github.com/a/b/pull/12", podeAcordar: true });
    expect(esperaDoRun({ ...base, volta: { motivo: "ver o deploy", em: 9, quando: null, prUrl: null, turnoId: "t" } })?.tipo).toBe("hora");
    expect(esperaDoRun({ ...base, volta: { motivo: "build", em: null, quando: null, prUrl: null, turnoId: null } })).toMatchObject({ tipo: "outro", podeAcordar: false });
    expect(esperaDoRun({ ...base, volta: null, aguardaPessoa: true, aguardaColega: true })?.tipo).toBe("pessoa");
    expect(esperaDoRun({ ...base, volta: null, tarefaEsperaPessoa: true })?.tipo).toBe("pessoa");
    expect(esperaDoRun({ ...base, volta: null, aguardaColega: true })?.tipo).toBe("colega");
    expect(esperaDoRun({ ...base, volta: null })).toBeNull();
  });

  it("a falha num rótulo curto; precisa da pessoa só quando repetir daria no mesmo (login, cota, conta)", () => {
    expect(rotuloDaFalha({ motivoFalha: "limite_do_plano", motivoInterrupcao: null })).toBe("Limite do plano da IA");
    expect(rotuloDaFalha({ motivoFalha: null, motivoInterrupcao: "maquina_sem_contato" })).toBe("Máquina sem contato");
    expect(rotuloDaFalha({ motivoFalha: null, motivoInterrupcao: null })).toBe("Falhou");
    expect(precisaDeVoce({ motivoFalha: "nao_autenticado", motivoInterrupcao: null, parado: false })).toBe(true);
    expect(precisaDeVoce({ motivoFalha: null, motivoInterrupcao: "reinicio_servidor", parado: false })).toBe(false);
  });

  it("a origem: o turno só de comentário é comentário; o início que veio de troca de mão é passagem", () => {
    expect(origemDoRun(null, false)).toBe("comentario");
    expect(origemDoRun("inicio", true)).toBe("passagem");
    expect(origemDoRun("inicio", false)).toBe("inicio");
    expect(origemDoRun("repetir", true)).toBe("repetir");
  });
});
