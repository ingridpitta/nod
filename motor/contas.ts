import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { CodigoCifrado, IaComConta, LoginPendente, ProgressoDoLogin, PuxadaDeContas } from "../src/contracts/contas-ia.ts";
import type { IaDesktop } from "../src/contracts/desktop.ts";
import type { LoginDaIa } from "../src/contracts/estado-ia.ts";
import { emailDaConta, organizacaoDaConta, planoLegivel } from "../src/domain/estado-ia.ts";
import { log } from "../src/obs/log.ts";
import { decifrarCodigo, gerarParDoLogin, type ParDoLogin } from "../src/shared/cifra-do-codigo.ts";
import { executarColetando, iniciarProcesso } from "../src/adapters/executor/processo.ts";
import { contaDoCodex } from "../desktop/conta-codex.ts";
import type { ContaLocal, ContasLocais, IdentidadeDaConta } from "../desktop/contas-locais.ts";
import { ambienteDoLogin, comandoDeEstadoDoLogin, comandoDeLoginNoApp, comandoDeLogout, logadoPeloStatus, textoDaImpressao } from "../desktop/ia-mac.ts";
import { criarLoginDasIas, type ProcessoDeLogin, type StatusDoLogin } from "../desktop/login-ia.ts";
import type { PassoDoPreparo, PreparoNoMotor } from "./preparo-do-login.ts";
import type { OpcoesRemover } from "../src/contracts/remover-computador.ts";

/**
 * As contas de IA no motor da VM (definido em 2026-10-13, ADR-102): a puxada do que a tela pediu (logins, saídas,
 * desconexão) e o login de cada conta pela tela. O login roda o CLI na pasta da conta (CLAUDE_CONFIG_DIR/CODEX_HOME) com a
 * mesma máquina de estados do app do Mac (desktop/login-ia.ts); o link e o código do aparelho sobem ao servidor, e o
 * código que a página da Anthropic devolve chega cifrado com a chave pública que o motor gerou para este login
 * (src/shared/cifra-do-codigo.ts). Nada de credencial sai da máquina.
 */

/** definido em 2026-10-13: a puxada de contas (3 s; 1 s com login aberto, para o link e o código chegarem rápido à tela). */
export const INTERVALO_CONTAS_MS = 3_000;
export const INTERVALO_CONTAS_LOGIN_MS = 1_000;
/** Revisão do PR #306: quantas vezes o logout de uma conta é tentado antes de a saída ser confirmada mesmo assim. */
export const TENTATIVAS_DE_SAIR = 3;

export type PonteDeContas = {
  puxar(): Promise<PuxadaDeContas | null | "sem_rota">;
  /** true = recebido; false = sem resposta (tenta de novo); "recusado" = 400 (servidor de antes, NOD-8 passo 10). */
  progresso(p: ProgressoDoLogin): Promise<boolean | "recusado">;
  saiu(impressoes: string[], desconectada: boolean): Promise<boolean>;
};

/** O que o motor sabe rodar com o CLI de uma IA, num ambiente (o da conta). */
export type ClisDoMotor = {
  bin(ia: IaDesktop): Promise<string | null>;
  envBase(): Record<string, string>;
  home: string;
  versao: string;
};

/** O CLI diz quem está logado (para a impressão): o e-mail e a organização nunca saem daqui. */
export async function lerIdentidadeNoCli(c: ClisDoMotor, ia: IaDesktop, envConta: Record<string, string>): Promise<IdentidadeDaConta | undefined> {
  const bin = await c.bin(ia);
  if (!bin) return { logado: false, email: null, orgId: null, plano: null };
  const env = { ...ambienteDoLogin(c.envBase()), ...envConta };
  const cwd = c.home || tmpdir();
  if (ia === "claude-cli") {
    const r = await executarColetando({ bin, args: comandoDeEstadoDoLogin(ia).args, env, cwd, timeoutMs: 10_000 }).catch(() => null);
    if (!r || r.estourouTempo) return undefined;
    try {
      const o = JSON.parse(r.stdout) as Record<string, unknown>;
      const email = o.loggedIn === true ? emailDaConta(o.email) : null;
      return { logado: email !== null, email, orgId: typeof o.orgId === "string" ? o.orgId : null, plano: planoLegivel(o.subscriptionType), organizacao: organizacaoDaConta(o.orgName) };
    } catch {
      return { logado: false, email: null, orgId: null, plano: null };
    }
  }
  const conta = await contaDoCodex({ bin, env, cwd, versao: c.versao });
  if (conta === undefined) return undefined;
  return conta ? { logado: true, email: conta.email, orgId: null, plano: conta.plano, organizacao: conta.organizacao } : { logado: false, email: null, orgId: null, plano: null };
}

