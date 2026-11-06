// Prepara o projeto: cria o .env, sobe o PostgreSQL local (Docker), instala dependências e aplica as migrations.
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';

const run = (cmd) => {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
};
const has = (cmd) => {
  try {
    execSync(cmd, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

if (!existsSync('backend/.env')) {
  copyFileSync('backend/.env.example', 'backend/.env');
  console.log('Criado backend/.env a partir de backend/.env.example');
}

if (has('docker compose version')) {
  run('docker compose up -d --wait');
} else {
  console.warn(
    '\nDocker não encontrado. Use um PostgreSQL próprio (local ou um banco gratuito do Neon)\n' +
      'e ajuste DATABASE_URL e DATABASE_URL_UNPOOLED em backend/.env antes de continuar.',
  );
}

run('npm ci --prefix backend');
run('npm ci --prefix frontend');
run('npm run db:deploy --prefix backend');
console.log('\nPronto! Rode "npm run dev" e abra http://localhost:4200');
