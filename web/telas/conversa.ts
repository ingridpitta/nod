import { avisoNaFila } from "../lib/executar-rotina.ts";
import { renderCardColunas } from "./card-colunas.ts";
import { renderCardImportacao } from "./card-importacao.ts";
import { renderCardAssumir } from "./card-assumir-quadro.ts";
import { renderCardApp } from "./card-app.ts";
import { renderCardQuadroExclusao } from "./card-quadro-exclusao.ts";
import { renderAnexosDaMensagem, type Aceita } from "../lib/anexos.ts";
import { lembrancaDaMidia, linhaRecusas, renderMidiasDoBot } from "../lib/midia.ts";
import type { FrotaDto, SuaVezDto } from "../../src/contracts/api.ts";
import type { Proposta } from "../../src/contracts/conversa.ts";
import type { Decisao } from "../../src/contracts/decisao.ts";
import type { Mensagem } from "../../src/contracts/mensagem.ts";
import type { TipoAnexo } from "../../src/contracts/anexo.ts";
import type { Inventario } from "../../src/contracts/inventario.ts";
import type { TarefaDoBot } from "../../src/contracts/turno.ts";
import type { ConversaEstado, Estado, FalaPendente, FalaSaindo, TurnoVivo } from "../estado/reducer.ts";
import { assinatura } from "../lib/assinatura.ts";
import { ICONE } from "../lib/icones.ts";
import { botao, dataHora, esc, hora, iconeAgente, paragrafos } from "../lib/render.ts";
import type { EstadoMascote } from "../lib/mascote.ts";
import { iaDoBotAgora, maquinaDoBot, presencaPorMaquina } from "./maquinas.ts";
import { outraMaquinaDestaVez } from "../lib/rodar-desta-vez.ts";
import { acordandoNaFila, motivoLegivel } from "../lib/maquina-nuvem.ts";
import { COMET_MS, contagemDasAcoes, estadoDaFala, falaNoBalao, geracaoDoBalao, GRUPOS_A_VISTA, itensDoPensamento, textoEmLf, textoEscrevendo, WINK_MS, type AtividadeTurno, type ItemDoPensamento, type LinhaDoResumo, type VigiaDaAtividade } from "../lib/atividade.ts";
import { linhaDaFila } from "../lib/fila-do-pedido.ts";
import { haQuanto } from "../lib/relogio.ts";
import { FALA_SAINDO_MS, tempoDaFala } from "../lib/fala-viva.ts";
import { textoFormatado } from "../lib/texto-formatado.ts";
import { dividirEmBaloes } from "../lib/baloes.ts";
import { estadoMascoteNaConversa, mascoteAnimado, turnosVivosDaConversa, turnosVivosDoChat } from "../lib/mascote.ts";
import { renderFaixaParada } from "./faixa-parada.ts";
import type { Morph } from "../lib/morph.ts";
import { htmlCartaoTela, htmlLinhaSenhaSalva, motivoDoPedidoDeTela } from "../lib/computador.ts";
import { htmlAvisoForaDoArRegistrado, htmlFio, htmlLinhaDoChat, htmlPedidoDeTela } from "../lib/computador-pessoa.ts";
import { cartaoDaPergunta, desenharFios, linhaDaRetomada, respostaPorOpcao, rotuloDaResposta, tempoDasLinhas, type LinhaDaConversa } from "./pergunta.ts";
import { comDivisores, type TempoDoBloco } from "./divisores-de-data.ts";
import { linhaNaoRodaram } from "../lib/execucao.ts";
import { chaveDoItem, estadoDaPergunta } from "../lib/perguntas.ts";
import { acoesComAcesso, vaiPoder } from "./rotina-precisa.ts";
import { cartaoNaoLidos, reciboLeitura } from "./nao-lidos-no-chat.ts";
import { avisoErro, cardProposta, de, doBot, linhaProposta, rotulada } from "../lib/card-proposta.ts";
import { cortar } from "../lib/avisos.ts";
import { nomeDoApp } from "./app-acesso.ts";
import { renderCardAcesso, tituloDoPedidoDeAcesso } from "./card-acesso.ts";
import { ehCartaoCredencial, renderCardCredencial } from "./card-credencial.ts";
import { acaoHumana, idsGemeas, marcaGemeas, marcaRotinaParada, pedidosAncoraveis, renderDecisaoAncorada, renderDecisoesDaConversa, rotulosAcesso } from "./sua-vez.ts";
import { renderCardPasta } from "./card-pasta.ts";
import { dadosDoEncolhido, pedidoDoRecibo, renderCartaoEncolhido, turnoDoEncolhido } from "./cartao-encolhido.ts";
import { renderCardLote } from "./card-lote.ts";
import { docaDePaginas, type PedirApp } from "./paginas.ts";
import type { Pagina } from "../lib/paginas.ts";
import { idsNoPerfil, renderCardPerfil } from "./card-perfil.ts";
import { renderCardArtefato } from "./card-artefato.ts";
import { faixaDaMensagem } from "./modo-dev.ts";
import { HTML_CHIP_MODO } from "./aprovacoes.ts";
import { HTML_SELETOR_IA } from "./seletor-ia.ts";
import { avisoDeEstado } from "../lib/aviso-estado.ts";
import { inventarioEmUso } from "./frota.ts";
import { cartaoRitmoRotina } from "./ritmo-rotina.ts";
import { cartaoAjusteBarra } from "./card-barra.ts";
import { lerBarra } from "../lib/densidade.ts";
import { ehCelular } from "../lib/celular.ts";
import { alvosDoRecomeco, marcaDoRecomeco, notaDasEtapas, type AlvoDoRecomeco } from "../lib/recomeco.ts";
import { cardDaConversa, ehFalaSemIa, falaSemIaHtml, iasNoCard, turnosVivosDe } from "./sem-ia-conversa.ts";
import { avisoContaSemAcesso, avisoHarnessFora, avisoModeloRecusado, ehIa, inventarioDaIa, cartaoTrocaDeIa, linhaContaSeguiu, linhaContaTrocada, linhaIaDoBotTrocada, linhaIaTrocada, linhaIaVoltou, linhaLimiteSemOutra, prontaDepois, type IdIa } from "./ia-fora.ts";
import { escolhaEfetiva, iasDaTela, inteligenciaDoBot } from "./inteligencia.ts";
import { htmlBotaoDitado, htmlPilulaDitado } from "./ditado.ts";
import { renderLinhaLigacao } from "./ligacao.ts";
import { conversaLimpa, emOrdemDoChat, htmlTroca, juntarTrocas, lugarDosBastidores, NENHUM_TURNO_VIVO, planejarLinhas, type PlanoMensagem, type TurnosDaPessoaVivos } from "./linhas-do-chat.ts";
import { trabalhosConhecidos } from "../lib/trabalhos.ts";
import { TEXTO_FALHA_LEITURA } from "../lib/ouvir.ts";
import { acoesDaFala, chipsDeReacao, citacaoAcimaDoBalao } from "./acoes-da-fala.ts";
import { desfazerDaFala } from "./desfazer.ts";
import { ancorasDoProgresso, comProgressoNaFala, marcadorDoProgresso } from "./progresso-na-fala.ts";
import { ancorasDoModo, renderLinhaDoModo } from "./linha-do-modo.ts";
import { ROTULO_SUGESTAO } from "../lib/rotina-no-chat.ts";

/** id → nome (agentes da frota + a pessoa da sessão); id desconhecido cai no genérico, nunca no uuid. */
export function nomesDe(estado: Estado): Record<string, string> {
  const mapa: Record<string, string> = {};
  for (const a of estado.frota?.agentes ?? []) mapa[a.id] = a.nome;
  if (estado.sessao) mapa[estado.sessao.pessoaId] = "você";
  return mapa;
}

function agenteDe(estado: Estado, id: string): FrotaDto["agentes"][number] | undefined {
  return [...(estado.frota?.agentes ?? []), ...(estado.gestao?.agentes ?? [])].find((a) => a.id === id && !a.excluidoEm);
}

/** A maior versão do artefato entre as mensagens carregadas da conversa: as anteriores ficam recolhidas. */
function versaoMaisRecente(estado: Estado, conversaId: string, artefatoId: string, piso: number): number {
  let n = piso;
  for (const m of estado.conversas[conversaId]?.mensagens ?? []) if (m.payload?.kind === "artefato" && m.payload.artefatoId === artefatoId && m.payload.versao > n) n = m.payload.versao;
  return n;
}

/**
 * Ouvir uma resposta (NOD-106): só em fala de texto terminada de bot PRÓPRIO, fora de sala, sem artefato, e com a
 * disponibilidade dizendo `ouvir: true` (ausente ou false = o botão nem é desenhado). "Próprio" é a mesma regra que
 * busca a disponibilidade (reducer.ts, `disponibilidade:`): `ownerId === sessao.pessoaId`.
 */
export function podeOuvir(m: Mensagem, estado: Estado, sala: boolean): boolean {
  if (sala || m.kind !== "texto" || m.parcial || m.payload?.kind === "artefato") return false;
  if (m.autoria.autor_tipo !== "agente") return false;
  const pessoaId = estado.sessao?.pessoaId;
  if (!pessoaId || !estado.frota?.agentes.some((a) => a.id === m.autoria.autor_id && a.ownerId === pessoaId && !a.excluidoEm)) return false;
  return estado.disponibilidadeLigacao[m.autoria.autor_id]?.ouvir === true;
}

const IC_OUVIR = {
  ouvir: '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><path d="M4 9.5h3l4.5-4v13L7 14.5H4z"/><path d="M15.5 9a4 4 0 010 6M18 6.5a7.5 7.5 0 010 11"/></svg>',
  carregando: '<svg aria-hidden="true" class="ouvir-spin" viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8 2a6 6 0 106 6"/></svg>',
  tocando: '<svg aria-hidden="true" class="ouvir-barras" viewBox="0 0 16 16" width="13" height="13" fill="currentColor"><rect x="2" y="3" width="2.4" height="10" rx="1.2"/><rect x="6.8" y="3" width="2.4" height="10" rx="1.2"/><rect x="11.6" y="3" width="2.4" height="10" rx="1.2"/></svg><svg aria-hidden="true" class="ouvir-parar" viewBox="0 0 16 16" width="13" height="13" fill="currentColor"><rect x="3.5" y="3.5" width="9" height="9" rx="2"/></svg>',
  info: '<svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="8" cy="8" r="6.2"/><path d="M8 7.2v4"/><path d="M8 4.9v.1"/></svg>',
} as const;

/**
 * O botão Ouvir (protótipo do Gil, 16/10). HTML à mão porque `botao()` não tem aria-busy, aria-disabled nem
 * aria-describedby. Ocioso: alto-falante. Carregando/tocando: pílula "Parar" (o ícone diz o estado, a palavra a ação),
 * `aria-busy` só no carregando. Ligação viva: `aria-disabled` (continua focável e mostra o motivo), NUNCA `disabled`.
 * Nunca `aria-pressed`: o rótulo já muda, e os dois juntos fazem o leitor dizer "Parar de ouvir, pressionado".
 */
function botaoOuvir(m: Mensagem, estado: Estado): string {
  const id = esc(m.id);
  const ativa = estado.leitura?.mensagemId === m.id ? estado.leitura : null;
  if (ativa) {
    const carregando = ativa.fase === "carregando";
    return `<button type="button" class="bt ouvir-ativo ouvir-${ativa.fase}" data-act="ouvir-mensagem" data-id="${id}" aria-label="Parar de ouvir" title="Parar de ouvir"${carregando ? ' aria-busy="true"' : ""}>${carregando ? IC_OUVIR.carregando : IC_OUVIR.tocando}<span>Parar</span></button>`;
  }
  if (estado.ligacaoViva) {
    const dica = `dica-ouvir-${id}`;
    return `<span class="ouvir-wrap"><button type="button" class="bt" data-act="ouvir-mensagem" data-id="${id}" aria-label="Ouvir a resposta" aria-disabled="true" aria-describedby="${dica}">${IC_OUVIR.ouvir}</button><span class="ouvir-dica" id="${dica}" role="tooltip">Desligue a ligação para ouvir</span></span>`;
  }
  return `<button type="button" class="bt" data-act="ouvir-mensagem" data-id="${id}" aria-label="Ouvir a resposta" title="Ouvir a resposta">${IC_OUVIR.ouvir}</button>`;
}

/** "Não deu para ouvir agora." embaixo do balão que falhou antes do primeiro som (sai em 6 s ou no próximo clique). */
function avisoDeLeitura(m: Mensagem, estado: Estado): string {
  return estado.falhaLeitura?.mensagemId === m.id ? `<div class="msg-aviso" role="status">${IC_OUVIR.info}${TEXTO_FALHA_LEITURA}</div>` : "";
}

// Ações na fala (ADR-042; desde 2026-10-18, ADR-113): reagir, responder, reportar e ⋯ moram em ./acoes-da-fala.ts.

/**
 * NOD-106: o Ouvir entra na barra de ações da fala (ADR-113), ANTES das outras (a ação mais comum primeiro); com a
 * leitura ativa, a barra mostra só a pílula "Parar", para ela não pular.
 */
function acoesDaMensagem(m: Mensagem, estado: Estado, sala: boolean): string {
  const ouvir = podeOuvir(m, estado, sala) ? botaoOuvir(m, estado) : "";
  if (ouvir !== "" && estado.leitura?.mensagemId === m.id) return `<div class="msg-actions" role="group" aria-label="Ações da mensagem">${ouvir}</div>`;
  return acoesDaFala(m, estado, ouvir);
}

// ---------------------------------------------------------------- recibos das decisões

/**
 * Recibos (definido em 2026-10-03, revisão da conversa "depois"): depois de decidir, a conversa ganhava parágrafos
 * soltos — "Marlon aprovou 0 de 3; não enviado: … (falhou na execução)", "Marlon permitiu para sempre:
 * googlesheets.update_values. Vale já…". Agora cada um é UMA linha: quem decidiu, o quê e como terminou, com o
 * detalhe por item recolhido. O texto redigido continua gravado (e no title) para quem lê a conversa crua.
 * revisto em 2026-10-18 (chat limpo, PR 4): o recibo com payload vira o cartão encolhido, no lugar do pedido
 * (web/telas/cartao-encolhido.ts). Ficam aqui as linhas sem cartão: o recibo automático sem payload e o "permitiu para
 * sempre" de antes de 18/10, sem payload.
 */
const IC_RECIBO = {
  ok: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 8.5 2.5 2.5L12 5.5"/></svg>',
  regra: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="7.5" width="9" height="6" rx="1.5"/><path d="M5.5 7.5V5.5a2.5 2.5 0 0 1 4.9-.7"/></svg>',
} as const;

function quemDecidiu(m: Mensagem, estado: Estado): string {
  if (m.autoria.autor_id === estado.sessao?.pessoaId) return "Você";
  const nome = nomesDe(estado)[m.autoria.autor_id];
  return nome ? nome.charAt(0).toUpperCase() + nome.slice(1) : "Alguém";
}

/** Resultado sem payload (o que uma regra aprovou sozinha, itens-na-maquina.ts): a mesma linha, com o texto inteiro. */
function reciboSemDetalhe(m: Mensagem): string {
  return `<div class="recibo recibo-ok" title="${esc(m.texto)}"><span class="recibo-ic">${IC_RECIBO.ok}</span><span class="recibo-txt">${esc(m.texto)}</span></div>`;
}

/** "{pessoa} permitiu para sempre: a.b, c.d. Vale já…" (redacao.ts permissao-permanente) vira "Regra nova · sempre permitir editar no Google Sheets". Só as antigas: desde 2026-10-18 a regra tem payload (`regra_permanente`) e encolhe. */
const PERMITIU = /^(.+?) permitiu para sempre: (.+?)\. Vale já/;

function reciboDaRegra(m: Mensagem, estado: Estado): string | null {
  const achado = PERMITIU.exec(m.texto);
  if (!achado) return null;
  const acoes = (achado[2] ?? "").split(", ").map((n) => {
    const ponto = n.indexOf(".");
    return ponto > 0 ? acaoHumana(estado.conectores, n.slice(0, ponto), n.slice(ponto + 1)) : n;
  });
  const quem = quemDecidiu(m, estado);
  return `<div class="recibo recibo-regra" title="${esc(m.texto)}"><span class="recibo-ic">${IC_RECIBO.regra}</span><span class="recibo-txt"><b>${quem === "Você" ? "Regra nova" : `Regra nova de ${esc(quem)}`}</b> · sempre permitir ${esc(acoes.join(" e "))}</span></div>`;
}

/**
 * "Anotei uma preferência: …" com o caminho para a memória (definido em 2026-10-03, canvas "Uma conversa de verdade ·
 * depois"): ver o que o bot aprendeu dá confiança no que ele vai lembrar. A linha é `sistema` sem payload
 * (src/use-cases/lembrar.ts), então se reconhece pelo começo do texto; as gravadas antes de 2026-10-03 diziam o enum
 * cru ("Anotei como preferencia") e são lidas na frase nova.
 */
const ANOTEI = /^Anotei (?:como (preferencia|fato|resumo)|(uma preferência|um fato|um resumo)): /;
const TIPO_ANTIGO: Record<string, string> = { preferencia: "uma preferência", fato: "um fato", resumo: "um resumo" };

function linhaDaMemoria(m: Mensagem, estado: Estado): string | null {
  const achado = ANOTEI.exec(m.texto);
  if (!achado) return null;
  const tipo = achado[2] ?? TIPO_ANTIGO[achado[1] ?? ""] ?? "";
  const agenteId = m.autoria.autor_tipo === "agente" ? m.autoria.autor_id : undefined;
  const agente = agenteId ? agenteDe(estado, agenteId) : undefined;
  const ver = agente ? ` ${botao("ir-memoria", "Ver na memória", { classe: "link sm", id: agente.id, dados: { aba: "historico" } })}` : "";
  return `<div class="msg-sistema msg-memoria">${paragrafos(`Anotei ${tipo}: ${m.texto.slice(achado[0].length)}`)}${ver}</div>`;
}

