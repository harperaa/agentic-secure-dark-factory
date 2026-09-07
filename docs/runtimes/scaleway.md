# Scaleway runtime (optional, EU)

Scaleway Serverless Containers run the `svcos-factory` image per job through the plain
`docker run` path of `sandbox-exec --backend=scaleway`. French-hosted, Docker-based, no
SDK-level sandbox primitives, so egress control comes from the container's network policy and
credentials are injected per run from the secrets adapter (Infisical in the EU profile). Used
with the `eu` provider profile (design §4.11) alongside Scaleway hosting and self-hosted Convex.
