import { MODOS_APROVACAO, type ModoAprovacao } from "../contracts/agente.ts";
import type { MotivoAprovacaoManual } from "../contracts/motivos.ts";
import type { ModoTurno } from "../contracts/plano-turno.ts";

/**
 * O modo de aprovação do bot (ADR-059), escolhido pela dona no chip do campo. Duas regras NOMEADAS, como as da
 * ADR-042, porque os alcances são opostos: `modo_automatico` para no arriscado (revisto em 2026-10-01, ADR-066: não para
 * mais depois de conteúdo de fora); `modo_total` não para em nada (revisto em 2026-10-19, ADR-115: até a credencial do Mac
 * passa; só a chave do próprio nod para). Underscore, nunca hífen (CHECK trilha_sem_texto_livre, 0001).
 * A versão sobe quando muda o CONJUNTO de ações que a regra deixa passar (por exemplo, sair um item da lista de
 * arriscados), para a trilha dizer sob qual semântica o bot agiu.
 */
export const REGRA_MODO_AUTOMATICO = "regra:modo_automatico" as const;
export const VERSAO_MODO_AUTOMATICO = 2 as const;
/**
 * definido em 2026-10-18 (plano dos modos de aprovação, 3a): com o revisor ligado o conjunto do automático muda — o
 * arriscado e o envio para fora depois de conteúdo de fora vão ao revisor em vez de parar ou passar direto.
 */
export const VERSAO_MODO_AUTOMATICO_COM_REVISOR = 3 as const;
export const REGRA_MODO_TOTAL = "regra:modo_total" as const;
/**
 * revisto em 2026-10-19 (plano dos modos de aprovação, PR 6; ADR-115): versão 2 — o total passa a rodar também o comando
 * que toca credencial do Mac e a leitura e a gravação de arquivo de credencial (que o hook negava sozinho na versão 1).
 */
export const VERSAO_MODO_TOTAL = 2 as const;
/** ADR-115: a ação que o revisor liberou fecha por esta regra (trilha e desfecho da decisão). */
export const REGRA_REVISOR = "regra:revisor" as const;
export const VERSAO_REGRA_REVISOR = 1 as const;
export type RegraDoModo = typeof REGRA_MODO_AUTOMATICO | typeof REGRA_MODO_TOTAL;

/**
 * definido em 2026-10-20 (NOD-316, decisão do Marlon na NOD-231; emenda da ADR-059 §1): todo bot nasce em Aprovar
 * automaticamente — novo (tela, `criar_bots`, lote, onboarding, o Nod) ou duplicado, sem herdar o modo do original.
 * A dona muda em Aprovações. O INSERT de `agentes.repo.criar` grava esta constante e o DEFAULT da coluna (0095) é o mesmo.
 */
export const MODO_APROVACAO_INICIAL: ModoAprovacao = "automatico";

/** Nomes que a pessoa lê no menu, na linha da conversa e no prompt. */
export const ROTULO_MODO: Readonly<Record<ModoAprovacao, string>> = {
  manual: "Aprovar manualmente",
  automatico: "Aprovar automaticamente",
  total: "Ignorar todas as aprovações",
};

/**
 * O que cada modo faz, dito à pessoa: a descrição do menu do botão (web/telas/aprovacoes.ts, que não importa valores
 * de src e repete as frases — tests/unit/web/aprovacoes.test.ts confere que são iguais) e a linha gravada na troca.
 * revisto em 2026-10-18 (Fase 4, PR 2): o texto dizia que o automático para depois de ler a web ou um e-mail; desde
 * a ADR-066 não para. As frases descrevem o que a regra de hoje faz (`decidirPeloModo`); as do revisor entram com ele.
 * revisto em 2026-10-19 (Fase 4, PR 6): a do total é a do protótipo — ele roda até o que usa as credenciais do Mac, e o
 * que fez fica na Atividade.
 */
