// NOD-365: Seu computador › Onde o computador mora, a confirmação da troca, a recusa da origem sem contato e o "desde HH:MM".
import { describe, expect, it } from "vitest";
import {
  UI_INICIAL,
  ETAPAS,
  horaCurta,
  htmlAvisoDeFalha,
  htmlConfirmarTroca,
  htmlDialogoDoPainel,
  htmlEtapas,
  htmlLinhaTelaFechada,
  htmlLugares,
  htmlPainelComputadorDoBot,
  tituloSemContato,
  type ComputadorPessoaDto,
} from "../../../web/lib/computador-pessoa.ts";
import type { LugarDoComputador } from "../../../src/contracts/computador.ts";

const L = (o: Partial<LugarDoComputador> & Pick<LugarDoComputador, "maquinaId" | "tipo">): LugarDoComputador => ({ nome: o.maquinaId, atual: false, pronta: true, ...o });
const NOD = L({ maquinaId: "m-nod", nome: "nod-motor", tipo: "onde_o_nod_roda" });
const MAC = L({ maquinaId: "m-mac", nome: "MacBook", tipo: "este_mac" });
const VPS = L({ maquinaId: "m-vps", nome: "vps-sp", tipo: "outra_maquina" });
const pc = (o: Partial<ComputadorPessoaDto> = {}): ComputadorPessoaDto => ({ estado: "pronto", maquina: { id: "m-nod", nome: "nod-motor", contato: 1 }, telas: [], esperando: [], ...o });

describe("Onde o computador mora (NOD-365)", () => {
  it("lista só as opções que vieram, marca a atual e oferece Trazer de volta para onde o nod roda", () => {
    const html = htmlLugares(pc({ lugares: [NOD, { ...VPS, atual: true }] }), UI_INICIAL);
    expect(html).toContain("Onde o nod roda");
    expect(html).toContain("Outra máquina sua");
    expect(html).not.toContain("Este Mac");
    expect(html).toMatch(/data-pc-lugar="m-vps" aria-current="true"/);
    expect(html).toContain('data-act="pc-trocar" data-maquina="m-nod">Trazer de volta');
    expect(html).not.toContain('data-maquina="m-vps">Mudar');
  });

  it("sem outra máquina, o link leva ao Conectar (onde mora o SSH); com ela, o link some", () => {
    expect(htmlLugares(pc({ lugares: [{ ...NOD, atual: true }, MAC] }), UI_INICIAL)).toContain('data-act="conectar-sempre-ligada"');
    expect(htmlLugares(pc({ lugares: [{ ...NOD, atual: true }, VPS] }), UI_INICIAL)).not.toContain('data-act="conectar-sempre-ligada"');
  });

  it("máquina que não está pronta e operação em curso desligam o Mudar", () => {
    expect(htmlLugares(pc({ lugares: [{ ...NOD, atual: true }, { ...VPS, pronta: false }] }), UI_INICIAL)).toMatch(/data-maquina="m-vps" disabled/);
    expect(htmlLugares(pc({ lugares: [{ ...NOD, atual: true }, VPS], operacao: { tipo: "trocar", pct: 10, etapa: "Copiando os logins" } }), UI_INICIAL)).toMatch(/data-maquina="m-vps" disabled/);
  });

  it("a atual: 'sem contato' só quando não está conectada; conectada sem os pacotes é 'não está pronta'", () => {
    const off = htmlLugares(pc({ lugares: [{ ...NOD, atual: true, pronta: false, conectada: false }, VPS] }), UI_INICIAL);
    expect(off).toContain("O computador mora aqui · sem contato");
    const semPacotes = htmlLugares(pc({ lugares: [{ ...NOD, atual: true, pronta: false, conectada: true }, VPS] }), UI_INICIAL);
    expect(semPacotes).toContain("O computador mora aqui · não está pronta");
    expect(semPacotes).not.toContain("sem contato");
  });
  it("sem lugares (servidor antigo), a seção não aparece", () => {
    expect(htmlLugares(pc(), UI_INICIAL)).toBe("");
    expect(htmlPainelComputadorDoBot(pc({ lugares: [{ ...NOD, atual: true }, VPS] }), [], UI_INICIAL, 0)).toContain("Onde o computador mora");
  });

  it("a confirmação diz que os logins vão e os arquivos ficam 30 dias na origem; o foco começa em Cancelar", () => {
    const dto = pc({ lugares: [{ ...NOD, atual: true }, VPS] });
    const html = htmlDialogoDoPainel(dto, [], { ...UI_INICIAL, trocarPara: "m-vps" });
    expect(html).toContain("Mudar o computador para vps-sp?");
    expect(html).toContain("Os logins vão junto. Os arquivos não vão; ficam 30 dias em nod-motor.");
    expect(html).toMatch(/data-act="pc-cancelar" data-cl-autofoco/);
    expect(html).toContain('data-act="pc-trocar-confirmar" data-maquina="m-vps"');
    expect(htmlConfirmarTroca({ ...dto, lugares: [NOD, { ...VPS, atual: true }] }, "m-nod")).toContain("Trazer o computador de volta?");
    // Destino que não está na lista (ou é o atual): nada a confirmar.
    expect(htmlConfirmarTroca(dto, "m-nod")).toBe("");
    expect(htmlConfirmarTroca(dto, "outra")).toBe("");
  });

  it("origem sem contato: a recusa fica na linha da máquina com o link Trocar sem os logins", () => {
    const html = htmlLugares(pc({ lugares: [{ ...NOD, atual: true }, VPS] }), { ...UI_INICIAL, recusaDaTroca: { maquinaId: "m-vps", texto: "nod-motor está sem contato; ligue-a para levar os logins" } });
    expect(html).toContain("nod-motor está sem contato; ligue-a para levar os logins");
    expect(html).toContain('data-act="pc-trocar-sem-logins" data-maquina="m-vps"');
  });

  it("o nome que vem do servidor é escapado", () => {
    expect(htmlLugares(pc({ lugares: [{ ...NOD, atual: true }, { ...VPS, nome: "<img src=x>" }] }), UI_INICIAL)).not.toContain("<img src=x>");
  });

  it("a troca tem etapas e a linha da tela fechada diz que o computador está mudando de máquina", () => {
    expect(ETAPAS.trocar).toEqual(["Copiando os logins", "Levando para a máquina nova", "Ligando na máquina nova"]);
    expect(htmlEtapas("trocar", "Levando para a máquina nova", 50)).toMatch(/class="feita">.*Copiando os logins.*aria-current="step">.*Levando/);
    expect(htmlLinhaTelaFechada("trocar", "Dev 2")).toContain("mudando de máquina");
  });
});

