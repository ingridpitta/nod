import type { RotinaDto } from "../../src/contracts/api.ts";
import type { Estado, NivelGaveta, PerfilCelular, SecaoEspaco, Tela } from "../estado/reducer.ts";
import { esc, iconeAgente } from "../lib/render.ts";
import { ICONE } from "../lib/icones.ts";
import { estadoDaGaveta } from "../lib/computador-pessoa.ts";
import { caminhoDaPastaDoBot } from "../lib/pasta-do-bot.ts";
import { mostraCaminhoDaPasta } from "../lib/capacidades.ts";
import { interpolar } from "../lib/relogio.ts";
import { botaoLigar, ICONE_LIGACAO } from "./ligacao.ts";
import { abaBiblioteca, capitalizar, chaveCelular, classeDoRodape, destinoDoVoltar, estadoDoComputadorNaGaveta, fraseDaParada, identidadeEditavel, nivelAjustes, nomeEditavel, paiDoNivel, popoverAvatar, renderNivel, segundoPlano, semFuso, type Nivel } from "./detalhes.ts";
import { secaoOnboardingDetalhes } from "./onboarding.ts";
import { botaoDaParada } from "../lib/execucao.ts";
import { ehRotinaWebhook, quandoNaLista } from "./webhook.ts";
import { DICA_ROTINAS } from "../lib/rotina-no-chat.ts";

type Bot = NonNullable<Estado["frota"]>["agentes"][number];

/**
 * NOD-382: o perfil do bot no celular, no estilo do iOS (protótipo nod-382). Substitui a gaveta só no celular
 * (web/lib/gaveta-render.ts escolhe por `ehCelular()`); o desktop segue com renderDetalhes, sem mudança.
 * Visão geral: ‹ redondo, avatar 96, nome e título editáveis ali mesmo, as ações rápidas (Mensagem, Ligar, Compartilhar) e a
 * lista agrupada (Código, Rotinas, Biblioteca, Computador, Ajustes, Excluir). Cada linha abre a tela dela, com ‹ de volta.
 */
export function renderPerfilCelular(estado: Estado): string {
  const t = estado.tela;
  if (t.tipo !== "conversa") return "";
  const a = estado.frota?.agentes.find((b) => b.id === t.agenteId);
  if (!a) return "";
  const dona = a.ownerId === estado.sessao?.pessoaId;
  const nivel = estado.gaveta?.agenteId === a.id ? estado.gaveta.nivel : null;
  if (!nivel) {
    const voltar = `<button type="button" class="gv-icone gv-painel pfc-voltar" data-act="perfil-voltar" aria-label="Voltar" title="Voltar">${ICONE.voltar}</button>`;
    return `<div class="gv-topo pfc-topo">${voltar}</div><div class="gv-corpo pfc-corpo">${cabecalho(estado, a, dona)}${acoesRapidas(estado, a)}${segundoPlano(estado, a, dona)}${onboarding(estado, a)}${grupos(estado, a, dona)}</div>`;
  }
  const n = nivelCelular(estado, a, dona, nivel);
  const pai = paiDoNivel(nivel, true);
  const destino = pai ? destinoDoVoltar(pai) : a.nome;
  const voltar = `<button type="button" class="gv-icone gv-voltar pfc-voltar" data-act="gaveta-voltar" aria-label="Voltar para ${esc(destino)}" title="Voltar">${ICONE.voltar}</button>`;
  const topo = `<div class="gv-topo pfc-topo pfc-topo-nivel"><span class="gv-lado">${voltar}</span><h2 class="gv-titulo pfc-titulo" title="${esc(n.titulo)}">${esc(n.titulo)}</h2><span class="gv-lado"></span></div>`;
  const corpo = `<div class="gv-corpo pfc-corpo">${n.corpo}</div>${n.rodape ? `<div class="${classeDoRodape(n)}">${n.rodape}</div>` : ""}`;
  return topo + (n.form ? `<form class="gv-form" ${n.form}>${corpo}</form>` : corpo);
}

/**
 * NOD-382: os níveis no celular. As 4 telas das linhas são próprias; Ajustes ganha o grupo "Na lista" e perde as
 * descrições longas; o resto (rotina, memória, acessos…) é o mesmo nível do desktop.
 */
