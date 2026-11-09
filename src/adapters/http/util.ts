import type { IncomingMessage, ServerResponse } from "node:http";
import { acharTextoMalFormado } from "../../domain/texto-bem-formado.ts";

export function json(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(data);
}

/** definido em 2026-09-16: 1 MiB de corpo é folga para qualquer rota do nod; acima disso é abuso. */
export const CORPO_MAX = 1_048_576;
/**
 * definido em 2026-10-29 (1º ensaio no Mac): a resposta de uma ação do computador leva a captura da tela (PNG de
 * 1280×800 em base64) mais o texto da página; uma página pesada (ge.globo) passava de 1 MiB, o resultado caía em 400 e
 * a ação ficava presa até o prazo — a reserva da tela segurava até o Parar. Só a rota `computador/resultado` usa este.
 */
export const CORPO_MAX_RESULTADO_COMPUTADOR = 16 * 1_048_576;

/**
 * `daPessoa`: a rota é da pessoa (escopada no tenant ou pública). Só nela o corpo com byte nulo ou `null` é recusado;
 * as rotas de máquina e internas (o executor, a ponte do computador) seguem como antes: o que elas recebem é saída de
 * ferramenta e de terminal, onde o NUL é dado legítimo e cada rota trata (revisão 2 do #590).
 */
export async function lerCorpo(req: IncomingMessage, o: { daPessoa?: boolean; max?: number } = {}): Promise<unknown> {
  const pedacos: Buffer[] = [];
  let total = 0;
  const max = o.max ?? CORPO_MAX;
  for await (const c of req) {
    const buf = c as Buffer;
    total += buf.length;
    if (total > max) throw new SyntaxError("corpo grande demais");
    pedacos.push(buf);
  }
  if (pedacos.length === 0) return {};
  const texto = Buffer.concat(pedacos).toString("utf8");
  const corpo: unknown = JSON.parse(texto);
  // NOD-398 (achado do fuzz): `null` é JSON válido, mas nenhuma rota o aceita e o handler que faz `corpo.campo` estourava
  // TypeError (500). Recusado aqui como corpo malformado: o roteador responde 400 entrada_invalida.
  if (o.daPessoa && corpo === null) throw new SyntaxError("corpo null");
  // NOD-398 (achado do fuzz): byte nulo (\u0000) e surrogate solto o Postgres recusa (22021/22P05 no text, 22P05 no jsonb) e
  // o erro do driver virava 500. Recusado na entrada, onde é certamente dado da pessoa; o 22021 que vier de outro lugar
  // continua 500 (é falha nossa). Uma regra só (revisão 7): a procura é iterativa, sem reviver recursivo que estoura a pilha.
  if (o.daPessoa && acharTextoMalFormado(corpo) !== null) throw new SyntaxError("texto mal formado no corpo");
  return corpo;
}

/**
 * Corpo binário (ADR-046, upload de anexo): lê até `max` bytes e recusa acima disso sem guardar o
 * resto. Separado de lerCorpo porque o teto de 1 MiB de JSON continua valendo para todas as outras rotas.
 */
export async function lerBruto(req: IncomingMessage, max: number): Promise<Buffer> {
  const pedacos: Buffer[] = [];
  let total = 0;
  for await (const c of req) {
    const buf = c as Buffer;
    total += buf.length;
    if (total > max) throw new RangeError("corpo grande demais");
    pedacos.push(buf);
  }
  return Buffer.concat(pedacos);
}

/**
 * O content-type com que cada mime sai (NOD-323). Só a lista explícita sai com o próprio tipo; o resto vira
 * text/plain (nunca interpretado como página). SVG e HTML não estão na lista e nunca chegam aqui com o próprio tipo.
 */
const SERVIDOS_COMO_SAO = new Set([
  "image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf",
  "video/mp4", "video/quicktime", "video/webm", "audio/mpeg", "audio/mp4", "audio/wav", "audio/ogg", "application/zip",
]);
export function tipoServido(mime: string): string {
  return SERVIDOS_COMO_SAO.has(mime) ? mime : "text/plain; charset=utf-8";
}

