import { fraseDaEsperaDaCota } from "./cota-da-ia.ts";
import type { ModoTurno } from "../contracts/plano-turno.ts";
import type { OrigemTurno } from "../contracts/turno.ts";

/**
 * A triagem na entrada (definido em 2026-10-12, ADR-099 itens 1, 1a e 8, issue I7 revista; decisão 9 do plano): o pedido
 * de um colega (`pedir_a_bot`) e o de uma rotina ("rodar <rotina>") entram como um turno CURTO do dono — a conversa do bot,
 * na faixa dela, sem trabalho —, depois das falas da pessoa na ordem do `reivindicar`. Nesse turno o dono decide: responde
 * já, abre frentes (`abrir_frentes`, o lote fica ligado ao turno), junta a uma frente que já mexe na mesma coisa
 * (`mandar_para_frente`) ou espera uma dependência. Regras puras; quem lê o banco e grava são os casos de uso.
 */

type TurnoDaFaixa = { origem: OrigemTurno; trabalhoId?: string | null };

/**
 * O turno que atende um pedido de colega na triagem do dono: origem `delegacao`, fora de trabalho. É o critério da I3 para
 * saber que um lote é de colega (pelo `aberto_por_turno_id`); quem pediu sai do `peer_pedido` ligado à raiz
 * (`pedidoDeColegaDoTurno`, src/use-cases/pedido-de-colega.ts), o mesmo que `entregarRespostaPeer` usa. O pedido de antes
 * (uma task de colega, ADR-083) tem trabalho e não é triagem.
 */
export function ehTriagemDeColega(t: TurnoDaFaixa): boolean {
  return t.origem === "delegacao" && !t.trabalhoId;
}

/**
 * As origens que nascem nos bastidores da conversa (definido em 2026-10-26, ADR-130): a triagem de rotina e de colega e o
 * pedido de colega de antes. A lista é a mesma do backfill da 0121.
 */
export const ORIGENS_DOS_BASTIDORES: readonly OrigemTurno[] = ["rotina", "delegacao", "peer"];

/**
 * O turno nasce nos bastidores da conversa do bot (definido em 2026-10-26, ADR-130)? A conversa tem duas faixas: a da
 * pessoa e a dos bastidores. Um turno da conversa (sem trabalho) só espera outro da MESMA faixa: a fala da pessoa nunca
 * espera a triagem de uma rotina ou de um colega, que não a ouve no meio (aceitaMensagemNaSessao), não usa a sessão do CLI
 * da conversa e não é promovida pela rede de 2 min. Sob procuração também é bastidor: a resposta vai a outra pessoa. A
 * retomada e a repetição herdam a faixa do turno que continuam (no INSERT, turnos.repo.ts `enfileirar`), não daqui.
 */
export function nasceNosBastidores(t: { origem: OrigemTurno; sobProcuracaoDe?: string | null }): boolean {
  return ORIGENS_DOS_BASTIDORES.includes(t.origem) || (t.sobProcuracaoDe ?? null) !== null;
}

/**
 * O turno é o que a pessoa espera agora (definido em 2026-10-27, ADR-131): a ligação, o que ela olha (`pessoa_esperando`)
 * e a faixa dela na conversa (sem trabalho, fora dos bastidores). A mesma régua do `soDaPessoa` do reivindicar
 * (turnos.repo.ts). O motor que se atualiza espera só estes acabarem; o resto (frente, rotina, colega) ele reinicia no
 * meio e o servidor retoma (`reinicio_do_motor`).
 */
export function daFaixaDaPessoa(t: { origem: OrigemTurno; pessoaEsperando?: boolean; trabalhoId?: string | null; bastidores?: boolean }): boolean {
  return t.origem === "ligacao" || t.pessoaEsperando === true || (!t.trabalhoId && t.bastidores !== true);
}

/**
 * O turno está na triagem (o prompt ganha as linhas dela): pedido de colega ou de rotina, fora de trabalho, com
 * `abrir_frentes` no catálogo. A retomada de um deles conta igual (ela continua o mesmo pedido, no mesmo modo).
 */
export function emTriagem(p: { modo: ModoTurno; trabalho: unknown; abreFrentes: boolean }): boolean {
  return (p.modo === "delegacao" || p.modo === "rotina") && (p.trabalho === null || p.trabalho === undefined) && p.abreFrentes;
}

/**
 * A pessoa está esperando o pedido? (ADR-085, revisão do #209): ele nasceu num turno dela — conversa, sala ou ligação,
 * fora de task. As frentes que o dono abre para esse pedido não são seguradas pelo Mac apertado; as de um pedido que
 * nasceu numa task, numa rotina ou noutro pedido de colega seguem a regra do segundo plano.
 */
