import { realpathSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { trechoAplicavel, trechoDeRollback } from "../src/db/migrar.ts";

/**
 * NOD-186: migração nova só ADICIONA. O rollback de código (NOD-173) volta a imagem e deixa o banco
 * com as migrações novas; uma coluna apagada, renomeada ou com outro tipo quebra o código antigo.
 * Este gate lê o trecho aplicável (antes de `-- ROLLBACK:`, pela mesma função do runner), sem
 * comentários nem literais de texto, e barra DROP TABLE, DROP [COLUMN], RENAME, ALTER [COLUMN] … TYPE
 * e SET NOT NULL. NOD-191: também DROP [MATERIALIZED] VIEW, DROP TYPE, DROP DOMAIN, DROP FUNCTION/
 * PROCEDURE/ROUTINE, TRUNCATE e, em ALTER TYPE, ALTER ATTRIBUTE … TYPE e DROP ATTRIBUTE (o código antigo
 * procura a view/função/tipo que sumiu; TRUNCATE apaga dado que o rollback não devolve). Exceção caso a caso: `-- destrutiva-ok: <motivo>` na linha anterior ao comando
 * (ou à cláusula dele), valendo até o `;` seguinte; motivo vazio não vale. Regra no AGENTS.md.
 *
 * definido em 2026-10-06: corte por número, não por diff (não depende de fetch-depth nem da base do PR).
 * As 58 que existiam ficam de fora; duas delas seriam barradas (0003:114 e 0046:11).
 */
export const BASE_ADITIVA = 58;

export type Problema = {
  arquivo: string;
  linha: number;
  comando: string;
  motivo: "destrutiva" | "excecao_sem_motivo" | "sem_rollback" | "rollback_vazio";
};

// [^\n]: com CRLF o `\r` fica no motivo (e sai no trim); com `.` e `$` a marca nunca casava.
const EXCECAO = /^\s*--\s*destrutiva-ok:([^\n]*)$/i;
// O conteúdo de "…" já vem em branco. Identificador sem aspas no Postgres aceita letra não ASCII
// (`orçamentos`, `preço`): sem a faixa \u0080-\uffff, `ALTER COLUMN preço TYPE` e `TRUNCATE orçamentos`
// escapavam (QA NOD-191).
const LETRA = String.raw`a-z_\u0080-\uffff`;
const ID = String.raw`(?:"[^"]+"|[${LETRA}][${LETRA}0-9$]*)`;
const PADROES: { comando: string; re: RegExp }[] = [
  { comando: "DROP TABLE", re: /\bDROP\s+TABLE\b/gi },
  { comando: "RENAME", re: /\bRENAME\b/gi },
  { comando: "SET NOT NULL", re: /\bSET\s+NOT\s+NULL\b/gi },
  // NOD-191. CREATE OR REPLACE e DROP INDEX/TRIGGER/POLICY não casam (não apagam dado nem objeto lido).
  { comando: "DROP VIEW", re: /\bDROP\s+(?:MATERIALIZED\s+)?VIEW\b/gi },
  { comando: "DROP TYPE", re: /\bDROP\s+TYPE\b/gi },
  { comando: "DROP DOMAIN", re: /\bDROP\s+DOMAIN\b/gi },
  { comando: "DROP FUNCTION", re: /\bDROP\s+(?:FUNCTION|PROCEDURE|ROUTINE)\b/gi },
  // TRUNCATE como privilégio (`GRANT/REVOKE …, TRUNCATE, … ON`) ou evento de trigger (`BEFORE TRUNCATE
  // [OR …] ON`) não é o comando: este nunca vem seguido de `,`, `ON` ou `OR` (palavras reservadas, não
  // podem ser nome de tabela). O fim de ON/OR é checado por caractere de identificador, não por `\b`:
  // `on$log` e `orçamentos` são nomes de tabela válidos e `\b` cortaria antes do `$` ou do `ç`.
  // `'TRUNCATE'` como literal inteiro só passa quando é o valor de TG_OP comparado (`= / <> / != / WHEN`,
  // ou numa lista `IN ('…', 'TRUNCATE')`) num corpo com EXECUTE; concatenado (`'TRUNCATE' || ' t'`,
  // `concat('TRUNCATE', …)`) é SQL dinâmico de verdade e barra (revisão NOD-191).
  {
    comando: "TRUNCATE",
    re: /\bTRUNCATE\b(?!\s*,|\s+(?:ON|OR)(?![A-Za-z0-9_$\u0080-\uffff]))(?!'(?<=(?:=|<>|!=|\bWHEN|\bIN\s*\((?:\s*'[^']*'\s*,)*)\s*'TRUNCATE'))/gi,
  },
];
// As cláusulas de coluna só existem dentro de ALTER [FOREIGN] TABLE, e são procuradas DEPOIS do cabeçalho
// `ALTER TABLE [IF EXISTS] [ONLY] nome [*]`. Assim `ALTER TABLE type ADD …` (tabela chamada type) não é
// ALTER … TYPE, e uma coluna chamada type/index (`ALTER type TYPE bigint`) não escapa.
const ALTER_TABLE = /\bALTER\s+(?:FOREIGN\s+)?TABLE\b[^;]*/gi;
const CABECALHO = new RegExp(
  String.raw`^ALTER\s+(?:FOREIGN\s+)?TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?${ID}(?:\s*\.\s*${ID})?(?:\s*\*)?`,
  "i",
);
const ALTER_TIPO = new RegExp(String.raw`\bALTER\s+(?:COLUMN\s+)?${ID}\s+(?:SET\s+DATA\s+)?TYPE\b`, "gi");
// Dentro de ALTER TABLE, `DROP x` sem a palavra COLUMN também apaga a coluna. Só não barram os DROP
// que tiram restrição/default/identidade.
const DROP_COLUNA = /\bDROP\s+(?!CONSTRAINT\b|DEFAULT\b|NOT\s+NULL\b|IDENTITY\b|EXPRESSION\b)/gi;
// NOD-191: o mesmo molde para ALTER TYPE (tipo composto). `ALTER TYPE` tem de vir colado: `ALTER COLUMN a
// TYPE` não entra. As cláusulas são procuradas depois de `ALTER TYPE nome[.nome]`, então um tipo chamado
// type (`ALTER TYPE type ADD VALUE`) não vira falso positivo; ADD VALUE e ADD ATTRIBUTE passam.
const ALTER_TYPE = /\bALTER\s+TYPE\b[^;]*/gi;
const CABECALHO_TYPE = new RegExp(String.raw`^ALTER\s+TYPE\s+${ID}(?:\s*\.\s*${ID})?`, "i");
const ALTER_ATRIBUTO = new RegExp(String.raw`\bALTER\s+ATTRIBUTE\s+${ID}\s+(?:SET\s+DATA\s+)?TYPE\b`, "gi");
const DROP_ATRIBUTO = /\bDROP\s+ATTRIBUTE\b/gi;

