import type { RuntimeEvent } from "../contracts/evento.ts";
import type { LoteDeFrentes } from "../contracts/frente.ts";
import type { Trabalho } from "../contracts/trabalho.ts";
import type { Turno } from "../contracts/turno.ts";
import { ehFrente } from "../domain/frente.ts";
import { decidirFecho, destinoDoLote, entradaComplementar, entradaDoRetorno, respostaAoColega, respostaComplementarAoColega, resumoMudou, respostaNaTroca, textoFrentesTerminadas, textoPedidoRespondido, type FrenteNoFecho } from "../domain/retorno-do-lote.ts";
import { conversaDepoisDoFim } from "../domain/fala-na-frente.ts";
import { trabalhoFinal } from "../domain/trabalho.ts";
import { entradaDoRetornoARefazer, RETORNO_DO_LOTE } from "../domain/cota-da-ia.ts";
import { redigir } from "../domain/redacao.ts";
import { delegacaoDoTurno } from "./apoio-l7.ts";
import { autoriaAgente, evento, PRAZO_DECISAO_PADRAO_MS } from "./autoria-evento.ts";
import { cadeiaDaDelegacao, entregarRespostaPeer } from "./entregar-resposta-peer.ts";
import type { Deps } from "./tipos.ts";

/**
 * O fecho do lote de frentes (definido em 2026-10-12, ADR-099, partes 3/4, issue I3). Antes, o turno da conversa nunca
 * acordava quando uma task terminava: o resultado só virava balão. Agora a frente que chega a um estado final (terminou,
 * falhou ou foi parada) fecha o lote dela quando é a vez — o dono acorda UMA vez com os resumos, ou, se o pedido era de
 * um colega, a resposta vai direto a quem pediu e o dono não acorda (decisões 6 e 7). A regra é pura
 * (src/domain/retorno-do-lote.ts); aqui só leitura, travas e gravação.
 *
 * Travas: quem chama (sincronizarTrabalho, marcarParado) já tem os turnos e o trabalho da frente; o lote vem por último
 * (turnos → trabalho → lote, a ordem de travarTrabalhoComTurnos). Nada aqui trava turno: a retomada do dono é um INSERT
 * (FK = FOR KEY SHARE, que não briga com o UPDATE do Parar), sem a trava de enfileirarRetomada. Duas frentes que
 * fecham juntas serializam na linha do lote: a segunda já vê a primeira como final, ou o lote devolvido.
 */
type DepsFecho = Pick<Deps, "repos" | "escopo" | "agora">;

export async function fecharLoteSePronto(deps: DepsFecho, frente: Trabalho): Promise<RuntimeEvent[]> {
  if (!ehFrente(frente) || !frente.loteId || !trabalhoFinal(frente.estado)) return [];
  const lote = await deps.repos.frentes.buscarLoteTravado(frente.loteId);
  if (!lote) return [];
  // NOD-282 (G7): o lote já voltou ao dono, e esta frente foi reaberta e terminou de novo — o retorno complementar.
  if (lote.devolvidoEm !== null) return retornoComplementar(deps, lote, frente);
  const abertoPor = await deps.repos.turnos.buscar(lote.abertoPorTurnoId);
  if (!abertoPor) return [];
  const raiz = abertoPor.origem === "peer" ? abertoPor : await delegacaoDoTurno(deps.repos, abertoPor);
  const destino = destinoDoLote(raiz);
  const frentes = await comoAcabaram(deps, await deps.repos.frentes.frentesDoLote(lote.id));
  // NOD-376: a frente que já tinha acabado e reabriu só para a pessoa conversar nela não volta ao dono de novo. Com o lote
  // ainda aberto: se faltam outras, nada; se era a última, o lote fecha — com o retorno de todas (ou a resposta ao colega,
  // que só sai com todas), se ainda não saiu nenhum, ou em silêncio, se cada uma já voltou ao dono na hora.
  // A parada aberta (Parar global ou da sala) para o dono: o lote fecha sem acordá-lo. Falha na leitura = parado.
  // revisto em 2026-10-22 (NOD-311): o Parar do chat encerra a parada na mesma transação; não segura o retorno das frentes.
  const donoParado = destino === "dono" && (await deps.repos.paradas.ativa(deps.escopo.pessoaId, abertoPor.conversaId)) !== false;
  if (conversaDepoisDoFim(await deps.repos.turnos.doTrabalho(frente.id))) {
    if (frentes.some((f) => !trabalhoFinal(f.estado))) return [];
    // Revisão 8: com o dono parado, a linha das que voltaram ainda sai (decidirFecho), como sem a conversa.
    if (destino === "dono" && lote.avisarACadaUma && !donoParado) {
      await deps.repos.frentes.marcarDevolvido(lote.id, null, deps.agora());
      return [];
    }
  }
  const fecho = decidirFecho({ destino, avisarACadaUma: lote.avisarACadaUma, devolvido: false, frentes, fechou: frente.id, donoParado });
  if (fecho.acao === "nada") return [];
  if (fecho.acao === "colega") return raiz ? responderAoColega(deps, { lote, abertoPor, raiz, frentes: fecho.frentes }) : [];
  if (fecho.acao === "so_linha") {
    await deps.repos.frentes.marcarDevolvido(lote.id, null, deps.agora());
    return linhaFrentesTerminadas(deps, { lote, conversaId: abertoPor.conversaId, turnoId: null, agenteId: abertoPor.agenteId, frentes: fecho.frentes });
  }
  return devolverAoDono(deps, { lote, abertoPor, total: frentes.length, frentes: fecho.frentes, fechaLote: fecho.fechaLote, cuidado: fecho.cuidado, faltam: fecho.faltam, trabalhoDoRetorno: trabalhoDoRetorno(lote, frentes) });
}

