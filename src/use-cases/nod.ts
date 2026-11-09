import type { Agente } from "../contracts/agente.ts";
import type { AppConectado, ArgsRegistrarRelato, ResultadoRegistrarRelato, ResultadoVerAppsConectados } from "../contracts/ferramentas-do-nod.ts";
import type { ContextoFerramenta, SaidaCasoDeUso } from "../contracts/servicos.ts";
import type { Turno } from "../contracts/turno.ts";
import { capacidadesDoNivel } from "../domain/grupos-de-acesso.ts";
import { ehNod } from "../domain/nod.ts";
import { redigirSegredos } from "../domain/segredos.ts";
import { log } from "../obs/log.ts";
import { autoriaAgente, evento } from "./autoria-evento.ts";
import { trechoDoRelato } from "./registrar-relato.ts";
import type { Deps } from "./tipos.ts";

/**
 * O que só o Nod faz (definido em 2026-10-07, ADR-081/082). A cerca 2 das mãos do Nod mora aqui: as ferramentas dele
 * só valem num turno DELE em que quem fala é a pessoa (conversa ou criação). Pedido de colega não chega nele (resolverAlvo
 * recusa), mas rotina, sala, ligação e delegação também ficam de fora — o catálogo já não tem as ferramentas nesses
 * modos (plano-turno.ts); aqui é a segunda trava, no servidor.
 */

/** definido em 2026-10-07: 20 relatos por pessoa em 24 h — acima disso o Nod está anotando conversa, não bug. */
export const MAX_RELATOS_DO_NOD_POR_DIA = 20;
const DIA_MS = 24 * 60 * 60 * 1000;
/** Quantas mensagens recentes da conversa do Nod vão no trecho do relato. */
export const MENSAGENS_NO_RELATO_DO_NOD = 10;

const MODOS_DA_PESSOA = new Set(["conversa", "criacao"]);

/**
 * O turno é de um bot da pessoa (o Nod, com `nod`; um bot comum, sem) e é a pessoa falando com ele (conversa ou
 * criação); null = a ferramenta recusa com `fora_da_conversa`. revisto em 2026-10-13 (revisão do PR #309): o mesmo
 * portão serve ao criar_bots dos bots comuns, em vez de uma cópia.
 */
export async function turnoComAPessoa(deps: Deps, ctx: ContextoFerramenta, quem: "nod" | "bot_comum"): Promise<{ agente: Agente; turno: Turno } | null> {
  const [agente, turno] = await Promise.all([deps.repos.agentes.buscar(ctx.agenteId), deps.repos.turnos.buscar(ctx.turnoId)]);
  if (!agente || ehNod(agente) !== (quem === "nod") || agente.ownerId !== deps.escopo.pessoaId) return null;
  if (!turno || turno.agenteId !== agente.id) return null;
  const modo = ctx.plano?.modoTurno ?? (turno.origem === "conversa" ? "conversa" : null);
  if (!modo || !MODOS_DA_PESSOA.has(modo)) return null;
  return { agente, turno };
}

/** O turno é do Nod da pessoa e é a pessoa falando com ele; null = a ferramenta recusa com `fora_da_conversa`. */
export function turnoDoNodComAPessoa(deps: Deps, ctx: ContextoFerramenta): Promise<{ agente: Agente; turno: Turno } | null> {
  return turnoComAPessoa(deps, ctx, "nod");
}

/** Os apps que a PESSOA conectou (conector dela, habilitado) e os níveis de acesso que cada um permite. */
export async function appsDaPessoa(deps: Deps): Promise<AppConectado[]> {
  return (await deps.repos.conectores.listarHabilitados())
    .filter((c) => c.ownerId === deps.escopo.pessoaId)
    .map((c) => ({
      slug: c.slug,
      nome: c.nome,
      niveis: (["leitura", "escrita"] as const).filter((n) => capacidadesDoNivel(c.catalogo, n).length > 0),
    }))
    .filter((a) => a.niveis.length > 0);
}

