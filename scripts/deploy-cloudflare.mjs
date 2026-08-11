// 一键部署：将本地 dist 直传部署到 Cloudflare Pages 项目 ox（ox.ninkoro.com）
// 用法：
//   npm install --no-save wrangler@4
//   $env:CLOUDFLARE_API_TOKEN='<token>'
//   $env:CLOUDFLARE_ACCOUNT_ID='1f2fcea04028e028fabc64836ae5dd9c'
//   node scripts/deploy-cloudflare.mjs
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

if (!process.env.CLOUDFLARE_API_TOKEN) {
  console.error('缺少 CLOUDFLARE_API_TOKEN 环境变量');
  process.exit(1);
}

const bin = join(
  process.cwd(),
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler',
);
if (!existsSync(bin)) {
  console.error('未找到 wrangler，请先执行：npm install --no-save wrangler@4');
  process.exit(1);
}

execSync(
  `"${bin}" pages deploy dist --project-name=ox --branch=main --commit-dirty=true`,
  { stdio: 'inherit', env: process.env },
);
