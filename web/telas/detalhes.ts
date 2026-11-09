import { avisoErro } from "../lib/card-proposta.ts";
import { secaoOnboardingDetalhes } from "./onboarding.ts";
import type { RotinaDto } from "../../src/contracts/api.ts";
import type { AbaGaveta, Estado, EstadoComputadorBot, NivelGaveta } from "../estado/reducer.ts";
import { botao, dataHora, esc, iconeAgente } from "../lib/render.ts";
import { ICONE } from "../lib/icones.ts";
import { MOTIVO_FALHA_TEXTO } from "../lib/computador.ts";
import { htmlGavetaTela } from "../lib/computador-pessoa.ts";
import { ATALHO_SEMPRE_LIGADA, botaoDaParada, desdeDaParada, linhaOndeRoda, pedeAtalhoNaExecucao, rotuloExecucao } from "../lib/execucao.ts";
import { CORES_MASCOTE, FORMAS_MASCOTE, turnosVivosDaConversa, turnosVivosDoChat } from "../lib/mascote.ts";
import { botaoLigar, htmlLinhaLigar, VELOCIDADES, VOZES } from "./ligacao.ts";
import { renderSeloModoDev } from "./modo-dev.ts";
import { caminhoDaPastaDoBot } from "../lib/pasta-do-bot.ts";
import { mostraCaminhoDaPasta } from "../lib/capacidades.ts";
import { interpolar } from "../lib/relogio.ts";
import { iasDaTela, ordemDaPessoa, rascunhoDe, renderInteligencia, renderLinhaInteligencia, type ContextoInteligencia } from "./inteligencia.ts";
import { UI_IAS_INICIAL } from "./cartao-ia.ts";
import { descricao, MODOS } from "./aprovacoes.ts";
import { blocoEsperando, conectorDoApp, nivelDoBot, ROTULO_NIVEL, situacaoDoApp, type NivelAtual } from "./app-acesso.ts";
import { logoApp } from "./marketplace.ts";
import { renderMemoriaNaGaveta } from "./memoria.ts";
import { renderNovaRotinaNaGaveta } from "./nova-rotina.ts";
import { blocoDasChamadas, blocoDoEndereco, ehRotinaWebhook, ICONE_RAIO, origemDaTela, quandoNaLista } from "./webhook.ts";
import { textoMotivo } from "./negacao.ts";
import { falhaVisivel } from "../lib/fora-do-ar.ts";
import { renderGavetaTrabalhos } from "./trabalhos.ts";
import { abertosDoBot } from "../lib/trabalhos.ts";
import { renderAtividade } from "./atividade.ts";
import { renderListaBiblioteca } from "./biblioteca.ts";
import { lembrancaDaMidia } from "../lib/midia.ts";
import { seletorLinha } from "../lib/linha-config.ts";
import { maquinasDeTrabalho, opcoesDeMaquina } from "./maquinas.ts";
import { linhaHistorico, nivelHistorico, nivelVersao, statusDesfazer } from "./historico-perfil.ts";
import { VAZIO_ROTINAS } from "../lib/rotina-no-chat.ts";

/**
 * O "N hoje" da linha "Atividade" (ADR-114, chat limpo, PR 2; decisão tomada 1: o dia inteiro). Antes de a contagem chegar
 * (ou com a rota indisponível), a linha não mostra número.
 */
function linhaAtividadeHoje(estado: Estado, agenteId: string): string {
  const hoje = estado.atividadeHoje[agenteId];
  const total = hoje?.total;
  // NOD-70: "· N negadas" (as decisões negadas hoje) só quando há alguma; o número sozinho não vira alarme.
  const negadas = typeof hoje?.negadas === "number" && hoje.negadas > 0 ? ` · ${hoje.negadas} ${hoje.negadas === 1 ? "negada" : "negadas"}` : "";
  return typeof total === "number" ? `<span class="gv-meta">${total} hoje${negadas}</span>` : negadas ? `<span class="gv-meta">${negadas.slice(3)}</span>` : "";
}

type Bot = NonNullable<Estado["frota"]>["agentes"][number];
type Concessoes = Estado["concessoes"][string];

/**
 * O nível da gaveta que um `data-act="gaveta"` pede (`data-nivel`, `data-id`); null = nível desconhecido.
 * definido em 2026-10-08 (QA do épico #188): a lista morava no clique de main.ts e não tinha "trabalhos" — a linha
 * "Trabalhos" da gaveta não abria nada. Mora aqui, ao lado de quem desenha os `irPara`, e o teste confere os dois.
 */
export function nivelDaGaveta(tipo: string | undefined, id = ""): NivelGaveta | null {
  if (tipo === "rotina" || tipo === "acesso") return { tipo, id };
  if (tipo === "dar-acesso" || tipo === "perfil" || tipo === "memoria" || tipo === "inteligencia" || tipo === "nova-rotina" || tipo === "trabalhos" || tipo === "atividade" || tipo === "ajustes") return { tipo };
  // NOD-382: as telas das linhas do perfil do celular.
  if (tipo === "codigo" || tipo === "rotinas" || tipo === "biblioteca" || tipo === "computador") return { tipo };
  // NOD-20: o histórico de versões do perfil e uma versão dele (data-id = o número).
  if (tipo === "historico") return { tipo };
  if (tipo === "versao") return /^[1-9]\d*$/.test(id) ? { tipo, id } : null;
  return null;
}

/**
 * ADR-125 (NOD-349): para onde o ‹ de cada nível volta. O que abre do nível Ajustes volta para Ajustes; a rotina, a nova
 * rotina e o próprio Ajustes voltam à visão geral (null).
 */
export function paiDoNivel(nivel: NivelGaveta, celular = false): NivelGaveta | null {
  // NOD-382: no perfil do celular a rotina e a nova rotina abrem da tela Rotinas e voltam para ela; as telas das linhas
  // (Código, Rotinas, Biblioteca, Computador) voltam ao perfil.
  if (nivel.tipo === "codigo" || nivel.tipo === "rotinas" || nivel.tipo === "biblioteca" || nivel.tipo === "computador") return null;
  if (celular && (nivel.tipo === "rotina" || nivel.tipo === "nova-rotina")) return { tipo: "rotinas" };
  // NOD-20: a versão volta para o Histórico; o Histórico volta para Ajustes.
  if (nivel.tipo === "versao") return { tipo: "historico" };
  return nivel.tipo === "rotina" || nivel.tipo === "nova-rotina" || nivel.tipo === "ajustes" ? null : { tipo: "ajustes" };
}

/** ADR-125: as abas que o bot tem. O bot de outra pessoa não tem Computador; com uma aba só, a gaveta não mostra abas. */
export function abasDoBot(dona: boolean): AbaGaveta[] {
  return ["detalhes", "biblioteca", ...(dona ? (["computador"] as const) : [])];
}

/** A aba aberta: a lembrada, se ela ainda existe para este bot (o D15 tira o Computador); senão, Detalhes. */
export function abaAberta(estado: Pick<Estado, "abaGaveta">, agenteId: string, abas: readonly AbaGaveta[]): AbaGaveta {
  const lembrada = estado.abaGaveta[agenteId];
  return lembrada && abas.includes(lembrada) ? lembrada : "detalhes";
}

/** ADR-125: subtítulo e avatar só se editam no bot da pessoa (o Nod incluso: o servidor aceita título, forma e cor). */
export const identidadeEditavel = (dona: boolean): boolean => dona;
/** O nome do Nod não muda (o servidor recusa); o subtítulo, a forma e a cor dele sim (revisão da NOD-349: nada some). */
export const nomeEditavel = (a: Pick<Bot, "papel">, dona: boolean): boolean => dona && a.papel !== "nod";

