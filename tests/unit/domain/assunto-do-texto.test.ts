import { describe, expect, it } from "vitest";
import type { Assunto } from "../../../src/contracts/destino-no-chat.ts";
import type { ItemAprovacao } from "../../../src/contracts/item-aprovacao.ts";
import { MOTIVOS_FALHA, MOTIVOS_INTERRUPCAO } from "../../../src/contracts/motivos.ts";
import { MOTIVOS_FIM_LIGACAO } from "../../../src/contracts/voz.ts";
import { assuntoDaLinhaAntiga, assuntoDoTexto, assuntoNaLeitura, MOLDES_ANTIGOS, moldesQueCasam } from "../../../src/domain/assunto-do-texto.ts";
import { textoDaCompactacao } from "../../../src/domain/comandos.ts";
import { linhaDoDesfecho, mensagemDeNascimento } from "../../../src/domain/criar-bots.ts";
import { assuntoDaInterrupcao, destinoDe } from "../../../src/domain/destino-no-chat.ts";
import { MOTIVO_SERVIDOR_NAO_RESPONDEU, motivoDaQuedaEmPortugues, motivoEmPortugues, redigir } from "../../../src/domain/redacao.ts";
import { TEXTO_ROTINA_MUDOU } from "../../../src/use-cases/aplicar-proposta-rotina.ts";
import { textoRotinaAtiva } from "../../../src/use-cases/apoio-l7.ts";
import { TEXTO_PERFIL_MUDOU } from "../../../src/use-cases/confirmar-perfil.ts";
import { PEDIDO_DE_ACESSO_ABERTO } from "../../../src/use-cases/confirmar-proposta.ts";
import { textoAvisoAdiada } from "../../../src/use-cases/disparar-rotina.ts";
import { textoDoFim } from "../../../src/use-cases/ligacoes.ts";
import { textoAutomatico } from "../../../src/use-cases/pedir-aprovacao.ts";
import { textoPausada } from "../../../src/use-cases/pausar-rotina.ts";

const rotina = { cron: "0 9 * * *", fusoIana: "America/Sao_Paulo", proximaExecucao: Date.UTC(2026, 9, 19, 12) };
const item = (id: string): ItemAprovacao => ({
  tenantId: "t", id, decisaoId: "d", idx: 0, textoOriginal: "x", textoFinal: "Enviar o relatório", destino: { conector: "gmail", ferramenta: "send", argumentos: {} },
  selecionado: true, origemSensivel: false, justificativa: null, marcadoPor: null, marcadoEm: null, editadoPor: null, desfecho: null, motivoManual: null,
});

/**
 * Cada texto é gerado pela função de verdade (o caso de uso ou o catálogo): se a frase mudar sem o molde mudar junto, o
 * assunto deixa de casar e o teste aponta qual.
 */
