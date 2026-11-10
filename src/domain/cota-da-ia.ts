import type { CotaDaIa, CotaDto, SituacaoDaCota } from "../contracts/cota.ts";
import { HARNESSES, type IdHarness } from "../contracts/harness.ts";
import type { EpochMs } from "../contracts/ids.ts";
import type { LimitesIa } from "../contracts/inteligencia.ts";
import type { OrigemTurno } from "../contracts/turno.ts";
import type { JanelaDoPlano, UsoDoPlano } from "../contracts/uso-do-plano.ts";
import type { IaComConta } from "../contracts/contas-ia.ts";
import { contaDoTurno, type ContaDaPessoa } from "./contas-da-pessoa.ts";
import { quandoDaFrase } from "./erro-fornecedor.ts";
import { harnessFixado } from "./harness.ts";
import { iasParaOAutomatico, PRAZO_LIMITE_SEM_HORARIO_MS } from "./inteligencia.ts";

/**
 * A cota da IA como portão do trabalho de fundo (definido em 2026-10-12, ADR-099 §7; decisão do Marlon em 12/10). Puro:
 * `agora` por parâmetro. A leitura é a que o próprio CLI manda a cada turno (`rate_limit_event` do Claude Code, gravado em
 * `uso_do_plano`, NOD-179) e o limite que o turno devolveu (`preferencias.ias_no_limite`, 0068). O `reivindicar`
 * (turnos.repo.ts) repete esta regra em SQL; tests/integration/cota-da-ia.test.ts confere as duas.
 */

/** definido em 2026-10-12 (decisão do Marlon): 1% da cota fica para a conversa com a pessoa. */
export const COTA_RESERVADA_PARA_A_CONVERSA = 0.01;
/** A partir daqui (99%), trabalho novo de fundo para de nascer. */
export const LIMIAR_DA_RESERVA = 1 - COTA_RESERVADA_PARA_A_CONVERSA;
/**
 * Uma janela sem horário de renovação (o CLI não disse) vale 1 h desde a leitura, o mesmo prazo do limite sem horário
 * (PRAZO_LIMITE_SEM_HORARIO_MS): depois disso a IA volta a ser tentada e o próximo turno traz a leitura nova.
 */
export const LEITURA_SEM_HORARIO_VALE_MS = PRAZO_LIMITE_SEM_HORARIO_MS;

/** Até quando a janela vale: a renovação que o CLI disse, ou 1 h depois da leitura. Já passou = a janela renovou. */
function vigenteAte(j: JanelaDoPlano, medidoEm: EpochMs): EpochMs {
  return j.renovaEm ?? medidoEm + LEITURA_SEM_HORARIO_VALE_MS;
}

const PESO: Record<SituacaoDaCota, number> = { livre: 0, reserva: 1, limite: 2 };

/**
 * As IAs da pessoa que seguram trabalho de fundo agora. `limite` vem do limite gravado (o sinal do fornecedor no turno),
 * de uma janela em 100% ou da última leitura "esgotado"; `reserva`, de uma janela em 99% ou mais. Janela renovada
 * (o horário passou) não conta: a leitura velha não segura nada. `voltaEm` é a última renovação entre o que segura —
 * o trabalho de fundo novo só volta quando a IA sai do limite E da reserva; janela sem horário conta 1 h desde a leitura.
 */
export function cotaDasIas(p: { usos: readonly UsoDoPlano[]; limites: LimitesIa | null | undefined; agora: EpochMs }): CotaDaIa[] {
  const porIa = new Map<IdHarness, { situacao: SituacaoDaCota; voltaEm: EpochMs }>();
  for (const [ia, l] of Object.entries(p.limites ?? {}) as [IdHarness, { renovaEm: number } | undefined][]) {
    if (l && l.renovaEm > p.agora) marcar(porIa, ia, "limite", l.renovaEm);
  }
  for (const u of p.usos) lerUso(porIa, u.harness, u, p.agora);
  return [...porIa.entries()]
    .filter(([, c]) => c.situacao !== "livre")
    .map(([ia, c]) => ({ ia, situacao: c.situacao as CotaDaIa["situacao"], voltaEm: c.voltaEm }))
    .sort((a, b) => a.ia.localeCompare(b.ia));
}

