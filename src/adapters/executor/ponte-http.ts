import type { FluxoVivo } from "./computador.ts";
import type { ComandoComputador, EstadoComputadorRelatado, ResultadoComandoComputador } from "../../contracts/computador-motor.ts";
import type { SessaoVivo } from "../../contracts/computador-vivo.ts";
import { IAS_COM_CONTA, type IaComConta, type ProgressoDoLogin, type PuxadaDeContas } from "../../contracts/contas-ia.ts";
import type { PedidoDeInstalacao, ProgressoDeInstalacao } from "../../contracts/instalacoes-ssh.ts";
import type { AnuncioMaquina, PastaParaLimpar, PonteInterna, RespostaRenovar, TrechoVivo, VigiaVivo } from "../../contracts/ponte.ts";
import type { DesfazerParaRodar } from "../../contracts/checkpoint.ts";
import type { EsperaParaRodar } from "../../contracts/espera.ts";
import type { PlanoTurno } from "../../contracts/plano-turno.ts";
import type { SubagenteVivo, TarefaDoBot } from "../../contracts/turno.ts";
import { versaoAceita } from "../../domain/versao-app.ts";
import { log } from "../../obs/log.ts";
import { ENTREGA_ESPERA_INICIAL_MS, ENTREGA_ESPERA_MAX_MS, ENTREGA_PERSISTENCIA_MS, LEASE_MS, TOLERANCIA_REINICIO_MS } from "../../shared/constantes.ts";
import { lerOpcoesRemover } from "../../shared/opcoes-remover.ts";

// NOD-214: a máquina desiste do turno sem resposta ANTES de o lease vencer no servidor — nunca roda o que ele já deu por perdido.
if (TOLERANCIA_REINICIO_MS >= LEASE_MS) throw new Error("TOLERANCIA_REINICIO_MS precisa ficar abaixo de LEASE_MS");

export class FalhaPonte extends Error {
  /**
   * `rota_ausente` (NOD-199): o servidor não conhece a rota (404) — só a chamada que pede `rota404` vê este código.
   * `ja_assentado` (NOD-214): o servidor diz que o turno já foi assentado — para a entrega, é sucesso.
   * `acao_recusada` (revisão do PR #291): 403 `nao_permitido` de uma rota de máquina — a chave vale (chave inválida é 401
   * no roteador), mas o servidor recusa ESTA ação (o entregar de um turno que o processo novo não conhece). Não é
   * `chave_invalida`: essa faz o motor e o app pararem todos os turnos.
   * `entrada_invalida` (NOD-245): 400 — o servidor recusou o corpo. É definitivo: repetir o mesmo corpo dá o mesmo 400 (antes
   * virava `servidor_fora` e a entrega insistia por 120 s).
   */
  readonly codigo: "servidor_fora" | "chave_invalida" | "atualize_app" | "reconectar" | "resposta_invalida" | "rota_ausente" | "ja_assentado" | "acao_recusada" | "entrada_invalida";
  constructor(codigo: FalhaPonte["codigo"]) { super(codigo); this.codigo = codigo; }
}

/** definido em 2026-09-17: somente HTTPS; loopback HTTP só quando explicitamente habilitado em desenvolvimento. */
export function urlServidor(valor: unknown, desenvolvimento = false): string {
  if (typeof valor !== "string") throw new FalhaPonte("resposta_invalida");
  const u = new URL(valor);
  if (u.username || u.password || u.search || u.hash || u.pathname !== "/" || (u.protocol !== "https:" && !(desenvolvimento && u.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)))) throw new FalhaPonte("resposta_invalida");
  return u.origin;
}

/**
 * ADR-088: o que veio do servidor tem a forma de `PastaParaLimpar` (o Mac ainda confere o caminho antes de apagar). Valor
 * de `quando` desconhecido (de um servidor mais novo) descarta o item, sem erro. ADR-099 (I5): `sem_trabalho` entra.
 */
