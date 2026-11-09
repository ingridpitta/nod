import { describe, expect, it } from "vitest";
import type { MaquinaDto } from "../../../src/contracts/maquina.ts";
import type { ContaNuvemDto, MaquinaCriandoDto, MaquinaNuvemDto } from "../../../src/contracts/provedor-nuvem.ts";
import { REGIOES_NUVEM } from "../../../src/domain/maquina-nuvem.ts";
import { estadoInicial, type Estado } from "../../../web/estado/reducer.ts";
import { criandoDaConta, erroDoCriar, erroDoExcluir, fraseDaCriacao, REGIAO_PADRAO, REGIOES_CRIAR, relerEnquantoCria, TAMANHOS_CRIAR, UI_NUVEM_INICIAL, type UiNuvem } from "../../../web/lib/maquina-nuvem.ts";
import { renderMaquinas } from "../../../web/telas/maquinas.ts";

/** ADR-121 (NOD-92, PR 2): criar a VM pelo nod e excluir a que ele criou, como a web mostra. */
const AGORA = Date.UTC(2026, 9, 22, 13, 0);
const CONTA: ContaNuvemDto = { conectada: true, projeto: "meu-proj", preparando: false, motivo: null, detalhe: null };
const criando = (o: Partial<MaquinaCriandoDto> = {}): MaquinaCriandoDto => ({ id: "c1", nome: "nod-g-a1b2c3", zona: "southamerica-east1-a", tamanho: "padrao", estado: "criando", motivo: null, estadoDesde: AGORA, ...o });
const nuvem = (o: Partial<MaquinaNuvemDto> = {}): MaquinaNuvemDto => ({ provedor: "gcp", estado: "acordada", motivo: null, criadaPeloNod: true, zona: "southamerica-east1-a", dormirAposMin: 30, estadoDesde: AGORA, ...o });
const maquina = (id: string, nome: string, o: Partial<MaquinaDto> = {}): MaquinaDto => ({ id, nome, prefixo: "abcd1234", criadaEm: 1, ultimoUsoEm: null, conectada: true, plataforma: "linux", ias: { "claude-cli": "pronto" }, gh: false, ...o });

function com(maquinas: MaquinaDto[], ui: Partial<UiNuvem> = {}, menuDe: string | null = null): Estado {
  return {
    ...estadoInicial, sessao: { tenantId: "t", pessoaId: "p" }, maquinas: { maquinas, padraoId: null },
    frota: { agentes: [] } as never, nuvem: { ...UI_NUVEM_INICIAL, ...ui }, contasUi: { ...estadoInicial.contasUi, maquinaMenu: menuDe },
  };
}

describe("criar: as opções da web batem com o domínio", () => {
  it("as regiões são as mesmas do servidor, na mesma ordem, e São Paulo vem marcada", () => {
    expect(REGIOES_CRIAR.map((r) => [r.regiao, r.nome])).toEqual(REGIOES_NUVEM.map((r) => [r.regiao, r.nome]));
    expect(REGIAO_PADRAO).toBe(REGIOES_NUVEM[0].regiao);
    expect(TAMANHOS_CRIAR.map((t) => t.tamanho)).toEqual(["padrao", "menor"]);
  });
});

describe("criar: o que está sendo criado", () => {
  it("vem da conta; sem conta ou desligada, nada", () => {
    expect(criandoDaConta({ conta: null })).toEqual([]);
    expect(criandoDaConta({ conta: "desligada" })).toEqual([]);
    expect(criandoDaConta({ conta: { ...CONTA, criando: [criando()] } })).toHaveLength(1);
  });

  it("relê só enquanto alguma está criando (a que falhou não)", () => {
    expect(relerEnquantoCria({ conta: { ...CONTA, criando: [criando()] } })).toBe(true);
    expect(relerEnquantoCria({ conta: { ...CONTA, criando: [criando({ estado: "falhou_ao_acordar", motivo: "motor_sem_contato" })] } })).toBe(false);
    expect(relerEnquantoCria({ conta: CONTA })).toBe(false);
  });

  it("a frase diz o que acontece: criando, sem capacidade, ou o motor que não chegou", () => {
    expect(fraseDaCriacao(criando())).toContain("3 a 5 min");
    expect(fraseDaCriacao(criando({ motivo: "sem_capacidade" }))).not.toContain("3 a 5 min");
    expect(fraseDaCriacao(criando({ estado: "falhou_ao_acordar", motivo: "motor_sem_contato" }))).toBe("A nod-g-a1b2c3 foi criada, mas o nod não conseguiu se instalar nela. Exclua e crie de novo.");
  });

  it("os erros viram frase pelo status", () => {
    expect(erroDoCriar(409)).toContain("já há uma máquina sendo criada");
    expect(erroDoCriar(400)).toContain("região");
    expect(erroDoExcluir(404)).toBe("Esta máquina já não existe.");
    expect(erroDoExcluir(409)).toContain("console do Google");
  });
});

