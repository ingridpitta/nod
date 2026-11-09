import { describe, expect, it } from "vitest";
import type { AcaoDoModoNaFala } from "../../../src/contracts/acoes-do-modo.ts";
import type { ConversaDto, SuaVezDto } from "../../../src/contracts/api.ts";
import type { ItemDeAtividade } from "../../../src/contracts/atividade.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { estadoInicial, reduzir, type Estado } from "../../../web/estado/reducer.ts";
import { renderAtividade } from "../../../web/telas/atividade.ts";
import { dadosDoEncolhido } from "../../../web/telas/cartao-encolhido.ts";
import { textoComCodigo } from "../../../web/lib/render.ts";
import { ehCartaoDoRevisor, motivoDoCartao, MOTIVO_NA_TELA_MAX, perguntaDoCartao, sempreNoCartao } from "../../../web/telas/cartao-revisor.ts";
import { blocosDoHistorico, renderTimeline } from "../../../web/telas/conversa.ts";
import { renderLinhaDoModo, textoDaLinhaDoRevisor } from "../../../web/telas/linha-do-modo.ts";
import { renderSuaVez } from "../../../web/telas/sua-vez.ts";

/**
 * PR 4 dos modos de aprovação: o que a pessoa vê do revisor do Automático — o cartão compacto (tela A3), a linha "Revisor
 * liberou … · ver" embaixo da fala (A1, A2), o "Devia ter perguntado" na Atividade e o encolhido "Negado por você".
 */
type Item = SuaVezDto["itens"][number];
type ItemAprov = Item["itensAprovacao"][number];

const C = "c-ze";
const T0 = new Date(2026, 9, 18, 14, 20).getTime();
const MIN = 60_000;

const itemAprov = (extra: Partial<ItemAprov> = {}): ItemAprov => ({
  tenantId: "t", id: "i1", decisaoId: "d1", idx: 0, textoOriginal: "git push --force origin feat/login", textoFinal: "git push --force origin feat/login",
  destino: { conector: "terminal", ferramenta: "bash", argumentos: { comando: "git push --force origin feat/login" } }, selecionado: true, origemSensivel: false,
  justificativa: "Você pediu um push, não um push forçado.", marcadoPor: null, marcadoEm: null, editadoPor: null, desfecho: null, motivoManual: "revisor_pediu", ...extra,
} as ItemAprov);

const cartao = (itens: ItemAprov[], extra: Partial<Item> = {}): Item => ({
  decisao: { tenantId: "t", id: "d1", ownerId: "p", decisorId: "p", agenteId: "ze", conversaId: C, turnoId: null, tipo: "aprovacao", estado: "pendente", prazoDecisaoEm: "2026-10-19T00:00:00Z", prazoExecucaoEm: null, frase: "Ze quer rodar um comando no seu Mac", desfecho: null, vistaEm: null, criadoEm: "2026-10-18T00:00:00Z", fioId: null },
  estadoColuna: "pendente", agenteNome: "Ze", aguardandoHaMs: 2 * MIN, recusaAutomaticaEmMs: 60_000, gemeas: [], itensAprovacao: itens, proposta: null, fio: null, rotinaParada: null, ...extra,
} as Item);

const conversaDto = (mensagens: Mensagem[] = [], acoesDoModo?: ConversaDto["acoesDoModo"]): ConversaDto => ({
  conversa: { tenantId: "t", id: C, ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "ze", salaId: null, sessaoCli: null, criadoEm: 1 } as never,
  mensagens, turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], propostas: [], fios: [], ...(acoesDoModo ? { acoesDoModo } : {}),
});

function estadoCom(itens: Item[], mensagens: Mensagem[] = [], acoesDoModo?: ConversaDto["acoesDoModo"]): Estado {
  const base = reduzir(estadoInicial, { tipo: "hidratar-conversa", conversa: conversaDto(mensagens, acoesDoModo), agora: T0 + 10 * MIN });
  return {
    ...base, agora: T0 + 10 * MIN, sessao: { pessoaId: "p", tenantId: "t" } as never,
    frota: { agentes: [{ id: "ze", nome: "Ze", conversaId: C, cor: "c-bleu", forma: "shape-square", ownerId: "p" }] } as never,
    suaVez: { itens, incidentes: [], foraDoAr: [], vazio: itens.length === 0, ultimaDecisaoEm: null },
  };
}
const naConversa = (e: Estado): string => renderTimeline(e.conversas[C]!, e);

