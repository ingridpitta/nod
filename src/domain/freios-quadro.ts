import type { MovimentoTarefa, NovoMovimento, TipoMovimento, TravaColuna } from "../contracts/freios-quadro.ts";
import type { AutorLote, ColunaQuadro, IdColuna, TarefaQuadro } from "../contracts/quadro.ts";
import { colunaDeEspera, resolverColuna } from "./colunas.ts";

/**
 * Os freios e as travas da esteira (definido em 2026-11-02, NOD-419). Puro. É o PONTO ÚNICO que toda mudança de coluna ou
 * de responsável atravessa: o planejarLote (src/domain/quadro.ts) aplica os passos e, no fim, compara o antes e o depois
 * de cada tarefa tocada — venha a mudança da pessoa, do agente, de um `terminei`, da passagem de coluna ou do Linear.
 * Três momentos: `conferirTravas` (a intenção, antes de alguém começar), `frearDepois` (laço e freio, com o estado
 * final) e `movimentosDoLote` (o histórico que fica gravado, com o que acionou).
 */

/** No 4º "não é comigo" a tarefa vai para a pessoa. */
export const LIMITE_PASSES = 3;
/** Mais de 3 idas e voltas entre as mesmas duas colunas = laço (o 7º movimento entre elas). */
export const LIMITE_IDAS_E_VOLTAS = 3;
/** Mais de 12 acionamentos do responsável na mesma tarefa em uma hora = freio. */
export const LIMITE_ACIONAMENTOS_HORA = 12;
const HORA = 3_600_000;

/** Pedir ajuda nunca fica travado: perguntar à pessoa (ADR-162, a marca `voce`) e Bloqueado são saída de qualquer coluna. */
const ESPERA: ReadonlySet<string> = new Set(["voce", "bloqueado"]);
const ESPERA_PESSOA = "voce";

type Erro = { erro: string };
type Corte = Pick<TarefaQuadro, "status" | "agenteId"> & Partial<Pick<TarefaQuadro, "voltarPara">>;
/** A tarefa durante o plano (o mesmo objeto que o planejarLote muda). */
export type TarefaNoFreio = Pick<TarefaQuadro, "id" | "titulo" | "status" | "agenteId" | "voltarPara" | "pergunta" | "resposta"> & { nova?: boolean };

const nomeDaColuna = (colunas: readonly ColunaQuadro[], id: IdColuna) => colunas.find((c) => c.id === id)?.nome ?? id;

export function travaDe(colunas: readonly ColunaQuadro[], id: IdColuna): TravaColuna | undefined {
  return colunas.find((c) => c.id === id)?.trava;
}

/** A trava tem efeito? (sem destinos que existem e sem "só a pessoa" = não trava nada). */
export function temTrava(t: TravaColuna | undefined): boolean {
  return !!t && (t.soPessoa === true || (t.saiPara?.length ?? 0) > 0);
}

/**
 * De onde a trava é lida: a coluna em que a tarefa está, ou, se ela espera (Precisa de você, Bloqueado), a coluna de
 * onde ela foi esperar (`voltarPara`). Revisão do PR #629: sem isso, Fazendo → Bloqueado → Feito contornava o "só sai para".
 */
export function origemDaTrava(de: IdColuna, voltarPara: IdColuna | null | undefined): IdColuna {
  return ESPERA.has(de) && voltarPara ? voltarPara : de;
}

/**
 * A tarefa pode sair de `de` para `para`? null = pode; senão a frase que volta a quem tentou (o bot lê e a tela mostra).
 * `colunasDe` = as colunas de onde ela saiu (a coluna removida no mesmo lote ainda tem a trava dela). `voltarPara`: a
 * tarefa que sai de uma espera leva a trava da coluna de onde foi esperar.
 */
