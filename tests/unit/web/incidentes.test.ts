import { describe, expect, it } from "vitest";
import type { SuaVezDto } from "../../../src/contracts/api.ts";
import { estadoInicial, reduzir, type Estado } from "../../../web/estado/reducer.ts";
import { rotuloExecucao } from "../../../web/lib/execucao.ts";
import { renderDetalhes } from "../../../web/telas/detalhes.ts";
import { fraseDoIncidente, renderIncidentes } from "../../../web/telas/sua-vez.ts";

type Incidente = SuaVezDto["incidentes"][number];
const H = 3_600_000;
const T0 = Date.parse("2026-09-24T00:50:00-03:00");
const incidente = (extra: Partial<Incidente> = {}): Incidente => ({ id: "i1", tipo: "mac_sem_contato", comecouEm: T0, voltouEm: T0 + 5 * H, rotinas: 5, conversas: 0, agentes: ["Ada", "Taga"], ...extra });
const comAvisos = (incidentes: Incidente[]): Estado => ({ ...estadoInicial, suaVez: { itens: [], incidentes, foraDoAr: [], vazio: true, ultimaDecisaoEm: null } });

describe("aviso de queda do Mac (ADR-045): incidente não é decisão", () => {
  it("fechado: o intervalo, quantas execuções não concluíram, de quem, e o que segue sozinho", () => {
    const frase = fraseDoIncidente(incidente());
    expect(frase).toMatch(/^Seu Mac ficou sem contato entre \d{2}:\d{2} e \d{2}:\d{2}\. /);
    expect(frase).toContain("5 execuções de rotina não concluíram (Ada, Taga); nada foi reenviado e as próximas seguem agendadas.");
    expect(fraseDoIncidente(incidente({ rotinas: 1, agentes: ["Taga"] }))).toContain("1 execução de rotina não concluiu (Taga);");
  });

  it("em curso, só conversa, e misto: a frase diz o que a pessoa pode fazer", () => {
    expect(fraseDoIncidente(incidente({ voltouEm: null }))).toMatch(/^Seu Mac está sem contato desde \d{2}:\d{2}\. /);
    expect(fraseDoIncidente(incidente({ rotinas: 0, conversas: 1, agentes: ["Vera"] }))).toContain("1 resposta em conversa não concluiu (Vera); nada foi reenviado e dá para retomar pela conversa.");
    expect(fraseDoIncidente(incidente({ rotinas: 2, conversas: 1 }))).toContain("2 execuções de rotina e 1 resposta em conversa não concluíram (Ada, Taga); nada foi reenviado: as rotinas seguem agendadas e a conversa pode ser retomada.");
  });

  it("2026-10-09: a queda da VM do motor nomeia a máquina; sem o campo, é o Mac", () => {
    expect(fraseDoIncidente(incidente({ maquina: "nod-motor-teste", rotinas: 0, conversas: 2, agentes: ["Ze 1"] }))).toMatch(/^A máquina nod-motor-teste ficou sem contato entre \d{2}:\d{2} e \d{2}:\d{2}\. 2 respostas em conversa não concluíram \(Ze 1\);/);
    expect(fraseDoIncidente(incidente({ maquina: "nod-motor-teste", voltouEm: null }))).toMatch(/^A máquina nod-motor-teste está sem contato desde \d{2}:\d{2}\. /);
    expect(fraseDoIncidente(incidente())).not.toContain("máquina");
  });

  it("um aviso por incidente, em estilo de status, com 'Entendi' — nunca um card de decisão", () => {
    const html = renderIncidentes(comAvisos([incidente(), incidente({ id: "i2", voltouEm: null })]));
    expect(html.match(/class="aviso-sistema"/g)).toHaveLength(2);
    expect(html).toContain('role="status"');
    expect(html.match(/data-act="dispensar-incidente"/g)).toHaveLength(2);
    expect(html).toContain('data-id="i2"');
    expect(html).toContain("Entendi");
    expect(html).not.toContain('data-act="retomar"');
    expect(renderIncidentes(estadoInicial)).toBe("");
  });

  it("enquanto houver aviso EM CURSO, cada tick relê 'Sua vez' (nenhum evento avisa que o Mac voltou); fechado, não", () => {
    const emCurso = reduzir(comAvisos([incidente({ voltouEm: null })]), { tipo: "tick", agora: T0 + 6 * H });
    expect(emCurso.invalidacoes).toContain("sua-vez");
    expect(emCurso.agora).toBe(T0 + 6 * H);
    expect(reduzir(comAvisos([incidente()]), { tipo: "tick", agora: T0 + 6 * H }).invalidacoes).not.toContain("sua-vez");
  });

  it("histórico da rotina diz quem parou; o botão do painel é o computador DO BOT, não o Mac", () => {
    expect(rotuloExecucao({ desfecho: "interrompida", motivo: "maquina_sem_contato" })).toBe("interrompida · seu Mac parou de responder");
    expect(rotuloExecucao({ desfecho: "interrompida", motivo: "reinicio_servidor" })).toBe("interrompida · o servidor reiniciou");
    expect(rotuloExecucao({ desfecho: "passou_em_branco", motivo: "ninguem_respondeu_o_gate" })).toBe("passou em branco");
    const agente = { id: "a1", tenantId: "t", ownerId: "p", nome: "Nina", titulo: "", descricao: "", descricaoEstado: "", cor: "c-black", forma: "quadrado", conversaId: "c1", confirmado: true, fixado: false, oculto: false } as never;
    const base = { ...estadoInicial, tela: { tipo: "conversa" as const, conversaId: "c1", agenteId: "a1" }, sessao: { tenantId: "t", pessoaId: "p" }, frota: { agentes: [agente], negacoes: [] } as never };
    // ADR-125: a tela mora na aba Computador; o atalho para o diálogo, no Ambiente do nível Ajustes (Modo dev).
    const html = renderDetalhes({ ...base, abaGaveta: { a1: "computador" }, computadorVisto: { a1: "ligado" } });
    expect(html).toContain('data-tela-bot="a1"');
    expect(html).toContain("Tela de Nina");
    const ajustes = { ...base, gaveta: { agenteId: "a1", nivel: { tipo: "ajustes" as const } } };
    expect(renderDetalhes(ajustes)).not.toContain(">Computador do bot</span>");
    const dev = renderDetalhes({ ...ajustes, modoDev: { ...estadoInicial.modoDev, ligado: true } });
    expect(dev).toMatch(/data-act="abrir-computador"[^>]*>(?:<svg[\s\S]*?<\/svg>)?<span class="gv-linha-txt">Computador do bot</);
  });
});