function marcar<K>(m: Map<K, { situacao: SituacaoDaCota; voltaEm: EpochMs }>, chave: K, situacao: SituacaoDaCota, voltaEm: EpochMs): void {
  const atual = m.get(chave) ?? { situacao: "livre" as SituacaoDaCota, voltaEm };
  m.set(chave, { situacao: PESO[situacao] > PESO[atual.situacao] ? situacao : atual.situacao, voltaEm: Math.max(atual.voltaEm, voltaEm) });
}

/** Uma leitura do CLI: janela em 100% ou "esgotado" = limite; em 99% ou mais = reserva. Janela renovada não conta. */
function lerUso<K>(m: Map<K, { situacao: SituacaoDaCota; voltaEm: EpochMs }>, chave: K, u: UsoDoPlano, agora: EpochMs): void {
  const janelas = [u.cincoHoras, u.semana].filter((j): j is JanelaDoPlano => j !== null);
  const vigentes = janelas.filter((j) => vigenteAte(j, u.medidoEm) > agora);
  for (const j of vigentes) {
    if (j.utilizacao >= 1) marcar(m, chave, "limite", vigenteAte(j, u.medidoEm));
    else if (j.utilizacao >= LIMIAR_DA_RESERVA) marcar(m, chave, "reserva", vigenteAte(j, u.medidoEm));
  }
  // "esgotado" (status `rejected`) sem janela em 100%: vale 1 h desde a leitura, ou até a janela mais longa que ainda
  // não renovou. Depois, o próximo turno diz (e o limite que ele devolver traz o horário do fornecedor).
  if (u.situacao === "esgotado" && u.medidoEm + LEITURA_SEM_HORARIO_VALE_MS > agora && !vigentes.some((j) => j.utilizacao >= 1)) {
    marcar(m, chave, "limite", Math.max(u.medidoEm + LEITURA_SEM_HORARIO_VALE_MS, ...vigentes.map((j) => vigenteAte(j, u.medidoEm))));
  }
}

/**
 * definido em 2026-10-15 (NOD-253): a cota de cada CONTA da lista, pelas leituras que os turnos dela trouxeram
 * (`uso_do_plano_contas`, 0077). Só as contas que seguram (reserva ou limite); a leitura sem conta é ignorada.
 */
export type CotaDaConta = { situacao: Exclude<SituacaoDaCota, "livre">; voltaEm: EpochMs };

export function cotaDasContas(p: { usos: readonly UsoDoPlano[]; agora: EpochMs }): Map<string, CotaDaConta> {
  const porConta = new Map<string, { situacao: SituacaoDaCota; voltaEm: EpochMs }>();
  for (const u of p.usos) if (u.contaId) lerUso(porConta, u.contaId, u, p.agora);
  return new Map([...porConta.entries()].filter((e): e is [string, CotaDaConta] => e[1].situacao !== "livre"));
}

/**
 * As contas como o turno de `tipo` as vê pela cota: a que a cota segura para esse tipo fica "no limite" até a janela dela
 * renovar (a conversa com a pessoa não é segurada: vê as contas como são).
 */
export function contasPelaCota<T extends ContaDaPessoa>(contas: readonly T[], porConta: ReadonlyMap<string, CotaDaConta>, tipo: TipoParaCota): T[] {
  return contas.map((c) => {
    const s = porConta.get(c.id);
    return s && cotaSegura(tipo, s.situacao) ? { ...c, noLimiteAte: Math.max(c.noLimiteAte ?? 0, s.voltaEm) } : c;
  });
}

/** As contas da lista que a máquina tem logadas, com as escolhas da pessoa (lerContasDaMaquina). ADR-108: sem o modo. */
export type ContasParaCota = {
  contas: readonly ContaDaPessoa[];
  naMaquina: ReadonlySet<string>;
  escolhidas: Partial<Record<IaComConta, string>>;
};

/**
 * definido em 2026-10-15 (NOD-253, decisão da NOD-221): a cota das IAs olhando a CONTA que o turno usaria. A IA com conta
 * da lista logada na máquina segura o fundo só quando nenhuma conta dela serve sem a pessoa decidir (as regras da lista:
 * desde a ADR-108 a fila: a primeira livre na fila, a escolhida, ou sem fila a primeira da IA) — a Max no limite não segura mais o
 * fundo do Claude com a Team livre. A leitura por IA (`uso_do_plano`) e o limite por IA (`ias_no_limite`) dessa IA não
 * contam: a leitura é da conta que rodou. A IA sem conta na máquina (motor, app antigo) segue a regra de antes.
 */