export function conferirTrava(colunasDe: readonly ColunaQuadro[], colunasPara: readonly ColunaQuadro[], deAgora: IdColuna, para: IdColuna, autor: AutorLote, voltarPara?: IdColuna | null): string | null {
  const de = origemDaTrava(deAgora, voltarPara);
  if (de === para || ESPERA.has(para)) return null;
  const trava = travaDe(colunasDe, de);
  if (!trava) return null;
  const nome = nomeDaColuna(colunasDe, de);
  if (trava.soPessoa && autor.tipo === "agente") return `de ${nome} só a pessoa tira a tarefa: deixe onde está ou pergunte a ela (mudar_tarefa só com a pergunta)`;
  // Revisão 7 do PR #629: os destinos são os das colunas do INÍCIO do lote. Remover o destino no mesmo lote não solta a
  // trava (antes, sem destino que existisse depois, a tarefa saía para qualquer coluna).
  const destinos = (trava.saiPara ?? []).filter((id) => colunasDe.some((c) => c.id === id));
  if (destinos.length > 0 && !destinos.includes(para)) {
    const sumiram = destinos.filter((id) => !colunasPara.some((c) => c.id === id));
    const aviso = sumiram.length > 0 ? ` (${sumiram.map((id) => nomeDaColuna(colunasDe, id)).join(" e ")} sai neste lote: mova a tarefa e mexa nas colunas em chamadas separadas)` : "";
    return `de ${nome} a tarefa só sai para ${destinos.map((id) => nomeDaColuna(colunasDe, id)).join(" ou ")}${aviso}`;
  }
  return null;
}

/**
 * Confere as travas de todas as tarefas tocadas pelo lote (o antes contra o estado depois dos passos). `isentas` = o que
 * o sistema moveu (a coluna que saiu, a resposta da pessoa, o desfazer de um movimento): não é escolha de ninguém.
 * `autor` é quem a trava "só a pessoa" enxerga: o agente que move a pedido da pessoa, na conversa limpa, conta como ela.
 */
export function conferirTravas(p: {
  colunasDoInicio: readonly ColunaQuadro[];
  colunas: readonly ColunaQuadro[];
  antes: ReadonlyMap<string, Corte>;
  tarefas: readonly TarefaNoFreio[];
  tocadas: readonly string[];
  isentas: ReadonlySet<string>;
  autor: AutorLote;
}): Erro | null {
  for (const id of p.tocadas) {
    const a = p.antes.get(id);
    const t = p.tarefas.find((x) => x.id === id);
    if (!a || !t || p.isentas.has(id)) continue;
    const recusa = conferirTrava(p.colunasDoInicio, p.colunas, a.status, t.status, p.autor, a.voltarPara);
    if (recusa) return { erro: `tarefa "${t.titulo}": ${recusa}` };
  }
  return null;
}

/** Liga, troca ou tira as travas de uma coluna. `sai_para` null ou [] tira o destino; `so_pessoa` false tira. */
export function travarColuna(colunas: readonly ColunaQuadro[], op: { coluna: string; sai_para?: string[] | null; so_pessoa?: boolean }): { colunas: ColunaQuadro[]; id: IdColuna; frase: string } | Erro {
  const id = resolverColuna(colunas, op.coluna);
  if (typeof id !== "string") return id;
  const atual = travaDe(colunas, id) ?? {};
  let saiPara = atual.saiPara;
  if (op.sai_para !== undefined) {
    saiPara = [];
    for (const ref of op.sai_para ?? []) {
      const destino = resolverColuna(colunas, ref);
      if (typeof destino !== "string") return destino;
      if (destino === id) return { erro: "a coluna não precisa sair para ela mesma" };
      if (!saiPara.includes(destino)) saiPara.push(destino);
    }
  }
  const soPessoa = op.so_pessoa !== undefined ? op.so_pessoa : atual.soPessoa;
  const trava: TravaColuna = { ...(saiPara?.length ? { saiPara } : {}), ...(soPessoa ? { soPessoa: true } : {}) };
  const nome = nomeDaColuna(colunas, id);
  // Revisão 2 do PR #629: quem tira a tarefa de A fazer é o começo (vai ao andamento depois das travas); uma trava ali
  // seria contornada por ele. definido em 2026-11-02: proibir é mais simples que conferir de novo depois do começo.
  if (id === colunaDeEspera(colunas) && temTrava(trava)) return { erro: `${nome} não leva trava: dela a tarefa sai quando o responsável começa. Trave a coluna seguinte` };
  const novas = colunas.map((c) => {
    if (c.id !== id) return { ...c };
    const { trava: _velha, ...resto } = c;
    return temTrava(trava) ? { ...resto, trava } : resto;
  });
  return { colunas: novas, id, frase: temTrava(trava) ? `${nome} travada` : `${nome} sem trava` };
}

