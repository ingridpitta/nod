import { listaDasColunasParaSuaVez } from "./card-colunas.ts";
import { previaParaSuaVez } from "./card-importacao.ts";
import { previaAssumirParaSuaVez } from "./card-assumir-quadro.ts";
import type { SuaVezDto } from "../../src/contracts/api.ts";
import type { Proposta } from "../../src/contracts/conversa.ts";
import type { TIPOS_DISPENSAVEIS_ABERTOS, TipoDecisao } from "../../src/contracts/decisao.ts";
import type { Estado } from "../estado/reducer.ts";
import { checkboxesDosGrupos, type IdGrupo } from "./app-acesso.ts";
import { logoApp } from "./marketplace.ts";
import { pedidosAbertos } from "../lib/avisos.ts";
import { desdeDaParada, linhaNaoRodaram } from "../lib/execucao.ts";
import { chaveDoItem, contarFios, ehPergunta } from "../lib/perguntas.ts";
import { botao, esc, hora, iconeAgente } from "../lib/render.ts";
import { renderCartaoPergunta } from "./cartao-pergunta.ts";
import { emQuanto, foraDoArDesde, haQuanto, nadaEsperando } from "../lib/relogio.ts";
import { acoesComAcesso, linhasPrecisa } from "./rotina-precisa.ts";
import { listaDoLoteParaSuaVez } from "./card-lote.ts";
import { ehCartaoCredencial, renderCardCredencial } from "./card-credencial.ts";
import { ehCartaoDoRevisor, motivoDoCartao, perguntaDoCartao, renderCartaoRevisor, sempreNoCartao } from "./cartao-revisor.ts";
import { noSeuMac, seuMac } from "../lib/plataforma-da-tela.ts";

type Item = SuaVezDto["itens"][number];

const TIPO_HUMANO: Record<TipoDecisao, string> = {
  aprovacao: "aprovação em lista",
  acesso: "pedido de acesso",
  retomar_turno: "turno interrompido",
  gate_rotina: "gate de rotina",
  perfil: "perfil proposto",
  rotina: "rotina proposta",
  rotina_atualizacao: "mudança de rotina",
  rotina_exclusao: "exclusão de rotina",
  bot: "bot proposto",
  lote_bots: "mudanças nos seus bots",
  pergunta: "pergunta",
  falta_de_dado: "falta um dado",
  permissao: "pedido de permissão",
  credencial: "pedido de chave",
  colunas_quadro: "colunas do quadro",
  importacao_linear: "trazer do Linear",
  assumir_quadro: "o quadro assume",
  app: "app do bot",
  quadro_exclusao: "excluir quadro",
};

const recusaAutomatica = (em: string): string => `recusa automática ${em}`;
const nadaMudaSemVoce = (em: string): string => `vence ${em} · nada muda sem você`;
const vence = (em: string): string => `vence ${em}`;

/** O pedido de acesso veio de uma rotina (payload.rotinaId): permitir a roda, e vencer a pausa. */
export function pedidoDeRotina(proposta: Proposta | null | undefined): boolean {
  return proposta?.payload.kind === "acesso" && proposta.payload.rotinaId !== undefined;
}

/**
 * definido em 2026-09-24: o relógio do card diz o que ACONTECE quando o prazo passa — antes era
 * "recusa automática" para todo tipo, inclusive onde nada é recusado. Aprovação (nada é executado) e
 * acesso (nada é concedido) recusam; o gate da rotina passa em branco; proposta vence e nada muda; o
 * resto só vence. Record exaustivo: um tipo novo não compila sem dizer o seu. Desde 2026-09-24 (emenda
 * da ADR-044) cada entrada recebe também o item: o acesso pedido por uma ROTINA não é só recusado —
 * vencido, ele pausa a rotina (varredor-expiracao.ts), e o relógio diz isso.
 */
const PRAZO_POR_TIPO: Record<TipoDecisao, (em: string, item: Item) => string> = {
  aprovacao: recusaAutomatica,
  acesso: (em, item) => (pedidoDeRotina(item.proposta) ? `a rotina pausa sozinha ${em}` : recusaAutomatica(em)),
  gate_rotina: (em) => `passa em branco ${em}`,
  perfil: nadaMudaSemVoce,
  rotina: nadaMudaSemVoce,
  rotina_atualizacao: nadaMudaSemVoce,
  rotina_exclusao: nadaMudaSemVoce,
  bot: nadaMudaSemVoce,
  lote_bots: nadaMudaSemVoce,
  retomar_turno: vence,
  pergunta: vence,
  falta_de_dado: vence,
  permissao: vence,
  credencial: vence,
  colunas_quadro: nadaMudaSemVoce,
  importacao_linear: nadaMudaSemVoce,
  assumir_quadro: nadaMudaSemVoce,
  app: nadaMudaSemVoce,
  quadro_exclusao: nadaMudaSemVoce,
};

/** Regras que fecham decisão sem pessoa (ADR-042), em frase curta; regra sem tradução cai no genérico. */
const REGRA_HUMANA: Readonly<Record<string, string>> = {
  "regra:rotina_nao_retoma": "fechado: a rotina não retoma",
  "regra:gemea_resolvida": "resolvido junto do pedido igual",
  "regra:retomada_substituida": "fechado: uma retomada mais nova tomou o lugar",
  "regra:aprovacao_permanente": "aprovado pela regra que você criou",
  // ADR-059: o bot aprovou sozinho pelo modo que a dona escolheu.
  "regra:modo_automatico": "aprovado sozinho: aprovação automática",
  "regra:modo_total": "aprovado sozinho: sem aprovações",
  // definido em 2026-09-24 (emenda da ADR-044, migração 0026): a sobra de um pedido de rotina repetido.
  "regra:pedido_de_acesso_unico": "fechado: o mesmo acesso já estava pedido",
  // definido em 2026-10-16 (review de design do #342, NOD-270): a janela seguinte fechou a pergunta das voltas, e o card
  // de acesso venceu com o acesso já dado por outro caminho.
  "regra:janela_seguinte": "fechada: a janela seguinte já rodou",
  "regra:acesso_ja_concedido": "fechado: o acesso já tinha sido dado",
  // definido em 2026-11-02 (revisão 5 do #626, NOD-445): o card Criar/Ajustar de um app que um card novo do mesmo app trocou.
  "regra:app_substituido": "fechado: um card mais novo do mesmo app tomou o lugar",
};

/**
 * definido em 2026-09-24: o desfecho do card vencido em palavras — antes saía o enum com espaços
 * ("venceu expirou com alguem ciente"). Mesmas frases da mensagem do varredor
 * (src/adapters/fundo/varredor-expiracao.ts). Switch exaustivo: desfecho novo não compila sem rótulo.
 */
/**
 * definido em 2026-09-24 (ADR-048): aprovado e marcado, sem desfecho, rodando no gh do Mac = "aguardando
 * seu Mac" — o item sai quando o app nod da pessoa estiver aberto, ou vence como as decisões vencem.
 */
function tagDesfecho(i: { selecionado: boolean; desfecho: string | null; destino: { execucao?: "maquina" } }, aberta: boolean): string {
  if (i.desfecho) return `<span class="tag tag-cinza">${esc(i.desfecho.replaceAll("_", " "))}</span>`;
  if (!aberta && i.selecionado && i.destino.execucao === "maquina") return `<span class="tag tag-ambar" title="Abra o app nod ${noSeuMac()} com o gh logado">aguardando ${seuMac()}</span>`;
  return "";
}

export function rotuloVencido(d: Item["decisao"], agora: number): string {
  const venceu = `venceu ${haQuanto(Math.max(0, agora - Date.parse(d.prazoDecisaoEm)))}`;
  const desfecho = d.desfecho;
  if (!desfecho) return venceu;
  switch (desfecho.tipo) {
    case "expirou_sem_ninguem_ver":
      return `${venceu} · ninguém chegou a ver`;
    case "expirou_com_alguem_ciente":
      return `${venceu} · alguém viu, mas ninguém respondeu`;
    case "dispensada":
      return "dispensado por você";
    case "decidida_por_regra":
      return REGRA_HUMANA[desfecho.regra] ?? "fechado automaticamente";
    case "decidida":
      return "decidido";
  }
}

/**
 * definido em 2026-09-24: pedidos abertos iguais chegam dobrados num item só (montarFila,
 * src/domain/fila-frota.ts). O "×N" diz quantos são e que decidir aqui resolve todos — quem decide,
 * recusa ou dispensa este item fecha os outros (src/use-cases/fechar-gemeas.ts).
 */
