import type { ContaLivre, EstadoContaNaMaquina, IaComConta } from "../contracts/contas-ia.ts";
import { IAS_COM_CONTA } from "../contracts/contas-ia.ts";
import type { IdHarness } from "../contracts/harness.ts";
import type { EpochMs } from "../contracts/ids.ts";
import { PRAZO_SEM_HORARIO_MS } from "./contas-da-ia.ts";

/**
 * As contas de IA da pessoa em todas as máquinas (definido em 2026-10-13, ADR-102). Puro: `agora` por parâmetro, o
 * sha256 da impressão é feito por quem chama (ADR-018).
 *
 * As regras da ADR-101 continuam, agora com uma lista só (Claude e ChatGPT intercalados), e desde 2026-10-16 (ADR-108)
 * a lista é a FILA: cada conta tem "na fila" (`entraNaTrocaAutomatica`, para toda conta, pessoal ou corporativa) e o
 * "Perguntar antes"/"Trocar sozinho" saiu.
 *  1. Por IA, a conta em uso é a primeira da IA NA FILA (na ordem da pessoa) logada na máquina do turno e livre; senão a
 *     escolhida pela pessoa ("Seguir com"), se livre — conta fora da fila só entra assim; senão, se nenhuma conta da IA
 *     logada nesta máquina está na fila, a primeira dela aqui, para a pessoa nunca ficar sem IA (E4; é o que a máquina
 *     fazia antes da fila); senão nenhuma — a pessoa decide.
 *  2. Entre IAs, vale a posição da conta em uso de cada uma: a lista intercalada decide quem responde. Passar de um
 *     provedor para o outro só vale no Automático (bot com IA fixa nunca troca de IA, R2).
 *  3. O limite é da conta, não da máquina.
 */

export type ContaDaPessoa = {
  id: string;
  ia: IaComConta;
  apelido: string;
  plano: string | null;
  corporativa: boolean;
  posicao: number;
  entraNaTrocaAutomatica: boolean;
  noLimiteAte: EpochMs | null;
  removidaEm: EpochMs | null;
};

export type VinculoDaConta = { contaId: string; maquinaId: string; estado: EstadoContaNaMaquina; sairPedidoEm: EpochMs | null };

/** O texto que vira a impressão (sha256 hex): a mesma conta na mesma pessoa dá o mesmo hash em qualquer máquina. */
export function textoDaImpressaoDaConta(p: { pessoaId: string; ia: IaComConta; email: string; orgId: string | null }): string {
  return `nod-conta-v1\n${p.pessoaId}\n${p.ia}\n${p.email.trim().toLowerCase()}\n${(p.orgId ?? "").trim().toLowerCase()}`;
}

export const IMPRESSAO = /^[0-9a-f]{64}$/;

export const ehIaComConta = (v: unknown): v is IaComConta => typeof v === "string" && (IAS_COM_CONTA as readonly string[]).includes(v);

const livre = (c: Pick<ContaDaPessoa, "noLimiteAte">, agora: EpochMs) => c.noLimiteAte === null || c.noLimiteAte <= agora;
/**
 * ADR-108 (R1/E2): "na fila" vale para toda conta. A 1ª conta de cada IA nasce na fila; a 2ª em diante nasce fora e só
 * entra quando a pessoa liga (com o aviso dos termos de uso, ADR-101 §4). NOD-308: a corporativa segue a mesma regra.
 */
export const naFila = (c: Pick<ContaDaPessoa, "entraNaTrocaAutomatica">): boolean => c.entraNaTrocaAutomatica;
const emOrdem = <T extends ContaDaPessoa>(contas: readonly T[]): T[] => contas.filter((c) => c.removidaEm === null).sort((a, b) => a.posicao - b.posicao);

/**
 * A conta em uso de uma IA entre as logadas na máquina (já em ordem). null = nenhuma utilizável sem a pessoa decidir.
 * Sem conta da IA na fila nesta máquina, vale a primeira dela aqui (E4); com alguma, conta fora da fila só entra pela
 * escolha da pessoa (o consentimento dos termos é por conta, ADR-101 §4).
 */
function contaEmUsoDaIa<T extends ContaDaPessoa>(daIa: readonly T[], p: { escolhida: string | null; agora: EpochMs }): T | null {
  const daFila = daIa.find((c) => naFila(c) && livre(c, p.agora));
  if (daFila) return daFila;
  const escolhida = daIa.find((c) => c.id === p.escolhida);
  if (escolhida && livre(escolhida, p.agora)) return escolhida;
  const [primeira] = daIa;
  if (!daIa.some(naFila) && primeira && livre(primeira, p.agora)) return primeira;
  return null;
}

