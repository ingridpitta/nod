import type { SuaVezDto } from "../../src/contracts/api.ts";
import type { TipoDecisao } from "../../src/contracts/decisao.ts";
import type { Mensagem } from "../../src/contracts/mensagem.ts";
import type { FioDaPergunta, TIPOS_PEDIDO_A_PESSOA } from "../../src/contracts/pedido.ts";
import type { Estado } from "../estado/reducer.ts";

/**
 * Perguntas viram conversa (emenda da ADR-045, definido em 2026-09-24): a pergunta de pedir_a_pessoa
 * é a fala do agente na conversa, e a próxima mensagem da pessoa responde. Aqui mora o que é DERIVADO
 * do estado — que perguntas estão abertas, onde cada uma está, o que o campo faz — e o envio; o HTML
 * fica em web/telas/pergunta.ts. Nada lê o DOM, então tudo é testável sem navegador.
 */
export type ItemPergunta = SuaVezDto["itens"][number];

/**
 * Espelho EXATO de TIPOS_PEDIDO_A_PESSOA (src/contracts/pedido.ts) — a web só importa tipos de src/.
 * As chaves do Record são as do contrato: faltar ou sobrar um tipo não compila.
 */
const PERGUNTAS: Record<(typeof TIPOS_PEDIDO_A_PESSOA)[number], true> = { pergunta: true, falta_de_dado: true, permissao: true };

/** Os três tipos de pedir_a_pessoa: se respondem na conversa, nunca por card com caixa de texto. */
export function ehPergunta(tipo: TipoDecisao): boolean {
  return Object.hasOwn(PERGUNTAS, tipo);
}

/** Aberta NA FILA: pendente ou reaberta com prazo por vir (a coluna da fila já diz isso). */
function aberta(item: ItemPergunta): boolean {
  return item.estadoColuna !== "vencido";
}

/** Perguntas ABERTAS desta conversa na fila da pessoa, da mais antiga para a mais nova. */
export function perguntasAbertas(estado: Estado, conversaId: string): ItemPergunta[] {
  return (estado.suaVez?.itens ?? [])
    .filter((i) => i.decisao.conversaId === conversaId && aberta(i) && ehPergunta(i.decisao.tipo))
    .sort((a, b) => Date.parse(a.decisao.criadoEm) - Date.parse(b.decisao.criadoEm));
}

/**
 * Fio da pergunta (emenda da ADR-045, definido em 2026-09-24): as rodadas de um fio são decisões
 * diferentes, mas esperam pela pessoa como UMA pergunta. A chave junta as rodadas; os outros pedidos
 * são o próprio fio (`fio` null).
 */
export function chaveDoItem(item: ItemPergunta): string {
  return item.fio?.id ?? item.decisao.id;
}

/** Quantos FIOS há entre os itens — os contadores (selo, faixa do topo, "Sua vez") contam fios, não rodadas. */
export function contarFios(itens: readonly ItemPergunta[]): number {
  return new Set(itens.map(chaveDoItem)).size;
}

/** Um item por fio, o primeiro de cada (a ordem do servidor: mais antigo primeiro). */
export function umPorFio<T extends ItemPergunta>(itens: readonly T[]): T[] {
  const vistos = new Set<string>();
  return itens.filter((i) => !vistos.has(chaveDoItem(i)) && Boolean(vistos.add(chaveDoItem(i))));
}

/** Os fios da conversa carregada, com o estado que o servidor derivou (ConversaDto.fios). */
export function fiosDaConversa(estado: Estado, conversaId: string): readonly FioDaPergunta[] {
  return estado.conversas[conversaId]?.fios ?? [];
}

/** "2ª rodada". */
export function rodadaEscrita(n: number): string {
  return `${n}ª rodada`;
}

/** Conversas com pergunta aberta: o que o reducer usa para esquecer a escolha do campo que perdeu o assunto. */
export function conversasComPergunta(suaVez: SuaVezDto): Set<string> {
  return new Set(suaVez.itens.filter((i) => aberta(i) && ehPergunta(i.decisao.tipo)).map((i) => i.decisao.conversaId));
}

/** A fala do agente que É a pergunta (payload pedido_a_pessoa), se estiver na conversa carregada. */
export function mensagemDaPergunta(mensagens: readonly Mensagem[], decisaoId: string): Mensagem | undefined {
  return mensagens.find((m) => m.payload?.kind === "pedido_a_pessoa" && m.payload.decisaoId === decisaoId);
}

/** A mensagem da pessoa que respondeu (payload resposta_a_pedido). */
export function respostaDaPergunta(mensagens: readonly Mensagem[], decisaoId: string): Mensagem | undefined {
  return mensagens.find((m) => m.payload?.kind === "resposta_a_pedido" && m.payload.decisaoId === decisaoId);
}