describe("o cartão compacto do revisor (tela A3)", () => {
  it("revisor_pediu na conversa: escudo, a pergunta numa linha, 'Revisor:' e o motivo, o comando em 'ver comando', Aprovar e Negar em pílula", () => {
    const html = naConversa(estadoCom([cartao([itemAprov()])]));
    expect(html).toContain('class="decisao cartao-revisor');
    expect(html).toContain('role="group" aria-labelledby="cr-t-d1"');
    // Sem a frase da ação (servidor de antes do PR 4b), a frase da decisão. A pergunta quebra a linha desde o PR 4b, então
    // o `title` com o texto inteiro saiu (repetia o que já se lê).
    expect(html).toContain('<p class="cr-pergunta" id="cr-t-d1">Ze quer rodar um comando no seu Mac</p>');
    expect(html).toContain('<p class="cr-motivo"><b>Revisor:</b> Você pediu um push, não um push forçado.</p>');
    expect(html).toContain("<summary>ver comando</summary>");
    expect(html).toContain('<pre class="ap-comando"><code>git push --force origin feat/login</code></pre>');
    expect(html).toContain('class="bt cr-aprovar" data-act="decidir-aprovacao" data-id="d1">Aprovar</button>');
    expect(html).toContain('class="bt cr-negar" data-act="decidir-aprovacao-nenhum" data-id="d1">Negar</button>');
    // Terminal: sem "Sempre permitir" e sem o "resto desta tarefa" do cartão de antes; nada do cartão âmbar.
    expect(html).not.toContain("decidir-aprovacao-sempre");
    expect(html).not.toContain("decidir-aprovacao-resto");
    expect(html).not.toContain("aprov-card");
    expect(html).not.toContain("precisa do seu ok");
    // Na conversa, sem cabeçalho nem "abrir conversa".
    expect(html).not.toContain("cr-cab");
    expect(html).not.toContain('data-act="abrir-conversa"');
  });

  it("NOD-443 (revisão 8 do PR #628): na conversa, o cartão a pedido de quem participa do quadro diz de quem é no corpo, escapado", () => {
    const html = naConversa(estadoCom([cartao([itemAprov()], { aPedidoDe: "Ana <b>" })]));
    expect(html).toContain('<div class="cr-corpo"><p class="cr-pedido-de">A pedido de Ana &lt;b&gt;</p><p class="cr-pergunta" id="cr-t-d1">');
    expect(html).not.toContain("cr-cab");
    // O pedido da própria dona não ganha a linha; em "Sua vez", o nome vai no cabeçalho e não repete no corpo.
    expect(naConversa(estadoCom([cartao([itemAprov()])]))).not.toContain("cr-pedido-de");
    const e = estadoCom([cartao([itemAprov()], { aPedidoDe: "Ana" })]);
    const naLista = renderSuaVez(e);
    expect(naLista).toContain('<span class="aprov-pedido-de">· a pedido de Ana</span>');
    expect(naLista).not.toContain("cr-pedido-de");
  });

  it("revisor_falhou: a frase da causa, sem rótulo repetido quando já diz 'revisor'; a justificativa de queda nunca vira 'Revisor:'", () => {
    const prazo = naConversa(estadoCom([cartao([itemAprov({ motivoManual: "revisor_falhou", justificativa: "O revisor não respondeu a tempo; confira você." })])]));
    expect(prazo).toContain('<p class="cr-motivo">O revisor não respondeu a tempo; confira você.</p>');
    expect(motivoDoCartao([{ motivoManual: "revisor_falhou", justificativa: "Você já foi consultado sobre esta ação; confira de novo." }])).toEqual({ rotulo: "Revisor:", texto: "Você já foi consultado sobre esta ação; confira de novo." });
    expect(motivoDoCartao([{ motivoManual: "revisor_falhou", justificativa: null }]).texto).toBe("O revisor não respondeu; confira você.");
    expect(motivoDoCartao([{ motivoManual: "revisor_pediu", justificativa: null }])).toEqual({ rotulo: "Revisor:", texto: "pediu o seu ok antes de seguir." });
  });

  it("as frases de falha vêm prontas do servidor (FRASE_DA_FALHA): o cartão as mostra como vieram, sem 'Revisor:' repetido", () => {
    // A frase de cada código mora no domínio do servidor (src/domain/revisor.ts); a tela não tem tabela própria.
    for (const frase of ["Você chegou ao limite de revisões de hoje; confira você.", "O revisor não respondeu; confira você.", "O revisor está ocupado demais agora; confira você.", "O revisor chegou ao limite do dia; confira você."]) {
      expect(motivoDoCartao([{ motivoManual: "revisor_falhou", justificativa: frase }]), frase).toEqual({ rotulo: null, texto: frase });
    }
  });

  it("o motivo do revisor é texto de modelo: escapado e cortado em 160", () => {
    const longo = `<img src=x onerror=alert(1)> ${"a".repeat(300)}`;
    const html = naConversa(estadoCom([cartao([itemAprov({ justificativa: longo })])]));
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    const m = motivoDoCartao([{ motivoManual: "revisor_pediu", justificativa: longo }]);
    expect(m.texto.length).toBe(MOTIVO_NA_TELA_MAX);
    expect(m.texto.endsWith("…")).toBe(true);
  });

  it("'Sempre permitir' só com sempreServe (apagar de app em turno limpo): ausente no terminal, no envio, no contaminado e no falhou", () => {
    const app = (extra: Partial<ItemAprov> = {}) => itemAprov({ destino: { conector: "clickup", ferramenta: "delete_task", argumentos: { task_id: "42" } }, textoOriginal: "Apagar a task 42", textoFinal: "Apagar a task 42", justificativa: "2 delas foram editadas esta semana", ...extra });
    const serve = naConversa(estadoCom([cartao([app({ sempreServe: true })], { decisao: { ...cartao([]).decisao, frase: "Ze quer apagar 14 planilhas" } })]));
    expect(serve).toContain('class="bt cr-sempre" data-act="decidir-aprovacao-sempre" data-id="d1" title="Vale já para delete task no clickup, em qualquer destino');
    expect(serve).toContain("<summary>ver detalhes</summary>");
    expect(serve).toContain("<b>Revisor:</b> 2 delas foram editadas esta semana");
    for (const itens of [[app({ sempreServe: false })], [app()], [app({ sempreServe: true, motivoManual: "revisor_falhou" })], [itemAprov({ sempreServe: true })], [app({ sempreServe: true, origemSensivel: true })]]) {
      expect(naConversa(estadoCom([cartao(itens)]))).not.toContain("decidir-aprovacao-sempre");
    }
    expect(sempreNoCartao(cartao([app({ sempreServe: true })], { nuncaPermanente: ["i1"] }))).toEqual([]);
  });

  it("só os itens do revisor viram o cartão compacto; o resto continua o cartão de sempre", () => {
    expect(ehCartaoDoRevisor([{ motivoManual: "revisor_pediu" }, { motivoManual: "revisor_falhou" }])).toBe(true);
    expect(ehCartaoDoRevisor([{ motivoManual: "revisor_pediu" }, { motivoManual: "acao_arriscada" }])).toBe(false);
    expect(ehCartaoDoRevisor([])).toBe(false);
    const comum = naConversa(estadoCom([cartao([itemAprov({ motivoManual: "acao_arriscada", justificativa: "reescreve ou apaga no remoto" })])]));
    expect(comum).toContain("aprov-card");
    expect(comum).not.toContain("cartao-revisor");
  });

  it("em 'Sua vez': o mesmo cartão, com quem pede, há quanto e 'abrir conversa'", () => {
    const html = renderSuaVez(estadoCom([cartao([itemAprov()])]));
    expect(html).toContain("cartao-revisor");
    expect(html).toContain('<div class="cr-cab"><b>Ze</b><span>· há 2 min</span>');
    expect(html).toContain('data-act="abrir-conversa"');
    expect(html).toContain('data-act="decidir-aprovacao"');
  });

  it("vencido volta à lista de sempre (com Reabrir), não ao cartão compacto", () => {
    const vencido = cartao([itemAprov()], { estadoColuna: "vencido", decisao: { ...cartao([]).decisao, estado: "vencida" } });
    const html = renderSuaVez(estadoCom([vencido]));
    expect(html).not.toContain("cartao-revisor");
    expect(html).toContain('data-act="reabrir"');
  });
});

