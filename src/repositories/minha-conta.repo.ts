import type { Conn, Escopo, Tx } from "../shared/types.ts";
import { ms } from "./conversao.ts";

/**
 * NOD-346 (ADR-126, 0110): as consultas da Minha conta. As de conta (sessões, identidades, e-mail, exclusão) são globais,
 * como as da contas.repo.ts; as de exportação são escopadas (RLS), e quem chama abre a transação com o escopo vinculado.
 */

// ------------------------------------------------------------------------------------------ reautenticação (§1)
export async function marcarReautenticada(conn: Conn, escopo: Escopo, sid: string, agora: number): Promise<boolean> {
  const r = await conn`update sessoes set reautenticada_em = ${new Date(agora)}
    where id = ${sid} and tenant_id = ${escopo.tenantId} and pessoa_id = ${escopo.pessoaId} and revogada_em is null`;
  return r.count > 0;
}

export async function reautenticadaEm(conn: Conn, escopo: Escopo, sid: string): Promise<number | null> {
  const [l] = await conn<{ reautenticada_em: Date | null }[]>`select reautenticada_em from sessoes
    where id = ${sid} and tenant_id = ${escopo.tenantId} and pessoa_id = ${escopo.pessoaId} and revogada_em is null`;
  return l?.reautenticada_em ? ms(l.reautenticada_em) : null;
}

// ------------------------------------------------------------------------------------------ formas de entrada (§2)
/** Trava a conta (FOR UPDATE) e devolve as formas: duas remoções ao mesmo tempo esperam uma pela outra. */
export async function formasDaConta(conn: Conn, contaId: string, travar = false): Promise<{ senha: boolean; google: boolean; googleIdentidade: string | null }> {
  if (travar) await conn`select 1 from contas where id = ${contaId} for update`;
  const ls = await conn<{ id: string; tipo: "senha" | "google" }[]>`select id, tipo from identidades_conta where conta_id = ${contaId}`;
  const g = ls.find((l) => l.tipo === "google");
  return { senha: ls.some((l) => l.tipo === "senha"), google: !!g, googleIdentidade: g?.id ?? null };
}

export async function removerGoogle(conn: Conn, contaId: string): Promise<boolean> {
  const r = await conn`delete from identidades_conta where conta_id = ${contaId} and tipo = 'google'`;
  return r.count > 0;
}

// ------------------------------------------------------------------------------------------ e-mail (§3)
/** false = o e-mail já é de outra conta (índice único). Trava a conta antes, para a corrida com outra troca. */
export async function trocarEmail(conn: Tx, contaId: string, novo: string): Promise<"trocado" | "em_uso" | "sem_conta"> {
  const [c] = await conn<{ id: string }[]>`select id from contas where id = ${contaId} for update`;
  if (!c) return "sem_conta";
  const [outra] = await conn<{ id: string }[]>`select id from contas where email = ${novo} and id <> ${contaId}`;
  if (outra) return "em_uso";
  try {
    // Savepoint: o 23505 de uma corrida com um cadastro não derruba a transação de quem chama.
    await conn.savepoint((sp) => sp`update contas set email = ${novo} where id = ${contaId}`);
  } catch (e) {
    if (ehUnico(e)) return "em_uso";
    throw e;
  }
  return "trocado";
}

/** As pessoas ligadas à conta (a troca de e-mail tira os outros aparelhos de cada uma). */
export async function pessoasDaConta(conn: Conn, contaId: string): Promise<Escopo[]> {
  return conn<Escopo[]>`select tenant_id as "tenantId", pessoa_id as "pessoaId" from conta_pessoas where conta_id = ${contaId} order by tenant_id, pessoa_id`;
}

/** 23505 na troca: um cadastro levou o e-mail entre a conferência e o UPDATE. */
const ehUnico = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: string }).code === "23505";

// ------------------------------------------------------------------------------------------ exclusão (§5, §6)
export type Exclusao = { id: string; contaId: string; tenantId: string; pessoaId: string; pedidaEm: number; purgarEm: number };
type LinhaExclusao = { id: string; conta_id: string; tenant_id: string; pessoa_id: string; pedida_em: Date; purgar_em: Date };
const paraExclusao = (l: LinhaExclusao): Exclusao => ({ id: l.id, contaId: l.conta_id, tenantId: l.tenant_id, pessoaId: l.pessoa_id, pedidaEm: ms(l.pedida_em), purgarEm: ms(l.purgar_em) });

