/**
 * NOD-327: leitor de CSV da prévia, sem lib. Puro (sem DOM), para o teste unit.
 *
 * - separador `,`, `;` ou tab, decidido pelo 1º registro fora de aspas (o que mais aparece; empate fica com a vírgula);
 * - BOM, CRLF/CR, `""` dentro de aspas e quebra de linha dentro de aspas;
 * - aspas sem fechar: o resto do arquivo vira um campo;
 * - linha torta (menos colunas) é completada com vazio até a largura da mais larga;
 * - UTF-8; se o decode estrito falhar, windows-1252 (o "CSV do Excel" em português);
 * - só as `teto` primeiras linhas viram células; `total` conta todas, sem montar nada.
 */
export type Separador = "," | ";" | "\t";
export type CsvLido = { linhas: string[][]; total: number; separador: Separador; colunas: number };

export function decodificar(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(u8);
  } catch {
    return new TextDecoder("windows-1252").decode(u8);
  }
}

export function detectarSeparador(texto: string): Separador {
  const conta: Record<Separador, number> = { ",": 0, ";": 0, "\t": 0 };
  let aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (c === '"') aspas = !aspas;
    else if (!aspas && (c === "\n" || c === "\r")) break;
    else if (!aspas && (c === "," || c === ";" || c === "\t")) conta[c]++;
  }
  if (conta[";"] > conta[","] && conta[";"] >= conta["\t"]) return ";";
  if (conta["\t"] > conta[","] && conta["\t"] > conta[";"]) return "\t";
  return ",";
}

export function lerCsv(bytes: ArrayBuffer | Uint8Array | string, teto = 5000): CsvLido {
  let texto = typeof bytes === "string" ? bytes : decodificar(bytes);
  if (texto.charCodeAt(0) === 0xfeff) texto = texto.slice(1);
  const separador = detectarSeparador(texto);
  const linhas: string[][] = [];
  let total = 0;
  let colunas = 0;
  let registro: string[] = [];
  let campo = "";
  let i = 0;
  const n = texto.length;

  const fecharRegistro = () => {
    registro.push(campo);
    campo = "";
    // Linha em branco (um campo vazio só) não conta como registro.
    if (!(registro.length === 1 && registro[0] === "")) {
      total++;
      if (linhas.length < teto) {
        linhas.push(registro);
        if (registro.length > colunas) colunas = registro.length;
      }
    }
    registro = [];
  };

  while (i < n) {
    const c = texto[i];
    if (c === '"' && campo === "") {
      // Campo entre aspas: vai até a aspa que fecha (`""` é uma aspa literal). Sem fechar, o resto é o campo.
      i++;
      let fechou = false;
      while (i < n) {
        const d = texto[i];
        if (d === '"') {
          if (texto[i + 1] === '"') { campo += '"'; i += 2; continue; }
          i++;
          fechou = true;
          break;
        }
        campo += d;
        i++;
      }
      if (!fechou) break;
      // Texto depois da aspa que fecha, antes do separador (`"a"b`): entra no campo, como as planilhas fazem.
      continue;
    }
    if (c === separador) { registro.push(campo); campo = ""; i++; continue; }
    if (c === "\r" || c === "\n") {
      fecharRegistro();
      i += c === "\r" && texto[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    campo += c;
    i++;
  }
  if (campo !== "" || registro.length > 0) fecharRegistro();

  for (const r of linhas) while (r.length < colunas) r.push("");
  return { linhas, total, separador, colunas };
}

/** Células selecionadas → TSV (o que o ⌘C copia). Célula com tab, quebra ou aspas vai entre aspas, como o Excel lê. */
export function paraTsv(celulas: readonly (readonly string[])[]): string {
  return celulas
    .map((linha) => linha.map((c) => (/[\t\n\r"]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join("\t"))
    .join("\n");
}

/** "5.000" — o milhar com ponto, como no protótipo. */
export function milhar(n: number): string {
  return n.toLocaleString("pt-BR");
}
