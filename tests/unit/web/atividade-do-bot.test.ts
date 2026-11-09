import { describe, expect, it } from "vitest";
import type { AtividadeDto, ItemDeAtividade } from "../../../src/contracts/atividade.ts";
import type { FrameSse } from "../../../src/contracts/frame.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import type { TrabalhoDto } from "../../../src/contracts/trabalho.ts";
import { aplicarFrame, estadoInicial, invalidacoesDaTela, reduzir, type Estado } from "../../../web/estado/reducer.ts";
import { criarVigiaDaAtividade, diaLocal, diaSeguinte, fusoLocal, itensDoFiltro, JANELA_DA_ATIVIDADE_MS, rotuloDoDia } from "../../../web/lib/atividade-do-bot.ts";
import { renderAtividade } from "../../../web/telas/atividade.ts";
import { nivelDaGaveta, renderDetalhes } from "../../../web/telas/detalhes.ts";
import { SEM_PROGRESSO } from "../../../web/lib/pilula.ts";
import { memoriaNaPilula, pilulaNaConversa } from "../../../web/telas/pilula-do-bot.ts";
import { htmlProgresso } from "../../../web/telas/progresso-na-fala.ts";

/**
 * A Atividade do bot na gaveta (ADR-114, chat limpo, PR 2): a linha "Atividade · N hoje" em Atalhos, logo abaixo de
 * Trabalhos; o nível com os filtros, a lista do dia, o alvo de cada item e "Dia anterior"; o "N hoje" relido pelos frames;
 * a linha "Agora" da memória; e a telemetria do gatilho.
 */

const AGORA = new Date(2026, 9, 18, 15, 0).getTime();
const HOJE = diaLocal(AGORA);
const C = "c-ada";
const BOT = { id: "ada", nome: "Ada", conversaId: C, cor: "c-red", forma: "shape-circle", ownerId: "p", confirmado: true, titulo: "", descricao: "" };

function base(extra: Partial<Estado> = {}): Estado {
  return {
    ...estadoInicial,
    agora: AGORA,
    sessao: { pessoaId: "p", tenantId: "t" } as never,
    tela: { tipo: "conversa", conversaId: C, agenteId: "ada" },
    frota: { agentes: [BOT] } as never,
    ...extra,
  };
}

const item = (id: string, em: number, extra: Partial<ItemDeAtividade> = {}): ItemDeAtividade => ({ id, em, categoria: null, titulo: `item ${id}`, detalhe: null, ...extra });
const dto = (itens: ItemDeAtividade[], extra: Partial<AtividadeDto> = {}): AtividadeDto => ({ dia: HOJE, itens, total: itens.length, truncados: 0, diaAnterior: "2026-10-17", ...extra });

function aberta(d: AtividadeDto | null, extra: Partial<Estado> = {}, vista: Partial<NonNullable<Estado["atividadeVista"]>> = {}): Estado {
  const e = reduzir(base(extra), { tipo: "gaveta", agenteId: "ada", nivel: { tipo: "atividade" } });
  const comVista = vista ? reduzir(e, { tipo: "atividade-vista", mudanca: vista }) : e;
  const dia = comVista.atividadeVista?.dia ?? HOJE;
  return reduzir(comVista, { tipo: "hidratar-atividade", agenteId: "ada", dia, atividade: d });
}

// ADR-125 (NOD-349): os Atalhos moram no nível Ajustes.
const emAjustes = (e: Estado): Estado => reduzir(e, { tipo: "gaveta", agenteId: "ada", nivel: { tipo: "ajustes" } });

