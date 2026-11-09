import type { TimeNaLista } from "../../src/contracts/time.ts";
import { ICONE } from "./icones.ts";
import { esc } from "./render.ts";
import { ESPERA, type AvisoBot } from "./secoes.ts";

/**
 * Os times de bots na barra lateral (definido em 2026-11-02, NOD-437, protótipo aprovado). Puro: o renderSidebar e os
 * handlers de web/main.ts leem daqui o que desenhar e o que mandar ao servidor; o teste prova as regras sem DOM.
 *
 * Um bot está no time cuja chave do nome é igual à do `secao` dele (sem maiúsculas, sem acento, espaços colapsados); a
 * chave "" é o Sem time. A web não importa código de src (só tipos), então a chave é repetida aqui; o teste confere que é
 * a mesma de src/domain/times.ts.
 */

export const NOME_SEM_TIME = "Sem time";
export const TETO_NOME_TIME = 60;

export function chaveDoTime(nome: string): string {
  return nome.normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function nomeLimpo(nome: string): string {
  return nome.replace(/\s+/g, " ").trim();
}

const CHAVE_SEM_TIME = chaveDoTime(NOME_SEM_TIME);

/** O time como a barra o desenha. `id` null: ainda não veio do servidor (a frota antiga, ou o time que acabou de nascer). */
export type TimeDaBarra<A> = { id: string | null; nome: string; recolhido: boolean; semTime: boolean; bots: A[] };

/**
 * Os times na ordem da conta, cada um com os seus bots (na ordem em que vieram). Bot cujo time ainda não veio (frota sem
 * `times`, ou um time criado agora por outro caminho) entra num time provisório no fim, em ordem alfabética; sem a lista,
 * o Sem time é o primeiro.
 */
export function timesComBots<A extends { secao?: string | null }>(bots: readonly A[], times: readonly TimeNaLista[] | undefined): TimeDaBarra<A>[] {
  const lista: TimeDaBarra<A>[] = (times ?? []).map((t) => ({ id: t.id, nome: t.nome, recolhido: t.recolhido, semTime: t.semTime, bots: [] }));
  if (!lista.some((t) => t.semTime)) lista.unshift({ id: null, nome: "", recolhido: false, semTime: true, bots: [] });
  const porChave = new Map(lista.map((t) => [t.semTime ? "" : chaveDoTime(t.nome), t] as const));
  const novos: TimeDaBarra<A>[] = [];
  for (const b of bots) {
    const c = chaveDoTime(b.secao ?? "");
    const chave = c === CHAVE_SEM_TIME ? "" : c;
    let t = porChave.get(chave);
    if (!t) {
      t = { id: null, nome: nomeLimpo(b.secao ?? ""), recolhido: false, semTime: false, bots: [] };
      porChave.set(chave, t);
      novos.push(t);
    }
    t.bots.push(b);
  }
  return [...lista, ...novos.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))];
}

/** O nome que a pessoa lê: o Sem time tem nome "" no servidor. */
export const nomeDoTime = (t: { nome: string; semTime?: boolean }): string => (t.semTime || t.nome === "" ? NOME_SEM_TIME : t.nome);

/** O Sem time só tem cabeçalho quando existe outro time (protótipo: sozinho, a barra é só a lista dos bots). */
export const comCabecalho = (t: { semTime: boolean }, total: number): boolean => !t.semTime || total > 1;

/** O texto do leitor de tela no cabeçalho: "Produto, time 2 de 4". */
export function posicaoFalada(nome: string, indice: number, total: number): string {
  return `${nome}, time ${indice + 1} de ${total}`;
}

/**
 * O que o campo do nome diz enquanto a pessoa digita (criar ou renomear). null = serve. `existente`: o time de mesmo
 * nome — o Enter leva até ele em vez de criar outro.
 */
export function avisoDoNome(nome: string, times: readonly { id: string | null; nome: string; semTime: boolean }[], proprio?: string | null): { texto: string; existente?: { id: string | null; nome: string } } | null {
  const limpo = nomeLimpo(nome);
  if (limpo === "") return null;
  if (limpo.length > TETO_NOME_TIME) return { texto: `Até ${TETO_NOME_TIME} caracteres.` };
  const chave = chaveDoTime(limpo);
  if (chave === CHAVE_SEM_TIME) return { texto: "Sem time já existe: é onde ficam os bots fora dos times." };
  const existente = times.find((t) => !t.semTime && t.id !== proprio && chaveDoTime(t.nome) === chave);
  return existente ? { texto: `Já existe o time ${existente.nome}. Enter leva até ele.`, existente } : null;
}

export type AcaoDoTime = "renomear" | "subir" | "descer" | "excluir";

