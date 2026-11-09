import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FrotaDto } from "../../../src/contracts/api.ts";
import { HARNESSES } from "../../../src/contracts/harness.ts";
import { RACIOCINIOS, type IaDaPessoa } from "../../../src/contracts/inteligencia.ts";
import { estadoInicial, reduzir, type Estado, type NivelGaveta } from "../../../web/estado/reducer.ts";
import { contextoInteligencia } from "../../../web/telas/detalhes.ts";
import { mudarRascunho, rascunhoDe, type MudancaRascunho } from "../../../web/telas/inteligencia.ts";

// medido em 2026-10-12: os cinco casos somaram 5 ms (Vitest, Node 24.19.0); o prazo explícito cobre a importação sob carga.
vi.setConfig({ testTimeout: 30_000 });

// Definido em 2026-10-12: os módulos com DOM são carregados em execução; seu tipo é conferido pelo tsconfig.web,
// enquanto estes testes também passam pelo tsconfig.server, que não tem a biblioteca DOM.
const { atualizarGaveta }: { atualizarGaveta: (estado: Estado, gavetaSuja: string | null) => void } = await import(new URL("../../../web/lib/gaveta-render.ts", import.meta.url).href);
const { esquecerRegiao }: { esquecerRegiao: (id: string) => void } = await import(new URL("../../../web/lib/regioes.ts", import.meta.url).href);

/** GFK-2027: o rascunho mudava no reducer, mas a proteção dos campos da gaveta congelava o HTML após o primeiro clique. */
const frota: FrotaDto = {
  agentes: [{
    tenantId: "t", id: "clarice", ownerId: "p", visibility: "privado", nome: "Clarice", titulo: "Pesquisa",
    descricao: "Ajuda a pesquisar", dono: "pessoa", forma: "shape-square", cor: "c-purple", fixado: false,
    oculto: false, confirmado: true, modelo: "auto", harness: "auto", esforco: null,
    inteligencia: { modo: "auto", fixa: null, ordem: null, escolhas: {} }, duplicadoDe: null, criadoEm: 1,
    conversaId: "conversa", descricaoEstado: "sem acessos", computadorForaDoAr: null, ultimaMensagem: null,
  }],
  inventario: { estado: "pronto", versao: "catcher", em: 1 }, negacoes: [],
};

function cenario(nivel: NivelGaveta = { tipo: "inteligencia" }): Estado {
  const ias: IaDaPessoa[] = HARNESSES.map((h) => ({
    id: h.id, nome: h.nome, integrado: h.integrado, inventario: { estado: "pronto", versao: "1", em: 1 },
    limite: null, recomendado: "recomendado" in h ? h.recomendado : null,
    modelos: h.modelos.map((m) => ({ ...m, recomendado: "recomendado" in h && m.id === h.recomendado.modelo })),
  }));
  let e = reduzir(estadoInicial, { tipo: "sessao", escopo: { tenantId: "t", pessoaId: "p" } });
  e = reduzir(e, { tipo: "hidratar-frota", frota: { ...frota, agentes: [...frota.agentes] } });
  e = reduzir(e, { tipo: "hidratar-ias", ias: { ordem: ["claude-cli", "codex-cli"], ordemPadrao: true, ias, raciocinios: RACIOCINIOS } });
  return reduzir(e, { tipo: "gaveta", agenteId: "clarice", nivel });
}

function mudar(e: Estado, mudanca: MudancaRascunho): Estado {
  const r = e.rascunhoIa ?? rascunhoDe(e.frota!.agentes[0]!);
  return reduzir(e, { tipo: "rascunho-ia", rascunho: mudarRascunho(r, mudanca, contextoInteligencia(e)) });
}

const claude = (e: Estado) => e.ias!.ias.find((i) => i.id === "claude-cli")!;