/**
 * definido em 2026-10-27 (NOD-376, revisões 6 e 8 do PR #539): a frente que já tinha terminado e só reabriu para a
 * pessoa conversar nela volta ao dono como terminou — terminada, com o resumo guardado —, com a conversa ainda rodando
 * (não segura o retorno das outras: a resposta pode esperar a cota por horas), parada ou caída. Parar a conversa não
 * desfaz o trabalho entregue; o fim dela depois acha o lote já devolvido e não volta de novo.
 */
async function comoAcabaram<F extends FrenteNoFecho>(deps: DepsFecho, frentes: F[]): Promise<F[]> {
  const vistas: F[] = [];
  for (const f of frentes) {
    const conversou = f.estado !== "terminado" && f.resumo !== null && conversaDepoisDoFim(await deps.repos.turnos.doTrabalho(f.id));
    vistas.push(conversou ? { ...f, estado: "terminado", motivoInterrupcao: null, motivoFalha: null, vencidaTipo: null } : f);
  }
  return vistas;
}

/**
 * definido em 2026-10-20 (NOD-282, G7; decisão do Marlon de 19/10): a frente reaberta (uma aprovação vencida reaberta e
 * decidida) que volta a final depois do lote devolvido acorda o dono UMA vez, só com ela — "o Y, que tinha ficado
 * pendente, terminou agora". Sem botão nem card. Uma vez: o resumo arquivado na reabertura (`resumo_anterior`) é
 * consumido aqui, sob a trava do trabalho e do lote; o fecho repetido não o acha mais. Resumo igual ao de antes: nada.
 * Dono parado: só a linha. Lote de colega: o complemento vai a quem pediu (sem acordar o dono), com a linha
 * `pedido_respondido` marcada complementar. Limite registrado: o complementar que cai não é refeito (sem o NOD-258).
 */