/** Os itens do ⋯ do time (protótipo): Renomear, Mover para cima, Mover para baixo, ─, Excluir time. O Sem time só se move. */
export function itensDoMenuDoTime(t: { semTime: boolean }, indice: number, total: number): { acao: AcaoDoTime; texto: string; perigo?: true; desabilitado?: true }[] {
  const mover = [
    { acao: "subir" as const, texto: "Mover para cima", ...(indice === 0 ? { desabilitado: true as const } : {}) },
    { acao: "descer" as const, texto: "Mover para baixo", ...(indice >= total - 1 ? { desabilitado: true as const } : {}) },
  ];
  return t.semTime ? mover : [{ acao: "renomear", texto: "Renomear" }, ...mover, { acao: "excluir", texto: "Excluir time", perigo: true }];
}

export const NOTA_SEM_TIME = "Sem time é onde ficam os bots fora dos times. Não dá para renomear nem excluir.";

/** Os atalhos com o foco no cabeçalho: ⌥↑/⌥↓ movem, F2 renomeia, ⌫/Delete exclui. */
export function atalhoDoCabecalho(e: { key: string; altKey: boolean; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }): AcaoDoTime | null {
  if (e.metaKey || e.ctrlKey || e.shiftKey) return null;
  if (e.altKey && e.key === "ArrowUp") return "subir";
  if (e.altKey && e.key === "ArrowDown") return "descer";
  if (e.altKey) return null;
  if (e.key === "F2") return "renomear";
  if (e.key === "Backspace" || e.key === "Delete") return "excluir"; // idioma-fixo: nome de tecla do KeyboardEvent
  return null;
}

