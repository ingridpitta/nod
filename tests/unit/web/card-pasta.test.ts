import { describe, expect, it } from "vitest";
import type { PayloadPropostaPasta, Proposta } from "../../../src/contracts/conversa.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { estadoInicial, reduzir, type ConversaEstado, type Estado } from "../../../web/estado/reducer.ts";
import { mudouQuando } from "../../../web/lib/relogio.ts";
import { ondeLegivel } from "../../../web/telas/card-pasta.ts";
import { renderMensagem, renderTimeline } from "../../../web/telas/conversa.ts";

/**
 * Card de pasta simplificado (definido em 2026-09-25, mockup "Pasta do projeto" no canvas do nod). Antes:
 * oito caminhos absolutos, cada um com o seu "Permitir", e "Escolher outraAgora não" colados. Agora: a
 * sugerida com um botão só, a lista atrás de "Não é essa" e um registro que fica depois de permitir.
 */
// O card usa o fuso do navegador: 15:30Z menos 10 min cai no mesmo dia civil em qualquer fuso (UTC-12 a +14).
const AGORA = Date.parse("2026-09-25T15:30:00Z");
const DIA = 86_400_000;
const HOME = "/Users/marlon";

const candidatas: PayloadPropostaPasta["candidatas"] = [
  { caminho: `${HOME}/code/acme/main-repos/acme`, nome: "acme", git: true, onde: "code/acme/main-repos", modificadoEm: AGORA - 10 * 60_000 },
  { caminho: `${HOME}/Inhouse/acme`, nome: "acme", git: true, onde: "Inhouse", modificadoEm: AGORA - 2 * DIA },
  { caminho: `${HOME}/conductor/workspaces/acme`, nome: "acme", git: true, onde: "conductor/workspaces", modificadoEm: AGORA - 21 * DIA },
  { caminho: `${HOME}/code/acme`, nome: "acme", git: false, onde: "code", modificadoEm: AGORA - 40 * DIA },
  { caminho: `${HOME}/conductor/archived-contexts/acme`, nome: "acme", git: true, onde: "conductor/archived-contexts", modificadoEm: AGORA - 130 * DIA },
];

