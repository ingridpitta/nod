import type { CampoVersionavel, DetalheVersaoPerfil, PerfilVersionavel, VersaoPerfil } from "../../src/contracts/versoes-perfil.ts";
import type { HistoricoDoBot, OndeDesfazer } from "../lib/historico-perfil.ts";
import { formatoData } from "../lib/formato-data.ts";
import { ICONE } from "../lib/icones.ts";
import { esc, hora, iconeAgente } from "../lib/render.ts";
import { VOZES } from "./ligacao.ts";

/**
 * definido em 2026-10-30 (NOD-20, protótipo v5 aprovado): o histórico de versões do perfil na gaveta do bot. Ajustes ›
 * Perfil ganha a linha Histórico; o nível `historico` lista as versões por dia; o nível `versao` compara a versão com o
 * perfil de agora, campo a campo, com Restaurar fixo no rodapé e a confirmação numa frase. Salvar é silencioso: só o
 * Desfazer (um link) e o leitor de tela (role=status) ficam sabendo. Render puro: o estado mora em `HistoricoDoBot`.
 */
type BotDoHistorico = { id: string; nome: string; papel?: string | null };

// ---- textos ---------------------------------------------------------------------------------------------------------

/** Os grupos de campo como a pessoa os vê: forma e cor juntas; voz e velocidade são "voz". */
type Grupo = "nome" | "titulo" | "descricao" | "voz" | "avatar";
const ORDEM_GRUPOS: readonly Grupo[] = ["descricao", "voz", "nome", "titulo", "avatar"];
const GRUPO_DO_CAMPO: Readonly<Record<CampoVersionavel, Grupo>> = { nome: "nome", titulo: "titulo", descricao: "descricao", forma: "avatar", cor: "avatar", voz: "voz", vozVelocidade: "voz" };
const NOME_GRUPO: Readonly<Record<Grupo, string>> = { nome: "nome", titulo: "subtítulo", descricao: "missão", voz: "voz", avatar: "forma e cor" };
const ARTIGO_GRUPO: Readonly<Record<Grupo, string>> = { nome: "o nome", titulo: "o subtítulo", descricao: "a missão", voz: "a voz", avatar: "a forma e a cor" };

export function gruposDosCampos(campos: readonly CampoVersionavel[]): Grupo[] {
  const tem = new Set(campos.map((c) => GRUPO_DO_CAMPO[c]));
  return ORDEM_GRUPOS.filter((g) => tem.has(g));
}