function nivelCelular(estado: Estado, a: Bot, dona: boolean, nivel: NivelGaveta): Nivel {
  switch (nivel.tipo) {
    case "rotinas":
      return { titulo: "Rotinas", corpo: telaRotinas(estado, a, dona) };
    case "codigo":
      return { titulo: "Código", corpo: dona ? telaCodigo(estado, a) : "" };
    case "biblioteca":
      return { titulo: "Biblioteca", corpo: abaBiblioteca(estado, a, false, true) };
    case "computador":
      return { titulo: "Computador", corpo: dona ? telaComputador(estado, a) : "" };
    case "ajustes":
      return nivelAjustes(estado, a, dona, true);
    default:
      return renderNivel(estado, a, dona, nivel);
  }
}

/**
 * NOD-382: para onde a pessoa vai quando o perfil fecha. O ‹ (e o Esc) voltam à origem: do chat, ao chat com o foco na
 * pílula; da lista, à tela de antes com a lista aberta e o foco na linha do bot. "Mensagem" sempre fica no chat do bot,
 * com o foco no campo de texto, venha de onde vier.
 */
/**
 * NOD-382: de onde o perfil abre, para o ‹ voltar para lá: Seu espaço (Configurações › Agentes, com a seção), a lista de
 * bots ou o chat. `voltar` é a tela de baixo quando abrir o perfil troca de conversa.
 */
export function perfilAoAbrir(o: { agenteId: string; tela: Tela; lista: boolean; espaco: SecaoEspaco | null }): PerfilCelular {
  const outra = !(o.tela.tipo === "conversa" && o.tela.agenteId === o.agenteId);
  const voltar = outra ? { voltar: o.tela } : {};
  if (o.espaco) return { agenteId: o.agenteId, origem: "espaco", espaco: o.espaco, ...voltar };
  if (o.lista) return { agenteId: o.agenteId, origem: "lista", ...voltar };
  return { agenteId: o.agenteId, origem: "chat" };
}

/**
 * NOD-382: abrir um nível da gaveta no celular (atalhos do chat: Ver na memória, Trocar a IA…) é abrir o perfil do bot,
 * com origem no chat, se ele ainda não está aberto. No desktop, nada muda.
 */
export function perfilAoAbrirNivel(atual: PerfilCelular | null, agenteId: string, celular: boolean): PerfilCelular | null {
  if (!celular || atual?.agenteId === agenteId) return atual;
  return { agenteId, origem: "chat" };
}

export type SaidaDoPerfil = { navegar?: Tela; abrirLista: boolean; abrirEspaco?: SecaoEspaco; foco: "pilula" | "composer" | "linha-do-bot" | "espaco" };
export function saidaDoPerfil(perfil: PerfilCelular | null, para: "origem" | "chat"): SaidaDoPerfil {
  if (para === "chat") return { abrirLista: false, foco: "composer" };
  if (perfil?.origem === "espaco" && perfil.espaco) return { ...(perfil.voltar ? { navegar: perfil.voltar } : {}), abrirLista: false, abrirEspaco: perfil.espaco, foco: "espaco" };
  if (perfil?.origem === "lista") return { ...(perfil.voltar ? { navegar: perfil.voltar } : {}), abrirLista: true, foco: "linha-do-bot" };
  return { abrirLista: false, foco: "pilula" };
}

// ---- visão geral ----------------------------------------------------------------------------------------------------

const lapis = (campo: string, a: Bot, rotulo: string) =>
  `<button type="button" class="pfc-lapis" data-act="perfil-editar" data-campo="${campo}" data-id="${esc(a.id)}" aria-label="${esc(rotulo)}">${ICONE.lapis}</button>`;

