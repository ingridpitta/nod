import { describe, expect, it } from "vitest";
import type { ConversaDto } from "../../../src/contracts/api.ts";
import type { DonoDto } from "../../../src/contracts/dono.ts";
import type { TrabalhosDto } from "../../../src/contracts/trabalho.ts";
import { aplicarFrame, estadoInicial, invalidacoesAoReconectar, reduzir, type Estado, type TurnoVivo } from "../../../web/estado/reducer.ts";
import { JANELA_PENSANDO_MS, estadoMascoteNaConversa, htmlMascote, mascoteComAviso, proximaViradaDoMascote, turnosVivosDaConversa } from "../../../web/lib/mascote.ts";
import { blocosAoVivo, renderCabecalhoConversa } from "../../../web/telas/conversa.ts";
import { FALA_SAINDO_MS } from "../../../web/lib/fala-viva.ts";

/**
 * NOD-216: mascote animado e "na fila · há 6h" por turnos que o servidor já não tem. Só o turno rodando anima; a fila
 * fica parada (exceto o pedido recém-chegado, que pensa); e a web tira o turno vivo que a leitura do servidor desmente.
 */
const C = "c1";
const OUTRA = "c2";
const AGORA = Date.parse("2026-10-13T12:00:00Z");
const H = 3_600_000;

const vivo = (turnoId: string, extra: Partial<TurnoVivo> = {}): TurnoVivo => ({ turnoId, conversaId: C, estado: "na_fila", executor: null, machineId: null, desde: AGORA - 6 * H, ...extra });

function conversa(id = C, turnosEmCurso: ConversaDto["turnosEmCurso"] = []): ConversaDto {
  return {
    conversa: { tenantId: "t", id, ownerId: "p", visibility: "privado", tipo: "propria", agenteId: id === C ? "a" : "b", salaId: null, sessaoCli: null, criadoEm: 1 } as never,
    mensagens: [], turnosPendentes: [], turnosEmCurso, turnosCancelados: [], propostas: [], fios: [],
  };
}

function base(turnosVivos: Record<string, TurnoVivo> = {}): Estado {
  return {
    ...estadoInicial, agora: AGORA, sessao: { pessoaId: "p", tenantId: "t" } as never,
    frota: { agentes: [{ id: "a", nome: "Ada", conversaId: C, cor: "c-blue", forma: "shape-square" }, { id: "b", nome: "Bia", conversaId: OUTRA, cor: "c-red", forma: "shape-hex" }] } as never,
    turnosVivos,
  };
}

const dono = (agenteId: string, o: { conversaTrabalhando?: boolean; conversaPropriaTrabalhando?: boolean; fila?: string[] } = {}): DonoDto => ({
  estado: { agenteId, principal: "livre", frentes: 0, conversaTrabalhando: o.conversaTrabalhando ?? false, ...(o.conversaPropriaTrabalhando === undefined ? {} : { conversaPropriaTrabalhando: o.conversaPropriaTrabalhando }), esperandoVoce: 0, esperando: 0, fila: o.fila?.length ?? 0, motivoEspera: null, desde: null },
  esperas: [],
  fila: (o.fila ?? []).map((turnoId) => ({ turnoId, de: "rotina" as const, nome: null, desde: AGORA - 6 * H })),
});
const trabalhos = (donos: DonoDto[]): TrabalhosDto => ({ trabalhos: [], pressao: null, memoriaTotalMb: null, donos }) as unknown as TrabalhosDto;