export type OpcoesBytes = {
  /** `?baixar=1`: attachment em vez de inline. O zip sai sempre como attachment. */
  baixar?: boolean;
  /** Resposta 206 de um Range: a fatia e o tamanho total. */
  faixa?: { inicio: number; fim: number; total: number };
  /** Vídeo e áudio anunciam Accept-Ranges (o player pede faixas para buscar). */
  aceitaFaixas?: boolean;
};

/** Arquivo da pessoa ou do bot servido de volta: nunca interpretado como página (tudo em sandbox, nosniff). */
export function bytes(res: ServerResponse, mime: string, nome: string, conteudo: Buffer, o: OpcoesBytes = {}): void {
  cabecalhoDeBytes(res, mime, nome, conteudo, o);
  res.end(conteudo);
}

/**
 * Como `bytes`, mas manda o corpo em pedaços e só resolve quando a resposta saiu, o cliente foi embora ou ela ficou
 * `paradoMs` sem andar — aí a derruba (revisões 4 a 6 do #507). O progresso é o `drain` de cada pedaço: com uma escrita
 * só, o Node entrega tudo ao socket de uma vez e nenhum contador anda. A vaga de leitura só volta com o buffer solto.
 */
export function bytesVigiados(res: ServerResponse, mime: string, nome: string, conteudo: Buffer, o: OpcoesBytes & { paradoMs: number; pedacoBytes?: number }): Promise<void> {
  cabecalhoDeBytes(res, mime, nome, conteudo, o);
  return enviarVigiado(res, conteudo, o);
}

/** O corpo em pedaços de `pedacoBytes` (256 KiB); cada `drain` rearma o relógio de `paradoMs` (o último pedaço também precisa sair nessa janela). */
export function enviarVigiado(
  res: Pick<ServerResponse, "write" | "end" | "destroy" | "destroyed" | "writableFinished" | "on" | "once" | "off">,
  conteudo: Buffer,
  o: { paradoMs: number; pedacoBytes?: number },
): Promise<void> {
  const pedaco = o.pedacoBytes ?? 256 * 1024;
  return new Promise((ok) => {
    let i = 0;
    let t: ReturnType<typeof setTimeout> | undefined;
    let acabou = false;
    const fim = () => {
      if (acabou) return;
      acabou = true;
      clearTimeout(t);
      res.off("drain", seguir);
      res.off("finish", fim);
      res.off("close", fim);
      ok();
    };
    const armar = () => {
      clearTimeout(t);
      t = setTimeout(() => { res.destroy(); fim(); }, o.paradoMs);
    };
    function seguir(): void {
      if (acabou) return;
      if (res.destroyed) return fim();
      armar();
      while (i < conteudo.byteLength) {
        const parte = conteudo.subarray(i, i + pedaco);
        i += parte.byteLength;
        if (i >= conteudo.byteLength) { res.end(parte); return; }
        if (!res.write(parte)) return;
      }
      res.end();
    }
    if (res.writableFinished || res.destroyed) return ok();
    res.on("drain", seguir);
    res.once("finish", fim);
    res.once("close", fim);
    seguir();
  });
}

function cabecalhoDeBytes(res: ServerResponse, mime: string, nome: string, conteudo: Buffer, o: OpcoesBytes): void {
  const tipo = tipoServido(mime);
  const anexar = o.baixar || mime === "application/zip";
  res.writeHead(o.faixa ? 206 : 200, {
    "content-type": tipo,
    "content-length": String(conteudo.byteLength),
    "content-disposition": `${anexar ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(nome)}`,
    "x-content-type-options": "nosniff",
    "content-security-policy": "sandbox; default-src 'none'",
    "cache-control": "private, max-age=3600",
    ...(o.aceitaFaixas || o.faixa ? { "accept-ranges": "bytes" } : {}),
    ...(o.faixa ? { "content-range": `bytes ${o.faixa.inicio}-${o.faixa.fim}/${o.faixa.total}` } : {}),
  });
}

/** 416 de um Range fora do arquivo. */
export function faixaInvalida(res: ServerResponse, total: number): void {
  res.writeHead(416, { "content-range": `bytes */${total}`, "cache-control": "no-store" });
  res.end();
}

