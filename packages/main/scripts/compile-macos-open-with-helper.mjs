import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDirectoryPath = path.dirname(fileURLToPath(import.meta.url));
const packageDirectoryPath = path.resolve(scriptDirectoryPath, '..');
const helperSourcePath = path.join(packageDirectoryPath, 'resources', 'helpers', 'macos-sftp-open-with.swift');
const helperBinaryPath = path.join(packageDirectoryPath, 'resources', 'helpers', 'cosmosh-sftp-open-with');

if (process.platform !== 'darwin') {
  process.exit(0);
}

if (!existsSync(helperSourcePath)) {
  throw new Error(`Missing macOS SFTP Open With helper source: ${helperSourcePath}`);
}

execFileSync('/usr/bin/xcrun', ['swiftc', helperSourcePath, '-Osize', '-o', helperBinaryPath], {
  stdio: 'inherit',
});

chmodSync(helperBinaryPath, 0o755);
