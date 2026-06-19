import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as portfinder from 'portfinder';
import { ProcessRunner, ProcessRunnerEvents } from '../../services/ProcessRunner';

export interface JsonResponse {
    status: number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    body: any;
}

/**
 * Minimal JSON-over-HTTP helper used to talk to the local Appium server.
 *
 * We use Node's built-in `http` (not the global `fetch`) on purpose: this repo
 * pins `@types/node@12`, where `fetch` is not part of the type definitions.
 */
export function requestJson(
    method: string,
    url: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    body?: any,
    timeoutMs = 30000,
): Promise<JsonResponse> {
    return new Promise<JsonResponse>((resolve, reject) => {
        const parsed = new URL(url);
        const payload = body !== undefined ? Buffer.from(JSON.stringify(body)) : undefined;
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: `${parsed.pathname}${parsed.search}`,
                method,
                headers: payload
                    ? { 'content-type': 'application/json', 'content-length': payload.length }
                    : {},
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => {
                    const text = Buffer.concat(chunks).toString('utf8');
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    let parsedBody: any;
                    try {
                        parsedBody = text ? JSON.parse(text) : undefined;
                    } catch (e) {
                        parsedBody = undefined;
                    }
                    resolve({ status: res.statusCode || 0, body: parsedBody });
                });
            },
        );
        req.on('error', reject);
        req.setTimeout(timeoutMs, () => {
            req.destroy(new Error(`Request timeout: ${method} ${url}`));
        });
        if (payload) {
            req.write(payload);
        }
        req.end();
    });
}

/**
 * Spawns and supervises a single modern Appium server as a child process and
 * exposes its base URL. One server hosts N sessions (one per device); the
 * per-device sessions live in `WdaRunner`.
 *
 * Configuration via env:
 *   APPIUM_BIN   - path/command for the appium binary (default: `appium` on PATH).
 *                  For a fully self-contained install point this at the bundled copy.
 *   APPIUM_PORT  - fixed port (default: a free port chosen by portfinder).
 *   APPIUM_HOME  - inherited from the environment; selects where Appium loads its
 *                  drivers from (defaults to ~/.appium where xcuitest is installed).
 */
export class AppiumRunner extends ProcessRunner<ProcessRunnerEvents> {
    private static instance?: AppiumRunner;

    public static getInstance(): AppiumRunner {
        if (!AppiumRunner.instance) {
            AppiumRunner.instance = new AppiumRunner();
        }
        return AppiumRunner.instance;
    }

    public static hasInstance(): boolean {
        return !!AppiumRunner.instance;
    }

    protected TAG = '[AppiumRunner]';
    protected name = '[AppiumRunner]';
    protected detached = true;
    private host = '127.0.0.1';
    private port = 0;
    private baseUrl = '';
    private ready = false;
    private readyPromise?: Promise<string>;
    private exitHookInstalled = false;

    private constructor() {
        super();
        const resolved = AppiumRunner.resolveBin();
        this.cmd = resolved.cmd;
        if (resolved.home) {
            this.env = { ...process.env, APPIUM_HOME: resolved.home };
        }
    }

    /**
     * Decide which appium binary to run and which APPIUM_HOME (driver store) to use.
     * Order of preference, degrading gracefully across install states:
     *   1. APPIUM_BIN / APPIUM_HOME env overrides.
     *   2. Bundled appium in node_modules + the project-local ./.appium-home populated
     *      by the postinstall step (fully self-contained — nothing global required).
     *   3. `appium` from PATH + the default ~/.appium (the developer's global install).
     *
     * Uses fs/path only (no `require('appium')`) so webpack/nodeExternals don't try to
     * resolve appium at build time.
     */
    private static resolveBin(): { cmd: string; home?: string } {
        if (process.env.APPIUM_BIN) {
            return { cmd: process.env.APPIUM_BIN, home: process.env.APPIUM_HOME };
        }
        // `npm start` runs from dist/, dev runs from the project root — check both.
        const roots = [process.cwd(), path.resolve(process.cwd(), '..')];
        for (const root of roots) {
            const bin = path.join(root, 'node_modules', '.bin', 'appium');
            if (fs.existsSync(bin)) {
                const localHome = path.join(root, '.appium-home');
                const home = process.env.APPIUM_HOME || (fs.existsSync(localHome) ? localHome : undefined);
                return { cmd: bin, home };
            }
        }
        return { cmd: 'appium', home: process.env.APPIUM_HOME };
    }