async function retornoComplementar(deps: DepsFecho, lote: LoteDeFrentes, frente: Trabalho): Promise<RuntimeEvent[]> {
  const resumos = await deps.repos.frentes.consumirResumoAnterior(frente.id);
  if (!resumos || !resumoMudou(resumos.anterior, resumos.atual)) return [];
  const abertoPor = await deps.repos.turnos.buscar(lote.abertoPorTurnoId);
  if (!abertoPor) return [];
  const f = (await deps.repos.frentes.frentesDoLote(lote.id)).find((x) => x.id === frente.id);
  if (!f) return [];
  const raiz = abertoPor.origem === "peer" ? abertoPor : await delegacaoDoTurno(deps.repos, abertoPor);
  const destino = destinoDoLote(raiz);
  const agora = deps.agora();
  if (destino === "colega" && raiz) {
    const r = await entregarRespostaPeer(deps, { tarefaId: abertoPor.id, texto: respostaComplementarAoColega(f), doLote: lote.id }, { complementar: true });
    if ("ignorado" in r.data) return r.events ?? [];
    const quem = await deps.repos.agentes.buscar(r.data.remetenteAgenteId);
    const nome = quem?.nome ?? "um colega";
    const autoria = autoriaAgente({ agenteId: abertoPor.agenteId, contaDeExecucao: deps.escopo.pessoaId, executor: "catcher", decididoPor: "regra:frentes" });
    const deFora = f.deFora || (await deps.repos.turnos.contaminado(abertoPor.id));
    const m = await deps.repos.mensagens.criar({
      conversaId: abertoPor.conversaId,
      turnoId: null,
      autoria,
      kind: "sistema",
      texto: textoPedidoRespondido(nome),
      payload: { kind: "pedido_respondido", loteId: lote.id, agenteId: r.data.remetenteAgenteId, nome, resposta: respostaNaTroca(r.data.mensagem.texto), turnoRaizId: raiz.id, complementar: true },
      confianca: deFora ? "nao_confiavel" : "confiavel",
    });
    const linha = m ? [evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: abertoPor.conversaId, dados: { mensagem_id: m.id, kind: "sistema", lote_id: lote.id } })] : [];
    return [...(r.events ?? []), ...linha];
  }
  const donoParado = (await deps.repos.paradas.ativa(deps.escopo.pessoaId, abertoPor.conversaId)) !== false;
  if (donoParado) return linhaFrentesTerminadas(deps, { lote, conversaId: abertoPor.conversaId, turnoId: null, agenteId: abertoPor.agenteId, frentes: [f] });
  const agente = await deps.repos.agentes.buscar(abertoPor.agenteId);
  const retorno = await deps.repos.turnos.enfileirar({
    conversaId: abertoPor.conversaId,
    agenteId: abertoPor.agenteId,
    origem: "retomada",
    retomaTurnoId: abertoPor.id,
    trabalhoId: trabalhoDoRetorno(lote, [f]),
    prazoEm: agora + PRAZO_DECISAO_PADRAO_MS,
    profundidade: abertoPor.profundidade,
    entradaTexto: entradaComplementar(f),
    entradaConfianca: abertoPor.entradaConfianca,
    sobProcuracaoDe: abertoPor.sobProcuracaoDe ?? null,
    modelo: agente?.modelo ?? abertoPor.modelo,
    harness: agente ? agente.harness : abertoPor.harness,
    executor: abertoPor.executor,
    decididoPor: RETORNO_DO_LOTE,
  });
  if (!retorno) return [];
  if (f.deFora || (await deps.repos.turnos.contaminado(abertoPor.id))) await deps.repos.turnos.contaminar(retorno.id, agora);
  const autoria = autoriaAgente({ agenteId: abertoPor.agenteId, contaDeExecucao: deps.escopo.pessoaId, executor: "catcher", decididoPor: "regra:frentes" });
  return [
    evento(deps.escopo, { kind: "turno_criado", autoria, agora, conversaId: abertoPor.conversaId, turnoId: retorno.id, dados: { origem: retorno.origem, agente_id: abertoPor.agenteId, lote_id: lote.id } }),
    ...(await linhaFrentesTerminadas(deps, { lote, conversaId: abertoPor.conversaId, turnoId: retorno.id, agenteId: abertoPor.agenteId, frentes: [f] })),
  ];
}

/**
 * definido em 2026-10-12 (ADR-099, I3, combinado com a I8): o trabalho onde o retorno nasce. É o `trabalho_id` do lote (a
 * rotina-mãe), nunca uma frente do próprio lote nem o trabalho herdado do turno que abriu: na rede de 2 min o turno
 * promovido abre o lote e passa a pertencer à frente — o retorno ao dono é da faixa da conversa (null, com a sessão da
 * conversa), não da frente.
 */
function trabalhoDoRetorno(lote: LoteDeFrentes, frentes: readonly FrenteNoFecho[]): string | null {
  return lote.trabalhoId && !frentes.some((f) => f.id === lote.trabalhoId) ? lote.trabalhoId : null;
}

