Development TLS Certificates

This server will auto-detect `certs/localhost.key` and `certs/localhost.crt`
when using `--serve` or `--all`.

Generate a local dev certificate (example using OpenSSL):

```
openssl req -x509 -newkey rsa:2048 -nodes -keyout certs/localhost.key -out certs/localhost.crt -days 365 -subj "/CN=localhost"
```

Then run:

```
node dist/index.js --serve
```
