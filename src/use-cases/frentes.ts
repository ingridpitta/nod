import type { RuntimeEvent } from "../contracts/evento.ts";
import type { FrentePedida } from "../contracts/ferramentas-frente.ts";
import type { CasoNod, ContextoFerramenta } from "../contracts/servicos.ts";
import type { Trabalho } from "../contracts/trabalho.ts";
import type { Turno } from "../contracts/turno.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { conversaDepoisDoFim } from "../domain/fala-na-frente.ts";
import { ehFrente, entradaDaFrente, instrucaoDoResumoInvalido, textoFrentesAbertas, tituloDoLote } from "../domain/frente.ts";
import { validarResumo } from "../domain/resumo-da-frente.ts";
import { podeAbrirTask, TETO_TASKS_POR_EXECUCAO_DE_ROTINA, tituloOuNada, trabalhoAberto } from "../domain/trabalho.ts";
import { ehUuid } from "./apoio-l7.ts";
import { origemDasFrentes } from "./pedido-de-colega.ts";
import { autoriaAgente, evento, PRAZO_DECISAO_PADRAO_MS } from "./autoria-evento.ts";
import { conversaDoBot, enfileirarNoTrabalho } from "./coordenar-trabalhos.ts";
import type { Deps } from "./tipos.ts";
import { criarTrabalho } from "./trabalhos.ts";
import { repoDoGithub } from "../domain/clone-da-maquina.ts";
import { codigoDaTarefa } from "../domain/codigo-tarefa.ts";
import { tarefaCasaLigada } from "../shared/tarefa-casa.ts";

/** ADA-28: a tarefa do turno que abre as frentes, com o código (null fora de tarefa). */
async function tarefaDaFrente(deps: Deps, turnoId: string): Promise<{ id: string; codigo: string } | null> {
  const id = await deps.repos.quadros.tarefaDoTurno(turnoId);
  const t = id ? await deps.repos.quadros.tarefa(id) : null;
  const q = t ? await deps.repos.quadros.buscar(t.quadroId) : null;
  return t && q ? { id: t.id, codigo: codigoDaTarefa(q.prefixo, t) } : null;
}

/** A linha que diz à frente de quem ela é. Sem o título: ele pode ser texto de fora (ADR-047); o código basta. */
export function linhaDaTarefaNaFrente(t: { codigo: string }): string {
  return `Esta frente é da tarefa ${t.codigo} do quadro: use gerir_quadro terminei e mudar_tarefa pr_url nela (sem passar a tarefa, vale a sua).`;
}

/**
 * As frentes (definido em 2026-10-12, ADR-099, partes 3/4, issue I2): o dono abre um lote por pedido, com N frentes que
 * rodam à parte (sessão e pasta próprias, como as tasks de hoje), repassa recados a elas e cada uma devolve um resumo
 * curto. O retorno do lote ao dono (uma retomada quando a última frente termina, ou a resposta direto ao colega que
 * pediu) mora em fechar-lote.ts (I3).
 */

type Recusa = { ok: false; erro: "nao_abre" | "sem_frentes" | "teto_de_tasks" | "depois_de_invalido"; instrucao: string };
type Aberto = { ok: true; loteId: string; trabalhos: Trabalho[]; events: RuntimeEvent[] };

const NAO_ABRE = "Você já está numa frente, e uma frente não abre outra (só a rotina abre, um nível). Faça este trabalho aqui mesmo.";

/**
 * Um pedido, um lote (decisão 6 da ADR-099): cria o lote (`aberto_por_turno_id` = o turno do dono), as N frentes ligadas
 * a ele e o primeiro turno de cada uma, e grava UMA linha "Começou N frentes" na conversa do dono. Sem teto por pedido
 * (decisão 1: o limite é a capacidade da máquina); a execução de rotina continua com o teto dela. A frente, a task de
 * colega, da pessoa ou da rede não abre (o catálogo já tira a ferramenta; isto é a 2ª camada).
 */