function corpoMensagem(m: Mensagem, estado: Estado): string {
  const p = m.payload;
  if (p?.kind === "computador_fora_do_ar") {
    // definido em 2026-09-24 (emenda da ADR-037): o aviso ÚNICO vira cartão de estado, com a hora local e
    // as duas saídas; depois que o computador volta, o cartão fica como registro, sem botões.
    const bot = agenteDe(estado, p.agenteId);
    // NOD-96 (v2): o card leve, com "Tentar de novo · Ver computador do bot"; o computador é da pessoa, não do bot.
    if (estado.computadorPessoa && bot?.ownerId === estado.sessao?.pessoaId) return htmlAvisoForaDoArRegistrado(estado.computadorPessoa);
    const aindaFora = Boolean(bot?.computadorForaDoAr);
    const dono = bot?.ownerId === estado.sessao?.pessoaId;
    // NOD-399: o aviso neutro (círculo com "!", uma frase, botões normais); depois que volta, a linha com ✓.
    if (bot && !aindaFora) return linhaProposta({ tipo: "ok", texto: `O computador do bot voltou a responder <span class="mudo">· ficou fora desde ${esc(dataHora(p.desde))}</span>`, classe: "msg-computador-fora" });
    const acoes = aindaFora && dono ? `${botao("religar-computador", "Tentar de novo", { id: p.agenteId, classe: "cp-acao sm" })}${botao("abrir-computador", "Abrir computador", { id: p.agenteId, classe: "cp-acao sm" })}` : "";
    return avisoErro({ frase: `Computador do bot fora do ar desde ${dataHora(p.desde)}.`, ...(m.texto.trim() ? { mais: m.texto.trim() } : {}), acoes, classe: "msg-computador-fora" });
  }
  // NOD-97 PR 5: o Chrome preencheu a senha salva; a linha cinza leva o selo "‹bot› não vê a senha".
  if (p?.kind === "computador_senha_preenchida") return htmlLinhaSenhaSalva(agenteDe(estado, p.agenteId)?.nome ?? "O bot");
  // definido em 2026-09-28 (ADR-051): o card do artefato; o iframe entra depois do render (telas/artefatos-vivos.ts).
  if (p?.kind === "artefato") return renderCardArtefato(m, p, versaoMaisRecente(estado, m.conversaId, p.artefatoId, p.versao));
  // definido em 2026-10-04 (ADR-075): a linha "Chat de voz · mm:ss"; a ligação aberta nesta página oferece voltar a ela.
  if (p?.kind === "ligacao") return renderLinhaLigacao(m, p, estado.ligacaoViva?.local === true && estado.ligacaoViva.ligacaoId === p.ligacaoId);
  // NOD-119 (C1): o card que propõe mudar a barra lateral; a barra é deste computador, então lê a daqui.
  if (m.kind === "sistema" && p?.kind === "ajuste_barra") {
    return cartaoAjusteBarra(m, { barra: lerBarra(), celular: ehCelular() }) ?? "";
  }
  // NOD-449: o card dos não lidos e o recibo de "marcada como lida", da ferramenta nao_lidos de qualquer bot.
  if (m.kind === "sistema" && p?.kind === "nao_lidos_lista") return cartaoNaoLidos(p, estado);
  if (m.kind === "sistema" && p?.kind === "recibo_leitura") return reciboLeitura(m, p);
  // ADA-13 (ADR-150): o canvas publicado pelo bot (só ids e contagens); Abrir leva à página Canvas do bot.
  if (p?.kind === "canvas") {
    const meta = `v${p.versao} · ${p.jornadas} jornada${p.jornadas === 1 ? "" : "s"} · ${p.telas} tela${p.telas === 1 ? "" : "s"}${p.importado ? " · importado" : ""}`;
    return `<div class="cv-card" data-canvas="${esc(p.canvasId)}"><span class="cv-card-ic" aria-hidden="true"></span><span class="cv-card-txt"><b>${esc(p.titulo)}</b><span>${esc(meta)}${p.confiavel === false ? ' · <span class="cv-fora">não confiável</span>' : ""}</span></span>${botao("abrir-canvas", "Abrir", { classe: "cv-bt sm", id: p.canvasId, dados: { agente: p.agenteId } })}</div>`;
  }
  // ADA-28 (ADR-159, U1/U7): a linha cinza que aponta para a tarefa; o código abre a tarefa no quadro.
  if (p?.kind === "tarefa_linha") return linhaDaTarefa(m, p);
  if (m.kind === "sistema") return cartaoRitmoRotina(m) ?? linhaDeIa(m, estado) ?? linhaDaMemoria(m, estado) ?? linhaDoTurnoPreso(m, estado) ?? `<div class="msg-sistema">${paragrafos(m.texto)}</div>`;
  if (p?.kind === "handoff") {
    // definido em 2026-09-24 (ADR-047): a tarefa delegada assina "Taga · por você" — autoria composta (ADR-023).
    const de = m.autoria.sob_procuracao_de ? assinatura(m.autoria, nomesDe(estado)) : agenteDe(estado, p.de)?.nome ?? "agente";
    const para = agenteDe(estado, p.para)?.nome ?? "agente";
    const alvo = agenteDe(estado, p.para);
    return `<div class="msg-handoff"><div class="handoff-titulo">↗ <b>${esc(de)} → ${esc(para)}</b><span>${p.tarefaId ? "pedido a colega" : "passou a vez"}</span></div><p>${esc(p.motivo)}</p>${p.fila ? `<small class="mudo handoff-fila" role="status">${esc(linhaDaFila(p.fila))}</small>` : ""}${alvo ? botao("abrir-conversa", "Ver conversa de " + esc(para), { classe: "link", dados: { conversa: alvo.conversaId, agente: alvo.id } }) : ""}</div>`;
  }
  if (p?.kind === "passe") return `<div class="msg-passe">⏭ ${paragrafos(m.texto)} <span class="tag tag-cinza">${esc(p.motivo.replaceAll("_", " "))}</span></div>`;
  if (p?.kind === "consentimento") {
    // definido em 2026-09-24 (ADR-044): um consentimento cobre um LOTE; as mensagens anteriores têm uma capacidade só.
    const caps = "capacidades" in p ? p.capacidades : [p.capacidade];
    return `<div class="msg-consentimento"><b>Acesso permitido · ${esc(p.slug)}</b><div>${caps.length === 1 ? esc(caps[0] ?? "") : `${caps.length} ações`}</div><details data-disclosure="consentimento-${esc(m.id)}"><summary>Ver registro de autorização</summary>${paragrafos(m.texto)}</details></div>`;
  }
  if (p?.kind === "rotina_execucao") return `<div class="msg-rotina msg-rotina-${esc(p.desfecho)}">${paragrafos(m.texto)}</div>`;
  if (m.kind === "resultado_aprovacao") return reciboSemDetalhe(m);
  if (m.kind === "consentimento" && !p) return reciboDaRegra(m, estado) ?? `<div class="msg-sistema">${paragrafos(m.texto)}</div>`;
  if (p?.kind === "negacao" && p.classe === "plano_ausente") return avisoSemExecutor(m, estado);
  if (p?.kind === "negacao") return `<div class="negacao negacao-${esc(p.classe)}">${paragrafos(m.texto)}${p.terminal ? ' <span class="tag tag-ambar">terminal</span>' : ""}</div>`;
  if (p?.kind === "parada") return `<div class="msg-parada">■ ${paragrafos(m.texto)}</div>`;
  // definido em 2026-10-08 (protótipo "Nod — tempo da task", aprovado): o colega que não terminou vira UMA linha discreta;
  // o motivo e o atalho para a task dele ficam atrás de "detalhes".
  if (p?.kind === "peer_ask" && p.falhou) {
    const motivo = m.texto.replace(/^[\s\S]*?não concluiu:\s*/, "");
    const link = p.trabalhoId ? `<button type="button" class="pf-link" data-act="abrir-trabalho" data-id="${esc(p.trabalhoId)}">Ver a task do ${esc(p.nome)}</button>` : "";
    return `<div class="msg-peer-falhou"><details data-disclosure="peer-falhou-${esc(m.id)}"><summary><span>${esc(p.nome)} não conseguiu terminar o pedido</span><span class="pf-detalhes">detalhes</span></summary><div class="pf-corpo"><span>${esc(motivo)}</span>${link}</div></details></div>`;
  }
  if (p?.kind === "peer_ask") return `<div class="msg-peer"><div class="handoff-titulo">↙ <b>${p.falhou ? "Não concluído por" : "Resposta de"} ${esc(p.nome)}</b></div><div>${textoFormatado(m.texto, { chave: m.id })}</div><small class="mudo">Contribuição de outro bot · confira as fontes</small></div>`;
  const naoConfiavel = m.confianca === "nao_confiavel" ? ' <span class="tag tag-ambar" title="conteúdo de conector ou de outro bot">não confiável</span>' : "";
  return `<div class="msg-texto">${paragrafos(m.texto)}${naoConfiavel}${m.parcial ? ' <span class="tag tag-cinza">parcial</span>' : ""}</div>`;
}

/**
 * ADA-28 (ADR-159): "ADA-28 precisa de você · abrir" / "Faustino terminou ADA-28 · abrir". O texto gravado é a frase
 * inteira (o servidor a escreve com o nome do bot e da etapa); o código vira botão que abre a tarefa no quadro do bot
 * dono (o mesmo `abrir-tarefa-quadro` do código na resposta, NOD-430). Tarefa removida: o clique cai no erro de sempre.
 */
export function linhaDaTarefa(m: Pick<Mensagem, "texto" | "criadoEm">, p: Extract<NonNullable<Mensagem["payload"]>, { kind: "tarefa_linha" }>): string {
  const texto = m.texto.trim() || (p.motivo === "precisa" ? `${p.codigo} precisa de você` : `${p.codigo} andou`);
  const i = texto.indexOf(p.codigo);
  const antes = i >= 0 ? texto.slice(0, i) : "";
  const depois = i >= 0 ? texto.slice(i + p.codigo.length) : ` ${texto}`;
  const codigo = `<button type="button" class="linha-link md-tarefa-link" data-act="abrir-tarefa-quadro" data-agente="${esc(p.agenteId)}" data-tarefa="${esc(p.tarefaId)}" aria-label="Abrir tarefa ${esc(p.codigo)} no quadro">${esc(p.codigo)}</button>`;
  return `<div class="linha-centro-wrap"><span class="linha-centro estatica linha-tarefa linha-tarefa-${p.motivo}" data-tarefa="${esc(p.tarefaId)}">${esc(antes)}${codigo}${esc(depois)}<span class="linha-hora">· ${esc(hora(m.criadoEm))}</span></span></div>`;
}

/**
 * NOD-314 (definido em 2026-10-20): o pedido tirado da fila porque a máquina do bot ficou 24 h sem contato. Com outra
 * máquina conectada e com IA pronta, um único "Rodar em <outra> desta vez" refaz aquele turno lá, uma vez (o mesmo
 * `rodar-desta-vez` da nota, com o turno da linha); sem outra viva, só o texto.
 */
export function linhaDoTurnoPreso(m: Mensagem, estado: Pick<Estado, "maquinas" | "contasIa" | "agora" | "conversas" | "trabalhoDetalhe"> & Partial<Pick<Estado, "turnosRefeitos">>): string | null {
  const p = m.payload;
  if (p?.kind !== "turno_preso") return null;
  // QA do NOD-314: só a máquina em que o servidor aceita refazer (com conta pronta) e só até refazer — o refazer deixa uma
  // linha de sistema do MESMO turno depois desta ("Rodando em <máquina> desta vez"); com ela, o atalho some.
  // QA do NOD-314 (achado 2): com o turno fixado numa IA, só a máquina com conta DELA (o servidor recusa as outras).
  const outra = outraMaquinaDestaVez(estado, p.maquinaId, p.ia);
  const botao = outra && m.turnoId && !turnoPresoJaRefeito(m, estado)
    ? ` <button type="button" class="linha-link" data-act="rodar-desta-vez" data-conversa="${esc(m.conversaId)}" data-maquina="${esc(outra.id)}" data-turno="${esc(m.turnoId)}">Rodar em ${esc(outra.nome)} desta vez</button>`
    : "";
  return `<div class="msg-sistema">${paragrafos(m.texto)}${botao}</div>`;
}

/** QA do NOD-314: o turno da linha já foi refeito? Há outra linha de sistema do mesmo turno, depois desta. */
function turnoPresoJaRefeito(m: Mensagem, estado: Pick<Estado, "conversas" | "trabalhoDetalhe"> & Partial<Pick<Estado, "turnosRefeitos">>): boolean {
  // O servidor já disse "ja_refeito" a um clique nesta sessão (a linha do refazer pode ser antiga, da Atividade): some.
  if (m.turnoId && estado.turnosRefeitos?.includes(m.turnoId)) return true;
  const vistas = [...(estado.conversas[m.conversaId]?.mensagens ?? []), ...Object.values(estado.trabalhoDetalhe).flatMap((d) => d.mensagens)];
  return vistas.some((x) => x.id !== m.id && x.turnoId === m.turnoId && x.kind === "sistema" && x.criadoEm >= m.criadoEm);
}

/**
 * As linhas de IA do plano das IAs (2026-10-10): a troca de IA (tela 3) e o limite sem outra IA pronta (tela 4). Leem o
 * bot que falou (o modelo dele na IA que assumiu; se está em "Uma IA só") e o estado das IAs (do Mac ou do servidor).
 */
function linhaDeIa(m: Mensagem, estado: Estado): string | null {
  const p = m.payload;
  const recomeco = alvosDaVez.get(m.id);
  if (p?.kind === "conta_trocada") return linhaContaTrocada(m, recomeco);
  if (p?.kind === "conta_seguiu" || p?.kind === "conta_escolhida") return linhaContaSeguiu(m, recomeco);
  // ADR-108 (R4/R6): o aviso de troca de IA do bot (o bot vem do payload: a linha pode ter nascido do despacho).
  if (p?.kind === "troca_de_ia") return cartaoTrocaDeIa(m, { nomeDoBot: agenteDe(estado, p.agenteId)?.nome ?? null, agora: estado.agora, ...(recomeco ? { recomeco } : {}) });
  if (p?.kind !== "ia_trocada" && p?.kind !== "limite_do_plano") return null;
  const bot = m.autoria.autor_tipo === "agente" ? agenteDe(estado, m.autoria.autor_id) : undefined;
  const ias = iasDaTela(estado);
  if (p.kind === "ia_trocada") {
    const ia = ias.find((i) => i.id === p.para);
    return linhaIaTrocada(m, { modelo: ia && bot ? ia.modelos.find((x) => x.id === escolhaEfetiva(ia, inteligenciaDoBot(bot).escolhas).modelo)?.nome ?? null : null, ...(recomeco ? { recomeco } : {}) });
  }
  return linhaLimiteSemOutra(m, { nomeDoBot: bot?.nome ?? null, agenteId: bot?.id ?? null, agora: estado.agora, ui: estado.iasMac, ias, fixa: bot ? inteligenciaDoBot(bot).modo === "fixa" : false, contasIa: estado.contasIa });
}

/**
 * NOD-220 (revisão do #303): a fonte ÚNICA de "de que IA o aviso depende" — decide se ela ainda está fora, se o aviso a
 * nomeia e o nome no "já voltou". Em ordem:
 * - bot fixado (NOD-171/NOD-213): a IA DELE, mesmo que a negação tenha nomeado outra (ele não roda em outra);
 * - payload `ia` (o harness do turno que recusou, gravado desde a NOD-220): essa IA, nomeada no aviso. Valor fora do
 *   catálogo da web (IA nova, dado torto): nada se infere — segue fora, sem nome;
 * - negação antiga ou do executor (sem `ia`) com IA no `nome`: a sonda dessa IA ("codex-cli" só vem do harness; "claude-cli"
 *   é o motor local ou o harness, e os dois são a sonda do Claude Code), sem nomear no aviso — o de sempre fica legível;
 * - "catcher": a sonda do próprio catcher (o executor que faltou), nunca a de uma IA;
 * - "ia" ou desconhecido: nenhuma — nunca "já voltou".
 */
type AlvoDoAviso = { ia: IdIa; nomeia: boolean } | { motor: "catcher" };
function alvoDoAviso(negacao: { nome: string; ia?: unknown } | null, fixado: IdIa | null): AlvoDoAviso | null {
  if (fixado) return { ia: fixado, nomeia: true };
  if (!negacao) return null;
  if (negacao.ia !== undefined) return ehIa(negacao.ia) ? { ia: negacao.ia, nomeia: true } : null;
  if (ehIa(negacao.nome)) return { ia: negacao.nome, nomeia: false };
  return negacao.nome === "catcher" ? { motor: "catcher" } : null;
}

/** A IA que a negação diz ter recusado: `ia` (valor fora do catálogo: nenhuma); sem `ia`, o `nome` quando é IA. */
function iaQueRecusou(negacao: { nome: string; ia?: unknown } | null): IdIa | null {
  if (!negacao) return null;
  const ia = negacao.ia !== undefined ? negacao.ia : negacao.nome;
  return ehIa(ia) ? ia : null;
}

/** A sonda do alvo. Sem o catálogo das IAs (servidor anterior à NOD-171), a do Claude Code é a do motor local. */
function sondaDoAlvo(estado: Estado, alvo: AlvoDoAviso): Inventario | null {
  const doMotor = (id: string): Inventario | null => estado.executor ? estado.executor.opcoes.find((o) => o.id === id)?.inventario ?? null : id === "claude-cli" ? estado.inventario : null;
  if ("motor" in alvo) return doMotor(alvo.motor);
  return estado.executor?.harnesses ? inventarioDaIa(estado, alvo.ia) : alvo.ia === "claude-cli" ? doMotor("claude-cli") : null;
}

/** NOD-285: o nome do tipo de arquivo como a pessoa lê (o mesmo da frase do servidor, src/domain/harness.ts). */
const NOME_DO_TIPO_DE_ANEXO: Readonly<Record<TipoAnexo, string>> = { pdf: "PDF", imagem: "imagem", texto: "arquivo de texto" };

/**
 * Executor indisponível (ADR-029, classe plano_ausente) como aviso de ERRO do design system (definido em 2026-10-04):
 * o trabalho não começou. A frase da redação fica atrás de "Detalhes técnicos" (traz o motivo cru e a hora);
 * na frente, o que aconteceu em palavras e o próximo passo: "Conectar IA" enquanto a IA continua fora, e "mande de
 * novo" quando ela já voltou (a mensagem perdida não é reenviada sozinha).
 */
function avisoSemExecutor(m: Mensagem, estado: Estado): string {
  const bot = m.autoria.autor_tipo === "agente" ? agenteDe(estado, m.autoria.autor_id) : undefined;
  const nome = bot?.nome;
  const negacao = m.payload?.kind === "negacao" ? m.payload : null;
  // NOD-171/NOD-213: o bot FIXADO numa IA depende do inventário DELA, não do motor em uso. Quem diz se o bot está fixado
  // (e em qual IA) é a `inteligencia` que o servidor calcula pelo domínio (iaDoModelo): um bot com modelo GPT é do Codex,
  // nunca do Claude Code. A regra não se repete aqui.
  const intel = bot ? inteligenciaDoBot(bot) : null;
  const fixado = intel?.modo === "fixa" && intel.fixa && ehIa(intel.fixa) ? intel.fixa : null;
  const alvo = alvoDoAviso(negacao, fixado);
  // NOD-213/NOD-220: "já voltou" só com a sonda DO ALVO pronta e mais nova que a negação; sem alvo, nunca.
  const aindaFora = !alvo || !prontaDepois(sondaDoAlvo(estado, alvo), m.criadoEm);
  const iaDoAlvo = alvo && "ia" in alvo ? alvo.ia : null;
  // A IA da causa e do modelo recusado: a que recusou (`ia`; nas antigas, o `nome`); sem ela, a do bot fixado.
  const iaDoAviso = iaQueRecusou(negacao) ?? fixado;
  const noApp = "nodDesktop" in globalThis;
  const detalhes = `<details class="aviso-estado-detalhes" data-disclosure="negacao-${esc(m.id)}"><summary>Detalhes técnicos</summary>${paragrafos(m.texto)}</details>`;
  // NOD-285 (revisão do Gil no #345): a IA está pronta e só não lê o arquivo. Nem "nenhuma IA pronta", nem "já voltou",
  // nem "fica guardada": mandar de novo dá a mesma negação enquanto não houver uma IA que leia o arquivo.
  if (negacao?.anexo) {
    const tipo = NOME_DO_TIPO_DE_ANEXO[negacao.anexo];
    // Quem lê o tipo sai das capacidades do catálogo (ADR-083), nunca do id da IA.
    const leem = (estado.executor?.harnesses?.opcoes ?? []).filter((h) => h.integrado && h.capacidades.anexos.includes(negacao.anexo!)).map((h) => h.nome);
    const passo = leem.length > 0 ? `Deixe o ${leem.join(" ou o ")} pronto e mande o arquivo de novo, ou cole o conteúdo como texto.` : "Cole o conteúdo como texto.";
    return avisoDeEstado({
      tom: "erro",
      titulo: "Nenhum trabalho começou.",
      texto: `${nome ?? "O bot"} não consegue ler ${tipo} com as IAs prontas agora. ${passo}`,
      extra: detalhes,
      acao: botao("secao-espaco", "Conectar IA", { classe: "pri sm", dados: { secao: "conexao" } }),
    });
  }
  // NOD-8 (definido em 2026-10-22): a pessoa trocou a IA do bot fixado depois da recusa (a IA do turno, `ia`, é outra) e a
  // nova está pronta: o aviso da IA antiga sai sozinho e fica a linha da troca. Só com `ia` explícito: o `nome` das
  // negações antigas mistura motor e harness (NOD-220).
  const recusou = negacao && ehIa(negacao.ia) ? negacao.ia : null;
  if (fixado && recusou && fixado !== recusou && inventarioDaIa(estado, fixado)?.estado === "pronto") return linhaIaDoBotTrocada(nome ?? null, fixado);
  // definido em 2026-10-05: a IA estava logada e a conta não serviu — aviso próprio, com a causa e os botões (ia-fora.ts).
  // Esse aviso não diz que a IA "voltou": diz que JÁ HÁ UMA IA PRONTA. No Automático (sem IA fixada) o bot pega a IA em
  // uso, então vale a sonda dela, mais nova que a negação (NOD-213); o bot fixado segue a regra da IA dele.
  if (negacao?.causa && iaDoAviso) return avisoContaSemAcesso(m, estado, { nomeDoBot: nome ?? "O bot", ia: iaDoAviso, causa: negacao.causa, aindaFora: fixado ? aindaFora : !prontaDepois(inventarioEmUso(estado), m.criadoEm), noApp });
  // NOD-171: a IA está pronta e recusou o modelo do agente; esperar não resolve.
  if (negacao?.modelo && iaDoAviso) return avisoModeloRecusado(m, { nomeDoBot: nome ?? null, agenteId: bot?.id ?? null, ia: iaDoAviso, modelo: negacao.modelo });
  // NOD-171/NOD-220: a IA do alvo, nomeável e ainda fora — o aviso diz QUAL e o estado dela (desatualizada, sem login, no
  // limite, fora, ou só "indisponível" quando o catálogo não explica).
  if (aindaFora && alvo && "ia" in alvo && alvo.nomeia) return avisoHarnessFora(m, estado, { nomeDoBot: nome ?? null, agenteId: bot?.id ?? null, ia: alvo.ia, noApp });
  // NOD-8 (definido em 2026-10-22, protótipo v2.2): a IA voltou — o aviso some sozinho e fica a linha de sistema.
  // NOD-8 passo 11: voltou porque o nod a atualizou (a sonda pronta traz o `sucesso` da NOD-9): a linha diz A → B.
  if (!aindaFora) {
    const a = iaDoAlvo ? inventarioDaIa(estado, iaDoAlvo)?.atualizacao : undefined;
    return linhaIaVoltou(iaDoAlvo, a?.fase === "sucesso" && a.em > m.criadoEm ? a : null);
  }
  return avisoDeEstado({
    tom: "erro",
    titulo: "Nenhum trabalho começou.",
    texto: `${nome ?? "O bot"} não pôde começar: nenhuma IA está pronta agora. Sua mensagem fica guardada: quando a IA voltar, ${nome ?? "o bot"} responde sozinho.`,
    extra: detalhes,
    acao: botao("secao-espaco", "Conectar IA", { classe: "pri sm", dados: { secao: "conexao" } }),
  });
}

/**
 * Uma mensagem. Texto vira BALÃO (protótipo private-agents-minimal): você à direita (preto), o bot à
 * esquerda (cinza). Os demais kinds (sistema, handoff, negação, rotina…) seguem como linhas discretas.
 * `mostrarAutor` liga o nome do bot dentro do balão — útil em salas com vários agentes.
 */
/** A rota de anexos da conversa (ADR-046), escopada pelo tenant da sessão. */
function urlDoAnexo(tenant: string, m: Mensagem, id: string): string {
  return `/api/t/${encodeURIComponent(tenant)}/conversas/${encodeURIComponent(m.conversaId)}/anexos/${encodeURIComponent(id)}`;
}

/**
 * NOD-56: a fala do bot só ganha anexo de imagem pela captura da tela ao fim do turno (NOD-200, `assentar-turno.ts`).
 * Ela sai de `msg-anexos` (acima do balão, à direita, desenhado para a pessoa) e vira o rodapé do balão.
 */
