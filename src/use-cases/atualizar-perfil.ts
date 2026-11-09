import type { PayloadPropostaPerfil, PayloadPropostaRotina } from "../contracts/conversa.ts";
import type { Turno } from "../contracts/turno.ts";
import { semCitacao } from "../domain/citacao.ts";
import { ehErroDeDominio, ErroDeDominio } from "../domain/erro.ts";
import { emReconfiguracao } from "../domain/reconfiguracao.ts";
import { podeCriarRotina } from "../domain/rotina-limites.ts";
import { revisaoAtualDoPerfil } from "./confirmar-perfil.ts";
import { autoriaAgente, evento } from "./autoria-evento.ts";
import { prepararRotina } from "./criar-rotina.ts";
import type { UseCasesNod } from "./tipos.ts";

function opcional(v: unknown): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "string" || v.trim() === "") throw new ErroDeDominio("entrada_invalida", { cause: "campo de perfil" });
  return v.trim();
}

const depoisOuIgual = (turno: Turno, inicio: Turno) => turno.criadoEm > inicio.criadoEm || (turno.criadoEm === inicio.criadoEm && turno.id >= inicio.id);

/** NOD-23: o prompt guia a entrevista; esta catraca impede o modelo de pular o resumo/"Certo?" ou exceder 4 perguntas. */
async function validarRoteiroDaReconfiguracao(deps: Parameters<UseCasesNod["atualizarPerfil"]>[0], agenteId: string, conversaId: string, turnoId: string): Promise<void> {
  const agente = await deps.repos.agentes.buscar(agenteId);
  if (!agente) throw new ErroDeDominio("nao_encontrado");
  // Bot ainda em criação usa a mesma ferramenta sem a entrevista da NOD-23. Num bot confirmado, plano antigo falha
  // fechado depois de 2 h, confirmação ou recusa — a presença da ferramenta no plano não é autorização duradoura.
  if (!agente.confirmado) return;
  if (!agente.configurandoTurnoId || !emReconfiguracao(agente, deps.agora())) throw new ErroDeDominio("estado_invalido", { cause: "reconfiguracao encerrada" });
  const [inicio, atual] = await Promise.all([deps.repos.turnos.buscar(agente.configurandoTurnoId), deps.repos.turnos.buscar(turnoId)]);
  if (!inicio || !atual || inicio.agenteId !== agenteId || atual.agenteId !== agenteId || inicio.conversaId !== conversaId || atual.conversaId !== conversaId || !depoisOuIgual(atual, inicio)) {
    throw new ErroDeDominio("estado_invalido", { cause: "proposta fora da reconfiguracao" });
  }
  const mensagens = await deps.repos.mensagens.listarDaConversa(conversaId, 200);
  const comTurno = await Promise.all(mensagens.map(async (m) => ({
    mensagem: m,
    turno: m.turnoId ? await deps.repos.turnos.buscar(m.turnoId)
      : m.autoria.autor_tipo === "pessoa" ? await deps.repos.turnos.buscarPorMensagemOrigem(m.id) : null,
  })));
  const relevantes = comTurno.filter(({ mensagem, turno }) => mensagem.kind === "texto" && turno?.origem === "conversa" && !turno.trabalhoId && depoisOuIgual(turno, inicio)).map(({ mensagem }) => mensagem);
  // A confirmação pode ter sido absorvida pela sessão viva: a fala da pessoa conserva o turno próprio (posterior),
  // enquanto o modelo chama a ferramenta no turno vivo original. A ordem das mensagens é a verdade desta troca.
  let ultimaPessoa = -1;
  for (let i = 0; i < relevantes.length; i++) if (relevantes[i]!.autoria.autor_tipo === "pessoa" && relevantes[i]!.autoria.autor_id === deps.escopo.pessoaId) ultimaPessoa = i;
  const textoConfirmacao = ultimaPessoa >= 0 ? semCitacao(relevantes[ultimaPessoa]!.texto).trim() : "";
  const afirmou = /^(?:sim|certo|isso|pode|confirmo|correto|ok|yes|perfeito|beleza|(?:ficou|est[aá]|t[aá])\s+(?:ótimo|otimo|certo|correto)|manda\s+ver|segue)\b/iu.test(textoConfirmacao);
  const negou = /\b(?:n[aã]o|nunca|recuso|cancela|cancelar)\b/iu.test(textoConfirmacao);
  const confirmou = afirmou && !negou;
  const falas = relevantes.slice(0, ultimaPessoa).filter((m) => m.autoria.autor_tipo === "agente" && m.autoria.autor_id === agenteId);
  const resumo = falas.at(-1);
  const perguntas = falas.slice(0, -1).filter((m) => m.texto.includes("?"));
  const umaPorFala = perguntas.every((m) => (m.texto.match(/\?/g) ?? []).length === 1);
  const resumoValido = resumo && /\bcerto\s*\?/iu.test(resumo.texto) && (resumo.texto.match(/\?/g) ?? []).length === 1;
  if (perguntas.length > 4 || !umaPorFala || !resumoValido || !confirmou) throw new ErroDeDominio("estado_invalido", { cause: `roteiro da reconfiguracao incompleto: perguntas=${perguntas.length}, uma=${umaPorFala}, resumo=${Boolean(resumoValido)}, confirmou=${confirmou}` });
}

