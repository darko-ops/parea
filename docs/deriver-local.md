# Keeping the deriver up on a development machine

The deriver is what turns an upload into something anybody can look at: it
reads the original out of R2, makes the four renditions the clients ask for,
and marks the photograph ready. Nothing draws a photo until it has run.

In production it lives on Fly.io — see [Deploying](deploy.md), which is the
only place it belongs long term. This page is about the other case: a laptop,
where the deriver kept dying because it was started inside a terminal session
and the session ended.

The symptom is confusing enough to be worth naming. Uploads succeed, the bar
finishes, the album says the photographs are there — and every one of them is a
320px thumbnail that never sharpens, because `card`, `grid` and `full` are
derivatives and nothing made them. The app is not broken and the phone is not
at fault; there is simply nothing running.

## Two pieces

**`services/deriver/bin/local.mjs`** is in the repository. It reads
`apps/web/.env.local` with `process.loadEnvFile` and executes the deriver. That
is all it does, and the whole reason it exists is that the obvious shell
equivalent does not work: `set -a; . apps/web/.env.local` fails, because one of
the values contains an `&` and a shell reads that as "background this". The
error names a line number in a file nobody thinks of as code.

**`~/Library/LaunchAgents/com.parea.deriver.plist`** is not in the repository
and should not be — every path in it is absolute and belongs to one machine.
Write it out as below.

Secrets stay in `.env.local` and nowhere else. Putting them in the plist would
mean two copies in two formats, and rotating a key would become a thing you
could half-do.

## Installing it

```sh
cat > ~/Library/LaunchAgents/com.parea.deriver.plist <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.parea.deriver</string>
  <key>ProgramArguments</key>
  <array>
    <string>REPLACE_WITH_$(which node)</string>
    <string>REPLACE_WITH_REPO/services/deriver/bin/local.mjs</string>
    <string>watch</string>
  </array>
  <key>WorkingDirectory</key>
  <string>REPLACE_WITH_REPO/services/deriver</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key>
  <integer>30</integer>
  <key>StandardOutPath</key>
  <string>REPLACE_WITH_HOME/Library/Logs/parea-deriver.log</string>
  <key>StandardErrorPath</key>
  <string>REPLACE_WITH_HOME/Library/Logs/parea-deriver.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
</dict>
</plist>
PLIST

launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.parea.deriver.plist
launchctl print gui/$UID/com.parea.deriver | grep -E 'state|pid'
tail -f ~/Library/Logs/parea-deriver.log
```

Three of those settings are load-bearing:

**`PATH`.** launchd gives a job `/usr/bin:/bin:/usr/sbin:/sbin`, which does not
include Homebrew. `sharp` has no HEVC decoder and shells out to `heif-convert`
for it, so without this every photograph from an iPhone fails to decode — and
it fails in a way that reads as a corrupt file rather than a missing binary.
`exiftool` is on the same path.

**`KeepAlive` with `SuccessfulExit false`.** Restart it when it falls over;
leave it alone when it is stopped on purpose. Plain `KeepAlive` would fight
`launchctl kill -TERM` and restart the thing you just stopped.

**`ThrottleInterval`.** A deriver that cannot reach the database fails in about
a second, and without this launchd would restart it as fast as it could.

## Its limits, which are the reason this is temporary

It runs **when you are logged in**, not when the machine is merely on — a
`LaunchAgent` belongs to a login session. A `LaunchDaemon` would run at boot,
and would then need the secrets somewhere other than a file in a home
directory, which is most of the argument for putting it on a server instead.

It is pinned to **one Node**. `which node` under nvm names a version directory;
switching or removing that version breaks the job, and the failure appears in
the log as a missing executable rather than anywhere you are looking.

The log **does not rotate**. It is a few lines per pass, so it is fine for a
development machine for months, and `rm` is the maintenance.

## Stopping it

```sh
launchctl kill -TERM gui/$UID/com.parea.deriver   # stop it now, keep it installed
launchctl bootout gui/$UID/com.parea.deriver      # unload it
rm ~/Library/LaunchAgents/com.parea.deriver.plist # and forget it
```

`local.mjs` passes `SIGTERM` on to the deriver rather than exiting out from
under it, so a stop leaves no claimed jobs behind.

## Running it by hand

```sh
node services/deriver/bin/local.mjs probe   # what it can and cannot do
node services/deriver/bin/local.mjs once    # drain the queue and exit
node services/deriver/bin/local.mjs watch   # what the agent runs
```

`probe` is the first thing to run when photographs are not appearing. It prints
a line per capability, and the three that usually matter are `exiftool`,
`decode:hevc/libheif` and `moderation` — the last of which refuses to start at
all unless `PAREA_MODERATION` is set, deliberately. See
[the CSAM runbook](csam-runbook.md).