const ehCaptura = (m: Mensagem, a: { mime: string; origem?: string }): boolean => m.autoria.autor_tipo !== "pessoa" && a.origem !== "bot" && a.mime.startsWith("image/");

/** ADR-046: arquivos que a pessoa mandou, acima do balão. A captura (NOD-56) e a mídia do bot (NOD-323) não entram aqui. */
function anexosDe(m: Mensagem, estado: Estado): string {
  const tenant = estado.sessao?.tenantId;
  const anexos = (m.anexos ?? []).filter((a) => !ehCaptura(m, a) && a.origem !== "bot");
  if (!anexos.length || !tenant) return "";
  return renderAnexosDaMensagem(anexos, (id) => urlDoAnexo(tenant, m, id));
}

/** NOD-56: o conteúdo do <dialog> da captura ampliada (`captura-ampliada.ts`); puro, para o teste sem DOM. */
export function htmlCapturaAmpliada(src: string, legenda: string): string {
  return `<div class="captura-ampliada-corpo"><img src="${esc(src)}" alt="${esc(legenda)}" /><div class="captura-ampliada-rodape"><span>${esc(legenda)}</span><a href="${esc(src)}" target="_blank" rel="noopener">Abrir em nova aba</a><button type="button" class="bt sm" data-captura="fechar">Fechar</button></div></div>`;
}

/**
 * NOD-56 (protótipo do Gil, 2026-10-05): a tela do computador ao fim do turno, como miniatura de 240×150 abaixo do
 * balão do bot, com a legenda neutra. Clicar amplia num <dialog> (`ampliar-captura`). Mais de uma imagem (não acontece
 * hoje): só a primeira. Sem captura, nada — o balão fica igual.
 */
export function capturaDoTurno(m: Mensagem, estado: Estado): string {
  const tenant = estado.sessao?.tenantId;
  const captura = m.anexos?.find((a) => ehCaptura(m, a));
  if (!captura || !tenant) return "";
  const url = esc(urlDoAnexo(tenant, m, captura.id));
  const legenda = `Tela do computador ao fim do turno · ${hora(m.criadoEm)}`;
  // Protótipo (Gil): o alt e a ampliação nomeiam o bot; sem nome conhecido, "do bot".
  const nome = agenteDe(estado, m.autoria.autor_id)?.nome;
  const deQuem = nome ? `de ${nome}` : "do bot";
  const legendaAmpliada = `Tela do computador ${deQuem} ao fim do turno · ${hora(m.criadoEm)}`;
  return `<figure class="msg-captura"><button type="button" class="msg-captura-bt" data-act="ampliar-captura" data-src="${url}" data-legenda="${esc(legendaAmpliada)}" aria-label="Ampliar tela do computador ao fim do turno" aria-haspopup="dialog"><img src="${url}" alt="${esc(`Tela do computador ${deQuem} ao fim do turno`)}" loading="lazy" width="240" height="150" /></button><figcaption>${esc(legenda)}</figcaption></figure>`;
}

/**
 * NOD-323 (ADR-126): a mídia que o bot anexou, abaixo do balão, e a linha do que não entrou. Puro: o que muda entre
 * redesenhos (GIF pausado, este Mac) vem de `lembrancaDaMidia`, mantida por `midia-dom.ts`.
 */
export function midiasDoBot(m: Mensagem, estado: Estado): string {
  const tenant = estado.sessao?.tenantId;
  if (m.autoria.autor_tipo === "pessoa" || !tenant) return "";
  const bot = agenteDe(estado, m.autoria.autor_id)?.nome;
  const midias = renderMidiasDoBot(m.anexos ?? [], { url: (id) => urlDoAnexo(tenant, m, id), ...(bot ? { bot } : {}), ...lembrancaDaMidia });
  return midias + linhaRecusas(m.midiaRecusas, bot);
}

const temMidiaDoBot = (m: Mensagem): boolean => m.autoria.autor_tipo !== "pessoa" && (m.anexos ?? []).some((a) => a.origem === "bot");

/**
 * `destaVez` (ADR-090, protótipo "Nod — Motor na VM", tela 4c): a máquina do bot está sem contato e há outra conectada —
 * a própria linha da fila oferece "Rodar em <outra> desta vez", sem faixa por cima da conversa.
 */
type SituacaoFila = { tipo: "na_fila"; texto: string; destaVez?: { conversaId: string; maquinaId: string; nome: string }; tentarAgora?: string; recusa?: string; computadores?: true } | { tipo: "cancelando" } | { tipo: "cancelada" };

/**
 * Onde a mensagem da pessoa está na fila (definido em 2026-09-24): o turno que ela disparou ainda
 * espera, está nos 5 s do Desfazer, ou foi cancelado antes de rodar. null = seguiu o fluxo normal.
 */