/**
 * Ferramenta nod `atualizar_perfil` (EMENDA 5, E1.1): o modelo PROPÕE nome/título/descrição; nada
 * muda no agente antes de confirmarProposta pela pessoa. Vira Proposta kind 'perfil' + evento
 * proposta_criada (a web renderiza o cartão a partir da Proposta, nunca do texto).
 *
 * definido em 2026-09-28 (ADR-050): `rotinas` traz as tarefas recorrentes da missão junto com o perfil.
 * Cada uma passa pela MESMA validação de criar_rotina e vira proposta 'rotina' SEM decisão em "Sua vez":
 * o card do perfil é o único lugar onde ela se confirma. Uma rotina recusada pelo domínio devolve o erro
 * tipado com o índice e nada é criado — o modelo corrige e chama de novo.
 */
export const atualizarPerfil: UseCasesNod["atualizarPerfil"] = async (deps, input) => {
  await validarRoteiroDaReconfiguracao(deps, input.agenteId, input.conversaId, input.turnoId);
  const payload: PayloadPropostaPerfil = { kind: "perfil", turnoId: input.turnoId };
  const nome = opcional(input.nome);
  const titulo = opcional(input.titulo);
  const descricao = opcional(input.descricao);
  if (nome !== undefined) payload.nome = nome;
  if (titulo !== undefined) payload.titulo = titulo;
  if (descricao !== undefined) payload.descricao = descricao;
  if (nome === undefined && titulo === undefined && descricao === undefined) throw new ErroDeDominio("entrada_invalida", { cause: "proposta vazia" });

  const rotinas: PayloadPropostaRotina[] = [];
  try {
    for (const r of input.rotinas ?? []) rotinas.push(await prepararRotina(deps, input.agenteId, r));
    // prepararRotina confere o teto de 50 uma a uma; o lote inteiro também precisa caber.
    if (rotinas.length > 0 && !podeCriarRotina((await deps.repos.rotinas.contarDoAgente(input.agenteId)) + rotinas.length - 1)) {
      throw new ErroDeDominio("limite_atingido", { cause: "rotinas por agente" });
    }
  } catch (e) {
    if (ehErroDeDominio(e)) return { data: { erro: e.codigo, rotina: rotinas.length } };
    throw e;
  }

  const ids: string[] = [];
  for (const r of rotinas) {
    const criada = await deps.repos.propostas.criar({ conversaId: input.conversaId, agenteId: input.agenteId, payload: r });
    if (!criada) throw new ErroDeDominio("nao_permitido");
    ids.push(criada.id);
  }
  if (ids.length > 0) payload.rotinas = ids;

  // NOD-190: a revisão do perfil de agora vai no payload; a confirmação só aplica se ele ainda for este.
  const agente = await deps.repos.agentes.buscar(input.agenteId);
  if (agente) payload.revisao = revisaoAtualDoPerfil(agente);

  const proposta = await deps.repos.propostas.criar({ conversaId: input.conversaId, agenteId: input.agenteId, payload });
  if (!proposta) throw new ErroDeDominio("nao_permitido");
  const agora = deps.agora();
  const autoria = autoriaAgente({ agenteId: input.agenteId, contaDeExecucao: deps.escopo.pessoaId, executor: "catcher" });
  return {
    data: { proposta_id: proposta.id, rotinas: rotinas.map((r) => ({ resumo: r.resumo })) },
    events: [evento(deps.escopo, { kind: "proposta_criada", autoria, agora, conversaId: input.conversaId, turnoId: input.turnoId, dados: { proposta_id: proposta.id, kind: "perfil", agente_id: input.agenteId, rotinas: ids.length } })],
  };
};
