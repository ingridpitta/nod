import type { AcaoNoArquivo, ArquivoDoCheckpoint, CheckpointDaFala, DesfechoArquivo, EstadoCheckpoint, FalhaDesfazer, ResultadoDesfazer, ResultadoGuardado, ResumoCheckpoint } from "../contracts/checkpoint.ts";
import { DESFECHOS_ARQUIVO, TETO_ARQUIVOS_DO_CHECKPOINT } from "../contracts/checkpoint.ts";
import { FORA_DO_GUARDADO } from "./guardado.ts";

/**
 * definido em 2026-10-28 (NOD-54, ADR-134): as regras puras dos checkpoints de arquivos por turno. A máquina fotografa a
 * pasta do turno antes e depois (git sombra, adapters/executor/checkpoints.ts); aqui moram o que fica de fora, o que
 * mudou, o que o desfazer faz com cada arquivo e o que vence.
 */

/** Arquivo acima disto fica fora do git sombra (critério da issue). */
export const MAX_BYTES_NO_CHECKPOINT = 20 * 1024 ** 2;
/** A foto (ou o hook) acima disto: o turno segue sem checkpoint e o "Desfazer" não aparece. */
export const PRAZO_FOTO_MS = 5_000;
/** O hook guarda o original de um arquivo fora da pasta em até isto (o prazo do hook do Codex é maior; sobra folga). */
export const PRAZO_GUARDA_MS = 2_000;
/** Retenção por bot: os 20 checkpoints mais novos, de até 7 dias; o git sombra passa de 2 GB, sai a metade mais velha. */
export const RETEM_CHECKPOINTS = 20;
export const RETEM_MS = 7 * 24 * 3_600_000;
export const TETO_SOMBRA_BYTES = 2 * 1024 ** 3;
/** A gravação de uma nativa num arquivo que está voltando espera até isto (decisão 8 do protótipo: menos de 1 s). */
export const ESPERA_DESFAZER_MS = 900;
/**
 * O desfazer que ficou `desfazendo` mais do que isto (a máquina foi revogada, trocada ou nunca voltou) vira `falhou` no
 * próximo pedido do bot: o "um por bot" não prende o bot para sempre, e a pessoa pode tentar de novo.
 */
export const PRAZO_DESFAZENDO_MS = 15 * 60_000;

/**
 * Um arquivo na foto: modo e blob do git, ou `marca` quando ele existe mas ficou fora (grande demais, nome com quebra de
 * linha, sem leitura). Arquivo marcado nunca conta como criado nem apagado: sem isso, um arquivo que passou de 20 MB no
 * turno pareceria apagado e o desfazer o trocaria pela versão velha.
 */
export type EntradaDaFoto = { modo: "100644" | "100755"; blob: string } | { marca: "fora" };
export type Foto = ReadonlyMap<string, EntradaDaFoto>;

const PADROES_FORA = FORA_DO_GUARDADO.map((p) => (p.endsWith("*") ? { prefixo: p.slice(0, -1) } : { nome: p }));

/** O nome (de pasta ou arquivo) que a foto pula em qualquer nível: o `.git` de quem for, dependências e caches. */
export function foraDoCheckpoint(nome: string): boolean {
  // O temporário do próprio desfazer (gravação atômica) nunca entra na foto de um turno (revisão 3, B6).
  if (nome === ".git" || nome.startsWith(".nod-desfazer-")) return true;
  return PADROES_FORA.some((p) => ("nome" in p ? p.nome === nome : nome.startsWith(p.prefixo)));
}

/**
 * Na conversa principal a pasta do turno é a raiz do bot (`~/nod/<bot>`), e as frentes moram nas subpastas dela
 * (`<slug>-<6 hex>`, slugDoTrabalho). Cada frente tem o seu turno e o seu checkpoint: a foto do dono não as inclui, senão
 * o desfazer do dono voltaria o trabalho de uma frente que rodou junto.
 */
export function ehPastaDeFrente(nome: string): boolean {
  return /-[0-9a-f]{6}$/.test(nome);
}

const iguais = (a: EntradaDaFoto | undefined, b: EntradaDaFoto | undefined): boolean =>
  a === undefined || b === undefined ? a === b : "marca" in a || "marca" in b ? true : a.blob === b.blob && a.modo === b.modo;

/** O que mudou entre as duas fotos, por chave (o caminho relativo à casa), em ordem. A entrada marcada não conta. */
export function diferencas(antes: Foto, depois: Foto): { chave: string; acao: AcaoNoArquivo }[] {
  const chaves = new Set([...antes.keys(), ...depois.keys()]);
  const r: { chave: string; acao: AcaoNoArquivo }[] = [];
  for (const chave of [...chaves].sort()) {
    const a = antes.get(chave);
    const d = depois.get(chave);
    if ((a && "marca" in a) || (d && "marca" in d) || iguais(a, d)) continue;
    r.push({ chave, acao: a === undefined ? "criado" : d === undefined ? "apagado" : "mudado" });
  }
  return r;
}

