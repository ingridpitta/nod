import type { AmbienteBancoDto } from "../../../contracts/api.ts";
import type { Rota } from "../roteador.ts";

function portaDoBanco(url: string | undefined): number | null {
  if (!url) return null;
  try {
    const lida = new URL(url);
    if (lida.protocol !== "postgres:" && lida.protocol !== "postgresql:") return null;
    return Number(lida.port || "5432");
  } catch {
    return null;
  }
}

function bancoLocal(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    return host === "127.0.0.1" || host === "localhost";
  } catch {
    return false;
  }
}

export function ambienteDoBanco(env: NodeJS.ProcessEnv): AmbienteBancoDto {
  const porta = portaDoBanco(env.DATABASE_URL);
  const declarado = env.NOD_BANCO_AMBIENTE;
  if (declarado === "persistente" || declarado === "efemero") return { regime: declarado, porta };

  return { regime: bancoLocal(env.DATABASE_URL) && porta === 5434 ? "persistente" : "desconhecido", porta };
}

export function criarRotaAmbiente(env: NodeJS.ProcessEnv): Rota {
  const ambiente = ambienteDoBanco(env);
  return {
    metodo: "GET",
    padrao: /^\/ambiente$/,
    async handler(ctx) {
      ctx.json(200, ambiente);
    },
  };
}
