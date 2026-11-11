import { randomUUID } from "node:crypto";
import type { IaComConta } from "../contracts/contas-ia.ts";
import type { EsperaDaConta } from "../contracts/cota.ts";
import type { Decisao } from "../contracts/decisao.ts";
import type { RuntimeEvent } from "../contracts/evento.ts";
import type { Mensagem } from "../contracts/mensagem.ts";
import { USO_DO_MAC_PADRAO } from "../contracts/raio-x.ts";
import type { LeituraDeMaquinaDto, MaquinaDoTrabalho } from "../contracts/maquina.ts";
import type { LeituraMemoria, NivelPressao, ServicoDasMaquinas, Trabalho, TrabalhoDetalheDto, TrabalhoDto, TrabalhosDto } from "../contracts/trabalho.ts";
import type { Turno } from "../contracts/turno.ts";
import type { PedidoNaFilaDaCota } from "../contracts/cota.ts";
import { cotaParaTela, cotaSegura, esperaDaCotaNaTela, situacaoDaCotaDoTrabalho } from "../domain/cota-da-ia.ts";
import { ehIaComConta } from "../domain/contas-da-pessoa.ts";
import { pedidoEmUmaLinha } from "../domain/delegacao.ts";
import { iasNoLimite } from "../domain/inteligencia.ts";
import { lerCotaDosBots } from "./cota-dos-bots.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { harnessFixado } from "../domain/harness.ts";
import { esperaDaConta, iaDaEntrada } from "../domain/espera-da-cota.ts";
import { acabaLogo, DISCO_ALERTA_MB, DISCO_CRITICO_MB, esperaDoMac, esperaNaMaquina, nivelDoDisco, piorNivel, portaoDoMac, seguravelPeloMac, type PortaoDoMac } from "../domain/memoria-mac.ts";
import { pastaDoBot } from "../domain/nativas.ts";
import { nomeDaMaquina, semContatoDesde as semContatoDaMaquina } from "../domain/presenca-da-maquina.ts";
import { ehFrente, tituloDoLote } from "../domain/frente.ts";
import { estadoDoTrabalho, linhaCurta, pastaDoTrabalho, textoTrabalhoAberto, tituloDoTrabalho, trabalhoAberto, trabalhoFinal } from "../domain/trabalho.ts";
import type { ExtrasTrabalho, NovoTrabalho } from "../repositories/trabalhos.repo.ts";
import { autoriaAgente, autoriaPessoa, evento } from "./autoria-evento.ts";
import { colegaComCota } from "./cota-do-colega.ts";
import { donosDosBots, resolverDePresenca } from "./estado-do-dono.ts";
import { fecharLoteSePronto } from "./fechar-lote.ts";
import { resumoSeFaltar } from "./resumo-sem-chamada.ts";
import { tarefasDasDecisoesFechadas } from "./tarefa-casa.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";
import { situacaoDasFalasNaFrente } from "../domain/fala-na-frente.ts";

/**
 * Trabalhos (definido em 2026-10-07, ADR-083, épico #188): criar, manter o estado e montar o que a tela recebe. O
 * estado nunca é transição solta: quem mexe num turno ou numa decisão de um trabalho chama `sincronizarTrabalho`, que
 * relê os fatos e decide por `estadoDoTrabalho` (src/domain/trabalho.ts).
 */

type DepsTrabalho = Pick<Deps, "repos" | "escopo" | "agora">;

/**
 * O frame `trabalho.mudou` sai pelo outbox: só ids e estado (KindEvento `trabalho_mudou`). revisto em 2026-10-12 (ADR-099,
 * I10): também a forma e o lote; o estado do dono do bot entra no frame na hora de publicar (despachar-outbox.ts).
 */
export function eventoTrabalhoMudou(deps: DepsTrabalho, t: Pick<Trabalho, "id" | "agenteId" | "conversaId" | "estado" | "origem"> & Partial<Pick<Trabalho, "forma" | "loteId">>): RuntimeEvent {
  return evento(deps.escopo, {
    kind: "trabalho_mudou",
    autoria: autoriaAgente({ agenteId: t.agenteId, contaDeExecucao: deps.escopo.pessoaId, executor: "catcher", decididoPor: "regra:trabalhos" }),
    agora: deps.agora(),
    conversaId: t.conversaId,
    dados: { trabalhoId: t.id, agenteId: t.agenteId, conversaId: t.conversaId, estado: t.estado, origem: t.origem, forma: t.forma ?? "task", loteId: t.loteId ?? null },
  });
}

/**
 * Cria o trabalho. A pasta é `~/nod/<bot>/<slug>` (ADR-065), salvo quando quem chama já decidiu outra. revisto em
 * 2026-10-08 (revisão do épico, S13): toda origem ganha a sua — rotina e rede também. `pasta: null` = a pasta do bot.
 */
export async function criarTrabalho(deps: DepsTrabalho, n: Omit<NovoTrabalho, "titulo"> & { titulo: string }): Promise<{ trabalho: Trabalho; events: RuntimeEvent[] }> {
  const titulo = tituloDoTrabalho(n.titulo);
  const id = n.id ?? randomUUID();
  let pasta = n.pasta;
  if (pasta === undefined) {
    const agente = await deps.repos.agentes.buscar(n.agenteId);
    pasta = agente ? pastaDoTrabalho(pastaDoBot(agente.nome), titulo, id) : null;
  }
  const trabalho = await deps.repos.trabalhos.criar({ ...n, id, titulo, pasta });
  if (!trabalho) throw new ErroDeDominio("estado_invalido", { cause: "trabalho não criado" });
  return { trabalho, events: [eventoTrabalhoMudou(deps, trabalho)] };
}