    public getBaseUrl(): string {
        return this.baseUrl;
    }

    protected async getArgs(): Promise<string[]> {
        this.port = process.env.APPIUM_PORT
            ? parseInt(process.env.APPIUM_PORT, 10)
            : await portfinder.getPortPromise();
        this.baseUrl = `http://${this.host}:${this.port}`;
        // Appium emits the detailed xcodebuild / WDA build output (enabled via the
        // `showXcodeLog` capability) at debug level. At 'warn' it is suppressed — so under
        // WS_SCRCPY_DEBUG bump to 'debug' to actually see signing/build errors.
        const logLevel = process.env.APPIUM_LOG_LEVEL || (process.env.WS_SCRCPY_DEBUG ? 'debug' : 'warn');
        return ['--port', String(this.port), '--address', this.host, '--base-path', '/', '--log-level', logLevel];
    }

    public async start(): Promise<void> {
        if (!this.readyPromise) {
            this.readyPromise = this.doStart();
        }
        // Non-fatal: never reject from start() so video and the rest of the server keep running
        // even if Appium (and therefore device control) is unavailable.
        await this.readyPromise.catch((e: Error) => {
            console.error(`${this.name} failed to start Appium: ${e.message}`);
        });
    }

    private async doStart(): Promise<string> {
        await this.runProcess();
        if (process.env.WS_SCRCPY_DEBUG) {
            this.on('stdout', (data) => process.stdout.write(`${this.name}[appium] ${data}`));
            this.on('stderr', (data) => process.stderr.write(`${this.name}[appium] ${String(data)}`));
        }
        if (!this.exitHookInstalled) {
            this.exitHookInstalled = true;
            // Backstop: if the process goes down without release() (uncaught error etc.),
            // still take the whole appium subtree with us.
            process.once('exit', () => {
                const pid = this.proc?.pid;
                if (pid) {
                    AppiumRunner.killGroup(pid, 'SIGKILL');
                }
            });
        }
        await this.waitUntilReady();
        this.ready = true;
        console.log(`${this.name} ready at ${this.baseUrl}`);
        return this.baseUrl;
    }

    private async waitUntilReady(timeoutMs = 60000): Promise<void> {
        const deadline = Date.now() + timeoutMs;
        let lastError = 'unknown';
        while (Date.now() < deadline) {
            try {
                const { status, body } = await requestJson('GET', `${this.baseUrl}/status`, undefined, 5000);
                if (status === 200 && body && body.value) {
                    return;
                }
                lastError = `HTTP ${status}`;
            } catch (e) {
                lastError = (e as Error).message;
            }
            await new Promise((resolve) => setTimeout(resolve, 500));
        }
        throw new Error(`Appium did not become ready within ${timeoutMs}ms (last: ${lastError})`);
    }

    /**
     * Resolves the Appium base URL once the server is reachable. Used by WdaRunner
     * before creating a session. Triggers a (lazy) start if it has not begun yet.
     */
    public async whenReady(): Promise<string> {
        if (this.ready) {
            return this.baseUrl;
        }
        if (!this.readyPromise) {
            this.readyPromise = this.doStart();
        }
        return this.readyPromise;
    }

    public isStarted(): boolean {
        return this.ready;
    }

    private static killGroup(pid: number, signal: NodeJS.Signals): void {
        try {
            // Negative pid => signal the whole process group (appium + xcodebuild + ...).
            process.kill(-pid, signal);
        } catch (e) {
            try {
                process.kill(pid, signal);
            } catch (e2) {
                /* already gone */
            }
        }
    }

    public release(): void {
        const pid = this.proc?.pid;
        this.proc = undefined;
        this.ready = false;
        this.readyPromise = undefined;
        AppiumRunner.instance = undefined;
        if (!pid) {
            return;
        }
        // Graceful first: SIGTERM lets Appium tear down its sessions (and on-device WDA),
        // then SIGKILL the whole group as a fallback if it does not exit in time.
        AppiumRunner.killGroup(pid, 'SIGTERM');
        const timer = setTimeout(() => {
            AppiumRunner.killGroup(pid, 'SIGKILL');
        }, 5000);
        // Don't keep the event loop alive just for the fallback timer during shutdown.
        if (typeof (timer as { unref?: () => void }).unref === 'function') {
            (timer as { unref: () => void }).unref();
        }
    }
}