/**
 * Exclusão só no espaço pessoal: o tenant tem a marca `pessoal` (nasce no espaço provisório), nenhum domínio admitido,
 * uma pessoa só, e a conta liga uma pessoa só. A contagem sozinha não basta: uma empresa com uma pessoa seria purgada.
 */
export async function espacoPessoal(conn: Conn, escopo: Escopo, contaId: string): Promise<boolean> {
  const [l] = await conn<{ pessoas: number; ligacoes: number; pessoal: boolean }[]>`select
    (select count(*)::int from pessoas where tenant_id = ${escopo.tenantId}) as pessoas,
    (select count(*)::int from conta_pessoas where conta_id = ${contaId}) as ligacoes,
    nod_tenant_pessoal(${escopo.tenantId}) as pessoal`;
  return l?.pessoas === 1 && l?.ligacoes === 1 && l.pessoal === true;
}

export async function exclusaoProgramada(conn: Conn, contaId: string): Promise<Exclusao | null> {
  const [l] = await conn<LinhaExclusao[]>`select id, conta_id, tenant_id, pessoa_id, pedida_em, purgar_em from exclusoes_conta
    where conta_id = ${contaId} and estado = 'programada'`;
  return l ? paraExclusao(l) : null;
}

/** null = já havia uma programada (índice único): quem chama relê a que vale. O prazo nasce no banco (trigger). */
export async function programarExclusao(conn: Conn, contaId: string, escopo: Escopo): Promise<Exclusao | null> {
  const [l] = await conn<LinhaExclusao[]>`insert into exclusoes_conta (conta_id, tenant_id, pessoa_id)
    values (${contaId}, ${escopo.tenantId}, ${escopo.pessoaId})
    on conflict (conta_id) where estado = 'programada' do nothing
    returning id, conta_id, tenant_id, pessoa_id, pedida_em, purgar_em`;
  return l ? paraExclusao(l) : null;
}

export async function desfazerExclusao(conn: Conn, contaId: string): Promise<boolean> {
  const r = await conn`update exclusoes_conta set estado = 'desfeita', desfeita_em = clock_timestamp()
    where conta_id = ${contaId} and estado = 'programada'`;
  return r.count > 0;
}

/** As programadas com prazo vencido, mais antigas primeiro (o laço da purga). */
export async function exclusoesVencidas(conn: Conn, limite: number): Promise<string[]> {
  const ls = await conn<{ id: string }[]>`select id from exclusoes_conta
    where estado = 'programada' and purgar_em <= clock_timestamp() order by purgar_em limit ${limite}`;
  return ls.map((l) => l.id);
}

/**
 * A função do dono (0110). "purgada"; "ignorada" (desfeita ou ainda não venceu); "bloqueada" com o motivo (o espaço
 * deixou de ser pessoal, ou a purga falhou e voltou inteira: a exclusão saiu da fila e alguém precisa olhar).
 */
export async function purgar(conn: Conn, exclusaoId: string): Promise<{ resultado: "purgada" | "ignorada" } | { resultado: "bloqueada"; motivo: string }> {
  const [l] = await conn<{ ok: boolean }[]>`select nod_purgar_conta(${exclusaoId}::uuid) as ok`;
  if (l?.ok === true) return { resultado: "purgada" };
  const [e] = await conn<{ estado: string; motivo: string | null }[]>`select estado, motivo from exclusoes_conta where id = ${exclusaoId}`;
  return e?.estado === "bloqueada" ? { resultado: "bloqueada", motivo: e.motivo ?? "desconhecido" } : { resultado: "ignorada" };
}

/** As purgadas na última hora: a varredura de depois apaga o que um turno em curso gravou depois do commit. */
export async function purgadasRecentes(conn: Conn): Promise<string[]> {
  const ls = await conn<{ id: string }[]>`select id from exclusoes_conta
    where estado = 'purgada' and purgada_em > clock_timestamp() - interval '1 hour' order by purgada_em`;
  return ls.map((l) => l.id);
}

export async function varrerPurgada(conn: Conn, exclusaoId: string): Promise<number> {
  const [l] = await conn<{ n: string | number }[]>`select nod_varrer_purgada(${exclusaoId}::uuid) as n`;
  return Number(l?.n ?? 0);
}

