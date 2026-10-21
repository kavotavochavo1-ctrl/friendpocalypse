const fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const COMMIT = '0acde0c2a1683f012622eae96c562fd632b34203';
const SHA256 = 'eb17909a76668cf9ae0b92a618a34a50f6c73d3a6787cb4dd8ce36a8b10bfb75';
const URL = `https://raw.githubusercontent.com/alexanderthurn/steam-electron-build/${COMMIT}/steamworks_sdk/redistributable_bin/win64/steam_api64.dll`;
(async () => {
  const file = path.resolve(__dirname, '../vendor/steamworks_sdk/redistributable_bin/win64/steam_api64.dll');
  let bytes; try { bytes = await fs.readFile(file); } catch {
    const response = await fetch(URL); if (!response.ok) throw Error(`Steam DLL download: ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== SHA256) throw Error('Steam DLL checksum mismatch');
  await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, bytes);
  if (process.platform === 'win32') {
    const verifyEnv = { ...process.env, FP_VERIFY_DLL: file }; delete verifyEnv.PSModulePath;
    const args = ['-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference='Stop'; $s=Get-AuthenticodeSignature -LiteralPath $env:FP_VERIFY_DLL; if($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notmatch 'O=Valve Corp\\.') { exit 1 }; Write-Output $s.SignerCertificate.Subject"];
    let check = spawnSync('pwsh.exe', args, { env: verifyEnv, encoding: 'utf8', windowsHide: true });
    if (check.error?.code === 'ENOENT') check = spawnSync('powershell.exe', args, { env: verifyEnv, encoding: 'utf8', windowsHide: true });
    if (check.status !== 0) throw Error('Steam DLL must have a valid Valve signature: ' + check.stderr);
    console.log(check.stdout.trim());
  }
  console.log('Steam DLL SHA256 verified:', SHA256);
})().catch(e => { console.error(e.message); process.exitCode = 1; });
