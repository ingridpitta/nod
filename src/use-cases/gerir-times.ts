import type { AcaoNoLote, PayloadPropostaLoteBots } from "../contracts/conversa.ts";
import type { RuntimeEvent } from "../contracts/evento.ts";
import { MAX_ACOES_TIMES, TIPOS_ACAO_TIMES, type AcaoTimes, type ErroGerirTimes, type ResultadoGerirTimes } from "../contracts/ferramentas-times.ts";
import type { CasoNod, SaidaCasoDeUso } from "../contracts/servicos.ts";
import { NOME_SEM_TIME, type Time } from "../contracts/time.ts";
import type { Turno } from "../contracts/turno.ts";
import { ACOES_TIMES } from "../domain/acoes/times.ts";
import { ehErroDeDominio, ErroDeDominio } from "../domain/erro.ts";
import { decidirPeloModo, semRevisor } from "../domain/modo-aprovacao.ts";
import { ehNod } from "../domain/nod.ts";
import { acharTime, chaveDaSecao, chaveDoTime, listaFalada, nomeLimpo, problemaDoNome } from "../domain/times.ts";
import { log } from "../obs/log.ts";
import { EXECUTORES_TIMES, listarTimes, moverBotsParaTime } from "./acoes/times.ts";
import { evento, PRAZO_DECISAO_PADRAO_MS } from "./autoria-evento.ts";
import { autoriaDoAgente } from "./registrar-negacao.ts";
import { emSavepoint } from "./savepoint.ts";
import type { Deps } from "./tipos.ts";

/** O risco vem do registro (QA do PR #632: o mutante que mudava o registro passava sem efeito). */
const RISCO_DO_EXCLUIR = ACOES_TIMES.find((a) => a.id === "times.excluir")?.risco;

/**
 * gerir_times (definido em 2026-11-02, NOD-437, ADR-135): a via do chat das ações `times.*` e do bots.mover em lote, para
 * QUALQUER bot, na conversa com a pessoa. O lote inteiro é validado antes (o estado simulado ação a ação: nome repetido,
 * nome ambíguo, bot que não existe ou é uma pessoa) — qualquer problema e nada roda. Depois cada ação chama o MESMO
 * executor da tela, na ordem, com o bot como autor em nome da pessoa ("pedido por Marlon via Edu"); se uma falha, o lote
 * inteiro volta (savepoint). Excluir um time que tem bots não roda: espera a pessoa num card (o lote dos bots, tipo
 * excluir_time), salvo no modo "Ignorar todas as aprovações".
 *
 * Cercas: o turno é do bot, é conversa ou criação, de primeira mão (sem procuração de colega), não foi parado e nada de
 * fora entrou nele — os times são da pessoa, e só ela (falando com o bot) os reorganiza.
 */

const MODOS = new Set(["conversa", "criacao"]);
const INSTRUCAO: Record<ErroGerirTimes, string> = {
  fora_da_conversa: "Nada mudou. gerir_times só vale na conversa com a pessoa, a pedido dela.",
  entrada_invalida: "Nada mudou. Corrija os problemas e chame gerir_times de novo com o lote inteiro.",
  nome_ambiguo: "Nada mudou. Pergunte à pessoa qual time ela quis dizer (ex.: \"Produto ou Produção?\") e chame de novo com o nome exato.",
};

type Problema = { i: number; motivo: string; opcoes?: string[] };
const falha = (erro: ErroGerirTimes, problemas: Problema[], detalhe?: string): SaidaCasoDeUso<ResultadoGerirTimes> => ({ data: { ok: false, erro, problemas, instrucao: detalhe ? `${detalhe} ${INSTRUCAO[erro]}` : INSTRUCAO[erro] } });

const nomeDoTime = (nome: string): string => (nome === "" ? NOME_SEM_TIME : nome);

type BotSimples = { id: string; nome: string; secao?: string };
/** Uma ação resolvida: o time alvo pela chave (resolve-se o id na hora de rodar) e os bots pelos ids. */
type Resolvida = AcaoTimes & { i: number; chave: string; nomeAlvo: string; botsIds: string[]; botsNomes: string[] };

