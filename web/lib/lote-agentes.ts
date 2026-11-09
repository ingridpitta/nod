/**
 * NOD-368 (protótipos aprovados pelo Marlon em 2026-10-27/28: computador = NOD-367 v2 j5-6 a j5-10; celular = NOD-368 v1):
 * a seleção e a troca em lote de Configurações › Agentes. Só o estado e as regras, sem DOM e sem rede: a tela desenha a
 * partir daqui (web/telas/agentes-lote.ts) e o main.ts manda os PUTs pela fila de `aplicarEmLote`.
 *
 * definido em 2026-10-28 (plano da NOD-368): a troca usa os mesmos `PUT /agentes/:id/maquina` e `PUT /agentes/:id/inteligencia`
 * da ficha, um por bot. Cada bot é uma transação: o que falha não desfaz os outros, e o erro fica na linha dele.
 */

export type IaDoLote = "auto" | "claude-cli" | "codex-cli";

/** O que a pessoa confirmou: a máquina ("" = Qualquer uma / Este Mac) ou a IA ("auto" = Automático). */
export type AcaoLote = { tipo: "maquina"; destino: string } | { tipo: "ia"; destino: IaDoLote };

export type ResultadoLote =
  | { estado: "mudando"; texto: string }
  | { estado: "ok"; texto: string }
  | { estado: "erro"; texto: string; acao: AcaoLote };

export type LoteAgentes = {
  /** O modo seleção ligado sem nenhum marcado (o "Selecionar" do celular). No computador, basta a 1ª marcada. */
  selecionando: boolean;
  selecionados: string[];
  /** O seletor aberto em cima da barra (popover no computador, folha no celular). */
  aberto: "maquina" | "ia" | null;
  /** A opção marcada no seletor aberto, antes de confirmar. */
  escolha: string | null;
  /** A troca em andamento: as ações da barra esperam até acabar. */
  mudando: boolean;
  /** A mensagem de cada bot na própria linha; fica até sair de Agentes. */
  resultados: Record<string, ResultadoLote>;
};

export const LOTE_INICIAL: LoteAgentes = { selecionando: false, selecionados: [], aberto: null, escolha: null, mudando: false, resultados: {} };

/** O modo seleção está ligado (caixas visíveis, barra no pé). */
export const emSelecao = (l: LoteAgentes): boolean => l.selecionando || l.selecionados.length > 0;

export function marcar(l: LoteAgentes, id: string): LoteAgentes {
  const selecionados = l.selecionados.includes(id) ? l.selecionados.filter((x) => x !== id) : [...l.selecionados, id];
  // Desmarcar o último fecha o seletor (não há para quem mudar); no celular o modo seleção continua até o Cancelar.
  return { ...l, selecionados, ...(selecionados.length === 0 ? { aberto: null, escolha: null } : {}) };
}

/** O estado da caixa "Selecionar todos" sobre os bots VISÍVEIS (a busca filtra): nenhum, alguns (mixed) ou todos. */
export function estadoDeTodos(selecionados: readonly string[], visiveis: readonly string[]): "false" | "mixed" | "true" {
  const n = visiveis.filter((id) => selecionados.includes(id)).length;
  return n === 0 ? "false" : n === visiveis.length ? "true" : "mixed";
}

/**
 * "Selecionar todos": com todos os visíveis marcados, desmarca os visíveis; senão marca todos os visíveis. Os marcados fora
 * da busca ficam como estavam (a pessoa os marcou com outra busca).
 */
export function marcarTodos(l: LoteAgentes, visiveis: readonly string[]): LoteAgentes {
  if (estadoDeTodos(l.selecionados, visiveis) === "true") {
    const selecionados = l.selecionados.filter((id) => !visiveis.includes(id));
    return { ...l, selecionados, ...(selecionados.length === 0 ? { aberto: null, escolha: null } : {}) };
  }
  // Revisão 3: não liga o `selecionando` (no computador, basta a 1ª marcada; desmarcar todos fecha a barra).
  return { ...l, selecionados: [...l.selecionados, ...visiveis.filter((id) => !l.selecionados.includes(id))] };
}

/** Cancelar: desliga as caixas e fecha a barra. As mensagens ficam nas linhas até sair de Agentes (j4-2 do celular). */
export const cancelar = (l: LoteAgentes): LoteAgentes => ({ ...LOTE_INICIAL, resultados: l.resultados, mudando: l.mudando });

/** Abre (ou fecha, se já aberto) o seletor; a escolha começa no valor comum dos marcados, quando há um. */
export function abrir(l: LoteAgentes, qual: "maquina" | "ia", valorComum: string | null): LoteAgentes {
  if (l.mudando || l.selecionados.length === 0) return l;
  return l.aberto === qual ? { ...l, aberto: null, escolha: null } : { ...l, aberto: qual, escolha: valorComum };
}

/** Os bots que somem da lista (excluídos, ocultos, de outra pessoa) saem da seleção. */
export function soOsQueExistem(l: LoteAgentes, existentes: readonly string[]): LoteAgentes {
  const selecionados = l.selecionados.filter((id) => existentes.includes(id));
  if (selecionados.length === l.selecionados.length) return l;
  return { ...l, selecionados, ...(selecionados.length === 0 ? { aberto: null, escolha: null } : {}) };
}

/** O valor comum aos marcados, ou null quando eles diferem ("várias") ou não há nenhum. */
export function valorComum(valores: readonly string[]): string | null {
  if (valores.length === 0) return null;
  return valores.every((v) => v === valores[0]) ? valores[0]! : null;
}

export type BotDoLote = { id: string; nome: string; valor: string; ocupado: boolean };

/** A prévia antes de confirmar: quem muda, quem já está no destino e, dos que mudam, quem está no meio de uma tarefa. */
export function previaDoLote(bots: readonly BotDoLote[], destino: string): { mudam: BotDoLote[]; jaEstao: BotDoLote[]; ocupados: BotDoLote[] } {
  const mudam = bots.filter((b) => b.valor !== destino);
  return { mudam, jaEstao: bots.filter((b) => b.valor === destino), ocupados: mudam.filter((b) => b.ocupado) };
}

/** "Ada", "Ada e Leo", "Ada, Gil e Leo". */
export function juntarNomes(nomes: readonly string[]): string {
  if (nomes.length <= 1) return nomes[0] ?? "";
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

/**
 * A fila da troca: no máximo `limite` PUTs ao mesmo tempo (definido em 2026-10-28: 4, para não encher a conexão com uma
 * equipe de 50). Cada bot avisa o próprio fim por `aoTerminar`; a falha de um não para a fila nem desfaz os outros.
 */
export async function aplicarEmLote<T>(ids: readonly string[], gravar: (id: string) => Promise<T>, aoTerminar: (id: string, r: { ok: true; valor: T } | { ok: false; erro: unknown }) => void, limite = 4): Promise<void> {
  let proximo = 0;
  const trabalhador = async (): Promise<void> => {
    while (proximo < ids.length) {
      const id = ids[proximo++]!;
      // Revisão 1: o callback fica fora do try do PUT — se ele lançar, o bot que gravou não vira "não mudou".
      let r: { ok: true; valor: T } | { ok: false; erro: unknown };
      try {
        r = { ok: true, valor: await gravar(id) };
      } catch (erro) {
        r = { ok: false, erro };
      }
      try { aoTerminar(id, r); } catch { /* a falha de um desenho não para a fila */ }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limite, ids.length)) }, trabalhador));
}
