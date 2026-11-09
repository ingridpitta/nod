/**
 * NOD-169: relatório do ensaio — `execucoes.jsonl` → markdown de tarefa × harness (sucesso/N, sucesso falso, falha
 * honesta, tempo mediano, custo médio), resumo por harness, projeção de custo e falhas reproduzíveis (≥ 2 de 3).
 * Uso: node scripts/ensaio-computador/relatorio.ts /tmp/nod-ensaio-<data>/execucoes.jsonl > relatorio.md
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Classe } from "./verificar.ts";

export type Execucao = {
  data: string;
  commit: string;
  imagem: string;
  harness: string;
  modelo: string;
  tarefa: number;
  chave: string;
  nome: string;
  repeticao: number;
  classe: Classe;
  detalhe: string;
  ms: number;
  /** null = o harness não informa custo (Codex: `custoUsd: null`). */
  custoUsd: number | null;
  tokensEntrada: number;
  tokensSaida: number;
  ajuda: string | null;
  /** Trecho da resposta, para a revisão humana do sucesso falso. */
  trecho: string;
};

/** Execuções planejadas na rodada completa: 10 tarefas × 3 repetições por harness = 30; × 2 harnesses = 60. */
export const EXECUCOES_POR_HARNESS = 30;
export const META = "≥ 80% de sucesso por harness e zero sucesso falso (proposta, aguardando o Marlon)";

const CONTA_PARA_MODELO: readonly Classe[] = ["sucesso", "falha_honesta", "sucesso_falso"];

export function mediana(ns: number[]): number {
  if (!ns.length) return 0;
  const o = [...ns].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m]! : (o[m - 1]! + o[m]!) / 2;
}

export type Celula = { total: number; sucesso: number; sucessoFalso: number; falhaHonesta: number; timeout: number; bloqueado: number; msMediano: number; custoMedio: number | null; tokensMedios: { entrada: number; saida: number } };

export function agregar(execs: Execucao[]): Celula {
  const conta = (c: Classe) => execs.filter((e) => e.classe === c).length;
  const custos = execs.map((e) => e.custoUsd).filter((c): c is number => c !== null);
  const media = (ns: number[]) => (ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : 0);
  return {
    total: execs.length, sucesso: conta("sucesso"), sucessoFalso: conta("sucesso_falso"), falhaHonesta: conta("falha_honesta"), timeout: conta("timeout"), bloqueado: conta("bloqueado_config"),
    msMediano: mediana(execs.map((e) => e.ms)),
    custoMedio: custos.length ? media(custos) : null,
    tokensMedios: { entrada: Math.round(media(execs.map((e) => e.tokensEntrada))), saida: Math.round(media(execs.map((e) => e.tokensSaida))) },
  };
}

/** Falha reproduzível: a mesma tarefa × harness sem sucesso em ≥ 2 execuções que contam para o modelo. */
export function falhasReproduziveis(execs: Execucao[]): { harness: string; tarefa: number; nome: string; falhas: number; de: number }[] {
  const grupos = new Map<string, Execucao[]>();
  for (const e of execs) grupos.set(`${e.harness}|${e.tarefa}`, [...(grupos.get(`${e.harness}|${e.tarefa}`) ?? []), e]);
  const saida: { harness: string; tarefa: number; nome: string; falhas: number; de: number }[] = [];
  for (const g of grupos.values()) {
    const validas = g.filter((e) => CONTA_PARA_MODELO.includes(e.classe));
    const falhas = validas.filter((e) => e.classe !== "sucesso").length;
    if (falhas >= 2) saida.push({ harness: g[0]!.harness, tarefa: g[0]!.tarefa, nome: g[0]!.nome, falhas, de: validas.length });
  }
  return saida.sort((a, b) => a.harness.localeCompare(b.harness) || a.tarefa - b.tarefa);
}

/** Projeção das 30 execuções de um harness a partir do custo medido: faixa de 1× a 3× (tarefas com várias telas custam mais). */
export function projetar(custoPorExecucao: number, execucoes = EXECUCOES_POR_HARNESS): { min: number; max: number } {
  return { min: custoPorExecucao * execucoes, max: custoPorExecucao * execucoes * 3 };
}

const usd = (n: number | null) => (n === null ? "US$ n/d" : `US$ ${n.toFixed(4)}`);
const seg = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

