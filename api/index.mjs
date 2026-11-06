// Função serverless do Vercel: toda requisição para /api/* é atendida pelo Express do backend.
// O backend é compilado para backend/dist no comando de build (veja vercel.json).
export { default } from '../backend/dist/vercel.js';
