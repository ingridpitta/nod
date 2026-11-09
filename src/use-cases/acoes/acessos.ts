import type { Agente } from "../../contracts/agente.ts";
import type { Conector } from "../../contracts/conector.ts";
import type { RuntimeEvent } from "../../contracts/evento.ts";
import type { IdAcao } from "../../domain/acoes/index.ts";
import { alvosDoLote, desfazerDevolveEscrita, fraseDoLote, MAX_BOTS_POR_LOTE, nivelDoConjunto, planoDeVolta, planoDoNivel, PRAZO_DESFAZER_MS, segueOPadrao, type NivelAtual } from "../../domain/acessos-em-lote.ts";
import { ErroDeDominio } from "../../domain/erro.ts";
import { assertUuid } from "../apoio-l7.ts";
import { capacidadesDoNivel, type NivelDeAcesso } from "../../domain/grupos-de-acesso.ts";
import type { ConjuntoPorBot, MarcaDeAcesso } from "../../repositories/acessos.repo.ts";
import { concederLote } from "../conceder.ts";
import type { PorRegra } from "../confirmar-pelo-modo.ts";
import { revogarLote } from "../revogar.ts";
import type { CasoDeUso, Deps } from "../tipos.ts";

/**
 * O executor único das permissões dos apps (definido em 2026-11-07, ADA-241, ADR-158): a tela (rotas de concessoes.ts)
 * e o chat (gerir_acessos, e o card do lote que ele abre) chamam as MESMAS funções.
 *
 * - Tudo ou nada: roda dentro da transação de quem chama; qualquer ErroDeDominio volta o lote inteiro.
 * - Trava (agente, conector) em ordem de id: dois lotes que se cruzam não se atravessam (sem 40P01).
 * - Quem concede é sempre a pessoa (E12.5: agente não concede a agente). Pelo chat, o modo do bot decide no lugar do
 *   clique e a regra vai no consentimento (`porRegra`, ADR-059); pelo card, a pessoa clicou.
 * - Ler e alterar em lote, ou como padrão, exige `confirmado` (a tela pergunta antes; o chat manda ao card sempre).
 */

type Autor = { porRegra?: PorRegra; botId?: string };

/** O app tem de ser da dona (RLS abre os de 'equipe' para leitura; revisão do PR #68). */
async function conectorDaDona(d: Deps, conectorId: string, nivel: NivelDeAcesso): Promise<Conector> {
  const conector = await d.repos.conectores.buscar(conectorId);
  if (!conector || conector.ownerId !== d.escopo.pessoaId) throw new ErroDeDominio("nao_encontrado", { cause: "conector" });
  if (nivel !== "nenhum" && !conector.habilitado) throw new ErroDeDominio("estado_invalido", { cause: "conecte o app antes de dar acesso" });
  if (nivel !== "nenhum" && capacidadesDoNivel(conector.catalogo, nivel).length === 0) throw new ErroDeDominio("estado_invalido", { cause: "o app não tem ferramenta para esse nível" });
  return conector;
}

/** Os bots da pessoa que a tela mostra em "Quem pode usar": dela, confirmados e não excluídos. */
export async function botsDaDona(d: Deps): Promise<Agente[]> {
  return (await d.repos.agentes.listar({ incluirOcultos: true })).filter((a) => a.ownerId === d.escopo.pessoaId && a.confirmado && a.excluidoEm === null);
}

async function conjuntoAtual(d: Deps, agenteId: string, conectorId: string) {
  return (await d.repos.concessoes.doAgente(agenteId)).filter((c) => c.conectorId === conectorId);
}

/** Leva o bot do conjunto atual ao `depois` (ou ao nível): revoga o que sobra num registro, concede o que falta num consentimento. */
async function aplicar(d: Deps, agenteId: string, conector: Conector, alvo: { nivel: NivelDeAcesso } | { conjunto: readonly string[] }, autor: Autor): Promise<{ antes: string[]; depois: string[]; events: RuntimeEvent[] }> {
  await d.repos.concessoes.travar(agenteId, conector.id);
  const atuais = await conjuntoAtual(d, agenteId, conector.id);
  const nomes = atuais.map((c) => c.capacidade);
  const plano = "nivel" in alvo ? planoDoNivel(conector.catalogo, nomes, alvo.nivel) : planoDeVolta(nomes, alvo.conjunto.filter((c) => conector.catalogo.some((x) => x.nome === c)));
  const events: RuntimeEvent[] = [];
  const revogar = atuais.filter((c) => plano.revogar.includes(c.capacidade)).map((c) => c.id);
  if (revogar.length > 0) events.push(...((await revogarLote(d, { agenteId, concessaoIds: revogar })).events ?? []));
  if (plano.conceder.length > 0) {
    const r = await concederLote(d, { agenteId, conectorId: conector.id, capacidades: plano.conceder, autorTipo: "pessoa", ...(autor.porRegra ? { porRegra: autor.porRegra } : {}) });
    events.push(...(r.events ?? []));
  }
  const depois = [...nomes.filter((c) => !plano.revogar.includes(c)), ...plano.conceder].sort();
  return { antes: [...nomes].sort(), depois, events };
}