export function gerarRelatorio(execs: Execucao[]): string {
  if (!execs.length) return "# Ensaio do computador\n\nNenhuma execução registrada.\n";
  const harnesses = [...new Set(execs.map((e) => e.harness))];
  const tarefas = [...new Map(execs.map((e) => [e.tarefa, e.nome])).entries()].sort((a, b) => a[0] - b[0]);
  const l: string[] = [];
  const p = execs[0]!;
  l.push("# Ensaio do computador (NOD-169)", "", `- Data: ${p.data}`, `- Commit: \`${p.commit}\``, `- Imagem: \`${p.imagem}\``, `- Harnesses: ${[...new Set(execs.map((e) => `${e.harness}/${e.modelo}`))].join(", ")}`, `- Meta: ${META}`, "");
  l.push("## Por tarefa", "", `| Tarefa | ${harnesses.join(" | ")} |`, `|---|${harnesses.map(() => "---").join("|")}|`);
  for (const [id, nome] of tarefas) {
    const cel = harnesses.map((h) => {
      const c = agregar(execs.filter((e) => e.harness === h && e.tarefa === id));
      if (!c.total) return "—";
      const extras = [c.sucessoFalso && `${c.sucessoFalso} falso`, c.falhaHonesta && `${c.falhaHonesta} honesta`, c.timeout && `${c.timeout} timeout`, c.bloqueado && `${c.bloqueado} bloqueado`].filter(Boolean).join(", ");
      return `${c.sucesso}/${c.total}${extras ? ` (${extras})` : ""} · ${seg(c.msMediano)} · ${usd(c.custoMedio)}`;
    });
    l.push(`| ${id}. ${nome} | ${cel.join(" | ")} |`);
  }
  l.push("", "## Por harness", "", "| Harness | Sucesso | Sucesso falso | Falha honesta | Timeout | Bloqueado | Tempo mediano | Custo médio | Tokens médios (entrada/saída) | Meta |", "|---|---|---|---|---|---|---|---|---|---|");
  for (const h of harnesses) {
    const c = agregar(execs.filter((e) => e.harness === h));
    const validas = c.sucesso + c.sucessoFalso + c.falhaHonesta;
    const pct = validas ? (100 * c.sucesso) / validas : 0;
    const meta = c.total < EXECUCOES_POR_HARNESS ? "rodada parcial" : pct >= 80 && c.sucessoFalso === 0 ? "passou" : "não passou";
    l.push(`| ${h} | ${c.sucesso}/${validas} (${pct.toFixed(0)}%) | ${c.sucessoFalso} | ${c.falhaHonesta} | ${c.timeout} | ${c.bloqueado} | ${seg(c.msMediano)} | ${usd(c.custoMedio)} | ${c.tokensMedios.entrada}/${c.tokensMedios.saida} | ${meta} |`);
  }
  l.push("", "## Projeção da rodada completa", "", "Custo médio por execução × 30 por harness, numa faixa de 1× a 3×. Os dois harnesses rodam em assinatura: o custo é cota consumida.", "");
  for (const h of harnesses) {
    const c = agregar(execs.filter((e) => e.harness === h));
    if (c.custoMedio === null) { l.push(`- ${h}: US$ n/d (o harness não informa custo); tokens médios por execução ${c.tokensMedios.entrada} de entrada e ${c.tokensMedios.saida} de saída → 30 execuções ≈ ${c.tokensMedios.entrada * 30}–${c.tokensMedios.entrada * 90} de entrada.`); continue; }
    const pr = projetar(c.custoMedio);
    l.push(`- ${h}: ${usd(pr.min)} a ${usd(pr.max)}`);
  }
  const rep = falhasReproduziveis(execs);
  l.push("", "## Falhas reproduzíveis (≥ 2 de 3)", "", rep.length ? rep.map((r) => `- ${r.harness} · tarefa ${r.tarefa} (${r.nome}): ${r.falhas} de ${r.de}`).join("\n") : "Nenhuma.", "");
  const revisar = execs.filter((e) => e.classe === "sucesso_falso");
  l.push("## Para revisão humana (sucesso falso)", "", revisar.length ? revisar.map((e) => `- ${e.harness} · tarefa ${e.tarefa} · rep ${e.repeticao}: ${e.detalhe}\n  > ${e.trecho.replace(/\n+/g, " ").slice(0, 300)}`).join("\n") : "Nenhum.", "");
  l.push("## Execuções", "", "| Harness | Tarefa | Rep | Classe | Detalhe | Tempo | Custo | Tokens | Ajuda |", "|---|---|---|---|---|---|---|---|---|");
  for (const e of execs) l.push(`| ${e.harness} | ${e.tarefa} | ${e.repeticao} | ${e.classe} | ${e.detalhe.replace(/\|/g, "/")} | ${seg(e.ms)} | ${usd(e.custoUsd)} | ${e.tokensEntrada}/${e.tokensSaida} | ${e.ajuda ?? "—"} |`);
  return l.join("\n") + "\n";
}

export function lerExecucoes(jsonl: string): Execucao[] {
  return jsonl.split("\n").filter((s) => s.trim()).map((s) => JSON.parse(s) as Execucao);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arquivo = process.argv[2];
  if (!arquivo) { process.stderr.write("uso: node scripts/ensaio-computador/relatorio.ts <execucoes.jsonl>\n"); process.exit(2); }
  process.stdout.write(gerarRelatorio(lerExecucoes(readFileSync(arquivo, "utf8"))));
}