/**
 * NOD-323: o cabeçalho Range de faixa ÚNICA (`bytes=a-b`, `bytes=a-`, `bytes=-n`). null = sem Range ou de várias faixas
 * (o servidor responde o arquivo inteiro, como manda a RFC 9110); "invalida" = fora do arquivo (416).
 */
export function faixaPedida(range: string | undefined, total: number): { inicio: number; fim: number } | "invalida" | null {
  if (!range) return null;
  if (total <= 0) return "invalida";
  const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!m) return null;
  const [, a = "", b = ""] = m;
  if (a === "" && b === "") return null;
  if (a === "") {
    const n = Number(b);
    if (n === 0) return "invalida";
    const inicio = Math.max(0, total - n);
    return { inicio, fim: Math.min(total - 1, inicio + FATIA_MAX_BYTES - 1) };
  }
  const inicio = Number(a);
  const fim = b === "" ? total - 1 : Math.min(Number(b), total - 1);
  if (!Number.isSafeInteger(inicio) || inicio >= total || fim < inicio) return "invalida";
  // Revisão do #507 (A2): o 1º pedido do <video> é `bytes=0-` (o arquivo inteiro). A fatia vai até FATIA_MAX_BYTES, com o
  // Content-Range real: o navegador pede a seguinte sozinho, e o servidor nunca arrasta 50 MiB (em hex) por pedido.
  return { inicio, fim: Math.min(fim, inicio + FATIA_MAX_BYTES - 1) };
}

/** O teto de uma fatia de Range (NOD-323). */
export const FATIA_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Revisão do #507 (A2): no máximo `max` leituras inteiras de anexo ao mesmo tempo; as outras esperam a vez (fila, não
 * 503: a grade de imagens pede várias de uma vez). Cada uma pode trazer até 50 MiB do banco.
 */
export function criarFila(max: number): <T>(f: () => Promise<T>) => Promise<T> {
  let emCurso = 0;
  const espera: (() => void)[] = [];
  return async (f) => {
    if (emCurso >= max) await new Promise<void>((ok) => espera.push(ok));
    else emCurso++;
    try {
      return await f();
    } finally {
      const proximo = espera.shift();
      if (proximo) proximo();
      else emCurso--;
    }
  };
}

/**
 * Revisão 3 do #507 (alto 1): a fila das leituras inteiras com teto por chave (o tenant) dentro do teto global — um
 * tenant com a grade cheia ou um cliente lento não toma as vagas de todo mundo. Quem foi embora enquanto esperava
 * (`desistiu()`) não lê o banco.
 */
export function criarFilaDeLeitura(o: { max: number; porChave: number }): <T>(chave: string, desistiu: () => boolean, f: () => Promise<T>) => Promise<T | undefined> {
  const global = criarFila(o.max);
  const porChave = new Map<string, { fila: ReturnType<typeof criarFila>; n: number }>();
  return async (chave, desistiu, f) => {
    let e = porChave.get(chave);
    if (!e) {
      e = { fila: criarFila(o.porChave), n: 0 };
      porChave.set(chave, e);
    }
    e.n++;
    try {
      return await e.fila(() => global(async () => (desistiu() ? undefined : f())));
    } finally {
      if (--e.n === 0) porChave.delete(chave);
    }
  };
}

/**
 * Sem um `drain` em 120 s, a resposta de anexo cai (o cliente que não lê). O `drain` só volta quando o kernel libera 1/3
 * do buffer de envio, que cresce até o teto do `tcp_wmem` (4 MiB no padrão do Linux): ~1,33 MiB por janela. Com 120 s,
 * segue quem anda a partir de ~11 KiB/s, com folga de 2x sobre o piso de ~25 KiB/s (revisões 7 e 8 do #507).
 * Troca: quem não lê segura a vaga por até 120 s.
 */
export const RESPOSTA_PARADA_MS = 120_000;

export function lerCookies(req: IncomingMessage): Record<string, string> {
  const saida: Record<string, string> = {};
  for (const par of (req.headers.cookie ?? "").split(";")) {
    const i = par.indexOf("=");
    if (i === -1) continue;
    saida[par.slice(0, i).trim()] = par.slice(i + 1).trim();
  }
  return saida;
}