export function marcaGemeas(item: Pick<Item, "gemeas"> | undefined): string {
  const n = (item?.gemeas.length ?? 0) + 1;
  if (n < 2) return "";
  const dica = `${n} pedidos iguais; decidir aqui resolve todos`;
  return `<span class="tag tag-ambar dec-gemeas" title="${esc(dica)}" aria-label="${esc(dica)}">×${n}</span>`;
}

/** Ids dobrados num "×N": o card de proposta de cada um não aparece sozinho na conversa. */
export function idsGemeas(estado: Estado): ReadonlySet<string> {
  return new Set((estado.suaVez?.itens ?? []).flatMap((i) => i.gemeas));
}

const JUSTIFICATIVA_PADRAO = "Veio de um lugar que guarda dado pessoal. Deixei desmarcado — só você pode marcar.";

/**
 * definido em 2026-09-24 (ADR-044): um clique concede E continua, e o botão diz isso. Pedido que veio
 * de uma rotina a roda de novo na hora; recusar pausa a rotina, porque sem o acesso ela pediria de
 * novo a cada disparo. Mesmos rótulos no card da conversa e em "Sua vez".
 */
export function rotulosAcesso(proposta: Proposta | null | undefined): { permitir: string; recusar: string } {
  return proposta?.payload.kind === "acesso" && proposta.payload.rotinaId
    ? { permitir: "Permitir e rodar agora", recusar: "Pausar rotina" }
    : { permitir: "Permitir e continuar", recusar: "Não permitir" };
}

/**
 * definido em 2026-09-24 (emenda da ADR-044): o card do acesso que uma rotina pediu diz que ela está
 * PARADA, desde quando, e — na linha de baixo (linhaNaoRodaram) — quais janelas não rodaram sem gastar
 * crédito. Mesmo cabeçalho no card da conversa e em "Sua vez".
 */
export function marcaRotinaParada(proposta: Proposta | null | undefined, parada: Item["rotinaParada"] | undefined, agora: number): string {
  if (!pedidoDeRotina(proposta)) return "";
  const desde = parada ? `<span class="mudo">${esc(desdeDaParada(parada, agora))}</span>` : "";
  return `<span class="tag tag-ambar dec-rotina-parada" title="a rotina não roda até você decidir; nenhuma janela parada gastou crédito">rotina parada</span>${desde}`;
}

/** Os nomes técnicos do pedido existem, mas atrás do disclosure: a frase é o que a pessoa lê. */
export function detalheAcesso(proposta: Proposta | null | undefined): string {
  if (proposta?.payload.kind !== "acesso" || proposta.payload.capacidades.length === 0) return "";
  const c = proposta.payload;
  const n = c.capacidades.length;
  return `<details class="ap-detalhe" data-disclosure="acesso-${esc(proposta.id)}"><summary>${n === 1 ? "Ver a ação pedida" : `Ver as ${n} ações pedidas`}</summary>
    <ul class="acesso-acoes">${c.capacidades.map((cap) => `<li><code>${esc(c.conector)}.${esc(cap)}</code></li>`).join("")}</ul>${c.naoPedido.length ? `<p class="mudo">Não pedido: ${esc(c.naoPedido.join(", "))}</p>` : ""}
  </details>`;
}

/**
 * "no Slack" a partir do slug do destino: `Conector.nome` é o rótulo que a PESSOA deu no registro e
 * já está no estado da web, então a tradução é do cliente e não exige campo novo no DTO. Sem
 * conector casado (slug some do registro, ou destino "computador"), cai no próprio slug — nunca
 * inventa nome.
 */
function ondeAcontece(conectores: Estado["conectores"], slug: string): string {
  if (slug === "computador") return "no computador do bot";
  // ADR-055: o comando roda no terminal do Mac da própria pessoa, com as credenciais dela.
  if (slug === "terminal") return `no terminal do ${seuMac()}`;
  return `no ${conectores.find((c) => c.slug === slug)?.nome ?? slug}`;
}