/**
 * Relê os fatos do trabalho e grava o estado novo, se mudou (com trava de linha: duas sincronizações seguidas não se
 * atropelam). Devolve o evento `trabalho_mudou` só na mudança. Sem trabalho, nada.
 * definido em 2026-10-15 (NOD-256, F1.3): `reabrir` só no caminho da pessoa (mensagem na task, Retomar); sem ele a task
 * `parada` fica onde está (`mudarEstado` recusa) — a resposta de um colega ou a sincronização atrasada não a reabrem.
 */
export async function sincronizarTrabalho(deps: DepsTrabalho, trabalhoId: string | null | undefined, opcoes: { reabrir?: true; guardaResumo?: true } = {}): Promise<RuntimeEvent[]> {
  if (!trabalhoId) return [];
  const atual = await deps.repos.trabalhos.buscarTravado(trabalhoId);
  if (!atual) return [];
  const fatos = await deps.repos.trabalhos.fatos(trabalhoId);
  if (!fatos) return [];
  const novo = estadoDoTrabalho({ ...fatos, estadoAtual: atual.estado, iniciado: atual.iniciadoEm !== null });
  if (novo === atual.estado) return [];
  // `terminado`/`falhou` reabrem pelos fatos como antes (turno novo, decisão aberta, resposta de colega);
  // `parado` é da pessoa e só ela o reabre (`reabrir`).
  const reabre = opcoes.reabrir === true || atual.estado !== "parado";
  const mudou = await deps.repos.trabalhos.mudarEstado(trabalhoId, novo, deps.agora(), reabre ? { reabrir: true } : {});
  if (!mudou) return [];
  // NOD-282 (G7): a frente que já tinha voltado ao dono foi reaberta — o resumo de antes fica guardado, e a volta a final
  // dela ganha o resumo novo (o retorno complementar compara os dois).
  // NOD-376: `guardaResumo` (a pessoa conversando na frente acabada) guarda a cópia sem zerar o atual: a conversa que só
  // conversa não troca o resumo (devolver_resumo a ignora) e nada volta; a que vira trabalho devolve o novo, e o complementar sai.
  if (ehFrente(mudou) && mudou.loteId && trabalhoFinal(atual.estado) && !trabalhoFinal(novo) && (await deps.repos.frentes.buscarLote(mudou.loteId))?.devolvidoEm != null) {
    await deps.repos.frentes.arquivarResumo(mudou.id, opcoes.guardaResumo ? { manterAtual: true } : {});
  }
  // ADR-099 (I2): a frente que acabou sem devolver_resumo ganha o resumo montado pelo servidor.
  await resumoSeFaltar(deps, mudou, fatos.perguntaVencida ? { perguntaVencida: true, ...(fatos.vencidaTipo ? { vencidaTipo: fatos.vencidaTipo } : {}) } : {});
  // ADR-099 (I3): e fecha o lote dela, se era a vez (o trabalho já está travado; o lote trava por último).
  return [eventoTrabalhoMudou(deps, mudou), ...(await fecharLoteSePronto(deps, mudou))];
}

/**
 * O evento `pressao_memoria` (#194): o nível que a pessoa vê mudou. Pelo outbox ele vira o frame `memoria.mudou {nivel}`
 * (despachar-outbox.ts); grava também o anterior e o total, só números (DadosEvento é escalar).
 */
export function eventoPressao(deps: DepsTrabalho, mudanca: { nivel: NivelPressao; anterior: NivelPressao | null; processador?: NivelPressao | null; disco?: NivelPressao | null }, leitura: Pick<LeituraMemoria, "totalMb">): RuntimeEvent {
  return evento(deps.escopo, {
    kind: "pressao_memoria",
    autoria: autoriaPessoa(deps.escopo),
    agora: deps.agora(),
    // ADR-085: o processador vai junto (a mudança só dele também vira o frame, e a lista relê o `segurando`).
    // #219: e o nível do pior disco (a mudança dele também vira o frame).
    dados: { nivel: mudanca.nivel, anterior: mudanca.anterior, processador: mudanca.processador ?? null, disco: mudanca.disco ?? null, totalMb: Math.round(leitura.totalMb) },
  });
}

/** O turno pertence a um trabalho? Sincroniza o dele. */
export function sincronizarDoTurno(deps: DepsTrabalho, turno: Pick<Turno, "trabalhoId"> | null | undefined): Promise<RuntimeEvent[]> {
  return sincronizarTrabalho(deps, turno?.trabalhoId ?? null);
}

/**
 * definido em 2026-10-08 (revisão do épico, S2): uma decisão saiu de aberta (decidida, respondida, dispensada, vencida,
 * fechada por regra) — o trabalho do turno dela relê os fatos. Sem isto a task ficava `precisa_de_voce` para sempre, e
 * a que esperava por ela (`depois_de`) nunca começava. É o ponto comum de todos esses caminhos; roda na transação da
 * DONA (mudarEstado exige owner = pessoa) e depois de a retomada, se houver, já estar na fila.
 */