/**
 * A gaveta do bot (ADR-032: "painel de detalhes com perfil, colegas e rotinas"). Desde 2026-09-18 ela é o lar do que É
 * DO BOT. definido em 2026-09-30 (canvas "Menu, sidebar e gaveta"): 380 px e por níveis, com ‹ para voltar. Revisto
 * em 2026-10-23 (ADR-125, NOD-349): no topo só Compartilhar e Fechar; a identidade se edita ali mesmo; o resto em abas
 * (Detalhes, Biblioteca, Computador) e no nível Ajustes.
 */
export function renderDetalhes(estado: Estado): string {
  const t = estado.tela;
  if (t.tipo !== "conversa") return "";
  const a = estado.frota?.agentes.find((b) => b.id === t.agenteId);
  if (!a) return "";
  const dona = a.ownerId === estado.sessao?.pessoaId;
  const fechar = `<button type="button" class="gv-icone gvn-redondo gv-painel" data-act="alternar-detalhes" aria-label="Fechar painel" title="Fechar painel">${ICONE.fechar}</button>`;
  const nivel = estado.gaveta?.agenteId === a.id ? estado.gaveta.nivel : null;
  if (!nivel) {
    const compartilhar = `<button type="button" class="gv-icone gvn-redondo" data-act="gaveta-compartilhar" data-id="${esc(a.id)}" aria-haspopup="menu" aria-label="Compartilhar ${esc(a.nome)}" aria-expanded="false" title="Compartilhar">${ICONE.compartilhar}</button>`;
    return `<div class="gv-topo gvn-topo">${compartilhar}${fechar}</div>
      <div class="gv-corpo">${visaoGeral(estado, a, dona)}</div>`;
  }
  const n = renderNivel(estado, a, dona, nivel);
  const pai = paiDoNivel(nivel);
  const destino = pai ? destinoDoVoltar(pai) : a.nome;
  const voltar = `<button type="button" class="gv-icone gv-voltar" data-act="gaveta-voltar" aria-label="Voltar para ${esc(destino)}" title="Voltar (Esc)">${ICONE.voltar}</button>`;
  const topo = `<div class="gv-topo"><span class="gv-lado">${voltar}</span><h2 class="gv-titulo" title="${esc(n.titulo)}">${esc(n.titulo)}</h2><span class="gv-lado gv-direita">${fechar}</span></div>`;
  const corpo = `<div class="gv-corpo">${n.corpo}</div>${n.rodape ? `<div class="${classeDoRodape(n)}">${n.rodape}</div>` : ""}`;
  return topo + (n.form ? `<form class="gv-form" ${n.form}>${corpo}</form>` : corpo);
}

/** O nome do nível para onde o ‹ volta (o aria-label "Voltar para …"). */
export function destinoDoVoltar(pai: NivelGaveta): string {
  return pai.tipo === "rotinas" ? "Rotinas" : pai.tipo === "historico" ? "Histórico" : "Ajustes";
}

/** NOD-20: o rodapé da versão leva a classe dele (a confirmação de restaurar). */
export const classeDoRodape = (n: Pick<Nivel, "rodapeClasse">): string => (n.rodapeClasse ? `gv-rodape ${n.rodapeClasse}` : "gv-rodape");

// ---- visão geral ----------------------------------------------------------------------------------------------------

const linha = (conteudo: string, dados: string, extra = "") => `<button type="button" class="gv-linha" ${dados}>${conteudo}${extra}</button>`;
const irPara = (a: Bot, nivel: NivelGaveta["tipo"], id = "") => `data-act="gaveta" data-nivel="${nivel}" data-agente="${esc(a.id)}"${id ? ` data-id="${esc(id)}"` : ""}`;

const ROTULO_ABA: Readonly<Record<AbaGaveta, string>> = { detalhes: "Detalhes", biblioteca: "Biblioteca", computador: "Computador" };

function visaoGeral(estado: Estado, a: Bot, dona: boolean): string {
  const abas = abasDoBot(dona);
  const aberta = abaAberta(estado, a.id, abas);
  // O ponto vem só da frota (revisão da NOD-349): o "fora" de um pulso antigo não fica preso depois que o computador volta.
  const fora = Boolean(a.computadorForaDoAr);
  const painel = (aba: AbaGaveta) => (aba === "detalhes" ? abaDetalhes(estado, a, dona) : aba === "computador" ? abaComputador(estado, a) : abaBiblioteca(estado, a, dona));
  if (abas.length === 1) return identidade(estado, a, dona) + `<div class="gv-aba-painel">${painel("detalhes")}</div>`;
  const tabs = abas
    .map((aba) => {
      const sel = aba === aberta;
      const ponto = aba === "computador" && fora ? '<span class="gvn-ponto" aria-hidden="true"></span><span class="sr-only"> (fora do ar)</span>' : "";
      return `<button type="button" role="tab" class="gv-aba" id="gv-aba-${aba}" aria-controls="gv-painel-${aba}" aria-selected="${sel}" tabindex="${sel ? 0 : -1}" data-act="gaveta-aba" data-aba="${aba}" data-id="${esc(a.id)}">${ROTULO_ABA[aba]}${ponto}</button>`;
    })
    .join("");
  return `${identidade(estado, a, dona)}<div class="gv-abas" role="tablist" aria-label="Seções do painel">${tabs}</div>
    <div class="gv-aba-painel" role="tabpanel" id="gv-painel-${aberta}" aria-labelledby="gv-aba-${aberta}" tabindex="0">${painel(aberta)}</div>`;
}

/**
 * ADR-125: o avatar xl, o nome e o subtítulo, editáveis ali mesmo (Enter ou blur salva, Esc desfaz; web/lib/
 * gaveta-identidade.ts). No Nod e no bot de outra pessoa, só leitura.
 */
function identidade(estado: Estado, a: Bot, dona: boolean): string {
  if (!identidadeEditavel(dona)) {
    return `<div class="gv-identidade gvn-id">${iconeAgente(a, "xl")}<h2 class="gvn-nome-fixo" title="${esc(a.nome)}">${esc(a.nome)}</h2><span class="gvn-sub-fixo">${esc(a.titulo || (dona ? "Seu bot" : "Bot da equipe"))}</span></div>`;
  }
  const aberto = estado.avatarAberto?.agenteId === a.id;
  const avatar = `<div class="gvn-avatar-wrap"><button type="button" class="gvn-avatar" data-act="gaveta-avatar" data-id="${esc(a.id)}" aria-haspopup="dialog"${aberto ? ' aria-controls="gvn-pop"' : ""} aria-expanded="${aberto}" aria-label="Editar avatar de ${esc(a.nome)}" aria-describedby="gvn-dica">${iconeAgente(a, "xl")}<span class="gvn-lapis" aria-hidden="true">${ICONE.lapis}</span></button><span class="gvn-dica" id="gvn-dica" role="tooltip">Editar avatar</span>${aberto ? popoverAvatar(a) : ""}</div>`;
  return `<div class="gv-identidade gvn-id">${avatar}
    ${nomeEditavel(a, dona) ? `<label class="sr-only" for="gvn-nome">Nome do bot</label>
    <input id="gvn-nome" class="gvn-nome" data-campo="nome" data-id="${esc(a.id)}" data-salvo="${esc(a.nome)}" value="${esc(a.nome)}" maxlength="60" autocomplete="off" spellcheck="false" title="Enter salva · Esc desfaz" aria-describedby="gvn-erro" />` : `<h2 class="gvn-nome-fixo" title="${esc(a.nome)}">${esc(a.nome)}</h2>`}
    <label class="sr-only" for="gvn-sub">Subtítulo do bot</label>
    <input id="gvn-sub" class="gvn-sub" data-campo="titulo" data-id="${esc(a.id)}" data-salvo="${esc(a.titulo)}" value="${esc(a.titulo)}" maxlength="80" autocomplete="off" placeholder="Adicionar um rótulo" title="Enter salva · Esc desfaz" aria-describedby="gvn-erro" />
    <span class="gvn-erro-linha"><span class="gvn-erro-icone" aria-hidden="true">${ICONE.alerta}</span><span class="gvn-erro" id="gvn-erro" role="status"></span></span>${nomeEditavel(a, dona) ? statusDesfazer(a, estado.historicoPerfil[a.id], "identidade") : ""}</div>`;
}

