import type { DesejoNuvem, ErroNuvem, EstadoInstancia, EstadoMaquinaNuvem, MotivoFalhaNuvem, RefInstancia } from "../contracts/provedor-nuvem.ts";

/**
 * ADR-121 (NOD-92): a máquina na nuvem que dorme e acorda sozinha. Regras puras: classificar o erro do provedor, decidir
 * o próximo passo do reconciliador e gerar as condições de IAM. `agora` sempre por parâmetro.
 */

/** O erro do provedor com motivo fechado. O adaptador lança; o reconciliador grava o motivo, nunca a mensagem. */
export class ErroNuvemLancado extends Error {
  readonly motivo: MotivoFalhaNuvem;
  readonly detalhe: string | null;
  constructor(e: ErroNuvem) {
    super(e.motivo);
    this.name = "ErroNuvemLancado";
    this.motivo = e.motivo;
    this.detalhe = e.detalhe ?? null;
  }
}

/** Erro que passa sozinho (5xx, rede, 429): o reconciliador solta a reserva e tenta na próxima volta. */
export class ErroNuvemTransitorio extends Error {
  constructor() {
    super("nuvem_transitorio");
    this.name = "ErroNuvemTransitorio";
  }
}

// definido em 2026-10-22 (plano do Arquiteto na NOD-92): os códigos que o Google devolve, em `error.errors[].reason`
// (REST síncrono), `error.status` ou `operation.error.errors[].code` (operação assíncrona da Compute).
const COTA_OU_COBRANCA = new Set([
  "QUOTA_EXCEEDED",
  "quotaExceeded",
  "billingNotEnabled",
  "BILLING_DISABLED",
  "billingDisabled",
  "accountDisabled",
  // Política da organização (ex.: constraints/compute.vmExternalIpAccess): a pessoa resolve no console, como a cota.
  "CONDITION_NOT_MET",
  "conditionNotMet",
  "ORG_POLICY_VIOLATED",
  "orgPolicyViolated",
]);
const SEM_CAPACIDADE = new Set(["ZONE_RESOURCE_POOL_EXHAUSTED", "ZONE_RESOURCE_POOL_EXHAUSTED_WITH_DETAILS", "resourceNotReady", "RESOURCE_NOT_READY", "STOCKOUT"]);
const TRANSITORIOS = new Set(["rateLimitExceeded", "userRateLimitExceeded", "RESOURCE_EXHAUSTED", "backendError", "internalError"]);

type Corpo = { error?: { code?: unknown; status?: unknown; errors?: unknown } };

function codigosDo(corpo: unknown): string[] {
  if (typeof corpo !== "object" || corpo === null) return [];
  const err = (corpo as Corpo).error;
  if (typeof err !== "object" || err === null) return [];
  const saida: string[] = [];
  if (typeof err.status === "string") saida.push(err.status);
  if (Array.isArray(err.errors)) {
    for (const e of err.errors as unknown[]) {
      if (typeof e !== "object" || e === null) continue;
      const r = (e as { reason?: unknown; code?: unknown }).reason;
      const c = (e as { reason?: unknown; code?: unknown }).code;
      if (typeof r === "string") saida.push(r);
      if (typeof c === "string") saida.push(c);
    }
  }
  return saida;
}

/**
 * Classifica a resposta de erro do Google. `status` 0 = a rede falhou. `operacao` muda a leitura de um caso: a criação
 * de chave recusada por pré-condição é a organização "segura por padrão" (`iam.disableServiceAccountKeyCreation`).
 * Devolve `"transitorio"` para o que vale tentar de novo sem a pessoa.
 */
export function classificarErroNuvem(status: number, corpo: unknown, operacao?: "criar_chave"): ErroNuvem | "transitorio" {
  const codigos = codigosDo(corpo);
  // NOD-92 (revisão, item 12): só a pré-condição (412, FAILED_PRECONDITION ou a constraint nomeada) é a organização; o 400
  // genérico da criação de chave segue a regra comum.
  if (operacao === "criar_chave" && (status === 412 || codigos.includes("FAILED_PRECONDITION") || JSON.stringify(corpo ?? null).includes("disableServiceAccountKeyCreation"))) {
    return { motivo: "credencial_nuvem", detalhe: "org_bloqueia_chave" };
  }
  if (codigos.some((c) => SEM_CAPACIDADE.has(c))) return { motivo: "sem_capacidade" };
  if (codigos.some((c) => COTA_OU_COBRANCA.has(c))) return { motivo: "cota_ou_cobranca" };
  if (status === 401 || status === 403) return { motivo: "credencial_nuvem" };
  if (status === 404) return { motivo: "excluida" };
  if (status === 0 || status === 429 || status >= 500 || codigos.some((c) => TRANSITORIOS.has(c))) return "transitorio";
  // 400/409/412 sem código conhecido: não sabemos resolver sozinhos; a credencial é o que a pessoa refaz (Reconectar).
  return { motivo: "credencial_nuvem" };
}

