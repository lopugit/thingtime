OPENAI_BASE_URL=http://127.0.0.1:4768/v1 OPENAI_API_KEY="$(cat ~/.codex-llm-proxy/key)" GRAPHIFY_OPENAI_MODEL=codex-default graphify extract . --backend openai --max-concurrency 4 --api-timeout 7200