async function abrirLote(deps: Deps, ctx: ContextoFerramenta, frentes: readonly FrentePedida[], p: { avisarACadaUma: boolean; depoisDe?: string; tituloDoLote?: string }): Promise<Aberto | Recusa> {
  const turno = await deps.repos.turnos.buscar(ctx.turnoId);
  if (!turno || turno.agenteId !== ctx.agenteId) throw new ErroDeDominio("nao_permitido", { cause: "turno de outro bot" });
  const atual = turno.trabalhoId ? await deps.repos.trabalhos.buscar(turno.trabalhoId) : null;
  if (!podeAbrirTask(atual)) return { ok: false, erro: "nao_abre", instrucao: NAO_ABRE };
  if (frentes.length === 0) return { ok: false, erro: "sem_frentes", instrucao: "Mande ao menos uma frente, com título e pedido." };
  // Revisão do épico (S8, 2026-10-08): o id vem do modelo; fora de uuid é só "não achei", nunca 22P02.
  const depoisDe = p.depoisDe && ehUuid(p.depoisDe) ? await deps.repos.trabalhos.buscar(p.depoisDe) : null;
  if (p.depoisDe && (!depoisDe || depoisDe.agenteId !== turno.agenteId || !trabalhoAberto(depoisDe.estado))) {
    return { ok: false, erro: "depois_de_invalido", instrucao: "depois_de precisa ser o id de uma task sua ainda aberta, como veio em \"Trabalhos em andamento\". Abra sem depois_de ou corrija o id." };
  }
  const deRotina = atual?.origem === "rotina";
  // revisto em 2026-10-12 (ADR-099, I7 revista): fora de trabalho, o turno do dono pode ser a triagem de um pedido de
  // colega ou de uma rotina — as frentes herdam a origem do pedido (ADR-085), e as de colega levam quem pediu.
  const de = atual ? null : await origemDasFrentes(deps, turno);
  // Revisão do épico (S12, 2026-10-08): a execução da rotina abre até TETO_TASKS_POR_EXECUCAO_DE_ROTINA, somando o lote.
  if (deRotina) {
    const ja = (await deps.repos.trabalhos.filhos(atual.id)).length;
    if (ja + frentes.length > TETO_TASKS_POR_EXECUCAO_DE_ROTINA) {
      const resta = Math.max(0, TETO_TASKS_POR_EXECUCAO_DE_ROTINA - ja);
      return { ok: false, erro: "teto_de_tasks", instrucao: `Esta execução da rotina abre no máximo ${TETO_TASKS_POR_EXECUCAO_DE_ROTINA} frentes e já abriu ${ja}${resta > 0 ? `: abra até ${resta} de uma vez` : ""}. Faça o que faltar aqui mesmo, ou deixe para a próxima execução e diga isso no resultado.` };
    }
  }
  const agente = await deps.repos.agentes.buscar(turno.agenteId);
  const conversaId = await conversaDoBot(deps, turno);
  // ADA-28 (ADR-159, escopo B): a frente aberta num turno de tarefa é da tarefa — o `terminei` e o `pr_url` dela valem
  // para a tarefa (tarefaDoTurno sobe pela frente). A frente de rotina (com mãe) não muda.
  const daTarefa = tarefaCasaLigada() && !deRotina ? await tarefaDaFrente(deps, turno.id) : null;
  // Plano chat limpo (PR 5, 2026-10-18): o `titulo_do_lote` passa pela regra do título (primeira linha, até 80, com letra);
  // vazio ou sem letra vira null, e a tela cai no título da frente ou em "N frentes".
  const titulo = p.tituloDoLote === undefined ? null : tituloOuNada(p.tituloDoLote);
  const lote = await deps.repos.frentes.criarLote({ agenteId: turno.agenteId, abertoPorTurnoId: turno.id, trabalhoId: deRotina ? atual.id : null, avisarACadaUma: p.avisarACadaUma, titulo });
  if (!lote) throw new ErroDeDominio("estado_invalido", { cause: "lote de frentes não criado" });
  const agora = deps.agora();
  // A marca de quem leu algo de fora (ADR-062) atravessa para cada frente, como no pedido a colega.
  const deFora = turno.entradaConfianca !== "confiavel" || (await deps.repos.turnos.contaminado(turno.id));
  const autoria = autoriaAgente({ agenteId: turno.agenteId, contaDeExecucao: deps.escopo.pessoaId, executor: "catcher" });
  // ADA-232: a frente aberta por um trabalho do quadro guarda a tarefa — o card a conta como trabalhando.
  const raiz = await deps.repos.turnos.raizDaCadeia(turno.id);
  const execucao = raiz ? await deps.repos.quadroExecucoes.doTurnoRaiz(raiz.id) : null;
  const tarefaId = execucao && execucao.canceladaEm === null ? execucao.tarefaId : null;
  const events: RuntimeEvent[] = [];
  const trabalhos: Trabalho[] = [];
  for (const f of frentes) {
    const { trabalho, events: criados } = await criarTrabalho(deps, {
      agenteId: turno.agenteId,
      conversaId,
      titulo: f.titulo,
      origem: deRotina ? "rotina" : (de?.origem ?? "pessoa"),
      rotinaId: atual?.rotinaId ?? de?.rotinaId ?? null,
      trabalhoMaeId: deRotina ? atual.id : null,
      depoisDeTrabalhoId: depoisDe?.id ?? null,
      pedidoPorAgenteId: de?.pedidoPorAgenteId ?? null,
      pessoaEsperando: de?.pessoaEsperando ?? false,
      forma: "frente",
      loteId: lote.id,
      // NOD-315 (ADR-119): o repo validado vai para o executor preparar o clone da máquina; inválido = como antes.
      repo: repoDoGithub(f.repo ?? ""),
      tarefaId: tarefaId ?? daTarefa?.id ?? null,
    });
    events.push(...criados);
    const novo = await deps.repos.turnos.enfileirar({
      conversaId,
      agenteId: turno.agenteId,
      origem: deRotina ? "rotina" : (de?.turnoOrigem ?? "conversa"),
      trabalhoId: trabalho.id,
      prazoEm: agora + PRAZO_DECISAO_PADRAO_MS,
      profundidade: turno.profundidade,
      entradaTexto: [entradaDaFrente({ titulo: trabalho.titulo, pedido: f.pedido, deRotina: deRotina || de?.origem === "rotina", pedidoDe: de?.pedidoPorNome ?? null, repo: f.repo, branchBase: f.branch_base, podeEmpurrar: f.pode_empurrar }), ...(daTarefa ? [linhaDaTarefaNaFrente(daTarefa)] : [])].join("\n\n"),
      // NOD-285 (2026-10-15): o arquivo que a pessoa anexou ao pedido vai junto para cada frente, que é quem faz o trabalho.
      entradaAnexos: turno.entradaAnexos,
      entradaConfianca: turno.entradaConfianca,
      sobProcuracaoDe: turno.sobProcuracaoDe ?? null,
      modelo: agente?.modelo ?? turno.modelo,
      harness: agente?.harness ?? turno.harness,
      // NOD-206: a frente roda onde roda quem a abriu; o plano grava o executor real.
      executor: turno.executor,
      // NOD-272: a frente do "Testar agora" herda a pessoa olhando (a cota não a segura, como o turno que a abriu).
      pessoaEsperando: turno.pessoaEsperando === true,
    });
    if (!novo) throw new ErroDeDominio("estado_invalido", { cause: "turno da frente não criado" });
    if (deFora) await deps.repos.turnos.contaminar(novo.id, agora);
    events.push(evento(deps.escopo, { kind: "turno_criado", autoria, agora, conversaId, turnoId: novo.id, dados: { origem: novo.origem, agente_id: turno.agenteId, trabalhoId: trabalho.id } }));
    trabalhos.push(trabalho);
  }
  events.push(...(await linhaFrentesAbertas(deps, { turno, conversaId, loteId: lote.id, tituloDoLote: tituloDoLote(lote.titulo, trabalhos.length, trabalhos[0]?.titulo ?? ""), trabalhos })));
  return { ok: true, loteId: lote.id, trabalhos, events };
}

