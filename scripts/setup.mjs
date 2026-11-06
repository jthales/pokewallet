// Prepara o projeto: instala dependências, cria o .env e aplica as migrations do banco.
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';

const run = (cmd) => {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
};

if (!existsSync('backend/.env')) {
  copyFileSync('backend/.env.example', 'backend/.env');
  console.log('Criado backend/.env a partir de backend/.env.example');
}
run('npm ci --prefix backend');
run('npm ci --prefix frontend');
run('npm run db:deploy --prefix backend');
console.log('\nPronto! Rode "npm run dev" e abra http://localhost:4200');