/** A frase curta da trava (a tela mostra no menu da coluna). */
export function fraseDaTrava(colunas: readonly ColunaQuadro[], t: TravaColuna | undefined): string | null {
  if (!temTrava(t)) return null;
  const partes = [
    t!.saiPara?.length ? `só sai para ${t!.saiPara.map((id) => nomeDaColuna(colunas, id)).join(" ou ")}` : "",
    t!.soPessoa ? "só a pessoa tira daqui" : "",
  ].filter(Boolean);
  return partes.join(" · ");
}

/** O que o passo diz do movimento: o tipo, o motivo (de fora quando um agente o escreveu) e o movimento que desfez. */
export type DadoDoMovimento = { tipo: TipoMovimento; motivo: string | null; deFora?: boolean; desfaz?: string };

const vale = (m: MovimentoTarefa, tarefaId: string) => m.tarefaId === tarefaId && m.desfeitoEm === null;

/** Quantas vezes já disseram "não é comigo" nesta tarefa. */
export function passesDaTarefa(historico: readonly MovimentoTarefa[], tarefaId: string): number {
  return historico.filter((m) => vale(m, tarefaId) && m.tipo === "nao_e_comigo").length;
}

/** O responsável da coluna (a passagem, ADR-142), se ela tiver. */
export function responsavelDaColuna(colunas: readonly ColunaQuadro[], id: IdColuna): string | null {
  return colunas.find((c) => c.id === id)?.responsavel || null;
}

/** Entra numa espera (voce/bloqueado) guardando de onde veio, com a pergunta à pessoa. */
export function esperar(t: TarefaNoFreio, status: IdColuna, pergunta: string): void {
  if (!ESPERA.has(t.status)) t.voltarPara = t.status;
  t.status = status;
  t.pergunta = pergunta;
  t.resposta = null;
}

/**
 * O agente diz "não é comigo" (com o motivo). Ele sai de responsável e o motivo fica no histórico. Se o quadro sugere
 * outro (o responsável da coluna, que ainda não recusou), a tarefa fica na coluna com ele; senão fica na coluna
 * esperando a pessoa (ADR-162). No 4º passe vai para o dono em Bloqueado de qualquer jeito.
 */
export function recusarTarefa(t: TarefaNoFreio, p: {
  autorAgenteId: string | null;
  motivo: string;
  historico: readonly MovimentoTarefa[];
  colunas: readonly ColunaQuadro[];
  agentes: readonly { id: string; nome: string; nod: boolean }[];
}): Erro | { passe: number; sugerido: string | null } {
  if (!p.autorAgenteId) return { erro: "nao_e_comigo é do agente responsável: troque o responsável na tarefa" };
  if (t.agenteId !== p.autorAgenteId) return { erro: "a tarefa não está com você" };
  const passe = passesDaTarefa(p.historico, t.id) + 1;
  const recusaram = new Set([p.autorAgenteId, ...p.historico.filter((m) => vale(m, t.id) && m.tipo === "nao_e_comigo" && m.agenteAntes).map((m) => m.agenteAntes!)]);
  const candidato = passe <= LIMITE_PASSES ? responsavelDaColuna(p.colunas, t.status) : null;
  const sugerido = candidato && !recusaram.has(candidato) && p.agentes.some((a) => a.id === candidato && !a.nod) ? candidato : null;
  const nome = p.agentes.find((a) => a.id === p.autorAgenteId)?.nome ?? "O agente";
  t.agenteId = sugerido;
  if (!sugerido) {
    const quem = passe > LIMITE_PASSES ? `${passe}ª recusa: ${nome}` : nome;
    // Revisão 8 do PR #629 (decisão da Ada na issue, 02/11 03:33): no 4º passe a tarefa vai para o dono em Bloqueado
    // (esperando a pessoa se o quadro não tiver Bloqueado). Antes do limite, sem candidato, esperando a pessoa (ADR-162: na coluna).
    esperar(t, passe > LIMITE_PASSES ? bloqueio(p.colunas) : ESPERA_PESSOA, `${quem} disse que não é com ele: "${p.motivo}". Quem pega?`);
  }
  return { passe, sugerido };
}