/**
 * A retomada do turno que abriu o lote, na conversa (ou no trabalho da rotina) dele, com os resumos. A marca de fora não
 * se lava (ADR-062, a regra de entregar-resposta-peer.ts): se uma frente leu conteúdo de fora, ou o turno que abriu já
 * estava marcado, o retorno nasce marcado. O turno seguinte da pessoa nasce limpo (a marca é por turno).
 */
async function devolverAoDono(deps: DepsFecho, p: { lote: LoteDeFrentes; abertoPor: Turno; frentes: FrenteNoFecho[]; fechaLote: boolean; cuidado: boolean; faltam: number; total: number; trabalhoDoRetorno: string | null }): Promise<RuntimeEvent[]> {
  const agora = deps.agora();
  const { abertoPor } = p;
  // NOD-258: o retorno roda na IA ATUAL do bot (a do turno que abriu o lote pode ter sido trocada depois, ou estar no
  // limite) e leva a marca do retorno do lote — o portão da cota o trata como fundo e ele espera a cota em vez de cair.
  const agente = await deps.repos.agentes.buscar(abertoPor.agenteId);
  const retorno = await deps.repos.turnos.enfileirar({
    conversaId: abertoPor.conversaId,
    agenteId: abertoPor.agenteId,
    origem: "retomada",
    retomaTurnoId: abertoPor.id,
    // Explícito (null = a conversa do dono): sem ele, o INSERT herdaria o trabalho do turno que abriu o lote.
    trabalhoId: p.trabalhoDoRetorno,
    prazoEm: agora + PRAZO_DECISAO_PADRAO_MS,
    profundidade: abertoPor.profundidade,
    entradaTexto: entradaDoRetorno({ frentes: p.frentes, faltam: p.faltam, total: p.total }),
    entradaConfianca: abertoPor.entradaConfianca,
    sobProcuracaoDe: abertoPor.sobProcuracaoDe ?? null,
    modelo: agente?.modelo ?? abertoPor.modelo,
    harness: agente ? agente.harness : abertoPor.harness,
    executor: abertoPor.executor,
    decididoPor: RETORNO_DO_LOTE,
  });
  if (!retorno) return [];
  if (p.cuidado || (await deps.repos.turnos.contaminado(abertoPor.id))) await deps.repos.turnos.contaminar(retorno.id, agora);
  // O UNIQUE de retorno_turno_id e o `devolvido_em is null` garantem um retorno por lote (o lote já está travado aqui).
  if (p.fechaLote) await deps.repos.frentes.marcarDevolvido(p.lote.id, retorno.id, agora);
  const autoria = autoriaAgente({ agenteId: abertoPor.agenteId, contaDeExecucao: deps.escopo.pessoaId, executor: "catcher", decididoPor: "regra:frentes" });
  return [
    evento(deps.escopo, { kind: "turno_criado", autoria, agora, conversaId: abertoPor.conversaId, turnoId: retorno.id, dados: { origem: retorno.origem, agente_id: abertoPor.agenteId, lote_id: p.lote.id } }),
    ...(await linhaFrentesTerminadas(deps, { lote: p.lote, conversaId: abertoPor.conversaId, turnoId: retorno.id, agenteId: abertoPor.agenteId, frentes: p.frentes })),
  ];
}

/**
 * Lote de um pedido de colega (decisão 7): a resposta, montada dos resumos, vai a quem pediu pelo caminho de sempre
 * (entregarRespostaPeer, a continuação dele) e na conversa do dono fica o `pedido_respondido` com a resposta, que a web
 * desenha dentro da troca agrupada (chat limpo, PR 3). O fio do pedido pode
 * ter aberto mais de um lote: a resposta sai uma vez, quando o último fecha, com as frentes de todos. Se a entrega ainda
 * não pode sair (falta a pessoa decidir algo no fio), o dono acorda com os resumos, e a fala dele entrega depois.
 */
