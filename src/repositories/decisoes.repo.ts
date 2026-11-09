import { TIPOS_DISPENSAVEIS_ABERTOS, type Decisao, type DesfechoDecisao, type EstadoDecisao, type TipoDecisao } from "../contracts/decisao.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { data, dataOuNull, iso, isoOuNull } from "./conversao.ts";

interface Linha {
  tenant_id: string;
  id: string;
  owner_id: string;
  decisor_id: string;
  agente_id: string;
  conversa_id: string;
  turno_id: string | null;
  tipo: TipoDecisao;
  estado: EstadoDecisao;
  prazo_decisao_em: Date;
  prazo_execucao_em: Date | null;
  frase: string;
  desfecho: DesfechoDecisao | null;
  vista_em: Date | null;
  criado_em: Date;
  fio_id: string | null;
  tarefa_id: string | null;
  tarefa_pede_done: boolean;
}

const COLUNAS = "tenant_id, id, owner_id, decisor_id, agente_id, conversa_id, turno_id, tipo, estado, prazo_decisao_em, prazo_execucao_em, frase, desfecho, vista_em, criado_em, fio_id, tarefa_id, tarefa_pede_done";

function paraDecisao(l: Linha): Decisao {
  return {
    tenantId: l.tenant_id,
    id: l.id,
    ownerId: l.owner_id,
    decisorId: l.decisor_id,
    agenteId: l.agente_id,
    conversaId: l.conversa_id,
    turnoId: l.turno_id,
    tipo: l.tipo,
    estado: l.estado,
    prazoDecisaoEm: iso(l.prazo_decisao_em),
    prazoExecucaoEm: isoOuNull(l.prazo_execucao_em),
    frase: l.frase,
    desfecho: l.desfecho,
    vistaEm: isoOuNull(l.vista_em),
    criadoEm: iso(l.criado_em),
    fioId: l.fio_id,
    ...(l.tarefa_id ? { tarefaId: l.tarefa_id } : {}),
    ...(l.tarefa_pede_done ? { tarefaPedeDone: true as const } : {}),
  };
}

export type NovaDecisao = {
  id?: string;
  tipo: TipoDecisao;
  /** Default: a própria pessoa da sessão (dona). Pessoa nomeada em pedir_a_pessoa entra aqui (EMENDA 16). */
  decisorId?: string;
  agenteId: string;
  conversaId: string;
  turnoId?: string | null;
  prazoDecisaoEm: number;
  prazoExecucaoEm?: number | null;
  frase: string;
  /** definido em 2026-09-24 (fio da pergunta, 0024): a primeira decisão do fio, na rodada seguinte de uma pergunta respondida. */
  fioId?: string | null;
  /** ADR-115 (0093): a decisão nasce esperando o revisor, não a pessoa. Ausente = 'pendente' (o default da coluna). */
  estado?: "em_revisao";
  /** ADA-28 (ADR-159): a tarefa de que a decisão é a espera; `tarefaPedeDone`, a "pronta para o Done" (escopo E). */
  tarefaId?: string | null;
  tarefaPedeDone?: boolean;
};

/** definido em 2026-09-16: vencidas ficam visíveis em cinza por 7 dias (ADR-007: nunca suprimidas de imediato). */
export const VENCIDAS_VISIVEIS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Pendências de "Sua vez" (ADR-007). Duas pernas de RLS (EMENDA 1): dono vê pela owner_id, decisor
 * pela perna extra — e a leitura de listarSuaVez roda sob a policy do role nod_app, nunca com
 * role privilegiado mais filtro na aplicação.
 *
 * Escrita pela DECISORA (0003): marcarVista/decidir/reabrir aceitam dona OU decisora designada —
 * a policy nod_decisora (FOR UPDATE, USING e WITH CHECK por decisor_id) é quem concede; o filtro
 * explícito abaixo existe para a linha 'equipe' de terceiros devolver null em vez de 42501
 * (contrato: repositório devolve null, nunca lança). vencerPendentes e as escritas de laço
 * continuam pela dona (paraCadaPessoa). Provado em tests/integration/repos/decisora-escreve.test.ts.
 */