describe("mascote: só o turno rodando anima (NOD-216)", () => {
  it("na fila há horas fica parado, com 'na fila' no tooltip", () => {
    const e = base({ t1: vivo("t1") });
    expect(estadoMascoteNaConversa(e, C)).toBe("na_fila");
    const html = htmlMascote({ nome: "Ada", cor: "c-blue", forma: "shape-square" }, "", "na_fila");
    expect(html).toContain('state="idle"');
    expect(html).toContain('title="Ada · na fila"');
  });

  it("o pedido que acabou de entrar pensa por ~5 s; depois fica parado", () => {
    const e = base({ t1: vivo("t1", { desde: AGORA - 1000 }) });
    expect(estadoMascoteNaConversa(e, C)).toBe("pensando");
    expect(estadoMascoteNaConversa({ ...e, agora: AGORA - 1000 + JANELA_PENSANDO_MS }, C)).toBe("na_fila");
  });

  it("rodando anima; um bot nunca anima pelo turno de outra conversa nem pelo de uma task", () => {
    const e = base({ t1: vivo("t1", { estado: "rodando" }), t2: vivo("t2", { conversaId: OUTRA, estado: "rodando" }) });
    expect(estadoMascoteNaConversa(e, C)).toBe("trabalhando");
    expect(estadoMascoteNaConversa(base({ t2: vivo("t2", { conversaId: OUTRA, estado: "rodando" }) }), C)).toBe("disponivel");
    expect(estadoMascoteNaConversa(base({ t3: vivo("t3", { estado: "rodando", trabalhoId: "w1" }) }), C)).toBe("disponivel");
  });

  it("'Sua vez' ganha da fila parada", () => {
    const e = { ...base({ t1: vivo("t1") }), suaVez: { itens: [{ decisao: { conversaId: C }, estadoColuna: "aberta" }], incidentes: [] } } as unknown as Estado;
    expect(estadoMascoteNaConversa(e, C)).toBe("aguardando");
  });
});

describe("cabeçalho e ao vivo leem a mesma regra do mascote (NOD-216)", () => {
  const comConversa = (vivos: Record<string, TurnoVivo>): Estado => {
    const e = reduzir(base(), { tipo: "hidratar-conversa", conversa: conversa(C, Object.values(vivos).map((v) => ({ id: v.turnoId, estado: v.estado === "rodando" ? "despachando" as const : "pendente" as const, desde: v.desde, mensagemId: null }))), agora: AGORA });
    return { ...e, turnosVivos: vivos };
  };

  it("na fila há horas: presença 'Na fila', mascote parado, nada de 'Trabalhando'", () => {
    const cab = renderCabecalhoConversa(comConversa({ t1: vivo("t1") }), "a");
    expect(cab).toContain("Na fila");
    expect(cab).not.toContain("Trabalhando");
    expect(cab).toContain('data-estado="na_fila"');
    expect(cab).not.toContain('presenca ativa');
  });

  it("rodando: 'Trabalhando' e mascote animado", () => {
    const cab = renderCabecalhoConversa(comConversa({ t1: vivo("t1", { estado: "rodando" }) }), "a");
    expect(cab).toContain("Trabalhando");
    expect(cab).toContain('data-estado="trabalhando"');
  });

  it("o turno de uma task não diz 'Trabalhando' no cabeçalho da conversa", () => {
    const cab = renderCabecalhoConversa(comConversa({ t1: vivo("t1", { estado: "rodando", trabalhoId: "w1" }) }), "a");
    expect(cab).not.toContain("Trabalhando");
  });

  it("o cabeçalho ao vivo do turno na fila antiga não pensa", () => {
    const e = comConversa({ t1: vivo("t1") });
    const html = blocosAoVivo(e.conversas[C]!, e).map((b) => b.html).join("");
    expect(html).toContain("na fila");
    expect(html).not.toContain('data-estado="pensando"');
  });
});

