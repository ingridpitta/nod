import type { AnexoDaConversa, AnexoMeta, MimeAnexo, MimeMidia, OrigemAnexo } from "../contracts/anexo.ts";
import type { ItemDaBiblioteca } from "../contracts/biblioteca.ts";
import type { CursorBiblioteca } from "../domain/biblioteca.ts";
import type { Conn, Escopo } from "../shared/types.ts";

interface Linha {
  id: string;
  nome: string;
  mime: string;
  tamanho: number;
  mensagem_id: string | null;
  conversa_id: string;
}

interface LinhaCompleta extends Linha {
  origem: OrigemAnexo;
  turno_id: string | null;
  largura: number | null;
  altura: number | null;
  duracao_ms: number | null;
  sem_bytes: boolean;
  machine_id: string | null;
  maquina_nome: string | null;
}

const META = "id, nome, mime, tamanho, mensagem_id, conversa_id";
/** NOD-323: o que a conversa mostra de cada anexo (a mídia do bot traz medidas, máquina e o "sem bytes"). */
const META_COMPLETA = `a.id, a.nome, a.mime, a.tamanho, a.mensagem_id, a.conversa_id, a.origem, a.turno_id, a.largura, a.altura,
  a.duracao_ms, a.sem_bytes, a.machine_id, m.nome as maquina_nome`;

export type AnexoGuardado = AnexoMeta & { conversaId: string; mensagemId: string | null; origem?: OrigemAnexo; semBytes?: boolean };

const paraAnexo = (l: Linha): AnexoGuardado => ({
  id: l.id,
  nome: l.nome,
  mime: l.mime as MimeAnexo,
  tamanho: l.tamanho,
  conversaId: l.conversa_id,
  mensagemId: l.mensagem_id,
});

const daConversa = (l: LinhaCompleta): AnexoDaConversa => ({
  id: l.id,
  nome: l.nome,
  mime: l.mime,
  tamanho: l.tamanho,
  ...(l.origem !== "pessoa" ? { origem: l.origem } : {}),
  ...(l.largura !== null ? { largura: l.largura } : {}),
  ...(l.altura !== null ? { altura: l.altura } : {}),
  ...(l.duracao_ms !== null ? { duracaoMs: l.duracao_ms } : {}),
  ...(l.sem_bytes ? { semBytes: true as const } : {}),
  ...(l.machine_id && l.maquina_nome ? { maquina: { id: l.machine_id, nome: l.maquina_nome } } : {}),
});

export type NovaMidiaDoBot = {
  conversaId: string;
  turnoId: string;
  machineId: string | null;
  nome: string;
  mime: MimeMidia;
  /** Vazio quando `semBytes`: o arquivo ficou na máquina. */
  conteudo: Uint8Array;
  tamanho: number;
  semBytes: boolean;
  caminhoRelativo: string;
  sha256: string;
  largura?: number;
  altura?: number;
  duracaoMs?: number;
};

const meta = (a: AnexoGuardado): AnexoMeta => ({ id: a.id, nome: a.nome, mime: a.mime, tamanho: a.tamanho });

/**
 * Anexos de mensagem (ADR-046). Nasce solto (mensagem_id nulo) no upload e é preso à mensagem no
 * envio — só a dona prende (RLS de escrita é owner_id). Os bytes só saem por `conteudo`, nunca junto
 * dos metadados: listar uma conversa não arrasta megabytes.
 */
