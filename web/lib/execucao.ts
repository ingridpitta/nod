import type { EsperaDaCotaDaRotina } from "../../src/contracts/cota.ts";
import type { DesfechoRotina } from "../../src/contracts/motivos.ts";
import type { BloqueioRotina, EsperaRotinaDto, ExecucaoRotina, OndeRodaDto, ParadaDaRotina, PerguntaPendenteDaRotina } from "../../src/contracts/rotina.ts";
import { botao, esc } from "./render.ts";
import { desdeQuando, horaMinuto, listaDeJanelas, quandoCurto, quandoVoltaNoFuso } from "./relogio.ts";

/**
 * definido em 2026-09-24 (ADR-045): quem parou a execução interrompida, em palavras — o Mac da pessoa
 * ou o servidor. Motivo sem tradução sai como está (dado técnico visível, nunca um buraco).
 */
const MOTIVO_HUMANO: Readonly<Record<string, string>> = {
  maquina_sem_contato: "seu Mac parou de responder",
  reinicio_servidor: "o servidor reiniciou",
  // ADR-131: o motor da máquina parou no meio (a atualização sozinha da VM, o restart, o app fechado).
  reinicio_do_motor: "o nod foi reiniciado na máquina",
  // NOD-293 A7: a pessoa revogou a chave da máquina com a execução rodando nela.
  maquina_removida: "a máquina foi removida",
  // definido em 2026-09-24: o pedido da execução foi dispensado ainda aberto (dispensar-decisao.ts).
  pedido_dispensado: "o pedido foi dispensado sem resposta",
  // definido em 2026-09-24 (fio da pergunta): a pergunta da execução venceu sem resposta (varredor-expiracao.ts).
  pergunta_sem_resposta: "ninguém respondeu a pergunta",
  // definido em 2026-10-16 (NOD-243/NOD-272): a janela adiada e a execução que a seguinte (ou o Pausar) encerrou.
  execucao_anterior_aberta: "a execução anterior ainda não tinha terminado",
  frente_aberta: "uma frente desta rotina ainda estava aberta",
  vencida: "ficou na fila e a janela seguinte a encerrou",
  frente_parada: "a frente ficou parada por mais de 24 h",
  rotina_pausada: "a rotina foi pausada",
  // definido em 2026-10-15 (NOD-274): a janela que não rodou (desfecho 'nao_rodou', MOTIVOS_NAO_RODOU_ROTINA). A de
  // execucao_anterior_aberta (C9) virou 'adiada' na integração com o #335; a linha antiga usa o rótulo acima.
  cota_da_ia: "cota",
  // NOD-309 (definido em 2026-10-20): o erro transitório do provedor passou da próxima janela. A máquina sem contato e o
  // reinício usam os rótulos do topo ("não rodou · o servidor reiniciou, volta 14:00").
  erro_do_provedor: "o serviço da IA ficou instável",
  // NOD-386: a queda com a máquina em contato passou da próxima janela (quem falhou foi o servidor).
  servidor_nao_respondeu: "o servidor do nod não respondeu a tempo",
  // definido em 2026-10-15 (NOD-270): a pergunta das voltas sem novidade ficou sem resposta e a janela seguinte seguiu.
  voltas_sem_novidade: "pergunta sem resposta, fechada pela janela seguinte",
  // NOD-251/NOD-275 (definido em 2026-10-15): a máquina recusou o turno no despacho, ou a pessoa pediu Parar.
  motor_ausente: "a IA não estava pronta na máquina",
  nao_autenticado: "a IA da máquina estava sem login",
  limite_do_plano: "a conta da IA estava no limite",
  parado_pela_pessoa: "você parou",
  // NOD-256 (F2, decisão NOD-225): a parada aberta segurou a janela (desfechoDaParada) — a linha na conversa diz o resto.
  parada_aberta: "o bot estava parado por você",
};

/**
 * definido em 2026-10-16 (revisão do Gil no #335, A4): a rotina cuja última janela foi adiada leva tag âmbar no cabeçalho,
 * como a parada (`tagDaParada`); a linha de espera (`linhaDaEspera`) segue neutra e explica.
 */
export const TAG_ESPERANDO = '<span class="tag tag-ambar" title="enquanto a execução anterior não termina, as janelas são adiadas sem gastar crédito">esperando</span>';


/**
 * definido em 2026-09-24 (emenda da ADR-044): por que a janela ficou 'bloqueada' — o rótulo do histórico
 * é "parada (sem acesso)". Record sobre as chaves de MOTIVOS_BLOQUEIO_ROTINA (a web não importa valores de
 * src/): motivo novo sem rótulo não compila.
 */