/** Avatar 96, nome 22/700 e título 15 em --ink-2. O lápis põe o texto em edição ali mesmo (OK ou tocar fora salva). */
function cabecalho(estado: Estado, a: Bot, dona: boolean): string {
  const nomeLivre = nomeEditavel(a, dona);
  const tituloLivre = identidadeEditavel(dona);
  // ADR-125 item 3: no bot da pessoa o avatar continua sendo o botão que troca forma e cor (o mesmo popover do desktop).
  const aberto = estado.avatarAberto?.agenteId === a.id;
  const avatar = tituloLivre
    ? `<div class="gvn-avatar-wrap pfc-avatar"><button type="button" class="gvn-avatar" data-act="gaveta-avatar" data-id="${esc(a.id)}" aria-haspopup="dialog"${aberto ? ' aria-controls="gvn-pop"' : ""} aria-expanded="${aberto}" aria-label="Editar avatar de ${esc(a.nome)}">${iconeAgente(a, "xl")}</button>${aberto ? popoverAvatar(a) : ""}</div>`
    : iconeAgente(a, "xl");
  // O nome editável é um campo: a tela ganha um título só para o leitor de tela.
  const nome = nomeLivre
    ? `<h2 class="sr-only">${esc(a.nome)}</h2><span class="pfc-campo"><label class="sr-only" for="gvn-nome">Nome do bot</label><input id="gvn-nome" class="gvn-nome pfc-nome" data-campo="nome" data-id="${esc(a.id)}" data-salvo="${esc(a.nome)}" value="${esc(a.nome)}" maxlength="60" autocomplete="off" spellcheck="false" enterkeyhint="done" aria-describedby="gvn-erro" />${lapis("nome", a, "Editar nome")}</span>`
    : `<h2 class="pfc-nome pfc-fixo" title="${esc(a.nome)}">${esc(a.nome)}</h2>`;
  const titulo = tituloLivre
    ? `<span class="pfc-campo"><label class="sr-only" for="gvn-sub">Título do bot</label><input id="gvn-sub" class="gvn-sub pfc-sub" data-campo="titulo" data-id="${esc(a.id)}" data-salvo="${esc(a.titulo)}" value="${esc(a.titulo)}" maxlength="80" autocomplete="off" enterkeyhint="done" placeholder="Adicionar um título" aria-describedby="gvn-erro" />${lapis("titulo", a, "Editar título")}</span>`
    : `<span class="pfc-sub pfc-fixo">${esc(a.titulo || "Bot da equipe")}</span>`;
  const meta = dona ? "" : `<span class="pfc-meta">Bot compartilhado com você</span>`;
  const erro = tituloLivre ? `<span class="gvn-erro-linha"><span class="gvn-erro-icone" aria-hidden="true">${ICONE.alerta}</span><span class="gvn-erro" id="gvn-erro" role="status"></span></span>` : "";
  return `<div class="gv-identidade pfc-id">${avatar}${nome}${titulo}${meta}${erro}</div>`;
}

/** ADR-077: o onboarding guiado continua na visão geral, como na aba Detalhes do desktop. */
function onboarding(estado: Estado, a: Bot): string {
  const o = estado.onboarding;
  return estado.onboardingAberto && o && o.guia?.id === a.id && (o.etapa === "entrevista" || o.etapa === "configurando" || o.etapa === "concluido") ? secaoOnboardingDetalhes(o) : "";
}

/** Mensagem (volta ao chat), Ligar (só quando o bot liga) e Compartilhar: círculos de 52 com o rótulo embaixo. */
function acoesRapidas(estado: Estado, a: Bot): string {
  const acao = (act: string, icone: string, rotulo: string, extra = "") =>
    `<button type="button" class="pfc-acao" data-act="${act}" data-id="${esc(a.id)}"${extra}><span class="pfc-acao-circulo" aria-hidden="true">${icone}</span><span class="pfc-acao-rotulo">${esc(rotulo)}</span></button>`;
  const ligar = botaoLigar({ agente: a, pessoaId: estado.sessao?.pessoaId, disponibilidade: estado.disponibilidadeLigacao[a.id], ligacao: estado.ligacaoViva });
  const ligacao = ligar === "ligar" ? acao("iniciar-ligacao", ICONE_LIGACAO.fone(22), "Ligar", ` aria-label="${esc(`Ligar para ${a.nome}`)}"`) : ligar === "em-ligacao" ? acao("ligacao-expandir", ICONE_LIGACAO.fone(22), "Em ligação") : "";
  return `<div class="pfc-acoes">${acao("perfil-mensagem", ICONE.balao, "Mensagem")}${ligacao}${acao("perfil-compartilhar", ICONE.compartilhar, "Compartilhar", ' aria-haspopup="dialog"')}</div>`;
}

const ESQUELETO = '<span class="pfc-esqueleto" aria-hidden="true"></span><span class="sr-only">Carregando</span>';
/** O valor à direita da linha: carregando (esqueleto 40 × 12), com erro ("—") ou o texto. */
type Valor = { tipo: "carregando" } | { tipo: "erro" } | { tipo: "texto"; texto: string };