describe("a linha 'Atividade' em Atalhos (nível Ajustes)", () => {
  it("logo abaixo de Trabalhos, com 'N hoje' só depois de a contagem chegar; abre o nível", () => {
    const sem = renderDetalhes(emAjustes(base()));
    expect(sem).toContain('data-nivel="atividade"');
    expect(sem.indexOf('data-nivel="trabalhos"')).toBeLessThan(sem.indexOf('data-nivel="atividade"'));
    expect(sem).not.toContain(" hoje</span>");
    const com = renderDetalhes(emAjustes(reduzir(base(), { tipo: "hidratar-atividade-hoje", agenteId: "ada", dia: HOJE, total: 14 })));
    expect(com).toContain('<span class="gv-meta">14 hoje</span>');
    expect(renderDetalhes(emAjustes(reduzir(base(), { tipo: "hidratar-atividade-hoje", agenteId: "ada", dia: HOJE, total: null })))).not.toContain(" hoje</span>");
    expect(nivelDaGaveta("atividade")).toEqual({ tipo: "atividade" });
  });

  it("bot de outra pessoa (equipe) não tem a linha: a rota é só do dono", () => {
    expect(renderDetalhes(emAjustes(base({ frota: { agentes: [{ ...BOT, ownerId: "outra" }] } as never })))).not.toContain('data-nivel="atividade"');
  });
});

