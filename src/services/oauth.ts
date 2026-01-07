import fs from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import {
  exportJWK,
  generateKeyPair,
  importPKCS8,
  importSPKI,
  jwtVerify,
  SignJWT,
  type JWTPayload,
  type KeyLike,
  type JWK
} from 'jose';
import { logger } from '../utils/logger.js';

type OAuthAlgorithm = 'HS256' | 'RS256';

interface OAuthConfig {
  enabled: boolean;
  issuer?: string;
  audience: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
  tokenTtlSeconds: number;
  allowInsecureHttp: boolean;
  algorithm: OAuthAlgorithm;
  jwtSecret?: string;
  privateKeyPath?: string;
  publicKeyPath?: string;
}

export interface OAuthState {
  enabled: boolean;
  issuer: string;
  audience: string;
  scopes: string[];
  allowInsecureHttp: boolean;
  clientId: string;
  clientSecret: string;
  metadata: Record<string, unknown>;
  jwks?: { keys: JWK[] };
  resourceMetadataUrl?: string;
  protectedResourceMetadata?: Record<string, unknown>;
  issueToken: (scope: string) => Promise<{ accessToken: string; expiresIn: number; scope: string }>;
  verifyToken: (token: string) => Promise<JWTPayload>;
}

const DEFAULT_CLIENT_ID = 'rlm-client';
const DEFAULT_CLIENT_SECRET = 'rlm-secret';
const DEFAULT_SCOPE = 'mcp';

const parseBoolean = (value?: string): boolean => {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
};

const parseNumber = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseScopes = (value?: string): string[] => {
  if (!value) return [DEFAULT_SCOPE];
  const scopes = value.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
  return scopes.length > 0 ? scopes : [DEFAULT_SCOPE];
};

const createKeyId = (jwk: JWK): string => {
  const payload = JSON.stringify(jwk);
  return createHash('sha256').update(payload).digest('base64url').slice(0, 16);
};

const getOAuthConfig = (): OAuthConfig => {
  const algorithm = (process.env.RLM_OAUTH_JWT_ALG || '').toUpperCase() === 'HS256'
    ? 'HS256'
    : 'RS256';

  const enabled = parseBoolean(process.env.RLM_OAUTH_ENABLED);
  const clientId = process.env.RLM_OAUTH_CLIENT_ID || DEFAULT_CLIENT_ID;
  const clientSecret = process.env.RLM_OAUTH_CLIENT_SECRET || DEFAULT_CLIENT_SECRET;

  if (enabled && (clientId === DEFAULT_CLIENT_ID || clientSecret === DEFAULT_CLIENT_SECRET)) {
    logger.warn('OAuth client credentials are using defaults. Set RLM_OAUTH_CLIENT_ID and RLM_OAUTH_CLIENT_SECRET.');
  }

  return {
    enabled,
    issuer: process.env.RLM_OAUTH_ISSUER,
    audience: process.env.RLM_OAUTH_AUDIENCE || 'rlm-mcp',
    clientId,
    clientSecret,
    scopes: parseScopes(process.env.RLM_OAUTH_SCOPES),
    tokenTtlSeconds: parseNumber(process.env.RLM_OAUTH_TOKEN_TTL_SECONDS, 3600),
    allowInsecureHttp: parseBoolean(process.env.RLM_OAUTH_ALLOW_INSECURE_HTTP),
    algorithm,
    jwtSecret: process.env.RLM_OAUTH_JWT_SECRET,
    privateKeyPath: process.env.RLM_OAUTH_PRIVATE_KEY_PATH,
    publicKeyPath: process.env.RLM_OAUTH_PUBLIC_KEY_PATH
  };
};

