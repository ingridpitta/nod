import type { AppDoBot, FonteDoApp, FormaDoApp, IconeDoApp, PedeQuando, QuemVe, RetratoDoApp } from "../domain/apps-do-bot.ts";
import { chaveDoNome, ehFonte, ehForma, ehIcone } from "../domain/apps-do-bot.ts";
import type { Conn, Escopo, Tx } from "../shared/types.ts";
import { jsonb, ms } from "./conversao.ts";

interface LinhaApp {
  id: string;
  agente_id: string;
  nome: string;
  icone: string;
  fonte: string;
  fonte_ref: string | null;
  forma: string;
  quem_ve: string;
  regra_pede: string | null;
  pede_quando: PedeQuando | null;
  dados: RetratoDoApp | null;
  erro_fonte: string | null;
  criado_em: Date;
  atualizado_em: Date;
}

const COLUNAS = "id, agente_id, nome, icone, fonte, fonte_ref, forma, quem_ve, regra_pede, pede_quando, dados, erro_fonte, criado_em, atualizado_em";

const paraApp = (l: LinhaApp): AppDoBot => ({
  id: l.id,
  agenteId: l.agente_id,
  nome: l.nome,
  icone: ehIcone(l.icone) ? l.icone : "app",
  fonte: ehFonte(l.fonte) ? l.fonte : "bot",
  fonteRef: l.fonte_ref,
  forma: ehForma(l.forma) ? l.forma : "lista",
  quemVe: "so_eu",
  regraPede: l.regra_pede,
  pedeQuando: l.pede_quando,
  dados: l.dados,
  erroFonte: l.erro_fonte,
  criadoEm: ms(l.criado_em),
  atualizadoEm: ms(l.atualizado_em),
});

export type NovoApp = { agenteId: string; nome: string; icone: IconeDoApp; fonte: FonteDoApp; fonteRef: string | null; forma: FormaDoApp; quemVe: QuemVe; regraPede: string | null; pedeQuando?: PedeQuando | null };
export type CamposDoApp = Partial<{ nome: string; icone: IconeDoApp; forma: FormaDoApp; fonte: FonteDoApp; fonteRef: string | null; regraPede: string | null; pedeQuando: PedeQuando | null; dados: RetratoDoApp | null; erroFonte: string | null }>;

/**
 * O índice único do nome (apps_do_bot_nome) recusou: outro app vivo do bot já tem esse nome. Só ele (revisão 2 do #626):
 * outro 23505 (a chave primária, outro índice que vier) é erro de verdade e sobe.
 */
export const ehNomeRepetido = (e: unknown): boolean => {
  const x = e as { code?: string; constraint_name?: string } | null;
  return typeof x === "object" && x !== null && x.code === "23505" && x.constraint_name === "apps_do_bot_nome";
};

/**
 * Roda a escrita num SAVEPOINT quando `conn` é uma transação (revisão 2 do #626): sem ele, o 23505 da corrida de duas abas
 * abortava a transação de quem chama (o chat segue no mesmo turno e gravaria a resposta numa transação morta: "current
 * transaction is aborted"). Fora de transação (o pool) cada comando já é a sua própria.
 */
function emSavepoint<T>(conn: Conn, fn: (c: Conn) => Promise<T>): Promise<T> {
  const sp = (conn as Partial<Tx>).savepoint;
  return typeof sp === "function" ? ((conn as Tx).savepoint((s) => fn(s)) as Promise<T>) : fn(conn);
}

/**
 * definido em 2026-11-02 (NOD-445, 0145): os apps do bot e a ordem das páginas. Só primitivas: as regras (nome, limite,
 * ordem) moram em src/domain/apps-do-bot.ts e quem as aplica é src/use-cases/apps-do-bot.ts.
 */
