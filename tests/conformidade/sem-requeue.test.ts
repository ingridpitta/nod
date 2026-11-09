import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ADR-009/010: turno interrompido NUNCA volta a 'pendente' (requeue automático está na lista
 * NÃO CONSTRUIR). O único lugar que escreve 'pendente' é o INSERT de turnosRepo.enfileirar (pelo
 * DEFAULT da coluna). Este gate varre TODO o src/ (repositórios, use-cases, adapters/fundo, services)
 * e acusa qualquer UPDATE turnos ... SET ... estado = 'pendente'. Sem banco: lê os arquivos.
 */
const RAIZ = join(process.cwd(), "src");

async function arquivosTs(dir: string): Promise<string[]> {
  const saida: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const caminho = join(dir, e.name);
    if (e.isDirectory()) saida.push(...(await arquivosTs(caminho)));
    else if (e.name.endsWith(".ts")) saida.push(caminho);
  }
  return saida;
}

/**
 * UPDATE turnos … SET … estado = 'pendente' com o `estado = 'pendente'` DENTRO do SET (antes do WHERE):
 * o `where t.estado = 'pendente'` da própria reivindicação não é requeue.
 */
const REQUEUE = /update\s+turnos\b[\s\S]{0,300}?\bset\b(?:(?!\bwhere\b)[\s\S]){0,600}?\bestado\s*=\s*'pendente'/i;

function acusar(codigo: string): string[] {
  const achados: string[] = [];
  const m = REQUEUE.exec(codigo);
  if (m) achados.push(m[0].replace(/\s+/g, " ").slice(0, 120));
  return achados;
}

describe("gate: nenhum caminho reenfileira turno (UPDATE turnos SET estado = 'pendente')", () => {
  it("o detector reconhece a forma proibida (teste negativo do gate)", () => {
    expect(acusar("await conn`update turnos set estado = 'pendente', lease_ate = null where id = ${id}`")).toHaveLength(1);
    expect(acusar("UPDATE turnos\n  SET machine_id = null,\n      estado = 'pendente'\nWHERE 1=1")).toHaveLength(1);
    expect(acusar("insert into turnos (estado) values ('pendente')")).toHaveLength(0);
    expect(acusar("update turnos set estado = 'interrompido' where id = 1")).toHaveLength(0);
    expect(acusar("update turnos set estado = 'despachando', lease_ate = now() where (tenant_id, id) = (select t.tenant_id, t.id from turnos t where t.estado = 'pendente' limit 1)")).toHaveLength(0);
  });

  it("src/** não contém nenhum UPDATE que volte um turno a 'pendente'", async () => {
    const arquivos = await arquivosTs(RAIZ);
    expect(arquivos.length).toBeGreaterThan(20);
    const violacoes: string[] = [];
    for (const f of arquivos) {
      for (const a of acusar(await readFile(f, "utf8"))) violacoes.push(`${f.slice(process.cwd().length + 1)}: ${a}`);
    }
    expect(violacoes).toEqual([]);
  });
});
