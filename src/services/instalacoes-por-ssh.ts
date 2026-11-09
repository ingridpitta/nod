import { randomUUID } from "node:crypto";
import type { CodigoCifrado } from "../contracts/contas-ia.ts";
import {
  ESTADOS_INSTALACAO_FINAIS, ETAPAS_INSTALACAO, MOTIVOS_INSTALACAO,
  type EstadoInstalacao, type EtapaInstalacao, type InstalacaoCriadaDto, type InstalacaoSshDto, type MetodoSsh, type MotivoInstalacao,
  type PedidoDeInstalacao, type ProgressoDeInstalacao,
} from "../contracts/instalacoes-ssh.ts";
import type { PlataformaMaquina } from "../contracts/ponte.ts";
import type { Escopo } from "../shared/types.ts";
import { PRAZO_CONVITE_MS } from "./pareamento-dispositivo.ts";

/**
 * NOD-94 (emenda 11 da ADR-090): os pedidos de instalação por SSH. Puro e SEM banco (src/services), em memória como os
 * logins na máquina (logins-na-maquina.ts): um pedido vive minutos, e um reinício do servidor só leva a pessoa a
 * "Tentar de novo" (`nao_pareou`).
 *
 * A CREDENCIAL (chave privada, senha, frase-senha) só passa por aqui cifrada com a chave pública da instaladora
 * (RSA-OAEP + AES-GCM, ADR-102), sai na próxima puxada dela e some — nunca vai a banco nem a log, e nenhuma função
 * daqui a devolve à tela. A cifra não protege contra o próprio servidor comprometido (R5 da ADR-102, risco aceito).
 *
 * Instaladora: a máquina da pessoa que puxa `/ponte/:id/instalacoes` mandando a chave pública do par que ela gerou ao
 * subir (o par vive só na memória dela). A pública volta à tela no `POST /maquinas/ssh`; se a instaladora reiniciar
 * (par novo) antes de usar o cifrado, os pedidos dela caem em `nao_pareou` e a pessoa tenta de novo.
 */

/** O pedido vive o mesmo que o convite que ele leva (ADR-102: 30 min). */
export const PRAZO_INSTALACAO_MS = PRAZO_CONVITE_MS;
/** definido em 2026-10-22 (plano da NOD-94): pedidos abertos ao mesmo tempo por pessoa (429 acima disso). */
export const MAX_INSTALACOES_POR_PESSOA = 3;
/** A instaladora puxa a cada 3 s; sem puxar há 15 s, não é oferecida (a tela escolhe outra ou mostra `sem_instaladora`). */
export const INSTALADORA_VIVA_MS = 15_000;
/** definido em 2026-10-22 (plano da NOD-94): o cifrado da credencial (uma chave RSA de 4096 bits cabe com folga). */
export const MAX_CREDENCIAL = 16_384;
const MAX_LINHAS = 20;
const MAX_LINHA = 300;
const MAX_INSTALADORAS = 1_000;
const MAX_PEDIDOS = 1_000;
/** Um pedido terminado fica visível 10 min (a tela relê) e depois sai. */
const VISIVEL_DEPOIS_MS = 10 * 60_000;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const CHAVE_PUBLICA_MAX = 2_048;
/** A impressão do `ssh-keygen -l` (SHA256 em base64 sem preenchimento). */
const IMPRESSAO = /^SHA256:[A-Za-z0-9+/]{20,64}={0,2}$/;
/**
 * Host (nome, IPv4 ou IPv6) e apelido do ~/.ssh/config: nunca começa com "-" (viraria opção do ssh) e não tem espaço
 * nem caractere de shell. O usuário segue o formato do useradd.
 */
const HOST = /^(?!-)[A-Za-z0-9._:%-]{1,253}$/;
const USUARIO = /^(?!-)[A-Za-z0-9_][A-Za-z0-9_.-]{0,31}$/;

