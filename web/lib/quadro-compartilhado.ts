import type { LinhaMuralDto, QuadroDto, TarefaDto } from "../../src/contracts/quadro.ts";
import type { FrameSse } from "../../src/contracts/frame.ts";
import { ErroApi } from "./erro-api.ts";

/**
 * NOD-455 (ADR-143): o que a participante pode fazer no quadro da dona. Puro e espelho do servidor, que é quem decide
 * (regraDoModo, pendenciaAlheia, tarefaDeOutraPessoa e podeDesfazer em src/domain/quadro-pessoas.ts e
 * src/use-cases/quadro.ts): a tela só não mostra o que o servidor recusaria. O que é só da dona (pessoas, modo, colunas,
 * meta, PR, aviso do GitHub) nunca entra aqui: a tela não tem nem o botão.
 */

/** A dona vê o quadro dela pela aba Quadro; aqui, o papel vem do servidor (`voce`). Sem `voce`, nada se faz. */
export function ehDona(q: QuadroDto): boolean {
  return q.voce?.papel === "dona";
}

/** No modo "só a dona" (D7), quem participa só comenta: não cria, não muda status, não responde, não desfaz. */
export function soComenta(q: QuadroDto): boolean {
  return !q.voce || (!ehDona(q) && q.modoConversa === "so_dono");
}

/** A tarefa é de quem lê (ela pediu). A tarefa sem quem pediu é lida como da dona. */
export function ehMinha(q: QuadroDto, t: TarefaDto): boolean {
  if (!q.voce) return false;
  return ehDona(q) || (t.pedidoPor ?? q.dona?.pessoaId ?? null) === q.voce.pessoaId;
}

/** Muda o status de qualquer tarefa; a que espera alguém ("Com você") só sai pela mão de quem decide. */
export function podeMudarStatus(q: QuadroDto, t: TarefaDto): boolean {
  if (soComenta(q)) return false;
  if (t.esperaPessoa && !ehDona(q)) return t.decide?.voce === true;
  return true;
}

/** Edita (título, descrição) e exclui só a tarefa que ela pediu. */
export function podeEditar(q: QuadroDto, t: TarefaDto): boolean {
  return !soComenta(q) && ehMinha(q, t);
}

/** Responde só quando é ela quem decide. */
export function podeResponder(q: QuadroDto, t: TarefaDto): boolean {
  return !soComenta(q) && t.esperaPessoa === true && (ehDona(q) || t.decide?.voce === true);
}

/** Pede tarefa nova ao quadro (no "só a dona", o campo vira recado). */
export function podePedir(q: QuadroDto): boolean {
  return !soComenta(q);
}

/** Desfaz só o lote que ela pediu (o servidor manda `podeDesfazer` já pensando nisso). */
export function podeDesfazer(q: QuadroDto): boolean {
  return !soComenta(q) && q.voce?.podeDesfazer === true && q.ultimoLote !== null && q.ultimoLote.desfeitoEm === null;
}

/** O nome da dona ("a dona" quando o servidor não mandou). */
export function nomeDaDona(q: QuadroDto): string {
  return q.dona?.nome ?? "dona";
}

/** O nome de quem pediu a tarefa (para "Tarefa da <X>"): a dona, ou quem participa. */
export function donoDaTarefa(q: QuadroDto, t: TarefaDto): string {
  const p = t.pedidoPor ?? q.dona?.pessoaId ?? null;
  if (p === null || p === q.dona?.pessoaId) return nomeDaDona(q);
  if (p === q.voce?.pessoaId) return "você";
  // Quem pediu e saiu do quadro não está em membros: o servidor ainda manda o nome dela.
  return q.membros?.find((m) => m.pessoaId === p)?.nome ?? (t.pedidoPorNome && t.pedidoPorNome !== "você" ? t.pedidoPorNome : "outra pessoa");
}

/**
 * A assinatura do card ("Ana, pela Ada", "Você", "Marlon, pela Lia"): a da linha mais recente do mural que tocou a
 * tarefa (o servidor a monta com `assinatura()`, com o bot daquele pedido). Sem mural, só quem pediu, sem inventar bot.
 */
export function assinaturaDoCard(t: TarefaDto, mural: readonly LinhaMuralDto[] | null): string | null {
  let melhor: LinhaMuralDto | null = null;
  for (const l of mural ?? []) if (!l.desfeito && l.codigos.includes(t.codigo) && (!melhor || l.criadoEm > melhor.criadoEm)) melhor = l;
  if (melhor) return melhor.assinatura;
  if (!t.pedidoPorNome) return null;
  return t.pedidoPorNome === "você" ? "Você" : t.pedidoPorNome;
}

