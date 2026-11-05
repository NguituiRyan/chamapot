import { spawnSync } from 'node:child_process';

/** The shared admin helper is server-only; enable its Node react-server export for CLI use. */
export function runScript(main: () => Promise<void>) {
  if (!process.execArgv.includes('--conditions=react-server')) {
    const child = spawnSync(process.execPath, ['--conditions=react-server', '--import', 'tsx', process.argv[1], ...process.argv.slice(2)], { stdio: 'inherit', env: process.env, windowsHide: true });
    if (child.error) console.error(child.error.message);
    process.exit(child.status ?? 1);
  }
  main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
