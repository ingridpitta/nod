import type { CodigoCifrado } from "./contas-ia.ts";

/**
 * NOD-94 (emenda 11 da ADR-090): a instalação da máquina "só computador" por SSH, feita por OUTRA máquina da pessoa (a
 * instaladora: um motor Linux ou o Mac). O servidor nunca disca (ADR-021): ele guarda o pedido em memória, entrega a
 * credencial cifrada UMA vez à instaladora e ouve o progresso.
 *
 *   tela: POST /maquinas/ssh ──► pedido `esperando` com a chave pública da instaladora
 *   tela: POST /maquinas/ssh/:id/credencial {cifrado} (RSA-OAEP + AES-GCM, ADR-102) — no modo apelido, nada
 *   instaladora: POST /ponte/:id/instalacoes ──► o pedido com o cifrado (uma vez) → `conferindo`
 *   instaladora: POST /ponte/:id/instalacoes/progresso {etapa | erro} → `instalando` → `pareando`
 *   máquina nova: pareia com o convite do pedido (papel computador, aprovação automática) → `pronta`
 */
export const METODOS_SSH = ["chave", "senha", "apelido"] as const;
export type MetodoSsh = (typeof METODOS_SSH)[number];

export const ESTADOS_INSTALACAO = ["esperando", "conferindo", "instalando", "pareando", "pronta", "erro", "cancelada"] as const;
export type EstadoInstalacao = (typeof ESTADOS_INSTALACAO)[number];
export const ESTADOS_INSTALACAO_FINAIS: readonly EstadoInstalacao[] = ["pronta", "erro", "cancelada"];

/**
 * As etapas do script de instalação (as linhas `NOD-ETAPA:<id>`, ETAPAS_DO_SCRIPT em motor-instalacao.ts — um teste
 * confere que são as mesmas). `pareamento` põe o pedido em `pareando`; as outras, em `instalando`.
 */
export const ETAPAS_INSTALACAO = ["conferencia", "pacotes", "node", "usuario", "motor", "servico", "pareamento", "pronta"] as const;
export type EtapaInstalacao = (typeof ETAPAS_INSTALACAO)[number];

/**
 * Os motivos de erro (tabela da seção 5 do plano). Os quatro do script (`NOD-ERRO:<motivo>`) mais os do SSH, os do
 * servidor (`nao_pareou`: o pedido venceu sem parear, ou a instaladora reiniciou e perdeu o par de chaves;
 * `tempo_esgotado`: a credencial não chegou ou a instaladora não respondeu no prazo).
 */
export const MOTIVOS_INSTALACAO = [
  "ssh_sem_rota", "ssh_recusou_login", "frase_senha_errada", "chave_do_servidor_mudou",
  "so_nao_suportado", "sem_sudo", "sem_saida_para_o_nod", "instalacao_falhou", "nao_pareou", "tempo_esgotado",
] as const;
export type MotivoInstalacao = (typeof MOTIVOS_INSTALACAO)[number];

/** O que a tela vê de um pedido. Nunca leva a credencial (nem cifrada) nem o convite. */
export type InstalacaoSshDto = {
  id: string;
  origemId: string;
  host: string;
  porta: number;
  usuario: string;
  metodo: MetodoSsh;
  estado: EstadoInstalacao;
  etapa: EtapaInstalacao | null;
  motivo: MotivoInstalacao | null;
  /** `chave_do_servidor_mudou`: a guardada e a que a máquina mostrou agora ("Confiar na nova"). */
  impressoes: { antiga: string; nova: string } | null;
  /** `instalacao_falhou`: as últimas linhas do script (no máximo 20), já sem segredo — a instaladora filtra. */
  linhas: string[];
  /** A máquina que pareou (`pronta`). */
  maquinaId: string | null;
  /** A tela ainda precisa mandar a credencial (estado `esperando` e método diferente de `apelido`). */
  pedeCredencial: boolean;
  expiraEm: number;
  atualizadoEm: number;
};

/** `POST /maquinas/ssh` → 201. `chavePublica`: a da instaladora (SPKI base64), para a tela cifrar a credencial. */
export type InstalacaoCriadaDto = { id: string; origemId: string; chavePublica: string; expiraEm: number };

/**
 * O que a instaladora recebe na puxada. `cifrado` sai uma vez só (e some do servidor); `cancelado: true` avisa (uma vez)
 * que a pessoa cancelou o pedido em andamento. `impressaoConhecida`: a host key guardada do endereço (reinstalação
 * com StrictHostKeyChecking=yes); null = primeira vez. `servidor`: o endereço do nod que a máquina nova alcança (o
 * NOD_URL_PUBLICA); null = a instaladora usa a origem a que ela está pareada (NOD-344: nunca o header `Host`).
 */
export type PedidoDeInstalacao = {
  id: string;
  host: string;
  porta: number;
  usuario: string;
  metodo: MetodoSsh;
  impressaoConhecida: string | null;
  convite: string;
  servidor: string | null;
  cifrado?: CodigoCifrado;
  cancelado?: true;
};

/**
 * O que a tela cifra (JSON, ADR-102) para a instaladora. Método `chave`: `chave` (a privada, OpenSSH ou PEM) e `frase`
 * se ela tiver. Método `senha`: `senha`. `sudo`: a senha do sudo quando ele pede uma — ausente no método senha = a
 * própria senha do login. Nenhum campo tem quebra de linha, exceto `chave`.
 */
export type CredencialSsh = { chave?: string; frase?: string; senha?: string; sudo?: string };

/**
 * O progresso relatado pela instaladora: `etapa` ou `erro`. `conferencia` = conectou e roda a conferência; `pronta` = o
 * script terminou (o pedido fica `pareando` até a máquina nova parear, ou já é `pronta` se ela pareou antes).
 * `impressao`: a host key que a máquina mostrou (no erro `chave_do_servidor_mudou`, é a nova).
 */
export type ProgressoDeInstalacao = {
  id: string;
  etapa?: EtapaInstalacao;
  erro?: MotivoInstalacao;
  impressao?: string;
  linhas?: string[];
};
