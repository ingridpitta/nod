import type { Espera, RelatoEspera, RespostaRelatoEspera } from "../contracts/espera.ts";
import type { RuntimeEvent } from "../contracts/evento.ts";
import type { CasoNod } from "../contracts/servicos.ts";
import type { Turno } from "../contracts/turno.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { decidirQuedaDaEspera, esperaSemNoticia, fraseDaVolta, instrucaoDaRecusa, MOTIVO_QUEDA_ESPERA, ultimasLinhas, validarPedidoEspera, type CausaQuedaEspera } from "../domain/espera-comando.ts";
import { redigirSegredos } from "../domain/segredos.ts";
import { trabalhoAberto } from "../domain/trabalho.ts";
import { VOLTAS_SEGUIDAS_MAX } from "../contracts/ferramentas-trabalho.ts";
import { log } from "../obs/log.ts";
import { comandoRodaSemCard } from "./autorizar-comando.ts";
import { enfileirarVolta, origemDaVolta } from "./me-chame-as.ts";
import type { Deps } from "./tipos.ts";
import type { AlvoCancelarEsperas } from "../repositories/esperas.repo.ts";
import { sincronizarTrabalho } from "./trabalhos.ts";

/** O que o fim, a queda e o varredor precisam (o varredor de lease monta só isto). */
type DepsEspera = Pick<Deps, "repos" | "escopo" | "agora">;

/**
 * Ferramenta `esperar_comando` (definido em 2026-10-12, ADR-099 item 4, parte 2). O bot vai esperar algo de fora que um
 * comando acompanha até o fim (a CI, um deploy). Em vez de voltas por horário (`me_chame_as`) ou de um Bash em segundo
 * plano que segura o turno e a fila do bot (ADR-067), o Nod grava o pedido; o motor da máquina deste turno roda o comando
 * fora do CLI, na pasta do turno, e o fim enfileira a retomada pelo caminho da volta marcada (ADR-086).
 *
 * O comando passa pelas regras do terminal do bot (ADR-052/055/059): só o que rodaria sem card — o turno encerra logo
 * depois e ninguém esperaria a aprovação —, e nunca o laço com sleep da ADR-089. Um pedido por turno.
 */
export const esperarComando: CasoNod<Deps, "esperar_comando"> = async (deps, input) => {
  const turno = await deps.repos.turnos.buscarTravado(input.turnoId);
  if (!turno || turno.agenteId !== input.agenteId) throw new ErroDeDominio("nao_permitido", { cause: "turno de outro bot" });
  const plano = input.plano;
  if (!plano || plano.turnoId !== turno.id || !(plano.nativas ?? []).includes("Bash")) {
    return { data: { ok: false, erro: "sem_terminal", instrucao: "Este turno não tem terminal: o Nod não tem onde rodar o comando. Use me_chame_as para voltar mais tarde e encerre o turno." } };
  }
  const v = validarPedidoEspera({ comando: input.comando, motivo: input.motivo });
  if (!v.ok) return { data: { ok: false, erro: "comando_invalido", instrucao: instrucaoDaRecusa(v) } };
  const trabalho = turno.trabalhoId ? await deps.repos.trabalhos.buscar(turno.trabalhoId) : null;
  if (trabalho && !trabalhoAberto(trabalho.estado)) return { data: { ok: false, erro: "task_fechada", instrucao: "Esta task já foi fechada (parada, terminada ou falhou). Não deixe comando esperando: encerre o turno." } };
  if (turno.estado !== "despachando" || turno.pararSolicitadoEm !== null) return { data: { ok: false, erro: "turno_parado", instrucao: "A pessoa parou este trabalho. Não deixe comando esperando: encerre o turno." } };
  if (!turno.machineId) return { data: { ok: false, erro: "sem_maquina", instrucao: "O Nod não sabe em que máquina este turno roda. Use me_chame_as para voltar mais tarde e encerre o turno." } };
  if (await deps.repos.turnos.despertarDoTurno(turno.id)) return { data: { ok: false, erro: "ja_esperando", instrucao: "Você já marcou uma volta neste turno (me_chame_as). Não deixe outra espera: encerre o turno." } };
  // O mesmo teto das voltas marcadas (ADR-086): a volta da espera conta nele, e a cadeia não cresce sem a pessoa saber.
  if ((await deps.repos.turnos.voltasMarcadas(origemDaVolta(turno))) >= VOLTAS_SEGUIDAS_MAX) {
    return { data: { ok: false, erro: "voltas_demais", instrucao: `Você já voltou ${VOLTAS_SEGUIDAS_MAX} vezes para conferir a mesma coisa. Não espere de novo: diga à pessoa o que está esperando e por quê, e encerre o turno.` } };
  }
  const liberado = await comandoRodaSemCard(deps, plano, v.pedido.comando);
  if (!liberado) {
    return { data: { ok: false, erro: "precisa_aprovacao", instrucao: "Este comando pediria a aprovação da pessoa, e o Nod não roda sem ela. Use um comando que só acompanha (gh pr checks <n> --watch, gh run watch <id>) ou use me_chame_as para voltar mais tarde, e encerre o turno." } };
  }
  const espera = await deps.repos.esperas.criar({ agenteId: turno.agenteId, conversaId: turno.conversaId, trabalhoId: turno.trabalhoId ?? null, turnoId: turno.id, maquinaId: turno.machineId, pasta: plano.pastaDoBot ?? null, comando: v.pedido.comando, motivo: v.pedido.motivo });
  if (!espera) return { data: { ok: false, erro: "ja_esperando", instrucao: "Você já deixou um comando esperando neste turno e volta quando ele terminar. Encerre o turno." } };
  // PR 6: o que o total liberou vai para a Atividade só quando a espera existe (o comando vai rodar), antes do commit.
  await liberado.registrar();
  log("info", "espera_pedida", { espera_id: espera.id, turno_id: turno.id, trabalho_id: turno.trabalhoId ?? null, maquina_id: turno.machineId });
  return { data: { ok: true, espera_id: espera.id, instrucao: "Combinado: o Nod roda o comando na sua máquina, nesta pasta, e você volta sozinho nesta mesma sessão quando ele terminar, com o código de saída e as últimas linhas. Não rode o mesmo comando aqui nem fique checando: diga em uma frase o que vai esperar e encerre o turno agora." } };
};