/** O erro de uma operação assíncrona da Compute (`operation.error`), no mesmo formato do corpo síncrono. */
export function classificarErroDeOperacao(erro: unknown): ErroNuvem | "transitorio" {
  return classificarErroNuvem(400, { error: erro });
}

// definido em 2026-10-22 (plano da NOD-92): reiniciar uma vez aos 3 min sem contato; desistir aos 6 min.
export const REINICIAR_APOS_MS = 3 * 60_000;
export const DESISTIR_APOS_MS = 6 * 60_000;
// definido em 2026-10-22 (plano da NOD-92): sem capacidade na zona, nova tentativa em 5 min, ainda "Acordando…".
export const NOVA_TENTATIVA_MS = 5 * 60_000;
// definido em 2026-10-23 (revisão da NOD-92, item 10): sem capacidade por 30 min desde o primeiro "Acordando…", desiste
// (falhou_ao_acordar/sem_capacidade); a pessoa tenta de novo pelo botão ou troca de zona.
export const DESISTIR_SEM_CAPACIDADE_MS = 30 * 60_000;
// definido em 2026-10-22: a reserva de uma operação (ligar/desligar) dura até 2 min; vencida, outro processo pode tentar.
export const RESERVA_MS = 2 * 60_000;
// definido em 2026-10-22 (plano da NOD-92): uma rotina que começa em até 15 min segura o sono da máquina dela.
export const ROTINA_SEGURA_SONO_MS = 15 * 60_000;
// definido em 2026-10-22 (plano da NOD-92, PR 2): a VM criada tem 15 min para o motor parear e falar; senão, falha.
export const CRIAR_DESISTIR_APOS_MS = 15 * 60_000;
// definido em 2026-10-22 (plano da NOD-92, PR 2): o convite da VM criada vale 30 min (o do comando de instalação, ADR-102).
export const PRAZO_CONVITE_NUVEM_MS = 30 * 60_000;

/** O que o reconciliador sabe de uma máquina numa volta. */
export type SituacaoNuvem = {
  estado: EstadoMaquinaNuvem;
  desejado: DesejoNuvem;
  estadoDesde: number;
  ligouEm: number | null;
  reiniciouEm: number | null;
  proximaTentativaEm: number | null;
  /** A máquina falou com o servidor depois de `ligouEm` (`ultimo_uso_em > ligou_em`). */
  contato: boolean;
};

export type PassoNuvem =
  | { passo: "nada" }
  | { passo: "consultar" }
  | { passo: "ligar" }
  | { passo: "desligar" }
  | { passo: "reiniciar" }
  /** PR 2: cria a VM (mesmo `request_id` em toda tentativa). */
  | { passo: "criar" }
  /** PR 2: o motor da VM criada falou; troca o script de início pela guarda e marca acordada. */
  | { passo: "finalizar" }
  /** Revisão NOD-92 (rodada 2, item 3): a linha já é `excluida` mas a VM ficou no Google; apaga de novo. */
  | { passo: "excluir" }
  | { passo: "marcar"; estado: EstadoMaquinaNuvem; motivo?: MotivoFalhaNuvem | null };

/** Os estados em que o reconciliador precisa perguntar ao provedor antes de decidir. */
export function precisaConsultar(s: Pick<SituacaoNuvem, "estado" | "desejado" | "contato">): boolean {
  if (s.estado === "adormecendo") return true;
  if (s.estado === "dormindo") return s.desejado === "acordada";
  if (s.estado === "acordando") return !s.contato;
  return false;
}

/**
 * O próximo passo de UMA máquina. `instancia` é o que o provedor disse nesta volta (null = não consultado). Pura: o
 * reconciliador reserva a máquina, chama o provedor fora da transação e grava o resultado.
 */
