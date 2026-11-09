import { createHash, randomBytes } from "node:crypto";
import { readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ContaAnunciada, EstadoContaNaMaquina } from "../src/contracts/contas-ia.ts";
import { CAUSAS_SEM_IA, type Inventario } from "../src/contracts/inventario.ts";
import { IAS_DESKTOP, type DetalheDaConta, type IaDesktop } from "../src/contracts/desktop.ts";
import { CONTAS_POR_IA_MAX, ID_CONTA_PADRAO, contaCorporativa, apelidoValido } from "../src/domain/contas-da-ia.ts";
import { textoDaImpressaoDaConta } from "../src/domain/contas-da-pessoa.ts";
import { ambienteDaConta, novoIdDeConta, pastaDaConta, prepararPastaDaConta, removerPastaDaConta } from "./contas-mac.ts";

/**
 * As contas de IA logadas NESTA máquina (definido em 2026-10-13, ADR-102), sem Electron: o motor da VM usa, e o app do
 * Mac pode usar. Uma pasta por conta (CLAUDE_CONFIG_DIR/CODEX_HOME, ADR-101, contas-mac.ts); a conta de sempre ("padrao")
 * é a pasta padrão (~/.claude, ~/.codex). Quem diz qual conta está em cada pasta é o CLI (`claude auth status`, o
 * `account/read` do Codex): o e-mail e a organização viram a impressão (sha256 com a pessoa), a chave da conta. Desde
 * 2026-10-15 (ADR-105) eles também vão no anúncio, só para a tela; o arquivo continua sem eles. O que vai ao servidor é
 * `anuncio()`.
 *
 * R11 da revisão: a identidade é lida depois de um login ou logout e, fora isso, no máximo a cada 10 min por conta.
 */
export type ContaLocal = {
  id: string;
  ia: IaDesktop;
  /** O apelido que a pessoa deu ao pedir a conta (vai como sugestão no anúncio da conta nova). */
  apelido: string | null;
  /**
   * Quando a pasta ganhou o login atual (R4: conta removida só volta com login mais novo que a remoção). NOD-293 C10: no
   * login detectado, é o maior entre a data do arquivo da credencial e `armadaEm`; nunca a hora da leitura.
   */
  logadaEm: number;
  /** NOD-293 C10: quando o nod abriu um login nesta pasta (`pastaParaLogin`, `armar`); 0 = nenhum pendente. */
  armadaEm: number;
  /** A impressão da última conta lida nesta pasta; null = nunca logou. */
  impressao: string | null;
  plano: string | null;
  estado: EstadoContaNaMaquina;
  lidaEm: number;
};

export type IdentidadeDaConta = { logado: boolean; email: string | null; orgId: string | null; plano: string | null; organizacao?: string | null };

/** O que o CLI disse de cada conta (e-mail, organização): na memória, pela ponte do app e no anúncio (ADR-105). */
export type DetalheDaContaLocal = DetalheDaConta;

export type DepsContasLocais = {
  /** A pasta onde ficam as pastas das contas (`<base>/contas/<ia>/<id>`). */
  base: string;
  arquivo: string;
  pessoaId: string;
  /** O diretório padrão da IA (~/.claude, ~/.codex): a conta "padrao" e o alvo dos symlinks do Claude. */
  padrao(ia: IaDesktop): string;
  /** O CLI diz quem está logado com este ambiente; undefined = não respondeu (prazo, erro). */
  lerIdentidade(ia: IaDesktop, env: Record<string, string>): Promise<IdentidadeDaConta | undefined>;
  /** `claude auth logout` / `codex logout` com o ambiente da conta. */
  logout(ia: IaDesktop, env: Record<string, string>): Promise<boolean>;
  agora(): number;
};

/**
 * Red team do PR #306: a sonda da IA roda só na conta de sempre. Com ela fora (saiu, venceu) e outra conta da mesma IA
 * pronta nesta máquina, a IA não pode ser anunciada como fora: os turnos com conta rodam na pasta da conta. "ausente" (o
 * CLI não está instalado) continua ausente.
 */
