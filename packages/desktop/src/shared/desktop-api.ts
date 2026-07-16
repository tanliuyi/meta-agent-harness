import type {
  DraftSessionConfig,
  FileNode,
  HostResponse,
  Project,
  SendInput,
  SessionBootstrap,
  SessionControlState,
  SessionCreateInput,
  SessionPushPayload,
  SessionRunInput,
  TerminalEvent,
  TerminalSnapshot,
  TextFile,
  Thread,
  WorkbenchState,
} from "./contracts.ts";

/** Renderer 可以调用的最小 Desktop API。 */
export interface DesktopApi {
  versions: {
    electron: string;
    chrome: string;
    node: string;
  };
  projects: {
    list(): Promise<Project[]>;
    choose(): Promise<Project | null>;
    open(projectId: string): Promise<Project>;
    remove(projectId: string): Promise<void>;
    getActive(): Promise<Project | null>;
  };
  sessions: {
    list(projectId: string, includeArchived?: boolean): Promise<Thread[]>;
    getDraftConfig(projectId: string): Promise<DraftSessionConfig>;
    create(input: SessionCreateInput): Promise<SessionBootstrap>;
    attach(
      projectId: string,
      threadId: string,
      listener: (update: SessionPushPayload) => void,
    ): Promise<SessionBootstrap>;
    flush(): void;
    detach(): void;
    rename(projectId: string, threadId: string, title: string): Promise<void>;
    archive(projectId: string, threadId: string, archived: boolean): Promise<void>;
    remove(projectId: string, threadId: string): Promise<void>;
    run(input: SessionRunInput): Promise<void>;
    enqueue(input: SendInput): Promise<void>;
    cancel(projectId: string, threadId: string): Promise<void>;
    clearQueue(projectId: string, threadId: string): Promise<string[]>;
    compact(projectId: string, threadId: string): Promise<void>;
    setModel(projectId: string, threadId: string, provider: string, modelId: string): Promise<void>;
    setThinking(projectId: string, threadId: string, level: SessionControlState["thinkingLevel"]): Promise<void>;
    respond(projectId: string, threadId: string, response: HostResponse): Promise<void>;
  };
  files: {
    list(projectId: string, path?: string, query?: string): Promise<FileNode[]>;
    read(projectId: string, path: string): Promise<TextFile>;
  };
  terminals: {
    open(
      projectId: string,
      threadId: string,
      terminalId: string,
      cols: number,
      rows: number,
    ): Promise<TerminalSnapshot>;
    write(projectId: string, threadId: string, terminalId: string, data: string): Promise<void>;
    resize(projectId: string, threadId: string, terminalId: string, cols: number, rows: number): Promise<void>;
    restart(
      projectId: string,
      threadId: string,
      terminalId: string,
      cols: number,
      rows: number,
    ): Promise<TerminalSnapshot>;
    onEvent(listener: (event: TerminalEvent) => void): () => void;
  };
  workbench: {
    get(projectId: string, threadId: string): Promise<WorkbenchState>;
    update(state: WorkbenchState): Promise<void>;
  };
}
