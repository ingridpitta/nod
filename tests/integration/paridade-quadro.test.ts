import { afterAll, beforeAll, expect, it } from "vitest";
import { rotasQuadro } from "../../src/adapters/http/rotas/quadro.ts";
import { criarRotasRaioX } from "../../src/adapters/http/rotas/raio-x.ts";
import type { DepsRotas } from "../../src/adapters/http/rotas/executar-caso.ts";
import { LIMITES_QUADRO, type OpQuadro, type QuadroDto, type ResultadoGerirQuadro } from "../../src/contracts/quadro.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { ACOES_QUADRO } from "../../src/domain/acoes/quadro.ts";
import { FAIXA_DO_PRAZO } from "../../src/domain/colunas.ts";
import { JANELA_AGRUPAR_MS } from "../../src/domain/avisos-quadro.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { EXECUTORES_QUADRO } from "../../src/use-cases/acoes/quadro.ts";
import { garantirNod } from "../../src/use-cases/onboarding.ts";
import { gerirQuadro } from "../../src/use-cases/gerir-quadro.ts";
import { decidirColunasDoQuadro } from "../../src/use-cases/colunas-do-quadro.ts";
import { decidirImportacaoLinear, trazerImportacao, type RodarNaTx } from "../../src/use-cases/importar-linear.ts";
import type { FonteLinear, IssueLinear } from "../../src/contracts/quadro-importacao.ts";
import { decidirQuadroExclusao } from "../../src/use-cases/quadro-exclusao.ts";
import { decidirAssumirQuadro } from "../../src/use-cases/assumir-quadro.ts";
import { aplicarLoteQuadro, historicoDaTarefa, montarQuadro } from "../../src/use-cases/quadro.ts";
import { varrerAvisosDosQuadros } from "../../src/use-cases/avisos-quadro.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { depsSobreTrx, executar, MARLON, servicosDeTeste, useCasesDeTeste } from "../helpers/deps-l6.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_ANA } from "../helpers/ids.ts";
import { pessoaDeTeste } from "../helpers/pessoa-de-teste.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../helpers/servidor-de-teste.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * NOD-442 (ADR-135): o teste de contrato das ações `quadro.*`. A mesma ação pela tela (rota HTTP, autor a pessoa) e pelo
 * chat (gerir_quadro de um bot) leva o mesmo estado inicial ao mesmo estado final, e QUALQUER bot faz igual: o Nod e um
 * bot comum chegam ao mesmo quadro. É o arquivo que o registro cita como `contrato` (src/domain/acoes/quadro.ts).
 */

type Retrato = { meta: string | null; prazo: string | null; cumprida: boolean; resumo: string | null; colunas: unknown[]; tarefas: unknown[]; turnosAbertos: number; importacao: unknown[] | null; assumido: boolean; rotinas: string[]; modo: string; membros: string[]; comentarios: unknown[] };

/** NOD-422: o Linear de mentira (as duas pontas recebem as mesmas issues abertas do time). */
const issueFalsa = (n: number, estado: string, o: Partial<IssueLinear> = {}): IssueLinear => ({
  identificador: `NOD-${n}`, numero: n, titulo: `Issue ${n}`, url: `https://linear.app/gamefik/issue/NOD-${n}`, descricao: "corpo", estado,
  noEstadoDesde: Date.UTC(2026, 9, 30), etiquetas: [], mae: null, bloqueadaPor: [], comentarios: [], anexos: [], ...o,
});
const LINEAR_FALSO: FonteLinear = {
  async listar(_cred, p) {
    const todas = [
      issueFalsa(901, "Implementando", { comentarios: [{ id: "c1", autor: "Ada", texto: "começa por aqui", criadoEm: Date.UTC(2026, 9, 31) }] }),
      issueFalsa(902, "Backlog"),
      issueFalsa(903, "Revisando", { anexos: [{ url: "https://github.com/gamefik/nod/pull/9", criadoEm: Date.UTC(2026, 9, 31) }] }),
    ];
    await p.aoAvancar?.(todas.length);
    return todas;
  },
};
const retrato = (q: QuadroDto | null, turnos: number, rotinas: string[] = []): Retrato | null =>
  q
    ? {
        meta: q.meta,
        prazo: q.prazo,
        cumprida: q.cumpridoEm !== null,
        resumo: q.resumo,
        colunas: q.colunas.map((c) => [c.id, c.nome, c.grupo, c.responsavelNome ?? null, c.instrucoes ?? null, c.trava ?? null, c.prazoMin ?? null]),
        tarefas: q.tarefas.map((t) => [t.titulo, t.descricao, t.status, t.agenteNome, t.linearId, t.prUrl, t.pergunta, t.resposta, t.execucao]),
        turnosAbertos: turnos,
        importacao: q.importacao ? [q.importacao.estado, q.importacao.time, q.importacao.total, q.importacao.trazidas, q.importacao.colunas] : null,
        // NOD-422 (PR 2): o quadro assumido e o estado das rotinas do anfitrião (pela instrução, na ordem).
        assumido: (q.assumidoEm ?? null) !== null,
        rotinas,
        // NOD-443: o modo, quem está no quadro e os comentários (o texto e a tarefa; a assinatura diz o bot, e difere).
        modo: q.modoConversa,
        membros: (q.membros ?? []).map((m) => m.nome),
        comentarios: (q.comentarios ?? []).map((c) => [c.texto, c.tarefaId ? q.tarefas.find((t) => t.id === c.tarefaId)?.titulo : null]),
      }
    : null;

const COLEGA = pessoaDeTeste("Paula Paridade");