/** O caminho como a tela mostra: `~/` mais a chave. */
/**
 * A ordem em que o desfazer passa (revisão 11, A1): os criados primeiro. No disco que não distingue maiúsculas (o do Mac),
 * `Notes.md` -> `notes.md` é o mesmo arquivo; voltar o apagado antes faria o criado, igual ao "depois", apagá-lo.
 */
export function ordemDoDesfazer<T extends { acao: AcaoNoArquivo }>(difs: readonly T[]): T[] {
  return [...difs.filter((d) => d.acao === "criado"), ...difs.filter((d) => d.acao !== "criado")];
}

export const caminhoNaTela = (chave: string): string => `~/${chave}`;

/** O resumo que viaja na entrega: a lista com teto e o total real. Nada mudou: null (o turno não ganha o item). */
export function resumoDoCheckpoint(difs: readonly { chave: string; acao: AcaoNoArquivo }[]): ResumoCheckpoint | null {
  if (difs.length === 0) return null;
  // O nome que o servidor recusaria vai como marcador: senão um arquivo com tab no nome tirava o "Desfazer" do turno inteiro.
  const arquivos: ArquivoDoCheckpoint[] = difs.slice(0, TETO_ARQUIVOS_DO_CHECKPOINT).map((d) => ({ caminho: caminhoParaRelato(caminhoNaTela(d.chave)), acao: d.acao }));
  return { arquivos, total: difs.length };
}

/**
 * O que o desfazer faz com UM arquivo, pelo blob de antes do turno, o de depois dele e o de agora (`null` = não existe).
 * - agora = depois: ninguém mexeu desde o turno → `restaurar` (volta ao antes, ou apaga o criado);
 * - agora = antes: já voltou (um desfazer que caiu no meio e foi refeito) → `ja_esta`;
 * - a pessoa mandou voltar este (conflito anterior) → `restaurar`;
 * - os três existem → `mesclar` (3 vias: a base é o depois; sai a parte deste turno, fica a de quem mexeu depois);
 * - senão (criado e depois mudado, apagado e recriado…) → `conflito`: fica como está.
 */
export type DecisaoDoArquivo = "restaurar" | "ja_esta" | "mesclar" | "conflito";
export function decidirArquivo(p: { antes: string | null; depois: string | null; agora: string | null; forcar: boolean }): DecisaoDoArquivo {
  if (p.agora === p.depois) return "restaurar";
  if (p.agora === p.antes) return "ja_esta";
  if (p.forcar) return "restaurar";
  if (p.antes !== null && p.depois !== null && p.agora !== null) return "mesclar";
  return "conflito";
}

/** Os checkpoints que vencem: fora dos 20 mais novos ou com mais de 7 dias. `em` é a hora da foto (epoch ms). */
export function checkpointsVencidos(lista: readonly { id: string; em: number }[], agora: number, retem = RETEM_CHECKPOINTS): string[] {
  const ordem = [...lista].sort((a, b) => b.em - a.em || (a.id < b.id ? 1 : -1));
  return ordem.filter((c, i) => i >= retem || agora - c.em > RETEM_MS).map((c) => c.id);
}

/** O caminho que viaja: `~/`, sem `..`, sem controle, com teto. Recusa o resto (o servidor nunca grava caminho torto). */
export function caminhoValido(v: unknown): v is string {
  return typeof v === "string" && v.length > 2 && v.length <= 1024 && v.startsWith("~/") && ![...v].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f) && !v.split("/").includes("..");
}

/** O caminho que a máquina relata: o que o servidor recusaria (nome com controle, longo demais) vai como um marcador. */
export const CAMINHO_ILEGIVEL = "~/(nome ilegível)";
export const caminhoParaRelato = (c: string): string => (caminhoValido(c) ? c : CAMINHO_ILEGIVEL);

const ACOES: readonly AcaoNoArquivo[] = ["criado", "mudado", "apagado"];

