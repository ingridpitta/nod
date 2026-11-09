import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { lerLinhas, resumirLigacoes, sugestoesDeFone, tabelaMarkdown } from "../../../scripts/uat/relatorio-ligacao.ts";

/** NOD-165: o relatório da UAT da ligação sai do log do servidor, sem áudio e sem texto falado. */
const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const linha = (ts: string, evento: string, campos: Record<string, unknown> = {}) =>
  JSON.stringify({ ts, nivel: "info", evento, tenant_id: "t", pessoa_id: "p", correlation_id: null, ...campos });

const LOG = [
  "[api] servidor de pé em :8890",
  linha("2026-10-06T13:00:00.000Z", "voz_provedores", { stt: "local" }),
  linha("2026-10-06T13:00:01.000Z", "voz_rota_saida", { ligacao_id: A, rota: "alto-falante" }),
  ...[5, 10, 15, 20].map((s) => linha(`2026-10-06T13:00:${String(s).padStart(2, "0")}.000Z`, "voz_eco_descartado", { ligacao_id: A })),
  "Error: algo\n    at x (y.ts:1:1)",
  "{ quebrado",
  linha("2026-10-06T13:03:00.000Z", "voz_ligacao_encerrada", { ligacao_id: A, motivo: "pessoa", trocas: 6, interrupcoes: 2, latencia_p50_ms: 1450, ecos_descartados: 4 }),
  linha("2026-10-06T13:05:00.000Z", "voz_eco_descartado", { ligacao_id: B }),
  linha("2026-10-06T13:08:00.000Z", "voz_ligacao_encerrada", { ligacao_id: B, motivo: "pessoa", trocas: 3, interrupcoes: 0, latencia_p50_ms: 1200 }),
  linha("2026-10-06T14:00:00.000Z", "voz_eco_descartado", { ligacao_id: "cccccccc-0000-4000-8000-000000000003" }),
].join("\n");

describe("scripts/uat/relatorio-ligacao.ts (NOD-165)", () => {
  it("lê só as linhas JSON de evento, ignorando o resto da saída do servidor", () => {
    expect(lerLinhas(LOG).map((l) => l.evento)).toEqual([
      "voz_provedores", "voz_rota_saida", "voz_eco_descartado", "voz_eco_descartado", "voz_eco_descartado", "voz_eco_descartado",
      "voz_ligacao_encerrada", "voz_eco_descartado", "voz_ligacao_encerrada", "voz_eco_descartado",
    ]);
  });

  it("uma linha por ligação do intervalo, com as métricas do encerramento e os ecos contados", () => {
    const r = resumirLigacoes(lerLinhas(LOG), { de: Date.parse("2026-10-06T12:59:00Z"), ate: Date.parse("2026-10-06T13:30:00Z") });
    expect(r).toEqual([
      { ligacaoId: A, inicio: "2026-10-06T13:00:01.000Z", fim: "2026-10-06T13:03:00.000Z", motivo: "pessoa", trocas: 6, interrupcoes: 2, latenciaP50Ms: 1450, ecos: 4, sugestoesDeFone: 1, rotas: ["alto-falante"] },
      { ligacaoId: B, inicio: "2026-10-06T13:05:00.000Z", fim: "2026-10-06T13:08:00.000Z", motivo: "pessoa", trocas: 3, interrupcoes: 0, latenciaP50Ms: 1200, ecos: 1, sugestoesDeFone: 0, rotas: [] },
    ]);
  });

  it("ligação ainda viva (sem encerramento) sai com métricas vazias", () => {
    const [r] = resumirLigacoes(lerLinhas(LOG), { de: Date.parse("2026-10-06T13:59:00Z") });
    expect(r).toMatchObject({ fim: null, motivo: null, trocas: null, latenciaP50Ms: null, ecos: 1 });
  });

  it("sugestão de fone: conta cada vez que passa de 3 ecos no minuto, não cada eco", () => {
    expect(sugestoesDeFone([0, 1_000, 2_000])).toBe(0);
    expect(sugestoesDeFone([0, 1_000, 2_000, 3_000, 4_000])).toBe(1);
    // Volta abaixo do limite e passa de novo: duas sugestões.
    expect(sugestoesDeFone([0, 1_000, 2_000, 3_000, 200_000, 201_000, 202_000, 203_000])).toBe(2);
  });

  it("a tabela marca falha quando houve decisão durante a ligação e diz quando o banco não foi consultado", () => {
    const r = resumirLigacoes(lerLinhas(LOG), { ate: Date.parse("2026-10-06T13:30:00Z") });
    const ok = tabelaMarkdown(r, []);
    expect(ok).toContain("| aaaaaaaa | 2026-10-06T13:00:01.000Z | pessoa | 6 | 2 | 1450 | 4 | 1 | alto-falante | 0 |");
    expect(ok).toContain("Ligações: 2 · encerradas: 2 · interrupções: 2 · ecos descartados: 5 · sugestões de fone: 1");
    expect(ok).toContain("Decisões tomadas durante as ligações: 0 ✅");
    const falha = tabelaMarkdown(r, [{ ligacaoId: B, decisaoId: "d1", tipo: "aprovacao", estado: "aprovada", decididaEm: "2026-10-06T13:06:00.000Z" }]);
    expect(falha).toContain("| bbbbbbbb |");
    expect(falha).toMatch(/\| bbbbbbbb .*\| 1 \|$/m);
    expect(falha).toContain("Decisões tomadas durante as ligações: 1 ❌");
    expect(tabelaMarkdown(r, null)).toContain("banco não consultado");
  });

  // Regressão: QA da NOD-165 (Teodora, 2026-10-05). Id que não é uuid nunca vai ao banco: "0" diria que foi conferido.
  it("ligação com id que não é uuid mostra — na coluna de decisões, não 0", () => {
    const log = [
      linha("2026-10-06T13:00:01.000Z", "voz_rota_saida", { ligacao_id: "lig-teste", rota: "alto-falante" }),
      linha("2026-10-06T13:03:00.000Z", "voz_ligacao_encerrada", { ligacao_id: "lig-teste", motivo: "pessoa", trocas: 1, interrupcoes: 0, latencia_p50_ms: 900 }),
    ].join("\n");
    expect(tabelaMarkdown(resumirLigacoes(lerLinhas(log), {}), [])).toMatch(/^\| lig-test .*\| — \|$/m);
  });
});

