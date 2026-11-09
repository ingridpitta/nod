import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { FrotaDto } from "../../../src/contracts/api.ts";
import { estadoInicial, reduzir, type Estado } from "../../../web/estado/reducer.ts";
import { estadoDoComputador } from "../../../web/lib/computador.ts";
import { abaAberta, abaBiblioteca, abasDoBot, identidadeEditavel, nivelDaGaveta, nomeEditavel, paiDoNivel, renderDetalhes } from "../../../web/telas/detalhes.ts";

/**
 * ADR-125 (NOD-349): a gaveta do bot minimalista. Topo só com Compartilhar e Fechar; nome, subtítulo e avatar editáveis
 * ali; abas Detalhes | Biblioteca | Computador; o resto no nível Ajustes. Os critérios da issue, um bloco cada.
 */
type AgenteFrota = FrotaDto["agentes"][number];
const nina = (extra: Partial<AgenteFrota> = {}): AgenteFrota => ({ tenantId: "t", id: "a1", ownerId: "p", visibility: "privado", nome: "Nina", titulo: "Assistente de e-mail", descricao: "Cuida da caixa", dono: "pessoa", forma: "shape-square", cor: "c-purple", fixado: false, oculto: false, confirmado: true, modelo: "m", duplicadoDe: null, criadoEm: 0, conversaId: "c1", descricaoEstado: "", computadorForaDoAr: null, ultimaMensagem: null, ...extra });
const com = (a: AgenteFrota, extra: Partial<Estado> = {}): Estado => ({ ...estadoInicial, sessao: { tenantId: "t", pessoaId: "p" }, frota: { agentes: [a], inventario: { estado: "pronto", versao: "1", em: 0 }, negacoes: [] }, tela: { tipo: "conversa", conversaId: "c1", agenteId: "a1" }, ...extra } as Estado);
const topo = (html: string) => html.slice(0, html.indexOf("</div>"));
const ajustes = (e: Estado): Estado => ({ ...e, gaveta: { agenteId: "a1", nivel: { tipo: "ajustes" } } });