/**
 * Onde a pergunta está (revisto em 2026-10-18, plano "pergunta com botões", Parte 2). `respondida` diz se a resposta foi
 * uma das opções (`opcao`, o índice; o balão da pessoa some) ou outras palavras (`opcao` null; a fala dela fica).
 * `deixada`: dispensada no ×. `de_outra`: aberta, mas dirigida a outra pessoa (quem_destrava). `encerrada`: fechada sem
 * resposta por outro caminho ou fora do que se sabe.
 */
export type EstadoPergunta =
  | { tipo: "aberta"; item?: ItemPergunta }
  | { tipo: "respondida"; resposta: Mensagem; opcao: number | null }
  | { tipo: "vencida"; item?: ItemPergunta }
  | { tipo: "deixada" }
  | { tipo: "de_outra" }
  | { tipo: "encerrada" };

/**
 * Espelho EXATO de `chaveDaOpcao` / `opcaoRespondida` (src/domain/opcoes-da-pergunta.ts) — a web só importa tipos de src/.
 * Serve ao payload antigo, sem `via`: a resposta igual a uma opção (espaços e caixa não contam) marca essa opção com ✓.
 * tests/unit/web/perguntas-conversa.test.ts confere os dois lados com os mesmos casos.
 */
export function indiceDaOpcao(resposta: string, opcoes: readonly string[] | undefined): number | null {
  const chave = (t: string): string => t.replace(/\s+/g, " ").trim().toLocaleLowerCase("pt-BR");
  if (!opcoes?.length || chave(resposta) === "") return null;
  const i = opcoes.findIndex((o) => chave(o) === chave(resposta));
  return i === -1 ? null : i;
}

/** Qual opção a resposta escolheu: o `via` do servidor quando existe; senão a comparação do texto (payload antigo). */
export function opcaoDaResposta(resposta: Mensagem, opcoes: readonly string[] | undefined): number | null {
  const p = resposta.payload;
  if (p?.kind !== "resposta_a_pedido") return null;
  if (p.via === "texto") return null;
  if (p.via === "opcao" && p.opcao !== undefined && opcoes && p.opcao >= 0 && p.opcao < opcoes.length) return p.opcao;
  return indiceDaOpcao(resposta.texto, opcoes);
}

/**
 * O estado sai primeiro de `ConversaDto.fios`, que vem com a conversa, e só depois de "Sua vez" (revisão de engenharia de
 * 2026-10-18): antes de "Sua vez" carregar, toda pergunta parecia encerrada, e com o cartão as opções apareceriam um
 * instante depois, a conversa pulando. A resposta ligada a ela na conversa é a prova de que foi respondida; o fio diz
 * aberta, deixada ou vencida pela ÚLTIMA rodada; das rodadas anteriores sobra a resposta. Sem fio, "Sua vez" decide.
 */
export function estadoDaPergunta(estado: Estado, mensagens: readonly Mensagem[], decisaoId: string): EstadoPergunta {
  const resposta = respostaDaPergunta(mensagens, decisaoId);
  const item = estado.suaVez?.itens.find((i) => i.decisao.id === decisaoId);
  if (resposta) {
    const balao = mensagemDaPergunta(mensagens, decisaoId);
    const opcoes = balao?.payload?.kind === "pedido_a_pessoa" ? balao.payload.opcoes : undefined;
    return { tipo: "respondida", resposta, opcao: opcaoDaResposta(resposta, opcoes) };
  }
  const fio = fiosDaConversa(estado, mensagens[0]?.conversaId ?? "").find((f) => f.decisoes.at(-1) === decisaoId);
  // A pergunta que o bot dirigiu a outra pessoa (quem_destrava): a dona vê o cartão, mas as opções são da decisora.
  if (fio?.estado === "esperando_voce" && fio.decisorId && fio.decisorId !== estado.sessao?.pessoaId) return { tipo: "de_outra" };
  if (fio?.estado === "esperando_voce") return item && !aberta(item) ? { tipo: "vencida", item } : { tipo: "aberta", ...(item ? { item } : {}) };
  if (fio?.estado === "deixada_pra_la") return { tipo: "deixada" };
  // Reaberta pelo Reabrir do cartão (revisão do PR #389): "Sua vez" já relida diz aberta antes de a conversa reler o
  // fio — sem isto, o cartão seguia "Sem resposta · Reabrir" e o segundo clique dava 409.
  if (fio?.estado === "vencida") return item && aberta(item) ? { tipo: "aberta", item } : { tipo: "vencida", ...(item ? { item } : {}) };
  if (!item) return { tipo: "encerrada" };
  return aberta(item) ? { tipo: "aberta", item } : { tipo: "vencida", item };
}

