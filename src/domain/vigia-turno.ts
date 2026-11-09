import type { VigiaVivo } from "../contracts/ponte.ts";
import type { EventoStream } from "../contracts/turno.ts";

/**
 * Vigia do turno (definido em 2026-10-05, NOD-73; emenda à ADR-067). Observa o turno vivo e AVISA quando ele parece
 * preso — nunca corta: o Parar segue sendo o único jeito de encerrar. Dois avisos:
 *  - **sem novidade:** 10 min sem nenhum evento interpretado do CLI. Sobe de nível em 10, 20, 40… min (não repete a
 *    cada minuto) e some com o próximo evento. A espera de aprovação (≤ TETO_HOOK_S, 450 s) fica abaixo do limiar.
 *  - **repetição:** a mesma chamada (nome + argumentos) 5, 10 e 20 vezes no turno, com até 256 chaves (LRU).
 * O aviso leva só nome e números (VigiaVivo): os argumentos viram uma impressão aqui e nunca saem do Mac.
 * Puro: quem tem relógio e timer é o laço (src/adapters/executor/laco.ts).
 */
export type { VigiaVivo };

export const SILENCIO_MS = 10 * 60_000;
export const LIMIARES_REPETICAO = [5, 10, 20] as const;
export const TETO_CHAVES_REPETICAO = 256;
/** De quanto em quanto o laço pergunta ao vigia (o aviso de silêncio tem resolução de 1 min). */
export const AVALIACAO_VIGIA_MS = 60_000;

export type VigiaTurno = {
  /**
   * Um evento do CLI. Devolve o aviso que sai já: um limiar de repetição atingido, ou o fim de um silêncio que já
   * tinha sido avisado (mudoMs 0). null quando a tela não precisa saber.
   */
  registrar(ev: EventoStream, agora: number): VigiaVivo | null;
  /** A batida periódica: devolve o aviso só quando o silêncio sobe de nível. */
  avaliar(agora: number): VigiaVivo | null;
};

/** 0 abaixo de 10 min; 1 a partir de 10, 2 a partir de 20, 3 a partir de 40… */
export function nivelDoSilencio(mudoMs: number): number {
  if (mudoMs < SILENCIO_MS) return 0;
  return Math.floor(Math.log2(mudoMs / SILENCIO_MS)) + 1;
}

function semArgumentos(input: unknown): boolean {
  if (input === undefined || input === null || input === "") return true;
  return typeof input === "object" && !Array.isArray(input) && Object.keys(input).length === 0;
}

/** JSON com as chaves em ordem e o espaço dos textos normalizado: a mesma chamada dá sempre o mesmo texto. */
function estavel(v: unknown): string {
  if (typeof v === "string") return JSON.stringify(v.replace(/\s+/g, " ").trim());
  if (Array.isArray(v)) return `[${v.map(estavel).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${estavel(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

/** FNV-1a de 32 bits, duas vezes com sementes diferentes: a chave guarda a impressão, nunca o argumento. */
function impressao(texto: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ texto.length;
  for (let i = 0; i < texto.length; i++) {
    const c = texto.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
  }
  return `${a.toString(36)}.${b.toString(36)}.${texto.length.toString(36)}`;
}

/** A chave de repetição de uma chamada; null quando ela não tem argumentos (não conta). */
export function chaveDaChamada(nome: string, input: unknown): string | null {
  if (!nome || semArgumentos(input)) return null;
  return `${nome}\u0000${impressao(estavel(input))}`;
}

export function criarVigiaTurno(inicio: number): VigiaTurno {
  let ultimoEvento = inicio;
  let nivelAvisado = 0;
  /** tool_use sem tool_result, na ordem em que abriram (a mais recente é a que a tela mostra). */
  const abertas = new Map<string, string>();
  const emFundo = new Set<string>();
  /** LRU: a ordem de inserção do Map é a de uso; a menos recente sai primeiro. */
  const contagens = new Map<string, { nome: string; vezes: number }>();
  let repeticao: { nome: string; vezes: number } | null = null;

  const aviso = (mudoMs: number): VigiaVivo => {
    const aberta = [...abertas.values()].at(-1);
    return { mudoMs, ...(aberta ? { aberta } : {}), emFundo: emFundo.size, ...(repeticao ? { repeticao: { ...repeticao } } : {}) };
  };

  return {
    registrar(ev, agora) {
      if (ev.tipo === "ignorado") return null;
      ultimoEvento = agora;
      const saiuDoSilencio = nivelAvisado > 0;
      nivelAvisado = 0;
      let repetiu = false;
      if (ev.tipo === "tool_use") {
        abertas.set(ev.id, ev.nome);
        const chave = chaveDaChamada(ev.nome, ev.input);
        if (chave) {
          const vezes = (contagens.get(chave)?.vezes ?? 0) + 1;
          contagens.delete(chave);
          contagens.set(chave, { nome: ev.nome, vezes });
          if (contagens.size > TETO_CHAVES_REPETICAO) contagens.delete(contagens.keys().next().value!);
          if ((LIMIARES_REPETICAO as readonly number[]).includes(vezes) && vezes >= (repeticao?.vezes ?? 0)) {
            repeticao = { nome: ev.nome, vezes };
            repetiu = true;
          }
        }
      } else if (ev.tipo === "tool_result") {
        abertas.delete(ev.toolUseId);
      } else if (ev.tipo === "tarefa_fundo") {
        // NOD-350: o subagente em primeiro plano não segura a sessão viva (e fica fora da lista da task).
        if (ev.estado === "terminada") emFundo.delete(ev.id);
        else if (ev.emFundo !== false) emFundo.add(ev.id);
      }
      return repetiu || saiuDoSilencio ? aviso(0) : null;
    },
    avaliar(agora) {
      const mudoMs = Math.max(0, agora - ultimoEvento);
      const nivel = nivelDoSilencio(mudoMs);
      if (nivel <= nivelAvisado) return null;
      nivelAvisado = nivel;
      return aviso(mudoMs);
    },
  };
}
