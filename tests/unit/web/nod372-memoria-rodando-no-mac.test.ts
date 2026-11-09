import { describe, expect, it } from "vitest";
import type { AtividadeDto } from "../../../src/contracts/atividade.ts";
import type { LeituraDeMaquinaDto } from "../../../src/contracts/maquina.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import type { NivelPressao, TrabalhoDto, TrabalhosDto } from "../../../src/contracts/trabalho.ts";
import { diaLocal } from "../../../web/lib/atividade-do-bot.ts";
import { estadoInicial, reduzir, type Estado } from "../../../web/estado/reducer.ts";
import { pilulaMemoria, rodandoNoMac } from "../../../web/lib/trabalhos.ts";
import { renderAtividade } from "../../../web/telas/atividade.ts";
import { memoriaDoMac, renderTrabalhosPorBot } from "../../../web/telas/linha-do-dono.ts";
import { memoriaNaPilula } from "../../../web/telas/pilula-do-bot.ts";
import { renderTodosOsTrabalhos } from "../../../web/telas/trabalhos.ts";

/**
 * NOD-372 (2026-10-26): o Marlon via "Pouca memória no seu Mac · 3 trabalhos abertos" com tudo rodando na VM. A pílula de
 * memória do Mac só aparece com trabalho rodando agora no Mac (rodando, fora de espera, `maquina.ehMac`) e conta só esses
 * ("N rodando aqui"), nos cinco pontos que a mostram. O caminho do servidor anterior (sem `maquinas`) não muda.
 */

const AGORA = new Date(2026, 9, 26, 15, 0).getTime();
const C = "c-ada";
const BOT = { id: "ada", nome: "Ada", conversaId: C, cor: "c-red", forma: "shape-circle", ownerId: "p", confirmado: true, titulo: "", descricao: "" };
const VM = { id: "vm-1", nome: "nod-motor-teste", ehMac: false };
const MAC = { id: "mac-1", nome: "Este Mac", ehMac: true };

const trabalho = (id: string, extra: Partial<TrabalhoDto> = {}): TrabalhoDto => ({
  id, agenteId: "ada", conversaId: C, titulo: id, origem: "pessoa", pedidoPorAgenteId: null, rotinaId: null, trabalhoMaeId: null, depoisDeTrabalhoId: null, estado: "rodando",
  pasta: null, memoriaMb: null, custoUsd: null, criadoEm: AGORA - 60_000, iniciadoEm: AGORA - 60_000, terminadoEm: null, pedidoPorNome: null, rotinaNome: null, ultimoPasso: null, turnoVivoId: null, esperandoComputadorDe: null, ...extra,
});
const naVm = (id: string, extra: Partial<TrabalhoDto> = {}) => trabalho(id, { maquina: VM, ...extra });
const doMac = (id: string, extra: Partial<TrabalhoDto> = {}) => trabalho(id, { maquina: MAC, ...extra });

const leitura = (m: typeof VM, extra: Partial<LeituraDeMaquinaDto> = {}): LeituraDeMaquinaDto => ({
  ...m, pressao: "verde", memoriaBotsMb: 0, processador: "verde", usoProcessador: 0.3, cargaProcessador: 0.4, fila: "verde", disco: null, discoSuportado: true, motivoEspera: null, seguraTudoNovo: false, ...extra,
});

/** O DTO como o servidor de hoje manda: as máquinas com a pressão do Mac; o topo pelo pior. */
function dtoCom(trabalhos: TrabalhoDto[], pressaoDoMac: NivelPressao, extra: { mac?: Partial<LeituraDeMaquinaDto>; vm?: Partial<LeituraDeMaquinaDto> } = {}): TrabalhosDto {
  return { trabalhos, pressao: pressaoDoMac, memoriaTotalMb: null, donos: [], maquinas: [leitura(MAC, { pressao: pressaoDoMac, ...extra.mac }), leitura(VM, extra.vm)] };
}

const msgLimpa = { id: "m", conversaId: C, destino: "chat" } as Mensagem;
const conversas = { [C]: { conversa: { id: C, tipo: "propria", agenteId: "ada" }, mensagens: [msgLimpa], turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], propostas: [], fios: [], trabalhos: [], dono: null } } as never;

