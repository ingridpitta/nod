import { createHash, type Hash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * definido em 2026-10-22 (NOD-93, PR 3, ADR-123): o download do disco da VM local (~1 GB) para
 * `<userData>/vm/cache`, retomável. A parte fica em `<destino>.parte`; com parte no disco, pede `Range: bytes=N-`:
 *   206 com Content-Range começando em N  → continua dali;
 *   200 (servidor/CDN sem Range)          → recomeça do zero, por cima da parte;
 *   416                                   → a parte já está inteira (ou passou do fim): confere o sha256.
 * No fim, o sha256 do arquivo inteiro (parte antiga + o que chegou) decide: confere, vira `<destino>`; não confere,
 * a parte é apagada e o resultado é `sha_ruim` (quem baixa de novo, uma vez, é o preparo: src/domain/preparo-vm-local.ts).
 *
 * O resultado é o evento do preparo, nunca exceção: `sem_internet` (fetch falhou, corpo cortado, 5xx, 408, 429) é
 * passageiro e entra no backoff; `falhou` (4xx, disco cheio) não volta sozinho.
 */

export type ResultadoDownload =
  | { tipo: "baixou"; bytes: number; retomou: boolean }
  | { tipo: "sha_ruim"; veio: string }
  | { tipo: "sem_internet"; motivo: string }
  | { tipo: "falhou"; motivo: string };

export type Progresso = { recebidos: number; total: number | null };

export type PedidoDownload = {
  url: string;
  destino: string;
  sha256: string;
  fetch?: typeof fetch;
  aoProgresso?: (p: Progresso) => void;
  sinal?: AbortSignal;
};

/** O cache do disco (plano da NOD-93): `<userData>/vm/cache`, no Mac `~/Library/Application Support/nod/vm/cache`. */
export function pastaDoCache(userData: string): string {
  return join(userData, "vm", "cache");
}

export function caminhoDaParte(destino: string): string {
  return `${destino}.parte`;
}

/** `nod-vm-<versão>-<arch>.img.zst`, o nome que o release publica (infra/vm-local/construir-disco.sh). */
export function nomeDoDisco(versao: string, arch: "arm64" | "amd64"): string {
  return `nod-vm-${versao}-${arch}.img.zst`;
}

/** Lê o `<hash>  <nome>` do .sha256 publicado ao lado do disco. Só aceita a linha do arquivo pedido. */
export function lerSha256(texto: string, nome: string): string | null {
  for (const linha of texto.split("\n")) {
    const m = /^([0-9a-f]{64})\s+\*?(\S+)\s*$/.exec(linha.trim());
    if (m && m[2] === nome) return m[1]!;
  }
  return null;
}

/** O início de `Content-Range: bytes 100-999/1000` e o total; null se não dá para ler. */
export function lerContentRange(valor: string | null): { inicio: number; total: number | null } | null {
  const m = /^bytes (\d+)-\d+\/(\d+|\*)$/.exec(valor?.trim() ?? "");
  if (!m) return null;
  return { inicio: Number(m[1]), total: m[2] === "*" ? null : Number(m[2]) };
}

function mensagem(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** HTTP que passa sozinho (5xx, 408, 429): entra no backoff. Os outros 4xx são terminais (`falhou`, com o motivo). */
export function passageiro(status: number): boolean {
  return status >= 500 || status === 408 || status === 429;
}

async function tamanho(caminho: string): Promise<number> {
  try { return (await stat(caminho)).size; } catch { return 0; }
}

async function hashDoArquivo(caminho: string, hash: Hash = createHash("sha256")): Promise<Hash> {
  for await (const pedaco of createReadStream(caminho)) hash.update(pedaco as Buffer);
  return hash;
}

/** O disco já está no cache e confere? (o preparo começa em `preparando` sem baixar nada) */
export async function discoNoCache(destino: string, sha256: string): Promise<boolean> {
  if ((await tamanho(destino)) === 0) return false;
  return (await hashDoArquivo(destino)).digest("hex") === sha256;
}

async function concluir(parte: string, destino: string, hash: Hash, sha256: string, bytes: number, retomou: boolean): Promise<ResultadoDownload> {
  const veio = hash.digest("hex");
  if (veio !== sha256) {
    await rm(parte, { force: true });
    return { tipo: "sha_ruim", veio };
  }
  try {
    await rename(parte, destino);
  } catch (e) {
    // Destino ocupado (uma pasta no lugar, permissão): a parte confere e fica para a próxima; nunca exceção.
    return { tipo: "falhou", motivo: `não deu para pôr o disco em ${destino}: ${mensagem(e)}` };
  }
  return { tipo: "baixou", bytes, retomou };
}

export async function baixarDisco(p: PedidoDownload): Promise<ResultadoDownload> {
  const buscar = p.fetch ?? fetch;
  const parte = caminhoDaParte(p.destino);
  try {
    await mkdir(dirname(p.destino), { recursive: true });
  } catch (e) {
    return { tipo: "falhou", motivo: `não deu para criar ${dirname(p.destino)}: ${mensagem(e)}` };
  }
  const jaTem = await tamanho(parte);

  let resposta: Response;
  try {
    resposta = await buscar(p.url, { headers: jaTem > 0 ? { Range: `bytes=${jaTem}-` } : {}, redirect: "follow", ...(p.sinal ? { signal: p.sinal } : {}) });
  } catch (e) {
    return { tipo: "sem_internet", motivo: mensagem(e) };
  }

  if (resposta.status === 416 && jaTem > 0) {
    await resposta.body?.cancel();
    let hashDaParte: Hash;
    try {
      hashDaParte = await hashDoArquivo(parte);
    } catch (e) {
      return { tipo: "falhou", motivo: `não deu para ler ${parte}: ${mensagem(e)}` };
    }
    return concluir(parte, p.destino, hashDaParte, p.sha256, jaTem, true);
  }
  if (resposta.status !== 200 && resposta.status !== 206) {
    await resposta.body?.cancel();
    const motivo = `o servidor respondeu ${resposta.status} para ${p.url}`;
    return passageiro(resposta.status) ? { tipo: "sem_internet", motivo } : { tipo: "falhou", motivo };
  }

  let inicio = 0;
  let total: number | null = null;
  if (resposta.status === 206) {
    const faixa = lerContentRange(resposta.headers.get("content-range"));
    if (!faixa || faixa.inicio !== jaTem) {
      // Faixa que não começa onde a parte parou: não dá para emendar. Apaga e recomeça na próxima tentativa.
      await resposta.body?.cancel();
      await rm(parte, { force: true });
      return { tipo: "sem_internet", motivo: `faixa inesperada (${resposta.headers.get("content-range") ?? "sem Content-Range"}) para a parte de ${jaTem} bytes` };
    }
    inicio = jaTem;
    total = faixa.total;
  } else {
    const comprimento = Number(resposta.headers.get("content-length"));
    total = Number.isFinite(comprimento) && comprimento > 0 ? comprimento : null;
  }

  const hash = inicio > 0 ? await hashDoArquivo(parte) : createHash("sha256");
  let recebidos = inicio;
  let arquivo;
  try {
    arquivo = await open(parte, inicio > 0 ? "a" : "w");
  } catch (e) {
    await resposta.body?.cancel();
    return { tipo: "falhou", motivo: `não deu para gravar ${parte}: ${mensagem(e)}` };
  }
  try {
    if (!resposta.body) return { tipo: "sem_internet", motivo: "resposta sem corpo" };
    const leitor = resposta.body.getReader();
    for (;;) {
      const { done, value: pedaco } = await leitor.read();
      if (done) break;
      try {
        await arquivo.write(pedaco);
      } catch (e) {
        return { tipo: "falhou", motivo: `não deu para gravar ${parte}: ${mensagem(e)}` };
      }
      hash.update(pedaco);
      recebidos += pedaco.byteLength;
      p.aoProgresso?.({ recebidos, total });
    }
  } catch (e) {
    // Corpo cortado (rede caiu no meio, ou o sinal abortou): o que chegou fica na parte para a próxima.
    return { tipo: "sem_internet", motivo: mensagem(e) };
  } finally {
    await arquivo.close();
  }
  if (total !== null && recebidos < total) return { tipo: "sem_internet", motivo: `o corpo parou em ${recebidos} de ${total} bytes` };
  return concluir(parte, p.destino, hash, p.sha256, recebidos, inicio > 0);
}
