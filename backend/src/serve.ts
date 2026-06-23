/**
 * Combined entry for single-container deploys (Render free tier, etc.).
 *
 * Runs the seller (render-service, internal on RENDER_SERVICE_PORT) and the
 * buyer (orchestrator, public on $PORT) in ONE Node process — halving the
 * runtime memory footprint, which matters on a 512 MB free instance where
 * Chromium needs most of the headroom.
 *
 * Both modules self-start on import (each calls app.listen at module load),
 * so importing them is all it takes. The agent still pays the seller over real
 * HTTP (loopback) — the x402 settlement is unchanged.
 */
import "./render-service.ts";
import "./orchestrator.ts";