function estadoCom(dto: TrabalhosDto, extra: Partial<Estado> = {}): Estado {
  return {
    ...estadoInicial, agora: AGORA, sessao: { tenantId: "t", pessoaId: "p" } as never,
    frota: { agentes: [BOT] } as never, tela: { tipo: "trabalhos" }, conversas,
    trabalhos: dto, pressao: dto.pressao ?? null, ...extra,
  };
}

/** Os cinco pontos de uma vez: topo de Todos os trabalhos, topo por bot, "Agora" da Atividade, pílula do bot. */
function pontos(e: Estado): { todos: string; porBot: string; agora: string; pilula: ReturnType<typeof memoriaNaPilula> } {
  const hoje = diaLocal(AGORA);
  const d: AtividadeDto = { dia: hoje, itens: [], total: 0, truncados: 0, diaAnterior: null };
  const comAtividade = reduzir(reduzir({ ...e, tela: { tipo: "conversa", conversaId: C, agenteId: "ada" } }, { tipo: "gaveta", agenteId: "ada", nivel: { tipo: "atividade" } }), { tipo: "hidratar-atividade", agenteId: "ada", dia: hoje, atividade: d });
  return { todos: renderTodosOsTrabalhos(e), porBot: renderTrabalhosPorBot(e), agora: renderAtividade(comAtividade, BOT as never), pilula: memoriaNaPilula(e, "ada", C) };
}

function semMemoriaEmLugarNenhum(e: Estado): void {
  const p = pontos(e);
  expect(p.todos).not.toContain("pilula-memoria");
  expect(p.porBot).not.toContain("pilula-memoria");
  expect(p.agora).not.toContain('<span class="atv-hora">Agora</span>');
  expect(p.pilula).toBeNull();
  expect(memoriaDoMac(e, "ada", C)).toBeNull();
}

describe("rodandoNoMac: quem ocupa o Mac agora", () => {
  it("só o rodando, fora de espera, numa máquina que é Mac", () => {
    const conta = doMac("conta");
    const lista = [
      conta,
      naVm("vm"),
      doMac("fila", { estado: "na_fila" }),
      trabalho("qualquer", { maquina: null }),
      trabalho("sem-campo"),
      doMac("colega", { esperandoColega: { agenteId: "x", nome: "Chico", desde: AGORA } as never }),
      doMac("comando", { esperandoComando: { motivo: "a CI", desde: AGORA } }),
      doMac("hora", { acordaEm: AGORA + 60_000 }),
      trabalho("sem-contato", { maquina: { ...MAC, semContatoDesde: AGORA - 120_000 } }),
      doMac("pronto", { estado: "precisa_de_voce" }),
    ];
    expect(rodandoNoMac(lista).map((t) => t.id)).toEqual(["conta"]);
  });
});

describe("pilulaMemoria conta os que rodam no Mac", () => {
  it("'N rodando aqui' nas duas cores; com 0, nada", () => {
    expect(pilulaMemoria("amarela", 2)).toContain('<b>Pouca memória no seu Mac</b><span class="pm-detalhe">· 2 rodando aqui</span>');
    expect(pilulaMemoria("vermelha", 1)).toContain('<b>Seu Mac está quase sem memória</b><span class="pm-detalhe">· pode travar; 1 rodando aqui</span>');
    expect(pilulaMemoria("amarela", 0)).toBe("");
    expect(pilulaMemoria("vermelha", 0, false)).toBe("");
  });

  it("o servidor anterior (rótulo 'abertos') segue como antes, inclusive com 0", () => {
    expect(pilulaMemoria("amarela", 3, true, "abertos")).toContain("· 3 trabalhos abertos");
    expect(pilulaMemoria("amarela", 0, true, "abertos")).toContain("· 0 trabalhos abertos");
  });
});