/**
 * Revisão 3 do PR #629 (definido em 2026-11-02): o laço e o freio são a esteira parando o agente; o agente não os desfaz
 * por conta própria (só a pessoa, pela tela, ou o agente que repassa o pedido dela na conversa limpa).
 */
export const SO_A_PESSOA_DESFAZ: ReadonlySet<TipoMovimento> = new Set<TipoMovimento>(["laco", "freio"]);

/**
 * Revisão 10 do PR #629: o `nao_e_comigo` além do limite de passes leva a tarefa ao dono em Bloqueado (revisão 8); antes
 * do limite ele nunca entra em Bloqueado (fica na coluna ou vai a Precisa de você). Essa entrada tem a regra do laço e do
 * freio: só a pessoa tira a tarefa de lá e desfaz o movimento. Sem a coluna Bloqueado no quadro, o 4º passe vai a Precisa
 * de você e não se distingue de uma recusa comum (lacuna aceita).
 */
export const pelosPasses = (m: Pick<MovimentoTarefa, "tipo" | "de" | "para">): boolean => m.tipo === "nao_e_comigo" && m.para === "bloqueado" && m.de !== "bloqueado";

/** O que parou a tarefa e só a pessoa desfaz: o laço, o freio ou o limite de recusas. */
export type ParadaDaPessoa = "laco" | "freio" | "passes";
export function paradaDaPessoa(m: Pick<MovimentoTarefa, "tipo" | "de" | "para">): ParadaDaPessoa | null {
  if (m.tipo === "laco" || m.tipo === "freio") return m.tipo;
  return pelosPasses(m) ? "passes" : null;
}
/** O nome da parada na frase de recusa ("o laço só a pessoa desfaz"). */
export const nomeDaParada = (p: ParadaDaPessoa): string => (p === "laco" ? "o laço" : p === "freio" ? "o freio" : "o limite de recusas (4º \"não é comigo\")");

/** O movimento mudou a tarefa de coluna ou de mão (o `acionou` e o freio que só segurou não mudaram). */
export const mudouATarefa = (m: Pick<MovimentoTarefa, "tipo" | "de" | "para" | "agenteAntes" | "agenteDepois">): boolean => m.tipo !== "acionou" && (m.de !== m.para || m.agenteAntes !== m.agenteDepois);

/**
 * O último movimento desfazível da tarefa: o mais recente que a mudou e não foi desfeito. O histórico vem na ordem em que
 * aconteceu (o repositório ordena por criado_em, id); o empate de hora fica com a ordem da lista.
 */
export function ultimoDesfazivel(historico: readonly MovimentoTarefa[], tarefaId: string): MovimentoTarefa | null {
  let ultimo: MovimentoTarefa | null = null;
  for (const m of historico) {
    if (m.tarefaId !== tarefaId || m.desfeitoEm !== null || !mudouATarefa(m)) continue;
    if (!ultimo || m.criadoEm >= ultimo.criadoEm) ultimo = m;
  }
  return ultimo;
}

/**
 * Desfaz um movimento: a tarefa volta à coluna e ao responsável de antes dele. Só o MAIS RECENTE que ainda vale (revisão
 * do PR #629: com A→B, B→C, C→B o estado coincide com o de depois de A→B, mas voltar a A pularia duas casas). Sem
 * `movimentoId`, desfaz esse último. Se a tarefa mudou depois sem movimento (outro caminho), recusa também.
 */
