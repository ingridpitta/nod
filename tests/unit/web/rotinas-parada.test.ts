import { describe, expect, it } from "vitest";
import type { RotinaDto, SuaVezDto } from "../../../src/contracts/api.ts";
import type { Proposta } from "../../../src/contracts/conversa.ts";
import type { BloqueioRotina } from "../../../src/contracts/rotina.ts";
import { estadoInicial, type ConversaEstado, type Estado } from "../../../web/estado/reducer.ts";
import { linhaOndeRoda, motivoDaExecucao, rotuloDoDesfecho, rotuloExecucao } from "../../../web/lib/execucao.ts";
import { desdeQuando, listaDeJanelas, quandoCurto } from "../../../web/lib/relogio.ts";
import { renderTimeline } from "../../../web/telas/conversa.ts";
import { renderDetalhes } from "../../../web/telas/detalhes.ts";
import { renderRotinas } from "../../../web/telas/rotinas.ts";
import { renderSuaVez, rotinasParadasPorAgente, SUBTITULO_ROTINA_PARADA } from "../../../web/telas/sua-vez.ts";

/**
 * Emenda da ADR-044, "rotina se trava sozinha": a rotina que o pré-voo parou diz, na lista, no painel,
 * no card e na barra lateral, que está PARADA, por falta de qual app, desde quando e o que não rodou —
 * e oferece o mesmo botão de um clique.
 */
const TZ = "America/Sao_Paulo";
const AGORA = Date.parse("2026-09-24T09:30:00-03:00");
const ONTEM_13 = Date.parse("2026-09-23T13:00:00-03:00");
const ONTEM_18 = Date.parse("2026-09-23T18:00:00-03:00");
const HOJE_8 = Date.parse("2026-09-24T08:00:00-03:00");
const H = 3_600_000;

const bloqueio: BloqueioRotina = { motivo: "sem_acesso", app: "Gmail", slug: "gmail", decisaoId: "d1", rodaNaHora: true, desde: ONTEM_13, naoRodaram: [HOJE_8, ONTEM_18, ONTEM_13], fusoIana: TZ };
const rotina = { id: "r1", tenantId: "t", ownerId: "p", agenteId: "a1", conversaId: "c1", instrucao: "E-mails às 8h, 13h e 18h", cron: "0 8,13,18 * * *", fusoIana: TZ, estado: "ativa", exigeAprovacao: true, fonte: "Gmail", entregavel: "resumo", limitesAprovacao: "", politicaSemDado: "", proximaExecucao: AGORA + H, criadoEm: 0, excluidoEm: null, acessos: null, gatilho: "horario", provedor: null, eventos: null } as const;
const dto = (b: BloqueioRotina | null): RotinaDto => ({ rotina: { ...rotina }, proximaExecucao: AGORA + H, bloqueio: b, resumo: `todo dia às 08:00, 13:00, 18:00 (${TZ})`, espera: null });
const agente = { id: "a1", tenantId: "t", ownerId: "p", nome: "Nina", titulo: "E-mails", descricao: "", descricaoEstado: "", cor: "c-black", forma: "quadrado", conversaId: "c1", confirmado: true, fixado: false, oculto: false, naoLido: false, secao: null } as never;

describe("relógio: o dia de calendário da rotina", () => {
  it("hoje, ontem e a data — no fuso da rotina, não em UTC", () => {
    expect(quandoCurto(HOJE_8, AGORA, TZ)).toBe("hoje 08:00");
    expect(quandoCurto(ONTEM_13, AGORA, TZ)).toBe("ontem 13:00");
    expect(quandoCurto(Date.parse("2026-09-22T18:00:00-03:00"), AGORA, TZ)).toBe("22/09 18:00");
    // 23:30 em São Paulo já é o dia seguinte em UTC: continua "ontem" para quem lê.
    expect(quandoCurto(Date.parse("2026-09-23T23:30:00-03:00"), AGORA, TZ)).toBe("ontem 23:30");
    expect(desdeQuando(ONTEM_13, AGORA, TZ)).toBe("desde ontem 13:00");
  });

  it("a lista sai em ordem; passou do máximo, conta e dá as pontas", () => {
    expect(listaDeJanelas([HOJE_8, ONTEM_13, ONTEM_18], AGORA, TZ)).toBe("ontem 13:00, ontem 18:00 e hoje 08:00");
    expect(listaDeJanelas([HOJE_8], AGORA, TZ)).toBe("hoje 08:00");
    const muitas = Array.from({ length: 9 }, (_, i) => HOJE_8 - i * 5 * 60_000);
    expect(listaDeJanelas(muitas, AGORA, TZ)).toBe("9 janelas, de hoje 07:20 a hoje 08:00");
  });
});