describe("o nível Atividade", () => {
  const itens = [
    item("t1", AGORA - 60_000, { categoria: "frentes", titulo: "Terminou Hero w5", detalhe: "em 2 h 00", alvo: { trabalhoId: "w5" } }),
    item("m1", AGORA - 120_000, { categoria: "bloqueios", titulo: "Bash negada", detalhe: "Bash negada: esperando…", texto: "Bash negada: esperando aprovação do comando inteiro", vezes: 2, alvo: { mensagemId: "m1" } }),
    item("trilha:gmail:conector_indisponivel", AGORA - 180_000, { categoria: "bloqueios", titulo: "Gmail indisponível", detalhe: "o app não respondeu", vezes: 3 }),
    item("m2", AGORA - 240_000, { categoria: "maquina_ia", titulo: "Trocou de IA", alvo: { mensagemId: "m2" } }),
    item("m3", AGORA - 300_000, { titulo: "Anotou na memória", detalhe: "Anotei uma preferência", alvo: { mensagemId: "m3" } }),
  ];

  it("filtros com aria-pressed; item sem categoria só em 'Tudo'", () => {
    const tudo = renderAtividade(aberta(dto(itens)), BOT as never);
    expect(tudo).toContain('data-filtro="tudo" aria-pressed="true"');
    expect(tudo).toContain('data-filtro="frentes" aria-pressed="false"');
    expect(tudo).toContain("Anotou na memória");
    expect(tudo).toContain("<h3 class=\"atv-dia-titulo\" tabindex=\"-1\">Hoje</h3>");
    const bloqueios = renderAtividade(aberta(dto(itens), {}, { filtro: "bloqueios" }), BOT as never);
    expect(bloqueios).toContain("Bash negada");
    expect(bloqueios).toContain("Gmail indisponível");
    expect(bloqueios).not.toContain("Anotou na memória");
    expect(bloqueios).not.toContain("Terminou Hero w5");
    expect(itensDoFiltro(itens, "maquina_ia").map((i) => i.id)).toEqual(["m2"]);
  });

  it("alvo: a frente abre a tela dela; a mensagem abre o texto inteiro com o Relatar; a trilha não tem Relatar", () => {
    const fechado = renderAtividade(aberta(dto(itens)), BOT as never);
    expect(fechado).toContain('data-act="abrir-trabalho" data-id="w5"');
    expect(fechado).toContain('data-act="atividade-abrir" data-id="m1" aria-expanded="false"');
    expect(fechado).not.toContain("relatar-mensagem");
    expect(fechado).toContain('<span class="atv-vezes">3 vezes</span>');
    const comM1 = renderAtividade(aberta(dto(itens), {}, { aberta: "m1" }), BOT as never);
    expect(comM1).toContain('aria-expanded="true" aria-controls="atv-m1"');
    expect(comM1).toContain("Bash negada: esperando aprovação do comando inteiro");
    expect(comM1).toContain('data-act="relatar-mensagem" data-id="m1"');
    const trilha = comM1.slice(comM1.indexOf("Gmail indisponível") - 300, comM1.indexOf("Gmail indisponível"));
    expect(trilha).toContain('class="atv-botao estatico"');
  });

  it("vazio, carregando, indisponível, truncados e a troca de dia", () => {
    expect(renderAtividade(reduzir(base(), { tipo: "gaveta", agenteId: "ada", nivel: { tipo: "atividade" } }), BOT as never)).toContain("carregando…");
    expect(renderAtividade(aberta(null), BOT as never)).toContain("não está disponível");
    const vazio = renderAtividade(aberta(dto([])), BOT as never);
    expect(vazio).toContain("Nada neste dia.");
    expect(vazio).toContain('data-act="atividade-dia" data-dia="2026-10-17">Dia anterior ›');
    expect(vazio).not.toContain("Dia seguinte");
    expect(renderAtividade(aberta(dto([]), {}, { filtro: "frentes" }), BOT as never)).toContain("Nada deste tipo neste dia.");
    expect(renderAtividade(aberta(dto(itens.slice(0, 1), { total: 503, truncados: 502 })), BOT as never)).toContain("e mais 502 itens deste dia, no Raio-X");
    const nascimento = renderAtividade(aberta(dto([], { diaAnterior: null })), BOT as never);
    expect(nascimento).not.toContain("Dia anterior");
    const ontem = renderAtividade(aberta(dto([], { dia: "2026-10-17", diaAnterior: "2026-10-16" }), {}, { dia: "2026-10-17" }), BOT as never);
    expect(ontem).toContain(">Ontem</h3>");
    expect(ontem).toContain(`data-dia="${HOJE}">‹ Dia seguinte`);
  });

  it("a linha 'Agora' da memória no topo de hoje, enquanto vale; nunca em dia passado nem no filtro de frentes", () => {
    const trabalhos = { trabalhos: [{ id: "w", agenteId: "ada", conversaId: C, estado: "rodando", criadoEm: AGORA - 60_000 } as TrabalhoDto, { id: "w2", agenteId: "ada", conversaId: C, estado: "na_fila", criadoEm: AGORA } as TrabalhoDto], pressao: "amarela" as const, memoriaTotalMb: null };
    const com = renderAtividade(aberta(dto(itens), { trabalhos, pressao: "amarela" }), BOT as never);
    expect(com).toContain('<span class="atv-hora">Agora</span>');
    expect(com).toContain("Pouca memória no seu Mac");
    expect(com).toContain("2 trabalhos abertos");
    expect(com).toContain('data-act="navegar" data-tela="trabalhos">ver');
    expect(com.indexOf("Agora")).toBeLessThan(com.indexOf("Terminou Hero w5"));
    expect(renderAtividade(aberta(dto(itens), { trabalhos, pressao: "amarela" }, { filtro: "frentes" }), BOT as never)).not.toContain("Pouca memória");
    expect(renderAtividade(aberta(dto([], { dia: "2026-10-17" }), { trabalhos, pressao: "amarela" }, { dia: "2026-10-17" }), BOT as never)).not.toContain("Pouca memória");
    expect(renderAtividade(aberta(dto(itens), { trabalhos, pressao: "verde" }), BOT as never)).not.toContain("Agora");
  });

  // QA do PR 2: com a memória amarela e nada aberto no bot, a linha dizia "Pouca memória no seu Mac · 0 trabalhos abertos".
  it("sem trabalho aberto no bot, a memória não entra na linha 'Agora' (como o ponto); o disco cheio que segura tudo entra", () => {
    const vazio = { trabalhos: [], pressao: "amarela" as const, memoriaTotalMb: null };
    const sem = renderAtividade(aberta(dto(itens), { trabalhos: vazio, pressao: "amarela" }), BOT as never);
    expect(sem).not.toContain("Agora");
    expect(sem).not.toContain("0 trabalhos abertos");
    const disco = { ...vazio, motivoEspera: "disco", seguraTudoNovo: true };
    expect(renderAtividade(aberta(dto(itens), { trabalhos: disco as never, pressao: "amarela" }), BOT as never)).toContain("Pouco espaço no disco do seu Mac");
  });
});