/**
 * O pedido de ajuda do computador (`ajudaDoComputador` no payload) se responde com "Assumir controle", nunca com a mensagem
 * digitada: com ele aberto, o campo manda mensagem comum (revisão de engenharia de 2026-10-18). Lê o balão na conversa ou,
 * fora dela, o que "Sua vez" trouxe do balão.
 */
export function ehAjudaDoComputador(estado: Estado, item: ItemPergunta): boolean {
  const balao = mensagemDaPergunta(estado.conversas[item.decisao.conversaId]?.mensagens ?? [], item.decisao.id);
  if (balao?.payload?.kind === "pedido_a_pessoa") return balao.payload.ajudaDoComputador === true;
  return item.pedido?.ajudaDoComputador === true;
}

/** As opções da pergunta: as do balão na conversa ou, sem ele, as que "Sua vez" trouxe. */
export function opcoesDaPergunta(estado: Estado, item: ItemPergunta): readonly string[] {
  const balao = mensagemDaPergunta(estado.conversas[item.decisao.conversaId]?.mensagens ?? [], item.decisao.id);
  if (balao?.payload?.kind === "pedido_a_pessoa") return balao.payload.opcoes ?? [];
  return item.pedido?.opcoes ?? [];
}

/**
 * O que a próxima mensagem do campo faz. Sem pergunta aberta, nada muda. Com pergunta, o padrão é RESPONDER (decisão 1 do
 * plano "pergunta com botões", 2026-10-18: a mensagem digitada continua indo como resposta). Com duas ou mais, a caixa
 * "Respondendo" aponta para a MAIS RECENTE (antes, a mais antiga), salvo escolha (`alvoId`, pelo "Trocar"); o × dela manda
 * mensagem comum (`outroAssunto`) e deixa a pergunta aberta. O pedido de ajuda do computador fica fora: não se responde
 * com texto. `indice` é a posição da apontada.
 */
export type ModoComposer =
  | { tipo: "normal" }
  | { tipo: "outro"; perguntas: ItemPergunta[] }
  | { tipo: "resposta"; perguntas: ItemPergunta[]; alvo: ItemPergunta; indice: number };

export function modoDoComposer(estado: Estado, conversaId: string): ModoComposer {
  const perguntas = perguntasAbertas(estado, conversaId).filter((p) => !ehAjudaDoComputador(estado, p));
  const maisRecente = perguntas.at(-1);
  if (!maisRecente) return { tipo: "normal" };
  const escolha = estado.composer[conversaId];
  // O "outro assunto" só vale com a caixa "Respondendo" à vista (duas ou mais, revisão do PR #389): se uma das duas foi
  // respondida ou deixada pra lá depois do ×, a escolha sobrava invisível e a mensagem digitada ia como comum sem aviso.
  if (escolha?.outroAssunto && perguntas.length > 1) return { tipo: "outro", perguntas };
  const escolhida = perguntas.findIndex((p) => p.decisao.id === escolha?.alvoId);
  const indice = escolhida === -1 ? perguntas.length - 1 : escolhida;
  return { tipo: "resposta", perguntas, alvo: perguntas[indice] ?? maisRecente, indice };
}

/** "Trocar": a próxima pergunta aberta depois da apontada, dando a volta. */
export function proximaDoComposer(modo: ModoComposer): string | null {
  if (modo.tipo !== "resposta" || modo.perguntas.length < 2) return null;
  return modo.perguntas[(modo.indice + 1) % modo.perguntas.length]?.decisao.id ?? null;
}

/** `respondeA` (ADR-113, Parte 3b): o id da fala que a mensagem comum cita, pelo "Responder" da barra de ações. */
export type DestinoEnvio = { tipo: "resposta"; decisaoId: string } | { tipo: "mensagem"; respondeA?: string };

/**
 * Anexo com pergunta aberta (decisão 9 do plano, 2026-10-18): a mensagem vai como mensagem comum e a pergunta segue aberta
 * — a rota `responder` só leva texto, e era isso que o "Outro assunto" fazia. Antes o clipe desligava.
 */
export function destinoDoEnvio(modo: ModoComposer, comAnexo = false, citacao?: { mensagemId: string } | null): DestinoEnvio {
  // ADR-113 (Parte 3b, revisão de engenharia do plano): a mensagem que cita uma fala vai como MENSAGEM COMUM mesmo com
  // pergunta aberta, e a pergunta segue aberta — é o que faz o "Abrir task com isto" chegar ao bot como pedido. A citação
  // da própria pergunta aberta não chega aqui: o "Responder" dela aponta o campo para a pergunta (`alvoId`).
  if (citacao) return { tipo: "mensagem", respondeA: citacao.mensagemId };
  return modo.tipo === "resposta" && !comAnexo ? { tipo: "resposta", decisaoId: modo.alvo.decisao.id } : { tipo: "mensagem" };
}

