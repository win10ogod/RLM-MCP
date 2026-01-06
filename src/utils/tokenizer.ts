import { createRequire } from 'node:module';
import { Errors } from '../errors/index.js';

type TiktokenEncoding = {
  encode: (text: string) => number[];
  decode: (tokens: number[]) => string;
  free?: () => void;
};

type TiktokenModule = {
  encoding_for_model?: (model: string) => TiktokenEncoding;
  get_encoding?: (encoding: string) => TiktokenEncoding;
};

let cachedModule: TiktokenModule | null = null;

function loadTiktokenModule(): TiktokenModule {
  if (cachedModule) {
    return cachedModule;
  }

  const require = createRequire(import.meta.url);

  try {
    cachedModule = require('tiktoken') as TiktokenModule;
    return cachedModule;
  } catch (error) {
    throw Errors.invalidInput(
      'tokenizer',
      'tiktoken is required for by_tokens chunking. Install it with: npm install tiktoken'
    );
  }
}

export function getTiktokenEncoding(options: {
  model?: string;
  encoding?: string;
}): TiktokenEncoding {
  const tiktoken = loadTiktokenModule();

  if (options.model && tiktoken.encoding_for_model) {
    try {
      return tiktoken.encoding_for_model(options.model);
    } catch (error) {
      throw Errors.invalidInput('model', `Unknown tiktoken model: ${options.model}`);
    }
  }

  if (options.model) {
    throw Errors.invalidInput('model', 'tiktoken does not expose encoding_for_model');
  }

  if (options.encoding && tiktoken.get_encoding) {
    try {
      return tiktoken.get_encoding(options.encoding);
    } catch (error) {
      throw Errors.invalidInput('encoding', `Unknown tiktoken encoding: ${options.encoding}`);
    }
  }

  if (options.encoding) {
    throw Errors.invalidInput('encoding', 'tiktoken does not expose get_encoding');
  }

  if (tiktoken.get_encoding) {
    return tiktoken.get_encoding('cl100k_base');
  }

  throw Errors.invalidInput(
    'tokenizer',
    'tiktoken does not expose encoding_for_model or get_encoding'
  );
}

export function freeEncoding(encoding: TiktokenEncoding): void {
  if (typeof encoding.free === 'function') {
    encoding.free();
  }
}
