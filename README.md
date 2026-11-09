# Komari CPU Steal Monitor

Komari server plugin for two-minute CPU steal sampling from Linux agents.
This standalone plugin repository integrates with the [Komari Emerald Insights theme](https://github.com/Chen017/komari-theme-emerald-insights).

Every two minutes, the plugin uses Komari's remote command API to read only
the cumulative aggregate CPU counters in Linux /proc/stat. It calculates
100 × delta(steal) / delta(total), excluding guest fields from the denominator.
The first poll establishes a baseline. Reboot, offline node, skipped sampling,
and gaps over 3 minutes are not filled or interpolated.

The plugin stores up to 90 days of 2-minute samples in Komari's persistent
plugin data directory. No custom agent, notifications, or dashboard is added.
Linux agents need permission to execute Komari remote commands.

## Theme API

GET /api/plugin/cpu-steal-monitor/v1/history?uuid=<UUID>&from=<epoch-ms>&to=<epoch-ms>

JSON: { "schemaVersion": 1, "uuid": "...", "intervalSeconds": 120,
        "samples": [{ "from": 123, "time": 456, "value": 2.5 }] }

Each sample covers exactly the observed interval [from,time]. The theme should
aggregate overlapping intervals for historical buckets; do not fake 1s samples.
Anonymous reads are allowed only for unhidden nodes on a public Komari site.

## Maintenance

- Minimum Komari version: 1.4.3; approve node/system-RPC/route permissions.
- API v1, persistent history, and two-minute cadence are compatibility contracts.
- Run npm run verify. The workflow uploads installable cpu-steal-monitor.zip.
- The theme must degrade silently if the plugin API is absent or forbidden.
- Never accept command content from HTTP requests.

## Troubleshooting

When the Emerald Insights chart shows `Steal -%`, open Komari Admin → Plugins → CPU Steal Monitor → Logs and confirm that collection is running. Check the node's Agent remote command execution setting: `--disable-web-ssh` / `disable_web_ssh=true` disables remote command execution too. When remote control is disabled, the Agent returns `Remote control is disabled.` with exit code -1; the plugin does not produce a fabricated zero. Reinstall this plugin after upgrading to v0.1.1, then allow two full 2-minute sampling ticks for the first delta. If it still has no values, inspect the plugin logs and the `/api/plugin/cpu-steal-monitor/v1/history?uuid=<uuid>` response. The frontend intentionally displays missing readings as `-%`, rather than `0%`.
