import { tarefaCasaLigada } from "../shared/tarefa-casa.ts";
import type { AutorLote, CampoHistorico, ColunaQuadro, IdColuna, LinhaDeSistema, LoteQuadro, ModoConversa, MudancaTarefa, PrDaTarefa, Quadro, QuemFecha, TarefaQuadro, TipoLinhaTarefa } from "../contracts/quadro.ts";
import type { MovimentoTarefa, NovoMovimento } from "../contracts/freios-quadro.ts";
import type { CorLabel, LabelQuadro } from "../contracts/quadro-labels.ts";
import type { EstadoTurno } from "../contracts/turno.ts";
import type { Trabalho } from "../contracts/trabalho.ts";
import type { MarcasAviso } from "../domain/avisos-quadro.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import type { Prioridade } from "../contracts/quadro-opcoes.ts";
import { jsonb, ms, msOuNull } from "./conversao.ts";

/** ADA-16 (ADR-163): o trabalho de uma tarefa na fila, para o motivo do card (mesma tarefa em série ou o portão). */
export type FilaDaTarefa = { emSerie: boolean; trabalho: Pick<Trabalho, "estado" | "origem" | "iniciadoEm" | "criadoEm" | "pessoaEsperando"> };

interface LinhaQuadro {
  id: string;
  agente_id: string;
  meta: string | null;
  prazo: string | null;
  cumprido_em: Date | null;
  resumo: string | null;
  colunas: ColunaQuadro[] | null;
  criado_em: Date;
  atualizado_em: Date;
  meta_desde: Date;
  prefixo: string | null;
  modo_conversa: ModoConversa;
  quem_fecha?: QuemFecha;
  nome: string | null;
  projeto_id: string | null;
}

interface LinhaTarefa {
  id: string;
  quadro_id: string;
  titulo: string;
  descricao: string;
  status: IdColuna;
  voltar_para: IdColuna | null;
  agente_id: string | null;
  ordem: number;
  linear_id: string | null;
  linear_url: string | null;
  pr_url: string | null;
  pergunta: string | null;
  resposta: string | null;
  de_fora: boolean;
  turno_id: string | null;
  criado_em: Date;
  mudado_em: Date;
  terminada_em: Date | null;
  numero: number | null;
  pedido_por: string | null;
  resposta_mensagem_id: string | null;
  resposta_conversa_id: string | null;
  resposta_agente_id: string | null;
  prioridade: Prioridade;
  label_ids?: string[];
  prazo_em?: string | null;
}

interface LinhaLote {
  id: string;
  quadro_id: string;
  autor: "pessoa" | "agente";
  autor_agente_id: string | null;
  resumo: string;
  antes: FotoLote;
  tarefa_ids: string[];
  desfeito_em: Date | null;
  criado_em: Date;
  pedido_por: string | null;
  via_nome: string | null;
}

/** A foto do antes de um lote (o Desfazer volta a ela). `antes: null` = nasceu no lote; `quadro: null` = o quadro nasceu no lote. */
export type FotoLote = {
  /** `metaDesde` falta nas fotos de antes da 0136: o Desfazer mantém o valor atual. `colunas` ausente = foto de antes da
   *  NOD-448 (o Desfazer não mexe nas colunas). `prefixo` só na foto da importação do Linear que trocou o prefixo
   *  (NOD-422): o Desfazer o devolve. `nome`/`projetoId` só no lote que os mudou (ADA-14): o Desfazer os devolve. */
  quadro: (Pick<Quadro, "meta" | "prazo" | "cumpridoEm" | "resumo"> & { metaDesde?: number; colunas?: ColunaQuadro[] | null; prefixo?: string | null; nome?: string | null; projetoId?: string | null; /** ADA-28: ausente na foto de antes = mantém. */ quemFecha?: QuemFecha }) | null;
  tarefas: { id: string; antes: TarefaQuadro | null }[];
  /** Revisão 3 do PR #630: os códigos do time que a importação guardou em tarefas que já existiam; o Desfazer os apaga. */
  codigos?: { prefixo: string; numero: number; tarefaId: string }[];
  /** NOD-443: o lote que mexeu nas pessoas ou no modo guarda o de antes (ausente = o lote não mexeu). */
  pessoas?: { membros: string[]; modo: ModoConversa };
};

const CAMPOS_Q = ["id", "agente_id", "to_char(prazo, 'YYYY-MM-DD') as prazo", "meta", "cumprido_em", "resumo", "colunas", "criado_em", "atualizado_em", "meta_desde", "prefixo", "modo_conversa", "nome", "projeto_id", "quem_fecha"];
const COLUNAS_Q = CAMPOS_Q.join(", ");
/** As colunas do quadro com o apelido da tabela (o join com quadro_bots repete id, agente_id, posicao e criado_em). */
const colunasQ = (a: string) => CAMPOS_Q.map((c) => (c.startsWith("to_char(") ? c.replace("to_char(", `to_char(${a}.`) : `${a}.${c}`)).join(", ");
const COLUNAS_T = "id, quadro_id, titulo, descricao, status, voltar_para, agente_id, ordem, linear_id, linear_url, pr_url, pergunta, resposta, de_fora, turno_id, criado_em, mudado_em, terminada_em, numero, pedido_por, resposta_mensagem_id, resposta_conversa_id, resposta_agente_id, prioridade, label_ids, to_char(prazo_em, 'YYYY-MM-DD') as prazo_em";
interface LinhaMovimento {
  id: string;
  tarefa_id: string;
  lote_id: string | null;
  tipo: MovimentoTarefa["tipo"];
  de: IdColuna;
  para: IdColuna;
  agente_antes: string | null;
  agente_depois: string | null;
  autor: "pessoa" | "agente";
  autor_agente_id: string | null;
  motivo: string | null;
  acionou: boolean;
  desfaz: string | null;
  de_fora: boolean;
  desfeito_em: Date | null;
  criado_em: Date;
}
const COLUNAS_M = "id, tarefa_id, lote_id, tipo, de, para, agente_antes, agente_depois, autor, autor_agente_id, motivo, acionou, desfaz, de_fora, desfeito_em, criado_em";
const paraMovimento = (l: LinhaMovimento): MovimentoTarefa => ({
  id: l.id,
  tarefaId: l.tarefa_id,
  tipo: l.tipo,
  de: l.de,
  para: l.para,
  agenteAntes: l.agente_antes,
  agenteDepois: l.agente_depois,
  autor: l.autor === "agente" && l.autor_agente_id ? { tipo: "agente", agenteId: l.autor_agente_id } : { tipo: "pessoa" },
  motivo: l.motivo,
  acionou: l.acionou,
  loteId: l.lote_id,
  desfaz: l.desfaz,
  deFora: l.de_fora,
  desfeitoEm: msOuNull(l.desfeito_em),
  criadoEm: ms(l.criado_em),
});

const COLUNAS_L = "id, quadro_id, autor, autor_agente_id, resumo, antes, tarefa_ids, desfeito_em, criado_em, pedido_por, via_nome";

const paraQuadro = (l: LinhaQuadro): Quadro => ({
  id: l.id,
  agenteId: l.agente_id,
  meta: l.meta,
  prazo: l.prazo,
  cumpridoEm: msOuNull(l.cumprido_em),
  resumo: l.resumo,
  colunas: l.colunas ?? null,
  criadoEm: ms(l.criado_em),
  atualizadoEm: ms(l.atualizado_em),
  metaDesde: ms(l.meta_desde),
  prefixo: l.prefixo ?? null,
  modoConversa: l.modo_conversa ?? "individual",
  quemFecha: l.quem_fecha ?? "bot",
  nome: l.nome ?? null,
  projetoId: l.projeto_id ?? null,
});

/** O Desfazer devolve o `terminadaEm` da foto; a foto de antes da revisão 3 não tem o campo: fechada = o `mudadoEm` dela. */
function terminadaDaFoto(t: TarefaQuadro): Date | null {
  const v = t.terminadaEm !== undefined ? t.terminadaEm : t.status === "feito" || t.status === "cancelado" ? t.mudadoEm : null;
  return v === null ? null : new Date(v);
}

const paraTarefa = (l: LinhaTarefa): TarefaQuadro => ({
  id: l.id,
  quadroId: l.quadro_id,
  titulo: l.titulo,
  descricao: l.descricao,
  status: l.status,
  voltarPara: l.voltar_para ?? null,
  agenteId: l.agente_id,
  ordem: l.ordem,
  linearId: l.linear_id,
  linearUrl: l.linear_url,
  prUrl: l.pr_url,
  pergunta: l.pergunta,
  resposta: l.resposta,
  deFora: l.de_fora,
  turnoId: l.turno_id,
  criadoEm: ms(l.criado_em),
  mudadoEm: ms(l.mudado_em),
  terminadaEm: l.terminada_em ? ms(l.terminada_em) : null,
  numero: l.numero ?? null,
  pedidoPor: l.pedido_por ?? null,
  respostaMensagemId: l.resposta_mensagem_id ?? null,
  respostaConversaId: l.resposta_conversa_id ?? null,
  respostaAgenteId: l.resposta_agente_id ?? null,
  prioridade: l.prioridade ?? "sem",
  labelIds: l.label_ids ?? [],
  prazoEm: l.prazo_em ?? null,
});

const paraLote = (l: LinhaLote): LoteQuadro & { antes: FotoLote } => ({
  id: l.id,
  quadroId: l.quadro_id,
  autor: (l.autor === "agente" && l.autor_agente_id ? { tipo: "agente", agenteId: l.autor_agente_id } : { tipo: "pessoa" }) satisfies AutorLote,
  resumo: l.resumo,
  antes: l.antes,
  tarefaIds: l.tarefa_ids,
  desfeitoEm: msOuNull(l.desfeito_em),
  criadoEm: ms(l.criado_em),
  pedidoPor: l.pedido_por ?? null,
  viaNome: l.via_nome ?? null,
});

export type NovaTarefa = Pick<TarefaQuadro, "quadroId" | "titulo" | "descricao" | "status" | "agenteId"> & Partial<Pick<TarefaQuadro, "voltarPara" | "linearId" | "linearUrl" | "prUrl" | "pergunta" | "resposta" | "deFora" | "terminadaEm" | "numero" | "pedidoPor" | "prioridade" | "labelIds" | "prazoEm">>;

/** O que muda numa tarefa (tudo menos ids e datas de criação). */
export type CamposTarefa = Pick<TarefaQuadro, "titulo" | "descricao" | "status" | "voltarPara" | "agenteId" | "ordem" | "linearId" | "linearUrl" | "prUrl" | "pergunta" | "resposta" | "deFora" | "turnoId" | "terminadaEm"> & Partial<Pick<TarefaQuadro, "pedidoPor" | "respostaMensagemId" | "respostaConversaId" | "respostaAgenteId" | "prioridade" | "labelIds" | "prazoEm">>;

/**
 * definido em 2026-10-31 (NOD-442): o quadro-agente, as tarefas e os lotes. Só primitivas: quem aplica um lote (e trava
 * o quadro com `buscarTravado` antes) é src/use-cases/quadro.ts.
 */
/**
 * Revisão 4 do PR #623: a consulta de `mudouDeQuadroDepois`, exportada para o teste rodar EXPLAIN sobre ela mesma.
 * Parâmetros: $1 tenant, $2 dona, $3 quadro (uuid), $4 lote. Dois `exists`, um por índice parcial da 0137: com
 * `(quadro_id = $3 or de = $3)` num só, o Postgres não combinava os dois índices (usava só `_saiu`, com o OR no Filter,
 * e lia toda mudança de quadro do tenant). Cada ramo casa com o seu (`_entrou` por quadro_id, `_saiu` por de), já com a dona.
 */