const MOTIVO_DA_PARADA: Record<BloqueioRotina["motivo"] | "aguardando_resposta", string> = {
  sem_acesso: "sem acesso",
  sem_conexao: "sem conexão",
  aguardando_resposta: "aguardando resposta",
};

export function motivoDaExecucao(e: Pick<ExecucaoRotina, "motivo">): string | null {
  return e.motivo === null ? null : (MOTIVO_HUMANO[e.motivo] ?? e.motivo);
}

/**
 * NOD-89 (definido em 2026-10-22; bug visto no protótipo pelo Gil): o desfecho em palavras — o status cru ("executou",
 * "passou_em_branco") não aparece mais. Record sobre DesfechoRotina: desfecho novo sem rótulo não compila.
 */
const ROTULO_DO_DESFECHO: Record<DesfechoRotina, string> = {
  executou: "concluída",
  passou_em_branco: "passou em branco",
  sem_novidade: "sem novidade",
  falhou: "falhou",
  interrompida: "interrompida",
  bloqueada: "parada",
  nao_rodou: "não rodou",
  adiada: "adiada",
};

/** O rótulo do desfecho; um desfecho que a web ainda não conhece (servidor mais novo) sai sem o "_", nunca cru. */
export function rotuloDoDesfecho(d: string): string {
  return (ROTULO_DO_DESFECHO as Partial<Record<string, string>>)[d] ?? d.replaceAll("_", " ");
}

/**
 * "interrompida · seu Mac parou de responder", "parada (sem acesso)"; os outros desfechos seguem só com o nome. A janela
 * antiga com motivo 'sem_pendencia' (o "só com pendência", removido na NOD-317) sai como "sem novidade".
 */
export function rotuloExecucao(e: Pick<ExecucaoRotina, "desfecho" | "motivo"> & { voltaEm?: ExecucaoRotina["voltaEm"] }, fusoIana = "UTC"): string {
  // NOD-274: "não rodou · cota, volta 14:00" — a janela que a cota da IA pulou fica visível no histórico.
  if (e.desfecho === "nao_rodou") {
    // NOD-314: o rótulo antigo de maquina_sem_contato ("seu Mac parou de responder") é da queda no meio e não vale para a VM.
    // Com o NOD-309 a janela também fica 'nao_rodou' por máquina sem contato sem as 24 h (a janela seguinte a fecha): o
    // rótulo diz só o fato, válido nos dois caminhos.
    const motivo = e.motivo === "maquina_sem_contato" ? "a máquina ficou sem contato" : motivoDaExecucao(e);
    // NOD-309: toda queda com hora de volta diz a hora (a máquina sem contato não tem: volta quando o Mac voltar).
    const volta = e.voltaEm ? `, volta ${horaMinuto(e.voltaEm, fusoIana)}` : "";
    return motivo ? `não rodou · ${motivo}${volta}` : "não rodou";
  }
  if (e.desfecho === "bloqueada") {
    const motivo = e.motivo !== null && Object.hasOwn(MOTIVO_DA_PARADA, e.motivo) ? MOTIVO_DA_PARADA[e.motivo as keyof typeof MOTIVO_DA_PARADA] : e.motivo;
    return motivo ? `parada (${motivo})` : "parada";
  }
  const base = rotuloDoDesfecho(e.desfecho);
  const motivo = e.desfecho === "interrompida" || e.desfecho === "adiada" ? motivoDaExecucao(e) : null;
  return motivo ? `${base} · ${motivo}` : base;
}

/**
 * A rotina parada na lista e no painel (definido em 2026-09-24, emenda da ADR-044): a tag âmbar diz qual
 * app falta, e o MESMO botão de um clique do card ("Permitir e rodar agora") — ou "Conectar", quando o
 * card ainda é o de conexão e não há o que permitir. O card é um por agente e app: se ele é de OUTRA rotina
 * do agente, permitir não roda esta na hora, e o botão diz só "Permitir acesso".
 */
export function tagDaParada(b: BloqueioRotina): string {
  const falta = b.motivo === "sem_conexao" ? `falta conectar o ${b.app}` : `falta acesso ao ${b.app}`;
  return `<span class="tag tag-ambar" title="a rotina não roda até você liberar; nenhuma janela parada gastou crédito">parada · ${esc(falta)}</span>`;
}

export function botaoDaParada(b: BloqueioRotina, classe = "pri"): string {
  if (!b.decisaoId) return botao("abrir-conexao", "Conectar", { classe, id: b.slug });
  return b.rodaNaHora
    ? botao("decidir-proposta", "Permitir e rodar agora", { classe, id: b.decisaoId })
    : botao("decidir-proposta", "Permitir acesso", { classe, id: b.decisaoId, titulo: "o pedido é de outra rotina deste bot; esta roda na próxima janela" });
}