export const DESCRICAO_MODO: Readonly<Record<ModoAprovacao, string>> = {
  manual: "Pede você antes de tudo que muda algo: commit, push, mensagem, arquivo fora da pasta.",
  automatico: "Roda sem perguntar o que não for arriscado. Para no arriscado e no que tocar uma credencial do Mac.",
  total: "Faz tudo sem perguntar, até comandos com as credenciais do seu Mac. O que ele fez fica na Atividade.",
};

/**
 * O Automático com o revisor ligado (definido em 2026-10-26, plano dos modos de aprovação, PR 4; tela "Main" do
 * protótipo). Sem "na sua IA" nem "na sua conta": desde 25/10 o revisor roda no servidor do nod (ADR-115, "Revisor no
 * servidor"). Com a chave desligada vale `DESCRICAO_MODO.automatico`, que é o que acontece de fato.
 */
export const DESCRICAO_AUTOMATICO_COM_REVISOR = "Roda o que você pediu. Um revisor confere cada ação arriscada: libera sozinho ou pede o seu ok num cartão.";

/** A descrição do modo que vale agora: o Automático muda com a chave do revisor. */
export function descricaoDoModo(modo: ModoAprovacao, revisor: boolean): string {
  return modo === "automatico" && revisor ? DESCRICAO_AUTOMATICO_COM_REVISOR : DESCRICAO_MODO[modo];
}

/**
 * definido em 2026-11-02 (NOD-443, ADR-143, revisão 3 do PR #628): o turno é a pedido de OUTRA PESSOA quando a
 * procuração (`sob_procuracao_de`) não é a dona da conta que executa (`conta_de_execucao`, o owner do turno). Hoje só o
 * pedido de quem participa do quadro abre um turno assim: o bot da dona trabalha sob a procuração do membro. O pedido de
 * colega (pedir_a_bot) e o entre pessoas (ADR-058) nascem com a procuração = a dona do escopo, e não entram aqui.
 */
export function aPedidoDeOutraPessoa(sobProcuracaoDe: string | null | undefined, contaDeExecucao: string): boolean {
  return !!sobProcuracaoDe && sobProcuracaoDe !== contaDeExecucao;
}

/**
 * O modo que vale NESTE turno (NOD-443, ADR-143, revisão 3 do PR #628): no turno a pedido de outra pessoa, o manual,
 * qualquer que seja o modo que a dona escolheu. O "automático" e o "total" são a confiança da dona no PRÓPRIO pedido; o
 * membro do quadro não herda isso (confused deputy). A ADR-066 já dizia: "Pedido de outra pessoa: sempre passa por você,
 * em qualquer modo". Todo leitor do modo em runtime passa por aqui com a autoria do plano.
 */
export function modoNoTurno(modo: ModoAprovacao | null | undefined, autoria: { sob_procuracao_de: string | null; conta_de_execucao: string } | null | undefined): ModoAprovacao | undefined {
  if (autoria && aPedidoDeOutraPessoa(autoria.sob_procuracao_de, autoria.conta_de_execucao)) return "manual";
  return modo ?? undefined;
}

export function ehModoAprovacao(x: unknown): x is ModoAprovacao {
  return typeof x === "string" && (MODOS_APROVACAO as readonly string[]).includes(x);
}

/**
 * A pessoa está falando com o bot neste turno? (definido em 2026-09-30, emenda da ADR-059). Conversa e criação,
 * inclusive as retomadas delas; rotina, sala e pedido de colega não. No automático, apagar num app e merge que a
 * pessoa pediu na conversa saem sem card — a Clarice parou para excluir 50 tasks que o Marlon tinha acabado de
 * pedir. A lista de arriscados do TERMINAL não usa isto: ali o risco é a máquina, não o escopo do pedido.
 */
export function conversaComAPessoa(modoTurno: ModoTurno | undefined): boolean {
  return modoTurno === "conversa" || modoTurno === "criacao";
}

