// Normalización de texto para búsqueda y para comparar nombres de materias.
// "Cálculo II" -> "calculo 2", "ÁLGEBRA  LINEAL." -> "algebra lineal"

const ROMANOS = { i: '1', ii: '2', iii: '3', iv: '4', v: '5' };

export function normalizar(texto = '') {
  return String(texto)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita tildes
    .toLowerCase()
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function normalizarMateria(nombre = '') {
  return normalizar(nombre)
    .split(' ')
    .map((p) => ROMANOS[p] ?? p)
    .join(' ');
}

export function palabras(texto = '') {
  return normalizar(texto).split(' ').filter(Boolean);
}
