import type { IdHarness } from "../contracts/harness.ts";
import type { LimiteDaIa, LimitesIa } from "../contracts/inteligencia.ts";
import { EXPERIMENTOS_DESLIGADOS, USO_DO_MAC_PADRAO, type ComposicaoRaioX, type ExecucaoRaioX, type ExibirDoQuadro, type Experimentos, type Preferencias, type UsoDoMac } from "../contracts/raio-x.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { QUADROS_PARA_TODOS, quadroLiberadoPara, type LiberacaoQuadros } from "../domain/flag-quadros.ts";
import { data, jsonb, ms } from "./conversao.ts";

/** Um turno com o que o Raio-X guardou dele; o caso de uso monta o resumo (domain/raio-x.ts). */
export type TurnoComRaioX = {
  turnoId: string;
  agenteId: string;
  estado: string;
  custoUsd: number | null;
  criadoEm: number;
  composicao: ComposicaoRaioX | null;
  execucao: ExecucaoRaioX | null;
};

interface Linha {
  id: string;
  agente_id: string;
  estado: string;
  custo_usd: string | null;
  criado_em: Date;
  composicao: ComposicaoRaioX | null;
  execucao: ExecucaoRaioX | null;
}

function paraTurno(l: Linha): TurnoComRaioX {
  return {
    turnoId: l.id,
    agenteId: l.agente_id,
    estado: l.estado,
    custoUsd: l.custo_usd === null ? null : Number(l.custo_usd),
    criadoEm: ms(l.criado_em),
    composicao: l.composicao,
    execucao: l.execucao,
  };
}

/**
 * Raio-X do turno (modo dev, 0036). As duas metades chegam em momentos diferentes — a composição na emissão do
 * plano, a execução na entrega — e cada uma faz upsert só da sua coluna. A leitura parte de `turnos`: turno que a
 * pessoa não vê (RLS) não tem Raio-X, e turno sem linha aqui (anterior à 0036) ainda mostra o custo.
 */
export function raioXRepo(conn: Conn, escopo: Escopo) {
  return {
    async gravarComposicao(turnoId: string, composicao: ComposicaoRaioX): Promise<void> {
      await conn`
        insert into turno_raio_x (tenant_id, owner_id, turno_id, composicao)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${turnoId}, ${jsonb(conn, composicao)})
        on conflict (tenant_id, turno_id) do update set composicao = excluded.composicao, atualizado_em = clock_timestamp()`;
    },

    async gravarExecucao(turnoId: string, execucao: ExecucaoRaioX): Promise<void> {
      await conn`
        insert into turno_raio_x (tenant_id, owner_id, turno_id, execucao)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${turnoId}, ${jsonb(conn, execucao)})
        on conflict (tenant_id, turno_id) do update set execucao = excluded.execucao, atualizado_em = clock_timestamp()`;
    },

    async doTurno(turnoId: string): Promise<TurnoComRaioX | null> {
      const [l] = await conn<Linha[]>`
        select t.id, t.agente_id, t.estado, t.custo_usd, t.criado_em, r.composicao, r.execucao
        from turnos t
        left join turno_raio_x r on r.tenant_id = t.tenant_id and r.turno_id = t.id
        where t.tenant_id = ${escopo.tenantId} and t.id = ${turnoId}`;
      return l ? paraTurno(l) : null;
    },

    /** Os turnos mais recentes da conversa, sem a composição (a faixa dev só precisa da execução). */
    async daConversa(conversaId: string, limite: number): Promise<TurnoComRaioX[]> {
      const linhas = await conn<Linha[]>`
        select t.id, t.agente_id, t.estado, t.custo_usd, t.criado_em, null as composicao, r.execucao
        from turnos t
        left join turno_raio_x r on r.tenant_id = t.tenant_id and r.turno_id = t.id
        where t.tenant_id = ${escopo.tenantId} and t.conversa_id = ${conversaId}
        order by t.criado_em desc
        limit ${limite}`;
      return linhas.map(paraTurno);
    },

    /**
     * Custo e turnos da conversa desde `desde` (a meia-noite de quem pergunta). Conta o turno que tem custo ou gasto
     * registrado. revisto em 2026-10-15 (NOD-273): o turno do Codex (gasto sem custo informado) conta como turno e marca
     * `parcial` — antes sumia da conta e o "Hoje com o bot" mentia.
     */
    async totalDesde(conversaId: string, desde: number): Promise<{ custoUsd: number; turnos: number; parcial?: boolean }> {
      const [l] = await conn<{ custo: string | null; turnos: number; parcial: boolean | null }[]>`
        select sum(t.custo_usd) as custo, count(*)::int as turnos,
          bool_or(t.custo_usd is null) as parcial
        from turnos t
        where t.tenant_id = ${escopo.tenantId} and t.conversa_id = ${conversaId} and t.criado_em >= ${data(desde)}
          and (t.custo_usd is not null or exists (
            select 1 from gastos g where g.tenant_id = t.tenant_id and g.turno_id = t.id and g.tokens_entrada + g.tokens_saida > 0))`;
      const custoUsd = l?.custo === null || l?.custo === undefined ? 0 : Number(l.custo);
      return { custoUsd, turnos: l?.turnos ?? 0, ...(l?.parcial ? { parcial: true } : {}) };
    },
  };
}

