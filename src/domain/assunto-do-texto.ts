import type { Assunto } from "../contracts/destino-no-chat.ts";
import type { Autoria } from "../contracts/evento.ts";
import type { KindMensagem, PayloadMensagem } from "../contracts/mensagem.ts";
import { MOTIVOS_FALHA, MOTIVOS_INTERRUPCAO } from "../contracts/motivos.ts";
import { assuntoDaInterrupcao, assuntoDe } from "./destino-no-chat.ts";
import { moldeDaRedacao, MOTIVO_SERVIDOR_NAO_RESPONDEU, motivoEmPortugues, type ChaveRedacao } from "./redacao.ts";

/**
 * O assunto de uma linha antiga pelo texto (definido em 2026-10-18, chat limpo, PR 1; ADR-114). Só o backfill usa
 * (scripts/backfill-assunto.ts): toda mensagem nova grava o assunto na escrita. Vale para as linhas sem payload — `sistema`
 * e o recibo automático (`resultado_aprovacao`); o resto sai do kind e do payload (assuntoDe).
 *
 * O texto inteiro tem de casar com UM molde (`{param}` é um trecho não vazio; `{resto}` pode ser vazio). O casamento só
 * precisa ser à prova de erro para os moldes que ficam no chat (rotina, criação do bot, turno órfão, turno que falhou,
 * retorno do lote): errar entre moldes que vão para a Atividade só troca o filtro, e o item continua em "Tudo". Sem
 * casamento: `sistema.generico` (Atividade); o `--seco` imprime quantos ficaram assim antes de gravar.
 *
 * Os moldes de fora do catálogo de redacao.ts são cópias dos textos dos casos de uso (o domínio não importa casos de uso);
 * tests/unit/domain/assunto-do-texto.test.ts gera cada texto pela função de verdade e confere o assunto, então mudar a
 * frase sem mudar o molde quebra o teste.
 */
type Classificador = Assunto | ((params: readonly string[]) => Assunto);
type Molde = { nome: string; molde: string; assunto: Classificador };

/** Os códigos que o aviso de interrupção traduz (motivoEmPortugues), para voltar da frase ao código. */
const MOTIVOS_DO_AVISO: readonly string[] = [...MOTIVOS_INTERRUPCAO, ...MOTIVOS_FALHA];

/**
 * O "Turno interrompido: {motivo}": a frase volta ao código do motivo e passa pela MESMA função do produtor
 * (assuntoDaInterrupcao), para a linha antiga ganhar o assunto que a nova grava. A frase da queda na VM
 * (motivoDaQuedaEmPortugues) é `maquina_sem_contato`; frase do fornecedor ou motivo que mudou de texto não volta a código
 * nenhum e fica no chat como falha, que é o lado seguro.
 */
function doTurnoInterrompido(params: readonly string[]): Assunto {
  const frase = params[0] ?? "";
  const codigo = MOTIVOS_DO_AVISO.find((m) => motivoEmPortugues(m) === frase)
    ?? (/^a máquina .+ parou de responder \(desligada, sem rede ou motor parado\)$/.test(frase) || frase === MOTIVO_SERVIDOR_NAO_RESPONDEU ? "maquina_sem_contato" : "desconhecido");
  return assuntoDaInterrupcao(codigo);
}

