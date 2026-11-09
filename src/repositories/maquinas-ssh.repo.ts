import type { Conn, Escopo } from "../shared/types.ts";
import { data, ms } from "./conversao.ts";

/** NOD-94 (0105): o que o nod guarda de uma instalação por SSH. A credencial nunca chega aqui. */
export interface MaquinaSsh {
  id: string;
  maquinaId: string;
  host: string;
  porta: number;
  usuario: string;
  impressaoHost: string;
  criadoEm: number;
  atualizadoEm: number;
}

interface Linha {
  id: string;
  maquina_id: string;
  host: string;
  porta: number;
  usuario: string;
  impressao_host: string;
  criado_em: Date;
  atualizado_em: Date;
}

const paraDto = (l: Linha): MaquinaSsh => ({
  id: l.id,
  maquinaId: l.maquina_id,
  host: l.host,
  porta: l.porta,
  usuario: l.usuario,
  impressaoHost: l.impressao_host,
  criadoEm: ms(l.criado_em),
  atualizadoEm: ms(l.atualizado_em),
});

/**
 * NOD-94 (emenda 11 da ADR-090): endereço e impressão da host key de cada máquina instalada por SSH, para a reinstalação
 * travar com `StrictHostKeyChecking=yes`. Uma linha por (pessoa, host sem caixa, porta). Sob RLS a pessoa só vê as
 * próprias, e o WHERE repete isso (segunda camada, ADR-003).
 */
export function maquinasSshRepo(conn: Conn, escopo: Escopo) {
  return {
    /** Grava ou atualiza (mesmo host e porta) depois de parear. Reinstalar no mesmo endereço troca a máquina e o usuário. */
    async registrar(e: { maquinaId: string; host: string; porta: number; usuario: string; impressaoHost: string }, agora: number): Promise<MaquinaSsh | null> {
      const [l] = await conn<Linha[]>`
        insert into maquinas_ssh (tenant_id, owner_id, maquina_id, host, porta, usuario, impressao_host, criado_em, atualizado_em)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${e.maquinaId}, ${e.host}, ${e.porta}, ${e.usuario}, ${e.impressaoHost}, ${data(agora)}, ${data(agora)})
        on conflict (tenant_id, owner_id, lower(host), porta) do update
          set maquina_id = excluded.maquina_id, usuario = excluded.usuario, impressao_host = excluded.impressao_host, atualizado_em = excluded.atualizado_em
        returning id, maquina_id, host, porta, usuario, impressao_host, criado_em, atualizado_em`;
      return l ? paraDto(l) : null;
    },

    /** A impressão guardada para o endereço; null = primeira vez (confia no primeiro uso). */
    async doEndereco(host: string, porta: number): Promise<MaquinaSsh | null> {
      const [l] = await conn<Linha[]>`
        select id, maquina_id, host, porta, usuario, impressao_host, criado_em, atualizado_em from maquinas_ssh
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and lower(host) = lower(${host}) and porta = ${porta}`;
      return l ? paraDto(l) : null;
    },

    /** "Confiar na nova": troca a impressão guardada. false = não havia linha para o endereço. */
    async trocarImpressao(host: string, porta: number, impressaoHost: string, agora: number): Promise<boolean> {
      const r = await conn`
        update maquinas_ssh set impressao_host = ${impressaoHost}, atualizado_em = ${data(agora)}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and lower(host) = lower(${host}) and porta = ${porta}
        returning id`;
      return r.length > 0;
    },

    async daMaquina(maquinaId: string): Promise<MaquinaSsh | null> {
      const [l] = await conn<Linha[]>`
        select id, maquina_id, host, porta, usuario, impressao_host, criado_em, atualizado_em from maquinas_ssh
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and maquina_id = ${maquinaId}
        order by atualizado_em desc limit 1`;
      return l ? paraDto(l) : null;
    },
  };
}