describe("os cinco pontos com as máquinas no DTO (critérios 1–5 e 7)", () => {
  it("pressão amarela sem trabalho nenhum: sem pílula", () => {
    semMemoriaEmLugarNenhum(estadoCom(dtoCom([], "amarela")));
  });

  it("amarela e vermelha com trabalho só na VM: sem pílula (o caso do Marlon)", () => {
    const vm = [naVm("a"), naVm("b"), naVm("c")];
    semMemoriaEmLugarNenhum(estadoCom(dtoCom(vm, "amarela")));
    semMemoriaEmLugarNenhum(estadoCom(dtoCom(vm, "vermelha")));
  });

  it("trabalho na fila com maquina null: sem pílula", () => {
    semMemoriaEmLugarNenhum(estadoCom(dtoCom([trabalho("fila", { estado: "na_fila", maquina: null })], "vermelha")));
  });

  it("trabalho rodando no Mac em espera (colega, comando) ou o Mac na fila: sem pílula", () => {
    semMemoriaEmLugarNenhum(estadoCom(dtoCom([doMac("colega", { esperandoColega: { agenteId: "x", nome: "Chico", desde: AGORA } as never }), doMac("cmd", { esperandoComando: { motivo: "a CI", desde: AGORA } }), doMac("fila", { estado: "na_fila" })], "amarela")));
  });

  it("um rodando no Mac + outro na VM: pílula com '1 rodando aqui' nos cinco pontos", () => {
    const e = estadoCom(dtoCom([doMac("mac"), naVm("vm"), trabalho("fila", { estado: "na_fila", maquina: null })], "amarela"));
    const p = pontos(e);
    expect(p.todos).toContain('<span class="pm-detalhe">· 1 rodando aqui</span>');
    expect(p.porBot).toContain('<span class="pm-detalhe">· 1 rodando aqui</span>');
    expect(p.agora).toContain('<span class="atv-hora">Agora</span>');
    expect(p.agora).toContain("Pouca memória no seu Mac");
    expect(p.agora).toContain("1 rodando aqui");
    expect(p.agora).not.toContain("trabalhos abertos");
    expect(p.pilula).toEqual({ texto: "Pouca memória no seu Mac · 1 rodando aqui", nivel: "amarela", alvo: 'data-act="navegar" data-tela="trabalhos"' });
    expect(memoriaDoMac(e, "ada", C)).toMatchObject({ abertos: 3, rodandoAqui: 1 });
  });

  it("vermelha com dois no Mac: 'pode travar; 2 rodando aqui'", () => {
    const e = estadoCom(dtoCom([doMac("a"), doMac("b"), naVm("vm")], "vermelha"));
    const p = pontos(e);
    expect(p.todos).toContain("· pode travar; 2 rodando aqui");
    expect(p.porBot).toContain("· pode travar; 2 rodando aqui");
    expect(p.pilula?.texto).toBe("Seu Mac está quase sem memória · pode travar; 2 rodando aqui");
    expect(p.pilula?.nivel).toBe("vermelha");
  });

  it("a pílula do bot e o 'Agora' contam só os do bot rodando no Mac (o de outro bot no Mac não conta para a Ada)", () => {
    const e = estadoCom(dtoCom([naVm("da-ada"), doMac("do-chico", { agenteId: "chico", conversaId: "c-chico" })], "amarela"));
    const p = pontos(e);
    expect(p.todos).toContain("· 1 rodando aqui");
    expect(p.pilula).toBeNull();
    expect(p.agora).not.toContain('<span class="atv-hora">Agora</span>');
  });
});