const DO_CATALOGO: readonly (readonly [ChaveRedacao, Classificador])[] = [
  ["turno-interrompido", doTurnoInterrompido],
  ["turno-orfao-encerrado", "turno.orfao"],
  ["turno-preso-sem-contato", "turno.orfao"],
  ["retorno-do-lote-caiu", "lote.retorno_caiu"],
  ["agente-nasceu", "agente.criado"],
  ["retomada", "turno.retomado"],
  ["retomada-automatica", "turno.retomado"],
  ["frente-retomada-automatica", "turno.retomado"],
  ["proposta-confirmada", "proposta.decidida"],
  ["proposta-recusada", "proposta.decidida"],
  ["anotei", "memoria.anotada"],
  ["decisao-vencida", "decisao.vencida"],
  ["cota-no-limite-espera", "cota.espera"],
  ["cota-no-limite-segue", "cota.espera"],
  ["conta-no-limite-espera", "cota.espera"],
  ["cota-no-limite-espera-pedido", "cota.espera"],
  ["conta-no-limite-espera-pedido", "cota.espera"],
  ["cota-no-limite-espera-rotina", "cota.espera"],
  ["cota-no-limite-rotina-nao-rodou", "cota.espera"],
  ["pedido-a-colega-espera-cota", "cota.espera"],
  // NOD-309: as outras quedas do fundo (erro do provedor, máquina, reinício).
  ["fundo-nova-tentativa", "fundo.espera"],
  ["fundo-espera-maquina", "fundo.espera"],
  ["fundo-espera-servidor", "fundo.espera"],
  ["rotina-nao-rodou", "rotina.adiada"],
  ["fala-no-limite-espera", "ia.fala_espera"],
  ["ia-pronta-noutra-maquina", "ia.fala_espera"],
  ["conta-fora-da-maquina", "conta.recusada"],
  ["rodando-desta-vez", "conta.nota"],
  ["tentando-de-novo", "conta.nota"],
];

