import type { AnexoMeta } from "../contracts/anexo.ts";
import type { PaginaDaBiblioteca } from "../contracts/biblioteca.ts";
import { codificarCursor, type CursorBiblioteca } from "../domain/biblioteca.ts";
import { ehMimeAnexo, nomeSeguro, recusaDoArquivo } from "../domain/anexo.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import type { AnexoGuardado } from "../repositories/anexos.repo.ts";
import type { CasoDeUso } from "./tipos.ts";

export type EntradaReceberAnexo = { conversaId: string; nome: string; mime: string; conteudo: Uint8Array };

/**
 * Upload (ADR-046): o arquivo nasce SOLTO na conversa e só vira parte de uma mensagem no envio. Tipo e
 * tamanho são conferidos aqui e de novo pelos CHECKs da 0023 — o navegador valida antes só por
 * conforto. Conversa que a pessoa não enxerga é nao_encontrado (RLS), como em qualquer rota.
 */
export const receberAnexo: CasoDeUso<EntradaReceberAnexo, AnexoMeta> = async (deps, input) => {
  const mime = input.mime.split(";")[0]?.trim().toLowerCase() ?? "";
  const recusa = recusaDoArquivo(mime, input.conteudo.byteLength);
  if (recusa || !ehMimeAnexo(mime)) throw new ErroDeDominio("entrada_invalida", { cause: `anexo: ${recusa ?? "tipo"}` });
  const conversa = await deps.repos.conversas.buscar(input.conversaId);
  if (!conversa) throw new ErroDeDominio("nao_encontrado", { cause: "conversa" });
  const a = await deps.repos.anexos.criar({ conversaId: conversa.id, nome: nomeSeguro(input.nome), mime, conteudo: input.conteudo });
  if (!a) throw new ErroDeDominio("nao_permitido");
  return { data: { id: a.id, nome: a.nome, mime: a.mime, tamanho: a.tamanho } };
};

/** Bytes para a tela (miniatura, abrir o PDF). Só de anexo desta conversa: o id sozinho não basta. */
export const lerAnexo: CasoDeUso<{ conversaId: string; anexoId: string }, { meta: AnexoGuardado; bytes: Buffer }> = async (deps, input) => {
  const r = await deps.repos.anexos.conteudo(input.anexoId);
  // NOD-323: a mídia do bot "sem bytes" (passou do limite) ficou na máquina; não há o que servir.
  if (!r || r.meta.conversaId !== input.conversaId || r.meta.semBytes) throw new ErroDeDominio("nao_encontrado", { cause: "anexo" });
  return { data: r };
};

/** NOD-323 (J5): onde está a mídia do bot, para o app do Mac daquela máquina mostrar no Finder. Nunca o caminho absoluto. */
export const localDaMidia: CasoDeUso<{ conversaId: string; anexoId: string }, { caminhoRelativo: string; maquinaId: string }> = async (deps, input) => {
  const r = await deps.repos.anexos.localDoBot(input.anexoId);
  if (!r || r.conversaId !== input.conversaId) throw new ErroDeDominio("nao_encontrado", { cause: "anexo" });
  return { data: { caminhoRelativo: r.caminhoRelativo, maquinaId: r.machineId } };
};

export type FaixaDoAnexo = { meta: AnexoGuardado; bytes: Buffer; faixa: { inicio: number; fim: number; total: number } };

/**
 * NOD-323: uma fatia dos bytes (o Range que o player de vídeo e áudio pede para buscar). `faixa` recebe o tamanho total
 * e devolve a fatia pedida, "invalida" (416) ou null (sem Range: o arquivo inteiro, como `lerAnexo`).
 */
export const lerFaixaDoAnexo: CasoDeUso<
  { conversaId: string; anexoId: string; faixa: (total: number) => { inicio: number; fim: number } | "invalida" | null },
  FaixaDoAnexo | { invalida: number } | null
> = async (deps, input) => {
  const meta = await deps.repos.anexos.buscar(input.anexoId);
  if (!meta || meta.conversaId !== input.conversaId || meta.semBytes) throw new ErroDeDominio("nao_encontrado", { cause: "anexo" });
  const f = input.faixa(meta.tamanho);
  if (f === null) return { data: null };
  if (f === "invalida") return { data: { invalida: meta.tamanho } };
  const pedaco = await deps.repos.anexos.faixa(meta.id, f.inicio, f.fim);
  if (!pedaco) throw new ErroDeDominio("nao_encontrado", { cause: "anexo" });
  return { data: { meta, bytes: pedaco, faixa: { ...f, total: meta.tamanho } } };
};

/**
 * NOD-326: a Biblioteca da gaveta do bot. Conversa que a pessoa não enxerga (outra pessoa, outro tenant) é nao_encontrado
 * pela RLS, como em qualquer rota; o repo ainda filtra pela conversa, então nunca sai anexo de outra.
 */
export const lerBiblioteca: CasoDeUso<{ conversaId: string; antes: CursorBiblioteca | null; limite: number }, PaginaDaBiblioteca> = async (deps, input) => {
  const conversa = await deps.repos.conversas.buscar(input.conversaId);
  if (!conversa) throw new ErroDeDominio("nao_encontrado", { cause: "conversa" });
  const r = await deps.repos.anexos.daBiblioteca(conversa.id, input.antes, input.limite);
  return { data: { itens: r.itens, proximo: r.temMais && r.ultimo ? codificarCursor(r.ultimo) : null } };
};