async function responderAoColega(deps: DepsFecho, p: { lote: LoteDeFrentes; abertoPor: Turno; raiz: Turno; frentes: FrenteNoFecho[] }): Promise<RuntimeEvent[]> {
  const agora = deps.agora();
  const cadeia = await cadeiaDaDelegacao(deps, p.raiz);
  const lotes = await deps.repos.frentes.lotesAbertosPor(cadeia.map((t) => t.id));
  if (lotes.some((l) => l.id !== p.lote.id && l.devolvidoEm === null)) {
    await deps.repos.frentes.marcarDevolvido(p.lote.id, null, agora);
    return [];
  }
  const frentes: FrenteNoFecho[] = [];
  for (const l of lotes) frentes.push(...(l.id === p.lote.id ? p.frentes : await deps.repos.frentes.frentesDoLote(l.id)));
  if (frentes.length === 0) frentes.push(...p.frentes);
  const r = await entregarRespostaPeer(deps, { tarefaId: p.abertoPor.id, texto: respostaAoColega(frentes), doLote: p.lote.id });
  if ("ignorado" in r.data) {
    // NOD-256 (F1.1): com quem pediu parado, a resposta já ficou registrada na conversa dele — o lote está devolvido.
    if (r.data.ignorado === "ja_entregue" || r.data.ignorado === "remetente_excluido" || r.data.ignorado === "quem_pediu_parado" || r.data.ignorado === "alvo_excluido") {
      await deps.repos.frentes.marcarDevolvido(p.lote.id, null, agora);
      return r.events ?? [];
    }
    return devolverAoDono(deps, { lote: p.lote, abertoPor: p.abertoPor, frentes, fechaLote: true, cuidado: frentes.some((f) => f.deFora), faltam: 0, total: frentes.length, trabalhoDoRetorno: trabalhoDoRetorno(p.lote, frentes) });
  }
  await deps.repos.frentes.marcarDevolvido(p.lote.id, null, agora);
  const quem = await deps.repos.agentes.buscar(r.data.remetenteAgenteId);
  const nome = quem?.nome ?? "um colega";
  const autoria = autoriaAgente({ agenteId: p.abertoPor.agenteId, contaDeExecucao: deps.escopo.pessoaId, executor: "catcher", decididoPor: "regra:frentes" });
  // revisto em 2026-10-18 (chat limpo, PR 3; emenda da ADR-099 item 8): a linha entra na troca agrupada como "Para X", com
  // o texto entregue e o turno do pedido (a raiz da troca). A confiança é a da fala entregue (ADR-026): não confiável se
  // uma frente do lote leu conteúdo de fora ou o turno que abriu o lote já estava marcado (a regra de devolverAoDono).
  const deFora = frentes.some((f) => f.deFora) || (await deps.repos.turnos.contaminado(p.abertoPor.id));
  const m = await deps.repos.mensagens.criar({
    conversaId: p.abertoPor.conversaId,
    turnoId: null,
    autoria,
    kind: "sistema",
    texto: textoPedidoRespondido(nome),
    payload: { kind: "pedido_respondido", loteId: p.lote.id, agenteId: r.data.remetenteAgenteId, nome, resposta: respostaNaTroca(r.data.mensagem.texto), turnoRaizId: p.raiz.id },
    confianca: deFora ? "nao_confiavel" : "confiavel",
  });
  const linha = m ? [evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: p.abertoPor.conversaId, dados: { mensagem_id: m.id, kind: "sistema", lote_id: p.lote.id } })] : [];
  return [...(r.events ?? []), ...linha];
}

/** A linha "3 frentes terminaram" na conversa do dono (payload `frentes_terminadas`, só títulos e estados). */
async function linhaFrentesTerminadas(deps: DepsFecho, p: { lote: LoteDeFrentes; conversaId: string; turnoId: string | null; agenteId: string; frentes: readonly FrenteNoFecho[] }): Promise<RuntimeEvent[]> {
  const autoria = autoriaAgente({ agenteId: p.agenteId, contaDeExecucao: deps.escopo.pessoaId, executor: "catcher", decididoPor: "regra:frentes" });
  const m = await deps.repos.mensagens.criar({
    conversaId: p.conversaId,
    turnoId: p.turnoId,
    autoria,
    kind: "sistema",
    texto: textoFrentesTerminadas(p.frentes),
    payload: { kind: "frentes_terminadas", loteId: p.lote.id, frentes: p.frentes.map((f) => ({ trabalhoId: f.id, titulo: f.titulo, estado: f.estado })) },
    confianca: "confiavel",
  });
  return m ? [evento(deps.escopo, { kind: "mensagem_criada", autoria, agora: deps.agora(), conversaId: p.conversaId, turnoId: p.turnoId, dados: { mensagem_id: m.id, kind: "sistema", lote_id: p.lote.id } })] : [];
}