/** O resumo da entrega, conferido. É extra (como o uso do plano): fora do formato some e a entrega segue sem "Desfazer". */
export function resumoCheckpointValido(v: unknown): ResumoCheckpoint | undefined {
  if (typeof v !== "object" || v === null) return undefined;
  const r = v as { arquivos?: unknown; total?: unknown };
  if (!Array.isArray(r.arquivos) || r.arquivos.length === 0 || r.arquivos.length > TETO_ARQUIVOS_DO_CHECKPOINT) return undefined;
  if (!Number.isSafeInteger(r.total) || Number(r.total) < r.arquivos.length || Number(r.total) > 1_000_000) return undefined;
  const arquivos: ArquivoDoCheckpoint[] = [];
  for (const a of r.arquivos as unknown[]) {
    const x = (typeof a === "object" && a !== null ? a : {}) as { caminho?: unknown; acao?: unknown };
    if (!caminhoValido(x.caminho) || !ACOES.includes(x.acao as AcaoNoArquivo)) return undefined;
    arquivos.push({ caminho: x.caminho, acao: x.acao as AcaoNoArquivo });
  }
  return { arquivos, total: Number(r.total) };
}

const ORDEM_DESFECHO: Record<DesfechoArquivo, number> = { conflito: 0, erro: 1, mesclado: 2, voltou: 3 };

/** O que o servidor guarda do resultado: os que pedem atenção primeiro, com teto, e a contagem real. */
export function resultadoParaGuardar(r: ResultadoDesfazer): ResultadoGuardado {
  const contagem = Object.fromEntries(DESFECHOS_ARQUIVO.map((d) => [d, 0])) as Record<DesfechoArquivo, number>;
  for (const a of r.arquivos) contagem[a.desfecho] += 1;
  const arquivos = [...r.arquivos].sort((a, b) => ORDEM_DESFECHO[a.desfecho] - ORDEM_DESFECHO[b.desfecho]).slice(0, TETO_ARQUIVOS_DO_CHECKPOINT);
  return { arquivos, contagem };
}

/**
 * "Voltar mesmo assim" passa só nos caminhos em conflito (revisão 11, M2): o resultado novo troca o desfecho deles no
 * anterior, e o resto (o que já voltou, o que a pessoa mexeu depois) fica como a primeira passada disse.
 */
export function juntarForcado(anterior: ResultadoGuardado, novo: ResultadoGuardado): ResultadoGuardado {
  const novos = new Map(novo.arquivos.map((a) => [a.caminho, a]));
  const contagem = { ...anterior.contagem };
  const arquivos = anterior.arquivos.map((a) => {
    const n = novos.get(a.caminho);
    if (!n) return a;
    contagem[a.desfecho] -= 1;
    contagem[n.desfecho] += 1;
    return n;
  });
  return { arquivos: arquivos.sort((a, b) => ORDEM_DESFECHO[a.desfecho] - ORDEM_DESFECHO[b.desfecho]), contagem };
}

/**
 * A linha que o bot lê no próximo turno depois do desfazer (o critério "o bot sabe que foi desfeito"). Diz o que voltou e o
 * que ficou como estava, para ele não refazer nem contar com o que sumiu. Os caminhos em conflito vão nomeados (até 5).
 */
export function textoDoDesfeito(r: ResultadoGuardado): string {
  const c = r.contagem;
  const voltaram = c.voltou + c.mesclado;
  const n = (k: number, um: string, varios: string) => `${k} ${k === 1 ? um : varios}`;
  const partes = [`Desfeito pela pessoa: ${n(voltaram, "arquivo voltou", "arquivos voltaram")} ao que eram antes do seu turno.`];
  if (c.mesclado > 0) partes.push(`${n(c.mesclado, "arquivo foi mesclado", "arquivos foram mesclados")}: a parte que mudou depois ficou.`);
  const ficaram = r.arquivos.filter((a) => a.desfecho === "conflito" || a.desfecho === "erro").slice(0, 5).map((a) => a.caminho);
  if (c.conflito + c.erro > 0) partes.push(`${n(c.conflito + c.erro, "ficou", "ficaram")} como estava${c.conflito + c.erro === 1 ? "" : "m"}: ${ficaram.join(", ")}${c.conflito + c.erro > ficaram.length ? " e outros" : ""}.`);
  partes.push("Commit e push não voltam.");
  return partes.join(" ");
}

/** O que a web lê junto da fala (só os campos da tela; o vencido some do menu). */
export function checkpointDaFala(c: { estado: EstadoCheckpoint; arquivos: ArquivoDoCheckpoint[]; total: number; feitos: number; desfeitoEm: number | null; resultado: ResultadoGuardado | null; falha: FalhaDesfazer | null }): CheckpointDaFala {
  return {
    estado: c.estado,
    arquivos: c.arquivos,
    total: c.total,
    ...(c.estado === "desfazendo" ? { feitos: c.feitos } : {}),
    ...(c.desfeitoEm !== null ? { desfeitoEm: c.desfeitoEm } : {}),
    ...(c.resultado ? { resultado: c.resultado } : {}),
    ...(c.falha ? { falha: c.falha } : {}),
  };
}