describeIntegracao("paridade tela × chat do quadro.* (NOD-442, ADR-135)", () => {
  let servidor: ServidorDeTeste;
  let trxAtual: Tx | null = null;

  beforeAll(async () => {
    const deps: DepsRotas = {
      abrirTx:
        (escopo: Escopo) =>
        async <T,>(fn: (t: Tx) => Promise<T>): Promise<T> => {
          const trx = trxAtual;
          if (!trx) throw new Error("teste sem transação aberta");
          const caixa: { valor?: T } = {};
          await trx.savepoint(async (sp) => {
            await vincularEscopo(sp, escopo);
            caixa.valor = await fn(sp);
          });
          return caixa.valor as T;
        },
      services: { ...servicosDeTeste((t) => criarRepos(t, MARLON), MARLON), linear: LINEAR_FALSO },
      useCases: useCasesDeTeste(),
      executor: "catcher",
    };
    servidor = await servidorDeTeste([...rotasQuadro(deps), ...criarRotasRaioX(deps)]);
    // NOD-443: alguém do time para pôr no quadro.
    await COLEGA.criar();
  });
  afterAll(() => servidor.close());

  /** O bot que chama o gerir_quadro: um turno de conversa dele (o executor dos turnos que o lote abrir sai daqui). */
  async function turnoDe(d: Deps, agenteId: string, conversaId: string) {
    const turno = await d.repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "pedido", entradaConfianca: "confiavel", modelo: "auto" });
    if (!turno) throw new Error("turno");
    return { turnoId: turno.id, agenteId, conversaId };
  }

  async function montar(trx: Tx) {
    const d = depsSobreTrx(trx, MARLON, { services: { ...servicosDeTeste((t) => criarRepos(t, MARLON), MARLON), linear: LINEAR_FALSO } });
    await d.repos.preferencias.gravar({ experimentos: { quadro: true } });
    const sufixo = Math.random().toString(36).slice(2, 7);
    const tela = await agenteComConversa(trx, MARLON, { nome: `Tela ${sufixo}` });
    const chat = await agenteComConversa(trx, MARLON, { nome: `Chat ${sufixo}` });
    // O bot que faz pelo chat (comum) e o que executa as tarefas dos dois quadros.
    const gil = await agenteComConversa(trx, MARLON, { nome: `Gil ${sufixo}` });
    const caio = await agenteComConversa(trx, MARLON, { nome: `Caio ${sufixo}` });
    return { d, tela, chat, gil, caio, nomeChat: `Chat ${sufixo}`, nomeCaio: `Caio ${sufixo}`, nomeGil: `Gil ${sufixo}` };
  }

  type M = Awaited<ReturnType<typeof montar>>;
  const pessoa = (d: Deps, anfitriaoId: string, ops: OpQuadro[]) => executar(d, aplicarLoteQuadro, { autor: { tipo: "pessoa" }, anfitriaoId, executor: "catcher", ops });
  const estado = async (m: M, anfitriaoId: string) => {
    const q = await m.d.repos.quadros.doAgente(anfitriaoId);
    const tarefas = q ? await m.d.repos.quadros.tarefas(q.id) : [];
    const rotinas = (await m.d.repos.rotinas.listarDoAgente(anfitriaoId)).map((r) => `${r.instrucao}:${r.estado}`).sort();
    const r = retrato(q ? await montarQuadro(m.d, q) : null, tarefas.filter((t) => t.turnoId).length, rotinas);
    // NOD-418: os trabalhos de cada tarefa (estado, origem, recados) entram na comparação.
    const trabalhos: unknown[] = [];
    for (const t of tarefas) {
      const execs = await m.d.repos.quadroExecucoes.daTarefa(t.id);
      const recados = await m.d.repos.quadroExecucoes.recadosDaTela(t.id);
      const turnos = await Promise.all(execs.map((e) => m.d.repos.turnos.buscar(e.turnoId)));
      // ADA-232: a volta que dorme na cadeia (o "Acordar agora" a traz para já).
      const dormindo = await Promise.all(execs.map(async (e) => (await trxAtual!<{ n: number }[]>`select count(*)::int as n from turnos where retoma_turno_id = ${e.turnoId} and estado = 'pendente' and acordar_em > clock_timestamp()`)[0]!.n));
      trabalhos.push([t.titulo, execs.map((e, i) => [e.numero, e.origem, e.canceladaEm !== null, turnos[i]?.estado, turnos[i]?.pararSolicitadoEm != null, turnos[i]?.entradaTexto?.includes("use a branch y"), dormindo[i]]), recados.map((x) => [x.texto, x.entregueEm !== null, x.canceladoEm !== null])]);
    }
    return r ? { ...r, trabalhos } : null;
  };

  const ultimoMovimento = async (m: M, anfitriaoId: string, titulo: string) => {
    const q = (await m.d.repos.quadros.doAgente(anfitriaoId))!;
    const t = (await m.d.repos.quadros.tarefas(q.id)).find((x) => x.titulo === titulo)!;
    return (await m.d.repos.quadros.ultimosMovimentos(q.id, 1)).find((x) => x.tarefaId === t.id)!.id;
  };
  type Cenario = {
    id: (typeof ACOES_QUADRO)[number]["id"];
    /** O mesmo preparo nos dois quadros (pela pessoa). */
    preparar?: (m: M) => OpQuadro[][];
    tela: (m: M, q: { anfitriao: string; tarefa: (titulo: string) => Promise<string>; ultimoLote: () => Promise<string>; ultimoMovimento: (titulo: string) => Promise<string> }) => Promise<{ metodo: string; caminho: string; corpo?: unknown; status: number }>;
    /**
     * NOD-419: o chat lê o id do movimento como o bot lê, na saída do gerir_quadro (revisão do PR #629: não do
     * repositório). `movimentoNaSaida` = o mais novo da tarefa no resumo da última chamada do preparo pelo bot.
     */
    chat: (m: M, q: { movimentoNaSaida: (titulo: string) => string }) => OpQuadro | Promise<OpQuadro>;
    /** O último passo do preparo, no quadro do chat, sai pelo gerir_quadro do Gil (a pessoa na conversa), não pela pessoa. */
    ultimoPreparoPeloBot?: true;
    /** A ação apaga o quadro: os dois lados terminam sem quadro. */
    semQuadroNoFim?: boolean;
    /** O chat abre um card: a pessoa confirma antes da comparação (as colunas, a importação ou a exclusão do quadro da NOD-430). */
    confirmar?: "colunas" | "importacao" | "exclusao" | "assumir";
    /** NOD-422 (PR 2): uma rotina ativa em cada anfitrião (o assumir pausa as duas igual). */
    rotina?: true;
    /** NOD-422: o Linear da pessoa conectado (chave e sessão do Composio); a busca pós-commit roda nas duas pontas. */
    linear?: true;
    /** Depois do preparo, os turnos dos trabalhos terminam (o Repetir só vale sem trabalho rodando). */
    terminarTrabalhos?: true;
    /** ADA-232: depois do preparo, cada trabalho ganha uma volta que dorme 1 h na cadeia (o me_chame_as), nos dois quadros. */
    dormir?: true;
    /** A ação leva a tarefa a outro quadro: o destino da tela e o do chat (criados vazios antes) também terminam iguais. */
    destinos?: (m: M) => [string, string];
  };
  const DOCES = [
    { nome: "Pedido", grupo: "nao_iniciado" as const }, { nome: "Compras", grupo: "iniciado" as const }, { nome: "Produção", grupo: "iniciado" as const },
    { nome: "Finalização", grupo: "iniciado" as const }, { nome: "Embalagem", grupo: "iniciado" as const }, { nome: "Entrega", grupo: "iniciado" as const },
    { nome: "Pago", grupo: "feito" as const },
  ];
  const BASE: (m: M) => OpQuadro[][] = (m) => [[{ tipo: "criar_quadro", meta: "Lançar login", prazo: "2026-11-06" }, { tipo: "criar_tarefa", titulo: "T1" }, { tipo: "criar_tarefa", titulo: "T2", status: "backlog", agente: m.nomeCaio }]];
  const comPergunta: (m: M) => OpQuadro[][] = (m) => [...BASE(m), [{ tipo: "mudar_tarefa", tarefa: "T2", status: "voce", pergunta: "Qual cor?" }]];
  const CENARIOS: Cenario[] = [
    { id: "quadro.criar", tela: async (_m, q) => ({ metodo: "POST", caminho: `/agentes/${q.anfitriao}/quadro`, corpo: { meta: "Lançar login", prazo: "2026-11-06" }, status: 201 }), chat: () => ({ tipo: "criar_quadro", meta: "Lançar login", prazo: "2026-11-06" }) },
    { id: "quadro.editar", preparar: BASE, tela: async (_m, q) => ({ metodo: "PATCH", caminho: `/agentes/${q.anfitriao}/quadro`, corpo: { meta: "Lançar o login novo", prazo: null }, status: 200 }), chat: () => ({ tipo: "editar_quadro", meta: "Lançar o login novo", prazo: null }) },
    { id: "quadro.criar_tarefa", preparar: BASE, tela: async (m, q) => ({ metodo: "POST", caminho: `/agentes/${q.anfitriao}/quadro/tarefas`, corpo: { titulo: "T3", descricao: "d", agente: m.nomeCaio }, status: 201 }), chat: (m) => ({ tipo: "criar_tarefa", titulo: "T3", descricao: "d", agente: m.nomeCaio }) },
    {
      id: "quadro.importar_linear",
      preparar: BASE,
      tela: async (_m, q) => ({ metodo: "POST", caminho: `/agentes/${q.anfitriao}/quadro/linear`, corpo: { itens: [{ identificador: "NOD-9", titulo: "Do Linear", url: "https://linear.app/gamefik/issue/NOD-9" }] }, status: 200 }),
      chat: () => ({ tipo: "importar_linear", itens: [{ identificador: "NOD-9", titulo: "Do Linear", url: "https://linear.app/gamefik/issue/NOD-9" }] }),
    },
    {
      // NOD-422: pela tela o clique em Trazer (depois da prévia) é a confirmação; pelo chat vira o card de prévia e só
      // inicia ao confirmar. Nas duas, a busca roda depois do commit e aplica num lote só, sem acionar ninguém.
      id: "quadro.importar_time_linear",
      preparar: BASE,
      linear: true,
      tela: async (_m, q) => ({ metodo: "POST", caminho: `/agentes/${q.anfitriao}/quadro/importacao`, corpo: { time: "nod" }, status: 202 }),
      chat: () => ({ tipo: "importar_time_linear", time: "nod" }),
      confirmar: "importacao",
    },
    {
      // NOD-422 (PR 2): pela tela o clique depois da prévia é a confirmação; pelo chat vira o card e só pausa ao confirmar.
      id: "quadro.assumir",
      preparar: BASE,
      rotina: true,
      tela: async (_m, q) => ({ metodo: "POST", caminho: `/agentes/${q.anfitriao}/quadro/assumir`, corpo: {}, status: 200 }),
      chat: () => ({ tipo: "assumir_quadro" }),
      confirmar: "assumir",
    },
    {
      id: "quadro.mudar_tarefa",
      preparar: BASE,
      tela: async (m, q) => ({ metodo: "PATCH", caminho: `/agentes/${q.anfitriao}/quadro/tarefas/${await q.tarefa("T1")}`, corpo: { status: "afazer", agente: m.nomeCaio }, status: 200 }),
      chat: (m) => ({ tipo: "mudar_tarefa", tarefa: "T1", status: "afazer", agente: m.nomeCaio }),
    },
    {
      id: "quadro.responder",
      preparar: comPergunta,
      tela: async (_m, q) => ({ metodo: "POST", caminho: `/agentes/${q.anfitriao}/quadro/tarefas/${await q.tarefa("T2")}/resposta`, corpo: { resposta: "Azul" }, status: 200 }),
      chat: () => ({ tipo: "responder", tarefa: "T2", resposta: "Azul" }),
    },
    {
      // NOD-417: não é lote e não muda a tarefa (o responsável segue o mesmo); o comentário da pessoa aciona o responsável,
      // o do bot só o @mencionado — aqui os dois mencionam o responsável e chegam ao mesmo estado.
      id: "quadro.comentar",
      preparar: BASE,
      tela: async (m, q) => ({ metodo: "POST", caminho: `/agentes/${q.anfitriao}/quadro/tarefas/${await q.tarefa("T2")}/comentarios`, corpo: { texto: `@${m.nomeCaio} dá uma olhada` }, status: 201 }),
      chat: (m) => ({ tipo: "comentar", tarefa: "T2", texto: `@${m.nomeCaio} dá uma olhada` }),
    },
    {
      id: "quadro.desfazer",
      preparar: (m) => [...BASE(m), [{ tipo: "mudar_tarefa", tarefa: "T1", status: "feito" }, { tipo: "criar_tarefa", titulo: "T4" }]],
      tela: async (_m, q) => ({ metodo: "POST", caminho: `/agentes/${q.anfitriao}/quadro/lotes/${await q.ultimoLote()}/desfazer`, status: 200 }),
      chat: () => ({ tipo: "desfazer" }),
    },
    {
      // NOD-415 (ADR-141): voltar a agente comum. O preparo deixa um turno de tarefa rodando: a remoção o para.
      id: "quadro.remover",
      preparar: (m) => [...BASE(m), [{ tipo: "mudar_tarefa", tarefa: "T1", status: "afazer", agente: m.nomeCaio }]],
      tela: async (_m, q) => ({ metodo: "DELETE", caminho: `/agentes/${q.anfitriao}/quadro`, status: 200 }),
      // NOD-430: qualquer bot pede (aqui o Gil, o quadro é do Chat) e vira o card 'quadro_exclusao' (Excluir / Agora não).
      chat: (m) => ({ tipo: "remover_quadro", bot: m.nomeChat }),
      semQuadroNoFim: true,
      confirmar: "exclusao",
    },
    {
      // NOD-416 (ADR-144): mudar de quadro. A tela leva T1 ao quadro do Caio; o chat, ao do Gil. Nenhum turno abre.
      id: "quadro.mover_tarefa",
      preparar: BASE,
      tela: async (m, q) => ({ metodo: "POST", caminho: `/agentes/${q.anfitriao}/quadro/tarefas/${await q.tarefa("T1")}/mover`, corpo: { quadro: m.nomeCaio }, status: 200 }),
      chat: (m) => ({ tipo: "mover_quadro", tarefa: "T1", quadro: m.nomeGil }),
      destinos: (m) => [m.caio.agenteId, m.gil.agenteId],
    },
    // NOD-448 (ADR-140): as colunas.
    {
      id: "quadro.criar_coluna",
      preparar: BASE,
      tela: async (_m, q) => ({ metodo: "POST", caminho: `/agentes/${q.anfitriao}/quadro/colunas`, corpo: { nome: "Testes", grupo: "iniciado", depois_de: "fazendo" }, status: 201 }),
      chat: () => ({ tipo: "criar_coluna", nome: "Testes", grupo: "iniciado", depois_de: "fazendo" }),
    },
    {
      id: "quadro.renomear_coluna",
      preparar: BASE,
      tela: async (_m, q) => ({ metodo: "PATCH", caminho: `/agentes/${q.anfitriao}/quadro/colunas/voce`, corpo: { nome: "Comigo" }, status: 200 }),
      chat: () => ({ tipo: "renomear_coluna", coluna: "Precisa de você", nome: "Comigo" }),
    },
    {
      id: "quadro.mover_coluna",
      preparar: BASE,
      tela: async (_m, q) => ({ metodo: "POST", caminho: `/agentes/${q.anfitriao}/quadro/colunas/bloqueado/mover`, corpo: { antes_de: "fazendo" }, status: 200 }),
      chat: () => ({ tipo: "mover_coluna", coluna: "Bloqueado", antes_de: "Fazendo" }),
    },
    {
      // Com tarefa: pede destino, e a tarefa vai junto, sem acionar ninguém (decisão do Gil).
      id: "quadro.remover_coluna",
      preparar: BASE,
      tela: async (_m, q) => ({ metodo: "DELETE", caminho: `/agentes/${q.anfitriao}/quadro/colunas/backlog?destino=afazer`, status: 200 }),
      chat: () => ({ tipo: "remover_coluna", coluna: "Backlog", destino: "A fazer" }),
    },
    {
      // Pela tela aplica direto; pelo chat vira card e só aplica ao confirmar (o teste confirma antes de comparar).
      id: "quadro.substituir_colunas",
      preparar: BASE,
      tela: async (_m, q) => ({ metodo: "PUT", caminho: `/agentes/${q.anfitriao}/quadro/colunas`, corpo: { colunas: DOCES }, status: 200 }),
      chat: () => ({ tipo: "substituir_colunas", colunas: DOCES }),
      confirmar: "colunas",
    },
    // ADR-142: a passagem por coluna e o fim da etapa (o terminei leva T1 a Em revisão, e o Caio começa).
    {
      id: "quadro.definir_passagem",
      preparar: BASE,
      tela: async (m, q) => ({ metodo: "PUT", caminho: `/agentes/${q.anfitriao}/quadro/colunas/revisao/passagem`, corpo: { agente: m.nomeCaio, instrucoes: "Revise o PR" }, status: 200 }),
      chat: (m) => ({ tipo: "definir_passagem", coluna: "Em revisão", agente: m.nomeCaio, instrucoes: "Revise o PR" }),
    },
    {
      id: "quadro.terminei",
      preparar: (m) => [...BASE(m), [{ tipo: "definir_passagem", coluna: "revisao", agente: m.nomeCaio }, { tipo: "mudar_tarefa", tarefa: "T1", status: "fazendo" }]],
      tela: async (_m, q) => ({ metodo: "POST", caminho: `/agentes/${q.anfitriao}/quadro/tarefas/${await q.tarefa("T1")}/terminei`, status: 200 }),
      chat: () => ({ tipo: "terminei", tarefa: "T1" }),
    },
    // NOD-443 (ADR-143): as pessoas e o modo.
    { id: "quadro.adicionar_pessoa", preparar: BASE, tela: async (_m, q) => ({ metodo: "POST", caminho: `/agentes/${q.anfitriao}/quadro/pessoas`, corpo: { pessoa: COLEGA.nome }, status: 200 }), chat: () => ({ tipo: "adicionar_pessoa", pessoa: COLEGA.nome }) },
    {
      id: "quadro.tirar_pessoa",
      preparar: (m) => [...BASE(m), [{ tipo: "adicionar_pessoa", pessoa: COLEGA.nome }]],
      tela: async (_m, q) => ({ metodo: "DELETE", caminho: `/agentes/${q.anfitriao}/quadro/pessoas/${COLEGA.id}`, status: 200 }),
      chat: () => ({ tipo: "tirar_pessoa", pessoa: COLEGA.nome }),
    },
    { id: "quadro.mudar_modo", preparar: BASE, tela: async (_m, q) => ({ metodo: "PATCH", caminho: `/agentes/${q.anfitriao}/quadro/modo`, corpo: { modo: "so_dono" }, status: 200 }), chat: () => ({ tipo: "mudar_modo", modo: "so_dono" }) },
    // NOD-419: a trava da coluna e o Desfazer de um movimento do histórico.
    {
      id: "quadro.travar_coluna",
      preparar: BASE,
      tela: async (_m, q) => ({ metodo: "PATCH", caminho: `/agentes/${q.anfitriao}/quadro/colunas/revisao/trava`, corpo: { sai_para: ["feito"], so_pessoa: true }, status: 200 }),
      chat: () => ({ tipo: "travar_coluna", coluna: "Em revisão", sai_para: ["Feito"], so_pessoa: true }),
    },
    {
      id: "quadro.desfazer_movimento",
      preparar: (m) => [...BASE(m), [{ tipo: "mudar_tarefa", tarefa: "T2", status: "revisao" }]],
      ultimoPreparoPeloBot: true,
      tela: async (_m, q) => ({ metodo: "POST", caminho: `/agentes/${q.anfitriao}/quadro/tarefas/${await q.tarefa("T2")}/movimentos/${await q.ultimoMovimento("T2")}/desfazer`, status: 200 }),
      chat: (_m, q) => ({ tipo: "desfazer_movimento", tarefa: "T2", movimento: q.movimentoNaSaida("T2") }),
    },
    // NOD-418: o trabalho da tarefa. O preparo deixa T1 em A fazer com o Caio (o trabalho #1 na fila).
    {
      id: "quadro.repetir_trabalho",
      // Com o trabalho vivo o Repetir é recusado (estado_invalido, revisão do PR #625): o #1 termina antes.
      preparar: (m) => [...BASE(m), [{ tipo: "mudar_tarefa", tarefa: "T1", status: "afazer", agente: m.nomeCaio }]],
      terminarTrabalhos: true,
      tela: async (_m, q) => ({ metodo: "POST", caminho: `/agentes/${q.anfitriao}/quadro/tarefas/${await q.tarefa("T1")}/trabalhos/repetir`, status: 200 }),
      chat: () => ({ tipo: "repetir_trabalho", tarefa: "T1" }),
    },
    {
      id: "quadro.cancelar_trabalho",
      preparar: (m) => [...BASE(m), [{ tipo: "mudar_tarefa", tarefa: "T1", status: "afazer", agente: m.nomeCaio }]],
      tela: async (_m, q) => ({ metodo: "POST", caminho: `/agentes/${q.anfitriao}/quadro/tarefas/${await q.tarefa("T1")}/trabalhos/cancelar`, status: 200 }),
      chat: () => ({ tipo: "cancelar_trabalho", tarefa: "T1" }),
    },
    {
      id: "quadro.recado_trabalho",
      preparar: (m) => [...BASE(m), [{ tipo: "mudar_tarefa", tarefa: "T1", status: "afazer", agente: m.nomeCaio }]],
      tela: async (_m, q) => ({ metodo: "POST", caminho: `/agentes/${q.anfitriao}/quadro/tarefas/${await q.tarefa("T1")}/trabalhos/recado`, corpo: { texto: "use a branch y" }, status: 201 }),
      chat: () => ({ tipo: "recado", tarefa: "T1", texto: "use a branch y" }),
    },
    // ADA-232: "Acordar agora" — o trabalho #1 terminou o turno marcando a volta (dorme 1 h); a ação a traz para já.
    {
      id: "quadro.acordar_trabalho",
      preparar: (m) => [...BASE(m), [{ tipo: "mudar_tarefa", tarefa: "T1", status: "afazer", agente: m.nomeCaio }]],
      terminarTrabalhos: true,
      dormir: true,
      tela: async (_m, q) => ({ metodo: "POST", caminho: `/agentes/${q.anfitriao}/quadro/tarefas/${await q.tarefa("T1")}/trabalhos/acordar`, status: 200 }),
      chat: () => ({ tipo: "acordar_trabalho", tarefa: "T1" }),
    },
  ];

  it("cobre exatamente as ações do quadro, e o executor de cada uma existe", () => {
    // ADA-14: as dos N quadros têm o contrato próprio (paridade-quadros-do-bot.test.ts), que cobre as dele.
    const deste = ACOES_QUADRO.filter((a) => a.chat.contrato === "tests/integration/paridade-quadro.test.ts");
    expect(CENARIOS.map((c) => c.id).sort()).toEqual(deste.map((a) => a.id).sort());
    expect(Object.keys(EXECUTORES_QUADRO).sort()).toEqual(ACOES_QUADRO.map((a) => a.id).sort());
  });

  it.each(CENARIOS)("$id: a rota e o gerir_quadro levam o mesmo estado inicial ao mesmo estado final", async (c) => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const m = await montar(trx);
      const preparo = c.preparar?.(m) ?? [];
      let saidaDoPreparo: ResultadoGerirQuadro | null = null;
      for (const [i, ops] of preparo.entries()) {
        expect((await pessoa(m.d, m.tela.agenteId, ops)).data).toMatchObject({ ok: true });
        if (c.ultimoPreparoPeloBot && i === preparo.length - 1) {
          saidaDoPreparo = (await executar(m.d, gerirQuadro, { ...(await turnoDe(m.d, m.gil.agenteId, m.gil.conversaId)), quadro: m.nomeChat, acoes: ops })).data;
          expect(saidaDoPreparo, JSON.stringify(saidaDoPreparo)).toMatchObject({ ok: true });
        } else expect((await pessoa(m.d, m.chat.agenteId, ops)).data).toMatchObject({ ok: true });
      }
      const movimentoNaSaida = (titulo: string): string => {
        const id = saidaDoPreparo?.ok ? saidaDoPreparo.quadro?.tarefas.find((t) => t.titulo === titulo)?.movimentos?.[0]?.id : undefined;
        if (!id) throw new Error(`sem movimento de ${titulo} na saída do gerir_quadro: ${JSON.stringify(saidaDoPreparo)}`);
        return id;
      };
      if (c.terminarTrabalhos) await trx`update turnos set estado = 'concluido' where id in (select turno_id from quadro_execucoes where owner_id = ${MARLON.pessoaId})`;
      if (c.dormir) {
        await trx`insert into turnos (tenant_id, id, owner_id, conversa_id, agente_id, origem, estado, prazo_em, profundidade, entrada_texto, entrada_confianca, retoma_turno_id, executor, modelo, acordar_em)
          select tenant_id, gen_random_uuid(), owner_id, conversa_id, agente_id, 'retomada', 'pendente', prazo_em, profundidade, 'volta', entrada_confianca, id, executor, modelo, now() + interval '1 hour'
          from turnos where id in (select turno_id from quadro_execucoes where owner_id = ${MARLON.pessoaId})`;
        await trx`update turnos set despertar_em = now() + interval '1 hour', despertar_motivo = 'o deploy' where id in (select turno_id from quadro_execucoes where owner_id = ${MARLON.pessoaId})`;
      }
      expect(await estado(m, m.tela.agenteId)).toEqual(await estado(m, m.chat.agenteId));
      if (c.linear) {
        await m.d.repos.composio.salvarChave("cifrada-de-teste");
        const [conector] = await trx<{ id: string }[]>`
          insert into conectores (tenant_id, owner_id, nome, slug, transporte, url, declaracao)
          values (${MARLON.tenantId}, ${MARLON.pessoaId}, 'Linear', 'linear', 'http', 'https://exemplo.invalid/mcp', 'toca')
          returning id`;
        await m.d.repos.composio.salvarSessao({ toolkit: "linear", sessaoId: "sess_l", contaId: "ca_l", conectorId: conector!.id });
      }
      if (c.rotina) {
        for (const a of [m.tela, m.chat]) {
          await m.d.repos.rotinas.criar({ agenteId: a.agenteId, conversaId: a.conversaId, cron: "0 8 * * *", fusoIana: "UTC", instrucao: "Rodar a esteira", fonte: "f", entregavel: "e", limitesAprovacao: "", politicaSemDado: "", proximaExecucao: Date.now() + 3_600_000 });
        }
      }
      for (const destino of c.destinos?.(m) ?? []) expect((await pessoa(m.d, destino, [{ tipo: "criar_quadro", meta: "Lançar login", prazo: "2026-11-06" }])).data).toMatchObject({ ok: true });

      const sessao = await servidor.entrar("marlon");
      const auxiliares = {
        anfitriao: m.tela.agenteId,
        tarefa: async (titulo: string) => {
          const q = await m.d.repos.quadros.doAgente(m.tela.agenteId);
          return (await m.d.repos.quadros.tarefas(q!.id)).find((t) => t.titulo === titulo)!.id;
        },
        ultimoLote: async () => (await m.d.repos.quadros.ultimoLote((await m.d.repos.quadros.doAgente(m.tela.agenteId))!.id))!.id,
        ultimoMovimento: (titulo: string) => ultimoMovimento(m, m.tela.agenteId, titulo),
      };
      const t = await c.tela(m, auxiliares);
      const resp = await servidor.chamar(sessao, t.metodo, t.caminho, t.corpo);
      expect(resp.status, await resp.clone().text()).toBe(t.status);

      const quem = m.gil;
      const ctx = await turnoDe(m.d, quem.agenteId, quem.conversaId);
      const antes = await estado(m, m.chat.agenteId);
      const r = await executar(m.d, gerirQuadro, { ...ctx, quadro: m.nomeChat, acoes: [await c.chat(m, { movimentoNaSaida })] });
      expect(r.data, JSON.stringify(r.data)).toMatchObject({ ok: true });
      if (c.confirmar) {
        if (!r.data.ok || !r.data.proposta_id) throw new Error("sem card");
        // Antes de confirmar, nada mudou no quadro do chat.
        expect(await estado(m, m.chat.agenteId)).toEqual(antes);
        if (c.confirmar === "colunas") expect((await executar(m.d, decidirColunasDoQuadro, { decisaoId: r.data.proposta_id, recusar: false, executor: "catcher" })).data).toMatchObject({ aplicado: true });
        else if (c.confirmar === "assumir") expect((await executar(m.d, decidirAssumirQuadro, { decisaoId: r.data.proposta_id, recusar: false })).data).toMatchObject({ assumido: true });
        else if (c.confirmar === "exclusao") expect((await executar(m.d, decidirQuadroExclusao, { decisaoId: r.data.proposta_id, recusar: false, executor: "catcher" })).data).toMatchObject({ aplicado: true });
        else expect((await executar(m.d, decidirImportacaoLinear, { decisaoId: r.data.proposta_id, recusar: false })).data).toMatchObject({ iniciada: true });
      }
      if (c.linear) {
        // O efeito pós-commit (importar_linear) das duas pontas: a busca e a aplicação, como o compor faria.
        const rodar: RodarNaTx = async (fn) => {
          const x = await fn(m.d);
          if (x.events?.length) await m.d.repos.events.gravarComOutbox(x.events);
          return x.data;
        };
        for (const a of [m.tela.agenteId, m.chat.agenteId]) {
          const i = await m.d.repos.quadroImportacoes.ultima((await m.d.repos.quadros.doAgente(a))!.id);
          expect(await trazerImportacao(rodar, i!.id)).toBe("aplicada");
        }
      }

      const doLadoDaTela = await estado(m, m.tela.agenteId);
      if (c.semQuadroNoFim) expect(doLadoDaTela).toBeNull();
      else expect(doLadoDaTela).not.toBeNull();
      if (c.rotina) expect(doLadoDaTela).toMatchObject({ assumido: true, rotinas: ["Rodar a esteira:pausada"] });
      if (c.linear) {
        // As 3 issues entraram (T1 e T2 ficam), aplicada, e ninguém foi acionado.
        expect(doLadoDaTela?.tarefas).toHaveLength(5);
        expect(doLadoDaTela?.importacao?.[0]).toBe("aplicada");
        expect(doLadoDaTela?.turnosAbertos).toBe(0);
      }
      expect(await estado(m, m.chat.agenteId)).toEqual(doLadoDaTela);
      if (c.destinos) {
        const [daTela, doChat] = c.destinos(m);
        const destinoDaTela = await estado(m, daTela);
        expect(destinoDaTela?.tarefas).toHaveLength(1);
        expect(await estado(m, doChat)).toEqual(destinoDaTela);
      }
    });
  });

  it("qualquer bot: o Nod e um bot comum fazem a mesma jornada e chegam ao mesmo quadro", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      // A trava do Nod ANTES das preferências (o montar grava): o garantirNod trava e depois grava as preferências (a guia);
      // na ordem inversa, outro arquivo em paralelo com o Nod da mesma pessoa fazia deadlock (CI da main @0d2345b4).
      const { nod } = (await executar(depsSobreTrx(trx, MARLON), garantirNod, {})).data;
      const m = await montar(trx);
      const ops: OpQuadro[][] = [
        [{ tipo: "criar_quadro", meta: "Meta", prazo: "2026-11-06" }, { tipo: "importar_linear", itens: [{ identificador: "NOD-1", titulo: "A" }, { identificador: "NOD-2", titulo: "B" }] }],
        [{ tipo: "mudar_tarefa", tarefa: "NOD-1", agente: m.nomeCaio, status: "afazer" }],
        [{ tipo: "mudar_tarefa", tarefa: "NOD-2", status: "voce", pergunta: "Pode?" }],
        [{ tipo: "responder", tarefa: "NOD-2", resposta: "Pode" }],
        [{ tipo: "mudar_tarefa", tarefa: "NOD-1", pr_url: "https://github.com/gamefik/nod/pull/1" }],
        [{ tipo: "mudar_tarefa", tarefa: "NOD-1", status: "feito" }, { tipo: "mudar_tarefa", tarefa: "NOD-2", status: "feito" }],
      ];
      const pelo = async (autor: { agenteId: string; conversaId: string }, anfitriao: string) => {
        const ctx = await turnoDe(m.d, autor.agenteId, autor.conversaId);
        for (const acoes of ops) {
          const r = await executar(m.d, gerirQuadro, { ...ctx, quadro: anfitriao, acoes });
          expect(r.data, JSON.stringify(r.data)).toMatchObject({ ok: true });
        }
      };
      await pelo({ agenteId: nod.id, conversaId: nod.conversaId }, m.tela.agenteId);
      await pelo({ agenteId: m.gil.agenteId, conversaId: m.gil.conversaId }, m.chat.agenteId);
      const final = await estado(m, m.tela.agenteId);
      expect(final).toMatchObject({ cumprida: true, resumo: expect.stringContaining("2 de 2 tarefas feitas") });
      expect(await estado(m, m.chat.agenteId)).toEqual(final);
    });
  });

  it("NOD-420: o prazo da coluna pela tela (PATCH prazo_min) e pelo chat (renomear_coluna) chega ao mesmo quadro, e o null tira nos dois", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const m = await montar(trx);
      for (const anfitriao of [m.tela.agenteId, m.chat.agenteId]) expect((await pessoa(m.d, anfitriao, BASE(m)[0]!)).data).toMatchObject({ ok: true });
      const sessao = await servidor.entrar("marlon");
      const ctx = await turnoDe(m.d, m.gil.agenteId, m.gil.conversaId);
      const prazoDe = async (a: string) => (await estado(m, a))?.colunas.find((c) => (c as unknown[])[0] === "revisao") as unknown[] | undefined;
      for (const prazo_min of [120, null]) {
        const resp = await servidor.chamar(sessao, "PATCH", `/agentes/${m.tela.agenteId}/quadro/colunas/revisao`, { prazo_min });
        expect(resp.status, await resp.clone().text()).toBe(200);
        const r = await executar(m.d, gerirQuadro, { ...ctx, quadro: m.nomeChat, acoes: [{ tipo: "renomear_coluna", coluna: "Em revisão", prazo_min }] });
        expect(r.data, JSON.stringify(r.data)).toMatchObject({ ok: true });
        expect((await prazoDe(m.tela.agenteId))?.at(-1)).toBe(prazo_min);
        expect(await estado(m, m.chat.agenteId)).toEqual(await estado(m, m.tela.agenteId));
      }
      // Fora do andamento (Precisa de você), a tela e o chat recusam do mesmo jeito.
      expect((await servidor.chamar(sessao, "PATCH", `/agentes/${m.tela.agenteId}/quadro/colunas/voce`, { prazo_min: 60 })).status).toBe(400);
      expect((await executar(m.d, gerirQuadro, { ...ctx, quadro: m.nomeChat, acoes: [{ tipo: "renomear_coluna", coluna: "Precisa de você", prazo_min: 60 }] })).data).toMatchObject({ ok: false });
      // O tipo do prazo_min é da rota (revisão 3 do PR #624): texto, fração ou booleano é 400 e o quadro não muda.
      const antes = await estado(m, m.tela.agenteId);
      for (const prazo_min of ["60", 1.5, true]) {
        expect((await servidor.chamar(sessao, "PATCH", `/agentes/${m.tela.agenteId}/quadro/colunas/revisao`, { prazo_min })).status).toBe(400);
        expect((await servidor.chamar(sessao, "POST", `/agentes/${m.tela.agenteId}/quadro/colunas`, { nome: "Teste", grupo: "andamento", prazo_min })).status).toBe(400);
      }
      expect(await estado(m, m.tela.agenteId)).toEqual(antes);
    });
  });

  it("NOD-420 (QA do PR #624): prazo_min fora da faixa diz a faixa permitida na tela e no chat, não um erro genérico", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const m = await montar(trx);
      for (const anfitriao of [m.tela.agenteId, m.chat.agenteId]) expect((await pessoa(m.d, anfitriao, BASE(m)[0]!)).data).toMatchObject({ ok: true });
      const sessao = await servidor.entrar("marlon");
      const ctx = await turnoDe(m.d, m.gil.agenteId, m.gil.conversaId);
      const faixa = `de 1 a ${LIMITES_QUADRO.prazoMin}`;
      const antes = await estado(m, m.tela.agenteId);
      for (const prazo_min of [0, -5, LIMITES_QUADRO.prazoMin + 1]) {
        for (const [metodo, url, corpo] of [
          ["PATCH", `/agentes/${m.tela.agenteId}/quadro/colunas/revisao`, { prazo_min }],
          ["POST", `/agentes/${m.tela.agenteId}/quadro/colunas`, { nome: "Teste", grupo: "iniciado", prazo_min }],
        ] as const) {
          const resp = await servidor.chamar(sessao, metodo, url, corpo);
          const txt = await resp.text();
          // A mensagem do HTTP é da tabela fixa (ADR-002); a frase da faixa na tela é da web (fraseDoErroDeColuna).
          expect(resp.status, txt).toBe(400);
        }
        const r = await executar(m.d, gerirQuadro, { ...ctx, quadro: m.nomeChat, acoes: [{ tipo: "renomear_coluna", coluna: "Em revisão", prazo_min }] });
        expect(r.data).toMatchObject({ ok: false });
        // O bot lê a faixa em minutos (o que ele passa) e em palavras (o que ele diz à pessoa).
        expect(JSON.stringify(r.data), `chat ${prazo_min}`).toContain(faixa);
        expect(JSON.stringify(r.data), `chat ${prazo_min}`).toContain(FAIXA_DO_PRAZO);
      }
      expect(await estado(m, m.tela.agenteId)).toEqual(antes);
    });
  });

  it("a coluna pela URL com % no nome: o roteador já decodificou, a rota não decodifica de novo (revisão do PR #615)", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const m = await montar(trx);
      expect((await pessoa(m.d, m.tela.agenteId, [{ tipo: "criar_quadro", meta: "M" }, { tipo: "criar_coluna", nome: "100%", grupo: "iniciado" }])).data).toMatchObject({ ok: true });
      const sessao = await servidor.entrar("marlon");
      const resp = await servidor.chamar(sessao, "PATCH", `/agentes/${m.tela.agenteId}/quadro/colunas/${encodeURIComponent("100%")}`, { nome: "Cem" });
      expect(resp.status, await resp.clone().text()).toBe(200);
      expect((await estado(m, m.tela.agenteId))?.colunas.map((c) => (c as string[])[1])).toContain("Cem");
    });
  });

  it("QA do PR #623: mover pelo chat devolve o código novo (como a rota) e grava o mesmo histórico da tela, com o bot de autor", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const m = await montar(trx);
      for (const anfitriao of [m.tela.agenteId, m.chat.agenteId]) expect((await pessoa(m.d, anfitriao, [{ tipo: "criar_quadro", meta: null }, { tipo: "criar_tarefa", titulo: "T0" }, { tipo: "criar_tarefa", titulo: "T1" }])).data).toMatchObject({ ok: true });
      for (const destino of [m.caio.agenteId, m.gil.agenteId]) expect((await pessoa(m.d, destino, [{ tipo: "criar_quadro", meta: null }])).data).toMatchObject({ ok: true });
      const q = async (agenteId: string) => (await m.d.repos.quadros.doAgente(agenteId))!;
      const t1 = async (agenteId: string) => (await m.d.repos.quadros.tarefas((await q(agenteId)).id)).find((t) => t.titulo === "T1")!.id;
      const [idTela, idChat] = [await t1(m.tela.agenteId), await t1(m.chat.agenteId)];

      const sessao = await servidor.entrar("marlon");
      const resp = await servidor.chamar(sessao, "POST", `/agentes/${m.tela.agenteId}/quadro/tarefas/${idTela}/mover`, { quadro: m.nomeCaio });
      expect(resp.status, await resp.clone().text()).toBe(200);
      const j = (await resp.json()) as { data?: { movida?: unknown } } & { movida?: unknown };
      const pTela = (await q(m.tela.agenteId)).prefixo!;
      const pCaio = (await q(m.caio.agenteId)).prefixo!;
      expect((j.data ?? j).movida).toEqual({ tarefaId: idTela, codigo: `${pCaio}-1`, codigoAntigo: `${pTela}-2` });

      const ctx = await turnoDe(m.d, m.gil.agenteId, m.gil.conversaId);
      const r = await executar(m.d, gerirQuadro, { ...ctx, quadro: m.nomeChat, acoes: [{ tipo: "mover_quadro", tarefa: "T1", quadro: m.nomeGil }] });
      const pChat = (await q(m.chat.agenteId)).prefixo!;
      const pGil = (await q(m.gil.agenteId)).prefixo!;
      // O mesmo código que a rota devolve, estruturado (não só na frase), e o resumo do destino já com ele.
      expect(r.data).toMatchObject({ ok: true, movida: { tarefa_id: idChat, codigo: `${pGil}-1`, codigo_antigo: `${pChat}-2` } });
      expect(r.data.ok && r.data.instrucao).toContain(`A tarefa agora é ${pGil}-1`);
      expect(r.data.ok && r.data.quadro?.tarefas.find((t) => t.id === idChat)?.codigo).toBe(`${pGil}-1`);

      // O histórico: as mesmas linhas, na mesma ordem; o autor do mover é quem pediu (a pessoa na tela, o bot no chat).
      const linhas = async (agenteId: string, tarefaId: string, origem: string, destino: string) =>
        (await executar(m.d, historicoDaTarefa, { agenteId, tarefaId })).data.historico.map((h) => [h.campo, h.campo === "quadro" ? [h.de === origem ? "origem" : h.de, h.para === destino ? "destino" : h.para] : [h.de, h.para], h.autor]);
      const daTela = await linhas(m.caio.agenteId, idTela, (await q(m.tela.agenteId)).id, (await q(m.caio.agenteId)).id);
      const doChat = await linhas(m.gil.agenteId, idChat, (await q(m.chat.agenteId)).id, (await q(m.gil.agenteId)).id);
      expect(daTela).toContainEqual(["quadro", ["origem", "destino"], "pessoa"]);
      expect(doChat).toContainEqual(["quadro", ["origem", "destino"], "agente"]);
      expect(doChat.map(([c, dp]) => [c, dp])).toEqual(daTela.map(([c, dp]) => [c, dp]));
    });
  });

  it("revisão 2 do PR #623: a recusa do mover sai com o motivo da lista branca (a tela diz o porquê); a causa crua, nunca", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const m = await montar(trx);
      expect((await pessoa(m.d, m.tela.agenteId, [{ tipo: "criar_quadro", meta: "M" }, { tipo: "criar_tarefa", titulo: "T1" }])).data).toMatchObject({ ok: true });
      expect((await pessoa(m.d, m.caio.agenteId, [{ tipo: "criar_quadro", meta: "N" }])).data).toMatchObject({ ok: true });
      const qTela = (await m.d.repos.quadros.doAgente(m.tela.agenteId))!;
      const t1 = (await m.d.repos.quadros.tarefas(qTela.id)).find((t) => t.titulo === "T1")!.id;
      const sessao = await servidor.entrar("marlon");
      // Para o próprio quadro: 400 com o motivo; a frase é a da tabela (o texto do detalhe não sai).
      const proprio = await servidor.chamar(sessao, "POST", `/agentes/${m.tela.agenteId}/quadro/tarefas/${t1}/mover`, { quadro: qTela.id });
      expect(proprio.status).toBe(400);
      const corpo = (await proprio.json()) as { codigo: string; mensagem: string; motivo?: string };
      expect(corpo).toMatchObject({ codigo: "entrada_invalida", motivo: "ja_neste_quadro" });
      expect(corpo.mensagem).not.toContain("tarefa");
      // Pela rota de outro bot: a tarefa não é do quadro dele.
      const fora = await servidor.chamar(sessao, "POST", `/agentes/${m.caio.agenteId}/quadro/tarefas/${t1}/mover`, { quadro: qTela.id });
      expect(fora.status).toBe(404);
      expect(await fora.json()).toMatchObject({ codigo: "nao_encontrado", motivo: "fora_do_quadro" });
      // A causa fora da lista (o quadro destino com o nome cru) segue sem motivo.
      const semDestino = await servidor.chamar(sessao, "POST", `/agentes/${m.tela.agenteId}/quadro/tarefas/${t1}/mover`, { quadro: "Ninguém <b>" });
      expect(semDestino.status).toBe(404);
      const sd = (await semDestino.json()) as { motivo?: string; mensagem: string };
      expect(sd.motivo).toBeUndefined();
      expect(sd.mensagem).not.toContain("Ninguém");
    });
  });

  it("rotas: GET devolve null e depois o quadro; corpo inválido é 400; experimento desligado é 403", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const m = await montar(trx);
      const sessao = await servidor.entrar("marlon");
      const base = `/agentes/${m.tela.agenteId}/quadro`;
      expect(await (await servidor.chamar(sessao, "GET", base)).json()).toEqual({ quadro: null });
      // A meta é opcional (NOD-415): vazia cria no fluxo contínuo; tipo errado ou longa demais é 400.
      expect((await servidor.chamar(sessao, "POST", base, { meta: 3 })).status).toBe(400);
      expect((await servidor.chamar(sessao, "POST", base, { meta: "x".repeat(201) })).status).toBe(400);
      expect((await servidor.chamar(sessao, "POST", `${base}/tarefas`, { titulo: "x".repeat(201) })).status).toBe(400);
      expect((await servidor.chamar(sessao, "POST", base, { meta: "M" })).status).toBe(201);
      expect((await servidor.chamar(sessao, "PATCH", `${base}/tarefas/00000000-0000-4000-8000-000000000000`, { status: "feito" })).status).toBe(404);
      const corpo = (await (await servidor.chamar(sessao, "GET", base)).json()) as { quadro: QuadroDto };
      expect(corpo.quadro.meta).toBe("M");
      // Tirar a meta pela tela (PATCH meta null) volta ao fluxo contínuo.
      expect((await servidor.chamar(sessao, "PATCH", base, { meta: null })).status).toBe(200);
      expect(((await (await servidor.chamar(sessao, "GET", base)).json()) as { quadro: QuadroDto }).quadro.meta).toBeNull();
      await m.d.repos.preferencias.gravar({ experimentos: { quadro: false } });
      expect((await servidor.chamar(sessao, "GET", base)).status).toBe(403);
      expect((await servidor.chamar(sessao, "PATCH", base, { meta: "N" })).status).toBe(403);
    });
  });

  it("o corpo não escolhe o quadro nem o executor: anfitriaoId e executor do corpo são ignorados (revisão do PR #612)", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const m = await montar(trx);
      const sessao = await servidor.entrar("marlon");
      for (const a of [m.tela.agenteId, m.chat.agenteId]) expect((await pessoa(m.d, a, [{ tipo: "criar_quadro", meta: a === m.tela.agenteId ? "Tela" : "Chat" }])).data).toMatchObject({ ok: true });
      const r = await servidor.chamar(sessao, "POST", `/agentes/${m.tela.agenteId}/quadro/tarefas`, { titulo: "T", status: "afazer", agente: m.nomeCaio, anfitriaoId: m.chat.agenteId, executor: "claude-cli" });
      expect(r.status, await r.clone().text()).toBe(201);
      const tarefasDe = async (a: string) => (await m.d.repos.quadros.tarefas((await m.d.repos.quadros.doAgente(a))!.id)).map((t) => t.titulo);
      expect(await tarefasDe(m.tela.agenteId)).toEqual(["T"]);
      expect(await tarefasDe(m.chat.agenteId)).toEqual([]);
      const [t] = await m.d.repos.quadros.tarefas((await m.d.repos.quadros.doAgente(m.tela.agenteId))!.id);
      expect((await m.d.repos.turnos.buscar(t!.turnoId!))?.executor).toBe("catcher");
    });
  });

  it("responder pelo chat só num turno em que a pessoa falou; num turno de tarefa (delegação) o bot é recusado", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const m = await montar(trx);
      for (const ops of [[{ tipo: "criar_quadro", meta: "M" }, { tipo: "criar_tarefa", titulo: "T2", status: "voce", agente: m.nomeCaio }, { tipo: "mudar_tarefa", tarefa: "T2", pergunta: "Qual cor?" }]] as OpQuadro[][]) {
        expect((await pessoa(m.d, m.tela.agenteId, ops)).data).toMatchObject({ ok: true });
      }
      const delegacao = await m.d.repos.turnos.enfileirar({ executor: "catcher", conversaId: m.caio.conversaId, agenteId: m.caio.agenteId, origem: "delegacao", prazoEm: Date.now() + 600_000, profundidade: 1, entradaTexto: "tarefa", entradaConfianca: "nao_confiavel", modelo: "auto" });
      const r = await executar(m.d, gerirQuadro, { turnoId: delegacao!.id, agenteId: m.caio.agenteId, conversaId: m.caio.conversaId, quadro: m.tela.agenteId, acoes: [{ tipo: "responder", tarefa: "T2", resposta: "Azul" }] });
      expect(r.data).toMatchObject({ ok: false, erro: "entrada_invalida" });
      expect(JSON.stringify(r.data)).toContain("resposta da pessoa");
      // Uma delegação limpa (confiável, nada de fora) também não responde: quem responde é a pessoa, na conversa (QA, mutante M12).
      const limpa = await m.d.repos.turnos.enfileirar({ executor: "catcher", conversaId: m.caio.conversaId, agenteId: m.caio.agenteId, origem: "delegacao", prazoEm: Date.now() + 600_000, profundidade: 1, entradaTexto: "tarefa", entradaConfianca: "confiavel", sobProcuracaoDe: MARLON.pessoaId, modelo: "auto" });
      const r2 = await executar(m.d, gerirQuadro, { turnoId: limpa!.id, agenteId: m.caio.agenteId, conversaId: m.caio.conversaId, quadro: m.tela.agenteId, acoes: [{ tipo: "responder", tarefa: "T2", resposta: "Azul" }] });
      expect(r2.data).toMatchObject({ ok: false, erro: "entrada_invalida" });
      expect(JSON.stringify(r2.data)).toContain("resposta da pessoa");
      const [t] = await m.d.repos.quadros.tarefas((await m.d.repos.quadros.doAgente(m.tela.agenteId))!.id);
      expect(t).toMatchObject({ status: "voce", resposta: null });
    });
  });
  it("corrente que atravessou dono: o gerir_quadro recusa na profundidade > 0, sob a procuração de outra pessoa (ADR-063, revisão do PR #612)", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const m = await montar(trx);
      const acoes: OpQuadro[] = [{ tipo: "criar_quadro", meta: "M" }, { tipo: "criar_tarefa", titulo: "T", agente: m.nomeCaio }];
      const deOutra = await m.d.repos.turnos.enfileirar({ executor: "catcher", conversaId: m.gil.conversaId, agenteId: m.gil.agenteId, origem: "delegacao", prazoEm: Date.now() + 600_000, profundidade: 1, entradaTexto: "x", entradaConfianca: "confiavel", sobProcuracaoDe: PESSOA_ANA, modelo: "auto" });
      const r = await executar(m.d, gerirQuadro, { turnoId: deOutra!.id, agenteId: m.gil.agenteId, conversaId: m.gil.conversaId, quadro: m.tela.agenteId, acoes });
      expect(r.data).toMatchObject({ ok: false, erro: "entrada_invalida" });
      expect(JSON.stringify(r.data)).toContain("entre donos diferentes");
      expect(await m.d.repos.quadros.doAgente(m.tela.agenteId)).toBeNull();
      // Do mesmo dono, um salto adiante, vale — no limite normal (NOD-430): sozinho, só cria no Backlog, sem atribuir.
      expect((await pessoa(m.d, m.tela.agenteId, [{ tipo: "criar_quadro", meta: "M" }])).data).toMatchObject({ ok: true });
      const doDono = await m.d.repos.turnos.enfileirar({ executor: "catcher", conversaId: m.gil.conversaId, agenteId: m.gil.agenteId, origem: "delegacao", prazoEm: Date.now() + 600_000, profundidade: 1, entradaTexto: "x", entradaConfianca: "confiavel", sobProcuracaoDe: MARLON.pessoaId, modelo: "auto" });
      const ok = await executar(m.d, gerirQuadro, { turnoId: doDono!.id, agenteId: m.gil.agenteId, conversaId: m.gil.conversaId, quadro: m.tela.agenteId, acoes: [{ tipo: "criar_tarefa", titulo: "T" }] });
      expect(ok.data).toMatchObject({ ok: true });
    });
  });

  it("a confiança do turno da tarefa vem de quem fez o lote; o Linear é interno; turno contaminado contamina, e o Com você de fora avisa sem título nem pergunta (ADR-062, revisões dos PRs #612 e #624)", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const m = await montar(trx);
      const tela = await pessoa(m.d, m.tela.agenteId, [{ tipo: "criar_quadro", meta: "M" }, { tipo: "criar_tarefa", titulo: "Da pessoa", status: "afazer", agente: m.nomeCaio }, { tipo: "importar_linear", itens: [{ identificador: "NOD-77", titulo: "Do Linear", agente: m.nomeCaio }] }]);
      if (!tela.data.ok) throw new Error(tela.data.detalhe);
      const turnoDa = async (titulo: string) => (await m.d.repos.quadros.tarefas((await m.d.repos.quadros.doAgente(m.tela.agenteId))!.id)).find((t) => t.titulo === titulo)!.turnoId!;
      const daPessoa = await turnoDa("Da pessoa");
      const doLinear = await turnoDa("Do Linear");
      expect((await m.d.repos.turnos.buscar(daPessoa))?.entradaConfianca).toBe("confiavel");
      expect(await m.d.repos.turnos.contaminado(daPessoa)).toBe(false);
      expect(await m.d.repos.turnos.contaminado(doLinear)).toBe(false);
      // Um bot num turno contaminado: o turno que ele começa nasce contaminado também.
      const ctx = await turnoDe(m.d, m.gil.agenteId, m.gil.conversaId);
      await m.d.repos.turnos.contaminar(ctx.turnoId, Date.now());
      // NOD-430 × NOD-417: contaminado = limite normal (não atribui a outro) e não pega tarefa para si (ERRO_SE_TOMA).
      // Ele só escreve no Backlog; quando a pessoa passa a tarefa a ele, o turno que começa nasce contaminado.
      const tomar = await executar(m.d, gerirQuadro, { ...ctx, quadro: m.tela.agenteId, acoes: [{ tipo: "criar_tarefa", titulo: "Do bot", agente: m.nomeGil }] });
      expect(JSON.stringify(tomar.data)).toContain("você só pega uma tarefa que não é sua num turno limpo");
      const r = await executar(m.d, gerirQuadro, { ...ctx, quadro: m.tela.agenteId, acoes: [{ tipo: "criar_tarefa", titulo: "Do bot" }] });
      if (!r.data.ok) throw new Error(JSON.stringify(r.data));
      // Revisão 4 do PR #622 (achado 2): o bot de fora que cria a tarefa não aciona ninguém; quando a pessoa a passa e a
      // começa, o turno nasce contaminado.
      expect(r.data).toMatchObject({ comecaram: [] });
      expect((await m.d.repos.quadros.tarefas((await m.d.repos.quadros.doAgente(m.tela.agenteId))!.id)).find((t) => t.titulo === "Do bot")).toMatchObject({ agenteId: null, turnoId: null, deFora: true });
      expect((await pessoa(m.d, m.tela.agenteId, [{ tipo: "mudar_tarefa", tarefa: "Do bot", agente: m.nomeGil, status: "afazer" }])).data).toMatchObject({ ok: true });
      expect(await m.d.repos.turnos.contaminado(await turnoDa("Do bot"))).toBe(true);
      // A tarefa que o bot contaminado escreveu em Backlog continua de fora quando a pessoa a começa depois (codex, rodada 3).
      const sujo = await executar(m.d, gerirQuadro, { ...ctx, quadro: m.tela.agenteId, acoes: [{ tipo: "criar_tarefa", titulo: "Guardada", status: "backlog" }] });
      expect(sujo.data).toMatchObject({ ok: true });
      expect((await pessoa(m.d, m.tela.agenteId, [{ tipo: "mudar_tarefa", tarefa: "Guardada", agente: m.nomeCaio, status: "afazer" }])).data).toMatchObject({ ok: true });
      expect(await m.d.repos.turnos.contaminado(await turnoDa("Guardada"))).toBe(true);
      // Quem lê o quadro com tarefa de fora num turno limpo fica contaminado: o título dela entrou no resultado (revisão rodada 5).
      const leitor = await turnoDe(m.d, m.caio.agenteId, m.caio.conversaId);
      expect((await executar(m.d, gerirQuadro, { ...leitor, quadro: m.tela.agenteId, acoes: [{ tipo: "editar_quadro", prazo: "2026-11-30" }] })).data).toMatchObject({ ok: true });
      expect(await m.d.repos.turnos.contaminado(leitor.turnoId)).toBe(true);
      // O turno contaminado não escreve a meta.
      const meta = await executar(m.d, gerirQuadro, { ...ctx, quadro: m.tela.agenteId, acoes: [{ tipo: "editar_quadro", meta: "Outra" }] });
      expect(JSON.stringify(meta.data)).toContain("a meta só muda num turno limpo");
      // Nem cria um quadro novo com a meta dele (codex rodada 4, P1): o planejamento prévio da criação vê a confiança.
      const novo = await executar(m.d, gerirQuadro, { ...ctx, acoes: [{ tipo: "criar_quadro", meta: "Meta de fora" }] });
      expect(JSON.stringify(novo.data)).toContain("a meta só muda num turno limpo");
      expect(await m.d.repos.quadros.doAgente(m.gil.agenteId)).toBeNull();
      // O Com você do turno contaminado (tarefa deFora) avisa depois da janela, sem o título nem a pergunta dele: o caminho
      // real até o varredor (revisão do PR #624, achado 1; antes o teste olhava dentro da janela e passava sempre).
      // NOD-430: o "Do bot" é do Gil (a pessoa o passou a ele): o aviso vai à conversa dele.
      const avisos = async () => (await m.d.repos.mensagens.listarDaConversa(m.gil.conversaId)).filter((x) => x.payload?.kind === "aviso_pessoa");
      const antes = (await avisos()).length;
      expect((await executar(m.d, gerirQuadro, { ...ctx, quadro: m.tela.agenteId, acoes: [{ tipo: "mudar_tarefa", tarefa: "Do bot", status: "voce", pergunta: "Entre em https://x" }] })).data).toMatchObject({ ok: true });
      expect(await avisos()).toHaveLength(antes);
      await varrerAvisosDosQuadros({ ...m.d, agora: () => Date.now() + JANELA_AGRUPAR_MS + 1000 });
      const depois = await avisos();
      expect(depois).toHaveLength(antes + 1);
      const aviso = depois.at(-1)!;
      expect(aviso).toMatchObject({ confianca: "confiavel" });
      expect(aviso.texto).toContain("a pergunta está no quadro");
      expect(aviso.texto).not.toContain("https://x");
      expect(aviso.texto).not.toContain("Do bot");
      // Na conversa do responsável, não na do anfitrião: o aviso diz de qual quadro é (achado 3).
      expect(aviso.texto).toContain(`no quadro de Tela `);
      // E responder, num turno de conversa contaminado (leu uma página), é recusado (revisão rodada 3, alto 1).
      const resp = await executar(m.d, gerirQuadro, { ...ctx, quadro: m.tela.agenteId, acoes: [{ tipo: "responder", tarefa: "Do bot", resposta: "pode" }] });
      expect(JSON.stringify(resp.data)).toContain("resposta da pessoa");
      // Turno que mandaram parar não escreve mais.
      const parado = await turnoDe(m.d, m.gil.agenteId, m.gil.conversaId);
      await trx`update turnos set parar_solicitado_em = now() where id = ${parado.turnoId}`;
      const r2 = await executar(m.d, gerirQuadro, { ...parado, quadro: m.tela.agenteId, acoes: [{ tipo: "mudar_tarefa", tarefa: "Da pessoa", status: "feito" }] });
      expect(JSON.stringify(r2.data)).toContain("este turno foi parado");
      // E de novo com a trava na mão (codex rodada 4): o turno parado enquanto esperava a trava também não escreve.
      const r3 = await executar(m.d, aplicarLoteQuadro, { autor: { tipo: "agente", agenteId: m.gil.agenteId }, quadro: m.tela.agenteId, executor: "catcher", turnoId: parado.turnoId, ops: [{ tipo: "mudar_tarefa", tarefa: "Da pessoa", status: "feito" }] });
      expect(JSON.stringify(r3.data)).toContain("este turno foi parado");
    });
  });

  it("revisão do PR #630: o código que acha a nativa e a importada pede a escolha na tela (link) e no chat (mover), com as mesmas duas", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const m = await montar(trx);
      expect((await pessoa(m.d, m.tela.agenteId, [{ tipo: "criar_quadro", meta: "M" }, { tipo: "criar_tarefa", titulo: "Nativa" }])).data).toMatchObject({ ok: true });
      const qTela = (await m.d.repos.quadros.doAgente(m.tela.agenteId))!;
      const codigo = `${qTela.prefixo}-1`;
      expect((await pessoa(m.d, m.caio.agenteId, [{ tipo: "criar_quadro", meta: "N" }, { tipo: "importar_linear", itens: [{ identificador: codigo, titulo: "Importada" }] }])).data).toMatchObject({ ok: true });
      const ids = [
        (await m.d.repos.quadros.tarefas(qTela.id))[0]!.id,
        (await m.d.repos.quadros.tarefas((await m.d.repos.quadros.doAgente(m.caio.agenteId))!.id))[0]!.id,
      ].sort();
      const sessao = await servidor.entrar("marlon");
      const tela = await servidor.chamar(sessao, "GET", `/quadro/tarefas/${codigo}`);
      expect(tela.status).toBe(200);
      const corpo = (await tela.json()) as { ambigua?: { tarefaId: string }[] };
      expect(corpo.ambigua?.map((o) => o.tarefaId).sort()).toEqual(ids);
      const chat = (await executar(m.d, gerirQuadro, { ...(await turnoDe(m.d, m.gil.agenteId, m.gil.conversaId)), quadro: m.caio.agenteId, acoes: [{ tipo: "mover_quadro", tarefa: codigo, quadro: m.tela.agenteId }] })).data;
      expect(JSON.stringify(chat)).toContain("entrada_invalida");
      for (const id of ids) expect(JSON.stringify(chat)).toContain(id);
      // Nada mudou de quadro.
      expect((await m.d.repos.quadros.tarefas(qTela.id)).map((t) => t.titulo)).toEqual(["Nativa"]);
    });
  });

  it("Desfazer de bot e o quadro padrão do turno de uma tarefa (revisão rodada 4)", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const m = await montar(trx);
      expect((await pessoa(m.d, m.tela.agenteId, [{ tipo: "criar_quadro", meta: "M" }, { tipo: "criar_tarefa", titulo: "Seção", status: "afazer", agente: m.nomeCaio }])).data).toMatchObject({ ok: true });
      // O Caio também tem um quadro dele, com uma tarefa de mesmo título.
      expect((await pessoa(m.d, m.caio.agenteId, [{ tipo: "criar_quadro", meta: "Do Caio" }, { tipo: "criar_tarefa", titulo: "Seção" }])).data).toMatchObject({ ok: true });
      const qTela = (await m.d.repos.quadros.doAgente(m.tela.agenteId))!;
      const daTarefa = (await m.d.repos.quadros.tarefas(qTela.id)).find((t) => t.titulo === "Seção")!;
      // No turno da tarefa, sem dizer o quadro, o Caio mexe no quadro da tarefa (não no dele).
      const ctxTarefa = { turnoId: daTarefa.turnoId!, agenteId: m.caio.agenteId, conversaId: m.caio.conversaId };
      expect((await executar(m.d, gerirQuadro, { ...ctxTarefa, acoes: [{ tipo: "mudar_tarefa", tarefa: "Seção", pr_url: "https://github.com/gamefik/nod/pull/9" }] })).data).toMatchObject({ ok: true });
      expect((await m.d.repos.quadros.tarefas(qTela.id)).find((t) => t.id === daTarefa.id)?.status).toBe("revisao");
      // O último lote agora é do Caio; a pessoa faz outro por cima: o Caio, no turno da tarefa, não desfaz o da pessoa.
      expect((await pessoa(m.d, m.tela.agenteId, [{ tipo: "criar_tarefa", titulo: "Da pessoa" }])).data).toMatchObject({ ok: true });
      const alheio = await executar(m.d, gerirQuadro, { ...ctxTarefa, acoes: [{ tipo: "desfazer" }] });
      expect(JSON.stringify(alheio.data)).toContain("o último lote não é seu");
      // A pedido da pessoa, na conversa limpa, desfaz; num turno contaminado, nunca.
      const conversa = await turnoDe(m.d, m.caio.agenteId, m.caio.conversaId);
      await m.d.repos.turnos.contaminar(conversa.turnoId, Date.now());
      expect(JSON.stringify((await executar(m.d, gerirQuadro, { ...conversa, quadro: m.tela.agenteId, acoes: [{ tipo: "desfazer" }] })).data)).toContain("desfazer só num turno limpo");
      const limpa = await turnoDe(m.d, m.caio.agenteId, m.caio.conversaId);
      expect((await executar(m.d, gerirQuadro, { ...limpa, quadro: m.tela.agenteId, acoes: [{ tipo: "desfazer" }] })).data).toMatchObject({ ok: true });
      expect((await m.d.repos.quadros.tarefas(qTela.id)).some((t) => t.titulo === "Da pessoa")).toBe(false);
      // Responsável oculto: a tarefa que entra em A fazer não fica em Fazendo sem ninguém (revisão rodada 5).
      expect((await pessoa(m.d, m.tela.agenteId, [{ tipo: "criar_tarefa", titulo: "Do oculto", status: "backlog", agente: m.nomeCaio }])).data).toMatchObject({ ok: true });
      await trx`update agentes set oculto = true where id = ${m.caio.agenteId}`;
      expect((await pessoa(m.d, m.tela.agenteId, [{ tipo: "mudar_tarefa", tarefa: "Do oculto", status: "afazer" }])).data).toMatchObject({ ok: true });
      expect((await m.d.repos.quadros.tarefas(qTela.id)).find((t) => t.titulo === "Do oculto")).toMatchObject({ status: "afazer", turnoId: null });
    });
  });
  it("NOD-418, revisão do PR #625: repetir, cancelar e recado só a pedido da pessoa, na conversa limpa", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await pessoa(m.d, m.tela.agenteId, [{ tipo: "criar_quadro" }, { tipo: "criar_tarefa", titulo: "T1", status: "afazer", agente: m.nomeCaio }]);
      const q = (await m.d.repos.quadros.doAgente(m.tela.agenteId))!;
      const tarefa = async () => (await m.d.repos.quadros.tarefas(q.id)).find((t) => t.titulo === "T1")!;
      const antes = await tarefa();
      const execsAntes = (await m.d.repos.quadroExecucoes.daTarefa(antes.id)).length;
      const turnoCom = async (origem: "conversa" | "rotina" | "delegacao" | "peer", profundidade: 0 | 1) => {
        const t = await m.d.repos.turnos.enfileirar({ executor: "catcher", conversaId: m.gil.conversaId, agenteId: m.gil.agenteId, origem, prazoEm: Date.now() + 600_000, profundidade, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "auto" });
        return { turnoId: t!.id, agenteId: m.gil.agenteId, conversaId: m.gil.conversaId };
      };
      const contaminado = await turnoCom("conversa", 0);
      await m.d.repos.turnos.contaminar(contaminado.turnoId, Date.now());
      const casos = [
        ["contaminado", contaminado],
        ["rotina", await turnoCom("rotina", 0)],
        ["tarefa", await turnoCom("delegacao", 1)],
        ["colega", await turnoCom("peer", 1)],
      ] as const;
      const acoes: OpQuadro[] = [{ tipo: "repetir_trabalho", tarefa: "T1" }, { tipo: "cancelar_trabalho", tarefa: "T1" }, { tipo: "recado", tarefa: "T1", texto: "faça outra coisa" }];
      for (const [nome, ctx] of casos) {
        for (const a of acoes) {
          const r = await executar(m.d, gerirQuadro, { ...ctx, quadro: m.tela.agenteId, acoes: [a] });
          expect(r.data, `${nome} / ${a.tipo}`).toMatchObject({ ok: false, erro: "entrada_invalida" });
          expect(JSON.stringify(r.data), `${nome} / ${a.tipo}`).toContain("é pedido da pessoa");
        }
      }
      // Nada mudou: nem trabalho novo, nem cancelado, nem recado.
      const execs = await m.d.repos.quadroExecucoes.daTarefa(antes.id);
      expect(execs).toHaveLength(execsAntes);
      expect(execs.every((e) => e.canceladaEm === null)).toBe(true);
      expect(await m.d.repos.quadroExecucoes.recadosDaTela(antes.id)).toEqual([]);
      expect((await m.d.repos.turnos.buscar(antes.turnoId!))?.pararSolicitadoEm).toBeNull();
      // A conversa limpa passa (o controle do teste).
      const limpa = await turnoCom("conversa", 0);
      expect((await executar(m.d, gerirQuadro, { ...limpa, quadro: m.tela.agenteId, acoes: [{ tipo: "cancelar_trabalho", tarefa: "T1" }] })).data).toMatchObject({ ok: true });
    });
  });

  it("NOD-418, revisão 2 do PR #625: sem trabalho vivo, Repetir e recado fora do andamento (Feito, Cancelado, Backlog) não abrem trabalho", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const m = await montar(trx);
      await pessoa(m.d, m.tela.agenteId, [
        { tipo: "criar_quadro" },
        { tipo: "criar_tarefa", titulo: "No feito", status: "feito", agente: m.nomeCaio },
        { tipo: "criar_tarefa", titulo: "No cancelado", status: "cancelado", agente: m.nomeCaio },
        { tipo: "criar_tarefa", titulo: "No backlog", status: "backlog", agente: m.nomeCaio },
      ]);
      const q = (await m.d.repos.quadros.doAgente(m.tela.agenteId))!;
      const tarefas = await m.d.repos.quadros.tarefas(q.id);
      const sessao = await servidor.entrar("marlon");
      const limpa = await turnoDe(m.d, m.gil.agenteId, m.gil.conversaId);
      for (const titulo of ["No feito", "No cancelado", "No backlog"]) {
        const t = tarefas.find((x) => x.titulo === titulo)!;
        const base = `/agentes/${m.tela.agenteId}/quadro/tarefas/${t.id}/trabalhos`;
        for (const [rota, corpo] of [["repetir", undefined], ["recado", { texto: "faça outra coisa" }]] as const) {
          const resp = await servidor.chamar(sessao, "POST", `${base}/${rota}`, corpo);
          expect(resp.status, `${titulo} / tela ${rota}`).toBe(409);
        }
        for (const a of [{ tipo: "repetir_trabalho", tarefa: titulo }, { tipo: "recado", tarefa: titulo, texto: "faça outra coisa" }] as OpQuadro[]) {
          const r = await executar(m.d, gerirQuadro, { ...limpa, quadro: m.tela.agenteId, acoes: [a] });
          expect(r.data, `${titulo} / chat ${a.tipo}`).toMatchObject({ ok: false, erro: "estado_invalido" });
          expect(JSON.stringify(r.data), `${titulo} / chat ${a.tipo}`).toContain("a tarefa não está em andamento: mova-a antes");
        }
        expect(await m.d.repos.quadroExecucoes.daTarefa(t.id), titulo).toEqual([]);
        expect(await m.d.repos.quadroExecucoes.recadosDaTela(t.id), titulo).toEqual([]);
        expect((await m.d.repos.quadros.tarefa(t.id))?.status, titulo).toBe(t.status);
      }
    });
  });

  it("revisão 5 do PR #625: gerir_quadro com acoes [] só consulta, e o trabalho bate com o da tela", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const m = await montar(trx);
      await pessoa(m.d, m.tela.agenteId, [{ tipo: "criar_quadro", meta: "Lançar login" }, { tipo: "criar_tarefa", titulo: "T1", status: "afazer", agente: m.nomeCaio }, { tipo: "criar_tarefa", titulo: "T2" }]);
      const antes = await estado(m, m.tela.agenteId);
      const r = await executar(m.d, gerirQuadro, { ...(await turnoDe(m.d, m.gil.agenteId, m.gil.conversaId)), quadro: m.tela.agenteId, acoes: [] });
      expect(r.data).toMatchObject({ ok: true, lote_id: null, comecaram: [], instrucao: "Só leitura: nada mudou." });
      expect(await estado(m, m.tela.agenteId)).toEqual(antes);
      const resumo = (r.data as { quadro: { meta: string; tarefas: { id: string; titulo: string; status: string; trabalho?: { numero: number; estado: string; novaTentativaEm: string | null } }[] } }).quadro;
      expect(resumo.meta).toBe("Lançar login");
      // O mesmo trabalho que a tela mostra (GET dos trabalhos da tarefa): número, estado e nova tentativa.
      const sessao = await servidor.entrar("marlon");
      for (const t of resumo.tarefas) {
        const tela = (await (await servidor.chamar(sessao, "GET", `/agentes/${m.tela.agenteId}/quadro/tarefas/${t.id}/trabalhos`)).json()) as { execucoes: { numero: number; estado: string; novaTentativaEm: number | null; origem: string }[] };
        const atual = tela.execucoes.filter((e) => e.origem !== "comentario").at(-1);
        expect(t.trabalho ? [t.trabalho.numero, t.trabalho.estado, t.trabalho.novaTentativaEm] : null, t.titulo).toEqual(atual ? [atual.numero, atual.estado, atual.novaTentativaEm === null ? null : new Date(atual.novaTentativaEm).toISOString()] : null);
      }
      expect(resumo.tarefas.find((t) => t.titulo === "T1")?.trabalho).toMatchObject({ numero: 1 });
      const consultas = await trx<{ dados: Record<string, unknown> }[]>`select dados from events where kind = 'quadro_consultado'`;
      expect(consultas.map((e) => e.dados)).toEqual([{ quadro_id: (await m.d.repos.quadros.doAgente(m.tela.agenteId))!.id, agente_id: m.gil.agenteId }]);

      // NOD-474: chamada com ação e consulta recusada não contam como consulta de estado.
      expect((await executar(m.d, gerirQuadro, { ...(await turnoDe(m.d, m.gil.agenteId, m.gil.conversaId)), quadro: m.tela.agenteId, acoes: [{ tipo: "criar_tarefa", titulo: "T3" }] })).data).toMatchObject({ ok: true });
      expect((await executar(m.d, gerirQuadro, { ...(await turnoDe(m.d, m.gil.agenteId, m.gil.conversaId)), quadro: "não existe", acoes: [] })).data).toMatchObject({ ok: false });
      expect(await trx`select 1 from events where kind = 'quadro_consultado'`).toHaveLength(1);
    });
  });
  it("ADA-18: preferencias.exibir_quadro pela tela (PUT) e pelo chat (gerir_quadro exibir) deixam o mesmo Exibir; inválido e fora da conversa recusam", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const m = await montar(trx);
      await pessoa(m.d, m.tela.agenteId, [{ tipo: "criar_quadro" }]);
      await pessoa(m.d, m.chat.agenteId, [{ tipo: "criar_quadro" }]);
      const qTela = (await m.d.repos.quadros.doAgente(m.tela.agenteId))!.id;
      const qChat = (await m.d.repos.quadros.doAgente(m.chat.agenteId))!.id;
      const exibir = async (id: string) => (await m.d.repos.preferencias.buscar()).quadroExibir?.[id];
      const sessao = await servidor.entrar("marlon");
      const passos: { visao?: "lista" | "colunas" | "minhas"; recolhidas?: boolean; compacto?: boolean }[] = [{ visao: "colunas" }, { recolhidas: false }, { visao: "minhas", compacto: true }];
      for (const corpo of passos) {
        const resp = await servidor.chamar(sessao, "PUT", `/preferencias/quadros/${qTela}/exibir`, corpo);
        expect(resp.status, JSON.stringify(corpo)).toBe(200);
        const r = await executar(m.d, gerirQuadro, { ...(await turnoDe(m.d, m.gil.agenteId, m.gil.conversaId)), quadro: m.nomeChat, acoes: [{ tipo: "exibir", ...corpo }] });
        expect(r.data, JSON.stringify(corpo)).toMatchObject({ ok: true, lote_id: null });
        expect(await exibir(qChat), JSON.stringify(corpo)).toEqual(await exibir(qTela));
      }
      expect(await exibir(qChat)).toEqual({ recolhidas: false, compacto: true, visao: "minhas" });
      // Visão inválida: 400 na tela e entrada_invalida no chat, sem mudar nada.
      expect((await servidor.chamar(sessao, "PUT", `/preferencias/quadros/${qTela}/exibir`, { visao: "grade" })).status).toBe(400);
      const ruim = await executar(m.d, gerirQuadro, { ...(await turnoDe(m.d, m.gil.agenteId, m.gil.conversaId)), quadro: m.nomeChat, acoes: [{ tipo: "exibir", visao: "grade" } as unknown as OpQuadro] });
      expect(ruim.data).toMatchObject({ ok: false, erro: "entrada_invalida" });
      // Sozinho na chamada e só a pedido da pessoa, na conversa (não numa rotina ou tarefa).
      const junto = await executar(m.d, gerirQuadro, { ...(await turnoDe(m.d, m.gil.agenteId, m.gil.conversaId)), quadro: m.nomeChat, acoes: [{ tipo: "exibir", visao: "lista" }, { tipo: "criar_tarefa", titulo: "X" }] });
      expect(JSON.stringify(junto.data)).toContain("exibir vai sozinho na chamada");
      const rotina = await m.d.repos.turnos.enfileirar({ executor: "catcher", conversaId: m.gil.conversaId, agenteId: m.gil.agenteId, origem: "rotina", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "auto" });
      const fora = await executar(m.d, gerirQuadro, { turnoId: rotina!.id, agenteId: m.gil.agenteId, conversaId: m.gil.conversaId, quadro: m.nomeChat, acoes: [{ tipo: "exibir", visao: "lista" }] });
      expect(fora.data).toMatchObject({ ok: false, erro: "entrada_invalida" });
      expect(await exibir(qChat)).toEqual({ recolhidas: false, compacto: true, visao: "minhas" });
      // QA do PR #700: com o quadro desligado nos experimentos, o chat também não mexe no Exibir.
      await m.d.repos.preferencias.gravar({ experimentos: { quadro: false } });
      const desligado = await executar(m.d, gerirQuadro, { ...(await turnoDe(m.d, m.gil.agenteId, m.gil.conversaId)), quadro: m.nomeChat, acoes: [{ tipo: "exibir", visao: "lista" }] });
      expect(desligado.data).toMatchObject({ ok: false, erro: "experimento_desligado" });
      expect(await exibir(qChat)).toEqual({ recolhidas: false, compacto: true, visao: "minhas" });
    });
  });
});
