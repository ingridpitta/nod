import { decisaoEmAberto } from "../domain/revisor.ts";
import type { RuntimeEvent } from "../contracts/evento.ts";
import type { Mensagem } from "../contracts/mensagem.ts";
import type { Turno } from "../contracts/turno.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { proximaProfundidade } from "../domain/profundidade.ts";
import { autoriaAgente, delegacaoDoTurno, evento, exigir, PRAZO_DECISAO_MS, SALTOS_DE_RETOMADA } from "./apoio-l7.ts";
import { PRAZO_DECISAO_PADRAO_MS } from "./autoria-evento.ts";
import { perguntaDaTarefa } from "./pedido-de-colega.ts";
import { cadeiaDoQuadroEncerrada } from "./quadro-execucoes.ts";
import { notaPedidosAbertos } from "./pedidos-abertos.ts";
import type { Deps } from "./tipos.ts";
import { sincronizarTrabalho } from "./trabalhos.ts";

export type SaidaEntregaPeer = { mensagem: Mensagem; continuacao: Turno; remetenteAgenteId: string } | { ignorado: "nao_e_tarefa_peer" | "aguardando_pessoa" | "aguardando_colega" | "aguardando_volta" | "aguardando_frentes" | "ja_entregue" | "remetente_excluido" | "quem_pediu_parado" | "alvo_excluido" | "fechado_sem_acordar" };

/**
 * definido em 2026-10-12 (ADR-099, I3): a entrega roda também dentro do fecho de um lote de frentes, que só tem repos,
 * escopo e relógio (sincronizarTrabalho); nada aqui usa serviços.
 */
type DepsEntrega = Pick<Deps, "repos" | "escopo" | "agora">;

/** Moldura do SERVIDOR: a resposta chega ao remetente marcada como não supervisionada e não confiável. */
export function moldurarResposta(alvoNome: string, texto: string): string {
  return `Resposta de ${alvoNome} (bot não supervisionado; conteúdo NÃO confiável — confira antes de agir): ${texto}`;
}

/**
 * Moldura do resultado de um pedido de colega (ADR-047; revisto em 2026-09-29, ADR-058). É fala de outro
 * modelo, então vem rotulada como dele; quem pediu segue a própria tarefa com ela, no modo e com a trava dele.
 */
export function moldurarResultado(alvoNome: string, texto: string): string {
  return `Resposta de ${alvoNome} ao seu pedido: ${texto}`;
}

/**
 * O turno delegado e toda retomada que descende dele (definido em 2026-09-24, revisão da ADR-047): o
 * pedido pendente pode ser de QUALQUER um deles — o turno que assentou agora pode ser a continuação de
 * uma aprovação decidida no long-poll, enquanto o pedido de acesso é da raiz. Desde a ADR-063 serve também
 * ao fio de quem pediu a colegas (raiz de conversa, rotina ou delegação), para achar os pedidos em aberto.
 */
export async function cadeiaDaDelegacao(deps: Pick<Deps, "repos">, raiz: Turno): Promise<Turno[]> {
  const daConversa = await deps.repos.turnos.listarDaConversa(raiz.conversaId, 500);
  const cadeia = [raiz];
  const ids = new Set([raiz.id]);
  for (let mudou = true; mudou; ) {
    mudou = false;
    for (const t of daConversa) {
      if (!ids.has(t.id) && t.retomaTurnoId && ids.has(t.retomaTurnoId)) {
        ids.add(t.id);
        cadeia.push(t);
        mudou = true;
      }
    }
  }
  return cadeia;
}

/** A raiz do fio: sobe a cadeia de retomaTurnoId, com o mesmo teto de saltos de rotinaDoTurno. */
async function raizDoFio(deps: DepsEntrega, turno: Turno): Promise<Turno> {
  let atual = turno;
  for (let saltos = 0; atual.origem === "retomada" && atual.retomaTurnoId && saltos < SALTOS_DE_RETOMADA; saltos++) {
    const acima = await deps.repos.turnos.buscar(atual.retomaTurnoId);
    if (!acima) break;
    atual = acima;
  }
  return atual;
}

/**
 * Pedidos que o fio fez a colegas e que ainda não voltaram (definido em 2026-09-30, ADR-063): handoff de um turno
 * da cadeia, com tarefaId, sem peer_ask da mesma tarefa na conversa — nem resultado nem aviso de falha. `exceto` é
 * a tarefa que está voltando agora: a peer_ask dela nasce depois da continuação.
 */