function resolverBots(pedidos: readonly string[], bots: readonly BotSimples[], i: number, problemas: Problema[]): BotSimples[] {
  const achados: BotSimples[] = [];
  for (const p of pedidos) {
    const porId = bots.find((b) => b.id === p);
    const porNome = bots.filter((b) => b.nome.trim().toLowerCase() === p.trim().toLowerCase());
    if (porId) achados.push(porId);
    else if (porNome.length === 1) achados.push(porNome[0]!);
    else if (porNome.length > 1) problemas.push({ i, motivo: `há mais de um bot chamado "${p}": use o id (ver_colegas)` });
    else problemas.push({ i, motivo: `"${p}" não é um bot da pessoa. Se for uma pessoa, explique em uma linha que times são só de bots` });
  }
  return achados;
}

/**
 * Valida o lote contra os times de agora, simulando cada ação (o nome criado vale para a próxima, e quem está em cada
 * time também). Revisão 1 (M1): o excluir que vai esperar o card (o time tem bots e o modo pede a pessoa) NÃO tira o
 * time da simulação — ele continua existindo até ela aprovar, então criar outro com o mesmo nome no lote é erro claro.
 */
export function validarLoteDeTimes(acoes: readonly AcaoTimes[], times: readonly Time[], bots: readonly BotSimples[], o: { semCartao?: boolean } = {}): { ok: true; acoes: Resolvida[] } | { ok: false; ambiguo: boolean; problemas: Problema[] } {
  const problemas: Problema[] = [];
  let ambiguo = false;
  if (acoes.length === 0) problemas.push({ i: -1, motivo: "nenhuma ação" });
  if (acoes.length > MAX_ACOES_TIMES) problemas.push({ i: -1, motivo: `no máximo ${MAX_ACOES_TIMES} ações por pedido; divida em partes` });
  // O estado simulado: id fictício para os times criados no lote.
  let sim = times.map((t) => ({ id: t.id, nome: t.nome }));
  const ondeEsta = new Map(bots.map((b) => [b.id, chaveDaSecao(b.secao)]));
  const resolvidas: Resolvida[] = [];
  acoes.forEach((a, i) => {
    const antes = problemas.length;
    const erro = (motivo: string) => problemas.push({ i, motivo });
    if (!(TIPOS_ACAO_TIMES as readonly string[]).includes(a.tipo)) return void erro(`tipo "${String(a.tipo).slice(0, 20)}" não existe`);
    if (typeof a.time !== "string" || a.time.trim() === "") return void erro("falta o time");
    let chave = "";
    let nomeAlvo = "";
    if (a.tipo === "criar") {
      const p = problemaDoNome(a.time, sim);
      if (p?.problema === "nome_repetido") erro(`já existe o time ${p.existente?.nome ?? a.time}`);
      else if (p?.problema === "nome_reservado") erro("Sem time já existe e não é um time novo");
      else if (p) erro(p.problema === "nome_vazio" ? "o nome do time está vazio" : "o nome do time passa de 60 caracteres");
      nomeAlvo = nomeLimpo(a.time);
      chave = chaveDoTime(nomeAlvo);
    } else {
      const porId = sim.find((t) => t.id === a.time);
      const r = porId ? { time: porId } : acharTime(a.time, sim);
      if ("time" in r) {
        chave = chaveDoTime(r.time.nome);
        nomeAlvo = r.time.nome;
      } else if (r.parecidos.length > 0) {
        ambiguo = true;
        problemas.push({ i, motivo: `não há time "${a.time}"; parecidos: ${r.parecidos.map((t) => t.nome).join(", ")}`, opcoes: r.parecidos.map((t) => t.nome) });
      } else erro(`não há time "${a.time}"${a.tipo === "mover" ? " (mover para um time novo: crie-o antes no mesmo lote)" : ""}`);
      if ((a.tipo === "renomear" || a.tipo === "excluir") && "time" in r && r.time.nome === "") erro("Sem time não se renomeia nem se exclui");
    }
    if (a.tipo === "renomear") {
      if (typeof a.nome !== "string") erro("renomear precisa do nome novo");
      else {
        const p = problemaDoNome(a.nome, sim, sim.find((t) => chaveDoTime(t.nome) === chave)?.id);
        if (p) erro(p.problema === "nome_repetido" ? `já existe o time ${p.existente?.nome ?? a.nome}` : p.problema === "nome_reservado" ? "Sem time é reservado" : "nome inválido");
      }
    } else if (a.nome !== undefined) erro(`${a.tipo} não leva nome (o time vai em time)`);
    if (a.tipo === "ordenar" && (!Number.isInteger(a.posicao) || (a.posicao ?? 0) < 1)) erro("ordenar precisa da posicao (1 = o topo)");
    if (a.posicao !== undefined && a.tipo !== "ordenar" && a.tipo !== "criar") erro(`${a.tipo} não leva posicao`);
    if (a.tipo === "recolher" && typeof a.recolhido !== "boolean") erro("recolher precisa de recolhido (true ou false)");
    if (a.recolhido !== undefined && a.tipo !== "recolher" && a.tipo !== "criar") erro(`${a.tipo} não leva recolhido`);
    if (a.tipo === "mover" && !(a.bots?.length)) erro("mover precisa dos bots");
    if (a.bots !== undefined && a.tipo !== "mover" && a.tipo !== "criar") erro(`${a.tipo} não leva bots`);
    const achados = a.bots ? resolverBots(a.bots, bots, i, problemas) : [];
    if (problemas.length > antes) return;
    // Aplica a ação ao estado simulado.
    if (a.tipo === "criar") sim = [...sim, { id: `novo:${i}`, nome: nomeAlvo }];
    else if (a.tipo === "renomear") {
      const nova = chaveDoTime(nomeLimpo(a.nome ?? ""));
      sim = sim.map((t) => (chaveDoTime(t.nome) === chave ? { ...t, nome: nomeLimpo(a.nome ?? "") } : t));
      for (const [id, c] of ondeEsta) if (c === chave) ondeEsta.set(id, nova);
    } else if (a.tipo === "excluir") {
      const temBots = [...ondeEsta.values()].some((c) => c === chave);
      if (!temBots || o.semCartao) {
        sim = sim.filter((t) => chaveDoTime(t.nome) !== chave);
        for (const [id, c] of ondeEsta) if (c === chave) ondeEsta.set(id, "");
      }
    }
    if (a.tipo === "criar" || a.tipo === "mover") for (const b of achados) ondeEsta.set(b.id, chave);
    resolvidas.push({ ...a, i, chave, nomeAlvo, botsIds: achados.map((b) => b.id), botsNomes: achados.map((b) => b.nome) });
  });
  return problemas.length ? { ok: false, ambiguo: ambiguo && problemas.every((p) => p.opcoes), problemas } : { ok: true, acoes: resolvidas };
}