describe("criar e excluir na tela de Máquinas", () => {
  it("sem a nuvem ligada, só o \"Conectar outra máquina\"", () => {
    const html = renderMaquinas(com([maquina("m1", "vm")]));
    expect(html).not.toContain("nuvem-criar-abrir");
    expect(html).toContain('data-act="conectar-maquina"');
  });

  it("com a conta conectada, \"Criar minha máquina na nuvem\" é o principal", () => {
    const html = renderMaquinas(com([], { conta: CONTA }));
    expect(html).toContain("Criar minha máquina na nuvem");
    expect(html).toMatch(/data-act="nuvem-criar-abrir"/);
    expect(html).not.toMatch(/class="bt pri"[^>]*data-act="conectar-maquina"/);
  });

  it("o painel aberto marca a região e o tamanho escolhidos; AWS e Azure ficam para depois", () => {
    const html = renderMaquinas(com([], { conta: CONTA, criar: { regiao: "us-central1", tamanho: "menor", erro: null, enviando: false } }));
    expect(html).toContain('data-form="nuvem-criar"');
    expect(html).toMatch(/value="us-central1" checked/);
    expect(html).not.toMatch(/value="southamerica-east1" checked/);
    expect(html).toMatch(/value="menor" checked/);
    expect(html).toMatch(/value="aws" disabled/);
    expect(html).toContain("Criar máquina");
  });

  it("sem a conta conectada, o botão leva ao Google", () => {
    const html = renderMaquinas(com([maquina("m1", "vm", { nuvem: nuvem({ criadaPeloNod: false }) })], { conta: { ...CONTA, conectada: false }, criar: { regiao: REGIAO_PADRAO, tamanho: "padrao", erro: "x", enviando: false } }));
    expect(html).toContain("Entrar com o Google e criar");
    expect(html).toContain('role="alert">x<');
  });

  it("a VM em criação aparece na lista; a que falhou oferece Excluir e Criar de novo", () => {
    const html = renderMaquinas(com([], { conta: { ...CONTA, criando: [criando(), criando({ id: "c2", nome: "nod-g-ffffff", estado: "falhou_ao_acordar", motivo: "motor_sem_contato" })] } }));
    expect(html).toContain("nod-g-a1b2c3");
    expect(html).toContain('data-act="nuvem-excluir" data-id="c2" data-nome="nod-g-ffffff"');
    expect(html).not.toContain('data-id="c1"');
    expect(html).toContain('data-act="nuvem-criar-abrir" data-id="c2">Criar de novo');
  });

  it("\"Excluir máquina\" só no menu da VM criada pelo nod; o diálogo pede confirmação", () => {
    const criada = maquina("m1", "nod-g-a1b2c3", { nuvem: nuvem() });
    const conectada = maquina("m2", "vm-minha", { nuvem: nuvem({ criadaPeloNod: false }) });
    expect(renderMaquinas(com([criada], { conta: CONTA }, "m1"))).toContain('data-act="nuvem-excluir" data-id="m1"');
    expect(renderMaquinas(com([conectada], { conta: CONTA }, "m2"))).not.toContain('data-act="nuvem-excluir"');
    const html = renderMaquinas(com([criada], { conta: CONTA, excluir: { id: "m1", nome: "nod-g-a1b2c3", erro: null } }));
    expect(html).toContain("Excluir a nod-g-a1b2c3?");
    expect(html).toContain('data-act="nuvem-excluir-confirmar"');
  });
});
