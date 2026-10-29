import crypto from 'node:crypto';

export function hashPassword(password) {
  const sal = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, sal, 64).toString('hex');
  return `${sal}:${hash}`;
}

export function verificarPassword(password, guardado) {
  const [sal, hash] = String(guardado).split(':');
  if (!sal || !hash) return false;
  const calc = crypto.scryptSync(password, sal, 64);
  const esperado = Buffer.from(hash, 'hex');
  return esperado.length === calc.length && crypto.timingSafeEqual(calc, esperado);
}

export function requiereLogin(req, res, next) {
  if (!req.session.usuarioId) return res.status(401).json({ error: 'Tenés que iniciar sesión.' });
  next();
}