/**
 * NOD-258 (definido em 2026-10-15): o retorno do lote caiu (interrompido sem espera da cota e sem Parar). Antes o
 * resultado do lote se perdia: o lote já estava devolvido e nada acordava o dono de novo. Agora o retorno é refeito UMA
 * vez (a mesma entrada, na IA atual do bot, `reenvios` + 1) e o lote passa a apontar para a cópia; na segunda queda, uma
 * linha ao dono diz onde ficaram os resumos. `devolvido_em` nunca volta a null (o UNIQUE de um retorno por lote fica).
 */
export async function refazerRetornoDoLote(deps: DepsFecho, turno: Turno): Promise<RuntimeEvent[]> {
  if (turno.decididoPor !== RETORNO_DO_LOTE) return [];
  // NOD-309 (0098, emenda da ADR-099 §7): o lote só está entregue quando o retorno CONCLUI — `devolvido_em` é a trava de
  // um retorno por lote e marca a hora em que ele entrou na fila, não a em que o dono leu.
  if (turno.estado === "concluido") {
    await deps.repos.frentes.marcarRetornoConcluido(turno.id, deps.agora());
    return [];
  }
  // revisto em 2026-10-20 (NOD-309, PR 3): vale para toda queda, também a da máquina e o reinício (antes ficavam com o
  // card "Retomar", que vencia em 24 h). A queda que o varredor assenta já passa o lote para a retomada
  // (interromper-por-maquina, aposQuedaNoFundo): aqui o lote não aponta mais para este turno e nada se duplica.
  if (turno.estado !== "interrompido" || turno.pararSolicitadoEm !== null) return [];
  // A volta da cota de um retorno passa o lote para ela (aposLimiteNoFundo): o lote aponta sempre para o último.
  const raiz = turno;
  const lote = await deps.repos.frentes.loteDoRetorno(raiz.id);
  if (!lote || lote.retornoConcluidoEm) return [];
  const agora = deps.agora();
  const autoria = autoriaAgente({ agenteId: turno.agenteId, contaDeExecucao: deps.escopo.pessoaId, executor: "catcher", decididoPor: "regra:frentes" });
  if (turno.reenvios >= 1) {
    const frentes = await deps.repos.frentes.frentesDoLote(lote.id);
    const m = await deps.repos.mensagens.criar({ conversaId: turno.conversaId, turnoId: turno.id, autoria, kind: "sistema", assunto: "lote.retorno_caiu", texto: redigir("retorno-do-lote-caiu", agora, { frentes: frentes.map((f) => f.titulo).join(", ") || "nenhuma" }), confianca: "confiavel" });
    return m ? [evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { mensagem_id: m.id, kind: "sistema" } })] : [];
  }
  const agente = await deps.repos.agentes.buscar(turno.agenteId);
  const copia = await deps.repos.turnos.enfileirar({
    conversaId: raiz.conversaId,
    agenteId: raiz.agenteId,
    origem: "retomada",
    retomaTurnoId: raiz.retomaTurnoId,
    trabalhoId: raiz.trabalhoId ?? null,
    prazoEm: agora + PRAZO_DECISAO_PADRAO_MS,
    profundidade: raiz.profundidade,
    // A volta da cota que caiu é refeita com a entrada do retorno (os resumos), sem o aviso da cota.
    entradaTexto: entradaDoRetornoARefazer(raiz.entradaTexto),
    entradaConfianca: raiz.entradaConfianca,
    sobProcuracaoDe: raiz.sobProcuracaoDe ?? null,
    modelo: agente?.modelo ?? raiz.modelo,
    harness: agente ? agente.harness : raiz.harness,
    executor: raiz.executor,
    reenvios: turno.reenvios + 1,
    decididoPor: RETORNO_DO_LOTE,
  });
  if (!copia) return [];
  if (raiz.entradaConfianca !== "confiavel" || (await deps.repos.turnos.contaminado(raiz.id))) await deps.repos.turnos.contaminar(copia.id, agora);
  await deps.repos.frentes.trocarRetorno(lote.id, copia.id);
  return [evento(deps.escopo, { kind: "turno_criado", autoria, agora, conversaId: raiz.conversaId, turnoId: copia.id, dados: { origem: copia.origem, agente_id: raiz.agenteId, lote_id: lote.id, repete_turno_id: turno.id } })];
}
