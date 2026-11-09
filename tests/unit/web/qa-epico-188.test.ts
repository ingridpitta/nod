import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { TrabalhoDto } from "../../../src/contracts/trabalho.ts";
import { estadoInicial, type Estado } from "../../../web/estado/reducer.ts";
import { estadoMascoteNaConversa } from "../../../web/lib/mascote.ts";
import { pontoTrabalho } from "../../../web/lib/trabalhos.ts";
import { nivelDaGaveta } from "../../../web/telas/detalhes.ts";

/**
 * Defeitos achados no QA do épico #188 (definido em 2026-10-08: app real sobre banco efêmero, executor catcher, Chrome
 * headless e as pranchas do protótipo "Chat limpo" lado a lado). Cada teste falhava antes da correção.
 */

describe("gaveta: todo nível que a visão geral oferece abre", () => {
  it("a linha \"Trabalhos\" da gaveta abre o nível dos trabalhos (antes o clique não fazia nada)", () => {
    expect(nivelDaGaveta("trabalhos")).toEqual({ tipo: "trabalhos" });
  });

  it("cada irPara(…) desenhado em detalhes.ts tem nível no clique", () => {
    const fonte = readFileSync(new URL("../../../web/telas/detalhes.ts", import.meta.url), "utf8");
    // ADR-125: irPara(a, "nivel") e as linhas de Ajustes, que passam por origem("nivel").
    const niveis = [...fonte.matchAll(/(?:irPara\(a, |origem\()"([a-z-]+)"/g)].map((m) => m[1] ?? "");
    expect(niveis.length).toBeGreaterThan(5);
    for (const n of niveis) expect(nivelDaGaveta(n, "x"), n).not.toBeNull();
    expect(nivelDaGaveta("nao-existe")).toBeNull();
  });
});

const MIN = 60_000;
const AGORA = new Date(2026, 9, 8, 10, 0).getTime();
const trabalho = (id: string, extra: Partial<TrabalhoDto> = {}): TrabalhoDto => ({
  id, agenteId: "dev1", conversaId: "c-dev1", titulo: id, origem: "pessoa", pedidoPorAgenteId: null, rotinaId: null, trabalhoMaeId: null, depoisDeTrabalhoId: null, estado: "rodando",
  pasta: null, memoriaMb: null, custoUsd: null, criadoEm: AGORA - 30 * MIN, iniciadoEm: AGORA - 20 * MIN, terminadoEm: null, pedidoPorNome: null, rotinaNome: null, ultimoPasso: null, turnoVivoId: null, esperandoComputadorDe: null, ...extra,
});
const vivo = (turnoId: string, trabalhoId: string | null = null) => ({ turnoId, conversaId: "c-dev1", estado: "rodando" as const, executor: null, machineId: null, desde: AGORA, trabalhoId });

describe("um sinal por bot (K8 variante 3): task rodando não anima o mascote", () => {
  it("o turno de uma task (pelo trabalhoId do turno ou pelo turnoVivoId da lista) deixa o mascote disponível; o da conversa anima", () => {
    const comTask: Estado = { ...estadoInicial, turnosVivos: { tv: vivo("tv", "login") } };
    expect(estadoMascoteNaConversa(comTask, "c-dev1")).toBe("disponivel");
    const pelaLista: Estado = { ...estadoInicial, turnosVivos: { tv: vivo("tv") }, trabalhos: { trabalhos: [trabalho("login", { turnoVivoId: "tv" })], pressao: null, memoriaTotalMb: null } };
    expect(estadoMascoteNaConversa(pelaLista, "c-dev1")).toBe("disponivel");
    const conversa: Estado = { ...pelaLista, turnosVivos: { ...pelaLista.turnosVivos, tc: vivo("tc") } };
    expect(estadoMascoteNaConversa(conversa, "c-dev1")).toBe("trabalhando");
  });
});

describe("o ✓ é só da task que terminou", () => {
  it("terminada ✓; parada ■; falhou !", () => {
    expect(pontoTrabalho({ estado: "terminado" }, "c-red")).toContain(">✓<");
    expect(pontoTrabalho({ estado: "parado" }, "c-red")).toBe('<span class="ponto-trabalho feito parado" aria-hidden="true">■</span>');
    expect(pontoTrabalho({ estado: "falhou" }, "c-red")).toBe('<span class="ponto-trabalho feito falhou" aria-hidden="true">!</span>');
  });
});