export function inventariosComContas<T extends Partial<Record<string, Inventario>>>(inventarios: T, contas: readonly ContaAnunciada[], padrao: Partial<Record<string, string>> = {}): T {
  const saida: Partial<Record<string, Inventario>> = { ...inventarios };
  for (const [ia, inv] of Object.entries(inventarios)) {
    if (!inv || inv.estado !== "nao_autenticado") continue;
    // NOD-283 (A5, QA do PR #337): a sonda testa a conta de sempre. Reprovada por um teste de verdade (CausaSemIa), ela
    // não promove a IA — o login dela é o que falhou; só OUTRA conta pronta da IA promove.
    const reprovouAPadrao = (CAUSAS_SEM_IA as readonly string[]).includes(inv.causa ?? "");
    const promove = (c: ContaAnunciada) => c.ia === ia && c.estado === "pronta" && !(reprovouAPadrao && c.impressao === padrao[ia]);
    if (contas.some(promove)) saida[ia] = { estado: "pronto", versao: inv.versao ?? "desconhecida", em: inv.em };
  }
  return saida as T;
}

/** Entre cópias da mesma conta, a pronta e, entre iguais, a de login mais novo (red team do PR #306). */
const melhorCopia = (a: ContaLocal, b: ContaLocal): number =>
  (a.estado === "pronta" ? 0 : 1) - (b.estado === "pronta" ? 0 : 1) || b.logadaEm - a.logadaEm;

/** definido em 2026-10-13 (R11): sem login/logout, a identidade de cada conta é relida no máximo a cada 10 min. */
export const RELEITURA_DA_CONTA_MS = 10 * 60_000;

export type ContasLocais = ReturnType<typeof criarContasLocais>;