export type ContaDoTurno<T extends ContaDaPessoa = ContaDaPessoa> = {
  /** A conta de cada IA que tem conta logada na máquina (null = nenhuma utilizável agora). */
  porIa: Partial<Record<IaComConta, T | null>>;
  /** A ordem das IAs para o escolherHarness: as com conta em uso, pela posição dela (ou pela ordem do bot). */
  ordemIas: IdHarness[];
  /** IAs com conta nesta máquina mas nenhuma utilizável agora: entram no `noLimite` do escolherHarness. */
  iasSemConta: IaComConta[];
};

/**
 * A conta do próximo turno numa máquina. null = a máquina não anunciou conta nenhuma (motor ou app antigo, ou ainda sem
 * login): o turno segue como hoje, sem `plano.conta`.
 */
export function contaDoTurno<T extends ContaDaPessoa>(p: {
  contas: readonly T[];
  /** Os ids das contas `pronta` na máquina do turno, sem saída pedida. */
  naMaquina: ReadonlySet<string>;
  escolhidas: Partial<Record<IaComConta, string>>;
  /** A ordem própria do bot (2B), quando ele tem uma. */
  ordemDoBot: readonly IdHarness[] | null;
  agora: EpochMs;
}): ContaDoTurno<T> | null {
  const lista = emOrdem(p.contas).filter((c) => p.naMaquina.has(c.id));
  if (lista.length === 0) return null;
  const porIa: Partial<Record<IaComConta, T | null>> = {};
  for (const ia of IAS_COM_CONTA) {
    const daIa = lista.filter((c) => c.ia === ia);
    if (daIa.length > 0) porIa[ia] = contaEmUsoDaIa(daIa, { escolhida: p.escolhidas[ia] ?? null, agora: p.agora });
  }
  const comConta = IAS_COM_CONTA.filter((ia) => porIa[ia]);
  const naOrdem = p.ordemDoBot
    ? [...comConta].sort((a, b) => indice(p.ordemDoBot!, a) - indice(p.ordemDoBot!, b))
    : [...comConta].sort((a, b) => porIa[a]!.posicao - porIa[b]!.posicao);
  const iasSemConta = IAS_COM_CONTA.filter((ia) => porIa[ia] === null);
  return { porIa, ordemIas: naOrdem, iasSemConta };
}

const indice = (ordem: readonly IdHarness[], ia: IdHarness) => {
  const i = ordem.indexOf(ia);
  return i < 0 ? ordem.length : i;
};

export type DecisaoDoLimiteDaConta =
  | { tipo: "trocou"; para: ContaDaPessoa }
  | { tipo: "outra_ia"; para: ContaDaPessoa }
  | { tipo: "perguntar"; livres: ContaLivre[] }
  | { tipo: "todas_no_limite"; voltaEm: EpochMs | null };

/**
 * A conta `contaId` bateu no limite até `ate` (o horário do fornecedor; sem ele, 1 h). ADR-108: com outra conta da MESMA
 * IA na fila (ou a escolhida) livre na máquina, segue nela, sem perguntar. Senão, no Automático, se outra IA tem conta em
 * uso na máquina: troca de IA. Com `iaFixa` (bot em "Uma IA só", R2), só as contas dela contam: nunca troca de IA. Senão
 * pergunta com as contas livres (na máquina, noutra máquina ou em nenhuma: "Entrar com ela aqui"). Nenhuma livre: todas no
 * limite, com a volta mais cedo.
 */
