import type { Autoria, RuntimeEvent } from "../contracts/evento.ts";
import { proximaDaRotina } from "../domain/rotina-texto.ts";
import type { EstadoRotina, Rotina } from "../contracts/rotina.ts";
import { ErroDeDominio } from "../domain/erro.ts";
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
export const pausarRotina: CasoDeUso<{ rotinaId: string; estado: EstadoRotina; autoria?: Autoria; texto?: string; semLinha?: true }, { rotina: Rotina; corte?: { cortados: number; rodando: boolean } }> = async (deps, input) => {
  const atual = exigir(await deps.repos.rotinas.buscar(input.rotinaId), "nao_encontrado", "rotina");
  if (atual.estado === input.estado) return { data: { rotina: atual } };
  const agora = deps.agora();
  if (input.estado === "ativa") {
    const proxima = proximaDaRotina(atual, agora);
    exigir(await deps.repos.rotinas.reagendar(atual.id, proxima), "nao_encontrado", "rotina (não é a dona)");
  }
  const rotina = await deps.repos.rotinas.atualizarEstado(atual.id, input.estado);
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
      : rotina.estado === "ativa" ? textoRotinaAtiva(rotina, agora) : textoPausada(corte),
    payload: eventoDeRotina(rotina, rotina.estado === "ativa" ? "ativada" : "pausada"),
    confianca: "confiavel",
  });
  return { data: { rotina }, events: [...corte.events, ...ritmo] };
};

/** definido em 2026-10-16 (NOD-272): quem segura a fila entra na mensagem — o que foi cancelado e o que ainda termina. */
export function textoPausada(corte: { cortados: number; rodando: boolean }): string {
  return ["Rotina pausada: nada será disparado até você reativar.", fraseDoCorte(corte)].filter(Boolean).join(" ");
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
