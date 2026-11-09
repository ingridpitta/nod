import type { Estado, SecaoEspaco } from "../estado/reducer.ts";
import type { EstadoAvisos } from "../lib/avisos.ts";
import { ehCelular } from "../lib/celular.ts";
import { ICONE } from "../lib/icones.ts";
import { comSaibaMais } from "../lib/linha-config.ts";
import { esc } from "../lib/render.ts";
import type { Volta } from "../lib/volta.ts";
import { pilhaDeAvatares } from "./cartao-ia.ts";
import { renderProvedores } from "./provedores.ts";
import { botsDaPessoa, renderMaquinas } from "./maquinas.ts";
import { renderRelatos } from "./relatos.ts";
import { htmlPainelComputadorDoBot } from "../lib/computador-pessoa.ts";
import type { EscolhaTema } from "../lib/tema.ts";
import type { Densidade } from "../lib/densidade.ts";
import { renderConta, renderContaPagina, type DadosConta } from "./config-conta.ts";
import { iniciaisDeQuem } from "./menu-conta.ts";
import { renderAgentes } from "./config-agentes.ts";
import { renderGeral } from "./config-geral.ts";
import { renderAgendaRotinas, tituloDaAgendaCelular, valorDaAgenda } from "./agenda-rotinas.ts";

/**
 * "Seu espaço" (definido em 2026-09-18): o que é da CONTA, não de um bot. definido em 2026-09-30 (canvas "Menu, sidebar e
 * gaveta"): abre pelo menu do avatar, em tela cheia por cima da tela atual, já na seção escolhida. As seções ficam na
 * coluna da esquerda, no lugar da barra lateral, e trocar de seção não empilha: o único botão de saída é "‹ <de onde
 * veio>" (mais o Esc), que diz para onde a pessoa volta. Sem ×: os dois fariam a mesma coisa.
 * NOD-367 (protótipo v2 do Gil, aprovado em 2026-10-26): passa a se chamar Configurações, com 6 seções fixas, nesta ordem.
 * Avisos e Preferências viram Geral; Este Mac, Computadores (as chaves) e o computador do bot (v2) viram Máquinas;
 * Relatos vira Feedback. A v2 não acrescenta seção. NOD-85: Rotinas entra entre Agentes e Feedback.
 */
export const SECOES_ESPACO: readonly { id: SecaoEspaco; nome: string; icone: string }[] = [
  { id: "conta", nome: "Conta", icone: ICONE.pessoa },
  { id: "geral", nome: "Geral", icone: ICONE.ajustes },
  // definido em 2026-10-10 (plano das IAs, protótipo Main): "Conexão" vira "Provedores de IA", com os logos das IAs.
  { id: "conexao", nome: "Provedores de IA", icone: pilhaDeAvatares(true) },
  { id: "maquinas", nome: "Máquinas", icone: ICONE.servidor },
  { id: "agentes", nome: "Agentes", icone: ICONE.agentes },
  // NOD-85: a agenda das rotinas, depois de Agentes (rotina é o que os agentes fazem sozinhos).
  { id: "rotinas", nome: "Rotinas", icone: ICONE.relogio },
  { id: "feedback", nome: "Feedback", icone: ICONE.bandeira },
];

/** ADA-245 (jornada D): com o texto do onboarding, "Máquinas" se chama "Computadores". */
export function nomeDaSecao(s: { id: SecaoEspaco; nome: string }, estado: Pick<Estado, "onboardingTexto">): string {
  return s.id === "maquinas" && estado.onboardingTexto ? "Computadores" : s.nome;
}

/** O Entendi da faixa "entre nos sites de novo uma vez" fica neste navegador. */
export const CHAVE_AVISO_RECRIADO = "nod.computador.aviso-recriado";

function avisoRecriadoDispensado(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(CHAVE_AVISO_RECRIADO) === "1";
  } catch {
    return false;
  }
}

