import type { Decisao } from "../contracts/decisao.ts";
import type { Executor } from "../contracts/evento.ts";
import type { Mensagem } from "../contracts/mensagem.ts";
import type { Turno } from "../contracts/turno.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { redigir } from "../domain/redacao.ts";
import { autoriaPessoa, evento, PRAZO_DECISAO_PADRAO_MS } from "./autoria-evento.ts";
import { fecharGemeas } from "./fechar-gemeas.ts";
import { enfileirarRetomada } from "./enfileirar-retomada.ts";
import { cadeiaDoQuadroEncerrada } from "./quadro-execucoes.ts";
import { sincronizarTrabalho } from "./trabalhos.ts";
import type { CasoDeUso } from "./tipos.ts";

export type EntradaRetomarTurno = ({ decisaoId: string; turnoId?: undefined } | { turnoId: string; decisaoId?: undefined }) & {
  texto: string;
  prazoMs?: number;
  executor?: Executor;
};

export type SaidaRetomarTurno = { turno: Turno; original: Turno; mensagem: Mensagem; sessaoCli: string | null; decisao: Decisao | null };

/**
 * Retomada por frase humana (E5.4, ADR-009/010): NUNCA requeue — nasce um turno NOVO origem 'retomada'
 * apontando para o interrompido (retoma_turno_id, reenvios+1) com a frase da pessoa como entrada; a
 * conversa guarda a sessão do CLI, e o plano do turno novo leva --resume (L5). A frase fica registrada
 * como a informação que destravou. Se veio por decisão 'retomar_turno', a decisão é decidida aqui.
 */
export const retomarTurno: CasoDeUso<EntradaRetomarTurno, SaidaRetomarTurno> = async (deps, input) => {
  const texto = typeof input.texto === "string" ? input.texto.trim() : "";
  if (texto === "") throw new ErroDeDominio("texto_vazio");
  const agora = deps.agora();

  let decisao: Decisao | null = null;
  let turnoId = input.turnoId ?? null;
  if (input.decisaoId !== undefined) {
    decisao = await deps.repos.decisoes.buscar(input.decisaoId);
    if (!decisao) throw new ErroDeDominio("nao_encontrado");
    if (decisao.tipo !== "retomar_turno" || !decisao.turnoId) throw new ErroDeDominio("estado_invalido", { cause: "decisão não é de retomada" });
    // Decisão já decidida/vencida não retoma de novo por este caminho (a pessoa ainda pode retomar pelo turno).
    if (decisao.estado !== "pendente" && decisao.estado !== "reaberta") throw new ErroDeDominio("estado_invalido", { cause: `decisão ${decisao.estado}` });
    turnoId = decisao.turnoId;
  }
  if (!turnoId) throw new ErroDeDominio("entrada_invalida", { cause: "turnoId" });
  const original = await deps.repos.turnos.buscar(turnoId);
  if (!original) throw new ErroDeDominio("nao_encontrado");
  if (original.estado !== "interrompido") throw new ErroDeDominio("estado_invalido", { cause: `turno ${original.estado}` });
  // Revisão 3 do PR #625 (NOD-418): a cadeia de um trabalho do quadro já substituído (nova tentativa, Repetir, Cancelar)
  // ou tratado de vez (Bloqueado) não volta a rodar ao lado do trabalho novo ou com o card parado.
  const encerrada = await cadeiaDoQuadroEncerrada(deps, original.id);
  if (encerrada) throw new ErroDeDominio("estado_invalido", { cause: encerrada });
  const conversa = await deps.repos.conversas.buscar(original.conversaId);
  if (!conversa) throw new ErroDeDominio("nao_encontrado");

  await deps.repos.paradas.encerrarAbertas({ conversaId: conversa.id, agora });
  const autoria = autoriaPessoa(deps.escopo, input.executor ?? "catcher");
  const mensagem = await deps.repos.mensagens.criar({ conversaId: conversa.id, autoria, kind: "texto", texto, confianca: "confiavel" });
  if (!mensagem) throw new ErroDeDominio("nao_permitido");
  const aviso = await deps.repos.mensagens.criar({
    conversaId: conversa.id,
    autoria,
    kind: "sistema",
    assunto: "turno.retomado",
    texto: redigir("retomada", agora, { motivo: original.motivoInterrupcao ?? "desconhecido" }),
    confianca: "confiavel",
  });

  // retomar não lava a marca (revisão da ADR-047): enfileirarRetomada copia a confiança do turno original.
  const { turno, nova } = await enfileirarRetomada(deps, {
    original,
    prazoEm: agora + (input.prazoMs ?? PRAZO_DECISAO_PADRAO_MS),
    entradaTexto: texto,
    reenvios: original.reenvios + 1,
    executor: input.executor ?? "catcher",
  });
  if (!turno) throw new ErroDeDominio("nao_permitido");

  const events = [
    evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: conversa.id, turnoId: turno.id, dados: { mensagem_id: mensagem.id, kind: "texto", destravou: true } }),
    ...(nova ? [evento(deps.escopo, { kind: "turno_criado", autoria, agora, conversaId: conversa.id, turnoId: turno.id, dados: { origem: "retomada", retoma_turno_id: original.id, reenvios: turno.reenvios } })] : []),
  ];
  if (aviso) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: conversa.id, turnoId: turno.id, dados: { mensagem_id: aviso.id, kind: "sistema" } }));
  // definido em 2026-10-15 (NOD-256, F1.3): o Retomar é da pessoa — a task parada volta a rodar com a retomada.
  events.push(...(await sincronizarTrabalho(deps, turno.trabalhoId, { reabrir: true })));
  if (decisao) {
    const decidida = await deps.repos.decisoes.decidir(decisao.id, { por: deps.escopo.pessoaId, agora });
    if (decidida) {
      decisao = decidida;
      events.push(evento(deps.escopo, { kind: "decisao_decidida", autoria, agora, conversaId: conversa.id, turnoId: turno.id, dados: { decisao_id: decisao.id, tipo: decisao.tipo } }));
      // definido em 2026-09-24: o "Retomar" repetido da mesma conversa (×N na fila) sai junto, na mesma tx.
      events.push(...(await fecharGemeas(deps, decidida)).events);
    }
  }
  return { data: { turno, original, mensagem, sessaoCli: conversa.sessaoCli, decisao }, events };
};