describe("histórico: a janela parada", () => {
  it("'parada (sem acesso)', 'parada (sem conexão)', 'parada (aguardando resposta)'; os outros desfechos não mudam", () => {
    expect(rotuloExecucao({ desfecho: "bloqueada", motivo: "sem_acesso" })).toBe("parada (sem acesso)");
    // NOD-317: a janela antiga que o "só com pendência" pulou ainda está no histórico; sai com o nome do desfecho, sem o motivo.
    expect(rotuloExecucao({ desfecho: "sem_novidade", motivo: "sem_pendencia" })).toBe("sem novidade");
    expect(rotuloExecucao({ desfecho: "bloqueada", motivo: "sem_conexao" })).toBe("parada (sem conexão)");
    expect(rotuloExecucao({ desfecho: "bloqueada", motivo: "aguardando_resposta" })).toBe("parada (aguardando resposta)");
    expect(rotuloExecucao({ desfecho: "passou_em_branco", motivo: "ninguem_respondeu_o_gate" })).toBe("passou em branco");
  });

  it("NOD-317 (PR 2): o motivo antigo 'sem_pendencia' segue no histórico como texto livre e renderiza sem quebrar em qualquer desfecho", () => {
    expect(motivoDaExecucao({ motivo: "sem_pendencia" })).toBe("sem_pendencia");
    expect(rotuloExecucao({ desfecho: "sem_novidade", motivo: "sem_pendencia" })).toBe("sem novidade");
    expect(rotuloExecucao({ desfecho: "nao_rodou", motivo: "sem_pendencia" })).toBe("não rodou · sem_pendencia");
    expect(rotuloExecucao({ desfecho: "bloqueada", motivo: "sem_pendencia" })).toBe("parada (sem_pendencia)");
  });
});