/** ADR-125: o popover do avatar, com as 8 formas e as 12 cores do mascote (rádios com setas) e Redefinir. */
export function popoverAvatar(a: Bot): string {
  const formas = FORMAS_MASCOTE.map((forma, i) => {
    const sel = a.forma === forma;
    return `<button type="button" class="gvn-forma" role="radio" aria-checked="${sel}" tabindex="${sel ? 0 : -1}" aria-label="${NOMES_FORMAS[i]}" title="${NOMES_FORMAS[i]}" data-act="gaveta-forma" data-id="${esc(a.id)}" data-valor="${forma}">${iconeAgente({ ...a, forma }, "sm")}</button>`;
  }).join("");
  const cores = CORES_MASCOTE.map((cor, i) => {
    const sel = a.cor === cor;
    return `<button type="button" class="gvn-cor" role="radio" aria-checked="${sel}" tabindex="${sel ? 0 : -1}" aria-label="${NOMES_CORES[i]}" title="${NOMES_CORES[i]}" data-act="gaveta-cor" data-id="${esc(a.id)}" data-valor="${cor}"><span class="cor-amostra ${cor}"></span></button>`;
  }).join("");
  return `<div class="gvn-pop" id="gvn-pop" role="dialog" aria-label="Editar avatar">
    <p class="gvn-pop-titulo" id="gvn-pop-formas">Forma</p><div class="gvn-formas" role="radiogroup" aria-labelledby="gvn-pop-formas">${formas}</div>
    <p class="gvn-pop-titulo" id="gvn-pop-cores">Cor</p><div class="gvn-cores" role="radiogroup" aria-labelledby="gvn-pop-cores">${cores}</div>
    <button type="button" class="gvn-acao-texto gvn-redefinir" data-act="gaveta-redefinir" data-id="${esc(a.id)}">Redefinir</button></div>`;
}

/** ADR-125: a aba Detalhes — o onboarding da guia, as Rotinas e a linha "Ajustes ›". */
function abaDetalhes(estado: Estado, a: Bot, dona: boolean): string {
  const rotinas = estado.rotinas.filter((r) => r.rotina.agenteId === a.id);
  // definido em 2026-09-24 (revisão da interface): a chave liga/desliga fica na linha; o resto da rotina abre no nível
  // dela. Revisto em 2026-10-23 (ADR-125): a parada por falta de acesso é uma linha neutra (só o ícone tem cor), com o
  // botão de texto de um clique (emenda da ADR-044).
  const linhaRotina = (dto: RotinaDto) => {
    const { rotina: r, proximaExecucao, bloqueio, resumo } = dto;
    const ativa = r.estado === "ativa";
    const rotulo = bloqueio ? "Parada" : ativa ? "Ativa" : "Pausada";
    // NOD-84: a rotina por webhook não tem "próxima"; o resumo é "Quando o Stripe avisa · última às 10:42", e a recusa
    // ainda sem chamada aceita depois dela acende o "!" (com texto ao leitor de tela).
    const wh = ehRotinaWebhook(dto) ? quandoNaLista(dto) : null;
    const quando = wh ? wh.quando : [resumo ? capitalizar(semFuso(resumo)) : "", ativa && !bloqueio ? `próxima ${interpolar(proximaExecucao, estado.agora)}` : ""].filter(Boolean).join(" · ");
    const chave = dona ? `<button type="button" class="chave" role="switch" aria-checked="${ativa}" data-act="${ativa ? "pausar-rotina" : "ativar-rotina"}" data-id="${esc(r.id)}" aria-label="${ativa ? "Pausar" : "Ativar"} a rotina ${esc(r.instrucao)}"><span></span></button>` : "";
    const parada = bloqueio ? `<div class="gvn-parada"><span class="gvn-parada-icone" aria-hidden="true">${ICONE.alerta}</span><span>${esc(`${fraseDaParada(bloqueio)} ${desdeDaParada(bloqueio, estado.agora)}.`)}</span>${dona ? botaoDaParada(bloqueio, "gvn-acao-texto") : ""}</div>` : "";
    return `<li class="detalhe-rotina rotina-${esc(r.estado)}${bloqueio ? " gvn-rotina-parada" : ""}">${linha(`<span class="gv-linha-txt"><b title="${esc(r.instrucao)}">${esc(r.instrucao)}</b><small>${wh?.marca ?? ""}<span class="gvn-estado">${rotulo}</span>${quando ? ` · ${esc(quando)}` : ""}</small></span>`, irPara(a, "rotina", r.id))}${chave}${parada}</li>`;
  };
  const rotinasHtml = `<section class="gv-secao"><div class="gv-secao-cab"><h3>Rotinas</h3>${dona ? `<button type="button" class="gv-link" data-act="rotina-no-chat" data-agente="${esc(a.id)}" aria-label="Nova rotina: pedir a ${esc(a.nome)} na conversa">+ Nova</button>` : ""}</div>
      ${rotinas.length ? `<ul class="gv-cartao">${rotinas.map(linhaRotina).join("")}</ul>` : `<p class="gvn-vazio">${VAZIO_ROTINAS}</p>`}
      ${rotinas.length ? linhaOndeRoda(rotinas.find((r) => r.ondeRoda)?.ondeRoda, { plural: true, comAtalho: true }) : ""}
    </section>`;
  const ajustes = `<section class="gv-secao"><div class="gv-cartao">${linha(`${ICONE.ajustes}<span class="gv-linha-txt">Ajustes<small>${dona ? "Ligar, trabalhos, memória, missão e acessos" : "Trabalhos, memória e acessos"}</small></span>`, `${irPara(a, "ajustes")} data-origem="ajustes"`, ICONE.seta)}</div></section>`;
  // ADR-077: durante a configuração guiada, o painel da guia mostra o que a pessoa contou e o que já foi montado.
  const o = estado.onboarding;
  const onboarding = estado.onboardingAberto && o && o.guia?.id === a.id && (o.etapa === "entrevista" || o.etapa === "configurando" || o.etapa === "concluido") ? secaoOnboardingDetalhes(o) : "";
  return onboarding + segundoPlano(estado, a, dona) + rotinasHtml + ajustes;
}

/**
 * NOD-402 (definido em 2026-10-28): a rotina ou o pedido de colega rodando sozinho nos bastidores não acende o Parar do campo
 * (nada dele aparece no chat). Para o que travou não ficar sem saída, o painel do bot mostra a linha "Rodando em segundo
 * plano" com o mesmo Parar da conversa (NOD-252: para o que roda nela), no desktop e no perfil do celular. Só na conversa à vista e com o turno da pessoa
 * parado — com ele vivo, o Parar do campo já está lá.
 */
export function segundoPlano(estado: Estado, a: Bot, dona: boolean): string {
  const t = estado.tela;
  if (!dona || !a.conversaId || t.tipo !== "conversa" || t.conversaId !== a.conversaId) return "";
  const fundo = turnosVivosDaConversa(estado, a.conversaId).some((v) => v.bastidores === true && !v.trabalhoId && v.estado === "rodando");
  if (!fundo || turnosVivosDoChat(estado, a.conversaId).length > 0) return "";
  return `<section class="gv-secao"><div class="gvn-parada gvn-segundo-plano" role="status"><span class="gvn-parada-icone" aria-hidden="true">${ICONE.relogioMini}</span><span>Rodando em segundo plano (rotina ou pedido de colega).</span>${botao("parar-conversa", "Parar", { classe: "gvn-acao-texto", titulo: "interrompe o que roda em segundo plano nesta conversa" })}</div></section>`;
}

