/**
 * Divide um fluxo de bytes em linhas (JSON-RPC newline-delimited sobre stdio, como o CLI fala com
 * o servidor MCP — mapa-cli). Guarda o pedaço incompleto entre chunks, aceita CRLF e descarta
 * linhas vazias. O decoder usa `stream: true` para não partir um caractere UTF-8 entre dois chunks.
 */
export type LineSplitter = {
  /** Alimenta um chunk e devolve as linhas COMPLETAS que ele fechou. */
  alimentar(chunk: string | Uint8Array): string[];
  /** Fim do fluxo: devolve a última linha sem newline, se houver. */
  encerrar(): string[];
};

function semCr(l: string): string {
  return l.endsWith("\r") ? l.slice(0, -1) : l;
}

export function criarLineSplitter(): LineSplitter {
  let resto = "";
  const decoder = new TextDecoder("utf-8");
  return {
    alimentar(chunk) {
      const texto = typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
      const partes = (resto + texto).split("\n");
      resto = partes.pop() ?? "";
      return partes.map(semCr).filter((l) => l.trim() !== "");
    },
    encerrar() {
      const final = semCr(resto + decoder.decode());
      resto = "";
      return final.trim() === "" ? [] : [final];
    },
  };
}