const IDENT_CHAR = /[A-Za-z0-9_$\u0080-\uffff]/;
const DOLAR = /\$([A-Za-z_][A-Za-z0-9_]*)?\$/y;

/**
 * Troca comentários (`--`, `/* *\/` aninhado, como no Postgres), o conteúdo de '…', E'…' (com `\'`)
 * e "…" por espaços, preservando posições e quebras de linha. O corpo de `$tag$…$tag$` continua
 * sendo verificado (DO/função é código), mas limpo à parte: uma aspa solta lá dentro (`$$it's$$`)
 * não engole o SQL depois do fechamento.
 */
export function semComentarios(sql: string): string {
  return limpar(sql).texto;
}

/**
 * `linhaComentario`: onde começa cada `--` que é comentário de verdade (fora de literal e de `/* *\/`),
 * para uma marca de exceção comentada não valer. `manterLiterais`: o corpo de um `$…$` que chama
 * EXECUTE monta SQL dinâmico em texto (`EXECUTE 'DROP TABLE x'`, `format('… DROP COLUMN %I', …)`);
 * nele o conteúdo dos literais é verificado como código.
 */
function limpar(sql: string, manterLiterais = false): { texto: string; linhaComentario: Set<number> } {
  const out = sql.split("");
  const linhaComentario = new Set<number>();
  let i = 0;
  const apagar = (de: number, ate: number) => {
    for (let k = de; k < ate; k++) if (out[k] !== "\n") out[k] = " ";
  };
  /** Fecha um literal delimitado por `q`, com `qq` como escape (e `\x` se `barra`). */
  const fimDoLiteral = (de: number, q: string, barra: boolean): number => {
    let j = de;
    while (j < sql.length) {
      if (barra && sql[j] === "\\") j += 2;
      else if (sql[j] === q && sql[j + 1] === q) j += 2;
      else if (sql[j] === q) return j;
      else j++;
    }
    return sql.length;
  };
  while (i < sql.length) {
    const antes = i > 0 ? (sql[i - 1] ?? "") : "";
    if (sql.startsWith("--", i)) {
      linhaComentario.add(i);
      const fim = sql.indexOf("\n", i);
      const ate = fim === -1 ? sql.length : fim;
      apagar(i, ate);
      i = ate;
    } else if (sql.startsWith("/*", i)) {
      let j = i + 2;
      let nivel = 1;
      while (j < sql.length && nivel > 0) {
        if (sql.startsWith("/*", j)) {
          nivel++;
          j += 2;
        } else if (sql.startsWith("*/", j)) {
          nivel--;
          j += 2;
        } else j++;
      }
      apagar(i, j);
      i = j;
    } else if (sql[i] === "'" || sql[i] === '"') {
      const q = sql[i] as string;
      const barra = q === "'" && /[eE]/.test(antes) && !IDENT_CHAR.test(i > 1 ? (sql[i - 2] ?? "") : "");
      const j = fimDoLiteral(i + 1, q, barra);
      if (!(manterLiterais && q === "'")) apagar(i + 1, j);
      i = j + 1;
    } else if (sql[i] === "$" && !IDENT_CHAR.test(antes)) {
      DOLAR.lastIndex = i;
      const m = DOLAR.exec(sql);
      const fim = m ? sql.indexOf(m[0], i + m[0].length) : -1;
      if (!m) {
        i++;
        continue;
      }
      const ini = i + m[0].length;
      const ate = fim === -1 ? sql.length : fim;
      const bruto = sql.slice(ini, ate);
      let corpo = limpar(bruto);
      if (/\bEXECUTE\b(?!\s+(?:FUNCTION|PROCEDURE)\b)/i.test(corpo.texto)) corpo = limpar(bruto, true);
      for (let k = 0; k < corpo.texto.length; k++) out[ini + k] = corpo.texto[k] as string;
      for (const c of corpo.linhaComentario) linhaComentario.add(ini + c);
      i = fim === -1 ? sql.length : fim + m[0].length;
    } else {
      i++;
    }
  }
  return { texto: out.join(""), linhaComentario };
}