export function decidirLimiteDaConta(p: {
  contas: readonly ContaDaPessoa[];
  naMaquina: ReadonlySet<string>;
  /** As contas `pronta` noutra máquina da pessoa (id → a máquina), para "Rodar no <nome> desta vez". */
  noutraMaquina: ReadonlyMap<string, { id: string; nome: string }>;
  escolhidas: Partial<Record<IaComConta, string>>;
  ordemDoBot: readonly IdHarness[] | null;
  /**
   * A IA fixa do bot (R2); null/ausente = Automático. definido em 2026-10-15 (NOD-283, decisão da NOD-224): o bot tem a
   * IA fixa — nunca `outra_ia`, e só contas da mesma IA em `livres` (sem conta livre dela, espera e diz a hora). Quem
   * chama também filtra as contas (contasDaIaDoTurno).
   */
  iaFixa?: IaComConta | null;
  contaId: string;
  ate: EpochMs | null;
  agora: EpochMs;
}): { contas: ContaDaPessoa[]; decisao: DecisaoDoLimiteDaConta } {
  const ate = p.ate ?? p.agora + PRAZO_SEM_HORARIO_MS;
  const contas = p.contas.map((c) => (c.id === p.contaId ? { ...c, noLimiteAte: ate } : c));
  const conta = contas.find((c) => c.id === p.contaId);
  if (!conta) return { contas, decisao: { tipo: "todas_no_limite", voltaEm: ate } };
  const daIaFixa = (c: ContaDaPessoa) => !p.iaFixa || c.ia === p.iaFixa;
  // R2: com a IA fixa, as contas das outras IAs nem entram na conta (nem como "livres").
  const naMaquina = p.iaFixa ? new Set([...p.naMaquina].filter((id) => contas.find((c) => c.id === id)?.ia === p.iaFixa)) : p.naMaquina;
  // A conta que acabou de atingir o limite deixa de ser escolhida. Uma escolha de OUTRA conta da IA continua valendo:
  // ela foi explícita e pode ser justamente a próxima conta livre fora da fila (NOD-401, revisão rodada 5).
  const escolhidas = { ...p.escolhidas };
  if (escolhidas[conta.ia] === conta.id) delete escolhidas[conta.ia];
  const proximo = contaDoTurno({ contas, naMaquina, escolhidas, ordemDoBot: p.ordemDoBot, agora: p.agora });
  const mesmaIa = proximo?.porIa[conta.ia];
  if (mesmaIa && mesmaIa.id !== conta.id) return { contas, decisao: { tipo: "trocou", para: mesmaIa } };
  const outraIa = p.iaFixa ? undefined : proximo?.ordemIas.map((ia) => proximo.porIa[ia as IaComConta]).find((c): c is ContaDaPessoa => !!c && c.ia !== conta.ia);
  if (outraIa) return { contas, decisao: { tipo: "outra_ia", para: outraIa } };
  const livres: ContaLivre[] = emOrdem(contas)
    .filter((c) => c.id !== conta.id && livre(c, p.agora) && daIaFixa(c))
    .map((c) => ({ id: c.id, apelido: c.apelido, ia: c.ia, naMaquina: naMaquina.has(c.id), outraMaquina: p.noutraMaquina.get(c.id) ?? null }));
  if (livres.length > 0) return { contas, decisao: { tipo: "perguntar", livres } };
  const voltas = emOrdem(contas).filter(daIaFixa).map((c) => c.noLimiteAte).filter((t): t is number => t !== null && t > p.agora);
  return { contas, decisao: { tipo: "todas_no_limite", voltaEm: voltas.length > 0 ? Math.min(...voltas) : null } };
}

/**
 * ADR-108 (R4): quando a IA `ia` volta a servir pela lista — pela MESMA regra da conta em uso (`contaEmUsoDaIa`): a
 * primeira conta dela na fila que sai do limite, a escolhida, ou, sem conta da IA na fila, a primeira dela. Revisão do PR
 * 2 (C2): com `naMaquina`, só as contas logadas na máquina-alvo contam (uma conta livre só noutra máquina não traz a IA de
 * volta para o bot). null = alguma já serve, ou nenhuma das que contam diz quando volta, ou a IA não tem conta ali.
 */
export function voltaDaIa(contas: readonly ContaDaPessoa[], ia: IaComConta, agora: EpochMs, p: { naMaquina?: ReadonlySet<string>; escolhida?: string | null } = {}): EpochMs | null {
  const daIa = emOrdem(contas).filter((c) => c.ia === ia && (!p.naMaquina || p.naMaquina.has(c.id)));
  if (daIa.length === 0 || contaEmUsoDaIa(daIa, { escolhida: p.escolhida ?? null, agora }) !== null) return null;
  const candidatas = [...(daIa.some(naFila) ? daIa.filter(naFila) : daIa.slice(0, 1)), ...daIa.filter((c) => c.id === p.escolhida)];
  const voltas = candidatas.map((c) => c.noLimiteAte).filter((t): t is number => t !== null && t > agora);
  return voltas.length > 0 ? Math.min(...voltas) : null;
}

/**
 * Revisão do PR 2 (I4): a fila da IA voltou a ter conta livre entre as contas dadas (com `naMaquina`, só as logadas nela)?
 * Sem conta da IA na fila, false (a escolhida fora da fila é o único caminho, e fica).
 */
export function filaLivre(contas: readonly ContaDaPessoa[], ia: IaComConta, agora: EpochMs, naMaquina?: ReadonlySet<string>): boolean {
  return emOrdem(contas).some((c) => c.ia === ia && naFila(c) && livre(c, agora) && (!naMaquina || naMaquina.has(c.id)));
}

