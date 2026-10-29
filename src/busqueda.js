import { db } from './db.js';
import { normalizar } from './normalizar.js';

const TIPOS = { apunte: 'apunte apuntes clase', examen: 'examen examenes', resumen: 'resumen resumenes', practica: 'practica practicas ejercicios' };

// Todo lo que el buscador debería encontrar, normalizado sin tildes:
// "calculo" encuentra "Cálculo", "C1" encuentra Cálculo 1, "final 2025" encuentra el final de 2025.
export function textoBusqueda({ titulo, descripcion, materiaId, tipo, periodo, anio }) {
  const m = db.prepare('SELECT nombre, sigla, alias FROM materias WHERE id = ?').get(materiaId);
  const alias = m ? JSON.parse(m.alias).join(' ') : '';
  return normalizar([titulo, descripcion, m?.nombre, m?.sigla, alias, TIPOS[tipo], periodo, anio].filter(Boolean).join(' '));
}
