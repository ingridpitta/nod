import type { DestinoItem, ItemAprovacao } from "../contracts/item-aprovacao.ts";
import type { DesfechoItem, MotivoAprovacaoManual } from "../contracts/motivos.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { data, isoOuNull, jsonb } from "./conversao.ts";

interface Linha {
  tenant_id: string;
  id: string;
  decisao_id: string;
  idx: number;
  texto_original: string;
  texto_final: string;
  destino: DestinoItem;
  selecionado: boolean;
  origem_sensivel: boolean;
  justificativa: string | null;
  marcado_por: string | null;
  marcado_em: Date | null;
  editado_por: string | null;
  desfecho: DesfechoItem | null;
  motivo_manual: MotivoAprovacaoManual | null;
  sempre_serve: boolean | null;
}

const COLUNAS = "tenant_id, id, decisao_id, idx, texto_original, texto_final, destino, selecionado, origem_sensivel, justificativa, marcado_por, marcado_em, editado_por, desfecho, motivo_manual, sempre_serve";

const paraItem = (l: Linha): ItemAprovacao => ({
  tenantId: l.tenant_id,
  id: l.id,
  decisaoId: l.decisao_id,
  idx: l.idx,
  textoOriginal: l.texto_original,
  textoFinal: l.texto_final,
  destino: l.destino,
  selecionado: l.selecionado,
  origemSensivel: l.origem_sensivel,
  justificativa: l.justificativa,
  marcadoPor: l.marcado_por,
  marcadoEm: isoOuNull(l.marcado_em),
  editadoPor: l.editado_por,
  desfecho: l.desfecho,
  motivoManual: l.motivo_manual,
  // 0094: só o item que veio do revisor carrega a marca (nulo = a regra de sempre do botão).
  ...(l.sempre_serve !== null && l.sempre_serve !== undefined ? { sempreServe: l.sempre_serve } : {}),
});

/** Item aprovado que espera a máquina da dona (ADR-048): com quando a decisão fechou e se foi por regra. */
export type ItemNaMaquina = { item: ItemAprovacao; decididaEm: number; porRegra: boolean };

export type NovoItemAprovacao = {
  id?: string;
  idx: number;
  texto: string;
  destino: DestinoItem;
  /** Origem sensível NASCE desmarcada com justificativa (E4.2); marcar exige pessoa (CHECK). */
  origemSensivel: boolean;
  justificativa?: string | null;
  /** NULO = resolvido por regra, sem perguntar (ADR-042). Preenchido = por que precisou de pessoa. */
  motivoManual?: MotivoAprovacaoManual | null;
  /** Item resolvido por regra nasce com desfecho; o resto nasce sem. */
  desfecho?: DesfechoItem | null;
  /** 0094 (PR 5 dos modos de aprovação): o item do revisor diz se "Sempre permitir" serve nele (`sempreServe`). */
  sempreServe?: boolean | null;
};