describe("PR 4b: a pergunta do cartão diz a ação (tela A3)", () => {
  const email = (extra: Partial<ItemAprov> = {}) => itemAprov({
    textoOriginal: "Usar enviar_email no Planilhas e e-mail", textoFinal: "Usar enviar_email no Planilhas e e-mail", justificativa: "O pedido veio de um e-mail, não de você.",
    destino: { conector: "exemplo", ferramenta: "enviar_email", argumentos: { para: "financeiro@acme-pagamentos.co", assunto: "Lista de clientes" } },
    fraseDaAcao: { texto: "Enviar e-mail “Lista de clientes” para financeiro@acme-pagamentos.co" }, ...extra,
  });

  it("com a frase do servidor, a pergunta é a ação com '?'; o motivo do revisor embaixo e 'ver detalhes' com tudo continuam", () => {
    const html = naConversa(estadoCom([cartao([email()], { decisao: { ...cartao([]).decisao, frase: "Clarice quer usar Planilhas e e-mail" } })]));
    expect(html).toContain('<p class="cr-pergunta" id="cr-t-d1">Enviar e-mail “Lista de clientes” para financeiro@acme-pagamentos.co?</p>');
    expect(html).not.toContain("Clarice quer usar");
    expect(html).toContain('<p class="cr-motivo"><b>Revisor:</b> O pedido veio de um e-mail, não de você.</p>');
    expect(html).toContain("<summary>ver detalhes</summary>");
    expect(html).toContain("Usar enviar_email no Planilhas e e-mail");
  });

  it("em 'Sua vez' a mesma pergunta", () => {
    expect(renderSuaVez(estadoCom([cartao([email()])]))).toContain(">Enviar e-mail “Lista de clientes” para financeiro@acme-pagamentos.co?</p>");
  });

  it("o comando sem frase: 'Rodar ⟨…⟩?' com o trecho em <code>; o push forçado vira a frase", () => {
    const deploy = itemAprov({ textoFinal: "npm run deploy", fraseDaAcao: { texto: "Rodar npm run deploy", codigo: [6, 20] } });
    expect(naConversa(estadoCom([cartao([deploy])]))).toContain('<p class="cr-pergunta" id="cr-t-d1">Rodar <code>npm run deploy</code>?</p>');
    const push = itemAprov({ fraseDaAcao: { texto: "Push forçado na feat/login", artigo: "o" } });
    expect(naConversa(estadoCom([cartao([push])]))).toContain(">Push forçado na feat/login?</p>");
  });

  it("o lote (dois itens ou mais) e o item sem frase ficam com a frase da decisão", () => {
    expect(perguntaDoCartao("Clarice quer usar o Gmail", [email(), email({ id: "i2" })])).toEqual({ pergunta: "Clarice quer usar o Gmail" });
    expect(perguntaDoCartao("Clarice quer usar o Gmail", [itemAprov()])).toEqual({ pergunta: "Clarice quer usar o Gmail" });
    expect(perguntaDoCartao("x", [email({ fraseDaAcao: { texto: "" } })])).toEqual({ pergunta: "x" });
  });

  it("a frase vem de argumentos (dado de fora): tudo escapado, também dentro do código; trecho fora dos limites não vira código", () => {
    const html = naConversa(estadoCom([cartao([email({ fraseDaAcao: { texto: "Enviar e-mail “<img src=x onerror=alert(1)>” para a@x.co" } })])]));
    expect(html).toContain("“&lt;img src=x onerror=alert(1)&gt;”");
    expect(html).not.toContain("<img src=x");
    expect(textoComCodigo("Rodar <b>x</b>", [6, 14])).toBe("Rodar <code>&lt;b&gt;x&lt;/b&gt;</code>");
    for (const c of [[0, 99], [5, 2], [-1, 3], [1.5, 3]] as const) expect(textoComCodigo("Rodar ls", c)).toBe("Rodar ls");
  });
});

