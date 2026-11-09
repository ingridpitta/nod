import { describe, expect, it } from "vitest";
import { classificarIgnorado, codigosDaMaquina, ENTRE_PASSADAS_APERTADAS_MS, LIMPAR_ANTES_DE_ACABAR_MS, LIMPAR_APOS_MS, motivoDaRecusa, PASTAS_DA_MAQUINA_MAX, passadaPorAperto, pastaDeTask, protegidoPorMontagem, quandoLimpar, RETOMADA_POSSIVEL_MS, type FatosLimpeza } from "../../../src/domain/limpeza-das-tasks.ts";

const AGORA = Date.UTC(2026, 9, 9, 12);
const DIA = 24 * 3_600_000;
const base = (f: Partial<FatosLimpeza> = {}): FatosLimpeza => ({ estado: "terminado", terminadoEm: AGORA - 4 * DIA, pasta: "~/nod/Dev 1/fix-filtros-abc123", turnosVivos: 0, decisaoPendente: false, pastaDividida: false, ...f });

describe("quem pode ser limpo (ADR-088)", () => {
  it("terminada ou falha há mais de 3 dias: encerrada", () => {
    expect(quandoLimpar(base(), AGORA)).toBe("encerrada");
    expect(quandoLimpar(base({ estado: "falhou" }), AGORA)).toBe("encerrada");
    expect(quandoLimpar(base({ terminadoEm: AGORA - LIMPAR_APOS_MS }), AGORA)).toBe("encerrada");
  });

  it("task ativa nunca é limpa (qualquer estado aberto), nem a parada pela pessoa", () => {
    for (const estado of ["na_fila", "rodando", "precisa_de_voce", "fechado_ocioso", "parado"] as const) expect(quandoLimpar(base({ estado, terminadoEm: estado === "parado" ? AGORA - 10 * DIA : null }), AGORA), estado).toBeNull();
  });

  it("task com retomada marcada (turno pendente ou volta com acordar_em) ou decisão pendente não é limpa", () => {
    expect(quandoLimpar(base({ turnosVivos: 1 }), AGORA)).toBeNull();
    expect(quandoLimpar(base({ decisaoPendente: true }), AGORA)).toBeNull();
    expect(quandoLimpar(base({ pastaDividida: true }), AGORA)).toBeNull();
  });

  it("nas 2 h depois de encerrar nada sai (retomada automática, ADR-084); entre 2 h e 3 dias, só com PR mergeado", () => {
    expect(quandoLimpar(base({ terminadoEm: AGORA - RETOMADA_POSSIVEL_MS + 1 }), AGORA)).toBeNull();
    expect(quandoLimpar(base({ terminadoEm: AGORA - RETOMADA_POSSIVEL_MS }), AGORA)).toBe("so_com_pr_mergeado");
    expect(quandoLimpar(base({ terminadoEm: AGORA - LIMPAR_APOS_MS + 1 }), AGORA)).toBe("so_com_pr_mergeado");
  });

  it("ADR-096: com o disco apertado, a task encerrada há mais de 2 h já vale como encerrada; as travas de sempre continuam", () => {
    const apertado = { apertado: true };
    expect(quandoLimpar(base({ terminadoEm: AGORA - RETOMADA_POSSIVEL_MS }), AGORA, apertado)).toBe("encerrada");
    expect(quandoLimpar(base({ terminadoEm: AGORA - RETOMADA_POSSIVEL_MS + 1 }), AGORA, apertado)).toBeNull();
    expect(quandoLimpar(base({ terminadoEm: AGORA - RETOMADA_POSSIVEL_MS, turnosVivos: 1 }), AGORA, apertado)).toBeNull();
    expect(quandoLimpar(base({ terminadoEm: AGORA - RETOMADA_POSSIVEL_MS, decisaoPendente: true }), AGORA, apertado)).toBeNull();
    expect(quandoLimpar(base({ estado: "parado", terminadoEm: AGORA - 10 * DIA }), AGORA, apertado)).toBeNull();
    expect(quandoLimpar(base({ terminadoEm: AGORA - RETOMADA_POSSIVEL_MS }), AGORA, { apertado: false })).toBe("so_com_pr_mergeado");
  });

  it("ADR-099 (I5): a frente terminada vale `sem_trabalho` desde o fim até virar `encerrada`; a falha e a task seguem a regra de sempre", () => {
    const frente = (f: Partial<FatosLimpeza> = {}) => base({ forma: "frente", ...f });
    expect(quandoLimpar(frente({ terminadoEm: AGORA }), AGORA)).toBe("sem_trabalho");
    expect(quandoLimpar(frente({ terminadoEm: AGORA - RETOMADA_POSSIVEL_MS + 1 }), AGORA)).toBe("sem_trabalho");
    expect(quandoLimpar(frente({ terminadoEm: AGORA - LIMPAR_APOS_MS + 1 }), AGORA)).toBe("sem_trabalho");
    // 3 dias, ou 2 h com o disco apertado: o caminho da ADR-088/096 (guardar antes de apagar).
    expect(quandoLimpar(frente({ terminadoEm: AGORA - LIMPAR_APOS_MS }), AGORA)).toBe("encerrada");
    expect(quandoLimpar(frente({ terminadoEm: AGORA - RETOMADA_POSSIVEL_MS }), AGORA, { apertado: true })).toBe("encerrada");
    expect(quandoLimpar(frente({ terminadoEm: AGORA }), AGORA, { apertado: true })).toBe("sem_trabalho");
    // `falhou`: o varredor da ADR-084 pode retomar nas primeiras 2 h.
    expect(quandoLimpar(frente({ estado: "falhou", terminadoEm: AGORA }), AGORA)).toBeNull();
    expect(quandoLimpar(frente({ estado: "falhou", terminadoEm: AGORA - RETOMADA_POSSIVEL_MS }), AGORA)).toBe("so_com_pr_mergeado");
    // As travas de sempre valem para a frente.
    expect(quandoLimpar(frente({ terminadoEm: AGORA, turnosVivos: 1 }), AGORA)).toBeNull();
    expect(quandoLimpar(frente({ terminadoEm: AGORA, decisaoPendente: true }), AGORA)).toBeNull();
    expect(quandoLimpar(frente({ terminadoEm: AGORA, pastaDividida: true }), AGORA)).toBeNull();
    expect(quandoLimpar(frente({ terminadoEm: AGORA, pasta: "~/nod/Dev 1" }), AGORA)).toBeNull();
    for (const estado of ["na_fila", "rodando", "precisa_de_voce", "fechado_ocioso"] as const) expect(quandoLimpar(frente({ estado, terminadoEm: null }), AGORA), estado).toBeNull();
    expect(quandoLimpar(frente({ estado: "parado", terminadoEm: AGORA }), AGORA)).toBeNull();
    // A task (forma ausente ou `task`) não muda.
    expect(quandoLimpar(base({ terminadoEm: AGORA }), AGORA)).toBeNull();
    expect(quandoLimpar(base({ forma: "task", terminadoEm: AGORA - RETOMADA_POSSIVEL_MS }), AGORA)).toBe("so_com_pr_mergeado");
  });

  it("ADR-096: o disco amarelo ou vermelho dispara uma passada apertada, no máximo uma a cada 30 min", () => {
    expect(passadaPorAperto("verde", null, AGORA)).toBe(false);
    expect(passadaPorAperto(null, null, AGORA)).toBe(false);
    expect(passadaPorAperto("amarela", null, AGORA)).toBe(true);
    expect(passadaPorAperto("vermelha", AGORA - ENTRE_PASSADAS_APERTADAS_MS, AGORA)).toBe(true);
    expect(passadaPorAperto("vermelha", AGORA - ENTRE_PASSADAS_APERTADAS_MS + 1, AGORA)).toBe(false);
    // ADR-096 §6: verde, mas acabando em 6 h ou menos, já aperta.
    expect(passadaPorAperto("verde", null, AGORA, LIMPAR_ANTES_DE_ACABAR_MS)).toBe(true);
    expect(passadaPorAperto("verde", null, AGORA, LIMPAR_ANTES_DE_ACABAR_MS + 1)).toBe(false);
    expect(passadaPorAperto("verde", AGORA - 1, AGORA, 0)).toBe(false);
  });

  it("só pasta de task (~/nod/<bot>/<slug>): a raiz do bot, caminho fora de ~/nod e com .. ficam de fora", () => {
    expect(pastaDeTask("~/nod/Dev 1/fix-filtros-abc123")).toBe("Dev 1/fix-filtros-abc123");
    for (const p of [null, "~/nod/Dev 1", "~/nod/Dev 1/a/b", "/Users/m/nod/Dev 1/x", "~/nod/Dev 1/..", "~/nod/../code/x", "~/nod/Dev 1/.escondida", "~/nod//x"]) expect(pastaDeTask(p), String(p)).toBeNull();
    expect(quandoLimpar(base({ pasta: "~/nod/Dev 1" }), AGORA)).toBeNull();
  });
});

