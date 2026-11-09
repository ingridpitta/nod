import { abrirTxEscopada, comPrazoDeConexao, ErroBancoOcupado } from "../../db/tx.ts";
import { log } from "../../obs/log.ts";
import { listarTodas, type Pessoa } from "../../repositories/pessoas.repo.ts";
import type { Db, Escopo, Transacao } from "../../shared/types.ts";

export interface OpcoesLaco {
  /**
   * Fonte das pessoas. Default: `listarTodas(db)` (tabela sem RLS por pessoa, só leitura para
   * nod_app). Injetável para o teste enumerar linhas criadas sob rollback como nod_dono — nunca
   * para pular a tabela em produção.
   */
  listarPessoas?: () => Promise<Pick<Pessoa, "tenantId" | "id">[]>;
  /** Uma pessoa que falha não impede as outras. Default: log sem `message` (ADR-002/004). */
  aoFalhar?: (escopo: Escopo, erro: unknown) => void;
  /** Índice da primeira pessoa da volta, dado o total. Default: sorteado. Injetável só para o teste fixar a ordem. */
  sortearInicio?: (total: number) => number;
  /**
   * definido em 2026-10-28 (NOD-385): chamado depois de cada pessoa (com sucesso ou falha) — o batimento do laço na saúde
   * mede o progresso da volta, não a volta inteira. Só o agendador passa; os outros laços seguem batendo ao fim do tick.
   */
  aoBater?: () => void;
}

const logarFalha = (escopo: Escopo, erro: unknown): void => {
  log("erro", "laco_de_fundo_falhou", {
    tenant_id: escopo.tenantId,
    pessoa_id: escopo.pessoaId,
    erro: erro instanceof Error ? erro.name : "desconhecido",
    // nunca err.message: pode carregar dado da linha (ADR-002/004)
  });
};

/**
 * TODO laço de fundo (scheduler, varredores, despachante do outbox) passa por aqui: lista as
 * pessoas e abre `abrirTxEscopada(db, escopo)` por pessoa — uma transação REAL (BEGIN) por
 * pessoa, nunca um savepoint dentro de outra: o escopo de uma pessoa não pode nascer dentro da
 * transação de outra (ver src/db/tx.ts). Não existe "transação sem pessoa": esquecer o escopo
 * lança escopo_vazio em vez de devolver zero linhas em silêncio (ADR-003 revisado).
 *
 * definido em 2026-10-15 (NOD-266): o primeiro `banco_ocupado` encerra a volta — com o pool esgotado, tentar a próxima
 * pessoa só põe mais um na fila e multiplica o log; a próxima volta do laço tenta de novo. A listagem também tem prazo.
 * Revisão do PR #321: como a volta pode parar no meio, ela começa num ponto sorteado da lista (e dá a volta) — senão,
 * com pressão intermitente, quem está no fim da lista nunca seria atendido.
 */
export async function paraCadaPessoa(
  db: Db,
  fn: (escopo: Escopo, tx: Transacao) => Promise<void>,
  opcoes: OpcoesLaco = {},
): Promise<void> {
  const listar = opcoes.listarPessoas ?? (() => comPrazoDeConexao(listarTodas(db)));
  const aoFalhar = opcoes.aoFalhar ?? logarFalha;
  // QA do PR #321: banco_ocupado na listagem também só encerra a volta (o comPrazoDeConexao já logou). Lançado daqui,
  // virava unhandled rejection nos laços de `setInterval(() => void tick())` e derrubava o processo com o pool cheio.
  let lista: Pick<Pessoa, "tenantId" | "id">[];
  try {
    lista = await listar();
  } catch (e) {
    if (e instanceof ErroBancoOcupado) return;
    throw e;
  }
  const sortear = opcoes.sortearInicio ?? ((total: number) => Math.floor(Math.random() * total));
  const inicio = lista.length > 0 ? sortear(lista.length) % lista.length : 0;
  const pessoas = [...lista.slice(inicio), ...lista.slice(0, inicio)];
  for (const p of pessoas) {
    const escopo: Escopo = { tenantId: p.tenantId, pessoaId: p.id };
    try {
      await fn(escopo, abrirTxEscopada(db, escopo));
    } catch (e) {
      aoFalhar(escopo, e);
      if (e instanceof ErroBancoOcupado) return;
    } finally {
      opcoes.aoBater?.();
    }
  }
}

/** NOD-267: um tick mais longo que o intervalo fica no log, para calibrar os 3 intervalos da saúde. */
export function logarTickLento(laco: string, duracaoMs: number, intervaloMs: number): void {
  if (duracaoMs > intervaloMs) log("aviso", "laco_tick_lento", { laco, duracao_ms: duracaoMs, intervalo_ms: intervaloMs });
}
