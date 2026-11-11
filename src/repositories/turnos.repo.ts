import type { MotivoRenovacaoNegada } from "../contracts/ponte.ts";
import { HARNESS_LEGADO, type IdHarness, type PreferenciaHarness } from "../contracts/harness.ts";
import type { TurnoPendenteDto } from "../contracts/api.ts";
import type { RecusasMidia } from "../contracts/anexo.ts";
import type { Executor } from "../contracts/evento.ts";
import type { Confianca } from "../contracts/mensagem.ts";
import type { MotivoFalha, MotivoInterrupcao, MotivoLocalidade, MotivoSemNovidade } from "../contracts/motivos.ts";
import type { EstadoTurno, MotivoRecomeco, OrigemTurno, Profundidade, SinaisTurno, Turno } from "../contracts/turno.ts";
import type { CondicaoDaVolta } from "../contracts/quadro-execucoes.ts";
import { ENTRADA_DA_RETOMADA_DA_QUEDA, ENTRADA_DA_VOLTA_DA_COTA, MARCA_DA_FALA_NA_FRENTE, MARCA_DO_PEDIDO_ORIGINAL, PREFIXOS_DA_VOLTA_DO_FUNDO, type PortaoDaCota, RETORNO_DO_LOTE } from "../domain/cota-da-ia.ts";
import type { SomaDoDia } from "../domain/custo-do-dia.ts";
import { modelosPorIa } from "../domain/ia-do-modelo.ts";
import { ESPERA_MAXIMA_FUNDO_MS } from "../domain/memoria-mac.ts";
import { porChegada } from "../domain/ordem-das-falas.ts";
import { turnoNovoParaCota } from "../domain/salvaguardas-provisorio.ts";
import { MOTIVOS_DE_QUEDA, MOTIVOS_FALHA_SEM_QUEDA, QUEDAS_FORA_DO_TETO } from "../domain/pedido-parado.ts";
import { paraProfundidade } from "../domain/profundidade.ts";
import { nasceNosBastidores } from "../domain/triagem.ts";
import { ABERTURA_DA_ESPERA_DO_SERVIDOR } from "../domain/redacao.ts";
import { PRAZO_SEM_IA_MS } from "../domain/sem-ia.ts";
import { PRAZO_PRESO_SEM_CONTATO_MS, type FatosFundoPreso, type FatosTurnoOrfao, type FundoPreso } from "../domain/turno-orfao.ts";
import type { VoltaDaCadeia } from "../domain/voltas-sem-novidade.ts";
import { abrirTxEscopada } from "../db/tx.ts";
import { ESPERA_DECLINIO_MS, LEASE_MS } from "../shared/constantes.ts";
import type { Conn, Escopo, Tx } from "../shared/types.ts";
import { alvoDoTurno } from "./alvo-da-maquina.ts";
import { nuvemSuspendePrazo, relogioDaNuvem } from "./nuvem-relogio.ts";
import { data, dataOuNull, ms, msOuNull } from "./conversao.ts";

interface Linha {
  tenant_id: string;
  id: string;
  owner_id: string;
  conversa_id: string;
  agente_id: string;
  origem: OrigemTurno;
  estado: EstadoTurno;
  attempted: boolean;
  rejected: boolean;
  prompt_submitted: boolean;
  produced_output: boolean;
  machine_id: string | null;
  lease_ate: Date | null;
  prazo_em: Date;
  motivo_interrupcao: MotivoInterrupcao | null;
  motivo_falha: MotivoFalha | null;
  sem_novidade_motivo: MotivoSemNovidade | null;
  retoma_turno_id: string | null;
  profundidade: number;
  reenvios: number;
  parar_solicitado_em: Date | null;
  entrada_texto: string;
  entrada_anexos: string[];
  entrada_confianca: Confianca;
  custo_usd: string | null;
  modelo: string;
  harness?: PreferenciaHarness;
  executor: Executor;
  criado_em: Date;
  mensagem_origem_id: string | null;
  absorvido_por: string | null;
  sob_procuracao_de: string | null;
  ligacao_id: string | null;
  trabalho_id: string | null;
  acordar_em: Date | null;
  pessoa_esperando: boolean;
  decidido_por: string;
  despachado_em?: Date | null;
  maquina_desta_vez?: string | null;
  bastidores?: boolean;
  tentativas_transitorias?: number;
  motivo_recomeco?: MotivoRecomeco | null;
}


/** ADR-066/ADR-107: a sessão que um turno deixou e onde ela vale (IA efetiva, conta, máquina). */
export type SessaoDoTurno = { sessaoCli: string; executor: string; harness: string | null; contaId: string | null; machineId: string | null };

const COLUNAS =
  "tenant_id, id, owner_id, conversa_id, agente_id, origem, estado, attempted, rejected, prompt_submitted, produced_output, machine_id, lease_ate, prazo_em, motivo_interrupcao, motivo_falha, sem_novidade_motivo, retoma_turno_id, profundidade, reenvios, parar_solicitado_em, entrada_texto, entrada_anexos, entrada_confianca, custo_usd, modelo, harness, executor, criado_em, mensagem_origem_id, absorvido_por, sob_procuracao_de, ligacao_id, trabalho_id, acordar_em, pessoa_esperando, decidido_por, despachado_em, tentativas_transitorias, maquina_desta_vez, bastidores, motivo_recomeco";

function paraTurno(l: Linha): Turno {
  return {
    tenantId: l.tenant_id,
    id: l.id,
    conversaId: l.conversa_id,
    agenteId: l.agente_id,
    ownerId: l.owner_id,
    origem: l.origem,
    estado: l.estado,
    sinais: { attempted: l.attempted, rejected: l.rejected, promptSubmitted: l.prompt_submitted, producedOutput: l.produced_output },
    machineId: l.machine_id,
    leaseAte: msOuNull(l.lease_ate),
    prazoEm: ms(l.prazo_em),
    motivoInterrupcao: l.motivo_interrupcao,
    motivoFalha: l.motivo_falha,
    semNovidadeMotivo: l.sem_novidade_motivo,
    retomaTurnoId: l.retoma_turno_id,
    profundidade: paraProfundidade(l.profundidade),
    reenvios: l.reenvios,
    pararSolicitadoEm: msOuNull(l.parar_solicitado_em),
    entradaTexto: l.entrada_texto,
    entradaAnexos: l.entrada_anexos ?? [],
    entradaConfianca: l.entrada_confianca,
    custoUsd: l.custo_usd === null ? null : Number(l.custo_usd),
    modelo: l.modelo,
    harness: l.harness ?? "auto",
    executor: l.executor,
    criadoEm: ms(l.criado_em),
    mensagemOrigemId: l.mensagem_origem_id,
    absorvidoPor: l.absorvido_por,
    sobProcuracaoDe: l.sob_procuracao_de,
    ligacaoId: l.ligacao_id,
    trabalhoId: l.trabalho_id,
    acordarEm: msOuNull(l.acordar_em),
    pessoaEsperando: l.pessoa_esperando,
    decididoPor: l.decidido_por,
    despachadoEm: msOuNull(l.despachado_em ?? null),
    tentativasTransitorias: l.tentativas_transitorias ?? 0,
    // QA do NOD-314: só quando há ("Rodar em <outra> desta vez"); o chip da fila diz a máquina deste turno.
    ...(l.maquina_desta_vez ? { maquinaDestaVez: l.maquina_desta_vez } : {}),
    // ADR-131: só quando é (o plano diz ao motor se o turno é da pessoa, `daPessoa`).
    ...(l.bastidores ? { bastidores: true } : {}),
    ...(l.motivo_recomeco ? { motivoRecomeco: l.motivo_recomeco } : {}),
  };
}

/** NOD-219: um pendente que o varredor de órfãos olha, com os fatos de domain/turno-orfao.ts. */
/** NOD-309 (PR 4): o pendente de fundo que a máquina segura, com os fatos de `decidirFundoPreso` (cotaNoLimite vem do caso de uso). */
export type FundoPresoCandidato = FatosFundoPreso & { id: string; conversaId: string; agenteId: string; trabalhoId: string | null; raizId: string };

export type OrfaoCandidato = FatosTurnoOrfao & {
  id: string;
  conversaId: string;
  agenteId: string;
  trabalhoId: string | null;
  /** NOD-314: a máquina-alvo do turno agora (ADR-090), ou `null` sem alvo. */
  alvoMaquinaId: string | null;
};

export type NovoTurno = {
  id?: string;
  conversaId: string;
  agenteId: string;
  origem: OrigemTurno;
  /** NOD-408: sobrescreve a inferência apenas para fala nova da pessoa que retoma uma task existente. */
  contaCotaProvisorio?: boolean;
  prazoEm: number;
  profundidade: Profundidade;
  entradaTexto: string;
  /** Fala da pessoa que disparou o turno; a web põe "Na fila" e Cancelar embaixo dela. */
  mensagemOrigemId?: string | null;
  /** Pessoa que pediu o trabalho (ADR-047): só o turno de delegação e as retomadas dele. */
  sobProcuracaoDe?: string | null;
  /** ADR-046: anexos da mensagem que abriu o turno; o plano leva os metadados. */
  entradaAnexos?: readonly string[];
  entradaConfianca: Confianca;
  modelo: string;
  harness?: PreferenciaHarness;
  retomaTurnoId?: string | null;
  reenvios?: number;
  /**
   * NOD-206: obrigatório — sem padrão silencioso. É o melhor palpite de quem enfileira; o plano grava o executor real
   * (`registrarExecutor`), porque é lá que ele é decidido.
   */
  executor: Executor;
  localityReason?: MotivoLocalidade;
  decididoPor?: string;
  /** Turno que já nasce interrompido (executor indisponível, E9.3): nunca entra na fila. */
  interrompidoCom?: MotivoInterrupcao;
  /** definido em 2026-10-04 (ADR-072): o turno-cérebro da ligação e os turnos de trabalho pedidos durante ela. */
  ligacaoId?: string | null;
  /**
   * definido em 2026-10-07 (ADR-083): o trabalho do turno. Ausente numa retomada = o do turno que ela continua (a
   * retomada nunca sai do trabalho, como nunca sai do salto); null explícito = turno da conversa.
   */
  trabalhoId?: string | null;
  /** ADR-086: "me chame às 16:00" — a fila só entrega este turno a partir daqui. Ausente/null = na hora. */
  acordarEm?: number | null;
  /** NOD-272 (0088): a pessoa está olhando — o portão da cota não segura este turno (tipoParaCota = conversa). */
  pessoaEsperando?: boolean;
  /**
   * NOD-280 (definido em 2026-10-15): "Rodar no <máquina> desta vez" — a máquina escolhida pela pessoa para ESTE turno
   * (ADR-090, coluna da 0066). O refazer da nota já nasce com ela; o UPDATE de `rodarDestaVez` só alcança pendentes.
   */
  maquinaDestaVez?: string | null;
  /**
   * NOD-287 (2026-10-15): o turno que este repete ou continua. A marca da web (0033, ADR-062 §6) dele vem junto no
   * MESMO INSERT — a repetição por limite, troca de conta/IA ou conta ausente retoma a fala com a página no contexto e
   * não pode ganhar as aprovações de um turno limpo. A marca é lida no INSERT: se a origem for marcada depois, a
   * cópia já nasceu (o `contaminar` posterior vale só para a origem).
   */
  contaminadoDe?: string | null;
  /**
   * NOD-309 (0098): quantas vezes a cadeia já caiu por erro transitório do provedor. A retomada passa o da origem + 1;
   * ausente = 0 (turno novo, ou retomada por outra causa que não conta como transitória).
   */
  tentativasTransitorias?: number;
};

export type Assentamento = {
  estado: "concluido" | "interrompido";
  motivoInterrupcao?: MotivoInterrupcao | null;
  motivoFalha?: MotivoFalha | null;
  sinais?: Partial<SinaisTurno>;
  custoUsd?: number | null;
  tokensEntrada?: number;
  tokensSaida?: number;
  /** 0035: a sessão do CLI e o total que ele informou para ela — custoUsd é a diferença (custo-turno.ts). */
  sessaoCli?: string | null;
  custoSessaoUsd?: number | null;
  /**
   * NOD-241 (0076, emenda da ADR-084): o último sinal de vida do turno que caiu — a régua da retomada automática. Só
   * no interrompido; gravado uma vez (o primeiro valor vence: não sobrescreve o que o varredor já gravou).
   */
  ultimoSinalEm?: number;
};

/** NOD-213: a IA do turno `t` — a fixada, ou a dona do modelo escolhido (iaDoModelo, pelos `modelosPorIa`), ou o legado. */
function iaDoTurnoSql(c: Conn) {
  const porIa = modelosPorIa();
  return c`(case when t.harness <> 'auto' then t.harness else coalesce((select x.ia from unnest(${porIa.modelos}::text[], ${porIa.ias}::text[]) as x(modelo, ia) where x.modelo = t.modelo), ${HARNESS_LEGADO}) end)`;
}

/**
 * definido em 2026-10-12 (ADR-099 §7, decisão do Marlon): a cota da IA segura o turno `t`? Com a IA do turno na reserva (99%
 * de uma janela), trabalho NOVO de fundo — task que nunca rodou, de qualquer origem, e rotina ou pedido de colega sem task —
 * espera: o 1% fica para a conversa com a pessoa. Com a IA no limite, TODO o fundo espera (o que já começou e a volta
 * marcada também), até a janela renovar, em vez de falhar. A conversa com a pessoa (conversa, sala, a retomada que ela
 * pediu), a ligação e o turno que a pessoa está olhando (NOD-272, `pessoa_esperando`) nunca esperam pela cota. NOD-302: um predicado só para o `reivindicar` (que pula) e o
 * `seguradosPelaCota` (que lista, para a nota e a tela). Mesma regra de `tipoParaCota` e `cotaSegura` (domain/cota-da-ia.ts).
 */
function seguradoPelaCotaSql(c: Conn, cota: PortaoDaCota) {
  const iaDoTurno = iaDoTurnoSql(c);
  const naCota = (ias: readonly string[], auto: boolean) => c`(case when t.harness = 'auto' and t.modelo = 'auto' then ${auto}::boolean else ${iaDoTurno} = any(${[...ias]}::text[]) end)`;
  // NOD-272: o turno que a pessoa está olhando ("Testar agora" e as frentes dele) também nunca espera.
  return c`(t.origem <> 'ligacao' and not t.pessoa_esperando and (
                (((t.trabalho_id is null and t.origem in ('rotina', 'delegacao', 'peer'))
                    or exists (select 1 from trabalhos w where w.tenant_id = t.tenant_id and w.id = t.trabalho_id and w.iniciado_em is null))
                  and ${naCota(cota.reserva, cota.autoReserva)})
                -- NOD-258: o retorno do lote (decidido_por = RETORNO_DO_LOTE) é fundo que já começou: espera no limite.
                or ((t.trabalho_id is not null or t.origem in ('rotina', 'delegacao', 'peer') or t.acordar_em is not null
                    or t.decidido_por = ${RETORNO_DO_LOTE})
                  and ${naCota(cota.limite, cota.autoLimite)})))`;
}

/**
 * A faixa do turno `t` está ocupada (definido em 2026-10-07, ADR-083 §3; revisto em 2026-10-26, ADR-130): sem trabalho, por
 * outro turno da MESMA conversa, sem trabalho, despachando e da MESMA faixa — a da pessoa ou a dos bastidores
 * (`turnos.bastidores`, 0121); com trabalho, por outro turno do mesmo trabalho. A ligação não ocupa nem espera faixa. Uma
 * regra só para o `reivindicar` (que pula), o varredor de órfãos, o fundo preso e o "na fila" da conversa.
 */
function faixaOcupadaSql(c: Conn) {
  return c`(case when t.trabalho_id is null
    then exists (select 1 from turnos d where d.tenant_id = t.tenant_id and d.conversa_id = t.conversa_id and d.trabalho_id is null and d.estado = 'despachando' and d.origem <> 'ligacao' and d.bastidores = t.bastidores)
    else exists (select 1 from turnos d where d.tenant_id = t.tenant_id and d.trabalho_id = t.trabalho_id and d.estado = 'despachando') end)`;
}

/**
 * Jornada C do onboarding: o turno `t` é a fala da pessoa guardada sem IA (tem a negação `aguardaIa`, domain/sem-ia.ts).
 * O varredor de órfãos dá a ele os 7 dias da promessa, não as 24 h da máquina-alvo sem contato.
 */