export async function logoutNoCli(c: ClisDoMotor, ia: IaDesktop, envConta: Record<string, string>): Promise<boolean> {
  const bin = await c.bin(ia);
  if (!bin) return false;
  const r = await executarColetando({ bin, args: comandoDeLogout(ia).args, env: { ...ambienteDoLogin(c.envBase()), ...envConta }, cwd: c.home || tmpdir(), timeoutMs: 15_000 }).catch(() => null);
  return r?.exitCode === 0;
}

/** O processo do login no ambiente da conta (como o app do Mac, desktop/main.ts iniciarLogin). */
async function iniciarLoginNoCli(c: ClisDoMotor, ia: IaDesktop, envConta: Record<string, string>): Promise<ProcessoDeLogin | null> {
  const bin = await c.bin(ia);
  if (!bin) return null;
  const pendentes: string[] = [];
  let ouvinte: ((t: string) => void) | null = null;
  const entregar = (t: string) => { if (ouvinte) ouvinte(t); else pendentes.push(t); };
  const p = iniciarProcesso({ bin, args: comandoDeLoginNoApp(ia).args, env: { ...ambienteDoLogin(c.envBase()), ...envConta }, cwd: c.home || tmpdir(), stdin: ia === "claude-cli" ? "pipe" : "ignore", aoLinha: (l) => entregar(`${l}\n`), aoStderr: entregar });
  return {
    aoSair: (fn) => { ouvinte = fn; for (const t of pendentes.splice(0)) fn(t); },
    escrever: (t) => p.escrever(t),
    fim: p.fim.then((r) => ({ codigo: r.exitCode, stderr: "" })),
    matar: () => p.interromper(),
  };
}

async function statusNoCli(c: ClisDoMotor, ia: IaDesktop, envConta: Record<string, string>): Promise<StatusDoLogin> {
  const bin = await c.bin(ia);
  if (!bin) return { logado: false, impressao: null };
  const r = await executarColetando({ bin, args: comandoDeEstadoDoLogin(ia).args, env: { ...ambienteDoLogin(c.envBase()), ...envConta }, cwd: c.home || tmpdir(), timeoutMs: 10_000 });
  const logado = !r.estourouTempo && logadoPeloStatus(ia, r.exitCode, r.stdout, r.stderr);
  return { logado, impressao: logado ? createHash("sha256").update(textoDaImpressao(ia, r.stdout, r.stderr)).digest("hex") : null };
}

export type DepsContasDoMotor = {
  ponte: PonteDeContas;
  contas: ContasLocais;
  clis: ClisDoMotor;
  /** O arquivo das contas locais: o `nod-motor entrar` no terminal o muda, e o serviço relê. */
  arquivo: string;
  /** As contas mudaram (login, logout, terminal): reanunciar ao servidor. */
  reanunciar(): Promise<void>;
  /**
   * A pessoa desconectou a máquina pedindo para sair das contas: depois de sair, o motor apaga a conexão e para.
   * ADA-245: com `remover` (o nod removido deste computador por outro lugar), roda também a limpeza local.
   */
  desconectar(remover?: OpcoesRemover): Promise<void>;
  /** NOD-9 PR4: a tela pediu para atualizar a IA desta máquina (o botão "Atualizar"); quem atualiza aplica o limite. */
  atualizar?(ia: IaComConta): void;
  /**
   * NOD-8 passo 10: o passo 1 do login (a IA que falta é instalada; a abaixo do piso, atualizada) antes do `auth login`.
   * Sem `preparo`, o login abre direto (como antes).
   */
  preparo?: PreparoNoMotor;
  /** Uma conta saiu desta máquina: o driver guardado dela é descartado. */
  aoSairDaConta?(conta: ContaLocal): Promise<void>;
  agora(): number;
  agendar(fn: () => void, ms: number): { cancelar(): void };
};

