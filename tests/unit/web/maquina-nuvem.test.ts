import { describe, expect, it } from "vitest";
import type { ConversaDto } from "../../../src/contracts/api.ts";
import type { MaquinaDto } from "../../../src/contracts/maquina.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import type { TrabalhosDto } from "../../../src/contracts/trabalho.ts";
import type { MaquinaNuvemDto, MotivoFalhaNuvem } from "../../../src/contracts/provedor-nuvem.ts";
import { estadoInicial, reduzir, type Estado } from "../../../web/estado/reducer.ts";
import { acoesDaFalha, acordandoNaFila, avisoDaConta, erroDoConectar, nomeDaZona, nuvemLigada, rotuloEstadoNuvem, rotuloSono, UI_NUVEM_INICIAL, type UiNuvem } from "../../../web/lib/maquina-nuvem.ts";
import { renderMensagem, situacaoNaFila } from "../../../web/telas/conversa.ts";
import { avisoDaNuvem, nomeDeInstanciaSugerido, nuvemNoCartao, renderMaquinas } from "../../../web/telas/maquinas.ts";

/** ADR-121 (NOD-92, PR 1): a máquina no Google que dorme e acorda, como a web a mostra. */
const AGORA = Date.UTC(2026, 9, 22, 13, 0);
const nuvem = (o: Partial<MaquinaNuvemDto> = {}): MaquinaNuvemDto => ({ provedor: "gcp", estado: "acordada", motivo: null, criadaPeloNod: false, zona: "southamerica-east1-a", dormirAposMin: 30, estadoDesde: AGORA, ...o });
const maquina = (id: string, nome: string, o: Partial<MaquinaDto> = {}): MaquinaDto => ({ id, nome, prefixo: "abcd1234", criadaEm: 1, ultimoUsoEm: null, conectada: true, plataforma: "linux", ias: { "claude-cli": "pronto" }, gh: false, ...o });

function com(maquinas: MaquinaDto[], ui: Partial<UiNuvem> = {}, menuDe: string | null = null): Estado {
  return {
    ...estadoInicial, sessao: { tenantId: "t", pessoaId: "p" }, maquinas: { maquinas, padraoId: null },
    frota: { agentes: [] } as never, nuvem: { ...UI_NUVEM_INICIAL, ...ui }, contasUi: { ...estadoInicial.contasUi, maquinaMenu: menuDe },
  };
}
const CONTA = { conectada: true, projeto: "meu-proj", preparando: false, motivo: null, detalhe: null };

describe("rótulos e ações da máquina na nuvem", () => {
  it("cada estado tem seu rótulo", () => {
    expect(rotuloEstadoNuvem("acordada")).toBe("Acordada");
    expect(rotuloEstadoNuvem("dormindo")).toBe("Dormindo");
    expect(rotuloEstadoNuvem("acordando")).toBe("Acordando…");
    expect(rotuloEstadoNuvem("adormecendo")).toBe("Adormecendo…");
    expect(rotuloEstadoNuvem("criando")).toBe("Criando…");
    expect(rotuloEstadoNuvem("falhou_ao_acordar")).toBe("Não acordou");
    expect(rotuloEstadoNuvem("excluida")).toBe("Excluída");
    expect([15, 30, 60, 120, null].map((m) => rotuloSono(m as never))).toEqual(["15 min", "30 min", "1 h", "2 h", "Nunca dormir"]);
  });

  it("cada motivo pede sua ação", () => {
    const rotulos = (m: MotivoFalhaNuvem | null) => acoesDaFalha(m).map((a) => `${a.tipo}:${a.rotulo}`);
    expect(rotulos("credencial_nuvem")).toEqual(["reconectar:Reconectar o Google"]);
    expect(rotulos("cota_ou_cobranca")).toEqual(["console:Abrir o console do Google ↗", "acordar:Tentar de novo"]);
    expect(rotulos("sem_capacidade")).toEqual(["acordar:Tentar agora"]);
    expect(rotulos("motor_sem_contato")).toEqual(["acordar:Tentar de novo"]);
    expect(rotulos(null)).toEqual(["acordar:Tentar de novo"]);
    expect(rotulos("excluida")).toEqual([]);
  });

  it("os erros do conectar dizem o que fazer", () => {
    expect(erroDoConectar(400)).toContain("formato do Google");
    expect(erroDoConectar(404)).toContain("não está mais conectada");
    expect(erroDoConectar(409)).toContain("já dorme e acorda");
    // QA: sem o OAuth do Google no servidor o 409 não é "já conectada".
    expect(erroDoConectar(409, "integracao_nao_configurada")).not.toContain("já dorme e acorda");
    expect(erroDoConectar(409, "integracao_nao_configurada")).toContain("não tem o acesso ao Google configurado");
    expect(erroDoConectar(409, "estado_invalido")).toContain("já dorme e acorda");
  });
});

