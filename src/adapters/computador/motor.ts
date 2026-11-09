import { randomUUID } from "node:crypto";
import type { AcaoComputador, AmbienteComputador, DriverComputador, LugarDoComputador, ProgressoDaTroca, ResultadoComputador } from "../../contracts/computador.ts";
import type { ComandoComputador, ResultadoComandoComputador, TipoComandoComputador } from "../../contracts/computador-motor.ts";
import type { SessaoVivo } from "../../contracts/computador-vivo.ts";
import type { UsoDoMac } from "../../contracts/raio-x.ts";
import type { VmLocalAnunciada } from "../../contracts/vm-local.ts";
import { escolherMaquina, type MaquinaCandidata, motivoParaFicarAcordada, opcoesDeLugar, PRAZO_COMANDO_MS, TETO_PRONTO_MS, TETO_PRONTO_VM_LOCAL_MS } from "../../domain/computador-canal.ts";
import type { PapelMaquina } from "../../contracts/maquina.ts";
import { ehFalhaComputador, EsperandoTela, FalhaComputador } from "../../domain/computador.ts";
import { log } from "../../obs/log.ts";
import type { Escopo } from "../../shared/types.ts";
import type { CanalComputador } from "./canal.ts";
import { assinarComando, publicaDeAssinatura, seloDoIniciar } from "./selo.ts";
import { versaoAceita } from "../../domain/versao-app.ts";

/**
 * O driver "motor" do computador (definido em 2026-10-22, NOD-96 PR 3, ADR-122): o computador da pessoa roda numa
 * máquina dela, pelo motor, e este driver só põe comandos assinados na fila da conexão certa (canal.ts) e espera a
 * resposta. O portão continua em fundo/computadores.ts (aprovação, política, saúde); o despachante é
 * `escolherMaquina` (domínio). Só com `NOD_COMPUTADORES=motor` (compor.ts).
 *
 * O `iniciar` liga a máquina do computador uma vez (as chamadas juntas esperam o mesmo pedido: a ação no meio do boot
 * espera, não falha) e tem teto de 60 s, contado depois de acordar a máquina (NOD-92). Máquina sem contato falha NA HORA.
 */

/** O computador como o driver precisa dele (o id vem do portão; o resto do banco, sem RLS de quem chama). */
export type ComputadorLocalizado = {
  escopo: Escopo;
  /**
   * O computador no supervisor (o da pessoa, `por_pessoa`), quando o portão fala de outro id (o do bot). Ausente = o
   * próprio id. Vai nos comandos, no selo e no TOFU; a tela é o `agenteId`.
   */
  computadorId?: string;
  /** A tela: o bot dono do computador (por bot) ou do pedido. Nulo = o computador inteiro. */
  agenteId: string | null;
  maquinaId: string | null;
  hospedeiraId: string | null;
  supervisorPub: string | null;
  /** NOD-365: máquinas de onde o computador saiu sem receber `marcar_saida` (compatível com localizadores antigos). */
  saidasPendentesDe?: string[];
  padraoId: string | null;
  uso: UsoDoMac;
};
/** `vmLocal`: o preparo da VM local que o Mac anuncia (NOD-93); ausente nas Linux e no app antigo. */
export type MaquinaDaPessoa = MaquinaCandidata & { nome: string; vmLocal?: VmLocalAnunciada; papel?: PapelMaquina; versaoApp?: string };
/** NOD-365: onde o computador mora no banco (maquina_id, hospedeira_id e a X25519 fixada). */
export type LugarGravado = { maquinaId: string | null; hospedeiraId: string | null; supervisorPub: string | null; saidasPendentesDe: string[] };
/** NOD-365: o pacote vazio da loja (versão 1, sem arquivos): a troca sem os logins zera a loja que o destino tivesse. */
export const PACOTE_VAZIO = Buffer.from(JSON.stringify({ versao: 1, arquivos: [] })).toString("base64");

export type OpcoesDriverMotor = {
  env: Record<string, string | undefined>;
  canal: CanalComputador;
  /** O escopo vem do portão (fundo/computadores.ts); sem ele, o computador não é localizado (RLS). */
  localizar(id: string, escopo: Escopo | undefined): Promise<ComputadorLocalizado | null>;
  /** As máquinas conectadas (contato < 60 s) da pessoa, com o anúncio do computador (ponte.ts). */
  maquinas(escopo: Escopo): MaquinaDaPessoa[];
  /** O nome da máquina pela chave, mesmo desconectada (maquina_tokens), para "<máquina> está sem contato". */
  nomeDaMaquina(escopo: Escopo, maquinaId: string): Promise<string | null>;
  fixarHospedeira(escopo: Escopo, id: string, maquinaId: string): Promise<void>;
  /** TOFU (ADR-122): a primeira X25519 fica; outra é recusada até o Redefinir. */
  fixarSupervisor(escopo: Escopo, id: string, pub: string): Promise<"gravada" | "igual" | "diferente" | null>;
  /** Gancho da NOD-92: acorda a máquina gerenciada que dorme; true = acordou (o teto de 60 s começa aí). */
  acordarSePreciso?(escopo: Escopo, maquinaId: string): Promise<boolean>;
  /** NOD-365: o último contato da máquina, mesmo desconectada (ponte), para "sem contato desde HH:MM". */
  ultimoContato?(maquinaId: string): number | null;
  /**
   * NOD-365: a chave da máquina, mesmo desconectada: papel e plataforma (a seção não inventa o tipo da atual sem contato)
   * e o último uso gravado (o "desde HH:MM" depois que a ponte esquece a conexão).
   */
  maquinaGravada?(escopo: Escopo, maquinaId: string): Promise<{ nome: string; plataforma: MaquinaCandidata["plataforma"] | null; papel: PapelMaquina; ultimoUsoEm: number | null } | null>;
  /** NOD-365: aponta o computador para outra máquina (maquina_id, hospedeira_id e a X25519 fixada, de uma vez). */
  fixarLugar?(escopo: Escopo, id: string, lugar: LugarGravado): Promise<void>;
  adicionarSaidaPendente?(escopo: Escopo, id: string, maquinaId: string): Promise<void>;
  /** NOD-365: a máquina antiga recebeu o `marcar_saida` (limpa a saída pendente dela). */
  saidaMarcada?(escopo: Escopo, id: string, maquinaId: string): Promise<void>;
  agora?: () => number;
  dormir?: (ms: number) => Promise<void>;
  novoId?: () => string;
};

