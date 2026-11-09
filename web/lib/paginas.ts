/**
 * NOD-445 (ADR-146): a pílula do bot vira uma porta de páginas. A conversa, Tarefas (quando o bot tem quadro) e cada app
 * que a pessoa criou são páginas; a ordem mora no servidor (`PaginasDto.ordem`) e a primeira é a casa do bot. Aqui ficam
 * só as decisões sem DOM; o HTML mora em web/telas/paginas.ts e o DOM (doca com mola, rolagem, gestos, dica) em
 * web/lib/paginas-na-tela.ts. Base: o teste do Dante (dev/pilula-paginas), revisado.
 */
import type { AppDto, IconeDoApp, PaginasDto } from "../../src/contracts/apps.ts";

export type IconeDaPagina = "conversa" | "tarefas" | "canvas" | IconeDoApp;

export interface Pagina {
  /** "conversa", "tarefas" ou "app:<uuid>" (os ids da ordem do servidor). */
  id: string;
  nome: string;
  icone: IconeDaPagina;
  /** Algo nesta página pede a pessoa: o pontinho e o ícone acendem em laranja. */
  pedeVoce?: boolean;
  /** A página de um app (o retrato que o bot mantém). */
  app?: AppDto;
  /** A fonte do app falhou: o ícone fica apagado (sem vermelho). */
  apagado?: boolean;
}

export const CONVERSA: Pagina = { id: "conversa", nome: "Conversa", icone: "conversa" };
export const TAREFAS: Pagina = { id: "tarefas", nome: "Tarefas", icone: "tarefas" };
/** ADA-13 (ADR-150): a página do app Canvas, quando o bot tem acesso (o servidor manda `temCanvas`). */
export const CANVAS: Pagina = { id: "canvas", nome: "Canvas", icone: "canvas" };

export const idDoApp = (appId: string): string => `app:${appId}`;

/**
 * As páginas do bot, na ordem de dentro (a de sempre): Conversa, Tarefas (só com quadro: liga sozinho na primeira
 * tarefa) e os apps na ordem de criação. A ordem da pílula é outra coisa (`ordemDasPaginas` com `dto.ordem`).
 * Sem resposta do servidor ainda, só a conversa.
 */
export function paginasDoDto(dto: PaginasDto | null | undefined, o: { tarefasPedem?: boolean } = {}): Pagina[] {
  if (!dto) return [CONVERSA];
  const lista: Pagina[] = [CONVERSA];
  if (dto.temTarefas) lista.push(o.tarefasPedem ? { ...TAREFAS, pedeVoce: true } : TAREFAS);
  if (dto.temCanvas) lista.push(CANVAS);
  for (const a of [...dto.apps].sort((x, y) => x.criadoEm - y.criadoEm)) {
    lista.push({ id: idDoApp(a.id), nome: a.nome, icone: a.icone, app: a, ...(a.pedeVoce ? { pedeVoce: true } : {}), ...(a.erroFonte ? { apagado: true } : {}) });
  }
  return lista;
}

/** A página que estava à vista, na lista nova: pelo id (a lista muda quando um app chega ou sai). -1 = sumiu. */
export function indicePeloId(paginas: readonly Pagina[], id: string | undefined): number {
  return id === undefined ? -1 : paginas.findIndex((p) => p.id === id);
}

/** O texto que "+ pedir um app" põe na caixa da conversa (padrão da NOD-444: frase começada, sem formulário). */
export const FRASE_DE_PEDIR_APP = "Cria um app para ";
/** "Editar" no menu do ícone: a frase começada que leva o pedido para a conversa. */
export const fraseDeEditarApp = (nome: string): string => `No app ${nome}, muda `;
/** "Pedir acesso de novo" no erro de fonte: a conversa segue o pedir_acesso de sempre. */
export const fraseDeReconectar = (nome: string): string => `O app ${nome} perdeu o acesso à fonte. Pede o acesso de novo?`;
/** O rascunho é só uma frase que a pílula pré-preencheu (com ou sem os espaços do fim)? Vazio também conta. */
export function soFrasePreenchida(rascunho: string): boolean {
  const t = rascunho.trim();
  if (!t || t === FRASE_DE_PEDIR_APP.trim()) return true;
  // Os nomes de app têm de 1 a 20 caracteres numa linha (validarNome).
  return /^No app [^\n]{1,20}, muda$/.test(t) || /^O app [^\n]{1,20} perdeu o acesso à fonte\. Pede o acesso de novo\?$/.test(t);
}