/** Ficam no chat: o lado em que errar faz sumir. */
const FICAM_NO_CHAT: readonly [string, Assunto][] = [
  [redigir("turno-orfao-encerrado", 0, { causa: "nenhuma máquina tem o Claude" }), "turno.orfao"],
  [redigir("retorno-do-lote-caiu", 0, { frentes: "Hero w3, Hero w5" }), "lote.retorno_caiu"],
  [redigir("agente-nasceu", 0), "agente.criado"],
  ["Nina está pronto. O perfil que você definiu já está salvo; envie a primeira tarefa.", "agente.criado"],
  [mensagemDeNascimento({ nome: "Ada", quem: "Nina", pessoa: "Marlon", agora: Date.UTC(2026, 9, 15), descricao: "Revisa PRs." }), "agente.criado"],
  [textoRotinaAtiva(rotina, 0), "rotina.evento"],
  [`Rotina atualizada. ${textoRotinaAtiva(rotina, 0)}`, "rotina.evento"],
  // NOD-378: a rotina em UTC e as linhas gravadas antes da correção, com o fuso repetido no fim, seguem no chat.
  [textoRotinaAtiva({ ...rotina, fusoIana: "UTC" }, 0), "rotina.evento"],
  ["Rotina ativa: todo dia às 09:00 (America/Sao_Paulo) · próxima execução: 19/10/2026, 09:00 (America/Sao_Paulo).", "rotina.evento"],
  ["Rotina ativa: todo dia às 12:00 (UTC) · próxima execução: 19/10/2026, 12:00 UTC (UTC).", "rotina.evento"],
  ["Rotina atualizada. Rotina ativa: todo dia às 09:00 (America/Sao_Paulo) · próxima execução: 19/10/2026, 09:00 (America/Sao_Paulo).", "rotina.evento"],
  ["Rotina excluída: todo dia às 09:00. Nada mais será disparado por ela.", "rotina.evento"],
  [textoPausada({ cortados: 0, rodando: false }), "rotina.evento"],
  [textoPausada({ cortados: 2, rodando: true }), "rotina.evento"],
  [redigir("rotina-pausada-sem-acesso", 0, { app: "Gmail", prazo: "24h" }), "rotina.evento"],
  ["Nina pausou esta rotina a seu pedido: nada será disparado até você reativar.", "rotina.evento"],
  [TEXTO_ROTINA_MUDOU, "rotina.evento"],
  [textoAvisoAdiada({ motivo: "execucao_anterior_aberta" }), "rotina.adiada"],
  [textoAvisoAdiada({ motivo: "frente_aberta", titulo: "Revisar PRs" }), "rotina.adiada"],
  [TEXTO_PERFIL_MUDOU, "proposta.obsoleta"],
  [redigir("fala-no-limite-espera", 0, { ia: "Claude", quando: "às 14:00" }), "ia.fala_espera"],
  [redigir("ia-pronta-noutra-maquina", 0, { ia: "Claude", outra: "ChatGPT", maquina: "em VM", quando: "às 14:00" }), "ia.fala_espera"],
  [redigir("conta-fora-da-maquina", 0, { conta: "Conta 2", maquina: "em VM" }), "conta.recusada"],
  ["Revogado por Marlon em 18/10 10:00 UTC: gmail.ler.", "acesso.revogado"],
  ["Marlon liberou abrir o site até o fim desta tarefa.", "acesso.concedido"],
  ["Aprovado. 2 ações aguardam seu Mac: com o app nod aberto e o gh logado, o GitHub recebe em instantes e o resultado aparece aqui.", "aprovacao.recibo"],
  ["Recusado: 2 mudanças nos seus bots.", "aprovacao.recibo"],
  ["1 de 2 mudanças feitas.\n✓ Renomear Ada\n✗ Excluir Tuca — não deu certo (falhou)", "aprovacao.recibo"],
  ["Nova sessão · Ada começa sem o que vocês conversaram até aqui. As mensagens continuam aqui para você.", "sessao.nova"],
  [textoAutomatico([item("a"), item("b")], [{ itemId: "a", desfecho: "executado" }, { itemId: "b", desfecho: "falhou_na_execucao" }]), "aprovacao.automatica_falhou"],  // O que pede ação da pessoa (orquestrador, 18/10, QA do PR 1): a queda com o "Retomar" e a pergunta vencida.
  [redigir("turno-interrompido", 0, { motivo: motivoEmPortugues("maquina_sem_contato") }), "turno.queda_da_maquina"],
  [redigir("turno-interrompido", 0, { motivo: motivoDaQuedaEmPortugues({ nome: "nod-vm", plataforma: "linux" }) }), "turno.queda_da_maquina"],
  [redigir("turno-interrompido", 0, { motivo: motivoEmPortugues("reinicio_servidor") }), "turno.queda_da_maquina"],
  [redigir("turno-interrompido", 0, { motivo: MOTIVO_SERVIDOR_NAO_RESPONDEU }), "turno.queda_da_maquina"],
  [redigir("decisao-vencida", 0, { quando: "18/10 10:00", desfecho: "ninguém viu" }), "decisao.vencida"],
];

