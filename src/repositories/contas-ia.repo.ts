import { CONTAS_DA_PESSOA_MAX } from "../contracts/contas-ia.ts";
import type { ContaAnunciada, EstadoContaNaMaquina, FrenteAtivaDaConta, IaComConta, ModoDasContas } from "../contracts/contas-ia.ts";
import { apelidoPadrao, decidirAnuncio, vinculoSegueSemAcesso, ehIaComConta, type ContaDaPessoa, type VinculoDaConta } from "../domain/contas-da-pessoa.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { data, msOuNull } from "./conversao.ts";

interface LinhaConta {
  id: string;
  ia: IaComConta;
  impressao: string;
  apelido: string;
  plano: string | null;
  corporativa: boolean;
  posicao: number;
  entra_na_troca_automatica: boolean;
  no_limite_ate: Date | null;
  removida_em: Date | null;
  email: string | null;
  organizacao: string | null;
}
interface LinhaVinculo { conta_id: string; maquina_id: string; estado: EstadoContaNaMaquina; sair_pedido_em: Date | null }

const COLUNAS = "id, ia, impressao, apelido, plano, corporativa, posicao, entra_na_troca_automatica, no_limite_ate, removida_em, email, organizacao";

/** ADR-105: o e-mail e a organização são só para a tela; o domínio da troca de conta não os lê. */
export type ContaGuardadaNoServidor = ContaDaPessoa & { impressao: string; email: string | null; organizacao: string | null };

const paraConta = (l: LinhaConta): ContaGuardadaNoServidor => ({
  id: l.id,
  ia: l.ia,
  impressao: l.impressao,
  apelido: l.apelido,
  plano: l.plano,
  corporativa: l.corporativa,
  posicao: l.posicao,
  entraNaTrocaAutomatica: l.entra_na_troca_automatica,
  noLimiteAte: msOuNull(l.no_limite_ate),
  removidaEm: msOuNull(l.removida_em),
  email: l.email,
  organizacao: l.organizacao,
});
const paraVinculo = (l: LinhaVinculo): VinculoDaConta => ({ contaId: l.conta_id, maquinaId: l.maquina_id, estado: l.estado, sairPedidoEm: msOuNull(l.sair_pedido_em) });

/** O resultado de um anúncio: as impressões de que a máquina deve sair (R4) e se a lista mudou (a tela relê). */
/**
 * NOD-277 (definido em 2026-10-15): `prontasAgora` são as contas que ficaram prontas NESTA máquina neste anúncio (conta nova,
 * conta que voltou, ou login que passou a valer aqui). A que já estava pronta não entra: o anúncio se repete a cada batida.
 */
export type ContaProntaAgora = { contaId: string; ia: IaComConta; corporativa: boolean; entraNaTrocaAutomatica: boolean };
export type ResultadoDoAnuncio = { sair: string[]; mudou: boolean; prontasAgora: ContaProntaAgora[] };

/**
 * As contas de IA da pessoa (0074, ADR-102). Toda escrita é da dona (RLS e `owner_id`). Anúncio e reordenação tomam o
 * lock da pessoa (R3 da revisão): duas máquinas anunciando contas novas ao mesmo tempo não pegam a mesma posição.
 */
