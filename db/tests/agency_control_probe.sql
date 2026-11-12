-- Run as omni_app against a database with 0001–0012 and the demo seed.
-- Every mutation is rolled back. Raises on any isolation/security regression.
\set ON_ERROR_STOP 1
BEGIN;
SELECT set_config('app.user_id', 'b0000000-0000-4000-8000-000000000001', true);
DO $$
DECLARE n int; v_id uuid; v_user uuid;
BEGIN
  SELECT count(*) INTO n FROM webhook_endpoints;
  IF n <> 0 THEN RAISE EXCEPTION 'Client can read agency endpoints'; END IF;
  SELECT count(*) INTO n FROM webhook_events;
  IF n <> 0 THEN RAISE EXCEPTION 'Client can read agency events'; END IF;
  SELECT count(*) INTO n FROM webhook_deliveries;
  IF n <> 0 THEN RAISE EXCEPTION 'Client can read agency deliveries'; END IF;
  BEGIN
    INSERT INTO webhook_endpoints (name,url,secret) VALUES ('intruder','https://example.com','secret');
    RAISE EXCEPTION 'Client inserted an agency endpoint';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM provision_tenant_member('22222222-2222-4222-8222-222222222222','intruder@example.dk','hash','Intruder','owner',true);
    RAISE EXCEPTION 'Client provisioned a login';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'Client provisioned a login' THEN RAISE; END IF;
  END;
  UPDATE tenants SET owner_name = 'Owner facts probe' WHERE id = '11111111-1111-4111-8111-111111111111';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'Owner cannot edit own facts'; END IF;
  BEGIN
    UPDATE tenants SET reception_mode = 'hybrid' WHERE id = '11111111-1111-4111-8111-111111111111';
    RAISE EXCEPTION 'Client changed agency reception controls';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  SELECT count(*) INTO n FROM tenants WHERE id = '22222222-2222-4222-8222-222222222222';
  IF n <> 0 THEN RAISE EXCEPTION 'Cross-tenant workspace read'; END IF;
END $$;
ROLLBACK;

BEGIN;
SELECT set_config('app.user_id', 'a0000000-0000-4000-8000-000000000001', true);
DO $$
DECLARE v_endpoint uuid; v_other uuid; v_event uuid; n int; v_user uuid;
BEGIN
  INSERT INTO webhook_endpoints (name,url,secret) VALUES ('global probe','https://example.com/hook','probe-secret') RETURNING id INTO v_endpoint;
  INSERT INTO webhook_endpoints (tenant_id,name,url,secret,events)
    VALUES ('11111111-1111-4111-8111-111111111111','scoped probe','https://example.com/hook','probe-secret',ARRAY['lead.created']) RETURNING id INTO v_other;
  INSERT INTO contacts (tenant_id,full_name) VALUES ('11111111-1111-4111-8111-111111111111','Outbox probe') RETURNING id INTO v_event;
  SELECT count(*) INTO n FROM webhook_deliveries d JOIN webhook_events e ON e.id=d.event_id WHERE e.entity_id=v_event;
  IF n <> 2 THEN RAISE EXCEPTION 'Global + matching scoped fanout expected 2, got %',n; END IF;
  SELECT count(*) INTO n FROM webhook_deliveries WHERE endpoint_id=v_other;
  IF n <> 1 THEN RAISE EXCEPTION 'Client endpoint received another event'; END IF;
  v_user := provision_tenant_member('11111111-1111-4111-8111-111111111111','agency-probe@example.dk','scrypt$test$test','Probe User','staff',true);
  IF NOT EXISTS (SELECT 1 FROM user_security WHERE user_id=v_user AND must_change_password) THEN RAISE EXCEPTION 'Initial password change not enforced'; END IF;
  BEGIN
    PERFORM provision_tenant_member('22222222-2222-4222-8222-222222222222','agency-probe@example.dk','','Probe User','staff',false);
    RAISE EXCEPTION 'Cross-workspace account attachment allowed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'Cross-workspace account attachment allowed' THEN RAISE; END IF;
  END;
  UPDATE tenants SET status='suspended' WHERE id='11111111-1111-4111-8111-111111111111';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'Suspended lifecycle not persisted'; END IF;
END $$;
ROLLBACK;

BEGIN;
SELECT set_config('app.user_id', '', true);
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM webhook_endpoints;
  IF n <> 0 THEN RAISE EXCEPTION 'Anonymous webhook read'; END IF;
  SELECT count(*) INTO n FROM tenants;
  IF n <> 0 THEN RAISE EXCEPTION 'Anonymous tenant read'; END IF;
END $$;
ROLLBACK;
SELECT 'AGENCY CONTROL RLS PROBE PASSED' AS result;