describe("proteções do disco (ADR-088)", () => {
  it("montagem dentro da worktree (ou nela) protege; montagem que a contém não", () => {
    const wt = "/Users/m/nod/Eng 1/nod-169";
    expect(protegidoPorMontagem(wt, ["/Users/m/nod/Eng 1/nod-169/infra/postgres/init"])).toBe(true);
    expect(protegidoPorMontagem(wt, [wt])).toBe(true);
    expect(protegidoPorMontagem(wt, ["/Users/m/nod"])).toBe(false);
    expect(protegidoPorMontagem(wt, ["/Users/m/nod/Eng 1/nod-1690/init"])).toBe(false);
    expect(protegidoPorMontagem("relativo/x", [])).toBe(true);
  });

  it("revisão #225: a comparação das montagens é NFC e sem caixa (APFS)", () => {
    const nfc = "/Users/m/nod/Cecília/task-abc123/nod";
    const nfd = "/users/m/NOD/Cecília".normalize("NFD") + "/task-abc123/nod/infra/init";
    expect(protegidoPorMontagem(nfc, [nfd])).toBe(true);
    expect(protegidoPorMontagem(nfc.normalize("NFD").toUpperCase(), [`${nfc}/init`])).toBe(true);
  });

  it("revisão #225: só o ignorado que se refaz pode sair junto com a worktree (pelo primeiro nome do caminho)", () => {
    for (const c of ["node_modules/", "packages/web/node_modules/", "dist/x.map", "coverage/lcov.info", ".turbo/cache/a", "npm-debug.log", ".DS_Store", "a/b/.DS_Store", "tsconfig.tsbuildinfo", "packages/x/tsconfig.tsbuildinfo"]) expect(classificarIgnorado(c), c).toBe("regeneravel");
    // Pasta regenerável inteira: sai só se não houver `.env*` dentro (o Mac confere).
    for (const c of ["dist/", ".next/", "coverage/", "__pycache__/"]) expect(classificarIgnorado(c), c).toBe("conferir_env");
    // Segunda revisão: build/out/output saíram da lista; o nome no meio do caminho não conta; `.env*` nunca, em nível nenhum.
    for (const c of [".env", ".env.local", "dist/.env.production", "node_modules/.env", "backups/", "backups/local/nod.dump", ".claude/", "dados.sqlite", "build/", "out/", "output/", "output/relatorio.csv", "logs/app.log", "dist", "", "packages/x/dist/", "a/coverage/", "a/.cache/", "apps/web/.env.local", "packages/x/.turbo/.env", "packages/x/.turbo"]) expect(classificarIgnorado(c), c).toBe("valioso");
  });

  it("ADR-096: cache de uma ferramenta conhecida vale em qualquer nível (o monorepo tem um por pacote)", () => {
    // O que segurava 4 das 41 worktrees de task da VM dos bots em 11/10.
    for (const c of ["packages/auth/.turbo/", "apps/mobile/.expo/", "apps/x/.next/", "a/__pycache__/", "apps/web/.svelte-kit/"]) expect(classificarIgnorado(c), c).toBe("conferir_env");
    for (const c of ["packages/auth/.turbo/cache/a", "apps/mobile/.expo/settings.json", "a/b/__pycache__/m.pyc"]) expect(classificarIgnorado(c), c).toBe("regeneravel");
  });

  it("a recusa do git vira motivo", () => {
    expect(motivoDaRecusa("fatal: '/x' contains modified or untracked files, use --force to delete it")).toBe("suja");
    expect(motivoDaRecusa("fatal: cannot remove a locked working tree, lock reason: x\nuse 'remove -f -f' to override or unlock first")).toBe("travada");
    expect(motivoDaRecusa("fatal: '/x' is not a working tree")).toBe("erro");
  });
});

describe("ADR-106: os códigos das pastas que a máquina manda", () => {
  it("só sha256 em hex minúsculo, sem repetir, até o teto; não lista = máquina antiga", () => {
    const codigo = (i: number) => i.toString(16).padStart(64, "0");
    const muitos = Array.from({ length: PASTAS_DA_MAQUINA_MAX + 1 }, (_, i) => codigo(i));
    expect(codigosDaMaquina(muitos)).toHaveLength(PASTAS_DA_MAQUINA_MAX);
    expect(codigosDaMaquina([codigo(1), codigo(1), "Vera/a-111111", codigo(0xab).toUpperCase(), `${codigo(3)}0`, 7])).toEqual([codigo(1)]);
    expect(codigosDaMaquina([])).toEqual([]);
    expect(codigosDaMaquina(codigo(1))).toBeNull();
    expect(codigosDaMaquina(undefined)).toBeNull();
  });
});
