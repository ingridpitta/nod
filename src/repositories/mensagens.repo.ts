import type { RecusasMidia } from "../contracts/anexo.ts";
import type { ArquivoDoCheckpoint, EstadoCheckpoint, FalhaDesfazer, ResultadoGuardado } from "../contracts/checkpoint.ts";
import { FOLGA_TRECHO, JANELA_TRECHO } from "../contracts/busca.ts";
import type { Autoria } from "../contracts/evento.ts";
import type { Assunto, Destino } from "../contracts/destino-no-chat.ts";
import type { Confianca, KindMensagem, Mensagem, PayloadMensagem } from "../contracts/mensagem.ts";
import type { PedidoDeColega } from "../contracts/troca-entre-bots.ts";
import type { MotivoRecomeco, OrigemTurno } from "../contracts/turno.ts";
import { assuntoNaLeitura } from "../domain/assunto-do-texto.ts";
import { ASSUNTOS_ANEXO, ASSUNTOS_ATIVIDADE, assuntoDe, assuntoNoBastidor, destinoDe } from "../domain/destino-no-chat.ts";
import { tarefaCasaLigada } from "../shared/tarefa-casa.ts";
import { codigoDaTarefa } from "../domain/codigo-tarefa.ts";
import type { Conn, Escopo, Tx } from "../shared/types.ts";
import { PRAZO_DESFAZENDO_MS, RETEM_MS } from "../domain/checkpoints.ts";
import { checkpointDaFala } from "./checkpoints.repo.ts";
import { data, ms } from "./conversao.ts";

export interface LinhaMensagem {
  tenant_id: string;
  id: string;
  conversa_id: string;
  turno_id: string | null;
  autor_tipo: Autoria["autor_tipo"];
  autor_id: string;
  sob_procuracao_de: string | null;
  conta_de_execucao: string;
  executor: Autoria["executor"];
  locality: Autoria["locality"];
  locality_reason: Autoria["locality_reason"];
  machine_id: string | null;
  decidido_por: Autoria["decidido_por"];
  regra_versao: number;
  kind: KindMensagem;
  texto: string;
  payload: PayloadMensagem | null;
  confianca: Confianca;
  parcial: boolean;
  criado_em: Date;
  /** 0091 (chat limpo): o que a mensagem é; null = fala ou linha sem backfill. Fica no servidor: a web recebe o destino. */
  assunto: string | null;
}

/** NOD-380: uma linha da busca de mensagens (`buscarTexto`), com o instante em texto de µs para o cursor. */
export interface LinhaAchada {
  id: string;
  conversa_id: string;
  conversa_tipo: "propria" | "sala";
  agente_id: string | null;
  sala_id: string | null;
  autor_tipo: Autoria["autor_tipo"];
  autor_id: string;
  /** Só a janela de até JANELA_TRECHO caracteres em volta do acerto, com os espaços juntados. */
  texto: string;
  /** Se a janela deixou texto de fora antes ou depois (a web mostra "…"). */
  cortado_inicio: boolean;
  cortado_fim: boolean;
  criado_em_txt: string;
}

/** ADA-15: uma fala da pessoa que pode autorizar um passo do quadro. */
export type FalaDaPessoa = { id: string; conversaId: string; texto: string; criadoEm: number };

export const COLUNAS_MENSAGEM =
  "tenant_id, id, conversa_id, turno_id, autor_tipo, autor_id, sob_procuracao_de, conta_de_execucao, executor, locality, locality_reason, machine_id, decidido_por, regra_versao, kind, texto, payload, confianca, parcial, criado_em, assunto";

export function paraMensagem(l: LinhaMensagem): Mensagem {
  return {
    tenantId: l.tenant_id,
    id: l.id,
    conversaId: l.conversa_id,
    turnoId: l.turno_id,
    autoria: {
      autor_tipo: l.autor_tipo,
      autor_id: l.autor_id,
      sob_procuracao_de: l.sob_procuracao_de,
      conta_de_execucao: l.conta_de_execucao,
      executor: l.executor,
      locality: l.locality,
      locality_reason: l.locality_reason,
      machine_id: l.machine_id,
      decidido_por: l.decidido_por,
      regra_versao: l.regra_versao,
    },
    kind: l.kind,
    texto: l.texto,
    payload: l.payload,
    confianca: l.confianca,
    parcial: l.parcial,
    criadoEm: ms(l.criado_em),
  };
}

type BaseNovaMensagem = {
  id?: string;
  conversaId: string;
  turnoId?: string | null;
  autoria: Autoria;
  texto: string;
  /** NOT NULL no banco (ADR-026): quem grava DECLARA a confiança do conteúdo. */
  confianca: Confianca;
  parcial?: boolean;
  /**
   * Chave de idempotência do envio da pessoa (definido em 2026-10-06, NOD-156). Com ela, o insert vira
   * `on conflict do nothing` no índice único parcial da 0057 e devolve `null` se a chave já existe na conversa.
   */
  idEnvio?: string;
};

/** Os kinds em que, sem payload, só quem grava sabe o que a linha é: o aviso de sistema e o recibo automático. */
type KindQueEscolheAssunto = "sistema" | "resultado_aprovacao";

/**
 * definido em 2026-10-18 (chat limpo, PR 1; ADR-114, decisão 9): `sistema` e `resultado_aprovacao` sem payload EXIGEM o
 * `assunto` no tipo — o compilador obriga cada produtor a escolher, sem padrão implícito (um aviso novo que devia ficar
 * no chat não cai na Atividade em silêncio). Com payload, o assunto sai do payload e da autoria (assuntoDe) e o
 * `assunto` dado é ignorado; o terceiro ramo é o do payload condicional (`...(x ? { payload } : {})`).
 */
export type NovaMensagem =
  | (BaseNovaMensagem & { kind: Exclude<KindMensagem, KindQueEscolheAssunto>; payload?: PayloadMensagem | null; assunto?: Assunto })
  | (BaseNovaMensagem & { kind: KindQueEscolheAssunto; payload: PayloadMensagem; assunto?: Assunto })
  | (BaseNovaMensagem & { kind: KindMensagem; payload?: PayloadMensagem | null; assunto: Assunto });

/**
 * ADA-28 (ADR-159): o assunto que vai para o insert. Com a flag ligada e um assunto que tem variante de bastidor
 * (`seBastidor`), o próprio insert escolhe pela marca do turno (`turnos.bastidores`, ADR-130) — sem leitura a mais no
 * caminho comum: sem variante ou sem turno, o valor puro. Linha antiga não muda (S6).
 */
function assuntoGravado(conn: Conn, tenantId: string, m: NovaMensagem) {
  const assunto = assuntoDaNova(m);
  const variante = assuntoNoBastidor(assunto);
  if (!tarefaCasaLigada() || !m.turnoId || variante === assunto) return conn`${assunto}`;
  return conn`(case when exists (select 1 from turnos tb where tb.tenant_id = ${tenantId} and tb.id = ${m.turnoId} and tb.bastidores) then ${variante}::text else ${assunto}::text end)`;
}

/** O assunto gravado: o do payload quando há; senão o que o produtor escolheu; senão o do kind (fala = null). */
export function assuntoDaNova(m: { kind: KindMensagem; payload?: PayloadMensagem | null; autoria: Pick<Autoria, "decidido_por">; assunto?: Assunto }): Assunto | null {
  const payload = m.payload ?? null;
  if (payload) return assuntoDe(m.kind, payload, m.autoria);
  return m.assunto ?? assuntoDe(m.kind, null, m.autoria);
}