function pastaParaLimparValida(v: unknown): v is PastaParaLimpar {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Record<string, unknown>;
  return typeof p.trabalhoId === "string" && typeof p.pasta === "string" && (p.quando === "encerrada" || p.quando === "so_com_pr_mergeado" || p.quando === "sem_trabalho");
}

/** ADR-099: o que veio do servidor tem a forma de `EsperaParaRodar` (o app ainda confere a pasta antes de rodar). */
function esperaValida(v: unknown): v is EsperaParaRodar {
  if (typeof v !== "object" || v === null) return false;
  const e = v as Record<string, unknown>;
  return typeof e.id === "string" && typeof e.comando === "string" && (e.pasta === null || typeof e.pasta === "string") && typeof e.iniciada === "boolean";
}

/** NOD-54: o que veio do servidor tem a forma de `DesfazerParaRodar` (a máquina ainda confere a pasta e o turno). */
function desfazerValido(v: unknown): v is DesfazerParaRodar {
  if (typeof v !== "object" || v === null) return false;
  const e = v as Record<string, unknown>;
  return typeof e.turnoId === "string" && typeof e.pastaDoBot === "string" && Number.isSafeInteger(e.tentativa) && Array.isArray(e.forcar) && e.forcar.every((f) => typeof f === "string");
}

/**
 * `aoLimparAgora` (ADR-099 item 9, definido em 2026-10-12, I5): a resposta do `entregar` trouxe a pasta da frente que
 * terminou com o turno (`limparAgora`, só `sem_trabalho`). Chamado fora da entrega (`setTimeout`), depois de o laço já ter
 * esquecido o turno: senão a limpeza veria a pasta ainda em uso.
 */
/**
 * `relogio`/`dormir` (NOD-214): injetáveis no teste da tolerância ao reinício e da espera da entrega.
 */