/** `slack.send_message` + os argumentos como vieram: o jargão fica atrás do disclosure, não some. */
function detalheTecnico(i: Item["itensAprovacao"][number]): string {
  const args = Object.entries(i.destino.argumentos ?? {});
  return `<details class="ap-detalhe"><summary>Ver detalhes</summary>
    <dl><dt>ferramenta</dt><dd>${esc(i.destino.conector)}.${esc(i.destino.ferramenta)}</dd>
    ${args.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(typeof v === "string" ? v : JSON.stringify(v))}</dd>`).join("")}</dl>
    <input class="texto-final" data-item-texto="${esc(i.id)}" value="${esc(i.textoFinal)}" aria-label="Editar o texto antes de enviar" ${i.destino.conector === "computador" ? 'readonly title="Ação vinculada à tela observada; para mudar, recuse e peça uma nova ação."' : i.destino.conector === "terminal" ? 'readonly title="Aprova-se exatamente este comando; para mudar, recuse e diga ao bot o que quer."' : ""} />
  </details>`;
}

/**
 * "Sempre permitir" (ADR-042): aprova agora e grava a regra para as próximas vezes. NUNCA some do
 * card — quando algo impede, aparece desabilitado com o motivo, porque botão ausente é
 * indistinguível de bug (ADR-029). Item sensível e destino 'computador' não entram na regra: o
 * primeiro porque o CHECK do banco recusaria honrá-la, o segundo porque a aprovação é vinculada à
 * ação cifrada (ADR-037). A regra vale para a FERRAMENTA inteira, qualquer destino — o título diz.
 * Aprovar PR e merge também não (definido em 2026-09-24, ADR-047): o servidor manda os ids em
 * `nuncaPermanente`, porque a lista mora no domínio e a web só importa tipos.
 *
 * definido em 2026-09-30 (ADR-062, auditoria das aprovações): também desabilita quando o item parou por um motivo
 * que regra nenhuma pula — a rotina que pede aprovação, a tarefa que leu conteúdo de fora, a ferramenta fora do
 * alcance. O botão ligado ali gravava a regra, e o card seguinte aparecia igual: "cliquei em Sempre e continua".
 */
const REGRA_NAO_PULA: Partial<Record<NonNullable<Item["itensAprovacao"][number]["motivoManual"]>, string>> = {
  gate_de_rotina: "A rotina de onde isto veio pede a sua aprovação antes de agir fora, e uma regra não pula esse pedido.",
  regra_suspensa_conteudo_nao_confiavel: "Nesta tarefa o bot leu conteúdo de fora (web, e-mail, GitHub): até ela acabar, o que altera algo passa por você, com regra ou sem.",
  fora_do_catalogo: "Esta ferramenta não está no alcance do bot agora (app desligado ou sem acesso); uma regra não vale para ela.",
  sem_plano: "Esta ação chegou sem o plano do turno, então não há regra que se aplique a ela.",
};

/**
 * O item veio do revisor do Automático e "Sempre permitir" não serve nele (definido em 2026-10-19, decisão 8 do Marlon;
 * PR 5 dos modos de aprovação): o servidor grava `sempreServe` no item (só o apagar de app num turno limpo); a tela não
 * recalcula. Nesses itens o botão nem aparece — só Pode fazer e Agora não.
 */
export function revisorSemSempre(i: Pick<Item["itensAprovacao"][number], "motivoManual" | "sempreServe">): boolean {
  return (i.motivoManual === "revisor_pediu" || i.motivoManual === "revisor_falhou") && i.sempreServe !== true;
}

function botaoSempre(item: Item, conectores: Estado["conectores"]): string {
  if (item.itensAprovacao.length > 0 && item.itensAprovacao.every(revisorSemSempre)) return "";
  const nunca = new Set(item.nuncaPermanente ?? []);
  const viram = item.itensAprovacao.filter((i) => !i.origemSensivel && i.destino.conector !== "computador" && i.destino.conector !== "terminal" && !nunca.has(i.id) && !revisorSemSempre(i));
  const elegiveis = viram.filter((i) => !(i.motivoManual && REGRA_NAO_PULA[i.motivoManual]));
  const nomes = [...new Set(elegiveis.map((i) => `${i.destino.conector}.${i.destino.ferramenta}`))];
  if (nomes.length === 0) {
    const travado = viram.find((i) => i.motivoManual && REGRA_NAO_PULA[i.motivoManual]);
    const motivo = travado?.motivoManual
      ? (REGRA_NAO_PULA[travado.motivoManual] ?? "")
      : item.itensAprovacao.some((i) => i.destino.conector === "computador")
      ? "Ação no computador é aprovada uma a uma: ela está presa à tela que o bot observou."
      : item.itensAprovacao.some((i) => i.destino.conector === "terminal")
        ? `Comando ${noSeuMac()} é aprovado um a um. Para não repetir nesta tarefa, use "Pode fazer e o resto desta tarefa".`
      : item.itensAprovacao.some((i) => nunca.has(i.id))
        ? "Aprovar ou fazer merge de PR sempre passa por você — não dá para permitir de uma vez."
        : "Dado pessoal sempre passa por você — não dá para permitir de uma vez.";
    return botao("decidir-aprovacao-sempre", "Sempre permitir", { id: item.decisao.id, desabilitado: true, titulo: motivo });
  }
  const unicaAcao = elegiveis[0];
  const comNome = nomes.map((n) => {
    const [slug = "", ferramenta = ""] = n.split(".");
    const conector = conectores.find((c) => c.slug === slug)?.nome ?? slug;
    return `${ferramenta} no ${conector}`;
  });
  const rotulo = nomes.length === 1 && unicaAcao ? `Sempre permitir ${esc(acaoHumana(conectores, unicaAcao.destino.conector, unicaAcao.destino.ferramenta))}` : `Sempre permitir estas ${nomes.length} ferramentas`;
  return botao("decidir-aprovacao-sempre", rotulo, {
    id: item.decisao.id,
    titulo: `Vale já para ${comNome.join(" e ")}, em qualquer destino, enquanto o bot não tiver lido conteúdo de fora na tarefa.`,
  });
}

/**
 * O que a regra "Sempre permitir" libera, em português (definido em 2026-10-03, canvas "Uma conversa de verdade ·
 * depois"): o botão mostrava o slug cru ("Sempre permitir googlesheets.update_values"). O grupo da ação chega pronto
 * de GET /conectores (`grupo`, src/domain/grupos-de-acesso.ts); sem ele, o nome da ferramenta sem os sublinhados.
 * O slug continua no título e no "Ver detalhes".
 */
const VERBO_DO_GRUPO: Record<IdGrupo, string> = { ler: "ler", criar: "criar e enviar", alterar: "editar", comentar: "comentar", outras: "usar", apagar: "apagar" };

export function acaoHumana(conectores: Estado["conectores"], slug: string, ferramenta: string): string {
  const conector = conectores.find((c) => c.slug === slug);
  const grupo = conector?.catalogo.find((c) => c.nome === ferramenta)?.grupo;
  const verbo = grupo && grupo !== "outras" ? VERBO_DO_GRUPO[grupo] : ferramenta.replaceAll("_", " ");
  return `${verbo} no ${conector?.nome ?? slug}`;
}

/** Linhas da prévia antes do "e mais N" (definido em 2026-10-03): o card não vira a planilha inteira. */
const LINHAS_DA_PREVIA = 8;

/**
 * "O que vai ser enviado" (definido em 2026-10-03): os argumentos da ferramenta, que só existiam atrás do "Ver
 * detalhes", em forma legível — uma matriz (valores de planilha) vira tabela; texto, número e sim/não viram linhas
 * rotuladas. O que não cabe nisso (objetos aninhados, ids longos) continua só no "Ver detalhes".
 */
export function previaDoItem(i: Pick<Item["itensAprovacao"][number], "destino">): string {
  const args = Object.entries(i.destino.argumentos ?? {});
  const matriz = args.map(([, v]) => v).find((v): v is unknown[][] => Array.isArray(v) && v.length > 0 && v.every((l) => Array.isArray(l)));
  const celula = (v: unknown): string => esc(typeof v === "string" ? v : v === null || v === undefined ? "" : JSON.stringify(v));
  if (matriz) {
    const linhas = matriz.slice(0, LINHAS_DA_PREVIA).map((l) => `<tr>${l.map((v) => `<td>${celula(v)}</td>`).join("")}</tr>`).join("");
    const resto = matriz.length - LINHAS_DA_PREVIA;
    return `<div class="aprov-previa"><div class="aprov-previa-cab">O que vai ser enviado</div><div class="md-tabela"><div class="md-tabela-rolagem"><table><tbody>${linhas}</tbody></table></div>${resto > 0 ? `<div class="aprov-previa-mais">e mais ${resto} ${resto === 1 ? "linha" : "linhas"}</div>` : ""}</div></div>`;
  }
  const simples = args.filter(([, v]) => (typeof v === "string" && v.length > 0 && v.length <= 400) || typeof v === "number" || typeof v === "boolean").slice(0, 6);
  if (simples.length === 0) return "";
  return `<div class="aprov-previa"><div class="aprov-previa-cab">O que vai ser enviado</div><dl class="aprov-campos">${simples.map(([k, v]) => `<dt>${esc(k.replaceAll("_", " "))}</dt><dd>${celula(v)}</dd>`).join("")}</dl></div>`;
}

/**
 * NOD-443 (revisão 7 do PR #628, achado 4; ADR-143): o pedido que veio de quem participa do quadro (o bot da dona sob a
 * procuração dela) diz de quem é, como a assinatura "Vera · por Ana" (web/lib/assinatura.ts). Sem isso, a dona aprovava
 * um app dela achando que o pedido era dela.
 */
export function aPedidoDe(item: Pick<Item, "aPedidoDe">): string {
  return item.aPedidoDe ? `<span class="aprov-pedido-de">· a pedido de ${esc(item.aPedidoDe)}</span>` : "";
}

/**
 * O card da aprovação (definido em 2026-10-03, canvas "Uma conversa de verdade · depois"; revisto no mesmo dia para a
 * lista): no desenho do cartão de atividade — quem pede e há quanto, a frase, ONDE (o app como chip), o que vai
 * acontecer, os botões e, no rodapé, o prazo. Saem a tag "aprovação em lista" e a borda âmbar: o ponto âmbar já diz
 * que espera você, e a lista com borda lateral parecia de outra plataforma. Um item comum mostra a prévia do que vai
 * ser enviado; vários (ou um de origem sensível, que nasce desmarcado) viram linhas marcáveis no mesmo card. Mantém
 * `data-decisao`, `data-item`, `data-contador` e o input do texto final, que main.ts lê.
 */
function renderCardAprovacao(item: Item, estado: Estado): string {
  const d = item.decisao;
  const conectores = estado.conectores;
  const revisor = estado.frota?.revisor === true;
  const itens = item.itensAprovacao;
  const unico = itens.length === 1 && itens[0] && !itens[0].origemSensivel ? itens[0] : undefined;
  const slugs = [...new Set(itens.map((i) => i.destino.conector))];
  const umApp = slugs.length === 1 ? slugs[0] : undefined;
  const chip = (slug: string): string => {
    const app = conectores.find((c) => c.slug === slug)?.nome ?? slug;
    return slug === "computador" || slug === "terminal" ? esc(ondeAcontece(conectores, slug)) : `em <span class="lk-chip aprov-app">${logoApp(estado, slug, app)}<span>${esc(app)}</span></span>`;
  };
  const marcados = itens.filter((i) => i.selecionado).length;
  const contagem = !unico && (itens.some((i) => i.origemSensivel) || marcados !== itens.length);
  const rotulo = contagem ? `Pode fazer <span data-contador>${marcados}</span> de ${itens.length}` : "Pode fazer";
  const naMaquina = unico && (unico.destino.conector === "computador" || unico.destino.conector === "terminal");
  const resto = naMaquina ? botao("decidir-aprovacao-resto", "Pode fazer e o resto desta tarefa", { id: d.id }) : "";
  const prazo = `Sem resposta, ${PRAZO_POR_TIPO[d.tipo](emQuanto(item.recusaAutomaticaEmMs), item)}`;
  let corpo: string;
  if (unico) {
    const acao = unico.destino.conector === "terminal"
      ? `<pre class="ap-comando"><code>${esc(unico.textoFinal)}</code></pre>`
      : unico.destino.conector === "computador" && unico.textoFinal.trim() !== d.frase.trim() ? `<div class="ap-oque">${esc(unico.textoFinal)}</div>` : "";
    corpo = `${acao}${previaDoItem(unico)}${porqueDaPausa(unico, revisor)}${tagDesfecho(unico, true)}`;
  } else {
    const linha = (i: Item["itensAprovacao"][number]): string => `<li class="aprov-item${i.origemSensivel ? " sensivel" : ""}">
      <label class="aprov-marca"><input type="checkbox" data-item="${esc(i.id)}" ${i.selecionado ? "checked" : ""} /><span class="aprov-item-txt">${esc(i.textoFinal)}${umApp ? "" : `<small>${esc(ondeAcontece(conectores, i.destino.conector))}</small>`}</span></label>
      ${i.origemSensivel ? `<p class="justificativa">${esc(i.justificativa ?? JUSTIFICATIVA_PADRAO)}</p>` : ""}${porqueDaPausa(i, revisor)}${tagDesfecho(i, true)}${detalheTecnico(i)}
    </li>`;
    corpo = `<ul class="aprov-itens">${itens.map(linha).join("")}</ul>`;
  }
  return `<li class="decisao aprov-card dec-${esc(item.estadoColuna)} tipo-${esc(d.tipo)}" data-decisao="${esc(d.id)}">
    <div class="aprov-cab"><span class="aprov-ponto" aria-hidden="true"></span><b>${esc(item.agenteNome)} precisa do seu ok</b>${aPedidoDe(item)}<span>· ${esc(haQuanto(item.aguardandoHaMs))}</span>${marcaGemeas(item)}${item.estadoColuna === "reaberto" ? '<span class="tag tag-ambar">reaberta</span>' : ""}</div>
    <p class="aprov-titulo dec-frase">${esc(d.frase)}</p>
    ${umApp ? `<div class="aprov-onde">${chip(umApp)}</div>` : ""}
    ${corpo}
    <div class="acoes aprov-acoes">${botao("decidir-aprovacao", rotulo, { classe: "pri", id: d.id })}${resto}${botao("decidir-aprovacao-nenhum", "Agora não", { id: d.id })}${botaoSempre(item, conectores)}</div>
    <div class="aprov-rodape"><span>${esc(prazo)}</span>${unico ? detalheTecnico(unico) : ""}</div>
  </li>`;
}

/**
 * Aprovação em LISTA tipada (E4.1/E4.2) em DUAS densidades pelo número de itens: um item pergunta em
 * uma frase e dispensa a lista (é o caso mais comum); vários mantêm uma linha marcável cada, que é a
 * razão de a aprovação ser em lista. O nome técnico e os argumentos vão para um <details> — o que
 * acrescenta contexto, já que `destino.argumentos` nunca apareceu na tela.
 *
 * A exceção é o item de origem sensível: ele SAI do modo enxuto, nasce DESMARCADO com a
 * justificativa visível, e traz o contador de volta ao botão ("Pode fazer 1 de 2") — só aparece
 * contagem quando ela carrega informação. Marcar um sensível exige a pessoa (CHECK marcado_por).
 */
/**
 * definido em 2026-09-29 (ADR-059): o card que parou mesmo com o bot em aprovação automática diz por quê — senão a
 * pessoa lê "está no automático e mesmo assim pediu" como defeito. Só os motivos em que o modo parou de propósito;
 * a frase do risco no terminal vem do domínio (`comandoArriscado`), gravada em `justificativa`.
 * Emenda de 2026-09-30 (ADR-062): também a trava da rotina e a ferramenta fora do alcance, os motivos que nenhuma
 * regra "Sempre permitir" pula — sem a frase, o card depois do clique parecia a regra falhando.
 */
export function porqueDaPausa(i: Pick<Item["itensAprovacao"][number], "motivoManual" | "justificativa" | "origemSensivel">, revisor = false): string {
  const ic = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>';
  // revisto em 2026-10-26 (PR 4 dos modos de aprovação): "Na aprovação automática, o arriscado sempre pergunta" deixa de
  // ser verdade com o revisor ligado (`FrotaDto.revisor`); aí o cartão diz só o risco. Com a chave desligada, a frase de
  // sempre, que é o que acontece. O revisor_pediu e o revisor_falhou abertos são o cartão compacto (cartao-revisor.ts);
  // estas frases ficam para o lote que não veio inteiro do revisor.
  const frase = i.motivoManual === "acao_arriscada"
    ? `Parou para você: ${!i.origemSensivel && i.justificativa ? `${i.justificativa}.` : "é uma ação arriscada."}${revisor ? "" : " Na aprovação automática, o arriscado sempre pergunta."}`
    : i.motivoManual === "revisor_pediu"
      ? `O revisor pediu o seu ok${i.justificativa ? `: ${i.justificativa}` : "."}`
      : i.motivoManual === "revisor_falhou"
        ? (i.justificativa ?? "O revisor não respondeu; confira você.")
    : i.motivoManual === "toca_credencial"
      ? "Parou para você: toca uma credencial do Mac. Na aprovação automática, a credencial sempre pergunta; a chave do nod, em qualquer modo."
      : i.motivoManual === "regra_suspensa_conteudo_nao_confiavel"
        ? "Parou para você: nesta tarefa o bot leu conteúdo de fora (web, e-mail, GitHub). Até ela acabar, o que altera algo passa por você."
        : i.motivoManual === "gate_de_rotina"
          ? "Parou para você: a rotina de onde isto veio pede a sua aprovação antes de agir fora."
          : i.motivoManual === "fora_do_catalogo"
            ? "Parou para você: esta ferramenta não está no alcance do bot agora (app desligado ou sem acesso)."
            : "";
  return frase ? `<p class="ap-porque">${ic}<span>${esc(frase)}</span></p>` : "";
}

function renderAprovacao(item: Item, aberta: boolean, conectores: Estado["conectores"], revisor = false): string {
  const itens = item.itensAprovacao;
  const marcados = itens.filter((i) => i.selecionado).length;
  const temSensivel = itens.some((i) => i.origemSensivel);
  const linha = (i: Item["itensAprovacao"][number]): string => `<li class="ap-item${i.origemSensivel ? " sensivel" : ""}">
    <label class="ap-marca"><input type="checkbox" data-item="${esc(i.id)}" ${i.selecionado ? "checked" : ""} ${aberta ? "" : "disabled"} /><span class="sr-only">Incluir: ${esc(i.textoFinal)}</span></label>
    <div class="ap-corpo">
      <div class="ap-oque">${esc(i.textoFinal)}</div>
      <div class="ap-onde">${esc(ondeAcontece(conectores, i.destino.conector))}</div>
      ${i.origemSensivel ? `<p class="justificativa">${esc(i.justificativa ?? JUSTIFICATIVA_PADRAO)}</p>` : ""}
      ${aberta ? porqueDaPausa(i, revisor) : ""}
      ${aberta ? detalheTecnico(i) : ""}
      ${tagDesfecho(i, aberta)}
    </div>
  </li>`;
  // Contagem só quando ela informa: com item sensível desmarcado, "1 de 2" é a própria explicação.
  const rotulo = temSensivel || marcados !== itens.length ? `Pode fazer <span data-contador>${marcados}</span> de ${itens.length}` : "Pode fazer";
  const acoes = aberta
    ? `<div class="acoes">${botao("decidir-aprovacao", rotulo, { classe: "pri", id: item.decisao.id })}${botao("decidir-aprovacao-nenhum", "Agora não", { id: item.decisao.id })}${botaoSempre(item, conectores)}</div>`
    : "";
  const unico = itens[0];
  // Um item e nada sensível: a pergunta já está na frase da decisão; a lista seria uma linha só.
  if (itens.length === 1 && unico && !unico.origemSensivel) {
    // definido em 2026-09-24: no computador a frase é genérica ("Ação no computador do bot") e quatro
    // pedidos seguidos pareciam o mesmo; a ação concreta ("Abrir no navegador: …") sai do "Ver
    // detalhes". Só no computador: lá o texto é somente leitura, então o que aparece é o que será feito.
    // ADR-055: o comando do terminal aparece inteiro, em fonte de código — é exatamente o que vai rodar no Mac.
    const acao = unico.destino.conector === "terminal"
      ? `<pre class="ap-comando"><code>${esc(unico.textoFinal)}</code></pre>`
      : unico.destino.conector === "computador" && unico.textoFinal.trim() !== item.decisao.frase.trim() ? `<div class="ap-oque">${esc(unico.textoFinal)}</div>` : "";
    // definido em 2026-09-28 (emenda da ADR-037): numa tarefa no computador cada passo pedia um clique (9 na
    // Ada). Este aprova o passo e libera os próximos DESTA tarefa; o servidor ignora em turno não confiável e
    // em rotina com gate. ADR-055: o mesmo para os comandos no terminal do Mac.
    const resto = unico.destino.conector === "computador" || unico.destino.conector === "terminal" ? botao("decidir-aprovacao-resto", "Pode fazer e o resto desta tarefa", { id: item.decisao.id }) : "";
    return `<div class="ap-unico">
      ${acao}<div class="ap-onde">${esc(ondeAcontece(conectores, unico.destino.conector))}</div>
      ${aberta ? porqueDaPausa(unico, revisor) : ""}
      ${aberta ? detalheTecnico(unico) : ""}
      ${tagDesfecho(unico, aberta)}
    </div>
    ${aberta ? `<div class="acoes">${botao("decidir-aprovacao", "Pode fazer", { classe: "pri", id: item.decisao.id })}${resto}${botao("decidir-aprovacao-nenhum", "Agora não", { id: item.decisao.id })}${botaoSempre(item, conectores)}</div>` : ""}`;
  }
  return `<ul class="ap-lista">${itens.map(linha).join("")}</ul>${acoes}`;
}

function renderAcoes(item: Item, aberta: boolean, estado: Pick<Estado, "conectores" | "marketplace" | "frota" | "sessao">): string {
  const d = item.decisao;
  const conectores = estado.conectores;
  if (!aberta) return d.estado === "vencida" ? `<div class="acoes">${botao("reabrir", "Reabrir", { id: d.id })}</div>` : "";
  switch (d.tipo) {
    case "aprovacao":
    case "gate_rotina":
      return renderAprovacao(item, true, conectores, estado.frota?.revisor === true);
    // definido em 2026-09-24 (ADR-045): quem não quer retomar dispensa — antes o card só saía vencendo.
    case "retomar_turno":
      return `<div class="acoes"><input class="resposta" data-resposta="${esc(d.id)}" placeholder="o que mudou (opcional)" />${botao("retomar", "Retomar com turno novo", { classe: "pri", id: d.id })}${botao("dispensar", "Dispensar", { id: d.id, titulo: "Tirar da tela sem retomar" })}</div>`;
    case "acesso": {
      const r = rotulosAcesso(item.proposta);
      // revisto em 2026-09-25 (revisão do PR #68): os mesmos grupos do card do chat — sem eles, "Sua vez" (e o
      // aviso no Mac) concedia o pedido inteiro num clique, sem como estreitar.
      const p = item.proposta?.payload.kind === "acesso" ? item.proposta.payload : null;
      const catalogo = p ? conectores.find((c) => c.slug === p.conector && c.habilitado)?.catalogo ?? [] : [];
      const grupos = p ? checkboxesDosGrupos(catalogo, p.capacidades) : "";
      return `${grupos}<div class="acoes">${botao("permitir-acesso", r.permitir, { classe: "pri", id: d.id })}${botao("recusar-decisao", r.recusar, { id: d.id })}</div>`;
    }
    // definido em 2026-09-24 (emenda da ADR-044, "rotina nasce com o acesso"): a rotina que declara acessos
    // diz no botão que confirmar também libera; app por conectar vem primeiro (web/telas/rotina-precisa.ts).
    case "rotina": {
      const comAcesso = acoesComAcesso(item.proposta, estado, { confirmar: "decidir-proposta", recusar: "recusar-decisao", rotuloRecusar: "Deixar de lado" });
      if (comAcesso) return `<div class="acoes">${comAcesso.botoes}</div>${comAcesso.ajuda}`;
      return `<div class="acoes">${botao("decidir-proposta", "Confirmar", { classe: "pri", id: d.id })}${botao("recusar-decisao", "Recusar", { id: d.id })}</div>`;
    }
    case "perfil":
      return `<div class="acoes">${botao("decidir-proposta", "Confirmar", { classe: "pri", id: d.id })}${botao("recusar-decisao", "Recusar", { id: d.id })}</div>`;
    // definido em 2026-10-04 (ADR-077): o primeiro bot que a Nina propõe no onboarding nasce pela mesma decisão.
    case "bot":
      return `<div class="acoes">${botao("decidir-proposta", "Criar bot", { classe: "pri", id: d.id })}${botao("recusar-decisao", "Recusar", { id: d.id })}</div>`;
    case "rotina_atualizacao": {
      const comAcesso = acoesComAcesso(item.proposta, estado, { confirmar: "decidir-proposta", recusar: "recusar-decisao", rotuloRecusar: "Manter como está" });
      if (comAcesso) return `<div class="acoes">${comAcesso.botoes}</div>${comAcesso.ajuda}`;
      return `<div class="acoes">${botao("decidir-proposta", "Aplicar mudança", { classe: "pri", id: d.id })}${botao("recusar-decisao", "Manter como está", { id: d.id })}</div>`;
    }
    // definido em 2026-10-07 (ADR-082): o lote do Nod. Aqui aprova tudo de uma vez; para desmarcar uma ação, o card da
    // conversa do Nod tem as caixas.
    case "lote_bots": {
      const p = item.proposta?.payload.kind === "lote_bots" ? item.proposta.payload : null;
      const n = p ? p.acoes.filter((a) => a.estado === "esperando").length : 0;
      return `${p ? listaDoLoteParaSuaVez(p) : ""}<div class="acoes">${botao("decidir-proposta", n > 1 ? `Aprovar as ${n}` : "Aprovar", { classe: "pri", id: d.id })}${botao("recusar-decisao", "Recusar", { id: d.id })}</div>`;
    }
    // NOD-448 (ADR-140): a ordem nova à vista antes do clique.
    case "colunas_quadro": {
      const p = item.proposta?.payload.kind === "colunas_quadro" ? item.proposta.payload : null;
      return `${p ? listaDasColunasParaSuaVez(p) : ""}<div class="acoes">${botao("decidir-proposta", "Trocar colunas", { classe: "pri", id: d.id })}${botao("recusar-decisao", "Manter", { id: d.id })}</div>`;
    }
    // NOD-422: a mesma prévia do card da conversa (as linhas e o mapa das colunas) antes do Trazer.
    case "importacao_linear": {
      const p = item.proposta?.payload.kind === "importacao_linear" ? item.proposta.payload : null;
      return `${p ? previaParaSuaVez(p) : ""}<div class="acoes">${botao("decidir-proposta", "Trazer", { classe: "pri", id: d.id })}${botao("recusar-decisao", "Agora não", { id: d.id })}</div>`;
    }
    // NOD-422 (PR 2): a lista das rotinas que pausam antes do Assumir.
    case "assumir_quadro": {
      const p = item.proposta?.payload.kind === "assumir_quadro" ? item.proposta.payload : null;
      return `${p ? previaAssumirParaSuaVez(p) : ""}<div class="acoes">${botao("decidir-proposta", "Assumir", { classe: "pri", id: d.id })}${botao("recusar-decisao", "Agora não", { id: d.id })}</div>`;
    }
    // NOD-445: o card Criar app (o Ajustar é pela conversa): o nome, a forma e o bot que ganha a página.
    case "app": {
      const p = item.proposta?.payload.kind === "app" ? item.proposta.payload : null;
      return `${p ? `<p class="mini">${esc(p.nome)} · ${esc(p.forma)} · em ${esc(p.alvoNome)}</p>` : ""}<div class="acoes">${botao("decidir-proposta", "Criar", { classe: "pri", id: d.id })}${botao("recusar-decisao", "Agora não", { id: d.id })}</div>`;
    }
    // NOD-430: o mesmo verbo do card da conversa; não tem Desfazer. Sutil como ele (pedido da Ada, revisão 1 do PR #627):
    // botão neutro com só o verbo em vermelho (`danger`), sem o botão cheio (`pri`).
    case "quadro_exclusao":
      return `<p class="p50-para">Não dá para desfazer.</p><div class="acoes">${botao("decidir-proposta", "Excluir", { classe: "danger", id: d.id })}${botao("recusar-decisao", "Agora não", { id: d.id })}</div>`;
    // Verbo próprio: "Confirmar" não diz que o que se confirma é uma exclusão.
    case "rotina_exclusao":
      return `<div class="acoes">${botao("decidir-proposta", "Excluir rotina", { classe: "pri", id: d.id })}${botao("recusar-decisao", "Manter rotina", { id: d.id })}</div>`;
    // NOD-50: o mesmo cartão da conversa — guardar daqui vai pelo mesmo POST, direto ao cofre.
    case "credencial":
      // Só a dona do pedido guarda ou recusa (a rota devolve nao_encontrado às outras): a quem só vê, nada de campo de chave.
      if (d.ownerId !== estado.sessao?.pessoaId) return `<p class="p50-para">Só quem pediu pode colar esta chave.</p>`;
      return ehCartaoCredencial(item.proposta) ? renderCardCredencial(item.proposta, item.agenteNome, "sv") : `<div class="acoes">${botao("recusar-credencial", "Deixar de lado", { id: d.id })}</div>`;
    // As três de pedir_a_pessoa viram o cartão da pergunta (renderItemPergunta, plano "pergunta com botões", Parte 4).
    case "pergunta":
    case "falta_de_dado":
    case "permissao":
      return "";
  }
}

/**
 * Espelho EXATO de `podeDispensar` (src/use-cases/dispensar-decisao.ts) — a web só importa tipos de
 * src/. Vencida sai sempre; aberta, só TIPOS_DISPENSAVEIS_ABERTOS (as outras têm recusar próprio). Lê
 * o ESTADO, não a coluna: com o prazo estourado e o varredor ainda por passar (até 30 s) a coluna já
 * diz "vencido", mas o servidor recusaria (409) uma aprovação aberta — e "Limpar vencidos" pararia no
 * meio. As chaves do Record são exatamente as do contrato: faltar ou sobrar um tipo não compila.
 */
const DISPENSAVEIS_ABERTOS: Record<(typeof TIPOS_DISPENSAVEIS_ABERTOS)[number], true> = { pergunta: true, falta_de_dado: true, permissao: true, retomar_turno: true };

function dispensavel(item: Item): boolean {
  const d = item.decisao;
  return d.estado === "vencida" || ((d.estado === "pendente" || d.estado === "reaberta") && d.tipo in DISPENSAVEIS_ABERTOS);
}

/**
 * A origem genérica do turno que perguntou (plano "pergunta com botões", Parte 4; decisão 7): "rotina", "pedido de outro
 * bot". Nome e hora ("rotina das 8h", "pedido do Milton") ficam para depois — custam a cadeia de rotinaDoTurno por item.
 */
const ORIGEM_DA_PERGUNTA: Partial<Record<NonNullable<NonNullable<Item["pedido"]>["origem"]>, string>> = { rotina: "rotina", peer: "pedido de outro bot", delegacao: "pedido de outro bot", sala: "sala", ligacao: "ligação" };

/** "Posso arquivar o PR 7?": a fala do bot; sem balão legível, a frase da fila (sem o molde antigo "parei para perguntar a X:"). */
function falaDaPergunta(item: Item): string {
  return item.pedido?.texto ?? item.decisao.frase.replace(/^parei para perguntar a [^:]+:\s*/u, "");
}

/**
 * A pergunta em "Sua vez" (definido em 2026-10-18, plano "pergunta com botões", Parte 4; tela "Sua vez com botões"): o
 * cabeçalho com o avatar, o nome, "há N", a origem e "Abrir conversa", e embaixo o MESMO cartão da conversa, clicável,
 * respondendo por `responder`. Sem opções, o campo de resposta dentro do cartão, para todas — desfaz a regra de 24/09
 * (emenda da ADR-045) de não ter segunda caixa de texto na lista. A decisora designada que não é dona da conversa não lê
 * o balão (RLS de mensagens): vê a frase (desde a Parte 1, a fala do bot) e o campo, sem opções nem "Abrir conversa".
 * Saíram a etiqueta âmbar, o "vence em" (o prazo de 24 h continua, como ordem da fila) e "Responder na conversa". Da 2ª
 * rodada, "2ª rodada" ao lado de "Abrir conversa": a explicação do bot está na conversa.
 */

/** O ↑ redondo do campo do cartão (tela S4 do protótipo, QA do PR #389): o mesmo envio do campo da conversa, sem a palavra. */
const SETA_ENVIAR = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
function renderItemPergunta(item: Item, estado: Estado): string {
  const d = item.decisao;
  const aberta = item.estadoColuna !== "vencido";
  const daMinhaConversa = d.ownerId === estado.sessao?.pessoaId;
  const agente = estado.frota?.agentes.find((a) => a.id === d.agenteId);
  const pedido = item.pedido ?? null;
  const opcoes = pedido?.opcoes ?? [];
  const origem = pedido?.origem ? ORIGEM_DA_PERGUNTA[pedido.origem] : undefined;
  const rodada = item.fio?.rodada ?? 1;
  // "Abrir conversa" abre já apontando o campo para ESTA pergunta (com duas ou mais abertas, a caixa "Respondendo" mostra).
  const abrir = daMinhaConversa && agente ? botao("responder-na-conversa", "Abrir conversa", { classe: "link sm", id: d.id, dados: { conversa: d.conversaId, agente: d.agenteId } }) : "";
  const cab = `<div class="sv-cab">${agente ? iconeAgente(agente, "sm") : ""}<span class="sv-quem"><b>${esc(item.agenteNome)}</b> ${esc(haQuanto(item.aguardandoHaMs))}${origem ? ` · ${esc(origem)}` : ""}</span><span class="sv-acoes">${rodada > 1 ? `<span class="sv-rodada">${rodada}ª rodada</span>` : ""}${abrir}</span></div>`;
  const campo = `<div class="pq-campo"><input class="resposta" data-resposta="${esc(d.id)}" placeholder="${esc(`Responder à ${item.agenteNome}`)}" aria-label="Sua resposta" autocomplete="off" />${botao("responder", SETA_ENVIAR, { classe: "pri pq-enviar", id: d.id, aria: "Enviar resposta", titulo: "Enviar" })}</div>`;
  const ajuda = pedido?.ajudaDoComputador === true;
  const extra = ajuda
    ? (daMinhaConversa ? `<div class="pq-acoes">${botao("abrir-computador", "Assumir controle", { classe: "sm", id: d.agenteId })}</div>` : "")
    : opcoes.length === 0 ? campo : "";
  const situacao = aberta
    ? { tipo: "aberta" as const, rodape: null, ocupado: estado.ocupado, extra }
    : { tipo: "vencida" as const, linha: `Sem resposta · ${rotuloVencido(d, estado.agora)}`, reabrir: d.estado === "vencida", dispensar: dispensavel(item) };
  const cartao = renderCartaoPergunta({ decisaoId: d.id, titulo: falaDaPergunta(item), opcoes, recomendada: pedido?.recomendada === 0, rodada: 1, situacao, nome: item.agenteNome });
  return `<li class="item-pergunta dec-${esc(item.estadoColuna)}" data-decisao="${esc(d.id)}">${cab}${cartao}</li>`;
}

/**
 * O cartão compacto do revisor (PR 4 dos modos de aprovação, tela A3): os dados com os ajudantes da fila. No terminal, o
 * comando inteiro em "ver comando"; no app, a prévia do que vai ser enviado e o nome técnico em "ver detalhes". Em "Sua
 * vez", quem pede e "abrir conversa"; na conversa, o cartão fica embaixo da fala e dispensa os dois.
 */
function renderCartaoDoRevisor(item: Item, estado: Estado, naConversa: boolean): string {
  const d = item.decisao;
  const itens = item.itensAprovacao;
  const unico = itens.length === 1 ? itens[0] : undefined;
  const noTerminal = unico?.destino.conector === "terminal";
  const doApp = (i: Item["itensAprovacao"][number]): string => `<div class="cr-item"><div class="cr-item-txt">${esc(i.textoFinal)}<small>${esc(ondeAcontece(estado.conectores, i.destino.conector))} · ${esc(i.destino.conector)}.${esc(i.destino.ferramenta)}</small></div>${previaDoItem(i)}</div>`;
  const detalhe = noTerminal && unico
    ? { rotulo: "ver comando", html: `<pre class="ap-comando"><code>${esc(unico.textoFinal)}</code></pre>` }
    : { rotulo: itens.length > 1 ? `ver as ${itens.length} ações` : "ver detalhes", html: itens.map(doApp).join("") };
  const servem = sempreNoCartao(item);
  const nomes = [...new Set(servem.map((i) => acaoHumana(estado.conectores, i.destino.conector, i.destino.ferramenta)))];
  const sempre = servem.length ? { titulo: `Vale já para ${nomes.join(" e ")}, em qualquer destino, enquanto o bot não tiver lido conteúdo de fora na tarefa.` } : null;
  const agente = estado.frota?.agentes.find((a) => a.id === d.agenteId);
  const cabecalho = naConversa ? undefined : `<div class="cr-cab"><b>${esc(item.agenteNome)}</b>${aPedidoDe(item)}<span>· ${esc(haQuanto(item.aguardandoHaMs))}</span>${marcaGemeas(item)}</div>`;
  const rodape = !naConversa && agente ? `<div class="cr-rodape">${botao("abrir-conversa", "abrir conversa", { classe: "link", dados: { conversa: d.conversaId, agente: d.agenteId } })}</div>` : undefined;
  // Revisão 8 do PR #628: na conversa não há cabeçalho; o "a pedido de" vai no corpo, senão a dona não sabe de quem é.
  const pedidoDe = naConversa && item.aPedidoDe ? { aPedidoDe: item.aPedidoDe } : {};
  return renderCartaoRevisor({ decisaoId: d.id, ...perguntaDoCartao(d.frase, itens), motivo: motivoDoCartao(itens), detalhe, sempre, ...(cabecalho ? { cabecalho } : {}), ...(rodape ? { rodape } : {}), ...pedidoDe }, item.estadoColuna);
}

function renderItem(item: Item, estado: Estado, naConversa = false): string {
  const d = item.decisao;
  const aberta = item.estadoColuna !== "vencido";
  if (ehPergunta(d.tipo)) return renderItemPergunta(item, estado);
  if (aberta && d.tipo === "aprovacao" && ehCartaoDoRevisor(item.itensAprovacao)) return renderCartaoDoRevisor(item, estado, naConversa);
  if (aberta && d.tipo === "aprovacao" && item.itensAprovacao.length > 0) return renderCardAprovacao(item, estado);
  const relogio = aberta ? `aguardando ${haQuanto(item.aguardandoHaMs)} · ${PRAZO_POR_TIPO[d.tipo](emQuanto(item.recusaAutomaticaEmMs), item)}` : rotuloVencido(d, estado.agora);
  const parada = d.tipo === "acesso" && aberta ? { marca: marcaRotinaParada(item.proposta, item.rotinaParada, estado.agora), linha: linhaNaoRodaram(item.rotinaParada, estado.agora) } : { marca: "", linha: "" };
  // O "Retomar" aberto já tem "Dispensar" nas ações: o × repetiria o mesmo gesto no mesmo card.
  const fechar = dispensavel(item) && !(aberta && d.tipo === "retomar_turno") ? botao("dispensar", "×", { classe: "dec-fechar", id: d.id, titulo: "Tirar da tela", aria: "Dispensar este pedido" }) : "";
  const conversa = estado.frota?.agentes.find((a) => a.id === d.agenteId);
  return `<li class="decisao dec-${esc(item.estadoColuna)} tipo-${esc(d.tipo)}" data-decisao="${esc(d.id)}">
    <div class="dec-cab"><span class="tag ${aberta ? "tag-ambar" : "tag-cinza"}">${esc(d.tipo === "aprovacao" && item.itensAprovacao.length === 1 ? "aprovação" : TIPO_HUMANO[d.tipo])}</span>${parada.marca}${marcaGemeas(item)}<b>${esc(item.agenteNome)}</b>${aPedidoDe(item)}<span class="mudo">${esc(relogio)}</span>${item.estadoColuna === "reaberto" ? '<span class="tag tag-ambar">reaberta</span>' : ""}${fechar}</div>
    <div class="dec-frase">${esc(d.frase)}</div>${parada.linha}
    ${d.tipo === "acesso" && aberta ? detalheAcesso(item.proposta) : ""}
    ${(d.tipo === "rotina" || d.tipo === "rotina_atualizacao") && aberta ? linhasPrecisa(item.proposta, estado) : ""}
    ${d.tipo === "aprovacao" && !aberta ? renderAprovacao(item, false, estado.conectores) : ""}
    ${renderAcoes(item, aberta, estado)}
    ${!naConversa && conversa ? `<div class="dec-rodape">${botao("abrir-conversa", "abrir conversa", { classe: "sm", dados: { conversa: d.conversaId, agente: d.agenteId } })}</div>` : ""}
  </li>`;
}

/**
 * Decisões abertas por agente (definido em 2026-09-18): o sinal que substitui a entrada "Sua vez" no
 * rail. A fila global deixou de ser porta de entrada — quem decide é a conversa
 * (`renderDecisoesDaConversa`), então o que falta é LEMBRAR onde há decisão parada. Vencida não conta:
 * ela não pede ação, e um badge que nunca zera deixa de ser sinal. Conta GRUPOS (definido em
 * 2026-09-24): o servidor já dobra os pedidos iguais num item "×N" (montarFila), e aviso de queda
 * (`incidentes`) não é decisão. Pergunta também não entra aqui (emenda da ADR-045): ela tem o selo
 * próprio, `perguntasPorAgente`.
 */
export function abertasPorAgente(estado: Estado): Map<string, number> {
  return contarAbertas(estado, (tipo) => !ehPergunta(tipo));
}

/**
 * Perguntas abertas por agente (definido em 2026-09-24, emenda da ADR-045): o ponto azul do mascote na
 * barra lateral e o subtítulo "esperando sua resposta" — separados do ponto âmbar das decisões, porque
 * pergunta se responde conversando e decisão se decide num botão.
 */
export function perguntasPorAgente(estado: Estado): Map<string, number> {
  return contarAbertas(estado, ehPergunta);
}

/** definido em 2026-09-24 (fio da pergunta): conta FIOS — as rodadas de uma pergunta são uma espera só. */
function contarAbertas(estado: Estado, conta: (tipo: TipoDecisao) => boolean): Map<string, number> {
  const fios = new Map<string, Set<string>>();
  for (const item of estado.suaVez?.itens ?? []) {
    if (item.estadoColuna === "vencido" || !conta(item.decisao.tipo)) continue;
    fios.set(item.decisao.agenteId, (fios.get(item.decisao.agenteId) ?? new Set<string>()).add(chaveDoItem(item)));
  }
  return new Map([...fios].map(([agenteId, chaves]) => [agenteId, chaves.size]));
}

/** O subtítulo do agente que perguntou, no lugar do título (definido em 2026-09-24, emenda da ADR-045). */
export const SUBTITULO_ESPERANDO = '<span class="sub-esperando">esperando sua resposta</span>';

/**
 * definido em 2026-09-24 (emenda da ADR-044): o agente com uma rotina parada por falta de acesso — um
 * pedido de acesso ABERTO que veio de rotina — diz "rotina parada" em âmbar no lugar do título. Vencido
 * não conta: o vencimento já pausou a rotina, e a lista de rotinas diz "pausada".
 */
export function rotinasParadasPorAgente(estado: Estado): ReadonlySet<string> {
  return new Set((estado.suaVez?.itens ?? []).filter((i) => i.estadoColuna !== "vencido" && pedidoDeRotina(i.proposta)).map((i) => i.decisao.agenteId));
}

export const SUBTITULO_ROTINA_PARADA = '<span class="sub-rotina-parada">rotina parada</span>';

const SINO = '<svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 11V7a4 4 0 0 1 8 0v4l1 1.5H3z"/><path d="M6.5 14a1.6 1.6 0 0 0 3 0"/></svg>';

/**
 * Sino ao lado do título da sidebar: some quando não há nada aberto. definido em 2026-09-24 (revisão da
 * interface): substituiu a faixa âmbar, que ocupava o topo da lista inteira; o ponto do mascote na
 * linha do agente continua dizendo QUEM espera. Um pedido: o sino leva à conversa dele (`itens` já vem ordenado
 * pelo servidor, ADR-007). Vários: leva à fila completa e mostra a contagem. Conta "pedidos" —
 * decisões e perguntas —, porque as duas esperam pela pessoa (emenda da ADR-045).
 */
export function renderChamada(estado: Estado): string {
  // definido em 2026-09-24 ("aviso no Mac"): a mesma lista que o número do Dock conta (web/lib/avisos.ts).
  const abertos = pedidosAbertos(estado.suaVez);
  const primeiro = abertos[0];
  if (!primeiro) return "";
  const d = primeiro.decisao;
  if (abertos.length === 1) {
    const texto = `${primeiro.agenteNome} precisa de você`;
    return `<button type="button" class="sino" data-act="abrir-conversa" data-conversa="${esc(d.conversaId)}" data-agente="${esc(d.agenteId)}" aria-label="${esc(texto)}" title="${esc(texto)}">${SINO}<span class="sino-ponto" aria-hidden="true"></span></button>`;
  }
  const texto = `${abertos.length} pedidos esperando por você`;
  return `<button type="button" class="sino" data-act="navegar" data-tela="sua-vez" aria-label="${esc(texto)}" title="${esc(texto)}">${SINO}<span class="sino-cont" aria-hidden="true">${abertos.length}</span></button>`;
}

const plural = (n: number, um: string, varios: string): string => `${n} ${n === 1 ? um : varios}`;

/**
 * A frase do aviso de queda (ADR-045). Não é decisão: diz o que aconteceu, o que NÃO foi feito e o que
 * segue sozinho. Rotina interrompida não se retoma (a próxima janela roda); conversa tem o seu Retomar.
 */
export function fraseDoIncidente(i: SuaVezDto["incidentes"][number]): string {
  // definido em 2026-10-09: a queda da VM do motor (ADR-090) nomeia a máquina; "Seu Mac" é só do Mac.
  const quem = i.maquina ? `A máquina ${i.maquina}` : "Seu Mac";
  const quando = i.voltouEm === null ? `${quem} está sem contato desde ${hora(i.comecouEm)}.` : `${quem} ficou sem contato entre ${hora(i.comecouEm)} e ${hora(i.voltouEm)}.`;
  const partes = [i.rotinas > 0 ? plural(i.rotinas, "execução de rotina", "execuções de rotina") : "", i.conversas > 0 ? plural(i.conversas, "resposta em conversa", "respostas em conversa") : ""].filter(Boolean);
  if (partes.length === 0) return quando;
  const verbo = i.rotinas + i.conversas === 1 ? "não concluiu" : "não concluíram";
  const deQuem = i.agentes.length ? ` (${i.agentes.join(", ")})` : "";
  const segue = i.rotinas === 0 ? " e dá para retomar pela conversa" : i.conversas === 0 ? " e as próximas seguem agendadas" : ": as rotinas seguem agendadas e a conversa pode ser retomada";
  return `${quando} ${partes.join(" e ")} ${verbo}${deQuem}; nada foi reenviado${segue}.`;
}

/**
 * definido em 2026-09-24 (ADR-045): incidente não é decisão. Um aviso por queda, sob a faixa de
 * decisões e em estilo neutro de STATUS (não o âmbar de "precisa de você"), com "Entendi".
 */
export function renderIncidentes(estado: Estado): string {
  return (estado.suaVez?.incidentes ?? [])
    .map((i) => `<div class="aviso-sistema" role="status" data-incidente="${esc(i.id)}"><span class="av-ic" aria-hidden="true">◑</span><span class="av-txt">${esc(fraseDoIncidente(i))}</span>${botao("dispensar-incidente", "Entendi", { classe: "link sm", id: i.id })}</div>`)
    .join("");
}

/**
 * definido em 2026-09-24: vencidos recolhidos num <details> só, depois dos abertos. medido em
 * 2026-09-24 (tela do dono): uma conversa tinha 15 cards cinza de "turno interrompido" vencidos em
 * volta de 5 abertos. ADR-007 continua valendo: nenhum some — todos ficam lá dentro com o seu
 * Reabrir. "Limpar vencidos" (a partir de dois, #46) fica ao lado do resumo e FORA do <summary>,
 * senão o clique também abriria e fecharia a lista.
 */
function renderVencidos(vencidos: readonly Item[], estado: Estado, naConversa: boolean, chave: string): string {
  const n = vencidos.length;
  if (n === 0) return "";
  const ids = vencidos.filter(dispensavel).map((i) => i.decisao.id);
  const limpar = ids.length > 1 ? botao("limpar-vencidos", `Limpar vencidos (${ids.length})`, { classe: "sm dec-limpar", dados: { ids: ids.join(",") } }) : "";
  return `<div class="dec-vencidos"><details class="dec-vencidos-lista" data-disclosure="vencidos-${esc(chave)}"><summary>${n === 1 ? "1 pedido vencido" : `${n} pedidos vencidos`} · ver</summary><ul class="lista">${vencidos.map((i) => renderItem(i, estado, naConversa)).join("")}</ul></details>${limpar}</div>`;
}

/**
 * Pedidos desta conversa, onde a pessoa decide sem sair do chat. Os pedidos iguais já vêm dobrados pelo
 * servidor num item "×N" (definido em 2026-09-24; antes a web só escondia as gêmeas de acesso e o ⚑
 * continuava contando cada uma); os vencidos ficam recolhidos no fim. Pergunta não vira card aqui
 * (emenda da ADR-045): ela É a fala do agente na conversa, e o balão mostra onde está — aberta,
 * respondida ou vencida com o seu Reabrir (web/telas/pergunta.ts).
 */
export function renderDecisoesDaConversa(estado: Estado, conversaId: string, propostas: ReadonlySet<string>, ancoradas: ReadonlySet<string> = new Set()): string {
  const itens = estado.suaVez?.itens.filter((item) => item.decisao.conversaId === conversaId && !propostas.has(item.decisao.id) && !ehPergunta(item.decisao.tipo)) ?? [];
  if (!itens.length) return "";
  const abertos = itens.filter((item) => item.estadoColuna !== "vencido" && !ancoradas.has(item.decisao.id));
  const pedindo = abertos.length ? `<h2>Preciso da sua decisão para continuar</h2><p>Você pode resolver aqui, sem sair da conversa.</p><ul class="lista">${abertos.map((item) => renderItem(item, estado, true)).join("")}</ul>` : "";
  const vencidos = renderVencidos(itens.filter((item) => item.estadoColuna === "vencido"), estado, true, conversaId);
  if (!pedindo && !vencidos) return "";
  return `<section class="decisoes-chat" aria-label="Decisões nesta conversa">${pedindo}${vencidos}</section>`;
}

/**
 * Os pedidos ABERTOS desta conversa que podem ficar junto do turno que os pediu (definido em 2026-10-03, canvas
 * "Uma conversa de verdade · depois"): no fim da timeline, a aprovação da planilha ficava embaixo de "Na fila",
 * longe da fala que a explicava. Os mesmos filtros de `renderDecisoesDaConversa`; quem não acha âncora volta para lá.
 */
export function pedidosAncoraveis(estado: Estado, conversaId: string, propostas: ReadonlySet<string>): Item[] {
  return estado.suaVez?.itens.filter((item) => item.decisao.conversaId === conversaId && item.estadoColuna !== "vencido" && !propostas.has(item.decisao.id) && !ehPergunta(item.decisao.tipo)) ?? [];
}

/** Um pedido ancorado: o mesmo card da seção, solto logo abaixo da mensagem do turno que o pediu. */
export function renderDecisaoAncorada(item: Item, estado: Estado): string {
  return `<ul class="decisoes-ancoradas" aria-label="Pedido de ${esc(item.agenteNome)}">${renderItem(item, estado, true)}</ul>`;
}

/**
 * "Sua vez" por pessoa (ADR-007): mais antiga no topo, reaberta volta ao topo, vencida em cinza com
 * reabrir e nunca suprimida — recolhida no fim desde 2026-09-24; "Nada esperando por você · última
 * decisão …" quando vazia; motor fora do ar entra como item ESCRITO (E3.3).
 */
export function renderSuaVez(estado: Estado): string {
  const sv = estado.suaVez;
  if (!sv) return `<section class="tela"><header class="tela-cab"><h1>Sua vez</h1></header><p class="mudo">carregando…</p></section>`;
  const fora = sv.foraDoAr.map((f) => `<li class="decisao dec-fora"><span class="tag tag-cinza">fora do ar</span> ${esc(foraDoArDesde(f.nome, f.desde))}</li>`).join("");
  const abertos = sv.itens.filter((i) => i.estadoColuna !== "vencido");
  // O número do título conta fios (definido em 2026-09-24): as rodadas de uma pergunta são uma espera só.
  const esperando = contarFios(abertos);
  return `<section class="tela tela-sua-vez">
    <header class="tela-cab"><h1>Sua vez${esperando ? ` · ${esperando}` : ""}</h1><span class="chip">mais antiga no topo · vencidas recolhidas no fim</span></header>
    ${sv.vazio && sv.foraDoAr.length === 0 ? `<p class="vazio">${esc(nadaEsperando(sv.ultimaDecisaoEm, estado.agora))}</p>` : ""}
    <ul class="lista">${fora}${abertos.map((i) => renderItem(i, estado)).join("")}</ul>
    ${renderVencidos(sv.itens.filter((i) => i.estadoColuna === "vencido"), estado, false, "sua-vez")}
  </section>`;
}