export function situacaoNaFila(m: Mensagem, estado: Estado): (SituacaoFila & { turnoId: string }) | null {
  if (m.autoria.autor_tipo !== "pessoa") return null;
  const c = estado.conversas[m.conversaId];
  if (!c) return null;
  const cancelado = c.turnosCancelados.find((t) => t.mensagemId === m.id);
  if (cancelado) return { tipo: "cancelada", turnoId: cancelado.id };
  const emCurso = c.turnosEmCurso.find((t) => t.mensagemId === m.id);
  if (!emCurso) return null;
  if (emCurso.id in estado.cancelando) return { tipo: "cancelando", turnoId: emCurso.id };
  // O estado VIVO manda: o frame turno.iniciado 'despachado' tira o chip antes do REST reler a conversa.
  if (estado.turnosVivos[emCurso.id]?.estado !== "na_fila") return null;
  const agente = c.conversa.agenteId ? agenteDe(estado, c.conversa.agenteId) : undefined;
  const nome = agente?.nome ?? "o agente";
  // ADR-090: o bot trabalha numa máquina que está sem contato — a fila espera por ela, e a linha diz isso.
  // QA do NOD-314: o turno que a pessoa mandou "desta vez" para outra máquina espera ESSA máquina, não a do bot.
  const destaVez = emCurso.maquinaDestaVez ? (estado.maquinas?.maquinas ?? []).find((x) => x.id === emCurso.maquinaDestaVez) ?? null : null;
  const doBot = destaVez ?? (agente ? maquinaDoBot(estado, agente) : null);
  // Revisão do PR: conectada mas sem nenhuma IA pronta (o login ainda não foi feito nela) também segura a fila.
  // ADR-121 (NOD-92): a máquina na nuvem está acordando para o trabalho (ou dorme e vai acordar). A espera é curta e rodar
  // em outra duplicaria o trabalho: nada de "Rodar em X desta vez", que só volta na falha (`falhou_ao_acordar`).
  const doTrabalho = (estado.trabalhos?.trabalhos ?? []).find((t) => t.conversaId === c.conversa.id && t.maquina?.acordando)?.maquina ?? null;
  if (acordandoNaFila(doBot, doTrabalho)) {
    // Revisão NOD-92 (item 14): sem máquina livre no Google, o chip diz o motivo e oferece "Tentar agora" (como o cartão).
    const vm = doBot?.nuvem ? doBot : (estado.maquinas?.maquinas ?? []).find((x) => x.nuvem && x.id === doTrabalho?.id) ?? null;
    if (vm?.nuvem?.motivo === "sem_capacidade") {
      // Revisão NOD-92 (rodada 2, item 2): o 409 do "Tentar agora" aparece no próprio chip, não só no cartão da máquina.
      const recusa = estado.nuvem.recusa?.maquinaId === vm.id ? estado.nuvem.recusa.texto : null;
      return { tipo: "na_fila", turnoId: emCurso.id, texto: motivoLegivel("sem_capacidade", vm.nome, vm.nuvem.zona), tentarAgora: vm.id, ...(recusa ? { recusa } : {}) };
    }
    return { tipo: "na_fila", turnoId: emCurso.id, texto: `Acordando ${doTrabalho?.nome ?? doBot?.nome ?? "a máquina"}… · costuma levar 1 a 2 min` };
  }
  const semIa = !!doBot && doBot.conectada && !Object.values(doBot.ias).includes("pronto");
  // ADA-243: sem IA NESTE computador, a linha diz "neste computador" (e não pede terminal de outra máquina).
  if (doBot && semIa) return { tipo: "na_fila", turnoId: emCurso.id, texto: doBot.id === estado.estaMaquina?.id ? "Na fila · sem IA neste computador (entre no Claude Code ou no Codex em Configurações › Computadores)" : `Na fila · ${doBot.nome} está sem IA pronta (no terminal dela: nod-motor entrar claude ou codex)` };
  if (doBot && !doBot.conectada) {
    const outra = (estado.maquinas?.maquinas ?? []).find((m) => m.conectada && m.papel !== "computador" && m.id !== doBot.id && Object.values(m.ias).includes("pronto"));
    // ADA-243 (spec, jornada B): a máquina do bot está desligada — o bot diz onde trabalha e o que a pessoa pode fazer.
    // O turno que a pessoa mandou "desta vez" para outra máquina segue com a linha de antes (não é a máquina do bot).
    const texto = destaVez ? `Na fila · ${doBot.nome} não responde${doBot.ultimoUsoEm ? ` desde ${hora(doBot.ultimoUsoEm)}` : ""}` : `Eu trabalho no ${doBot.nome}, que está desligado; começo quando ele voltar, ou mude meu computador em`;
    return { tipo: "na_fila", turnoId: emCurso.id, texto, ...(destaVez ? {} : { computadores: true as const }), ...(outra ? { destaVez: { conversaId: c.conversa.id, maquinaId: outra.id, nome: outra.nome } } : {}) };
  }
  const outra = c.turnosPendentes.find((p) => p.id === emCurso.id && p.conversaId !== c.conversa.id);
  if (outra) {
    const la = estado.frota?.agentes.find((a) => a.conversaId === outra.conversaId);
    return { tipo: "na_fila", turnoId: emCurso.id, texto: `Na fila · ${nome} está respondendo em ${la ? `#${la.nome}` : "outra conversa"}` };
  }
  const naFila = Object.values(estado.turnosVivos).filter((t) => t.conversaId === c.conversa.id && t.estado === "na_fila" && !t.bastidores && !(t.turnoId in estado.cancelando)).length;
  return { tipo: "na_fila", turnoId: emCurso.id, texto: naFila > 1 ? `Na fila · ${nome} lê junto com as outras quando terminar` : `Na fila · ${nome} lê quando terminar o turno atual` };
}

function renderSituacaoFila(s: SituacaoFila, turnoId: string): string {
  if (s.tipo === "cancelada") return `<div class="fila-chip cancelada">Cancelada · não rodou</div>`;
  if (s.tipo === "cancelando") return `<div class="fila-chip">Cancelando…${botao("desfazer-cancelamento", "Desfazer", { classe: "link", id: turnoId })}</div>`;
  const destaVez = s.destaVez ? botao("rodar-desta-vez", `Rodar em ${esc(s.destaVez.nome)} desta vez`, { classe: "link", dados: { conversa: s.destaVez.conversaId, maquina: s.destaVez.maquinaId } }) : "";
  const tentar = s.tentarAgora ? botao("nuvem-acordar", "Tentar agora", { classe: "link", dados: { maquina: s.tentarAgora } }) : "";
  const computadores = s.computadores ? ` ${botao("secao-espaco", "Configurações › Computadores", { classe: "link", dados: { secao: "maquinas" } })}` : "";
  const chip = `<div class="fila-chip" role="status"><span class="fila-relogio" aria-hidden="true"></span>${esc(s.texto)}${computadores}${tentar}${destaVez}${botao("cancelar-turno", "Cancelar", { classe: "link perigo", id: turnoId, aria: "Cancelar esta mensagem da fila" })}</div>`;
  return s.recusa ? `${chip}<p class="cx-erro" role="alert">${esc(s.recusa)}</p>` : chip;
}

/**
 * NOD-376: o chip da fala que a pessoa escreveu na tela da frente — o mesmo `.fila-chip` discreto da conversa, sem o
 * Cancelar (o turno do recado não tem Desfazer). A situação vem do detalhe da task (`falasNaFila`).
 */
export function chipDaFalaNaFrente(situacao: "na_fila" | "entregue" | "lendo", bot: string, frente: { rodando: boolean; precisaDeVoce?: boolean }): string {
  const texto =
    situacao === "lendo" ? `Entregue · ${bot} está lendo agora`
    : situacao === "entregue" ? `Entregue · ${bot} lê ao fim do passo atual`
    : frente.precisaDeVoce ? `Na fila · ${bot} lê depois que você responder o que ele perguntou`
    : frente.rodando ? `Na fila · ${bot} lê no próximo passo`
    : `Na fila · ${bot} volta à frente para responder`;
  return `<div class="fila-chip" role="status"><span class="fila-relogio" aria-hidden="true"></span>${esc(texto)}</div>`;
}

/**
 * NOD-431 (emenda da ADR-070): o balão da pessoa veste a cor do bot da conversa. A classe `balao-c-*` (web/estilos.css)
 * aponta `--balao-fundo`, `--balao-tinta` e `--balao-codigo` para os tokens da skin (web/tokens.css, calculados com
 * contraste ≥ 4,5:1 por src/domain/contraste-do-balao.ts). Sem bot dono (sala) ou com cor fora da paleta, nada: o balão
 * fica no grafite (`--action`) de sempre. A classe sai da conversa e não da mensagem: trocar a cor do bot repinta todas.
 * Com a conversa ainda não carregada (a fala desenhada no detalhe de uma task), a frota diz de quem ela é.
 */
export function classeDoBalao(estado: Estado, conversaId: string): string {
  const carregada = estado.conversas[conversaId]?.conversa;
  const cor = carregada
    ? (carregada.agenteId ? agenteDe(estado, carregada.agenteId)?.cor : undefined)
    : estado.frota?.agentes.find((a) => a.conversaId === conversaId)?.cor;
  // A web não importa valor de src/contracts (ADR-018): vale o formato c-<nome>, que vira classe sem risco de injeção;
  // uma c-* sem balao-c-* em web/estilos.css cai no grafite pelo fallback do CSS.
  return cor && /^c-[a-z]+$/.test(cor) ? ` balao-${cor}` : "";
}

/** "/review 420" na mensagem da pessoa: o comando vira chip e o resto segue como texto (canvas "Comandos /", C4). */
export function comChipDeComando(texto: string): string {
  const m = /^\/([\w.:-]+)(\s[\s\S]*)?$/.exec(texto.trim());
  if (!m) return paragrafos(texto);
  const resto = (m[2] ?? "").trim();
  return `<span class="chip-comando">/${esc(m[1]!)}</span>${resto ? ` ${paragrafos(resto)}` : ""}`;
}

/**
 * NOD-378: até quantos caracteres a etiqueta "da rotina …" / "da task …" é curta: não cede nem ganha o piso de 8em do
 * celular. É contagem, não largura: até 16 caracteres comuns cabem em ~85 px (abaixo do piso); com letras largas
 * ("WWWWWW") a curta passa do piso e o nome cede um pouco mais, o que é aceitável.
 */
export const ETIQUETA_CURTA = 16;

/**
 * `etiqueta` (definido em 2026-10-07, #191/#195): a fala que chega de uma rotina ou de uma task leva "da rotina …" /
 * "da task …" ao lado do nome — é balão porque é para a pessoa, mas não é resposta à última mensagem dela.
 * `progresso` (chat limpo, PR 7): o marcador do bloco de progresso das frentes que esta fala abriu (./progresso-na-fala.ts).
 * Na fala do bot ele fica dentro do balão, depois do texto (protótipo "4"); no balão da pessoa (a frente da rede), embaixo
 * dele. Nos dois, antes das reações: o progresso é conteúdo da fala; a reação é sobre ela (decisão 20 do plano).
 * `diagramas` (NOD-328): só a timeline de conversa e sala liga; Trabalhos reaproveita esta função e fica com o card.
 * `linhaDoModo` (PR 6 dos modos de aprovação, telas Y1 e Y2): a linha discreta do que o "Ignorar todas" rodou sem a
 * pessoa neste turno (./linha-do-modo.ts), logo embaixo do balão do bot e antes das reações.
 */
export function renderMensagem(m: Mensagem, estado: Estado, sala = false, opcoes: { etiqueta?: string; progresso?: string; diagramas?: boolean; linhaDoModo?: string; chipDaFala?: string; semAcoes?: boolean } = {}): string {
  // Kinds não-texto (parada, sistema, negação) também se relatam — são JUSTAMENTE os que a categoria
  // 'travou_ou_parou' descreve, e o caso de uso já trata mensagem sem turno (definido em 2026-09-21).
  // definido em 2026-10-03: o artefato é uma fala do bot — mascote, nome e hora em volta do card, como os balões; solto
  // na margem ele parecia de ninguém.
  if (m.payload?.kind === "artefato") {
    const bot = m.autoria.autor_tipo === "agente" ? agenteDe(estado, m.autoria.autor_id) : undefined;
    const nome = esc(bot?.nome ?? assinatura(m.autoria, nomesDe(estado)));
    return `<article class="message bot com-artefato" data-mensagem="${esc(m.id)}">${bot ? iconeAgente(bot, "md") : ""}<div class="bubble-wrap">${acoesDaMensagem(m, estado, sala)}<div class="msg-autor"><b title="${nome}">${nome}</b><time>${hora(m.criadoEm)}</time></div>${corpoMensagem(m, estado)}${chipsDeReacao(m, estado)}${faixaDaMensagem(m, estado)}</div></article>`;
  }
  // Jornada C (NOD_ONBOARDING_TEXTO=1): a fala fixa sem IA é fala do bot (balão), não aviso de erro; a primeira da
  // sequência mais recente leva o card "Conectar uma IA neste computador" (um por conversa; as seguintes dizem "card acima").
  if (ehFalaSemIa(m)) {
    const balao = renderMensagem({ ...m, kind: "texto", payload: null }, estado, sala, opcoes);
    const card = cardDaConversa(estado.conversas[m.conversaId]?.mensagens ?? [], turnosVivosDe(estado));
    return falaSemIaHtml({ mensagem: m, balao, comCard: card?.falaId === m.id, vivo: card?.vivo ?? false, ias: iasNoCard(estado) });
  }
  if (m.kind !== "texto") {
    // Chat limpo (PR 4): o recibo da decisão é o cartão do pedido, encolhido com o resultado — alinhado às falas do bot,
    // como o cartão aberto estava, e não no centro como as linhas.
    const encolhido = dadosDoEncolhido(m, estado);
    return `<div class="msg-linha${encolhido ? " msg-encolhido" : ""}" data-mensagem="${esc(m.id)}">${encolhido ? renderCartaoEncolhido(encolhido, m.id) : corpoMensagem(m, estado)}${acoesDaMensagem(m, estado, sala)}${faixaDaMensagem(m, estado)}</div>`;
  }
  const ehPessoa = m.autoria.autor_tipo === "pessoa";
  const agente = ehPessoa ? undefined : agenteDe(estado, m.autoria.autor_id);
  // Autoria composta (ADR-023) aparece inteira: o pedido de colega é "Taga · por você" (ADR-047/058). O bloco de
  // contexto só existe em pedido antigo (delegar_tarefa); o de pedir_a_bot já traz o contexto no próprio texto.
  const autor = ehPessoa ? "Você" : m.autoria.sob_procuracao_de ? assinatura(m.autoria, nomesDe(estado)) : agente?.nome ?? assinatura(m.autoria, nomesDe(estado));
  // NOD-378 (revisão 4): a etiqueta curta (até ETIQUETA_CURTA caracteres) não encolhe nem ganha
  // piso: com o piso ela ficava com espaço vazio e alargava o balão. Só a longa cede, com reticência, até o piso.
  const etiqueta = opcoes.etiqueta
    ? `<span class="etiqueta-origem${opcoes.etiqueta.length <= ETIQUETA_CURTA ? " curta" : ""}" title="${esc(opcoes.etiqueta)}">${esc(opcoes.etiqueta)}</span>`
    : "";
  // NOD-312: a marca "↺ recomeçou" ao lado da hora (o turno recomeçou sem a sessão e não havia linha onde pegar carona);
  // a explicação abre no fluxo, logo abaixo do nome. Fica para sempre no histórico.
  const alvo = alvosDaVez.get(m.id);
  const recomeco = alvo?.tipo === "marca" ? marcaDoRecomeco(m.id, alvo) : null;
  const sender = `<div class="msg-autor"><b title="${esc(autor)}">${esc(autor)}</b><time>${hora(m.criadoEm)}</time>${recomeco?.marca ?? ""}${etiqueta}</div>${recomeco?.explicacao ?? ""}`;
  const delegacao = m.payload?.kind === "peer_pedido" ? m.payload.delegacao : undefined;
  const contextoDelegado = delegacao ? `<div class="msg-contexto-delegado"><small class="mudo">Contexto de ${esc(agente?.nome ?? (m.payload?.kind === "peer_pedido" ? m.payload.nome : undefined) ?? "um colega")} · não é instrução da pessoa</small><p>${esc(delegacao.tarefa)}</p>${delegacao.contexto ? `<p>${esc(delegacao.contexto)}</p>` : ""}</div>` : "";
  // Chat limpo (PR 6, 2026-10-18; plano, Parte 5): "rodou em <máquina>" e "catcher" saíram do balão e moram na faixa do
  // modo dev e no Raio-X (`ondeRodou`, ./modo-dev.ts); "não confiável" e "parcial" ficam, porque dizem algo do texto.
  const tags = ehPessoa || m.payload?.kind === "peer_pedido" || m.payload?.kind === "boas_vindas"
    ? ""
    : [m.confianca === "nao_confiavel" ? '<span class="tag tag-ambar" title="conteúdo de conector ou de outro bot">não confiável</span>' : "", m.parcial ? '<span class="tag tag-cinza">parcial</span>' : ""].filter(Boolean).join("");
  const metaTags = tags ? `<div class="meta-tags">${tags}</div>` : "";
  // definido em 2026-09-24 (emenda da ADR-045): a pergunta de pedir_a_pessoa é esta fala; a mensagem que a respondeu
  // leva o rótulo, e a retomada vira uma linha logo depois. revisto em 2026-10-18 (plano "pergunta com botões", Parte 2):
  // a fala vira o cartão da pergunta no lugar do balão (o texto não sai duas vezes), e a resposta que foi uma das opções
  // não sai como balão — o cartão já mostra a escolhida com ✓ (tela "Depois de responder").
  const pergunta = !ehPessoa && m.payload?.kind === "pedido_a_pessoa" ? m.payload : null;
  const resposta = ehPessoa && m.payload?.kind === "resposta_a_pedido" ? m.payload : null;
  if (resposta && respostaPorOpcao(m, estado)) return "";
  const fila = situacaoNaFila(m, estado);
  // "respondendo", não "resposta": `.resposta` já é o campo do card de Retomar (estilos.css).
  // definido em 2026-10-16: computador_pedir_ajuda não pede senha no balão — vira o cartão "Abrir computador" no lugar
  // do cartão da pergunta.
  const motivoTela = pergunta ? motivoDoPedidoDeTela(m.texto) : null;
  const telaAberta = motivoTela !== null && pergunta ? estadoDaPergunta(estado, estado.conversas[m.conversaId]?.mensagens ?? [], pergunta.decisaoId).tipo === "aberta" : false;
  const ouvivel = podeOuvir(m, estado, sala);
  const lendo = estado.leitura?.mensagemId === m.id && ouvivel;
  const classes = `message ${ehPessoa ? "you" : "bot"}${ehPessoa ? classeDoBalao(estado, m.conversaId) : ""}${ouvivel ? " ouvivel" : ""}${lendo ? " lendo" : ""}${pergunta ? " pergunta" : ""}${motivoTela !== null ? " com-tela" : ""}${resposta ? " respondendo" : ""}${fila ? ` fila-${fila.tipo}` : ""}`;
  // O progresso vai dentro do balão do bot; no da pessoa (a rede) e no cartão da pergunta (o turno que abriu frentes e
  // terminou perguntando), embaixo dele — o cartão não tem onde recebê-lo, e sem isso o bloco sumia (revisão do PR 398).
  const progressoDentro = !ehPessoa && !pergunta ? (opcoes.progresso ?? "") : "";
  const progressoFora = ehPessoa || pergunta ? (opcoes.progresso ?? "") : "";
  const balao = motivoTela !== null ? (estado.computadorPessoa ? htmlPedidoDeTela(motivoTela, agente?.id ?? "", telaAberta) : htmlCartaoTela(motivoTela, agente?.id ?? "", telaAberta, agente?.nome, pergunta?.decisaoId)) : pergunta ? cartaoDaPergunta(m, estado) : (ehPessoa ? m.anexos?.length : temMidiaDoBot(m) && !progressoDentro) && m.texto.trim() === "" ? "" : ehPessoa
      ? `<div class="bubble">${comChipDeComando(m.texto)}${metaTags}</div>`
      : baloesDoBot(m.texto, m.id, opcoes.diagramas === true, `${metaTags}${progressoDentro}`, progressoDentro !== "");
  return `<article class="${classes}" data-mensagem="${esc(m.id)}"${pergunta ? ` data-pergunta="${esc(pergunta.decisaoId)}"` : ""}>
    ${!ehPessoa && agente ? iconeAgente(agente, "md") : ""}<div class="bubble-wrap">${opcoes.semAcoes ? "" : acoesDaMensagem(m, estado, sala)}${sender}${ehPessoa ? "" : resumoDaMensagem(m)}${resposta ? rotuloDaResposta(m) : ""}${ehPessoa ? citacaoAcimaDoBalao(m) : ""}${anexosDe(m, estado)}${balao}${ehPessoa ? "" : midiasDoBot(m, estado)}${progressoFora}${ehPessoa ? "" : (opcoes.linhaDoModo ?? "")}${ehPessoa ? "" : avisoDeLeitura(m, estado)}${ehPessoa ? "" : capturaDoTurno(m, estado)}${contextoDelegado}${chipsDeReacao(m, estado)}${fila ? renderSituacaoFila(fila, fila.turnoId) : (opcoes.chipDaFala ?? "")}${faixaDaMensagem(m, estado)}</div>
  </article>${ehPessoa ? "" : desfazerDaFala(m, estado, agente?.nome ?? "o bot")}${resposta ? linhaDaRetomada(m, estado) : ""}`;
}

/**
 * NOD-358 (emenda da ADR-114): a fala do bot sai em um balão por parágrafo (./lib/baloes.ts); mascote, nome e hora
 * continuam uma vez só. O que é da fala inteira (tags, progresso) vai no último balão. O balão 0 guarda a chave da
 * mensagem na memória do texto formatado; os outros, `id~i`. Com um balão só, o HTML é o de antes.
 */
function baloesDoBot(texto: string, chave: string, diagramas: boolean, depois: string, comProgresso: boolean): string {
  const baloes = dividirEmBaloes(texto);
  if (baloes.length <= 1) return `<div class="bubble${comProgresso ? " com-progresso" : ""}">${textoFormatado(texto, { chave, diagramas })}${depois}</div>`;
  return baloes.map((b, i) => {
    const ultimo = i === baloes.length - 1;
    return `<div class="bubble${ultimo && comProgresso ? " com-progresso" : ""}" data-balao="${i}">${textoFormatado(b, { chave: i === 0 ? chave : `${chave}~${i}`, diagramas })}${ultimo ? depois : ""}</div>`;
  }).join("");
}

function renderProposta(p: Proposta, estado: Estado, propostas: readonly Proposta[]): string {
  const a = agenteDe(estado, p.agenteId);
  // definido em 2026-09-28 (ADR-050): o perfil que traz rotinas é um card só, com as rotinas dentro.
  const cardPerfil = renderCardPerfil(p, propostas, estado, a);
  if (cardPerfil !== null) return cardPerfil;
  // definido em 2026-09-25 (jornadas de conexão): conectar e permitir no mesmo card (card-acesso.ts).
  const cardAcesso = renderCardAcesso(p, itemAbertoDoCard(p, estado), estado);
  if (cardAcesso !== null) return cardAcesso;
  // definido em 2026-09-18: a pasta já vem descoberta, então autorizar é um clique — a pessoa não
  // navega em menu nem digita caminho. Sem candidatas, o mesmo card abre a escolha manual.
  if (p.payload.kind === "pasta") return renderCardPasta(p, p.payload, estado, a);
  // definido em 2026-10-28 (NOD-50): o pedido de chave — o valor vai do campo direto ao cofre (card-credencial.ts).
  // Só a dona cola a chave (revisão 6): numa sala o colega vê o pedido, sem campo — o mesmo de Sua vez.
  if (ehCartaoCredencial(p)) {
    const d = decisaoAbertaDoCard(p, estado);
    return !d || d.ownerId !== estado.sessao?.pessoaId ? `<p class="p50-para">${esc(a?.nome ?? "O bot")} pediu uma chave a quem o chamou. Só quem pediu pode colá-la.</p>` : renderCardCredencial(p, a?.nome ?? "O bot");
  }
  // definido em 2026-10-07 (ADR-082): as mudanças em vários bots que o Nod pediu de uma vez — um card, uma linha por ação.
  if (p.payload.kind === "lote_bots") return renderCardLote(p, p.payload, p.estado === "pendente" && decisaoAbertaDoCard(p, estado) !== null);
  if (p.payload.kind === "colunas_quadro") return renderCardColunas(p, p.payload, p.estado === "pendente" && decisaoAbertaDoCard(p, estado) !== null);
  // NOD-422: a prévia de trazer o time do Linear (a mesma do ⋯ do quadro).
  if (p.payload.kind === "importacao_linear") return renderCardImportacao(p, p.payload, p.estado === "pendente" && decisaoAbertaDoCard(p, estado) !== null);
  if (p.payload.kind === "assumir_quadro") return renderCardAssumir(p, p.payload, p.estado === "pendente" && decisaoAbertaDoCard(p, estado) !== null);
  // NOD-445: o card Criar / Ajustar do app pedido pela conversa.
  if (p.payload.kind === "app") return renderCardApp(p, p.payload, p.estado === "pendente" && decisaoAbertaDoCard(p, estado) !== null);
  if (p.payload.kind === "quadro_exclusao") return renderCardQuadroExclusao(p, p.payload, p.estado === "pendente" && decisaoAbertaDoCard(p, estado) !== null);
  return cardDaProposta(p, estado, a);
}

/**
 * NOD-399 (definido em 2026-10-30, protótipo v2 aprovado): o card das propostas simples (perfil sem rotinas, bot,
 * rotina, mudança e exclusão de rotina, acesso sem o card de conexão) é o componente comum (web/lib/card-proposta.ts):
 * sem o cabeçalho "X propõe · nada vale antes de você confirmar", o título é a frase com o verbo, até 3 linhas com
 * antes → depois, o resto em Detalhes, o verbo + "Agora não". As `data-act` são as mesmas de antes.
 */
function cardDaProposta(p: Proposta, estado: Estado, a: FrotaDto["agentes"][number] | undefined): string {
  const bot = a?.nome;
  const aberto = itemAbertoDoCard(p, estado);
  const comAcesso = acoesDaRotinaComAcesso(p, estado);
  const acoes = comAcesso?.botoes ?? acoesProposta(p, estado);
  const extra = comAcesso?.ajuda ?? "";
  const chaveDetalhes = `proposta-${p.id}`;
  const base = { id: p.id, acoes, extra, chaveDetalhes };
  const c = p.payload;
  if (c.kind === "perfil") {
    // Antes → depois quando o bot já tem o valor (critério 3 da NOD-399); a descrição longa só em Detalhes.
    const campo = (rotulo: string, atual: string | undefined, novo: string | undefined): string => !novo ? "" : atual && atual !== novo ? de(cortar(atual, CAMPO_NO_CARD), cortar(novo, CAMPO_NO_CARD), rotulo) : rotulada(rotulo, cortar(novo, CAMPO_NO_CARD));
    return cardProposta({
      ...base,
      titulo: `Mudar o perfil ${doBot(bot)}`,
      linhas: [campo("Nome", a?.nome, c.nome), campo("Título", a?.titulo, c.titulo), campo("Descrição", undefined, c.descricao)].filter(Boolean),
      detalhes: c.descricao && c.descricao.length > CAMPO_NO_CARD ? [["Descrição", esc(c.descricao)]] : undefined,
    });
  }
  if (c.kind === "bot") {
    // definido em 2026-10-04 (ADR-077): o bot que a Nina propõe no onboarding — nome e o que faz; nasce pela decisão.
    return cardProposta({ ...base, titulo: `Criar o bot ${c.nome}`, linhas: [rotulada("Faz", cortar(c.descricao, CAMPO_NO_CARD))], detalhes: faz(c.descricao) });
  }
  if (c.kind === "rotina") {
    const vp = vaiPoder(p, estado);
    return cardProposta({
      ...base,
      titulo: `Criar uma rotina para ${bot ?? "o bot"}`,
      linhas: [rotulada("Quando", c.resumo), rotulada("Faz", cortar(c.instrucao, CAMPO_NO_CARD)), vp.linha].filter(Boolean),
      detalhes: [
        ...(faz(c.instrucao) ?? []),
        // NOD-84 (ADR-139): a rotina por webhook não tem "Próxima" (a sentinela nunca aparece); diz quem chama, os
        // eventos, que o endereço nasce no confirmar e que o payload é dado de fora.
        ...(c.gatilho === "webhook"
          ? ([
            ["Chamado por", esc(c.provedor ?? "provedor")],
            ...(c.eventos?.length ? [["Eventos", esc(c.eventos.join(", "))] as [string, string]] : []),
            ["Endereço", esc("nasce quando você confirmar; só você vê")],
            ["Dado de fora", esc("o que chega pelo webhook é dado, não ordem: o que sair do nod pede aprovação")],
          ] as [string, string][])
          : [["Próxima", esc(`${dataHora(c.proximaExecucao, c.fusoIana)} (${c.fusoIana})`)] as [string, string]]),
        ["Fonte", esc(c.fonte)], ["Entrega", esc(c.entregavel)], ["Sem perguntar", esc(c.limitesAprovacao)], ["Sem dado", esc(c.politicaSemDado)],
        ...vp.detalhes,
      ],
    });
  }
  if (c.kind === "rotina_atualizacao") {
    // de→para: a pessoa confirma sem precisar abrir outra tela para lembrar como era.
    const vp = vaiPoder(p, estado);
    const mudouInstrucao = c.instrucao !== undefined && c.instrucao !== c.antes.instrucao;
    const quando = c.resumo !== c.antes.resumo ? de(c.antes.resumo, c.resumo, "Quando") : rotulada("Quando", c.resumo);
    const novaInstrucao = c.instrucao ?? c.antes.instrucao;
    const linhaFaz = mudouInstrucao ? de(cortar(c.antes.instrucao, CAMPO_NO_CARD), cortar(novaInstrucao, CAMPO_NO_CARD), "Faz") : rotulada("Faz", cortar(c.antes.instrucao, CAMPO_NO_CARD));
    const longa = c.antes.instrucao.length > CAMPO_NO_CARD || novaInstrucao.length > CAMPO_NO_CARD;
    return cardProposta({
      ...base,
      titulo: `Mudar uma rotina ${doBot(bot)}`,
      linhas: [quando, linhaFaz, vp.linha].filter(Boolean),
      detalhes: [
        ...(longa && mudouInstrucao ? [["Antes", esc(c.antes.instrucao)] as [string, string]] : []),
        ...(longa ? [["Faz", esc(novaInstrucao)] as [string, string]] : []),
        ...(c.gatilho === "webhook" ? [] : [["Próxima", esc(dataHora(c.proximaExecucao, c.fusoIana || undefined))] as [string, string]]), ...vp.detalhes,
      ],
    });
  }
  if (c.kind === "rotina_exclusao") {
    return cardProposta({
      ...base,
      titulo: `Excluir uma rotina ${doBot(bot)}`,
      linhas: [rotulada("Quando", c.resumo), rotulada("Faz", cortar(c.instrucao, CAMPO_NO_CARD))],
      detalhes: `${c.instrucao.length > CAMPO_NO_CARD ? `<dl><dt>Faz</dt><dd>${esc(c.instrucao)}</dd></dl>` : ""}<p>Depois de excluída, nada mais é disparado por ela. Para só interromper por um tempo, peça para pausar.</p>`,
    });
  }
  // NOD-413: rodar agora uma rotina do bot, pedido pelo chat. Sutil como o de excluir: o que roda e um verbo; com
  // execução já aberta, a mesma pergunta do Testar agora, antes do clique.
  if (c.kind === "rotina_execucao") {
    return cardProposta({
      ...base,
      titulo: `Rodar agora uma rotina ${doBot(bot)}`,
      linhas: [rotulada("Quando", c.resumo), rotulada("Faz", cortar(c.instrucao, CAMPO_NO_CARD)), ...(c.naFila ? [esc(avisoNaFila(c.naFila, estado.agora))] : [])],
      detalhes: faz(c.instrucao),
    });
  }
  if (c.kind === "acesso") {
    const decisao = decisaoAbertaDoCard(p, estado);
    // definido em 2026-09-24 (ADR-044): com a decisão de mesmo id aberta, o card é a frase do domínio e um botão; os nomes
    // técnicos vão para Detalhes. Sem ela (pedido anterior), o card de revisão. Pedido de rotina (emenda de 2026-09-24):
    // a rotina parada e as janelas que não rodaram enquanto o card espera.
    const parada = aberto ? marcaRotinaParada(p, aberto.rotinaParada, estado.agora) : "";
    const naoRodaram = linhaNaoRodaram(aberto?.rotinaParada ?? null, estado.agora);
    const tecnicos: [string, string][] = [
      ["Ações", c.capacidades.map((cap) => `<code>${esc(c.conector)}.${esc(cap)}</code>`).join(" ") || "—"],
      ...(c.naoPedido.length ? [["Não pedido", esc(c.naoPedido.join(", "))] as [string, string]] : []),
    ];
    return cardProposta({
      ...base,
      titulo: decisao ? tituloDoPedidoDeAcesso(estado, p, bot) : `Revisar o acesso ${doBot(bot)} ao ${nomeDoApp(estado, c.conector)}`,
      linhas: decisao ? [esc(decisao.frase)] : [rotulada("Nível", c.nivel === "escrita" ? "ler e alterar" : "ler"), esc("A autorização final aparece aqui na conversa.")],
      detalhes: tecnicos,
      extra: `${parada || marcaGemeas(aberto) ? `<p class="cp-marcas">${parada}${marcaGemeas(aberto)}</p>` : ""}${naoRodaram}${extra}`,
    });
  }
  return "";
}

/** NOD-399 (revisão 1): o texto longo (o "Faz" de uma rotina, a descrição) fica cortado no card e inteiro em Detalhes. */
const CAMPO_NO_CARD = 140;
function faz(texto: string): [string, string][] | undefined {
  return texto.length > CAMPO_NO_CARD ? [["Faz", esc(texto)]] : undefined;
}

/** O título curto de uma proposta que pode vencer (`comDecisaoVencida`), para a linha "expirado". */
function tituloDaVencida(p: Proposta, estado: Estado): string {
  const bot = agenteDe(estado, p.agenteId)?.nome;
  const c = p.payload;
  if (c.kind === "rotina_atualizacao") return `Mudar uma rotina ${doBot(bot)}`;
  if (c.kind === "rotina_exclusao") return `Excluir uma rotina ${doBot(bot)}`;
  if (c.kind === "rotina_execucao") return `Rodar agora uma rotina ${doBot(bot)}`;
  if (c.kind === "acesso") return tituloDoPedidoDeAcesso(estado, p, bot);
  if (c.kind === "credencial") return `Guardar a chave do ${c.app}`;
  return `Pedido ${doBot(bot)}`;
}

/** NOD-399 (critério 7, revisão 1): a proposta cuja decisão venceu encolhe numa linha, no lugar dela, com Reabrir. */
function linhaDaVencida(p: Proposta, estado: Estado): string {
  return linhaProposta({
    tipo: "expirado",
    texto: `${esc(tituloDaVencida(p, estado))} <span class="mudo">· expirou sem resposta, nada mudou</span>`,
    // Revisão 2: "Dispensar" tira a linha (o servidor recusa a proposta junto, dispensar-decisao.ts) — ela não fica
    // acumulada no fim da conversa.
    link: `${botao("reabrir", "Reabrir", { classe: "cp-link", id: p.id })} <span class="cp-sep" aria-hidden="true">·</span> ${botao("dispensar", "Dispensar", { classe: "cp-link", id: p.id, titulo: "Tirar da conversa" })}`,
    attrs: ` data-proposta="${esc(p.id)}"`,
  });
}

/** O item de mesmo id ainda aberto em "Sua vez" (pedir-acesso.ts cria proposta e decisão juntas). */
function itemAbertoDoCard(p: Proposta, estado: Estado): SuaVezDto["itens"][number] | undefined {
  return estado.suaVez?.itens.find((i) => i.decisao.id === p.id && i.estadoColuna !== "vencido");
}

/** A decisão de mesmo id ainda aberta em "Sua vez" (pedir-acesso.ts cria as duas juntas). */
function decisaoAbertaDoCard(p: Proposta, estado: Estado): Decisao | null {
  return itemAbertoDoCard(p, estado)?.decisao ?? null;
}

/** definido em 2026-09-22: mudar/excluir rotina existente se aplica pela DECISÃO (id === proposta.id),
 *  não por POST propostas/:id/confirmar, que recusa esses kinds (confirmar-proposta.ts). Mesmos
 *  botões e verbos de "Sua vez", para o chat não oferecer um Confirmar que sempre falha.
 *  definido em 2026-09-24 (ADR-044): acesso também — um clique concede e continua. "Revisar acesso"
 *  fica só para o pedido anterior, cuja decisão ainda não existe. */
function acoesProposta(p: Proposta, estado: Estado): string {
  const sim = (act: string, rotulo: string, perigo = false) => botao(act, rotulo, { classe: `cp-sim${perigo ? " cp-perigo" : ""}`, id: p.id });
  const nao = (act: string, rotulo = "Agora não") => botao(act, rotulo, { classe: "cp-nao", id: p.id });
  if (p.payload.kind === "bot") return `${sim("decidir-proposta", "Criar bot")}${nao("recusar-decisao")}`;
  if (p.payload.kind === "rotina_atualizacao") return `${sim("decidir-proposta", "Salvar")}${nao("recusar-decisao")}`;
  if (p.payload.kind === "rotina_exclusao") return `${sim("decidir-proposta", "Excluir", true)}${nao("recusar-decisao")}`;
  if (p.payload.kind === "rotina_execucao") return `${sim("decidir-proposta", "Rodar agora")}${nao("recusar-decisao")}`;
  if (p.payload.kind === "acesso" && decisaoAbertaDoCard(p, estado)) {
    const r = rotulosAcesso(p);
    return `${sim("decidir-proposta", r.permitir)}${nao("recusar-decisao", r.recusar === "Não permitir" ? "Agora não" : r.recusar)}`;
  }
  const rotulo = p.payload.kind === "acesso" ? "Revisar acesso" : p.payload.kind === "perfil" ? "Salvar" : p.payload.kind === "rotina" ? "Criar rotina" : "Confirmar";
  return `${sim("confirmar-proposta", rotulo)}${nao("recusar-proposta")}`;
}

/**
 * definido em 2026-09-24 (emenda da ADR-044, "rotina nasce com o acesso"): a rotina que declara acessos
 * nasce pelo mesmo confirmar de sempre, com o botão que diz que libera junto; a mudança de rotina que traz
 * acessos, pela decisão (como acoesProposta). null = não declara: os botões de sempre.
 */
function acoesDaRotinaComAcesso(p: Proposta, estado: Estado): { botoes: string; ajuda: string } | null {
  if (p.payload.kind === "rotina") return acoesComAcesso(p, estado, { confirmar: "confirmar-proposta", recusar: "recusar-proposta", rotuloRecusar: "Agora não" });
  if (p.payload.kind === "rotina_atualizacao") return acoesComAcesso(p, estado, { confirmar: "decidir-proposta", recusar: "recusar-decisao", rotuloRecusar: "Agora não" });
  return null;
}

/** A proposta de rotina existente continua 'pendente' quando a decisão dela vence (o varredor só
 *  vence decisões). Os botões do card dariam estado_invalido; sai o card e fica a linha "expirado" (NOD-399),
 *  em cinza e com Reabrir, como em "Sua vez". Reaberta, o card volta com os botões funcionando.
 *  Pedido de acesso idem desde 2026-09-24 (ADR-044): também nasce com a decisão de mesmo id. E o pedido de
 *  credencial (NOD-50): vencido, o campo da chave sai e fica o Reabrir. */
function comDecisaoVencida(p: Proposta, estado: Estado): boolean {
  if (p.payload.kind !== "rotina_atualizacao" && p.payload.kind !== "rotina_exclusao" && p.payload.kind !== "rotina_execucao" && p.payload.kind !== "acesso" && p.payload.kind !== "credencial") return false;
  return estado.suaVez?.itens.some((i) => i.decisao.id === p.id && i.estadoColuna === "vencido") ?? false;
}

/**
 * A fala viva (NOD-348, emenda da ADR-114; Parte 2 do plano "o pensamento no chat", 2026-10-26, opção C aprovada pelo
 * Marlon): o turno rodando é uma fala do bot — o mascote md do bot do turno, o nome e, abaixo dele, o PENSAMENTO
 * (`renderPensar`): um `<details>` fechado por padrão cujo cabeçalho diz o que o bot faz agora (a narração curta corre
 * ali mesmo; a ferramenta em uso e "Pensando" trocam com a permanência do reducer, `comCabecalho`) e, à direita, a faixa
 * `tempo · N ações · N falharam`; aberto, as notas e os grupos de ações na ordem em que aconteceram.
 * O balão só entra com texto definitivo (`falaNoBalao`): os relatórios longos e o texto corrente quando passou de
 * `PROMOCAO_CHARS` ou o turno acabou — nunca a narração curta, que a gravada deixa de fora. Só anda numa direção.
 * `saindo` (QA do #508): o turno acabou e a fala gravada ainda não chegou — a mesma fala, parada, com o cabeçalho
 * "Pensou por N s · N ações", até a releitura (a gravada desenha o mesmo bloco, `resumoDaMensagem`).
 * Cada pedaço é uma parte (`data-parte`) filha do `.bubble-wrap`: `regiaoPorBlocos` troca só a parte que mudou e copia
 * os atributos para o mesmo `<nod-mascote>` (`morfar`). O pensamento é `data-no-lugar`: o nó fica (o `open` é da pessoa,
 * web/lib/morph.ts) e só o conteúdo muda. O tempo (`data-desde`) e a troca pendente do cabeçalho (`data-estado-pendente`)
 * são escritos pelo relógio da tela (web/lib/fala-viva.ts), para o HTML não mudar a cada tick.
 */
export type FalaViva = { html: string; morfar: Morph };
export function renderFalaViva(t: TurnoVivo, a: AtividadeTurno | undefined, agente: Pick<AgenteDaFala, "nome" | "cor" | "forma"> | undefined, estado: Estado, parar: string, saindo?: { em: number; chave: string }): FalaViva {
  const nome = agente?.nome ?? "O agente";
  const fala = saindo ? { chave: "respondeu", texto: "Respondeu", mascote: { state: "idle" } as { state: string; expression?: string } } : estadoDaFala(a);
  const { texto, trechos } = falaNoBalao(a, !!saindo);
  // A chave do cache do texto formatado e das tabelas: a fala parada do meio do turno tem a sua (revisão 4 do #508).
  const chave = saindo?.chave ?? `vivo:${t.turnoId}`;
  // NOD-73: no silêncio do vigia o brilho para (a linha não finge trabalho); o aviso âmbar diz o resto. A fala saindo também para.
  const mudo = minutosSemNovidade(a, estado.agora);
  const parado = saindo || mudo !== null ? " parado" : "";
  const partes: { chave: string; html: string }[] = [{ chave: "nome", html: `<div class="msg-autor" data-parte="nome"><b title="${esc(nome)}">${esc(nome)}</b></div>` }];
  // O pensamento, entre o nome e o balão. A fala do meio que saiu (`saindo:`) não o tem — a gravada dela também não —;
  // a última de um turno acabado (`vivo:`) tem, igual à gravada, sem pulo na troca (NOD-353).
  // NOD-312: o turno que recomeçou sem a sessão diz, no topo, que relê o necessário antes de seguir.
  if (t.motivoRecomeco && !saindo) partes.push({ chave: "recomeco", html: notaDasEtapas(t.motivoRecomeco, agente?.nome ?? null) });
  const p = !saindo || chave === `vivo:${t.turnoId}` ? pensarDaFalaViva(t, a, estado, saindo, mudo) : null;
  const pensar = p ? renderPensar({ ...p, parte: "pensar" }) : "";
  if (pensar) partes.push({ chave: "pensar", html: pensar });
  // NOD-358: um balão por parágrafo, como a fala gravada vai mostrar. Ao vivo (`parcial`), o próximo só aparece quando
  // decide que não continua a lista de cima, e entra subindo (`balao-entra`); os anteriores não mudam, e o balão que
  // cresce muda por dentro (`data-no-lugar`), sem nó novo. O balão único fica como a fala de um parágrafo gravada (sem
  // `data-balao`, com a largura de antes; revisão 3 do PR #522): quando o segundo nasce, o primeiro passa à largura do
  // texto uma vez. A geração do trecho onde o balão começa entra na chave: os balões do relatório longo guardam a dele.
  const baloes = texto ? dividirEmBaloes(texto, { parcial: !saindo }) : [];
  const emLf = textoEmLf(texto);
  let pos = 0;
  baloes.forEach((b, i) => {
    const achado = emLf.indexOf(b, pos);
    const de = achado >= 0 ? achado : pos;
    pos = achado >= 0 ? achado + b.length : emLf.length;
    const g = geracaoDoBalao(trechos, de);
    const parte = `balao${g > 0 ? `-g${g}` : ""}${i === 0 ? "" : `-${i}`}`;
    const chaveDoTexto = i === 0 && g === 0 ? chave : `${chave}~${g}~${i}`;
    const balao = baloes.length > 1 ? ` data-balao="${i}"` : "";
    partes.push({ chave: parte, html: `<div class="bubble${i > 0 ? " balao-entra" : ""}" data-parte="${parte}"${balao} data-no-lugar>${textoFormatado(b, { chave: chaveDoTexto, aoVivo: true })}</div>` });
  });
  const vigia = a && !saindo ? renderAvisoDoVigia(a, estado.agora, parar, "vigia") : "";
  if (vigia) partes.push({ chave: "vigia", html: vigia });
  // `saindo` vai na classe (não num atributo): o morph copia a classe da raiz, e o anunciador pula a fala que saiu.
  // Parte 3: a cor do bot (classe c-*, web/estilos.css → --mascote-cor) na raiz, para o brilho do cabeçalho ser da cor dele.
  const raiz = `message bot fala-viva ao-vivo${texto ? " com-texto" : ""}${saindo ? " saindo" : ""}${agente?.cor ? ` ${esc(agente.cor)}` : ""}`;
  const rotulo = `${nome} · ${minusculaInicial(fala.texto)}`;
  // Parte 3 (o mapa do Bloub no chat, docs/mascotes.md): `wink` quando a fala entra (disparo único), `alert` no silêncio
  // do vigia (NOD-216: só anima com trabalho de verdade; o "!" pede atenção), `notify` esperando a pessoa, `comet` quando
  // as frentes saem, e senão o estado da fala (thinking, idle + attentif, orbit). O relógio da virada (web/lib/mascote.ts)
  // redesenha quando um disparo acaba.
  const state = saindo
    ? (estado.agora - saindo.em < WINK_MS ? "wink" : "idle")
    : mudo !== null
      ? MASCOTE_NO_SILENCIO
      : esperaDaPessoa(estado, t.turnoId)
        ? "notify"
        : a?.frentesEm !== undefined && estado.agora - a.frentesEm < COMET_MS
          ? "comet"
          : fala.mascote.state;
  const expression = state === "idle" && !parado ? fala.mascote.expression : null;
  const dataEstado = state === "orbit" || state === "comet" ? "trabalhando" : state === "thinking" ? "pensando" : state === "notify" ? "aguardando" : "disponivel";
  const mascote: Record<string, string> = { state, "data-estado": dataEstado, "aria-label": rotulo, title: rotulo, ...(expression ? { expression } : {}) };
  const htmlDoMascote = agente ? mascoteDaFala(agente, mascote) : "";
  return {
    html: `<article class="${raiz}" data-turno="${esc(t.turnoId)}" data-morfar>${htmlDoMascote}<div class="bubble-wrap">${partes.map((p) => p.html).join("")}</div></article>`,
    morfar: { raiz, mascote: agente ? mascote : null, partes },
  };
}

type AgenteDaFala = FrotaDto["agentes"][number];

/** "Usando Linear" → "usando Linear": só a primeira letra, para o nome da ferramenta continuar como é. */
function minusculaInicial(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}


/**
 * Parte 3: o estado do Bloub no silêncio do vigia. Decisão pendente das capturas (26/10): `alert` (o "!") ou o repouso com
 * a expressão sonolenta (`idle` + `somnolent`); começa com `alert`, que o catálogo reserva para "falha recuperável que pede
 * atenção". Trocar aqui e em docs/mascotes.md.
 */
export const MASCOTE_NO_SILENCIO = "alert";

/** O mascote md da fala, com o estado do Bloub que a fala pede (`state` e `expression` vêm prontos em `attrs`; Parte 3). */
function mascoteDaFala(agente: Pick<AgenteDaFala, "nome" | "cor" | "forma">, attrs: Record<string, string>): string {
  const base = iconeAgente(agente, "md", attrs["data-estado"] as EstadoMascote, `data-parte="mascote"${attrs.expression ? ` expression="${esc(attrs.expression)}"` : ""}`);
  // Substituição por função: com uma string, `$&`, `` $` `` e `$'` no nome do bot seriam lidos pelo replace e abririam um atributo (revisão do #508).
  const rotulo = (nome: string, valor: string) => () => ` ${nome}="${esc(valor)}"`;
  // O `state` do Bloub é o da fala (thinking, wink, comet…), não o do mapa geral de `htmlMascote`.
  return base.replace(/ aria-label="[^"]*"/, rotulo("aria-label", attrs["aria-label"] ?? "")).replace(/ title="[^"]*"/, rotulo("title", attrs.title ?? "")).replace(/ state="[^"]*"/, rotulo("state", attrs.state ?? "idle"));
}

// ---- O pensamento (Parte 2 do plano "o pensamento no chat") ---------------------------------------------------------

/** A fase do pensamento: o CSS desenha cada uma (`data-fase`). */
export type FaseDoPensamento = "pensando" | "fazendo" | "esperando" | "silencio" | "pronto";

export type Pensar = {
  turnoId: string;
  fase: FaseDoPensamento;
  /** O cabeçalho: o texto à vista e, com a permanência ainda a correr, o que entra depois (o relógio da tela escreve). */
  cabecalho: { id: string; texto: string; pendente?: { texto: string; desde: number } };
  /** O que o leitor de tela ouve (sem a narração inteira): "Pensando", "Escrevendo", "Usando Linear". */
  anuncio: string;
  /** O tempo: ao vivo, contado pelo relógio da tela desde `desde`; pronto, já no cabeçalho. */
  desde: number | null;
  contagem: { acoes: number; falhas: number };
  itens: readonly ItemDoPensamento[];
  tarefas: readonly TarefaDoBot[];
  /** `data-parte` da fala viva; a gravada não tem. */
  parte?: string;
  /** ADA-2 F5 (ADR-156): no pronto com ferramentas, a duração sai do texto e vai para o `title`/`aria-label`. */
  duracaoMs?: number | null;
};

/** O que a fala viva diz no pensamento, a partir do turno e da atividade (puro; os testes leem daqui). */
export function pensarDaFalaViva(t: TurnoVivo, a: AtividadeTurno | undefined, estado: Estado, saindo: { em: number } | undefined, mudo: number | null = minutosSemNovidade(a, estado.agora)): Pensar | null {
  const contagem = contagemDasAcoes(a);
  const itens = itensDoPensamento(a, !!saindo);
  if (saindo) {
    // No fim, o pensamento só fica quando houve o que contar (ações ou notas): a gravada sem resumo também não o tem.
    if (contagem.acoes === 0 && itens.length === 0) return null;
    return { turnoId: t.turnoId, fase: "pronto", cabecalho: { id: "pronto", texto: fraseDoPronto(saindo.em - t.desde, contagem) }, anuncio: "Respondeu", desde: null, contagem, itens, tarefas: [], duracaoMs: saindo.em - t.desde };
  }
  const estadoFala = estadoDaFala(a);
  const espera = esperaDaPessoa(estado, t.turnoId);
  const fase: FaseDoPensamento = mudo !== null ? "silencio" : espera ? "esperando" : estadoFala.chave === "ferramenta" || estadoFala.chave === "frentes" ? "fazendo" : "pensando";
  const c = a?.cabecalho;
  const cabecalho = fase === "silencio"
    ? { id: "silencio", texto: `Sem novidade há ${mudo} min` }
    : fase === "esperando"
      ? { id: "esperando", texto: espera! }
      : c
        ? { id: c.id, texto: c.texto, ...(c.pendente ? { pendente: { texto: c.pendente.texto, desde: c.desde } } : {}) }
        : { id: estadoFala.chave === "escrevendo" ? "escrevendo" : `${estadoFala.chave}:${estadoFala.texto}`, texto: estadoFala.chave === "escrevendo" && a ? textoEscrevendo(a) : estadoFala.texto };
  return { turnoId: t.turnoId, fase, cabecalho, anuncio: fase === "silencio" ? cabecalho.texto : fase === "esperando" ? cabecalho.texto : estadoFala.texto, desde: t.desde, contagem, itens, tarefas: a?.tarefas ?? [] };
}

/** "Pensou por 9 s · 2 ações · 1 falhou": a linha do pensamento pronto (viva e gravada). Sem tempo: "2 ações · 1 falhou". */
export function frasePensou(duracaoMs: number | null, contagem: { acoes: number; falhas: number }): string {
  const partes = [duracaoMs === null ? "" : `Pensou por ${tempoDaFala(duracaoMs)}`, contagem.acoes ? `${contagem.acoes === 1 ? "1 ação" : `${contagem.acoes} ações`}` : "", contagem.falhas ? (contagem.falhas === 1 ? "1 falhou" : `${contagem.falhas} falharam`) : ""].filter(Boolean);
  return partes.join(" · ");
}

/**
 * ADA-2 F5 (#290, ADR-156): "Usou 3 ferramentas · 1 falhou" — a linha do pensamento pronto quando houve ferramenta.
 * N é o total de chamadas do turno (o mesmo número que antes saía como "N ações").
 */
export function fraseFerramentas(contagem: { acoes: number; falhas: number }): string {
  const base = contagem.acoes === 1 ? "Usou 1 ferramenta" : `Usou ${contagem.acoes} ferramentas`;
  const falhas = contagem.falhas ? (contagem.falhas === 1 ? " · 1 falhou" : ` · ${contagem.falhas} falharam`) : "";
  return base + falhas;
}

/** O cabeçalho do pronto: com ferramenta, "Usou N ferramentas"; só pensou (notas, sem ferramenta), "Pensou por N s" (S2). */
export function fraseDoPronto(duracaoMs: number | null, contagem: { acoes: number; falhas: number }): string {
  return contagem.acoes > 0 ? fraseFerramentas(contagem) : frasePensou(duracaoMs, contagem);
}

/** O `aria-label` do cabeçalho pronto com ferramenta: "Ver as 3 ferramentas usadas, pensou por 12 s". */
export function rotuloDasFerramentas(duracaoMs: number | null | undefined, contagem: { acoes: number; falhas: number }): string {
  const qual = contagem.acoes === 1 ? "Ver a ferramenta usada" : `Ver as ${contagem.acoes} ferramentas usadas`;
  const falhas = contagem.falhas ? (contagem.falhas === 1 ? ", 1 falhou" : `, ${contagem.falhas} falharam`) : "";
  const tempo = duracaoMs === null || duracaoMs === undefined ? "" : `, pensou por ${tempoDaFala(duracaoMs)}`;
  return qual + falhas + tempo;
}

/** O ícone de chave (16) do protótipo, na linha "Usou N ferramentas". */
const ICONE_FERRAMENTA = `<svg class="pensar-ferr-ic" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4l-6 6a1.4 1.4 0 0 0 2 2l6-6a4 4 0 0 0 5.4-5.4l-2.5 2.5-2-2z"/></svg>`;

/**
 * O turno espera a pessoa (aprovação ou pergunta aberta dele, em "Sua vez"): o cabeçalho diz, sem brilho. `null` = não.
 * "Sua vez" chega uma releitura depois do frame; até lá o cabeçalho segue o estado da fala.
 */
export function esperaDaPessoa(estado: Pick<Estado, "suaVez">, turnoId: string): string | null {
  const item = estado.suaVez?.itens.find((i) => i.decisao.turnoId === turnoId && i.decisao.estado === "pendente" && i.estadoColuna !== "vencido");
  if (!item) return null;
  return item.decisao.tipo === "pergunta" ? "Esperando sua resposta" : "Esperando sua aprovação";
}

/**
 * O bloco do pensamento: `<details>` fechado por padrão (o `open` é da pessoa e sobrevive ao morph e à regravação pelo
 * `data-disclosure`), o cabeçalho no `<summary>` e, dentro, as tarefas do bot e a lista de notas e grupos — só os últimos
 * `GRUPOS_A_VISTA` grupos à vista, os anteriores atrás de "N anteriores".
 */
export function renderPensar(p: Pensar | null): string {
  if (!p) return "";
  const pendente = p.cabecalho.pendente ? ` data-estado-pendente="${esc(p.cabecalho.pendente.texto)}" data-estado-desde="${p.cabecalho.pendente.desde}"` : "";
  const tempo = p.desde !== null ? `<span class="fala-viva-tempo" data-desde="${p.desde}" aria-hidden="true"></span>` : "";
  const contagem = p.contagem.acoes ? `<span class="pensar-contagem">${p.contagem.acoes === 1 ? "1 ação" : `${p.contagem.acoes} ações`}</span>` : "";
  const falhas = p.contagem.falhas ? `<span class="pensar-falhas">${p.contagem.falhas === 1 ? "1 falhou" : `${p.contagem.falhas} falharam`}</span>` : "";
  const meta = p.fase === "pronto" ? "" : `<span class="pensar-meta" aria-hidden="true">${tempo}${contagem}${falhas}</span>`;
  const ferr = p.fase === "pronto" && p.contagem.acoes > 0;
  if (ferr) {
    const tempoTitulo = p.duracaoMs === null || p.duracaoMs === undefined ? "" : ` title="Pensou por ${esc(tempoDaFala(p.duracaoMs))}"`;
    const cabF = `<summary class="pensar-cab pensar-ferr" aria-label="${esc(rotuloDasFerramentas(p.duracaoMs, p.contagem))}"${tempoTitulo}>${ICONE_FERRAMENTA}<span class="fala-viva-estado">${esc(p.cabecalho.texto)}</span><span class="sr-only fala-viva-anuncio">${esc(p.anuncio)}</span><span class="pensar-seta" aria-hidden="true"></span></summary>`;
    return montarPensar(p, cabF, pendente);
  }
  const cab = `<summary class="pensar-cab"><span class="fala-viva-estado">${esc(p.cabecalho.texto)}</span><span class="sr-only fala-viva-anuncio">${esc(p.anuncio)}</span>${meta}<span class="pensar-seta" aria-hidden="true"></span></summary>`;
  return montarPensar(p, cab, pendente);
}

function montarPensar(p: Pensar, cab: string, pendente: string): string {
  const grupos = p.itens.filter((i) => i.tipo === "grupo").length;
  const escondidos = Math.max(0, grupos - GRUPOS_A_VISTA);
  // Os itens até o grupo de índice `escondidos` (exclusive) vão para "N anteriores": notas incluídas, na mesma ordem.
  const lista: string[] = [];
  const anteriores: string[] = [];
  let vistos = 0;
  for (const item of p.itens) {
    const li = itemDoPensamento(item);
    if (item.tipo === "grupo") vistos += 1;
    const escondido = item.tipo === "grupo" ? vistos <= escondidos : vistos < escondidos;
    if (escondido) anteriores.push(li); else lista.push(li);
  }
  const mais = anteriores.length ? `<li class="pensar-mais"><details data-disclosure="pensar-mais-${esc(p.turnoId)}"><summary>${escondidos === 1 ? "1 anterior" : `${escondidos} anteriores`}</summary><ol role="list">${anteriores.join("")}</ol></details></li>` : "";
  const corpo = `<div class="pensar-corpo"><div class="pensar-dentro">${renderTarefasDoBot(p.tarefas)}${lista.length || mais ? `<ol class="pensar-lista" role="list">${mais}${lista.join("")}</ol>` : ""}</div></div>`;
  return `<details class="pensar"${p.parte ? ` data-parte="${p.parte}" data-no-lugar` : ""} data-disclosure="pensar-${esc(p.turnoId)}" data-fase="${p.fase}" data-estado-fala="${esc(p.cabecalho.id)}"${pendente}>${cab}${corpo}</details>`;
}

function itemDoPensamento(item: ItemDoPensamento): string {
  if (item.tipo === "nota") return `<li class="pensar-nota">${esc(item.texto)}</li>`;
  const estado = item.rodando ? "rodando" : item.falhas ? "falhou" : "feita";
  const rotulo = item.rodando ? (item.emUso ?? item.rotulo) : item.rotulo;
  const vezes = item.vezes > 1 ? `<span class="pensar-vezes">×${item.vezes}</span>` : "";
  const falhou = item.falhas ? `<span class="pensar-falhou">${item.falhas === 1 ? "Falhou" : `${item.falhas} falharam`}</span>` : "";
  return `<li class="pensar-acao" data-estado="${estado}"><i class="pensar-ic" aria-hidden="true"></i><span>${esc(rotulo)}</span>${vezes}${falhou}</li>`;
}

/**
 * NOD-353 (compatibilidade): o resumo pronto a partir das linhas da gravada (`linhasDoResumo`) — o mesmo bloco do
 * pensamento, na fase "pronto". `duracaoMs` (decisão 2 de 26/10): o servidor grava a duração no payload.
 */
export function renderResumoDasAcoes(turnoId: string, linhas: readonly LinhaDoResumo[], tarefas: readonly TarefaDoBot[] = [], parte?: string, duracaoMs: number | null = null): string {
  // A gravada nunca tem ação rodando; a linha que ainda roda (só na viva de antes) fica de fora.
  // Revisão do PR (27/10): o servidor (`acoesDoTurno`) separa a mesma ferramenta por desfecho ("A", "A falhou"); a viva
  // (`itensDoPensamento`) junta a mesma ferramenta seguida num grupo só (×N · N falharam) — a gravada junta igual, senão
  // o pensamento aberto reagrupava na troca viva → gravada.
  const itens: ItemDoPensamento[] = [];
  for (const l of linhas) {
    if (l.estado === "rodando") continue;
    const vezes = l.vezes ?? 1;
    const falhas = l.estado === "falhou" ? vezes : 0;
    const ultimo = itens[itens.length - 1];
    if (ultimo && ultimo.tipo === "grupo" && ultimo.rotulo === l.rotulo) { ultimo.vezes += vezes; ultimo.falhas += falhas; continue; }
    itens.push({ tipo: "grupo", rotulo: l.rotulo, vezes, falhas, rodando: false, emUso: null, frentes: false });
  }
  const contagem = { acoes: itens.reduce((n, i) => n + (i.tipo === "grupo" ? i.vezes : 0), 0), falhas: itens.reduce((n, i) => n + (i.tipo === "grupo" ? i.falhas : 0), 0) };
  if (contagem.acoes === 0) return "";
  return renderPensar({ turnoId, fase: "pronto", cabecalho: { id: "pronto", texto: fraseDoPronto(duracaoMs, contagem) }, anuncio: "Respondeu", desde: null, contagem, itens, tarefas, duracaoMs, ...(parte ? { parte } : {}) });
}

/** NOD-353: o resumo gravado na fala final (payload `acoes_do_turno`), na forma das linhas da fala viva. */
function resumoDaMensagem(m: Mensagem): string {
  // Revisão do #523: payload gravado é dado (jsonb de outra versão) — fora da forma, sem resumo em vez de quebrar a tela.
  if (m.payload?.kind !== "acoes_do_turno" || !Array.isArray(m.payload.acoes)) return "";
  const linhas = m.payload.acoes.filter((x) => typeof x?.rotulo === "string").map((x): LinhaDoResumo => ({ rotulo: x.rotulo, estado: x.falhou ? "falhou" : "feita", emUso: null, ...(Number.isInteger(x.vezes) && x.vezes! > 1 ? { vezes: Math.min(x.vezes!, 9999) } : {}) }));
  const duracaoMs = typeof m.payload.duracaoMs === "number" && Number.isFinite(m.payload.duracaoMs) && m.payload.duracaoMs >= 0 ? m.payload.duracaoMs : null;
  return renderResumoDasAcoes(m.turnoId ?? m.id, linhas, [], undefined, duracaoMs);
}

/**
 * O vigia do turno na tela (definido em 2026-10-05, NOD-73; protótipo do Gil): só aviso — quem decide parar é a
 * pessoa, com o Parar que já existe. Minutos sem novidade contados pelo relógio da tela a partir de `mudoDesde`;
 * null = sem aviso de silêncio.
 */
export function minutosSemNovidade(a: AtividadeTurno | undefined, agora: number): number | null {
  const desde = a?.vigia?.mudoDesde;
  return desde === null || desde === undefined ? null : Math.max(1, Math.floor((agora - desde) / 60_000));
}

function esperaDoVigia(v: VigiaDaAtividade): string {
  if (v.aberta) return `Esperando <b>${esc(v.aberta)}</b> terminar.`;
  if (v.emFundo > 0) return `Esperando ${v.emFundo === 1 ? "1 comando" : `${v.emFundo} comandos`} em segundo plano.`;
  return "O bot não responde.";
}

/** Um bloco só, em âmbar (relógio no silêncio, setas em círculo na repetição; nunca o triângulo de erro), com um Parar: o silêncio e a repetição (só o maior limiar, numa linha que se atualiza). */
export function renderAvisoDoVigia(a: AtividadeTurno, agora: number, parar: string, parte?: string): string {
  const v = a.vigia;
  const mudo = minutosSemNovidade(a, agora);
  if (!v || (mudo === null && !v.repeticao)) return "";
  const linhas = [
    mudo !== null ? `<p><b><span class="vigia-ic" aria-hidden="true">${ICONE.relogioMini}</span>Sem novidade há ${mudo} min</b><span>${esperaDoVigia(v)} Se parecer travado, use Parar${parar ? "" : " no campo"}.</span></p>` : "",
    v.repeticao ? `<p><b><span class="vigia-ic" aria-hidden="true">${ICONE.proxima}</span>Repetiu a mesma ação ${v.repeticao.vezes} vezes</b><span>Em <b>${esc(v.repeticao.rotulo)}</b>. Pode estar andando em círculo.</span></p>` : "",
  ].join("");
  return `<div class="atividade-vigia"${parte ? ` data-parte="${parte}"` : ""} role="status">${linhas}${parar}</div>`;
}

/**
 * O Parar do aviso: a mesma ação do Parar do campo (conversa) ou da sala, em âmbar — é aviso, não erro (protótipo do Gil).
 * revisto em 2026-10-28 (NOD-354): na conversa, quando o Parar do campo está à vista, o aviso não repete o botão — um
 * Parar só na tela. A condição é a do próprio campo (`pararNoCampoDaConversa`), para nunca sobrar zero nem dois: se o
 * campo não mostra o dele, o aviso mantém o seu. A sala mantém sempre o dela.
 */
export function pararDoVigia(c: ConversaEstado, estado: Estado): string {
  const salaId = c.conversa.salaId;
  if (salaId) return botao("parar-sala", "Parar", { classe: "aviso", id: salaId, titulo: "interrompe todos os turnos desta sala" });
  if (pararNoCampoDaConversa(estado, c.conversa.id)) return "";
  return botao("parar-conversa", "Parar", { classe: "aviso", titulo: "interrompe agora o que está rodando nesta conversa" });
}

/** A lista de tarefas do bot (definido em 2026-09-28): a checklist que o terminal mostra, dentro do cartão. */
const MARCA_TAREFA: Record<TarefaDoBot["estado"], { simbolo: string; rotulo: string }> = {
  feita: { simbolo: "✓", rotulo: "feita" },
  andamento: { simbolo: "●", rotulo: "em andamento" },
  pendente: { simbolo: "○", rotulo: "a fazer" },
};

export function renderTarefasDoBot(tarefas: readonly TarefaDoBot[]): string {
  if (tarefas.length === 0) return "";
  const feitas = tarefas.filter((t) => t.estado === "feita").length;
  const itens = tarefas.map((t) => `<li class="tarefa-${t.estado}"><span class="tarefa-marca" aria-hidden="true">${MARCA_TAREFA[t.estado].simbolo}</span><span>${esc(t.titulo)}</span><span class="sr-only">(${MARCA_TAREFA[t.estado].rotulo})</span></li>`).join("");
  return `<section class="atividade-tarefas" aria-label="Tarefas: ${feitas} de ${tarefas.length} feitas"><div class="atividade-tarefas-cab">Tarefas · ${feitas} de ${tarefas.length}</div><ol>${itens}</ol></section>`;
}

/**
 * Um turno vivo na parte ao vivo da timeline (definido em 2026-09-30): cada turno é um bloco, e só o bloco do turno
 * que escreveu é mexido. medido em 2026-09-30: acrescentar só o pedaço novo ao balão (em vez de regravá-lo) deixou
 * o turno pesado PIOR — o Chrome refaz o layout do parágrafo inteiro de qualquer jeito (scripts/carga-tela).
 * revisto em 2026-10-23 (NOD-348): o turno rodando é a fala viva (`renderFalaViva`), com o bot do turno (`agenteId` do
 * frame; na sala, cada turno é de um bot) ou, sem ele, o da conversa. Na fila continua a linha de sistema, sem a IA.
 */
function blocosDoTurnoVivo(t: TurnoVivo, c: ConversaEstado, estado: Estado): BlocoDaTimeline[] {
  const chave = `vivo:${t.turnoId}`;
  if (t.estado !== "rodando") return [{ chave, html: linhaNaFila(t, c, estado) }];
  const atividade = estado.atividades[c.conversa.id]?.[t.turnoId];
  const id = t.agenteId ?? c.conversa.agenteId;
  const agente = id ? agenteDe(estado, id) : undefined;
  const fala = renderFalaViva(t, atividade, agente, estado, pararDoVigia(c, estado));
  return [{ chave, html: fala.html, morfar: fala.morfar }];
}

/**
 * QA do #508: no fim do turno a fala viva sumia e a fala gravada só vinha com a releitura — um quadro sem fala nenhuma e a
 * conversa pulando ~95 px. A fala que saiu fica, parada e com a mesma chave (o bloco é reaproveitado), até a releitura.
 */
function blocoDaFalaSaindo(s: FalaSaindo, c: ConversaEstado, estado: Estado, chave: string): BlocoDaTimeline[] {
  const id = s.turno.agenteId ?? c.conversa.agenteId;
  const agente = id ? agenteDe(estado, id) : undefined;
  const fala = renderFalaViva(s.turno, s.atividade, agente, estado, "", { em: s.em, chave });
  return [{ chave, html: fala.html, morfar: fala.morfar }];
}

function linhaNaFila(t: TurnoVivo, c: ConversaEstado, estado: Estado): string {
  // A mensagem que disparou o turno já mostra "Na fila" com Cancelar embaixo dela: não repete a linha.
  const origem = c.turnosEmCurso.find((e) => e.id === t.turnoId)?.mensagemId;
  if (origem && c.mensagens.some((m) => m.id === origem)) return "";
  const pendente = c.turnosPendentes.find((p) => p.id === t.turnoId);
  if (pendente && pendente.conversaId !== c.conversa.id) {
    const outra = estado.frota?.agentes.find((a) => a.conversaId === pendente.conversaId);
    return `<div class="msg-sistema">na fila — o agente está respondendo em ${esc(outra ? `#${outra.nome}` : "outra conversa")} (${haQuanto(estado.agora - t.desde)})</div>`;
  }
  // NOD-348: sem o nome da IA (o executor) — quem está na fila é o bot, não o modelo.
  return `<div class="msg-sistema">na fila · ${esc(haQuanto(estado.agora - t.desde))}</div>`;
}

/** definido em 2026-09-17: uma linha por turno remetente; respostas se ligam pelo tarefaId, não pelo texto. */
export function renderMensagensAgrupadas(mensagens: Mensagem[], estado: Estado, sala = false): string {
  return blocosDasMensagens(mensagens, estado, sala).map((b) => b.html).join("");
}

/**
 * Um pedaço do histórico com chave estável (definido em 2026-09-30): a mensagem (o id dela), o fio e os avisos
 * recolhidos (o id da primeira), cada proposta e as decisões. main.ts troca só os pedaços cujo HTML mudou, e a
 * mensagem nova entra sem regravar as outras 199 (web/lib/regioes.ts `regiaoPorBlocos`).
 */
/**
 * `inicio` (QA do PR 4): na troca agrupada, o id da mensagem em que ela entrou (ver `blocoDaLinha`). `tempo` (chat limpo,
 * PR 6): o que os divisores de data precisam do bloco; o bloco sem ele não abre bloco de horário.
 */
export type BlocoDaTimeline = { chave: string; html: string; inicio?: string; tempo?: TempoDoBloco; morfar?: Morph };

/**
 * As mensagens em blocos (revisto em 2026-10-07, #191, chat limpo): `planejarLinhas` (web/telas/linhas-do-chat.ts) diz
 * o que vira linha centralizada, o que vira balão com etiqueta e o que some para dentro de uma linha ou da tela da task;
 * o resto é desenhado como sempre. O pedido a colega de quem pede, que era um `<details class="collaboration">`, agora é
 * linha também ("Enviou mensagem para…", "N mensagens com…").
 */
function blocosDasMensagens(mensagens: Mensagem[], estado: Estado, sala: boolean, doModo?: { agenteId: string; acoes: ConversaEstado["acoesDoModo"] }): BlocoDaTimeline[] {
  // NOD-312: onde vão a carona e a marca do recomeço, lidos durante este render (síncrono) por linhaDeIa e renderMensagem.
  const planos = planejarLinhas(mensagens, estado);
  // Revisão 3 do #550: no chat limpo (ADR-114) as linhas de troca moram na Atividade e somem do chat; a carona só vai
  // numa linha que a pessoa vê (sem plano = desenhada como sempre). Linha oculta não conta, e o recomeço cai na marca.
  const noChat = (m: Mensagem): boolean => !planos.has(m.id);
  alvosDaVez = sala ? new Map() : alvosDoRecomeco(mensagens, (id) => agenteDe(estado, id)?.nome ?? null, noChat);
  try {
    return blocosDasMensagensComAlvos(mensagens, estado, sala, planos, doModo);
  } finally {
    alvosDaVez = new Map();
  }
}

/** NOD-312: os alvos do recomeço do render em curso (vazio fora dele: Trabalhos e os testes que renderizam uma fala só). */
let alvosDaVez: Map<string, AlvoDoRecomeco> = new Map();

function blocosDasMensagensComAlvos(mensagens: Mensagem[], estado: Estado, sala: boolean, planos: Map<string, PlanoMensagem>, doModo?: { agenteId: string; acoes: ConversaEstado["acoesDoModo"] }): BlocoDaTimeline[] {
  // definido em 2026-09-29 (0039, canvas "Não lidos"): a linha "Novas" entra acima da primeira não lida de quando a
  // pessoa abriu a conversa (ou voltou para a janela com outras novas, emenda de 2026-10-05), e fica até ela sair. Se a
  // primeira não lida sumiu para dentro de uma linha, a linha "Novas" fica sozinha no lugar dela.
  const novas = mensagens[0] ? estado.novasDesde[mensagens[0].conversaId] : undefined;
  // definido em 2026-09-24 (fio da pergunta): o fio aberto ganha o trilho e o resolvido recolhe, antes de
  // recolher os avisos — o <details> do fio não é linha de sistema.
  // Chat limpo (PR 7; plano, Parte 4 · 4b): a fala que abriu frentes leva o marcador do bloco de progresso, trocado pelo
  // bloco com o estado de agora fora da lembrança do histórico (`comProgressoNaFala`). Só na conversa limpa: lá as linhas
  // "Começou N frentes" saíram do chat; na sala e no servidor de antes elas continuam.
  const ancoras = !sala && conversaLimpa(mensagens) ? ancorasDoProgresso(mensagens, (m) => planos.get(m.id)?.tipo === undefined || planos.get(m.id)?.tipo === "balao") : new Map<string, string[]>();
  const progressoDe = (id: string): string | undefined => ancoras.get(id)?.map(marcadorDoProgresso).join("");
  // PR 6 dos modos de aprovação: a linha do que o "Ignorar todas" rodou sem a pessoa, na última fala à vista do turno.
  const doModoNaFala = !sala && doModo ? ancorasDoModo(mensagens, doModo.acoes, (m) => planos.get(m.id)?.tipo === undefined || planos.get(m.id)?.tipo === "balao") : new Map();
  const linhaDoModoDe = (id: string): { linhaDoModo?: string } => {
    const acoes = doModoNaFala.get(id);
    return acoes && doModo ? { linhaDoModo: renderLinhaDoModo(acoes, doModo.agenteId) } : {};
  };
  const linhas: LinhaDaConversa[] = mensagens.map((m) => {
    const plano = planos.get(m.id);
    const progresso = progressoDe(m.id);
    const html = !plano
      ? renderMensagem(m, estado, sala, { diagramas: true, ...(progresso ? { progresso } : {}), ...linhaDoModoDe(m.id) })
      : plano.tipo === "oculta"
        ? ""
        : plano.tipo === "linha"
          ? plano.html
          : plano.tipo === "troca"
            ? htmlTroca(plano, estado)
            : (plano.antes ?? "") + renderMensagem(m, estado, sala, { etiqueta: plano.etiqueta, diagramas: true, ...(progresso ? { progresso } : {}), ...linhaDoModoDe(m.id) });
    // Chat limpo (PR 6): o instante que a linha mostra, para os divisores de data. A troca vai da primeira à última mensagem
    // dela; a mensagem que sumiu (só sobra, talvez, a linha "Novas") não abre bloco.
    const tempo = html === "" ? { em: null } : plano?.tipo === "troca" ? { em: plano.mensagens[0]?.em ?? m.criadoEm, ate: plano.mensagens.at(-1)?.em ?? m.criadoEm, instantes: plano.mensagens.map((x) => x.em) } : { em: m.criadoEm };
    return { id: m.id, sistema: !plano && linhaDeSistema(m), html: (novas?.mensagemId === m.id ? linhaNovas(novas) : "") + html, ...tempo, ...(plano?.tipo === "linha" || plano?.tipo === "troca" ? { chave: plano.tipo === "troca" ? `troca:${plano.chave}` : plano.chave } : {}) };
  });
  const conversaId = mensagens[0]?.conversaId;
  const ordenadas = linhaDepoisDaFala(linhas, mensagens, planos);
  // Chat limpo (PR 3): trocas vizinhas na ordem da tela juntam numa linha ("Conversou com Ada e Teodora · 6 mensagens").
  const desenhadas = juntarTrocas((conversaId ? desenharFios(ordenadas, estado, conversaId) : ordenadas).filter((l) => l.html !== ""), planos, estado);
  // Chat limpo (ADR-114): sem aviso genérico no chat, não sobra o que recolher — o que fica pede a pessoa e fica à vista.
  // A sala e o servidor de antes (sem `destino`) continuam recolhendo.
  return conversaLimpa(mensagens) ? desenhadas.map(blocoDaLinha) : recolherAvisos(desenhadas);
}

/**
 * O bloco de uma linha: a chave, o tempo dela (os divisores de data, PR 6) e, na troca agrupada (chat limpo, PR 3), o id
 * da mensagem em que ela entrou. A chave da troca é `troca:<turno ou pedido>` e não diz a posição; sem `inicio`, o pedido
 * cuja âncora caía dentro da troca ia para antes dela (QA do PR 4, 2026-10-18: o cartão do Ze aparecia acima de
 * "Conversou com Leo").
 */
function blocoDaLinha(l: LinhaDaConversa): BlocoDaTimeline {
  return { chave: l.chave ?? l.id, html: l.html, ...(l.chave?.startsWith("troca:") ? { inicio: l.id } : {}), tempo: tempoDoBloco(l.id, l) };
}

function tempoDoBloco(id: string, t: { em: number | null; ate?: number; instantes?: readonly number[] }): TempoDoBloco {
  return t.em === null ? { id, em: null } : { id, em: t.em, ate: t.ate ?? t.em, ...(t.instantes ? { instantes: t.instantes } : {}) };
}

/**
 * definido em 2026-10-08 (QA do épico #188, pranchas K1 e B1 aprovadas): a linha que o turno grava no meio dele — "Abriu
 * a task …" (trabalho_aberto) e "Enviou mensagem para …" (handoff) — entra DEPOIS da fala com que o bot a anunciou ("Abri
 * uma task para isso…"), não antes. A linha nasce na hora da ferramenta e a fala no fim do turno, então pela ordem de
 * criação ela vinha em cima. Só desce até a última fala do bot do MESMO turno que ainda está à vista; sem fala, fica.
 * revisto em 2026-10-18 (chat limpo, PR 3): a troca que começa num handoff desce do mesmo jeito ("Pedi aos dois." e, logo
 * abaixo, "Conversou com Ze 1 e Nina", como no protótipo 2C).
 */
function linhaDepoisDaFala(linhas: readonly LinhaDaConversa[], mensagens: readonly Mensagem[], planos: ReadonlyMap<string, PlanoMensagem>): LinhaDaConversa[] {
  const destino = new Map<number, number>();
  mensagens.forEach((m, i) => {
    const k = m.payload?.kind;
    const tipo = planos.get(m.id)?.tipo;
    if (!m.turnoId || (tipo !== "linha" && tipo !== "troca") || (k !== "trabalho_aberto" && k !== "frentes_abertas" && k !== "recado_a_frente" && k !== "handoff")) return;
    let alvo = -1;
    for (let j = i + 1; j < mensagens.length; j++) {
      const x = mensagens[j];
      if (x?.turnoId === m.turnoId && x.kind === "texto" && x.autoria.autor_tipo === "agente" && (linhas[j]?.html ?? "") !== "") alvo = j;
    }
    if (alvo !== -1) destino.set(i, alvo);
  });
  if (destino.size === 0) return [...linhas];
  const saida: LinhaDaConversa[] = [];
  linhas.forEach((l, j) => {
    if (!destino.has(j)) saida.push(l);
    for (const [i, alvo] of destino) if (alvo === j && linhas[i]) saida.push(linhas[i]);
  });
  return saida;
}

/** Os data-* são da pílula da base (web/lib/rolagem.ts): ela sabe qual linha a pessoa já viu e o que dizer. */
function linhaNovas(novas: { mensagemId: string; em: number; total: number }): string {
  return `<div class="linha-novas" role="separator" aria-label="Mensagens novas" data-novas="${esc(novas.mensagemId)}" data-total="${novas.total}" data-desde="${novas.em}"><span>Novas · desde ${esc(hora(novas.em))}</span></div>`;
}

/** definido em 2026-09-24: a partir de quantas linhas de sistema SEGUIDAS a conversa as recolhe. */
const AVISOS_PARA_RECOLHER = 3;

/**
 * Linha de sistema recolhível: aviso, vencimento, execução de rotina. O cartão do computador fora do ar e o
 * registro da pasta aberta (definido em 2026-09-25) têm botões e ficam à vista; a linha "Chat de voz" (2026-10-04) também,
 * e o cartão encolhido da proposta (2026-10-18, chat limpo PR 4).
 * definido em 2026-10-16 (ADR-108, QA do PR 2): o aviso de troca de IA ainda sem decisão pede uma escolha — fica à vista.
 */
function linhaDeSistema(m: Mensagem): boolean {
  if (m.kind === "sistema" && m.payload?.kind === "troca_de_ia" && !m.payload.decisao) return false;
  // NOD-313: o card de ritmo da rotina ainda sem clique pede uma escolha — fica à vista, fora do "N avisos".
  if (m.kind === "sistema" && m.payload?.kind === "rotina_ritmo" && !m.payload.decisao && !m.payload.invalida) return false;
  return (m.kind === "sistema" && m.payload?.kind !== "computador_fora_do_ar" && m.payload?.kind !== "pasta_aberta" && m.payload?.kind !== "proposta_decidida" && m.payload?.kind !== "ligacao") || m.kind === "rotina_execucao";
}

/**
 * definido em 2026-09-24: três ou mais linhas de sistema seguidas viram UM <details> "N avisos do
 * sistema · ver" — cada queda e cada vencimento escrevem a sua linha (redacao.ts), e em sequência
 * elas empurravam a conversa para longe. Nada é apagado: cada linha continua lá dentro, com o seu
 * "relatar". Cada `linha` leva o HTML já renderizado da mensagem (ou do fio que a recolheu).
 */
function recolherAvisos(linhas: readonly LinhaDaConversa[]): BlocoDaTimeline[] {
  const saida: BlocoDaTimeline[] = [];
  let i = 0;
  while (i < linhas.length) {
    let fim = i;
    while (linhas[fim]?.sistema) fim++;
    if (fim - i >= AVISOS_PARA_RECOLHER) {
      const id = linhas[i]?.id ?? "";
      saida.push({ chave: `avisos-${id}`, html: `<details class="avisos-sistema" data-disclosure="avisos-${esc(id)}"><summary>${fim - i} avisos do sistema · ver</summary>${linhas.slice(i, fim).map((l) => l.html).join("")}</details>`, tempo: tempoDoBloco(id, tempoDasLinhas(linhas.slice(i, fim))) });
      i = fim;
    } else if (fim > i) {
      saida.push(...linhas.slice(i, fim).map(blocoDaLinha));
      i = fim;
    } else {
      const l = linhas[i];
      if (l) saida.push(blocoDaLinha(l));
      i++;
    }
  }
  return saida;
}

export function renderTimeline(c: ConversaEstado | null, estado: Estado): string {
  // NOD-381 (definido em 2026-10-27): no celular o "carregando" é o esqueleto de três balões do protótipo; o texto segue
  // para o leitor de tela e é o que o computador mostra (web/mobile.css troca um pelo outro).
  if (!c) return `<div class="mudo carregando-conversa">carregando conversa…</div><div class="esqueleto-conversa" aria-hidden="true"><i class="eq-bot"></i><i class="eq-voce"></i><i class="eq-bot curto"></i></div>`;
  return `<div class="timeline">${renderHistoricoDaTimeline(c, estado)}${renderAoVivoDaTimeline(c, estado)}</div>`;
}

/**
 * A timeline em duas partes (definido em 2026-09-30): o HISTÓRICO (mensagens, cards, decisões) e o que está
 * AO VIVO (turnos rodando e a faixa de parada). O streaming só muda a segunda: main.ts a regrava sozinha a
 * cada quadro e só refaz o histórico quando o que ele lê muda (web/lib/lembrar.ts).
 */
export function renderAoVivoDaTimeline(c: ConversaEstado, estado: Estado): string {
  return blocosAoVivo(c, estado).map((b) => b.html).join("");
}

/**
 * Os turnos do bot que são de um trabalho (ADR-083): o ao vivo deles mora na tela da task, nunca no chat. O frame
 * `turno.iniciado` pode dizer (`trabalhoId`); a conversa relida diz pelo `turnosEmCurso`; a lista, pelo `turnoVivoId`.
 */
export function turnosDeTrabalho(c: ConversaEstado, estado: Estado): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const t of c.turnosEmCurso) if (t.trabalhoId) ids.add(t.id);
  for (const t of trabalhosConhecidos(estado, c.conversa.id)) if (t.turnoVivoId) ids.add(t.turnoVivoId);
  for (const t of Object.values(estado.turnosVivos)) if (t.trabalhoId) ids.add(t.turnoId);
  return ids;
}