describe("disco e máquinas como hoje (critério 6)", () => {
  it("disco crítico sem trabalho no Mac: o aviso de disco segue no topo, na 'Agora' e na pílula do bot", () => {
    const disco = { livreMb: 1_000, totalMb: 30_000, nivel: "vermelha" as const, alertaMb: 10_240, criticoMb: 3_072 };
    const e = estadoCom(dtoCom([naVm("vm", { esperaDoMac: "disco" })], "amarela", { mac: { motivoEspera: "disco", seguraTudoNovo: true, disco } }));
    const p = pontos(e);
    expect(p.todos).toContain("Pouco espaço no disco");
    expect(p.porBot).toContain("Pouco espaço no disco");
    expect(p.agora).toContain("Pouco espaço no disco do seu Mac");
    expect(memoriaDoMac(e, "ada", C)).toMatchObject({ disco: true, nivel: "vermelha", abertos: 1, rodandoAqui: 0 });
    // Revisão do PR #537: a pílula do bot (e o ponto na fala, que lê dela) sumia com o disco cheio e nada rodando no Mac.
    expect(p.pilula).toMatchObject({ nivel: "vermelha", texto: "Pouco espaço no disco do seu Mac · nenhuma task nova começa" });
    expect(p.todos).not.toContain("Pouca memória");
  });

  it("disco crítico com o trabalho do bot parado na fila do Mac: a pílula do bot mostra o disco", () => {
    const disco = { livreMb: 1_000, totalMb: 30_000, nivel: "vermelha" as const, alertaMb: 10_240, criticoMb: 3_072 };
    const e = estadoCom(dtoCom([doMac("fila", { estado: "na_fila", esperaDoMac: "disco" })], "verde", { mac: { motivoEspera: "disco", seguraTudoNovo: true, disco } }));
    expect(memoriaNaPilula(e, "ada", C)).toMatchObject({ nivel: "vermelha", texto: "Pouco espaço no disco do seu Mac · nenhuma task nova começa" });
  });

  it("o Mac segurando por memória com tudo na VM: nem a de memória nem o 'Seu Mac está ocupado' (revisão do PR #537)", () => {
    const e = estadoCom(dtoCom([naVm("vm")], "amarela", { mac: { motivoEspera: "memoria" } }));
    const p = pontos(e);
    expect(p.todos).not.toContain("pilula-memoria");
    expect(p.porBot).not.toContain("pilula-memoria");
  });

  it("o Mac segurando por memória um trabalho que espera por ele: o 'Seu Mac está ocupado' segue", () => {
    const e = estadoCom(dtoCom([naVm("vm"), doMac("espera", { estado: "na_fila", seguravel: true, esperaDoMac: "memoria" })], "amarela", { mac: { motivoEspera: "memoria" } }));
    const p = pontos(e);
    expect(p.todos).toContain("Seu Mac está ocupado");
    expect(p.porBot).toContain("Seu Mac está ocupado");
    expect(p.todos).not.toContain("Pouca memória");
  });

  it("só o Mac que segura por memória sai: por processador, ou a VM por memória, a pílula das máquinas segue (QA do PR #537)", () => {
    const porProcessador = pontos(estadoCom(dtoCom([naVm("vm")], "verde", { mac: { processador: "vermelha", motivoEspera: "processador" } })));
    expect(porProcessador.todos).toContain("Seu Mac está ocupado");
    const vmPorMemoria = pontos(estadoCom(dtoCom([naVm("vm")], "amarela", { mac: { motivoEspera: "memoria" }, vm: { pressao: "amarela", motivoEspera: "memoria" } })));
    expect(vmPorMemoria.todos).toContain("nod-motor-teste está com pouca memória");
    expect(vmPorMemoria.todos).not.toContain("máquinas ocupadas");
    expect(vmPorMemoria.porBot).toContain("nod-motor-teste está com pouca memória");
  });

  it("o que espera a VM não segura o Mac na pílula: fica só a da VM, não '2 máquinas ocupadas'", () => {
    const e = estadoCom(dtoCom([naVm("espera", { estado: "na_fila", seguravel: true, esperaDoMac: "processador" })], "amarela", { mac: { motivoEspera: "memoria" }, vm: { processador: "vermelha", motivoEspera: "processador" } }));
    const p = pontos(e);
    expect(p.todos).toContain("nod-motor-teste está ocupada");
    expect(p.todos).not.toContain("máquinas ocupadas");
  });

  it("o servidor anterior (sem máquinas no DTO): os dois topos seguem contando os abertos", () => {
    const sem = (ts: TrabalhoDto[]): Estado => estadoCom({ trabalhos: ts, pressao: "amarela", memoriaTotalMb: null, donos: [] });
    const um = pontos(sem([naVm("vm")]));
    expect(um.todos).toContain("· 1 trabalho aberto");
    expect(um.porBot).toContain("· 1 trabalho aberto");
    const zero = pontos(sem([]));
    expect(zero.todos).toContain("· 0 trabalhos abertos");
    expect(zero.porBot).toContain("· 0 trabalhos abertos");
  });

  it("a VM segurando trabalho: a pílula das máquinas aparece mesmo sem memória no Mac", () => {
    const e = estadoCom(dtoCom([naVm("a", { estado: "na_fila", esperaDoMac: "processador" })], "amarela", { vm: { processador: "vermelha", motivoEspera: "processador" } }));
    const p = pontos(e);
    expect(p.todos).toContain("nod-motor-teste está ocupada");
    expect(p.porBot).toContain("nod-motor-teste está ocupada");
    expect(p.todos).not.toContain("Pouca memória");
  });
});
