import { spawn } from "node:child_process";

export const formatCaddyfile = (caddyfile: string): Promise<string> => new Promise((resolve, reject) => {
    var command = spawn('./node_modules/.bin/caddy', [ 'fmt', '-' ]);
    command.stdin.end(caddyfile);

    var result = '';
    command.stdout.on('data', data => {
        result += data.toString()
    });

    command.on('close', _ => resolve(result));
    command.on('error', reject);
});