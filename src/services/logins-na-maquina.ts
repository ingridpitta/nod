import type { OpcoesRemover } from "../contracts/remover-computador.ts";
import { randomUUID } from "node:crypto";
import type { CodigoCifrado, FaseLogin, IaComConta, LoginNaMaquina, LoginPendente, ProgressoDoLogin } from "../contracts/contas-ia.ts";
import { FASES_LOGIN_FINAIS } from "../contracts/contas-ia.ts";
import { linkOficial } from "../shared/links-de-login.ts";
import type { Escopo } from "../shared/types.ts";

/**
 * O login de uma conta numa máquina pela tela (definido em 2026-10-13, ADR-102 item 3). Em memória e sem banco, como o
 * pareamento (src/services/pareamento-dispositivo.ts): um login vive minutos, e um reinício do servidor só obriga a
 * pessoa a apertar "Tentar de novo".
 *
 *   tela: pedir(máquina, IA, conta) ──► a máquina puxa (a cada 3 s; 1 s com login aberto) e roda o CLI na pasta da conta
 *   máquina: progresso([preparando →] abrindo → aguardando_pessoa com o link oficial e, no Claude, a chave pública)
 *   tela: colarCodigo(cifrado com a chave pública da máquina) ──► a máquina recebe UMA vez, decifra e entrega ao CLI
 *   máquina: progresso(pronto com a impressão | falhou com o código do erro)
 *
 * NOD-8 (2026-10-22): `preparando` é o passo 1, quando a máquina instala ou atualiza a IA antes de abrir o login; o
 * `preparo` do último relato que o trouxe fica no login (a tela mostra a versão também no concluído).
 *
 * O código do Claude chega aqui só cifrado e sai na próxima puxada: nunca fica em claro no servidor, nem em log nem em
 * banco. A cifra não protege contra o próprio servidor comprometido (ele serve o JS que cifra): R5 da revisão.
 */

/** definido em 2026-10-13: o mesmo prazo do login no app do Mac (desktop/login-ia.ts, o fluxo vive 15 min). */
export const PRAZO_LOGIN_MS = 15 * 60_000;
/** definido em 2026-10-13: logins abertos ao mesmo tempo por pessoa (o protótipo abre dois: um Claude e um Codex). */
export const MAX_LOGINS_POR_PESSOA = 3;
/**
 * definido em 2026-10-13 (revisão do PR #306): quanto a máquina tem para sair das contas e confirmar o "Desconectar".
 * Ela puxa a cada 3 s; passado o prazo a chave vence sozinha (maquina_tokens.expira_em).
 */
export const PRAZO_DESCONEXAO_MS = 2 * 60_000;
/**
 * NOD-9 (definido em 2026-10-22): quanto vale o pedido de "Atualizar" de uma IA numa máquina, se ela não puxar antes. A
 * máquina puxa a cada 3 s; passado o prazo o pedido some, e a tela mostra de novo o botão pelo anúncio.
 */
export const PRAZO_PEDIDO_ATUALIZAR_MS = 2 * 60_000;
/**
 * ADA-245: quanto vale o pedido de remover o nod de um computador removido por outro lugar (outra tela, o chat) que fica
 * ligado à conta: ele se limpa quando voltar a puxar. Em memória, como o resto: some num reinício do servidor.
 */
export const PRAZO_REMOCAO_MS = 24 * 60 * 60_000;
/** O texto cifrado é pequeno (o código do Claude tem até 2048 caracteres): 8 KB de folga. */
const MAX_CIFRADO = 8_192;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const CHAVE_PUBLICA_MAX = 2_048;
const CODIGO_DISPOSITIVO = /^[A-Z0-9]{4}-?[A-Z0-9]{4,5}$/;
const ERRO = /^[a-z_]{1,40}$/;

type Login = LoginNaMaquina & { escopo: Escopo; impressaoEsperada: string | null; codigo: CodigoCifrado | null; avisarCancelamento: boolean; ate: number };

