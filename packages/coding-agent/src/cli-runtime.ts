import { APP_NAME } from "./config.ts";
import { configureHttpDispatcher } from "./core/http-dispatcher.ts";
import { type MainOptions, main } from "./main.ts";

/** Run the standard Pi CLI lifecycle from an embedded host executable. */
export function runCli(args: string[], options?: MainOptions): Promise<void> {
	process.title = APP_NAME;
	process.env.PI_CODING_AGENT = "true";
	process.emitWarning = (() => {}) as typeof process.emitWarning;
	configureHttpDispatcher();
	return main(args, options);
}
