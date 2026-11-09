import type { EstadoDoSubagente, EventoStream, SubagenteVivo } from "../contracts/turno.ts";
import { rotuloFerramenta } from "./rotulo-ferramenta.ts";

/**
 * Os subagentes e comandos em segundo plano de um turno (NOD-350, definido em 2026-10-23). O CLI conta o que cada um faz
 * em `system/task_*` (stream-json.ts os traduz em `tarefa_fundo` e `tarefa_progresso`); aqui vira a lista que a tela da
 * task mostra e a linha curta do `ultimoPasso` ("2 subagentes trabalhando"). Puro: `agora` vem de fora e só serve para
 * a duração RELATIVA de cada um; quem guarda o estado por turno é o adaptador (acompanhar-subagentes.ts).
 */
export type { EstadoDoSubagente, SubagenteVivo };

/** Um bot que abre subagentes sem parar não enche a tela nem o trecho da ponte. */
export const TETO_SUBAGENTES = 20;
export const TETO_DESCRICAO_SUBAGENTE = 80;
export const TETO_PASSO_SUBAGENTE = 60;
/**
 * O `passo` atravessa a ponte como o NOME cru da última ferramenta (só [A-Za-z0-9_.-], como o trecho `ferramenta`): o
 * servidor faz o rótulo (`comRotulos`), e um Mac com bug ou comprometido não põe texto livre na tela de ninguém.
 */
export const NOME_DE_FERRAMENTA = /^[A-Za-z0-9_.-]{1,80}$/;

type Item = Omit<SubagenteVivo, "duracaoMs"> & { desde: number; fim: number | null; duracaoCli: number | null };
export type AcompanhamentoDeSubagentes = { itens: readonly Item[] };
export const SEM_SUBAGENTES: AcompanhamentoDeSubagentes = { itens: [] };

function corta(texto: string, max: number): string {
  if (texto.length <= max) return texto;
  // Não parte um emoji ao meio (o par substituto sozinho vira "�" na tela).
  const corte = /[\uD800-\uDBFF]$/.test(texto.slice(0, max - 1)) ? max - 2 : max - 1;
  return `${texto.slice(0, corte).trimEnd()}…`;
}

function trocar(a: AcompanhamentoDeSubagentes, id: string, mudar: (i: Item) => Item): { acompanhamento: AcompanhamentoDeSubagentes; mudou: boolean } {
  const i = a.itens.findIndex((x) => x.id === id);
  if (i < 0) return { acompanhamento: a, mudou: false };
  const antes = a.itens[i]!;
  const depois = mudar(antes);
  const mudou = depois.estado !== antes.estado || depois.passo !== antes.passo || depois.chamadas !== antes.chamadas;
  return { acompanhamento: { itens: a.itens.map((x, j) => (j === i ? depois : x)) }, mudou };
}

/**
 * Aplica um evento do stream. `mudou` diz se o que a TELA mostra mudou (estado, passo ou contagem; a duração corre
 * sozinha na tela). Progresso ou fim de tarefa que não começou aqui, e um segundo fim da mesma, passam sem efeito.
 */
export function reduzirSubagentes(a: AcompanhamentoDeSubagentes, ev: EventoStream, agora: number): { acompanhamento: AcompanhamentoDeSubagentes; mudou: boolean } {
  if (ev.tipo === "tarefa_fundo" && ev.estado === "iniciada") {
    // Subagente em primeiro plano: o `Agent` do principal fica aberto ("Chamou um subagente…") e o fim dele não foi
    // medido (a s8 só tem os de fundo) — listar arriscaria um "trabalhando" eterno.
    if (ev.emFundo === false) return { acompanhamento: a, mudou: false };
    if (a.itens.some((x) => x.id === ev.id) || a.itens.length >= TETO_SUBAGENTES) return { acompanhamento: a, mudou: false };
    const natureza = ev.natureza ?? "comando";
    const item: Item = {
      id: ev.id,
      natureza,
      descricao: natureza === "agente" ? corta(ev.descricao ?? "Subagente", TETO_DESCRICAO_SUBAGENTE) : "",
      estado: "trabalhando",
      passo: null,
      chamadas: 0,
      desde: agora,
      fim: null,
      duracaoCli: null,
    };
    return { acompanhamento: { itens: [...a.itens, item] }, mudou: true };
  }
  if (ev.tipo === "tarefa_fundo") {
    return trocar(a, ev.id, (i) => (i.estado !== "trabalhando" ? i : { ...i, estado: ev.final ?? "concluido", fim: agora }));
  }
  if (ev.tipo === "tarefa_progresso") {
    return trocar(a, ev.id, (i) =>
      i.estado !== "trabalhando"
        ? i
        : {
            ...i,
            passo: ev.ultimaFerramenta && NOME_DE_FERRAMENTA.test(ev.ultimaFerramenta) ? ev.ultimaFerramenta : i.passo,
            chamadas: Math.max(i.chamadas, ev.chamadas),
            duracaoCli: ev.duracaoMs ?? i.duracaoCli,
          },
    );
  }
  return { acompanhamento: a, mudou: false };
}