/** ver_apps_conectados: só lê. */
export async function verAppsConectados(deps: Deps, input: ContextoFerramenta): Promise<SaidaCasoDeUso<ResultadoVerAppsConectados>> {
  if (!(await turnoDoNodComAPessoa(deps, input))) return { data: { ok: false, erro: "fora_da_conversa" } };
  return { data: { ok: true, apps: await appsDaPessoa(deps) } };
}

/**
 * registrar_relato (0062, a caixa do Nod): o bug, a ideia ou a dúvida que a pessoa contou vira um relato com origem
 * 'nod', sem mensagem apontada, e a prosa (título, texto e o trecho recente da conversa) vai redigida para
 * `relato_prosa`, privada e apagável (ADR-004). O evento leva só escalares.
 */
export async function registrarRelatoDoNod(deps: Deps, input: ContextoFerramenta & ArgsRegistrarRelato): Promise<SaidaCasoDeUso<ResultadoRegistrarRelato>> {
  const ctx = await turnoDoNodComAPessoa(deps, input);
  if (!ctx) return { data: { ok: false, erro: "fora_da_conversa", instrucao: "Só o Nod, na conversa com a pessoa, anota relatos." } };
  const agora = deps.agora();
  if ((await deps.repos.relatos.contarDoNodDesde(agora - DIA_MS)) >= MAX_RELATOS_DO_NOD_POR_DIA) {
    return { data: { ok: false, erro: "limite_do_dia", instrucao: `Já foram ${MAX_RELATOS_DO_NOD_POR_DIA} relatos nas últimas 24 horas. Diga à pessoa que anota o resto amanhã.` } };
  }
  const anexadas = await deps.repos.mensagens.listarDaConversa(input.conversaId, MENSAGENS_NO_RELATO_DO_NOD);
  const relato = await deps.repos.relatos.criar({
    mensagemId: null,
    tipo: input.tipo,
    origem: "nod",
    conversaId: input.conversaId,
    turnoId: input.turnoId,
    categoria: input.tipo === "bug" ? input.categoria ?? "outro" : "outro",
    alcance: "janela",
    mensagensAnexadas: anexadas.length,
    estadoTurno: null,
    origemTurno: ctx.turno.origem,
    sinais: null,
    motivoFalha: null,
    motivoInterrupcao: null,
    modelo: ctx.turno.modelo ?? null,
    harness: ctx.turno.harness ?? null,
    executor: null,
    machineId: ctx.turno.machineId ?? null,
    custoUsd: null,
    reenvios: null,
    confiancaMensagem: "confiavel",
    mensagemParcial: false,
    versaoApp: null,
    correlationId: null,
  });
  if (!relato) return { data: { ok: false, erro: "fora_da_conversa", instrucao: "Não deu para anotar agora." } };
  await deps.repos.relatos.gravarProsa({ relatoId: relato.id, titulo: redigirSegredos(input.titulo.trim()).slice(0, 120) || null, textoPessoa: redigirSegredos(input.texto.trim()), trecho: trechoDoRelato(anexadas) });
  log("info", "relato_do_nod", { tipo: input.tipo, mensagens: anexadas.length });
  const events = [
    evento(deps.escopo, {
      kind: "relato_criado",
      autoria: autoriaAgente({ agenteId: input.agenteId, contaDeExecucao: deps.escopo.pessoaId, executor: "local" }),
      agora,
      conversaId: input.conversaId,
      turnoId: input.turnoId,
      dados: { relato_id: relato.id, categoria: relato.categoria, alcance: relato.alcance, mensagens_anexadas: relato.mensagensAnexadas, com_diagnostico: false, tipo: relato.tipo, origem: relato.origem },
    }),
  ];
  return { data: { ok: true, relato_id: relato.id, instrucao: "Anotado. Diga à pessoa, numa frase, que o time do nod vai ver em Relatos (menu da conta)." }, events };
}