const naConversa = (t: Pick<Turno, "origem" | "profundidade">, modo: string | null): boolean => !!modo && MODOS.has(modo) && t.profundidade === 0;

export const gerirTimes: CasoNod<Deps, "gerir_times"> = async (deps, input) => {
  const turno = await deps.repos.turnos.buscar(input.turnoId);
  const modo = input.plano?.modoTurno ?? turno?.origem ?? null;
  if (!turno || turno.agenteId !== input.agenteId || turno.conversaId !== input.conversaId || !naConversa(turno, modo)) return falha("fora_da_conversa", []);
  const agente = await deps.repos.agentes.buscar(input.agenteId);
  if (!agente || agente.ownerId !== deps.escopo.pessoaId || (turno.sobProcuracaoDe != null && turno.sobProcuracaoDe !== deps.escopo.pessoaId)) return falha("fora_da_conversa", [], "Os times são da pessoa: só um bot dela, falando com ela, os muda.");
  if (turno.pararSolicitadoEm != null || turno.estado === "interrompido") return falha("fora_da_conversa", [], "Este turno foi parado.");
  const limpo = turno.entradaConfianca === "confiavel" && input.plano?.confiancaEntrada !== "nao_confiavel" && !(await deps.repos.turnos.contaminado(turno.id));
  if (!limpo) return falha("fora_da_conversa", [], "Este turno leu conteúdo de fora: os times só mudam a pedido direto da pessoa.");
  if (typeof input.resumo !== "string" || input.resumo.trim() === "") return falha("entrada_invalida", [{ i: -1, motivo: "falta o resumo" }]);

  const { data } = await listarTimes(deps, {});
  const todos = await deps.repos.agentes.listar({ incluirOcultos: true });
  const bots = todos.filter((b) => b.ownerId === deps.escopo.pessoaId && b.dono === "pessoa" && !ehNod(b) && b.excluidoEm === null).map((b) => ({ id: b.id, nome: b.nome, secao: b.secao ?? "", posicao: b.posicao ?? null }));
  // ADR-135 (emenda NOD-437): times.excluir é "arriscada"; o modo decide o card (manual e automático pedem, o total
  // roda direto). Sem revisor na v1, como o gerir_bots: o "revisar" vira o card.
  const semCartao = semRevisor(decidirPeloModo(agente.modoAprovacao, { arriscada: RISCO_DO_EXCLUIR === "arriscada", credencial: false }))?.automatico === true;
  const v = validarLoteDeTimes(input.acoes ?? [], data.times, bots, { semCartao });
  if (!v.ok) return falha(v.ambiguo ? "nome_ambiguo" : "entrada_invalida", v.problemas);

  const autoria = autoriaDoAgente(deps.escopo, agente.id);
  const feitas: { i: number; linha: string }[] = [];
  const cartao: AcaoNoLote[] = [];
  const events: RuntimeEvent[] = [];
  const idDe = async (chave: string): Promise<string> => {
    const t = (await deps.repos.times.listar()).find((x) => chaveDoTime(x.nome) === chave);
    if (!t) throw new ErroDeDominio("nao_encontrado", { cause: "time" });
    return t.id;
  };
  let falhou: { i: number; motivo: string } | null = null;
  try {
    await emSavepoint(deps, async () => {
      for (const a of v.acoes) {
        try {
          const n = nomeDoTime(a.nomeAlvo);
          switch (a.tipo) {
            case "criar": {
              const r = await EXECUTORES_TIMES["times.criar"](deps, { nome: a.time, ...(a.posicao !== undefined ? { posicao: a.posicao - 1 } : {}), ...(a.recolhido !== undefined ? { recolhido: a.recolhido } : {}), ...(a.botsIds.length ? { bots: a.botsIds } : {}), autoria });
              events.push(...(r.events ?? []));
              feitas.push({ i: a.i, linha: `Time ${r.data.time.nome} criado${a.posicao === 1 ? " no topo" : ""}${a.botsNomes.length ? `, com ${listaFalada(a.botsNomes)}` : ""}` });
              break;
            }
            case "renomear": {
              const r = await EXECUTORES_TIMES["times.renomear"](deps, { timeId: await idDe(a.chave), nome: a.nome ?? "", autoria });
              events.push(...(r.events ?? []));
              feitas.push({ i: a.i, linha: `Time ${n} agora se chama ${r.data.time.nome}` });
              break;
            }
            case "excluir": {
              const timeId = await idDe(a.chave);
              const vivos = (await deps.repos.agentes.listar({ incluirOcultos: true })).filter((b) => b.ownerId === deps.escopo.pessoaId && b.dono === "pessoa" && b.excluidoEm === null && chaveDaSecao(b.secao) === a.chave).sort((x, y) => (x.posicao ?? Infinity) - (y.posicao ?? Infinity));
              if (vivos.length > 0 && !semCartao) {
                cartao.push({ tipo: "excluir_time", time_id: timeId, membros: vivos.map((b) => b.nome), i: a.i, estado: "esperando", motivo: "arriscada", alvoNome: n, botId: null, alvoDaAcao: null });
                break;
              }
              const r = await EXECUTORES_TIMES["times.excluir"](deps, { timeId, autoria });
              events.push(...(r.events ?? []));
              feitas.push({ i: a.i, linha: `Time ${n} excluído${r.data.bots.length ? `; ${listaFalada(r.data.bots.map((b) => b.nome))} ${r.data.bots.length === 1 ? "está" : "estão"} em Sem time` : ""}` });
              break;
            }
            case "ordenar": {
              const r = await EXECUTORES_TIMES["times.ordenar"](deps, { timeId: await idDe(a.chave), posicao: (a.posicao ?? 1) - 1, autoria });
              events.push(...(r.events ?? []));
              feitas.push({ i: a.i, linha: `Time ${n} na posição ${r.data.time.posicao + 1}` });
              break;
            }
            case "recolher": {
              const r = await EXECUTORES_TIMES["times.recolher"](deps, { timeId: await idDe(a.chave), recolhido: a.recolhido === true, autoria });
              events.push(...(r.events ?? []));
              feitas.push({ i: a.i, linha: `Time ${n} ${a.recolhido ? "recolhido" : "aberto"}` });
              break;
            }
            case "mover": {
              const r = await moverBotsParaTime(deps, { bots: a.botsIds, time: a.nomeAlvo, autoria });
              events.push(...(r.events ?? []));
              feitas.push({ i: a.i, linha: `${listaFalada(a.botsNomes)} em ${n}` });
              break;
            }
          }
        } catch (e) {
          if (!ehErroDeDominio(e)) throw e;
          falhou = { i: a.i, motivo: typeof e.cause === "string" ? `${e.codigo} (${e.cause})` : e.codigo };
          throw e;
        }
      }
    });
  } catch (e) {
    if (!falhou || !ehErroDeDominio(e)) throw e;
    return falha("entrada_invalida", [falhou]);
  }

  const agora = deps.agora();
  let decisaoId: string | null = null;
  if (cartao.length > 0) {
    const resumo = input.resumo.trim();
    const payload: PayloadPropostaLoteBots = { kind: "lote_bots", resumo, acoes: cartao.map((c, k) => ({ ...c, i: k })), turnoId: input.turnoId };
    const proposta = await deps.repos.propostas.criar({ conversaId: input.conversaId, agenteId: agente.id, payload });
    if (!proposta) throw new ErroDeDominio("estado_invalido", { cause: "proposta não criada" });
    const decisao = await deps.repos.decisoes.criar({ id: proposta.id, tipo: "lote_bots", agenteId: agente.id, conversaId: input.conversaId, turnoId: input.turnoId, prazoDecisaoEm: agora + PRAZO_DECISAO_PADRAO_MS, frase: resumo });
    decisaoId = proposta.id;
    events.push(evento(deps.escopo, { kind: "proposta_criada", autoria, agora, conversaId: input.conversaId, turnoId: input.turnoId, dados: { proposta_id: proposta.id, kind: "lote_bots", acoes: cartao.length } }));
    if (decisao) events.push(evento(deps.escopo, { kind: "decisao_criada", autoria, agora, conversaId: input.conversaId, turnoId: input.turnoId, dados: { decisao_id: decisao.id, tipo: "lote_bots" } }));
  }

  // O histórico: quem pediu e por qual bot (a Atividade e a conversa mostram a linha).
  if (feitas.length > 0) {
    const pessoa = await deps.repos.pessoas.buscar(deps.escopo.pessoaId);
    const texto = `${feitas.map((f) => f.linha).join(". ")}. Pedido por ${pessoa?.nome ?? "você"} via bot ${agente.nome}.`;
    const m = await deps.repos.mensagens.criar({ conversaId: input.conversaId, turnoId: input.turnoId, autoria, kind: "sistema", assunto: "times.organizados", texto, confianca: "confiavel" });
    if (m) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: input.conversaId, turnoId: input.turnoId, dados: { mensagem_id: m.id, kind: "sistema" } }));
  }
  log("info", "gerir_times", { acoes: v.acoes.length, feitas: feitas.length, esperando: cartao.length });
  const instrucao = cartao.length > 0
    ? `${feitas.length ? `Feito: ${feitas.map((f) => f.linha).join("; ")}. ` : ""}Excluir ${cartao.map((c) => `o time ${c.alvoNome}`).join(" e ")} espera a pessoa no card desta conversa (os bots vão para Sem time, nenhum é excluído). Diga isso em uma frase e encerre o turno.`
    : `Pronto: ${feitas.map((f) => f.linha).join("; ")}. Conte em uma frase curta ("Pronto. Time Marketing criado no topo, com a Bia e a Vivi"); a pessoa desfaz pela barra ou pedindo de novo.`;
  return { data: { ok: true, feitas, esperando: cartao.map((_, k) => k), decisao_id: decisaoId, instrucao }, events };
};