describe("lista de rotinas e painel do bot", () => {
  it("a rotina parada leva a tag âmbar com o app, desde quando, o que não rodou e 'Permitir e rodar agora'", () => {
    const html = renderRotinas({ ...estadoInicial, agora: AGORA, rotinas: [dto(bloqueio)], execucoes: { r1: [{ tenantId: "t", id: "e1", rotinaId: "r1", instanteAgendado: HOJE_8, turnoId: null, desfecho: "bloqueada", motivo: "sem_acesso", em: HOJE_8 }] } });
    expect(html).toContain('<span class="tag tag-ambar" title="a rotina não roda até você liberar; nenhuma janela parada gastou crédito">parada · falta acesso ao Gmail</span>');
    expect(html).toContain("Parada desde ontem 13:00.");
    expect(html).toContain("Não rodaram: ontem 13:00, ontem 18:00 e hoje 08:00. Nenhuma tentativa gastou crédito.");
    expect(html).toContain('data-act="decidir-proposta" data-id="d1">Permitir e rodar agora');
    expect(html).toContain("<b>parada (sem acesso)</b>");
    expect(html).not.toContain("· sem_acesso");
  });

  it("sem conexão: a tag diz o que conectar e o botão é o 'Conectar' do app; sem bloqueio, nada disso", () => {
    const html = renderRotinas({ ...estadoInicial, agora: AGORA, rotinas: [dto({ ...bloqueio, motivo: "sem_conexao", decisaoId: null })] });
    expect(html).toContain("parada · falta conectar o Gmail");
    expect(html).toContain('data-act="abrir-conexao" data-id="gmail">Conectar');
    // O card é um por agente e app: sendo de OUTRA rotina do bot, permitir não roda esta na hora.
    const deOutra = renderRotinas({ ...estadoInicial, agora: AGORA, rotinas: [dto({ ...bloqueio, rodaNaHora: false })] });
    expect(deOutra).toContain('data-act="decidir-proposta" data-id="d1" title="o pedido é de outra rotina deste bot; esta roda na próxima janela">Permitir acesso');
    expect(deOutra).not.toContain("Permitir e rodar agora");
    const livre = renderRotinas({ ...estadoInicial, agora: AGORA, rotinas: [dto(null)] });
    expect(livre).not.toContain("parada");
    expect(livre).not.toContain("Permitir e rodar agora");
  });

  // ADR-125 (NOD-349): no painel, a parada é uma linha neutra (ícone de alerta, sem a tag colorida) com o mesmo botão.
  it("o painel do bot mostra a parada numa linha neutra e o mesmo botão na linha da rotina (só para a dona)", () => {
    const e = { ...estadoInicial, agora: AGORA, sessao: { tenantId: "t", pessoaId: "p" }, tela: { tipo: "conversa" as const, conversaId: "c1", agenteId: "a1" }, frota: { agentes: [agente], negacoes: [] } as never, rotinas: [dto(bloqueio)] };
    const html = renderDetalhes(e);
    expect(html).toContain('class="gvn-parada"');
    expect(html).toContain("Falta acesso ao Gmail desde ontem 13:00.");
    expect(html).not.toContain("tag-ambar");
    expect(html).toContain('<span class="gvn-estado">Parada</span>');
    expect(html).toContain('data-act="decidir-proposta" data-id="d1">Permitir e rodar agora');
    expect(renderDetalhes({ ...e, sessao: { tenantId: "t", pessoaId: "outra" } })).not.toContain("Permitir e rodar agora");
  });
});

