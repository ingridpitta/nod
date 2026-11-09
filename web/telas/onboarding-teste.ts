import type { IaDesktop, NodDesktop, ResultadoIaDesktop, TesteDeIa } from "../../src/contracts/desktop.ts";
import type { EstadoOnboarding } from "../../src/contracts/onboarding.ts";
import {
  conexaoDepoisDoLogin, conexaoDepoisDoVeredito, deveTestar, iaQueRespondeu, lerTestesDeIa, nomeParaOTeste, notaForaDoApp, ORDEM_IAS, proximoDaConexao, servidorDeAcordo,
  situacaoDaIa, testeSeAplica, type ConexaoIa, type TesteNaTela, type Vereditos,
} from "./onboarding.ts";

/**
 * O teste de verdade das IAs do Mac no onboarding (definido em 2026-10-05). Medido em produção nesse dia: uma conta do
 * Claude Code LOGADA, de uma organização que desativou o uso por assinatura, passava como pronta; a guia ligava, dizia
 * a primeira frase e ficava muda. Aqui mora o que a tela guarda desse teste — a promessa do "olá", o veredito de cada
 * IA, a conexão em três passos, o "pode ligar" — e o que ela faz sozinha a cada leitura do servidor.
 *
 * Sem DOM, de propósito: a ponte do Mac, os timers e o que mexe na tela chegam por `deps`, e
 * tests/unit/web/onboarding-teste.test.ts roda isto com uma ponte falsa. As decisões são as funções puras de
 * onboarding.ts; o controlador (onboarding-controle.ts) liga isto ao "olá", à sonda de 3 s e aos cliques.
 */

/** definido em 2026-10-05: o teste é um turno de uma frase; sem veredito neste prazo a tela para de girar e trata as
 * IAs logadas como "não respondeu ao teste" (com "Testar de novo"). O veredito do "olá" que chegar depois ainda vale. */
export const TESTE_IA_MAX_MS = 60_000;
/** definido em 2026-10-05: depois do "Continuar", quantas leituras do servidor (uma a cada 3 s) a tela espera ele
 * reconhecer a IA que o Mac acabou de testar antes de pedir a ligação assim mesmo (o servidor decide; sem IA para ele,
 * o onboarding segue sem voz, como já seguia). */
export const LEITURAS_ESPERANDO_O_SERVIDOR = 4;
/** definido em 2026-10-05: quantas vezes por IA a tela testa SOZINHA (o servidor passou a dar a IA como logada). Cada
 * teste pode gastar uma resposta da assinatura da pessoa; se o app e o servidor ficarem se alternando, a tela para e
 * sobra o botão ("Testar de novo", "Testar agora"), que não tem teto. */
export const TESTES_SOZINHOS_MAX = 3;

export type PonteDeIa = Pick<NodDesktop, "iaTestar" | "iaEntrar" | "iaInstalar">;

export type DepsTesteDeIas = {
  /** `window.nodDesktop`: só existe dentro do app do Mac, e `iaTestar` só no app de 2026-10-05 em diante. */
  ponte: () => PonteDeIa | undefined;
  dados: () => EstadoOnboarding | null | undefined;
  /** Um timer que devolve como cancelar (window.setTimeout na página). */
  agendar: (fn: () => void, ms: number) => () => void;
  aoMudar: () => void;
  /** Relê `GET onboarding`: depois de um teste o Mac reanuncia o inventário ao servidor. */
  reler: () => Promise<void>;
  /** O teste do "olá" voltou, ou não vai voltar (`ativo()` diz qual): quem decide a tela é o controlador. */
  aoFimDoTeste: () => void;
  /** Pede a ligação (a etapa 'chamando'); `ligando` = o pedido já saiu. */
  ligar: () => Promise<void>;
  ligando: () => boolean;
  /** A ligação ainda não pode tocar: a tela fica na etapa "A IA dos seus bots". */
  ficarNaEtapaDaIa: () => Promise<void>;
};

export type TesteDeIas = ReturnType<typeof criarTesteDeIas>;

