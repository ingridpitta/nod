// ADR-121 (NOD-92): a máquina na nuvem que dorme e acorda sozinha. Só tipos e `as const` (EMENDA 26).
// O servidor fala com a API do provedor; nunca disca para a VM (ADR-021). A VM é uma `maquina_tokens` comum
// (ADR-090) com uma linha `maquinas_nuvem` ao lado.

/** Estado da máquina na nuvem, do ponto de vista do nod. `adormecendo` é interno: a tela mostra "Dormindo". */
export const ESTADOS_MAQUINA_NUVEM = ["criando", "acordada", "adormecendo", "dormindo", "acordando", "falhou_ao_acordar", "excluida"] as const;
export type EstadoMaquinaNuvem = (typeof ESTADOS_MAQUINA_NUVEM)[number];

/** Por que a nuvem falhou, em código FECHADO (ADR-004). A frase que a pessoa lê sai da web, nunca do provedor. */
export const MOTIVOS_FALHA_NUVEM = ["credencial_nuvem", "cota_ou_cobranca", "sem_capacidade", "motor_sem_contato", "excluida"] as const;
export type MotivoFalhaNuvem = (typeof MOTIVOS_FALHA_NUVEM)[number];

/** O que o provedor diz da instância. */
export type EstadoInstancia = "provisionando" | "rodando" | "parando" | "parada" | "inexistente";

export type DesejoNuvem = "acordada" | "dormindo";

/** Onde a instância mora no provedor. */
export type RefInstancia = { projeto: string; zona: string; nome: string };

/** Minutos ociosa antes de dormir; `null` = Nunca dormir. */
export const DORMIR_APOS_MIN = [15, 30, 60, 120] as const;
export type DormirAposMin = (typeof DORMIR_APOS_MIN)[number];

export const TAMANHOS_MAQUINA_NUVEM = ["padrao", "menor"] as const;
export type TamanhoMaquinaNuvem = (typeof TAMANHOS_MAQUINA_NUVEM)[number];

/** Pedido de criação (PR 2). `requestId` é o mesmo em toda nova tentativa: o provedor devolve 409 em vez de duplicar. */
/** `maquinaNuvemId`: o id da linha em `maquinas_nuvem`, vai no rótulo `nod-maquina` da VM (achar a VM pelo nod no console). */
export type CriarInstancia = RefInstancia & { subrede: string; tamanho: TamanhoMaquinaNuvem; startupScript: string; maquinaNuvemId: string };

/** Erro do provedor já classificado. `detalhe` é um código curto (ex.: `org_bloqueia_chave`), nunca texto do provedor. */
export type ErroNuvem = { motivo: MotivoFalhaNuvem; detalhe?: string };

/**
 * A porta para o provedor, já com a credencial da pessoa (a conta de serviço do projeto dela). Todo método falha
 * lançando `ErroNuvemLancado` (src/domain/maquina-nuvem.ts), com o motivo fechado.
 */
export interface ProvedorNuvem {
  criar(req: CriarInstancia, requestId: string): Promise<void>;
  ligar(ref: RefInstancia): Promise<void>;
  desligar(ref: RefInstancia): Promise<void>;
  reiniciar(ref: RefInstancia): Promise<void>;
  excluir(ref: RefInstancia): Promise<void>;
  estado(ref: RefInstancia): Promise<EstadoInstancia>;
  /** PR 2: troca o `startup-script` da instância (depois do pareamento, só a guarda: o convite sai da metadata). */
  definirScript(ref: RefInstancia, script: string): Promise<void>;
}

/** A credencial guardada (cifrada) de uma conta de serviço; o adaptador monta o `ProvedorNuvem` com ela. */
export type CredencialNuvem = { id: string; provedor: "gcp"; projeto: string; contaServico: string };

/** Resultado do preparo idempotente do projeto da pessoa (OAuth, uma vez por conta). */
/** `chaveNome`: o nome da chave no Google (projects/…/keys/…), para apagar as outras no Reconectar. */
export type ContaPreparada = { projeto: string; contaServico: string; chaveJson: string; chaveNome: string };

/**
 * A conta da pessoa no provedor, com o token do OAuth (só na memória, `access_type=online`). Prepara o projeto:
 * cria, vincula o faturamento, ativa a Compute, cria a rede e a conta de serviço com os papéis por nome.
 */
export interface ContaNuvem {
  preparar(p: { pessoaId: string; tokenAcesso: string; projetoExistente?: string | null }): Promise<ContaPreparada>;
  /** Dá à conta de serviço o papel de ligar/desligar UMA instância que a pessoa já tem (Conectar). */
  autorizarInstancia(p: { tokenAcesso: string; projeto: string; contaServico: string; ref: RefInstancia }): Promise<void>;
  /** Apaga as chaves da conta de serviço que não são `manter` (a chave velha do Reconectar). Devolve quantas. */
  apagarOutrasChaves(p: { tokenAcesso: string; projeto: string; contaServico: string; manter: string }): Promise<number>;
}

/** O que a tela recebe em `MaquinaDto.nuvem` (só com a flag ligada). */
export type MaquinaNuvemDto = {
  provedor: "gcp";
  /** `adormecendo` sai como `dormindo`. */
  estado: Exclude<EstadoMaquinaNuvem, "adormecendo">;
  motivo: MotivoFalhaNuvem | null;
  criadaPeloNod: boolean;
  zona: string;
  dormirAposMin: DormirAposMin | null;
  estadoDesde: number;
};

/** `GET /api/nuvem/conta`. */
export type ContaNuvemDto = {
  conectada: boolean;
  projeto: string | null;
  preparando: boolean;
  motivo: MotivoFalhaNuvem | null;
  detalhe: string | null;
  /** PR 2: as VMs que o nod está criando e que ainda não parearam (sem `maquinaId`, não aparecem em `GET /maquinas`). */
  criando?: MaquinaCriandoDto[];
};

/** Uma VM criada pelo nod antes do pareamento (ou que falhou antes dele). */
export type MaquinaCriandoDto = { id: string; nome: string; zona: string; tamanho: TamanhoMaquinaNuvem | null; estado: "criando" | "falhou_ao_acordar"; motivo: MotivoFalhaNuvem | null; estadoDesde: number };