describe("decidido, o cartão encolhe (cartao-encolhido.ts)", () => {
  const recibo = (desfecho: "executado" | "retirado_pela_pessoa", revisor: boolean): Mensagem => ({
    tenantId: "t", id: "r1", conversaId: C, turnoId: "t1", kind: "resultado_aprovacao", texto: "x", confianca: "confiavel", parcial: false, criadoEm: T0,
    autoria: { autor_tipo: "pessoa", autor_id: "p" } as never,
    payload: { kind: "resultado_aprovacao", decisaoId: "d1", frase: "Ze quer rodar um comando no seu Mac", itens: [{ idx: 0, desfecho, texto: "git push --force" }], ...(revisor ? { revisor: true as const } : {}) },
  } as Mensagem);
  it("'Aprovado por você' e, no cartão do revisor, 'Negado por você' (o mesmo verbo do botão)", () => {
    const e = estadoCom([]);
    expect(dadosDoEncolhido(recibo("executado", true), e)?.resultado).toMatch(/^Aprovado por você · feito /);
    expect(dadosDoEncolhido(recibo("retirado_pela_pessoa", true), e)).toMatchObject({ resultado: "Negado por você", anuncio: "Negado: Ze quer rodar um comando no seu Mac" });
    // Recibo antigo, ou de outro cartão: "Recusado", como sempre.
    expect(dadosDoEncolhido(recibo("retirado_pela_pessoa", false), e)?.resultado).toBe("Recusado por você");
  });
});