function linhaDe(texto: string, pos: number): number {
  let n = 1;
  for (let k = 0; k < pos; k++) if (texto[k] === "\n") n++;
  return n;
}

/**
 * Cada marca cobre um trecho: do primeiro caractere de código depois da linha dela até o `;` seguinte.
 * Assim vale para o comando (ou a cláusula) logo abaixo, inclusive em várias linhas, e não para a
 * instrução seguinte na mesma linha nem para o resto do arquivo.
 */
function marcas(linhas: string[], limpo: string, linhaComentario: Set<number>): { de: number; ate: number; motivo: string }[] {
  const r: { de: number; ate: number; motivo: string }[] = [];
  let offset = 0;
  for (const linha of linhas) {
    const fimDaLinha = offset + linha.length;
    const m = EXCECAO.exec(linha);
    // A marca tem de ser um comentário `--` de verdade: dentro de /* */ ou de literal ela não vale.
    if (m && fimDaLinha <= limpo.length && linhaComentario.has(offset + linha.indexOf("--"))) {
      let de = fimDaLinha;
      while (de < limpo.length && /\s/.test(limpo[de] ?? "")) de++;
      const pv = limpo.indexOf(";", de);
      r.push({ de, ate: pv === -1 ? limpo.length : pv, motivo: (m[1] ?? "").trim() });
    }
    offset = fimDaLinha + 1;
  }
  return r;
}

export function verificarMigracao(arquivo: string, conteudo: string): Problema[] {
  const { texto: limpo, linhaComentario } = limpar(trechoAplicavel(conteudo));
  const excecoes = marcas(conteudo.split("\n"), limpo, linhaComentario);
  const achados: { pos: number; comando: string }[] = [];
  for (const { comando, re } of PADROES) for (const m of limpo.matchAll(re)) achados.push({ pos: m.index, comando });
  // Cláusula achada depois do cabeçalho manda no nome: em `ALTER TABLE t DROP type` (coluna chamada type)
  // o DROP TYPE de PADROES casa na mesma posição, mas o que se apaga é a coluna.
  const clausulasDe = (blocos: RegExp, cabecalho: RegExp, clausulas: [RegExp, string][]) => {
    for (const bloco of limpo.matchAll(blocos)) {
      const cab = cabecalho.exec(bloco[0])?.[0].length ?? 0;
      const corpo = bloco[0].slice(cab);
      for (const [re, comando] of clausulas) {
        for (const d of corpo.matchAll(re)) {
          const pos = bloco.index + cab + d.index;
          const ja = achados.find((a) => a.pos === pos);
          if (ja) ja.comando = comando;
          else achados.push({ pos, comando });
        }
      }
    }
  };
  clausulasDe(ALTER_TABLE, CABECALHO, [
    [DROP_COLUNA, "DROP COLUMN"],
    [ALTER_TIPO, "ALTER COLUMN … TYPE"],
  ]);
  clausulasDe(ALTER_TYPE, CABECALHO_TYPE, [
    [ALTER_ATRIBUTO, "ALTER ATTRIBUTE … TYPE"],
    [DROP_ATRIBUTO, "DROP ATTRIBUTE"],
  ]);
  const problemas: Problema[] = [];
  for (const { pos, comando } of achados.sort((a, b) => a.pos - b.pos)) {
    const linha = linhaDe(limpo, pos);
    const marca = excecoes.find((e) => e.de <= pos && pos <= e.ate);
    if (!marca) problemas.push({ arquivo, linha, comando, motivo: "destrutiva" });
    else if (!marca.motivo) problemas.push({ arquivo, linha, comando, motivo: "excecao_sem_motivo" });
  }
  return problemas;
}

