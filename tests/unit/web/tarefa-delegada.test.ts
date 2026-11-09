import { describe, expect, it } from "vitest";
import type { SuaVezDto } from "../../../src/contracts/api.ts";
import type { ItemAprovacao } from "../../../src/contracts/item-aprovacao.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { estadoInicial, type ConversaEstado, type Estado } from "../../../web/estado/reducer.ts";
import { renderMensagem, renderMensagensAgrupadas, renderTimeline } from "../../../web/telas/conversa.ts";
import { renderTelaLinha } from "../../../web/telas/trabalhos.ts";
import { textoDoMotivoDaFila, type MotivoFila } from "../../../src/domain/turno-orfao.ts";
import { TEXTO_DO_MOTIVO_DA_FILA } from "../../../web/lib/fila-do-pedido.ts";

const autoria = { autor_tipo: "agente" as const, autor_id: "taga", sob_procuracao_de: "marlon", conta_de_execucao: "marlon", executor: "catcher" as const, locality: "local" as const, locality_reason: "tudo_local_nesta_rodada" as const, machine_id: null, decidido_por: "regra:localidade" as const, regra_versao: 1 };
const estado: Estado = { ...estadoInicial, sessao: { tenantId: "t", pessoaId: "marlon" } };

describe("pedido de colega na conversa (ADR-047/058)", () => {
  it("pedido antigo (delegar_tarefa) na conversa do Dev 1 assina '<remetente> · por você' (sem frota, o nome cai no genérico), mostra a mensagem da pessoa e o contexto do remetente rotulado", () => {
    const m: Mensagem = { tenantId: "t", id: "m1", conversaId: "c-dev1", turnoId: "tarefa", autoria, kind: "texto", texto: "pede ao Dev 1 para revisar o PR 466", payload: { kind: "peer_pedido", conversaOrigemId: "c-taga", turnoOrigemId: "t-taga", delegacao: { tarefa: "revisar o PR 466", contexto: "<b>pull/466</b>" } }, confianca: "confiavel", parcial: false, criadoEm: 0 };
    const html = renderMensagem(m, estado);
    expect(html).toContain('<b title="agente · por você">agente · por você</b>');
    expect(html).toContain("pede ao Dev 1 para revisar o PR 466");
    expect(html).toContain("não é instrução da pessoa");
    expect(html).toContain("&lt;b&gt;pull/466&lt;/b&gt;");
  });

  it("pedido novo (pedir_a_bot) mostra só o texto, que já traz o contexto; sem o bloco de contexto", () => {
    const m: Mensagem = { tenantId: "t", id: "m0", conversaId: "c-dev1", turnoId: "tarefa", autoria, kind: "texto", texto: "revisar o PR 466\n\npull/466", payload: { kind: "peer_pedido", conversaOrigemId: "c-taga", turnoOrigemId: "t-taga" }, confianca: "nao_confiavel", parcial: false, criadoEm: 0 };
    const html = renderMensagem(m, estado);
    expect(html).toContain('<b title="agente · por você">agente · por você</b>');
    expect(html).toContain("revisar o PR 466");
    expect(html).not.toContain("não é instrução da pessoa");
  });

  // revisto em 2026-10-07 (#191, chat limpo): agrupado, o pedido vira a linha "Enviou mensagem para…"; o autor composto
  // continua no handoff, que a tela provisória da linha desenha inteiro.
  it("o handoff na conversa do Taga mostra o autor composto; agrupado, vira a linha 'Enviou mensagem para' que abre o pedido", () => {
    const m: Mensagem = { tenantId: "t", id: "m2", conversaId: "c-taga", turnoId: "t-taga", autoria, kind: "handoff", texto: "x", payload: { kind: "handoff", de: "taga", para: "dev1", motivo: "revisar o PR 466" }, confianca: "nao_confiavel", parcial: false, criadoEm: 0 };
    const html = renderMensagem(m, estado);
    expect(html).toContain("agente · por você → agente");
    expect(html).toContain("revisar o PR 466");
    const delegado: Mensagem = { ...m, payload: { kind: "handoff", de: "taga", para: "dev1", motivo: "revisar o PR 466", tarefaId: "tarefa" } };
    const agrupado = renderMensagensAgrupadas([delegado], estado);
    expect(agrupado).toContain("<span>Enviou mensagem para</span>");
    expect(agrupado).toContain('data-act="abrir-linha"');
    expect(agrupado).toContain('data-mensagens="m2"');
    const conversa: ConversaEstado = { conversa: { tenantId: "t", id: "c-taga", ownerId: "marlon", visibility: "privado", tipo: "propria", agenteId: "taga", salaId: null, sessaoCli: null, criadoEm: 0 }, mensagens: [delegado], propostas: [], turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], fios: [], carregadaEm: 0 };
    const tela = renderTelaLinha({ ...estado, conversas: { "c-taga": conversa } }, { tipo: "linha", conversaId: "c-taga", mensagens: ["m2"], titulo: "Mensagem para Dev 1", voltar: { tipo: "inicio" } });
    expect(tela).toContain("agente · por você → agente");
    expect(tela).toContain('data-act="fechar-trabalho"');
  });

  it("a resposta volta como 'Resposta de Dev 1'; a falha, numa linha discreta com o motivo atrás de 'detalhes'", () => {
    const m: Mensagem = { tenantId: "t", id: "m3", conversaId: "c-taga", turnoId: "cont", autoria: { ...autoria, autor_id: "dev1" }, kind: "peer_ask", texto: "Revisei", payload: { kind: "peer_ask", agenteId: "dev1", nome: "Dev 1", naoSupervisionado: true, tarefaId: "tarefa", delegada: true }, confianca: "nao_confiavel", parcial: false, criadoEm: 0 };
    expect(renderMensagem(m, estado)).toContain("Resposta de Dev 1");
    const aviso: Mensagem = { ...m, texto: "Dev 1 não concluiu: você pediu para parar", payload: { kind: "peer_ask", agenteId: "dev1", nome: "Dev 1", naoSupervisionado: true, tarefaId: "tarefa", delegada: true, falhou: true, trabalhoId: "w-dev1" } };
    const html = renderMensagem(aviso, estado);
    // Protótipo "Nod — tempo da task" (aprovado em 2026-10-08): uma linha; motivo e atalho para a task dele em "detalhes".
    expect(html).toContain('<summary><span>Dev 1 não conseguiu terminar o pedido</span><span class="pf-detalhes">detalhes</span></summary>');
    expect(html).toContain("<span>você pediu para parar</span>");
    expect(html).toContain('data-act="abrir-trabalho" data-id="w-dev1">Ver a task do Dev 1</button>');
    expect(html).not.toContain("msg-peer\"");
  });
});