describe("o estado da Atividade (reducer)", () => {
  const frame = (tipo: FrameSse["tipo"], dados: Record<string, unknown>): FrameSse => ({ tipo, dados } as FrameSse);

  it("abrir o nível começa em hoje, em 'Tudo'; a tela pede a página do dia e o 'N hoje'", () => {
    const e = reduzir(base(), { tipo: "gaveta", agenteId: "ada", nivel: { tipo: "atividade" } });
    expect(e.atividadeVista).toEqual({ agenteId: "ada", dia: HOJE, filtro: "tudo", aberta: null, aba: "atividade", desfecho: "tudo", decisao: null, exportar: null });
    expect(invalidacoesDaTela(e)).toEqual(expect.arrayContaining([`atividade:ada:${HOJE}`, "atividade-hoje:ada"]));
    const lida = reduzir(reduzir(e, { tipo: "hidratar-atividade", agenteId: "ada", dia: HOJE, atividade: dto([]) }), { tipo: "hidratar-atividade-hoje", agenteId: "ada", dia: HOJE, total: 0 });
    expect(invalidacoesDaTela(lida).filter((q) => q.startsWith("atividade"))).toEqual([]);
    // Sair do nível esquece a vista; reabrir relê o dia (a página guardada fica à vista até a nova chegar).
    const fechada = reduzir(lida, { tipo: "gaveta", agenteId: "ada", nivel: null });
    expect(fechada.atividadeVista).toBeNull();
    const reaberta = reduzir({ ...fechada, invalidacoes: [] }, { tipo: "gaveta", agenteId: "ada", nivel: { tipo: "atividade" } });
    expect(reaberta.invalidacoes).toContain(`atividade:ada:${HOJE}`);
    expect(renderAtividade(reaberta, BOT as never)).toContain("Nada neste dia.");
    // A contagem lida num dia que já passou é relida.
    expect(invalidacoesDaTela({ ...lida, atividadeHoje: { ada: { dia: "2026-10-17", total: 3 } } })).toContain("atividade-hoje:ada");
  });

  it("a página de hoje também atualiza o 'N hoje' (o mesmo total)", () => {
    const e = reduzir(base(), { tipo: "hidratar-atividade-hoje", agenteId: "ada", dia: HOJE, total: 2 });
    const depois = reduzir(reduzir(e, { tipo: "gaveta", agenteId: "ada", nivel: { tipo: "atividade" } }), { tipo: "hidratar-atividade", agenteId: "ada", dia: HOJE, atividade: dto([item("a", AGORA), item("b", AGORA), item("c", AGORA)]) });
    expect(depois.atividadeHoje.ada).toEqual({ dia: HOJE, total: 3 });
  });

  it("'N hoje' relido nos três frames do bot (mensagem nova, negação, trabalho que mudou), só depois de lido; a página aberta também", () => {
    const naoLido = aplicarFrame(base(), frame("mensagem.nova", { conversaId: C }), AGORA);
    expect(naoLido.invalidacoes.some((q) => q.startsWith("atividade"))).toBe(false);
    const lido = reduzir(base(), { tipo: "hidratar-atividade-hoje", agenteId: "ada", dia: HOJE, total: 1 });
    for (const [tipo, dados] of [["mensagem.nova", { conversaId: C }], ["negacao", { conversaId: C, classe: "conector_indisponivel", motivo: "conector_indisponivel", nome: "gmail" }], ["trabalho.mudou", { conversaId: C, trabalhoId: "w" }]] as const) {
      const depois = aplicarFrame({ ...lido, invalidacoes: [] }, frame(tipo, dados), AGORA);
      expect(depois.invalidacoes, tipo).toContain("atividade-hoje:ada");
    }
    const comNivel = reduzir(lido, { tipo: "gaveta", agenteId: "ada", nivel: { tipo: "atividade" } });
    expect(aplicarFrame({ ...comNivel, invalidacoes: [] }, frame("mensagem.nova", { conversaId: C }), AGORA).invalidacoes).toContain(`atividade:ada:${HOJE}`);
    // A conversa de outro bot não relê a Atividade da Ada.
    expect(aplicarFrame({ ...lido, invalidacoes: [] }, frame("mensagem.nova", { conversaId: "c-outra" }), AGORA).invalidacoes.some((q) => q.startsWith("atividade"))).toBe(false);
  });
});