/** "Falta acesso ao Meta Ads" / "Falta conectar o Meta Ads": a frase da linha neutra da rotina parada (ADR-125). */
export function fraseDaParada(b: NonNullable<RotinaDto["bloqueio"]>): string {
  return b.motivo === "sem_conexao" ? `Falta conectar o ${b.app}` : `Falta acesso ao ${b.app}`;
}

/** O estado do computador que a gaveta mostra: o fora do ar da frota manda; depois, o último pulso; nada = carregando. */
export function estadoDoComputadorNaGaveta(estado: Pick<Estado, "computadorVisto">, a: Pick<Bot, "id" | "computadorForaDoAr">): EstadoComputadorBot | null {
  if (a.computadorForaDoAr) return "fora";
  return estado.computadorVisto[a.id] ?? null;
}

/**
 * ADR-125: a aba Computador — a miniatura e os estados ligado, dormindo, sem computador e fora do ar. A imagem ao vivo
 * entra por web/telas/tela-do-bot.ts, que só observa com esta aba à vista (`data-comp-bot`), sem regravar a gaveta.
 */
export function abaComputador(estado: Estado, a: Bot): string {
  // NOD-96 (v2): com o computador da pessoa, a aba mostra a miniatura com Abrir, "não está usando o navegador",
  // dormindo/Acordar e o fora do ar com o caminho — o estado vem do computador da pessoa, não do pulso deste bot.
  const v2 = estado.computadorPessoa;
  if (v2) return htmlGavetaTela(v2, a, estado.computadorUi.recusa ?? null);
  const visto = estadoDoComputadorNaGaveta(estado, a);
  const acao = estado.computadorAcao?.agenteId === a.id ? estado.computadorAcao.tipo : null;
  const legenda = `<p class="tela-legenda">Tela de ${esc(a.nome)}</p>`;
  const miniatura = `<button type="button" class="tela-preview" data-act="abrir-computador" data-id="${esc(a.id)}" data-tela-bot="${esc(a.id)}" aria-label="Abrir a tela de ${esc(a.nome)}"><img alt="" hidden /><span class="tela-abrir"><span class="tela-pilula">${ICONE.monitor}<span>Abrir</span></span></span></button>`;
  let corpo: string;
  if (visto === null) {
    corpo = `<p class="gvn-comp-linha mudo">Vendo o computador…</p>`;
  } else if (visto === "fora") {
    const f = a.computadorForaDoAr;
    const motivo = f ? `Desde ${dataHora(f.desde)} · ${MOTIVO_FALHA_TEXTO[f.motivo]}.` : "O computador parou de responder.";
    corpo = `<div class="tela-preview gvn-tela-fora" role="img" aria-label="Tela de ${esc(a.nome)} fora do ar"><span>Fora do ar</span></div>${legenda}
      <div class="cp-fora">${avisoErro({ frase: "Fora do ar", mais: motivo, solto: true, acoes: `${botao("religar-computador", acao === "religar" ? "Tentando de novo…" : "Tentar de novo", { classe: "cp-acao sm", id: a.id, desabilitado: acao === "religar" })}${botao("abrir-computador", "Abrir computador", { classe: "cp-acao sm", id: a.id })}` })}</div>`;
  } else if (visto === "dormindo") {
    corpo = `<div class="gvn-sono"><b>O computador está dormindo</b><small>Acorda sozinho quando ${esc(a.nome)} precisar.</small>${botao("computador-acordar", acao === "acordar" ? "Acordando…" : "Acordar", { classe: "gvn-acao-texto", id: a.id, desabilitado: acao === "acordar" })}${botao("abrir-computador", "Abrir computador", { classe: "gvn-acao-texto", id: a.id })}</div>`;
  } else if (visto === "sem") {
    corpo = `<p class="gvn-comp-sem">${esc(a.nome)} ainda não tem um computador próprio. Ele ganha um na primeira vez que precisar usar a tela.</p><div class="gvn-acoes-texto">${botao("abrir-computador", "Abrir computador", { classe: "gvn-acao-texto", id: a.id })}</div>`;
  } else if (visto === "indisponivel" || visto === "erro") {
    corpo = `<p class="gvn-comp-linha mudo" role="status">${visto === "indisponivel" ? "Ambiente indisponível agora. O computador volta quando o ambiente voltar." : "Não deu para ver o computador agora. Tentando de novo…"}</p><div class="gvn-acoes-texto">${botao("abrir-computador", "Abrir computador", { classe: "gvn-acao-texto", id: a.id })}</div>`;
  } else {
    corpo = `${miniatura}${legenda}<p class="gvn-comp-linha">${visto === "ocupado" ? "Ligado · usando a tela agora" : "Ligado · pronto para usar"}</p>`;
  }
  return `<section class="gv-secao gv-tela" data-comp-bot="${esc(a.id)}"${visto === null ? ' aria-busy="true"' : ""}>${corpo}</section>`;
}

/**
 * NOD-326 (ADR-125): a aba Biblioteca — no bot da pessoa, a Pasta de trabalho no topo (saiu de Ajustes › Ambiente); embaixo,
 * os arquivos e mídias que o bot criou nesta conversa (web/telas/biblioteca.ts).
 */
export function abaBiblioteca(estado: Estado, a: Bot, dona: boolean, celular = false): string {
  const pasta = dona ? `<div class="gv-cartao gvb-pasta">${linhaDaPasta(estado, a)}</div>` : "";
  const tenant = estado.sessao?.tenantId;
  if (!tenant) return pasta;
  // Revisão 2: a mesma conversa que a busca e a releitura usam (a da tela).
  const conversaId = estado.tela.tipo === "conversa" ? estado.tela.conversaId : a.conversaId;
  const url = (id: string) => `/api/t/${encodeURIComponent(tenant)}/conversas/${encodeURIComponent(conversaId)}/anexos/${encodeURIComponent(id)}`;
  const lista = renderListaBiblioteca(estado.bibliotecaDoBot[conversaId], { conversaId, url, bot: a.nome, sumiram: lembrancaDaMidia.sumiram, esteMac: lembrancaDaMidia.esteMac, agora: estado.agora > 0 ? estado.agora : Date.now(), ...(celular ? { celular } : {}) });
  return `${pasta}<section class="gv-secao gvb">${lista}</section>`;
}

/**
 * ADR-125 (emenda ADR-060 item 5): o nível Ajustes — Atalhos (Ligar, Memória, Trabalhos, Atividade), Perfil (Missão e
 * voz), Acessos, Ambiente e, no fim, o que é do Modo dev. Colabora saiu; a Pasta foi para a aba Biblioteca (NOD-326).
 */
