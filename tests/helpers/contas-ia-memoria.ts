import { CONTAS_DA_PESSOA_MAX } from "../../src/contracts/contas-ia.ts";
import { randomUUID } from "node:crypto";
import type { ContaAnunciada, IaComConta, ModoDasContas } from "../../src/contracts/contas-ia.ts";
import { apelidoPadrao, decidirAnuncio, vinculoSegueSemAcesso, type VinculoDaConta } from "../../src/domain/contas-da-pessoa.ts";
import type { ContaGuardadaNoServidor, ResultadoDoAnuncio, contasIaRepo } from "../../src/repositories/contas-ia.repo.ts";
import type { Escopo } from "../../src/shared/types.ts";

type Dono = { tenantId: string; ownerId: string };
export type EstadoContasIaMemoria = {
  contas: (ContaGuardadaNoServidor & Dono)[];
  vinculos: (VinculoDaConta & Dono & { semAcessoEm?: number | null })[];
  modos: Map<string, { modo: ModoDasContas; escolhidas: Partial<Record<IaComConta, string>> }>;
};

export const estadoContasIaMemoria = (): EstadoContasIaMemoria => ({ contas: [], vinculos: [], modos: new Map() });

/** O repositório de contas (0074) em memória: o comportamento completo se prova no Postgres (contas-ia.repo.test.ts). */
export function contasIaMemoria(e: EstadoContasIaMemoria, escopo: Escopo): ReturnType<typeof contasIaRepo> {
  const minhas = () => e.contas.filter((c) => c.tenantId === escopo.tenantId && c.ownerId === escopo.pessoaId);
  const meusVinculos = () => e.vinculos.filter((v) => v.tenantId === escopo.tenantId && v.ownerId === escopo.pessoaId);
  const sem = <T extends Dono>(x: T): Omit<T, keyof Dono> => { const { tenantId: _t, ownerId: _o, ...resto } = x; return resto; };
  const chaveModo = `${escopo.tenantId}:${escopo.pessoaId}`;
  const proximaPosicao = () => Math.max(0, ...minhas().filter((c) => c.removidaEm === null).map((c) => c.posicao)) + 1;
  const dono = { tenantId: escopo.tenantId, ownerId: escopo.pessoaId };
  return {
    async travar() {},
    async temContaNaMaquina(maquinaId: string) { return meusVinculos().some((v) => v.maquinaId === maquinaId && v.estado === "pronta" && v.sairPedidoEm === null); },
    async listar() {
      return { contas: [...minhas()].sort((a, b) => a.posicao - b.posicao).map((c) => sem(c) as ContaGuardadaNoServidor), vinculos: meusVinculos().map((v) => sem(v) as VinculoDaConta) };
    },
    async buscar(id) { const c = minhas().find((x) => x.id === id); return c ? (sem(c) as ContaGuardadaNoServidor) : null; },
    // NOD-293 C11: os turnos não vivem na memória; a rota real é coberta em tests/integration/contas-ia-frentes-ativas.test.ts.
    async frentesAtivas() { return []; },
    async doAnuncio(maquinaId: string, anunciadas: readonly ContaAnunciada[], agora: number): Promise<ResultadoDoAnuncio> {
      const sair: string[] = [];
      const vistas: string[] = [];
      const prontasAgora: ResultadoDoAnuncio["prontasAgora"] = [];
      let mudou = false;
      for (const a of anunciadas) {
        const existente = minhas().find((c) => c.ia === a.ia && c.impressao === a.impressao) ?? null;
        const decisao = decidirAnuncio(existente, a.logadaEm);
        if ((decisao === "criar" || decisao === "voltar") && minhas().filter((c) => c.removidaEm === null).length >= CONTAS_DA_PESSOA_MAX) continue;
        let conta = existente;
        if (decisao === "criar") {
          const posicao = proximaPosicao();
          // ADR-108 + NOD-308: como o repositório, só a 1ª conta de cada IA nasce na fila (corporativa ou não).
          const naFila = !minhas().some((c) => c.ia === a.ia && c.removidaEm === null);
          conta = { ...dono, id: randomUUID(), ia: a.ia, impressao: a.impressao, apelido: a.apelidoSugerido ?? apelidoPadrao(posicao), plano: a.plano, corporativa: a.corporativa, posicao, entraNaTrocaAutomatica: naFila, noLimiteAte: null, removidaEm: null, email: a.email ?? null, organizacao: a.organizacao ?? null };
          e.contas.push(conta);
          mudou = true;
        } else if (decisao === "voltar") {
          // Revisão do PR 2 (C4): volta com a regra de nascimento, não com a marca antiga.
          const naFila = !minhas().some((c) => c.ia === a.ia && c.removidaEm === null);
          Object.assign(conta!, { removidaEm: null, noLimiteAte: null, posicao: proximaPosicao(), plano: a.plano ?? conta!.plano, corporativa: a.corporativa, entraNaTrocaAutomatica: naFila });
          mudou = true;
        } else if (decisao === "atualizar" && a.plano !== null && (a.plano !== conta!.plano || a.corporativa !== conta!.corporativa)) {
          Object.assign(conta!, { plano: a.plano, corporativa: a.corporativa });
          mudou = true;
        }
        // ADR-105: como o repositório, ausente não apaga.
        if (conta && decisao !== "sair" && decisao !== "criar" && ((a.email !== undefined && a.email !== conta.email) || (a.organizacao !== undefined && a.organizacao !== conta.organizacao))) {
          Object.assign(conta, { email: a.email ?? conta.email, organizacao: a.organizacao ?? conta.organizacao });
          mudou = true;
        }
        const v = meusVinculos().find((x) => x.contaId === conta!.id && x.maquinaId === maquinaId);
        if (decisao === "sair") sair.push(a.impressao);
        if (decisao !== "sair" && a.estado === "pronta" && v?.estado !== "pronta") prontasAgora.push({ contaId: conta!.id, ia: a.ia, corporativa: a.corporativa, entraNaTrocaAutomatica: conta!.entraNaTrocaAutomatica });
        if (v) {
          const estado = vinculoSegueSemAcesso(v.semAcessoEm ?? null, a.estado, a.logadaEm) ? "sem_acesso" : a.estado;
          if (v.estado !== estado) mudou = true;
          v.estado = estado;
          v.semAcessoEm = estado === "sem_acesso" ? (v.semAcessoEm ?? agora) : null;
          if (decisao === "sair") v.sairPedidoEm ??= agora;
        } else {
          e.vinculos.push({ ...dono, contaId: conta!.id, maquinaId, estado: a.estado, sairPedidoEm: decisao === "sair" ? agora : null });
          mudou = true;
        }
        vistas.push(conta!.id);
      }
      const antes = e.vinculos.length;
      e.vinculos = e.vinculos.filter((v) => !(v.tenantId === escopo.tenantId && v.ownerId === escopo.pessoaId && v.maquinaId === maquinaId && !vistas.includes(v.contaId)));
      if (e.vinculos.length !== antes) mudou = true;
      return { sair, mudou, prontasAgora };
    },
    async renomear(id, apelido) { const c = minhas().find((x) => x.id === id && x.removidaEm === null); if (!c) return false; c.apelido = apelido; return true; },
    async definirTrocaAutomatica(id, entra) { const c = minhas().find((x) => x.id === id && x.removidaEm === null); if (!c) return false; c.entraNaTrocaAutomatica = entra; return true; },
    async reordenar(ids) {
      const atuais = minhas().filter((c) => c.removidaEm === null);
      if (ids.length !== atuais.length || new Set(ids).size !== ids.length || ids.some((id) => !atuais.some((c) => c.id === id))) return false;
      ids.forEach((id, i) => { atuais.find((c) => c.id === id)!.posicao = i + 1; });
      return true;
    },
    async marcarLimite(id, ate) { const c = minhas().find((x) => x.id === id); if (c) c.noLimiteAte = ate; },
    async limparLimite(id) { const c = minhas().find((x) => x.id === id && x.noLimiteAte !== null); if (!c) return false; c.noLimiteAte = null; return true; },
    async pedirSaida(id, maquinaId, agora) { const v = meusVinculos().find((x) => x.contaId === id && x.maquinaId === maquinaId); if (!v) return false; v.sairPedidoEm ??= agora; return true; },
    async remover(id, agora) {
      const c = minhas().find((x) => x.id === id && x.removidaEm === null);
      if (!c) return false;
      c.removidaEm = agora;
      c.noLimiteAte = null;
      for (const v of meusVinculos().filter((x) => x.contaId === id)) v.sairPedidoEm ??= agora;
      return true;
    },
    async pedirSaidaDeTodas(maquinaId, agora) { const vs = meusVinculos().filter((x) => x.maquinaId === maquinaId); for (const v of vs) v.sairPedidoEm ??= agora; return vs.length; },
    async saidasPendentes(maquinaId) {
      return meusVinculos().filter((v) => v.maquinaId === maquinaId && v.sairPedidoEm !== null).map((v) => minhas().find((c) => c.id === v.contaId)?.impressao).filter((x): x is string => !!x);
    },
    async saiu(maquinaId, impressoes) {
      const ids = minhas().filter((c) => impressoes.includes(c.impressao)).map((c) => c.id);
      const antes = e.vinculos.length;
      e.vinculos = e.vinculos.filter((v) => !(v.tenantId === escopo.tenantId && v.ownerId === escopo.pessoaId && v.maquinaId === maquinaId && ids.includes(v.contaId)));
      return antes - e.vinculos.length;
    },
    async marcarSemAcesso(id, maquinaId, agora) {
      const v = meusVinculos().find((x) => x.contaId === id && x.maquinaId === maquinaId);
      if (!v) return false;
      v.estado = "sem_acesso";
      v.semAcessoEm ??= agora;
      return true;
    },
    async apagarVinculo(id, maquinaId) { e.vinculos = e.vinculos.filter((v) => !(v.tenantId === escopo.tenantId && v.ownerId === escopo.pessoaId && v.contaId === id && v.maquinaId === maquinaId)); },
    async modo() { return e.modos.get(chaveModo) ?? { modo: "perguntar", escolhidas: {} }; },
    async definirModo(modo) { const atual = e.modos.get(chaveModo) ?? { modo: "perguntar", escolhidas: {} }; e.modos.set(chaveModo, { ...atual, modo }); },
    async definirEscolhida(ia, id) {
      const atual = e.modos.get(chaveModo) ?? { modo: "perguntar" as const, escolhidas: {} };
      const escolhidas = { ...atual.escolhidas };
      if (id === null) delete escolhidas[ia]; else escolhidas[ia] = id;
      e.modos.set(chaveModo, { ...atual, escolhidas });
    },
  };
}