function aguardaIaSql(c: Conn) {
  return c`exists (select 1 from mensagens g where g.tenant_id = t.tenant_id and g.turno_id = t.id and g.kind = 'negacao' and g.payload->>'aguardaIa' = 'true')`;
}

/** ADR-108: o turno da task está na IA `ia` — fixado nela, ou no Automático com a sessão da task nela. null = qualquer. */
function daIa(conn: Conn, ia: IdHarness | null) {
  if (ia === null) return conn`true`;
  return conn`(t.harness = ${ia} or (t.harness = 'auto' and exists (select 1 from trabalhos w where w.tenant_id = t.tenant_id and w.id = t.trabalho_id and w.sessao_harness = ${ia})))`;
}

/**
 * Fila de turnos no Postgres (ADR-010 revisado). O ÚNICO lugar que escreve estado 'pendente' é o
 * INSERT de `enfileirar` (DEFAULT da coluna): tests/conformidade/sem-requeue.test.ts varre src/
 * por UPDATE que volte a 'pendente'. Retomar é turno NOVO com retoma_turno_id (ADR-009).
 */
export function turnosRepo(conn: Conn, escopo: Escopo) {
  /**
   * NOD-312 (revisão 2 do #550): o turno `t` é da conversa se for de conversa, ou uma retomada cuja raiz (até 10 saltos
   * de retoma_turno_id, o SALTOS_DE_RETOMADA de rotinaDoTurno/delegacaoDoTurno) é de conversa. A retomada de uma rotina
   * ou de um pedido de colega roda na mesma conversa, mas noutra sessão: não é o que a pessoa perde.
   */
  /**
   * NOD-312 (revisão 8): o turno de conversa promovido pela rede de 2 min (ADR-083) ganha `trabalho_id`, mas foi a
   * pessoa que falou com o bot nele — conta como último turno de conversa, senão o aviso da mesma troca sai de novo.
   * Só ele (origem 'conversa'): as retomadas e os turnos seguintes da frente são dela.
   * Revisão 10: a retomada de conversa (aprovação respondida) também conta como último turno — na IA que não retoma,
   * é a IA dela que diz se a troca já foi avisada.
   */
  const DA_CONVERSA_OU_DA_REDE = (a: "t" | "u") =>
    `(${a}.trabalho_id is null or (${a}.origem = 'conversa' and exists (select 1 from trabalhos w where w.tenant_id = ${a}.tenant_id and w.id = ${a}.trabalho_id and w.origem = 'rede')))`;
  const raizDeConversa = (a: "t" | "u" = "t") => conn.unsafe(`(${a}.origem = 'conversa' or (${a}.origem = 'retomada' and (
    with recursive cadeia(id, origem, retoma_turno_id, saltos) as (
      select r.id, r.origem, r.retoma_turno_id, 1 from turnos r where r.tenant_id = ${a}.tenant_id and r.id = ${a}.retoma_turno_id
      union all
      select p.id, p.origem, p.retoma_turno_id, c.saltos + 1 from cadeia c join turnos p on p.tenant_id = ${a}.tenant_id and p.id = c.retoma_turno_id
      where c.origem = 'retomada' and c.saltos < 10
    ) select origem from cadeia order by saltos desc limit 1) = 'conversa'))`);
  return {
    async enfileirar(t: NovoTurno): Promise<Turno | null> {
      const estado: EstadoTurno = t.interrompidoCom ? "interrompido" : "pendente";
      const [l] = await conn<Linha[]>`
        insert into turnos (tenant_id, id, owner_id, conversa_id, agente_id, origem, estado, motivo_interrupcao, prazo_em, profundidade,
          entrada_texto, entrada_anexos, entrada_confianca, modelo, harness, retoma_turno_id, reenvios, executor, locality_reason, decidido_por, mensagem_origem_id, sob_procuracao_de, ligacao_id, trabalho_id, acordar_em, maquina_desta_vez, pessoa_esperando, contaminado_em, tentativas_transitorias, bastidores, conta_cota_provisorio)
        values (${escopo.tenantId}, ${t.id ?? conn`gen_random_uuid()`}, ${escopo.pessoaId}, ${t.conversaId}, ${t.agenteId}, ${t.origem}, ${estado},
          ${t.interrompidoCom ?? null}, ${data(t.prazoEm)}, ${t.profundidade}, ${t.entradaTexto}, ${(t.entradaAnexos ?? []) as string[]}::uuid[], ${t.entradaConfianca}, ${t.modelo}, ${t.harness ?? "auto"},
          ${t.retomaTurnoId ?? null}, ${t.reenvios ?? 0}, ${t.executor}, ${t.localityReason ?? "tudo_local_nesta_rodada"},
          ${t.decididoPor ?? "regra:localidade"}, ${t.mensagemOrigemId ?? null}, ${t.sobProcuracaoDe ?? null}, ${t.ligacaoId ?? null},
          ${t.trabalhoId !== undefined ? t.trabalhoId : t.retomaTurnoId ? conn`(select r.trabalho_id from turnos r where r.tenant_id = ${escopo.tenantId} and r.id = ${t.retomaTurnoId})` : null},
          ${dataOuNull(t.acordarEm)}, ${t.maquinaDestaVez ?? null}, ${t.pessoaEsperando === true},
          ${t.contaminadoDe ? conn`(select o.contaminado_em from turnos o where o.tenant_id = ${escopo.tenantId} and o.id = ${t.contaminadoDe})` : null},
          ${t.tentativasTransitorias ?? 0},
          -- ADR-130: a faixa da conversa. A retomada e a repetição herdam a do turno que continuam (nunca saem dos bastidores).
          ${nasceNosBastidores(t)}::boolean or exists (select 1 from turnos b where b.tenant_id = ${escopo.tenantId}
            and b.id = any(${[t.retomaTurnoId, t.contaminadoDe].filter((x): x is string => !!x)}::uuid[]) and b.bastidores),
          ${turnoNovoParaCota(t)})
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraTurno(l) : null;
    },

    /** O turno disparado por esta fala da pessoa (NOD-156: o reenvio idempotente devolve o mesmo turno). */
    async buscarPorMensagemOrigem(mensagemId: string): Promise<Turno | null> {
      const [l] = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from turnos where tenant_id = ${escopo.tenantId} and mensagem_origem_id = ${mensagemId}
        order by criado_em, id limit 1`;
      return l ? paraTurno(l) : null;
    },

    async buscar(id: string): Promise<Turno | null> {
      const [l] = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from turnos where tenant_id = ${escopo.tenantId} and id = ${id}`;
      return l ? paraTurno(l) : null;
    },

    /**
     * Leitura com trava de linha (FOR UPDATE) para quem vai ASSENTAR o turno. medido em 2026-09-16 (e2e da L9):
     * Parar e a entrega do laço correm em transações paralelas — a entrega lia `parar_solicitado_em` NULL
     * (leitura sem trava, READ COMMITTED) e só esperava o commit de Parar no UPDATE seguinte, assentando
     * 'sem_progresso' em vez de 'parado_pela_pessoa'. Com a trava, a leitura espera o commit e vê o pedido.
     */
    async buscarTravado(id: string): Promise<Turno | null> {
      const [l] = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from turnos where tenant_id = ${escopo.tenantId} and id = ${id} for update`;
      return l ? paraTurno(l) : null;
    },

    /**
     * Reivindicação por UPDATE condicional + FOR UPDATE SKIP LOCKED numa tx curta (ADR-010).
     * EMENDA 12: turno de conversa/sala/retomada passa na frente de rotina enfileirada.
     * ADR-099 (I6): e, antes de todos eles (menos a ligação), a fala da pessoa na conversa direta — ver o `order by`.
     * EMENDA 13 (agente serial) revista em 2026-10-07 pela ADR-083: a serialização é por FAIXA — a conversa (turno sem
     * trabalho) ou o trabalho —, não mais por agente. O mesmo bot roda a conversa e vários trabalhos ao mesmo tempo.
     *
     * medido em 2026-09-16 (tests/concurrency/serializacao-por-conversa.test.ts, duas conexões
     * reivindicando ao mesmo tempo): só NOT EXISTS + SKIP LOCKED SOBREPÔS — a segunda conexão pulou
     * a linha travada e levou o OUTRO turno da mesma conversa, porque o 'despachando' da primeira
     * ainda não estava commitado (READ COMMITTED). Entrou o fallback anotado no plano: um
     * pg_advisory_xact_lock por (tenant, pessoa) serializa as reivindicações da MESMA pessoa (fila
     * por pessoa, ADR-007); a segunda espera o commit da primeira e então enxerga o 'despachando'.
     * Pessoas diferentes não se bloqueiam. Chamado sobre um pool, abre a própria tx curta.
     *
     * NOD-171: com `harnessesProntosPessoa` (os prontos de todas as máquinas vivas da pessoa), pega também o turno
     * fixado num harness que não está pronto em NENHUMA delas; o despacho o recusa nomeando o harness. Sem isso ele
     * ficava pendente sem aviso no app do Mac. O fixado que outra máquina tem pronto continua esperando por ela.
     * 0068: `harnessesAuto` (ausente = os prontos) são as IAs desta máquina que valem para o turno do Automático — sem a
     * que está no limite enquanto a pessoa tiver outra fora dele (iasParaOAutomatico).
     */
    async reivindicar(p: { machineId: string; agora: number; harnessesProntos?: readonly string[]; harnessesAuto?: readonly string[]; harnessesProntosPessoa?: readonly string[]; aceitaLigacao?: boolean; segurarFundo?: boolean; espacarFundo?: boolean; segurarNovo?: boolean; fundoSemPrazo?: boolean; soComoAlvo?: boolean; soDaPessoa?: boolean; cota?: PortaoDaCota | null; declinio?: { ias: readonly string[]; auto: boolean } | null }): Promise<Turno | null> {
      const dentro = async (trx: Conn): Promise<Turno | null> => {
        await trx`select pg_advisory_xact_lock(hashtext(${`${escopo.tenantId}:${escopo.pessoaId}`}))`;
        // NOD-94 (emenda 11 da ADR-090): a máquina só-computador nunca pega turno, venha o puxar de onde vier (o papel é o
        // gravado no pareamento, não o anunciado). `id::text`: no modo local o Mac do servidor não tem chave (nem uuid).
        const [soComputador] = await trx`select 1 from maquina_tokens where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId}
          and id::text = ${p.machineId} and papel = 'computador'`;
        if (soComputador) return null;
        // ADR-090: a máquina-alvo do turno `t` (alvo-da-maquina.ts; a lista de trabalhos usa a mesma regra).
        const alvo = alvoDoTurno(trx, p.agora);
        // definido em 2026-10-12 (ADR-099 §7): o portão da cota. A IA do turno: a fixada, ou (Automático) a regra das IAs que
        // podem pegá-lo, decidida antes (portaoDaCota). Mesma regra de `tipoParaCota` e `cotaSegura` (domain/cota-da-ia.ts).
        const cota = p.cota ?? null;
        const iaDoTurno = iaDoTurnoSql(trx);
        const declinio = p.declinio && p.declinio.ias.length > 0 ? p.declinio : null;
        const [l] = await trx<Linha[]>`
          update turnos set estado = 'despachando', machine_id = ${p.machineId}, lease_ate = ${data(p.agora + LEASE_MS)}, attempted = true,
            -- NOD-276 (J3): a hora em que a máquina pegou o turno; "Trabalhando · há N" conta daqui (criado_em é a fila).
            despachado_em = ${data(p.agora)}
          where (tenant_id, id) = (
            select t.tenant_id, t.id from turnos t
            where t.tenant_id = ${escopo.tenantId} and t.owner_id = ${escopo.pessoaId} and t.estado = 'pendente'
              -- ADR-086: a retomada marcada para mais tarde ("me chame às 16:00") só sai a partir da hora.
              and (t.acordar_em is null or t.acordar_em <= ${data(p.agora)})
              -- ADR-090 (revisão do PR): a máquina que é o alvo do turno o pega mesmo sem a IA pronta; o despacho recusa nomeando a
              -- IA (NOD-171), em vez de o turno esperar em silêncio uma máquina que nunca vai pegá-lo.
              ${p.harnessesProntos === undefined ? trx`` : trx`and (${alvo} = ${p.machineId} or (t.harness = 'auto' and t.modelo = 'auto' and ${(p.harnessesAuto ?? p.harnessesProntos).length > 0}) or (not (t.harness = 'auto' and t.modelo = 'auto') and ${iaDoTurno} = any(${[...p.harnessesProntos]}::text[]))
                ${p.harnessesProntosPessoa === undefined ? trx`` : trx`or (not (t.harness = 'auto' and t.modelo = 'auto') and ${iaDoTurno} <> all(${[...p.harnessesProntosPessoa]}::text[]))`})`}
              and exists (select 1 from agentes a where a.tenant_id = t.tenant_id and a.id = t.agente_id and a.excluido_em is null and a.geracao_execucao = t.geracao_execucao)
              -- Jornada C do onboarding (2026-11-07): a fala da pessoa guardada sem IA (a negação aguardaIa do turno, gravada
              -- só com NOD_ONBOARDING_TEXTO=1) espera uma máquina com a IA dela pronta — a máquina-alvo sem IA não a pega para
              -- recusar, como faz com o resto (acima). Rotina, catcher, ligação e o turno sem a fala guardada não mudam.
              ${p.harnessesProntos === undefined ? trx`` : trx`and not (t.origem = 'conversa'
                and not ((t.harness = 'auto' and t.modelo = 'auto' and ${(p.harnessesAuto ?? p.harnessesProntos).length > 0}) or (not (t.harness = 'auto' and t.modelo = 'auto') and ${iaDoTurno} = any(${[...p.harnessesProntos]}::text[])))
                and exists (select 1 from mensagens g where g.tenant_id = t.tenant_id and g.turno_id = t.id and g.kind = 'negacao' and g.payload->>'aguardaIa' = 'true'))`}
              -- definido em 2026-10-22 (ADR-121, NOD-92): a máquina na nuvem que adormece, dorme ou acorda não pega turno até
              -- falar com o servidor depois de ligar (ligou_em). Sob a mesma trava da pessoa que o dormir toma: o turno
              -- que chegou antes do sono a segura acordada; o que chega depois espera ela acordar.
              and not exists (select 1 from maquinas_nuvem mn join maquina_tokens kn on kn.tenant_id = mn.tenant_id and kn.id = mn.maquina_id
                where mn.tenant_id = ${escopo.tenantId} and mn.maquina_id::text = ${p.machineId} and mn.estado in ('adormecendo', 'dormindo', 'acordando')
                  and not (mn.ligou_em is not null and kn.ultimo_uso_em > mn.ligou_em))
              -- definido em 2026-10-09 (ADR-090): onde o bot trabalha (o alvo, abaixo). O turno só sai para o alvo; sem alvo, para
              -- qualquer máquina.
              -- A ligação não espera a máquina do bot: a pessoa está na linha, e o cérebro roda em qualquer máquina com voz.
              and (t.origem = 'ligacao' or coalesce(${alvo}, ${p.machineId}) = ${p.machineId})
              -- ADR-092: com o servidor no Mac (modo local), a máquina conectada pela ponte só pega o turno que tem ELA como alvo
              -- (o bot escolhido para ela, ou o padrão da pessoa): sem alvo, o turno é do Mac, onde estão os arquivos dos bots.
              ${p.soComoAlvo === true ? trx`and ${alvo} = ${p.machineId}` : trx``}
              -- definido em 2026-10-26 (ADR-130): a máquina drenando para se atualizar (ADR-100) só pega o que a pessoa espera
              -- agora: a faixa dela na conversa (fora de trabalho e fora dos bastidores), a ligação e o turno que ela olha.
              ${p.soDaPessoa === true ? trx`and (t.origem = 'ligacao' or t.pessoa_esperando or (t.trabalho_id is null and not t.bastidores))` : trx``}
              -- definido em 2026-10-04 (ADR-072): o turno da ligação não serializa com o trabalho do bot, nos dois
              -- sentidos — a conversa por voz segue enquanto o bot trabalha, e o trabalho segue durante a ligação. Só
              -- vai para a máquina que anunciou o laço de voz, e passa na frente da fila (a pessoa está esperando).
              and ((t.origem = 'ligacao' and ${p.aceitaLigacao === true})
                or (t.origem <> 'ligacao' and t.trabalho_id is null
                  -- revisto em 2026-10-07 (ADR-083 §3): a faixa é coalesce(trabalho_id, conversa_id). O turno da conversa
                  -- espera só outro turno da MESMA conversa sem trabalho. De propósito: o mesmo bot responde ao mesmo
                  -- tempo na conversa direta e numa sala (conversas diferentes), e o trabalho dele não segura a conversa.
                  -- revisto em 2026-10-26 (ADR-130): e da MESMA faixa (turnos.bastidores). A fala da pessoa não espera a triagem de uma
                  -- rotina ou de um colega, que não a ouve no meio; a triagem não espera a pessoa. Cada faixa segue serial.
                  and not ${faixaOcupadaSql(trx)})
                or (t.origem <> 'ligacao' and t.trabalho_id is not null
                  -- O turno de um trabalho espera só outro turno do MESMO trabalho e o trabalho de que ele depende
                  -- ("Fazer depois da …"), até ele terminar, parar ou falhar.
                  and not exists (select 1 from turnos d where d.tenant_id = t.tenant_id and d.trabalho_id = t.trabalho_id and d.estado = 'despachando')
                  -- revisto em 2026-11-10 (ADA-16, ADR-163): a tarefa do quadro (trabalho de origem 'quadro') NÃO tem teto
                  -- próprio por bot nem por máquina. Tarefas diferentes rodam juntas; a mesma tarefa com o mesmo bot segue
                  -- em série pela regra acima (o mesmo trabalho). O freio de recurso é o do nod: o portão da máquina abaixo
                  -- (ADR-085) e o pool elástico de laços do executor.
                  -- definido em 2026-10-08 (ADR-085): com o Mac apertado (pelo "uso do Mac" da pessoa), trabalho NOVO em
                  -- segundo plano — rotina ou pedido de colega que ainda não começou — espera. O que já começou segue,
                  -- e o que a pessoa espera também (a task que ela abriu, "Executar agora", o pedido feito na conversa).
                  -- Revisão do #209: a espera vai até ESPERA_MAXIMA_FUNDO_MS; e, logo depois de um trabalho novo em
                  -- segundo plano começar neste Mac (espacarFundo), o próximo espera, mesmo o que passou da espera máxima.
                  -- Mesma regra de seguravelPeloMac (domain/memoria-mac.ts). ADA-16 (ADR-163): a tarefa do quadro, que
                  -- agora roda em paralelo, também é segurada pelo Mac apertado (a primeira etapa dela; a seguinte já
                  -- começou), mas não entra no espaço de 30 s, que a serializaria; sem teto próprio, o freio dela é este portão.
                  ${p.espacarFundo !== true && p.segurarFundo !== true ? trx`` : trx`and not exists (select 1 from trabalhos w where w.tenant_id = t.tenant_id and w.id = t.trabalho_id
                    and w.iniciado_em is null and not w.pessoa_esperando and (false
                    ${p.espacarFundo === true ? trx`or w.origem in ('rotina', 'colega')` : trx``}
                    ${p.segurarFundo === true ? trx`or (w.origem in ('rotina', 'colega', 'quadro') ${p.fundoSemPrazo === true ? trx`` : trx`and w.criado_em > ${data(p.agora - ESPERA_MAXIMA_FUNDO_MS)}`})` : trx``}))`}
                  -- revisto em 2026-10-09 (revisão do #224, decisão do coordenador do #221): a volta marcada ("me chame às
                  -- 16:00", ADR-086) é o próximo passo de uma task já começada — o segundo plano apertado e o espaço entre
                  -- dois começos não a seguram mais (era a revisão do #212); só o disco crítico (segurarNovo, abaixo).
                  -- definido em 2026-10-09 (#219, emenda à ADR-085): com a memória crítica (fundoSemPrazo) o segundo plano
                  -- novo espera mesmo passado da espera máxima (a volta marcada, não: acima). Com o disco crítico (segurarNovo) NENHUM trabalho novo começa, de
                  -- qualquer origem, mesmo com a pessoa esperando, nem a volta marcada. O que já começou segue (o turno
                  -- seguinte de uma task em andamento não espera). Mesma regra de esperaDoMac (domain/memoria-mac.ts).
                  ${p.segurarNovo !== true ? trx`` : trx`and t.acordar_em is null and not exists (select 1 from trabalhos w where w.tenant_id = t.tenant_id and w.id = t.trabalho_id and w.iniciado_em is null)`}
                  and not exists (select 1 from trabalhos x join trabalhos dep on dep.tenant_id = x.tenant_id and dep.id = x.depois_de_trabalho_id
                    where x.tenant_id = t.tenant_id and x.id = t.trabalho_id and dep.estado not in ('terminado', 'parado', 'falhou'))))
              -- definido em 2026-10-12 (ADR-099 §7): a cota da IA segura o fundo (seguradoPelaCotaSql, acima).
              ${cota === null ? trx`` : trx`and not ${seguradoPelaCotaSql(trx, cota)}`}
              -- definido em 2026-10-20 (NOD-301, emenda da ADR-102): sem conta livre da IA do turno nesta máquina e com conta
              -- livre dela noutra máquina viva (iasSoNoutraMaquina), o turno sem alvo passa para a outra por até
              -- ESPERA_DECLINIO_MS, contados de greatest(criado_em, acordar_em) (o Postgres ignora o null: a volta marcada conta
              -- da hora dela). A ligação nunca declina. A task com sessão do CLI também não: a sessão é desta máquina (ADR-108 E1).
              ${declinio === null ? trx`` : trx`and not (${alvo} is null and t.origem <> 'ligacao'
                and greatest(t.criado_em, t.acordar_em) > ${data(p.agora - ESPERA_DECLINIO_MS)}
                and not exists (select 1 from trabalhos w where w.tenant_id = t.tenant_id and w.id = t.trabalho_id and w.sessao_cli is not null)
                and ((t.harness = 'auto' and t.modelo = 'auto' and ${declinio.auto}::boolean) or (not (t.harness = 'auto' and t.modelo = 'auto') and ${iaDoTurno} = any(${[...declinio.ias]}::text[]))))`}
            -- Ligação primeiro; depois a fala da pessoa; depois o que não é rotina nem pedido de colega (o turno ou o trabalho
            -- dele); depois a ordem.
            order by (t.origem = 'ligacao') desc,
              -- A pessoa passa na frente na fila do dono: o turno de conversa que nasceu de uma fala dela (origem 'conversa'
              -- com mensagem_origem_id, o mesmo marcador de absorverPendentes) sai antes da volta marcada (me_chame_as), do
              -- despertar de uma espera, da continuação de colega e de qualquer retorno ao dono. Só fura a fila dos
              -- pendentes: a conversa com turno despachando continua esperando (o not exists acima). Sala, ligação e a
              -- faixa do trabalho não mudam. Entre duas falas dela, vale a ordem de chegada (criado_em, abaixo).
              -- definido em 2026-10-12 (ADR-099, I6)
              (t.trabalho_id is null and t.origem = 'conversa' and t.mensagem_origem_id is not null) desc,
              (t.origem in ('rotina', 'delegacao', 'peer') or (t.trabalho_id is not null and exists (select 1 from trabalhos x where x.tenant_id = t.tenant_id and x.id = t.trabalho_id and x.origem in ('rotina', 'colega')))) asc,
              t.criado_em asc, t.id asc
            for update skip locked limit 1)
          returning ${trx.unsafe(COLUNAS)}`;
        // NOD-92 (revisão B1, ADR-121): pegar um turno é atividade da máquina na nuvem; o ocioso conta daqui, não do poll.
        if (l) await trx`update maquinas_nuvem set ultima_atividade_em = ${data(p.agora)} where tenant_id = ${escopo.tenantId} and maquina_id = ${p.machineId} and estado <> 'excluida'`;
        return l ? paraTurno(l) : null;
      };
      // Pool (tem `begin`): a trava só vale dentro de uma transação — abre uma curta. Tx: usa a corrente.
      // definido em 2026-10-15 (NOD-266): a curta é a escopada (prazo de conexão, timeouts, escopo da RLS). Antes era um
      // `conn.begin` cru — sem prazo, pendurava com o pool cheio, e sem escopo a RLS a fazia achar nada.
      if ("begin" in conn && typeof conn.begin === "function") return abrirTxEscopada(conn, escopo)(dentro);
      return dentro(conn);
    },

    /**
     * NOD-302 (continuação da NOD-253): os turnos que a cota segura agora nesta máquina — pendentes, na hora, do bot vivo, com
     * esta máquina como alvo (ou sem alvo) e que o `reivindicar` pularia só pela cota (`seguradoPelaCotaSql`, o mesmo
     * predicado). Do mais antigo ao mais novo. A nota "Seguir com…" (fundo-segurado-pela-cota.ts) vai na conversa do mais
     * antigo de cada bot; a linha a quem pediu, em cada pedido de colega.
     */
    async seguradosPelaCota(p: { machineId: string; agora: number; cota: PortaoDaCota; limite?: number }): Promise<Turno[]> {
      const alvo = alvoDoTurno(conn, p.agora);
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS.split(", ").map((c) => `t.${c}`).join(", "))} from turnos t
        where t.tenant_id = ${escopo.tenantId} and t.owner_id = ${escopo.pessoaId} and t.estado = 'pendente'
          and (t.acordar_em is null or t.acordar_em <= ${data(p.agora)})
          and exists (select 1 from agentes a where a.tenant_id = t.tenant_id and a.id = t.agente_id and a.excluido_em is null and a.geracao_execucao = t.geracao_execucao)
          and coalesce(${alvo}, ${p.machineId}) = ${p.machineId}
          and ${seguradoPelaCotaSql(conn, p.cota)}
        order by t.criado_em asc, t.id asc
        limit ${p.limite ?? 200}`;
      return linhas.map(paraTurno);
    },

    /**
     * NOD-302: os pedidos de colega sem task ainda na fila (o turno de triagem `delegacao`, ou `peer`, pendente). A tela de
     * Trabalhos mostra os que a cota da IA do bot segura como "na fila (cota)".
     */
    async pedidosNaFila(p: { agenteId?: string; limite?: number } = {}): Promise<Turno[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from turnos
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and estado = 'pendente' and trabalho_id is null
          and origem in ('delegacao', 'peer') ${p.agenteId ? conn`and agente_id = ${p.agenteId}` : conn``}
        order by criado_em asc, id asc
        limit ${p.limite ?? 100}`;
      return linhas.map(paraTurno);
    },

    /**
     * Batida de 30s (ADR-009/021): os quatro sinais viajam a cada renovação; {ativo:false} quando
     * a pessoa pediu Parar ou o turno já não é desta máquina — o executor aborta.
     */
    /**
     * revisto em 2026-10-12 (NOD-214): `sessaoCli` (a sessão do CLI que a máquina mandou na renovação) é gravada já aqui,
     * não só na entrega — se a entrega se perder num reinício, o assentamento pelo lease ainda a propaga. `aceitaVencido`
     * só na adoção dentro da carência do boot: o lease venceu enquanto o servidor estava fora, mas o turno segue
     * `despachando` (o varredor não o assentou).
     */
    async renovarLease(id: string, machineId: string, sinais: Partial<SinaisTurno>, agora: number, o: { sessaoCli?: string | null; aceitaVencido?: boolean } = {}): Promise<{ ativo: boolean; motivo?: Exclude<MotivoRenovacaoNegada, "sem_plano"> }> {
      const [l] = await conn<{ ativo: boolean; parado: boolean }[]>`
        update turnos set
          lease_ate = case when estado = 'despachando' and parar_solicitado_em is null and exists (select 1 from agentes a where a.tenant_id = turnos.tenant_id and a.id = turnos.agente_id and a.excluido_em is null and a.geracao_execucao = turnos.geracao_execucao) then ${data(agora + LEASE_MS)} else lease_ate end,
          attempted = attempted or ${sinais.attempted ?? false},
          rejected = rejected or ${sinais.rejected ?? false},
          prompt_submitted = prompt_submitted or ${sinais.promptSubmitted ?? false},
          produced_output = produced_output or ${sinais.producedOutput ?? false},
          sessao_cli = coalesce(${o.sessaoCli ?? null}, sessao_cli)
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and machine_id = ${machineId}
          and (lease_ate > ${data(agora)} or (${o.aceitaVencido === true} and estado = 'despachando'))
        returning (estado = 'despachando' and parar_solicitado_em is null and exists (select 1 from agentes a where a.tenant_id = turnos.tenant_id and a.id = turnos.agente_id and a.excluido_em is null and a.geracao_execucao = turnos.geracao_execucao)) as ativo,
          (estado <> 'despachando' or parar_solicitado_em is not null) as parado`;
      // NOD-264 (C20): por que negou, em código (vira a causa do turno_interrompido).
      if (!l) return { ativo: false, motivo: "lease_vencido" };
      if (l.ativo) return { ativo: true };
      return { ativo: false, motivo: l.parado ? "parado" : "agente_excluido" };
    },

    /** Write-ahead (ADR-009): promptSubmitted é gravado ANTES de escrever no stdin. Só liga, nunca desliga. */
    async marcarSinal(id: string, sinal: keyof SinaisTurno): Promise<boolean> {
      const coluna = { attempted: "attempted", rejected: "rejected", promptSubmitted: "prompt_submitted", producedOutput: "produced_output" }[sinal];
      const r = await conn`update turnos set ${conn(coluna)} = true where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}`;
      return r.count === 1;
    },

    /**
     * NOD-323: soma as recusas de mídia do proxy (código e contagem, nunca caminho) às que o turno já tinha, num UPDATE
     * só (sem ler antes): dois relatos ao mesmo tempo não se perdem. Turno que já assentou não muda.
     */
    async somarRecusasDeMidia(id: string, recusas: RecusasMidia): Promise<boolean> {
      const r = await conn`
        update turnos set midia_recusas = (
          select jsonb_agg(jsonb_build_object('motivo', q.motivo, 'n', least(q.n, 1000)) order by q.motivo)
          from (
            select x->>'motivo' as motivo, sum((x->>'n')::int)::int as n
            from jsonb_array_elements(coalesce(midia_recusas, '[]'::jsonb) || ${conn.json(recusas)}::jsonb) as x
            group by 1
          ) q)
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and estado = 'despachando'`;
      return r.count === 1;
    },

    /** NOD-323: as recusas de mídia do turno, para a linha discreta abaixo da fala final. */
    async recusasDeMidia(id: string): Promise<RecusasMidia | null> {
      const [l] = await conn<{ midia_recusas: RecusasMidia | null }[]>`select midia_recusas from turnos where tenant_id = ${escopo.tenantId} and id = ${id}`;
      return l?.midia_recusas ?? null;
    },

    /**
     * A ferramenta `sem_novidade` pediu silêncio (definido em 2026-09-21). Só liga, nunca desliga —
     * como marcarSinal: o agente pode chamar duas vezes, e a primeira decisão prevalece. O
     * assentamento lê isso em buscarTravado, na mesma tx.
     */
    async marcarSemNovidade(id: string, motivo: MotivoSemNovidade): Promise<boolean> {
      const r = await conn`
        update turnos set sem_novidade_motivo = coalesce(sem_novidade_motivo, ${motivo})
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}`;
      return r.count === 1;
    },

    /**
     * definido em 2026-09-28 (0032): serializa quem cria retomada de um MESMO turno — decisões decididas em
     * sequência e o assentamento dele. Sem a trava, duas aprovações seguidas viravam duas retomadas.
     */
    async travarRetomadas(retomaTurnoId: string): Promise<void> {
      await conn`select pg_advisory_xact_lock(hashtext(${escopo.tenantId}), hashtext(${`retomada:${retomaTurnoId}`}))`;
    },

    /**
     * NOD-309 (PR 3): quantas vezes a cadeia (a raiz e as retomadas dela, em qualquer profundidade) caiu por infraestrutura, fora `exceto` — o teto
     * de quedas da espera no fundo. A mesma régua das consultas de pedido parado e frente caída.
     * revisto em 2026-10-28 (NOD-386): só as quedas de `desde` em diante (a janela de 2 h, JANELA_QUEDAS_NO_FUNDO_MS), pela
     * hora da queda (`ultimo_sinal_em`, 0076; sem ela, a criação do turno).
     */
    async quedasDaCadeia(raizId: string, exceto: string, desde: number): Promise<number> {
      const [l] = await conn<{ n: number }[]>`
        with recursive cadeia as (
          select id from turnos where tenant_id = ${escopo.tenantId} and id = ${raizId}
          union
          select t.id from turnos t join cadeia c on t.retoma_turno_id = c.id where t.tenant_id = ${escopo.tenantId}
        )
        select count(*)::int as n from turnos q join cadeia c on c.id = q.id
        where q.tenant_id = ${escopo.tenantId} and q.id <> ${exceto} and q.estado = 'interrompido'
          and q.motivo_interrupcao::text = any(${MOTIVOS_DE_QUEDA.filter((m) => !QUEDAS_FORA_DO_TETO.includes(m))}::text[])
          and coalesce(q.motivo_falha::text, '') <> all(${[...MOTIVOS_FALHA_SEM_QUEDA]}::text[])
          and coalesce(q.ultimo_sinal_em, q.criado_em) >= ${data(desde)}`;
      return l?.n ?? 0;
    },

    /**
     * NOD-277 (definido em 2026-10-15): trocar a IA ou o modelo do bot vale para o fundo que já está na fila. Os turnos
     * `pendente` de fundo do bot sem task — de rotina, de pedido de colega e as retomadas deles — passam
     * para a IA nova, perdem a conta gravada (o próximo plano escolhe de novo) e, se esperavam a cota (o marcador da volta
     * da cota), acordam: o portão da cota segura de novo se a IA nova também estiver no limite. A conversa, a sala e a
     * ligação ficam como estão (ADR-036: a fala segue na IA que a pessoa viu). Pega a mesma trava do `reivindicar`
     * (tenant:pessoa): o turno sai inteiro numa IA, uma vez só. Não muda o estado (sem-requeue). Devolve quantos mudaram.
     * Os turnos de task (`trabalho_id`) ficam de fora: seguem a escolha "Só daqui em diante" / "Levar as tasks também" do
     * ADR-108 (`levarTasksDoBot`, merge do #358).
     */
    async reescreverFundoDoBot(agenteId: string, para: { harness: PreferenciaHarness; modelo: string }): Promise<number> {
      await conn`select pg_advisory_xact_lock(hashtext(${`${escopo.tenantId}:${escopo.pessoaId}`}))`;
      const linhas = await conn`
        with recursive cadeia(id, raiz, saltos) as (
          select t.id, t.retoma_turno_id, 0 from turnos t
          where t.tenant_id = ${escopo.tenantId} and t.owner_id = ${escopo.pessoaId} and t.agente_id = ${agenteId} and t.estado = 'pendente' and t.origem = 'retomada' and t.trabalho_id is null
          union all
          select c.id, r.retoma_turno_id, c.saltos + 1 from cadeia c join turnos r on r.tenant_id = ${escopo.tenantId} and r.id = c.raiz
          where r.origem = 'retomada' and c.saltos < 50
        ),
        retomadas_de_fundo as (
          select c.id from cadeia c join turnos r on r.tenant_id = ${escopo.tenantId} and r.id = c.raiz where r.origem in ('rotina', 'delegacao', 'peer')
        )
        update turnos t set harness = ${para.harness}, modelo = ${para.modelo}, conta_id = null,
          acordar_em = case when starts_with(t.entrada_texto, ${ENTRADA_DA_VOLTA_DA_COTA}) then null else t.acordar_em end
        where t.tenant_id = ${escopo.tenantId} and t.owner_id = ${escopo.pessoaId} and t.agente_id = ${agenteId} and t.estado = 'pendente' and t.origem <> 'ligacao'
          and t.trabalho_id is null and (t.origem in ('rotina', 'delegacao', 'peer') or t.id in (select id from retomadas_de_fundo))
        returning t.id`;
      return linhas.length;
    },

    /**
     * NOD-277/NOD-279 (definido em 2026-10-15): a espera da cota acaba quando a pessoa resolve — "Seguir com <conta>", conta
     * nova na máquina, trocar a IA do bot. Zera o `acordar_em` dos pendentes do dono marcados como volta da cota
     * (`ENTRADA_DA_VOLTA_DA_COTA`) cuja IA (a mesma expressão do `reivindicar`: a fixada, ou a dona do modelo) é `ia`.
     * revisto em 2026-10-20 (NOD-309, PR 4): o fundo no Automático (auto/auto) também acorda — qualquer IA liberada pode
     * servi-lo, e o portão da cota no `reivindicar` segura de novo se nenhuma puder. Antes ele ficava a espera inteira
     * mesmo com "Seguir com" ou conta nova. A volta da nova tentativa (`ENTRADA_DA_NOVA_TENTATIVA`, o backoff do erro
     * transitório) não tem o marcador da cota e nunca acorda aqui. `turnoId` restringe a um turno (a aprovação que se junta à volta, NOD-279 D8). O portão
     * da cota segue valendo: se o limite persistir, o turno acordado continua segurado. A volta marcada pelo bot
     * (`me_chame_as`, esperar comando) não tem o marcador e não acorda. Devolve os ids acordados.
     */
    async anteciparEsperasDaCota(ia: string | null, opcoes: { turnoId?: string; agenteId?: string } = {}): Promise<string[]> {
      const porIa = modelosPorIa();
      const linhas = await conn<{ id: string }[]>`
        update turnos t set acordar_em = null
        where t.tenant_id = ${escopo.tenantId} and t.owner_id = ${escopo.pessoaId} and t.estado = 'pendente' and t.acordar_em is not null
          and starts_with(t.entrada_texto, ${ENTRADA_DA_VOLTA_DA_COTA})
          ${opcoes.turnoId === undefined ? conn`` : conn`and t.id = ${opcoes.turnoId}`}
          ${opcoes.agenteId === undefined ? conn`` : conn`and t.agente_id = ${opcoes.agenteId}`}
          ${ia === null ? conn`` : conn`and ((t.harness = 'auto' and t.modelo = 'auto')
            or (case when t.harness <> 'auto' then t.harness else coalesce((select x.ia from unnest(${porIa.modelos}::text[], ${porIa.ias}::text[]) as x(modelo, ia) where x.modelo = t.modelo), ${HARNESS_LEGADO}) end) = ${ia})`}
        returning t.id`;
      return linhas.map((l) => l.id);
    },

    /**
     * NOD-279 (D8): a volta da cota que ainda está na fila para este trabalho (a mais antiga): a aprovação que chega durante
     * a espera se junta a ela em vez de abrir uma segunda retomada. A cadeia da cota usa `retomaTurnoId ?? id` e a retomada
     * usa o turno da decisão, por isso a busca é pelo trabalho.
     */
    async voltaDaCotaNaFila(trabalhoId: string): Promise<Turno | null> {
      const [l] = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from turnos
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and trabalho_id = ${trabalhoId} and origem = 'retomada' and estado = 'pendente'
          -- NOD-309: a volta da nova tentativa (erro transitório) e a retomada da queda também recebem a aprovação, em vez de abrir uma segunda.
          and acordar_em is not null and exists (select 1 from unnest(${[...PREFIXOS_DA_VOLTA_DO_FUNDO]}::text[]) p where starts_with(entrada_texto, p))
        order by criado_em asc, id asc limit 1`;
      return l ? paraTurno(l) : null;
    },

    /** A retomada deste turno que ainda não foi reivindicada: a próxima continuação se junta a ela. */
    async retomadaNaFila(retomaTurnoId: string): Promise<Turno | null> {
      const [l] = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from turnos
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and retoma_turno_id = ${retomaTurnoId} and origem = 'retomada' and estado = 'pendente'
          -- ADR-086 (revisão do #212): a volta marcada não recebe a continuação — uma aprovação colada nela esperaria a hora.
          and (acordar_em is null or acordar_em <= now())
        order by criado_em desc limit 1`;
      return l ? paraTurno(l) : null;
    },

    /**
     * ADR-086 (revisão do #212): `me_chame_as` só anota o pedido no turno que está rodando — a volta nasce no
     * assentamento. Só turno vivo e sem Parar pedido; a última chamada vale (uma volta por turno).
     */
    async marcarDespertar(id: string, em: number, motivo: string, cond: CondicaoDaVolta | null = null): Promise<boolean> {
      // ADA-232: a volta por evento (CI; desde 2026-11-10 também merge, conflito e outra tarefa) anota a condição no turno
      // que chamou; a retomada a herda no assentamento (marcarVoltaPorEvento).
      const c = colunasDaCondicao(cond);
      const linhas = await conn`
        update turnos set despertar_em = ${data(em)}, despertar_motivo = ${motivo},
          acordar_quando = ${c.quando}, acordar_pr_url = ${c.prUrl}, acordar_tarefa_id = ${c.tarefaId}, acordar_tarefa_estado = ${c.estado}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and estado = 'despachando' and parar_solicitado_em is null
        returning id`;
      return linhas.length > 0;
    },

    /** ADR-086: o pedido de volta que o turno anotou (null = nenhum), com a condição por evento. */
    async despertarDoTurno(id: string): Promise<{ em: number; motivo: string; cond: CondicaoDaVolta | null } | null> {
      const [l] = await conn<({ despertar_em: Date | null; despertar_motivo: string | null } & LinhaDaCondicao)[]>`
        select despertar_em, despertar_motivo, acordar_quando, acordar_pr_url, acordar_tarefa_id, acordar_tarefa_estado from turnos where tenant_id = ${escopo.tenantId} and id = ${id}`;
      return l?.despertar_em ? { em: ms(l.despertar_em), motivo: l.despertar_motivo ?? "", cond: condicaoDaLinha(l) } : null;
    },

    /** ADA-232: a retomada da volta por evento (pendente) espera a condição; acordar_em segue como o prazo máximo. */
    async marcarVoltaPorEvento(id: string, cond: CondicaoDaVolta): Promise<void> {
      const c = colunasDaCondicao(cond);
      await conn`update turnos set acordar_quando = ${c.quando}, acordar_pr_url = ${c.prUrl}, acordar_tarefa_id = ${c.tarefaId}, acordar_tarefa_estado = ${c.estado}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and estado = 'pendente'`;
    },

    /** ADA-232: as voltas por evento do dono que ainda dormem (o varredor confere a condição de cada uma). */
    async voltasPorEventoPendentes(agora: number): Promise<{ id: string; cond: CondicaoDaVolta; criadoEm: number; acordarEm: number }[]> {
      const ls = await conn<({ id: string; criado_em: Date; acordar_em: Date } & LinhaDaCondicao)[]>`
        select id, criado_em, acordar_em, acordar_quando, acordar_pr_url, acordar_tarefa_id, acordar_tarefa_estado from turnos
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and estado = 'pendente' and acordar_quando is not null
          and acordar_em > ${data(agora)}
        order by acordar_em limit 200`;
      return ls.flatMap((l) => { const cond = condicaoDaLinha(l); return cond ? [{ id: l.id, cond, criadoEm: ms(l.criado_em), acordarEm: ms(l.acordar_em) }] : []; });
    },

    /**
     * ADA-232: traz a volta que dorme para agora (a CI terminou, ou "Acordar agora" na tela). Idempotente: só a pendente
     * que ainda não venceu; false = já acordou, já rodou ou foi cancelada.
     */
    async acordarVolta(id: string, agora: number): Promise<boolean> {
      const r = await conn`update turnos set acordar_em = ${data(agora)}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and estado = 'pendente'
          and acordar_em is not null and acordar_em > ${data(agora)} returning id`;
      return r.length > 0;
    },

    /**
     * ADR-086: quantas voltas marcadas já retomaram este turno (o teto de voltas seguidas). NOD-279 D8 (definido em
     * 2026-10-15): a volta que a cota marcou (o marcador da cota, como `por_cota` em `ultimasVoltas`) não é do bot e não conta.
     */
    async voltasMarcadas(retomaTurnoId: string): Promise<number> {
      const [l] = await conn<{ n: number }[]>`
        select count(*)::int as n from turnos where tenant_id = ${escopo.tenantId} and retoma_turno_id = ${retomaTurnoId} and acordar_em is not null
          and not exists (select 1 from unnest(${[...PREFIXOS_DA_VOLTA_DO_FUNDO]}::text[]) p where starts_with(entrada_texto, p))`;
      return l?.n ?? 0;
    },

    /**
     * ADR-099 §5 (parte 1, definido em 2026-10-12): as últimas voltas marcadas que retomam este turno, da mais nova para a
     * mais antiga, com o que a regra de "nada novo" lê (src/domain/voltas-sem-novidade.ts): se a volta marcou outra, se
     * abriu decisão e se pediu algo a um colega (mensagem `handoff` dela).
     */
    async ultimasVoltas(retomaTurnoId: string, limite: number): Promise<VoltaDaCadeia[]> {
      const linhas = await conn<{ estado: EstadoTurno; marcou_volta: boolean; perguntou: boolean; pediu_a_colega: boolean; por_cota: boolean }[]>`
        -- ADR-099 (parte 2): deixar um comando esperando (esperar_comando) também é marcar outra volta.
        select t.estado, (t.despertar_em is not null or exists (select 1 from esperas e where e.tenant_id = t.tenant_id and e.turno_id = t.id)) as marcou_volta,
          exists (select 1 from decisoes d where d.tenant_id = t.tenant_id and d.turno_id = t.id) as perguntou,
          exists (select 1 from mensagens m where m.tenant_id = t.tenant_id and m.turno_id = t.id and m.kind = 'handoff') as pediu_a_colega,
          -- ADR-099 §7: a volta que a cota no limite marcou (não o bot) não conta como sem novidade.
          -- NOD-309: a nova tentativa e a retomada da queda também são do nod, não do bot.
          exists (select 1 from unnest(${[...PREFIXOS_DA_VOLTA_DO_FUNDO]}::text[]) p where starts_with(t.entrada_texto, p)) as por_cota
        from turnos t
        where t.tenant_id = ${escopo.tenantId} and t.retoma_turno_id = ${retomaTurnoId} and t.acordar_em is not null
        order by t.criado_em desc, t.id desc limit ${limite}`;
      return linhas.map((l) => ({ estado: l.estado, marcouVolta: l.marcou_volta, perguntou: l.perguntou, pediuAColega: l.pediu_a_colega, porCota: l.por_cota }));
    },

    /**
     * ADR-108 (R4/R5/R6): as tasks pendentes do bot que estão na IA `iaDe` — o turno fixado nela, ou o do Automático cuja
     * task tem a sessão nela (null = todas as tasks pendentes do bot). Só turnos com `trabalho_id`: a conversa não muda.
     */
    async contarTasksNaIa(agenteId: string, iaDe: IdHarness | null): Promise<number> {
      const [l] = await conn<{ n: number }[]>`
        select count(distinct t.trabalho_id)::int as n from turnos t
        where t.tenant_id = ${escopo.tenantId} and t.owner_id = ${escopo.pessoaId} and t.agente_id = ${agenteId} and t.estado = 'pendente' and t.trabalho_id is not null
          and ${daIa(conn, iaDe)}`;
      return l?.n ?? 0;
    },

    /**
     * "Levar as tasks" (ADR-108 R4/R5): os turnos pendentes das tasks do bot na IA `iaDe` passam a rodar em `harness`/
     * `modelo` (fixos naquele turno, como a conversa no #319), e só as esperas da COTA (entrada que começa com
     * ENTRADA_DA_VOLTA_DA_COTA) acordam agora, com a entrada nova — o "me chame às" do bot (ADR-086) segue com a hora dele.
     * Devolve os ids reescritos. NOD-376: guarda desde a primeira marca — o pedido original ou a fala da pessoa na frente.
     */
    async levarTasksDoBot(p: { agenteId: string; iaDe: IdHarness | null; harness: string; modelo: string; entradaDaVolta: string }): Promise<string[]> {
      const linhas = await conn<{ id: string }[]>`
        update turnos t set harness = ${p.harness}, modelo = ${p.modelo},
          acordar_em = case when starts_with(t.entrada_texto, ${ENTRADA_DA_VOLTA_DA_COTA}) then null else t.acordar_em end,
          entrada_texto = case when starts_with(t.entrada_texto, ${ENTRADA_DA_VOLTA_DA_COTA}) then ${p.entradaDaVolta}::text || coalesce(substr(t.entrada_texto, least(nullif(strpos(t.entrada_texto, ${MARCA_DO_PEDIDO_ORIGINAL}::text), 0), nullif(strpos(t.entrada_texto, ${MARCA_DA_FALA_NA_FRENTE}::text), 0))), '')
            else t.entrada_texto end
        where t.tenant_id = ${escopo.tenantId} and t.owner_id = ${escopo.pessoaId} and t.agente_id = ${p.agenteId} and t.estado = 'pendente' and t.trabalho_id is not null
          and ${daIa(conn, p.iaDe)}
        returning t.id`;
      return linhas.map((l) => l.id);
    },

    /**
     * ADR-108 (R6 b, revisão do PR 2, I3): o bot fixo voltou à IA dele — os turnos pendentes das tasks dele que o "Continuar
     * no <outra> até a volta" fixou na outra IA (`harness = de`) voltam à inteligência do bot (`harness`/`modelo`). Não
     * mexe em `acordar_em` nem na entrada. Devolve os ids.
     */
    async trazerTasksDeVolta(p: { agenteId: string; de: IdHarness; harness: string; modelo: string }): Promise<string[]> {
      const linhas = await conn<{ id: string }[]>`
        update turnos t set harness = ${p.harness}, modelo = ${p.modelo}
        where t.tenant_id = ${escopo.tenantId} and t.owner_id = ${escopo.pessoaId} and t.agente_id = ${p.agenteId} and t.estado = 'pendente' and t.trabalho_id is not null
          and t.harness = ${p.de}
        returning t.id`;
      return linhas.map((l) => l.id);
    },

    /** ADR-108 (R6 a, voltou): as esperas da cota das tasks do bot na IA `iaDe` acordam agora (a conta já serve). */
    async acordarEsperasDaCota(agenteId: string, iaDe: IdHarness | null): Promise<number> {
      const linhas = await conn`
        update turnos t set acordar_em = null
        where t.tenant_id = ${escopo.tenantId} and t.owner_id = ${escopo.pessoaId} and t.agente_id = ${agenteId} and t.estado = 'pendente' and t.trabalho_id is not null
          and t.acordar_em is not null and starts_with(t.entrada_texto, ${ENTRADA_DA_VOLTA_DA_COTA}) and ${daIa(conn, iaDe)}
        returning t.id`;
      return linhas.length;
    },

    /** Junta mais uma entrada à retomada que ainda está na fila. Não toca no estado (sem-requeue segue valendo). */
    /** NOD-285 (2026-10-15): com `anexos`, eles se somam aos da retomada na fila (união, sem repetir, na ordem). */
    /**
     * NOD-417 (revisão 2 do PR #622): o turno que já teve a parada pedida não recebe mais nada (0 linhas: quem chama abre um
     * turno novo); com `profundidade`, o turno fica com a maior das duas (o gatilho juntado não sai do limite da corrente).
     */
    async juntarEntrada(id: string, texto: string, anexos: readonly string[] = [], opcoes: { profundidade?: Profundidade } = {}): Promise<Turno | null> {
      const [l] = await conn<Linha[]>`
        update turnos set entrada_texto = entrada_texto || ${`\n\n${texto}`},
          entrada_anexos = array(select a from unnest(entrada_anexos || ${anexos as string[]}::uuid[]) with ordinality as u(a, i) group by a order by min(i)),
          profundidade = greatest(profundidade, ${opcoes.profundidade ?? 0})
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and estado = 'pendente' and parar_solicitado_em is null
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraTurno(l) : null;
    },

    /** O turno que começou a tarefa: sobe pela cadeia de retoma_turno_id (teto de saltos contra ciclo). */
    async raizDaCadeia(id: string): Promise<Turno | null> {
      const [l] = await conn<Linha[]>`
        with recursive cadeia(id, retoma_turno_id, saltos) as (
          select id, retoma_turno_id, 0 from turnos where tenant_id = ${escopo.tenantId} and id = ${id}
          union all
          select t.id, t.retoma_turno_id, c.saltos + 1 from turnos t join cadeia c on t.tenant_id = ${escopo.tenantId} and t.id = c.retoma_turno_id
          where c.saltos < 50
        )
        select ${conn.unsafe(COLUNAS)} from turnos
        where tenant_id = ${escopo.tenantId} and id = (select id from cadeia order by saltos desc limit 1)`;
      return l ? paraTurno(l) : null;
    },

    /** ADR-052 (0033): o turno trouxe conteúdo da web pelas nativas. A primeira marca fica. */
    async contaminar(id: string, agora: number): Promise<boolean> {
      const r = await conn`update turnos set contaminado_em = coalesce(contaminado_em, ${data(agora)}) where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}`;
      return r.count === 1;
    },

    /** NOD-114 (revisão): a task de cada turno numa consulta só — "Sua vez" leva o trabalhoId de cada item sem uma leitura por item. */
    async trabalhosDosTurnos(ids: readonly string[]): Promise<Map<string, string | null>> {
      if (ids.length === 0) return new Map();
      const linhas = await conn<{ id: string; trabalho_id: string | null }[]>`select id, trabalho_id from turnos where tenant_id = ${escopo.tenantId} and id = any(${[...new Set(ids)]}::uuid[])`;
      return new Map(linhas.map((l) => [l.id, l.trabalho_id]));
    },

    async contaminado(id: string): Promise<boolean> {
      const [l] = await conn<{ sim: boolean }[]>`select contaminado_em is not null as sim from turnos where tenant_id = ${escopo.tenantId} and id = ${id}`;
      return l?.sim === true;
    },

    /**
     * definido em 2026-10-18 (plano dos modos de aprovação, revisão de engenharia, item 11): algum turno da conversa leu
     * conteúdo de fora na janela (a marca da 0033) ou entrou não confiável dentro dela. A sessão do CLI carrega o e-mail
     * lido no turno anterior, e a marca do turno não vê isso. Só flags: nenhum texto de mensagem é lido. O corte em
     * `criado_em` (duas janelas) deixa a consulta no índice `turnos_por_conversa`; um turno aberto há mais de duas
     * janelas não conta.
     *
     * Revisão do PR #402: roda num SAVEPOINT próprio, emitida pelo sql DELE. Quem chama é a medição do PR 1, que só
     * observa: se a consulta falha (statement_timeout), só o savepoint volta. Emitida pelo `conn` da transação, o
     * postgres.js guarda o erro no escopo de fora mesmo com o catch de quem chama, e o COMMIT do caso de uso vira
     * ROLLBACK (o comando aprovado perde a trilha; o card do manual some).
     */
    async conversaLeuDeFora(conversaId: string, p: { agora: number; janelaMs: number }): Promise<boolean> {
      const desde = data(p.agora - p.janelaMs);
      const consulta = (c: Conn) => c<{ sim: boolean }[]>`
        select exists (
          select 1 from turnos
          where tenant_id = ${escopo.tenantId} and conversa_id = ${conversaId} and criado_em >= ${data(p.agora - 2 * p.janelaMs)}
            and (contaminado_em >= ${desde} or (entrada_confianca <> 'confiavel' and criado_em >= ${desde}))
        ) as sim`;
      const comSavepoint = (conn as Partial<Tx>).savepoint;
      const [l] = typeof comSavepoint === "function" ? await (conn as Tx).savepoint((s) => consulta(s)) : await consulta(conn);
      return l?.sim === true;
    },

    /**
     * NOD-206: o executor em que o turno de fato roda só é decidido ao emitir o plano; grava-o aqui para a retomada
     * (sessaoDoTurno) e os relatórios. Só a coluna executor — nunca o estado (tests/conformidade/sem-requeue.test.ts).
     */
    async registrarExecutor(id: string, executor: Executor): Promise<void> {
      await conn`update turnos set executor = ${executor} where tenant_id = ${escopo.tenantId} and id = ${id}`;
    },

    /**
     * NOD-291 (0084): o turno que roda numa CÓPIA da sessão da conversa (`--fork-session`, a rede de 2 min da ADR-083 §2)
     * guarda de que sessão a cópia saiu. O CLI devolve um id novo cujo total traz o histórico da mãe; o assentar desconta
     * o total da mãe (totalAnteriorDaSessao). Só grava quando bifurca: a coluna nasce nula (a tabela mais quente).
     */
    async registrarSessaoOrigem(id: string, sessaoCli: string): Promise<void> {
      await conn`update turnos set sessao_origem_cli = ${sessaoCli} where tenant_id = ${escopo.tenantId} and id = ${id} and sessao_origem_cli is distinct from ${sessaoCli}`;
    },

    /** ADR-102 (0074): a conta que o plano mandou a máquina usar (null = a pasta padrão da máquina). */
    async registrarConta(id: string, contaId: string | null): Promise<void> {
      await conn`update turnos set conta_id = ${contaId} where tenant_id = ${escopo.tenantId} and id = ${id}`;
    },

    /**
     * ADR-107 (NOD-281): a IA que de fato rodou o turno (`turnos.harness` guarda a preferência, muitas vezes 'auto') e a conta
     * dela, numa escrita só — a retomada da cadeia (sessaoDoTurno) compara as duas com as do turno novo.
     */
    async registrarIa(id: string, harness: string, contaId: string | null): Promise<void> {
      await conn`update turnos set harness_efetivo = ${harness}, conta_id = ${contaId} where tenant_id = ${escopo.tenantId} and id = ${id}`;
    },

    async contaDoTurno(id: string): Promise<string | null> {
      const [l] = await conn<{ conta_id: string | null }[]>`select conta_id from turnos where tenant_id = ${escopo.tenantId} and id = ${id}`;
      return l?.conta_id ?? null;
    },

    /**
     * ADR-066: a sessão do CLI que o turno abriu e o executor dele — a retomada de rotina ou de pedido de colega volta nela.
     * ADR-107 (NOD-281): com a IA que de fato rodou, a conta e a máquina — a sessão só é retomada onde existe.
     */
    async sessaoDoTurno(id: string): Promise<SessaoDoTurno | null> {
      const [l] = await conn<{ sessao_cli: string | null; executor: string; harness_efetivo: string | null; conta_id: string | null; machine_id: string | null }[]>`
        select sessao_cli, executor, harness_efetivo, conta_id, machine_id from turnos where tenant_id = ${escopo.tenantId} and id = ${id}`;
      return l?.sessao_cli ? { sessaoCli: l.sessao_cli, executor: l.executor, harness: l.harness_efetivo, contaId: l.conta_id, machineId: l.machine_id } : null;
    },

    /**
     * NOD-312: a última sessão que um turno de conversa do bot deixou nesta conversa (sem trabalho, delegação nem
     * ligação), depois do /nova-sessao e antes do turno `antesDe`. A troca manual de IA zera `conversas.sessao_cli`
     * antes do turno; o turno guarda a dele, então é daqui que se sabe que havia o que perder. `harnessDoUltimoTurno` é a
     * IA do último turno de conversa da pessoa que rodou até o fim (com sessão ou não; revisão 12: o interrompido não conta — o aviso dele pode não ter chegado à IA — e só no mesmo executor): é o que faz o aviso de troca de IA sair uma vez só.
     */
    async ultimaSessaoDaConversa(conversaId: string, agenteId: string, antesDe: { id: string; criadoEm: number }, desde: number | null): Promise<(SessaoDoTurno & { turnoId: string; harnessDoUltimoTurno: string | null }) | null> {
      const [l] = await conn<{ id: string; sessao_cli: string; executor: string; harness_efetivo: string | null; conta_id: string | null; machine_id: string | null; harness_do_ultimo: string | null }[]>`
        select id, sessao_cli, executor, harness_efetivo, conta_id, machine_id,
          (select u.harness_efetivo from turnos u
            where u.tenant_id = t.tenant_id and u.conversa_id = t.conversa_id and u.agente_id = t.agente_id
              and u.origem in ('conversa', 'retomada') and ${conn.unsafe(DA_CONVERSA_OU_DA_REDE('u'))} and u.sob_procuracao_de is null and u.ligacao_id is null
              and ${raizDeConversa("u")}
              and u.harness_efetivo is not null and u.estado = 'concluido' and u.executor = t.executor and u.id <> ${antesDe.id} and u.criado_em < ${data(antesDe.criadoEm)}
              ${desde === null ? conn`` : conn`and u.criado_em > ${data(desde)}`}
            order by u.criado_em desc, u.id desc limit 1) as harness_do_ultimo
        from turnos t
        where tenant_id = ${escopo.tenantId} and conversa_id = ${conversaId} and agente_id = ${agenteId}
          and origem in ('conversa', 'retomada') and ${conn.unsafe(DA_CONVERSA_OU_DA_REDE('t'))} and sob_procuracao_de is null and ligacao_id is null
          and ${raizDeConversa()}
          and sessao_cli is not null and id <> ${antesDe.id} and criado_em < ${data(antesDe.criadoEm)}
          ${desde === null ? conn`` : conn`and criado_em > ${data(desde)}`}
        order by criado_em desc, id desc limit 1`;
      return l ? { turnoId: l.id, sessaoCli: l.sessao_cli, executor: l.executor, harness: l.harness_efetivo, contaId: l.conta_id, machineId: l.machine_id, harnessDoUltimoTurno: l.harness_do_ultimo } : null;
    },

    /**
     * NOD-312 (0119): por que o turno recomeçou sem a sessão. Só grava sobre a coluna nula — a repetição da sessão
     * recusada nasce com 'sessao_recusada', e a emissão do plano dela não pode trocar por outro motivo.
     */
    async registrarMotivoRecomeco(id: string, motivo: MotivoRecomeco): Promise<boolean> {
      const r = await conn`update turnos set motivo_recomeco = ${motivo} where tenant_id = ${escopo.tenantId} and id = ${id} and motivo_recomeco is null`;
      return r.count === 1;
    },

    /** NOD-312 (revisão 4): a repetição da sessão recusada que acabou retomando uma sessão nova não recomeçou. */
    async limparMotivoRecomeco(id: string): Promise<void> {
      await conn`update turnos set motivo_recomeco = null where tenant_id = ${escopo.tenantId} and id = ${id}`;
    },

    /**
     * NOD-312: os últimos turnos de conversa do bot nesta conversa (para o resumo do trabalho do turno que recomeça), do
     * mais antigo ao mais novo, depois do /nova-sessao e antes do turno `antesDe`. Sempre com limite. Revisão 9: com o turno
     * promovido pela rede (foi a pessoa que falou com o bot nele) e sem os absorvidos (a fala foi junto com outra; nada se perdeu).
     */
    async ultimosDaConversa(conversaId: string, agenteId: string, antesDe: { id: string; criadoEm: number }, desde: number | null, limite = 8): Promise<Turno[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from turnos t
        where tenant_id = ${escopo.tenantId} and conversa_id = ${conversaId} and agente_id = ${agenteId}
          and origem in ('conversa', 'retomada') and ${conn.unsafe(DA_CONVERSA_OU_DA_REDE('t'))} and sob_procuracao_de is null and ligacao_id is null
          and not (estado = 'interrompido' and motivo_interrupcao = 'absorvido')
          and ${raizDeConversa()}
          and id <> ${antesDe.id} and criado_em < ${data(antesDe.criadoEm)}
          ${desde === null ? conn`` : conn`and criado_em > ${data(desde)}`}
        order by criado_em desc, id desc limit ${limite}`;
      return linhas.map(paraTurno).reverse();
    },

    /**
     * ADR-107 (NOD-281, critério 4): o CLI recusou a sessão que este turno deixou (sessao_rejeitada na retomada da cadeia).
     * Ela sai do turno para nenhuma retomada dele voltar a pedir o mesmo --resume. Só a coluna da sessão — nunca o estado.
     */
    async largarSessao(id: string): Promise<boolean> {
      const r = await conn`
        update turnos set sessao_cli = null
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and sessao_cli is not null`;
      return r.count === 1;
    },

    /** "Pode fazer e o resto desta tarefa" (0032): marca a RAIZ; vale para ela e as retomadas dela. */
    async liberarComputador(raizId: string, agora: number): Promise<boolean> {
      const r = await conn`update turnos set computador_liberado_em = coalesce(computador_liberado_em, ${data(agora)}) where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${raizId}`;
      return r.count === 1;
    },

    async computadorLiberado(raizId: string): Promise<boolean> {
      const [l] = await conn<{ liberado: boolean }[]>`select computador_liberado_em is not null as liberado from turnos where tenant_id = ${escopo.tenantId} and id = ${raizId}`;
      return l?.liberado === true;
    },

    /** ADR-055 (0034): "Pode fazer e o resto desta tarefa" num comando do terminal — a mesma regra do computador. */
    async liberarTerminal(raizId: string, agora: number): Promise<boolean> {
      const r = await conn`update turnos set terminal_liberado_em = coalesce(terminal_liberado_em, ${data(agora)}) where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${raizId}`;
      return r.count === 1;
    },

    async terminalLiberado(raizId: string): Promise<boolean> {
      const [l] = await conn<{ liberado: boolean }[]>`select terminal_liberado_em is not null as liberado from turnos where tenant_id = ${escopo.tenantId} and id = ${raizId}`;
      return l?.liberado === true;
    },

    /** Assenta o resultado: só sai de 'despachando' (ou 'pendente' para interrupção antes de rodar). */
    async assentar(id: string, a: Assentamento): Promise<Turno | null> {
      const [l] = await conn<Linha[]>`
        update turnos set
          estado = ${a.estado},
          motivo_interrupcao = ${a.estado === "interrompido" ? (a.motivoInterrupcao ?? "sem_progresso") : null},
          motivo_falha = ${a.motivoFalha ?? null},
          attempted = attempted or ${a.sinais?.attempted ?? false},
          rejected = rejected or ${a.sinais?.rejected ?? false},
          prompt_submitted = prompt_submitted or ${a.sinais?.promptSubmitted ?? false},
          produced_output = produced_output or ${a.sinais?.producedOutput ?? false},
          custo_usd = coalesce(${a.custoUsd ?? null}, custo_usd),
          tokens_entrada = coalesce(${a.tokensEntrada ?? null}, tokens_entrada),
          tokens_saida = coalesce(${a.tokensSaida ?? null}, tokens_saida),
          sessao_cli = coalesce(${a.sessaoCli ?? null}, sessao_cli),
          custo_sessao_usd = coalesce(${a.custoSessaoUsd ?? null}, custo_sessao_usd),
          ultimo_sinal_em = coalesce(ultimo_sinal_em, ${a.estado === "interrompido" && a.ultimoSinalEm !== undefined ? data(a.ultimoSinalEm) : null}),
          lease_ate = null
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and estado in ('pendente', 'despachando')
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraTurno(l) : null;
    },

    /**
     * 0035: o total que a sessão do CLI tinha no turno anterior DELA (o maior já registrado, que é o último: o total
     * só cresce dentro de uma sessão). null = nenhum turno desta sessão registrou total ainda.
     *
     * NOD-291 (0084): sem anterior na sessão e com o turno numa cópia (`sessao_origem_cli`), o anterior é o total da MÃE
     * quando a cópia saiu: o maior dos turnos dela criados antes deste (a mãe segue no trabalho promovido e cresce
     * depois; o que ela gastou depois não entrou na cópia). Cópia de cópia: a mãe imediata, pela mesma regra.
     */
    async totalAnteriorDaSessao(sessaoCli: string, turnoId: string): Promise<number | null> {
      const [l] = await conn<{ total: string | null }[]>`
        select coalesce(
          (select max(custo_sessao_usd) from turnos
            where tenant_id = ${escopo.tenantId} and sessao_cli = ${sessaoCli} and id <> ${turnoId} and custo_sessao_usd is not null),
          (select max(m.custo_sessao_usd) from turnos f
            join turnos m on m.tenant_id = f.tenant_id and m.sessao_cli = f.sessao_origem_cli and m.id <> f.id
              and m.custo_sessao_usd is not null and m.criado_em < f.criado_em
            where f.tenant_id = ${escopo.tenantId} and f.id = ${turnoId} and f.sessao_origem_cli is distinct from ${sessaoCli})
        )::text as total`;
      return l?.total === null || l?.total === undefined ? null : Number(l.total);
    },

    /**
     * definido em 2026-10-15 (NOD-264, E8; emenda da ADR-045 sobre a ADR-010): a entrega tardia com SUCESSO de um turno que
     * a queda assentou (`maquina_sem_contato`/`reinicio_servidor`/`reinicio_do_motor`) promove o turno a `concluido` — o trabalho terminou, só
     * a máquina sumiu antes de entregar. Condicional: só o interrompido por queda muda (o UPDATE decide a corrida com a
     * retomada automática), e nunca para 'pendente' (sem requeue). Quem chama já conferiu que não há retomada criada.
     */
    async concluirTardia(id: string, a: Omit<Assentamento, "estado" | "motivoInterrupcao" | "motivoFalha">): Promise<Turno | null> {
      // definido em 2026-10-20 (NOD-309, PR 3): a queda do fundo já põe a retomada na fila. Se ela ainda não saiu
      // (pendente, com a entrada da retomada da queda) e é a única que aponta para este turno, o sucesso tardio a
      // absorve: o trabalho terminou e não roda de novo. Já despachada, vale a regra de antes (a fala vira parcial).
      await conn`
        update turnos r set estado = 'interrompido', motivo_interrupcao = 'absorvido', absorvido_por = ${id}, lease_ate = null
        where r.tenant_id = ${escopo.tenantId} and r.owner_id = ${escopo.pessoaId} and r.retoma_turno_id = ${id}
          and r.estado = 'pendente' and starts_with(r.entrada_texto, ${ENTRADA_DA_RETOMADA_DA_QUEDA})
          and exists (select 1 from turnos t where t.tenant_id = ${escopo.tenantId} and t.id = ${id} and t.estado = 'interrompido'
            and t.motivo_interrupcao in ('maquina_sem_contato', 'reinicio_servidor', 'reinicio_do_motor'))
          and (select count(*) from turnos o where o.tenant_id = ${escopo.tenantId} and o.retoma_turno_id = ${id}) = 1`;
      const [l] = await conn<Linha[]>`
        update turnos set
          estado = 'concluido',
          motivo_interrupcao = null,
          motivo_falha = null,
          attempted = attempted or ${a.sinais?.attempted ?? false},
          rejected = rejected or ${a.sinais?.rejected ?? false},
          prompt_submitted = prompt_submitted or ${a.sinais?.promptSubmitted ?? false},
          produced_output = produced_output or ${a.sinais?.producedOutput ?? false},
          custo_usd = coalesce(${a.custoUsd ?? null}, custo_usd),
          tokens_entrada = coalesce(${a.tokensEntrada ?? null}, tokens_entrada),
          tokens_saida = coalesce(${a.tokensSaida ?? null}, tokens_saida),
          sessao_cli = coalesce(${a.sessaoCli ?? null}, sessao_cli),
          custo_sessao_usd = coalesce(${a.custoSessaoUsd ?? null}, custo_sessao_usd),
          lease_ate = null
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and estado = 'interrompido'
          and motivo_interrupcao in ('maquina_sem_contato', 'reinicio_servidor', 'reinicio_do_motor')
          and not exists (select 1 from turnos r where r.tenant_id = ${escopo.tenantId} and r.retoma_turno_id = ${id})
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraTurno(l) : null;
    },

    /**
     * NOD-264 (E8): algum turno já retoma este (na fila, rodando ou acabado)?
     * revisto em 2026-10-20 (NOD-309, PR 3): a retomada da queda única e ainda pendente não conta — o sucesso tardio a
     * absorve (concluirTardia).
     */
    async temRetomada(retomaTurnoId: string): Promise<boolean> {
      const [l] = await conn<{ tem: boolean }[]>`
        select count(*) > 0 and not (count(*) = 1 and bool_and(estado = 'pendente' and starts_with(entrada_texto, ${ENTRADA_DA_RETOMADA_DA_QUEDA}))) as tem
        from turnos where tenant_id = ${escopo.tenantId} and retoma_turno_id = ${retomaTurnoId}`;
      return l?.tem ?? false;
    },

    /**
     * Transição terminal e idempotente (ADR-010/021): só o que está vivo vira 'interrompido'.
     * NOD-241 (0076): `ultimoSinalEm` grava o último sinal de vida (o primeiro valor vence). `leaseVencidoEm` é a guarda
     * do varredor: `vencidos()` lê sem trava, e o turno que renovou o lease entre a leitura e este UPDATE não é
     * interrompido nem recebe um sinal velho (ADR-045) — devolve null e segue vivo.
     */
    async interromper(id: string, motivo: MotivoInterrupcao, o: { ultimoSinalEm?: number; leaseVencidoEm?: number } = {}): Promise<Turno | null> {
      const [l] = await conn<Linha[]>`
        update turnos set estado = 'interrompido', motivo_interrupcao = ${motivo},
          ultimo_sinal_em = coalesce(ultimo_sinal_em, ${o.ultimoSinalEm !== undefined ? data(o.ultimoSinalEm) : null}), lease_ate = null
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and estado in ('pendente', 'despachando')
          ${o.leaseVencidoEm !== undefined ? conn`and (lease_ate is null or lease_ate < ${data(o.leaseVencidoEm)})` : conn``}
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraTurno(l) : null;
    },

    /**
     * definido em 2026-10-20 (NOD-293 A7, revisão do PR #425): o varredor classificou a queda antes da trava por pessoa
     * dos incidentes e, sob ela, viu a chave já revogada — o turno que ESTA transação assentou troca de motivo. Só de
     * `de` para `para`: nada além do motivo muda. null = não estava assentado com `de`.
     */
    async reclassificarInterrupcao(id: string, de: MotivoInterrupcao, para: MotivoInterrupcao): Promise<Turno | null> {
      const [l] = await conn<Linha[]>`
        update turnos set motivo_interrupcao = ${para}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and estado = 'interrompido' and motivo_interrupcao = ${de}
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraTurno(l) : null;
    },

    /**
     * definido em 2026-10-15 (NOD-262): o turno de conversa ou sala que respondeu ao pedido de um colega (responder_pedido)
     * tira da fila o turno `delegacao` do pedido — interrompido/'absorvido' apontando para ele, como na fila lida junta.
     * Só o que ainda está 'pendente': o que já começou a rodar responde sozinho; null = não absorveu.
     */
    async absorverDelegacao(id: string, porTurnoId: string): Promise<Turno | null> {
      const [l] = await conn<Linha[]>`
        update turnos set estado = 'interrompido', motivo_interrupcao = 'absorvido', absorvido_por = ${porTurnoId}, lease_ate = null
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and origem = 'delegacao' and estado = 'pendente'
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraTurno(l) : null;
    },

    /**
     * Fila lida junta (definido em 2026-09-24): logo depois de reivindicar um turno disparado por fala da
     * pessoa, os OUTROS pendentes da mesma conversa e do mesmo agente, também disparados por fala dela,
     * saem como interrompido/'absorvido' apontando para ele, e a entrada dele vira a lista de todas as
     * falas (entradaDaFila). Rotina, retomada e peer nunca entram nem absorvem; ADR-083: só da MESMA faixa (a fala
     * mandada a uma task não entra no turno da conversa, nem o contrário). Só toca 'pendente', então
     * um Cancelar que chegou antes deixa aquela mensagem de fora e um que chega depois recebe estado_invalido.
     */
    async absorverPendentes(turno: Turno, entrada: (textos: readonly string[]) => string, ids?: readonly string[]): Promise<{ turno: Turno; absorvidos: Turno[] }> {
      if (!turno.mensagemOrigemId || (turno.origem !== "conversa" && turno.origem !== "sala")) return { turno, absorvidos: [] };
      // NOD-23: com `ids`, só estas (o caso de uso cortou no primeiro comando da conversa); vazio = nenhuma.
      if (ids && ids.length === 0) return { turno, absorvidos: [] };
      const linhas = await conn<Linha[]>`
        update turnos set estado = 'interrompido', motivo_interrupcao = 'absorvido', absorvido_por = ${turno.id}, lease_ate = null
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and conversa_id = ${turno.conversaId} and agente_id = ${turno.agenteId}
          and estado = 'pendente' and origem in ('conversa', 'sala') and mensagem_origem_id is not null and id <> ${turno.id}
          and trabalho_id is not distinct from ${turno.trabalhoId ?? null}::uuid
          ${ids ? conn`and id = any(${ids as string[]}::uuid[])` : conn``}
        returning ${conn.unsafe(COLUNAS)}`;
      const absorvidos = linhas.map(paraTurno).sort((a, b) => a.criadoEm - b.criadoEm);
      if (absorvidos.length === 0) return { turno, absorvidos };
      const anexos = [...new Set([...turno.entradaAnexos, ...absorvidos.flatMap((a) => a.entradaAnexos)])];
      // NOD-312 (revisão 9): a repetição da sessão recusada nasce com 'sessao_recusada'; absorvida por uma fala mais
      // antiga, o motivo vai junto — senão o turno que de fato recomeça sai sem aviso, resumo nem marca.
      const motivoAbsorvido = absorvidos.find((a) => a.motivoRecomeco)?.motivoRecomeco ?? null;
      const [l] = await conn<Linha[]>`
        update turnos set entrada_texto = ${entrada([turno.entradaTexto, ...absorvidos.map((a) => a.entradaTexto)])}, entrada_anexos = ${anexos as string[]}::uuid[],
          motivo_recomeco = coalesce(motivo_recomeco, ${motivoAbsorvido}::text)
        where tenant_id = ${escopo.tenantId} and id = ${turno.id}
        returning ${conn.unsafe(COLUNAS)}`;
      return { turno: l ? paraTurno(l) : turno, absorvidos };
    },

    /**
     * Mensagem nova no meio do trabalho (definido em 2026-10-01, ADR-067): as falas da pessoa que esperavam na fila
     * desta conversa e deste agente entram no turno VIVO — saem interrompido/'absorvido' apontando para ele, como na
     * fila lida junta, mas o texto vai à sessão do CLI em vez de mudar a entrada. Só fala da pessoa (conversa), e só
     * sem anexo: o anexo espera o próximo turno, que o baixa e o entrega inteiro. NOD-286 (2026-10-15): e só as que
     * vieram ANTES da primeira fala pendente com anexo — a que veio depois do print espera com ele, para o bot responder
     * na ordem em que a pessoa mandou (desempate por id, como `porChegada`). Quem decide se o turno vivo aceita
     * é o caso de uso (absorverNaSessao).
     * definido em 2026-10-07 (#189): com `ids`, só estas — as que o app confirmou ter escrito na sessão
     * (confirmarNaSessao); sem, todas as da fila, como antes (app que não confirma).
     */
    async absorverNaSessao(turno: Turno, ids?: readonly string[]): Promise<Turno[]> {
      if (ids && ids.length === 0) return [];
      const linhas = await conn<Linha[]>`
        update turnos set estado = 'interrompido', motivo_interrupcao = 'absorvido', absorvido_por = ${turno.id}, lease_ate = null
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and conversa_id = ${turno.conversaId} and agente_id = ${turno.agenteId}
          and estado = 'pendente' and origem = 'conversa' and mensagem_origem_id is not null and cardinality(entrada_anexos) = 0 and id <> ${turno.id}
          and trabalho_id is null
          ${ids ? conn`and id = any(${ids as string[]}::uuid[])` : conn``}
          and not exists (
            select 1 from turnos a
            where a.tenant_id = ${escopo.tenantId} and a.owner_id = ${escopo.pessoaId} and a.conversa_id = ${turno.conversaId} and a.agente_id = ${turno.agenteId}
              and a.estado = 'pendente' and a.origem = 'conversa' and a.mensagem_origem_id is not null and a.trabalho_id is null and a.id <> ${turno.id}
              and cardinality(a.entrada_anexos) > 0 and (a.criado_em, a.id) < (turnos.criado_em, turnos.id))
        returning ${conn.unsafe(COLUNAS)}`;
      return linhas.map(paraTurno).sort(porChegada);
    },

    /**
     * definido em 2026-10-07 (ADR-083, #193): as falas que esperam na faixa DESTE trabalho (a da pessoa na tela da task
     * e o recado da conversa, os dois com mensagem de origem) entram no turno vivo dele, como absorverNaSessao faz com a
     * conversa. Sem anexo, e nunca a retomada de uma decisão (que não tem mensagem de origem). NOD-286: também para na
     * primeira fala pendente com anexo da faixa (a posterior espera com ela).
     * revisto em 2026-10-08 (revisão do épico, S18): com `ids`, só estas — as que o app confirmou (confirmarNaSessao).
     */
    async absorverDoTrabalho(turno: Turno, ids?: readonly string[]): Promise<Turno[]> {
      if (!turno.trabalhoId || (ids && ids.length === 0)) return [];
      const linhas = await conn<Linha[]>`
        update turnos set estado = 'interrompido', motivo_interrupcao = 'absorvido', absorvido_por = ${turno.id}, lease_ate = null
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and trabalho_id = ${turno.trabalhoId}
          and estado = 'pendente' and mensagem_origem_id is not null and cardinality(entrada_anexos) = 0 and id <> ${turno.id}
          ${ids ? conn`and id = any(${ids as string[]}::uuid[])` : conn``}
          and not exists (
            select 1 from turnos a
            where a.tenant_id = ${escopo.tenantId} and a.owner_id = ${escopo.pessoaId} and a.trabalho_id = ${turno.trabalhoId}
              and a.estado = 'pendente' and a.mensagem_origem_id is not null and a.id <> ${turno.id}
              and cardinality(a.entrada_anexos) > 0 and (a.criado_em, a.id) < (turnos.criado_em, turnos.id))
        returning ${conn.unsafe(COLUNAS)}`;
      return linhas.map(paraTurno).sort(porChegada);
    },

    /**
     * ADR-090: "Rodar em <outra máquina> desta vez" — os turnos AINDA pendentes desta conversa vão para a máquina escolhida
     * pela pessoa, uma vez; o que já foi reivindicado fica onde está. Quem chama já conferiu que a chave é dela.
     * NOD-293 (A6, definido em 2026-10-20): só a fala da conversa (sem trabalho). O turno pendente de uma frente segue a
     * máquina da sessão do trabalho (alvo-da-maquina.ts); levá-lo para outra máquina o rodava numa pasta vazia.
     */
    async rodarDestaVez(conversaId: string, maquinaId: string): Promise<number> {
      const r = await conn`
        update turnos set maquina_desta_vez = ${maquinaId}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and conversa_id = ${conversaId} and estado = 'pendente'
          and trabalho_id is null`;
      return r.count;
    },

    /**
     * NOD-314 (definido em 2026-10-20): o mesmo "desta vez" a partir do topo da task — os turnos AINDA pendentes deste
     * trabalho vão para a máquina escolhida, uma vez. A máquina fixa do bot (`agentes.maquina_id`) não muda. Quem chama já
     * conferiu que a chave é dela.
     */
    // QA do NOD-314: `movidos` = os que mudaram agora; `jaNela` = os pendentes que já iam para essa máquina (o 2º clique).
    async rodarDestaVezDoTrabalho(trabalhoId: string, maquinaId: string): Promise<{ movidos: number; jaNela: number }> {
      const r = await conn`
        update turnos set maquina_desta_vez = ${maquinaId}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and trabalho_id = ${trabalhoId} and estado = 'pendente'
          and maquina_desta_vez is distinct from ${maquinaId}`;
      const [j] = await conn<{ n: number }[]>`
        select count(*)::int as n from turnos
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and trabalho_id = ${trabalhoId} and estado = 'pendente'
          and maquina_desta_vez = ${maquinaId}`;
      return { movidos: r.count, jaNela: (j?.n ?? 0) - r.count };
    },

    /**
     * NOD-280 (definido em 2026-10-15): "Tentar de novo com <conta>" em Provedores — as falas que esperavam o limite passar
     * (a cópia adiada da conversa, NOD-268; a retomada da task, ADR-099 §7) saem já. Só as que nasceram de um turno parado
     * por `limite_do_plano` ou recusado no despacho por `sem_conta` (NOD-269) do mesmo bot e que podem rodar na IA da conta (fixas nela ou no Automático); o "me chame às
     * 16:00" (ADR-086) fica. Devolve quantas acordaram.
     */
    async anteciparEsperasDoLimite(p: { ia: string; agora: number }): Promise<number> {
      const r = await conn`
        update turnos t set acordar_em = ${data(p.agora)}
        where t.tenant_id = ${escopo.tenantId} and t.owner_id = ${escopo.pessoaId} and t.estado = 'pendente'
          and t.acordar_em > ${data(p.agora)} and (t.harness = ${p.ia} or t.harness = 'auto')
          and exists (select 1 from turnos x where x.tenant_id = t.tenant_id and x.conversa_id = t.conversa_id and x.agente_id = t.agente_id
            and x.estado = 'interrompido' and x.motivo_falha in ('limite_do_plano', 'sem_conta')
            and (x.id = t.retoma_turno_id or x.retoma_turno_id = t.retoma_turno_id or (t.mensagem_origem_id is not null and x.mensagem_origem_id = t.mensagem_origem_id)))
        returning t.id`;
      return r.length;
    },

    /**
     * Cancelar da fila: só o que AINDA está pendente — um turno que o laço acabou de reivindicar fica intacto. `motivo`:
     * a pessoa (padrão) ou, no fecho automático de um pedido a colega (NOD-377, revisão 3 do PR #544), `vencido`.
     */
    async cancelarPendente(id: string, motivo: "parado_pela_pessoa" | "vencido" = "parado_pela_pessoa", o: { pularTravado?: boolean } = {}): Promise<Turno | null> {
      // NOD-377 (revisão 4 do PR #544, M1): com `pularTravado`, a linha que outra transação segura fica (SKIP LOCKED). Quem
      // a segura está mudando o estado dela (o Parar e a exclusão a interrompem, o despacho a pega); esperar por ela com a
      // trava da raiz do pedido na mão fechava o ciclo com o Parar (linha → raiz): impasse.
      const pular = o.pularTravado === true;
      const [l] = await conn<Linha[]>`
        update turnos set estado = 'interrompido', motivo_interrupcao = ${motivo}, lease_ate = null
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and estado = 'pendente'
          and (not ${pular}::boolean or id in (select x.id from turnos x where x.tenant_id = ${escopo.tenantId} and x.id = ${id} and x.estado = 'pendente' for update skip locked))
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraTurno(l) : null;
    },

    /**
     * NOD-219 (definido em 2026-10-13): os pendentes da pessoa que o varredor de órfãos olha — os que nenhum `reivindicar`
     * pode pegar (agente excluído, ou vivo com outra geração) e os que passaram do prazo da fila — com os fatos de
     * domain/turno-orfao.ts. Ligação e volta marcada para mais tarde não entram. Os impossíveis primeiro; `limite` por
     * passada, para a tx do varredor ficar curta (o resto sai na próxima).
     * revisto em 2026-10-13 (revisão do PR #307): `jaObservados` (os velhos observados na última hora) sai já na consulta,
     * como os adiados do #218 — com o `limite`, pular depois deixava os mesmos 50 velhos na frente e o 51º nunca era
     * observado. Só vale para o velho: um observado que vira impossível (agente excluído no meio) entra de novo.
     */
    async orfaosCandidatos(agora: number, o: { jaObservados?: readonly string[]; limite?: number; ids?: readonly string[] } = {}): Promise<OrfaoCandidato[]> {
      const jaObservados = [...(o.jaObservados ?? [])];
      // definido em 2026-10-15 (NOD-257, H5): com `ids`, devolve os fatos desses pendentes, velhos ou não — o card do
      // pedido a colega mostra por que ele espera na fila (fila-do-pedido.ts).
      const soEstes = o.ids ? [...o.ids] : null;
      // NOD-314 (definido em 2026-10-20): a máquina-alvo do turno (ADR-090, a mesma regra do `reivindicar`) e o último
      // contato dela; o preso há 24 h a um alvo sem contato entra como impossível (domain/turno-orfao.ts).
      const limitePreso = data(agora - PRAZO_PRESO_SEM_CONTATO_MS);
      // Jornada C do onboarding: a fala guardada sem IA (a negação aguardaIa do turno) espera 7 dias, não 24 h.
      const limiteDoTurno = conn`(case when x.aguarda_ia then ${data(agora - PRAZO_SEM_IA_MS)}::timestamptz else ${limitePreso}::timestamptz end)`;
      // ADR-121 (NOD-92): o contato da máquina na nuvem que dorme ou acorda é "agora" (o prazo não corre); fora disso conta
      // também da última troca de estado dela (relogioDaNuvem).
      const contatoDoAlvo = conn`greatest(coalesce(k.ultimo_uso_em, k.criado_em), ${relogioDaNuvem(conn, conn`k.tenant_id`, conn`k.id`, agora)})`;
      const linhas = await conn<{ id: string; conversa_id: string; agente_id: string; origem: OrigemTurno; trabalho_id: string | null; criado_em: Date; prazo_em: Date; acordar_em: Date | null; agente_excluido: boolean; geracao_antiga: boolean; depois_de_aberto: boolean; faixa_ocupada: boolean; alvo_ultimo_contato: Date | null; alvo_nome: string | null; alvo_id: string | null; aguarda_ia: boolean }[]>`
        select x.*, case when k.id is null then null else ${contatoDoAlvo} end as alvo_ultimo_contato, k.nome as alvo_nome
        from (
          select t.id, t.tenant_id, t.conversa_id, t.agente_id, t.origem, t.trabalho_id, t.criado_em, t.prazo_em, t.acordar_em,
            coalesce(a.excluido_em is not null, true) as agente_excluido,
            (a.excluido_em is null and a.geracao_execucao is distinct from t.geracao_execucao) as geracao_antiga,
            (t.trabalho_id is not null and exists (select 1 from trabalhos w join trabalhos dep on dep.tenant_id = w.tenant_id and dep.id = w.depois_de_trabalho_id
              where w.tenant_id = t.tenant_id and w.id = t.trabalho_id and dep.estado not in ('terminado', 'parado', 'falhou'))) as depois_de_aberto,
            ${faixaOcupadaSql(conn)} as faixa_ocupada,
            ${alvoDoTurno(conn, agora)} as alvo_id,
            ${aguardaIaSql(conn)} as aguarda_ia
          from turnos t
          left join agentes a on a.tenant_id = t.tenant_id and a.id = t.agente_id
          where t.tenant_id = ${escopo.tenantId} and t.owner_id = ${escopo.pessoaId} and t.estado = 'pendente' and t.origem <> 'ligacao'
            and (t.acordar_em is null or t.acordar_em <= ${data(agora)})
            and (${soEstes === null} or t.id::text = any(${soEstes ?? []}::text[]))
        ) x
        left join maquina_tokens k on k.tenant_id = x.tenant_id and k.id::text = x.alvo_id
        where ${soEstes !== null} or x.agente_excluido or x.geracao_antiga
          or (k.id is not null and greatest(x.criado_em, coalesce(x.acordar_em, x.criado_em), ${contatoDoAlvo}) <= ${limiteDoTurno})
          or (x.prazo_em <= ${data(agora)} and not (x.id::text = any(${jaObservados}::text[])))
        order by (x.agente_excluido or x.geracao_antiga or (k.id is not null and greatest(x.criado_em, coalesce(x.acordar_em, x.criado_em), ${contatoDoAlvo}) <= ${limiteDoTurno})) desc, x.criado_em asc, x.id asc
        limit ${o.limite ?? 50}`;
      return linhas.map((l) => ({
        id: l.id,
        conversaId: l.conversa_id,
        agenteId: l.agente_id,
        origem: l.origem,
        trabalhoId: l.trabalho_id,
        criadoEm: ms(l.criado_em),
        prazoEm: ms(l.prazo_em),
        acordarEm: msOuNull(l.acordar_em),
        agenteExcluido: l.agente_excluido,
        geracaoAntiga: l.geracao_antiga,
        depoisDeAberto: l.depois_de_aberto,
        faixaOcupada: l.faixa_ocupada,
        alvoUltimoContato: msOuNull(l.alvo_ultimo_contato),
        alvoNome: l.alvo_nome,
        alvoMaquinaId: l.alvo_id === null || l.alvo_ultimo_contato === null ? null : l.alvo_id,
        ...(l.aguarda_ia ? { aguardaIa: true } : {}),
      }));
    },

    /**
     * definido em 2026-10-20 (NOD-309, PR 4): o trabalho de fundo pendente há mais de `avisoMs` que o `reivindicar` pode
     * pegar (bot vivo, mesma geração) mas ninguém pegou — a condição da máquina o segura. Devolve os fatos da regra
     * (domain/turno-orfao.ts, decidirFundoPreso): o tipo de fundo (pela raiz da cadeia), o começo da cadeia, se ela já
     * ganhou a linha `fundo.espera`. Só volta o que ainda tem o que fazer: sem aviso, ou passado o prazo do fundo.
     */
    async fundosPresos(agora: number, p: { avisoMs: number; prazoMs: number; limite?: number }): Promise<FundoPresoCandidato[]> {
      const linhas = await conn<{ id: string; conversa_id: string; agente_id: string; trabalho_id: string | null; raiz_id: string; fundo: FundoPreso | null; criado_em: Date; acordar_em: Date | null; inicio: Date; avisado: boolean; depois_de_aberto: boolean; faixa_ocupada: boolean }[]>`
        select x.* from (
          select t.id, t.conversa_id, t.agente_id, t.trabalho_id, r.id as raiz_id, t.criado_em, t.acordar_em, r.criado_em as inicio,
            (case when ${RETORNO_DO_LOTE} in (coalesce(t.decidido_por, ''), coalesce(r.decidido_por, '')) then 'lote'
              when r.origem in ('delegacao', 'peer') then 'colega'
              when t.trabalho_id is not null and w.forma = 'frente' then 'frente'
              when t.trabalho_id is not null then 'task'
              when r.origem = 'rotina' then 'rotina' end) as fundo,
            exists (select 1 from mensagens m where m.tenant_id = t.tenant_id and m.conversa_id = t.conversa_id and m.assunto = 'fundo.espera'
              and not starts_with(m.texto, ${ABERTURA_DA_ESPERA_DO_SERVIDOR})
              and m.turno_id in (select c.id from turnos c where c.tenant_id = t.tenant_id and (c.id = r.id or c.retoma_turno_id = r.id))) as avisado,
            (t.trabalho_id is not null and exists (select 1 from trabalhos dep where dep.tenant_id = w.tenant_id and dep.id = w.depois_de_trabalho_id
              and dep.estado not in ('terminado', 'parado', 'falhou'))) as depois_de_aberto,
            ${faixaOcupadaSql(conn)} as faixa_ocupada
          from turnos t
          join agentes a on a.tenant_id = t.tenant_id and a.id = t.agente_id and a.excluido_em is null and a.geracao_execucao = t.geracao_execucao
          join turnos r on r.tenant_id = t.tenant_id and r.id = coalesce(t.retoma_turno_id, t.id)
          left join trabalhos w on w.tenant_id = t.tenant_id and w.id = t.trabalho_id
          where t.tenant_id = ${escopo.tenantId} and t.owner_id = ${escopo.pessoaId} and t.estado = 'pendente' and t.origem <> 'ligacao'
            and t.pessoa_esperando = false and t.parar_solicitado_em is null
            and (t.acordar_em is null or t.acordar_em <= ${data(agora)})
            and greatest(t.criado_em, coalesce(t.acordar_em, t.criado_em)) <= ${data(agora - p.avisoMs)}
            -- ADR-121 (NOD-92): o fundo que espera a máquina na nuvem acordar não está preso; o prazo não corre.
            and not ${nuvemSuspendePrazo(conn, conn`t.tenant_id`, alvoDoTurno(conn, agora))}
        ) x
        where x.fundo is not null and not x.depois_de_aberto and not x.faixa_ocupada
          and (not x.avisado or (x.fundo in ('colega', 'frente', 'lote') and x.inicio <= ${data(agora - p.prazoMs)}))
        order by x.criado_em asc, x.id asc
        limit ${p.limite ?? 50}`;
      return linhas.map((l) => ({
        id: l.id,
        conversaId: l.conversa_id,
        agenteId: l.agente_id,
        trabalhoId: l.trabalho_id,
        raizId: l.raiz_id,
        fundo: l.fundo,
        criadoEm: ms(l.criado_em),
        acordarEm: msOuNull(l.acordar_em),
        inicioDaCadeia: ms(l.inicio),
        avisado: l.avisado,
        cotaNoLimite: false,
        depoisDeAberto: l.depois_de_aberto,
        faixaOcupada: l.faixa_ocupada,
      }));
    },

    /**
     * NOD-219: encerra o pendente que nenhum `reivindicar` pode pegar. UPDATE condicional — o mesmo predicado que o
     * `reivindicar` nega (agente vivo com a mesma geração), mais `estado = 'pendente'`: o turno que uma máquina acabou de
     * reivindicar fica intacto (tests/concurrency/varredor-orfaos-reivindicar.test.ts). `parado_pela_pessoa` porque o
     * enum de motivos não tem outro que sirva; a causa vai no evento `turno_interrompido`.
     */
    async encerrarOrfao(id: string, agora: number): Promise<Turno | null> {
      const [l] = await conn<Linha[]>`
        update turnos t set estado = 'interrompido', motivo_interrupcao = 'parado_pela_pessoa', lease_ate = null
        where t.tenant_id = ${escopo.tenantId} and t.owner_id = ${escopo.pessoaId} and t.id = ${id} and t.estado = 'pendente' and t.origem <> 'ligacao'
          and (t.acordar_em is null or t.acordar_em <= ${data(agora)})
          and not exists (select 1 from agentes a where a.tenant_id = t.tenant_id and a.id = t.agente_id and a.excluido_em is null and a.geracao_execucao = t.geracao_execucao)
        returning ${conn.unsafe(COLUNAS.split(", ").map((c) => `t.${c}`).join(", "))}`;
      return l ? paraTurno(l) : null;
    },

    /**
     * NOD-314 (definido em 2026-10-20): encerra o pendente preso há 24 h a uma máquina-alvo sem contato
     * (domain/turno-orfao.ts). UPDATE condicional com o predicado refeito no SQL — o alvo de agora (ADR-090), o último
     * contato dele e as 24 h desde o mais recente entre criação, volta marcada e contato — mais `estado = 'pendente'`: o
     * Mac que acorda e reivindica no meio, ou que só fala (marcarUso), ganha. Fica `interrompido` com `maquina_sem_contato`
     * e `despachado_em` nulo, o que o separa da queda de um turno que rodou (MOTIVOS_DE_QUEDA).
     */
    async encerrarPresoSemContato(id: string, agora: number): Promise<Turno | null> {
      const alvo = alvoDoTurno(conn, agora);
      const [l] = await conn<Linha[]>`
        update turnos t set estado = 'interrompido', motivo_interrupcao = 'maquina_sem_contato', lease_ate = null
        where t.tenant_id = ${escopo.tenantId} and t.owner_id = ${escopo.pessoaId} and t.id = ${id} and t.estado = 'pendente' and t.origem <> 'ligacao'
          and (t.acordar_em is null or t.acordar_em <= ${data(agora)})
          and exists (select 1 from maquina_tokens k where k.tenant_id = t.tenant_id and k.id::text = ${alvo}
            and greatest(t.criado_em, coalesce(t.acordar_em, t.criado_em), coalesce(k.ultimo_uso_em, k.criado_em), ${relogioDaNuvem(conn, conn`k.tenant_id`, conn`k.id`, agora)})
              <= (case when ${aguardaIaSql(conn)} then ${data(agora - PRAZO_SEM_IA_MS)}::timestamptz else ${data(agora - PRAZO_PRESO_SEM_CONTATO_MS)}::timestamptz end))
        returning ${conn.unsafe(COLUNAS.split(", ").map((c) => `t.${c}`).join(", "))}`;
      return l ? paraTurno(l) : null;
    },

    /** Parar (E5.4): marca o pedido; a próxima renovação devolve {ativo:false} e o laço manda SIGTERM. */
    async pedirInterrupcao(ids: readonly string[], agora: number): Promise<number> {
      if (ids.length === 0) return 0;
      const r = await conn`
        update turnos set parar_solicitado_em = coalesce(parar_solicitado_em, ${data(agora)})
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id in ${conn([...ids])} and estado = 'despachando'`;
      return r.count;
    },

    /** Lease vencido: o varredor converte em 'interrompido' maquina_sem_contato — NUNCA em 'pendente'. */
    async vencidos(agora: number): Promise<Turno[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from turnos
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and estado = 'despachando' and lease_ate < ${data(agora)}
        order by criado_em`;
      return linhas.map(paraTurno);
    },

    async despachandoDaPessoa(): Promise<Turno[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from turnos where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and estado = 'despachando' order by criado_em`;
      return linhas.map(paraTurno);
    },

    /**
     * definido em 2026-10-15 (NOD-262): os pedidos de colega na fila do bot (turnos `delegacao` pendentes), os mais antigos
     * primeiro — a lista que o prompt da conversa e da sala mostra para o bot fechar com responder_pedido.
     */
    async delegacoesPendentesDoAgente(agenteId: string, limite = 20): Promise<Turno[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from turnos
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and agente_id = ${agenteId} and origem = 'delegacao' and estado = 'pendente'
        order by criado_em, id limit ${limite}`;
      return linhas.map(paraTurno);
    },

    async pendentesDaPessoa(conversaId?: string): Promise<Turno[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from turnos
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and estado = 'pendente'
          ${conversaId ? conn`and conversa_id = ${conversaId}` : conn``}
        order by criado_em, id`;
      return linhas.map(paraTurno);
    },

    /**
     * ADR-130: os turnos que rodam agora nos bastidores da conversa (a triagem de rotina e de colega, fora de trabalho). O
     * turno da pessoa os vê no prompt, para não refazer o trabalho em paralelo.
     */
    async bastidoresVivos(conversaId: string): Promise<Turno[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from turnos
        where tenant_id = ${escopo.tenantId} and conversa_id = ${conversaId} and estado = 'despachando' and trabalho_id is null and bastidores
          and origem <> 'ligacao'
        order by coalesce(despachado_em, criado_em)`;
      return linhas.map(paraTurno);
    },

    async vivosDaConversa(conversaId: string): Promise<Turno[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from turnos
        where tenant_id = ${escopo.tenantId} and conversa_id = ${conversaId} and estado in ('pendente', 'despachando') and origem <> 'ligacao'
          -- ADR-086: a volta marcada não está "em curso" — a tela mostraria o bot ocupado por horas.
          and (acordar_em is null or acordar_em <= now())
        order by criado_em`;
      return linhas.map(paraTurno);
    },

    /**
     * EMENDA 13: turno pendente bloqueado é renderizável — "na fila". Desde a ADR-083 (2026-10-07) o bloqueio é só a
     * faixa da conversa, então `conversaId` aponta para a própria. Pendente sem bloqueio conhecido não entra.
     *
     * revisto em 2026-09-30: em dois passos, e o segundo só quando há pendente (o caso comum é nenhum). A versão com as
     * duas subconsultas correlacionadas custava uma varredura de turnos por linha estimada, e a estimativa sob RLS
     * contava todos os turnos da conversa (1.020 estimados, 0 pendentes de fato): medido em 2026-09-30, custo 504 mil,
     * acima do limiar do JIT, e 1,36 s por GET conversa; o índice turnos_por_conversa (0042) sozinho não resolvia
     * (o custo seguiu acima de 500 mil), porque a subconsulta por agente seguia varrendo a tabela.
     */
    async pendentesRenderizaveis(conversaId: string): Promise<TurnoPendenteDto[]> {
      // ADR-083: turno de trabalho não é "agente ocupado" de ninguém, nem espera por isso: tem faixa própria.
      const pendentes = await conn<{ id: string; agente_id: string; bastidores: boolean }[]>`
        select id, agente_id, bastidores from turnos
        where tenant_id = ${escopo.tenantId} and conversa_id = ${conversaId} and estado = 'pendente' and origem <> 'ligacao' and trabalho_id is null
          -- ADR-086: a retomada marcada para mais tarde não está "na fila" — ela nem pode sair ainda.
          and (acordar_em is null or acordar_em <= now())
        order by criado_em`;
      if (pendentes.length === 0) return [];
      // revisto em 2026-10-07 (ADR-083): só a faixa da conversa segura um turno dela — o despachando sem trabalho NESTA
      // conversa (o do mesmo agente primeiro). O bot ocupado em outra conversa ou num trabalho não segura mais.
      // revisto em 2026-10-26 (ADR-130): e só o da MESMA faixa (a da pessoa ou a dos bastidores), como no `reivindicar`.
      const ocupados = await conn<{ agente_id: string; conversa_id: string; bastidores: boolean }[]>`
        select agente_id, conversa_id, bastidores from turnos
        where tenant_id = ${escopo.tenantId} and estado = 'despachando' and origem <> 'ligacao' and trabalho_id is null and conversa_id = ${conversaId}
        order by criado_em`;
      return pendentes.flatMap((p): TurnoPendenteDto[] => {
        const daFaixa = ocupados.filter((d) => d.bastidores === p.bastidores);
        const ocupado = daFaixa.find((d) => d.agente_id === p.agente_id) ?? daFaixa[0];
        return ocupado ? [{ id: p.id, motivo: "agente_ocupado_em", conversaId: ocupado.conversa_id }] : [];
      });
    },

    /** Entrega idempotente (ADR-021): true só na primeira vez de (turno, seq_local). */
    async registrarEntrega(turnoId: string, seqLocal: number): Promise<boolean> {
      const linhas = await conn`
        insert into turno_entregas (tenant_id, owner_id, turno_id, seq_local) values (${escopo.tenantId}, ${escopo.pessoaId}, ${turnoId}, ${seqLocal})
        on conflict (tenant_id, turno_id, seq_local) do nothing returning id`;
      return linhas.length === 1;
    },

    /**
     * Turnos concluídos por conversa, numa consulta (as execuções da frota, definido em 2026-09-30): a contagem real, no
     * índice turnos_por_conversa (0042). Conversa sem nenhum fica de fora.
     */
    async concluidosPorConversa(conversaIds: readonly string[]): Promise<Map<string, number>> {
      if (conversaIds.length === 0) return new Map();
      const linhas = await conn<{ conversa_id: string; n: number }[]>`
        select conversa_id, count(*)::int as n from turnos
        where tenant_id = ${escopo.tenantId} and conversa_id = any(${[...conversaIds]}::uuid[]) and estado = 'concluido'
        group by conversa_id`;
      return new Map(linhas.map((l) => [l.conversa_id, l.n]));
    },

    /**
     * definido em 2026-10-12 (ADR-099 §7, custo visível): o gasto por bot em cada janela [inicio, fim). `janela` é o índice
     * em `janelas`. Só a pessoa (RLS e o filtro do dono).
     *
     * revisto em 2026-10-15 (NOD-273, D4/D5): soma a tabela `gastos` pelo INSTANTE do gasto (`g.em`, o fim do turno), não
     * `turnos.custo_usd` pela criação do turno — o turno das 23h que termina às 2h conta no dia em que terminou (em 14 dias de
     * produção, 46 gastos cruzavam a meia-noite). E o gasto sem custo informado (o Codex) entra com os tokens: `semCusto`
     * diz que houve consumo que o dólar não cobre. Tokens = entrada + saída do que o CLI informou.
     */
    async custoPorAgente(janelas: readonly { inicio: number; fim: number }[]): Promise<SomaDoDia[]> {
      if (janelas.length === 0) return [];
      const inicios = janelas.map((j) => new Date(j.inicio).toISOString());
      const fins = janelas.map((j) => new Date(j.fim).toISOString());
      const linhas = await conn<{ agente_id: string; janela: number; usd: string; tokens: string; sem_custo: boolean }[]>`
        select t.agente_id, (j.i - 1)::int as janela, coalesce(sum(g.custo_usd), 0)::text as usd,
          sum(g.tokens_entrada::bigint + g.tokens_saida::bigint)::text as tokens,
          bool_or(g.custo_usd is null and g.tokens_entrada + g.tokens_saida > 0) as sem_custo
        from unnest(${inicios}::text[], ${fins}::text[]) with ordinality as j(inicio, fim, i)
        join gastos g on g.tenant_id = ${escopo.tenantId} and g.owner_id = ${escopo.pessoaId}
          and g.em >= j.inicio::timestamptz and g.em < j.fim::timestamptz
        join turnos t on t.tenant_id = g.tenant_id and t.id = g.turno_id
        group by t.agente_id, j.i`;
      return linhas.map((l) => ({ agenteId: l.agente_id, janela: l.janela, usd: Number(l.usd), tokens: Number(l.tokens), semCusto: l.sem_custo }));
    },

    /**
     * definido em 2026-10-05: as falas da pessoa barradas por falta de IA desde `desde`, uma por conversa — só a mais
     * nova, e só quando nada veio depois dela na conversa (repetir-barrados-por-ia.ts). NOD-269: a frente (com trabalho)
     * fica de fora — ela espera a conta pela própria volta, e a repetição sairia sem o vínculo com a task. NOD-311: a fala
     * com um Parar da conversa depois dela também (a parada do chat já não fica aberta segurando a repetição).
     */
    async barradosPorFaltaDeIa(desde: number): Promise<Turno[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from turnos t
        where t.tenant_id = ${escopo.tenantId} and t.owner_id = ${escopo.pessoaId} and t.origem = 'conversa' and t.estado = 'interrompido'
          and t.trabalho_id is null and t.motivo_interrupcao = 'executor_indisponivel' and t.criado_em >= ${data(desde)}
          -- NOD-269 (B5): a recusa por conta (despacho, 'sem_conta') e o limite ('limite_do_plano', inclusive os antigos
          -- gravados pelo despacho) já esperam a hora ou têm a nota de contas: repeti-los duplicava a nota a cada conexão.
          and t.motivo_falha is distinct from 'sem_conta' and t.motivo_falha is distinct from 'limite_do_plano'
          and not exists (select 1 from turnos n where n.tenant_id = t.tenant_id and n.conversa_id = t.conversa_id and n.criado_em > t.criado_em)
          -- NOD-311 (revisão): o Parar do chat encerra a parada na hora; a fala barrada antes dele não volta sozinha.
          and not exists (select 1 from paradas p where p.tenant_id = t.tenant_id and p.conversa_id = t.conversa_id and p.ativa_desde > t.criado_em)
        order by t.criado_em`;
      return linhas.map(paraTurno);
    },

    /**
     * definido em 2026-10-08 (revisão do épico, S20): trava (FOR UPDATE) os turnos pendentes e rodando de um trabalho, em
     * ordem de criação — a mesma em que a renovação e a entrega os pegam (o turno vivo, mais velho, antes dos recados).
     */
    async travarAbertosDoTrabalho(trabalhoId: string): Promise<Turno[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from turnos
        where tenant_id = ${escopo.tenantId} and trabalho_id = ${trabalhoId} and estado in ('pendente', 'despachando')
        order by criado_em, id for update`;
      return linhas.map(paraTurno);
    },

    /** Os turnos de um trabalho, em ordem (ADR-083): o Parar da task, a retomada e a tela da task. */
    async doTrabalho(trabalhoId: string): Promise<Turno[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from turnos where tenant_id = ${escopo.tenantId} and trabalho_id = ${trabalhoId} order by criado_em, id`;
      return linhas.map(paraTurno);
    },

    /**
     * A rede de 2 min (ADR-083, #193): o turno de conversa que está rodando passa a ser do trabalho. Só o que ainda roda
     * e ainda não tem trabalho — duas renovações seguidas não promovem duas vezes.
     */
    async vincularTrabalho(id: string, trabalhoId: string): Promise<Turno | null> {
      const [l] = await conn<Linha[]>`
        update turnos set trabalho_id = ${trabalhoId}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and trabalho_id is null and estado = 'despachando'
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraTurno(l) : null;
    },

    async listarDaConversa(conversaId: string, limite = 50): Promise<Turno[]> {
      const linhas = await conn<Linha[]>`
        select * from (
          select ${conn.unsafe(COLUNAS)} from turnos where tenant_id = ${escopo.tenantId} and conversa_id = ${conversaId} order by criado_em desc limit ${limite}
        ) r order by criado_em`;
      return linhas.map(paraTurno);
    },
  };
}