export function nivelAjustes(estado: Estado, a: Bot, dona: boolean, celular = false): Nivel {
  const grupos = gruposDeAcesso(estado, a.id);
  const trabalhosAbertos = abertosDoBot(estado, a.id, a.conversaId).length;
  const ligar = dona ? htmlLinhaLigar(botaoLigar({ agente: a, pessoaId: estado.sessao?.pessoaId, disponibilidade: estado.disponibilidadeLigacao[a.id], ligacao: estado.ligacaoViva }), a.nome) : "";
  const origem = (n: string) => `${irPara(a, n as NivelGaveta["tipo"])} data-origem="${n}"`;
  const atalhos = `<section class="gv-secao gvn-atalhos"><h3>Atalhos</h3><div class="gv-cartao">
      ${ligar}
      ${linha(`${ICONE.livro}<span class="gv-linha-txt">Memória</span>${dona && (estado.memoriasARevisar[a.id] ?? 0) > 0 ? `<span class="gv-meta mem-conta-meta">${estado.memoriasARevisar[a.id]} para revisar</span>` : ""}`, origem("memoria"), ICONE.seta)}
      ${linha(`${ICONE.relogio}<span class="gv-linha-txt">Trabalhos</span>${trabalhosAbertos ? `<span class="gv-meta">${trabalhosAbertos} ${trabalhosAbertos === 1 ? "aberto" : "abertos"}</span>` : ""}`, origem("trabalhos"), ICONE.seta)}
      ${dona ? linha(`${ICONE.pulso}<span class="gv-linha-txt">Atividade</span>${linhaAtividadeHoje(estado, a.id)}`, origem("atividade"), ICONE.seta) : ""}
    </div></section>`;
  const perfil = dona
    ? `<section class="gv-secao"><h3>Perfil</h3><div class="gv-cartao">${linha(`${ICONE.pessoa}<span class="gv-linha-txt">Missão e voz${celular ? "" : `<small>O que ${esc(a.nome)} faz e como fala nas ligações</small>`}</span>`, origem("perfil"), ICONE.seta)}${linhaHistorico(a, estado.historicoPerfil[a.id], celular)}</div>${statusDesfazer(a, estado.historicoPerfil[a.id], "ajustes")}</section>`
    : `<section class="gv-secao"><h3>Perfil</h3><p class="gv-descricao">${esc(a.descricao || "Sem missão escrita.")}</p></section>`;
  const acessos = grupos
    .map((g) => `<li class="acesso">${linha(`${logoApp(estado, g.slug, g.nome)}<span class="gv-linha-txt"><b>${esc(g.nome)}</b><small>${esc(nivelDoGrupo(g).rotulo)}${g.indisponivel ? " · indisponível" : ""}</small></span>${g.indisponivel ? `<span class="gvn-alerta-icone" aria-hidden="true" title="o conector está fora do ar">${ICONE.alerta}</span>` : ""}`, `${irPara(a, "acesso", g.chave)} data-origem="acesso:${esc(g.chave)}"`, ICONE.seta)}</li>`)
    .join("");
  const acessosHtml = `<section class="gv-secao secao-acessos"><div class="gv-secao-cab"><h3>Acessos</h3>${dona ? `<button type="button" class="gv-link" ${origem("dar-acesso")} aria-label="Dar a ${esc(a.nome)} acesso a um app">+ Dar acesso</button>` : ""}</div>
      ${acessos ? `<ul class="gv-cartao">${acessos}</ul>` : celular ? '<p class="mudo">Nenhum acesso</p>' : '<p class="mudo">Este bot ainda não usa nenhuma ferramenta externa. Ele pede o acesso quando precisar — ou dê você mesmo.</p>'}
    </section>`;
  const modo = MODOS[a.modoAprovacao ?? "manual"];
  const ambiente = dona
    ? `<div class="gv-cartao">
        ${estado.modoDev.ligado ? linha(`${ICONE.monitor}<span class="gv-linha-txt">Computador do bot</span>`, `data-act="abrir-computador" data-id="${esc(a.id)}" title="O computador próprio do bot (ADR-037), não o seu Mac"`) : ""}
        ${renderLinhaInteligencia(a, contextoInteligencia(estado), estado.menuIa === a.id)}
        ${linhaMaquinaDoBot(estado, a, celular)}
        ${linha(`${ICONE.escudo}<span class="gv-linha-txt">Aprovações</span><span class="gv-meta">${esc(modo.curto)}</span>`, `data-act="modo-aprovacao" data-id="${esc(a.id)}" title="${esc(`${modo.titulo}: ${descricao(a.modoAprovacao ?? "manual", estado.frota?.revisor === true)}`)}"`)}
      </div>`
    : `<p class="mudo">Aprovações: ${esc(modo.titulo)}</p>`;
  const ambienteHtml = `<section class="gv-secao"><h3>Ambiente</h3>${ambiente}${celular ? "" : `<p class="mudo gv-nota">${estado.executor?.atual === "catcher" ? "Simulação · respostas de teste" : "Sua conta de IA · computador conectado"}</p>`}</section>`;
  // NOD-382: no celular, Ocultar saiu do menu e virou o interruptor "Ocultar da lista" (o Nod não se oculta, ADR-081).
  const naLista = celular && dona && a.papel !== "nod"
    ? `<section class="gv-secao pfc-na-lista"><h3>Na lista</h3><div class="gv-cartao"><div class="gv-linha">${ICONE.olho}<span class="gv-linha-txt">Ocultar da lista</span>${chaveCelular(a.oculto === true, "perfil-ocultar", a.id, "Ocultar da lista")}</div></div></section>`
    : "";
  const dev = estado.modoDev.ligado ? `<section class="gv-secao gv-dev"><h3>Modo dev</h3><div class="gv-dev-corpo">${renderSeloModoDev(estado, a.conversaId, a.nome)}</div></section>` : "";
  return { titulo: "Ajustes", corpo: atalhos + perfil + naLista + acessosHtml + ambienteHtml + dev };
}

/**
 * NOD-367: onde o bot trabalha, na ficha dele (saiu de Máquinas): "Qualquer uma" (no servidor no Mac, "Este Mac") e as
 * máquinas conectadas; a escolhida que ficou sem contato continua na lista, marcada. `PUT /agentes/:id/maquina`.
 */
export function linhaMaquinaDoBot(estado: Pick<Estado, "maquinas">, a: Pick<Bot, "id" | "nome" | "maquinaId">, celular = false): string {
  const todas = maquinasDeTrabalho(estado.maquinas?.maquinas ?? []);
  const vivas = todas.filter((m) => m.conectada || m.id === a.maquinaId);
  if (vivas.length === 0) return "";
  const opcoes = opcoesDeMaquina(vivas, a.maquinaId ?? null, !!estado.maquinas?.servidorNoMac);
  return `<div class="gv-linha gv-maquina cfg-maq-bot">${ICONE.servidor}<span class="gv-linha-txt">Máquina${celular ? "" : `<small>Onde ${esc(a.nome)} roda o Claude Code ou o Codex</small>`}</span>${seletorLinha({ tipo: "seletor", acao: "maquina-do-bot", rotulo: `Máquina de ${a.nome}`, opcoes, dados: { id: a.id } })}</div>`;
}

/**
 * NOD-382: o interruptor do celular (51 × 31 numa área de 52 × 44, ligado em --ink). `role="switch"` com o estado em
 * aria-checked; o rótulo diz o que ele liga.
 */
export function chaveCelular(ligada: boolean, acao: string, id: string, rotulo: string): string {
  return `<button type="button" class="pfc-chave" role="switch" aria-checked="${ligada}" data-act="${esc(acao)}" data-id="${esc(id)}" aria-label="${esc(rotulo)}"><span class="pfc-trilho" aria-hidden="true"></span></button>`;
}

function linhaDaPasta(estado: Estado, a: Bot): string {
  return linha(`${ICONE.pasta}<span class="gv-linha-txt">Pasta de trabalho${mostraCaminhoDaPasta(estado.executor?.harnesses, a.harness) ? `<small><code>${esc(caminhoDaPastaDoBot(a.nome))}</code></small>` : ""}</span>`, `data-act="abrir-workspace" data-id="${esc(a.id)}"`);
}

const agoraDe = (estado: Pick<Estado, "agora">): number => (estado.agora > 0 ? estado.agora : Date.now());

// ---- níveis ---------------------------------------------------------------------------------------------------------

export type Nivel = { titulo: string; corpo: string; rodape?: string; form?: string; rodapeClasse?: string };