export async function sincronizarDasDecisoes(deps: DepsTrabalho & Partial<Pick<Deps, "services" | "useCases">>, decisoes: readonly Pick<Decisao, "turnoId" | "tarefaId" | "estado" | "desfecho">[]): Promise<RuntimeEvent[]> {
  // ADA-28 (ADR-159): a decisão ligada a uma tarefa e respondida fora do card tira a tarefa de "Precisa de você".
  // Quem chama sem services/useCases (a Sua vez ao dispensar ou reabrir) não responde: nada a espelhar na tarefa.
  const daTarefa = deps.services && deps.useCases ? await tarefasDasDecisoesFechadas(deps as Deps, decisoes) : [];
  const trabalhos = new Set<string>();
  for (const d of decisoes) {
    const turno = d.turnoId ? await deps.repos.turnos.buscar(d.turnoId) : null;
    if (turno?.trabalhoId) trabalhos.add(turno.trabalhoId);
  }
  const events: RuntimeEvent[] = [];
  for (const id of trabalhos) events.push(...(await sincronizarTrabalho(deps, id)));
  return [...daTarefa, ...events];
}

/** A regra que fecha as decisões de uma task parada (revisão do épico, S1). */
export const REGRA_TRABALHO_PARADO = "regra:trabalho_parado" as const;

/**
 * definido em 2026-10-08 (revisão do épico, S1): o Parar da task, o "Fazer aqui" e o Parar do chat fecham por regra as
 * decisões ainda abertas dos turnos do trabalho (a proposta de mesmo id, pendente, sai recusada, como em fecharGemeas).
 * Antes a aprovação aberta voltava a task para `precisa_de_voce` e, aprovada depois do Parar, abria uma retomada que a
 * reabria. Na transação da dona (fecharPorRegra exige owner = pessoa).
 */
export async function fecharDecisoesDoTrabalho(deps: DepsTrabalho, trabalhoId: string): Promise<RuntimeEvent[]> {
  const agora = deps.agora();
  const events: RuntimeEvent[] = [];
  const autoria = { ...autoriaPessoa(deps.escopo), decidido_por: REGRA_TRABALHO_PARADO };
  for (const d of await deps.repos.decisoes.abertasDoTrabalho(trabalhoId)) {
    const fechada = await deps.repos.decisoes.fecharPorRegra(d.id, { regra: REGRA_TRABALHO_PARADO, regraVersao: 1, agora });
    if (!fechada) continue;
    // Ninguém continua esta decisão: sem a marca, o assentamento do turno parado (continuarAprovacoesDoTurno) via uma
    // aprovação 'decidida' sem continuação e abria a retomada que reabria a task (medido no teste da S1).
    await deps.repos.decisoes.reivindicarContinuacao(fechada.id, "turno", agora);
    const proposta = await deps.repos.propostas.buscar(fechada.id);
    if (proposta?.estado === "pendente") await deps.repos.propostas.decidir(proposta.id, "recusada");
    events.push(evento(deps.escopo, { kind: "decisao_decidida", autoria, agora, conversaId: fechada.conversaId, turnoId: fechada.turnoId, dados: { decisao_id: fechada.id, tipo: fechada.tipo, regra: REGRA_TRABALHO_PARADO, trabalho_id: trabalhoId } }));
  }
  return events;
}

/**
 * A linha centralizada "Abriu a task …" (mensagem `sistema` com payload `trabalho_aberto`) na conversa do trabalho.
 * `turnoId`: o turno que abriu (a conversa coordenadora, ou o turno promovido pela rede); null quando a fixture ou a
 * pessoa abre.
 */
export async function linhaTrabalhoAberto(deps: DepsTrabalho, t: Trabalho, turnoId: string | null): Promise<RuntimeEvent[]> {
  const autoria = autoriaAgente({ agenteId: t.agenteId, contaDeExecucao: deps.escopo.pessoaId, executor: "catcher", decididoPor: "regra:trabalhos" });
  const m = await deps.repos.mensagens.criar({
    conversaId: t.conversaId,
    turnoId,
    autoria,
    kind: "sistema",
    texto: textoTrabalhoAberto(t.titulo, t.origem),
    payload: { kind: "trabalho_aberto", trabalhoId: t.id, titulo: t.titulo, origem: t.origem },
    confianca: "confiavel",
  });
  return m ? [evento(deps.escopo, { kind: "mensagem_criada", autoria, agora: deps.agora(), conversaId: t.conversaId, turnoId, dados: { mensagem_id: m.id, kind: "sistema", trabalho_id: t.id } })] : [];
}

/**
 * O que a web recebe (TrabalhoDto): sem sessão nem tenant, com o nome de quem pediu, a rotina (a primeira linha da
 * instrução), o último passo (a última fala do bot no trabalho, curta) e o turno vivo. `esperandoComputadorDe` vem do
 * serviço do computador (S5), quando há.
 */