function linhaDoGrupo(a: Bot, nivel: NivelGaveta["tipo"], icone: string, rotulo: string, valor: Valor | null): string {
  const v = !valor ? "" : valor.tipo === "carregando" ? `<span class="pfc-valor">${ESQUELETO}</span>` : valor.tipo === "erro" ? '<span class="pfc-valor"><span aria-hidden="true">—</span><span class="sr-only">não carregou</span></span>' : `<span class="pfc-valor">${esc(valor.texto)}</span>`;
  return `<button type="button" class="pfc-linha" data-act="gaveta" data-nivel="${nivel}" data-agente="${esc(a.id)}" data-origem="${nivel}"><span class="pfc-icone" aria-hidden="true">${icone}</span><span class="pfc-rotulo">${esc(rotulo)}</span>${v}<span class="pfc-seta" aria-hidden="true">${ICONE.seta}</span></button>`;
}

/** "2 ativas", "1 parada", "1 pausada", "Nenhuma": o que a linha Rotinas diz. */
export function valorRotinas(estado: Pick<Estado, "rotinas" | "carregado" | "rotinasFalharam">, agenteId: string): Valor {
  if (estado.rotinasFalharam) return { tipo: "erro" };
  if (!estado.carregado.rotinas) return { tipo: "carregando" };
  const minhas = estado.rotinas.filter((r) => r.rotina.agenteId === agenteId);
  if (minhas.length === 0) return { tipo: "texto", texto: "Nenhuma" };
  const ativas = minhas.filter((r) => r.rotina.estado === "ativa" && !r.bloqueio).length;
  // Ligada mas travada (bloqueio) é "Parada", como no desktop; não é pausada. A parada pede atenção: aparece junto.
  const paradas = minhas.filter((r) => r.rotina.estado === "ativa" && r.bloqueio).length;
  const textoParadas = `${paradas} ${paradas === 1 ? "parada" : "paradas"}`;
  if (ativas > 0) return { tipo: "texto", texto: `${ativas} ${ativas === 1 ? "ativa" : "ativas"}${paradas > 0 ? ` · ${textoParadas}` : ""}` };
  if (paradas > 0) return { tipo: "texto", texto: textoParadas };
  return { tipo: "texto", texto: `${minhas.length} ${minhas.length === 1 ? "pausada" : "pausadas"}` };
}

/** "12 itens", "1 item", "Vazia"; com mais páginas, "12+ itens". */
export function valorBiblioteca(estado: Pick<Estado, "bibliotecaDoBot" | "tela">, a: Pick<Bot, "conversaId">): Valor {
  const conversaId = estado.tela.tipo === "conversa" ? estado.tela.conversaId : a.conversaId;
  const b = estado.bibliotecaDoBot[conversaId];
  if (!b) return { tipo: "carregando" };
  if (b.erro && b.itens.length === 0) return { tipo: "erro" };
  const n = b.itens.length;
  if (n === 0) return { tipo: "texto", texto: "Vazia" };
  return { tipo: "texto", texto: `${n}${b.proximo ? "+" : ""} ${n === 1 && !b.proximo ? "item" : "itens"}` };
}

/** "Ligado", "Dormindo", "Fora do ar"…: o estado do computador do bot, do computador da pessoa (v2) ou do pulso. */
export function valorComputador(estado: Pick<Estado, "computadorPessoa" | "computadorVisto">, a: Pick<Bot, "id" | "computadorForaDoAr">): Valor {
  if (estado.computadorPessoa) {
    const e = estadoDaGaveta(estado.computadorPessoa, a.id);
    const texto = { miniatura: "Ligado", sem_tela: "Ligado", dormindo: "Dormindo", acordando: "Ligando", fora: "Fora do ar" }[e];
    return { tipo: "texto", texto };
  }
  const visto = estadoDoComputadorNaGaveta(estado, a);
  if (visto === null) return { tipo: "carregando" };
  if (visto === "erro") return { tipo: "erro" };
  const texto = { ligado: "Ligado", ocupado: "Ligado", dormindo: "Dormindo", sem: "Sem computador", fora: "Fora do ar", indisponivel: "Indisponível" }[visto];
  return { tipo: "texto", texto };
}