export function renderNivel(estado: Estado, a: Bot, dona: boolean, nivel: NivelGaveta): Nivel {
  switch (nivel.tipo) {
    case "rotina":
      return nivelRotina(estado, a, nivel.id);
    case "acesso":
      return nivelAcesso(estado, a, dona, nivel.id);
    case "dar-acesso":
      return { titulo: `Dar acesso a ${a.nome}`, corpo: darAcesso(estado, a.id, a.nome) };
    case "perfil":
      return nivelPerfil(a);
    // NOD-20: o histórico é só da dona (o servidor também recusa o de outra pessoa).
    case "historico":
      return dona ? nivelHistorico(a, estado.historicoPerfil[a.id], agoraDe(estado)) : { titulo: "Histórico", corpo: "" };
    case "versao": {
      if (!dona) return { titulo: "Versão", corpo: "" };
      const v = nivelVersao(a, estado.historicoPerfil[a.id], Number(nivel.id), agoraDe(estado));
      return v.rodape ? { ...v, rodapeClasse: "p20-rodape" } : v;
    }
    case "memoria":
      return { titulo: "Memória", corpo: renderMemoriaNaGaveta(estado, a.id, { nome: a.nome, dona, nivel }) };
    case "inteligencia": {
      // 2B (protótipo Inteligencia2): o rascunho vive no reducer até Salvar; sem rascunho deste bot, o gravado.
      const r = estado.rascunhoIa?.agenteId === a.id ? estado.rascunhoIa : rascunhoDe(a);
      return {
        titulo: "Inteligência",
        corpo: renderInteligencia(r, a.nome, contextoInteligencia(estado), ordemDaPessoa(estado.ias?.ias, estado.ias?.ordem), rascunhoDe(a)),
        rodape: rodapeDeFormulario("Salvar"),
        form: `data-form="inteligencia" data-id="${esc(a.id)}"`,
      };
    }
    case "nova-rotina":
      return { titulo: "Nova rotina", corpo: renderNovaRotinaNaGaveta(a), rodape: rodapeDeFormulario("Criar rotina"), form: 'data-form="criar-rotina"' };
    case "trabalhos":
      return { titulo: `Trabalhos de ${a.nome}`, corpo: renderGavetaTrabalhos(estado, a.id) };
    case "atividade":
      return { titulo: "Atividade", corpo: renderAtividade(estado, a) };
    case "ajustes":
      return nivelAjustes(estado, a, dona);
    // NOD-382: as telas do perfil do celular (web/telas/perfil-celular.ts). Se a janela deixa de ser celular com uma delas
    // aberta, o desktop mostra o equivalente que já tinha.
    case "rotinas":
      return { titulo: "Rotinas", corpo: abaDetalhes(estado, a, dona) };
    case "biblioteca":
      return { titulo: "Biblioteca", corpo: abaBiblioteca(estado, a, dona) };
    case "computador":
      return { titulo: "Computador", corpo: abaComputador(estado, a) };
    case "codigo":
      return { titulo: "Código", corpo: dona ? `<div class="gv-cartao">${linhaDaPasta(estado, a)}</div>` : "" };
  }
}

/** O que a 2A e a 2B leem das IAs: as do servidor (ou o catálogo), o estado do Mac e o relógio. */
export function contextoInteligencia(estado: Estado): ContextoInteligencia {
  return { ias: iasDaTela(estado), ui: estado.iasMac ?? UI_IAS_INICIAL, agora: estado.agora };
}

const rodapeDeFormulario = (salvar: string) => `<button type="button" class="gv-bt" data-act="gaveta-voltar">Cancelar</button><button type="submit" class="gv-bt pri">${esc(salvar)}</button>`;

/** Rotina: instrução inteira, quando roda, as últimas execuções (a silenciosa também, ADR de 2026-09-21) e as ações. */
function nivelRotina(estado: Estado, a: Bot, id: string): Nivel {
  const dto = estado.rotinas.find((r) => r.rotina.id === id && r.rotina.agenteId === a.id);
  if (!dto) return { titulo: "Rotina", corpo: '<p class="mudo">Esta rotina não existe mais.</p>' };
  const { rotina: r, proximaExecucao, bloqueio, resumo, ondeRoda } = dto;
  const ativa = r.estado === "ativa";
  const exec = estado.execucoes[r.id];
  // NOD-89 (critério 4): a mais recente não rodou por máquina sem contato numa rotina que depende do Mac — o atalho vai
  // embaixo dela e a linha "Roda em" fica só com o texto (o atalho aparece uma vez por tela).
  const atalhoNaExecucao = pedeAtalhoNaExecucao(exec?.[0], ondeRoda);
  const execucoes = !exec
    ? '<p class="mudo">carregando…</p>'
    : !exec.length
      ? '<p class="mudo">nunca executou</p>'
      : `<ul class="gv-execucoes">${exec.slice(0, 5).map((e, i) => `<li class="exec exec-${esc(e.desfecho)}"><span class="gv-exec-ponto" aria-hidden="true"></span><span class="gv-exec-quando">${esc(dataHora(e.em, r.fusoIana))}</span><span>${esc(rotuloExecucao(e, r.fusoIana))}</span>${i === 0 && atalhoNaExecucao ? `<span class="exec-acao">${ATALHO_SEMPRE_LIGADA}</span>` : ""}</li>`).join("")}</ul>`;
  const parada = bloqueio ? `<div class="gvn-parada" role="status"><span class="gvn-parada-icone" aria-hidden="true">${ICONE.alerta}</span><span>${esc(`${fraseDaParada(bloqueio)} ${desdeDaParada(bloqueio, estado.agora)}.`)}</span>${botaoDaParada(bloqueio, "gvn-acao-texto")}</div>` : "";
  const detalhe = (rotulo: string, valor: string) => (valor ? `<dt>${esc(rotulo)}</dt><dd>${esc(valor)}</dd>` : "");
  if (ehRotinaWebhook(dto)) return nivelRotinaWebhook(estado, dto, parada);
  const corpo = `${parada}
    <section class="gv-bloco"><h3>Instrução</h3><p class="gv-texto">${esc(r.instrucao)}</p></section>
    <section class="gv-bloco"><h3>Quando executar</h3><p class="gv-quando">${ICONE.relogio}<span>${esc(resumo ? capitalizar(resumo) : `${r.cron} (${r.fusoIana})`)}</span></p>
      <small class="gv-proxima">${ativa ? `Próxima: ${esc(dataHora(proximaExecucao, r.fusoIana))} · ${esc(interpolar(proximaExecucao, estado.agora))}` : "Pausada"}</small>${linhaOndeRoda(ondeRoda, { comAtalho: !atalhoNaExecucao })}</section>
    <section class="gv-bloco"><h3>Últimas execuções</h3>${execucoes}</section>
    <section class="gv-bloco"><h3>Combinado</h3><dl class="gv-dl">${detalhe("Fonte", r.fonte)}${detalhe("Resultado", r.entregavel)}${detalhe("Antes de agir fora do nod", r.limitesAprovacao)}${detalhe("Se faltar informação", r.politicaSemDado)}</dl></section>`;
  // definido em 2026-09-30: quem muda a instrução ou o horário é o bot (ADR-043); "Ajustar" só escreve o pedido no campo.
  const ajustar = `Ajuste a rotina “${resumirInstrucao(r.instrucao)}”: `;
  const rodape = `<button type="button" class="gv-bt" data-act="${ativa ? "pausar-rotina" : "ativar-rotina"}" data-id="${esc(r.id)}">${ativa ? "Pausar" : "Ativar"}</button>
       <button type="button" class="gv-bt" data-act="executar-rotina" data-id="${esc(r.id)}" data-agente="${esc(r.agenteId)}"${estado.ocupado ? " disabled" : ""}>Testar agora</button>
       <button type="button" class="gv-bt" data-act="preencher-prompt" data-texto="${esc(ajustar)}" title="Escreve o pedido de ajuste no campo da conversa">Ajustar</button>`;
  return { titulo: r.instrucao, corpo, rodape };
}