/** Preferências da pessoa (0036). Sem linha = tudo desligado. */
/** ADR-111 (0088): `exp_calibracao` e `exp_memoria_longa`, as chaves de experimento. ADR-112 (0089): `exp_whatsapp`. NOD-429 (0130): `exp_quadro`. */
const COLUNAS_PREFERENCIAS = "modo_dev, avisos_fechados, uso_do_mac, maquina_padrao_id, ordem_ias, ias_no_limite, exp_calibracao, exp_memoria_longa, exp_whatsapp, exp_quadro, quadro_exibir";

/**
 * NOD-415 (ADR-141): a liberação dos quadros (NOD_QUADROS) deste processo, que o compor configura ao subir. Fica aqui,
 * na leitura das preferências, porque todo caminho do quadro (tela, pílula, `gerir_quadro`, rotas) lê
 * `experimentos.quadro` por este repo: quem não está liberado lê a chave desligada e não consegue ligá-la.
 */
let liberacaoQuadros: LiberacaoQuadros = QUADROS_PARA_TODOS;
export function configurarLiberacaoQuadros(l: LiberacaoQuadros): void {
  liberacaoQuadros = l;
}

/** ADA-14 (ADR-153): a liberação do 2º quadro em diante (NOD_QUADROS_N), na mesma regra da NOD_QUADROS. */
let liberacaoQuadrosN: LiberacaoQuadros = QUADROS_PARA_TODOS;
export function configurarLiberacaoQuadrosN(l: LiberacaoQuadros): void {
  liberacaoQuadrosN = l;
}

