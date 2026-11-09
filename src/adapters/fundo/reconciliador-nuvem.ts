import { randomUUID } from "node:crypto";
import type { MotivoFalhaNuvem, ProvedorNuvem } from "../../contracts/provedor-nuvem.ts";
import {
  aposFalha,
  ErroNuvemLancado,
  ErroNuvemTransitorio,
  type MotivoParaFicarAcordada,
  nenhumMotivoParaFicarAcordada,
  NOVA_TENTATIVA_MS,
  proximoPasso,
  scriptDeGuarda,
  scriptDeInicio,
} from "../../domain/maquina-nuvem.ts";
import { log } from "../../obs/log.ts";
import { criarRepos } from "../../repositories/index.ts";
import type { ParaReconciliar } from "../../repositories/maquinas-nuvem.repo.ts";
import type { Db, Escopo, Transacao } from "../../shared/types.ts";
import { paraCadaPessoa, type OpcoesLaco } from "./escopos-de-fundo.ts";

/** definido em 2026-10-22 (ADR-121): uma volta a cada 15 s — o gatilho de acordar espera no máximo isso para sair. */
export const INTERVALO_RECONCILIADOR_NUVEM_MS = 15_000;
/** Turno sem alvo: outra máquina que falou há menos que isto pode pegá-lo; não acorda a da nuvem. */
export const CONTATO_RECENTE_MS = 2 * 60_000;

/** Monta o provedor com a credencial (cifrada) da pessoa. Lança `ErroNuvemLancado` (credencial_nuvem) se não há chave. */
export type ProvedorDa = (escopo: Escopo, tx: Transacao, credencialId: string) => Promise<ProvedorNuvem>;

export type DepsReconciliador = {
  db: Db;
  provedorDa: ProvedorDa;
  agora?: () => number;
  motivoParaFicarAcordada?: MotivoParaFicarAcordada;
  /** PR 2 (criar a VM): sem isto, a linha `criando` espera (o `compor.ts` liga com NOD_URL_PUBLICA). */
  criacao?: Criacao;
  opcoes?: OpcoesLaco;
};

/** O que criar a VM precisa de fora: o endereço público do servidor, decifrar o convite e registrá-lo no pareamento. */
export type Criacao = {
  servidor: string;
  decifrar: (cifrado: string) => string;
  registrarConvite: (convite: string, e: { escopo: Escopo; nome: string; maquinaNuvemId: string; ate: number }) => void;
};

/** O que uma volta de UMA pessoa precisa (sem o banco: a transação vem de fora). */
export type DepsPessoa = Omit<DepsReconciliador, "db" | "opcoes">;

/** O que a operação lançou: motivo fechado do provedor, ou transitório (rede, 5xx e qualquer erro não classificado). */
function motivoDoErro(e: unknown): { motivo: MotivoFalhaNuvem; detalhe: string | null } | "transitorio" {
  return e instanceof ErroNuvemLancado ? { motivo: e.motivo, detalhe: e.detalhe } : "transitorio";
}

/**
 * Executa UMA operação já reservada, FORA da transação (a chamada ao Google leva segundos; ADR-121). Decide o passo no
 * domínio, chama o provedor e grava o resultado só com a reserva (`operacao_id`). Erro transitório: solta a reserva e a
 * próxima volta tenta de novo. Erro com motivo: `aposFalha` diz para onde a máquina vai.
 */