/** definido em 2026-10-22: a ação tem 90 s para voltar (o `docker exec` tinha 70 s; aqui soma a ida e a volta pela ponte). */
export const PRAZO_RESPOSTA_ACAO_MS = 90_000;
/** definido em 2026-10-22: o `parar` não segura quem chamou; sem resposta em 30 s, segue (a ociosidade da máquina desliga). */
const PRAZO_RESPOSTA_PARAR_MS = 30_000;
/** Os comandos que falam de uma tela (o `agenteId` vai junto); os outros são do computador inteiro. */
const TIPOS_DA_TELA = new Set<TipoComandoComputador>(["abrir_tela", "acao", "fechar_tela", "apagar_perfil", "vivo"]);
/** A cada quanto o driver confere se a máquina ainda tem contato enquanto espera. */
const PASSO_MS = 250;
/** NOD-93: o intervalo entre os `iniciar` enquanto o Mac responde esperando_tela (preparo da VM local). */
const PASSO_ESPERANDO_MS = 1_000;
/**
 * definido em 2026-10-22 (NOD-96 PR 5): Atualizar, Redefinir e Sair de todos esperam até 10 min pela resposta (fechar
 * as telas e apagar perfis demora). O comando continua valendo 2 min para sair da fila; só a espera é longa.
 */
export const PRAZO_RESPOSTA_OPERACAO_MS = 10 * 60_000;
/** definido em 2026-10-28 (NOD-365): cada parte da loja de logins tem 2 min para ir e voltar (~512 KiB pela ponte). */
export const PRAZO_RESPOSTA_PARTE_MS = 2 * 60_000;
/**
 * NOD-407: piso próprio do protocolo do computador (o restante do app segue no piso geral da ponte). Vem de
 * `NOD_COMPUTADOR_VERSAO_MINIMA` e fica desligado sem ela (ou com valor fora de x.y.z[-rc.N]): processo-de-release.md
 * só deixa subir o piso depois de a release correspondente estar publicada e validada.
 */
export function pisoDoComputador(env: Record<string, string | undefined>): string | null {
  const v = env.NOD_COMPUTADOR_VERSAO_MINIMA?.trim();
  if (!v) return null;
  if (versaoAceita(v, "0.0.0")) return v;
  // Valor que não é semver (ex.: "v1.0.0") desliga o piso, mas não em silêncio.
  log("aviso", "computador_versao_minima_invalida", { valor: v.slice(0, 40) });
  return null;
}