/** A linha única do lote na conversa do dono (mensagem `sistema`, payload `frentes_abertas`), no lugar de uma por frente. */
async function linhaFrentesAbertas(deps: Deps, p: { turno: Turno; conversaId: string; loteId: string; tituloDoLote: string; trabalhos: readonly Trabalho[] }): Promise<RuntimeEvent[]> {
  const autoria = autoriaAgente({ agenteId: p.turno.agenteId, contaDeExecucao: deps.escopo.pessoaId, executor: "catcher", decididoPor: "regra:trabalhos" });
  const m = await deps.repos.mensagens.criar({
    conversaId: p.conversaId,
    turnoId: p.turno.id,
    autoria,
    kind: "sistema",
    texto: textoFrentesAbertas(p.trabalhos.map((t) => t.titulo)),
    payload: { kind: "frentes_abertas", loteId: p.loteId, origem: p.trabalhos[0]?.origem ?? "pessoa", frentes: p.trabalhos.map((t) => ({ trabalhoId: t.id, titulo: t.titulo })), tituloDoLote: p.tituloDoLote },
    confianca: "confiavel",
  });
  return m ? [evento(deps.escopo, { kind: "mensagem_criada", autoria, agora: deps.agora(), conversaId: p.conversaId, turnoId: p.turno.id, dados: { mensagem_id: m.id, kind: "sistema", lote_id: p.loteId } })] : [];
}

