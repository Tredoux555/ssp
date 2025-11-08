# PSP Backup Information

## PSP Backup 1

**Created:** November 8, 2025
**Commit:** e400f65409d67d388361374f6f2500857f4c81d0
**Branch:** `PSP-Backup-1`
**Tag:** `PSP-Backup-1`

### Description
Stable build backup created before further development. This backup includes:
- Cancel alert functionality on dashboard
- Photo upload feature
- Live location tracking
- All fixes up to commit e400f65

### How to Restore

#### Local Server:
```bash
# Switch to backup branch
git checkout PSP-Backup-1

# Or reset main to backup commit
git checkout main
git reset --hard PSP-Backup-1
```

#### Vercel:
1. Go to Vercel Dashboard > Your Project > Deployments
2. Find the deployment with commit hash: e400f65
3. Click "..." menu > "Promote to Production" (if needed)
4. Or use the deployment URL directly

### Current Stable Features
- ✅ Emergency alert creation
- ✅ Alert cancellation from dashboard
- ✅ Live location sharing
- ✅ Photo capture and sharing
- ✅ Push notifications
- ✅ Contact management
- ✅ Real-time updates

### Notes
- This backup is based on commit `e400f65` (Add cancel alert functionality to dashboard)
- All migrations should be run before using this backup
- Environment variables must be configured

