import type { ContaDoPlano, ContasNoLimite, IaComConta } from "../contracts/contas-ia.ts";
import type { Autoria, RuntimeEvent } from "../contracts/evento.ts";
import type { IdHarness } from "../contracts/harness.ts";
import type { Mensagem } from "../contracts/mensagem.ts";
import type { Turno } from "../contracts/turno.ts";
import { contaDoTurno, decidirLimiteDaConta, fraseDoLimiteDaConta, voltaDaIa, type ContaDaPessoa, type ContaDoTurno, type DecisaoDoLimiteDaConta, type VinculoDaConta } from "../domain/contas-da-pessoa.ts";
import { horaDaFrase, quandoDaFrase } from "../domain/erro-fornecedor.ts";
import type { ContaGuardadaNoServidor } from "../repositories/contas-ia.repo.ts";
import { evento } from "./autoria-evento.ts";
import type { Deps } from "./tipos.ts";

/**
 * A conta do turno (definido em 2026-10-13, ADR-102 item 5): o servidor escolhe, pela lista da pessoa e pelo que a
 * máquina do turno tem logado; o plano leva a conta e a máquina usa a pasta dela. Sem conta anunciada na máquina (motor
 * ou app antigo), nada muda: o plano sai sem `conta` e a máquina usa a pasta padrão.
 */

export type ContasDaMaquina = {
  contas: ContaGuardadaNoServidor[];
  vinculos: VinculoDaConta[];
  escolhidas: Partial<Record<IaComConta, string>>;
  /** As contas `pronta` na máquina do turno, sem saída pedida. */
  naMaquina: Set<string>;
  /** As contas `pronta` noutra máquina viva da pessoa (para "Rodar no <nome> desta vez"). */
  noutraMaquina: Map<string, { id: string; nome: string }>;
  /** Nome da máquina do turno (null = sem chave: o Mac do modo local). */
  nomeDaMaquina: string | null;
};

/**
 * Red team do PR #306: "noutra máquina" só vale para máquina com contato recente (a chave é usada a cada puxada); uma VM
 * desligada sem "Desconectar" não é oferecida em "Rodar no <máquina> desta vez".
 */
export const CONTATO_RECENTE_MS = 2 * 60_000;

/** O que `lerContasDaMaquina` lê do banco (uma leitura serve para várias máquinas: o varredor lê uma vez por pessoa, I5). */
export type LeituraDasContas = {
  contas: ContaGuardadaNoServidor[];
  vinculos: VinculoDaConta[];
  escolhidas: Partial<Record<IaComConta, string>>;
  chaves: readonly { id: string; nome: string; revogadaEm: number | null; ultimoUsoEm: number | null }[];
};

export async function lerContas(deps: Pick<Deps, "repos">): Promise<LeituraDasContas> {
  // ADR-108: o "Perguntar antes"/"Trocar sozinho" (preferencias.contas_modo) não decide mais nada; só a escolhida vale.
  const [{ contas, vinculos }, { escolhidas }, chaves] = await Promise.all([deps.repos.contasIa.listar(), deps.repos.contasIa.modo(), deps.repos.maquinaTokens.listar()]);
  return { contas, vinculos, escolhidas, chaves };
}

/** As contas vistas pela máquina `machineId`, a partir de uma leitura já feita. */
/** As máquinas vivas da pessoa (chave não revogada e contato recente), id → nome. */
export function chavesVivas(l: Pick<LeituraDasContas, "chaves">, agora: number): Map<string, string> {
  return new Map(l.chaves.filter((c) => c.revogadaEm === null && c.ultimoUsoEm !== null && agora - c.ultimoUsoEm < CONTATO_RECENTE_MS).map((c) => [c.id, c.nome]));
}

/** Os vínculos `pronta` sem saída pedida (de todas as máquinas). */
const vinculosProntos = (l: Pick<LeituraDasContas, "vinculos">): VinculoDaConta[] => l.vinculos.filter((v) => v.estado === "pronta" && v.sairPedidoEm === null);

/** As contas `pronta` na máquina `maquinaId`, sem saída pedida. */
export function prontasNa(l: Pick<LeituraDasContas, "vinculos">, maquinaId: string): Set<string> {
  return new Set(vinculosProntos(l).filter((v) => v.maquinaId === maquinaId).map((v) => v.contaId));
}

