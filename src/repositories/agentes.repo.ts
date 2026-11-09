import type { IdHarness, PreferenciaHarness } from "../contracts/harness.ts";
import type { Agente, CorAgente, DonoAgente, EsforcoAgente, FormaAgente, ModoAprovacao, PapelAgente, Visibilidade } from "../contracts/agente.ts";
import type { EscolhasIa, InteligenciaBot, ModoInteligencia } from "../contracts/inteligencia.ts";
import { derivadosDa, INTELIGENCIA_PADRAO, inteligenciaDoAgente, inteligenciaDoLegado } from "../domain/inteligencia.ts";
import { MODO_APROVACAO_INICIAL } from "../domain/modo-aprovacao.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { jsonb, ms } from "./conversao.ts";

interface Linha {
  tenant_id: string;
  id: string;
  owner_id: string;
  visibility: Visibilidade;
  nome: string;
  titulo: string;
  descricao: string;
  dono: DonoAgente;
  forma: FormaAgente;
  cor: CorAgente;
  fixado: boolean;
  oculto: boolean;
  confirmado: boolean;
  modelo: string;
  harness?: PreferenciaHarness;
  esforco: EsforcoAgente | null;
  modo_aprovacao: ModoAprovacao;
  duplicado_de: string | null;
  secao: string;
  posicao: number | null;
  nao_lido: boolean;
  excluido_em: Date | null;
  voz: string | null;
  voz_velocidade: number | null;
  papel: PapelAgente | null;
  maquina_id: string | null;
  inteligencia_modo: ModoInteligencia | null;
  ordem_ias: IdHarness[] | null;
  escolhas_ia: EscolhasIa | null;
  configurando_desde: Date | null;
  configurando_turno_id: string | null;
  criado_em: Date;
}

const COLUNAS = "tenant_id, id, owner_id, visibility, nome, titulo, descricao, dono, forma, cor, fixado, oculto, confirmado, modelo, harness, esforco, modo_aprovacao, duplicado_de, criado_em, secao, posicao, nao_lido, excluido_em, voz, voz_velocidade, papel, maquina_id, inteligencia_modo, ordem_ias, escolhas_ia, configurando_desde, configurando_turno_id";

/** 0068: as colunas novas lidas como gravadas e conferidas contra harness/modelo (inteligenciaDoAgente). */
function inteligenciaDaLinha(l: Linha): InteligenciaBot {
  const harness = l.harness ?? "auto";
  const gravada: InteligenciaBot = { modo: l.inteligencia_modo ?? "auto", fixa: harness !== "auto" ? harness : null, ordem: l.ordem_ias ?? null, escolhas: l.escolhas_ia ?? {} };
  return inteligenciaDoAgente({ harness, modelo: l.modelo, esforco: l.esforco, inteligencia: gravada });
}

function paraAgente(l: Linha): Agente {
  return {
    tenantId: l.tenant_id,
    id: l.id,
    ownerId: l.owner_id,
    visibility: l.visibility,
    nome: l.nome,
    titulo: l.titulo,
    descricao: l.descricao,
    dono: l.dono,
    forma: l.forma,
    cor: l.cor,
    fixado: l.fixado,
    oculto: l.oculto,
    confirmado: l.confirmado,
    modelo: l.modelo,
    harness: l.harness ?? "auto",
    esforco: l.esforco ?? null,
    inteligencia: inteligenciaDaLinha(l),
    modoAprovacao: l.modo_aprovacao ?? "manual",
    maquinaId: l.maquina_id ?? null,
    duplicadoDe: l.duplicado_de,
    secao: l.secao,
    posicao: l.posicao,
    naoLido: l.nao_lido,
    excluidoEm: l.excluido_em ? ms(l.excluido_em) : null,
    voz: l.voz ?? null,
    vozVelocidade: l.voz_velocidade ?? 1,
    papel: l.papel ?? null,
    configurandoDesde: l.configurando_desde ? ms(l.configurando_desde) : null,
    configurandoTurnoId: l.configurando_turno_id,
    criadoEm: ms(l.criado_em),
  };
}

