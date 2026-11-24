"""Single-process Railway entrypoint; preserve the API's per-instance capacity gate."""
import os

import uvicorn


if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", "8000")),
        workers=1,
        # The application handles explicitly trusted ingress headers itself.
        proxy_headers=False,
        timeout_graceful_shutdown=300,
    )