// ------------------------------------------------------------------------------------------------- um bot (a tela)

/**
 * "Nenhum / Ler / Ler e alterar" de um bot num app (POST /agentes/:id/acessos). Marca o bot como definido pela pessoa:
 * daí em diante ele não segue mais o padrão do app.
 */
export const definirNivelDoBot: CasoDeUso<{ agenteId: string; conectorId: string; nivel: NivelDeAcesso }, { concedidas: number; revogadas: number }> = async (d, input) => {
  const agente = await d.repos.agentes.buscar(input.agenteId);
  if (!agente || agente.ownerId !== d.escopo.pessoaId) throw new ErroDeDominio("nao_encontrado", { cause: "agente" });
  const conector = await conectorDaDona(d, input.conectorId, input.nivel);
  const r = await aplicar(d, agente.id, conector, { nivel: input.nivel }, {});
  await d.repos.acessos.marcar(agente.id, conector.id, "pessoa");
  return { data: { concedidas: r.depois.filter((c) => !r.antes.includes(c)).length, revogadas: r.antes.filter((c) => !r.depois.includes(c)).length }, events: r.events };
};

// ------------------------------------------------------------------------------------------------- lote

export type EntradaLote = { conectorId: string; nivel: NivelDeAcesso; bots: "todos" | readonly string[]; chave: string; confirmado?: boolean } & Autor;
export type SaidaLote = { loteId: string | null; app: string; nivel: NivelDeAcesso; aplicados: { agenteId: string; nome: string; antes: NivelAtual }[]; mantidos: { agenteId: string; nome: string; nivel: NivelAtual }[]; frase: string; jaFeito: boolean };

/** O lote guardou o bot com antes = depois: ele só foi mantido (e marcado como escolha), sem mudar o conjunto. */
function mesmoConjuntoGravado(antes: readonly string[] | undefined, depois: readonly string[] | undefined): boolean {
  const a = [...(antes ?? [])].sort();
  const b = [...(depois ?? [])].sort();
  return a.length === b.length && a.every((c, i) => c === b[i]);
}

function chaveValida(chave: unknown): string {
  if (typeof chave !== "string" || chave.length < 8 || chave.length > 80 || !/^[A-Za-z0-9:_-]+$/.test(chave)) throw new ErroDeDominio("entrada_invalida", { cause: "chave" });
  return chave;
}