export type NovoAgente = {
  id?: string;
  nome: string;
  titulo?: string;
  descricao?: string;
  dono: DonoAgente;
  /** definido em 2026-09-16: agente de empresa nasce 'equipe' (visível a todas as pessoas do tenant); de pessoa nasce 'privado'. */
  visibility?: Visibilidade;
  forma: FormaAgente;
  cor: CorAgente;
  modelo: string;
  harness?: PreferenciaHarness;
  /** 0068: a inteligência inteira (o Duplicate copia); ausente = a que harness/modelo dizem. */
  inteligencia?: InteligenciaBot;
  duplicadoDe?: string | null;
  confirmado?: boolean;
  /** NOD-289 (M1): a máquina-alvo (ADR-090) já no INSERT — a cópia da dona herda a do original se a chave estiver viva. */
  maquinaId?: string | null;
};

/**
 * revisto em 2026-10-10 (0068): harness/modelo/esforco saíram do perfil — mudam só pela `inteligencia`, que grava os
 * derivados junto (derivadosDa), para os dois lados nunca divergirem.
 */
export type PerfilAgente = Partial<Pick<Agente, "nome" | "titulo" | "descricao" | "confirmado" | "forma" | "cor">> & { inteligencia?: InteligenciaBot };

/** dono é imutável (trigger nod_agente_dono_imutavel): não existe método que o altere. */
export function agentesRepo(conn: Conn, escopo: Escopo) {
  return {
    async execucaoBloqueada(turnoId: string): Promise<boolean> {
      const [l] = await conn<{ bloqueada: boolean }[]>`select (a.excluido_em is not null or a.geracao_execucao <> t.geracao_execucao) as bloqueada
        from turnos t join agentes a on a.tenant_id = t.tenant_id and a.id = t.agente_id
        where t.tenant_id = ${escopo.tenantId} and t.id = ${turnoId}`;
      return l?.bloqueada ?? false;
    },
    /**
     * Geração de execução do agente (ADR-034; sobe a cada exclusão). definido em 2026-09-24 (emenda da
     * ADR-044): o card do pré-voo nasce sem turno e guarda esta geração no payload; null = agente sumiu.
     */
    async geracaoExecucao(id: string): Promise<number | null> {
      const [l] = await conn<{ geracao_execucao: number }[]>`select geracao_execucao from agentes where tenant_id = ${escopo.tenantId} and id = ${id}`;
      return l ? Number(l.geracao_execucao) : null;
    },
    async organizar(id: string, campos: { secao: string }): Promise<Agente | null> {
      const [l] = await conn<Linha[]>`update agentes set secao = ${campos.secao}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and excluido_em is null
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraAgente(l) : null;
    },
    /**
     * NOD-437: troca o time (agentes.secao) de vários bots da pessoa de uma vez — renomear e excluir um time. Leva também
     * os excluídos (restaurar um bot não pode ressuscitar um time excluído com o nome antigo).
     */
    async mudarSecao(ids: readonly string[], secao: string): Promise<number> {
      if (ids.length === 0) return 0;
      const r = await conn`update agentes set secao = ${secao}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = any(${[...ids]}::uuid[])`;
      return r.count;
    },
    /**
     * A ordem inteira de um grupo da barra (0041): cada id recebe o próprio índice. Só os bots da pessoa mudam —
     * id de outra pessoa, excluído ou inexistente fica de fora em silêncio. Devolve quantos mudaram.
     */
    async ordenar(ids: readonly string[]): Promise<number> {
      const r = await conn`update agentes set posicao = o.i - 1
        from unnest(${[...ids]}::uuid[]) with ordinality as o(id, i)
        where agentes.tenant_id = ${escopo.tenantId} and agentes.owner_id = ${escopo.pessoaId} and agentes.id = o.id and agentes.excluido_em is null`;
      return r.count;
    },
    async excluir(id: string, agora: number): Promise<Agente | null> {
      await conn`select pg_advisory_xact_lock(hashtext(${escopo.tenantId}), hashtext(${id}))`;
      // ADR-059: excluir volta o modo a 'manual' — restaurar não devolve autonomia, como não devolve concessões (ADR-034).
      const [l] = await conn<Linha[]>`update agentes set excluido_em = ${new Date(agora)}, configurando_desde = null, configurando_turno_id = null, fixado = false, geracao_execucao = geracao_execucao + 1, modo_aprovacao = 'manual'
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and excluido_em is null
        returning ${conn.unsafe(COLUNAS)}`;
      if (!l) return null;
      await conn`update rotinas set estado = 'pausada' where tenant_id = ${escopo.tenantId} and agente_id = ${id}`;
      await conn`delete from concessoes where tenant_id = ${escopo.tenantId} and agente_id = ${id}`;
      await conn`update turnos set estado = 'interrompido', motivo_interrupcao = 'parado_pela_pessoa'
        where tenant_id = ${escopo.tenantId} and agente_id = ${id} and estado = 'pendente'`;
      await conn`update turnos set parar_solicitado_em = ${new Date(agora)}
        where tenant_id = ${escopo.tenantId} and agente_id = ${id} and estado = 'despachando'`;
      await conn`update propostas set estado = 'recusada' where tenant_id = ${escopo.tenantId} and agente_id = ${id} and estado = 'pendente'`;
      // ADR-115: a revisão em voo do bot excluído também vence — senão um "libera" que chegasse depois liberaria.
      await conn`update decisoes set estado = 'vencida' where tenant_id = ${escopo.tenantId} and agente_id = ${id} and estado in ('pendente', 'reaberta', 'em_revisao')`;
      // definido em 2026-10-08 (revisão do épico, S5): as tasks abertas do bot excluído param junto — os turnos delas
      // acabaram de ser interrompidos acima, e ninguém mais as sincronizaria (ficavam "Trabalhando" na tela para sempre).
      await conn`update trabalhos set estado = 'parado', terminado_em = ${new Date(agora)}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and agente_id = ${id} and estado in ('na_fila', 'rodando', 'precisa_de_voce', 'fechado_ocioso')`;
      return paraAgente(l);
    },
    async restaurar(id: string): Promise<Agente | null> {
      const [l] = await conn<Linha[]>`update agentes set excluido_em = null, oculto = false
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and excluido_em is not null
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraAgente(l) : null;
    },
    async criar(a: NovoAgente): Promise<Agente | null> {
      const visibility: Visibilidade = a.visibility ?? (a.dono === "empresa" ? "equipe" : "privado");
      const i = a.inteligencia ?? inteligenciaDoLegado(INTELIGENCIA_PADRAO, { harness: a.harness ?? "auto", modelo: a.modelo });
      const d = derivadosDa(i);
      const [l] = await conn<Linha[]>`
        insert into agentes (tenant_id, id, owner_id, visibility, nome, titulo, descricao, dono, forma, cor, modelo, harness, esforco, inteligencia_modo, ordem_ias, escolhas_ia, duplicado_de, confirmado, maquina_id, modo_aprovacao)
        values (${escopo.tenantId}, ${a.id ?? conn`gen_random_uuid()`}, ${escopo.pessoaId}, ${visibility}, ${a.nome}, ${a.titulo ?? ""},
          ${a.descricao ?? ""}, ${a.dono}, ${a.forma}, ${a.cor}, ${d.modelo}, ${d.harness}, ${d.esforco}, ${i.modo}, ${i.ordem ? jsonb(conn, i.ordem) : null}, ${jsonb(conn, i.escolhas)},
          ${a.duplicadoDe ?? null}, ${a.confirmado ?? false}, ${a.maquinaId ?? null}, ${MODO_APROVACAO_INICIAL})
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraAgente(l) : null;
    },

    async buscar(id: string, incluirExcluidos = false): Promise<Agente | null> {
      const [l] = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from agentes where tenant_id = ${escopo.tenantId} and id = ${id} ${incluirExcluidos ? conn`` : conn`and excluido_em is null`}`;
      return l ? paraAgente(l) : null;
    },

    /** Resolve por nome entre os agentes visíveis (para encaminhar/pedir_a_bot por nome). */
    async buscarPorNome(nome: string): Promise<Agente | null> {
      const [l] = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from agentes where tenant_id = ${escopo.tenantId} and excluido_em is null and lower(nome) = lower(${nome}) order by criado_em limit 1`;
      return l ? paraAgente(l) : null;
    },

    /** Frota da pessoa (o que a policy deixa ver): ocultos ficam de fora salvo pedido explícito. */
    async listar(opcoes: { incluirOcultos?: boolean; incluirExcluidos?: boolean } = {}): Promise<Agente[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from agentes where tenant_id = ${escopo.tenantId}
          ${opcoes.incluirExcluidos ? conn`` : conn`and excluido_em is null`}
          ${opcoes.incluirOcultos ? conn`` : conn`and oculto = false`}
        order by fixado desc, posicao asc nulls last, criado_em`;
      return linhas.map(paraAgente);
    },

    /**
     * definido em 2026-10-07 (NOD-190): `buscar` com a linha TRAVADA até o fim da transação, para confirmar uma proposta
     * de perfil. Mesmo filtro de `atualizarPerfil` (só a dona, não excluído), no molde de rotinas.buscarParaAtualizar:
     * a segunda confirmação concorrente, e o editarPerfil da tela, esperam a primeira e veem o perfil já mudado.
     */
    async buscarParaAtualizar(id: string): Promise<Agente | null> {
      const [l] = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from agentes where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and excluido_em is null for update`;
      return l ? paraAgente(l) : null;
    },

    /**
     * definido em 2026-10-28 (NOD-23): /configurar liga a entrevista de reconfiguração. Só a dona, bot confirmado, não
     * excluído e nunca o Nod (o Nod não se reconfigura); a mesma regra de `podeReconfigurar`, repetida no WHERE para a
     * linha que mudou entre a leitura e a escrita. Devolve se ligou.
     */
    async iniciarConfiguracao(id: string, agora: number, turnoId: string, expirouAntesDe: number): Promise<boolean> {
      const linhas = await conn`update agentes set configurando_desde = ${new Date(agora)},
          configurando_turno_id = case when configurando_desde is null or configurando_desde <= ${new Date(expirouAntesDe)} then ${turnoId} else coalesce(configurando_turno_id, ${turnoId}) end
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and excluido_em is null and confirmado and papel is null
        returning id`;
      return linhas.length > 0;
    },

    /**
     * NOD-23: o /configurar que sai atrasado (fila, repetição) religa a janela vencida a partir da emissão. Só se o modo
     * ainda está aberto (coluna não nula: o cartão não foi decidido). O UPDATE espera a trava do agente: emitir não
     * segura a linha do turno nesta transação, então não há ordem cruzada com excluir; pular a trava perderia o comando.
     */
    async religarConfiguracao(id: string, agora: number, turnoId: string): Promise<boolean> {
      const linhas = await conn`update agentes set configurando_desde = ${new Date(agora)}, configurando_turno_id = ${turnoId}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}
          and excluido_em is null and confirmado and papel is null
        returning id`;
      return linhas.length > 0;
    },

    /** NOD-23: confirmar ou recusar a proposta de perfil fecha o modo. Idempotente (já fechado = nada). */
    async encerrarConfiguracao(id: string, propostaTurnoId: string | null): Promise<void> {
      await conn`update agentes set configurando_desde = null, configurando_turno_id = null
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and configurando_desde is not null
          and exists (
            select 1 from turnos p join turnos i on i.tenant_id = p.tenant_id
            where p.tenant_id = agentes.tenant_id and p.id = ${propostaTurnoId} and i.id = agentes.configurando_turno_id
              and p.agente_id = agentes.id and i.agente_id = agentes.id and p.conversa_id = i.conversa_id
              and (p.criado_em, p.id) >= (i.criado_em, i.id)
          )`;
    },

    async atualizarPerfil(id: string, perfil: PerfilAgente): Promise<Agente | null> {
      const i = perfil.inteligencia;
      const d = i ? derivadosDa(i) : null;
      const [l] = await conn<Linha[]>`
        update agentes set
          nome = coalesce(${perfil.nome ?? null}, nome),
          titulo = coalesce(${perfil.titulo ?? null}, titulo),
          descricao = coalesce(${perfil.descricao ?? null}, descricao),
          confirmado = coalesce(${perfil.confirmado ?? null}, confirmado),
          forma = coalesce(${perfil.forma ?? null}, forma),
          cor = coalesce(${perfil.cor ?? null}, cor),
          modelo = coalesce(${d?.modelo ?? null}, modelo),
          harness = coalesce(${d?.harness ?? null}, harness),
          esforco = case when ${d !== null} then ${d?.esforco ?? null} else esforco end,
          inteligencia_modo = coalesce(${i?.modo ?? null}, inteligencia_modo),
          ordem_ias = case when ${i !== undefined} then ${i?.ordem ? jsonb(conn, i.ordem) : null}::jsonb else ordem_ias end,
          escolhas_ia = coalesce(${i ? jsonb(conn, i.escolhas) : null}::jsonb, escolhas_ia)
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and excluido_em is null
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraAgente(l) : null;
    },

    /** ADR-071: a voz do bot nas ligações e a velocidade; só a dona muda. */
    async definirVoz(id: string, p: { voz?: string | null; velocidade?: number }): Promise<Agente | null> {
      const [l] = await conn<Linha[]>`update agentes set
          voz = case when ${p.voz !== undefined} then ${p.voz ?? null} else voz end,
          voz_velocidade = coalesce(${p.velocidade ?? null}, voz_velocidade)
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and excluido_em is null
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraAgente(l) : null;
    },

    /**
     * ADR-090: onde o bot trabalha (o id da chave da máquina; null = qualquer uma). Só a dona muda, como o modo; quem chama
     * já conferiu que a chave é dela. Devolve os bots alterados (os que não são dela, não existem ou foram excluídos ficam de fora).
     */
    async definirMaquina(ids: readonly string[], maquinaId: string | null): Promise<Agente[]> {
      if (ids.length === 0) return [];
      const ls = await conn<Linha[]>`update agentes set maquina_id = ${maquinaId}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = any(${[...ids]}::uuid[]) and excluido_em is null
        returning ${conn.unsafe(COLUNAS)}`;
      return ls.map(paraAgente);
    },

    /** ADR-059: só a dona muda (filtro por owner_id, como o perfil); null = não é dela, não existe ou foi excluído. */
    async definirModoAprovacao(id: string, modo: ModoAprovacao): Promise<Agente | null> {
      const [l] = await conn<Linha[]>`update agentes set modo_aprovacao = ${modo}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and excluido_em is null
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraAgente(l) : null;
    },

    /**
     * definido em 2026-10-07 (ADR-081): o Nod da pessoa, com a TRAVA da pessoa até o fim da transação — dois `GET
     * /onboarding` ao mesmo tempo (duas abas) esperam um pelo outro e o segundo já vê o Nod que o primeiro criou. O índice
     * único da 0061 fica de rede. Só a dona: o Nod de outra pessoa nunca volta.
     */
    async travarNod(): Promise<Agente | null> {
      await conn`select pg_advisory_xact_lock(hashtext(${escopo.tenantId}), hashtext(${`nod:${escopo.pessoaId}`}))`;
      const [l] = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from agentes
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and papel = 'nod'`;
      return l ? paraAgente(l) : null;
    },

    /**
     * definido em 2026-10-13 (revisão do PR #309, ADR-104): a trava dos NOMES de bot do tenant até o fim da transação.
     * O criar_bots confere a unicidade lendo os nomes e só depois cria; dois pedidos juntos (duas conversas, ou a pessoa e
     * um bot) leriam o mesmo antes e criariam o mesmo nome duas vezes. Com a trava, o segundo espera o primeiro commitar
     * e já vê os nomes dele. Sem índice único: nomes legados repetidos existem e o criarAgente da tela não confere.
     */
    async travarNomesDeBots(): Promise<void> {
      await conn`select pg_advisory_xact_lock(hashtext(${escopo.tenantId}), hashtext('nomes_de_bot'))`;
    },

    /** O Nod da pessoa (sem trava), excluído ou não; null = ainda não existe. */
    async buscarNod(): Promise<Agente | null> {
      const [l] = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from agentes
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and papel = 'nod'`;
      return l ? paraAgente(l) : null;
    },

    /**
     * O ÚNICO caminho que grava `papel` (ADR-081): marca um bot da pessoa como o Nod, já com o nome, o título, a descrição,
     * o mascote preto e fixado. Nenhuma rota nem ferramenta recebe `papel`.
     */
    async marcarComoNod(id: string, perfil: { nome: string; titulo: string; descricao: string }): Promise<Agente | null> {
      const [l] = await conn<Linha[]>`update agentes set papel = 'nod', nome = ${perfil.nome}, titulo = ${perfil.titulo}, descricao = ${perfil.descricao},
          cor = 'c-black', fixado = true, oculto = false, confirmado = true, secao = ''
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and dono = 'pessoa' and excluido_em is null and papel is null
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraAgente(l) : null;
    },

    async fixar(id: string, fixado: boolean): Promise<Agente | null> {
      const [l] = await conn<Linha[]>`update agentes set fixado = ${fixado} where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraAgente(l) : null;
    },

    async ocultar(id: string, oculto: boolean): Promise<Agente | null> {
      const [l] = await conn<Linha[]>`update agentes set oculto = ${oculto} where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraAgente(l) : null;
    },
  };
}
