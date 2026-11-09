import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { criarQuadroNaTela } from "../../../web/lib/quadro-na-tela.ts";
import { conversaDaTrilha, criarTrilhaDaConversa, type ConversaAVista } from "../../../web/lib/trilha-conversa.ts";

/**
 * NOD-422 (revisão do PR #630, achado alto): "conversa de membro aberta" (abrir a conversa de um bot responsável no quadro
 * sem mandar mensagem em 60 s) conta só a Conversa à vista, nunca o Quadro do bot.
 */
const ENG = "11111111-1111-4111-8111-111111111111";
const T = "22222222-2222-4222-8222-222222222222";

function palco() {
  let tela: { tipo: "conversa"; agenteId: string; conversaId: string } | { tipo: "outra" } = { tipo: "outra" };
  let modo: "conversa" | "quadro" = "conversa";
  const adiados: (() => void)[] = [];
  const emitir = vi.fn();
  const trilha = criarTrilhaDaConversa({
    aVista: (): ConversaAVista | null => (tela.tipo === "conversa" && modo === "conversa" ? { agenteId: tela.agenteId, conversaId: tela.conversaId } : null),
    emitir,
    adiar: (fn) => { adiados.push(fn); },
  });
  const assentar = () => { while (adiados.length) adiados.shift()!(); };
  return {
    emitir, trilha, assentar,
    irPara: (conversaId: string) => { tela = { tipo: "conversa", agenteId: ENG, conversaId }; modo = "conversa"; trilha.observar(); },
    aba: (m: "conversa" | "quadro") => { modo = m; trilha.observar(); },
    sair: () => { tela = { tipo: "outra" }; trilha.observar(); },
  };
}