/**
 * Revisão do PR #511: o relato que o servidor de antes recusa (400) por causa do preparo, sem ele. `preparando` vira
 * `abrindo`; o resto perde só o campo `preparo`. null = não há preparo a tirar (a recusa é de outra coisa).
 */
function semOPreparo(p: Omit<ProgressoDoLogin, "loginId">): Omit<ProgressoDoLogin, "loginId"> | null {
  if (p.fase === "preparando") return { fase: "abrindo" };
  if (p.preparo === undefined) return null;
  const { preparo: _preparo, ...resto } = p;
  return resto;
}

type LoginEmCurso = { pedido: LoginPendente; conta: ContaLocal; par: ParDoLogin | null; login: ReturnType<typeof criarLoginDasIas>; relatado: string; fim: boolean; nova: boolean; pendente?: Omit<ProgressoDoLogin, "loginId">; semPreparo?: boolean; preparando?: boolean };

export function iniciarContasDoMotor(d: DepsContasDoMotor): { parar(): void } {
  const logins = new Map<string, LoginEmCurso>();
  /**
   * Revisão do PR #306: o login que terminou fica aqui até o servidor receber o relato final. Sem isto, uma puxada que
   * ainda trazia o login (o relato não tinha chegado) abria um segundo `auth login` numa pasta nova; e um relato que
   * falhou nunca era repetido (a tela ficava "abrindo" até o prazo). null = terminou sem relato (cancelado).
   */
  const terminados = new Map<string, Omit<ProgressoDoLogin, "loginId"> | "entregue">();
  /** Revisão do PR #306: tentativas de logout por impressão; passado o teto, a saída é confirmada (com aviso no log). */
  const tentativasDeSair = new Map<string, number>();
  let parado = false;
  let timer: { cancelar(): void } | null = null;
  let mtime = 0;

  /** Só marca como relatado o que o servidor recebeu: o que falhou vai de novo na próxima mudança ou volta. */
  async function relatar(l: LoginEmCurso, p: Omit<ProgressoDoLogin, "loginId">): Promise<boolean> {
    const chave = JSON.stringify(p);
    if (chave === l.relatado) return true;
    const r = await d.ponte.progresso({ loginId: l.pedido.id, ...p }).catch(() => false);
    const sem = r === "recusado" ? semOPreparo(p) : null;
    if (sem) {
      // Servidor de antes (não conhece `preparando`, ou o `preparo`/`atualizacao` dele): a tela segue em "abrindo"
      // enquanto a máquina prepara, e o fim (falhou/pronto) vai sem o preparo, em vez de ficar pendente para sempre.
      l.semPreparo = true;
      return relatar(l, sem);
    }
    const ok = r === true;
    if (ok) { l.relatado = chave; delete l.pendente; } else l.pendente = p;
    return ok;
  }

  async function terminar(l: LoginEmCurso, p: Omit<ProgressoDoLogin, "loginId"> | null): Promise<void> {
    if (l.fim) return;
    l.fim = true;
    // NOD-293 C10: `armadaEm`/`armadaDaIa` é consumível. Sem isto uma tentativa falha ou cancelada fazia uma leitura
    // futura parecer um login novo iniciado pelo nod e podia ressuscitar uma conta removida.
    await d.contas.desarmar(l.conta.ia, l.conta.id).catch(() => undefined);
    logins.delete(l.pedido.id);
    // Fica marcado até a puxada deixar de trazer o login (a puxada em voo ainda o traz e não pode reabri-lo).
    terminados.set(l.pedido.id, p ?? "entregue");
    if (p && (await relatar(l, p))) terminados.set(l.pedido.id, "entregue");
    else if (p && l.pendente) terminados.set(l.pedido.id, l.pendente); // o que sobrou para repetir (sem o preparo, se recusado)
    await l.login.parar().catch(() => undefined);
  }

  async function aoMudar(l: LoginEmCurso, estado: LoginDaIa): Promise<void> {
    if (l.fim) return;
    if (estado.fase === "aguardando") {
      const url = l.login.link(l.conta.ia);
      if (!url) return;
      await relatar(l, {
        fase: estado.codigoEnviado ? "conferindo" : "aguardando_pessoa",
        url,
        ...(estado.codigoDoDispositivo ? { codigoDispositivo: estado.codigoDoDispositivo } : {}),
        pedeCodigo: estado.pedeCodigo,
        ...(l.par ? { chavePublica: l.par.publica } : {}),
      });
      return;
    }
    if (estado.fase === "sucesso") return; // aoSucesso relata, com a impressão
    if (estado.fase === "cancelado") { if (l.nova) await d.contas.descartar(l.conta); await terminar(l, null); return; }
    if (l.nova) await d.contas.descartar(l.conta);
    await terminar(l, { fase: "falhou", erro: estado.fase === "expirou" ? "tempo_esgotado" : estado.causa ?? "falhou" });
  }

  async function aoSucesso(l: LoginEmCurso): Promise<void> {
    if (l.fim) return;
    await d.contas.ler({ forcar: true, id: l.conta.id });
    const conta = d.contas.porId(l.conta.id, l.conta.ia);
    // A pessoa entrou numa conta que já estava noutra pasta desta máquina: a pasta repetida sai (sem logout).
    const impressao = conta?.impressao ?? undefined;
    await d.contas.descartarRepetidas().catch(() => 0);
    await d.reanunciar().catch(() => undefined);
    log("info", "motor_login_pronto", { login_id: l.pedido.id, ia: l.conta.ia });
    await terminar(l, impressao ? { fase: "pronto", impressao } : { fase: "falhou", erro: "nao_confirmou" });
  }

  async function comecar(p: LoginPendente): Promise<void> {
    const existente = p.impressao ? d.contas.porImpressao(p.impressao) : null;
    const conta = existente ?? (await d.contas.pastaParaLogin(p.ia, p.apelido));
    if (!conta) { await d.ponte.progresso({ loginId: p.id, fase: "falhou", erro: "contas_demais" }); return; }
    // NOD-293 C10: o login pedido pela tela numa conta que já existe também conta desta hora (pastaParaLogin já arma a sua).
    if (existente) await d.contas.armar(existente.ia, existente.id).catch(() => undefined);
    const env = d.contas.ambiente(conta);
    const l: LoginEmCurso = {
      pedido: p, conta, par: p.ia === "claude-cli" ? gerarParDoLogin() : null, relatado: "", fim: false, nova: !existente && conta.impressao === null,
      login: undefined as unknown as LoginEmCurso["login"],
    };
    l.login = criarLoginDasIas({
      iniciar: () => iniciarLoginNoCli(d.clis, p.ia, env),
      status: () => statusNoCli(d.clis, p.ia, env),
      agora: d.agora,
      agendar: d.agendar,
      aoMudar: (_ia, estado) => { void aoMudar(l, estado).catch(() => undefined); },
      aoSucesso: () => { void aoSucesso(l).catch(() => undefined); },
      registrar: (evento, campos) => log("info", evento, { ...campos, login_id: p.id }),
    });
    logins.set(p.id, l);
    const passo = d.preparo ? await d.preparo.precisa(p.ia).catch(() => null) : null;
    if (!passo) { await abrir(l); return; }
    // O preparo leva minutos: roda fora da volta, para a puxada seguir (cancelar, outros logins, relatos).
    await relatar(l, { fase: "preparando", preparo: passo });
    l.preparando = true;
    void preparar(l, passo).finally(() => { l.preparando = false; }).catch((e) => log("aviso", "motor_preparo_login_erro", { login_id: p.id, erro: e instanceof Error ? e.name : "desconhecido" }));
  }

  async function abrir(l: LoginEmCurso, extra: Pick<ProgressoDoLogin, "preparo"> = {}): Promise<void> {
    await relatar(l, { fase: "abrindo", ...(l.semPreparo ? {} : extra) });
    const inicial = await l.login.entrar(l.conta.ia);
    if (inicial.fase === "falhou") await aoMudar(l, inicial);
  }

  async function preparar(l: LoginEmCurso, passo: PassoDoPreparo): Promise<void> {
    const fim = await d.preparo!.rodar(l.conta.ia, passo);
    if (l.fim) return; // cancelado enquanto preparava
    const preparo = { ...passo, ...(fim.depois ? { depois: fim.depois } : {}), atualizacao: fim.atualizacao };
    if (fim.ok) { await abrir(l, { preparo }); return; }
    if (l.nova) await d.contas.descartar(l.conta);
    await terminar(l, { fase: "falhou", erro: "preparo_falhou", ...(l.semPreparo ? {} : { preparo }) });
  }

  async function colar(l: LoginEmCurso, cifrado: CodigoCifrado): Promise<void> {
    const codigo = l.par ? decifrarCodigo(l.par.privada, cifrado) : null;
    if (codigo === null) { await terminar(l, { fase: "falhou", erro: "codigo_ilegivel" }); return; }
    const r = l.login.colarCodigo(l.conta.ia, codigo);
    if (!r.ok) await terminar(l, { fase: "falhou", erro: r.motivo });
  }

  /** Mantém a última fase relatada viva: o que não chegou ao servidor vai de novo a cada volta. */
  async function repetirRelatos(listados: ReadonlySet<string>): Promise<void> {
    for (const [id, p] of [...terminados]) {
      if (!listados.has(id)) { terminados.delete(id); continue; }
      if (p === "entregue") continue;
      const r = await d.ponte.progresso({ loginId: id, ...p }).catch(() => false);
      const sem = r === "recusado" ? semOPreparo(p) : null;
      if (r === true) terminados.set(id, "entregue");
      else if (sem) terminados.set(id, sem); // servidor de antes: vai sem o preparo na próxima puxada
    }
  }

  async function sairDe(impressoes: readonly string[]): Promise<string[]> {
    const feitas: string[] = [];
    for (const imp of impressoes) {
      const conta = d.contas.porImpressao(imp);
      if (conta) await d.aoSairDaConta?.(conta).catch(() => undefined);
      // Revisão do PR #306: só confirma ao servidor a saída que aconteceu (ou a conta que nem estava aqui). Um logout
      // que falhou fica pendente e é tentado de novo na próxima puxada; confirmado, o anúncio seguinte a traria de volta.
      const saiu = await d.contas.sair(imp).then(() => true, (e: unknown) => { log("aviso", "motor_sair_da_conta_falhou", { erro: e instanceof Error ? e.name : "desconhecido" }); return false; });
      const n = (tentativasDeSair.get(imp) ?? 0) + 1;
      if (saiu || n >= TENTATIVAS_DE_SAIR) {
        if (!saiu) log("aviso", "motor_sair_da_conta_desistiu", { tentativas: n });
        tentativasDeSair.delete(imp);
        feitas.push(imp);
      } else tentativasDeSair.set(imp, n);
    }
    return feitas;
  }

  /** O `nod-motor entrar` no terminal mudou o arquivo: relê e reanuncia. */
  async function arquivoMudou(): Promise<boolean> {
    const m = await stat(d.arquivo).then((s) => s.mtimeMs, () => 0);
    if (m === mtime) return false;
    const primeira = mtime === 0;
    mtime = m;
    if (primeira) return false;
    await d.contas.carregar();
    await d.contas.ler({ forcar: true });
    await d.contas.descartarRepetidas().catch(() => 0);
    return true;
  }

  /** O que o próprio serviço gravou nesta volta não conta como mudança de fora. */
  const marcarArquivo = async () => { mtime = await stat(d.arquivo).then((s) => s.mtimeMs, () => mtime); };

  async function volta(): Promise<"seguir" | "parar"> {
    try {
      return await voltaDeVerdade();
    } finally {
      await marcarArquivo();
    }
  }

  async function voltaDeVerdade(): Promise<"seguir" | "parar"> {
    if (await arquivoMudou()) await d.reanunciar().catch(() => undefined);
    if (await d.contas.ler()) await d.reanunciar().catch(() => undefined);
    const r = await d.ponte.puxar();
    if (r === "sem_rota") { log("info", "motor_contas_sem_rota", {}); return "parar"; }
    if (!r) return "seguir";
    if (r.remover?.manterConexao) {
      // ADA-245: "Continuar ligado à minha conta": o computador fica na conta, então as contas das IAs também ficam
      // (nada de logout nem de apagar a conexão). Só a limpeza local do programa/IAs, e a confirmação ao servidor.
      // Revisão do PR #694: vem SEM `desconectar` (desconectarNaPuxada), para o motor antigo não sair das contas.
      await d.ponte.saiu([], true);
      log("info", "motor_removido_mantendo_conexao", {});
      await d.desconectar(r.remover);
      return "parar";
    }
    if (r.desconectar) {
      const todas = d.contas.listar().filter((c) => c.impressao !== null).map((c) => c.impressao!);
      const feitas = await sairDe(todas);
      // Revisão do PR #306: com algum logout pendente, confirma só o que saiu e tenta de novo na próxima puxada (a chave
      // vence em 2 min de todo jeito); com tudo fora, confirma a desconexão e para.
      if (feitas.length < todas.length) { await d.ponte.saiu(feitas, false); return "seguir"; }
      await d.ponte.saiu(feitas, true);
      log("info", "motor_desconectado_pela_pessoa", { contas: feitas.length });
      await d.desconectar(r.remover);
      return "parar";
    }
    for (const ia of r.atualizar ?? []) d.atualizar?.(ia);
    if (r.sair.length > 0) {
      const feitas = await sairDe(r.sair);
      if (await d.ponte.saiu(feitas, false)) await d.reanunciar().catch(() => undefined);
      log("info", "motor_saiu_das_contas", { contas: feitas.length });
    }
    await repetirRelatos(new Set(r.logins.map((p) => p.id)));
    for (const l of logins.values()) if (l.pendente && !l.fim) await relatar(l, l.pendente);
    for (const p of r.logins) {
      if (terminados.has(p.id)) continue;
      const l = logins.get(p.id);
      if (p.cancelado) {
        // Cancelado no preparo: o `auth login` nem abriu; o npm termina sozinho (a trava o protege) e o login acaba aqui.
        if (l?.preparando) { if (l.nova) await d.contas.descartar(l.conta); await terminar(l, null); continue; }
        if (l) await l.login.cancelar(l.conta.ia).catch(() => undefined);
        continue;
      }
      if (!l) { await comecar(p).catch((e) => log("aviso", "motor_login_falhou_ao_comecar", { login_id: p.id, erro: e instanceof Error ? e.name : "desconhecido" })); continue; }
      if (p.codigo) await colar(l, p.codigo);
    }
    return "seguir";
  }

  function agendar(): void {
    if (parado) return;
    timer = d.agendar(() => {
      void volta().then((r) => { if (r === "seguir") agendar(); }, () => agendar());
    }, logins.size > 0 ? INTERVALO_CONTAS_LOGIN_MS : INTERVALO_CONTAS_MS);
  }
  void stat(d.arquivo).then((s) => { mtime = s.mtimeMs; }, () => { mtime = 1; }).finally(agendar);

  return {
    parar() {
      parado = true;
      timer?.cancelar();
      for (const l of logins.values()) void l.login.parar().catch(() => undefined);
      logins.clear();
    },
  };
}
