import { createHash } from "node:crypto";
import type { Executor, RuntimeEvent } from "../contracts/evento.ts";
import type { Quadro } from "../contracts/quadro.ts";
import { atrasosDePrazo, decisoesParaAvisar, entradaDaCobranca, textoDasDecisoes, textoDosAtrasos, type TarefaComMarcas } from "../domain/avisos-quadro.ts";
import { colunasDe } from "../domain/colunas.ts";
import { quemDecide } from "../domain/quadro-pessoas.ts";
import { ehErroDeDominio } from "../domain/erro.ts";
import { log } from "../obs/log.ts";
import { autoriaAgente, evento } from "./apoio-l7.ts";
import { abrirTurno } from "./quadro.ts";
import { emSavepoint } from "./savepoint.ts";
import { tarefaCasaLigada } from "../shared/tarefa-casa.ts";
import type { Deps } from "./tipos.ts";
import { situacaoDasTarefas } from "./situacao-trabalho.ts";
import { registrarAvisoDoQuadro, type TipoAvisoDoQuadro } from "./trilha-quadro.ts";

/**
 * NOD-420 (definido em 2026-11-02): o quadro chama a pessoa só quando precisa dela (regras puras em
 * src/domain/avisos-quadro.ts). Roda depois de cada lote e na volta do varredor, sempre com a trava do quadro na mão:
 * - as decisões pendentes (Bloqueado, Precisa de você, coluna "só uma pessoa") saem juntas, uma vez, depois da janela;
 * - o prazo estourado cobra o responsável (um turno novo, se nenhum está na fila ou rodando) e, se a tarefa continuar
 *   parada, avisa a pessoa.
 * A marca de cada envio vai na tarefa (0141) e só o que ESTA chamada marcou entra na mensagem: duas passadas ao mesmo
 * tempo não avisam em dobro, e o id de envio sai das tarefas@entrada (o índice único de mensagens segura o resto).
 * O texto não leva conteúdo de fora (a tarefa deFora aparece sem título nem pergunta, ADR-047), então a mensagem sai
 * confiável, como uma fala comum do bot na conversa.
 */

/**
 * Revisão do PR #624 (definido em 2026-11-02): um passo dos avisos num SAVEPOINT da transação de quem chama. Se lança
 * (a cota do provisório no enfileirar, um erro do banco), só o que ele fez volta, o log registra o código e o resto segue:
 * uma cobrança não derruba as outras, nem o quadro, nem a edição da pessoa. Sem savepoint (repos em memória), roda direto.
 */
async function isolado(deps: Deps, evento: string, campos: Record<string, string>, fn: () => Promise<void>): Promise<boolean> {
  try {
    await emSavepoint(deps, fn);
    return true;
  } catch (e) {
    log("erro", evento, { ...campos, erro: ehErroDeDominio(e) ? e.codigo : e instanceof Error ? e.name : "desconhecido" });
    return false;
  }
}