export const SQL_MUDOU_DE_QUADRO_DEPOIS = `
  select exists (
      select 1 from quadro_tarefa_historico h
      where h.tenant_id = $1 and h.owner_id = $2 and h.campo = 'quadro' and h.quadro_id = $3::uuid
        and h.criado_em > (select l.criado_em from quadro_lotes l where l.tenant_id = $1 and l.owner_id = $2 and l.id = $4)
    ) or exists (
      select 1 from quadro_tarefa_historico h
      where h.tenant_id = $1 and h.owner_id = $2 and h.campo = 'quadro' and h.de = $3::uuid::text
        and h.criado_em > (select l.criado_em from quadro_lotes l where l.tenant_id = $1 and l.owner_id = $2 and l.id = $4)
    ) as sim`;

export function quadrosRepo(conn: Conn, escopo: Escopo) {
  const dona = () => conn`tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId}`;
  const r = {
    async buscar(id: string): Promise<Quadro | null> {
      const [l] = await conn<LinhaQuadro[]>`select ${conn.unsafe(COLUNAS_Q)} from quadros where ${dona()} and id = ${id}`;
      return l ? paraQuadro(l) : null;
    },
    /** Trava a linha do quadro: um lote por vez em cada quadro (duas abas, dois bots). */
    async buscarTravado(id: string): Promise<Quadro | null> {
      const [l] = await conn<LinhaQuadro[]>`select ${conn.unsafe(COLUNAS_Q)} from quadros where ${dona()} and id = ${id} for update`;
      return l ? paraQuadro(l) : null;
    },
    /**
     * ADA-14 (ADR-153): o quadro padrão do bot (o que o chat e o agendamento usam sem quadro nomeado). Com N quadros, o de
     * `padrao` em quadro_bots; o quadro que o servidor de antes criou sem linha conta como do `agente_id`.
     */
    async doAgente(agenteId: string): Promise<Quadro | null> {
      const [q] = await r.vinculadosAo(agenteId);
      return q ?? null;
    },
    /**
     * Os quadros em que o bot aparece: com linha em quadro_bots ou (sem linha nenhuma) do agente_id. O padrão primeiro,
     * depois a posição e o mais antigo.
     */
    async vinculadosAo(agenteId: string): Promise<(Quadro & { padrao: boolean; posicao: number })[]> {
      const ls = await conn<(LinhaQuadro & { padrao_v: boolean; posicao_v: number })[]>`
        select ${conn.unsafe(colunasQ("q"))}, coalesce(b.padrao, true) as padrao_v, coalesce(b.posicao, 0) as posicao_v
        from quadros q left join quadro_bots b on b.tenant_id = q.tenant_id and b.quadro_id = q.id and b.agente_id = ${agenteId}
        where q.tenant_id = ${escopo.tenantId} and q.owner_id = ${escopo.pessoaId}
          and (b.id is not null or (q.agente_id = ${agenteId} and not exists (select 1 from quadro_bots x where x.tenant_id = q.tenant_id and x.quadro_id = q.id)))
        order by padrao_v desc, posicao_v, q.criado_em, q.id`;
      return ls.map((l) => ({ ...paraQuadro(l), padrao: l.padrao_v, posicao: l.posicao_v }));
    },
    /** ADA-14: o quadro que a tela abriu (`?quadro=`) se for deste bot; sem ele, o padrão. */
    async daTela(agenteId: string, quadroId?: string | null): Promise<Quadro | null> {
      return quadroId ? r.doBot(agenteId, quadroId) : r.doAgente(agenteId);
    },
    /** O quadro `quadroId` se ele aparece neste bot (o `?quadro=` da rota é escopado ao bot da URL); senão null. */
    async doBot(agenteId: string, quadroId: string): Promise<Quadro | null> {
      return (await r.vinculadosAo(agenteId)).find((q) => q.id === quadroId) ?? null;
    },
    /** Os bots de um quadro (as linhas de quadro_bots), na ordem de posição e do mais antigo. */
    async vinculos(quadroId: string): Promise<{ agenteId: string; padrao: boolean; posicao: number; criadoEm: number }[]> {
      const ls = await conn<{ agente_id: string; padrao: boolean; posicao: number; criado_em: Date }[]>`
        select b.agente_id, b.padrao, b.posicao, b.criado_em from quadro_bots b join agentes a on a.tenant_id = b.tenant_id and a.id = b.agente_id
        where b.tenant_id = ${escopo.tenantId} and b.owner_id = ${escopo.pessoaId} and b.quadro_id = ${quadroId} and a.excluido_em is null
        order by b.posicao, b.criado_em, b.agente_id`;
      return ls.map((l) => ({ agenteId: l.agente_id, padrao: l.padrao, posicao: l.posicao, criadoEm: ms(l.criado_em) }));
    },
    /** Os vínculos de um bot (todos os quadros dele), travados: padrão e posição mudam um de cada vez. */
    async vinculosDoBotTravados(agenteId: string): Promise<{ quadroId: string; padrao: boolean; posicao: number; criadoEm: number }[]> {
      const ls = await conn<{ quadro_id: string; padrao: boolean; posicao: number; criado_em: Date }[]>`
        select quadro_id, padrao, posicao, criado_em from quadro_bots where ${dona()} and agente_id = ${agenteId}
        order by posicao, criado_em, quadro_id for update`;
      return ls.map((l) => ({ quadroId: l.quadro_id, padrao: l.padrao, posicao: l.posicao, criadoEm: ms(l.criado_em) }));
    },
    /**
     * Serializa o que muda os quadros de um bot (criar o 1º, vincular, desvincular, padrão) até o fim da transação: sem o
     * índice "um por bot" (0156), é esta trava que impede dois "primeiro quadro" ao mesmo tempo.
     */
    async travarBot(agenteId: string): Promise<void> {
      await conn`select pg_advisory_xact_lock(hashtextextended(${`quadros-do-bot:${escopo.tenantId}:${agenteId}`}, 0))`;
    },
    /** Põe o quadro no bot (no fim da lista). Padrão se o bot não tem outro. false = já estava. */
    async vincular(quadroId: string, agenteId: string): Promise<boolean> {
      const r = await conn`
        insert into quadro_bots (tenant_id, owner_id, quadro_id, agente_id, padrao, posicao)
        select ${escopo.tenantId}, ${escopo.pessoaId}, ${quadroId}, ${agenteId},
          not exists (select 1 from quadro_bots where ${dona()} and agente_id = ${agenteId} and padrao),
          coalesce((select max(posicao) + 1 from quadro_bots where ${dona()} and agente_id = ${agenteId}), 0)
        on conflict do nothing`;
      return r.count > 0;
    },
    /** Tira o quadro do bot. Devolve se era o padrão (quem chama escolhe o próximo), ou null se não estava. */
    async desvincular(quadroId: string, agenteId: string): Promise<{ eraPadrao: boolean } | null> {
      const [l] = await conn<{ padrao: boolean }[]>`delete from quadro_bots where ${dona()} and quadro_id = ${quadroId} and agente_id = ${agenteId} returning padrao`;
      return l ? { eraPadrao: l.padrao } : null;
    },
    /** O quadro vira o padrão do bot (o de antes deixa de ser; a ordem respeita o índice parcial de um padrão por bot). */
    async definirPadrao(agenteId: string, quadroId: string): Promise<boolean> {
      await conn`update quadro_bots set padrao = false where ${dona()} and agente_id = ${agenteId} and padrao and quadro_id <> ${quadroId}`;
      const r = await conn`update quadro_bots set padrao = true where ${dona()} and agente_id = ${agenteId} and quadro_id = ${quadroId}`;
      return r.count > 0;
    },
    /** Os ids dos quadros de que o bot é dono (quadros.agente_id), travados: o excluir do bot passa o dono adiante. */
    async doDonoTravados(agenteId: string): Promise<string[]> {
      const ls = await conn<{ id: string }[]>`select id from quadros where ${dona()} and agente_id = ${agenteId} order by criado_em, id for update`;
      return ls.map((l) => l.id);
    },
    /** O dono do quadro (o anfitrião, quadros.agente_id) passa a outro bot vinculado: o dono saiu ou foi excluído. */
    async transferirDono(quadroId: string, agenteId: string): Promise<void> {
      await conn`update quadros set agente_id = ${agenteId}, atualizado_em = clock_timestamp() where ${dona()} and id = ${quadroId}`;
    },
    /** Muda o nome e o projeto (undefined = mantém). */
    async renomear(quadroId: string, c: { nome?: string | null; projetoId?: string | null }): Promise<Quadro | null> {
      const [l] = await conn<LinhaQuadro[]>`
        update quadros set nome = case when ${c.nome !== undefined}::boolean then ${c.nome ?? null} else nome end,
          projeto_id = case when ${c.projetoId !== undefined}::boolean then ${c.projetoId ?? null}::uuid else projeto_id end,
          atualizado_em = clock_timestamp()
        where ${dona()} and id = ${quadroId}
        returning ${conn.unsafe(COLUNAS_Q)}`;
      return l ? paraQuadro(l) : null;
    },
    /** Quantos quadros a pessoa tem (o teto por pessoa, S10). */
    async contar(): Promise<number> {
      const [l] = await conn<{ n: number }[]>`select count(*)::int as n from quadros where ${dona()}`;
      return l?.n ?? 0;
    },
    /**
     * O quadro da tarefa que este turno executa (o turno de uma tarefa mexe no quadro dela). A tarefa guarda o turno que a
     * começou; a retomada (ADR-009: turno novo com `retoma_turno_id`, depois de um cartão, da espera de CI, da resposta de
     * um colega) sobe a cadeia até ele (revisão rodada 6; teto de 50 saltos contra ciclo, como raizDaCadeia).
     */
    async doTurno(turnoId: string): Promise<Quadro | null> {
      const [l] = await conn<LinhaQuadro[]>`
        with recursive sobe(id, retoma, n) as (
          select id, retoma_turno_id, 0 from turnos where tenant_id = ${escopo.tenantId} and id = ${turnoId}
          union all
          select t.id, t.retoma_turno_id, s.n + 1 from turnos t join sobe s on t.tenant_id = ${escopo.tenantId} and t.id = s.retoma where s.n < 50
        )
        select ${conn.unsafe(COLUNAS_Q)} from quadros where ${dona()} and id = (
          select qt.quadro_id from quadro_tarefas qt join sobe s on qt.turno_id = s.id
          where qt.tenant_id = ${escopo.tenantId} and qt.owner_id = ${escopo.pessoaId} order by s.n limit 1)`;
      return l ? paraQuadro(l) : null;
    },
    /**
     * NOD-443 (revisão 2 do PR #628, achados 2 e 6): a tarefa que este turno executa (a mesma subida da cadeia de
     * retomadas do doTurno). O turno da tarefa só mexe nela.
     */
    async tarefaDoTurno(turnoId: string): Promise<string | null> {
      // ADA-28 (ADR-159, escopo B): sem tarefa na cadeia, a frente aberta num turno de tarefa (trabalhos.tarefa_id, 0157)
      // é dela — o `terminei` e o `pr_url` da frente valem para a tarefa. A ADA-232 grava o tarefa_id sempre (o card);
      // a subida pela frente só vale com NOD_TAREFA_CASA=1.
      const pelaFrente = tarefaCasaLigada();
      const [l] = await conn<{ id: string }[]>`
        with recursive sobe(id, retoma, trabalho, n) as (
          select id, retoma_turno_id, trabalho_id, 0 from turnos where tenant_id = ${escopo.tenantId} and id = ${turnoId}
          union all
          select t.id, t.retoma_turno_id, t.trabalho_id, s.n + 1 from turnos t join sobe s on t.tenant_id = ${escopo.tenantId} and t.id = s.retoma where s.n < 50
        )
        select id from (
          (select qt.id, 0 as via, s.n from quadro_tarefas qt join sobe s on qt.turno_id = s.id
            where qt.tenant_id = ${escopo.tenantId} and qt.owner_id = ${escopo.pessoaId} order by s.n limit 1)
          union all
          (select qt.id, 1 as via, s.n from sobe s join trabalhos w on w.tenant_id = ${escopo.tenantId} and w.id = s.trabalho
            join quadro_tarefas qt on qt.tenant_id = w.tenant_id and qt.id = w.tarefa_id and qt.owner_id = ${escopo.pessoaId}
            where ${pelaFrente} order by s.n limit 1)
        ) x order by via, n limit 1`;
      return l?.id ?? null;
    },
    /**
     * NOD-455 (revisão 5, achado M2): a tarefa deste turno (a mesma subida do tarefaDoTurno), o quadro dela e quem participa
     * dele. Só quando há alguém além da dona (null sem tarefa ou sem membros): o despacho avisa essas pessoas que o card
     * mudou, porque os frames `turno.*` são da dona e não saem do escopo dela.
     */
    async membrosDoTurno(turnoId: string): Promise<{ quadroId: string; tarefaId: string; membros: string[] } | null> {
      const [l] = await conn<{ quadro_id: string; tarefa_id: string; membros: string[] | null }[]>`
        with recursive sobe(id, retoma, n) as (
          select id, retoma_turno_id, 0 from turnos where tenant_id = ${escopo.tenantId} and id = ${turnoId}
          union all
          select t.id, t.retoma_turno_id, s.n + 1 from turnos t join sobe s on t.tenant_id = ${escopo.tenantId} and t.id = s.retoma where s.n < 50
        ), tarefa as (
          select qt.id, qt.quadro_id from quadro_tarefas qt join sobe s on qt.turno_id = s.id
          where qt.tenant_id = ${escopo.tenantId} and qt.owner_id = ${escopo.pessoaId} order by s.n limit 1
        )
        select t.quadro_id, t.id as tarefa_id, (select array_agg(m.pessoa_id::text order by m.adicionado_em, m.id) from quadro_membros m
          where m.tenant_id = ${escopo.tenantId} and m.owner_id = ${escopo.pessoaId} and m.quadro_id = t.quadro_id) as membros from tarefa t`;
      return l && l.membros?.length ? { quadroId: l.quadro_id, tarefaId: l.tarefa_id, membros: l.membros } : null;
    },
    /** Os quadros da pessoa (de bots não excluídos), mais recente primeiro. */
    async listar(): Promise<Quadro[]> {
      const ls = await conn<LinhaQuadro[]>`
        select ${conn.unsafe(colunasQ("q"))}
        from quadros q join agentes a on a.tenant_id = q.tenant_id and a.id = q.agente_id
        where q.tenant_id = ${escopo.tenantId} and q.owner_id = ${escopo.pessoaId} and a.excluido_em is null
        order by q.atualizado_em desc`;
      return ls.map(paraQuadro);
    },
    /**
     * Cria o quadro e põe o dono em quadro_bots (padrão se o bot não tem outro). null = o índice "um por bot" (0133) ainda
     * existe e o bot já tem quadro (antes da 0156): o `on conflict` sem alvo pega qualquer índice único sem abortar a
     * transação.
     */
    async criar(q: { agenteId: string; meta: string | null; prazo: string | null; metaDesde?: number; prefixo?: string | null; nome?: string | null; projetoId?: string | null }): Promise<Quadro | null> {
      const [l] = await conn<LinhaQuadro[]>`
        insert into quadros (tenant_id, owner_id, agente_id, meta, prazo, meta_desde, prefixo, nome, projeto_id)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${q.agenteId}, ${q.meta}, ${q.prazo}::date, coalesce(${q.metaDesde === undefined ? null : new Date(q.metaDesde)}::timestamptz, now()), ${q.prefixo ?? null}, ${q.nome ?? null}, ${q.projetoId ?? null}::uuid)
        on conflict do nothing
        returning ${conn.unsafe(COLUNAS_Q)}`;
      if (!l) return null;
      await r.vincular(l.id, q.agenteId);
      return paraQuadro(l);
    },
    /** `metaDesde` ausente = mantém. `colunas` ausente = não mexe nelas (a foto de antes da NOD-448 e quem só muda a meta). */
    async salvar(id: string, q: Pick<Quadro, "meta" | "prazo" | "cumpridoEm" | "resumo"> & { metaDesde?: number; colunas?: ColunaQuadro[] | null; /** ADA-28: ausente = mantém. */ quemFecha?: QuemFecha }): Promise<Quadro | null> {
      const mexe = q.colunas !== undefined;
      const colunas = q.colunas ? jsonb(conn, q.colunas) : null;
      const [l] = await conn<LinhaQuadro[]>`
        update quadros set meta = ${q.meta}, prazo = ${q.prazo}::date, cumprido_em = ${q.cumpridoEm === null ? null : new Date(q.cumpridoEm)},
          resumo = ${q.resumo}, colunas = case when ${mexe}::boolean then ${colunas}::jsonb else colunas end,
          meta_desde = coalesce(${q.metaDesde === undefined ? null : new Date(q.metaDesde)}::timestamptz, meta_desde),
          quem_fecha = coalesce(${q.quemFecha ?? null}::text, quem_fecha), atualizado_em = clock_timestamp()
        where ${dona()} and id = ${id}
        returning ${conn.unsafe(COLUNAS_Q)}`;
      return l ? paraQuadro(l) : null;
    },
    /** Só o Desfazer da criação apaga (as tarefas e os lotes vão no CASCADE). */
    async apagar(id: string): Promise<boolean> {
      const r = await conn`delete from quadros where ${dona()} and id = ${id}`;
      return r.count > 0;
    },

    async tarefas(quadroId: string): Promise<TarefaQuadro[]> {
      const ls = await conn<LinhaTarefa[]>`select ${conn.unsafe(COLUNAS_T)} from quadro_tarefas where ${dona()} and quadro_id = ${quadroId} order by ordem, criado_em, id`;
      return ls.map(paraTarefa);
    },
    /** NOD-416 (revisão 5 do PR #623): só as tarefas sem número (as que o servidor de antes criou), na ordem do quadro. */
    async tarefasSemNumero(quadroId: string): Promise<TarefaQuadro[]> {
      const ls = await conn<LinhaTarefa[]>`select ${conn.unsafe(COLUNAS_T)} from quadro_tarefas where ${dona()} and quadro_id = ${quadroId} and numero is null order by ordem, criado_em, id`;
      return ls.map(paraTarefa);
    },
    async tarefa(id: string): Promise<TarefaQuadro | null> {
      const [l] = await conn<LinhaTarefa[]>`select ${conn.unsafe(COLUNAS_T)} from quadro_tarefas where ${dona()} and id = ${id}`;
      return l ? paraTarefa(l) : null;
    },
    /** As tarefas trazidas do Linear com este id (NOD-12), em qualquer quadro da pessoa. */
    async tarefasDoLinear(linearId: string): Promise<TarefaQuadro[]> {
      const ls = await conn<LinhaTarefa[]>`select ${conn.unsafe(COLUNAS_T)} from quadro_tarefas where ${dona()} and linear_id is not null and lower(linear_id) = lower(${linearId.trim()}) order by criado_em, id`;
      return ls.map(paraTarefa);
    },
    /**
     * Revisão 8 do PR #630: dos ids do Linear, os de uma tarefa da pessoa que SAIU deste quadro (mover_quadro: a linha
     * 'quadro' do histórico com `de` = este quadro) e hoje está em outro. A reimportação não a recria aqui. A trazida por
     * outra importação noutro quadro (o mesmo time em dois quadros) não conta: cada quadro tem a sua. Ids em maiúsculas.
     */
    async linearIdsQueSairam(quadroId: string, linearIds: readonly string[]): Promise<Set<string>> {
      if (linearIds.length === 0) return new Set();
      const ls = await conn<{ linear_id: string }[]>`
        select distinct upper(t.linear_id) as linear_id from quadro_tarefas t
        where t.tenant_id = ${escopo.tenantId} and t.owner_id = ${escopo.pessoaId} and t.quadro_id <> ${quadroId} and t.linear_id is not null
          and lower(t.linear_id) = any(${conn.array(linearIds.map((x) => x.trim().toLowerCase()))}::text[])
          and exists (select 1 from quadro_tarefa_historico h
                       where h.tenant_id = t.tenant_id and h.owner_id = t.owner_id and h.campo = 'quadro' and h.de = ${quadroId}::text and h.tarefa_id = t.id)`;
      return new Set(ls.map((l) => l.linear_id));
    },
    async inserirTarefa(t: NovaTarefa): Promise<TarefaQuadro> {
      const [l] = await conn<LinhaTarefa[]>`
        insert into quadro_tarefas (tenant_id, owner_id, quadro_id, titulo, descricao, status, voltar_para, agente_id, ordem, linear_id, linear_url, pr_url, pergunta, resposta, de_fora, terminada_em, numero, pedido_por, prioridade, label_ids, prazo_em)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${t.quadroId}, ${t.titulo}, ${t.descricao}, ${t.status}, ${t.voltarPara ?? null}, ${t.agenteId},
          (select coalesce(max(ordem), 0) + 1 from quadro_tarefas where ${dona()} and quadro_id = ${t.quadroId}),
          ${t.linearId ?? null}, ${t.linearUrl ?? null}, ${t.prUrl ?? null}, ${t.pergunta ?? null}, ${t.resposta ?? null}, ${t.deFora ?? false}, ${t.terminadaEm == null ? null : new Date(t.terminadaEm)}, ${t.numero ?? null}, ${t.pedidoPor ?? null}, ${t.prioridade ?? "sem"},
          ${conn.array(t.labelIds ?? [])}::uuid[], ${t.prazoEm ?? null}::date)
        returning ${conn.unsafe(COLUNAS_T)}`;
      return paraTarefa(l!);
    },
    async salvarTarefa(id: string, c: CamposTarefa): Promise<TarefaQuadro | null> {
      // ADA-15: a proveniência da resposta acompanha a resposta. Os chamadores salvam a tarefa inteira (`{ ...t }`), com a
      // proveniência lida antes: com a resposta igual, fica a que veio (ou a de antes, se ausente); com a resposta mudada,
      // só vale uma proveniência nova (a do responder pela fala); a velha some, porque a resposta nova não veio daquela fala.
      const proveniencia = (coluna: string, v: string | null | undefined) => {
        const col = conn.unsafe(coluna);
        const novo = v === undefined ? conn`${col}` : conn`${v}::uuid`;
        return conn`case when resposta is not distinct from ${c.resposta}::text then ${novo} when ${novo} is distinct from ${col} then ${novo} else null end`;
      };
      const [l] = await conn<LinhaTarefa[]>`
        update quadro_tarefas set titulo = ${c.titulo}, descricao = ${c.descricao}, status = ${c.status}, voltar_para = ${c.voltarPara ?? null}, agente_id = ${c.agenteId},
          ordem = ${c.ordem}, linear_id = ${c.linearId}, linear_url = ${c.linearUrl}, pr_url = ${c.prUrl}, pergunta = ${c.pergunta},
          resposta = ${c.resposta}, de_fora = ${c.deFora},
          resposta_mensagem_id = ${proveniencia("resposta_mensagem_id", c.respostaMensagemId)}, resposta_conversa_id = ${proveniencia("resposta_conversa_id", c.respostaConversaId)},
          resposta_agente_id = ${proveniencia("resposta_agente_id", c.respostaAgenteId)}, turno_id = ${c.turnoId}, mudado_em = clock_timestamp(),
          terminada_em = ${c.terminadaEm === null ? null : new Date(c.terminadaEm)},
          pedido_por = coalesce(${c.pedidoPor ?? null}::uuid, pedido_por), prioridade = coalesce(${c.prioridade ?? null}::text, prioridade),
          label_ids = ${c.labelIds === undefined ? conn`label_ids` : conn`${conn.array(c.labelIds)}::uuid[]`},
          prazo_em = ${c.prazoEm === undefined ? conn`prazo_em` : conn`${c.prazoEm}::date`}
        where ${dona()} and id = ${id}
        returning ${conn.unsafe(COLUNAS_T)}`;
      return l ? paraTarefa(l) : null;
    },
    async apagarTarefa(id: string): Promise<boolean> {
      const r = await conn`delete from quadro_tarefas where ${dona()} and id = ${id}`;
      return r.count > 0;
    },
    /** O Desfazer de uma exclusão: a tarefa volta com o mesmo id e as mesmas datas. */
    /**
     * `manterMudadoEm`: o Desfazer da importação do Linear devolve o mudado_em da foto. Com a hora de agora, a tarefa
     * passaria a contar como mexida pela pessoa e a reimportação nunca mais a atualizaria (revisão do PR #630).
     */
    async restaurarTarefa(t: TarefaQuadro, o: { manterMudadoEm?: boolean } = {}): Promise<TarefaQuadro> {
      const mudado = o.manterMudadoEm ? conn`${new Date(t.mudadoEm)}::timestamptz` : conn`clock_timestamp()`;
      const [l] = await conn<LinhaTarefa[]>`
        insert into quadro_tarefas (tenant_id, owner_id, id, quadro_id, titulo, descricao, status, voltar_para, agente_id, ordem, linear_id, linear_url, pr_url, pergunta, resposta, de_fora, turno_id, criado_em, mudado_em, terminada_em, numero, pedido_por, resposta_mensagem_id, resposta_conversa_id, resposta_agente_id, prioridade, label_ids, prazo_em)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${t.id}, ${t.quadroId}, ${t.titulo}, ${t.descricao}, ${t.status}, ${t.voltarPara ?? null}, ${t.agenteId}, ${t.ordem},
          ${t.linearId}, ${t.linearUrl}, ${t.prUrl}, ${t.pergunta}, ${t.resposta}, ${t.deFora ?? false}, ${t.turnoId}, ${new Date(t.criadoEm)}, ${mudado}, ${terminadaDaFoto(t)}, ${t.numero ?? null}, ${t.pedidoPor ?? null},
          ${t.respostaMensagemId ?? null}, ${t.respostaConversaId ?? null}, ${t.respostaAgenteId ?? null}, coalesce(${t.prioridade ?? null}::text, 'sem'),
          ${conn.array(t.labelIds ?? [])}::uuid[], ${t.prazoEm ?? null}::date)
        on conflict (tenant_id, id) do update set titulo = excluded.titulo, descricao = excluded.descricao, status = excluded.status, voltar_para = excluded.voltar_para,
          agente_id = excluded.agente_id, ordem = excluded.ordem, linear_id = excluded.linear_id, linear_url = excluded.linear_url,
          pr_url = excluded.pr_url, pergunta = excluded.pergunta, resposta = excluded.resposta, de_fora = excluded.de_fora, turno_id = excluded.turno_id, mudado_em = excluded.mudado_em, terminada_em = excluded.terminada_em,
          numero = coalesce(quadro_tarefas.numero, excluded.numero), pedido_por = excluded.pedido_por,
          resposta_mensagem_id = excluded.resposta_mensagem_id, resposta_conversa_id = excluded.resposta_conversa_id, resposta_agente_id = excluded.resposta_agente_id,
          -- 0160: a foto de antes da prioridade não a tem: fica a atual.
          prioridade = coalesce(${t.prioridade ?? null}::text, quadro_tarefas.prioridade),
          -- 0161: a foto de antes da 0161 não tem labels nem prazo: mantém os de agora.
          label_ids = ${t.labelIds === undefined ? conn`quadro_tarefas.label_ids` : conn`excluded.label_ids`}, prazo_em = ${t.prazoEm === undefined ? conn`quadro_tarefas.prazo_em` : conn`excluded.prazo_em`}
        returning ${conn.unsafe(COLUNAS_T)}`;
      return paraTarefa(l!);
    },
    /**
     * O estado da execução de cada tarefa, pelo turno que ela guarda (o que a começou): a cadeia de retomadas desce dele
     * e vale o turno vivo mais recente (senão, o mais recente). O que recebeu o Parar e ainda não parou conta como
     * interrompido: não é vivo para o Desfazer nem para quem planeja o lote (revisão rodada 6).
     */
    async estadosDosTurnos(ids: readonly string[]): Promise<Map<string, EstadoTurno>> {
      if (ids.length === 0) return new Map();
      const ls = await conn<{ raiz: string; estado: EstadoTurno; parado: boolean }[]>`
        with recursive desce(raiz, id, n) as (
          select id, id, 0 from turnos where tenant_id = ${escopo.tenantId} and id = any(${conn.array([...ids])}::uuid[])
          union all
          select d.raiz, t.id, d.n + 1 from turnos t join desce d on t.tenant_id = ${escopo.tenantId} and t.retoma_turno_id = d.id where d.n < 50
        )
        select distinct on (d.raiz) d.raiz, t.estado, t.parar_solicitado_em is not null as parado
        from desce d join turnos t on t.tenant_id = ${escopo.tenantId} and t.id = d.id
        order by d.raiz, (t.estado in ('pendente', 'despachando') and t.parar_solicitado_em is null) desc, t.criado_em desc, d.n desc`;
      return new Map(ls.map((l) => [l.raiz, l.parado && (l.estado === "pendente" || l.estado === "despachando") ? "interrompido" : l.estado]));
    },
    /**
     * NOD-460 (revisão 2 do PR #645): desde quando o agente trabalha em cada tarefa, pelo turno vivo da mesma cadeia do
     * `estadosDosTurnos` (a retomada mais recente). Conta do despacho, como o "Trabalhando · há N" da conversa (NOD-276);
     * sem despacho ainda, da criação. Só entram as cadeias com turno vivo.
     */
    async desdeDosTurnos(ids: readonly string[]): Promise<Map<string, number>> {
      if (ids.length === 0) return new Map();
      const ls = await conn<{ raiz: string; desde: Date }[]>`
        with recursive desce(raiz, id, n) as (
          select id, id, 0 from turnos where tenant_id = ${escopo.tenantId} and id = any(${conn.array([...ids])}::uuid[])
          union all
          select d.raiz, t.id, d.n + 1 from turnos t join desce d on t.tenant_id = ${escopo.tenantId} and t.retoma_turno_id = d.id where d.n < 50
        )
        select distinct on (d.raiz) d.raiz, coalesce(t.despachado_em, t.criado_em) as desde
        from desce d join turnos t on t.tenant_id = ${escopo.tenantId} and t.id = d.id
        where t.estado in ('pendente', 'despachando') and t.parar_solicitado_em is null
        order by d.raiz, t.criado_em desc, d.n desc`;
      return new Map(ls.map((l) => [l.raiz, new Date(l.desde).getTime()]));
    },
    /**
     * ADA-16 (ADR-163): as tarefas cujo trabalho do responsável está aberto sem turno vivo, esperando a CI, um colega, um
     * comando ou a volta marcada (o estado derivado `rodando` sem turno pendente nem despachando; ADR-099 "esperar não é
     * trabalhar"). O card mostra "esperando".
     */
    async tarefasEsperando(tarefas: readonly { id: string; agenteId: string | null }[]): Promise<Set<string>> {
      const com = tarefas.filter((t): t is { id: string; agenteId: string } => t.agenteId !== null);
      if (com.length === 0) return new Set();
      const ls = await conn<{ tarefa_id: string }[]>`
        select w.tarefa_id as tarefa_id from trabalhos w
        join unnest(${conn.array(com.map((t) => t.id))}::uuid[], ${conn.array(com.map((t) => t.agenteId))}::uuid[]) as q(tarefa_id, agente_id)
          on q.tarefa_id = w.tarefa_id and q.agente_id = w.agente_id
        where w.tenant_id = ${escopo.tenantId} and w.owner_id = ${escopo.pessoaId} and w.origem = 'quadro' and w.forma = 'task' and w.estado = 'rodando'
          -- A volta marcada (pendente com acordar_em no futuro) é espera, não fila: a mesma régua do fatos().despertar.
          and not exists (select 1 from turnos v where v.tenant_id = w.tenant_id and v.trabalho_id = w.id
            and (v.estado = 'despachando' or (v.estado = 'pendente' and (v.acordar_em is null or v.acordar_em <= now()))))`;
      return new Set(ls.map((l) => l.tarefa_id));
    },
    /**
     * revisto em 2026-11-10 (ADA-16, ADR-163, sem teto próprio): o trabalho do responsável de cada tarefa na fila, para o
     * card dizer o motivo real da espera. `emSerie`: outro turno do MESMO trabalho está rodando (a mesma tarefa com o
     * mesmo bot segue em série). Os campos do trabalho alimentam o portão da máquina (esperaDoMac, ADR-085).
     */
    async filaDasTarefas(tarefas: readonly { id: string; agenteId: string | null }[]): Promise<Map<string, FilaDaTarefa>> {
      const com = tarefas.filter((t): t is { id: string; agenteId: string } => t.agenteId !== null);
      if (com.length === 0) return new Map();
      const ls = await conn<{ tarefa_id: string; estado: Trabalho["estado"]; iniciado_em: Date | null; criado_em: Date; pessoa_esperando: boolean; em_serie: boolean }[]>`
        select w.tarefa_id as tarefa_id, w.estado, w.iniciado_em, w.criado_em, w.pessoa_esperando,
          exists (select 1 from turnos v where v.tenant_id = w.tenant_id and v.trabalho_id = w.id and v.estado = 'despachando') as em_serie
        from trabalhos w
        join unnest(${conn.array(com.map((t) => t.id))}::uuid[], ${conn.array(com.map((t) => t.agenteId))}::uuid[]) as q(tarefa_id, agente_id)
          on q.tarefa_id = w.tarefa_id and q.agente_id = w.agente_id
        where w.tenant_id = ${escopo.tenantId} and w.owner_id = ${escopo.pessoaId} and w.origem = 'quadro' and w.forma = 'task'`;
      return new Map(ls.map((l) => [l.tarefa_id, {
        emSerie: l.em_serie,
        trabalho: { estado: l.estado, origem: "quadro" as const, iniciadoEm: msOuNull(l.iniciado_em), criadoEm: ms(l.criado_em), pessoaEsperando: l.pessoa_esperando },
      }]));
    },
    /** A cadeia de retomadas que desce do turno de uma tarefa (ele incluso): o Parar vale para ela inteira. */
    async cadeiaDoTurno(turnoId: string): Promise<{ id: string; estado: EstadoTurno }[]> {
      return conn<{ id: string; estado: EstadoTurno }[]>`
        with recursive desce(id, n) as (
          select id, 0 from turnos where tenant_id = ${escopo.tenantId} and id = ${turnoId}
          union all
          select t.id, d.n + 1 from turnos t join desce d on t.tenant_id = ${escopo.tenantId} and t.retoma_turno_id = d.id where d.n < 50
        )
        select t.id, t.estado from desce d join turnos t on t.tenant_id = ${escopo.tenantId} and t.id = d.id`;
    },

    /** NOD-420 (0141): as marcas da estadia de cada tarefa na coluna atual (o gatilho as zera quando o status muda). */
    async marcasDeAviso(quadroId: string): Promise<Map<string, MarcasAviso>> {
      const ls = await conn<{ id: string; na_coluna_desde: Date; avisada_em: Date | null; cobrada_em: Date | null; escalada_em: Date | null }[]>`
        select id, na_coluna_desde, avisada_em, cobrada_em, escalada_em from quadro_tarefas where ${dona()} and quadro_id = ${quadroId}`;
      return new Map(ls.map((l) => [l.id, { naColunaDesde: ms(l.na_coluna_desde), avisadaEm: msOuNull(l.avisada_em), cobradaEm: msOuNull(l.cobrada_em), escaladaEm: msOuNull(l.escalada_em) }]));
    },
    /** Marca o que saiu, só onde ainda não estava marcado: devolve os ids que ESTA chamada marcou (os outros, alguém já marcou). */
    async marcarAviso(ids: readonly string[], campo: "avisada_em" | "cobrada_em" | "escalada_em", agora: number): Promise<string[]> {
      if (ids.length === 0) return [];
      const ls = await conn<{ id: string }[]>`
        update quadro_tarefas set ${conn.unsafe(campo)} = ${new Date(agora)}
        where ${dona()} and id = any(${conn.array([...ids])}::uuid[]) and ${conn.unsafe(campo)} is null returning id`;
      return ls.map((l) => l.id);
    },

    /** NOD-430: `pedidoPor` = a pessoa que pediu ao bot autor na conversa (só com autor agente; o bot é o `autor_agente_id`). */
    async inserirLote(l: { quadroId: string; autor: AutorLote; resumo: string; antes: FotoLote; tarefaIds: readonly string[]; pedidoPor?: string | null; viaNome?: string | null }): Promise<LoteQuadro> {
      const [r] = await conn<LinhaLote[]>`
        insert into quadro_lotes (tenant_id, owner_id, quadro_id, autor, autor_agente_id, resumo, antes, tarefa_ids, pedido_por, via_nome)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${l.quadroId}, ${l.autor.tipo}, ${l.autor.tipo === "agente" ? l.autor.agenteId : null},
          ${l.resumo}, ${jsonb(conn, l.antes)}, ${conn.array([...l.tarefaIds])}::uuid[], ${l.pedidoPor ?? null}, ${l.viaNome ?? null})
        returning ${conn.unsafe(COLUNAS_L)}`;
      const { antes: _antes, ...lote } = paraLote(r!);
      return lote;
    },
    /**
     * NOD-430: a Atividade da tarefa aberta: os `limite` lotes MAIS RECENTES que a tocaram (os desfeitos fora), em ordem
     * de criação. Desc com limite e vira na aplicação (revisão 1 do PR #627): com `order by criado_em limit 50`, uma
     * tarefa com mais de 50 lotes mostrava os 50 primeiros e nunca o que acabou de acontecer.
     */
    /**
     * `antesDaTarefa` (2026-11-10): a foto desta tarefa antes do lote (null = nasceu nele; ausente = o lote não a fotografou),
     * para a linha do tempo contar o que mudou na prioridade, no prazo e nas labels (`mudancasDeCampos`).
     */
    async lotesDaTarefa(quadroId: string, tarefaId: string, limite = 50): Promise<(LoteQuadro & { antesDaTarefa?: TarefaQuadro | null })[]> {
      const rs = await conn<LinhaLote[]>`
        select ${conn.unsafe(COLUNAS_L)} from quadro_lotes
        where ${dona()} and quadro_id = ${quadroId} and ${tarefaId}::uuid = any(tarefa_ids) and desfeito_em is null
        order by criado_em desc, id desc limit ${limite}`;
      return rs.reverse().map((r) => {
        const { antes, ...lote } = paraLote(r);
        const foto = antes?.tarefas?.find((x) => x.id === tarefaId);
        return foto ? { ...lote, antesDaTarefa: foto.antes } : lote;
      });
    },
    /** NOD-430 (revisão 2 do PR #627): o lote mais antigo da tarefa (o "criada por"), fora da janela dos 50 recentes. */
    async primeiroLoteDaTarefa(quadroId: string, tarefaId: string): Promise<LoteQuadro | null> {
      const [r] = await conn<LinhaLote[]>`
        select ${conn.unsafe(COLUNAS_L)} from quadro_lotes
        where ${dona()} and quadro_id = ${quadroId} and ${tarefaId}::uuid = any(tarefa_ids) and desfeito_em is null
        order by criado_em, id limit 1`;
      if (!r) return null;
      const { antes: _antes, ...lote } = paraLote(r);
      return lote;
    },
    async lote(id: string): Promise<(LoteQuadro & { antes: FotoLote }) | null> {
      const [r] = await conn<LinhaLote[]>`select ${conn.unsafe(COLUNAS_L)} from quadro_lotes where ${dona()} and id = ${id}`;
      return r ? paraLote(r) : null;
    },
    /** O último lote ainda não desfeito do quadro (só ele se desfaz: a pilha não volta duas casas). */
    async ultimoLote(quadroId: string): Promise<(LoteQuadro & { antes: FotoLote }) | null> {
      const [r] = await conn<LinhaLote[]>`select ${conn.unsafe(COLUNAS_L)} from quadro_lotes where ${dona()} and quadro_id = ${quadroId} order by criado_em desc, id desc limit 1`;
      return r && r.desfeito_em === null ? paraLote(r) : null;
    },
    // NOD-419: o histórico de movimentos (src/domain/freios-quadro.ts lê; o lote grava).
    /**
     * Os movimentos do quadro nas últimas `horas` (pelo relógio do banco, o mesmo que grava `criado_em`), mais todas as
     * recusas (o limite de passes conta a vida da tarefa).
     */
    async movimentos(quadroId: string, horas = 24): Promise<MovimentoTarefa[]> {
      const rs = await conn<LinhaMovimento[]>`
        select ${conn.unsafe(COLUNAS_M)} from quadro_movimentos
        where ${dona()} and quadro_id = ${quadroId} and (criado_em >= clock_timestamp() - make_interval(hours => ${horas}) or tipo = 'nao_e_comigo')
        order by criado_em, id`;
      return rs.map(paraMovimento);
    },
    /**
     * Revisão 2 do PR #629: o último movimento desfazível de cada tarefa, sem a janela de `movimentos` (o espelho de
     * `ultimoDesfazivel`). A tela mostra o Desfazer nos últimos movimentos da tarefa, de qualquer idade; o
     * desfazer_movimento lê estes junto do histórico para aceitar o mesmo que a tela oferece.
     */
    async ultimosDesfaziveis(quadroId: string): Promise<MovimentoTarefa[]> {
      const rs = await conn<LinhaMovimento[]>`
        select distinct on (tarefa_id) ${conn.unsafe(COLUNAS_M)} from quadro_movimentos
        where ${dona()} and quadro_id = ${quadroId} and desfeito_em is null and tipo <> 'acionou'
          and (de is distinct from para or agente_antes is distinct from agente_depois)
        order by tarefa_id, criado_em desc, id desc`;
      return rs.map(paraMovimento);
    },
    /**
     * Revisão 8 do PR #629: de cada tarefa que espera (Precisa de você, Bloqueado), o último movimento que valha e que a
     * levou para a espera vindo de fora dela, de qualquer idade (o espelho do `paradaDaEspera`). O último desfazível não
     * basta: um movimento dentro da espera (Bloqueado → Precisa de você, troca de responsável) o escondia. Revisão 10: o
     * 4º passe de Precisa de você a Bloqueado também é entrada (`pelosPasses`).
     */
    async entradasNaEspera(quadroId: string): Promise<MovimentoTarefa[]> {
      const rs = await conn<LinhaMovimento[]>`
        select distinct on (tarefa_id) ${conn.unsafe(COLUNAS_M)} from quadro_movimentos m
        where ${dona()} and quadro_id = ${quadroId} and desfeito_em is null
          and para in ('voce', 'bloqueado')
          and (de not in ('voce', 'bloqueado') or (tipo = 'nao_e_comigo' and para = 'bloqueado' and de <> 'bloqueado'))
          and exists (select 1 from quadro_tarefas t where t.tenant_id = m.tenant_id and t.id = m.tarefa_id and t.status in ('voce', 'bloqueado'))
        order by tarefa_id, criado_em desc, id desc`;
      return rs.map(paraMovimento);
    },
    /**
     * Revisão do PR #629: os acionamentos de cada tarefa na última hora, contados pelo relógio do banco (o freio lê).
     * Revisão 4: a conta zera no último freio que levou a Bloqueado (de <> para), o espelho de
     * `acionamentosNaHora` do domínio; o freio do comentário (de = para) não zera. Revisão 6: o freio desfeito também zera
     * (desfazê-lo não devolve os acionamentos de antes dele à conta).
     */
    async acionamentosNaHora(quadroId: string): Promise<Map<string, number>> {
      // ADA-232 (ADR-155): as retomadas das cadeias da tarefa também contam (o reacionamento sem saída, a volta da CI, a
      // resposta): cada uma acorda o bot de novo. Zeram no mesmo freio que zera os movimentos.
      const rs = await conn<{ tarefa_id: string; n: number }[]>`
        with recursive desce(tarefa_id, id, n) as (
          select e.tarefa_id, e.turno_id, 0 from quadro_execucoes e
          where ${dona()} and e.criado_em > clock_timestamp() - interval '1 day'
            and e.tarefa_id in (select id from quadro_tarefas where ${dona()} and quadro_id = ${quadroId})
          union all
          select d.tarefa_id, t.id, d.n + 1 from turnos t join desce d on t.tenant_id = ${escopo.tenantId} and t.retoma_turno_id = d.id where d.n < 50
        ),
        ultimo_freio as (
          select f.tarefa_id, max(f.criado_em) as em from quadro_movimentos f
          where ${dona()} and f.quadro_id = ${quadroId} and f.tipo = 'freio' and f.de <> f.para group by f.tarefa_id
        ),
        contas as (
          select m.tarefa_id, m.criado_em from quadro_movimentos m
          where ${dona()} and m.quadro_id = ${quadroId} and m.acionou and m.criado_em > clock_timestamp() - interval '1 hour'
          union all
          select d.tarefa_id, t.criado_em from desce d join turnos t on t.tenant_id = ${escopo.tenantId} and t.id = d.id
          where d.n > 0 and t.origem = 'retomada' and t.criado_em > clock_timestamp() - interval '1 hour'
        )
        select c.tarefa_id, count(*)::int as n from contas c left join ultimo_freio f on f.tarefa_id = c.tarefa_id
        where f.em is null or c.criado_em > f.em
        group by c.tarefa_id`;
      return new Map(rs.map((r) => [r.tarefa_id, r.n]));
    },
    /** Os últimos `porTarefa` movimentos de cada tarefa (o histórico discreto da tarefa aberta). */
    async ultimosMovimentos(quadroId: string, porTarefa: number): Promise<MovimentoTarefa[]> {
      // Por tarefa que ainda está no quadro, cada uma pelo índice da tarefa com LIMIT (revisão 2 do PR #629): o
      // histórico cresce sem fim, e a janela sobre o quadro inteiro lia tudo, inclusive o das tarefas excluídas.
      // Revisão 3 do PR #629: o teto vale à parte para os `acionou` (cada comentário que aciona grava um) e para o resto;
      // num teto só, 11 comentários de bot empurravam o último movimento de verdade para fora (sumia o Desfazer e o eco).
      // Revisão 4 do PR #629: os baldes se separam pelo critério de `mudouATarefa` (o mesmo de `ultimosDesfaziveis`), não
      // pelo tipo: o `freio` do comentário (de = para, mesma mão) não mudou nada e caía no balde dos movimentos.
      const rs = await conn<LinhaMovimento[]>`
        select m.* from (select id as tid from quadro_tarefas where ${dona()} and quadro_id = ${quadroId}) t
        cross join lateral (
          (select ${conn.unsafe(COLUNAS_M)} from quadro_movimentos
          where ${dona()} and quadro_id = ${quadroId} and tarefa_id = t.tid
            and tipo <> 'acionou' and (de is distinct from para or agente_antes is distinct from agente_depois)
          order by criado_em desc, id desc limit ${porTarefa})
          union all
          (select ${conn.unsafe(COLUNAS_M)} from quadro_movimentos
          where ${dona()} and quadro_id = ${quadroId} and tarefa_id = t.tid
            and not (tipo <> 'acionou' and (de is distinct from para or agente_antes is distinct from agente_depois))
          order by criado_em desc, id desc limit ${porTarefa})
        ) m order by m.criado_em desc, m.id desc`;
      return rs.map(paraMovimento);
    },
    async inserirMovimentos(quadroId: string, loteId: string | null, ms: readonly NovoMovimento[]): Promise<void> {
      for (const m of ms) {
        await conn`
          insert into quadro_movimentos (tenant_id, owner_id, quadro_id, tarefa_id, lote_id, tipo, de, para, agente_antes, agente_depois, autor, autor_agente_id, motivo, acionou, desfaz, de_fora)
          values (${escopo.tenantId}, ${escopo.pessoaId}, ${quadroId}, ${m.tarefaId}, ${loteId}, ${m.tipo}, ${m.de}, ${m.para}, ${m.agenteAntes}, ${m.agenteDepois},
            ${m.autor.tipo}, ${m.autor.tipo === "agente" ? m.autor.agenteId : null}, ${m.motivo}, ${m.acionou}, ${m.desfaz ?? null}, ${m.deFora === true})`;
      }
    },
    async marcarMovimentosDesfeitos(ids: readonly string[]): Promise<void> {
      if (ids.length === 0) return;
      await conn`update quadro_movimentos set desfeito_em = clock_timestamp() where ${dona()} and id = any(${conn.array([...ids])}::uuid[]) and desfeito_em is null`;
    },
    /** Revisão 5 do PR #629: os tipos dos movimentos do lote que ainda valem (o Desfazer do agente não leva laço nem freio). */
    /** Os movimentos que valem do lote, pelo que a regra "só a pessoa desfaz" lê (tipo, de, para; `paradaDaPessoa`). */
    async paradasVivasDoLote(loteId: string): Promise<Pick<MovimentoTarefa, "tipo" | "de" | "para">[]> {
      return conn<Pick<MovimentoTarefa, "tipo" | "de" | "para">[]>`select distinct tipo, de, para from quadro_movimentos where ${dona()} and lote_id = ${loteId} and desfeito_em is null`;
    },
    async desfazerMovimentosDoLote(loteId: string): Promise<void> {
      // O lote desfez um movimento (desfazer_movimento): desfazer o lote devolve aquele movimento ao jogo (revisão do PR #629).
      await conn`
        update quadro_movimentos set desfeito_em = null
        where ${dona()} and desfeito_em is not null and id in (
          select desfaz from quadro_movimentos where ${dona()} and lote_id = ${loteId} and desfaz is not null and desfeito_em is null)`;
      await conn`update quadro_movimentos set desfeito_em = clock_timestamp() where ${dona()} and lote_id = ${loteId} and desfeito_em is null`;
    },
    /**
     * Revisão 2 do PR #623: alguma tarefa entrou neste quadro ou saiu dele (mover_quadro) depois do lote? Aí o lote não se
     * desfaz: a foto dele não conhece a tarefa que chegou (o Desfazer a apagaria com o quadro, ou a deixaria fora das
     * colunas) nem volta por cima da que saiu. A linha `quadro` do histórico fica no quadro destino e leva a origem em `de`.
     */
    async mudouDeQuadroDepois(loteId: string, quadroId: string): Promise<boolean> {
      const [r] = await conn.unsafe<{ sim: boolean }[]>(SQL_MUDOU_DE_QUADRO_DEPOIS, [escopo.tenantId, escopo.pessoaId, quadroId, loteId]);
      return r?.sim === true;
    },
    async marcarDesfeito(id: string): Promise<boolean> {
      const r = await conn`update quadro_lotes set desfeito_em = clock_timestamp() where ${dona()} and id = ${id} and desfeito_em is null`;
      return r.count > 0;
    },

    /* NOD-416 (ADR-144): o código da tarefa e o histórico. */

    /** Serializa a escolha de prefixo da pessoa (dois quadros novos ao mesmo tempo não pegam o mesmo). Vale até o fim da transação. */
    async travarPrefixos(): Promise<void> {
      await conn`select pg_advisory_xact_lock(hashtextextended(${`quadro-prefixo:${escopo.tenantId}:${escopo.pessoaId}`}, 0))`;
    },
    /** Os prefixos que a pessoa já usa: os dos quadros e os dos códigos antigos (um link velho não muda de dono). */
    async prefixosUsados(): Promise<Set<string>> {
      const ls = await conn<{ prefixo: string }[]>`
        select prefixo from quadros where ${dona()} and prefixo is not null
        union select prefixo from quadro_tarefa_codigos where ${dona()}`;
      return new Set(ls.map((l) => l.prefixo));
    },
    /** Outro quadro da pessoa já usa o prefixo (o Desfazer da importação só devolve o prefixo antigo se estiver livre). */
    async prefixoDeOutroQuadro(quadroId: string, prefixo: string): Promise<boolean> {
      const [l] = await conn`select 1 from quadros where ${dona()} and prefixo = ${prefixo} and id <> ${quadroId} limit 1`;
      return !!l;
    },
    /** Os números já reservados com o prefixo (códigos atuais e antigos, de qualquer tarefa): a importação não os reusa. */
    async numerosReservados(prefixo: string): Promise<number[]> {
      const ls = await conn<{ numero: number }[]>`select numero from quadro_tarefa_codigos where ${dona()} and prefixo = ${prefixo}`;
      return ls.map((l) => l.numero);
    },
    async definirPrefixo(quadroId: string, prefixo: string): Promise<void> {
      await conn`update quadros set prefixo = ${prefixo} where ${dona()} and id = ${quadroId} and prefixo is null`;
    },
    /** Reserva `n` números seguidos no quadro (sob a trava do quadro) e devolve o primeiro. */
    async reservarNumeros(quadroId: string, n: number): Promise<number> {
      const [l] = await conn<{ primeiro: number }[]>`
        update quadros set proximo_numero = proximo_numero + ${n} where ${dona()} and id = ${quadroId} returning proximo_numero - ${n} as primeiro`;
      return l!.primeiro;
    },
    async numerarTarefa(id: string, numero: number): Promise<void> {
      await conn`update quadro_tarefas set numero = ${numero} where ${dona()} and id = ${id}`;
    },
    /** Guarda o código (o atual e, depois de mudar de quadro, os antigos). Repetido não faz nada. Devolve os que entraram. */
    async guardarCodigos(cs: readonly { prefixo: string; numero: number; tarefaId: string }[]): Promise<{ prefixo: string; numero: number; tarefaId: string }[]> {
      if (cs.length === 0) return [];
      const ls = await conn<{ prefixo: string; numero: number; tarefa_id: string }[]>`
        insert into quadro_tarefa_codigos (tenant_id, owner_id, prefixo, numero, tarefa_id)
        select ${escopo.tenantId}, ${escopo.pessoaId}, c.prefixo, c.numero, c.tarefa_id
          from unnest(${conn.array(cs.map((c) => c.prefixo))}::text[], ${conn.array(cs.map((c) => c.numero))}::int[], ${conn.array(cs.map((c) => c.tarefaId))}::uuid[])
            as c(prefixo, numero, tarefa_id)
        on conflict (tenant_id, owner_id, prefixo, numero) do nothing
        returning prefixo, numero, tarefa_id`;
      return ls.map((l) => ({ prefixo: l.prefixo, numero: l.numero, tarefaId: l.tarefa_id }));
    },
    /** Apaga exatamente esses códigos (o par prefixo/número da mesma tarefa): o Desfazer da importação que os guardou. */
    async apagarCodigos(cs: readonly { prefixo: string; numero: number; tarefaId: string }[]): Promise<void> {
      if (cs.length === 0) return;
      await conn`delete from quadro_tarefa_codigos c using unnest(${conn.array(cs.map((x) => x.prefixo))}::text[], ${conn.array(cs.map((x) => x.numero))}::int[], ${conn.array(cs.map((x) => x.tarefaId))}::uuid[]) as x(prefixo, numero, tarefa_id)
        where c.tenant_id = ${escopo.tenantId} and c.owner_id = ${escopo.pessoaId} and c.prefixo = x.prefixo and c.numero = x.numero and c.tarefa_id = x.tarefa_id`;
    },
    /** A tarefa dona do código (atual ou antigo), ou null. */
    async tarefaDoCodigo(prefixo: string, numero: number): Promise<string | null> {
      const [l] = await conn<{ tarefa_id: string }[]>`
        select tarefa_id from quadro_tarefa_codigos where ${dona()} and prefixo = ${prefixo} and numero = ${numero}`;
      return l?.tarefa_id ?? null;
    },
    /** O número que a tarefa já teve com este prefixo (volta ao quadro de antes = o mesmo código). */
    async numeroAntigo(tarefaId: string, prefixo: string): Promise<number | null> {
      const [l] = await conn<{ numero: number }[]>`
        select numero from quadro_tarefa_codigos where ${dona()} and tarefa_id = ${tarefaId} and prefixo = ${prefixo} order by criado_em limit 1`;
      return l?.numero ?? null;
    },
    /** Muda a tarefa de quadro (o resto dela fica). */
    async moverTarefa(id: string, c: { quadroId: string; status: IdColuna; voltarPara: IdColuna | null; ordem: number; numero: number; terminadaEm: number | null }): Promise<TarefaQuadro | null> {
      // 0161: as labels são por quadro. A tarefa leva as dela pelo nome: a que falta no destino nasce lá, com a mesma cor.
      await conn`
        insert into quadro_labels (tenant_id, owner_id, quadro_id, nome, cor)
        select o.tenant_id, o.owner_id, ${c.quadroId}, o.nome, o.cor from quadro_labels o
        where o.tenant_id = ${escopo.tenantId} and o.owner_id = ${escopo.pessoaId}
          and o.id = any(select unnest(label_ids) from quadro_tarefas where ${dona()} and id = ${id})
        on conflict (tenant_id, quadro_id, (lower(nome))) do nothing`;
      const [l] = await conn<LinhaTarefa[]>`
        update quadro_tarefas set quadro_id = ${c.quadroId}, status = ${c.status}, voltar_para = ${c.voltarPara}, ordem = ${c.ordem}, numero = ${c.numero},
          terminada_em = ${c.terminadaEm === null ? null : new Date(c.terminadaEm)}, mudado_em = clock_timestamp(),
          label_ids = array(select d.id from quadro_labels o join quadro_labels d on d.tenant_id = o.tenant_id and d.owner_id = o.owner_id and d.quadro_id = ${c.quadroId} and lower(d.nome) = lower(o.nome)
                            where o.tenant_id = ${escopo.tenantId} and o.owner_id = ${escopo.pessoaId} and o.id = any(quadro_tarefas.label_ids))
        where ${dona()} and id = ${id}
        returning ${conn.unsafe(COLUNAS_T)}`;
      if (!l) return null;
      // Revisão 7 do PR #623: os comentários (0138) vão com a tarefa. Senão a FK com ON DELETE CASCADE para o quadro de
      // origem os apagava quando esse quadro fosse removido, e a tarefa perdia a conversa no quadro novo.
      await conn`update quadro_comentarios set quadro_id = ${c.quadroId}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and tarefa_id = ${id}`;
      // Merge da main (NOD-421) no PR #623: os PRs ligados e as linhas de sistema (0142) já seguem a tarefa (a leitura é
      // por tarefa_id e a FK é para a tarefa); o quadro_id delas acompanha para não ficar apontando a origem.
      await conn`update quadro_tarefa_prs set quadro_id = ${c.quadroId} where ${dona()} and tarefa_id = ${id}`;
      await conn`update quadro_tarefa_linhas set quadro_id = ${c.quadroId} where ${dona()} and tarefa_id = ${id}`;
      return paraTarefa(l);
    },
    /** As mudanças de um lote, num INSERT só. */
    async registrarHistorico(quadroId: string, ms_: readonly MudancaTarefa[], loteId: string | null): Promise<void> {
      if (ms_.length === 0) return;
      const autorAgente = (m: MudancaTarefa) => (m.autor.tipo === "agente" ? m.autor.agenteId : null);
      await conn`
        insert into quadro_tarefa_historico (tenant_id, owner_id, tarefa_id, quadro_id, campo, de, para, autor, autor_agente_id, lote_id, mensagem_id, criado_em)
        select ${escopo.tenantId}, ${escopo.pessoaId}, h.tarefa_id, ${quadroId}, h.campo, x.de, x.para, h.autor, x.autor_agente_id, ${loteId}, x.mensagem_id,
               clock_timestamp() + (h.ord * interval '1 microsecond')
          from unnest(${conn.array(ms_.map((m) => m.tarefaId))}::uuid[], ${conn.array(ms_.map((m) => m.campo))}::text[],
                      ${conn.array(ms_.map((m) => m.de ?? ""))}::text[], ${conn.array(ms_.map((m) => m.para ?? ""))}::text[],
                      ${conn.array(ms_.map((m) => m.autor.tipo))}::text[], ${conn.array(ms_.map((m) => autorAgente(m) ?? ""))}::text[],
                      ${conn.array(ms_.map((m) => m.mensagemId ?? ""))}::text[])
            with ordinality as h(tarefa_id, campo, de_, para_, autor, autor_agente_, mensagem_, ord)
          cross join lateral (select nullif(h.de_, '') as de, nullif(h.para_, '') as para, nullif(h.autor_agente_, '')::uuid as autor_agente_id, nullif(h.mensagem_, '')::uuid as mensagem_id) x`;
    },
    /**
     * ADA-15, revisão do PR #696: das falas do turno, as que já autorizaram um passo `pela_fala` em cada tarefa (o
     * `mensagem_id` do histórico). Uma fala vale um passo por tarefa.
     */
    async falasUsadas(tarefaIds: readonly string[], mensagemIds: readonly string[]): Promise<{ tarefaId: string; mensagemId: string }[]> {
      if (tarefaIds.length === 0 || mensagemIds.length === 0) return [];
      const ls = await conn<{ tarefa_id: string; mensagem_id: string }[]>`
        select distinct tarefa_id, mensagem_id from quadro_tarefa_historico
        where ${dona()} and tarefa_id = any(${conn.array([...tarefaIds])}::uuid[]) and mensagem_id = any(${conn.array([...mensagemIds])}::uuid[])`;
      return ls.map((l) => ({ tarefaId: l.tarefa_id, mensagemId: l.mensagem_id }));
    },
    /** O histórico da tarefa, mais antigo primeiro (até 200 linhas, as mais recentes). */
    /** `quadroId` = o quadro em que a mudança foi registrada (no mover, o destino; a origem vai em `de` da linha `quadro`). */
    /** `pedidoPor`: quem pediu o lote da mudança (quem participa do quadro, NOD-443); null = a dona ou sem lote. */
    async historico(tarefaId: string): Promise<{ id: string; quadroId: string; campo: CampoHistorico; de: string | null; para: string | null; autor: "pessoa" | "agente" | "regra"; autorAgenteId: string | null; criadoEm: number; pedidoPor: string | null }[]> {
      const ls = await conn<{ id: string; quadro_id: string; campo: CampoHistorico; de: string | null; para: string | null; autor: "pessoa" | "agente" | "regra"; autor_agente_id: string | null; criado_em: Date; pedido_por: string | null }[]>`
        select h.*, l.pedido_por from (
          select id, quadro_id, campo, de, para, autor, autor_agente_id, criado_em, lote_id from quadro_tarefa_historico
          where ${dona()} and tarefa_id = ${tarefaId} order by criado_em desc, id desc limit 200
        ) h left join quadro_lotes l on l.tenant_id = ${escopo.tenantId} and l.owner_id = ${escopo.pessoaId} and l.id = h.lote_id
        order by h.criado_em, h.id`;
      return ls.map((l) => ({ id: l.id, quadroId: l.quadro_id, campo: l.campo, de: l.de, para: l.para, autor: l.autor, autorAgenteId: l.autor_agente_id, criadoEm: ms(l.criado_em), pedidoPor: l.pedido_por }));
    },
    /* NOD-443 (ADR-143): as pessoas do quadro, o modo, o mural e os comentários. */

    /** Os lotes do quadro, mais recente primeiro (o mural de Atividade). */
    async lotes(quadroId: string, limite = 300): Promise<LoteQuadro[]> {
      const ls = await conn<LinhaLote[]>`select ${conn.unsafe(COLUNAS_L)} from quadro_lotes where ${dona()} and quadro_id = ${quadroId} order by criado_em desc, id desc limit ${limite}`;
      return ls.map((l) => { const { antes: _a, ...lote } = paraLote(l); return lote; });
    },
    async mudarModo(quadroId: string, modo: ModoConversa): Promise<void> {
      await conn`update quadros set modo_conversa = ${modo}, atualizado_em = clock_timestamp() where ${dona()} and id = ${quadroId}`;
    },
    /** Quem participa do quadro (no escopo da dona), mais antigo primeiro, com o nome do catálogo de pessoas. */
    async membros(quadroId: string): Promise<{ pessoaId: string; nome: string; adicionadoEm: number }[]> {
      const ls = await conn<{ pessoa_id: string; nome: string | null; adicionado_em: Date }[]>`
        select m.pessoa_id, p.nome, m.adicionado_em from quadro_membros m
          left join pessoas p on p.tenant_id = m.tenant_id and p.id = m.pessoa_id
        where m.tenant_id = ${escopo.tenantId} and m.owner_id = ${escopo.pessoaId} and m.quadro_id = ${quadroId}
        order by m.adicionado_em, m.id`;
      return ls.map((l) => ({ pessoaId: l.pessoa_id, nome: l.nome ?? "", adicionadoEm: ms(l.adicionado_em) }));
    },
    /** A pessoa ainda participa (conferido de novo no escopo da dona, ADR-143 §1). */
    async ehMembro(quadroId: string, pessoaId: string): Promise<boolean> {
      const [l] = await conn`select 1 from quadro_membros where ${dona()} and quadro_id = ${quadroId} and pessoa_id = ${pessoaId}`;
      return !!l;
    },
    /** false = já estava. */
    async adicionarMembro(quadroId: string, pessoaId: string): Promise<boolean> {
      const r = await conn`
        insert into quadro_membros (tenant_id, owner_id, quadro_id, pessoa_id) values (${escopo.tenantId}, ${escopo.pessoaId}, ${quadroId}, ${pessoaId})
        on conflict (tenant_id, quadro_id, pessoa_id) do nothing`;
      return r.count > 0;
    },
    async tirarMembro(quadroId: string, pessoaId: string): Promise<boolean> {
      const r = await conn`delete from quadro_membros where ${dona()} and quadro_id = ${quadroId} and pessoa_id = ${pessoaId}`;
      return r.count > 0;
    },
    /**
     * Os quadros de outras pessoas em que EU participo: a perna da 0146 deixa ler só a minha linha (pessoa_id = eu). Não
     * lê nada do quadro em si (é da dona); o caso de uso entra pela porta da dona.
     */
    async participacoes(): Promise<{ quadroId: string; donaId: string }[]> {
      const ls = await conn<{ quadro_id: string; owner_id: string }[]>`
        select quadro_id, owner_id from quadro_membros where tenant_id = ${escopo.tenantId} and pessoa_id = ${escopo.pessoaId} order by adicionado_em, id`;
      return ls.map((l) => ({ quadroId: l.quadro_id, donaId: l.owner_id }));
    },
    // 0161: o catálogo de labels do quadro (na ordem de criação).
    async labels(quadroId: string): Promise<LabelQuadro[]> {
      const ls = await conn<{ id: string; quadro_id: string; nome: string; cor: CorLabel; criado_em: Date }[]>`
        select id, quadro_id, nome, cor, criado_em from quadro_labels where ${dona()} and quadro_id = ${quadroId} order by criado_em, id`;
      return ls.map((l) => ({ id: l.id, quadroId: l.quadro_id, nome: l.nome, cor: l.cor, criadoEm: ms(l.criado_em) }));
    },
    /** Grava as labels novas com o id que o domínio já deu (o lote aponta para elas antes de gravar). */
    async inserirLabels(quadroId: string, ls: readonly { id: string; nome: string; cor: CorLabel }[]): Promise<void> {
      for (const l of ls) {
        await conn`insert into quadro_labels (tenant_id, owner_id, id, quadro_id, nome, cor) values (${escopo.tenantId}, ${escopo.pessoaId}, ${l.id}, ${quadroId}, ${l.nome}, ${l.cor})`;
      }
    },
    async editarLabel(quadroId: string, id: string, c: { nome?: string; cor?: CorLabel }): Promise<boolean> {
      const r = await conn`update quadro_labels set nome = coalesce(${c.nome ?? null}, nome), cor = coalesce(${c.cor ?? null}, cor)
        where ${dona()} and quadro_id = ${quadroId} and id = ${id}`;
      return r.count > 0;
    },
    /** Tira a label do catálogo e de toda tarefa do quadro que a tinha (sem mexer no mudado_em: não é trabalho na tarefa). */
    async removerLabel(quadroId: string, id: string): Promise<boolean> {
      await conn`update quadro_tarefas set label_ids = array_remove(label_ids, ${id}::uuid) where ${dona()} and quadro_id = ${quadroId} and ${id}::uuid = any(label_ids)`;
      const r = await conn`delete from quadro_labels where ${dona()} and quadro_id = ${quadroId} and id = ${id}`;
      return r.count > 0;
    },
    async comentar(c: { quadroId: string; tarefaId: string | null; texto: string; pedidoPor: string | null; viaAgenteId: string | null; viaNome: string | null; deFora: boolean }): Promise<{ id: string; criadoEm: number }> {
      const [l] = await conn<{ id: string; criado_em: Date }[]>`
        insert into quadro_tarefa_comentarios (tenant_id, owner_id, quadro_id, tarefa_id, texto, pedido_por, via_agente_id, via_nome, de_fora)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${c.quadroId}, ${c.tarefaId}, ${c.texto}, ${c.pedidoPor}, ${c.viaAgenteId}, ${c.viaNome}, ${c.deFora})
        returning id, criado_em`;
      return { id: l!.id, criadoEm: ms(l!.criado_em) };
    },
    /**
     * Quantos comentários a pessoa deixou na tarefa (null = no quadro, sem tarefa): o teto de LIMITES_QUADRO. Sem pessoa
     * (`pedidoPor` null: o bot da dona sob a procuração de quem participa), os do bot `viaAgenteId` sem pessoa.
     */
    async contarComentarios(quadroId: string, tarefaId: string | null, pedidoPor: string | null, viaAgenteId: string | null = null): Promise<number> {
      const quem = pedidoPor !== null ? conn`pedido_por = ${pedidoPor}` : conn`pedido_por is null and via_agente_id is not distinct from ${viaAgenteId}::uuid`;
      const [l] = await conn<{ n: number }[]>`
        select count(*)::int as n from quadro_tarefa_comentarios
        where ${dona()} and quadro_id = ${quadroId} and tarefa_id is not distinct from ${tarefaId}::uuid and ${quem}`;
      return l?.n ?? 0;
    },
    async comentarios(quadroId: string, limite = 100): Promise<{ id: string; tarefaId: string | null; texto: string; pedidoPor: string | null; viaNome: string | null; deFora: boolean; criadoEm: number }[]> {
      const ls = await conn<{ id: string; tarefa_id: string | null; texto: string; pedido_por: string | null; via_nome: string | null; de_fora: boolean; criado_em: Date }[]>`
        select id, tarefa_id, texto, pedido_por, via_nome, de_fora, criado_em from quadro_tarefa_comentarios
        where ${dona()} and quadro_id = ${quadroId} order by criado_em desc, id desc limit ${limite}`;
      return ls.map((l) => ({ id: l.id, tarefaId: l.tarefa_id, texto: l.texto, pedidoPor: l.pedido_por, viaNome: l.via_nome, deFora: l.de_fora, criadoEm: ms(l.criado_em) }));
    },
    /** Vários quadros da pessoa numa leitura só (o de bot excluído também: o histórico ainda o cita). */
    async buscarVarios(ids: readonly string[]): Promise<Quadro[]> {
      if (ids.length === 0) return [];
      const ls = await conn<LinhaQuadro[]>`select ${conn.unsafe(COLUNAS_Q)} from quadros where ${dona()} and id = any(${conn.array([...ids])}::uuid[])`;
      return ls.map(paraQuadro);
    },
    /** A tarefa que o Desfazer apagou (o lote a criou): o código e o histórico dela saem junto. */
    async apagarCodigosEHistorico(tarefaIds: readonly string[]): Promise<void> {
      if (tarefaIds.length === 0) return;
      await conn`delete from quadro_tarefa_codigos where ${dona()} and tarefa_id = any(${conn.array([...tarefaIds])}::uuid[])`;
      await conn`delete from quadro_tarefa_historico where ${dona()} and tarefa_id = any(${conn.array([...tarefaIds])}::uuid[])`;
    },
    /**
     * Remover o quadro (ou desfazer o lote que o criou): o histórico das tarefas sai (elas vão no CASCADE), e os códigos
     * FICAM, sem tarefa (revisão 5 do PR #623). Eles reservam o prefixo (`prefixosUsados`) e o número: um quadro novo não
     * pega o mesmo prefixo, e o link velho dá "não encontrada" em vez de abrir outra tarefa.
     */
    async apagarHistorico(tarefaIds: readonly string[]): Promise<void> {
      if (tarefaIds.length === 0) return;
      await conn`delete from quadro_tarefa_historico where ${dona()} and tarefa_id = any(${conn.array([...tarefaIds])}::uuid[])`;
    },
    /**
     * NOD-421 (0142): os PRs ligados às tarefas do quadro, no último estado visto. Lê pelas tarefas que estão no quadro
     * agora (revisão do PR #621): a tarefa que mudou de quadro leva os PRs junto, sem "PR ligado" de novo.
     */
    /**
     * ADA-232: o PR já sincronizado pelo laço de PRs (estado, CI e quando o laço gravou a última transição), pela url;
     * null = ainda não visto. A mesma url em duas tarefas: vale a linha vista por último.
     */
    async prPorUrl(url: string): Promise<(Pick<PrDaTarefa, "estado" | "ci" | "conflito"> & { vistoEm: number }) | null> {
      const [l] = await conn<{ estado: PrDaTarefa["estado"]; ci: PrDaTarefa["ci"]; conflito: boolean; visto_em: Date }[]>`
        select estado, ci, conflito, visto_em from quadro_tarefa_prs where ${dona()} and url = ${url} order by visto_em desc limit 1`;
      return l ? { estado: l.estado, ci: l.ci, conflito: l.conflito, vistoEm: ms(l.visto_em) } : null;
    },
    /**
     * ADA-232 (revisão do PR #705): a tarefa ganhou ou trocou de PR desde `desde`. O pr_url não entra no histórico da tarefa:
     * lê a foto de antes dos lotes desde então (o gerir_quadro, a tela) e o PR que o laço ligou desde então.
     */
    async prMudouDesde(quadroId: string, tarefaId: string, prAgora: string | null, desde: number): Promise<boolean> {
      const [l] = await conn<{ sim: boolean }[]>`
        select exists (
            select 1 from quadro_lotes l cross join lateral jsonb_array_elements(l.antes->'tarefas') x
            where l.tenant_id = ${escopo.tenantId} and l.owner_id = ${escopo.pessoaId} and l.quadro_id = ${quadroId}
              and ${tarefaId}::uuid = any(l.tarefa_ids) and l.criado_em >= ${new Date(desde)} and l.desfeito_em is null
              and x->>'id' = ${tarefaId} and (x->'antes'->>'prUrl') is distinct from ${prAgora}::text
          ) or exists (
            select 1 from quadro_tarefa_prs where ${dona()} and tarefa_id = ${tarefaId} and criado_em >= ${new Date(desde)}
          ) as sim`;
      return l?.sim === true;
    },
    async prsDoQuadro(quadroId: string): Promise<(PrDaTarefa & { tarefaId: string; mergePendente: boolean })[]> {
      const ls = await conn<LinhaPr[]>`
        select tarefa_id, repo, numero, url, branch, estado, ci, conflito, merge_pendente from quadro_tarefa_prs
        where ${dona()} and tarefa_id in (select id from quadro_tarefas where ${dona()} and quadro_id = ${quadroId}) order by repo, numero`;
      return ls.map((l) => ({ tarefaId: l.tarefa_id, repo: l.repo, numero: l.numero, url: l.url, branch: l.branch, estado: l.estado, ci: l.ci, conflito: l.conflito, mergePendente: l.merge_pendente }));
    },
    /** 4ª revisão do PR #621: o merge pendente da tarefa (fimDosPrs), o mesmo valor em todos os PRs dela. */
    async definirMergePendente(tarefaId: string, pendente: boolean): Promise<void> {
      await conn`update quadro_tarefa_prs set merge_pendente = ${pendente} where ${dona()} and tarefa_id = ${tarefaId} and merge_pendente is distinct from ${pendente}`;
    },
    /**
     * 2ª revisão do PR #621: insert … select da tarefa da DONA. O RLS do insert só confere o owner da linha nova e a FK
     * não passa pelo RLS: com `values`, a Ana gravava um PR na tarefa do Marlon. Tarefa que não é dela = nada (false).
     */
    async salvarPr(quadroId: string, tarefaId: string, p: PrDaTarefa): Promise<boolean> {
      const r = await conn`
        insert into quadro_tarefa_prs (tenant_id, owner_id, quadro_id, tarefa_id, repo, numero, url, branch, estado, ci, conflito)
        select ${escopo.tenantId}, ${escopo.pessoaId}, ${quadroId}, id, ${p.repo}, ${p.numero}, ${p.url}, ${p.branch}, ${p.estado}, ${p.ci}, ${p.conflito}
        from quadro_tarefas where ${dona()} and id = ${tarefaId}
        on conflict (tenant_id, tarefa_id, repo, numero) do update set quadro_id = excluded.quadro_id, url = excluded.url, branch = excluded.branch,
          estado = excluded.estado, ci = excluded.ci, conflito = excluded.conflito, visto_em = clock_timestamp()`;
      return r.count > 0;
    },
    /** O card e o resumo da meta leem pr_url: sem PR gravado, o primeiro PR ligado entra (não mexe no mudado_em). */
    async definirPrUrlSeVazio(tarefaId: string, url: string): Promise<boolean> {
      const r = await conn`update quadro_tarefas set pr_url = ${url} where ${dona()} and id = ${tarefaId} and pr_url is null`;
      return r.count > 0;
    },
    /** Como salvarPr: só na tarefa da dona (false = a tarefa não é dela, nada gravado). */
    async inserirLinha(quadroId: string, tarefaId: string, l: { tipo: TipoLinhaTarefa; texto: string; dados: object }): Promise<boolean> {
      const r = await conn`
        insert into quadro_tarefa_linhas (tenant_id, owner_id, quadro_id, tarefa_id, tipo, texto, dados)
        select ${escopo.tenantId}, ${escopo.pessoaId}, ${quadroId}, id, ${l.tipo}, ${l.texto}, ${jsonb(conn, l.dados)}
        from quadro_tarefas where ${dona()} and id = ${tarefaId}`;
      return r.count > 0;
    },
    /** NOD-421 (revisão do PR #621): o aviso do GitHub no topo do quadro (null = nada a avisar). */
    async avisoGithub(quadroId: string): Promise<string | null> {
      const [l] = await conn<{ aviso_github: string | null }[]>`select aviso_github from quadros where ${dona()} and id = ${quadroId}`;
      return l?.aviso_github ?? null;
    },
    /** Grava só se mudou (true = mudou): o aviso aparece uma vez até mudar. Não mexe no atualizado_em do quadro. */
    async definirAvisoGithub(quadroId: string, aviso: string | null): Promise<boolean> {
      const r = await conn`update quadros set aviso_github = ${aviso} where ${dona()} and id = ${quadroId} and aviso_github is distinct from ${aviso}`;
      return r.count > 0;
    },
    /** As linhas de sistema das tarefas do quadro (as da tarefa, mesmo de antes de ela mudar de quadro): as `porTarefa` mais recentes de cada, da mais antiga para a mais nova. */
    async linhasDoQuadro(quadroId: string, porTarefa = 20): Promise<(LinhaDeSistema & { tarefaId: string })[]> {
      const ls = await conn<{ tarefa_id: string; tipo: TipoLinhaTarefa; texto: string; criado_em: Date }[]>`
        select tarefa_id, tipo, texto, criado_em from (
          select tarefa_id, tipo, texto, criado_em, row_number() over (partition by tarefa_id order by criado_em desc, id desc) as n
          from quadro_tarefa_linhas where ${dona()} and tarefa_id in (select id from quadro_tarefas where ${dona()} and quadro_id = ${quadroId})
        ) x where n <= ${porTarefa} order by criado_em, tarefa_id`;
      return ls.map((l) => ({ tarefaId: l.tarefa_id, tipo: l.tipo, texto: l.texto, criadoEm: ms(l.criado_em) }));
    },
  };
  return r;
}

interface LinhaPr {
  tarefa_id: string;
  repo: string;
  numero: number;
  url: string;
  branch: string;
  estado: PrDaTarefa["estado"];
  ci: PrDaTarefa["ci"];
  conflito: boolean;
  merge_pendente: boolean;
}