/**
 * Letra digitada (plano "pergunta com botões", Parte 2): com opções, "A", "b", "B." ou "c)" sozinhos no campo viram o
 * texto da opção antes de `responder` — a resposta continua texto (EMENDA 16). Letra além do total vai como foi digitada.
 * Usada pelo campo da conversa e pelo campo de "Sua vez".
 */
export function textoDaLetra(texto: string, opcoes: readonly string[]): string {
  const m = /^\s*([a-d])\s*[.)]?\s*$/i.exec(texto);
  if (!m?.[1]) return texto;
  return opcoes[m[1].toLowerCase().charCodeAt(0) - 97] ?? texto;
}

/** O que o envio precisa da Api (estrutural: web/lib/api.ts satisfaz, e o teste passa um espião). */
export type ApiDeEnvio = {
  enviar(conversaId: string, texto: string, anexos?: readonly string[], idEnvio?: string, respondeA?: string): Promise<unknown>;
  responder(decisaoId: string, texto: string): Promise<unknown>;
  postarNaSala(salaId: string, texto: string): Promise<unknown>;
};

/** `ids` (Parte 1 do plano "o pensamento no chat"): os ids da mensagem e do turno que o POST devolve (`RespostaMutacao`). */
export type ResultadoEnvio = { enviado: "resposta" | "mensagem"; ids?: Record<string, string> };

/**
 * Envio do campo. Em modo resposta o texto vai por POST decisoes/:id/responder — a rota que já existe,
 * que fecha a pergunta e cria a retomada; EMENDA 16 intacta: a resposta é o texto da pessoa — e NÃO
 * vira mensagem comum. Com anexo, vai como mensagem comum (destinoDoEnvio); aqui também, para nada sumir.
 */
export async function enviarPeloComposer(
  api: ApiDeEnvio,
  alvo: { conversaId: string; salaId: string | null },
  destino: DestinoEnvio,
  texto: string,
  anexos: readonly string[] = [],
  idEnvio?: string,
): Promise<ResultadoEnvio> {
  if (destino.tipo === "resposta" && anexos.length === 0) {
    await api.responder(destino.decisaoId, texto);
    return { enviado: "resposta" };
  }
  const respondeA = destino.tipo === "mensagem" ? destino.respondeA : undefined;
  if (alvo.salaId) { await api.postarNaSala(alvo.salaId, texto); return { enviado: "mensagem" }; }
  // NOD-156: a chave só vale para a mensagem comum; resposta e sala têm rotas próprias.
  const r = respondeA ? await api.enviar(alvo.conversaId, texto, anexos, idEnvio, respondeA) : idEnvio ? await api.enviar(alvo.conversaId, texto, anexos, idEnvio) : await api.enviar(alvo.conversaId, texto, anexos);
  const ids = idsDaResposta(r);
  return ids ? { enviado: "mensagem", ids } : { enviado: "mensagem" };
}

/** Os ids do `RespostaMutacao` (só strings), ou null quando a resposta não é a esperada (servidor de antes). */
export function idsDaResposta(r: unknown): Record<string, string> | null {
  const ids = r && typeof r === "object" && "ids" in r ? (r as { ids?: unknown }).ids : null;
  if (!ids || typeof ids !== "object") return null;
  const so = Object.fromEntries(Object.entries(ids as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string"));
  return Object.keys(so).length ? so : null;
}

/** definido em 2026-09-24: o começo da pergunta numa linha curta (o resumo do fio resolvido). */
export const CITACAO_MAX = 48;

/** "Posso arquivar o PR 7 e avisar o…": corta na palavra; o texto inteiro fica no balão. */
export function inicioDaPergunta(texto: string, max = CITACAO_MAX): string {
  const limpo = texto.replace(/\s+/g, " ").trim();
  const letras = [...limpo];
  if (letras.length <= max) return limpo;
  const corte = letras.slice(0, max).join("");
  const espaco = corte.lastIndexOf(" ");
  return `${(espaco > max / 2 ? corte.slice(0, espaco) : corte).replace(/[\s,.;:!?-]+$/u, "")}…`;
}

/** Balão de fala (24×24, traço 1,6, como os outros ícones): o sinal de PERGUNTA, azul, separado do ⚑ âmbar. */
export function iconeBalao(tamanho: number): string {
  return `<svg class="ic-balao" aria-hidden="true" viewBox="0 0 24 24" width="${tamanho}" height="${tamanho}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>`;
}
