import type { ModoConversa, OpQuadro } from "../contracts/quadro.ts";

/**
 * O quadro com várias pessoas (definido em 2026-11-02, NOD-443, ADR-143). Puro: quem decide a pendência (D5), quem pode
 * desfazer (D9), o que cada um pode pedir em cada modo (D3, D7), a assinatura "Ana, pela Ada" (padrão da NOD-430) e o
 * mural de Atividade (D1, D8). Quem lê a participação e abre o escopo da dona é src/use-cases/quadro-pessoas.ts.
 */

export type Papel = "dona" | "membro";

/**
 * Os pedidos que só a dona faz (quem participa recebe a recusa com o caminho, nunca erro mudo). A meta e o prazo
 * (editar_quadro) entram em todo turno de tarefa do quadro: são da dona (revisão 1, achado 1). A passagem de uma coluna
 * (definir_passagem: quem pega a tarefa e as instruções da etapa) é das colunas também (revisão 4 do PR #628, achado 3).
 */
const SO_DA_DONA = new Set<OpQuadro["tipo"]>(["editar_quadro", "adicionar_pessoa", "tirar_pessoa", "mudar_modo", "remover_quadro", "mover_quadro", "criar_quadro", "criar_coluna", "renomear_coluna", "mover_coluna", "remover_coluna", "substituir_colunas", "definir_passagem", "criar_label", "editar_label", "remover_label"]);

/**
 * O que a pessoa pode pedir ao quadro neste modo. A dona pede tudo. Quem participa não mexe nas pessoas, no modo, nas
 * colunas nem no quadro inteiro; no "só a dona" (D7) o pedido dela vira comentário numa tarefa.
 */
export function regraDoModo(modo: ModoConversa, papel: Papel, ops: readonly OpQuadro[], donaNome: string): { ok: true } | { ok: false; erro: string } {
  if (papel === "dona") return { ok: true };
  const proibida = ops.find((o) => SO_DA_DONA.has(o.tipo));
  if (proibida) return { ok: false, erro: `${proibida.tipo} é só da ${donaNome}, a dona do quadro: peça a ela, ou deixe um comentário (comentar)` };
  if (modo === "so_dono" && ops.some((o) => o.tipo !== "comentar")) return { ok: false, erro: `Só a ${donaNome} conversa com este quadro. Para pedir algo, comente numa tarefa (comentar {texto, tarefa})` };
  return { ok: true };
}

/**
 * D5: quem decide a pendência de uma tarefa. Quem pediu, se ainda está no quadro (ou é a dona); senão o responsável
 * humano (a tarefa ainda não tem: o responsável é um bot); senão a dona. `saiu` = quem pediu e saiu do quadro.
 */
export function quemDecide(i: { pedidoPor: string | null | undefined; donaId: string; membros: ReadonlySet<string> }): { pessoaId: string; saiu: string | null } {
  const p = i.pedidoPor ?? null;
  if (p === null || p === i.donaId) return { pessoaId: i.donaId, saiu: null };
  if (i.membros.has(p)) return { pessoaId: p, saiu: null };
  return { pessoaId: i.donaId, saiu: p };
}

/** D9: desfaz quem pediu o lote e a dona. O lote sem quem pediu (antes da 0146) é da dona. */
export function podeDesfazer(i: { lotePedidoPor: string | null | undefined; quemPede: string; donaId: string }): boolean {
  if (i.quemPede === i.donaId) return true;
  return (i.lotePedidoPor ?? i.donaId) === i.quemPede;
}

/** "Ana, pela Ada" (pelo bot), "Ana" (pela tela); para quem lê, "Você". */
export function assinatura(i: { pessoaId: string; pessoaNome: string; botNome: string | null; quemLe: string }): string {
  const quem = i.pessoaId === i.quemLe ? "Você" : i.pessoaNome;
  return i.botNome ? `${quem}, pela ${i.botNome}` : quem;
}

/** O lote como o mural o lê (só o que importa para agrupar e assinar). */
export type LoteDoMural = { id: string; pessoaId: string; botId: string | null; resumo: string; codigos: readonly string[]; criadoEm: number; desfeito: boolean };

