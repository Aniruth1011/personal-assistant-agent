# Readiness basis — second formal window (2026-11-18 UTC)

Image sha256:8fdf113b938c1e3a2dcb21ec1ef62c4dd86245c1dbcab57bec0755aa2cba189d (full build of deploy/Dockerfile).

- https: `assistant.https_enabled` 06:39:57Z (Tailscale Serve, identity auth).
- memoryRecovery: `assistant.state_restored` on every boot; restored to-do state produced the alert below; personal OpenAI login persisted via forced checkpoint run 06:46Z.
- freshAlert: alerts cron run delivered=True: "Task due 2026-11-17: Synthetic readiness check task (P1)", receipt 3ff48f9fbc7ad0dc8f864397.
- localModel: `assistant.routed_model_verified` local gemma4:e2b 06:39:42Z.
- cloudModel: RPC public-research reasoning turn served openai/gpt-6-luna 06:45:33Z (personal ChatGPT Plus OAuth; USC Edu quota exhausted, resets 2026-11-22). auth.order and cloud probe rebound before start.
- securityAudit: reports/security/SECURITY_REVIEW.md (prior image); startup `assistant.isolation_verified` UID 1000, CapEff 0, NoNewPrivs 1 on this image.
- routingFailurePolicy: Ollama stopped 06:47:59Z — confidential main turn held ("Held safely…"); public main turn answered via isolated research delegation; Ollama restored 06:48:11Z. Main reasoning turn logged delegation → cloud public_reasoning_cloud gpt-6-luna.
