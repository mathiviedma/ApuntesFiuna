// Cursos básicos (semestres 1 a 4) de la Malla 2023 de FIUNA para
// Ingeniería Civil (IC) e Ingeniería Electromecánica (IEM).
// Las materias que comparten ambas carreras aparecen una sola vez.
// `alias`: otras formas en que puede aparecer el nombre (siglas de la malla,
// abreviaturas, o como podría figurar en insweb).

export const CARRERAS = {
  civil: 'Ingeniería Civil',
  electromecanica: 'Ingeniería Electromecánica',
};

const AMBAS = ['civil', 'electromecanica'];

export const MATERIAS = [
  // 1er semestre
  { nombre: 'Mecánica y Calor', sigla: 'MyC', semestre: 1, carreras: AMBAS, alias: [] },
  { nombre: 'Cálculo 1', sigla: 'C1', semestre: 1, carreras: AMBAS, alias: [] },
  { nombre: 'Geometría Vectorial', sigla: 'GV', semestre: 1, carreras: AMBAS, alias: ['Geo Vect'] },
  { nombre: 'Álgebra Moderna', sigla: 'AM', semestre: 1, carreras: AMBAS, alias: [] },
  { nombre: 'Geometría Descriptiva', sigla: 'GD', semestre: 1, carreras: AMBAS, alias: ['Descriptiva'] },
  { nombre: 'Dibujo Técnico', sigla: 'DT', semestre: 1, carreras: AMBAS, alias: [] },
  // 2do semestre
  { nombre: 'Óptica y Ondas', sigla: 'OyO', semestre: 2, carreras: AMBAS, alias: [] },
  { nombre: 'Cálculo 2', sigla: 'C2', semestre: 2, carreras: AMBAS, alias: [] },
  { nombre: 'Álgebra Lineal', sigla: 'AL', semestre: 2, carreras: AMBAS, alias: [] },
  { nombre: 'Fundamentos de la Programación', sigla: 'FP', semestre: 2, carreras: AMBAS, alias: ['Fundamentos de Programacion'] },
  { nombre: 'Química General', sigla: 'QG', semestre: 2, carreras: AMBAS, alias: ['Quimica'] },
  // 3er semestre
  { nombre: 'Electricidad y Magnetismo', sigla: 'EyM', semestre: 3, carreras: AMBAS, alias: [] },
  { nombre: 'Ecuaciones Diferenciales', sigla: 'ED', semestre: 3, carreras: AMBAS, alias: [] },
  { nombre: 'Análisis Vectorial', sigla: 'AV', semestre: 3, carreras: AMBAS, alias: [] },
  { nombre: 'Probabilidad', sigla: 'Proba', semestre: 3, carreras: AMBAS, alias: [] },
  { nombre: 'Estática', sigla: 'Est', semestre: 3, carreras: AMBAS, alias: [] },
  { nombre: 'Ciencia y Tecnología de los Materiales', sigla: 'CyTM', semestre: 3, carreras: ['electromecanica'], alias: ['Ciencia y Tecno'] },
  { nombre: 'Materiales de Obras Civiles 1', sigla: 'MOC1', semestre: 3, carreras: ['civil'], alias: [] },
  { nombre: 'Geología Aplicada', sigla: 'GA', semestre: 3, carreras: ['civil'], alias: ['Geologia A'] },
  // 4to semestre
  { nombre: 'Dinámica', sigla: 'Din', semestre: 4, carreras: AMBAS, alias: [] },
  { nombre: 'Métodos Numéricos', sigla: 'MN', semestre: 4, carreras: AMBAS, alias: [] },
  { nombre: 'Mecánica de Materiales', sigla: 'MM', semestre: 4, carreras: AMBAS, alias: [] },
  { nombre: 'Estadística', sigla: 'Estad', semestre: 4, carreras: AMBAS, alias: [] },
  { nombre: 'Cálculo Avanzado', sigla: 'CA', semestre: 4, carreras: ['electromecanica'], alias: ['Calculo Av'] },
  { nombre: 'Análisis Estructural 1', sigla: 'AE1', semestre: 4, carreras: ['civil'], alias: [] },
  { nombre: 'Introducción a la Hidráulica', sigla: 'IH', semestre: 4, carreras: ['civil'], alias: ['Intro Hidr'] },
];
