import { randomUUID } from "node:crypto";
import type { Proposta } from "../contracts/conversa.ts";
import type { RuntimeEvent } from "../contracts/evento.ts";
import { complementoCapacidades } from "../domain/catalogo-conectores.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { redigir } from "../domain/redacao.ts";
import { autoriaDaPessoa } from "./registrar-negacao.ts";
import { autoriaPessoa, evento } from "./autoria-evento.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";

export type EntradaConceder = {
  agenteId: string;
  conectorId: string;
  capacidade: string;
  /** Quem concede. 'agente' é recusado: agente não concede capacidade a agente (E12.5). */
  autorTipo?: "pessoa" | "agente";
};

export type SaidaConceder = { concessaoId: string; mensagemId: string; naoInclui: string[] };

export type EntradaConcederLote = Omit<EntradaConceder, "capacidade"> & {
  capacidades: readonly string[];
  /**
   * ADR-059 (emenda de 2026-09-30): a concessão saiu pelo modo do bot, que a pessoa escolheu — não por um clique
   * neste pedido. O consentimento continua sendo da pessoa (a escolha do modo é dela), com a regra em
   * `decidido_por` e dito no texto, para a trilha não confundir com um clique.
   */
  porRegra?: { regra: `regra:${string}`; regraVersao: number };
  /**
   * definido em 2026-10-18 (chat limpo, PR 4): o pedido que este lote atende (decidir-acesso.ts) — a decisão, o turno que
   * pediu e a frase. Vão no payload do consentimento: o cartão do pedido encolhe no lugar dele, com a frase como título.
   * Sem a frase quando a pessoa desmarcou parte do pedido: o título sai do que foi concedido.
   */
  pedido?: { decisaoId: string; turnoId: string | null; frase?: string };
};

/**
 * `concessoes`: uma por capacidade pedida, na ordem do pedido, cada uma com a mensagem de
 * consentimento que a cita (a nova ou, se já estava concedida, a ORIGINAL). `mensagemId` é o
 * consentimento novo deste lote; null quando tudo já estava concedido.
 */
export type SaidaConcederLote = { concessoes: { capacidade: string; concessaoId: string; mensagemId: string }[]; mensagemId: string | null; naoInclui: string[] };