export function proximoPasso(s: SituacaoNuvem, instancia: EstadoInstancia | null, agora: number): PassoNuvem {
  if (instancia === "inexistente" && s.estado !== "criando" && s.estado !== "excluida") return { passo: "marcar", estado: "excluida", motivo: "excluida" };
  switch (s.estado) {
    case "criando":
      if (s.ligouEm === null) return s.proximaTentativaEm !== null && agora < s.proximaTentativaEm ? { passo: "nada" } : { passo: "criar" };
      if (s.contato) return { passo: "finalizar" };
      if (agora - s.ligouEm >= CRIAR_DESISTIR_APOS_MS) return { passo: "marcar", estado: "falhou_ao_acordar", motivo: "motor_sem_contato" };
      return { passo: "nada" };
    case "excluida":
      // Revisão NOD-92 (rodada 2, item 3): exclusão pendente no provedor (a VM nasceu depois do DELETE e o excluir falhou).
      if (s.proximaTentativaEm !== null) return agora >= s.proximaTentativaEm ? { passo: "excluir" } : { passo: "nada" };
      return { passo: "nada" };
    case "falhou_ao_acordar":
    case "acordada":
      return { passo: "nada" };
    case "adormecendo":
      if (instancia === null) return { passo: "consultar" };
      if (instancia === "parada") return { passo: "marcar", estado: "dormindo" };
      if (instancia === "parando") return { passo: "nada" };
      return { passo: "desligar" };
    case "dormindo":
      if (s.desejado !== "acordada") return { passo: "nada" };
      if (instancia === null) return { passo: "consultar" };
      // O start só sai depois de o provedor dizer `parada` (o stop ainda corre: esperar).
      if (instancia === "parando") return { passo: "nada" };
      return { passo: "ligar" };
    case "acordando": {
      if (s.contato) return { passo: "marcar", estado: "acordada" };
      if (s.proximaTentativaEm !== null) return agora >= s.proximaTentativaEm ? { passo: "ligar" } : { passo: "nada" };
      const desde = s.ligouEm ?? s.estadoDesde;
      if (agora - desde >= DESISTIR_APOS_MS) return { passo: "marcar", estado: "falhou_ao_acordar", motivo: "motor_sem_contato" };
      if (agora - desde >= REINICIAR_APOS_MS && (s.reiniciouEm === null || s.reiniciouEm < desde)) return { passo: "reiniciar" };
      // Parou sozinha (alguém desligou no console) antes de o motor falar: liga de novo.
      if (instancia === "parada") return { passo: "ligar" };
      if (instancia === null) return { passo: "consultar" };
      return { passo: "nada" };
    }
  }
}

/** Para onde vai a máquina quando uma operação falha com motivo fechado. */
export function aposFalha(estado: EstadoMaquinaNuvem, motivo: MotivoFalhaNuvem, agora: number, estadoDesde: number = agora): { estado: EstadoMaquinaNuvem; motivo: MotivoFalhaNuvem; proximaTentativaEm: number | null } {
  if (motivo === "excluida") return { estado: "excluida", motivo, proximaTentativaEm: null };
  if (estado === "adormecendo") return { estado: "acordada", motivo, proximaTentativaEm: agora + NOVA_TENTATIVA_MS };
  // `estadoDesde` do acordando/criando é o primeiro "Acordando…"/"Criando…" (as novas tentativas não trocam de estado).
  // Sem capacidade por 30 min, desiste (item 10); antes disso, tenta de novo em 5 min. Ao criar, a linha segue `criando`
  // (sem máquina) e tenta de novo com o mesmo request_id.
  if (motivo === "sem_capacidade" && !((estado === "acordando" || estado === "criando") && agora - estadoDesde >= DESISTIR_SEM_CAPACIDADE_MS)) {
    return { estado: estado === "criando" ? "criando" : "acordando", motivo, proximaTentativaEm: agora + NOVA_TENTATIVA_MS };
  }
  return { estado: "falhou_ao_acordar", motivo, proximaTentativaEm: null };
}

/** A máquina está ociosa há tempo de dormir? `dormirAposMin` null = Nunca dormir. */
export function ociosaParaDormir(ultimoUsoEm: number | null, desde: number, dormirAposMin: number | null, agora: number): boolean {
  if (dormirAposMin === null) return false;
  return agora - Math.max(ultimoUsoEm ?? 0, desde) >= dormirAposMin * 60_000;
}

/**
 * "Tela aberta" (NOD-96) e outros motivos para a máquina ficar acordada. Plugável: hoje ninguém registra um, e a máquina
 * dorme pelas regras do banco. Quando a NOD-96 chegar, ela passa a sua função aqui (compor.ts).
 */