export function desfazerMovimento(t: TarefaNoFreio, movimentoId: string | undefined, historico: readonly MovimentoTarefa[], colunas: readonly ColunaQuadro[]): Erro | MovimentoTarefa {
  const ultimo = ultimoDesfazivel(historico, t.id);
  const m = movimentoId === undefined ? ultimo : historico.find((x) => x.id === movimentoId && x.tarefaId === t.id);
  // Revisão 3 do PR #629: o id fora do histórico lido (a janela de 24 h mais o último desfazível) não é o último; se a
  // tarefa tem outro último, a resposta é a mesma da tela ("só o último"), não "não encontrado".
  if (!m && movimentoId !== undefined && ultimo) return { erro: `só o último movimento da tarefa se desfaz (o ${ultimo.id}): houve outro depois desse; mova à mão` };
  if (!m) return { erro: movimentoId === undefined ? "a tarefa não tem movimento para desfazer" : "movimento não encontrado nesta tarefa" };
  if (m.desfeitoEm !== null) return { erro: "esse movimento já foi desfeito" };
  if (!mudouATarefa(m)) return { erro: "esse movimento não mudou a tarefa de lugar nem de mão" };
  if (ultimo?.id !== m.id) return { erro: "só o último movimento da tarefa se desfaz: houve outro depois desse; mova à mão" };
  if (t.status !== m.para || t.agenteId !== m.agenteDepois) return { erro: "a tarefa mudou depois desse movimento: mova à mão" };
  // ADR-162: `voce` não é coluna, é a marca de esperando a pessoa: voltar a ela vale sempre.
  if (m.de !== ESPERA_PESSOA && !colunas.some((c) => c.id === m.de)) return { erro: `a coluna de antes (${m.de.replace(/^c-/, "")}) não existe mais: mova à mão` };
  if (ESPERA.has(m.de)) { if (!ESPERA.has(t.status)) t.voltarPara = t.status; } else t.voltarPara = null;
  t.status = m.de;
  t.agenteId = m.agenteAntes;
  return m;
}

/** O laço ou o freio que levou a tarefa a Bloqueado (o freio do comentário fica na coluna: de = para). Desfeito, ainda corta. */
const corta = (m: MovimentoTarefa) => (m.tipo === "laco" || m.tipo === "freio") && m.de !== m.para;

const par = (a: IdColuna, b: IdColuna) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);

/**
 * Quantos movimentos de AGENTE já houve entre as duas colunas (nos dois sentidos), desde o último laço ou freio desta
 * tarefa. A pessoa que devolve a tarefa não conta: o laço é dos agentes trocando entre si (decisão da Ada, NOD-419). O
 * desfazer também não (revisão do PR #629): voltar o próprio passo não é ida e volta.
 */
export function passagensEntre(historico: readonly MovimentoTarefa[], tarefaId: string, de: IdColuna, para: IdColuna): number {
  // Revisão 6 do PR #629: o laço ou o freio desfeito continua sendo o corte (desfazê-lo não devolve as passagens de antes
  // dele à conta; senão o movimento seguinte laçava de novo). Os movimentos contados depois dele são os que valem.
  const daTarefa = historico.filter((m) => m.tarefaId === tarefaId).sort((x, y) => x.criadoEm - y.criadoEm);
  let ultimoLaco = -1;
  // Só o freio que levou a Bloqueado zera a conta (o do comentário fica na coluna: de = para).
  daTarefa.forEach((m, i) => { if (corta(m)) ultimoLaco = i; });
  const k = par(de, para);
  // Revisão 7 do PR #629: a saída de uma espera conta a partir da coluna de onde a tarefa foi esperar (origemDaTrava, como
  // as travas): senão Fazendo → Bloqueado → Em revisão, em lotes separados, contornava a conta entre Fazendo e Em revisão.
  // O `voltarPara` de cada movimento é refeito pelo próprio histórico (o movimento não o grava).
  let voltarPara: IdColuna | null = null;
  let n = 0;
  daTarefa.forEach((m, i) => {
    const de = origemDaTrava(m.de, voltarPara);
    if (ESPERA.has(m.para)) { if (!ESPERA.has(m.de)) voltarPara = m.de; } else voltarPara = null;
    if (i > ultimoLaco && m.desfeitoEm === null && m.autor.tipo === "agente" && m.tipo !== "desfazer" && de !== m.para && par(de, m.para) === k) n++;
  });
  return n;
}