const resolveJwtKeys = async (config: OAuthConfig): Promise<{
  algorithm: OAuthAlgorithm;
  signingKey: KeyLike | Uint8Array;
  verifyKey: KeyLike | Uint8Array;
  kid?: string;
  jwks?: { keys: JWK[] };
}> => {
  if (config.algorithm === 'HS256') {
    const secret = config.jwtSecret || randomBytes(32).toString('hex');
    if (!config.jwtSecret) {
      logger.warn('RLM_OAUTH_JWT_SECRET not set. Using an ephemeral secret; tokens will reset on restart.');
    }
    const key = new TextEncoder().encode(secret);
    return { algorithm: 'HS256', signingKey: key, verifyKey: key };
  }

  let privateKey: KeyLike;
  let publicKey: KeyLike;

  if (config.privateKeyPath) {
    const privatePem = fs.readFileSync(config.privateKeyPath, 'utf8');
    privateKey = await importPKCS8(privatePem, 'RS256');
    if (config.publicKeyPath) {
      const publicPem = fs.readFileSync(config.publicKeyPath, 'utf8');
      publicKey = await importSPKI(publicPem, 'RS256');
    } else {
      publicKey = privateKey;
    }
  } else {
    const generated = await generateKeyPair('RS256');
    privateKey = generated.privateKey;
    publicKey = generated.publicKey;
    logger.warn('OAuth signing keys are ephemeral. Set RLM_OAUTH_PRIVATE_KEY_PATH for stable tokens.');
  }

  const publicJwk = await exportJWK(publicKey);
  publicJwk.use = 'sig';
  publicJwk.alg = 'RS256';
  publicJwk.kid = publicJwk.kid || createKeyId(publicJwk);

  return {
    algorithm: 'RS256',
    signingKey: privateKey,
    verifyKey: publicKey,
    kid: publicJwk.kid,
    jwks: { keys: [publicJwk] }
  };
};

export const initializeOAuth = async (options: {
  baseUrl: string;
  protocol: 'http' | 'https';
  resourcePath?: string;
}): Promise<OAuthState> => {
  const config = getOAuthConfig();
  const issuer = config.issuer || options.baseUrl;
  const resourcePath = options.resourcePath || '/mcp';
  const normalizedResourcePath = resourcePath.startsWith('/') ? resourcePath : `/${resourcePath}`;
  const resourceUrl = new URL(normalizedResourcePath, options.baseUrl).toString();
  const resourceMetadataUrl = new URL('/.well-known/oauth-protected-resource/mcp', options.baseUrl).toString();

  if (!config.enabled) {
    return {
      enabled: false,
      issuer,
      audience: config.audience,
      scopes: config.scopes,
      allowInsecureHttp: config.allowInsecureHttp,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      metadata: {},
      resourceMetadataUrl: undefined,
      protectedResourceMetadata: undefined,
      issueToken: async () => ({ accessToken: '', expiresIn: 0, scope: '' }),
      verifyToken: async () => ({})
    };
  }

  const keys = await resolveJwtKeys(config);
  const tokenEndpoint = new URL('/oauth/token', options.baseUrl).toString();
  const jwksUri = keys.jwks ? new URL('/oauth/jwks', options.baseUrl).toString() : undefined;

  const metadata: Record<string, unknown> = {
    issuer,
    token_endpoint: tokenEndpoint,
    grant_types_supported: ['client_credentials'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
    scopes_supported: config.scopes
  };

  if (jwksUri) {
    metadata.jwks_uri = jwksUri;
  }

  const protectedResourceMetadata: Record<string, unknown> = {
    resource: resourceUrl,
    authorization_servers: [issuer],
    scopes_supported: config.scopes,
    bearer_methods_supported: ['header'],
    resource_documentation: new URL('/info', options.baseUrl).toString()
  };

  return {
    enabled: true,
    issuer,
    audience: config.audience,
    scopes: config.scopes,
    allowInsecureHttp: config.allowInsecureHttp,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    metadata,
    jwks: keys.jwks,
    resourceMetadataUrl,
    protectedResourceMetadata,
    issueToken: async (scope: string) => {
      const jwt = await new SignJWT({ scope })
        .setProtectedHeader({ alg: keys.algorithm, ...(keys.kid ? { kid: keys.kid } : {}) })
        .setIssuer(issuer)
        .setAudience(config.audience)
        .setSubject(config.clientId)
        .setIssuedAt()
        .setExpirationTime(Math.floor(Date.now() / 1000) + config.tokenTtlSeconds)
        .sign(keys.signingKey);

      return {
        accessToken: jwt,
        expiresIn: config.tokenTtlSeconds,
        scope
      };
    },
    verifyToken: async (token: string) => {
      const result = await jwtVerify(token, keys.verifyKey, {
        issuer,
        audience: config.audience
      });
      return result.payload;
    }
  };
};