const FORA_DO_CATALOGO: readonly Molde[] = [
  // criar-agente.ts e criar-bots.ts (mensagemDeNascimento): a primeira linha do bot novo.
  { nome: "agente-pronto", molde: "{nome} está pronto. O perfil que você definiu já está salvo; envie a primeira tarefa.", assunto: "agente.criado" },
  { nome: "agente-criado-por", molde: "Criado por {quem} a pedido de {pessoa} em {quando}. {nome} está pronto; envie a primeira tarefa.{resto}", assunto: "agente.criado" },
  // criar-bots.ts (linhaDoDesfecho) e onboarding.ts: a linha na conversa de quem criou.
  { nome: "bots-criados", molde: "{quem} criou {n} {bots} a pedido de {pessoa}: {nomes}.", assunto: "bot.criado" },
  { nome: "bot-criado", molde: "Bot {nome} criado.", assunto: "bot.criado" },
  // Rotinas (apoio-l7.ts textoRotinaAtiva, pausar-rotina.ts, aplicar-proposta-rotina.ts, rotinas-do-agente.ts,
  // decidir-acesso.ts). "Rotina pausada: {resto}" cobre também o rotina-pausada-sem-acesso do catálogo.
  { nome: "rotina-ativa", molde: `${moldeDaRedacao("rotina-proxima-execucao")}{resto}`, assunto: "rotina.evento" },
  { nome: "rotina-webhook-ativa", molde: moldeDaRedacao("rotina-webhook-ativa"), assunto: "rotina.evento" },
  { nome: "rotina-atualizada", molde: "Rotina atualizada. {resto}", assunto: "rotina.evento" },
  { nome: "rotina-excluida", molde: "Rotina excluída: {resumo}. Nada mais será disparado por ela.", assunto: "rotina.evento" },
  { nome: "rotina-pausada", molde: "Rotina pausada: {resto}", assunto: "rotina.evento" },
  { nome: "rotina-pausada-por-colega", molde: "{quem} pausou esta rotina a seu pedido: nada será disparado até você reativar.{resto}", assunto: "rotina.evento" },
  // receber-webhook.ts (NOD-84): a linha cinza de cada chamada que disparou a rotina.
  { nome: "rotina-webhook-disparou", molde: "O webhook do {provedor} disparou a rotina{resto}", assunto: "rotina.evento" },
  { nome: "rotina-mudou", molde: "Esta mudança não foi aplicada: a rotina mudou depois da proposta. Peça de novo ao bot.", assunto: "rotina.evento" },
  { nome: "rotina-adiada", molde: "Esta rotina não rodou nas últimas {n} janelas porque {resto}", assunto: "rotina.adiada" },
  { nome: "parada-encerrada", molde: "Parada encerrada: você usou Executar agora e a rotina voltou a rodar.", assunto: "parada" },
  { nome: "perfil-mudou", molde: "Esta mudança de perfil não foi aplicada: o perfil mudou depois da proposta. Peça de novo ao bot.", assunto: "proposta.obsoleta" },
  { nome: "pedido-de-acesso-aberto", molde: "Pedido aberto; nada foi concedido ainda.", assunto: "proposta.decidida" },
  // trabalhos.ts e domain/comandos.ts.
  { nome: "task-fechada", molde: "Fechei a task \"{titulo}\", parada esperando você, para liberar memória. Ela volta do mesmo ponto quando você responder.", assunto: "memoria.task_fechada" },
  { nome: "compactacao", molde: "Conversa compactada{resto}. {nome} continua daqui, com o resumo.", assunto: "compactacao" },
  { nome: "nova-sessao", molde: "Nova sessão · {nome} começa sem o que vocês conversaram até aqui. As mensagens continuam aqui para você.", assunto: "sessao.nova" },
  // Acesso e aprovação (revogar.ts, liberar-na-tarefa.ts, decidir.ts, gerir-bots.ts, mudar-modo-aprovacao.ts).
  { nome: "revogado", molde: "Revogado por {pessoa} em {quando}: {escopo}.", assunto: "acesso.revogado" },
  { nome: "liberado-na-tarefa", molde: "{pessoa} liberou {acoes} até o fim desta tarefa.", assunto: "acesso.concedido" },
  { nome: "aprovado-aguarda-mac", molde: "Aprovado. {n} seu Mac: com o app nod aberto e o gh logado, o GitHub recebe em instantes e o resultado aparece aqui.", assunto: "aprovacao.recibo" },
  { nome: "lote-recusado", molde: "Recusado: {n} {mudancas} nos seus bots.", assunto: "aprovacao.recibo" },
  { nome: "lote-feito-uma", molde: "{feitas} de {total} mudança feita.{resto}", assunto: "aprovacao.recibo" },
  { nome: "lote-feitas", molde: "{feitas} de {total} mudanças feitas.{resto}", assunto: "aprovacao.recibo" },
  { nome: "modo-aprovacao", molde: "{pessoa} mudou as aprovações de {bot} para {modo}: {efeito}", assunto: "aprovacao.modo" },
  // inteligencia.ts.
  { nome: "sem-ia-para-levar", molde: "Nenhuma IA está pronta agora na máquina do {bot}: as tasks em andamento ficaram onde estavam. Daqui em diante ele usa o Automático.", assunto: "inteligencia" },
  // ligacoes.ts (TEXTOS_FIM): o fim da ligação é parte da entrega "ligação".
  { nome: "ligacao-caiu", molde: "A ligação caiu{resto}", assunto: "ligacao" },
  { nome: "ligacao-encerrada", molde: "A ligação foi encerrada{resto}", assunto: "ligacao" },
  { nome: "ligacao-limite-diario", molde: "Você chegou ao limite de ligações de hoje.", assunto: "ligacao" },
  { nome: "ligacao-voz-fora", molde: "A voz está fora do ar agora. Tente de novo em alguns minutos.", assunto: "ligacao" },
  { nome: "ligacao-assinatura", molde: "Sua assinatura de IA chegou ao limite. A ligação foi encerrada.", assunto: "ligacao" },
  // Sala (criar-sala.ts, convidar-bot-para-sala.ts, postar-na-sala.ts, apoio-l7.ts TEXTO_DESFECHO).
  { nome: "sala-criada", molde: "Sala \"{nome}\" criada com {bots}. Sem menção, {primeiro} responde; @Nome dirige a pergunta.", assunto: "sala.evento" },
  { nome: "sala-entrou", molde: "{nome} entrou na sala. Nasce sem nenhum acesso por estar aqui.", assunto: "sala.evento" },
  { nome: "sala-sem-mencao", molde: "Ninguém foi mencionado: nesta sala só menção (@Nome) dispara resposta.", assunto: "sala.evento" },
  { nome: "sala-assentou", molde: "A rodada assentou: todos os bots presentes passaram a vez.", assunto: "sala.evento" },
  { nome: "sala-teto", molde: "A rodada encerrou pelo teto de encaminhamentos{resto}", assunto: "sala.evento" },
  { nome: "sala-ninguem", molde: "Ninguém disponível nesta rodada.", assunto: "sala.evento" },
];

