# Local off-host backups

This directory stores encrypted recovery archives copied from production. Everything except this README is ignored by Git and excluded from deployment.

- Keep encryption key vault files private and also store a protected copy separately from the archives.
- Only archives marked `completed`/`verified` in their private progress metadata are complete backups.
- `.partial` files and an in-progress document snapshot must not be used as a complete restore source.
- The deployment snapshot is a point-in-time backup from the documented deployment, not a continuously current copy of production.

See [BACKUP_OPERATIONS.md](../BACKUP_OPERATIONS.md) for verified results, scheduler commands, recovery tools and retention instructions.