export function contasDaMaquinaDe(l: LeituraDasContas, machineId: string, agora: number): ContasDaMaquina {
  const nomes = new Map(l.chaves.filter((c) => c.revogadaEm === null).map((c) => [c.id, c.nome]));
  const vivas = chavesVivas(l, agora);
  const prontas = vinculosProntos(l);
  const naMaquina = prontasNa(l, machineId);
  const noutraMaquina = new Map<string, { id: string; nome: string }>();
  for (const v of prontas) if (v.maquinaId !== machineId && vivas.has(v.maquinaId) && !noutraMaquina.has(v.contaId)) noutraMaquina.set(v.contaId, { id: v.maquinaId, nome: vivas.get(v.maquinaId)! });
  return { contas: l.contas, vinculos: l.vinculos, escolhidas: l.escolhidas, naMaquina, noutraMaquina, nomeDaMaquina: nomes.get(machineId) ?? null };
}

/**
 * definido em 2026-10-20 (NOD-301, emenda da ADR-102): as IAs que esta máquina tem logadas sem conta utilizável agora e
 * que têm conta em uso (a que a fila escolheria) noutra máquina viva da pessoa com a IA pronta. A máquina deixa passar o
 * turno sem alvo dessas IAs por até ESPERA_DECLINIO_MS (turnos.repo.ts `reivindicar`), para a outra responder sem nota.
 * Sem conta anunciada aqui (motor ou app antigo), nada. A IA no limite global da pessoa (`noLimite`) fica de fora: a outra
 * máquina não a pegaria no Automático (iasParaOAutomatico).
 */
export function iasSoNoutraMaquina(l: LeituraDasContas | null, p: { machineId: string; agora: number; noLimite: readonly string[]; prontosPorMaquina: Readonly<Record<string, readonly string[]>> }): IaComConta[] {
  if (!l) return [];
  const aqui = contaDoTurno({ contas: l.contas, naMaquina: prontasNa(l, p.machineId), escolhidas: l.escolhidas, ordemDoBot: null, agora: p.agora });
  if (!aqui) return [];
  const candidatas = aqui.iasSemConta.filter((ia) => !p.noLimite.includes(ia));
  if (candidatas.length === 0) return [];
  const outras = [...chavesVivas(l, p.agora).keys()].filter((m) => m !== p.machineId);
  const la = outras.map((m) => ({ prontos: p.prontosPorMaquina[m] ?? [], conta: contaDoTurno({ contas: l.contas, naMaquina: prontasNa(l, m), escolhidas: l.escolhidas, ordemDoBot: null, agora: p.agora }) }));
  return candidatas.filter((ia) => la.some((m) => m.prontos.includes(ia) && (m.conta?.porIa[ia] ?? null) !== null));
}

export async function lerContasDaMaquina(deps: Pick<Deps, "repos" | "agora">, machineId: string): Promise<ContasDaMaquina> {
  return contasDaMaquinaDe(await lerContas(deps), machineId, deps.agora());
}

export function escolherContaDoTurno(c: ContasDaMaquina, ordemDoBot: readonly IdHarness[] | null, agora: number): ContaDoTurno<ContaGuardadaNoServidor> | null {
  return contaDoTurno({ contas: c.contas, naMaquina: c.naMaquina, escolhidas: c.escolhidas, ordemDoBot, agora });
}

export const contaDoPlano = (c: Pick<ContaGuardadaNoServidor, "id" | "impressao" | "apelido">): ContaDoPlano => ({ id: c.id, impressao: c.impressao, apelido: c.apelido });

/**
 * definido em 2026-10-15 (NOD-283, C3 = C11): a lista vista pelas IAs que podem pegar o turno (a fixa, ou as prontas na
 * máquina no Automático). Uma regra só para o despacho, o assentamento e a nota do fundo segurado (NOD-253): a conta de
 * outra IA não entra em `livres` nem vira "Seguindo com <outra IA>" para o bot de IA fixa.
 */
