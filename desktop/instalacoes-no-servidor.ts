import { iniciarInstaladora, type DepsInstaladora, type Instaladora, type PonteDeInstalacoes } from "../src/shared/instaladora.ts";
import { sistemaDeVerdade } from "../src/shared/instalador-ssh.ts";

/**
 * NOD-94 (emenda 11 da ADR-090): o app do Mac como instaladora por SSH — no molde de `contas-no-servidor.ts`, sem
 * Electron (o main.ts injeta a ponte e o ambiente). Puxa os pedidos a cada 3 s com a chave pública de um par que vive
 * só na memória do app; a credencial chega cifrada e só é decifrada aqui, durante a instalação.
 *
 * O modo apelido é só daqui: `ssh -o BatchMode=yes <apelido>` com o ~/.ssh/config, o agente e o chaveiro deste Mac —
 * por isso o ambiente é o do shell de login (o mesmo dos drivers, ADR-088), onde vive o SSH_AUTH_SOCK que a pessoa usa
 * (o do launchd ou o de um agente como o do 1Password). Nenhum segredo passa pelo nod nesse modo.
 */
export type DepsInstalacoesNoServidor = {
  ponte: PonteDeInstalacoes;
  /** O ambiente do shell de login (cfg.env). */
  env: Readonly<Record<string, string | undefined>>;
  agendar(fn: () => void, ms: number): { cancelar(): void };
  /** Injetáveis nos testes. */
  sistema?: DepsInstaladora["sistema"];
  instalar?: DepsInstaladora["instalar"];
  par?: DepsInstaladora["par"];
  /** NOD-344: a origem do servidor da conexão (o script de instalação nunca vem do `Host` de quem pediu). */
  servidor: string;
};

export function iniciarInstalacoesNoServidor(d: DepsInstalacoesNoServidor): Instaladora {
  return iniciarInstaladora({
    ponte: d.ponte,
    sistema: d.sistema ?? sistemaDeVerdade(ambienteDoSsh(d.env)),
    agendar: d.agendar,
    servidor: d.servidor,
    ...(d.instalar ? { instalar: d.instalar } : {}),
    ...(d.par ? { par: d.par } : {}),
  });
}

/**
 * O ambiente que o ssh do Mac vê. O PATH do shell de login pode não ter /usr/bin na frente (um ssh do Homebrew vale,
 * é OpenSSH); sem PATH nenhum, o do sistema. HOME é obrigatório no modo apelido (o ~/.ssh/config).
 */
export function ambienteDoSsh(env: Readonly<Record<string, string | undefined>>): Record<string, string | undefined> {
  const base = "/usr/bin:/bin:/usr/sbin:/sbin";
  return { ...env, PATH: env.PATH ? `${env.PATH}:${base}` : base };
}