export function appsDoBotRepo(conn: Conn, escopo: Escopo) {
  const dona = (c: Conn = conn) => c`tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId}`;
  return {
    /**
     * definido em 2026-11-02 (revisão 1 do PR #626): trava as páginas do bot até o fim da transação. Quem conta para o
     * limite (o card que cria, o Desfazer) ou lê e regrava a ordem passa por aqui antes de ler: sem ela, dois cards
     * confirmados ao mesmo tempo com 11 apps contavam 11 cada um e o bot ficava com 13
     * (tests/concurrency/apps-limite-corrida.test.ts).
     */
    async travar(agenteId: string): Promise<void> {
      await conn`select pg_advisory_xact_lock(hashtext(${escopo.tenantId}), hashtext(${`paginas:${agenteId}`}))`;
    },
    /** Os apps vivos do bot, na ordem de criação. */
    async doAgente(agenteId: string): Promise<AppDoBot[]> {
      const ls = await conn<LinhaApp[]>`select ${conn.unsafe(COLUNAS)} from apps_do_bot where ${dona()} and agente_id = ${agenteId} and removido_em is null order by criado_em, id`;
      return ls.map(paraApp);
    },
    async buscar(id: string, o: { removido?: boolean } = {}): Promise<AppDoBot | null> {
      const [l] = o.removido
        ? await conn<LinhaApp[]>`select ${conn.unsafe(COLUNAS)} from apps_do_bot where ${dona()} and id = ${id} and removido_em is not null`
        : await conn<LinhaApp[]>`select ${conn.unsafe(COLUNAS)} from apps_do_bot where ${dona()} and id = ${id} and removido_em is null`;
      return l ? paraApp(l) : null;
    },
    /** null = o nome já é de outro app vivo do bot (o índice único, com duas abas criando ao mesmo tempo). */
    async criar(a: NovoApp): Promise<AppDoBot | null> {
      try {
        const [l] = await emSavepoint(conn, (c) => c<LinhaApp[]>`
          insert into apps_do_bot (owner_id, agente_id, nome, nome_chave, icone, fonte, fonte_ref, forma, quem_ve, regra_pede, pede_quando)
          values (${escopo.pessoaId}, ${a.agenteId}, ${a.nome}, ${chaveDoNome(a.nome)}, ${a.icone}, ${a.fonte}, ${a.fonteRef}, ${a.forma}, ${a.quemVe}, ${a.regraPede}, ${a.pedeQuando ? jsonb(c, a.pedeQuando) : null})
          on conflict (tenant_id, owner_id, agente_id, nome_chave) where removido_em is null do nothing
          returning ${c.unsafe(COLUNAS)}`);
        return l ? paraApp(l) : null;
      } catch (e) {
        if (ehNomeRepetido(e)) return null;
        throw e;
      }
    },
    /** null = o app não existe (ou foi removido); "nome_repetido" = o nome novo é de outro app vivo. */
    async salvar(id: string, c: CamposDoApp): Promise<AppDoBot | null | "nome_repetido"> {
      const atual = await this.buscar(id);
      if (!atual) return null;
      const n = { ...atual, ...c };
      // Conferir antes: a violação do índice abortaria a transação inteira (o catch fica para a corrida de duas abas).
      if (await this.nomeTomado(atual.agenteId, n.nome, id)) return "nome_repetido";
      try {
        const [l] = await emSavepoint(conn, (c) => c<LinhaApp[]>`
          update apps_do_bot set nome = ${n.nome}, nome_chave = ${chaveDoNome(n.nome)}, icone = ${n.icone}, forma = ${n.forma}, fonte = ${n.fonte},
            fonte_ref = ${n.fonteRef}, regra_pede = ${n.regraPede}, pede_quando = ${n.pedeQuando ? jsonb(c, n.pedeQuando) : null}, dados = ${n.dados ? jsonb(c, n.dados) : null}, erro_fonte = ${n.erroFonte},
            atualizado_em = clock_timestamp()
          where ${dona(c)} and id = ${id} and removido_em is null
          returning ${c.unsafe(COLUNAS)}`);
        return l ? paraApp(l) : null;
      } catch (e) {
        if (ehNomeRepetido(e)) return "nome_repetido";
        throw e;
      }
    },
    async remover(id: string, agora: number): Promise<AppDoBot | null> {
      const [l] = await conn<LinhaApp[]>`update apps_do_bot set removido_em = ${new Date(agora)} where ${dona()} and id = ${id} and removido_em is null returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraApp(l) : null;
    },
    /**
     * definido em 2026-11-02 (revisão 5 do #626): a retenção dos removidos é um por nome. Apaga os removidos do bot com o
     * mesmo nome (sem acento nem caixa) que não são `fica`, o recém-removido.
     */
    async apagarRemovidosAntigos(agenteId: string, nome: string, fica: string): Promise<number> {
      const r = await conn`delete from apps_do_bot where ${dona()} and agente_id = ${agenteId} and nome_chave = ${chaveDoNome(nome)} and removido_em is not null and id <> ${fica}`;
      return r.count;
    },
    /** null = não estava removido; "nome_repetido" = outro app vivo pegou o nome enquanto este estava fora. */
    async restaurar(id: string): Promise<AppDoBot | null | "nome_repetido"> {
      const fora = await this.buscar(id, { removido: true });
      if (!fora) return null;
      if (await this.nomeTomado(fora.agenteId, fora.nome, id)) return "nome_repetido";
      try {
        const [l] = await emSavepoint(conn, (c) => c<LinhaApp[]>`update apps_do_bot set removido_em = null, atualizado_em = clock_timestamp() where ${dona(c)} and id = ${id} and removido_em is not null returning ${c.unsafe(COLUNAS)}`);
        return l ? paraApp(l) : null;
      } catch (e) {
        if (ehNomeRepetido(e)) return "nome_repetido";
        throw e;
      }
    },
    /** Outro app vivo do bot (não `exceto`) já tem esse nome, sem acento nem caixa. */
    async nomeTomado(agenteId: string, nome: string, exceto: string): Promise<boolean> {
      const [l] = await conn<{ n: number }[]>`select 1 as n from apps_do_bot where ${dona()} and agente_id = ${agenteId} and nome_chave = ${chaveDoNome(nome)} and removido_em is null and id <> ${exceto} limit 1`;
      return l !== undefined;
    },
    /** O app removido do bot com esse nome (sem acento nem caixa), o removido mais recente: o restaurar pelo chat. */
    async removidoPorNome(agenteId: string, nome: string): Promise<AppDoBot | null> {
      const [l] = await conn<LinhaApp[]>`select ${conn.unsafe(COLUNAS)} from apps_do_bot where ${dona()} and agente_id = ${agenteId} and nome_chave = ${chaveDoNome(nome)} and removido_em is not null order by removido_em desc, id limit 1`;
      return l ? paraApp(l) : null;
    },
    /**
     * Todos os apps do bot, vivos e removidos, na ordem de criação do banco (microssegundos, depois id): a base da
     * ordem padrão quando ela precisa dos removidos dentro (o lugar para o Desfazer). `criadoEm` chega em
     * milissegundos; dois apps no mesmo ms empatam no domínio e o sort estável fica com a ordem daqui, por isso
     * vivos e removidos vêm de UMA consulta ordenada, e não de duas listas coladas (CI em máquina rápida, 2026-11-04).
     */
    async todosParaOrdem(agenteId: string): Promise<{ id: string; criadoEm: number }[]> {
      const ls = await conn<{ id: string; criado_em: Date }[]>`select id, criado_em from apps_do_bot where ${dona()} and agente_id = ${agenteId} order by criado_em, id`;
      return ls.map((l) => ({ id: l.id, criadoEm: ms(l.criado_em) }));
    },
    /** Os apps removidos do bot (id e criação), do removido mais recente ao mais antigo (o Desfazer traz de volta). */
    async removidos(agenteId: string): Promise<{ id: string; criadoEm: number }[]> {
      const ls = await conn<{ id: string; criado_em: Date }[]>`select id, criado_em from apps_do_bot where ${dona()} and agente_id = ${agenteId} and removido_em is not null order by removido_em desc, id`;
      return ls.map((l) => ({ id: l.id, criadoEm: ms(l.criado_em) }));
    },
    /** A ordem guardada das páginas do bot (null = nunca reordenou). */
    async ordem(agenteId: string): Promise<string[] | null> {
      const [l] = await conn<{ ordem: string[] }[]>`select ordem from paginas_do_bot where ${dona()} and agente_id = ${agenteId}`;
      return l?.ordem ?? null;
    },
    /** Grava a ordem inteira (vale a última: duas abas reordenando ao mesmo tempo não se misturam). */
    async gravarOrdem(agenteId: string, ordem: readonly string[]): Promise<void> {
      await conn`
        insert into paginas_do_bot (owner_id, agente_id, ordem) values (${escopo.pessoaId}, ${agenteId}, ${conn.array([...ordem])}::text[])
        on conflict (tenant_id, owner_id, agente_id) do update set ordem = excluded.ordem, atualizado_em = clock_timestamp()`;
    },
  };
}
