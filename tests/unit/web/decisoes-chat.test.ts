import { describe, expect, it } from "vitest";
import type { SuaVezDto } from "../../../src/contracts/api.ts";
import type { Proposta } from "../../../src/contracts/conversa.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { estadoInicial, reduzir, type ConversaEstado, type Estado } from "../../../web/estado/reducer.ts";
import { renderMensagem, renderMensagensAgrupadas, renderTimeline } from "../../../web/telas/conversa.ts";
import { renderDecisoesDaConversa, renderSuaVez, rotuloVencido } from "../../../web/telas/sua-vez.ts";
import { REGRA_JANELA_SEGUINTE } from "../../../src/use-cases/disparar-rotina.ts";
import { REGRA_APP_SUBSTITUIDO } from "../../../src/use-cases/apps-do-bot.ts";

const item: SuaVezDto["itens"][number] = {
  decisao: { tenantId: "t", id: "d", ownerId: "p", decisorId: "p", agenteId: "a", conversaId: "c", turnoId: null, tipo: "acesso", estado: "pendente", prazoDecisaoEm: "2026-09-18T00:00:00Z", prazoExecucaoEm: null, frase: "Ler Slack <script>alert(1)</script>", desfecho: null, vistaEm: null, criadoEm: "2026-09-17T00:00:00Z", fioId: null },
  estadoColuna: "pendente", agenteNome: "Milton", aguardandoHaMs: 0, recusaAutomaticaEmMs: 60_000, gemeas: [], itensAprovacao: [], proposta: null, fio: null, rotinaParada: null,
};
const estado: Estado = { ...estadoInicial, suaVez: { itens: [item], incidentes: [], foraDoAr: [], vazio: false, ultimaDecisaoEm: null } };
const conversa: ConversaEstado = { conversa: { tenantId: "t", id: "c", ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a", salaId: null, sessaoCli: null, criadoEm: 0 }, mensagens: [], propostas: [], turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], fios: [], carregadaEm: 0 };

describe("decisões no chat", () => {
  it("mostra a autorização na conversa de origem com as mesmas ações da fila", () => {
    const html = renderTimeline(conversa, estado);
    expect(html).toContain("Preciso da sua decisão para continuar");
    expect(html).toContain('data-act="permitir-acesso"');
    expect(html).toContain('data-id="d"');
    // ADR-044: um clique concede E continua, e o botão diz isso.
    expect(html).toContain("Permitir e continuar");
    expect(html).toContain("Não permitir");
    expect(html).not.toContain('data-act="abrir-conversa"');
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(renderDecisoesDaConversa(estado, "outra", new Set())).toBe("");
  });

  it("não duplica a decisão que já tem proposta e remove o cartão quando a fila é reidratada", () => {
    expect(renderDecisoesDaConversa(estado, "c", new Set(["d"]))).toBe("");
    const atualizado = reduzir(estado, { tipo: "hidratar-sua-vez", suaVez: { itens: [], incidentes: [], foraDoAr: [], vazio: true, ultimaDecisaoEm: "2026-09-17T00:01:00Z" } });
    expect(renderTimeline(conversa, atualizado)).not.toContain("Permitir e continuar");
  });

  it("pedido vencido oferece reabertura e não concede acesso", () => {
    const vencido: Estado = { ...estado, sessao: { pessoaId: "p" } as Estado["sessao"], suaVez: { ...estado.suaVez!, itens: [{ ...item, estadoColuna: "vencido", decisao: { ...item.decisao, estado: "vencida" } }] } };
    const html = renderTimeline(conversa, vencido);
    expect(html).toContain("1 pedido vencido · ver");
    expect(html).not.toContain("Preciso da sua decisão para continuar");
    expect(html).toContain('data-act="reabrir"');
    expect(html).not.toContain('data-act="decidir-proposta"');
  });

  it("aprovação de conteúdo sensível continua desmarcada no chat", () => {
    const sensivel = { tenantId: "t", id: "i", decisaoId: "d", idx: 0, textoOriginal: "Olá", textoFinal: "Olá", destino: { conector: "slack", ferramenta: "send", argumentos: {} }, selecionado: false, origemSensivel: true, justificativa: "Confirme antes de enviar", marcadoPor: null, marcadoEm: null, editadoPor: null, desfecho: null, motivoManual: null };
    const e: Estado = { ...estado, suaVez: { ...estado.suaVez!, itens: [{ ...item, decisao: { ...item.decisao, tipo: "aprovacao" }, itensAprovacao: [sensivel] }] } };
    const html = renderTimeline(conversa, e);
    expect(html).toContain('data-item="i"');
    expect(html).not.toContain("checked");
    expect(html).toContain("Confirme antes de enviar");
    expect(html).toContain('data-contador>0</span> de 1');
  });

  it("um item só: pergunta sem lista, CTA nomeia a consequência e o jargão fica no disclosure", () => {
    const i = { tenantId: "t", id: "i", decisaoId: "d", idx: 0, textoOriginal: "Avisar o time", textoFinal: "Avisar o time", destino: { conector: "slack", ferramenta: "send_message", argumentos: { channel: "#vendas" } }, selecionado: true, origemSensivel: false, justificativa: null, marcadoPor: null, marcadoEm: null, editadoPor: null, desfecho: null, motivoManual: null };
    const e: Estado = {
      ...estado,
      conectores: [{ tenantId: "t", id: "cx", ownerId: "p", visibility: "privado", nome: "Slack", slug: "slack", transporte: "stdio", comando: null, args: [], url: null, env: {}, declaracao: "nao-toca", habilitado: true, catalogo: [], sondadoEm: null, ultimaFalha: null, criadoEm: 0 }],
      suaVez: { ...estado.suaVez!, itens: [{ ...item, decisao: { ...item.decisao, tipo: "aprovacao" }, itensAprovacao: [i] }] },
    };
    const html = renderTimeline(conversa, e);
    expect(html).toContain("Pode fazer");
    expect(html).toContain("Agora não");
    expect(html).not.toContain("Aprovar 1 de 1");
    expect(html).not.toContain("Não aprovar nada");
    // Item único e não sensível dispensa a lista: a pergunta já está na frase da decisão.
    expect(html).not.toContain('class="ap-lista"');
    // "no Slack" vem de Conector.nome, que já está no estado da web — sem campo novo no DTO.
    expect(html).toContain("no Slack");
    // O nome técnico e os argumentos existem, mas atrás do disclosure.
    expect(html).toContain("Ver detalhes");
    expect(html).toContain("slack.send_message");
    expect(html).toContain("#vendas");
    expect(html.indexOf("Ver detalhes")).toBeLessThan(html.indexOf("slack.send_message"));
  });

  it("dois itens mantêm a lista marcável e o contador só aparece quando informa", () => {
    const base = { tenantId: "t", decisaoId: "d", textoOriginal: "x", selecionado: true, origemSensivel: false, justificativa: null, marcadoPor: null, marcadoEm: null, editadoPor: null, desfecho: null, motivoManual: null };
    const a = { ...base, id: "i1", idx: 0, textoFinal: "Avisar o time", destino: { conector: "slack", ferramenta: "send_message", argumentos: {} } };
    const b = { ...base, id: "i2", idx: 1, textoFinal: "Arquivar a planilha", destino: { conector: "drive", ferramenta: "move_file", argumentos: {} } };
    const e: Estado = { ...estado, suaVez: { ...estado.suaVez!, itens: [{ ...item, decisao: { ...item.decisao, tipo: "aprovacao" }, itensAprovacao: [a, b] }] } };
    const html = renderTimeline(conversa, e);
    // definido em 2026-10-03: a lista mora no mesmo card da aprovação de um item (sua-vez.ts renderCardAprovacao).
    expect(html).toContain('class="aprov-itens"');
    expect(html).toContain('data-item="i1"');
    expect(html).toContain('data-item="i2"');
    expect(html).toContain("Avisar o time");
    expect(html).toContain("Arquivar a planilha");
    // Tudo marcado e nada sensível: contar "2 de 2" não acrescenta nada.
    expect(html).toContain("Pode fazer");
    expect(html).not.toContain("data-contador");
    // Slug sem conector casado no estado cai no próprio slug, nunca inventa nome.
    expect(html).toContain("no drive");
  });

  it("preserva registro imutável de consentimento recolhido sem repetir o catálogo", () => {
    const m: Mensagem = { tenantId: "t", id: "m", conversaId: "c", turnoId: null, kind: "consentimento", texto: "Registro original <auditoria>", payload: { kind: "consentimento", conectorId: "slack", slug: "slack", capacidade: "SLACK_SEARCH_MESSAGES", naoInclui: ["outras ferramentas"] }, confianca: "confiavel", parcial: false, criadoEm: 0, autoria: { autor_tipo: "pessoa", autor_id: "p", sob_procuracao_de: null, conta_de_execucao: "p", executor: "catcher", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "pessoa", regra_versao: 1 } };
    const html = renderMensagem(m, estado);
    expect(html).toContain("Acesso permitido · slack");
    expect(html).toContain("SLACK_SEARCH_MESSAGES");
    expect(html).toContain("Registro original &lt;auditoria&gt;");
    expect(html).toContain("Ver registro de autorização");
    expect(html).not.toContain(" open");
  });

  it("o terceiro botão nomeia a ferramenta e avisa que vale para qualquer destino", () => {
    const i = { tenantId: "t", id: "i", decisaoId: "d", idx: 0, textoOriginal: "Avisar", textoFinal: "Avisar", destino: { conector: "slack", ferramenta: "send_message", argumentos: {} }, selecionado: true, origemSensivel: false, justificativa: null, marcadoPor: null, marcadoEm: null, editadoPor: null, desfecho: null, motivoManual: null };
    const e: Estado = { ...estado, suaVez: { ...estado.suaVez!, itens: [{ ...item, decisao: { ...item.decisao, tipo: "aprovacao" }, itensAprovacao: [i] }] } };
    const html = renderTimeline(conversa, e);
    expect(html).toContain('data-act="decidir-aprovacao-sempre"');
    // definido em 2026-10-03: o rótulo diz a ação em português; o slug fica no título e no "Ver detalhes".
    expect(html).toContain("Sempre permitir send message no slack");
    expect(html).not.toContain(">Sempre permitir slack.send_message<");
    expect(html).toContain("em qualquer destino");
    expect(html).not.toContain("disabled");
  });

  it("ADR-062: item que parou por motivo que regra nenhuma pula desabilita 'Sempre permitir' e diz por quê", () => {
    const base = { tenantId: "t", decisaoId: "d", textoOriginal: "Comentar", textoFinal: "Comentar", selecionado: true, origemSensivel: false, justificativa: null, marcadoPor: null, marcadoEm: null, editadoPor: null, desfecho: null };
    const comMotivo = (motivoManual: "gate_de_rotina" | "regra_suspensa_conteudo_nao_confiavel" | "fora_do_catalogo" | "sem_regra_permanente", id = "i", ferramenta = "create_task_comment") => ({ ...base, id, idx: 0, destino: { conector: "clickup", ferramenta, argumentos: {} }, motivoManual });
    const html = (itens: ReturnType<typeof comMotivo>[]) => renderTimeline(conversa, { ...estado, suaVez: { ...estado.suaVez!, itens: [{ ...item, decisao: { ...item.decisao, tipo: "aprovacao" }, itensAprovacao: itens }] } });
    const gate = html([comMotivo("gate_de_rotina")]);
    expect(gate).toContain("disabled");
    expect(gate).toContain("uma regra não pula esse pedido");
    expect(gate).toContain("a rotina de onde isto veio pede a sua aprovação");
    expect(html([comMotivo("regra_suspensa_conteudo_nao_confiavel")])).toContain("com regra ou sem");
    expect(html([comMotivo("fora_do_catalogo")])).toContain("não está no alcance do bot agora");
    // Lote misto: o botão nomeia só o que vai virar regra.
    const misto = html([comMotivo("gate_de_rotina"), comMotivo("sem_regra_permanente", "j", "update_task")]);
    expect(misto).toContain("Sempre permitir update task no clickup");
    expect(misto).not.toContain("Sempre permitir create task comment");
  });

  it("PR 5 dos modos de aprovação: no cartão do revisor 'Sempre permitir' só aparece onde serve (sempreServe gravado pelo servidor)", () => {
    const base = { tenantId: "t", decisaoId: "d", textoOriginal: "Apagar", textoFinal: "Apagar", selecionado: true, origemSensivel: false, justificativa: "apaga mais do que você pediu", marcadoPor: null, marcadoEm: null, editadoPor: null, desfecho: null };
    const doRevisor = (motivoManual: "revisor_pediu" | "revisor_falhou", sempreServe: boolean | undefined, id = "i", ferramenta = "delete_task") => ({ ...base, id, idx: 0, destino: { conector: "clickup", ferramenta, argumentos: {} }, motivoManual, ...(sempreServe === undefined ? {} : { sempreServe }) });
    const html = (itens: ReturnType<typeof doRevisor>[]) => renderTimeline(conversa, { ...estado, suaVez: { ...estado.suaVez!, itens: [{ ...item, decisao: { ...item.decisao, tipo: "aprovacao" }, itensAprovacao: itens }] } });
    // O apagar num turno limpo: o botão vale (a regra pula o revisor da próxima vez).
    // PR 4: o cartão do revisor é o compacto (tela A3): o botão é "Sempre permitir" e a dica diz para quê.
    const serve = html([doRevisor("revisor_pediu", true)]);
    expect(serve).toContain('data-act="decidir-aprovacao-sempre"');
    expect(serve).toContain(">Sempre permitir</button>");
    expect(serve).toContain("Vale já para delete task no clickup");
    expect(serve).not.toContain("disabled");
    // O envio depois de conteúdo de fora, o turno contaminado, a falha e o item sem a marca: nem aparece.
    for (const itens of [[doRevisor("revisor_pediu", false)], [doRevisor("revisor_falhou", false)], [doRevisor("revisor_pediu", undefined)]]) {
      const h = html(itens);
      expect(h).not.toContain('data-act="decidir-aprovacao-sempre"');
      expect(h).toContain('data-act="decidir-aprovacao"');
      expect(h).toContain('data-act="decidir-aprovacao-nenhum"');
    }
    // Lote misto do revisor: o botão nomeia só o item em que serve.
    const misto = html([doRevisor("revisor_pediu", true), doRevisor("revisor_pediu", false, "j", "create_task_comment")]);
    expect(misto).toContain("Vale já para delete task no clickup,");
    expect(misto).not.toContain("Vale já para delete task no clickup e");
  });

  it("card só com item sensível mostra o botão DESABILITADO com o motivo, nunca ausente", () => {
    const sens = { tenantId: "t", id: "i", decisaoId: "d", idx: 0, textoOriginal: "Rel", textoFinal: "Rel", destino: { conector: "slack", ferramenta: "send_message", argumentos: {} }, selecionado: false, origemSensivel: true, justificativa: "dado pessoal", marcadoPor: null, marcadoEm: null, editadoPor: null, desfecho: null, motivoManual: null };
    const e: Estado = { ...estado, suaVez: { ...estado.suaVez!, itens: [{ ...item, decisao: { ...item.decisao, tipo: "aprovacao" }, itensAprovacao: [sens] }] } };
    const html = renderTimeline(conversa, e);
    // ADR-029: a pessoa lê por que não pode, em vez de procurar um botão que sumiu.
    expect(html).toContain('data-act="decidir-aprovacao-sempre"');
    expect(html).toContain("disabled");
    expect(html).toContain("Dado pessoal sempre passa por você");
  });

  it("mudança e exclusão de rotina no chat decidem pela decisão, não por propostas/:id/confirmar", () => {
    const base = { tenantId: "t", conversaId: "c", agenteId: "a", estado: "pendente" as const, criadoEm: 0 };
    const propostas: Proposta[] = [
      { ...base, id: "pa", kind: "rotina_atualizacao", payload: { kind: "rotina_atualizacao", rotinaId: "r1", cron: "0 9 * * *", resumo: "todo dia às 09:00", fusoIana: "America/Sao_Paulo", proximaExecucao: 0, antes: { resumo: "a cada 5 min", instrucao: "x" } } as Proposta["payload"] },
      { ...base, id: "pe", kind: "rotina_exclusao", payload: { kind: "rotina_exclusao", rotinaId: "r2", resumo: "a cada 15 min", instrucao: "y" } },
    ];
    const html = renderTimeline({ ...conversa, propostas }, { ...estadoInicial });
    expect(html).not.toContain('data-act="confirmar-proposta"');
    expect(html).not.toContain('data-act="recusar-proposta"');
    // NOD-399: o verbo no botão ("Salvar", "Excluir") e o destrutivo só com o verbo em vermelho.
    expect(html).toContain('data-id="pa">Salvar</button>');
    expect(html).toMatch(/class="bt cp-sim cp-perigo" data-act="decidir-proposta" data-id="pe">Excluir<\/button>/);
    expect(html.match(/data-act="decidir-proposta"/g)).toHaveLength(2);
    expect(html.match(/data-act="recusar-decisao"/g)).toHaveLength(2);
  });

  it("proposta de rotina com decisão vencida sai do chat e dá lugar à decisão vencida com Reabrir", () => {
    const proposta: Proposta = { tenantId: "t", id: "d", conversaId: "c", agenteId: "a", estado: "pendente", criadoEm: 0, kind: "rotina_exclusao", payload: { kind: "rotina_exclusao", rotinaId: "r", resumo: "a cada 15 min", instrucao: "y" } };
    const decisao = { ...item.decisao, tipo: "rotina_exclusao" as const };
    const vencido: Estado = { ...estado, suaVez: { ...estado.suaVez!, itens: [{ ...item, estadoColuna: "vencido", decisao: { ...decisao, estado: "vencida" } }] } };
    const html = renderTimeline({ ...conversa, propostas: [proposta] }, vencido);
    expect(html).not.toContain("Manter rotina");
    expect(html).not.toContain('data-act="decidir-proposta"');
    expect(html).toContain('data-act="reabrir"');
    // NOD-399 (critério 7): o card encolhe na linha "expirado", no lugar dele, uma vez só (não repete em "N pedidos vencidos").
    expect(html).toContain('class="cp-linha cp-expirado" role="status" data-proposta="d"');
    expect(html).toContain("Excluir uma rotina do bot <span class=\"mudo\">· expirou sem resposta, nada mudou</span>");
    expect(html).not.toContain("pedido vencido · ver");
    expect(html.match(/data-act="reabrir"/g)).toHaveLength(1);
    // Revisão 2: a linha não fica acumulada — "Dispensar" a tira (o servidor recusa a proposta junto).
    expect(html).toMatch(/cp-expirado.*data-act="dispensar" data-id="d"[^>]*>Dispensar<\/button>/);

    // QA do PR #607 (mutante M16): a proposta que já tem recibo de decidida na conversa não volta como "expirado".
    const recibo = { tenantId: "t", id: "pd", conversaId: "c", turnoId: null, autoria: { autor_tipo: "pessoa", autor_id: "p", sob_procuracao_de: null, conta_de_execucao: "p", executor: "catcher", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "pessoa", regra_versao: 1 }, kind: "sistema", texto: "…", payload: { kind: "proposta_decidida", propostaId: "d", tipo: "rotina_exclusao", titulo: "Excluir rotina", estado: "confirmada", turnoId: null }, confianca: "confiavel", parcial: false, criadoEm: 1, destino: "chat" } as unknown as Mensagem;
    expect(renderTimeline({ ...conversa, propostas: [proposta], mensagens: [recibo] }, vencido)).not.toContain("cp-expirado");

    const reaberta: Estado = { ...estado, sessao: { pessoaId: "p" } as Estado["sessao"], suaVez: { ...estado.suaVez!, itens: [{ ...item, estadoColuna: "pendente", decisao: { ...decisao, estado: "reaberta" } }] } };
    const aberto = renderTimeline({ ...conversa, propostas: [proposta] }, reaberta);
    expect(aberto.match(/data-act="decidir-proposta"/g)).toHaveLength(1);
    expect(aberto).toContain(">Excluir</button>");
  });

  it("NOD-50: pedido de credencial vencido tira o campo da chave e deixa a decisão vencida com Reabrir", () => {
    const proposta: Proposta = { tenantId: "t", id: "d", conversaId: "c", agenteId: "a", estado: "pendente", criadoEm: 0, kind: "credencial", payload: { kind: "credencial", alvo: "conector", conectorId: "cx", app: "Exemplo", chave: "EXEMPLO_API_KEY", para: "Ler os pedidos.", turnoId: "t1" } } as Proposta;
    const decisao = { ...item.decisao, tipo: "credencial" as const };
    const vencido: Estado = { ...estado, sessao: { pessoaId: "p" } as Estado["sessao"], suaVez: { ...estado.suaVez!, itens: [{ ...item, estadoColuna: "vencido", decisao: { ...decisao, estado: "vencida" } }] } };
    const html = renderTimeline({ ...conversa, propostas: [proposta] }, vencido);
    expect(html).not.toContain('data-form="guardar-credencial"');
    expect(html).toContain('data-act="reabrir"');
    const reaberta: Estado = { ...estado, sessao: { pessoaId: "p" } as Estado["sessao"], suaVez: { ...estado.suaVez!, itens: [{ ...item, estadoColuna: "pendente", decisao: { ...decisao, estado: "reaberta" } }] } };
    expect(renderTimeline({ ...conversa, propostas: [proposta] }, reaberta)).toContain('data-form="guardar-credencial"');
  });

  it("NOD-50 (revisão 6): na conversa, quem não é a dona vê o pedido sem o campo da chave", () => {
    const proposta: Proposta = { tenantId: "t", id: "d", conversaId: "c", agenteId: "a", estado: "pendente", criadoEm: 0, kind: "credencial", payload: { kind: "credencial", alvo: "conector", conectorId: "cx", app: "Exemplo", chave: "EXEMPLO_API_KEY", para: "Ler os pedidos.", turnoId: "t1" } } as Proposta;
    const comDona = (ownerId: string): Estado => ({ ...estado, sessao: { pessoaId: "p" } as Estado["sessao"], suaVez: { ...estado.suaVez!, itens: [{ ...item, decisao: { ...item.decisao, tipo: "credencial" as const, ownerId } }] } });
    expect(renderTimeline({ ...conversa, propostas: [proposta] }, comDona("p"))).toContain('data-form="guardar-credencial"');
    // Realista (revisão 7): Sua vez só traz as decisões de quem decide, então a colega da sala não tem a decisão nenhuma.
    const deOutra = renderTimeline({ ...conversa, propostas: [proposta] }, { ...estado, sessao: { pessoaId: "colega" } as Estado["sessao"], suaVez: { ...estado.suaVez!, itens: [] } });
    expect(deOutra).not.toContain('data-form="guardar-credencial"');
    expect(deOutra).toContain("Só quem pediu pode colá-la");
  });

  describe("pedido de acesso em um clique (ADR-044)", () => {
    const FRASE = "Nina precisa ler seu Gmail para a rotina “E-mails às 8h, 13h e 18h”. Não inclui: enviar, apagar, arquivar.";
    const deRotina: Proposta = { tenantId: "t", id: "d", conversaId: "c", agenteId: "a", estado: "pendente", criadoEm: 0, kind: "acesso", payload: { kind: "acesso", conector: "gmail", capacidades: ["GMAIL_FETCH_EMAILS", "GMAIL_LIST_LABELS"], nivel: "leitura", naoPedido: [], turnoId: "t1", rotinaId: "r1" } };
    const comDecisao = (p: Proposta, estadoColuna: "pendente" | "vencido" = "pendente"): Estado => ({
      ...estado,
      suaVez: { ...estado.suaVez!, itens: [{ ...item, estadoColuna, decisao: { ...item.decisao, estado: estadoColuna === "vencido" ? "vencida" : "pendente", frase: FRASE }, proposta: p }] },
    });

    it("pedido de rotina: a frase do domínio, 'Permitir e rodar agora' / 'Pausar rotina' pela decisão, e as ferramentas só no <details>", () => {
      const html = renderTimeline({ ...conversa, propostas: [deRotina] }, comDecisao(deRotina));
      expect(html).toContain("Nina precisa ler seu Gmail");
      expect(html).toContain("Permitir e rodar agora");
      expect(html).toContain("Pausar rotina");
      // revisto em 2026-09-25: o card de acesso permite pelo próprio botão (card-acesso.ts), que leva os grupos marcados.
      expect(html.match(/data-act="permitir-acesso"/g)).toHaveLength(1);
      expect(html.match(/data-act="recusar-decisao"/g)).toHaveLength(1);
      expect(html).not.toContain('data-act="confirmar-proposta"');
      expect(html).not.toContain("Revisar acesso");
      // O card da proposta e o item da decisão são o MESMO pedido: aparece uma vez só.
      expect(html).not.toContain("Preciso da sua decisão para continuar");
      expect(html.indexOf("<details")).toBeLessThan(html.indexOf("GMAIL_FETCH_EMAILS"));
      expect(html).toContain("<summary>Detalhes</summary>");
    });

    it("pedido da conversa: 'Permitir e continuar' / 'Não permitir'", () => {
      const daConversa: Proposta = { ...deRotina, payload: { kind: "acesso", conector: "gmail", capacidades: ["GMAIL_FETCH_EMAILS"], nivel: "leitura", naoPedido: [], turnoId: "t1" } };
      const html = renderTimeline({ ...conversa, propostas: [daConversa] }, comDecisao(daConversa));
      expect(html).toContain("Permitir e continuar");
      expect(html).toContain(">Agora não</button>");
      expect(html.indexOf("<summary>Detalhes</summary>")).toBeLessThan(html.indexOf("GMAIL_FETCH_EMAILS"));
    });

    it("pedido anterior, sem decisão em Sua vez, continua com 'Revisar acesso'", () => {
      const html = renderTimeline({ ...conversa, propostas: [deRotina] }, { ...estadoInicial });
      expect(html).toContain('data-act="confirmar-proposta"');
      expect(html).toContain("Revisar acesso");
      expect(html).not.toContain('data-act="decidir-proposta"');
    });

    it("decisão de acesso vencida tira o card e deixa a linha 'expirado' com Reabrir", () => {
      const html = renderTimeline({ ...conversa, propostas: [deRotina] }, comDecisao(deRotina, "vencido"));
      expect(html).not.toContain("Pausar rotina");
      expect(html).not.toContain('data-act="decidir-proposta"');
      expect(html).toContain('data-act="reabrir"');
      expect(html).toContain("cp-linha cp-expirado");
      expect(html).toContain("expirou sem resposta, nada mudou");
      // QA do PR #607: o título da linha é o mesmo do card aberto ("Permitir que X leia seu Gmail").
      expect(html).toMatch(/cp-expirado[^]*?<span>Permitir que [^<]+ leia seu [^<]+ <span class="mudo">/);
    });

    it("revisão 5: só capacidades de alterar no catálogo — 'altere' no card aberto e na linha expirada, o mesmo título", () => {
      const soAlterar: Proposta = { ...deRotina, id: "d", payload: { kind: "acesso", conector: "gmail", capacidades: ["GMAIL_SEND_EMAIL"], nivel: "escrita", naoPedido: [], turnoId: "t1", rotinaId: "r1" } };
      const conectores = [{ slug: "gmail", nome: "Gmail", habilitado: true, ownerId: "p", catalogo: [{ nome: "GMAIL_SEND_EMAIL", descricao: "", schema: {}, readOnlyHint: false, grupo: "criar" }] }] as never;
      const comApp = (e: Estado): Estado => ({ ...e, sessao: { tenantId: "t", pessoaId: "p" } as Estado["sessao"], conectores });
      const titulo = (h: string, re: RegExp): string => re.exec(h)?.[1] ?? "";
      const aberto = renderTimeline({ ...conversa, propostas: [soAlterar] }, comApp(comDecisao(soAlterar)));
      const vencido = renderTimeline({ ...conversa, propostas: [soAlterar] }, comApp(comDecisao(soAlterar, "vencido")));
      const tAberto = titulo(aberto, /<p class="cp-titulo">(?:<[^>]+>[^<]*<\/[^>]+>)*<span>(Permitir que [^<]+)<\/span>/);
      expect(tAberto).toMatch(/^Permitir que .+ altere seu Gmail$/);
      expect(titulo(vencido, /cp-expirado[^]*?<span>(Permitir que [^<]+) <span class="mudo">/)).toBe(tAberto);
    });

    // revisto em 2026-09-25 (jornadas de conexão): o card conecta ali mesmo e espera o login sozinho; quando o
    // servidor ainda não virou o card (login por outro caminho), "Continuar" abre o de permitir — leitura E escrita.
    const conectar: Proposta = { ...deRotina, id: "k", payload: { kind: "acesso", conector: "gmail", conectar: true, capacidades: [], nivel: "leitura", naoPedido: [], para: "Resumir os e-mails da manhã" } };
    const gmail = { tenantId: "t", id: "cx", ownerId: "p", visibility: "privado" as const, nome: "Gmail", slug: "gmail", transporte: "http" as const, comando: null, args: [], url: null, env: {}, declaracao: "nao-toca" as const, habilitado: true, catalogo: [], sondadoEm: null, ultimaFalha: null, criadoEm: 0 };

    it("card de conexão: 'Conectar Gmail' abre o login ali mesmo (sem ir ao marketplace) e mostra o para quê e os dois passos", () => {
      const html = renderTimeline({ ...conversa, propostas: [conectar] }, { ...estadoInicial });
      expect(html).toContain('data-act="conectar-app" data-id="gmail"');
      expect(html).toContain("Para resumir os e-mails da manhã");
      expect(html).toContain("Entrar no gmail");
      expect(html).not.toContain("abrir-conexao");
      expect(html).not.toContain("retomar-conexao");
    });

    it("card de conexão com o login em andamento espera sozinho, com Cancelar e o link para reabrir o login", () => {
      const html = renderTimeline({ ...conversa, propostas: [conectar] }, { ...estadoInicial, conectando: { gmail: { url: "https://login.exemplo/x", falhou: null } } });
      expect(html).toContain("Esperando você entrar no gmail");
      expect(html).toContain('href="https://login.exemplo/x"');
      expect(html).toContain('data-act="cancelar-conexao" data-id="gmail"');
      expect(html).not.toContain('data-act="conectar-app"');
    });

    it("card de conexão com o app já conectado: 'Continuar' (confirmar-proposta) para leitura e para escrita", () => {
      for (const nivel of ["leitura", "escrita"] as const) {
        const p: Proposta = { ...conectar, payload: { ...conectar.payload, kind: "acesso", nivel } as Proposta["payload"] };
        const html = renderTimeline({ ...conversa, propostas: [p] }, { ...estadoInicial, conectores: [gmail] });
        expect(html).toContain('data-act="confirmar-proposta" data-id="k"');
        expect(html).toContain("Gmail conectado");
      }
    });

    it("pedido de escrita com o catálogo à mão: um checkbox por grupo, apagar fora e Permitir leva os grupos", () => {
      const catalogo = [
        { nome: "CLICKUP_GET_TASKS", descricao: "", schema: {}, readOnlyHint: true, grupo: "ler" as const },
        { nome: "CLICKUP_CREATE_TASK", descricao: "", schema: {}, readOnlyHint: false, grupo: "criar" as const },
        { nome: "CLICKUP_DELETE_TASK", descricao: "", schema: {}, readOnlyHint: false, grupo: "apagar" as const },
      ];
      const clickup = { ...gmail, id: "cu", nome: "ClickUp", slug: "clickup", catalogo };
      const p: Proposta = { ...deRotina, id: "d", payload: { kind: "acesso", conector: "clickup", capacidades: ["CLICKUP_GET_TASKS", "CLICKUP_CREATE_TASK"], nivel: "escrita", naoPedido: [], turnoId: "t1" } };
      const base = comDecisao(p);
      const html = renderTimeline({ ...conversa, propostas: [p] }, { ...base, conectores: [clickup] });
      expect(html).toContain("Permitir que o bot leia e altere seu ClickUp");
      expect(html).toContain('data-caps="CLICKUP_GET_TASKS"');
      expect(html).toContain('data-caps="CLICKUP_CREATE_TASK"');
      expect(html).not.toContain('data-caps="CLICKUP_DELETE_TASK"');
      expect(html).toContain("<dt>Fica de fora</dt><dd>1 ação de apagar, desfazer e outras</dd>");
      // NOD-399: as permissões ficam dentro de Detalhes; o recusar é "Agora não".
      expect(html.indexOf("<summary>Detalhes</summary>")).toBeLessThan(html.indexOf('data-caps="CLICKUP_GET_TASKS"'));
      expect(html).toContain('data-act="recusar-decisao" data-id="d">Agora não</button>');
      expect(html).toContain('data-act="permitir-acesso"');
    });

    it("'Sua vez' usa os mesmos rótulos, vindos de item.proposta, e mostra as ações pedidas no <details>", () => {
      const html = renderSuaVez(comDecisao(deRotina));
      expect(html).toContain("Permitir e rodar agora");
      expect(html).toContain("Pausar rotina");
      expect(html).toContain("Ver as 2 ações pedidas");
      expect(renderSuaVez(estado)).toContain("Permitir e continuar");
    });

    it("consentimento em lote mostra a contagem; o registro com cada ferramenta fica recolhido", () => {
      const m: Mensagem = { tenantId: "t", id: "m", conversaId: "c", turnoId: null, kind: "consentimento", texto: "Concedido por Marlon em 2026-09-24 12:00 UTC: gmail.GMAIL_FETCH_EMAILS, gmail.GMAIL_LIST_LABELS; não inclui: …", payload: { kind: "consentimento", conectorId: "cx", slug: "gmail", capacidades: ["GMAIL_FETCH_EMAILS", "GMAIL_LIST_LABELS"], naoInclui: [] }, confianca: "confiavel", parcial: false, criadoEm: 0, autoria: { autor_tipo: "pessoa", autor_id: "p", sob_procuracao_de: null, conta_de_execucao: "p", executor: "catcher", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "pessoa", regra_versao: 1 } };
      const html = renderMensagem(m, estado);
      expect(html).toContain("Acesso permitido · gmail");
      expect(html).toContain("2 ações");
      expect(html.indexOf("<details")).toBeLessThan(html.indexOf("GMAIL_FETCH_EMAILS"));
    });
  });

  it("× só onde dispensar vale: vencida sempre, aberta só se responde com texto; 'Limpar vencidos' a partir de duas", () => {
    const vencida = (id: string): typeof item => ({ ...item, estadoColuna: "vencido", decisao: { ...item.decisao, id, estado: "vencida", tipo: "retomar_turno" } });
    const falta: typeof item = { ...item, decisao: { ...item.decisao, id: "f", tipo: "falta_de_dado" } };
    const com = (itens: (typeof item)[]): Estado => ({ ...estado, suaVez: { ...estado.suaVez!, itens } });

    const aberta = renderDecisoesDaConversa(com([item]), "c", new Set());
    expect(aberta).not.toContain('data-act="dispensar"');
    // Emenda da ADR-045: a pergunta aberta não é card na conversa (lá ela sai pelo "Deixar pra lá" da
    // faixa); em "Sua vez" continua com o seu ×.
    expect(renderDecisoesDaConversa(com([falta]), "c", new Set())).toBe("");
    expect(renderSuaVez(com([falta]))).toContain('data-act="dispensar" data-id="f"');

    const uma = renderDecisoesDaConversa(com([vencida("v1")]), "c", new Set());
    expect(uma).toContain('data-act="dispensar" data-id="v1"');
    expect(uma).not.toContain("Limpar vencidos");

    const duas = renderDecisoesDaConversa(com([item, vencida("v1"), vencida("v2")]), "c", new Set());
    expect(duas).toContain("Limpar vencidos (2)");
    expect(duas).toContain('data-ids="v1,v2"');
  });
});

type Item = SuaVezDto["itens"][number];
const H = 3_600_000;
const AGORA = Date.parse("2026-09-24T12:00:00Z");
const comItens = (itens: Item[]): Estado => ({ ...estadoInicial, agora: AGORA, suaVez: { itens, incidentes: [], foraDoAr: [], vazio: itens.length === 0, ultimaDecisaoEm: null } });
const aberto = (id: string, tipo: Item["decisao"]["tipo"], extra: Partial<Item> = {}): Item => ({ ...item, ...extra, decisao: { ...item.decisao, id, tipo, frase: `pedido ${id}` } });
const vencido = (id: string, desfecho: Item["decisao"]["desfecho"] = { tipo: "expirou_sem_ninguem_ver", em: new Date(AGORA - 3 * H).toISOString() }): Item => ({
  ...item,
  estadoColuna: "vencido",
  decisao: { ...item.decisao, id, tipo: "retomar_turno", estado: "vencida", prazoDecisaoEm: new Date(AGORA - 3 * H).toISOString(), frase: "Turno interrompido: seu Mac parou de responder", desfecho },
});
/** O trecho entre a abertura do <details> dos vencidos e o seu fechamento. */
const dentroDosVencidos = (html: string): string => html.slice(html.indexOf('<details class="dec-vencidos-lista"'), html.indexOf("</details>", html.indexOf('<details class="dec-vencidos-lista"')));

/**
 * Fila honesta (definido em 2026-09-24). medido em 2026-09-24 na tela do dono: uma conversa com 5
 * pedidos abertos e 15 cards cinza de "turno interrompido" vencidos, rótulo "venceu expirou com alguem
 * ciente", "recusa automática" onde nada é recusado e aprovações do computador sem dizer a ação.
 */
describe("fila honesta: vencidos recolhidos, ×N, prazo por tipo e rótulos em palavras", () => {
  it("15 vencidos viram UM <details> '15 pedidos vencidos · ver' com os 15 Reabrir lá dentro; os abertos ficam à vista, antes", () => {
    // Acesso, não pergunta: pergunta não vira card na conversa desde a emenda da ADR-045.
    const abertos = ["a1", "a2", "a3", "a4", "a5"].map((id) => aberto(id, "acesso"));
    const vencidos = Array.from({ length: 15 }, (_, i) => vencido(`v${i}`));
    const html = renderDecisoesDaConversa(comItens([...abertos, ...vencidos]), "c", new Set());
    expect(html.match(/<details/g)).toHaveLength(1);
    expect(html).toContain("<summary>15 pedidos vencidos · ver</summary>");
    // ADR-007: nenhum some — todos continuam lá dentro, cada um com o seu Reabrir.
    expect(dentroDosVencidos(html).match(/data-act="reabrir"/g)).toHaveLength(15);
    expect(html.match(/data-act="reabrir"/g)).toHaveLength(15);
    expect(html.indexOf("Preciso da sua decisão para continuar")).toBeLessThan(html.indexOf("<details"));
    expect(html.match(/class="decisao dec-pendente/g)).toHaveLength(5);
    // "Limpar vencidos" ao lado do resumo, fora do <summary> (senão o clique abriria e fecharia a lista).
    expect(html).toContain("Limpar vencidos (15)");
    expect(html.slice(html.indexOf("<summary>"), html.indexOf("</summary>"))).not.toContain("limpar-vencidos");
    expect(html.indexOf('data-act="limpar-vencidos"')).toBeGreaterThan(html.indexOf("</details>"));
  });

  it("prazo estourado que o varredor ainda não viu: fica no recolhido, mas sem × e fora do 'Limpar' — o servidor recusaria (podeDispensar)", () => {
    const estourada: Item = { ...item, estadoColuna: "vencido", decisao: { ...item.decisao, id: "ap", tipo: "aprovacao", estado: "pendente", prazoDecisaoEm: new Date(AGORA - 10_000).toISOString() } };
    const html = renderDecisoesDaConversa(comItens([estourada, vencido("v1"), vencido("v2")]), "c", new Set());
    expect(dentroDosVencidos(html)).toContain('data-decisao="ap"');
    expect(html).not.toContain('data-act="dispensar" data-id="ap"');
    expect(html).toContain('data-ids="v1,v2"');
    expect(html).toContain("Limpar vencidos (2)");
    expect(html).toContain("<summary>3 pedidos vencidos · ver</summary>");
  });

  it("'Sua vez' recolhe os vencidos do mesmo jeito e conta só os abertos no título", () => {
    const html = renderSuaVez(comItens([aberto("a1", "acesso"), vencido("v1"), vencido("v2")]));
    expect(html).toContain("<h1>Sua vez · 1</h1>");
    expect(html.match(/<details class="dec-vencidos-lista"/g)).toHaveLength(1);
    expect(html).toContain('data-disclosure="vencidos-sua-vez"');
    expect(dentroDosVencidos(html).match(/data-act="reabrir"/g)).toHaveLength(2);
  });

  it("×3 no pedido que dobrou dois iguais, com a dica de que decidir resolve todos", () => {
    const html = renderDecisoesDaConversa(comItens([aberto("g", "acesso", { gemeas: ["g2", "g3"] })]), "c", new Set());
    expect(html).toContain(">×3</span>");
    expect(html).toContain("3 pedidos iguais; decidir aqui resolve todos");
  });

  it("prazo honesto por tipo: 'recusa automática' só em aprovação e acesso", () => {
    const relogio = (tipo: Item["decisao"]["tipo"]): string => {
      const html = renderSuaVez(comItens([aberto("x", tipo, { aguardandoHaMs: 2 * H, recusaAutomaticaEmMs: 18 * H })]));
      return /<span class="mudo">([^<]*)<\/span>/.exec(html)?.[1] ?? "";
    };
    expect(relogio("aprovacao")).toBe("aguardando há 2h · recusa automática em 18h");
    expect(relogio("acesso")).toBe("aguardando há 2h · recusa automática em 18h");
    expect(relogio("gate_rotina")).toBe("aguardando há 2h · passa em branco em 18h");
    for (const tipo of ["perfil", "rotina", "rotina_atualizacao", "rotina_exclusao"] as const) expect(relogio(tipo), tipo).toBe("aguardando há 2h · vence em 18h · nada muda sem você");
    expect(relogio("retomar_turno")).toBe("aguardando há 2h · vence em 18h");
    // Plano "pergunta com botões" (2026-10-18): a pergunta em "Sua vez" é o cartão, sem "vence em" (o prazo segue no servidor
    // e como ordem da fila; gatilho na emenda da ADR-045 se mais de 15% das perguntas vencerem).
    for (const tipo of ["pergunta", "falta_de_dado", "permissao"] as const) expect(renderSuaVez(comItens([aberto("x", tipo, { aguardandoHaMs: 2 * H, recusaAutomaticaEmMs: 18 * H })])), tipo).not.toContain("vence ");
  });

  it("vencido em palavras, nunca o enum: quanto tempo faz e o que aconteceu", () => {
    const html = renderDecisoesDaConversa(comItens([vencido("v1"), vencido("v2", { tipo: "expirou_com_alguem_ciente", em: new Date(AGORA - 3 * H).toISOString() })]), "c", new Set());
    expect(html).toContain("venceu há 3h · ninguém chegou a ver");
    expect(html).toContain("venceu há 3h · alguém viu, mas ninguém respondeu");
    expect(html).not.toMatch(/expirou[ _]/);
    const d = vencido("x").decisao;
    const rotulo = (desfecho: Item["decisao"]["desfecho"]): string => rotuloVencido({ ...d, desfecho }, AGORA);
    const em = new Date(AGORA).toISOString();
    expect(rotulo({ tipo: "dispensada", por: "p", em, antes: "vencida" })).toBe("dispensado por você");
    expect(rotulo({ tipo: "decidida_por_regra", regra: "regra:rotina_nao_retoma", regraVersao: 1, em })).toBe("fechado: a rotina não retoma");
    expect(rotulo({ tipo: "decidida_por_regra", regra: "regra:gemea_resolvida", regraVersao: 1, em })).toBe("resolvido junto do pedido igual");
    expect(rotulo({ tipo: "decidida_por_regra", regra: "regra:janela_seguinte", regraVersao: 1, em })).toBe("fechada: a janela seguinte já rodou");
    expect(rotulo({ tipo: "decidida_por_regra", regra: "regra:acesso_ja_concedido", regraVersao: 1, em })).toBe("fechado: o acesso já tinha sido dado");
    expect(rotulo({ tipo: "decidida_por_regra", regra: REGRA_APP_SUBSTITUIDO, regraVersao: 1, em })).toBe("fechado: um card mais novo do mesmo app tomou o lugar");
    // re-QA do #335 (73204844): a regra que o agendador grava é a mesma chave do rótulo — com hífen caía no genérico.
    expect(rotulo({ tipo: "decidida_por_regra", regra: REGRA_JANELA_SEGUINTE, regraVersao: 1, em })).toBe("fechada: a janela seguinte já rodou");
    expect(rotulo({ tipo: "decidida_por_regra", regra: "regra:uma_nova", regraVersao: 1, em })).toBe("fechado automaticamente");
    expect(rotulo(null)).toBe("venceu há 3h");
    for (const r of [rotulo({ tipo: "expirou_sem_ninguem_ver", em }), rotulo({ tipo: "expirou_com_alguem_ciente", em }), rotulo({ tipo: "decidida", por: "p", em })]) expect(r).not.toContain("_");
  });

  it("aprovação no computador: a ação concreta aparece FORA do 'Ver detalhes'; fora do computador, nada muda", () => {
    const itemAp = (conector: string, texto: string) => ({ tenantId: "t", id: "i", decisaoId: "d", idx: 0, textoOriginal: texto, textoFinal: texto, destino: { conector, ferramenta: "executar", argumentos: { acaoId: "a" } }, selecionado: true, origemSensivel: false, justificativa: null, marcadoPor: null, marcadoEm: null, editadoPor: null, desfecho: null, motivoManual: null });
    const aprovacao = (conector: string, texto: string): Estado => comItens([{ ...item, decisao: { ...item.decisao, tipo: "aprovacao", frase: "Ação no computador do bot" }, itensAprovacao: [itemAp(conector, texto)] }]);
    const html = renderTimeline(conversa, aprovacao("computador", "Abrir no navegador: https://exemplo.com.br"));
    expect(html).toContain('<div class="ap-oque">Abrir no navegador: https://exemplo.com.br</div>');
    expect(html.indexOf("Abrir no navegador")).toBeLessThan(html.indexOf("Ver detalhes"));
    expect(html).toContain("no computador do bot");
    // A frase já diz tudo: não repete.
    expect(renderTimeline(conversa, aprovacao("computador", "Ação no computador do bot"))).not.toContain('class="ap-oque"');
    // Conector editável: o texto continua no campo do disclosure, sem cópia fora que ficaria velha.
    expect(renderTimeline(conversa, aprovacao("slack", "Avisar o time"))).not.toContain('class="ap-oque"');
  });

  it("'Retomar' aberto ganha 'Dispensar' ao lado (ADR-045), sem o × repetindo o gesto; vencido segue com ×", () => {
    const retomar = aberto("r", "retomar_turno");
    const html = renderDecisoesDaConversa(comItens([retomar]), "c", new Set());
    expect(html).toContain('data-act="retomar" data-id="r"');
    expect(html).toContain(">Dispensar</button>");
    expect(html.match(/data-act="dispensar"/g)).toHaveLength(1);
    expect(html.indexOf('data-act="retomar"')).toBeLessThan(html.indexOf('data-act="dispensar"'));
    expect(renderDecisoesDaConversa(comItens([vencido("v")]), "c", new Set())).toContain('data-act="dispensar" data-id="v"');
  });

  it("três ou mais linhas de sistema seguidas viram UM <details> 'N avisos do sistema · ver'; menos que isso e o cartão do computador ficam à vista", () => {
    const autoria = { autor_tipo: "pessoa", autor_id: "p", sob_procuracao_de: null, conta_de_execucao: "p", executor: "catcher", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "regra:varredor-expiracao", regra_versao: 1 } as const;
    const msg = (id: string, kind: Mensagem["kind"], payload: Mensagem["payload"] = null): Mensagem => ({ tenantId: "t", id, conversaId: "c", turnoId: null, kind, texto: `texto ${id}`, payload, confianca: "confiavel", parcial: false, criadoEm: 0, autoria });
    const mensagens = [
      msg("oi", "texto"),
      msg("s1", "sistema"),
      msg("s2", "sistema"),
      msg("s3", "sistema"),
      msg("r1", "rotina_execucao", { kind: "rotina_execucao", rotinaId: "r", instanteAgendado: 0, desfecho: "passou_em_branco" }),
      msg("meio", "texto"),
      msg("s4", "sistema"),
      msg("s5", "sistema"),
      msg("pc", "sistema", { kind: "computador_fora_do_ar", agenteId: "a", desde: 0, motivo: "sem_resposta" }),
      msg("s6", "sistema"),
    ];
    const html = renderMensagensAgrupadas(mensagens, estado);
    expect(html.match(/<details class="avisos-sistema"/g)).toHaveLength(1);
    expect(html).toContain("<summary>4 avisos do sistema · ver</summary>");
    const recolhido = html.slice(html.indexOf('<details class="avisos-sistema"'), html.indexOf("</details>"));
    for (const id of ["s1", "s2", "s3", "r1"]) expect(recolhido, id).toContain(`data-mensagem="${id}"`);
    // Nada apagado: todas as mensagens continuam no HTML, e o que não recolhe fica fora do <details>.
    for (const m of mensagens) expect(html).toContain(`data-mensagem="${m.id}"`);
    for (const id of ["oi", "meio", "s4", "s5", "pc", "s6"]) expect(recolhido, id).not.toContain(`data-mensagem="${id}"`);
    expect(html).toContain("Computador do bot fora do ar");
  });
});
