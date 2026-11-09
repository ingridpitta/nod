import type { Mensagem, PayloadMensagem } from "../../src/contracts/mensagem.ts";
import type { Estado } from "../estado/reducer.ts";
import { botao, esc, hora, paragrafos } from "../lib/render.ts";
import { iconeDaLinha } from "../lib/card-proposta.ts";
import { ondeLegivel } from "./card-pasta.ts";
import { acaoHumana } from "./sua-vez.ts";
import { ehRotinaWebhook, enderecoNoCard, origemDaTela } from "./webhook.ts";

/**
 * O cartão encolhido (definido em 2026-10-18, plano do chat limpo, Parte 3 · 3A, PR 4; protótipo "D3A · Cartão encolhido",
 * escolhido pelo Marlon). Decidido, o cartão de aprovação, proposta, acesso, pasta ou regra encolhe no lugar em vez de
 * sumir e deixar um recibo no fim da conversa: o título do pedido ("Enviar e-mail para Helena Souza · 'Re: Proposta Q4'")
 * e uma linha com o resultado ("Aprovado por você · feito 08:14 ✓", "Recusado por você", "Acesso permitido · Gmail").
 * É o mesmo gesto da pergunta respondida da Fase 2 e usa as classes do cartão dela (`cartao-pergunta respondida`,
 * `pq-escolhida`, `pq-estado`), sem mexer em web/telas/cartao-pergunta.ts.
 *
 * O lugar (a âncora do pedido) é de web/telas/conversa.ts; aqui, o que cada recibo diz. "ver o e-mail" do protótipo fica
 * como "detalhes" (os itens, como o recibo de antes): nenhum conector devolve link hoje (decisão tomada 4). O registro de
 * autorização do acesso e da regra continua legível, em "Ver registro de autorização" (emenda da ADR-044).
 */

/** `ok`: ✓ verde; `falha`: ! em vermelho; `regra`: o cadeado; null (recusa): a linha discreta, sem a caixa. */
export type MarcaDoEncolhido = "ok" | "falha" | "regra" | null;

export type DadosDoEncolhido = {
  /** A decisão ou a proposta: a chave do foco e do anúncio de quem decidiu nesta aba (web/lib/foco-do-encolhido.ts). */
  decisaoId: string;
  titulo: string;
  resultado: string;
  marca: MarcaDoEncolhido;
  /** O que a região `aria-live` da conversa diz quando o cartão nasce de um clique nesta aba ("Aprovado: …"). */
  anuncio: string;
  /** O que abre: os itens da aprovação ou o registro de autorização (`chave` é a do `data-disclosure`). */
  detalhes?: { rotulo: string; html: string; chave: string };
  /** HTML depois da linha do resultado (a pasta: onde fica e "Trocar"). */
  rodape?: string;
};

/** O desenho de cada marca; `null` é a recusa (o traço do protótipo). Só o ícone tem cor: a linha é neutra (NOD-399). */
const MARCA: Record<Exclude<MarcaDoEncolhido, null>, string> = {
  ok: iconeDaLinha("ok"),
  falha: '<svg class="cp-ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="6"/><path d="M8 5v3.6"/><path d="M8 11v.01"/></svg>',
  regra: '<svg class="cp-ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="7.5" width="9" height="6" rx="1.5"/><path d="M5.5 7.5V5.5a2.5 2.5 0 0 1 4.9-.7"/></svg>',
};

/** O leitor de tela ouve o estado depois da linha (a marca é desenho). */
const NOME_DA_MARCA: Record<Exclude<MarcaDoEncolhido, null>, string> = { ok: "feito", falha: "não saiu", regra: "regra" };

/**
 * NOD-399: o card decidido vira UMA linha (`.cp-linha` de web/card-proposta.css): a marca, o resultado ("✓ Confirmado
 * por você") e, depois do separador, o título do pedido, discreto. O que abre (registro, itens) e o rodapé da pasta ficam
 * numa segunda linha (`cp-extra`). O título continua focável (tabindex -1, web/lib/foco-do-encolhido.ts) e dá o nome ao
 * grupo.
 *
 * `mensagemId` é o recibo: o id do título sai dele, e não da decisão, porque "Sempre permitir" grava dois recibos da
 * mesma decisão (o resultado e a regra) e os dois cartões teriam o mesmo `id` no DOM (o `aria-labelledby` de um apontaria
 * o título do outro).
 */
