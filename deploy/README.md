# Deploying to the homelab

One-time setup on the homelab host before the `Deploy` workflow will work:

1. **Clone the repo** to the path the workflow expects:
   ```
   git clone git@github.com:lomokwa/selton-mello-bot.git /home/lomokwa/homelab/selton-mello-bot
   cd /home/lomokwa/homelab/selton-mello-bot
   npm ci
   npm run build
   mkdir -p data
   ```
   `data/` holds the bot's SQLite settings db and is gitignored, so it won't
   exist on a fresh clone. The systemd unit below sandboxes the process with
   `ReadWritePaths=.../data`, which requires that directory to already exist
   on disk *before* the service starts — otherwise it crash-loops with
   `226/NAMESPACE`. The deploy workflow also runs `mkdir -p data` on every
   deploy so this can't regress if the directory is ever removed.

   Add a `.env` there with `DISCORD_TOKEN`, `CLIENT_ID`, `MC_MANAGER_API_URL`,
   `MC_MANAGER_USERNAME`, `MC_MANAGER_PASSWORD` (no `GUILD_ID` — global slash
   command registration is what you want in production).

2. **Install the systemd service:**
   ```
   sudo cp deploy/selton-mello-bot.service /etc/systemd/system/selton-mello-bot.service
   sudo systemctl daemon-reload
   sudo systemctl enable --now selton-mello-bot
   ```

3. **Allow the deploy user to restart the service without a password** (the
   SSH deploy step runs non-interactively, so `sudo systemctl restart` needs a
   sudoers rule):
   ```
   echo "lomokwa ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart selton-mello-bot" | sudo tee /etc/sudoers.d/selton-mello-bot
   ```

4. **GitHub Actions secrets** (same Cloudflare Access + SSH pattern as
   `mc-manager-server`/`mc-manager-client` — reuse the same values if they're
   already set at the org level, otherwise add per-repo under
   Settings → Secrets and variables → Actions):
   - `HOMELAB_SSH_KEY`
   - `HOMELAB_HOST`
   - `HOMELAB_USER`

After that, every push to `main` will type-check/build, then SSH in, pull,
rebuild, and restart the service.

Note: `deploy-commands.ts` (slash command registration) is intentionally
**not** run automatically — it only needs to run once when command
definitions change (`npm run deploy-commands`), and auto-running it on every
deploy risks hitting Discord's rate limits for no benefit.