export async function trabalhosParaDto(deps: Pick<Deps, "repos" | "services" | "agora">, trabalhos: readonly Trabalho[], alemDisso?: (t: TrabalhoDto, e: ExtrasTrabalho | undefined) => Partial<TrabalhoDto>): Promise<TrabalhoDto[]> {
  const extras = await deps.repos.trabalhos.extras(trabalhos.map((t) => t.id), deps.agora());
  const colegas = new Map<string, TrabalhoDto["esperandoColega"]>();
  for (const [id, e] of extras) if (e.esperandoColega) colegas.set(id, await colegaComCota(deps.repos, e.esperandoColega, deps.agora()));
  const esperasDaCota = await esperasDaCotaDe(deps, trabalhos);
  return trabalhos.map((t): TrabalhoDto => {
    const { tenantId: _tenant, sessaoCli: _sessao, sessaoHarness: _harness, sessaoExecutor: _executor, ...publico } = t;
    const e = extras.get(t.id);
    const vivo = e?.turnoVivoId ?? null;
    return {
      ...publico,
      pedidoPorNome: e?.pedidoPorNome ?? null,
      rotinaNome: e?.rotinaNome ? linhaCurta(e.rotinaNome) : null,
      // O nome da última ferramenta do turno vivo (o processo sabe) ganha da última fala, que pode ser de minutos atrás.
      // NOD-350: e a contagem dos subagentes que ainda trabalham ganha das duas (o bot pode ter falado e estar esperando).
      ultimoPasso: (vivo ? (deps.services.trabalhosVivos?.resumoSubagentes?.(vivo) ?? deps.services.trabalhosVivos?.ultimaFerramenta(vivo)) : null) ?? (e?.ultimaFala ? linhaCurta(e.ultimaFala) : null),
      turnoVivoId: vivo,
      // revisto em 2026-10-08 (ADR-085): a memória é a do processo vivo. Sem turno vivo (esperando você, um colega ou a
      // vez na fila) não há processo, e a última leitura gravada fazia "Todos os trabalhos" somar vários GB que o Mac
      // não usava (o topo dizia 606 MB e as linhas, 18 × 200–400 MB).
      memoriaMb: vivo ? t.memoriaMb : null,
      seguravel: t.estado === "na_fila" && seguravelPeloMac(t, deps.agora()),
      deFora: e?.deFora ?? false,
      esperandoColega: colegas.get(t.id) ?? null,
      trabalhouMs: e?.trabalhouMs ?? 0,
      acordaEm: e?.acordaEm ?? null,
      esperandoComando: e?.esperandoComando ?? null,
      acordaMotivo: e?.acordaMotivo ?? null,
      lote: e?.lote ?? null,
      tituloDoLote: e?.lote ? tituloDoLote(e.loteTitulo ?? null, e.lote.frentes, t.titulo) : null,
      esperandoComputadorDe: (e?.turnosAbertos ?? []).map((id) => deps.services.computadores?.esperandoPor?.(id) ?? null).find((x) => x !== null) ?? null,
      // definido em 2026-10-15 (NOD-277): só quando espera a cota — a task sem espera segue sem o campo.
      ...(esperasDaCota.has(t.id) ? { esperaDaConta: esperasDaCota.get(t.id)! } : {}),
    };
  }).map((dto) => (alemDisso ? { ...dto, ...alemDisso(dto, extras.get(dto.id)) } : dto));
}

/**
 * definido em 2026-10-15 (NOD-277, pacote A3): as tasks abertas paradas esperando a cota (a retomada da cota marcada) e as
 * contas livres da mesma IA, numa leitura para a lista inteira.
 */
async function esperasDaCotaDe(deps: Pick<Deps, "repos">, trabalhos: readonly Trabalho[]): Promise<Map<string, EsperaDaConta>> {
  const abertos = trabalhos.filter((t) => trabalhoAberto(t.estado)).map((t) => t.id);
  const retomadas = await deps.repos.esperasDaCota.doTrabalhos(abertos);
  if (retomadas.size === 0) return new Map();
  const ias = new Set<IaComConta>();
  for (const r of retomadas.values()) {
    const ia = r.conta?.ia ?? iaDaEntrada(r.entrada)?.ia ?? null;
    if (ia && ehIaComConta(ia)) ias.add(ia);
  }
  const livres = await deps.repos.esperasDaCota.livres([...ias]);
  const saida = new Map<string, EsperaDaConta>();
  for (const [id, r] of retomadas) {
    const espera = esperaDaConta(r, livres);
    if (espera) saida.set(id, espera);
  }
  return saida;
}

/**
 * ADR-085: o portão do topo, que junta as máquinas da pessoa (a pior leitura). Sem leitura nos últimos 2 min, aberto.
 * QA do PR 341 (C15): a regra "linux só a vermelha" vale para ele quando TODAS as máquinas com leitura são linux (com
 * uma darwin no meio, a pior pode ser dela, e o topo fica com a regra de sempre). Desligada, nada muda.
 * ADA-16 (ADR-163): o card do quadro usa o mesmo portão para dizer que a tarefa espera a máquina, e por quê.
 */