export function anexosRepo(conn: Conn, escopo: Escopo) {
  return {
    async criar(a: { conversaId: string; nome: string; mime: MimeAnexo; conteudo: Uint8Array }): Promise<AnexoGuardado | null> {
      const [l] = await conn<Linha[]>`
        insert into anexos (tenant_id, owner_id, conversa_id, nome, mime, tamanho, conteudo)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${a.conversaId}, ${a.nome}, ${a.mime}, ${a.conteudo.byteLength}, ${semCopia(a.conteudo)})
        returning ${conn.unsafe(META)}`;
      return l ? paraAnexo(l) : null;
    },

    async buscar(id: string): Promise<AnexoGuardado | null> {
      const [l] = await conn<(Linha & { origem: OrigemAnexo; sem_bytes: boolean })[]>`
        select ${conn.unsafe(META)}, origem, sem_bytes from anexos where tenant_id = ${escopo.tenantId} and id = ${id}`;
      return l ? { ...paraAnexo(l), origem: l.origem, semBytes: l.sem_bytes } : null;
    },

    async conteudo(id: string): Promise<{ meta: AnexoGuardado; bytes: Buffer } | null> {
      const [l] = await conn<(Linha & { conteudo: Buffer; origem: OrigemAnexo; sem_bytes: boolean })[]>`
        select ${conn.unsafe(META)}, origem, sem_bytes, conteudo from anexos where tenant_id = ${escopo.tenantId} and id = ${id}`;
      return l ? { meta: { ...paraAnexo(l), origem: l.origem, semBytes: l.sem_bytes }, bytes: l.conteudo } : null;
    },

    /**
     * NOD-323 (J5, Mostrar no Finder): onde a mídia do bot está na máquina — o caminho relativo à `~/nod` e a máquina.
     * Só a dona (quem tem o app do Mac daquela máquina) vê o caminho; para os outros, null.
     */
    async localDoBot(id: string): Promise<{ conversaId: string; caminhoRelativo: string; machineId: string } | null> {
      const [l] = await conn<{ conversa_id: string; caminho_relativo: string | null; machine_id: string | null }[]>`
        select conversa_id, caminho_relativo, machine_id from anexos
        where tenant_id = ${escopo.tenantId} and id = ${id} and origem = 'bot' and owner_id = ${escopo.pessoaId}`;
      return l?.caminho_relativo && l.machine_id ? { conversaId: l.conversa_id, caminhoRelativo: l.caminho_relativo, machineId: l.machine_id } : null;
    },

    /**
     * NOD-323: uma fatia dos bytes (Range do vídeo e do áudio). `substring` do bytea com STORAGE EXTERNAL lê só os
     * pedaços TOAST da faixa. `inicio` é 0-based e `fim` inclusivo, como no cabeçalho Range.
     */
    async faixa(id: string, inicio: number, fim: number): Promise<Buffer | null> {
      const [l] = await conn<{ pedaco: Buffer }[]>`
        select substring(conteudo from ${inicio + 1}::int for ${fim - inicio + 1}::int) as pedaco
        from anexos where tenant_id = ${escopo.tenantId} and id = ${id}`;
      return l ? l.pedaco : null;
    },

    /**
     * NOD-323: a mídia que o bot entregou pelo proxy. Nasce SOLTA no turno e o assentar a prende à fala final.
     * Idempotente por (turno, sha256): a nova tentativa do proxy e a varredura dos links da fala devolvem o mesmo
     * anexo (`novo: false`). A dona é a pessoa do token do turno (RLS de escrita: owner_id).
     */
    async criarDoBot(a: NovaMidiaDoBot): Promise<{ anexo: AnexoGuardado; novo: boolean } | null> {
      const [l] = await conn<(Linha & { novo: boolean })[]>`
        insert into anexos (tenant_id, owner_id, conversa_id, nome, mime, tamanho, conteudo, origem, turno_id, machine_id,
          caminho_relativo, largura, altura, duracao_ms, sem_bytes, sha256)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${a.conversaId}, ${a.nome}, ${a.mime}, ${a.tamanho}, ${semCopia(a.conteudo)},
          'bot', ${a.turnoId}, (select id from maquinas where tenant_id = ${escopo.tenantId} and id = ${a.machineId}), ${a.caminhoRelativo}, ${a.largura ?? null}, ${a.altura ?? null}, ${a.duracaoMs ?? null},
          ${a.semBytes}, ${a.sha256})
        on conflict (tenant_id, turno_id, sha256) where origem = 'bot' do update set sha256 = excluded.sha256
        returning ${conn.unsafe(META)}, (xmax = 0) as novo`;
      return l ? { anexo: { ...paraAnexo(l), origem: "bot", semBytes: a.semBytes }, novo: l.novo } : null;
    },

    async doBotPorSha(turnoId: string, sha256: string): Promise<string | null> {
      const [l] = await conn<{ id: string }[]>`
        select id from anexos where tenant_id = ${escopo.tenantId} and origem = 'bot' and turno_id = ${turnoId} and sha256 = ${sha256}`;
      return l?.id ?? null;
    },

    /** Quantos anexos do bot este turno já tem (o teto MIDIAS_POR_TURNO). */
    async contarDoTurno(turnoId: string): Promise<number> {
      const [l] = await conn<{ n: number }[]>`
        select count(*)::int as n from anexos where tenant_id = ${escopo.tenantId} and origem = 'bot' and turno_id = ${turnoId}`;
      return l?.n ?? 0;
    },

    /**
     * NOD-323: prende à fala final os anexos do bot SOLTOS deste turno, na ordem em que chegaram. Devolve os ids presos.
     */
    async prenderDoTurno(turnoId: string, mensagemId: string): Promise<string[]> {
      const linhas = await conn<{ id: string }[]>`
        update anexos set mensagem_id = ${mensagemId}
        where tenant_id = ${escopo.tenantId} and origem = 'bot' and turno_id = ${turnoId} and mensagem_id is null
        returning id`;
      return linhas.map((l) => l.id);
    },

    /** Para a conversa: os anexos de cada mensagem com o que a mídia do bot traz (medidas, máquina, sem bytes). */
    async daConversa(mensagemIds: readonly string[]): Promise<Map<string, AnexoDaConversa[]>> {
      const saida = new Map<string, AnexoDaConversa[]>();
      if (mensagemIds.length === 0) return saida;
      const linhas = await conn<LinhaCompleta[]>`
        select ${conn.unsafe(META_COMPLETA)} from anexos a
        left join maquinas m on m.tenant_id = a.tenant_id and m.id = a.machine_id
        where a.tenant_id = ${escopo.tenantId} and a.mensagem_id = any(${mensagemIds as string[]}::uuid[])
        order by a.criado_em, a.id`;
      for (const l of linhas) {
        if (!l.mensagem_id) continue;
        saida.set(l.mensagem_id, [...(saida.get(l.mensagem_id) ?? []), daConversa(l)]);
      }
      return saida;
    },

    /**
     * NOD-326: a Biblioteca — a mídia que o bot anexou nesta conversa (presa a uma fala; a solta é de turno em curso ou lixo
     * do varredor), da mais recente à mais antiga, pela chave (criado_em, id). Traz `limite + 1` para saber se há mais. O
     * instante sai como texto com µs (o cursor não pode perder precisão). A conversa é filtrada explicitamente, além da RLS.
     */
    async daBiblioteca(conversaId: string, antes: CursorBiblioteca | null, limite: number): Promise<{ itens: ItemDaBiblioteca[]; ultimo: CursorBiblioteca | null; temMais: boolean }> {
      const linhas = await conn<(LinhaCompleta & { criado_em_txt: string })[]>`
        select ${conn.unsafe(META_COMPLETA)}, to_char(a.criado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as criado_em_txt
        from anexos a
        left join maquinas m on m.tenant_id = a.tenant_id and m.id = a.machine_id
        where a.tenant_id = ${escopo.tenantId} and a.conversa_id = ${conversaId} and a.origem = 'bot' and a.mensagem_id is not null
          ${antes ? conn`and (a.criado_em, a.id) < (${antes.criadoEm}::text::timestamptz, ${antes.id}::uuid)` : conn``}
        order by a.criado_em desc, a.id desc
        limit ${limite + 1}`;
      const temMais = linhas.length > limite;
      const pagina = linhas.slice(0, limite);
      const itens = pagina.map((l) => ({ ...daConversa(l), mensagemId: l.mensagem_id!, criadoEm: l.criado_em_txt }));
      const u = pagina.at(-1);
      return { itens, ultimo: u ? { criadoEm: u.criado_em_txt, id: u.id } : null, temMais };
    },

    /**
     * O varredor (NOD-323): apaga a mídia do bot que ficou solta (turno que nunca assentou) há mais de `antesDe`. O turno
     * ainda vivo fica de fora (Codex no #507: o turno não tem relógio, ADR-067); o assentar que corre junto ganha pela
     * trava da linha — o delete reavalia `mensagem_id is null` depois do commit dele.
     */
    async apagarSoltosDoBot(antesDe: Date): Promise<number> {
      const linhas = await conn<{ id: string }[]>`
        delete from anexos a where a.tenant_id = ${escopo.tenantId} and a.origem = 'bot' and a.mensagem_id is null and a.criado_em < ${antesDe}
          and not exists (select 1 from turnos t where t.tenant_id = a.tenant_id and t.id = a.turno_id and t.estado in ('pendente', 'despachando'))
        returning a.id`;
      return linhas.length;
    },

    /**
     * Prende à mensagem os anexos SOLTOS desta conversa e da dona. Devolve os que prendeu, na ordem
     * pedida; quem chama compara o tamanho para recusar id alheio, já usado ou de outra conversa.
     */
    async prender(ids: readonly string[], p: { conversaId: string; mensagemId: string }): Promise<AnexoMeta[]> {
      if (ids.length === 0) return [];
      const linhas = await conn<Linha[]>`
        update anexos set mensagem_id = ${p.mensagemId}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and conversa_id = ${p.conversaId}
          and mensagem_id is null and origem <> 'bot' and id = any(${ids as string[]}::uuid[])
        returning ${conn.unsafe(META)}`;
      const porId = new Map(linhas.map((l) => [l.id, meta(paraAnexo(l))]));
      return ids.flatMap((id) => porId.get(id) ?? []);
    },

    async daMensagens(mensagemIds: readonly string[]): Promise<Map<string, AnexoMeta[]>> {
      const saida = new Map<string, AnexoMeta[]>();
      if (mensagemIds.length === 0) return saida;
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(META)} from anexos
        where tenant_id = ${escopo.tenantId} and mensagem_id = any(${mensagemIds as string[]}::uuid[])
        order by criado_em, id`;
      for (const l of linhas) {
        if (!l.mensagem_id) continue;
        saida.set(l.mensagem_id, [...(saida.get(l.mensagem_id) ?? []), meta(paraAnexo(l))]);
      }
      return saida;
    },

    async metas(ids: readonly string[]): Promise<AnexoMeta[]> {
      if (ids.length === 0) return [];
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(META)} from anexos where tenant_id = ${escopo.tenantId} and id = any(${ids as string[]}::uuid[])`;
      const porId = new Map(linhas.map((l) => [l.id, meta(paraAnexo(l))]));
      return ids.flatMap((id) => porId.get(id) ?? []);
    },
  };
}

/** NOD-323 (revisão 2, M3): uma vista do mesmo ArrayBuffer — `Buffer.from(u8)` copiaria os 50 MiB do vídeo. */
function semCopia(u: Uint8Array): Buffer {
  return Buffer.isBuffer(u) ? u : Buffer.from(u.buffer, u.byteOffset, u.byteLength);
}