export interface LoginsNaMaquina {
  /** null = a pessoa já tem MAX_LOGINS_POR_PESSOA abertos (quem chama responde 429). */
  pedir(e: { escopo: Escopo; maquinaId: string; ia: IaComConta; contaId: string | null; impressao: string | null; apelido: string | null }): LoginNaMaquina | null;
  ver(escopo: Escopo, id: string): LoginNaMaquina | null;
  /** Os logins abertos desta máquina, com o código cifrado (uma vez) e o cancelamento (uma vez). */
  pendentes(escopo: Escopo, maquinaId: string): LoginPendente[];
  /** O progresso relatado pela máquina. false = login desconhecido, de outra máquina, já terminado ou link fora da lista. */
  progresso(escopo: Escopo, maquinaId: string, p: ProgressoDoLogin): { aceito: boolean; login: LoginNaMaquina | null };
  colarCodigo(escopo: Escopo, id: string, cifrado: CodigoCifrado): "ok" | "sem_login" | "nao_pede_codigo" | "ja_enviado" | "invalido";
  cancelar(escopo: Escopo, id: string): boolean;
  /** O anúncio registrou a conta que entrou: o login aponta para ela (a tela mostra "Pronta" na linha certa). */
  ligarConta(escopo: Escopo, id: string, contaFinalId: string): void;
  /** "Desconectar a máquina" com "Sair também das contas": a próxima puxada leva `desconectar: true` (vale 10 min). */
  pedirDesconexao(escopo: Escopo, maquinaId: string): void;
  desconexaoPedida(escopo: Escopo, maquinaId: string): boolean;
  concluirDesconexao(escopo: Escopo, maquinaId: string): boolean;
  /** ADA-245: "Remover o nod" deste computador por outro lugar: a próxima puxada leva `remover` (e `desconectar`). */
  pedirRemocao(escopo: Escopo, maquinaId: string, opcoes: OpcoesRemover, prazoMs?: number): void;
  remocaoPedida(escopo: Escopo, maquinaId: string): OpcoesRemover | null;
  /** O computador confirmou a limpeza: o pedido sai e volta (null = não havia). */
  concluirRemocao(escopo: Escopo, maquinaId: string): OpcoesRemover | null;
  /** NOD-9: o botão "Atualizar" de uma IA numa máquina (a VM): a próxima puxada leva `atualizar: [ia]`. */
  pedirAtualizacao(escopo: Escopo, maquinaId: string, ia: IaComConta): void;
  /** As IAs com pedido de atualizar nesta máquina; cada pedido sai UMA vez (a puxada o consome). */
  atualizacoesPedidas(escopo: Escopo, maquinaId: string): IaComConta[];
  /** Quantos pedidos de atualização estão guardados agora (os testes conferem que os vencidos saem). */
  pedidosDeAtualizacaoGuardados(): number;
}

export function cifradoValido(v: unknown): CodigoCifrado | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const campo = (x: unknown, max: number) => typeof x === "string" && x.length > 0 && x.length <= max && BASE64.test(x);
  return campo(o.chave, 1_024) && campo(o.iv, 64) && campo(o.dados, MAX_CIFRADO) ? { chave: o.chave as string, iv: o.iv as string, dados: o.dados as string } : null;
}