/** A linha que explica a tarefa de outra pessoa (nenhuma na dela). */
export function linhaDaTarefaAlheia(q: QuadroDto, t: TarefaDto): string | null {
  if (ehMinha(q, t)) return null;
  // A que espera outra pessoa decidir também não tem o select: a frase diz só o que a tela deixa fazer.
  return podeMudarStatus(q, t) ? `Tarefa da ${donoDaTarefa(q, t)}: você muda o status e comenta` : `Tarefa da ${donoDaTarefa(q, t)}: você comenta`;
}

/** O campo de baixo: pedir tarefa, ou (só a dona) deixar recado, que vira comentário. */
export function campoDePedir(q: QuadroDto): { tipo: "pedir" | "recado"; placeholder: string; botao: string } {
  return soComenta(q)
    ? { tipo: "recado", placeholder: `Deixar recado para ${nomeDaDona(q)}`, botao: "Deixar recado" }
    : { tipo: "pedir", placeholder: `Pedir algo ao quadro do ${nomeDaDona(q)}`, botao: "Pedir" };
}

/** O vazio (sem tarefas). */
export function textoDoVazio(q: QuadroDto): string {
  return soComenta(q) ? `Nada no quadro do ${nomeDaDona(q)} ainda. Deixe um recado.` : `Nada no quadro do ${nomeDaDona(q)} ainda. Peça algo aqui embaixo.`;
}

/** O rótulo curto do modo, no celular ("Só a <dona>"); null no individual. */
export function rotuloCurtoDoModo(q: { modo: string; donaNome: string }): string | null {
  return q.modo === "so_dono" ? `Só a ${q.donaNome}` : null;
}

/**
 * O erro ao abrir: quem não participa (ou o quadro que sumiu, ou o experimento da dona desligado) recebe 404/403 e vê
 * "sem acesso" sem nome nenhum; o resto (rede, 500) é o erro com "Tentar de novo".
 */
export function estadoDoErro(e: unknown): "fora" | "erro" {
  if (e instanceof ErroApi && (e.status === 404 || e.status === 403 || e.codigo === "nao_encontrado" || e.codigo === "nao_permitido")) return "fora";
  return "erro";
}

/** A recusa de uma ação (o servidor disse não): a frase da tela. */
export function textoDaRecusa(acao: "excluir" | "editar" | "status" | "responder" | "desfazer" | "pedir" | "comentar", dono: string | null): string {
  // Sem o dono novo, o servidor não diz o motivo (ADR-002): a frase é neutra, não chuta "o quadro mudou".
  if (acao === "excluir") return dono ? `Não excluí: agora é da ${dono}` : "Não deu para excluir agora";
  if (acao === "editar") return dono ? `Não mudei: agora é da ${dono}` : "Não deu para salvar agora";
  if (acao === "status") return "Não deu para mudar o status agora";
  if (acao === "responder") return "Não deu para responder agora";
  if (acao === "desfazer") return "Não deu para desfazer agora";
  if (acao === "pedir") return "Não deu para pedir agora";
  return "Não deu para comentar agora";
}

/** O frame do SSE é deste quadro (relê a tela). */
export function deveRecarregar(frame: FrameSse, qid: string): boolean {
  return frame.tipo === "quadro.mudou" && frame.dados["quadroId"] === qid;
}

/**
 * NOD-455 (revisão 3): a barra relê "Compartilhados com você" só quando a lista pode ter mudado: um quadro alheio que
 * ela ainda não lista (entrou agora), o quadro removido, ou um lote que não tocou tarefa (pessoas, modo, meta). O
 * trabalho dos bots da dona (lotes com tarefas) não muda a lista e não custa uma leitura de todas as portas.
 */
export function releListaDosCompartilhados(frame: FrameSse, listados: readonly string[]): boolean {
  if (frame.tipo !== "quadro.mudou") return false;
  const qid = frame.dados["quadroId"];
  if (typeof qid !== "string") return false;
  if (!listados.includes(qid) || frame.dados["removido"] === true) return true;
  const tarefas = frame.dados["tarefas"];
  return typeof tarefas !== "string" || tarefas === "";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O link direto: /quadros/<uuid> (no recarregar e no celular). Outro caminho, null. */
export function quadroDaUrl(pathname: string): string | null {
  const m = /^\/quadros\/([^/]+)\/?$/.exec(pathname);
  return m && UUID.test(m[1]!) ? m[1]!.toLowerCase() : null;
}

export function caminhoDoQuadro(qid: string): string {
  return `/quadros/${encodeURIComponent(qid)}`;
}