const definirEmLote: CasoDeUso<EntradaLote, SaidaLote> = async (d, input) => {
  const chave = chaveValida(input.chave);
  const conector = await conectorDaDona(d, input.conectorId, input.nivel);
  if (input.nivel === "escrita" && input.confirmado !== true) throw new ErroDeDominio("estado_invalido", { cause: "confirmacao_necessaria" });
  const meus = await botsDaDona(d);
  const porId = new Map(meus.map((b) => [b.id, b]));
  const todos = input.bots === "todos";
  const pedidos = todos ? meus.map((b) => b.id) : [...new Set(input.bots)];
  if (pedidos.length === 0 && !todos) throw new ErroDeDominio("entrada_invalida", { cause: "nenhum bot" });
  if (pedidos.length > MAX_BOTS_POR_LOTE) throw new ErroDeDominio("entrada_invalida", { cause: `no máximo ${MAX_BOTS_POR_LOTE} bots por vez` });
  // Bot de outra pessoa (ou excluído) é 404, como no nível de um bot: o lote não diz o que existe fora do que é dela.
  if (pedidos.some((id) => !porId.has(id))) throw new ErroDeDominio("nao_encontrado", { cause: "agente" });

  // O mesmo clique reenviado (rede caiu, duplo clique) devolve o lote já feito, sem aplicar de novo.
  const jaFeito = async (): Promise<{ data: SaidaLote } | null> => {
    const ja = await d.repos.acessos.loteDaChave(chave);
    if (!ja) return null;
    if (ja.conectorId !== conector.id || ja.nivel !== input.nivel) throw new ErroDeDominio("estado_invalido", { cause: "chave de outro lote" });
    const aplicados = Object.keys(ja.depois).filter((id) => !mesmoConjuntoGravado(ja.antes[id], ja.depois[id])).map((id) => ({ agenteId: id, nome: porId.get(id)?.nome ?? "", antes: nivelDoConjunto(conector.catalogo, ja.antes[id] ?? []) }));
    return { data: { loteId: ja.id, app: conector.nome, nivel: ja.nivel, aplicados, mantidos: [], frase: fraseDoLote(aplicados.length, ja.nivel, conector.nome), jaFeito: true } };
  };
  const antesDaTrava = await jaFeito();
  if (antesDaTrava) return antesDaTrava;

  const ordenados = [...pedidos].sort();
  const atuais = new Map<string, NivelAtual>();
  for (const id of ordenados) {
    await d.repos.concessoes.travar(id, conector.id);
    atuais.set(id, nivelDoConjunto(conector.catalogo, (await conjuntoAtual(d, id, conector.id)).map((c) => c.capacidade)));
  }
  // Revisão independente do PR #706: o reenvio que chegou enquanto o primeiro ainda rodava esperou nas travas acima;
  // o primeiro já commitou, então a chave é lida de novo aqui (senão via todos no nível e devolvia "0 bots", sem Desfazer).
  const depoisDaTrava = await jaFeito();
  if (depoisDaTrava) return depoisDaTrava;
  const { alvos, mantidos } = alvosDoLote(ordenados.map((id) => ({ agenteId: id, atual: atuais.get(id) ?? "nenhum" })), input.nivel, todos);
  const antes: ConjuntoPorBot = {};
  const depois: ConjuntoPorBot = {};
  const marcasAntes: Record<string, MarcaDeAcesso> = {};
  // QA independente do PR #706: quem já estava no nível pedido também foi escolhido pela pessoa (o "Nenhum explícito"
  // não é "não definido", como no clique da linha). Não muda conjunto; vai no lote com antes = depois só para o Desfazer
  // devolver a marca. Quem o "todos com Ler" não rebaixa fica fora: a pessoa não escolheu o nível dele.
  const escolhidos = mantidos.filter((id) => atuais.get(id) === input.nivel);
  const marcas = alvos.length + escolhidos.length > 0 ? await d.repos.acessos.marcas(conector.id) : new Map<string, MarcaDeAcesso>();
  for (const id of escolhidos) {
    const marca = marcas.get(id);
    if (marca === "pessoa") continue;
    if (marca) marcasAntes[id] = marca;
    const ficou = (await conjuntoAtual(d, id, conector.id)).map((c) => c.capacidade).sort();
    antes[id] = ficou;
    depois[id] = ficou;
    await d.repos.acessos.marcar(id, conector.id, "pessoa");
  }
  const events: RuntimeEvent[] = [];
  for (const id of alvos) {
    const marca = marcas.get(id);
    if (marca) marcasAntes[id] = marca;
    const r = await aplicar(d, id, conector, { nivel: input.nivel }, input);
    antes[id] = r.antes;
    depois[id] = r.depois;
    events.push(...r.events);
    await d.repos.acessos.marcar(id, conector.id, "pessoa");
  }
  let loteId: string | null = null;
  if (alvos.length > 0) {
    const lote = await d.repos.acessos.criarLote({ conectorId: conector.id, nivel: input.nivel, chave, antes, depois, marcasAntes, autorTipo: input.botId ? "bot" : "pessoa", autorId: input.botId ?? d.escopo.pessoaId });
    // A mesma chave gravada por outra transação no meio: o índice único segurou; esta volta inteira.
    if (!lote) throw new ErroDeDominio("estado_invalido", { cause: "lote repetido" });
    loteId = lote.id;
  }
  const nome = (id: string) => porId.get(id)?.nome ?? "";
  return {
    data: {
      loteId,
      app: conector.nome,
      nivel: input.nivel,
      aplicados: alvos.map((id) => ({ agenteId: id, nome: nome(id), antes: atuais.get(id) ?? "nenhum" })),
      mantidos: mantidos.map((id) => ({ agenteId: id, nome: nome(id), nivel: atuais.get(id) ?? "nenhum" })),
      frase: fraseDoLote(alvos.length, input.nivel, conector.nome),
      jaFeito: false,
    },
    events,
  };
};