describe("a linha do revisor embaixo da fala (telas A1 e A2)", () => {
  const autoriaBot = { autor_tipo: "agente" as const, autor_id: "ze", sob_procuracao_de: null, conta_de_execucao: "p", executor: "catcher" as const, locality: "local" as const, locality_reason: "tudo_local_nesta_rodada" as const, machine_id: null, decidido_por: "regra:teste" as const, regra_versao: 1 };
  const fala = (id: string, turnoId: string, criadoEm: number): Mensagem => ({ tenantId: "t", id, conversaId: C, turnoId, autoria: autoriaBot, kind: "texto", texto: `fala ${id}`, payload: null, confianca: "confiavel", parcial: false, criadoEm, origemTurno: "conversa", trabalhoId: null, fimDoTurno: true, destino: "chat" } as Mensagem);
  const lib = (id: string, frase: string, em = T0 + MIN): AcaoDoModoNaFala => ({ id, turnoId: "t1", em, gatilho: "revisor", frase });
  const doBloco = (e: Estado, chave: string) => blocosDoHistorico(e.conversas[C]!, e).find((b) => b.chave === chave)?.html ?? "";

  it("uma ação: o escudo, a frase do servidor e 'ver', que abre a Atividade no dia, no filtro Sem aprovação, e conta na telemetria", () => {
    const e = estadoCom([], [fala("b1", "t1", T0 + 2 * MIN)], { t1: [lib("a1", "Revisor liberou git push --force origin feat/login: você pediu")] });
    const html = doBloco(e, "b1");
    expect(html).toContain('class="linha-modo linha-revisor"');
    expect(html).toContain("Revisor liberou git push --force origin feat/login: você pediu");
    expect(html).toContain('data-act="ver-sem-aprovacao" data-agente="ze" data-dia="2026-10-18" data-linha-tipo="revisor" data-linha-chave="revisor:t1"');
    expect(html).toContain(">ver</button>");
    expect(html).not.toContain("ver na Atividade</button>");
  });

  it("PR 4b: a frase da ação na linha ('Revisor liberou o push forçado na feat/login: você pediu'); o comando sem frase em <code>", () => {
    const e = estadoCom([], [fala("b1", "t1", T0 + 2 * MIN)], { t1: [lib("a1", "Revisor liberou o push forçado na feat/login: você pediu")] });
    expect(doBloco(e, "b1")).toContain('<span class="linha-modo-txt">Revisor liberou o push forçado na feat/login: você pediu</span>');
    const comCodigo: AcaoDoModoNaFala = { ...lib("a2", "Revisor liberou npm run deploy: você pediu"), codigo: [16, 30] };
    expect(renderLinhaDoModo([comCodigo], "ze")).toContain('<span class="linha-modo-txt">Revisor liberou <code>npm run deploy</code>: você pediu</span>');
    // Várias ações diferentes: "Revisor liberou 2 ações", sem código.
    expect(renderLinhaDoModo([comCodigo, lib("a3", "Revisor liberou o push forçado na x")], "ze")).toContain('<span class="linha-modo-txt">Revisor liberou 2 ações</span>');
  });

  it("várias ações diferentes viram 'Revisor liberou N ações'; a mesma repetida conta uma", () => {
    expect(textoDaLinhaDoRevisor([lib("a", "Revisor liberou rm -rf build: você pediu"), lib("b", "Revisor liberou rm -rf build: você pediu")])).toBe("Revisor liberou rm -rf build: você pediu");
    expect(textoDaLinhaDoRevisor([lib("a", "x"), lib("b", "y"), lib("c", "z")])).toBe("Revisor liberou 3 ações");
  });

  it("a do total e a do revisor no mesmo turno (o modo mudou no meio): duas linhas, cada uma com o seu 'ver'", () => {
    const html = renderLinhaDoModo([lib("a", "Revisor liberou x: você pediu"), { id: "b", turnoId: "t1", em: T0, gatilho: "credencial", frase: "Usou o token do GitHub do seu Mac" }], "ze");
    expect(html.match(/class="linha-modo[ "]/g)).toHaveLength(2);
    expect(html).toContain("ver na Atividade</button>");
    expect(html).toContain('data-linha-tipo="revisor"');
    expect(renderLinhaDoModo([lib("a", "Revisor liberou <b>x</b>")], "ze")).not.toContain("<b>x</b>");
  });
});