/** A linha lida com o turno (ADR-083, S2): a origem do turno, o trabalho e se é a última fala de um turno encerrado. */
type LinhaComTurno = LinhaMensagem & { midia_recusas?: RecusasMidia | null; turno_origem: OrigemTurno | null; turno_bastidores?: boolean | null; turno_criado_em?: Date | null; trabalho_id: string | null; fim_do_turno: boolean | null; raiz_id: string | null; raiz_origem: OrigemTurno | null; motivo_recomeco?: MotivoRecomeco | null; primeira?: boolean | null; frente_de_lote: boolean | null } & LinhaDoCheckpoint & LinhaDaTarefa;
/** ADA-28 (ADR-159): a tarefa do turno que gravou a linha (left join; só com NOD_TAREFA_CASA=1). */
type LinhaDaTarefa = { tq_id?: string | null; tq_quadro_id?: string | null; tq_numero?: number | null; tq_linear_id?: string | null; tq_prefixo?: string | null };
/** NOD-54 (0120): o checkpoint da fala (left join; nulo sem checkpoint ou vencido). */
type LinhaDoCheckpoint = { ck_estado?: EstadoCheckpoint | null; ck_arquivos?: ArquivoDoCheckpoint[] | null; ck_total?: number | null; ck_feitos?: number | null; ck_desfeito_em?: Date | null; ck_resultado?: ResultadoGuardado | null; ck_falha?: FalhaDesfazer | null };

/**
 * definido em 2026-10-18 (chat limpo, PR 2): teto dos `anexo` que a janela traz desde o corte (o plano, 1b). Os `anexo`
 * (linhas de frente e task, "Respondi ao pedido", falas do meio das tasks) não viram linha, mas a web precisa deles para
 * desenhar outra coisa; os mais recentes ficam.
 */
export const TETO_ANEXOS_DA_JANELA = 300;

/**
 * A coluna `primeira` da linha `m` (definido em 2026-10-18, chat limpo, PR 2): é a primeira mensagem da conversa — a da
 * criação do bot (criar-agente.ts), que o backfill reconhece por isso, qualquer que seja a frase. Só calculada para o que o
 * backfill ainda não alcançou (`sistema` sem payload e sem assunto): uma consulta no índice mensagens_por_conversa por linha
 * assim, nenhuma depois do backfill.
 */
export function colunaPrimeira(conn: Conn, alias: string) {
  const m = conn.unsafe(alias);
  return conn`(${m}.assunto is null and ${m}.kind = 'sistema' and ${m}.payload is null and not exists (
    select 1 from mensagens o where o.tenant_id = ${m}.tenant_id and o.conversa_id = ${m}.conversa_id
      and (o.criado_em < ${m}.criado_em or (o.criado_em = ${m}.criado_em and o.id < ${m}.id)))) as primeira`;
}

/**
 * O destino de uma linha da conversa própria (definido em 2026-10-18, chat limpo, PR 2): pelo assunto gravado, ou, nulo,
 * pelo que o backfill gravaria (assuntoNaLeitura). `primeira` só vem quando a consulta a calculou (colunaPrimeira).
 */
export function destinoDaLinha(l: LinhaMensagem & { primeira?: boolean | null; frente_de_lote?: boolean | null }): Destino {
  const assunto = assuntoNaLeitura({ assunto: l.assunto, kind: l.kind, payload: l.payload, texto: l.texto, decididoPor: l.decidido_por, primeiraDaConversa: l.primeira === true });
  // definido em 2026-10-22 (NOD-325, ADR-099 item 2): a fala do bot num turno de frente de lote é `anexo` — mora na tela da
  // frente; no chat a voz única é a do dono, no retorno do lote. Sem isso a mesma resposta saía duas vezes (a da frente
  // como balão "da task" e a do dono). A pergunta à pessoa (`pedido_a_pessoa`) fica no chat; frente sem lote e task, também.
  if (assunto === null && l.kind === "texto" && l.autor_tipo === "agente" && l.frente_de_lote === true && l.payload?.kind !== "pedido_a_pessoa") return "anexo";
  return destinoDe(assunto);
}

function paraMensagemComTurno(l: LinhaComTurno): Mensagem {
  // NOD-323: o que o bot não conseguiu anexar vai só na fala final do turno (a linha discreta abaixo dela, j5-6).
  const recusas = l.fim_do_turno === true && Array.isArray(l.midia_recusas) && l.midia_recusas.length > 0 ? { midiaRecusas: l.midia_recusas } : {};
  const checkpoint = l.ck_estado && l.ck_arquivos && l.ck_total != null
    ? { checkpoint: checkpointDaFala({ estado: l.ck_estado, arquivos: l.ck_arquivos, total: l.ck_total, feitos: l.ck_feitos ?? 0, desfeitoEm: l.ck_desfeito_em ? ms(l.ck_desfeito_em) : null, resultado: l.ck_resultado ?? null, falha: l.ck_falha ?? null }) }
    : {};
  return { ...paraMensagem(l), origemTurno: l.turno_origem, trabalhoId: l.trabalho_id, fimDoTurno: l.fim_do_turno === true, ...(l.turno_bastidores === true && !l.trabalho_id ? { bastidores: true } : {}), ...(l.turno_criado_em ? { turnoDesde: new Date(l.turno_criado_em).getTime() } : {}), ...recusas, ...(l.motivo_recomeco ? { motivoRecomeco: l.motivo_recomeco } : {}), ...(l.raiz_id && l.raiz_origem ? { raiz: { turnoId: l.raiz_id, origem: l.raiz_origem } } : {}), ...checkpoint, ...tarefaDaLinha(l) };
}

/** ADA-28 (ADR-159): a marca `tarefa` da mensagem gravada num turno de tarefa (ou de frente dela). */
function tarefaDaLinha(l: LinhaDaTarefa): Pick<Mensagem, "tarefa"> {
  if (!l.tq_id || !l.tq_quadro_id) return {};
  return { tarefa: { id: l.tq_id, quadroId: l.tq_quadro_id, codigo: codigoDaTarefa(l.tq_prefixo ?? null, { id: l.tq_id, numero: l.tq_numero ?? null, linearId: l.tq_linear_id ?? null }) } };
}

/**
 * definido em 2026-10-07 (ADR-083, S2): o que a web usa para agrupar sem adivinhar, no MESMO select (S3 da revisão: a
 * janela `max(criado_em) over (partition by turno_id)`, nunca subconsulta por linha). A fala da pessoa não tem turno
 * próprio: o trabalho dela é o do turno que ela abriu (`mensagem_origem_id`, índice da 0063). `fimDoTurno` olha só as
 * falas de texto do bot e só turno já encerrado; a janela é a mesma página lida, e a última fala de um turno é sempre a
 * mais nova dele, então ela está na página sempre que alguma fala dele estiver.
 * revisto em 2026-10-18 (QA do PR 3 do chat limpo): `rz.raiz_id`/`rz.raiz_origem` entram no select. O lateral da raiz
 * (ADR-099, I7) existia desde 12/10, mas as colunas dele nunca eram lidas, e `raiz` não chegava a mensagem nenhuma: a
 * retomada de um pedido de colega (quem recebeu pediu a um terceiro) saía da troca e a fala entregue virava balão.
 */
/**
 * NOD-402 (revisão 14): a hora de onde o turno segura a mensagem dos bastidores (`Mensagem.turnoDesde`). É a hora em que ele
 * pôde rodar (criação ou `acordar_em`); se ficou mais que isto na fila (máquina fora), o que foi gravado na espera já
 * estava à vista e não pode sumir quando ele fala: vale o despacho. O mesmo número de `FILA_SEGURA_MS` em
 * web/telas/conversa.ts (a web não importa daqui): mudar um muda o outro.
 */
const FILA_SEGURA_MS = 5 * 60_000;

/**
 * ADA-28 (ADR-159): a tarefa do turno. O turno raiz da cadeia (ou o próprio) está em `quadro_execucoes` (0139, não some
 * com a passagem da tarefa, ao contrário de `quadro_tarefas.turno_id`); a frente aberta numa tarefa leva `trabalhos.tarefa_id`
 * (0153, ADA-232). Fala da pessoa (sem turno) nunca é marcada: ela fica na conversa.
 */