export type SaidaDesfazer = { voltaram: { agenteId: string; nome: string }[]; mudaramDepois: { agenteId: string; nome: string }[]; app: string };

/**
 * Desfazer um lote (24 h): cada bot cujo conjunto ainda é o que o lote deixou volta ao de antes, exato (inclusive o
 * personalizado); quem mudou depois por outro caminho fica como está e é listado. Uma vez só (o lote fica travado).
 */
const desfazerLote: CasoDeUso<{ loteId: string } & Autor, SaidaDesfazer> = async (d, input) => {
  const lote = await d.repos.acessos.loteTravado(assertUuid(input.loteId, "lote_id"));
  if (!lote) throw new ErroDeDominio("nao_encontrado", { cause: "lote" });
  if (lote.desfeitoEm !== null) throw new ErroDeDominio("estado_invalido", { cause: "lote já desfeito" });
  if (d.agora() - lote.criadoEm > PRAZO_DESFAZER_MS) throw new ErroDeDominio("estado_invalido", { cause: "o Desfazer vale por 24 horas" });
  const conector = await d.repos.conectores.buscar(lote.conectorId);
  if (!conector || conector.ownerId !== d.escopo.pessoaId) throw new ErroDeDominio("nao_encontrado", { cause: "conector" });
  // Segunda cerca (revisão do PR #706): devolver Ler e alterar é dar escrita; a regra do modo nunca faz isso no lugar da pessoa.
  if (input.porRegra && desfazerDevolveEscrita(conector.catalogo, lote.antes, lote.depois)) throw new ErroDeDominio("estado_invalido", { cause: "devolver Ler e alterar espera a pessoa" });
  const porId = new Map((await botsDaDona(d)).map((b) => [b.id, b]));
  const voltaram: SaidaDesfazer["voltaram"] = [];
  const mudaramDepois: SaidaDesfazer["mudaramDepois"] = [];
  const events: RuntimeEvent[] = [];
  for (const id of Object.keys(lote.depois).sort()) {
    const bot = porId.get(id);
    if (!bot) continue;
    await d.repos.concessoes.travar(id, conector.id);
    const agora = (await conjuntoAtual(d, id, conector.id)).map((c) => c.capacidade).sort();
    const esperado = [...(lote.depois[id] ?? [])].sort();
    const soMantido = mesmoConjuntoGravado(lote.antes[id], lote.depois[id]);
    if (agora.length !== esperado.length || agora.some((c, i) => c !== esperado[i])) {
      if (!soMantido) mudaramDepois.push({ agenteId: id, nome: bot.nome });
      continue;
    }
    if (soMantido) {
      // O lote só o marcou como escolha (QA independente do PR #706): volta a marca, o conjunto já é o de antes.
      const marca = lote.marcasAntes[id];
      if (marca) await d.repos.acessos.marcar(id, conector.id, marca);
      else await d.repos.acessos.desmarcar(id, conector.id);
      continue;
    }
    // Voltar a Ler e alterar só sem `porRegra` (a pessoa clicou); a volta só de Ler pode ir pela regra do modo.
    const r = await aplicar(d, id, conector, { conjunto: lote.antes[id] ?? [] }, input);
    events.push(...r.events);
    // A marca volta junto: quem era "não definido" volta a herdar o padrão do app.
    const marca = lote.marcasAntes[id];
    if (marca) await d.repos.acessos.marcar(id, conector.id, marca);
    else await d.repos.acessos.desmarcar(id, conector.id);
    voltaram.push({ agenteId: id, nome: bot.nome });
  }
  await d.repos.acessos.marcarDesfeito(lote.id);
  return { data: { voltaram, mudaramDepois, app: conector.nome }, events };
};

// ------------------------------------------------------------------------------------------------- padrão do app

export type SaidaPadrao = { app: string; padrao: NivelDeAcesso; anterior: NivelDeAcesso; aplicados: { agenteId: string; nome: string }[] };

/**
 * O padrão do app: o bot novo nasce com ele (aplicarPadroes) e, com `aplicar` (padrão: sim), quem segue o padrão
 * (não definido, ou marcado 'padrao' ainda no nível anterior) passa ao novo. Quem a pessoa escolheu fica.
 */