/**
 * Revisão 7 do PR #629: o tipo do movimento que levou a tarefa à espera em que ela está (o último que entrou em Precisa de
 * você ou Bloqueado vindo de fora delas e não foi desfeito); null se ela não espera desde um movimento conhecido.
 */
/**
 * O movimento que levou a tarefa à espera em que ela está. Revisão 10 do PR #629: o 4º passe que vai de Precisa de você a
 * Bloqueado (`pelosPasses`) também conta como entrada. O espelho no banco é `quadrosRepo.entradasNaEspera`.
 */
function entradaNaEspera(historico: readonly MovimentoTarefa[], tarefaId: string): MovimentoTarefa | null {
  let entrada: MovimentoTarefa | null = null;
  for (const m of historico.filter((x) => x.tarefaId === tarefaId && x.desfeitoEm === null).sort((x, y) => x.criadoEm - y.criadoEm)) {
    if (ESPERA.has(m.para)) { if (!ESPERA.has(m.de) || pelosPasses(m)) entrada = m; } else entrada = null;
  }
  return entrada;
}

/** A parada (laço, freio, limite de recusas) que pôs a tarefa na espera em que ela está; null se não foi uma delas. */
export function paradaDaEspera(historico: readonly MovimentoTarefa[], tarefaId: string): ParadaDaPessoa | null {
  const m = entradaNaEspera(historico, tarefaId);
  return m ? paradaDaPessoa(m) : null;
}

/**
 * Revisão 7 do PR #629 (definido em 2026-11-02): a tarefa que o laço ou o freio parou numa espera só sai dela pela pessoa,
 * pelo `responder` ou pelo agente num turno limpo da conversa com ela (`pelaPessoa`). O agente fora da conversa que a tira
 * com `mudar_tarefa` (ou removendo a coluna) zeraria a conta do laço e do freio. As `isentas` (a resposta, o
 * desfazer_movimento, que tem a mesma regra, e o "não é comigo", que não tira da espera) não passam por aqui.
 */
export function conferirSaidaDaEspera(p: {
  colunas: readonly ColunaQuadro[];
  antes: ReadonlyMap<string, Corte>;
  tarefas: readonly TarefaNoFreio[];
  tocadas: readonly string[];
  isentas: ReadonlySet<string>;
  historico: readonly MovimentoTarefa[];
  autor: AutorLote;
  pelaPessoa: boolean;
}): Erro | null {
  if (p.autor.tipo !== "agente" || p.pelaPessoa) return null;
  for (const id of p.tocadas) {
    const a = p.antes.get(id);
    const t = p.tarefas.find((x) => x.id === id);
    if (!a || !t || p.isentas.has(id) || !ESPERA.has(a.status) || ESPERA.has(t.status)) continue;
    const parada = paradaDaEspera(p.historico, id);
    if (parada === null) continue;
    return { erro: `tarefa "${t.titulo}": ${nomeDaParada(parada)} a parou em ${nomeDaColuna(p.colunas, a.status)} e só a pessoa a tira de lá: deixe a tarefa onde está e espere a resposta dela` };
  }
  return null;
}

/**
 * Revisão 8 do PR #629: excluir também tira a tarefa da espera (e zera o histórico dela). A mesma regra de
 * `conferirSaidaDaEspera`: parada pelo laço ou pelo freio, só a pessoa (ou o agente na conversa limpa, `pelaPessoa`) a
 * exclui. `status` = onde a tarefa estava no início do lote. null = pode.
 */
