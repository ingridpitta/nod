import { aEntregar, esperaVencida, podeCobrar, semResposta } from "../domain/espera-de-colega.ts";
import type { DonoDto, EsperaDoDonoDto, EstadoDoDono } from "../contracts/dono.ts";
import { VOLTAS_SEM_NOVIDADE } from "../contracts/ferramentas-trabalho.ts";
import type { ServicoDasMaquinas, Trabalho } from "../contracts/trabalho.ts";
import { estadoDoDono, tentativaDaEspera, ultimaLinha } from "../domain/estado-do-dono.ts";
import { nomeDaMaquina, semContatoDesde, type PresencaDasMaquinas } from "../domain/presenca-da-maquina.ts";
import { linhaCurta, trabalhoAberto } from "../domain/trabalho.ts";
import type { FatosCrusDosDonos } from "../repositories/donos.repo.ts";
import type { Deps } from "./tipos.ts";

type DepsDono = Pick<Deps, "repos" | "agora">;
type ServicoDaPresenca = Pick<ServicoDasMaquinas, "conectada" | "macDoServidor" | "identificar">;

/**
 * NOD-300 (definido em 2026-10-20): o resolver de presença do estado do dono — a máquina do turno vivo de uma frente
 * sem contato (nome e desde), pela regra do chip (src/domain/presenca-da-maquina.ts). `ultimoUso`: o último uso de cada
 * chave, já lido por quem chama; `nomes`: o nome de cada chave, para a máquina que a ponte já esqueceu (90 s).
 */
export function resolverDePresenca(servico: ServicoDaPresenca, escopo: Deps["escopo"], ultimoUso: ReadonlyMap<string, number | null>, nomes?: ReadonlyMap<string, string>): PresencaDasMaquinas {
  return (id) => {
    const desde = semContatoDesde(servico, escopo, id, ultimoUso);
    return desde === null ? null : { maquina: nomeDaMaquina(servico, escopo, id, nomes).nome, desde };
  };
}

/** O mesmo, lendo as chaves uma vez; sem o serviço saber `conectada`, undefined (o estado de antes). */
export async function presencaDasMaquinas(deps: Pick<Deps, "repos" | "escopo">, servico?: ServicoDaPresenca): Promise<PresencaDasMaquinas | undefined> {
  if (!servico?.conectada) return undefined;
  const chaves = await deps.repos.maquinaTokens.listar();
  return resolverDePresenca(servico, deps.escopo, new Map(chaves.map((c) => [c.id, c.ultimoUsoEm])), new Map(chaves.map((c) => [c.id, c.nome])));
}

/**
 * O dono de cada bot para a tela (definido em 2026-10-12, ADR-099 item 10, I10): o estado da linha (calculado no
 * servidor, src/domain/estado-do-dono.ts), as esperas e a fila. `abertos`: os trabalhos abertos que quem chama já leu
 * (GET trabalhos, a conversa); ausente, lê os de cada bot. Vai em `GET trabalhos` (por bot), no `ConversaDto` (o bot da
 * conversa própria) e, só o estado, no frame `trabalho.mudou` (despachar-outbox.ts).
 */
export async function donosDosBots(deps: DepsDono, agenteIds: readonly string[], abertos?: readonly Trabalho[], presenca?: PresencaDasMaquinas): Promise<Map<string, DonoDto>> {
  const ids = [...new Set(agenteIds)];
  const agora = deps.agora();
  const crus = await deps.repos.donos.fatos(ids, agora);
  const esperas = await esperasDosDonos(deps, crus);
  const donos = new Map<string, DonoDto>();
  for (const agenteId of ids) {
    const frentes = (abertos ?? (await deps.repos.trabalhos.abertosDoAgente(agenteId))).filter((t) => t.agenteId === agenteId && trabalhoAberto(t.estado));
    const minhas = esperas.filter((e) => e.agenteId === agenteId).map(({ agenteId: _a, ...e }) => e);
    // A rotina aparece pela primeira linha da instrução, como a etiqueta da task (`rotinaNome`).
    const fila = crus.fila.filter((p) => p.agenteId === agenteId).map(({ agenteId: _a, ...p }) => (p.de === "rotina" && p.nome ? { ...p, nome: linhaCurta(p.nome) } : p));
    const estado = estadoDoDono({
      agenteId,
      frentes: frentes.map((t) => {
        // NOD-300: sem o resolver, `semContato` ausente (o estado de antes); a frente sem máquina conhecida não acusa.
        const machineId = crus.frentesVivas.get(t.id);
        const semContato = presenca ? (machineId ? presenca(machineId) : null) : undefined;
        return { id: t.id, estado: t.estado, vivo: crus.frentesVivas.has(t.id), iniciadoEm: t.iniciadoEm, criadoEm: t.criadoEm, ...(semContato === undefined ? {} : { semContato }) };
      }),
      conversaTrabalhandoDesde: crus.vivos.get(agenteId) ?? null,
      conversaPropriaTrabalhandoDesde: crus.vivosPropria.get(agenteId) ?? null,
      decisoes: crus.decisoes.get(agenteId) ?? { quantas: 0, desde: null },
      esperas: minhas,
      fila,
    });
    donos.set(agenteId, { estado, esperas: minhas, fila });
  }
  return donos;
}