/** definido em 2026-11-02 (NOD-443): pedidos seguidos da mesma pessoa, pelo mesmo bot, a até 10 min um do outro, viram uma linha. */
export const JANELA_DO_GRUPO_MS = 10 * 60_000;
/** Teto de linhas do mural (as mais recentes). */
export const LINHAS_DO_MURAL = 100;

export type LinhaDoMural = { id: string; pessoaId: string; botId: string | null; resumo: string; codigos: string[]; mudancas: number; criadoEm: number; desfeito: boolean };

/**
 * D1, D8: o mural de Atividade. Só os pedidos que mudaram o quadro (os lotes; o desfeito aparece marcado), mais recente
 * primeiro, agrupados por pessoa e bot. Filtros: a pessoa e a tarefa (pelo código).
 */
export function muralDe(lotes: readonly LoteDoMural[], filtro: { pessoa?: string; tarefa?: string } = {}): LinhaDoMural[] {
  const tarefa = filtro.tarefa?.trim().toUpperCase();
  const ordenados = [...lotes]
    .filter((l) => (!filtro.pessoa || l.pessoaId === filtro.pessoa) && (!tarefa || l.codigos.some((c) => c.toUpperCase() === tarefa)))
    .sort((a, b) => b.criadoEm - a.criadoEm || (a.id < b.id ? 1 : -1));
  const linhas: LinhaDoMural[] = [];
  for (const l of ordenados) {
    const ultima = linhas[linhas.length - 1];
    // O desfeito não se junta a nada: a linha dele diz que voltou.
    if (ultima && !l.desfeito && !ultima.desfeito && ultima.pessoaId === l.pessoaId && ultima.botId === l.botId && ultima.criadoEm - l.criadoEm <= JANELA_DO_GRUPO_MS) {
      ultima.mudancas += 1;
      for (const c of l.codigos) if (!ultima.codigos.includes(c)) ultima.codigos.push(c);
      ultima.resumo = resumoDoGrupo(ultima.codigos, ultima.mudancas, ultima.resumo);
      continue;
    }
    if (linhas.length >= LINHAS_DO_MURAL) break;
    linhas.push({ id: l.id, pessoaId: l.pessoaId, botId: l.botId, resumo: l.resumo, codigos: [...l.codigos], mudancas: 1, criadoEm: l.criadoEm, desfeito: l.desfeito });
  }
  return linhas;
}

/** "3 mudanças: SEC-1, SEC-7 e NOD-612" (o protótipo). Sem códigos, o número só. */
export function resumoDoGrupo(codigos: readonly string[], mudancas: number, primeiro: string): string {
  if (mudancas <= 1) return primeiro;
  if (codigos.length === 0) return `${mudancas} mudanças`;
  const lista = codigos.length === 1 ? codigos[0]! : `${codigos.slice(0, -1).join(", ")} e ${codigos[codigos.length - 1]}`;
  return `${mudancas} mudanças: ${lista}`;
}

/** As novas do mural para quem lê: as linhas de outras pessoas depois da última vez que ela abriu (o contador zera ao abrir). */
export function novasNoMural(linhas: readonly LinhaDoMural[], quemLe: string, vistoEm: number | null): number {
  return linhas.filter((l) => l.pessoaId !== quemLe && (vistoEm === null || l.criadoEm > vistoEm)).length;
}

/** O nome de alguém do time, por id ou nome (sem acento e caixa). Só um pode bater. */
export function acharPessoa<P extends { id: string; nome: string }>(ref: string, pessoas: readonly P[]): P | { erro: string } {
  const r = ref.trim().replace(/^@/, "");
  const porId = pessoas.find((p) => p.id === r);
  if (porId) return porId;
  const chave = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
  const exatos = pessoas.filter((p) => chave(p.nome) === chave(r));
  if (exatos.length === 1) return exatos[0]!;
  const comeco = exatos.length === 0 ? pessoas.filter((p) => chave(p.nome).split(/\s+/)[0] === chave(r)) : exatos;
  if (comeco.length === 1) return comeco[0]!;
  if (comeco.length > 1) return { erro: `mais de uma pessoa chamada "${r}": diga o nome inteiro` };
  return { erro: `ninguém do time se chama "${r}"` };
}