export function hostValido(v: unknown): string | null {
  return typeof v === "string" && HOST.test(v.trim()) ? v.trim() : null;
}
export function usuarioValido(v: unknown): string | null {
  return typeof v === "string" && USUARIO.test(v.trim()) ? v.trim() : null;
}
export function portaValida(v: unknown): number | null {
  if (v === undefined || v === null) return 22;
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 65_535 ? v : null;
}
export function impressaoValida(v: unknown): string | null {
  return typeof v === "string" && IMPRESSAO.test(v) ? v : null;
}
/** O cifrado da credencial: o mesmo formato do código do login (ADR-102), com teto de 16 KB. */
export function credencialValida(v: unknown): CodigoCifrado | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const campo = (x: unknown, max: number) => typeof x === "string" && x.length > 0 && x.length <= max && BASE64.test(x);
  return campo(o.chave, 1_024) && campo(o.iv, 64) && campo(o.dados, MAX_CREDENCIAL) ? { chave: o.chave as string, iv: o.iv as string, dados: o.dados as string } : null;
}
export function chavePublicaValida(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 && v.length <= CHAVE_PUBLICA_MAX && BASE64.test(v) ? v : null;
}

export type Instaladora = { machineId: string; plataforma: PlataformaMaquina; vistoEm: number };

type Pedido = {
  id: string; escopo: Escopo; origemId: string; chavePublica: string;
  host: string; porta: number; usuario: string; metodo: MetodoSsh;
  impressaoConhecida: string | null; impressaoVista: string | null; convite: string; servidor: string | null;
  estado: EstadoInstalacao; etapa: EtapaInstalacao | null; motivo: MotivoInstalacao | null;
  impressoes: { antiga: string; nova: string } | null; linhas: string[]; maquinaId: string | null;
  cifrado: CodigoCifrado | null; entregue: boolean; avisarCancelamento: boolean; conviteRevogado: boolean;
  criadoEm: number; atualizadoEm: number; ate: number;
};

export type NovoPedido = {
  escopo: Escopo;
  origemId?: string | null;
  host: string; porta: number; usuario: string; metodo: MetodoSsh;
  impressaoConhecida: string | null;
  /** null = o nod sem NOD_URL_PUBLICA: a instaladora usa a origem dela (NOD-344). */
  servidor: string | null;
  /** Chamado só depois das checagens (o convite não nasce para um pedido recusado). */
  criarConvite(): string;
};

export interface InstalacoesPorSsh {
  /** A instaladora puxou (a cada 3 s) com a chave pública dela. Par novo = os pedidos que ela tinha caem em `nao_pareou`. */
  anunciarInstaladora(escopo: Escopo, machineId: string, e: { chavePublica: string; plataforma: PlataformaMaquina; servidorProprio?: boolean }): void;
  /** As instaladoras vivas da pessoa, a mais recente primeiro. */
  instaladoras(escopo: Escopo): Instaladora[];
  /**
   * `instaladora_antiga` (NOD-344, revisão do PR #579): o nod sem NOD_URL_PUBLICA manda `servidor: null`, e a instaladora
   * de antes da NOD-344 não sabe usar a própria origem (falharia em `instalacao_falhou` lá no meio).
   */
  pedir(e: NovoPedido): InstalacaoCriadaDto | "sem_instaladora" | "muitos_pedidos" | "apelido_so_no_mac" | "instaladora_antiga";
  ver(escopo: Escopo, id: string): InstalacaoSshDto | null;
  /** A credencial cifrada da tela; entregue à instaladora uma vez. */
  entregarCredencial(escopo: Escopo, id: string, cifrado: CodigoCifrado): "ok" | "sem_pedido" | "nao_pede";
  /** Os pedidos desta instaladora: o novo (com o cifrado, uma vez) e o cancelamento (uma vez). */
  pendentes(escopo: Escopo, machineId: string): PedidoDeInstalacao[];
  progresso(escopo: Escopo, machineId: string, p: ProgressoDeInstalacao): { aceito: boolean; pedido: InstalacaoSshDto | null };
  /**
   * A máquina nova pareou com o convite do pedido: ele fica `pronta`. Devolve o que a composição grava em `maquinas_ssh`
   * (sem impressão = nada a gravar); null = o convite não é de pedido nenhum desta pessoa.
   */
  pareada(escopo: Escopo, convite: string, maquinaId: string): { id: string; host: string; porta: number; usuario: string; impressao: string | null } | null;
  /** "Confiar na nova": o pedido volta a `esperando` com a impressão nova (e pede a credencial de novo). */
  confiarNova(escopo: Escopo, id: string): { host: string; porta: number; impressao: string } | null;
  /**
   * O convite do pedido cancelado (para a composição revogá-lo); null = não é dela ou já acabou. O erro que espera o
   * "Confiar na nova" ainda se cancela (o convite dele segue vivo até aqui).
   */
  cancelar(escopo: Escopo, id: string): string | null;
}

