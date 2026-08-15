# Deploying to the homelab

The bot runs as a Docker Compose service (`docker-compose.yml` in the repo
root) rather than bare-metal, so its container logs are picked up the same
way as `mc-manager`'s (via Docker service discovery in the shared
Loki/Promtail/Grafana logging stack), and native deps (e.g. `better-sqlite3`)
are always built against a known image instead of whatever's on the host.

One-time setup on the homelab host before the `Deploy` workflow will work:

1. **Clone the repo** to the path the workflow expects:
   ```
   git clone git@github.com:lomokwa/selton-mello-bot.git /home/lomokwa/homelab/selton-mello-bot
   cd /home/lomokwa/homelab/selton-mello-bot
   mkdir -p data
   ```
   `data/` holds the bot's SQLite settings db and is gitignored, so it won't
   exist on a fresh clone. It's bind-mounted into the container (`./data:/app/data`
   in `docker-compose.yml`), so it must exist on disk before the container starts.
   The deploy workflow also runs `mkdir -p data` on every deploy so this can't
   regress if the directory is ever removed.

   Add a `.env` there with `DISCORD_TOKEN`, `CLIENT_ID`, `MC_MANAGER_API_URL`,
   `MC_MANAGER_USERNAME`, `MC_MANAGER_PASSWORD` (no `GUILD_ID` — global slash
   command registration is what you want in production). `docker-compose.yml`
   loads it via `env_file`.

2. **Build and start the container:**
   ```
   docker compose build
   docker compose up -d
   ```
   Docker Compose will restart the container automatically on failure/reboot
   (`restart: unless-stopped`).

3. **Confirm the deploy user can run Docker without `sudo`.** `mc-manager-server`'s
   deploy workflow already runs `docker compose up -d --build` over the same
   SSH connection with no `sudo`, so `HOMELAB_USER` should already be in the
   `docker` group on this host — nothing to do here unless that's not the case:
   ```
   sudo usermod -aG docker lomokwa   # only if `docker ps` fails without sudo
   ```

4. **GitHub Actions secrets** (same Cloudflare Access + SSH pattern as
   `mc-manager-server`/`mc-manager-client` — reuse the same values if they're
   already set at the org level, otherwise add per-repo under
   Settings → Secrets and variables → Actions):
   - `HOMELAB_SSH_KEY`
   - `HOMELAB_HOST`
   - `HOMELAB_USER`

After that, every push to `main` will type-check/build/test, then SSH in,
pull, rebuild the image, and restart the container via `docker compose up -d`.

Note: `deploy-commands.ts` (slash command registration) is intentionally
**not** run automatically — it only needs to run once when command
definitions change (`npm run deploy-commands`), and auto-running it on every
deploy risks hitting Discord's rate limits for no benefit.

## Logs

Container logs go to Docker's `json-file` driver (capped at 10MB × 3 files —
see `logging:` in `docker-compose.yml`), viewable directly with:
```
docker compose logs -f bot
```
They're also tailed by Promtail (via Docker service discovery) into the
shared Loki/Grafana logging stack, labeled `job="selton-mello-bot"`, so you
can view/query them there alongside `mc-manager`'s logs without mixing the
two streams.