describe("NOD-274: a janela que não rodou aparece no histórico da rotina", () => {
  it("cota da IA com a hora da volta, no fuso da rotina", () => {
    const volta = Date.UTC(2026, 9, 15, 17, 0);
    expect(rotuloExecucao({ desfecho: "nao_rodou", motivo: "cota_da_ia", voltaEm: volta }, "America/Sao_Paulo")).toBe("não rodou · cota, volta 14:00");
    expect(rotuloExecucao({ desfecho: "nao_rodou", motivo: "cota_da_ia", voltaEm: null })).toBe("não rodou · cota");
    expect(rotuloExecucao({ desfecho: "nao_rodou", motivo: "execucao_anterior_aberta" })).toBe("não rodou · a execução anterior ainda não tinha terminado");
    // NOD-309: toda queda do fundo que passa da próxima janela diz o motivo e, quando tem, a hora da volta.
    expect(rotuloExecucao({ desfecho: "nao_rodou", motivo: "reinicio_servidor", voltaEm: volta }, "America/Sao_Paulo")).toBe("não rodou · o servidor reiniciou, volta 14:00");
    expect(rotuloExecucao({ desfecho: "nao_rodou", motivo: "erro_do_provedor", voltaEm: volta }, "America/Sao_Paulo")).toBe("não rodou · o serviço da IA ficou instável, volta 14:00");
    expect(rotuloExecucao({ desfecho: "nao_rodou", motivo: "maquina_sem_contato", voltaEm: null })).toBe("não rodou · a máquina ficou sem contato");
  });
});