/** A ordem das IAs da pessoa derivada da lista (suposição 3 da ADR-102): a primeira aparição de cada IA, depois as outras. */
export function ordemIasDaLista(contas: readonly ContaDaPessoa[], padrao: readonly IdHarness[]): IdHarness[] {
  const vistas: IdHarness[] = [];
  for (const c of emOrdem(contas)) if (!vistas.includes(c.ia)) vistas.push(c.ia);
  return [...vistas, ...padrao.filter((ia) => !vistas.includes(ia))];
}

/**
 * definido em 2026-10-15 (NOD-283, CA 10): o vínculo marcado `sem_acesso` em `semAcessoEm` segue assim quando a máquina
 * anuncia a conta `pronta` sem um login mais novo (o app anterior anuncia `pronta` pela conferência de login). Um login
 * depois da marca é intenção da pessoa: volta a valer o que a máquina diz.
 */
export function vinculoSegueSemAcesso(semAcessoEm: EpochMs | null, anunciado: EstadoContaNaMaquina, logadaEm: EpochMs): boolean {
  return semAcessoEm !== null && anunciado === "pronta" && logadaEm <= semAcessoEm;
}

/**
 * O que fazer com uma conta anunciada por uma máquina (R4 da revisão): conta nova → criar; existente → atualizar o
 * vínculo; removida e logada ANTES da remoção → pedir saída (a máquina não tinha recebido o pedido); removida e logada
 * depois → voltar à lista (um login novo é intenção da pessoa).
 */
export function decidirAnuncio(existente: Pick<ContaDaPessoa, "removidaEm"> | null, logadaEm: EpochMs): "criar" | "atualizar" | "voltar" | "sair" {
  if (!existente) return "criar";
  if (existente.removidaEm === null) return "atualizar";
  return logadaEm > existente.removidaEm ? "voltar" : "sair";
}

/** O apelido de uma conta nova sem sugestão: "Conta N", N = a posição dela na lista. */
export const apelidoPadrao = (posicao: number): string => `Conta ${posicao}`;

/** "Claude · Lumen" — como a conversa e a tela chamam a conta. */
export const nomeDaConta = (c: { ia: IaComConta; apelido: string }): string => `${c.ia === "claude-cli" ? "Claude" : "ChatGPT"} · ${c.apelido}`;

/**
 * A frase da conversa (ADR-102 suposição 2: a conta pelo apelido). `quando` dá a hora ("14:00") e `quandoVolta` a hora
 * com a preposição ("às 14:00"). ADR-108 (R7): na mesma IA a linha é leve — "Pessoal acabou às 20:39 → seguindo no
 * Claude · Marlon 20x · mesmo modelo" (`acabouEm`, o instante do limite).
 */
export function fraseDoLimiteDaConta(
  de: { ia: IaComConta; apelido: string },
  d: DecisaoDoLimiteDaConta,
  p: { maquina: string | null; quando: (t: EpochMs) => string; quandoVolta: (t: EpochMs) => string; voltaEm: EpochMs | null; origem?: string; acabouEm?: EpochMs },
): string {
  const onde = p.maquina ? ` na ${p.maquina}` : "";
  const noLimite = `${nomeDaConta(de)} no limite${onde}${p.voltaEm !== null ? ` até ${p.quando(p.voltaEm)}` : ""}.`;
  // NOD-284 (suposição da NOD-230, 2026-10-15): a sala não refaz sozinha a fala cortada — nunca "Seguindo com" ali.
  if ((d.tipo === "trocou" || d.tipo === "outra_ia") && p.origem === "sala") return `${noLimite} Fale de novo para seguir com ${nomeDaConta(d.para)}.`;
  if (d.tipo === "trocou") return `${de.apelido} acabou${p.acabouEm !== undefined ? ` às ${p.quando(p.acabouEm)}` : ""} → seguindo no ${nomeDaConta(d.para)} · mesmo modelo`;
  if (d.tipo === "outra_ia") return `${noLimite} Seguindo com ${nomeDaConta(d.para)}.`;
  if (d.tipo === "perguntar") {
    const aqui = d.livres.filter((c) => c.naMaquina);
    if (aqui.length > 0) return `${noLimite} Seguir com ${aqui.length === 1 ? nomeDaConta(aqui[0]!) : "outra conta"}?`;
    const [primeira] = d.livres;
    return `${noLimite} ${nomeDaConta(primeira!)} está livre, mas ${p.maquina ? `não está na ${p.maquina}` : "não está nesta máquina"}.`;
  }
  return `Todas as suas contas estão no limite${d.voltaEm !== null ? `. A primeira volta ${p.quandoVolta(d.voltaEm)}` : ""}.`;
}