/**
 * NOD-84 (protótipo v3, "O detalhe do webhook"): os mesmos blocos da rotina, com três trocas — "Quando disparar" (o raio),
 * o Endereço (mascarado, copiar, gerar novo) e as Últimas chamadas. "Testar agora" vira "Enviar teste" (avisa que roda
 * um turno de verdade). Excluir continua pela conversa (não há rota de excluir; suposição registrada no PR).
 */
function nivelRotinaWebhook(estado: Estado, dto: RotinaDto, parada: string): Nivel {
  const r = dto.rotina;
  const ativa = r.estado === "ativa";
  const dona = r.ownerId === estado.sessao?.pessoaId;
  const eventos = dto.webhook?.eventos.length ? `<small class="gv-proxima">Só ${esc(dto.webhook.eventos.join(", "))}</small>` : "";
  const detalhe = (rotulo: string, valor: string) => (valor ? `<dt>${esc(rotulo)}</dt><dd>${esc(valor)}</dd>` : "");
  const corpo = `${parada}
    <section class="gv-bloco"><h3>Instrução</h3><p class="gv-texto">${esc(r.instrucao)}</p></section>
    <section class="gv-bloco"><h3>Quando disparar</h3><p class="gv-quando">${ICONE_RAIO}<span>${esc(dto.resumo ? capitalizar(dto.resumo) : "Quando o provedor avisa")}</span></p>${ativa ? eventos : '<small class="gv-proxima">Pausada: as chamadas ficam no registro e não rodam.</small>'}</section>
    ${blocoDoEndereco(dto, origemDaTela(), dona)}
    ${blocoDasChamadas(dto)}
    <section class="gv-bloco"><h3>Combinado</h3><dl class="gv-dl">${detalhe("Resultado", r.entregavel)}${detalhe("Antes de agir fora do nod", r.limitesAprovacao)}${detalhe("Se faltar informação", r.politicaSemDado)}</dl></section>`;
  const ajustar = `Ajuste a rotina “${resumirInstrucao(r.instrucao)}”: `;
  const rodape = `<button type="button" class="gv-bt" data-act="${ativa ? "pausar-rotina" : "ativar-rotina"}" data-id="${esc(r.id)}">${ativa ? "Pausar" : "Ativar"}</button>
       ${dona ? `<button type="button" class="gv-bt" data-act="webhook-testar" data-id="${esc(r.id)}" data-agente="${esc(r.agenteId)}" title="${ativa ? "Roda um turno de verdade com um payload de exemplo; o bot não lança nada" : "Ative a rotina para testar"}"${estado.ocupado || !ativa ? " disabled" : ""}>Enviar teste</button>` : ""}
       <button type="button" class="gv-bt" data-act="preencher-prompt" data-texto="${esc(ajustar)}" title="Escreve o pedido de ajuste no campo da conversa">Ajustar</button>`;
  return { titulo: r.instrucao, corpo, rodape };
}

/**
 * Acesso a um app: o nível (Nenhum / Ler / Ler e alterar), o que ele deixa em palavras e cada ação numa linha legível
 * (ADR-044: a descrição do catálogo fica no title). Revogar tira tudo; "Deixar só leitura" tira só o que altera.
 */
function nivelAcesso(estado: Estado, a: Bot, dona: boolean, chave: string): Nivel {
  const g = gruposDeAcesso(estado, a.id).find((x) => x.chave === chave);
  if (!g) return { titulo: "Acesso", corpo: '<p class="mudo">Este bot não tem mais acesso a este app.</p>' };
  const todos = [...g.leitura, ...g.escrita];
  const nivel = nivelDoGrupo(g);
  const conector = conectorDoApp(estado, g.slug);
  const falha = g.falha ? textoMotivo(g.falha.motivo) : "";
  const fora = g.indisponivel
    ? `<div class="cp-fora">${avisoErro({ frase: `Fora do ar${g.falha ? ` desde ${dataHora(g.falha.em)}` : ""}.`, mais: `${falha ? `${capitalizar(falha)}. ` : ""}Enquanto isso, ${a.nome} não consegue usar o ${g.nome}.`, solto: true, ...(conector ? { acoes: botao("sondar-conector", "Tentar de novo", { classe: "cp-acao sm", id: conector.id }) } : {}) })}</div>`
    : "";
  const seg = dona && conector?.habilitado ? segmentado(a.id, a.nome, conector.id, nivelDoBot(estado, a.id, conector)) : "";
  const linhas = (itens: Concessoes) => itens.map((i) => `<li title="${esc(g.descricaoDe.get(i.id) ?? i.capacidade)}">${esc(nomeLegivel(i.capacidade, g.slug || g.nome))}</li>`).join("");
  const ids = (itens: Concessoes) => itens.map((i) => i.id).join(",");
  const soLeitura = g.leitura.length && g.escrita.length
    ? botao("revogar-acessos", "Deixar só leitura", { classe: "link sm perigo", dados: { agente: a.id, ids: ids(g.escrita) }, titulo: `${g.escrita.length === 1 ? "revoga a ação que altera" : `revoga as ${g.escrita.length} ações que alteram`}; as de leitura continuam` })
    : "";
  const lista = g.leitura.length && g.escrita.length
    ? `<div class="acesso-grupo"><small>Consulta · ${g.leitura.length}</small></div><ul class="acesso-acoes">${linhas(g.leitura)}</ul><div class="acesso-grupo"><small>Altera · ${g.escrita.length}</small>${soLeitura}</div><ul class="acesso-acoes">${linhas(g.escrita)}</ul>`
    : `<ul class="acesso-acoes">${linhas(todos)}</ul>`;
  const corpo = `<div class="gv-app">${logoApp(estado, g.slug, g.nome)}<div><b>${esc(g.nome)}</b><small>${esc(nivel.rotulo)}</small></div>${g.indisponivel ? '<span class="tag tag-ambar">indisponível</span>' : ""}</div>
    ${fora}
    <section class="gv-bloco"><h3>O que ${esc(a.nome)} pode fazer</h3>${seg}<p class="acesso-frase">${nivel.frase}</p></section>
    <section class="gv-bloco"><h3>${todos.length} ${todos.length === 1 ? "ação permitida" : "ações permitidas"}</h3><div class="gv-acoes">${lista}</div></section>`;
  const rodape = botao("revogar-acessos", `Revogar acesso ao ${esc(g.nome)}`, { classe: "gv-bt perigo", dados: { agente: a.id, ids: ids(todos) }, titulo: todos.length === 1 ? `revoga a ação do ${g.nome}` : `revoga as ${todos.length} ações do ${g.nome}` });
  return { titulo: g.nome, corpo, rodape };
}

/** ADR-125: Missão e voz — o antigo Editar perfil sem forma, cor, nome e título (esses se editam no topo da gaveta). */
function nivelPerfil(a: Bot): Nivel {
  const corpo = `<label class="gv-campo">Missão e orientações<textarea name="descricao" rows="10">${esc(a.descricao)}</textarea></label>
    ${campoVoz(a)}`;
  return { titulo: "Missão e voz", corpo, rodape: rodapeDeFormulario("Salvar"), form: `data-form="editar-perfil" data-id="${esc(a.id)}"` };
}

/**
 * A voz do bot nas ligações (definido em 2026-10-04, ADR-071): escolhida como o mascote, com prévia (▶ toca a amostra do
 * provedor das ligações) e velocidade. Bot sem voz salva mostra a que o servidor deu a ele na criação.
 */
