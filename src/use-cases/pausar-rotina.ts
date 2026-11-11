import type { Autoria, RuntimeEvent } from "../contracts/evento.ts";
import { proximaDaRotina } from "../domain/rotina-texto.ts";
import type { EstadoRotina, Rotina } from "../contracts/rotina.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { instanteLocal, textoRetomada, validarRetomada } from "../domain/rotina-retomada.ts";
import { autoriaPessoa, evento, eventoDeRotina, exigir, textoRotinaAtiva } from "./apoio-l7.ts";
import { registrarDesfechoRotina } from "./disparar-rotina.ts";
import { invalidarCardDeRitmo } from "./ritmo-card.ts";
import type { CasoDeUso } from "./tipos.ts";

/**
 * POST rotinas/:id/pausar e /ativar, e as ferramentas pausar_rotina/reativar_rotina. Pausada não
 * entra no tick do scheduler (índice parcial `estado = 'ativa'`). Reativar recalcula a próxima
 * execução a partir de `agora`: janelas perdidas durante a pausa não são repostas (definido em
 * 2026-09-16: mesma regra do disparo — o Grok Bot também não repõe). Só a dona muda estado: o
 * repositório devolve null para quem não é.
 *
 * `autoria` é opcional porque quem escreve a mensagem muda: pela rota é a pessoa; pela ferramenta
 * é o agente sob procuração dela (ADR-023). O efeito no banco é o mesmo nos dois caminhos.
 * `texto` (definido em 2026-09-24, emenda da ADR-044): quem pausa por regra diz POR QUÊ — o varredor,
 * quando ninguém liberou o acesso da rotina no prazo. Ausente, a linha de sempre.
 */
/**
 * NOD-412 (definido em 2026-11-11): `retomarEm` ou `ate` (hora local no fuso da rotina; só na pausa) é o instante em que o agendador a reativa sozinho; validado
 * aqui (de agora + 1 min a 366 dias), para a tela e o chat recusarem igual. Pausar a já pausada com OUTRA data troca só a
 * data (sem corte de fila, que já foi feito); com a mesma data, ou sem data numa pausada, segue sem efeito como sempre.
 */
export const pausarRotina: CasoDeUso<{ rotinaId: string; estado: EstadoRotina; retomarEm?: number | null; ate?: string; retomadaAutomatica?: true; autoria?: Autoria; texto?: string; semLinha?: true }, { rotina: Rotina; corte?: { cortados: number; rodando: boolean } }> = async (deps, input) => {
  const atual = exigir(await deps.repos.rotinas.buscar(input.rotinaId), "nao_encontrado", "rotina");
  const agora = deps.agora();
  // `ate` (a tela manda a hora local, como o chat) vira instante no fuso DA ROTINA; `retomarEm` já é o instante.
  const retomarEm = input.estado !== "pausada" ? null : input.ate !== undefined ? instanteLocal(input.ate, atual.fusoIana) : input.retomarEm ?? null;
  if (retomarEm !== null) validarRetomada(retomarEm, agora);
  if (atual.estado === input.estado) {
    if (input.estado === "ativa" || retomarEm === null || retomarEm === (atual.retomarEm ?? null)) return { data: { rotina: atual } };
    return trocarRetomada(deps, atual, retomarEm, input);
  }
  if (input.estado === "ativa") {
    // Na volta marcada, a próxima conta a partir do instante da volta (inclusive): a janela de "seg 09:00" numa pausa
    // "até seg 09:00" roda, como a agenda prevê; o tick chega segundos depois e a pegaria só no dia seguinte.
    const desde = input.retomadaAutomatica && atual.retomarEm != null ? Math.min(agora, atual.retomarEm - 1) : agora;
    const proxima = proximaDaRotina(atual, desde);
    exigir(await deps.repos.rotinas.reagendar(atual.id, proxima), "nao_encontrado", "rotina (não é a dona)");
  }
  const rotina = await deps.repos.rotinas.atualizarEstado(atual.id, input.estado, retomarEm);
  if (!rotina) throw new ErroDeDominio("nao_permitido", { cause: "só a dona pausa/ativa" });
  const corte = rotina.estado === "pausada" ? await cortarFila(deps, rotina.id) : { events: [], cortados: 0, rodando: false };
  // NOD-313 (2026-10-23): o card de ritmo é a própria linha da pausa ("✓ … pausada · desfazer"); quem o fecha escreve a
  // frase do corte nele, sem uma segunda linha.
  if (input.semLinha) return { data: { rotina, corte: { cortados: corte.cortados, rodando: corte.rodando } }, events: corte.events };
  // NOD-313: a pausa por outro caminho (tela, agente, regra) fecha o card de ritmo aberto sem aplicar nada.
  const ritmo = rotina.estado === "pausada" ? await invalidarCardDeRitmo(deps, rotina) : [];
  await deps.repos.mensagens.criar({
    conversaId: rotina.conversaId,
    autoria: input.autoria ?? autoriaPessoa(deps.escopo.pessoaId),
    kind: "sistema",
    // revisto em 2026-10-16 (revisão do Gil no #335, A7): o texto de quem pausa por regra (o agente, o varredor) não
    // esconde o que foi cancelado — a frase do corte vem depois dele.
    texto: input.texto
      ? [input.texto, fraseDoCorte(corte)].filter(Boolean).join(" ")
      : rotina.estado === "ativa" ? `${input.retomadaAutomatica ? "Rotina retomada sozinha, como marcado na pausa. " : ""}${textoRotinaAtiva(rotina, agora)}` : textoPausada(corte, rotina, agora),
    payload: eventoDeRotina(rotina, rotina.estado === "ativa" ? "ativada" : "pausada"),
    confianca: "confiavel",
  });
  return { data: { rotina }, events: [...corte.events, ...ritmo] };
};