/** O que o servidor sabe da ação na hora de decidir, já calculado por quem chama. */
export type SituacaoDaAcao = {
  /** `comandoArriscado` no terminal; `acaoArriscadaNoApp` no conector. */
  arriscada: boolean;
  /** O comando toca uma credencial do Mac (`tocaCredencial`), ou é o arquivo de credencial que o hook mandou ao servidor. */
  credencial: boolean;
  /** A credencial é a chave do próprio nod (`tocaChaveDoNod`): pede a pessoa até no total (PR 6). */
  chaveDoNod?: boolean;
  /** Só pesa com o revisor ligado: escrita num app que não é ler nem apagar, todo MCP da pessoa, `enviaPeloTerminal`. */
  envioParaFora?: boolean;
  /** Só pesa com o revisor ligado: o turno, ou outro turno da conversa nas últimas 24 h, leu conteúdo de fora. */
  contaminado?: boolean;
};

export type DecisaoSemRevisor =
  | { automatico: true; regra: RegraDoModo; versao: number }
  | { automatico: false; motivo: MotivoAprovacaoManual };
/** O terceiro desfecho (ADR-115): a ação vai ao revisor. Cada chamador diz o que faz com ele (`semRevisor`). */
export type DecisaoDoModo = DecisaoSemRevisor | { revisar: true; gatilho: GatilhoDeRevisao };

/**
 * O que o modo decide sobre uma ação que, no manual, pediria a pessoa. `null` = modo manual: vale a regra de sempre,
 * sem mudança nenhuma.
 *
 * Revisor DESLIGADO (`revisor` falso, o padrão; a chave `NOD_REVISOR`): a regra de hoje, byte a byte, e `envioParaFora`
 * e `contaminado` não pesam. Ordem fechada, tudo que para antes do que aprova:
 *
 *  1. credencial do Mac      → para no automático; no total, só a chave do próprio nod para
 *  2. total                  → aprova (até a credencial do Mac)
 *  3. arriscada              → para
 *  4. automático             → aprova
 *
 * revisto em 2026-10-01 (ADR-066, "o bot tem o que você deu; o modo decide"): saíram a trava herdada da rotina de
 * outro bot e a parada depois de conteúdo de fora. O Marlon decidiu: depois de ler algo de fora, o manual pede, e o
 * automático e o total seguem sem pedir. A trava herdada vira, no manual, a marca de conteúdo de fora que passa
 * de quem pediu para quem recebe (pedir-a-bot.ts). A ordem é igual em toda origem de turno.
 *
 * revisto em 2026-10-19 (plano dos modos de aprovação, PR 6; ADR-115, emenda da ADR-055 §3 e da ADR-059): o total
 * aprova também a credencial do Mac — "Ignorar todas as aprovações" de verdade, decisão do Marlon de 18/10. A credencial
 * deixa de ser cerca no total; o que ele roda vai para a Atividade (`acoes_pelo_modo`). A chave do próprio nod continua
 * parando (não é credencial da pessoa: é a da máquina falando com o servidor). Reverter o PR 6 é voltar esta linha.
 *
 * Revisor LIGADO (definido em 2026-10-18, plano dos modos de aprovação, 3a; ADR-115): o total segue igual; no automático,
 * credencial é cartão sem revisor (decisão do Marlon), e o resto segue `gatilhoDeRevisao` — arriscada ou envio para fora
 * depois de conteúdo de fora → `revisar`; senão aprova, na versão 3.
 *
 * Quem chama só consulta o modo onde o manual pediria a pessoa: leitura, "o resto desta tarefa" e as regras da
 * ADR-042 continuam valendo antes, e o que o modo não muda (sem plano, origem sensível, concessão) vem antes dele.
 */
