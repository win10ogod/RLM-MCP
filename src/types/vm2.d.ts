declare module 'vm2' {
  export interface VMOptions {
    timeout?: number;
    sandbox?: Record<string, unknown>;
    eval?: boolean;
    wasm?: boolean;
    fixAsync?: boolean;
  }

  export class VMScript {
    constructor(code: string);
  }

  export class VM {
    constructor(options?: VMOptions);
    run(code: string | VMScript): unknown;
  }
}
