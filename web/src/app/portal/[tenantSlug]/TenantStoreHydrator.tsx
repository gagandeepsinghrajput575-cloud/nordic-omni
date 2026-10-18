'use client';

import React, { useEffect } from 'react';
import { useUICommandStore } from '@/lib/store/ui-command-store';
import { Tenant, Contact, CallLog } from '@/contracts/schemas';
import { Lead360Drawer } from '@/components/command-center/Lead360Drawer';

interface TenantStoreHydratorProps {
  tenant: Tenant;
  contacts: Contact[];
  callLogs: CallLog[];
}

export function TenantStoreHydrator({
  tenant,
  contacts,
  callLogs,
}: TenantStoreHydratorProps) {
  const setCurrentTenant = useUICommandStore((state) => state.setCurrentTenant);
  const setContacts = useUICommandStore((state) => state.setContacts);
  const setCallLogs = useUICommandStore((state) => state.setCallLogs);
  const subscribeToTenantEvents = useUICommandStore((state) => state.subscribeToTenantEvents);
  const activeContactId = useUICommandStore((state) => state.activeContactId);
  const openContactDrawer = useUICommandStore((state) => state.openContactDrawer);

  useEffect(() => {
    setCurrentTenant(tenant);
    setContacts(contacts);
    setCallLogs(callLogs);

    const unsubscribe = subscribeToTenantEvents(tenant.id);
    return () => {
      unsubscribe();
    };
  }, [tenant, contacts, callLogs, setCurrentTenant, setContacts, setCallLogs, subscribeToTenantEvents]);

  return (
    <>
      {activeContactId && (
        <Lead360Drawer
          contactId={activeContactId}
          tenantId={tenant.id}
          defaultLanguage={tenant.default_language}
          onClose={() => openContactDrawer(null)}
        />
      )}
    </>
  );
}