export type ExtrasEspaco = {
  conta: DadosConta;
  /** A página de Minha conta aberta dentro de Conta (NOD-346); null = a lista. */
  contaPagina: string | null;
  tema: EscolhaTema;
  /** NOD-119: a densidade da barra neste computador. */
  densidade?: Densidade;
  /** O valor curto de Provedores de IA na lista do celular ("Conectada", "Simulação"…), o mesmo do menu da conta. */
  conexao?: string;
};

export function renderEspaco(estado: Estado, avisos: EstadoAvisos, volta: Volta, extras: ExtrasEspaco, celular = ehCelular()): string {
  if (celular) return renderEspacoCelular(estado, avisos, volta, extras);
  const secao = estado.espaco?.secao ?? "conexao";
  const nav = SECOES_ESPACO.map((s) => `<button type="button" class="espaco-item" data-act="secao-espaco" data-secao="${s.id}"${s.id === secao ? ' aria-current="page"' : ""}>${s.icone}<span>${esc(nomeDaSecao(s, estado))}</span></button>`).join("");
  return `<div class="espaco cfg-espaco" role="dialog" aria-modal="true" aria-labelledby="espaco-titulo">
    <nav class="espaco-nav" aria-label="Seções das Configurações">
      <div class="espaco-volta"><button type="button" class="espaco-voltar" data-act="fechar-espaco" aria-keyshortcuts="Escape" title="Voltar para ${esc(volta.rotulo)} (Esc)">${ICONE.voltar}${volta.icone}<span>${esc(volta.rotulo)}</span></button><kbd>esc</kbd></div>
      <h1 id="espaco-titulo">Configurações</h1>
      <div class="espaco-itens">${nav}</div>
    </nav>
    <main class="espaco-conteudo">${conteudo(estado, secao, avisos, extras)}</main>
  </div>`;
}

/**
 * NOD-383 (critério 3, Gil itens 1-3): no celular as Configurações são uma lista agrupada, estilo Ajustes — a Conta (avatar,
 * nome e e-mail), as quatro do meio e Feedback por último —, e cada seção abre em tela cheia com o ‹ que volta para a lista.
 * A lista volta para onde a pessoa estava. Sem abas, sem atalho de teclado.
 */
function renderEspacoCelular(estado: Estado, avisos: EstadoAvisos, volta: Volta, extras: ExtrasEspaco): string {
  const esp = estado.espaco;
  const secao = esp?.secao ?? "geral";
  if (esp?.lista) {
    return `<div class="espaco cfg-espaco cfg-celular cfg-lista-tela" role="dialog" aria-modal="true" aria-labelledby="espaco-titulo">
      <div class="cfg-topo"><button type="button" class="espaco-voltar cfg-redondo" data-act="fechar-espaco" aria-label="Voltar para ${esc(volta.rotulo)}">${ICONE.voltar}</button></div>
      <main class="espaco-conteudo cfg-lista-secoes">
        <h1 id="espaco-titulo" class="cfg-titulo-grande">Configurações</h1>
        ${listaDeSecoes(estado, extras)}
      </main>
    </div>`;
  }
  const achada = SECOES_ESPACO.find((s) => s.id === secao);
  const nome = achada ? nomeDaSecao(achada, estado) : "Configurações";
  const corpo = comSaibaMais({ celular: true, abertos: estado.configUi.abertos }, () => conteudo(estado, secao, avisos, extras, true));
  return `<div class="espaco cfg-espaco cfg-celular cfg-secao-tela" role="dialog" aria-modal="true" aria-labelledby="espaco-titulo">
    <div class="cfg-topo"><button type="button" class="espaco-voltar cfg-redondo" data-act="cfg-lista" aria-label="Voltar para Configurações">${ICONE.voltar}</button><h1 id="espaco-titulo" class="cfg-topo-tit">${secao === "rotinas" ? tituloDaAgendaCelular(estado) : esc(nome)}</h1></div>
    <main class="espaco-conteudo" data-secao-aberta="${secao}">${corpo}</main>
  </div>`;
}