async function pedidosEmAberto(deps: DepsEntrega, cadeia: readonly Turno[], exceto: string | null = null): Promise<{ tarefaId: string; agenteId: string }[]> {
  const conversaId = cadeia[0]?.conversaId;
  if (!conversaId) return [];
  const ids = new Set(cadeia.map((t) => t.id));
  const mensagens = await deps.repos.mensagens.listarDaConversa(conversaId, 500);
  const voltaram = new Set(mensagens.flatMap((m) => (m.payload?.kind === "peer_ask" ? [m.payload.tarefaId] : [])));
  return mensagens.flatMap((m) =>
    m.payload?.kind === "handoff" && m.turnoId !== null && ids.has(m.turnoId) && m.payload.tarefaId && m.payload.tarefaId !== exceto && !voltaram.has(m.payload.tarefaId)
      ? [{ tarefaId: m.payload.tarefaId, agenteId: m.payload.para }]
      : [],
  );
}

/**
 * Por que a tarefa delegada ainda não entrega (ADR-047; ADR-063): falta a pessoa decidir algo na cadeia, ou quem
 * cumpre o pedido pediu a um colega e a resposta dele ainda não voltou. Sem a segunda, "pedi ao Dev, aguardo" saía
 * como resultado final e a resposta de verdade era descartada como ja_entregue (a entrega é uma por raiz).
 */
async function aindaNaoEntrega(deps: DepsEntrega, tarefa: Turno, doLote: string | null = null, assentadoId: string | null = null): Promise<"aguardando_pessoa" | "aguardando_colega" | "aguardando_volta" | "aguardando_frentes" | null> {
  if (tarefa.origem !== "delegacao") return null;
  const cadeia = await cadeiaDaDelegacao(deps, tarefa);
  // definido em 2026-10-12 (ADR-099, I3): quem cumpre o pedido abriu frentes para ele — o "comecei 3 frentes" não é o
  // resultado. A resposta sai quando o último lote do fio fecha (fechar-lote.ts, que passa o lote que está fechando).
  if ((await deps.repos.frentes.lotesAbertosPor(cadeia.map((t) => t.id))).some((l) => l.devolvidoEm === null && l.id !== doLote)) return "aguardando_frentes";
  if (await aguardandoPessoa(deps, cadeia)) return "aguardando_pessoa";
  if ((await pedidosEmAberto(deps, cadeia)).length > 0) return "aguardando_colega";
  // ADR-086 (revisão do #212): quem cumpre o pedido marcou uma volta ("vou esperar o CI"). Essa frase não é o resultado:
  // sem esta espera ela saía como entrega final e o resultado de verdade, na volta, era descartado como ja_entregue.
  if (cadeia.some((t) => t.estado === "pendente" && t.acordarEm != null)) return "aguardando_volta";
  // definido em 2026-10-15 (NOD-239): as respostas de dois colegas chegam quase juntas e abrem duas continuações. A
  // primeira assenta com a segunda ainda viva — não há pedido em aberto (as duas peer_ask já existem), e ela entregava
  // a resposta parcial; a segunda, com as duas, caía em ja_entregue. Entrega só a última continuação viva da cadeia; a
  // absorvida não conta (já saiu da fila).
  if (cadeia.some((t) => t.id !== assentadoId && t.origem === "retomada" && (t.estado === "pendente" || t.estado === "despachando"))) return "aguardando_volta";
  // definido em 2026-10-12 (ADR-099, I7 revista): ou deixou um comando esperando (esperar_comando, parte 2) — a volta vem
  // quando ele acabar.
  if ((await deps.repos.pedidosDeColega.esperasRodandoDosTurnos(cadeia.map((t) => t.id))) > 0) return "aguardando_volta";
  return null;
}