export function contasDaIaDoTurno(c: ContasDaMaquina, ias: readonly string[]): ContasDaMaquina {
  const daIa = new Set(c.contas.filter((x) => ias.includes(x.ia)).map((x) => x.id));
  return {
    ...c,
    contas: c.contas.filter((x) => daIa.has(x.id)),
    naMaquina: new Set([...c.naMaquina].filter((id) => daIa.has(id))),
    noutraMaquina: new Map([...c.noutraMaquina].filter(([id]) => daIa.has(id))),
  };
}

/**
 * O turno não tem conta para usar nesta máquina sem a pessoa decidir? `iasDoTurno` são as IAs que podem pegá-lo (a fixa,
 * ou as prontas na máquina no Automático); IA sem conta anunciada aqui segue o caminho de antes (não segura o turno).
 * Devolve a conta "de" (a primeira da lista nesta máquina, a que parou) e a decisão para a nota; null = segue.
 * ADR-108 (R2) e NOD-283: a decisão olha só as contas das IAs do turno, com as escolhas da pessoa e a ordem do bot; com a
 * IA fixa (`iaFixa`), só as contas dela e nunca outra IA.
 */
export function semContaParaOTurno(
  c: ContasDaMaquina,
  r: ContaDoTurno<ContaGuardadaNoServidor> | null,
  iasDoTurno: readonly string[],
  agora: number,
  opcoes: { iaFixa?: IaComConta | null; ordemDoBot?: readonly IdHarness[] | null } = {},
): { de: ContaDaPessoa; decisao: DecisaoDoLimiteDaConta; voltaEm: number | null } | null {
  if (!r) return null;
  const governadas = iasDoTurno.filter((ia): ia is IaComConta => ia in r.porIa);
  const livresSemConta = iasDoTurno.filter((ia) => !(ia in r.porIa));
  if (governadas.length === 0 || livresSemConta.length > 0 || governadas.some((ia) => r.porIa[ia])) return null;
  const visao = contasDaIaDoTurno(c, governadas);
  const naOrdem = visao.contas.filter((x) => x.removidaEm === null && visao.naMaquina.has(x.id)).sort((a, b) => a.posicao - b.posicao);
  const de = naOrdem.find((x) => x.noLimiteAte !== null && x.noLimiteAte > agora) ?? naOrdem[0];
  if (!de) return null;
  const { decisao } = decidirLimiteDaConta({ contas: visao.contas, naMaquina: visao.naMaquina, noutraMaquina: visao.noutraMaquina, escolhidas: visao.escolhidas, ordemDoBot: opcoes.ordemDoBot ?? null, contaId: de.id, ate: de.noLimiteAte, agora, iaFixa: opcoes.iaFixa ?? null });
  // NOD-401: a conta `de` explica o aviso, mas a fila (ou a escolhida) pode ter outra conta que volta antes. Contas livres
  // fora da fila continuam sendo escolha explícita no cartão e não mudam silenciosamente a hora da retomada.
  const voltaEm = voltaDaIa(visao.contas, de.ia, agora, { naMaquina: visao.naMaquina, escolhida: visao.escolhidas[de.ia] }) ?? de.noLimiteAte;
  return { de, decisao, voltaEm };
}

/** O payload `contas` da nota de limite (a tela desenha os botões). */
export function contasDaNota(de: ContaDaPessoa, d: DecisaoDoLimiteDaConta, maquina: { id: string; nome: string } | null, voltaEm: number | null): ContasNoLimite {
  // NOD-284: na sala a troca não refaz sozinha; a conta para onde ela iria vira o botão "Seguir com" (só da mesma IA,
  // NOD-224 — a nota nunca oferece outra IA).
  const livres = d.tipo === "perguntar" ? d.livres : d.tipo === "trocou" ? [{ id: d.para.id, apelido: d.para.apelido, ia: d.para.ia, naMaquina: true, outraMaquina: null }] : [];
  return { de: { id: de.id, apelido: de.apelido, ia: de.ia }, livres, maquina, voltaEm };
}

/**
 * A última nota de limite da conversa (`mensagens` em ordem de criação) e se ela segue ABERTA: depois dela não veio fala
 * do bot nem um "Seguindo com" (`conta_escolhida`, `conta_seguiu`). Uma regra só (NOD-268) para o "Seguir com" não refazer
 * duas vezes e para o despacho não escrever a mesma nota de novo.
 */