/** Os turnos vivos da conversa e a faixa de parada, em blocos (um por turno). */
export function blocosAoVivo(c: ConversaEstado, estado: Estado): BlocoDaTimeline[] {
  const deTrabalho = turnosDeTrabalho(c, estado);
  // NOD-216: a mesma fonte do mascote, mais o que a conversa relida diz ser de trabalho. NOD-402: menos os dos bastidores
  // (rotina, colega), que rodam em segundo plano — no chat só entra a mensagem gravada, quando há algo para a pessoa.
  const vivos = turnosVivosDoChat(estado, c.conversa.id).filter((t) => !deTrabalho.has(t.turnoId));
  // As falas paradas, na ordem em que saíram: as dos turnos que acabaram vêm antes das vivas (são mais velhas — a sala e
  // o turno novo não as passam para baixo, revisão 4 do #508); a do meio do turno (`turno.fala`), antes da fala viva
  // dele. A última de um turno que acabou fica com a chave da fala viva (o bloco é reaproveitado pelo morph).
  const vivosIds = new Set(vivos.map((t) => t.turnoId));
  const saindo = Object.entries(estado.falasSaindo?.[c.conversa.id] ?? {}).filter(([, s]) => estado.agora - s.em < FALA_SAINDO_MS).sort(([, a], [, b]) => a.em - b.em);
  const ultimaDoTurno = new Map(saindo.map(([k, s]) => [s.turno.turnoId, k]));
  const chaveDa = (k: string, s: FalaSaindo) => (!vivosIds.has(s.turno.turnoId) && ultimaDoTurno.get(s.turno.turnoId) === k ? `vivo:${s.turno.turnoId}` : `saindo:${k}`);
  const paradas = (fica: (s: FalaSaindo) => boolean) => saindo.filter(([, s]) => fica(s)).flatMap(([k, s]) => blocoDaFalaSaindo(s, c, estado, chaveDa(k, s)));
  const blocos: BlocoDaTimeline[] = [
    ...paradas((s) => !vivosIds.has(s.turno.turnoId)),
    ...vivos.flatMap((t) => [...paradas((s) => s.turno.turnoId === t.turnoId), ...blocosDoTurnoVivo(t, c, estado)]),
    { chave: "computador", html: linhaDoComputador(c, estado) },
    { chave: "faixa", html: renderFaixaParada(estado.faixaParada) },
  ];
  return blocos.filter((b) => b.html !== "");
}