export type MotivoParaFicarAcordada = (maquinaId: string) => boolean;
export const nenhumMotivoParaFicarAcordada: MotivoParaFicarAcordada = () => false;

/** O estado que a tela mostra: `adormecendo` é interno. */
export function estadoParaTela(e: EstadoMaquinaNuvem): Exclude<EstadoMaquinaNuvem, "adormecendo"> {
  return e === "adormecendo" ? "dormindo" : e;
}

// ——— Nomes e IAM (ADR-121) ———

/** Prefixo das VMs que o nod cria (PR 2): a permissão de gerenciar vale só para nomes com ele. */
export const PREFIXO_INSTANCIA_NOD = "nod-g-";
export const REDE_NOD = "nod-maquinas";
export const PAPEL_GERENCIAR = "nodMaquinasGerenciar";
export const PAPEL_LIGAR = "nodMaquinasLigar";
export const PAPEL_LER = "nodMaquinasLer";

/** `nod-g-<6hex>`: o nome da VM que o nod cria (o prefixo cerca a permissão de gerenciar). */
export function nomeDaInstanciaCriada(hex6: string): string {
  return `${PREFIXO_INSTANCIA_NOD}${hex6.toLowerCase().replace(/[^a-f0-9]/g, "").slice(0, 6).padEnd(6, "0")}`;
}

/** definido em 2026-10-22 (protótipo da NOD-92): as regiões do "Criar" e a zona de cada (us-east1 não tem zona "a"). */
export const REGIOES_NUVEM = [
  { regiao: "southamerica-east1", zona: "southamerica-east1-a", nome: "São Paulo" },
  { regiao: "us-central1", zona: "us-central1-a", nome: "Iowa (EUA)" },
  { regiao: "us-east1", zona: "us-east1-b", nome: "Carolina do Sul (EUA)" },
] as const;
export type RegiaoNuvem = (typeof REGIOES_NUVEM)[number]["regiao"];
export function zonaDaRegiao(regiao: string): string | null {
  return REGIOES_NUVEM.find((r) => r.regiao === regiao)?.zona ?? null;
}
/** A zona `southamerica-east1-a` mora na região `southamerica-east1`. */
export function regiaoDaZona(zona: string): string {
  return zona.replace(/-[a-z]$/, "");
}
/** A sub-rede automática da rede do nod na região (`autoCreateSubnetworks`). */
export function subredeDaZona(projeto: string, zona: string): string {
  return `projects/${projeto}/regions/${regiaoDaZona(zona)}/subnetworks/${REDE_NOD}`;
}

const CONEXAO_DO_MOTOR = "/home/nod/.config/nod-motor/conexao.json";
const GUARDA = `#!/bin/sh
# Nod (ADR-121): o motor já está pareado nesta máquina; o serviço nod-motor sobe sozinho.
[ -f ${CONEXAO_DO_MOTOR} ] && exit 0
`;

/** O script de início depois do pareamento: só a guarda (sem convite; nada para fazer). */
export function scriptDeGuarda(): string {
  return GUARDA;
}

/**
 * O script de início da VM criada (ADR-121, PR 2): sem motor pareado, instala e pareia com o convite pré-aprovado, em
 * laço até o convite vencer (a rede pode demorar a subir). Pareado (reinício, acordar), sai na hora. `servidor` e
 * `convite` já validados por formato: nada do que entra aqui vem cru da pessoa.
 */
/**
 * NOD-92 (revisão, item 9): o endereço que o script de início usa para baixar o motor. O `compor.ts` confere ao subir:
 * inválido, a criação fica desligada (`integracao_nao_configurada`), em vez de a linha ficar `criando` para sempre.
 */
export function servidorPublicoValido(servidor: string): boolean {
  return /^https?:\/\/[a-z0-9.:-]+$/.test(servidor);
}

export function scriptDeInicio(o: { servidor: string; convite: string; expiraEm: number }): string {
  if (!servidorPublicoValido(o.servidor) || !/^[A-Za-z0-9_-]{32}$/.test(o.convite)) throw new Error("servidor_ou_convite_invalido");
  const ate = Math.floor(o.expiraEm / 1000);
  return `${GUARDA}# Primeira vez: instala o motor e pareia com o convite (vale até ${new Date(o.expiraEm).toISOString()}).
while [ "$(date +%s)" -lt ${ate} ]; do
  curl -fsSL '${o.servidor}/motor?convite=${o.convite}' | sh && [ -f ${CONEXAO_DO_MOTOR} ] && exit 0
  sleep 20
done
exit 1
`;
}

