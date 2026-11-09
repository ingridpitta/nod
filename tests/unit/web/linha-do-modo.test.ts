import { describe, expect, it } from "vitest";
import type { AcaoDoModoNaFala } from "../../../src/contracts/acoes-do-modo.ts";
import type { ConversaDto } from "../../../src/contracts/api.ts";
import type { ItemDeAtividade } from "../../../src/contracts/atividade.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { ehFiltroAtividade, FILTROS_DA_ATIVIDADE, itensDoFiltro } from "../../../web/lib/atividade-do-bot.ts";
import { estadoInicial, reduzir, type Estado } from "../../../web/estado/reducer.ts";
import { renderAtividade } from "../../../web/telas/atividade.ts";
import { blocosDoHistorico } from "../../../web/telas/conversa.ts";
import { ancorasDoModo, renderLinhaDoModo, textoDaLinhaDoModo } from "../../../web/telas/linha-do-modo.ts";

/**
 * PR 6 dos modos de aprovação (telas Y1, Y2 e Y3 do protótipo aprovado): a linha discreta embaixo da fala do que o "Ignorar
 * todas" rodou sem a pessoa, "ver na Atividade" e o filtro "Sem aprovação".
 */
const C = "c-ze";
const T0 = new Date(2026, 9, 18, 14, 20).getTime();
const MIN = 60_000;
const autoriaBot = { autor_tipo: "agente" as const, autor_id: "ze", sob_procuracao_de: null, conta_de_execucao: "p", executor: "catcher" as const, locality: "local" as const, locality_reason: "tudo_local_nesta_rodada" as const, machine_id: null, decidido_por: "regra:teste" as const, regra_versao: 1 };
const msg = (id: string, criadoEm: number, extra: Partial<Mensagem> = {}): Mensagem => ({
  tenantId: "t", id, conversaId: C, turnoId: null, autoria: autoriaBot, kind: "texto", texto: `fala ${id}`, payload: null, confianca: "confiavel", parcial: false, criadoEm,
  origemTurno: null, trabalhoId: null, fimDoTurno: false, destino: "chat", ...extra,
} as Mensagem);
const daPessoa = (id: string, criadoEm: number, texto: string): Mensagem => msg(id, criadoEm, { autoria: { autor_tipo: "pessoa", autor_id: "p" } as never, texto });
const acao = (id: string, turnoId: string, frase: string, gatilho: AcaoDoModoNaFala["gatilho"] = "credencial", em = T0 + MIN): AcaoDoModoNaFala => ({ id, turnoId, em, gatilho, frase });

function estadoCom(mensagens: Mensagem[], acoesDoModo?: ConversaDto["acoesDoModo"]): Estado {
  const dto: ConversaDto = {
    conversa: { tenantId: "t", id: C, ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "ze", salaId: null, sessaoCli: null, criadoEm: 1 } as never,
    mensagens, turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], propostas: [], fios: [], ...(acoesDoModo ? { acoesDoModo } : {}),
  };
  const base = reduzir(estadoInicial, { tipo: "hidratar-conversa", conversa: dto, agora: T0 + 10 * MIN });
  return {
    ...base, agora: T0 + 10 * MIN, sessao: { pessoaId: "p", tenantId: "t" } as never,
    frota: { agentes: [{ id: "ze", nome: "Ze", conversaId: C, cor: "c-bleu", forma: "shape-square", ownerId: "p" }] } as never,
    suaVez: { itens: [], incidentes: [], foraDoAr: [], vazio: true, ultimaDecisaoEm: null },
  };
}

/** Y1: a pessoa pede, o bot fala no meio e no fim do turno; o total usou o token do GitHub. */
const Y1 = [
  daPessoa("p1", T0, "Publica a imagem 2.3 no registry do GitHub."),
  msg("b0", T0 + MIN, { turnoId: "t1", origemTurno: "conversa", texto: "Vou logar no registry." }),
  msg("b1", T0 + 2 * MIN, { turnoId: "t1", origemTurno: "conversa", fimDoTurno: true, texto: "Publicada: ghcr.io/gamefik/nod:2.3." }),
];
const doBloco = (e: Estado, chave: string) => blocosDoHistorico(e.conversas[C]!, e).find((b) => b.chave === chave)?.html ?? "";