/** A pasta do bot, só o nome dela ("nina"); null = o executor não mostra o caminho. */
function nomeDaPasta(estado: Estado, a: Bot): string | null {
  if (!mostraCaminhoDaPasta(estado.executor?.harnesses, a.harness)) return null;
  const caminho = caminhoDaPastaDoBot(a.nome).replace(/\/+$/, "");
  return caminho.slice(caminho.lastIndexOf("/") + 1) || caminho;
}

function grupos(estado: Estado, a: Bot, dona: boolean): string {
  const pasta = dona ? nomeDaPasta(estado, a) : null;
  const codigo = pasta !== null ? linhaDoGrupo(a, "codigo", ICONE.codigo, "Código", { tipo: "texto", texto: pasta }) : "";
  const rotinas = linhaDoGrupo(a, "rotinas", ICONE.relogio, "Rotinas", valorRotinas(estado, a.id));
  const biblioteca = linhaDoGrupo(a, "biblioteca", ICONE.livro, "Biblioteca", valorBiblioteca(estado, a));
  // O span escondido mantém a leitura do estado (só o status, sem captura de tela; como a gaveta do desktop): sem ele o valor fica em "carregando".
  const computador = dona ? linhaDoGrupo(a, "computador", ICONE.monitor, "Computador", valorComputador(estado, a)) + `<span hidden data-comp-bot="${esc(a.id)}"></span>` : "";
  const ajustes = linhaDoGrupo(a, "ajustes", ICONE.ajustes, "Ajustes", null);
  const g1 = [codigo, rotinas, biblioteca, computador].filter(Boolean).join("");
  const excluir = dona && a.papel !== "nod" ? `<div class="pfc-grupo"><button type="button" class="pfc-linha pfc-excluir" data-act="perfil-excluir" data-id="${esc(a.id)}" aria-haspopup="dialog">Excluir bot</button></div>` : "";
  return `<div class="pfc-grupos"><div class="pfc-grupo">${g1}</div><div class="pfc-grupo">${ajustes}</div>${excluir}</div>`;
}

// ---- telas das linhas -----------------------------------------------------------------------------------------------

/** Rotinas: "Nova rotina" primeiro; cada rotina em 64 (nome 16/500, horário 13) com o interruptor de 51 × 31. */
function telaRotinas(estado: Estado, a: Bot, dona: boolean): string {
  const nova = dona ? `<div class="pfc-grupo"><button type="button" class="pfc-linha pfc-nova" data-act="rotina-no-chat" data-agente="${esc(a.id)}" aria-label="Nova rotina: pedir a ${esc(a.nome)} na conversa"><span class="pfc-icone" aria-hidden="true">${ICONE.mais}</span><span class="pfc-rotulo">Nova rotina</span></button></div>` : "";
  if (estado.rotinasFalharam) {
    return `${nova}<p class="pfc-erro" role="status">As rotinas não carregaram · <button type="button" class="pfc-link" data-act="perfil-tentar-rotinas">Tentar de novo</button></p>`;
  }
  if (!estado.carregado.rotinas) {
    return `${nova}<div class="pfc-grupo" aria-busy="true"><div class="pfc-rotina pfc-rotina-esqueleto"><span class="pfc-esqueleto pfc-esqueleto-largo" aria-hidden="true"></span></div></div><span class="sr-only" role="status">Carregando as rotinas</span>`;
  }
  const minhas = estado.rotinas.filter((r) => r.rotina.agenteId === a.id);
  if (minhas.length === 0) {
    // NOD-444: um botão só ("Nova rotina", acima); o vazio ensina a pedir na conversa.
    return `${nova}<div class="pfc-vazio"><b>Nenhuma rotina ainda</b><p class="pfc-dica">${DICA_ROTINAS}</p></div>`;
  }
  const linhaRotina = (dto: RotinaDto) => {
    const { rotina: r, proximaExecucao, bloqueio, resumo } = dto;
    const ativa = r.estado === "ativa";
    // NOD-84: a rotina por webhook não tem "próxima" (o cron é sentinela); o "quando" e o "!" são os do desktop.
    const wh = ehRotinaWebhook(dto) ? quandoNaLista(dto) : null;
    const quando = bloqueio ? fraseDaParada(bloqueio) : wh ? [wh.quando, ativa ? "" : "Pausada"].filter(Boolean).join(" · ") : [resumo ? capitalizar(semFuso(resumo)) : "", ativa ? `próxima ${interpolar(proximaExecucao, estado.agora)}` : dto.retomada ? `Pausada até ${dto.retomada.texto}` : "Pausada"].filter(Boolean).join(" · ");
    const chave = dona ? chaveCelular(ativa, ativa ? "pausar-rotina" : "ativar-rotina", r.id, `Rotina ${r.instrucao}`) : "";
    // A rotina parada mantém o conserto de um toque (Conectar / Permitir), como no desktop.
    const conserto = dona && bloqueio ? `<li class="pfc-rotina-conserto">${botaoDaParada(bloqueio, "pfc-contorno")}</li>` : "";
    return `<li class="pfc-rotina${bloqueio ? " pfc-rotina-parada" : ""}"><button type="button" class="pfc-rotina-abrir" data-act="gaveta" data-nivel="rotina" data-agente="${esc(a.id)}" data-id="${esc(r.id)}"><b>${esc(r.instrucao)}</b><small>${wh?.marca ?? ""}${esc(quando)}</small></button>${chave}</li>${conserto}`;
  };
  return `${nova}<ul class="pfc-grupo">${minhas.map(linhaRotina).join("")}</ul>`;
}