export function cotaDasIasComContas(p: {
  usos: readonly UsoDoPlano[];
  usosPorConta: readonly UsoDoPlano[];
  limites: LimitesIa | null | undefined;
  contas: ContasParaCota | null;
  agora: EpochMs;
}): CotaDaIa[] {
  const daMaquina = p.contas ? p.contas.contas.filter((c) => c.removidaEm === null && p.contas!.naMaquina.has(c.id)) : [];
  const governadas = new Set<string>(daMaquina.map((c) => c.ia));
  if (!p.contas || governadas.size === 0) return cotaDasIas(p);
  const limites = Object.fromEntries(Object.entries(p.limites ?? {}).filter(([ia]) => !governadas.has(ia))) as LimitesIa;
  const base = cotaDasIas({ usos: p.usos.filter((u) => !governadas.has(u.harness)), limites, agora: p.agora });
  const porConta = cotaDasContas({ usos: p.usosPorConta, agora: p.agora });
  const ver = (tipo: TipoParaCota) => contaDoTurno({ ...p.contas!, contas: contasPelaCota(p.contas!.contas, porConta, tipo), ordemDoBot: null, agora: p.agora });
  const noLimite = ver("fundo_seguindo");
  const naReserva = ver("fundo_novo");
  const extra: CotaDaIa[] = [];
  for (const ia of governadas as Set<IaComConta>) {
    const situacao = !noLimite?.porIa[ia] ? "limite" : !naReserva?.porIa[ia] ? "reserva" : null;
    if (!situacao) continue;
    // Volta quando a primeira conta dela renova (a nota diz qual; antes disso, a pessoa pode escolher outra).
    const voltas = contasPelaCota(daMaquina.filter((c) => c.ia === ia), porConta, situacao === "limite" ? "fundo_seguindo" : "fundo_novo")
      .map((c) => c.noLimiteAte).filter((t): t is number => t !== null && t > p.agora);
    extra.push({ ia, situacao, voltaEm: voltas.length > 0 ? Math.min(...voltas) : p.agora + LEITURA_SEM_HORARIO_VALE_MS });
  }
  return [...base, ...extra].sort((a, b) => a.ia.localeCompare(b.ia));
}

/** A situação de UMA IA (livre quando não segura nada). */
export function situacaoDaIa(cota: readonly CotaDaIa[], ia: string): SituacaoDaCota {
  return cota.find((c) => c.ia === ia)?.situacao ?? "livre";
}

/**
 * O que o turno é para a cota:
 * - `conversa`: a conversa com a pessoa — a fala dela (conversa, sala), a retomada que ela pediu e a ligação. Nunca segura;
 * - `fundo_novo`: trabalho de fundo que ainda não começou — uma task (frente) que nunca rodou, de qualquer origem, e o
 *   turno de rotina ou de pedido de colega sem task;
 * - `fundo_seguindo`: o próximo turno de um trabalho de fundo que já começou, e a volta marcada (`me_chame_as`).
 */
export type TipoParaCota = "conversa" | "fundo_novo" | "fundo_seguindo";

export function tipoParaCota(
  t: { origem: OrigemTurno; trabalhoId?: string | null; acordarEm?: number | null; pessoaEsperando?: boolean; decididoPor?: string | null },
  trabalho: { iniciadoEm: number | null } | null,
): TipoParaCota {
  // NOD-272 (ADR-085): "Testar agora" e "Permitir e rodar agora" — e as frentes que eles abrem — são a pessoa olhando.
  if (t.origem === "ligacao" || t.pessoaEsperando === true) return "conversa";
  if (t.trabalhoId) return trabalho && trabalho.iniciadoEm === null ? "fundo_novo" : "fundo_seguindo";
  if (t.origem === "rotina" || t.origem === "delegacao" || t.origem === "peer") return "fundo_novo";
  // NOD-258: o retorno do lote é o fim de um trabalho de fundo que já rodou — passa na reserva, espera no limite.
  if (t.decididoPor === RETORNO_DO_LOTE) return "fundo_seguindo";
  return t.acordarEm != null ? "fundo_seguindo" : "conversa";
}