describe("o card do acesso que a rotina pediu", () => {
  type Item = SuaVezDto["itens"][number];
  const FRASE = "Nina precisa ler seu Gmail para a rotina “E-mails às 8h, 13h e 18h”. Não inclui: enviar, apagar, arquivar.";
  const proposta: Proposta = { tenantId: "t", id: "d1", conversaId: "c1", agenteId: "a1", estado: "pendente", criadoEm: ONTEM_13, kind: "acesso", payload: { kind: "acesso", conector: "gmail", capacidades: ["GMAIL_FETCH_EMAILS"], nivel: "leitura", naoPedido: [], rotinaId: "r1", geracao: 0 } };
  const item = (p: Proposta | null, parada: Item["rotinaParada"], estadoColuna: Item["estadoColuna"] = "pendente"): Item => ({
    decisao: { tenantId: "t", id: "d1", ownerId: "p", decisorId: "p", agenteId: "a1", conversaId: "c1", turnoId: null, tipo: "acesso", estado: estadoColuna === "vencido" ? "vencida" : "pendente", prazoDecisaoEm: new Date(AGORA + 18 * H).toISOString(), prazoExecucaoEm: null, frase: FRASE, desfecho: null, vistaEm: null, criadoEm: new Date(ONTEM_13).toISOString(), fioId: null },
    estadoColuna, agenteNome: "Nina", aguardandoHaMs: 6 * H, recusaAutomaticaEmMs: 18 * H, gemeas: [], itensAprovacao: [], proposta: p, fio: null, rotinaParada: parada,
  });
  const com = (i: Item): Estado => ({ ...estadoInicial, agora: AGORA, sessao: { tenantId: "t", pessoaId: "p" }, suaVez: { itens: [i], incidentes: [], foraDoAr: [], vazio: false, ultimaDecisaoEm: null } });
  const parada = { desde: ONTEM_13, naoRodaram: [HOJE_8, ONTEM_18, ONTEM_13], fusoIana: TZ };

  it("'Sua vez': tag 'rotina parada' + desde, a linha do que não rodou e 'a rotina pausa sozinha em 18h'", () => {
    const html = renderSuaVez(com(item(proposta, parada)));
    expect(html).toContain(">rotina parada</span><span class=\"mudo\">desde ontem 13:00</span>");
    expect(html).toContain("Não rodaram: ontem 13:00, ontem 18:00 e hoje 08:00. Nenhuma tentativa gastou crédito.");
    expect(html).toContain("a rotina pausa sozinha em 18h");
    expect(html).not.toContain("recusa automática");
    expect(html).toContain("Permitir e rodar agora");
  });

  it("pedido da CONVERSA segue com 'recusa automática' e sem tag; o vencido não diz que está parada", () => {
    const daConversa: Proposta = { ...proposta, payload: { kind: "acesso", conector: "gmail", capacidades: ["GMAIL_FETCH_EMAILS"], nivel: "leitura", naoPedido: [], turnoId: "t1" } };
    const html = renderSuaVez(com(item(daConversa, null)));
    expect(html).toContain("recusa automática em 18h");
    expect(html).not.toContain("rotina parada");
    const vencido = renderSuaVez(com(item(proposta, null, "vencido")));
    expect(vencido).not.toContain("rotina parada");
    expect(vencido).not.toContain("Não rodaram");
  });

  it("no chat, o card de um clique leva a mesma tag, o desde e a linha", () => {
    const conversa: ConversaEstado = { conversa: { tenantId: "t", id: "c1", ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a1", salaId: null, sessaoCli: null, criadoEm: 0 }, mensagens: [], propostas: [proposta], turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], fios: [], carregadaEm: 0 };
    const html = renderTimeline(conversa, com(item(proposta, parada)));
    expect(html).toMatch(/<p class="cp-marcas"><span class="tag tag-ambar dec-rotina-parada"/);
    expect(html).toContain("desde ontem 13:00");
    expect(html).toContain("Não rodaram: ontem 13:00, ontem 18:00 e hoje 08:00. Nenhuma tentativa gastou crédito.");
    expect(html).toContain("Permitir e rodar agora");
  });

  it("barra lateral: 'rotina parada' só para o agente com um pedido de rotina ABERTO", () => {
    expect([...rotinasParadasPorAgente(com(item(proposta, parada)))]).toEqual(["a1"]);
    expect(rotinasParadasPorAgente(com(item(proposta, parada, "vencido"))).size).toBe(0);
    expect(rotinasParadasPorAgente(com(item({ ...proposta, payload: { ...proposta.payload, rotinaId: undefined } } as Proposta, null))).size).toBe(0);
    expect(SUBTITULO_ROTINA_PARADA).toBe('<span class="sub-rotina-parada">rotina parada</span>');
  });
});

// Regression: lacuna de mutação no re-QA do #335 — a tag "esperando" do cabeçalho (A4 do Gil) não tinha teste de render
// (tirar a tag ou mostrá-la na rotina pausada/parada passava). Found by /qa on 2026-10-16.
describe("lista de rotinas: a rotina que espera (NOD-243, A4 do Gil no #335)", () => {
  const espera = { motivo: "execucao_anterior_aberta", seguidas: 3, desde: ONTEM_13, frente: null } as const;
  const comEspera = (estado: "ativa" | "pausada", b: BloqueioRotina | null): RotinaDto => ({ ...dto(b), rotina: { ...rotina, estado }, espera });
  const cab = (html: string) => html.match(/<div class="rt-cab">[\s\S]*?<\/div>/)?.[0] ?? "";

  it("ativa e adiada: a tag âmbar 'esperando' no cabeçalho, junto da linha que explica", () => {
    const html = renderRotinas({ ...estadoInicial, agora: AGORA, rotinas: [comEspera("ativa", null)] });
    expect(cab(html)).toContain('<span class="tag tag-ambar"');
    expect(cab(html)).toContain(">esperando</span>");
    expect(html).toContain("Esperando a execução anterior terminar · 3 janelas adiadas desde ontem 13:00.");
  });

  it("pausada ou parada: sem a tag nem a linha — a pausa e a parada já dizem por que não roda", () => {
    for (const html of [
      renderRotinas({ ...estadoInicial, agora: AGORA, rotinas: [comEspera("pausada", null)] }),
      renderRotinas({ ...estadoInicial, agora: AGORA, rotinas: [comEspera("ativa", bloqueio)] }),
    ]) {
      expect(cab(html)).not.toContain(">esperando</span>");
      expect(html).not.toContain("Esperando a execução anterior");
    }
  });

  it("sem espera: sem a tag", () => {
    expect(cab(renderRotinas({ ...estadoInicial, agora: AGORA, rotinas: [dto(null)] }))).not.toContain(">esperando</span>");
  });
});

describe("NOD-89 (corte 1): onde a rotina roda, o atalho e os rótulos", () => {
  const noMac: NonNullable<RotinaDto["ondeRoda"]> = { modo: "maquina", maquina: { id: "k1", nome: "MacBook da Bia", plataforma: "darwin" }, dependeDoMac: true };
  const naVm: NonNullable<RotinaDto["ondeRoda"]> = { modo: "maquina", maquina: { id: "k2", nome: "vm-sp", plataforma: "linux" }, dependeDoMac: false };
  const qualquerComLinux: NonNullable<RotinaDto["ondeRoda"]> = { modo: "qualquer", maquina: null, dependeDoMac: false };
  const com = (ondeRoda: RotinaDto["ondeRoda"]): RotinaDto => ({ ...dto(null), ...(ondeRoda ? { ondeRoda } : {}) });
  const ATALHO = 'data-act="conectar-sempre-ligada"';
  const vezes = (html: string, trecho: string) => html.split(trecho).length - 1;
  const base = { ...estadoInicial, agora: AGORA, frota: { agentes: [agente], negacoes: [] } as never };
  const exec = (desfecho: string, motivo: string | null, em = HOJE_8) => ({ id: `e${em}`, rotinaId: "r1", desfecho, motivo, em, instanteAgendado: em }) as never;
  const nivel = (ondeRoda: RotinaDto["ondeRoda"], execucoes: never[]) => renderDetalhes({ ...base, tela: { tipo: "conversa", conversaId: "c1", agenteId: "a1" }, rotinas: [com(ondeRoda)], execucoes: { r1: execucoes }, gaveta: { agenteId: "a1", nivel: { tipo: "rotina", id: "r1" } } });

  it("Mac: 'Roda em <Mac> · só com o Mac ligado e o nod aberto' com o atalho; a linha sem atalho fica só texto", () => {
    const html = linhaOndeRoda(noMac, { comAtalho: true });
    expect(html).toContain("Roda em <b>MacBook da Bia</b>");
    expect(html).toContain("só com o Mac ligado e o nod aberto");
    expect(html).toContain(`${ATALHO}>Conectar uma máquina sempre ligada`);
    expect(linhaOndeRoda(noMac)).not.toContain(ATALHO);
    expect(linhaOndeRoda(noMac, { plural: true })).toContain("Rodam em <b>MacBook da Bia</b>");
  });

  it("Linux: 'Roda em <VM>', sem aviso nem atalho; 'qualquer' com Linux: a primeira máquina ligada", () => {
    const vm = linhaOndeRoda(naVm, { comAtalho: true });
    expect(vm).toContain("Roda em <b>vm-sp</b>");
    expect(vm).not.toContain("só com o Mac");
    expect(vm).not.toContain(ATALHO);
    const qualquer = linhaOndeRoda(qualquerComLinux, { comAtalho: true });
    expect(qualquer).toContain("Roda na primeira máquina sua que estiver ligada");
    expect(qualquer).not.toContain(ATALHO);
    expect(linhaOndeRoda({ modo: "qualquer", maquina: null, dependeDoMac: true })).toContain("Roda em <b>seu Mac</b>");
    expect(linhaOndeRoda(undefined)).toBe("");
  });

  it("tela Rotinas: linha por rotina e o atalho uma vez só, na intro; sem rotina no Mac, a frase do 'nod aberto' sai", () => {
    const mac = renderRotinas({ ...base, rotinas: [com(noMac), { ...com(noMac), rotina: { ...rotina, id: "r2" } }] });
    expect(vezes(mac, "Roda em <b>MacBook da Bia</b>")).toBe(2);
    expect(vezes(mac, ATALHO)).toBe(1);
    expect(mac).toContain("O nod precisa estar aberto");
    const vm = renderRotinas({ ...base, rotinas: [com(naVm)] });
    expect(vm).toContain("Roda em <b>vm-sp</b>");
    expect(vm).not.toContain(ATALHO);
    expect(vm).not.toContain("O nod precisa estar aberto");
    // Sem `ondeRoda` (modo local, rotina de outra pessoa): a frase de sempre, sem linha.
    const local = renderRotinas({ ...base, rotinas: [com(undefined)] });
    expect(local).toContain("O nod precisa estar aberto");
    expect(local).not.toContain("Roda em");
  });

  it("gaveta: 'Rodam em' abaixo de Rotinas, com o atalho uma vez", () => {
    const html = renderDetalhes({ ...base, tela: { tipo: "conversa", conversaId: "c1", agenteId: "a1" }, rotinas: [com(noMac)] });
    expect(html).toContain("Rodam em <b>MacBook da Bia</b>");
    expect(vezes(html, ATALHO)).toBe(1);
  });

  it("nível da rotina: o não rodou por máquina sem contato leva o atalho embaixo; a linha 'Roda em' fica só texto", () => {
    const falhou = nivel(noMac, [exec("nao_rodou", "maquina_sem_contato"), exec("executou", null, ONTEM_18)]);
    expect(falhou).toContain(`<span class="exec-acao"><button type="button" class="gv-link" ${ATALHO}>`);
    expect(vezes(falhou, ATALHO)).toBe(1);
    expect(falhou).toContain("Roda em <b>MacBook da Bia</b>");
    // A execução mais recente rodou: o atalho volta para a linha "Roda em".
    const ok = nivel(noMac, [exec("executou", null), exec("nao_rodou", "maquina_sem_contato", ONTEM_18)]);
    expect(vezes(ok, ATALHO)).toBe(1);
    expect(ok).not.toContain('class="exec-acao"');
    // Alvo Linux: nem na execução nem na linha.
    expect(nivel(naVm, [exec("nao_rodou", "maquina_sem_contato")])).not.toContain(ATALHO);
    // Não rodou por outro motivo (cota da IA): conectar outra máquina não resolve; o atalho fica na linha "Roda em".
    const cota = nivel(noMac, [exec("nao_rodou", "cota_da_ia")]);
    expect(cota).not.toContain('class="exec-acao"');
    expect(vezes(cota, ATALHO)).toBe(1);
  });

  it("rótulos: 'concluída' e nenhum desfecho cru no histórico", () => {
    expect(rotuloExecucao({ desfecho: "executou", motivo: null })).toBe("concluída");
    expect(rotuloDoDesfecho("passou_em_branco")).toBe("passou em branco");
    expect(rotuloDoDesfecho("desfecho_novo")).toBe("desfecho novo");
    const desfechos = ["executou", "passou_em_branco", "sem_novidade", "falhou", "interrompida", "adiada"];
    const lista = renderRotinas({ ...base, rotinas: [com(noMac)], execucoes: { r1: desfechos.map((d, i) => exec(d, null, HOJE_8 - i * H)) } });
    expect(lista).toContain("<b>concluída</b>");
    const nv = nivel(noMac, desfechos.slice(0, 5).map((d, i) => exec(d, null, HOJE_8 - i * H)));
    for (const html of [lista, nv]) for (const d of desfechos.filter((x) => x.includes("_") || x === "executou")) expect(html).not.toMatch(new RegExp(`>${d}<`));
  });
});