/**
 * NOD-195: migração nova traz o bloco `-- ROLLBACK:` com pelo menos um comando (depois de `trechoDeRollback`,
 * sem comentários). O teste tests/conformidade/rollback-ida-e-volta.test.ts executa esse bloco e prova que ele
 * volta o schema; aqui só se garante que ele existe. Sem marcador, a linha é a última do arquivo; vazio, a do marcador.
 */
export function verificarRollback(arquivo: string, conteudo: string): Problema[] {
  const rollback = trechoDeRollback(conteudo);
  if (rollback === null) {
    const linhas = conteudo.replace(/\n$/, "").split("\n").length;
    return [{ arquivo, linha: linhas, comando: "-- ROLLBACK:", motivo: "sem_rollback" }];
  }
  // Só `;` (ou só espaço) não desfaz nada: conta como vazio.
  if (semComentarios(rollback).replace(/[\s;]/g, "") !== "") return [];
  const linha = linhaDe(conteudo, trechoAplicavel(conteudo).length);
  return [{ arquivo, linha, comando: "-- ROLLBACK:", motivo: "rollback_vazio" }];
}

/** Arquivos com prefixo numérico ≤ BASE_ADITIVA são ignorados; sem prefixo numérico, verificados. */
export function ehNova(nome: string, base = BASE_ADITIVA): boolean {
  const n = Number.parseInt(nome, 10);
  return Number.isNaN(n) || n > base;
}

export async function verificarPasta(dir: string, base = BASE_ADITIVA): Promise<{ verificadas: string[]; problemas: Problema[] }> {
  const novas = (await readdir(dir)).filter((f) => f.endsWith(".sql") && ehNova(f, base)).sort();
  const problemas: Problema[] = [];
  for (const nome of novas) {
    const conteudo = await readFile(join(dir, nome), "utf8");
    problemas.push(...verificarMigracao(nome, conteudo), ...verificarRollback(nome, conteudo));
  }
  return { verificadas: novas, problemas };
}

export function formatar(p: Problema): string {
  const onde = `src/db/migrations/${p.arquivo}:${p.linha}`;
  switch (p.motivo) {
    case "destrutiva":
      return `${onde}  ${p.comando} — migração nova só adiciona; se for inevitável, ponha "-- destrutiva-ok: <motivo>" na linha anterior`;
    case "excecao_sem_motivo":
      return `${onde}  ${p.comando} — "-- destrutiva-ok:" sem motivo; escreva o porquê`;
    case "sem_rollback":
      return `${onde}  falta o bloco "-- ROLLBACK:" (sozinho na linha, com o SQL que desfaz a migração em linhas "-- ")`;
    case "rollback_vazio":
      return `${onde}  bloco "-- ROLLBACK:" sem comando; escreva o SQL que desfaz a migração em linhas "-- "`;
  }
}

async function principal(): Promise<void> {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "db", "migrations");
  const { verificadas, problemas } = await verificarPasta(dir);
  if (problemas.length) {
    for (const p of problemas) process.stderr.write(`${formatar(p)}\n`);
    process.stderr.write(`FALHA: ${problemas.length} problema(s) em migração nova: destrutiva ou sem rollback (NOD-186/191/195, AGENTS.md).\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`migrações aditivas e com rollback ok: ${verificadas.length} nova(s) depois da ${String(BASE_ADITIVA).padStart(4, "0")}\n`);
}

// realpath: o loader ESM resolve symlink em import.meta.url e o argv[1] não. Sem isso, rodar o gate
// por um caminho com symlink não chamava principal() e saía 0 sem verificar nada (falha aberta).
// Os dois lados por realpath: com --preserve-symlinks-main o import.meta.url também fica com o symlink.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) await principal();