/**
 * definido em 2026-10-15 (NOD-258): a marca do retorno do lote em `turnos.decidido_por` (fechar-lote.ts, devolverAoDono).
 * Sem coluna nova: o portão da cota (SQL do `reivindicar`) e `ehFundo` a leem; a volta da cota a herda.
 */
export const RETORNO_DO_LOTE = "regra:retorno-do-lote";

/**
 * definido em 2026-10-15 (NOD-274, NOD-258, NOD-269; decisão NOD-222): o turno é trabalho de fundo — espera a cota com
 * `acordar_em` em vez de falhar, decidido pelo TIPO do turno e não pela origem. Fundo = tem task (de qualquer origem,
 * inclusive a frente que a pessoa abriu na conversa), é rotina ou pedido de colega, ou é o retorno do lote. A ligação
 * nunca é fundo (a pessoa está na linha). Substitui os testes por origem no despacho (semContaNaMaquina) e no
 * assentamento (aposLimiteDaConta, aposLimiteNoFundo).
 */
export function ehFundo(t: { origem: OrigemTurno; trabalhoId?: string | null; decididoPor?: string | null }): boolean {
  if (t.origem === "ligacao") return false;
  if (t.trabalhoId) return true;
  if (t.origem === "rotina" || t.origem === "delegacao" || t.origem === "peer") return true;
  return t.decididoPor === RETORNO_DO_LOTE;
}

/** A regra: no limite, todo o fundo espera; na reserva, só o fundo novo. A conversa com a pessoa sempre passa. */
export function cotaSegura(tipo: TipoParaCota, situacao: SituacaoDaCota): boolean {
  if (tipo === "conversa" || situacao === "livre") return false;
  return situacao === "limite" || tipo === "fundo_novo";
}

/**
 * A situação da cota para o turno pela IA dele: fixado numa IA, a dela; no Automático, a MENOS segurada entre as IAs que
 * podem pegá-lo (`iasDoAutomatico`) — o plano escolhe essa (emitir-plano-turno.ts põe as que seguram no `noLimite` do
 * trabalho de fundo). Sem nenhuma, livre: o despacho recusa por outro motivo.
 */
export function situacaoDoTurno(t: { harness: string; modelo: string }, cota: readonly CotaDaIa[], iasDoAutomatico: readonly string[]): SituacaoDaCota {
  const fixo = harnessFixado(t.harness, t.modelo);
  if (fixo) return situacaoDaIa(cota, fixo);
  if (iasDoAutomatico.length === 0) return "livre";
  return iasDoAutomatico.map((ia) => situacaoDaIa(cota, ia)).reduce((a, b) => (PESO[b] < PESO[a] ? b : a));
}

/**
 * O que o `reivindicar` recebe: as IAs que seguram o fundo novo (reserva ou limite), as que seguram todo o fundo (limite) e
 * o mesmo para o turno do Automático, pelas IAs que podem pegá-lo nesta máquina. null = nada segura (o SQL fica igual).
 */
export type PortaoDaCota = { reserva: string[]; limite: string[]; autoReserva: boolean; autoLimite: boolean };

export function portaoDaCota(cota: readonly CotaDaIa[], iasDoAutomatico: readonly string[]): PortaoDaCota | null {
  if (cota.length === 0) return null;
  const auto = situacaoDoTurno({ harness: "auto", modelo: "auto" }, cota, iasDoAutomatico);
  return {
    reserva: cota.map((c) => c.ia),
    limite: cota.filter((c) => c.situacao === "limite").map((c) => c.ia),
    autoReserva: auto !== "livre",
    autoLimite: auto === "limite",
  };
}

/**
 * Para a tela (`GET trabalhos`): a pior situação, as IAs que seguram e quando o fundo volta (a última renovação).
 * null = nada segura.
 */
export function cotaParaTela(cota: readonly CotaDaIa[]): CotaDto | null {
  if (cota.length === 0) return null;
  return {
    situacao: cota.some((c) => c.situacao === "limite") ? "limite" : "reserva",
    ias: cota.map((c) => c.ia),
    voltaEm: Math.max(...cota.map((c) => c.voltaEm)),
  };
}

/**
 * Para a linha da task (`GET trabalhos`): a task aberta, sem turno vivo, que a cota da IA do bot segura agora. Na reserva,
 * só a que nunca começou (o fundo novo); no limite, também a que já começou e espera o próximo turno ou a volta marcada.
 * Quem espera a pessoa (decisão aberta) ou um colega não espera pela cota.
 */