/**
 * Versões antigas dos moldes que ficam no chat, tiradas do histórico dos arquivos. Conferido em 2026-10-18 (git log -S de
 * cada frase): os moldes de rotina, criação do bot, turno órfão, turno interrompido e retorno do lote não mudaram de texto
 * desde que nasceram; a pausa ganhou a frase do corte no fim (fdb6dfcd, 16/10), que o `{resto}` cobre, e o "Criado por"
 * só existe desde 15/10. O que sobrar sem casamento ainda é pego, na criação do bot, pela regra da primeira linha da
 * conversa (o backfill). Uma frase que mudar daqui em diante entra aqui com a forma de antes.
 * NOD-378 (2026-10-27): "Rotina ativa" perdeu o "({fuso})" do fim. A forma antiga não entra aqui porque o molde atual já
 * a casa (o `{proxima}` absorve o " (fuso)"), e um segundo molde faria o mesmo texto casar com dois; o teste cobre as duas.
 */
export const MOLDES_ANTIGOS: readonly Molde[] = [
  // decisao-vencida até e3bc7c86 (24/09): "decisão" e o desfecho entre parênteses. Ficou no chat na QA do PR 1 (pede ação:
  // "você pode reabrir"); sem este molde, a linha antiga caía em sistema.generico e sumia do chat na leitura do PR 2,
  // antes do backfill (revisão do PR 2, 18/10). Os outros que passaram para o chat na QA (conta.recusada,
  // ia.fala_espera, proposta.obsoleta) não mudaram de texto desde que nasceram (conferido no histórico, 18/10).
  { nome: "decisao-vencida-24-09", molde: "Esta decisão venceu em {quando} sem resposta ({desfecho}). Você pode reabrir.", assunto: "decisao.vencida" },
];

const escapar = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function compilar(molde: string): RegExp {
  const partes = molde.split(/(\{[a-zA-Z]+\})/);
  const corpo = partes.map((p) => (p === "{resto}" ? "[\\s\\S]*" : /^\{[a-zA-Z]+\}$/.test(p) ? "([\\s\\S]+?)" : escapar(p))).join("");
  return new RegExp(`^${corpo}$`);
}

type MoldeCompilado = { nome: string; re: RegExp; assunto: Classificador };

const COMPILADOS: readonly MoldeCompilado[] = [
  ...DO_CATALOGO.map(([chave, assunto]) => ({ nome: chave, re: compilar(moldeDaRedacao(chave)), assunto })),
  ...FORA_DO_CATALOGO.map((m) => ({ nome: m.nome, re: compilar(m.molde), assunto: m.assunto })),
  ...MOLDES_ANTIGOS.map((m) => ({ nome: `antigo:${m.nome}`, re: compilar(m.molde), assunto: m.assunto })),
];

/** Os nomes dos moldes que casam com o texto inteiro. O teste exige no máximo um para cada texto de exemplo. */
export function moldesQueCasam(texto: string): string[] {
  return COMPILADOS.filter((m) => m.re.test(texto)).map((m) => m.nome);
}

/** O recibo do que uma regra aprovou sozinha (pedir-aprovacao.ts textoAutomatico): fica no chat se um item falhou. */
function doReciboAutomatico(texto: string): Assunto | null {
  if (!texto.startsWith("Fiz sem perguntar (")) return null;
  return /: falhou na execucao$/m.test(texto) ? "aprovacao.automatica_falhou" : "aprovacao.automatica";
}