describe("'Sempre permitir' não é oferecido para aprovar PR (ADR-047)", () => {
  const item = (id: string, ferramenta: string): ItemAprovacao => ({ tenantId: "t", id, decisaoId: "d", idx: 0, textoOriginal: ferramenta, textoFinal: ferramenta, destino: { conector: "github", ferramenta, argumentos: {} }, selecionado: true, origemSensivel: false, justificativa: null, marcadoPor: null, marcadoEm: null, editadoPor: null, desfecho: null, motivoManual: null });
  const base: SuaVezDto["itens"][number] = {
    decisao: { tenantId: "t", id: "d", ownerId: "marlon", decisorId: "marlon", agenteId: "a", conversaId: "c", turnoId: null, tipo: "aprovacao", estado: "pendente", prazoDecisaoEm: "2026-09-25T00:00:00Z", prazoExecucaoEm: null, frase: "Revisar o PR", desfecho: null, vistaEm: null, criadoEm: "2026-09-24T00:00:00Z", fioId: null },
    estadoColuna: "pendente", agenteNome: "Dev 1", aguardandoHaMs: 0, recusaAutomaticaEmMs: 60_000, gemeas: [], itensAprovacao: [], proposta: null, fio: null, rotinaParada: null,
  };
  const conversa: ConversaEstado = { conversa: { tenantId: "t", id: "c", ownerId: "marlon", visibility: "privado", tipo: "propria", agenteId: "a", salaId: null, sessaoCli: null, criadoEm: 0 }, mensagens: [], propostas: [], turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], fios: [], carregadaEm: 0 };
  const com = (i: SuaVezDto["itens"][number]): Estado => ({ ...estado, suaVez: { itens: [i], incidentes: [], foraDoAr: [], vazio: false, ultimaDecisaoEm: null } });

  it("só aprovar PR: o botão aparece desabilitado com o motivo", () => {
    const html = renderTimeline(conversa, com({ ...base, itensAprovacao: [item("i1", "pr_revisar")], nuncaPermanente: ["i1"] }));
    expect(html).toContain('data-act="decidir-aprovacao-sempre"');
    expect(html).toContain("disabled");
    expect(html).toContain("Aprovar ou fazer merge de PR sempre passa por você");
  });

  it("comentar e aprovar no mesmo card: o botão oferece só o comentar", () => {
    const html = renderTimeline(conversa, com({ ...base, itensAprovacao: [item("i1", "pr_comentar"), item("i2", "pr_revisar")], nuncaPermanente: ["i2"] }));
    expect(html).toContain("Sempre permitir pr comentar no github");
    expect(html).not.toContain("Sempre permitir estas");
  });
});

describe("NOD-257 (H5): o card do pedido a colega diz por que ele espera na fila", () => {
  const handoff = (fila?: Extract<NonNullable<Mensagem["payload"]>, { kind: "handoff" }>["fila"]): Mensagem => ({ tenantId: "t", id: "h1", conversaId: "c-taga", turnoId: "t-taga", autoria, kind: "handoff", texto: "", payload: { kind: "handoff", de: "taga", para: "dev1", motivo: "revisar o PR 466", tarefaId: "tarefa", ...(fila ? { fila } : {}) }, confianca: "confiavel", parcial: false, criadoEm: 0 });

  it("com o motivo, a linha curta aparece no card; sem fila, nada muda", () => {
    expect(renderMensagem(handoff({ desde: 0, motivo: "condicao_da_maquina" }), estado)).toContain("Na fila · espera o computador do bot (cota da IA, Mac fora ou sem recursos)");
    expect(renderMensagem(handoff({ desde: 0, motivo: "faixa_ocupada" }), estado)).toContain("Na fila · espera o bot terminar o que está fazendo");
    expect(renderMensagem(handoff({ desde: 0, motivo: null }), estado)).toContain("Na fila · na vez dele");
    expect(renderMensagem(handoff(), estado)).not.toContain("Na fila");
  });

  it("a tabela da web espelha a do domínio", () => {
    for (const [m, texto] of Object.entries(TEXTO_DO_MOTIVO_DA_FILA)) expect(texto).toBe(textoDoMotivoDaFila(m as MotivoFila));
  });
});