/**
 * O texto da caixa depois de a pílula pôr uma frase (QA do #626): se o rascunho é vazio ou só outra frase pré-preenchida,
 * a nova troca a anterior (clicar "Editar" em dois apps não empilha "No app A, muda" + "No app B, muda"); se a pessoa
 * escreveu algo, o rascunho fica e a frase vai depois dele.
 */
export function caixaComFrase(rascunho: string, frase: string): string {
  return soFrasePreenchida(rascunho) ? frase : `${rascunho.trimEnd()}\n${frase}`;
}
/** No limite (12 páginas, a vaga de Tarefas reservada), a doca explica em uma linha. */
export const linhaDoLimite = (limite: number): string => `Chegou ao limite de ${limite} páginas (Tarefas conta). Remova um app para pedir outro.`;

/** Até 6 pontinhos; depois disso, "+N". */
export const MAX_PONTOS = 6;
export type Ponto = "atual" | "pede" | "";

/** Os pontinhos sob a pílula. Uma página só (0 app) não tem pontinho. A atual vem alongada, mesmo pedindo você. */
export function pontos(paginas: readonly Pagina[], atual: number): { itens: Ponto[]; mais: number } {
  if (paginas.length < 2) return { itens: [], mais: 0 };
  const itens = paginas.slice(0, MAX_PONTOS).map((p, i): Ponto => (i === atual ? "atual" : p.pedeVoce ? "pede" : ""));
  return { itens, mais: Math.max(0, paginas.length - MAX_PONTOS) };
}

/** Prende o índice nas pontas (sem dar a volta: rolar além da última página só faz a pílula esticar). */
export function presa(i: number, total: number): number {
  return Math.max(0, Math.min(total - 1, i));
}

/** O teclado na pílula: ← → andam uma página, Home e End vão às pontas. null = a tecla não é da pílula. */
export function paginaPelaTecla(atual: number, total: number, tecla: string): number | null {
  if (total < 2) return null;
  if (tecla === "ArrowRight") return presa(atual + 1, total);
  if (tecla === "ArrowLeft") return presa(atual - 1, total);
  if (tecla === "Home") return 0;
  if (tecla === "End") return total - 1;
  return null;
}

/** O que o leitor de tela diz ao trocar: "página 2 de 3, Tarefas". */
export function anuncioDaPagina(i: number, total: number, nome: string): string {
  return `página ${i + 1} de ${total}, ${nome}`;
}

/** O gesto da roda acaba depois deste tanto sem evento (o trackpad manda dezenas por gesto, a inércia inclusive). */
export const TRAVA_DA_RODA_MS = 380;

/** Um passo da mola (massa 1): devolve a nova posição e a velocidade. `dt` em segundos, preso em 32 ms. */
export function passoDaMola(m: { x: number; v: number }, alvo: number, k: number, c: number, dt: number): { x: number; v: number; parou: boolean } {
  const t = Math.min(0.032, Math.max(0, dt));
  const forca = -k * (m.x - alvo) - c * m.v;
  const v = m.v + forca * t;
  const x = m.x + v * t;
  const parou = Math.abs(v) < 0.5 && Math.abs(x - alvo) < 0.3;
  return parou ? { x: alvo, v: 0, parou } : { x, v, parou };
}

/** A dica da primeira vez, pelo tipo de ponteiro. */
export function textoDaDica(toque: boolean, mac = false): string {
  // ADA-8: a dica ensina o caminho visível (os pontos) junto do gesto; no computador, o trackpad de lado (a roda não troca).
  return toque ? "deslize para o lado ou toque nos pontos" : `passe o mouse ou deslize de lado na pílula · ${rotuloDasTeclas(mac).trocar} troca`;
}

/**
 * A dica aparece uma vez só: com mais de uma página e sem a marca guardada. Com a conversa encoberta (a inicial do
 * celular por cima, ADA-19: "sem dica de gesto") ela espera, em vez de pairar sobre a inicial e se gastar sem ser vista.
 */
