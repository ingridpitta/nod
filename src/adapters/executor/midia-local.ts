import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath, type FileHandle } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { LIMITE_POR_FAMILIA, MIDIAS_POR_CHAMADA, type CabecalhoMidia, type MotivoRecusaMidia, type RecusasMidia } from "../../contracts/anexo.ts";
import { caminhoRecusado } from "../../domain/arquivo-do-mac.ts";
import { classificar, DICA_RECUSA, linksLocais, medidasDe, reescreverLinks, segmentoOculto } from "../../domain/midia.ts";
import type { ClienteNod } from "./cliente-nod.ts";

/** A cabeça que basta para farejar o tipo e ler as medidas (PNG/GIF/WebP no começo; JPEG SOF e mp4 moov costumam caber). */
const CABECA = 64 * 1024;

export type ResultadoAnexar = {
  anexados: { nome: string; tipo: string; id: string }[];
  /** O id de cada caminho escrito que entrou (o repetido aponta para o mesmo); a J6 reescreve a fala com isto. */
  idPorCaminho: Map<string, string>;
  recusados: { caminho: string; motivo: MotivoRecusaMidia; dica: string }[];
};

export type OpcoesAnexar = {
  cliente: Pick<ClienteNod, "midia" | "recusasMidia">;
  /** A pasta do bot do plano (relativa a `~/nod`; numa task, `Bot/pasta-da-task`). */
  pastaDoBot: string;
  /** Injetável no teste; default o HOME do processo. */
  home?: string;
  /** Só no teste: roda antes e logo depois do open (a janela da troca de um diretório do meio por symlink). */
  naJanela?: (fase: "antes" | "depois", real: string) => Promise<void>;
  /** NOD-323 J6: o laço cancela (prazo, turno parado); abortado, o envio em curso cai e o resto nem sobe. */
  sinal?: AbortSignal;
  /** Injetável no teste: a espera entre tentativas quando o servidor está ocupado (503). */
  dormir?: (ms: number) => Promise<void>;
  /** Injetáveis no teste: o relógio do prazo total por arquivo e o jitter da espera da rede. */
  agora?: () => number;
  aleatorio?: () => number;
};

type Preparada =
  | { ok: true; real: string; cabecalho: CabecalhoMidia; corpo: Uint8Array; tipo: string }
  | { ok: false; motivo: MotivoRecusaMidia };

/**
 * NOD-323 (ADR-126): `anexar_midia` — a mídia que o bot gerou na PASTA DELE vai para o chat. Decidido aqui, na máquina,
 * contra o plano: só caminho dentro de `~/nod/<raiz da pasta do bot>` (resolvido o symlink, e de novo depois de aberto,
 * com O_NOFOLLOW e o dev/ino do caminho igual ao do arquivo aberto), nunca credencial, só arquivo regular e não vazio. O servidor confere tudo de novo
 * (tipo pelos bytes, sha, caminho, teto). A resposta ao modelo nunca traz o erro do sistema: só código e dica fixa.
 */
export async function anexarMidias(caminhos: unknown, opcoes: OpcoesAnexar): Promise<ResultadoAnexar> {
  const home = opcoes.home ?? homedir();
  const saida: ResultadoAnexar = { anexados: [], recusados: [], idPorCaminho: new Map() };
  const idDoReal = new Map<string, string>();
  const lista = Array.isArray(caminhos) ? caminhos.filter((c): c is string => typeof c === "string" && c.trim() !== "") : [];
  const vistos = new Set<string>();
  for (const [i, escrito] of lista.entries()) {
    const recusar = (motivo: MotivoRecusaMidia) => saida.recusados.push({ caminho: escrito, motivo, dica: DICA_RECUSA[motivo] });
    if (i >= MIDIAS_POR_CHAMADA) {
      recusar("limite_por_turno");
      continue;
    }
    // Cancelado (prazo da J6, turno parado): o resto nem é lido.
    if (opcoes.sinal?.aborted) {
      recusar("falha_envio");
      continue;
    }
    const p = await preparar(escrito, opcoes.pastaDoBot, home, opcoes.naJanela).catch((): Preparada => ({ ok: false, motivo: "falha_envio" }));
    if (!p.ok) {
      recusar(p.motivo);
      continue;
    }
    if (vistos.has(p.real)) {
      const id = idDoReal.get(p.real);
      if (id) saida.idPorCaminho.set(escrito, id);
      continue;
    }
    vistos.add(p.real);
    const r = await enviar(opcoes, p.cabecalho, p.corpo);
    if (r.ok) {
      saida.anexados.push({ nome: p.cabecalho.nome, tipo: p.tipo, id: r.id });
      saida.idPorCaminho.set(escrito, r.id);
      idDoReal.set(p.real, r.id);
    } else recusar(r.motivo);
  }
  const contagem = new Map<MotivoRecusaMidia, number>();
  for (const r of saida.recusados) contagem.set(r.motivo, (contagem.get(r.motivo) ?? 0) + 1);
  const recusas: RecusasMidia = [...contagem].map(([motivo, n]) => ({ motivo, n }));
  if (recusas.length && opcoes.cliente.recusasMidia) await opcoes.cliente.recusasMidia(recusas).catch(() => undefined);
  return saida;
}

