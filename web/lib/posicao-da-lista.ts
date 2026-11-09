/**
 * NOD-370: onde a pessoa estava numa lista que se redesenha (Seu espaço › Agentes, a barra lateral). Excluir ou ocultar
 * um bot tira a linha dele; o foco vai para a linha seguinte do mesmo grupo (a anterior, se era a última) e a rolagem
 * fica onde estava.
 */

/** O mínimo de DOM que estas funções usam (o teste unit roda sem jsdom). */
export type ElDaLista = {
  dataset: Record<string, string | undefined>;
  isConnected: boolean;
  scrollTop: number;
  closest(seletor: string): RaizDaLista | null;
  focus(opcoes?: { preventScroll?: boolean }): void;
  /** Vazio quando o elemento não aparece (display: none, `hidden`, dentro de algo escondido). */
  getClientRects(): ArrayLike<unknown>;
  matches(seletor: string): boolean;
};
export type RaizDaLista = {
  querySelector(seletor: string): ElDaLista | null;
  querySelectorAll(seletor: string): ArrayLike<ElDaLista>;
  contains(el: unknown): boolean;
};

/** O ⋯ de cada linha de bot em Configurações › Agentes. */
export const SELETOR_MENU_DO_BOT = '[data-act="menu-agente"][data-id]';
/**
 * Na barra lateral o ⋯ só aparece no toque (navegacao.css, `.bot-mais`): o alvo é o botão que abre a conversa, dentro
 * da linha do bot (o do Nod no topo é a própria linha e fica de fora).
 */
export const SELETOR_LINHA_DA_BARRA = '[data-bot-contexto] [data-act="abrir-conversa"][data-agente]';

/** O id que fica no lugar de `id` quando ele sai da lista: o seguinte, o anterior se era o último, ou null. */
export function vizinhoNaLista(ids: readonly string[], id: string): string | null {
  const i = ids.indexOf(id);
  if (i < 0) return null;
  return ids[i + 1] ?? ids[i - 1] ?? null;
}