export function criarLoginsNaMaquina(agora: () => number = Date.now): LoginsNaMaquina {
  const logins = new Map<string, Login>();
  const desconexoes = new Map<string, number>();
  const remocoes = new Map<string, { opcoes: OpcoesRemover; ate: number }>();
  /** chaveMaquina → IA → até quando o pedido vale. */
  const atualizacoes = new Map<string, Map<IaComConta, number>>();
  const chaveMaquina = (escopo: Escopo, maquinaId: string) => `${escopo.tenantId}:${escopo.pessoaId}:${maquinaId}`;
  const daPessoa = (escopo: Escopo) => [...logins.values()].filter((l) => l.escopo.tenantId === escopo.tenantId && l.escopo.pessoaId === escopo.pessoaId);
  const final = (f: FaseLogin) => FASES_LOGIN_FINAIS.includes(f);
  const publico = (l: Login): LoginNaMaquina => {
    const { escopo: _e, impressaoEsperada: _i, codigo: _c, avisarCancelamento: _a, ate: _t, ...resto } = l;
    return resto;
  };
  const varrer = () => {
    const t = agora();
    for (const [id, l] of logins) {
      if (!final(l.fase) && l.ate <= t) Object.assign(l, { fase: "falhou", erro: "tempo_esgotado", atualizadoEm: t, codigo: null });
      // Um login terminado fica visível 10 min (a tela relê) e depois sai.
      if (final(l.fase) && t - l.atualizadoEm > 10 * 60_000) logins.delete(id);
    }
  };
  const doEscopo = (escopo: Escopo, id: string) => {
    varrer();
    const l = logins.get(id);
    return l && l.escopo.tenantId === escopo.tenantId && l.escopo.pessoaId === escopo.pessoaId ? l : null;
  };
  return {
    pedir(e) {
      varrer();
      if (daPessoa(e.escopo).filter((l) => !final(l.fase)).length >= MAX_LOGINS_POR_PESSOA) return null;
      // Um login aberto da mesma conta na mesma máquina é substituído (a pessoa apertou "Entrar" de novo).
      for (const l of daPessoa(e.escopo)) {
        if (!final(l.fase) && l.maquinaId === e.maquinaId && l.ia === e.ia && l.contaId === e.contaId && e.contaId !== null) Object.assign(l, { fase: "cancelado", avisarCancelamento: true, atualizadoEm: agora(), codigo: null });
      }
      const t = agora();
      const l: Login = {
        id: randomUUID(), maquinaId: e.maquinaId, ia: e.ia, contaId: e.contaId, apelido: e.apelido, fase: "pedido", url: null, codigoDispositivo: null, pedeCodigo: false,
        chavePublica: null, codigoEnviado: false, erro: null, contaFinalId: null, preparo: null, criadoEm: t, atualizadoEm: t,
        escopo: e.escopo, impressaoEsperada: e.impressao, codigo: null, avisarCancelamento: false, ate: t + PRAZO_LOGIN_MS,
      };
      logins.set(l.id, l);
      return publico(l);
    },
    ver(escopo, id) {
      const l = doEscopo(escopo, id);
      return l ? publico(l) : null;
    },
    pendentes(escopo, maquinaId) {
      varrer();
      const saida: LoginPendente[] = [];
      for (const l of daPessoa(escopo)) {
        if (l.maquinaId !== maquinaId) continue;
        if (l.fase === "cancelado" && l.avisarCancelamento) {
          saida.push({ id: l.id, ia: l.ia, impressao: l.impressaoEsperada, apelido: l.apelido, cancelado: true });
          l.avisarCancelamento = false;
          continue;
        }
        if (final(l.fase)) continue;
        const p: LoginPendente = { id: l.id, ia: l.ia, impressao: l.impressaoEsperada, apelido: l.apelido };
        if (l.codigo) {
          p.codigo = l.codigo;
          // Entregue uma vez: o texto cifrado sai do servidor na hora.
          l.codigo = null;
        }
        saida.push(p);
      }
      return saida;
    },
    progresso(escopo, maquinaId, p) {
      const l = doEscopo(escopo, p.loginId);
      if (!l || l.maquinaId !== maquinaId || final(l.fase)) return { aceito: false, login: l ? publico(l) : null };
      const t = agora();
      if (p.url !== undefined) {
        const oficial = linkOficial(l.ia, p.url);
        if (!oficial) return { aceito: false, login: publico(l) };
        l.url = oficial;
      }
      if (p.codigoDispositivo !== undefined) {
        if (!CODIGO_DISPOSITIVO.test(p.codigoDispositivo)) return { aceito: false, login: publico(l) };
        l.codigoDispositivo = p.codigoDispositivo;
      }
      if (p.chavePublica !== undefined) {
        if (p.chavePublica.length > CHAVE_PUBLICA_MAX || !BASE64.test(p.chavePublica)) return { aceito: false, login: publico(l) };
        l.chavePublica = p.chavePublica;
      }
      if (p.pedeCodigo !== undefined) l.pedeCodigo = p.pedeCodigo;
      if (p.preparo !== undefined) l.preparo = structuredClone(p.preparo);
      if (p.erro !== undefined) {
        if (!ERRO.test(p.erro)) return { aceito: false, login: publico(l) };
        l.erro = p.erro;
      }
      l.fase = p.fase;
      if (final(p.fase)) l.codigo = null;
      l.atualizadoEm = t;
      return { aceito: true, login: publico(l) };
    },
    colarCodigo(escopo, id, cifrado) {
      const l = doEscopo(escopo, id);
      if (!l || final(l.fase)) return "sem_login";
      if (!l.pedeCodigo || !l.chavePublica) return "nao_pede_codigo";
      if (l.codigoEnviado) return "ja_enviado";
      if (!cifradoValido(cifrado)) return "invalido";
      l.codigo = cifrado;
      l.codigoEnviado = true;
      l.fase = "conferindo";
      l.atualizadoEm = agora();
      return "ok";
    },
    cancelar(escopo, id) {
      const l = doEscopo(escopo, id);
      if (!l || final(l.fase)) return false;
      Object.assign(l, { fase: "cancelado", avisarCancelamento: true, codigo: null, atualizadoEm: agora() });
      return true;
    },
    ligarConta(escopo, id, contaFinalId) {
      const l = doEscopo(escopo, id);
      if (l) l.contaFinalId = contaFinalId;
    },
    pedirDesconexao(escopo, maquinaId) {
      desconexoes.set(chaveMaquina(escopo, maquinaId), agora() + PRAZO_DESCONEXAO_MS);
    },
    desconexaoPedida(escopo, maquinaId) {
      const ate = desconexoes.get(chaveMaquina(escopo, maquinaId));
      if (ate !== undefined && ate <= agora()) desconexoes.delete(chaveMaquina(escopo, maquinaId));
      return ate !== undefined && ate > agora();
    },
    concluirDesconexao(escopo, maquinaId) {
      return desconexoes.delete(chaveMaquina(escopo, maquinaId));
    },
    pedirRemocao(escopo, maquinaId, opcoes, prazoMs = PRAZO_DESCONEXAO_MS) {
      const t = agora();
      for (const [k, r] of remocoes) if (r.ate <= t) remocoes.delete(k);
      remocoes.set(chaveMaquina(escopo, maquinaId), { opcoes: { manterIas: opcoes.manterIas, manterConexao: opcoes.manterConexao }, ate: t + prazoMs });
    },
    remocaoPedida(escopo, maquinaId) {
      const k = chaveMaquina(escopo, maquinaId);
      const r = remocoes.get(k);
      if (r && r.ate <= agora()) remocoes.delete(k);
      return r && r.ate > agora() ? r.opcoes : null;
    },
    concluirRemocao(escopo, maquinaId) {
      const k = chaveMaquina(escopo, maquinaId);
      const r = remocoes.get(k);
      remocoes.delete(k);
      return r && r.ate > agora() ? r.opcoes : null;
    },
    pedirAtualizacao(escopo, maquinaId, ia) {
      // Devolução do #501 (2026-10-23): a máquina que nunca mais puxou deixava o pedido no mapa para sempre — cada
      // pedido novo varre os vencidos (de qualquer máquina) antes de guardar o seu.
      const t = agora();
      for (const [k, porIa] of atualizacoes) {
        for (const [x, ate] of porIa) if (ate <= t) porIa.delete(x);
        if (porIa.size === 0) atualizacoes.delete(k);
      }
      const chave = chaveMaquina(escopo, maquinaId);
      const pedidos = atualizacoes.get(chave) ?? new Map<IaComConta, number>();
      pedidos.set(ia, agora() + PRAZO_PEDIDO_ATUALIZAR_MS);
      atualizacoes.set(chave, pedidos);
    },
    pedidosDeAtualizacaoGuardados() {
      return [...atualizacoes.values()].reduce((n, m) => n + m.size, 0);
    },
    atualizacoesPedidas(escopo, maquinaId) {
      const chave = chaveMaquina(escopo, maquinaId);
      const pedidos = atualizacoes.get(chave);
      if (!pedidos) return [];
      atualizacoes.delete(chave);
      return [...pedidos].filter(([, ate]) => ate > agora()).map(([ia]) => ia);
    },
  };
}