/** "a", "a e b", "a, b e c". */
export function juntar(itens: readonly string[]): string {
  if (itens.length <= 1) return itens[0] ?? "";
  return `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}

const maiuscula = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/** Quem fez e o quê, em frase de gente. `autor: "nod"` é a mudança que o Nod fez pelo chat (gerir_bots), não a pessoa. */
export function fraseDaVersao(v: Pick<VersaoPerfil, "origem" | "campos" | "restauradaDe"> & { autor?: VersaoPerfil["autor"] }, nomeBot: string): string {
  const quem = v.autor === "nod" || v.origem === "chat" ? "O Nod" : "Você";
  switch (v.origem) {
    case "inicial":
      return "Primeira versão";
    case "proposta":
      return `${nomeBot} propôs, você confirmou`;
    case "voz":
      return "Voz ajustada numa ligação";
    case "restauracao":
      return v.restauradaDe ? `${quem} restaurou a versão ${v.restauradaDe}` : `${quem} restaurou uma versão`;
    case "tela":
    case "chat": {
      const g = gruposDosCampos(v.campos);
      return g.length ? `${quem} mudou ${juntar(g.map((x) => ARTIGO_GRUPO[x]))}` : `${quem} mudou o perfil`;
    }
  }
}

/** O cinza da linha: os campos que mudaram (vazio na inicial). */
const camposEmCinza = (v: Pick<VersaoPerfil, "campos">) => juntar(gruposDosCampos(v.campos).map((g) => NOME_GRUPO[g]));

const DIA_MS = 86_400_000;
const inicioDoDia = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

/** "Hoje", "Ontem" ou "20 de out." (com o ano quando não é o deste ano). */
export function rotuloDoDia(instante: number, agora: number): string {
  const dias = Math.round((inicioDoDia(agora) - inicioDoDia(instante)) / DIA_MS);
  if (dias === 0) return "Hoje";
  if (dias === 1) return "Ontem";
  const mesmoAno = new Date(instante).getFullYear() === new Date(agora).getFullYear();
  return formatoData("pt-BR", { day: "numeric", month: "short", ...(mesmoAno ? {} : { year: "numeric" }) }).format(new Date(instante));
}

/** "hoje, 09:05", "ontem, 09:05", "20 de out., 16:30". */
function quando(instante: number, agora: number): string {
  const dia = rotuloDoDia(instante, agora);
  return `${dia === "Hoje" || dia === "Ontem" ? dia.toLowerCase() : dia}, ${hora(instante)}`;
}

const nomeDaVoz = (voz: string | null) => VOZES.find((v) => v.id === voz)?.nome ?? (voz === null ? "Automática" : voz);
const velocidade = (x: number) => `${String(x).replace(".", ",")}x`;
const rotuloVoz = (p: PerfilVersionavel) => `${nomeDaVoz(p.voz)} · ${velocidade(p.vozVelocidade)}`;

/** O marcador de segredo («redigido: …») ganha o estilo dele; o resto é texto escapado. */
export function textoComRedacao(texto: string): string {
  return texto.split(/(«redigido[^»]*»)/).map((parte, i) => (i % 2 === 1 ? `<span class="p20-redigido">${esc(parte)}</span>` : esc(parte))).join("");
}

/**
 * O "Agora" de um texto longo com o que só existe agora sublinhado (prefixo e sufixo comuns). Sem parte comum, o texto
 * vai inteiro, sem marca: sublinhar tudo não ajuda a ler.
 */
export function agoraComMarca(antes: string, agora: string): string {
  let ini = 0;
  while (ini < antes.length && ini < agora.length && antes[ini] === agora[ini]) ini++;
  let fim = 0;
  while (fim < antes.length - ini && fim < agora.length - ini && antes[antes.length - 1 - fim] === agora[agora.length - 1 - fim]) fim++;
  const meio = agora.slice(ini, agora.length - fim);
  if (!meio || ini + fim === 0) return textoComRedacao(agora);
  return `${textoComRedacao(agora.slice(0, ini))}<ins><span class="sr-only">só agora: </span>${textoComRedacao(meio)}</ins>${textoComRedacao(agora.slice(agora.length - fim))}`;
}

/** Os grupos em que a versão difere do perfil de agora. */
export function gruposDiferentes(versao: PerfilVersionavel, agora: PerfilVersionavel): Grupo[] {
  const dif: Grupo[] = [];
  if (versao.descricao !== agora.descricao) dif.push("descricao");
  if (versao.voz !== agora.voz || Math.abs(versao.vozVelocidade - agora.vozVelocidade) > 1e-6) dif.push("voz");
  if (versao.nome !== agora.nome) dif.push("nome");
  if (versao.titulo !== agora.titulo) dif.push("titulo");
  if (versao.forma !== agora.forma || versao.cor !== agora.cor) dif.push("avatar");
  return dif;
}

/** O título da versão aberta: o que ela é em relação a agora. */
export function tituloDaVersao(dif: readonly Grupo[]): string {
  return dif.length ? `${maiuscula(juntar(dif.map((g) => NOME_GRUPO[g])))} ${dif.length === 1 ? "diferente" : "diferentes"} de agora` : "Igual ao perfil de agora";
}

/** A frase do efeito de restaurar, na confirmação. */
export function efeitoDeRestaurar(dif: readonly Grupo[], versao: PerfilVersionavel): string {
  const partes = dif.map((g) => (g === "voz" ? `a voz volta para ${nomeDaVoz(versao.voz)} · ${velocidade(versao.vozVelocidade)}` : `${ARTIGO_GRUPO[g]} ${g === "avatar" ? "voltam" : "volta"} a como ${g === "avatar" ? "estavam" : "estava"}`));
  return `${maiuscula(juntar(partes))}.`;
}

// ---- Ajustes › Perfil -------------------------------------------------------------------------------------------------

/** A linha Histórico em Ajustes › Perfil (só a dona chama). O total aparece quando a lista já chegou. */
export function linhaHistorico(a: BotDoHistorico, h: HistoricoDoBot | undefined, celular = false): string {
  const total = h?.lista?.total;
  const meta = typeof total === "number" ? `<span class="gv-meta">${total} ${total === 1 ? "versão" : "versões"}</span>` : "";
  return `<button type="button" class="gv-linha p20-hist" data-act="gaveta" data-nivel="historico" data-agente="${esc(a.id)}" data-origem="historico">${ICONE.relogio}<span class="gv-linha-txt">Histórico${celular ? "" : "<small>Cada mudança, e como voltar</small>"}</span>${meta}${ICONE.seta}</button>`;
}

/** O Desfazer logo depois de salvar (embaixo do cartão do Perfil ou do nome) ou de restaurar (no topo da lista). */
export function statusDesfazer(a: BotDoHistorico, h: HistoricoDoBot | undefined, onde: OndeDesfazer): string {
  // Revisão 3 M3: o anúncio (Missão salva, Perfil restaurado…) é dito pelo nó fixo #anuncio-config (main.ts,
  // mudarHistorico), fora da gaveta que o render troca inteira; aqui fica só o link.
  const d = h?.desfazer?.onde === onde ? h.desfazer : null;
  if (!d) return "";
  return `<p class="p20-status"><button type="button" class="gvn-acao-texto p20-acao" data-act="desfazer-versao" data-agente="${esc(a.id)}" data-versao="${d.versao}" aria-label="${esc(d.aria)}">${esc(d.rotulo)}</button></p>`;
}

// ---- nível Histórico ----------------------------------------------------------------------------------------------------

const ESQUELETO = `<ul class="gv-cartao p20-esqueleto" aria-busy="true" aria-label="Carregando o histórico">${'<li><span class="p20-barra"></span><span class="p20-barra p20-curta"></span></li>'.repeat(4)}</ul><span class="sr-only" role="status">Carregando o histórico</span>`;

function linhaDaVersao(a: BotDoHistorico, v: VersaoPerfil, atual: number, agora: number): string {
  const ehAtual = v.versao === atual;
  const frase = fraseDaVersao(v, a.nome);
  const campos = camposEmCinza(v);
  const dia = rotuloDoDia(v.criadoEm, agora);
  const aria = `Versão ${v.versao}, ${dia === "Hoje" || dia === "Ontem" ? dia.toLowerCase() : `em ${dia}`} às ${hora(v.criadoEm)}: ${frase}${ehAtual ? ". Atual" : ""}`;
  return `<li><button type="button" class="gv-linha p20-versao" data-act="gaveta" data-nivel="versao" data-agente="${esc(a.id)}" data-id="${v.versao}" aria-label="${esc(aria)}"><span class="gv-linha-txt"><b>${esc(frase)}</b><small>${esc(`Versão ${v.versao} · ${hora(v.criadoEm)}${campos ? ` · ${campos}` : ""}`)}</small></span>${ehAtual ? '<span class="gv-meta p20-atual">Atual</span>' : ""}${ICONE.seta}</button></li>`;
}

export function nivelHistorico(a: BotDoHistorico, h: HistoricoDoBot | undefined, agora: number): { titulo: string; corpo: string } {
  const intro = `<p class="gvn-vazio p20-intro">Cada mudança no perfil de ${esc(a.nome)} vira uma versão. Restaurar uma delas cria outra: nada se perde.</p>`;
  const lista = h?.lista;
  if (!lista) {
    const corpo = h?.erro
      ? `<div class="p20-falha"><p class="p20-erro">Não deu para carregar o histórico.</p><button type="button" class="gvn-acao-texto p20-acao p20-tentar" data-act="historico-recarregar" data-agente="${esc(a.id)}">Tentar de novo</button></div>`
      : ESQUELETO;
    return { titulo: "Histórico", corpo: intro + corpo };
  }
  const dias: { rotulo: string; versoes: VersaoPerfil[] }[] = [];
  for (const v of lista.versoes) {
    const rotulo = rotuloDoDia(v.criadoEm, agora);
    const ultimo = dias[dias.length - 1];
    if (ultimo?.rotulo === rotulo) ultimo.versoes.push(v);
    else dias.push({ rotulo, versoes: [v] });
  }
  const secoes = dias.map((d, i) => `<section class="gv-secao p20-dia"><h3 id="p20-dia-${i}">${esc(d.rotulo)}</h3><ul class="gv-cartao" aria-labelledby="p20-dia-${i}">${d.versoes.map((v) => linhaDaVersao(a, v, lista.atual, agora)).join("")}</ul></section>`).join("");
  const sozinha = lista.total <= 1;
  const vazio = sozinha ? `<p class="gvn-vazio p20-intro">Quando você ou ${esc(a.nome)} mudarem o perfil, cada mudança aparece aqui e dá para voltar a qualquer uma.</p>` : "";
  const mais = lista.mais
    ? `<div class="p20-mais"><button type="button" class="gvn-acao-texto p20-acao p20-mais-bt" data-act="historico-mais" data-agente="${esc(a.id)}"${h?.carregandoMais ? ' aria-busy="true" disabled' : ""}>Mostrar versões anteriores</button><p class="mudo gv-nota">Mostrando ${lista.versoes.length} de ${lista.total}. O nod guarda as 50 últimas versões de cada bot.</p></div>`
    : "";
  return { titulo: "Histórico", corpo: statusDesfazer(a, h, "historico") + (sozinha ? "" : intro) + secoes + vazio + mais };
}

// ---- nível Versão -------------------------------------------------------------------------------------------------------

function blocoDoGrupo(g: Grupo, versao: PerfilVersionavel, agora: PerfilVersionavel, redigida: boolean, nomeBot: string): string {
  const titulo = maiuscula(NOME_GRUPO[g]);
  if (g === "descricao") {
    const aviso = redigida && /«redigido/.test(versao.descricao)
      ? `<p class="p20-aviso p20-segredo">Partes com segredo não voltam: o nod guardou só o aviso no lugar delas. Se restaurar, a missão volta com o aviso, e ${esc(nomeBot)} pede o acesso quando precisar.</p>`
      : "";
    return `<section class="p20-bloco"><h4 class="p20-bloco-t">${titulo}</h4><div class="gv-cartao p20-par"><div class="p20-linha"><span class="p20-rot">Nesta versão</span><p class="p20-texto">${textoComRedacao(versao.descricao) || '<span class="mudo">Sem missão escrita.</span>'}</p></div><div class="p20-linha p20-agora"><span class="p20-rot">Agora</span><p class="p20-texto">${agoraComMarca(versao.descricao, agora.descricao) || '<span class="mudo">Sem missão escrita.</span>'}</p></div>${aviso}</div></section>`;
  }
  if (g === "avatar") {
    const icone = (p: PerfilVersionavel) => iconeAgente({ nome: nomeBot, forma: p.forma, cor: p.cor }, "sm");
    return `<section class="p20-bloco"><h4 class="p20-bloco-t">${titulo}</h4><div class="gv-cartao p20-par" role="group" aria-label="Forma e cor: nesta versão e agora"><p class="p20-curto"><span class="p20-lado">${icone(versao)}<small>Nesta versão</small></span><span class="p20-seta" aria-hidden="true">→</span><span class="p20-lado p20-agora">${icone(agora)}<small>Agora</small></span></p></div></section>`;
  }
  const valor = (p: PerfilVersionavel) => (g === "voz" ? rotuloVoz(p) : g === "nome" ? p.nome : p.titulo) || "—";
  const [antes, depois] = [valor(versao), valor(agora)];
  return `<section class="p20-bloco"><h4 class="p20-bloco-t">${titulo}</h4><div class="gv-cartao p20-par" role="group" aria-label="${esc(`${titulo}: nesta versão ${antes}; agora ${depois}`)}"><p class="p20-curto"><span class="p20-lado"><b>${textoComRedacao(antes)}</b><small>Nesta versão</small></span><span class="p20-seta" aria-hidden="true">→</span><span class="p20-lado p20-agora"><b>${textoComRedacao(depois)}</b><small>Agora</small></span></p></div></section>`;
}

function perfilCompleto(p: PerfilVersionavel, nomeBot: string): string {
  const campo = (nome: string, valor: string) => `<div class="p20-campo p20-campo-linha"><span class="p20-campo-nome">${nome}</span><span class="p20-texto">${valor}</span></div>`;
  return `<details class="p20-completo"><summary>Ver o perfil completo desta versão</summary><div class="gv-cartao p20-diff">${[
    campo("Nome", textoComRedacao(p.nome)),
    campo("Subtítulo", textoComRedacao(p.titulo) || "—"),
    campo("Missão", textoComRedacao(p.descricao) || "—"),
    campo("Voz", esc(rotuloVoz(p))),
    campo("Forma e cor", iconeAgente({ nome: nomeBot, forma: p.forma, cor: p.cor }, "sm")),
  ].join("")}</div></details>`;
}

function confirmacao(a: BotDoHistorico, d: DetalheVersaoPerfil, h: HistoricoDoBot, dif: readonly Grupo[]): string {
  const n = d.versao.versao;
  const pendente = d.propostaPendente
    ? `<p class="p20-aviso">A proposta de perfil que ${esc(a.nome)} fez às ${hora(d.propostaPendente.criadaEm)} deixa de valer. A conversa fica sabendo.</p>`
    : "";
  // Revisão 2 (A1/M4): o servidor diz se um segredo some (o da versão não volta, ou o de agora sai do perfil vivo).
  const segredo = d.perdeSegredo
    ? `<p class="p20-aviso p20-segredo">Um segredo do perfil não volta: no lugar dele fica o aviso «redigido», e ${esc(a.nome)} pede o acesso quando precisar.</p>`
    : "";
  const erro = h.erroRestaurar ? '<p class="p20-erro">Não deu para restaurar. Nada mudou no perfil.</p>' : "";
  const ocupado = h.restaurando ? ' aria-busy="true" disabled' : "";
  return `<section class="p20-confirma" role="group" aria-labelledby="p20-conf-t"><p class="p20-conf-t" id="p20-conf-t">Restaurar a versão ${n}?</p><p class="p20-conf-sub">${esc(efeitoDeRestaurar(dif, d.versao.perfil))}</p>${pendente}${segredo}<p class="mudo p20-conf-nota">${d.perdeSegredo ? `Isso vira a versão ${d.proxima}. A de agora continua no histórico, mas sem o segredo.` : `Isso vira a versão ${d.proxima}. A de agora continua no histórico: nada se perde.`}</p>${erro}<div class="p20-confirma-bts"><button type="button" class="gv-bt" data-act="restaurar-versao-cancelar" data-agente="${esc(a.id)}">Cancelar</button><button type="button" class="gv-bt p20-bt-contorno" data-act="restaurar-versao" data-agente="${esc(a.id)}" data-versao="${n}"${ocupado}>${h.erroRestaurar ? "Tentar de novo" : "Restaurar"}</button></div></section>`;
}

export function nivelVersao(a: BotDoHistorico, h: HistoricoDoBot | undefined, numero: number, agora: number): { titulo: string; corpo: string; rodape?: string } {
  const titulo = `Versão ${numero}`;
  const d = h?.detalhe?.versao.versao === numero ? h.detalhe : null;
  if (!d || !h) {
    const corpo = h?.erroDetalhe
      ? `<div class="p20-falha"><p class="p20-erro">Não deu para abrir esta versão.</p><button type="button" class="gvn-acao-texto p20-acao p20-tentar" data-act="versao-recarregar" data-agente="${esc(a.id)}" data-versao="${numero}">Tentar de novo</button></div>`
      : ESQUELETO.replaceAll("o histórico", "a versão");
    return { titulo, corpo };
  }
  const v = d.versao;
  const dif = gruposDiferentes(v.perfil, d.atual);
  const iguais = ORDEM_GRUPOS.filter((g) => !dif.includes(g));
  const cab = `<header class="p20-cab-versao"><h3 class="p20-titulo">${esc(tituloDaVersao(dif))}</h3><p class="p20-meta">${esc(`${fraseDaVersao(v, a.nome)} · ${quando(v.criadoEm, agora)}`)}</p>${d.restauravel ? '<p class="p20-orienta">Compare com o perfil de agora e restaure se quiser voltar.</p>' : ""}</header>`;
  const comp = dif.length ? `<div class="p20-comp">${dif.map((g) => blocoDoGrupo(g, v.perfil, d.atual, v.redigida, a.nome)).join("")}</div>` : "";
  const nomesIguais = juntar(iguais.map((g) => NOME_GRUPO[g]));
  const recolhidos = iguais.length && dif.length
    ? `<details class="p20-iguais"><summary>${iguais.length} ${iguais.length === 1 ? "campo sem mudança" : "campos sem mudança"}</summary><p>${esc(`${maiuscula(nomesIguais)}: ${iguais.length === 1 ? "igual ao" : "iguais aos"} de agora.`)}</p></details>`
    : "";
  const corpo = cab + comp + `<div class="p20-fim">${recolhidos}${perfilCompleto(v.perfil, a.nome)}</div>`;
  if (!d.restauravel) return { titulo, corpo };
  const rodape = h.confirmando === numero
    ? confirmacao(a, d, h, dif)
    : `<button type="button" class="gv-bt p20-bt-contorno p20-restaurar-bt" data-act="restaurar-versao-pedir" data-agente="${esc(a.id)}" data-versao="${numero}" aria-describedby="p20-rest-d">${d.perdeSegredo ? "Restaurar esta versão (sem o segredo)" : "Restaurar esta versão"}</button><span class="sr-only" id="p20-rest-d">O perfil volta a ser como nesta versão, e isso vira uma versão nova.</span>`;
  return { titulo, corpo, rodape };
}