export function conferirExclusao(p: { colunas: readonly ColunaQuadro[]; tarefa: Pick<TarefaQuadro, "id" | "titulo">; status: IdColuna | undefined; historico: readonly MovimentoTarefa[]; autor: AutorLote; pelaPessoa: boolean }): string | null {
  if (p.autor.tipo !== "agente" || p.pelaPessoa || p.status === undefined || !ESPERA.has(p.status)) return null;
  const parada = paradaDaEspera(p.historico, p.tarefa.id);
  if (parada === null) return null;
  return `tarefa "${p.tarefa.titulo}": ${nomeDaParada(parada)} a parou em ${nomeDaColuna(p.colunas, p.status)} e só a pessoa a exclui: deixe a tarefa onde está e espere a resposta dela`;
}

/**
 * Revisão 7 do PR #629: a pergunta que o laço ou o freio pôs no card sai com a tarefa da espera (a resposta a mantém, como
 * qualquer resposta). Só a pergunta que não mudou no lote: a que o passo escreveu fica.
 */
export function limparPerguntaDoFreio(p: {
  antes: ReadonlyMap<string, Corte & Partial<Pick<TarefaQuadro, "pergunta">>>;
  tarefas: TarefaNoFreio[];
  tocadas: readonly string[];
  respondidas: ReadonlySet<string>;
  historico: readonly MovimentoTarefa[];
}): void {
  for (const id of p.tocadas) {
    const a = p.antes.get(id);
    const t = p.tarefas.find((x) => x.id === id);
    if (!a || !t || p.respondidas.has(id) || !ESPERA.has(a.status) || ESPERA.has(t.status) || t.pergunta === null || t.pergunta !== a.pergunta) continue;
    if (paradaDaEspera(p.historico, id) !== null) t.pergunta = null;
  }
}

/**
 * Os acionamentos do responsável nesta tarefa na última hora. No servidor a conta vem do banco (o mesmo relógio que grava
 * `criado_em`, revisão do PR #629: `quadrosRepo.acionamentosNaHora`); esta é a conta pura, para quem não tem banco.
 */
export function acionamentosNaHora(historico: readonly MovimentoTarefa[], tarefaId: string, agora: number): number {
  // Revisão 4 do PR #629: como no laço, a conta zera no último freio que levou a Bloqueado (o do comentário fica na
  // coluna: de = para, não zera). Sem isso, "responda para seguir" freava de novo no passo seguinte da mesma hora.
  // Revisão 6: o freio desfeito também corta (como o laço em `passagensEntre`).
  const desde = Math.max(-Infinity, ...historico.filter((m) => m.tarefaId === tarefaId && m.tipo === "freio" && m.de !== m.para).map((m) => m.criadoEm));
  return historico.filter((m) => m.tarefaId === tarefaId && m.acionou && m.criadoEm > agora - HORA && m.criadoEm > desde).length;
}

/** Revisão 8 do PR #629: o motivo do laço sem os nomes das colunas (o aviso de turno não confiável). */
export const MOTIVO_LACO_SEM_NOMES = `Laço: a tarefa foi e voltou entre duas colunas mais de ${LIMITE_IDAS_E_VOLTAS} vezes. Confira e diga o próximo passo.`;

/** Bloqueado, se o quadro tiver; senão esperando a pessoa (ADR-162: a marca, que não depende de coluna). */
const bloqueio = (colunas: readonly ColunaQuadro[]): IdColuna => (colunas.some((c) => c.id === "bloqueado") ? "bloqueado" : ESPERA_PESSOA);

/**
 * Depois de decidir quem começa: o laço (agentes levam a tarefa de novo entre as mesmas colunas, mais de 3 idas e voltas)
 * vai para Bloqueado; o freio (mais de 12 acionamentos na hora) vai para Bloqueado sem acionar. Muda as tarefas e
 * tira de `comecam` quem freou; devolve o tipo e o motivo de cada uma, para o histórico.
 */