/**
 * O fim de uma espera acorda quem esperou: a volta do turno de origem, com a frase do fim. Só com o turno de origem
 * assentado e concluído — se ele ainda roda, o assentamento acorda (`esperaAoAssentar`); se terminou mal, não há volta
 * (como no `me_chame_as`). Uma vez só (`acordou_em`), com a linha da espera travada por quem chama.
 */
async function acordar(deps: DepsEspera, espera: Espera, entradaTexto: string): Promise<RuntimeEvent[]> {
  if (espera.acordouEm !== null) return [];
  const turno = await deps.repos.turnos.buscar(espera.turnoId);
  if (!turno || turno.estado !== "concluido") return [];
  // ADR-099 §5 (parte 1): a volta da espera passa pelo mesmo alarme — três voltas da cadeia sem novidade viram pergunta.
  const r = await enfileirarVolta(deps, turno, { acordarEm: deps.agora(), entradaTexto, motivo: espera.motivo });
  await deps.repos.esperas.marcarAcordou(espera.id, deps.agora());
  if (!r) return [];
  log("info", "espera_acordou", { espera_id: espera.id, turno_id: turno.id, volta_id: r.volta?.id ?? null, pergunta: r.volta === null, estado: espera.estado });
  return r.events;
}

function textoDaVolta(e: Espera): string {
  if (e.estado === "terminou") return fraseDaVolta({ estado: "terminou", comando: e.comando, motivo: e.motivo, codigo: e.codigoSaida, saida: e.saida });
  const causa = (Object.keys(MOTIVO_QUEDA_ESPERA) as CausaQuedaEspera[]).find((c) => MOTIVO_QUEDA_ESPERA[c] === e.motivoFim) ?? "sem_contato";
  return fraseDaVolta({ estado: "caiu", comando: e.comando, motivo: e.motivo, causa });
}

/** A espera caiu (máquina sumida, pasta ausente, quedas demais): grava e acorda o dono. */
async function derrubar(deps: DepsEspera, espera: Espera, causa: CausaQuedaEspera): Promise<RuntimeEvent[]> {
  const caida = await deps.repos.esperas.finalizar(espera.id, { estado: "caiu", motivoFim: MOTIVO_QUEDA_ESPERA[causa], agora: deps.agora() });
  if (!caida) return [];
  log("aviso", "espera_caiu", { espera_id: espera.id, turno_id: espera.turnoId, causa, quedas: caida.quedas });
  return [...(await acordar(deps, caida, textoDaVolta(caida))), ...(await sincronizarTrabalho(deps, caida.trabalhoId))];
}

/**
 * O relato da máquina (ponte HTTP ou in-process). A identidade da máquina vem da chave (ou do processo, no modo local),
 * nunca do corpo: relato de espera que não é desta máquina responde `seguir: false` sem tocar em nada.
 *  - `iniciou`: a primeira vez marca `iniciada_em`; depois disso é o motor relançando (a máquina reiniciou) — uma queda,
 *    e na MAX_QUEDAS_ESPERA-ésima a espera cai e o grupo morre;
 *  - `terminou`: grava código e últimas linhas (redigidas e cortadas) e acorda;
 *  - `caiu`: a pasta não existe ou o shell não subiu — cai e acorda.
 */