describe("a trilha da conversa aberta (revisão do PR #630)", () => {
  it("abrir a conversa do bot conta uma vez; redesenhar a mesma conversa não repete", () => {
    const p = palco();
    p.irPara("c1");
    p.trilha.observar();
    p.assentar();
    p.trilha.observar();
    p.assentar();
    expect(p.emitir).toHaveBeenCalledTimes(1);
    expect(p.emitir).toHaveBeenCalledWith({ acao: "conversa_aberta", agenteId: ENG, conversaId: "c1" });
  });

  it("ir ao Quadro do bot (navegar e abrir o Quadro no mesmo passo: link, código, ir para a tarefa) não conta", () => {
    const p = palco();
    p.irPara("c1");
    p.aba("quadro");
    p.assentar();
    expect(p.emitir).not.toHaveBeenCalled();
    // Trocar entre abas do Quadro e sair dele para outra tela também não.
    p.sair();
    p.assentar();
    expect(p.emitir).not.toHaveBeenCalled();
  });

  it("do Quadro de volta à Conversa conta; voltar ao Quadro e sair não conta de novo", () => {
    const p = palco();
    p.irPara("c1");
    p.aba("quadro");
    p.assentar();
    p.aba("conversa");
    p.assentar();
    expect(p.emitir).toHaveBeenCalledTimes(1);
    p.aba("quadro");
    p.assentar();
    expect(p.emitir).toHaveBeenCalledTimes(1);
  });

  it("quadroNaTela.aCaminhoDoQuadro: o link ou o código esperando o quadro do bot", () => {
    const doc = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {}, activeElement: null } as unknown as Document;
    const api = { comentariosDaTarefa: vi.fn(async () => ({ comentarios: [] })) } as never;
    const tela = criarQuadroNaTela(doc, { reduzido: () => true, dados: { api: () => api, agente: (() => null) as never, hora: () => "10:00" } });
    expect(tela.aCaminhoDoQuadro(ENG)).toBe(false);
    // O link antes de o quadro ser liberado (chave nula): a conversa por baixo não é "a conversa aberta".
    tela.abrirTarefa(ENG, T);
    expect(tela.aCaminhoDoQuadro(ENG)).toBe(true);
    expect(tela.aCaminhoDoQuadro("33333333-3333-4333-8333-333333333333")).toBe(false);
  });

  it("main.ts: navegar não grava conversa_aberta direto; a trilha olha a Conversa à vista (modo e Quadro a caminho)", () => {
    const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
    expect(main).not.toMatch(/trilharQuadro\(\{\s*acao:\s*"conversa_aberta"/);
    expect(main).toMatch(/criarTrilhaDaConversa\(\{[\s\S]{0,120}conversaDaTrilha\(\{[^}]*escolhida: conversaEscolhida, botsAbertos: celular\.botsAbertos\(\), espaco: !!estado\.espaco, perfil: !!estado\.perfilCelular, modo: quadroNaTela\.modo\(\)/);
    const navegar = main.slice(main.indexOf("function navegar(tela: Tela"), main.indexOf("function telaDeOrigem"));
    expect(navegar).toMatch(/conversaEscolhida = tela\.tipo === "conversa" \? tela\.conversaId : null;[\s\S]*trilhaDaConversa\.observar\(\)/);
    // Só o navegar e a volta do Quadro à Conversa armam a conversa: o reducer (resolverInicio) a põe na tela sem passar por aqui.
    expect(main.match(/conversaEscolhida = /g)).toHaveLength(2);
    expect(main).toMatch(/aoTrocar: \(m\) => \{[\s\S]{0,200}if \(m === "conversa"\) \{ if \(estado\.tela\.tipo === "conversa"\) conversaEscolhida = estado\.tela\.conversaId;/);
    expect(main).toMatch(/perfil: !!estado\.perfilCelular/);
    // Revisão 4: a visita nova é marcada antes do entrarNaConversa (que redesenha e observa). A trilha já não conta 2 vezes
    // na ordem trocada (os testes de comportamento abaixo); a ordem só evita agendar uma conta que será descartada.
    expect(navegar.indexOf("trilhaDaConversa.nova()")).toBeGreaterThan(-1);
    expect(navegar.indexOf("trilhaDaConversa.nova()")).toBeLessThan(navegar.indexOf("celular.entrarNaConversa()"));
  });

  it("main.ts (revisão 3 do PR #630): a inicial à vista fecha o perfil no estado; a busca aberta da inicial é escolha nova", () => {
    const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
    // O voltar do sistema mostra a inicial sem passar pelo ‹ do perfil: o perfil guardado encobriria a conversa do mesmo bot.
    expect(main).toMatch(/criarCelular\(\(\) => \{\s*if \(celular\.botsAbertos\(\) && estado\.perfilCelular\) dispatch\(\{ tipo: "perfil-celular", perfil: null \}\);/);
    expect(main).toMatch(/buscaDaInicial = celular\.botsAbertos\(\);\s*celular\.fecharBots\(\);\s*buscaCelular\.abrir\(\);/);
    expect(main).toMatch(/abrirBot: \(agenteId, conversaId\) => \{[\s\S]{0,160}if \(buscaDaInicial\) trilhaDaConversa\.nova\(\);\s*buscaDaInicial = false;\s*navegar\(/);
  });

  describe("revisão 4 do PR #630 (achado alto): conversa_aberta não conta 2 vezes no celular", () => {
    const tela = { tipo: "conversa", agenteId: ENG, conversaId: "c1" };
    const base = { tela, escolhida: "c1", botsAbertos: false, espaco: false, perfil: false, modo: "conversa" as "conversa" | "quadro", aCaminhoDoQuadro: () => false };
    function celular(inicio: Partial<typeof base> = {}) {
      let v = { ...base, ...inicio };
      const emitir = vi.fn();
      const adiados: (() => void)[] = [];
      const trilha = criarTrilhaDaConversa({ aVista: () => conversaDaTrilha(v), emitir, adiar: (fn) => { adiados.push(fn); } });
      return {
        emitir, trilha,
        mudar: (n: Partial<typeof base>) => { v = { ...v, ...n }; },
        /** Um desenho: muda o estado e observa (como o render). */
        desenhar: (n: Partial<typeof base> = {}) => { v = { ...v, ...n }; trilha.observar(); },
        assentar: () => { while (adiados.length) adiados.shift()!(); },
        agendadas: () => adiados.length,
      };
    }

    it("observar, nova e observar, depois o adiado: 1 evento", () => {
      const c = celular();
      c.trilha.observar();
      c.trilha.nova();
      c.trilha.observar();
      // A nova() com a conta ainda adiada não abre outra visita: nada mais é agendado.
      expect(c.agendadas()).toBe(1);
      c.assentar();
      expect(c.emitir).toHaveBeenCalledTimes(1);
    });

    it("sair da vista e voltar antes de o adiado rodar: só a última conta agendada emite", () => {
      const c = celular();
      c.desenhar();
      c.desenhar({ modo: "quadro" });
      c.desenhar({ modo: "conversa" });
      c.assentar();
      expect(c.emitir).toHaveBeenCalledTimes(1);
    });

    for (const ordem of ["nova antes de entrar (o navegar de hoje)", "entrar antes de nova (a ordem antiga)"] as const) {
      it(`tocar de novo, na inicial, a conversa que estava por baixo: 1 evento (${ordem})`, () => {
        // A visita anterior já contou; a inicial a encobriu.
        const c = celular();
        c.desenhar();
        c.assentar();
        c.desenhar({ botsAbertos: true });
        expect(c.emitir).toHaveBeenCalledTimes(1);
        // navegar até a mesma conversa: entrarNaConversa fecha a inicial e redesenha (observa); depois o dispatch e o observar.
        const entrar = () => c.desenhar({ botsAbertos: false });
        if (ordem.startsWith("nova")) { c.trilha.nova(); entrar(); } else { entrar(); c.trilha.nova(); }
        c.desenhar({ escolhida: "c1" });
        c.assentar();
        expect(c.emitir).toHaveBeenCalledTimes(2);
      });
    }

    for (const ordem of ["nova antes de entrar (o navegar de hoje)", "entrar antes de nova (a ordem antiga)"] as const) {
      it(`a busca aberta da inicial, de volta à mesma conversa: 1 evento (${ordem})`, () => {
        const c = celular();
        c.desenhar();
        c.assentar();
        c.desenhar({ botsAbertos: true });
        // Lupa na inicial: fecharBots + a busca por cima (a conversa de antes já contou nesta visita).
        c.desenhar({ botsAbertos: false });
        // Escolher a conversa: sairPara faz history.back(); o popstate reabre a inicial.
        c.desenhar({ botsAbertos: true });
        // abrirBot: nova() (busca da inicial) e navegar: nova() por vir da inicial, entrarNaConversa (fecha a inicial e
        // redesenha), o dispatch e o observar.
        c.trilha.nova();
        const entrar = () => c.desenhar({ botsAbertos: false });
        if (ordem.startsWith("nova")) { c.trilha.nova(); entrar(); } else { entrar(); c.trilha.nova(); }
        c.desenhar();
        c.assentar();
        expect(c.emitir).toHaveBeenCalledTimes(2);
      });
    }

    it("a mesma busca indo a outra conversa: conta só a nova, uma vez", () => {
      const c = celular();
      c.desenhar();
      c.assentar();
      c.desenhar({ botsAbertos: true });
      c.trilha.nova();
      c.desenhar({ botsAbertos: false });
      c.desenhar({ tela: { tipo: "conversa", agenteId: ENG, conversaId: "c2" }, escolhida: "c2" });
      c.assentar();
      expect(c.emitir.mock.calls.map(([e]) => (e as { conversaId: string }).conversaId)).toEqual(["c1", "c2"]);
    });
  });

  describe("conversaDaTrilha (revisão 2 do PR #630, achado médio)", () => {
    const tela = { tipo: "conversa", agenteId: ENG, conversaId: "c1" };
    const base = { tela, escolhida: "c1", botsAbertos: false, espaco: false, perfil: false, modo: "conversa" as const, aCaminhoDoQuadro: () => false };
    it("a conversa escolhida e à vista conta", () => {
      expect(conversaDaTrilha(base)).toEqual({ agenteId: ENG, conversaId: "c1" });
    });
    it("a conversa que o reducer pôs ao abrir o app (sem navegar) não conta", () => {
      expect(conversaDaTrilha({ ...base, escolhida: null })).toBeNull();
      expect(conversaDaTrilha({ ...base, escolhida: "c2" })).toBeNull();
    });
    it("a inicial do celular, Seu espaço ou o perfil por cima encobrem; o modo Quadro ou o Quadro a caminho não contam", () => {
      expect(conversaDaTrilha({ ...base, botsAbertos: true })).toBe("encoberta");
      expect(conversaDaTrilha({ ...base, espaco: true })).toBe("encoberta");
      expect(conversaDaTrilha({ ...base, perfil: true })).toBe("encoberta");
      expect(conversaDaTrilha({ ...base, modo: "quadro" })).toBeNull();
      expect(conversaDaTrilha({ ...base, aCaminhoDoQuadro: (a) => a === ENG })).toBeNull();
      expect(conversaDaTrilha({ ...base, tela: { tipo: "sala", conversaId: "c1" } })).toBeNull();
    });
    it("no celular: abrir o app na inicial não conta; tocar no bot (navegar) conta uma vez", () => {
      let v = { ...base, escolhida: null as string | null, botsAbertos: true };
      const emitir = vi.fn();
      const adiados: (() => void)[] = [];
      const trilha = criarTrilhaDaConversa({ aVista: () => conversaDaTrilha(v), emitir, adiar: (fn) => { adiados.push(fn); } });
      trilha.observar();
      v = { ...v, botsAbertos: false };
      trilha.observar();
      while (adiados.length) adiados.shift()!();
      expect(emitir).not.toHaveBeenCalled();
      v = { ...v, escolhida: "c1" };
      trilha.observar();
      while (adiados.length) adiados.shift()!();
      expect(emitir).toHaveBeenCalledTimes(1);
    });
    it("revisão 3: abrir e fechar Seu espaço (ou girar o celular) não reconta; Ver perfil não conta até o perfil fechar", () => {
      let v = { ...base };
      const emitir = vi.fn();
      const adiados: (() => void)[] = [];
      const trilha = criarTrilhaDaConversa({ aVista: () => conversaDaTrilha(v), emitir, adiar: (fn) => { adiados.push(fn); } });
      const passo = (n: Partial<typeof v>) => { v = { ...v, ...n }; trilha.observar(); while (adiados.length) adiados.shift()!(); };
      passo({});
      expect(emitir).toHaveBeenCalledTimes(1);
      for (let i = 0; i < 3; i++) { passo({ espaco: true }); passo({ espaco: false }); passo({ botsAbertos: true }); passo({ botsAbertos: false }); }
      expect(emitir).toHaveBeenCalledTimes(1);
      // Ver perfil (lista do celular): navega à conversa e o perfil cobre no mesmo passo.
      v = { ...v, escolhida: "c2", tela: { tipo: "conversa", agenteId: ENG, conversaId: "c2" }, perfil: true };
      trilha.observar();
      while (adiados.length) adiados.shift()!();
      expect(emitir).toHaveBeenCalledTimes(1);
      passo({ perfil: false });
      expect(emitir).toHaveBeenCalledTimes(2);
    });
    it("revisão 3: escolher de novo a mesma conversa vindo da inicial do celular (nova) conta outra visita", () => {
      let v = { ...base };
      const emitir = vi.fn();
      const trilha = criarTrilhaDaConversa({ aVista: () => conversaDaTrilha(v), emitir, adiar: (fn) => fn() });
      trilha.observar();
      v = { ...v, botsAbertos: true };
      trilha.observar();
      v = { ...v, botsAbertos: false };
      trilha.nova();
      trilha.observar();
      expect(emitir).toHaveBeenCalledTimes(2);
    });
  });
});