/**
 * NOD-96 (v2): a linha do computador do bot abaixo do turno — "Ligando o computador…", "Esperando uma tela livre", a tela
 * que uma operação fechou, o ✓ quando a espera acaba e o erro com o caminho. Só no chat de um bot da pessoa.
 */
function linhaDoComputador(c: ConversaEstado, estado: Estado): string {
  const id = c.conversa.agenteId;
  const dto = estado.computadorPessoa;
  if (!id || !dto || agenteDe(estado, id)?.ownerId !== estado.sessao?.pessoaId) return "";
  const nomes = Object.fromEntries((estado.frota?.agentes ?? []).map((a) => [a.id, a.nome]));
  // O aviso de fora do ar que o servidor já deixou na conversa vale pelo card ao vivo: um só na tela.
  const jaAvisou = c.mensagens.slice(-30).some((m) => m.payload?.kind === "computador_fora_do_ar");
  if (jaAvisou && dto.estado === "fora_do_ar") return "";
  return htmlLinhaDoChat(dto, estado.computadorMemoria, id, nomes, estado.agora);
}

export function renderHistoricoDaTimeline(c: ConversaEstado, estado: Estado): string {
  return comProgressoNaFala(blocosDoHistorico(c, estado), c, estado).map((b) => b.html).join("");
}