export function contasIaRepo(conn: Conn, escopo: Escopo) {
  // Uma função: os repositórios nascem juntos (criarRepos) e alguns testes passam uma conexão que não é o postgres.js.
  const doDono = () => conn`tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId}`;
  const travarPessoa = () => conn`select pg_advisory_xact_lock(hashtext(${`contas_ia:${escopo.tenantId}:${escopo.pessoaId}`}))`;

  /** ADR-108 (termos de uso): a 1ª conta ativa de cada IA nasce na fila; a 2ª em diante, fora. NOD-308: a corporativa segue a mesma regra. */
  async function nasceNaFila(a: ContaAnunciada): Promise<boolean> {
    return (await conn`select 1 from contas_ia where ${doDono()} and ia = ${a.ia} and removida_em is null limit 1`).length === 0;
  }

  async function proximaPosicao(): Promise<number> {
    const [l] = await conn<{ max: number | null }[]>`select max(posicao) as max from contas_ia where ${doDono()} and removida_em is null`;
    return (l?.max ?? 0) + 1;
  }

  return {
    /** Serializa as mudanças da lista da pessoa até o fim da transação (o "Seguir com" clicado duas vezes, R3). */
    travar: async (): Promise<void> => { await travarPessoa(); },
    /** Revisão do PR #306: o despacho só lê a lista inteira quando a máquina tem alguma conta pronta (o caso raro hoje). */
    async temContaNaMaquina(maquinaId: string): Promise<boolean> {
      const [l] = await conn`select 1 from contas_ia_maquinas where ${doDono()} and maquina_id = ${maquinaId} and estado = 'pronta' and sair_pedido_em is null limit 1`;
      return l !== undefined;
    },
    /** As contas (com as removidas, que o anúncio precisa ver) e todos os vínculos com as máquinas. */
    async listar(): Promise<{ contas: ContaGuardadaNoServidor[]; vinculos: VinculoDaConta[] }> {
      const [contas, vinculos] = await Promise.all([
        conn<LinhaConta[]>`select ${conn.unsafe(COLUNAS)} from contas_ia where ${doDono()} order by posicao, criada_em`,
        conn<LinhaVinculo[]>`select conta_id, maquina_id, estado, sair_pedido_em from contas_ia_maquinas where ${doDono()}`,
      ]);
      return { contas: contas.map(paraConta), vinculos: vinculos.map(paraVinculo) };
    },

    async buscar(id: string): Promise<ContaGuardadaNoServidor | null> {
      const [l] = await conn<LinhaConta[]>`select ${conn.unsafe(COLUNAS)} from contas_ia where ${doDono()} and id = ${id}`;
      return l ? paraConta(l) : null;
    },

    /**
     * NOD-293 C11 (definido em 2026-10-20): os turnos `despachando` com esta conta (na máquina dada, ou em todas), do mais
     * antigo ao mais novo. Só lê; os joins casam pelo tenant e o turno é da pessoa (RLS e `owner_id`).
     */
    async frentesAtivas(contaId: string, maquinaId: string | null): Promise<FrenteAtivaDaConta[]> {
      const linhas = await conn<{ trabalho_id: string | null; titulo: string | null; agente: string; conversa_id: string; machine_id: string; maquina: string | null }[]>`
        select t.trabalho_id, k.titulo, a.nome as agente, t.conversa_id, t.machine_id, m.nome as maquina
        from turnos t
        join agentes a on a.tenant_id = t.tenant_id and a.id = t.agente_id
        left join trabalhos k on k.tenant_id = t.tenant_id and k.id = t.trabalho_id
        left join maquina_tokens m on m.tenant_id = t.tenant_id and m.id = t.machine_id
        where t.tenant_id = ${escopo.tenantId} and t.owner_id = ${escopo.pessoaId} and t.conta_id = ${contaId}
          and t.estado = 'despachando' and t.machine_id is not null
          ${maquinaId === null ? conn`` : conn`and t.machine_id = ${maquinaId}`}
        order by t.criado_em, t.id`;
      return linhas.map((l) => ({
        trabalhoId: l.trabalho_id, titulo: l.trabalho_id === null ? null : l.titulo, agente: l.agente,
        conversaId: l.conversa_id, maquinaId: l.machine_id, maquina: l.maquina,
      }));
    },

    /**
     * O anúncio de uma máquina (no `conectar` e no `inventario`): cria as contas novas no fim da lista, atualiza o
     * vínculo das conhecidas, devolve à lista a removida que entrou de novo depois da remoção e pede saída da que a
     * máquina ainda não tinha largado (R4). Vínculo desta máquina que não veio no anúncio é apagado: a máquina não tem
     * mais a conta (saiu, ou cumpriu a saída pedida).
     */
    async doAnuncio(maquinaId: string, anunciadas: readonly ContaAnunciada[], agora: number): Promise<ResultadoDoAnuncio> {
      await travarPessoa();
      const existentes = (await conn<LinhaConta[]>`select ${conn.unsafe(COLUNAS)} from contas_ia where ${doDono()}`).map(paraConta);
      const porChave = new Map(existentes.map((c) => [`${c.ia}:${c.impressao}`, c]));
      const sair: string[] = [];
      const vistas: string[] = [];
      const prontasAgora: ContaProntaAgora[] = [];
      let mudou = false;
      let ativas = existentes.filter((c) => c.removidaEm === null).length;
      for (const a of anunciadas) {
        const existente = porChave.get(`${a.ia}:${a.impressao}`) ?? null;
        const decisao = decidirAnuncio(existente, a.logadaEm);
        if ((decisao === "criar" || decisao === "voltar") && ativas >= CONTAS_DA_PESSOA_MAX) continue;
        if (decisao === "criar" || decisao === "voltar") ativas++;
        let id: string;
        // A marca da fila que vale DEPOIS deste anúncio (a gravada agora), não a da linha antiga: é ela que o gatilho de
        // conta nova lê (NOD-277 + NOD-221). NOD-308: ser corporativa não tira a conta da fila.
        let naFilaAgora = existente?.entraNaTrocaAutomatica ?? false;
        if (decisao === "sair") {
          sair.push(a.impressao);
          id = existente!.id;
          await conn`
            insert into contas_ia_maquinas (tenant_id, owner_id, conta_id, maquina_id, estado, sair_pedido_em, visto_em)
            values (${escopo.tenantId}, ${escopo.pessoaId}, ${id}, ${maquinaId}, ${a.estado}, ${data(agora)}, ${data(agora)})
            on conflict (tenant_id, conta_id, maquina_id) do update set estado = excluded.estado, sair_pedido_em = coalesce(contas_ia_maquinas.sair_pedido_em, excluded.sair_pedido_em), visto_em = excluded.visto_em`;
          vistas.push(id);
          continue;
        }
        if (decisao === "criar") {
          const posicao = await proximaPosicao();
          // ADR-108 (termos de uso, ADR-101 §4): só a 1ª conta de cada IA nasce na fila; a 2ª em diante nasce fora (NOD-308:
          // a corporativa segue a mesma regra), e a pessoa as liga em Provedores (com o aviso dos termos). Duas máquinas anunciando ao
          // mesmo tempo esperam uma pela outra no lock da pessoa (`travarPessoa`, no começo do anúncio), e esta leitura vem
          // depois dele: nunca nascem duas contas da mesma IA na fila sem o aviso (revisão do PR 2, C4; teste de concorrência).
          const naFila = await nasceNaFila(a);
          naFilaAgora = naFila;
          const [l] = await conn<{ id: string }[]>`
            insert into contas_ia (tenant_id, owner_id, ia, impressao, apelido, plano, corporativa, posicao, email, organizacao, entra_na_troca_automatica)
            values (${escopo.tenantId}, ${escopo.pessoaId}, ${a.ia}, ${a.impressao}, ${a.apelidoSugerido ?? apelidoPadrao(posicao)}, ${a.plano}, ${corporativaDe(a)}, ${posicao}, ${a.email ?? null}, ${a.organizacao ?? null}, ${naFila})
            on conflict (tenant_id, owner_id, ia, impressao) do update set plano = coalesce(excluded.plano, contas_ia.plano),
              email = coalesce(excluded.email, contas_ia.email), organizacao = coalesce(excluded.organizacao, contas_ia.organizacao)
            returning id`;
          id = l!.id;
          mudou = true;
        } else if (decisao === "voltar") {
          const posicao = await proximaPosicao();
          // Revisão do PR 2 (C4): a conta que volta depois de removida segue a regra de nascimento, não a marca antiga.
          const naFila = await nasceNaFila(a);
          naFilaAgora = naFila;
          await conn`update contas_ia set removida_em = null, no_limite_ate = null, posicao = ${posicao}, plano = coalesce(${a.plano}, plano), corporativa = ${corporativaDe(a)},
            entra_na_troca_automatica = ${naFila},
            email = coalesce(${a.email ?? null}, email), organizacao = coalesce(${a.organizacao ?? null}, organizacao) where ${doDono()} and id = ${existente!.id}`;
          id = existente!.id;
          mudou = true;
        } else {
          id = existente!.id;
          if (a.plano !== null && (a.plano !== existente!.plano || corporativaDe(a) !== existente!.corporativa)) {
            // NOD-308: mudar o plano (inclusive para corporativo) atualiza só o plano e o selo; a fila fica como estava.
            await conn`update contas_ia set plano = ${a.plano}, corporativa = ${corporativaDe(a)} where ${doDono()} and id = ${id}`;
            mudou = true;
          }
          // ADR-105: preenche as contas criadas antes de 2026-10-15 e acompanha a troca de organização. Ausente não apaga.
          if ((a.email !== undefined && a.email !== existente!.email) || (a.organizacao !== undefined && a.organizacao !== existente!.organizacao)) {
            await conn`update contas_ia set email = coalesce(${a.email ?? null}, email), organizacao = coalesce(${a.organizacao ?? null}, organizacao) where ${doDono()} and id = ${id}`;
            mudou = true;
          }
        }
        const [antes] = await conn<{ estado: string; sem_acesso_em: Date | null }[]>`select estado, sem_acesso_em from contas_ia_maquinas where ${doDono()} and conta_id = ${id} and maquina_id = ${maquinaId}`;
        // NOD-283 (CA 10): a conta que voltou "sem acesso" num turno segue assim até um login mais novo que a marca.
        const estado = vinculoSegueSemAcesso(antes?.sem_acesso_em ? antes.sem_acesso_em.getTime() : null, a.estado, a.logadaEm) ? "sem_acesso" : a.estado;
        if (antes?.estado !== estado) mudou = true;
        if (estado === "pronta" && antes?.estado !== "pronta") {
          prontasAgora.push({ contaId: id, ia: a.ia, corporativa: corporativaDe(a), entraNaTrocaAutomatica: naFilaAgora });
        }
        await conn`
          insert into contas_ia_maquinas (tenant_id, owner_id, conta_id, maquina_id, estado, visto_em, sem_acesso_em)
          values (${escopo.tenantId}, ${escopo.pessoaId}, ${id}, ${maquinaId}, ${estado}, ${data(agora)}, ${estado === "sem_acesso" ? data(agora) : null})
          on conflict (tenant_id, conta_id, maquina_id) do update set estado = excluded.estado, visto_em = excluded.visto_em,
            sem_acesso_em = case when excluded.estado = 'sem_acesso' then coalesce(contas_ia_maquinas.sem_acesso_em, excluded.sem_acesso_em) else null end`;
        vistas.push(id);
      }
      const apagados = await conn`
        delete from contas_ia_maquinas where ${doDono()} and maquina_id = ${maquinaId}
          and not (conta_id = any(${vistas}::uuid[]))
        returning conta_id`;
      if (apagados.length > 0) mudou = true;
      return { sair, mudou, prontasAgora };
    },

    async renomear(id: string, apelido: string): Promise<boolean> {
      const r = await conn`update contas_ia set apelido = ${apelido} where ${doDono()} and id = ${id} and removida_em is null returning id`;
      return r.length > 0;
    },

    async definirTrocaAutomatica(id: string, entra: boolean): Promise<boolean> {
      const r = await conn`update contas_ia set entra_na_troca_automatica = ${entra} where ${doDono()} and id = ${id} and removida_em is null returning id`;
      return r.length > 0;
    },

    /** A nova ordem: exatamente as contas não removidas, cada uma uma vez. false = a lista mudou no meio (a tela relê). */
    async reordenar(ids: readonly string[]): Promise<boolean> {
      await travarPessoa();
      const atuais = await conn<{ id: string }[]>`select id from contas_ia where ${doDono()} and removida_em is null`;
      const conjunto = new Set(atuais.map((l) => l.id));
      if (ids.length !== conjunto.size || new Set(ids).size !== ids.length || ids.some((id) => !conjunto.has(id))) return false;
      for (const [i, id] of ids.entries()) await conn`update contas_ia set posicao = ${i + 1} where ${doDono()} and id = ${id}`;
      return true;
    },

    async marcarLimite(id: string, ate: number): Promise<void> {
      await conn`update contas_ia set no_limite_ate = ${data(ate)} where ${doDono()} and id = ${id}`;
    },

    /** Um turno deu certo na conta: ela sai do limite antes do prazo. true = estava no limite. */
    async limparLimite(id: string): Promise<boolean> {
      const r = await conn`update contas_ia set no_limite_ate = null where ${doDono()} and id = ${id} and no_limite_ate is not null returning id`;
      return r.length > 0;
    },

    /** "Sair desta máquina": a máquina faz o logout no próximo contato. false = a conta não está nela. */
    async pedirSaida(id: string, maquinaId: string, agora: number): Promise<boolean> {
      const r = await conn`update contas_ia_maquinas set sair_pedido_em = coalesce(sair_pedido_em, ${data(agora)}) where ${doDono()} and conta_id = ${id} and maquina_id = ${maquinaId} returning conta_id`;
      return r.length > 0;
    },

    /** "Remover de todas": some da lista na hora; cada máquina sai dela no próximo contato. */
    async remover(id: string, agora: number): Promise<boolean> {
      const r = await conn`update contas_ia set removida_em = ${data(agora)}, no_limite_ate = null where ${doDono()} and id = ${id} and removida_em is null returning id`;
      if (r.length === 0) return false;
      await conn`update contas_ia_maquinas set sair_pedido_em = coalesce(sair_pedido_em, ${data(agora)}) where ${doDono()} and conta_id = ${id}`;
      return true;
    },

    /** Desconectar a máquina pedindo para sair das contas: todos os vínculos dela ganham a saída. */
    async pedirSaidaDeTodas(maquinaId: string, agora: number): Promise<number> {
      const r = await conn`update contas_ia_maquinas set sair_pedido_em = coalesce(sair_pedido_em, ${data(agora)}) where ${doDono()} and maquina_id = ${maquinaId} returning conta_id`;
      return r.length;
    },

    /** As impressões de que a máquina deve sair (a puxada de contas, a cada 3 s; índice parcial `contas_ia_maquinas_sair`). */
    async saidasPendentes(maquinaId: string): Promise<string[]> {
      const linhas = await conn<{ impressao: string }[]>`
        select c.impressao from contas_ia_maquinas v join contas_ia c on c.tenant_id = v.tenant_id and c.id = v.conta_id
        where v.tenant_id = ${escopo.tenantId} and v.owner_id = ${escopo.pessoaId} and v.maquina_id = ${maquinaId} and v.sair_pedido_em is not null`;
      return linhas.map((l) => l.impressao);
    },

    /** A máquina saiu das contas: o vínculo some. */
    async saiu(maquinaId: string, impressoes: readonly string[]): Promise<number> {
      if (impressoes.length === 0) return 0;
      const r = await conn`
        delete from contas_ia_maquinas v using contas_ia c
        where v.tenant_id = ${escopo.tenantId} and v.owner_id = ${escopo.pessoaId} and v.maquina_id = ${maquinaId}
          and c.tenant_id = v.tenant_id and c.id = v.conta_id and c.impressao = any(${[...impressoes]}::text[])
        returning v.conta_id`;
      return r.length;
    },

    /** A conta sumiu da máquina no meio do turno (`conta_ausente`, R6): o vínculo sai. */
    /**
     * NOD-283 (C4): o turno nesta conta voltou "conta sem acesso". Só o vínculo DESTA máquina vira `sem_acesso` (a IA segue
     * pronta pelas outras contas). true = havia o vínculo.
     */
    async marcarSemAcesso(id: string, maquinaId: string, agora: number): Promise<boolean> {
      const r = await conn`update contas_ia_maquinas set estado = 'sem_acesso', sem_acesso_em = coalesce(sem_acesso_em, ${data(agora)})
        where ${doDono()} and conta_id = ${id} and maquina_id = ${maquinaId}`;
      return r.count > 0;
    },

    async apagarVinculo(id: string, maquinaId: string): Promise<void> {
      await conn`delete from contas_ia_maquinas where ${doDono()} and conta_id = ${id} and maquina_id = ${maquinaId}`;
    },

    async modo(): Promise<{ modo: ModoDasContas; escolhidas: Partial<Record<IaComConta, string>> }> {
      const [l] = await conn<{ contas_modo: string; contas_escolhidas: Record<string, unknown> }[]>`
        select contas_modo, contas_escolhidas from preferencias where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId}`;
      const escolhidas: Partial<Record<IaComConta, string>> = {};
      for (const [ia, id] of Object.entries(l?.contas_escolhidas ?? {})) if (ehIaComConta(ia) && typeof id === "string") escolhidas[ia] = id;
      return { modo: l?.contas_modo === "automatico" ? "automatico" : "perguntar", escolhidas };
    },

    async definirModo(modo: ModoDasContas): Promise<void> {
      await conn`
        insert into preferencias (tenant_id, owner_id, contas_modo) values (${escopo.tenantId}, ${escopo.pessoaId}, ${modo})
        on conflict (tenant_id, owner_id) do update set contas_modo = excluded.contas_modo, atualizado_em = clock_timestamp()`;
    },

    /** "Seguir com <conta>": a escolhida da IA (null tira). Vale até a primeira da IA renovar (contaDoTurno). */
    async definirEscolhida(ia: IaComConta, id: string | null): Promise<void> {
      const valor = id === null ? conn`preferencias.contas_escolhidas - ${ia}::text` : conn`preferencias.contas_escolhidas || jsonb_build_object(${ia}::text, ${id}::text)`;
      await conn`
        insert into preferencias (tenant_id, owner_id, contas_escolhidas)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${id === null ? conn`'{}'::jsonb` : conn`jsonb_build_object(${ia}::text, ${id}::text)`})
        on conflict (tenant_id, owner_id) do update set contas_escolhidas = ${valor}, atualizado_em = clock_timestamp()`;
    },
  };
}

const corporativaDe = (a: ContaAnunciada): boolean => a.corporativa;