/** "desde ontem 13:00" ao lado da tag do card (a primeira janela que não rodou). */
export function desdeDaParada(p: ParadaDaRotina, agora: number): string {
  return desdeQuando(p.desde, agora, p.fusoIana);
}

/** "Não rodaram: ontem 13:00, ontem 18:00 e hoje 08:00. Nenhuma tentativa gastou crédito." — vazio sem janela parada. */
export function linhaNaoRodaram(p: ParadaDaRotina | null, agora: number): string {
  if (!p || p.naoRodaram.length === 0) return "";
  const verbo = p.naoRodaram.length === 1 ? "Não rodou" : "Não rodaram";
  return `<p class="dec-nao-rodaram">${esc(`${verbo}: ${listaDeJanelas(p.naoRodaram, agora, p.fusoIana)}. Nenhuma tentativa gastou crédito.`)}</p>`;
}

/**
 * definido em 2026-10-16 (NOD-243): a rotina cuja última janela foi adiada diz por quê, na lista — "Esperando a frente
 * “Revisar PRs” terminar · 3 janelas adiadas desde ontem 13:00." Com uma janela só: "… · a janela de hoje 10:00 foi
 * adiada." Revisto em 2026-10-16 (revisão do Gil no #335): "terminar" vale para a execução na fila e para a que roda.
 * Vazio quando a última janela rodou.
 */
export function linhaDaEspera(e: EsperaRotinaDto | null, agora: number, fusoIana: string): string {
  if (!e) return "";
  const quem = e.motivo === "frente_aberta" ? (e.frente ? `Esperando a frente “${e.frente}” terminar` : "Esperando uma frente desta rotina terminar") : "Esperando a execução anterior terminar";
  const quantas = e.seguidas === 1 ? `a janela de ${quandoCurto(e.desde, agora, fusoIana)} foi adiada` : `${e.seguidas} janelas adiadas ${desdeQuando(e.desde, agora, fusoIana)}`;
  return `<div class="rt-linha rt-espera">${esc(`${quem} · ${quantas}.`)}</div>`;
}

/**
 * definido em 2026-10-15 (NOD-270): a rotina parada por uma pergunta (ou aprovação) que espera a pessoa — a linha
 * "Parada: pergunta sem resposta desde ontem 13:00." e o atalho ao balão na conversa da rotina.
 */
export function linhaPerguntaPendente(p: PerguntaPendenteDaRotina, agora: number, fusoIana: string): string {
  return `<div class="rt-linha">${esc(`Parada: ${nomeDaEspera(p)} sem resposta ${desdeQuando(p.desde, agora, fusoIana)}.`)}</div>`;
}

/**
 * definido em 2026-10-16 (review de design do #342): a pendência que segura a rotina pelo nome do card que o atalho
 * abre — "pergunta" ou "aprovação". Record sobre o tipo: tipo novo sem nome não compila.
 */
const NOME_DA_PENDENCIA: Record<PerguntaPendenteDaRotina["tipo"], string> = { pergunta: "pergunta", aprovacao: "aprovação" };

/**
 * definido em 2026-10-16 (re-revisão de design do #342, ajuste A): o Record protege na compilação, não em execução — um
 * DTO sem `tipo` (servidor antigo, deploy fora de ordem) diria "undefined". Tipo ausente ou desconhecido vira "pergunta".
 */
function nomeDaEspera(p: PerguntaPendenteDaRotina): string {
  return (NOME_DA_PENDENCIA as Partial<Record<string, string>>)[p.tipo] ?? "pergunta";
}

/** A tag "parada · pergunta sem resposta" (ou "aprovação sem resposta") da rotina parada por uma pendência. */
export function tagParadaPergunta(p: PerguntaPendenteDaRotina): string {
  return `<span class="tag tag-ambar" title="as janelas seguintes esperam a sua resposta; nenhuma gastou crédito">${esc(`parada · ${nomeDaEspera(p)} sem resposta`)}</span>`;
}

/** O atalho ao balão: "Ver pergunta" ou "Ver aprovação" (o mesmo rótulo de web/telas/pergunta.ts). */
export function rotuloVerEspera(p: PerguntaPendenteDaRotina): string {
  return `Ver ${nomeDaEspera(p)}`;
}

/**
 * definido em 2026-10-16 (NOD-274, C7; revisão do Gil): a rotina cuja execução espera a cota da IA renovar — "esperando a
 * cota do Claude Code · volta às 14:00", no fuso da rotina. Não é parada: a volta acontece sozinha. Revisão do Gil no #340:
 * a volta diz o dia ("amanhã às 14:00", "em 18/10 às 14:00"), como `quandoVolta`.
 */