/** Aprovação em lista tipada (E4.1/E4.2). O CHECK item_sensivel_marcado_exige_pessoa vive no banco. */
export function itensAprovacaoRepo(conn: Conn, escopo: Escopo) {
  return {
    async criarLote(decisaoId: string, itens: readonly NovoItemAprovacao[]): Promise<ItemAprovacao[]> {
      const criados: ItemAprovacao[] = [];
      for (const i of itens) {
        const [l] = await conn<Linha[]>`
          insert into itens_aprovacao (tenant_id, id, owner_id, decisao_id, idx, texto_original, texto_final, destino, selecionado, origem_sensivel, justificativa, motivo_manual, desfecho, sempre_serve)
          values (${escopo.tenantId}, ${i.id ?? conn`gen_random_uuid()`}, ${escopo.pessoaId}, ${decisaoId}, ${i.idx}, ${i.texto}, ${i.texto},
            ${jsonb(conn, i.destino)}, ${!i.origemSensivel}, ${i.origemSensivel}, ${i.justificativa ?? null}, ${i.motivoManual ?? null}, ${i.desfecho ?? null}, ${i.sempreServe ?? null})
          returning ${conn.unsafe(COLUNAS)}`;
        if (l) criados.push(paraItem(l));
      }
      return criados;
    },

    async listar(decisaoId: string): Promise<ItemAprovacao[]> {
      const linhas = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from itens_aprovacao where tenant_id = ${escopo.tenantId} and decisao_id = ${decisaoId} order by idx`;
      return linhas.map(paraItem);
    },

    /**
     * ADR-055: esta ação do terminal já foi aprovada nesta tarefa? Item 'terminal' aprovado (desfecho executado) com o
     * MESMO texto, numa decisão de um turno da cadeia — este e os que ele retoma. É o que deixa a retomada refazer o
     * comando que a pessoa aprovou depois de a espera no turno acabar, sem um segundo card.
     * revisto em 2026-10-18 (plano dos modos de aprovação, revisão de engenharia 4): compara `texto_original`, não
     * `destino.argumentos.comando` — o item de gravar arquivo guarda `{ arquivo }` com o texto `Gravar …`, e a gravação
     * aprovada nunca era achada na segunda consulta do hook (outro card, e o hook respondia "não liberou"). Vale para
     * comando, arquivo e MCP. ADR-115: `revisor` = liberada pelo revisor (`regra:revisor`), que vale só no MESMO turno e
     * enquanto ele não ficou contaminado depois dela; `pessoa` = o clique, que vale na cadeia como sempre.
     * Revisão do PR 3a: `arquivo` separa a gravação aprovada do comando de mesmo texto (o "comando" `Gravar ~/.bashrc`
     * aprovado não libera o Write). O "depois dela" segue no `decidida_em`: os dois lados estão no relógio do servidor
     * (`contaminado_em` e `decidida_em` vêm de `deps.agora()`; `criado_em` é o relógio do banco).
     */
    async aprovadoNaCadeia(turnoId: string, texto: string, arquivo: boolean): Promise<"pessoa" | "revisor" | null> {
      const [l] = await conn<{ por: "pessoa" | "revisor" | null }[]>`
        with recursive cadeia(id, retoma_turno_id, saltos) as (
          select id, retoma_turno_id, 0 from turnos where tenant_id = ${escopo.tenantId} and id = ${turnoId}
          union all
          select t.id, t.retoma_turno_id, c.saltos + 1 from turnos t join cadeia c on t.tenant_id = ${escopo.tenantId} and t.id = c.retoma_turno_id
          where c.saltos < 50
        )
        select case when d.desfecho->>'regra' = 'regra:revisor' then 'revisor' else 'pessoa' end as por
        from itens_aprovacao i join decisoes d on d.tenant_id = i.tenant_id and d.id = i.decisao_id
          join turnos t on t.tenant_id = d.tenant_id and t.id = d.turno_id
        where i.tenant_id = ${escopo.tenantId} and d.turno_id in (select id from cadeia)
          and i.destino->>'conector' = 'terminal' and i.texto_original = ${texto} and (i.destino->'argumentos' ? 'arquivo') = ${arquivo}
          and i.selecionado and i.desfecho = 'executado'
          and (coalesce(d.desfecho->>'regra', '') <> 'regra:revisor'
            or (d.turno_id = ${turnoId} and (t.contaminado_em is null or t.contaminado_em <= d.decidida_em)))
        order by (d.desfecho->>'regra' = 'regra:revisor') nulls first
        limit 1`;
      return l?.por ?? null;
    },

    /**
     * ADR-115 (revisão de engenharia 3): a MESMA ação já levou "pede" do revisor, foi negada pela pessoa ou venceu na
     * cadeia do turno — então vai direto ao cartão, sem outro sorteio no revisor. No terminal, a mesma ação é o mesmo
     * texto; no app (PR 5 dos modos de aprovação, 2026-10-19), o mesmo destino: conector, ferramenta e argumentos iguais
     * (jsonb compara pelo valor, não pela ordem das chaves).
     */
    async recusadoNaCadeia(turnoId: string, acao: string | Pick<DestinoItem, "conector" | "ferramenta" | "argumentos">): Promise<boolean> {
      const mesma = typeof acao === "string"
        ? conn`i.destino->>'conector' = 'terminal' and i.texto_original = ${acao}`
        : conn`i.destino->>'conector' = ${acao.conector} and i.destino->>'ferramenta' = ${acao.ferramenta} and i.destino->'argumentos' = ${jsonb(conn, acao.argumentos)}`;
      const [l] = await conn<{ sim: boolean }[]>`
        with recursive cadeia(id, retoma_turno_id, saltos) as (
          select id, retoma_turno_id, 0 from turnos where tenant_id = ${escopo.tenantId} and id = ${turnoId}
          union all
          select t.id, t.retoma_turno_id, c.saltos + 1 from turnos t join cadeia c on t.tenant_id = ${escopo.tenantId} and t.id = c.retoma_turno_id
          where c.saltos < 50
        )
        select exists (
          select 1 from itens_aprovacao i join decisoes d on d.tenant_id = i.tenant_id and d.id = i.decisao_id
          where i.tenant_id = ${escopo.tenantId} and d.turno_id in (select id from cadeia)
            and ${mesma}
            and (i.motivo_manual = 'revisor_pediu' or d.estado = 'vencida'
              or (d.estado = 'decidida' and (not i.selecionado or i.desfecho in ('retirado_pela_pessoa', 'sensivel_nao_aprovado'))))
        ) as sim`;
      return l?.sim === true;
    },

    /**
     * ADR-115 (fase 3 da revisão), pela dona: `liberado` — o item roda sem pessoa (motivo nulo = resolvido por regra). No
     * terminal o desfecho já nasce `executado` (é o que o hook lê); no app (`executar`, PR 5) o desfecho fica nulo até o
     * efeito rodar fora da transação e o assentamento gravá-lo (`assentarLoteAutomatico`), como no lote automático. Senão o
     * motivo do cartão e a frase (o motivo do revisor ou a da falha); `sempreServe` falso no cartão de falha (0094).
     * revisto em 2026-10-26 (PR 4): o liberado limpa a `justificativa` — a fase 1 grava a frase de queda ("O revisor não
     * respondeu a tempo") para o caso de a fase 3 nunca vir, e ela ficava num item que o revisor liberou. O motivo da
     * liberação mora em `acoes_pelo_modo.motivo`.
     */
    async marcarRevisao(id: string, p: { liberado: true; executar?: true } | { motivoManual: Extract<MotivoAprovacaoManual, "revisor_pediu" | "revisor_falhou">; justificativa: string }): Promise<ItemAprovacao | null> {
      const [l] = "liberado" in p
        ? await conn<Linha[]>`
          update itens_aprovacao set motivo_manual = null, justificativa = null, desfecho = ${p.executar ? null : "executado"}
          where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and desfecho is null
          returning ${conn.unsafe(COLUNAS)}`
        : await conn<Linha[]>`
          update itens_aprovacao set motivo_manual = ${p.motivoManual}, justificativa = ${p.justificativa},
            sempre_serve = ${p.motivoManual === "revisor_pediu" ? conn`sempre_serve` : conn`case when sempre_serve is null then null else false end`}
          where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}
          returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraItem(l) : null;
    },

    async buscar(id: string): Promise<ItemAprovacao | null> {
      const [l] = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from itens_aprovacao where tenant_id = ${escopo.tenantId} and id = ${id}`;
      return l ? paraItem(l) : null;
    },

    /**
     * A pessoa marca/desmarca e pode editar o texto final; marcado_por é a pessoa da sessão. Dona OU
     * decisora designada (policy nod_decisora da 0003 em itens_aprovacao); o filtro explícito devolve
     * null para quem só lê a linha por 'equipe', em vez de deixar o 42501 subir.
     */
    async marcar(id: string, p: { selecionado: boolean; textoFinal?: string; agora: number }): Promise<ItemAprovacao | null> {
      const [l] = await conn<Linha[]>`
        update itens_aprovacao set
          selecionado = ${p.selecionado},
          marcado_por = ${escopo.pessoaId},
          marcado_em = ${data(p.agora)},
          texto_final = coalesce(${p.textoFinal ?? null}, texto_final),
          editado_por = case when ${p.textoFinal ?? null}::text is null then editado_por else ${escopo.pessoaId}::uuid end
        where tenant_id = ${escopo.tenantId} and id = ${id}
          and (owner_id = ${escopo.pessoaId} or exists (
            select 1 from decisoes d where d.tenant_id = itens_aprovacao.tenant_id and d.id = itens_aprovacao.decisao_id and d.decisor_id = ${escopo.pessoaId}))
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraItem(l) : null;
    },

    /**
     * definido em 2026-09-24 (ADR-048): os itens APROVADOS desta pessoa que rodam no gh do Mac dela e
     * ainda não têm desfecho. A execução é derivada, sem coluna nova: decisão decidida + item marcado
     * + `destino.execucao = 'maquina'` + desfecho nulo.
     */
    async pendentesNaMaquina(): Promise<ItemNaMaquina[]> {
      const linhas = await conn<(Linha & { decidida_em: Date | null; tipo_desfecho: string | null })[]>`
        select ${conn.unsafe(COLUNAS.split(", ").map((c) => `i.${c}`).join(", "))}, d.decidida_em, d.desfecho->>'tipo' as tipo_desfecho
        from itens_aprovacao i join decisoes d on d.tenant_id = i.tenant_id and d.id = i.decisao_id
        where i.tenant_id = ${escopo.tenantId} and i.owner_id = ${escopo.pessoaId} and d.estado = 'decidida'
          and i.selecionado and i.desfecho is null and i.destino->>'execucao' = 'maquina'
        order by d.decidida_em, i.idx`;
      return linhas.map((l) => ({ item: paraItem(l), decididaEm: l.decidida_em ? l.decidida_em.getTime() : 0, porRegra: l.tipo_desfecho === "decidida_por_regra" }));
    },

    /** Grava o desfecho só se ainda não havia um: o relato repetido da máquina não sobrescreve. */
    async registrarDesfechoSeAberto(id: string, desfecho: DesfechoItem): Promise<ItemAprovacao | null> {
      const [l] = await conn<Linha[]>`
        update itens_aprovacao set desfecho = ${desfecho} where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and desfecho is null returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraItem(l) : null;
    },

    /**
     * NOD-282 (G6): os itens que SAÍRAM (desfecho executado) em decisões criadas depois desta, na mesma conversa e na mesma
     * faixa — o trabalho do turno de cada decisão, nulo = a conversa (o padrão de fechar-gemeas.ts). A comparação da ação
     * (mesmaAcao) é do domínio; aqui só o recorte.
     */
    async executadosDepois(decisaoId: string): Promise<ItemAprovacao[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS.split(", ").map((c) => `i.${c}`).join(", "))}
        from decisoes base
        left join turnos tb on tb.tenant_id = base.tenant_id and tb.id = base.turno_id
        join decisoes d on d.tenant_id = base.tenant_id and d.conversa_id = base.conversa_id and d.id <> base.id and d.criado_em > base.criado_em
        left join turnos td on td.tenant_id = d.tenant_id and td.id = d.turno_id
        join itens_aprovacao i on i.tenant_id = d.tenant_id and i.decisao_id = d.id
        where base.tenant_id = ${escopo.tenantId} and base.id = ${decisaoId} and i.desfecho = 'executado'
          and td.trabalho_id is not distinct from tb.trabalho_id
        order by d.criado_em, i.idx
        limit 200`;
      return linhas.map(paraItem);
    },

    async registrarDesfecho(id: string, desfecho: DesfechoItem): Promise<ItemAprovacao | null> {
      const [l] = await conn<Linha[]>`
        update itens_aprovacao set desfecho = ${desfecho} where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraItem(l) : null;
    },
  };
}