export function portaoDoTopo(deps: Pick<Deps, "escopo"> & { services: Pick<Deps["services"], "trabalhosVivos" | "maquinas"> }, usoDoMac: Parameters<typeof portaoDoMac>[0]): PortaoDoMac {
  const memoria = deps.services.trabalhosVivos?.memoria(deps.escopo.pessoaId) ?? null;
  if (memoria === null) return portaoDoMac("livre", null);
  const servico = deps.services.maquinas;
  const leituras = servico ? servico.leituras(deps.escopo.pessoaId) : [];
  const linux = leituras.length > 0 && leituras.every((l) => servico?.plataforma?.(deps.escopo, l.machineId) === "linux");
  const regra = linux ? { plataforma: "linux" as const, linuxSoVermelha: servico?.fundoLinuxSoVermelha === true } : {};
  const nivelDisco = memoria.discoNivel !== undefined ? memoria.discoNivel : nivelDoDisco(memoria.disco ?? null);
  return portaoDoMac(usoDoMac, { memoria: memoria.nivel, processador: piorNivel(memoria.processador ?? null, memoria.fila ?? null), discoNivel: nivelDisco }, regra);
}

/** definido em 2026-10-07: "Terminados hoje" — o servidor manda as últimas 24 h e a tela corta no dia dela. */
export const JANELA_TERMINADOS_MS = 24 * 60 * 60_000;

/**
 * GET trabalhos(?agenteId=): os abertos e os terminados nas últimas 24 h, do bot ou de todos os bots da pessoa, e a
 * pressão de memória dos Macs dela (null = nenhum Mac mandou leitura nos últimos 2 min).
 */
export const listarTrabalhos: CasoDeUso<{ agenteId?: string }, TrabalhosDto> = async (deps, input) => {
  if (input.agenteId && !(await deps.repos.agentes.buscar(input.agenteId))) throw new ErroDeDominio("nao_encontrado");
  const trabalhos = await deps.repos.trabalhos.listar({ agenteId: input.agenteId, terminadosDesde: deps.agora() - JANELA_TERMINADOS_MS });
  const memoria = deps.services.trabalhosVivos?.memoria(deps.escopo.pessoaId) ?? null;
  const processador = memoria?.processador ?? null;
  // ADR-085: os campos de topo juntam as máquinas da pessoa e mostram a pior (a web de antes lê só eles). Revisto em
  // 2026-10-09 (a tela fala por máquina): cada trabalho e cada máquina vêm com o portão da própria máquina (abaixo).
  // #219 (emenda à ADR-085): o portão inteiro e o motivo; o disco vai com o nível e os limites, que moram só no domínio.
  const disco = memoria?.disco ?? null;
  // Revisão do #224: o nível vem com a histerese (trabalhos-vivos.ts); sem ele (serviço de teste), o nível cru.
  const nivelDisco = memoria?.discoNivel !== undefined ? memoria.discoNivel : nivelDoDisco(disco);
  // ADR-091: o portão olha o pior entre a CPU e a fila; a tela mostra os dois separados.
  const fila = memoria?.fila ?? null;
  const [preferencias, cotaDosBots, agentes] = await Promise.all([deps.repos.preferencias.buscar(), lerCotaDosBots(deps), deps.repos.agentes.listar()]);
  const usoDoMac = memoria === null ? "livre" : preferencias.usoDoMac ?? USO_DO_MAC_PADRAO;
  // definido em 2026-10-12 (ADR-099 §7): a cota da IA, a mesma regra do `reivindicar` (domain/cota-da-ia.ts). A pílula diz
  // quando o fundo volta; a linha da task diz que ela espera a cota.
  // NOD-253 (2026-10-15): a IA com conta da lista segura só quando nenhuma conta dela serve. A tela não sabe a máquina do
  // próximo turno: conta como logada a conta `pronta` em qualquer máquina da pessoa. NOD-302: a mesma leitura do
  // `pedir_a_bot` (lerCotaDosBots).
  const cotaAgora = cotaDosBots.cota;
  const conhecidas = cotaDosBots.conhecidas;
  const botsPorId = new Map(agentes.map((a) => [a.id, a]));
  const servico = deps.services.maquinas;
  // NOD-260 (D3): as IAs prontas nas máquinas vivas decidem o Automático; a IA do turno pendente mais antigo, a fixa.
  const iasProntas = servico?.iasProntas ? servico.iasProntas(deps.escopo.pessoaId) : null;
  const noLimite = iasNoLimite(preferencias.iasNoLimite, deps.agora());
  const cotaDoTrabalho = (t: TrabalhoDto, e: ExtrasTrabalho | undefined): Partial<TrabalhoDto> => {
    if (cotaAgora.length === 0 || !trabalhoAberto(t.estado)) return {};
    const bot = botsPorId.get(t.agenteId);
    const situacao = situacaoDaCotaDoTrabalho({ pendente: e?.pendente, bot: bot ? { harness: bot.harness ?? "auto", modelo: bot.modelo } : null, cota: cotaAgora, iasProntas, noLimite, conhecidas });
    return esperaDaCotaNaTela(t, situacao) ? { esperaDaCota: true } : {};
  };
  // NOD-302: o pedido de colega sem task que a cota segura não tem linha de task — vai à parte, "na fila (cota)".
  const pedidosNaFila: PedidoNaFilaDaCota[] = [];
  if (cotaAgora.length > 0) {
    for (const t of await deps.repos.turnos.pedidosNaFila({ agenteId: input.agenteId })) {
      const bot = botsPorId.get(t.agenteId);
      const espera = cotaDosBots.doBot({ harness: t.harness, modelo: t.modelo });
      if (!bot || bot.excluidoEm || espera.situacao === "livre" || !cotaSegura("fundo_novo", espera.situacao)) continue;
      const { de, pedido } = pedidoEmUmaLinha(t.entradaTexto);
      pedidosNaFila.push({ turnoId: t.id, agenteId: t.agenteId, de, pedido, ia: espera.ia, situacao: espera.situacao, voltaEm: espera.voltaEm, criadoEm: t.criadoEm });
    }
  }
  const portao = portaoDoTopo(deps, usoDoMac);
  const agora = deps.agora();
  const topo = { cota: cotaParaTela(cotaAgora), pedidosNaFila, pressao: memoria?.nivel ?? null, memoriaTotalMb: memoria?.totalMb ?? null, processador, cargaProcessador: memoria?.carga ?? null, usoProcessador: memoria?.uso ?? null, fila, segurando: portao.fundo !== null, motivoEspera: portao.fundo, seguraTudoNovo: portao.tudoNovo !== null, disco: disco && nivelDisco ? { ...disco, nivel: nivelDisco, alertaMb: DISCO_ALERTA_MB, criticoMb: DISCO_CRITICO_MB, acabaEmMs: acabaLogo(memoria?.discoAcabaEmMs) } : null, discoSuportado: memoria?.discoSuportado ?? disco !== null };
  // definido em 2026-10-12 (ADR-099, I10): o dono de cada bot (a linha do bot em Trabalhos), calculado aqui no servidor.
  const bots = input.agenteId ? [input.agenteId] : agentes.filter((a) => a.ownerId === deps.escopo.pessoaId && !a.excluidoEm).map((a) => a.id);
  // Sem o serviço das máquinas (serviço de teste antigo): o portão único de antes.
  if (!servico) {
    const donos = [...(await donosDosBots(deps, bots, trabalhos)).values()];
    const dtos = await trabalhosParaDto(deps, trabalhos, (t, e) => {
      const motivo = esperaDoMac(t, portao, agora);
      return { ...(motivo ? { esperaDoMac: motivo } : {}), ...cotaDoTrabalho(t, e) };
    });
    return { data: { trabalhos: dtos, ...topo, donos } };
  }
  const { maquinas, ondeRoda, ultimoUso, nomes } = await maquinaDosTrabalhos(deps, servico, usoDoMac);
  // NOD-300: a frente presa a máquina sem contato espera no dono, pela mesma regra (e o mesmo último uso) da linha dela.
  const donos = [...(await donosDosBots(deps, bots, trabalhos, servico.conectada ? resolverDePresenca(servico, deps.escopo, ultimoUso, nomes) : undefined)).values()];
  const dtos = await trabalhosParaDto(deps, trabalhos, (t, e) => ({ ...ondeRoda(t, e), ...cotaDoTrabalho(t, e) }));
  return { data: { trabalhos: dtos, ...topo, maquinas, donos } };
};