export function pessoaEsperaOPedido(deQuemPediu: TurnoDaFaixa | null): boolean {
  return deQuemPediu !== null && !deQuemPediu.trabalhoId && ["conversa", "sala", "ligacao"].includes(deQuemPediu.origem);
}

/**
 * Um pedido de colega ainda sem resposta: `de` pediu a `para`. revisto em 2026-10-15 (NOD-259): com o pedido em si —
 * `tarefaId` (o turno de triagem do `handoff`), `criadoEm` e `texto` (o pedido, sem o contexto). A frente aberta para o
 * pedido de um colega (a outra fonte da espera circular) não tem pedido próprio: `tarefaId` e `texto` null — ela é o
 * mesmo pedido que o handoff já conta, e não entra na contagem por par (`pedidosDoPar`).
 */
export type PedidoAberto = { de: string; para: string; tarefaId: string | null; criadoEm: number; texto: string | null };

/**
 * NOD-259: quantos pedidos sem resposta de um bot ao MESMO colega bastam para recusar o próximo (`ja_pedido`). Abaixo
 * disso o pedido passa com o aviso dos que já estão abertos: pedidos distintos e legítimos ao mesmo colega não travam.
 */
export const TETO_PEDIDOS_ABERTOS_POR_PAR = 3;

/** Fuso do horário dos avisos de pedidos abertos quando quem lê não tem outro (NOD-259, suposição da issue). */
export const FUSO_PEDIDOS_ABERTOS = "America/Sao_Paulo";

/** Quantos pedidos abertos o prompt da rotina e da retomada lista, os mais recentes (NOD-259: lista longa não ajuda). */
export const MAX_PEDIDOS_NO_PROMPT = 5;