describe("a linha embaixo da fala (Y1, Y2)", () => {
  it("entra na última fala do bot do turno, embaixo do balão, com 'ver na Atividade' no dia da ação", () => {
    const e = estadoCom(Y1, { t1: [acao("a1", "t1", "Usou o token do GitHub do seu Mac")] });
    const fim = doBloco(e, "b1");
    expect(fim).toContain('class="linha-modo"');
    expect(fim).toContain("Usou o token do GitHub do seu Mac");
    expect(fim).toContain('data-act="ver-sem-aprovacao" data-agente="ze" data-dia="2026-10-18"');
    expect(fim.indexOf("Publicada:")).toBeLessThan(fim.indexOf("linha-modo"));
    expect(doBloco(e, "b0")).not.toContain("linha-modo");
    expect(doBloco(e, "p1")).not.toContain("linha-modo");
  });

  it("payload antigo (sem acoesDoModo) ou turno sem fala à vista: nenhuma linha", () => {
    expect(blocosDoHistorico(estadoCom(Y1).conversas[C]!, estadoCom(Y1)).map((b) => b.html).join("")).not.toContain("linha-modo");
    const e = estadoCom(Y1, { outro: [acao("a1", "outro", "Leu as credenciais da AWS do seu Mac")] });
    expect(blocosDoHistorico(e.conversas[C]!, e).map((b) => b.html).join("")).not.toContain("linha-modo");
  });

  it("várias ações: a mesma frase conta uma; frases diferentes viram 'e mais N ações sem perguntar', a credencial primeiro", () => {
    expect(textoDaLinhaDoModo([acao("a", "t", "Usou o token do GitHub do seu Mac"), acao("b", "t", "Usou o token do GitHub do seu Mac")])).toBe("Usou o token do GitHub do seu Mac");
    expect(textoDaLinhaDoModo([acao("a", "t", "Rodou um comando que reescreve ou apaga no remoto", "arriscado", T0), acao("b", "t", "Usou o token do GitHub do seu Mac", "credencial", T0 + MIN)])).toBe("Usou o token do GitHub do seu Mac e mais 1 ação sem perguntar");
    expect(textoDaLinhaDoModo([acao("a", "t", "Leu as credenciais da AWS do seu Mac"), acao("b", "t", "Usou uma chave SSH do seu Mac"), acao("c", "t", "Rodou um comando que apaga pastas inteiras", "arriscado")])).toBe("Leu as credenciais da AWS do seu Mac e mais 2 ações sem perguntar");
  });

  it("o ícone: a chave na credencial (Y1, Y2), o triângulo só no arriscado; o texto vai escapado e o botão diz o que abre", () => {
    expect(renderLinhaDoModo([acao("a", "t", "Usou o token do GitHub do seu Mac")], "ze")).toContain('<circle cx="8" cy="15" r="4"/>');
    const arriscado = renderLinhaDoModo([acao("a", "t", "Rodou um comando que apaga pastas inteiras", "arriscado")], "ze");
    expect(arriscado).toContain('d="M12 9v4"');
    expect(arriscado).not.toContain("<circle");
    const html = renderLinhaDoModo([acao("a", "t", "Usou <b>x</b>")], "ze");
    expect(html).not.toContain("<b>x</b>");
    expect(html).toContain('aria-label="Ver na Atividade: Usou &lt;b&gt;x&lt;/b&gt;"');
    expect(renderLinhaDoModo([], "ze")).toBe("");
  });

  it("ancorasDoModo junta as ações de vários turnos na âncora de cada um", () => {
    const mensagens = [...Y1, msg("b2", T0 + 5 * MIN, { turnoId: "t2", fimDoTurno: true })];
    const a = ancorasDoModo(mensagens, { t1: [acao("a", "t1", "x")], t2: [acao("b", "t2", "y")] }, () => true);
    expect([...a.keys()]).toEqual(["b1", "b2"]);
  });
});

describe("o filtro 'Sem aprovação' da Atividade (Y3)", () => {
  const itens: ItemDeAtividade[] = [
    { id: "modo:1", em: T0 + 43 * MIN, categoria: "sem_aprovacao", titulo: "Leu as credenciais da AWS", detalhe: "cat ~/.aws/config", codigo: true },
    { id: "modo:2", em: T0 + 42 * MIN, categoria: "sem_aprovacao", titulo: "Comando arriscado", detalhe: "git push --force origin staging", codigo: true },
    { id: "trabalho:x:comecou", em: T0, categoria: "frentes", titulo: "Abriu a task Hero", detalhe: "pedido seu", alvo: { trabalhoId: "x" } },
  ];

  it("vem logo depois de 'Tudo', e só ele mostra o que rodou sem aprovação", () => {
    expect(FILTROS_DA_ATIVIDADE.map((f) => f.rotulo)).toEqual(["Tudo", "Sem aprovação", "Frentes", "Bloqueios", "Máquina e IA"]);
    expect(itensDoFiltro(itens, "sem_aprovacao").map((i) => i.id)).toEqual(["modo:1", "modo:2"]);
    expect(ehFiltroAtividade("sem_aprovacao")).toBe(true);
    expect(ehFiltroAtividade("qualquer")).toBe(false);
    expect(ehFiltroAtividade(undefined)).toBe(false);
  });

  it("a tela: o detalhe do comando em fonte de código; vazio com a frase do filtro", () => {
    const base = estadoCom(Y1);
    const dia = "2026-10-18";
    const bot = base.frota!.agentes[0]!;
    const comItens: Estado = { ...base, atividadeVista: { agenteId: "ze", dia, filtro: "sem_aprovacao", aberta: null, aba: "atividade", desfecho: "tudo", decisao: null, exportar: null }, atividadeDoBot: { [`ze:${dia}`]: { dia, itens, total: 3, truncados: 0, diaAnterior: null } } };
    const html = renderAtividade(comItens, bot);
    expect(html).toContain('data-filtro="sem_aprovacao" aria-pressed="true">Sem aprovação</button>');
    // QA do PR 6: uma linha só, cortada com "…" no CSS (Y3); o texto inteiro fica no title.
    expect(html).toContain('<span class="atv-detalhe atv-codigo" title="cat ~/.aws/config">cat ~/.aws/config</span>');
    expect(html).not.toContain("Abriu a task Hero");
    const vazio: Estado = { ...comItens, atividadeDoBot: { [`ze:${dia}`]: { dia, itens: [itens[2]!], total: 1, truncados: 0, diaAnterior: null } } };
    expect(renderAtividade(vazio, bot)).toContain("Nada rodou sem aprovação neste dia.");
  });

  it("'ver na Atividade': o filtro e o dia mudam na vista aberta (o reducer)", () => {
    const aberta = reduzir(estadoCom(Y1), { tipo: "gaveta", agenteId: "ze", nivel: { tipo: "atividade" } });
    const vista = reduzir(aberta, { tipo: "atividade-vista", mudanca: { filtro: "sem_aprovacao", dia: "2026-10-17" } });
    expect(vista.atividadeVista).toMatchObject({ agenteId: "ze", filtro: "sem_aprovacao", dia: "2026-10-17" });
  });
});