describe("reconciliação dos turnos vivos (NOD-216)", () => {
  it("hidratar-conversa tira o vivo da conversa que o servidor não devolve mais, com a atividade dele", () => {
    let e = aplicarFrame(base(), { streamId: "s", seq: 1, pessoaId: "p", tipo: "turno.iniciado", dados: { conversaId: C, turnoId: "t1", kind: "turno_criado" } }, AGORA - 6 * H);
    e = reduzir(e, { tipo: "hidratar-conversa", conversa: conversa(), agora: AGORA });
    expect(e.turnosVivos.t1).toBeUndefined();
    expect(estadoMascoteNaConversa(e, C)).toBe("disponivel");
  });

  it("não tira o turno confirmado por um frame depois que a leitura saiu, nem o de task, nem o de outra conversa", () => {
    const e = reduzir(base({
      novo: vivo("novo", { vistoEm: AGORA + 10 }),
      task: vivo("task", { trabalhoId: "w1", vistoEm: AGORA - H }),
      fora: vivo("fora", { conversaId: OUTRA, vistoEm: AGORA - H }),
    }), { tipo: "hidratar-conversa", conversa: conversa(), agora: AGORA });
    expect(Object.keys(e.turnosVivos).sort()).toEqual(["fora", "novo", "task"]);
  });

  it("o GET que saiu antes do turno.encerrado não recria o turno", () => {
    let e = aplicarFrame(base(), { streamId: "s", seq: 1, pessoaId: "p", tipo: "turno.iniciado", dados: { conversaId: C, turnoId: "t1", kind: "turno_despachado" } }, AGORA);
    e = aplicarFrame(e, { streamId: "s", seq: 2, pessoaId: "p", tipo: "turno.encerrado", dados: { conversaId: C, turnoId: "t1" } }, AGORA + 1);
    e = reduzir(e, { tipo: "hidratar-conversa", conversa: conversa(C, [{ id: "t1", estado: "despachando", desde: AGORA, mensagemId: null }]), agora: AGORA - 5 });
    expect(e.turnosVivos.t1).toBeUndefined();
  });

  it("GET trabalhos: o dono desmente o turno da conversa fechada (barra) — rodando sem conversaTrabalhando, na fila fora da fila", () => {
    const e = base({
      roda: vivo("roda", { estado: "rodando", vistoEm: AGORA - H }),
      fila: vivo("fila", { vistoEm: AGORA - H, origem: "conversa" }),
      ficaNaFila: vivo("ficaNaFila", { vistoEm: AGORA - H, origem: "conversa" }),
      daBia: vivo("daBia", { conversaId: OUTRA, estado: "rodando", vistoEm: AGORA - H }),
      recente: vivo("recente", { estado: "rodando", vistoEm: AGORA + 1 }),
    });
    const depois = reduzir(e, { tipo: "hidratar-trabalhos", trabalhos: trabalhos([dono("a", { fila: ["ficaNaFila"] }), dono("b", { conversaTrabalhando: true })]), agora: AGORA });
    expect(Object.keys(depois.turnosVivos).sort()).toEqual(["daBia", "ficaNaFila", "recente"]);
    // Sem o momento da leitura (ou sem donos, servidor anterior), nada muda.
    expect(reduzir(e, { tipo: "hidratar-trabalhos", trabalhos: trabalhos([dono("a")]) }).turnosVivos).toBe(e.turnosVivos);
  });

  it("o stream que volta relê os trabalhos e as conversas carregadas", () => {
    const e = reduzir(base(), { tipo: "hidratar-conversa", conversa: conversa(), agora: AGORA });
    expect(invalidacoesAoReconectar(e)).toEqual(["trabalhos", "frota", "nao-lidos", `conversa:${C}`]);
    expect(invalidacoesAoReconectar(estadoInicial)).toEqual([]);
  });
});