describe("o render da gaveta acompanha o rascunho sem apagar os campos não salvos", () => {
  let detalhes: { innerHTML: string };

  beforeEach(() => {
    detalhes = { innerHTML: "" };
    vi.stubGlobal("HTMLButtonElement", class {});
    vi.stubGlobal("document", {
      activeElement: null,
      getElementById: (id: string) => id === "detalhes" ? detalhes : null,
      querySelector: () => null,
    });
    esquecerRegiao("detalhes");
  });

  afterEach(() => {
    esquecerRegiao("detalhes");
    vi.unstubAllGlobals();
  });

  it("abrir os modelos e clicar várias vezes em modelo e raciocínio redesenha cada escolha, mesmo com mudança não salva", () => {
    let e = cenario();
    atualizarGaveta(e, null);
    expect(detalhes.innerHTML).not.toContain('class="int-painel"');

    e = mudar(e, { tipo: "pilula", ia: "claude-cli" });
    atualizarGaveta(e, null);
    expect(detalhes.innerHTML).toContain('data-act="int-pilula" data-ia="claude-cli" aria-expanded="true"');
    const suja = JSON.stringify(e.gaveta);

    e = mudar(e, { tipo: "modelo", ia: claude(e), modelo: "haiku" });
    atualizarGaveta(e, suja);
    expect(detalhes.innerHTML).toContain('aria-checked="true" data-act="int-modelo" data-ia="claude-cli" data-modelo="haiku"');
    expect(detalhes.innerHTML).toContain(">Haiku · Médio<");

    e = mudar(e, { tipo: "raciocinio", ia: claude(e), raciocinio: "high" });
    atualizarGaveta(e, suja);
    expect(detalhes.innerHTML).toContain('aria-checked="true" data-act="int-raciocinio" data-ia="claude-cli" data-raciocinio="high"');
    expect(detalhes.innerHTML).toContain(">Haiku · Alto<");

    e = mudar(e, { tipo: "modelo", ia: claude(e), modelo: "sonnet" });
    atualizarGaveta(e, suja);
    expect(detalhes.innerHTML).toContain(">Sonnet · Alto<");
    expect(detalhes.innerHTML).toContain('aria-checked="false" data-act="int-modelo" data-ia="claude-cli" data-modelo="haiku"');

    e = mudar(e, { tipo: "raciocinio", ia: claude(e), raciocinio: "max" });
    atualizarGaveta(e, suja);
    expect(detalhes.innerHTML).toContain(">Sonnet · Máximo<");
    expect(detalhes.innerHTML).toContain('aria-checked="true" data-act="int-raciocinio" data-ia="claude-cli" data-raciocinio="max"');

    e = mudar(e, { tipo: "pilula", ia: "claude-cli" });
    atualizarGaveta(e, suja);
    expect(detalhes.innerHTML).not.toContain('class="int-painel"');
    e = mudar(e, { tipo: "pilula", ia: "claude-cli" });
    atualizarGaveta(e, suja);
    expect(detalhes.innerHTML).toContain('class="int-painel"');
    expect(detalhes.innerHTML).toContain(">Sonnet · Máximo<");
  });

  it("com o foco no nome, o resto da gaveta redesenha e o campo continua o mesmo nó (revisão 2 da NOD-349)", () => {
    vi.stubGlobal("CSS", { escape: (v: string) => v });
    const visao = (e: Estado): Estado => ({ ...e, gaveta: null, tela: { tipo: "conversa", conversaId: "conversa", agenteId: "clarice" } });
    let e = visao(cenario());
    atualizarGaveta(e, null);
    expect(detalhes.innerHTML).toContain('data-campo="nome" data-id="clarice"');
    const campo = { matches: () => true, dataset: { campo: "nome", id: "clarice", salvo: "Clarice" }, selectionStart: 3, selectionEnd: 3, blur: vi.fn(), focus: vi.fn(), setSelectionRange: vi.fn() };
    const novo = { dataset: { salvo: "Clarice" }, replaceWith: vi.fn() };
    vi.stubGlobal("document", { activeElement: campo, getElementById: (id: string) => id === "detalhes" ? detalhes : null, querySelector: (q: string) => q.includes('[data-campo="nome"][data-id="clarice"]') ? novo : null });
    e = reduzir(e, { tipo: "agente-local", agenteId: "clarice", mudanca: { titulo: "Pesquisa e resumo" } });
    atualizarGaveta(e, null);
    expect(detalhes.innerHTML).toContain('value="Pesquisa e resumo"');
    expect(novo.replaceWith).toHaveBeenCalledWith(campo);
    expect(campo.setSelectionRange).toHaveBeenCalledWith(3, 3);
    expect(campo.blur).not.toHaveBeenCalled();
    // Outro bot na tela: o campo não volta, então o blur salva antes de o nó sumir.
    e = { ...e, frota: { ...e.frota!, agentes: [...e.frota!.agentes, { ...e.frota!.agentes[0]!, id: "outro", nome: "Outro", conversaId: "c2" }] }, tela: { tipo: "conversa", conversaId: "c2", agenteId: "outro" } };
    atualizarGaveta(e, null);
    expect(campo.blur).toHaveBeenCalledTimes(1);
    expect(detalhes.innerHTML).toContain('data-campo="nome" data-id="outro"');
  });

  it("trocar modo, IA fixa e ordem atualiza os controles depois da primeira mudança", () => {
    let e = cenario();
    atualizarGaveta(e, null);
    e = mudar(e, { tipo: "modo", modo: "fixa" });
    atualizarGaveta(e, null);
    const suja = JSON.stringify(e.gaveta);
    expect(detalhes.innerHTML).toContain('aria-checked="true" data-act="int-modo" data-modo="fixa"');

    e = mudar(e, { tipo: "fixa", ia: "codex-cli" });
    atualizarGaveta(e, suja);
    expect(detalhes.innerHTML).toContain('aria-checked="true" aria-label="Usar só o ChatGPT" data-act="int-fixa" data-ia="codex-cli"');
    expect(detalhes.innerHTML).toContain('data-act="int-pilula" data-ia="codex-cli" aria-expanded="true"');

    e = mudar(e, { tipo: "modo", modo: "auto" });
    atualizarGaveta(e, suja);
    expect(detalhes.innerHTML).toContain('aria-checked="true" data-act="int-modo" data-modo="auto"');
    expect(detalhes.innerHTML).toContain("<b>Ordem</b>");
    expect(detalhes.innerHTML).toContain("data-alca-ordem");

    e = mudar(e, { tipo: "ordem", ordem: ["codex-cli", "claude-cli"] });
    atualizarGaveta(e, suja);
    expect(detalhes.innerHTML).toContain("Ordem própria de Clarice");
    expect(detalhes.innerHTML.indexOf('data-ordem-item="codex-cli"')).toBeLessThan(detalhes.innerHTML.indexOf('data-ordem-item="claude-cli"'));

    e = mudar(e, { tipo: "ordem-da-pessoa" });
    atualizarGaveta(e, suja);
    expect(detalhes.innerHTML).not.toContain("Ordem própria de Clarice");
    expect(detalhes.innerHTML.indexOf('data-ordem-item="claude-cli"')).toBeLessThan(detalhes.innerHTML.indexOf('data-ordem-item="codex-cli"'));
  });

  it("mantém a missão digitada (Missão e voz, ADR-125) durante tick e reidratação e volta a desenhar quando a mudança pendente é limpa", () => {
    let e = cenario({ tipo: "perfil" });
    atualizarGaveta(e, null);
    expect(detalhes.innerHTML).toContain('name="descricao" rows="10">Ajuda a pesquisar');
    const suja = JSON.stringify(e.gaveta);
    detalhes.innerHTML = detalhes.innerHTML.replace('name="descricao" rows="10">Ajuda a pesquisar', 'name="descricao" rows="10">Missão digitada');
    const digitado = detalhes.innerHTML;

    e = reduzir(e, { tipo: "tick", agora: 10_000 });
    atualizarGaveta(e, suja);
    expect(detalhes.innerHTML).toBe(digitado);

    e = reduzir(e, { tipo: "hidratar-frota", frota: { ...frota, agentes: frota.agentes.map((a) => ({ ...a, descricao: "Missão recebida" })) } });
    atualizarGaveta(e, suja);
    expect(detalhes.innerHTML).toBe(digitado);

    atualizarGaveta(e, null);
    expect(detalhes.innerHTML).toContain('name="descricao" rows="10">Missão recebida');
    expect(detalhes.innerHTML).not.toContain("Missão digitada");
  });

  it("devolve o foco ao modelo clicado e mantém a rolagem quando os botões são recriados", () => {
    class Botao {
      readonly attributes: { name: string; value: string }[];
      readonly dataset: Record<string, string>;
      readonly focus = vi.fn();
      constructor(dados: Record<string, string>) {
        this.dataset = dados;
        this.attributes = Object.entries(dados).map(([k, value]) => ({ name: `data-${k}`, value }));
      }
      closest() { return {}; }
      hasAttribute() { return false; }
    }
    const antes = new Botao({ act: "int-modelo", ia: "claude-cli", modelo: "haiku" });
    const opus = new Botao({ act: "int-modelo", ia: "claude-cli", modelo: "opus" });
    const haiku = new Botao({ act: "int-modelo", ia: "claude-cli", modelo: "haiku" });
    const corpoAntes = { scrollTop: 130 };
    const corpoDepois = { scrollTop: 0 };
    let consultasCorpo = 0;
    let e = mudar(cenario(), { tipo: "pilula", ia: "claude-cli" });
    atualizarGaveta(e, null);
    vi.stubGlobal("HTMLButtonElement", Botao);
    vi.stubGlobal("CSS", { escape: (s: string) => s });
    vi.stubGlobal("document", {
      activeElement: antes,
      getElementById: () => detalhes,
      querySelector: (seletor: string) => {
        if (seletor === "#detalhes .gv-corpo") return consultasCorpo++ === 0 ? corpoAntes : corpoDepois;
        const atributos = [...seletor.matchAll(/\[data-([^=]+)="([^"]+)"\]/g)];
        return [opus, haiku].find((b) => atributos.every(([, k, valor]) => b.dataset[k!] === valor)) ?? null;
      },
    });

    e = mudar(e, { tipo: "modelo", ia: claude(e), modelo: "haiku" });
    atualizarGaveta(e, JSON.stringify(e.gaveta));
    expect(haiku.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(opus.focus).not.toHaveBeenCalled();
    expect(corpoDepois.scrollTop).toBe(130);
  });

  it("devolve o foco à alça da mesma IA depois de mudar a ordem", () => {
    class Alca {
      readonly ia: string;
      readonly dataset = {};
      readonly attributes = [{ name: "data-alca-ordem", value: "" }];
      readonly focus = vi.fn();
      constructor(ia: string) { this.ia = ia; }
      closest(seletor: string) { return seletor === "[data-ordem-item]" ? { dataset: { ordemItem: this.ia } } : {}; }
      hasAttribute(nome: string) { return nome === "data-alca-ordem"; }
    }
    let e = cenario();
    atualizarGaveta(e, null);
    const claude = new Alca("claude-cli");
    const codex = new Alca("codex-cli");
    vi.stubGlobal("HTMLButtonElement", Alca);
    vi.stubGlobal("CSS", { escape: (s: string) => s });
    vi.stubGlobal("document", {
      activeElement: new Alca("codex-cli"),
      getElementById: () => detalhes,
      querySelector: (seletor: string) => {
        const ia = seletor.match(/\[data-ordem-item="([^"]+)"\]/)?.[1];
        return [claude, codex].find((b) => b.ia === ia) ?? null;
      },
    });

    e = mudar(e, { tipo: "ordem", ordem: ["codex-cli", "claude-cli"] });
    atualizarGaveta(e, JSON.stringify(e.gaveta));
    expect(codex.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(claude.focus).not.toHaveBeenCalled();
  });
});