/**
 * Onde cada trabalho aberto roda ou vai rodar (`maquina`) e a espera do portão daquela máquina (`esperaDoMac`). A lista e
 * o detalhe da task usam a mesma regra (QA do NOD-314: o detalhe vinha sem `maquina` e o topo da task perdia a espera).
 */
async function maquinaDosTrabalhos(deps: Pick<Deps, "escopo" | "repos" | "agora">, servico: ServicoDasMaquinas, usoDoMac: Parameters<typeof portaoDoMac>[0]) {
  // NOD-260 (G8): o último uso da chave de cada máquina, para "sem contato desde HH:MM" (a regra do chip da conversa).
  // QA do NOD-314 / achado do QA no #427: e o nome que a pessoa deu à chave, para a máquina sem contato (que a ponte já
  // esqueceu) não virar "máquina f448f227".
  const chaves = await deps.repos.maquinaTokens.listar();
  const ultimoUso = servico.conectada ? new Map(chaves.map((c) => [c.id, c.ultimoUsoEm])) : new Map<string, number | null>();
  const nomes = new Map(chaves.map((c) => [c.id, c.nome]));
  const { maquinas, portoes, nomear, semContatoDesde } = maquinasDaPessoa(deps, servico, usoDoMac, ultimoUso, nomes);
  // ADR-121 (NOD-92): a máquina na nuvem que acorda para o trabalho ("Acordando <máquina>…"). Sem a flag, nenhuma linha.
  const acordando = await deps.repos.maquinasNuvem.idsAcordando();
  const agora = deps.agora();
  const ondeRoda = (t: TrabalhoDto, e: ExtrasTrabalho | undefined): Partial<TrabalhoDto> => {
    if (!trabalhoAberto(t.estado)) return {};
    // Onde roda (o turno vivo) ou vai rodar (o alvo do turno na fila, a regra do reivindicar); sem alvo, no modo local,
    // o Mac do servidor (ADR-092); no compartilhado, qualquer uma (null).
    const id = e?.maquinaVivaId ?? e?.maquinaAlvoId ?? servico.macDoServidor;
    const espera = esperaNaMaquina(t, id, portoes, agora, semContatoDesde);
    const maquina = espera?.maquinaId ?? id;
    // G12: a espera pela máquina sem contato não é do portão (memória, disco, processador): a linha a diz pela máquina.
    const motivo = espera && espera.motivo !== "sem_contato" ? espera.motivo : null;
    // QA do NOD-314: a IA fixada do turno na fila, para o "desta vez" do topo seguir a regra da conversa.
    const iaFixada = e?.pendente ? harnessFixado(e.pendente.harness, e.pendente.modelo) : null;
    return { esperaDoMac: motivo, maquina: maquina === null ? null : { ...nomear(maquina), ...(acordando.has(maquina) ? { acordando: true } : {}) }, iaFixada };
  };
  return { maquinas, ondeRoda, ultimoUso, nomes };
}