export function renderCartaoEncolhido(d: DadosDoEncolhido, mensagemId: string): string {
  const id = esc(d.decisaoId);
  const titulo = `ce-t-${esc(mensagemId)}`;
  const tipo = d.marca === null ? "recusado" : d.marca;
  const marca = d.marca === null ? iconeDaLinha("recusado") : `${MARCA[d.marca]}`;
  const sr = d.marca === null ? "" : `<span class="sr-only"> (${NOME_DA_MARCA[d.marca]})</span>`;
  const detalhes = d.detalhes ? `<details class="ce-detalhes" data-disclosure="${esc(d.detalhes.chave)}"><summary>${esc(d.detalhes.rotulo)}</summary><div class="ce-corpo">${d.detalhes.html}</div></details>` : "";
  const extra = `${d.rodape ?? ""}${detalhes}`;
  // O título leva tabindex -1: o foco vai para ele quando o cartão nasce de um clique nesta aba (o botão clicado já saiu).
  return `<div class="cp-linha cp-${tipo} cartao-encolhido${extra ? " cp-com-extra" : ""}" role="group" aria-labelledby="${titulo}" data-cartao-encolhido="${id}" data-anuncio="${esc(d.anuncio)}">`
    + `${marca}<span class="cp-texto"><span class="ce-resultado">${esc(d.resultado)}</span>${sr} <span class="cp-sep" aria-hidden="true">·</span> <span class="pq-titulo ce-titulo" id="${titulo}" tabindex="-1">${esc(d.titulo)}</span></span>`
    + (extra ? `<div class="cp-extra">${extra}</div>` : "")
    + "</div>";
}

type Payload<K extends NonNullable<PayloadMensagem>["kind"]> = Extract<PayloadMensagem, { kind: K }>;

const DESFECHO: Record<string, string> = { executado: "feito", retirado_pela_pessoa: "você tirou", sensivel_nao_aprovado: "dado pessoal, não aprovado", falhou_na_execucao: "falhou ao executar", ja_executado: "já feita" };

const maiuscula = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** "por você"; decidido por outra pessoa (a decisora, ADR-007), sem nome: a web só conhece o nome de quem está na sessão. */
function porQuem(m: Mensagem, estado: Estado): string {
  return m.autoria.autor_id === estado.sessao?.pessoaId ? " por você" : "";
}

/** "ler no Gmail e editar no Gmail" vira "ler e editar no Gmail" quando o app é um só. */
function acoesHumanas(estado: Estado, nomes: readonly { slug: string; ferramenta: string }[]): string {
  const frases = [...new Set(nomes.map((n) => acaoHumana(estado.conectores, n.slug, n.ferramenta)))];
  const sufixos = new Set(frases.map((f) => f.slice(f.lastIndexOf(" no ") + 1)));
  if (sufixos.size === 1 && frases.every((f) => f.includes(" no "))) {
    const [sufixo] = [...sufixos];
    return `${frases.map((f) => f.slice(0, f.lastIndexOf(" no "))).join(" e ")} ${sufixo}`;
  }
  return frases.join(" e ");
}

function daAprovacao(m: Mensagem, p: Payload<"resultado_aprovacao">, estado: Estado): DadosDoEncolhido {
  const total = p.itens.length;
  // NOD-282 (G6): "já feita" (a ação saiu numa decisão posterior) conta como feita.
  const feita = (d: string) => d === "executado" || d === "ja_executado";
  const feitos = p.itens.filter((i) => feita(i.desfecho)).length;
  const aprovados = p.itens.filter((i) => feita(i.desfecho) || i.desfecho === "falhou_na_execucao").length;
  const titulo = p.frase ?? (total === 1 && p.itens[0]?.texto ? p.itens[0].texto : `${total} ${total === 1 ? "ação" : "ações"}`);
  const quem = porQuem(m, estado);
  const comTexto = p.itens.some((i) => i.texto);
  const itens = comTexto
    ? `<ul class="recibo-itens">${p.itens.map((i) => `<li class="recibo-item-${feita(i.desfecho) ? "ok" : i.desfecho === "falhou_na_execucao" ? "falha" : "recusa"}"><span>${esc(i.texto ?? "")}</span><small>${esc(DESFECHO[i.desfecho] ?? i.desfecho.replaceAll("_", " "))}</small></li>`).join("")}</ul>`
    : `<p class="recibo-texto">${paragrafos(m.texto)}</p>`;
  const detalhes = { rotulo: "detalhes", html: itens, chave: `encolhido-${m.id}` };
  // PR 4 dos modos de aprovação: o cartão do revisor tinha "Negar"; o encolhido usa o mesmo verbo.
  if (aprovados === 0) return p.revisor
    ? { decisaoId: p.decisaoId, titulo, resultado: `Negado${quem}`, marca: null, anuncio: `Negado: ${titulo}` }
    : { decisaoId: p.decisaoId, titulo, resultado: `Recusado${quem}`, marca: null, anuncio: `Recusado: ${titulo}` };
  if (feitos === aprovados) {
    const resultado = total === 1 ? `Aprovado${quem} · feito ${hora(m.criadoEm)}` : `Aprovado${quem} · ${feitos} de ${total} ${feitos === 1 ? "feita" : "feitas"}`;
    // Um item que deu certo não tem o que abrir: a linha já diz tudo.
    return { decisaoId: p.decisaoId, titulo, resultado, marca: "ok", anuncio: `Aprovado: ${titulo}`, ...(total > 1 ? { detalhes } : {}) };
  }
  const falhas = aprovados - feitos;
  const resultado = feitos === 0 ? "Aprovado · não saiu" : `Aprovado · ${falhas} de ${aprovados} não ${falhas === 1 ? "saiu" : "saíram"}`;
  return { decisaoId: p.decisaoId, titulo, resultado, marca: "falha", anuncio: `Aprovado, mas não saiu: ${titulo}`, detalhes };
}