export function decisoesRepo(conn: Conn, escopo: Escopo) {
  const donaOuDecisora = (): ReturnType<Conn> => conn`(owner_id = ${escopo.pessoaId} or decisor_id = ${escopo.pessoaId})`;
  return {
    async criar(d: NovaDecisao): Promise<Decisao | null> {
      const [l] = await conn<Linha[]>`
        insert into decisoes (tenant_id, id, owner_id, decisor_id, agente_id, conversa_id, turno_id, tipo, prazo_decisao_em, prazo_execucao_em, frase, fio_id, estado, tarefa_id, tarefa_pede_done)
        values (${escopo.tenantId}, ${d.id ?? conn`gen_random_uuid()`}, ${escopo.pessoaId}, ${d.decisorId ?? escopo.pessoaId}, ${d.agenteId}, ${d.conversaId},
          ${d.turnoId ?? null}, ${d.tipo}, ${data(d.prazoDecisaoEm)}, ${dataOuNull(d.prazoExecucaoEm)}, ${d.frase}, ${d.fioId ?? null}, ${d.estado ?? "pendente"}, ${d.tarefaId ?? null}, ${d.tarefaPedeDone ?? false})
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraDecisao(l) : null;
    },

    /** ADA-28 (ADR-159): liga a decisão recém-criada à tarefa do turno (só a dona; a decisão ainda aberta). */
    async ligarATarefa(id: string, tarefaId: string): Promise<Decisao | null> {
      const [l] = await conn<Linha[]>`update decisoes set tarefa_id = ${tarefaId}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and estado in ('pendente', 'reaberta')
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraDecisao(l) : null;
    },

    /** ADA-28 (ADR-159): as decisões abertas que são a espera destas tarefas (índice parcial decisoes_da_tarefa). */
    async abertasDasTarefas(tarefaIds: readonly string[]): Promise<Decisao[]> {
      if (tarefaIds.length === 0) return [];
      const ls = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from decisoes
        where tenant_id = ${escopo.tenantId} and tarefa_id in ${conn(tarefaIds as string[])} and estado in ('pendente', 'reaberta')
        order by criado_em, id`;
      return ls.map(paraDecisao);
    },

    async buscar(id: string): Promise<Decisao | null> {
      const [l] = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from decisoes where tenant_id = ${escopo.tenantId} and id = ${id}`;
      return l ? paraDecisao(l) : null;
    },

    /**
     * "Sua vez" da pessoa da sessão como DECISORA: pendentes, reabertas e vencidas recentes, com o
     * estado como COLUNA (vencido em cinza, nunca suprimido). agenteNome vem por LEFT JOIN porque o
     * agente de outra pessoa pode ser invisível para a decisora (RLS): cai em 'agente'.
     */
    async listarSuaVez(agora: number): Promise<(Decisao & { agenteNome: string; trabalhoId: string | null })[]> {
      // definido em 2026-10-08 (revisão do épico, S4): o trabalho do turno da decisão separa as gêmeas por faixa — o
      // "Retomar" de uma task não se dobra com o da conversa nem com o de outra task (montarFila, chaveDeGemea).
      const linhas = await conn<(Linha & { agente_nome: string | null; trabalho_id: string | null })[]>`
        select ${conn.unsafe(COLUNAS.split(", ").map((c) => `d.${c}`).join(", "))}, a.nome as agente_nome, t.trabalho_id
        from decisoes d left join agentes a on a.tenant_id = d.tenant_id and a.id = d.agente_id
          left join turnos t on t.tenant_id = d.tenant_id and t.id = d.turno_id
        where d.tenant_id = ${escopo.tenantId} and d.decisor_id = ${escopo.pessoaId}
          and (d.estado in ('pendente', 'reaberta') or (d.estado = 'vencida' and d.prazo_decisao_em >= ${data(agora - VENCIDAS_VISIVEIS_MS)}))
        order by d.criado_em`;
      return linhas.map((l) => ({ ...paraDecisao(l), agenteNome: l.agente_nome ?? "agente", trabalhoId: l.trabalho_id }));
    },

    /** As decisões que um turno criou (fio da pergunta: a pergunta respondida que a retomada continua). */
    async doTurno(turnoId: string): Promise<Decisao[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from decisoes where tenant_id = ${escopo.tenantId} and turno_id = ${turnoId} order by criado_em`;
      return linhas.map(paraDecisao);
    },

    /**
     * Os fios inteiros (definido em 2026-09-24, 0024): cada id é a raiz de um fio; volta a raiz e as
     * rodadas seguintes (índice decisoes_por_fio). Dado um id de rodada, volta ela mesma.
     */
    async dosFios(ids: readonly string[]): Promise<Decisao[]> {
      if (ids.length === 0) return [];
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from decisoes where tenant_id = ${escopo.tenantId} and (id in ${conn([...ids])} or fio_id in ${conn([...ids])}) order by criado_em`;
      return linhas.map(paraDecisao);
    },

    /**
     * definido em 2026-10-08 (revisão do épico, S1): as decisões ainda abertas dos turnos de um trabalho — o Parar da task,
     * o "Fazer aqui" e o Parar do chat as fecham por regra, senão uma aprovação depois do Parar reabria a task.
     */
    async abertasDoTrabalho(trabalhoId: string): Promise<Decisao[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS.split(", ").map((c) => `d.${c}`).join(", "))}
        from decisoes d join turnos t on t.tenant_id = d.tenant_id and t.id = d.turno_id
        where d.tenant_id = ${escopo.tenantId} and t.trabalho_id = ${trabalhoId} and d.estado in ('pendente', 'reaberta')
        order by d.criado_em, d.id`;
      return linhas.map(paraDecisao);
    },

    async pendentesDaConversa(conversaId: string): Promise<Decisao[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from decisoes where tenant_id = ${escopo.tenantId} and conversa_id = ${conversaId} and estado in ('pendente', 'reaberta') order by criado_em`;
      return linhas.map(paraDecisao);
    },

    async marcarVista(id: string, agora: number): Promise<boolean> {
      const r = await conn`update decisoes set vista_em = coalesce(vista_em, ${data(agora)}) where tenant_id = ${escopo.tenantId} and ${donaOuDecisora()} and id = ${id}`;
      return r.count === 1;
    },

    /**
     * definido em 2026-09-28 (0032): quem continua esta decisão — o turno que a esperava ('turno') ou uma
     * retomada ('retomada'). O primeiro a reivindicar ganha: "minha" = acabou de ganhar; senão, quem já tinha.
     */
    async reivindicarContinuacao(id: string, por: "turno" | "retomada", agora: number): Promise<"minha" | "turno" | "retomada" | null> {
      const [l] = await conn<{ continuada_por: string }[]>`
        update decisoes set continuada_em = ${data(agora)}, continuada_por = ${por}
        where tenant_id = ${escopo.tenantId} and id = ${id} and continuada_em is null
        returning continuada_por`;
      if (l) return "minha";
      const [atual] = await conn<{ continuada_por: string | null }[]>`select continuada_por from decisoes where tenant_id = ${escopo.tenantId} and id = ${id}`;
      return atual?.continuada_por === "turno" || atual?.continuada_por === "retomada" ? atual.continuada_por : null;
    },

    /** Aprovações deste turno já decididas que ninguém continuou (0032): o assentamento do turno as retoma. */
    async aContinuarDoTurno(turnoId: string): Promise<Decisao[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from decisoes
        where tenant_id = ${escopo.tenantId} and turno_id = ${turnoId} and tipo = 'aprovacao' and estado = 'decidida' and continuada_em is null
        order by decidida_em`;
      return linhas.map(paraDecisao);
    },

    /** Só decide o que está aberto; a segunda chamada devolve null (idempotência na rota). */
    async decidir(id: string, p: { por: string; agora: number }): Promise<Decisao | null> {
      const desfecho: DesfechoDecisao = { tipo: "decidida", por: p.por, em: iso(p.agora) };
      const [l] = await conn<Linha[]>`
        update decisoes set estado = 'decidida', desfecho = ${conn.json(desfecho)}, decidida_em = ${data(p.agora)}, decidida_por = ${p.por}
        where tenant_id = ${escopo.tenantId} and ${donaOuDecisora()} and id = ${id} and estado in ('pendente', 'reaberta')
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraDecisao(l) : null;
    },

    /**
     * ADR-042: decisão resolvida por REGRA nasce e morre fechada, sem pessoa. `decidida_por` (uuid)
     * fica NULA — quem decidiu está no desfecho tipado e na autoria do evento (ADR-023: autoria
     * nunca se infere de outro campo). Fechada não entra em listarSuaVez, não conta na gauge
     * pendencia_mais_velha_s e não pode expirar: nada é suprimido, só nunca fica pendente (ADR-007).
     * Também fecha a REABERTA (definido em 2026-09-24, ADR-045): um "Retomar" reaberto que uma queda
     * nova substitui (regra:retomada_substituida) senão ficaria para sempre ao lado do novo.
     */
    async fecharPorRegra(id: string, p: { regra: `regra:${string}`; regraVersao: number; agora: number; tambemVencida?: boolean; tambemEmRevisao?: boolean }): Promise<Decisao | null> {
      const desfecho: DesfechoDecisao = { tipo: "decidida_por_regra", regra: p.regra, regraVersao: p.regraVersao, em: iso(p.agora) };
      // revisto em 2026-10-15 (NOD-270, I4): `tambemVencida` — o card de acesso que o varredor acabou de vencer, mas cujo
      // acesso já foi dado por outro caminho, fecha como atendido (regra:acesso_ja_concedido) em vez de pausar a rotina.
      // revisto em 2026-11-02 (NOD-418, revisão 3 do PR #625): `tambemEmRevisao` — a cadeia do trabalho do quadro que o
      // Repetir, o Cancelar ou o varredor soltou fecha também a decisão que o revisor ainda olha; o veredito tardio acha
      // a decisão fechada (concluirRevisao volta null) e não vira cartão nem libera.
      const estados = ["pendente", "reaberta", ...(p.tambemVencida ? ["vencida"] : []), ...(p.tambemEmRevisao ? ["em_revisao"] : [])];
      const [l] = await conn<Linha[]>`
        update decisoes set estado = 'decidida', desfecho = ${conn.json(desfecho)}, decidida_em = ${data(p.agora)}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and estado in ${conn(estados)}
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraDecisao(l) : null;
    },

    /**
     * ADR-115 (fase 3 da revisão): a decisão `em_revisao` sai dela UMA vez — `liberar` fecha por regra (decidida, desfecho
     * `decidida_por_regra`, decidida_por nulo, como `fecharPorRegra`); `pendente` vira o cartão de sempre, com prazo novo.
     * Idempotente pelo `where estado = 'em_revisao'`: o relato repetido, o prazo e o varredor que correm juntos não
     * regravam (o segundo volta null). Pela dona, como as escritas de laço.
     */
    async concluirRevisao(id: string, p: { liberar: { regra: `regra:${string}`; regraVersao: number }; agora: number } | { pendente: { prazoDecisaoEm: number }; agora: number }): Promise<Decisao | null> {
      const [l] = "liberar" in p
        ? await conn<Linha[]>`
          update decisoes set estado = 'decidida', desfecho = ${conn.json({ tipo: "decidida_por_regra", regra: p.liberar.regra, regraVersao: p.liberar.regraVersao, em: iso(p.agora) } satisfies DesfechoDecisao)}, decidida_em = ${data(p.agora)}
          where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and estado = 'em_revisao'
          returning ${conn.unsafe(COLUNAS)}`
        : await conn<Linha[]>`
          update decisoes set estado = 'pendente', prazo_decisao_em = ${data(p.pendente.prazoDecisaoEm)}
          where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and estado = 'em_revisao'
          returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraDecisao(l) : null;
    },

    /** ADR-115: as decisões da dona ainda `em_revisao` criadas antes de `antesDe` (o varredor de expiração as recolhe). */
    async emRevisaoAntesDe(antesDe: number): Promise<Decisao[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from decisoes
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and estado = 'em_revisao' and criado_em < ${data(antesDe)}
        order by criado_em limit 100`;
      return linhas.map(paraDecisao);
    },

    /**
     * definido em 2026-10-15 (NOD-261, G3): um turno do trabalho concluiu — os "Retomar" ainda abertos de turnos ANTERIORES
     * do mesmo trabalho fecham por regra (`regra:retomar_superado`). Sem isso o card do turno caído segurava a frente em
     * "Sua vez" depois que um recado posterior já a tinha concluído, e o lote nunca fechava. Anterior = criado antes do
     * turno que concluiu; o "Retomar" de um turno posterior (que caiu depois) segue valendo. Pela dona, como fecharPorRegra.
     */
    async fecharRetomarAnteriores(trabalhoId: string, turnoIdAtual: string, p: { regra: `regra:${string}`; regraVersao: number; agora: number }): Promise<Decisao[]> {
      const desfecho: DesfechoDecisao = { tipo: "decidida_por_regra", regra: p.regra, regraVersao: p.regraVersao, em: iso(p.agora) };
      const linhas = await conn<Linha[]>`
        update decisoes d set estado = 'decidida', desfecho = ${conn.json(desfecho)}, decidida_em = ${data(p.agora)}
        from turnos t, turnos atual
        where d.tenant_id = ${escopo.tenantId} and d.owner_id = ${escopo.pessoaId} and d.tipo = 'retomar_turno' and d.estado in ('pendente', 'reaberta')
          and t.tenant_id = d.tenant_id and t.id = d.turno_id and t.trabalho_id = ${trabalhoId}
          and atual.tenant_id = d.tenant_id and atual.id = ${turnoIdAtual} and t.id <> atual.id
          and (t.criado_em, t.id) < (atual.criado_em, atual.id)
        returning ${conn.unsafe(COLUNAS.split(", ").map((c) => `d.${c}`).join(", "))}`;
      return linhas.map(paraDecisao);
    },

    /**
     * Dispensar (definido em 2026-09-24): fecha como 'decidida' com desfecho 'dispensada'. Vale para
     * vencida de qualquer tipo e para aberta só de TIPOS_DISPENSAVEIS_ABERTOS (os que se respondem com
     * texto e o retomar_turno, ADR-045) — os outros têm botão de recusar próprio, e dispensar uma
     * aprovação pularia o registro dos itens.
     */
    async dispensar(id: string, p: { por: string; agora: number; antes: EstadoDecisao }): Promise<Decisao | null> {
      const desfecho: DesfechoDecisao = { tipo: "dispensada", por: p.por, em: iso(p.agora), antes: p.antes };
      const [l] = await conn<Linha[]>`
        update decisoes set estado = 'decidida', desfecho = ${conn.json(desfecho)}, decidida_em = ${data(p.agora)}, decidida_por = ${p.por}
        where tenant_id = ${escopo.tenantId} and ${donaOuDecisora()} and id = ${id} and estado = ${p.antes}
          and (estado = 'vencida' or tipo in ${conn([...TIPOS_DISPENSAVEIS_ABERTOS])})
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraDecisao(l) : null;
    },

    /** Reabrir volta ao topo com prazo novo e sem desfecho (ADR-007). */
    async reabrir(id: string, prazoDecisaoEm: number): Promise<Decisao | null> {
      const [l] = await conn<Linha[]>`
        update decisoes set estado = 'reaberta', prazo_decisao_em = ${data(prazoDecisaoEm)}, desfecho = null
        where tenant_id = ${escopo.tenantId} and ${donaOuDecisora()} and id = ${id} and estado = 'vencida'
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraDecisao(l) : null;
    },

    /**
     * Varredor de expiração (ADR-007/017): pendentes com prazo vencido viram 'vencida' com o desfecho
     * que diz se alguém VIU (vista_em) — os dois rótulos da métrica de expiração.
     */
    async vencerPendentes(agora: number): Promise<Decisao[]> {
      const em = iso(agora);
      const linhas = await conn<Linha[]>`
        update decisoes set estado = 'vencida',
          desfecho = case when vista_em is null
            then ${conn.json({ tipo: "expirou_sem_ninguem_ver", em })}
            else ${conn.json({ tipo: "expirou_com_alguem_ciente", em })} end
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and estado in ('pendente', 'reaberta') and prazo_decisao_em <= ${data(agora)}
        returning ${conn.unsafe(COLUNAS)}`;
      return linhas.map(paraDecisao);
    },

    /** Idempotência do varredor (ADR-011): true só na primeira vez de (decisão, tipo_de_evento). */
    async marcarVarrida(id: string, tipoDeEvento: string): Promise<boolean> {
      const linhas = await conn`
        insert into decisao_eventos_varridos (tenant_id, owner_id, decisao_id, tipo_de_evento)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${id}, ${tipoDeEvento})
        on conflict (tenant_id, decisao_id, tipo_de_evento) do nothing returning id`;
      return linhas.length === 1;
    },

    /** Carimbo de "Nada esperando por você · última decisão em …" (ADR-007). */
    async ultimaDecisaoEm(): Promise<string | null> {
      const [l] = await conn<{ em: Date | null }[]>`
        select max(decidida_em) as em from decisoes where tenant_id = ${escopo.tenantId} and decisor_id = ${escopo.pessoaId}`;
      return isoOuNull(l?.em ?? null);
    },
  };
}
