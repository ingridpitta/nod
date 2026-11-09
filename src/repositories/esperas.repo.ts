import type { Espera, EstadoEspera, EsperaParaRodar } from "../contracts/espera.ts";
import { ESPERA_SEM_CONTATO_MS, ESPERA_SEM_INICIO_MS } from "../domain/espera-comando.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { data, ms, msOuNull } from "./conversao.ts";

interface Linha {
  id: string;
  agente_id: string;
  conversa_id: string;
  trabalho_id: string | null;
  turno_id: string;
  maquina_id: string;
  pasta: string | null;
  comando: string;
  motivo: string;
  estado: EstadoEspera;
  codigo_saida: number | null;
  saida: string | null;
  motivo_fim: string | null;
  quedas: number;
  iniciada_em: Date | null;
  visto_em: Date | null;
  acordou_em: Date | null;
  criado_em: Date;
  terminado_em: Date | null;
}

const COLUNAS =
  "id, agente_id, conversa_id, trabalho_id, turno_id, maquina_id, pasta, comando, motivo, estado, codigo_saida, saida, motivo_fim, quedas, iniciada_em, visto_em, acordou_em, criado_em, terminado_em";

const paraEspera = (l: Linha): Espera => ({
  id: l.id,
  agenteId: l.agente_id,
  conversaId: l.conversa_id,
  trabalhoId: l.trabalho_id,
  turnoId: l.turno_id,
  maquinaId: l.maquina_id,
  pasta: l.pasta,
  comando: l.comando,
  motivo: l.motivo,
  estado: l.estado,
  codigoSaida: l.codigo_saida,
  saida: l.saida,
  motivoFim: l.motivo_fim,
  quedas: l.quedas,
  iniciadaEm: msOuNull(l.iniciada_em),
  vistoEm: msOuNull(l.visto_em),
  acordouEm: msOuNull(l.acordou_em),
  criadoEm: ms(l.criado_em),
  terminadoEm: msOuNull(l.terminado_em),
});

export type NovaEspera = { agenteId: string; conversaId: string; trabalhoId: string | null; turnoId: string; maquinaId: string; pasta: string | null; comando: string; motivo: string };
export type FimEspera = { estado: Exclude<EstadoEspera, "rodando">; codigo?: number | null; saida?: string | null; motivoFim?: string | null; agora: number };

/**
 * As esperas de comando (0070, ADR-099 parte 2). Toda escrita é da dona (RLS e `owner_id`); a transição sai de `rodando`
 * uma vez só (`where estado = 'rodando'`), então o relato repetido da máquina, o Parar e o varredor não se atropelam.
 */
/** Quem o Parar cancela: as da conversa (só as do chat com `soDoChat`), as de um trabalho, ou todas. */
export type AlvoCancelarEsperas = { conversaId: string; soDoChat?: true } | { trabalhoId: string } | { todas: true };