export function criarDriverMotor(o: OpcoesDriverMotor): DriverComputador & { motivoParaFicarAcordada(maquinaId: string): boolean } {
  const agora = o.agora ?? Date.now;
  const pisoApp = pisoDoComputador(o.env);
  /** A versão abaixo do piso ligado; sem piso ou sem versão anunciada, nada a pedir. */
  const abaixoDoPiso = (m: MaquinaDaPessoa): boolean => pisoApp !== null && m.versaoApp !== undefined && !versaoAceita(m.versaoApp, pisoApp);
  const dormir = o.dormir ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const novoId = o.novoId ?? randomUUID;
  let ultimaEpocaTroca = 0;
  const novaEpocaTroca = () => (ultimaEpocaTroca = Math.max(ultimaEpocaTroca + 1, agora()));
  const credencial = o.env.NOD_CREDENTIAL_KEY ?? "";
  const credencialOk = /^[a-f0-9]{64}$/i.test(credencial);
  const iniciando = new Map<string, Promise<void>>();
  // NOD-365: o computador no meio da troca; o ligar dela não entrega a saída pendente (a própria troca marca a origem).
  const trocando = new Set<string>();
  /** NOD-365: os `marcar_saida` pendentes em curso (computador:máquina), para o `ligar` seguido não mandar dois. */
  const marcando = new Set<string>();
  /** A última ação por máquina, para o gancho da NOD-92. */
  const ultimaAcao = new Map<string, number>();
  /**
   * Os ids do portão de cada computador do supervisor, com a tela de cada um, para o `ligados` falar a língua do portão
   * (NOD-170). No modo por pessoa (NOD-96 PR 4) o id do portão é o da tela: conta como ligado só com a tela aberta.
   */
  const idsDoPortao = new Map<string, Map<string, string | null>>();
  async function acharLoc(id: string, escopo: Escopo | undefined): Promise<ComputadorLocalizado | null> {
    const loc = await o.localizar(id, escopo);
    if (loc?.computadorId && loc.computadorId !== id) {
      const ids = idsDoPortao.get(loc.computadorId) ?? new Map<string, string | null>();
      ids.set(id, loc.agenteId);
      idsDoPortao.set(loc.computadorId, ids);
    }
    return loc;
  }

  async function localizar(id: string, escopo: Escopo | undefined): Promise<ComputadorLocalizado> {
    if (!credencialOk) throw new FalhaComputador("cofre_invalido", { detalhe: "NOD_CREDENTIAL_KEY precisa ser hex de 64" });
    const loc = await acharLoc(id, escopo);
    if (!loc) throw new FalhaComputador("nao_iniciou", { detalhe: "computador não encontrado" });
    return loc;
  }

  /** A máquina do computador, já conectada. Sem contato: acorda (NOD-92) ou falha na hora. */
  async function maquinaViva(id: string, loc: ComputadorLocalizado): Promise<MaquinaDaPessoa> {
    const conectadas = o.maquinas(loc.escopo);
    // NOD-365: `lugarPadrao` já foi persistido no INSERT. Ligar nunca recalcula o lugar inicial.
    const alvo = escolherMaquina({ maquinaId: loc.maquinaId, hospedeiraId: loc.hospedeiraId, padraoId: loc.padraoId, conectadas });
    if (!alvo) throw new FalhaComputador("maquina_sem_contato", { detalhe: "nenhuma máquina conectada anuncia o computador" });
    let viva = o.maquinas(loc.escopo).find((m) => m.machineId === alvo);
    if (!viva && o.acordarSePreciso && await o.acordarSePreciso(loc.escopo, alvo).catch(() => false)) viva = o.maquinas(loc.escopo).find((m) => m.machineId === alvo);
    if (!viva) {
      const nome = await o.nomeDaMaquina(loc.escopo, alvo).catch(() => null);
      log("aviso", "computador_maquina_sem_contato", { computador_id: id, maquina_id: alvo });
      throw new FalhaComputador("maquina_sem_contato", { maquina: nome ?? "a máquina do computador" });
    }
    // App abaixo do piso primeiro: um app velho pode nem anunciar o computador, e o caminho é atualizar.
    if (abaixoDoPiso(viva)) throw new FalhaComputador("app_desatualizado", { maquina: viva.nome });
    if (viva.computador === null || viva.computador === "sem_suporte") throw new FalhaComputador("sem_suporte", { maquina: viva.nome });
    if (viva.computador === "faltam_pacotes") throw new FalhaComputador("faltam_pacotes", { maquina: viva.nome });
    return viva;
  }

  /**
   * Manda o comando e espera a resposta até `ate`. Falha na hora se a máquina perde o contato (a conexão sai da lista).
   * No prazo: o comando sai da fila e a resposta que chegar depois é ignorada.
   */
  async function enviar(id: string, loc: ComputadorLocalizado, maquina: MaquinaDaPessoa, tipo: TipoComandoComputador, ate: number, noPrazo: () => FalhaComputador, extra: Partial<ComandoComputador> = {}): Promise<ResultadoComandoComputador> {
    const comando = assinarComando(credencial, { id: novoId(), computadorId: loc.computadorId ?? id, tipo, ...(loc.agenteId && TIPOS_DA_TELA.has(tipo) ? { agenteId: loc.agenteId } : {}), uso: loc.uso, prazoMs: Math.min(ate, agora() + PRAZO_COMANDO_MS), ...extra });
    const espera: { fim?: { r: ResultadoComandoComputador } | { e: unknown } } = {};
    o.canal.enviar(loc.escopo, maquina.machineId, comando).then((r) => { espera.fim = { r }; }, (e: unknown) => { espera.fim = { e }; });
    while (!espera.fim) {
      if (agora() >= ate) o.canal.cancelar(comando.id, noPrazo());
      else if (!o.maquinas(loc.escopo).some((m) => m.machineId === maquina.machineId)) o.canal.cancelar(comando.id, new FalhaComputador("maquina_sem_contato", { maquina: maquina.nome }));
      else await dormir(PASSO_MS);
      // O cancelar rejeita a promessa: um tique para o `then` acima rodar.
      await Promise.resolve();
    }
    if ("e" in espera.fim) throw espera.fim.e;
    return espera.fim.r;
  }

  async function ligar(idDoPortao: string, escopo: Escopo | undefined): Promise<void> {
    const loc = await localizar(idDoPortao, escopo);
    const id = loc.computadorId ?? idDoPortao;
    const maquina = await maquinaViva(id, loc);
    // O Mac com a VM local pode estar religando a VM (ou criando-a pela 1ª vez): o teto dele é maior.
    const ate = agora() + (maquina.vmLocal ? TETO_PRONTO_VM_LOCAL_MS : TETO_PRONTO_MS);
    const foto = () => o.canal.foto(loc.escopo, maquina.machineId);
    if (foto()?.computadorId === id && foto()?.ligado) {
      entregarSaidaPendente(idDoPortao, loc, id, maquina.machineId);
      return;
    }
    if (!loc.hospedeiraId && !loc.maquinaId) await o.fixarHospedeira(loc.escopo, id, maquina.machineId);
    let pub = loc.supervisorPub;
    // NOD-96 PR 7 (definido em 2026-10-22): numa instalação limpa o supervisor não conhece o computador e não relata
    // nada dele; ele só cria a pasta e a X25519 ao receber um comando com o id. A sonda é esse comando SEM assinatura —
    // sempre recusada (não liga nem desliga nada); o supervisor relata o computador novo na hora e a espera abaixo pega a
    // chave. Sem a sonda, a primeira ação de toda máquina nova esperava os 60 s e falhava (achado do e2e do PR 7).
    const sonda = !pub && !foto()?.supervisorPub ? { id: novoId(), computadorId: id, tipo: "parar" as const, uso: loc.uso, prazoMs: agora() + PRAZO_COMANDO_MS, assinatura: "" } : null;
    if (sonda) o.canal.enviar(loc.escopo, maquina.machineId, sonda).catch(() => undefined);
    try {
      pub = await esperarChave(id, loc, maquina, ate, pub, foto);
    } finally {
      if (sonda) o.canal.cancelar(sonda.id, new FalhaComputador("nao_iniciou"));
    }
    const pedirIniciar = () => enviar(idDoPortao, loc, maquina, "iniciar", ate, () => new FalhaComputador("nao_ficou_pronto", { maquina: maquina.nome }), {
      segredoSelado: seloDoIniciar(credencial, id, pub),
      // NOD-96 PR 7: o supervisor fixa a Ed25519 do servidor no primeiro `iniciar` (TOFU) por este campo; sem ele
      // recusava o comando (`sem_chave_do_servidor`) e nenhuma máquina nova ligava.
      servidorPub: publicaDeAssinatura(credencial, id),
    });
    let r = await pedirIniciar();
    // definido em 2026-10-24 (NOD-93, ADR-127 §3): o Mac responde esperando_tela enquanto a VM local baixa, prepara ou
    // espera memória; o servidor segura e pede de novo até o TETO_PRONTO_MS (estourou: nao_ficou_pronto).
    while (r.desfecho === "esperando_tela") {
      if (agora() >= ate) throw new FalhaComputador("nao_ficou_pronto", { maquina: maquina.nome, detalhe: r.progresso?.etapa });
      await dormir(PASSO_ESPERANDO_MS);
      r = await pedirIniciar();
    }
    if (r.desfecho === "ok") {
      log("info", "computador_iniciado", { computador_id: id, maquina_id: maquina.machineId, driver: "motor" });
      entregarSaidaPendente(idDoPortao, loc, id, maquina.machineId);
      return;
    }
    throw new FalhaComputador(r.motivo ?? "nao_iniciou", { maquina: maquina.nome });
  }

  /** A X25519 do supervisor: a fixada (TOFU) ou a que a máquina relata; sem nenhuma ainda, espera o primeiro estado. */
  async function esperarChave(id: string, loc: ComputadorLocalizado, maquina: MaquinaDaPessoa, ate: number, fixada: string | null, foto: () => ReturnType<CanalComputador["foto"]>): Promise<string> {
    let pub = fixada;
    while (!pub) {
      const relatada = foto()?.supervisorPub;
      if (relatada) {
        const d = await o.fixarSupervisor(loc.escopo, id, relatada);
        if (d === "diferente" || d === null) throw new FalhaComputador("nao_iniciou", { detalhe: "a chave do supervisor não é a fixada; Redefinir o computador" });
        pub = relatada;
        break;
      }
      if (agora() >= ate) throw new FalhaComputador("nao_ficou_pronto", { maquina: maquina.nome, detalhe: "o supervisor não relatou estado" });
      if (!o.maquinas(loc.escopo).some((m) => m.machineId === maquina.machineId)) throw new FalhaComputador("maquina_sem_contato", { maquina: maquina.nome });
      await dormir(PASSO_MS);
    }
    return pub;
  }

  /** O `marcar_saida` de uma máquina antiga, sem segurar quem chamou; falhou, fica pendente para o próximo `ligar`. */
  async function marcarSaida(idDoPortao: string, loc: ComputadorLocalizado, id: string, maquina: MaquinaDaPessoa, epocaTroca = novaEpocaTroca()): Promise<boolean> {
    try {
      const r = await enviar(idDoPortao, { ...loc, agenteId: null }, maquina, "marcar_saida", agora() + PRAZO_RESPOSTA_PARAR_MS, () => new FalhaComputador("sem_resposta", { maquina: maquina.nome }), { epocaTroca });
      if (r.desfecho === "ok") {
        await o.saidaMarcada?.(loc.escopo, id, maquina.machineId);
        return true;
      }
      log("aviso", "computador_saida_nao_marcada", { computador_id: id, motivo: r.motivo ?? "desconhecido" });
    } catch (e) {
      log("aviso", "computador_saida_nao_marcada", { computador_id: id, motivo: ehFalhaComputador(e) ? e.motivo : "desconhecido" });
    }
    return false;
  }

  /**
   * NOD-365: a máquina de onde o computador saiu sem contato recebe o `marcar_saida` quando volta (o computador ligou e
   * ela está conectada). Se o computador voltou a morar nela, não há o que marcar: só limpa.
   */
  function entregarSaidaPendente(idDoPortao: string, loc: ComputadorLocalizado, id: string, atual: string): void {
    if (trocando.has(id)) return;
    for (const pendente of loc.saidasPendentesDe ?? []) {
      if (pendente === atual) { o.saidaMarcada?.(loc.escopo, id, pendente).catch(() => undefined); continue; }
      const antiga = o.maquinas(loc.escopo).find((m) => m.machineId === pendente);
      const chave = `${id}:${pendente}`;
      if (!antiga || marcando.has(chave)) continue;
      marcando.add(chave);
      void marcarSaida(idDoPortao, loc, id, antiga).finally(() => marcando.delete(chave));
    }
  }

  function iniciar(id: string, escopo?: Escopo): Promise<void> {
    const emCurso = iniciando.get(id);
    if (emCurso) return emCurso;
    const p = ligar(id, escopo).finally(() => iniciando.delete(id));
    iniciando.set(id, p);
    return p;
  }

  /** Uma parte da troca: o comando assinado, com a chave do servidor (TOFU) e o prazo de cada parte. */
  async function parteDaTroca(idDoPortao: string, loc: ComputadorLocalizado, maquina: MaquinaDaPessoa, tipo: "exportar_logins" | "importar_logins", extra: Partial<ComandoComputador>): Promise<ResultadoComandoComputador> {
    const id = loc.computadorId ?? idDoPortao;
    const r = await enviar(idDoPortao, { ...loc, agenteId: null }, maquina, tipo, agora() + PRAZO_RESPOSTA_PARTE_MS, () => new FalhaComputador("sem_resposta", { maquina: maquina.nome }), { servidorPub: publicaDeAssinatura(credencial, id), ...extra });
    if (r.desfecho !== "ok") throw new FalhaComputador(r.motivo ?? "acao_falhou", { maquina: maquina.nome });
    return r;
  }

  async function cancelarExportacao(idDoPortao: string, loc: ComputadorLocalizado, origem: MaquinaDaPessoa, troca: string, epocaTroca: number): Promise<boolean> {
    try {
      const r = await enviar(idDoPortao, { ...loc, agenteId: null }, origem, "cancelar_exportacao", agora() + PRAZO_RESPOSTA_PARAR_MS, () => new FalhaComputador("sem_resposta", { maquina: origem.nome }), { troca, epocaTroca });
      if (r.desfecho === "ok") return true;
      log("aviso", "computador_exportacao_nao_cancelada", { computador_id: loc.computadorId ?? idDoPortao, motivo: r.motivo ?? "acao_falhou" });
    } catch (e) {
      log("aviso", "computador_exportacao_nao_cancelada", { computador_id: loc.computadorId ?? idDoPortao, motivo: ehFalhaComputador(e) ? e.motivo : "desconhecido" });
    }
    return false;
  }

  /**
   * definido em 2026-10-28 (NOD-365): o computador muda de máquina. A loja de logins vai cifrada, em partes, da origem
   * para o destino (o servidor só repassa base64; a chave deriva do id do computador, não da máquina). Depois o banco
   * aponta para o destino com a X25519 esquecida (o supervisor de lá tem outra; TOFU de novo) e o `iniciar` prova a loja.
   * Falhou o `iniciar`: o banco volta ao lugar de antes e a origem não é marcada. Deu certo: a pasta da origem fica
   * marcada e sai em 30 dias. Sem `semLogins`, a origem sem contato é `maquina_sem_contato` com o nome dela.
   */
  async function trocar(idDoPortao: string, destinoId: string, op: { semLogins: boolean; aoProgresso?: ProgressoDaTroca }, escopo?: Escopo): Promise<void> {
    // Um iniciar em voo (uma tela abrindo) termina antes: senão ele ligaria a origem depois de a loja sair de lá.
    await iniciando.get(idDoPortao)?.catch(() => undefined);
    const loc = { ...await localizar(idDoPortao, escopo), agenteId: null };
    const id = loc.computadorId ?? idDoPortao;
    if (!o.fixarLugar || !o.adicionarSaidaPendente) throw new FalhaComputador("acao_falhou", { detalhe: "troca de máquina indisponível" });
    const progresso = async (pct: number, etapa: string) => { await op.aoProgresso?.({ pct, etapa }); };
    const conectadas = o.maquinas(loc.escopo);
    const destino = conectadas.find((m) => m.machineId === destinoId);
    if (!destino) throw new FalhaComputador("maquina_sem_contato", { maquina: (await o.nomeDaMaquina(loc.escopo, destinoId).catch(() => null)) ?? "a máquina escolhida" });
    if (destino.computador === null || destino.computador === "sem_suporte") throw new FalhaComputador("sem_suporte", { maquina: destino.nome });
    if (destino.computador === "faltam_pacotes") throw new FalhaComputador("faltam_pacotes", { maquina: destino.nome });
    const origemId = escolherMaquina({ maquinaId: loc.maquinaId, hospedeiraId: loc.hospedeiraId, padraoId: loc.padraoId, conectadas });
    const origem = origemId && origemId !== destinoId ? conectadas.find((m) => m.machineId === origemId) : undefined;
    // Só a máquina gravada é origem de fato (o disco é dela); sem nada gravado, o computador ainda não morou em lugar nenhum.
    const temOrigem = Boolean((loc.maquinaId ?? loc.hospedeiraId) && origemId && origemId !== destinoId);
    const pendentesAnteriores = loc.saidasPendentesDe ?? [];
    const epocaTroca = novaEpocaTroca();
    let trocaOrigem: string | null = null;
    let concluiu = false;
    let podeCancelarOrigem = true;
    try {
    if (!op.semLogins && temOrigem) {
      if (!origem) throw new FalhaComputador("maquina_sem_contato", { maquina: (await o.nomeDaMaquina(loc.escopo, origemId!).catch(() => null)) ?? "a máquina do computador" });
      const troca = novoId();
      trocaOrigem = troca;
      await progresso(5, "Copiando os logins");
      const partes: string[] = [];
      for (let i = 0, total = 1; i < total; i++) {
        const r = await parteDaTroca(idDoPortao, loc, origem, "exportar_logins", { troca, epocaTroca, parte: i });
        if (!r.logins || r.logins.parte !== i) throw new FalhaComputador("acao_falhou", { maquina: origem.nome, detalhe: "parte fora de ordem" });
        total = r.logins.total;
        partes.push(r.logins.dados);
        await progresso(5 + Math.round((40 * (i + 1)) / total), "Copiando os logins");
      }
      // Imediatamente antes da primeira escrita no destino, registre a limpeza durável. Se o servidor cair depois da
      // importação e antes de trocar o lugar, a próxima reconciliação ainda manda `.saiu-em` para ele.
      await o.adicionarSaidaPendente(loc.escopo, id, destinoId);
      for (let i = 0; i < partes.length; i++) {
        await parteDaTroca(idDoPortao, loc, destino, "importar_logins", { troca, epocaTroca, parte: i, total: partes.length, dados: partes[i]! });
        await progresso(45 + Math.round((35 * (i + 1)) / partes.length), "Levando para a máquina nova");
      }
    } else {
      // Sem os logins, o destino começa com a loja vazia: a que ele guardasse de uma estada antiga não volta (a faixa
      // "entre nos sites de novo" é verdade).
      await progresso(45, "Levando para a máquina nova");
      await o.adicionarSaidaPendente(loc.escopo, id, destinoId);
      await parteDaTroca(idDoPortao, loc, destino, "importar_logins", { troca: novoId(), epocaTroca, parte: 0, total: 1, dados: PACOTE_VAZIO });
    }
    const antes: LugarGravado = { maquinaId: loc.maquinaId, hospedeiraId: loc.hospedeiraId, supervisorPub: loc.supervisorPub, saidasPendentesDe: [...new Set([...pendentesAnteriores, destinoId])] };
    // A origem fica pendente até receber o `marcar_saida` (agora, ou quando voltar a ter contato); a pendente de antes,
    // se não for o destino, continua.
    const pendentes = [...new Set([...pendentesAnteriores, ...(temOrigem && origemId ? [origemId] : [])])].filter((m) => m !== destinoId);
    // "Onde o nod roda" (a máquina do motor) é o lugar padrão: grava maquina_id null e só a hospedeira, como um
    // computador que nunca saiu de lá; uma máquina da pessoa grava as duas.
    const ondeONodRoda = destino.papel === "motor" && destino.plataforma === "linux";
    await o.fixarLugar(loc.escopo, id, { maquinaId: ondeONodRoda ? null : destinoId, hospedeiraId: destinoId, supervisorPub: null, saidasPendentesDe: pendentes });
    podeCancelarOrigem = false;
    trocando.add(id);
    try {
      await progresso(85, "Ligando na máquina nova");
      await iniciar(idDoPortao, escopo);
    } catch (e) {
      try {
        await o.fixarLugar(loc.escopo, id, antes);
        podeCancelarOrigem = true;
      } catch (r) {
        log("erro", "computador_troca_nao_revertida", { computador_id: id, erro: r instanceof Error ? r.name : "desconhecido" });
        throw new FalhaComputador("acao_falhou", { maquina: destino.nome, detalhe: "a reversão do lugar falhou" });
      }
      // O destino já recebeu a loja: se ele não é o lugar de antes, marca a saída nele para a cópia não ficar lá para sempre.
      if (destinoId !== (antes.maquinaId ?? antes.hospedeiraId)) void marcarSaida(idDoPortao, loc, id, destino, epocaTroca).catch(() => false);
      log("aviso", "computador_troca_falhou", { computador_id: id, destino_id: destinoId, motivo: ehFalhaComputador(e) ? e.motivo : "desconhecido" });
      throw e;
    } finally {
      trocando.delete(id);
    }
    if (origem && temOrigem) await marcarSaida(idDoPortao, loc, id, origem, epocaTroca);
    await progresso(100, "pronto");
    log("info", "computador_trocou_de_maquina", { computador_id: id, origem_id: origemId, destino_id: destinoId, com_logins: !op.semLogins });
    concluiu = true;
    } finally {
      if (!concluiu && trocaOrigem && origem && podeCancelarOrigem) await cancelarExportacao(idDoPortao, loc, origem, trocaOrigem, epocaTroca);
    }
  }

  return {
    async ambiente(): Promise<AmbienteComputador> {
      return credencialOk ? { disponivel: true, motivo: null } : { disponivel: false, motivo: "NOD_CREDENTIAL_KEY precisa ser hex de 64 para o cofre dos computadores" };
    },
    async estado(id, escopo) {
      if (!credencialOk) return { disponivel: false, ativo: false, motivo: "NOD_CREDENTIAL_KEY precisa ser hex de 64 para o cofre dos computadores" };
      const loc = await acharLoc(id, escopo);
      if (!loc) return { disponivel: false, ativo: false, motivo: "Computador não encontrado" };
      const alvo = escolherMaquina({ maquinaId: loc.maquinaId, hospedeiraId: loc.hospedeiraId, padraoId: loc.padraoId, conectadas: o.maquinas(loc.escopo) });
      const viva = alvo ? o.maquinas(loc.escopo).find((m) => m.machineId === alvo) : undefined;
      const ativo = o.canal.ligados().has(loc.computadorId ?? id);
      if (!viva) return { disponivel: false, ativo, motivo: alvo ? "A máquina do computador está sem contato" : "Nenhuma máquina conectada roda o computador" };
      if (viva.computador !== "pronto") return { disponivel: false, ativo, motivo: viva.computador === "faltam_pacotes" ? `Falta instalar pacotes do computador em ${viva.nome}` : `${viva.nome} não consegue rodar o computador` };
      return { disponivel: true, ativo, motivo: null };
    },
    iniciar,
    async parar(id, escopo) {
      const loc = await acharLoc(id, escopo);
      if (!loc || !credencialOk) return;
      const alvo = escolherMaquina({ maquinaId: loc.maquinaId, hospedeiraId: loc.hospedeiraId, padraoId: loc.padraoId, conectadas: o.maquinas(loc.escopo) });
      const viva = alvo ? o.maquinas(loc.escopo).find((m) => m.machineId === alvo) : undefined;
      // Sem contato não há o que parar daqui: o supervisor desliga sozinho pela ociosidade.
      if (!viva) return;
      // NOD-96 PR 4: parar a tela de um bot é fechar só ela; o computador da pessoa (agenteId nulo) para inteiro.
      const tipo: TipoComandoComputador = loc.agenteId ? "fechar_tela" : "parar";
      try {
        await enviar(id, loc, viva, tipo, agora() + PRAZO_RESPOSTA_PARAR_MS, () => new FalhaComputador("sem_resposta", { maquina: viva.nome }));
      } catch (e) {
        log("aviso", "computador_parar_falhou", { computador_id: id, tipo, motivo: ehFalhaComputador(e) ? e.motivo : "desconhecido" });
      }
    },
    async executar(id: string, acao: AcaoComputador, escopo?: Escopo, autor?: "bot" | "pessoa"): Promise<ResultadoComputador> {
      const loc = await localizar(id, escopo);
      const maquina = await maquinaViva(id, loc);
      ultimaAcao.set(maquina.machineId, agora());
      const r = await enviar(id, loc, maquina, "acao", agora() + PRAZO_RESPOSTA_ACAO_MS, () => new FalhaComputador("sem_resposta", { maquina: maquina.nome }), { acao, ...(autor === "pessoa" ? { pessoa: true as const } : {}) });
      ultimaAcao.set(maquina.machineId, agora());
      if (r.desfecho === "ok") return r.resultado ?? {};
      // NOD-96 PR 4: sem tela livre a ação não falha; o portão põe a tela na fila e tenta de novo na vez dela.
      if (r.desfecho === "esperando_tela") throw new EsperandoTela(r.quem ?? []);
      throw new FalhaComputador(r.motivo ?? "acao_falhou", { maquina: maquina.nome });
    },
    /**
     * NOD-95 (ADR-138): a tela ao vivo deste bot. O comando leva a sessão e o token; o motor abre o WebSocket de volta e
     * responde `ok` com o VNC já ligado. Sem tela livre, espera como a ação (o portão decide).
     */
    async vivo(id: string, sessao: SessaoVivo, escopo?: Escopo): Promise<void> {
      const loc = await localizar(id, escopo);
      const maquina = await maquinaViva(id, loc);
      ultimaAcao.set(maquina.machineId, agora());
      const r = await enviar(id, loc, maquina, "vivo", agora() + PRAZO_RESPOSTA_ACAO_MS, () => new FalhaComputador("sem_resposta", { maquina: maquina.nome }), { vivo: sessao });
      ultimaAcao.set(maquina.machineId, agora());
      if (r.desfecho === "ok") return;
      if (r.desfecho === "esperando_tela") throw new EsperandoTela(r.quem ?? []);
      throw new FalhaComputador(r.motivo ?? "acao_falhou", { maquina: maquina.nome });
    },
    async ligados() {
      const ids = new Set<string>();
      const telas = o.canal.telasLigadas();
      for (const c of o.canal.ligados()) {
        ids.add(c);
        for (const [doPortao, agenteId] of idsDoPortao.get(c) ?? []) if (!agenteId || telas.has(`${c}:${agenteId}`)) ids.add(doPortao);
      }
      return ids;
    },
    async operar(idDoPortao, tipo, escopo) {
      const loc = await localizar(idDoPortao, escopo);
      const id = loc.computadorId ?? idDoPortao;
      // Sair de todos os sites limpa os cookies das telas abertas e Esquecer senhas apaga as senhas e religa as
      // telas: o supervisor exige o computador ligado nas duas.
      if (tipo === "sair_de_todos" || tipo === "esquecer_senhas") await iniciar(idDoPortao, escopo);
      const maquina = await maquinaViva(id, loc);
      ultimaAcao.set(maquina.machineId, agora());
      const r = await enviar(idDoPortao, loc, maquina, tipo, agora() + PRAZO_RESPOSTA_OPERACAO_MS, () => new FalhaComputador("sem_resposta", { maquina: maquina.nome }));
      ultimaAcao.set(maquina.machineId, agora());
      if (r.desfecho !== "ok") throw new FalhaComputador(r.motivo ?? "acao_falhou", { maquina: maquina.nome });
      log("info", "computador_operacao_concluida", { computador_id: id, tipo, maquina_id: maquina.machineId });
      return r.supervisorPub ? { supervisorPub: r.supervisorPub } : {};
    },
    async apagarPerfil(idDoPortao, agenteId, escopo) {
      const loc = await acharLoc(idDoPortao, escopo);
      if (!loc || !credencialOk) return;
      const id = loc.computadorId ?? idDoPortao;
      const alvo = escolherMaquina({ maquinaId: loc.maquinaId, hospedeiraId: loc.hospedeiraId, padraoId: loc.padraoId, conectadas: o.maquinas(loc.escopo) });
      const viva = alvo ? o.maquinas(loc.escopo).find((m) => m.machineId === alvo) : undefined;
      // Sem contato o perfil fica na máquina até o Redefinir (a tela some do banco do mesmo jeito).
      if (!viva) {
        log("aviso", "computador_perfil_nao_apagado", { computador_id: id, agente_id: agenteId, motivo: "maquina_sem_contato" });
        return;
      }
      try {
        const r = await enviar(idDoPortao, loc, viva, "apagar_perfil", agora() + PRAZO_RESPOSTA_PARAR_MS, () => new FalhaComputador("sem_resposta", { maquina: viva.nome }), { agenteId });
        if (r.desfecho !== "ok") log("aviso", "computador_perfil_nao_apagado", { computador_id: id, agente_id: agenteId, motivo: r.motivo ?? "desconhecido" });
      } catch (e) {
        log("aviso", "computador_perfil_nao_apagado", { computador_id: id, agente_id: agenteId, motivo: ehFalhaComputador(e) ? e.motivo : "desconhecido" });
      }
    },
    async maquinaDoComputador(id, escopo) {
      const loc = await acharLoc(id, escopo);
      if (!loc) return null;
      const conectadas = o.maquinas(loc.escopo);
      const alvo = escolherMaquina({ maquinaId: loc.maquinaId, hospedeiraId: loc.hospedeiraId, padraoId: loc.padraoId, conectadas }) ?? loc.maquinaId ?? loc.hospedeiraId;
      if (!alvo) return null;
      const viva = conectadas.find((m) => m.machineId === alvo);
      if (!viva) {
        const gravada = await o.maquinaGravada?.(loc.escopo, alvo).catch(() => null) ?? null;
        const nome = gravada?.nome ?? (await o.nomeDaMaquina(loc.escopo, alvo).catch(() => null)) ?? "a máquina do computador";
        return { id: alvo, nome, contato: null, foto: null, ultimoContato: o.ultimoContato?.(alvo) ?? gravada?.ultimoUsoEm ?? null };
      }
      const f = o.canal.foto(loc.escopo, alvo);
      const foto = f?.computadorId === id
        ? { ligadoDesde: f.ligadoDesde ?? null, memoriaTotalMb: f.memoriaTotalMb ?? null, titulos: Object.fromEntries(f.telas.map((t) => [t.agenteId, t.titulo ?? null])) }
        : null;
      // NOD-93 (passo 9): a máquina escolhida é o Mac com a VM local — o preparo vai junto para a tela.
      return {
        id: alvo, nome: viva.nome, contato: viva.ultimoContato, foto,
        ...(abaixoDoPiso(viva) ? { appDesatualizado: { atual: viva.versaoApp!, minima: pisoApp!, plataforma: viva.plataforma } } : {}),
        ...(viva.plataforma === "darwin" && viva.vmLocal ? { preparo: viva.vmLocal } : {}),
      };
    },
    ligando(id) {
      return iniciando.has(id);
    },
    trocar,
    async reconciliarSaidasPendentes(idDoPortao, escopo) {
      const loc = await acharLoc(idDoPortao, escopo);
      if (!loc) return;
      const id = loc.computadorId ?? idDoPortao;
      const atual = loc.maquinaId ?? loc.hospedeiraId;
      if (atual) entregarSaidaPendente(idDoPortao, loc, id, atual);
    },
    async lugares(idDoPortao, escopo) {
      const loc = await acharLoc(idDoPortao, escopo);
      if (!loc) return [];
      const atualId = loc.maquinaId ?? loc.hospedeiraId;
      const conectadas = o.maquinas(loc.escopo).map((m) => ({ ...m, papel: m.papel ?? "motor" }));
      const viva = atualId ? conectadas.find((m) => m.machineId === atualId) : undefined;
      // A atual sem contato entra com o nome, o papel e a plataforma da chave (sem a chave, como "Outra máquina sua").
      const gravada = atualId && !viva ? await o.maquinaGravada?.(loc.escopo, atualId).catch(() => null) ?? null : null;
      const atual = !atualId ? null : viva ? { maquinaId: viva.machineId, nome: viva.nome, papel: viva.papel, plataforma: viva.plataforma }
        : gravada ? { maquinaId: atualId, nome: gravada.nome, papel: gravada.papel, plataforma: gravada.plataforma ?? "darwin" }
        : { maquinaId: atualId, nome: (await o.nomeDaMaquina(loc.escopo, atualId).catch(() => null)) ?? "a máquina do computador", papel: "computador" as const, plataforma: "linux" as const };
      return opcoesDeLugar(conectadas, atual) satisfies LugarDoComputador[];
    },
    motivoParaFicarAcordada(maquinaId: string): boolean {
      const foto = o.canal.fotoDaMaquina(maquinaId);
      return motivoParaFicarAcordada(foto ? [foto] : [], ultimaAcao.get(maquinaId) ?? null, agora());
    },
  };
}