const lista = (ts: readonly Trabalho[]): string => ts.map((t) => `"${t.titulo}"`).join(", ");

/** Ferramenta `abrir_frentes` (I2): um lote para o pedido, N frentes. */
export const abrirFrentes: CasoNod<Deps, "abrir_frentes"> = async (deps, input) => {
  const r = await abrirLote(deps, input, input.frentes ?? [], { avisarACadaUma: input.avisar_a_cada_uma === true, tituloDoLote: input.titulo_do_lote });
  if (!r.ok) return { data: { ok: false, erro: r.erro === "nao_abre" ? "nao_abre_frente" : r.erro === "teto_de_tasks" ? "teto_de_tasks" : "sem_frentes", instrucao: r.instrucao } };
  const quais = r.trabalhos.length === 1 ? `Começou a frente ${lista(r.trabalhos)}` : `Começou ${r.trabalhos.length} frentes para este pedido: ${lista(r.trabalhos)}`;
  return {
    data: { ok: true, lote_id: r.loteId, frentes: r.trabalhos.map((t) => ({ trabalho_id: t.id, titulo: t.titulo })), instrucao: `${quais}. Diga em uma frase o que começou e siga; o resultado e as perguntas das frentes chegam aqui.` },
    events: r.events,
  };
};

/** `abrir_task`, sinônimo mantido (I2) para os turnos e prompts de antes: um lote de uma frente, com o `depois_de` de antes. */
export const abrirTask: CasoNod<Deps, "abrir_task"> = async (deps, input) => {
  const r = await abrirLote(deps, input, [{ titulo: input.titulo, pedido: input.pedido }], { avisarACadaUma: false, depoisDe: input.depois_de });
  if (!r.ok) return { data: { ok: false, erro: r.erro === "nao_abre" || r.erro === "sem_frentes" ? "nao_abre_task" : r.erro, instrucao: r.instrucao } };
  const [t] = r.trabalhos;
  const espera = t?.depoisDeTrabalhoId ? " Ela começa quando a outra terminar." : "";
  return { data: { ok: true, trabalho_id: t!.id, instrucao: `Começou a frente "${t!.titulo}".${espera} Diga em uma frase que começou e siga com a pessoa; o resultado e as perguntas chegam aqui.` }, events: r.events };
};

/**
 * Ferramenta `mandar_para_frente` (e o sinônimo `mandar_para_task`): só o dono repassa (a frente não manda recado a
 * outra). O recado entra na faixa da frente como antes e ganha uma cópia, como linha, na conversa do dono (a fala do
 * recado vai para a tela da frente; sem a cópia, a conversa não mostrava o que foi repassado).
 */
export const mandarParaFrente: CasoNod<Deps, "mandar_para_frente"> = async (deps, input) => {
  const turno = await deps.repos.turnos.buscar(input.turnoId);
  if (!turno || turno.agenteId !== input.agenteId) throw new ErroDeDominio("nao_permitido", { cause: "turno de outro bot" });
  if (turno.trabalhoId) return { data: { ok: false, erro: "nao_repassa", instrucao: "Uma frente não manda recado a outra. Termine a sua e diga o que falta no resumo." } };
  const t = ehUuid(input.trabalho_id) ? await deps.repos.trabalhos.buscar(input.trabalho_id) : null;
  if (!t || t.agenteId !== turno.agenteId) return { data: { ok: false, erro: "task_nao_encontrada", instrucao: "Esse id não é de uma frente sua. Use o id de \"Trabalhos em andamento\"." } };
  // Revisão do épico (S7, 2026-10-08): o recado não reabre o que a pessoa parou ou o que já acabou.
  if (!trabalhoAberto(t.estado)) return { data: { ok: false, erro: "task_fechada", instrucao: `"${t.titulo}" já ${t.estado === "parado" ? "foi parada pela pessoa" : "acabou"}: o recado não entra nela. Se precisa continuar, abra outra frente com abrir_frentes ou faça aqui.` } };
  const rodando = (await deps.repos.turnos.doTrabalho(t.id)).some((x) => x.estado === "despachando");
  const texto = input.texto.trim();
  const r = await enfileirarNoTrabalho(deps, t, { texto, entrada: `[nod] Recado da conversa com a pessoa, repassado por você: ${texto}`, deQuem: { agenteId: turno.agenteId, turno } });
  const events = [...r.events, ...(await copiaDoRecado(deps, { turno, trabalho: t, texto }))];
  return { data: { ok: true, entrou: rodando ? "no_meio" : "na_fila", instrucao: rodando ? "O recado entra na frente no meio do trabalho dela." : "O recado vira o próximo passo da frente." }, events };
};

