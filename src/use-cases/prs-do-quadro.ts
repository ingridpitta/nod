import type { Executor, RuntimeEvent } from "../contracts/evento.ts";
import type { OpQuadro, PrDaTarefa, PrLido, TipoLinhaTarefa } from "../contracts/quadro.ts";
import { colunasDe, grupoDe } from "../domain/colunas.ts";
import { casaComTarefa, type DestinoDoMerge, desfechoDoMerge, fimDosPrs, fixarConflito, textoDaLinha, transicoes } from "../domain/prs-da-tarefa.ts";
import { log } from "../obs/log.ts";
import { autoriaPessoa, evento } from "./apoio-l7.ts";
import { aplicarLoteQuadro, comMembros } from "./quadro.ts";
import { pedirODone } from "./tarefa-casa.ts";
import type { CasoDeUso } from "./tipos.ts";

/**
 * definido em 2026-11-02 (NOD-421): o laço de fundo entrega os PRs lidos do GitHub (de todos os repos configurados) e
 * este caso de uso, dentro do escopo da pessoa, liga cada PR às tarefas dela que casam (id no branch ou pr_url gravado),
 * guarda o último estado visto, escreve uma linha de sistema por transição e, quando o último PR da tarefa acabou de ser
 * mergeado e a coluna permite, move a tarefa para Feito por um lote comum (Desfazer, fecho da meta e SSE de sempre).
 *
 * O lote sai com autor pessoa: o merge passou pela aprovação dela; a linha diz que foi o GitHub. Quando a NOD-416 trouxer
 * autor de regra no histórico, a linha e o lote passam a ele.
 *
 * Revisão do PR #621: o `aviso` da volta (sem conexão / sem acesso a um repo) vai para o topo de cada quadro, gravado só
 * quando muda; `mergeable: UNKNOWN` mantém o conflito visto antes (fixarConflito). Idempotência: duas voltas ao mesmo
 * tempo (as duas cores no deploy) se serializam na trava do quadro (buscarTravado) e a segunda lê o que a primeira gravou.
 */

export type ResultadoPrs = { ligados: number; linhas: number; movidas: number; avisos?: number };

const chave = (tarefaId: string, p: Pick<PrDaTarefa, "repo" | "numero">) => `${tarefaId}|${p.repo}#${p.numero}`;
const igual = (a: PrDaTarefa, b: PrDaTarefa) => a.estado === b.estado && a.ci === b.ci && a.conflito === b.conflito && a.url === b.url && a.branch === b.branch;

type Linha = { tarefaId: string; tipo: TipoLinhaTarefa; pr: PrDaTarefa };

/**
 * `aviso`: o texto do topo do quadro (null limpa; ausente = não mexe). `executor`: onde rodam os turnos que o lote para
 * Feito começar, o do servidor (app.executor, vivo), como a rota da tela (2ª revisão do PR #621: era "catcher" fixo).
 */
