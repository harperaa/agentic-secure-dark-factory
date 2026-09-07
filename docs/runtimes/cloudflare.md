# Cloudflare runtime (optional)

Two pieces, both optional and independent:

1. **Sandboxes** via the Cloudflare Sandbox SDK from a Worker (design §5.4). Strongest credential story: the outbound Worker attaches credentials at the egress proxy so the agent never holds them. A Durable Object with an alarm loop polls the Machinist control plane over HTTPS; there is no host machine.
2. **Machinist control plane** in a Cloudflare Container with Litestream replicating SQLite to R2 (design §6, Option A), fronted by a Worker and gated by Cloudflare Access. Only needed when an operator wants no local machine at all.

Neither changes Machinist. Both wait on an operator who is already on Cloudflare; pin the SDK version (design R6).