// Regressão: QA da NOD-165 (Teodora, 2026-10-05). `--de` sem valor desligava o filtro com exit 0, e um log sem
// ligação nenhuma saía com exit 0 dizendo "banco não consultado (--sem-banco)" sem a flag.
function rodar(args: string[]) {
  const r = spawnSync(process.execPath, ["scripts/uat/relatorio-ligacao.ts", ...args], { encoding: "utf8", timeout: 30_000, env: { PATH: process.env.PATH ?? "", TMPDIR: tmpdir() } });
  return { codigo: r.status, saida: `${r.stdout}${r.stderr}` };
}

// processo de verdade, vários por caso: sob o check inteiro em paralelo, cada um leva segundos
// NOD-194 (QA): medido em 2026-10-08 (Mac, duas `test:unit` em paralelo, load ~500): 3–4 s por caso, no pior 3,9 s.
// 60 s cobre com folga larga; cada `spawnSync` ainda corta em 30 s.
describe("scripts/uat/relatorio-ligacao.ts: uso inválido (NOD-165)", { timeout: 60_000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), "qa-relatorio-"));
  const comLigacao = join(dir, "com.log");
  writeFileSync(comLigacao, LOG);
  const semLigacao = join(dir, "sem.log");
  writeFileSync(semLigacao, "[api] servidor de pé em :8890\n");

  it.each([
    [["--log", comLigacao, "--de"], /--de precisa de um valor/],
    [["--log", comLigacao, "--de", "--sem-banco"], /--de precisa de um valor/],
    [["--log", "--sem-banco"], /--log precisa de um valor/],
    [["--log", comLigacao, "--de", "2026-10-07T00:00:00Z", "--ate", "2026-10-06T00:00:00Z", "--sem-banco"], /--de precisa vir antes de --ate/],
    [["--log", semLigacao, "--sem-banco"], /nenhuma ligação em .*confira o arquivo de log/],
    [["--log", comLigacao, "--de", "2026-10-07T00:00:00Z", "--sem-banco"], /nenhuma ligação .*no intervalo de --de\/--ate/],
  ])("%j sai com erro de uso em pt-BR, sem pilha", (args, msg) => {
    const r = rodar(args);
    expect(r.codigo).toBe(1);
    expect(r.saida).toMatch(msg);
    expect(r.saida).not.toMatch(/\n\s+at /);
  });

  it("o caminho certo continua saindo com exit 0", () => {
    const r = rodar(["--log", comLigacao, "--sem-banco"]);
    expect(r.codigo).toBe(0);
    expect(r.saida).toContain("| aaaaaaaa |");
  });
});