/** `nod-<pessoa>-<4hex>`: 6–30 caracteres, minúsculas, começa com letra (regra do Resource Manager). */
export function nomeDoProjeto(pessoaId: string, hex4: string): string {
  const pessoa = pessoaId.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
  return `nod-${pessoa}-${hex4.toLowerCase().slice(0, 4)}`;
}

/** `nod-<hash8>`: o id da conta de serviço (6–30, minúsculas). O hash vem de fora: o domínio não usa node:crypto. */
export function idDaContaDeServico(hash8: string): string {
  return `nod-${hash8.toLowerCase().slice(0, 8)}`;
}

/** Nome válido de instância na Compute (RFC1035, até 63). */
export function nomeDeInstanciaValido(nome: string): boolean {
  return /^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$/.test(nome);
}

export function nomeDeRecurso(ref: RefInstancia): string {
  return `projects/${ref.projeto}/zones/${ref.zona}/instances/${ref.nome}`;
}

/** Condição do papel de gerenciar: só instâncias do nod (prefixo de nome) na zona. O rótulo é só identificação. */
export function condicaoGerenciar(projeto: string, zona: string): string {
  return `resource.name.startsWith("projects/${projeto}/zones/${zona}/instances/${PREFIXO_INSTANCIA_NOD}")`;
}

/**
 * Condição do papel de gerenciar no preparo, quando a zona ainda não é conhecida: qualquer zona do projeto, só instâncias
 * (e o disco de boot, que nasce com o nome da instância) com o prefixo do nod. `extract` devolve "" quando o trecho não
 * aparece, e "" não começa com o prefixo.
 */
export function condicaoGerenciarProjeto(projeto: string): string {
  const zonas = `projects/${projeto}/zones/`;
  return (
    `resource.name.startsWith("${zonas}") && (` +
    `resource.name.extract("/instances/{nome}").startsWith("${PREFIXO_INSTANCIA_NOD}") || ` +
    `resource.name.extract("/disks/{nome}").startsWith("${PREFIXO_INSTANCIA_NOD}"))`
  );
}

/** Condição do papel de ligar: o nome exato da VM que a pessoa conectou. Sem delete. */
export function condicaoLigar(ref: RefInstancia): string {
  return `resource.name == "${nomeDeRecurso(ref)}"`;
}

/**
 * NOD-92 (revisão B6): a condição do papel de ler/rede. A sub-rede só a do nod (a rede automática cria uma
 * `nod-maquinas` em cada região), e as operações do projeto (zona e região). A imagem pública (debian-cloud) não passa
 * por este vínculo: o Google libera a leitura a qualquer conta.
 */
export function condicaoLerProjeto(projeto: string): string {
  return (
    `resource.name.startsWith("projects/${projeto}/") && (` +
    `resource.name.extract("/subnetworks/{nome}") == "${REDE_NOD}" || ` +
    `resource.name.extract("/operations/{op}") != "")`
  );
}

/** As permissões de cada papel customizado (todos vão com condição: gerenciar e ler pelo nome, ligar pela VM). */
export const PERMISSOES_DOS_PAPEIS = {
  [PAPEL_GERENCIAR]: [
    "compute.instances.create",
    "compute.instances.delete",
    "compute.instances.get",
    "compute.instances.start",
    "compute.instances.stop",
    "compute.instances.reset",
    "compute.instances.setMetadata",
    "compute.instances.setLabels",
    "compute.disks.create",
    // NOD-92 (revisão B6): o disco é usado na criação da VM; com a condição do prefixo, só os discos do nod.
    "compute.disks.use",
  ],
  [PAPEL_LIGAR]: ["compute.instances.get", "compute.instances.start", "compute.instances.stop", "compute.instances.reset"],
  [PAPEL_LER]: [
    "compute.zoneOperations.get",
    "compute.regionOperations.get",
    "compute.subnetworks.use",
    // A VM criada tem IP externo (accessConfigs ONE_TO_ONE_NAT): sem isto o instances.insert dá 403 (plano da NOD-92).
    "compute.subnetworks.useExternalIp",
    "compute.subnetworks.get",
    "compute.images.useReadOnly",
  ],
} as const;
