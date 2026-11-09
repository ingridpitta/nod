import type { ComandoDaConversa, ComandoDoMac, ComandosDto } from "../../src/contracts/comandos.ts";
import type { Mensagem } from "../../src/contracts/mensagem.ts";

/**
 * O "/" do campo (definido em 2026-09-28; canvas "Comandos /"). Puro: o que a lista mostra para o que foi digitado.
 * Três grupos, nesta ordem: os que a pessoa usou com este bot, os da conversa (ações do nod) e as skills do Mac.
 * ADR-125 (NOD-349): na conversa com um bot, os atalhos que saíram da gaveta (/planejar, /pedir-ajuda) vêm antes de
 * tudo; escolher um deles troca o "/nome" pelo começo do pedido, e a pessoa completa.
 * A lista de comandos da conversa vem do servidor (a web não importa valor de src — ADR-018).
 */
export type ItemDaBarra = {
  nome: string;
  descricao: string;
  grupo: "atalhos" | "recentes" | "conversa" | "skills";
  /** Origem da skill ("gstack", "posthog", "Claude Code"), ou o nome do terminal de um comando da conversa. */
  etiqueta: string;
  argumento?: string;
  /** Só nos atalhos: o texto que entra no campo no lugar do "/nome". */
  texto?: string;
};

/** Os atalhos da gaveta antiga (Planejar uma tarefa, Pedir ajuda a outro bot), com o mesmo texto de antes. */
export const ATALHOS_DA_BARRA: readonly ItemDaBarra[] = [
  { nome: "planejar", descricao: "Planejar uma tarefa", grupo: "atalhos", etiqueta: "", texto: "Me ajude a planejar esta tarefa: " },
  { nome: "pedir-ajuda", descricao: "Pedir ajuda a outro bot", grupo: "atalhos", etiqueta: "", texto: "Consulte o colega mais adequado da minha equipe para me ajudar com: " },
];

export type ListaDaBarra = {
  itens: ItemDaBarra[];
  /** Quantas skills casam além das mostradas. */
  maisSkills: number;
  /** O que foi digitado é um comando só do terminal (/doctor): a lista diz onde ele roda. */
  soDoTerminal: string | null;
  /** Ainda não chegou nenhum catálogo do Mac (primeiro turno no Claude Code não aconteceu). */
  semCatalogo: boolean;
};

const SKILLS_SEM_FILTRO = 5;
const SKILLS_COM_FILTRO = 12;
const RECENTES = 3;

/** O nome parcial depois da barra, enquanto o cursor está no primeiro pedaço; fora disso, null (a lista fecha). */
export function nomeDigitado(valor: string, cursor: number): string | null {
  const m = /^\/(\S*)$/.exec(valor.slice(0, cursor));
  return m ? m[1]! : null;
}

/** Prefixo antes de trecho: "rev" acha review antes de code-review. */
function posicao(nome: string, filtro: string): number {
  if (!filtro) return 0;
  const n = nome.toLowerCase();
  if (n.startsWith(filtro)) return 0;
  const i = n.indexOf(filtro);
  return i < 0 ? -1 : 1 + i;
}

function daConversa(c: ComandoDaConversa): ItemDaBarra {
  return { nome: c.nome, descricao: c.descricao, grupo: "conversa", etiqueta: [c.apelidos[0], c.gratis ? "grátis" : ""].filter(Boolean).join(" · ") };
}

function doMac(c: ComandoDoMac, grupo: ItemDaBarra["grupo"]): ItemDaBarra {
  return { nome: c.nome, descricao: c.descricao, grupo, etiqueta: c.origem, ...(c.argumento ? { argumento: c.argumento } : {}) };
}

/** Os comandos que a pessoa mandou nesta conversa, do mais recente, sem repetir. */
export function recentesDaConversa(mensagens: readonly Mensagem[]): string[] {
  const nomes: string[] = [];
  for (const m of [...mensagens].reverse()) {
    if (m.autoria.autor_tipo !== "pessoa") continue;
    const nome = /^\/(\S+)/.exec(m.texto.trim())?.[1];
    if (nome && !nomes.includes(nome)) nomes.push(nome);
    if (nomes.length >= RECENTES) break;
  }
  return nomes;
}

/**
 * `botProprio` (NOD-23): a conversa é com um bot da pessoa, já confirmado e que não é o Nod; só aí entram os comandos
 * `soBotProprio` (/configurar). O servidor confere de novo ao receber.
 */
export function listaDaBarra(dto: ComandosDto | null, filtro: string, recentes: readonly string[], comAtalhos = false, botProprio = false): ListaDaBarra {
  const f = filtro.toLowerCase();
  const atalhos = comAtalhos ? ATALHOS_DA_BARRA.filter((a) => posicao(a.nome, f) >= 0) : [];
  const doMacLista = dto?.doMac?.comandos ?? [];
  const conversa = (dto?.daConversa ?? []).filter((c) => (botProprio || !c.soBotProprio) && [c.nome, ...c.apelidos].some((n) => posicao(n, f) >= 0));
  const ordenar = <T extends { nome: string }>(xs: T[]) => xs.map((x) => ({ x, p: posicao(x.nome, f) })).filter((y) => y.p >= 0).sort((a, b) => a.p - b.p).map((y) => y.x);
  const recentesItens = recentes
    .map((nome) => doMacLista.find((c) => c.nome === nome) ?? null)
    .filter((c): c is ComandoDoMac => c !== null && posicao(c.nome, f) >= 0)
    .map((c) => doMac(c, "recentes"));
  const jaMostrados = new Set(recentesItens.map((i) => i.nome));
  const skills = ordenar(doMacLista.filter((c) => !jaMostrados.has(c.nome)));
  const teto = f ? SKILLS_COM_FILTRO : SKILLS_SEM_FILTRO;
  const soDoTerminal = f && dto?.doMac?.soDoTerminal.includes(f) ? f : null;
  return {
    itens: [...atalhos, ...recentesItens, ...conversa.map(daConversa), ...skills.slice(0, teto).map((c) => doMac(c, "skills"))],
    maisSkills: Math.max(0, skills.length - teto),
    soDoTerminal,
    semCatalogo: !dto?.doMac,
  };
}

/** O comando no começo do texto já escrito: um da conversa (pelo nome ou apelido) ou uma skill do Mac. */
export function comandoNoTexto(dto: ComandosDto | null, texto: string): { conversa: ComandoDaConversa; resto: string } | { mac: ComandoDoMac; resto: string } | null {
  const m = /^\/(\S+)([\s\S]*)$/.exec(texto.trimStart());
  if (!m || !dto) return null;
  const nome = m[1]!.toLowerCase();
  const resto = m[2]!.trim();
  const conversa = dto.daConversa.find((c) => c.nome === nome || c.apelidos.includes(nome));
  if (conversa) return { conversa, resto };
  const mac = dto.doMac?.comandos.find((c) => c.nome.toLowerCase() === nome);
  return mac ? { mac, resto } : null;
}