describe("revisão do PR #302 (NOD-216)", () => {
  const leitura = (turnosEmCurso: ConversaDto["turnosEmCurso"], agora = AGORA) => ({ tipo: "hidratar-conversa" as const, conversa: conversa(C, turnosEmCurso), agora });

  it("GET trabalhos não tira o 'na fila' que já foi despachado (frame turno_despachado perdido): o bot está trabalhando", () => {
    const e = base({ t1: vivo("t1", { vistoEm: AGORA - H, origem: "conversa" }) });
    const depois = reduzir(e, { tipo: "hidratar-trabalhos", trabalhos: trabalhos([dono("a", { conversaTrabalhando: true })]), agora: AGORA });
    expect(depois.turnosVivos.t1).toBeDefined();
  });

  it("GET trabalhos não desmente o pendente de origem que a fila do dono não lista (retomada) nem o de origem desconhecida", () => {
    const e = base({ ret: vivo("ret", { vistoEm: AGORA - H, origem: "retomada" }), sem: vivo("sem", { vistoEm: AGORA - H }) });
    const depois = reduzir(e, { tipo: "hidratar-trabalhos", trabalhos: trabalhos([dono("a")]), agora: AGORA });
    expect(Object.keys(depois.turnosVivos).sort()).toEqual(["ret", "sem"]);
  });

  it("a origem vem do frame turno_criado e do TurnoEmCursoDto", () => {
    const f = aplicarFrame(base(), { streamId: "s", seq: 1, pessoaId: "p", tipo: "turno.iniciado", dados: { conversaId: C, turnoId: "t1", kind: "turno_criado", origem: "retomada" } }, AGORA);
    expect(f.turnosVivos.t1?.origem).toBe("retomada");
    const h = reduzir(base(), leitura([{ id: "t2", estado: "pendente", desde: AGORA, mensagemId: null, origem: "rotina" }]));
    expect(h.turnosVivos.t2?.origem).toBe("rotina");
  });

  it("NOD-348 (revisão do #508): a recarga guarda o bot do turno — na sala, a fala viva volta com o mascote de quem fala", () => {
    const h = reduzir(base(), leitura([{ id: "t2", estado: "despachando", desde: AGORA, mensagemId: null, agenteId: "bot-gil" }, { id: "t3", estado: "pendente", desde: AGORA, mensagemId: null }]));
    expect(h.turnosVivos.t2?.agenteId).toBe("bot-gil");
    expect(h.turnosVivos.t3?.agenteId).toBeNull();
  });

  it("a resposta mais velha não traz de volta o turno que uma leitura mais nova desmentiu", () => {
    const e = base({ t1: vivo("t1", { estado: "rodando", vistoEm: AGORA - H }) });
    const desmentido = reduzir(e, { tipo: "hidratar-trabalhos", trabalhos: trabalhos([dono("a")]), agora: AGORA });
    expect(desmentido.turnosVivos.t1).toBeUndefined();
    expect(desmentido.turnosDesmentidos.t1).toBe(AGORA);
    // O GET conversa que saiu ANTES (AGORA - 10) chega depois e ainda traz o turno: fica fora.
    const velha = reduzir(desmentido, leitura([{ id: "t1", estado: "despachando", desde: AGORA - H, mensagemId: null }], AGORA - 10));
    expect(velha.turnosVivos.t1).toBeUndefined();
    // Uma leitura que saiu DEPOIS e o traz de novo vale.
    const nova = reduzir(desmentido, leitura([{ id: "t1", estado: "despachando", desde: AGORA - H, mensagemId: null }], AGORA + 10));
    expect(nova.turnosVivos.t1).toBeDefined();
  });

  it("a conversa relida sem turnosEmCurso não apaga os turnos vivos", () => {
    const e = base({ t1: vivo("t1", { estado: "rodando", vistoEm: AGORA - H }) });
    const semCampo = { ...conversa(), turnosEmCurso: undefined } as unknown as ConversaDto;
    expect(reduzir(e, { tipo: "hidratar-conversa", conversa: semCampo, agora: AGORA }).turnosVivos.t1).toBeDefined();
  });

  it("a janela de 'pensando' conta do relógio da web (chegouEm), não do desde do servidor", () => {
    // Relógio da web 2 min atrasado: o `desde` do banco está no "futuro"; sem chegouEm a fila pensaria por 2 min.
    const h = reduzir(base(), leitura([{ id: "t1", estado: "pendente", desde: AGORA + 2 * 60_000, mensagemId: null }]));
    expect(h.turnosVivos.t1?.chegouEm).toBe(AGORA);
    expect(estadoMascoteNaConversa({ ...h, agora: AGORA + JANELA_PENSANDO_MS }, C)).toBe("na_fila");
    // O frame grava chegouEm na primeira vez e o mantém nas seguintes.
    let f = aplicarFrame(base(), { streamId: "s", seq: 1, pessoaId: "p", tipo: "turno.iniciado", dados: { conversaId: C, turnoId: "t2", kind: "turno_criado" } }, AGORA);
    f = aplicarFrame(f, { streamId: "s", seq: 2, pessoaId: "p", tipo: "turno.iniciado", dados: { conversaId: C, turnoId: "t2", kind: "turno_criado" } }, AGORA + 3000);
    expect(f.turnosVivos.t2?.chegouEm).toBe(AGORA);
  });

  it("proximaViradaDoMascote: o instante em que o 'pensando' vira 'na fila', para a web redesenhar na hora", () => {
    const e = base({ a1: vivo("a1", { chegouEm: AGORA - 1000 }), a2: vivo("a2", { chegouEm: AGORA - 3000 }), velho: vivo("velho"), roda: vivo("roda", { estado: "rodando", chegouEm: AGORA }) });
    expect(proximaViradaDoMascote(e, AGORA)).toBe(AGORA - 3000 + JANELA_PENSANDO_MS);
    expect(proximaViradaDoMascote(base({ velho: vivo("velho") }), AGORA)).toBeNull();
  });

  it("revisão 4 do #508: proximaViradaDoMascote também acorda quando a fala parada vence os 15 s", () => {
    const e = { ...base({ velho: vivo("velho") }), falasSaindo: { [C]: { k: { turnoId: "t1", em: AGORA - 5000, texto: "x" } } } } as unknown as Estado;
    expect(proximaViradaDoMascote(e, AGORA)).toBe(AGORA - 5000 + FALA_SAINDO_MS);
    const vencida = { ...e, falasSaindo: { [C]: { k: { turnoId: "t1", em: AGORA - FALA_SAINDO_MS - 1, texto: "x" } } } } as unknown as Estado;
    expect(proximaViradaDoMascote(vencida, AGORA)).toBeNull();
  });

  it("o stream que volta com a tela da task aberta relê a task", () => {
    const e = { ...base(), tela: { tipo: "trabalho", id: "w1", voltar: { tipo: "inicio" } } } as Estado;
    expect(invalidacoesAoReconectar(e)).toEqual(["trabalhos", "frota", "nao-lidos", "trabalho:w1"]);
  });

  it("mascoteComAviso: o aviso ganha do mascote parado (disponível ou na fila), nunca do animado", () => {
    expect(mascoteComAviso("disponivel", "pergunta")).toBe("aguardando");
    expect(mascoteComAviso("na_fila", "pergunta")).toBe("aguardando");
    expect(mascoteComAviso("trabalhando", "pergunta")).toBe("trabalhando");
    expect(mascoteComAviso("pensando", "pergunta")).toBe("pensando");
    expect(mascoteComAviso("na_fila", null)).toBe("na_fila");
  });

  it("turnosVivosDaConversa reusa o conjunto dos turnos de task da mesma leitura de GET trabalhos", () => {
    const t = { trabalhos: [{ turnoVivoId: "t1" }], pressao: null, memoriaTotalMb: null } as unknown as TrabalhosDto;
    const e = { ...base({ t1: vivo("t1", { estado: "rodando" }), t2: vivo("t2", { estado: "rodando" }) }), trabalhos: t };
    expect(turnosVivosDaConversa(e, C).map((v) => v.turnoId)).toEqual(["t2"]);
    expect(turnosVivosDaConversa({ ...e, trabalhos: { ...t, trabalhos: [] } }, C).map((v) => v.turnoId).sort()).toEqual(["t1", "t2"]);
  });
});