describe("o ponto da memória na pílula do bot (decisão tomada 5; PR 8)", () => {
  const msgLimpa = { id: "m", conversaId: C, destino: "chat" } as Mensagem;
  const conversa = (mensagens: Mensagem[]) => ({ [C]: { conversa: { id: C, tipo: "propria", agenteId: "ada" }, mensagens, turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], propostas: [], fios: [], trabalhos: [], dono: null } }) as never;
  const trabalhos = (pressao: "amarela" | "vermelha" | "verde") => ({ trabalhos: [{ id: "w", agenteId: "ada", conversaId: C, titulo: "Relatório", estado: "rodando", criadoEm: AGORA } as TrabalhoDto], pressao, memoriaTotalMb: null });

  it("na conversa limpa, com trabalho aberto: a frase e para onde leva (Trabalhos)", () => {
    const e = base({ conversas: conversa([msgLimpa]), trabalhos: trabalhos("amarela"), pressao: "amarela" });
    expect(memoriaNaPilula(e, "ada", C)).toEqual({ texto: "Pouca memória no seu Mac · 1 trabalho aberto", nivel: "amarela", alvo: 'data-act="navegar" data-tela="trabalhos"' });
    expect(memoriaNaPilula(base({ conversas: conversa([msgLimpa]), trabalhos: trabalhos("vermelha"), pressao: "vermelha" }), "ada", C)?.nivel).toBe("vermelha");
  });

  it("sem pressão, sem trabalho aberto ou na conversa sem destino (servidor de antes): nada", () => {
    expect(memoriaNaPilula(base({ conversas: conversa([msgLimpa]), trabalhos: trabalhos("verde"), pressao: "verde" }), "ada", C)).toBeNull();
    expect(memoriaNaPilula(base({ conversas: conversa([msgLimpa]), trabalhos: { trabalhos: [], pressao: "amarela", memoriaTotalMb: null }, pressao: "amarela" }), "ada", C)).toBeNull();
    expect(memoriaNaPilula(base({ conversas: conversa([{ id: "m", conversaId: C } as Mensagem]), trabalhos: trabalhos("amarela"), pressao: "amarela" }), "ada", C)).toBeNull();
  });

  it("na pílula: um ponto ao lado dela, com a frase no title e no nome acessível; a frase inteira só dentro da alargada", () => {
    const livre = { agenteId: "ada", principal: "livre", frentes: 0, conversaTrabalhando: false, esperandoVoce: 0, esperando: 0, fila: 0, motivoEspera: null, desde: null };
    const e = base({ conversas: conversa([msgLimpa]), trabalhos: { ...trabalhos("amarela"), donos: [{ estado: livre, esperas: [], fila: [] }] } as never, pressao: "amarela" });
    const p = pilulaNaConversa(e, "ada", SEM_PROGRESSO);
    if (p.tipo !== "pilula") throw new Error("sem pílula");
    expect(p.partes.memoria).toContain('class="pf-memoria amarela" data-act="navegar" data-tela="trabalhos" title="Pouca memória no seu Mac · 1 trabalho aberto" aria-label="Pouca memória no seu Mac · 1 trabalho aberto"');
    expect(p.partes.memoria).not.toContain("Pouca memória no seu Mac</");
    expect(p.partes.botao).not.toContain("memória");
    expect(p.partes.corpo).toContain('class="pf-memoria-linha amarela" data-act="navegar" data-tela="trabalhos"><span class="pf-memoria-ponto" aria-hidden="true"></span>Pouca memória no seu Mac · 1 trabalho aberto</button>');
  });

  it("no bloco de progresso na fala: o ponto ao lado do número, só no bloco que ainda anda", () => {
    const frentes = [{ trabalhoId: "w", titulo: "Relatório", estado: "rodando" as const, passo: "lendo", tempo: "3 min", terminouEm: null }, { trabalhoId: "w2", titulo: "Resumo", estado: "pronta" as const, passo: null, tempo: null, terminouEm: AGORA }];
    const html = htmlProgresso(frentes, { chave: "a1", agenteId: "ada", memoria: { texto: "Pouca memória no seu Mac · 1 trabalho aberto", nivel: "amarela" } });
    expect(html).toContain('1 de 2 prontas<span class="progresso-memoria amarela" role="img" aria-label="Pouca memória no seu Mac · 1 trabalho aberto" title="Pouca memória no seu Mac · 1 trabalho aberto"></span>');
    expect(htmlProgresso(frentes, { chave: "a1", agenteId: "ada" })).not.toContain("progresso-memoria");
  });
});