/** Só o estado (a linha fechada) de um bot, lido agora — o que o frame `trabalho.mudou` leva. */
export async function estadoDoDonoAgora(deps: DepsDono, agenteId: string, presenca?: PresencaDasMaquinas): Promise<EstadoDoDono | null> {
  return (await donosDosBots(deps, [agenteId], undefined, presenca)).get(agenteId)?.estado ?? null;
}

/**
 * As esperas de todos os bots lidos, na ordem em que começaram: os comandos (com a última linha da tentativa anterior e a
 * tentativa N de 3, pelas voltas da mesma cadeia), as voltas marcadas e os pedidos a colega sem resposta.
 */
async function esperasDosDonos(deps: DepsDono, crus: FatosCrusDosDonos): Promise<(EsperaDoDonoDto & { agenteId: string })[]> {
  const agora = deps.agora();
  const comandos: (EsperaDoDonoDto & { agenteId: string })[] = [];
  for (const c of crus.comandos) {
    const voltas = c.emVolta ? (await deps.repos.turnos.ultimasVoltas(c.origem, VOLTAS_SEM_NOVIDADE + 1)).slice(1) : [];
    comandos.push({ agenteId: c.agenteId, tipo: "comando", trabalhoId: c.trabalhoId, motivo: c.motivo, desde: c.desde, comando: c.comando, ultimaLinha: ultimaLinha(c.saidaAnterior), tentativa: tentativaDaEspera(voltas, c.emVolta), tentativas: VOLTAS_SEM_NOVIDADE });
  }
  const voltas = crus.voltas.map((v) => ({ agenteId: v.agenteId, tipo: "volta" as const, trabalhoId: v.trabalhoId, motivo: v.motivo?.trim() || "a volta marcada", desde: v.desde, acordaEm: v.acordaEm }));
  const colegas: (EsperaDoDonoDto & { agenteId: string })[] = [];
  // Revisão 10 do PR #544 (M2): as vencidas pelo relógio de todos os bots numa leitura só (antes, uma por espera).
  const vencidasPeloRelogio = crus.colegas.filter((c) => esperaVencida({ criadoEm: c.desde, cobradoEm: c.cobradoEm }, agora));
  const lidas = vencidasPeloRelogio.length === 0 ? [] : await deps.repos.pedidosDeColega.esperasDeColega(agora, { tarefaIds: vencidasPeloRelogio.map((c) => c.tarefaId) });
  const lidaDe = new Map(lidas.map((e) => [`${e.tarefaId}|${e.deAgenteId}`, e]));
  for (const c of crus.colegas) {
    // NOD-377 (revisão 2 do PR #544, A1): vencida pelo relógio, a espera ainda pode estar ocupada. Com a cadeia rodando ou
    // aguardando frentes ou uma decisão, não é "sem resposta" (o varredor espera); na fila, é "sem resposta", mas Cobrar só
    // duplicaria o pedido (o servidor recusa). Quem diz é a mesma leitura do varredor (esperasDeColega), só para as
    // vencidas pelo relógio, lidas acima.
    let vencida = esperaVencida({ criadoEm: c.desde, cobradoEm: c.cobradoEm }, agora);
    let ocupada = false;
    if (vencida) {
      const e = lidaDe.get(`${c.tarefaId}|${c.agenteId}`);
      // Revisão 11 (B3): não achada na releitura (fechou entre as duas leituras), sem Cobrar — a rota daria 404.
      // QA do PR #544 (bug 2): concluída com fala, a próxima passada entrega — nem "sem resposta", nem Cobrar.
      ocupada = !e || e.rodando || e.naFila || e.aguardando || aEntregar(e);
      vencida = !e || (semResposta(e, agora) && !aEntregar(e));
    }
    colegas.push({
      agenteId: c.agenteId, tipo: "colega" as const, trabalhoId: c.trabalhoId, motivo: c.nome ?? "um colega", desde: c.desde,
      colega: {
        id: c.colegaId, removido: c.colegaRemovido, trabalhando: c.colegaTrabalhando, fila: c.colegaFila,
        // NOD-377: o prazo da espera, pela mesma regra do varredor (src/domain/espera-de-colega.ts).
        tarefaId: c.tarefaId, vencida, cobradoEm: c.cobradoEm,
        podeCobrar: podeCobrar({ criadoEm: c.desde, cobradoEm: c.cobradoEm, cobrancas: c.cobrancas, colegaExcluido: c.colegaRemovido, ocupada }, agora),
      },
    });
  }
  return [...comandos, ...voltas, ...colegas].sort((a, b) => a.desde - b.desde);
}