const OUTROS: readonly [string, Assunto][] = [
  // Vão para a Atividade.
  [textoAutomatico([item("a")], [{ itemId: "a", desfecho: "executado" }]), "aprovacao.automatica"],
  [linhaDoDesfecho("Nina", "Marlon", ["Ada", "Tuca"]), "bot.criado"],
  ["Bot Ada criado.", "bot.criado"],
  [redigir("anotei", 0, { tipo: "uma preferência", texto: "relatórios em reais" }), "memoria.anotada"],
  ['Fechei a task "Revisar PR", parada esperando você, para liberar memória. Ela volta do mesmo ponto quando você responder.', "memoria.task_fechada"],
  [textoDaCompactacao("Ada", 140_000, 20_000), "compactacao"],
  [textoDaCompactacao("Ada", null, null), "compactacao"],
  [redigir("retomada", 0, { motivo: "maquina_sem_contato" }), "turno.retomado"],
  [redigir("retomada-automatica", 0, { motivo: "a máquina caiu", tentativa: "1", maximo: "3" }), "turno.retomado"],
  [redigir("frente-retomada-automatica", 0, { titulo: "Hero", motivo: "a máquina caiu", tentativa: "1", maximo: "3" }), "turno.retomado"],
  [redigir("proposta-confirmada", 0, { pessoa: "Marlon", resumo: "todo dia às 9h" }), "proposta.decidida"],
  [redigir("proposta-recusada", 0), "proposta.decidida"],
  [PEDIDO_DE_ACESSO_ABERTO, "proposta.decidida"],
  [redigir("cota-no-limite-espera", 0, { ia: "Claude", quando: "às 14:00" }), "cota.espera"],
  [redigir("cota-no-limite-segue", 0, { ia: "Claude", para: "ChatGPT" }), "cota.espera"],
  [redigir("conta-no-limite-espera", 0, { de: "1", ia: "Claude", quando: "às 14:00" }), "cota.espera"],
  [redigir("cota-no-limite-espera-pedido", 0, { ia: "Claude", quando: "às 14:00" }), "cota.espera"],
  [redigir("conta-no-limite-espera-pedido", 0, { de: "1", ia: "Claude", quando: "às 14:00" }), "cota.espera"],
  [redigir("cota-no-limite-espera-rotina", 0, { ia: "Claude", quando: "às 14:00" }), "cota.espera"],
  [redigir("cota-no-limite-rotina-nao-rodou", 0, { ia: "Claude", quando: "amanhã" }), "cota.espera"],
  [redigir("fundo-nova-tentativa", 0, { ia: "Claude", pedido: "Este pedido", quando: "às 14:00", tentativa: "1", maximo: "3" }), "fundo.espera"],
  [redigir("fundo-espera-maquina", 0, { maquina: "O Mac", pedido: "Esta task" }), "fundo.espera"],
  [redigir("fundo-espera-servidor", 0, { pedido: "Esta task", quando: "às 10:01" }), "fundo.espera"],
  [redigir("rotina-nao-rodou", 0, { motivo: "Mac sem contato", quando: "às 14:00" }), "rotina.adiada"],
  [redigir("pedido-a-colega-espera-cota", 0, { agente: "Ada", ia: "Claude", quando: "às 14:00" }), "cota.espera"],
  [redigir("rodando-desta-vez", 0, { maquina: "Mac do Marlon" }), "conta.nota"],
  [redigir("tentando-de-novo", 0, { conta: "Conta 2" }), "conta.nota"],
  ["Parada encerrada: você usou Executar agora e a rotina voltou a rodar.", "parada"],
  ["Marlon mudou as aprovações de Ada para Automático: o bot aprova sozinho o que é seguro.", "aprovacao.modo"],
  ["Nenhuma IA está pronta agora na máquina do Ada: as tasks em andamento ficaram onde estavam. Daqui em diante ele usa o Automático.", "inteligencia"],
  // Sala: a tabela não vale lá, mas o assunto fica certo.
  ['Sala "Geral" criada com Ada, Tuca. Sem menção, Ada responde; @Nome dirige a pergunta.', "sala.evento"],
  ["Ada entrou na sala. Nasce sem nenhum acesso por estar aqui.", "sala.evento"],
  ["Ninguém foi mencionado: nesta sala só menção (@Nome) dispara resposta.", "sala.evento"],
  ["A rodada assentou: todos os bots presentes passaram a vez.", "sala.evento"],
  ["A rodada encerrou pelo teto de encaminhamentos (3 por rodada sem fala humana).", "sala.evento"],
  ["Ninguém disponível nesta rodada.", "sala.evento"],
  // O fim da ligação, de cada motivo que escreve linha.
  ...MOTIVOS_FIM_LIGACAO.flatMap((m): [string, Assunto][] => {
    const t = textoDoFim(m);
    return t ? [[t, "ligacao"]] : [];
  }),
];