export function criarContasLocais(d: DepsContasLocais) {
  let contas: ContaLocal[] = [];
  /** E-mail e organização por impressão: vão ao anúncio (ADR-105), nunca ao arquivo. */
  const detalhes = new Map<string, DetalheDaContaLocal>();
  /** NOD-293 C10: o login armado pelo app do Mac antes de a conta nova existir na lista (`armar` sem id). Só na memória. */
  const armadaDaIa = new Map<IaDesktop, number>();

  const padraoDe = (ia: IaDesktop): ContaLocal => ({ id: ID_CONTA_PADRAO, ia, apelido: null, logadaEm: 0, armadaEm: armadaDaIa.get(ia) ?? 0, impressao: null, plano: null, estado: "sem_login", lidaEm: 0 });

  let fila: Promise<unknown> = Promise.resolve();
  /**
   * Revisão do PR #306: uma gravação de cada vez, num temporário próprio (o serviço e o `nod-motor entrar` escrevem no
   * mesmo arquivo; com o nome fixo, duas gravações se cruzavam e o JSON podia sair truncado).
   */
  function gravar(): Promise<void> {
    const vez = fila.then(async () => {
      const tmp = `${d.arquivo}.${randomBytes(3).toString("hex")}.tmp`;
      await writeFile(tmp, `${JSON.stringify({ versao: 1, contas })}\n`, { mode: 0o600 });
      await rename(tmp, d.arquivo);
    });
    fila = vez.catch(() => undefined);
    return vez;
  }

  function ambiente(c: Pick<ContaLocal, "ia" | "id">): Record<string, string> {
    return ambienteDaConta(d.base, c.ia, c.id);
  }

  /**
   * NOD-293 C10 (definido em 2026-10-20): a data do arquivo da credencial da conta (`.credentials.json` do Claude,
   * `auth.json` do Codex) — só a data, o nod não abre o arquivo (ADR-019). Sem arquivo (Keychain do Mac, keyring), 0.
   */
  async function dataDaCredencial(c: ContaLocal): Promise<number> {
    const pasta = c.id === ID_CONTA_PADRAO ? d.padrao(c.ia) : pastaDaConta(d.base, c.ia, c.id);
    if (!pasta) return 0;
    const s = await stat(join(pasta, c.ia === "claude-cli" ? ".credentials.json" : "auth.json")).catch(() => null);
    return s ? Math.floor(s.mtimeMs) : 0;
  }

  async function lerUma(c: ContaLocal): Promise<boolean> {
    const id = await d.lerIdentidade(c.ia, ambiente(c)).catch(() => undefined);
    c.lidaEm = d.agora();
    if (id === undefined) return false;
    const antes = `${c.impressao}|${c.estado}|${c.plano}`;
    if (id.logado && id.email) {
      const impressao = createHash("sha256").update(textoDaImpressaoDaConta({ pessoaId: d.pessoaId, ia: c.ia, email: id.email, orgId: id.orgId })).digest("hex");
      const novoLogin = impressao !== c.impressao;
      // NOD-293 C10: a hora da leitura fazia a conta removida voltar na primeira leitura de uma máquina (app reinstalado).
      // A data da credencial só vale aqui, no login detectado: a renovação do token reescreve o arquivo depois.
      if (novoLogin) {
        c.logadaEm = Math.max(await dataDaCredencial(c), c.armadaEm);
        c.armadaEm = 0;
      }
      c.impressao = impressao;
      c.plano = id.plano;
      // NOD-283 (2026-10-15): a conta que o turno achou sem acesso continua assim com o mesmo login (o CLI segue logado,
      // quem desligou foi a organização); só um login noutra conta nesta pasta a solta.
      c.estado = c.estado === "sem_acesso" && !novoLogin ? "sem_acesso" : "pronta";
      detalhes.set(impressao, { impressao, ia: c.ia, email: id.email, organizacao: id.organizacao ?? null, plano: id.plano });
    } else {
      c.estado = "sem_login";
    }
    return antes !== `${c.impressao}|${c.estado}|${c.plano}`;
  }

  /**
   * Red team do PR #306: o apelido da ADR-101 nasce da organização quando a pessoa não digitou nenhum (e a organização
   * do Claude pessoal é "<e-mail>'s Organization"). Ele só vai ao servidor se não for e-mail nem a organização da conta.
   */
  const apelidoQuePodeSair = (c: ContaLocal): boolean => {
    if (!c.apelido || c.apelido.includes("@")) return false;
    const d = c.impressao ? detalhes.get(c.impressao) : undefined;
    const igual = (x: string | null | undefined) => !!x && x.trim().toLowerCase().slice(0, 40) === c.apelido!.trim().toLowerCase();
    return !d || !(igual(d.organizacao) || igual(d.email));
  };

  const identidade = (c: ContaLocal): Pick<ContaAnunciada, "email" | "organizacao"> => {
    const x = c.impressao ? detalhes.get(c.impressao) : undefined;
    return { ...(x?.email ? { email: x.email } : {}), ...(x?.organizacao ? { organizacao: x.organizacao } : {}) };
  };

  return {
    async carregar(): Promise<void> {
      const texto = await readFile(d.arquivo, "utf8").catch(() => null);
      const lidas: ContaLocal[] = [];
      try {
        const bruto = texto ? (JSON.parse(texto) as { contas?: unknown }).contas : [];
        for (const x of Array.isArray(bruto) ? bruto : []) {
          const o = x as Partial<ContaLocal>;
          if (typeof o.id !== "string" || !IAS_DESKTOP.includes(o.ia as IaDesktop)) continue;
          if (o.id !== ID_CONTA_PADRAO && !pastaDaConta(d.base, o.ia as IaDesktop, o.id)) continue;
          lidas.push({ id: o.id, ia: o.ia as IaDesktop, apelido: apelidoValido(o.apelido) ?? null, logadaEm: Number(o.logadaEm) || 0, armadaEm: Number(o.armadaEm) || 0, impressao: typeof o.impressao === "string" ? o.impressao : null, plano: typeof o.plano === "string" ? o.plano : null, estado: o.estado === "pronta" || o.estado === "sem_acesso" ? o.estado : "sem_login", lidaEm: 0 });
        }
      } catch { /* arquivo quebrado: recomeça com as contas de sempre */ }
      contas = lidas;
      for (const ia of IAS_DESKTOP) if (!contas.some((c) => c.ia === ia && c.id === ID_CONTA_PADRAO)) contas.unshift(padraoDe(ia));
    },

    listar: (): readonly ContaLocal[] => contas,
    ambiente,
    porImpressao: (impressao: string): ContaLocal | null => contas.filter((c) => c.impressao === impressao).sort(melhorCopia)[0] ?? null,
    porId: (id: string, ia: IaDesktop): ContaLocal | null => contas.find((c) => c.id === id && c.ia === ia) ?? null,

    /**
     * A pasta para um login novo: a conta de sempre se ela ainda não tem login nesta máquina; senão uma pasta nova (até
     * CONTAS_POR_IA_MAX por IA). null = cheio.
     */
    async pastaParaLogin(ia: IaDesktop, apelido: string | null): Promise<ContaLocal | null> {
      const padrao = contas.find((c) => c.ia === ia && c.id === ID_CONTA_PADRAO);
      // Red team do PR #306: a conta de sempre sem login (nunca entrou, ou o login venceu) é a primeira a ser reaproveitada;
      // depois, uma pasta extra sem login (login interrompido, vencido). Só então nasce uma pasta nova.
      const livre = padrao && padrao.estado !== "pronta" ? padrao : contas.find((c) => c.ia === ia && c.id !== ID_CONTA_PADRAO && c.estado !== "pronta");
      if (livre && livre !== padrao) {
        livre.apelido = apelido;
        livre.armadaEm = d.agora();
        await gravar();
        return livre;
      }
      if (padrao && padrao.estado !== "pronta") {
        padrao.apelido = apelido;
        padrao.armadaEm = d.agora();
        // O arquivo passa a existir já aqui: o serviço percebe o login do terminal pela data dele.
        await gravar();
        return padrao;
      }
      if (contas.filter((c) => c.ia === ia).length >= CONTAS_POR_IA_MAX) return null;
      const nova: ContaLocal = { id: novoIdDeConta(), ia, apelido, logadaEm: 0, armadaEm: d.agora(), impressao: null, plano: null, estado: "sem_login", lidaEm: 0 };
      await prepararPastaDaConta({ base: d.base, ia, id: nova.id, padrao: d.padrao(ia) });
      contas.push(nova);
      await gravar();
      return nova;
    },

    /**
     * NOD-293 C10: o nod vai abrir um login nesta IA (a tela do app do Mac, o login pedido pela tela numa conta que já
     * existe): o login que aparecer a seguir é de propósito e conta desta hora, mesmo sem arquivo de credencial (Keychain).
     * Sem `id`, vale para todas as contas da IA e para a conta nova que a lista do app trouxer depois.
     */
    async armar(ia: IaDesktop, id?: string): Promise<void> {
      const agora = d.agora();
      if (id === undefined) armadaDaIa.set(ia, agora);
      for (const c of contas) if (c.ia === ia && (id === undefined || c.id === id)) c.armadaEm = agora;
      await gravar();
    },

    /** O marcador vale para uma tentativa de login. Sucesso, falha e cancelamento sempre o consomem. */
    async desarmar(ia: IaDesktop, id?: string): Promise<void> {
      armadaDaIa.delete(ia);
      let mudou = false;
      for (const c of contas) {
        if (c.ia !== ia || (id !== undefined && c.id !== id) || c.armadaEm === 0) continue;
        c.armadaEm = 0;
        mudou = true;
      }
      if (mudou) await gravar();
    },

    /** Relê a identidade (todas, ou só as vencidas). true = algo mudou (o motor reanuncia). */
    async ler(o: { forcar?: boolean; id?: string } = {}): Promise<boolean> {
      let mudou = false;
      for (const c of contas) {
        if (o.id !== undefined && c.id !== o.id) continue;
        if (!o.forcar && d.agora() - c.lidaEm < RELEITURA_DA_CONTA_MS) continue;
        if (await lerUma(c)) mudou = true;
      }
      if (mudou) await gravar();
      return mudou;
    },

    /**
     * NOD-283 (2026-10-15): o turno nesta conta voltou "sem acesso" — ela fica `sem_acesso` (gravado) até um login novo
     * na pasta, e o anúncio a leva assim; a IA não é reprovada (a outra conta dela segue). true = mudou (reanunciar).
     */
    async marcarSemAcesso(impressao: string): Promise<boolean> {
      const copias = contas.filter((c) => c.impressao === impressao && c.estado === "pronta");
      for (const c of copias) c.estado = "sem_acesso";
      if (copias.length > 0) await gravar();
      return copias.length > 0;
    },

    /** O login novo numa pasta falhou ou foi cancelado: a pasta vazia sai (a conta de sempre fica). */
    async descartar(c: ContaLocal): Promise<void> {
      if (c.impressao !== null || c.id === ID_CONTA_PADRAO) return;
      await removerPastaDaConta({ base: d.base, ia: c.ia, id: c.id, logout: async () => true }).catch(() => undefined);
      contas = contas.filter((x) => x !== c);
      await gravar();
    },

    /**
     * A pessoa entrou de novo numa conta que já estava noutra pasta desta máquina: a pasta repetida sai SEM logout (o
     * logout poderia derrubar a sessão da mesma conta na outra pasta). A conta de sempre nunca sai.
     */
    async descartarRepetidas(): Promise<number> {
      const vistas = new Set<string>();
      const repetidas: ContaLocal[] = [];
      // Fica a pronta; entre prontas, a de sempre (ela nunca sai, então só ficando com ela a repetida some — QA do PR #306,
      // ISSUE-002); depois, a de login mais novo.
      const paraFicar = (a: ContaLocal, b: ContaLocal) => (a.estado === "pronta" ? 0 : 1) - (b.estado === "pronta" ? 0 : 1) || (a.id === ID_CONTA_PADRAO ? -1 : b.id === ID_CONTA_PADRAO ? 1 : 0) || b.logadaEm - a.logadaEm;
      for (const c of [...contas].sort(paraFicar)) {
        if (!c.impressao) continue;
        const chave = `${c.ia}:${c.impressao}`;
        if (vistas.has(chave) && c.id !== ID_CONTA_PADRAO) repetidas.push(c);
        vistas.add(chave);
      }
      for (const c of repetidas) await removerPastaDaConta({ base: d.base, ia: c.ia, id: c.id, logout: async () => true }).catch(() => undefined);
      if (repetidas.length > 0) {
        contas = contas.filter((c) => !repetidas.includes(c));
        await gravar();
      }
      return repetidas.length;
    },

    /**
     * Sair de uma conta nesta máquina (pedido da tela): logout com a variável dela e, fora a conta de sempre, a pasta sai.
     * false = a máquina não tem essa conta (nada a fazer: o servidor apaga o vínculo do mesmo jeito).
     */
    async sair(impressao: string): Promise<boolean> {
      // QA do PR #306 (ISSUE-006): a mesma conta pode estar em mais de uma pasta; sair é sair de todas.
      const copias = contas.filter((x) => x.impressao === impressao);
      if (copias.length === 0) return false;
      for (const c of copias) {
        if (c.id === ID_CONTA_PADRAO) {
          // Revisão do PR #306: sem logout, a conta continua logada aqui — a saída fica pendente (o servidor pede de novo).
          if (!(await d.logout(c.ia, {}).catch(() => false))) throw new Error("logout_falhou");
          Object.assign(c, { impressao: null, plano: null, estado: "sem_login", logadaEm: 0, armadaEm: 0, apelido: null });
        } else {
          await removerPastaDaConta({ base: d.base, ia: c.ia, id: c.id, logout: (env) => d.logout(c.ia, env) });
          contas = contas.filter((x) => x !== c);
        }
      }
      await gravar();
      return true;
    },

    /**
     * O app do Mac (ADR-102): a lista de contas é a do contas.json do app (ADR-101); esta segue a dele. Conta nova entra
     * sem leitura (o próximo `ler()` a lê); conta que saiu de lá sai daqui sem logout (o app já fez). Devolve as que saíram.
     */
    async sincronizar(lista: readonly { ia: IaDesktop; id: string; apelido: string | null }[]): Promise<ContaLocal[]> {
      const chave = (x: { ia: IaDesktop; id: string }) => `${x.ia}:${x.id}`;
      const querem = new Map(lista.map((x) => [chave(x), x]));
      const sairam = contas.filter((c) => c.id !== ID_CONTA_PADRAO && !querem.has(chave(c)));
      let mudou = sairam.length > 0;
      contas = contas.filter((c) => !sairam.includes(c));
      for (const x of lista) {
        const c = contas.find((y) => chave(y) === chave(x));
        const apelido = apelidoValido(x.apelido) ?? null;
        if (c) { if (c.apelido !== apelido) { c.apelido = apelido; mudou = true; } continue; }
        if (x.id !== ID_CONTA_PADRAO && !pastaDaConta(d.base, x.ia, x.id)) continue;
        contas.push({ id: x.id, ia: x.ia, apelido, logadaEm: 0, armadaEm: armadaDaIa.get(x.ia) ?? 0, impressao: null, plano: null, estado: "sem_login", lidaEm: 0 });
        mudou = true;
      }
      if (mudou) await gravar();
      return sairam;
    },

    /** E-mail, organização e plano de cada conta lida nesta máquina (para a tela do app). */
    detalhes(): DetalheDaContaLocal[] {
      return contas.flatMap((c) => (c.impressao && c.estado === "pronta" && detalhes.has(c.impressao) ? [detalhes.get(c.impressao)!] : []));
    },

    /**
     * O que vai ao servidor: as contas com impressão (a que perdeu o login vai como `sem_login`), uma vez cada. O e-mail
     * e a organização vão quando esta máquina os leu do CLI desde que abriu (ADR-105); sem eles, o servidor mantém os seus.
     */
    /** A impressão do login da conta de sempre de cada IA (a que a sonda testa), para `inventariosComContas`. */
    impressoesDaPadrao(): Partial<Record<IaDesktop, string>> {
      const saida: Partial<Record<IaDesktop, string>> = {};
      for (const c of contas) if (c.id === ID_CONTA_PADRAO && c.impressao) saida[c.ia] = c.impressao;
      return saida;
    },

    anuncio(): ContaAnunciada[] {
      const vistas = new Set<string>();
      const escolhidas = new Set<ContaLocal>();
      // A melhor cópia de cada conta, na ordem da lista (a ordem em que as contas novas entram no servidor).
      for (const c of [...contas].sort(melhorCopia)) {
        const k = `${c.ia}:${c.impressao}`;
        if (c.impressao === null || vistas.has(k)) continue;
        vistas.add(k);
        escolhidas.add(c);
      }
      return contas.filter((c) => escolhidas.has(c)).map((c) => ({
        impressao: c.impressao!,
        ia: c.ia,
        estado: c.estado,
        plano: c.plano,
        corporativa: contaCorporativa({ id: c.id, plano: c.plano?.toLowerCase() ?? null }),
        logadaEm: c.logadaEm,
        ...(apelidoQuePodeSair(c) ? { apelidoSugerido: c.apelido! } : {}),
        ...identidade(c),
      }));
    },

  };
}