/** "Nara", "Nara e Otto", "Nara, Otto e Bia". */
export function juntarNomes(nomes: readonly string[]): string {
  if (nomes.length <= 1) return nomes[0] ?? "";
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

/** O aviso do excluir (com Desfazer ao lado): "Time Produção excluído. Nara e Otto estão em Sem time." */
export function fraseDoExcluido(nome: string, bots: readonly string[]): string {
  if (bots.length === 0) return `Time ${nome} excluído.`;
  const quem = bots.length > 3 ? `${bots.length} bots` : juntarNomes(bots);
  return `Time ${nome} excluído. ${quem} ${bots.length === 1 ? "está" : "estão"} em ${NOME_SEM_TIME}.`;
}

/** O que o leitor de tela ouve depois de mover um time. */
export const fraseDoMovido = (nome: string, indice: number, total: number): string => `${nome} agora é o time ${indice + 1} de ${total}.`;

/** O vazio do time: no computador se arrasta; no celular se segura o bot (não há arrastar). */
export const textoDoVazio = (celular: boolean): string => (celular ? "Segure um bot e escolha Mudar de time" : "Arraste bots para cá");

/** O rodapé da multisseleção: "2 selecionados". */
export const textoDaSelecao = (n: number): string => `${n} ${n === 1 ? "selecionado" : "selecionados"}`;

/**
 * A seleção depois de um clique (⌘/Ctrl alterna um; Shift pega o intervalo desde a âncora, na ordem da barra; clique
 * simples não seleciona — abre a conversa, e quem chama limpa a seleção).
 */
export function selecionar(o: { atual: ReadonlySet<string>; ancora: string | null; ordem: readonly string[]; id: string; alternar: boolean; intervalo: boolean }): { selecao: Set<string>; ancora: string | null } {
  if (o.intervalo && o.ancora && o.ordem.includes(o.ancora) && o.ordem.includes(o.id)) {
    const [a, b] = [o.ordem.indexOf(o.ancora), o.ordem.indexOf(o.id)].sort((x, y) => x - y);
    return { selecao: new Set([...o.atual, ...o.ordem.slice(a, (b ?? 0) + 1)]), ancora: o.ancora };
  }
  if (o.alternar || o.intervalo) {
    const selecao = new Set(o.atual);
    if (selecao.has(o.id)) selecao.delete(o.id);
    else selecao.add(o.id);
    return { selecao, ancora: o.id };
  }
  return { selecao: new Set(), ancora: null };
}

/** A nova posição (0-based) do time depois de ⌥↑/⌥↓; null = já está na ponta. */
export function destinoAoMover(indice: number, total: number, acao: "subir" | "descer"): number | null {
  const d = acao === "subir" ? indice - 1 : indice + 1;
  return d < 0 || d >= total ? null : d;
}

/** A ordem dos times depois de soltar `id` antes do time de índice `antes` (total = no fim). */
export function ordemAoSoltarTime(ids: readonly string[], id: string, antes: number): { ordem: string[]; destino: number } {
  const de = ids.indexOf(id);
  const resto = ids.filter((x) => x !== id);
  const destino = Math.max(0, Math.min(resto.length, de >= 0 && antes > de ? antes - 1 : antes));
  return { ordem: [...resto.slice(0, destino), id, ...resto.slice(destino)], destino };
}

/**
 * Os recolhidos de antes (localStorage, chave `pessoa:secao:Nome`) que ainda não estão na conta: a primeira leitura com
 * os times os grava no servidor, uma vez, e os tira do navegador. "Meus agentes" (`secao:`) virou o Sem time.
 */
export function recolhidosParaMigrar(antigas: ReadonlySet<string>, pessoaId: string, times: readonly TimeNaLista[], o: { descartarOrfas?: boolean } = {}): { ids: string[]; chaves: string[]; restam: number } {
  const ids: string[] = [];
  const chaves: string[] = [];
  let restam = 0;
  const prefixo = `${pessoaId}:secao:`;
  for (const k of antigas) {
    if (!k.startsWith(prefixo)) continue;
    const c = chaveDoTime(k.slice(prefixo.length));
    const t = times.find((x) => (x.semTime ? "" : chaveDoTime(x.nome)) === c);
    // Revisão 2 (A): a seção que ainda não virou time (a frota só lê) fica no localStorage até o time existir; só sai
    // sem time quando a barra já não tem provisório (a seção sumiu de vez).
    if (!t) {
      if (o.descartarOrfas) chaves.push(k);
      else restam++;
      continue;
    }
    chaves.push(k);
    if (!t.recolhido) ids.push(t.id);
  }
  return { ids, chaves, restam };
}

/**
 * O cabeçalho do time: o botão que recolhe (com a posição falada no nome acessível e os atalhos), o ⋯ do menu e, no
 * computador, o cabeçalho inteiro arrastável. Recolhido, a contagem e o ponto do aviso mais forte entre os escondidos.
 * Time sem id (ainda não veio do servidor) só recolhe nada: sem menu nem arrasto até a frota voltar.
 */
export function cabecalhoDoTime(t: { id: string | null; nome: string; semTime: boolean; recolhido: boolean }, o: { indice: number; total: number; bots: number; aviso: AvisoBot; arrastavel: boolean }): string {
  const nome = nomeDoTime(t);
  const contagem = o.bots;
  const total = t.recolhido && contagem ? `<small aria-hidden="true">${contagem}</small>` : "";
  const ponto = t.recolhido && o.aviso ? `<i class="secao-aviso" data-aviso="${o.aviso}" aria-hidden="true"></i>` : "";
  const extra = t.recolhido ? [contagem ? `${contagem} ${contagem === 1 ? "bot" : "bots"}` : "", o.aviso ? ESPERA[o.aviso] : ""].filter(Boolean) : [];
  const rotulo = [posicaoFalada(nome, o.indice, o.total), ...extra].join(", ");
  const id = t.id ? esc(t.id) : "";
  const atalhos = t.semTime ? "Alt+ArrowUp Alt+ArrowDown" : "Alt+ArrowUp Alt+ArrowDown F2 Delete"; // idioma-fixo: sintaxe do aria-keyshortcuts
  const mais = t.id ? `<button type="button" class="time-mais" data-act="menu-time" data-time="${id}" aria-label="Ações do time ${esc(nome)}" aria-haspopup="menu">⋯</button>` : "";
  return `<h3 class="time-cab"${t.id && o.arrastavel ? ` draggable="true" data-time-arrastavel="${id}"` : ""}><button type="button" class="secao-cab" data-act="recolher-time" data-time="${id}" data-chave="${esc(`time:${t.semTime ? "" : chaveDoTime(t.nome)}`)}" aria-expanded="${t.recolhido ? "false" : "true"}" aria-label="${esc(rotulo)}" aria-keyshortcuts="${atalhos}" title="${t.recolhido ? "Mostrar" : "Recolher"} ${esc(nome)}"><span class="secao-nome">${esc(nome)}</span>${ICONE.seta}${total}${ponto}</button>${mais}</h3>`;
}

/** O campo do nome no lugar do cabeçalho (criar ou renomear): Enter confirma, Esc cancela; o aviso fala enquanto digita. */
export function campoDoNome(o: { alvo: string; valor: string; aviso: string | null }): string {
  const novo = o.alvo === "novo";
  return `<h3 class="time-cab time-editando"><input class="time-nome-campo" data-time-campo="${esc(o.alvo)}" value="${esc(o.valor)}" maxlength="${TETO_NOME_TIME}" placeholder="Nome do time" aria-label="${novo ? "Nome do time novo" : "Novo nome do time"}" aria-describedby="time-nome-aviso" autocomplete="off" spellcheck="false" /></h3><p class="time-nome-aviso" id="time-nome-aviso" role="status">${o.aviso ? esc(o.aviso) : ""}</p>`;
}

/**
 * QA do PR #632 (bug 1): o duplo clique no nome renomeia. O primeiro clique recolhe e a barra é redesenhada, então o
 * navegador não dispara dblclick (o botão virou outro nó); o segundo clique no mesmo time, dentro do intervalo, é o duplo.
 */
export const MS_CLIQUE_DUPLO = 400;
export function ehCliqueDuplo(anterior: { id: string; em: number } | null, id: string, em: number, ms = MS_CLIQUE_DUPLO): boolean {
  return !!anterior && anterior.id === id && em - anterior.em >= 0 && em - anterior.em <= ms;
}
