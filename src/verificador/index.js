// Verificación del requisito para ser tutor:
//   En "Notas finales" de insweb debe existir AL MENOS UNA nota 4 o 5 en la materia.
//   Otras filas de la misma materia (p. ej. un 1 por aplazo) NO excluyen.
//
// El origen de las notas es intercambiable:
//   - simulado: lee data/insweb-simulado.json (para la demo, sin red)
//   - insweb:   inicia sesión en insweb.ing.una.py con Playwright y lee la tabla
// Las credenciales de insweb nunca se guardan ni se escriben en logs.

import crypto from 'node:crypto';
import { config } from '../config.js';
import { normalizarMateria } from '../normalizar.js';

export class ErrorVerificacion extends Error {
  constructor(mensaje, codigo = 'error') {
    super(mensaje);
    this.codigo = codigo; // 'credenciales' | 'sin_tabla' | 'timeout' | 'no_disponible' | 'error'
  }
}

async function cargarFuente() {
  if (config.verificador === 'insweb') return (await import('./insweb.js')).obtenerNotasFinales;
  return (await import('./simulado.js')).obtenerNotasFinales;
}

/** Devuelve [{ materia: string, nota: number|null }] tal como figuran en Notas finales. */
export async function obtenerNotasFinales(credenciales) {
  const fuente = await cargarFuente();
  // En Vercel la función muere a los 60 s con un 504 mudo: cortamos antes para dar un mensaje claro.
  const limiteMs = config.verificador === 'insweb' && process.env.VERCEL ? 50000 : 0;
  if (!limiteMs) return fuente(credenciales);
  let reloj;
  const limite = new Promise((_, rechazar) => {
    reloj = setTimeout(
      () => rechazar(new ErrorVerificacion('insweb tardó demasiado en responder. Probá de nuevo en unos minutos.', 'timeout')),
      limiteMs,
    );
  });
  try {
    return await Promise.race([fuente(credenciales), limite]);
  } finally {
    clearTimeout(reloj);
  }
}

/** Nombres aceptados para una materia del catálogo (nombre + alias), normalizados. */
function nombresDe(materia) {
  const alias = Array.isArray(materia.alias) ? materia.alias : JSON.parse(materia.alias || '[]');
  return new Set([materia.nombre, ...alias].map(normalizarMateria));
}

/**
 * Aplica la regla a una materia.
 * @returns {{ cumple: boolean, nota: number|null, intentos: number[], detalle: string }}
 */
export function evaluarMateria(notas, materia) {
  const aceptados = nombresDe(materia);
  const intentos = notas
    .filter((n) => aceptados.has(normalizarMateria(n.materia)))
    .map((n) => n.nota)
    .filter((n) => Number.isInteger(n));

  if (intentos.length === 0) {
    const leidas = new Set(notas.map((n) => normalizarMateria(n.materia))).size;
    return {
      cumple: false,
      nota: null,
      intentos,
      detalle: `"${materia.nombre}" no figura entre las ${leidas} materias de tus notas finales.`,
    };
  }
  const mejor = Math.max(...intentos);
  if (mejor >= 4) {
    const extra = intentos.length > 1 ? ` (${intentos.length} registros: ${intentos.join(', ')})` : '';
    return { cumple: true, nota: mejor, intentos, detalle: `Nota ${mejor} encontrada${extra}.` };
  }
  return {
    cumple: false,
    nota: null,
    intentos,
    detalle: `Se requiere 4 o 5; la nota más alta registrada es ${mejor}.`,
  };
}

/** Identificador estable y no reversible del usuario de insweb (para evitar que dos cuentas usen el mismo). */
export function idInsweb(usuario) {
  return crypto.createHash('sha256').update(`insweb:${String(usuario).trim().toLowerCase()}`).digest('hex');
}