export function criarPonteHttp(o: { url: string; chave: string; versao: string; fetchImpl?: typeof fetch; aoFalhar?: (codigo: FalhaPonte["codigo"]) => void; aoLimparAgora?: (pastas: PastaParaLimpar[]) => void; relogio?: () => number; dormir?: (ms: number) => Promise<void> }) {
  const f = o.fetchImpl ?? fetch;
  const agora = o.relogio ?? Date.now;
  const dormir = o.dormir ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  /**
   * revisto em 2026-10-15 (NOD-245): quando começou a falha em curso de cada turno — gravado na primeira renovação sem
   * resposta e apagado a cada resposta boa. A renovação sem resposta devolve `indefinido` até `TOLERANCIA_REINICIO_MS`
   * depois DELA (antes contava da última resposta boa, e um deploy de 45 s, com a última resposta 25 s antes, matava o CLI).
   */
  const primeiraFalha = new Map<string, number>();
  let anuncio: AnuncioMaquina | null = null;
  /** Um buffer por turno: com o pool de laços, dois turnos renovam em paralelo e não podem trocar texto. */
  const trechos = new Map<string, TrechoVivo[]>();
  const ativos = new Set<AbortController>();
  /**
   * NOD-199: os turnos puxados e ainda não entregues (entregue ou abandonado). Com algum aqui, o anúncio de inventário
   * num servidor antigo NÃO cai no `conectar`, que recusaria ou limparia os planos do servidor.
   */
  const emAndamento = new Set<string>();
  /** NOD-350: a entrega pode tentar por até 120 s; nesse meio a lista republicada não recria a fila que ela limpou. */
  const entregando = new Set<string>();
  /**
   * NOD-199: já houve um `conectar` aceito — daí em diante o anúncio vai sempre pela rota de inventário. Um 409 de outra
   * rota (o `conectar` recusado com turno rodando, um `puxar` concorrente) NÃO volta a mandar o anúncio pelo `conectar`:
   * se o servidor de fato esqueceu a máquina, a própria rota de inventário responde 409 e só então cai no `conectar`.
   */
  let conectado = false;
  /**
   * Revisão do PR #291: a reconexão do 409 em voo. Com o pool de laços, os turnos vivos recebem 409 juntos depois do
   * reinício; todos esperam a MESMA reconexão em vez de mandar N `conectar` em rajada ao servidor recém-subido.
   */
  let reconexao: Promise<void> | null = null;
  /** QA da NOD-214: quantos `conectar` o servidor aceitou — o reanúncio sabe se outra reconexão já passou enquanto ele esperava. */
  let conexoes = 0;
  function reconectar(m: AnuncioMaquina): Promise<void> {
    reconexao ??= ponte.conectar(m).finally(() => { reconexao = null; });
    return reconexao;
  }
  /**
   * NOD-214: o token de cada turno puxado (vem no plano). Vai no header `x-nod-token-turno` da renovação e da entrega: o
   * processo novo de um deploy, que não conhece o turno, reconhece-o por ele. Sai junto com o turno (entregue ou abandonado).
   */
  const tokens = new Map<string, string>();
  async function chamar<T>(nome: string, corpo: unknown, opcoes: { rota404?: true; tokenDeTurno?: string } = {}): Promise<T> {
    const ctrl = new AbortController(); ativos.add(ctrl);
    const timer = setTimeout(() => ctrl.abort(), 35_000);
    try {
      const r = await f(`${o.url}/api/maquina/${nome}`, { method: "POST", headers: { authorization: `Bearer ${o.chave}`, "content-type": "application/json", "x-nod-versao": o.versao, ...(opcoes.tokenDeTurno ? { "x-nod-token-turno": opcoes.tokenDeTurno } : {}) }, body: JSON.stringify(corpo), signal: ctrl.signal, redirect: "error" });
      const minima = r.headers.get("x-nod-versao-minima");
      if (r.status === 426 || (minima && !versaoAceita(o.versao, minima))) throw new FalhaPonte("atualize_app");
      const codigo = r.ok ? undefined : await codigoDoCorpo(r);
      if (codigo === "ja_assentado") throw new FalhaPonte("ja_assentado");
      if (r.status === 400) throw new FalhaPonte("entrada_invalida");
      if (r.status === 403 && codigo === "nao_permitido") throw new FalhaPonte("acao_recusada");
      if (r.status === 401 || r.status === 403) throw new FalhaPonte("chave_invalida");
      if (r.status === 409) throw new FalhaPonte("reconectar");
      if (r.status === 404 && opcoes.rota404) throw new FalhaPonte("rota_ausente");
      if (!r.ok) throw new FalhaPonte("servidor_fora");
      return await r.json() as T;
    } catch (e) {
      const erro = e instanceof FalhaPonte ? e : new FalhaPonte("servidor_fora");
      // O 404 da rota nova num servidor antigo não é falha de conexão: quem pediu decide (nada de aviso na tela).
      // `ja_assentado`, `acao_recusada` e `entrada_invalida` falam do turno, não da conexão: nada de aviso (nem de parar a máquina).
      if (erro.codigo !== "rota_ausente" && erro.codigo !== "ja_assentado" && erro.codigo !== "acao_recusada" && erro.codigo !== "entrada_invalida") o.aoFalhar?.(erro.codigo);
      throw erro;
    } finally { clearTimeout(timer); ativos.delete(ctrl); }
  }
  const ponte: PonteInterna & Required<Pick<PonteInterna, "anunciarInventario">> = {
    // NOD-214: este cliente (com o laço) atravessa o reinício do servidor — o anúncio diz isso, e a drenagem deixa de esperá-lo.
    // Auditoria A4 (definido em 2026-10-15): os turnos que este processo roda vão junto — o servidor descarta o plano que
    // ele não conhece (de um processo anterior que morreu sem `desconectar`) em vez de recusar o `conectar` por 90 s.
    async conectar(m) { anuncio = { ...m, sobreviveReinicio: true }; await chamar("conectar", { ...anuncio, turnosEmAndamento: [...emAndamento] }); conectado = true; conexoes++; },
    /**
     * NOD-199: o anúncio da vigia. Antes do primeiro `conectar` aceito vai pelo `conectar`; o 409 da rota de inventário
     * (servidor sem esta conexão) também cai nele, que é a recuperação. Conectado, vai pela rota só de inventário e guarda o anúncio, para um `reconectar` depois não
     * reanunciar o inventário velho. Servidor antigo (404): cai no `conectar` só sem turno em andamento; com turno, lança
     * e a vigia tenta de novo na próxima passada.
     */
    async anunciarInventario(m) {
      if (!conectado) { await ponte.conectar(m); return; }
      anuncio = { ...m, sobreviveReinicio: true };
      const vistas = conexoes;
      try { await chamar("inventario", anuncio, { rota404: true }); }
      catch (e) {
        if (!(e instanceof FalhaPonte)) throw e;
        if (e.codigo === "reconectar") {
          // QA da NOD-214: o 409 de uma renovação dispara este reanúncio (aoFalhar → vigia) junto da reconexão dela. Um
          // `conectar` próprio aqui chegava ao servidor novo depois de a renovação adotar o turno e levava 409 (ou passava
          // na frente e era a reconexão da renovação que levava). Entra na mesma reconexão; se outra já passou ou está em
          // voo, ela pode ter levado o inventário de antes: reenvia o novo pela rota de inventário.
          if (!reconexao && conexoes === vistas) { await reconectar(m); return; }
          if (reconexao) await reconexao;
          await chamar("inventario", anuncio, { rota404: true });
          return;
        }
        if (e.codigo === "rota_ausente" && emAndamento.size === 0) { await reconectar(m); return; }
        throw e;
      }
    },
    async puxar(_pessoaId, maquina, opcoes) {
      try {
        const plano = (await chamar<{ plano: PlanoTurno | null }>("puxar", { ...(maquina ? { memoria: maquina } : {}), ...(opcoes?.soDaPessoa ? { soDaPessoa: true } : {}) })).plano;
        if (plano) { emAndamento.add(plano.turnoId); primeiraFalha.delete(plano.turnoId); if (plano.tokenDeTurno) tokens.set(plano.turnoId, plano.tokenDeTurno); }
        return plano;
      }
      catch (e) {
        // Revisão do PR #295: o 409 do puxar entra na mesma reconexão das renovações (uma `conectar` só por reinício).
        if (e instanceof FalhaPonte && e.codigo === "reconectar" && anuncio) await reconectar(anuncio);
        throw e;
      }
    },
    /**
     * revisto em 2026-10-12 (NOD-214): a renovação sem resposta não interrompe mais o CLI na hora. Servidor fora, 5xx ou
     * 409 devolvem `{ativo:"indefinido"}` (o laço segue) até `TOLERANCIA_REINICIO_MS` depois da primeira falha (NOD-245); daí em
     * diante, `false`. No 409 (o servidor não conhece esta conexão: reiniciou) reconecta e SÓ ENTÃO renova — a renovação
     * antes da reconexão voltaria 409 de novo. 401/403 (chave revogada), 403 `nao_permitido` (turno recusado) e 426 (app velho) são resposta definitiva: `false`.
     */
    async renovar(p) {
      const enviar = trechos.get(p.turnoId) ?? []; trechos.delete(p.turnoId);
      const token = tokens.get(p.turnoId);
      const pedir = () => chamar<RespostaRenovar>("renovar", { ...p, trechos: enviar }, token ? { tokenDeTurno: token } : {});
      try {
        let r: RespostaRenovar;
        try { r = await pedir(); }
        catch (e) {
          if (!(e instanceof FalhaPonte) || e.codigo !== "reconectar" || !anuncio) throw e;
          await reconectar(anuncio);
          r = await pedir();
        }
        primeiraFalha.delete(p.turnoId);
        return r;
      } catch (e) {
        const codigo = e instanceof FalhaPonte ? e.codigo : "servidor_fora";
        if (codigo === "chave_invalida" || codigo === "atualize_app" || codigo === "acao_recusada") return { ativo: false, versaoMinimaApp: o.versao };
        const desde = primeiraFalha.get(p.turnoId);
        if (desde === undefined) primeiraFalha.set(p.turnoId, agora());
        else if (agora() - desde >= TOLERANCIA_REINICIO_MS) return { ativo: false, versaoMinimaApp: o.versao };
        return { ativo: "indefinido", versaoMinimaApp: o.versao };
      }
    },
    /**
     * revisto em 2026-10-12 (NOD-214): servidor fora, 5xx e 409 (reconecta antes da próxima) tentam de novo com espera de
     * 1 s, 2 s, 4 s… até 10 s, por até `ENTREGA_PERSISTENCIA_MS` (120 s) — o deploy reinicia o servidor em ~10 s, e as 3
     * tentativas em ~2 s de antes perdiam a entrega. `ja_assentado` é sucesso: o servidor já tem o desfecho do turno.
     * `entrada_invalida` (400, NOD-245) não é transitório: falha na primeira tentativa.
     */
    async entregar(e) {
      trechos.delete(e.turnoId);
      entregando.add(e.turnoId);
      const inicio = agora();
      let espera = ENTREGA_ESPERA_INICIAL_MS;
      try {
        for (;;) {
          try {
            const token = tokens.get(e.turnoId);
            const r = await chamar<{ limparAgora?: unknown } | null>("entregar", e, token ? { tokenDeTurno: token } : {});
            const limpar = Array.isArray(r?.limparAgora) ? r.limparAgora.filter(pastaParaLimparValida).filter((p) => p.quando === "sem_trabalho") : [];
            if (limpar.length > 0 && o.aoLimparAgora) { const aviso = o.aoLimparAgora; setTimeout(() => { try { aviso(limpar); } catch { /* a passada de 6 h pega a pasta */ } }, 0); }
            return;
          }
          catch (erro) {
            if (erro instanceof FalhaPonte && erro.codigo === "ja_assentado") return;
            const transitorio = erro instanceof FalhaPonte && (erro.codigo === "servidor_fora" || erro.codigo === "reconectar");
            if (!transitorio || agora() - inicio + espera > ENTREGA_PERSISTENCIA_MS) throw erro;
            await dormir(espera);
            espera = Math.min(espera * 2, ENTREGA_ESPERA_MAX_MS);
            // 409: o servidor esqueceu a conexão (reiniciou) — reconecta antes da próxima tentativa; falhou, a próxima decide.
            if (erro.codigo === "reconectar" && anuncio) await reconectar(anuncio).catch(() => undefined);
          }
        }
      } finally { entregando.delete(e.turnoId); emAndamento.delete(e.turnoId); primeiraFalha.delete(e.turnoId); tokens.delete(e.turnoId); } // entregue ou abandonado: o turno deixou de rodar neste Mac.
    },
    async desconectar() { await chamar("desconectar", {}); },
    /**
     * ADR-088: servidor antigo (404) ou fora do ar devolve lista vazia — a próxima passada tenta de novo. ADR-106: os
     * códigos das pastas que a máquina tem vão junto; servidor antigo os ignora e responde como antes.
     */
    async pastasParaLimpar(_pessoaId, op) {
      try {
        const r = await chamar<{ pastas?: unknown }>("limpeza", { ...(op?.apertado === true ? { apertado: true } : {}), ...(op?.codigos ? { codigos: op.codigos } : {}) });
        return Array.isArray(r.pastas) ? r.pastas.filter(pastaParaLimparValida) : [];
      } catch (e) {
        // ADR-106: a lista vazia por erro parece "nada a limpar" — sem este log a limpeza pararia calada.
        log("aviso", "limpeza_pedido_falhou", { erro: e instanceof Error ? e.name : "desconhecido", codigos: op?.codigos?.length ?? null });
        return [];
      }
    },
    async relatarLimpeza(_pessoaId, relato) { await chamar("limpeza/resultado", { relato }).catch(() => undefined); },
    /**
     * ADR-099 (parte 2): as esperas que esta máquina deve rodar (a máquina é a da chave). Servidor antigo (404) ou fora do
     * ar: null — sem resposta, a máquina não mata nem começa nada.
     */
    async esperas() {
      try {
        const r = await chamar<{ esperas?: unknown }>("esperas", {}, { rota404: true });
        return Array.isArray(r.esperas) ? r.esperas.filter(esperaValida) : null;
      } catch {
        return null;
      }
    },
    async relatarEspera(_pessoaId, _machineId, relato) {
      try {
        const r = await chamar<{ seguir?: unknown }>("esperas/resultado", { relato }, { rota404: true });
        return { seguir: r.seguir === true };
      } catch {
        return null;
      }
    },
    /** NOD-54 (ADR-134): os desfazeres desta máquina. Servidor antigo (404) ou fora do ar: null. */
    async desfazeres() {
      try {
        const r = await chamar<{ desfazeres?: unknown }>("desfazeres", {}, { rota404: true });
        return Array.isArray(r.desfazeres) ? r.desfazeres.filter(desfazerValido) : null;
      } catch {
        return null;
      }
    },
    async relatarDesfazer(_pessoaId, _machineId, relato) {
      try {
        const r = await chamar<{ ok?: unknown }>("desfazeres/relato", { relato }, { rota404: true });
        return { ok: r.ok === true };
      } catch {
        return null;
      }
    },
  };
  /** O `codigo` do corpo JSON de uma resposta de erro (sem corpo ou sem JSON: undefined). */
  async function codigoDoCorpo(r: Response): Promise<string | undefined> {
    try {
      const corpo = await r.clone().json() as { codigo?: unknown } | null;
      return typeof corpo?.codigo === "string" ? corpo.codigo : undefined;
    } catch { return undefined; }
  }
  /** Teto de 16k de texto por renovação (o mesmo da rota): descarta os trechos mais antigos do turno. */
  function aparar(turnoId: string) {
    let fila = trechos.get(turnoId) ?? [];
    let total = fila.reduce((n, t) => n + ("texto" in t ? t.texto.length : 0), 0);
    while (total > 16_000 && fila.length > 0) {
      const t = fila[0]!;
      if ("texto" in t && total - t.texto.length < 16_000) { fila[0] = { texto: t.texto.slice(total - 16_000) }; break; }
      total -= "texto" in t ? t.texto.length : 0;
      fila.shift();
    }
    if (fila.length > 2_000) fila = fila.slice(-2_000);
    trechos.set(turnoId, fila);
  }
  return {
    ponte,
    /**
     * ADR-102 (2026-10-13): as contas de IA desta máquina. `puxar`: o que a tela pediu (logins, saídas, desconexão);
     * null = sem resposta (rede, servidor fora); "sem_rota" = servidor sem contas (404: modo local ou servidor antigo).
     */
    contas: {
      async puxar(): Promise<PuxadaDeContas | null | "sem_rota"> {
        try {
          const r = await chamar<Partial<PuxadaDeContas>>("contas", {}, { rota404: true });
          // NOD-9 PR4: as IAs que a tela pediu para atualizar (só as conhecidas; o servidor antigo não manda o campo).
          const atualizar = Array.isArray(r.atualizar) ? r.atualizar.filter((x): x is IaComConta => (IAS_COM_CONTA as readonly unknown[]).includes(x)) : [];
          // ADA-245: a limpeza local do computador removido por outro lugar; forma estranha = sem limpeza.
          const remover = lerOpcoesRemover(r.remover); // com "Continuar ligado" vem sem desconectar (revisão do PR #694)
          return { logins: Array.isArray(r.logins) ? r.logins : [], sair: Array.isArray(r.sair) ? r.sair.filter((x): x is string => typeof x === "string") : [], desconectar: r.desconectar === true, ...(atualizar.length > 0 ? { atualizar } : {}), ...(remover ? { remover } : {}) };
        } catch (e) {
          return e instanceof FalhaPonte && e.codigo === "rota_ausente" ? "sem_rota" : null;
        }
      },
      /** NOD-8 passo 10: "recusado" = o servidor respondeu 400 (o de antes não conhece `preparando`): não adianta repetir. */
      async progresso(p: ProgressoDoLogin): Promise<boolean | "recusado"> {
        try { await chamar("contas/progresso", p, { rota404: true }); return true; } catch (e) { return e instanceof FalhaPonte && e.codigo === "entrada_invalida" ? "recusado" : false; }
      },
      async saiu(impressoes: string[], desconectada: boolean): Promise<boolean> {
        try { await chamar("contas/saiu", { impressoes, desconectada }, { rota404: true }); return true; } catch { return false; }
      },
    },
    /**
     * NOD-96 PR 3 (definido em 2026-10-22, ADR-122): o canal do computador da pessoa. `puxar` é long-poll (até 20 s);
     * null = sem resposta (rede, servidor fora, a conexão ainda não existe); "sem_rota" = servidor sem o computador no
     * motor (404: flag desligada ou servidor antigo) — o laço espera e tenta de novo bem depois.
     */
    computador: {
      async puxar(): Promise<ComandoComputador[] | null | "sem_rota"> {
        try {
          const r = await chamar<{ comandos?: unknown }>("computador/puxar", {}, { rota404: true });
          return Array.isArray(r.comandos) ? (r.comandos as ComandoComputador[]) : [];
        } catch (e) {
          return e instanceof FalhaPonte && e.codigo === "rota_ausente" ? "sem_rota" : null;
        }
      },
      async resultado(r: ResultadoComandoComputador): Promise<boolean> {
        try { await chamar("computador/resultado", r, { rota404: true }); return true; } catch { return false; }
      },
      async estado(e: EstadoComputadorRelatado): Promise<boolean> {
        try { await chamar("computador/estado", e, { rota404: true }); return true; } catch { return false; }
      },
      /**
       * NOD-95 (ADR-138): o fluxo da tela ao vivo. Um WebSocket de SAÍDA (o servidor nunca disca, ADR-021) para
       * `/api/maquina/computador/vivo/:sessao`, autenticado pelo token de uso único que veio no comando assinado — não
       * pela chave da máquina: o WebSocket global do Node e do Electron não leva header próprio. Só bytes, nos dois sentidos.
       */
      async vivo(sessao: SessaoVivo): Promise<FluxoVivo | null> {
        const WS = (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
        if (!WS) return null;
        const url = new URL(`${o.url}/api/maquina/computador/vivo/${encodeURIComponent(sessao.sessao)}`);
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        url.searchParams.set("t", sessao.token);
        const ws = new WS(url);
        ws.binaryType = "arraybuffer";
        const aberto = await new Promise<boolean>((r) => { ws.onopen = () => r(true); ws.onerror = () => r(false); ws.onclose = () => r(false); });
        if (!aberto) return null;
        ws.onerror = () => {};
        return {
          enviar: (bytes) => { if (ws.readyState === ws.OPEN) ws.send(bytes); },
          aoDados: (fn) => { ws.onmessage = (e) => { if (e.data instanceof ArrayBuffer) fn(new Uint8Array(e.data)); }; },
          aoFechar: (fn) => { ws.onclose = () => fn(); },
          fechar: () => ws.close(),
          atraso: () => ws.bufferedAmount,
        };
      },
    },
    /**
     * NOD-94 (emenda 11 da ADR-090): os pedidos de instalação por SSH desta máquina (instaladora). Mesma convenção das
     * contas: null = sem resposta; "sem_rota" = servidor sem instalações (404). O corpo leva só a chave pública.
     */
    instalacoes: {
      async puxar(chavePublica: string): Promise<PedidoDeInstalacao[] | null | "sem_rota"> {
        try {
          // NOD-344: `servidorProprio` = esta instaladora aceita `servidor: null` (usa a origem a que está pareada).
          const r = await chamar<{ pedidos?: unknown }>("instalacoes", { chavePublica, servidorProprio: true }, { rota404: true });
          return Array.isArray(r.pedidos) ? (r.pedidos as PedidoDeInstalacao[]) : [];
        } catch (e) {
          return e instanceof FalhaPonte && e.codigo === "rota_ausente" ? "sem_rota" : null;
        }
      },
      async progresso(p: ProgressoDeInstalacao): Promise<boolean> {
        try { await chamar("instalacoes/progresso", p, { rota404: true }); return true; } catch { return false; }
      },
    },
    /**
     * ADR-048: os itens aprovados que rodam no gh DESTE Mac. A máquina puxa (o servidor nunca disca,
     * ADR-021), executa e relata; falha de rede devolve lista vazia e a próxima volta tenta de novo.
     */
    async itensLocais(): Promise<{ itemId: string; capacidade: string; argumentos: Record<string, unknown> }[]> {
      try {
        const r = await chamar<{ itens?: unknown }>("itens-locais", {});
        return Array.isArray(r.itens) ? (r.itens as { itemId: string; capacidade: string; argumentos: Record<string, unknown> }[]) : [];
      } catch {
        return [];
      }
    },
    async resultadoItemLocal(itemId: string, desfecho: "executado" | "falhou_na_execucao"): Promise<void> {
      await chamar("itens-locais/resultado", { itemId, desfecho });
    },
    delta(turnoId: string, texto: string) {
      const fila = trechos.get(turnoId) ?? [];
      const ultimo = fila[fila.length - 1];
      if (ultimo && "texto" in ultimo) fila[fila.length - 1] = { texto: ultimo.texto + texto };
      else fila.push({ texto });
      trechos.set(turnoId, fila);
      aparar(turnoId);
    },
    /** NOD-353: `id` é o do tool_use, para a tela fechar esta chamada quando o resultado voltar. */
    ferramenta(turnoId: string, nome: string, id?: string) { trechos.set(turnoId, [...(trechos.get(turnoId) ?? []), id ? { ferramenta: nome, id } : { ferramenta: nome }]); aparar(turnoId); },
    /** NOD-353: a chamada `id` terminou; `falhou` = tool_result.isError. */
    fimDaFerramenta(turnoId: string, id: string, falhou: boolean) { trechos.set(turnoId, [...(trechos.get(turnoId) ?? []), { fim: id, falhou }]); aparar(turnoId); },
    /** A lista inteira substitui a que ainda não saiu: só a mais nova importa. */
    tarefas(turnoId: string, lista: TarefaDoBot[]) { trechos.set(turnoId, [...(trechos.get(turnoId) ?? []).filter((t) => !("tarefas" in t)), { tarefas: lista }]); aparar(turnoId); },
    /** O vigia do turno (NOD-73): como as tarefas, o aviso mais novo substitui o que ainda não saiu — só ele importa. */
    vigia(turnoId: string, aviso: VigiaVivo) { trechos.set(turnoId, [...(trechos.get(turnoId) ?? []).filter((t) => !("vigia" in t)), { vigia: aviso }]); aparar(turnoId); },
    /** NOD-350: a lista dos subagentes, como as tarefas: a mais nova substitui a que ainda não saiu (a renovação é ≤1/s). */
    subagentes(turnoId: string, lista: SubagenteVivo[], ocioso?: boolean) {
      // O `parar` do fim do turno publica depois do `entregar` (que já limpou os trechos): sem o turno em andamento, a
      // entrada recriada nunca mais sairia nem seria apagada. A web marca os parados sozinha no fim do turno.
      if (!emAndamento.has(turnoId) || entregando.has(turnoId)) return;
      trechos.set(turnoId, [...(trechos.get(turnoId) ?? []).filter((t) => !("subagentes" in t)), ocioso === undefined ? { subagentes: lista } : { subagentes: lista, ocioso }]);
      aparar(turnoId);
    },
    cancelar() { for (const c of ativos) c.abort(); },
  };
}
