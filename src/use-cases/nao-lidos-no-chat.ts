import type { RuntimeEvent } from "../contracts/evento.ts";
import { ACOES_NAO_LIDOS, type ErroNaoLidos, type NaoLidaParaBot, type PayloadNaoLidosLista, type PayloadReciboLeitura, type ResultadoNaoLidos } from "../contracts/ferramentas-nao-lidos.ts";
import type { ConversaNaoLida, LeituraMarcada } from "../contracts/nao-lidos.ts";
import type { CasoNod, SaidaCasoDeUso } from "../contracts/servicos.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { fraseDoDesfeito, fraseDoRecibo } from "../domain/nao-lidos.ts";
import { EXECUTORES_CONVERSA } from "./acoes/conversa.ts";
import { autoriaAgente, evento } from "./apoio-l7.ts";
import { listarNaoLidos } from "./nao-lidos.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";

/**
 * nao_lidos (definido em 2026-11-01, NOD-449, ADR-135): a tela Não lidos pela conversa, para QUALQUER bot. Marcar e
 * desfazer passam pelos executores únicos (src/use-cases/acoes/conversa.ts), os mesmos da tela. Cercas:
 * 1. só na conversa com a pessoa (conversa ou criação), de primeira mão: um pedido de colega (procuração, corrente) não
 *    lê quem falou com ela nem marca por ela;
 * 2. ao bot voltam nome, contagem e hora, nunca o texto das falas — o card do chat desenha a prévia no navegador;
 * 3. marcar não pede confirmação: grava o recibo de uma linha com Desfazer (decisão 7).
 */

const MODOS = new Set(["conversa", "criacao"]);
const INSTRUCAO: Record<ErroNaoLidos, string> = {
  fora_da_conversa: "nao_lidos só vale na conversa com a pessoa, a pedido dela. Nada mudou.",
  nao_encontrado: "Nada mudou: use um nome da lista (disponiveis) ou chame listar.",
  entrada_invalida: "Nada mudou: corrija a chamada (marcar pede conversas ou todas: true).",
  nada_para_desfazer: "Não há marcação para desfazer nesta conversa. Nada mudou.",
  turno_nao_limpo: "Nada mudou: neste turno entrou conteúdo de fora (página, e-mail, arquivo), e marcar pela pessoa só vale num turno limpo. Peça para ela tocar no ✓ do card (listar ainda funciona).",
};

type Saida = SaidaCasoDeUso<ResultadoNaoLidos>;
const recusa = (erro: ErroNaoLidos, extra: { disponiveis?: string[]; detalhe?: string } = {}): Saida => ({
  data: { ok: false, erro, instrucao: extra.detalhe ? `${extra.detalhe}. ${INSTRUCAO[erro]}` : INSTRUCAO[erro], ...(extra.disponiveis ? { disponiveis: extra.disponiveis } : {}) },
});

/** Para comparar nomes: sem acento, sem caixa, sem espaço sobrando. */
export const normalizarNome = (s: string): string => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

type Alvo = { conversaId: string; agenteId: string | null; salaId: string | null; nome: string };

/** As conversas que a pessoa vê na barra (bots não ocultos e salas), com o nome de cada uma. */
async function alvos(deps: Deps): Promise<Alvo[]> {
  const [agentes, salas] = await Promise.all([deps.repos.agentes.listar(), deps.repos.salas.listar()]);
  const dosBots = await Promise.all(
    agentes.map(async (a) => {
      const c = await deps.repos.conversas.buscarPropriaDoAgente(a.id);
      return c ? [{ conversaId: c.id, agenteId: a.id, salaId: null, nome: a.nome }] : [];
    }),
  );
  return [...dosBots.flat(), ...salas.map((s) => ({ conversaId: s.conversaId, agenteId: null, salaId: s.id, nome: s.nome }))];
}

function nomeDe(c: Pick<ConversaNaoLida, "conversaId">, todos: readonly Alvo[]): string {
  return todos.find((a) => a.conversaId === c.conversaId)?.nome ?? "Conversa";
}

/** Resolve cada nome (ou id) pedido numa conversa; os que não acham voltam em `faltam`. Nome repetido entre bot e sala: ambíguo. */
function resolver(pedidos: readonly string[], todos: readonly Alvo[]): { achados: Alvo[]; faltam: string[] } {
  const achados: Alvo[] = [];
  const faltam: string[] = [];
  for (const p of pedidos) {
    const chave = normalizarNome(p);
    const porId = todos.filter((a) => a.conversaId === p.trim());
    const porNome = porId.length ? porId : todos.filter((a) => normalizarNome(a.nome) === chave);
    if (porNome.length !== 1) faltam.push(p);
    else if (porNome[0] && !achados.some((a) => a.conversaId === porNome[0]?.conversaId)) achados.push(porNome[0]);
  }
  return { achados, faltam };
}