export function decidirPeloModo(modo: ModoAprovacao | undefined, s: SituacaoDaAcao, revisor = false): DecisaoDoModo | null {
  if (!modo || modo === "manual") return null;
  if (s.credencial && (modo !== "total" || s.chaveDoNod === true)) return { automatico: false, motivo: "toca_credencial" };
  if (modo === "total") return { automatico: true, regra: REGRA_MODO_TOTAL, versao: VERSAO_MODO_TOTAL };
  if (!revisor) {
    if (s.arriscada) return { automatico: false, motivo: "acao_arriscada" };
    return { automatico: true, regra: REGRA_MODO_AUTOMATICO, versao: VERSAO_MODO_AUTOMATICO };
  }
  const gatilho = gatilhoDeRevisao({ arriscada: s.arriscada, credencial: false, envioParaFora: s.envioParaFora === true, contaminado: s.contaminado === true });
  if (vaiAoRevisor(gatilho)) return { revisar: true, gatilho };
  return { automatico: true, regra: REGRA_MODO_AUTOMATICO, versao: VERSAO_MODO_AUTOMATICO_COM_REVISOR };
}

/**
 * Os caminhos SEM revisor na v1 (plano, 3a): rotina e acesso pelo modo, o pré-voo da rotina, o `gerir_bots` do Nod e o
 * `esperar_comando`. Neles "revisar" vira o cartão de hoje: o arriscado para (`acao_arriscada`) e o envio depois de
 * conteúdo de fora também (no `esperar_comando`, que não abre cartão, o comando não roda por ali).
 */
export function semRevisor(d: DecisaoDoModo | null): DecisaoSemRevisor | null {
  if (d === null || !("revisar" in d)) return d;
  return { automatico: false, motivo: "acao_arriscada" };
}

/** A ação vai ao revisor do Automático novo por um destes motivos (plano dos modos de aprovação, Parte 3a). */
export type GatilhoDeRevisao = "arriscado" | "envio_apos_fora";

/**
 * O que o Automático novo faz com a ação: `credencial` é cartão direto, sem revisor; os outros dois vão ao revisor.
 * definido em 2026-10-18 (decisão do Marlon sobre a decisão em aberto 5 do plano): credencial no Automático é sempre
 * cartão na v1, em turno limpo ou não — o "turno limpo" não vê a leitura pelo Bash nem o e-mail lido no turno anterior.
 */
export type GatilhoDoAutomatico = "credencial" | GatilhoDeRevisao;

/** O que o Automático novo precisa saber além da `SituacaoDaAcao`. */
export type SituacaoParaRevisao = SituacaoDaAcao & {
  /** Escrita num app que não é ler nem apagar, todo MCP da pessoa (ADR-103) e `enviaPeloTerminal` no terminal. */
  envioParaFora: boolean;
  /** O turno, ou outro turno da mesma conversa nas últimas 24 h, leu conteúdo de fora (revisão de engenharia, item 11). */
  contaminado: boolean;
};

export function vaiAoRevisor(g: GatilhoDoAutomatico | null): g is GatilhoDeRevisao {
  return g === "arriscado" || g === "envio_apos_fora";
}

/**
 * O gatilho do Automático novo para uma ação que, no manual, pediria a pessoa. Puro e sem modo: o PR 1 do plano mede
 * quantas revisões ele faria em TODO bot, e o PR 3 o chama de dentro de `decidirPeloModo` no ramo do automático (uma
 * fonte só para o gatilho, revisão de engenharia, item 24). Ordem fechada:
 *
 *  1. credencial                    → `credencial` (cartão, nunca o revisor)
 *  2. arriscada                     → `arriscado`
 *  3. envio para fora e contaminado → `envio_apos_fora`
 *  4. senão                         → null (o Automático roda sem perguntar)
 *
 * `arriscada` aqui é a de quem chama SEM o alívio da conversa (`conversaComAPessoa`): no Automático novo o apagar pedido na
 * conversa também vai ao revisor (o A4 do protótipo). Ainda não muda decisão nenhuma.
 */
export function gatilhoDeRevisao(s: SituacaoParaRevisao): GatilhoDoAutomatico | null {
  if (s.credencial) return "credencial";
  if (s.arriscada) return "arriscado";
  if (s.envioParaFora && s.contaminado) return "envio_apos_fora";
  return null;
}
