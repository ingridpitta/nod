import type { AcessoPedido } from "../contracts/acesso.ts";
import type { RuntimeEvent } from "../contracts/evento.ts";
import { capacidadesDeLeitura } from "../domain/pedido-acesso.ts";
import { concederLote } from "./conceder.ts";
import type { CasoDeUso } from "./tipos.ts";

export type EntradaConcederAcessosDaRotina = {
  agenteId: string;
  /** Os acessos que a rotina declarou, já normalizados (payload da proposta). null/ausente = nada a conceder. */
  acessos: readonly AcessoPedido[] | null | undefined;
  /** ADR-059: a rotina foi confirmada pelo modo do bot, não por clique; o consentimento diz isso. */
  porRegra?: { regra: `regra:${string}`; regraVersao: number };
};

export type SaidaConcederAcessosDaRotina = {
  /** Uma entrada por app concedido agora ou já concedido antes; `consentimentoId` null = nada era novo. */
  concedidos: { slug: string; capacidades: string[]; consentimentoId: string | null }[];
  /** Apps declarados que ainda não estão conectados e habilitados: o pré-voo abre o card quando conectarem. */
  pulados: string[];
};

/**
 * "Rotina nasce com o acesso" (definido em 2026-09-24, emenda da ADR-044). A pessoa está presente quando a
 * rotina nasce, e o card mostrou o que ela lê ou altera ("Criar rotina e permitir leitura"): confirmar É o
 * consentimento. Chamado por ativarRotina (confirmar a proposta 'rotina', pelo chat ou por "Sua vez") e por
 * aplicarAtualizacaoRotina, na MESMA transação que cria ou muda a rotina — a rotina nunca existe sem o
 * acesso que a pessoa viu ser liberado, nem o acesso sem a rotina.
 *
 * Por app declarado: conector conectado e habilitado → `concederLote` com UMA mensagem de consentimento
 * (a mesma trava (agente, conector) do pré-voo e do clique, antes de ler as concessões); app ainda por
 * conectar → pulado, e o pré-voo abre o card de um clique quando ele conectar. Leitura declarada sem
 * capacidades (o app não estava conectado quando a rotina foi proposta) vira as ferramentas de leitura do
 * catálogo de AGORA — foi isso que o botão disse. Capacidade que saiu do catálogo depois da proposta fica
 * de fora: conceder o que não existe falharia a confirmação inteira. Idempotente: o que já está
 * concedido não gera mensagem nova (concederLote).
 */
export const concederAcessosDaRotina: CasoDeUso<EntradaConcederAcessosDaRotina, SaidaConcederAcessosDaRotina> = async (deps, input) => {
  const saida: SaidaConcederAcessosDaRotina = { concedidos: [], pulados: [] };
  const events: RuntimeEvent[] = [];
  const porApp = [...(input.acessos ?? [])].sort((a, b) => a.conector.localeCompare(b.conector));
  for (const acesso of porApp) {
    const conector = await deps.repos.conectores.buscarPorSlug(acesso.conector);
    if (!conector?.habilitado) {
      saida.pulados.push(acesso.conector);
      continue;
    }
    const noCatalogo = new Set(conector.catalogo.map((c) => c.nome));
    const capacidades = acesso.capacidades.length > 0 ? acesso.capacidades.filter((c) => noCatalogo.has(c)) : acesso.nivel === "leitura" ? capacidadesDeLeitura(conector.catalogo) : [];
    if (capacidades.length === 0) {
      saida.pulados.push(acesso.conector);
      continue;
    }
    await deps.repos.concessoes.travar(input.agenteId, conector.id);
    const lote = await concederLote(deps, { agenteId: input.agenteId, conectorId: conector.id, capacidades, autorTipo: "pessoa", ...(input.porRegra ? { porRegra: input.porRegra } : {}) });
    events.push(...(lote.events ?? []));
    saida.concedidos.push({ slug: acesso.conector, capacidades: lote.data.concessoes.map((c) => c.capacidade), consentimentoId: lote.data.mensagemId });
  }
  return { data: saida, events };
};