async function executar(d: DepsPessoa, escopo: Escopo, tx: Transacao, m: ParaReconciliar, operacaoId: string, agora: number): Promise<void> {
  const gravar = (campos: Parameters<ReturnType<typeof criarRepos>["maquinasNuvem"]["concluir"]>[3]) =>
    tx((trx) => criarRepos(trx, escopo).maquinasNuvem.concluir(m.id, operacaoId, agora, campos));
  const soltar = () => tx((trx) => criarRepos(trx, escopo).maquinasNuvem.soltar(m.id, operacaoId));
  try {
    const provedor = await d.provedorDa(escopo, tx, m.credencialId);
    let passo = proximoPasso(m.situacao, null, agora);
    if (passo.passo === "consultar") passo = proximoPasso(m.situacao, await provedor.estado(m.ref), agora);
    switch (passo.passo) {
      case "nada":
      case "consultar":
        await soltar();
        return;
      case "marcar":
        await gravar({
          estado: passo.estado,
          motivo: passo.motivo ?? null,
          ...(passo.estado === "dormindo" ? { ligouEm: null, reiniciouEm: null, proximaTentativaEm: null } : {}),
          ...(passo.estado === "acordada" ? { reiniciouEm: null, proximaTentativaEm: null } : {}),
        });
        return;
      case "ligar":
        await provedor.ligar(m.ref);
        await gravar({ estado: "acordando", motivo: null, ligouEm: agora, proximaTentativaEm: null });
        return;
      case "desligar":
        // Fica `adormecendo`: a próxima volta vê `parada` e marca `dormindo`.
        await provedor.desligar(m.ref);
        await soltar();
        return;
      case "reiniciar":
        await provedor.reiniciar(m.ref);
        await gravar({ reiniciouEm: agora });
        return;
      case "criar": {
        const dados = d.criacao ? await tx((trx) => criarRepos(trx, escopo).maquinasNuvem.dadosDaCriacao(m.id)) : null;
        if (!d.criacao || !dados) { await soltar(); return; }
        const convite = d.criacao.decifrar(dados.conviteCifrado);
        const startupScript = scriptDeInicio({ servidor: d.criacao.servidor, convite, expiraEm: dados.conviteExpiraEm });
        await provedor.criar({ ...m.ref, subrede: dados.subrede, tamanho: dados.tamanho, startupScript, maquinaNuvemId: m.id }, dados.requestId);
        // Fica `criando`: `ligou_em` marca a criação; o motor pareia com o convite e a próxima volta vê o contato.
        if (await gravar({ ligouEm: agora, motivo: null, proximaTentativaEm: null })) return;
        // NOD-92 (revisão B4): perdemos a reserva no meio da criação. Se a pessoa excluiu a linha nesse meio-tempo, a VM
        // que acabou de nascer não tem dono no nod: apaga no Google (404 = nem chegou a existir).
        const agoraLinha = await tx((trx) => criarRepos(trx, escopo).maquinasNuvem.buscar(m.id));
        if (agoraLinha?.estado === "excluida") {
          try {
            await provedor.excluir(m.ref);
            log("info", "nuvem_criada_apos_excluir_apagada", { maquina_nuvem_id: m.id });
          } catch (e) {
            // Revisão NOD-92 (rodada 2, item 3): a VM ficaria órfã cobrando. A exclusão fica pendente na linha e a próxima
            // volta repete (`resourceNotReady` logo depois do insert é o caso comum).
            await tx((trx) => criarRepos(trx, escopo).maquinasNuvem.marcarExclusaoPendente(m.id, agora));
            log("aviso", "nuvem_criada_apos_excluir_pendente", { maquina_nuvem_id: m.id, erro: e instanceof ErroNuvemLancado ? e.motivo : "transitorio" });
          }
        }
        return;
      }
      case "excluir":
        // A exclusão pendente da VM que nasceu depois do DELETE (o provedor trata 404 como já apagada).
        try {
          await provedor.excluir(m.ref);
        } catch (e) {
          // Transitório: a próxima volta repete. Com motivo (credencial, cota): espera NOVA_TENTATIVA_MS para não martelar.
          const lancado = e instanceof ErroNuvemLancado;
          await gravar({ proximaTentativaEm: lancado ? agora + NOVA_TENTATIVA_MS : agora });
          log("aviso", "nuvem_exclusao_pendente_falhou", { maquina_nuvem_id: m.id, erro: lancado ? e.motivo : "transitorio" });
          return;
        }
        await gravar({ proximaTentativaEm: null });
        log("info", "nuvem_criada_apos_excluir_apagada", { maquina_nuvem_id: m.id });
        return;
      case "finalizar":
        // O convite sai da metadata da VM antes de sair do banco: o script vira só a guarda.
        await provedor.definirScript(m.ref, scriptDeGuarda());
        await tx((trx) => criarRepos(trx, escopo).maquinasNuvem.confirmarCriada(m.id, operacaoId, agora));
        return;
    }
  } catch (e) {
    const c = motivoDoErro(e);
    if (c === "transitorio") {
      if (!(e instanceof ErroNuvemTransitorio)) log("aviso", "nuvem_operacao_erro_inesperado", { maquina_nuvem_id: m.id, erro: e instanceof Error ? e.name : "desconhecido" });
      await soltar();
      return;
    }
    if (m.estado === "excluida") {
      // Revisão NOD-92 (delta da rodada 2): na exclusão pendente, o provedor que não monta (credencial sem chave ou
      // recusada) não pode passar pelo `aposFalha` — a linha excluída viraria `falhou_ao_acordar` e voltaria à tela.
      // Segue excluída e pendente: tenta de novo em NOVA_TENTATIVA_MS.
      log("aviso", "nuvem_exclusao_pendente_falhou", { maquina_nuvem_id: m.id, erro: c.motivo });
      await gravar({ proximaTentativaEm: agora + NOVA_TENTATIVA_MS });
      return;
    }
    const f = aposFalha(m.estado, c.motivo, agora, m.estadoDesde);
    log("aviso", "nuvem_operacao_falhou", { tenant_id: escopo.tenantId, pessoa_id: escopo.pessoaId, maquina_nuvem_id: m.id, motivo: c.motivo, ...(c.detalhe ? { detalhe: c.detalhe } : {}) });
    await gravar({ estado: f.estado, motivo: f.motivo, proximaTentativaEm: f.proximaTentativaEm, ...(f.estado === "acordada" ? { desejado: "acordada" as const } : {}) });
  }
}

