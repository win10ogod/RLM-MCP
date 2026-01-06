# RLM MCP Server Configuration Guide

## Overview

This server does not call external LLM APIs. Configure your LLM provider in the MCP client. The settings below only control the RLM MCP server itself.

## Environment Variables

### Required

None.

### Optional

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | HTTP server port | `3000` |
| `RLM_STORAGE_DIR` | Override persisted context storage directory | `.rlm_storage` |
| `RLM_STORAGE_SNAPSHOTS` | Enable context snapshots (`true`/`false`) | `false` |
| `RLM_STORAGE_MAX_SNAPSHOTS` | Max snapshots per context | `5` |
| `RLM_HTTP_MAX_CONCURRENT_REQUESTS` | Max concurrent HTTP requests | `8` |
| `RLM_HTTP_MAX_BODY_SIZE` | HTTP JSON body size limit (express format) | `100mb` |
| `RLM_HTTP_MAX_BODY_BYTES` | HTTP JSON body size limit (bytes) | `104857600` |
| `RLM_HTTP_REQUEST_TIMEOUT_MS` | HTTP request timeout (ms) | `300000` |
| `RLM_HTTPS_ENABLED` | Enable HTTPS when using `--http` | `false` |
| `RLM_HTTPS_KEY_PATH` | Path to TLS private key (PEM) | - |
| `RLM_HTTPS_CERT_PATH` | Path to TLS certificate (PEM) | - |
| `RLM_HTTPS_KEY_PASSPHRASE` | Passphrase for TLS private key | - |

Storage is enabled by default in `.rlm_storage` under the server working directory.
Set `RLM_STORAGE_DIR` to change the location, or set it to an empty string to disable persistence.

## Transport Configuration

### Stdio Mode (Default)

Best for local MCP clients:

```bash
node dist/index.js
```

### HTTP Mode

Best for remote access or multiple clients:

```bash
node dist/index.js --http --port=3000
```

HTTP Endpoints:
- `POST /mcp` - MCP protocol
- `GET /health` - Health check
- `GET /info` - Server information

### Serve Mode (Auto HTTP/HTTPS)

Best for quick local testing without extra flags:

```bash
node dist/index.js --serve --port=3000
```

Uses HTTPS when `RLM_HTTPS_KEY_PATH` and `RLM_HTTPS_CERT_PATH` are configured
(or `RLM_HTTPS_ENABLED=true`), otherwise falls back to HTTP.

### HTTPS Mode

HTTPS requires a TLS private key and certificate. You can enable HTTPS in one of two ways:

1. Use the `--https` flag (strict): the server will error if key/cert are missing.
2. Use `--http` with `RLM_HTTPS_ENABLED=true` (conditional): HTTPS is used only when key/cert are configured.

Required environment variables:
- `RLM_HTTPS_KEY_PATH` (PEM private key)
- `RLM_HTTPS_CERT_PATH` (PEM certificate)

Optional:
- `RLM_HTTPS_KEY_PASSPHRASE`

Example:

```bash
export RLM_HTTPS_KEY_PATH="/path/to/key.pem"
export RLM_HTTPS_CERT_PATH="/path/to/cert.pem"
node dist/index.js --https --port=3443
```

## Resource Limits

- `MAX_CONTEXT_SIZE`: 100MB per context
- `MAX_SESSION_MEMORY`: 500MB per session
- `MAX_CHUNKS`: 10,000 per decomposition
- `MAX_CONTEXTS_PER_SESSION`: 50
- `MAX_VARIABLES_PER_SESSION`: 1,000
- `MAX_VARIABLE_SIZE`: 10MB
- `CHARACTER_LIMIT`: 100,000 characters per tool response
- `MAX_REPL_OUTPUT`: 50,000 characters per REPL execution

## Security Considerations

### Code Execution

The REPL environment executes JavaScript code in a vm2 sandbox:
- Code runs in a sandboxed environment
- Network access is restricted
- File system access is disabled
- Timeout prevents infinite loops

### Input Validation

- Inputs are validated via Zod schemas
- Regex patterns are validated to prevent ReDoS