export function esperaDaCotaNaTela(t: { estado: string; iniciadoEm: number | null; turnoVivoId: string | null; esperandoColega?: unknown }, situacao: SituacaoDaCota): boolean {
  if (situacao === "livre" || t.turnoVivoId || t.esperandoColega) return false;
  if (t.estado === "na_fila") return situacao === "limite" || t.iniciadoEm === null;
  return t.estado === "rodando" && situacao === "limite";
}

/**
 * NOD-260 (definido em 2026-10-15, D3): a situação da cota para a linha de um trabalho. "Esperando a cota" só quando
 * nenhuma IA pronta pode pegá-lo — a tela dizia "esperando a cota" com o Codex pronto e livre no Automático.
 * - A IA é a do turno pendente mais antigo (a que vai rodar); sem ele, a de agora do bot; sem nenhum dos dois, "livre".
 * - IA fixa: a situação dela (só ela pega o turno).
 * - Automático: `iasParaOAutomatico` sobre as IAs prontas nas máquinas vivas da pessoa (a regra do despacho); nenhuma
 *   pronta = "livre" (na dúvida, não acusa a cota). `iasProntas` null = não se sabe (serviço de antes): as IAs que a
 *   pessoa já usou (`conhecidas`), como antes.
 */
export function situacaoDaCotaDoTrabalho(p: {
  pendente: { harness: string; modelo: string } | null | undefined;
  bot: { harness: string; modelo: string } | null;
  cota: readonly CotaDaIa[];
  iasProntas: readonly string[] | null;
  noLimite: readonly string[];
  conhecidas: readonly string[];
}): SituacaoDaCota {
  const turno = p.pendente ?? p.bot;
  if (!turno || p.cota.length === 0) return "livre";
  if (harnessFixado(turno.harness, turno.modelo)) return situacaoDoTurno(turno, p.cota, []);
  if (p.iasProntas === null) return situacaoDoTurno(turno, p.cota, p.conhecidas);
  const prontas = [...new Set(p.iasProntas)];
  return situacaoDoTurno(turno, p.cota, iasParaOAutomatico({ prontosMaquina: prontas, prontosPessoa: prontas, noLimite: p.noLimite }));
}

/**
 * As IAs que a pessoa já usou (têm leitura ou limite gravado): no Automático, a tela considera a task segurada só se todas
 * elas seguram — com uma livre, o plano iria por ela. Aproximação da regra do `reivindicar`, que olha as IAs prontas da
 * máquina (a lista não as conhece).
 */
export function iasConhecidas(usos: readonly Pick<UsoDoPlano, "harness">[], limites: LimitesIa | null | undefined): IdHarness[] {
  return [...new Set([...usos.map((u) => u.harness), ...(Object.keys(limites ?? {}) as IdHarness[])])];
}


/**
 * definido em 2026-10-12 (ADR-099 §7, na integração com a parte 1): o começo da entrada da volta que a cota no limite marca
 * (assentar-turno, aposLimiteNoFundo). É o que separa essa volta das que o bot marcou (me_chame_as, esperar_comando): o
 * `turnos.ultimasVoltas` o lê para que ela não conte como "volta sem novidade" (voltas-sem-novidade.ts).
 */
export const ENTRADA_DA_VOLTA_DA_COTA = "[nod] A cota do ";

export function entradaDaVoltaDaCota(nomeDaIa: string): string {
  return `${ENTRADA_DA_VOLTA_DA_COTA}${nomeDaIa} chegou ao limite no meio deste trabalho e o nod esperou ela renovar. Siga de onde parou; o que já saiu antes do limite continua valendo.`;
}

/**
 * definido em 2026-10-20 (NOD-309): o começo da entrada da volta que o ERRO TRANSITÓRIO do provedor marca (assentar-turno,
 * aposErroTransitorioNoFundo) — sobrecarga, 5xx, rede. Prefixo próprio, de propósito: o backoff não é cota, e quem acorda as
 * esperas da cota (anteciparEsperasDaCota, reescreverFundoDoBot, levarTasksDoBot) casa só ENTRADA_DA_VOLTA_DA_COTA. Como a
 * da cota, a volta não é do bot: não conta como volta marcada nem como "volta sem novidade" (turnos.repo).
 */