export function rotuloEsperaDaCota(e: EsperaDaCotaDaRotina, fusoIana: string, agora: number): string {
  return `esperando ${cotaDaIa(e.ia)} · volta ${quandoVoltaNoFuso(e.voltaEm, agora, fusoIana)}`;
}

/**
 * definido em 2026-10-16 (NOD-274 C7/C10, revisão de microcopy do Gil): "a cota do Claude Code", "a cota do Codex" — e,
 * sem o nome da IA, "a cota da IA" (o genérico é feminino; "a cota do IA" era erro de concordância).
 */
export function cotaDaIa(ia: string): string {
  return ia === "IA" ? "a cota da IA" : `a cota do ${ia}`;
}

/**
 * A tag da espera da cota no cabeçalho da rotina (cinza: nada a fazer, a volta é sozinha). Revisão do Gil no #340: passada
 * a hora da volta com a tela aberta, a tag some (vale o estado normal da rotina); o "nada a fazer" vai também em texto
 * para o leitor de tela (o `title` não aparece no toque nem é lido sempre).
 */
export function tagEsperaDaCota(e: EsperaDaCotaDaRotina, fusoIana: string, agora: number): string {
  if (e.voltaEm <= agora) return "";
  return `<span class="tag tag-cinza" title="a execução volta sozinha quando a cota renovar; nada a fazer">${esc(rotuloEsperaDaCota(e, fusoIana, agora))}<span class="sr-only"> (volta sozinha; nada a fazer)</span></span>`;
}

/** NOD-89: o atalho que leva a Máquinas › Conectar (main.ts, `conectar-sempre-ligada`). Aparece uma vez por tela. */
export const ATALHO_SEMPRE_LIGADA = '<button type="button" class="gv-link" data-act="conectar-sempre-ligada">Conectar uma máquina sempre ligada</button>';

const ICONE_MAC = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="5" width="16" height="10.5" rx="1.6"/><path d="M2.5 18.5h19"/></svg>';
const ICONE_SERVIDOR = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="4" width="17" height="6.5" rx="1.8"/><rect x="3.5" y="13.5" width="17" height="6.5" rx="1.8"/><path d="M7 7.25h.01M7 16.75h.01"/></svg>';
const SEP = '<span class="onde-roda-sep" aria-hidden="true">·</span>';

/**
 * NOD-89 (corte 1, definido em 2026-10-22; protótipo aprovado): onde a rotina roda, numa linha. "Roda em <b>vm-sp</b>";
 * no Mac (ou "qualquer" sem Linux), "Roda em <b>MacBook</b> · só com o Mac ligado e o nod aberto" e, com `comAtalho`, o
 * atalho; "qualquer" com Linux, "Roda na primeira máquina sua que estiver ligada". `plural` = a gaveta ("Rodam em").
 * Vazio sem `ondeRoda` (modo local, rotina de outra pessoa).
 */
export function linhaOndeRoda(o: OndeRodaDto | undefined, opcoes: { plural?: boolean; comAtalho?: boolean } = {}): string {
  if (!o) return "";
  const verbo = opcoes.plural ? "Rodam" : "Roda";
  const linha = (icone: string, texto: string) => `<p class="onde-roda" data-depende-do-mac="${o.dependeDoMac}"><span class="onde-roda-ic">${icone}</span><span class="onde-roda-txt">${texto}</span></p>`;
  if (o.modo === "qualquer" && !o.dependeDoMac) return linha(ICONE_SERVIDOR, `${verbo} na primeira máquina sua que estiver ligada`);
  const nome = o.maquina?.nome ?? "seu Mac";
  if (!o.dependeDoMac) return linha(ICONE_SERVIDOR, `${verbo} em <b>${esc(nome)}</b>`);
  return linha(ICONE_MAC, `${verbo} em <b>${esc(nome)}</b> ${SEP} só com o Mac ligado e o nod aberto${opcoes.comAtalho ? ` ${SEP} ${ATALHO_SEMPRE_LIGADA}` : ""}`);
}

/**
 * NOD-89 (critério 4): a execução que não rodou porque a máquina ficou sem contato, numa rotina que depende do Mac, leva o
 * atalho logo abaixo — é onde está o problema. Alvo Linux: não leva (a VM sem contato não se resolve com outra máquina).
 */
export function pedeAtalhoNaExecucao(e: Pick<ExecucaoRotina, "desfecho" | "motivo"> | undefined, o: OndeRodaDto | undefined): boolean {
  return !!e && !!o?.dependeDoMac && e.desfecho === "nao_rodou" && e.motivo === "maquina_sem_contato";
}
