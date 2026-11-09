// Quantos blocos bash das skills deste Mac a lista de arriscados (comandoArriscado) e a de credencial
// (tocaCredencial) param no automático — ADR-059, segunda emenda de 2026-09-30. Rode a cada mudança em ARRISCADOS
// ou CREDENCIAL (src/domain/comando.ts): `npx tsx scripts/medir-arriscados.ts`. Só lê arquivos; não chama modelo.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { comandoArriscado, tocaCredencial } from "../src/domain/comando.ts";

function skills(dir: string, fundo = 0): string[] {
  if (fundo > 6) return [];
  let itens: string[];
  try { itens = readdirSync(dir); } catch { return []; }
  return itens.flatMap((n) => {
    const p = join(dir, n);
    try {
      if (statSync(p).isDirectory()) return skills(p, fundo + 1);
    } catch { return []; }
    return n === "SKILL.md" ? [p] : [];
  });
}

const arquivos = [...new Set([...skills(join(homedir(), ".claude/skills")), ...skills(join(homedir(), ".claude/plugins/cache"))])];
let blocos = 0;
const porMotivo = new Map<string, { n: number; exemplos: string[] }>();
for (const f of arquivos) {
  for (const m of readFileSync(f, "utf8").matchAll(/```(?:bash|sh|shell)\n([\s\S]*?)```/g)) {
    blocos++;
    const bloco = m[1] ?? "";
    for (const motivo of [comandoArriscado(bloco), tocaCredencial(bloco) ? "toca credencial (pede em qualquer modo)" : null]) {
      if (!motivo) continue;
      const r = porMotivo.get(motivo) ?? { n: 0, exemplos: [] };
      r.n++;
      const linha = bloco.split("\n").find((l) => comandoArriscado(l) === motivo || (motivo.startsWith("toca") && tocaCredencial(l))) ?? "";
      if (r.exemplos.length < 3) r.exemplos.push(`${f.replace(homedir(), "~")}: ${linha.trim().slice(0, 140)}`);
      porMotivo.set(motivo, r);
    }
  }
}
process.stdout.write(`${arquivos.length} SKILL.md, ${blocos} blocos bash\n`);
for (const [motivo, r] of [...porMotivo.entries()].sort((a, b) => b[1].n - a[1].n)) {
  process.stdout.write(`\n${r.n} × ${motivo}\n${r.exemplos.map((e) => `   ${e}`).join("\n")}\n`);
}
