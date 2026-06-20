const { signToken, verifyToken } = require('./auth');
const token = signToken({ id: 'u1', role: 'admin' });
const payload = verifyToken(token);
if (payload.id !== 'u1') throw new Error('id missing');
let rejected = false;
try { verifyToken(token + 'x'); } catch { rejected = true; }
if (!rejected) throw new Error('invalid token accepted');
