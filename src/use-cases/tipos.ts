import type { EfeitoAposCommit } from "../contracts/acoes.ts";
import type { RuntimeEvent } from "../contracts/evento.ts";
import type { Quadro } from "../contracts/quadro.ts";
import type { AvisoComVoce } from "../contracts/quadro-pessoas.ts";
import type { SituacaoConta } from "../contracts/ferramentas-conta.ts";
import type { ServicesNod, UseCasesNod as UseCasesNodContrato } from "../contracts/servicos.ts";
import type { Repos } from "../repositories/tipos.ts";
import type { Escopo, Relogio, Transacao, Tx } from "../shared/types.ts";

/** `Services` concreto: o contrato genérico de src/contracts/servicos.ts fixado em `Tx` (EMENDA 18). */
export type Services = ServicesNod<Tx>;

/**
 * Dependências de todo caso de uso (Práticas §1): repos, services, tx como FÁBRICA, escopo e relógio.
 * `useCases` são as implementações das nove ferramentas nod, para chamar-ferramenta.ts despachar
 * por tabela (EMENDA 5). A rota/serviço grava `events` via repos.events.gravarComOutbox na MESMA tx.
 */
export interface Deps {
  repos: Repos;
  services: Services;
  useCases: UseCasesNod;
  tx: Transacao;
  escopo: Escopo;
  agora: Relogio;
  /** Fuso da pessoa enquanto ainda não há preferência individual persistida. */
  fusoPadrao?: string;
  /**
   * NOD-391 (ADR-135 §4): agenda um efeito fora do banco para DEPOIS do commit desta transação (desligar o computador
   * do bot excluído). Ausente = quem montou os Deps não roda efeito pós-commit (o efeito se perde, como antes).
   */
  aposCommit?: (efeito: EfeitoAposCommit) => void;
  /**
   * O modelo do bot criado sem modelo pelo `bots.criar` (NOD_MODELO; ausente = "auto"). Mora nos Deps para a tela e o
   * lote do Nod criarem com o mesmo padrão (NOD-391, QA do #563).
   */
  modeloPadrao?: string;
  /**
   * NOD-351: a situação da conta da pessoa do escopo (situacaoDaConta, na transação do turno), para abrir_conta escolher o cartão. Ausente =
   * contas desligadas (NOD_CONTAS≠1): a ferramenta volta sem cartão, `indisponivel`.
   */
  situacaoConta?: () => Promise<SituacaoConta>;
  /**
   * NOD-443 (ADR-143, "a porta é a dona"): roda `fn` no escopo da dona do quadro `quadroId`, na MESMA transação (o escopo
   * volta ao da pessoa no fim, com erro ou sem). A porta confere sozinha (revisão 1, achado 3): a participação da pessoa
   * do escopo, lida no escopo dela e de novo no da dona, e o quadro; sem isso lança nao_encontrado e `fn` não roda. `fn`
   * recebe os deps da dona (sem a porta: não se abre uma dentro da outra) e o quadro. Os eventos de `fn` são gravados
   * dentro (o outbox é da dona). Ausente = quem montou os Deps não abre a porta: o quadro de outra pessoa não é achado.
   */
  quadroDaDona?: <T>(quadroId: string, fn: (deps: Deps, q: Quadro) => Promise<T>) => Promise<T>;
  /**
   * NOD-443 (revisão 1, achado 5; revisão 3, achado 7): a volta, só para avisar. Grava o aviso de "Com você" na conversa
   * do bot de quem participa de um quadro da pessoa do escopo (conferido no escopo dela), no escopo de quem participa, na
   * mesma transação, e volta. Não roda código do chamador lá dentro: a mensagem é fixa (src/db/porta-da-dona.ts).
   * false = não participa, o bot não é dela ou o aviso já estava lá.
   */
  avisoComVoce?: (quadroId: string, pessoaId: string, aviso: AvisoComVoce) => Promise<boolean>;
}

/**
 * Revisão 3 do PR #630: o gerir_quadro em fases (o importar_time_linear busca a prévia do Linear fora da transação) também
 * vem injetado, como o caso inteiro. Opcional: sem ele, o chamar-ferramenta usa o `gerirQuadro` direto (a busca na tx).
 */
export type UseCasesNod = UseCasesNodContrato<Deps> & { gerirQuadroEmFases?: typeof import("./gerir-quadro.ts").gerirQuadroEmFases };

export type CasoDeUso<I, O> = (deps: Deps, input: I) => Promise<{ data: O; events?: RuntimeEvent[] }>;