function registro(m: Mensagem): DadosDoEncolhido["detalhes"] {
  return { rotulo: "Ver registro de autorização", html: `<p class="recibo-texto">${paragrafos(m.texto)}</p>`, chave: `consentimento-${m.id}` };
}

function doAcesso(m: Mensagem, p: Payload<"consentimento">, estado: Estado): DadosDoEncolhido {
  const caps = "capacidades" in p ? p.capacidades : [p.capacidade];
  const decisaoId = "decisaoId" in p && p.decisaoId ? p.decisaoId : m.id;
  const frase = "frase" in p && p.frase ? p.frase : null;
  const conector = estado.conectores.find((c) => c.slug === p.slug);
  const app = conector?.nome ?? p.slug;
  // Sem a frase (consentimento sem pedido, ou de antes de 18/10): o que foi liberado em português quando o catálogo diz o
  // grupo de cada ferramenta; senão o nome da ferramenta (uma) ou a contagem.
  const comGrupo = caps.every((cap) => {
    const grupo = conector?.catalogo.find((c) => c.nome === cap)?.grupo;
    return grupo !== undefined && grupo !== "outras";
  });
  const titulo = frase ?? (comGrupo ? maiuscula(acoesHumanas(estado, caps.map((ferramenta) => ({ slug: p.slug, ferramenta })))) : caps.length === 1 ? caps[0] ?? app : `${caps.length} ações no ${app}`);
  return { decisaoId, titulo, resultado: `Acesso permitido · ${app}`, marca: "ok", anuncio: `Acesso permitido: ${titulo}`, detalhes: registro(m) };
}

function daRegra(m: Mensagem, p: Payload<"regra_permanente">, estado: Estado): DadosDoEncolhido {
  const nomes = p.acoes.map((n) => {
    const ponto = n.indexOf(".");
    return ponto > 0 ? { slug: n.slice(0, ponto), ferramenta: n.slice(ponto + 1) } : { slug: n, ferramenta: n };
  });
  const titulo = `Sempre permitir ${acoesHumanas(estado, nomes)}`;
  return { decisaoId: p.decisaoId, titulo, resultado: "Regra nova", marca: "regra", anuncio: `Regra nova: ${titulo.charAt(0).toLowerCase()}${titulo.slice(1)}`, detalhes: registro(m) };
}

function daPasta(p: Payload<"pasta_aberta">, estado: Estado): DadosDoEncolhido {
  const agente = estado.frota?.agentes.find((a) => a.id === p.agenteId && !a.excluidoEm);
  const dono = agente !== undefined && agente.ownerId === estado.sessao?.pessoaId;
  const onde = ondeLegivel({ caminho: p.pasta, ...(p.onde !== undefined ? { onde: p.onde } : {}) });
  const rodape = `<p class="ce-rodape" title="${esc(p.pasta)}"><span>${esc(onde)}</span>${dono ? botao("abrir-workspace", "Trocar", { classe: "link", id: p.agenteId }) : ""}</p>`;
  return { decisaoId: p.propostaId, titulo: `Abrir o projeto ${p.nome}`, resultado: `${p.nome} aberta para ${agente?.nome ?? "o agente"}`, marca: "ok", anuncio: `Pasta aberta: ${p.nome}`, rodape };
}