const EXEMPLOS = [...FICAM_NO_CHAT, ...OUTROS];

describe("assunto pelo texto (backfill)", () => {
  it("cada texto de exemplo casa com o assunto certo", () => {
    for (const [texto, assunto] of EXEMPLOS) expect(assuntoDoTexto(texto), texto).toBe(assunto);
  });

  it("nenhum texto de exemplo casa com dois moldes", () => {
    for (const [texto] of EXEMPLOS) expect(moldesQueCasam(texto).length, `${texto} → ${moldesQueCasam(texto).join(", ")}`).toBeLessThanOrEqual(1);
  });

  it("os que ficam no chat ficam mesmo (nenhum molde do lado perigoso cai na Atividade)", () => {
    for (const [texto, assunto] of FICAM_NO_CHAT) expect(destinoDe(assunto), `${texto} → ${assunto}`).toBe("chat");
  });

  it("turno interrompido: parado e lido junto vão para a Atividade; a queda da máquina e a falha ficam no chat", () => {
    const interrompido = (motivo: string) => assuntoDoTexto(redigir("turno-interrompido", 0, { motivo }));
    expect(interrompido(motivoEmPortugues("parado_pela_pessoa"))).toBe("turno.interrompido");
    expect(interrompido(motivoEmPortugues("absorvido"))).toBe("turno.interrompido");
    expect(interrompido(motivoEmPortugues("maquina_sem_contato"))).toBe("turno.queda_da_maquina");
    expect(interrompido(motivoDaQuedaEmPortugues({ nome: "nod-vm", plataforma: "linux" }))).toBe("turno.queda_da_maquina");
    expect(interrompido(motivoEmPortugues("reinicio_servidor"))).toBe("turno.queda_da_maquina");
    expect(destinoDe("turno.queda_da_maquina")).toBe("chat");
    for (const m of MOTIVOS_FALHA) expect(interrompido(motivoEmPortugues(m)), m).toBe("turno.falhou");
    // A frase do fornecedor (fraseDoErroFornecedor) e um motivo que mudou de texto: o lado seguro, o chat.
    expect(interrompido("sua conta do Claude Code saiu deste Mac; entre de novo")).toBe("turno.falhou");
    expect(destinoDe(interrompido("motivo de antigamente"))).toBe("chat");
  });

  // QA do PR 1 (2026-10-18): o produtor gravava turno.falhou e o backfill turno.queda_da_maquina para a mesma queda.
  it("turno interrompido: o backfill dá a cada motivo o MESMO assunto que o produtor grava (assuntoDaInterrupcao)", () => {
    for (const m of [...MOTIVOS_INTERRUPCAO, ...MOTIVOS_FALHA]) {
      expect(assuntoDoTexto(redigir("turno-interrompido", 0, { motivo: motivoEmPortugues(m) })), m).toBe(assuntoDaInterrupcao(m));
    }
    expect(assuntoDaInterrupcao("maquina_sem_contato")).toBe("turno.queda_da_maquina");
    expect(assuntoDaInterrupcao("reinicio_servidor")).toBe("turno.queda_da_maquina");
    expect(assuntoDaInterrupcao("parado_pela_pessoa")).toBe("turno.interrompido");
    expect(assuntoDaInterrupcao("erro_execucao")).toBe("turno.falhou");
    expect(assuntoDaInterrupcao("motivo_que_nao_existe")).toBe("turno.falhou");
  });

  it("texto sem molde não tem assunto (o backfill grava sistema.generico e o --seco conta)", () => {
    expect(assuntoDoTexto("Uma frase que o nod nunca escreveu.")).toBeNull();
    expect(assuntoDoTexto("")).toBeNull();
    // Molde inteiro: um prefixo de molde no meio de outra frase não casa.
    expect(assuntoDoTexto(`Disse: ${redigir("turno-orfao-encerrado", 0, { causa: "x" })}`)).toBeNull();
  });

  it("linha antiga: payload pela tabela, primeira linha da conversa é a criação do bot, reservas da sala e do recibo", () => {
    const base = { decididoPor: "pessoa" as const, tipoConversa: "propria" as const, primeiraDaConversa: false };
    expect(assuntoDaLinhaAntiga({ ...base, kind: "sistema", payload: null, texto: "Uma frase antiga de boas-vindas.", primeiraDaConversa: true })).toEqual({ assunto: "agente.criado", semCasamento: false });
    expect(assuntoDaLinhaAntiga({ ...base, kind: "sistema", payload: null, texto: "Uma frase antiga de boas-vindas." })).toEqual({ assunto: "sistema.generico", semCasamento: true });
    expect(assuntoDaLinhaAntiga({ ...base, kind: "sistema", payload: null, texto: "Uma linha de sala.", tipoConversa: "sala" })).toEqual({ assunto: "sala.evento", semCasamento: true });
    expect(assuntoDaLinhaAntiga({ ...base, kind: "resultado_aprovacao", payload: null, texto: "Recibo de outro formato" })).toEqual({ assunto: "aprovacao.recibo", semCasamento: true });
    expect(assuntoDaLinhaAntiga({ ...base, kind: "texto", payload: null, texto: "Oi" })).toEqual({ assunto: null, semCasamento: false });
    expect(assuntoDaLinhaAntiga({ ...base, kind: "consentimento", decididoPor: "regra:aprovacao_automatica", payload: { kind: "consentimento", conectorId: "c", slug: "gmail", capacidades: ["ler"], naoInclui: [] }, texto: "x" }).assunto).toBe("acesso.automatico");
  });

  it("os moldes antigos também casam com UM molde só", () => {
    for (const m of MOLDES_ANTIGOS) expect(moldesQueCasam(m.molde.replaceAll(/\{[a-zA-Z]+\}/g, "x")).length, m.nome).toBe(1);
  });

  it("na leitura (PR 2): o assunto gravado vale; sem ele, o mesmo do backfill — o aviso antigo sai do chat antes de o backfill rodar", () => {
    const base = { decididoPor: "pessoa" as const, primeiraDaConversa: false, payload: null };
    // O gravado ganha sempre, até de um texto que o mandaria para outro lugar (o produtor sabe o que a linha é).
    expect(assuntoNaLeitura({ ...base, assunto: "turno.orfao", kind: "sistema", texto: "Anotei uma preferência: x" })).toBe("turno.orfao");
    // Valor que este código não conhece (gravado por um mais novo) passa adiante; destinoDe o deixa no chat.
    expect(destinoDe(assuntoNaLeitura({ ...base, assunto: "assunto.do.futuro", kind: "sistema", texto: "x" }))).toBe("chat");
    expect(assuntoNaLeitura({ ...base, assunto: null, kind: "sistema", texto: "Anotei uma preferência: em reais" })).toBe("memoria.anotada");
    expect(assuntoNaLeitura({ ...base, assunto: null, kind: "sistema", texto: "Uma frase antiga.", primeiraDaConversa: true })).toBe("agente.criado");
    expect(assuntoNaLeitura({ ...base, assunto: null, kind: "texto", texto: "Oi" })).toBeNull();
    // A pergunta vencida com a frase de antes de 24/09 ainda pede ação ("você pode reabrir"): fica no chat.
    const vencidaAntiga = assuntoNaLeitura({ ...base, assunto: null, kind: "sistema", texto: "Esta decisão venceu em 20/09 às 14:00 sem resposta (recusada por padrão). Você pode reabrir." });
    expect(vencidaAntiga).toBe("decisao.vencida");
    expect(destinoDe(vencidaAntiga)).toBe("chat");
    expect(assuntoNaLeitura({ ...base, assunto: null, kind: "negacao", texto: "Bash negada", payload: { kind: "negacao", classe: "ferramenta_negada", nome: "Bash", motivo: "fora_do_catalogo", terminal: false } })).toBe("negacao.ferramenta");
  });
});