export function frearDepois(p: {
  colunas: readonly ColunaQuadro[];
  antes: ReadonlyMap<string, Corte>;
  tarefas: TarefaNoFreio[];
  tocadas: readonly string[];
  comecam: string[];
  isentas: ReadonlySet<string>;
  historico: readonly MovimentoTarefa[];
  autor: AutorLote;
  agora: number;
  /** A conta do banco, por tarefa (ganha da conta pelo histórico quando vem). */
  acionamentos?: ReadonlyMap<string, number>;
}): Map<string, { tipo: "laco" | "freio"; motivo: string }> {
  const freadas = new Map<string, { tipo: "laco" | "freio"; motivo: string }>();
  const tirar = (id: string) => { const i = p.comecam.indexOf(id); if (i >= 0) p.comecam.splice(i, 1); };
  for (const id of p.tocadas) {
    const a = p.antes.get(id);
    const t = p.tarefas.find((x) => x.id === id);
    if (!a || !t || p.isentas.has(id) || p.autor.tipo !== "agente" || ESPERA.has(t.status)) continue;
    // Revisão 7 do PR #629: a saída de uma espera conta a partir de onde a tarefa foi esperar (como em passagensEntre).
    const de = origemDaTrava(a.status, a.voltarPara);
    if (de === t.status) continue;
    if (passagensEntre(p.historico, id, de, t.status) + 1 <= 2 * LIMITE_IDAS_E_VOLTAS) continue;
    const motivo = `Laço: a tarefa foi e voltou entre ${nomeDaColuna(p.colunas, de)} e ${nomeDaColuna(p.colunas, t.status)} mais de ${LIMITE_IDAS_E_VOLTAS} vezes. Confira e diga o próximo passo.`;
    // O passo 5 da jornada: Bloqueado (decisão 4 da Ada), sem acionar ninguém.
    esperar(t, bloqueio(p.colunas), motivo);
    tirar(id);
    freadas.set(id, { tipo: "laco", motivo });
  }
  for (const id of [...p.comecam]) {
    const t = p.tarefas.find((x) => x.id === id);
    if (!t || t.nova || (p.acionamentos ? p.acionamentos.get(id) ?? 0 : acionamentosNaHora(p.historico, id, p.agora)) < LIMITE_ACIONAMENTOS_HORA) continue;
    const motivo = `Freio: o responsável foi acionado mais de ${LIMITE_ACIONAMENTOS_HORA} vezes na última hora nesta tarefa. Parei sem acionar; responda para seguir.`;
    esperar(t, bloqueio(p.colunas), motivo);
    tirar(id);
    freadas.set(id, { tipo: "freio", motivo });
  }
  return freadas;
}

/**
 * O histórico do lote: um movimento por tarefa (já existente) que mudou de coluna ou de mão, ou que acionou o
 * responsável. A tarefa nova não entra (nasceu agora; o histórico é de movimentos).
 */
export function movimentosDoLote(p: {
  antes: ReadonlyMap<string, Corte>;
  tarefas: readonly TarefaNoFreio[];
  tocadas: readonly string[];
  acionaram: ReadonlySet<string>;
  tipos: ReadonlyMap<string, DadoDoMovimento>;
  autor: AutorLote;
}): NovoMovimento[] {
  const novos: NovoMovimento[] = [];
  for (const id of p.tocadas) {
    const a = p.antes.get(id);
    const t = p.tarefas.find((x) => x.id === id);
    if (!a || !t || t.nova) continue;
    const mudou = a.status !== t.status || a.agenteId !== t.agenteId;
    const acionou = p.acionaram.has(id);
    const dado = p.tipos.get(id);
    // Revisão 10 do PR #629: um `mover` que no fim do lote não mudou nada (ida e volta no mesmo lote) não é movimento.
    if (!mudou && !acionou && (!dado || dado.tipo === "mover")) continue;
    novos.push({
      tarefaId: id, tipo: dado?.tipo ?? (mudou ? "mover" : "acionou"), de: a.status, para: t.status, agenteAntes: a.agenteId, agenteDepois: t.agenteId,
      autor: p.autor, motivo: dado?.motivo ?? null, acionou, ...(dado?.desfaz ? { desfaz: dado.desfaz } : {}), ...(dado?.deFora && dado.motivo ? { deFora: true as const } : {}),
    });
  }
  return novos;
}