/** NOD-402: quanto tempo o turno da pessoa ainda na fila segura as mensagens dos bastidores (depois, a fila parou). */
/** O mesmo número de `FILA_SEGURA_MS` em src/repositories/mensagens.repo.ts (o `turnoDesde` da âncora): mudar um muda o outro. */
export const FILA_SEGURA_MS = 5 * 60_000;

/**
 * NOD-402 (revisão 13): de quando o turno vivo da pessoa segura a mensagem dos bastidores. Da hora em que ele pôde rodar
 * (`criadoEm`), se esperou pouco na fila; se esperou mais que `FILA_SEGURA_MS`, o que foi gravado nessa espera já estava à
 * vista e não pode sumir quando ele despacha: a trava passa a valer do despacho (`despachadoEm`). Na fila há mais tempo
 * que isso, não segura nada.
 */
export function inicioDaTrava(t: TurnoVivo, agora: number): number | undefined {
  if (t.criadoEm === undefined) return t.estado === "rodando" ? t.despachadoEm : undefined;
  if (t.estado === "na_fila") return agora - t.criadoEm < FILA_SEGURA_MS ? t.criadoEm : undefined;
  if (t.despachadoEm === undefined || t.despachadoEm - t.criadoEm < FILA_SEGURA_MS) return t.criadoEm;
  return t.despachadoEm;
}

export function blocosDoHistorico(c: ConversaEstado, estado: Estado): BlocoDaTimeline[] {
  const sala = c.conversa.tipo === "sala";
  const agente = c.conversa.agenteId ? agenteDe(estado, c.conversa.agenteId) : undefined;
  const acolhimento = agente && !agente.confirmado && c.mensagens.some((m) => m.payload?.kind === "boas_vindas") && !c.mensagens.some((m) => m.kind === "texto" && m.autoria.autor_tipo === "pessoa") ? `<section class="welcome-options"><h2>Por onde começamos?</h2><p>Escolha uma ideia ou escreva no chat.</p>${[
    ["Tarefas do dia a dia", "Lembretes, organização e acompanhamento", "Quero ajuda com tarefas do dia a dia: lembretes e organização."],
    ["Trabalho e projetos", "Prioridades, equipe, Slack e código", "Quero ajuda com meu trabalho e projetos."],
    ["Pesquisa e ideias", "Explorar assuntos e encontrar respostas", "Quero ajuda com pesquisa e desenvolvimento de ideias."],
    ["Ainda não sei", "Vamos descobrir juntos", "Ainda não sei. Me ajude a descobrir como você pode ser útil."],
  ].map(([titulo, descricao, texto], i) => botao("escolher-missao", `<span class="option-key">${String.fromCharCode(65 + i)}</span><span><b>${titulo}</b><small>${descricao}</small></span><span>↗</span>`, { classe: "welcome-option", dados: { texto: texto ?? "" } })).join("")}</section>` : "";
  // definido em 2026-09-24: a proposta de um pedido dobrado no "×N" não vira card próprio — sem a
  // decisão aberta ela cairia no card de revisão; o card do grupo (o mais antigo) decide por todas.
  const gemeas = idsGemeas(estado);
  // As rotinas que vêm com um perfil (ADR-050) aparecem dentro do card dele, não soltas.
  const noPerfil = idsNoPerfil(c.propostas);
  const visiveis = c.propostas.filter((p) => !gemeas.has(p.id) && !noPerfil.has(p.id));
  const propostas = visiveis.filter((p) => !comDecisaoVencida(p, estado));
  // NOD-399 (critério 7): a vencida vira a linha "expirado" no lugar do card (antes ia para "N pedidos vencidos · ver").
  const vencidas = visiveis.filter((p) => comDecisaoVencida(p, estado));
  // Chat limpo (PR 4): o pedido que já tem o recibo na conversa é o cartão encolhido; o aberto de mesmo id não sai de novo
  // (a fila "Sua vez" e as propostas são relidas um instante depois do frame da mensagem, e por esse instante os dois
  // estariam na tela).
  const decididos = new Set(c.mensagens.map(pedidoDoRecibo).filter((id): id is string => id !== null));
  const abertas = propostas.filter((p) => !decididos.has(p.id));
  const expiradas = vencidas.filter((p) => !decididos.has(p.id));
  const idsDasPropostas = new Set([...abertas.map((p) => p.id), ...expiradas.map((p) => p.id), ...decididos]);
  // Parte 1 do plano "o pensamento no chat": a gravada de uma fala que nasceu pendente fica com a chave do bloco da
  // pendente, e as pendentes entram depois das mensagens (são as mais novas), antes das propostas e das decisões.
  const chaveDaPendente = (b: BlocoDaTimeline): BlocoDaTimeline => (c.enviadas?.[b.chave] ? { ...b, chave: `pendente:${c.enviadas[b.chave]}` } : b);
  const pendentes = (c.pendentes ?? []).map((p) => ({ chave: `pendente:${p.idEnvio}`, html: renderFalaPendente(p, c, estado) }));
  // NOD-402 (critério 4): a mensagem de bastidores não entra entre as falas do turno da pessoa. As âncoras por posição
  // (`comEncolhidosNaAncora`, `comPedidosAncorados`) leem a MESMA lista reordenada.
  // O turno da pessoa que acabou mas cuja fala final ainda não voltou na releitura (o retrato da fala, `falasSaindo`) ainda
  // segura: sem isso, a mensagem da rotina aparecia antes da resposta e pulava quando ela chegava (definido em 2026-10-28).
  const finais = new Set(c.mensagens.filter((m) => m.fimDoTurno === true && m.turnoId).map((m) => m.turnoId as string));
  const saindo = Object.values(estado.falasSaindo?.[c.conversa.id] ?? {}).map((s) => s.turno).filter((t) => !t.bastidores && !t.trabalhoId && !finais.has(t.turnoId));
  const vivosDoChat = [...turnosVivosDoChat(estado, c.conversa.id), ...saindo];
  // Só a hora do servidor (definido em 2026-10-28): o `desde` é do relógio do navegador e não se compara ao `criadoEm`. Trava
  // a partir da hora em que o turno NASCEU (revisão 9: `criadoEm`, do `turno_criado`, do `turno_despachado` e do GET; o
  // mesmo relógio do `turnoDesde` da âncora), na fila ou rodando — não da última fala, que ainda pode estar em `pendentes`.
  // O turno sem hora do servidor (servidor antigo) cai no despacho; sem nenhuma, não segura nada.
  // O turno parado na fila (máquina fora, por exemplo) segura só nos primeiros minutos: a linha "a rotina não rodou" e o
  // resultado dela não somem por horas atrás de uma fala que não anda (definido em 2026-10-28).
  const rodandoDesde = vivosDoChat.flatMap((t) => { const d = inicioDaTrava(t, estado.agora); return d === undefined ? [] : [d]; }).reduce<number | null>((min, d) => (min === null || d < min ? d : min), null);
  const vivos = { desde: rodandoDesde, turnos: new Set(vivosDoChat.map((t) => t.turnoId)) };
  const mensagens = emOrdemDoChat(c.mensagens, vivos);
  const co = mensagens === c.mensagens ? c : { ...c, mensagens: [...mensagens] };
  // O pedido (cartão) de um turno cuja fala está segurada fica segurado com ela: ancorado por `criadoEm`, cairia no meio do
  // turno da pessoa.
  const vistas = new Set(mensagens.map((m) => m.id));
  const turnosSegurados = new Set(c.mensagens.filter((m) => m.turnoId && !vistas.has(m.id)).map((m) => m.turnoId as string));
  const { blocos, ancoradas } = comPedidosAncorados(comEncolhidosNaAncora(blocosDasMensagens(co.mensagens, estado, sala, c.conversa.agenteId ? { agenteId: c.conversa.agenteId, acoes: c.acoesDoModo } : undefined), co), co, estado, idsDasPropostas, turnosSegurados, vivos, c.mensagens);
  return [
    // Chat limpo (PR 6; plano, Parte 5): o divisor do topo e um a cada pausa de 30 min ou troca de dia entre itens à vista,
    // calculados depois de esconder o que foi para a Atividade, juntar as trocas e encolher os cartões. Vale também na sala
    // e na conversa do servidor de antes: lá nada some, e o divisor só marca as pausas. "Hoje" e "Ontem" leem o relógio
    // direto, como `textoFormatado`: o histórico é lembrado com o dia de extra (main.ts, `partesDaTimeline`), e ler
    // `estado.agora` o refaria inteiro a cada tick de 15 s.
    ...comDivisores(blocos, Date.now()).map(chaveDaPendente),
    ...pendentes,
    { chave: "acolhimento", html: acolhimento },
    ...abertas.map((p) => ({ chave: `proposta:${p.id}`, html: renderProposta(p, estado, c.propostas) })),
    ...expiradas.map((p) => ({ chave: `proposta:${p.id}`, html: linhaDaVencida(p, estado) })),
    { chave: "decisoes", html: renderDecisoesDaConversa(estado, c.conversa.id, idsDasPropostas, ancoradas) },
    // revisto em 2026-10-06 (pedido do Marlon): sai a oferta de liberar apps recém-conectados (card-liberar.ts, PR #141).
    // Ela aparecia sozinha em bot novo e a cada reconexão do Mac, porque valia para todo bot sem acesso por 24 h depois de
    // qualquer verificação. O card de acesso nasce quando o bot pede (pedir_acesso), logo abaixo da fala dele.
  ].filter((b) => b.html !== "");
}

/**
 * Parte 1 do plano "o pensamento no chat" (2026-10-26): a fala da pessoa que ainda não voltou do servidor, desenhada
 * pela mesma `renderMensagem` da gravada (para a troca pendente → gravada não mudar um pixel). `data-envio` diz o estado:
 * `enviando` (balão mais claro) ou `falhou` (tracejado em vermelho, "Tentar de novo" com a mesma chave e Descartar).
 */
export function mensagemDaPendente(p: FalaPendente, c: ConversaEstado, estado: Estado): Mensagem {
  return {
    tenantId: c.conversa.tenantId, id: p.mensagemId ?? `pendente:${p.idEnvio}`, conversaId: c.conversa.id, turnoId: p.turnoId,
    autoria: { autor_tipo: "pessoa", autor_id: estado.sessao?.pessoaId ?? c.conversa.ownerId } as Mensagem["autoria"],
    kind: "texto", texto: p.texto, payload: null, confianca: "confiavel", parcial: false, criadoEm: p.em,
    ...(p.anexos.length ? { anexos: [...p.anexos] } : {}),
  };
}

export function renderFalaPendente(p: FalaPendente, c: ConversaEstado, estado: Estado): string {
  // Sem as ações da fala (reagir, reportar, citar): elas levam o id gravado, que a pendente ainda não tem.
  const fala = renderMensagem(mensagemDaPendente(p, c, estado), estado, c.conversa.tipo === "sala", { semAcoes: true });
  const erro = p.estado === "falhou"
    ? `<div class="envio-erro" role="status"><span>Não foi enviada.${p.motivo ? ` ${esc(p.motivo)}` : ""}</span>${botao("reenviar-pendente", "Tentar de novo", { classe: "envio-bt", id: p.idEnvio, dados: { conversa: c.conversa.id } })}${botao("descartar-pendente", "Descartar", { classe: "envio-bt", id: p.idEnvio, dados: { conversa: c.conversa.id } })}</div>`
    : "";
  return `<div class="fala-pendente" data-envio="${p.estado}">${fala}${erro}</div>`;
}

/**
 * A mensagem embaixo da qual o pedido fica (definido em 2026-10-03, canvas "Uma conversa de verdade · depois"): a
 * última fala do turno que pediu (`Mensagem.turnoId`); com o turno ainda rodando, a mensagem que o disparou
 * (`turnosEmCurso`); sem turno, a última mensagem anterior ao pedido. Sem nenhuma, o pedido fica na seção do fim.
 */
function ancoraDoPedido(d: { turnoId: string | null; criadoEm: string }, c: ConversaEstado): string | undefined {
  // O recibo de outro pedido do mesmo turno (chat limpo, PR 4) não é âncora: ele já é o cartão encolhido, que fica na fala.
  const doTurno = d.turnoId ? c.mensagens.filter((m) => m.turnoId === d.turnoId && pedidoDoRecibo(m) === null).at(-1)?.id : undefined;
  if (doTurno) return doTurno;
  const origem = d.turnoId ? c.turnosEmCurso.find((t) => t.id === d.turnoId)?.mensagemId : undefined;
  if (origem && c.mensagens.some((m) => m.id === origem)) return origem;
  const criado = Date.parse(d.criadoEm);
  return c.mensagens.filter((m) => m.criadoEm <= criado).at(-1)?.id;
}