/** A lista do celular: cada linha é ícone de traço, título, no máximo um valor curto e ›; nada embaixo do título. */
function listaDeSecoes(estado: Estado, extras: ExtrasEspaco): string {
  const linha = (s: (typeof SECOES_ESPACO)[number], valor = "") => `<button type="button" class="cfg-item" data-act="secao-espaco" data-secao="${s.id}"><span class="cfg-item-ic" aria-hidden="true">${s.icone}</span><span class="cfg-item-nome">${esc(nomeDaSecao(s, estado))}</span>${valor ? `<span class="cfg-item-valor">${esc(valor)}</span>` : ""}<span class="cfg-item-seta" aria-hidden="true">${ICONE.seta}</span></button>`;
  const secao = (id: SecaoEspaco) => SECOES_ESPACO.find((s) => s.id === id)!;
  const c = extras.conta;
  const quem = c.nome ?? c.email ?? "Você";
  const conta = `<button type="button" class="cfg-item cfg-item-conta" data-act="secao-espaco" data-secao="conta"><span class="mc-av mc-av-g" aria-hidden="true">${esc(iniciaisDeQuem(c.nome, c.email))}</span><span class="cfg-item-nome"><b>${esc(quem)}</b>${c.nome && c.email ? `<small>${esc(c.email)}</small>` : ""}</span><span class="cfg-item-seta" aria-hidden="true">${ICONE.seta}</span></button>`;
  const maquinas = estado.maquinas ? String(estado.maquinas.maquinas.length) : "";
  const agentes = estado.frota ? String(botsDaPessoa(estado).length) : "";
  const grupo = (html: string) => `<div class="cfg-grupo">${html}</div>`;
  // Toda seção de SECOES_ESPACO entra aqui (a emenda da ADR-094 manda reverter se uma ficar de fora): a Conta no topo, o
  // Feedback sozinho embaixo, as outras no meio, na ordem do desktop.
  const valores: Partial<Record<SecaoEspaco, string>> = { conexao: extras.conexao ?? "", maquinas, agentes, rotinas: valorDaAgenda(estado) };
  const meio = SECOES_ESPACO.filter((s) => s.id !== "conta" && s.id !== "feedback").map((s) => linha(s, valores[s.id])).join("");
  return `<nav aria-label="Seções das Configurações">${grupo(conta)}${grupo(meio)}${grupo(linha(secao("feedback")))}</nav>`;
}

function conteudo(estado: Estado, secao: SecaoEspaco, avisos: EstadoAvisos, extras: ExtrasEspaco, celular = false): string {
  switch (secao) {
    case "conta":
      return extras.contaPagina !== null ? renderContaPagina(extras.contaPagina) : renderConta(extras.conta, celular);
    case "geral":
      return renderGeral({
        tema: extras.tema,
        avisos,
        modoDev: estado.modoDev.ligado,
        experimentos: estado.experimentos,
        quadroLiberado: estado.quadroLiberado ?? false,
        densidade: extras.densidade,
      }, estado.configUi, celular);
    case "conexao":
      return renderProvedores(estado);
    case "maquinas":
      return renderSecaoMaquinas(estado);
    case "agentes":
      return renderAgentes(estado);
    case "rotinas":
      return renderAgendaRotinas(estado, celular);
    case "feedback":
      return renderRelatos(estado);
  }
}

/** Máquinas: a lista única (com Este Mac e as chaves dentro) e, na v2, o computador do bot. */
function renderSecaoMaquinas(estado: Estado): string {
  const cb = estado.computadorPessoa ? htmlPainelComputadorDoBot(estado.computadorPessoa, estado.frota?.agentes ?? [], estado.computadorUi, estado.agora, avisoRecriadoDispensado()) : "";
  return `${renderMaquinas(estado)}${cb}`;
}