const definirPadrao: CasoDeUso<{ conectorId: string; nivel: NivelDeAcesso; aplicar?: boolean; confirmado?: boolean } & Autor, SaidaPadrao> = async (d, input) => {
  const conector = await d.repos.conectores.buscar(input.conectorId);
  if (!conector || conector.ownerId !== d.escopo.pessoaId) throw new ErroDeDominio("nao_encontrado", { cause: "conector" });
  if (input.nivel !== "nenhum" && capacidadesDoNivel(conector.catalogo, input.nivel).length === 0) throw new ErroDeDominio("estado_invalido", { cause: "o app não tem ferramenta para esse nível" });
  if (input.nivel === "escrita" && input.confirmado !== true) throw new ErroDeDominio("estado_invalido", { cause: "confirmacao_necessaria" });
  const anterior = await d.repos.acessos.definirPadrao(conector.id, input.nivel);
  const aplicados: SaidaPadrao["aplicados"] = [];
  const events: RuntimeEvent[] = [];
  // App desligado guarda o padrão, mas não concede nada agora (o nível de cada bot só vale com o app ligado).
  if (input.aplicar !== false && (conector.habilitado || input.nivel === "nenhum")) {
    for (const bot of [...(await botsDaDona(d))].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      await d.repos.concessoes.travar(bot.id, conector.id);
      // A marca é lida DEPOIS da trava: quem a pessoa acabou de escolher (outra tx, mesma trava) não volta ao padrão.
      const atual = nivelDoConjunto(conector.catalogo, (await conjuntoAtual(d, bot.id, conector.id)).map((c) => c.capacidade));
      if (!segueOPadrao(await d.repos.acessos.marca(bot.id, conector.id), atual, anterior)) continue;
      if (atual !== input.nivel) {
        events.push(...(await aplicar(d, bot.id, conector, { nivel: input.nivel }, input)).events);
        aplicados.push({ agenteId: bot.id, nome: bot.nome });
      }
      await d.repos.acessos.marcar(bot.id, conector.id, "padrao" satisfies MarcaDeAcesso);
    }
  }
  return { data: { app: conector.nome, padrao: input.nivel, anterior, aplicados }, events };
};

/** O bot que acabou de nascer recebe o padrão de cada app ligado da dona (ADA-241). Sem padrão, nada muda. */
export async function aplicarPadroes(d: Deps, agenteId: string): Promise<RuntimeEvent[]> {
  const events: RuntimeEvent[] = [];
  for (const p of await d.repos.acessos.padroes()) {
    const conector = await d.repos.conectores.buscar(p.conectorId);
    if (!conector || conector.ownerId !== d.escopo.pessoaId || !conector.habilitado) continue;
    const caps = capacidadesDoNivel(conector.catalogo, p.nivel);
    if (caps.length === 0) continue;
    events.push(...((await concederLote(d, { agenteId, conectorId: conector.id, capacidades: caps, autorTipo: "pessoa" })).events ?? []));
    await d.repos.acessos.marcar(agenteId, conector.id, "padrao");
  }
  return events;
}

/** Quem fica com quem na gaveta: o padrão e, por bot, o nível e se segue o padrão (GET /conectores/:id/acessos). */
export async function verAcessosDoApp(d: Deps, conectorId: string): Promise<{ padrao: NivelDeAcesso; bots: { agenteId: string; nivel: NivelAtual; seguePadrao: boolean }[] }> {
  const conector = await d.repos.conectores.buscar(conectorId);
  if (!conector || conector.ownerId !== d.escopo.pessoaId) throw new ErroDeDominio("nao_encontrado", { cause: "conector" });
  const padrao = await d.repos.acessos.padrao(conector.id);
  const marcas = await d.repos.acessos.marcas(conector.id);
  const bots = [];
  for (const b of await botsDaDona(d)) {
    const nivel = nivelDoConjunto(conector.catalogo, (await conjuntoAtual(d, b.id, conector.id)).map((c) => c.capacidade));
    bots.push({ agenteId: b.id, nivel, seguePadrao: segueOPadrao(marcas.get(b.id) ?? null, nivel, padrao) });
  }
  return { padrao, bots };
}

export const EXECUTORES_ACESSOS = {
  "acessos.dar_em_lote": definirEmLote,
  "acessos.desfazer_lote": desfazerLote,
  "apps.padrao": definirPadrao,
} as const satisfies Partial<Record<IdAcao, CasoDeUso<never, unknown>>>;
