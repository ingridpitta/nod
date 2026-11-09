import type { ArquivoDoCheckpoint, DesfazerParaRodar, EstadoCheckpoint, FalhaDesfazer, ResultadoGuardado } from "../contracts/checkpoint.ts";
import { juntarForcado, PRAZO_DESFAZENDO_MS, RETEM_CHECKPOINTS, RETEM_MS } from "../domain/checkpoints.ts";
export { checkpointDaFala } from "../domain/checkpoints.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { data, ms, msOuNull } from "./conversao.ts";

interface Linha {
  id: string;
  agente_id: string;
  conversa_id: string;
  turno_id: string;
  maquina_id: string;
  pasta_do_bot: string;
  mensagem_id: string | null;
  arquivos: ArquivoDoCheckpoint[];
  total: number;
  estado: EstadoCheckpoint;
  forcar: string[];
  feitos: number;
  tentativa: number;
  resultado: ResultadoGuardado | null;
  falha: FalhaDesfazer | null;
  pedido_em: Date | null;
  criado_em: Date;
  desfeito_em: Date | null;
}

const COLUNAS = "id, agente_id, conversa_id, turno_id, maquina_id, pasta_do_bot, mensagem_id, arquivos, total, estado, forcar, feitos, tentativa, resultado, falha, pedido_em, criado_em, desfeito_em";

export type Checkpoint = {
  id: string;
  agenteId: string;
  conversaId: string;
  turnoId: string;
  maquinaId: string;
  pastaDoBot: string;
  mensagemId: string | null;
  arquivos: ArquivoDoCheckpoint[];
  total: number;
  estado: EstadoCheckpoint;
  forcar: string[];
  feitos: number;
  tentativa: number;
  resultado: ResultadoGuardado | null;
  falha: FalhaDesfazer | null;
  pedidoEm: number | null;
  criadoEm: number;
  desfeitoEm: number | null;
};

const paraCheckpoint = (l: Linha): Checkpoint => ({
  id: l.id,
  agenteId: l.agente_id,
  conversaId: l.conversa_id,
  turnoId: l.turno_id,
  maquinaId: l.maquina_id,
  pastaDoBot: l.pasta_do_bot,
  mensagemId: l.mensagem_id,
  arquivos: l.arquivos,
  total: l.total,
  estado: l.estado,
  forcar: l.forcar,
  feitos: l.feitos,
  tentativa: l.tentativa,
  resultado: l.resultado,
  falha: l.falha,
  pedidoEm: msOuNull(l.pedido_em),
  criadoEm: ms(l.criado_em),
  desfeitoEm: msOuNull(l.desfeito_em),
});

export type NovoCheckpoint = { agenteId: string; conversaId: string; turnoId: string; maquinaId: string; pastaDoBot: string; mensagemId: string | null; arquivos: ArquivoDoCheckpoint[]; total: number };

/** Por que o pedido de desfazer foi recusado. */
export type RecusaDesfazer = "nao_encontrado" | "vencido" | "outro_desfazendo" | "ja_desfazendo" | "nada_a_forcar";

/**
 * Os checkpoints de arquivos por turno (0120, NOD-54/ADR-134). Toda escrita é da dona (RLS e `owner_id`). O pedido de
 * desfazer passa de `disponivel` (ou `falhou`, o "Tentar de novo"; ou `desfeito` com conflitos, o "Voltar mesmo assim")
 * para `desfazendo`; o relato da máquina sai de `desfazendo` uma vez só, então o relato repetido não atropela.
 */