function daProposta(m: Mensagem, p: Payload<"proposta_decidida">, estado: Estado): DadosDoEncolhido {
  const quem = porQuem(m, estado);
  // NOD-50: o cartão de credencial encolhe sem nada do valor; guardada leva o "Trocar" para Configurações avançadas.
  if (p.tipo === "credencial") {
    return p.estado === "confirmada"
      ? { decisaoId: p.propostaId, titulo: p.titulo, resultado: "Guardada no cofre", marca: "ok", anuncio: `${p.titulo}: guardada no cofre`, rodape: `<p class="ce-rodape"><span>O bot não vê a chave.</span>${botao("abrir-avancado", "Trocar", { classe: "link", aria: "Trocar a chave em Configurações avançadas" })}</p>` }
      : { decisaoId: p.propostaId, titulo: p.titulo, resultado: `Deixada de lado${quem}`, marca: null, anuncio: `${p.titulo}: deixada de lado` };
  }
  // NOD-84: a rotina por webhook confirmada guarda o endereço no card encolhido (mascarado, copiar e Enviar teste). O id
  // da proposta de rotina é o id da rotina.
  const webhook = p.estado === "confirmada" && p.tipo === "rotina" ? estado.rotinas.find((r) => r.rotina.id === p.propostaId && r.rotina.ownerId === estado.sessao?.pessoaId) : undefined;
  const rodape = webhook && ehRotinaWebhook(webhook) && webhook.rotina.excluidoEm === null ? enderecoNoCard(webhook, origemDaTela(), estado.agora) : "";
  return p.estado === "confirmada"
    ? { decisaoId: p.propostaId, titulo: p.titulo, resultado: `Confirmado${quem}`, marca: "ok", anuncio: `Confirmado: ${p.titulo}`, ...(rodape ? { rodape } : {}) }
    : { decisaoId: p.propostaId, titulo: p.titulo, resultado: `Recusado${quem}`, marca: null, anuncio: `Recusado: ${p.titulo}` };
}

/**
 * O cartão encolhido que o recibo vira, ou null quando ele continua a linha de antes: o recibo automático sem payload
 * (não houve cartão), o "permitiu para sempre" antigo (sem payload) e o consentimento da aprovação automática (não houve
 * clique; mora na Atividade).
 */
export function dadosDoEncolhido(m: Mensagem, estado: Estado): DadosDoEncolhido | null {
  const p = m.payload;
  if (!p) return null;
  switch (p.kind) {
    case "resultado_aprovacao":
      return daAprovacao(m, p, estado);
    case "consentimento":
      return m.autoria.decidido_por === "pessoa" ? doAcesso(m, p, estado) : null;
    case "regra_permanente":
      return daRegra(m, p, estado);
    case "pasta_aberta":
      return daPasta(p, estado);
    case "proposta_decidida":
      return daProposta(m, p, estado);
    default:
      return null;
  }
}

/**
 * O turno do pedido que o recibo resolve, a âncora do cartão (null = sem âncora: encolhe onde o recibo está). O
 * `resultado_aprovacao` é gravado no turno da decisão; os outros levam o turno no payload (os gravados antes, sem ele).
 */
export function turnoDoEncolhido(m: Mensagem): string | null {
  const p = m.payload;
  if (!p) return null;
  switch (p.kind) {
    case "resultado_aprovacao":
      return m.turnoId;
    case "consentimento":
      return "turnoId" in p ? p.turnoId ?? null : null;
    case "regra_permanente":
    case "proposta_decidida":
      return p.turnoId;
    case "pasta_aberta":
      return p.turnoId ?? null;
    default:
      return null;
  }
}

/** O pedido que o recibo fecha: o cartão aberto de mesmo id não é desenhado de novo (a fila "Sua vez" relê depois). */
export function pedidoDoRecibo(m: Mensagem): string | null {
  const p = m.payload;
  if (!p) return null;
  switch (p.kind) {
    case "resultado_aprovacao":
    case "regra_permanente":
      return p.decisaoId;
    case "consentimento":
      return "decisaoId" in p ? p.decisaoId ?? null : null;
    case "pasta_aberta":
    case "proposta_decidida":
      return p.propostaId;
    default:
      return null;
  }
}