/** NOD-259: "o mesmo pedido" = o mesmo texto em minúsculas, sem espaço nas pontas e com os espaços de dentro colapsados. */
export function normalizarPedido(texto: string): string {
  return texto.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Os pedidos de verdade (do handoff) ainda abertos de `de` a `para`, do mais antigo ao mais recente. */
export function pedidosDoPar(abertos: readonly PedidoAberto[], de: string, para: string): PedidoAberto[] {
  return abertos.filter((p) => p.tarefaId !== null && p.de === de && p.para === para).sort((a, b) => a.criadoEm - b.criadoEm);
}

/**
 * A guarda contra o mesmo pedido repetido (NOD-259): dos pedidos ainda abertos de quem pede ao mesmo alvo, `recusa` se um
 * tem o mesmo texto (normalizado) ou se já são `TETO_PEDIDOS_ABERTOS_POR_PAR`; `aviso` com 1 ou 2 abertos; `livre` sem
 * nenhum. `desde` é o mais antigo dos abertos. A espera circular é checada antes e tem precedência.
 */
export type RepeticaoDoPedido =
  | { tipo: "livre" }
  | { tipo: "aviso"; abertos: number; desde: number }
  | { tipo: "recusa"; porque: "mesmo_texto" | "teto"; abertos: number; desde: number };

export function repeticaoDoPedido(abertos: readonly PedidoAberto[], remetente: string, alvo: string, texto: string): RepeticaoDoPedido {
  const doPar = pedidosDoPar(abertos, remetente, alvo);
  const primeiro = doPar[0];
  if (!primeiro) return { tipo: "livre" };
  const base = { abertos: doPar.length, desde: primeiro.criadoEm };
  const normal = normalizarPedido(texto);
  if (doPar.some((p) => p.texto !== null && normalizarPedido(p.texto) === normal)) return { tipo: "recusa", porque: "mesmo_texto", ...base };
  if (doPar.length >= TETO_PEDIDOS_ABERTOS_POR_PAR) return { tipo: "recusa", porque: "teto", ...base };
  return { tipo: "aviso", ...base };
}

/** "10:02" no mesmo dia de `agora` (no fuso); "14/10 10:02" em outro dia — um "desde 10:02" de ontem engana. */
export function horarioDoPedido(instante: number, agora: number, fusoIana: string = FUSO_PEDIDOS_ABERTOS): string {
  const hora = new Intl.DateTimeFormat("pt-BR", { timeZone: fusoIana, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(instante));
  const dia = (t: number) => new Intl.DateTimeFormat("pt-BR", { timeZone: fusoIana, day: "2-digit", month: "2-digit" }).format(new Date(t));
  return dia(instante) === dia(agora) ? hora : `${dia(instante)} ${hora}`;
}

function quantosPedidos(n: number): string {
  return n === 1 ? "1 pedido aberto" : `${n} pedidos abertos`;
}

/** O aviso que vai junto do pedido aceito (NOD-259) quando o mesmo colega já tem pedidos seus sem resposta. */
export function instrucaoPedidosAbertos(alvoNome: string, abertos: number, desde: string): string {
  return `Você já tem ${quantosPedidos(abertos)} a ${alvoNome} desde ${desde}, ainda sem resposta; não peça de novo o mesmo — a resposta chega a você num novo turno.`;
}

/** O que o bot lê quando o pedido é recusado por repetição (NOD-259, `ja_pedido`): nada saiu; o que fazer no lugar. */
export function instrucaoJaPedido(alvoNome: string, r: { porque: "mesmo_texto" | "teto"; abertos: number }, desde: string): string {
  const motivo = r.porque === "mesmo_texto"
    ? `Você já pediu isso a ${alvoNome} (desde ${desde}) e o pedido ainda está sem resposta.`
    : `Você já tem ${quantosPedidos(r.abertos)} a ${alvoNome} desde ${desde}, ainda sem resposta — o limite é ${TETO_PEDIDOS_ABERTOS_POR_PAR}.`;
  return `${motivo} Este pedido não foi enviado. Não peça de novo: as respostas chegam a você em novos turnos. Siga com o que você já tem e, se precisar, diga em uma frase o que está esperando de ${alvoNome}.`;
}

/** Um pedido aberto já com o nome de quem recebe, para o prompt. */
export type PedidoAbertoNoPrompt = { alvoNome: string; criadoEm: number; texto: string | null };

function resumoDoPedido(texto: string | null): string {
  if (!texto) return "";
  const uma = texto.replace(/\s+/g, " ").trim();
  return uma.length > 80 ? `: ${uma.slice(0, 79)}…` : `: ${uma}`;
}

/**
 * O bloco do prompt da rotina e da retomada (NOD-259): os pedidos que este bot fez a colegas e ainda esperam resposta,
 * com o horário, para ele não pedir de novo o mesmo a cada execução (cada janela da rotina é um fio novo e não via os
 * pedidos das anteriores). Até `MAX_PEDIDOS_NO_PROMPT`, os mais recentes; sem pedidos, nada (string vazia).
 */
export function blocoPedidosAbertos(pedidos: readonly PedidoAbertoNoPrompt[], agora: number, fusoIana: string = FUSO_PEDIDOS_ABERTOS): string {
  if (pedidos.length === 0) return "";
  const recentes = [...pedidos].sort((a, b) => b.criadoEm - a.criadoEm).slice(0, MAX_PEDIDOS_NO_PROMPT).reverse();
  const linhas = recentes.map((p) => `- a ${p.alvoNome}, às ${horarioDoPedido(p.criadoEm, agora, fusoIana)}${resumoDoPedido(p.texto)}`);
  const mais = pedidos.length > recentes.length ? [`- e mais ${pedidos.length - recentes.length} mais antigos`] : [];
  return [`Pedidos seus a colegas ainda sem resposta (a resposta chega em um novo turno; não peça de novo o mesmo):`, ...linhas, ...mais].join("\n");
}

/**
 * Espera circular (ADR-099 item 8): o pedido novo `remetente → alvo` fecha um ciclo se, pelos pedidos abertos, o alvo já
 * espera o remetente — direto (o alvo pediu ao remetente) ou em qualquer profundidade (o alvo pediu a X, que pediu ao
 * remetente). Busca em largura do alvo até o remetente. Devolve o caminho `[alvo, …, remetente]` ou null.
 */
export function cicloDoPedido(abertos: readonly PedidoAberto[], remetente: string, alvo: string): string[] | null {
  const saidas = new Map<string, string[]>();
  for (const p of abertos) saidas.set(p.de, [...(saidas.get(p.de) ?? []), p.para]);
  const veio = new Map<string, string | null>([[alvo, null]]);
  const fila = [alvo];
  while (fila.length > 0) {
    const atual = fila.shift() as string;
    if (atual === remetente) {
      const caminho: string[] = [];
      for (let p: string | null = atual; p !== null; p = veio.get(p) ?? null) caminho.unshift(p);
      return caminho;
    }
    for (const proximo of saidas.get(atual) ?? []) {
      if (veio.has(proximo)) continue;
      veio.set(proximo, atual);
      fila.push(proximo);
    }
  }
  return null;
}

function emLista(nomes: readonly string[]): string {
  return nomes.length <= 1 ? (nomes[0] ?? "") : `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

/**
 * O que o bot lê quando o pedido é recusado por espera circular. `caminho` são os nomes de `[alvo, …, remetente]`: o
 * último é quem está pedindo agora ("você"). O que fazer: não pedir, responder com o que tem e dizer o que falta.
 */
export function instrucaoEsperaCircular(caminho: readonly string[]): string {
  const alvo = caminho[0] ?? "o colega";
  const meio = caminho.slice(1, -1);
  const como = meio.length === 0 ? `${alvo} pediu algo a você e ainda espera a sua resposta` : `${alvo} pediu algo a ${meio.join(", que pediu a ")}, que pediu a você, e essa corrente ainda espera a sua resposta`;
  return `Espera circular: ${como}. Se você pedir a ${alvo} agora, um fica esperando o outro. Não peça: termine o que der com o que você já tem e, na sua resposta, diga o que falta e o que precisa de ${alvo} — a pergunta vai junto com a resposta.`;
}

/**
 * A resposta imediata a quem pediu (ADR-099 item 8): o pedido entrou na triagem do dono do outro bot, que decide se
 * responde já, abre uma frente ou espera algo de que depende; e, se houver, os colegas livres agora (sem turno vivo nem
 * frente rodando), para quem tem pressa.
 */
export function instrucaoPedidoRecebido(alvoNome: string, livres: readonly string[], cota?: { ia: string; situacao: "reserva" | "limite"; voltaEm: number | null; agora: number }): string {
  const base = `Pedido entregue a ${alvoNome}: entrou na triagem dele, que decide se responde já, se abre uma frente para o pedido ou se ele espera algo de que depende. A resposta chega a você num novo turno; diga em uma frase o que pediu e encerre, sem repetir o pedido.`;
  // NOD-302 (continuação da NOD-253): a cota da IA de quem recebe segura o pedido agora — quem pediu sabe a espera e a hora.
  const espera = cota ? ` Ele ainda não começa: ${fraseDaEsperaDaCota(cota)}. Diga isso a quem espera a resposta.` : "";
  return livres.length > 0 ? `${base}${espera} Livres agora: ${emLista(livres)} — se for urgente e ${alvoNome} estiver ocupado, um deles pode ajudar.` : `${base}${espera}`;
}

/**
 * A linha do prompt na triagem (definido em 2026-10-12, ADR-099 item 1a, I7 revista), no lugar da linha "Frentes:" do
 * dono: o turno é curto e decide — responder já, abrir frentes, juntar a uma frente que já mexe na mesma coisa ou
 * esperar. No pedido de colega o resultado das frentes vai direto a quem pediu (decisão 7); na rotina, volta ao dono.
 */
export function linhaDaTriagem(modo: "delegacao" | "rotina", remetente: string | null, comComando = false): string {
  const quem = remetente ?? "quem pediu";
  // Parte 2 da ADR-099: com terminal, a espera de algo de fora é um comando (esperar_comando); sem, a volta marcada.
  const volta = comComando ? "espere com esperar_comando (ou me_chame_as, para hora marcada)" : "marque a volta (me_chame_as)";
  return modo === "delegacao"
    ? `Triagem: este turno é a entrada de um pedido de ${quem} na sua fila, e é curto — decida e encerre; a conversa com a pessoa espera ele acabar. Olhe os Trabalhos em andamento e escolha: responda já, se for rápido; abra frentes para o pedido (abrir_frentes, numa chamada só), e o resultado delas vai direto a ${quem}; se uma frente aberta já mexe na mesma coisa, junte com mandar_para_frente em vez de abrir outra; se o pedido depende de algo que ainda não acabou, ${volta}. Ao juntar, sua resposta vai a ${quem} na hora: diga qual frente pegou o pedido e o que já se sabe, ou espere também, se ${quem} precisa do resultado dela. Ao esperar, encerre dizendo de que depende; ${quem} recebe a resposta quando você voltar. Trabalho longo não se faz aqui.`
    : `Triagem: esta execução da rotina é um pedido na sua fila, e o turno é curto. Olhe os Trabalhos em andamento: o que é rápido você faz aqui mesmo; trabalho longo vai para frentes (abrir_frentes, numa chamada só), e o resultado delas volta a você para fechar a execução; se uma frente aberta já mexe na mesma coisa, junte com mandar_para_frente em vez de abrir outra; se depende de algo que ainda não acabou, ${volta}.`;
}