describe("QA do PR #302: reload com o bot trabalhando e a conversa dele fechada (NOD-216)", () => {
  // Visto no navegador: Lia rodando, Vera aberta, reload — a barra mostrava Lia "disponível" até a conversa dela abrir,
  // porque os turnos vivos só vinham da conversa carregada e `GET trabalhos` só desmente, nunca acrescenta.
  it("GET trabalhos com o bot trabalhando (ou com fila) pede a conversa dele, que traz o turno e anima a barra", () => {
    const e = reduzir(base(), { tipo: "hidratar-trabalhos", trabalhos: trabalhos([dono("a"), dono("b", { conversaTrabalhando: true })]), agora: AGORA });
    expect(e.invalidacoes).toContain(`vivos:${OUTRA}`);
    expect(e.invalidacoes).not.toContain(`vivos:${C}`);
    const depois = reduzir(e, { tipo: "hidratar-conversa", conversa: conversa(OUTRA, [{ id: "t9", estado: "despachando", desde: AGORA - 60_000, mensagemId: null }]), agora: AGORA });
    expect(estadoMascoteNaConversa(depois, OUTRA)).toBe("trabalhando");
    expect(estadoMascoteNaConversa(depois, C)).toBe("disponivel");
    const comFila = reduzir(base(), { tipo: "hidratar-trabalhos", trabalhos: trabalhos([dono("a", { fila: ["t1"] })]), agora: AGORA });
    expect(comFila.invalidacoes).toContain(`vivos:${C}`);
  });

  it("não pede de novo a conversa já carregada; e pede quando a frota chega depois de GET trabalhos", () => {
    const carregada = reduzir(base(), { tipo: "hidratar-conversa", conversa: conversa(OUTRA), agora: AGORA });
    const e = reduzir(carregada, { tipo: "hidratar-trabalhos", trabalhos: trabalhos([dono("b", { conversaTrabalhando: true })]), agora: AGORA });
    expect(e.invalidacoes.filter((q) => q.startsWith("vivos:"))).toEqual([]);
    const semFrota = reduzir({ ...base(), frota: null }, { tipo: "hidratar-trabalhos", trabalhos: trabalhos([dono("b", { conversaTrabalhando: true })]), agora: AGORA });
    expect(semFrota.invalidacoes.filter((q) => q.startsWith("vivos:"))).toEqual([]);
    const comFrota = reduzir(semFrota, { tipo: "hidratar-frota", frota: { ...base().frota, inventario: null } as never });
    expect(comFrota.invalidacoes).toContain(`vivos:${OUTRA}`);
  });
});

