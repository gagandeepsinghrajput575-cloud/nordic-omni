# Database migrations

Apply every `*.sql` file in numeric order as the database owner, stopping on the
first error. For example:

```sh
for file in db/migrations/*.sql; do
  psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -f "$file" || exit 1
done
```

The local preview uses a wheel-packaged PostgreSQL without `uuid-ossp`; its local
copy of 0001 omits that extension. `gen_random_uuid()` is built in. Do not remove
the extension from a hosted Supabase migration.

Migration **0012** adds the agency control plane. Apply it before deploying the
new UI or worker. It is additive and preserves existing tenants and credentials.
Existing users do not get a forced password change; newly provisioned and reset
client accounts do.

Run the isolation probe as the RLS-enforced application role, not the owner:

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/tests/agency_control_probe.sql
```

The probe rolls back all its changes and fails on anonymous access, cross-tenant
reads, client webhook access, client operational-control writes, or incorrect
agency-global/client-scoped event fanout.