function lateralDaTarefa(conn: Conn, tenantId: string) {
  return conn`left join lateral (
      select qt.id, qt.quadro_id, qt.numero, qt.linear_id, q.prefixo
      from quadro_tarefas qt join quadros q on q.tenant_id = qt.tenant_id and q.id = qt.quadro_id
      where qt.tenant_id = ${tenantId} and qt.id = coalesce(
        (select qe.tarefa_id from quadro_execucoes qe where qe.tenant_id = ${tenantId} and qe.turno_id = coalesce(rz.raiz_id, t.id) order by qe.criado_em desc limit 1),
        w.tarefa_id)
    ) tq on t.id is not null`;
}

function selectComTurno(conn: Conn, tenantId: string, recorte: ReturnType<Conn>) {
  return conn<LinhaComTurno[]>`
    select m.*, t.origem as turno_origem, t.bastidores as turno_bastidores, case when t.despachado_em - greatest(t.criado_em, coalesce(t.acordar_em, t.criado_em)) >= make_interval(secs => ${FILA_SEGURA_MS / 1000}) then t.despachado_em else greatest(t.criado_em, coalesce(t.acordar_em, t.criado_em)) end as turno_criado_em, t.midia_recusas, t.motivo_recomeco, coalesce(t.trabalho_id, o.trabalho_id) as trabalho_id, rz.raiz_id, rz.raiz_origem,
      coalesce(w.forma = 'frente' and w.lote_id is not null, false) as frente_de_lote,
      -- O desfazendo preso (a máquina sumiu) aparece como falhou: a tela oferece "Tentar de novo" e não prende o bot (NOD-54).
      case when ck.estado = 'desfazendo' and ck.pedido_em < now() - make_interval(secs => ${PRAZO_DESFAZENDO_MS / 1000}) then 'falhou' else ck.estado end as ck_estado,
      ck.arquivos as ck_arquivos, ck.total as ck_total, ck.feitos as ck_feitos, ck.desfeito_em as ck_desfeito_em, ck.resultado as ck_resultado,
      case when ck.estado = 'desfazendo' and ck.pedido_em < now() - make_interval(secs => ${PRAZO_DESFAZENDO_MS / 1000}) then 'erro' else ck.falha end as ck_falha,
      -- NOD-114: o aviso (avisar_pessoa) não é a fala final do turno, como em leituras.repo.ts.
      (t.estado in ('concluido', 'interrompido') and m.kind = 'texto' and m.autor_tipo = 'agente' and coalesce(m.payload->>'kind', '') <> 'aviso_pessoa'
        and m.criado_em = max(case when m.kind = 'texto' and m.autor_tipo = 'agente' and coalesce(m.payload->>'kind', '') <> 'aviso_pessoa' then m.criado_em end) over (partition by m.turno_id)) as fim_do_turno
      ${tarefaCasaLigada() ? conn`, tq.id as tq_id, tq.quadro_id as tq_quadro_id, tq.numero as tq_numero, tq.linear_id as tq_linear_id, tq.prefixo as tq_prefixo` : conn``}
    from (${recorte}) m
    left join turnos t on t.tenant_id = m.tenant_id and t.id = m.turno_id
    left join trabalhos w on w.tenant_id = m.tenant_id and w.id = t.trabalho_id
    left join checkpoints ck on ck.tenant_id = m.tenant_id and ck.mensagem_id = m.id and (ck.estado <> 'vencido' or ck.falha = 'sem_checkpoint')
      and not (ck.estado in ('disponivel', 'falhou') and ck.criado_em < now() - make_interval(secs => ${RETEM_MS / 1000}))
    left join lateral (
      select x.trabalho_id from turnos x where x.tenant_id = ${tenantId} and x.mensagem_origem_id = m.id and m.turno_id is null
      order by x.criado_em limit 1
    ) o on true
    left join lateral (
      with recursive c(id, origem, retoma, n) as (
        select t.id, t.origem, t.retoma_turno_id, 0 where t.origem = 'retomada'
        union all
        select p.id, p.origem, p.retoma_turno_id, c.n + 1 from c join turnos p on p.tenant_id = ${tenantId} and p.id = c.retoma
        where c.origem = 'retomada' and c.n < 10
      ) select c.id as raiz_id, c.origem as raiz_origem from c where c.n > 0 order by c.n desc limit 1
    ) rz on true
    ${tarefaCasaLigada() ? lateralDaTarefa(conn, tenantId) : conn``}
    order by m.criado_em, m.id`;
}

/** NOD-61: uma fala lida por buscar_conversas/ler_conversa, com o nome do autor resolvido no banco. */
export interface LinhaDoBot {
  id: string;
  autor_tipo: Autoria["autor_tipo"];
  autor_id: string;
  /** O nome do bot ou da pessoa; null quando a RLS não mostra o autor (o bot de outra pessoa numa sala). */
  autor_nome: string | null;
  conversa_tipo?: "propria" | "sala";
  sala_nome?: string | null;
  texto: string;
  /** A marca da fala (ADR-026): reler uma não confiável marca o turno, como ler o app de fora. */
  confianca: Confianca;
  cortado_inicio?: boolean;
  cortado_fim?: boolean;
  /** ler_conversa: o texto passou do teto e veio só o começo. */
  texto_cortado: boolean;
  criado_em_txt: string;
}

/**
 * NOD-61: as conversas do bot — a própria dele, ou as salas de que ele é membro ativo. É o único recorte entre um bot e as
 * conversas dos outros bots da mesma pessoa (a RLS mostra todas a ela). Revisão do PR #594 (A1): num turno de SALA só a
 * própria sala, porque a sala pode ter leitor de outra pessoa (ADR-027) e o bot traria para ela a conversa privada.
 * Resolvido antes como lista de ids, para `m.conversa_id = any(...)` usar o índice por conversa (revisão, M3).
 */
const conversasDoBot = (conn: Conn, tenantId: string, agenteId: string, conversaDoTurno: string) => conn`array(
  select c.id from conversas c
  where c.tenant_id = ${tenantId}
    and ((c.tipo = 'propria' and c.agente_id = ${agenteId})
      or (c.tipo = 'sala' and exists (select 1 from sala_membros sm where sm.tenant_id = ${tenantId} and sm.sala_id = c.sala_id
            and sm.agente_id = ${agenteId} and sm.removido_em is null)))
    -- Revisão 2 (B1): falha fechada — o escopo largo só quando o turno é da conversa PRÓPRIA deste bot; qualquer outra
    -- (sala, ou uma que a RLS não mostra) fica só nela.
    and (c.id = ${conversaDoTurno}::uuid
      or exists (select 1 from conversas t where t.tenant_id = ${tenantId} and t.id = ${conversaDoTurno}::uuid and t.tipo = 'propria' and t.agente_id = ${agenteId})))`;

/**
 * NOD-61 (revisão do /codex no PR #594, P1): a marca efetiva de uma fala relida. A resposta do bot é gravada com a confiança da
 * ENTRADA do turno; se o turno leu conteúdo de fora depois (contaminado_em), a fala carrega o que ele leu e volta não confiável.
 * Fala de turno que a RLS não mostra (bot de outra pessoa numa sala) também: na dúvida, não confiável. Revisão 4 (A1): só é
 * confiável o que foi escrito no escopo de quem roda o turno (owner_id) — a fala da dona da sala lida pelo bot de outra
 * pessoa, na conversa própria dele, é texto de terceiro (ADR-026/027).
 */
const confiancaEfetiva = (conn: Conn, pessoaId: string) => conn`case when m.confianca = 'confiavel' and m.owner_id = ${pessoaId}::uuid and (m.turno_id is null or exists (
    select 1 from turnos tc where tc.tenant_id = m.tenant_id and tc.id = m.turno_id and tc.contaminado_em is null))
  then 'confiavel' else 'nao_confiavel' end`;

const autorDaLinha = (conn: Conn) => conn`case when m.autor_tipo = 'agente'
  then (select ag.nome from agentes ag where ag.tenant_id = m.tenant_id and ag.id = m.autor_id)
  else (select p.nome from pessoas p where p.tenant_id = m.tenant_id and p.id = m.autor_id) end`;