export const sincronizarPrsDoQuadro: CasoDeUso<{ prs: readonly PrLido[]; aviso?: string | null; executor: Executor }, ResultadoPrs> = async (deps, input) => {
  const r: ResultadoPrs = { ligados: 0, linhas: 0, movidas: 0 };
  if (input.prs.length === 0 && input.aviso === undefined) return { data: r };
  if ((await deps.repos.preferencias.buscar()).experimentos?.quadro !== true) return { data: r };
  const repo = deps.repos.quadros;
  const events: RuntimeEvent[] = [];
  const mudouQuadro = (q: { id: string; agenteId: string }, tarefas: string[]) =>
    events.push(evento(deps, "quadro_mudou", autoriaPessoa(deps.escopo.pessoaId, "regra:prs_do_github"), { quadroId: q.id, agenteId: q.agenteId, loteId: null, tarefas: tarefas.join(","), autor: "pessoa" }, { conversaId: null, turnoId: null }));

  for (const q of await repo.listar()) {
    // O aviso do topo: uma escrita só quando muda (o update compara), e a tela recarrega.
    let avisoMudou = false;
    if (input.aviso !== undefined && (await repo.definirAvisoGithub(q.id, input.aviso))) {
      avisoMudou = true;
      r.avisos = (r.avisos ?? 0) + 1;
    }
    const tarefasAntes = input.prs.length > 0 ? await repo.tarefas(q.id) : [];
    // Barato antes da trava: nenhuma tarefa casa com nenhum PR = nada a fazer neste quadro.
    const casa = (t: (typeof tarefasAntes)[number], p: PrLido) => casaComTarefa({ ids: t.linearId ? [t.linearId] : [], prUrl: t.prUrl }, p);
    if (!tarefasAntes.some((t) => input.prs.some((p) => casa(t, p)))) {
      if (avisoMudou) mudouQuadro(q, []);
      continue;
    }
    const travado = await repo.buscarTravado(q.id);
    if (!travado) continue;
    const colunas = colunasDe(travado);
    const tarefas = await repo.tarefas(q.id);
    const vistos = new Map((await repo.prsDoQuadro(q.id)).map((p) => [chave(p.tarefaId, p), p]));

    const salvar: { tarefaId: string; pr: PrDaTarefa }[] = [];
    const linhas: Linha[] = [];
    const destinos = new Map<string, DestinoDoMerge>();
    const prUrls: { tarefaId: string; url: string }[] = [];
    const pendentes: { tarefaId: string; pendente: boolean }[] = [];
    for (const t of tarefas) {
      // UNKNOWN (conflito null) fica como o último visto: conflito→UNKNOWN→conflito não gera linha nenhuma.
      const casam = input.prs.filter((p) => casa(t, p)).map((p) => fixarConflito(vistos.get(chave(t.id, p)) ?? null, p));
      if (casam.length === 0) continue;
      // 3ª revisão do PR #621: o fechamento sem merge também conta quando completa a tarefa (PR1 mergeado, PR2 fechado:
      // nenhum aberto e algum mergeado). 4ª revisão: só com um merge PENDENTE (que não moveu porque havia outro PR
      // aberto); o merge que já teve desfecho não conta de novo. Só a transição pergunta; fimDosPrs decide.
      let mergeouAgora = false;
      let fechouAgora = false;
      for (const p of casam) {
        const antes = vistos.get(chave(t.id, p)) ?? null;
        if (antes && igual(antes, p)) continue;
        salvar.push({ tarefaId: t.id, pr: p });
        if (!antes) r.ligados++;
        for (const tipo of transicoes(antes, p)) {
          linhas.push({ tarefaId: t.id, tipo, pr: p });
          if (tipo === "pr_mergeado") mergeouAgora = true;
          else if (tipo === "pr_fechado") fechouAgora = true;
        }
      }
      if (!t.prUrl) prUrls.push({ tarefaId: t.id, url: [...casam].sort((a, b) => b.numero - a.numero)[0]!.url });
      if (!mergeouAgora && !fechouAgora) continue;
      // O estado de todos os PRs da tarefa depois deste tick (os que não vieram nesta leitura ficam como estavam).
      const daTarefa = new Map([...vistos.values()].filter((v) => v.tarefaId === t.id).map((v) => [chave(t.id, v), v as PrDaTarefa]));
      for (const p of casam) daTarefa.set(chave(t.id, p), p);
      const pendente = [...vistos.values()].some((v) => v.tarefaId === t.id && v.mergePendente);
      const fim = fimDosPrs({ mergeouAgora, fechouAgora, pendente }, colunas, t.status, [...daTarefa.values()]);
      if (fim.destino) destinos.set(t.id, fim.destino);
      if (fim.pendente !== pendente) pendentes.push({ tarefaId: t.id, pendente: fim.pendente });
    }
    if (salvar.length === 0 && prUrls.length === 0) {
      if (avisoMudou) mudouQuadro(q, []);
      continue;
    }

    // ADA-28 (escopo E): com quem_fecha pessoa, o merge não leva a Feito: pede o Done (a tarefa fica onde está).
    if (travado.quemFecha === "pessoa") {
      const pedem = [...destinos].filter(([, d]) => "mover" in d && grupoDe(colunas, d.mover) === "feito").map(([id]) => id);
      for (const id of pedem) destinos.delete(id);
      if (pedem.length > 0) events.push(...(await pedirODone(deps, { quadroId: q.id, tarefaIds: pedem })));
    }
    // Primeiro o lote (se ele falhar, a linha não diz "→ Feito"), depois os PRs e as linhas.
    const ops: OpQuadro[] = [...destinos].flatMap(([tarefa, d]) => ("mover" in d ? [{ tipo: "mudar_tarefa" as const, tarefa, status: d.mover }] : []));
    let lote = false;
    if (ops.length > 0) {
      const res = await aplicarLoteQuadro(deps, { autor: { tipo: "pessoa" }, quadro: q.id, ops, executor: input.executor });
      if (res.data.ok) {
        lote = true;
        r.movidas += ops.length;
        events.push(...(res.events ?? []));
      } else {
        // A linha sai sem "→ Feito"; o log diz que o lote não entrou (só o código, nunca o detalhe).
        // 4ª revisão do PR #621: a transição fica gravada (e o merge pendente, limpo) de propósito. O lote recusado
        // não passa sozinho na volta seguinte (entrada_invalida é do plano; experimento_desligado faz o caso de uso sair
        // antes): não gravar repetiria o lote e o log a cada 30 s e a linha do merge nunca sairia. Exceção não chega
        // aqui: derruba a transação inteira e a volta seguinte relê tudo.
        log("aviso", "prs_do_quadro_lote_falhou", { quadro_id: q.id, tarefas: ops.length, erro: res.data.erro });
        for (const [id, d] of destinos) if ("mover" in d) destinos.delete(id);
      }
    }
    for (const s of salvar) await repo.salvarPr(q.id, s.tarefaId, s.pr);
    // Depois do upsert (o PR novo já existe): o merge pendente vale para todos os PRs da tarefa.
    for (const p of pendentes) await repo.definirMergePendente(p.tarefaId, p.pendente);
    for (const u of prUrls) await repo.definirPrUrlSeVazio(u.tarefaId, u.url);
    // O desfecho vai na última linha de merge ou fechamento da tarefa ("#612 mergeado → Feito" / "· ficou em Backlog").
    const ultimaDeMerge = new Map<string, number>();
    linhas.forEach((l, i) => { if (l.tipo === "pr_mergeado" || l.tipo === "pr_fechado") ultimaDeMerge.set(l.tarefaId, i); });
    for (const [i, l] of linhas.entries()) {
      const d = ultimaDeMerge.get(l.tarefaId) === i ? destinos.get(l.tarefaId) : undefined;
      await repo.inserirLinha(q.id, l.tarefaId, {
        tipo: l.tipo,
        texto: textoDaLinha(l.tipo, l.pr, d ? desfechoDoMerge(d) : undefined),
        dados: { repo: l.pr.repo, numero: l.pr.numero, ...(d ? ("mover" in d ? { moveuPara: d.mover } : { ficouEm: d.ficou }) : {}) },
      });
      r.linhas++;
    }
    // Sem lote, a tela ainda precisa saber que a tarefa ganhou PR ou linha (o mesmo evento do quadro, autor regra).
    if (!lote) mudouQuadro(q, [...new Set([...salvar.map((s) => s.tarefaId), ...prUrls.map((u) => u.tarefaId)])]);
  }
  // Revisão 8 do PR #628: o PR ligado, a linha de CI e o aviso do topo chegam ao vivo também a quem participa do quadro.
  return { data: r, events: await comMembros(deps, events) };
};