/**
 * A tela fala por máquina (2026-10-09): cada máquina viva da pessoa com o nome, o portão (pelo "uso do Mac", que vale
 * para todas) e a leitura. Máquina que mandou leitura e já não está conectada fica com o id curto ("máquina 309ec3dd").
 */
function maquinasDaPessoa(deps: Pick<Deps, "escopo">, servico: ServicoDasMaquinas, usoDoMac: Parameters<typeof portaoDoMac>[0], ultimoUso: ReadonlyMap<string, number | null> = new Map(), nomes?: ReadonlyMap<string, string>) {
  // NOD-260 (G8): sem contato = não conectada (contato há 60 s ou mais), desde o último uso da chave. O Mac do servidor
  // fala sempre; sem o serviço saber (`conectada` ausente) ou sem o último uso, null — na dúvida, não acusa.
  // NOD-300: a regra mora em src/domain/presenca-da-maquina.ts, a mesma do estado do dono.
  const semContatoDesde = (id: string): number | null => semContatoDaMaquina(servico, deps.escopo, id, ultimoUso);
  const nomear = (id: string): MaquinaDoTrabalho => ({ ...nomeDaMaquina(servico, deps.escopo, id, nomes), ...(servico.conectada ? { semContatoDesde: semContatoDesde(id) } : {}) });
  const portoes = new Map<string, PortaoDoMac>();
  const maquinas: LeituraDeMaquinaDto[] = servico.leituras(deps.escopo.pessoaId).map((l) => {
    const portao = portaoDoMac(usoDoMac, { memoria: l.nivel, processador: l.portao, discoNivel: l.discoNivel }, { plataforma: servico.plataforma?.(deps.escopo, l.machineId) ?? null, linuxSoVermelha: servico.fundoLinuxSoVermelha === true });
    portoes.set(l.machineId, portao);
    return {
      ...nomear(l.machineId),
      pressao: l.nivel,
      memoriaBotsMb: l.totalMb,
      processador: l.processador,
      usoProcessador: l.uso,
      cargaProcessador: l.carga,
      fila: l.fila,
      // ADR-096 §6: com a estimativa de quando o livre chega ao vermelho, só abaixo de 24 h (null = longe ou não cai).
      disco: l.disco && l.discoNivel ? { ...l.disco, nivel: l.discoNivel, alertaMb: DISCO_ALERTA_MB, criticoMb: DISCO_CRITICO_MB, acabaEmMs: acabaLogo(l.discoAcabaEmMs) } : null,
      discoSuportado: l.discoMedido,
      motivoEspera: portao.fundo,
      seguraTudoNovo: portao.tudoNovo !== null,
    };
  });
  return { maquinas, portoes, nomear, semContatoDesde };
}

/**
 * GET trabalhos/:id (a tela da task): o trabalho e as mensagens dele — as falas dos turnos dele (inclui as do meio) e
 * as falas da pessoa que abriram um turno dele (`mensagem_origem_id`).
 */
export const detalharTrabalho: CasoDeUso<{ trabalhoId: string }, TrabalhoDetalheDto> = async (deps, input) => {
  const t = await deps.repos.trabalhos.buscar(input.trabalhoId);
  if (!t) throw new ErroDeDominio("nao_encontrado");
  // QA do NOD-314: o detalhe leva a máquina como a lista (a tela da task prefere o detalhe).
  const servico = deps.services.maquinas;
  const usoDoMac = servico ? (deps.services.trabalhosVivos?.memoria(deps.escopo.pessoaId) ? (await deps.repos.preferencias.buscar()).usoDoMac ?? USO_DO_MAC_PADRAO : "livre") : "livre";
  const onde = servico ? (await maquinaDosTrabalhos(deps, servico, usoDoMac)).ondeRoda : undefined;
  const [dto] = await trabalhosParaDto(deps, [t], onde);
  const mensagens: Mensagem[] = await deps.repos.mensagens.doTrabalho(t.id);
  // NOD-376: o estado de cada fala da pessoa ainda sem resposta ("na fila" → "entregue" → some), do que o servidor sabe.
  const falasNaFila = situacaoDasFalasNaFrente(await deps.repos.turnos.doTrabalho(t.id), mensagens);
  return { data: { trabalho: dto!, mensagens, ...(falasNaFila.length ? { falasNaFila } : {}) } };
};

/**
 * #194: a memória do Mac apertou e a task esperava a pessoa dentro do turno — a espera é solta (o turno encerra e o
 * processo fecha), a task fica `fechado_ocioso` e volta do mesmo ponto (--resume) quando a pessoa responder. A conversa
 * ganha uma linha curta. Turno sem trabalho não é fechado (a conversa é a da pessoa).
 */