function emLista(nomes: readonly string[]): string {
  return nomes.length <= 1 ? (nomes[0] ?? "") : `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

/**
 * O fecho da continuação de quem pediu (definido em 2026-09-30, ADR-063): o que ainda falta voltar, ou — quando quem
 * pediu cumpre ele mesmo um pedido de colega e tudo voltou — a quem vai a resposta final. Fio de conversa ou rotina
 * sem pendência não ganha frase: a tarefa original do contexto já diz o que fazer.
 */
async function fechoDaContinuacao(deps: DepsEntrega, pediu: Turno, tarefaId: string): Promise<string> {
  const faltam = await pedidosEmAberto(deps, await cadeiaDaDelegacao(deps, await raizDoFio(deps, pediu)), tarefaId);
  if (faltam.length > 0) {
    const nomes = [...new Set(await Promise.all(faltam.map(async (p) => (await deps.repos.agentes.buscar(p.agenteId))?.nome ?? "um colega")))];
    return `\nAinda faltam as respostas de ${emLista(nomes)}; elas chegam em novos turnos. Siga com o que já tem e não repita esses pedidos.`;
  }
  const delegacao = await delegacaoDoTurno(deps.repos, pediu);
  if (!delegacao) return "";
  const pedido = await deps.repos.mensagens.pedidoDaTarefa(delegacao.id);
  const quem = pedido ? (await deps.repos.agentes.buscar(pedido.autoria.autor_id))?.nome : undefined;
  return `\nTodas as respostas que você pediu chegaram: consolide a resposta final para ${quem ?? "quem te pediu"}.`;
}

/**
 * A tarefa delegada deixou algo para a pessoa decidir (acesso, aprovação, pergunta)? Então o turno que
 * terminou não é o fim: a decisão abre uma retomada, e é ELA que entrega. Sem isto o remetente recebia
 * "pedi acesso" como se fosse o resultado (o plano da ADR-047: "o remetente só recebe o resultado final").
 * Olha a CADEIA inteira, não só o turno que assentou (revisão da ADR-047).
 */
async function aguardandoPessoa(deps: DepsEntrega, cadeia: readonly Turno[]): Promise<boolean> {
  for (const t of cadeia) {
    const decisoes = await deps.repos.decisoes.doTurno(t.id);
    // ADR-115: a revisão em voo também é espera (vira cartão ou libera; nos dois casos o turno continua).
    if (decisoes.some((d) => decisaoEmAberto(d.estado))) return true;
  }
  const ids = new Set(cadeia.map((t) => t.id));
  // A proposta de acesso tem decisão de MESMO id (ADR-044); vencida a decisão, a proposta segue "pendente"
  // mas ninguém mais vai decidir. Proposta sem decisão é o card de conexão: espera a pessoa só até o
  // PRÓPRIO prazo (criação + PRAZO_DECISAO_PADRAO_MS, o mesmo de uma decisão); depois, o varredor avisa.
  for (const p of await deps.repos.propostas.pendentesDaConversa(cadeia[0]?.conversaId ?? "")) {
    if (p.payload.kind !== "acesso" || typeof p.payload.turnoId !== "string" || !ids.has(p.payload.turnoId)) continue;
    const d = await deps.repos.decisoes.buscar(p.id);
    if (d ? d.estado === "pendente" || d.estado === "reaberta" : deps.agora() < p.criadoEm + PRAZO_DECISAO_PADRAO_MS) return true;
  }
  return false;
}

/** NOD-282 (G7): `complementar` = a resposta já saiu e esta acrescenta o que mudou (não cai no `ja_entregue`). */
/**
 * NOD-377: `final` = o aviso fecha o pedido de vez (a marca `paradoPelaPessoa`): um resultado tardio do colega só fica
 * registrado, não acorda quem pediu de novo — o Desistir da pessoa e a limpeza. `semAcordar` = além disso, grava o
 * peer_ask sem continuação (o ramo de "quem pediu parado"): só a limpeza dos pedidos com mais de 7 dias.
 */
type Entrega = { tarefa: Turno; texto: string; falha: boolean; complementar?: boolean; paradoPeloChat?: true; final?: true; semAcordar?: true };

function payloadDaEntrega(alvo: { id: string; nome: string }, tarefa: Turno, origem: { turnoOrigemId: string } | null, delegada: boolean, falha: boolean, paradoPelaPessoa = false) {
  return { kind: "peer_ask" as const, agenteId: alvo.id, nome: alvo.nome, naoSupervisionado: true as const, tarefaId: tarefa.id, ...(origem ? { turnoOrigemId: origem.turnoOrigemId } : {}), ...(delegada ? { delegada: true as const } : {}), ...(falha ? { falhou: true as const } : {}), ...(tarefa.trabalhoId ? { trabalhoId: tarefa.trabalhoId } : {}), ...(paradoPelaPessoa ? { paradoPelaPessoa: true as const } : {}) };
}

/**
 * definido em 2026-10-15 (NOD-256, F1.1): quem pediu está parado pela pessoa — o turno que pediu foi interrompido pelo
 * Parar, a task dele está `parada`, ou há parada aberta cobrindo a conversa dele (global ou dela).
 * revisto em 2026-10-22 (NOD-311): ou o Parar já foi pedido no turno que pediu (`pararSolicitadoEm`: a janela entre o
 * Parar do chat, que não deixa parada aberta, e o assentar desse turno). Devolve o porquê: só o `turno` é final (o
 * turno interrompido não volta); a task parada e a parada aberta (global, sala) a pessoa desfaz retomando.
 */
async function quemPediuParado(deps: DepsEntrega, pediu: Turno | null, conversaId: string): Promise<"turno" | "trabalho" | "parada" | null> {
  if (pediu?.motivoInterrupcao === "parado_pela_pessoa") return "turno";
  if (pediu?.pararSolicitadoEm != null) return "turno";
  if (pediu?.trabalhoId && (await deps.repos.trabalhos.buscar(pediu.trabalhoId))?.estado === "parado") return "trabalho";
  return (await deps.repos.paradas.ativa(deps.escopo.pessoaId, conversaId)) === true ? "parada" : null;
}

/**
 * Escreve a entrega na conversa do remetente e abre a continuação dele. Tarefa delegada entrega UMA vez
 * por raiz (revisão da ADR-047): a aprovação decidida durante o long-poll do proxy deixava o turno
 * original terminar E criava uma retomada, e as duas entregavam. O aviso de falha também sai uma vez, e
 * não sai se o resultado já saiu; um resultado depois de um aviso (a pessoa retomou) sai normalmente.
 */
async function entregar(deps: DepsEntrega, e: Entrega): Promise<{ data: SaidaEntregaPeer; events?: RuntimeEvent[] }> {
  const { tarefa } = e;
  // A pergunta é a mensagem de TEXTO de outro agente ligada à tarefa (perguntaDaTarefa: o mesmo critério que a I3 usa,
  // por pedidoDeColegaDoTurno, para saber a quem devolver o lote de um pedido de colega).
  const pergunta = await perguntaDaTarefa(deps, tarefa);
  if (!pergunta) return { data: { ignorado: "nao_e_tarefa_peer" } };
  const delegada = tarefa.origem === "delegacao";
  const remetenteId = pergunta.autoria.autor_id;
  // revisto em 2026-10-13 (NOD-219, revisão do PR #307): o aviso de FALHA sai mesmo com o colega excluído — é justamente
  // o caso do turno órfão. Buscar só os vivos lançava `nao_encontrado`, desfazia a passada do varredor e envenenava as
  // seguintes (o órfão é o primeiro da fila). O resultado de um colega excluído continua sem entrega.
  const alvo = exigir(await deps.repos.agentes.buscar(tarefa.agenteId, true), "nao_encontrado", "bot alvo");
  // definido em 2026-10-15 (NOD-257, G9): o RESULTADO de um colega excluído não é entregue (o lote das frentes dele fecha
  // no excluir); quem pediu recebe o aviso de falha "o bot foi excluído" (gerir-agente.ts).
  if (alvo.excluidoEm && !e.falha) return { data: { ignorado: "alvo_excluido" } };
  // definido em 2026-10-09: quem pediu foi excluído enquanto o colega trabalhava (a Elis, com a fatia 5 do Ze 1 na VM). O
  // 404 desfazia o assentamento inteiro: a máquina tentava entregar de novo, desistia, e o turno do colega caía como
  // "seu Mac parou de responder", com a resposta perdida. Agora a resposta fica na conversa de quem a escreveu e a
  // entrega acaba aqui: não há a quem continuar.
  const remetente = await deps.repos.agentes.buscar(remetenteId);
  if (!remetente) return { data: { ignorado: "remetente_excluido" } };
  const origem = pergunta.payload?.kind === "peer_pedido" ? pergunta.payload : null;
  const conversaRemetente = exigir(origem ? await deps.repos.conversas.buscar(origem.conversaOrigemId) : await deps.repos.conversas.buscarPropriaDoAgente(remetente.id), "nao_encontrado", "conversa do remetente");
  // NOD-311: a pessoa parou quem pediu (o aviso saiu com paradoPelaPessoa): o resultado tardio só registra.
  let paradoAntes = false;
  if (delegada) {
    // NOD-377: a leitura de "já entregue" e a gravação do peer_ask sob a trava da raiz (corrida assentar × varredor).
    await deps.repos.pedidosDeColega.travarTarefa(tarefa.id);
    const entregues = (await deps.repos.mensagens.listarDaConversa(conversaRemetente.id, 500)).filter((m) => m.payload?.kind === "peer_ask" && m.payload.tarefaId === tarefa.id);
    const resultadoSaiu = entregues.some((m) => m.payload?.kind === "peer_ask" && !m.payload.falhou);
    if (!e.complementar && (resultadoSaiu || (e.falha && entregues.length > 0))) return { data: { ignorado: "ja_entregue" } };
    paradoAntes = entregues.some((m) => m.payload?.kind === "peer_ask" && m.payload.paradoPelaPessoa === true);
  }
  const agora = deps.agora();
  const autoria = autoriaAgente(alvo.id, deps.escopo.pessoaId, delegada ? (tarefa.sobProcuracaoDe ?? null) : remetente.id);
  // definido em 2026-09-29 (ADR-058): a continuação é uma RETOMADA do turno que pediu — mesma confiança e, pela
  // cadeia de retomaTurnoId, mesmo modo e mesma trava (a rotina continua rotina, com o gate dela; a conversa,
  // conversa). Sem o turno que pediu (pedido legado de perguntar_a_bot, ou turno que sumiu), cai no turno 'peer'
  // não confiável de antes.
  // revisto em 2026-09-30 (ADR-063): a resposta que volta é um passe a mais que o turno que pediu (a profundidade
  // da tarefa), e não mais 1 fixo: abaixo do limite, quem recebeu a resposta ainda pede a outro colega. Quem pediu
  // cumprindo um pedido (delegação) mantém a procuração — o modo, a trava e o aviso de falha seguem a cadeia.
  const pediu = delegada && origem ? await deps.repos.turnos.buscar(origem.turnoOrigemId) : null;
  // definido em 2026-10-15 (NOD-256, F1.1): quem pediu foi parado pela pessoa (o turno, a task ou a conversa) — a resposta
  // fica registrada como peer_ask, sem continuação e sem reabrir a task: Parar é final até a pessoa voltar.
  // revisto na revisão do PR #458: a marca `paradoPelaPessoa` (que torna final o aviso) só sai quando o Parar é do turno
  // que pediu ou do Parar do chat (`paradoPeloChat`); depois do Parar global, da sala ou da task, um resultado depois
  // do aviso (a pessoa retomou) segue saindo normalmente, como antes da NOD-311.
  // Revisão 4 do PR #625 (NOD-418): quem pediu é a cadeia de um trabalho do quadro já substituído (Repetir, a nova
  // tentativa sozinha) ou tratado de vez (Bloqueado): a resposta tardia só fica registrada; a continuação rodaria a
  // cadeia velha junto do trabalho novo (ou com o card parado). Não é o Parar da pessoa: o registro não sai final.
  const parado = paradoAntes ? "turno" : e.semAcordar ? "sem_acordar" : (await quemPediuParado(deps, pediu, conversaRemetente.id)) || (pediu && (await cadeiaDoQuadroEncerrada(deps, pediu.id)) ? "quadro" : null);
  if (parado) {
    const registro = await deps.repos.mensagens.criar({
      conversaId: conversaRemetente.id,
      turnoId: null,
      autoria,
      kind: "peer_ask",
      texto: e.falha ? `${alvo.nome} não concluiu: ${e.texto}` : e.texto,
      payload: payloadDaEntrega(alvo, tarefa, origem, delegada, e.falha, parado === "turno" || e.final === true || e.paradoPeloChat === true),
      confianca: "nao_confiavel",
    });
    const eventos = registro ? [evento(deps, "mensagem_criada", autoria, { mensagemId: registro.id, kind: "peer_ask", tarefaId: tarefa.id }, { conversaId: conversaRemetente.id })] : [];
    // NOD-377: o trabalho de quem pediu esperava este pedido (aguardandoColega); fechado, ele relê o estado.
    if (parado === "sem_acordar") return { data: { ignorado: "fechado_sem_acordar" }, events: [...eventos, ...(await sincronizarTrabalho(deps, pediu?.trabalhoId ?? null))] };
    return { data: { ignorado: "quem_pediu_parado" }, events: eventos };
  }
  // NOD-259: e os pedidos dele a colegas ainda sem resposta, de qualquer fio — fora o que está sendo entregue agora.
  const fecho = pediu ? `${await fechoDaContinuacao(deps, pediu, tarefa.id)}${await notaPedidosAbertos(deps, remetente.id, agora, { exceto: [tarefa.id] })}` : "";
  const entradaTexto = !delegada
    ? `${moldurarResposta(alvo.nome, e.texto)}\nConsolide a resposta para a pessoa, citando a contribuição do colega e retomando a tarefa original indicada no contexto.`
    : e.falha
      ? `O pedido que você fez a ${alvo.nome} não foi concluído: ${e.texto}.\nSiga a tarefa original indicada no contexto sem inventar o resultado; se ela dependia disso, diga em uma frase o que ficou pendente.${fecho}`
      : `${moldurarResultado(alvo.nome, e.texto)}\nSiga a tarefa original indicada no contexto com essa resposta, citando o colega. Confira o que for afirmar à pessoa.${fecho}`;
  // definido em 2026-09-16 (L9): a continuação nasce ANTES da mensagem peer_ask para a mensagem apontar
  // (turno_id) para o turno que ela dispara — a web e o e2e acham a continuação pela própria mensagem.
  const continuacao = await deps.repos.turnos.enfileirar({
    conversaId: conversaRemetente.id,
    agenteId: remetente.id,
    origem: pediu ? "retomada" : "peer",
    retomaTurnoId: pediu?.id ?? null,
    prazoEm: agora + PRAZO_DECISAO_MS,
    profundidade: proximaProfundidade(pediu?.profundidade ?? 0),
    entradaTexto,
    entradaConfianca: pediu?.entradaConfianca ?? "nao_confiavel",
    sobProcuracaoDe: pediu?.sobProcuracaoDe ?? null,
    modelo: remetente.modelo,
    harness: remetente.harness,
    // ADR-083: a continuação de quem pediu segue no trabalho dele (null = a conversa dele).
    trabalhoId: pediu?.trabalhoId ?? null,
    // NOD-206: o do turno que pediu; sem ele (pedido legado), o da tarefa do colega, na mesma máquina.
    executor: pediu?.executor ?? tarefa.executor,
  });
  if (!continuacao) throw new ErroDeDominio("estado_invalido", { cause: "turno de continuação não criado" });
  // definido em 2026-09-30 (ADR-062, auditoria das aprovações): a resposta traz o que o colega leu. Se a tarefa dele
  // (ou a cadeia dela) leu a web ou nasceu de conteúdo de fora, a continuação herda a marca — senão o pedido a um
  // colega lavava a página lida e quem pediu seguia com "Sempre permitir" e o modo automático valendo.
  const cadeia = delegada ? await cadeiaDaDelegacao(deps, tarefa) : [tarefa];
  const trouxeDeFora = cadeia.some((t) => t.entradaConfianca !== "confiavel") || (await Promise.all(cadeia.map((t) => deps.repos.turnos.contaminado(t.id)))).some(Boolean);
  if (trouxeDeFora || (pediu && (await deps.repos.turnos.contaminado(pediu.id)))) await deps.repos.turnos.contaminar(continuacao.id, agora);
  const mensagem = await deps.repos.mensagens.criar({
    conversaId: conversaRemetente.id,
    turnoId: continuacao.id,
    autoria,
    kind: "peer_ask",
    texto: e.falha ? `${alvo.nome} não concluiu: ${e.texto}` : e.texto,
    payload: payloadDaEntrega(alvo, tarefa, origem, delegada, e.falha, e.final === true),
    confianca: "nao_confiavel",
  });
  if (!mensagem) throw new ErroDeDominio("estado_invalido", { cause: "mensagem peer_ask não criada" });
  // Revisão do épico (S3, 2026-10-08): o trabalho de quem pediu esperava esta resposta como `rodando` (aguardandoColega);
  // a continuação já está na fila e a peer_ask gravada, então ele relê o estado agora — nunca passa por `terminado`.
  const doTrabalho = await sincronizarTrabalho(deps, continuacao.trabalhoId ?? null);
  return {
    data: { mensagem, continuacao, remetenteAgenteId: remetente.id },
    events: [
      ...doTrabalho,
      evento(deps, "mensagem_criada", autoria, { mensagemId: mensagem.id, kind: "peer_ask", tarefaId: tarefa.id }, { conversaId: conversaRemetente.id, turnoId: continuacao.id }),
      evento(deps, "turno_criado", autoria, { turnoId: continuacao.id, agenteId: remetente.id, origem: continuacao.origem, profundidade: continuacao.profundidade }, { conversaId: conversaRemetente.id, turnoId: continuacao.id }),
    ],
  };
}

/**
 * Ao assentar o turno de quem cumpria um pedido de colega (origem 'delegacao', ou uma retomada dele; e o
 * 'peer' legado): a resposta vira mensagem kind 'peer_ask' {agenteId, nome, tarefaId} na conversa de quem
 * pediu, e ele ganha a CONTINUAÇÃO, um passe mais funda (ADR-063; até o limite ela ainda pede a colegas). Desde
 * a ADR-058 a continuação é a retomada do turno que pediu, no modo e com a trava dele. A autoria da entrega
 * fica "alvo · por pessoa". Turno sem pedido ligado é a própria continuação: nada a entregar.
 */
export async function entregarRespostaPeer(deps: DepsEntrega, input: { tarefaId: string; texto: string; doLote?: string }, opcoes: { complementar?: true } = {}): Promise<{ data: SaidaEntregaPeer; events?: RuntimeEvent[] }> {
  const assentado = exigir(await deps.repos.turnos.buscar(input.tarefaId), "nao_encontrado", "tarefa");
  // definido em 2026-09-24 (ADR-047): tarefa delegada entrega também — ela mesma ou a retomada dela.
  const tarefa = assentado.origem === "peer" ? assentado : await delegacaoDoTurno(deps.repos, assentado);
  if (!tarefa) return { data: { ignorado: "nao_e_tarefa_peer" } };
  // NOD-239: o turno que assentou agora não espera por ele mesmo; no fecho de lote, quem entrega é o turno que abriu o
  // lote, como antes.
  // NOD-282 (G7): o complemento não espera o fio — o resultado dele já saiu; só soma o que mudou.
  const espera = opcoes.complementar ? null : await aindaNaoEntrega(deps, tarefa, input.doLote ?? null, assentado.id);
  if (espera) return { data: { ignorado: espera } };
  return entregar(deps, { tarefa, texto: input.texto, falha: false, ...(opcoes.complementar ? { complementar: true } : {}) });
}

/**
 * definido em 2026-10-15 (NOD-262): o bot declarou, na conversa, a resposta ao pedido (responder_pedido) — o turno do
 * pedido saiu da fila absorvido e nada da cadeia dele rodou, então não há o que esperar (aindaNaoEntrega). A entrega é
 * a mesma: uma por raiz, ja_entregue se o resultado já saiu.
 */
export function entregarRespostaDeclarada(deps: DepsEntrega, input: { tarefa: Turno; texto: string }): Promise<{ data: SaidaEntregaPeer; events?: RuntimeEvent[] }> {
  return entregar(deps, { tarefa: input.tarefa, texto: input.texto, falha: false });
}

/**
 * A tarefa delegada não vai terminar (definido em 2026-09-24, revisão da ADR-047): o turno do alvo foi
 * interrompido ou terminou sem resposta, ou a pessoa recusou (ou deixou vencer) o acesso que ele pediu.
 * O remetente recebe um aviso curto, uma vez por raiz, para contar à pessoa — antes ele esperava calado.
 * `motivo` é texto do SERVIDOR (motivoEmPortugues ou frase fixa), nunca do modelo.
 * revisto em 2026-09-30 (ADR-063): com um pedido a colega ainda em aberto na cadeia, o aviso também espera — a
 * resposta do colega abre uma continuação que segue a tarefa e entrega; se ela também falhar, avisa então.
 */
// revisto em 2026-10-15 (NOD-252): só repos, escopo e relógio — o varredor de lease (DepsQueda) também avisa.
export async function avisarFalhaDelegacao(deps: DepsEntrega, input: { turnoId: string; motivo: string; semEsperar?: true; paradoPeloChat?: true }): Promise<{ data: SaidaEntregaPeer; events?: RuntimeEvent[] }> {
  const turno = await deps.repos.turnos.buscar(input.turnoId);
  const tarefa = turno ? await delegacaoDoTurno(deps.repos, turno) : null;
  if (!tarefa) return { data: { ignorado: "nao_e_tarefa_peer" } };
  // definido em 2026-10-09 (#218): `semEsperar` — o varredor de pedidos parados já decidiu desistir (task parada, queda
  // sem volta; src/domain/pedido-parado.ts): avisa sem esperar pessoa, colega ou volta. Se a pessoa retomar depois e
  // sair um resultado, ele ainda chega a quem pediu (um resultado depois de um aviso sai normalmente, em `entregar`).
  const espera = input.semEsperar ? null : await aindaNaoEntrega(deps, tarefa, null, input.turnoId);
  if (espera) return { data: { ignorado: espera } };
  return entregar(deps, { tarefa, texto: input.motivo, falha: true, ...(input.paradoPeloChat ? { paradoPeloChat: true as const } : {}) });
}

/**
 * NOD-377: fecha um pedido sem acordar quem pediu — a limpeza dos pedidos com mais de 7 dias. Não
 * espera nada da cadeia (é a decisão final de fechar). Uma vez por raiz, como o aviso: `ja_entregue` se já houve entrega.
 */
export async function fecharPedidoSemAcordar(deps: DepsEntrega, input: { turnoId: string; motivo: string; resultado?: string | null }): Promise<{ data: SaidaEntregaPeer; events?: RuntimeEvent[] }> {
  const turno = await deps.repos.turnos.buscar(input.turnoId);
  const tarefa = turno ? await delegacaoDoTurno(deps.repos, turno) : null;
  if (!tarefa) return { data: { ignorado: "nao_e_tarefa_peer" } };
  // Revisão do PR #544 (M6): o colega concluiu com fala e ninguém entregou — o fecho registra o RESULTADO, não "sem resposta".
  if (input.resultado) return entregar(deps, { tarefa, texto: input.resultado, falha: false, final: true, semAcordar: true });
  return entregar(deps, { tarefa, texto: input.motivo, falha: true, final: true, semAcordar: true });
}

/**
 * NOD-377 (revisão 2 do PR #544, M2): o último recurso do teto. A entrega pela raiz foi ignorada por algo estrutural (o
 * handoff aponta um turno que não é tarefa de colega, o fecho saiu noutra conversa, quem pediu sumiu) e o pedido ficaria
 * aberto para sempre. Grava o peer_ask de fecho direto na conversa do handoff — é ele que tira o pedido de "aberto"
 * (pedidoAbertoSql) — sem acordar ninguém. `motivo` é texto do servidor.
 */
export async function fecharNaConversaDoPedido(deps: DepsEntrega, p: { conversaId: string; tarefaId: string; colega: { id: string; nome: string }; motivo: string }): Promise<RuntimeEvent[]> {
  const autoria = autoriaAgente(p.colega.id, deps.escopo.pessoaId, null);
  const registro = await deps.repos.mensagens.criar({
    conversaId: p.conversaId,
    turnoId: null,
    autoria,
    kind: "peer_ask",
    texto: `${p.colega.nome} não concluiu: ${p.motivo}`,
    payload: { kind: "peer_ask", agenteId: p.colega.id, nome: p.colega.nome, naoSupervisionado: true, tarefaId: p.tarefaId, delegada: true, falhou: true, paradoPelaPessoa: true },
    confianca: "nao_confiavel",
  });
  return registro ? [evento(deps, "mensagem_criada", autoria, { mensagemId: registro.id, kind: "peer_ask", tarefaId: p.tarefaId }, { conversaId: p.conversaId })] : [];
}

/**
 * NOD-377: o Desistir da pessoa — fecha o pedido com o aviso e acorda quem pediu uma vez (ele segue com o que tem e oferece
 * pedir de novo, protótipo aprovado). Final: um resultado tardio do colega só fica registrado. Não espera nada da cadeia.
 */
export async function desistirDoPedido(deps: DepsEntrega, input: { turnoId: string; motivo: string }): Promise<{ data: SaidaEntregaPeer; events?: RuntimeEvent[] }> {
  const turno = await deps.repos.turnos.buscar(input.turnoId);
  const tarefa = turno ? await delegacaoDoTurno(deps.repos, turno) : null;
  if (!tarefa) return { data: { ignorado: "nao_e_tarefa_peer" } };
  return entregar(deps, { tarefa, texto: input.motivo, falha: true, final: true });
}

/**
 * definido em 2026-10-15 (NOD-274): o colega que cumpre um pedido ficou sem cota e o pedido espera (retomada com
 * `acordar_em`). Quem pediu lê, na conversa de onde pediu, UMA linha de sistema com a hora da volta — antes ele não
 * sabia de nada até o aviso de falha. Não é o resultado nem a falha: o aviso de falha continua segurado pela volta
 * (aindaNaoEntrega → aguardando_volta). `texto` é frase do servidor (redigir). Quem chama garante "uma vez por cadeia".
 */
export async function avisarEsperaAoRemetente(deps: DepsEntrega, p: { turno: Turno; texto: string }): Promise<RuntimeEvent[]> {
  const tarefa = await delegacaoDoTurno(deps.repos, p.turno);
  if (!tarefa) return [];
  const pergunta = await perguntaDaTarefa(deps, tarefa);
  if (!pergunta) return [];
  const remetente = await deps.repos.agentes.buscar(pergunta.autoria.autor_id);
  if (!remetente) return [];
  const origem = pergunta.payload?.kind === "peer_pedido" ? pergunta.payload : null;
  const conversa = origem ? await deps.repos.conversas.buscar(origem.conversaOrigemId) : await deps.repos.conversas.buscarPropriaDoAgente(remetente.id);
  if (!conversa) return [];
  const autoria = autoriaAgente(tarefa.agenteId, deps.escopo.pessoaId, tarefa.sobProcuracaoDe ?? null);
  const linha = await deps.repos.mensagens.criar({ conversaId: conversa.id, turnoId: origem?.turnoOrigemId ?? null, autoria, kind: "sistema", assunto: "cota.espera", texto: p.texto, confianca: "confiavel" });
  return linha ? [evento(deps, "mensagem_criada", autoria, { mensagem_id: linha.id, kind: "sistema" }, { conversaId: conversa.id, turnoId: origem?.turnoOrigemId ?? null })] : [];
}
