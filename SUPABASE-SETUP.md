# JAY ARC Supabase setup

## 1. Create and configure the Supabase project

1. Create a Supabase project and open **Project Settings → API**.
2. Copy the project URL and the public `anon`/publishable key into `supabase-config.js`.
   The `anon` key is designed for browser use; never use a `service_role` key in this app.
3. Open **SQL Editor**, run `supabase-schema.sql`, and confirm both `profiles` and `user_data` have Row Level Security enabled.
4. In **Authentication → URL Configuration**, set the production site URL and add the exact app URL to the allowed redirect URLs. Also add the local development URL you use.
5. Configure email delivery and confirmation in **Authentication → Providers → Email**. Password recovery redirects to the app path with `#reset-password`.
6. Serve the app over HTTPS (or `localhost`) and open `index.html`. The service worker requires a secure context; Supabase login requires network access.

## 2. Create the first administrator

Register and confirm the account normally. Find its UUID in **Authentication → Users**, then run this in the SQL Editor:

```sql
update public.profiles
set role = 'admin'
where id = '<auth.users UUID>';
```

Role changes are intentionally not granted to browser clients. An administrator can view account email addresses and aggregate record counts, and enable or disable accounts; the admin API does not expose users' private progress records.

## 3. Existing browser data

After sign-in, JAY ARC checks the existing local-storage and IndexedDB formats. It shows a confirmation dialog before importing the newest valid local state, and only imports when the signed-in account has no cloud data. The import uses an insert-only database operation; if another session has created cloud data first, it is left unchanged. Original local records are not deleted. A browser migration marker prevents those same records from being offered to a second account.

If cloud data already exists, use **Data & Backup → Download full JSON** to preserve the account's data. Do not clear browser storage until you have exported or migrated any local records you need.

## 4. Security and behavior

- `profiles` and `user_data` use RLS; private progress is keyed by the authenticated user UUID.
- The only app data table stores the complete dashboard state as JSONB. The save RPC uses an expected timestamp to reject stale writes instead of silently overwriting changes from another device.
- Passwords are handled only by Supabase Auth. The browser stores only Supabase session tokens (persistent when **Remember me** is checked, session-only otherwise).
- Device recovery snapshots use a separate IndexedDB database per account. They are additional local backups; Supabase remains the primary source of signed-in data.
- For an RLS smoke test, create two accounts, save a distinct record in each, and confirm each sees only its own records. With account A's token, querying or updating `user_data` with account B's UUID must return no row / be rejected. Confirm a regular user's update to `profiles.role` is denied.