/** Parar (ou o turno acabar) com algum ainda trabalhando: ele fica parado, nunca "trabalhando" para sempre. */
export function pararSubagentes(a: AcompanhamentoDeSubagentes, agora: number): { acompanhamento: AcompanhamentoDeSubagentes; mudou: boolean } {
  if (!a.itens.some((i) => i.estado === "trabalhando")) return { acompanhamento: a, mudou: false };
  return { acompanhamento: { itens: a.itens.map((i) => (i.estado === "trabalhando" ? { ...i, estado: "parado" as const, fim: agora } : i)) }, mudou: true };
}

/** A lista que atravessa a ponte: a duração é relativa ao início de cada um (o maior entre o relógio local e o do CLI). */
export function listaDeSubagentes(a: AcompanhamentoDeSubagentes, agora: number): SubagenteVivo[] {
  return a.itens.map(({ desde, fim, duracaoCli, ...i }) => ({ ...i, duracaoMs: Math.max(0, (fim ?? agora) - desde, i.estado === "trabalhando" ? (duracaoCli ?? 0) : 0) }));
}

/**
 * No servidor, antes do frame: o nome cru de cada `passo` vira o rótulo curto da tela ("Leu um arquivo"). Remonta campo a
 * campo — no modo local a lista não passa pela validação da ponte, e um campo a mais (summary, args) não chega ao SSE.
 */
export function comRotulos(lista: readonly SubagenteVivo[]): SubagenteVivo[] {
  return lista.map((s) => ({
    id: s.id,
    natureza: s.natureza,
    descricao: s.descricao,
    estado: s.estado,
    passo: s.passo ? corta(rotuloFerramenta(s.passo), TETO_PASSO_SUBAGENTE) : null,
    chamadas: s.chamadas,
    duracaoMs: s.duracaoMs,
  }));
}

function plural(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`;
}

/**
 * A linha curta do cartão, de Trabalhos e do cabeçalho da task (critérios 3 e 9 da NOD-350): sem cor e sem elemento
 * novo, só o texto. "2 subagentes trabalhando", "1 subagente trabalhando · 1 não terminou", "1 comando rodando",
 * "Os 2 subagentes voltaram · 1 não terminou", "2 subagentes parados". Sem nenhum, null.
 */
export function resumoSubagentes(lista: readonly SubagenteVivo[]): string | null {
  const agentes = lista.filter((s) => s.natureza === "agente");
  const comandos = lista.filter((s) => s.natureza === "comando" && s.estado === "trabalhando").length;
  const conta = (e: EstadoDoSubagente) => agentes.filter((s) => s.estado === e).length;
  const trabalhando = conta("trabalhando");
  const parados = conta("parado");
  const naoTerminou = conta("falhou") + (parados < agentes.length ? parados : 0);
  const partes: string[] = [];
  if (trabalhando > 0) partes.push(plural(trabalhando, "subagente trabalhando", "subagentes trabalhando"));
  else if (agentes.length > 0 && parados === agentes.length) partes.push(plural(parados, "subagente parado", "subagentes parados"));
  else if (agentes.length > 0) partes.push(agentes.length === 1 ? "O subagente voltou" : `Os ${agentes.length} subagentes voltaram`);
  if (naoTerminou > 0 && !(parados === agentes.length && trabalhando === 0)) partes.push(naoTerminou === 1 ? "1 não terminou" : `${naoTerminou} não terminaram`);
  if (comandos > 0) partes.push(plural(comandos, "comando rodando", "comandos rodando"));
  return partes.length ? partes.join(" · ") : null;
}

/** Ainda há algum trabalhando: a tela pulsa o cabeçalho dos subagentes e a task não termina. */
export function haSubagenteTrabalhando(lista: readonly SubagenteVivo[]): boolean {
  return lista.some((s) => s.estado === "trabalhando");
}
