import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { TextDecoder } from 'node:util';
import { Buffer } from 'node:buffer';

const revisao = bytes => createHash('sha256').update(bytes).digest('hex');
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

async function lerLimitado(caminho) {
  if ((await stat(caminho)).size > 2_097_152) throw new Error('arquivo_grande');
  const bytes = await readFile(caminho);
  if (bytes.length > 2_097_152) throw new Error('arquivo_grande');
  return bytes;
}

// definido em 2026-09-18: orçamento considera JSON escapado, preserva Unicode e fornece continuação verificável.
export async function lerTexto(caminho, inicio = 0, esperada) {
  if (!Number.isInteger(inicio) || inicio < 0 || (inicio > 0 && !esperada)) throw new Error('inicio_invalido');
  const bytes = await lerLimitado(caminho);
  const atual = revisao(bytes);
  if (esperada !== undefined && esperada !== atual) throw new Error('arquivo_alterado');
  const completo = decoder.decode(bytes);
  if (inicio > completo.length) throw new Error('inicio_invalido');
  let conteudo = '';
  let tamanho = 0;
  for (const caractere of completo.slice(inicio)) {
    const custo = JSON.stringify(caractere).length - 2;
    if (tamanho + custo > 5500) break;
    tamanho += custo;
    conteudo += caractere;
  }
  const fim = inicio + conteudo.length;
  return { texto: { conteudo, inicio, proximo: fim < completo.length ? fim : null, total: completo.length, revisao: atual } };
}

// definido em 2026-09-18: ações do computador são serializadas pelo gateway; revisão recusa sobrescrita baseada em leitura antiga.
export async function gravarTexto(caminho, texto, esperada) {
  if (typeof texto !== 'string' || texto.length > 131072 || (esperada !== 'novo' && !/^[a-f0-9]{64}$/.test(esperada))) throw new Error('entrada_invalida');
  const bytes = Buffer.from(texto, 'utf8');
  if (esperada === 'novo') {
    await writeFile(caminho, bytes, { flag: 'wx' });
  } else {
    if (revisao(await lerLimitado(caminho)) !== esperada) throw new Error('arquivo_alterado');
    await writeFile(caminho, bytes);
  }
  return { saida: 'Arquivo gravado.', revisao: revisao(bytes) };
}