/** 2026-11-10: a condição da volta por evento como as colunas de turnos a guardam. */
type LinhaDaCondicao = { acordar_quando: string | null; acordar_pr_url: string | null; acordar_tarefa_id: string | null; acordar_tarefa_estado: string | null };

function colunasDaCondicao(c: CondicaoDaVolta | null): { quando: string | null; prUrl: string | null; tarefaId: string | null; estado: string | null } {
  if (!c) return { quando: null, prUrl: null, tarefaId: null, estado: null };
  return c.quando === "tarefa" ? { quando: "tarefa", prUrl: null, tarefaId: c.tarefaId, estado: c.estado } : { quando: c.quando, prUrl: c.prUrl, tarefaId: null, estado: null };
}

function condicaoDaLinha(l: LinhaDaCondicao): CondicaoDaVolta | null {
  if (l.acordar_quando === "tarefa") {
    if (!l.acordar_tarefa_id) return null;
    const e = l.acordar_tarefa_estado;
    return { quando: "tarefa", tarefaId: l.acordar_tarefa_id, estado: e === "feito" || e === "revisao" || e === "bloqueado" ? e : null };
  }
  if ((l.acordar_quando === "ci" || l.acordar_quando === "merge" || l.acordar_quando === "conflito") && l.acordar_pr_url) return { quando: l.acordar_quando, prUrl: l.acordar_pr_url };
  return null;
}