export const ENTRADA_DA_NOVA_TENTATIVA = "[nod] Nova tentativa: ";

/**
 * NOD-309: a entrada da nova tentativa. Sem sessão retomável, a volta leva o pedido original (entradaDaVolta) — e o texto
 * pede para não repetir o que já saiu: sem trava técnica de idempotência neste escopo, é a instrução que segura (risco
 * aceito no plano).
 */
export function entradaDaNovaTentativa(nomeDaIa: string, tentativa: number, maximo: number): string {
  return `${ENTRADA_DA_NOVA_TENTATIVA}o serviço do ${nomeDaIa} ficou instável no meio deste trabalho e o nod tentou de novo (tentativa ${tentativa} de ${maximo}). Siga de onde parou; o que já saiu continua valendo. Não repita efeito externo que já foi feito (mensagem enviada, item criado ou alterado): confira antes.`;
}

/**
 * definido em 2026-10-20 (NOD-309, PR 3): o começo da entrada da retomada que a QUEDA da infraestrutura marca no fundo —
 * reinício do servidor ou máquina sem contato no meio do turno (interromper-por-maquina, aposQuedaNoFundo). Prefixo próprio
 * pelo mesmo motivo da nova tentativa: não é cota, e "Seguir com"/conta nova não têm o que acordar.
 */
export const ENTRADA_DA_RETOMADA_DA_QUEDA = "[nod] Retomada após queda: ";

/** NOD-309: a entrada da retomada depois da queda. Mesma instrução de não repetir efeito externo (risco aceito no plano). */
export function entradaDaRetomadaDaQueda(motivo: string): string {
  return `${ENTRADA_DA_RETOMADA_DA_QUEDA}este trabalho foi interrompido no meio (${motivo}) e o nod o pôs de volta na fila. Siga de onde parou; o que já saiu continua valendo. Não repita efeito externo que já foi feito (mensagem enviada, item criado ou alterado): confira antes.`;
}

/** Os prefixos das voltas que o nod marca para o fundo (cota, nova tentativa, retomada da queda), nunca uma do bot. */
/**
 * NOD-480 (emenda da ADR-040): a volta do trabalho de fundo cujo histórico enchia de novo logo depois de cada resumo
 * (`autocompact_thrashing`). O nod largou a sessão e recomeçou UMA vez numa nova; o pedido vem junto (entradaDaVoltaDoFundo)
 * e, na frente, a passagem de bastão. Conta como volta do nod, não do bot (PREFIXOS_DA_VOLTA_DO_FUNDO).
 */
export const ENTRADA_DO_RECOMECO_POR_AUTOCOMPACTACAO = "[nod] Sessão nova: ";

export function entradaDoRecomecoPorAutocompactacao(): string {
  return `${ENTRADA_DO_RECOMECO_POR_AUTOCOMPACTACAO}o histórico deste trabalho enchia de novo logo depois de cada resumo e o nod recomeçou numa sessão nova, sem a memória da anterior. Siga de onde parou pelo pedido e pelo resumo; releia só o necessário e prefira saídas curtas (filtre, pagine, grave em arquivo). O que já saiu continua valendo. Não repita efeito externo que já foi feito (mensagem enviada, item criado ou alterado): confira antes.`;
}

export const PREFIXOS_DA_VOLTA_DO_FUNDO = [ENTRADA_DA_VOLTA_DA_COTA, ENTRADA_DA_NOVA_TENTATIVA, ENTRADA_DA_RETOMADA_DA_QUEDA, ENTRADA_DO_RECOMECO_POR_AUTOCOMPACTACAO] as const;

/** NOD-309: a entrada é uma volta que o nod marcou para o fundo, nunca uma do bot. */
export function ehVoltaDoFundo(entradaTexto: string): boolean {
  return PREFIXOS_DA_VOLTA_DO_FUNDO.some((p) => entradaTexto.startsWith(p));
}

const MARCA_DA_TROCA_DE_CONTA = " no meio deste trabalho e o nod seguiu com a conta ";

/**
 * definido em 2026-10-12 (ADR-101, QA do NOD-211): a entrada da volta da task cuja conta parou e o Mac já seguiu com outra
 * conta da mesma IA ("Trocar sozinho"). Começa com ENTRADA_DA_VOLTA_DA_COTA, para contar como a volta da cota (e não como
 * volta sem novidade). Pela posição (ADR-101, o apelido mora no Mac) ou, revisto em 2026-10-28 (NOD-401, ADR-102 item 6:
 * a lista mora no servidor), pelo apelido da fila.
 */
