import { describe, expect, it } from "vitest";
import { capacidadesDoNivel, doNivel, grupoDaCapacidade, gruposDoCatalogo } from "../../../src/domain/grupos-de-acesso.ts";

const cap = (nome: string, readOnlyHint: boolean, destructiveHint?: boolean) => ({ nome, readOnlyHint, ...(destructiveHint ? { destructiveHint } : {}) });
const CLICKUP = [
  cap("CLICKUP_GET_TASKS", true),
  cap("CLICKUP_GET_TASK_COMMENTS", true),
  cap("CLICKUP_CREATE_TASK", false),
  cap("CLICKUP_UPDATE_TASK", false),
  cap("CLICKUP_CREATE_TASK_COMMENT", false),
  cap("CLICKUP_DELETE_TASK", false),
  cap("CLICKUP_REMOVE_TAG_FROM_TASK", false),
  cap("CLICKUP_RUN_AUTOMATION", false),
];

describe("grupos de acesso (definido em 2026-09-25; revisto na revisão do PR #68: falha fechado)", () => {
  it("apagar ganha de tudo — do readOnlyHint e do verbo de escrita — e o destructiveHint leva para lá", () => {
    expect(grupoDaCapacidade(cap("X_DELETE_CACHE", true))).toBe("apagar");
    expect(grupoDaCapacidade(cap("CLICKUP_UPDATE_AND_DELETE", false))).toBe("apagar");
    expect(grupoDaCapacidade(cap("CLICKUP_UPDATE_TASK", false, true))).toBe("apagar");
    expect(grupoDaCapacidade(cap("X_LIST_DELETED_ITEMS", true))).toBe("ler");
  });

  it("os destrutivos sem DELETE no nome, camelCase e português também são apagar", () => {
    for (const nome of ["GOOGLESHEETS_CLEAR_VALUES", "GOOGLECALENDAR_CLEAR_CALENDAR", "GITHUB_MERGE_A_PULL_REQUEST", "GCAL_CANCEL_EVENT", "SLACK_BLOCK_USER", "deleteEvent", "tarefa_excluir", "arquivo-apagar"]) {
      expect(grupoDaCapacidade(cap(nome, false)), nome).toBe("apagar");
    }
  });

  it("escrita sem verbo reconhecido vai para 'outras', que nenhum nível concede", () => {
    expect(grupoDaCapacidade(cap("CLICKUP_RUN_AUTOMATION", false))).toBe("outras");
    expect(grupoDaCapacidade(cap("pr_revisar", false))).toBe("outras");
    expect(grupoDaCapacidade(cap("pr_comentar", false))).toBe("comentar");
    expect(grupoDaCapacidade(cap("createTask", false))).toBe("criar");
  });

  it("os grupos na ordem fixa em que a pessoa os lê", () => {
    expect(gruposDoCatalogo(CLICKUP).map((g) => [g.id, g.capacidades.length])).toEqual([["ler", 2], ["criar", 1], ["alterar", 1], ["comentar", 1], ["outras", 1], ["apagar", 2]]);
  });

  it("o nível: leitura = ler; escrita = ler, criar, editar e comentar; apagar e outras nunca; e o que o nível pode mexer", () => {
    expect(capacidadesDoNivel(CLICKUP, "leitura")).toEqual(["CLICKUP_GET_TASKS", "CLICKUP_GET_TASK_COMMENTS"]);
    expect(capacidadesDoNivel(CLICKUP, "escrita")).toEqual(["CLICKUP_GET_TASKS", "CLICKUP_GET_TASK_COMMENTS", "CLICKUP_CREATE_TASK", "CLICKUP_UPDATE_TASK", "CLICKUP_CREATE_TASK_COMMENT"]);
    expect(capacidadesDoNivel(CLICKUP, "nenhum")).toEqual([]);
    expect(doNivel(CLICKUP, "CLICKUP_UPDATE_TASK")).toBe(true);
    expect(doNivel(CLICKUP, "CLICKUP_DELETE_TASK")).toBe(false);
    expect(doNivel(CLICKUP, "CLICKUP_RUN_AUTOMATION")).toBe(false);
    expect(doNivel(CLICKUP, "SUMIU")).toBe(false);
  });
});