function contido(raiz: string, alvo: string): boolean {
  return alvo.startsWith(raiz.endsWith(sep) ? raiz : raiz + sep);
}

async function preparar(escrito: string, pastaDoBot: string, home: string, naJanela?: OpcoesAnexar["naJanela"]): Promise<Preparada> {
  const raizSeg = pastaDoBot.split("/")[0];
  if (!raizSeg || raizSeg === "." || raizSeg === "..") return { ok: false, motivo: "fora_da_pasta" };
  const expandido = escrito === "~" || escrito.startsWith("~/") ? join(home, escrito.slice(1)) : escrito;
  const absoluto = isAbsolute(expandido) ? resolve(expandido) : resolve(join(home, "nod", pastaDoBot), expandido);
  if (caminhoRecusado(escrito) || caminhoRecusado(absoluto)) return { ok: false, motivo: "credencial" };

  let realRaiz: string;
  try {
    realRaiz = await realpath(join(home, "nod", raizSeg));
  } catch {
    return { ok: false, motivo: "fora_da_pasta" };
  }
  let real: string;
  try {
    real = await realpath(absoluto);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (!contido(resolve(join(home, "nod", raizSeg)), absoluto) && !contido(realRaiz, absoluto)) return { ok: false, motivo: "fora_da_pasta" };
    return { ok: false, motivo: code === "ENOENT" || code === "ENOTDIR" ? "nao_existe" : "nao_e_arquivo" };
  }
  if (!contido(realRaiz, real)) return { ok: false, motivo: "fora_da_pasta" };
  if (caminhoRecusado(real)) return { ok: false, motivo: "credencial" };
  // QA 2 do #507: pasta ou arquivo oculto e o que tem cara de env — no caminho escrito e no resolvido, dentro da raiz.
  if ([relative(realRaiz, real), relative(resolve(join(home, "nod", raizSeg)), absoluto)].some((rel) => rel.split(sep).some((x) => x !== ".." && segmentoOculto(x)))) return { ok: false, motivo: "credencial" };

  await naJanela?.("antes", real);
  let fh: FileHandle;
  try {
    // O_NONBLOCK: um FIFO não trava o open; o fstat logo abaixo o recusa.
    fh = await open(real, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch {
    return { ok: false, motivo: "nao_e_arquivo" };
  }
  try {
    await naJanela?.("depois", real);
    const st = await fh.stat();
    if (!st.isFile()) return { ok: false, motivo: "nao_e_arquivo" };
    if (st.size === 0) return { ok: false, motivo: "vazio" };
    // Troca entre o realpath e o open (um diretório do meio virou symlink; o O_NOFOLLOW só cobre o último): depois de
    // aberto, o caminho tem de resolver para ele mesmo E o que está nele (lstat) tem de ser o MESMO arquivo do fd aberto.
    const real2 = await realpath(real).catch(() => null);
    if (real2 !== real) return { ok: false, motivo: "fora_da_pasta" };
    const noCaminho = await lstat(real).catch(() => null);
    if (!noCaminho || noCaminho.dev !== st.dev || noCaminho.ino !== st.ino) return { ok: false, motivo: "fora_da_pasta" };

    const cabeca = await lerAte(fh, Math.min(CABECA, st.size));
    const classe = classificar(cabeca, st.size);
    if (!classe) return { ok: false, motivo: "tipo_nao_suportado" };
    const nome = real.slice(real.lastIndexOf(sep) + 1);
    const caminhoRelativo = [raizSeg, ...relative(realRaiz, real).split(sep)].join("/");
    if (classe.semBytes) {
      // Grande demais para guardar: só o cartão. O sha identifica (cabeça + tamanho) sem ler gigabytes.
      const sha256 = createHash("sha256").update(cabeca).update(String(st.size)).digest("hex");
      return { ok: true, real, tipo: classe.mime, corpo: new Uint8Array(), cabecalho: { nome, caminhoRelativo, sha256, mime: classe.mime, tamanhoReal: st.size, ...medidasDe(classe.mime, cabeca) } };
    }
    const limite = LIMITE_POR_FAMILIA[classe.familia];
    const tudo = await lerAte(fh, Math.min(st.size, limite) + 1);
    if (tudo.byteLength === 0) return { ok: false, motivo: "vazio" };
    // Cresceu depois do fstat: não sobe pela metade.
    if (tudo.byteLength > limite || tudo.byteLength > st.size) return { ok: false, motivo: "falha_envio" };
    const sha256 = createHash("sha256").update(tudo).digest("hex");
    return { ok: true, real, tipo: classe.mime, corpo: tudo, cabecalho: { nome, caminhoRelativo, sha256, mime: classe.mime, ...medidasDe(classe.mime, tudo) } };
  } finally {
    await fh.close().catch(() => undefined);
  }
}

/** Lê do começo do arquivo até `max` bytes pelo fd já aberto (nunca pelo caminho de novo). */
async function lerAte(fh: FileHandle, max: number): Promise<Uint8Array> {
  const buf = Buffer.alloc(max);
  let lido = 0;
  while (lido < max) {
    const { bytesRead } = await fh.read(buf, lido, max - lido, lido);
    if (bytesRead === 0) break;
    lido += bytesRead;
  }
  return new Uint8Array(buf.buffer, buf.byteOffset, lido);
}

/** NOD-323 (revisão 2, M2): o servidor ocupado (503) pede para esperar; até 4 tentativas, cada uma depois do retry-after. */
export const TENTATIVAS_ENVIO_MIDIA = 4;
const ESPERA_OCUPADO_MS = 2_000;
const ESPERA_REDE_MS = 1_000;
/** Prazo total por arquivo, somadas as tentativas: passou, não tenta de novo. */
export const PRAZO_ENVIO_MIDIA_MS = 120_000;
const dormirPadrao = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));