export function notaDeLimite(mensagens: readonly Mensagem[], agenteId?: string, comTrocaDeIa = false): { nota: Mensagem; pos: number; aberta: boolean } | null {
  // ADR-108 (R6 a): o "Continuar na conta" do aviso do bot fixo (`troca_de_ia` com o turno da fala) refaz como o "Seguir com".
  const ehNota = (m: Mensagem) => m.payload?.kind === "limite_do_plano" || (comTrocaDeIa && m.payload?.kind === "troca_de_ia");
  const pos = mensagens.map((m) => ehNota(m) && m.turnoId !== null && (agenteId === undefined || m.autoria.autor_id === agenteId)).lastIndexOf(true);
  if (pos < 0) return null;
  const nota = mensagens[pos]!;
  // NOD-284 (definido em 2026-10-15): numa sala, a fala de OUTRO bot não fecha a nota deste. A nota tem a autoria do bot
  // do turno; sem ela (nota antiga), vale qualquer agente, como antes.
  const dono = nota.autoria.autor_tipo === "agente" ? nota.autoria.autor_id : null;
  const doDono = (m: Mensagem) => dono === null || m.autoria.autor_id === dono || m.turnoId === nota.turnoId;
  const respondida = mensagens.slice(pos + 1).some((m) => (m.autoria.autor_tipo === "agente" || m.payload?.kind === "conta_escolhida" || m.payload?.kind === "conta_seguiu") && doDono(m));
  return { nota, pos, aberta: !respondida };
}

/** O `voltaEm` que a nota grava (o mesmo cálculo de criarNotaDeContas): null quando já passou ou não há hora. */
export function voltaDaNota(decisao: DecisaoDoLimiteDaConta, voltaEm: number | null, agora: number): number | null {
  const v = decisao.tipo === "todas_no_limite" ? decisao.voltaEm : voltaEm;
  return v !== null && v > agora ? v : null;
}

/**
 * NOD-268 (regressão de 15/10: dez despachos, dez notas iguais): a conversa já tem a nota aberta da MESMA conta e do MESMO
 * `voltaEm`? Então outra nota só repetiria a primeira.
 */
export async function notaIgualAberta(deps: Pick<Deps, "repos">, p: { conversaId: string; agenteId?: string; contaId: string; voltaEm: number | null }): Promise<boolean> {
  const n = notaDeLimite(await deps.repos.mensagens.listarDaConversa(p.conversaId, 30), p.agenteId);
  if (!n?.aberta || n.nota.payload?.kind !== "limite_do_plano") return false;
  return n.nota.payload.contas?.de.id === p.contaId && (n.nota.payload.voltaEm ?? null) === p.voltaEm;
}

/** A nota da conversa quando nenhuma conta serve (no despacho ou no assentamento): a frase pelo apelido e os botões. */
export async function criarNotaDeContas(deps: Pick<Deps, "repos" | "escopo">, p: {
  turno: Turno;
  autoria: Autoria;
  agora: number;
  de: ContaDaPessoa;
  decisao: DecisaoDoLimiteDaConta;
  maquina: { id: string; nome: string } | null;
  voltaEm: number | null;
}): Promise<RuntimeEvent[]> {
  const voltaEm = p.decisao.tipo === "todas_no_limite" ? p.decisao.voltaEm : p.voltaEm;
  const naNota = voltaDaNota(p.decisao, p.voltaEm, p.agora);
  const texto = fraseDoLimiteDaConta(p.de, p.decisao, { maquina: p.maquina?.nome ?? null, quando: (t) => horaDaFrase(t, p.agora), quandoVolta: (t) => quandoDaFrase(t, p.agora), voltaEm, origem: p.turno.origem });
  const aviso = await deps.repos.mensagens.criar({
    conversaId: p.turno.conversaId,
    turnoId: p.turno.id,
    autoria: p.autoria,
    kind: "sistema",
    texto,
    payload: { kind: "limite_do_plano", harness: p.de.ia, voltaEm: naNota, contas: contasDaNota(p.de, p.decisao, p.maquina, voltaEm) },
    confianca: "confiavel",
  });
  return aviso ? [evento(deps.escopo, { kind: "mensagem_criada", autoria: p.autoria, agora: p.agora, conversaId: p.turno.conversaId, turnoId: p.turno.id, dados: { mensagem_id: aviso.id, kind: "sistema" } })] : [];
}