/**
 * A fala de um turno de trabalho (task ou frente) na passada do corte (definido em 2026-10-18, chat limpo, PR 2; revisão
 * de engenharia, item 8): tem assunto nulo, mas a web a esconde (mora na tela da task); conta como `anexo`, senão um dia de
 * cinco frentes enchia a janela delas. Só a fala do bot: a da pessoa fica no chat (a da rede foi escrita no chat).
 */
const falaDeTrabalho = (conn: Conn) => conn`(m.assunto is null and m.kind = 'texto' and m.autor_tipo = 'agente' and t.trabalho_id is not null)`;

/**
 * O recorte da janela da conversa própria (listarComTurno com `comDestino`): `chat` são os `limite` itens de chat mais
 * recentes; `corte` é o `criado_em` do mais antigo deles quando a janela encheu (senão, nenhum corte); a resposta é a
 * união dos dois lados, com a coluna `primeira` para o destino na leitura das linhas sem backfill.
 *
 * A janela não tem buracos (revisão do PR 2, 18/10): quando os anexos batem no teto, o mais antigo deles vira o piso e os
 * itens de chat de antes dele ficam de fora. Sem isso, entre o piso e o corte ficavam as falas da pessoa sem o resultado
 * da task (a fala do bot num turno de trabalho é anexo), sem a pergunta aberta da task e sem a linha "Rotina executou"
 * (o resultado virava "nada para você"). No pior caso a janela é mais curta, como a de antes do PR 2, nunca furada.
 *
 * Os dois lados são CTEs `materialized` e a resposta é um join pela chave primária, nunca `id in (… union all …)`: medido em
 * 2026-10-18 (EXPLAIN ANALYZE na conversa sintética do Eng 1, 6.300 linhas), com o `in` o Postgres refazia a passada dos
 * anexos para cada linha da conversa (6.102 voltas, 5,5 milhões de buffers, 20 s).
 */
function recorteDaJanela(conn: Conn, tenantId: string, conversaId: string, limite: number, tetoAnexos = TETO_ANEXOS_DA_JANELA): ReturnType<Conn> {
  const daConversa = conn`m.tenant_id = ${tenantId} and m.conversa_id = ${conversaId}`;
  const comTurno = conn`left join turnos t on t.tenant_id = m.tenant_id and t.id = m.turno_id`;
  const naoContam = [...ASSUNTOS_ANEXO, ...ASSUNTOS_ATIVIDADE];
  return conn`
    with chat as materialized (
      select m.id, m.criado_em from mensagens m ${comTurno}
      where ${daConversa} and (m.assunto is null or m.assunto <> all(${naoContam}::text[])) and not ${falaDeTrabalho(conn)}
      order by m.criado_em desc, m.id desc limit ${limite}
    ), corte as (
      select case when count(*) >= ${limite} then min(criado_em) end as em from chat
    ), anexos as materialized (
      select m.id, m.criado_em from mensagens m ${comTurno}
      where ${daConversa} and (m.assunto = any(${[...ASSUNTOS_ANEXO]}::text[]) or ${falaDeTrabalho(conn)})
        and m.criado_em >= coalesce((select em from corte), '-infinity'::timestamptz)
      order by m.criado_em desc, m.id desc limit ${tetoAnexos}
    ), piso as (
      select case when count(*) >= ${tetoAnexos} then min(criado_em) end as em from anexos
    )
    select ${conn.unsafe(COLUNAS_MENSAGEM.split(", ").map((c) => `m0.${c}`).join(", "))}, ${colunaPrimeira(conn, "m0")}
    from (select id from chat where criado_em >= coalesce((select em from piso), '-infinity'::timestamptz) union all select id from anexos) j
    join mensagens m0 on m0.tenant_id = ${tenantId} and m0.id = j.id`;
}