/**
 * Uma volta para UMA pessoa: (1) numa transação curta, os gatilhos pedem acordar, as ociosas tentam dormir (sob a trava
 * da pessoa) e as máquinas com trabalho são reservadas; (2) depois do commit, cada operação reservada roda fora da
 * transação e grava o resultado na sua própria.
 */
export async function reconciliarPessoa(d: DepsPessoa, escopo: Escopo, tx: Transacao): Promise<number> {
  const agora = (d.agora ?? Date.now)();
  const motivo = d.motivoParaFicarAcordada ?? nenhumMotivoParaFicarAcordada;
  await tx(async (trx) => {
    const repo = criarRepos(trx, escopo).maquinasNuvem;
    await repo.acordarSePreciso(agora, CONTATO_RECENTE_MS);
    await repo.marcarAtividade(agora);
    for (const o of await repo.ociosasParaDormir(agora)) {
      if (motivo(o.maquinaId)) continue;
      await repo.tentarDormir(o.id, agora);
    }
  });
  if (d.criacao) {
    const criacao = d.criacao;
    // Os convites das VMs em criação voltam ao pareamento (em memória) a cada volta: um reinício do servidor não os perde.
    const convites = await tx((trx) => criarRepos(trx, escopo).maquinasNuvem.convitesAtivos(agora));
    for (const c of convites) {
      try {
        criacao.registrarConvite(criacao.decifrar(c.conviteCifrado), { escopo, nome: c.nome, maquinaNuvemId: c.id, ate: c.expiraEm });
      } catch (e) {
        log("aviso", "nuvem_convite_ilegivel", { maquina_nuvem_id: c.id, erro: e instanceof Error ? e.name : "desconhecido" });
      }
    }
  }
  const reservadas = await tx(async (trx) => {
    const repo = criarRepos(trx, escopo).maquinasNuvem;
    const lista: { m: ParaReconciliar; operacaoId: string }[] = [];
    for (const m of await repo.paraReconciliar(agora)) {
      const operacaoId = randomUUID();
      if (await repo.reservar(m.id, operacaoId, agora)) lista.push({ m, operacaoId });
    }
    return lista;
  });
  for (const r of reservadas) await executar(d, escopo, tx, r.m, r.operacaoId, agora);
  return reservadas.length;
}

export async function reconciliarNuvem(d: DepsReconciliador): Promise<number> {
  let total = 0;
  await paraCadaPessoa(d.db, async (escopo, tx) => { total += await reconciliarPessoa(d, escopo, tx); }, d.opcoes);
  return total;
}

/** ADR-121: sobe só com NOD_MAQUINA_NUVEM=gcp (quem decide é o compor.ts). */
export function iniciarReconciliadorNuvem(d: DepsReconciliador & { intervaloMs?: number }): { parar(): void } {
  let rodando = false;
  const tick = async () => {
    if (rodando) return;
    rodando = true;
    try {
      await reconciliarNuvem(d);
    } catch (e) {
      log("erro", "reconciliador_nuvem_falhou", { erro: e instanceof Error ? e.name : "desconhecido" });
    } finally {
      rodando = false;
    }
  };
  const timer = setInterval(() => void tick(), d.intervaloMs ?? INTERVALO_RECONCILIADOR_NUVEM_MS);
  timer.unref?.();
  return { parar: () => clearInterval(timer) };
}