export function entradaDaTrocaDeConta(nomeDaIa: string, de: number | string, para: number | string, jaEsperou = false): string {
  return `${ENTRADA_DA_VOLTA_DA_COTA}${nomeDaIa} chegou ao limite na conta ${de}${MARCA_DA_TROCA_DE_CONTA}${para}${jaEsperou ? MARCA_DA_ESPERA_NA_CADEIA : ""}. Siga de onde parou; o que já saiu antes do limite continua valendo.`;
}

/** NOD-401: a troca de conta numa cadeia que já tinha esperado a cota — a marca segue para a próxima volta. */
const MARCA_DA_ESPERA_NA_CADEIA = " (a cota já tinha sido esperada antes neste trabalho)";

/**
 * NOD-401 (definido em 2026-10-28): a entrada é a de uma troca de conta (seguiu na hora, ninguém esperou). A cadeia que só
 * trocou de conta ainda não avisou a espera: o próximo limite que espera de verdade diz isso na conversa e a quem pediu.
 */
export function ehTrocaDeConta(entradaTexto: string): boolean {
  return entradaTexto.startsWith(ENTRADA_DA_VOLTA_DA_COTA) && cabecaDaEntrada(entradaTexto).includes(MARCA_DA_TROCA_DE_CONTA);
}

/** A parte da entrada que o nod escreveu: antes do pedido original e das falas da pessoa (texto dela não vira marca). */
function cabecaDaEntrada(entradaTexto: string): string {
  const i = [entradaTexto.indexOf(MARCA_DO_PEDIDO_ORIGINAL), entradaTexto.indexOf(MARCA_DA_FALA_NA_FRENTE)].filter((x) => x >= 0).sort((a, b) => a - b)[0];
  return i === undefined ? entradaTexto : entradaTexto.slice(0, i);
}

/**
 * NOD-401 (revisão rodada 4): a cadeia já esperou a cota (e já avisou a espera na conversa e a quem pediu)? A volta do fundo
 * conta; a troca de conta só conta quando leva a marca de que a cadeia esperou antes dela (`entradaDaTrocaDeConta`).
 */
export function cadeiaJaEsperou(entradaTexto: string, prefixo: (texto: string) => boolean): boolean {
  return prefixo(entradaTexto) && (!ehTrocaDeConta(entradaTexto) || cabecaDaEntrada(entradaTexto).includes(MARCA_DA_ESPERA_NA_CADEIA));
}

/**
 * NOD-302 (continuação da NOD-253): a espera de um pedido de fundo pela cota, para quem pediu — "a cota do Claude Code
 * está no fim; o pedido espera na fila até ela renovar, às 14:30". Sem hora (ou já passada), sem hora: nunca uma hora
 * que já foi. Uma frase só para o `pedir_a_bot` (o colega que pediu) e para a linha na conversa de origem (a pessoa).
 */
export function fraseDaEsperaDaCota(p: { ia: string; situacao: Exclude<SituacaoDaCota, "livre">; voltaEm: EpochMs | null; agora: EpochMs }): string {
  const nome = HARNESSES.find((h) => h.id === p.ia)?.nome ?? "IA";
  const estado = p.situacao === "limite" ? "chegou ao limite" : "está no fim";
  const quando = p.voltaEm !== null && p.voltaEm > p.agora ? `, ${quandoDaFrase(p.voltaEm, p.agora)}` : "";
  return `a cota do ${nome} ${estado}; o pedido espera na fila até ela renovar${quando}`;
}

/** O separador que entradaDaVolta põe entre o aviso da volta e o pedido que ela leva. */
export const MARCA_DO_PEDIDO_ORIGINAL = "\n\nPedido original da frente:\n";
/**
 * NOD-376 (definido em 2026-10-27, revisão 5 do PR #539): a fala da pessoa na frente que a volta do fundo leva, com rótulo
 * próprio e sempre por último — nunca como "Pedido original" (a fala não troca o pedido da frente).
 */
export const MARCA_DA_FALA_NA_FRENTE = "\n\nA pessoa escreveu nesta frente e ainda espera a resposta:\n";