function campoVoz(a: Bot): string {
  const atual = a.voz ?? VOZES[0].id;
  const vozes = VOZES.map((v) => `<div class="gv-voz"><label><input type="radio" name="voz" value="${v.id}"${v.id === atual ? " checked" : ""} /><span><b>${esc(v.nome)}</b><small>${esc(v.descricao)}</small></span></label><button type="button" class="gv-icone" data-act="ouvir-voz" data-voz="${v.id}" aria-label="Ouvir a voz ${esc(v.nome)}" title="Ouvir">▶</button></div>`).join("");
  const vel = a.vozVelocidade ?? 1;
  const velocidades = VELOCIDADES.map((x) => `<label class="seg"><input type="radio" name="vozVelocidade" value="${x}"${x === vel ? " checked" : ""} /><span>${String(x).replace(".", ",")}x</span></label>`).join("");
  return `<fieldset class="gv-campo gv-vozes"><legend>Voz nas ligações</legend><div class="gv-lista-vozes" role="radiogroup" aria-label="Voz do bot">${vozes}</div>
    <div class="segmentado sm" role="radiogroup" aria-label="Velocidade da fala">${velocidades}</div></fieldset>`;
}

const NOMES_FORMAS = ["Quadrado", "Hexágono", "Círculo", "Galet", "Cápsula", "Triângulo", "Nuvem", "Gota"];
const NOMES_CORES = ["Vermelho", "Rosa", "Roxo", "Azul", "Turquesa", "Verde", "Laranja", "Preto", "Marrom", "Âmbar", "Cinza", "Creme"];

function segmentado(agenteId: string, nomeBot: string, conectorId: string, atual: NivelAtual): string {
  return `<div class="segmentado sm" role="group" aria-label="${esc(`Acesso de ${nomeBot}`)}">${(["nenhum", "leitura", "escrita"] as const).map((n) => `<button type="button" class="seg${n === atual ? " ativo" : ""}" data-act="nivel-bot" data-id="${esc(agenteId)}" data-conector="${esc(conectorId)}" data-nivel="${n}" aria-pressed="${n === atual}">${esc(ROTULO_NIVEL[n])}</button>`).join("")}</div>`;
}

/**
 * "+ Dar acesso" (definido em 2026-09-25, jornadas de conexão): em cima, os apps que a pessoa já conectou, com o nível
 * deste bot; embaixo, os que faltam conectar, com "Conectar" ali mesmo. Desde 2026-09-30 é um nível da gaveta.
 */
function darAcesso(estado: Estado, agenteId: string, nomeBot: string): string {
  const conectados = estado.marketplace.flatMap((app) => {
    const c = conectorDoApp(estado, app.slug);
    return c?.habilitado ? [`<div class="da-linha">${logoApp(estado, app.slug, app.nome)}<div class="da-nome"><b>${esc(app.nome)}</b>${segmentado(agenteId, nomeBot, c.id, nivelDoBot(estado, agenteId, c))}</div></div>`] : [];
  });
  const faltam = estado.marketplace.filter((app) => situacaoDoApp(estado, app.slug) !== "conectado").slice(0, 6).map((app) => {
    const login = estado.conectando[app.slug];
    const acao = login && !login.falhou ? blocoEsperando(app.nome, login.url, true, login.semJanela === true) : botao("conectar-app", login?.falhou ? "Tentar de novo" : "Conectar", { classe: "sm", id: app.slug });
    return `<div class="da-linha">${logoApp(estado, app.slug, app.nome)}<div class="da-nome"><b>${esc(app.nome)}</b></div>${acao}</div>`;
  });
  return `<div class="dar-acesso gv-dar-acesso" aria-label="${esc(`Dar a ${nomeBot} acesso a um app`)}">
    ${conectados.length ? `<div class="da-grupo"><small>Já conectados por você</small>${conectados.join("")}</div>` : ""}
    ${faltam.length ? `<div class="da-grupo"><small>Conectar e dar acesso</small>${faltam.join("")}</div>` : ""}
    ${!conectados.length && !faltam.length ? '<p class="mudo">Nenhum app no Marketplace ainda.</p>' : ""}
    ${botao("navegar", "Ver todos no Marketplace", { classe: "link sm", dados: { tela: "conectores" } })}
  </div>`;
}

// ---- apoio ------------------------------------------------------------------------------------------------------------

/**
 * definido em 2026-09-24 (ADR-044): um clique concede as ferramentas de leitura de um app inteiro. definido em 2026-09-29
 * (emenda): UM grupo por app — pelo slug, dois registros do mesmo app (o antigo e o habilitado) são UMA ferramenta. O
 * nível é o readOnlyHint da sonda; o que o catálogo não descreve conta como escrita.
 */
type GrupoAcesso = { chave: string; slug: string; nome: string; indisponivel: boolean; falha: { motivo: Parameters<typeof textoMotivo>[0]; em: number } | null; leitura: Concessoes; escrita: Concessoes; descricaoDe: Map<string, string> };

function gruposDeAcesso(estado: Estado, agenteId: string): GrupoAcesso[] {
  const grupos = new Map<string, GrupoAcesso>();
  for (const g of estado.concessoes[agenteId] ?? []) {
    const c = estado.conectores.find((x) => x.id === g.conectorId);
    const cap = c?.catalogo.find((x) => x.nome === g.capacidade);
    const chave = c?.slug ?? g.conectorId;
    const grupo = grupos.get(chave) ?? { chave, slug: c?.slug ?? "", nome: c?.nome ?? "conector", indisponivel: false, falha: null, leitura: [], escrita: [], descricaoDe: new Map<string, string>() };
    if (c?.ultimaFalha && falhaVisivel(c)) { grupo.indisponivel = true; grupo.falha ??= c.ultimaFalha; }
    if (cap?.descricao) grupo.descricaoDe.set(g.id, cap.descricao);
    (cap?.readOnlyHint === true ? grupo.leitura : grupo.escrita).push(g);
    grupos.set(chave, grupo);
  }
  return [...grupos.values()];
}

function nivelDoGrupo(g: GrupoAcesso): { rotulo: string; frase: string } {
  if (!g.escrita.length) return { rotulo: "só leitura", frase: "Pode consultar. Não envia nem altera nada." };
  if (g.leitura.length) return { rotulo: "pode ler e alterar", frase: "Pode consultar e fazer alterações em seu nome." };
  return { rotulo: "pode alterar", frase: "Pode fazer alterações em seu nome." };
}

/** "SLACK_FETCH_MESSAGE_THREAD" do conector Slack → "Fetch message thread": sem o prefixo do app, sem caixa alta. */
export function nomeLegivel(capacidade: string, conector: string): string {
  const prefixo = conector.toLowerCase().replace(/[^a-z0-9]+/g, "_") + "_";
  let nome = capacidade.toLowerCase();
  if (nome.startsWith(prefixo)) nome = nome.slice(prefixo.length);
  nome = nome.replace(/[_.-]+/g, " ").trim();
  return nome ? nome[0]!.toUpperCase() + nome.slice(1) : capacidade;
}

/** "dias úteis às 08:00 (America/Sao_Paulo)" → "dias úteis às 08:00": na linha da gaveta o fuso é ruído; no nível ele fica. */
export function semFuso(resumo: string): string {
  return resumo.replace(/\s*\([^)]*\)\s*$/, "");
}

export function capitalizar(texto: string): string {
  return texto ? texto[0]!.toUpperCase() + texto.slice(1) : texto;
}

/** A primeira frase da instrução, curta, para o pedido de ajuste citar a rotina sem colar o texto inteiro. */
function resumirInstrucao(instrucao: string): string {
  const frase = instrucao.split(/(?<=[.!?])\s/)[0] ?? instrucao;
  return frase.length > 80 ? `${frase.slice(0, 79).trimEnd()}…` : frase.replace(/[.!?]$/, "");
}