export async function fecharPorMemoria(deps: DepsTrabalho, turnoId: string): Promise<{ fechou: boolean; events: RuntimeEvent[] }> {
  const turno = await deps.repos.turnos.buscar(turnoId);
  if (!turno?.trabalhoId) return { fechou: false, events: [] };
  const t = await deps.repos.trabalhos.buscarTravado(turno.trabalhoId);
  if (!t || !trabalhoAberto(t.estado)) return { fechou: false, events: [] };
  if (t.estado === "fechado_ocioso") return { fechou: true, events: [] };
  const fechado = await deps.repos.trabalhos.mudarEstado(t.id, "fechado_ocioso", deps.agora());
  if (!fechado) return { fechou: false, events: [] };
  const autoria = autoriaAgente({ agenteId: t.agenteId, contaDeExecucao: deps.escopo.pessoaId, executor: "catcher", decididoPor: "regra:memoria" });
  const linha = await deps.repos.mensagens.criar({ conversaId: t.conversaId, autoria, kind: "sistema", assunto: "memoria.task_fechada", texto: `Fechei a task "${t.titulo}", parada esperando você, para liberar memória. Ela volta do mesmo ponto quando você responder.`, confianca: "confiavel" });
  const events = [eventoTrabalhoMudou(deps, fechado)];
  if (linha) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora: deps.agora(), conversaId: t.conversaId, dados: { mensagem_id: linha.id, kind: "sistema", trabalho_id: t.id } }));
  return { fechou: true, events };
}

/**
 * Os abertos de um trabalho que o Parar mexe: o trabalho é parado mesmo que o turno ainda esteja acabando, e as decisões
 * abertas dele fecham por regra (S1) — `parado` vence a decisão na derivação, e nenhuma aprovação depois o reabre.
 */
export async function marcarParado(deps: DepsTrabalho, t: Trabalho): Promise<RuntimeEvent[]> {
  if (trabalhoFinal(t.estado)) return [];
  const events = await fecharDecisoesDoTrabalho(deps, t.id);
  // ADR-099 (parte 2): o comando que a task deixou esperando para junto (o motor mata o grupo no próximo puxar).
  await deps.repos.esperas.cancelarRodando({ trabalhoId: t.id }, "parada pela pessoa", deps.agora());
  const parado = await deps.repos.trabalhos.mudarEstado(t.id, "parado", deps.agora());
  if (parado) {
    await resumoSeFaltar(deps, parado);
    events.push(eventoTrabalhoMudou(deps, parado));
    // ADR-099 (I3): a frente parada pela pessoa conta como encerrada — o lote fecha com o que tiver.
    events.push(...(await fecharLoteSePronto(deps, parado)));
  }
  return events;
}

/**
 * definido em 2026-10-08 (revisão do épico, S20): a ORDEM ÚNICA das travas de um trabalho — as linhas dos turnos abertos
 * dele primeiro (em ordem de criação), depois a do trabalho. É a ordem da renovação e da entrega (turno → recados →
 * trabalho, via sincronizarTrabalho). O Parar e o "Fazer aqui" travavam o trabalho e depois os turnos: 40P01 contra uma
 * entrega em curso, e se a vítima era a entrega a resposta do bot se perdia.
 */
export async function travarTrabalhoComTurnos(deps: Pick<Deps, "repos">, trabalhoId: string): Promise<Trabalho & { turnos: Turno[] }> {
  if (!(await deps.repos.trabalhos.buscar(trabalhoId))) throw new ErroDeDominio("nao_encontrado");
  const turnos = await deps.repos.turnos.travarAbertosDoTrabalho(trabalhoId);
  const t = await deps.repos.trabalhos.buscarTravado(trabalhoId);
  if (!t) throw new ErroDeDominio("nao_encontrado");
  return { ...t, turnos };
}

/**
 * Parar uma task só (POST trabalhos/:id/parar): interrompe os pendentes dela, pede a interrupção do que roda (a
 * próxima renovação devolve {ativo:false}) e tenta o SIGTERM pelo interruptor. Não abre parada: a conversa e as outras
 * tasks seguem.
 */
export const pararTrabalho: CasoDeUso<{ trabalhoId: string }, { trabalho: TrabalhoDto; interrompidos: number }> = async (deps, input) => {
  const t = await travarTrabalhoComTurnos(deps, input.trabalhoId);
  const agora = deps.agora();
  const autoria = autoriaPessoa(deps.escopo);
  const events: RuntimeEvent[] = [];
  const turnos = t.turnos;
  let interrompidos = 0;
  for (const p of turnos.filter((x) => x.estado === "pendente")) {
    if (!(await deps.repos.turnos.interromper(p.id, "parado_pela_pessoa"))) continue;
    interrompidos += 1;
    events.push(evento(deps.escopo, { kind: "turno_interrompido", autoria, agora, conversaId: p.conversaId, turnoId: p.id, dados: { motivo: "parado_pela_pessoa", estava: "pendente", trabalho_id: t.id } }));
  }
  const vivos = turnos.filter((x) => x.estado === "despachando").map((x) => x.id);
  interrompidos += await deps.repos.turnos.pedirInterrupcao(vivos, agora);
  for (const id of vivos) await deps.services.interruptor.interromper(id).catch(() => false);
  const { turnos: _turnos, ...trabalho } = t;
  events.push(...(await marcarParado(deps, trabalho)));
  const atual = (await deps.repos.trabalhos.buscar(t.id)) ?? trabalho;
  const [dto] = await trabalhosParaDto(deps, [atual]);
  return { data: { trabalho: dto!, interrompidos }, events };
};