export type DepsInstalacoesPorSsh = {
  /**
   * NOD-344: o pedido que deu erro (ou expirou) mata o convite dele — o script pode seguir rodando lá e parear uma
   * máquina que a tela já mostrou como falha. Idempotente. Exceção: `chave_do_servidor_mudou` com as duas impressões
   * espera o "Confiar na nova", que reusa o mesmo convite; ele morre no cancelar ou no prazo.
   */
  revogarConvite?(convite: string): void;
};

export function criarInstalacoesPorSsh(agora: () => number = Date.now, deps: DepsInstalacoesPorSsh = {}): InstalacoesPorSsh {
  const pedidos = new Map<string, Pedido>();
  const instaladoras = new Map<string, Instaladora & { escopo: Escopo; chavePublica: string; servidorProprio: boolean }>();
  const daPessoa = (a: Escopo, b: Escopo) => a.tenantId === b.tenantId && a.pessoaId === b.pessoaId;
  const chaveInstaladora = (escopo: Escopo, machineId: string) => `${escopo.tenantId}:${escopo.pessoaId}:${machineId}`;
  const final = (e: EstadoInstalacao) => ESTADOS_INSTALACAO_FINAIS.includes(e);
  const mudar = (p: Pedido, m: Partial<Pedido>) => Object.assign(p, m, { atualizadoEm: agora() });
  /** O erro que a tela resolve com "Confiar na nova" (o mesmo convite volta a valer). */
  const esperaConfianca = (p: Pedido) => p.estado === "erro" && p.motivo === "chave_do_servidor_mudou" && p.impressoes !== null;
  const revogar = (p: Pedido) => {
    if (p.conviteRevogado) return;
    p.conviteRevogado = true;
    deps.revogarConvite?.(p.convite);
  };
  const falhar = (p: Pedido, motivo: MotivoInstalacao) => { mudar(p, { estado: "erro", motivo, cifrado: null }); revogar(p); };
  const varrer = () => {
    const t = agora();
    for (const [id, p] of pedidos) {
      if (!final(p.estado) && p.ate <= t) falhar(p, p.estado === "pareando" ? "nao_pareou" : "tempo_esgotado");
      else if (esperaConfianca(p) && p.ate <= t) revogar(p);
      if (final(p.estado) && t - p.atualizadoEm > VISIVEL_DEPOIS_MS) {
        // Sai da memória antes do prazo esperando o "Confiar na nova": ninguém mais o cancela, então o convite morre aqui.
        if (esperaConfianca(p)) revogar(p);
        pedidos.delete(id);
      }
    }
    for (const [k, i] of instaladoras) if (t - i.vistoEm > VISIVEL_DEPOIS_MS) instaladoras.delete(k);
  };
  const doEscopo = (escopo: Escopo, id: string) => {
    varrer();
    const p = pedidos.get(id);
    return p && daPessoa(p.escopo, escopo) ? p : null;
  };
  const vivas = (escopo: Escopo) => {
    const t = agora();
    return [...instaladoras.values()].filter((i) => daPessoa(i.escopo, escopo) && t - i.vistoEm <= INSTALADORA_VIVA_MS).sort((a, b) => b.vistoEm - a.vistoEm);
  };
  const publico = (p: Pedido): InstalacaoSshDto => ({
    id: p.id, origemId: p.origemId, host: p.host, porta: p.porta, usuario: p.usuario, metodo: p.metodo,
    estado: p.estado, etapa: p.etapa, motivo: p.motivo, impressoes: p.impressoes, linhas: [...p.linhas], maquinaId: p.maquinaId,
    pedeCredencial: p.estado === "esperando" && p.metodo !== "apelido" && p.cifrado === null,
    expiraEm: p.ate, atualizadoEm: p.atualizadoEm,
  });
  return {
    anunciarInstaladora(escopo, machineId, e) {
      varrer();
      const k = chaveInstaladora(escopo, machineId);
      const antes = instaladoras.get(k);
      // A instaladora reiniciou (par novo): o cifrado que ela não usou não abre mais, e o que ela tinha em andamento morreu.
      if (antes && antes.chavePublica !== e.chavePublica) {
        for (const p of pedidos.values()) if (p.origemId === machineId && daPessoa(p.escopo, escopo) && !final(p.estado) && p.estado !== "pareando") falhar(p, "nao_pareou");
      }
      if (!antes && instaladoras.size >= MAX_INSTALADORAS) instaladoras.delete(instaladoras.keys().next().value!);
      instaladoras.set(k, { escopo, machineId, plataforma: e.plataforma, chavePublica: e.chavePublica, servidorProprio: e.servidorProprio === true, vistoEm: agora() });
    },
    instaladoras(escopo) {
      varrer();
      // Revisão do PR #579: a tela pré-seleciona a primeira; a que sabe usar a própria origem (`servidorProprio`) vem antes
      // da antiga, senão sem NOD_URL_PUBLICA o pedido levaria `instaladora_antiga` conforme quem puxou por último.
      const lista = vivas(escopo);
      return [...lista.filter((i) => i.servidorProprio), ...lista.filter((i) => !i.servidorProprio)].map(({ machineId, plataforma, vistoEm }) => ({ machineId, plataforma, vistoEm }));
    },
    pedir(e) {
      varrer();
      const abertos = [...pedidos.values()].filter((p) => daPessoa(p.escopo, e.escopo) && !final(p.estado));
      if (abertos.length >= MAX_INSTALACOES_POR_PESSOA || pedidos.size >= MAX_PEDIDOS) return "muitos_pedidos";
      const lista = vivas(e.escopo);
      // Sem origem escolhida: a primeira que dá conta do pedido (Mac no apelido; `servidorProprio` sem URL pública). Nenhuma
      // dá: a primeira, para a recusa dizer o porquê (revisão do PR #579).
      const serve = (i: (typeof lista)[number]) => (e.metodo !== "apelido" || i.plataforma === "darwin") && (e.servidor !== null || i.servidorProprio);
      const origem = e.origemId ? lista.find((i) => i.machineId === e.origemId) : (lista.find(serve) ?? lista[0]);
      if (!origem) return "sem_instaladora";
      // O apelido é do ~/.ssh/config do Mac (o agente e o chaveiro dele); num motor Linux não significa nada.
      if (e.metodo === "apelido" && origem.plataforma !== "darwin") return "apelido_so_no_mac";
      if (e.servidor === null && !origem.servidorProprio) return "instaladora_antiga";
      const t = agora();
      const p: Pedido = {
        id: randomUUID(), escopo: e.escopo, origemId: origem.machineId, chavePublica: origem.chavePublica,
        host: e.host, porta: e.porta, usuario: e.usuario, metodo: e.metodo,
        impressaoConhecida: e.impressaoConhecida, impressaoVista: null, convite: e.criarConvite(), servidor: e.servidor,
        estado: "esperando", etapa: null, motivo: null, impressoes: null, linhas: [], maquinaId: null,
        cifrado: null, entregue: false, avisarCancelamento: false, conviteRevogado: false, criadoEm: t, atualizadoEm: t, ate: t + PRAZO_INSTALACAO_MS,
      };
      pedidos.set(p.id, p);
      return { id: p.id, origemId: p.origemId, chavePublica: p.chavePublica, expiraEm: p.ate };
    },
    ver(escopo, id) {
      const p = doEscopo(escopo, id);
      return p ? publico(p) : null;
    },
    entregarCredencial(escopo, id, cifrado) {
      const p = doEscopo(escopo, id);
      if (!p) return "sem_pedido";
      if (p.estado !== "esperando" || p.metodo === "apelido" || p.cifrado !== null) return "nao_pede";
      mudar(p, { cifrado });
      return "ok";
    },
    pendentes(escopo, machineId) {
      varrer();
      const saida: PedidoDeInstalacao[] = [];
      for (const p of pedidos.values()) {
        if (!daPessoa(p.escopo, escopo) || p.origemId !== machineId) continue;
        const base = { id: p.id, host: p.host, porta: p.porta, usuario: p.usuario, metodo: p.metodo, impressaoConhecida: p.impressaoConhecida, convite: p.convite, servidor: p.servidor };
        if (p.estado === "cancelada" && p.avisarCancelamento) {
          saida.push({ ...base, cancelado: true });
          p.avisarCancelamento = false;
          continue;
        }
        if (p.estado !== "esperando" || (p.metodo !== "apelido" && p.cifrado === null)) continue;
        // Entregue uma vez: o cifrado sai do servidor na hora, e o pedido passa a ser da instaladora.
        saida.push(p.cifrado ? { ...base, cifrado: p.cifrado } : base);
        mudar(p, { estado: "conferindo", cifrado: null, entregue: true });
      }
      return saida;
    },
    progresso(escopo, machineId, pr) {
      const p = doEscopo(escopo, pr.id);
      if (!p || p.origemId !== machineId || !p.entregue) return { aceito: false, pedido: null };
      if (pr.impressao !== undefined && !impressaoValida(pr.impressao)) return { aceito: false, pedido: publico(p) };
      if (pr.etapa !== undefined && !ETAPAS_INSTALACAO.includes(pr.etapa)) return { aceito: false, pedido: publico(p) };
      if (pr.erro !== undefined && !MOTIVOS_INSTALACAO.includes(pr.erro)) return { aceito: false, pedido: publico(p) };
      // A máquina nova pode parear antes do script imprimir a última etapa: o "pronta" atrasado é aceito e não muda nada.
      if (p.estado === "pronta" && pr.etapa === "pronta" && pr.erro === undefined) return { aceito: true, pedido: publico(p) };
      if (final(p.estado) || p.estado === "esperando") return { aceito: false, pedido: publico(p) };
      if (pr.impressao) p.impressaoVista = pr.impressao;
      if (pr.linhas) p.linhas = pr.linhas.filter((l) => typeof l === "string").slice(-MAX_LINHAS).map((l) => l.slice(0, MAX_LINHA));
      if (pr.erro) {
        // A host key mudou: a tela mostra as duas impressões e oferece "Confiar na nova".
        const impressoes = pr.erro === "chave_do_servidor_mudou" && p.impressaoConhecida && pr.impressao ? { antiga: p.impressaoConhecida, nova: pr.impressao } : null;
        mudar(p, { estado: "erro", motivo: pr.erro, impressoes, cifrado: null });
        if (!esperaConfianca(p)) revogar(p);
        return { aceito: true, pedido: publico(p) };
      }
      if (pr.etapa) {
        const estado: EstadoInstalacao = pr.etapa === "conferencia" ? "conferindo" : pr.etapa === "pareamento" || pr.etapa === "pronta" ? "pareando" : "instalando";
        mudar(p, { estado, etapa: pr.etapa });
      }
      return { aceito: true, pedido: publico(p) };
    },
    pareada(escopo, convite, maquinaId) {
      varrer();
      const p = [...pedidos.values()].find((x) => x.convite === convite && daPessoa(x.escopo, escopo));
      if (!p || p.estado === "cancelada") return null;
      mudar(p, { estado: "pronta", motivo: null, maquinaId, cifrado: null, etapa: p.etapa ?? "pareamento" });
      return { id: p.id, host: p.host, porta: p.porta, usuario: p.usuario, impressao: p.impressaoVista ?? p.impressaoConhecida };
    },
    confiarNova(escopo, id) {
      const p = doEscopo(escopo, id);
      if (!p || p.estado !== "erro" || p.motivo !== "chave_do_servidor_mudou" || !p.impressoes) return null;
      // Revisão do PR #579: o convite já morreu (prazo ou cancelado): não grava a impressão nova para um pedido que não volta.
      if (p.conviteRevogado || p.ate <= agora()) return null;
      const impressao = p.impressoes.nova;
      mudar(p, { estado: "esperando", motivo: null, impressoes: null, etapa: null, linhas: [], impressaoConhecida: impressao, impressaoVista: impressao, cifrado: null, entregue: false });
      return { host: p.host, porta: p.porta, impressao };
    },
    cancelar(escopo, id) {
      const p = doEscopo(escopo, id);
      if (!p || (final(p.estado) && !esperaConfianca(p))) return null;
      mudar(p, { estado: "cancelada", cifrado: null, avisarCancelamento: p.entregue && !final(p.estado) });
      revogar(p);
      return p.convite;
    },
  };
}