export function criarTesteDeIas(deps: DepsTesteDeIas) {
  /**
   * "nao" = ainda não começou; "sem" = não há teste (sem a ponte, o Mac recusou, ou quem roda os bots é o servidor) e
   * a tela segue pelo login, como em 2026-10-04; "rodando"/"terminou" = o teste manda.
   */
  let estado: "nao" | "rodando" | "terminou" | "sem" = "nao";
  let vereditos: Vereditos = {};
  let testando: IaDesktop[] = [];
  /** Por IA: o servidor já disse "não pronto" depois do último veredito (um login novo é o que faz testar de novo). */
  let vistoNaoPronto: Partial<Record<IaDesktop, boolean>> = {};
  let testesSozinhos: Partial<Record<IaDesktop, number>> = {};
  /**
   * NOD-209: as IAs trocando de conta, com o veredito da conta antiga guardado. Durante a troca a IA não é testada (o
   * servidor ainda a vê pronta, com a conta antiga); cancelar devolve o veredito, e o login novo testa a conta nova.
   */
  let trocando: Partial<Record<IaDesktop, TesteDeIa | null>> = {};
  let conexao: ConexaoIa | null = null;
  let abrindoLogin = false;
  /** A ligação pode tocar: o teste passou antes de o "olá" acabar, ou a pessoa clicou em Continuar. */
  let liberado = false;
  let leiturasEsperando = 0;
  let nome: string | null = null;
  let cancelarPrazo: (() => void) | null = null;
  /** Muda a cada sessão ou recomeço: a resposta de um teste antigo não escreve na tela nova. */
  let geracao = 0;

  const ativo = (): boolean => estado === "rodando" || estado === "terminou";
  const inventarioDe = (ia: IaDesktop) => deps.dados()?.executor.ias.find((i) => i.id === ia);

  function naTela(): TesteNaTela | null {
    return ativo() ? { rodando: estado === "rodando", vereditos, testando, conexao, seguindo: liberado, nome } : null;
  }

  function registrar(v: TesteDeIa): void {
    const noServidor = inventarioDe(v.ia)?.estado;
    vereditos = { ...vereditos, [v.ia]: v };
    vistoNaoPronto[v.ia] = noServidor !== undefined && noServidor !== "pronto";
    if (conexao?.ia === v.ia) conexao = conexaoDepoisDoVeredito(conexao, v);
  }

  /**
   * O teste, uma vez só, enquanto o "olá" aparece. `iaTestar` testa as IAs com login e devolve o veredito das duas; o
   * Mac reanuncia o resultado ao servidor por conta própria.
   */
  function iniciar(d: EstadoOnboarding): void {
    if (estado !== "nao") return;
    const ponte = deps.ponte();
    if (!ponte?.iaTestar || !testeSeAplica(true, d.executor)) { estado = "sem"; return; }
    nome = nomeParaOTeste(d.campos.apelido);
    let pedido: Promise<TesteDeIa[]>;
    try { pedido = ponte.iaTestar(nome ? { nome } : undefined); } catch { estado = "sem"; return; }
    estado = "rodando";
    const g = geracao;
    const acabar = (como: "terminou" | "sem"): void => {
      if (g !== geracao || estado !== "rodando") return;
      cancelarPrazo?.();
      cancelarPrazo = null;
      estado = como;
      deps.aoFimDoTeste();
    };
    cancelarPrazo = deps.agendar(() => {
      if (g !== geracao || estado !== "rodando") return;
      // Sem veredito no prazo: as que o servidor dá como logadas ficam "não respondeu ao teste".
      for (const ia of ORDEM_IAS) if (inventarioDe(ia)?.estado === "pronto") registrar({ ia, estado: "nao_autenticado", causa: "teste_falhou" });
      acabar("terminou");
    }, TESTE_IA_MAX_MS);
    void pedido.then((bruto) => {
      if (g !== geracao) return;
      const lidos = lerTestesDeIa(bruto);
      if (!lidos) { acabar("sem"); return; }
      for (const v of lidos) registrar(v);
      // Depois do prazo o teste já "terminou": o veredito atrasado só corrige os cards.
      if (estado === "rodando") acabar("terminou"); else if (ativo()) deps.aoFimDoTeste();
    }, () => acabar("sem"));
  }

  /** Um teste avulso: "Testar de novo", o "Testar agora" da conexão, ou a IA que o servidor passou a dar como logada. */
  async function testar(ia: IaDesktop): Promise<void> {
    const ponte = deps.ponte();
    if (!ponte?.iaTestar || testando.includes(ia) || estado === "rodando") return;
    testando = [...testando, ia];
    deps.aoMudar();
    const g = geracao;
    const pedido = { ia, ...(nome ? { nome } : {}) };
    let cancelar: () => void = () => undefined;
    const prazo = new Promise<null>((resolver) => { cancelar = deps.agendar(() => resolver(null), TESTE_IA_MAX_MS); });
    const lidos = await Promise.race([Promise.resolve().then(() => ponte.iaTestar?.(pedido)).then(lerTestesDeIa), prazo]).catch(() => null);
    cancelar();
    if (g !== geracao) return;
    testando = testando.filter((i) => i !== ia);
    // Sem veredito desta IA (o Mac recusou, não respondeu no prazo ou mandou outra coisa): não respondeu ao teste.
    registrar(lidos?.find((v) => v.ia === ia) ?? { ia, estado: "nao_autenticado", causa: "teste_falhou" });
    deps.aoMudar();
    void deps.reler();
  }

  /** A ligação: com o servidor de acordo, toca já; senão as leituras da etapa esperam por ele (`aoEstadoDoServidor`). */
  async function seguir(): Promise<void> {
    if (liberado && deps.ligando()) return;
    liberado = true;
    leiturasEsperando = 0;
    deps.aoMudar();
    await deps.reler();
    const d = deps.dados();
    if (!d) return;
    if (servidorDeAcordo(d.executor.ias, vereditos)) await deps.ligar();
    else await deps.ficarNaEtapaDaIa();
  }

  /**
   * Cada leitura do servidor na etapa da IA: o que a sonda do app mudou (o CLI apareceu, um login novo) vira o próximo
   * passo sozinho. Quem chama é a mesma sonda de 3 s de 2026-10-04; nenhum laço novo.
   */
  function aoEstadoDoServidor(o: EstadoOnboarding): void {
    if (!ativo()) return;
    for (const ia of ORDEM_IAS) {
      const noServidor = o.executor.ias.find((i) => i.id === ia)?.estado;
      if (noServidor !== undefined && noServidor !== "pronto") vistoNaoPronto[ia] = true;
    }
    if (estado === "rodando") return;
    if (conexao) {
      const ia = conexao.ia;
      const proximo = proximoDaConexao(conexao, o.executor.ias.find((i) => i.id === ia));
      if (proximo === "abrir_login") void abrirLogin(ia);
      else if (proximo === "sair") {
        // O servidor já sabe por que esta conta não serve: o veredito velho da web sai e o card mostra a causa dele.
        const resto = { ...vereditos };
        delete resto[ia];
        vereditos = resto;
        conexao = null;
        deps.aoMudar();
      }
    }
    for (const ia of ORDEM_IAS) {
      if (testando.includes(ia) || ia in trocando || !deveTestar(o.executor.ias.find((i) => i.id === ia), vereditos[ia], !!vistoNaoPronto[ia])) continue;
      const feitos = testesSozinhos[ia] ?? 0;
      if (feitos >= TESTES_SOZINHOS_MAX) continue;
      testesSozinhos[ia] = feitos + 1;
      void testar(ia);
    }
    if (liberado && !deps.ligando() && iaQueRespondeu(vereditos)) {
      leiturasEsperando++;
      if (servidorDeAcordo(o.executor.ias, vereditos) || leiturasEsperando >= LEITURAS_ESPERANDO_O_SERVIDOR) { leiturasEsperando = 0; void deps.ligar(); }
    }
  }

  /** "Entrar", "Entrar com outra conta" ou "Instalar e entrar": abre os três passos e já dá o primeiro. */
  async function conectar(ia: IaDesktop, acao: "entrar" | "instalar"): Promise<void> {
    const d = deps.dados();
    if (conexao || estado === "rodando" || !d) return;
    // A conta já estava logada (o teste a reprovou): o login novo não muda o que o servidor vê.
    const outraConta = acao === "entrar" && situacaoDaIa(ia, d.executor.ias, null, naTela()).situacao === "conta_sem_acesso";
    conexao = { ia, outraConta, login: "nao", nota: null };
    deps.aoMudar();
    if (acao === "instalar") await abrirInstalacao(ia);
    else await abrirLogin(ia);
  }

  /** Um pedido à ponte do Mac que nunca lança: sem o método, ou com erro, é "falhou". */
  async function pedirAoMac(pedir: () => Promise<ResultadoIaDesktop> | undefined): Promise<ResultadoIaDesktop> {
    try { return (await pedir()) ?? { ok: false, motivo: "falhou" }; } catch { return { ok: false, motivo: "falhou" }; }
  }

  /** O primeiro passo: `iaInstalar` só abre a página oficial no navegador; quem instala é a pessoa. */
  async function abrirInstalacao(ia: IaDesktop): Promise<void> {
    const r = await pedirAoMac(() => deps.ponte()?.iaInstalar?.(ia));
    if (conexao?.ia !== ia) return;
    conexao = { ...conexao, nota: r.ok ? null : `Não deu para abrir a página de instalação. ${notaForaDoApp(ia, "instalar")}` };
    deps.aoMudar();
  }

  /** O segundo passo: o login do próprio CLI, que abre o navegador. O Mac só abre se achou o CLI. */
  async function abrirLogin(ia: IaDesktop): Promise<void> {
    if (abrindoLogin || conexao?.ia !== ia) return;
    abrindoLogin = true;
    const r = await pedirAoMac(() => deps.ponte()?.iaEntrar?.(ia));
    abrindoLogin = false;
    if (conexao?.ia !== ia) return;
    conexao = conexaoDepoisDoLogin(conexao, r);
    deps.aoMudar();
  }

  /** "Trocar conta": a IA sai do Continuar enquanto a pessoa entra com a outra conta. */
  function comecarTroca(ia: IaDesktop): void {
    if (!ativo() || ia in trocando) return;
    trocando = { ...trocando, [ia]: vereditos[ia] ?? null };
    const resto = { ...vereditos };
    delete resto[ia];
    vereditos = resto;
    deps.aoMudar();
  }

  /** O fim da troca: cancelada, volta o veredito de antes; com o login novo, a conta nova é testada já. */
  function fimDaTroca(ia: IaDesktop, trocou: boolean): void {
    if (!(ia in trocando)) return;
    const antes = trocando[ia];
    const resto = { ...trocando };
    delete resto[ia];
    trocando = resto;
    if (!trocou && antes && !vereditos[ia]) vereditos = { ...vereditos, [ia]: antes };
    if (trocou) {
      testesSozinhos[ia] = 0;
      void testar(ia);
    }
    deps.aoMudar();
  }

  /** Zera o teste e o que nasceu dele. */
  function esquecer(): void {
    geracao++;
    cancelarPrazo?.();
    cancelarPrazo = null;
    estado = "nao";
    vereditos = {};
    testando = [];
    vistoNaoPronto = {};
    testesSozinhos = {};
    trocando = {};
    nome = null;
  }

  return {
    iniciar,
    /** Há teste (rodando ou terminado)? Falso = a tela segue pelo que o servidor diz do login. */
    ativo,
    naTela,
    /** A ligação pode tocar: a pessoa seguiu e a IA que o servidor escolheria é uma que respondeu. */
    podeLigar: (d: EstadoOnboarding): boolean => liberado && servidorDeAcordo(d.executor.ias, vereditos),
    seguir,
    testar,
    comecarTroca,
    fimDaTroca,
    conectar,
    abrirInstalacao,
    abrirLogin,
    cancelar(): void { conexao = null; deps.aoMudar(); },
    aoEstadoDoServidor,
    /** "Ver o onboarding de novo": uma IA que já respondeu nesta página não é testada outra vez (cada teste gasta uma
     * resposta da assinatura); sem nenhuma, o teste recomeça com o "olá". */
    recomecar(): void {
      conexao = null;
      liberado = false;
      if (!iaQueRespondeu(vereditos)) esquecer();
    },
    /** Outra sessão. */
    descartar(): void {
      conexao = null;
      liberado = false;
      abrindoLogin = false;
      esquecer();
    },
  };
}
