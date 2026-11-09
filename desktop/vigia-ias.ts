import { IAS_DESKTOP, type IaDesktop, type TesteDeIa } from "../src/contracts/desktop.ts";
import { SEM_CAPACIDADES, type CapacidadesHarness } from "../src/contracts/harness.ts";
import { CAUSAS_SEM_IA, MOTIVO_DA_CAUSA, type CausaSemIa, type Inventario } from "../src/contracts/inventario.ts";
import { capacidadesDe } from "../src/domain/harness.ts";
import { sondaFoiLenta } from "../src/domain/sonda-lenta.ts";
import type { IdDriver, Registry } from "../src/adapters/executor/spi.ts";
import { nomeParaOTeste, perguntaDoTeste } from "../src/domain/conta-da-ia.ts";
import { INTERVALO_SONDA_IA_MS } from "./ia-mac.ts";

/**
 * A vigia das IAs do Mac (definido em 2026-10-05, emenda das ADR-019 e 077). Sem Electron: tudo o que toca o sistema
 * chega por `DepsVigia`, e tests/unit/desktop/vigia-ias.test.ts a exercita inteira.
 *
 * O problema que ela fecha (medido em produção em 2026-10-05): a conferência de login dizia "pronta" para uma conta do
 * Claude Code que a organização tinha bloqueado; o app anunciava a IA, o servidor mandava os turnos, e todos falhavam.
 * Aqui mora o VEREDITO do teste de verdade: uma IA logada que foi reprovada (no teste do onboarding ou num turno) é
 * anunciada como `nao_autenticado` com a causa, até um teste novo passar.
 *
 * O veredito é preso à conta: guarda a "impressão" do login (um hash do que o CLI diz sobre a conta, calculado por
 * quem chama). Mudou a impressão (a pessoa entrou com outra conta) ou passaram 24 h, a IA é testada de novo sozinha.
 * O arquivo fica no Mac; nada dele vai ao servidor além do estado e do código da causa.
 */
export type Veredito = { ia: IaDesktop; causa: CausaSemIa; impressao: string | null; em: number };

/** definido em 2026-10-05: um veredito vale um dia; depois disso a IA é testada de novo (a organização pode ter liberado). */
export const VALIDADE_VEREDITO_MS = 24 * 3_600_000;
/** definido em 2026-10-05: com outra IA pronta e uma reprovada, basta olhar a cada 30 s se a conta dela mudou. */
export const INTERVALO_COM_REPROVADA_MS = 30_000;
/**
 * definido em 2026-10-05: o reteste AUTOMÁTICO de uma IA reprovada custa um turno da assinatura. Depois do primeiro, o
 * próximo espera 1 min, e a espera dobra até 1 h. Medido nesse dia: a saída de `claude auth status` e de
 * `codex login status` não muda entre chamadas; o freio existe para o dia em que uma versão do CLI puser ali algo que
 * mude sozinho (sem ele, a vigia testaria a cada 3 s). O teste pedido pela tela e o fim de um login não esperam.
 */
export const ESPERA_RETESTE_MS = 60_000;
export const ESPERA_RETESTE_MAX_MS = 3_600_000;
/**
 * definido em 2026-10-09 (teste do Breno): com uma IA pronta, a vigia parava de olhar a outra, e o Codex instalado ou
 * logado depois nunca aparecia sem reabrir o app. Agora a outra continua sondada a cada 60 s — só a sonda GRÁTIS dela
 * (versão e login), sem tocar no registro da que está pronta (a sessão viva dela continua). O teste pago segue a regra
 * de sempre: só quando a conta muda, com o freio do reteste.
 */
export const INTERVALO_SONDA_OUTRA_IA_MS = 60_000;

type Inventarios = Partial<Record<IdDriver, Inventario>>;
/** X9: as capacidades de cada IA pronta, já com os pisos do CLI instalado (o `AnuncioMaquina.capacidades`). */
export type CapacidadesAnunciadas = Partial<Record<IaDesktop, CapacidadesHarness>>;
export type Sondagem = { registry: Registry; inventarios: Inventarios };

