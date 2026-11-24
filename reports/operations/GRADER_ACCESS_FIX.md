# Grader access authentication repair

Verified 2026-11-17 after deployment of image digest `sha256:2d160078b3c948f422d61da1328b6b981e58d4dacac4ceb0ffdac41d0307f53e`.

Enabled OpenClaw-managed Tailscale Serve and identity authentication. Provided the default daemon socket path persistently; retained loopback gateway binding, explicit HTTPS origin, gateway token protection for other ingress and encrypted Tailscale identity recovery.

A fresh browser-protocol device identity with no supplied gateway token and no manual pairing completed health RPC (`ok=true`, 306ms). Existing owner CLI health also passed. Unauthenticated and forged-identity requests to ordinary gateway tool ingress returned HTTP401. This verifies the owner Tailscale identity path; a separate grader account accepting the machine invitation remains unverified.

104 unit tests passed; lint, typecheck, formatting and secret scan passed. Local Gemma inference verified after restart. Cold startup caused transient handshake timeouts and profile acquisition expiry; those failed diagnostics were preserved. Initial deployment targeted an incorrect container name; corrected deployment uses only runtime-1 with original secret mounts. Original formal observation evidence and video remain unchanged.

The final full-runtime assistant.ready marker had not yet been observed when the authentication check completed. Do not equate this narrow access verification with a new full rubric audit.