async function enviar(opcoes: OpcoesAnexar, cabecalho: CabecalhoMidia, corpo: Uint8Array): Promise<{ ok: true; id: string } | { ok: false; motivo: MotivoRecusaMidia }> {
  const { cliente, sinal } = opcoes;
  if (!cliente.midia) return { ok: false, motivo: "falha_envio" };
  const dormir = opcoes.dormir ?? dormirPadrao;
  const agora = opcoes.agora ?? Date.now;
  const aleatorio = opcoes.aleatorio ?? Math.random;
  const inicio = agora();
  for (let tentativa = 0; tentativa < TENTATIVAS_ENVIO_MIDIA; tentativa++) {
    if (sinal?.aborted) return { ok: false, motivo: "falha_envio" };
    if (tentativa > 0 && agora() - inicio > PRAZO_ENVIO_MIDIA_MS) break;
    const r = await cliente.midia(cabecalho, corpo, sinal);
    if ("transporte" in r) {
      // Revisão 3 do #507 (M5): a rede caiu — espera crescente com jitter antes de tentar de novo (0,5 s, 1 s, 2 s…).
      if (tentativa < TENTATIVAS_ENVIO_MIDIA - 1 && !sinal?.aborted) await dormir(Math.round(ESPERA_REDE_MS * 2 ** tentativa * (0.5 + aleatorio() / 2)));
      continue;
    }
    if (r.status === 503) {
      if (tentativa < TENTATIVAS_ENVIO_MIDIA - 1) await dormir(Math.min(10_000, Math.max(500, (r.retryAposS ?? 0) * 1000 || ESPERA_OCUPADO_MS)));
      continue;
    }
    if (r.status === 200 || r.status === 201) {
      const id = (r.json as { id?: unknown } | null)?.id;
      return typeof id === "string" ? { ok: true, id } : { ok: false, motivo: "falha_envio" };
    }
    if (r.status === 415) return { ok: false, motivo: "tipo_nao_suportado" };
    if (r.status === 429) return { ok: false, motivo: "limite_por_turno" };
    return { ok: false, motivo: "falha_envio" };
  }
  return { ok: false, motivo: "falha_envio" };
}

/** O texto que o modelo recebe. isError só quando nada entrou. */
export function respostaAnexar(r: ResultadoAnexar): { texto: string; isError: boolean } {
  const anexados = r.anexados.map(({ nome, tipo }) => ({ nome, tipo }));
  return { texto: JSON.stringify({ anexados, recusados: r.recusados }), isError: r.anexados.length === 0 };
}

/**
 * NOD-323 J6 (rede de segurança): o bot escreveu `![alt](caminho)` ou `[texto](caminho)` para um arquivo da pasta dele
 * em vez de chamar anexar_midia. No fim do turno, antes da entrega, o laço da máquina (onde está o arquivo) anexa esses
 * caminhos pelas MESMAS regras e reescreve a fala: a imagem sai do texto, o link vira `nod-anexo:<id>`. Fora de código.
 */
export async function anexarLinksDaFala(texto: string, opcoes: OpcoesAnexar): Promise<string> {
  const links = linksLocais(texto);
  if (links.length === 0) return texto;
  const caminhos = [...new Set(links.map((l) => l.caminho))].slice(0, MIDIAS_POR_CHAMADA);
  const r = await anexarMidias(caminhos, opcoes);
  return reescreverLinks(texto, links, (c) => r.idPorCaminho.get(c) ?? null);
}