describe("o dono reconcilia só pela conversa PRÓPRIA do bot (NOD-219)", () => {
  // Em produção: o bot trabalhando numa sala (`conversaTrabalhando: true`) segurava o vivo morto da conversa própria dele.
  it("o turno da sala não segura o vivo da conversa própria: conversaPropriaTrabalhando false desmente", () => {
    const e = base({ roda: vivo("roda", { estado: "rodando", vistoEm: AGORA - H }), fila: vivo("fila", { vistoEm: AGORA - H, origem: "conversa" }) });
    const depois = reduzir(e, { tipo: "hidratar-trabalhos", trabalhos: trabalhos([dono("a", { conversaTrabalhando: true, conversaPropriaTrabalhando: false })]), agora: AGORA });
    expect(Object.keys(depois.turnosVivos)).toEqual([]);
  });

  it("conversaPropriaTrabalhando true mantém o vivo, mesmo que o servidor antigo diria outra coisa", () => {
    const e = base({ roda: vivo("roda", { estado: "rodando", vistoEm: AGORA - H }) });
    const depois = reduzir(e, { tipo: "hidratar-trabalhos", trabalhos: trabalhos([dono("a", { conversaTrabalhando: true, conversaPropriaTrabalhando: true })]), agora: AGORA });
    expect(Object.keys(depois.turnosVivos)).toEqual(["roda"]);
  });

  it("sem o campo novo (servidor de antes) vale conversaTrabalhando, como na NOD-216", () => {
    const e = base({ roda: vivo("roda", { estado: "rodando", vistoEm: AGORA - H }) });
    expect(Object.keys(reduzir(e, { tipo: "hidratar-trabalhos", trabalhos: trabalhos([dono("a", { conversaTrabalhando: true })]), agora: AGORA }).turnosVivos)).toEqual(["roda"]);
    expect(Object.keys(reduzir(e, { tipo: "hidratar-trabalhos", trabalhos: trabalhos([dono("a")]), agora: AGORA }).turnosVivos)).toEqual([]);
  });

  it("só pede a conversa própria quando ELA trabalha (ou há fila), não pelo turno da sala", () => {
    const soSala = reduzir(base(), { tipo: "hidratar-trabalhos", trabalhos: trabalhos([dono("b", { conversaTrabalhando: true, conversaPropriaTrabalhando: false })]), agora: AGORA });
    expect(soSala.invalidacoes).not.toContain(`vivos:${OUTRA}`);
    const propria = reduzir(base(), { tipo: "hidratar-trabalhos", trabalhos: trabalhos([dono("b", { conversaTrabalhando: true, conversaPropriaTrabalhando: true })]), agora: AGORA });
    expect(propria.invalidacoes).toContain(`vivos:${OUTRA}`);
  });
});