export type DepsVigia = {
  /**
   * A conferência de LOGIN de cada IA (grátis): um registry novo e o inventário de cada driver. Com `ias`, só essas
   * (definido em 2026-10-09: a sonda da outra IA com uma já pronta); o registry devolvido pode não trazer as demais.
   */
  sondar(ias?: readonly IaDesktop[]): Promise<Sondagem>;
  /** A impressão da conta logada nesta IA; null quando não dá para saber. */
  impressao(ia: IaDesktop): Promise<string | null>;
  /**
   * Manda o inventário ao servidor (o `conectar` da ponte). `principal` é a IA pronta, ou a que explica a falta.
   * `semLacoDeVoz` (NOD-167): as prontas que não atendem ligação (o Codex sem `app-server`). `capacidades` (X9,
   * definido em 2026-10-08): o que cada IA pronta sabe fazer neste Mac.
   */
  anunciar(inventarios: Inventarios, principal: Inventario, semLacoDeVoz: IaDesktop[], capacidades: CapacidadesAnunciadas): Promise<void>;
  /** Uma IA ficou pronta: `registry` é o que o laço deve usar (chamado a cada mudança, não só na primeira). */
  aoRegistry(registry: Registry, algumaPronta: boolean): void;
  ler(): Promise<unknown>;
  gravar(vereditos: Veredito[]): Promise<void>;
  agora(): number;
  /** Timer injetável (o teste avança o relógio à mão). */
  agendar(fn: () => void, ms: number): { cancelar(): void };
  /** definido em 2026-10-09: o inventário de cada passada (já com os vereditos), para o estado único da IA na tela. */
  aoInventarios?(inventarios: Inventarios): void;
  /** definido em 2026-10-09: as IAs com o teste de verdade rodando agora (o estado "testando"). */
  aoTestando?(ias: IaDesktop[]): void;
};

export type VigiaDasIas = {
  /** Primeira passada, com a sondagem que o app já fez ao conectar. */
  iniciar(inicial: Sondagem): Promise<void>;
  /** O teste de verdade pedido pela tela (onboarding, "Testar de novo"). Chamadas simultâneas esperam o mesmo teste. */
  testar(pedido: unknown): Promise<TesteDeIa[]>;
  /** Um turno voltou dizendo que a conta desta IA não serve. */
  reprovar(ia: IaDesktop, causa: CausaSemIa): Promise<void>;
  /**
   * O login desta IA acabou de terminar: a pessoa pode ter entrado com outra conta. Se a IA estava reprovada, é testada
   * de novo agora (o `codex login status` não diz qual é a conta, então a impressão sozinha não perceberia).
   */
  contaMudou(ia: IaDesktop): Promise<void>;
  /**
   * O servidor não reconhece mais esta máquina (409 no `puxar`: ele reiniciou). O último inventário é anunciado de
   * novo, mesmo sem nada ter mudado; sem isto a fila da pessoa fica parada até ela reabrir o app.
   */
  reanunciar(): Promise<void>;
  /** definido em 2026-10-09: o "Verificar" da tela — uma passada agora (sonda grátis; reteste só pela regra de sempre). */
  sondarAgora(): Promise<void>;
  /** As IAs com o teste de verdade rodando agora. */
  testando(): IaDesktop[];
  parar(): void;
};

/** O arquivo de vereditos vem do disco: só o que tem a forma certa e ainda vale entra. */
export function lerVereditos(v: unknown, agora: number): Veredito[] {
  if (!Array.isArray(v)) return [];
  const saida: Veredito[] = [];
  for (const bruto of v as unknown[]) {
    if (!bruto || typeof bruto !== "object") continue;
    const x = bruto as Record<string, unknown>;
    const ia = IAS_DESKTOP.find((i) => i === x.ia);
    const causa = CAUSAS_SEM_IA.find((c) => c === x.causa);
    if (!ia || !causa || typeof x.em !== "number" || !Number.isFinite(x.em) || x.em > agora || agora - x.em > VALIDADE_VEREDITO_MS) continue;
    if (saida.some((s) => s.ia === ia)) continue;
    saida.push({ ia, causa, impressao: typeof x.impressao === "string" ? x.impressao : null, em: x.em });
  }
  return saida;
}