describe("fora do ar com a máquina sem contato (NOD-365)", () => {
  const desde = new Date(2026, 9, 28, 14, 5).getTime();
  const fora = pc({ estado: "fora_do_ar", falha: { motivo: "maquina_sem_contato", desde }, semContatoDesde: desde });

  it("'Não consegui ligar o computador: <nome> está sem contato desde HH:MM' com o link para Onde o computador mora", () => {
    expect(horaCurta(desde)).toBe("14:05");
    expect(tituloSemContato(fora)).toBe("Não consegui ligar o computador: nod-motor está sem contato desde 14:05");
    const aviso = htmlAvisoDeFalha(fora)!;
    expect(aviso).toContain("está sem contato desde 14:05");
    expect(aviso).toContain('data-act="ver-lugar-do-computador"');
    const painel = htmlPainelComputadorDoBot(fora, [], UI_INICIAL, desde);
    expect(painel).toContain("está sem contato desde 14:05");
    expect(painel).toContain('data-act="ver-lugar-do-computador"');
  });

  it("nunca troca sozinho: nenhum POST de troca nasce do aviso, só o link", () => {
    expect(htmlAvisoDeFalha(fora)).not.toMatch(/pc-trocar/);
  });

  it("outros motivos seguem com o texto de antes", () => {
    expect(tituloSemContato({ ...fora, falha: { motivo: "nao_ficou_pronto", desde } })).toBeNull();
    expect(htmlAvisoDeFalha({ ...fora, falha: { motivo: "nao_ficou_pronto", desde } })).toContain("Não consegui ligar o computador");
    expect(tituloSemContato(pc())).toBeNull();
  });

  it("NOD-407: a máquina voltou (contato atual, sem semContatoDesde): não diz 'sem contato desde' com a hora de agora", () => {
    const voltou = pc({ estado: "fora_do_ar", falha: { motivo: "maquina_sem_contato", desde }, maquina: { id: "m-nod", nome: "nod-motor", contato: desde + 60_000 } });
    expect(tituloSemContato(voltou)).toBeNull();
    expect(htmlAvisoDeFalha(voltou)).not.toContain("sem contato");
    const sumiu = pc({ estado: "fora_do_ar", falha: { motivo: "maquina_sem_contato", desde }, maquina: { id: "m-nod", nome: "nod-motor", contato: null } });
    expect(tituloSemContato(sumiu)).toBe("Não consegui ligar o computador: nod-motor está sem contato");
  });
});