describe("1–3: o topo só com Compartilhar e Fechar; o ⋯ saiu da gaveta", () => {
  it("o topo tem exatamente dois botões: Compartilhar (abre menu) e Fechar painel", () => {
    const t = topo(renderDetalhes(com(nina())));
    expect(t.match(/<button/g)).toHaveLength(2);
    expect(t).toContain('data-act="gaveta-compartilhar" data-id="a1" aria-haspopup="menu" aria-label="Compartilhar Nina"');
    expect(t).toContain('data-act="alternar-detalhes" aria-label="Fechar painel"');
    expect(renderDetalhes(com(nina()))).not.toContain('data-act="menu-agente"');
  });

  it("o menu de Compartilhar tem Copiar ID da conversa e Duplicar bot", () => {
    const fonte = readFileSync(new URL("../../../web/telas/gestao-agentes.ts", import.meta.url), "utf8");
    const corpo = fonte.slice(fonte.indexOf("export function abrirMenuCompartilhar"));
    expect(corpo).toContain("Copiar ID da conversa");
    expect(corpo).toContain("Duplicar bot");
    expect(corpo).toContain('role="menu"');
  });

  it("o ⋯ mora na linha da lista (à vista só no toque) e Renomear não abre mais diálogo", () => {
    const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
    expect(main).toContain('class="bot-mais" data-act="menu-agente"');
    expect(main).not.toContain('pedirGestao("Renomear bot"');
    expect(main).toContain('if (acao === "renomear") { renomearNaGaveta(a); return; }');
    const css = readFileSync(new URL("../../../web/navegacao.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.bot-mais \{ display: none; \}\n@media \(hover: none\) and \(pointer: coarse\)/);
  });

  it("nos níveis, o ‹ diz para onde volta: Ajustes para o que abriu de lá; o nome do bot para Ajustes e a rotina", () => {
    expect(renderDetalhes({ ...com(nina()), gaveta: { agenteId: "a1", nivel: { tipo: "memoria" } } })).toContain('aria-label="Voltar para Ajustes"');
    expect(renderDetalhes(ajustes(com(nina())))).toContain('aria-label="Voltar para Nina"');
    expect(paiDoNivel({ tipo: "perfil" })).toEqual({ tipo: "ajustes" });
    expect(paiDoNivel({ tipo: "acesso", id: "gmail" })).toEqual({ tipo: "ajustes" });
    expect(paiDoNivel({ tipo: "ajustes" })).toBeNull();
    expect(paiDoNivel({ tipo: "rotina", id: "r1" })).toBeNull();
    expect(paiDoNivel({ tipo: "nova-rotina" })).toBeNull();
    expect(nivelDaGaveta("ajustes")).toEqual({ tipo: "ajustes" });
  });
});

describe("4: nome e subtítulo editáveis ali mesmo", () => {
  it("dois campos com rótulo, o valor salvo em data-salvo, placeholder 'Adicionar um rótulo' e a linha de erro role=status", () => {
    const html = renderDetalhes(com(nina({ titulo: "" })));
    expect(html).toContain('<label class="sr-only" for="gvn-nome">Nome do bot</label>');
    expect(html).toMatch(/<input id="gvn-nome" class="gvn-nome" data-campo="nome" data-id="a1" data-salvo="Nina" value="Nina" maxlength="60"/);
    expect(html).toMatch(/<input id="gvn-sub" class="gvn-sub" data-campo="titulo" data-id="a1" data-salvo="" value=""[^>]*placeholder="Adicionar um rótulo"/);
    expect(html).toContain('<span class="gvn-erro" id="gvn-erro" role="status"></span>');
  });

  it("nome com aspas e < não quebra o HTML", () => {
    const html = renderDetalhes(com(nina({ nome: 'Bo"t <x>' })));
    expect(html).toContain('value="Bo&quot;t &lt;x&gt;"');
    expect(html).not.toContain("<x>");
  });
});

describe("5: o popover do avatar", () => {
  const aberto = (e: Estado) => reduzir(e, { tipo: "avatar-popover", aberto: { agenteId: "a1", forma: "shape-square", cor: "c-purple" } });
  it("fechado, só o botão; aberto, 8 formas e 12 cores como rádios, com a atual marcada, e Redefinir", () => {
    const fechado = renderDetalhes(com(nina()));
    // Revisão 2: fechado, sem aria-controls (apontaria para um popover que não está no DOM).
    expect(fechado).toContain('data-act="gaveta-avatar" data-id="a1" aria-haspopup="dialog" aria-expanded="false"');
    expect(fechado).not.toContain('aria-controls="gvn-pop"');
    expect(fechado).not.toContain('class="gvn-pop"');
    const html = renderDetalhes(aberto(com(nina())));
    expect(html).toContain('aria-haspopup="dialog" aria-controls="gvn-pop" aria-expanded="true"');
    expect(html).toContain('role="dialog" aria-label="Editar avatar"');
    expect(html).not.toContain("aria-modal");
    expect(html.match(/data-act="gaveta-forma"/g)).toHaveLength(8);
    expect(html.match(/data-act="gaveta-cor"/g)).toHaveLength(12);
    expect(html.match(/aria-checked="true"/g)).toHaveLength(2);
    expect(html).toMatch(/aria-checked="true" tabindex="0"[^>]*data-act="gaveta-forma" data-id="a1" data-valor="shape-square"/);
    expect(html).toContain('data-act="gaveta-redefinir"');
  });

  it("trocar de nível ou de aba fecha o popover", () => {
    const e = aberto(com(nina()));
    expect(reduzir(e, { tipo: "gaveta", agenteId: "a1", nivel: null }).avatarAberto).toBeNull();
    expect(reduzir(e, { tipo: "aba-gaveta", agenteId: "a1", aba: "computador" }).avatarAberto).toBeNull();
  });
});

describe("6: as abas", () => {
  it("tablist com Detalhes, Biblioteca e Computador (NOD-326), tabindex roving e o painel ligado à aba", () => {
    const html = renderDetalhes(com(nina()));
    expect(html).toContain('role="tablist" aria-label="Seções do painel"');
    expect(html).toContain('role="tab" class="gv-aba" id="gv-aba-detalhes" aria-controls="gv-painel-detalhes" aria-selected="true" tabindex="0"');
    expect(html).toContain('id="gv-aba-computador" aria-controls="gv-painel-computador" aria-selected="false" tabindex="-1"');
    expect(html).toContain('id="gv-aba-biblioteca" aria-controls="gv-painel-biblioteca" aria-selected="false" tabindex="-1"');
    expect(html.indexOf('data-aba="detalhes"')).toBeLessThan(html.indexOf('data-aba="biblioteca"'));
    expect(html.indexOf('data-aba="biblioteca"')).toBeLessThan(html.indexOf('data-aba="computador"'));
    expect(html).toContain('role="tabpanel" id="gv-painel-detalhes" aria-labelledby="gv-aba-detalhes"');
    expect(abasDoBot(true)).toEqual(["detalhes", "biblioteca", "computador"]);
    expect(abasDoBot(false)).toEqual(["detalhes", "biblioteca"]);
  });

  it("a aba é lembrada por bot; a lembrada que não existe mais (bot da equipe) cai em Detalhes", () => {
    const e = reduzir(com(nina()), { tipo: "aba-gaveta", agenteId: "a1", aba: "computador" });
    expect(e.abaGaveta).toEqual({ a1: "computador" });
    expect(renderDetalhes(e)).toContain('id="gv-aba-computador" aria-controls="gv-painel-computador" aria-selected="true"');
    expect(abaAberta(e, "a1", ["detalhes"])).toBe("detalhes");
    expect(abaAberta(e, "outro", ["detalhes", "computador"])).toBe("detalhes");
    // Ler do localStorage não atropela o que a pessoa escolheu nesta aba do navegador.
    expect(reduzir(e, { tipo: "abas-lidas", abas: { a1: "detalhes", b2: "computador" } }).abaGaveta).toEqual({ a1: "computador", b2: "computador" });
    expect(reduzir(e, { tipo: "aba-gaveta", agenteId: "a1", aba: "computador" })).toBe(e);
  });
});

describe("7: Detalhes com as Rotinas e a linha Ajustes", () => {
  it("vazio, convida; a linha 'Ajustes ›' leva ao nível", () => {
    const html = renderDetalhes(com(nina()));
    // NOD-444: o vazio ensina a pedir na conversa; o "+ Nova" leva à conversa (não abre o formulário).
    expect(html).toContain("Nenhuma rotina ainda. Peça na conversa, do seu jeito: «todo dia útil às 8, me mande as pautas»");
    expect(html).not.toContain("ela aparece aqui");
    expect(html).toContain('data-act="rotina-no-chat" data-agente="a1"');
    expect(html).not.toContain('data-nivel="nova-rotina"');
    expect(html).toContain('data-act="gaveta" data-nivel="ajustes" data-agente="a1" data-origem="ajustes"');
    expect(html).toContain("Ligar, trabalhos, memória, missão e acessos");
  });
});

describe("8–9: o nível Ajustes", () => {
  it("Atalhos, Perfil, Acessos e Ambiente, nesta ordem; o Modo dev no fim; sem Colabora com; a Pasta não mora mais em Ajustes", () => {
    const html = renderDetalhes(ajustes(com(nina())));
    const ordem = ["<h3>Atalhos</h3>", "<h3>Perfil</h3>", "<h3>Acessos</h3>", "<h3>Ambiente</h3>"].map((s) => html.indexOf(s));
    expect(ordem.every((i) => i >= 0)).toBe(true);
    expect(ordem).toEqual([...ordem].sort((a, b) => a - b));
    expect(html).toContain("Missão e voz");
    expect(html).not.toContain("Colabora com");
    // NOD-326: a Pasta foi para a aba Biblioteca (nem em Ambiente, nem no Modo dev).
    expect(html).not.toContain("Pasta de trabalho");
    const dev = renderDetalhes({ ...ajustes(com(nina())), modoDev: { ...estadoInicial.modoDev, ligado: true } });
    expect(dev).not.toContain("Pasta de trabalho");
  });

  it("NOD-326: a Pasta fica no topo da aba Biblioteca, só no bot da pessoa (nada some sem destino)", () => {
    const e = com(nina());
    const a = e.frota!.agentes[0]! as never;
    const html = abaBiblioteca(e, a, true);
    expect(html).toContain('data-act="abrir-workspace"');
    expect(html.indexOf("abrir-workspace")).toBeLessThan(html.indexOf('class="gv-secao gvb"'));
    expect(abaBiblioteca(e, a, false)).not.toContain("abrir-workspace");
  });
});

describe("10: os atalhos que saíram da gaveta", () => {
  it("Planejar e Pedir ajuda não estão mais na gaveta (moram no / do campo)", () => {
    const html = renderDetalhes(com(nina())) + renderDetalhes(ajustes(com(nina())));
    expect(html).not.toContain("Planejar uma tarefa");
    expect(html).not.toContain("Pedir ajuda a outro bot");
  });
});

describe("12: a aba Computador", () => {
  const naAba = (a: AgenteFrota, visto?: "ligado" | "ocupado" | "dormindo" | "sem"): Estado => ({ ...com(a), abaGaveta: { a1: "computador" }, computadorVisto: visto ? { a1: visto } : {} });
  it("o estado vem do DTO: fora do ar manda; sem id, sem computador; desligado, dormindo; ocupado; senão ligado", () => {
    const c = { id: "c", ocupadoAte: null, indisponivelDesde: null };
    expect(estadoDoComputador({ computador: { ...c, indisponivelDesde: 1 } as never, ativo: true }, 0)).toBe("fora");
    expect(estadoDoComputador({ computador: { ...c, id: null } as never, ativo: false }, 0)).toBe("sem");
    expect(estadoDoComputador({ computador: c as never, ativo: false }, 0)).toBe("dormindo");
    expect(estadoDoComputador({ computador: { ...c, ocupadoAte: 10 } as never, ativo: true }, 5)).toBe("ocupado");
    expect(estadoDoComputador({ computador: { ...c, ocupadoAte: 10 } as never, ativo: true }, 11)).toBe("ligado");
  });

  it("ocupado mostra a miniatura e diz que está usando a tela; o reducer não troca o estado igual", () => {
    expect(renderDetalhes(naAba(nina(), "ocupado"))).toContain("Ligado · usando a tela agora");
    const e = reduzir(com(nina()), { tipo: "computador-visto", agenteId: "a1", estado: "ligado" });
    expect(e.computadorVisto).toEqual({ a1: "ligado" });
    expect(reduzir(e, { tipo: "computador-visto", agenteId: "a1", estado: "ligado" })).toBe(e);
  });

  it("NOD-96 (v2): com o computador da pessoa, a aba mostra o estado dele (não o pulso do bot) e segue observável", () => {
    const v2 = { estado: "dormindo", maquina: null, telas: [], esperando: [] } as unknown as Estado["computadorPessoa"];
    const html = renderDetalhes({ ...naAba(nina(), "ocupado"), computadorPessoa: v2 });
    expect(html).toContain('data-gaveta-computador="dormindo"');
    expect(html).toContain('data-comp-bot="a1"');
    expect(html).toContain('data-op="acordar"');
    expect(html).not.toContain("Ligado · usando a tela agora");
  });
});

describe("12 (revisão): o computador não prende o alarme nem fica sem saída", () => {
  const naAba = (a: AgenteFrota, visto?: "dormindo" | "sem" | "fora" | "indisponivel" | "erro"): Estado => ({ ...com(a), abaGaveta: { a1: "computador" }, computadorVisto: visto ? { a1: visto } : {} });
  it("o ponto vermelho vem só da frota: um 'fora' de pulso antigo não acende a aba", () => {
    expect(renderDetalhes(naAba(nina(), "fora"))).not.toContain('class="gvn-ponto"');
    expect(renderDetalhes(naAba(nina({ computadorForaDoAr: { desde: 0, motivo: "navegador_nao_abriu" } })))).toContain('class="gvn-ponto"');
  });
  it("a frota que diz que o computador voltou apaga o 'fora' lido antes", () => {
    const e = { ...com(nina()), computadorVisto: { a1: "fora" as const, b: "dormindo" as const } };
    const depois = reduzir(e, { tipo: "hidratar-frota", frota: e.frota! });
    expect(depois.computadorVisto).toEqual({ b: "dormindo" });
  });
  it("dormindo, sem computador, indisponível e erro de leitura têm Abrir computador; nenhum fica em 'Vendo…'", () => {
    for (const v of ["dormindo", "sem", "indisponivel", "erro"] as const) {
      const html = renderDetalhes(naAba(nina(), v));
      expect(html, v).toContain('data-act="abrir-computador"');
      expect(html, v).not.toContain("Vendo o computador");
    }
    expect(renderDetalhes(naAba(nina(), "indisponivel"))).toContain("Ambiente indisponível agora");
    expect(renderDetalhes(naAba(nina(), "erro"))).toContain("Não deu para ver o computador agora");
  });
  it("com o ambiente indisponível o estado não é 'dormindo' (Acordar falharia)", () => {
    const c = { id: "c", ocupadoAte: null, indisponivelDesde: null };
    expect(estadoDoComputador({ computador: c as never, ativo: false, disponivel: false }, 0)).toBe("indisponivel");
  });
  it("navegar fecha o popover do avatar (não reabre sozinho ao voltar)", () => {
    const e = reduzir(com(nina()), { tipo: "avatar-popover", aberto: { agenteId: "a1", forma: "shape-square", cor: "c-purple" } });
    expect(reduzir(e, { tipo: "navegar", tela: { tipo: "inicio" } } as never).avatarAberto).toBeNull();
  });
});

describe("13: bot de outra pessoa e o Nod", () => {
  it("bot da equipe: nome e subtítulo só leitura, sem avatar editável, sem a aba Computador e sem chave de rotina", () => {
    const e = com(nina({ ownerId: "outra" }));
    const html = renderDetalhes(e);
    expect(html).toContain('<h2 class="gvn-nome-fixo" title="Nina">Nina</h2>');
    expect(html).not.toContain('id="gvn-nome"');
    expect(html).not.toContain('data-act="gaveta-avatar"');
    // NOD-326: Detalhes · Biblioteca (a conversa com o bot da equipe também tem arquivos), sem Computador.
    expect(html).toContain('data-aba="biblioteca"');
    expect(html).not.toContain('data-aba="computador"');
    expect(html).not.toContain('data-comp-bot');
    expect(html).not.toContain('data-act="gaveta" data-nivel="nova-rotina"');
    expect(html).not.toContain('data-act="rotina-no-chat"');
  });

  it("o Nod não se renomeia (o servidor recusa), mas o subtítulo, a forma e a cor dele mudam (nada some)", () => {
    expect(identidadeEditavel(true)).toBe(true);
    expect(nomeEditavel({ papel: "nod" }, true)).toBe(false);
    expect(nomeEditavel({ papel: undefined }, true)).toBe(true);
    expect(identidadeEditavel(false)).toBe(false);
    const html = renderDetalhes(com(nina({ papel: "nod", nome: "Nod" } as Partial<AgenteFrota>)));
    expect(html).toContain('<h2 class="gvn-nome-fixo" title="Nod">Nod</h2>');
    expect(html).not.toContain('id="gvn-nome"');
    expect(html).toContain('id="gvn-sub"');
    expect(html).toContain('data-act="gaveta-avatar"');
  });
});

describe("14: erros sem fundo colorido, só tokens", () => {
  it("o CSS novo da gaveta não usa tag colorida nem cor literal (fora a marcada cor-fixa)", () => {
    const css = readFileSync(new URL("../../../web/navegacao.css", import.meta.url), "utf8");
    const bloco = css.slice(css.indexOf("/* ADR-125 (NOD-349"));
    const literais = bloco.split("\n").filter((l) => /#[0-9a-f]{3,8}\b|rgb\(/i.test(l) && !l.includes("cor-fixa:"));
    expect(literais).toEqual([]);
    expect(bloco).not.toMatch(/background: var\(--danger\)(?!;\s*vertical-align)/);
    const html = renderDetalhes({ ...com(nina({ computadorForaDoAr: { desde: 0, motivo: "navegador_nao_abriu" } })), abaGaveta: { a1: "computador" } });
    expect(html).not.toContain("tag-vermelha");
    expect(html).not.toContain("tag-ambar");
  });
});

describe("15: alvos de 44 px no toque", () => {
  it("mobile.css dá 44 px aos botões redondos, às cores, às ações de texto, às abas e aos campos", () => {
    const css = readFileSync(new URL("../../../web/mobile.css", import.meta.url), "utf8");
    expect(css).toContain(".gvn-redondo, .gvn-cor { width: 44px; height: 44px; }");
    expect(css).toContain(".gvn-acao-texto, .gv-aba { min-height: 44px; }");
    expect(css).toContain(".gvn-nome { min-height: 44px; }");
  });
});