export function mostraDica(total: number, jaViu: string | null, encoberta = false): boolean {
  return total > 1 && jaViu === null && !encoberta;
}

/** Tarefas pode ser vista como Lista ou como Quadro (o celular fica sempre na lista). */
export type FormaDasTarefas = "lista" | "quadro";
export function ehForma(v: unknown): v is FormaDasTarefas {
  return v === "lista" || v === "quadro";
}

/*
 * A ordem das páginas, por agente (atualização de 02/11): arrastar um ícone da doca muda a ordem, e a página da PRIMEIRA
 * posição é a casa do agente: abrir o agente abre nela (ex.: Tarefas em vez da Conversa). A ordem fica no servidor.
 * Por dentro as páginas seguem com o índice de sempre (a 0 é a conversa); a ordem é só como a pílula mostra e anda.
 */

/**
 * A ordem de exibição, como índices das páginas: primeiro as guardadas (as que ainda existem, sem repetir), depois as
 * novas, na ordem de sempre. Sem nada guardado é 0, 1, 2…
 */
export function ordemDasPaginas(paginas: readonly Pagina[], guardada: readonly string[]): number[] {
  const porId = new Map(paginas.map((p, i) => [p.id, i]));
  const vistos = new Set<number>();
  const ordem: number[] = [];
  for (const id of guardada) {
    const i = porId.get(id);
    if (i !== undefined && !vistos.has(i)) { vistos.add(i); ordem.push(i); }
  }
  paginas.forEach((_, i) => { if (!vistos.has(i)) ordem.push(i); });
  return ordem;
}

/** Leva o item da posição `de` para a posição `para` (posições de exibição; fora da faixa é presa). */
export function moverNaOrdem<T>(ordem: readonly T[], de: number, para: number): T[] {
  const n = ordem.length;
  if (de < 0 || de >= n) return [...ordem];
  const alvo = presa(para, n);
  const nova = [...ordem];
  const [item] = nova.splice(de, 1);
  nova.splice(alvo, 0, item as T);
  return nova;
}

/** A ordem para guardar: os ids na ordem de exibição. */
export function idsDaOrdem(paginas: readonly Pagina[], ordem: readonly number[]): string[] {
  return ordem.map((i) => paginas[i]?.id).filter((id): id is string => !!id);
}

/** A posição onde o ícone arrastado cai: quantos centros dos OUTROS ícones ficaram à esquerda do ponteiro. */
export function posicaoDoArrasto(centrosDosOutros: readonly number[], x: number): number {
  return centrosDosOutros.filter((c) => c < x).length;
}

/**
 * NOD-461: as teclas da pílula (⌥← → troca, ⌥⇧← → move; quem decide é `setaDaPilula` em web/lib/atalhos.ts) como a
 * pessoa as vê: ⌥ e ⇧ no Mac, Alt e Shift fora dele.
 */
export function rotuloDasTeclas(mac: boolean): { trocar: string; mover: string } {
  return mac ? { trocar: "⌥ ← →", mover: "⌥⇧ ← →" } : { trocar: "Alt ← →", mover: "Alt Shift ← →" };
}

/** O aria-keyshortcuts dos ícones da doca: trocar, mover e o menu. */
export const ARIA_DAS_TECLAS = "Alt+ArrowLeft Alt+ArrowRight Alt+Shift+ArrowLeft Alt+Shift+ArrowRight Shift+F10"; // idioma-fixo: sintaxe do aria-keyshortcuts

/** É Mac (as teclas se mostram com ⌥ e ⇧)? Pela plataforma do navegador. */
export function ehMac(plataforma: string | undefined): boolean {
  return /Mac|iPhone|iPad/.test(plataforma ?? "");
}

/**
 * O que o leitor de tela diz ao mover pelo teclado, no texto da issue (revisão 7 do #626): "Tarefas, página 1 de 3". Que a
 * primeira é a que abre primeiro, o rótulo do ícone já diz ("Tarefas, abre primeiro").
 */
export function anuncioDaOrdem(nome: string, posicao: number, total: number): string {
  return `${nome}, página ${posicao + 1} de ${total}`;
}