describe("telemetria do gatilho (TipoLinha 'atividade')", () => {
  it("cada abertura da conversa é uma 'mostrada' com chave nova; a Atividade aberta até 60 s depois é a 'aberta' com a mesma chave", () => {
    const eventos: { acao: string; chaveLinha: string; tipo: string }[] = [];
    let agora = 1_000;
    const vigia = criarVigiaDaAtividade({ mostrada: (e) => eventos.push({ acao: "mostrada", ...e }), aberta: (e) => eventos.push({ acao: "aberta", ...e }) }, () => agora);
    vigia.naTela({ agenteId: "ada", conversaId: C });
    vigia.naTela({ agenteId: "ada", conversaId: C });
    expect(eventos).toEqual([{ acao: "mostrada", tipo: "atividade", agenteId: "ada", chaveLinha: `atividade:${C}:1000` }]);
    agora += JANELA_DA_ATIVIDADE_MS - 1;
    vigia.atividadeAberta("ada");
    expect(eventos.at(-1)).toEqual({ acao: "aberta", tipo: "atividade", agenteId: "ada", chaveLinha: `atividade:${C}:1000` });
    agora += 2;
    vigia.atividadeAberta("ada");
    expect(eventos).toHaveLength(2);
    vigia.naTela(null);
    agora += 5;
    vigia.naTela({ agenteId: "ada", conversaId: C });
    expect(eventos.at(-1)?.chaveLinha).toBe(`atividade:${C}:${agora}`);
    vigia.atividadeAberta("outro");
    expect(eventos).toHaveLength(3);
  });

  it("dia, fuso e rótulo do dia", () => {
    expect(diaSeguinte("2026-10-31")).toBe("2026-11-01");
    expect(fusoLocal(() => "America/Sao_Paulo")).toBe("America/Sao_Paulo");
    expect(fusoLocal(() => "GMT+3")).toBe("UTC");
    expect(fusoLocal(() => { throw new Error("sem Intl"); })).toBe("UTC");
    expect(rotuloDoDia(HOJE, HOJE)).toBe("Hoje");
    expect(rotuloDoDia("2026-10-17", HOJE)).toBe("Ontem");
    expect(rotuloDoDia("2026-10-13", HOJE)).toMatch(/13\/10/);
  });
});