export const naoLidosNoChat: CasoNod<Deps, "nao_lidos"> = async (deps, input) => {
  const turno = await deps.repos.turnos.buscar(input.turnoId);
  const modo = input.plano?.modoTurno ?? turno?.origem ?? null;
  if (!turno || turno.agenteId !== input.agenteId || turno.conversaId !== input.conversaId || !modo || !MODOS.has(modo)) return recusa("fora_da_conversa");
  if (turno.sobProcuracaoDe || turno.profundidade > 0) return recusa("fora_da_conversa", { detalhe: "este turno é um pedido de outro bot" });
  if (!(ACOES_NAO_LIDOS as readonly string[]).includes(input.acao)) return recusa("entrada_invalida");
  // Revisão do PR #616 (o corte do gerir_quadro e do avisar_pessoa, ADR-062): mudar o que a pessoa vê como não lido só num
  // turno limpo — uma página lida não pode, por injeção, esconder dos Não lidos o alerta de outro bot. Listar só lê.
  if (input.acao !== "listar" && !(turno.entradaConfianca === "confiavel" && !(await deps.repos.turnos.contaminado(turno.id)))) return recusa("turno_nao_limpo");

  const autoria = autoriaAgente(input.agenteId, deps.escopo.pessoaId);
  const events: RuntimeEvent[] = [];
  const linha = async (texto: string, payload: PayloadNaoLidosLista | PayloadReciboLeitura) => {
    const m = await deps.repos.mensagens.criar({ conversaId: turno.conversaId, turnoId: turno.id, autoria, kind: "sistema", texto, payload, confianca: "confiavel" });
    if (m) events.push(evento(deps, "mensagem_criada", autoria, { mensagem_id: m.id, kind: "sistema" }, { conversaId: turno.conversaId, turnoId: turno.id }));
  };

  if (input.acao === "desfazer") {
    const r = await desfazerUltimoRecibo(deps, turno.conversaId);
    if (!r) return recusa("nada_para_desfazer");
    return { data: { ok: true, restauradas: r.restauradas, instrucao: `Desfeito: ${r.nomes.join(", ")} voltaram para Não lidos (a linha do recibo já diz isso). Responda numa frase curta.` }, events: [...events, ...r.events] };
  }

  const [lista, todos] = await Promise.all([listarNaoLidos(deps, {}).then((r) => r.data.conversas), alvos(deps)]);

  if (input.acao === "listar") {
    if (lista.length === 0) return { data: { ok: true, conversas: [], instrucao: "Tudo em dia: ninguém tem fala nova para a pessoa. Diga isso numa frase." }, events };
    const conversas = lista.map((c) => ({ conversaId: c.conversaId, agenteId: c.agenteId, salaId: c.salaId, nome: nomeDe(c, todos) }));
    await linha(`${lista.length === 1 ? "1 conversa" : `${lista.length} conversas`} com coisa para você: ${conversas.map((c) => c.nome).join(", ")}`, { kind: "nao_lidos_lista", conversas });
    const paraBot: NaoLidaParaBot[] = lista.map((c) => ({ conversa_id: c.conversaId, nome: nomeDe(c, todos), tipo: c.tipo === "sala" ? "sala" : "bot", novas: c.total, ultima_em: new Date(c.ultimaEm).toISOString() }));
    return { data: { ok: true, conversas: paraBot, instrucao: "O card com a lista está no chat (a pessoa marca ali com ✓). Diga numa frase quantas são; não repita a lista." }, events };
  }

  if (!input.todas && !input.conversas?.length) return recusa("entrada_invalida");

  if (input.acao === "marcar_nao_lida") {
    if (input.todas) return recusa("entrada_invalida", { detalhe: "marcar_nao_lida pede conversas, não todas" });
    const { achados, faltam } = resolver(input.conversas ?? [], todos);
    if (faltam.length) return recusa("nao_encontrado", { detalhe: `não achei: ${faltam.join(", ")}`, disponiveis: todos.map((a) => a.nome) });
    const marcadas: string[] = [];
    for (const a of achados) if ((await EXECUTORES_CONVERSA["conversas.marcar_nao_lida"](deps, { conversaId: a.conversaId })).data.marcada) marcadas.push(a.nome);
    if (marcadas.length === 0) return { data: { ok: true, marcadas, instrucao: "Nada mudou: essas conversas não têm fala de bot para a pessoa. Diga isso numa frase." }, events };
    return { data: { ok: true, marcadas, instrucao: `${fraseDoDesfeito(marcadas)}. Diga numa frase.` }, events };
  }

  // marcar: todas (o "Marcar tudo como lido" da tela) ou as pedidas que têm fala nova.
  let marcadas: { nome: string; leitura: LeituraMarcada }[];
  if (input.todas) {
    if (lista.length === 0) return { data: { ok: true, marcadas: [], instrucao: "Tudo já estava em dia: nada mudou. Diga isso numa frase." }, events };
    const r = await EXECUTORES_CONVERSA["conversas.marcar_tudo_lido"](deps, {});
    marcadas = r.data.leituras.map((leitura) => ({ nome: nomeDe(leitura, todos), leitura }));
  } else {
    const comNovas = lista.map((c) => ({ conversaId: c.conversaId, agenteId: c.agenteId, salaId: c.salaId, nome: nomeDe(c, todos) }));
    const { achados, faltam } = resolver(input.conversas ?? [], todos);
    if (faltam.length) return recusa("nao_encontrado", { detalhe: `não achei: ${faltam.join(", ")}`, disponiveis: comNovas.map((a) => a.nome) });
    const alvo = achados.filter((a) => comNovas.some((c) => c.conversaId === a.conversaId));
    if (alvo.length === 0) return { data: { ok: true, marcadas: [], instrucao: `${achados.map((a) => a.nome).join(", ")} já estava em dia: nada mudou. Diga isso numa frase.` }, events };
    marcadas = [];
    for (const a of alvo) {
      const r = await EXECUTORES_CONVERSA["conversas.marcar_lida"](deps, { conversaId: a.conversaId });
      for (const leitura of r.data.leituras) marcadas.push({ nome: a.nome, leitura });
    }
  }
  const nomes = marcadas.map((m) => m.nome);
  await linha(fraseDoRecibo(nomes), { kind: "recibo_leitura", nomes, leituras: marcadas.map((m) => m.leitura) });
  return { data: { ok: true, marcadas: nomes, instrucao: "Marcadas. O recibo de uma linha com Desfazer está no chat: não mande confirmação; no máximo uma frase. Para desfazer você mesmo: {acao: \"desfazer\"}." }, events };
};