export async function relatarEspera(deps: DepsEspera, p: { maquinaId: string; relato: RelatoEspera }): Promise<{ data: RespostaRelatoEspera; events: RuntimeEvent[] }> {
  const espera = await deps.repos.esperas.buscarTravado(p.relato.id);
  if (!espera || espera.maquinaId !== p.maquinaId || espera.estado !== "rodando") return { data: { seguir: false }, events: [] };
  const agora = deps.agora();
  const r = p.relato;
  if (r.tipo === "iniciou") {
    if (espera.iniciadaEm === null) {
      await deps.repos.esperas.marcarIniciada(espera.id, agora);
      return { data: { seguir: true }, events: [] };
    }
    const q = decidirQuedaDaEspera(espera.quedas);
    if (q.tipo === "desistir") {
      await deps.repos.esperas.gravarQuedas(espera.id, q.quedas, agora);
      return { data: { seguir: false }, events: await derrubar(deps, { ...espera, quedas: q.quedas }, "quedas") };
    }
    await deps.repos.esperas.gravarQuedas(espera.id, q.quedas, agora);
    log("aviso", "espera_relancada", { espera_id: espera.id, quedas: q.quedas });
    return { data: { seguir: true }, events: [] };
  }
  if (r.tipo === "caiu") return { data: { seguir: false }, events: await derrubar(deps, espera, r.motivo) };
  const saida = ultimasLinhas(redigirSegredos(r.saida));
  const codigo = r.codigo === null || Number.isInteger(r.codigo) ? r.codigo : null;
  const terminada = await deps.repos.esperas.finalizar(espera.id, { estado: "terminou", codigo, saida, agora });
  if (!terminada) return { data: { seguir: false }, events: [] };
  log("info", "espera_terminou", { espera_id: espera.id, turno_id: espera.turnoId, codigo, duracao_ms: agora - espera.criadoEm });
  const events = [...(await acordar(deps, terminada, textoDaVolta(terminada))), ...(await sincronizarTrabalho(deps, terminada.trabalhoId))];
  return { data: { seguir: false }, events };
}

/**
 * O turno que pediu a espera foi assentado (chamado pelo assentamento, na mesma transação, antes de o trabalho reler o
 * estado). Concluído: se o comando já acabou, a volta nasce agora; se ainda roda, o fim acorda. Parado ou interrompido:
 * a espera rodando é cancelada (o motor mata o grupo), como o Parar cancela a volta marcada do `me_chame_as`.
 */
export async function esperaAoAssentar(deps: DepsEspera, turno: Turno, concluiu: boolean): Promise<RuntimeEvent[]> {
  const espera = await deps.repos.esperas.doTurnoTravada(turno.id);
  if (!espera) return [];
  if (!concluiu || turno.pararSolicitadoEm !== null) {
    if (espera.estado === "rodando") await deps.repos.esperas.finalizar(espera.id, { estado: "cancelada", motivoFim: "o turno que pediu a espera não terminou bem", agora: deps.agora() });
    return [];
  }
  if (espera.estado === "terminou" || espera.estado === "caiu") return acordar(deps, espera, textoDaVolta(espera));
  return [];
}

/** O varredor de lease (a cada 15 s, por pessoa): as esperas cuja máquina sumiu caem e acordam o dono. */
export async function varrerEsperasSemNoticia(deps: DepsEspera): Promise<{ caidas: string[]; events: RuntimeEvent[] }> {
  const agora = deps.agora();
  const caidas: string[] = [];
  const events: RuntimeEvent[] = [];
  for (const e of await deps.repos.esperas.semNoticia(agora)) {
    const causa = esperaSemNoticia({ criadoEm: e.criadoEm, vistoEm: e.vistoEm, agora });
    if (!causa) continue;
    events.push(...(await derrubar(deps, e, causa)));
    caidas.push(e.id);
  }
  return { caidas, events };
}

/** O Parar da conversa (todas as do bot dela), de uma task, ou de tudo da pessoa. */
export async function cancelarEsperas(deps: Pick<Deps, "repos" | "agora">, alvo: AlvoCancelarEsperas): Promise<{ id: string; turnoId: string }[]> {
  const canceladas = await deps.repos.esperas.cancelarRodando(alvo, "parada pela pessoa", deps.agora());
  if (canceladas.length) log("info", "esperas_canceladas", { quantas: canceladas.length });
  return canceladas;
}