/** Uma linha antiga como o backfill a lê: o que a mensagem é, de quem decidiu e onde ela está. */
export type LinhaAntiga = {
  kind: KindMensagem;
  payload: PayloadMensagem | null;
  texto: string;
  decididoPor: Autoria["decidido_por"];
  tipoConversa: "propria" | "sala";
  /** É a primeira mensagem da conversa (a da criação do bot, criar-agente.ts). */
  primeiraDaConversa: boolean;
};

/**
 * O assunto de uma linha gravada antes da 0091, e se ela casou com algum molde (`semCasamento`: o `--seco` conta). Com
 * payload, o do payload. Sem payload, `sistema` e o recibo automático vão pelo texto; a primeira linha da conversa própria
 * é a criação do bot, qualquer que seja a frase (a regra cobre as versões antigas e o texto do bot que criou, ADR-104);
 * na sala, o que não casa é `sala.evento` (a sala não aplica a tabela). Recibo sem casamento fica no chat
 * (`aprovacao.recibo`); o resto sem casamento é `sistema.generico`. Fala: null.
 */
export function assuntoDaLinhaAntiga(l: LinhaAntiga): { assunto: Assunto | null; semCasamento: boolean } {
  if (l.payload) return { assunto: assuntoDe(l.kind, l.payload, { decidido_por: l.decididoPor }), semCasamento: false };
  if (l.kind !== "sistema" && l.kind !== "resultado_aprovacao") return { assunto: assuntoDe(l.kind, null, { decidido_por: l.decididoPor }), semCasamento: false };
  if (l.kind === "sistema" && l.tipoConversa === "propria" && l.primeiraDaConversa) return { assunto: "agente.criado", semCasamento: false };
  const pelo = assuntoDoTexto(l.texto);
  if (pelo) return { assunto: pelo, semCasamento: false };
  if (l.tipoConversa === "sala") return { assunto: "sala.evento", semCasamento: true };
  return { assunto: l.kind === "resultado_aprovacao" ? "aprovacao.recibo" : "sistema.generico", semCasamento: true };
}

/**
 * O assunto do texto de uma linha sem payload; null = nenhum molde casou. Com mais de um molde (não deveria acontecer:
 * o teste barra), vale o primeiro da lista, que é o do catálogo.
 */
export function assuntoDoTexto(texto: string): Assunto | null {
  const recibo = doReciboAutomatico(texto);
  if (recibo) return recibo;
  for (const m of COMPILADOS) {
    const achado = m.re.exec(texto);
    if (!achado) continue;
    return typeof m.assunto === "function" ? m.assunto(achado.slice(1)) : m.assunto;
  }
  return null;
}

/** Uma linha lida para a tela (a janela da conversa, a Atividade, o relato): o assunto gravado e o que o backfill lê. */
export type LinhaNaLeitura = Omit<LinhaAntiga, "tipoConversa"> & { assunto: string | null };

/**
 * O assunto de uma linha na LEITURA (definido em 2026-10-18, chat limpo, PR 2; ADR-114, emenda do PR 2): o gravado, ou,
 * com `assunto` nulo (linha de antes da 0091 que o backfill ainda não alcançou), o MESMO que o backfill gravaria
 * (assuntoDaLinhaAntiga: kind, payload, autoria e o texto contra os moldes). Assim o aviso antigo sai do chat na tela já no
 * deploy do PR 2, sem esperar o backfill; quando ele rodar, o gravado é igual e nada muda na tela. Só na conversa própria
 * (a sala não aplica a tabela). Fala continua null.
 */
export function assuntoNaLeitura(l: LinhaNaLeitura): string | null {
  if (l.assunto !== null) return l.assunto;
  return assuntoDaLinhaAntiga({ ...l, tipoConversa: "propria" }).assunto;
}