export const mandarParaTask: CasoNod<Deps, "mandar_para_task"> = (deps, input) => mandarParaFrente(deps, input);

/** A cópia do recado na conversa do dono (payload `recado_a_frente`), com a marca do recado: veio do bot, não da pessoa. */
async function copiaDoRecado(deps: Deps, p: { turno: Turno; trabalho: Trabalho; texto: string }): Promise<RuntimeEvent[]> {
  const conversaId = await conversaDoBot(deps, p.turno);
  const autoria = autoriaAgente({ agenteId: p.turno.agenteId, contaDeExecucao: deps.escopo.pessoaId, executor: "catcher" });
  const m = await deps.repos.mensagens.criar({ conversaId, turnoId: p.turno.id, autoria, kind: "sistema", texto: `Recado para a frente ${p.trabalho.titulo}: ${p.texto}`, payload: { kind: "recado_a_frente", trabalhoId: p.trabalho.id, titulo: p.trabalho.titulo }, confianca: "nao_confiavel" });
  return m ? [evento(deps.escopo, { kind: "mensagem_criada", autoria, agora: deps.agora(), conversaId, turnoId: p.turno.id, dados: { mensagem_id: m.id, kind: "sistema", trabalho_id: p.trabalho.id } })] : [];
}

/**
 * Ferramenta `devolver_resumo` (I2): só da frente. Valida com `validarResumo` (estrito: campo fora da lista ou texto
 * acima do teto volta como instrução, nunca corte silencioso) e grava `trabalhos.resumo`, por cima do anterior.
 */
export const devolverResumo: CasoNod<Deps, "devolver_resumo"> = async (deps, input) => {
  const { turnoId, agenteId, conversaId: _conversa, plano: _plano, ...campos } = input;
  const turno = await deps.repos.turnos.buscar(turnoId);
  if (!turno || turno.agenteId !== agenteId) throw new ErroDeDominio("nao_permitido", { cause: "turno de outro bot" });
  const t = turno.trabalhoId ? await deps.repos.trabalhos.buscar(turno.trabalhoId) : null;
  if (!t || !ehFrente(t)) return { data: { ok: false, erro: "nao_e_frente", instrucao: "Só uma frente devolve resumo. Responda aqui mesmo, no texto." } };
  // NOD-376 (revisão 3 do PR #539, definido em 2026-10-27): na conversa da pessoa com a frente que já tinha acabado, o resumo de antes fica — é o
  // resultado da frente que volta ao dono (ou ao colega); a conversa não o troca.
  if (conversaDepoisDoFim(await deps.repos.turnos.doTrabalho(t.id))) return { data: { ok: true, instrucao: "Esta frente já tinha devolvido o resumo, e ele fica como está: a conversa com a pessoa fica aqui. Encerre com a resposta a ela." } };
  const v = validarResumo(campos);
  if (!v.ok) return { data: { ok: false, erro: "resumo_invalido", instrucao: instrucaoDoResumoInvalido(v.erro, v.campo) } };
  if (!(await deps.repos.frentes.gravarResumo(t.id, v.resumo))) throw new ErroDeDominio("estado_invalido", { cause: "resumo da frente não gravado" });
  return { data: { ok: true, instrucao: "Resumo guardado para o dono. Encerre o turno com uma frase curta, sem repetir o resumo." } };
};