/** Código: a Pasta (tocar copia o caminho) e a nota. Repositório e branch ficam de fora: a API não os tem (ver PR). */
function telaCodigo(estado: Estado, a: Bot): string {
  const caminho = caminhoDaPastaDoBot(a.nome);
  const pasta = nomeDaPasta(estado, a) ?? caminho;
  return `<div class="pfc-grupo"><button type="button" class="pfc-linha" data-act="perfil-copiar-pasta" data-caminho="${esc(caminho)}" aria-label="${esc(`Pasta ${pasta}, copiar o caminho`)}"><span class="pfc-icone" aria-hidden="true">${ICONE.pasta}</span><span class="pfc-rotulo">Pasta</span><span class="pfc-valor">${esc(pasta)}</span></button></div>`;
}

/**
 * Computador: a linha Estado, a ação do estado (Acordar dormindo, Tentar de novo fora do ar, as mesmas do desktop) e
 * "Abrir computador" (contorno, 44). Mantém a leitura do estado com `data-comp-bot`.
 */
export function telaComputador(estado: Estado, a: Bot): string {
  const v = valorComputador(estado, a);
  const valor = v.tipo === "carregando" ? ESQUELETO : v.tipo === "erro" ? '<span aria-hidden="true">—</span><span class="sr-only">não carregou</span>' : esc(v.texto);
  return `<section data-comp-bot="${esc(a.id)}"${v.tipo === "carregando" ? ' aria-busy="true"' : ""}><div class="pfc-grupo"><div class="pfc-linha pfc-linha-fixa"><span class="pfc-icone" aria-hidden="true">${ICONE.monitor}</span><span class="pfc-rotulo">Estado</span><span class="pfc-valor">${valor}</span></div></div>
    ${acaoDoComputador(estado, a)}<button type="button" class="pfc-contorno" data-act="abrir-computador" data-id="${esc(a.id)}">Abrir computador</button></section>`;
}

function acaoDoComputador(estado: Estado, a: Bot): string {
  const contorno = (rotulo: string, attrs: string, ocupado = false) => `<button type="button" class="pfc-contorno" ${attrs}${ocupado ? " disabled" : ""}>${esc(rotulo)}</button>`;
  if (estado.computadorPessoa) {
    const e = estadoDaGaveta(estado.computadorPessoa, a.id);
    if (e === "dormindo") return contorno("Acordar", 'data-act="operar-computador" data-op="acordar"');
    if (e === "fora") return contorno("Tentar de novo", 'data-act="operar-computador" data-op="tentar_de_novo"');
    return "";
  }
  const visto = estadoDoComputadorNaGaveta(estado, a);
  const acao = estado.computadorAcao?.agenteId === a.id ? estado.computadorAcao.tipo : null;
  if (visto === "dormindo") return contorno(acao === "acordar" ? "Acordando…" : "Acordar", `data-act="computador-acordar" data-id="${esc(a.id)}"`, acao === "acordar");
  if (visto === "fora") return contorno(acao === "religar" ? "Tentando de novo…" : "Tentar de novo", `data-act="religar-computador" data-id="${esc(a.id)}"`, acao === "religar");
  return "";
}