describe("revisão NOD-92 (item 15): a zona vira o nome da região", () => {
  it("zona da lista do Criar mostra a região; zona fora dela fica crua", () => {
    expect(nomeDaZona("southamerica-east1-a")).toBe("São Paulo");
    expect(nomeDaZona("us-central1-b")).toBe("Iowa (EUA)");
    expect(nomeDaZona("us-east1")).toBe("Carolina do Sul (EUA)");
    expect(nomeDaZona("europe-west1-b")).toBe("europe-west1-b");
    expect(nomeDaZona("us-east10-a")).toBe("us-east10-a");
  });
});

describe("o cartão da máquina na nuvem", () => {
  it("acordada: o estado, o sono e o Dormir agora; o subtítulo diz Google Cloud", () => {
    const html = renderMaquinas(com([maquina("vm", "vm-sp", { nuvem: nuvem() })]));
    expect(html).toContain("Acordada");
    expect(html).toContain("Google Cloud · São Paulo");
    expect(html).toContain('data-act="nuvem-dormir"');
    expect(html).toContain("Dormir agora");
    expect(html).toContain("30 min ▾");
    expect(html).not.toContain("nv-falha");
  });

  it("dormindo: cinza com a hora, Acordar agora e o menu do sono com Nunca", () => {
    const m = maquina("vm", "vm-sp", { conectada: false, nuvem: nuvem({ estado: "dormindo", dormirAposMin: 60 }) });
    const html = nuvemNoCartao(com([m], { sonoMenu: "vm" }), m);
    expect(html).toContain('data-act="nuvem-acordar"');
    expect(html).toContain("Acorda sozinha quando um bot precisar.");
    expect(html).toMatch(/role="menuitemradio" aria-checked="true" data-act="nuvem-dormir-apos" data-maquina="vm" data-minutos="60"/);
    expect(html).toContain('data-minutos=""><span>Nunca dormir');
    expect(renderMaquinas(com([m]))).toMatch(/lc-status[^"]*neutro[\s\S]*?Dormindo desde \d\d:\d\d/);
  });

  it("a linha de falha mostra o motivo legível e a ação dele", () => {
    const cartao = (motivo: MotivoFalhaNuvem | null, estado: MaquinaNuvemDto["estado"] = "falhou_ao_acordar") => {
      const m = maquina("vm", "vm-sp", { conectada: false, nuvem: nuvem({ estado, motivo }) });
      return nuvemNoCartao(com([m], { conta: CONTA }), m);
    };
    const credencial = cartao("credencial_nuvem", "dormindo");
    expect(credencial).toContain("perdeu a permissão");
    expect(credencial).toContain('data-act="nuvem-reconectar"');
    expect(credencial).not.toContain("nv-sono-linha");
    const cota = cartao("cota_ou_cobranca");
    expect(cota).toContain('href="https://console.cloud.google.com/home/dashboard?project=meu-proj"');
    expect(cota).toContain('rel="noopener noreferrer"');
    expect(cota).toMatch(/data-act="nuvem-acordar" data-maquina="vm">Tentar de novo/);
    expect(cartao("sem_capacidade", "dormindo")).toMatch(/sem máquinas livres em São Paulo[\s\S]*data-act="nuvem-acordar" data-maquina="vm">Tentar agora/);
    expect(cartao("motor_sem_contato")).toMatch(/nod não respondeu nela[\s\S]*>Tentar de novo/);
    expect(cartao(null)).toMatch(/não acordou[\s\S]*>Tentar de novo/);
    expect(cartao("excluida", "excluida")).not.toContain("nuvem-acordar");
  });

  it("a recusa do Dormir agora aparece só no cartão dela", () => {
    const m = maquina("vm", "vm-sp", { nuvem: nuvem() });
    const outra = maquina("vm2", "vm-rj", { nuvem: nuvem() });
    const e = com([m, outra], { recusa: { maquinaId: "vm", texto: "A vm-sp não pode dormir agora" } });
    expect(nuvemNoCartao(e, m)).toContain("não pode dormir agora");
    expect(nuvemNoCartao(e, outra)).not.toContain("não pode dormir agora");
  });

  it("o ⋯ oferece Dormir e acordar pelo Google só com a flag, e nunca no Mac nem em quem já tem nuvem", () => {
    const vm = maquina("vm", "vm-sp");
    expect(renderMaquinas(com([vm], { conta: "desligada" }, "vm"))).not.toContain("nuvem-conectar-abrir");
    expect(renderMaquinas(com([vm], {}, "vm"))).not.toContain("nuvem-conectar-abrir");
    expect(renderMaquinas(com([vm], { conta: CONTA }, "vm"))).toContain('data-act="nuvem-conectar-abrir" data-maquina="vm"');
    expect(renderMaquinas(com([vm, maquina("g", "g", { nuvem: nuvem() })], { conta: "desligada" }, "vm"))).toContain("nuvem-conectar-abrir");
    expect(renderMaquinas(com([maquina("mac", "MacBook", { plataforma: "darwin" })], { conta: CONTA }, "mac"))).not.toContain("nuvem-conectar-abrir");
    expect(renderMaquinas(com([maquina("g", "g", { nuvem: nuvem() })], { conta: CONTA }, "g"))).not.toContain("nuvem-conectar-abrir");
    expect(nuvemLigada({ conta: null }, [vm])).toBe(false);
  });

  it("o formulário traz projeto, zona e nome, e o erro do servidor", () => {
    const vm = maquina("vm", "vm-sp");
    const html = renderMaquinas(com([vm], { conta: CONTA, conectar: { maquinaId: "vm", projeto: "", zona: "southamerica-east1-a", nome: "vm-sp", erro: "Confira o projeto" } }));
    expect(html).toContain('data-form="nuvem-conectar" data-maquina="vm"');
    expect(html).toMatch(/name="zona" type="text" value="southamerica-east1-a"/);
    expect(html).toMatch(/name="nome" type="text" value="vm-sp"/);
    expect(html).toContain('<p class="cx-erro" role="alert">Confira o projeto</p>');
    expect(nomeDeInstanciaSugerido({ nome: "vm-sp" })).toBe("vm-sp");
    expect(nomeDeInstanciaSugerido({ nome: "MacBook de Ana" })).toBe("");
  });

  it("sem nuvem, o cartão é o de sempre", () => {
    const vm = maquina("vm", "vm-sp");
    const e = com([vm], { conta: "desligada" });
    expect(nuvemNoCartao(e, vm)).toBe("");
    const html = renderMaquinas(e);
    expect(html).not.toMatch(/nv-|nuvem-|Google Cloud/);
    expect(html).toContain("vm-sp");
    expect(renderMaquinas(com([vm]))).toBe(renderMaquinas(com([vm], { conta: "desligada" })));
  });
});

describe("o aviso da volta do Google", () => {
  it("preparando espera, depois diz pronto ou o motivo; recusado diz que nada mudou", () => {
    expect(avisoDaConta({ aviso: null, conta: CONTA })).toBeNull();
    expect(avisoDaConta({ aviso: "preparando", conta: null })?.tom).toBe("espera");
    expect(avisoDaConta({ aviso: "preparando", conta: { ...CONTA, preparando: true } })?.texto).toBe("Preparando sua conta do Google…");
    expect(avisoDaConta({ aviso: "preparando", conta: CONTA })).toMatchObject({ tom: "ok", texto: expect.stringContaining("Pronto") });
    expect(avisoDaConta({ aviso: "preparando", conta: { ...CONTA, conectada: false, motivo: "credencial_nuvem", detalhe: "org_bloqueia_chave" } })).toMatchObject({ tom: "falha", texto: expect.stringContaining("bloqueia chave de conta de serviço") });
    expect(avisoDaConta({ aviso: "recusado", conta: null })).toMatchObject({ tom: "falha", texto: expect.stringContaining("não autorizou") });
    const html = avisoDaNuvem(com([], { aviso: "preparando", conta: { ...CONTA, conectada: false, motivo: "credencial_nuvem" } }));
    expect(html).toContain('data-act="nuvem-reconectar"');
    expect(html).toContain('data-act="nuvem-aviso-fechar"');
    expect(avisoDaNuvem(com([], { aviso: "preparando" }))).not.toContain("nuvem-aviso-fechar");
  });
});

describe("a fila da conversa com a máquina acordando (situacaoNaFila)", () => {
  const C = "c1";
  const mensagem = { tenantId: "t", id: "m2", conversaId: C, turnoId: null, autoria: { autor_tipo: "pessoa", autor_id: "p" }, kind: "texto", texto: "oi", payload: null, confianca: "confiavel", parcial: false, criadoEm: AGORA } as unknown as Mensagem;
  function naFila(maquinas: MaquinaDto[], trabalhos: TrabalhosDto | null = null): Estado {
    const conversa: ConversaDto = {
      conversa: { tenantId: "t", id: C, ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a", salaId: null, sessaoCli: null, criadoEm: 1 },
      mensagens: [], turnosPendentes: [], turnosEmCurso: [{ id: "t2", estado: "pendente", desde: AGORA, mensagemId: "m2" }], turnosCancelados: [], propostas: [], fios: [],
    };
    const e = reduzir(estadoInicial, { tipo: "hidratar-conversa", conversa, agora: AGORA });
    return { ...e, frota: { agentes: [{ id: "a", nome: "Ze 1", conversaId: C, maquinaId: "vm" }] } as never, maquinas: { maquinas, padraoId: null }, trabalhos };
  }
  const mac = maquina("mac", "MacBook", { plataforma: "darwin" });

  it("dormindo ou acordando: 'Acordando <máquina>…' e nada de Rodar em X desta vez", () => {
    for (const estado of ["dormindo", "acordando"] as const) {
      const e = naFila([maquina("vm", "vm-sp", { conectada: false, nuvem: nuvem({ estado }) }), mac]);
      const s = situacaoNaFila(mensagem, e);
      expect(s).toEqual({ tipo: "na_fila", turnoId: "t2", texto: "Acordando vm-sp… · costuma levar 1 a 2 min" });
      expect(renderMensagem(mensagem, e)).not.toContain("rodar-desta-vez");
      expect(renderMensagem(mensagem, e)).toContain('data-act="cancelar-turno"');
    }
  });

  it("o trabalho com `acordando` também segura a fila, pelo nome que ele traz", () => {
    const trabalhos = { trabalhos: [{ conversaId: C, maquina: { id: "vm", nome: "vm-sp", ehMac: false, acordando: true } }] } as unknown as TrabalhosDto;
    const e = naFila([maquina("vm", "vm-sp", { conectada: false }), mac], trabalhos);
    expect(situacaoNaFila(mensagem, e)).toMatchObject({ texto: "Acordando vm-sp… · costuma levar 1 a 2 min" });
    expect(acordandoNaFila(null, { acordando: true })).toBe(true);
    expect(acordandoNaFila({ nuvem: nuvem() }, null)).toBe(false);
  });

  it("revisão NOD-92 (item 14): sem capacidade, o chip diz o motivo, oferece Tentar agora e é role=status", () => {
    const e = naFila([maquina("vm", "vm-sp", { conectada: false, nuvem: nuvem({ estado: "acordando", motivo: "sem_capacidade" }) }), mac]);
    const s = situacaoNaFila(mensagem, e);
    expect(s).toMatchObject({ tentarAgora: "vm" });
    expect(s && "texto" in s ? s.texto : "").toContain("sem máquinas livres em São Paulo");
    const html = renderMensagem(mensagem, e);
    expect(html).not.toContain("1 a 2 min");
    expect(html).toMatch(/class="fila-chip" role="status"/);
    expect(html).toMatch(/data-act="nuvem-acordar"[^>]*data-maquina="vm"[^>]*>Tentar agora/);
    expect(html).not.toContain("rodar-desta-vez");
  });

  it("revisão NOD-92 (rodada 2, item 2): o 409 do Tentar agora aparece junto do chip", () => {
    const base = naFila([maquina("vm", "vm-sp", { conectada: false, nuvem: nuvem({ estado: "acordando", motivo: "sem_capacidade" }) }), mac]);
    const e = { ...base, nuvem: { ...base.nuvem, recusa: { maquinaId: "vm", texto: "A vm-sp não pode acordar agora. Atualize a página e tente de novo." } } };
    expect(situacaoNaFila(mensagem, e)).toMatchObject({ recusa: "A vm-sp não pode acordar agora. Atualize a página e tente de novo." });
    expect(renderMensagem(mensagem, e)).toMatch(/class="cx-erro" role="alert">A vm-sp não pode acordar agora/);
    const outra = { ...base, nuvem: { ...base.nuvem, recusa: { maquinaId: "mac", texto: "outra" } } };
    expect(renderMensagem(mensagem, outra)).not.toContain("cx-erro");
  });

  it("o chip comum também é role=status", () => {
    const e = naFila([maquina("vm", "vm-sp", { conectada: false, nuvem: nuvem({ estado: "dormindo" }) }), mac]);
    expect(renderMensagem(mensagem, e)).toMatch(/class="fila-chip" role="status"/);
  });

  it("na falha (falhou_ao_acordar) o Rodar em X desta vez volta", () => {
    const e = naFila([maquina("vm", "vm-sp", { conectada: false, nuvem: nuvem({ estado: "falhou_ao_acordar" }) }), mac]);
    expect(situacaoNaFila(mensagem, e)).toMatchObject({ destaVez: { maquinaId: "mac", nome: "MacBook" } });
    expect(renderMensagem(mensagem, e)).toContain("Rodar em MacBook desta vez");
  });

  it("sem nuvem, a fila de sempre", () => {
    const fora = naFila([maquina("vm", "vm-sp", { conectada: false }), mac]);
    expect(situacaoNaFila(mensagem, fora)).toMatchObject({ texto: expect.stringMatching(/^Eu trabalho no vm-sp, que está desligado/), destaVez: { maquinaId: "mac" } });
    expect(situacaoNaFila(mensagem, naFila([maquina("vm", "vm-sp")]))).toEqual({ tipo: "na_fila", turnoId: "t2", texto: "Na fila · Ze 1 lê quando terminar o turno atual" });
  });
});