/** definido em 2026-10-16 (NOD-272): quem segura a fila entra na mensagem — o que foi cancelado e o que ainda termina. */
export function textoPausada(corte: { cortados: number; rodando: boolean }, rotina?: Pick<Rotina, "fusoIana" | "retomarEm">, agora?: number): string {
  return [fraseDaPausa(rotina, agora), fraseDoCorte(corte)].filter(Boolean).join(" ");
}

/** NOD-412: "Rotina pausada até seg 09:00: volta sozinha." com data; sem data, a frase de sempre. */
export function fraseDaPausa(rotina?: Pick<Rotina, "fusoIana" | "retomarEm">, agora?: number): string {
  if (!rotina?.retomarEm || agora === undefined) return "Rotina pausada: nada será disparado até você reativar.";
  return `Rotina pausada até ${textoRetomada(rotina.retomarEm, rotina.fusoIana, agora)}: volta sozinha. Execuções perdidas na pausa não são repostas.`;
}

/** A já pausada ganha outra data: só a data muda, com a linha no chat (o corte de fila já foi feito na pausa). */
async function trocarRetomada(deps: Parameters<typeof pausarRotina>[0], atual: Rotina, retomarEm: number, input: Parameters<typeof pausarRotina>[1]) {
  const rotina = await deps.repos.rotinas.atualizarEstado(atual.id, "pausada", retomarEm);
  if (!rotina) throw new ErroDeDominio("nao_permitido", { cause: "só a dona pausa/ativa" });
  if (input.semLinha) return { data: { rotina } };
  await deps.repos.mensagens.criar({
    conversaId: rotina.conversaId,
    autoria: input.autoria ?? autoriaPessoa(deps.escopo.pessoaId),
    kind: "sistema",
    texto: input.texto ?? fraseDaPausa(rotina, deps.agora()),
    payload: eventoDeRotina(rotina, "pausada"),
    confianca: "confiavel",
  });
  return { data: { rotina } };
}

/** O que a pausa cancelou e o que ainda termina; vazio quando não havia nada aberto. */
export function fraseDoCorte(corte: { cortados: number; rodando: boolean }): string {
  const partes: string[] = [];
  if (corte.cortados === 1) partes.push("A execução que estava na fila foi cancelada.");
  else if (corte.cortados > 1) partes.push(`As ${corte.cortados} execuções que estavam na fila foram canceladas.`);
  if (corte.rodando) partes.push("A execução em andamento termina normalmente.");
  return partes.join(" ");
}

/**
 * definido em 2026-10-16 (NOD-272): pausar corta o que a rotina deixou na fila — o turno da janela, a cadeia de retomadas
 * e os turnos da frente dela que ainda não começaram. Cada um vira 'interrompido' (parado_pela_pessoa) e a execução da
 * janela fecha 'interrompida'/'rotina_pausada'. O turno que já está despachando não é cortado: termina e registra o seu
 * desfecho (cortar no meio deixaria efeito externo pela metade).
 */
async function cortarFila(deps: Parameters<typeof pausarRotina>[0], rotinaId: string): Promise<{ events: RuntimeEvent[]; cortados: number; rodando: boolean }> {
  const events: RuntimeEvent[] = [];
  const autoria = autoriaPessoa(deps.escopo.pessoaId, REGRA_PAUSAR);
  const aberto = await deps.repos.rotinaJanelas.turnoAberto(rotinaId, deps.agora());
  const pendentes = await deps.repos.rotinaJanelas.turnosPendentesDaRotina(rotinaId, deps.agora());
  const janelas = new Set<string>();
  for (const p of pendentes) {
    const cortado = await deps.repos.turnos.interromper(p.turnoId, "parado_pela_pessoa");
    if (!cortado) continue;
    events.push(evento(deps, "turno_interrompido", autoria, { motivo: "parado_pela_pessoa", estava: "pendente" }, { conversaId: cortado.conversaId, turnoId: p.turnoId }));
    janelas.add(p.janelaTurnoId);
  }
  let cortados = 0;
  for (const turnoId of janelas) {
    // A janela cujo próprio turno ainda despacha registra o desfecho dela ao terminar — e não conta como cancelada
    // (revisão do Gil no #335, A7: senão a mesma execução saía "cancelada" e "em andamento").
    if ((await deps.repos.turnos.buscar(turnoId))?.estado === "despachando") continue;
    const r = await registrarDesfechoRotina(deps, { turnoId, desfecho: "interrompida", motivo: "rotina_pausada", regra: REGRA_PAUSAR });
    events.push(...(r.events ?? []));
    cortados++;
  }
  // Conta execuções (janelas), não turnos: a retomada e a frente de uma janela são a mesma execução.
  return { events, cortados, rodando: aberto?.estado === "despachando" };
}

const REGRA_PAUSAR = "regra:pausar";
