import type { MotivoFalha, MotivoInterrupcao } from "../contracts/motivos.ts";
import type { OrigemExecucao, VoltaDoTrabalho } from "../contracts/quadro-execucoes.ts";
import type { EsperaDoRun, OrigemDoRun } from "../contracts/quadro-comentarios.ts";
import { classificarFalha, type DesfechoCadeia } from "./quadro-execucoes.ts";

/**
 * O estado verdadeiro do run na tarefa aberta (definido em 2026-11-10, Passo 1 da comparação Multica × nod): o que ele
 * espera, a falha num rótulo curto (a taxonomia do Multica: "Daemon offline", "Provider quota exhausted"…) e como foi
 * acionado. Puro: quem chama lê o desfecho da cadeia, a volta marcada e a tarefa.
 */

const ROTULO_FALHA: Readonly<Partial<Record<MotivoFalha, string>>> = {
  nao_autenticado: "IA sem login na máquina",
  limite_do_plano: "Limite do plano da IA",
  sem_conta: "Nenhuma conta da IA livre",
  erro_max_turns: "Passou do limite de passos",
  erro_execucao: "Erro ao rodar a IA",
  motor_ausente: "Motor da máquina fora",
};
const ROTULO_INTERRUPCAO: Readonly<Partial<Record<MotivoInterrupcao, string>>> = {
  maquina_sem_contato: "Máquina sem contato",
  reinicio_servidor: "O servidor reiniciou",
  reinicio_do_motor: "O motor reiniciou",
  executor_indisponivel: "Nenhuma máquina disponível",
  sem_progresso: "Parou sem progresso",
  turno_travado: "Travou",
  lancamento_falhou: "Não conseguiu começar",
  vencido: "Prazo da plataforma",
  trabalho_incompleto: "Caiu no meio",
  sessao_rejeitada: "Sessão da IA recusada",
  maquina_removida: "Máquina removida",
};

/** O rótulo curto da falha (o erro em frase fica no motivo). */
export function rotuloDaFalha(d: Pick<DesfechoCadeia, "motivoInterrupcao" | "motivoFalha">): string {
  return (d.motivoFalha && ROTULO_FALHA[d.motivoFalha]) || (d.motivoInterrupcao && ROTULO_INTERRUPCAO[d.motivoInterrupcao]) || "Falhou";
}

/** A pessoa precisa agir (login, cota, conta, configuração): repetir daria no mesmo, a tela mostra o erro inline. */
export const precisaDeVoce = (d: Pick<DesfechoCadeia, "motivoInterrupcao" | "motivoFalha" | "parado">): boolean => classificarFalha(d) === "do_agente";

/**
 * O que o run espera, em ordem: a volta marcada (a CI de um PR, a hora, o comando de fundo), a decisão da pessoa (ou a
 * pergunta da tarefa, ADR-162), o pedido a um colega. `texto` é o objeto da espera ("a CI do PR #12", "sua resposta"): a
 * tela compõe "esperando …" e formata a hora de `em` no fuso de quem lê. null = não espera.
 */
export function esperaDoRun(p: {
  volta: (VoltaDoTrabalho & { turnoId?: string | null }) | null;
  aguardaPessoa: boolean;
  aguardaColega: boolean;
  /** A tarefa espera a pessoa (ADR-162) e este run é do responsável. */
  tarefaEsperaPessoa: boolean;
}): EsperaDoRun | null {
  const v = p.volta;
  const pr = v?.prUrl ? /\/pull\/(\d+)/.exec(v.prUrl)?.[1] ?? null : null;
  if (v?.quando === "ci") return { tipo: "ci", texto: pr ? `a CI do PR #${pr}` : "a CI", em: v.em, prUrl: v.prUrl, podeAcordar: !!v.turnoId };
  if (v && v.em !== null) return { tipo: "hora", texto: v.motivo ? v.motivo.slice(0, 160) : "a hora marcada", em: v.em, prUrl: v.prUrl, podeAcordar: !!v.turnoId };
  if (v) return { tipo: "outro", texto: v.motivo ? v.motivo.slice(0, 160) : "um comando terminar", em: null, prUrl: v.prUrl, podeAcordar: false };
  if (p.aguardaPessoa || p.tarefaEsperaPessoa) return { tipo: "pessoa", texto: "sua resposta", em: null, prUrl: null, podeAcordar: false };
  if (p.aguardaColega) return { tipo: "colega", texto: "a resposta de um colega", em: null, prUrl: null, podeAcordar: false };
  return null;
}

/**
 * Como o run foi acionado: o trabalho da tarefa pela origem gravada (a passagem é o início numa coluna com responsável
 * que trocou de mão: ADR-142); o turno que só um comentário abriu, "comentario".
 */
export function origemDoRun(origem: OrigemExecucao | null, passagem: boolean): OrigemDoRun {
  if (origem === null) return "comentario";
  if (origem === "inicio" && passagem) return "passagem";
  return origem;
}