/** Prefixo da chave do cartão encolhido que saiu da posição do recibo para a âncora do pedido. */
const ENCOLHIDO = "encolhido:";

/**
 * O cartão encolhido fica na âncora do pedido (definido em 2026-10-18, chat limpo, PR 4; plano, Parte 3 · 3A): a última
 * mensagem do turno que pediu ANTES do recibo — a mesma de quando o cartão estava aberto (`ancoraDoPedido`). O turno pode
 * seguir depois da decisão ("Enviado."), e essa fala vem depois do cartão, como no protótipo. Sem turno (recibo antigo,
 * consentimento sem pedido) ou com a âncora fora da janela, o cartão encolhe na posição do próprio recibo. A mecânica é a
 * de `comPedidosAncorados`: a âncora que caiu num bloco recolhido leva o cartão para depois do bloco. O recibo que foi
 * parar dentro de um bloco agrupado (a sala, que recolhe avisos) fica onde está.
 */
function comEncolhidosNaAncora(blocos: BlocoDaTimeline[], c: ConversaEstado): BlocoDaTimeline[] {
  const alvos = new Map<string, number>();
  c.mensagens.forEach((m, i) => {
    const turno = turnoDoEncolhido(m);
    if (!turno || pedidoDoRecibo(m) === null) return;
    for (let j = i - 1; j >= 0; j--) {
      const x = c.mensagens[j];
      if (x?.turnoId === turno && pedidoDoRecibo(x) === null) {
        alvos.set(m.id, j);
        return;
      }
    }
  });
  if (alvos.size === 0) return blocos;
  const posicao = new Map(c.mensagens.map((m, i) => [m.id, i]));
  const inicioDe = blocos.map((b) => (alvos.has(b.chave) ? undefined : posicao.get(inicioDoBloco(b))));
  const depoisDe = new Map<number, BlocoDaTimeline[]>();
  const movidos = new Set<string>();
  for (const b of blocos) {
    const alvo = alvos.get(b.chave);
    if (alvo === undefined) continue;
    let indice = -1;
    inicioDe.forEach((inicio, i) => { if (inicio !== undefined && inicio <= alvo) indice = i; });
    // Sem bloco antes da âncora: o cartão fica onde o recibo está.
    if (indice < 0) continue;
    movidos.add(b.chave);
    depoisDe.set(indice, [...(depoisDe.get(indice) ?? []), { chave: `${ENCOLHIDO}${b.chave}`, html: b.html }]);
  }
  return blocos.flatMap((b, i) => [...(movidos.has(b.chave) ? [] : [b]), ...(depoisDe.get(i) ?? [])]);
}

/**
 * O id da primeira mensagem do bloco: o `inicio` da troca agrupada (PR 3) ou, pela chave, `avisos-<id>` e, desde
 * 2026-10-07 (#191), `linha:<id>`.
 */
function inicioDoBloco({ chave, inicio }: BlocoDaTimeline): string {
  if (inicio) return inicio;
  return chave.startsWith("avisos-") ? chave.slice("avisos-".length) : chave.startsWith("linha:") ? chave.slice("linha:".length) : chave;
}

/**
 * Põe cada pedido aberto logo depois do bloco que contém a sua âncora. Os blocos já vêm com fios e avisos
 * recolhidos: a chave de um bloco é o id da primeira mensagem dele (ou `avisos-<id>`), então a âncora que caiu dentro
 * de um grupo recolhido fica depois do grupo — nunca some.
 */
function comPedidosAncorados(blocos: BlocoDaTimeline[], c: ConversaEstado, estado: Estado, propostas: ReadonlySet<string>, turnosSegurados: ReadonlySet<string> = new Set(), vivos: TurnosDaPessoaVivos = NENHUM_TURNO_VIVO, doServidor: readonly Mensagem[] = c.mensagens): { blocos: BlocoDaTimeline[]; ancoradas: ReadonlySet<string> } {
  const todos = pedidosAncoraveis(estado, c.conversa.id, propostas);
  // NOD-402: o pedido de um turno dos bastidores sem fala à vista (a rotina que pediu aprovação, credencial ou acesso sem escrever nada)
  // segue a regra da mensagem dos bastidores pela hora dele: segurado com o turno da pessoa vivo, ou depois da última fala
  // do turno que rodava. O do próprio turno vivo da pessoa não entra (fica embaixo da mensagem que o disparou).
  const lugar = new Map<string, "fica" | "segura" | number>();
  for (const i of todos) {
    const t = i.decisao.turnoId;
    if (t === null || i.bastidores !== true || vivos.turnos.has(t) || doServidor.some((m) => m.turnoId === t)) continue;
    const em = Date.parse(i.decisao.criadoEm);
    const inicio = doServidor.findIndex((m) => m.criadoEm > em); // a ordem do servidor: `c` já vem reordenada, sem as seguradas
    lugar.set(i.decisao.id, inicio < 0 ? (vivos.desde !== null && em >= vivos.desde ? "segura" : "fica") : lugarDosBastidores(doServidor, inicio, em, vivos));
  }
  // O segurado conta como ancorado (sai da seção do fim) e não é desenhado agora.
  const segurados = todos.filter((i) => (i.decisao.turnoId !== null && turnosSegurados.has(i.decisao.turnoId)) || lugar.get(i.decisao.id) === "segura").map((i) => i.decisao.id);
  const pedidos = segurados.length === 0 ? todos : todos.filter((i) => !segurados.includes(i.decisao.id));
  if (pedidos.length === 0) return { blocos, ancoradas: new Set(segurados) };
  const posicao = new Map(c.mensagens.map((m, i) => [m.id, i]));
  const inicioDe = blocos.map((b) => posicao.get(inicioDoBloco(b)));
  const depoisDe = new Map<number, typeof pedidos>();
  for (const item of pedidos) {
    const l = lugar.get(item.decisao.id);
    const ancora = typeof l === "number" ? doServidor[l]?.id : ancoraDoPedido(item.decisao, c);
    const alvo = ancora === undefined ? undefined : posicao.get(ancora);
    if (alvo === undefined) continue;
    let bloco = -1;
    inicioDe.forEach((inicio, i) => { if (inicio !== undefined && inicio <= alvo) bloco = i; });
    if (bloco < 0) continue;
    // O cartão já encolhido na mesma âncora (chat limpo, PR 4) vem antes: foi pedido antes do que ainda está aberto.
    while (blocos[bloco + 1]?.chave.startsWith(ENCOLHIDO)) bloco++;
    depoisDe.set(bloco, [...(depoisDe.get(bloco) ?? []), item]);
  }
  const ancoradas = new Set([...segurados, ...[...depoisDe.values()].flat().map((i) => i.decisao.id)]);
  const saida = blocos.flatMap((b, i) => [b, ...(depoisDe.get(i) ?? []).map((item) => ({ chave: `decisao:${item.decisao.id}`, html: renderDecisaoAncorada(item, estado) }))]);
  return { blocos: saida, ancoradas };
}

/**
 * O cabeçalho da conversa própria é uma pílula flutuante (definido em 2026-10-16, plano "tela limpa", T1; protótipo A1/A2
 * do canvas "limite e troca"): mascote, nome e o ponto de presença, centrada sobre o chat. O clique alterna o painel do
 * bot (`alternar-detalhes`). A presença inteira ("Trabalhando · 2 esperam você", "sem novidade há N min") vai no
 * `title`/`aria-label` e num subtítulo curto embaixo da pílula, só quando não é "Disponível" — e o CSS só o mostra no
 * hover/foco da pílula (em repouso ele colidia com a pílula "Novas", revisão do PR 1).
 *
 * O HTML não depende do painel (revisão do PR 1, 2026-10-16): o rótulo é fixo ("Painel de <nome> · <presença>") e o
 * `aria-expanded` é posto pelo main depois de desenhar (`marcarPainelNaPilula`), que também o acompanha quando a
 * largura da janela troca o painel de lado ou de sobreposto.
 *
 * O que morava no topo saiu (definido em 2026-10-16, decisões E11 e T2 do plano): MODO DEV, "Hoje com" e "Linhas
 * abertas" e o Ligar foram para a gaveta (web/telas/detalhes.ts); o Parar foi para o campo, ao lado do Enviar
 * (`botoesDoCampo`).
 */
/**
 * NOD-429: com `comQuadro` (a flag do teste ligada e o bot é da pessoa), a pílula e o par Conversa | Quadro viram uma
 * cápsula só (`.qd-pil`); a presença (`.pilula-sub`) continua irmã, logo depois.
 */
export function renderCabecalhoConversa(estado: Estado, agenteId: string, o: { comQuadro?: boolean; paginas?: readonly Pagina[]; ordem?: readonly number[]; pedirApp?: PedirApp } = {}): string {
  const a = agenteDe(estado, agenteId);
  const nome = a?.nome ?? "agente";
  const { html, ativa } = presencaDoBot(estado, agenteId);
  const texto = html.replace(/<[^>]+>/g, "");
  const disponivel = texto === "Disponível";
  const rotulo = `${nome} · ${texto}`;
  const sub = disponivel ? "" : `<span class="pilula-sub" aria-hidden="true">${html}</span>`;
  // NOD-381 (definido em 2026-10-27): no celular a presença vai dentro da pílula, em 12px abaixo do nome; o computador
  // continua com o ponto e a linha de baixo (`.pilula-txt` é `display: contents` e `.pilula-presenca` fica escondida).
  const presencaNaPilula = disponivel ? "" : `<span class="pilula-presenca" aria-hidden="true">${html}</span>`;
  const pilula = `<button type="button" class="pilula-bot" data-act="alternar-detalhes" aria-controls="detalhes" aria-label="${esc(`Painel de ${rotulo}`)}" title="${esc(rotulo)}">${a ? iconeAgente(a, "sm", estadoMascoteNaConversa(estado, a.conversaId)) : ""}<span class="pilula-txt"><span class="pilula-nome">${esc(nome)}</span>${presencaNaPilula}</span><span class="presenca${ativa ? " ativa" : ""}" aria-hidden="true"></span><span class="pilula-seta" aria-hidden="true">›</span>${a?.ownerId === estado.sessao?.pessoaId ? htmlFio(estado.computadorPessoa) : ""}</button>`;
  // NOD-445: a cápsula leva a doca dos ícones (e o "+ pedir um app") e, com mais de uma página, os pontinhos (a página
  // atual é marcada depois). Sem as páginas do servidor ainda, a pílula de hoje.
  const paginas = o.paginas ?? [];
  return o.comQuadro && (paginas.length > 1 || o.pedirApp) ? `<div class="qd-pil pg-pil">${pilula}${docaDePaginas({ nome, paginas, ordem: o.ordem, pedirApp: o.pedirApp })}</div>${sub}` : `${pilula}${sub}`;
}

/**
 * A presença do bot na conversa, em HTML curto (os separadores e a contagem em negrito) e se o ponto fica verde.
 * NOD-216: lê a mesma fonte do mascote da barra (turnosVivosDaConversa + estadoMascoteNaConversa). Antes qualquer turno
 * vivo da conversa — na fila há horas, ou de uma task — dizia "Trabalhando".
 */
function presencaDoBot(estado: Estado, agenteId: string): { html: string; ativa: boolean } {
  const a = agenteDe(estado, agenteId);
  const vivos = a?.conversaId ? turnosVivosDaConversa(estado, a.conversaId) : [];
  // NOD-402: o "sem novidade há N min" é do turno da conversa; a rotina em paralelo não guarda atividade.
  const rodando = vivos.find((v) => v.estado === "rodando" && !v.bastidores) ?? vivos.find((v) => v.estado === "rodando");
  const mascote = a ? estadoMascoteNaConversa(estado, a.conversaId) : "disponivel";
  // NOD-73: "Trabalhando · sem novidade há N min" quando o vigia avisou silêncio.
  const mudo = rodando && a?.conversaId ? minutosSemNovidade(estado.atividades[a.conversaId]?.[rodando.turnoId], estado.agora) : null;
  const emLigacao = estado.ligacaoViva?.agenteId === agenteId;
  // definido em 2026-10-03 (canvas "Uma conversa de verdade · depois"): uma regra só para o mascote e o rótulo. O
  // mascote já dava prioridade a "trabalhando" e o rótulo a "Aguardando você", e o cabeçalho se contradizia; agora o
  // turno vivo vence nos dois e o que espera a pessoa entra junto, contado por fio ("Trabalhando · 2 esperam você").
  const esperam = new Set((estado.suaVez?.itens ?? []).filter((item) => item.decisao.conversaId === a?.conversaId && item.estadoColuna !== "vencido").map(chaveDoItem)).size;
  const sep = ` <span class="presenca-sep" aria-hidden="true">·</span> `;
  const comEsperam = esperam ? `${sep}<b>${esperam} ${esperam === 1 ? "espera" : "esperam"} você</b>` : "";
  const html = emLigacao
    ? "Em ligação"
    : mascote === "trabalhando"
    ? `Trabalhando${mudo !== null ? `${sep}sem novidade há ${mudo} min` : ""}${comEsperam}`
    : mascote === "pensando"
    ? `Pensando${comEsperam}`
    : esperam ? "Aguardando você" : mascote === "na_fila" ? "Na fila" : estado.executor?.atual === "catcher" ? "Simulação" : (a ? esc(presencaPorMaquina(iaDoBotAgora(estado, a)) ?? "") : "") || "Disponível";
  return { html, ativa: mascoteAnimado(mascote) || emLigacao };
}

/**
 * O Parar do campo vale para esta conversa (NOD-354, 2026-10-28)? A tela é ela e há turno vivo do chat nela (desde a
 * NOD-354 pela conversa da tela, não pela do bot na frota; o turno das frentes e o da ligação ficam fora de
 * `turnosVivosDaConversa`, NOD-311). Fonte única do `trabalhando` do
 * campo (main.ts, atualizarParar) e do aviso do vigia (`pararDoVigia`): os dois leem a conversa que o clique para
 * (`conversaAtual`).
 */
export function pararNoCampoDaConversa(estado: Estado, conversaId: string): boolean {
  const t = estado.tela;
  // NOD-402: a rotina e o colega rodando nos bastidores não acendem o Parar do campo (nada deles aparece no chat).
  return t.tipo === "conversa" && t.conversaId === conversaId && turnosVivosDoChat(estado, conversaId).length > 0;
}

/** O `trabalhando` do campo da tela atual (main.ts, atualizarParar): a mesma regra que tira o Parar do aviso do vigia. */
export function pararNoCampoDaTela(estado: Estado): boolean {
  const t = estado.tela;
  return t.tipo === "conversa" && pararNoCampoDaConversa(estado, t.conversaId);
}

/**
 * Quais botões o campo mostra (revisão do PR 1, 2026-10-16): o Parar fica SEMPRE alcançável enquanto o bot trabalha —
 * antes ele trocava de lugar com o Enviar e sumia assim que havia rascunho ou anexo. Agora é um botão secundário ao lado
 * do Enviar: com o bot trabalhando e o campo vazio, só o Parar; com texto, anexo ou o ditado gravando (o Enviar para e
 * manda), os dois. Sem trabalho, só o Enviar.
 */
export function botoesDoCampo(p: { trabalhando: boolean; temConteudo: boolean; ditando: boolean }): { enviar: boolean; parar: boolean } {
  return { enviar: !p.trabalhando || p.temConteudo || p.ditando, parar: p.trabalhando };
}

/** O título do Parar do campo (revisto em 2026-10-22, NOD-311): ele para só a conversa, nunca as tasks. */
export function tituloDoParar(_estado: Estado, _agenteId: string): string {
  return "Parar o que está rodando nesta conversa";
}

/** O nome que o leitor de tela ouve no Parar do campo (revisto em 2026-10-28, NOD-354: diz que para a resposta, não o bot). */
export const rotuloDoParar = (nome: string | undefined): string => (nome ? `Parar resposta do ${nome}` : "Parar resposta");

const QUADRADO = '<svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true"><rect x="1.5" y="1.5" width="11" height="11" rx="2.5" fill="currentColor"/></svg>';

const MAIS = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';

const CLIPE = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5 12.6 19.9a5.5 5.5 0 0 1-7.8-7.8l8.5-8.5a3.7 3.7 0 0 1 5.2 5.2l-8.5 8.5a1.8 1.8 0 0 1-2.6-2.6l7.8-7.8"/></svg>';

/** NOD-444: a frase da nova rotina como sugestão, quando a caixa já tem rascunho. Nasce escondida; o "+ Nova" mostra. */
export function htmlSugestaoRotina(): string {
  return `<div class="composer-sugestao" id="composer-sugestao" hidden><button type="button" class="composer-chip" data-act="usar-sugestao-rotina" aria-label="Usar a sugestão: ${ROTULO_SUGESTAO}">${ROTULO_SUGESTAO}</button></div>`;
}

/**
 * Composer criado UMA vez por conversa (main.ts não o regrava): textarea + enviar. Com `anexos`
 * (ADR-046, só conversa própria) ganha o clipe, a fila de arquivos e o input escondido; a fila é
 * preenchida por web/lib/anexos.ts direto no DOM, porque o composer não se regrava.
 *
 * definido em 2026-09-24 (emenda da ADR-045): `composer-pergunta` recebe o que fica acima do campo (web/telas/pergunta.ts:
 * desde 2026-10-18, a caixa "Respondendo" com duas ou mais perguntas abertas e os outros pedidos), e `data-padrao` /
 * `data-titulo` guardam a dica e a dica do clipe de sempre.
 *
 * definido em 2026-10-11 (ADR-095): o 🎤 do ditado e a pílula da gravação entram em todo composer, escondidos; quem os
 * mostra é web/telas/ditado.ts, quando o servidor diz que o ditado está disponível.
 *
 * definido em 2026-10-16 (plano "tela limpa", T5/T6/E11): sai a dica "Enter envia · Shift+Enter…" — a nota nasce vazia
 * e só mostra a do modo resposta; na conversa própria (`aprovacao`) entram o seletor de IA (web/telas/seletor-ia.ts),
 * entre o texto e o microfone, e o Parar (secundário, redondo, escondido) logo antes do Enviar — o Enviar continua na
 * ponta, onde a pessoa o procura; o main mostra cada um pelo `botoesDoCampo`. `bot` dá o nome do Parar ("Parar resposta do Eng 1").
 */
export function htmlComposer(placeholder: string, sugestoes: readonly string[] = [], opcoes: { anexos?: Aceita; comandos?: boolean; aprovacao?: boolean; bot?: string } = {}): string {
  const lista = sugestoes.length ? `<div class="autocomplete" id="autocomplete" hidden></div>` : "";
  const aceita = opcoes.anexos;
  const accept = aceita === "sem_pdf" ? "image/*,.txt,.md,.csv,.json" : "image/*,application/pdf,.pdf,.txt,.md,.csv,.json";
  const tituloClipe = aceita === "sem_pdf" ? "Este agente roda no Codex: lê imagens e texto, não PDF" : "";
  const anexar = aceita
    ? `<div class="anexos-fila" id="composer-anexos" hidden></div><button type="button" class="clipe" data-act="anexar" aria-label="Anexar arquivo"${tituloClipe ? ` title="${esc(tituloClipe)}" data-titulo="${esc(tituloClipe)}"` : ""}>${CLIPE}</button><input type="file" id="composer-arquivos" multiple accept="${accept}" hidden data-aceita="${aceita}" />`
    : "";
  const resumo = aceita ? `<span class="anexos-resumo" id="composer-resumo"></span>` : "";
  // O "/" (definido em 2026-09-28): a lista abre acima do campo; a dica diz o que o comando escrito faz.
  const barra = opcoes.comandos ? '<div class="barra-lista" id="barra-lista" role="listbox" aria-label="Comandos" hidden></div><div class="barra-dica" id="barra-dica" hidden></div>' : "";
  // ADR-059: o botão do modo de aprovação (só na conversa própria); main.ts troca o miolo. A faixa acima do campo saiu
  // em 2026-10-18 (Fase 4, PR 2).
  const chip = opcoes.aprovacao ? HTML_CHIP_MODO : "";
  const seletor = opcoes.aprovacao ? HTML_SELETOR_IA : "";
  const parar = opcoes.aprovacao ? `<button type="button" class="parar-envio" data-act="parar-conversa" aria-label="${esc(rotuloDoParar(opcoes.bot))}" title="Parar o que está rodando nesta conversa" hidden>${QUADRADO}</button>` : "";
  // NOD-381 (definido em 2026-10-27): no celular o clipe, o modo e a IA saem de dentro do campo e moram na folha do +
  // (web/telas/folha-mais.ts); o + só nasce quando há o que abrir e o computador nunca o vê (web/mobile.css).
  const mais = aceita || opcoes.aprovacao ? `<button type="button" class="mais-campo" data-act="abrir-mais" aria-label="Anexar, modo e IA" aria-haspopup="menu" aria-expanded="false">${MAIS}</button>` : "";
  return `<div class="composer"><div class="composer-pergunta" id="composer-pergunta"></div>${htmlSugestaoRotina()}${barra}<div class="box${aceita ? " com-anexos" : ""}${chip ? " com-modo" : ""}${mais ? " com-mais" : ""}">${lista}${mais}${anexar}${chip}<textarea id="composer-texto" rows="1" placeholder="${esc(placeholder)}" data-sugestoes="${esc(JSON.stringify(sugestoes))}"></textarea>${resumo}${seletor}${htmlPilulaDitado()}${htmlBotaoDitado()}${parar}<button class="send" data-act="enviar" aria-label="Enviar">➤</button></div>
  <p class="nota" id="composer-nota" data-padrao=""></p></div>`;
}