/** `CSS.escape` do navegador; fora dele (teste), escapa aspas e barra, o bastante para ids sem controle. */
export function escaparCss(s: string): string {
  const css = (globalThis as { CSS?: { escape?: (v: string) => string } }).CSS;
  return css?.escape ? css.escape(s) : s.replace(/["\\]/g, "\\$&");
}

/** O seletor do ⋯ de um bot. */
export function seletorDoMenuDoBot(id: string): string {
  return `[data-act="menu-agente"][data-id="${escaparCss(id)}"]`;
}

/** O seletor que acha de novo, depois de redesenhar, o botão de ação de uma linha (`data-act` + `data-id`). */
export function seletorDoBotaoDaLinha(el: { dataset: Record<string, string | undefined> } | null): string | null {
  const act = el?.dataset.act;
  const id = el?.dataset.id;
  if (!act || !id) return null;
  return `[data-act="${escaparCss(act)}"][data-id="${escaparCss(id)}"]`;
}

/** A rolagem guardada só volta na mesma seção: trocar de seção começa do topo. */
export function rolagemParaRepor(antes: { chave: string | null; top: number } | null, chaveAgora: string | null): number | null {
  if (!antes || antes.chave === null || antes.chave !== chaveAgora || antes.top <= 0) return null;
  return antes.top;
}

/** Uma lista de bots na tela: onde ela está, como achar as linhas e o id de cada uma. */
type Lista = { raiz: RaizDaLista; prefixo: "#espaco" | "#sidebar"; itens: string; idDe: (el: ElDaLista) => string | undefined; alvo: (id: string) => string; grupo: string | null; vazio: string | null };

const visivel = (el: ElDaLista): boolean => el.getClientRects().length > 0;

/**
 * Quem fica no lugar do bot `id` na lista: o vizinho visível do MESMO grupo (o time, ou Ocultos); com o grupo vazio, o
 * mais próximo da lista inteira. Linha escondida (a busca, a seção recolhida) não conta. null quando o bot não está ali.
 */
function vizinhoNaTela(l: Lista, id: string): { vizinho: string | null } | null {
  const todos = Array.from(l.raiz.querySelectorAll(l.itens));
  const proprio = todos.find((el) => l.idDe(el) === id);
  if (!proprio) return null;
  const ids = (els: ElDaLista[]) => els.filter((el) => el === proprio || visivel(el)).map((el) => l.idDe(el) ?? "");
  const grupo = l.grupo ? proprio.closest(l.grupo) : null;
  const doGrupo = grupo ? vizinhoNaLista(ids(Array.from(grupo.querySelectorAll(l.itens))), id) : null;
  return { vizinho: doGrupo ?? vizinhoNaLista(ids(todos), id) };
}

/** O retrato de uma região antes de redesenhar: a rolagem do elemento rolável e o botão de linha focado. */
export type PosicaoDaRegiao = { rolagem: { chave: string | null; top: number } | null; foco: ElDaLista | null; seletorFoco: string | null };

export function guardarPosicao(raiz: RaizDaLista, ativo: unknown, rolavel: { seletor: string; chaveAntes: string | null } | null): PosicaoDaRegiao {
  const el = rolavel ? raiz.querySelector(rolavel.seletor) : null;
  const foco = ativo && raiz.contains(ativo) ? (ativo as ElDaLista) : null;
  return { rolagem: el && rolavel ? { chave: rolavel.chaveAntes, top: el.scrollTop } : null, foco, seletorFoco: seletorDoBotaoDaLinha(foco) };
}

/** Depois de redesenhar: a rolagem volta se a seção é a mesma, e o foco volta ao botão da mesma linha se o antigo saiu. */
export function reporPosicao(raiz: RaizDaLista, antes: PosicaoDaRegiao, rolavel: { seletor: string; chave: string | null } | null): void {
  const top = rolavel ? rolagemParaRepor(antes.rolagem, rolavel.chave) : null;
  if (top !== null && rolavel) { const el = raiz.querySelector(rolavel.seletor); if (el) el.scrollTop = top; }
  if (antes.foco && !antes.foco.isConnected && antes.seletorFoco) raiz.querySelector(antes.seletorFoco)?.focus({ preventScroll: true });
}

/**
 * NOD-370: o que acontece depois de excluir ou ocultar um bot. O leitor de tela ouve para onde ele foi; o foco vai para o
 * vizinho na lista em que a pessoa estava — Configurações › Agentes (com a lista vazia, a aba Agentes) ou a barra
 * lateral. Nunca abre Seu espaço. O vizinho é lido de novo na hora (a lista pode ter mudado com o diálogo aberto) e, se o
 * bot já saiu, vale o lido quando o diálogo abriu. `lembrarFoco` guarda o destino para o próximo redesenho, que troca
 * os botões.
 */
export function planejarSaidaDaLista(o: {
  doc: RaizDaLista;
  /** O elemento com o foco agora (`document.activeElement`). */
  ativo: () => unknown;
  agentesAberto: boolean;
  id: string;
  nome: string;
  grupo: "Excluídos" | "Ocultos";
  anunciar: (texto: string) => void;
  lembrarFoco: (seletor: string) => void;
}): (dialogoAindaAberto: boolean) => void {
  const espaco = o.agentesAberto ? o.doc.querySelector("#espaco") as unknown as RaizDaLista | null : null;
  const barra = o.doc.querySelector("#sidebar") as unknown as RaizDaLista | null;
  const listas: Lista[] = [];
  if (espaco) listas.push({ raiz: espaco, prefixo: "#espaco", itens: SELETOR_MENU_DO_BOT, idDe: (el) => el.dataset.id, alvo: seletorDoMenuDoBot, grupo: ".lc-lista", vazio: '[data-act="secao-espaco"][data-secao="agentes"]' });
  else if (barra) listas.push({ raiz: barra, prefixo: "#sidebar", itens: SELETOR_LINHA_DA_BARRA, idDe: (el) => el.dataset.agente, alvo: seletorDaLinhaDaBarra, grupo: null, vazio: null });
  const onde = () => {
    for (const l of listas) {
      const v = vizinhoNaTela(l, o.id);
      if (v) return { l, vizinho: v.vizinho };
    }
    return null;
  };
  const antes = onde();
  return (dialogoAindaAberto) => {
    o.anunciar(`${o.nome} foi para ${o.grupo}.`);
    // A pessoa fechou o confirmar com o pedido em andamento e já foi para outro lugar: o foco é dela. Se ele ficou na
    // linha do próprio bot (que vai sumir) ou no <body>, segue para o vizinho.
    if (!dialogoAindaAberto && !focoSemDono(o.ativo(), o.id)) return;
    const agora = onde() ?? antes;
    if (!agora) return;
    const seletor = agora.vizinho ? agora.l.alvo(agora.vizinho) : agora.l.vazio;
    if (!seletor) return;
    agora.l.raiz.querySelector(seletor)?.focus({ preventScroll: true });
    o.lembrarFoco(`${agora.l.prefixo} ${seletor}`);
  };
}

/** O botão que abre a conversa de um bot na barra lateral. */
export function seletorDaLinhaDaBarra(id: string): string {
  return `[data-bot-contexto] [data-act="abrir-conversa"][data-agente="${escaparCss(id)}"]`;
}

/** O foco no <body>, num elemento que saiu da página ou na linha do bot que está saindo: ninguém o está usando. */
function focoSemDono(ativo: unknown, id: string): boolean {
  if (!ativo) return true;
  const el = ativo as Partial<ElDaLista> & { tagName?: string };
  if (el.tagName === "BODY" || el.isConnected === false) return true;
  return (el.dataset?.act === "menu-agente" && el.dataset.id === id) || (el.dataset?.act === "abrir-conversa" && el.dataset.agente === id);
}

/**
 * NOD-370: o destino do foco depois de excluir ou ocultar. O redesenho que tira a linha do bot troca os botões e o foco
 * cairia no <body>; `aplicar` (no fim de cada desenho) o leva ao destino. Vale até `prazoMs` e só enquanto ninguém mexeu:
 * `descartar` (um clique, uma tecla) ou o foco em outro lugar acabam com ele.
 */
export function criarFocoPendente(doc: { readonly activeElement: unknown; readonly body: unknown; querySelector(s: string): ElDaLista | null }, agora: () => number, prazoMs = 5_000) {
  let pendente: { seletor: string; ate: number } | null = null;
  return {
    lembrar(seletor: string): void { pendente = { seletor, ate: agora() + prazoMs }; },
    descartar(): void { pendente = null; },
    pendente(): string | null { return pendente?.seletor ?? null; },
    aplicar(): void {
      if (!pendente) return;
      const ativo = doc.activeElement as ElDaLista | null;
      const semFoco = !ativo || ativo === doc.body || !ativo.isConnected;
      if (agora() > pendente.ate || (!semFoco && !ativo.matches(pendente.seletor))) { pendente = null; return; }
      // Já está no destino: segue valendo para o redesenho seguinte (a frota nova ainda vai trocar a lista).
      if (!semFoco) return;
      doc.querySelector(pendente.seletor)?.focus({ preventScroll: true });
      pendente = null;
    },
  };
}

/** NOD-370: o texto vai para a região viva fixa; esvaziar antes faz o leitor repetir um texto igual ao anterior. */
export function anunciarEm(regiao: { textContent: string | null } | null, texto: string, depois: (fn: () => void) => void): void {
  if (!regiao) return;
  regiao.textContent = "";
  depois(() => { regiao.textContent = texto; });
}
