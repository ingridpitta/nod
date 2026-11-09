import type { Visibilidade } from "../contracts/agente.ts";
import type { CapacidadeConector, ConectorGuardado, SensibilidadeDeclarada, TransporteConector } from "../contracts/conector.ts";
import type { MotivoNegacao } from "../contracts/motivos.ts";
import type { EstadoDisjuntor } from "../domain/disjuntor-conector.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { data, ms, msOuNull } from "./conversao.ts";

interface Linha {
  tenant_id: string;
  id: string;
  owner_id: string;
  visibility: Visibilidade;
  nome: string;
  slug: string;
  transporte: TransporteConector;
  comando: string | null;
  args: string[];
  url: string | null;
  env_cifrado: string | null;
  env_chaves: string[];
  declaracao: SensibilidadeDeclarada;
  habilitado: boolean;
  catalogo: CapacidadeConector[];
  sondado_em: Date | null;
  ultima_falha: { motivo: MotivoNegacao; em: number; causa?: "acesso_recusado" } | null;
  criado_em: Date;
  falhas_seguidas: number;
  timeouts_seguidos: number;
  ultimo_timeout_em: Date | null;
  proxima_sonda_em: Date | null;
  fora_do_ar_desde: Date | null;
}

const COLUNAS =
  "tenant_id, id, owner_id, visibility, nome, slug, transporte, comando, args, url, env_cifrado, env_chaves, declaracao, habilitado, catalogo, sondado_em, ultima_falha, criado_em, falhas_seguidas, timeouts_seguidos, ultimo_timeout_em, proxima_sonda_em, fora_do_ar_desde";

/** definido em 2026-10-26 (NOD-374): zera o disjuntor junto com `ultima_falha` (sonda ok, reconectar, sucesso de chamada). */
const DISJUNTOR_LIMPO = "falhas_seguidas = 0, timeouts_seguidos = 0, ultimo_timeout_em = null, proxima_sonda_em = null, fora_do_ar_desde = null";

/** Uma linha do laço de fundo: o conector com falha aberta, só o que o laço precisa. */
export type ConectorComFalha = { id: string; slug: string; nome: string; estado: EstadoDisjuntor };

/**
 * O env do conector fica CIFRADO no servidor (core-features §credencial): o repositório devolve
 * `ConectorGuardado` (src/contracts/conector.ts) — `env` só com as CHAVES e o placeholder `true`
 * (write-only), mais `envCifrado` para o servidor decifrar com src/db/cifra.ts na hora de spawnar.
 * Nada legível sai daqui. Reexportado para quem importava o nome deste módulo.
 */
export type { ConectorGuardado } from "../contracts/conector.ts";

function paraConector(l: Linha): ConectorGuardado {
  const env: Record<string, true> = {};
  for (const k of l.env_chaves) env[k] = true;
  return {
    tenantId: l.tenant_id,
    id: l.id,
    ownerId: l.owner_id,
    visibility: l.visibility,
    nome: l.nome,
    slug: l.slug,
    transporte: l.transporte,
    comando: l.comando,
    args: l.args,
    url: l.url,
    env,
    declaracao: l.declaracao,
    habilitado: l.habilitado,
    catalogo: l.catalogo,
    sondadoEm: msOuNull(l.sondado_em),
    ultimaFalha: l.ultima_falha,
    criadoEm: ms(l.criado_em),
    falhasSeguidas: l.falhas_seguidas,
    timeoutsSeguidos: l.timeouts_seguidos,
    ultimoTimeoutEm: msOuNull(l.ultimo_timeout_em),
    proximaSondaEm: msOuNull(l.proxima_sonda_em),
    foraDoArDesde: msOuNull(l.fora_do_ar_desde),
    envCifrado: l.env_cifrado,
  };
}

function falhaDaLinha(f: Linha["ultima_falha"]): EstadoDisjuntor["ultimaFalha"] {
  if (!f) return null;
  return f.causa ? { motivo: f.motivo, em: Number(f.em), causa: f.causa } : { motivo: f.motivo, em: Number(f.em) };
}

function estadoDaLinha(l: Pick<Linha, "ultima_falha" | "falhas_seguidas" | "timeouts_seguidos" | "ultimo_timeout_em" | "proxima_sonda_em" | "fora_do_ar_desde">): EstadoDisjuntor {
  return {
    ultimaFalha: falhaDaLinha(l.ultima_falha),
    falhasSeguidas: l.falhas_seguidas,
    timeoutsSeguidos: l.timeouts_seguidos,
    ultimoTimeoutEm: msOuNull(l.ultimo_timeout_em),
    proximaSondaEm: msOuNull(l.proxima_sonda_em),
    foraDoArDesde: msOuNull(l.fora_do_ar_desde),
  };
}

