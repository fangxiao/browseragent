// 根据当前 package.json 版本生成标准 Chromium updates.xml 自动更新元数据文件
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const pkgPath = path.join(rootDir, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
const version = pkg.version || '0.2.0';

// 可通过环境变量或命令行参数指定自建下载站域名与扩展 ID
const appId = process.env.CRX_APP_ID || 'ai_browser_agent_extension_id';
const crxBaseUrl = process.env.CRX_BASE_URL || 'https://releases.yourdomain.com/downloads';
const crxUrl = `${crxBaseUrl}/ai-browser-agent-${version}.crx`;

const xmlContent = `<?xml version='1.0' encoding='UTF-8'?>
<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>
  <app appid='${appId}'>
    <updatecheck codebase='${crxUrl}' version='${version}' />
  </app>
</gupdate>
`;

const outputDir = path.join(rootDir, 'output');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

const outputPath = path.join(outputDir, 'updates.xml');
fs.writeFileSync(outputPath, xmlContent, 'utf-8');

console.log(`✅ [Update XML] 已为 v${version} 生成标准 Chromium 自动更新文件: ${outputPath}`);
console.log(`   - AppID: ${appId}`);
console.log(`   - CRX URL: ${crxUrl}`);