export function checkpointsRepo(conn: Conn, escopo: Escopo) {
  const dona = () => conn`tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId}`;
  return {
    /**
     * Grava o checkpoint do turno e vence os do bot naquela máquina que a retenção da máquina já apagou (fora dos 20 mais
     * novos ou com mais de 7 dias) — o servidor espelha a regra da máquina para o menu não oferecer o que não existe mais.
     */
    async criar(c: NovoCheckpoint, agora: number): Promise<Checkpoint | null> {
      const [l] = await conn<Linha[]>`
        insert into checkpoints (tenant_id, owner_id, agente_id, conversa_id, turno_id, maquina_id, pasta_do_bot, mensagem_id, arquivos, total)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${c.agenteId}, ${c.conversaId}, ${c.turnoId}, ${c.maquinaId}, ${c.pastaDoBot}, ${c.mensagemId}, ${conn.json(c.arquivos as never)}, ${c.total})
        on conflict (tenant_id, turno_id) do nothing
        returning ${conn.unsafe(COLUNAS)}`;
      if (!l) return null;
      await conn`
        update checkpoints set estado = 'vencido'
        where ${dona()} and agente_id = ${c.agenteId} and maquina_id = ${c.maquinaId} and pasta_do_bot = ${c.pastaDoBot}
          and estado in ('disponivel', 'desfeito', 'falhou')
          and (criado_em < ${data(agora - RETEM_MS)} or id not in (
            select id from checkpoints where ${dona()} and agente_id = ${c.agenteId} and maquina_id = ${c.maquinaId} and pasta_do_bot = ${c.pastaDoBot}
            order by criado_em desc limit ${RETEM_CHECKPOINTS}))`;
      return paraCheckpoint(l);
    },

    async doTurno(turnoId: string): Promise<Checkpoint | null> {
      const [l] = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from checkpoints where ${dona()} and turno_id = ${turnoId}`;
      return l ? paraCheckpoint(l) : null;
    },

    /** O que está desfazendo para o bot (no máximo um): o menu de outra fala mostra "Esperando o desfazer das HH:MM". */
    async desfazendoDoAgente(agenteId: string): Promise<Checkpoint | null> {
      const [l] = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from checkpoints where ${dona()} and agente_id = ${agenteId} and estado = 'desfazendo'`;
      return l ? paraCheckpoint(l) : null;
    },

    /**
     * Pede o desfazer. `forcar` só vale a partir de `desfeito` com conflitos: restaura por cima os caminhos em conflito do
     * resultado anterior. Recusa: venceu, já está desfazendo, ou outro checkpoint do mesmo bot está desfazendo.
     */
    async pedirDesfazer(turnoId: string, forcar: boolean, agora: number): Promise<{ ok: true; checkpoint: Checkpoint } | { ok: false; recusa: RecusaDesfazer }> {
      // O desfazer preso (a máquina sumiu há mais de 15 min) vira `falhou`: não prende o bot nem o próprio turno.
      await conn`
        update checkpoints set estado = 'falhou', falha = 'erro', forcar = '[]'
        where ${dona()} and estado = 'desfazendo' and pedido_em < ${data(agora - PRAZO_DESFAZENDO_MS)}
          and agente_id = (select agente_id from checkpoints where ${dona()} and turno_id = ${turnoId})`;
      const [atual] = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from checkpoints where ${dona()} and turno_id = ${turnoId} for update`;
      if (!atual) return { ok: false, recusa: "nao_encontrado" };
      // Os 7 dias valem também sem um turno novo do bot (a retenção do `criar` só roda quando chega um checkpoint).
      if (atual.estado !== "vencido" && atual.criado_em.getTime() < agora - RETEM_MS) {
        await conn`update checkpoints set estado = 'vencido' where ${dona()} and id = ${atual.id} and estado <> 'desfazendo'`;
        return { ok: false, recusa: "vencido" };
      }
      if (atual.estado === "vencido") return { ok: false, recusa: "vencido" };
      if (atual.estado === "desfazendo") return { ok: false, recusa: "ja_desfazendo" };
      const conflitos = (atual.resultado?.arquivos ?? []).filter((a) => a.desfecho === "conflito").map((a) => a.caminho);
      if (forcar && (atual.estado !== "desfeito" || conflitos.length === 0)) return { ok: false, recusa: "nada_a_forcar" };
      if (!forcar && atual.estado === "desfeito") return { ok: false, recusa: "nada_a_forcar" };
      // Um por bot: a trava do bot serializa dois pedidos de falas diferentes; o índice parcial é a rede (ADR-134).
      await conn`select pg_advisory_xact_lock(hashtextextended(${"checkpoint:" + atual.agente_id}, 0))`;
      const [outro] = await conn<{ id: string }[]>`select id from checkpoints where ${dona()} and agente_id = ${atual.agente_id} and estado = 'desfazendo' limit 1`;
      if (outro) return { ok: false, recusa: "outro_desfazendo" };
      const [l] = await conn<Linha[]>`
        update checkpoints set estado = 'desfazendo', forcar = ${conn.json((forcar ? conflitos : []) as never)}, feitos = 0, falha = null, desfeito_em = null, pedido_em = ${data(agora)}, tentativa = tentativa + 1
        where ${dona()} and id = ${atual.id}
        returning ${conn.unsafe(COLUNAS)}`;
      return { ok: true, checkpoint: paraCheckpoint(l!) };
    },

    /** O que a máquina deve desfazer agora: os `desfazendo` dela que a fala ainda não mostra como falhou (revisão 11, M4). */
    async paraAMaquina(maquinaId: string): Promise<DesfazerParaRodar[]> {
      const linhas = await conn<{ turno_id: string; pasta_do_bot: string; forcar: string[]; tentativa: number }[]>`
        select turno_id, pasta_do_bot, forcar, tentativa from checkpoints where ${dona()} and maquina_id = ${maquinaId} and estado = 'desfazendo'
          and pedido_em >= now() - make_interval(secs => ${PRAZO_DESFAZENDO_MS / 1000}) order by pedido_em`;
      return linhas.map((l) => ({ turnoId: l.turno_id, pastaDoBot: l.pasta_do_bot, forcar: l.forcar, tentativa: l.tentativa }));
    },

    /**
     * Progresso: só enquanto desfaz a mesma tentativa. null = relato atrasado (outra tentativa, ou já não desfaz). Todo
     * relato é sinal de vida: `pedido_em` anda, e o prazo de 15 min conta do último (revisão 3, M2: o desfazer que espera
     * um turno longo da máquina não vira `falhou`). `feitos` null é só o sinal (o desfazer ainda não começou).
     */
    async progresso(turnoId: string, maquinaId: string, tentativa: number, feitos: number | null, agora: number): Promise<Checkpoint | null> {
      const [l] = await conn<Linha[]>`
        update checkpoints set feitos = ${feitos === null ? conn`feitos` : feitos}, pedido_em = ${data(agora)}
        where ${dona()} and turno_id = ${turnoId} and maquina_id = ${maquinaId} and estado = 'desfazendo' and tentativa = ${tentativa}
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraCheckpoint(l) : null;
    },

    /**
     * O fim (uma vez por tentativa): com resultado vira `desfeito`; sem a foto na máquina vira `vencido`; erro vira `falhou`. O "Voltar
     * mesmo assim" passa na máquina só nos conflitos (revisão 11, M2): o resultado dele entra no anterior.
     */
    async finalizar(turnoId: string, maquinaId: string, tentativa: number, f: { resultado: ResultadoGuardado } | { falha: FalhaDesfazer }, agora: number): Promise<Checkpoint | null> {
      if ("resultado" in f) {
        const [atual] = await conn<{ forcar: string[]; resultado: ResultadoGuardado | null }[]>`
          select forcar, resultado from checkpoints
          where ${dona()} and turno_id = ${turnoId} and maquina_id = ${maquinaId} and estado = 'desfazendo' and tentativa = ${tentativa} for update`;
        if (atual && atual.forcar.length > 0 && atual.resultado) f = { resultado: juntarForcado(atual.resultado, f.resultado) };
      }
      const estado: EstadoCheckpoint = "resultado" in f ? "desfeito" : f.falha === "sem_checkpoint" ? "vencido" : "falhou";
      const [l] = await conn<Linha[]>`
        update checkpoints set estado = ${estado}, resultado = ${"resultado" in f ? conn.json(f.resultado as never) : conn`resultado`},
          falha = ${"falha" in f ? f.falha : null}, desfeito_em = ${estado === "desfeito" ? data(agora) : null}, forcar = '[]'
        where ${dona()} and turno_id = ${turnoId} and maquina_id = ${maquinaId} and estado = 'desfazendo' and tentativa = ${tentativa}
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraCheckpoint(l) : null;
    },
  };
}