export type NovoConector = {
  id?: string;
  nome: string;
  slug: string;
  transporte: TransporteConector;
  comando?: string | null;
  args?: string[];
  url?: string | null;
  envCifrado?: string | null;
  envChaves?: string[];
  declaracao: SensibilidadeDeclarada;
  visibility?: Visibilidade;
};

/** Conector = servidor MCP registrado pela pessoa; nasce desabilitado (ADR-013). CHECKs vivem no banco. */
export function conectoresRepo(conn: Conn, escopo: Escopo) {
  return {
    async criar(c: NovoConector): Promise<ConectorGuardado | null> {
      const [l] = await conn<Linha[]>`
        insert into conectores (tenant_id, id, owner_id, visibility, nome, slug, transporte, comando, args, url, env_cifrado, env_chaves, declaracao)
        values (${escopo.tenantId}, ${c.id ?? conn`gen_random_uuid()`}, ${escopo.pessoaId}, ${c.visibility ?? "privado"}, ${c.nome}, ${c.slug}, ${c.transporte},
          ${c.comando ?? null}, ${c.args ?? []}::text[], ${c.url ?? null}, ${c.envCifrado ?? null}, ${c.envChaves ?? []}::text[], ${c.declaracao})
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraConector(l) : null;
    },

    async atualizarEndpoint(id: string, url: string, envCifrado: string, envChaves: string[]): Promise<ConectorGuardado | null> {
      const [l] = await conn<Linha[]>`update conectores set url = ${url}, transporte = 'http', comando = null, args = '{}', declaracao = 'toca', env_cifrado = ${envCifrado}, env_chaves = ${envChaves}::text[], habilitado = false, catalogo = '[]', sondado_em = null, ultima_falha = null, ${conn.unsafe(DISJUNTOR_LIMPO)}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraConector(l) : null;
    },

    /**
     * definido em 2026-09-24 (ADR-048): o GitHub vira UM conector nativo (stdio, `comando` = marca
     * `nod:github`). Quem já tinha o `github` do Composio por HTTP é convertido no lugar — mesmo id,
     * para a linha de composio_sessoes continuar apontando para ele. Nasce desabilitado: a sonda habilita.
     */
    async tornarNativo(id: string, p: { comando: string; envCifrado: string | null; envChaves: string[] }): Promise<ConectorGuardado | null> {
      const [l] = await conn<Linha[]>`update conectores set transporte = 'stdio', comando = ${p.comando}, args = '{}', url = null, env_cifrado = ${p.envCifrado}, env_chaves = ${p.envChaves}::text[], habilitado = false, catalogo = '[]', sondado_em = null, ultima_falha = null, ${conn.unsafe(DISJUNTOR_LIMPO)}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraConector(l) : null;
    },

    async buscar(id: string): Promise<ConectorGuardado | null> {
      const [l] = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from conectores where tenant_id = ${escopo.tenantId} and id = ${id}`;
      return l ? paraConector(l) : null;
    },

    async buscarPorSlug(slug: string): Promise<ConectorGuardado | null> {
      const [l] = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from conectores where tenant_id = ${escopo.tenantId} and slug = ${slug} order by (owner_id = ${escopo.pessoaId}) desc, criado_em limit 1`;
      return l ? paraConector(l) : null;
    },

    async listar(): Promise<ConectorGuardado[]> {
      const linhas = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from conectores where tenant_id = ${escopo.tenantId} order by criado_em`;
      return linhas.map(paraConector);
    },

    async listarHabilitados(): Promise<ConectorGuardado[]> {
      const linhas = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from conectores where tenant_id = ${escopo.tenantId} and habilitado = true order by criado_em`;
      return linhas.map(paraConector);
    },

    /** Resultado da sonda (ADR-013): catálogo com readOnlyHint capturado na DESCOBERTA; falha guarda motivo + instante. */
    async registrarSonda(
      id: string,
      r: { ok: true; catalogo: CapacidadeConector[]; agora: number } | { ok: false; motivo: MotivoNegacao; agora: number; causa?: "acesso_recusado" },
    ): Promise<ConectorGuardado | null> {
      const [l] = r.ok
        ? await conn<Linha[]>`
            update conectores set catalogo = ${conn.json(r.catalogo)}, habilitado = true, sondado_em = ${data(r.agora)}, ultima_falha = null, ${conn.unsafe(DISJUNTOR_LIMPO)}
            where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} returning ${conn.unsafe(COLUNAS)}`
        : await conn<Linha[]>`
            update conectores set sondado_em = ${data(r.agora)},
              -- NOD-374 (revisão do PR #538): a falha que já estava aberta guarda o instante do começo ("desde HH:MM").
              ultima_falha = ${conn.json({ motivo: r.motivo, em: r.agora, ...(r.causa ? { causa: r.causa } : {}) })} || case when ultima_falha is null then '{}'::jsonb else jsonb_build_object('em', ultima_falha->'em') end,
              fora_do_ar_desde = coalesce(fora_do_ar_desde, ${data(r.agora)})
            where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraConector(l) : null;
    },

    async habilitar(id: string, habilitado: boolean): Promise<ConectorGuardado | null> {
      const [l] = await conn<Linha[]>`update conectores set habilitado = ${habilitado} where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraConector(l) : null;
    },

    /** Troca do env: quem chama já mesclou placeholders `true` com os valores guardados e cifrou o resultado. */
    async atualizarEnv(id: string, p: { envCifrado: string | null; envChaves: string[] }): Promise<boolean> {
      const r = await conn`
        update conectores set env_cifrado = ${p.envCifrado}, env_chaves = ${p.envChaves}::text[] where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}`;
      return r.count === 1;
    },

    /**
     * definido em 2026-10-28 (NOD-50): a troca condicional (compare-and-set) do env. Só grava se o env cifrado ainda for
     * `esperado` (o cifrado leva IV aleatório, então dois gravadores nunca escrevem o mesmo texto). false = outro gravou antes.
     */
    async atualizarEnvSe(id: string, esperado: string | null, p: { envCifrado: string | null; envChaves: string[] }): Promise<boolean> {
      const r = await conn`
        update conectores set env_cifrado = ${p.envCifrado}, env_chaves = ${p.envChaves}::text[]
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and env_cifrado is not distinct from ${esperado}`;
      return r.count === 1;
    },

    /**
     * definido em 2026-10-26 (NOD-374): o estado do disjuntor com a linha TRAVADA (FOR UPDATE) até o fim da transação, para
     * duas chamadas ou a sonda e o laço não perderem contagem. null = conector apagado ou de outra pessoa (só a dona escreve).
     */
    async estadoFalhaTravado(id: string): Promise<EstadoDisjuntor | null> {
      const [l] = await conn<Linha[]>`
        select ultima_falha, falhas_seguidas, timeouts_seguidos, ultimo_timeout_em, proxima_sonda_em, fora_do_ar_desde from conectores
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} for update`;
      return l ? estadoDaLinha(l) : null;
    },

    async gravarEstadoFalha(id: string, e: EstadoDisjuntor): Promise<boolean> {
      const falha = e.ultimaFalha ? conn.json(e.ultimaFalha) : null;
      const r = await conn`
        update conectores set ultima_falha = ${falha}, falhas_seguidas = ${e.falhasSeguidas}, timeouts_seguidos = ${e.timeoutsSeguidos},
          ultimo_timeout_em = ${e.ultimoTimeoutEm == null ? null : data(e.ultimoTimeoutEm)}, proxima_sonda_em = ${e.proximaSondaEm === null ? null : data(e.proximaSondaEm)}, fora_do_ar_desde = ${e.foraDoArDesde === null ? null : data(e.foraDoArDesde)}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}`;
      return r.count === 1;
    },

    /**
     * Uma chamada deu certo: zera a falha e o disjuntor. O UPDATE é condicional — app já limpo não muda linha nenhuma.
     * Devolve a falha que estava aberta (null = só havia contagem de timeouts; false = nada a limpar, nenhuma escrita).
     */
    async limparFalha(id: string): Promise<EstadoDisjuntor["ultimaFalha"] | false> {
      const [l] = await conn<{ antes: Linha["ultima_falha"] }[]>`
        update conectores c set ultima_falha = null, ${conn.unsafe(DISJUNTOR_LIMPO)}
        from (select id, ultima_falha as antes from conectores where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} for update) a
        where c.tenant_id = ${escopo.tenantId} and c.id = a.id
          and (c.ultima_falha is not null or c.timeouts_seguidos > 0 or c.falhas_seguidas > 0 or c.fora_do_ar_desde is not null)
        returning a.antes`;
      return l ? falhaDaLinha(l.antes) : false;
    },

    /**
     * Os conectores da pessoa com falha aberta que o laço pode sondar ou promover (índice parcial conectores_com_falha). Fora
     * do laço: o acesso recusado (espera reconectar) e o conector desabilitado (a 1ª sonda falhou: a sonda ok do laço não
     * grava o catálogo, então só o "Tentar de novo" o habilita — revisão 3 do PR #538).
     */
    async comFalhaAberta(): Promise<ConectorComFalha[]> {
      const linhas = await conn<(Linha & { id: string })[]>`
        select id, slug, nome, ultima_falha, falhas_seguidas, timeouts_seguidos, ultimo_timeout_em, proxima_sonda_em, fora_do_ar_desde from conectores
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and ultima_falha is not null and habilitado
          and coalesce(ultima_falha->>'causa', '') <> 'acesso_recusado' order by id`;
      return linhas.map((l) => ({ id: l.id, slug: l.slug, nome: l.nome, estado: estadoDaLinha(l) }));
    },
  };
}