/** Mensagens com autoria composta (ADR-023/025). A da sala é lida por quem tem grant (perna via sala_id). */
export function mensagensRepo(conn: Conn, escopo: Escopo) {
  return {
    async criar(m: NovaMensagem): Promise<Mensagem | null> {
      const a = m.autoria;
      const [l] = await conn<LinhaMensagem[]>`
        insert into mensagens (tenant_id, id, owner_id, conversa_id, turno_id, autor_tipo, autor_id, sob_procuracao_de, conta_de_execucao,
          executor, locality, locality_reason, machine_id, decidido_por, regra_versao, kind, texto, payload, confianca, parcial, id_envio, assunto)
        values (${escopo.tenantId}, ${m.id ?? conn`gen_random_uuid()`}, ${escopo.pessoaId}, ${m.conversaId}, ${m.turnoId ?? null}, ${a.autor_tipo}, ${a.autor_id},
          ${a.sob_procuracao_de}, ${a.conta_de_execucao}, ${a.executor}, ${a.locality}, ${a.locality_reason}, ${a.machine_id}, ${a.decidido_por},
          ${a.regra_versao}, ${m.kind}, ${m.texto}, ${m.payload === undefined || m.payload === null ? null : conn.json(m.payload)}, ${m.confianca}, ${m.parcial ?? false}, ${m.idEnvio ?? null},
          ${assuntoGravado(conn, escopo.tenantId, m)})
        ${m.idEnvio ? conn`on conflict (tenant_id, conversa_id, id_envio) where id_envio is not null do nothing` : conn``}
        returning ${conn.unsafe(COLUNAS_MENSAGEM)}`;
      return l ? paraMensagem(l) : null;
    },

    /** A mensagem gravada com a chave de envio nesta conversa (NOD-156), para o reenvio devolver a mesma fala. */
    async buscarPorIdEnvio(conversaId: string, idEnvio: string): Promise<Mensagem | null> {
      const [l] = await conn<LinhaMensagem[]>`
        select ${conn.unsafe(COLUNAS_MENSAGEM)} from mensagens
        where tenant_id = ${escopo.tenantId} and conversa_id = ${conversaId} and id_envio = ${idEnvio}`;
      return l ? paraMensagem(l) : null;
    },

    async buscar(id: string): Promise<Mensagem | null> {
      const [l] = await conn<LinhaMensagem[]>`select ${conn.unsafe(COLUNAS_MENSAGEM)} from mensagens where tenant_id = ${escopo.tenantId} and id = ${id}`;
      return l ? paraMensagem(l) : null;
    },

    /**
     * ADR-115 (o pedido ao revisor): os textos que a PESSOA escreveu na conversa, do mais novo para o mais velho, até
     * `limite`. Só a fala dela (autor pessoa, kind texto): a dos bots não é pedido de ninguém.
     * revisto em 2026-10-18 (revisão do PR 3a): só a DONA (`autor_id`). Numa sala de bots de donos diferentes (ADR-027) a
     * fala de outra pessoa é visível pela RLS, mas não é pedido de quem paga o bot — e esta lista vai à parte CONFIÁVEL do
     * revisor: outra pessoa da sala não autoriza o arriscado na máquina da dona.
     */
    async textosDaPessoa(conversaId: string, limite: number): Promise<string[]> {
      const linhas = await conn<{ texto: string }[]>`
        select texto from mensagens where tenant_id = ${escopo.tenantId} and conversa_id = ${conversaId} and autor_tipo = 'pessoa' and autor_id = ${escopo.pessoaId} and kind = 'texto'
        order by criado_em desc, id desc limit ${limite}`;
      return linhas.map((l) => l.texto);
    },

    /**
     * ADA-15 (ADR-154): as falas da pessoa que valem como aprovação neste turno, na ordem: a que abriu o turno
     * (`mensagem_origem_id`) e as que entraram nele enquanto rodava (turnos absorvidos por ele). Só texto da própria pessoa,
     * sem procuração, confiável e na conversa do turno: fala de outro bot, de página ou de outra conversa nunca aparece.
     */
    async falasDaPessoaNoTurno(turnoId: string, conversaId: string): Promise<FalaDaPessoa[]> {
      const ls = await conn<{ id: string; conversa_id: string; texto: string; criado_em: Date }[]>`
        select m.id, m.conversa_id, m.texto, m.criado_em from mensagens m
        where m.tenant_id = ${escopo.tenantId} and m.conversa_id = ${conversaId}
          and m.autor_tipo = 'pessoa' and m.autor_id = ${escopo.pessoaId} and m.sob_procuracao_de is null
          and m.confianca = 'confiavel' and m.kind = 'texto'
          and m.id in (select t.mensagem_origem_id from turnos t
                        where t.tenant_id = ${escopo.tenantId} and t.mensagem_origem_id is not null and t.conversa_id = ${conversaId}
                          and (t.id = ${turnoId} or t.absorvido_por = ${turnoId}))
        order by m.criado_em, m.id`;
      return ls.map((l) => ({ id: l.id, conversaId: l.conversa_id, texto: l.texto, criadoEm: l.criado_em.getTime() }));
    },

    /** Em ordem de criação; `limite` corta pelas mais recentes (a resposta volta crescente). */
    async listarDaConversa(conversaId: string, limite = 200): Promise<Mensagem[]> {
      const linhas = await conn<LinhaMensagem[]>`
        select * from (
          select ${conn.unsafe(COLUNAS_MENSAGEM)} from mensagens where tenant_id = ${escopo.tenantId} and conversa_id = ${conversaId}
          order by criado_em desc, id desc limit ${limite}
        ) recentes order by criado_em, id`;
      return linhas.map(paraMensagem);
    },

    /**
     * listarDaConversa com `origemTurno`, `trabalhoId` e `fimDoTurno` (GET conversas/:id/mensagens, ADR-083).
     *
     * `comDestino` (definido em 2026-10-18, chat limpo; ADR-114, emenda do PR 2): a conversa é própria e a janela conta só
     * o que o chat mostra. As `limite` mais recentes que são item de chat (assunto nulo ou de destino `chat`, menos a fala
     * de um turno de trabalho, que mora na tela da task) e, desde a mais antiga delas (o corte), os `anexo` e as falas de
     * trabalho, até TETO_ANEXOS_DA_JANELA; os de destino `atividade` ficam de fora (moram na Atividade do bot). Duas passadas
     * no índice mensagens_por_conversa (tenant_id, conversa_id, criado_em), sem índice novo. Cada mensagem leva o destino,
     * resolvido aqui (destinoDaLinha).
     *
     * Antes do backfill (assunto nulo nas linhas antigas), o SQL conta a linha sem assunto como chat — conservador: nada
     * some por causa da janela, só cabem menos itens visíveis nas conversas antigas até o backfill rodar —, e o destino da
     * linha é resolvido na leitura pelo texto, como o backfill faria, então o aviso antigo também sai do chat na tela.
     *
     * A sala não muda: as `limite` mais recentes, sem destino (lá a conversa entre bots é o conteúdo).
     */
    async listarComTurno(conversaId: string, limite = 200, opcoes: { comDestino?: boolean; tetoAnexos?: number } = {}): Promise<Mensagem[]> {
      if (!opcoes.comDestino) {
        const linhas = await selectComTurno(conn, escopo.tenantId, conn`
          select ${conn.unsafe(COLUNAS_MENSAGEM)} from mensagens where tenant_id = ${escopo.tenantId} and conversa_id = ${conversaId}
          order by criado_em desc, id desc limit ${limite}`);
        return linhas.map(paraMensagemComTurno);
      }
      const linhas = await selectComTurno(conn, escopo.tenantId, recorteDaJanela(conn, escopo.tenantId, conversaId, limite, opcoes.tetoAnexos));
      return linhas.map((l) => ({ ...paraMensagemComTurno(l), destino: destinoDaLinha(l) }));
    },

    /**
     * NOD-380: as falas de texto inteiras que contêm `termo` (cru: o escape do LIKE é feito no SQL DEPOIS de normalizar, porque o
     * unaccent transforma `％`, `＿` e `＼` de largura total em `%`, `_` e `\`; escapado antes, viravam curinga), ignorando acento e
     * caixa (`nod_sem_acento`, 0116), da mais nova à mais antiga, depois de `antes`. Quem decide o que a pessoa lê é a RLS
     * de `mensagens` e de `conversas` (dona, 'equipe', perna da sala): esta consulta não abre nem fecha nada além disso.
     * Os espaços do texto são juntados como os do termo (termoDaBusca): "oi tudo" acha "oi\ntudo". A conversa de um bot
     * na lixeira não aparece (a sidebar e a fila de Bots também o escondem; a sala segue com o histórico dela).
     * Na conversa própria só o que o chat mostra (o mesmo recorte da janela: sem anexo, atividade nem fala de trabalho);
     * na sala, tudo, como a janela da sala. Sem índice de texto (a RLS com FORCE o impede, ADR-008): a consulta varre as
     * mensagens do tenant, e o `statement_timeout` local de 4 s é o teto.
     */
    async buscarTexto(termo: string, antes: { criadoEm: string; id: string } | null, limite: number, sinal?: AbortSignal): Promise<{ linhas: LinhaAchada[]; temMais: boolean }> {
      await conn`set local statement_timeout = '4s'`;
      // Revisões 7 e 8: quem já desconectou (a pessoa digitou outra letra) não manda a consulta. A que já foi segue até o fim
      // (no máximo 4 s): cancelar dentro da transação pelo driver prendia a conexão (provado no teste da revisão 8).
      sinal?.throwIfAborted();
      const naoContam = [...ASSUNTOS_ANEXO, ...ASSUNTOS_ATIVIDADE];
      const consulta = conn<LinhaAchada[]>`
        select m.id, m.conversa_id, c.tipo as conversa_tipo, c.agente_id, c.sala_id, m.autor_tipo, m.autor_id,
          substr(j.junto, j.de, ${JANELA_TRECHO}) as texto, j.de > 1 as cortado_inicio, j.de + ${JANELA_TRECHO} <= length(j.junto) as cortado_fim,
          to_char(m.criado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as criado_em_txt
        from mensagens m
        join conversas c on c.tenant_id = m.tenant_id and c.id = m.conversa_id
        left join agentes a on a.tenant_id = c.tenant_id and a.id = c.agente_id
        left join turnos t on t.tenant_id = m.tenant_id and t.id = m.turno_id
        -- Revisão de segurança do PR #551: só a janela em volta do acerto sai do banco (o trecho no Node era linear no texto
        -- inteiro, até 1 MB por fala). A posição vem do texto normalizado; o unaccent quase não muda o tamanho, e a folga cobre.
        cross join lateral (select regexp_replace(m.texto, '\\s+', ' ', 'g') as junto) jj
        cross join lateral (select greatest(1, strpos(nod_sem_acento(jj.junto), nod_sem_acento(${termo})) - ${FOLGA_TRECHO}) as de, jj.junto) j
        where m.tenant_id = ${escopo.tenantId} and m.kind = 'texto' and not m.parcial
          and (c.tipo = 'sala' or a.excluido_em is null)
          and regexp_replace(nod_sem_acento(m.texto), '\\s+', ' ', 'g') like '%' || replace(replace(replace(nod_sem_acento(${termo}), '\\', '\\\\'), '%', '\\%'), '_', '\\_') || '%' escape '\\'
          and (c.tipo = 'sala' or ((m.assunto is null or m.assunto <> all(${naoContam}::text[])) and not ${falaDeTrabalho(conn)}))
          ${antes ? conn`and (m.criado_em, m.id) < (${antes.criadoEm}::text::timestamptz, ${antes.id}::uuid)` : conn``}
        order by m.criado_em desc, m.id desc
        limit ${limite + 1}`;
      const linhas = await consulta;
      return { linhas: linhas.slice(0, limite), temMais: linhas.length > limite };
    },

    /**
     * NOD-61 (buscar_conversas): a busca de buscarTexto, mas só nas conversas do BOT `agenteId` — a própria dele (com as falas
     * das tasks e frentes, que moram nela) e as salas de que ele é membro ativo. A RLS da pessoa vê as conversas de todos os
     * bots dela; o recorte por bot é este `where`, e é ele que impede o bot A de achar a fala do bot B (ADR-058/066). Fora os
     * anexos (cartões, uploads): o resto da fala de texto conta, inclusive a da task. O nome da sala e do autor vão junto.
     */
    async buscarDoAgente(p: { agenteId: string; conversaDoTurno: string; turnoId?: string; termo: string; antes: { criadoEm: string; id: string } | null; limite: number }): Promise<{ linhas: LinhaDoBot[]; temMais: boolean } | "demorou"> {
      const { termo, antes, limite } = p;
      // Revisão 2 do PR #594 (M1, desempenho): o filtro barato (`nod_sem_acento(texto) like`) roda em toda fala; o que junta
      // espaços (regexp_replace) só quando o termo tem espaço — sem espaço os dois acham o mesmo. O trecho é montado só para as
      // até limite+1 falas achadas (a subconsulta), não para cada fala da conversa.
      const padrao = (x: Conn, t: string) => x`'%' || replace(replace(replace(nod_sem_acento(${t}), '\\', '\\\\'), '%', '\\%'), '_', '\\_') || '%'`;
      const maiorPalavra = termo.split(" ").reduce((a, b) => (b.length > a.length ? b : a), "");
      const casa = (x: Conn) => termo.includes(" ")
        ? x`nod_sem_acento(m.texto) like ${padrao(x, maiorPalavra)} escape '\\' and regexp_replace(nod_sem_acento(m.texto), '\\s+', ' ', 'g') like ${padrao(x, termo)} escape '\\'`
        : x`nod_sem_acento(m.texto) like ${padrao(x, termo)} escape '\\'`;
      const consulta = (c: Conn) => c<LinhaDoBot[]>`
        select m.id, m.autor_tipo, m.autor_id, ${autorDaLinha(c)} as autor_nome, ${confiancaEfetiva(c, escopo.pessoaId)} as confianca, c.tipo as conversa_tipo, s.nome as sala_nome,
          substr(j.junto, j.de, ${JANELA_TRECHO}) as texto, j.de > 1 as cortado_inicio, j.de + ${JANELA_TRECHO} <= length(j.junto) as cortado_fim, false as texto_cortado,
          to_char(m.criado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as criado_em_txt
        from (
          select m.* from mensagens m
          where m.tenant_id = ${escopo.tenantId} and m.conversa_id = any(${conversasDoBot(c, escopo.tenantId, p.agenteId, p.conversaDoTurno)})
            and m.kind = 'texto' and not m.parcial
            and (m.assunto is null or m.assunto <> all(${[...ASSUNTOS_ANEXO, ...ASSUNTOS_ATIVIDADE]}::text[]))
            and ${casa(c)}
            ${p.turnoId ? c`and m.turno_id is distinct from ${p.turnoId}::uuid
            and not exists (select 1 from turnos tq where tq.tenant_id = m.tenant_id and tq.id = ${p.turnoId}::uuid and tq.mensagem_origem_id = m.id)` : c``}
            ${antes ? c`and (m.criado_em, m.id) < (${antes.criadoEm}::text::timestamptz, ${antes.id}::uuid)` : c``}
          order by m.criado_em desc, m.id desc
          limit ${limite + 1}
        ) m
        join conversas c on c.tenant_id = m.tenant_id and c.id = m.conversa_id
        left join salas s on s.tenant_id = c.tenant_id and s.id = c.sala_id
        cross join lateral (select regexp_replace(m.texto, '\\s+', ' ', 'g') as junto) jj
        cross join lateral (select greatest(1, strpos(nod_sem_acento(jj.junto), nod_sem_acento(${termo})) - ${FOLGA_TRECHO}) as de, jj.junto) j
        order by m.criado_em desc, m.id desc`;
      // Revisão do PR #594 (M2): o teto de 4 s vale num SAVEPOINT próprio e volta ao de antes; estourou, só o savepoint
      // volta e o bot ouve "demorou" — a trilha e o catcher da chamada seguem na transação (padrão de conversaLeuDeFora).
      const comTeto = async (c: Conn) => {
        const [antesDoTeto] = await c<{ t: string }[]>`select current_setting('statement_timeout') as t`;
        await c`set local statement_timeout = '4s'`;
        const linhas = await consulta(c);
        await c`select set_config('statement_timeout', ${antesDoTeto?.t ?? "0"}, true)`;
        return linhas;
      };
      let linhas: LinhaDoBot[];
      try {
        // Revisão 2 (B2) e 3 (B1): só dentro da transação do turno (escopo da RLS vinculado); no pool, uma transação nova
        // nasceria sem nod.tenant_id/nod.pessoa_id — melhor falhar alto.
        const tx = conn as Partial<Tx>;
        if (typeof tx.savepoint !== "function") throw new Error("buscarDoAgente precisa da transação do turno para o teto de 4 s");
        linhas = await (conn as Tx).savepoint((sp) => comTeto(sp));
      } catch (e) {
        if ((e as { code?: unknown }).code === "57014") return "demorou";
        throw e;
      }
      return { linhas: linhas.slice(0, limite), temMais: linhas.length > limite };
    },

    /**
     * NOD-61 (ler_conversa): a fala `mensagemId` e até `antes`/`depois` falas de texto vizinhas da MESMA conversa, em ordem
     * crescente, cada uma com até `tetoTexto` + 1 caracteres a partir do caractere `aPartirDe` (quem chama corta e marca).
     * null quando a fala não é de texto, não existe ou não é de uma conversa do bot (o mesmo null: quem pede não sabe se existe).
     */
    async janelaDoAgente(p: { agenteId: string; conversaDoTurno: string; mensagemId: string; antes: number; depois: number; tetoTexto: number; aPartirDe: number }): Promise<{ conversaTipo: "propria" | "sala"; salaNome: string | null; linhas: LinhaDoBot[] } | null> {
      const { mensagemId, antes, depois, tetoTexto, aPartirDe } = p;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(mensagemId)) return null;
      const deTexto = conn`m.kind = 'texto' and not m.parcial and (m.assunto is null or m.assunto <> all(${[...ASSUNTOS_ANEXO, ...ASSUNTOS_ATIVIDADE]}::text[]))`;
      const confianca = confiancaEfetiva(conn, escopo.pessoaId);
      const [ancora] = await conn<{ conversa_id: string; conversa_tipo: "propria" | "sala"; sala_nome: string | null }[]>`
        select m.conversa_id, c.tipo as conversa_tipo, s.nome as sala_nome
        from mensagens m
        join conversas c on c.tenant_id = m.tenant_id and c.id = m.conversa_id
        left join salas s on s.tenant_id = c.tenant_id and s.id = c.sala_id
        where m.tenant_id = ${escopo.tenantId} and m.id = ${mensagemId} and ${deTexto}
          and m.conversa_id = any(${conversasDoBot(conn, escopo.tenantId, p.agenteId, p.conversaDoTurno)})`;
      if (!ancora) return null;
      const colunas = conn`m.id, m.autor_tipo, m.autor_id, ${autorDaLinha(conn)} as autor_nome, ${confianca} as confianca, substr(m.texto, ${aPartirDe + 1}, ${tetoTexto + 1}) as texto,
        length(m.texto) > ${aPartirDe + tetoTexto} as texto_cortado, to_char(m.criado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as criado_em_txt`;
      const daConversa = conn`m.tenant_id = ${escopo.tenantId} and m.conversa_id = ${ancora.conversa_id} and ${deTexto}`;
      const ponto = conn`(select m0.criado_em from mensagens m0 where m0.tenant_id = ${escopo.tenantId} and m0.id = ${mensagemId})`;
      const linhas = await conn<LinhaDoBot[]>`
        select * from (
          (select ${colunas} from mensagens m where ${daConversa} and (m.criado_em, m.id) < (${ponto}, ${mensagemId}::uuid)
            order by m.criado_em desc, m.id desc limit ${antes})
          union all
          (select ${colunas} from mensagens m where m.tenant_id = ${escopo.tenantId} and m.id = ${mensagemId})
          union all
          (select ${colunas} from mensagens m where ${daConversa} and (m.criado_em, m.id) > (${ponto}, ${mensagemId}::uuid)
            order by m.criado_em, m.id limit ${depois})
        ) janela order by criado_em_txt, id`;
      return { conversaTipo: ancora.conversa_tipo, salaNome: ancora.sala_nome, linhas };
    },

    /**
     * NOD-380 (critério 4): quantas mensagens a conversa tem da `mensagemId` (inclusive) para cá, para a janela crescer até
     * ela. null quando a mensagem não é desta conversa ou a pessoa não a lê (a RLS esconde a linha).
     */
    async contarDesde(conversaId: string, mensagemId: string, teto = Number.MAX_SAFE_INTEGER): Promise<number | null> {
      // Revisão 7: conta no máximo `teto` (passou dele, a janela não cresce até lá de qualquer jeito).
      const [l] = await conn<{ n: number | null }[]>`
        select (select count(*)::int from (select 1 from mensagens m
                where m.tenant_id = a.tenant_id and m.conversa_id = a.conversa_id and (m.criado_em, m.id) >= (a.criado_em, a.id)
                limit ${Math.min(teto, 2_147_483_647)}) x) as n
        from mensagens a where a.tenant_id = ${escopo.tenantId} and a.id = ${mensagemId} and a.conversa_id = ${conversaId}`;
      return l?.n ?? null;
    },

    /**
     * As mensagens de um trabalho (a tela da task, ADR-083): as falas dos turnos dele, inclusive as do meio, e as da
     * pessoa que abriram um turno dele. As mais recentes, até `limite`.
     */
    async doTrabalho(trabalhoId: string, limite = 300): Promise<Mensagem[]> {
      const linhas = await selectComTurno(conn, escopo.tenantId, conn`
        select ${conn.unsafe(COLUNAS_MENSAGEM)} from mensagens
        where tenant_id = ${escopo.tenantId} and id in (
          select mm.id from mensagens mm join turnos t on t.tenant_id = mm.tenant_id and t.id = mm.turno_id
          where mm.tenant_id = ${escopo.tenantId} and t.trabalho_id = ${trabalhoId}
          union all
          select t.mensagem_origem_id from turnos t where t.tenant_id = ${escopo.tenantId} and t.trabalho_id = ${trabalhoId} and t.mensagem_origem_id is not null)
        order by criado_em desc, id desc limit ${limite}`);
      return linhas.map(paraMensagemComTurno);
    },

    /**
     * A mensagem apontada e as que a precedem dentro da janela, para o relato anexar o contexto
     * (ADR-041). Usa o índice mensagens_por_conversa (tenant_id, conversa_id, criado_em).
     *
     * A âncora entra por `id`, não por comparação de tempo: o Postgres grava clock_timestamp() com
     * microssegundos e `ms()` trunca para milissegundos, então `criado_em <= ${data(ate)}` deixaria
     * a PRÓPRIA mensagem de fora sempre que os microssegundos não fossem zero (medido em
     * 2026-09-21: 18:24:28.352292 no banco contra .352 reconstruído, e a janela voltava vazia).
     * O `limite` é teto de segurança: conversa movimentada não vira dump.
     */
    async janelaAte(conversaId: string, ancoraId: string, desde: number, limite = 100, opcoes: { comDestino?: boolean } = {}): Promise<Mensagem[]> {
      const daJanela = conn`
        m.tenant_id = ${escopo.tenantId} and m.conversa_id = ${conversaId} and m.criado_em >= ${data(desde)}
          and (m.id = ${ancoraId} or m.criado_em <= (select criado_em from mensagens where tenant_id = ${escopo.tenantId} and id = ${ancoraId}))`;
      if (!opcoes.comDestino) {
        const linhas = await conn<LinhaMensagem[]>`
          select * from (
            select ${conn.unsafe(COLUNAS_MENSAGEM)} from mensagens m where ${daJanela}
            order by criado_em desc, id desc limit ${limite}
          ) janela order by criado_em, id`;
        return linhas.map(paraMensagem);
      }
      // ADR-041, emenda do PR 2 do chat limpo (2026-10-18): na conversa própria o relato conta `limite` itens de chat, como a
      // janela da conversa (no Eng 1, 100 mensagens cruas davam umas 5 falas), e leva junto o que estava na Atividade nos
      // mesmos 15 min, desde o corte (até TETO_ANEXOS_DA_JANELA), cada um com o destino: o relato registra o que a pessoa viu.
      const comTurno = conn`left join turnos t on t.tenant_id = m.tenant_id and t.id = m.turno_id`;
      const naoContam = [...ASSUNTOS_ANEXO, ...ASSUNTOS_ATIVIDADE];
      const contaNoChat = conn`(m.assunto is null or m.assunto <> all(${naoContam}::text[])) and not ${falaDeTrabalho(conn)}`;
      const linhas = await conn<(LinhaMensagem & { primeira: boolean | null; frente_de_lote: boolean | null })[]>`
        with chat as materialized (
          select m.id, m.criado_em from mensagens m ${comTurno} where ${daJanela} and ${contaNoChat}
          order by m.criado_em desc, m.id desc limit ${limite}
        ), corte as (
          select case when count(*) >= ${limite} then min(criado_em) end as em from chat
        ), fora as materialized (
          select m.id from mensagens m ${comTurno} where ${daJanela} and not (${contaNoChat})
            and m.criado_em >= coalesce((select em from corte), '-infinity'::timestamptz)
          order by m.criado_em desc, m.id desc limit ${TETO_ANEXOS_DA_JANELA}
        )
        select ${conn.unsafe(COLUNAS_MENSAGEM.split(", ").map((c) => `m0.${c}`).join(", "))}, ${colunaPrimeira(conn, "m0")},
          coalesce(w0.forma = 'frente' and w0.lote_id is not null, false) as frente_de_lote
        from (select id from chat union all select id from fora) j
        join mensagens m0 on m0.tenant_id = ${escopo.tenantId} and m0.id = j.id
        left join turnos t0 on t0.tenant_id = m0.tenant_id and t0.id = m0.turno_id
        left join trabalhos w0 on w0.tenant_id = m0.tenant_id and w0.id = t0.trabalho_id
        order by m0.criado_em, m0.id`;
      return linhas.map((l) => ({ ...paraMensagem(l), destino: destinoDaLinha(l) }));
    },

    /**
     * O `peer_pedido` que abriu uma tarefa de colega (definido em 2026-09-29, ADR-058): a ligação tipada até
     * quem pediu. Direto pelo turno, sem a janela de MENSAGENS_DO_PLANO — a trava herdada não pode depender dela.
     */
    async pedidoDaTarefa(turnoId: string): Promise<Mensagem | null> {
      const [l] = await conn<LinhaMensagem[]>`
        select ${conn.unsafe(COLUNAS_MENSAGEM)} from mensagens
        where tenant_id = ${escopo.tenantId} and turno_id = ${turnoId} and payload->>'kind' = 'peer_pedido'
        order by criado_em, id limit 1`;
      return l ? paraMensagem(l) : null;
    },

    /**
     * definido em 2026-10-15 (NOD-270): o balão `pedido_a_pessoa` de uma decisão — é ele que diz quem perguntou (a autoria
     * `decidido_por` da regra das voltas sem novidade), porque a decisão pendente não guarda a regra. Pelo turno da
     * decisão (o balão nasce no mesmo turno, na mesma transação), sem varrer a conversa.
     */
    async pedidoAPessoaDaDecisao(turnoId: string, decisaoId: string): Promise<Mensagem | null> {
      const [l] = await conn<LinhaMensagem[]>`
        select ${conn.unsafe(COLUNAS_MENSAGEM)} from mensagens
        where tenant_id = ${escopo.tenantId} and turno_id = ${turnoId} and payload->>'kind' = 'pedido_a_pessoa' and payload->>'decisaoId' = ${decisaoId}
        order by criado_em, id limit 1`;
      return l ? paraMensagem(l) : null;
    },

    /**
     * definido em 2026-10-18 (plano "pergunta com botões", Parte 4): os balões `pedido_a_pessoa` dos turnos das perguntas
     * de "Sua vez" numa consulta só (`turno_id = any(…)`, no índice mensagens_por_turno) — no lugar de uma
     * pedidoAPessoaDaDecisao por item —, com a origem do turno e a raiz da cadeia de retomadas (a mesma da conversa). A
     * RLS de mensagens decide o que volta: a decisora que não é dona da conversa não lê o balão (0002), e fica sem ele.
     */
    async pedidosAPessoaDasDecisoes(turnoIds: readonly string[]): Promise<Mensagem[]> {
      if (turnoIds.length === 0) return [];
      const linhas = await selectComTurno(conn, escopo.tenantId, conn`
        select ${conn.unsafe(COLUNAS_MENSAGEM)} from mensagens
        where tenant_id = ${escopo.tenantId} and turno_id = any(${[...new Set(turnoIds)]}::uuid[]) and payload->>'kind' = 'pedido_a_pessoa'`);
      return linhas.map(paraMensagemComTurno);
    },

    /**
     * definido em 2026-10-18 (chat limpo, PR 3; plano, decisão 18): quem pediu cada turno de `delegacao` da janela — o
     * autor do `peer_pedido` do turno e o nome do payload — numa consulta à parte (`turno_id = any(…)`, no índice
     * mensagens_por_turno), não na consulta da janela. O nome vem do payload, nunca de um join com `agentes`, que a RLS
     * esconde quando o bot é de outra pessoa (ADR-099). O pedido antigo, sem `nome`, volta com null.
     */
    async pedidosDeColega(turnoIds: readonly string[]): Promise<Record<string, PedidoDeColega>> {
      if (turnoIds.length === 0) return {};
      const linhas = await conn<{ turno_id: string; autor_id: string; nome: string | null }[]>`
        select distinct on (turno_id) turno_id, autor_id, payload->>'nome' as nome from mensagens
        where tenant_id = ${escopo.tenantId} and turno_id = any(${[...new Set(turnoIds)]}::uuid[]) and payload->>'kind' = 'peer_pedido'
        order by turno_id, criado_em, id`;
      return Object.fromEntries(linhas.map((l) => [l.turno_id, { agenteId: l.autor_id, nome: l.nome }]));
    },

    /** A última mensagem da conversa com este assunto (0091), ou null. O aviso do PR 6 dos modos de aprovação a usa. */
    async ultimaComAssunto(conversaId: string, assunto: Assunto): Promise<Mensagem | null> {
      const [l] = await conn<LinhaMensagem[]>`
        select ${conn.unsafe(COLUNAS_MENSAGEM)} from mensagens where tenant_id = ${escopo.tenantId} and conversa_id = ${conversaId} and assunto = ${assunto}
        order by criado_em desc, id desc limit 1`;
      return l ? paraMensagem(l) : null;
    },

    async ultimaDaConversa(conversaId: string): Promise<Mensagem | null> {
      const [l] = await conn<LinhaMensagem[]>`
        select ${conn.unsafe(COLUNAS_MENSAGEM)} from mensagens where tenant_id = ${escopo.tenantId} and conversa_id = ${conversaId} order by criado_em desc, id desc limit 1`;
      return l ? paraMensagem(l) : null;
    },

    /**
     * ultimaDaConversa de várias conversas numa consulta (a prévia da frota, definido em 2026-09-30): um LATERAL por conversa
     * no índice mensagens_por_conversa.
     *
     * revisto em 2026-10-18 (QA do PR 2 do chat limpo, ADR-114): a prévia é a última que o chat mostra. O que mora na
     * Atividade ou é anexo ("Anotei …", a negação, "Virou a frente", "Rotina executou") saiu do chat e não vira prévia; a
     * linha sem assunto (antes do backfill) continua entrando, como na janela.
     */
    async ultimasDasConversas(conversaIds: readonly string[]): Promise<Map<string, Mensagem>> {
      if (conversaIds.length === 0) return new Map();
      const foraDoChat = [...ASSUNTOS_ANEXO, ...ASSUNTOS_ATIVIDADE];
      const linhas = await conn<LinhaMensagem[]>`
        select u.* from unnest(${[...conversaIds]}::uuid[]) as c(id)
        cross join lateral (
          select ${conn.unsafe(COLUNAS_MENSAGEM)} from mensagens
          where tenant_id = ${escopo.tenantId} and conversa_id = c.id and (assunto is null or assunto <> all(${foraDoChat}::text[]))
          order by criado_em desc, id desc limit 1
        ) u`;
      return new Map(linhas.map((l) => [l.conversa_id, paraMensagem(l)]));
    },

    async marcarParcial(id: string, parcial: boolean): Promise<boolean> {
      const r = await conn`update mensagens set parcial = ${parcial} where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}`;
      return r.count === 1;
    },

    /**
     * ADR-108: o aviso de troca de IA é UM por bot — a segunda task que para atualiza a linha de sistema dele (texto e
     * payload), e a decisão grava o desfecho nela. Só linha de sistema da dona. `turnoId` liga a linha sem turno à fala da
     * conversa que parou depois (o "Continuar na conta" refaz essa fala); a que já tem turno fica com ele.
     */
    async atualizarSistema(id: string, m: { texto: string; payload: NonNullable<NovaMensagem["payload"]>; turnoId?: string | null }): Promise<boolean> {
      // Chat limpo (PR 1): o payload regravado recalcula o assunto (a troca de IA decidida continua "ia.troca").
      const r = await conn`update mensagens set texto = ${m.texto}, payload = ${conn.json(m.payload)}, turno_id = coalesce(turno_id, ${m.turnoId ?? null}),
          assunto = ${assuntoDe("sistema", m.payload, null)}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and kind = 'sistema'`;
      return r.count === 1;
    },

    /**
     * NOD-353: turno cuja última fala saiu no meio (turno.fala) e acabou sem fala final — o resumo das ações vai na
     * última fala de texto do bot nesse turno, a mesma que a tela mostrava viva. Só preenche: payload já gravado fica.
     */
    async acoesNaUltimaFalaDoTurno(turnoId: string, agenteId: string, payload: Extract<NonNullable<NovaMensagem["payload"]>, { kind: "acoes_do_turno" }>): Promise<boolean> {
      const r = await conn`update mensagens set payload = ${conn.json(payload)}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = (
          select id from mensagens where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and turno_id = ${turnoId}
            and autor_tipo = 'agente' and autor_id = ${agenteId} and kind = 'texto' and assunto is null
          order by criado_em desc, id desc limit 1
        ) and payload is null`;
      return r.count === 1;
    },

    /** NOD-54 (revisão M2): a última fala de texto do bot no turno, onde mora o checkpoint quando não veio fala final. */
    async ultimaFalaDoTurno(turnoId: string, agenteId: string): Promise<string | null> {
      const [l] = await conn<{ id: string }[]>`select id from mensagens where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and turno_id = ${turnoId}
          and autor_tipo = 'agente' and autor_id = ${agenteId} and kind = 'texto' and assunto is null
        order by criado_em desc, id desc limit 1`;
      return l?.id ?? null;
    },

    /** Turno interrompido no meio do streaming: a fala já gravada fica marcada como parcial (ADR-010). */
    async marcarParciaisDoTurno(turnoId: string): Promise<number> {
      const r = await conn`update mensagens set parcial = true where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and turno_id = ${turnoId} and autor_tipo = 'agente'`;
      return r.count;
    },
  };
}