describe("'Devia ter perguntado' na Atividade", () => {
  const dia = "2026-10-18";
  const liberada = (contestada: boolean, motivo: string | null = "você pediu"): ItemDeAtividade => ({ id: "modo:a1", em: T0, categoria: "sem_aprovacao", titulo: "Revisor liberou", detalhe: "git push --force origin feat/login", codigo: true, revisor: { acaoId: "a1", motivo, contestada } });
  const com = (itens: ItemDeAtividade[]): string => {
    const base = estadoCom([]);
    const e: Estado = { ...base, atividadeVista: { agenteId: "ze", dia, filtro: "sem_aprovacao", aberta: null, aba: "atividade", desfecho: "tudo", decisao: null, exportar: null }, atividadeDoBot: { [`ze:${dia}`]: { dia, itens, total: itens.length, truncados: 0, diaAnterior: null } } };
    return renderAtividade(e, base.frota!.agentes[0]!);
  };

  it("a liberação mostra o motivo e o botão; contestada, a marca no lugar do botão; a do total, nada disso", () => {
    const aberta = com([liberada(false)]);
    expect(aberta).toContain("<b>Revisor:</b> você pediu");
    expect(aberta).toContain('data-act="contestar-revisor" data-id="a1">Devia ter perguntado</button>');
    const marcada = com([liberada(true)]);
    expect(marcada).toContain("Você marcou: devia ter perguntado");
    expect(marcada).not.toContain("contestar-revisor");
    expect(com([liberada(false, null)])).not.toContain("<b>Revisor:</b>");
    const total = com([{ id: "modo:t", em: T0, categoria: "sem_aprovacao", titulo: "Comando arriscado", detalhe: "rm -rf x", codigo: true }]);
    expect(total).not.toContain("Devia ter perguntado");
  });

  it("o motivo vai escapado", () => {
    expect(com([liberada(false, "<script>x</script>")])).not.toContain("<script>x");
  });
});