const reprovado = (causa: CausaSemIa, base: Inventario | undefined, agora: number): Inventario => ({
  estado: "nao_autenticado",
  motivo: MOTIVO_DA_CAUSA[causa],
  causa,
  ...(base && "versao" in base && base.versao ? { versao: base.versao } : {}),
  em: agora,
});

const AUSENTE = (agora: number): Inventario => ({ estado: "ausente", motivo: "Conecte sua conta de IA", em: agora });

export function criarVigiaDasIas(d: DepsVigia): VigiaDasIas {
  const vereditos = new Map<IaDesktop, Veredito>();
  let carregados = false;
  let ultimoAnuncio: string | null = null;
  /**
   * NOD-199: o último anúncio falhou (servidor fora, servidor antigo com turno rodando…). Sem isto, com todas as IAs
   * prontas, nada reagendava e a IA nova só chegava ao servidor ao reabrir o app.
   */
  let anuncioPendente = false;
  let ultima: Sondagem | null = null;
  let ultimosInventarios: Inventarios | null = null;
  let timer: { cancelar(): void } | null = null;
  let parado = false;
  let ocupado: Promise<unknown> = Promise.resolve();
  let testeEmCurso: Promise<TesteDeIa[]> | null = null;
  /** O freio do reteste automático, por IA: quando foi o último e quanto esperar até o próximo. */
  const retestes = new Map<IaDesktop, { em: number; espera: number }>();
  /** IAs cujo login acabou de terminar: o veredito delas não vale até o próximo teste. */
  const forcadas = new Set<IaDesktop>();
  /** definido em 2026-10-09: as IAs com o teste de verdade em curso (o estado "testando" da tela). */
  const emTeste = new Set<IaDesktop>();
  const mudarTeste = (ia: IaDesktop, rodando: boolean) => {
    if (rodando) emTeste.add(ia); else emTeste.delete(ia);
    d.aoTestando?.([...emTeste]);
  };

  async function carregar(): Promise<void> {
    if (carregados) return;
    carregados = true;
    for (const v of lerVereditos(await d.ler().catch(() => null), d.agora())) vereditos.set(v.ia, v);
  }
  const guardar = () => d.gravar([...vereditos.values()]).catch(() => undefined);

  /** Uma coisa por vez: a passada do timer, o teste pedido pela tela e o veredito de um turno não se atropelam. */
  function emFila<T>(fn: () => Promise<T>): Promise<T> {
    const r = ocupado.then(fn, fn);
    ocupado = r.catch(() => undefined);
    return r;
  }

  /** Roda o teste de verdade de uma IA logada e atualiza o veredito. Devolve o inventário já ajustado e a resposta. */
  async function testarUma(ia: IaDesktop, s: Sondagem, pergunta: string): Promise<{ inventario: Inventario; resposta: string | null }> {
    const registro = s.registry[ia];
    const testar = registro?.estado === "pronto" ? registro.instance.testar?.bind(registro.instance) : undefined;
    // Driver sem teste (app montado sem ele): vale o que a conferência de login disse.
    if (!testar) return { inventario: s.inventarios[ia] ?? AUSENTE(d.agora()), resposta: null };
    mudarTeste(ia, true);
    const t = await testar(pergunta)
      .catch((): { inventario: Inventario; resposta: null } => ({ inventario: reprovado("teste_falhou", s.inventarios[ia], d.agora()), resposta: null }))
      .finally(() => mudarTeste(ia, false));
    forcadas.delete(ia);
    // NOD-178: sonda lenta não é veredito do teste: não vira reprovação (que acionaria o freio do reteste) nem apaga
    // a que já existia (a conta reprovada voltaria a "pronto" só porque o Mac estava carregado).
    if (sondaFoiLenta(t.inventario)) return t;
    if (t.inventario.estado === "pronto") { vereditos.delete(ia); retestes.delete(ia); }
    else if (t.inventario.estado === "nao_autenticado" && t.inventario.causa && t.inventario.causa !== "sonda_lenta" && t.inventario.causa !== "limite") vereditos.set(ia, { ia, causa: t.inventario.causa, impressao: await d.impressao(ia).catch(() => null), em: d.agora() });
    else vereditos.delete(ia);
    // Quem chama grava o arquivo uma vez no fim: dois testes rodam ao mesmo tempo e não podem disputar a escrita.
    return t;
  }

  /**
   * Aplica os vereditos à sondagem de login. `retestar`: a IA está logada, tinha veredito e a conta mudou (ou ele
   * venceu) — é testada agora. Devolve o inventário que vai ao servidor.
   */
  async function ajustar(s: Sondagem, opcoes: { retestar: boolean }): Promise<Inventarios> {
    const saida: Inventarios = { ...s.inventarios };
    let mudou = false;
    for (const ia of IAS_DESKTOP) {
      const v = vereditos.get(ia);
      if (!v) continue;
      const inv = s.inventarios[ia];
      // Sem login não há o que reprovar: o estado de login já diz tudo, e o veredito antigo perde o sentido.
      if (inv?.estado !== "pronto") { vereditos.delete(ia); forcadas.delete(ia); mudou = true; continue; }
      const impressao = await d.impressao(ia).catch(() => null);
      const forcada = forcadas.has(ia);
      const vale = !forcada && d.agora() - v.em <= VALIDADE_VEREDITO_MS && impressao === v.impressao;
      if (vale) { saida[ia] = reprovado(v.causa, inv, d.agora()); continue; }
      if (!opcoes.retestar) { vereditos.delete(ia); mudou = true; continue; }
      const freio = retestes.get(ia);
      // Dentro da espera, a IA continua reprovada sem gastar outro turno; o fim de um login não espera.
      if (!forcada && freio && d.agora() - freio.em < freio.espera) { saida[ia] = reprovado(v.causa, inv, d.agora()); continue; }
      retestes.set(ia, { em: d.agora(), espera: freio ? Math.min(freio.espera * 2, ESPERA_RETESTE_MAX_MS) : ESPERA_RETESTE_MS });
      saida[ia] = (await testarUma(ia, s, perguntaDoTeste(null))).inventario;
      mudou = true;
    }
    if (mudou) await guardar();
    return saida;
  }

  /** NOD-167: as IAs prontas cujo motor diz que não roda o laço de voz; "não sei" (null) não entra. */
  async function semLacoDeVoz(s: Sondagem, inventarios: Inventarios): Promise<IaDesktop[]> {
    const saida: IaDesktop[] = [];
    for (const ia of IAS_DESKTOP) {
      const reg = s.registry[ia];
      if (inventarios[ia]?.estado !== "pronto" || reg?.estado !== "pronto" || !reg.instance.lacoDeVoz) continue;
      if ((await reg.instance.lacoDeVoz().catch(() => null)) === false) saida.push(ia);
    }
    return saida;
  }

  /**
   * X9 (definido em 2026-10-08, revisão do épico #188): a promessa de cada driver pronto, ajustada pela sonda do CLI
   * (`Instance.capacidades`). O servidor só promove pela rede de 2 min quando a máquina anunciou `bifurcaSessao`. Sonda
   * que falha anuncia nenhuma capacidade: o servidor segue o caminho sem ela, nunca promete o que o CLI não faz.
   */
  async function capacidadesAnunciadas(s: Sondagem, inventarios: Inventarios): Promise<CapacidadesAnunciadas> {
    const saida: CapacidadesAnunciadas = {};
    for (const ia of IAS_DESKTOP) {
      const reg = s.registry[ia];
      if (inventarios[ia]?.estado !== "pronto" || reg?.estado !== "pronto") continue;
      const promessa = reg.driver.meta.capacidades ?? capacidadesDe(ia);
      saida[ia] = reg.instance.capacidades ? await reg.instance.capacidades().catch(() => SEM_CAPACIDADES) : promessa;
    }
    return saida;
  }

  /** Devolve o erro do anúncio (ou null): a falha fica em `anuncioPendente`, nunca pula o `reagendar` de quem chamou. */
  async function publicar(s: Sondagem, inventarios: Inventarios): Promise<unknown> {
    // A principal é a pronta; sem nenhuma, a que melhor explica a falta: a reprovada no teste, depois a sem login.
    const todos = Object.values(inventarios);
    const principal = todos.find((i) => i?.estado === "pronto")
      ?? todos.find((i) => i?.estado === "nao_autenticado" && i.causa && i.causa !== "sonda_lenta")
      ?? todos.find((i) => i?.estado === "nao_autenticado")
      ?? inventarios["claude-cli"] ?? AUSENTE(d.agora());
    // Só o que muda a decisão do servidor entra na chave: o instante de cada sonda não é novidade.
    // NOD-178: a causa conta também em 'ausente': "ausente lento" → "ausente de verdade" tem de chegar ao servidor.
    // NOD-167: o Codex atualizado (ganhou o app-server) também é novidade, mesmo com o estado igual.
    const semVoz = await semLacoDeVoz(s, inventarios);
    // X9: o CLI atualizado (ganhou `--fork-session`) também é novidade.
    const capacidades = await capacidadesAnunciadas(s, inventarios);
    const chave = JSON.stringify([IAS_DESKTOP.map((ia) => { const i = inventarios[ia]; return [ia, i?.estado ?? null, i && i.estado !== "pronto" ? i.causa ?? null : null]; }), semVoz, capacidades]);
    ultima = s;
    ultimosInventarios = inventarios;
    d.aoInventarios?.(inventarios);
    d.aoRegistry(s.registry, principal.estado === "pronto");
    if (chave === ultimoAnuncio) { anuncioPendente = false; return null; }
    // NOD-199: a falha não sobe — quem chamou ainda tem de reagendar; a chave não é gravada e a próxima passada reanuncia.
    try { await d.anunciar(inventarios, principal, semVoz, capacidades); }
    catch (erro) { anuncioPendente = true; return erro; }
    ultimoAnuncio = chave;
    anuncioPendente = false;
    return null;
  }

  function reagendar(inventarios: Inventarios): void {
    timer?.cancelar();
    timer = null;
    if (parado) return;
    const algumaPronta = Object.values(inventarios).some((i) => i?.estado === "pronto");
    // NOD-178: uma IA lenta é sondada de novo mesmo com a outra pronta; sem isso o "tentando de novo" giraria para sempre.
    const algumaLenta = Object.values(inventarios).some((i) => i !== undefined && sondaFoiLenta(i));
    // NOD-171: uma IA desatualizada também é sondada de novo com a outra pronta (no passo lento: atualizar leva minutos),
    // para a tela cumprir "o nod percebe sozinho quando a versão nova estiver instalada".
    const algumaAntiga = Object.values(inventarios).some((i) => i?.estado === "ausente" && i.causa === "cli_antigo");
    // NOD-199: um anúncio que falhou é tentado de novo no passo da reprovada, mesmo com todas as IAs prontas.
    const ms = !algumaPronta || algumaLenta ? INTERVALO_SONDA_IA_MS : vereditos.size > 0 || algumaAntiga || anuncioPendente ? INTERVALO_COM_REPROVADA_MS : null;
    if (ms !== null) {
      timer = d.agendar(() => { void emFila(passada).catch(() => undefined); }, ms);
      return;
    }
    // revisto em 2026-10-09: uma pronta e outra não — a outra continua sondada (grátis), sem mexer na pronta.
    const outras = IAS_DESKTOP.filter((ia) => ultima?.inventarios[ia]?.estado !== "pronto");
    if (outras.length > 0) timer = d.agendar(() => { void emFila(() => passadaParcial(outras)).catch(() => undefined); }, INTERVALO_SONDA_OUTRA_IA_MS);
  }

  /**
   * Sonda só as IAs dadas e junta com a última sondagem completa: o registro (e a instância viva) das outras não muda.
   * O resto é a passada de sempre (vereditos, anúncio, próximo agendamento).
   */
  async function passadaParcial(ias: readonly IaDesktop[]): Promise<void> {
    if (parado) return;
    const base = ultima;
    if (!base) return passada();
    const parcial = await d.sondar(ias);
    if (parado) return;
    const registry = { ...base.registry } as Registry;
    const inventarios: Inventarios = { ...base.inventarios };
    for (const ia of ias) {
      const reg = parcial.registry[ia];
      if (reg) registry[ia] = reg;
      if (parcial.inventarios[ia]) inventarios[ia] = parcial.inventarios[ia];
    }
    const s: Sondagem = { registry, inventarios };
    const ajustados = await ajustar(s, { retestar: true });
    await publicar(s, ajustados);
    reagendar(ajustados);
  }

  async function passada(): Promise<void> {
    if (parado) return;
    const s = await d.sondar();
    if (parado) return;
    const inventarios = await ajustar(s, { retestar: true });
    await publicar(s, inventarios);
    reagendar(inventarios);
  }

  return {
    iniciar(inicial) {
      return emFila(async () => {
        await carregar();
        // Na primeira passada o app acabou de abrir: veredito vencido ou de outra conta cai sem gastar um turno; a IA
        // volta a valer pelo login, e o primeiro turno (ou o onboarding) a testa.
        const inventarios = await ajustar(inicial, { retestar: false });
        await publicar(inicial, inventarios);
        reagendar(inventarios);
      });
    },

    testar(pedido) {
      if (testeEmCurso) return testeEmCurso;
      const p = pedido && typeof pedido === "object" ? (pedido as Record<string, unknown>) : {};
      const so = IAS_DESKTOP.find((i) => i === p.ia) ?? null;
      const pergunta = perguntaDoTeste(nomeParaOTeste(p.nome));
      const rodando = emFila(async (): Promise<TesteDeIa[]> => {
        await carregar();
        const s = await d.sondar();
        const inventarios: Inventarios = { ...s.inventarios };
        const respostas = new Map<IaDesktop, string>();
        // medido em 2026-10-05 com os CLIs reais: ~13 s por IA (Claude Code 2.1.289 e Codex 0.147.0). As IAs são
        // testadas ao mesmo tempo para a tela do "olá" esperar uma vez só.
        await Promise.all(IAS_DESKTOP.map(async (ia) => {
          if (s.inventarios[ia]?.estado !== "pronto") { vereditos.delete(ia); return; }
          if (so && so !== ia) {
            // Fora do pedido: vale o veredito que já existe, sem teste novo.
            const v = vereditos.get(ia);
            if (v) inventarios[ia] = reprovado(v.causa, s.inventarios[ia], d.agora());
            return;
          }
          const t = await testarUma(ia, s, pergunta);
          inventarios[ia] = t.inventario;
          if (t.resposta) respostas.set(ia, t.resposta);
        }));
        await guardar();
        await publicar(s, inventarios);
        reagendar(inventarios);
        return IAS_DESKTOP.map((ia): TesteDeIa => {
          const i = inventarios[ia];
          const resposta = respostas.get(ia);
          // NOD-178: teste lento sai como "não respondeu ainda" com a causa; como 'ausente' a tela pediria "Instalar".
          if (i && sondaFoiLenta(i)) return { ia, estado: "nao_autenticado", causa: "sonda_lenta" };
          // O limite (0068) só existe no servidor: aqui nunca aparece, e não vira causa do teste.
          return { ia, estado: i?.estado ?? "ausente", ...(i?.estado === "nao_autenticado" && i.causa && i.causa !== "limite" ? { causa: i.causa } : {}), ...(resposta ? { resposta } : {}) };
        });
      });
      testeEmCurso = rodando;
      void rodando.catch(() => undefined).finally(() => { if (testeEmCurso === rodando) testeEmCurso = null; });
      return rodando;
    },

    reprovar(ia, causa) {
      return emFila(async () => {
        await carregar();
        vereditos.set(ia, { ia, causa, impressao: await d.impressao(ia).catch(() => null), em: d.agora() });
        await guardar();
        if (!ultima) return;
        const inventarios = await ajustar(ultima, { retestar: false });
        await publicar(ultima, inventarios);
        reagendar(inventarios);
      });
    },

    contaMudou(ia) {
      forcadas.add(ia);
      return emFila(async () => { await carregar(); await passada(); });
    },

    reanunciar() {
      return emFila(async () => {
        if (parado || !ultima || !ultimosInventarios) return;
        ultimoAnuncio = null;
        const erro = await publicar(ultima, ultimosInventarios);
        if (erro === null) return;
        reagendar(ultimosInventarios);
        throw erro;
      });
    },

    sondarAgora() {
      return emFila(async () => { await carregar(); await passada(); });
    },

    testando() {
      return [...emTeste];
    },

    parar() {
      parado = true;
      timer?.cancelar();
      timer = null;
    },
  };
}