/**
 * definido em 2026-10-15 (NOD-269, G2): a entrada da volta da cota. Com sessão retomável (a task já rodou nesta IA), a
 * entrada curta basta: a sessão tem o pedido. Sem ela — o trabalho nunca começou, a sessão é de outra IA, ou não há task
 * (rotina, pedido de colega, retorno do lote) —, a volta acordaria só com "siga de onde parou": anexa o pedido original,
 * lido da RAIZ da cadeia `retoma_turno_id` (nunca da volta anterior, para não aninhar o anexo).
 */
export function entradaDaVolta(p: { base: string; sessaoRetomavel: boolean; pedidoOriginal: string | null }): string {
  if (p.sessaoRetomavel || !p.pedidoOriginal || p.pedidoOriginal.trim() === "") return p.base;
  return `${p.base}${MARCA_DO_PEDIDO_ORIGINAL}${p.pedidoOriginal}`;
}

/**
 * NOD-310: a entrada nova da task levada ("Levar as tasks", ADR-108) guarda o pedido original que a volta já levava
 * (o sufixo depois de MARCA_DO_PEDIDO_ORIGINAL). Antes o UPDATE trocava a entrada inteira e o pedido se perdia.
 */
export function entradaLevadaComPedido(entradaAtual: string, entradaNova: string): string {
  const i = [entradaAtual.indexOf(MARCA_DO_PEDIDO_ORIGINAL), entradaAtual.indexOf(MARCA_DA_FALA_NA_FRENTE)].filter((x) => x >= 0).sort((a, b) => a - b)[0] ?? -1;
  return i >= 0 ? `${entradaNova}${entradaAtual.slice(i)}` : entradaNova;
}

/**
 * NOD-258 (ajuste do QA do PR #340): a entrada a refazer de um retorno do lote. A volta da cota do retorno leva os resumos
 * depois do aviso "[nod] A cota do ..."; refazer a volta que caiu com essa entrada acordava o dono dizendo que a cota
 * tinha batido no limite — a queda é outra. Devolve o pedido que a volta leva (a entrada do retorno de verdade) ou, fora
 * de uma volta da cota, a própria entrada.
 */
export function entradaDoRetornoARefazer(entradaTexto: string): string {
  if (!ehVoltaDoFundo(entradaTexto)) return entradaTexto;
  const i = entradaTexto.indexOf(MARCA_DO_PEDIDO_ORIGINAL);
  return i >= 0 ? entradaTexto.slice(i + MARCA_DO_PEDIDO_ORIGINAL.length) : entradaTexto;
}

/**
 * definido em 2026-10-16 (ADR-108 R4/R5): a entrada da volta da task que o nod LEVOU para outra IA (a pessoa escolheu
 * "Levar as tasks", o prazo da recomendação venceu ou o bot fixo seguiu noutra IA até a volta). Substitui a da espera
 * (que dizia "o nod esperou ela renovar", o que deixaria de ser verdade). Começa com ENTRADA_DA_VOLTA_DA_COTA, para
 * contar como a volta da cota (e não como volta sem novidade). A sessão do CLI ficou na outra IA: a task recomeça do
 * histórico dela, então o texto pede para conferir o estado antes de seguir.
 */
export function entradaDaTrocaDeIa(nomeDe: string, nomePara: string): string {
  return `${ENTRADA_DA_VOLTA_DA_COTA}${nomeDe} chegou ao limite no meio deste trabalho e o nod passou este trabalho para o ${nomePara}. A sessão anterior ficou no ${nomeDe}: confira o estado (arquivos, branch, o que já saiu) e siga de onde parou.`;
}

/**
 * definido em 2026-10-16 (ADR-108, revisão do PR 2, I1): a entrada da volta da task que o nod levou para OUTRA CONTA da
 * mesma IA no ChatGPT — a sessão do Codex mora na pasta da conta, então a task recomeça do histórico. Começa com
 * ENTRADA_DA_VOLTA_DA_COTA, como as outras voltas da cota.
 */
export function entradaDaTrocaDeContaSemSessao(nomeDaIa: string): string {
  return `${ENTRADA_DA_VOLTA_DA_COTA}A conta do ${nomeDaIa} deste trabalho chegou ao limite e o nod passou este trabalho para outra conta do ${nomeDaIa}. A sessão anterior ficou na outra conta: confira o estado (arquivos, branch, o que já saiu) e siga de onde parou.`;
}