/** 'AAAA-MM-DD HH:MM UTC' — determinístico; a web interpola no fuso da pessoa (ADR-007). */
export function quandoUtc(agora: number): string {
  return `${new Date(agora).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/**
 * Concessão por agente e por capacidade (E6.3, ADR-013), em LOTE desde 2026-09-24 (ADR-044): um clique
 * em "Permitir" nas 28 ferramentas de leitura do Gmail escrevia 28 mensagens de consentimento. Agora
 * nasce UMA mensagem imutável ("Concedido por <nome> em <data hora>: <slug>.<cap>, …; não inclui: …")
 * na MESMA tx, na conversa própria do agente, e cada concessão aponta para ela (FK; a unicidade do
 * banco é por capacidade, não por mensagem). O "não inclui" é o complemento do catálogo (E2.4/E6.6)
 * calculado no domínio, nunca texto do modelo.
 */
export const concederLote: CasoDeUso<EntradaConcederLote, SaidaConcederLote> = async (deps, input) => {
  if (input.autorTipo === "agente") throw new ErroDeDominio("nao_permitido", { cause: "agente não concede capacidade a agente (E12.5)" });
  const capacidades = [...new Set(input.capacidades)];
  if (capacidades.length === 0) throw new ErroDeDominio("entrada_invalida", { cause: "nenhuma capacidade para conceder" });
  const agora = deps.agora();
  const agente = await deps.repos.agentes.buscar(input.agenteId);
  if (!agente) throw new ErroDeDominio("nao_encontrado", { cause: "agente" });
  const conector = await deps.repos.conectores.buscar(input.conectorId);
  if (!conector) throw new ErroDeDominio("nao_encontrado", { cause: "conector" });
  if (capacidades.some((cap) => !conector.catalogo.some((c) => c.nome === cap))) throw new ErroDeDominio("entrada_invalida", { cause: "capacidade fora do catálogo do conector" });
  const conversa = await deps.repos.conversas.buscarPropriaDoAgente(agente.id);
  if (!conversa) throw new ErroDeDominio("estado_invalido", { cause: "agente sem conversa própria" });
  const doConector = (await deps.repos.concessoes.doAgente(agente.id)).filter((c) => c.conectorId === conector.id);
  const naoInclui = complementoCapacidades(conector, [...doConector.map((c) => c.capacidade), ...capacidades]);
  // definido em 2026-09-21: conceder o que JÁ está concedido é sucesso, não erro. O repositório sempre
  // foi idempotente por contrato escrito ("null quando a mesma (agente, conector, capacidade) já
  // existe: conceder duas vezes não duplica", on conflict do nothing) e era este caso de uso que
  // traduzia esse "nada a fazer" como estado_invalido — o 409 travava para sempre o card de uma
  // decisão de acesso duplicada: a pessoa já havia consentido, não havia o que decidir nem desfazer.
  // A que já existe fica FORA da mensagem nova: a original é a imutável e citável (ADR-013), repetir
  // seria ruído na conversa própria do agente. A invariante segue sendo UMA concessão por capacidade.
  const novas = capacidades.filter((cap) => !doConector.some((c) => c.capacidade === cap));
  const saida: SaidaConcederLote["concessoes"] = [];
  const events: RuntimeEvent[] = [];
  let mensagemId: string | null = null;
  if (novas.length > 0) {
    const pessoa = await deps.repos.pessoas.buscar(deps.escopo.pessoaId);
    const autoria = input.porRegra ? { ...autoriaDaPessoa(deps.escopo), decidido_por: input.porRegra.regra, regra_versao: input.porRegra.regraVersao } : autoriaDaPessoa(deps.escopo);
    const mensagem = await deps.repos.mensagens.criar({
      conversaId: conversa.id,
      autoria,
      kind: "consentimento",
      texto: redigir("consentimento", agora, {
        pessoa: pessoa?.nome ?? "a pessoa",
        quando: quandoUtc(agora),
        escopo: novas.map((cap) => `${conector.slug}.${cap}`).join(", "),
        naoInclui: naoInclui.length === 0 ? "nada mais deste conector" : naoInclui.join("; "),
      }) + (input.porRegra ? " Pela aprovação automática deste bot, sem clique neste pedido." : ""),
      payload: { kind: "consentimento", conectorId: conector.id, slug: conector.slug, capacidades: novas, naoInclui, ...(input.pedido ?? {}) },
      confianca: "confiavel",
    });
    if (!mensagem) throw new Error("mensagem de consentimento não criada");
    mensagemId = mensagem.id;
    for (const capacidade of novas) {
      const concessao = await deps.repos.concessoes.conceder({ agenteId: agente.id, conectorId: conector.id, capacidade, mensagemId: mensagem.id });
      if (!concessao) throw new ErroDeDominio("estado_invalido", { cause: "capacidade já concedida a este agente" });
      events.push({
        tenantId: deps.escopo.tenantId,
        id: randomUUID(),
        createdAt: agora,
        kind: "concessao_criada",
        autoria,
        pessoaDestinoId: deps.escopo.pessoaId,
        conversaId: conversa.id,
        dados: { concessao_id: concessao.id, mensagem_id: mensagem.id, agente_id: agente.id, conector_id: conector.id, slug: conector.slug, capacidade },
      });
      doConector.push(concessao);
    }
  }
  for (const capacidade of capacidades) {
    const c = doConector.find((x) => x.capacidade === capacidade);
    if (c) saida.push({ capacidade, concessaoId: c.id, mensagemId: c.mensagemId });
  }
  // definido em 2026-10-15 (NOD-270, I4): o acesso dado por qualquer caminho (a tela Conectores, o cartão "Liberar", o
  // nível do app) fecha o card do pré-voo que ele cobre — antes o card seguia aberto e, ao vencer, pausava a rotina.
  // O card que este lote está decidindo (decidirAcesso) já saiu de 'pendente' antes daqui e não é achado de novo.
  const card = await deps.repos.propostas.acessoDeRotinaAberto(agente.id, conector.slug);
  if (card) events.push(...((await fecharCardAtendido(deps, card)) ?? []));
  return { data: { concessoes: saida, mensagemId, naoInclui }, events };
};

/** definido em 2026-10-15 (NOD-270, I4): quem fecha o card de acesso da rotina cujo acesso já foi dado. */
export const REGRA_ACESSO_JA_CONCEDIDO = "regra:acesso_ja_concedido" as const;

/**
 * O card de acesso do PRÉ-VOO de uma rotina (sem turno: nasce do servidor, não de um pedir_acesso) cujas capacidades o
 * bot já tem fecha como atendido: decisão por regra (sem pessoa, ADR-042), proposta confirmada, ninguém continua (não
 * há turno esperando; a próxima janela roda). Concessão parcial não fecha. `tambemVencida`: o varredor acabou de
 * vencê-lo (vencerPedidoDaRotina). null = não era esse card, ou o acesso ainda falta — quem chamou segue como antes.
 * O card de um turno (pedir_acesso) fica de fora de propósito: o turno espera o clique para retomar.
 */
export async function fecharCardAtendido(deps: Pick<Deps, "repos" | "escopo" | "agora">, proposta: Proposta, opcoes: { tambemVencida?: boolean } = {}): Promise<RuntimeEvent[] | null> {
  const p = proposta.payload;
  if (p.kind !== "acesso" || p.conectar || !p.rotinaId || proposta.estado !== "pendente" || p.capacidades.length === 0) return null;
  const decisao = await deps.repos.decisoes.buscar(proposta.id);
  if (!decisao || decisao.tipo !== "acesso" || decisao.turnoId !== null) return null;
  const conector = await deps.repos.conectores.buscarPorSlug(p.conector);
  if (!conector?.habilitado) return null;
  const concedidas = new Set((await deps.repos.concessoes.doAgente(proposta.agenteId)).filter((c) => c.conectorId === conector.id).map((c) => c.capacidade));
  if (p.capacidades.some((c) => !concedidas.has(c))) return null;
  const agora = deps.agora();
  const fechada = await deps.repos.decisoes.fecharPorRegra(decisao.id, { regra: REGRA_ACESSO_JA_CONCEDIDO, regraVersao: 1, agora, ...(opcoes.tambemVencida ? { tambemVencida: true } : {}) });
  if (!fechada) return null;
  await deps.repos.decisoes.reivindicarContinuacao(fechada.id, "turno", agora);
  await deps.repos.propostas.decidir(proposta.id, "confirmada");
  const autoria = { ...autoriaPessoa(deps.escopo), decidido_por: REGRA_ACESSO_JA_CONCEDIDO };
  return [evento(deps.escopo, { kind: "decisao_decidida", autoria, agora, conversaId: fechada.conversaId, turnoId: null, dados: { decisao_id: fechada.id, tipo: fechada.tipo, regra: REGRA_ACESSO_JA_CONCEDIDO, rotina_id: p.rotinaId } })];
}

/** Uma capacidade: o lote de um. Quem decide acesso por botão chama `concederLote` (decidir-acesso.ts). */
export const conceder: CasoDeUso<EntradaConceder, SaidaConceder> = async (deps, input) => {
  const r = await concederLote(deps, { agenteId: input.agenteId, conectorId: input.conectorId, capacidades: [input.capacidade], autorTipo: input.autorTipo });
  const [c] = r.data.concessoes;
  if (!c) throw new ErroDeDominio("estado_invalido", { cause: "concessão não gravada" });
  return { data: { concessaoId: c.concessaoId, mensagemId: c.mensagemId, naoInclui: r.data.naoInclui }, events: r.events };
};