function uuidDe(chave: string): string {
  const h = createHash("sha256").update(chave).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/**
 * Fala na conversa de um bot, como o avisar_pessoa (o sino e o push da web): a do responsável de todas; senão, ou se ele
 * não tem conversa, a do anfitrião. Sem nenhuma, registra e segue (a marca fica: não tenta a cada passada).
 */
async function falar(deps: Deps, q: Quadro, tarefas: readonly TarefaComMarcas[], tipo: TipoAvisoDoQuadro, texto: (quadroDe?: string) => string, chave: string, nomes: ReadonlyMap<string, string>): Promise<RuntimeEvent | null> {
  const donos = new Set(tarefas.map((t) => t.agenteId));
  const unico = donos.size === 1 ? [...donos][0] : null;
  let agenteId = unico ?? q.agenteId;
  let conversa = await deps.repos.conversas.buscarPropriaDoAgente(agenteId);
  if (!conversa && agenteId !== q.agenteId) {
    agenteId = q.agenteId;
    conversa = await deps.repos.conversas.buscarPropriaDoAgente(agenteId);
  }
  if (!conversa) {
    log("aviso", "aviso_quadro_sem_conversa", { quadroId: q.id, tarefas: tarefas.length });
    return null;
  }
  const autoria = autoriaAgente(agenteId, deps.escopo.pessoaId);
  // Na conversa de outro bot, o texto diz de qual quadro é (revisão do PR #624); na do anfitrião, "no quadro" basta.
  const quadroDe = agenteId === q.agenteId ? undefined : (nomes.get(q.agenteId) ?? undefined);
  const m = await deps.repos.mensagens.criar({ conversaId: conversa.id, turnoId: null, autoria, kind: "texto", texto: texto(quadroDe), payload: { kind: "aviso_pessoa" }, confianca: "confiavel", idEnvio: uuidDe(chave) });
  if (m) await registrarAvisoDoQuadro(deps, { quadroId: q.id, tipo, tarefas: tarefas.length, mensagemId: m.id, autoria });
  return m ? evento(deps, "mensagem_criada", autoria, { mensagem_id: m.id, kind: "texto", aviso: true }, { conversaId: conversa.id, turnoId: null }) : null;
}

async function nomesDos(deps: Deps, ids: Iterable<string | null>): Promise<Map<string, string>> {
  const nomes = new Map<string, string>();
  for (const id of new Set(ids)) {
    if (!id) continue;
    const a = await deps.repos.agentes.buscar(id, true);
    if (a) nomes.set(id, a.nome);
  }
  return nomes;
}

const chaveDe = (prefixo: string, ts: readonly TarefaComMarcas[]) => `${prefixo}:${ts.map((t) => `${t.id}@${t.naColunaDesde}`).sort().join(",")}`;

/** O que vence agora no quadro: as decisões a avisar e os atrasos de prazo, pelas marcas de cada tarefa. */
async function vencidos(deps: Deps, q: Quadro, agora: number) {
  const repo = deps.repos.quadros;
  const colunas = colunasDe(q);
  const marcas = await repo.marcasDeAviso(q.id);
  const tarefas = (await repo.tarefas(q.id)).flatMap((t) => {
    const m = marcas.get(t.id);
    return m ? [{ ...t, ...m }] : [];
  });
  // Merge da NOD-443 (D6): a pendência de quem participa (Com você pedido por ela, que segue no quadro) é dela e o aviso
  // vai pelo bot dela (avisarQuemParticipa); a conversa da dona não a recebe.
  const membros = new Set((await repo.membros(q.id)).map((m) => m.pessoaId));
  const daDona = (t: (typeof tarefas)[number]) => t.status !== "voce" || quemDecide({ pedidoPor: t.pedidoPor, donaId: deps.escopo.pessoaId, membros }).pessoaId === deps.escopo.pessoaId;
  // ADA-28 (ADR-159): a tarefa cuja espera é uma decisão ligada já está na Sua vez (o cartão da decisão); o aviso
  // "Preciso de você no quadro" seria o segundo "Precisa de você" da mesma coisa.
  const comDecisao = tarefaCasaLigada() ? new Set((await deps.repos.decisoes.abertasDasTarefas(tarefas.filter((t) => t.status === "voce").map((t) => t.id))).map((d) => d.tarefaId)) : new Set<string | undefined>();
  const semDecisao = (t: (typeof tarefas)[number]) => t.status !== "voce" || !comDecisao.has(t.id);
  // ADA-232: a tarefa com volta marcada (hora, CI, comando de fundo) não está parada: o zelador não a cobra. O trabalho
  // vivo sem volta segue a regra antiga (o turno da tarefa na fila não abre outro; o turno limpo é cobrado).
  const situacoes = await situacaoDasTarefas(deps, tarefas.map((t) => t.id));
  const ocupadas = new Set([...situacoes].filter(([, s]) => s.volta !== null).map(([id]) => id));
  return { colunas, tarefas, decisoes: decisoesParaAvisar(tarefas, colunas, agora).filter(daDona).filter(semDecisao), atrasos: atrasosDePrazo(tarefas, colunas, agora, ocupadas) };
}

/**
 * Os avisos e as cobranças do quadro agora. Chame com o quadro travado (buscarTravado): o lote e o varredor já travam.
 * `cobrar: false` (o lote da pessoa ou do bot): só as decisões; a cobrança abre turno e fica para o varredor, para que a
 * edição nunca dependa dela (revisão do PR #624).
 */
export async function avisarDoQuadro(deps: Deps, q: Quadro, opcoes: { executor?: Executor; cobrar?: boolean } = {}): Promise<RuntimeEvent[]> {
  const repo = deps.repos.quadros;
  const agora = deps.agora();
  const v = await vencidos(deps, q, agora);
  const { colunas, tarefas, decisoes } = v;
  const atrasos = opcoes.cobrar === false ? [] : v.atrasos;
  if (decisoes.length === 0 && atrasos.length === 0) return [];
  const events: RuntimeEvent[] = [];
  const nomes = await nomesDos(deps, [q.agenteId, ...tarefas.map((t) => t.agenteId)]);

  // 1. As decisões pendentes, juntas.
  const marcadas = new Set(await repo.marcarAviso(decisoes.map((t) => t.id), "avisada_em", agora));
  const avisar = decisoes.filter((t) => marcadas.has(t.id));
  if (avisar.length) {
    const ev = await falar(deps, q, avisar, "decisao", (quadroDe) => textoDasDecisoes(avisar, colunas, nomes, quadroDe), chaveDe("quadro-decisoes", avisar), nomes);
    if (ev) events.push(ev);
  }

  // 2. O prazo das colunas: cobrar o responsável, depois avisar a pessoa.
  const cobrar = atrasos.filter((a) => a.acao === "cobrar");
  const cobradas = new Set(await repo.marcarAviso(cobrar.map((a) => a.tarefa.id), "cobrada_em", agora));
  const vivos = await repo.estadosDosTurnos(cobrar.map((a) => a.tarefa.turnoId).filter((id): id is string => id !== null));
  // Cada cobrança no seu savepoint: a marca (cobrada_em) fica fora dele, então a que falhou não tenta a cada passada; a
  // escalada segue o relógio e a pessoa fica sabendo.
  for (const a of cobrar) {
    if (!cobradas.has(a.tarefa.id) || !a.tarefa.agenteId) continue;
    // Um turno da tarefa ainda na fila ou rodando: não abre outro (a cobrança fica marcada; a escalada segue o relógio).
    const estado = a.tarefa.turnoId ? vivos.get(a.tarefa.turnoId) : undefined;
    if (estado === "pendente" || estado === "despachando") continue;
    const agenteId = a.tarefa.agenteId;
    await isolado(deps, "cobranca_quadro_falhou", { quadroId: q.id, tarefaId: a.tarefa.id }, async () => {
      const agente = await deps.repos.agentes.buscar(agenteId);
      if (!agente) {
        log("aviso", "cobranca_quadro_sem_agente", { quadroId: q.id, tarefaId: a.tarefa.id });
        return;
      }
      // O executor configurado (o varredor passa o.executor(), valor vivo, como os outros fundos); sem ele, o do turno
      // anterior da tarefa; "local" só quando nenhum dos dois existe (revisão 3 do PR #624).
      const executor = opcoes.executor ?? (a.tarefa.turnoId ? (await deps.repos.turnos.buscar(a.tarefa.turnoId))?.executor : undefined) ?? "local";
      const colunaNome = colunas.find((c) => c.id === a.tarefa.status)?.nome ?? a.tarefa.status;
      const aberto = await abrirTurno(deps, { autor: { tipo: "agente", agenteId: q.agenteId }, ops: [], executor }, agente, entradaDaCobranca({ quadroId: q.id, tarefa: a.tarefa, colunaNome, prazoMin: a.prazoMin }), a.tarefa.deFora);
      if (!aberto) {
        log("aviso", "cobranca_quadro_sem_conversa", { quadroId: q.id, tarefaId: a.tarefa.id });
        return;
      }
      const { id: _id, quadroId: _q, criadoEm: _c, mudadoEm: _m, naColunaDesde: _n, avisadaEm: _a, cobradaEm: _co, escaladaEm: _e, ...campos } = a.tarefa;
      // Mesmo status: o gatilho da 0141 não zera as marcas; a tarefa só passa a guardar o turno da cobrança.
      await repo.salvarTarefa(a.tarefa.id, { ...campos, turnoId: aberto.turnoId });
      events.push(...aberto.events);
    });
  }
  const escalar = atrasos.filter((a) => a.acao === "escalar");
  const escaladas = new Set(await repo.marcarAviso(escalar.map((a) => a.tarefa.id), "escalada_em", agora));
  const paraPessoa = escalar.filter((a) => escaladas.has(a.tarefa.id));
  if (paraPessoa.length) {
    const ts = paraPessoa.map((a) => a.tarefa);
    const ev = await falar(deps, q, ts, "escalada", (quadroDe) => textoDosAtrasos(paraPessoa, colunas, nomes, quadroDe), chaveDe("quadro-atrasos", ts), nomes);
    if (ev) events.push(ev);
  }
  return events;
}

/**
 * A volta do varredor: a janela das decisões e o prazo das colunas vencem com o tempo, sem ninguém mexer no quadro.
 * `executor`: o executor configurado agora, para o turno da cobrança (revisão 3 do PR #624).
 */
export async function varrerAvisosDosQuadros(deps: Deps, opcoes: { executor?: Executor } = {}): Promise<{ events: RuntimeEvent[] }> {
  // A mesma leitura do quadro.ts (a chave da pessoa já com a flag NOD_QUADROS aplicada). Desligado: nada sai.
  if ((await deps.repos.preferencias.buscar()).experimentos?.quadro !== true) return { events: [] };
  const events: RuntimeEvent[] = [];
  // Os quadros em ordem estável por id (revisão 3 do PR #624): duas passadas travam na mesma ordem, sem espera cruzada.
  const quadros = [...(await deps.repos.quadros.listar())].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const q of quadros) {
    // Cada quadro no seu savepoint (revisão do PR #624): o que lança volta sozinho, registra, e os outros quadros saem.
    await isolado(deps, "avisos_quadro_falhou", { quadroId: q.id }, async () => {
      // A passada é a cada 30 s: só trava o quadro (e espera um lote em curso) quando algo venceu na leitura sem trava.
      const { decisoes, atrasos } = await vencidos(deps, q, deps.agora());
      if (decisoes.length === 0 && atrasos.length === 0) return;
      const travado = await deps.repos.quadros.buscarTravado(q.id);
      if (travado) events.push(...(await avisarDoQuadro(deps, travado, { executor: opcoes.executor })));
    });
  }
  return { events };
}

/**
 * O aviso depois do lote (revisão do PR #624): só as decisões (sem cobrança) e num savepoint. Se lançar, a edição da
 * pessoa ou do bot fica gravada, o log registra, e o varredor avisa na próxima passada (a marca voltou com o savepoint).
 */
export async function avisarNoLote(deps: Deps, q: Quadro): Promise<RuntimeEvent[]> {
  const events: RuntimeEvent[] = [];
  await isolado(deps, "avisos_quadro_falhou", { quadroId: q.id }, async () => {
    events.push(...(await avisarDoQuadro(deps, q, { cobrar: false })));
  });
  return events;
}