// ------------------------------------------------------------------------------------------ exportação (§4) — escopada
import type { EstadoExportacaoDto, ExportacaoDto } from "../contracts/minha-conta.ts";
export type EstadoExportacao = EstadoExportacaoDto;
export type Exportacao = ExportacaoDto;
type LinhaExportacao = { id: string; estado: EstadoExportacao; motivo: string | null; tamanho: number | null; pedida_em: Date; pronta_em: Date | null; expira_em: Date | null };
const COLUNAS_EXPORTACAO = "id, estado, motivo, tamanho, pedida_em, pronta_em, expira_em";
const paraExportacao = (l: LinhaExportacao): Exportacao => ({
  id: l.id,
  estado: l.estado,
  motivo: l.motivo,
  tamanho: l.tamanho === null ? null : Number(l.tamanho),
  pedidaEm: ms(l.pedida_em),
  prontaEm: l.pronta_em ? ms(l.pronta_em) : null,
  expiraEm: l.expira_em ? ms(l.expira_em) : null,
});

export function exportacoesRepo(conn: Conn, escopo: Escopo) {
  return {
    /** A mais recente da pessoa (a pronta vencida não conta: o arquivo não serve mais). */
    async atual(agora: number): Promise<Exportacao | null> {
      const [l] = await conn<LinhaExportacao[]>`select ${conn.unsafe(COLUNAS_EXPORTACAO)} from exportacoes
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId}
          and not (estado = 'pronta' and expira_em <= ${new Date(agora)})
        order by pedida_em desc limit 1`;
      return l ? paraExportacao(l) : null;
    },
    /** Pede uma; se já há uma pedida, devolve a mesma (índice único da 0110). */
    async pedir(): Promise<Exportacao> {
      const [nova] = await conn<LinhaExportacao[]>`insert into exportacoes (tenant_id, owner_id)
        values (${escopo.tenantId}, ${escopo.pessoaId})
        on conflict (tenant_id, owner_id) where estado = 'pedida' do nothing
        returning ${conn.unsafe(COLUNAS_EXPORTACAO)}`;
      if (nova) return paraExportacao(nova);
      const [ja] = await conn<LinhaExportacao[]>`select ${conn.unsafe(COLUNAS_EXPORTACAO)} from exportacoes
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and estado = 'pedida'`;
      return paraExportacao(ja!);
    },
    /** Trava a pedida para quem vai prepará-la (SKIP LOCKED: dois laços não fazem o mesmo arquivo). */
    async travarPedida(id: string): Promise<boolean> {
      const [l] = await conn<{ id: string }[]>`select id from exportacoes
        where tenant_id = ${escopo.tenantId} and id = ${id} and estado = 'pedida' for update skip locked`;
      return !!l;
    },
    /** Revisão do PR 506: uma pronta por pessoa — a nova tira o arquivo das anteriores (o banco não acumula zips). */
    async concluir(id: string, arquivo: Uint8Array, agora: number, validadeMs: number): Promise<void> {
      await conn`update exportacoes set estado = 'falhou', motivo = 'substituida', arquivo = null
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and estado = 'pronta' and id <> ${id}`;
      await conn`update exportacoes set estado = 'pronta', arquivo = ${Buffer.from(arquivo)}, tamanho = ${arquivo.byteLength},
        pronta_em = ${new Date(agora)}, expira_em = ${new Date(agora + validadeMs)}
        where tenant_id = ${escopo.tenantId} and id = ${id} and estado = 'pedida'`;
    },
    async falhar(id: string, motivo: string): Promise<void> {
      await conn`update exportacoes set estado = 'falhou', motivo = ${motivo}
        where tenant_id = ${escopo.tenantId} and id = ${id} and estado = 'pedida'`;
    },
    /** O arquivo pronto e dentro da validade, só da própria pessoa. */
    async arquivo(id: string, agora: number): Promise<Uint8Array | null> {
      const [l] = await conn<{ arquivo: Uint8Array }[]>`select arquivo from exportacoes
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}
          and estado = 'pronta' and expira_em > ${new Date(agora)}`;
      return l?.arquivo ?? null;
    },
    /**
     * Os dados da pessoa para o arquivo, com colunas NOMEADAS (nunca `select *`): uma coluna nova não entra sem alguém
     * decidir. Fica de fora tudo que é segredo ou chave (senha, tokens, credenciais de conector e de máquina, sessão do
     * CLI, hash da trilha) — o teste de conformidade confere os nomes.
     */
    async dados(): Promise<DadosDaPessoa> {
      const t = escopo.tenantId;
      const p = escopo.pessoaId;
      const [perfil] = await conn<Record<string, unknown>[]>`select apelido as nome, sobre_mim, como_conheceu, objetivo, tamanho_time, foto, foto_tipo
        from preferencias where tenant_id = ${t} and owner_id = ${p}`;
      const bots = await conn<Record<string, unknown>[]>`select id, nome, titulo, descricao, dono, cor, modelo, modo_aprovacao, criado_em
        from agentes where tenant_id = ${t} and owner_id = ${p} and excluido_em is null order by criado_em, id`;
      const conversas = await conn<Record<string, unknown>[]>`select id, tipo, agente_id, criado_em
        from conversas where tenant_id = ${t} and owner_id = ${p} order by criado_em, id`;
      // Revisão do PR 506: as mensagens são as da pessoa (o dono da linha: o que ela escreveu e o que os bots dela
      // responderam a ela), nunca as de outra pessoa na mesma sala de equipe.
      const mensagens = await conn<Record<string, unknown>[]>`select m.id, m.conversa_id, m.autor_tipo, m.autor_id, m.kind, m.assunto, m.texto, m.criado_em
        from mensagens m
        where m.tenant_id = ${t} and m.owner_id = ${p} order by m.conversa_id, m.criado_em, m.id`;
      const memorias = await conn<Record<string, unknown>[]>`select id, agente_id, tipo, texto, criado_em
        from agente_memorias where tenant_id = ${t} and owner_id = ${p} order by criado_em, id`;
      // NOD-58: o diário da memória também é da pessoa.
      const historicoMemoria = await conn<Record<string, unknown>[]>`select id, agente_id, memoria_id, acao, autor, antes_tipo, antes_texto,
          depois_tipo, depois_texto, desfaz_id, desfeita_em, revisada_em, criado_em
        from memoria_diario where tenant_id = ${t} and owner_id = ${p} order by criado_em, id`;
      // NOD-20: as versões do perfil dos bots (já gravadas redigidas).
      const versoesPerfil = await conn<Record<string, unknown>[]>`select id, agente_id, versao, origem, autor, proposta_id, restaurada_de, nome, titulo,
          descricao, forma, cor, voz, voz_velocidade, campos, criado_em
        from agente_perfil_versoes where tenant_id = ${t} and owner_id = ${p} order by agente_id, versao`;
      const rotinas = await conn<Record<string, unknown>[]>`select id, agente_id, cron, fuso_iana, instrucao, entregavel, estado, criado_em
        from rotinas where tenant_id = ${t} and owner_id = ${p} and excluido_em is null order by criado_em, id`;
      const decisoes = await conn<Record<string, unknown>[]>`select id, tipo, estado, agente_id, conversa_id, frase, criado_em, decidida_em
        from decisoes where tenant_id = ${t} and owner_id = ${p} order by criado_em, id`;
      // A prosa (o texto legível do registro) mora em trilha_prosa e também é da pessoa (revisão do PR 506).
      const trilha = await conn<Record<string, unknown>[]>`select tr.id, tr.em, tr.kind, tr.ferramenta, tr.motivo, tr.agente_id,
          (select string_agg(pr.texto, E'\n' order by pr.id) from trilha_prosa pr
            where pr.tenant_id = tr.tenant_id and pr.trilha_id = tr.id and pr.owner_id = ${p}) as prosa
        from trilha tr where tr.tenant_id = ${t} and tr.owner_id = ${p} order by tr.em, tr.id`;
      const foto = perfil?.foto instanceof Uint8Array && typeof perfil.foto_tipo === "string" ? { bytes: perfil.foto, tipo: perfil.foto_tipo } : null;
      const perfilSemFoto = perfil ? { nome: perfil.nome ?? null, sobre_mim: perfil.sobre_mim ?? null, como_conheceu: perfil.como_conheceu ?? null, objetivo: perfil.objetivo ?? null, tamanho_time: perfil.tamanho_time ?? null } : null;
      return { perfil: perfilSemFoto, foto, bots, conversas, mensagens, memorias, historicoMemoria, versoesPerfil, rotinas, decisoes, trilha };
    },
    /** Apaga o arquivo das vencidas (fica a linha, sem o peso). */
    async limparVencidas(agora: number): Promise<number> {
      const r = await conn`update exportacoes set estado = 'falhou', motivo = 'expirada', arquivo = null
        where tenant_id = ${escopo.tenantId} and estado = 'pronta' and expira_em <= ${new Date(agora)}`;
      return r.count;
    },
  };
}

export type DadosDaPessoa = {
  perfil: Record<string, unknown> | null;
  foto: { bytes: Uint8Array; tipo: string } | null;
  bots: Record<string, unknown>[];
  conversas: Record<string, unknown>[];
  mensagens: Record<string, unknown>[];
  memorias: Record<string, unknown>[];
  historicoMemoria: Record<string, unknown>[];
  versoesPerfil: Record<string, unknown>[];
  rotinas: Record<string, unknown>[];
  decisoes: Record<string, unknown>[];
  trilha: Record<string, unknown>[];
};