export function preferenciasRepo(conn: Conn, escopo: Escopo) {
  let liberado: Promise<boolean> | null = null;
  let liberadoN: Promise<boolean> | null = null;
  const quadroLiberado = (): Promise<boolean> => (liberado ??= (async () => {
    const l = liberacaoQuadros;
    if (l.modo !== "admins") return quadroLiberadoPara(l, { id: escopo.pessoaId });
    const [p] = await conn<{ email: string | null }[]>`select email from pessoas where tenant_id = ${escopo.tenantId} and id = ${escopo.pessoaId}`;
    return quadroLiberadoPara(l, { id: escopo.pessoaId, email: p?.email ?? null });
  })());
  /** A chave `quadro` só vale para quem está liberado; `quadroLiberado` diz à web se mostra a chave. */
  const comLiberacao = async (p: Preferencias): Promise<Preferencias> => {
    const lib = await quadroLiberado();
    return { ...p, quadroLiberado: lib, experimentos: { ...(p.experimentos ?? EXPERIMENTOS_DESLIGADOS), quadro: lib && (p.experimentos?.quadro ?? false) } };
  };
  type Linha = { modo_dev: boolean; avisos_fechados: string[]; uso_do_mac: UsoDoMac; maquina_padrao_id: string | null; ordem_ias: IdHarness[] | null; ias_no_limite: LimitesIa | null; exp_calibracao: boolean; exp_memoria_longa: boolean; exp_whatsapp: boolean; exp_quadro: boolean; quadro_exibir?: Record<string, ExibirDoQuadro> | null };
  const paraPreferencias = (l: Linha | undefined): Preferencias => ({ modoDev: l?.modo_dev ?? false, avisosFechados: l?.avisos_fechados ?? [], usoDoMac: l?.uso_do_mac ?? USO_DO_MAC_PADRAO, maquinaPadraoId: l?.maquina_padrao_id ?? null, ordemIas: l?.ordem_ias ?? null, iasNoLimite: l?.ias_no_limite ?? {}, experimentos: { calibracao: l?.exp_calibracao ?? false, memoriaLonga: l?.exp_memoria_longa ?? false, whatsapp: l?.exp_whatsapp ?? false, quadro: l?.exp_quadro ?? false }, quadroExibir: l?.quadro_exibir ?? {} });
  return {
    /** ADA-14: a pessoa pode ter o 2º quadro num bot (a flag NOD_QUADROS_N). */
    quadrosNLiberado(): Promise<boolean> {
      return (liberadoN ??= (async () => {
        const l = liberacaoQuadrosN;
        if (l.modo !== "admins") return quadroLiberadoPara(l, { id: escopo.pessoaId });
        const [p] = await conn<{ email: string | null }[]>`select email from pessoas where tenant_id = ${escopo.tenantId} and id = ${escopo.pessoaId}`;
        return quadroLiberadoPara(l, { id: escopo.pessoaId, email: p?.email ?? null });
      })());
    },
    /** ADA-14: o último quadro aberto em cada bot (o app Quadro reabre nele). */
    async quadroAberto(agenteId: string): Promise<string | null> {
      const [l] = await conn<{ q: string | null }[]>`
        select quadro_aberto ->> ${agenteId}::text as q from preferencias where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId}`;
      return l?.q ?? null;
    },
    /** ADA-14: grava o quadro aberto no bot (substitui o daquele bot; os outros ficam). */
    async abrirQuadro(agenteId: string, quadroId: string): Promise<void> {
      const valor = jsonb(conn, { [agenteId]: quadroId });
      await conn`
        insert into preferencias (tenant_id, owner_id, quadro_aberto) values (${escopo.tenantId}, ${escopo.pessoaId}, ${valor}::jsonb)
        on conflict (tenant_id, owner_id) do update set quadro_aberto = preferencias.quadro_aberto || ${valor}::jsonb, atualizado_em = clock_timestamp()`;
    },
    async buscar(): Promise<Preferencias> {
      const [l] = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS_PREFERENCIAS)} from preferencias where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId}`;
      return comLiberacao(paraPreferencias(l));
    },

    /** O que vier muda; o que faltar fica como está. ADR-099 (I10): `faixa_trabalhos_recolhida` fica no banco, sem uso. */
    /** 0068: `ordemIas` null volta à ordem padrão; ausente não mexe. */
    /** ADR-111: cada chave de `experimentos` que vier muda sozinha; a outra fica. */
    async gravar(p: { modoDev?: boolean; usoDoMac?: UsoDoMac; ordemIas?: IdHarness[] | null; experimentos?: Partial<Experimentos> }): Promise<Preferencias> {
      const ordem = p.ordemIas ? jsonb(conn, p.ordemIas) : null;
      const calibracao = p.experimentos?.calibracao ?? null;
      const memoriaLonga = p.experimentos?.memoriaLonga ?? null;
      const whatsapp = p.experimentos?.whatsapp ?? null;
      // NOD-415: sem liberação, ligar o quadro não grava (a chave guardada fica como está).
      const quadro = p.experimentos?.quadro !== undefined && (await quadroLiberado()) ? p.experimentos.quadro : null;
      const [l] = await conn<Linha[]>`
        insert into preferencias (tenant_id, owner_id, modo_dev, uso_do_mac, ordem_ias, exp_calibracao, exp_memoria_longa, exp_whatsapp, exp_quadro)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${p.modoDev ?? false}, ${p.usoDoMac ?? USO_DO_MAC_PADRAO}, ${ordem}::jsonb, ${calibracao ?? false}, ${memoriaLonga ?? false}, ${whatsapp ?? false}, ${quadro ?? false})
        on conflict (tenant_id, owner_id) do update set
          modo_dev = coalesce(${p.modoDev ?? null}::boolean, preferencias.modo_dev),
          exp_calibracao = coalesce(${calibracao}::boolean, preferencias.exp_calibracao),
          exp_memoria_longa = coalesce(${memoriaLonga}::boolean, preferencias.exp_memoria_longa),
          exp_whatsapp = coalesce(${whatsapp}::boolean, preferencias.exp_whatsapp),
          exp_quadro = coalesce(${quadro}::boolean, preferencias.exp_quadro),
          uso_do_mac = coalesce(${p.usoDoMac ?? null}::text, preferencias.uso_do_mac),
          ordem_ias = case when ${p.ordemIas !== undefined} then ${ordem}::jsonb else preferencias.ordem_ias end,
          atualizado_em = clock_timestamp()
        returning ${conn.unsafe(COLUNAS_PREFERENCIAS)}`;
      return comLiberacao(paraPreferencias(l));
    },

    /** ADR-090: a máquina onde bot sem escolha trabalha (id da chave; null = qualquer uma). Quem chama já conferiu a chave. */
    async definirMaquinaPadrao(maquinaId: string | null): Promise<Preferencias> {
      const [l] = await conn<Linha[]>`
        insert into preferencias (tenant_id, owner_id, maquina_padrao_id)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${maquinaId})
        on conflict (tenant_id, owner_id) do update set maquina_padrao_id = ${maquinaId}, atualizado_em = clock_timestamp()
        returning ${conn.unsafe(COLUNAS_PREFERENCIAS)}`;
      return comLiberacao(paraPreferencias(l));
    },

    /**
     * 0068 (emenda da ADR-036): a IA chegou ao limite da assinatura até `renovaEm`. Por IA, a última gravação vence (dois
     * turnos no limite ao mesmo tempo gravam o mesmo prazo, ou um mais novo).
     */
    async registrarLimite(ia: IdHarness, limite: LimiteDaIa): Promise<LimitesIa> {
      const [l] = await conn<{ ias_no_limite: LimitesIa }[]>`
        insert into preferencias (tenant_id, owner_id, ias_no_limite)
        values (${escopo.tenantId}, ${escopo.pessoaId}, jsonb_build_object(${ia}::text, ${jsonb(conn, limite)}::jsonb))
        on conflict (tenant_id, owner_id) do update set
          ias_no_limite = preferencias.ias_no_limite || jsonb_build_object(${ia}::text, ${jsonb(conn, limite)}::jsonb),
          atualizado_em = clock_timestamp()
        returning ias_no_limite`;
      return l?.ias_no_limite ?? {};
    },

    /** 0068: um turno deu certo na IA — ela sai do limite. true = estava lá (a tela precisa saber). */
    async limparLimite(ia: IdHarness): Promise<boolean> {
      const r = await conn`update preferencias set ias_no_limite = ias_no_limite - ${ia}::text, atualizado_em = clock_timestamp()
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and ias_no_limite ? ${ia}::text`;
      return r.count > 0;
    },

    /** NOD-460 (0149): o Exibir de um quadro (substitui o daquele quadro; os outros ficam). Quem chama já conferiu o teto. */
    /**
     * NOD-460 (0149): grava o Exibir de um quadro. O teto (`max` quadros com Exibir) vale dentro do próprio upsert: o
     * ON CONFLICT trava a linha e confere a contagem na versão mais nova, então pedidos simultâneos não passam do teto
     * (QA do PR #645). Null = cheio, e o quadro é novo no mapa.
     */
    async exibirQuadro(quadroId: string, e: Partial<ExibirDoQuadro>, max: number): Promise<Preferencias | null> {
      // ADA-18: muda só os campos que vieram, por cima do que o quadro já tinha (o padrão da tela embaixo): trocar a
      // visão no celular não apaga as recolhidas do computador, e vice-versa.
      const padrao = jsonb(conn, { recolhidas: true, compacto: false });
      const campos = jsonb(conn, e);
      const [l] = await conn<Linha[]>`
        insert into preferencias (tenant_id, owner_id, quadro_exibir)
        values (${escopo.tenantId}, ${escopo.pessoaId}, jsonb_build_object(${quadroId}::text, ${padrao}::jsonb || ${campos}::jsonb))
        on conflict (tenant_id, owner_id) do update set
          quadro_exibir = preferencias.quadro_exibir || jsonb_build_object(${quadroId}::text,
            ${padrao}::jsonb || coalesce(preferencias.quadro_exibir -> ${quadroId}, '{}'::jsonb) || ${campos}::jsonb),
          atualizado_em = clock_timestamp()
        where preferencias.quadro_exibir ? ${quadroId}
          or (select count(*) from jsonb_object_keys(preferencias.quadro_exibir)) < ${max}
        returning ${conn.unsafe(COLUNAS_PREFERENCIAS)}`;
      return l ? comLiberacao(paraPreferencias(l)) : null;
    },

    /** 0059: guarda a chave do aviso fechado, sem repetir. Idempotente: fechar de novo não muda nada. */
    async fecharAviso(chave: string): Promise<Preferencias> {
      const [l] = await conn<Linha[]>`
        insert into preferencias (tenant_id, owner_id, avisos_fechados)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${[chave]}::text[])
        on conflict (tenant_id, owner_id) do update set
          avisos_fechados = case when ${chave} = any(preferencias.avisos_fechados) then preferencias.avisos_fechados
            else array_append(preferencias.avisos_fechados, ${chave}) end,
          atualizado_em = clock_timestamp()
        returning ${conn.unsafe(COLUNAS_PREFERENCIAS)}`;
      return comLiberacao(paraPreferencias(l));
    },
  };
}