function proposta(c: PayloadPropostaPasta["candidatas"], id = "pp"): Proposta {
  return { tenantId: "t", id, conversaId: "c", agenteId: "a", kind: "pasta", estado: "pendente", criadoEm: AGORA, payload: { kind: "pasta", turnoId: "t1", candidatas: c, motivo: "Para montar a árvore de arquivos do PR #466", buscaTermo: "acme" } } as Proposta;
}
function conversa(p: Proposta[], mensagens: Mensagem[] = []): ConversaEstado {
  return { conversa: { tenantId: "t", id: "c", ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a", salaId: null, sessaoCli: null, criadoEm: 0 }, mensagens, propostas: p, turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], fios: [], carregadaEm: 0 };
}
const estado: Estado = { ...estadoInicial, agora: AGORA, sessao: { tenantId: "t", pessoaId: "p" }, frota: { agentes: [{ id: "a", nome: "Dev 1", ownerId: "p", conversaId: "c" }] } as never };
const quantas = (html: string, trecho: string) => html.split(trecho).length - 1;

describe("card de pasta", () => {
  it("sugere uma pasta só, pelo nome e pelo local, com um botão de permitir", () => {
    const html = renderTimeline(conversa([proposta(candidatas)]), estado);
    expect(html).toContain("Abrir o projeto acme?");
    expect(html).toContain("Para montar a árvore de arquivos do PR #466");
    expect(html).toContain("code › acme › main-repos");
    expect(html).toContain("mudou hoje");
    expect(quantas(html, 'data-act="permitir-pasta"')).toBe(1);
    expect(html).toContain(`data-pasta="${HOME}/code/acme/main-repos/acme"`);
    expect(html).toContain('data-act="lista-de-pasta"');
    expect(html).toContain("Dev 1 só mexe nas pastas que você abrir.");
    // Nenhuma das outras aparece antes de a pessoa dizer que não é essa.
    expect(html).not.toContain("Inhouse");
    expect(html).not.toContain("Permitir<");
  });

  it("\"Não é essa\" abre as mais prováveis, com a sugerida marcada, e o resto sob demanda", () => {
    const curta = reduzir(estado, { tipo: "lista-de-pasta", propostaId: "pp", lista: "curta" });
    const html = renderTimeline(conversa([proposta(candidatas)]), curta);
    expect(html).toContain("Qual é o acme certo?");
    expect(html).toContain("Achei 5 pastas com esse nome.");
    expect(quantas(html, 'type="radio"')).toBe(3);
    expect(quantas(html, " checked")).toBe(1);
    // A recusada continua na lista, mas a marcada é a próxima: "Não é essa" não volta para ela.
    expect(html).toContain(`value="${HOME}/Inhouse/acme" data-pasta-de="pp" checked`);
    expect(html).toContain("Marquei a próxima mais provável.");
    expect(html).toContain('aria-expanded="false">Mostrar mais 2');
    expect(html).toContain('aria-labelledby="pa-titulo-pp"');
    expect(html).toContain("Procurar em outro lugar…");
    // Com a lista aberta, o botão lê a opção marcada: não carrega pasta fixa.
    expect(html).not.toContain("data-pasta=");
    const todas = renderTimeline(conversa([proposta(candidatas)]), reduzir(curta, { tipo: "lista-de-pasta", propostaId: "pp", lista: "todas" }));
    expect(quantas(todas, 'type="radio"')).toBe(5);
    // Aberta, a lista fica aberta: "Mostrar menos" escondia a marcada e armava outra pasta.
    expect(todas).not.toContain('data-act="lista-de-pasta"');
    expect(todas).toContain("code · sem Git");
    expect(todas).toContain("há 4 meses");
  });

  it("com uma candidata só, \"Não é essa\" já abre a escolha no computador", () => {
    const html = renderTimeline(conversa([proposta(candidatas.slice(0, 1))]), estado);
    expect(html).toContain("Abrir o projeto acme?");
    expect(html).not.toContain('data-act="lista-de-pasta"');
    expect(html).toContain('data-act="abrir-workspace"');
  });

  it("sem candidata, diz que não achou e oferece escolher a pasta", () => {
    const html = renderTimeline(conversa([proposta([])]), estado);
    expect(html).toContain("Não achei o acme no seu computador");
    expect(html).toContain("Escolher pasta…");
    expect(html).not.toContain('data-act="permitir-pasta"');
  });

  it("proposta gravada antes, sem local nem data, mostra o local tirado do caminho", () => {
    const antiga = [{ caminho: `${HOME}/code/nod`, nome: "nod", git: true }];
    const html = renderTimeline(conversa([proposta(antiga)]), estado);
    expect(html).toContain("<small>code</small>");
    expect(html).not.toContain("mudou");
  });

  it("lista curta com duas pastas de nomes diferentes, sem Git e sem data", () => {
    const duas: PayloadPropostaPasta["candidatas"] = [
      { caminho: `${HOME}/code/acme`, nome: "acme", git: false, onde: "code", modificadoEm: null },
      { caminho: `${HOME}/code/acme-web`, nome: "acme-web", git: false, onde: "code", modificadoEm: null },
    ];
    const html = renderTimeline(conversa([proposta(duas)]), reduzir(estado, { tipo: "lista-de-pasta", propostaId: "pp", lista: "curta" }));
    expect(quantas(html, 'type="radio"')).toBe(2);
    expect(html).not.toContain("Mostrar mais");
    expect(html).toContain("Qual destas pastas?");
    expect(html).toContain("Achei 2 pastas parecidas.");
    expect(html).not.toContain("sem Git");
    expect(html).not.toContain("pa-quando");
  });

  it("escapa o que vem da busca, do modelo e do sistema de arquivos", () => {
    const p = proposta([{ ...candidatas[0]!, nome: "<img src=x>" }]);
    const html = renderTimeline(conversa([{ ...p, payload: { ...(p.payload as PayloadPropostaPasta), motivo: "<script>x</script>" } }]), estado);
    expect(html).not.toContain("<img src=x>");
    expect(html).not.toContain("<script>");
    const vazia = proposta([]);
    const nada = renderTimeline(conversa([{ ...vazia, payload: { ...(vazia.payload as PayloadPropostaPasta), buscaTermo: "<img src=x onerror=alert(1)>" } }]), estado);
    expect(nada).not.toContain("<img src=x");
    const hostil = proposta([{ ...candidatas[0]!, caminho: '/Users/m/a"><svg onload=1>' }, candidatas[1]!]);
    const lista = renderTimeline(conversa([hostil]), reduzir(estado, { tipo: "lista-de-pasta", propostaId: "pp", lista: "curta" }));
    expect(lista).not.toContain("<svg onload");
  });
});

describe("registro da pasta aberta", () => {
  const autoria = { autor_tipo: "pessoa", autor_id: "p", sob_procuracao_de: null, conta_de_execucao: "p", executor: "catcher", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "pessoa", regra_versao: 1 } as const;
  const registro: Mensagem = { tenantId: "t", id: "m1", conversaId: "c", turnoId: null, autoria, kind: "sistema", texto: "Pasta do projeto aberta para o agente.", payload: { kind: "pasta_aberta", propostaId: "pp", agenteId: "a", pasta: `${HOME}/code/acme/main-repos/acme`, nome: "acme", onde: "code/acme/main-repos" }, confianca: "confiavel", parcial: false, criadoEm: AGORA };

  it("vira o cartão encolhido (chat limpo, PR 4): o pedido, 'acme aberta para Dev 1' com ✓, o local e o Trocar para quem é dona", () => {
    const html = renderMensagem(registro, estado);
    expect(html).toContain('class="cp-linha cp-ok cartao-encolhido cp-com-extra"');
    expect(html).toContain('data-cartao-encolhido="pp"');
    expect(html).toContain('tabindex="-1">Abrir o projeto acme</span>');
    expect(html).toContain('<span class="ce-resultado">acme aberta para Dev 1</span>');
    expect(html).toContain("code › acme › main-repos");
    expect(html).toContain('data-act="abrir-workspace"');
    expect(html).not.toContain("msg-sistema");
  });

  it("não some dentro de \"N avisos do sistema\" quando cai entre avisos", () => {
    const aviso = (id: string): Mensagem => ({ ...registro, id, texto: `aviso ${id}`, payload: null });
    const html = renderTimeline(conversa([], [aviso("a1"), aviso("a2"), registro, aviso("a3")]), estado);
    expect(html).not.toContain("avisos do sistema");
    expect(html).toContain("acme aberta para Dev 1");
  });

  it("o aviso de troca de IA ainda sem decisão também não some dentro de \"N avisos do sistema\" (ADR-108, QA de 16/10)", () => {
    const aviso = (id: string): Mensagem => ({ ...registro, id, texto: `aviso ${id}`, payload: null });
    const troca: Mensagem = { ...registro, id: "t1", texto: "O Claude chegou ao limite", payload: { kind: "troca_de_ia", trocaId: "x", agenteId: "a", iaDe: "claude-cli", iaPara: "codex-cli", recomendacao: "esperar", voltaEm: AGORA + 11 * 60_000, tasks: 19, aplicarEm: null } };
    const aberto = renderTimeline(conversa([], [aviso("a1"), aviso("a2"), troca, aviso("a3")]), estado);
    expect(aberto).not.toContain("avisos do sistema");
    expect(aberto).toContain('data-act="troca-esperar"');
    // Decidido, vira linha de desfecho e pode ser recolhido com os outros.
    const decidido = renderTimeline(conversa([], [aviso("a1"), aviso("a2"), { ...troca, payload: { ...(troca.payload as object), decisao: "esperar", decididoEm: AGORA } } as Mensagem, aviso("a3")]), estado);
    expect(decidido).toContain("avisos do sistema");
  });

  it("quem não é dona do bot não vê o Trocar", () => {
    expect(renderMensagem(registro, { ...estado, sessao: { tenantId: "t", pessoaId: "outra" } })).not.toContain('data-act="abrir-workspace"');
  });

  it("escapa nome, local e caminho do registro", () => {
    const html = renderMensagem({ ...registro, payload: { kind: "pasta_aberta", propostaId: "pp", agenteId: "a", pasta: '/Users/m/"><svg onload=1>', nome: "<b>x</b>", onde: "<i>y" } }, estado);
    expect(html).not.toContain("<svg onload");
    expect(html).not.toContain("<b>x</b>");
    expect(html).not.toContain("<i>y");
  });
});

describe("textos de apoio", () => {
  it("o local legível tira a pasta pessoal e o próprio nome", () => {
    expect(ondeLegivel({ caminho: `${HOME}/code/acme/main-repos/acme` })).toBe("code › acme › main-repos");
    expect(ondeLegivel({ caminho: `${HOME}/acme` })).toBe("pasta pessoal");
    expect(ondeLegivel({ caminho: "/x", onde: "" })).toBe("pasta pessoal");
  });

  it("o último uso sai em dias de calendário", () => {
    const fuso = "America/Sao_Paulo";
    const agora = Date.parse("2026-09-25T15:00:00Z");
    expect(mudouQuando(Date.parse("2026-09-25T04:00:00Z"), agora, fuso)).toBe("mudou hoje");
    expect(mudouQuando(Date.parse("2026-09-25T02:00:00Z"), agora, fuso)).toBe("mudou ontem");
    expect(mudouQuando(agora - 5 * DIA, agora, fuso)).toBe("há 5 dias");
    expect(mudouQuando(agora - 21 * DIA, agora, fuso)).toBe("há 3 semanas");
    expect(mudouQuando(agora - 130 * DIA, agora, fuso)).toBe("há 4 meses");
    expect(mudouQuando(agora - 400 * DIA, agora, fuso)).toBe("há mais de um ano");
  });

  it("o último uso nas bordas das faixas e com o relógio do Mac adiantado", () => {
    const agora = Date.parse("2026-09-25T15:00:00Z");
    expect(mudouQuando(agora - 13 * DIA, agora)).toBe("há 13 dias");
    expect(mudouQuando(agora - 14 * DIA, agora)).toBe("há 2 semanas");
    expect(mudouQuando(agora - 59 * DIA, agora)).toBe("há 8 semanas");
    expect(mudouQuando(agora - 60 * DIA, agora)).toBe("há 2 meses");
    expect(mudouQuando(agora - 364 * DIA, agora)).toBe("há 12 meses");
    expect(mudouQuando(agora - 365 * DIA, agora)).toBe("há mais de um ano");
    expect(mudouQuando(agora + 3 * DIA, agora)).toBe("mudou hoje");
  });
});