/**
 * O Desfazer de um recibo (o botão na linha, ou `desfazer` do bot): as leituras do payload voltam pelo executor único
 * (conversas.desfazer_leitura) e a linha vira "… voltaram para Não lidos". `mensagemId` ausente = o último recibo da
 * conversa ainda não desfeito. null = nada a desfazer.
 */
export async function desfazerRecibo(deps: Deps, mensagemId: string): Promise<{ restauradas: number; nomes: string[]; events: RuntimeEvent[] } | null> {
  const m = await deps.repos.mensagens.buscar(mensagemId);
  if (!m || m.kind !== "sistema" || m.payload?.kind !== "recibo_leitura" || m.payload.desfeito) return null;
  const p = m.payload;
  const r = p.leituras.length ? await EXECUTORES_CONVERSA["conversas.desfazer_leitura"](deps, { leituras: p.leituras }) : { data: { restauradas: 0 } };
  const texto = fraseDoDesfeito(p.nomes);
  const events: RuntimeEvent[] = [];
  if (await deps.repos.mensagens.atualizarSistema(m.id, { texto, payload: { ...p, desfeito: true } })) {
    events.push(evento(deps, "mensagem_criada", m.autoria, { mensagem_id: m.id, kind: "sistema" }, { conversaId: m.conversaId, turnoId: m.turnoId }));
  }
  return { restauradas: r.data.restauradas, nomes: p.nomes, events };
}

/**
 * O Desfazer do recibo na tela da conversa (POST /nao-lidos/recibos/:id/desfazer). A conversa do recibo tem de ser da
 * pessoa (conversas.buscar passa pela RLS dela); recibo já desfeito ou de outra conversa = nao_encontrado.
 */
export const desfazerReciboDaTela: CasoDeUso<{ mensagemId: string }, { restauradas: number }> = async (deps, input) => {
  const m = await deps.repos.mensagens.buscar(input.mensagemId);
  // A conversa do recibo é da pessoa (revisão do PR #616): ver a mensagem (equipe, sala) não basta para desfazer.
  const conversa = m ? await deps.repos.conversas.buscar(m.conversaId) : null;
  if (!m || !conversa || conversa.ownerId !== deps.escopo.pessoaId) throw new ErroDeDominio("nao_encontrado");
  const r = await desfazerRecibo(deps, m.id);
  if (!r) throw new ErroDeDominio("nao_encontrado");
  return { data: { restauradas: r.restauradas }, events: r.events };
};

async function desfazerUltimoRecibo(deps: Deps, conversaId: string) {
  const m = await deps.repos.mensagens.ultimaComAssunto(conversaId, "leitura.recibo");
  return m ? desfazerRecibo(deps, m.id) : null;
}