export function esperasRepo(conn: Conn, escopo: Escopo) {
  return {
    /** null = o turno já tem uma espera (`esperas_por_turno`): um pedido por turno. */
    async criar(e: NovaEspera): Promise<Espera | null> {
      const [l] = await conn<Linha[]>`
        insert into esperas (tenant_id, owner_id, agente_id, conversa_id, trabalho_id, turno_id, maquina_id, pasta, comando, motivo)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${e.agenteId}, ${e.conversaId}, ${e.trabalhoId}, ${e.turnoId}, ${e.maquinaId}, ${e.pasta}, ${e.comando}, ${e.motivo})
        on conflict (tenant_id, turno_id) do nothing
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraEspera(l) : null;
    },

    async buscar(id: string): Promise<Espera | null> {
      const [l] = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from esperas where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}`;
      return l ? paraEspera(l) : null;
    },

    /** A linha travada: o relato da máquina e o assentamento do turno de origem decidem a volta um de cada vez. */
    async buscarTravado(id: string): Promise<Espera | null> {
      const [l] = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from esperas where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} for update`;
      return l ? paraEspera(l) : null;
    },

    /** A espera que o turno pediu (no máximo uma), travada. */
    async doTurnoTravada(turnoId: string): Promise<Espera | null> {
      const [l] = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from esperas where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and turno_id = ${turnoId} for update`;
      return l ? paraEspera(l) : null;
    },

    /**
     * O que a máquina deve rodar agora: as esperas `rodando` dela. Ler é dar notícia (`visto_em`), e é isso que o varredor
     * confere. `iniciada` diz ao motor que o comando já rodou noutra vida (relançar conta queda).
     */
    async paraAMaquina(maquinaId: string, agora: number): Promise<EsperaParaRodar[]> {
      const linhas = await conn<{ id: string; comando: string; pasta: string | null; iniciada_em: Date | null }[]>`
        update esperas set visto_em = ${data(agora)}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and maquina_id = ${maquinaId} and estado = 'rodando'
        returning id, comando, pasta, iniciada_em`;
      return linhas.map((l) => ({ id: l.id, comando: l.comando, pasta: l.pasta, iniciada: l.iniciada_em !== null }));
    },

    async marcarIniciada(id: string, agora: number): Promise<boolean> {
      const linhas = await conn`
        update esperas set iniciada_em = coalesce(iniciada_em, ${data(agora)}), visto_em = ${data(agora)}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and estado = 'rodando'
        returning id`;
      return linhas.length > 0;
    },

    async gravarQuedas(id: string, quedas: number, agora: number): Promise<boolean> {
      const linhas = await conn`
        update esperas set quedas = ${quedas}, visto_em = ${data(agora)}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and estado = 'rodando'
        returning id`;
      return linhas.length > 0;
    },

    /** Sai de `rodando` (uma vez). null = já tinha saído. */
    async finalizar(id: string, f: FimEspera): Promise<Espera | null> {
      const [l] = await conn<Linha[]>`
        update esperas set estado = ${f.estado}, codigo_saida = ${f.codigo ?? null}, saida = ${f.saida ?? null}, motivo_fim = ${f.motivoFim ?? null}, terminado_em = ${data(f.agora)}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and estado = 'rodando'
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraEspera(l) : null;
    },

    /** A volta nasceu (uma vez): o relato e o assentamento não a criam duas vezes. */
    async marcarAcordou(id: string, agora: number): Promise<boolean> {
      const linhas = await conn`
        update esperas set acordou_em = ${data(agora)}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and acordou_em is null
        returning id`;
      return linhas.length > 0;
    },

    /**
     * O Parar: cancela as que rodam da conversa (todas as do bot dela, tasks inclusive), do trabalho, ou todas da pessoa.
     * A máquina mata o grupo no próximo puxar (a espera some da lista dela). Devolve as canceladas com o turno de cada uma
     * (NOD-257, H4: o Parar avisa quem pediu quando a espera era de uma delegação).
     */
    async cancelarRodando(alvo: AlvoCancelarEsperas, motivoFim: string, agora: number): Promise<{ id: string; turnoId: string }[]> {
      // definido em 2026-10-22 (NOD-311): `soDoChat` = só as do turno do chat (a espera copia o trabalho do turno,
      // esperar-comando.ts); as das frentes seguem rodando.
      const filtro = "conversaId" in alvo
        ? alvo.soDoChat ? conn`and conversa_id = ${alvo.conversaId} and trabalho_id is null` : conn`and conversa_id = ${alvo.conversaId}`
        : "trabalhoId" in alvo ? conn`and trabalho_id = ${alvo.trabalhoId}` : conn``;
      const linhas = await conn<{ id: string; turno_id: string }[]>`
        update esperas set estado = 'cancelada', motivo_fim = ${motivoFim}, terminado_em = ${data(agora)}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and estado = 'rodando' ${filtro}
        returning id, turno_id`;
      return linhas.map((l) => ({ id: l.id, turnoId: l.turno_id }));
    },

    /** As que rodam sem notícia da máquina (esperaSemNoticia), travadas e sem esperar quem já as trava. */
    async semNoticia(agora: number): Promise<Espera[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from esperas
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and estado = 'rodando'
          and ((visto_em is null and criado_em <= ${data(agora - ESPERA_SEM_INICIO_MS)}) or visto_em <= ${data(agora - ESPERA_SEM_CONTATO_MS)})
        order by criado_em
        for update skip locked`;
      return linhas.map(paraEspera);
    },
  };
}
